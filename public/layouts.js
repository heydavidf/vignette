// Layouts: how a recording with a camera is composed in the exported video.
// This file owns the list and the geometry; the renderer (render.js), the
// thumbnail (grabLayout in render.js) and the edit step's live preview
// (layout-tools.js, through CSS custom properties) all read the same boxes,
// so they agree to the pixel. Nothing here touches the page.
//
// A layout's frame(screenW, screenH, cameraW, cameraH) gives the output
// frame and where each picture goes, in output pixels:
//   {W, H, screen: {x, y, w, h, fit} | null, camera: {x, y, w, h, fit} | null, background}
// fit is 'contain' (the whole picture, letterboxed on the background),
// 'cover' (the box filled, the picture centre-cropped) or 'bubble' (the
// camera painted by bubble.js at the stored place, size and shape).
//
// Stored value (D1 `layout`, the upload's `layout`): the id, and for padded
// its colour after a colon: 'bubble', 'split', 'camera', 'screen' or
// 'padded:cream' (or :black, :grey, :vermilion). The bubble's place, size
// and shape are stored apart, in `bubble`.
//
// Test hooks (window.__vignette, set up in recorder.js):
//   layout.id       the edit step's layout: 'bubble' | 'split' | 'camera' | 'screen' | 'padded'
//   layout.colour   the padded colour: 'cream' | 'black' | 'grey' | 'vermilion'
//   layout.shape    the bubble's shape: 'round' | 'square'
//   layout.value    what an upload stores now, for example 'padded:grey'
//   layout.offered  the layouts the strip offers (the others are disabled plates)
//   layout.set(id, colour)  picks a layout (and colour) as a click on its plate would
//   layout.geometry()       the frame and boxes the preview shows, in output pixels
//   again.state     'off' | 'loading' | 'ready' | 'failed': rendering an uploaded recording again (/?again=<id>)
//   again.id        the recording being rendered again, or null
//   again.progress  {sent, total} bytes of the originals downloaded so far
//   again.error     what went wrong, as shown on the band, or ''
// The phone version's hooks (window.__vignette.phone) are listed at the top of region.js.
//
// The phone version (mobile() below) is not one of the five: it is a second,
// vertical file rendered beside the layout's, from a region of the screen.

const MAX_W = 1920, MAX_H = 1080; // the output is capped at 1080p, as recordings are
const SPLIT = 0.7;                // split: the screen's share of the width
const RULE = 2;                   // split: a black rule between the screen and the camera, in output pixels
const PAD = 0.86;                 // padded: the screen's share of the width and height
const PHONE_W = 1080, PHONE_H = 1920; // the phone version's frame, 9:16
const BANDS = { wide: 608, square: 1080 }; // the phone version's top band, by the region's shape

export const COLOURS = { cream: '#F1E8D0', black: '#0B0B0B', grey: '#E6E6E6', vermilion: '#CF2E12' };
export const DEFAULT_COLOUR = 'cream';
const BLACK = '#0B0B0B';

const even = (n) => Math.max(2, Math.round(n) & ~1); // H.264 wants even sides
// A picture's own size, capped at 1080p with its shape kept.
function capped(w, h) {
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  return { W: even(w * scale), H: even(h * scale) };
}
const whole = (W, H, fit) => ({ x: 0, y: 0, w: W, h: H, fit });

export const LAYOUTS = [
  {
    id: 'bubble', label: 'Bubble', glyph: 'lay-bubble', needsCamera: true,
    frame(sw, sh) { const { W, H } = capped(sw, sh); return { W, H, screen: whole(W, H, 'contain'), camera: whole(W, H, 'bubble'), background: BLACK }; },
  },
  {
    id: 'split', label: 'Split', glyph: 'lay-split', needsCamera: true,
    frame(sw, sh) {
      const { W, H } = capped(sw, sh);
      const cut = even(W * SPLIT);
      return { W, H, screen: { x: 0, y: 0, w: cut, h: H, fit: 'contain' }, camera: { x: cut + RULE, y: 0, w: W - cut - RULE, h: H, fit: 'cover' }, background: BLACK };
    },
  },
  {
    id: 'camera', label: 'Camera only', glyph: 'lay-camera', needsCamera: true,
    frame(sw, sh, cw, ch) { const { W, H } = capped(cw || sw, ch || sh); return { W, H, screen: null, camera: whole(W, H, 'cover'), background: BLACK }; },
  },
  {
    id: 'screen', label: 'Screen only', glyph: 'lay-screen', needsCamera: false,
    frame(sw, sh) { const { W, H } = capped(sw, sh); return { W, H, screen: whole(W, H, 'contain'), camera: null, background: BLACK }; },
  },
  {
    id: 'padded', label: 'Padded', glyph: 'lay-padded', needsCamera: false,
    frame(sw, sh, cw, ch, colour = DEFAULT_COLOUR) {
      const { W, H } = capped(sw, sh);
      const w = Math.round(W * PAD), h = Math.round(H * PAD);
      return { W, H, screen: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, fit: 'contain' }, camera: null, background: COLOURS[colour] || COLOURS[DEFAULT_COLOUR] };
    },
  },
];
const BY_ID = Object.fromEntries(LAYOUTS.map((l) => [l.id, l]));
export const layoutOf = (id) => BY_ID[id] || BY_ID.bubble;

