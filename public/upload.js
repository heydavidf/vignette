// Chunked upload client. Files up to 20 MiB go up in one request; bigger
// files go up as an R2 multipart upload, one 20 MiB part at a time.
//
// A recording is the rendered video, its thumbnail and, with a camera, the
// two originals (screen and camera as recorded). The video goes first and
// its completion makes the link work; the originals follow, through the
// same single-shot-or-multipart requests with ?track=screen or ?track=camera.
//
// Pass the same `job` object again after a failure and the upload resumes:
// steps and parts that already succeeded are skipped, so a retry only
// re-sends what failed.
import { api, getPassword } from './auth.js';

const RETRIES = 3; // per part or completion request, after the first attempt
const ORIGINALS = ['screen', 'camera'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries network errors and server errors with backoff (1 s, 2 s, 4 s).
// Client errors such as 401 are not retried: sending again would not help.
// Only idempotent steps use this (the bytes and the completion). Creating the
// record is never retried automatically: if its response is lost, a retry
// would leave a second, orphaned "uploading" row.
async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === undefined || err.status >= 500 || err.status === 408 || err.status === 429;
      if (!retryable || attempt >= RETRIES) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

// Sends one file's bytes and completes it. `file` is its progress record
// ({multipart, parts, uploaded, completed}); `track` is video, screen or camera.
// onProgress(sent) counts this file's bytes.
async function sendFile({ base, track, blob, file, partSize, password, onProgress }) {
  const total = blob.size;
  const q = track === 'video' ? '' : `?track=${track}`;
  const sentBytes = () => Object.keys(file.parts)
    .reduce((sum, n) => sum + Math.min(partSize, total - (n - 1) * partSize), 0);
  if (!file.uploaded) {
    if (!file.multipart) {
      onProgress(0);
      await withRetry(() => api(`${base}/blob${q}`, { method: 'PUT', password, body: blob, headers: { 'content-type': 'video/mp4' } }));
    } else {
      const count = Math.ceil(total / partSize);
      onProgress(sentBytes());
      for (let n = 1; n <= count; n++) {
        if (file.parts[n]) continue; // sent on an earlier attempt
        const chunk = blob.slice((n - 1) * partSize, n * partSize);
        const part = await withRetry(() => api(`${base}/parts/${n}${q}`, {
          method: 'PUT', password, body: chunk, headers: { 'content-type': 'application/octet-stream' },
        }));
        file.parts[n] = part.etag;
        onProgress(sentBytes());
      }
    }
    file.uploaded = true;
  }
  onProgress(total);
  if (!file.completed) {
    const parts = Object.entries(file.parts).map(([n, etag]) => ({ partNumber: Number(n), etag }));
    await withRetry(() => api(`${base}/complete${q}`, { method: 'POST', password, body: file.multipart ? { parts } : {} }));
    file.completed = true;
  }
}

/**
 * Uploads a finished MP4 and returns {id, url}. With `raw`, the row also
 * declares the two originals; send them afterwards with uploadOriginals.
 * @param {object} o
 * @param {Blob} o.blob        the MP4 to upload
 * @param {string} o.title
 * @param {number} o.duration  seconds
 * @param {number} [o.width]
 * @param {number} [o.height]
 * @param {Blob} [o.thumb]     JPEG thumbnail, optional
 * @param {number|null} [o.cameraOffset]  seconds the camera started after the screen
 * @param {object|null} [o.bubble]        {x, y, size} the video was rendered with
 * @param {{screen: Blob, camera: Blob}|null} [o.raw]  the originals, declared now, sent later
 * @param {string} [o.password]
 * @param {(sent: number, total: number) => void} [o.onProgress]
 * @param {object} [o.job]     progress record; reuse it to retry
 */
export async function uploadVideo({
  blob, title, duration, width, height, thumb, cameraOffset = null, bubble = null, raw = null,
  password = getPassword(), onProgress = () => {}, job = {},
}) {
  const total = blob.size;
  if (job.id && job.size !== total) throw new Error('This retry belongs to a different file. Start a new upload.');

  // 1. Create the video record (and the multipart uploads, for big files).
  if (!job.id) {
    const created = await api('/api/videos', {
      method: 'POST', password,
      body: {
        title, duration, size: total, mime: 'video/mp4', width, height, cameraOffset, bubble, layout: 'bubble',
        raw: raw ? { screen: raw.screen.size, camera: raw.camera.size } : null,
      },
    });
    const fresh = (multipart) => ({ multipart, parts: {}, uploaded: false, completed: false });
    Object.assign(job, {
      id: created.id, size: total, partSize: created.partSize, ...fresh(created.multipart), thumbDone: false,
      raw: created.raw ? Object.fromEntries(ORIGINALS.map((t) => [t, fresh(created.raw[t].multipart)])) : null,
    });
  }
  const base = `/api/videos/${job.id}`;

  // 2. Send the bytes, then 3. mark it ready (stitching the parts together, for big files).
  await sendFile({ base, track: 'video', blob, file: job, partSize: job.partSize, password, onProgress: (sent) => onProgress(sent, total) });

  // 4. Thumbnail for the share page and the library.
  if (thumb && !job.thumbDone) {
    await api(`${base}/thumb`, { method: 'PUT', password, body: thumb, headers: { 'content-type': 'image/jpeg' } });
    job.thumbDone = true;
  }

  return { id: job.id, url: `${location.origin}/v/${job.id}` };
}

/**
 * Sends the originals declared by uploadVideo: files.screen, then files.camera.
 * Resolves to the bytes sent in all; throws on failure, leaving `job` ready
 * for a retry that sends only what is missing.
 */
export async function uploadOriginals({ job, files, password = getPassword(), onProgress = () => {} }) {
  if (!job?.raw) throw new Error('This upload has no originals to send.');
  const total = ORIGINALS.reduce((sum, t) => sum + files[t].size, 0);
  let before = 0;
  for (const track of ORIGINALS) {
    const blob = files[track];
    await sendFile({
      base: `/api/videos/${job.id}`, track, blob, file: job.raw[track], partSize: job.partSize, password,
      onProgress: (sent) => onProgress(before + sent, total),
    });
    before += blob.size;
  }
  return total;
}
