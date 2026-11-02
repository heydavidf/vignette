// Independent scenario test for the phone version (docs/LOOP4_MOBILE_EXPORT_SPEC.md), written from the spec and
// the page, not from the builder's steps (AGENTS.md rule 5): a 4:3 share with a Square region, a Half region at
// each corner, a share smaller than the phone band, a 60 s Bubble plus phone render's speed and memory, the
// phone upload cut off then retried (a first upload and a version rendered again), delete while the phone file
// uploads (both again), the share page on a portrait tablet and on a phone, and the Phone / Full switch while the
// video plays. Each scenario gets its own browser context and runs even when one before it fails; each prints
// "ok" or "FAIL" with its figures, and the summary names every result. Pictures are found by geometry (corner
// squares with sharp inner edges, the black rule, a picture filled to its edges), never by the fake devices'
// colours. What runs in the page (init scripts, decoding and measuring) is in mobile-scenario-page.mjs.
import { createHash } from 'node:crypto';
import { r2Keys } from './layouts-scenario-page.mjs';
import { FOUR_THREE, fourThreeShare, smallShare, frames, bandMap, cornerBoxes, cornerShown, edge, below } from './mobile-scenario-page.mjs';

export const MOBILE_SCENARIO = '3q. Phone version, independent scenarios (a 4:3 share with a square region, a half region at each corner, a 640x360 share '
  + 'scaled up, a 60 s bubble plus phone render, the phone upload cut off then retried, delete while the phone file uploads, the share page on a '
  + 'portrait tablet and a phone, the switch while playing)';
const MB = '/vendor/mediabunny-1.61.6.min.mjs';
const PW = 1080, PH = 1920, BAND = { wide: 608, square: 1080 };
const LONG = 60;      // seconds for the memory scenario
const PEAK_MB = 400;  // the bound loop 1 set for a 60 s recording
const CORNERS = ['tl', 'tr', 'bl', 'br'];
const TIMES = [0.4, 1, 1.6, 2.2, 2.8]; // where a 4 s clip is sampled for corner squares (they ramp, and briefly match the background)

