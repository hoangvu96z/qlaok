import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import {
  ALL_LOCALES,
  LOCALE_META,
  UI_LABELS,
  QUICK_TAGS_BY_VERTICAL,
  detectVisitorLocale,
  tField,
  formatCurrency,
  checkShopOpenStatus,
} from '@/lib/i18n-helper';
import {
  PLAN_CONFIGS,
  canAddMoreItems,
  getAllowedLocalesForPlan,
} from '@/lib/plan-limits';
import {
  getAiConfig,
  isAiConfigured,
  smartFallbackTranslate,
  parseRawOcrTextFallback,
  getDemoOcrResult,
} from '@/lib/gemini';
import {
  isR2Configured,
  getR2Client,
  createR2PresignedUploadUrl,
} from '@/lib/r2';
import {
  SEED_SHOPS,
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_POSTS,
  SEED_PROFILE,
} from '@/lib/seed-data';
import {
  enrichItemsWithInventory,
  setItemStockMetadata,
  dbCreateOrder,
  dbUpdateOrderStatus,
  dbGetOrderById,
  computeShopRevenueAndInventoryStats,
} from '@/lib/mpos-store';
import type { CatalogItem, OpeningHours } from '@/types/qlaok';

// ============================================================================
// SUITE 1: VIETNAM 34 PROVINCES & CITIES
// ============================================================================
describe('Suite 1: Vietnam 34 Provinces & Cities (vietnam-provinces.ts)', () => {
  test('1.1 Contains exactly 34 provinces and centrally governed cities', () => {
    assert.equal(VIETNAM_PROVINCES_34.length, 34);
  });

  test('1.2 Includes all 6 centrally governed cities (Hà Nội, TP.HCM, Đà Nẵng, Hải Phòng, Cần Thơ, Huế)', () => {
    const codes = VIETNAM_PROVINCES_34.map((p) => p.code);
    const expectedCities = [
      'ha-noi',
      'tp-ho-chi-minh',
      'da-nang',
      'hai-phong',
      'can-tho',
      'hue',
    ];
    for (const c of expectedCities) {
      assert.ok(codes.includes(c), `Missing centrally governed city: ${c}`);
    }
  });

  test('1.3 All 34 province codes are unique kebab-case strings', () => {
    const codes = VIETNAM_PROVINCES_34.map((p) => p.code);
    const uniqueCodes = new Set(codes);
    assert.equal(uniqueCodes.size, 34, 'Province codes must be unique');
    for (const code of codes) {
      assert.match(code, /^[a-z0-9-]+$/, `Invalid code format: ${code}`);
    }
  });

  test('1.4 Every province belongs to one of the 3 official regions', () => {
    const validRegions = new Set([
      'Bắc Bộ',
      'Trung Bộ & Tây Nguyên',
      'Nam Bộ',
    ]);
    for (const p of VIETNAM_PROVINCES_34) {
      assert.ok(
        validRegions.has(p.region),
        `Invalid region for ${p.name}: ${p.region}`
      );
      assert.ok(p.name.trim().length > 0);
    }
  });

  test('1.5 Region distribution covers Bắc Bộ, Trung Bộ & Tây Nguyên, and Nam Bộ', () => {
    const north = VIETNAM_PROVINCES_34.filter((p) => p.region === 'Bắc Bộ');
    const central = VIETNAM_PROVINCES_34.filter(
      (p) => p.region === 'Trung Bộ & Tây Nguyên'
    );
    const south = VIETNAM_PROVINCES_34.filter((p) => p.region === 'Nam Bộ');
    assert.ok(north.length >= 10);
    assert.ok(central.length >= 8);
    assert.ok(south.length >= 6);
    assert.equal(north.length + central.length + south.length, 34);
  });

  test('1.6 Merged provinces contain accurate mergedNote metadata', () => {
    const daNang = VIETNAM_PROVINCES_34.find((p) => p.code === 'da-nang');
    const hcm = VIETNAM_PROVINCES_34.find((p) => p.code === 'tp-ho-chi-minh');
    assert.ok(daNang?.mergedNote?.includes('Quảng Nam'));
    assert.ok(hcm?.mergedNote?.includes('Bình Dương'));
    assert.ok(hcm?.mergedNote?.includes('Bà Rịa - Vũng Tàu'));
  });
});

