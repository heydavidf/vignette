// Steps 3l and 3m of the end-to-end suite (run from e2e.mjs): layouts and
// rendering a recording again (docs/LOOP3_LAYOUTS_SPEC.md). 3l: each layout
// renders its pictures where they belong, the preview shows it at once, the
// thumbnail follows it, Screen only keeps the trim's copy path, and with the
// webcam off only Screen only and Padded are offered. 3m: the layout, the
// shape and the colour are stored and come back in again mode; a recording
// rendered again keeps its link and its originals and plays the old version
// until the new one is up; the Worker's new routes check what they are sent.
//
// Chromium's fake screen and camera are both green on Linux, so nothing here
// tells them apart by colour: the layouts are found by the black letterbox
// and background, the near-black ring, the padded colour and frame sizes.
import { createHash } from 'node:crypto';

export const LAYOUTS_STEP = '3l. Layouts: Split, Camera only, Screen only, Padded and the square bubble render where they belong and show at once in the preview; the thumbnail follows; Screen only keeps the copy path; webcam off offers Screen only and Padded';
export const AGAIN_STEP = '3m. Change layout: layout, shape and colour are stored and come back; rendered again, a recording keeps its link and originals and plays the old version until the new one is up; no originals, no square; the new routes check what they are sent';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const VERMILION = [207, 46, 18];

// Runs in the page. Decodes `source` ('export', the edit step's thumbnail 'thumb', or {url}) 640 wide at
// `times` and measures: `boxes` ({name: [x0, y0, x1, y1]} as shares: mean r, g, b and luma), `points`
// ([x, y] shares: the darkest luma in the 3x3 round each, and the screen recording's luma there, at the
// same time plus `offset`), and `dark`: the share of the frame that is dark (luma under 40) where the
// screen recording is light (over 70), the near-black ring or background drawn over the screen.
async function measure({ mb, source, times = [0], boxes = {}, points = [], offset = 0, dark = false }) {
  const M = await import(mb);
  const e = window.__vignette.editor;
  const inputs = [];
  const open = async (blob) => {
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
    inputs.push(input);
    return new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 640 });
  };
  const read = (c) => ({ d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
  const luma = (d, i) => 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
  try {
    let frameAt;
    if (source === 'thumb') {
      const bmp = await createImageBitmap(e.thumb.blob);
      const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      c.getContext('2d').drawImage(bmp, 0, 0);
      frameAt = async () => read(c);
    } else {
      const sink = await open(source === 'export' ? e.exported.blob : await (await fetch(source.url)).blob());
      frameAt = async (t) => read((await sink.getCanvas(t)).canvas);
    }
    const screen = points.length || dark ? await open(e.video.blob) : null;
    const out = [];
    for (const t of times) {
      const a = await frameAt(t), b = screen && read((await screen.getCanvas(t + offset)).canvas);
      const f = { t, w: a.w, h: a.h, boxes: {} };
      for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes)) {
        let r = 0, g = 0, bl = 0, n = 0;
        for (let y = Math.floor(y0 * a.h); y < Math.ceil(y1 * a.h); y++) {
          for (let x = Math.floor(x0 * a.w); x < Math.ceil(x1 * a.w); x++) { const i = 4 * (y * a.w + x); r += a.d[i]; g += a.d[i + 1]; bl += a.d[i + 2]; n++; }
        }
        f.boxes[name] = { r: r / n, g: g / n, b: bl / n, y: 0.2126 * r / n + 0.7152 * g / n + 0.0722 * bl / n };
      }
      f.points = points.map(([px, py]) => {
        const x = Math.round(px * a.w), y = Math.round(py * a.h);
        let min = 255;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) min = Math.min(min, luma(a.d, (y + dy) * a.w + x + dx));
        return { out: min, screen: luma(b.d, y * b.w + x) };
      });
      if (dark) {
        let n = 0;
        for (let i = 0; i < a.w * a.h; i++) if (luma(a.d, i) < 40 && luma(b.d, i) > 70) n++;
        f.dark = n / (a.w * a.h);
      }
      out.push(f);
    }
    return out;
  } finally { inputs.forEach((i) => i.dispose()); }
}

