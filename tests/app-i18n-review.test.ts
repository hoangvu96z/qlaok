import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_DICTIONARY,
  APP_LOCALES,
  APP_LOCALE_CHANGE_EVENT,
  APP_LOCALE_STORAGE_KEY,
  DEFAULT_APP_LOCALE,
  bilingualText,
  formatChimeSummaryLabel,
  formatNotificationToggleLabel,
  getStoredAppLocale,
  humanizeTranslationKey,
  interpolateAppTemplate,
  normalizeAppLocale,
  setStoredAppLocale,
  translateApp,
} from '@/lib/app-i18n';

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return [...new Set(matches)].sort();
}

test('APP_DICTIONARY has strict VI/EN key parity, non-empty values, and no PWA/Native/Realtime jargon', () => {
  assert.deepEqual(APP_LOCALES, ['vi', 'en']);
  assert.equal(DEFAULT_APP_LOCALE, 'vi');

  const viKeys = Object.keys(APP_DICTIONARY.vi).sort();
  const enKeys = Object.keys(APP_DICTIONARY.en).sort();

  assert.deepEqual(viKeys, enKeys, 'VI and EN dictionaries must have identical keys');

  const forbiddenJargon = /\b(PWA|Native|Realtime)\b/i;

  for (const key of viKeys) {
    const viVal = APP_DICTIONARY.vi[key as keyof typeof APP_DICTIONARY.vi];
    const enVal = APP_DICTIONARY.en[key as keyof typeof APP_DICTIONARY.en];

    assert.equal(typeof viVal, 'string', `VI value for ${key} must be string`);
    assert.equal(typeof enVal, 'string', `EN value for ${key} must be string`);
    assert.ok(viVal.trim().length > 0, `VI value for ${key} must not be empty`);
    assert.ok(enVal.trim().length > 0, `EN value for ${key} must not be empty`);

    assert.equal(
      forbiddenJargon.test(viVal),
      false,
      `VI value for "${key}" must not contain PWA/Native/Realtime jargon: "${viVal}"`
    );
    assert.equal(
      forbiddenJargon.test(enVal),
      false,
      `EN value for "${key}" must not contain PWA/Native/Realtime jargon: "${enVal}"`
    );
  }
});

test('APP_DICTIONARY preserves identical interpolation placeholders across VI and EN and interpolates values accurately', () => {
  const viKeys = Object.keys(APP_DICTIONARY.vi) as Array<
    keyof typeof APP_DICTIONARY.vi
  >;

  for (const key of viKeys) {
    const viPlaceholders = extractPlaceholders(APP_DICTIONARY.vi[key]);
    const enPlaceholders = extractPlaceholders(APP_DICTIONARY.en[key]);
    assert.deepEqual(
      viPlaceholders,
      enPlaceholders,
      `Placeholder mismatch for key "${key}": VI=${viPlaceholders.join(',')} vs EN=${enPlaceholders.join(',')}`
    );
  }

  assert.equal(
    interpolateAppTemplate('Xin chào {name}, bàn {table} có {count} món', {
      name: 'Lan',
      table: 5,
      count: 3,
    }),
    'Xin chào Lan, bàn 5 có 3 món'
  );

  assert.equal(
    interpolateAppTemplate('Ghi chú: {note} | Giữ nguyên: {missing}', {
      note: null,
    }),
    'Ghi chú:  | Giữ nguyên: {missing}'
  );

  assert.equal(
    translateApp('vi', 'orders.tabQueue', { count: 12 }),
    'Đơn bàn & quầy (12)'
  );
  assert.equal(
    translateApp('en', 'orders.tabQueue', { count: 12 }),
    'Orders (12)'
  );
  assert.equal(
    translateApp('vi', 'receipt.modalTitle', { size: '80mm' }),
    'Phiếu in nhiệt (80mm)'
  );
  assert.equal(
    translateApp('en', 'receipt.modalTitle', { size: '58mm' }),
    'Thermal Receipt (58mm)'
  );
});

