// The self-view window (docs/LOOP2_SELF_VIEW_SPEC.md). While recording, a
// small window that stays on top of other apps shows what is being
// recorded, the clock, the recording dot, a view toggle (the picture with
// the bubble, or the camera only) and Stop, plus the script panel
// (prompter.js) when there is a script. Stop there is Stop on the page.
//
// Chrome and Edge: a Document Picture-in-Picture window, built here.
// Elsewhere: classic picture-in-picture of a hidden <video> fed by a canvas
// of its own (captureStream), with the clock and the dot drawn into the
// picture, and no Stop or script. Neither: nothing opens. The recorder's
// preview canvas stays preview only: this module draws from it and never
// captures it.
//
// The recorder owns the state and calls open() (straight from a click),
// close(), setPhase(), setCount(), setClock() and paint(). paint() runs once
// per tick of the recorder's ticker, a Worker, so a hidden tab does not
// slow it; it does nothing while the window is closed. Closing the window
// by hand does not stop the recording; the page then offers Show window.
//
// Test hooks: window.__vignette.selfview is `hooks` below.
//   mode          what this browser offers: 'document', 'classic' or 'none'
//   used          what the last open() used: 'document', 'classic', 'refused' (the browser said no),
//                 'none' (nothing to open), or null before any
//   open          true while the window (or the classic picture-in-picture) shows
//   view          'composite' (the picture with the bubble; the screen alone with the webcam off) or 'camera'
//   phase         'countdown' or 'recording'
//   clock         the time the window shows, mm:ss
//   count         the countdown digit it shows, '' when none
//   wholeScreen   true while the window is open with the whole-screen note
//   opens         windows opened since the page loaded
//   closedByHand  times the user closed it (Stop and the end of a recording do not count)
//   frames        pictures painted into the window or the classic video so far
//   window        the Document Picture-in-Picture Window while open, else null
//   video         the hidden <video> of classic picture-in-picture, or null
//   script        {shown, paused, speed, scrollTop, length} of the script panel, or {shown: false};
//                 the place, speed and pause survive a reopen in the same recording
//   requested     {width, height}: the size last asked of the browser for the window (it may give another)
//   canvas        the canvas that feeds the classic picture-in-picture video, or null
// Ids in the window's document: svPic and svCanvas (the picture), svCount and svFlap (the
// countdown; the flap carries the class "flipping" and data-from and data-to while a digit
// changes), svDot, svClock, svNote (the whole-screen note, under the bar), svViewComposite and
// svViewCamera (the view radios) in svCompositeLabel and svCameraLabel (the plates; the lit one
// has data-on="true"), svStop, svScript (the panel), svText (the scrolling text), svSlower,
// svPause, svFaster, svSpeed (the speed readout).
import { panel } from './prompter.js';

const FPS = 30;
const WIDTH = 360;       // the window's width, CSS px
const PAINT_W = 720;     // the window canvas's width in pixels, sharp on 2x screens
const CLASSIC_W = 640;   // the classic picture-in-picture video's width
const STRIP = 0.11;      // its strip under the picture for the dot and the clock, as a share of the width
const BAR_H = 72;        // the window's bar (3rem squares and 12px padding), CSS px
const NOTE_H = 56;       // the whole-screen note under it, two lines of Small
const ICONS = new URL('/icons.svg', location.href).href;
export const WHOLE_SCREEN_NOTE = 'This window is in the recording. Move it to another screen, or share a window instead.';
const LABEL = {
  document: 'floating window (Document Picture-in-Picture)',
  classic: 'classic picture-in-picture (no Stop or script in this browser)',
};

const glyph = (name, useId = '') => `<svg class="glyph" aria-hidden="true"><use${useId ? ` id="${useId}"` : ''} href="${ICONS}#i-${name}"/></svg>`;
const MARKUP = `
<div id="svPic" class="sv-pic">
  <canvas id="svCanvas" width="${PAINT_W}" height="${PAINT_W * 9 / 16}"></canvas>
  <div id="svCount" class="sv-count" hidden><span id="svFlap" class="sv-flap" aria-live="assertive"></span></div>
</div>
<div class="sv-bar">
  <span class="sv-time"><span id="svDot" class="sv-dot" hidden>${glyph('record')}<span class="vh">Recording</span></span><span id="svClock" class="sv-clock" role="timer">00:00</span></span>
  <fieldset class="sv-views">
    <legend class="vh">View</legend>
    <label id="svCompositeLabel" class="sv-seg"><input id="svViewComposite" type="radio" name="svView" value="composite">${glyph('frame')}<span class="vh"></span></label>
    <label id="svCameraLabel" class="sv-seg" title="Camera only"><input id="svViewCamera" type="radio" name="svView" value="camera">${glyph('camera')}<span class="vh">Camera only</span></label>
  </fieldset>
  <button id="svStop" type="button" class="sv-stop" title="Stop" aria-label="Stop recording">${glyph('stop')}</button>
</div>
<p id="svNote" class="sv-note" hidden>${WHOLE_SCREEN_NOTE}</p>
<section id="svScript" class="sv-script" aria-label="Script" hidden>
  <div id="svText" class="sv-text" tabindex="0"></div>
  <div class="sv-speed">
    <button id="svSlower" type="button" class="sv-sq" title="Slower" aria-label="Slower">${glyph('minus')}</button>
    <button id="svPause" type="button" class="sv-sq">${glyph('pause', 'svPauseUse')}</button>
    <button id="svFaster" type="button" class="sv-sq" title="Faster" aria-label="Faster">${glyph('plus')}</button>
    <output id="svSpeed" class="sv-speed-out">1x</output>
  </div>
</section>`;

