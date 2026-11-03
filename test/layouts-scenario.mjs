// Independent scenario test for layouts (docs/LOOP3_LAYOUTS_SPEC.md), written from the spec and the page, not
// from the builder's steps (AGENTS.md rule 5): a padded render of a 2560x1440 share, Split with a portrait
// camera, Camera only with a camera lost mid-recording, rendering again when an original's download breaks
// half way, rendering again with the password refused, deleting during an upload rendered again, rendering
// again twice in a row, and a 60 s Split render's memory and speed. Each scenario gets its own browser context
// and runs even when one before it fails; each prints "ok" or "FAIL" with its figures, and the summary names
// every result. Pictures are found by geometry (black rules, letterboxes, bars drawn into a camera of our own),
// never by the fake devices' colours, which are the same green on Linux; the padded colour is not green. What
// runs in the page (init scripts, decoding and measuring) is in layouts-scenario-page.mjs.
import { createHash } from 'node:crypto';
import { PASSWORD } from './harness.mjs';
import {
  PORTRAIT, wideShare, portraitCamera, brokenScreenDownload, measure, heldDiffs, isColour, rgb, run, r2Keys,
} from './layouts-scenario-page.mjs';

export const LAYOUTS_SCENARIO = '3n. Layouts, independent scenarios (padded 2560x1440, split with a portrait camera, camera only with the camera lost, '
  + 'again with a broken download, again with the password refused, delete during an again upload, again twice, a 60 s split render)';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const VERMILION = [0xCF, 0x2E, 0x12]; // layouts.js COLOURS.vermilion
const LONG = 60;      // seconds for the memory scenario
const PEAK_MB = 400;  // the bound loop 1 set for a 60 s recording

