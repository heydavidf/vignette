// Independent scenario test for the self-view window (docs/LOOP2_SELF_VIEW_SPEC.md), written from the spec and
// the page, not from the builder's steps (AGENTS.md rule 5): the window refused, closed during the countdown,
// Stop pressed in the window and on the page at once, a 5,000 character script, the window reopened three
// times, the screen share ending while it is open, and 60 s with it open. Each scenario gets its own browser
// context and the real Document Picture-in-Picture window (headless Chromium has it, and Playwright sees the
// window as a page whose opener is the recorder). Every scenario runs even when one fails, and each prints
// "ok" or "FAIL" with its figures. Headless Chromium opens every window at its default size, so the window is
// given the size the page asked for. On macOS the fake capture says it is the whole screen ('monitor'): the
// window then opens camera only with the whole-screen note. Where it says otherwise the expected view follows.
export const SELFVIEW_SCENARIO = '3k. Self-view, independent scenarios (window refused, closed in the countdown, two Stops at once, a 5,000 character script, reopened three times, the share ending, 60 s with the window open)';
const LONG = 60;      // seconds with the window open, for memory
const PEAK_MB = 400;  // loop 1's bound for a 60 s recording
const MIN_FPS = 10;   // the window must be painted at least this often while it is open
const SCRIPT = (() => { // 5,000 characters: plain paragraphs, one 330 character link with no space to break at
  const para = 'Here is the part where I open the settings and show the new layout. Take a breath, look at the camera, keep going. ';
  const link = `https://example.com/${'a-very-long-unbroken-link-'.repeat(12)}`;
  let s = '';
  for (let i = 0; s.length < 5000; i++) s += i === 3 ? `${link}\n\n` : i % 4 === 3 ? `${para}\n\n` : para;
  return s.slice(0, 5000);
})();

// Runs in every page of these contexts before the page's own scripts. Wraps requestWindow to log what the page
// asks for and, while window.__svRefuse holds entries, to refuse as a browser that blocks it does: 'throw' at
// once, or 'reject' later. Where the browser has no Document Picture-in-Picture, a popup stands in.
function windowHook() {
  const d = window.documentPictureInPicture;
  const real = d?.requestWindow ? d.requestWindow.bind(d) : async (o) => window.open('', '_blank', `popup,width=${o.width},height=${o.height}`);
  Object.assign(window, { __svStandIn: !d, __svAsked: [], __svRefuse: [] });
  const request = (opts) => {
    window.__svAsked.push({ ...opts });
    const how = window.__svRefuse.shift(), err = new DOMException('Refused by the scenario test', 'NotAllowedError');
    if (how === 'throw') throw err;
    if (how === 'reject') return Promise.reject(err);
    return real(opts);
  };
  if (d) d.requestWindow = request; else window.documentPictureInPicture = { requestWindow: request };
}
// An init script for scenario 5b: the share says it is one window, not the whole screen, so no note shows.
function windowSurface() {
  const real = MediaStreamTrack.prototype.getSettings;
  MediaStreamTrack.prototype.getSettings = function getSettings() { const s = real.call(this); return s.displaySurface ? { ...s, displaySurface: 'window' } : s; };
}

