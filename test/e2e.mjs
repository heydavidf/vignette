// End-to-end test: starts `wrangler dev` (local R2 and D1) on free ports with
// throwaway databases, drives the recorder in Chromium with a fake camera and
// microphone, and checks the whole path from recording to share link, plus
// the error paths each earlier bug fix covers.
// Run: npm test   (HEADED=1 to watch, BACKGROUND=1 for real background throttling flags, DEBUG=1 for server logs)
import { chromium } from 'playwright';
import { rm } from 'node:fs/promises';
import {
  root, env, auth, PASSWORD, assert, step, ok, servers, startServer, stopServers, pageHooks, login, record, listVideos, api, create,
} from './harness.mjs';
import { cutsStep, CUTS_STEP } from './cuts-step.mjs';
import { cutsScenario, CUTS_SCENARIO } from './cuts-scenario.mjs';
import { tracksStep, TRACKS_STEP, originalsStep, ORIGINALS_STEP } from './tracks-step.mjs';
import { migrateStep, MIGRATE_STEP } from './migrate-step.mjs';
import { tracksScenario, TRACKS_SCENARIO } from './tracks-scenario.mjs';
import { selfviewSteps, SELFVIEW_STEP, SCRIPT_STEP, FALLBACK_STEP } from './selfview-step.mjs';
import { selfviewScenario, SELFVIEW_SCENARIO } from './selfview-scenario.mjs';
import { layoutsStep, LAYOUTS_STEP, againStep, AGAIN_STEP } from './layouts-step.mjs';
import { layoutsScenario, LAYOUTS_SCENARIO } from './layouts-scenario.mjs';

const RECORD_SECONDS = 4;
const PART = 20 * 1024 * 1024;
const BACKGROUND = process.env.BACKGROUND === '1';