// ============================================================================
// SUITE 2: MULTILINGUAL I18N, CURRENCY, OPENING HOURS & QUICK TAGS
// ============================================================================
describe('Suite 2: Multilingual i18n & Storefront Helpers (i18n-helper.ts)', () => {
  test('2.1 ALL_LOCALES & LOCALE_META support all 5 languages (vi, en, ko, ja, zh)', () => {
    assert.deepEqual(ALL_LOCALES, ['vi', 'en', 'ko', 'ja', 'zh']);
    for (const loc of ALL_LOCALES) {
      const meta = LOCALE_META[loc];
      assert.ok(meta, `Missing LOCALE_META for ${loc}`);
      assert.ok(meta.label.length > 0);
      assert.ok(meta.nativeName.length > 0);
      assert.ok(meta.flagSrc.endsWith('.svg'));
      assert.equal(meta.short, loc.toUpperCase());
    }
  });

  test('2.2 tField resolves requested locale with fallback to en then vi', () => {
    const fullText = {
      vi: 'Phở Bò',
      en: 'Beef Pho',
      ko: '소고기 쌀국수',
      ja: '牛肉フォー',
      zh: '牛肉河粉',
    };
    assert.equal(tField(fullText, 'ko'), '소고기 쌀국수');
    assert.equal(tField(fullText, 'ja'), '牛肉フォー');

    const onlyViEn = { vi: 'Bánh Mì', en: 'Baguette' };
    assert.equal(
      tField(onlyViEn, 'zh'),
      'Baguette',
      'Should fallback to English when zh is missing'
    );

    const onlyVi = { vi: 'Cao Lầu Hội An' };
    assert.equal(
      tField(onlyVi, 'ko'),
      'Cao Lầu Hội An',
      'Should fallback to Vietnamese when en and ko are missing'
    );
  });

  test('2.3 tField handles null, undefined, and empty objects safely', () => {
    assert.equal(tField(null, 'vi'), '');
    assert.equal(tField(undefined, 'en'), '');
    assert.equal(tField({ vi: '' }, 'ko'), '');
  });

  test('2.4 detectVisitorLocale prioritizes valid queryLang if allowed by shop', () => {
    const all5 = ALL_LOCALES;
    assert.equal(detectVisitorLocale(all5, 'ko'), 'ko');
    assert.equal(detectVisitorLocale(all5, 'ja'), 'ja');
    assert.equal(detectVisitorLocale(all5, 'zh'), 'zh');
  });

  test('2.5 detectVisitorLocale rejects queryLang not in shop supportedLangs', () => {
    const freePlanLangs = ['vi'] as const;
    assert.equal(
      detectVisitorLocale([...freePlanLangs], 'ko'),
      'vi',
      'Should fallback to vi if shop only supports vi'
    );
  });

  test('2.6 detectVisitorLocale falls back to vi on server-side (window undefined)', () => {
    assert.equal(detectVisitorLocale(ALL_LOCALES, null), 'vi');
    assert.equal(detectVisitorLocale(ALL_LOCALES, 'invalid_lang'), 'vi');
  });

  test('2.7 formatCurrency formats VND with dot separators and đ suffix', () => {
    const formatted65k = formatCurrency(65000, 'VND');
    assert.ok(formatted65k.endsWith('đ'));
    assert.ok(formatted65k.includes('65'));

    const formattedZero = formatCurrency(0, 'VND');
    assert.equal(formattedZero, '0đ');
  });

  test('2.8 formatCurrency formats non-VND currencies with currency code', () => {
    const usd = formatCurrency(25, 'USD');
    assert.ok(usd.includes('25'));
    assert.ok(usd.includes('USD'));
  });

  test('2.9 checkShopOpenStatus evaluates closed days and 24-hour open schedules', () => {
    const alwaysClosed: OpeningHours = {
      mon: { open: '08:00', close: '22:00', closed: true },
      tue: { open: '08:00', close: '22:00', closed: true },
      wed: { open: '08:00', close: '22:00', closed: true },
      thu: { open: '08:00', close: '22:00', closed: true },
      fri: { open: '08:00', close: '22:00', closed: true },
      sat: { open: '08:00', close: '22:00', closed: true },
      sun: { open: '08:00', close: '22:00', closed: true },
    };
    const closedResult = checkShopOpenStatus(alwaysClosed);
    assert.equal(closedResult.isOpen, false);
    assert.equal(closedResult.todaySchedule.closed, true);

    const alwaysOpen: OpeningHours = {
      mon: { open: '00:00', close: '23:59', closed: false },
      tue: { open: '00:00', close: '23:59', closed: false },
      wed: { open: '00:00', close: '23:59', closed: false },
      thu: { open: '00:00', close: '23:59', closed: false },
      fri: { open: '00:00', close: '23:59', closed: false },
      sat: { open: '00:00', close: '23:59', closed: false },
      sun: { open: '00:00', close: '23:59', closed: false },
    };
    const openResult = checkShopOpenStatus(alwaysOpen);
    assert.equal(openResult.isOpen, true);
  });

  test('2.10 UI_LABELS & QUICK_TAGS_BY_VERTICAL have complete 5-locale translations', () => {
    for (const loc of ALL_LOCALES) {
      assert.ok(UI_LABELS[loc].openNow.length > 0);
      assert.ok(UI_LABELS[loc].soldOut.length > 0);
      assert.ok(UI_LABELS[loc].bottomCtaFnb.length > 0);
    }

    for (const vertical of ['fnb', 'service', 'retail'] as const) {
      const tags = QUICK_TAGS_BY_VERTICAL[vertical];
      assert.ok(tags.length >= 2);
      for (const tag of tags) {
        for (const loc of ALL_LOCALES) {
          assert.ok(
            tag.i18n[loc] && tag.i18n[loc]!.length > 0,
            `Quick tag ${tag.id} missing ${loc}`
          );
        }
      }
    }
  });
});

