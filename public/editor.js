// Edit and upload (steps 3 and 4), plus the Mediabunny helpers they use:
// re-package, trim, export, measure, and grab thumbnails. Cuts live in cuts.js.
// MediaRecorder writes a wrong duration header (0.16 s for a 4 s clip in
// Chrome), so every recording is re-packaged here before preview or upload.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, CanvasSink,
} from './vendor/mediabunny-1.61.6.min.mjs';
import { uploadVideo } from './upload.js';
import { showGateAgain } from './auth.js';
import { say, busy, fmtTime } from './ui.js';
import { initCuts, keptRanges, totalLength, reencodeRanges } from './cuts.js';

// ---------- Mediabunny helpers ----------

const openInput = (blob) => new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

// Converts `blob` to a fast-start MP4, optionally keeping only start..end
// seconds. Streams are copied where possible; Mediabunny re-encodes only
// what it must (for example, when a trim does not start on a keyframe).
async function convert(blob, trim, onProgress) {
  const input = openInput(blob);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init(trim ? { input, output, trim } : { input, output });
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
    throw new Error(`This recording cannot be converted to MP4 (${reasons || 'unknown reason'}).`);
  }
  if (onProgress) conversion.onProgress = onProgress;
  await conversion.execute();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
}

// Reads duration, picture size and codecs from a media file.
export async function probe(blob) {
  const input = openInput(blob);
  const duration = await input.computeDuration();
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  return {
    duration,
    width: video ? video.displayWidth : null,
    height: video ? video.displayHeight : null,
    videoCodec: video ? await video.getCodecParameterString() : null,
    audioCodec: audio ? await audio.getCodecParameterString() : null,
  };
}

// Re-packages a raw MediaRecorder file into a seekable MP4 with a correct
// duration. Returns {blob, ...probe(blob)}.
export async function repackage(rawBlob, onProgress) {
  const blob = await convert(rawBlob, null, onProgress);
  return { blob, ...(await probe(blob)) };
}

// Keeps only start..end seconds of an MP4.
export function trimVideo(blob, start, end, onProgress) {
  return convert(blob, { start, end }, onProgress);
}

// Keeps start..end of an MP4 without the cut stretches. With nothing cut
// out of the middle this is the trim copy path; otherwise the kept
// stretches are re-encoded back to back (see cuts.js).
export async function exportClip(blob, { start, end, cuts = [], onProgress }) {
  const kept = keptRanges(start, end, cuts);
  if (!kept.length) throw new Error('the cuts take out the whole clip');
  if (kept.length === 1) return trimVideo(blob, kept[0].start, kept[0].end, onProgress);
  return reencodeRanges(blob, kept, onProgress);
}

// Returns a JPEG of the frame at `time` seconds, `width` pixels wide.
export async function grabFrame(blob, time, width = 640) {
  const input = openInput(blob);
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track to take a thumbnail from.');
  const sink = new CanvasSink(track, { width });
  // getCanvas returns null when there is no frame at that time; fall back to the first frame.
  const frame = (await sink.getCanvas(Math.max(0, time))) || (await sink.getCanvas(0));
  if (!frame) throw new Error('Could not decode a frame for the thumbnail.');
  const { canvas } = frame;
  // Mediabunny hands back an HTMLCanvasElement in pages and an OffscreenCanvas in workers.
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('Could not encode the thumbnail.'))), 'image/jpeg', 0.82,
  ));
}

// ---------- Step 3: edit, then upload ----------
const MIN_CLIP = 0.5; // seconds; the trim handles never get closer than this
const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), share: $('share'), editStep: $('editStep'), editMsg: $('editMsg'), editBody: $('editBody'), preview: $('preview'),
  trim: $('trim').querySelector('.trim-bar'),
  trimStart: $('trimStart'), trimEnd: $('trimEnd'), trimStartOut: $('trimStartOut'), trimEndOut: $('trimEndOut'),
  trimLength: $('trimLength'), setStart: $('setStart'), setEnd: $('setEnd'), title: $('title'),
  cutMarks: $('cutMarks'), cutFrom: $('cutFrom'), cutTo: $('cutTo'), cutMsg: $('cutMsg'), cutList: $('cutList'),
  thumbPlate: $('thumbPlate'), useFrame: $('useFrame'), thumbMsg: $('thumbMsg'),
  uploadStep: $('uploadStep'), upload: $('upload'), download: $('download'), downloadLink: $('downloadLink'),
  progress: $('progress'), uploadMsg: $('uploadMsg'), retry: $('retry'),
  shareBox: $('shareBox'), shareUrl: $('shareUrl'), copy: $('copy'), copyLabel: $('copyLabel'), open: $('open'),
  uploadActs: $('uploadActs'), linkActs: $('linkActs'),
};