test('normalizeAppLocale, translateApp, humanizeTranslationKey, and bilingualText (tx) handle fallbacks cleanly', () => {
  assert.equal(normalizeAppLocale('en'), 'en');
  assert.equal(normalizeAppLocale('EN-US'), 'en');
  assert.equal(normalizeAppLocale('en_GB'), 'en');
  assert.equal(normalizeAppLocale('vi'), 'vi');
  assert.equal(normalizeAppLocale('vi-VN'), 'vi');
  assert.equal(normalizeAppLocale('ko'), 'vi');
  assert.equal(normalizeAppLocale(''), 'vi');
  assert.equal(normalizeAppLocale(null), 'vi');
  assert.equal(normalizeAppLocale(undefined), 'vi');

  // Unknown key falls back to humanized label instead of raw dotted key
  assert.equal(humanizeTranslationKey('orders.customActionLabel'), 'Custom Action Label');
  assert.equal(translateApp('en', 'orders.unknownKeyFallback'), 'Unknown Key Fallback');
  assert.equal(translateApp('vi', ''), '');

  // bilingualText (tx) selects active locale, falls back when one side is empty, and interpolates params
  assert.equal(
    bilingualText('vi', 'Bàn #{num}', 'Table #{num}', { num: '04' }),
    'Bàn #04'
  );
  assert.equal(
    bilingualText('en', 'Bàn #{num}', 'Table #{num}', { num: '04' }),
    'Table #04'
  );
  assert.equal(
    bilingualText('en', 'Chỉ có tiếng Việt {n}', '', { n: 1 }),
    'Chỉ có tiếng Việt 1'
  );
  assert.equal(
    bilingualText('vi', '', 'English fallback {n}', { n: 2 }),
    'English fallback 2'
  );
});

test('getStoredAppLocale and setStoredAppLocale persist locale, isolate from storefront qlaok_lang, and survive storage failures', () => {
  const store = new Map<string, string>();
  store.set('qlaok_lang', 'ja'); // Storefront 8-language key must remain untouched

  const mockStorage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };

  assert.equal(getStoredAppLocale(mockStorage), 'vi');

  const persistedEn = setStoredAppLocale('en', mockStorage);
  assert.equal(persistedEn, 'en');
  assert.equal(store.get(APP_LOCALE_STORAGE_KEY), 'en');
  assert.equal(getStoredAppLocale(mockStorage), 'en');
  assert.equal(
    store.get('qlaok_lang'),
    'ja',
    'Switching app locale must not mutate storefront qlaok_lang'
  );

  // Storage throwing SecurityError / QuotaExceededError must not crash getStoredAppLocale or setStoredAppLocale
  const throwingStorage = {
    getItem(): string | null {
      throw new Error('SecurityError: localStorage disabled');
    },
    setItem(): void {
      throw new Error('QuotaExceededError: storage full');
    },
  };

  assert.equal(getStoredAppLocale(throwingStorage), 'vi');
  assert.equal(setStoredAppLocale('en', throwingStorage), 'en');
  assert.equal(getStoredAppLocale(null), 'vi');
  assert.equal(setStoredAppLocale('en-US', null), 'en');
  assert.ok(APP_LOCALE_CHANGE_EVENT.length > 0);
});

test('summary label helpers return concise localized labels for chime and desktop notifications', () => {
  // Chime summary labels (volume & volumePreset variants)
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volumePreset: 'max_boost' }, 'vi'),
    'Chuông: Siêu to'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volumePreset: 'max_boost' }, 'en'),
    'Chime: Max'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volume: 'boost' }, 'vi'),
    'Chuông: Siêu to'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volume: 'loud' }, 'vi'),
    'Chuông: To'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volume: 'loud' }, 'en'),
    'Chime: Loud'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volumePreset: 'normal' }, 'vi'),
    'Chuông: Vừa'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: true, volumePreset: 'normal' }, 'en'),
    'Chime: Normal'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: false, volumePreset: 'max_boost' }, 'vi'),
    'Chuông: Tắt'
  );
  assert.equal(
    formatChimeSummaryLabel({ enabled: false, volumePreset: 'max_boost' }, 'en'),
    'Chime: Off'
  );

  // Desktop notification toggle labels
  assert.equal(formatNotificationToggleLabel('default', 'vi'), 'Bật TB');
  assert.equal(formatNotificationToggleLabel('denied', 'vi'), 'Bật TB');
  assert.equal(formatNotificationToggleLabel('granted', 'vi'), 'TB: Bật');
  assert.equal(formatNotificationToggleLabel('default', 'en'), 'Alerts');
  assert.equal(formatNotificationToggleLabel('granted', 'en'), 'Alerts: On');
});

