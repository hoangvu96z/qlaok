import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRgb,
  getHexLuminance,
  isLightColor,
  getContrastTextColor,
  getAccessibleAccentTextColor,
  getContrastRatio,
} from '../src/lib/theme-contrast';

const storefrontDoorPageSource = readFileSync(
  new URL('../src/app/(storefront)/s/[slug]/page.tsx', import.meta.url),
  'utf8'
);
const storefrontMenuPageSource = readFileSync(
  new URL('../src/app/(storefront)/s/[slug]/menu/page.tsx', import.meta.url),
  'utf8'
);
const storefrontCustomDecorSource = readFileSync(
  new URL('../src/components/storefront/StorefrontCustomDecor.tsx', import.meta.url),
  'utf8'
);

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

test('theme-contrast: chooses the stronger readable foreground for varied shop colors', () => {
  for (const color of ['#f43f5e', '#ef4444', '#10b981', '#8b5cf6', '#fde047', '#ffffff', '#000000', '#654321', '#767776', '#777777']) {
    const bg = getHexLuminance(color);
    const fg = getHexLuminance(getContrastTextColor(color));
    const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    assert.ok(ratio >= 4.5, `${color}: contrast ${ratio.toFixed(2)} is below 4.5`);
  }
});

test('theme-contrast: every grayscale background keeps an AA black/white endpoint', () => {
  for (let channel = 0; channel <= 255; channel += 1) {
    const value = channel.toString(16).padStart(2, '0');
    const color = `#${value}${value}${value}`;
    const foreground = getContrastTextColor(color);
    assert.ok(
      getContrastRatio(foreground, color) >= 4.5,
      `${color} with ${foreground} is below WCAG AA`
    );
  }
  assert.equal(getContrastTextColor('#767776'), '#000000');
  assert.ok(getContrastRatio('#000000', '#767776') >= 4.5);
});

test('theme-contrast: adjusts accent text dynamically to meet surface contrast', () => {
  const emeraldText = getAccessibleAccentTextColor('#10b981');
  assert.notEqual(emeraldText, '#10b981');
  assert.ok(getContrastRatio(emeraldText, '#ffffff') >= 4.5);
  assert.equal(getAccessibleAccentTextColor('#064e3b'), '#064e3b');

  const redText = getAccessibleAccentTextColor('#ef4444');
  assert.notEqual(redText, '#ef4444');
  assert.ok(getContrastRatio(redText, '#ffffff') >= 4.5);

  const textOnDarkSurface = getAccessibleAccentTextColor('#10b981', '#020617');
  assert.ok(getContrastRatio(textOnDarkSurface, '#020617') >= 4.5);
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
      '#000000',
      `Expected ${hex} to require dark text (#000000)`
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

test('theme-contrast: the screenshot red uses the strongest readable endpoint', () => {
  assert.equal(getContrastTextColor('#f52853'), '#000000');
  assert.ok(getContrastRatio('#000000', '#f52853') >= 4.5);
  assert.ok(getContrastRatio('#ffffff', '#f52853') < 4.5);
});

test('theme-contrast: fallback behavior for invalid or missing colors', () => {
  // Missing or invalid color defaults to emerald luminance.
  assert.equal(isLightColor(null), true);
  assert.equal(isLightColor(''), true);
  assert.equal(isLightColor('not-a-color'), true);
  assert.equal(getContrastTextColor(null), '#000000');
});

test('storefront menu primary header renders the same black endpoint as the contrast helper', () => {
  assert.match(storefrontMenuPageSource, /border-black\/10 text-black/);
  assert.equal(
    (storefrontMenuPageSource.match(/isLightPrimary\s*\?\s*'text-black'\s*:\s*'text-white'/g) || [])
      .length,
    6,
    'shop name, back link, table labels and table hints must use the selected primary contrast endpoint'
  );
  assert.doesNotMatch(
    storefrontMenuPageSource,
    /isLightPrimary\s*\?\s*'text-slate-950'\s*:\s*'text-white'/
  );
});

test('storefront door primary-color surfaces use a computed readable foreground', () => {
  assert.match(storefrontDoorPageSource, /getContrastTextColor\(primaryColor\)/);
  assert.equal(
    (storefrontDoorPageSource.match(
      /backgroundColor: primaryColor, color: primaryTextColor/g
    ) || []).length,
    4,
    'logo badges and both menu CTAs must use the foreground computed for the selected shop color'
  );
  assert.doesNotMatch(
    storefrontDoorPageSource,
    /text-white(?:\/\d+)?[^\n]*\n\s*style=\{\{ backgroundColor: primaryColor/
  );
});

test('storefront popup CTA and settings preview use computed text on primary-color surfaces', () => {
  const popupStart = storefrontCustomDecorSource.indexOf(
    'export function StorefrontWelcomePopup'
  );
  const previewStart = storefrontCustomDecorSource.indexOf(
    'export function StorefrontPhonePreview'
  );
  assert.ok(popupStart >= 0);
  assert.ok(previewStart > popupStart);

  const popupSource = storefrontCustomDecorSource.slice(popupStart, previewStart);
  const previewSource = storefrontCustomDecorSource.slice(previewStart);
  assert.match(popupSource, /getContrastTextColor\(primaryColor\)/);
  assert.match(
    popupSource,
    /backgroundColor: primaryColor, color: primaryTextColor/
  );
  assert.doesNotMatch(
    popupSource,
    /backgroundColor: primaryColor, color: '#ffffff'/
  );

  assert.match(previewSource, /getContrastTextColor\(primaryColor\)/);
  assert.ok(
    (previewSource.match(/backgroundColor:\s*primaryColor,\s*color:\s*primaryTextColor/g) || [])
      .length >= 8,
    'brand badge, selected language, door CTA, Wi-Fi action, category, quick-add buttons, and order bar should use the computed foreground'
  );
  assert.doesNotMatch(
    previewSource,
    /backgroundColor:\s*primaryColor,\s*color:\s*'#ffffff'/
  );
  assert.doesNotMatch(
    previewSource,
    /style=\{\{\s*backgroundColor:\s*primaryColor\s*\}\}/
  );
  assert.match(previewSource, /getAccessibleAccentTextColors\(primaryColor\)/);
  assert.equal(
    (previewSource.match(/style=\{\{ color: accentTextColor \}\}/g) || []).length,
    2,
    'both preview layouts should adjust price text for the card surface'
  );
});
