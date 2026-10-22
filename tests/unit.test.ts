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
  localizeStorefrontTableError,
  localizeGuestOrderError,
  getGuestOrderLabels,
  GUEST_ORDER_LABELS,
  normalizeShopSupportedLangs,
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
  setOpeningHoursEnforcementForTests,
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
  readCredentials,
  verifyPassword,
  writeCredentials,
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
import {
  shouldRefreshStorefrontCatalog,
  STOREFRONT_MENU_POLL_INTERVAL_MS,
  STOREFRONT_MENU_STALE_REFRESH_MS,
} from '@/lib/table-helpers';
import {
  evaluateShopSetupChecklist,
  hasConfiguredStoreInfo,
  normalizeShopSlugInput,
  requiresSlugChangeConfirmation,
} from '@/lib/shop-setup-checklist';
import {
  buildPasswordRecoveryRedirectUrl,
  completeMobilePasswordRecoveryWithCode,
  completePasswordRecoverySession,
  formatGenericPasswordRecoveryNotice,
  parseRecoveryUrlSignals,
  requestMobilePasswordRecovery,
  resolveLoginAuthMode,
} from '../mobile/src/lib/auth-recovery';
import {
  buildPasswordRecoveryRedirectUrl as buildWebPasswordRecoveryRedirectUrl,
  completePasswordRecoverySession as completeWebPasswordRecoverySession,
  formatGenericPasswordRecoveryNotice as formatWebGenericPasswordRecoveryNotice,
  parseRecoveryUrlSignals as parseWebRecoveryUrlSignals,
  resolveLoginAuthMode as resolveWebLoginAuthMode,
} from '@/lib/auth-recovery';
import {
  buildOnboardingFirstCategoryId,
  buildOnboardingFirstItemId,
  executeOnboardingCompletion,
  formatOnboardingBulkImportError,
} from '@/lib/onboarding-flow';
import {
  dbBulkImportCatalog,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { execFileSync } from 'node:child_process';
import { canAccessDashboardHref } from '@/lib/dashboard-nav';
import {
  DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES,
  DEFAULT_KDS_OVERDUE_THRESHOLD_MS,
  buildKitchenFulfillPatchPayload,
  buildKitchenOrdersUrl,
  canPerformKitchenFulfill,
  createInitialKitchenOrdersState,
  createKitchenShopScopeTracker,
  formatKitchenLineOptionLabel,
  formatKitchenOrderAge,
  getKitchenOrderAgeMinutes,
  getNextKitchenOrderStatus,
  isActiveKitchenOrder,
  isKitchenOrderOverdue,
  isKitchenShopScopeCurrent,
  reconcileKitchenOrdersFetch,
  selectAndSortKitchenOrders,
  shouldShowKitchenConfirmedEmptyState,
  summarizeKitchenQueue,
} from '@/lib/kitchen-display';
import type {
  CatalogItem,
  Category,
  OpeningHours,
  Shop,
  ShopOrder,
} from '@/types/qlaok';

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

  test('2.9 checkShopOpenStatus evaluates closed days and 24-hour open schedules', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 18, 12).getTime() });
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
    for (const [hour, minute] of [[0, 0], [7, 30], [12, 0], [23, 59]]) {
      t.mock.timers.setTime(new Date(2026, 9, 18, hour, minute).getTime());
      assert.equal(checkShopOpenStatus(alwaysOpen).isOpen, true, `open at ${hour}:${minute}`);
    }
  });

  test('2.10 UI_LABELS & QUICK_TAGS_BY_VERTICAL have complete 8-locale translations', () => {
    for (const loc of ALL_LOCALES) {
      assert.ok(UI_LABELS[loc].openNow.length > 0);
      assert.ok(UI_LABELS[loc].soldOut.length > 0);
      assert.ok(UI_LABELS[loc].bottomCtaFnb.length > 0);
      assert.ok(UI_LABELS[loc].cashPayment.length > 0);
      assert.ok(UI_LABELS[loc].qrPayment.length > 0);
      assert.ok(UI_LABELS[loc].tablePrefix.length > 0);
      assert.ok(UI_LABELS[loc].tableSelectorLabel.length > 0);
      assert.ok(UI_LABELS[loc].noTableSelected.length > 0);
      assert.ok(UI_LABELS[loc].selectTableBeforeSendError.length > 0);
      assert.ok(UI_LABELS[loc].tableConfirmationRequiredTitle.length > 0);
      assert.ok(UI_LABELS[loc].tableQrUnavailableTitle.length > 0);
      assert.ok(UI_LABELS[loc].tableQrInvalidError.length > 0);
      assert.ok(UI_LABELS[loc].tableInactiveError('Bàn 01').includes('Bàn 01'));
      assert.ok(UI_LABELS[loc].tableNotFoundError('T99').includes('T99'));
      assert.ok(UI_LABELS[loc].tablesLoadError.length > 0);
      assert.ok(UI_LABELS[loc].noActiveTablesTakeawayHint.length > 0);
      assert.ok(UI_LABELS[loc].qrNotConfiguredNotice.length > 0);
      assert.ok(UI_LABELS[loc].editingOrderHint.length > 0);
      assert.ok(UI_LABELS[loc].addMoreItemsBtn.length > 0);
      assert.ok(UI_LABELS[loc].keepingExistingTablePrefix('QL-101').includes('QL-101'));
      assert.ok(UI_LABELS[loc].retryBtn.length > 0);
      assert.ok(UI_LABELS[loc].submitOrderError.length > 0);
      assert.ok(UI_LABELS[loc].closeOrderModalAria.length > 0);
      assert.ok(UI_LABELS[loc].paymentMethodGroupAria.length > 0);
      assert.ok(UI_LABELS[loc].decreaseQtyAria('Phở').includes('Phở'));
      assert.ok(UI_LABELS[loc].increaseQtyAria('Phở').includes('Phở'));
      assert.ok(UI_LABELS[loc].clearSearchAria.length > 0);
      assert.ok(UI_LABELS[loc].selectLanguageAria.length > 0);

      if (loc !== 'en') {
        assert.notEqual(
          UI_LABELS[loc].qrNotConfiguredNotice,
          UI_LABELS.en.qrNotConfiguredNotice,
          `Locale ${loc} must not leak English QR unconfigured message`
        );
        assert.notEqual(
          UI_LABELS[loc].noTableSelected,
          UI_LABELS.en.noTableSelected,
          `Locale ${loc} must not leak English noTableSelected`
        );
      }

      assert.equal(
        localizeStorefrontTableError(UI_LABELS.vi.tableQrInvalidError, loc),
        UI_LABELS[loc].tableQrInvalidError
      );
      assert.equal(
        localizeStorefrontTableError(UI_LABELS.vi.tableInactiveError('VIP 2'), loc),
        UI_LABELS[loc].tableInactiveError('VIP 2')
      );
      assert.equal(
        localizeStorefrontTableError(UI_LABELS.vi.tableNotFoundError('A09'), loc),
        UI_LABELS[loc].tableNotFoundError('A09')
      );
      assert.equal(
        localizeStorefrontTableError(UI_LABELS.vi.tablesLoadError, loc),
        UI_LABELS[loc].tablesLoadError
      );
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

  test('8.5 (P0 #5) Payment API blocks public switch_plan_direct, enforces owner/admin authority on create_order, and rejects unsigned or unknown webhooks', async () => {
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

    // Anonymous create_order -> 401
    const anonCreateOrderRes = await paymentPost(
      new Request('http://localhost:3000/api/webhooks/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          targetPlan: 'premium',
        }),
      })
    );
    assert.equal(anonCreateOrderRes.status, 401);

    // Seeded cashier/staff create_order -> 403
    const seededCashierToken = issueSessionToken({
      id: 'cashier-demo-001',
      email: 'thungan@qlaok.vn',
      role: 'owner',
    });
    const cashierCreateOrderRes = await paymentPost(
      new Request('http://localhost:3000/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${seededCashierToken}`,
        },
        body: JSON.stringify({
          action: 'create_order',
          targetPlan: 'basic',
        }),
      })
    );
    assert.equal(cashierCreateOrderRes.status, 403);

    // Non-admin owner attempting to spoof another ownerId on create_order -> 403
    const demoOwnerToken = issueSessionToken({
      id: SEED_PROFILE.id,
      email: SEED_PROFILE.email,
      role: 'owner',
    });
    const spoofOwnerCreateRes = await paymentPost(
      new Request('http://localhost:3000/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${demoOwnerToken}`,
        },
        body: JSON.stringify({
          action: 'create_order',
          targetPlan: 'premium',
          ownerId: 'owner-other-victim',
        }),
      })
    );
    assert.equal(spoofOwnerCreateRes.status, 403);

    // No hardcoded fallback secret exists any more: configure one explicitly for this test.
    // (<16 chars so it never becomes the session signing secret fallback.)
    const previousWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const secret = 'unit-test-whsec';
    process.env.PAYMENT_WEBHOOK_SECRET = secret;
    try {
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

    // Wrong secret -> 401
    const wrongSecretRes = await paymentPost(
      new Request('http://localhost:3000/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'qlaok-webhook-secret-v1',
        },
        body: JSON.stringify({ orderCode: 'QLAOKP99999' }),
      })
    );
    assert.equal(wrongSecretRes.status, 401);
    } finally {
      if (previousWebhookSecret === undefined) {
        delete process.env.PAYMENT_WEBHOOK_SECRET;
      } else {
        process.env.PAYMENT_WEBHOOK_SECRET = previousWebhookSecret;
      }
    }

    // Secret not configured -> every provider webhook is rejected (503), even with the old default secret
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    try {
      const unconfiguredRes = await paymentPost(
        new Request('http://localhost:3000/api/webhooks/payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'qlaok-webhook-secret-v1',
          },
          body: JSON.stringify({ orderCode: 'QLAOKP99999' }),
        })
      );
      assert.equal(unconfiguredRes.status, 503);
    } finally {
      if (previousWebhookSecret !== undefined) {
        process.env.PAYMENT_WEBHOOK_SECRET = previousWebhookSecret;
      }
    }
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

