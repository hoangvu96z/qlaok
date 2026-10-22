import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('ShopTableFloorPlanCanvas renders presentational markers, fallback positions, legend counts, and accessible status states', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './tests/register-ts.mjs',
      '--import',
      './tests/tsx-review-loader.mjs',
      path.resolve('tests/floor-plan-canvas-qa.mjs'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
    }
  );

  assert.match(output, /PASS: isValidCoordinate boundary and type validation/);
  assert.match(output, /PASS: deterministic fallback positioning and bounds clamping/);
  assert.match(output, /PASS: fallback edge cases \(single table center, empty list\)/);
  assert.match(output, /PASS: empty state rendering in VI and EN/);
  assert.match(
    output,
    /PASS: comprehensive VI rendering with legend counts, metrics, and selection/
  );
  assert.match(
    output,
    /PASS: English localization and dark theme classes verified/
  );
  assert.match(
    output,
    /PASS: SVG pattern IDs unique per component instance/
  );
  assert.match(
    output,
    /PASS: post-drag click suppression guard immediate consumption, detail 0 bypass, and prompt expiration/
  );
  assert.match(
    output,
    /PASS: selected occupied marker preserves status border class and emerald selection ring/
  );
  assert.match(
    output,
    /PASS: responsive canvas bounds helper and mobile clipping QA coverage/
  );
});
