// Brings an existing Vignette database up to date, once per new version that changes it.
// Usage (from package.json scripts): node scripts/migrate.mjs --remote   (npm run db:migrate)
//                                    node scripts/migrate.mjs --local    (npm run db:migrate:local)
// Any further flags go to wrangler, for example --persist-to DIR for a throwaway local database.
//
// Each file in migrations/ holds ALTER TABLE ... ADD COLUMN statements. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so this reads the table's columns first and runs only the
// statements whose column is missing. Running it again, or on a database made from the
// current schema.sql (which already has every column), says "already applied" and changes
// nothing. Wrangler runs through scripts/wrangler.mjs, so the right config file is used.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const wrangler = fileURLToPath(new URL('./wrangler.mjs', import.meta.url));
const flags = process.argv.slice(2);
const fail = (message) => { console.error(message); process.exit(1); };
if (!flags.includes('--remote') && !flags.includes('--local')) fail('Say which database: --remote (on Cloudflare) or --local.');
const where = flags.includes('--remote') ? 'your Cloudflare database' : 'the local database';

// Runs SQL through wrangler and returns its JSON results, one entry per statement.
function d1(sql) {
  const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'vignette', ...flags, '--json', '--command', sql], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* not JSON: wrangler printed an error instead */ }
  if (r.status !== 0 || !Array.isArray(out)) fail(`Wrangler could not run the migration on ${where}:\n${out?.error?.text || r.stdout + r.stderr}`);
  return out;
}

// "ALTER TABLE videos ADD COLUMN has_raw INTEGER ..." gives {table: 'videos', column: 'has_raw', sql}.
function statements(file) {
  const text = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  return text.split(';').map((s) => s.trim()).filter(Boolean).map((sql) => {
    const m = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\b/i.exec(sql);
    if (!m) fail(`${file}: only ALTER TABLE ... ADD COLUMN statements are supported here, found: ${sql.slice(0, 60)}`);
    return { table: m[1], column: m[2], sql };
  });
}

const files = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
const columns = new Map(); // table name to its column names
for (const file of files) {
  const name = file.replace(/\.sql$/, '');
  const todo = [];
  for (const s of statements(file)) {
    if (!columns.has(s.table)) columns.set(s.table, new Set(d1(`PRAGMA table_info(${s.table})`)[0].results.map((c) => c.name)));
    const have = columns.get(s.table);
    if (have.size === 0) fail(`The ${s.table} table does not exist in ${where} yet. Run npm run db:init${flags.includes('--local') ? ':local' : ''} first: it creates the table with every column, so no migration is needed after it.`);
    if (!have.has(s.column)) todo.push(s);
  }
  if (!todo.length) {
    console.log(`${name}: already applied to ${where}, nothing to change.`);
    continue;
  }
  d1(todo.map((s) => s.sql).join(';\n'));
  for (const s of todo) columns.get(s.table).add(s.column);
  console.log(`${name}: applied to ${where}, added ${todo.map((s) => `${s.table}.${s.column}`).join(', ')}.`);
}
