// Steps 3h to 3j of the end-to-end suite (run from e2e.mjs): the floating
// self-view window (docs/LOOP2_SELF_VIEW_SPEC.md). Each scenario runs in a
// fresh browser context so its init scripts (a stand-in display surface, no
// Document Picture-in-Picture) apply from the first page load.
//
// Headless Chromium may or may not have Document Picture-in-Picture. Where
// it does, the real window is used; where it does not, a stand-in
// requestWindow that opens a popup (window.open) takes its place, so the
// same page code runs either way. The step prints which it used.
// SELFVIEW_STANDIN=1 removes the real API first, to run the stand-in on a
// Chromium that has it. The classic picture-in-picture fallback (the API
// deleted) is always tested.
export const SELFVIEW_STEP = '3h. Self-view window: opens from Start with 3-2-1, the clock and the dot, paints, Stop in it ends the recording; closed by hand the recording goes on and Show window reopens it; whole screen opens camera only with the note';
export const SCRIPT_STEP = '3i. Script panel: typed in step 1, shown and scrolling in the window (1x and 0.5x), pauses, absent with no text, kept over a reload, paused and still under reduced motion';
export const FALLBACK_STEP = '3j. Self-view without the window: classic picture-in-picture, webcam off, and the memory it adds';

const NOTE = 'This window is in the recording. Move it to another screen, or share a window instead.';
const MEMORY_SECONDS = 20;
const MEMORY_MB = 60;

// Init scripts (run in every page of a context, before its own scripts).
function standIn() {
  if ('documentPictureInPicture' in window) return;
  window.documentPictureInPicture = { requestWindow: () => Promise.resolve(window.open('', '_blank', 'popup,width=360,height=420')) };
  window.__selfviewStandIn = true;
}
// What the shared picture says it is. Chromium's fake screen calls itself a monitor on some platforms,
// so each scenario that depends on it says which it wants.
function surface(kind) {
  const real = MediaStreamTrack.prototype.getSettings;
  MediaStreamTrack.prototype.getSettings = function getSettings() {
    const s = real.call(this);
    return this.kind === 'video' && 'displaySurface' in s ? { ...s, displaySurface: kind } : s;
  };
}
function noDocumentPip() { delete window.documentPictureInPicture; }

