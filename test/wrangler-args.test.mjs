// Tests for the config decision in scripts/wrangler.mjs: an ignored wrangler.local.toml is added unless
// the command already names a config, in any of wrangler's four spellings.
// Run: node --test test/wrangler-args.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglerArgs } from '../scripts/wrangler.mjs';

const base = ['d1', 'execute', 'vignette', '--local'];

test('no config flag and a local file: adds --config wrangler.local.toml', () => {
  assert.deepEqual(wranglerArgs(base, true), [...base, '--config', 'wrangler.local.toml']);
});

test('no config flag and no local file: adds nothing', () => {
  assert.deepEqual(wranglerArgs(base, false), base);
});

for (const chosen of [['--config', 'x.toml'], ['--config=x.toml'], ['-c', 'x.toml'], ['-c=x.toml']]) {
  test(`${chosen.join(' ')} with a local file: leaves the arguments untouched`, () => {
    const args = [...base, ...chosen];
    assert.deepEqual(wranglerArgs(args, true), args);
  });
}

test('does not change the list it was given', () => {
  const args = [...base];
  wranglerArgs(args, true);
  assert.deepEqual(args, base);
});
