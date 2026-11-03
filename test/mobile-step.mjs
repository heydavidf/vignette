// Steps 3o and 3p of the end-to-end suite (run from e2e.mjs): the phone
// version (docs/LOOP4_MOBILE_EXPORT_SPEC.md). 3o: the toggle, the region box
// (it never leaves the screen picture), the 1080x1920 render with the region
// on top and the camera below the rule (black or the padded colour without
// one), Square's taller band, and the poster. 3p: both files and posters
// stored and served, the share page choosing by the screen with a working
// switch, a refused phone upload retried alone, again mode carrying the
// phone version (replaced, dropped, 409 while uploading), and delete
// removing all six objects.
//
// Chromium's fake screen and camera are the same green on Linux, so nothing
// here tells them apart by colour. The fake screen draws a square in each
// corner (a sixteenth of its width, its brightness ramping over time) on a
// flat background, so the region is found by which corners the phone's top
// band shows; the camera is found below the 2px black rule by geometry
// (picture there, or black, or the padded colour).
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { devices } from 'playwright';

export const MOBILE_STEP = '3o. Phone version: the toggle and the region box (kept on the screen picture), a 1080x1920 render with the region on top and the camera under the rule, black or the padded colour without one, Square\'s band, the poster';
export const MOBILE_UPLOAD_STEP = '3p. Phone version uploaded: both files and posters stored; the share page plays the phone file on a phone and the landscape one on a desktop, with a switch that keeps the time; a refused phone upload retried alone; again mode replaces and drops it; delete removes all six objects';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const VERMILION = [207, 46, 18];
const BAND = { wide: 608, square: 1080 }; // the top band's height in the 1080x1920 frame

// Runs in the page. Decodes `source` ('phone': the phone export, 'poster': the phone plate's picture, or {url})
// 540 wide at `times` and measures each box ({name: [x0, y0, x1, y1]} as shares of the frame): mean r, g, b and
// luma, its median, 10th and 90th percentile luma, and the share of it darker than 30.
async function look({ mb, source, times = [0], boxes }) {
  const M = await import(mb);
  const inputs = [];
  const read = (c) => ({ d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
  try {
    let frameAt;
    if (source === 'poster') {
      const bmp = await createImageBitmap(await (await fetch(document.getElementById('phoneImg').src)).blob());
      const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      c.getContext('2d').drawImage(bmp, 0, 0);
      frameAt = async () => read(c);
    } else {
      const blob = source === 'phone' ? window.__vignette.editor.mobile.blob : await (await fetch(source.url)).blob();
      const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
      inputs.push(input);
      const sink = new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 540 });
      frameAt = async (t) => read((await sink.getCanvas(t)).canvas);
    }
    const out = [];
    for (const t of times) {
      const a = await frameAt(t), f = { t, w: a.w, h: a.h, boxes: {} };
      for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes)) {
        let r = 0, g = 0, b = 0, dark = 0;
        const ys = [];
        for (let y = Math.floor(y0 * a.h); y < Math.ceil(y1 * a.h); y++) {
          for (let x = Math.floor(x0 * a.w); x < Math.ceil(x1 * a.w); x++) {
            const i = 4 * (y * a.w + x), l = 0.2126 * a.d[i] + 0.7152 * a.d[i + 1] + 0.0722 * a.d[i + 2];
            r += a.d[i]; g += a.d[i + 1]; b += a.d[i + 2]; ys.push(l); if (l < 30) dark++;
          }
        }
        const n = ys.length;
        ys.sort((p, q) => p - q);
        f.boxes[name] = { r: r / n, g: g / n, b: b / n, y: ys.reduce((s, v) => s + v, 0) / n, med: ys[n >> 1], p10: ys[Math.floor(n * 0.1)], p90: ys[Math.floor(n * 0.9)], dark: dark / n };
      }
      out.push(f);
    }
    return out;
  } finally { inputs.forEach((i) => i.dispose()); }
}

