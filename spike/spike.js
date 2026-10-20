// Vignette spike: record screen (+ webcam bubble + mic) in the browser,
// trim, and export a seekable MP4. Plain ES module, no build step.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat,
} from './vendor/mediabunny-1.61.6.min.mjs';

const $ = (id) => document.getElementById(id);
const ui = {
  share: $('share'), cam: $('cam'), mic: $('mic'), source: $('source'),
  record: $('record'), stop: $('stop'), timer: $('timer'), canvas: $('canvas'), recInfo: $('recInfo'),
  editSection: $('editSection'), preview: $('preview'),
  trimStart: $('trimStart'), trimEnd: $('trimEnd'), trimStartOut: $('trimStartOut'), trimEndOut: $('trimEndOut'),
  export: $('export'), progress: $('progress'), download: $('download'), exportInfo: $('exportInfo'),
  log: $('log'), screenVideo: $('screenVideo'), camVideo: $('camVideo'),
};

const state = {
  screenStream: null, camStream: null, micStream: null,
  recorder: null, chunks: [], recordedBlob: null, mimeType: '',
  drawTimer: null, startedAt: 0, timerHandle: null, duration: 0,
  findings: {},
};

function log(line) {
  ui.log.textContent += line + '\n';
  console.log('[spike]', line);
}
function finding(key, value) { state.findings[key] = value; log(`${key}: ${value}`); }
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------- 1. Pick sources ----------
async function startShare() {
  stopStreams();
  state.screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: true, // tab/system audio where the browser allows it
  });
  const track = state.screenStream.getVideoTracks()[0];
  const { width, height, displaySurface } = track.getSettings();
  const MAX_W = 1920, MAX_H = 1080;
  const scale = Math.min(1, MAX_W / (width || 1280), MAX_H / (height || 720));
  ui.canvas.width = Math.round((width || 1280) * scale);
  ui.canvas.height = Math.round((height || 720) * scale);
  state.captureSize = `${width}x${height}`;
  ui.screenVideo.srcObject = state.screenStream;
  await ui.screenVideo.play().catch((e) => log(`screen preview play failed: ${e.message}`));
  track.addEventListener('ended', () => { if (state.recorder?.state === 'recording') stopRecording(); });

  if (ui.cam.checked) {
    try {
      state.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      ui.camVideo.srcObject = state.camStream;
      await ui.camVideo.play().catch((e) => log(`webcam preview play failed: ${e.message}`));
    } catch (e) { log(`webcam unavailable: ${e.message}`); }
  }
  if (ui.mic.checked) {
    try { state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { log(`mic unavailable: ${e.message}`); }
  }
  const hasTabAudio = state.screenStream.getAudioTracks().length > 0;
  finding('source', `${displaySurface || 'unknown'} captured at ${state.captureSize}, canvas ${ui.canvas.width}x${ui.canvas.height}, tab audio: ${hasTabAudio}, webcam: ${!!state.camStream}, mic: ${!!state.micStream}`);
  ui.source.textContent = `Sharing ${displaySurface || 'screen'} at ${ui.canvas.width}x${ui.canvas.height}.`;
  ui.record.disabled = false;
  drawFrame();
}

function stopStreams() {
  for (const s of [state.screenStream, state.camStream, state.micStream]) s?.getTracks().forEach((t) => t.stop());
  state.screenStream = state.camStream = state.micStream = null;
}