// ============================================================================
// SUITE 9B: STAFF LOGIN ROUTING, ROLE NAV, INVENTORY.ADJUST & MEMBER MGMT
// (dynamic imports keep the shared import header merge-safe)
// ============================================================================
describe('Suite 9B: Staff login routing, role-based nav, inventory.adjust & member management', () => {
  test('9B.1 inventory.adjust is a known permission granted to owner, cashier and staff by default', async () => {
    const { ALL_SHOP_PERMISSIONS } = await import('@/lib/shop-permissions');
    const { CLIENT_ALL_SHOP_PERMISSIONS } = await import('@/lib/dashboard-nav');
    assert.ok(ALL_SHOP_PERMISSIONS.includes('inventory.adjust'));
    assert.deepEqual(
      [...CLIENT_ALL_SHOP_PERMISSIONS].sort(),
      [...ALL_SHOP_PERMISSIONS].sort(),
      'Client permission list must stay in sync with server ALL_SHOP_PERMISSIONS'
    );
    for (const role of ['owner', 'cashier', 'staff'] as const) {
      assert.ok(
        DEFAULT_ROLE_PERMISSIONS[role].includes('inventory.adjust'),
        `${role} must be able to toggle availability / stock`
      );
    }
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.staff.includes('catalog.manage'));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.cashier.includes('catalog.manage'));
  });

  test('9B.2 catalog item diff: only stock/availability changes accept inventory.adjust', async () => {
    const { getCatalogItemUpdatePermissionOptions, buildInventoryOnlyItemPatch } =
      await import('@/lib/shop-permissions');
    const existing = {
      id: 'item-x',
      shop_id: 'shop-x',
      category_id: 'cat-x',
      price: '35000',
      is_available: true,
      stock_quantity: 5,
      name_i18n: { vi: 'Cà phê', en: 'Coffee' },
      updated_at: '2026-01-01T00:00:00Z',
    };
    // availability + stock only (with echoed unchanged fields, numeric price, reordered i18n keys)
    assert.deepEqual(
      getCatalogItemUpdatePermissionOptions(
        {
          ...existing,
          price: 35000,
          name_i18n: { en: 'Coffee', vi: 'Cà phê' },
          is_available: false,
          stock_quantity: 0,
          updated_at: '2026-02-02T00:00:00Z',
          sold_count: 99,
        },
        existing
      ),
      ['catalog.manage', 'inventory.adjust']
    );
    // price change requires catalog.manage
    assert.deepEqual(
      getCatalogItemUpdatePermissionOptions({ ...existing, price: 40000 }, existing),
      ['catalog.manage']
    );
    // renaming requires catalog.manage
    assert.deepEqual(
      getCatalogItemUpdatePermissionOptions(
        { ...existing, name_i18n: { vi: 'Trà' } },
        existing
      ),
      ['catalog.manage']
    );
    // moving shops or creating new items requires catalog.manage
    assert.deepEqual(
      getCatalogItemUpdatePermissionOptions({ ...existing, shop_id: 'other' }, existing),
      ['catalog.manage']
    );
    assert.deepEqual(
      getCatalogItemUpdatePermissionOptions({ ...existing }, null),
      ['catalog.manage']
    );

    const patch = buildInventoryOnlyItemPatch(
      { ...existing, price: 1, is_available: false, stock_quantity: '3' },
      existing
    );
    assert.deepEqual(patch, {
      id: 'item-x',
      shop_id: 'shop-x',
      category_id: 'cat-x',
      is_available: false,
      stock_quantity: 3,
    });
    assert.throws(() =>
      buildInventoryOnlyItemPatch({ stock_quantity: -1 }, existing)
    );
  });

  test('9B.3 post-login routing: admin, owner, member, next param and onboarding only with zero shops', async () => {
    const { resolvePostLoginRoute, sanitizeNextPath } = await import(
      '@/lib/post-login-route'
    );
    assert.equal(resolvePostLoginRoute({ isAdmin: true, shops: [{ id: 'a' }] }).path, '/admin');
    assert.equal(resolvePostLoginRoute({ shops: [], memberShops: [] }).path, '/onboarding');
    const member = resolvePostLoginRoute({ shops: [], memberShops: [{ id: 'm1' }] });
    assert.equal(
      member.path,
      '/dashboard/orders',
      'Staff with a membership must route directly to /dashboard/orders and NOT onboarding'
    );
    assert.equal(member.activeShopId, 'm1');
    assert.equal(
      resolvePostLoginRoute({ shops: [{ id: 'o1' }] }, '/dashboard/orders?tab=new').path,
      '/dashboard/orders?tab=new'
    );
    for (const bad of [
      'https://evil.com',
      '//evil.com/x',
      '/\\evil.com',
      'javascript:alert(1)',
      'dashboard',
      '/login?next=/x',
      '/onboarding',
    ]) {
      assert.equal(sanitizeNextPath(bad), null, `must reject ${bad}`);
      assert.equal(
        resolvePostLoginRoute({ shops: [{ id: 'o1' }] }, bad).path,
        '/dashboard'
      );
      assert.equal(
        resolvePostLoginRoute({ shops: [], memberShops: [{ id: 'm1' }] }, bad).path,
        '/dashboard/orders'
      );
    }
  });

  test('9B.4 role-based dashboard nav hides sensitive items and redirects staff away from overview', async () => {
    const {
      canAccessDashboardHref,
      getFallbackDashboardHref,
      getNavRequirementForPath,
    } = await import('@/lib/dashboard-nav');
    const mk = (role: 'owner' | 'cashier' | 'staff') => ({
      role,
      permissions: DEFAULT_ROLE_PERMISSIONS[role],
      is_active: true,
    });
    const staff = mk('staff');
    const cashier = mk('cashier');
    const owner = mk('owner');

    // Loading / missing membership is never treated as allowed
    assert.equal(canAccessDashboardHref('/dashboard/orders', null), false);
    assert.equal(canAccessDashboardHref('/dashboard/settings', undefined), false);

    assert.equal(canAccessDashboardHref('/dashboard', staff), false);
    assert.equal(canAccessDashboardHref('/dashboard/reports', staff), false);
    assert.equal(canAccessDashboardHref('/dashboard/orders', staff), true);
    assert.equal(canAccessDashboardHref('/dashboard/catalog', staff), true, 'inventory.adjust opens catalog');
    assert.equal(canAccessDashboardHref('/dashboard/ai-scanner', staff), false);
    assert.equal(canAccessDashboardHref('/dashboard/posts', cashier), false);
    assert.equal(canAccessDashboardHref('/dashboard/settings', cashier), false);
    assert.equal(canAccessDashboardHref('/dashboard/billing', cashier), false);
    assert.equal(
      canAccessDashboardHref('/dashboard/billing', { ...cashier, permissions: [...DEFAULT_ROLE_PERMISSIONS.owner] }),
      false,
      'billing is owner-only even with every permission'
    );
    assert.equal(canAccessDashboardHref('/dashboard/billing', owner), true);
    assert.equal(canAccessDashboardHref('/dashboard/orders', { ...staff, is_active: false }), false);

    assert.equal(getFallbackDashboardHref(staff), '/dashboard/orders');
    assert.deepEqual(getNavRequirementForPath('/dashboard/settings/anything'), { anyOf: ['settings.manage'] });
  });

  test('9B.5 catalog API upsert_item still rejects unauthenticated callers and non-members before any write', async () => {
    // DB-backed allow paths (staff toggle OK / staff price edit 403) depend on
    // Supabase and are covered at the decision level by 9B.2.
    const { POST: catalogPost } = await import('@/app/api/catalog/route');
    const shopId = 'shop-fnb-001';
    const item = { id: 'item-fnb-1', shop_id: shopId, category_id: 'cat-fnb-1', is_available: false };
    const call = (headers: Record<string, string>) =>
      catalogPost(
        new Request('http://localhost:3000/api/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ action: 'upsert_item', item }),
        })
      );
    const anon = await call({});
    assert.equal(anon.status, 401);
    const stranger = issueSessionToken({ id: 'stranger-9b', email: 's9b@qlaok.vn', role: 'owner' });
    const strangerRes = await call({ Authorization: `Bearer ${stranger}` });
    assert.equal(strangerRes.status, 403, 'non-members are rejected even for availability-only updates');
  });

  test('9B.6 member management API is owner-only and validates invite role/email', async () => {
    const shopId = 'shop-fnb-001';
    const ownerToken = issueSessionToken({ id: SEED_PROFILE.id, email: SEED_PROFILE.email, role: 'owner' });
    const cashierUserId = 'cashier-members-test-9b';
    await dbUpsertShopMembership({ shop_id: shopId, user_id: cashierUserId, role: 'cashier', email: 'c9b@qlaok.vn' });
    const cashierToken = issueSessionToken({ id: cashierUserId, email: 'c9b@qlaok.vn', role: 'owner' });
    const post = (token: string, body: Record<string, unknown>) =>
      shopsPost(
        new Request('http://localhost:3000/api/shops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shop_id: shopId, ...body }),
        })
      );

    try {
      const forbidden = await post(cashierToken, { action: 'invite_member', email: 'x@qlaok.vn', role: 'staff' });
      assert.equal(forbidden.status, 403, 'non-owners cannot invite');

      const badRole = await post(ownerToken, { action: 'invite_member', email: 'x@qlaok.vn', role: 'owner' });
      assert.equal(badRole.status, 400, 'owner role is never invitable');

      const badEmail = await post(ownerToken, { action: 'invite_member', email: 'nope', role: 'staff' });
      assert.equal(badEmail.status, 400);

      const ownerSelf = await post(ownerToken, { action: 'upsert_member', user_id: SEED_PROFILE.id, role: 'staff' });
      assert.equal(ownerSelf.status, 400, 'shop owner membership cannot be downgraded');

      // Role change keeps the stored email when the caller omits it
      const changed = await post(ownerToken, { action: 'upsert_member', user_id: cashierUserId, role: 'staff' });
      assert.equal(changed.status, 200);
      const changedData = await changed.json();
      assert.equal(changedData.membership.role, 'staff');
      assert.equal(changedData.membership.email, 'c9b@qlaok.vn');

      const deactivated = await post(ownerToken, { action: 'upsert_member', user_id: cashierUserId, role: 'staff', is_active: false });
      assert.equal((await deactivated.json()).membership.is_active, false);

      const removed = await post(ownerToken, { action: 'delete_member', user_id: cashierUserId });
      assert.equal(removed.status, 200);
      assert.equal((await removed.json()).deleted, true);
    } finally {
      await dbDeleteShopMembership(shopId, cashierUserId);
    }
  });
});

