// The phone version's region: the part of the screen picture the vertical
// 9:16 file keeps (docs/LOOP4_MOBILE_EXPORT_SPEC.md). This file owns the
// stored region and its view, a box over the edit step's preview: drag it,
// or select it and use the arrow keys (Shift moves five times as far); the
// Shape pair and the size strip set its shape and size. It never leaves the
// screen picture. phone.js places its area over the picture and reads it;
// layouts.js's mobile() and render.js draw it. Its pointer and keyboard
// handling follow bubble.js's; the two share no state.
//
// Stored: {x, y, size, shape}, x and y the box's centre as shares of the
// screen picture; size 'half' | 'twothirds' | 'whole', the box's width as a
// share of the screen's width; shape 'wide' (16:9) | 'square'. A box too tall
// for the screen at that width (Square on a wide screen) is made as large as
// fits. What the upload stores is the box itself: {x, y, w, h} as shares of
// the screen picture, x and y its top left corner, with the shape apart.
//
// Test hooks (window.__vignette.phone, set up in recorder.js from phone.js):
//   phone.on        whether the Phone version toggle is on (and offered: it is not in Camera only)
//   phone.offered   whether the toggle is offered at all
//   phone.region    the stored region: {x, y, size, shape}
//   phone.box       the kept part as shares of the screen picture: {x, y, w, h}, or null with no recording
//   phone.shape     'wide' | 'square'
//   phone.size      'half' | 'twothirds' | 'whole'
//   phone.set({on, x, y, size, shape})  changes any of them, as the controls would
//   phone.exported  the phone export once rendered: {width, height, size} (size in bytes), or null
//   phone.poster    the phone poster's {width, height}, once drawn, or null

export const SIZES = { half: 1 / 2, twothirds: 2 / 3, whole: 1 };
export const SHAPES = { wide: 16 / 9, square: 1 };
export const DEFAULT_REGION = { x: 0.5, y: 0.5, size: 'twothirds', shape: 'wide' };
const STEP = 0.02; // arrow key nudge, as a share of the screen picture

// The box for a stored region on a screen sw by sh: {x, y, w, h} as shares,
// kept whole on the picture.
export function boxOf(r, sw, sh) {
  let w = SIZES[r.size] * sw, h = w / SHAPES[r.shape];
  if (h > sh) { w *= sh / h; h = sh; }
  const W = w / sw, H = h / sh;
  const fit = (c, len) => Math.min(Math.max(c - len / 2, 0), 1 - len);
  return { x: fit(r.x, W), y: fit(r.y, H), w: W, h: H };
}

// The stored region back from an uploaded box (again mode): its centre, its
// shape, and the size whose box is nearest its width.
export function regionOf(box, shape, sw, sh) {
  const s = SHAPES[shape] ? shape : DEFAULT_REGION.shape;
  const size = Object.keys(SIZES).reduce((best, k) => (
    Math.abs(boxOf({ x: 0.5, y: 0.5, size: k, shape: s }, sw, sh).w - box.w) < Math.abs(boxOf({ x: 0.5, y: 0.5, size: best, shape: s }, sw, sh).w - box.w) ? k : best
  ), DEFAULT_REGION.size);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2, size, shape: s };
}

/**
 * The region's view: `area` covers exactly the screen picture in the preview
 * (placed by place()), `box` is the kept part inside it; `sizes` and `shapes`
 * are the strip's radios. Returns its controls.
 */
export function attachRegion({ area, box, sizes, shapes }) {
  let pos = { ...DEFAULT_REGION };
  let screen = { w: 16, h: 9 };
  const listeners = [];
  sizes = [...sizes];
  shapes = [...shapes];

  function render() {
    const b = boxOf(pos, screen.w, screen.h);
    for (const [k, v] of Object.entries({ '--kx': b.x, '--ky': b.y, '--kw': b.w, '--kh': b.h })) box.style.setProperty(k, v.toFixed(5));
    box.dataset.shape = pos.shape;
    for (const r of sizes) r.checked = r.value === pos.size;
    for (const r of shapes) r.checked = r.value === pos.shape;
  }

  // Accepts any of {x, y, size, shape}; the centre is kept where the whole box stays on the picture.
  function set(next = {}, notify = true) {
    const p = { ...pos };
    if (Number.isFinite(next.x)) p.x = next.x;
    if (Number.isFinite(next.y)) p.y = next.y;
    if (next.size in SIZES) p.size = next.size;
    if (next.shape in SHAPES) p.shape = next.shape;
    const b = boxOf(p, screen.w, screen.h);
    p.x = b.x + b.w / 2;
    p.y = b.y + b.h / 2;
    const changed = ['x', 'y', 'size', 'shape'].some((k) => p[k] !== pos[k]);
    pos = p;
    render();
    if (changed && notify) listeners.forEach((fn) => fn());
  }

  // Moving it: pointer (mouse, pen, touch) and keyboard, as the bubble moves.
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = box.getBoundingClientRect();
    const grab = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
    box.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
    const move = (ev) => {
      const a = area.getBoundingClientRect();
      set({ x: (ev.clientX - grab.dx - a.left) / a.width, y: (ev.clientY - grab.dy - a.top) / a.height });
    };
    const end = () => {
      box.classList.remove('dragging');
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', end);
      box.removeEventListener('pointercancel', end);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    e.preventDefault();
  });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? STEP * 5 : STEP;
    set({ x: pos.x + d[0] * step, y: pos.y + d[1] * step });
  });
  for (const r of sizes) r.addEventListener('change', () => { if (r.checked) set({ size: r.value }); });
  for (const r of shapes) r.addEventListener('change', () => { if (r.checked) set({ shape: r.value }); });
  render();

  return {
    // A recording opened: its screen's size, and the uploaded box and shape (again mode) or none for the default.
    open(sw, sh, stored = null) {
      screen = { w: sw, h: sh };
      pos = stored?.region ? regionOf(stored.region, stored.variant, sw, sh) : { ...DEFAULT_REGION };
      set({}, false);
    },
    // Where the screen picture sits in the preview's frame, as shares of the frame: {x, y, w, h}.
    place(p) {
      for (const [k, v] of Object.entries({ '--ax': p.x, '--ay': p.y, '--aw': p.w, '--ah': p.h })) area.style.setProperty(k, v.toFixed(5));
      area.style.setProperty('--sar', (screen.w / screen.h).toFixed(5));
    },
    get: () => ({ ...pos }),
    box: () => boxOf(pos, screen.w, screen.h),
    set,
    // Runs fn() after every change of place, size or shape.
    onChange(fn) { listeners.push(fn); },
  };
}
