// Automated smoke test: launches Chromium with fake media devices, records the
// page's own tab for a few seconds, trims, exports, and checks the result.
// Run: npm run smoke   (from the spike folder)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const headless = process.env.HEADED !== '1';
const browser = await chromium.launch({
  headless,
  // Playwright normally disables Chrome's background throttling; keep it real for the BACKGROUND test.
  ignoreDefaultArgs: process.env.BACKGROUND === '1'
    ? ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
    : [],
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // SCREEN=1 captures the real monitor (like a user would) instead of the page's own tab.
    process.env.SCREEN === '1' ? '--auto-select-desktop-capture-source=Entire screen' : '--auto-select-tab-capture-source-by-title=Vignette spike',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (m) => { if (m.text().startsWith('[spike]')) console.log('  ' + m.text()); });
page.on('pageerror', (e) => console.error('  page error:', e.message));

const RECORD_SECONDS = Number(process.env.RECORD_SECONDS || 4);
let ok = false;
try {
  await page.goto(url);
  await page.click('#share');
  await page.waitForFunction(() => !document.getElementById('record').disabled, null, { timeout: 15000 });
  await page.click('#record');
  if (process.env.BACKGROUND === '1') {
    // Simulate the real use: the user switches to another tab/window while recording.
    const other = await context.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await other.waitForTimeout(RECORD_SECONDS * 1000);
    await page.bringToFront();
    await other.close();
  } else {
    await page.waitForTimeout(RECORD_SECONDS * 1000);
  }
  await page.click('#stop');
  await page.waitForSelector('#editSection:not([hidden])', { timeout: 30000 });

  const duration = await page.evaluate(() => window.__spike.state.duration);
  if (!(duration > RECORD_SECONDS - 1.5)) throw new Error(`parsed duration ${duration}s is too short`);

  // Trim 1 s off each end (start > 0 exercises the re-encode path).
  const result = await page.evaluate(async (d) => {
    const r = await window.__spike.exportTrim(1, Math.max(1.5, d - 1));
    return { size: r.size, type: r.type, ms: r.ms, findings: window.__spike.state.findings };
  }, duration);
  if (!(result.size > 10_000)) throw new Error(`exported file too small: ${result.size} bytes`);
  if (result.type !== 'video/mp4') throw new Error(`unexpected type ${result.type}`);

  // Check the exported file is a real, seekable MP4 by parsing it back in the page.
  const check = await page.evaluate(async () => {
    const mod = await import('./vendor/mediabunny-1.61.6.min.mjs');
    const r = await window.__spike.exportTrim(1, Math.max(1.5, window.__spike.state.duration - 1));
    const input = new mod.Input({ formats: mod.ALL_FORMATS, source: new mod.BlobSource(r.blob) });
    const track = await input.getPrimaryVideoTrack();
    // Brightness check: a black video means the canvas never received frames.
    const sink = new mod.CanvasSink(track, { width: 160 });
    const mid = await sink.getCanvas((await input.computeDuration()) / 2);
    const ctx = mid.canvas.getContext('2d');
    const px = ctx.getImageData(0, 0, mid.canvas.width, mid.canvas.height).data;
    let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    const meanBrightness = sum / (px.length / 4) / 3;
    return { duration: await input.computeDuration(), tracks: (await input.getTracks()).map((t) => t.type), size: `${track.displayWidth}x${track.displayHeight}`, meanBrightness: Math.round(meanBrightness) };
  });
  if (check.meanBrightness < 5) throw new Error('exported video is black (mean brightness ' + check.meanBrightness + ')');
  console.log('  exported MP4 parses back:', JSON.stringify(check));
  if (!(check.duration > 1)) throw new Error('exported MP4 has no duration');
  if (!check.tracks.includes('video')) throw new Error('exported MP4 has no video track');

  console.log('\nSMOKE OK');
  console.log(JSON.stringify(result.findings, null, 2));
  ok = true;
} catch (e) {
  console.error('\nSMOKE FAILED:', e.message);
} finally {
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
}
