// Vignette Worker: owner API, public share page, and media streaming from R2.
// Static files in ./public are served by Workers Static Assets before this
// code runs, so everything here is the dynamic part. The share page's HTML
// lives in share-page.js; streaming an R2 object with ranges in media.js.
import { sharePageResponse, notFoundResponse } from './share-page.js';
import { HttpError, json } from './http.js';
import { streamObject } from './media.js';

const PART_SIZE = 20 * 1024 * 1024; // 20 MiB: single-shot limit and multipart chunk size
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9]{16}$/;

// Each recording is up to three files. "video" is the rendered MP4 that the
// share page plays. "screen" and "camera" are the originals as recorded,
// kept for the owner (for re-rendering later) and never served publicly.
const TRACKS = ['video', 'screen', 'camera'];
const RAW = ['screen', 'camera'];
const RAW_COL = { screen: 'raw_screen', camera: 'raw_camera' }; // column names come only from here
const SIZES = ['small', 'medium', 'large'];
const SHAPES = ['round', 'square'];
// The layouts a video can be rendered in (public/layouts.js); padded carries its colour: 'padded:grey'.
const LAYOUTS = ['bubble', 'split', 'camera', 'screen', 'padded'];
const COLOURS = ['cream', 'black', 'grey', 'vermilion'];
const AGAIN_STALE_MS = 60 * 60 * 1000; // an unfinished render-again older than this may be replaced

const videoKey = (id) => `videos/${id}.mp4`;
const thumbKey = (id) => `thumbs/${id}.jpg`;
const rawKey = (id, track) => `raw/${id}-${track}.mp4`;
const fileKey = (id, track) => (track === 'video' ? videoKey(id) : rawKey(id, track));

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, err.headers);
      console.error(err);
      // The most common setup mistakes get a message that says what to do.
      if (/no such table/i.test(err.message)) {
        return json({ error: 'The database is not set up yet. Run: npm run db:init' }, 500);
      }
      if (/no such column|has no column named/i.test(err.message)) {
        return json({ error: 'The database is from an older Vignette and needs its update. Run: npm run db:migrate' }, 500);
      }
      return json({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- Router ----------

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = request.method;

  if (parts[0] === 'api') {
    await requireOwner(request, env);
    if (parts[1] !== 'videos') throw new HttpError(404, 'Not found');
    const id = parts[2];
    if (parts.length === 2) {
      if (method === 'GET') return listVideos(env);
      if (method === 'POST') return createVideo(request, env);
    } else {
      if (!ID_RE.test(id)) throw new HttpError(404, 'Video not found');
      const action = parts[3];
      if (parts.length === 3 && method === 'GET') return getVideo(env, id);
      if (parts.length === 3 && method === 'DELETE') return deleteVideo(env, id);
      if (parts.length === 4 && action === 'again' && method === 'POST') return againVideo(request, env, id);
      if (parts.length === 4 && action === 'blob' && method === 'PUT') return putBlob(request, env, id, trackOf(url));
      if (parts.length === 5 && action === 'parts' && method === 'PUT') return putPart(request, env, id, parts[4], trackOf(url));
      if (parts.length === 4 && action === 'complete' && method === 'POST') return completeFile(request, env, id, trackOf(url));
      if (parts.length === 4 && action === 'thumb' && method === 'PUT') return putThumb(request, env, id);
      if (parts.length === 5 && action === 'raw' && (method === 'GET' || method === 'HEAD')) return getRaw(request, env, id, parts[4]);
    }
    throw new HttpError(405, 'Method not allowed');
  }

  if (parts.length === 2 && (method === 'GET' || method === 'HEAD')) {
    const id = parts[1];
    if (parts[0] === 'v') return sharePage(env, url, id);
    if (parts[0] === 'media') return streamMedia(request, env, id);
    if (parts[0] === 'thumb') return getThumb(env, id);
  }

  // Everything else is a static file (or the assets 404).
  return env.ASSETS.fetch(request);
}

// ?track=video (the default), screen or camera: which file an upload request is for.
function trackOf(url) {
  const track = url.searchParams.get('track') ?? 'video';
  if (!TRACKS.includes(track)) throw new HttpError(400, 'track must be video, screen or camera');
  return track;
}

// ---------- Auth ----------

// Constant-time comparison: hash both sides so lengths match, then compare
// every byte without returning early. The client URL-encodes the password
// (HTTP headers only carry Latin-1), so it is decoded here.
async function requireOwner(request, env) {
  const expected = env.VIGNETTE_PASSWORD;
  if (!expected) {
    throw new HttpError(500, 'VIGNETTE_PASSWORD is not set on the server. Set it with: npx wrangler secret put VIGNETTE_PASSWORD');
  }
  const header = request.headers.get('authorization') || '';
  let given = '';
  try { given = decodeURIComponent(header.startsWith('Bearer ') ? header.slice(7) : ''); } catch { /* malformed: stays empty, so 401 */ }
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  if (diff !== 0 || !given) throw new HttpError(401, 'Wrong or missing password');
}

// ---------- Helpers ----------

function newId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  // 252 is the largest multiple of 36 below 256; rejecting bytes above it
  // keeps every character equally likely.
  let id = '';
  while (id.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < 252 && id.length < 16) id += alphabet[byte % 36];
    }
  }
  return id;
}

