// Recorder page entry: capture, the live preview, recording (steps 1 and 2).
// Recording logic comes from the spike (spike/spike.js), which proved it on
// Chrome. The two recorders (screen, camera) live in tracks.js; step 3
// (edit, upload) in editor.js; the webcam bubble's position and drawing in
// bubble.js.
import { requirePassword } from './auth.js';
import { openEditor, closeEditor, editorState } from './editor.js';
import { say, busy } from './ui.js';
import * as bubble from './bubble.js';
import { startTracks, heap } from './tracks.js';

const MAX_W = 1920, MAX_H = 1080, FPS = 30;
const $ = (id) => document.getElementById(id);
const ui = {
  gate: $('gate'), app: $('app'),
  share: $('share'), cam: $('cam'), mic: $('mic'), source: $('source'), setupMsg: $('setupMsg'),
  recordStep: $('recordStep'), start: $('start'), stop: $('stop'), timer: $('timer'), recDot: $('recDot'),
  canvas: $('canvas'), screenVideo: $('screenVideo'), camVideo: $('camVideo'),
  countdown: $('countdown'), flap: $('flap'), recordMsg: $('recordMsg'), recordSummary: $('recordSummary'),
  details: $('details'), band1: $('band1'), band2: $('band2'), band3: $('band3'), stage: $('stage'), frame: $('frame'),
};

// phase: idle -> shared -> countdown -> recording -> stopped
const state = {
  phase: 'idle', screen: null, cam: null, mic: null, session: null,
  drawing: false, timerHandle: null, startedAt: 0, stoppedAt: 0, framesDrawn: 0, withCamera: false,
};
let tracks = null; // what the last recording produced, for the test: {screen, camera, cameraOffset, cameraLostAt}

// The preview canvas is redrawn on ticks from a tiny Worker. Chrome slows
// page timers to about once a second in background tabs, which is exactly
// where Vignette sits while you record another tab or window. Worker timers
// are not slowed that way, so the preview keeps its 30 fps.
const ticker = new Worker(URL.createObjectURL(new Blob([
  'let t; onmessage = (e) => { clearInterval(t); if (e.data > 0) t = setInterval(() => postMessage(0), e.data); };',
], { type: 'text/javascript' })));
ticker.onmessage = drawFrame;
function setDrawing(on) {
  if (on === state.drawing) return;
  state.drawing = on;
  ticker.postMessage(on ? 1000 / FPS : 0);
}

// ---------- Bands: each step's sign shows where you are ----------
// current: the cream band, the one decision to take now. done: compact,
// checked. closed: not reached yet. live: the Record band while recording.
const BAND2 = { idle: 'closed', shared: 'current', countdown: 'current', recording: 'live', stopped: 'done' };
function setPhase(phase) {
  state.phase = phase;
  const mark = (el, s) => {
    el.dataset.state = s;
    if (s === 'current' || s === 'live') el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
  };
  mark(ui.band1, phase === 'idle' ? 'current' : 'done');
  mark(ui.band2, BAND2[phase]);
  mark(ui.band3, phase === 'stopped' ? 'current' : 'closed');
  ui.share.classList.toggle('act--quiet', phase !== 'idle');
  busy(ui.start, phase === 'countdown');
  ui.stage.hidden = phase === 'stopped';
  ui.stage.dataset.live = String(phase === 'recording');
}

