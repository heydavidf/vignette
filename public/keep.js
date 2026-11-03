// After the link works: the screen and camera as recorded go up too, so a
// later version can render them again (the library's Change layout). A
// failure here never touches the link; it says so, and Retry sends only
// what is missing. The phone version, which goes up just before, is phone.js's.
import { uploadOriginals } from './upload.js';
import { showGateAgain } from './auth.js';
import { say, busy } from './ui.js';

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * @param {object} o
 * @param {object} o.S       the editor's state (video, camera, note)
 * @param {Element} o.gate   the password gate, for a 401
 * @param {Element} o.msg    the originals' message (#rawMsg)
 * @param {Element} o.retry  their Retry (#retryRaw)
 * @param {(on: boolean) => void} o.onKeeping  the upload starts or stops
 * @returns {(job: object) => Promise<void>}  sends the originals the job declared
 */
export function attachOriginals({ S, gate, msg, retry, onKeeping }) {
  return async function keepOriginals(job) {
    onKeeping(true);
    retry.disabled = true;
    busy(retry, true);
    const t0 = performance.now();
    try {
      const total = await uploadOriginals({
        job, files: { screen: S.video.blob, camera: S.camera.blob },
        onProgress: (sent, all) => say(msg, `Keeping the originals: ${fmtMB(sent)} of ${fmtMB(all)}...`, 'note'),
      });
      retry.hidden = true;
      say(msg, 'Originals kept: the screen and the camera as recorded are stored with the video.', 'note');
      S.note('originals kept', `${fmtMB(total)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      if (err.status === 401) showGateAgain(gate, 'The server did not accept the password. Enter it again, then click Retry.');
      const reason = err.status ? err.message : 'the connection to the server dropped';
      say(msg, `Originals not kept: the screen and camera files as recorded were not stored (${reason}). The link works without them. Retry sends only what is missing.`);
      retry.hidden = false;
      S.note('originals kept', `no: ${reason}`);
    } finally {
      busy(retry, false);
      retry.disabled = false;
      onKeeping(false); // Share is locked only while something else is still working
    }
  };
}