// ============================================================================
// SUITE 3: SAAS PLAN QUOTAS & LANGUAGE GATING
// ============================================================================
describe('Suite 3: SaaS Plan Limits & Feature Gating (plan-limits.ts)', () => {
  test('3.1 Free plan config enforces 5 items, 1 language, 0đ monthly', () => {
    const free = PLAN_CONFIGS.free;
    assert.equal(free.priceMonthly, 0);
    assert.equal(free.maxItems, 5);
    assert.equal(free.maxLangs, 1);
    assert.equal(free.allowAiOcr, false);
    assert.equal(free.allowCustomTheme, false);
  });

  test('3.2 Basic plan config enforces 25 items, 3 languages, 39,000đ monthly', () => {
    const basic = PLAN_CONFIGS.basic;
    assert.equal(basic.priceMonthly, 39000);
    assert.equal(basic.maxItems, 25);
    assert.equal(basic.maxLangs, 3);
    assert.equal(basic.allowCustomTheme, true);
  });

  test('3.3 Premium plan config unlocks unlimited items, 5 languages, AI OCR, 69,000đ monthly', () => {
    const premium = PLAN_CONFIGS.premium;
    assert.equal(premium.priceMonthly, 69000);
    assert.ok(premium.maxItems >= 999999);
    assert.equal(premium.maxLangs, 5);
    assert.equal(premium.allowAiOcr, true);
    assert.equal(premium.allowCustomTheme, true);
  });

  test('3.4 canAddMoreItems boundary checks for Free tier (0, 4, 5, 10 items)', () => {
    assert.equal(canAddMoreItems('free', 0).allowed, true);
    assert.equal(canAddMoreItems('free', 4).allowed, true);

    const atLimit = canAddMoreItems('free', 5);
    assert.equal(atLimit.allowed, false);
    assert.equal(atLimit.limit, 5);
    assert.ok(atLimit.reason?.includes('PLAN_LIMIT_REACHED'));

    assert.equal(canAddMoreItems('free', 10).allowed, false);
  });

  test('3.5 canAddMoreItems boundary checks for Basic tier (24, 25, 26 items)', () => {
    assert.equal(canAddMoreItems('basic', 24).allowed, true);
    const atLimit = canAddMoreItems('basic', 25);
    assert.equal(atLimit.allowed, false);
    assert.equal(atLimit.limit, 25);
    assert.ok(atLimit.reason?.includes('Premium'));
  });

  test('3.6 canAddMoreItems allows hundreds of items on Premium tier', () => {
    assert.equal(canAddMoreItems('premium', 0).allowed, true);
    assert.equal(canAddMoreItems('premium', 500).allowed, true);
  });

  test('3.7 getAllowedLocalesForPlan slices languages according to plan tier', () => {
    const all5 = ALL_LOCALES;
    assert.deepEqual(getAllowedLocalesForPlan('free', all5), ['vi']);
    assert.deepEqual(getAllowedLocalesForPlan('basic', all5), [
      'vi',
      'en',
      'ko',
    ]);
    assert.deepEqual(getAllowedLocalesForPlan('premium', all5), [
      'vi',
      'en',
      'ko',
      'ja',
      'zh',
    ]);
  });

  test('3.8 getAllowedLocalesForPlan defaults to ["vi"] when shopLocales is empty', () => {
    assert.deepEqual(getAllowedLocalesForPlan('free', []), ['vi']);
    assert.deepEqual(getAllowedLocalesForPlan('premium', []), ['vi']);
  });
});