// Everything about the current recording. Exposed for the test.
export const editorState = {
  video: null,      // re-packaged MP4: {blob, duration, width, height, videoCodec, audioCodec}
  exported: null,   // MP4 for the current handles and cuts: {key, blob, duration}
  cutsFailed: null, // kept ranges whose re-encode failed; exports keep the cut parts until the cuts change
  thumb: null,      // {blob, time, chosen}
  job: null,        // upload progress record, reused by Retry
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

export function closeEditor() {
  S.urls.forEach((u) => URL.revokeObjectURL(u));
  Object.assign(S, { video: null, exported: null, cutsFailed: null, thumb: null, job: null, urls: [] });
  cutEd.reset();
  ui.preview.removeAttribute('src');
  ui.thumbPlate.replaceChildren(plateGlyph);
  ui.editStep.hidden = ui.uploadStep.hidden = true;
}

export async function openEditor(raw, note) {
  closeEditor();
  S.note = note;
  ui.editStep.hidden = false;
  ui.editBody.hidden = true;
  say(ui.editMsg, 'Preparing your recording...', 'note');
  const t0 = performance.now();
  try {
    S.video = await repackage(raw);
  } catch (err) {
    // Keep the raw file downloadable so the recording is never lost.
    const ext = raw.type.includes('mp4') ? 'mp4' : 'webm';
    say(ui.editMsg, `Could not prepare the recording (${err.message}). `);
    const a = Object.assign(document.createElement('a'), { href: objectUrl(raw), download: `recording.${ext}`, textContent: 'Download the raw recording' });
    ui.editMsg.append(a, ' so nothing is lost.');
    note('re-package', `failed: ${err.message}`);
    return;
  }
  const { duration, width, height, videoCodec, audioCodec } = S.video;
  note('re-package', `${((performance.now() - t0) / 1000).toFixed(1)} s, parsed duration ${duration.toFixed(2)} s`);
  note('tracks', `${videoCodec} ${width}x${height}, audio ${audioCodec || 'none'}`);

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
  if (!S.thumb?.chosen) scheduleDefaultThumb();
}

const cutEd = initCuts({
  preview: ui.preview, marks: ui.cutMarks, list: ui.cutList, from: ui.cutFrom, to: ui.cutTo, msg: ui.cutMsg,
  getTrim, getDuration: () => S.video?.duration || 0, minClip: MIN_CLIP,
  onChange: () => { S.cutsFailed = null; onClipChange(); }, // changed cuts get a fresh re-encode
});

// ---------- Thumbnail ----------
let thumbTimer = null, thumbToken = 0;
function defaultThumbTime() {
  const { start, end } = getTrim();
  const [first = { start, end }] = keptRanges(start, end, cutEd.cuts);
  return first.start + Math.min(1, (first.end - first.start) / 2);
}

function scheduleDefaultThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => setThumb(defaultThumbTime(), false).catch(() => {}), 300);
}

async function setThumb(time, chosen) {
  const token = ++thumbToken; // only the newest request wins
  const blob = await grabFrame(S.video.blob, time);
  if (token !== thumbToken || !S.video) return S.thumb?.blob;
  S.thumb = { blob, time, chosen };
  ui.thumbImg.src = objectUrl(blob);
  if (!ui.thumbImg.isConnected) ui.thumbPlate.replaceChildren(ui.thumbImg);
  say(ui.thumbMsg, chosen ? `Frame at ${fmtTime(time)}.` : 'Default: 1 second into the trimmed video.', 'note');
  return blob;
}

