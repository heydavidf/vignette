// The page side of the layouts scenario test (layouts-scenario.mjs): the init scripts that stand in for a wider
// screen, a portrait camera and a download that drops, the functions that decode and measure frames in the
// page with Mediabunny, small helpers for what they return, and a look into wrangler dev's local R2 store.
import { spawn } from 'node:child_process';

export const PORTRAIT = { w: 720, h: 960 }; // the portrait camera drawn by portraitCamera()

// ---------- Init scripts (run in the scenario's pages before their own scripts) ----------
// A 2560x1440 share: the recorder asks for at most 1080p, so this asks the fake screen for 2560x1440 instead,
// leaving the renderer's own 1080p cap as the only one.
export function wideShare() {
  const md = navigator.mediaDevices, real = md.getDisplayMedia.bind(md);
  md.getDisplayMedia = (c) => real({ ...c, video: { frameRate: { ideal: 30 }, width: { ideal: 2560 }, height: { ideal: 1440 } } });
}
// A portrait camera with known geometry, 720x960: mid grey, black bars down both sides (x 0 to 80 and 640 to
// 720, inside the strips a centred cover crop into Split's column takes away), a white upright bar at the
// centre (x 348 to 372), a white level bar at the centre (y 468 to 492), and a small square that moves.
export function portraitCamera() {
  const md = navigator.mediaDevices, real = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    if (!c?.video) return real(c);
    const cv = Object.assign(document.createElement('canvas'), { width: 720, height: 960 }), ctx = cv.getContext('2d');
    let n = 0;
    const paint = () => {
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 720, 960);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 80, 960); ctx.fillRect(640, 0, 80, 960);
      ctx.fillStyle = '#fff'; ctx.fillRect(348, 0, 24, 960); ctx.fillRect(0, 468, 720, 24);
      ctx.fillStyle = '#404040'; ctx.fillRect(140 + (n++ % 120), 720, 40, 40);
    };
    paint();
    const stream = cv.captureStream(30);
    setInterval(paint, 33);
    return stream;
  };
}
// The screen original's download breaks half way: its body errors as a dropped connection does.
export function brokenScreenDownload() {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await real(input, init);
    if (!/\/raw\/screen$/.test(typeof input === 'string' ? input : input.url) || !res.ok) return res;
    const half = (Number(res.headers.get('content-length')) || 0) / 2, reader = res.body.getReader();
    let sent = 0;
    const body = new ReadableStream({
      async pull(ctl) {
        if (sent >= half) { reader.cancel().catch(() => {}); ctl.error(new TypeError('network error')); return; }
        const { done, value } = await reader.read();
        if (done) ctl.close(); else { sent += value.length; ctl.enqueue(value); }
      },
    });
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

// ---------- In the page: decode and measure ----------
// Frames of a video ('exported', 'video', 'camera' from the edit step, or 'media' fetched from /media/<id>) at
// its own size, or a JPEG ('thumb' from the edit step, 'thumbUrl' from /thumb/<id>). Boxes, rows and columns
// are given in the pixels of a reference frame `ref` and scaled to what was decoded. Returns, per frame, the
// mean luma and colour of each box and the luma along each row or column.
export async function measure({ mb, src, id, times = [0], ref, boxes = [], rows = [], cols = [] }) {
  const M = await import(mb), ed = window.__vignette.editor, pics = [];
  let duration = null;
  if (src === 'thumb' || src === 'thumbUrl') {
    const bmp = await createImageBitmap(src === 'thumb' ? ed.thumb.blob : await (await fetch(`/thumb/${id}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d').drawImage(bmp, 0, 0);
    pics.push({ t: 0, canvas: cv });
  } else {
    const blob = src === 'media' ? await (await fetch(`/media/${id}`)).blob() : ed[src].blob;
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
    try {
      const sink = new M.CanvasSink(await input.getPrimaryVideoTrack());
      duration = await input.computeDuration();
      for (const t of times) { const f = await sink.getCanvas(t); pics.push({ t: f?.timestamp ?? null, canvas: f?.canvas }); }
    } finally { input.dispose(); }
  }
  return {
    duration,
    frames: pics.map(({ t, canvas }) => {
      if (!canvas) return { t, missing: true };
      const w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data, s = w / ref.W;
      const px = (x, y) => { const k = 4 * (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))); return [d[k], d[k + 1], d[k + 2]]; };
      const Y = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const box = ({ x0, y0, x1, y1 }) => {
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = Math.round(y0 * s); y < Math.round(y1 * s); y++) for (let x = Math.round(x0 * s); x < Math.round(x1 * s); x++) { px(x, y).forEach((v, i) => { sum[i] += v; }); n++; }
        const [r, g, b] = sum.map((v) => v / n);
        return { r, g, b, y: Y([r, g, b]) };
      };
      const line = (along, at, from, to) => Array.from({ length: Math.round((to - from) * s) }, (_, i) => {
        const a = Math.round(from * s) + i, c = Math.round(at * s);
        return (Y(along === 'x' ? px(a, c - 1) : px(c - 1, a)) + Y(along === 'x' ? px(a, c) : px(c, a)) + Y(along === 'x' ? px(a, c + 1) : px(c + 1, a))) / 3;
      });
      return {
        t, w, h,
        boxes: Object.fromEntries(boxes.map((b) => [b.name, box(b)])),
        rows: Object.fromEntries(rows.map((r) => [r.name, line('x', r.y, r.x0, r.x1)])),
        cols: Object.fromEntries(cols.map((c) => [c.name, line('y', c.x, c.y0, c.y1)])),
      };
    }),
  };
}
// Camera only: how far the export's frames at `times` are from each other and from the camera file's last
// frame (and one 0.3 s before it), all decoded 640 wide. The figure is the largest mean luma difference of the
// 8x8 blocks, so the fake camera's small moving parts count.
export async function heldDiffs({ mb, times }) {
  const M = await import(mb), ed = window.__vignette.editor;
  const ins = [ed.exported.blob, ed.camera.blob].map((b) => new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(b) }));
  const luma = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, y = new Float32Array(cv.width * cv.height);
    for (let i = 0; i < y.length; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    return { y, w: cv.width, h: cv.height };
  };
  const diff = (a, b) => {
    const sum = new Float64Array(64), n = new Float64Array(64);
    for (let j = 0; j < a.h; j++) for (let i = 0; i < a.w; i++) { const g = Math.floor((8 * j) / a.h) * 8 + Math.floor((8 * i) / a.w); sum[g] += Math.abs(a.y[j * a.w + i] - b.y[j * a.w + i]); n[g]++; }
    return Math.max(...sum.map((v, g) => v / n[g]));
  };
  try {
    const [out, cam] = await Promise.all(ins.map(async (i) => new M.CanvasSink(await i.getPrimaryVideoTrack(), { width: 640 })));
    const recent = [];
    for await (const f of cam.canvases()) { recent.push({ t: f.timestamp, l: luma(f.canvas) }); while (recent[0].t < f.timestamp - 0.6) recent.shift(); }
    const last = recent.at(-1), earlier = recent.findLast((f) => f.t <= last.t - 0.3) ?? recent[0];
    const ex = [];
    for (const t of times) { const f = await out.getCanvas(t); ex.push({ t: f.timestamp, l: luma(f.canvas) }); }
    return {
      camLast: last.t, camEarlier: earlier.t, duration: await ins[0].computeDuration(),
      frames: ex.map((e) => ({ t: e.t, w: e.l.w, h: e.l.h, toLast: diff(e.l, last.l), toEarlier: diff(e.l, earlier.l) })),
      pairs: ex.map((e, i) => ex.map((f, j) => (j > i ? diff(e.l, f.l) : null))),
    };
  } finally { ins.forEach((i) => i.dispose()); }
}

// What a box's colour is near: a padded colour within 30 on each channel.
export const isColour = (c, [r, g, b]) => Math.abs(c.r - r) < 30 && Math.abs(c.g - g) < 30 && Math.abs(c.b - b) < 30;
export const rgb = (c) => `rgb(${[c.r, c.g, c.b].map((v) => v.toFixed(0)).join(',')})`;
// The longest run of samples above `min` in a luma line: {start, end, mid} in the line's samples.
export function run(line, min) {
  let best = null;
  for (let i = 0; i < line.length;) {
    if (line[i] <= min) { i++; continue; }
    let j = i;
    while (j < line.length && line[j] > min) j++;
    if (!best || j - i > best.end - best.start) best = { start: i, end: j, mid: (i + j) / 2 };
    i = j;
  }
  return best;
}
// The R2 store under wrangler dev's --persist-to folder: keys holding `id`, and their multipart uploads.
export function r2Keys(dir, id) {
  const script = `const { DatabaseSync } = require('node:sqlite'), fs = require('node:fs'), path = require('node:path');
    const [dir, id] = process.argv.slice(1), d = path.join(dir, 'v3', 'r2', 'miniflare-R2BucketObject'), out = { objects: [], uploads: [] };
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')) {
      const db = new DatabaseSync(path.join(d, f), { readOnly: true });
      out.objects.push(...db.prepare('SELECT key FROM _mf_objects WHERE key LIKE ?').all('%' + id + '%').map((r) => r.key));
      out.uploads.push(...db.prepare('SELECT key, state FROM _mf_multipart_uploads WHERE key LIKE ?').all('%' + id + '%').map((r) => ({ key: r.key, state: r.state })));
      db.close();
    }
    console.log(JSON.stringify(out));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '-e', script, dir, id], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`reading the R2 store failed: ${out}`))));
  });
}

