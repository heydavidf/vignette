// The webcam bubble: where it sits on the frame and how big it is.
// One record serves both the bubble on screen (a DOM element you drag over
// the preview) and the compositor in recorder.js, which calls draw() every
// frame. Both place it with the same place() maths, so the recording shows
// the bubble exactly where it was put, during recording too.
//
// Position is the bubble's centre as a share of the frame, 0 to 1 on each
// axis. Size is the radius as a share of the frame's shorter edge.

const KEY = 'vignette.bubble';
export const SIZES = { small: 0.10, medium: 0.14, large: 0.20 };
const RING = 0.03;     // black ring, as a share of the diameter (matches app.css)
const MARGIN = 0.025;  // gap kept from the frame edge, as a share of the shorter edge
const STEP = 0.02;     // arrow key nudge; Shift moves five times as far

let pos = { x: 0, y: 1, size: 'medium' }; // bottom left, medium
let frame = { w: 16, h: 9 };              // size of the picture being shown (only its shape matters)
let ui = null;
export let lastDraw = null;               // what the compositor last drew, for the test

// Keeps the whole bubble (plus margin) inside a frame w by h.
function clamp(p, w, h) {
  const short = Math.min(w, h);
  const keep = (SIZES[p.size] + MARGIN) * short;
  const fit = (v, len) => Math.min(Math.max(v * len, keep), len - keep) / len;
  return { x: fit(p.x, w), y: fit(p.y, h), size: p.size };
}

// Centre and radius in pixels for a frame W by H.
export function place(W, H) {
  const p = clamp(pos, W, H);
  return { cx: p.x * W, cy: p.y * H, r: SIZES[p.size] * Math.min(W, H) };
}

export function get() { return { ...pos }; }

// Accepts any of {x, y, size}; ignores values that do not make sense.
export function set(next = {}, { save = true } = {}) {
  const p = { ...pos };
  if (Number.isFinite(next.x)) p.x = next.x;
  if (Number.isFinite(next.y)) p.y = next.y;
  if (next.size in SIZES) p.size = next.size;
  pos = clamp(p, frame.w, frame.h);
  render();
  if (save) store();
  return get();
}

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* storage blocked: keep it for this visit */ }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') set(saved, { save: false });
  } catch { /* storage blocked or unreadable: use the default */ }
}

// The frame changed shape (a new share, or back to the empty 16:9 well).
// The well and the picture inside it both read --ar.
export function setFrame(w, h) {
  frame = { w, h };
  ui?.frame.parentElement.style.setProperty('--ar', (w / h).toFixed(4));
  pos = clamp(pos, w, h);
  render();
}

// Live webcam stream to show inside the bubble, or null for the placeholder.
export function setLive(stream) {
  if (!ui) return;
  if (ui.video.srcObject !== stream) ui.video.srcObject = stream;
  ui.el.dataset.live = String(!!stream);
  if (stream) ui.video.play().catch(() => {});
}

// Whether the webcam toggle is on; the placeholder shows it struck when off.
export function setCam(on) {
  if (ui) ui.el.dataset.cam = on ? 'on' : 'off';
}

function render() {
  if (!ui) return;
  const d = (2 * SIZES[pos.size] * Math.min(frame.w, frame.h)) / frame.w;
  ui.el.style.setProperty('--bx', pos.x.toFixed(5));
  ui.el.style.setProperty('--by', pos.y.toFixed(5));
  ui.el.style.setProperty('--bd', d.toFixed(5));
  for (const r of ui.sizes) r.checked = r.value === pos.size;
}

// Draws the bubble onto the composite canvas: a black ring, then the
// webcam picture centre-cropped to a circle inside it.
export function draw(ctx, video, W, H) {
  const { cx, cy, r } = place(W, H);
  const inner = r * (1 - 2 * RING);
  const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0B0B0B'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, cx - inner, cy - inner, inner * 2, inner * 2);
  ctx.restore();
  lastDraw = { x: cx / W, y: cy / H, size: pos.size };
}

// ---------- Moving it: pointer (mouse, pen, touch) and keyboard ----------
function onPointerDown(e) {
  if (e.button !== 0) return;
  const box = ui.el.getBoundingClientRect();
  const grab = { dx: e.clientX - (box.left + box.width / 2), dy: e.clientY - (box.top + box.height / 2) };
  ui.el.setPointerCapture(e.pointerId);
  ui.el.classList.add('dragging');
  const move = (ev) => {
    const f = ui.frame.getBoundingClientRect();
    set({ x: (ev.clientX - grab.dx - f.left) / f.width, y: (ev.clientY - grab.dy - f.top) / f.height }, { save: false });
  };
  const end = () => {
    ui.el.classList.remove('dragging');
    ui.el.removeEventListener('pointermove', move);
    ui.el.removeEventListener('pointerup', end);
    ui.el.removeEventListener('pointercancel', end);
    store();
  };
  ui.el.addEventListener('pointermove', move);
  ui.el.addEventListener('pointerup', end);
  ui.el.addEventListener('pointercancel', end);
  e.preventDefault();
}

function onKey(e) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  const step = e.shiftKey ? STEP * 5 : STEP;
  set({ x: pos.x + d[0] * step, y: pos.y + d[1] * step });
}

// el: the bubble; video: the <video> inside it; frame: the element the
// bubble moves over; sizes: the Small, Medium, Large radio inputs.
export function init({ el, video, frame: frameEl, sizes }) {
  ui = { el, video, frame: frameEl, sizes: [...sizes] };
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('keydown', onKey);
  for (const r of ui.sizes) r.addEventListener('change', () => { if (r.checked) set({ size: r.value }); });
  setFrame(16, 9);
  load();
  render();
}
