// Edit and upload (steps 3 and 4). The Mediabunny helpers live in media.js,
// cuts in cuts.js, the layouts in layouts.js and layout-tools.js, the render
// in render.js. With a camera track, the edit step plays the screen and the
// camera side by side; the layout is chosen here, and so is the bubble's
// place (bubble.js). Every layout but Screen only renders at export; Screen
// only keeps the trim's copy path. An uploaded recording can come back here
// from the library to be rendered again (again mode): its upload replaces
// the video under the same link.
import { uploadVideo, uploadOriginals } from './upload.js';
import { showGateAgain } from './auth.js';
import { say, busy, fmtTime } from './ui.js';
import { initCuts, keptRanges, totalLength } from './cuts.js';
import { repackage, probe, exportClip, grabFrame } from './media.js';
import { renderLayout, grabLayout } from './render.js';
import * as bubble from './bubble.js';
import { followScreen, heap } from './tracks.js';
import { attachLayoutTools } from './layout-tools.js';

const MIN_CLIP = 0.5; // seconds; the trim handles never get closer than this
const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), share: $('share'), editStep: $('editStep'), editMsg: $('editMsg'), editBody: $('editBody'), preview: $('preview'),
  clip: $('clip'), clipFrame: $('clipFrame'), editBubble: $('editBubble'), camPreview: $('camPreview'), bubbleTools: $('bubbleTools'),
  bubbleSet: $('bubbleSet'), bubbleNote: $('editBubbleHelp'), fullView: $('fullView'), stepSizes: $('sizes'), trimBox: $('trim'), trim: $('trim').querySelector('.trim-bar'),
  layoutSet: $('layoutSet'), colourSet: $('colourSet'), uploadLabel: $('uploadLabel'),
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
  exported: null,   // MP4 for the current handles, cuts and layout: {key, blob, duration, width, height, bubble, layout}
  failed: null,     // the export whose re-encode or render failed; it falls back until something changes
  thumb: null,      // {blob, time, chosen, look}
  job: null,        // upload progress record, reused by both Retry buttons
  keeping: false,   // the originals are being uploaded
  linked: false,    // uploaded: the link keeps this clip and layout, so they stop changing
  again: null,      // rendering an uploaded recording again: its id (the upload replaces its video), or null
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

// The bubble over the player: the same stored place as the recorder's, plus its shape.
const editView = bubble.attach({
  el: ui.editBubble, video: ui.camPreview, frame: ui.clipFrame,
  sizes: document.querySelectorAll('input[name=editBubbleSize]'), shapes: document.querySelectorAll('input[name=editBubbleShape]'),
});
editView.setCam(true);
// The Layout strip, the padded colour and the preview of both.
export const layout = attachLayoutTools({
  clip: ui.clip, preview: ui.preview, editBubble: ui.editBubble, bubbleTools: ui.bubbleTools, colourSet: ui.colourSet, fullView: ui.fullView,
  layouts: document.querySelectorAll('input[name=layout]'), colours: document.querySelectorAll('input[name=padColour]'),
});
const UPLOAD_LABEL = ui.uploadLabel.textContent;

export function closeEditor() {
  S.unfollow?.();
  S.urls.forEach((u) => URL.revokeObjectURL(u));
  Object.assign(S, { video: null, camera: null, exported: null, failed: null, thumb: null, job: null, linked: false, again: null, unfollow: null, urls: [] });
  ui.uploadLabel.textContent = UPLOAD_LABEL;
  cutEd.reset();
  ui.stepSizes.hidden = false; // step 1's size strip is for the next recording again
  ui.preview.removeAttribute('src');
  ui.camPreview.removeAttribute('src');
  ui.thumbPlate.replaceChildren(plateGlyph);
  ui.editStep.hidden = ui.uploadStep.hidden = true;
}