// ============================================================================
// SUITE 4: AI CONFIG, DICTIONARY & TESSERACT OCR PARSER
// ============================================================================
describe('Suite 4: AI Configuration, Dictionary & OCR Parser (gemini.ts)', () => {
  test('4.1 getAiConfig reads AI_MODEL and AI_VISION_MODEL without hardcoding', () => {
    const prevUrl = process.env.AI_BASE_URL;
    const prevModel = process.env.AI_MODEL;
    const prevVision = process.env.AI_VISION_MODEL;

    process.env.AI_BASE_URL = 'https://vunph.click/v1///';
    process.env.AI_MODEL = 'combo1';
    process.env.AI_VISION_MODEL = 'combo2';

    const cfg = getAiConfig();
    assert.ok(cfg);
    assert.equal(cfg.baseUrl, 'https://vunph.click/v1');
    assert.equal(cfg.model, 'combo1');
    assert.equal(cfg.visionModel, 'combo2');
    assert.equal(isAiConfigured(), true);

    if (prevUrl !== undefined) process.env.AI_BASE_URL = prevUrl;
    if (prevModel !== undefined) process.env.AI_MODEL = prevModel;
    if (prevVision !== undefined) process.env.AI_VISION_MODEL = prevVision;
  });

  test('4.2 smartFallbackTranslate accurately translates Vietnamese signature dishes (Phở, Bạc xỉu, Bánh mì)', () => {
    const pho = smartFallbackTranslate({
      vertical: 'fnb',
      categoryNameVi: 'Món Nước',
      itemNameVi: 'Phở bò tái nạm',
    });
    assert.ok(pho.name_i18n.en?.includes('Pho Bo'));
    assert.ok(pho.name_i18n.ko?.includes('쌀국수'));
    assert.ok(pho.name_i18n.ja?.includes('フォー'));
    assert.ok(pho.name_i18n.zh?.includes('河粉'));

    const bacXiu = smartFallbackTranslate({
      vertical: 'fnb',
      itemNameVi: 'Bạc xỉu đá',
    });
    assert.ok(bacXiu.name_i18n.en?.includes('Bac Xiu'));
  });

  test('4.3 smartFallbackTranslate accurately translates Spa & Nail services (Gội đầu dưỡng sinh, Massage, Nail)', () => {
    const headSpa = smartFallbackTranslate({
      vertical: 'service',
      itemNameVi: 'Gội đầu dưỡng sinh thảo dược',
    });
    assert.ok(headSpa.name_i18n.en?.includes('Head Spa'));
    assert.ok(headSpa.name_i18n.ko?.includes('두피'));

    const nail = smartFallbackTranslate({
      vertical: 'service',
      itemNameVi: 'Làm móng sơn gel Hàn Quốc',
    });
    assert.ok(nail.name_i18n.en?.includes('Gel Nail'));
  });

  test('4.4 smartFallbackTranslate generates vertical-appropriate 5-language text for custom items', () => {
    const customRetail = smartFallbackTranslate({
      vertical: 'retail',
      itemNameVi: 'Mực Rim Me Đà Nẵng',
      itemDescVi: 'Cay ngọt đậm đà',
    });
    for (const loc of ALL_LOCALES) {
      assert.ok(customRetail.name_i18n[loc]!.length > 0);
      assert.ok(customRetail.desc_i18n[loc]!.length > 0);
    }
    assert.ok(customRetail.name_i18n.en?.includes('Local Specialty'));
    assert.equal(customRetail.desc_i18n.vi, 'Cay ngọt đậm đà');
  });

  test('4.5 parseRawOcrTextFallback parses "k" shorthand prices (35k, 65K)', () => {
    const rawText = `
      Phở bò tái nạm - 65k
      Cà phê muối 35K
    `;
    const parsed = parseRawOcrTextFallback(rawText, 'fnb');
    assert.equal(parsed.categories.length, 1);
    const items = parsed.categories[0].items;
    assert.equal(items.length, 2);
    assert.equal(items[0].name_i18n.vi, 'Phở bò tái nạm');
    assert.equal(items[0].price, 65000);
    assert.equal(items[1].name_i18n.vi, 'Cà phê muối');
    assert.equal(items[1].price, 35000);
    assert.equal(items[0].duration_mins, null);
  });

  test('4.6 parseRawOcrTextFallback parses dot and comma thousand separators (150.000đ, 95,000 VND)', () => {
    const rawText = `
      1. Gội đầu dưỡng sinh .... 150.000đ
      2) Massage cổ vai gáy: 250,000 VND
    `;
    const parsed = parseRawOcrTextFallback(rawText, 'service');
    const items = parsed.categories[0].items;
    assert.equal(items.length, 2);
    assert.equal(items[0].name_i18n.vi, 'Gội đầu dưỡng sinh');
    assert.equal(items[0].price, 150000);
    assert.equal(
      items[0].duration_mins,
      60,
      'Service vertical items should default to 60 mins'
    );
    assert.equal(items[1].name_i18n.vi, 'Massage cổ vai gáy');
    assert.equal(items[1].price, 250000);
  });

  test('4.7 parseRawOcrTextFallback parses 2-3 digit shorthand prices (e.g. "Bánh mì 45")', () => {
    const rawText = `Bánh mì thịt nướng 45`;
    const parsed = parseRawOcrTextFallback(rawText, 'fnb');
    assert.equal(parsed.categories[0].items.length, 1);
    assert.equal(parsed.categories[0].items[0].price, 45000);
  });

  test('4.8 parseRawOcrTextFallback ignores non-item header lines and noisy symbols', () => {
    const rawText = `
      === MENU QUÁN PHỞ HỘI AN ===
      MÓN CHÍNH (MAIN DISHES)
      • Phở bò đặc biệt | 75.000đ
      Chúc quý khách ngon miệng!
    `;
    const parsed = parseRawOcrTextFallback(rawText, 'fnb');
    assert.equal(parsed.categories[0].items.length, 1);
    assert.equal(parsed.categories[0].items[0].name_i18n.vi, 'Phở bò đặc biệt');
    assert.equal(parsed.categories[0].items[0].price, 75000);
  });

  test('4.9 getDemoOcrResult returns valid 5-language items for fnb, service, and retail', () => {
    for (const v of ['fnb', 'service', 'retail'] as const) {
      const demo = getDemoOcrResult(v);
      assert.ok(demo.categories.length >= 1);
      assert.ok(demo.categories[0].items.length >= 2);
      for (const loc of ALL_LOCALES) {
        assert.ok(demo.categories[0].name_i18n[loc]);
        assert.ok(demo.categories[0].items[0].name_i18n[loc]);
      }
    }
  });
});

