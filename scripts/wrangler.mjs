// Runs the pinned wrangler from node_modules with the right config file.
// Usage (from package.json scripts): node scripts/wrangler.mjs deploy
//                                    node scripts/wrangler.mjs d1 execute vignette --remote --file=schema.sql
// If an ignored wrangler.local.toml exists next to wrangler.toml, it is used instead, so a maintainer
// can keep a real database id out of Git while the committed file ships with the placeholder that the
// README tells users to replace. Runs node directly (no npx, no shell), so it works the same on Windows.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The pinned install from package-lock.json, run directly (no npx, no shell).
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!existsSync(wrangler)) { console.error('wrangler is not installed: run npm install first'); process.exit(1); }
const args = process.argv.slice(2);
if (existsSync('wrangler.local.toml')) args.push('--config', 'wrangler.local.toml');
const r = spawnSync(process.execPath, [wrangler, ...args], { stdio: 'inherit' });
if (r.error) { console.error(`Could not start wrangler: ${r.error.message}`); process.exit(1); }
process.exit(r.status ?? 1);