// Download MP4, as a person would; resolves with the Details panel's export and layout lines.
async function exportNow(page) {
  await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  await page.waitForFunction(() => !document.getElementById('download').disabled);
  return page.evaluate(() => ({ how: window.__vignette.details.export, lay: window.__vignette.details.layout, w: window.__vignette.editor.exported.width, h: window.__vignette.editor.exported.height }));
}
const pick = (page, title) => page.locator(`#layoutTools label[title="${title}"]`).click();
const strip = (page) => page.evaluate(() => ({
  id: window.__vignette.layout.id, offered: window.__vignette.layout.offered,
  checked: document.querySelector('input[name=layout]:checked')?.value,
  disabled: [...document.querySelectorAll('input[name=layout]:disabled')].map((r) => r.value),
  bubbleTools: !document.getElementById('bubbleTools').hidden, colours: !document.getElementById('colourSet').hidden,
}));
const near = (a, b, d) => Math.abs(a - b) <= d;
const isColour = (box, [r, g, b], d = 30) => near(box.r, r, d) && near(box.g, g, d) && near(box.b, b, d);
const fmt = (box) => `rgb(${box.r.toFixed(0)}, ${box.g.toFixed(0)}, ${box.b.toFixed(0)})`;

// The near-black ring at the square's sides near its corners, where a round bubble has none:
// for a bubble of radius r at c, points 0.97 r out on one axis and 0.75 r on the other.
function cornerPoints(c, r, W, H) {
  const R = r * Math.min(W, H), pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const [a, b] of [[0.97, 0.75], [0.75, 0.97]]) pts.push([c.x + (sx * a * R) / W, c.y + (sy * b * R) / H]);
  return pts;
}
const ringed = (f) => f.points.filter((p) => p.screen > 70 && p.out < 50).length;

