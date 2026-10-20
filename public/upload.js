// Chunked upload client. Files up to 20 MiB go up in one request; bigger
// files go up as an R2 multipart upload, one 20 MiB part at a time.
//
// Pass the same `job` object again after a failure and the upload resumes:
// steps and parts that already succeeded are skipped, so a retry only
// re-sends what failed.
import { api, getPassword } from './auth.js';

const RETRIES = 3; // per part or completion request, after the first attempt
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

/**
 * Uploads a finished MP4 and returns {id, url}.
 * @param {object} o
 * @param {Blob} o.blob        the MP4 to upload
 * @param {string} o.title
 * @param {number} o.duration  seconds
 * @param {number} [o.width]
 * @param {number} [o.height]
 * @param {Blob} [o.thumb]     JPEG thumbnail, optional
 * @param {string} [o.password]
 * @param {(sent: number, total: number) => void} [o.onProgress]
 * @param {object} [o.job]     progress record; reuse it to retry
 */
export async function uploadVideo({
  blob, title, duration, width, height, thumb,
  password = getPassword(), onProgress = () => {}, job = {},
}) {
  const total = blob.size;
  if (job.id && job.size !== total) throw new Error('This retry belongs to a different file. Start a new upload.');

  // 1. Create the video record (and the multipart upload, for big files).
  if (!job.id) {
    const created = await api('/api/videos', {
      method: 'POST', password,
      body: { title, duration, size: total, mime: 'video/mp4', width, height },
    });
    Object.assign(job, {
      id: created.id, size: total, multipart: created.multipart, partSize: created.partSize,
      parts: {}, uploaded: false, completed: false, thumbDone: false,
    });
  }
  const base = `/api/videos/${job.id}`;
  const sentBytes = () => Object.keys(job.parts)
    .reduce((sum, n) => sum + Math.min(job.partSize, total - (n - 1) * job.partSize), 0);

  // 2. Send the bytes.
  if (!job.uploaded) {
    if (!job.multipart) {
      onProgress(0, total);
      await withRetry(() => api(`${base}/blob`, { method: 'PUT', password, body: blob, headers: { 'content-type': 'video/mp4' } }));
    } else {
      const count = Math.ceil(total / job.partSize);
      onProgress(sentBytes(), total);
      for (let n = 1; n <= count; n++) {
        if (job.parts[n]) continue; // sent on an earlier attempt
        const chunk = blob.slice((n - 1) * job.partSize, n * job.partSize);
        const part = await withRetry(() => api(`${base}/parts/${n}`, {
          method: 'PUT', password, body: chunk, headers: { 'content-type': 'application/octet-stream' },
        }));
        job.parts[n] = part.etag;
        onProgress(sentBytes(), total);
      }
    }
    job.uploaded = true;
  }
  onProgress(total, total);

  // 3. Mark it ready (and stitch the parts together, for big files).
  if (!job.completed) {
    const parts = Object.entries(job.parts).map(([n, etag]) => ({ partNumber: Number(n), etag }));
    await withRetry(() => api(`${base}/complete`, { method: 'POST', password, body: job.multipart ? { parts } : {} }));
    job.completed = true;
  }

  // 4. Thumbnail for the share page and the library.
  if (thumb && !job.thumbDone) {
    await api(`${base}/thumb`, { method: 'PUT', password, body: thumb, headers: { 'content-type': 'image/jpeg' } });
    job.thumbDone = true;
  }

  return { id: job.id, url: `${location.origin}/v/${job.id}` };
}
