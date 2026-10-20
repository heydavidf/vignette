// Vignette Worker: owner API, public share page, and media streaming from R2.
// Static files in ./public are served by Workers Static Assets before this
// code runs, so everything here is the dynamic part.

// The pictogram sprite, inlined into share pages so they need no extra
// request (wrangler.toml imports .svg files as text).
import ICONS from '../public/icons.svg';

const PART_SIZE = 20 * 1024 * 1024; // 20 MiB: single-shot limit and multipart chunk size
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const ID_RE = /^[a-z0-9]{16}$/;
// Shown in the share page footer. Change it to your fork's URL.
const REPO_URL = 'https://github.com/heydavidf/vignette';

const videoKey = (id) => `videos/${id}.mp4`;
const thumbKey = (id) => `thumbs/${id}.jpg`;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, err.headers);
      console.error(err);
      // The most common setup mistake gets a message that says what to do.
      if (/no such table/i.test(err.message)) {
        return json({ error: 'The database is not set up yet. Run: npm run db:init' }, 500);
      }
      return json({ error: 'Internal error' }, 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message, headers = {}) { super(message); this.status = status; this.headers = headers; }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

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
      if (parts.length === 3 && method === 'DELETE') return deleteVideo(env, id);
      if (parts.length === 4 && action === 'blob' && method === 'PUT') return putBlob(request, env, id);
      if (parts.length === 5 && action === 'parts' && method === 'PUT') return putPart(request, env, id, parts[4]);
      if (parts.length === 4 && action === 'complete' && method === 'POST') return completeVideo(request, env, id);
      if (parts.length === 4 && action === 'thumb' && method === 'PUT') return putThumb(request, env, id);
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

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Body must be JSON'); }
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// The parts every Vignette page shares: fonts, styles, the header strip.
const HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B0B0B">
<meta name="robots" content="noindex">
<link rel="preload" href="/vendor/fonts/fira-sans-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/share.css">`;
const TOP = `<header class="top"><div class="wrap top-row"><span class="brand">Vignette</span></div></header>`;
const FOOT = `<footer class="foot"><div class="wrap">Recorded with <a href="${REPO_URL}">Vignette</a></div></footer>`;
const glyph = (name) => `<svg class="glyph" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ---------- Owner API ----------

async function listVideos(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, duration, size, created_at, status FROM videos ORDER BY created_at DESC',
  ).all();
  return json({ videos: results });
}

