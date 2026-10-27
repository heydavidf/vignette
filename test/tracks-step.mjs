// Steps 3e and 3f of the end-to-end suite (run from e2e.mjs): two tracks
// (docs/LOOP1_TWO_TRACKS_SPEC.md). 3e: with the webcam on, Stop leaves two
// recordings and a small offset; with it off, one. The bubble moved and
// resized in the edit step (not while recording) is where the render puts
// it. 3f: an upload with the camera keeps the originals (after a failure
// and Retry), only the owner can fetch them, no public path reaches them,
// and Delete takes them away with everything else.
export const TRACKS_STEP = '3e. Two tracks: webcam on records two files and off one; the bubble moved in the edit step lands in the render';
export const ORIGINALS_STEP = '3f. Upload with the camera keeps the originals: Retry after a failure, owner only, never public, gone after Delete';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';

// Runs in the page: where the export differs from the screen recording at each time. The fake screen is
// mid green and the fake camera dark green with a bright shape, so the bubble (camera picture and black
// ring) stands out. For a disc at `at` and one at `away` ({x, y} shares, radius r as a share of the shorter
// edge): the share of each disc's pixels that differ, and the centre of the differing pixels near `at`.
async function bubbleSpots({ mb, times, at, away, r }) {
  const M = await import(mb);
  const { video, exported } = window.__vignette.editor;
  const open = async (blob) => {
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
    return { input, sink: new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 320 }) };
  };
  const luma = async ({ sink }, t) => {
    const { canvas } = await sink.getCanvas(t);
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const y = new Float32Array(d.length / 4);
    for (let i = 0; i < y.length; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    return { y, w: canvas.width, h: canvas.height };
  };
  const out = await open(exported.blob), src = await open(video.blob);
  try {
    const spots = [];
    for (const t of times) {
      const a = await luma(out, t), b = await luma(src, t), R = r * Math.min(a.w, a.h);
      const dist = (i, c) => Math.hypot((i % a.w) + 0.5 - c.x * a.w, Math.floor(i / a.w) + 0.5 - c.y * a.h);
      const hit = { at: [0, 0], away: [0, 0] };
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < a.y.length; i++) {
        const differs = Math.abs(a.y[i] - b.y[i]) > 30;
        for (const k of ['at', 'away']) if (dist(i, k === 'at' ? at : away) < R) { hit[k][0]++; if (differs) hit[k][1]++; }
        if (differs && dist(i, at) < 1.5 * R) { n++; sx += i % a.w; sy += Math.floor(i / a.w); }
      }
      spots.push({ t, at: hit.at[1] / hit.at[0], away: hit.away[1] / hit.away[0], x: n ? (sx / n + 0.5) / a.w : -1, y: n ? (sy / n + 0.5) / a.h : -1 });
    }
    return spots;
  } finally { out.input.dispose(); src.input.dispose(); }
}

// Runs in the page: how far the export's frame at `at` is from the screen recording's frames near `keep`
// (where it should come from) and near `cut` (a part that was cut out), leaving out the bubble and a margin
// round it. Mean luma differences, 0 to 255, of 320 px wide frames; each source side takes its closest
// frame within 0.1 s, which covers the 30 fps grid.
async function joinMatch({ mb, at, keep, cut, bubble }) {
  const M = await import(mb);
  const { video, exported } = window.__vignette.editor;
  const open = async (blob) => {
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) });
    return { input, sink: new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: 320 }) };
  };
  const toLuma = ({ canvas }) => {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, y = new Float32Array(d.length / 4);
    for (let i = 0; i < y.length; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    return { y, w: canvas.width, h: canvas.height };
  };
  const out = await open(exported.blob), src = await open(video.blob);
  try {
    const frame = toLuma(await out.sink.getCanvas(at));
    const { w, h } = frame, cx = bubble.x * w, cy = bubble.y * h, r = 1.25 * bubble.r * Math.min(w, h);
    const outside = (i) => ((i % w) - cx) ** 2 + (Math.floor(i / w) - cy) ** 2 > r * r;
    const diff = (b) => { let sum = 0, n = 0; for (let i = 0; i < frame.y.length; i++) if (outside(i)) { sum += Math.abs(frame.y[i] - b.y[i]); n++; } return sum / n; };
    const closest = async (t) => { let best = Infinity; for await (const f of src.sink.canvases(t - 0.1, t + 0.1)) best = Math.min(best, diff(toLuma(f))); return best; };
    return { at, keep: await closest(keep), cut: await closest(cut) };
  } finally { out.input.dispose(); src.input.dispose(); }
}