// The thumbnail to upload: the chosen frame, or the default for the final trim.
async function currentThumb() {
  clearTimeout(thumbTimer); // a pending default refresh is done right here instead
  if (S.thumb?.chosen) return S.thumb.blob;
  const time = defaultThumbTime();
  if (S.thumb && Math.abs(S.thumb.time - time) < 0.001) return S.thumb.blob;
  return setThumb(time, false);
}

// ---------- Export (trim and cuts) ----------
// Returns the MP4 for the current handles and cuts, reusing the last export
// when nothing has changed. A re-encode shows its progress under Upload.
async function ensureExport() {
  const { start, end } = getTrim();
  const kept = keptRanges(start, end, cutEd.cuts);
  const keptKey = kept.map((r) => `${r.start.toFixed(3)}-${r.end.toFixed(3)}`).join(',');
  // After a failed re-encode these cuts fall back to the trim alone, until the cuts change.
  const trimOnly = S.cutsFailed === keptKey;
  const key = trimOnly ? `${keptKey} trim only` : keptKey;
  if (S.exported?.key === key) return S.exported;
  const cuts = trimOnly ? [] : cutEd.cuts;
  const ranges = cuts.length ? kept : [{ start, end }];
  if (!ranges.length) throw new Error('the cuts take out the whole clip');
  const reencode = ranges.length > 1;
  const full = !reencode && ranges[0].start <= 0.001 && ranges[0].end >= S.video.duration - 0.001;
  const count = cutEd.countIn(start, end);
  const cutWord = `${count} cut${count === 1 ? '' : 's'}`;
  if (reencode) {
    say(ui.uploadMsg, `Re-encoding ${cutWord}...`, 'note');
    ui.progress.value = 0;
    ui.progress.hidden = false;
  }
  const t0 = performance.now();
  let blob;
  try {
    blob = full ? S.video.blob : await exportClip(S.video.blob, {
      start, end, cuts, onProgress: reencode ? (p) => { ui.progress.value = p; } : undefined,
    });
  } catch (err) {
    if (reencode) { S.cutsFailed = keptKey; err.cuts = true; }
    throw err;
  } finally {
    ui.progress.hidden = true;
  }
  const secs = (performance.now() - t0) / 1000;
  const { duration } = full ? S.video : await probe(blob);
  const length = totalLength(ranges);
  let how = '';
  if (full) how = ' (no trim needed)';
  else if (reencode) how = `, re-encoded ${cutWord} at ${(length / secs).toFixed(1)} s of video per second`;
  else if (trimOnly && count) how = ' (trim only, the re-encode failed)';
  S.note('export', `${length.toFixed(1)} s clip, ${fmtMB(blob.size)}, ${secs.toFixed(1)} s${how}`);
  if (reencode) say(ui.uploadMsg, '');
  S.exported = { key, blob, duration };
  return S.exported;
}

// The error panel's words when preparing the video fails.
function prepareError(err, then) {
  if (err.cuts) {
    return `Could not re-encode the cuts (${err.message}). Upload and Download MP4 now use the trimmed video with the cut parts left in. Change or remove a cut to try again.`;
  }
  return `Could not prepare the video (${err.message}). ${then}`;
}

function fileName() {
  return (ui.title.value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'vignette') + '.mp4';
}

// ---------- Upload and download ----------
// While a file is being prepared or sent, Share stays disabled: a new share
// would discard this recording out from under the upload. `button` is the
// one doing the work; it shows the loading state.
function lock(on, button) {
  ui.upload.disabled = ui.download.disabled = ui.share.disabled = ui.retry.disabled = on;
  for (const b of [ui.upload, ui.download, ui.retry]) busy(b, on && b === button);
}

function resetUploadUi() {
  ui.uploadActs.append(ui.download); // back beside Upload (see below)
  ui.upload.hidden = false;
  lock(false);
  ui.retry.hidden = ui.progress.hidden = ui.shareBox.hidden = true;
  say(ui.uploadMsg, '');
}

async function upload(event) {
  lock(true, event?.currentTarget === ui.retry ? ui.retry : ui.upload);
  let stage = 'prepare';
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
      width: S.video.width, height: S.video.height, thumb, job: S.job,
      onProgress: (sent, total) => {
        ui.progress.value = sent / total;
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
ui.download.addEventListener('click', download);
ui.copy.addEventListener('click', copyLink);
