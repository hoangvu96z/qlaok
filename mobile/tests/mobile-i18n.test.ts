import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bilingualMobileText,
  DEFAULT_MOBILE_LOCALE,
  getStoredMobileLocale,
  humanizeMobileTranslationKey,
  interpolateMobileTemplate,
  loadPersistedMobileLocale,
  MOBILE_DICTIONARY,
  MOBILE_LOCALE_STORAGE_KEY,
  type MobileTranslationKey,
  normalizeMobileLocale,
  savePersistedMobileLocale,
  setStoredMobileLocale,
  translateMobile,
} from '../src/lib/mobile-i18n.ts';

test('normalizeMobileLocale normalizes valid tags and falls back safely', () => {
  assert.equal(normalizeMobileLocale('vi'), 'vi');
  assert.equal(normalizeMobileLocale('vi-VN'), 'vi');
  assert.equal(normalizeMobileLocale('en'), 'en');
  assert.equal(normalizeMobileLocale('  EN-US '), 'en');
  assert.equal(normalizeMobileLocale('ko'), DEFAULT_MOBILE_LOCALE);
  assert.equal(normalizeMobileLocale(null, 'en'), 'en');
  assert.equal(normalizeMobileLocale(undefined), 'vi');
});

test('interpolateMobileTemplate replaces provided params and preserves unknown tokens', () => {
  assert.equal(
    interpolateMobileTemplate(
      'Lũy kế: {totalRevenue} ({paidCount} đơn) • {missing}',
      {
        totalRevenue: '250.000đ',
        paidCount: 5,
      }
    ),
    'Lũy kế: 250.000đ (5 đơn) • {missing}'
  );
  assert.equal(
    interpolateMobileTemplate('Note: {note}', { note: null }),
    'Note: '
  );
});

test('humanizeMobileTranslationKey formats unknown keys into readable labels', () => {
  assert.equal(
    humanizeMobileTranslationKey('orders.actionConfirmPaid'),
    'Action Confirm Paid'
  );
  assert.equal(
    humanizeMobileTranslationKey('custom_section.quick_add_item'),
    'Quick add item'
  );
});

test('translateMobile translates across surfaces in VI and EN with interpolation and fallback', () => {
  assert.equal(translateMobile('vi', 'auth.title'), 'Qlaok Quản lý');
  assert.equal(translateMobile('en', 'auth.title'), 'Qlaok Store Manager');

  assert.equal(
    translateMobile('vi', 'nav.orders', { count: 3 }),
    'Đơn (3)'
  );
  assert.equal(
    translateMobile('en', 'nav.orders', { count: 3 }),
    'Orders (3)'
  );

  assert.equal(
    translateMobile('vi', 'orders.actionConfirmPaid'),
    'Xác nhận đã thu'
  );
  assert.equal(
    translateMobile('en', 'orders.actionConfirmPaid'),
    'Mark paid'
  );

  assert.equal(translateMobile('vi', 'orders.actionRefund'), 'Hoàn tiền');
  assert.equal(translateMobile('en', 'orders.actionRefund'), 'Refund');

  assert.equal(
    translateMobile('en', 'receipt.modalTitle', { size: '80mm' }),
    'Print preview (80mm)'
  );

  // Unknown key falls back to humanized key
  assert.equal(
    translateMobile('en', 'orders.unknownCustomAction'),
    'Unknown Custom Action'
  );
});

test('bilingualMobileText selects locale text, falls back to VI when EN is blank, and interpolates', () => {
  assert.equal(
    bilingualMobileText('vi', 'Bàn {num}', 'Table {num}', { num: 8 }),
    'Bàn 8'
  );
  assert.equal(
    bilingualMobileText('en', 'Bàn {num}', 'Table {num}', { num: 8 }),
    'Table 8'
  );
  assert.equal(
    bilingualMobileText('en', 'Phở bò tái', '   '),
    'Phở bò tái'
  );
});