// The boxes that read a phone frame with a top band `band` px tall: its four corners (where the fake screen's
// corner squares land when the region takes in a corner of the screen; with `sq`, the square's expected size as
// shares of the band's width and height, each box is the middle 70% of where that square would be), a plain
// stretch of the band (ref), the whole band, the rule, just above and below it, and the rest of the frame under it.
function phoneBoxes(band, sq = null) {
  const y = (v) => (v * band) / 1920, H = 1920;
  const [a, b] = sq ? [0.15 * sq.w, 0.85 * sq.w] : [0.015, 0.1], [c, d] = sq ? [0.15 * sq.h, 0.85 * sq.h] : [0.03, 0.18];
  return {
    tl: [a, y(c), b, y(d)], tr: [1 - b, y(c), 1 - a, y(d)], bl: [a, y(1 - d), b, y(1 - c)], br: [1 - b, y(1 - d), 1 - a, y(1 - c)],
    ref: [0.03, y(0.4), 0.2, y(0.6)], band: [0.01, y(0.02), 0.99, y(0.98)],
    rule: [0.05, (band + 0.2) / H, 0.95, (band + 1.8) / H], above: [0.05, (band - 30) / H, 0.95, (band - 6) / H], below: [0.05, (band + 10) / H, 0.95, (band + 40) / H],
    rest: [0.02, (band + 10) / H, 0.98, 0.98],
  };
}
// A corner square shows: its brightness is off the band's plain background, or it ramps across the box.
const shows = (f, k) => Math.abs(f.boxes[k].med - f.boxes.ref.med) > 8 || f.boxes[k].p90 - f.boxes[k].p10 > 20;
const corners = (f) => ['tl', 'tr', 'bl', 'br'].filter((k) => shows(f, k));
const near = (a, b, d) => Math.abs(a - b) <= d;
const isColour = (box, [r, g, b], d = 30) => near(box.r, r, d) && near(box.g, g, d) && near(box.b, b, d);
const rgb = (b) => `rgb(${b.r.toFixed(0)}, ${b.g.toFixed(0)}, ${b.b.toFixed(0)})`;
const hooks = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.__vignette.phone, box: window.__vignette.phone.box, region: window.__vignette.phone.region })));

// Download phone MP4, as a person would; resolves with the hooks and the Details line.
async function exportPhone(page) {
  await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('#downloadPhone')]);
  await page.waitForFunction(() => !document.getElementById('downloadPhone').disabled);
  return page.evaluate(() => ({ out: window.__vignette.phone.exported, line: window.__vignette.details['phone version'], land: window.__vignette.details.layout }));
}
// The region box on screen, as shares of its area (the screen picture), and the area as shares of the frame.
const onScreen = (page) => page.evaluate(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const a = r('regionArea'), b = r('regionBox'), f = r('clipFrame');
  return { x: (b.left - a.left) / a.width, y: (b.top - a.top) / a.height, w: b.width / a.width, h: b.height / a.height, ax: (a.left - f.left) / f.width, aw: a.width / f.width, ah: a.height / f.height };
});
async function drag(page, dx, dy) {
  await page.locator('#regionBox').scrollIntoViewIfNeeded(); // waits out the edit step's smooth scroll
  const b = await page.locator('#regionBox').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
  return hooks(page);
}