// The frame and boxes for a layout. colour is used by padded only.
export function geometry(id, screenW, screenH, cameraW, cameraH, colour) {
  return layoutOf(id).frame(screenW, screenH, cameraW, cameraH, colour);
}

// '{id}' or 'padded:{colour}' from the two, and back. Unknown values read as bubble.
export function layoutValue(id, colour) {
  return id === 'padded' ? `padded:${COLOURS[colour] ? colour : DEFAULT_COLOUR}` : (BY_ID[id] ? id : 'bubble');
}
export function parseLayout(value) {
  const [id, colour] = String(value || 'bubble').split(':');
  return { id: BY_ID[id] ? id : 'bubble', colour: COLOURS[colour] ? colour : DEFAULT_COLOUR };
}

// Where a picture srcW by srcH lands in `box` with its fit: the part of the
// source to take (sx, sy, sw, sh) and where it goes (dx, dy, dw, dh), as
// drawImage takes them. 'contain' takes the whole picture and centres it;
// 'cover' fills the box and centre-crops the picture. With `region` ({x, y,
// w, h} as shares of the picture) only that part of the picture is used.
export function fitRect(box, srcW, srcH, fit = 'contain', region = null) {
  const ox = region ? region.x * srcW : 0, oy = region ? region.y * srcH : 0;
  const pw = region ? region.w * srcW : srcW, ph = region ? region.h * srcH : srcH;
  const cover = fit === 'cover';
  const scale = (cover ? Math.max : Math.min)(box.w / pw, box.h / ph);
  if (cover) {
    const sw = box.w / scale, sh = box.h / scale;
    return { sx: ox + (pw - sw) / 2, sy: oy + (ph - sh) / 2, sw, sh, dx: box.x, dy: box.y, dw: box.w, dh: box.h };
  }
  const dw = pw * scale, dh = ph * scale;
  return { sx: ox, sy: oy, sw: pw, sh: ph, dx: box.x + (box.w - dw) / 2, dy: box.y + (box.h - dh) / 2, dw, dh };
}

// The phone version: a 1080x1920 frame. The region of the screen (shares of
// the screen picture, from region.js) is cover-cropped into the top band,
// 1080x608 for a wide region and 1080x1080 for a square one; with a camera,
// the camera is cover-cropped into the rest, under a 2px black rule, on
// black. Without one the rest is the background: black, or `colour` (the
// padded colour, when Padded is the layout). The bubble is never drawn here.
export function mobile(region, variant, screenW, screenH, hasCamera, colour) {
  const band = BANDS[variant] || BANDS.wide;
  const top = band + RULE;
  return {
    W: PHONE_W, H: PHONE_H,
    screen: { x: 0, y: 0, w: PHONE_W, h: band, fit: 'cover', region },
    camera: hasCamera ? { x: 0, y: top, w: PHONE_W, h: PHONE_H - top, fit: 'cover' } : null,
    background: !hasCamera && COLOURS[colour] ? COLOURS[colour] : BLACK,
  };
}

// The same geometry at another scale (the thumbnail is 640 wide).
export function scaled(g, s) {
  const box = (b) => b && { ...b, x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s };
  return { ...g, W: Math.round(g.W * s), H: Math.round(g.H * s), screen: box(g.screen), camera: box(g.camera) };
}

// The edit step's preview, as CSS custom properties for #clip (app.css):
// --far, the frame's shape; --lay-bg, its background; --vb-t/r/b/l, an
// object-view-box that puts the screen video's picture exactly where the
// renderer draws it (a picture that is not shown is made tiny in the top
// left corner, under the camera); --cx/cy/cw/ch, the camera's box as shares
// of the frame (the bubble places itself, through bubble.js).
export function previewVars(g, screenW, screenH) {
  const pct = (v) => `${(v * 100).toFixed(4)}%`;
  const far = g.W / g.H;
  let p = g.screen ? fitRect(g.screen, screenW, screenH, g.screen.fit) : null;
  p = p ? { x: p.dx / g.W, y: p.dy / g.H, w: p.dw / g.W, h: p.dh / g.H } : { x: 0, y: 0, w: 0.01, h: (0.01 * far * screenH) / screenW };
  const c = g.camera && g.camera.fit !== 'bubble' ? g.camera : { x: 0, y: 0, w: 0, h: 0 };
  return {
    '--far': far.toFixed(5),
    '--lay-bg': g.background,
    // object-view-box insets are shares of the picture's own size; negative ones leave room round it.
    '--vb-t': pct(-p.y / p.h), '--vb-l': pct(-p.x / p.w),
    '--vb-b': pct((p.y + p.h - 1) / p.h), '--vb-r': pct((p.x + p.w - 1) / p.w),
    '--cx': (c.x / g.W).toFixed(5), '--cy': (c.y / g.H).toFixed(5), '--cw': (c.w / g.W).toFixed(5), '--ch': (c.h / g.H).toFixed(5),
  };
}
