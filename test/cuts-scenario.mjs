// Independent scenario test for mid-section cuts (docs/CUTS_SPEC.md), written
// from the spec and the page, not from the builder's step: two cuts, overlapping
// and touching cuts, a cut to the trim end, a trim moved over cuts, every cut
// removed, an upload. Each export is parsed again here, not by the app's probe.
import { stat } from 'node:fs/promises';

export const CUTS_SCENARIO = '3d. Cuts, independent scenarios (two cuts, overlaps, trim end, trim moved, all removed, upload)';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const TOL = 0.3; // seconds between the clip length and the file: an audio frame or two over, far below any cut here (1 s or more)
// Frame identity compares mean brightness differences (0 to 255) of 320 px wide frames. Re-encoding moves a
// frame by about 0.02. Chromium's fake picture moves about 0.5 a frame and its pacman repeats every 0.6 s, so
// one frame can look like another a second away: a comparison only counts where the kept and the cut-out
// source differ by SEP or more. WIN covers the exported frame's own shift (the 30 fps grid, dropped frames).
const SEP = 0.5, WIN = 0.1;

// Runs in the page: mean brightness of the export at `times`; for each pair (a join, or the end before a cut)
// how close the exported frame is to the source frames near the kept time and near the cut-out time.
async function analyse({ mb, times, pairs, SEP, WIN }) {
  const M = await import(mb);
  const { video: src, exported } = window.__vignette.editor;
  const open = async (blob) => {
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(blob) }), track = await input.getPrimaryVideoTrack();
    return { input, track, sink: new M.CanvasSink(track, { width: 320 }) };
  };
  const out = await open(exported.blob), orig = await open(src.blob);
  const toLuma = ({ canvas: cv }) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, y = new Float32Array(d.length / 4);
    for (let i = 0; i < y.length; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
    return y;
  };
  const luma = async ({ sink }, t) => { const f = await sink.getCanvas(t); return f && toLuma(f); };
  // Every source frame on screen from t - WIN to t + WIN, the one already showing at t - WIN included.
  const around = async (t) => { const ys = []; for await (const f of orig.sink.canvases(t - WIN, t + WIN)) ys.push(toLuma(f)); return ys; };
  const diff = (a, b) => (a && b ? a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length : Infinity);
  const closest = (y, ys) => Math.min(...ys.map((x) => diff(y, x)));
  const starts = async ({ track }) => { const ts = []; for await (const p of new M.EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) ts.push(p.timestamp); return ts.sort((a, b) => a - b); };
  try {
    const audio = await out.input.getPrimaryAudioTrack(), ts = await starts(out), light = [], match = [];
    for (const t of times) { const y = await luma(out, t); light.push(y ? y.reduce((s, v) => s + v, 0) / y.length : -1); }
    // Start 0.4 s from the join (or end), clear of a frame held across it; go 0.1 s further while the two
    // sources look alike there. Every stretch and cut in the scenario lasts 1 s or more: 0.8 s stays inside.
    for (const { at, keep, cut, dir } of pairs) {
      for (let i = 4; i <= 8; i++) {
        const d = (dir * i) / 10, k = await around(keep + d), c = await around(cut + d), sep = Math.min(...k.map((y) => closest(y, c)));
        if (sep < SEP && i < 8) continue;
        const y = await luma(out, at + d);
        match.push({ at: at + d, sep, keep: closest(y, k), cut: closest(y, c) });
        break;
      }
    }
    return {
      size: exported.blob.size, duration: await out.input.computeDuration(), video: await out.track.computeDuration(),
      audio: audio ? await audio.computeDuration() : null, first: ts[0], gap: ts.reduce((g, t, i) => (i ? Math.max(g, t - ts[i - 1]) : 0), 0),
      srcVideo: await orig.track.computeDuration(), srcStarts: await starts(orig), light, match,
    };
  } finally { out.input.dispose(); orig.input.dispose(); }
}