// Runs in the window: a 96 px wide grey copy of its picture, to compare frames.
const sample = () => {
  const c = document.getElementById('svCanvas'), t = document.createElement('canvas');
  t.width = 96; t.height = Math.max(2, Math.round((96 * c.height) / c.width));
  const x = t.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, t.width, t.height);
  const d = x.getImageData(0, 0, t.width, t.height).data, out = [];
  for (let i = 0; i < d.length; i += 4) out.push(Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
  return out;
};
const differs = (a, b) => a.length === b.length && a.some((v, i) => Math.abs(v - b[i]) > 8);
const hooks = (page) => page.evaluate(() => {
  const h = window.__vignette.selfview;
  return { mode: h.mode, used: h.used, open: h.open, view: h.view, phase: h.phase, clock: h.clock, opens: h.opens, closedByHand: h.closedByHand, frames: h.frames, script: h.script, requested: h.requested };
});
// Runs in the window: which view plate is lit (data-on) and whether it is painted white.
const plates = () => Object.fromEntries(['composite', 'camera'].map((v) => {
  const el = document.getElementById(v === 'composite' ? 'svCompositeLabel' : 'svCameraLabel');
  return [v, { on: el.dataset.on, white: getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)' }];
}));
// The lit plate is the chosen view, and only it is painted white.
const lit = (p, view) => p[view].on === 'true' && p[view].white && Object.entries(p).every(([v, x]) => v === view || (x.on === 'false' && !x.white));
const phase = (page) => page.evaluate(() => window.__vignette.state.phase);

export function selfviewSteps({ browser, base, login, pageHooks, watch, assert, ok }) {
  const contexts = [];
  // A logged-in recorder page in a fresh context. win: install the stand-in when the real window is missing;
  // init: more [script, argument] pairs; options: for the context (reducedMotion, say).
  async function recorder({ win = true, init = [], options = {} } = {}) {
    const context = await browser.newContext(options);
    contexts.push(context);
    await context.addInitScript(pageHooks);
    if (win && process.env.SELFVIEW_STANDIN === '1') await context.addInitScript(noDocumentPip);
    if (win) await context.addInitScript(standIn);
    for (const [fn, arg] of init) await context.addInitScript(fn, arg);
    const page = watch(await context.newPage(), 'self-view');
    await login(page, base);
    await page.waitForSelector('#app:not([hidden])');
    return { context, page };
  }
  async function share(page) {
    await page.click('#share');
    await page.waitForSelector('#recordStep:not([hidden])', { timeout: 15_000 });
  }
  // Start, and the window that opens from it.
  async function start(context, page) {
    const [win] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), page.click('#start')]);
    await win.waitForSelector('#svStop', { timeout: 10_000 });
    return win;
  }
  // Stop in the window closes the window inside the click itself, so Playwright's own click can find its page
  // gone mid-action (seen on CI's Linux runner). The click is dispatched from inside the window instead, after
  // this call returns, and the window's close is what is awaited.
  async function stopFrom(win) {
    const closed = win.waitForEvent('close', { timeout: 10_000 });
    await win.evaluate(() => { setTimeout(() => document.getElementById('svStop').click(), 0); });
    await closed;
  }
  const recording = (page) => page.waitForFunction(() => window.__vignette.state.phase === 'recording', null, { timeout: 10_000 });
  const edited = (page) => page.waitForSelector('#editBody:not([hidden])', { timeout: 60_000 });
  const peak = (page) => page.evaluate(() => Number(/^(\d+) MB JavaScript heap/.exec(window.__vignette.details['peak memory'] || '')?.[1]));

  return {
    async windowStep() {
      const { context, page } = await recorder({ init: [[surface, 'window']] });
      const standInUsed = await page.evaluate(() => !!window.__selfviewStandIn);
      const forced = process.env.SELFVIEW_STANDIN === '1' ? ', SELFVIEW_STANDIN=1 removed the real one' : ', this Chromium has none';
      console.log(`      self-view window: ${standInUsed ? `a stand-in popup for Document Picture-in-Picture${forced}` : 'the real Document Picture-in-Picture window'}`);
      await share(page);
      const win = await start(context, page);
      // 3, 2, 1 in the window, each a split-flap flip from the digit before (the page's 200 ms motion), then the
      // live picture with the dot and the clock.
      let before = '';
      for (const n of ['3', '2', '1']) {
        await win.waitForFunction(([d, from]) => {
          const f = document.getElementById('svFlap');
          return f.textContent === d && f.dataset.to === d && f.dataset.from === from && f.classList.contains('flipping')
            && getComputedStyle(f, '::after').animationName === 'sv-flap-bottom' && !document.getElementById('svCount').hidden;
        }, [n, before], { timeout: 3000 });
        if (n === '3') {
          const quiet = await win.evaluate(() => { const b = document.getElementById('svStop'); return { disabled: b.disabled, cursor: getComputedStyle(b).cursor }; });
          assert(quiet.disabled && quiet.cursor === 'not-allowed', `during the countdown the window's Stop is ${JSON.stringify(quiet)}, expected disabled like the page's`);
        }
        before = n;
      }
      await recording(page);
      await win.waitForFunction(() => !document.getElementById('svStop').disabled, null, { timeout: 3000 });
      await win.waitForSelector('#svCount', { state: 'hidden' });
      assert(await win.isVisible('#svDot'), 'no recording dot in the window');
      await win.waitForFunction(() => document.getElementById('svClock').textContent >= '00:03', null, { timeout: 10_000 });
      let h = await hooks(page);
      assert(h.used === 'document' && h.open && h.view === 'composite' && await win.isChecked('#svViewComposite') && !(await win.isDisabled('#svViewCamera')) && lit(await win.evaluate(plates), 'composite'),
        `a shared window (not the whole screen) with the webcam on should open on the composite view, its plate lit: ${JSON.stringify(h)}, plates ${JSON.stringify(await win.evaluate(plates))}`);
      assert(await win.isHidden('#svNote') && await page.isHidden('#viewNote') && await page.isHidden('#showWindow'), 'the whole-screen note or Show window shows for a shared window');
      assert(await win.isHidden('#svScript'), 'a script panel shows with no script');
      const a = await win.evaluate(sample);
      await win.waitForTimeout(500);
      const b = await win.evaluate(sample);
      assert(differs(a, b) && a.some((v) => v > 20), 'the window\'s picture did not change over 500 ms (or is black)');
      // The camera only square changes the view, and back; the lit plate follows each time.
      await win.click('#svCameraLabel');
      assert((await hooks(page)).view === 'camera' && lit(await win.evaluate(plates), 'camera'), `the camera only square: view ${(await hooks(page)).view}, plates ${JSON.stringify(await win.evaluate(plates))}`);
      await win.click('#svCompositeLabel');
      assert((await hooks(page)).view === 'composite' && lit(await win.evaluate(plates), 'composite'), `back to the composite: view ${(await hooks(page)).view}, plates ${JSON.stringify(await win.evaluate(plates))}`);

      // Closed by hand: the recording goes on; Show window opens it again, where it was.
      await win.close();
      await page.waitForSelector('#showWindow:not([hidden])', { timeout: 5000 });
      const clockAtClose = await page.textContent('#timer');
      await page.waitForTimeout(1200);
      h = await hooks(page);
      assert(await phase(page) === 'recording' && !h.open && h.closedByHand === 1 && (await page.textContent('#timer')) > clockAtClose,
        `closing the window by hand: phase ${await phase(page)}, ${JSON.stringify(h)}, timer ${clockAtClose} then ${await page.textContent('#timer')}`);
      assert(/closed by hand, the recording carried on/.test(await page.evaluate(() => window.__vignette.details['self-view'])), 'Details do not say the window was closed by hand');
      const [again] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), page.click('#showWindow')]);
      await again.waitForSelector('#svStop');
      assert(await again.isVisible('#svDot') && await again.isHidden('#svCount') && (await again.textContent('#svClock')) >= '00:04',
        `the reopened window shows ${await again.textContent('#svClock')}, dot ${await again.isVisible('#svDot')}`);
      assert(await page.isHidden('#showWindow') && (await hooks(page)).opens === 2, 'Show window still shows, or the window did not count as reopened');

      // Stop in the window ends the recording, and the window closes with it.
      await stopFrom(again);
      await edited(page);
      h = await hooks(page);
      const said = await page.evaluate(() => window.__vignette.details['self-view']);
      assert(await phase(page) === 'stopped' && !h.open && /Document Picture-in-Picture/.test(said), `after Stop in the window: phase ${await phase(page)}, ${JSON.stringify(h)}, Details "${said}"`);
      await context.close();

      // The whole screen: camera only first, with the note in the window and on the page; the composite is still allowed.
      const whole = await recorder({ init: [[surface, 'monitor']] });
      await share(whole.page);
      const w2 = await start(whole.context, whole.page);
      await recording(whole.page);
      h = await hooks(whole.page);
      assert(h.view === 'camera' && await w2.isChecked('#svViewCamera') && lit(await w2.evaluate(plates), 'camera'), `the whole screen opened on ${h.view}, plates ${JSON.stringify(await w2.evaluate(plates))}`);
      assert((await w2.textContent('#svNote')) === NOTE && await w2.isVisible('#svNote') && (await whole.page.textContent('#viewNote')) === NOTE && await whole.page.isVisible('#viewNote'),
        'the whole-screen note is missing from the window or the page');
      const under = await w2.evaluate(() => document.getElementById('svNote').getBoundingClientRect().top - document.querySelector('.sv-bar').getBoundingClientRect().bottom);
      assert(under >= -0.5, `the whole-screen note is not under the bar (${under} px)`);
      await w2.click('#svCompositeLabel');
      assert((await hooks(whole.page)).view === 'composite' && lit(await w2.evaluate(plates), 'composite'), 'the composite could not be chosen for the whole screen, or its plate is not lit');
      await w2.click('#svCameraLabel');
      assert((await hooks(whole.page)).view === 'camera' && lit(await w2.evaluate(plates), 'camera'), 'the camera plate did not light again');
      // Stop on the page closes the window too.
      await Promise.all([w2.waitForEvent('close', { timeout: 10_000 }), whole.page.click('#stop')]);
      await edited(whole.page);
      assert(await whole.page.isHidden('#viewNote'), 'the whole-screen note stayed after Stop');
      await whole.context.close();
      ok(`${standInUsed ? 'stand-in popup' : 'real Document Picture-in-Picture'}: 3-2-1, dot, clock past 00:02, composite by default, the picture changes; `
        + 'closed by hand the recording went on and Show window reopened it; Stop in the window ended both; the whole screen opened on camera only with the note under the bar, and Stop on the page closed it; '
        + 'each digit flipped from the one before, with Stop disabled until it recorded; the lit plate followed the view every time');
    },

    async scriptStep() {
      const { context, page } = await recorder();
      const lines = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}: say the next thing plainly, then pause.`);
      const text = lines.join('\n');
      assert(await page.isHidden('#scriptRow') && !(await page.isChecked('#scriptOn')), 'the script box shows before the toggle is on');
      await page.check('#scriptOn');
      await page.waitForSelector('#scriptRow:not([hidden])');
      assert((await page.getAttribute('#script', 'placeholder')) === 'Notes to read while you record. Only you see them.', 'the script box has the wrong placeholder');
      // Where the box sits: on a desktop from the tools' left edge to the action's right edge, on a phone above Share screen.
      const place = async (width, height) => {
        await page.setViewportSize({ width, height });
        return page.evaluate(() => ({
          ...Object.fromEntries(['script', 'setupStep', 'share'].map((id) => [id, document.getElementById(id).getBoundingClientRect().toJSON()])),
          first: document.querySelector('#setupStep > *').getBoundingClientRect().toJSON(), // the first toggle, where the tools visibly start
        }));
      };
      const wide = await place(1280, 720), narrow = await place(390, 844);
      await page.setViewportSize({ width: 1280, height: 720 });
      assert(Math.abs(wide.script.left - wide.setupStep.left) <= 2 && Math.abs(wide.script.left - wide.first.left) <= 2 && Math.abs(wide.script.right - wide.share.right) <= 2,
        `at 1280 wide the script box runs ${wide.script.left} to ${wide.script.right}; the tools start at ${wide.setupStep.left} (first toggle ${wide.first.left}) and the action ends at ${wide.share.right}`);
      assert(narrow.script.top < narrow.share.top && narrow.script.top > narrow.setupStep.top, `at 390 wide the script box's top is ${narrow.script.top}, Share screen's ${narrow.share.top}`);
      await page.fill('#script', text);
      await page.reload();
      await page.waitForSelector('#app:not([hidden])');
      assert((await page.inputValue('#script')) === text && await page.isChecked('#scriptOn') && await page.isVisible('#script'), 'the script did not survive a reload in the same tab');
      await share(page);
      // Step 1 is now a done sign: the toggles stay on one line and the box still starts under the first.
      const done = await page.evaluate(() => {
        const items = [...document.querySelectorAll('#setupStep > *')].map((el) => el.getBoundingClientRect());
        return { box: document.getElementById('script').getBoundingClientRect().left, first: items[0].left, rows: Math.max(...items.map((r) => r.top)) - Math.min(...items.map((r) => r.top)) };
      });
      assert(Math.abs(done.box - done.first) <= 2 && done.rows < 2, `with step 1 done the box starts at ${done.box}, the first toggle at ${done.first}, the toggles span ${done.rows} px of rows`);
      const win = await start(context, page);
      await win.waitForSelector('#svScript:not([hidden])');
      assert((await win.textContent('#svText')) === text, 'the window does not show the script as typed');
      await recording(page);
      // At the size the window asked for (headless ignores it, so set it here), the picture sits at the top at its
      // own shape and the script has the rest, about 40%.
      const asked = (await hooks(page)).requested;
      await win.setViewportSize(asked);
      await win.waitForTimeout(200);
      const fit = await win.evaluate(() => {
        const c = document.getElementById('svCanvas'), box = document.getElementById('svPic').getBoundingClientRect();
        return { top: box.top, canvasTop: c.getBoundingClientRect().top, w: box.width, h: box.height, ar: c.width / c.height, script: document.getElementById('svScript').getBoundingClientRect().height / innerHeight };
      });
      assert(asked.width === 360 && fit.top === 0 && fit.canvasTop === 0 && Math.abs(fit.h - fit.w / fit.ar) <= 2 && fit.script > 0.38 && fit.script < 0.45,
        `at the asked ${asked.width}x${asked.height} the picture is ${fit.w}x${fit.h} at ${fit.top} (its shape is ${fit.ar.toFixed(3)}), the script ${(fit.script * 100).toFixed(0)}% of the window`);
      await win.waitForTimeout(300);
      const t0 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      await win.waitForTimeout(3000);
      const t1 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      assert(t1 > t0 + 10, `the script did not scroll over 3 s: scrollTop ${t0} then ${t1}`);
      // Slower from 1x: 0.5x, the slowest (Slower is then disabled), and about half the distance in the same 3 s.
      await win.click('#svSlower');
      const slow = { shown: await win.textContent('#svSpeed'), speed: (await hooks(page)).script.speed, off: await win.isDisabled('#svSlower') };
      const s0 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      await win.waitForTimeout(3000);
      const s1 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      const rate = (s1 - s0) / (t1 - t0);
      assert(slow.shown === '0.5x' && slow.speed === 0.5 && slow.off && rate > 0.3 && rate < 0.75,
        `Slower gave ${JSON.stringify(slow)} and ${s1 - s0} px in 3 s against ${t1 - t0} px at 1x (${rate.toFixed(2)} of it)`);
      await win.click('#svFaster');
      assert((await win.textContent('#svSpeed')) === '1x', 'Faster from 0.5x did not go back to 1x');
      await win.click('#svPause');
      await win.waitForTimeout(200);
      const p0 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      await win.waitForTimeout(1500);
      const p1 = await win.evaluate(() => document.getElementById('svText').scrollTop);
      const paused = (await hooks(page)).script;
      assert(p1 === p0 && paused.paused && (await win.getAttribute('#svPause', 'aria-label')) === 'Scroll the script', `pause did not hold the script: ${p0} then ${p1}, ${JSON.stringify(paused)}`);
      await win.click('#svFaster');
      assert((await hooks(page)).script.speed === 1.5 && (await win.textContent('#svSpeed')) === '1.5x', 'Faster did not go to 1.5x');
      // Scrolled on by hand, closed by hand, opened again: the script carries on from its place, at its speed, still paused.
      await win.evaluate(() => { document.getElementById('svText').scrollTop = 300; });
      await win.waitForTimeout(300);
      const kept = await win.evaluate(() => document.getElementById('svText').scrollTop);
      await win.close();
      await page.waitForSelector('#showWindow:not([hidden])', { timeout: 5000 });
      const [back] = await Promise.all([context.waitForEvent('page', { timeout: 10_000 }), page.click('#showWindow')]);
      await back.waitForSelector('#svScript:not([hidden])');
      await back.waitForFunction((k) => Math.abs(document.getElementById('svText').scrollTop - k) <= 20, kept, { timeout: 3000 })
        .catch(() => {}); // the assert below says where it ended up
      const resumed = { ...(await hooks(page)).script, top: await back.evaluate(() => document.getElementById('svText').scrollTop), shown: await back.textContent('#svSpeed') };
      assert(kept > 250 && Math.abs(resumed.top - kept) <= 20 && resumed.speed === 1.5 && resumed.shown === '1.5x' && resumed.paused,
        `reopened, the script is at ${resumed.top} px (was ${kept}), speed ${resumed.speed} (shows ${resumed.shown}), paused ${resumed.paused}`);
      await stopFrom(back);
      await edited(page);
      // A new recording starts the script from the top, at 1x, scrolling.
      await share(page);
      const fresh = await start(context, page);
      await fresh.waitForSelector('#svScript:not([hidden])');
      const restart = { ...(await hooks(page)).script, top: await fresh.evaluate(() => document.getElementById('svText').scrollTop), shown: await fresh.textContent('#svSpeed') };
      assert(restart.top < 5 && restart.speed === 1 && restart.shown === '1x' && !restart.paused, `a new recording's script starts at ${restart.top} px, ${restart.shown}, paused ${restart.paused}`);
      await recording(page);
      await Promise.all([fresh.waitForEvent('close'), page.click('#stop')]);
      await edited(page);
      // No text: no panel.
      await page.fill('#script', '');
      await share(page);
      const bare = await start(context, page);
      await recording(page);
      assert(await bare.isHidden('#svScript') && !(await hooks(page)).script.shown, 'a script panel shows with the text empty');
      await Promise.all([bare.waitForEvent('close'), page.click('#stop')]);
      await edited(page);
      assert(await page.evaluate(() => sessionStorage.getItem('vignette.script')) === null, 'an emptied script is still stored');
      await context.close();

      // Reduced motion: the window's flap does not flip, and the script starts paused (play glyph) and stays put.
      const calm = await recorder({ options: { reducedMotion: 'reduce' } });
      await calm.page.check('#scriptOn');
      await calm.page.fill('#script', text);
      await share(calm.page);
      const still = await start(calm.context, calm.page);
      const flap = await still.evaluate(() => { const f = document.getElementById('svFlap'); return { text: f.textContent, name: getComputedStyle(f, '::after').animationName }; });
      await recording(calm.page);
      const c0 = await still.evaluate(() => document.getElementById('svText').scrollTop);
      await still.waitForTimeout(1500);
      const quiet = {
        ...(await hooks(calm.page)).script,
        moved: (await still.evaluate(() => document.getElementById('svText').scrollTop)) - c0,
        glyph: await still.getAttribute('#svPauseUse', 'href'), label: await still.getAttribute('#svPause', 'aria-label'),
      };
      assert(flap.text && flap.name === 'none', `under reduced motion the window's flap shows "${flap.text}" with the animation "${flap.name}"`);
      assert(quiet.paused && /#i-play$/.test(quiet.glyph) && quiet.label === 'Scroll the script' && quiet.moved === 0, `under reduced motion the script is ${JSON.stringify(quiet)}`);
      await stopFrom(still);
      await edited(calm.page);
      await calm.context.close();
      ok(`the box spans the tools and the action at 1280 wide and sits above Share screen at 390; the script came back after a reload; at the asked ${asked.width}x${asked.height} `
        + `the picture is at the top at ${fit.w}x${fit.h} with the script ${(fit.script * 100).toFixed(0)}%; it scrolled ${t0} to ${t1} px in 3 s; pause held it at ${p0}; Slower went to 0.5x at ${rate.toFixed(2)} of the 1x rate; Faster went to 1.5x; `
        + `reopened it was back at ${resumed.top} px (left at ${kept}), 1.5x and paused; a new recording started it at the top at 1x; no text, no panel; under reduced motion the flap did not flip and the script started paused (play glyph) and stayed put`);
    },

    async fallbackStep() {
      // No Document Picture-in-Picture at all: classic picture-in-picture of the hidden video.
      const { context, page } = await recorder({ win: false, init: [[noDocumentPip], [surface, 'window']] });
      const offered = await page.evaluate(() => ({ doc: 'documentPictureInPicture' in window, classic: document.pictureInPictureEnabled, mode: window.__vignette.selfview.mode }));
      assert(!offered.doc && offered.mode === 'classic', `with the API deleted the page offers ${JSON.stringify(offered)}`);
      await share(page);
      await page.click('#start');
      await page.waitForFunction(() => document.pictureInPictureElement && document.pictureInPictureElement === window.__vignette.selfview.video, null, { timeout: 10_000 });
      await recording(page);
      const f0 = (await hooks(page)).frames;
      await page.waitForTimeout(1000);
      let h = await hooks(page);
      assert(h.used === 'classic' && h.frames > f0 + 10, `classic picture-in-picture is not being painted: ${JSON.stringify(h)} (from ${f0})`);
      // Its picture is the composite at the screen's shape with a black strip under it for the dot and the clock
      // (about 11% of the width); nothing covers the picture, so its bottom left (the bubble's default place) shows.
      const frame = await page.evaluate(() => {
        const v = window.__vignette.selfview.video, preview = document.getElementById('canvas'), c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(v, 0, 0);
        const picH = Math.round((c.width * preview.height) / preview.width) & ~1;
        const area = (x0, y0, x1, y1) => {
          const d = x.getImageData(x0, y0, x1 - x0, y1 - y0).data;
          let sum = 0, dark = 0;
          for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; if (l < 40) dark++; }
          return { mean: sum / (d.length / 4), dark: dark / (d.length / 4) };
        };
        return { w: c.width, h: c.height, picH, strip: area(0, picH + 1, c.width, c.height), above: area(0, picH - 4, Math.round(c.width / 3), picH - 1) };
      });
      const strip = (frame.h - frame.picH) / frame.w;
      assert(strip > 0.09 && strip < 0.13 && frame.strip.dark > 0.7 && frame.above.mean > 40,
        `the classic video is ${frame.w}x${frame.h} for a ${frame.picH} px picture (strip ${(strip * 100).toFixed(1)}% of the width, ${(frame.strip.dark * 100).toFixed(0)}% dark; the picture's bottom left has mean ${frame.above.mean.toFixed(0)})`);
      // Left by hand: Show window enters it again.
      await page.evaluate(() => document.exitPictureInPicture());
      await page.waitForSelector('#showWindow:not([hidden])', { timeout: 5000 });
      await page.click('#showWindow');
      await page.waitForFunction(() => document.pictureInPictureElement === window.__vignette.selfview.video, null, { timeout: 5000 });
      await page.click('#stop');
      await edited(page);
      const said = await page.evaluate(() => ({ pip: !!document.pictureInPictureElement, details: window.__vignette.details['self-view'] }));
      assert(!said.pip && /classic picture-in-picture/.test(said.details), `after Stop: still in picture-in-picture ${said.pip}, Details "${said.details}"`);
      await context.close();

      // Webcam off: the screen only, with camera only disabled.
      const off = await recorder();
      await off.page.uncheck('#cam');
      await share(off.page);
      const win = await start(off.context, off.page);
      await recording(off.page);
      h = await hooks(off.page);
      assert(h.view === 'composite' && await win.isDisabled('#svViewCamera') && (await win.getAttribute('#svCompositeLabel', 'title')) === 'Screen',
        `webcam off: view ${h.view}, camera only disabled ${await win.isDisabled('#svViewCamera')}`);
      const g0 = (await hooks(off.page)).frames;
      await win.waitForTimeout(500);
      assert((await hooks(off.page)).frames > g0 + 5 && (await win.evaluate(sample)).some((v) => v > 20), 'webcam off: the window is not painted');
      await stopFrom(win);
      await edited(off.page);
      await off.context.close();

      // Memory: a 20 s recording with the window open against one with it closed (by hand, straight away).
      const mem = await recorder({ init: [[surface, 'window']] }); // the composite: the heavier picture to paint
      await share(mem.page);
      const shut = await start(mem.context, mem.page);
      await shut.close();
      await recording(mem.page);
      await mem.page.waitForTimeout(MEMORY_SECONDS * 1000);
      await mem.page.click('#stop');
      await edited(mem.page);
      const closedPeak = await peak(mem.page);
      await share(mem.page);
      const kept = await start(mem.context, mem.page);
      await recording(mem.page);
      await mem.page.waitForTimeout(MEMORY_SECONDS * 1000);
      await Promise.all([kept.waitForEvent('close'), mem.page.click('#stop')]);
      await edited(mem.page);
      const openPeak = await peak(mem.page);
      await mem.context.close();
      assert(closedPeak > 0 && openPeak > 0 && openPeak - closedPeak <= MEMORY_MB, `peak memory ${openPeak} MB with the window open, ${closedPeak} MB with it closed: more than ${MEMORY_MB} MB apart`);
      ok(`classic picture-in-picture painted, ${frame.w}x${frame.h} with a ${frame.h - frame.picH} px strip under the picture (${(frame.strip.dark * 100).toFixed(0)}% dark), left on Stop, Show window entered it again; webcam off showed the screen with camera only disabled; `
        + `${MEMORY_SECONDS} s peak memory ${openPeak} MB with the window, ${closedPeak} MB without`);
    },

    async close() { await Promise.all(contexts.map((c) => c.close().catch(() => {}))); },
  };
}
