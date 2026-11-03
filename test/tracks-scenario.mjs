// Independent scenario test for two tracks (docs/LOOP1_TWO_TRACKS_SPEC.md), written from the spec and the
// page, not from the builder's steps (AGENTS.md rule 5): the camera refused after the screen is shared, the
// camera lost mid-recording, the bubble dragged off every edge in the edit step, the originals failing to
// upload, and a 60 s recording's peak memory. Every export is decoded again here, and the bubble is found by
// its near-black ring: Chromium's fake screen and camera are all mid and light green, never that dark.
export const TRACKS_SCENARIO = '3g. Two tracks, independent scenarios (camera refused, camera lost, bubble off every edge, originals failing, 60 s memory)';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const SIZES = { small: 0.10, medium: 0.14, large: 0.20 }; // radius as a share of the shorter edge (README, DESIGN.md)
const WIDTH = 960;   // frames are compared 960 px wide: a medium ring is about 4 px thick there
const DARK = 50;     // luma below this is the ring; the fake pictures stay above 90
const EDGE = 0.05;   // a bubble clamped to an edge sits within 5% of the frame from it (the margin is 2.5% of the short edge)
const LONG = 60;     // seconds for the memory scenario
const PEAK_MB = 400;
// Mean luma difference between the export's disc (ring included) and the screen there must be above this.
// The ring alone gives about 10. On macOS the fake camera is a darker green than the fake screen and the
// difference runs 20 to 55; on GitHub's Linux runner the two greens match, so the camera picture itself
// adds little (14.2 measured) and only the ring and its moving shape count.
const DISC_DIFF = 8;
const RAW_PATH = /^\/api\/videos\/[a-z0-9]{16}\/(?:blob|parts\/\d+|complete)$/;

// Runs in the page. For each time: the export's frame and the screen recording's frame for the same output
// slot, as luma; the bubble's box from its ring; how far the disc is from the screen there. `pairs` compares
// the discs of two sampled frames; `cam` compares sampled discs with the camera file's last frame (and one a
// little earlier), cropped and scaled into the same disc.
async function analyse({ mb, width, times, pairs = [], cam = null, DARK }) {
  const M = await import(mb);
  const { video, camera, exported } = window.__vignette.editor;
  const inputs = [];
  const track = (blob) => { const i = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) }); inputs.push(i); return i.getPrimaryVideoTrack(); };
  const luma = (cv) => {
    const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data, y = new Float32Array(w * h);
    for (let i = 0; i < y.length; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    return { y, w, h };
  };
  // Rows and columns holding two or more near-black pixels: the ring's extent, in pixel edges.
  const ring = ({ y, w, h }) => {
    const cols = new Uint16Array(w), rows = new Uint16Array(h);
    let n = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (y[j * w + i] < DARK) { cols[i]++; rows[j]++; n++; }
    const x0 = cols.findIndex((c) => c >= 2), y0 = rows.findIndex((c) => c >= 2);
    if (x0 < 0 || y0 < 0) return null;
    return { x0, y0, x1: cols.findLastIndex((c) => c >= 2) + 1, y1: rows.findLastIndex((c) => c >= 2) + 1, n };
  };
  // Mean luma difference of a and b over the disc of `box`, shrunk by k.
  const disc = (a, b, box, k) => {
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, r = (k * (box.x1 - box.x0)) / 2;
    let s = 0, n = 0;
    for (let j = Math.max(0, Math.floor(cy - r)); j < Math.min(a.h, cy + r); j++) {
      for (let i = Math.max(0, Math.floor(cx - r)); i < Math.min(a.w, cx + r); i++) {
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue;
        s += Math.abs(a.y[j * a.w + i] - b.y[j * b.w + i]); n++;
      }
    }
    return s / n;
  };
  try {
    const out = new M.CanvasSink(await track(exported.blob), { width });
    const scr = new M.CanvasSink(await track(video.blob), { width });
    const frames = [], res = [];
    for (const t of times) {
      // The renderer's output frame k (at k/30 s) shows the screen frame showing at k/30 s (no trim, no cuts here).
      const k = Math.round(t * 30), ef = await out.getCanvas((k + 0.5) / 30), sf = await scr.getCanvas(k / 30 + 0.0005);
      if (!ef || !sf) { frames.push(null); res.push({ t, box: null, missing: true }); continue; }
      const e = luma(ef.canvas), s = luma(sf.canvas), box = ring(e);
      frames.push({ e, box });
      res.push({ t: k / 30, w: e.w, h: e.h, box, screenDark: ring(s)?.n ?? 0, vsScreen: box ? disc(e, s, box, 1) : null });
    }
    const near = pairs.map(([i, j]) => (frames[i]?.box && frames[j] ? disc(frames[i].e, frames[j].e, frames[i].box, 0.8) : Infinity));
    let camera_ = null;
    if (cam) {
      const sink = new M.CanvasSink(await track(camera.blob), { width: 640 }), all = [];
      for await (const f of sink.canvases()) all.push(f);
      const last = all.at(-1), earlier = all.findLast((f) => f.timestamp <= last.timestamp - cam.earlierBy) ?? all[0];
      const paint = (f, { e, box }) => { // the camera frame cropped to its centre square and scaled into the disc
        const c = new OffscreenCanvas(e.w, e.h), ctx = c.getContext('2d'), side = Math.min(f.canvas.width, f.canvas.height);
        const r = ((box.x1 - box.x0) / 2) * 0.94, cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
        ctx.drawImage(f.canvas, (f.canvas.width - side) / 2, (f.canvas.height - side) / 2, side, side, cx - r, cy - r, 2 * r, 2 * r);
        return luma(c);
      };
      camera_ = {
        lastAt: last.timestamp, earlierAt: earlier.timestamp,
        diffs: cam.frames.map((i) => ({ last: disc(frames[i].e, paint(last, frames[i]), frames[i].box, 0.8), earlier: disc(frames[i].e, paint(earlier, frames[i]), frames[i].box, 0.8) })),
      };
    }
    return { frames: res, pairs: near, cam: camera_, duration: await inputs[0].computeDuration() };
  } finally { inputs.forEach((i) => i.dispose()); }
}

