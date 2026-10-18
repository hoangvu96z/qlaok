import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('theme preferences survive unavailable storage and the managed-table confirmation component renders', () => {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types',
    '--import', './tests/register-ts.mjs',
    '--import', './tests/tsx-review-loader.mjs',
    path.resolve('tests/theme-modal-qa.mjs'),
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
  assert.match(output, /PASS: inaccessible localStorage getter/);
  assert.match(output, /PASS: actual confirmation component server-rendered/);
});
