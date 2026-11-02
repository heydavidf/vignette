// The page side of the phone version's scenario test (mobile-scenario.mjs): the init scripts that change the
// screen share, the function that decodes and measures frames in the page with Mediabunny, and the geometry
// that says where a picture of the screen lands in the phone frame's top band and whether a corner square
// shows there. Corner squares are found by geometry (a uniform square whose inner edges step to the plain
// background on both sides), never by the fake devices' colours, which are the same green on Linux.

// ---------- Init scripts (run in the scenario's pages before their own scripts) ----------
// A 4:3 share, 1440x1080. Chromium's fake screen cannot give one: asked for 1440x1080 it reports that size in
// getSettings() but delivers 1440x810 frames (checked). So this draws a screen of our own, mid grey with a
// white 90 px square in each corner and a black block moving across the middle, and keeps the real share's
// sound.
export const FOUR_THREE = { w: 1440, h: 1080, side: 90 };
export function fourThreeShare() {
  const md = navigator.mediaDevices, real = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = async (c) => {
    const shared = await real(c);
    shared.getVideoTracks().forEach((t) => t.stop());
    const W = 1440, H = 1080, S = 90;
    const cv = Object.assign(document.createElement('canvas'), { width: W, height: H }), ctx = cv.getContext('2d');
    let n = 0;
    const paint = () => {
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      for (const [x, y] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) ctx.fillRect(x, y, S, S);
      ctx.fillStyle = '#000'; ctx.fillRect(400 + ((n++ * 8) % 560), 500, 80, 80);
    };
    paint();
    const stream = cv.captureStream(30);
    setInterval(paint, 33);
    shared.getAudioTracks().forEach((t) => stream.addTrack(t));
    return stream;
  };
}
// A small share: asks the fake screen for 640x360 instead of the recorder's up-to-1080p.
export function smallShare() {
  const md = navigator.mediaDevices, real = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = (c) => real({ ...c, video: { frameRate: { ideal: 30 }, width: { ideal: 640 }, height: { ideal: 360 } } });
}

// ---------- In the page: decode and measure ----------
// Frames of the edit step's phone file ('mobile'), its landscape file ('exported'), or a URL, at `times`.
// Returns {duration, frames}; per frame: its size, each box's mean luma and the means of its four quarters,
// and the luma along each row or column (the mean of three neighbouring lines), in the frame's own pixels.
export async function frames({ mb, src, times = [0], boxes = [], rows = [], cols = [] }) {
  const M = await import(mb);
  const blob = src.startsWith('/') ? await (await fetch(src)).blob() : window.__vignette.editor[src].blob;
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
  const out = [];
  let duration = null;
  try {
    duration = await input.computeDuration();
    const sink = new M.CanvasSink(await input.getPrimaryVideoTrack());
    for (const t of times) {
      const f = await sink.getCanvas(t);
      if (!f) { out.push({ t, missing: true }); continue; }
      const cv = f.canvas, w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
      const Y = (x, y) => {
        const k = 4 * (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x))));
        return 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      };
      const mean = (x0, y0, x1, y1) => {
        let s = 0, n = 0;
        for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) { s += Y(x, y); n++; }
        return n ? s / n : NaN;
      };
      const box = ({ x0, y0, x1, y1 }) => {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        return { y: mean(x0, y0, x1, y1), q: [mean(x0, y0, mx, my), mean(mx, y0, x1, my), mean(x0, my, mx, y1), mean(mx, my, x1, y1)] };
      };
      const line = (along, at, from, to) => Array.from({ length: Math.round(to - from) }, (_, i) => {
        const a = from + i;
        return along === 'x' ? (Y(a, at - 1) + Y(a, at) + Y(a, at + 1)) / 3 : (Y(at - 1, a) + Y(at, a) + Y(at + 1, a)) / 3;
      });
      out.push({
        t: f.timestamp, w, h,
        boxes: Object.fromEntries(boxes.map((b) => [b.name, box(b)])),
        rows: Object.fromEntries(rows.map((r) => [r.name, line('x', r.y, r.x0, r.x1)])),
        cols: Object.fromEntries(cols.map((c) => [c.name, line('y', c.x, c.y0, c.y1)])),
      });
    }
  } finally { input.dispose(); }
  return { duration, frames: out };
}