// ============================================================================
// SUITE 5: CLOUDFLARE R2 STORAGE HELPER
// ============================================================================
describe('Suite 5: Cloudflare R2 Storage Helper (r2.ts)', () => {
  test('5.1 isR2Configured returns false and getR2Client returns null when env vars are missing', () => {
    const savedAccount = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;

    assert.equal(isR2Configured(), false);
    assert.equal(getR2Client(), null);

    if (savedAccount !== undefined) process.env.R2_ACCOUNT_ID = savedAccount;
  });

  test('5.2 createR2PresignedUploadUrl returns null when R2 is not configured', async () => {
    const savedAccount = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;

    const res = await createR2PresignedUploadUrl({
      key: 'shops/test.webp',
      contentType: 'image/webp',
    });
    assert.equal(res, null);

    if (savedAccount !== undefined) process.env.R2_ACCOUNT_ID = savedAccount;
  });

  test('5.3 createR2PresignedUploadUrl generates valid signed URL when R2 credentials are set', async () => {
    process.env.R2_ACCOUNT_ID = 'demo-account-123';
    process.env.R2_ACCESS_KEY_ID = 'demo-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'demo-secret-key';
    process.env.R2_BUCKET_NAME = 'qlaok-assets';
    process.env.R2_PUBLIC_URL = 'https://cdn.qlaok.vn/';

    assert.equal(isR2Configured(), true);
    const res = await createR2PresignedUploadUrl({
      key: 'items/pho-bo.webp',
      contentType: 'image/webp',
    });
    assert.ok(res);
    assert.ok(res.uploadUrl.includes('demo-account-123.r2.cloudflarestorage.com'));
    assert.equal(res.publicUrl, 'https://cdn.qlaok.vn/items/pho-bo.webp');

    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_PUBLIC_URL;
  });
});