function detect() {
  if (typeof window.documentPictureInPicture?.requestWindow === 'function') return 'document';
  if (document.pictureInPictureEnabled && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function') return 'classic';
  return 'none';
}

const s = {
  mode: detect(), used: null, status: 'closed', token: 0, // status: closed, opening, open
  opts: null, win: null, els: null, script: null, classic: null,
  view: 'composite', phase: 'countdown', clock: '00:00', count: '',
  opens: 0, byHand: 0, frames: 0, requested: null,
  place: {}, // the script's scroll place, speed and pause: kept across reopens, new for each recording
};

export const isOpen = () => s.status !== 'closed';
export const mode = () => s.mode;

/**
 * Opens the window. Call it straight from a click: browsers open one only
 * in answer to a gesture. opts: {fresh (a new recording: the view goes back
 * to its default), withCamera, wholeScreen, aspect (the screen's width over
 * height), camAspect, script ('' for none), onStop, onChange (any open or
 * close), note(text) (the Details line)}. Never throws: a refusal is noted
 * and the recording carries on without the window.
 * @returns {string} what it used ('document', 'classic', 'refused' or 'none')
 */
export function open(opts) {
  if (s.status !== 'closed') return s.used;
  s.opts = opts;
  if (opts.fresh) Object.assign(s, { view: opts.wholeScreen && opts.withCamera ? 'camera' : 'composite', phase: 'countdown', clock: '00:00', count: '', place: {} });
  if (!opts.withCamera) s.view = 'composite';
  const token = ++s.token;
  if (s.mode === 'none') {
    s.used = 'none';
    opts.note('not available in this browser');
    return s.used;
  }
  s.status = 'opening';
  let request;
  try {
    request = s.mode === 'document'
      ? window.documentPictureInPicture.requestWindow(s.requested = { width: WIDTH, height: heightFor(opts) })
      : enterClassic();
  } catch (err) {
    refused(err);
    return s.used;
  }
  Promise.resolve(request).then((win) => {
    if (token !== s.token) { // closed (or Stop pressed) while it was opening
      if (s.mode === 'document') win?.close(); else exitClassic();
      return;
    }
    if (s.mode === 'document') {
      if (!win?.document) throw new DOMException('No window came back', 'NotAllowedError');
      build(win);
    }
    Object.assign(s, { status: 'open', used: s.mode });
    s.opens++;
    opts.note(LABEL[s.mode]);
    opts.onChange();
  }).catch((err) => { if (token === s.token) refused(err); });
  opts.onChange();
  return s.mode;
}

function refused(err) {
  Object.assign(s, { status: 'closed', used: 'refused', win: null, els: null, script: null });
  s.opts.note(`the browser did not open the window (${err?.name || 'Error'}: ${err?.message || 'no reason given'}); recording without it, and Show window tries again`);
  s.opts.onChange();
}

// The picture's height at 360 wide, plus the bar and the note; with a
// script, that is 60% of the window and the panel takes the other 40%.
function heightFor(o) {
  const h = Math.round(WIDTH / aspectFor(o)) + BAR_H + (o.wholeScreen ? NOTE_H : 0);
  return Math.min(o.script ? Math.round(h / 0.6) : h, 760);
}
const aspectFor = (o) => (s.view === 'camera' ? o.camAspect : o.aspect) || 16 / 9;

// Fills a new Document Picture-in-Picture window. It shares the page's
// origin, so it takes the page's styles and pictograms by URL.
function build(win) {
  const doc = win.document;
  doc.documentElement.lang = 'en';
  doc.documentElement.style.background = '#0B0B0B'; // black before the styles arrive
  doc.title = 'Recording';
  for (const path of ['/tokens.css', '/selfview.css']) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(path, location.href).href;
    doc.head.append(link);
  }
  doc.body.className = 'sv';
  doc.body.innerHTML = MARKUP; // fixed markup; the script goes in as text below
  const $ = (id) => doc.getElementById(id);
  const o = s.opts;
  const els = {
    doc, pic: $('svPic'), canvas: $('svCanvas'), count: $('svCount'), flap: $('svFlap'), dot: $('svDot'), clock: $('svClock'),
    note: $('svNote'), composite: $('svViewComposite'), camera: $('svViewCamera'), stop: $('svStop'), script: $('svScript'),
    plates: { composite: $('svCompositeLabel'), camera: $('svCameraLabel') }, shownCount: '',
  };
  els.pic.style.setProperty('--ar', aspectFor(o).toFixed(4));
  els.ctx = els.canvas.getContext('2d', { alpha: false });
  els.ctx.fillStyle = '#0B0B0B';
  els.ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  els.note.hidden = !o.wholeScreen;
  els.camera.disabled = !o.withCamera;
  const compositeName = o.withCamera ? 'Picture with bubble' : 'Screen';
  $('svCompositeLabel').title = compositeName;
  $('svCompositeLabel').querySelector('.vh').textContent = compositeName;
  for (const r of [els.composite, els.camera]) r.addEventListener('change', () => { if (r.checked) { s.view = r.value; show(); } });
  els.stop.addEventListener('click', () => s.opts.onStop());
  win.addEventListener('pagehide', () => { if (s.win === win) closedByHand(); });
  if (o.script) {
    s.script = panel({
      text: $('svText'), slower: $('svSlower'), pause: $('svPause'), faster: $('svFaster'), speed: $('svSpeed'), pauseUse: $('svPauseUse'),
    }, o.script, win, ICONS, s.place);
  }
  els.script.hidden = !s.script;
  s.win = win;
  s.els = els;
  show();
}