export async function mobileStep(page, { record, assert, ok }) {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.check('#cam');
  await record(page, 4);
  await page.waitForFunction(() => document.getElementById('camPreview').readyState >= 2);
  const off = await hooks(page);
  assert(off.offered && !off.on && await page.isVisible('#phoneTools') && await page.isHidden('#regionSet') && await page.isHidden('#regionArea') && await page.isHidden('#downloadPhone') && await page.isHidden('#phonePlate'),
    `before the toggle: ${JSON.stringify(off)}, the strips, box, plate or Download phone MP4 show`);
  await page.click('#phoneTools .toggle');
  const on = await hooks(page);
  const seen = await onScreen(page);
  assert(on.on && on.region.size === 'twothirds' && on.shape === 'wide' && near(on.box.x, 1 / 6, 0.001) && near(on.box.w, 2 / 3, 0.001) && await page.isVisible('#regionBox') && await page.isVisible('#phonePlate')
    && near(seen.x, on.box.x, 0.01) && near(seen.w, on.box.w, 0.01) && near(seen.h, on.box.h, 0.01) && near(seen.aw, 1, 0.01),
  `the toggle on: ${JSON.stringify(on)}, on screen ${JSON.stringify(seen)}`);
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.getElementById('regionBox')); return `${s.outlineWidth} ${s.outlineColor} ${s.boxShadow}`; });
  assert(/^3px rgb\(207, 46, 18\) rgba\(11, 11, 11, 0\.45\)/.test(outline), `the region box is drawn as ${outline}`);
  // While the box shows, the note under the tools says how to move it (and the bubble, in Bubble).
  const note = () => page.textContent('#editBubbleHelp');
  const BOX = 'Drag the red box to choose the part of the screen the phone version keeps.';
  const notes = { bubble: await note() };
  await page.locator('#layoutTools label[title="Split"]').click();
  notes.split = await note();
  await page.locator('#layoutTools label[title="Bubble"]').click();
  assert(notes.bubble === `${BOX} Drag the bubble to place your webcam.` && notes.split === BOX, `with the box shown the note reads ${JSON.stringify(notes)}`);

  // It never leaves the screen picture: dragged past each edge it stops there, on screen too; the keys nudge it.
  const edges = { left: await drag(page, -2000, 0), right: await drag(page, 2000, 0), up: await drag(page, 0, -2000), down: await drag(page, 0, 2000) };
  const kept = await onScreen(page);
  const b = (k) => edges[k].box;
  assert(b('left').x === 0 && near(b('right').x + b('right').w, 1, 1e-9) && b('up').y === 0 && near(b('down').y + b('down').h, 1, 1e-9)
    && kept.x >= -0.002 && kept.y >= -0.002 && kept.x + kept.w <= 1.002 && kept.y + kept.h <= 1.002,
  `dragged past the edges the box went to ${JSON.stringify(Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, v.box])))}, on screen ${JSON.stringify(kept)}`);
  await page.evaluate(() => window.__vignette.phone.set({ x: 0.5, y: 0.5 }));
  await page.focus('#regionBox');
  await page.keyboard.press('ArrowRight');
  const nudged = await hooks(page);
  assert(near(nudged.region.x, 0.52, 1e-9), `ArrowRight moved the region to ${nudged.region.x}`);
  await page.evaluate(() => window.__vignette.phone.set({ x: 0.5, y: 0.5 }));

  // Wide, two thirds, centred, with the camera (Bubble): 1080x1920; the band shows no corner of the screen and
  // no bubble ring; the rule; the camera's picture below it.
  let how = await exportPhone(page);
  const wideLine = how.line;
  assert(how.out.width === 1080 && how.out.height === 1920 && /^1080x1920, wide, [\d.]+ MB, rendered at [\d.]+ s of video per second$/.test(how.line), `the phone export: ${JSON.stringify(how)}`);
  const wide = await page.evaluate(look, { mb: MB, source: 'phone', times: [0.5, 1.7, 2.9], boxes: phoneBoxes(BAND.wide) });
  for (const f of wide) {
    const k = f.boxes;
    assert(f.w === 540 && f.h === 960 && !corners(f).length && k.band.dark < 0.002 && k.ref.y > 40 && k.rule.y < 30 && k.above.y > 40 && k.below.y > 40 && k.rest.y > 40,
      `Wide, centred, at ${f.t} s: ${f.w}x${f.h}, corners ${corners(f).join(' ') || 'none'}, ring ${(k.band.dark * 100).toFixed(2)}%, rule ${k.rule.y.toFixed(0)}, above ${k.above.y.toFixed(0)}, below ${k.below.y.toFixed(0)}, under it ${k.rest.y.toFixed(0)} (luma)`);
  }
  // At the top left, Square and Half (the screen's left 960x960): only the top left corner square shows, in two of
  // five samples at least (its brightness ramps and briefly matches the background); the other three corners show in
  // none. The fake screen draws a disc about 270 px across its centre: a Wide Half box at the top left would end on
  // it, so the band's far corner would read the disc; this one's far corner is 420 px below the centre. The screen's
  // corner square is a sixteenth of its width (120 px), so an eighth of this 960 px box each way.
  await page.evaluate(() => window.__vignette.phone.set({ x: 0, y: 0, size: 'half', shape: 'square' }));
  await exportPhone(page);
  const tl = await page.evaluate(look, { mb: MB, source: 'phone', times: [0.3, 0.9, 1.5, 2.1, 2.7], boxes: phoneBoxes(BAND.square, { w: 1 / 8, h: 1 / 8 }) });
  const tlSeen = tl.filter((f) => corners(f).join() === 'tl').length;
  const stat = (f) => ['ref', 'tl', 'tr', 'bl', 'br'].map((k) => `${k} ${f.boxes[k].med.toFixed(0)} (${f.boxes[k].p10.toFixed(0)}-${f.boxes[k].p90.toFixed(0)})`).join(' ');
  assert(tlSeen >= 2 && tl.every((f) => corners(f).every((c) => c === 'tl')), `a Square Half region at the top left shows corners ${tl.map((f) => `${corners(f).join(' ') || 'none'} [${stat(f)}]`).join(', ')}`);

  // Square: a 1080x1080 band, the rule under it, the camera below; the poster is 9:16 and the same frame.
  await page.locator('#regionSet label[title="Square"]').click();
  await page.evaluate(() => window.__vignette.phone.set({ x: 0.5, y: 0.5, size: 'twothirds' }));
  how = await exportPhone(page);
  const sq = await page.evaluate(look, { mb: MB, source: 'phone', times: [1], boxes: phoneBoxes(BAND.square) });
  const s = sq[0].boxes;
  assert(how.out.width === 1080 && how.out.height === 1920 && s.rule.y < 30 && s.above.y > 40 && s.below.y > 40 && s.rest.y > 40,
    `Square: ${JSON.stringify(how.out)}, rule ${s.rule.y.toFixed(0)}, above ${s.above.y.toFixed(0)}, below ${s.below.y.toFixed(0)} (luma)`);
  await page.waitForFunction(() => window.__vignette.phone.poster?.height === 960, null, { timeout: 15_000 });
  await page.waitForTimeout(800); // the plate refreshes 300 ms after a change
  const [poster] = await page.evaluate(look, { mb: MB, source: 'poster', boxes: phoneBoxes(BAND.square) });
  const p = poster.boxes;
  // The poster is half size, so the 2 px rule is one row that the JPEG blends with its neighbours (31 on Linux's
  // encoder, 26 on macOS, where the camera band below reads 55); it must read clearly darker than both bands.
  assert(poster.w * 16 === poster.h * 9 && p.rule.y < 45 && p.rule.y < Math.min(p.above.y, p.below.y) - 20 && p.above.y > 40 && p.below.y > 40 && near(p.ref.y, s.ref.y, 25),
    `the poster is ${poster.w}x${poster.h}, rule ${p.rule.y.toFixed(0)}, above ${p.above.y.toFixed(0)}, below ${p.below.y.toFixed(0)}, band ${p.ref.y.toFixed(0)} against the render's ${s.ref.y.toFixed(0)} (luma)`);

  // Camera only: no screen, so no toggle, and it is forced off.
  await page.locator('#layoutTools label[title="Camera only"]').click();
  const cam = await hooks(page);
  assert(!cam.offered && !cam.on && await page.isHidden('#phoneTools') && await page.isHidden('#regionArea'), `Camera only: ${JSON.stringify(cam)}`);
  // Camera only suspends it: back in Bubble it is still on, as it was.
  await page.locator('#layoutTools label[title="Bubble"]').click();
  const resumed = await hooks(page);
  assert(resumed.on && resumed.shape === 'square' && await page.isVisible('#regionArea') && await page.isVisible('#phonePlate') && await page.isVisible('#downloadPhone') && await page.isVisible('#regionSet'),
    `back in Bubble after Camera only the phone version is ${JSON.stringify(resumed)}`);

  // Without a camera: the region on top and black below; with Padded on vermilion, the colour below.
  await page.uncheck('#cam');
  await record(page, 3);
  await page.click('#phoneTools .toggle');
  await exportPhone(page);
  const [bare] = await page.evaluate(look, { mb: MB, source: 'phone', times: [1], boxes: phoneBoxes(BAND.wide) });
  await page.locator('#layoutTools label[title="Padded"]').click();
  await page.locator('#colourSet label[title="Vermilion"]').click();
  await exportPhone(page);
  const [padded] = await page.evaluate(look, { mb: MB, source: 'phone', times: [1], boxes: phoneBoxes(BAND.wide) });
  assert(bare.boxes.ref.y > 40 && bare.boxes.rest.y < 20 && padded.boxes.ref.y > 40 && isColour(padded.boxes.rest, VERMILION),
    `without a camera: band ${bare.boxes.ref.y.toFixed(0)}, below ${rgb(bare.boxes.rest)}; Padded on vermilion: band ${padded.boxes.ref.y.toFixed(0)}, below ${rgb(padded.boxes.rest)}`);
  await page.check('#cam');
  ok(`toggle off by default, then the box at ${on.box.w.toFixed(3)} of the picture, centred, 3px vermilion over 45% dim; dragged past each edge it stopped at it; `
    + `${how.out.width}x${how.out.height} ("${wideLine}"); centred no corner, at the top left ${tlSeen} of 5 samples show only that corner (none another); rule ${wide[0].boxes.rule.y.toFixed(0)}, camera below ${wide[0].boxes.below.y.toFixed(0)}; `
    + `Square's rule at 1080; poster ${poster.w}x${poster.h}; Camera only hides it and Bubble brings it back on; no camera black below, Padded ${rgb(padded.boxes.rest)}`);
}

