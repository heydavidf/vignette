// Runs the pinned wrangler from node_modules with the right config file.
// Usage (from package.json scripts): node scripts/wrangler.mjs deploy
//                                    node scripts/wrangler.mjs d1 execute vignette --remote --file=schema.sql
// If an ignored wrangler.local.toml exists next to wrangler.toml, it is used instead, so a maintainer
// can keep a real database id out of Git while the committed file ships with the placeholder that the
// README tells users to replace. A --config given on the command line wins (the test suite uses it to
// reach the same throwaway database as its own wrangler dev). Runs node directly (no npx, no shell), so it
// works the same on Windows. test/wrangler-args.test.mjs tests the config decision.
import { existsSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The arguments to give wrangler: `args` as typed, plus --config wrangler.local.toml when that file
// exists (hasLocal) and no config was chosen with --config x, --config=x, -c x or -c=x.
export function wranglerArgs(args, hasLocal) {
  const chosen = args.some((a) => a === '--config' || a === '-c' || a.startsWith('--config=') || a.startsWith('-c='));
  return !chosen && hasLocal ? [...args, '--config', 'wrangler.local.toml'] : [...args];
}

// Only when run as a script, so the test can import wranglerArgs without starting wrangler.
// Real paths on both sides, so a symlinked checkout (macOS /tmp is one) still runs.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The pinned install from package-lock.json, run directly (no npx, no shell).
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  if (!existsSync(wrangler)) { console.error('wrangler is not installed: run npm install first'); process.exit(1); }
  const r = spawnSync(process.execPath, [wrangler, ...wranglerArgs(process.argv.slice(2), existsSync('wrangler.local.toml'))], { stdio: 'inherit' });
  if (r.error) { console.error(`Could not start wrangler: ${r.error.message}`); process.exit(1); }
  process.exit(r.status ?? 1);
}