// Puts the shared state (phase, clock, countdown digit, view) on the
// window. The only writer of the lit plate: data-on, not :checked, lights
// it (the Picture-in-Picture window did not repaint a styled radio).
function show() {
  const e = s.els;
  if (!e) return;
  e.doc.body.dataset.phase = s.phase;
  e.clock.textContent = s.clock;
  e.dot.hidden = s.phase !== 'recording';
  e.stop.disabled = s.phase === 'countdown'; // as on the page: nothing to stop until it records
  e.count.hidden = !(s.phase === 'countdown' && s.count);
  if (s.count && s.count !== e.shownCount) flip(e, e.shownCount, s.count);
  for (const [view, plate] of Object.entries(e.plates)) {
    plate.dataset.on = String(s.view === view);
    e[view].checked = s.view === view;
  }
}

// One split-flap change, as on the page: the old digit's top half falls
// away and the new one's bottom half lands (the motion is in selfview.css).
function flip(e, from, to) {
  e.shownCount = to;
  Object.assign(e.flap.dataset, { from, to });
  e.flap.textContent = to;
  e.flap.classList.remove('flipping');
  void e.flap.offsetWidth; // restart the animation
  e.flap.classList.add('flipping');
}

export function setPhase(phase) {
  s.phase = phase;
  if (phase !== 'countdown') s.count = '';
  show();
}
export function setCount(n) { s.count = n; show(); }
export function setClock(text) {
  if (text === s.clock) return;
  s.clock = text;
  if (s.els) s.els.clock.textContent = text;
}

// Closes the window on purpose (Stop, the end of a recording). Safe to call any time.
export function close() {
  s.token++;
  if (s.status === 'closed') return;
  const { win } = s;
  teardown();
  if (win && !win.closed) win.close();
  if (s.mode === 'classic') exitClassic();
  s.opts?.onChange();
}

function teardown() { Object.assign(s, { status: 'closed', win: null, els: null, script: null }); }

function closedByHand() {
  teardown();
  s.byHand++;
  s.opts.note(`${LABEL[s.mode]}; closed by hand, the recording carried on`);
  s.opts.onChange();
}

// ---------- Painting, once per tick ----------

/**
 * Paints the window's picture from the recorder's sources: preview (the
 * composite canvas, or null with the webcam off), screen and cam (<video>s,
 * cam null with the webcam off). Also moves the script on.
 */
export function paint({ preview, screen, cam }) {
  if (s.status !== 'open') return;
  if (s.win?.closed) { closedByHand(); return; } // in case the window went without a pagehide
  const src = pick(preview, screen, cam);
  if (s.used === 'document') {
    if (src && draw(s.els.canvas, s.els.ctx, src, PAINT_W)) s.els.pic.style.setProperty('--ar', (src.w / src.h).toFixed(4));
    s.script?.tick(performance.now(), s.phase === 'recording');
  } else {
    const { canvas, ctx } = s.classic;
    if (src) draw(canvas, ctx, src, CLASSIC_W, Math.round(CLASSIC_W * STRIP) & ~1);
    stamp(ctx, canvas.width, canvas.height, Math.round(CLASSIC_W * STRIP) & ~1);
  }
  s.frames++;
}

