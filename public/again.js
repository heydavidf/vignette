// Rendering an uploaded recording again (the library's Change layout links
// to /?again=<id>): the recording's row and its two originals, the screen
// and the camera as recorded, are fetched with the owner password, and
// recorder.js opens the edit step with them as after a recording. The
// upload then replaces the video under the same link (editor.js, upload.js).
// The test hooks are listed at the top of layouts.js.
import { api, getPassword, ApiError } from './auth.js';

export const hooks = { state: 'off', id: null, progress: { sent: 0, total: 0 }, error: '' };

// The ?again= value: {id} when it is a recording id, {id: null} when it is
// something else, or null when the page was opened without one.
export function againParam() {
  const value = new URLSearchParams(location.search).get('again');
  if (value === null) return null;
  return { id: /^[a-z0-9]{16}$/.test(value) ? value : null };
}

// Why it cannot be rendered again, in the band's words, with err.status kept for a 401.
export class AgainError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * Fetches the row, then both originals side by side.
 * @param {string} id
 * @param {{onProgress: (sent: number, total: number) => void, signal: AbortSignal}} o
 * @returns {Promise<{row: object, screen: Blob, camera: Blob}>}
 */
export async function loadAgain(id, { onProgress, signal }) {
  let row;
  try {
    row = await api(`/api/videos/${id}`);
  } catch (err) {
    if (err.status === 404) throw new AgainError('That recording is not in your library. It may have been deleted.', 404);
    throw err;
  }
  if (!row.has_raw) throw new AgainError(`"${row.title}" has no originals kept, so its layout cannot be changed.`, 409);
  if (row.again) throw new AgainError(`"${row.title}" is being rendered again already. Wait until that upload finishes, then try again.`, 409);
  const headers = { authorization: `Bearer ${encodeURIComponent(getPassword())}` };
  const responses = await Promise.all(['screen', 'camera'].map((track) => fetch(`/api/videos/${id}/raw/${track}`, { headers, signal })));
  for (const res of responses) {
    if (res.ok) continue;
    const data = await res.json().catch(() => null);
    if (res.status === 404) throw new AgainError(`The originals of "${row.title}" are missing, so its layout cannot be changed.`, 404);
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  const sizes = responses.map((res) => Number(res.headers.get('content-length')) || 0);
  const total = sizes[0] + sizes[1];
  let sent = 0;
  onProgress(0, total);
  const blobs = await Promise.all(responses.map(async (res, i) => {
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      sent += value.length;
      onProgress(sent, total);
    }
    if (sizes[i] && got !== sizes[i]) throw new Error(`the download stopped at ${got} of ${sizes[i]} bytes`);
    return new Blob(chunks, { type: 'video/mp4' });
  }));
  return { row, screen: blobs[0], camera: blobs[1] };
}