// ---------- Details (for bug reports) ----------
const details = {};
function note(key, value) {
  details[key] = value;
  ui.details.textContent = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join('\n');
  console.log('[vignette]', `${key}: ${value}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The Share button's words right now ("Share screen", or "Share again" once step 1 is done).
const shareLabel = () => ui.share.querySelector(state.phase === 'idle' ? '.if-open' : '.if-done').textContent;
const stopStream = (s) => s?.getTracks().forEach((t) => t.stop());
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------- Step 1: share screen, webcam, mic ----------
async function share() {
  say(ui.setupMsg, '');
  busy(ui.share, true);
  let screen;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({
      // Capped at 1080p: bigger captures make large files and overload the
      // preview canvas. Chrome scales down to fit, keeping the shape.
      video: { frameRate: { ideal: FPS }, width: { max: MAX_W }, height: { max: MAX_H } },
      audio: true, // tab or system audio, where the browser offers it
    });
  } catch (err) {
    // Nothing is discarded until a new share actually starts, so cancelling
    // the picker keeps the current recording and its edit step.
    const cancelled = err.name === 'NotAllowedError' || err.name === 'AbortError';
    say(ui.setupMsg, cancelled
      ? `Screen sharing was cancelled. Click ${shareLabel()} to try again.`
      : `Could not share the screen: ${err.message}. Click ${shareLabel()} to try again.`);
    return;
  } finally {
    busy(ui.share, false);
  }
  releaseAll();
  closeEditor();
  state.screen = screen;
  const track = state.screen.getVideoTracks()[0];
  const { width = 1280, height = 720, displaySurface } = track.getSettings();
  // Cap the preview canvas at 1080p. A full Retina-sized canvas overloads
  // the page (found in the spike).
  const scale = Math.min(1, MAX_W / width, MAX_H / height);
  ui.canvas.width = Math.round(width * scale) & ~1;
  ui.canvas.height = Math.round(height * scale) & ~1;
  live.setFrame(ui.canvas.width, ui.canvas.height);
  ui.screenVideo.srcObject = state.screen;
  await ui.screenVideo.play().catch(() => {});
  track.addEventListener('ended', onShareEnded);
  setPhase('shared');

  const what = { browser: 'a browser tab', window: 'a window', monitor: 'your screen' }[displaySurface] || 'your screen';
  ui.source.textContent = `Sharing ${what} at ${width}x${height}.`;
  note('capture size', `${width}x${height} (${displaySurface || 'unknown surface'}), tab audio: ${state.screen.getAudioTracks().length > 0}`);
  await syncDevices();
  ui.recordStep.hidden = false;
  ui.start.disabled = false;
  ui.timer.textContent = fmtClock(0);
  say(ui.recordMsg, '');
}

// Gets or releases the webcam and microphone to match the checkboxes.
// Calls are chained so quick clicks cannot open the same device twice.
let syncing = Promise.resolve();
function syncDevices() {
  syncing = syncing.then(async () => {
    const problems = [];
    if (ui.cam.checked && !state.cam) {
      try {
        // 720p: the camera is kept as its own file now, for later layouts.
        state.cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        ui.camVideo.srcObject = state.cam;
        await ui.camVideo.play().catch(() => {});
      } catch (err) {
        ui.cam.checked = false;
        problems.push(`Webcam not available (${err.name}), recording without it.`);
      }
    } else if (!ui.cam.checked && state.cam) {
      stopStream(state.cam); state.cam = null; ui.camVideo.srcObject = null;
    }
    if (ui.mic.checked && !state.mic) {
      try { state.mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) {
        ui.mic.checked = false;
        problems.push(`Microphone not available (${err.name}), recording without it.`);
      }
    } else if (!ui.mic.checked && state.mic) {
      stopStream(state.mic); state.mic = null;
    }
    if (problems.length) say(ui.setupMsg, problems.join(' '));
    live.setCam(ui.cam.checked);
    updatePreview();
  });
  return syncing;
}

// Webcam on: show the composite canvas. Webcam off: show the screen itself.
// The screen video stays in the layout either way because the canvas draws
// from it, and Safari stops decoding videos that are display:none.
function updatePreview() {
  const composite = !!state.cam && !!state.screen;
  ui.canvas.hidden = !composite;
  ui.screenVideo.classList.toggle('helper', composite || !state.screen);
  ui.frame.dataset.source = state.screen ? 'live' : 'empty';
  live.setLive(composite ? state.cam : null);
  setDrawing(composite);
}

function onShareEnded() {
  if (state.phase === 'recording') {
    stopRecording();
    say(ui.setupMsg, 'Sharing was stopped from the browser, so the recording stopped too.');
  } else if (state.phase === 'shared' || state.phase === 'countdown') {
    releaseAll();
    say(ui.setupMsg, 'Sharing stopped. Click Share screen to start again.');
  }
}

// Stops every capture and resets steps 1 and 2.
function releaseAll() {
  for (const s of [state.screen, state.cam, state.mic]) stopStream(s);
  state.screen = state.cam = state.mic = null;
  ui.screenVideo.srcObject = ui.camVideo.srcObject = null;
  setDrawing(false);
  setPhase('idle');
  ui.recordStep.hidden = true;
  ui.countdown.hidden = true;
  ui.source.textContent = 'Nothing shared yet.';
  live.setFrame(16, 9);
  updatePreview();
}

// ---------- Step 2: preview and record ----------
// The canvas is the live preview only: what the recording will look like
// with the bubble where it sits now. It is not recorded; the screen and the
// camera are (tracks.js), and the bubble is drawn at export.
function drawFrame() {
  if (state.phase === 'recording') state.framesDrawn++;
  const ctx = ui.canvas.getContext('2d');
  const { width: W, height: H } = ui.canvas;
  if (ui.screenVideo.readyState >= 2) ctx.drawImage(ui.screenVideo, 0, 0, W, H);
  if (state.cam && ui.camVideo.readyState >= 2) bubble.draw(ctx, ui.camVideo, W, H);
}

// One split-flap change: the old number's top half falls away and the new
// number's bottom half lands (the motion itself is CSS, in app.css).
function flip(from, to) {
  const f = ui.flap;
  Object.assign(f.dataset, { from, to });
  f.textContent = to;
  f.classList.remove('flipping');
  void f.offsetWidth; // restart the animation
  f.classList.add('flipping');
}

async function startRecording() {
  setPhase('countdown');
  for (const el of [ui.start, ui.share, ui.cam, ui.mic]) el.disabled = true;
  ui.countdown.hidden = false;
  let shown = '';
  for (const n of ['3', '2', '1']) {
    flip(shown, n);
    shown = n;
    await sleep(1000);
    if (state.phase !== 'countdown') return finishCountdownCancelled();
  }
  ui.countdown.hidden = true;

  heap.reset();
  try {
    state.session = startTracks({
      screen: state.screen, cam: state.cam, mic: state.mic,
      onScreenError: (err) => {
        say(ui.setupMsg, `Recording error: ${err?.message || 'unknown'}. Keeping what was recorded.`);
        stopRecording();
      },
      onCamera: (text) => note('camera', text),
    });
  } catch (err) {
    say(ui.recordMsg, `This browser cannot record this source (${err.message}). Turn the webcam off, or share something else, and try again.`);
    setPhase('shared');
    for (const el of [ui.start, ui.share, ui.cam, ui.mic]) el.disabled = false;
    return;
  }
  state.withCamera = state.session.cameraOffset !== null;
  setPhase('recording');
  state.startedAt = performance.now();
  state.framesDrawn = 0;
  state.timerHandle = setInterval(() => {
    ui.timer.textContent = fmtClock((performance.now() - state.startedAt) / 1000);
    heap.sample();
  }, 250);
  ui.timer.textContent = fmtClock(0);
  ui.recDot.hidden = false;
  ui.stop.disabled = false;
  note('codec', state.session.mimeType || '(browser default)');
}

function finishCountdownCancelled() {
  ui.countdown.hidden = true;
  busy(ui.start, false);
  for (const el of [ui.share, ui.cam, ui.mic]) el.disabled = false;
}

function stopRecording() {
  if (state.phase !== 'recording' || !state.session) return;
  if (!state.session.stopping) state.stoppedAt = performance.now();
  clearInterval(state.timerHandle);
  ui.stop.disabled = true;
  ui.recDot.hidden = true;
  state.session.stop().then(onRecordingStopped);
}

async function onRecordingStopped(result) {
  if (state.phase !== 'recording') return; // already handled
  const seconds = ((state.stoppedAt || performance.now()) - state.startedAt) / 1000; // Stop to start, not to this event
  const framesDrawn = state.framesDrawn;
  state.session = null;
  tracks = result;
  heap.sample();
  releaseAll(); // ends the screen share; also hides step 2
  for (const el of [ui.share, ui.cam, ui.mic]) el.disabled = false;

  const { screen, camera, cameraOffset } = result;
  const mb = screen.size / 1024 / 1024;
  note('recorded', `${mb.toFixed(1)} MB in ${seconds.toFixed(1)} s (${(mb / (seconds / 60)).toFixed(1)} MB per minute)`);
  note('canvas', state.withCamera ? `preview only, ${(framesDrawn / seconds).toFixed(1)} fps drawn (${FPS} expected)` : 'off, no webcam');
  note('originals', camera
    ? `screen ${fmtMB(screen.size)}, camera ${fmtMB(camera.size)}, camera started ${(cameraOffset * 1000).toFixed(1)} ms after the screen`
    : `screen ${fmtMB(screen.size)}, no camera`);
  if (state.withCamera && !camera) note('camera', 'produced no picture; the video has no bubble');
  note('peak memory', `${heap.text()} while recording`);
  if (!screen.size) {
    say(ui.setupMsg, 'Nothing was recorded. Share your screen and try again.');
    return;
  }
  setPhase('stopped');
  ui.source.textContent = 'Recording finished. Share again to record another.';
  ui.recordSummary.textContent = `${fmtClock(seconds)} recorded.`;
  await openEditor(result, note);
}

// ---------- Wire up ----------
ui.share.addEventListener('click', share);
ui.cam.addEventListener('change', () => { live.setCam(ui.cam.checked); if (state.phase === 'shared') syncDevices(); });
ui.mic.addEventListener('change', () => { if (state.phase === 'shared') syncDevices(); });
ui.start.addEventListener('click', startRecording);
ui.stop.addEventListener('click', stopRecording);

note('browser', navigator.userAgent);
if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
  say(ui.setupMsg, 'This browser cannot record the screen. Use Chrome or Edge on a computer.');
  ui.share.disabled = true;
}

const live = bubble.attach({ el: $('bubble'), video: $('bubbleVideo'), frame: ui.frame, sizes: document.querySelectorAll('input[name=bubbleSize]') });
live.setCam(ui.cam.checked);
setPhase('idle');

// Exposed for the automated test (test/e2e.mjs).
window.__vignette = {
  state, details, editor: editorState,
  get tracks() { return tracks; },
  bubble: { get: bubble.get, set: bubble.set, get lastDraw() { return bubble.lastDraw; } },
};

requirePassword(ui.gate, () => { ui.app.hidden = false; });