export async function tracksScenario(page, { record, assert, ok, base, api, viewer }) {
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const ed = () => page.evaluate(() => {
    const { video, camera } = window.__vignette.editor, t = window.__vignette.tracks;
    return {
      screen: t.screen?.size ?? 0, camera: t.camera?.size ?? null, offset: t.cameraOffset, lostAt: t.cameraLostAt,
      duration: video?.duration, camDuration: camera?.duration ?? null, hasCamera: !!camera,
      details: { ...window.__vignette.details }, panel: document.getElementById('details').textContent,
    };
  });
  async function fresh(cam) { // a new recorder page (the step before may have left another one), the webcam toggle as asked
    await page.goto(`${base}/`);
    await page.waitForSelector('#app:not([hidden])');
    if (cam) await page.check('#cam'); else await page.uncheck('#cam');
  }
  const watchMsgs = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    window.__tsMsgs = [];
    window.__tsMo?.disconnect();
    window.__tsMo = new MutationObserver(() => window.__tsMsgs.push(el.textContent));
    window.__tsMo.observe(el, { childList: true, characterData: true, subtree: true });
  }, id);
  async function exportNow() { // Download MP4, as a person would; resolves once the file is saved
    await watchMsgs('uploadMsg');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), page.click('#download')]);
    await dl.path();
    await page.waitForFunction(() => !document.getElementById('download').disabled, null, { polling: 100 });
    return page.evaluate(() => ({ msgs: window.__tsMsgs, how: window.__vignette.details.export || '' }));
  }
  const look = (times, more = {}) => page.evaluate(analyse, { mb: MB, width: WIDTH, times, DARK, ...more });
  const box = (f) => (f.box ? `${f.box.x0}..${f.box.x1} x ${f.box.y0}..${f.box.y1}` : 'none');
  // A whole bubble of `size` in the frame: as wide as tall, the right diameter, clear of every border.
  function whole(name, f, size) {
    const d = 2 * SIZES[size] * Math.min(f.w, f.h), b = f.box;
    assert(b, `${name}: no bubble (no ring) in the export at ${f.t.toFixed(2)} s`);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    assert(near(bw, d, 4) && near(bh, d, 4) && b.x0 >= 1 && b.y0 >= 1 && b.x1 <= f.w - 1 && b.y1 <= f.h - 1,
      `${name}: the bubble at ${f.t.toFixed(2)} s spans ${box(f)} on ${f.w}x${f.h}; a whole ${size} one is ${d.toFixed(0)} px across and inside the frame`);
    assert(f.screenDark === 0 && f.vsScreen > DISC_DIFF, `${name}: at ${f.t.toFixed(2)} s the disc differs from the screen by only ${f.vsScreen?.toFixed(1)} (screen has ${f.screenDark} dark pixels)`);
    return b;
  }
  const rows = async () => (await (await api(base, '/api/videos')).json()).videos;
  const got = async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength });
  const status = (path) => api(base, path).then(got);             // as the owner
  const open = (path) => fetch(`${base}${path}`).then(got);        // as anyone
  async function plays(url) { // the share page's video loads and runs
    const v = await viewer();
    await v.goto(url);
    await v.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 30_000 });
    await v.evaluate(() => { const el = document.querySelector('video'); el.muted = true; return el.play(); });
    await v.waitForFunction(() => document.querySelector('video').currentTime > 0.5, null, { timeout: 15_000 });
    await v.close();
  }

  // ---------- 1. The camera refused after the screen is shared ----------
  await fresh(true);
  await page.evaluate(() => { // the screen picker is accepted, then the camera prompt is refused
    const md = navigator.mediaDevices, real = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => (c?.video ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : real(c));
  });
  let said = null;
  const aSecs = await record(page, 3, async () => {
    said = await page.evaluate(() => {
      const m = document.getElementById('setupMsg');
      return { text: m.textContent, shown: !m.closest('.msg').hidden, cam: document.getElementById('cam').checked, bubble: document.getElementById('bubble').dataset.cam };
    });
    await page.waitForTimeout(3000);
  });
  assert(/Webcam not available \(NotAllowedError\)/.test(said.text) && /recording without it/.test(said.text) && said.shown && !said.cam && said.bubble === 'off',
    `refused camera: while recording the page said ${JSON.stringify(said)}`);
  const a = await ed();
  assert(a.screen > 0 && a.camera === null && a.offset === null && !a.hasCamera, `refused camera: tracks ${JSON.stringify(a)}`);
  assert(near(a.duration, aSecs, 1) && /no camera/.test(a.details.originals), `refused camera: ${a.duration} s parsed for ${aSecs} s; originals "${a.details.originals}"`);
  assert(await page.isHidden('#editBubble') && await page.isHidden('#bubbleTools'), 'refused camera: the edit step offers a bubble');
  const aOut = await exportNow();
  const aLook = await look([1.5]);
  assert(!aOut.msgs.some((m) => /Rendering/.test(m)) && !/rendered/.test(aOut.how) && !aLook.frames[0].box && near(aLook.duration, a.duration, 0.3),
    `refused camera: export said ${JSON.stringify(aOut)}, ${aLook.duration} s, bubble ${box(aLook.frames[0])}`);
  await page.fill('#title', 'Tracks scenario: camera refused');
  await page.click('#upload');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 120_000 });
  const aUrl = await page.inputValue('#shareUrl'), aId = aUrl.split('/v/')[1];
  const aRow = (await rows()).find((v) => v.id === aId);
  const aMedia = await open(`/media/${aId}`);
  assert(aRow?.status === 'ready' && aRow.has_raw === 0 && aMedia.status === 200 && aMedia.bytes === aRow.size, `refused camera: row ${JSON.stringify(aRow)}, media ${JSON.stringify(aMedia)}`);
  assert(await page.isHidden('#retryRaw') && !(await page.textContent('#rawMsg')).trim(), 'refused camera: the page talks about originals that were never recorded');
  await plays(aUrl);
  assert((await api(base, `/api/videos/${aId}`, { method: 'DELETE' })).status === 200, 'cleanup delete failed');
  ok(`camera refused after sharing: "${said.text}", toggle off, bubble struck; one ${a.screen} byte file of ${a.duration.toFixed(2)} s, no bubble in the export; uploaded, has_raw 0, no originals message, plays`);

  // ---------- 2. The camera lost mid-recording ----------
  await fresh(true);
  await page.evaluate(() => window.__vignette.bubble.set({ x: 0.75, y: 0.3, size: 'medium' })); // over plain background
  const LOSE = 1.5, B = 5;
  const bSecs = await record(page, B, async () => {
    await page.waitForTimeout(LOSE * 1000);
    await page.evaluate(() => {
      // What an unplugged camera does: its track ends and says so ("ended"). stop() alone never fires the event.
      const t = window.__vignette.state.cam.getVideoTracks()[0];
      t.stop();
      t.dispatchEvent(new Event('ended'));
    });
    await page.waitForTimeout((B - LOSE) * 1000);
  });
  const b = await ed();
  assert(b.camera > 0 && b.lostAt >= LOSE - 0.2 && b.lostAt <= LOSE + 1.5, `camera lost: camera file ${b.camera} bytes, lost at ${b.lostAt} s (pulled at about ${LOSE} s)`);
  assert(near(b.duration, bSecs, 1) && b.camDuration <= b.lostAt + 0.5 && b.camDuration < b.duration - 2,
    `camera lost: screen ${b.duration} s for ${bSecs} s recorded, camera ${b.camDuration} s (lost at ${b.lostAt} s)`);
  assert(/lost/.test(b.details.camera || '') && /camera: lost/.test(b.panel), `camera lost: Details say "${b.details.camera}"`);
  const bOut = await exportNow();
  assert(bOut.msgs.some((m) => /Rendering/.test(m)) && /rendered with the bubble/.test(bOut.how), `camera lost: export said ${JSON.stringify(bOut)}`);
  const camEnd = b.offset + b.camDuration;
  const live = [0.4, 0.65, 0.95].filter((t) => t < camEnd - 0.2), held = [camEnd + 0.5, b.duration - 0.4];
  assert(live.length >= 2 && held[1] - held[0] >= 1, `camera lost: too little to compare (camera ends at ${camEnd} s of ${b.duration})`);
  const n = live.length;
  const bLook = await look([...live, ...held], {
    pairs: [...live.flatMap((_, i) => live.slice(i + 1).map((__, j) => [i, i + 1 + j])), [n, n + 1]],
    cam: { frames: [n, n + 1], earlierBy: 0.3 },
  });
  const pos = await page.evaluate(() => window.__vignette.bubble.get());
  for (const f of bLook.frames) {
    const bb = whole('camera lost', f, 'medium');
    assert(near((bb.x0 + bb.x1) / 2 / f.w, pos.x, 0.01) && near((bb.y0 + bb.y1) / 2 / f.h, pos.y, 0.01), `camera lost: bubble at ${box(f)}, placed at ${JSON.stringify(pos)}`);
  }
  const heldDiff = bLook.pairs.at(-1), liveDiff = Math.max(...bLook.pairs.slice(0, -1));
  const toLast = Math.max(...bLook.cam.diffs.map((d) => d.last)), toEarlier = Math.min(...bLook.cam.diffs.map((d) => d.earlier));
  assert(near(bLook.duration, b.duration, 0.3), `camera lost: export lasts ${bLook.duration} s, screen ${b.duration} s`);
  assert(heldDiff < 1.5 && liveDiff > 2 * heldDiff, `camera lost: the disc changed ${heldDiff.toFixed(2)} between ${held.map((t) => t.toFixed(2)).join(' and ')} s (held), ${liveDiff.toFixed(2)} while live`);
  assert(toLast < 6, `camera lost: the held disc is ${toLast.toFixed(2)} from the camera's last frame (${toEarlier.toFixed(2)} from one 0.3 s earlier)`);
  ok(`camera lost ${b.lostAt.toFixed(2)} s in: screen ${b.duration.toFixed(2)} s, camera ${b.camDuration.toFixed(2)} s; Details "${b.details.camera}"; `
    + `the export keeps the whole bubble at ${held.map((t) => t.toFixed(1)).join(' and ')} s, held (changes ${heldDiff.toFixed(2)} against ${liveDiff.toFixed(2)} live), `
    + `${toLast.toFixed(2)} from the camera's last frame and ${toEarlier.toFixed(2)} from one 0.3 s before it, ${bLook.frames.at(-1).vsScreen.toFixed(0)} from the screen there`);

  // ---------- 3. The bubble dragged off every edge in the edit step ----------
  await fresh(true);
  await page.evaluate(() => window.__vignette.bubble.set({ x: 0.5, y: 0.5, size: 'medium' }));
  await record(page, 3);
  await page.waitForSelector('#editBubble:not([hidden])');
  await page.waitForFunction(() => document.getElementById('camPreview').readyState >= 2, null, { timeout: 15_000 });
  async function drag(edge) { // grabs the bubble and lets go 400 px past `edge` of the picture
    await page.locator('#clip').scrollIntoViewIfNeeded();
    const g = await page.locator('#editBubble').boundingBox(), f = await page.locator('#clipFrame').boundingBox();
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    const to = { left: [f.x - 400, y], right: [f.x + f.width + 400, y], top: [x, f.y - 400], bottom: [x, f.y + f.height + 400] }[edge];
    const before = await page.evaluate(() => window.__vignette.bubble.get());
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 15 });
    await page.mouse.up();
    const after = await page.evaluate(() => ({ p: window.__vignette.bubble.get(), saved: JSON.parse(localStorage.getItem('vignette.bubble')) }));
    const e = await page.locator('#editBubble').boundingBox(), p = after.p;
    const gap = { left: e.x - f.x, right: f.x + f.width - (e.x + e.width), top: e.y - f.y, bottom: f.y + f.height - (e.y + e.height) };
    const span = edge === 'left' || edge === 'right' ? f.width : f.height;
    const other = edge === 'left' || edge === 'right' ? ['y', p.y, before.y] : ['x', p.x, before.x];
    assert(Object.values(gap).every((v) => v >= -1) && gap[edge] <= EDGE * span && near(other[1], other[2], 0.005),
      `dragged off the ${edge}: bubble box ${JSON.stringify(e)} in frame ${JSON.stringify(f)} (gaps ${JSON.stringify(gap)}), ${other[0]} went ${other[2]} to ${other[1]}`);
    assert(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && after.saved?.x === p.x && after.saved?.y === p.y, `dragged off the ${edge}: stored ${JSON.stringify(after)}`);
    return { ...p, gap: gap[edge] };
  }
  async function rendersAt(name, corner, size) {
    const out = await exportNow();
    assert(/rendered with the bubble/.test(out.how), `${name}: export said "${out.how}"`);
    const r = await look([0.5, 2.0]), p = await page.evaluate(() => window.__vignette.bubble.get());
    for (const f of r.frames) {
      const bb = whole(name, f, size);
      const gaps = { left: bb.x0, top: bb.y0, right: f.w - bb.x1, bottom: f.h - bb.y1 };
      assert(corner.every((c) => gaps[c] <= EDGE * (c === 'left' || c === 'right' ? f.w : f.h)), `${name}: bubble ${box(f)} at ${f.t.toFixed(2)} s is not at the ${corner.join(' ')} edges (gaps ${JSON.stringify(gaps)})`);
      assert(near((bb.x0 + bb.x1) / 2 / f.w, p.x, 0.01) && near((bb.y0 + bb.y1) / 2 / f.h, p.y, 0.01), `${name}: rendered at ${box(f)}, stored ${JSON.stringify(p)}`);
    }
    return r.frames[0];
  }
  const L = await drag('left'), T = await drag('top');
  const tl = await rendersAt('top left', ['left', 'top'], 'medium');
  const R = await drag('right'), Bo = await drag('bottom');
  const br = await rendersAt('bottom right', ['right', 'bottom'], 'medium');
  await page.locator('#bubbleTools label[title=Large]').click();
  const big = await page.evaluate(() => window.__vignette.bubble.get());
  assert(big.size === 'large', `Large gave ${JSON.stringify(big)}`);
  const lg = await rendersAt('large in the corner', ['right', 'bottom'], 'large');
  ok(`dragged 400 px past each edge: left stops ${L.gap.toFixed(1)} px in at x ${L.x.toFixed(3)}, top ${T.gap.toFixed(1)} px at y ${T.y.toFixed(3)}, right ${R.gap.toFixed(1)} px at x ${R.x.toFixed(3)}, bottom ${Bo.gap.toFixed(1)} px at y ${Bo.y.toFixed(3)}; `
    + `rendered whole at ${box(tl)} and ${box(br)} on ${tl.w}x${tl.h}; made large in the corner it stays whole at ${box(lg)}`);

  // ---------- 4. The originals fail to upload (on the same recording) ----------
  const hits = { screen: 0, camera: 0 }, blocked = { screen: true, camera: true };
  const isRaw = (url) => RAW_PATH.test(url.pathname) && /^(screen|camera)$/.test(url.searchParams.get('track') || '');
  await page.route(isRaw, (route) => {
    const t = new URL(route.request().url()).searchParams.get('track');
    hits[t]++;
    return blocked[t] ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"injected failure"}' }) : route.continue();
  });
  const rawRow = async (id) => (await rows()).find((v) => v.id === id);
  async function keep(click) { // runs one round of keeping the originals; resolves with what it ended on
    await watchMsgs('rawMsg');
    await click();
    await page.waitForFunction(() => window.__tsMsgs.some((m) => /Keeping the originals/.test(m))
      && /^Originals (not )?kept/.test(document.getElementById('rawMsg').textContent)
      && !document.getElementById('retryRaw').hasAttribute('aria-busy'), null, { timeout: 120_000, polling: 100 });
    return (await page.textContent('#rawMsg')).trim();
  }
  await page.fill('#title', 'Tracks scenario: originals failing');
  const first = await keep(() => page.click('#upload'));
  const url = await page.inputValue('#shareUrl'), id = url.split('/v/')[1];
  const r1 = await rawRow(id), share = await fetch(url);
  const mediaPublic = await open(`/media/${id}`);
  assert(await page.isVisible('#shareBox') && share.status === 200 && (await share.text()).includes('originals failing'), `originals failing: share page ${share.status}`);
  assert(mediaPublic.status === 200 && mediaPublic.bytes === r1?.size && r1.status === 'ready', `originals failing: media ${JSON.stringify(mediaPublic)}, row ${JSON.stringify(r1)}`);
  assert(r1.has_raw === 0 && hits.screen >= 1, `originals failing: has_raw ${r1.has_raw} after ${JSON.stringify(hits)} blocked requests`);
  assert(/^Originals not kept/.test(first) && /link works/.test(first) && await page.isVisible('#retryRaw') && await page.isEnabled('#retryRaw'), `originals failing: the page says "${first}"`);
  assert((await status(`/api/videos/${id}/raw/screen`)).status === 404, 'originals failing: the raw route serves an original that was never kept');
  await plays(url);
  const firstHits = { ...hits };
  blocked.screen = false; // the screen goes through, the camera still fails
  const second = await keep(() => page.click('#retryRaw'));
  const r2 = await rawRow(id), secondHits = { ...hits };
  assert(/^Originals not kept/.test(second) && r2.has_raw === 0 && await page.isVisible('#retryRaw'), `one original kept: "${second}", has_raw ${r2.has_raw}`);
  assert(secondHits.screen > firstHits.screen && secondHits.camera > firstHits.camera, `one original kept: requests went ${JSON.stringify(firstHits)} to ${JSON.stringify(secondHits)}`);
  blocked.camera = false;
  const third = await keep(() => page.click('#retryRaw'));
  const r3 = await rawRow(id), sizes = await page.evaluate(() => ({ screen: window.__vignette.editor.video.blob.size, camera: window.__vignette.editor.camera.blob.size }));
  const [rs, rc] = await Promise.all([status(`/api/videos/${id}/raw/screen`), status(`/api/videos/${id}/raw/camera`)]);
  assert(/^Originals kept/.test(third) && r3.has_raw === 1 && await page.isHidden('#retryRaw'), `after Retry: "${third}", has_raw ${r3.has_raw}`);
  assert(hits.screen === secondHits.screen && hits.camera > secondHits.camera, `Retry re-sent the kept screen original: ${JSON.stringify(secondHits)} to ${JSON.stringify(hits)}`);
  assert(rs.status === 200 && rs.bytes === sizes.screen && rc.status === 200 && rc.bytes === sizes.camera, `originals served ${JSON.stringify([rs, rc])}, expected ${JSON.stringify(sizes)}`);
  await page.unroute(isRaw);
  assert((await api(base, `/api/videos/${id}`, { method: 'DELETE' })).status === 200, 'cleanup delete failed');
  ok(`originals blocked (${firstHits.screen} screen requests refused): the link worked (share page 200, media ${mediaPublic.bytes} bytes, plays), has_raw 0, "${first.slice(0, 60)}..." with Retry; `
    + `Retry with only the camera blocked kept has_raw 0; the last Retry sent only the camera (${hits.camera - secondHits.camera} requests) and has_raw became 1, both originals served whole`);

  // ---------- 5. A 60 s recording's peak memory, recorded from behind another tab ----------
  await fresh(true);
  const dSecs = await record(page, LONG, async () => {
    await page.evaluate(() => { window.__inBackground = true; });
    const other = await viewer();
    await other.goto('about:blank');
    await other.bringToFront();
    await other.waitForTimeout(LONG * 1000);
    await page.bringToFront();
    await page.evaluate(() => { window.__inBackground = false; });
    await other.close();
  });
  const d = await ed();
  const peak = (line) => Number(/^(\d+) MB JavaScript heap at most/.exec(line || '')?.[1]);
  const recPeak = peak(d.details['peak memory']);
  assert(d.screen > 0 && d.camera > 0 && near(d.duration, dSecs, 1.5) && near(d.camDuration, d.duration - d.offset, 1.5),
    `60 s: screen ${d.screen} bytes ${d.duration} s, camera ${d.camera} bytes ${d.camDuration} s, for ${dSecs} s recorded`);
  assert(recPeak > 0 && recPeak < PEAK_MB && /while recording$/.test(d.details['peak memory']), `60 s: Details say "${d.details['peak memory']}"`);
  const dOut = await exportNow();
  const after = await ed(), renderPeak = peak(after.details['peak memory']);
  const dLook = await look([d.duration - 1]);
  assert(renderPeak >= recPeak && renderPeak < PEAK_MB && /recording and rendering/.test(after.details['peak memory']), `60 s render: Details say "${after.details['peak memory']}"`);
  assert(near(dLook.duration, d.duration, 0.5) && dLook.frames[0].box, `60 s render: ${dLook.duration} s for ${d.duration} s, bubble near the end ${box(dLook.frames[0])}`);
  const speed = /at ([\d.]+) s of video per second/.exec(dOut.how)?.[1];
  ok(`${dSecs.toFixed(1)} s behind another tab: screen ${(d.screen / 1048576).toFixed(1)} MB, camera ${(d.camera / 1048576).toFixed(1)} MB; peak ${recPeak} MB recording, ${renderPeak} MB after rendering (bound ${PEAK_MB} MB); rendered at ${speed} s of video per second`);
}