// ---------- Geometry ----------
// Where the region of a screen sw by sh lands in the phone frame's top band (bandW by bandH, cover):
// the scale and the source point at the band's top left. box is {x, y, w, h} as shares of the screen.
export function bandMap(box, sw, sh, bandW, bandH) {
  const pw = box.w * sw, ph = box.h * sh, scale = Math.max(bandW / pw, bandH / ph);
  const sx = box.x * sw + (pw - bandW / scale) / 2, sy = box.y * sh + (ph - bandH / scale) / 2;
  return { scale, sx, sy, at: (X, Y) => ({ x: (X - sx) * scale, y: (Y - sy) * scale }) };
}
// The boxes that tell whether a corner square of side k (output pixels) shows at each corner of a band W by H:
// inside the square, and the plain picture just past each of its inner edges (u runs in from the corner's
// side, v in from its top or bottom). Past the edges they keep to the square's inner half, clear of the fake
// screen's clock beside the top left square.
export function cornerBoxes(W, H, k) {
  const at = (c, u0, v0, u1, v1) => {
    const [x0, x1] = c[1] === 'l' ? [u0, u1] : [W - u1, W - u0];
    const [y0, y1] = c[0] === 't' ? [v0, v1] : [H - v1, H - v0];
    return { x0, y0, x1, y1 };
  };
  return ['tl', 'tr', 'bl', 'br'].flatMap((c) => [
    { name: `${c}In`, ...at(c, 0.15 * k, 0.15 * k, 0.85 * k, 0.85 * k) },
    { name: `${c}U`, ...at(c, 1.2 * k, 0.6 * k, 1.7 * k, 0.9 * k) },
    { name: `${c}V`, ...at(c, 0.6 * k, 1.2 * k, 0.9 * k, 1.7 * k) },
  ]);
}
// The phone frame (1080x1920) below the band: the 2 px black rule, then the camera filling its band edge to edge
  // (or, without a camera shown, the background). Boxes for frames().
export const below = (bandH, PW = 1080, PH = 1920, RULE = 2) => [
  { name: 'rule', x0: 40, y0: bandH, x1: PW - 40, y1: bandH + RULE }, { name: 'bandBottom', x0: 300, y0: bandH - 10, x1: 780, y1: bandH - 3 },
  { name: 'bandLeft', x0: 1, y0: bandH * 0.3, x1: 8, y1: bandH * 0.7 }, { name: 'bandRight', x0: PW - 8, y0: bandH * 0.3, x1: PW - 1, y1: bandH * 0.7 },
  { name: 'camTop', x0: 40, y0: bandH + RULE + 4, x1: PW - 40, y1: bandH + RULE + 12 }, { name: 'camBottom', x0: 40, y0: PH - 12, x1: PW - 40, y1: PH - 3 },
  { name: 'camL', x0: 1, y0: bandH + 60, x1: 8, y1: PH - 60 }, { name: 'camR', x0: PW - 8, y0: bandH + 60, x1: PW - 1, y1: PH - 60 },
];
// Whether corner c shows a square in a measured frame: the inside uniform (its quarters within 8), stepping by
// more than 10 to the picture past both inner edges, which match each other (within 6). A picture that runs on
// past the edges (the fake screen's turning disc) or a wedge through the corner does not count.
export function cornerShown(f, c) {
  const i = f.boxes[`${c}In`], u = f.boxes[`${c}U`].y, v = f.boxes[`${c}V`].y;
  const spread = Math.max(...i.q) - Math.min(...i.q);
  return { shown: spread < 8 && Math.abs(i.y - u) > 10 && Math.abs(i.y - v) > 10 && Math.abs(u - v) < 6, inside: i.y, u, v, spread };
}
// A step in a luma line: its two levels (the medians of the first and last eight samples), its height, where
// it crosses half way (in samples from the line's start, interpolated) and how many samples it takes to go
// from 10% to 90% of the way.
export function edge(line) {
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const lo = med(line.slice(0, 8)), hi = med(line.slice(-8)), rise = hi - lo;
  const cross = (frac) => {
    const level = lo + frac * rise;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      if ((a - level) * (b - level) <= 0 && a !== b) return i - 1 + (level - a) / (b - a);
    }
    return NaN;
  };
  return { lo, hi, height: Math.abs(rise), mid: cross(0.5), width: Math.abs(cross(0.9) - cross(0.1)) };
}
