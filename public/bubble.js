// The webcam bubble: where it sits on the frame and how big it is.
// One stored position serves every bubble on the page: the live one you drag
// over the recorder's preview and the one over the edit step's player, where
// the final place is chosen. Each is a view with its own frame; moving
// either moves both. The live preview compositor (recorder.js) and the
// export renderer (render.js) draw it with the same place() maths, so the
// video shows the bubble exactly where it was left.
//
// Position is the bubble's centre as a share of the frame, 0 to 1 on each
// axis. Size is the radius as a share of the frame's shorter edge.

const KEY = 'vignette.bubble';
export const SIZES = { small: 0.10, medium: 0.14, large: 0.20 };
const RING = 0.03;     // black ring, as a share of the diameter (matches app.css)
const MARGIN = 0.025;  // gap kept from the frame edge, as a share of the shorter edge
const STEP = 0.02;     // arrow key nudge; Shift moves five times as far

let shape = { w: 16, h: 9 };              // the frame a set() without one clamps to: the view shaped last
let pos = clamp({ x: 0, y: 1, size: 'medium' }, shape.w, shape.h); // bottom left, medium
const views = [];
const listeners = [];
export let lastDraw = null;               // what the live compositor last drew, for the test

// Keeps the whole bubble (plus margin) inside a frame w by h.
function clamp(p, w, h) {
  const short = Math.min(w, h);
  const keep = (SIZES[p.size] + MARGIN) * short;
  const fit = (v, len) => Math.min(Math.max(v * len, keep), len - keep) / len;
  return { x: fit(p.x, w), y: fit(p.y, h), size: p.size };
}

// Centre and radius in pixels of a bubble at p on a frame W by H.
export function placeOn(p, W, H) {
  const c = clamp(p, W, H);
  return { cx: c.x * W, cy: c.y * H, r: SIZES[c.size] * Math.min(W, H) };
}
export const place = (W, H) => placeOn(pos, W, H);

export function get() { return { ...pos }; }

// Runs fn() after every change of place or size (the edit step refreshes its thumbnail).
export function onChange(fn) { listeners.push(fn); }

// Accepts any of {x, y, size}; ignores values that do not make sense.
// The new place is kept inside a frame w by h (the frame being dragged on).
export function set(next = {}, { save = true, w = shape.w, h = shape.h } = {}) {
  const p = { ...pos };
  if (Number.isFinite(next.x)) p.x = next.x;
  if (Number.isFinite(next.y)) p.y = next.y;
  if (next.size in SIZES) p.size = next.size;
  pos = clamp(p, w, h);
  views.forEach(render);
  if (save) store();
  listeners.forEach((fn) => fn());
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

// Paints a bubble at p onto a canvas W by H: a black ring, then the camera
// picture centre-cropped to a circle inside it. The picture is srcW by srcH;
// drawSource(sx, sy, sw, sh, dx, dy, dw, dh) draws part of it, as drawImage
// does. Returns where it went, as shares of the frame.
export function paint(ctx, p, W, H, srcW, srcH, drawSource) {
  const { cx, cy, r } = placeOn(p, W, H);
  const inner = r * (1 - 2 * RING);
  const side = Math.min(srcW, srcH);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#0B0B0B'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2); ctx.clip();
  drawSource((srcW - side) / 2, (srcH - side) / 2, side, side, cx - inner, cy - inner, inner * 2, inner * 2);
  ctx.restore();
  return { x: cx / W, y: cy / H, size: p.size };
}

// The live preview: the bubble where it sits right now, from a <video>.
export function draw(ctx, video, W, H) {
  lastDraw = paint(ctx, pos, W, H, video.videoWidth, video.videoHeight, (...a) => ctx.drawImage(video, ...a));
}

// ---------- Views: a bubble element over a frame ----------

function render(v) {
  const p = clamp(pos, v.w, v.h);
  const d = (2 * SIZES[p.size] * Math.min(v.w, v.h)) / v.w;
  v.el.style.setProperty('--bx', p.x.toFixed(5));
  v.el.style.setProperty('--by', p.y.toFixed(5));
  v.el.style.setProperty('--bd', d.toFixed(5));
  for (const r of v.sizes) r.checked = r.value === p.size;
}

// Moving it: pointer (mouse, pen, touch) and keyboard.
function onPointerDown(v, e) {
  if (e.button !== 0) return;
  const box = v.el.getBoundingClientRect();
  const grab = { dx: e.clientX - (box.left + box.width / 2), dy: e.clientY - (box.top + box.height / 2) };
  v.el.setPointerCapture(e.pointerId);
  v.el.classList.add('dragging');
  const move = (ev) => {
    const f = v.frame.getBoundingClientRect();
    set({ x: (ev.clientX - grab.dx - f.left) / f.width, y: (ev.clientY - grab.dy - f.top) / f.height }, { save: false, w: v.w, h: v.h });
  };
  const end = () => {
    v.el.classList.remove('dragging');
    v.el.removeEventListener('pointermove', move);
    v.el.removeEventListener('pointerup', end);
    v.el.removeEventListener('pointercancel', end);
    store();
  };
  v.el.addEventListener('pointermove', move);
  v.el.addEventListener('pointerup', end);
  v.el.addEventListener('pointercancel', end);
  e.preventDefault();
}

function onKey(v, e) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  const step = e.shiftKey ? STEP * 5 : STEP;
  set({ x: pos.x + d[0] * step, y: pos.y + d[1] * step }, { w: v.w, h: v.h });
}

// el: the bubble; video: the <video> inside it; frame: the element the
// bubble moves over (exactly the picture); sizes: Small, Medium, Large radios.
// Returns the view's controls.
export function attach({ el, video, frame, sizes }) {
  const v = { el, video, frame, sizes: [...sizes], w: 16, h: 9 };
  views.push(v);
  el.addEventListener('pointerdown', (e) => onPointerDown(v, e));
  el.addEventListener('keydown', (e) => onKey(v, e));
  for (const r of v.sizes) r.addEventListener('change', () => { if (r.checked) set({ size: r.value }, { w: v.w, h: v.h }); });
  render(v);
  return {
    // The picture changed shape (a new share, a recording opened, or back
    // to the empty 16:9 well). The frame's parent reads --ar.
    setFrame(w, h) {
      v.w = w; v.h = h; shape = { w, h };
      frame.parentElement.style.setProperty('--ar', (w / h).toFixed(4));
      render(v);
    },
    // A live webcam stream to show inside the bubble, or null for the placeholder.
    setLive(stream) {
      if (video.srcObject !== stream) video.srcObject = stream;
      el.dataset.live = String(!!stream);
      if (stream) video.play().catch(() => {});
    },
    // Whether the webcam is on; the placeholder shows it struck when off.
    setCam(on) { el.dataset.cam = on ? 'on' : 'off'; },
  };
}

load();
