import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageSwitcher } from '../src/components/storefront/LanguageSwitcher';
import { UI_LABELS } from '../src/lib/i18n-helper';
import type { SupportedLocale } from '../src/types/qlaok';

test('LanguageSwitcher compact trigger exposes aria-expanded="false" accessibly on initial render', () => {
  const html = renderToStaticMarkup(
    React.createElement(LanguageSwitcher, {
      currentLocale: 'vi',
      compact: true,
      onChange: () => {},
    })
  );

  // Trigger button exists and explicitly declares collapsed state
  assert.match(
    html,
    /<button[^>]*aria-expanded="false"[^>]*>/,
    'Compact trigger button must expose aria-expanded="false" when collapsed'
  );

  // Trigger button retains accessible label
  const viLabels = UI_LABELS.vi;
  assert.ok(
    html.includes(`aria-label="${viLabels.selectLanguageAria}"`),
    'Compact trigger button must preserve localized aria-label'
  );

  // Dropdown content is not rendered when the control is collapsed
  assert.equal(
    html.includes(viLabels.languagesCount(8)),
    false,
    'Dropdown language counter must not be rendered when collapsed'
  );
});

test('LanguageSwitcher compact trigger preserves accessible aria-expanded across different locales', () => {
  const testLocales: SupportedLocale[] = ['en', 'ko', 'ja'];

  for (const locale of testLocales) {
    const html = renderToStaticMarkup(
      React.createElement(LanguageSwitcher, {
        currentLocale: locale,
        compact: true,
        onChange: () => {},
      })
    );

    const labels = UI_LABELS[locale] || UI_LABELS.vi;
    assert.match(
      html,
      /<button[^>]*aria-expanded="false"[^>]*>/,
      `Compact trigger button for locale "${locale}" must expose aria-expanded="false"`
    );
    assert.ok(
      html.includes(`aria-label="${labels.selectLanguageAria}"`),
      `Compact trigger button for locale "${locale}" must preserve localized aria-label`
    );
  }
});

test('LanguageSwitcher noncompact mode renders role="group" and does not include aria-expanded trigger', () => {
  const html = renderToStaticMarkup(
    React.createElement(LanguageSwitcher, {
      currentLocale: 'vi',
      compact: false,
      onChange: () => {},
    })
  );

  // Noncompact layout uses role="group"
  assert.ok(
    html.includes('role="group"'),
    'Noncompact LanguageSwitcher must render a container with role="group"'
  );

  // Noncompact layout contains direct locale buttons and no aria-expanded trigger
  assert.equal(
    html.includes('aria-expanded'),
    false,
    'Noncompact LanguageSwitcher must not render aria-expanded trigger button'
  );
});