// dir: wrangler dev's --persist-to folder, to look into R2 (optional). only: scenario numbers to run (all when left out).
export async function layoutsScenario(page, { record, assert, ok, base, api, login, pageHooks, watch, dir, only }) {
  const browser = page.context().browser();
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const contexts = [];
  async function fresh({ cam = true, init = null, viewport = null, signIn = true } = {}) {
    const ctx = await browser.newContext(viewport ? { viewport } : {});
    contexts.push(ctx);
    await ctx.addInitScript(pageHooks);
    if (init) await ctx.addInitScript(init);
    const p = watch(await ctx.newPage(), 'layouts scenario');
    const t = { ctx, p, errs: [] };
    p.on('pageerror', (e) => t.errs.push(e.message));
    if (!signIn) return t;
    await login(p, base);
    await p.waitForSelector('#app:not([hidden])');
    if (cam) await p.check('#cam'); else await p.uncheck('#cam');
    return t;
  }
  const look = (p, o) => p.evaluate(measure, { mb: MB, ...o });
  const hook = (p) => p.evaluate(() => ({ id: window.__vignette.layout.id, value: window.__vignette.layout.value, g: window.__vignette.layout.geometry() }));
  async function choose(p, title, colour) { // a click on the plate (and the swatch), as a person would
    await p.click(`#layoutSet label[title="${title}"]`);
    if (colour) await p.click(`#colourSet label[title="${colour}"]`);
    return hook(p);
  }
  async function exportNow(p) { // Download MP4; resolves once the file is saved
    const t0 = Date.now();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 300_000 }), p.click('#download')]);
    await dl.path();
    await p.waitForFunction(() => !document.getElementById('download').disabled, null, { polling: 100 });
    const secs = (Date.now() - t0) / 1000;
    return p.evaluate((secs) => {
      const d = window.__vignette.details, e = window.__vignette.editor.exported;
      return { secs, how: d.export || '', layout: d.layout || '', peak: d['peak memory'] || '', w: e.width, h: e.height, duration: e.duration };
    }, secs);
  }
  const row = async (id) => { const r = await api(base, `/api/videos/${id}`); return { http: r.status, ...(await r.json().catch(() => ({}))) }; };
  const got = async (r) => { const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, bytes: b.length, sha: createHash('sha256').update(b).digest('hex') }; };
  const pub = (path) => fetch(`${base}${path}`).then(got);
  const owner = (path) => api(base, path).then(got);
  const ed = (p) => p.evaluate(() => {
    const { video, camera } = window.__vignette.editor;
    return { w: video?.width, h: video?.height, duration: video?.duration, cam: camera && { w: camera.width, h: camera.height, duration: camera.duration, offset: camera.offset, lostAt: camera.lostAt } };
  });
  const corners = (W, H, k = 24) => [
    { name: 'tl', x0: 4, y0: 4, x1: k, y1: k }, { name: 'tr', x0: W - k, y0: 4, x1: W - 4, y1: k },
    { name: 'bl', x0: 4, y0: H - k, x1: k, y1: H - 4 }, { name: 'br', x0: W - k, y0: H - k, x1: W - 4, y1: H - 4 },
  ];
  // Split's signature in a frame W x H with the rule at `cut`: the 2 px rule black, the camera column filled to
  // its edges top to bottom, and black above and below the (16:9) screen in the left 70%.
  const splitBoxes = (W, H, cut) => [
    { name: 'rule', x0: cut, y0: 0, x1: cut + 2, y1: H }, { name: 'camL', x0: cut + 6, y0: 20, x1: cut + 18, y1: H - 20 },
    { name: 'camR', x0: W - 16, y0: 20, x1: W - 4, y1: H - 20 }, { name: 'camTop', x0: cut + 22, y0: 3, x1: W - 20, y1: 12 },
    { name: 'camBottom', x0: cut + 22, y0: H - 12, x1: W - 20, y1: H - 3 },
    { name: 'above', x0: 40, y0: 20, x1: cut - 40, y1: Math.round(H * 0.12) }, { name: 'below', x0: 40, y0: Math.round(H * 0.88), x1: cut - 40, y1: H - 20 },
    { name: 'screen', x0: 100, y0: Math.round(H * 0.3), x1: cut - 100, y1: Math.round(H * 0.7) },
  ];
  function isSplit(name, f, camMin = 40) { // camMin: the camera column's luma floor (our portrait camera is mid grey)
    const b = f.boxes, fig = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.y.toFixed(0)]));
    assert(b.rule.y < 40 && b.above.y < 30 && b.below.y < 30, `${name}: expected a black 2 px rule at 70% and black above and below the screen, saw luma ${JSON.stringify(fig)} at ${f.t} s`);
    assert([b.camL, b.camR, b.camTop, b.camBottom].every((v) => v.y > camMin) && b.screen.y > 40,
      `${name}: expected the camera column filled edge to edge and top to bottom (luma over ${camMin}) and the screen showing (over 40), saw ${JSON.stringify(fig)} at ${f.t} s`);
    return fig;
  }

  // ---------- 1. Padded, a 2560x1440 share, vermilion ----------
  async function padded2560() {
    const t = await fresh({ init: wideShare });
    await record(t.p, 3);
    const e = await ed(t.p), capture = await t.p.evaluate(() => window.__vignette.details['capture size']);
    assert(e.w === 2560 && e.h === 1440, `expected a 2560x1440 screen recording (capture "${capture}"), saw ${e.w}x${e.h}`);
    const h = await choose(t.p, 'Padded', 'Vermilion'), g = h.g;
    assert(h.value === 'padded:vermilion' && g.W === 1920 && g.H === 1080, `expected padded:vermilion at 1920x1080, saw ${h.value} at ${g?.W}x${g?.H}`);
    const out = await exportNow(t.p);
    assert(out.w === 1920 && out.h === 1080 && /^Padded on vermilion, 1920x1080, rendered at/.test(out.layout), `expected a 1920x1080 padded export, saw ${out.w}x${out.h}, Details "${out.layout}"`);
    const s = g.screen, W = 1920, H = 1080, mid = H / 2;
    const boxes = [...corners(W, H),
      { name: 'leftPad', x0: 20, y0: mid - 50, x1: s.x - 20, y1: mid + 50 }, { name: 'rightPad', x0: s.x + s.w + 20, y0: mid - 50, x1: W - 20, y1: mid + 50 },
      { name: 'topPad', x0: W / 2 - 100, y0: 10, x1: W / 2 + 100, y1: s.y - 15 }, { name: 'bottomPad', x0: W / 2 - 100, y0: s.y + s.h + 15, x1: W / 2 + 100, y1: H - 10 },
      { name: 'inside', x0: s.x + 40, y0: s.y + 40, x1: s.x + s.w - 40, y1: s.y + s.h - 40 }, { name: 'insideEdge', x0: s.x + 4, y0: s.y + 100, x1: s.x + 14, y1: s.y + s.h - 100 },
    ];
    const r = await look(t.p, { src: 'exported', times: [0.5, 2], ref: { W, H }, boxes });
    for (const f of r.frames) {
      assert(f.w === W && f.h === H, `expected decoded frames 1920x1080, saw ${f.w}x${f.h}`);
      const bad = ['tl', 'tr', 'bl', 'br', 'leftPad', 'rightPad', 'topPad', 'bottomPad'].filter((k) => !isColour(f.boxes[k], VERMILION));
      assert(!bad.length, `expected vermilion (${VERMILION}) in the corners and margins at ${f.t} s, saw ${bad.map((k) => `${k} ${rgb(f.boxes[k])}`).join(', ')}`);
      assert(!isColour(f.boxes.inside, VERMILION) && !isColour(f.boxes.insideEdge, VERMILION),
        `expected the screen inside its box ${JSON.stringify(s)}, saw ${rgb(f.boxes.inside)} inside and ${rgb(f.boxes.insideEdge)} just inside its left edge`);
    }
    await t.p.waitForFunction(() => window.__vignette.editor.thumb?.look === 'padded:vermilion', null, { timeout: 15_000 });
    const th = (await look(t.p, { src: 'thumb', ref: { W, H }, boxes: corners(W, H, 60) })).frames[0];
    const thBad = ['tl', 'tr', 'bl', 'br'].filter((k) => !isColour(th.boxes[k], VERMILION));
    assert(th.w === 640 && !thBad.length, `expected a 640 wide thumbnail with vermilion corners, saw ${th.w}x${th.h}, ${thBad.map((k) => `${k} ${rgb(th.boxes[k])}`).join(', ')}`);
    return `2560x1440 recorded, exported ${out.w}x${out.h}, corners ${rgb(r.frames[0].boxes.tl)}, screen box ${s.w}x${s.h} at ${s.x},${s.y}; thumbnail corners vermilion`;
  }

  // ---------- 2. Split with a portrait camera ----------
  async function splitPortrait() {
    const t = await fresh({ init: portraitCamera });
    await record(t.p, 3);
    const e = await ed(t.p);
    assert(e.cam && e.cam.w === PORTRAIT.w && e.cam.h === PORTRAIT.h, `expected a ${PORTRAIT.w}x${PORTRAIT.h} camera file, saw ${JSON.stringify(e.cam)}`);
    const { g } = await choose(t.p, 'Split'), W = g.W, H = g.H, cut = Math.round(W * 0.7) & ~1;
    assert(W === e.w && H === e.h && g.screen.x === 0 && g.screen.w === cut && g.camera.x === cut + 2 && g.camera.w === W - cut - 2 && g.camera.h === H && g.camera.fit === 'cover',
      `expected the screen in 0..${cut} and the camera covering ${cut + 2}..${W} of ${e.w}x${e.h}, saw ${JSON.stringify(g)}`);
    const out = await exportNow(t.p);
    assert(out.w === W && out.h === H && /^Split, /.test(out.layout), `expected a ${W}x${H} split export, saw ${out.w}x${out.h}, Details "${out.layout}"`);
    const c = g.camera, scale = Math.max(c.w / PORTRAIT.w, c.h / PORTRAIT.h), crop = (PORTRAIT.w - c.w / scale) / 2;
    const r = await look(t.p, {
      src: 'exported', times: [1, 2], ref: { W, H }, boxes: splitBoxes(W, H, cut),
      rows: [{ name: 'across', y: Math.round(H * 0.25), x0: c.x, x1: W }], cols: [{ name: 'down', x: c.x + Math.round(c.w * 0.12), y0: 0, y1: H }],
    });
    let fig;
    for (const f of r.frames) {
      fig = isSplit('split, portrait camera', f, 90);
      const upright = run(f.rows.across, 200), level = run(f.cols.down, 200);
      const want = { x: c.x + c.w / 2, w: 24 * scale, y: H / 2 };
      const seen = { x: upright && c.x + upright.mid, w: upright && upright.end - upright.start, y: level && level.mid };
      assert(upright && level && near(seen.x, want.x, 4) && near(seen.w, want.w, 5) && near(seen.y, want.y, 4),
        `expected the camera's centre bars at x ${want.x.toFixed(1)} (${want.w.toFixed(0)} px wide) and y ${want.y} (cover, centred), saw ${JSON.stringify(seen)} at ${f.t} s`);
    }
    return `${PORTRAIT.w}x${PORTRAIT.h} camera in a ${c.w}x${c.h} column at x ${c.x}: cover scale ${scale.toFixed(3)}, ${crop.toFixed(1)} px cropped each side, the side bars gone, `
      + `centre bar at ${(c.x + c.w / 2).toFixed(0)} within 4 px; rule luma ${fig.rule}, black above (${fig.above}) and below (${fig.below}) the screen`;
  }

  // ---------- 3. Camera only, the camera lost mid-recording ----------
  async function cameraLost() {
    const t = await fresh();
    const LOSE = 1.5, SECS = 5;
    await record(t.p, SECS, async () => {
      await t.p.waitForTimeout(LOSE * 1000);
      await t.p.evaluate(() => { const v = window.__vignette.state.cam.getVideoTracks()[0]; v.stop(); v.dispatchEvent(new Event('ended')); }); // unplugged
      await t.p.waitForTimeout((SECS - LOSE) * 1000);
    });
    const e = await ed(t.p);
    assert(e.cam && e.cam.lostAt > LOSE - 0.3 && e.cam.duration < e.duration - 2, `expected the camera file to end near ${LOSE} s of ${e.duration} s, saw ${JSON.stringify(e.cam)}`);
    const { g } = await choose(t.p, 'Camera only');
    const capped = Math.min(1, 1920 / e.cam.w, 1080 / e.cam.h), want = { W: Math.round(e.cam.w * capped) & ~1, H: Math.round(e.cam.h * capped) & ~1 };
    assert(g.W === want.W && g.H === want.H && !g.screen, `expected a ${want.W}x${want.H} frame (the camera's own) with no screen, saw ${JSON.stringify(g)}`);
    const out = await exportNow(t.p);
    assert(out.w === want.W && out.h === want.H && near(out.duration, e.duration, 0.4), `expected a ${want.W}x${want.H} export lasting ${e.duration.toFixed(2)} s, saw ${out.w}x${out.h} for ${out.duration} s`);
    const camEnd = e.cam.offset + e.cam.duration, live = [0.3, 0.7, 1.1].filter((x) => x < camEnd - 0.2), held = [camEnd + 0.6, e.duration - 0.5];
    assert(live.length >= 2 && held[1] - held[0] > 1, `expected time to compare (camera ends at ${camEnd.toFixed(2)} s of ${e.duration.toFixed(2)})`);
    const r = await t.p.evaluate(heldDiffs, { mb: MB, times: [...live, ...held] }), n = live.length;
    const heldDiff = r.pairs[n][n + 1], liveDiff = Math.max(...live.flatMap((_, i) => live.map((__, j) => (j > i ? r.pairs[i][j] : 0))));
    const toLast = Math.max(r.frames[n].toLast, r.frames[n + 1].toLast);
    assert(r.frames.every((f) => f.w === 640 && f.h === Math.round(640 * want.H / want.W)), `expected 640 wide frames of the camera's shape, saw ${r.frames.map((f) => `${f.w}x${f.h}`)}`);
    assert(heldDiff < 3 && liveDiff > 2 * heldDiff, `expected the picture to hold after ${camEnd.toFixed(2)} s (change under 3, and under half the live change), saw ${heldDiff.toFixed(2)} held against ${liveDiff.toFixed(2)} live`);
    assert(toLast < 8, `expected the held picture to be the camera's last frame (difference under 8), saw ${toLast.toFixed(2)} (and ${r.frames[n].toEarlier.toFixed(2)} from one 0.3 s before it)`);
    return `camera lost ${e.cam.lostAt.toFixed(2)} s in (file ${e.cam.duration.toFixed(2)} s of ${e.duration.toFixed(2)} s); exported ${out.w}x${out.h} for ${out.duration.toFixed(2)} s; `
      + `held from ${camEnd.toFixed(2)} s: change ${heldDiff.toFixed(2)} against ${liveDiff.toFixed(2)} live, ${toLast.toFixed(2)} from the camera's last frame, ${r.frames[n].toEarlier.toFixed(2)} from one 0.3 s earlier`;
  }

  // ---------- A recording with originals, for the again scenarios ----------
  let basis = null;
  async function ensureBase() {
    if (basis) {
      const r = await row(basis.id);
      if (r.http === 200 && r.status === 'ready' && r.has_raw === 1 && !r.again) return { ...basis, row: r };
    }
    const t = await fresh();
    await record(t.p, 4);
    await t.p.fill('#title', 'Layouts scenario: rendered again');
    await t.p.click('#upload');
    await t.p.waitForSelector('#shareBox:not([hidden])', { timeout: 120_000 });
    await t.p.waitForFunction(() => /^Originals (not )?kept/.test(document.getElementById('rawMsg').textContent), null, { timeout: 120_000 });
    const id = (await t.p.inputValue('#shareUrl')).split('/v/')[1], r = await row(id);
    assert(r.status === 'ready' && r.has_raw === 1 && r.layout === 'bubble', `expected a ready bubble recording with originals, saw ${JSON.stringify(r)}`);
    const [screen, camera] = await Promise.all(['screen', 'camera'].map((k) => owner(`/api/videos/${id}/raw/${k}`)));
    await t.ctx.close();
    basis = { id, screen, camera };
    return { ...basis, row: r };
  }
  async function openAgain(t, id) { // resolves once the again mode is ready or has failed
    await t.p.goto(`${base}/?again=${id}`);
    await t.p.waitForFunction(() => ['ready', 'failed'].includes(window.__vignette?.again.state), null, { timeout: 90_000 });
    return t.p.evaluate(() => ({ ...window.__vignette.again, msg: document.getElementById('setupMsg').textContent }));
  }
  const unchanged = (a, b) => ['status', 'size', 'layout', 'title', 'duration', 'has_raw', 'again'].filter((k) => a[k] !== b[k]);

  // ---------- 4. Again, the screen original's download breaks half way ----------
  async function brokenDownload() {
    const b = await ensureBase(), media = await pub(`/media/${b.id}`), seen = [];
    const ways = [
      ['cut short (the body ends at half its length)', null, (t) => t.p.route(`**/api/videos/${b.id}/raw/screen`, async (route) => {
        const res = await route.fetch(), body = await res.body();
        await route.fulfill({ status: 200, headers: res.headers(), body: body.subarray(0, Math.floor(body.length / 2)) });
      })],
      ['dropped (the body errors at half its length)', brokenScreenDownload, async () => {}],
    ];
    for (const [how, init, arm] of ways) {
      const t = await fresh({ init }), posts = [];
      t.p.on('request', (q) => { if (q.method() !== 'GET') posts.push(`${q.method()} ${new URL(q.url()).pathname}`); });
      await arm(t);
      const a = await openAgain(t, b.id);
      assert(a.state === 'failed', `${how}: expected the again mode to fail, saw ${JSON.stringify(a)}`);
      const band = await t.p.evaluate(() => {
        const m = document.getElementById('setupMsg'), link = m.querySelector('a');
        return { shown: !m.closest('.msg').hidden, link: link && { text: link.textContent, href: link.getAttribute('href') }, edit: !document.getElementById('editStep').hidden, source: document.getElementById('source').textContent };
      });
      const after = await row(b.id), changed = unchanged(b.row, after), m2 = await pub(`/media/${b.id}`);
      assert(/Could not load the originals/.test(a.error) && a.msg.includes(a.error) && band.shown, `${how}: expected "Could not load the originals ..." on the step 1 band, saw ${JSON.stringify({ error: a.error, msg: a.msg, shown: band.shown })}`);
      assert(band.link?.text === 'Record another' && band.link.href === '/' && !band.edit, `${how}: expected a Record another link to / and no edit step, saw ${JSON.stringify(band)}`);
      assert(a.progress.total > 0 && a.progress.sent < a.progress.total, `${how}: expected the download to stop part way, saw ${JSON.stringify(a.progress)}`);
      assert(!changed.length && !posts.length && m2.sha === media.sha, `${how}: expected no change to the row or the video, saw ${changed.map((k) => `${k} ${b.row[k]} to ${after[k]}`).join(', ')} and requests ${posts.join(', ') || 'none'}`);
      assert(!t.errs.length, `${how}: page errors: ${t.errs.join('; ')}`);
      seen.push(`${how}: "${a.error}" with Record another, ${(a.progress.sent / 1048576).toFixed(1)} of ${(a.progress.total / 1048576).toFixed(1)} MB loaded`);
      await t.ctx.close();
    }
    return `${seen.join('; ')}; the row stayed ready at ${b.row.size} bytes, layout ${b.row.layout}, nothing sent`;
  }

  // ---------- 5. Again, the password refused ----------
  async function refused() {
    const b = await ensureBase(), seen = [];
    // a. A wrong password at the gate of /?again=<id>: it stays locked and asks for nothing, then the right one loads it.
    const t = await fresh({ signIn: false }), asked = [];
    t.p.on('request', (q) => { if (new URL(q.url()).pathname.startsWith(`/api/videos/${b.id}`)) asked.push(new URL(q.url()).pathname); });
    await t.p.goto(`${base}/?again=${b.id}`);
    await t.p.waitForSelector('#gate:not([hidden])');
    await t.p.fill('#password', 'not-the-password');
    await t.p.click('#gate button[type=submit]');
    await t.p.waitForFunction(() => /not right/.test(document.querySelector('#gate .error').textContent), null, { timeout: 15_000 });
    const locked = await t.p.evaluate(() => ({ app: !document.getElementById('app').hidden, state: window.__vignette.again.state }));
    assert(!locked.app && locked.state === 'off' && !asked.length, `wrong password: expected the gate only, saw ${JSON.stringify(locked)} and requests ${asked.join(', ') || 'none'}`);
    await t.p.fill('#password', PASSWORD);
    await t.p.click('#gate button[type=submit]');
    await t.p.waitForFunction(() => window.__vignette.again.state === 'ready', null, { timeout: 90_000 });
    seen.push('a wrong password keeps the gate and asks for nothing; the right one loads it');
    await t.ctx.close();
    // b and c. The server refuses the password after the gate let it through: on the row, then on the camera original.
    for (const [what, path] of [['the row', `/api/videos/${b.id}`], ['the camera original', `/api/videos/${b.id}/raw/camera`]]) {
      const u = await fresh();
      let refusals = 0;
      await u.p.route((url) => url.pathname === path, (route) => (refusals++ ? route.continue()
        : route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Wrong or missing password"}' })));
      await u.p.goto(`${base}/?again=${b.id}`);
      await u.p.waitForSelector('#gate:not([hidden])', { timeout: 30_000 });
      const s = await u.p.evaluate(() => ({ error: document.querySelector('#gate .error').textContent, state: window.__vignette.again.state, stored: localStorage.getItem('vignette.password') }));
      assert(refusals === 1 && /did not accept the password/.test(s.error) && s.state === 'off' && s.stored === null,
        `401 on ${what}: expected the gate again with "did not accept the password", nothing loading and the password forgotten, saw ${JSON.stringify(s)} after ${refusals} refusals`);
      await u.p.fill('#password', PASSWORD);
      await u.p.click('#gate button[type=submit]');
      await u.p.waitForFunction(() => window.__vignette.again.state === 'ready' && !document.getElementById('editBody').hidden, null, { timeout: 90_000 });
      assert(!u.errs.length, `401 on ${what}: page errors: ${u.errs.join('; ')}`);
      seen.push(`a 401 on ${what} shows "${s.error}" and loads after the password`);
      await u.ctx.close();
    }
    return seen.join('; ');
  }

  // ---------- 6. Delete during an upload rendered again ----------
  async function deleteDuring() {
    const b = await ensureBase(), t = await fresh(), id = b.id;
    const a = await openAgain(t, id);
    assert(a.state === 'ready', `expected the originals loaded, saw ${JSON.stringify(a)}`);
    await choose(t.p, 'Camera only');
    let hit, release;
    const reached = new Promise((r) => { hit = r; }), go = new Promise((r) => { release = r; });
    await t.p.route((url) => url.pathname === `/api/videos/${id}/parts/1` && !url.searchParams.has('track'), async (route) => { hit(); await go; await route.continue(); });
    await t.p.click('#upload');
    await Promise.race([reached, new Promise((_, no) => setTimeout(() => no(new Error('the upload never reached its first part')), 180_000))]);
    const during = await row(id), old = await pub(`/media/${id}`), store = dir ? await r2Keys(dir, id) : null;
    assert(during.status === 'uploading' && during.again === 1 && old.status === 200 && old.bytes === b.row.size,
      `expected the row rendering again with the old video still served, saw ${JSON.stringify({ status: during.status, again: during.again, media: old.status, bytes: old.bytes, size: b.row.size })}`);
    if (store) {
      assert(store.objects.length === 4 && store.uploads.some((u) => u.state === 0 && u.key === `videos/${id}.mp4`), `expected four objects and an open upload in R2, saw ${JSON.stringify(store)}`);
    }
    const del = await api(base, `/api/videos/${id}`, { method: 'DELETE' });
    release();
    await t.p.waitForFunction(() => /^Upload failed/.test(document.getElementById('uploadMsg').textContent) && !document.getElementById('upload').disabled, null, { timeout: 120_000 });
    const msg1 = await t.p.textContent('#uploadMsg');
    await t.p.click('#retry');
    await t.p.waitForFunction(() => /^Upload failed/.test(document.getElementById('uploadMsg').textContent) && !document.getElementById('retry').disabled, null, { timeout: 120_000 });
    const msg2 = await t.p.textContent('#uploadMsg'), size = await t.p.evaluate(() => window.__vignette.editor.exported.blob.size);
    const gone = {
      row: (await row(id)).http, listed: (await (await api(base, '/api/videos')).json()).videos.some((v) => v.id === id), share: (await pub(`/v/${id}`)).status,
      media: (await pub(`/media/${id}`)).status, mediaOld: (await pub(`/media/${id}?v=${b.row.size.toString(36)}`)).status, mediaNew: (await pub(`/media/${id}?v=${size.toString(36)}`)).status,
      thumb: (await pub(`/thumb/${id}`)).status, screen: (await owner(`/api/videos/${id}/raw/screen`)).status, camera: (await owner(`/api/videos/${id}/raw/camera`)).status,
    };
    const after = dir ? await r2Keys(dir, id) : null;
    assert(del.status === 200, `expected the delete to succeed during the upload, saw ${del.status}`);
    assert(gone.row === 404 && !gone.listed && ['share', 'media', 'mediaOld', 'mediaNew', 'thumb', 'screen', 'camera'].every((k) => gone[k] === 404), `expected everything 404 after the delete, saw ${JSON.stringify(gone)}`);
    assert(!after || (!after.objects.length && !after.uploads.some((u) => u.state === 0)), `expected no objects and no open upload left in R2, saw ${JSON.stringify(after)}`);
    assert(/Video not found/.test(msg1) && /Video not found/.test(msg2) && !t.errs.length, `expected "Upload failed: Video not found" twice and no page errors, saw "${msg1}", "${msg2}", errors ${t.errs.join('; ') || 'none'}`);
    await t.p.goto(`${base}/library`);
    await t.p.waitForFunction(() => !document.getElementById('app').hidden && document.getElementById('status').hidden, null, { timeout: 30_000 });
    const lib = await t.p.$(`tr[data-id="${id}"]`);
    assert(!lib && !t.errs.length, `expected the library without the row and without errors, saw the row ${!!lib}, errors ${t.errs.join('; ') || 'none'}`);
    basis = null;
    return `deleted while part 1 was held: old video served (${old.bytes} bytes) until then; then row, share page, media (old and new ?v=), thumb and both originals 404, `
      + `${store ? `R2 went from ${store.objects.length} objects and an open upload to ${after.objects.length} objects and ${after.uploads.filter((u) => u.state === 0).length} open` : 'R2 store not inspected (no folder given)'}; `
      + `the page said "${msg1}" and Retry said it again`;
  }

  // ---------- 7. Again twice in a row: Split, then Padded ----------
  async function twice() {
    const b = await ensureBase(), id = b.id, thumb0 = await pub(`/thumb/${id}`), versions = [];
    for (const [title, colour, value] of [['Split', null, 'split'], ['Padded', 'Vermilion', 'padded:vermilion']]) {
      const t = await fresh(), before = await row(id);
      const a = await openAgain(t, id);
      assert(a.state === 'ready', `${title}: expected the originals loaded, saw ${JSON.stringify(a)}`);
      const pre = await t.p.evaluate(() => ({ layout: window.__vignette.layout.value, title: document.getElementById('title').value, label: document.getElementById('uploadLabel').textContent, source: document.getElementById('source').textContent }));
      assert(pre.layout === before.layout && pre.title === before.title && pre.label === 'Upload and replace' && pre.source === `Rendering again: ${before.title}`,
        `${title}: expected ${before.layout} preselected for "${before.title}", saw ${JSON.stringify(pre)} (again ${JSON.stringify(a)})`);
      await choose(t.p, title, colour);
      await t.p.click('#upload');
      await t.p.waitForSelector('#shareBox:not([hidden])', { timeout: 180_000 });
      const done = await t.p.evaluate(async () => {
        const blob = window.__vignette.editor.exported.blob, sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
        return { url: document.getElementById('shareUrl').value, msg: document.getElementById('uploadMsg').textContent, size: blob.size, sha, w: window.__vignette.editor.exported.width, h: window.__vignette.editor.exported.height };
      });
      const r = await row(id), media = await pub(`/media/${id}`), th = await pub(`/thumb/${id}`), share = await (await fetch(`${base}/v/${id}`)).text();
      assert(done.url === `${base}/v/${id}` && /same link now plays this version/.test(done.msg), `${title}: expected the same link and "The same link now plays this version", saw ${JSON.stringify(done)}`);
      assert(r.status === 'ready' && r.layout === value && r.has_raw === 1 && !r.again && r.size === done.size && media.bytes === done.size && media.sha === done.sha,
        `${title}: expected the row ready as ${value} and /media to be the new file (${done.size} bytes), saw row ${JSON.stringify({ status: r.status, layout: r.layout, has_raw: r.has_raw, again: r.again, size: r.size })}, media ${media.bytes} bytes, same file ${media.sha === done.sha}`);
      assert(share.includes(`?v=${done.size.toString(36)}`) && th.status === 200 && th.sha !== (versions.at(-1)?.thumb ?? thumb0.sha), `${title}: expected the share page on the new version and a new thumbnail, saw ?v=${done.size.toString(36)} ${share.includes(`?v=${done.size.toString(36)}`)}, thumb ${th.status}`);
      const W = done.w, H = done.h, cut = Math.round(W * 0.7) & ~1;
      const f = (await look(t.p, { src: 'media', id, times: [0.5], ref: { W, H }, boxes: [...splitBoxes(W, H, cut), ...corners(W, H)] })).frames[0];
      if (value === 'split') isSplit('again as Split, /media', f);
      else {
        const bad = ['tl', 'tr', 'bl', 'br'].filter((k) => !isColour(f.boxes[k], VERMILION));
        assert(!bad.length && f.boxes.rule.y > 40, `${title}: expected /media to be padded (vermilion corners, no black rule at 70%), saw ${bad.map((k) => `${k} ${rgb(f.boxes[k])}`).join(', ') || 'corners fine'}, rule luma ${f.boxes.rule.y.toFixed(0)}`);
        const tf = (await look(t.p, { src: 'thumbUrl', id, ref: { W, H }, boxes: corners(W, H, 60) })).frames[0];
        assert(['tl', 'tr', 'bl', 'br'].every((k) => isColour(tf.boxes[k], VERMILION)), `${title}: expected the thumbnail's corners vermilion, saw ${rgb(tf.boxes.tl)} ${rgb(tf.boxes.br)}`);
      }
      versions.push({ value, size: done.size, sha: media.sha, thumb: th.sha });
      assert(!t.errs.length, `${title}: page errors: ${t.errs.join('; ')}`);
      await t.ctx.close();
    }
    const [screen, camera] = await Promise.all(['screen', 'camera'].map((k) => owner(`/api/videos/${id}/raw/${k}`)));
    assert(screen.sha === b.screen.sha && camera.sha === b.camera.sha && screen.bytes === b.screen.bytes, `expected the originals byte-identical to the first upload's, saw screen ${screen.bytes} bytes (was ${b.screen.bytes}), same ${screen.sha === b.screen.sha}; camera same ${camera.sha === b.camera.sha}`);
    assert(versions[0].sha !== versions[1].sha, 'expected the padded version to replace the split one, saw the same file');
    return `split ${versions[0].size} bytes, then padded:vermilion ${versions[1].size} bytes under /v/${id}; /media is the padded file; originals identical (${b.screen.bytes} and ${b.camera.bytes} bytes)`;
  }

  // ---------- 8. A 60 s split render: peak memory and speed ----------
  // The heap is sampled here through the DevTools protocol every 250 ms, from Start to the saved file: headless
  // Chromium's performance.memory (what the Details panel reads) reports a fixed 10,000,000 bytes whatever the page
  // holds, so the panel's figure is reported but cannot show a breach.
  let longFigures = '';
  async function long() {
    const t = await fresh(), cdp = await t.ctx.newCDPSession(t.p);
    await cdp.send('Performance.enable');
    let cdpPeak = 0, sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const m = (await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] }))).metrics.find((x) => x.name === 'JSHeapUsedSize');
        cdpPeak = Math.max(cdpPeak, m?.value || 0);
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    let secs, e, g, out;
    try {
      secs = await record(t.p, LONG, async () => { // from behind another tab, as a person recording another window would
        await t.p.evaluate(() => { window.__inBackground = true; });
        const other = await t.ctx.newPage();
        await other.goto('about:blank');
        await other.bringToFront();
        await other.waitForTimeout(LONG * 1000);
        await t.p.bringToFront();
        await t.p.evaluate(() => { window.__inBackground = false; });
        await other.close();
      });
      e = await ed(t.p);
      ({ g } = await choose(t.p, 'Split'));
      out = await exportNow(t.p);
    } finally {
      sampling = false;
      await sampler;
    }
    const heapMB = Math.round(cdpPeak / 1048576);
    const speed = Number(/rendered at ([\d.]+) s of video per second/.exec(out.layout)?.[1]), panel = Number(/^(\d+) MB JavaScript heap at most/.exec(out.peak)?.[1]);
    assert(near(e.duration, secs, 1.5) && near(out.duration, e.duration, 0.5), `expected a ${secs.toFixed(1)} s recording and export, saw ${e.duration} s and ${out.duration} s`);
    assert(heapMB > 0 && heapMB <= PEAK_MB, `expected the peak JavaScript heap at most ${PEAK_MB} MB, saw ${heapMB} MB (sampled through the DevTools protocol)`);
    assert(panel > 0 && panel <= PEAK_MB && /recording and rendering/.test(out.peak), `expected the Details panel's peak under ${PEAK_MB} MB, saw "${out.peak}"`);
    assert(speed > 0, `expected a render speed in the Details, saw "${out.layout}"`);
    const f = (await look(t.p, { src: 'exported', times: [e.duration - 2], ref: g, boxes: splitBoxes(g.W, g.H, g.screen.w) })).frames[0];
    isSplit('60 s split, near the end', f);
    longFigures = `peak ${heapMB} MB JavaScript heap (Details panel ${panel} MB), ${speed} s of video per second`;
    return `${secs.toFixed(1)} s recorded behind another tab, rendered as Split ${out.w}x${out.h} at ${speed} s of video per second (${out.secs.toFixed(1)} s to the saved file); `
      + `peak ${heapMB} MB JavaScript heap from Start to the saved file (bound ${PEAK_MB} MB; the Details panel says ${panel} MB)`;
  }

  // 7 runs before 6 so both use one recording with originals (6 deletes it). Each line names its scenario.
  const scenarios = [
    ['1 padded 2560x1440', padded2560], ['2 split, portrait camera', splitPortrait], ['3 camera only, camera lost', cameraLost],
    ['4 again, download breaks', brokenDownload], ['5 again, password refused', refused], ['7 again twice', twice],
    ['6 delete during again', deleteDuring], ['8 split 60 s', long],
  ];
  const results = [];
  for (const [name, fn] of scenarios.filter(([n]) => !only || only.includes(n.split(' ')[0]))) {
    try {
      ok(`${name}: ${await fn()}`);
      results.push({ name, pass: true });
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err.message}`);
      results.push({ name, pass: false });
    } finally {
      while (contexts.length) await contexts.pop().close().catch(() => {});
    }
  }
  if (basis) await api(base, `/api/videos/${basis.id}`, { method: 'DELETE' }).catch(() => {});
  results.sort((a, b) => a.name.localeCompare(b.name));
  const summary = `layouts scenarios: ${results.map((r) => `${r.name} ${r.pass ? 'pass' : 'FAIL'}`).join(', ')}; 60 s split: ${longFigures || 'no figures'}`;
  if (results.every((r) => r.pass)) ok(summary); else console.log(`  FAIL  ${summary}`);
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert(!failed.length, `layouts scenarios failed: ${failed.join(', ')} (each FAIL line above says why)`);
}