test('VI and EN dictionaries have complete key parity and no implementation jargon', () => {
  const viKeys = Object.keys(MOBILE_DICTIONARY.vi) as MobileTranslationKey[];
  const enKeys = Object.keys(MOBILE_DICTIONARY.en) as MobileTranslationKey[];

  assert.deepEqual(enKeys.sort(), [...viKeys].sort());

  const bannedJargon = /\b(websocket|realtime|mpos|sync)\b/i;

  for (const key of viKeys) {
    const viVal = MOBILE_DICTIONARY.vi[key];
    const enVal = MOBILE_DICTIONARY.en[key];
    assert.ok(viVal && viVal.trim().length > 0, `empty VI value for ${key}`);
    assert.ok(enVal && enVal.trim().length > 0, `empty EN value for ${key}`);
    const tokens = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(tokens(enVal), tokens(viVal), `placeholder mismatch for ${key}`);
    assert.equal(
      bannedJargon.test(viVal),
      false,
      `VI key "${key}" contains banned implementation jargon: "${viVal}"`
    );
    assert.equal(
      bannedJargon.test(enVal),
      false,
      `EN key "${key}" contains banned implementation jargon: "${enVal}"`
    );
  }
});

test('a slow native locale load cannot overwrite a newer language selection', async () => {
  let resolveRead!: (value: string) => void;
  const adapter = { getItem: () => new Promise<string>(resolve => { resolveRead = resolve; }) };
  setStoredMobileLocale('vi', null);
  const loading = loadPersistedMobileLocale(adapter);
  setStoredMobileLocale('en', null);
  resolveRead('vi');
  assert.equal(await loading, 'en');
  assert.equal(getStoredMobileLocale(null), 'en');
});

test('native locale writes keep the latest selection and recover after storage failure', async () => {
  let releaseFirst!: () => void;
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
  const writes: string[] = [];
  const adapter = { setItem: async (_key: string, value: string) => {
    if (value === 'vi') await firstWrite;
    writes.push(value);
  } };
  const first = savePersistedMobileLocale('vi', adapter);
  const second = savePersistedMobileLocale('en', adapter);
  await Promise.resolve();
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(writes, ['vi', 'en']);
  const failing = { setItem: async () => { throw new Error('Storage unavailable'); } };
  assert.equal(await savePersistedMobileLocale('en', failing), 'en');
  assert.equal(await loadPersistedMobileLocale({ getItem: async () => { throw new Error('Storage unavailable'); } }), 'en');
});

test('sync and async locale persistence round-trips and handles storage errors gracefully', async () => {
  const store = new Map<string, string>();
  const syncStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };

  setStoredMobileLocale('en', syncStorage);
  assert.equal(store.get(MOBILE_LOCALE_STORAGE_KEY), 'en');
  assert.equal(getStoredMobileLocale(syncStorage), 'en');

  setStoredMobileLocale('vi-VN', syncStorage);
  assert.equal(getStoredMobileLocale(syncStorage), 'vi');

  const asyncStore = new Map<string, string>();
  const asyncAdapter = {
    getItem: async (k: string) => asyncStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      asyncStore.set(k, v);
    },
  };

  await savePersistedMobileLocale('en', asyncAdapter);
  assert.equal(asyncStore.get(MOBILE_LOCALE_STORAGE_KEY), 'en');
  const loaded = await loadPersistedMobileLocale(asyncAdapter);
  assert.equal(loaded, 'en');

  // Reset back to default 'vi'
  await savePersistedMobileLocale('vi', asyncAdapter);
  assert.equal(await loadPersistedMobileLocale(asyncAdapter), 'vi');
});

test('mobile auth recovery translations interpolate email and cover all error states in VI and EN', () => {
  assert.equal(
    translateMobile('vi', 'auth.forgotPasswordPrompt'),
    'Quên mật khẩu?'
  );
  assert.equal(
    translateMobile('en', 'auth.forgotPasswordPrompt'),
    'Forgot password?'
  );
  assert.match(
    translateMobile('vi', 'auth.recoverySentNotice', {
      email: 'owner@qlaok.com',
    }),
    /Nếu owner@qlaok\.com/
  );
  assert.doesNotMatch(
    translateMobile('vi', 'auth.recoverySentNotice', {
      email: 'owner@qlaok.com',
    }),
    /^Đã gửi/
  );
  assert.match(
    translateMobile('en', 'auth.recoverySentNotice', {
      email: 'owner@qlaok.com',
    }),
    /If owner@qlaok\.com/
  );
  assert.doesNotMatch(
    translateMobile('en', 'auth.recoverySentNotice', {
      email: 'owner@qlaok.com',
    }),
    /^Reset instructions sent/
  );
  assert.match(
    translateMobile('vi', 'auth.recoverySuccessNotice', {
      email: 'owner@qlaok.com',
    }),
    /owner@qlaok\.com/
  );
  assert.match(
    translateMobile('en', 'auth.recoverySuccessNotice', {
      email: 'owner@qlaok.com',
    }),
    /owner@qlaok\.com/
  );
});