let browser = null;
let passed = false;
try {
  step('Setup: three wrangler dev servers (one normal, one with no password set, one on a 0.1 database)');
  const [main, unset, old] = await Promise.all([startServer('main', PASSWORD, 'current'), startServer('unset', '', null), startServer('old', PASSWORD, 'v0.1')]);
  const base = main.base;
  ok(`main on ${base}, no-password server on ${unset.base}, 0.1 database on ${old.base}`);

  browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    // Playwright normally turns Chrome's background throttling off; BACKGROUND=1 keeps it on.
    ignoreDefaultArgs: BACKGROUND
      ? ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
      : [],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-tab-capture-source-by-title=Vignette',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const pageErrors = [];
  const watch = (p, label) => {
    p.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
    p.on('console', (m) => { if (m.text().startsWith('[vignette]')) console.log(`      ${m.text()}`); });
    return p;
  };
  const context = await browser.newContext();
  await context.addInitScript(pageHooks);
  const page = watch(await context.newPage(), 'recorder');

  step('1. Password (with "ö" and an emoji), then the recorder shows');
  await login(page, base);
  await page.waitForSelector('#app:not([hidden])');
  ok('recorder visible after entering the password');

  step(`2. Record ${RECORD_SECONDS} s while another tab is in front, with the bubble on`);
  const elapsed = await record(page, RECORD_SECONDS, async () => {
    await page.evaluate(() => { window.__inBackground = true; });
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await other.waitForTimeout(RECORD_SECONDS * 1000);
    await page.bringToFront();
    await page.evaluate(() => { window.__inBackground = false; });
    await other.close();
  });
  const duration = await page.evaluate(() => window.__vignette.editor.video.duration);
  assert(elapsed >= RECORD_SECONDS && Math.abs(duration - elapsed) < 1, `parsed duration ${duration} s, but it recorded for ${elapsed} s`);
  const canvasLine = await page.evaluate(() => window.__vignette.details.canvas);
  const fps = Number(/([\d.]+) fps/.exec(canvasLine)?.[1]);
  assert(fps > 20, `bubble drew only ${fps} fps in the background ("${canvasLine}")`);
  ok(`parsed duration ${duration.toFixed(2)} s; bubble drew ${fps} fps while in the background`);

  step('2b. Cancelling the share picker keeps the recording');
  await page.evaluate(() => { window.__cancelNextShare = true; });
  await page.click('#share');
  await page.waitForFunction(() => /cancelled/.test(document.getElementById('setupMsg').textContent));
  assert(await page.isVisible('#editBody'), 'edit step disappeared after cancelling the picker');
  assert(await page.evaluate(() => !!window.__vignette.editor.video), 'recording was discarded after cancelling the picker');
  ok('edit step and recording still there');

  step('3. Trim 1 s off each end, set the title, upload (through two failures)');
  await page.waitForFunction(() => document.getElementById('preview').readyState >= 1);
  await page.evaluate(() => { document.getElementById('preview').currentTime = 1; });
  await page.click('#setStart');
  await page.evaluate((d) => { document.getElementById('preview').currentTime = d - 1; }, duration);
  await page.click('#setEnd');
  const trim = await page.evaluate(() => ({ start: +document.getElementById('trimStart').value, end: +document.getElementById('trimEnd').value }));
  assert(Math.abs(trim.start - 1) < 0.05 && Math.abs(trim.end - (duration - 1)) < 0.05, `trim handles at ${JSON.stringify(trim)}`);
  await page.fill('#title', 'E2E test "><img src=x onerror=alert(1)></title><script>alert(2)</script>\'&');
  // Too big: no Retry button, since sending again cannot help.
  await page.route('**/api/videos', (r) => (r.request().method() === 'POST'
    ? r.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"Video is larger than the 2000 MB limit"}' })
    : r.continue()));
  await page.click('#upload');
  await page.waitForFunction(() => /larger than/.test(document.getElementById('uploadMsg').textContent));
  assert(await page.isHidden('#retry'), 'Retry button shown for a 413');
  await page.unroute('**/api/videos');
  // Server error on create: tried once only (a lost response must not leave duplicate rows).
  let creates = 0;
  await page.route('**/api/videos', (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    creates++;
    return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
  });
  await page.click('#upload');
  await page.waitForSelector('#retry:not([hidden])', { timeout: 20_000 });
  assert(creates === 1, `POST /api/videos was sent ${creates} times, expected once`);
  await page.unroute('**/api/videos');
  ok('413 shows no Retry; a failed create is not retried automatically');
  await page.click('#retry');
  await page.waitForSelector('#shareBox:not([hidden])', { timeout: 60_000 });
  const shareUrl = await page.inputValue('#shareUrl');
  const id = shareUrl.split('/v/')[1];
  assert(/^[a-z0-9]{16}$/.test(id || ''), `unexpected share URL ${shareUrl}`);
  ok(`Retry uploaded it: ${shareUrl}`);

  step('3b. The bubble keeps its place when the screen arrives; drag it, then record 3 s with it there');
  // Where the bubble sits on screen: as a share of the picture frame, plus the frame's and bubble's size.
  const bubbleOnFrame = () => page.evaluate(() => {
    const b = document.getElementById('bubble').getBoundingClientRect();
    const f = document.getElementById('frame').getBoundingClientRect();
    return { x: (b.left + b.width / 2 - f.left) / f.width, y: (b.top + b.height / 2 - f.top) / f.height, d: b.width, fw: f.width, fh: f.height };
  });
  await page.reload(); // this upload is done; back to an empty well
  await page.waitForSelector('#app:not([hidden])');
  const stored = await page.evaluate(() => window.__vignette.bubble.get());
  const empty = await bubbleOnFrame();
  await page.click('#share');
  await page.waitForSelector('#recordStep:not([hidden])', { timeout: 15_000 });
  await page.waitForFunction(() => document.getElementById('bubble').dataset.live === 'true');
  const before = await page.evaluate(() => window.__vignette.bubble.get());
  const shared = await bubbleOnFrame();
  assert(before.x === stored.x && before.y === stored.y && before.size === stored.size,
    `sharing moved the stored bubble from ${JSON.stringify(stored)} to ${JSON.stringify(before)}`);
  assert(['x', 'y'].every((k) => Math.abs(empty[k] - shared[k]) < 0.002) && ['d', 'fw', 'fh'].every((k) => Math.abs(empty[k] - shared[k]) < 1),
    `the bubble shifted or resized when the screen arrived: ${JSON.stringify(empty)} then ${JSON.stringify(shared)}`);
  await page.locator('#bubble').scrollIntoViewIfNeeded();
  const grip = await page.locator('#bubble').boundingBox();
  const gx = grip.x + grip.width / 2, gy = grip.y + grip.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 200, gy - 120, { steps: 12 });
  await page.mouse.up();
  const placed = await page.evaluate(() => window.__vignette.bubble.get());
  const frameBox = await page.locator('#frame').boundingBox();
  assert(placed.x > before.x && placed.y < before.y, `bubble did not move right and up: ${JSON.stringify(before)} to ${JSON.stringify(placed)}`);
  assert([placed.x, placed.y].every((v) => v >= 0 && v <= 1), `bubble position left the frame: ${JSON.stringify(placed)}`);
  const movedPx = { x: (placed.x - before.x) * frameBox.width, y: (before.y - placed.y) * frameBox.height };
  assert(Math.abs(movedPx.x - 200) < 3 && Math.abs(movedPx.y - 120) < 3, `bubble moved ${JSON.stringify(movedPx)} px, expected 200 right and 120 up`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vignette.bubble')));
  assert(saved?.x === placed.x && saved?.y === placed.y, `saved position ${JSON.stringify(saved)} does not match ${JSON.stringify(placed)}`);
  // Where the bubble sits on screen, as a share of the preview canvas.
  const onScreen = await page.evaluate(() => {
    const b = document.getElementById('bubble').getBoundingClientRect();
    const c = document.getElementById('canvas').getBoundingClientRect();
    return { x: (b.left + b.width / 2 - c.left) / c.width, y: (b.top + b.height / 2 - c.top) / c.height, r: b.width / 2 / Math.min(c.width, c.height) };
  });
  await page.click('#start');
  await page.waitForFunction(() => window.__vignette.state.phase === 'recording', null, { timeout: 10_000 });
  await page.evaluate(() => { window.__drawsBefore = window.__vignette.state.framesDrawn; });
  await page.waitForTimeout(3000);
  const drawn = await page.evaluate(() => ({ ...window.__vignette.bubble.lastDraw, frames: window.__vignette.state.framesDrawn - window.__drawsBefore }));
  await page.click('#stop');
  await page.waitForSelector('#editBody:not([hidden])', { timeout: 60_000 });
  assert(drawn.frames > 30, `compositor drew only ${drawn.frames} frames in 3 s`);
  assert(Math.abs(drawn.x - placed.x) < 1e-6 && Math.abs(drawn.y - placed.y) < 1e-6 && drawn.size === placed.size,
    `compositor drew the bubble at ${JSON.stringify(drawn)}, but it was placed at ${JSON.stringify(placed)}`);
  const radius = { small: 0.10, medium: 0.14, large: 0.20 }[drawn.size];
  assert(Math.abs(onScreen.x - drawn.x) < 0.005 && Math.abs(onScreen.y - drawn.y) < 0.005 && Math.abs(onScreen.r - radius) < 0.005,
    `on-screen bubble ${JSON.stringify(onScreen)} does not line up with the recorded one ${JSON.stringify(drawn)}`);
  ok(`same place and size before and after sharing; moved 200 px right and 120 px up to (${placed.x.toFixed(3)}, ${placed.y.toFixed(3)}), saved; ${drawn.frames} frames drawn there, matching the screen`);

  step(CUTS_STEP);
  await cutsStep(page, { record, assert, ok });

  step(CUTS_SCENARIO); // the independent scenario test (AGENTS.md rule 5)
  await cutsScenario(page, { record, assert, ok, base, api, viewer: async () => watch(await context.newPage(), 'cuts viewer') });

  step(TRACKS_STEP);
  await tracksStep(page, { record, assert, ok });
  step(ORIGINALS_STEP);
  await originalsStep(page, { record, assert, ok, base, auth, listVideos, viewer: async () => watch(await context.newPage(), 'originals viewer') });
  step(TRACKS_SCENARIO); // the independent scenario test (AGENTS.md rule 5)
  await tracksScenario(page, { record, assert, ok, base, api, viewer: async () => watch(await context.newPage(), 'tracks viewer') });

  const selfview = selfviewSteps({ browser, base, login, pageHooks, watch, assert, ok }); // each in its own context
  step(SELFVIEW_STEP);
  await selfview.windowStep();
  step(SCRIPT_STEP);
  await selfview.scriptStep();
  step(FALLBACK_STEP);
  await selfview.fallbackStep();
  step(SELFVIEW_SCENARIO); await selfviewScenario(page, { record, assert, ok, base, login, pageHooks, watch }); // the independent scenario test (AGENTS.md rule 5)

  step(LAYOUTS_STEP);
  await layoutsStep(page, { record, assert, ok });
  step(AGAIN_STEP);
  await againStep(page, { record, assert, ok, base, auth, api, listVideos, viewer: async () => watch(await context.newPage(), 'layouts viewer') });
  step(LAYOUTS_SCENARIO); // the independent scenario test (AGENTS.md rule 5)
  await layoutsScenario(page, { record, assert, ok, base, api, login, pageHooks, watch, dir: main.dir });

  step('4. Share page');
  const share = await fetch(`${base}/v/${id}`);
  const html = await share.text();
  assert(share.status === 200, `/v/${id} gave ${share.status}`);
  assert(html.includes('E2E test'), 'share page is missing the title');
  assert(/<meta property="og:image" content="[^"]+\/thumb\//.test(html), 'share page is missing og:image');
  assert(!html.includes('<img src=x') && !html.includes('<script>alert') && html.includes('&lt;img src=x'), 'title is not escaped on the share page');
  const thumb = await fetch(`${base}/thumb/${id}`);
  assert(thumb.status === 200 && thumb.headers.get('content-type') === 'image/jpeg', `thumbnail gave ${thumb.status}`);
  assert(thumb.headers.get('cache-control') === 'private, max-age=3600', `thumbnail Cache-Control is ${thumb.headers.get('cache-control')}`);
  await thumb.arrayBuffer();
  const csp = share.headers.get('content-security-policy') || '';
  assert(csp.includes("frame-ancestors 'none'") && csp.includes("base-uri 'none'"), `share page CSP is ${csp}`);
  const home = await fetch(`${base}/`);
  assert((home.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'recorder page is missing frame-ancestors');
  const lib = await fetch(`${base}/library`);
  assert((lib.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'library page is missing frame-ancestors');
  ok('200, has the title and og:image; thumbnail is a private-cache JPEG; share and recorder pages refuse framing');

  step('5. Media streaming');
  const ranged = await fetch(`${base}/media/${id}`, { headers: { range: 'bytes=0-99' } });
  const rangedBody = await ranged.arrayBuffer();
  assert(ranged.status === 206 && ranged.headers.get('content-range'), `Range request gave ${ranged.status}`);
  assert(rangedBody.byteLength === 100, `Range body is ${rangedBody.byteLength} bytes, not 100`);
  assert(ranged.headers.get('cache-control') === 'private, max-age=3600', `Cache-Control is ${ranged.headers.get('cache-control')}`);
  const row = (await listVideos(base)).find((v) => v.id === id);
  const wholeBody = await (await fetch(`${base}/media/${id}`)).arrayBuffer();
  assert(wholeBody.byteLength === row.size, `body is ${wholeBody.byteLength} bytes, row says ${row.size}`);
  assert(Math.abs(row.duration - (trim.end - trim.start)) < 0.5, `stored duration ${row.duration} s does not match the trim`);
  const past = await fetch(`${base}/media/${id}`, { headers: { range: 'bytes=999999999-' } });
  const pastBody = await past.json().catch(() => null);
  assert(past.status === 416 && pastBody?.error && past.headers.get('content-range') === `bytes */${row.size}`, `out-of-range request gave ${past.status} ${JSON.stringify(pastBody)}`);
  ok(`206 with 100 bytes and private caching; 200 with ${row.size} bytes; 416 is JSON`);

  step('6. The share page plays in the browser');
  const viewer = watch(await context.newPage(), 'viewer');
  await viewer.goto(shareUrl);
  await viewer.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 1 && v.duration > 1;
  }, null, { timeout: 30_000 });
  ok('video element loaded metadata');
  await viewer.close();

  step('7. Library lists it; delete it');
  await page.goto(`${base}/library`);
  const rowSel = `tr[data-id="${id}"]`;
  await page.waitForSelector(rowSel, { timeout: 15_000 });
  assert((await page.textContent(rowSel)).includes('E2E test'), 'library row is missing the title');
  await page.click(`${rowSel} button:has-text("Delete")`);
  await page.click(`${rowSel} button:has-text("Yes")`);
  await page.waitForSelector(rowSel, { state: 'detached', timeout: 15_000 });
  assert((await fetch(`${base}/v/${id}`)).status === 404, 'share page still there after delete');
  ok('listed, deleted inline, share page now 404');

  step('8. Multipart upload of a synthetic 45 MB file');
  let partRequests = 0;
  page.on('request', (r) => { if (r.method() === 'PUT' && /\/parts\/\d+$/.test(r.url())) partRequests++; });
  const big = await page.evaluate(async () => {
    const { uploadVideo } = await import('/upload.js');
    const size = 45 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251; // a pattern we can check on the way back
    const job = {};
    let progress = 0;
    const result = await uploadVideo({
      blob: new Blob([bytes], { type: 'video/mp4' }), title: 'E2E multipart', duration: 60, width: 2, height: 2,
      job, onProgress: (sent, total) => { progress = sent / total; },
    });
    return { ...result, size, multipart: job.multipart, parts: Object.keys(job.parts).length, progress };
  });
  assert(big.multipart && big.parts === 3 && partRequests === 3, `expected 3 parts, got ${big.parts} (${partRequests} requests)`);
  assert(big.progress === 1, `progress ended at ${big.progress}`);
  const bigBody = new Uint8Array(await (await fetch(`${base}/media/${big.id}`)).arrayBuffer());
  assert(bigBody.length === big.size, `streamed ${bigBody.length} bytes, expected ${big.size}`);
  for (let i = 0; i < bigBody.length; i++) if (bigBody[i] !== i % 251) throw new Error(`multipart byte ${i} is wrong`);
  const boundary = await fetch(`${base}/media/${big.id}`, { headers: { range: 'bytes=20971500-20971599' } });
  assert(boundary.status === 206 && (await boundary.arrayBuffer()).byteLength === 100, 'range across a part boundary failed');
  assert((await api(base, `/api/videos/${big.id}`, { method: 'DELETE' })).status === 200, 'cleanup delete failed');
  ok(`3 parts, ${big.size} bytes streamed back intact, ranges work across part boundaries`);

  step('8b. Completion checks the part list; unfinished videos are not served');
  const gappy = await create(base, 2 * PART + 1000);
  const putPart = (n, length) => api(base, `/api/videos/${gappy.id}/parts/${n}`, { method: 'PUT', body: new Uint8Array(length).fill(n) }).then((r) => r.json());
  const p1 = await putPart(1, PART);
  const p3 = await putPart(3, 1000);
  const complete = (parts) => api(base, `/api/videos/${gappy.id}/complete`, { method: 'POST', body: JSON.stringify({ parts }) });
  const gap = await complete([p1, p3]);
  assert(gap.status === 409, `complete with a missing part gave ${gap.status}, expected 409`);
  const p2 = await putPart(2, PART);
  const badEtag = await complete([p1, { partNumber: 2, etag: 'not-a-real-etag' }, p3]);
  assert(badEtag.status === 409, `complete with a bad etag gave ${badEtag.status}, expected 409`);
  let status = (await listVideos(base)).find((v) => v.id === gappy.id)?.status;
  assert(status === 'uploading', `status after failed completes is ${status}`);
  assert((await complete([p1, p2, p3])).status === 200, 'complete with the right parts failed');
  await api(base, `/api/videos/${gappy.id}`, { method: 'DELETE' });
  const half = await create(base, 1000);
  await api(base, `/api/videos/${half.id}/blob`, { method: 'PUT', body: new Uint8Array(1000) });
  const early = await fetch(`${base}/media/${half.id}`);
  assert(early.status === 404, `/media for an unfinished upload gave ${early.status}, expected 404`);
  const earlyThumb = await fetch(`${base}/thumb/${half.id}`);
  assert(earlyThumb.status === 404, `/thumb for an unfinished upload gave ${earlyThumb.status}, expected 404`);
  await early.arrayBuffer();
  await api(base, `/api/videos/${half.id}`, { method: 'DELETE' });
  ok('a gap or a bad etag gives 409 and stays "uploading"; the right parts then complete; unfinished media is 404');

  step('9. Wrong password');
  const noAuth = await fetch(`${base}/api/videos`);
  const badAuth = await fetch(`${base}/api/videos`, { headers: { authorization: 'Bearer wrong' } });
  assert(noAuth.status === 401 && badAuth.status === 401, `expected 401s, got ${noAuth.status} and ${badAuth.status}`);
  const stranger = await browser.newContext(); // fresh storage, no saved password
  const strangerPage = watch(await stranger.newPage(), 'stranger');
  await login(strangerPage, base, 'wrong');
  await strangerPage.waitForFunction(() => /not right/.test(document.querySelector('#gate .error').textContent));
  assert(await strangerPage.isHidden('#app'), 'recorder shown despite a wrong password');
  ok('API gives 401; the page shows the inline message and stays locked');

  step('10. Storage blocked, webcam off, a 2560x1440 tab');
  const locked = await browser.newContext({ viewport: { width: 2560, height: 1440 } });
  await locked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  const lockedPage = watch(await locked.newPage(), 'no-storage');
  await login(lockedPage, base);
  await lockedPage.waitForSelector('#app:not([hidden])');
  assert(await lockedPage.evaluate(() => { try { return !window.localStorage; } catch { return true; } }), 'localStorage was not blocked');
  await lockedPage.uncheck('#cam');
  await record(lockedPage, 3);
  await lockedPage.click('#upload');
  await lockedPage.waitForSelector('#shareBox:not([hidden])', { timeout: 60_000 });
  const lockedUrl = await lockedPage.inputValue('#shareUrl');
  const width = Number(/og:video:width" content="(\d+)"/.exec(await (await fetch(lockedUrl)).text())?.[1]);
  assert(width > 0 && width <= 1920, `stored width is ${width}, expected 1 to 1920`);
  await lockedPage.goto(lockedUrl);
  await lockedPage.evaluate(() => { const v = document.querySelector('video'); v.muted = true; return v.play(); });
  await lockedPage.waitForFunction(() => document.querySelector('video').currentTime > 0.5, null, { timeout: 15_000 });
  ok(`uploaded with storage blocked; stored width ${width}; the video plays`);
  await locked.close();

  step('11. A server with no password set says so');
  await login(strangerPage, unset.base, 'anything');
  const expected = 'VIGNETTE_PASSWORD is not set on the server';
  await strangerPage.waitForFunction((t) => document.querySelector('#gate .error').textContent.includes(t), expected);
  const noTable = await (await fetch(`${unset.base}/v/aaaaaaaaaaaaaaaa`)).json();
  assert(/npm run db:init/.test(noTable.error), `missing table gave ${JSON.stringify(noTable)}`);
  ok(`the page shows "${expected}"; a missing table says to run npm run db:init`);
  await stranger.close();

  step(MIGRATE_STEP);
  await migrateStep({ root, env, old, auth, assert, ok });

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`);
  passed = true;
  console.log('\nE2E OK');
} catch (err) {
  console.error(`\nE2E FAILED: ${err.message}`);
  if (process.env.DEBUG) for (const s of servers) console.error(`\nwrangler (${s.name}) log:\n${s.log}`);
} finally {
  await browser?.close().catch(() => {});
  stopServers();
  await Promise.all(servers.map((s) => rm(s.dir, { recursive: true, force: true }).catch(() => {})));
  process.exit(passed ? 0 : 1);
}