export async function layoutsStep(page, { record, assert, ok }) {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.check('#cam');
  await page.evaluate(() => window.__vignette.bubble.set({ x: 0.5, y: 0.5, size: 'large', shape: 'round' }));
  await record(page, 4);
  await page.waitForFunction(() => document.getElementById('camPreview').readyState >= 2);
  const on = await strip(page);
  assert(on.id === 'bubble' && on.checked === 'bubble' && on.offered.length === 5 && !on.disabled.length && on.bubbleTools && !on.colours,
    `with the webcam on the strip is ${JSON.stringify(on)}, expected Bubble chosen and all five offered`);
  const cam = await page.evaluate(() => ({ w: window.__vignette.editor.camera.width, h: window.__vignette.editor.camera.height }));

  // Bubble, round then square: the square's sides near its corners are ring, the round one's are screen.
  const place = await page.evaluate(() => window.__vignette.bubble.get());
  let how = await exportNow(page);
  assert(/rendered with the bubble/.test(how.how), `the round bubble's export says "${how.how}"`);
  const pts = cornerPoints(place, 0.20, how.w, how.h);
  const [round] = await page.evaluate(measure, { mb: MB, source: 'export', times: [1], points: pts });
  await page.locator('#bubbleTools label[title="Square"]').click();
  const shaped = await page.evaluate(() => ({ shape: window.__vignette.layout.shape, radius: getComputedStyle(document.getElementById('editBubble')).borderRadius, saved: JSON.parse(localStorage.getItem('vignette.bubble'))?.shape }));
  assert(shaped.shape === 'square' && shaped.radius === '8%' && shaped.saved === 'square', `Square gave ${JSON.stringify(shaped)}`);
  how = await exportNow(page);
  const square = await page.evaluate(measure, { mb: MB, source: 'export', times: [0.5, 2.5], points: pts });
  assert(ringed(round) === 0 && square.every((f) => ringed(f) >= 6), `ring at the square's corner sides: round ${ringed(round)} of 8, square ${square.map(ringed).join(' and ')} of 8`);

  // Split: shown at once (the camera's box is the frame's right 30%), then rendered: above and below the
  // screen's letterbox the left 70% is black, the camera column right of it is not; the screen fills the middle.
  await pick(page, 'Split');
  const box = await page.evaluate(() => {
    const f = document.getElementById('clipFrame').getBoundingClientRect(), c = document.getElementById('editBubble').getBoundingClientRect();
    return { x: (c.left - f.left) / f.width, w: c.width / f.width, h: c.height / f.height, view: getComputedStyle(document.getElementById('preview')).objectViewBox };
  });
  assert(near(box.x, 0.7, 0.01) && near(box.w, 0.3, 0.01) && near(box.h, 1, 0.01) && /inset/.test(box.view), `the Split preview puts the camera at ${JSON.stringify(box)}`);
  how = await exportNow(page);
  assert(/rendered as Split at [\d.]+ s of video per second/.test(how.how) && /^Split, /.test(how.lay), `Split's export says "${how.how}", layout "${how.lay}"`);
  const split = await page.evaluate(measure, { mb: MB, source: 'export', times: [0.5, 2.5], boxes: {
    leftTop: [0.02, 0.02, 0.66, 0.12], rightTop: [0.74, 0.02, 0.98, 0.12], leftBottom: [0.02, 0.88, 0.66, 0.98], rightBottom: [0.74, 0.88, 0.98, 0.98], middle: [0.1, 0.3, 0.6, 0.7],
  } });
  for (const { t, boxes: b } of split) {
    assert(b.leftTop.y < 20 && b.leftBottom.y < 20 && b.rightTop.y > 30 && b.rightBottom.y > 30 && b.middle.y > 30,
      `Split at ${t} s: left of 70% above and below the screen ${b.leftTop.y.toFixed(0)} and ${b.leftBottom.y.toFixed(0)}, the camera column ${b.rightTop.y.toFixed(0)} and ${b.rightBottom.y.toFixed(0)}, the screen ${b.middle.y.toFixed(0)} (luma)`);
  }

  // Camera only: the camera's own frame size, in the preview and the file.
  await pick(page, 'Camera only');
  const camPreview = await page.evaluate(() => { const f = document.getElementById('clipFrame').getBoundingClientRect(); return f.width / f.height; });
  how = await exportNow(page);
  assert(how.w === (cam.w & ~1) && how.h === (cam.h & ~1) && near(camPreview, cam.w / cam.h, 0.02), `Camera only is ${how.w}x${how.h} (preview ${camPreview.toFixed(3)}), the camera ${cam.w}x${cam.h}`);

  // Padded on vermilion: the colour at the four corners and in the margin, the screen inside; the thumbnail too.
  await pick(page, 'Padded');
  await page.locator('#colourSet label[title="Vermilion"]').click();
  assert(await page.isVisible('#colourSet') && await page.isHidden('#bubbleTools') && await page.isHidden('#editBubble'), 'Padded shows the bubble or hides the colours');
  how = await exportNow(page);
  const corners = { tl: [0.005, 0.005, 0.03, 0.03], tr: [0.97, 0.005, 0.995, 0.03], bl: [0.005, 0.97, 0.03, 0.995], br: [0.97, 0.97, 0.995, 0.995] };
  const padded = await page.evaluate(measure, { mb: MB, source: 'export', times: [0.5, 2.5], boxes: { ...corners, margin: [0.005, 0.45, 0.05, 0.55], inside: [0.3, 0.3, 0.7, 0.7] } });
  for (const { t, boxes: b } of padded) {
    assert(['tl', 'tr', 'bl', 'br', 'margin'].every((k) => isColour(b[k], VERMILION)) && !isColour(b.inside, VERMILION, 80),
      `Padded at ${t} s: corners ${['tl', 'tr', 'bl', 'br'].map((k) => fmt(b[k])).join(', ')}, margin ${fmt(b.margin)}, inside ${fmt(b.inside)}`);
  }
  await page.waitForFunction(() => window.__vignette.editor.thumb?.look === 'padded:vermilion', null, { timeout: 15_000 });
  const [thumb] = await page.evaluate(measure, { mb: MB, source: 'thumb', boxes: corners });
  assert(Object.values(thumb.boxes).every((b) => isColour(b, VERMILION)), `the padded thumbnail's corners are ${Object.values(thumb.boxes).map(fmt).join(', ')}`);

  // Screen only: a trim alone is copied, not rendered, and nothing is drawn over the screen; a cut re-encodes.
  await pick(page, 'Screen only');
  assert(await page.isHidden('#editBubble') && await page.isHidden('#fullView') && await page.evaluate(() => !document.getElementById('preview').disablePictureInPicture),
    'Screen only still shows the camera, or keeps the player from its own full screen');
  await page.evaluate(() => { document.getElementById('preview').currentTime = 1; });
  await page.click('#setStart');
  const start = await page.evaluate(() => +document.getElementById('trimStart').value);
  how = await exportNow(page);
  assert(/trim only/.test(how.how) && !/render|re-encod/.test(how.how) && /^Screen only, .*not rendered/.test(how.lay), `Screen only with a trim says "${how.how}", layout "${how.lay}"`);
  const plain = await page.evaluate(measure, { mb: MB, source: 'export', times: [0.3, 2], offset: start, dark: true });
  assert(plain.every((f) => f.dark < 0.002), `Screen only has drawing over the screen: ${plain.map((f) => `${(f.dark * 100).toFixed(2)}%`).join(', ')} dark`);
  const seek = (t) => page.evaluate((s) => { document.getElementById('preview').currentTime = s; }, t);
  await seek(2); await page.click('#cutFrom');
  await seek(3); await page.click('#cutTo');
  const cut = await exportNow(page);
  assert(/re-encoded 1 cut/.test(cut.how), `Screen only with a cut says "${cut.how}"`);
  await page.getByRole('button', { name: /^Remove cut 1\b/ }).click();

  // Webcam off: Screen only chosen, the camera's layouts disabled plates, Padded offered.
  await page.uncheck('#cam');
  await record(page, 2);
  const off = await strip(page);
  assert(off.id === 'screen' && off.checked === 'screen' && off.offered.join() === 'screen,padded' && off.disabled.join() === 'bubble,split,camera' && !off.bubbleTools,
    `with the webcam off the strip is ${JSON.stringify(off)}`);
  await page.locator('#layoutTools label[title="Split"]').click({ force: true }); // a disabled plate: nothing changes
  assert((await strip(page)).id === 'screen', 'a click on the disabled Split plate chose it');
  await pick(page, 'Padded');
  const offPadded = await strip(page);
  assert(offPadded.id === 'padded' && offPadded.colours, `webcam off, Padded gave ${JSON.stringify(offPadded)}`);
  await page.check('#cam');
  await page.evaluate(() => window.__vignette.bubble.set({ shape: 'round' }));
  ok(`square ring at ${square.map(ringed).join(' and ')} of 8 corner sides (round 0); Split letterbox ${split[0].boxes.leftTop.y.toFixed(0)} left, camera ${split[0].boxes.rightTop.y.toFixed(0)} right; `
    + `Camera only ${cam.w}x${cam.h}; Padded corners ${fmt(padded[0].boxes.tl)} and the thumbnail's too; Screen only "${how.how.replace(/^.*?, trim/, 'trim')}", ${(plain[0].dark * 100).toFixed(2)}% drawn over, a cut re-encodes; webcam off offers ${off.offered.join(' and ')}`);
}