// rec: what tracks.js recorded: {screen, camera, cameraOffset, cameraLostAt}.
// again: an uploaded recording to render again ({id, title, layout, colour,
// bubble}), whose originals are rec; they were re-packaged before they were
// kept, so they are only measured here.
export async function openEditor(rec, note, again = null) {
  closeEditor();
  S.note = note;
  S.again = again?.id || null;
  ui.editStep.hidden = false;
  ui.editBody.hidden = true;
  say(ui.editMsg, again ? 'Preparing the originals...' : 'Preparing your recording...', 'note');
  const prepare = async (blob) => (again ? { blob, ...(await probe(blob)) } : repackage(blob));
  const t0 = performance.now();
  try {
    S.video = await prepare(rec.screen);
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
      const cam = await prepare(rec.camera);
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

  // Where it was, as uploaded; a place stored before shapes existed is round.
  if (again?.bubble) bubble.set({ shape: 'round', ...again.bubble }, { save: false, w: width, h: height });
  showCamera();
  layout.open({ width, height }, S.camera && { width: S.camera.width, height: S.camera.height }, again && { id: again.layout, colour: again.colour });
  ui.preview.src = objectUrl(S.video.blob); // after the layout has set the player's controls
  for (const r of [ui.trimStart, ui.trimEnd]) r.max = duration;
  ui.trimStart.value = 0;
  ui.trimEnd.value = duration;
  cutEd.reset();
  const now = new Date();
  ui.title.value = again ? again.title : `Recording ${now.toLocaleDateString(undefined, { dateStyle: 'medium' })} ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (again) ui.uploadLabel.textContent = 'Upload and replace';
  say(ui.editMsg, '');
  ui.editBody.hidden = false;
  ui.uploadStep.hidden = false;
  resetUploadUi();
  onTrim();
  ui.editStep.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// With a camera: the camera file plays in the camera's place (the bubble, or
// its box in Split and Camera only), in step with the screen; the layout
// tools show or hide it. Without: the player alone.
function showCamera() {
  const on = !!S.camera;
  ui.stepSizes.hidden = on; // this recording's size is chosen here, not in step 1
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
// The thumbnail is drawn in the layout, so it follows the layout, the colour and the bubble.
let thumbTimer = null, thumbToken = 0;
function look() {
  const { id, value } = layout.get();
  return id === 'bubble' ? `${value} ${JSON.stringify(bubble.get())}` : value;
}
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
bubble.onChange(() => { if (S.video && S.camera && layout.get().id === 'bubble') scheduleThumb(); });
layout.onChange(() => { if (S.video) scheduleThumb(); });

async function setThumb(time, chosen) {
  const token = ++thumbToken; // only the newest request wins
  const seen = look();
  const { id, colour } = layout.get();
  const blob = id === 'screen'
    ? await grabFrame(S.video.blob, time)
    : await grabLayout({ screen: S.video.blob, camera: S.camera?.blob, cameraOffset: S.camera?.offset, time, layout: id, bubble: bubble.get(), colour });
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

// ---------- Export (trim, cuts, layout) ----------
// Returns the MP4 for the current handles, cuts and layout, reusing the last
// export when nothing has changed. Screen only keeps the trim's copy path
// (cuts re-encode); every other layout renders. A re-encode or render shows
// its progress under Upload. If one fails, the next export falls back to the
// screen with the trim alone, until the cuts, the trim or the layout change.
async function ensureExport() {
  const { start, end } = getTrim();
  const kept = keptRanges(start, end, cutEd.cuts);
  const keptKey = kept.map((r) => `${r.start.toFixed(3)}-${r.end.toFixed(3)}`).join(',');
  const lay = layout.get();
  const place = S.camera ? bubble.get() : null;
  const looks = lay.id === 'bubble' ? `bubble ${place.x.toFixed(4)},${place.y.toFixed(4)},${place.size},${place.shape}` : lay.value;
  const attempt = `${keptKey} ${looks}`;
  const fallback = S.failed === attempt;
  const key = fallback ? `${keptKey} fallback` : attempt;
  if (S.exported?.key === key) return S.exported;
  const cuts = fallback ? [] : cutEd.cuts;
  const ranges = cuts.length ? kept : [{ start, end }];
  if (!ranges.length) throw new Error('the cuts take out the whole clip');
  const render = lay.id !== 'screen' && !fallback;
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
    else if (render) {
      blob = await renderLayout({
        screen: S.video.blob, camera: S.camera?.blob, cameraOffset: S.camera?.offset, ranges, layout: lay.id, bubble: place, colour: lay.colour, onProgress,
      });
    } else blob = await exportClip(S.video.blob, { start, end, cuts, onProgress });
  } catch (err) {
    if (onProgress) { S.failed = attempt; err.fallback = reencode ? 'cuts' : 'render'; err.layout = lay; }
    throw err;
  } finally {
    ui.progress.hidden = true;
  }
  const secs = (performance.now() - t0) / 1000;
  const { duration, width, height } = full ? S.video : await probe(blob);
  const length = totalLength(ranges);
  const speed = `${(length / secs).toFixed(1)} s of video per second`;
  const as = lay.id === 'bubble' ? 'with the bubble' : `as ${lay.label}${lay.id === 'padded' ? ` on ${lay.colour}` : ''}`;
  let how = '';
  if (full) how = ' (no trim needed)';
  else if (render) how = `, rendered ${as}${reencode ? ` and ${cutWord} taken out` : ''} at ${speed}`;
  else if (reencode) how = `, re-encoded ${cutWord} at ${speed}`;
  else if (fallback) how = ` (trim only, the ${lay.id === 'screen' ? 're-encode' : 'render'} failed)`;
  else how = ', trim only, copied as recorded';
  S.note('export', `${length.toFixed(1)} s clip, ${fmtMB(blob.size)}, ${secs.toFixed(1)} s${how}`);
  S.note('layout', render ? `${lay.label}${lay.id === 'padded' ? ` on ${lay.colour}` : ''}, ${width}x${height}, rendered at ${speed}`
    : `${fallback ? 'Screen only (the render failed)' : 'Screen only'}, ${width}x${height}, not rendered`);
  if (render) S.note('peak memory', `${heap.text()} while recording and rendering`);
  if (onProgress) say(ui.uploadMsg, '');
  S.exported = { key, blob, duration, width, height, bubble: place, layout: render ? lay.value : 'screen' };
  return S.exported;
}

// The error panel's words when preparing the video fails.
function prepareError(err, then) {
  const bubbleOn = err.layout?.id === 'bubble';
  if (err.fallback === 'cuts') {
    const without = err.layout && err.layout.id !== 'screen' ? (bubbleOn ? ' and no webcam bubble' : ` and not as ${err.layout.label}`) : '';
    return `Could not re-encode the cuts (${err.message}). Upload and Download MP4 now use the trimmed video with the cut parts left in${without}. Change or remove a cut to try again.`;
  }
  if (err.fallback === 'render') {
    return bubbleOn
      ? `Could not render the webcam bubble (${err.message}). Upload and Download MP4 now use the trimmed screen recording without it. Move the bubble or a trim handle to try again.`
      : `Could not render the ${err.layout.label} layout (${err.message}). Upload and Download MP4 now use the trimmed screen recording. Change the layout or a trim handle to try again.`;
  }
  return `Could not prepare the video (${err.message}). ${then}`;
}

function fileName() {
  return (ui.title.value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'vignette') + '.mp4';
}

// ---------- Upload and download ----------
// While a file is being prepared or sent, Share stays disabled: a new share
// would discard this recording out from under the upload. `button` is the
// one doing the work; it shows the loading state. The layout, the bubble and
// the trim and cuts are read once when a render starts, so they hold still
// until it is done, and for good once the link is made (the link keeps them).
let locked = [false];
function lock(on, button) {
  locked = [on, button];
  ui.upload.disabled = ui.download.disabled = ui.retry.disabled = on;
  ui.share.disabled = on || S.keeping;
  for (const b of [ui.upload, ui.download, ui.retry]) busy(b, on && b === button);
  const held = on || S.linked, inBubble = layout.get().id === 'bubble';
  for (const el of [ui.layoutSet, ui.colourSet, ui.bubbleSet, ui.trimBox]) el.inert = held;
  ui.editBubble.inert = held || !inBubble; // in Split and Camera only the camera's box is not moved by hand
  // The note under the tools says why they hold still, or how to move the bubble when they do not.
  const what = inBubble ? 'bubble' : 'layout';
  let text = inBubble ? PLACE_NOTE : '';
  if (S.linked) text = `The link keeps this clip and this ${inBubble ? 'bubble place' : 'layout'}. Record another to change them.`;
  else if (on) text = `The clip and ${what} hold still while the video renders${button === ui.download ? '' : ' and uploads'}.`;
  ui.bubbleNote.textContent = text;
  ui.bubbleNote.hidden = !text;
}
const PLACE_NOTE = ui.bubbleNote.textContent;
layout.onChange(() => lock(...locked)); // the note and the bubble follow the layout

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
      cameraOffset: S.camera ? S.camera.offset : null, bubble: out.bubble, layout: out.layout, again: S.again,
      raw: S.camera && !S.again ? { screen: S.video.blob, camera: S.camera.blob } : null, // rendered again: the originals are kept already
      onProgress: (sent, total) => {
        setProgress(sent / total);
        say(ui.uploadMsg, `Uploading ${fmtMB(sent)} of ${fmtMB(total)}...`, 'note');
      },
    });
    S.note('upload', `${fmtMB(out.blob.size)} in ${((performance.now() - t0) / 1000).toFixed(1)} s${S.job.multipart ? `, ${Object.keys(S.job.parts).length} parts` : ''}`);
    ui.progress.hidden = true;
    ui.upload.hidden = true;
    say(ui.uploadMsg, S.again ? 'Uploaded. The same link now plays this version.' : 'Uploaded. Anyone with this link can watch.', 'note');
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
