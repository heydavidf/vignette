// Edit and upload (steps 3 and 4). The Mediabunny helpers live in media.js,
// cuts in cuts.js, the two-track render in render.js. With a camera track,
// the edit step plays the screen and the camera side by side, the bubble is
// placed here (bubble.js), and every export renders it in.
import { uploadVideo, uploadOriginals } from './upload.js';
import { showGateAgain } from './auth.js';
import { say, busy, fmtTime } from './ui.js';
import { initCuts, keptRanges, totalLength } from './cuts.js';
import { repackage, probe, exportClip, grabFrame } from './media.js';
import { renderComposite, grabComposite } from './render.js';
import * as bubble from './bubble.js';
import { followScreen, heap } from './tracks.js';

const MIN_CLIP = 0.5; // seconds; the trim handles never get closer than this
const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), share: $('share'), editStep: $('editStep'), editMsg: $('editMsg'), editBody: $('editBody'), preview: $('preview'),
  clip: $('clip'), clipFrame: $('clipFrame'), editBubble: $('editBubble'), camPreview: $('camPreview'), bubbleTools: $('bubbleTools'),
  bubbleSet: $('bubbleSet'), bubbleNote: $('editBubbleHelp'), fullView: $('fullView'), stepSizes: $('sizes'), trimBox: $('trim'), trim: $('trim').querySelector('.trim-bar'),
  trimStart: $('trimStart'), trimEnd: $('trimEnd'), trimStartOut: $('trimStartOut'), trimEndOut: $('trimEndOut'),
  trimLength: $('trimLength'), setStart: $('setStart'), setEnd: $('setEnd'), title: $('title'),
  cutMarks: $('cutMarks'), cutFrom: $('cutFrom'), cutTo: $('cutTo'), cutMsg: $('cutMsg'), cutList: $('cutList'),
  thumbPlate: $('thumbPlate'), useFrame: $('useFrame'), thumbMsg: $('thumbMsg'),
  uploadStep: $('uploadStep'), upload: $('upload'), download: $('download'), downloadLink: $('downloadLink'),
  progress: $('progress'), progressPct: $('progressPct'), uploadMsg: $('uploadMsg'), retry: $('retry'), rawMsg: $('rawMsg'), retryRaw: $('retryRaw'),
  shareBox: $('shareBox'), shareUrl: $('shareUrl'), copy: $('copy'), copyLabel: $('copyLabel'), open: $('open'),
  uploadActs: $('uploadActs'), linkActs: $('linkActs'),
};

// Everything about the current recording. Exposed for the test.
export const editorState = {
  video: null,      // the screen, re-packaged: {blob, duration, width, height, videoCodec, audioCodec}
  camera: null,     // the camera, re-packaged, or null: {blob, duration, width, height, offset, lostAt, ...}
  exported: null,   // MP4 for the current handles, cuts and bubble: {key, blob, duration, width, height, bubble}
  failed: null,     // the export whose re-encode or render failed; it falls back until something changes
  thumb: null,      // {blob, time, chosen, look}
  job: null,        // upload progress record, reused by both Retry buttons
  keeping: false,   // the originals are being uploaded
  linked: false,    // uploaded: the link keeps this clip and bubble, so they stop changing
  unfollow: null,   // unhooks the camera preview from the screen preview
  note: () => {},
  urls: [],         // object URLs to release when the recording is discarded
};
const S = editorState;

// The thumbnail picture is made here, once there is a frame to show; until
// then its plate shows a frame pictogram.
ui.thumbImg = Object.assign(document.createElement('img'), { id: 'thumbImg', alt: 'Thumbnail' });
const plateGlyph = ui.thumbPlate.firstElementChild;

const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function objectUrl(blob) { const u = URL.createObjectURL(blob); S.urls.push(u); return u; }

// The bubble over the player: the same stored place as the recorder's.
const editView = bubble.attach({ el: ui.editBubble, video: ui.camPreview, frame: ui.clipFrame, sizes: document.querySelectorAll('input[name=editBubbleSize]') });
editView.setCam(true);