// Every #source text the recorder page shows from its first moment (step 1's note: the download's progress).
function watchSource() {
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('source');
    if (!el) return;
    window.__sourceTexts = [];
    new MutationObserver(() => window.__sourceTexts.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
const againReady = (page) => page.waitForFunction(() => window.__vignette?.again?.state === 'ready' && !document.getElementById('editBody').hidden
  && document.getElementById('camPreview').readyState >= 2, null, { timeout: 60_000 });
const editState = (page) => page.evaluate(() => ({
  again: JSON.parse(JSON.stringify(window.__vignette.again)), id: window.__vignette.layout.id, colour: window.__vignette.layout.colour,
  bubble: window.__vignette.bubble.get(), title: document.getElementById('title').value, label: document.getElementById('uploadLabel').textContent,
  bands: ['band1', 'band2', 'band3'].map((b) => document.getElementById(b).dataset.state), source: document.getElementById('source').textContent,
  toggles: getComputedStyle(document.getElementById('setupStep')).display, // step 1's toggles are for a new recording: hidden while rendering again
  texts: window.__sourceTexts || [],
}));
async function uploadDone(page) {
  await page.click('#upload');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 120_000 });
  return page.inputValue('#shareUrl');
}

export async function againStep(page, { record, assert, ok, base, auth, api, listVideos, viewer }) {
  await page.addInitScript(watchSource);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.check('#cam');
  await page.evaluate(() => window.__vignette.bubble.set({ x: 0.3, y: 0.4, size: 'small', shape: 'square' }));
  await record(page, 3);
  await page.fill('#title', 'Layouts: rendered again');
  const url = await uploadDone(page);
  await page.waitForFunction(() => /^Originals kept/.test(document.getElementById('rawMsg').textContent), null, { timeout: 60_000 });
  const id = url.split('/v/')[1], placed = await page.evaluate(() => window.__vignette.bubble.get());
  const row = async (vid = id) => (await api(base, `/api/videos/${vid}`)).json();
  const r1 = await row(), l1 = (await listVideos(base)).find((v) => v.id === id);
  assert(r1.layout === 'bubble' && r1.bubble?.shape === 'square' && r1.bubble.size === 'small' && near(r1.bubble.x, placed.x, 1e-9) && r1.has_raw === 1 && r1.status === 'ready'
    && !('upload_id' in r1) && !('raw_screen' in r1) && l1.layout === 'bubble' && l1.again === 0, `stored ${JSON.stringify(r1)}, listed ${JSON.stringify(l1)}`);
  const bytes = async (path) => Buffer.from(await (await fetch(`${base}${path}`, { headers: auth })).arrayBuffer());
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const raw = await Promise.all(['screen', 'camera'].map((t) => bytes(`/api/videos/${id}/raw/${t}`)));
  const before = { screen: sha(raw[0]), camera: sha(raw[1]), thumb: sha(await bytes(`/thumb/${id}`)), size: r1.size };

  // The library's Change layout square opens it again, with the originals, the title, the layout and the bubble as uploaded.
  await page.goto(`${base}/library`);
  const rowSel = `tr[data-id="${id}"]`;
  await page.waitForSelector(rowSel, { timeout: 15_000 });
  assert((await page.getAttribute(`${rowSel} a[title="Change layout"]`, 'href')) === `/?again=${id}`, 'the library row has no Change layout square');
  await page.click(`${rowSel} a[title="Change layout"]`);
  await againReady(page);
  const a1 = await editState(page);
  const total = raw[0].length + raw[1].length;
  assert(a1.id === 'bubble' && a1.bubble.shape === 'square' && a1.bubble.size === 'small' && near(a1.bubble.x, placed.x, 0.001) && near(a1.bubble.y, placed.y, 0.001)
    && a1.title === 'Layouts: rendered again' && a1.label === 'Upload and replace' && a1.bands.join() === 'done,done,current' && a1.source === 'Rendering again: Layouts: rendered again' && a1.toggles === 'none'
    && a1.texts.some((t) => /^Loading the originals: [\d.]+ of [\d.]+ MB$/.test(t)) && a1.again.id === id && a1.again.progress.sent === total && a1.again.progress.total === total,
  `again mode opened with ${JSON.stringify({ ...a1, texts: a1.texts.slice(0, 4) })}, originals ${total} bytes`);

  // Split, uploaded. The first part is held while the link is looked at: the old version still plays, the
  // library says Rendering again, a second again is refused. No original goes up again.
  await pick(page, 'Split');
  let held = null, rawSent = 0;
  const countRaw = (r) => { if (/[?&]track=(screen|camera)/.test(r.url()) && r.method() !== 'GET') rawSent++; };
  page.on('request', countRaw);
  await page.route(`**/api/videos/${id}/parts/1`, async (route) => {
    const media = await fetch(`${base}/media/${id}`), mediaBytes = (await media.arrayBuffer()).byteLength;
    const listed = (await listVideos(base)).find((v) => v.id === id);
    const second = await api(base, `/api/videos/${id}/again`, { method: 'POST', body: JSON.stringify({ duration: 1, size: 1000, layout: 'split' }) });
    const share = await fetch(url);
    const lib = await viewer();
    await lib.goto(`${base}/library`);
    await lib.waitForSelector(rowSel, { timeout: 15_000 }); // at 1280 wide the status shows under the title, not in its column
    held = { media: media.status, mediaBytes, status: listed.status, again: listed.again, second: second.status, said: (await second.json()).error, share: share.status, shareHtml: await share.text(),
      lib: await lib.textContent(`${rowSel} .reg-status`), under: await lib.isVisible(`${rowSel} .reg-state`) && await lib.textContent(`${rowSel} .reg-state`), square: await lib.locator(`${rowSel} a[title="Change layout"]`).count() };
    await lib.close();
    await route.continue();
  });
  const url2 = await uploadDone(page);
  await page.unroute(`**/api/videos/${id}/parts/1`);
  page.off('request', countRaw);
  assert(held && held.media === 200 && held.mediaBytes === before.size && held.status === 'uploading' && held.again === 1 && held.share === 200 && held.shareHtml.includes('Layouts: rendered again')
    && held.second === 409 && /already being rendered again/.test(held.said) && held.lib === 'Rendering again' && held.under === 'Rendering again' && held.square === 0,
  `while the new version uploaded: ${JSON.stringify({ ...held, shareHtml: undefined })} (old size ${before.size})`);
  const r2 = await row(), out = await page.evaluate(() => window.__vignette.editor.exported.blob.size);
  const after = { screen: sha(await bytes(`/api/videos/${id}/raw/screen`)), camera: sha(await bytes(`/api/videos/${id}/raw/camera`)), thumb: sha(await bytes(`/thumb/${id}`)) };
  const media = await bytes(`/media/${id}`);
  assert(url2 === url && r2.layout === 'split' && r2.status === 'ready' && r2.has_raw === 1 && r2.again === 0 && r2.size === out && media.length === out && rawSent === 0
    && after.screen === before.screen && after.camera === before.camera && after.thumb !== before.thumb && /The same link now plays this version/.test(await page.textContent('#uploadMsg')),
  `after the new version: link ${url2}, row ${JSON.stringify(r2)}, media ${media.length} of ${out} bytes, ${rawSent} originals sent, originals the same ${after.screen === before.screen && after.camera === before.camera}, thumbnail changed ${after.thumb !== before.thumb}`);
  const v = await viewer();
  await v.goto(url);
  await v.waitForFunction(() => { const el = document.querySelector('video'); return el && el.readyState >= 1 && el.duration > 1; }, null, { timeout: 30_000 });
  const src = await v.evaluate(() => document.querySelector('video').currentSrc);
  await v.close();
  const [first] = await page.evaluate(measure, { mb: MB, source: { url: src }, times: [0], boxes: { leftTop: [0.02, 0.02, 0.66, 0.12], rightTop: [0.74, 0.02, 0.98, 0.12] } });
  assert(src.endsWith(`/media/${id}?v=${out.toString(36)}`) && first.boxes.leftTop.y < 20 && first.boxes.rightTop.y > 30,
    `the share page plays ${src}; its first frame: left of 70% ${first.boxes.leftTop.y.toFixed(0)}, right ${first.boxes.rightTop.y.toFixed(0)} (luma)`);

  // Again, twice more: Split comes back chosen; Padded on grey replaces it and comes back with its colour. Share again leaves the mode.
  await page.goto(`${base}/?again=${id}`);
  await againReady(page);
  assert((await editState(page)).id === 'split', 'Split did not come back chosen');
  await pick(page, 'Padded');
  await page.locator('#colourSet label[title="Grey"]').click();
  await uploadDone(page);
  assert((await row()).layout === 'padded:grey', `Padded on grey stored as ${(await row()).layout}`);
  // Held by the link: the label and the other swatches fade, the chosen colour keeps its full paint and loses its ring.
  const held2 = await page.evaluate(() => {
    const look = (el) => ({ opacity: getComputedStyle(el).opacity, ring: /, rgb/.test(getComputedStyle(el).boxShadow) });
    const set = document.getElementById('colourSet');
    return { inert: set.inert, label: look(set.querySelector('.tools-label')), chosen: look(set.querySelector('input:checked').parentElement), other: look(set.querySelector('.swatch:not(:has(input:checked))')) };
  });
  assert(held2.inert && held2.chosen.opacity === '1' && !held2.chosen.ring && held2.label.opacity === '0.45' && held2.other.opacity === '0.45', `after the upload the colour row is ${JSON.stringify(held2)}`);
  await page.goto(`${base}/?again=${id}`);
  await againReady(page);
  const a3 = await editState(page);
  assert(a3.id === 'padded' && a3.colour === 'grey' && await page.isChecked('#colourSet input[value=grey]'), `Padded on grey came back as ${a3.id} on ${a3.colour}`);
  await page.click('#share');
  await page.waitForSelector('#recordStep:not([hidden])', { timeout: 15_000 });
  const left = await page.evaluate(() => ({ state: window.__vignette.again.state, search: location.search, edit: document.getElementById('editStep').hidden, toggles: getComputedStyle(document.getElementById('setupStep')).display }));
  assert(left.state === 'off' && left.search === '' && left.edit && left.toggles !== 'none', `Share again left ${JSON.stringify(left)}`);

  // Without originals (the webcam off): no square, and the address says why. An unknown id says so too.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.uncheck('#cam');
  await record(page, 2);
  const bare = (await uploadDone(page)).split('/v/')[1];
  await page.check('#cam');
  await page.goto(`${base}/library`);
  await page.waitForSelector(`tr[data-id="${bare}"]`, { timeout: 15_000 });
  assert(await page.locator(`tr[data-id="${bare}"] a[title="Change layout"]`).count() === 0, 'a recording without originals has a Change layout square');
  const refused = {};
  for (const [name, vid] of [['bare', bare], ['unknown', 'zzzzzzzzzzzzzzzz']]) {
    await page.goto(`${base}/?again=${vid}`);
    await page.waitForFunction(() => window.__vignette?.again?.state === 'failed', null, { timeout: 15_000 });
    refused[name] = await page.evaluate(() => ({ msg: document.getElementById('setupMsg').textContent, link: document.querySelector('#setupMsg a')?.getAttribute('href'), edit: document.getElementById('editStep').hidden }));
  }
  assert(/has no originals kept, so its layout cannot be changed/.test(refused.bare.msg) && /not in your library/.test(refused.unknown.msg)
    && Object.values(refused).every((x) => x.link === '/' && x.edit && /Record another$/.test(x.msg)), `refused: ${JSON.stringify(refused)}`);

  // The new routes: owner only, 404 for unknown ids, and every field checked as a new upload's are.
  const again = (vid, body, headers) => fetch(`${base}/api/videos/${vid}/again`, { method: 'POST', headers: headers ?? auth, body: JSON.stringify(body) });
  const good = { title: 'x', duration: 1, size: 1000, width: 2, height: 2, layout: 'split', bubble: { x: 0.5, y: 0.5, size: 'small', shape: 'round' } };
  const codes = {
    getNoAuth: (await fetch(`${base}/api/videos/${id}`)).status, getUnknown: (await api(base, '/api/videos/zzzzzzzzzzzzzzzz')).status, getBad: (await api(base, '/api/videos/BAD')).status,
    againNoAuth: (await again(id, good, {})).status, againUnknown: (await again('zzzzzzzzzzzzzzzz', good)).status, againBare: (await again(bare, good)).status,
    layout: (await again(id, { ...good, layout: 'nope' })).status, padded: (await again(id, { ...good, layout: 'padded' })).status, pink: (await again(id, { ...good, layout: 'padded:pink' })).status,
    shape: (await again(id, { ...good, bubble: { ...good.bubble, shape: 'triangle' } })).status, place: (await again(id, { ...good, bubble: { ...good.bubble, x: 2 } })).status,
    size: (await again(id, { ...good, size: 0 })).status, huge: (await again(id, { ...good, size: 1e13 })).status, notJson: (await fetch(`${base}/api/videos/${id}/again`, { method: 'POST', headers: auth, body: '{' })).status,
    // JSON that is not an object: null, a bare string, a list.
    againNull: (await again(id, null)).status, againString: (await again(id, 'split')).status, againList: (await again(id, [good])).status,
    createNull: (await api(base, '/api/videos', { method: 'POST', body: 'null' })).status,
    createPink: (await api(base, '/api/videos', { method: 'POST', body: JSON.stringify({ ...good, layout: 'padded:pink' }) })).status,
  };
  const want = {
    getNoAuth: 401, getUnknown: 404, getBad: 404, againNoAuth: 401, againUnknown: 404, againBare: 409, layout: 400, padded: 400, pink: 400, shape: 400, place: 400,
    size: 400, huge: 413, notJson: 400, againNull: 400, againString: 400, againList: 400, createNull: 400, createPink: 400,
  };
  const r4 = await row();
  assert(Object.entries(want).every(([k, c]) => codes[k] === c) && r4.status === 'ready' && r4.layout === 'padded:grey',
    `the routes answered ${JSON.stringify(codes)}, expected ${JSON.stringify(want)}; the row is ${r4.status} ${r4.layout} afterwards`);
  for (const vid of [id, bare]) await api(base, `/api/videos/${vid}`, { method: 'DELETE' });
  ok(`stored bubble square small, came back with it ("${a1.texts.find((t) => /of/.test(t))}"); Split uploaded under the same link while the old ${before.size} bytes played, `
    + `the library said "${held.lib}", a second again got 409; now ${out} bytes, originals unchanged, thumbnail new, the share page's first frame split; `
    + `Split and then Padded on grey came back chosen; Share again left the mode; no originals, no square; the routes answered as expected`);
}
