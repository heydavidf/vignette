// The end-to-end suite's harness (used by e2e.mjs and its steps): the
// wrangler dev servers with throwaway databases on free ports, the init
// script every recorder page runs, logging in, recording, and small API
// helpers. Servers started here are stopped when the process exits.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OLD_SCHEMA } from './migrate-step.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
// Non-Latin-1 on purpose: HTTP headers cannot carry it raw, so this checks the encoding.
export const PASSWORD = 'dev-ö-🎬';
export const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
export const auth = { authorization: `Bearer ${encodeURIComponent(PASSWORD)}` };

export function assert(condition, message) { if (!condition) throw new Error(message); }
export function step(name) { console.log(`\n${name}`); }
export function ok(message) { console.log(`  ok  ${message}`); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function runWrangler(args, bin = wranglerBin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} failed:\n${out}`))));
  });
}

// ---------- Servers ----------
export const servers = [];
// db: 'current' (schema.sql, then the update, which finds nothing to do), 'v0.1' (the old table), or none.
export async function startServer(name, password, db) {
  const dir = await mkdtemp(join(tmpdir(), `vignette-e2e-${name}-`));
  const local = ['--local', '--persist-to', dir, '--config', 'wrangler.toml']; // the same database wrangler dev below uses
  if (db === 'current') {
    await runWrangler(['d1', 'execute', 'vignette', ...local, '--file=schema.sql']);
    const out = await runWrangler(local, join(root, 'scripts', 'migrate.mjs'));
    if (!/already applied/.test(out)) throw new Error(`the update on a new database did something:\n${out}`);
  }
  if (db === 'v0.1') await runWrangler(['d1', 'execute', 'vignette', ...local, '--command', OLD_SCHEMA]);
  const port = await freePort();
  const inspector = await freePort();
  const server = { name, dir, base: `http://127.0.0.1:${port}`, log: '' };
  // --var wins over .dev.vars, so the test does not depend on local config.
  server.child = spawn(process.execPath, [
    wranglerBin, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector),
    '--persist-to', dir, '--var', `VIGNETTE_PASSWORD:${password}`, '--show-interactive-dev-session=false',
  ], { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.child.stdout.on('data', (d) => { server.log += d; });
  server.child.stderr.on('data', (d) => { server.log += d; });
  servers.push(server);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) throw new Error(`wrangler dev (${name}) exited early:\n${server.log}`);
    try { if ((await fetch(`${server.base}/`)).ok) return server; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`wrangler dev (${name}) did not start:\n${server.log}`);
}

export function stopServers() {
  for (const { child } of servers) {
    if (child.exitCode !== null) continue;
    // wrangler starts workerd as a child, so kill the whole process group.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  }
}
process.on('exit', stopServers);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// Runs in every recorder page before its own scripts.
export function pageHooks() {
  // Playwright's Chromium never marks a page hidden (checked: a background
  // tab, a minimised window and headed mode all stay "visible" with full-speed
  // timers). So while __inBackground is set, this simulates what Chrome does
  // to a hidden tab: page timers run at most once a second.
  const realInterval = window.setInterval;
  const realTimeout = window.setTimeout;
  window.setInterval = (fn, ms, ...args) => {
    let last = 0;
    return realInterval(() => {
      if (window.__inBackground) { const now = performance.now(); if (now - last < 1000) return; last = now; }
      fn(...args);
    }, ms);
  };
  window.setTimeout = (fn, ms, ...args) => realTimeout(fn, window.__inBackground ? Math.max(ms || 0, 1000) : ms, ...args);
  // Lets a step cancel the next screen picker, as a user pressing Cancel would.
  const md = navigator.mediaDevices;
  if (md?.getDisplayMedia) {
    const real = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = (c) => {
      if (!window.__cancelNextShare) return real(c);
      window.__cancelNextShare = false;
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
}

export async function login(page, base, password = PASSWORD) {
  await page.goto(`${base}/`);
  await page.waitForSelector('#gate:not([hidden])');
  await page.fill('#password', password);
  await page.click('#gate button[type=submit]');
}

// Returns how long the page says it recorded, from Start to Stop. (Switching
// tabs takes time too, so this can run a little over `seconds` on a busy machine.)
export async function record(page, seconds, whileRecording = () => page.waitForTimeout(seconds * 1000)) {
  await page.click('#share');
  await page.waitForSelector('#recordStep:not([hidden])', { timeout: 15_000 });
  await page.click('#start'); // a 3-2-1 countdown runs first
  await page.waitForFunction(() => window.__vignette.state.phase === 'recording', null, { timeout: 10_000 });
  await whileRecording();
  await page.click('#stop');
  await page.waitForSelector('#editBody:not([hidden])', { timeout: 60_000 });
  return page.evaluate(() => (window.__vignette.state.stoppedAt - window.__vignette.state.startedAt) / 1000);
}

export async function listVideos(base) {
  const res = await fetch(`${base}/api/videos`, { headers: auth });
  assert(res.status === 200, `GET /api/videos gave ${res.status}`);
  return (await res.json()).videos;
}

export const api = (base, path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...auth, ...init.headers } });
export const create = (base, size) => api(base, '/api/videos', { method: 'POST', body: JSON.stringify({ title: 'probe', duration: 1, size }) }).then((r) => r.json());
