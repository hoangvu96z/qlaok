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
  dbGetTableBill,
  dbSettleTableBill,
  dbRecordOrderPrint,
  computeShopRevenueAndInventoryStats,
} from '@/lib/mpos-store';
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasShopPermission,
  dbUpsertShopMembership,
  dbDeleteShopMembership,
  resolveUserShopMembership,
} from '@/lib/shop-permissions';
import { computeSharedOrderQuote } from '@/lib/order-pricing';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import {
  issueSessionToken,
  verifySessionToken,
} from '@/lib/server-auth';
import {
  hashPassword,
  verifyPassword,
} from '@/lib/auth-credentials';
import { GET as adminGet, POST as adminPost } from '@/app/api/admin/route';
import { POST as authPost } from '@/app/api/auth/route';
import { POST as paymentPost } from '@/app/api/webhooks/payment/route';
import {
  GET as ordersGet,
  POST as ordersPost,
  PATCH as ordersPatch,
} from '@/app/api/orders/route';
import {
  GET as shopsGet,
  POST as shopsPost,
  PATCH as shopsPatch,
} from '@/app/api/shops/route';
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
  test('2.1 ALL_LOCALES & LOCALE_META support all 8 languages (vi, en, ko, ja, zh, es, it, ru)', () => {
    assert.deepEqual(ALL_LOCALES, [
      'vi',
      'en',
      'ko',
      'ja',
      'zh',
      'es',
      'it',
      'ru',
    ]);
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
      es: 'Pho de ternera',
      it: 'Pho di manzo',
      ru: 'Фо с говядиной',
    };
    assert.equal(tField(fullText, 'ko'), '소고기 쌀국수');
    assert.equal(tField(fullText, 'ja'), '牛肉フォー');
    assert.equal(tField(fullText, 'es'), 'Pho de ternera');
    assert.equal(tField(fullText, 'it'), 'Pho di manzo');
    assert.equal(tField(fullText, 'ru'), 'Фо с говядиной');

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
    const all8 = ALL_LOCALES;
    assert.equal(detectVisitorLocale(all8, 'ko'), 'ko');
    assert.equal(detectVisitorLocale(all8, 'ja'), 'ja');
    assert.equal(detectVisitorLocale(all8, 'zh'), 'zh');
    assert.equal(detectVisitorLocale(all8, 'es'), 'es');
    assert.equal(detectVisitorLocale(all8, 'it'), 'it');
    assert.equal(detectVisitorLocale(all8, 'ru'), 'ru');
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

  test('2.10 UI_LABELS & QUICK_TAGS_BY_VERTICAL have complete 8-locale translations', () => {
    for (const loc of ALL_LOCALES) {
      assert.ok(UI_LABELS[loc].openNow.length > 0);
      assert.ok(UI_LABELS[loc].soldOut.length > 0);
      assert.ok(UI_LABELS[loc].bottomCtaFnb.length > 0);
      assert.ok(UI_LABELS[loc].cashPayment.length > 0);
      assert.ok(UI_LABELS[loc].qrPayment.length > 0);
      assert.ok(UI_LABELS[loc].tablePrefix.length > 0);
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

  test('3.3 Premium plan config unlocks unlimited items, 8 languages, AI OCR, 69,000đ monthly', () => {
    const premium = PLAN_CONFIGS.premium;
    assert.equal(premium.priceMonthly, 69000);
    assert.ok(premium.maxItems >= 999999);
    assert.equal(premium.maxLangs, 8);
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
    const all8 = ALL_LOCALES;
    assert.deepEqual(getAllowedLocalesForPlan('free', all8), ['vi']);
    assert.deepEqual(getAllowedLocalesForPlan('basic', all8), [
      'vi',
      'en',
      'ko',
    ]);
    assert.deepEqual(getAllowedLocalesForPlan('premium', all8), [
      'vi',
      'en',
      'ko',
      'ja',
      'zh',
      'es',
      'it',
      'ru',
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

    const comp = await dbUpdateOrderStatus(created.id, {
      status: 'completed',
      payment_status: 'paid',
    });
    assert.equal(comp.status, 'completed');
    assert.equal(comp.payment_status, 'paid');

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

// ============================================================================
// SUITE 8: SECURITY, AUTHORIZATION, WEBHOOK IDEMPOTENCY & MPOS CONCURRENCY
// ============================================================================
describe('Suite 8: Security, Authorization, Webhook & Concurrency Hardening', () => {
  const secItemId = 'item-unit-test-sec-888';

  test('8.1 (P0 #1) Admin API rejects spoofed x-admin-email header without valid signed token (401/403)', async () => {
    const spoofedGetReq = new Request(
      'http://localhost:3000/api/admin?adminEmail=hoangvu96z@gmail.com',
      {
        method: 'GET',
        headers: {
          'x-admin-email': 'hoangvu96z@gmail.com',
        },
      }
    );
    const getRes = await adminGet(spoofedGetReq);
    assert.equal(getRes.status, 401);

    // Owner A token trying to access /api/admin -> 403 Forbidden
    const ownerToken = issueSessionToken({
      id: 'owner-other-999',
      email: 'ownerA@example.com',
      role: 'owner',
    });
    const ownerAdminReq = new Request('http://localhost:3000/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
        'x-admin-email': 'hoangvu96z@gmail.com',
      },
      body: JSON.stringify({
        action: 'update_owner_plan',
        adminEmail: 'hoangvu96z@gmail.com',
        ownerId: 'owner-other-999',
        plan: 'premium',
      }),
    });
    const postRes = await adminPost(ownerAdminReq);
    assert.equal(postRes.status, 403);
  });

  test('8.2 (P0 #2) Session token verification rejects expired or tampered tokens, and salted scrypt verifies passwords safely', () => {
    const validToken = issueSessionToken(
      { id: 'owner-1', email: 'test@qlaok.vn', role: 'owner' },
      3600
    );
    const verified = verifySessionToken(validToken);
    assert.ok(verified);
    assert.equal(verified?.sub, 'owner-1');
    assert.equal(verified?.role, 'owner');

    // Tampered signature must return null
    const tampered = `${validToken.split('.')[0]}.forgedsignature123`;
    assert.equal(verifySessionToken(tampered), null);

    // Expired token must return null
    const expiredToken = issueSessionToken(
      { id: 'owner-1', email: 'test@qlaok.vn', role: 'owner' },
      -10
    );
    assert.equal(verifySessionToken(expiredToken), null);

    // Salted scrypt password hashing
    const h1 = hashPassword('MySecretPass!123');
    const h2 = hashPassword('MySecretPass!123');
    assert.ok(h1.startsWith('scrypt$'));
    assert.notEqual(h1, h2, 'Each scrypt hash must use a unique random salt');
    assert.equal(verifyPassword('MySecretPass!123', h1), true);
    assert.equal(verifyPassword('WrongPassword', h1), false);
  });

  test('8.3 (P0 #2) Auth API blocks registering Super Admin email and blocks unauthenticated sync_user', async () => {
    const hijackRegisterReq = new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        email: 'hoangvu96z@gmail.com',
        password: 'attackerPassword123',
        fullName: 'Attacker',
      }),
    });
    const regRes = await authPost(hijackRegisterReq);
    assert.equal(
      regRes.status,
      403,
      'Must block public registration overwrite of Super Admin email'
    );

    const hijackSyncReq = new Request('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_user',
        email: 'hoangvu96z@gmail.com',
      }),
    });
    const syncRes = await authPost(hijackSyncReq);
    assert.equal(
      syncRes.status,
      401,
      'Unauthenticated sync_user without verified token must return 401'
    );
  });

  test('8.4 (P0 #4) Business APIs reject anonymous and cross-owner access (401/403)', async () => {
    // Anonymous GET /api/orders?shopId=shop-fnb-001 must return 401
    const anonOrdersReq = new Request(
      'http://localhost:3000/api/orders?shopId=shop-fnb-001',
      { method: 'GET' }
    );
    const anonOrdersRes = await ordersGet(anonOrdersReq);
    assert.equal(anonOrdersRes.status, 401);

    // Anonymous PATCH /api/orders must return 401
    const anonPatchOrderReq = new Request('http://localhost:3000/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'ord-seed-101',
        status: 'cancelled',
      }),
    });
    const anonPatchRes = await ordersPatch(anonPatchOrderReq);
    assert.equal(anonPatchRes.status, 401);

    // Owner B trying to PATCH Owner A's shop (shop-fnb-001 belongs to owner-demo-001) -> 403
    const otherOwnerToken = issueSessionToken({
      id: 'owner-intruder-777',
      email: 'intruder@example.com',
      role: 'owner',
    });
    const crossShopPatchReq = new Request('http://localhost:3000/api/shops', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherOwnerToken}`,
      },
      body: JSON.stringify({
        id: 'shop-fnb-001',
        name: 'Hacked Shop Name',
      }),
    });
    const crossShopRes = await shopsPatch(crossShopPatchReq);
    assert.ok(
      crossShopRes.status === 403 || crossShopRes.status === 404,
      `Expected 403 or 404 for cross-owner shop PATCH, got ${crossShopRes.status}`
    );
  });

  test('8.5 (P0 #5) Payment API blocks public switch_plan_direct and rejects unsigned or unknown webhooks', async () => {
    // Public switch_plan_direct without Super Admin token -> 403
    const switchReq = new Request(
      'http://localhost:3000/api/webhooks/payment',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'switch_plan_direct',
          plan: 'premium',
        }),
      }
    );
    const switchRes = await paymentPost(switchReq);
    assert.equal(switchRes.status, 403);

    // Unsigned webhook without secret -> 401
    const unsignedWebhookReq = new Request(
      'http://localhost:3000/api/webhooks/payment',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderCode: 'QLAOKP99999',
          transferAmount: 69000,
        }),
      }
    );
    const unsignedRes = await paymentPost(unsignedWebhookReq);
    assert.equal(unsignedRes.status, 401);

    // Signed webhook with unknown orderCode -> 404 (must NOT auto-create completed transaction)
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'qlaok-webhook-secret-v1';
    const unknownOrderReq = new Request(
      'http://localhost:3000/api/webhooks/payment',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify({
          orderCode: 'QLAOKP_NON_EXISTENT_99999',
          transferAmount: 69000,
        }),
      }
    );
    const unknownRes = await paymentPost(unknownOrderReq);
    assert.equal(unknownRes.status, 404);
  });

  test('8.6 (P1 #6) dbCreateOrder enforces server catalog pricing and blocks customer paid/discount flags', async () => {
    // item-fnb-1 in SEED_ITEMS has price 65,000đ. Customer sends forged unit_price=1, payment_status='paid', markCompletedImmediately=true, discount_amount=50000
    await setItemStockMetadata('item-fnb-1', 20, 0);

    const customerOrder = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Hack Giá',
      payment_status: 'paid',
      markCompletedImmediately: true,
      discount_amount: 50000,
      isStaffAuthorized: false,
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
          quantity: 1,
          unit_price: 1, // Forged client price!
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    assert.equal(
      customerOrder.status,
      'new',
      'Customer cannot mark order completed immediately'
    );
    assert.equal(
      customerOrder.payment_status,
      'unpaid',
      'Customer cannot mark order paid'
    );
    assert.equal(
      customerOrder.discount_amount,
      0,
      'Customer cannot apply staff discount'
    );

    await dbUpdateOrderStatus(customerOrder.id, { status: 'cancelled' });
  });

  test('8.7 (P1 #7) dbCreateOrder rejects negative/zero/fractional quantities and duplicate line stock overflow', async () => {
    await setItemStockMetadata(secItemId, 5, 0);

    // Negative quantity (-2) must be rejected and must NOT increase stock from 5 to 7!
    await assert.rejects(
      async () => {
        await dbCreateOrder({
          shop_id: 'shop-fnb-001',
          table_label: 'Bàn Số Âm',
          items: [
            {
              item_id: secItemId,
              name_vi: 'Món Test Âm',
              quantity: -2,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes('INVALID_QUANTITY'));
        return true;
      }
    );

    // Fractional quantity (1.5) must be rejected
    await assert.rejects(async () => {
      await dbCreateOrder({
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn Số Lẻ',
        items: [
          {
            item_id: secItemId,
            name_vi: 'Món Test Lẻ',
            quantity: 1.5,
            unit_price: 50000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      });
    });

    // Two duplicate lines of the same item (4 + 4 = 8) when stock is 5 -> must be rejected!
    await assert.rejects(
      async () => {
        await dbCreateOrder({
          shop_id: 'shop-fnb-001',
          table_label: 'Bàn Dòng Trùng',
          items: [
            {
              item_id: secItemId,
              name_vi: 'Món Test Dòng 1',
              quantity: 4,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
            {
              item_id: secItemId,
              name_vi: 'Món Test Dòng 2',
              quantity: 4,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes('chỉ còn 5'));
        return true;
      }
    );
  });

  test('8.8 (P1 #8) Concurrent orders serialize via mutex so two simultaneous orders of 4 against stock 5 reject the second, and idempotency_key deduplicates retries', async () => {
    await setItemStockMetadata(secItemId, 5, 0);

    const results = await Promise.allSettled([
      dbCreateOrder({
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn Đồng Thời A',
        items: [
          {
            item_id: secItemId,
            name_vi: 'Món Tranh Chấp',
            quantity: 4,
            unit_price: 40000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      }),
      dbCreateOrder({
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn Đồng Thời B',
        items: [
          {
            item_id: secItemId,
            name_vi: 'Món Tranh Chấp',
            quantity: 4,
            unit_price: 40000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(
      fulfilled.length,
      1,
      'Exactly one of the two concurrent orders of 4 (stock 5) must succeed'
    );
    assert.equal(
      rejected.length,
      1,
      'The second concurrent order of 4 must be rejected because remaining stock is 1'
    );

    const enrichedAfterRace = enrichItemsWithInventory([
      {
        id: secItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 40000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Tranh Chấp' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ]);
    assert.equal(enrichedAfterRace[0].stock_quantity, 1);

    // Idempotency key retry test: sending the same idempotency_key returns existing order without deducting the remaining 1 stock
    const idempKey = `idemp-test-${Date.now()}`;
    const firstRetryOrder = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Idemp',
      idempotency_key: idempKey,
      items: [
        {
          item_id: secItemId,
          name_vi: 'Món Tranh Chấp',
          quantity: 1,
          unit_price: 40000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const duplicateRetryOrder = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Idemp',
      idempotency_key: idempKey,
      items: [
        {
          item_id: secItemId,
          name_vi: 'Món Tranh Chấp',
          quantity: 1,
          unit_price: 40000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(firstRetryOrder.id, duplicateRetryOrder.id);

    // Clean up
    if (fulfilled[0]?.status === 'fulfilled') {
      await dbUpdateOrderStatus(fulfilled[0].value.id, { status: 'cancelled' });
    }
    await dbUpdateOrderStatus(firstRetryOrder.id, { status: 'cancelled' });
  });

  test('8.9 (P1 #9) Re-opening a cancelled order re-reserves stock so stock 5 -> buy 2 -> cancel -> reopen -> cancel ends at stock 5 (not 7)', async () => {
    await setItemStockMetadata(secItemId, 5, 0);

    const ord = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn State Machine',
      items: [
        {
          item_id: secItemId,
          name_vi: 'Món State Machine',
          quantity: 2,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    // Cancel #1 -> stock restored to 5
    await dbUpdateOrderStatus(ord.id, { status: 'cancelled' });

    // Reopen (cancelled -> new) -> stock must be re-deducted to 3
    await dbUpdateOrderStatus(ord.id, { status: 'new' });
    const stockDuringReopen = enrichItemsWithInventory([
      {
        id: secItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món State Machine' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ])[0].stock_quantity;
    assert.equal(
      stockDuringReopen,
      3,
      'Re-opening cancelled order must re-deduct 2 units from stock (5 -> 3)'
    );

    // Cancel #2 -> stock restored to 5 (never 7!)
    await dbUpdateOrderStatus(ord.id, { status: 'cancelled' });
    // Cancel #3 (redundant cancel on already-cancelled order) -> stock stays 5
    await dbUpdateOrderStatus(ord.id, { status: 'cancelled' });

    const finalStock = enrichItemsWithInventory([
      {
        id: secItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món State Machine' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ])[0].stock_quantity;

    assert.equal(
      finalStock,
      5,
      'Final stock after buy 2 -> cancel -> reopen -> cancel must be 5, never 7'
    );
  });
});

// ============================================================================
// SUITE 9: MEMBERSHIPS, PERMISSIONS, QUOTE/DISCOUNT, PAYMENT/REFUND & TABLE BILL
// ============================================================================
describe('Suite 9: Shop Memberships, Shared Quote/Discount, Payment Lifecycle & Table Billing', () => {
  test('9.1 Default role permissions enforce owner vs cashier vs staff boundaries', () => {
    const staffPerms = DEFAULT_ROLE_PERMISSIONS.staff;
    const cashierPerms = DEFAULT_ROLE_PERMISSIONS.cashier;
    const ownerPerms = DEFAULT_ROLE_PERMISSIONS.owner;

    // Staff can view/create/fulfill orders and print kitchen tickets
    assert.ok(staffPerms.includes('orders.view'));
    assert.ok(staffPerms.includes('orders.create'));
    assert.ok(staffPerms.includes('orders.fulfill'));
    assert.ok(staffPerms.includes('orders.print_kitchen'));

    // Staff CANNOT collect payment, apply discounts, refund, edit bank, or view revenue by default
    assert.ok(!staffPerms.includes('payment.collect'));
    assert.ok(!staffPerms.includes('discount.apply'));
    assert.ok(!staffPerms.includes('payment.refund'));
    assert.ok(!staffPerms.includes('settings.bank'));
    assert.ok(!staffPerms.includes('reports.view'));

    // Cashier can collect payment, apply discounts, and print provisional bills, but cannot edit bank or manage members by default
    assert.ok(cashierPerms.includes('orders.print_provisional'));
    assert.ok(cashierPerms.includes('payment.collect'));
    assert.ok(cashierPerms.includes('discount.apply'));
    assert.ok(!cashierPerms.includes('settings.bank'));
    assert.ok(!cashierPerms.includes('members.manage'));

    // Owner has all permissions
    assert.ok(ownerPerms.includes('payment.collect'));
    assert.ok(ownerPerms.includes('payment.refund'));
    assert.ok(ownerPerms.includes('settings.bank'));
    assert.ok(ownerPerms.includes('reports.view'));
    assert.ok(ownerPerms.includes('members.manage'));
  });

  test('9.2 Server API enforces staff vs cashier permissions and redacts revenue stats for staff', async () => {
    const shopId = 'shop-fnb-001';
    const staffUserId = 'staff-member-test-001';
    const cashierUserId = 'cashier-member-test-001';

    await dbUpsertShopMembership({
      shop_id: shopId,
      user_id: staffUserId,
      email: 'staff01@qlaok.vn',
      full_name: 'Nhân viên Phục vụ',
      role: 'staff',
    });

    await dbUpsertShopMembership({
      shop_id: shopId,
      user_id: cashierUserId,
      email: 'cashier01@qlaok.vn',
      full_name: 'Thu ngân Ca Sáng',
      role: 'cashier',
    });

    const staffToken = issueSessionToken({
      id: staffUserId,
      email: 'staff01@qlaok.vn',
      role: 'owner',
    });
    const cashierToken = issueSessionToken({
      id: cashierUserId,
      email: 'cashier01@qlaok.vn',
      role: 'owner',
    });

    // Staff GET /api/orders succeeds (orders.view), but revenue numbers in stats are redacted (null) because staff lacks reports.view
    const staffGetRes = await ordersGet(
      new Request(`http://localhost:3000/api/orders?shopId=${shopId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${staffToken}` },
      })
    );
    assert.equal(staffGetRes.status, 200);
    const staffGetData = await staffGetRes.json();
    assert.equal(
      staffGetData.stats?.todayRevenue,
      null,
      'Staff must not see todayRevenue'
    );
    assert.equal(
      staffGetData.stats?.totalRevenue,
      null,
      'Staff must not see totalRevenue'
    );
    assert.deepEqual(
      staffGetData.stats?.dailyRevenue7d,
      [],
      'Staff must not see 7-day revenue chart'
    );
    assert.equal(staffGetData.membership?.role, 'staff');

    // Create a new unpaid order
    const testOrder = await dbCreateOrder({
      shop_id: shopId,
      table_label: 'Bàn Phân Quyền',
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò Tái Nạm',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    // Staff can mark order as preparing/completed (orders.fulfill)
    const staffFulfillRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          orderId: testOrder.id,
          status: 'completed',
        }),
      })
    );
    assert.equal(staffFulfillRes.status, 200);
    const fulfilledData = await staffFulfillRes.json();
    assert.equal(fulfilledData.order.status, 'completed');
    assert.equal(
      fulfilledData.order.payment_status,
      'unpaid',
      'Serving an order must NOT implicitly mark it paid'
    );

    // Staff CANNOT collect payment (payment_status: 'paid') -> 403
    const staffCollectRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          orderId: testOrder.id,
          payment_status: 'paid',
        }),
      })
    );
    assert.equal(staffCollectRes.status, 403);

    // Staff CANNOT apply manual discount -> 403
    const staffDiscountRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          orderId: testOrder.id,
          discount_amount: 10000,
        }),
      })
    );
    assert.equal(staffDiscountRes.status, 403);

    // Staff CANNOT update bank QR settings on /api/shops -> 403
    const staffBankPatchRes = await shopsPatch(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({
          id: shopId,
          theme_config: {
            primaryColor: '#10b981',
            layout: 'list',
            paymentQr: {
              bankId: 'VCB',
              accountNo: '9999999999',
              accountName: 'HACKED BANK',
            },
          },
        }),
      })
    );
    assert.equal(staffBankPatchRes.status, 403);

    // Cashier CAN collect payment -> 200
    const cashierCollectRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          orderId: testOrder.id,
          payment_status: 'paid',
          payment_method: 'cash',
          payment_idempotency_key: 'pay-idemp-cashier-1',
        }),
      })
    );
    assert.equal(cashierCollectRes.status, 200);
    const paidData = await cashierCollectRes.json();
    assert.equal(paidData.order.payment_status, 'paid');

    // Clean up membership & order
    await dbDeleteShopMembership(shopId, staffUserId);
    await dbDeleteShopMembership(shopId, cashierUserId);
    await dbUpdateOrderStatus(testOrder.id, { status: 'cancelled' });
  });

  test('9.3 Shared quote engine calculates Flash Sale, Promo Banner voucher, and manual POS discounts accurately', () => {
    const quote = computeSharedOrderQuote({
      lines: [
        {
          item_id: 'item-quote-1',
          name_vi: 'Combo Lẩu Bò',
          quantity: 2,
          unit_price: 100000,
          original_unit_price: 100000,
          extra_price: 10000,
          selected_choices: [],
        },
      ],
      themeConfig: {
        primaryColor: '#10b981',
        layout: 'list',
        flashSale: {
          enabled: true,
          title: 'Flash Sale 20%',
          discountType: 'percent',
          discountValue: 20,
          itemIds: ['item-quote-1'],
        },
        promoBanner: {
          enabled: true,
          title: 'Giảm 15k cho đơn từ 100k',
          discountType: 'fixed_amount',
          discountValue: 15000,
          minOrderAmount: 100000,
          voucherCode: 'QLAOK15K',
        },
      },
      applyShopPromotions: true,
      discountCode: 'QLAOK15K',
      canApplyManualDiscount: false,
    });

    // Subtotal (100,000 + 10,000) * 2 = 220,000; Flash sale 20% off 100,000 * 2 = 40,000; Promo voucher = 15,000 -> total discount 55,000 -> total 165,000
    assert.equal(quote.subtotal_amount, 220000);
    assert.equal(quote.flash_discount_amount, 40000);
    assert.equal(quote.promo_banner_discount_amount, 15000);
    assert.equal(quote.promo_discount_amount, 55000);
    assert.equal(quote.discount_amount, 55000);
    assert.equal(quote.total_amount, 165000);
  });

  test('9.4 Editing items atomically updates subtotal/discount/bill_version, and paid orders reject item edits (ORDER_ALREADY_PAID)', async () => {
    const order = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Atomic Bill',
      source: 'counter_pos',
      isStaffAuthorized: true,
      canApplyDiscount: true,
      discount_amount: 10000,
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    assert.equal(order.subtotal_amount, 65000);
    assert.equal(order.discount_amount, 10000);
    assert.equal(order.total_amount, 55000);
    assert.equal(order.bill_version, 1);

    // Edit items to 2 bowls (130,000) while keeping 10,000 discount -> total 120,000 and bill_version 2
    const edited = await dbUpdateOrderStatus(order.id, {
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 2,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.ok(edited);
    assert.equal(edited.subtotal_amount, 130000);
    assert.equal(edited.discount_amount, 10000);
    assert.equal(edited.total_amount, 120000);
    assert.equal(edited.bill_version, 2);

    // Mark order as paid
    const paid = await dbUpdateOrderStatus(order.id, {
      payment_status: 'paid',
      payment_idempotency_key: 'pay-lock-test-1',
    });
    assert.equal(paid?.payment_status, 'paid');

    // Repeating same payment_idempotency_key is idempotent
    const paidIdemp = await dbUpdateOrderStatus(order.id, {
      payment_status: 'paid',
      payment_idempotency_key: 'pay-lock-test-1',
    });
    assert.equal(paidIdemp?.id, order.id);

    // Editing items on a paid order must throw ORDER_ALREADY_PAID
    await assert.rejects(
      async () => {
        await dbUpdateOrderStatus(order.id, {
          items: [
            {
              item_id: 'item-fnb-1',
              name_vi: 'Phở Bò',
              quantity: 3,
              unit_price: 55000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        });
      },
      (err: Error) => err.message.includes('ORDER_ALREADY_PAID')
    );

    // Refund transition paid -> refunded
    const refunded = await dbUpdateOrderStatus(order.id, {
      payment_status: 'refunded',
      refund_reason: 'Khách đổi món sau khi thanh toán',
      refunded_by: 'owner-demo-001',
    });
    assert.equal(refunded?.payment_status, 'refunded');
    assert.equal(refunded?.refund_reason, 'Khách đổi món sau khi thanh toán');

    await dbUpdateOrderStatus(order.id, { status: 'cancelled' });
  });

  test('9.5 Kitchen waste policy (restock_items: false) records waste without restoring stock, and revenue counts only paid orders', async () => {
    const wasteItemId = 'unit-test-item-waste-905';
    await setItemStockMetadata(wasteItemId, 10, 0);

    const order = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Hủy Bếp',
      items: [
        {
          item_id: wasteItemId,
          name_vi: 'Món Đã Nấu Hủy',
          quantity: 3,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    // Move to preparing (kitchen started cooking)
    await dbUpdateOrderStatus(order.id, { status: 'preparing' });

    // Cancel with restock_items: false (kitchen waste)
    const cancelledWaste = await dbUpdateOrderStatus(order.id, {
      status: 'cancelled',
      restock_items: false,
      cancelled_reason: 'Khách bỏ về khi bếp đã chế biến',
    });
    assert.equal(cancelledWaste?.status, 'cancelled');
    assert.equal(cancelledWaste?.waste_recorded, true);

    // Stock must remain 7 (not restored to 10) because kitchen already cooked the items
    const enrichedAfterWaste = enrichItemsWithInventory([
      {
        id: wasteItemId,
        shop_id: 'shop-fnb-001',
        category_id: 'cat-fnb-1',
        sort_order: 1,
        price: 50000,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Món Đã Nấu Hủy' },
        desc_i18n: { vi: '' },
        options_json: [],
        view_count: 0,
      },
    ]);
    assert.equal(enrichedAfterWaste[0].stock_quantity, 7);

    // Verify completed-but-unpaid order does NOT inflate revenue stats
    const sampleItems = enrichItemsWithInventory(
      SEED_ITEMS.filter((i) => i.shop_id === 'shop-fnb-001')
    );
    const baselineRevenue = computeShopRevenueAndInventoryStats(
      'shop-fnb-001',
      sampleItems
    ).totalRevenue;

    const servedUnpaid = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Phục Vụ Chưa Thu',
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(servedUnpaid.id, { status: 'completed' });

    const afterServedUnpaidRevenue = computeShopRevenueAndInventoryStats(
      'shop-fnb-001',
      sampleItems
    ).totalRevenue;
    assert.equal(
      afterServedUnpaidRevenue,
      baselineRevenue,
      'Completed but unpaid order must not be added to collected revenue'
    );

    await dbUpdateOrderStatus(servedUnpaid.id, { payment_status: 'paid' });
    const afterPaidRevenue = computeShopRevenueAndInventoryStats(
      'shop-fnb-001',
      sampleItems
    ).totalRevenue;
    assert.equal(
      afterPaidRevenue,
      baselineRevenue + servedUnpaid.total_amount,
      'Once paid, order total must be added to collected revenue'
    );

    await dbUpdateOrderStatus(servedUnpaid.id, { status: 'cancelled' });
  });

  test('9.6 Table bill combines multiple unpaid rounds for the same table session and settles them together', async () => {
    const sessionId = `sess-table-09-${Date.now()}`;
    const round1 = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn 09 Gộp Bill',
      session_id: sessionId,
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const round2 = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn 09 Gộp Bill',
      session_id: sessionId,
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 2,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    const billBefore = await dbGetTableBill({
      shop_id: 'shop-fnb-001',
      session_id: sessionId,
    });
    assert.equal(billBefore.order_ids.length, 2);
    assert.equal(
      billBefore.total_amount,
      round1.total_amount + round2.total_amount
    );
    assert.equal(billBefore.payment_status, 'unpaid');

    const settledBill = await dbSettleTableBill({
      shop_id: 'shop-fnb-001',
      session_id: sessionId,
      payment_method: 'vietqr',
      paid_by: 'owner-demo-001',
    });
    assert.equal(settledBill.payment_status, 'paid');

    const r1After = await dbGetOrderById(round1.id);
    const r2After = await dbGetOrderById(round2.id);
    assert.equal(r1After?.payment_status, 'paid');
    assert.equal(r2After?.payment_status, 'paid');

    await dbUpdateOrderStatus(round1.id, { status: 'cancelled' });
    await dbUpdateOrderStatus(round2.id, { status: 'cancelled' });
  });

  test('9.7 Customer tracking_token allows pre-acceptance order edit while new+unpaid and blocks edit once preparing', async () => {
    const created = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn QR Khách',
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.ok(created.tracking_token);

    // Customer edit WITH valid trackingToken while status === 'new' -> 200
    const validCustomerEditRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: created.id,
          trackingToken: created.tracking_token,
          customer_note: 'Ít hành, thêm ớt',
          items: [
            {
              item_id: 'item-fnb-1',
              name_vi: 'Phở Bò',
              quantity: 2,
              unit_price: 55000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(validCustomerEditRes.status, 200);
    const editedPayload = await validCustomerEditRes.json();
    assert.equal(editedPayload.order.items[0].quantity, 2);

    // Move order to 'preparing'
    await dbUpdateOrderStatus(created.id, { status: 'preparing' });

    // Customer edit after kitchen accepted ('preparing') -> 409 conflict
    const lateCustomerEditRes = await ordersPatch(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: created.id,
          trackingToken: created.tracking_token,
          customer_note: 'Đổi ý sau khi bếp đã nấu',
        }),
      })
    );
    assert.equal(lateCustomerEditRes.status, 409);

    await dbUpdateOrderStatus(created.id, { status: 'cancelled' });
  });

  test('9.8 Unconfigured bank QR returns isConfigured=false and empty qrImageUrl (no fake demo account 0905123456), and print counters increment per ticket type', async () => {
    const unconfiguredShop = {
      ...SEED_SHOPS[0],
      theme_config: {
        primaryColor: '#10b981',
        layout: 'list' as const,
      },
    };
    const qrInfo = getShopPaymentQrInfo(unconfiguredShop, 120000, 'ORD-123');
    assert.equal(qrInfo.isConfigured, false);
    assert.equal(qrInfo.qrImageUrl, '');
    assert.ok(!qrInfo.accountNumber.includes('0905123456'));

    // Configured mobile paymentQr works seamlessly with getShopPaymentQrInfo
    const configuredShop = {
      ...SEED_SHOPS[0],
      theme_config: {
        primaryColor: '#10b981',
        layout: 'list' as const,
        paymentQr: {
          bankId: 'VCB',
          accountNo: '0123456789',
          accountName: 'NGUYEN VAN A',
        },
      },
    };
    const validQr = getShopPaymentQrInfo(configuredShop, 120000, 'ORD-123');
    assert.equal(validQr.isConfigured, true);
    assert.ok(validQr.qrImageUrl.includes('img.vietqr.io/image/VCB-0123456789'));

    // Ticket print counters track kitchen, provisional, and receipt separately
    const order = await dbCreateOrder({
      shop_id: 'shop-fnb-001',
      table_label: 'Bàn Test In Phiếu',
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const afterKitchen1 = await dbRecordOrderPrint(order.id, 'kitchen');
    assert.equal(afterKitchen1?.order.kitchen_printed_count, 1);
    assert.equal(afterKitchen1?.order.provisional_printed_count || 0, 0);
    assert.equal(afterKitchen1?.isReprint, false);

    const afterProvisional1 = await dbRecordOrderPrint(order.id, 'provisional');
    assert.equal(afterProvisional1?.order.kitchen_printed_count, 1);
    assert.equal(afterProvisional1?.order.provisional_printed_count, 1);

    const afterReceipt1 = await dbRecordOrderPrint(order.id, 'receipt');
    assert.equal(afterReceipt1?.order.receipt_printed_count, 1);
    assert.equal(afterReceipt1?.order.print_count, 3);

    const afterReceipt2 = await dbRecordOrderPrint(order.id, 'receipt');
    assert.equal(afterReceipt2?.order.receipt_printed_count, 2);
    assert.equal(afterReceipt2?.isReprint, true);

    await dbUpdateOrderStatus(order.id, { status: 'cancelled' });
  });
});
