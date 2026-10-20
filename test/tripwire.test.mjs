// Tests for .github/tripwire.sh in a throwaway Git repository.
// Run: node --test test/tripwire.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const tripwire = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'tripwire.sh');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: dir });
  git('init', '-q');
  mkdirSync(join(dir, '.github'));
  copyFileSync(tripwire, join(dir, '.github', 'tripwire.sh'));
  writeFileSync(join(dir, 'a.js'), 'const a = 1;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  const run = (...args) => spawnSync('bash', ['.github/tripwire.sh', ...args], { cwd: dir, encoding: 'utf8' });
  return { dir, git, run };
}

test('clean repository passes', () => {
  const { run } = repo();
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /tripwire: clean/);
});

// Strings below are built from pieces so this test file itself never trips the tripwire.
test('a personal path in a tracked file fails', () => {
  const { dir, git, run } = repo();
  writeFileSync(join(dir, 'notes.md'), 'see /Us' + 'ers/someone/secret.txt\n');
  git('add', '-A'); git('commit', '-q', '-m', 'oops');
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Personal paths/);
});

test('a home-relative path (tilde) in a tracked file fails on its own', () => {
  const { dir, git, run } = repo();
  writeFileSync(join(dir, 'notes.md'), 'see ~' + '/Documents/x\n');
  git('add', '-A'); git('commit', '-q', '-m', 'oops');
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Personal paths/);
});

test('a silenced check in lines added since the base fails', () => {
  const { dir, git, run } = repo();
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  writeFileSync(join(dir, 'b.test.js'), 'test.' + 'skip("later", () => {});\n');
  git('add', '-A'); git('commit', '-q', '-m', 'skip');
  const r = run(base);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /silence a check/);
});

test('a missing base ref fails instead of passing silently', () => {
  const { run } = repo();
  const r = run('origin/does-not-exist');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Base ref origin\/does-not-exist not found/);
});
