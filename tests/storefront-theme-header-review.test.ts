import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRgb,
  isLightColor,
  getContrastTextColor,
} from '../src/lib/theme-contrast';

test('theme-contrast: parseRgb parses 3-digit hex, 6-digit hex, and rgb() strings', () => {
  assert.deepEqual(parseRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(parseRgb('#000'), [0, 0, 0]);
  assert.deepEqual(parseRgb('#10b981'), [16, 185, 129]);
  assert.deepEqual(parseRgb('10b981'), [16, 185, 129]);
  assert.deepEqual(parseRgb('rgb(255, 100, 50)'), [255, 100, 50]);
  assert.deepEqual(parseRgb('rgba(255, 100, 50, 0.8)'), [255, 100, 50]);
  assert.equal(parseRgb('invalid'), null);
  assert.equal(parseRgb(''), null);
  assert.equal(parseRgb(null), null);
});

test('theme-contrast: distinguishes light vs dark brand swatches accurately', () => {
  // Light swatches -> isLightColor must be true, contrast text must be dark
  const lightColors = [
    '#f59e0b', // Amber (L ~ 0.439)
    '#fde047', // Yellow
    '#ffffff', // White
    '#fff',
    '#a7f3d0', // Light mint
    '#fef08a', // Pastel yellow
    '#10b981', // Emerald
    '#8b5cf6', // Violet
    '#ef4444', // Red
    '#f43f5e', // Rose
    '#ec4899', // Pink
    '#0ea5e9', // Sky
  ];

  for (const hex of lightColors) {
    assert.equal(
      isLightColor(hex),
      true,
      `Expected ${hex} to be recognized as a light color`
    );
    assert.equal(
      getContrastTextColor(hex),
      '#0f172a',
      `Expected ${hex} to require dark text (#0f172a)`
    );
  }

  // Dark / saturated swatches -> isLightColor must be false, contrast text must be white
  const darkColors = [
    '#1e293b', // Slate luxury (L ~ 0.022)
    '#92400e', // Coffee brown (L ~ 0.098)
    '#000000', // Black
    '#000',
  ];

  for (const hex of darkColors) {
    assert.equal(
      isLightColor(hex),
      false,
      `Expected ${hex} to be recognized as a dark color`
    );
    assert.equal(
      getContrastTextColor(hex),
      '#ffffff',
      `Expected ${hex} to require white text (#ffffff)`
    );
  }
});

test('theme-contrast: fallback behavior for invalid or missing colors', () => {
  // Missing or invalid color defaults to emerald luminance.
  assert.equal(isLightColor(null), true);
  assert.equal(isLightColor(''), true);
  assert.equal(isLightColor('not-a-color'), true);
  assert.equal(getContrastTextColor(null), '#0f172a');
});