export async function cutsScenario(page, { record, assert, ok, base, api, viewer }) {
  const near = (a, b, tol = TOL) => Math.abs(a - b) <= tol;
  const seek = async (t) => {
    await page.evaluate((t) => { const v = document.getElementById('preview'); v.pause(); v.currentTime = t; }, t);
    await page.waitForFunction((t) => { const v = document.getElementById('preview'); return !v.seeking && Math.abs(v.currentTime - t) < 1e-3; }, t, { polling: 50 });
  };
  const rows = () => page.$$eval('#cutList:not([hidden]) li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  async function trimTo(a, b) { // start first: every move below keeps start < end
    await seek(a); await page.click('#setStart');
    await seek(b); await page.click('#setEnd');
    const t = await page.evaluate(() => [+document.getElementById('trimStart').value, +document.getElementById('trimEnd').value]);
    assert(near(t[0], a, 0.01) && near(t[1], b, 0.01), `trim handles at ${t.join(' to ')}, wanted ${a} to ${b}`); // the seek is exact to 1 ms
  }
  async function addCut(a, b) {
    await seek(a); await page.click('#cutFrom');
    assert(await page.isEnabled('#cutTo'), `Cut from here at ${a} s was refused: "${await page.textContent('#cutMsg')}"`);
    await seek(b); await page.click('#cutTo');
  }
  async function expectLength(name, kept) { // "Clip length m:ss.s", in tenths: 0.06 covers the rounding
    const text = await page.textContent('#trimLength'), m = /Clip length (\d+):(\d+\.\d)$/.exec(text);
    assert(m && near(+m[1] * 60 + +m[2], kept, 0.06), `${name}: "${text}", but the kept time is ${kept} s`);
  }
  const watchMsgs = () => page.evaluate(() => {
    const el = document.getElementById('uploadMsg');
    window.__cutMsgs = [];
    window.__cutMo?.disconnect();
    window.__cutMo = new MutationObserver(() => window.__cutMsgs.push(el.textContent));
    window.__cutMo.observe(el, { childList: true, characterData: true, subtree: true });
  });
  // Exports with Download MP4, as a person would, then checks the file. `ranges` are the stretches of the
  // recording to keep; `end` is the trim end when the last cut runs up to it.
  async function exportAndCheck(name, ranges, { label = null, end = null } = {}) {
    const kept = ranges.reduce((s, [a, b]) => s + b - a, 0), joins = [], pairs = [];
    // At each join the kept source continues where a missed cut would show its own start.
    ranges.reduce((t, [a, b], i) => { if (i) { joins.push(t); pairs.push({ at: t, keep: a, cut: ranges[i - 1][1], dir: 1 }); } return t + b - a; }, 0);
    // A cut to the trim end: the last frames come from before that cut, not from before the trim end.
    if (end) pairs.push({ at: kept, keep: ranges.at(-1)[1], cut: end, dir: -1 });
    await expectLength(name, kept);
    await watchMsgs();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('#download')]);
    const size = (await stat(await dl.path())).size;
    await page.waitForFunction(() => !document.getElementById('download').disabled, null, { polling: 100 });
    const msgs = await page.evaluate(() => window.__cutMsgs);
    const times = [0.1, ...joins.flatMap((j) => [j - 0.1, j + 0.1]), kept - 0.15];
    const r = await page.evaluate(analyse, { mb: MB, times, pairs, SEP, WIN });
    const where = times.map((t, i) => `${t.toFixed(2)} s: ${r.light[i].toFixed(1)}`).join(', ');
    assert(r.size === size, `${name}: Download gave ${size} bytes, but the export is ${r.size}`);
    // Under load the recording's own video can end before its audio. The export can only keep the video
    // that exists: expect the kept time minus the part of the kept stretches after the source video ends.
    const shortfall = ranges.reduce((s, [a, b]) => s + Math.max(0, b - Math.max(a, r.srcVideo)), 0);
    assert(near(r.duration, kept) && near(r.video, kept - shortfall), `${name}: the file lasts ${r.duration} s (video ${r.video} s); kept time is ${kept} s and the source video ends ${shortfall.toFixed(2)} s short of it`);
    assert(r.audio !== null && near(r.audio, kept), `${name}: audio lasts ${r.audio} s against ${kept} s kept`);
    // The first frame may sit before 0 (the copy path keeps the keyframe before the trim start, hidden by an
    // edit list) but not more than about a frame after it. A hole at a join would be a whole cut, 1 s or more
    // here; the recorder itself drops frames under load (0.3 s seen), so allow up to half a second.
    assert(r.first < 0.05 && r.gap < 0.5, `${name}: video starts at ${r.first} s and has a ${r.gap.toFixed(3)} s hole`);
    assert(r.light.every((l) => l > 5), `${name}: dark or missing frames (mean brightness at ${where})`); // the fake picture is green, near 100
    // Within SEP / 2 of a kept frame and nearer to it than to any cut-out one: a cut-out frame cannot pass.
    for (const m of r.match) assert(m.sep >= SEP && m.keep < m.sep / 2 && m.keep < m.cut, `${name}: frame at ${m.at.toFixed(2)} s is ${m.keep.toFixed(2)} from the kept source and ${m.cut.toFixed(2)} from the cut part, which differ by ${m.sep.toFixed(2)}`);
    const said = msgs.find((m) => /Re-encoding/.test(m)) || '';
    assert(label ? label.test(said) : !said, `${name}: progress messages were ${JSON.stringify(msgs)}`);
    return { ...r, said, matches: r.match.map((m) => `${m.keep.toFixed(2)}<${m.cut.toFixed(2)} at ${m.at.toFixed(1)} s, sources ${m.sep.toFixed(2)} apart`).join('; ') };
  }

  await page.reload(); // a fresh editor, whatever the step before left
  await page.waitForSelector('#app:not([hidden])');
  // Webcam off since two tracks (0.2): the frame checks below compare the export with the screen
  // recording, and with a camera the export also carries the bubble, drawn in at export. The cuts
  // with a camera (the render path) are covered by step 3c and test/tracks-step.mjs.
  await page.uncheck('#cam');
  await record(page, 8);
  await page.waitForFunction(() => document.getElementById('preview').readyState >= 1);
  const D = await page.evaluate(() => window.__vignette.editor.video.duration);
  assert(D > 7.7, `recording parsed as ${D} s, expected about 8`); // a few frames may be lost at the stop
  await trimTo(0.5, 7.5);
  const trimOnly = await exportAndCheck('trim only', [[0.5, 7.5]]);
  ok(`recorded ${D.toFixed(2)} s, trimmed to 0.5..7.5: ${trimOnly.duration.toFixed(2)} s, ${trimOnly.size} bytes, no re-encode`);

  // 1. Two cuts apart: kept 0.5..1, 2..4, 5..7.5 = 5.0 s; joins at 0.5 and 2.5 in the file.
  await addCut(1.0, 2.0);
  await addCut(4.0, 5.0);
  const two = await rows();
  assert(two.length === 2 && /^Cut 1 0:01\.0 to 0:02\.0 \(1\.0 s\)/.test(two[0]) && /^Cut 2 0:04\.0 to 0:05\.0 \(1\.0 s\)/.test(two[1]), `cut list reads ${JSON.stringify(two)}`);
  assert((await page.$$eval('#cutMarks > *', (e) => e.length)) === 2, 'the trim bar does not draw two cuts');
  assert(await page.getByRole('button', { name: /^Remove cut 2\b/ }).count() === 1, 'no "Remove cut 2" button by accessible name');
  const s1 = await exportAndCheck('two cuts', [[0.5, 1], [2, 4], [5, 7.5]], { label: /Re-encoding 2 cuts/ });
  ok(`two cuts: ${s1.duration.toFixed(2)} s for 5.0 kept, "${s1.said}", bright on both sides of each join, frames match the kept source (${s1.matches})`);

  // 2. Overlapping and touching cuts: the clip length must count the union once.
  // Merged, refused or listed as its own row are all fine, as long as the time is counted once.
  await addCut(4.2, 4.8); // wholly inside cut 2
  const inside = await rows();
  assert(inside.length === 2 || inside.length === 3, `a cut inside a cut left ${inside.length} rows`);
  await expectLength('cut inside a cut', 5.0);
  await addCut(4.5, 5.5); // straddles the end of cut 2: kept 0.5..1, 2..4, 5.5..7.5
  await expectLength('overlapping cut', 4.5);
  await addCut(2.0, 2.4); // touches the end of cut 1: kept 0.5..1, 2.4..4, 5.5..7.5 = 4.1
  const s2 = await exportAndCheck('overlapping and touching', [[0.5, 1], [2.4, 4], [5.5, 7.5]], { label: /Re-encoding \d+ cuts/ });
  // Playing through the touching pair jumps from 1.0 straight to 2.4, never showing the middle of 1.0..2.4.
  const landing = s2.srcStarts.findLast((t) => t <= 2.4); // the jump shows the source frame on screen at 2.4 s
  await seek(0.7);
  const seen = await page.evaluate(() => new Promise((done) => {
    const v = document.getElementById('preview'), times = []; let t0 = 0, over = false;
    const stop = () => { if (over) return; over = true; v.pause(); done({ times, ms: performance.now() - t0 }); };
    const onFrame = (_, m) => { t0 ||= performance.now(); times.push(m.mediaTime); if (m.mediaTime > 2.7) stop(); else v.requestVideoFrameCallback(onFrame); };
    v.requestVideoFrameCallback(onFrame);
    v.play();
    setTimeout(stop, 8000);
  }));
  // The skip runs on each frame shown, or on timeupdate (every 250 ms) when that is late, so frames up to
  // 0.35 s into the cut may show first; without it about 30 from 1.35 s to the landing would. The jump's
  // seek is slow under load: 3 s from the first frame to past 2.7 s (about 0.7 s on a quiet machine).
  const leaked = seen.times.filter((t) => t > 1.35 && t < landing - 0.005); // 5 ms: player and file times round differently
  assert(seen.times.some((t) => t <= 1.35) && Math.max(...seen.times) > 2.7 && !leaked.length && seen.ms < 3000, `preview from 0.7 s showed ${leaked.length} frames between 1.35 s and ${landing.toFixed(3)} s (${leaked.slice(0, 5).join(', ')}) and took ${seen.ms.toFixed(0)} ms from its first frame to pass 2.7 s`);
  const j = seen.times.findIndex((t) => t >= landing - 0.005);
  ok(`overlaps: inside cut gave ${inside.length} rows and length unchanged; union 4.1 s kept, file ${s2.duration.toFixed(2)} s, "${s2.said}" (${s2.matches}); preview jumps ${seen.times[j - 1].toFixed(2)} to ${seen.times[j].toFixed(2)} s, past 2.7 s ${seen.ms.toFixed(0)} ms after its first frame`);

  // 3. A cut up to the trim end: kept 0.5..1, 2.4..4, 5.5..6.5 = 3.1 s.
  await addCut(6.5, 7.5);
  const s3 = await exportAndCheck('cut to the trim end', [[0.5, 1], [2.4, 4], [5.5, 6.5]], { label: /Re-encoding \d+ cuts/, end: 7.5 });
  ok(`cut to the trim end: ${s3.duration.toFixed(2)} s for 3.1 kept, last frame is from before the cut (${s3.matches})`);

  // 4. Move the trim over the cuts: 3..7 leaves 3..4 and 5.5..6.5 = 2.0 s.
  await trimTo(3.0, 7.0);
  const s4 = await exportAndCheck('trim moved over cuts', [[3, 4], [5.5, 6.5]], { label: /Re-encoding \d+ cut/ });
  // A trim wholly inside a cut leaves nothing: no file may come out.
  await trimTo(4.1, 4.9);
  await expectLength('trim inside a cut', 0);
  let refused = await page.isDisabled('#download');
  if (!refused) {
    let downloads = 0; const count = () => downloads++;
    page.on('download', count);
    await watchMsgs();
    await page.click('#download');
    await page.waitForFunction(() => !document.getElementById('download').disabled && window.__cutMsgs.length > 0, null, { polling: 100 });
    await page.waitForTimeout(1000);
    page.off('download', count);
    const msg = (await page.textContent('#uploadMsg')).trim();
    refused = downloads === 0 && /\S/.test(msg);
    assert(refused, `a trim inside a cut gave ${downloads} downloads and the message "${msg}"`);
  }
  await trimTo(0.5, 7.5);
  await expectLength('trim restored', 3.1);
  ok(`trim 3..7 over the cuts: ${s4.duration.toFixed(2)} s for 2.0 kept (${s4.matches}); a trim inside a cut gives no file; cuts survive the trim going back`);

  // 5. Remove every cut by its Remove button: back to the trim-only copy path.
  for (let n = (await rows()).length; n > 0; n--) {
    await page.getByRole('button', { name: /^Remove cut 1\b/ }).click();
    assert((await rows()).length === n - 1, `Remove left ${(await rows()).length} rows, expected ${n - 1}`);
  }
  assert(await page.isHidden('#cutList'), 'the empty cut list is still shown');
  const s5 = await exportAndCheck('all cuts removed', [[0.5, 7.5]]);
  const how = await page.evaluate(() => window.__vignette.details.export || '');
  assert(Math.abs(s5.size - trimOnly.size) <= 0.2 * trimOnly.size && !/re-encoded/.test(how), `with no cuts the export is ${s5.size} bytes (trim only was ${trimOnly.size}), details say "${how}"`); // same source, same trim: 20% leaves room for container detail only
  ok(`all cuts removed: ${s5.duration.toFixed(2)} s, ${s5.size} bytes against ${trimOnly.size} for the trim alone, no re-encode`);

  // 6. Upload with two cuts; the share page plays the cut file.
  await addCut(1.0, 2.0);
  await addCut(4.0, 5.0);
  await expectLength('upload', 5.0);
  await page.fill('#title', 'Cuts scenario');
  await watchMsgs();
  await page.click('#upload');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 180_000 });
  const said = (await page.evaluate(() => window.__cutMsgs)).find((m) => /Re-encoding/.test(m)) || '';
  assert(/Re-encoding 2 cuts/.test(said), `upload never said it was re-encoding 2 cuts (${JSON.stringify(await page.evaluate(() => window.__cutMsgs))})`);
  const url = await page.inputValue('#shareUrl'), id = url.split('/v/')[1];
  const sent = await page.evaluate(() => window.__vignette.editor.exported.blob.size);
  const row = (await (await api(base, '/api/videos')).json()).videos.find((v) => v.id === id);
  assert(row && near(row.duration, 5.0) && row.size === sent, `stored row ${JSON.stringify(row)}; expected 5.0 s and ${sent} bytes`);
  const v = await viewer();
  await v.goto(url);
  await v.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 30_000, polling: 100 });
  const shown = await v.evaluate(() => {
    const el = document.querySelector('video');
    el.muted = true;
    el.play();
    return { duration: el.duration, runtime: document.querySelector('.runtime').textContent.trim() };
  });
  assert(near(shown.duration, 5.0) && /\b0:05$/.test(shown.runtime), `share page: video ${shown.duration} s, runtime "${shown.runtime}"`);
  await v.waitForFunction(() => { const el = document.querySelector('video'); return !el.error && (el.ended || el.currentTime > 4.6); }, null, { timeout: 15_000, polling: 100 }); // past both joins, to the last 0.4 s
  await v.close();
  assert((await api(base, `/api/videos/${id}`, { method: 'DELETE' })).status === 200, 'cleanup delete failed');
  ok(`uploaded with 2 cuts ("${said}"): stored ${row.duration.toFixed(2)} s, share page says ${shown.runtime} and plays to the end`);
}
