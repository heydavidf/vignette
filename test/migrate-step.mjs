// Step 12 of the end-to-end suite (run from e2e.mjs): the database update
// for 0.2 (migrations/0002-two-tracks.sql, applied by scripts/migrate.mjs).
// A database made from the current schema.sql needs nothing; a 0.1 database
// gets the new columns once and keeps its rows; a server still on a 0.1
// database keeps its share links working and tells the owner what to run.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MIGRATE_STEP = '12. Database update: a new database needs none, a 0.1 one gets the columns once, a server on a 0.1 one says what to run';

// The table as Vignette 0.1 made it, with one finished video in it.
export const OLD_SCHEMA = `CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT NOT NULL, duration REAL NOT NULL,
  size INTEGER NOT NULL, mime TEXT NOT NULL, width INTEGER, height INTEGER, status TEXT NOT NULL DEFAULT 'uploading',
  upload_id TEXT, created_at INTEGER NOT NULL);
INSERT INTO videos (id, title, duration, size, mime, width, height, status, upload_id, created_at)
  VALUES ('oldoldoldoldold1', 'Made with 0.1', 5, 1000, 'video/mp4', 1280, 720, 'ready', NULL, 1760000000000);`;
const NEW_COLUMNS = ['camera_offset', 'has_raw', 'layout', 'bubble', 'raw_screen', 'raw_camera'];
const MiB = 1024 * 1024;

// Multipart uploads in a wrangler dev server's local R2 (miniflare keeps them in SQLite under the persist
// directory; state 0 is in progress, 1 completed, 2 aborted), counted by state.
async function multipartStates(dir) {
  const { DatabaseSync } = await import('node:sqlite');
  const r2 = join(dir, 'v3', 'r2');
  const files = (await readdir(r2, { recursive: true }).catch(() => [])).filter((f) => f.endsWith('.sqlite'));
  const states = { open: 0, completed: 0, aborted: 0 };
  for (const f of files) {
    const db = new DatabaseSync(join(r2, f), { readOnly: true });
    try {
      const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_mf_multipart_uploads'").get();
      if (has) for (const { state, n } of db.prepare('SELECT state, count(*) AS n FROM _mf_multipart_uploads GROUP BY state').all()) states[['open', 'completed', 'aborted'][state]] += n;
    } finally { db.close(); }
  }
  return states;
}

export async function migrateStep({ root, env, old, auth, assert, ok }) {
  // Runs a command in the repository, as a person would type it; resolves to {code, out}.
  const run = (cmd, args) => new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = spawn(cmd === 'npm' && win ? 'npm.cmd' : cmd, args, { cwd: root, env, shell: win, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code, out }));
  });
  const npm = (script, dir) => run('npm', ['run', script, '--', '--persist-to', dir]);
  const columns = async (dir) => {
    const r = await run(process.execPath, ['scripts/wrangler.mjs', 'd1', 'execute', 'vignette', '--local', '--persist-to', dir, '--json', '--command', 'PRAGMA table_info(videos)']);
    return JSON.parse(r.out)[0].results.map((c) => c.name);
  };
  const dirs = [];
  try {
    // A new install: db:init makes every column, so the update has nothing to do, twice.
    const fresh = await mkdtemp(join(tmpdir(), 'vignette-e2e-fresh-'));
    dirs.push(fresh);
    const init = await npm('db:init:local', fresh);
    assert(init.code === 0, `npm run db:init:local failed:\n${init.out}`);
    for (let i = 0; i < 2; i++) {
      const m = await npm('db:migrate:local', fresh);
      assert(m.code === 0 && /0002-two-tracks: already applied/.test(m.out), `db:migrate:local on a new database (run ${i + 1}):\n${m.out}`);
    }
    // A 0.1 database: the first run adds the columns, the second says it is done; the old row keeps its data.
    const v01 = await mkdtemp(join(tmpdir(), 'vignette-e2e-v01-'));
    dirs.push(v01);
    const made = await run(process.execPath, ['scripts/wrangler.mjs', 'd1', 'execute', 'vignette', '--local', '--persist-to', v01, '--command', OLD_SCHEMA]);
    assert(made.code === 0, `could not make a 0.1 database:\n${made.out}`);
    const first = await npm('db:migrate:local', v01);
    assert(first.code === 0 && /0002-two-tracks: applied .*added videos\.camera_offset, videos\.has_raw/.test(first.out), `first db:migrate:local on a 0.1 database:\n${first.out}`);
    const again = await npm('db:migrate:local', v01);
    assert(again.code === 0 && /already applied/.test(again.out), `second db:migrate:local on a 0.1 database:\n${again.out}`);
    const cols = await columns(v01);
    assert(NEW_COLUMNS.every((c) => cols.includes(c)), `after the update the table has ${cols.join(', ')}`);
    // No table at all: it says to run db:init instead, and fails.
    const empty = await mkdtemp(join(tmpdir(), 'vignette-e2e-empty-'));
    dirs.push(empty);
    const none = await npm('db:migrate:local', empty);
    assert(none.code !== 0 && /Run npm run db:init:local first/.test(none.out), `db:migrate:local with no table:\n${none.out}`);

    // A server still on a 0.1 database: links work, the owner API says what to run, and the update fixes it live.
    const share = await fetch(`${old.base}/v/oldoldoldoldold1`);
    assert(share.status === 200 && (await share.text()).includes('Made with 0.1'), `a 0.1 share page gave ${share.status}`);
    const list = await fetch(`${old.base}/api/videos`, { headers: auth });
    const listBody = await list.json();
    assert(list.status === 500 && /Run: npm run db:migrate$/.test(listBody.error), `the list on a 0.1 database gave ${list.status} ${JSON.stringify(listBody)}`);
    // A create big enough for parts: the video and both originals each open a multipart upload in R2 before
    // the row insert fails. None may stay open (they would keep their parts until aborted).
    const before = await multipartStates(old.dir);
    const create = await fetch(`${old.base}/api/videos`, {
      method: 'POST', headers: auth, body: JSON.stringify({ title: 'x', duration: 1, size: 45 * MiB, raw: { screen: 30 * MiB, camera: 25 * MiB } }),
    });
    const createBody = await create.json();
    assert(create.status === 500 && /npm run db:migrate/.test(createBody.error), `a create on a 0.1 database gave ${create.status} ${JSON.stringify(createBody)}`);
    const states = await multipartStates(old.dir);
    assert(states.open === before.open && states.aborted === before.aborted + 3, `after the failed create R2 has multipart uploads ${JSON.stringify(states)} (before ${JSON.stringify(before)})`);
    // The test server reads wrangler.toml, so the update is pointed at the same file.
    const live = await run(process.execPath, ['scripts/migrate.mjs', '--local', '--persist-to', old.dir, '--config', 'wrangler.toml']);
    assert(live.code === 0 && /applied/.test(live.out), `the update on the running 0.1 server's database:\n${live.out}`);
    const after = await fetch(`${old.base}/api/videos`, { headers: auth });
    const rows = (await after.json()).videos;
    assert(after.status === 200 && rows?.[0]?.id === 'oldoldoldoldold1' && rows[0].has_raw === 0, `after the update the list gave ${after.status} ${JSON.stringify(rows)}`);
    ok('db:init:local then db:migrate:local (twice) says "already applied"; a 0.1 database gets the six columns once and keeps its row; '
      + 'no table says to run db:init:local; a server on 0.1 serves its link and answers "Run: npm run db:migrate" until the update (aborting the 3 multipart uploads its failed create opened), then lists');
  } finally {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
  }
}