describe('Guest flow: opening hours (timezone + overnight), SHOP_CLOSED, error localization', () => {
  const week = (open: string, close: string, closed = false): OpeningHours => ({
    mon: { open, close, closed },
    tue: { open, close, closed },
    wed: { open, close, closed },
    thu: { open, close, closed },
    fri: { open, close, closed },
    sat: { open, close, closed },
    sun: { open, close, closed },
  });
  // Asia/Ho_Chi_Minh is UTC+7 (no DST): VN local = UTC + 7h
  const vn = (isoLocal: string) => new Date(`${isoLocal}+07:00`);

  test('G.1 checkShopOpenStatus evaluates in the shop timezone, not the runtime clock', () => {
    const hours = week('08:00', '22:00');
    // 2026-10-19 (Mon) 07:30 VN = 00:30 UTC → closed in VN regardless of host TZ
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T07:30:00') }).isOpen, false);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T08:00:00') }).isOpen, true);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T21:59:00') }).isOpen, true);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T22:01:00') }).isOpen, false);
    // Same instant evaluated in another zone gives a different answer
    const instant = vn('2026-10-19T23:00:00'); // 16:00 UTC
    assert.equal(checkShopOpenStatus(hours, { now: instant }).isOpen, false);
    assert.equal(checkShopOpenStatus(hours, { now: instant, timeZone: 'UTC' }).isOpen, true);
  });

  test('G.2 checkShopOpenStatus supports overnight ranges (close < open) incl. previous-day tail', () => {
    const hours = week('18:00', '02:00');
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T17:59:00') }).isOpen, false);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T18:00:00') }).isOpen, true);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-19T23:45:00') }).isOpen, true);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-20T01:30:00') }).isOpen, true);
    assert.equal(checkShopOpenStatus(hours, { now: vn('2026-10-20T02:30:00') }).isOpen, false);

    // Previous day closed → no early-morning tail today
    const mondayOff: OpeningHours = { ...hours, mon: { open: '18:00', close: '02:00', closed: true } };
    assert.equal(checkShopOpenStatus(mondayOff, { now: vn('2026-10-20T01:00:00') }).isOpen, false);
    // ...but Tuesday evening opens normally
    assert.equal(checkShopOpenStatus(mondayOff, { now: vn('2026-10-20T19:00:00') }).isOpen, true);
  });

  test('G.3 missing / unparseable opening hours are treated as open; closed days stay closed', () => {
    const now = vn('2026-10-19T03:00:00');
    assert.equal(checkShopOpenStatus(null, { now }).isOpen, true);
    assert.equal(checkShopOpenStatus(undefined, { now }).isOpen, true);
    assert.equal(checkShopOpenStatus({} as OpeningHours, { now }).isOpen, true);
    assert.equal(checkShopOpenStatus(week('abc', '??'), { now }).isOpen, true);
    assert.equal(checkShopOpenStatus(week('08:00', '08:00'), { now }).isOpen, true, 'open==close → 24h');
    assert.equal(checkShopOpenStatus(week('08:00', '22:00', true), { now: vn('2026-10-19T12:00:00') }).isOpen, false);
  });

  test('G.4 dbCreateOrder rejects guest orders with SHOP_CLOSED outside opening hours (staff POS exempt)', async () => {
    await setItemStockMetadata('item-fnb-1', 50, 0);
    setOpeningHoursEnforcementForTests(true);
    try {
      // Seed shop-fnb-001 hours: Mon 07:00–22:30 (VN)
      const closedNow = vn('2026-10-19T23:30:00');
      const guestOrder = {
        shop_id: 'shop-fnb-001',
        table_label: 'Mang về',
        source: 'qr_table' as const,
        items: [{ item_id: 'item-fnb-1', name_vi: 'Phở', quantity: 1, unit_price: 65000, extra_price: 0, selected_choices: [] }],
      };
      await assert.rejects(
        dbCreateOrder({ ...guestOrder, now: closedNow }),
        (err: Error) => err.message.startsWith('SHOP_CLOSED:')
      );

      const staffOrder = await dbCreateOrder({
        ...guestOrder,
        source: 'counter_pos',
        isStaffAuthorized: true,
        now: closedNow,
      });
      assert.equal(staffOrder.status, 'new');
      await dbUpdateOrderStatus(staffOrder.id, { status: 'cancelled' });

      const openOrder = await dbCreateOrder({ ...guestOrder, now: vn('2026-10-19T12:00:00') });
      assert.equal(openOrder.status, 'new');
      await dbUpdateOrderStatus(openOrder.id, { status: 'cancelled' });
    } finally {
      setOpeningHoursEnforcementForTests(null);
    }
  });

  test('G.5 POST /api/orders returns 409 + code SHOP_CLOSED for guest orders while closed', async (t) => {
    setOpeningHoursEnforcementForTests(true);
    t.mock.timers.enable({ apis: ['Date'], now: vn('2026-10-19T23:45:00').getTime() });
    try {
      const res = await ordersPost(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: 'shop-fnb-001',
            table_label: 'Mang về',
            source: 'qr_table',
            items: [{ item_id: 'item-fnb-1', name_vi: 'Phở', quantity: 1, unit_price: 65000, extra_price: 0, selected_choices: [] }],
          }),
        })
      );
      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.code, 'SHOP_CLOSED');
      assert.equal(localizeGuestOrderError({ code: data.code, error: data.error, status: res.status }, 'en'), getGuestOrderLabels('en').errorShopClosed);
    } finally {
      t.mock.timers.reset();
      setOpeningHoursEnforcementForTests(null);
    }
  });

  test('G.6 localizeGuestOrderError maps server codes to localized text and never leaks raw CODE strings', () => {
    const ko = getGuestOrderLabels('ko');
    assert.equal(localizeGuestOrderError({ code: 'ITEM_UNAVAILABLE' }, 'ko'), ko.errorItemUnavailable);
    assert.equal(localizeGuestOrderError({ error: 'ITEM_UNAVAILABLE: Món "Phở" hiện đã tạm hết hàng.' }, 'vi'), getGuestOrderLabels('vi').errorItemUnavailable);
    assert.equal(localizeGuestOrderError({ error: 'INSUFFICIENT_STOCK: Món "Phở" chỉ còn 2 phần trong kho.' }, 'en'), getGuestOrderLabels('en').errorInsufficientStock);
    assert.equal(localizeGuestOrderError({ error: 'INACTIVE_SHOP_TABLE: Bàn "B1" hiện đang tạm ngưng.' }, 'ja'), getGuestOrderLabels('ja').errorTableInactive);
    assert.equal(localizeGuestOrderError({ error: 'INVALID_TABLE_SHOP: x' }, 'zh'), getGuestOrderLabels('zh').errorTableInvalid);
    assert.equal(localizeGuestOrderError({ code: 'PRICE_CHANGED', status: 409 }, 'es'), getGuestOrderLabels('es').errorPriceChanged);
    assert.equal(localizeGuestOrderError({ code: 'ORDER_ALREADY_ACCEPTED', status: 409 }, 'it'), getGuestOrderLabels('it').errorOrderAccepted);
    // Legacy 409 without code → already accepted
    assert.equal(localizeGuestOrderError({ error: 'Đơn hàng đã được bếp tiếp nhận', status: 409 }, 'ru'), getGuestOrderLabels('ru').errorOrderAccepted);
    // Unknown / raw Vietnamese → generic, never the raw text
    const generic = localizeGuestOrderError({ error: 'SOMETHING_WEIRD: Lỗi lạ' }, 'en');
    assert.equal(generic, getGuestOrderLabels('en').errorGeneric);
    assert.ok(!generic.includes('SOMETHING_WEIRD'));

    // Every locale resolves every key (English fallback for partial locales)
    for (const loc of ALL_LOCALES) {
      const labels = getGuestOrderLabels(loc);
      assert.ok(GUEST_ORDER_LABELS[loc], `labels for ${loc}`);
      assert.ok(labels.errorShopClosed.length > 0 && labels.statusCancelledTitle.length > 0, loc);
      assert.ok(labels.shopClosedSub('08:00', '22:00').includes('08:00'), loc);
    }
  });

  test('G.7 normalizeShopSupportedLangs respects configured langs and defaults to vi+en', () => {
    assert.deepEqual(normalizeShopSupportedLangs(['vi']), ['vi']);
    assert.deepEqual(normalizeShopSupportedLangs(['en', 'ko', 'ko', 'xx']), ['en', 'ko']);
    assert.deepEqual(normalizeShopSupportedLangs([]), ['vi', 'en']);
    assert.deepEqual(normalizeShopSupportedLangs(undefined), ['vi', 'en']);
    assert.deepEqual(getAllowedLocalesForPlan('premium', normalizeShopSupportedLangs(['vi'])), ['vi']);
  });

  test('G.8 LanguageSwitcher shows only the configured locale for one-language stores while omitted supportedLangs retains ALL_LOCALES', async () => {
    await import('./tsx-review-loader.mjs');
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LanguageSwitcher } = await import(
      '@/components/storefront/LanguageSwitcher'
    );

    const oneLangVi = getAllowedLocalesForPlan(
      'premium',
      normalizeShopSupportedLangs(['vi'])
    );
    assert.deepEqual(oneLangVi, ['vi']);

    const singleViHtml = renderToStaticMarkup(
      React.createElement(LanguageSwitcher, {
        currentLocale: 'vi',
        supportedLangs: oneLangVi,
        onChange: () => {},
      })
    );
    assert.ok(singleViHtml.includes(LOCALE_META.vi.nativeName));
    for (const loc of ALL_LOCALES) {
      if (loc === 'vi') continue;
      assert.equal(
        singleViHtml.includes(LOCALE_META[loc].nativeName),
        false,
        `One-language store (vi) must not show ${loc}`
      );
    }

    const freePlanSingleHtml = renderToStaticMarkup(
      React.createElement(LanguageSwitcher, {
        currentLocale: 'ko',
        supportedLangs: getAllowedLocalesForPlan(
          'free',
          normalizeShopSupportedLangs(['ko', 'en'])
        ),
        onChange: () => {},
      })
    );
    assert.ok(freePlanSingleHtml.includes(LOCALE_META.ko.nativeName));
    for (const loc of ALL_LOCALES) {
      if (loc === 'ko') continue;
      assert.equal(
        freePlanSingleHtml.includes(LOCALE_META[loc].nativeName),
        false,
        `Free-plan one-language store (ko) must not show ${loc}`
      );
    }

    const omittedPropHtml = renderToStaticMarkup(
      React.createElement(LanguageSwitcher, {
        currentLocale: 'vi',
        onChange: () => {},
      })
    );
    for (const loc of ALL_LOCALES) {
      assert.ok(
        omittedPropHtml.includes(LOCALE_META[loc].nativeName),
        `Omitted supportedLangs prop must retain default ALL_LOCALES (${loc})`
      );
    }
  });
});