// ============================================================================
// SUITE 6: SEED DATA INTEGRITY ACROSS 3 VERTICALS & 5 LOCALES
// ============================================================================
describe('Suite 6: Seed Data Integrity (seed-data.ts)', () => {
  test('6.1 SEED_SHOPS covers all 3 verticals (fnb, service, retail)', () => {
    assert.equal(SEED_SHOPS.length, 3);
    const verticals = new Set(SEED_SHOPS.map((s) => s.vertical));
    assert.deepEqual(verticals, new Set(['fnb', 'service', 'retail']));
  });

  test('6.2 Every SEED_ITEM has positive price and complete 5-language name & description', () => {
    assert.ok(SEED_ITEMS.length >= 10);
    for (const item of SEED_ITEMS) {
      assert.ok(item.price > 0, `Item ${item.id} must have positive price`);
      for (const loc of ALL_LOCALES) {
        assert.ok(
          item.name_i18n[loc] && item.name_i18n[loc]!.length > 0,
          `Seed item ${item.id} missing name_i18n.${loc}`
        );
        assert.ok(
          item.desc_i18n[loc] && item.desc_i18n[loc]!.length > 0,
          `Seed item ${item.id} missing desc_i18n.${loc}`
        );
      }
    }
  });

  test('6.3 Every SEED_CATEGORY belongs to a valid SEED_SHOP and has 5-language names', () => {
    const shopIds = new Set(SEED_SHOPS.map((s) => s.id));
    for (const cat of SEED_CATEGORIES) {
      assert.ok(shopIds.has(cat.shop_id));
      for (const loc of ALL_LOCALES) {
        assert.ok(cat.name_i18n[loc]);
      }
    }
  });

  test('6.4 Every SEED_POST has 5-language title and content', () => {
    assert.ok(SEED_POSTS.length >= 3);
    for (const post of SEED_POSTS) {
      for (const loc of ALL_LOCALES) {
        assert.ok(post.title_i18n[loc]);
        assert.ok(post.content_i18n[loc]);
      }
    }
  });

  test('6.5 SEED_PROFILE has valid owner email and plan tier', () => {
    assert.ok(SEED_PROFILE.email.includes('@'));
    assert.ok(['free', 'basic', 'premium'].includes(SEED_PROFILE.plan));
  });
});