async function getRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Video not found');
  return row;
}

// The request's body as a JSON object; anything else (bad JSON, null, a string, a list) is a 400.
async function readJson(request) {
  let body;
  try { body = await request.json(); } catch { throw new HttpError(400, 'Body must be JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
  return body;
}

// Checks the declared size and returns the body as a stream. R2 needs to
// know the length up front, which Content-Length provides. Streaming keeps a
// 20 MiB part out of Worker memory and off the free plan's CPU budget.
function bodyStream(request, limit) {
  const length = Number(request.headers.get('content-length'));
  if (!request.body || !Number.isInteger(length) || length <= 0) throw new HttpError(411, 'Content-Length required');
  if (length > limit) throw new HttpError(413, 'Body too large');
  return { body: request.body, length };
}

// An original's upload record ({size, uploadId, ready}) from its column, or null.
function rawState(row, track) {
  try { return JSON.parse(row[RAW_COL[track]] || 'null'); } catch { return null; } // unreadable: treated as not declared
}

// A version being rendered again (POST /api/videos/:id/again), or null. While
// it uploads, the row keeps describing and serving the current video; the new
// version waits in upload_id as JSON: {again: true, uploadId, nonce, started,
// title, duration, size, width, height, layout, bubble}. A plain upload_id is
// a first upload's multipart id.
function pendingOf(row) {
  if (typeof row?.upload_id !== 'string' || !row.upload_id.startsWith('{')) return null;
  try { const p = JSON.parse(row.upload_id); return p?.again ? p : null; } catch { return null; }
}

// Whether the share page, /media and /thumb serve the row: a finished video,
// or one whose next version is still uploading (the current one plays meanwhile).
const playable = (row) => row?.status === 'ready' || (row?.status === 'uploading' && !!pendingOf(row));

// Where one file of a row stands: {size, uploadId, ready}. The video's state
// is the row's own columns (or the version being rendered again); an
// original's is its small JSON record, present only when the original was
// declared as the row was made.
function fileState(row, track) {
  const pending = track === 'video' && pendingOf(row);
  if (pending) return { size: pending.size, uploadId: pending.uploadId, ready: false };
  if (track === 'video') return { size: row.size, uploadId: row.upload_id, ready: row.status === 'ready' };
  const state = rawState(row, track);
  if (!state) throw new HttpError(409, `No ${track} original was declared for this video`);
  return state;
}

// Validates the bubble's place as sent by the client: {x, y} shares of the
// frame from 0 to 1, one of the three sizes, and a shape (round when left
// out, as before shapes existed). Stored as JSON, or null.
function bubbleJson(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new HttpError(400, 'bubble must be {x, y, size, shape}');
  const { x, y, size, shape = 'round' } = value;
  const share = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
  if (!share(x) || !share(y) || !SIZES.includes(size) || !SHAPES.includes(shape)) {
    throw new HttpError(400, 'bubble must be {x, y, size, shape} with x and y from 0 to 1, size small, medium or large, shape round or square');
  }
  return JSON.stringify({ x, y, size, shape });
}

// Validates a layout: one of the five, padded with one of its four colours.
function layoutText(value = 'bubble') {
  const [id, colour, ...rest] = typeof value === 'string' ? value.split(':') : [];
  const fine = !rest.length && LAYOUTS.includes(id) && (id === 'padded' ? COLOURS.includes(colour) : colour === undefined);
  if (!fine) throw new HttpError(400, `layout must be ${LAYOUTS.slice(0, 4).join(', ')} or padded:<${COLOURS.join('|')}>`);
  return value;
}

// Checks a declared file size against the upload cap.
function checkBytes(env, n, what) {
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${what} must be a positive number of bytes`);
  if (n > Number(env.MAX_UPLOAD_MB || 2000) * 1024 * 1024) {
    throw new HttpError(413, `${what === 'size' ? 'Video' : `The ${what} original`} is larger than the ${env.MAX_UPLOAD_MB} MB limit`);
  }
}

// What a rendered video declares, validated, for a new upload or a version rendered again.
function videoFields(env, body) {
  const title = String(body.title ?? '').trim().slice(0, 200) || 'Untitled';
  const duration = Number(body.duration);
  const size = Number(body.size);
  const side = (v) => (Number.isInteger(v) && v > 0 && v <= 16384 ? v : null);
  if (!Number.isFinite(duration) || duration < 0) throw new HttpError(400, 'duration must be a number of seconds');
  checkBytes(env, size, 'size');
  return { title, duration, size, width: side(body.width), height: side(body.height), layout: layoutText(body.layout), bubble: bubbleJson(body.bubble) };
}

// ---------- Owner API ----------

// "again" is 1 while a version rendered again is uploading (the library says so).
async function listVideos(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, duration, size, created_at, status, has_raw, layout,
       CASE WHEN status = 'uploading' AND upload_id LIKE '{%' THEN 1 ELSE 0 END AS again
     FROM videos ORDER BY created_at DESC`,
  ).all();
  return json({ videos: results });
}

// One recording, for rendering it again: what it is now, never its upload records.
async function getVideo(env, id) {
  const row = await getRow(env, id);
  let bubble = null;
  try { bubble = JSON.parse(row.bubble || 'null'); } catch { /* unreadable: no place */ }
  const { title, duration, size, status, created_at, width, height, camera_offset, has_raw, layout } = row;
  return json({ id, title, duration, size, status, created_at, width, height, camera_offset, has_raw, layout, bubble, again: pendingOf(row) ? 1 : 0 });
}

async function createVideo(request, env) {
  const body = await readJson(request);
  const { title, duration, size, width, height, layout, bubble } = videoFields(env, body);
  const mime = typeof body.mime === 'string' && body.mime.startsWith('video/') ? body.mime : 'video/mp4';
  const offset = body.cameraOffset ?? null;
  if (offset !== null && (!Number.isFinite(offset) || Math.abs(offset) > 60)) throw new HttpError(400, 'cameraOffset must be a number of seconds');
  // The originals: both or neither, each with its size. Their bytes come after the video's.
  const raw = body.raw ?? null;
  if (raw !== null) for (const t of RAW) checkBytes(env, raw?.[t], t);

  const id = newId();
  const multipart = (bytes) => bytes > PART_SIZE;
  // Multipart uploads opened here stay open in R2 (and keep their parts) until
  // completed or aborted, so if the row cannot be written they are aborted.
  const opened = [];
  const begin = async (key, bytes) => {
    if (!multipart(bytes)) return null;
    const upload = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: 'video/mp4' } });
    opened.push(upload);
    return upload.uploadId;
  };
  try {
    const uploadId = await begin(videoKey(id), size);
    const declared = { screen: null, camera: null };
    if (raw) for (const t of RAW) declared[t] = JSON.stringify({ size: raw[t], uploadId: await begin(rawKey(id, t), raw[t]), ready: false });
    await env.DB.prepare(
      `INSERT INTO videos (id, title, duration, size, mime, width, height, status, upload_id, created_at,
         camera_offset, has_raw, layout, bubble, raw_screen, raw_camera)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(id, title, duration, size, mime, width, height, uploadId, Date.now(), offset, layout, bubble, declared.screen, declared.camera).run();
  } catch (err) {
    await Promise.all(opened.map((u) => u.abort().catch(() => {})));
    throw err;
  }
  return json({
    id, multipart: multipart(size), partSize: PART_SIZE,
    raw: raw ? { screen: { multipart: multipart(raw.screen) }, camera: { multipart: multipart(raw.camera) } } : null,
  }, 201);
}

// A new version of an uploaded recording, rendered again from its originals
// (the library's Change layout). The row keeps serving its current video
// until the new one completes: the new version waits in upload_id (see
// pendingOf) and completing it moves its fields onto the row. It is always a
// multipart upload, so R2 swaps the object when it completes and not before.
// One at a time: a second one is refused while the first uploads, unless it
// is the same client retrying (its nonce) or the first was left for an hour.
async function againVideo(request, env, id) {
  const row = await getRow(env, id);
  const body = await readJson(request);
  if (!row.has_raw) throw new HttpError(409, 'This recording has no originals kept, so it cannot be rendered again');
  const busy = new HttpError(409, 'This recording is already being rendered again. Wait until that upload finishes, then try again');
  const nonce = typeof body.nonce === 'string' && /^[a-z0-9]{8,32}$/.test(body.nonce) ? body.nonce : null;
  const pending = pendingOf(row);
  const reply = () => json({ id, multipart: true, partSize: PART_SIZE, raw: null });
  if (row.status !== 'ready') {
    if (pending && nonce && pending.nonce === nonce) return reply(); // its answer was lost; carry on
    if (!pending || !(Date.now() - pending.started > AGAIN_STALE_MS)) throw busy;
  }
  const fields = videoFields(env, body);
  const upload = await env.MEDIA.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: 'video/mp4' } });
  let changed = 0;
  try {
    // Only if the row is still as read, so two at once cannot both start.
    const next = JSON.stringify({ again: true, uploadId: upload.uploadId, nonce, started: Date.now(), ...fields });
    const result = await env.DB.prepare("UPDATE videos SET status = 'uploading', upload_id = ? WHERE id = ? AND status = ? AND upload_id IS ?")
      .bind(next, id, row.status, row.upload_id).run();
    changed = result.meta?.changes ?? 0;
  } finally {
    if (!changed) await upload.abort().catch(() => {});
  }
  if (!changed) throw busy;
  if (pending) {
    try { await env.MEDIA.resumeMultipartUpload(videoKey(id), pending.uploadId).abort(); } catch { /* already gone */ }
  }
  return reply();
}

async function putBlob(request, env, id, track) {
  const state = fileState(await getRow(env, id), track);
  if (state.ready || state.uploadId) throw new HttpError(409, 'This file does not take a single-shot upload');
  const { body, length } = bodyStream(request, PART_SIZE);
  await env.MEDIA.put(fileKey(id, track), body, { httpMetadata: { contentType: 'video/mp4' } });
  return json({ ok: true, size: length });
}

async function putPart(request, env, id, n, track) {
  const partNumber = Number(n);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new HttpError(400, 'Part number must be 1 to 10000');
  const state = fileState(await getRow(env, id), track);
  if (state.ready || !state.uploadId) throw new HttpError(409, 'This file is not a multipart upload in progress');
  if (partNumber > Math.ceil(state.size / PART_SIZE)) throw new HttpError(400, 'More parts than the declared size needs');
  const { body } = bodyStream(request, PART_SIZE);
  const upload = env.MEDIA.resumeMultipartUpload(fileKey(id, track), state.uploadId);
  const part = await upload.uploadPart(partNumber, body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

// Finishes one file. The video's completion marks the row ready, so the
// share link works; an original's marks it kept, and once both originals
// are kept the row's has_raw becomes 1.
async function completeFile(request, env, id, track) {
  const row = await getRow(env, id);
  const state = fileState(row, track);
  if (state.ready) return json({ id, track, status: 'ready', size: state.size }); // retry after a lost response
  const body = await readJson(request);
  const key = fileKey(id, track);
  let size;
  if (state.uploadId) {
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length || !parts.every((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string')) {
      throw new HttpError(400, 'parts must be a list of {partNumber, etag}');
    }
    // R2 would happily stitch together a list with a gap, giving a corrupt
    // file marked ready. Require exactly parts 1..N for the declared size.
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const expected = Math.ceil(state.size / PART_SIZE);
    if (parts.length !== expected || parts.some((p, i) => p.partNumber !== i + 1)) {
      throw new HttpError(409, `Expected parts 1 to ${expected}, got ${parts.map((p) => p.partNumber).join(', ')}`);
    }
    const upload = env.MEDIA.resumeMultipartUpload(key, state.uploadId);
    try {
      const object = await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
      size = object.size;
    } catch (err) {
      // A bad etag or missing part. Retrying the same request cannot help.
      throw new HttpError(409, `R2 could not finish the upload: ${err.message}`);
    }
  } else {
    const object = await env.MEDIA.head(key);
    if (!object) throw new HttpError(409, 'Nothing has been uploaded for this file yet');
    size = object.size;
  }
  // Store the size R2 actually holds, so the row always matches the file.
  const pending = track === 'video' && pendingOf(row);
  if (pending) {
    // The version rendered again is live: its fields become the row's.
    const { title, duration, width, height, layout, bubble } = pending;
    await env.DB.prepare(
      `UPDATE videos SET status = 'ready', upload_id = NULL, size = ?, title = ?, duration = ?, width = ?, height = ?, layout = ?, bubble = ?
       WHERE id = ? AND upload_id = ?`,
    ).bind(size, title, duration, width, height, layout, bubble, id, row.upload_id).run();
  } else if (track === 'video') {
    await env.DB.prepare("UPDATE videos SET status = 'ready', upload_id = NULL, size = ? WHERE id = ?").bind(size, id).run();
  } else {
    // One statement, so two completes racing still leave has_raw right.
    const other = RAW_COL[track === 'screen' ? 'camera' : 'screen'];
    await env.DB.prepare(
      `UPDATE videos SET ${RAW_COL[track]} = ?, has_raw = CASE WHEN json_extract(${other}, '$.ready') THEN 1 ELSE 0 END WHERE id = ?`,
    ).bind(JSON.stringify({ size, uploadId: null, ready: true }), id).run();
  }
  return json({ id, track, status: 'ready', size });
}

async function putThumb(request, env, id) {
  await getRow(env, id);
  const { body } = bodyStream(request, MAX_THUMB_BYTES);
  await env.MEDIA.put(thumbKey(id), body, { httpMetadata: { contentType: 'image/jpeg' } });
  return json({ ok: true });
}

// An original as recorded, for the owner only (a later version re-renders
// from it). Range requests work, so a player or Mediabunny can read parts.
async function getRaw(request, env, id, track) {
  if (!RAW.includes(track)) throw new HttpError(404, 'No such original');
  const row = await getRow(env, id);
  if (!row.has_raw) throw new HttpError(404, 'No originals are kept for this video');
  return streamObject(request, env, rawKey(id, track), 'private, no-store', 'Original not found');
}

async function deleteVideo(env, id) {
  const row = await getRow(env, id);
  // An unfinished multipart upload keeps its parts in R2 until aborted.
  const open = [[videoKey(id), fileState(row, 'video').uploadId], ...RAW.map((t) => [rawKey(id, t), rawState(row, t)?.uploadId])];
  for (const [key, uploadId] of open) {
    if (!uploadId) continue;
    try { await env.MEDIA.resumeMultipartUpload(key, uploadId).abort(); } catch { /* already gone */ }
  }
  await env.MEDIA.delete([videoKey(id), thumbKey(id), ...RAW.map((t) => rawKey(id, t))]);
  await env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- Public: media and thumbnails ----------

async function streamMedia(request, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Video not found');
  // Only finished videos are served (or, while a version rendered again
  // uploads, the current one): not half-uploaded ones, not deleted ones, and
  // only the rendered file (the originals never come from here).
  const row = await env.DB.prepare('SELECT status, upload_id FROM videos WHERE id = ?').bind(id).first();
  if (!playable(row)) throw new HttpError(404, 'Video not found');
  // Private and short, so a deleted video stops playing within the hour
  // and shared caches never keep a copy.
  return streamObject(request, env, videoKey(id), 'private, max-age=3600', 'Video not found');
}

async function getThumb(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Thumbnail not found');
  const row = await env.DB.prepare('SELECT status, upload_id FROM videos WHERE id = ?').bind(id).first();
  if (!playable(row)) throw new HttpError(404, 'Thumbnail not found');
  const object = await env.MEDIA.get(thumbKey(id));
  if (!object) throw new HttpError(404, 'Thumbnail not found');
  return new Response(object.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', etag: object.httpEtag },
  });
}

// ---------- Public: share page ----------

async function sharePage(env, url, id) {
  const row = ID_RE.test(id)
    ? await env.DB.prepare('SELECT * FROM videos WHERE id = ?').bind(id).first()
    : null;
  if (!playable(row)) return notFoundResponse();
  return sharePageResponse(row, url.origin, newId());
}