describe('Screen flow audit residuals: menu polling, mobile password recovery, setup checklist, slug confirmation', () => {
  test('R.1 storefront menu polling uses 30s visible interval, pauses when hidden/offline/in-flight, and view=menu omits posts payload', async () => {
    assert.equal(STOREFRONT_MENU_POLL_INTERVAL_MS, 30_000);
    assert.equal(STOREFRONT_MENU_STALE_REFRESH_MS, 10_000);

    // Pauses when tab is hidden
    assert.equal(
      shouldRefreshStorefrontCatalog({
        visibilityState: 'hidden',
        isOnline: true,
        isFetchInFlight: false,
        lastFetchedAtMs: 1_000,
        nowMs: 60_000,
      }),
      false
    );

    // Pauses when offline
    assert.equal(
      shouldRefreshStorefrontCatalog({
        visibilityState: 'visible',
        isOnline: false,
        isFetchInFlight: false,
        lastFetchedAtMs: 1_000,
        nowMs: 60_000,
      }),
      false
    );

    // Pauses when a request is already in flight
    assert.equal(
      shouldRefreshStorefrontCatalog({
        visibilityState: 'visible',
        isOnline: true,
        isFetchInFlight: true,
        lastFetchedAtMs: 1_000,
        nowMs: 60_000,
      }),
      false
    );

    // Skips when fetched recently within minAgeMs
    assert.equal(
      shouldRefreshStorefrontCatalog({
        visibilityState: 'visible',
        isOnline: true,
        isFetchInFlight: false,
        lastFetchedAtMs: 50_000,
        nowMs: 55_000,
        minAgeMs: STOREFRONT_MENU_POLL_INTERVAL_MS,
      }),
      false
    );

    // Allows refresh when visible, online, idle, and older than minAgeMs
    assert.equal(
      shouldRefreshStorefrontCatalog({
        visibilityState: 'visible',
        isOnline: true,
        isFetchInFlight: false,
        lastFetchedAtMs: 10_000,
        nowMs: 41_000,
        minAgeMs: STOREFRONT_MENU_POLL_INTERVAL_MS,
      }),
      true
    );

    // GET /api/shops?slug=pho-hoi-an&view=menu omits posts while keeping menu catalog & tables
    const menuRes = await shopsGet(
      new Request('http://localhost:3000/api/shops?slug=pho-hoi-an&view=menu')
    );
    assert.equal(menuRes.status, 200);
    const menuPayload = await menuRes.json();
    assert.equal(menuPayload.shop?.slug, 'pho-hoi-an');
    assert.ok(Array.isArray(menuPayload.categories) && menuPayload.categories.length > 0);
    assert.ok(Array.isArray(menuPayload.items) && menuPayload.items.length > 0);
    assert.ok(Array.isArray(menuPayload.tables));
    assert.deepEqual(menuPayload.posts, []);
  });

  test('R.2 password recovery routes to /login?mode=reset, handles Supabase recovery sessions + updateUser, preserves mobile OTP recovery, and rejects demo/admin/custom-credential accounts', async () => {
    // 0. Redirect URL and URL mode/session signal resolution
    assert.equal(
      buildPasswordRecoveryRedirectUrl('https://qlaok.vunph.click/'),
      'https://qlaok.vunph.click/login?mode=reset'
    );
    assert.equal(
      buildWebPasswordRecoveryRedirectUrl('https://qlaok.com'),
      'https://qlaok.com/login?mode=reset'
    );

    assert.equal(
      resolveLoginAuthMode({
        searchParams: new URLSearchParams('mode=reset'),
      }),
      'reset'
    );
    assert.equal(
      resolveWebLoginAuthMode({
        searchParams: new URLSearchParams('mode=otp'),
      }),
      'otp'
    );
    assert.equal(
      resolveWebLoginAuthMode({
        searchParams: new URLSearchParams('mode=register'),
      }),
      'register'
    );
    assert.equal(
      resolveWebLoginAuthMode({
        searchParams: new URLSearchParams('mode=login'),
      }),
      'password_login'
    );

    const hashRecoverySignals = parseWebRecoveryUrlSignals({
      searchParams: new URLSearchParams('mode=reset'),
      hash: '#access_token=sb-rec-tok&refresh_token=sb-ref&type=recovery',
    });
    assert.equal(hashRecoverySignals.isResetMode, true);
    assert.equal(hashRecoverySignals.hasRecoveryCallbackSignal, true);
    assert.equal(hashRecoverySignals.accessToken, 'sb-rec-tok');

    const tokenHashSignals = parseRecoveryUrlSignals({
      searchParams: new URLSearchParams('token_hash=th_abc123&type=recovery'),
    });
    assert.equal(tokenHashSignals.isResetMode, true);
    assert.equal(tokenHashSignals.hasRecoveryCallbackSignal, true);
    assert.equal(tokenHashSignals.tokenHash, 'th_abc123');

    const pkceSignals = parseWebRecoveryUrlSignals({
      searchParams: new URLSearchParams('mode=reset&code=pkce_code_99'),
    });
    assert.equal(pkceSignals.isResetMode, true);
    assert.equal(pkceSignals.hasRecoveryCallbackSignal, true);
    assert.equal(pkceSignals.code, 'pkce_code_99');

    const expiredHashSignals = parseWebRecoveryUrlSignals({
      searchParams: new URLSearchParams(''),
      hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    });
    assert.equal(expiredHashSignals.isResetMode, true);
    assert.equal(
      expiredHashSignals.hashErrorDescription,
      'Email link is invalid or has expired'
    );

    // 1. Invalid email rejected before network call
    let called = false;
    const invalidRes = await requestMobilePasswordRecovery({
      email: 'not-an-email',
      authClient: {
        resetPasswordForEmail: async () => {
          called = true;
          return { data: {}, error: null };
        },
      },
    });
    assert.equal(invalidRes.ok, false);
    if (!invalidRes.ok) {
      assert.equal(invalidRes.reason, 'invalid_email');
    }
    assert.equal(called, false);

    // 2. Demo & system accounts report unsupported_account
    const demoRes = await requestMobilePasswordRecovery({
      email: '  CHUQUAN@qlaok.vn ',
      authClient: {
        resetPasswordForEmail: async () => ({ data: {}, error: null }),
      },
    });
    assert.equal(demoRes.ok, false);
    if (!demoRes.ok) {
      assert.equal(demoRes.reason, 'unsupported_account');
    }

    // 2b. Public /api/auth check_recovery and helpers cannot be used to enumerate custom-credential vs unknown emails
    const initialCreds = readCredentials();
    const customEmail = 'custom-cred-owner@example.com';
    const unknownEmail = 'unknown-nonexistent-owner@example.com';
    try {
      writeCredentials({
        ...initialCreds,
        [customEmail]: {
          passwordHash: hashPassword('customPass123'),
          profileId: 'owner-custom-cred-test',
        },
      });

      const demoCheckRes = await authPost(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_recovery',
            email: 'chuquan@qlaok.vn',
          }),
        })
      );
      assert.equal(demoCheckRes.status, 409);
      const demoCheckBody = await demoCheckRes.json();
      assert.equal(demoCheckBody.supported, false);
      assert.equal(demoCheckBody.reason, 'unsupported_account');

      const adminCheckRes = await authPost(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_recovery',
            email: 'hoangvu96z@gmail.com',
          }),
        })
      );
      assert.equal(adminCheckRes.status, 409);

      const customCheckRes = await authPost(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_recovery',
            email: customEmail,
          }),
        })
      );
      const unknownCheckRes = await authPost(
        new Request('http://localhost/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_recovery',
            email: unknownEmail,
          }),
        })
      );

      // Identical HTTP status and identical JSON payload for custom-credential and unknown emails
      assert.equal(customCheckRes.status, 200);
      assert.equal(unknownCheckRes.status, 200);
      const customCheckBody = await customCheckRes.json();
      const unknownCheckBody = await unknownCheckRes.json();
      assert.deepEqual(customCheckBody, unknownCheckBody);
      assert.equal(customCheckBody.accepted, true);
      assert.equal(customCheckBody.supported, true);
      assert.match(customCheckBody.notice, /^Nếu email thuộc tài khoản/);
      assert.doesNotMatch(customCheckBody.notice, /^Đã gửi/i);

      // Client helper also returns uniform generic guidance without confirming account existence
      const viGeneric = formatGenericPasswordRecoveryNotice(customEmail, 'vi');
      const enGeneric = formatWebGenericPasswordRecoveryNotice(
        unknownEmail,
        'en'
      );
      assert.match(viGeneric, /^Nếu custom-cred-owner@example\.com/);
      assert.match(viGeneric, /Tài khoản mật khẩu nội bộ, dùng thử hoặc quản trị/);
      assert.doesNotMatch(viGeneric, /^Đã gửi/i);
      assert.match(enGeneric, /^If unknown-nonexistent-owner@example\.com/);
      assert.match(enGeneric, /Local-password, demo, or admin accounts/);
      assert.doesNotMatch(enGeneric, /^Reset instructions sent/i);
    } finally {
      writeCredentials(initialCreds);
    }

    // 3. Missing authClient reports unsupported_provider
    const noProviderRes = await requestMobilePasswordRecovery({
      email: 'owner@example.com',
      authClient: null,
    });
    assert.equal(noProviderRes.ok, false);
    if (!noProviderRes.ok) {
      assert.equal(noProviderRes.reason, 'unsupported_provider');
    }

    // 4. Rate-limited error classified as rate_limited
    const rateLimitedRes = await requestMobilePasswordRecovery({
      email: 'owner@example.com',
      authClient: {
        resetPasswordForEmail: async () => ({
          data: null,
          error: {
            message:
              'For security purposes, you can only request this once every 60 seconds',
            status: 429,
          },
        }),
      },
    });
    assert.equal(rateLimitedRes.ok, false);
    if (!rateLimitedRes.ok) {
      assert.equal(rateLimitedRes.reason, 'rate_limited');
    }

    // 5. Valid recovery request passes normalized email and redirectTo pointing to /login?mode=reset
    let capturedEmail = '';
    let capturedRedirect = '';
    const redirectUrl = buildPasswordRecoveryRedirectUrl(
      'https://qlaok.vunph.click'
    );
    const okRes = await requestMobilePasswordRecovery({
      email: '  Owner.Cafe@Example.com ',
      redirectTo: redirectUrl,
      authClient: {
        resetPasswordForEmail: async (email, options) => {
          capturedEmail = email;
          capturedRedirect = options?.redirectTo || '';
          return { data: {}, error: null };
        },
      },
    });
    assert.equal(okRes.ok, true);
    if (okRes.ok) {
      assert.equal(okRes.email, 'owner.cafe@example.com');
      assert.equal(okRes.redirectTo, 'https://qlaok.vunph.click/login?mode=reset');
    }
    assert.equal(capturedEmail, 'owner.cafe@example.com');
    assert.equal(
      capturedRedirect,
      'https://qlaok.vunph.click/login?mode=reset'
    );

    // 6. Completing recovery from an active Supabase PASSWORD_RECOVERY session validates inputs and calls updateUser
    const mismatchSessionRes = await completeWebPasswordRecoverySession({
      email: 'owner.cafe@example.com',
      newPassword: 'newpassword123',
      confirmPassword: 'differentPassword123',
      authClient: {
        updateUser: async () => ({ data: {}, error: null }),
      },
    });
    assert.equal(mismatchSessionRes.ok, false);
    if (!mismatchSessionRes.ok) {
      assert.equal(mismatchSessionRes.reason, 'password_mismatch');
    }

    let sessionUpdatedPassword = '';
    const sessionCompletedRes = await completePasswordRecoverySession({
      newPassword: 'updatedViaSessionLink!',
      confirmPassword: 'updatedViaSessionLink!',
      authClient: {
        updateUser: async ({ password }) => {
          sessionUpdatedPassword = password;
          return {
            data: { user: { email: 'Owner.Cafe@Example.com' } },
            error: null,
          };
        },
      },
    });
    assert.equal(sessionCompletedRes.ok, true);
    if (sessionCompletedRes.ok) {
      assert.equal(sessionCompletedRes.email, 'owner.cafe@example.com');
    }
    assert.equal(sessionUpdatedPassword, 'updatedViaSessionLink!');

    // 7. Completing recovery with OTP code + new password validates inputs and updates password
    const shortCodeRes = await completeMobilePasswordRecoveryWithCode({
      email: 'owner.cafe@example.com',
      code: '123',
      newPassword: 'newpassword123',
      authClient: {},
    });
    assert.equal(shortCodeRes.ok, false);
    if (!shortCodeRes.ok) {
      assert.equal(shortCodeRes.reason, 'invalid_code');
    }

    const weakPassRes = await completeMobilePasswordRecoveryWithCode({
      email: 'owner.cafe@example.com',
      code: '123456',
      newPassword: '123',
      authClient: {},
    });
    assert.equal(weakPassRes.ok, false);
    if (!weakPassRes.ok) {
      assert.equal(weakPassRes.reason, 'weak_password');
    }

    let verifiedOtpToken = '';
    let updatedPassword = '';
    const completedRes = await completeMobilePasswordRecoveryWithCode({
      email: 'Owner.Cafe@Example.com',
      code: ' 654321 ',
      newPassword: 'strongNewPassword!',
      confirmPassword: 'strongNewPassword!',
      authClient: {
        verifyOtp: async (params) => {
          assert.equal(params.type, 'recovery');
          verifiedOtpToken = 'token' in params ? params.token : '';
          return { data: { session: { access_token: 'tok-1' } }, error: null };
        },
        updateUser: async ({ password }) => {
          updatedPassword = password;
          return { data: {}, error: null };
        },
      },
    });
    assert.equal(completedRes.ok, true);
    assert.equal(verifiedOtpToken, '654321');
    assert.equal(updatedPassword, 'strongNewPassword!');
  });

  test('R.3 evaluateShopSetupChecklist derives completion purely from persisted store, payment, catalog, table, and publish state', () => {
    const draftShop: Shop = {
      ...SEED_SHOPS[0],
      id: 'shop-draft-setup-test',
      name: 'Quán Mới Khởi Tạo',
      slug: 'quan-moi-khoi-tao',
      address: 'Đà Nẵng',
      city: 'Đà Nẵng',
      phone_contact: '',
      zalo_phone: '',
      wifi_info: { ssid: '', password: '' },
      theme_config: { primaryColor: '#10b981', layout: 'list' },
      is_published: false,
    };

    assert.equal(hasConfiguredStoreInfo(draftShop), false);
    const initialChecklist = evaluateShopSetupChecklist({
      shop: draftShop,
      totalCatalogItems: 0,
      availableCatalogItems: 0,
      activeTablesCount: 0,
    });
    assert.equal(initialChecklist.completedCount, 0);
    assert.equal(initialChecklist.totalCount, 5);
    assert.equal(initialChecklist.isAllCompleted, false);

    const readyShop: Shop = {
      ...draftShop,
      address: '88 Trần Phú, Hải Châu',
      phone_contact: '0912345678',
      wifi_info: { ssid: 'QuanMoi_5G', password: 'mypassword' },
      theme_config: {
        primaryColor: '#10b981',
        layout: 'list',
        paymentConfig: {
          mode: 'vietqr_auto',
          bankId: 'MB',
          bankName: 'MB Bank',
          accountNumber: '0912345678',
          accountName: 'NGUYEN VAN B',
        },
      },
      is_published: true,
    };

    const fullChecklist = evaluateShopSetupChecklist({
      shop: readyShop,
      totalCatalogItems: 5,
      availableCatalogItems: 5,
      activeTablesCount: 6,
    });
    assert.equal(fullChecklist.completedCount, 5);
    assert.equal(fullChecklist.progressPercent, 100);
    assert.equal(fullChecklist.isAllCompleted, true);
  });

  test('R.4 requiresSlugChangeConfirmation requires confirmation only when normalized slug actually changes', () => {
    assert.equal(normalizeShopSlugInput('  Phở Hội An #1  '), 'pho-hoi-an-1');

    const unchanged = requiresSlugChangeConfirmation(
      'pho-hoi-an',
      '  PHO-HOI-AN '
    );
    assert.equal(unchanged.required, false);
    assert.equal(unchanged.currentNormalized, 'pho-hoi-an');
    assert.equal(unchanged.nextNormalized, 'pho-hoi-an');

    const changed = requiresSlugChangeConfirmation(
      'pho-hoi-an',
      'pho-hoi-an-branch-2'
    );
    assert.equal(changed.required, true);
    assert.equal(changed.currentNormalized, 'pho-hoi-an');
    assert.equal(changed.nextNormalized, 'pho-hoi-an-branch-2');
  });

  test('R.5 executeOnboardingCompletion checks bulk_import !res.ok, preserves draft shop without redirecting, and retries catalog import without creating duplicate shops', async () => {
    let translateCalls = 0;
    let shopCreateCalls = 0;
    let catalogImportCalls = 0;
    let shouldFailCatalog = true;
    const savedDraftIds: string[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/ai/translate') {
        translateCalls += 1;
        return new Response(
          JSON.stringify({
            category_i18n: { vi: 'Món Đặc Trưng', en: 'Signature' },
            name_i18n: { vi: 'Bạc xỉu đá', en: 'Iced White Coffee' },
            desc_i18n: { vi: 'Thơm béo', en: 'Creamy' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/shops') {
        shopCreateCalls += 1;
        const body = JSON.parse(String(init?.body || '{}')) as {
          name?: string;
          slug?: string;
          is_published?: boolean;
        };
        assert.equal(
          body.is_published,
          false,
          'Onboarding must create store as an unpublished draft'
        );
        return new Response(
          JSON.stringify({
            shop: {
              id: `shop-onboard-draft-${shopCreateCalls}`,
              name: body.name || 'Cà Phê Phố Cổ',
              slug: body.slug || 'ca-phe-pho-co',
              is_published: false,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === '/api/catalog') {
        catalogImportCalls += 1;
        const body = JSON.parse(String(init?.body || '{}')) as {
          action?: string;
          shopId?: string;
        };
        assert.equal(body.action, 'bulk_import');
        assert.equal(body.shopId, 'shop-onboard-draft-1');
        if (shouldFailCatalog) {
          return new Response(
            JSON.stringify({
              error: 'Không thể ghi dữ liệu danh mục vào cơ sở dữ liệu.',
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            createdCategories: [{ id: 'cat-1' }],
            createdItems: [{ id: 'item-1' }],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    // 1. First attempt: shop creation succeeds, bulk_import returns 500 (!res.ok)
    const firstAttemptVi = await executeOnboardingCompletion({
      locale: 'vi',
      ownerId: 'owner-onboard-01',
      vertical: 'fnb',
      shopName: 'Cà Phê Phố Cổ',
      taglineVi: 'Hương vị Hội An',
      city: 'Đà Nẵng',
      address: '12 Trần Phú',
      phone: '0905123456',
      wifiSsid: 'PhoCo_5G',
      wifiPassword: '88888888',
      categoryVi: 'Món Đặc Trưng',
      firstItemNameVi: 'Bạc xỉu đá',
      firstItemPrice: '35000',
      fetchImpl: mockFetch,
      onDraftShopSaved: (draft) => savedDraftIds.push(draft.id),
    });

    assert.equal(firstAttemptVi.ok, false);
    assert.equal(firstAttemptVi.stage, 'catalog_import');
    assert.equal(firstAttemptVi.catalogImported, false);
    assert.equal(
      firstAttemptVi.redirectHref,
      null,
      'Must NOT redirect to /dashboard/qr-studio when bulk_import fails'
    );
    assert.equal(firstAttemptVi.retryAvailable, true);
    assert.equal(firstAttemptVi.draftShop?.id, 'shop-onboard-draft-1');
    assert.equal(firstAttemptVi.draftShop?.is_published, false);
    assert.deepEqual(savedDraftIds, ['shop-onboard-draft-1']);
    assert.equal(shopCreateCalls, 1);
    assert.equal(catalogImportCalls, 1);
    assert.match(firstAttemptVi.errorMessage, /Quán nháp "Cà Phê Phố Cổ" đã được lưu/);
    assert.match(firstAttemptVi.errorMessage, /Thử nhập lại món đầu tiên/);
    assert.doesNotMatch(firstAttemptVi.errorMessage, /Đã thêm .* món mới/);

    // Verify EN localization of the actionable error
    const enError = formatOnboardingBulkImportError({
      locale: 'en',
      shopName: 'Cà Phê Phố Cổ',
      serverError: firstAttemptVi.serverError,
    });
    assert.match(enError, /Draft store "Cà Phê Phố Cổ" was saved/);
    assert.match(enError, /Retry importing first item/);

    // 2. Retry with preserved draftShop: skips POST /api/shops and succeeds when bulk_import returns 201
    shouldFailCatalog = false;
    const retryAttemptEn = await executeOnboardingCompletion({
      locale: 'en',
      ownerId: 'owner-onboard-01',
      vertical: 'fnb',
      shopName: 'Cà Phê Phố Cổ',
      taglineVi: 'Hương vị Hội An',
      city: 'Đà Nẵng',
      address: '12 Trần Phú',
      phone: '0905123456',
      wifiSsid: 'PhoCo_5G',
      wifiPassword: '88888888',
      categoryVi: 'Món Đặc Trưng',
      firstItemNameVi: 'Bạc xỉu đá',
      firstItemPrice: '35000',
      existingDraftShop: firstAttemptVi.draftShop,
      fetchImpl: mockFetch,
      onDraftShopSaved: (draft) => savedDraftIds.push(draft.id),
    });

    assert.equal(retryAttemptEn.ok, true);
    assert.equal(retryAttemptEn.stage, 'completed');
    assert.equal(retryAttemptEn.catalogImported, true);
    assert.equal(retryAttemptEn.redirectHref, '/dashboard/qr-studio');
    assert.equal(retryAttemptEn.draftShop?.id, 'shop-onboard-draft-1');
    assert.equal(
      shopCreateCalls,
      1,
      'Retry must reuse the existing draft shop instead of creating a duplicate store'
    );
    assert.equal(catalogImportCalls, 2);
    assert.equal(translateCalls, 2);
  });

  test('R.6 onboarding retry idempotency: first import persists category then fails on item, retry succeeds with one category, one first item, and one shop POST; normal imports without IDs remain unchanged', async () => {
    const categoriesStore: Category[] = [];
    const itemsStore: CatalogItem[] = [];
    let failItemWrite = true;
    let shopPostCalls = 0;

    const mockSupabaseClient = {
      from(table: string) {
        if (table === 'shops') {
          return {
            select() {
              return {
                limit: async () => ({
                  data: [{ id: 'shop-onboard-idempotent-1' }],
                  error: null,
                }),
              };
            },
          };
        }
        if (table === 'profiles') {
          return {
            select() {
              return {
                limit: async () => ({
                  data: [{ plan: 'premium' }],
                  error: null,
                }),
              };
            },
          };
        }
        if (table === 'categories') {
          return {
            select(_cols?: string, opts?: { count?: string; head?: boolean }) {
              return {
                eq(col: string, val: string) {
                  if (opts?.head) {
                    const count = categoriesStore.filter(
                      (c) => c[col as keyof Category] === val
                    ).length;
                    return Promise.resolve({ count, data: null, error: null });
                  }
                  return {
                    maybeSingle: async () => {
                      const found =
                        categoriesStore.find(
                          (c) => c[col as keyof Category] === val
                        ) ?? null;
                      return { data: found, error: null };
                    },
                  };
                },
              };
            },
            update(patch: Partial<Category>) {
              return {
                eq(_col: string, val: string) {
                  return {
                    select() {
                      return {
                        single: async () => {
                          const idx = categoriesStore.findIndex(
                            (c) => c.id === val
                          );
                          if (idx === -1) {
                            return {
                              data: null,
                              error: { message: 'Category not found' },
                            };
                          }
                          categoriesStore[idx] = {
                            ...categoriesStore[idx],
                            ...patch,
                          };
                          return { data: categoriesStore[idx], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
            upsert(payload: Category) {
              return {
                select() {
                  return {
                    single: async () => {
                      const idx = categoriesStore.findIndex(
                        (c) => c.id === payload.id
                      );
                      if (idx >= 0) {
                        categoriesStore[idx] = {
                          ...categoriesStore[idx],
                          ...payload,
                        };
                        return { data: categoriesStore[idx], error: null };
                      }
                      categoriesStore.push({ ...payload });
                      return {
                        data: categoriesStore[categoriesStore.length - 1],
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'items') {
          return {
            select(_cols?: string, opts?: { count?: string; head?: boolean }) {
              return {
                eq(col: string, val: string) {
                  if (opts?.head) {
                    const count = itemsStore.filter(
                      (i) => i[col as keyof CatalogItem] === val
                    ).length;
                    return Promise.resolve({ count, data: null, error: null });
                  }
                  return {
                    maybeSingle: async () => {
                      const found =
                        itemsStore.find(
                          (i) => i[col as keyof CatalogItem] === val
                        ) ?? null;
                      return { data: found, error: null };
                    },
                  };
                },
              };
            },
            update(patch: Partial<CatalogItem>) {
              return {
                eq(_col: string, val: string) {
                  return {
                    select() {
                      return {
                        single: async () => {
                          if (failItemWrite) {
                            return {
                              data: null,
                              error: { message: 'ITEM_WRITE_FAILED' },
                            };
                          }
                          const idx = itemsStore.findIndex((i) => i.id === val);
                          if (idx === -1) {
                            return {
                              data: null,
                              error: { message: 'Item not found' },
                            };
                          }
                          itemsStore[idx] = {
                            ...itemsStore[idx],
                            ...patch,
                          } as CatalogItem;
                          return { data: itemsStore[idx], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
            insert(payload: CatalogItem) {
              return {
                select() {
                  return {
                    single: async () => {
                      if (failItemWrite) {
                        return {
                          data: null,
                          error: { message: 'ITEM_WRITE_FAILED' },
                        };
                      }
                      itemsStore.push({ ...payload });
                      return {
                        data: itemsStore[itemsStore.length - 1],
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table in test mock: ${table}`);
      },
    };

    setSupabaseDbClientForTests(mockSupabaseClient);
    try {
      const mockFetch: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/ai/translate') {
          return new Response(
            JSON.stringify({
              category_i18n: { vi: 'Món Đặc Trưng', en: 'Signature' },
              name_i18n: { vi: 'Phở Tái Nạm', en: 'Beef Pho' },
              desc_i18n: { vi: 'Nước dùng đậm đà', en: 'Rich broth' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url === '/api/shops') {
          shopPostCalls += 1;
          const body = JSON.parse(String(init?.body || '{}')) as {
            name?: string;
            slug?: string;
          };
          return new Response(
            JSON.stringify({
              shop: {
                id: 'shop-onboard-idempotent-1',
                name: body.name || 'Phở Phố Cổ',
                slug: body.slug || 'pho-pho-co',
                is_published: false,
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url === '/api/catalog') {
          const body = JSON.parse(String(init?.body || '{}')) as {
            action?: string;
            shopId: string;
            categories: Parameters<typeof dbBulkImportCatalog>[1];
          };
          assert.equal(body.action, 'bulk_import');
          assert.equal(
            body.categories[0]?.id,
            buildOnboardingFirstCategoryId(body.shopId)
          );
          assert.equal(
            body.categories[0]?.items[0]?.id,
            buildOnboardingFirstItemId(body.shopId)
          );
          try {
            const result = await dbBulkImportCatalog(
              body.shopId,
              body.categories
            );
            return new Response(JSON.stringify(result), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          } catch (err) {
            return new Response(
              JSON.stringify({
                error: err instanceof Error ? err.message : 'Import failed',
              }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      // 1. First import persists the category then fails on item
      const firstAttempt = await executeOnboardingCompletion({
        locale: 'vi',
        ownerId: 'owner-onboard-01',
        vertical: 'fnb',
        shopName: 'Phở Phố Cổ',
        taglineVi: 'Hương vị truyền thống',
        city: 'Đà Nẵng',
        address: '12 Trần Phú',
        phone: '0905123456',
        wifiSsid: 'PhoPhoCo',
        wifiPassword: '88888888',
        categoryVi: 'Món Đặc Trưng',
        firstItemNameVi: 'Phở Tái Nạm',
        firstItemPrice: '55000',
        fetchImpl: mockFetch,
      });

      assert.equal(firstAttempt.ok, false);
      assert.equal(firstAttempt.stage, 'catalog_import');
      assert.equal(firstAttempt.draftShop?.id, 'shop-onboard-idempotent-1');
      assert.equal(shopPostCalls, 1);
      assert.equal(
        categoriesStore.length,
        1,
        'First import must persist the first category before item failure'
      );
      assert.equal(
        categoriesStore[0].id,
        'onboarding:shop-onboard-idempotent-1:first-category'
      );
      assert.equal(itemsStore.length, 0);

      // 2. Retry with the saved draft succeeds; assert one category, one first item, and only one shop POST overall
      failItemWrite = false;
      const retryAttempt = await executeOnboardingCompletion({
        locale: 'vi',
        ownerId: 'owner-onboard-01',
        vertical: 'fnb',
        shopName: 'Phở Phố Cổ',
        taglineVi: 'Hương vị truyền thống',
        city: 'Đà Nẵng',
        address: '12 Trần Phú',
        phone: '0905123456',
        wifiSsid: 'PhoPhoCo',
        wifiPassword: '88888888',
        categoryVi: 'Món Đặc Trưng',
        firstItemNameVi: 'Phở Tái Nạm',
        firstItemPrice: '55000',
        existingDraftShop: firstAttempt.draftShop,
        fetchImpl: mockFetch,
      });

      assert.equal(retryAttempt.ok, true);
      assert.equal(retryAttempt.stage, 'completed');
      assert.equal(shopPostCalls, 1, 'Must only make one shop POST overall');
      assert.equal(
        categoriesStore.length,
        1,
        'Retry must reuse the deterministic onboarding category instead of duplicating it'
      );
      assert.equal(
        categoriesStore[0].id,
        'onboarding:shop-onboard-idempotent-1:first-category'
      );
      assert.equal(
        itemsStore.length,
        1,
        'Retry must persist exactly one first item'
      );
      assert.equal(
        itemsStore[0].id,
        'onboarding:shop-onboard-idempotent-1:first-item'
      );
      assert.equal(
        itemsStore[0].category_id,
        'onboarding:shop-onboard-idempotent-1:first-category'
      );

      // 3. Normal imports without IDs remain unchanged (generate distinct new categories/items)
      const normalFirst = await dbBulkImportCatalog(
        'shop-onboard-idempotent-1',
        [
          {
            name_i18n: { vi: 'Đồ Uống', en: 'Drinks' },
            items: [
              {
                price: 25000,
                name_i18n: { vi: 'Trà đá', en: 'Iced Tea' },
                desc_i18n: { vi: '' },
              },
            ],
          },
        ]
      );
      const normalSecond = await dbBulkImportCatalog(
        'shop-onboard-idempotent-1',
        [
          {
            name_i18n: { vi: 'Đồ Uống', en: 'Drinks' },
            items: [
              {
                price: 25000,
                name_i18n: { vi: 'Trà đá', en: 'Iced Tea' },
                desc_i18n: { vi: '' },
              },
            ],
          },
        ]
      );

      assert.equal(normalFirst.createdCategories.length, 1);
      assert.equal(normalSecond.createdCategories.length, 1);
      assert.match(normalFirst.createdCategories[0].id, /^cat-/);
      assert.match(normalSecond.createdCategories[0].id, /^cat-/);
      assert.notEqual(
        normalFirst.createdCategories[0].id,
        normalSecond.createdCategories[0].id
      );
      assert.match(normalFirst.createdItems[0].id, /^item-/);
      assert.match(normalSecond.createdItems[0].id, /^item-/);
      assert.notEqual(
        normalFirst.createdItems[0].id,
        normalSecond.createdItems[0].id
      );
      assert.equal(categoriesStore.length, 3);
      assert.equal(itemsStore.length, 3);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  });
});

// ============================================================================
// SUITE 14: KITCHEN DISPLAY SYSTEM (KDS)
// ============================================================================
describe('Suite 14: Kitchen Display System (kitchen-display.ts, KitchenTicketCard, /api/orders)', () => {
  const baseOrder = (overrides: Partial<ShopOrder>): ShopOrder => ({
    id: 'ord-kds-default',
    shop_id: 'shop-fnb-001',
    order_code: '#KDS01',
    table_label: 'Bàn 01',
    visitor_lang: 'vi',
    source: 'qr_table',
    customer_note: '',
    status: 'new',
    payment_status: 'unpaid',
    payment_method: 'cash',
    subtotal_amount: 45000,
    total_amount: 45000,
    items: [
      {
        item_id: 'item-fnb-01',
        name_vi: 'Phở bò tái nạm',
        name_i18n: { vi: 'Phở bò tái nạm', en: 'Rare & Flank Beef Pho' },
        quantity: 2,
        unit_price: 45000,
        extra_price: 5000,
        selected_choices: [
          {
            id: 'opt-1',
            label_vi: 'Thêm hành',
            label_i18n: { vi: 'Thêm hành', en: 'Extra scallions' },
            extra_price: 0,
          },
        ],
        quick_tags: ['Ít cay'],
        custom_note: 'Nước béo riêng',
      },
    ],
    created_at: '2026-10-22T09:00:00.000Z',
    updated_at: '2026-10-22T09:00:00.000Z',
    ...overrides,
  });

  test('14.1 Active-order selection and oldest-first sorting exclude completed/cancelled and cross-shop orders', () => {
    const orders: ShopOrder[] = [
      baseOrder({
        id: 'ord-completed',
        order_code: '#1001',
        status: 'completed',
        created_at: '2026-10-22T08:00:00.000Z',
      }),
      baseOrder({
        id: 'ord-cancelled',
        order_code: '#1002',
        status: 'cancelled',
        created_at: '2026-10-22T08:05:00.000Z',
      }),
      baseOrder({
        id: 'ord-other-shop',
        shop_id: 'shop-other-999',
        order_code: '#1003',
        status: 'new',
        created_at: '2026-10-22T08:10:00.000Z',
      }),
      baseOrder({
        id: 'ord-newer-new',
        order_code: '#1006',
        status: 'new',
        created_at: '2026-10-22T09:10:00.000Z',
      }),
      baseOrder({
        id: 'ord-oldest-prep',
        order_code: '#1004',
        status: 'preparing',
        created_at: '2026-10-22T08:45:00.000Z',
      }),
      baseOrder({
        id: 'ord-middle-new',
        order_code: '#1005',
        status: 'new',
        created_at: '2026-10-22T08:55:00.000Z',
      }),
      // Duplicate ID must be deduplicated
      baseOrder({
        id: 'ord-middle-new',
        order_code: '#1005',
        status: 'new',
        created_at: '2026-10-22T08:55:00.000Z',
      }),
    ];

    assert.equal(isActiveKitchenOrder(orders[0], 'shop-fnb-001'), false);
    assert.equal(isActiveKitchenOrder(orders[1], 'shop-fnb-001'), false);
    assert.equal(isActiveKitchenOrder(orders[2], 'shop-fnb-001'), false);
    assert.equal(isActiveKitchenOrder(orders[4], 'shop-fnb-001'), true);

    const activeAll = selectAndSortKitchenOrders(orders, {
      shopId: 'shop-fnb-001',
      statusFilter: 'all',
    });
    assert.deepEqual(
      activeAll.map((o) => o.id),
      ['ord-oldest-prep', 'ord-middle-new', 'ord-newer-new'],
      'KDS must include only active orders for the shop and sort oldest created_at first'
    );

    const onlyNew = selectAndSortKitchenOrders(orders, {
      shopId: 'shop-fnb-001',
      statusFilter: 'new',
    });
    assert.deepEqual(
      onlyNew.map((o) => o.id),
      ['ord-middle-new', 'ord-newer-new']
    );

    const onlyPreparing = selectAndSortKitchenOrders(orders, {
      shopId: 'shop-fnb-001',
      statusFilter: 'preparing',
    });
    assert.deepEqual(
      onlyPreparing.map((o) => o.id),
      ['ord-oldest-prep']
    );
  });

  test('14.2 Overdue threshold defaults to 15 minutes and queue summary counts active/overdue tickets accurately', () => {
    assert.equal(DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES, 15);
    assert.equal(DEFAULT_KDS_OVERDUE_THRESHOLD_MS, 15 * 60 * 1000);

    const createdAt = '2026-10-22T09:00:00.000Z';
    const createdMs = Date.parse(createdAt);

    // 14m 59s -> 14 whole minutes -> NOT overdue
    const before15m = createdMs + 14 * 60 * 1000 + 59 * 1000;
    assert.equal(getKitchenOrderAgeMinutes(createdAt, before15m), 14);
    assert.equal(isKitchenOrderOverdue(createdAt, before15m), false);
    assert.equal(formatKitchenOrderAge(createdAt, 'vi', before15m), '14 phút');
    assert.equal(formatKitchenOrderAge(createdAt, 'en', before15m), '14m');

    // Exactly 15m 00s -> overdue
    const exact15m = createdMs + 15 * 60 * 1000;
    assert.equal(getKitchenOrderAgeMinutes(createdAt, exact15m), 15);
    assert.equal(isKitchenOrderOverdue(createdAt, exact15m), true);

    // < 1 minute -> 'Vừa xong' / 'Just now'
    assert.equal(
      formatKitchenOrderAge(createdAt, 'vi', createdMs + 20_000),
      'Vừa xong'
    );
    assert.equal(
      formatKitchenOrderAge(createdAt, 'en', createdMs + 20_000),
      'Just now'
    );

    // >= 60 minutes -> natural hours + minutes formatting
    const exact60m = createdMs + 60 * 60 * 1000;
    assert.equal(formatKitchenOrderAge(createdAt, 'vi', exact60m), '1 giờ');
    assert.equal(formatKitchenOrderAge(createdAt, 'en', exact60m), '1h');

    const after75m = createdMs + 75 * 60 * 1000;
    assert.equal(
      formatKitchenOrderAge(createdAt, 'vi', after75m),
      '1 giờ 15 phút'
    );
    assert.equal(formatKitchenOrderAge(createdAt, 'en', after75m), '1h 15m');

    const summary = summarizeKitchenQueue(
      [
        baseOrder({
          id: 'o-1',
          status: 'new',
          created_at: '2026-10-22T08:40:00.000Z', // 20m old -> overdue
        }),
        baseOrder({
          id: 'o-2',
          status: 'preparing',
          created_at: '2026-10-22T08:45:00.000Z', // 15m old -> overdue
        }),
        baseOrder({
          id: 'o-3',
          status: 'new',
          created_at: '2026-10-22T08:52:00.000Z', // 8m old -> not overdue
        }),
        baseOrder({
          id: 'o-4',
          status: 'completed',
          created_at: '2026-10-22T08:00:00.000Z', // completed -> ignored
        }),
      ],
      {
        shopId: 'shop-fnb-001',
        nowMs: Date.parse('2026-10-22T09:00:00.000Z'),
      }
    );

    assert.deepEqual(summary, {
      totalActive: 3,
      newCount: 2,
      preparingCount: 1,
      overdueCount: 2,
    });
  });

  test('14.3 Navigation and action helpers enforce orders.view for viewing and orders.fulfill for KDS transitions without payment fields', () => {
    const ownerMember = {
      role: 'owner' as const,
      permissions: DEFAULT_ROLE_PERMISSIONS.owner,
      is_active: true,
    };
    const staffMember = {
      role: 'staff' as const,
      permissions: DEFAULT_ROLE_PERMISSIONS.staff,
      is_active: true,
    };
    const cashierMember = {
      role: 'cashier' as const,
      permissions: DEFAULT_ROLE_PERMISSIONS.cashier,
      is_active: true,
    };
    const viewAndPayOnlyMember = {
      role: 'cashier' as const,
      permissions: ['orders.view' as const, 'payment.collect' as const],
      is_active: true,
    };
    const catalogOnlyMember = {
      role: 'staff' as const,
      permissions: ['catalog.manage' as const],
      is_active: true,
    };
    const inactiveStaffMember = {
      role: 'staff' as const,
      permissions: DEFAULT_ROLE_PERMISSIONS.staff,
      is_active: false,
    };

    // Navigation access to /dashboard/kitchen requires orders.view
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', ownerMember),
      true
    );
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', staffMember),
      true
    );
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', cashierMember),
      true
    );
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', viewAndPayOnlyMember),
      true,
      'Member with orders.view can view KDS status'
    );
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', catalogOnlyMember),
      false,
      'Member without orders.view cannot access /dashboard/kitchen'
    );
    assert.equal(
      canAccessDashboardHref('/dashboard/kitchen', inactiveStaffMember),
      false
    );

    // KDS fulfillment actions require orders.fulfill
    assert.equal(canPerformKitchenFulfill(ownerMember), true);
    assert.equal(canPerformKitchenFulfill(staffMember), true);
    assert.equal(canPerformKitchenFulfill(cashierMember), true);
    assert.equal(
      canPerformKitchenFulfill(viewAndPayOnlyMember),
      false,
      'Member without orders.fulfill must not have KDS fulfill actions enabled'
    );
    assert.equal(canPerformKitchenFulfill(inactiveStaffMember), false);
    assert.equal(canPerformKitchenFulfill(null), false);

    // Status transitions: new -> preparing -> completed
    assert.equal(getNextKitchenOrderStatus('new'), 'preparing');
    assert.equal(getNextKitchenOrderStatus('preparing'), 'completed');
    assert.equal(getNextKitchenOrderStatus('completed'), null);
    assert.equal(getNextKitchenOrderStatus('cancelled'), null);

    const startCookingPayload = buildKitchenFulfillPatchPayload({
      shopId: 'shop-fnb-001',
      orderId: 'ord-kds-100',
      currentStatus: 'new',
    });
    assert.deepEqual(startCookingPayload, {
      shop_id: 'shop-fnb-001',
      order_id: 'ord-kds-100',
      status: 'preparing',
    });
    assert.equal(
      'payment_status' in
        (startCookingPayload as unknown as Record<string, unknown>),
      false,
      'KDS payload must never include payment_status'
    );
    assert.equal(
      'payment_method' in
        (startCookingPayload as unknown as Record<string, unknown>),
      false,
      'KDS payload must never include payment_method'
    );

    const markDonePayload = buildKitchenFulfillPatchPayload({
      shopId: 'shop-fnb-001',
      orderId: 'ord-kds-100',
      currentStatus: 'preparing',
    });
    assert.deepEqual(markDonePayload, {
      shop_id: 'shop-fnb-001',
      order_id: 'ord-kds-100',
      status: 'completed',
    });

    assert.equal(
      buildKitchenFulfillPatchPayload({
        shopId: 'shop-fnb-001',
        orderId: 'ord-kds-100',
        currentStatus: 'completed',
      }),
      null
    );
  });

  test('14.4 reconcileKitchenOrdersFetch avoids false confirmed-empty state on initial error, preserves tickets on transient errors, and isolates stale-shop callbacks/results', () => {
    const sampleTicket = baseOrder({ id: 'ord-keep-1', order_code: '#KEEP1' });

    // 1. Initial state before any fetch has succeeded: hasLoaded is false
    const unloadedState = createInitialKitchenOrdersState('shop-fnb-001');
    assert.equal(unloadedState.hasLoaded, false);
    assert.equal(
      shouldShowKitchenConfirmedEmptyState({
        state: unloadedState,
        activeShopId: 'shop-fnb-001',
        visibleTicketsCount: 0,
        loading: false,
      }),
      false,
      'Must not show confirmed-empty state before any successful fetch'
    );

    // 2. Initial-load failure must keep hasLoaded=false and never show confirmed-empty state
    const afterInitialError = reconcileKitchenOrdersFetch(unloadedState, {
      shopId: 'shop-fnb-001',
      activeShopId: 'shop-fnb-001',
      ok: false,
      status: 500,
      error: 'Initial load failed',
    });
    assert.equal(afterInitialError.hasLoaded, false);
    assert.equal(afterInitialError.orders.length, 0);
    assert.equal(afterInitialError.fetchError, 'Initial load failed');
    assert.equal(
      shouldShowKitchenConfirmedEmptyState({
        state: afterInitialError,
        activeShopId: 'shop-fnb-001',
        visibleTicketsCount: 0,
        loading: false,
      }),
      false,
      'Initial-load error must not show a false "all active tickets cleared" empty state'
    );

    // 3. Confirmed empty after a successful fetch with zero active tickets
    const confirmedEmptyState = reconcileKitchenOrdersFetch(afterInitialError, {
      shopId: 'shop-fnb-001',
      activeShopId: 'shop-fnb-001',
      ok: true,
      orders: [],
    });
    assert.equal(confirmedEmptyState.hasLoaded, true);
    assert.equal(confirmedEmptyState.fetchError, null);
    assert.equal(
      shouldShowKitchenConfirmedEmptyState({
        state: confirmedEmptyState,
        activeShopId: 'shop-fnb-001',
        visibleTicketsCount: 0,
        loading: false,
      }),
      true,
      'Confirmed-empty state renders only after a successful fetch with no active tickets'
    );

    // 4. Successful fetch with active ticket
    const loadedWithTicket = reconcileKitchenOrdersFetch(confirmedEmptyState, {
      shopId: 'shop-fnb-001',
      activeShopId: 'shop-fnb-001',
      ok: true,
      orders: [sampleTicket],
    });
    assert.equal(loadedWithTicket.shopId, 'shop-fnb-001');
    assert.equal(loadedWithTicket.hasLoaded, true);
    assert.equal(loadedWithTicket.orders.length, 1);
    assert.equal(loadedWithTicket.fetchError, null);

    // 5. Transient network/503 failure on the same shop must keep tickets visible and hasLoaded=true
    const afterTransientError = reconcileKitchenOrdersFetch(loadedWithTicket, {
      shopId: 'shop-fnb-001',
      activeShopId: 'shop-fnb-001',
      ok: false,
      status: 503,
      error: 'Service temporarily unavailable',
    });
    assert.equal(
      afterTransientError.orders.length,
      1,
      'Transient fetch failure must not clear active KDS tickets for the same shop'
    );
    assert.equal(afterTransientError.orders[0].id, 'ord-keep-1');
    assert.equal(afterTransientError.hasLoaded, true);
    assert.equal(
      afterTransientError.fetchError,
      'Service temporarily unavailable'
    );
    assert.equal(afterTransientError.sessionExpired, false);

    // 6. 401 on the same shop marks sessionExpired while preserving current view
    const after401 = reconcileKitchenOrdersFetch(afterTransientError, {
      shopId: 'shop-fnb-001',
      activeShopId: 'shop-fnb-001',
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });
    assert.equal(after401.orders.length, 1);
    assert.equal(after401.sessionExpired, true);

    // 7. Switching to another shop that errors must NOT leak previous shop tickets or hasLoaded
    const switchedShopError = reconcileKitchenOrdersFetch(after401, {
      shopId: 'shop-fnb-002',
      activeShopId: 'shop-fnb-002',
      ok: false,
      status: 500,
      error: 'Failed to load new shop',
    });
    assert.equal(switchedShopError.shopId, 'shop-fnb-002');
    assert.equal(switchedShopError.hasLoaded, false);
    assert.equal(
      switchedShopError.orders.length,
      0,
      'Switching shops must not retain another shop tickets'
    );

    // 8. Regression: Stale-shop PATCH / fetch callback isolation after switching shops
    const tracker = createKitchenShopScopeTracker('shop-fnb-001');
    const shopAPatchScope = tracker.canStartForShop('shop-fnb-001');
    assert.ok(shopAPatchScope, 'Operation for active shop-fnb-001 can start');
    assert.equal(
      tracker.isCurrent(shopAPatchScope, 'shop-fnb-001'),
      true
    );

    // User switches active shop to shop-fnb-002 while shop-fnb-001 PATCH/fetch is in flight
    const shopBScope = tracker.setActiveShop('shop-fnb-002');
    assert.equal(shopBScope.shopId, 'shop-fnb-002');
    const shopBState = createInitialKitchenOrdersState('shop-fnb-002');

    // Old PATCH callback from shop-fnb-001 resolves after switch:
    // - isCurrent is false (blocks membership update, PATCH follow-up refresh, and broadcast)
    assert.equal(
      tracker.isCurrent(shopAPatchScope, 'shop-fnb-001'),
      false,
      'In-flight operation token from shop-fnb-001 must be invalidated after switching to shop-fnb-002'
    );
    assert.equal(
      isKitchenShopScopeCurrent({
        operationShopId: 'shop-fnb-001',
        currentShopId: tracker.getCurrentScope().shopId,
      }),
      false
    );

    // - If an old fetchKitchenOrders closure that captured shop-fnb-001 is invoked, canStartForShop rejects it
    assert.equal(
      tracker.canStartForShop('shop-fnb-001'),
      null,
      'Stale fetch closure for shop-fnb-001 must not start against shop-fnb-002 scope'
    );

    // - If a stale fetch result for shop-fnb-001 arrives late, reconcileKitchenOrdersFetch ignores it
    const afterStaleShopAResult = reconcileKitchenOrdersFetch(shopBState, {
      shopId: 'shop-fnb-001',
      activeShopId: tracker.getCurrentScope().shopId,
      ok: true,
      orders: [sampleTicket],
    });
    assert.equal(
      afterStaleShopAResult,
      shopBState,
      'Stale fetch result from shop-fnb-001 must not overwrite shop-fnb-002 state'
    );
    assert.equal(afterStaleShopAResult.shopId, 'shop-fnb-002');
    assert.equal(afterStaleShopAResult.orders.length, 0);

    // Disposing the tracker invalidates even the current shop scope
    tracker.dispose();
    assert.equal(tracker.isDisposed(), true);
    assert.equal(tracker.isCurrent(shopBScope, 'shop-fnb-002'), false);
    assert.equal(tracker.canStartForShop('shop-fnb-002'), null);
  });

  test('14.5 KitchenTicketCard renders order code, table/takeaway, age, overdue alert, item options/notes, and gates touch actions by canFulfill', () => {
    const createdAt = '2026-10-22T08:30:00.000Z';
    const ticket = baseOrder({
      id: 'ord-card-1',
      order_code: '#KDS88',
      table_label: 'Bàn 12',
      customer_note: 'Khách dị ứng đậu phộng',
      status: 'new',
      created_at: createdAt,
    });

    assert.equal(
      formatKitchenLineOptionLabel(ticket.items[0].selected_choices[0], 'vi'),
      'Thêm hành'
    );
    assert.equal(
      formatKitchenLineOptionLabel(ticket.items[0].selected_choices[0], 'en'),
      'Extra scallions'
    );

    const ssrScript = `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { KitchenTicketCard } from './src/components/dashboard/KitchenTicketCard.tsx';
      const ticket = ${JSON.stringify(ticket)};
      const nowMs = Date.parse('2026-10-22T08:50:00.000Z');
      const htmlWithFulfill = renderToStaticMarkup(
        React.createElement(KitchenTicketCard, {
          order: ticket,
          locale: 'vi',
          nowMs,
          canFulfill: true,
          isUpdating: false,
          onAdvanceStatus: () => {},
        })
      );
      const htmlReadOnlyEn = renderToStaticMarkup(
        React.createElement(KitchenTicketCard, {
          order: { ...ticket, table_label: 'Mang đi', status: 'preparing' },
          locale: 'en',
          nowMs,
          canFulfill: false,
          isUpdating: false,
          onAdvanceStatus: () => {},
        })
      );
      console.log(JSON.stringify({ htmlWithFulfill, htmlReadOnlyEn }));
    `;

    const rawOut = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        './tests/register-ts.mjs',
        '--import',
        './tests/tsx-review-loader.mjs',
        '--input-type=module',
        '-e',
        ssrScript,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 }
    );
    const { htmlWithFulfill, htmlReadOnlyEn } = JSON.parse(rawOut.trim()) as {
      htmlWithFulfill: string;
      htmlReadOnlyEn: string;
    };

    assert.ok(htmlWithFulfill.includes('#KDS88'), 'Must render order code');
    assert.ok(htmlWithFulfill.includes('Bàn 12'), 'Must render table label');
    assert.ok(htmlWithFulfill.includes('20 phút'), 'Must render elapsed age');
    assert.ok(
      htmlWithFulfill.includes('Từ 15 phút (≥ 15p)'),
      'Must render inclusive >= 15m overdue indicator'
    );
    assert.ok(
      htmlWithFulfill.includes('Phở bò tái nạm') &&
        htmlWithFulfill.includes('x2'),
      'Must render item name and quantity'
    );
    assert.ok(
      htmlWithFulfill.includes('Thêm hành') &&
        htmlWithFulfill.includes('Ít cay'),
      'Must render selected options and quick tags'
    );
    assert.ok(
      htmlWithFulfill.includes('Nước béo riêng'),
      'Must render line custom_note'
    );
    assert.ok(
      htmlWithFulfill.includes('Khách dị ứng đậu phộng'),
      'Must render order customer_note'
    );
    assert.ok(
      htmlWithFulfill.includes('Bắt đầu làm'),
      'Must render start-cooking action when canFulfill is true'
    );
    assert.ok(
      !htmlWithFulfill.includes('Đã thanh toán'),
      'Must not conflate KDS fulfillment card with payment actions'
    );

    assert.ok(
      htmlReadOnlyEn.includes('Takeaway'),
      'Must localize takeaway label in English'
    );
    assert.ok(
      htmlReadOnlyEn.includes('≥ 15m threshold'),
      'Must render inclusive >= 15m threshold label in English'
    );
    assert.ok(
      htmlReadOnlyEn.includes('Rare &amp; Flank Beef Pho'),
      'Must render localized English item name when available'
    );
    assert.ok(
      htmlReadOnlyEn.includes('Extra scallions'),
      'Must render localized English option label'
    );
    assert.ok(
      htmlReadOnlyEn.includes(
        'View only — requires orders.fulfill permission to mark done'
      ),
      'Must show view-only notice and hide action button when canFulfill is false'
    );
    assert.ok(
      !htmlReadOnlyEn.includes('Done (Complete)'),
      'Must not render fulfillment action button when canFulfill is false'
    );
  });

  test('14.6 Server PATCH /api/orders enforces orders.fulfill on KDS transitions and preserves unpaid payment_status', async () => {
    const viewOnlyCashierId = 'user-kds-cashier-no-fulfill';
    const kitchenStaffId = 'user-kds-staff-fulfill';

    try {
      // Upsert a cashier without orders.fulfill and a kitchen staff with orders.fulfill
      await dbUpsertShopMembership({
        shop_id: 'shop-fnb-001',
        user_id: viewOnlyCashierId,
        role: 'cashier',
        permissions: ['orders.view', 'payment.collect'],
        is_active: true,
      });
      await dbUpsertShopMembership({
        shop_id: 'shop-fnb-001',
        user_id: kitchenStaffId,
        role: 'staff',
        permissions: ['orders.view', 'orders.fulfill'],
        is_active: true,
      });

      const created = await dbCreateOrder({
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn KDS 05',
        customer_note: 'Làm nhanh giúp khách',
        items: [
          {
            item_id: SEED_ITEMS[0].id,
            name_vi: SEED_ITEMS[0].name_i18n.vi || 'Món thử KDS',
            quantity: 1,
            unit_price: SEED_ITEMS[0].price,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      });
      assert.equal(created.status, 'new');
      assert.equal(created.payment_status, 'unpaid');

      const cashierToken = issueSessionToken({
        id: viewOnlyCashierId,
        email: 'cashier-kds@example.com',
        role: 'owner',
      });
      const staffToken = issueSessionToken({
        id: kitchenStaffId,
        email: 'kitchen-staff@example.com',
        role: 'owner',
      });

      const startPayload = buildKitchenFulfillPatchPayload({
        shopId: 'shop-fnb-001',
        orderId: created.id,
        currentStatus: created.status,
      });
      assert.ok(startPayload);

      // 1. Cashier without orders.fulfill is rejected by PATCH /api/orders with 403
      const forbiddenRes = await ordersPatch(
        new Request('http://localhost:3000/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cashierToken}`,
          },
          body: JSON.stringify(startPayload),
        })
      );
      assert.equal(
        forbiddenRes.status,
        403,
        'Member without orders.fulfill must be rejected with 403 on KDS status transition'
      );
      const forbiddenBody = await forbiddenRes.json();
      assert.equal(forbiddenBody.code, 'INSUFFICIENT_SHOP_PERMISSION');

      // 2. Staff with orders.fulfill transitions new -> preparing; payment_status stays unpaid
      const prepRes = await ordersPatch(
        new Request('http://localhost:3000/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
          },
          body: JSON.stringify(startPayload),
        })
      );
      assert.equal(prepRes.status, 200);
      const prepBody = await prepRes.json();
      assert.equal(prepBody.order.status, 'preparing');
      assert.equal(prepBody.order.payment_status, 'unpaid');
      assert.equal(prepBody.order.paid_at, undefined);

      // 3. Staff with orders.fulfill transitions preparing -> completed; payment_status STILL stays unpaid
      const completePayload = buildKitchenFulfillPatchPayload({
        shopId: 'shop-fnb-001',
        orderId: created.id,
        currentStatus: prepBody.order.status,
      });
      assert.ok(completePayload);

      const doneRes = await ordersPatch(
        new Request('http://localhost:3000/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
          },
          body: JSON.stringify(completePayload),
        })
      );
      assert.equal(doneRes.status, 200);
      const doneBody = await doneRes.json();
      assert.equal(doneBody.order.status, 'completed');
      assert.equal(
        doneBody.order.payment_status,
        'unpaid',
        'Completing service in KDS must never mark an order paid'
      );
      assert.equal(doneBody.order.paid_at, undefined);

      // 4. Completed order is excluded from KDS active queue but remains in shop order history
      const persistedOrder = await dbGetOrderById(created.id);
      assert.ok(
        persistedOrder,
        'Completed order must remain preserved in order history outside KDS'
      );
      assert.equal(persistedOrder?.status, 'completed');
      assert.equal(
        isActiveKitchenOrder(persistedOrder, 'shop-fnb-001'),
        false,
        'Completed order must no longer appear in KDS active queue'
      );

      // 5. Scoped GET /api/orders?shopId=shop-fnb-001&view=kds excludes the completed order and omits stats/catalog
      assert.equal(
        buildKitchenOrdersUrl('shop-fnb-001'),
        '/api/orders?shopId=shop-fnb-001&view=kds'
      );
      const kdsGetRes = await ordersGet(
        new Request(
          `http://localhost:3000${buildKitchenOrdersUrl('shop-fnb-001')}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${staffToken}` },
          }
        )
      );
      assert.equal(kdsGetRes.status, 200);
      const kdsGetBody = await kdsGetRes.json();
      assert.equal(
        kdsGetBody.orders.some((o: { id: string }) => o.id === created.id),
        false,
        'GET /api/orders?view=kds must exclude completed orders'
      );
      assert.equal(
        kdsGetBody.orders.every(
          (o: { shop_id: string; status: string }) =>
            o.shop_id === 'shop-fnb-001' &&
            (o.status === 'new' || o.status === 'preparing')
        ),
        true,
        'GET /api/orders?view=kds must return only active orders for the requested shop'
      );
      assert.equal('stats' in kdsGetBody, false);
      assert.equal('serviceRequests' in kdsGetBody, false);
    } finally {
      await dbDeleteShopMembership('shop-fnb-001', viewOnlyCashierId);
      await dbDeleteShopMembership('shop-fnb-001', kitchenStaffId);
    }
  });
});