const recorded = (page) => page.evaluate(() => {
  const t = window.__vignette.tracks, e = window.__vignette.editor, v = document.getElementById('preview');
  return {
    screen: t.screen?.size ?? null, camera: t.camera?.size ?? null, offset: t.cameraOffset,
    editorCamera: !!e.camera, bubbleShown: !document.getElementById('editBubble').hidden, toolsShown: !document.getElementById('bubbleTools').hidden,
    // The player's own full screen and picture in picture would show the screen alone; step 1's sizes would resize this bubble.
    playerOwn: !v.controlsList.contains('nofullscreen') && !v.disablePictureInPicture, stepSizes: !document.getElementById('sizes').hidden,
  };
});
// The bubble, its size strip and the trim and cuts: inert (held still) or not.
const EDITS = ['editBubble', 'bubbleSet', 'trim'];
const edits = (page) => page.evaluate((ids) => ids.map((id) => document.getElementById(id).inert), EDITS);

export async function tracksStep(page, { record, assert, ok }) {
  await page.reload(); // a fresh editor
  await page.waitForSelector('#app:not([hidden])');
  await page.check('#cam');
  await page.evaluate(() => window.__vignette.bubble.set({ x: 0, y: 1, size: 'medium' })); // bottom left to start
  await record(page, 4);
  const on = await recorded(page);
  assert(on.screen > 0 && on.camera > 0 && on.editorCamera && on.bubbleShown && on.toolsShown, `webcam on gave ${JSON.stringify(on)}`);
  assert(on.offset >= 0 && on.offset < 0.05, `camera offset is ${on.offset} s, expected small and not negative`);
  assert(!on.playerOwn && !on.stepSizes && await page.isVisible('#fullView') && await page.isVisible('#editSizeLabel'),
    `with a camera: player's own full screen ${on.playerOwn}, step 1 sizes shown ${on.stepSizes}, Full screen and "Bubble size" shown ${await page.isVisible('#fullView')}`);

  // Placed in the edit step: dragged to the top right, then made large with the edit step's own size strip.
  await page.waitForFunction(() => document.getElementById('camPreview').readyState >= 2);
  await page.locator('#editBubble').scrollIntoViewIfNeeded();
  const grip = await page.locator('#editBubble').boundingBox();
  const frame = await page.locator('#clipFrame').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width - 4, frame.y + 4, { steps: 12 });
  await page.mouse.up();
  await page.locator('#bubbleTools label[title="Large"]').click();
  // Keyboard (DESIGN.md): with the bubble selected, an arrow nudges 2% of the frame, Shift five times as far.
  // The render below is checked at the nudged place, so the file follows the keyboard too.
  const where = () => page.evaluate(() => ({ ...window.__vignette.bubble.get(), bx: +document.getElementById('editBubble').style.getPropertyValue('--bx') }));
  const dragged = await where();
  await page.locator('#editBubble').focus();
  await page.keyboard.press('ArrowLeft');
  const nudged = await where();
  await page.keyboard.press('Shift+ArrowLeft');
  const shifted = await where();
  const step = (a, b, d) => Math.abs(a.x - b.x - d) < 1e-9 && a.y === b.y;
  assert(step(dragged, nudged, 0.02) && step(nudged, shifted, 0.10) && Math.abs(shifted.bx - shifted.x) < 1e-5,
    `ArrowLeft then Shift+ArrowLeft moved the bubble ${JSON.stringify(dragged)} to ${JSON.stringify(nudged)} to ${JSON.stringify(shifted)}, expected 0.02 then 0.10 left`);
  const placed = await page.evaluate(() => ({
    ...window.__vignette.bubble.get(),
    shared: document.querySelector('input[name=bubbleSize]:checked')?.value,
    saved: JSON.parse(localStorage.getItem('vignette.bubble')),
  }));
  assert(placed.x > 0.7 && placed.y < 0.3 && placed.size === 'large', `the edit step's bubble is at ${JSON.stringify(placed)}, expected top right and large`);
  assert(placed.shared === 'large' && placed.saved?.x === placed.x && placed.saved?.size === 'large', `the recorder's strip and the stored place do not follow the edit step: ${JSON.stringify(placed)}`);

  // Export: it renders, and the bubble is in the top right of the file, not where it was while recording.
  await page.evaluate(() => {
    const msg = document.getElementById('uploadMsg');
    window.__renderMsgs = [];
    new MutationObserver(() => window.__renderMsgs.push(msg.textContent)).observe(msg, { childList: true, characterData: true, subtree: true });
  });
  // While it renders the place cannot change, and the bar shows its percent.
  const held = page.waitForFunction((ids) => ids.every((id) => document.getElementById(id).inert) && /^\d+%$/.test(document.getElementById('progressPct').textContent)
    && document.getElementById('editBubbleHelp').textContent === 'The clip and bubble hold still while the video renders.', EDITS, { polling: 'raf', timeout: 60_000 });
  await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download'), held]);
  assert((await edits(page)).every((x) => !x) && /^Drag the bubble/.test(await page.textContent('#editBubbleHelp')),
    `after the render the bubble, sizes or trim stayed inert (${await edits(page)}), or the note says "${await page.textContent('#editBubbleHelp')}"`);
  const said = await page.evaluate(() => window.__renderMsgs);
  assert(said.some((m) => /^Rendering/.test(m)), `the progress text never said Rendering: ${JSON.stringify(said)}`);
  const radius = { large: 0.20, medium: 0.14, small: 0.10 }[placed.size];
  const startAt = { x: 0.165 * 9 / 16, y: 1 - 0.165 }; // where it sat while recording: medium, bottom left of the 16:9 frame
  const spots = await page.evaluate(bubbleSpots, { mb: MB, times: [0.5, 2.5], at: placed, away: startAt, r: radius });
  for (const s of spots) {
    assert(s.at > 0.6 && s.away < 0.2 && Math.abs(s.x - placed.x) < 0.03 && Math.abs(s.y - placed.y) < 0.04,
      `at ${s.t} s the export differs from the screen over ${(s.at * 100).toFixed(0)}% of the disc where the bubble was placed `
      + `(${placed.x.toFixed(3)}, ${placed.y.toFixed(3)}), centred at (${s.x.toFixed(3)}, ${s.y.toFixed(3)}), and over ${(s.away * 100).toFixed(0)}% of where it sat while recording`);
  }
  const how = await page.evaluate(() => window.__vignette.details.export);
  assert(/rendered with the bubble at [\d.]+ s of video per second/.test(how), `details say "${how}"`);

  // With a cut from 1 s to 2 s the render joins 0..1 to 2..end: the frame 0.3 s after the join comes from
  // 2.3 s of the screen recording, not from 1.3 s (the cut-out part), outside the bubble.
  const seekTo = (t) => page.evaluate((s) => { document.getElementById('preview').currentTime = s; }, t);
  await seekTo(1); await page.click('#cutFrom');
  await seekTo(2); await page.click('#cutTo');
  const D = await page.evaluate(() => window.__vignette.editor.video.duration);
  await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.click('#download')]);
  const cutLength = await page.evaluate(() => window.__vignette.editor.exported.duration);
  assert(Math.abs(cutLength - (D - 1)) < 0.3, `with a 1 s cut the render lasts ${cutLength} s of ${D} s`);
  const join = await page.evaluate(joinMatch, { mb: MB, at: 1.3, keep: 2.3, cut: 1.3, bubble: { x: placed.x, y: placed.y, r: radius } });
  assert(join.keep < 1 && join.keep < join.cut, `after the join the frame is ${join.keep.toFixed(2)} from the kept screen and ${join.cut.toFixed(2)} from the cut part`);
  await page.getByRole('button', { name: /^Remove cut 1\b/ }).click();

  // Webcam off: one recording, no camera, no bubble on the player.
  await page.uncheck('#cam');
  await record(page, 2);
  const off = await recorded(page);
  assert(off.screen > 0 && off.camera === null && off.offset === null && !off.editorCamera && !off.bubbleShown && !off.toolsShown && off.playerOwn && off.stepSizes, `webcam off gave ${JSON.stringify(off)}`);
  await page.check('#cam');
  ok(`on: screen ${on.screen} and camera ${on.camera} bytes, camera ${(on.offset * 1000).toFixed(1)} ms later; player's own full screen off, step 1 sizes hidden; held still while rendering; arrows nudged 0.02 then 0.10; moved in the edit step to `
    + `(${placed.x.toFixed(2)}, ${placed.y.toFixed(2)}) large, rendered there at ${spots.map((s) => `${s.t} s (${(s.at * 100).toFixed(0)}% of the disc, centre ${s.x.toFixed(2)}, ${s.y.toFixed(2)}; ${(s.away * 100).toFixed(0)}% at the old spot)`).join(' and ')}; `
    + `"${how.replace(/^.*rendered/, 'rendered')}"; with a cut ${cutLength.toFixed(2)} s, the frame after the join is ${join.keep.toFixed(2)} from the kept screen `
    + `and ${join.cut.toFixed(2)} from the cut part; off: one ${off.screen} byte file, no bubble`);
}