// ============================================================================
// SUITE 7: mPOS ORDER ENGINE, INVENTORY STOCK DEDUCTION & REVENUE ANALYTICS
// ============================================================================
describe('Suite 7: mPOS Order, Inventory & Revenue Engine (mpos-store.ts)', () => {
  const testItemId = 'unit-test-item-999';

  test('7.1 setItemStockMetadata & enrichItemsWithInventory set and enrich stock_quantity and sold_count', async () => {
    await setItemStockMetadata(testItemId, 12, 5);

    const mockItems: CatalogItem[] = [
      {
        id: testItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Unit Test' },
        desc_i18n: { vi: 'Mô tả' },
        options_json: [],
        view_count: 0,
      },
    ];

    const enriched = enrichItemsWithInventory(mockItems);
    assert.equal(enriched[0].stock_quantity, 12);
    assert.equal(enriched[0].sold_count, 5);
    assert.equal(enriched[0].is_available, true);
  });

  test('7.2 enrichItemsWithInventory automatically forces is_available = false when stock_quantity === 0', async () => {
    await setItemStockMetadata(testItemId, 0, 17);

    const mockItems: CatalogItem[] = [
      {
        id: testItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Hết Tồn Kho' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ];

    const enriched = enrichItemsWithInventory(mockItems);
    assert.equal(enriched[0].stock_quantity, 0);
    assert.equal(
      enriched[0].is_available,
      false,
      'Item with 0 stock must be marked unavailable'
    );
  });

  test('7.3 setItemStockMetadata supports unlimited stock (null) and clamps negative values to 0', async () => {
    await setItemStockMetadata(testItemId, -10, 3);
    let enriched = enrichItemsWithInventory([
      {
        id: testItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Test' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ]);
    assert.equal(enriched[0].stock_quantity, 0);

    await setItemStockMetadata(testItemId, null, 3);
    enriched = enrichItemsWithInventory(enriched);
    assert.equal(enriched[0].stock_quantity, null);
  });

  test('7.4 dbCreateOrder calculates total_amount with extra_price and deducts stock_quantity', async () => {
    await setItemStockMetadata(testItemId, 5, 10);

    const order = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Unit-01',
      visitor_lang: 'en',
      payment_method: 'cash',
      source: 'qr_table',
      items: [
        {
          item_id: testItemId,
          name_vi: 'Phở Unit Test',
          quantity: 2,
          unit_price: 50000,
          extra_price: 15000, // (50k + 15k) * 2 = 130,000
          selected_choices: [],
        },
      ],
    });

    assert.equal(order.total_amount, 130000);
    assert.equal(order.status, 'new');
    assert.equal(order.payment_status, 'unpaid');

    const enriched = enrichItemsWithInventory([
      {
        id: testItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Phở Unit Test' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ]);
    assert.equal(enriched[0].stock_quantity, 3); // 5 - 2 = 3
    assert.equal(enriched[0].sold_count, 12); // 10 + 2 = 12

    // Clean up by cancelling order
    await dbUpdateOrderStatus(order.id, { status: 'cancelled' });
  });

  test('7.5 dbCreateOrder throws an error when ordering more than remaining stock_quantity', async () => {
    await setItemStockMetadata(testItemId, 2, 0);

    await assert.rejects(
      async () => {
        await dbCreateOrder({
          shop_id: 'shop-fnb-001',
          table_label: 'Bàn Quá Tồn',
          items: [
            {
              item_id: testItemId,
              name_vi: 'Món Chỉ Còn 2',
              quantity: 5,
              unit_price: 40000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes('chỉ còn 2'));
        return true;
      }
    );
  });

  test('7.6 dbCreateOrder throws an error when items array is empty', async () => {
    await assert.rejects(async () => {
      await dbCreateOrder({
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn Trống',
        items: [],
      });
    });
  });

  test('7.7 dbUpdateOrderStatus transitions new -> preparing -> completed -> cancelled and restores stock', async () => {
    await setItemStockMetadata(testItemId, 10, 0);

    const created = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Unit-02',
      items: [
        {
          item_id: testItemId,
          name_vi: 'Món Test Trạng Thái',
          quantity: 4,
          unit_price: 30000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    const prep = await dbUpdateOrderStatus(created.id, { status: 'preparing' });
    assert.equal(prep.status, 'preparing');

    const comp = await dbUpdateOrderStatus(created.id, { status: 'completed' });
    assert.equal(comp.status, 'completed');
    assert.equal(
      comp.payment_status,
      'paid',
      'Completed order should default to paid'
    );

    const cancelled = await dbUpdateOrderStatus(created.id, {
      status: 'cancelled',
    });
    assert.equal(cancelled.status, 'cancelled');

    const fetched = await dbGetOrderById(created.id);
    assert.equal(fetched?.status, 'cancelled');

    const enriched = enrichItemsWithInventory([
      {
        id: testItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 30000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Test Trạng Thái' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ]);
    assert.equal(
      enriched[0].stock_quantity,
      10,
      'Stock must be restored back to 10 after cancellation'
    );
  });

  test('7.8 computeShopRevenueAndInventoryStats computes 7-day revenue, low-stock count, and top sellers', () => {
    const sampleItems = enrichItemsWithInventory(
      SEED_ITEMS.filter((i) => i.shop_id === 'shop-fnb-001')
    );
    const stats = computeShopRevenueAndInventoryStats(
      'shop-fnb-001',
      sampleItems
    );

    assert.equal(typeof stats.todayRevenue, 'number');
    assert.equal(typeof stats.totalRevenue, 'number');
    assert.ok(stats.totalRevenue >= stats.todayRevenue);
    assert.equal(stats.dailyRevenue7d.length, 7);
    assert.equal(stats.dailyRevenue7d[6].label, 'Hôm nay');
    assert.ok(Array.isArray(stats.topSellingItems));
    assert.ok(stats.topSellingItems.length <= 5);
    if (stats.topSellingItems.length >= 2) {
      assert.ok(
        stats.topSellingItems[0].sold_count >=
          stats.topSellingItems[1].sold_count,
        'Top selling items must be sorted descending by sold_count'
      );
    }
  });
});