// ---------- 2. Compose and record ----------
function drawFrame() {
  state.framesDrawn = (state.framesDrawn || 0) + 1;
  const ctx = ui.canvas.getContext('2d');
  const { width: W, height: H } = ui.canvas;
  if (ui.screenVideo.readyState >= 2) ctx.drawImage(ui.screenVideo, 0, 0, W, H);
  if (state.camStream && ui.camVideo.readyState >= 2) {
    const r = Math.round(Math.min(W, H) * 0.12);
    const cx = r + 24, cy = H - r - 24;
    const vw = ui.camVideo.videoWidth, vh = ui.camVideo.videoHeight;
    const side = Math.min(vw, vh);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.drawImage(ui.camVideo, (vw - side) / 2, (vh - side) / 2, side, side, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
}

function pickMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

function buildRecordingStream() {
  const out = new MediaStream();
  state.usingCanvas = !!state.camStream;
  const videoSource = state.usingCanvas ? ui.canvas.captureStream(30) : state.screenStream;
  videoSource.getVideoTracks().forEach((t) => out.addTrack(t));
  const audioSources = [state.screenStream, state.micStream].filter((s) => s?.getAudioTracks().length);
  if (audioSources.length) {
    const ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    audioSources.forEach((s) => ac.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest));
    dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
    state.audioContext = ac;
  }
  return out;
}

function startRecording() {
  state.chunks = [];
  state.mimeType = pickMimeType();
  const stream = buildRecordingStream();
  state.recorder = new MediaRecorder(stream, { mimeType: state.mimeType || undefined, videoBitsPerSecond: 5_000_000 });
  state.recorder.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
  state.recorder.onstop = onRecordingStopped;
  if (state.usingCanvas) state.drawTimer = setInterval(drawFrame, 1000 / 30);
  state.recorder.start(1000);
  state.startedAt = performance.now();
  state.framesDrawn = 0;
  state.timerHandle = setInterval(() => { ui.timer.textContent = fmtTime((performance.now() - state.startedAt) / 1000); }, 250);
  finding('recorder mimeType', state.recorder.mimeType || '(browser default)');
  finding('video feeds at record start', `screen readyState ${ui.screenVideo.readyState} (${ui.screenVideo.videoWidth}x${ui.screenVideo.videoHeight}), webcam readyState ${ui.camVideo.readyState}, canvas ${state.usingCanvas ? 'on' : 'off'}`);
  ui.record.disabled = true; ui.stop.disabled = false; ui.share.disabled = true;
}

function stopRecording() {
  if (state.recorder?.state === 'recording') state.recorder.stop();
  clearInterval(state.drawTimer); clearInterval(state.timerHandle);
  ui.stop.disabled = true;
}

async function onRecordingStopped() {
  const seconds = (performance.now() - state.startedAt) / 1000;
  state.recordedBlob = new Blob(state.chunks, { type: state.recorder.mimeType });
  stopStreams(); state.audioContext?.close();
  ui.share.disabled = false;
  finding('recorded', `${fmtMB(state.recordedBlob.size)} for ${seconds.toFixed(1)}s (${(state.recordedBlob.size / 1024 / 1024 / (seconds / 60)).toFixed(1)} MB per minute)`);
  finding('video path', state.usingCanvas ? `canvas composite at ${(state.framesDrawn / seconds).toFixed(1)} frames per second (30 expected)` : 'screen track recorded directly, no canvas');

  // MediaRecorder output often lacks a duration header, so measure it by parsing the file.
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(state.recordedBlob) });
  state.duration = await input.computeDuration();
  finding('parsed duration', `${state.duration.toFixed(2)}s (metadata said ${await input.getDurationFromMetadata?.() ?? 'n/a'})`);
  ui.recInfo.textContent = `Recorded ${fmtMB(state.recordedBlob.size)}, ${state.duration.toFixed(1)}s, ${state.recorder.mimeType}.`;

  ui.preview.src = URL.createObjectURL(state.recordedBlob);
  for (const r of [ui.trimStart, ui.trimEnd]) r.max = state.duration.toFixed(1);
  ui.trimStart.value = 0; ui.trimEnd.value = state.duration.toFixed(1);
  updateTrimLabels();
  ui.editSection.hidden = false;
  ui.editSection.scrollIntoView({ behavior: 'smooth' });
}

// ---------- 3. Trim and export ----------
function updateTrimLabels() {
  if (+ui.trimStart.value >= +ui.trimEnd.value) ui.trimStart.value = Math.max(0, +ui.trimEnd.value - 0.1).toFixed(1);
  ui.trimStartOut.value = `${(+ui.trimStart.value).toFixed(1)}s`;
  ui.trimEndOut.value = `${(+ui.trimEnd.value).toFixed(1)}s`;
}

async function exportTrim(start = +ui.trimStart.value, end = +ui.trimEnd.value) {
  ui.export.disabled = true; ui.progress.hidden = false; ui.progress.value = 0; ui.download.hidden = true;
  const t0 = performance.now();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(state.recordedBlob) });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output, trim: { start, end } });
  if (!conversion.isValid) throw new Error('Cannot convert: ' + conversion.discardedTracks.map((d) => d.reason).join(', '));
  conversion.onProgress = (p) => { ui.progress.value = p; };
  await conversion.execute();
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  const ms = performance.now() - t0;
  const clipLen = end - start;
  finding('export', `${clipLen.toFixed(1)}s clip (start ${start.toFixed(1)}s) -> ${fmtMB(blob.size)} MP4 in ${(ms / 1000).toFixed(1)}s (${(clipLen / (ms / 1000)).toFixed(1)}x realtime)${blob.size < state.recordedBlob.size * 1.2 ? ', looks like a stream copy' : ', looks re-encoded'}`);
  ui.exportInfo.textContent = `Exported ${fmtMB(blob.size)} in ${(ms / 1000).toFixed(1)}s.`;
  ui.download.href = URL.createObjectURL(blob);
  ui.download.hidden = false; ui.progress.hidden = true; ui.export.disabled = false;
  return { size: blob.size, type: blob.type, ms, blob };
}

// ---------- Wire up ----------
ui.share.addEventListener('click', () => startShare().catch((e) => log(`share failed: ${e.name}: ${e.message}`)));
ui.record.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);
ui.trimStart.addEventListener('input', updateTrimLabels);
ui.trimEnd.addEventListener('input', updateTrimLabels);
ui.export.addEventListener('click', () => exportTrim().catch((e) => { log(`export failed: ${e.message}`); ui.export.disabled = false; }));

finding('browser', navigator.userAgent);
finding('MediaRecorder mp4 support', MediaRecorder.isTypeSupported('video/mp4') ? 'yes' : 'no (will use WebM)');
finding('WebCodecs', 'VideoEncoder' in window ? 'yes' : 'no');

// Exposed for the automated smoke test.
window.__spike = { state, startShare, startRecording, stopRecording, exportTrim };