export async function originalsStep(page, { record, assert, ok, base, auth, listVideos, viewer }) {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await record(page, 3);
  // The camera original fails once: the link still works and Retry keeps it.
  const blocked = /\/api\/videos\/[a-z0-9]{16}\/blob\?track=camera$/;
  await page.route(blocked, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"camera original refused for the test"}' }));
  await page.click('#upload');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 120_000 });
  await page.waitForFunction(() => /^Originals not kept/.test(document.getElementById('rawMsg').textContent), null, { timeout: 60_000 });
  assert(await page.isVisible('#retryRaw'), 'no Retry after the originals failed');
  assert((await edits(page)).every(Boolean) && (await page.textContent('#editBubbleHelp')) === 'The link keeps this clip and this bubble place. Record another to change them.',
    `with the link made the bubble, sizes or trim can still change (${await edits(page)}), or the note says "${await page.textContent('#editBubbleHelp')}"`);
  assert(/^Originals not kept: the screen and camera files as recorded were not stored/.test(await page.textContent('#rawMsg')), 'the failure does not say what was lost');
  const url = await page.inputValue('#shareUrl'), id = url.split('/v/')[1];
  const hasRaw = async () => (await listVideos(base)).find((v) => v.id === id)?.has_raw;
  assert((await hasRaw()) === 0, 'has_raw is set although the camera original failed');
  const early = await fetch(url);
  assert(early.status === 200, `the share page gave ${early.status} while the originals were missing`);
  await early.arrayBuffer();
  await page.unroute(blocked);
  await page.click('#retryRaw');
  await page.waitForFunction(() => /^Originals kept/.test(document.getElementById('rawMsg').textContent), null, { timeout: 60_000 });
  assert(await page.isHidden('#retryRaw') && (await hasRaw()) === 1, 'Retry did not keep the originals');

  const v = await viewer();
  await v.goto(url);
  await v.waitForFunction(() => { const el = document.querySelector('video'); return el && el.readyState >= 1 && el.duration > 1; }, null, { timeout: 30_000 });
  await v.close();

  // Owner only: the originals as recorded, byte for byte, with ranges.
  const sizes = await page.evaluate(() => ({ screen: window.__vignette.editor.video.blob.size, camera: window.__vignette.editor.camera.blob.size }));
  const raw = (track, headers = auth) => fetch(`${base}/api/videos/${id}/raw/${track}`, { headers });
  for (const track of ['screen', 'camera']) {
    const res = await raw(track);
    const body = await res.arrayBuffer();
    assert(res.status === 200 && body.byteLength === sizes[track] && res.headers.get('content-type') === 'video/mp4' && /no-store/.test(res.headers.get('cache-control')),
      `raw ${track}: ${res.status}, ${body.byteLength} bytes (expected ${sizes[track]}), ${res.headers.get('cache-control')}`);
  }
  const part = await raw('camera', { ...auth, range: 'bytes=0-99' });
  assert(part.status === 206 && (await part.arrayBuffer()).byteLength === 100, `a ranged raw request gave ${part.status}`);
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    const res = await raw('camera', headers);
    assert(res.status === 401, `raw camera without the right password gave ${res.status}`);
    await res.arrayBuffer();
  }
  const notTrack = await raw('video');
  assert(notTrack.status === 404, `raw/video gave ${notTrack.status}`);
  await notTrack.arrayBuffer();
  // No public path reaches a raw key; /media serves only the rendered video whatever the query.
  const row = (await listVideos(base)).find((x) => x.id === id);
  for (const path of [`/media/raw/${id}-camera.mp4`, `/raw/${id}-camera.mp4`, `/media/${id}-camera`, `/thumb/${id}-camera`, `/v/${id}-camera`]) {
    const res = await fetch(`${base}${path}`);
    assert(res.status === 404, `${path} gave ${res.status}`);
    await res.arrayBuffer();
  }
  const media = await fetch(`${base}/media/${id}?track=camera`);
  const mediaBytes = (await media.arrayBuffer()).byteLength;
  assert(media.status === 200 && mediaBytes === row.size && mediaBytes !== sizes.camera, `/media?track=camera gave ${media.status} with ${mediaBytes} bytes`);

  // The library marks it; Delete there removes the video, the originals and the link.
  await page.goto(`${base}/library`);
  const rowSel = `tr[data-id="${id}"]`;
  await page.waitForSelector(rowSel, { timeout: 15_000 });
  assert((await page.textContent(`${rowSel} .reg-raw`)) === 'Originals kept', 'the library row has no "Originals kept" mark');
  await page.click(`${rowSel} button:has-text("Delete")`);
  await page.click(`${rowSel} button:has-text("Yes")`);
  await page.waitForSelector(rowSel, { state: 'detached', timeout: 15_000 });
  for (const path of [`/api/videos/${id}/raw/screen`, `/api/videos/${id}/raw/camera`, `/v/${id}`, `/media/${id}`]) {
    const res = await fetch(`${base}${path}`, { headers: auth });
    assert(res.status === 404, `after Delete ${path} gave ${res.status}`);
    await res.arrayBuffer();
  }

  // Originals big enough for parts (a 45 MB camera original), and a half-sent one that Delete aborts.
  const big = await page.evaluate(async () => {
    const { uploadVideo, uploadOriginals } = await import('/upload.js');
    const pattern = (size, k) => { const b = new Uint8Array(size); for (let i = 0; i < size; i++) b[i] = (i + k) % 251; return new Blob([b], { type: 'video/mp4' }); };
    const files = { screen: pattern(3000, 7), camera: pattern(45 * 1024 * 1024, 3) };
    const job = {};
    const r = await uploadVideo({ blob: pattern(2000, 1), title: 'E2E originals', duration: 2, width: 2, height: 2, raw: files, job });
    await uploadOriginals({ job, files });
    return { id: r.id, multipart: job.raw.camera.multipart, parts: Object.keys(job.raw.camera.parts).length, single: !job.raw.screen.multipart, size: files.camera.size };
  });
  assert(big.multipart && big.parts === 3 && big.single && (await listVideos(base)).find((x) => x.id === big.id)?.has_raw === 1, `multipart originals: ${JSON.stringify(big)}`);
  const back = new Uint8Array(await (await fetch(`${base}/api/videos/${big.id}/raw/camera`, { headers: auth })).arrayBuffer());
  assert(back.length === big.size, `the multipart camera original came back as ${back.length} bytes`);
  for (let i = 0; i < back.length; i++) if (back[i] !== (i + 3) % 251) throw new Error(`multipart original byte ${i} is wrong`);
  const del = await fetch(`${base}/api/videos/${big.id}`, { method: 'DELETE', headers: auth });
  assert(del.status === 200, `cleanup delete gave ${del.status}`);
  const half = await (await fetch(`${base}/api/videos`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ title: 'half', duration: 1, size: 1000, raw: { screen: 1000, camera: 41 * 1024 * 1024 } }),
  })).json();
  const p1 = await fetch(`${base}/api/videos/${half.id}/parts/1?track=camera`, { method: 'PUT', headers: auth, body: new Uint8Array(20 * 1024 * 1024) });
  assert(half.raw?.camera.multipart && p1.status === 200, `a multipart original part gave ${p1.status}`);
  await p1.arrayBuffer();
  const early2 = await fetch(`${base}/api/videos/${half.id}/raw/camera`, { headers: auth });
  assert(early2.status === 404, `an unfinished original gave ${early2.status}`);
  await early2.arrayBuffer();
  const gone = await fetch(`${base}/api/videos/${half.id}`, { method: 'DELETE', headers: auth });
  assert(gone.status === 200 && !(await listVideos(base)).some((x) => x.id === half.id), `deleting a row with an open original gave ${gone.status}`);
  ok(`link worked with the originals missing; Retry kept them (has_raw 1); owner gets ${sizes.screen} and ${sizes.camera} bytes back, 401 without the password; `
    + `no public path reaches them; the library marks it; Delete makes the raw route and the link 404; a 45 MB original went up in 3 parts intact; a half-sent one is deleted`);
}