// dir: wrangler dev's --persist-to folder, to look into R2 (optional). only: scenario numbers to run (all when left out).
export async function mobileScenario(page, { record, assert, ok, base, api, login, pageHooks, watch, dir, only }) {
  const browser = page.context().browser();
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const contexts = [];
  async function fresh({ cam = true, init = null, signIn = true, ctxOpts = {} } = {}) {
    const ctx = await browser.newContext(ctxOpts);
    contexts.push(ctx);
    await ctx.addInitScript(pageHooks);
    if (init) await ctx.addInitScript(init);
    const p = watch(await ctx.newPage(), 'mobile scenario');
    const t = { ctx, p, errs: [] };
    p.on('pageerror', (e) => t.errs.push(e.message));
    if (!signIn) return t;
    await login(p, base);
    await p.waitForSelector('#app:not([hidden])');
    if (cam) await p.check('#cam'); else await p.uncheck('#cam');
    return t;
  }
  const hooks = (p) => p.evaluate(() => {
    const ph = window.__vignette.phone, v = window.__vignette.editor.video;
    return { on: ph.on, offered: ph.offered, region: ph.region, box: ph.box, exported: ph.exported, poster: ph.poster, sw: v?.width, sh: v?.height, duration: v?.duration };
  });
  async function phoneOn(p) { // the toggle, clicked as a person would
    await p.click('label.toggle:has(#phoneOn)');
    await p.waitForFunction(() => window.__vignette.phone.on, null, { timeout: 10_000 });
  }
  const pick = (p, title) => p.click(`#regionSet label[title="${title}"]`);
  async function toCorner(p, c) { // Shift + arrow keys on the box until it stops at the edges
    await p.focus('#regionBox');
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press(`Shift+${c[1] === 'l' ? 'ArrowLeft' : 'ArrowRight'}`);
      await p.keyboard.press(`Shift+${c[0] === 't' ? 'ArrowUp' : 'ArrowDown'}`);
    }
    return (await hooks(p)).box;
  }
  async function download(p, button) { // Download MP4 or Download phone MP4; resolves once the file is saved
    const t0 = Date.now();
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 300_000 }), p.click(button)]);
    await dl.path();
    await p.waitForFunction((b) => !document.querySelector(b).disabled, button, { polling: 100 });
    return (Date.now() - t0) / 1000;
  }
  const look = (p, o) => p.evaluate(frames, { mb: MB, ...o });
  const row = async (id) => { const r = await api(base, `/api/videos/${id}`); return { http: r.status, ...(await r.json().catch(() => ({}))) }; };
  const got = async (r) => { const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, bytes: b.length, sha: createHash('sha256').update(b).digest('hex'), text: b.toString('utf8') }; };
  const pub = (path) => fetch(`${base}${path}`).then(got);
  const owner = (path) => api(base, path).then(got);
  const blobSha = (p, key) => p.evaluate(async (key) => {
    const b = window.__vignette.editor[key].blob;
    return { size: b.size, sha: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('') };
  }, key);
  const msgs = (p) => p.evaluate(() => {
    const m = document.getElementById('phoneMsg');
    return { phone: m.textContent, shown: !m.closest('.msg').hidden, retry: !document.getElementById('retryPhone').hidden, raw: document.getElementById('rawMsg').textContent };
  });
  const waitPhone = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.getElementById('phoneMsg').textContent), re.source, { timeout: 180_000 });
  const waitRaw = (p) => p.waitForFunction(() => /^Originals (not )?kept/.test(document.getElementById('rawMsg').textContent), null, { timeout: 180_000 });
  async function uploadNow(p, title) {
    await p.fill('#title', title);
    await p.click('#upload');
    await p.waitForSelector('#shareBox:not([hidden])', { timeout: 300_000 });
    return (await p.inputValue('#shareUrl')).split('/v/')[1];
  }
  async function openAgain(t, id) { // resolves once the again mode is ready or has failed
    await t.p.goto(`${base}/?again=${id}`);
    await t.p.waitForFunction(() => ['ready', 'failed'].includes(window.__vignette?.again.state), null, { timeout: 90_000 });
    return t.p.evaluate(() => ({ ...window.__vignette.again }));
  }
  // Requests other than GET, as "METHOD /path?query", from the moment it is called.
  function logWrites(p) {
    const seen = [];
    p.on('request', (q) => { if (q.method() !== 'GET') { const u = new URL(q.url()); seen.push(`${q.method()} ${u.pathname}${u.search}`); } });
    return seen;
  }
  const isPhoneBytes = (url) => /^\/api\/videos\/[a-z0-9]{16}\/(blob|parts\/\d+)$/.test(url.pathname) && url.searchParams.get('track') === 'mobile';

  // Which corner squares of the screen show in the phone file's top band, sampled at TIMES. side: the screen's
  // corner square in its own pixels. Expected: the screen corners the band's crop reaches.
  async function bandCorners(p, { box, sw, sh, side, variant, times = TIMES, extra = {} }) {
    const bandH = BAND[variant], m = bandMap(box, sw, sh, PW, bandH), k = side * m.scale;
    const cw = PW / m.scale, ch = bandH / m.scale;
    const want = {
      tl: m.sx < 1 && m.sy < 1, tr: m.sx + cw > sw - 1 && m.sy < 1,
      bl: m.sx < 1 && m.sy + ch > sh - 1, br: m.sx + cw > sw - 1 && m.sy + ch > sh - 1,
    };
    const r = await look(p, { src: 'mobile', times, boxes: [...cornerBoxes(PW, bandH, k), ...(extra.boxes || [])], rows: extra.rows || [], cols: extra.cols || [] });
    for (const f of r.frames) assert(f.w === PW && f.h === PH, `expected the phone file's frames ${PW}x${PH}, saw ${f.w}x${f.h} at ${f.t} s`);
    const counts = Object.fromEntries(CORNERS.map((c) => [c, r.frames.filter((f) => cornerShown(f, c).shown).length]));
    const n = r.frames.length, fig = CORNERS.map((c) => `${c} ${counts[c]}/${n}`).join(', ');
    const missing = CORNERS.filter((c) => want[c] && counts[c] < 2), extraShown = CORNERS.filter((c) => !want[c] && counts[c] > 0);
    const why = (c) => r.frames.map((f) => { const s = cornerShown(f, c); return `${s.inside.toFixed(0)}/${s.u.toFixed(0)}/${s.v.toFixed(0)} spread ${s.spread.toFixed(0)}`; }).join('; ');
    assert(!missing.length && !extraShown.length, `expected the band to show the square at ${CORNERS.filter((c) => want[c]).join(' and ') || 'no corner'} only (at least 2 of ${n} samples, the others in none), `
      + `saw ${fig}${[...missing, ...extraShown].map((c) => ` [${c} inside/past-side/past-top: ${why(c)}]`).join('')}`);
    return { k, scale: m.scale, want, counts, fig, r };
  }
  function cameraBelow(name, f) {
    const b = f.boxes, fig = Object.fromEntries(Object.entries(b).filter(([k]) => !/In$|U$|V$/.test(k)).map(([k, v]) => [k, +v.y.toFixed(0)]));
    assert(b.rule.y < 40, `${name}: expected a black 2 px rule under the band, saw luma ${JSON.stringify(fig)} at ${f.t} s`);
    assert(['bandBottom', 'bandLeft', 'bandRight', 'camTop', 'camBottom', 'camL', 'camR'].every((k) => b[k].y > 40),
      `${name}: expected the band filled to its edges and the camera filling the rest edge to edge (luma over 40), saw ${JSON.stringify(fig)} at ${f.t} s`);
    return fig;
  }

  // ---------- 1. A 4:3 share (1440x1080) with a Square region ----------
  async function fourThree() {
    const t = await fresh({ init: fourThreeShare }), F = FOUR_THREE;
    await record(t.p, 4);
    let h = await hooks(t.p);
    assert(h.sw === F.w && h.sh === F.h, `expected a ${F.w}x${F.h} screen recording, saw ${h.sw}x${h.sh}`);
    await phoneOn(t.p);
    await pick(t.p, 'Square');
    await pick(t.p, 'Two thirds');
    const box = await toCorner(t.p, 'tl');
    assert(near(box.x, 0, 1e-6) && near(box.y, 0, 1e-6) && near(box.w * F.w, 960, 0.5) && near(box.h * F.h, 960, 0.5),
      `expected a 960x960 square box at the top left of the 1440x1080 screen, saw ${JSON.stringify(box)}`);
    await download(t.p, '#downloadPhone');
    h = await hooks(t.p);
    assert(h.exported?.width === PW && h.exported?.height === PH, `expected a ${PW}x${PH} phone file, saw ${JSON.stringify(h.exported)}`);
    const k = F.side * (PW / 960); // 101.25: the square scaled 1.125
    const a = await bandCorners(t.p, {
      box, sw: F.w, sh: F.h, side: F.side, variant: 'square', times: [0.5, 1.5, 2.5],
      extra: { boxes: below(BAND.square), rows: [{ name: 'across', y: Math.round(k / 2), x0: Math.round(k) - 30, x1: Math.round(k) + 30 }], cols: [{ name: 'down', x: Math.round(k / 2), y0: Math.round(k) - 30, y1: Math.round(k) + 30 }] },
    });
    let rule;
    for (const f of a.r.frames) {
      rule = cameraBelow('square two thirds', f);
      const ex = edge(f.rows.across), ey = edge(f.cols.down), x = Math.round(k) - 30 + ex.mid, y = Math.round(k) - 30 + ey.mid;
      assert(ex.height > 60 && ey.height > 60 && near(x, k, 3) && near(y, k, 3),
        `expected the top left square's inner edges at ${k.toFixed(1)} px across and down (a square region, scaled 1.125 into the 1080x1080 band), saw ${x.toFixed(1)} across and ${y.toFixed(1)} down (steps ${ex.height.toFixed(0)}, ${ey.height.toFixed(0)}) at ${f.t} s`);
    }
    // Whole: as tall as the screen, so 1080x1080 at scale 1; pushed right it holds the two right-hand squares.
    await pick(t.p, 'Whole');
    const whole = await toCorner(t.p, 'tr');
    assert(near(whole.x * F.w, 360, 0.5) && near(whole.y, 0, 1e-6) && near(whole.w * F.w, 1080, 0.5) && near(whole.h, 1, 1e-6),
      `expected Whole to be the screen's height, 1080x1080 at x 360, saw ${JSON.stringify(whole)}`);
    await download(t.p, '#downloadPhone');
    const b = await bandCorners(t.p, { box: whole, sw: F.w, sh: F.h, side: F.side, variant: 'square', times: [0.5, 1.5, 2.5], extra: { boxes: below(BAND.square) } });
    b.r.frames.forEach((f) => cameraBelow('square whole', f));
    assert(!t.errs.length, `page errors: ${t.errs.join('; ')}`);
    return `1440x1080 share; Square two thirds at the top left: ${PW}x${PH}, 1080x1080 band shows ${a.fig}, square's inner edges at ${k.toFixed(1)} px within 3; `
      + `rule luma ${rule.rule}, camera below edge to edge (${rule.camL}, ${rule.camR}, ${rule.camBottom}); Square whole pushed right: x 360, 1080x1080, band shows ${b.fig}`;
  }

  // ---------- 2. A Half region at each corner, Wide ----------
  async function eachCorner() {
    const t = await fresh();
    await record(t.p, 4);
    const h = await hooks(t.p), side = h.sw / 16, seen = [];
    await phoneOn(t.p);
    await pick(t.p, 'Half');
    for (const c of CORNERS) {
      const box = await toCorner(t.p, c);
      const want = { x: c[1] === 'l' ? 0 : 0.5, y: c[0] === 't' ? 0 : 0.5 };
      assert(near(box.x, want.x, 1e-6) && near(box.y, want.y, 1e-6) && near(box.w, 0.5, 1e-6) && near(box.h, 0.5, 1e-6),
        `${c}: expected a half box at ${JSON.stringify(want)} of the ${h.sw}x${h.sh} screen, saw ${JSON.stringify(box)}`);
      await download(t.p, '#downloadPhone');
      const r = await bandCorners(t.p, { box, sw: h.sw, sh: h.sh, side, variant: 'wide', extra: { boxes: below(BAND.wide) } });
      assert(r.want[c] && CORNERS.filter((x) => r.want[x]).length === 1, `${c}: expected the band to reach only that corner of the screen, saw ${JSON.stringify(r.want)}`);
      r.r.frames.forEach((f) => cameraBelow(`half at ${c}`, f));
      seen.push(`${c}: ${r.fig}`);
    }
    assert(!t.errs.length, `page errors: ${t.errs.join('; ')}`);
    return `${h.sw}x${h.sh} screen, Half Wide (960x540 into 1080x608, squares ${side} px to ${(side * 1.125).toFixed(0)}): ${seen.join('; ')}`;
  }

  // ---------- 3. A share smaller than the phone band ----------
  async function small() {
    const t = await fresh({ init: smallShare });
    await record(t.p, 4);
    const h = await hooks(t.p), capture = await t.p.evaluate(() => window.__vignette.details['capture size']);
    assert(h.sw < PW && h.sh < BAND.wide, `expected a screen smaller than the 1080x608 band (asked 640x360; capture "${capture}"), saw ${h.sw}x${h.sh}`);
    await phoneOn(t.p);
    await pick(t.p, 'Half');
    const box = await toCorner(t.p, 'tr');
    await download(t.p, '#downloadPhone');
    const side = h.sw / 16, m = bandMap(box, h.sw, h.sh, PW, BAND.wide), k = side * m.scale;
    const ex0 = Math.round(PW - k) - 30, ey0 = Math.round(k) - 30;
    const r = await bandCorners(t.p, {
      box, sw: h.sw, sh: h.sh, side, variant: 'wide',
      extra: { boxes: below(BAND.wide), rows: [{ name: 'across', y: Math.round(k / 2), x0: ex0, x1: ex0 + 60 }], cols: [{ name: 'down', x: Math.round(PW - k / 2), y0: ey0, y1: ey0 + 60 }] },
    });
    r.r.frames.forEach((f) => cameraBelow('small share', f));
    const best = (key, pick0) => r.r.frames.map((f) => ({ t: f.t, ...edge(f[pick0][key]) })).sort((a, b) => b.height - a.height)[0];
    const ax = best('across', 'rows'), dy = best('down', 'cols');
    const x = ex0 + ax.mid, y = ey0 + dy.mid;
    assert(ax.height > 30 && dy.height > 30, `expected a clear step at the top right square's inner edges, saw steps of ${ax.height.toFixed(0)} across and ${dy.height.toFixed(0)} down`);
    assert(near(x, PW - k, 4) && near(y, k, 4), `expected the square's inner edges at x ${(PW - k).toFixed(1)} and y ${k.toFixed(1)} (scaled ${m.scale.toFixed(3)}), saw x ${x.toFixed(1)} and y ${y.toFixed(1)}`);
    assert(ax.width <= 6 && dy.width <= 6, `expected sharp edges (10% to 90% of the step within 6 px, ${(6 / m.scale).toFixed(1)} screen pixels), saw ${ax.width.toFixed(1)} px across and ${dy.width.toFixed(1)} px down`);
    assert(!t.errs.length, `page errors: ${t.errs.join('; ')}`);
    return `asked 640x360, capture "${capture}", recorded ${h.sw}x${h.sh}; Half at the top right scaled ${m.scale.toFixed(3)} into ${PW}x${PH}; band shows ${r.fig}; `
      + `edges at x ${x.toFixed(1)} (want ${(PW - k).toFixed(1)}) and y ${y.toFixed(1)} (want ${k.toFixed(1)}), 10-90% in ${ax.width.toFixed(1)} and ${dy.width.toFixed(1)} px for steps of ${ax.height.toFixed(0)} and ${dy.height.toFixed(0)}`;
  }

  // ---------- 4. A 60 s recording, Bubble plus the phone version: speed and peak memory ----------
  // The heap is sampled through the DevTools protocol every 250 ms, from Start to the saved file: headless
  // Chromium's performance.memory (what the Details panel reads) reports a fixed 10 MB whatever the page holds.
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
    let secs, h, d, wall;
    try {
      secs = await record(t.p, LONG);
      await phoneOn(t.p);
      wall = await download(t.p, '#download'); // Download MP4 renders the video, then the phone version
      h = await hooks(t.p);
      d = await t.p.evaluate(() => ({ layout: window.__vignette.details.layout || '', phone: window.__vignette.details['phone version'] || '', duration: window.__vignette.editor.exported.duration }));
    } finally {
      sampling = false;
      await sampler;
    }
    const heapMB = Math.round(cdpPeak / 1048576);
    const speed = Number(/^Bubble, .*rendered at ([\d.]+) s of video per second/.exec(d.layout)?.[1]);
    const phoneSpeed = Number(/^1080x1920, .*rendered at ([\d.]+) s of video per second/.exec(d.phone)?.[1]);
    const pd = (await look(t.p, { src: 'mobile', times: [d.duration - 1] })).duration;
    assert(near(h.duration, secs, 1.5) && near(d.duration, h.duration, 0.5) && near(pd, d.duration, 0.5), `expected a ${secs.toFixed(1)} s recording, video and phone file, saw ${h.duration}, ${d.duration} and ${pd} s`);
    assert(h.exported?.width === PW && h.exported?.height === PH, `expected a ${PW}x${PH} phone file, saw ${JSON.stringify(h.exported)}`);
    assert(speed > 0 && phoneSpeed > 0, `expected both render speeds in the Details panel, saw layout "${d.layout}" and phone version "${d.phone}"`);
    assert(heapMB > 0 && heapMB <= PEAK_MB, `expected the peak JavaScript heap at most ${PEAK_MB} MB, saw ${heapMB} MB (sampled through the DevTools protocol)`);
    assert(!t.errs.length, `page errors: ${t.errs.join('; ')}`);
    longFigures = `Bubble ${speed} and phone ${phoneSpeed} s of video per second, peak ${heapMB} MB JavaScript heap`;
    return `${secs.toFixed(1)} s recorded; Bubble rendered at ${speed} s of video per second ("${d.layout}"), the phone version at ${phoneSpeed} ("${d.phone}"); `
      + `${wall.toFixed(1)} s from Download MP4 to the saved file; peak ${heapMB} MB JavaScript heap from Start to the saved file (bound ${PEAK_MB} MB)`;
  }

  // ---------- A recording with a phone version and originals, for the share page and the again scenarios ----------
  async function linked(secs, title) {
    const t = await fresh();
    await record(t.p, secs);
    await phoneOn(t.p);
    const id = await uploadNow(t.p, title);
    await waitPhone(t.p, /^Phone version kept/);
    await waitRaw(t.p);
    const r = await row(id);
    assert(r.status === 'ready' && r.has_raw === 1 && r.mobile?.ready, `expected a ready recording with originals and a phone version, saw ${JSON.stringify(r)}`);
    await t.ctx.close();
    return id;
  }
  let shared = null, again = null; // ids: one for the share page, one for the again scenarios (5 makes it, 6 deletes it)

  // ---------- 5. The phone upload cut off, then Retry: a first upload, then a version rendered again ----------
  async function cutOff() {
    const seen = [];
    // a. A first upload: the phone file's bytes are cut off on every attempt until Retry.
    const t = await fresh();
    await record(t.p, 4);
    await phoneOn(t.p);
    let cut = true, cuts = 0;
    await t.p.route((url) => isPhoneBytes(url), (route) => (cut ? (cuts++, route.abort('connectionreset')) : route.continue()));
    const id = await uploadNow(t.p, 'Mobile scenario: cut off');
    const early = { share: await pub(`/v/${id}`), media: await pub(`/media/${id}`) };
    await waitPhone(t.p, /^Phone version not kept/);
    const m1 = await msgs(t.p), mid = { share: await pub(`/v/${id}`), media: await pub(`/media/${id}`), phone: await pub(`/media/${id}/mobile`), r: await row(id) };
    const vid = await blobSha(t.p, 'exported');
    assert(early.share.status === 200 && early.media.status === 200 && mid.share.status === 200 && mid.media.sha === vid.sha,
      `expected the link to work while the phone file failed, saw share ${early.share.status} then ${mid.share.status}, media ${early.media.status} then ${mid.media.status} (the video's own bytes ${mid.media.sha === vid.sha})`);
    assert(m1.shown && m1.retry && /The link works without it/.test(m1.phone) && mid.phone.status === 404 && mid.r.mobile && !mid.r.mobile.ready && !mid.share.text.includes('data-phone-src'),
      `expected "Phone version not kept" with Retry, the phone file 404 and the share page without it, saw ${JSON.stringify({ msg: m1, phone: mid.phone.status, mobile: mid.r.mobile, switch: mid.share.text.includes('data-phone-src') })}`);
    await waitRaw(t.p);
    cut = false;
    const writes = logWrites(t.p);
    await t.p.click('#retryPhone');
    await waitPhone(t.p, /^Phone version kept/);
    const ph = await blobSha(t.p, 'mobile'), r = await row(id), file = await pub(`/media/${id}/mobile`), poster = await pub(`/thumb/${id}/mobile`), share = await pub(`/v/${id}`);
    const bytesReq = writes.filter((w) => /\/(blob|parts\/\d+)\?track=mobile$/.test(w));
    assert(writes.every((w) => w.endsWith('?track=mobile')) && bytesReq.length >= 1 && writes.filter((w) => w === `POST /api/videos/${id}/complete?track=mobile`).length === 1
      && writes.filter((w) => w === `PUT /api/videos/${id}/thumb?track=mobile`).length === 1 && writes.length === bytesReq.length + 2,
    `expected Retry to send only the phone file's bytes, its completion and its poster, saw ${writes.join(', ') || 'nothing'}`);
    assert(r.mobile?.ready && r.mobile.size === ph.size && file.sha === ph.sha && poster.status === 200 && share.text.includes(`/media/${id}/mobile?v=`),
      `expected mobile ready with the phone file's ${ph.size} bytes served and its poster, saw ${JSON.stringify({ mobile: r.mobile, file: file.bytes, same: file.sha === ph.sha, poster: poster.status })}`);
    seen.push(`a. first upload: ${cuts} attempts cut off, "${m1.phone.slice(0, 60)}...", link 200 throughout; Retry sent ${writes.join(', ')}; mobile ready, ${ph.size} bytes`);
    await t.ctx.close();
    again = id;
    // b. Rendered again: the phone file's first part cut off until Retry.
    const u = await fresh(), before = await row(id);
    const a = await openAgain(u, id), pre = await hooks(u.p);
    assert(a.state === 'ready' && pre.on && ['x', 'y', 'w', 'h'].every((key) => near(pre.box[key], before.mobile.region[key], 1e-3)) && pre.region.shape === before.mobile.variant,
      `again: expected the phone version on with its stored box ${JSON.stringify(before.mobile.region)} (${before.mobile.variant}), saw ${JSON.stringify({ state: a.state, on: pre.on, box: pre.box, region: pre.region })}`);
    let cut2 = true, cuts2 = 0;
    await u.p.route((url) => isPhoneBytes(url), (route) => (cut2 ? (cuts2++, route.abort('connectionreset')) : route.continue()));
    await uploadNow(u.p, before.title);
    await waitPhone(u.p, /^Phone version not kept/);
    const v2 = await blobSha(u.p, 'exported'), r2 = await row(id), media2 = await pub(`/media/${id}`), phone2 = await pub(`/media/${id}/mobile`), share2 = await pub(`/v/${id}`);
    assert(r2.status === 'ready' && r2.size === v2.size && media2.sha === v2.sha && r2.mobile && !r2.mobile.ready && phone2.status === 404 && !share2.text.includes('data-phone-src'),
      `again: expected the new video live, its phone record not ready, the phone file 404 and the share page without it, saw ${JSON.stringify({ status: r2.status, size: r2.size, want: v2.size, media: media2.sha === v2.sha, mobile: r2.mobile, phone: phone2.status })}`);
    cut2 = false;
    const writes2 = logWrites(u.p);
    await u.p.click('#retryPhone');
    await waitPhone(u.p, /^Phone version kept/);
    const ph2 = await blobSha(u.p, 'mobile'), r3 = await row(id), file2 = await pub(`/media/${id}/mobile`);
    const want2 = [`PUT /api/videos/${id}/parts/1?track=mobile`, `POST /api/videos/${id}/complete?track=mobile`, `PUT /api/videos/${id}/thumb?track=mobile`];
    assert(JSON.stringify(writes2) === JSON.stringify(want2), `again: expected Retry to send ${want2.join(', ')}, saw ${writes2.join(', ') || 'nothing'}`);
    assert(r3.mobile?.ready && file2.sha === ph2.sha, `again: expected the new phone file served once kept, saw ${JSON.stringify({ mobile: r3.mobile, same: file2.sha === ph2.sha })}`);
    seen.push(`b. again: ${cuts2} attempts at part 1 cut off; new video live (${v2.size} bytes), phone 404 meanwhile; Retry sent ${writes2.join(', ')}`);
    // c. Rendered again once more, part 1 cut off once only: the upload's own retry sends it again, no Retry needed.
    const w = await fresh();
    assert((await openAgain(w, id)).state === 'ready', 'once: expected the originals loaded');
    let cuts3 = 0;
    await w.p.route((url) => isPhoneBytes(url), (route) => (cuts3++ ? route.continue() : route.abort('connectionreset')));
    const writes3 = logWrites(w.p);
    await uploadNow(w.p, before.title);
    await waitPhone(w.p, /^Phone version (not )?kept/);
    const m3 = await msgs(w.p), ph3 = await blobSha(w.p, 'mobile'), file3 = await pub(`/media/${id}/mobile`);
    const parts3 = writes3.filter((x) => x === `PUT /api/videos/${id}/parts/1?track=mobile`).length;
    assert(/^Phone version kept/.test(m3.phone) && !m3.retry && parts3 === 2 && file3.sha === ph3.sha,
      `once: expected the part sent again by itself and the phone version kept without Retry, saw "${m3.phone}", Retry shown ${m3.retry}, part 1 sent ${parts3} times, file served ${file3.sha === ph3.sha}`);
    assert(!t.errs.length && !u.errs.length && !w.errs.length, `page errors: ${[...t.errs, ...u.errs, ...w.errs].join('; ')}`);
    seen.push(`c. again, part 1 cut off once: sent ${parts3} times, "${m3.phone}" without Retry`);
    return seen.join('; ');
  }

  // ---------- 6. Delete while the phone file uploads: a first upload, then a version rendered again ----------
  async function hold(p) { // holds the phone file's first bytes request until released
    let hit, release;
    const reached = new Promise((r) => { hit = r; }), go = new Promise((r) => { release = r; });
    await p.route((url) => isPhoneBytes(url), async (route) => { hit(new URL(route.request().url()).pathname); await go; await route.continue(); });
    return { reached: Promise.race([reached, new Promise((_, no) => setTimeout(() => no(new Error('the phone upload never started')), 300_000))]), release };
  }
  async function goneAfter(p, id) {
    const gone = {
      row: (await row(id)).http, listed: (await (await api(base, '/api/videos')).json()).videos.some((v) => v.id === id), share: (await pub(`/v/${id}`)).status,
      media: (await pub(`/media/${id}`)).status, mediaPhone: (await pub(`/media/${id}/mobile`)).status, thumb: (await pub(`/thumb/${id}`)).status,
      thumbPhone: (await pub(`/thumb/${id}/mobile`)).status, screen: (await owner(`/api/videos/${id}/raw/screen`)).status, camera: (await owner(`/api/videos/${id}/raw/camera`)).status,
    };
    assert(!gone.listed && Object.entries(gone).every(([k, v]) => k === 'listed' || v === 404), `expected the row, share page, both media routes, both thumbs and the originals 404 after the delete, saw ${JSON.stringify(gone)}`);
    const store = dir ? await r2Keys(dir, id) : null, open = store ? store.uploads.filter((u) => u.state === 0).length : 0;
    assert(!store || (!store.objects.length && !open), `expected 0 objects and 0 open uploads in R2, saw ${JSON.stringify(store)}`);
    return store ? `R2 ${store.objects.length} objects, ${open} open uploads` : 'R2 not inspected (no folder given)';
  }
  async function deleteDuring() {
    const seen = [];
    // a. A first upload: held at the phone file's bytes, after the link works.
    const t = await fresh();
    await record(t.p, 4);
    await phoneOn(t.p);
    const h1 = await hold(t.p);
    await t.p.fill('#title', 'Mobile scenario: delete during');
    await t.p.click('#upload');
    const path1 = await h1.reached, id = path1.split('/')[3];
    const during = await row(id), store1 = dir ? await r2Keys(dir, id) : null;
    assert(during.status === 'ready' && during.mobile && !during.mobile.ready, `a: expected the link made and the phone file pending while held, saw ${JSON.stringify({ status: during.status, mobile: during.mobile })}`);
    const del = await api(base, `/api/videos/${id}`, { method: 'DELETE' });
    h1.release();
    await waitPhone(t.p, /^Phone version not kept/);
    await waitRaw(t.p);
    const m = await msgs(t.p);
    assert(del.status === 200 && /Video not found/.test(m.phone), `a: expected the delete to succeed and the phone message to say why, saw ${del.status}, "${m.phone}"`);
    seen.push(`a. first upload held at ${path1.split('/').slice(4).join('/')}: R2 had ${store1 ? store1.objects.length : '?'} objects; deleted; "${m.phone.slice(0, 70)}..."; ${await goneAfter(t.p, id)}`);
    // b. Rendered again, held at the phone file's first part (a multipart upload open in R2).
    const rid = again && (await row(again)).mobile?.ready ? again : (again = await linked(4, 'Mobile scenario: again base'));
    const u = await fresh(), a = await openAgain(u, rid);
    assert(a.state === 'ready', `b: expected the originals loaded, saw ${JSON.stringify(a)}`);
    const h2 = await hold(u.p);
    await u.p.click('#upload');
    const path2 = await h2.reached, store2 = dir ? await r2Keys(dir, rid) : null;
    assert(/\/parts\/1$/.test(path2), `b: expected the phone file to go up in parts, saw ${path2}`);
    assert(!store2 || (store2.objects.length === 6 && store2.uploads.some((x) => x.state === 0 && x.key === `videos/${rid}-mobile.mp4`)),
      `b: expected six objects and an open phone upload in R2 while held, saw ${JSON.stringify(store2)}`);
    const del2 = await api(base, `/api/videos/${rid}`, { method: 'DELETE' });
    h2.release();
    await waitPhone(u.p, /^Phone version not kept/);
    assert(del2.status === 200, `b: expected the delete to succeed, saw ${del2.status}`);
    seen.push(`b. again held at parts/1?track=mobile: R2 had ${store2 ? `${store2.objects.length} objects and ${store2.uploads.filter((x) => x.state === 0).length} open upload` : '?'}; deleted; ${await goneAfter(u.p, rid)}`);
    again = null;
    assert(!t.errs.length && !u.errs.length, `page errors: ${[...t.errs, ...u.errs].join('; ')}`);
    return seen.join('; ');
  }

  // ---------- 7 and 8. The share page ----------
  async function viewer(ctxOpts, id) {
    const ctx = await browser.newContext(ctxOpts);
    contexts.push(ctx);
    const p = watch(await ctx.newPage(), 'mobile scenario share page'), errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${base}/v/${id}`);
    await p.waitForFunction(() => document.getElementById('player')?.currentSrc, null, { timeout: 15_000 });
    return { p, errs };
  }
  const state = (p) => p.evaluate(() => {
    const v = document.getElementById('player'), u = new URL(v.currentSrc);
    return {
      src: u.pathname + u.search, view: v.dataset.view, t: v.currentTime, paused: v.paused, vw: v.videoWidth, vh: v.videoHeight,
      switch: !document.getElementById('views').hidden, pressed: [...document.querySelectorAll('[data-view-to]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.viewTo),
      downloads: [...document.querySelectorAll('a[download]')].map((a) => `${a.textContent.trim()} ${new URL(a.href).pathname}`),
    };
  });
  async function plays(p) {
    await p.evaluate(() => document.getElementById('player').play());
    await p.waitForFunction(() => document.getElementById('player').currentTime > 0.6, null, { timeout: 20_000 });
    return state(p);
  }
  async function shareViews() {
    shared ||= await linked(7, 'Mobile scenario: share page');
    const id = shared, out = [];
    for (const [name, opts, want] of [
      ['tablet 1024x1366 portrait', { viewport: { width: 1024, height: 1366 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'full'],
      ['phone 390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, 'phone'],
    ]) {
      const v = await viewer(opts, id), s = await plays(v.p);
      const phone = want === 'phone', src = phone ? `/media/${id}/mobile?` : `/media/${id}?`;
      assert(s.view === want && s.src.startsWith(src) && (phone ? s.vw === PW && s.vh === PH : s.vw > s.vh) && !s.paused,
        `${name}: expected the ${phone ? 'phone' : 'landscape'} file playing (${src}...), saw ${JSON.stringify(s)}`);
      assert(s.switch && s.pressed.join() === want && s.downloads.length === 2 && s.downloads.some((d) => d.endsWith(`/media/${id}/mobile`)),
        `${name}: expected the Phone / Full switch offered with ${want} pressed and both downloads, saw ${JSON.stringify(s)}`);
      assert(!v.errs.length, `${name}: page errors: ${v.errs.join('; ')}`);
      out.push(`${name}: ${s.src.split('?')[0]} plays at ${s.vw}x${s.vh}, switch offered (${s.pressed} pressed), downloads ${s.downloads.length}`);
    }
    // Not asserted, for the report: what a smaller iPad in portrait gets (the spec's rule is width at most 900 px).
    const ipad = await viewer({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, id);
    out.push(`(an 820x1180 iPad Air in portrait gets the ${(await state(ipad.p)).view} file)`);
    return out.join('; ');
  }
  async function switchPlaying() {
    shared ||= await linked(7, 'Mobile scenario: share page');
    const id = shared, v = await viewer({ viewport: { width: 1280, height: 800 } }, id), out = [];
    await v.p.evaluate(() => { const p = document.getElementById('player'); window.__seeks = []; p.addEventListener('seeked', () => window.__seeks.push({ t: p.currentTime, src: p.currentSrc })); });
    const s0 = await plays(v.p);
    assert(s0.view === 'full', `expected the landscape file on a 1280x800 desktop, saw ${JSON.stringify(s0)}`);
    for (const [to, at] of [['phone', 1.5], ['full', 3]]) {
      await v.p.waitForFunction((at) => document.getElementById('player').currentTime >= at, at, { timeout: 20_000 });
      const t0 = await v.p.evaluate((to) => { const t = document.getElementById('player').currentTime; document.querySelector(`[data-view-to="${to}"]`).click(); return t; }, to);
      const mobile = to === 'phone';
      await v.p.waitForFunction((m) => window.__seeks.some((s) => s.src.includes('/mobile') === m), mobile, { timeout: 20_000 });
      const sk = await v.p.evaluate((m) => window.__seeks.filter((s) => s.src.includes('/mobile') === m).at(-1), mobile);
      // The other file has to buffer before it moves on; wait for it to pass the resume point rather than a fixed second.
      await v.p.waitForFunction((t) => { const p = document.getElementById('player'); return !p.paused && p.currentTime > t + 0.5; }, sk.t, { timeout: 5000 }).catch(() => {});
      const s = await state(v.p), stored = await v.p.evaluate((id) => sessionStorage.getItem(`vignette.view.${id}`), id);
      assert(near(sk.t, t0, 0.5), `to ${to}: expected the time kept within 0.5 s of ${t0.toFixed(2)} s, saw it resume at ${sk.t.toFixed(2)} s`);
      assert(!s.paused && s.t > sk.t + 0.5 && s.view === to && (mobile ? s.vw === PW && s.vh === PH : s.vw > s.vh) && stored === to,
        `to ${to}: expected playback to go on in the ${to} file (and the choice stored), saw ${JSON.stringify(s)} within 5 s of resuming at ${sk.t.toFixed(2)} s, stored ${stored}`);
      out.push(`to ${to} at ${t0.toFixed(2)} s: resumed at ${sk.t.toFixed(2)} s (${(sk.t - t0).toFixed(2)}), playing on at ${s.t.toFixed(2)} s in ${s.vw}x${s.vh}`);
    }
    assert(!v.errs.length, `page errors: ${v.errs.join('; ')}`);
    return out.join('; ');
  }

  // Each line names its scenario.
  const scenarios = [
    ['1 4:3 share, square region', fourThree], ['2 half region at each corner', eachCorner], ['3 small share scaled up', small],
    ['7 share page on tablet and phone', shareViews], ['8 switch while playing', switchPlaying],
    ['5 phone upload cut off, retried', cutOff], ['6 delete while the phone file uploads', deleteDuring], ['4 bubble plus phone 60 s', long],
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
  for (const id of [shared, again]) if (id) await api(base, `/api/videos/${id}`, { method: 'DELETE' }).catch(() => {});
  results.sort((a, b) => a.name.localeCompare(b.name));
  const summary = `mobile scenarios: ${results.map((r) => `${r.name} ${r.pass ? 'pass' : 'FAIL'}`).join(', ')}; 60 s bubble plus phone: ${longFigures || 'no figures'}`;
  if (results.every((r) => r.pass)) ok(summary); else console.log(`  FAIL  ${summary}`);
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  assert(!failed.length, `mobile scenarios failed: ${failed.join(', ')} (each FAIL line above says why)`);
}
