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
import {
  dbGetStorefrontBundle,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { getAllowedLocalesForPlan } from '@/lib/plan-limits';
import { normalizeShopSupportedLangs } from '@/lib/i18n-helper';
import { GET as shopsGet } from '@/app/api/shops/route';
import type { Shop } from '@/types/qlaok';

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

interface MockStorefrontBundleDbOptions {
  shops?: Record<string, Omit<Partial<Shop>, 'owner_id'> & { owner_id?: string | null }>;
  profiles?: Record<string, { id?: string; plan?: unknown } | null>;
  firstProfile?: { id?: string; plan?: unknown };
  recordedProfileQueries?: Array<{
    columns?: string;
    filterCol?: string;
    filterVal?: unknown;
  }>;
  errors?: {
    profiles?: { message: string };
  };
}

function createMockSupabaseForStorefrontBundle(
  opts: MockStorefrontBundleDbOptions
) {
  return {
    from(table: string) {
      if (table === 'shops') {
        let filterSlug: string | undefined;
        let selectedCols: string | undefined;
        const chain = {
          select(cols?: string) {
            selectedCols = cols;
            return chain;
          },
          eq(col: string, val: string) {
            if (col === 'slug') filterSlug = val;
            return chain;
          },
          order() {
            return chain;
          },
          limit: async (count: number) => {
            if (selectedCols?.trim() === 'id') {
              const all = Object.values(opts.shops || {});
              const probeRow = all[0] ? { id: all[0].id } : { id: 'probe-shop' };
              return { data: [probeRow].slice(0, count), error: null };
            }
            return {
              data: Object.values(opts.shops || {}).slice(0, count),
              error: null,
            };
          },
          maybeSingle: async () => {
            if (filterSlug) {
              const found = Object.values(opts.shops || {}).find(
                (s) =>
                  s.slug?.trim().toLowerCase() === filterSlug?.trim().toLowerCase()
              );
              return { data: found ?? null, error: null };
            }
            return { data: null, error: null };
          },
          single: async () => {
            if (filterSlug) {
              const found = Object.values(opts.shops || {}).find(
                (s) =>
                  s.slug?.trim().toLowerCase() === filterSlug?.trim().toLowerCase()
              );
              return { data: found ?? null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return chain;
      }

      if (table === 'shop_slug_aliases') {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        };
        return chain;
      }

      if (
        table === 'categories' ||
        table === 'items' ||
        table === 'posts' ||
        table === 'shop_tables'
      ) {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          order: async () => ({ data: [], error: null }),
        };
        return chain;
      }

      if (table === 'profiles') {
        let selectedCols: string | undefined;
        let filterCol: string | undefined;
        let filterVal: unknown;
        const chain = {
          select(cols?: string) {
            selectedCols = cols;
            return chain;
          },
          limit: async () => ({
            data: [
              opts.firstProfile || {
                id: 'unrelated-first-profile',
                plan: 'premium',
              },
            ],
            error: null,
          }),
          eq(col: string, val: unknown) {
            filterCol = col;
            filterVal = val;
            opts.recordedProfileQueries?.push({
              columns: selectedCols,
              filterCol,
              filterVal,
            });
            return chain;
          },
          maybeSingle: async () => {
            if (opts.errors?.profiles) {
              return { data: null, error: opts.errors.profiles };
            }
            if (filterCol === 'id' && typeof filterVal === 'string') {
              const prof = opts.profiles?.[filterVal];
              if (prof === undefined || prof === null) {
                return { data: null, error: null };
              }
              return { data: prof, error: null };
            }
            return { data: null, error: null };
          },
          single: async () => {
            if (opts.errors?.profiles) {
              return { data: null, error: opts.errors.profiles };
            }
            if (filterCol === 'id' && typeof filterVal === 'string') {
              const prof = opts.profiles?.[filterVal];
              if (prof === undefined || prof === null) {
                return { data: null, error: null };
              }
              return { data: prof, error: null };
            }
            return { data: null, error: null };
          },
        };
        return chain;
      }

      throw new Error(`Unexpected table in mock: ${table}`);
    },
  };
}

test('dbGetStorefrontBundle derives ownerPlan strictly from shop.owner_id and fails closed to free in DB mode', async () => {
  const recordedProfileQueries: Array<{
    columns?: string;
    filterCol?: string;
    filterVal?: unknown;
  }> = [];

  const mockDb = createMockSupabaseForStorefrontBundle({
    shops: {
      'shop-free': {
        id: 'shop-free',
        slug: 'quan-free-owner',
        name: 'Quán Chủ Free',
        owner_id: 'owner-free-01',
        is_published: true,
        supported_langs: ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru'],
      },
      'shop-prem': {
        id: 'shop-prem',
        slug: 'quan-prem-owner',
        name: 'Quán Chủ Premium',
        owner_id: 'owner-prem-01',
        is_published: true,
        supported_langs: ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru'],
      },
      'shop-basic': {
        id: 'shop-basic',
        slug: 'quan-basic-owner',
        name: 'Quán Chủ Basic',
        owner_id: 'owner-basic-01',
        is_published: true,
        supported_langs: ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru'],
      },
      'shop-missing-owner': {
        id: 'shop-missing-owner',
        slug: 'quan-missing-owner',
        name: 'Quán Chủ Không Có Profile',
        owner_id: 'owner-non-existent',
        is_published: true,
        supported_langs: ['vi', 'en', 'ko', 'ja'],
      },
      'shop-null-owner': {
        id: 'shop-null-owner',
        slug: 'quan-null-owner',
        name: 'Quán OwnerId Rỗng',
        owner_id: null,
        is_published: true,
        supported_langs: ['vi', 'en', 'ko', 'ja'],
      },
      'shop-invalid-plan': {
        id: 'shop-invalid-plan',
        slug: 'quan-invalid-plan',
        name: 'Quán Gói Không Hợp Lệ',
        owner_id: 'owner-invalid-plan-id',
        is_published: true,
        supported_langs: ['vi', 'en', 'ko'],
      },
    },
    profiles: {
      'owner-free-01': { id: 'owner-free-01', plan: 'free' },
      'owner-prem-01': { id: 'owner-prem-01', plan: 'premium' },
      'owner-basic-01': { id: 'owner-basic-01', plan: 'basic' },
      'owner-invalid-plan-id': { id: 'owner-invalid-plan-id', plan: 'enterprise_custom' },
    },
    // The unrelated first profile returned by an un-scoped profiles lookup has plan: 'premium'
    firstProfile: { id: 'unrelated-first-profile', plan: 'premium' },
    recordedProfileQueries,
  });

  try {
    setSupabaseDbClientForTests(mockDb);

    // 1. Free owner: bundle derives ownerPlan: 'free' using shop.owner_id, never unrelated 'premium' profile
    const freeBundle = await dbGetStorefrontBundle('quan-free-owner');
    assert.ok(freeBundle, 'freeBundle must be resolved');
    assert.equal(freeBundle.ownerPlan, 'free', 'Owner on Free tier must return ownerPlan "free"');
    assert.equal(freeBundle.shop.id, 'shop-free');

    // Verify exact query: only 'plan' column selected, and filtered by id = shop.owner_id
    const freeQuery = recordedProfileQueries.find(
      (q) => q.filterCol === 'id' && q.filterVal === 'owner-free-01'
    );
    assert.ok(freeQuery, 'Must query profiles with filter id = shop.owner_id');
    assert.equal(freeQuery.columns, 'plan', 'Must select only "plan" column from profiles');

    // Verify storefront language gating: Free owner allows only 1 language even if shop configured 8
    const freeAllowedLangs = getAllowedLocalesForPlan(
      freeBundle.ownerPlan,
      normalizeShopSupportedLangs(freeBundle.shop.supported_langs)
    );
    assert.deepEqual(
      freeAllowedLangs,
      ['vi'],
      'Public storefront language display for Free owner must be gated to 1 language (vi)'
    );

    // Verify GET /api/shops passes through the ownerPlan correctly
    const apiFreeRes = await shopsGet(
      new Request('http://localhost:3000/api/shops?slug=quan-free-owner')
    );
    assert.equal(apiFreeRes.status, 200);
    const apiFreeData = await apiFreeRes.json();
    assert.equal(apiFreeData.ownerPlan, 'free');

    // 2. Premium owner: bundle derives ownerPlan: 'premium' using shop.owner_id
    const premBundle = await dbGetStorefrontBundle('quan-prem-owner');
    assert.ok(premBundle, 'premBundle must be resolved');
    assert.equal(premBundle.ownerPlan, 'premium', 'Owner on Premium tier must return ownerPlan "premium"');
    assert.equal(premBundle.shop.id, 'shop-prem');

    const premQuery = recordedProfileQueries.find(
      (q) => q.filterCol === 'id' && q.filterVal === 'owner-prem-01'
    );
    assert.ok(premQuery, 'Must query profiles with filter id = shop.owner_id');

    // Verify storefront language gating: Premium owner unlocks all 8 supported languages
    const premAllowedLangs = getAllowedLocalesForPlan(
      premBundle.ownerPlan,
      normalizeShopSupportedLangs(premBundle.shop.supported_langs)
    );
    assert.equal(premAllowedLangs.length, 8);
    assert.deepEqual(premAllowedLangs, [
      'vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru',
    ]);

    const apiPremRes = await shopsGet(
      new Request('http://localhost:3000/api/shops?slug=quan-prem-owner')
    );
    assert.equal(apiPremRes.status, 200);
    const apiPremData = await apiPremRes.json();
    assert.equal(apiPremData.ownerPlan, 'premium');

    // 3. Basic owner: bundle derives ownerPlan: 'basic' and gates storefront to 3 languages
    const basicBundle = await dbGetStorefrontBundle('quan-basic-owner');
    assert.ok(basicBundle, 'basicBundle must be resolved');
    assert.equal(basicBundle.ownerPlan, 'basic', 'Owner on Basic tier must return ownerPlan "basic"');
    const basicAllowedLangs = getAllowedLocalesForPlan(
      basicBundle.ownerPlan,
      normalizeShopSupportedLangs(basicBundle.shop.supported_langs)
    );
    assert.deepEqual(basicAllowedLangs, ['vi', 'en', 'ko']);

    // 4. Missing owner profile fails closed to 'free'
    const missingOwnerBundle = await dbGetStorefrontBundle('quan-missing-owner');
    assert.ok(missingOwnerBundle);
    assert.equal(
      missingOwnerBundle.ownerPlan,
      'free',
      'Missing owner profile must fall back to "free"'
    );

    // 5. Null owner_id fails closed to 'free' without crashing
    const nullOwnerBundle = await dbGetStorefrontBundle('quan-null-owner');
    assert.ok(nullOwnerBundle);
    assert.equal(
      nullOwnerBundle.ownerPlan,
      'free',
      'Null owner_id must fall back to "free"'
    );

    // 6. Invalid plan string in profile fails closed to 'free'
    const invalidPlanBundle = await dbGetStorefrontBundle('quan-invalid-plan');
    assert.ok(invalidPlanBundle);
    assert.equal(
      invalidPlanBundle.ownerPlan,
      'free',
      'Invalid plan string in profiles must fall back to "free"'
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }

  // 7. Profile DB query failure fails closed to 'free'
  const errorDb = createMockSupabaseForStorefrontBundle({
    shops: {
      'shop-err': {
        id: 'shop-err',
        slug: 'quan-err',
        name: 'Quán Lỗi Query Profile',
        owner_id: 'owner-err-id',
        is_published: true,
      },
    },
    errors: {
      profiles: { message: 'PROFILES_TABLE_TEMPORARILY_UNAVAILABLE' },
    },
  });

  try {
    setSupabaseDbClientForTests(errorDb);
    const errorBundle = await dbGetStorefrontBundle('quan-err');
    assert.ok(errorBundle);
    assert.equal(
      errorBundle.ownerPlan,
      'free',
      'Profile query error must fail closed and default to "free"'
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