function pick(preview, screen, cam) {
  const ready = (v) => v && v.readyState >= 2 && v.videoWidth > 0;
  if (s.view === 'camera' && ready(cam)) return { el: cam, w: cam.videoWidth, h: cam.videoHeight };
  if (preview) return { el: preview, w: preview.width, h: preview.height };
  if (ready(screen)) return { el: screen, w: screen.videoWidth, h: screen.videoHeight };
  return null;
}

// Draws src across the top of a canvas `w` wide: the canvas takes the
// source's shape, plus `below` pixels under the picture. Returns whether
// the canvas changed size.
function draw(canvas, ctx, src, w, below = 0) {
  const h = Math.max(2, Math.round((w * src.h) / src.w) & ~1);
  const resized = canvas.width !== w || canvas.height !== h + below;
  if (resized) { canvas.width = w; canvas.height = h + below; }
  ctx.drawImage(src.el, 0, 0, w, h);
  return resized;
}

// Classic picture-in-picture has no page around it, so its video carries a
// black strip `strip` pixels tall under the picture, with the dot and the
// clock at its left; nothing is drawn over the picture but the countdown.
function stamp(ctx, w, total, strip) {
  const font = (px) => `700 ${px}px "Fira Sans", "Fira Sans Fallback", sans-serif`;
  const h = total - strip; // the picture's height
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0B0B0B';
  ctx.fillRect(0, h, w, strip);
  if (s.phase === 'countdown') {
    ctx.fillStyle = 'rgba(11, 11, 11, 0.6)';
    ctx.fillRect(0, 0, w, h);
    if (s.count) {
      const side = Math.round(Math.min(h * 0.5, w * 0.3));
      ctx.fillStyle = '#0B0B0B';
      ctx.fillRect((w - side) / 2, (h - side) / 2, side, side);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = font(Math.round(side * 0.77));
      ctx.textAlign = 'center';
      ctx.fillText(s.count, w / 2, h / 2 + side * 0.04);
    }
  } else {
    const size = Math.round(strip * 0.5), pad = Math.round(strip * 0.3), r = size * 0.36, mid = h + strip / 2;
    ctx.font = font(size);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#CF2E12';
    ctx.beginPath();
    ctx.arc(pad + r, mid, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(s.clock, pad + 2 * r + pad * 0.6, mid);
  }
  ctx.restore();
}

// ---------- Classic picture-in-picture ----------

/**
 * Classic picture-in-picture can only show a <video> that already has a
 * picture when Start is clicked, so this makes one at share time: a hidden
 * video fed by a canvas of its own, at the screen's shape (aspect = width
 * over height). Does nothing where the window is used instead.
 */
export function prepare(aspect) {
  if (s.mode !== 'classic') return;
  if (!s.classic) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.className = 'helper';
    video.tabIndex = -1;
    video.setAttribute('aria-hidden', 'true');
    // Closed from its own button: keep recording (close() exits on purpose with the status already closed).
    video.addEventListener('leavepictureinpicture', () => { if (s.status === 'open' && s.used === 'classic') closedByHand(); });
    s.classic = { canvas, ctx, video };
    document.body.append(video);
    video.srcObject = canvas.captureStream(FPS);
  }
  const { canvas, ctx, video } = s.classic;
  canvas.width = CLASSIC_W;
  canvas.height = Math.max(2, Math.round(CLASSIC_W / (aspect || 16 / 9)) & ~1) + (Math.round(CLASSIC_W * STRIP) & ~1);
  ctx.fillStyle = '#0B0B0B';
  ctx.fillRect(0, 0, canvas.width, canvas.height); // a first picture, so the video has a size
  video.play().catch(() => {});
}

function enterClassic() {
  if (!s.classic) throw new DOMException('The picture-in-picture video was not ready', 'InvalidStateError');
  s.classic.video.play().catch(() => {});
  return s.classic.video.requestPictureInPicture();
}

function exitClassic() {
  if (s.classic && document.pictureInPictureElement === s.classic.video) document.exitPictureInPicture().catch(() => {});
}

export const hooks = {
  get mode() { return s.mode; },
  get used() { return s.used; },
  get open() { return s.status === 'open'; },
  get view() { return s.view; },
  get phase() { return s.phase; },
  get clock() { return s.clock; },
  get count() { return s.count; },
  get wholeScreen() { return s.status === 'open' && !!s.opts?.wholeScreen; },
  get opens() { return s.opens; },
  get closedByHand() { return s.byHand; },
  get frames() { return s.frames; },
  get window() { return s.win; },
  get video() { return s.classic?.video || null; },
  get script() { return s.script ? s.script.state() : { shown: false }; },
  get requested() { return s.requested; },
  get canvas() { return s.classic?.canvas || null; },
};