async function createVideo(request, env) {
  const body = await readJson(request);
  const title = String(body.title ?? '').trim().slice(0, 200) || 'Untitled';
  const duration = Number(body.duration);
  const size = Number(body.size);
  const mime = typeof body.mime === 'string' && body.mime.startsWith('video/') ? body.mime : 'video/mp4';
  const width = Number.isInteger(body.width) ? body.width : null;
  const height = Number.isInteger(body.height) ? body.height : null;
  if (!Number.isFinite(duration) || duration < 0) throw new HttpError(400, 'duration must be a number of seconds');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'size must be a positive number of bytes');
  const maxBytes = Number(env.MAX_UPLOAD_MB || 2000) * 1024 * 1024;
  if (size > maxBytes) throw new HttpError(413, `Video is larger than the ${env.MAX_UPLOAD_MB} MB limit`);

  const id = newId();
  const multipart = size > PART_SIZE;
  let uploadId = null;
  if (multipart) {
    const upload = await env.MEDIA.createMultipartUpload(videoKey(id), { httpMetadata: { contentType: 'video/mp4' } });
    uploadId = upload.uploadId;
  }
  await env.DB.prepare(
    `INSERT INTO videos (id, title, duration, size, mime, width, height, status, upload_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
  ).bind(id, title, duration, size, mime, width, height, uploadId, Date.now()).run();
  return json({ id, multipart, partSize: PART_SIZE }, 201);
}

async function putBlob(request, env, id) {
  const row = await getRow(env, id);
  if (row.status !== 'uploading' || row.upload_id) throw new HttpError(409, 'This video does not take a single-shot upload');
  const { body, length } = bodyStream(request, PART_SIZE);
  await env.MEDIA.put(videoKey(id), body, { httpMetadata: { contentType: 'video/mp4' } });
  return json({ ok: true, size: length });
}

async function putPart(request, env, id, n) {
  const partNumber = Number(n);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new HttpError(400, 'Part number must be 1 to 10000');
  const row = await getRow(env, id);
  if (row.status !== 'uploading' || !row.upload_id) throw new HttpError(409, 'This video is not a multipart upload in progress');
  if (partNumber > Math.ceil(row.size / PART_SIZE)) throw new HttpError(400, 'More parts than the declared size needs');
  const { body } = bodyStream(request, PART_SIZE);
  const upload = env.MEDIA.resumeMultipartUpload(videoKey(id), row.upload_id);
  const part = await upload.uploadPart(partNumber, body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeVideo(request, env, id) {
  const row = await getRow(env, id);
  if (row.status === 'ready') return json({ id, status: 'ready', size: row.size }); // retry after a lost response
  const body = await readJson(request);
  let size;
  if (row.upload_id) {
    const parts = Array.isArray(body.parts) ? body.parts : [];
    if (!parts.length || !parts.every((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string')) {
      throw new HttpError(400, 'parts must be a list of {partNumber, etag}');
    }
    // R2 would happily stitch together a list with a gap, giving a corrupt
    // video marked ready. Require exactly parts 1..N for the declared size.
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const expected = Math.ceil(row.size / PART_SIZE);
    if (parts.length !== expected || parts.some((p, i) => p.partNumber !== i + 1)) {
      throw new HttpError(409, `Expected parts 1 to ${expected}, got ${parts.map((p) => p.partNumber).join(', ')}`);
    }
    const upload = env.MEDIA.resumeMultipartUpload(videoKey(id), row.upload_id);
    try {
      const object = await upload.complete(parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
      size = object.size;
    } catch (err) {
      // A bad etag or missing part. Retrying the same request cannot help.
      throw new HttpError(409, `R2 could not finish the upload: ${err.message}`);
    }
  } else {
    const object = await env.MEDIA.head(videoKey(id));
    if (!object) throw new HttpError(409, 'Nothing has been uploaded for this video yet');
    size = object.size;
  }
  // Store the size R2 actually holds, so the row always matches the file.
  await env.DB.prepare("UPDATE videos SET status = 'ready', upload_id = NULL, size = ? WHERE id = ?").bind(size, id).run();
  return json({ id, status: 'ready', size });
}

async function putThumb(request, env, id) {
  await getRow(env, id);
  const { body } = bodyStream(request, MAX_THUMB_BYTES);
  await env.MEDIA.put(thumbKey(id), body, { httpMetadata: { contentType: 'image/jpeg' } });
  return json({ ok: true });
}

async function deleteVideo(env, id) {
  const row = await getRow(env, id);
  if (row.upload_id) {
    // An unfinished multipart upload keeps its parts in R2 until aborted.
    try { await env.MEDIA.resumeMultipartUpload(videoKey(id), row.upload_id).abort(); } catch { /* already gone */ }
  }
  await env.MEDIA.delete([videoKey(id), thumbKey(id)]);
  await env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- Public: media and thumbnails ----------

// Parses a single "bytes=a-b" range into an R2 range. Multi-range and
// malformed headers return null, which means "send the whole file".
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (m[2] === '') return { offset };
  const end = Number(m[2]);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

async function streamMedia(request, env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Video not found');
  // Only finished videos are served: not half-uploaded ones, not deleted ones.
  const row = await env.DB.prepare('SELECT status FROM videos WHERE id = ?').bind(id).first();
  if (row?.status !== 'ready') throw new HttpError(404, 'Video not found');
  const key = videoKey(id);
  const headers = new Headers({
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    // Private and short, so a deleted video stops playing within the hour
    // and shared caches never keep a copy.
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    const head = await env.MEDIA.head(key);
    if (!head) throw new HttpError(404, 'Video not found');
    headers.set('content-length', String(head.size));
    headers.set('etag', head.httpEtag);
    return new Response(null, { headers });
  }

  const range = parseRange(request.headers.get('range'));
  let object;
  try {
    object = await env.MEDIA.get(key, range ? { range } : {});
  } catch {
    // R2 rejects ranges that start past the end of the file.
    const head = await env.MEDIA.head(key);
    if (!head) throw new HttpError(404, 'Video not found');
    throw new HttpError(416, 'Range not satisfiable', { 'content-range': `bytes */${head.size}` });
  }
  if (!object) throw new HttpError(404, 'Video not found');
  headers.set('etag', object.httpEtag);

  if (!range) {
    headers.set('content-length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  const size = object.size;
  let start, end;
  if ('suffix' in range) { start = Math.max(0, size - range.suffix); end = size - 1; }
  else { start = range.offset; end = range.length === undefined ? size - 1 : Math.min(size - 1, range.offset + range.length - 1); }
  if (start >= size || end < start) {
    await object.body?.cancel();
    throw new HttpError(416, 'Range not satisfiable', { 'content-range': `bytes */${size}` });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(object.body, { status: 206, headers });
}

async function getThumb(env, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Thumbnail not found');
  const row = await env.DB.prepare('SELECT status FROM videos WHERE id = ?').bind(id).first();
  if (!row || row.status !== 'ready') throw new HttpError(404, 'Thumbnail not found');
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
  if (!row || row.status !== 'ready') return htmlPage(notFoundHtml(), 404);

  const origin = escapeHtml(url.origin);
  const title = escapeHtml(row.title);
  const date = new Date(row.created_at);
  const isoDate = date.toISOString().slice(0, 10);
  const duration = fmtDuration(row.duration);
  const description = escapeHtml(`${duration} video, recorded ${isoDate}`);
  const fileName = escapeHtml((row.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'vignette') + '.mp4');
  const nonce = newId();
  const size = row.width && row.height
    ? `<meta property="og:video:width" content="${row.width}">\n<meta property="og:video:height" content="${row.height}">`
    : '';
  // Width and height give the player its shape before the video loads.
  const dims = row.width && row.height ? ` width="${row.width}" height="${row.height}"` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
${HEAD}
<title>${title}</title>
<meta property="og:title" content="${title}">
<meta property="og:type" content="video.other">
<meta property="og:url" content="${origin}/v/${id}">
<meta property="og:image" content="${origin}/thumb/${id}">
<meta property="og:video" content="${origin}/media/${id}">
<meta property="og:video:type" content="video/mp4">
${size}
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
${ICONS}
${TOP}
<main>
<section class="band on-band"><div class="wrap title-band">
<h1>${title}</h1>
<p class="runtime"><span class="vh">Runtime </span>${duration}</p>
</div></section>
<section class="well on-grey"><div class="wrap">
<div class="screen"><video controls playsinline preload="metadata"${dims} poster="/thumb/${id}" src="/media/${id}"></video></div>
<div class="share-row">
<div class="share-acts">
<button type="button" id="copy" class="act"><span class="sq">${glyph('copy')}</span><span class="act-label">Copy link</span></button>
<a class="act" href="/media/${id}" download="${fileName}"><span class="sq">${glyph('download')}</span><span class="act-label">Download</span></a>
</div>
<p class="facts"><time datetime="${date.toISOString()}">${isoDate}</time><span>${fmtSize(row.size)}</span></p>
</div>
<p id="copied" role="status"></p>
</div></section>
</main>
${FOOT}
<script nonce="${nonce}">
const t = document.querySelector('time');
t.textContent = new Date(t.dateTime).toLocaleDateString(undefined, { dateStyle: 'medium' });
const v = document.querySelector('video');
if (v.width && v.height) v.style.setProperty('--ar', v.width / v.height);
const label = document.querySelector('#copy .act-label');
document.getElementById('copy').addEventListener('click', async () => {
  const out = document.getElementById('copied');
  try { await navigator.clipboard.writeText(location.href); label.textContent = 'Copied'; out.textContent = 'Link copied. Paste it anywhere.'; }
  catch { out.textContent = 'Copy failed. Copy the address bar instead.'; }
  setTimeout(() => { label.textContent = 'Copy link'; }, 2000);
});
</script>
</body>
</html>`;
  return htmlPage(html, 200, nonce);
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en">
<head>${HEAD}<title>Video not found</title></head>
<body>${ICONS}${TOP}
<main class="wrap nf"><div class="msg" data-tone="error">${glyph('warning')}<div>
<h1>Video not found</h1>
<p>This link may be wrong, or the video was deleted. Ask the person who sent it for a new link.</p>
</div></div></main>
${FOOT}</body></html>`;
}

function htmlPage(html, status, nonce) {
  // The share page makes no external requests; the policy enforces that.
  // Styles and fonts come from this Worker's own static files.
  const base = "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const csp = nonce ? `${base}; media-src 'self'; script-src 'nonce-${nonce}'` : base;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': csp },
  });
}