// The page's side: the self-view hooks, the recorder's phase and the step 2 band.
const snap = (p) => p.evaluate(() => {
  const h = window.__vignette.selfview, st = window.__vignette.state, $ = (id) => document.getElementById(id);
  return {
    used: h.used, open: h.open, view: h.view, phase: h.phase, opens: h.opens, byHand: h.closedByHand, frames: h.frames, script: h.script,
    rec: st.phase, surface: st.surface, show: !$('showWindow').hidden, note: $('viewNote').hidden ? '' : $('viewNote').textContent,
    timer: $('timer').textContent, detail: window.__vignette.details['self-view'] || '', panel: $('details').textContent,
    asked: window.__svAsked.length, msg: $('setupMsg').textContent,
  };
});
// The window's side: clock, dot, note, view, countdown digit, and the picture as an 8x8 grid of mean luma.
const inWin = (w) => w.evaluate(() => {
  const $ = (id) => document.getElementById(id), c = $('svCanvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, grid = new Array(64).fill(0), n = new Array(64).fill(0);
  for (let j = 0; j < c.height; j += 2) {
    for (let i = 0; i < c.width; i += 2) {
      const k = 4 * (j * c.width + i), g = Math.floor((8 * j) / c.height) * 8 + Math.floor((8 * i) / c.width);
      grid[g] += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]; n[g]++;
    }
  }
  return {
    clock: $('svClock').textContent, dot: !$('svDot').hidden, note: !$('svNote').hidden, noteText: $('svNote').textContent.trim(), count: $('svCount').hidden ? '' : $('svFlap').textContent,
    view: $('svViewCamera').checked ? 'camera' : $('svViewComposite').checked ? 'composite' : 'none', grid: grid.map((v, i) => v / n[i]),
  };
});
// The window's layout: overflow, the script panel, and whether every control sits inside the window.
const layout = (w) => w.evaluate(() => {
  const $ = (id) => document.getElementById(id), de = document.documentElement, tx = $('svText');
  const box = (id) => { const b = $(id).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, h: b.height }; };
  return {
    iw: innerWidth, ih: innerHeight, docW: de.scrollWidth, docH: de.scrollHeight, bodyW: document.body.scrollWidth,
    shown: !$('svScript').hidden, len: tx.textContent.length, sh: tx.scrollHeight, ch: tx.clientHeight, sw: tx.scrollWidth, cw: tx.clientWidth,
    top: tx.scrollTop, speed: $('svSpeed').textContent, panel: box('svScript'), pic: box('svCanvas'),
    inside: ['svStop', 'svClock', 'svViewCamera', 'svSlower', 'svPause', 'svFaster'].filter((id) => {
      const b = box(id); return !(b.l >= 0 && b.t >= 0 && b.r <= innerWidth + 0.5 && b.b <= innerHeight + 0.5 && b.h > 0);
    }),
  };
});
const secsOf = (clock) => { const [m, s] = clock.split(':').map(Number); return 60 * m + s; };
const lumaOf = (x) => x.grid.reduce((a, b) => a + b, 0) / x.grid.length;
const change = (a, b) => Math.max(...a.grid.map((v, i) => Math.abs(v - b.grid[i])));
async function until(check, what, ms = 10_000) {
  for (const end = Date.now() + ms; ;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function selfviewScenario(page, { record, assert, ok, base, login, pageHooks, watch }) {
  const browser = page.context().browser();
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  async function fresh(init) { // a logged-in recorder in a new context, the webcam on; t.wins collects its windows
    const ctx = await browser.newContext();
    await ctx.addInitScript(pageHooks);
    await ctx.addInitScript(windowHook);
    if (init) await ctx.addInitScript(init);
    const t = { ctx, errs: [], wins: [], lines: [], maxOpen: 0 };
    t.open = () => t.wins.filter((w) => !w.isClosed());
    t.p = watch(await ctx.newPage(), 'self-view scenario');
    t.p.on('pageerror', (e) => t.errs.push(`page: ${e.message}`));
    t.p.on('console', (m) => t.lines.push(m.text()));
    ctx.on('page', async (w) => {
      if ((await w.opener()) !== t.p) return; // another tab, not the window
      watch(w, 'self-view window').on('pageerror', (e) => t.errs.push(`window: ${e.message}`));
      t.wins.push(w);
      t.maxOpen = Math.max(t.maxOpen, t.open().length);
    });
    await login(t.p, base);
    await t.p.waitForSelector('#app:not([hidden])');
    await t.p.check('#cam');
    return t;
  }
  async function surface(t) { // what is shared decides the window's default view (the webcam is on)
    t.surface = await t.p.evaluate(() => window.__vignette.state.surface);
    t.view = t.surface === 'monitor' ? 'camera' : 'composite';
  }
  async function share(t) {
    await t.p.click('#share');
    await t.p.waitForSelector('#recordStep:not([hidden])', { timeout: 15_000 });
    await surface(t);
  }
  const recording = (t) => t.p.waitForFunction(() => window.__vignette.state.phase === 'recording', null, { timeout: 10_000 });
  // The window that opened after `before` windows, once the page says it is open, at the size the page asked for.
  async function opened(t, before) {
    await t.p.waitForFunction(() => window.__vignette.selfview.open, null, { timeout: 10_000 });
    const w = await until(() => t.wins.length > before && t.wins.at(-1), 'the window to appear as a page');
    const asked = await t.p.evaluate(() => window.__svAsked.at(-1));
    await w.setViewportSize({ width: asked.width, height: asked.height });
    return w;
  }
  async function start(t) { // Start; resolves with the window
    const before = t.wins.length;
    await t.p.click('#start');
    return opened(t, before);
  }
  async function closeByHand(t, w) {
    await w.close();
    await t.p.waitForFunction(() => !window.__vignette.selfview.open, null, { timeout: 5000 });
  }
  async function edited(t) { // waits for the edit step; how long the page says it recorded and the video's length
    await t.p.waitForSelector('#editBody:not([hidden])', { timeout: 60_000 });
    return t.p.evaluate(() => ({ secs: (window.__vignette.state.stoppedAt - window.__vignette.state.startedAt) / 1000, dur: window.__vignette.editor.video.duration }));
  }
  const painting = async (t, ms = 600) => { const a = await snap(t.p); await t.p.waitForTimeout(ms); const b = await snap(t.p); return b.frames - a.frames; };
  const count = (t, re) => t.lines.filter((l) => re.test(l)).length;

  // ---------- 1. The request for the window refused ----------
  async function refused(t) {
    await share(t);
    await t.p.evaluate(() => window.__svRefuse.push('throw', 'reject')); // Start's request throws, the first retry rejects
    await t.p.click('#start');
    await t.p.waitForFunction(() => window.__vignette.state.phase === 'countdown' || window.__vignette.state.phase === 'recording');
    const cd = await snap(t.p);
    await recording(t);
    const a = await snap(t.p);
    assert(cd.used === 'refused' && cd.show && !cd.open, `refused: during the countdown the page says ${JSON.stringify({ used: cd.used, show: cd.show, rec: cd.rec })}`);
    assert(a.used === 'refused' && !a.open && a.asked === 1 && a.opens === 0 && t.open().length === 0, `refused: after Start the hooks say ${JSON.stringify(a)}`);
    assert(/did not open the window \(NotAllowedError/.test(a.detail) && /self-view: the browser did not open/.test(a.panel) && a.show,
      `refused: Details say "${a.detail}", Show window shown: ${a.show}`);
    const frames = await painting(t, 500);
    await t.p.waitForTimeout(500);
    await t.p.click('#showWindow');
    await t.p.waitForFunction(() => window.__svAsked.length === 2 && !window.__vignette.selfview.open && !document.getElementById('showWindow').hidden, null, { timeout: 5000 });
    const b = await snap(t.p);
    assert(b.used === 'refused' && b.opens === 0 && b.rec === 'recording' && t.open().length === 0, `refused twice: ${JSON.stringify(b)}`);
    const before = t.wins.length;
    await t.p.click('#showWindow');
    const w = await opened(t, before);
    const n = await painting(t), c = await snap(t.p), x = await inWin(w);
    assert(c.used === 'document' && c.opens === 1 && !c.show && t.open().length === 1 && n >= 6 && x.dot && near(secsOf(x.clock), secsOf(c.timer), 1) && x.view === c.view,
      `third try: ${JSON.stringify({ c, n, clock: x.clock, dot: x.dot, view: x.view })}`);
    await t.p.click('#stop');
    const e = await edited(t);
    await until(() => w.isClosed(), 'the window to close on Stop', 5000);
    assert(e.secs > 1 && near(e.dur, e.secs, 1), `refused: recorded ${e.secs} s, the video lasts ${e.dur} s`);
    ok(`refused (thrown, then rejected): recording started and ran, Details "${a.detail.slice(0, 62)}...", Show window offered; the second press was refused too, `
      + `the third opened one window painting ${n} frames in 600 ms with the clock ${x.clock} (page ${c.timer}); ${e.dur.toFixed(2)} s video; no frames while refused: ${frames === 0}`);
  }

  // ---------- 2. The window closed during the countdown ----------
  async function countdownClose(t) {
    await share(t);
    const t0 = Date.now();
    const w = await start(t);
    const x = await inWin(w), a = await snap(t.p);
    const stops = { window: await w.isDisabled('#svStop'), page: await t.p.isDisabled('#stop') }; // reported: the spec says nothing of Stop in the countdown
    const whole = t.surface === 'monitor';
    // The whole-screen note (its wording is the design's to choose): in the window, and the same words on the page.
    assert(a.rec === 'countdown' && a.phase === 'countdown' && /^[123]$/.test(x.count) && x.view === t.view && x.note === whole
      && (whole ? /window/.test(x.noteText) && a.note.trim() === x.noteText : a.note === ''),
      `countdown: window ${JSON.stringify({ count: x.count, view: x.view, note: x.note, noteText: x.noteText })}, page ${JSON.stringify({ rec: a.rec, surface: t.surface, note: a.note })}`);
    await closeByHand(t, w);
    const b = await snap(t.p);
    assert(b.rec === 'countdown' && b.byHand === 1 && b.show && !b.note, `closed in the countdown: ${JSON.stringify(b)}`);
    await recording(t);
    const after = (Date.now() - t0) / 1000;
    const frames = await painting(t, 1000), c = await snap(t.p);
    assert(after > 2.5 && after < 6 && frames === 0 && c.show && !c.open && c.byHand === 1 && /closed by hand/.test(c.detail) && await t.p.isEnabled('#stop'),
      `after the countdown: started ${after.toFixed(1)} s after Start, ${frames} frames painted with the window closed, ${JSON.stringify(c)}`);
    await t.p.click('#stop');
    const e = await edited(t), d = await snap(t.p);
    assert(e.secs > 0.8 && near(e.dur, e.secs, 1) && !d.show && d.byHand === 1 && t.open().length === 0, `closed in the countdown: ${JSON.stringify({ e, d })}`);
    ok(`closed at "${x.count}" of the countdown: recording started ${after.toFixed(1)} s after Start, no painting while closed, Show window offered, `
      + `Details "${c.detail}"; Stop gave a ${e.dur.toFixed(2)} s video. During the countdown the window's Stop was ${stops.window ? 'disabled' : 'enabled'}, the page's ${stops.page ? 'disabled' : 'enabled'}`);
  }

  // ---------- 3. Stop in the window and on the page at the same moment ----------
  async function twoStops(t) {
    const ways = [
      ['clicked together', async (w) => (await Promise.allSettled([w.click('#svStop', { force: true, timeout: 3000 }), t.p.click('#stop', { force: true, timeout: 3000 })]))
        .map((r, i) => `${['window', 'page'][i]} ${r.status === 'fulfilled' ? 'clicked' : `not clicked: ${r.reason.message.split('\n')[0].slice(0, 50)}`}`).join(', ')],
      ['window then page in one task', () => t.p.evaluate(() => { window.__vignette.selfview.window.document.getElementById('svStop').click(); document.getElementById('stop').click(); })],
      ['page then window in one task', () => t.p.evaluate(() => { const b = window.__vignette.selfview.window.document.getElementById('svStop'); document.getElementById('stop').click(); b.click(); })],
    ];
    const said = [];
    for (const [name, press] of ways) {
      await share(t);
      const w = await start(t);
      await recording(t);
      await t.p.waitForTimeout(1500);
      t.lines.length = 0;
      const how = await press(w);
      const e = await edited(t);
      await t.p.waitForTimeout(1500); // room for a second stop to show itself
      await until(() => w.isClosed(), `the window to close (${name})`, 5000);
      const s = await t.p.evaluate(() => ({ session: window.__vignette.state.session, phase: window.__vignette.state.phase, edit: !document.getElementById('editBody').hidden }));
      const rec = count(t, /^\[vignette\] recorded:/), opened_ = count(t, /^\[vignette\] re-package:/), a = await snap(t.p);
      assert(rec === 1 && opened_ === 1, `${name}: ${rec} recordings noted and the editor opened ${opened_} times`);
      assert(s.session === null && s.phase === 'stopped' && s.edit && near(e.dur, e.secs, 1) && !a.open && a.byHand === 0 && t.open().length === 0,
        `${name}: ${JSON.stringify({ s, e, open: a.open, byHand: a.byHand })}`);
      said.push(`${name}${typeof how === 'string' ? ` (${how})` : ''}: one ${e.dur.toFixed(2)} s recording`);
    }
    ok(`two Stops at once, each a new recording: ${said.join('; ')}; the editor opened once each time, the window closed, none counted as closed by hand`);
  }

  // ---------- 4. A 5,000 character script ----------
  async function longScript(t) {
    await t.p.check('#scriptOn');
    await t.p.fill('#script', SCRIPT);
    const kept = await t.p.evaluate(() => sessionStorage.getItem('vignette.script')?.length);
    let L, rate1, rate2, hand, reopenTop, asked;
    const secs = await record(t.p, 0, async () => {
      const w = await opened(t, 0);
      asked = await t.p.evaluate(() => window.__svAsked.at(-1));
      L = await layout(w);
      const top = async () => (await layout(w)).top;
      const s0 = await top(); await t.p.waitForTimeout(3000); const s1 = await top();
      await w.click('#svFaster'); await w.click('#svFaster');
      const s2 = await top(); await t.p.waitForTimeout(3000); const s3 = await top();
      rate1 = (s1 - s0) / 3; rate2 = (s3 - s2) / 3;
      const speed = (await layout(w)).speed;
      const tx = await w.locator('#svText').boundingBox();
      await w.mouse.move(tx.x + tx.width / 2, tx.y + tx.height / 2);
      await w.mouse.wheel(0, 400); // by hand: it goes there, holds for 3 s, then carries on from there
      await t.p.waitForTimeout(500); const h0 = await top();
      await t.p.waitForTimeout(1500); const h1 = await top();
      await t.p.waitForTimeout(2500); const h2 = await top();
      hand = { from: s3, h0, h1, h2, speed };
      await closeByHand(t, w);
      await t.p.click('#showWindow');
      const w2 = await opened(t, 1);
      await t.p.waitForTimeout(500);
      reopenTop = (await layout(w2)).top;
    });
    assert(kept === 5000 && L.shown && L.len === 5000, `script: kept ${kept} characters, the panel shown ${L.shown} with ${L.len}`);
    assert(L.docW <= L.iw && L.bodyW <= L.iw && L.docH <= L.ih + 1 && L.sw <= L.cw + 1, `script: the window overflows: ${JSON.stringify(L)}`);
    assert(L.inside.length === 0 && L.pic.h >= 60 && L.panel.h >= 0.3 * L.ih && L.panel.h <= 0.5 * L.ih,
      `script: on ${L.iw}x${L.ih} the controls outside the window are [${L.inside}], the picture is ${L.pic.h} px, the panel ${L.panel.h} px`);
    assert(L.sh > 5 * L.ch, `script: the panel's text is ${L.sh} px tall in a ${L.ch} px panel`);
    assert(rate1 > 3 && hand.speed === '2x' && rate2 > 1.4 * rate1, `script: scrolled ${rate1.toFixed(1)} px/s at 1x and ${rate2.toFixed(1)} px/s at ${hand.speed}`);
    assert(hand.h0 >= hand.from + 300 && near(hand.h1, hand.h0, 2) && hand.h2 > hand.h1 + 3, `script: after the wheel ${JSON.stringify(hand)}`);
    ok(`5,000 characters (a 330 character link in it) in a ${asked.width}x${asked.height} window: no overflow either way, every control inside, picture ${L.pic.h.toFixed(0)} px, `
      + `panel ${L.panel.h.toFixed(0)} px over ${L.sh} px of text; ${rate1.toFixed(1)} px/s at 1x, ${rate2.toFixed(1)} px/s at 2x; the wheel took it to ${hand.h0}, held 3 s, then on to ${hand.h2}; `
      + `reopened, the script starts at ${reopenTop} px (it was past ${hand.h2} px: the place is not kept, the spec does not ask for it); ${secs.toFixed(1)} s recorded`);
  }

  // ---------- 5. The window reopened three times in one recording ----------
  async function reopened(t) {
    const figures = [];
    let before, view;
    const secs = await record(t.p, 0, async () => {
      await surface(t);
      let w = await opened(t, 0);
      for (let i = 1; i <= 3; i++) {
        await t.p.waitForTimeout(600);
        if (i === 1) { // switch the view in the window: the reopened one must keep it
          view = t.view === 'camera' ? 'composite' : 'camera';
          await w.check(view === 'camera' ? '#svViewCamera' : '#svViewComposite');
        }
        await closeByHand(t, w);
        const gone = await painting(t, 500), a = await snap(t.p);
        assert(gone === 0 && a.byHand === i && a.show && t.open().length === 0, `closed ${i}: ${gone} frames painted, ${JSON.stringify(a)}`);
        before = t.wins.length;
        const asked = a.asked;
        if (i === 1) await t.p.click('#showWindow');
        if (i === 2) await t.p.evaluate(() => { const b = document.getElementById('showWindow'); b.click(); b.click(); }); // two presses in one task
        if (i === 3) await t.p.dblclick('#showWindow'); // an impatient double click
        w = await opened(t, before);
        await t.p.waitForTimeout(800);
        const n = await painting(t), b = await snap(t.p), x0 = await inWin(w);
        await t.p.waitForTimeout(300);
        const x1 = await inWin(w);
        assert(b.opens === i + 1 && b.asked === asked + 1 && b.open && !b.show && t.open().length === 1 && t.wins.length === before + 1,
          `reopen ${i}: ${b.asked - asked} requests, ${t.wins.length - before} windows, ${t.open().length} open, ${JSON.stringify(b)}`);
        assert(n >= 6 && x0.view === view && b.view === view && x0.dot && near(secsOf(x0.clock), secsOf(b.timer), 1) && lumaOf(x0) > 20,
          `reopen ${i}: ${n} frames in 600 ms, view ${x0.view} (chose ${view}), clock ${x0.clock} against ${b.timer}, picture luma ${lumaOf(x0).toFixed(1)}`);
        figures.push(`${n} frames in 600 ms, picture ${lumaOf(x0).toFixed(0)} luma, changing ${change(x0, x1).toFixed(1)}`);
      }
    });
    const e = await edited(t), z = await snap(t.p);
    await until(() => t.open().length === 0, 'the window to close on Stop', 5000);
    assert(z.opens === 4 && z.byHand === 3 && z.asked === 4 && t.wins.length === 4 && t.maxOpen === 1 && !z.open && near(e.dur, secs, 1),
      `after Stop: ${JSON.stringify({ opens: z.opens, byHand: z.byHand, asked: z.asked, windows: t.wins.length, maxOpen: t.maxOpen, e })}`);
    ok(`reopened three times (a click, two presses in one task, a double click): ${z.asked} requests, ${z.opens} windows, never more than ${t.maxOpen} open, `
      + `${z.byHand} closed by hand; the chosen view (${view}) kept; after each reopen ${figures.join('; ')}; ${e.dur.toFixed(2)} s video`);
  }

  // ---------- 5b. A double click on Show window with one window shared ----------
  // With a window shared there is no whole-screen note to take Show window's place when it hides, so whatever
  // sits below may move under the pointer before the second click lands.
  async function doubleClick(t) {
    let a, under, moved;
    const secs = await record(t.p, 0, async () => {
      await surface(t);
      await closeByHand(t, await opened(t, 0));
      const at = await t.p.locator('#showWindow').boundingBox(), x = at.x + at.width / 2, y = at.y + at.height / 2;
      const stopBefore = await t.p.locator('#stop').boundingBox();
      await t.p.dblclick('#showWindow');
      await opened(t, 1);
      await t.p.waitForTimeout(800);
      a = await snap(t.p);
      under = await t.p.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el?.closest('button')?.id || el?.className || el?.tagName; }, [x, y]);
      moved = stopBefore.y - (await t.p.locator('#stop').boundingBox()).y;
      assert(a.rec === 'recording' && a.open && t.open().length === 1 && t.wins.length === 2,
        `double click on Show window (${t.surface} shared): the recording is "${a.rec}", window open ${a.open}, ${t.wins.length} windows; `
        + `after the first click "${under}" sits under the pointer and Stop moved up ${moved} px`);
    });
    const e = await edited(t);
    assert(t.surface === 'window' && near(e.dur, secs, 1), `double click: ${t.surface} shared, ${e.dur} s video for ${secs} s`);
    ok(`double click on Show window with a window shared: one window, still recording; under the pointer afterwards: "${under}" (Stop moved ${moved} px); ${e.dur.toFixed(2)} s video`);
  }

  // ---------- 6. The screen share ending while the window is open ----------
  async function shareEnds(t) {
    const end = () => t.p.evaluate(() => {
      const tr = window.__vignette.state.screen.getVideoTracks()[0]; // what the browser's own Stop sharing does
      tr.stop();
      tr.dispatchEvent(new Event('ended'));
    });
    await share(t);
    const w = await start(t);
    await recording(t);
    await t.p.waitForTimeout(2000);
    await end();
    const e = await edited(t);
    await until(() => w.isClosed(), 'the window to close when the share ended', 5000);
    const a = await snap(t.p);
    assert(!a.open && a.byHand === 0 && a.rec === 'stopped' && /Sharing was stopped from the browser, so the recording stopped too/.test(a.msg) && near(e.dur, e.secs, 1) && e.secs > 1.5,
      `share ended while recording: ${JSON.stringify({ a, e })}`);
    // And during the countdown: the window closes and nothing is recorded.
    t.lines.length = 0;
    await share(t);
    const w2 = await start(t);
    await end();
    await until(() => w2.isClosed(), 'the window to close when the share ended in the countdown', 5000);
    await t.p.waitForTimeout(3500); // past where the countdown would have ended
    const b = await snap(t.p), s = await t.p.evaluate(() => window.__vignette.state.session);
    assert(!b.open && b.rec === 'idle' && s === null && !b.show && count(t, /^\[vignette\] codec:/) === 0 && /Sharing stopped/.test(b.msg) && t.open().length === 0,
      `share ended in the countdown: ${JSON.stringify({ b, session: s, codec: count(t, /codec/) })}`);
    ok(`share ended while recording: the window closed, the recording stopped (${e.dur.toFixed(2)} s video) with "${a.msg}"; `
      + `ended in the countdown: the window closed, nothing recorded, "${b.msg}"`);
  }

  // ---------- 7. 60 s with the window open, from behind another tab ----------
  async function long(t) {
    let f0, f1, x0, x1, still;
    const secs = await record(t.p, LONG, async () => {
      const w = await opened(t, 0);
      f0 = (await snap(t.p)).frames;
      x0 = await inWin(w);
      await t.p.evaluate(() => { window.__inBackground = true; });
      const other = await t.ctx.newPage();
      await other.goto('about:blank');
      await other.bringToFront();
      await other.waitForTimeout(LONG * 1000);
      await t.p.bringToFront();
      await t.p.evaluate(() => { window.__inBackground = false; });
      await other.close();
      f1 = (await snap(t.p)).frames;
      x1 = await inWin(w);
      still = t.open().length === 1 && (await snap(t.p)).open;
    });
    const e = await edited(t);
    const peakLine = await t.p.evaluate(() => window.__vignette.details['peak memory']);
    const peak = Number(/^(\d+) MB JavaScript heap at most/.exec(peakLine || '')?.[1]);
    const fps = (f1 - f0) / secs;
    assert(still && f1 - f0 >= LONG * MIN_FPS, `60 s: the window open at the end: ${still}; ${f1 - f0} frames painted in ${secs.toFixed(1)} s (at least ${LONG * MIN_FPS})`);
    assert(peak > 0 && peak < PEAK_MB, `60 s: Details say "${peakLine}" (bound ${PEAK_MB} MB)`);
    assert(near(e.dur, secs, 1.5), `60 s: ${e.dur} s video for ${secs} s recorded`);
    ok(`${secs.toFixed(1)} s with the window open behind another tab: ${f1 - f0} frames painted (${fps.toFixed(1)} per second), the picture still moving at the end `
      + `(changed ${change(x0, x1).toFixed(1)}), peak ${peak} MB JavaScript heap (bound ${PEAK_MB} MB); ${e.dur.toFixed(2)} s video`);
  }

  const scenarios = [
    ['1. window refused', refused], ['2. closed in the countdown', countdownClose], ['3. two Stops at once', twoStops],
    ['4. 5,000 character script', longScript], ['5. reopened three times', reopened],
    ['5b. double click on Show window, a window shared', doubleClick, windowSurface], ['6. share ending', shareEnds], ['7. 60 s with the window open', long],
  ];
  const failed = [];
  for (const [name, run, init] of scenarios) {
    let t = null;
    try {
      t = await fresh(init);
      const standIn = await t.p.evaluate(() => window.__svStandIn);
      if (standIn) console.log(`      ${name}: this browser has no Document Picture-in-Picture; a popup stands in`);
      await run(t);
      assert(t.errs.length === 0, `${name}: errors in the page or the window:\n${t.errs.join('\n')}`);
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err.message}`);
      failed.push(name);
    } finally {
      await t?.ctx.close().catch(() => {});
    }
  }
  assert(failed.length === 0, `self-view scenarios failed: ${failed.join(', ')} (each FAIL line above says why)`);
}