// R2 object keys in a wrangler dev server's local bucket that contain `id` (miniflare keeps them in SQLite under the persist directory).
async function r2Keys(dir, id) {
  const { DatabaseSync } = await import('node:sqlite');
  const r2 = join(dir, 'v3', 'r2');
  const files = (await readdir(r2, { recursive: true }).catch(() => [])).filter((f) => f.endsWith('.sqlite'));
  const keys = [];
  for (const f of files) {
    const db = new DatabaseSync(join(r2, f), { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_mf_objects'").get()) keys.push(...db.prepare('SELECT key FROM _mf_objects WHERE key LIKE ?').all(`%${id}%`).map((r) => r.key));
    } finally { db.close(); }
  }
  return keys.sort();
}
const linked = async (page) => {
  await page.click('#upload');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 180_000 });
  return page.inputValue('#shareUrl');
};
const after = (page, id, re) => page.waitForFunction(([i, r]) => new RegExp(r).test(document.getElementById(i).textContent), [id, re.source], { timeout: 120_000 });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export async function mobileUploadStep(page, { record, assert, ok, base, api, listVideos, browser, dir }) {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.check('#cam');
  await record(page, 3);
  await page.click('#phoneTools .toggle');
  await page.fill('#title', 'Phone version');
  const url = await linked(page);
  await after(page, 'phoneMsg', /^Phone version kept/);
  await after(page, 'rawMsg', /^Originals kept/);
  const id = url.split('/v/')[1];
  const row = async (vid = id) => (await api(base, `/api/videos/${vid}`)).json();
  const r1 = await row(), listed = (await listVideos(base)).find((v) => v.id === id);
  const local = await page.evaluate(() => ({ box: window.__vignette.phone.box, phone: window.__vignette.phone.exported, land: window.__vignette.editor.exported.blob.size }));
  assert(r1.mobile?.ready === true && r1.mobile.width === 1080 && r1.mobile.height === 1920 && r1.mobile.variant === 'wide' && r1.mobile.size === local.phone.size && !('uploadId' in r1.mobile)
    && ['x', 'y', 'w', 'h'].every((k) => near(r1.mobile.region[k], local.box[k], 1e-9)) && listed.mobile?.ready === true && r1.size === local.land,
  `stored ${JSON.stringify(r1.mobile)}, listed ${JSON.stringify(listed.mobile)}, made ${JSON.stringify(local)}`);
  const get = (path, init) => fetch(`${base}${path}`, init);
  const media = await get(`/media/${id}/mobile`), ranged = await get(`/media/${id}/mobile`, { headers: { range: 'bytes=0-99' } }), poster = await get(`/thumb/${id}/mobile`), land = await get(`/media/${id}`);
  const phoneBytes = Buffer.from(await media.arrayBuffer()), landBytes = await land.arrayBuffer(), posterBytes = Buffer.from(await poster.arrayBuffer());
  await ranged.arrayBuffer();
  assert(media.status === 200 && phoneBytes.length === r1.mobile.size && ranged.status === 206 && poster.status === 200 && poster.headers.get('content-type') === 'image/jpeg' && posterBytes.length > 1000
    && land.status === 200 && landBytes.byteLength === r1.size && (await r2Keys(dir, id)).length === 6,
  `/media/${id}/mobile ${media.status} ${phoneBytes.length} bytes, ranged ${ranged.status}, poster ${poster.status}, landscape ${land.status} ${landBytes.byteLength} of ${r1.size}, R2 ${(await r2Keys(dir, id)).join(' ')}`);

  // The share page: a portrait phone plays the phone file, a 1280x800 desktop the landscape one; the switch both ways, keeping the time.
  const share = async (options) => {
    const ctx = await browser.newContext(options);
    const v = await ctx.newPage();
    const errors = [];
    v.on('pageerror', (e) => errors.push(e.message));
    await v.goto(url);
    await v.waitForFunction(() => { const p = document.getElementById('player'); return p && p.readyState >= 1; }, null, { timeout: 30_000 });
    const state = () => v.evaluate(() => {
      const p = document.getElementById('player');
      return { view: p.dataset.view, src: p.currentSrc, w: p.videoWidth, h: p.videoHeight, t: p.currentTime, switch: !document.getElementById('views').hidden,
        pressed: document.querySelector('[aria-pressed="true"]')?.dataset.viewTo, downloads: [...document.querySelectorAll('a[download]')].map((a) => a.getAttribute('href')) };
    });
    // Plays (muted) to past 1 s, pauses, switches: the other file, from the same time.
    const flip = async (to) => {
      await v.evaluate(() => { const p = document.getElementById('player'); p.muted = true; return p.play(); });
      await v.waitForFunction(() => document.getElementById('player').currentTime > 1.2, null, { timeout: 20_000 });
      const from = await v.evaluate(() => { const p = document.getElementById('player'); p.pause(); return p.currentTime; });
      await v.click(`[data-view-to="${to}"]`);
      await v.waitForFunction((x) => { const p = document.getElementById('player'); return p.dataset.view === x && p.readyState >= 1 && p.currentTime > 0.5; }, to, { timeout: 20_000 }); // the time is carried over once the new file's metadata is in
      return { from, ...(await state()) };
    };
    return { ctx, v, errors, state, flip };
  };
  const phone = await share({ ...devices['iPhone 13'] });
  const p0 = await phone.state();
  const p1 = await phone.flip('full');
  await phone.v.reload();
  await phone.v.waitForFunction(() => document.getElementById('player')?.readyState >= 1, null, { timeout: 30_000 });
  const p2 = await phone.state();
  const desk = await share({ viewport: { width: 1280, height: 800 } });
  const d0 = await desk.state();
  const d1 = await desk.flip('phone');
  const csp = (await get(`/v/${id}`)).headers.get('content-security-policy') || '';
  const pv = `/media/${id}/mobile?v=${r1.mobile.size.toString(36)}`, lv = `/media/${id}?v=${r1.size.toString(36)}`;
  assert(p0.view === 'phone' && p0.src.endsWith(pv) && p0.w === 1080 && p0.h === 1920 && p0.switch && p0.pressed === 'phone' && p0.downloads.includes(lv) && p0.downloads.includes(pv)
    && p1.view === 'full' && p1.src.endsWith(lv) && p2.view === 'full'
    && d0.view === 'full' && d0.src.endsWith(lv) && d0.w !== 1080 && d0.switch && d1.view === 'phone' && d1.src.endsWith(pv) && d1.w === 1080
    && /script-src 'nonce-/.test(csp) && !phone.errors.length && !desk.errors.length,
  `share page: phone ${JSON.stringify(p0)}, switched ${JSON.stringify(p1)}, reloaded ${p2.view}; desktop ${JSON.stringify(d0)}, switched ${JSON.stringify(d1)}; errors ${[...phone.errors, ...desk.errors].join('; ')}`);
  assert(near(p1.t, p1.from, 0.5) && near(d1.t, d1.from, 0.5), `the switch moved the time from ${p1.from} to ${p1.t} (phone to full) and ${d1.from} to ${d1.t} (full to phone)`);
  await phone.ctx.close();
  await desk.ctx.close();

  // The phone upload refused: the link works, it says so; Retry sends only the phone file and its poster.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await record(page, 3);
  await page.click('#phoneTools .toggle');
  await page.route('**/api/videos/*/blob?track=mobile', (r) => r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"refused for the test"}' }));
  const url2 = await linked(page);
  await after(page, 'phoneMsg', /^Phone version not kept/);
  await after(page, 'rawMsg', /^Originals kept/);
  await page.unroute('**/api/videos/*/blob?track=mobile');
  const id2 = url2.split('/v/')[1];
  const refused = { msg: await page.textContent('#phoneMsg'), retry: await page.isVisible('#retryPhone'), share: (await get(`/v/${id2}`)).status, media: (await get(`/media/${id2}/mobile`)).status, ready: (await row(id2)).mobile?.ready };
  const sent = [];
  const count = (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`); };
  page.on('request', count);
  await page.click('#retryPhone');
  await after(page, 'phoneMsg', /^Phone version kept/);
  page.off('request', count);
  const r2 = await row(id2);
  assert(/link works without it\. Retry sends only what is missing\./.test(refused.msg) && refused.retry && refused.share === 200 && refused.media === 404 && refused.ready === false
    && sent.length >= 2 && sent.every((s) => /track=mobile/.test(s)) && r2.mobile.ready && (await get(`/media/${id2}/mobile`)).status === 200 && await page.isHidden('#retryPhone'),
  `refused: ${JSON.stringify(refused)}; Retry sent ${sent.join(', ')}; then ${JSON.stringify(r2.mobile)}`);

  // Again mode: the phone settings come back; a second again while the video uploads is 409; a new region replaces the file.
  const againReady = () => page.waitForFunction(() => window.__vignette?.again?.state === 'ready' && !document.getElementById('editBody').hidden, null, { timeout: 60_000 });
  await page.goto(`${base}/?again=${id}`);
  await againReady();
  const back = await hooks(page);
  assert(back.on && back.shape === 'wide' && back.size === 'twothirds' && ['x', 'y', 'w', 'h'].every((k) => near(back.box[k], r1.mobile.region[k], 0.001)), `again mode came back with ${JSON.stringify(back)}, stored ${JSON.stringify(r1.mobile)}`);
  await page.evaluate(() => window.__vignette.phone.set({ x: 0, y: 0, size: 'half' }));
  let second = null;
  await page.route(`**/api/videos/${id}/parts/1`, async (route) => {
    const body = { title: 'x', duration: 1, size: 1000, layout: 'bubble', mobile: { size: 1000, width: 1080, height: 1920, region: { x: 0, y: 0, w: 0.5, h: 0.5 }, variant: 'wide' } };
    second = (await api(base, `/api/videos/${id}/again`, { method: 'POST', body: JSON.stringify(body) })).status;
    await route.continue();
  });
  await linked(page);
  await page.unroute(`**/api/videos/${id}/parts/1`);
  await after(page, 'phoneMsg', /^Phone version kept/);
  const r3 = await row(id), replaced = Buffer.from(await (await get(`/media/${id}/mobile`)).arrayBuffer());
  const page3 = await (await get(`/v/${id}`)).text();
  assert(second === 409 && r3.mobile.ready && near(r3.mobile.region.x, 0, 1e-9) && near(r3.mobile.region.w, 0.5, 1e-9) && replaced.length === r3.mobile.size && sha(replaced) !== sha(phoneBytes)
    && page3.includes(`/media/${id}/mobile?v=${r3.mobile.size.toString(36)}`),
  `rendered again with a new region: second again ${second}, row ${JSON.stringify(r3.mobile)}, served ${replaced.length} bytes, the same as before ${sha(replaced) === sha(phoneBytes)}`);
  // Dropping the toggle drops the phone version: its file and poster go, the share page has no switch.
  await page.goto(`${base}/?again=${id}`);
  await againReady();
  await page.click('#phoneTools .toggle');
  await linked(page);
  const r4 = await row(id), keys = await r2Keys(dir, id);
  const dropped = { mobile: r4.mobile, media: (await get(`/media/${id}/mobile`)).status, thumb: (await get(`/thumb/${id}/mobile`)).status, switch: (await (await get(`/v/${id}`)).text()).includes('id="views"'), keys };
  assert(dropped.mobile === null && dropped.media === 404 && dropped.thumb === 404 && !dropped.switch && !keys.some((k) => k.includes('mobile')) && keys.length === 4, `the toggle dropped: ${JSON.stringify(dropped)}`);

  // Delete removes all six objects of a recording with a phone version and originals.
  const six = await r2Keys(dir, id2);
  assert((await api(base, `/api/videos/${id2}`, { method: 'DELETE' })).status === 200 && (await api(base, `/api/videos/${id}`, { method: 'DELETE' })).status === 200, 'delete failed');
  const gone = await r2Keys(dir, id2);
  assert(six.length === 6 && six.filter((k) => k.includes('mobile')).length === 2 && gone.length === 0, `before delete R2 held ${six.join(' ')}; after, ${gone.join(' ') || 'nothing'}`);
  ok(`stored ${r1.mobile.width}x${r1.mobile.height} ${r1.mobile.variant} with its poster (${posterBytes.length} bytes), landscape unchanged at ${r1.size} bytes; an iPhone played the phone file ${p0.w}x${p0.h}, a desktop the landscape one; `
    + `the switch kept the time (${p1.from.toFixed(2)} to ${p1.t.toFixed(2)} s, ${d1.from.toFixed(2)} to ${d1.t.toFixed(2)} s) and was remembered; refused, then Retry sent only ${sent.length} phone requests; `
    + `again mode came back with the region, replaced it (a second again got ${second}), then dropped it; delete removed ${six.length} objects`);
}