export function closeEditor() {
  S.unfollow?.();
  S.urls.forEach((u) => URL.revokeObjectURL(u));
  Object.assign(S, { video: null, camera: null, exported: null, failed: null, thumb: null, job: null, linked: false, unfollow: null, urls: [] });
  cutEd.reset();
  ui.stepSizes.hidden = false; // step 1's size strip is for the next recording again
  ui.preview.removeAttribute('src');
  ui.camPreview.removeAttribute('src');
  ui.thumbPlate.replaceChildren(plateGlyph);
  ui.editStep.hidden = ui.uploadStep.hidden = true;
}

// rec: what tracks.js recorded: {screen, camera, cameraOffset, cameraLostAt}.
export async function openEditor(rec, note) {
  closeEditor();
  S.note = note;
  ui.editStep.hidden = false;
  ui.editBody.hidden = true;
  say(ui.editMsg, 'Preparing your recording...', 'note');
  const t0 = performance.now();
  try {
    S.video = await repackage(rec.screen);
  } catch (err) {
    // Keep the raw file downloadable so the recording is never lost.
    const ext = rec.screen.type.includes('mp4') ? 'mp4' : 'webm';
    say(ui.editMsg, `Could not prepare the recording (${err.message}). `);
    const a = Object.assign(document.createElement('a'), { href: objectUrl(rec.screen), download: `recording.${ext}`, textContent: 'Download the raw recording' });
    ui.editMsg.append(a, ' so nothing is lost.');
    note('re-package', `failed: ${err.message}`);
    return;
  }
  if (rec.camera) {
    try {
      const cam = await repackage(rec.camera);
      if (!cam.width) throw new Error('it has no picture');
      S.camera = { ...cam, offset: rec.cameraOffset || 0, lostAt: rec.cameraLostAt };
    } catch (err) {
      note('camera', `could not be prepared (${err.message}); the video has no bubble`);
    }
  }
  const { duration, width, height, videoCodec, audioCodec } = S.video;
  note('re-package', `${((performance.now() - t0) / 1000).toFixed(1)} s, parsed duration ${duration.toFixed(2)} s`);
  note('tracks', `${videoCodec} ${width}x${height}, audio ${audioCodec || 'none'}`);
  if (S.camera) note('camera track', `${S.camera.videoCodec} ${S.camera.width}x${S.camera.height}, ${S.camera.duration.toFixed(2)} s`);

  showCamera(); // sets the player's controls (no own full screen with a camera) before the source loads
  ui.preview.src = objectUrl(S.video.blob);
  for (const r of [ui.trimStart, ui.trimEnd]) r.max = duration;
  ui.trimStart.value = 0;
  ui.trimEnd.value = duration;
  cutEd.reset();
  const now = new Date();
  ui.title.value = `Recording ${now.toLocaleDateString(undefined, { dateStyle: 'medium' })} ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  say(ui.editMsg, '');
  ui.editBody.hidden = false;
  ui.uploadStep.hidden = false;
  resetUploadUi();
  onTrim();
  ui.editStep.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// With a camera: the bubble over the player, playing the camera file in step
// with the screen, and its size strip. Without: the player alone.
// The video's own full screen and picture in picture would show the screen
// without the bubble, so with a camera they give way to the Full screen square.
function showCamera() {
  const on = !!S.camera;
  ui.clip.dataset.bubble = on ? 'on' : 'off';
  ui.editBubble.hidden = ui.bubbleTools.hidden = !on;
  ui.stepSizes.hidden = on; // this recording's size is chosen here, not in step 1
  ui.preview.disablePictureInPicture = on;
  ui.preview.setAttribute('controlslist', on ? 'nofullscreen nodownload' : 'nodownload');
  if (!on) return;
  editView.setFrame(S.video.width, S.video.height);
  ui.camPreview.src = objectUrl(S.camera.blob);
  S.unfollow = followScreen(ui.preview, ui.camPreview, S.camera.offset);
}

function getTrim() {
  return { start: +ui.trimStart.value, end: +ui.trimEnd.value };
}

// Keeps the handles apart, updates labels, and refreshes the default thumbnail.
function onTrim(which) {
  const duration = S.video.duration;
  let { start, end } = getTrim();
  if (end - start < MIN_CLIP) {
    if (which === 'end') end = Math.min(duration, start + MIN_CLIP);
    else start = Math.max(0, end - MIN_CLIP);
    ui.trimStart.value = start; ui.trimEnd.value = end;
    ({ start, end } = getTrim());
  }
  ui.trimStartOut.value = fmtTime(start);
  ui.trimEndOut.value = fmtTime(end);
  ui.trim.style.setProperty('--pa', (start / duration).toFixed(4)); // the kept stretch, drawn on the bar
  ui.trim.style.setProperty('--pb', (end / duration).toFixed(4));
  if (which === 'start') ui.preview.currentTime = start;
  if (which === 'end') ui.preview.currentTime = end;
  onClipChange();
}

// The clip length leaves out the cuts; the default thumbnail follows the first kept stretch.
function onClipChange() {
  const { start, end } = getTrim();
  ui.trimLength.textContent = `Clip length ${fmtTime(totalLength(keptRanges(start, end, cutEd.cuts)))}`;
  if (!S.thumb?.chosen) scheduleThumb();
}

const cutEd = initCuts({
  preview: ui.preview, marks: ui.cutMarks, list: ui.cutList, from: ui.cutFrom, to: ui.cutTo, msg: ui.cutMsg,
  getTrim, getDuration: () => S.video?.duration || 0, minClip: MIN_CLIP,
  onChange: () => { S.failed = null; onClipChange(); }, // changed cuts get a fresh re-encode
});

// ---------- Thumbnail ----------
// With a camera the thumbnail is the composite, so it follows the bubble.
let thumbTimer = null, thumbToken = 0;
const look = () => (S.camera ? JSON.stringify(bubble.get()) : '');
function defaultThumbTime() {
  const { start, end } = getTrim();
  const [first = { start, end }] = keptRanges(start, end, cutEd.cuts);
  return first.start + Math.min(1, (first.end - first.start) / 2);
}

// Refreshes the thumbnail shortly: the default one, or the chosen frame drawn again.
function scheduleThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const chosen = !!S.thumb?.chosen;
    setThumb(chosen ? S.thumb.time : defaultThumbTime(), chosen).catch(() => {});
  }, 300);
}
bubble.onChange(() => { if (S.video && S.camera) scheduleThumb(); });

async function setThumb(time, chosen) {
  const token = ++thumbToken; // only the newest request wins
  const seen = look();
  const blob = S.camera
    ? await grabComposite({ screen: S.video.blob, camera: S.camera.blob, cameraOffset: S.camera.offset, time, bubble: bubble.get() })
    : await grabFrame(S.video.blob, time);
  if (token !== thumbToken || !S.video) return S.thumb?.blob;
  S.thumb = { blob, time, chosen, look: seen };
  ui.thumbImg.src = objectUrl(blob);
  if (!ui.thumbImg.isConnected) ui.thumbPlate.replaceChildren(ui.thumbImg);
  say(ui.thumbMsg, chosen ? `Frame at ${fmtTime(time)}.` : 'Default: 1 second into the trimmed video.', 'note');
  return blob;
}

// The thumbnail to upload: the chosen frame, or the default for the final trim, as it looks now.
async function currentThumb() {
  clearTimeout(thumbTimer); // a pending refresh is done right here instead
  const chosen = !!S.thumb?.chosen;
  const time = chosen ? S.thumb.time : defaultThumbTime();
  if (S.thumb && Math.abs(S.thumb.time - time) < 0.001 && S.thumb.look === look()) return S.thumb.blob;
  return setThumb(time, chosen);
}

// ---------- Export (trim, cuts, bubble) ----------
// Returns the MP4 for the current handles, cuts and bubble, reusing the last
// export when nothing has changed. A re-encode or render shows its progress
// under Upload. If one fails, the next export falls back to the screen with
// the trim alone, until the cuts, the trim or the bubble change.
async function ensureExport() {
  const { start, end } = getTrim();
  const kept = keptRanges(start, end, cutEd.cuts);
  const keptKey = kept.map((r) => `${r.start.toFixed(3)}-${r.end.toFixed(3)}`).join(',');
  const place = S.camera ? bubble.get() : null;
  const attempt = place ? `${keptKey} bubble ${place.x.toFixed(4)},${place.y.toFixed(4)},${place.size}` : keptKey;
  const fallback = S.failed === attempt;
  const key = fallback ? `${keptKey} fallback` : attempt;
  if (S.exported?.key === key) return S.exported;
  const cuts = fallback ? [] : cutEd.cuts;
  const ranges = cuts.length ? kept : [{ start, end }];
  if (!ranges.length) throw new Error('the cuts take out the whole clip');
  const render = !!S.camera && !fallback;
  const reencode = ranges.length > 1;
  const full = !render && !reencode && ranges[0].start <= 0.001 && ranges[0].end >= S.video.duration - 0.001;
  const count = cutEd.countIn(start, end);
  const cutWord = `${count} cut${count === 1 ? '' : 's'}`;
  const onProgress = render || reencode ? setProgress : undefined;
  if (onProgress) {
    say(ui.uploadMsg, reencode ? `Re-encoding ${cutWord}...` : 'Rendering the video...', 'note');
    setProgress(0);
    ui.progress.hidden = false;
  }
  const t0 = performance.now();
  let blob;
  try {
    if (full) blob = S.video.blob;
    else if (render) blob = await renderComposite({ screen: S.video.blob, camera: S.camera.blob, cameraOffset: S.camera.offset, ranges, bubble: place, onProgress });
    else blob = await exportClip(S.video.blob, { start, end, cuts, onProgress });
  } catch (err) {
    if (onProgress) { S.failed = attempt; err.fallback = reencode ? 'cuts' : 'render'; }
    throw err;
  } finally {
    ui.progress.hidden = true;
  }
  const secs = (performance.now() - t0) / 1000;
  const { duration, width, height } = full ? S.video : await probe(blob);
  const length = totalLength(ranges);
  const speed = `${(length / secs).toFixed(1)} s of video per second`;
  let how = '';
  if (full) how = ' (no trim needed)';
  else if (render) how = `, rendered with the bubble${reencode ? ` and ${cutWord} taken out` : ''} at ${speed}`;
  else if (reencode) how = `, re-encoded ${cutWord} at ${speed}`;
  else if (fallback) how = ` (trim only, the ${S.camera ? 'render' : 're-encode'} failed)`;
  S.note('export', `${length.toFixed(1)} s clip, ${fmtMB(blob.size)}, ${secs.toFixed(1)} s${how}`);
  if (render) S.note('peak memory', `${heap.text()} while recording and rendering`);
  if (onProgress) say(ui.uploadMsg, '');
  S.exported = { key, blob, duration, width, height, bubble: render ? place : null };
  return S.exported;
}

// The error panel's words when preparing the video fails.
function prepareError(err, then) {
  if (err.fallback === 'cuts') {
    return `Could not re-encode the cuts (${err.message}). Upload and Download MP4 now use the trimmed video with the cut parts left in${S.camera ? ' and no webcam bubble' : ''}. Change or remove a cut to try again.`;
  }
  if (err.fallback === 'render') {
    return `Could not render the webcam bubble (${err.message}). Upload and Download MP4 now use the trimmed screen recording without it. Move the bubble or a trim handle to try again.`;
  }
  return `Could not prepare the video (${err.message}). ${then}`;
}

function fileName() {
  return (ui.title.value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'vignette') + '.mp4';
}

// ---------- Upload and download ----------
// While a file is being prepared or sent, Share stays disabled: a new share
// would discard this recording out from under the upload. `button` is the
// one doing the work; it shows the loading state. The bubble, its size and
// the trim and cuts are read once when a render starts, so they hold still
// until it is done, and for good once the link is made (the link keeps them).
function lock(on, button) {
  ui.upload.disabled = ui.download.disabled = ui.retry.disabled = on;
  ui.share.disabled = on || S.keeping;
  for (const b of [ui.upload, ui.download, ui.retry]) busy(b, on && b === button);
  for (const el of [ui.editBubble, ui.bubbleSet, ui.trimBox]) el.inert = on || S.linked;
  // The note under the player says why they hold still, or how to move the bubble when they do not.
  if (S.linked) ui.bubbleNote.textContent = 'The link keeps this clip and this bubble place. Record another to change them.';
  else if (on) ui.bubbleNote.textContent = `The clip and bubble hold still while the video renders${button === ui.download ? '' : ' and uploads'}.`;
  else ui.bubbleNote.textContent = PLACE_NOTE;
}
const PLACE_NOTE = ui.bubbleNote.textContent;

// The bar and its percent, in bold tabular numerals beside it.
function setProgress(fraction) {
  ui.progress.value = fraction;
  ui.progressPct.textContent = `${Math.floor(fraction * 100)}%`;
}

function resetUploadUi() {
  ui.uploadActs.append(ui.download); // back beside Upload (see below)
  ui.upload.hidden = false;
  lock(false);
  ui.retry.hidden = ui.retryRaw.hidden = ui.progress.hidden = ui.shareBox.hidden = true;
  say(ui.uploadMsg, '');
  say(ui.rawMsg, '');
}

async function upload(event) {
  lock(true, event?.currentTarget === ui.retry ? ui.retry : ui.upload);
  let stage = 'prepare', linked = false;
  try {
    say(ui.uploadMsg, 'Preparing the video...', 'note');
    const out = await ensureExport();
    if (S.job && S.job.size !== out.blob.size) S.job = null; // the trim changed since the failed try
    S.job ||= {};
    const thumb = await currentThumb().catch(() => null); // a missing thumbnail should not block the upload
    stage = 'upload';
    ui.retry.hidden = true;
    ui.progress.hidden = false;
    const t0 = performance.now();
    const { url } = await uploadVideo({
      blob: out.blob, title: ui.title.value.trim() || 'Untitled', duration: out.duration,
      width: out.width, height: out.height, thumb, job: S.job,
      cameraOffset: S.camera ? S.camera.offset : null, bubble: out.bubble,
      raw: S.camera ? { screen: S.video.blob, camera: S.camera.blob } : null,
      onProgress: (sent, total) => {
        setProgress(sent / total);
        say(ui.uploadMsg, `Uploading ${fmtMB(sent)} of ${fmtMB(total)}...`, 'note');
      },
    });
    S.note('upload', `${fmtMB(out.blob.size)} in ${((performance.now() - t0) / 1000).toFixed(1)} s${S.job.multipart ? `, ${Object.keys(S.job.parts).length} parts` : ''}`);
    ui.progress.hidden = true;
    ui.upload.hidden = true;
    say(ui.uploadMsg, 'Uploaded. Anyone with this link can watch.', 'note');
    ui.shareUrl.value = url;
    ui.open.href = url;
    // With the link made, Download MP4 joins Open and Record another in one row.
    ui.open.after(ui.download);
    ui.shareBox.hidden = false;
    linked = S.linked = true;
  } catch (err) {
    ui.progress.hidden = true;
    if (stage === 'prepare') {
      say(ui.uploadMsg, prepareError(err, 'Move a trim handle and try again, or use Download MP4.'));
    } else {
      if (err.status === 401) showGateAgain(ui.gate, 'The server did not accept the password. Enter it again, then click Retry upload.');
      const reason = err.status ? err.message : 'the connection to the server dropped'; // fetch() network errors say only "Failed to fetch"
      if (err.status === 413) {
        // Too big for this server: sending it again cannot work.
        say(ui.uploadMsg, `Upload failed: ${reason}. Trim it shorter, or use Download MP4.`);
      } else {
        say(ui.uploadMsg, `Upload failed: ${reason}. Your recording is safe here. Retry sends only what is missing.`);
        ui.retry.hidden = false;
      }
    }
  } finally {
    lock(false);
  }
  if (linked && S.job.raw) keepOriginals();
}

// After the link works: the screen and camera as recorded go up too, so a
// later version can render them again. A failure here never touches the
// link; it says so, and Retry sends only what is missing.
async function keepOriginals() {
  const job = S.job;
  S.keeping = true;
  ui.share.disabled = ui.retryRaw.disabled = true;
  busy(ui.retryRaw, true);
  const t0 = performance.now();
  try {
    const total = await uploadOriginals({
      job, files: { screen: S.video.blob, camera: S.camera.blob },
      onProgress: (sent, all) => say(ui.rawMsg, `Keeping the originals: ${fmtMB(sent)} of ${fmtMB(all)}...`, 'note'),
    });
    ui.retryRaw.hidden = true;
    say(ui.rawMsg, 'Originals kept: the screen and the camera as recorded are stored with the video.', 'note');
    S.note('originals kept', `${fmtMB(total)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (err) {
    if (err.status === 401) showGateAgain(ui.gate, 'The server did not accept the password. Enter it again, then click Retry.');
    const reason = err.status ? err.message : 'the connection to the server dropped';
    say(ui.rawMsg, `Originals not kept: the screen and camera files as recorded were not stored (${reason}). The link works without them. Retry sends only what is missing.`);
    ui.retryRaw.hidden = false;
    S.note('originals kept', `no: ${reason}`);
  } finally {
    S.keeping = false;
    busy(ui.retryRaw, false);
    ui.retryRaw.disabled = false;
    ui.share.disabled = ui.upload.disabled; // locked only while something else is still working
  }
}

async function download() {
  lock(true, ui.download);
  try {
    const out = await ensureExport();
    ui.downloadLink.href = objectUrl(out.blob);
    ui.downloadLink.download = fileName();
    ui.downloadLink.click();
  } catch (err) {
    say(ui.uploadMsg, prepareError(err, 'Move a trim handle and try again.'));
  } finally {
    lock(false);
  }
}

async function copyLink() {
  try { await navigator.clipboard.writeText(ui.shareUrl.value); } catch {
    ui.shareUrl.select(); document.execCommand('copy'); // older browsers
  }
  ui.copyLabel.textContent = 'Copied';
  setTimeout(() => { ui.copyLabel.textContent = 'Copy link'; }, 1500);
}

// ---------- Wire up ----------
ui.trimStart.addEventListener('input', () => onTrim('start'));
ui.trimEnd.addEventListener('input', () => onTrim('end'));
ui.setStart.addEventListener('click', () => { ui.trimStart.value = Math.min(ui.preview.currentTime, +ui.trimEnd.value - MIN_CLIP); onTrim('start'); });
ui.setEnd.addEventListener('click', () => { ui.trimEnd.value = Math.max(ui.preview.currentTime, +ui.trimStart.value + MIN_CLIP); onTrim('end'); });
ui.useFrame.addEventListener('click', () => setThumb(ui.preview.currentTime, true)
  .catch((err) => { say(ui.thumbMsg, `Could not grab that frame (${err.message}). Pause on another frame and try again.`); }));
ui.upload.addEventListener('click', upload);
ui.retry.addEventListener('click', upload);
ui.retryRaw.addEventListener('click', keepOriginals);
ui.download.addEventListener('click', download);
ui.copy.addEventListener('click', copyLink);
ui.fullView.hidden = !document.fullscreenEnabled;
ui.fullView.addEventListener('click', () => ui.clip.requestFullscreen().catch(() => {}));
