import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatVnd,
  getMobilePromoPreviewStrings,
  MOBILE_PROMO_I18N,
  resolveMobilePromoPreview,
} from '../src/lib/promo-preview-i18n.ts';
import type {
  MobileFlashSaleConfig,
  MobilePromoBannerConfig,
} from '../src/lib/supabase.ts';

test('MOBILE_PROMO_I18N contains definitions for all 8 supported languages', () => {
  const expectedLanguages = ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru'];
  assert.deepEqual(Object.keys(MOBILE_PROMO_I18N).sort(), [...expectedLanguages].sort());

  for (const lang of expectedLanguages) {
    const loc = MOBILE_PROMO_I18N[lang];
    assert.ok(loc.promoBadge && loc.promoBadge.trim().length > 0, `Missing promoBadge for ${lang}`);
    assert.ok(loc.timePrefix && loc.timePrefix.trim().length > 0, `Missing timePrefix for ${lang}`);
    assert.equal(typeof loc.promoTitle, 'function');
    assert.equal(typeof loc.promoSub, 'function');
    assert.equal(typeof loc.flashTitle, 'function');
  }

  // Verify Russian Cyrillic promoSub directly in the map
  assert.equal(
    MOBILE_PROMO_I18N.ru.promoSub(),
    'Скидка применяется автоматически при заказе'
  );
  // Verify Italian promoSub directly in the map
  assert.equal(
    MOBILE_PROMO_I18N.it.promoSub(),
    'Lo sconto viene applicato automaticamente al tavolo'
  );
});

test('getMobilePromoPreviewStrings falls back safely to Vietnamese for unknown, null, or empty locales', () => {
  const vi = MOBILE_PROMO_I18N.vi;
  assert.equal(getMobilePromoPreviewStrings(undefined), vi);
  assert.equal(getMobilePromoPreviewStrings(null), vi);
  assert.equal(getMobilePromoPreviewStrings(''), vi);
  assert.equal(getMobilePromoPreviewStrings('unknown'), vi);
  assert.equal(getMobilePromoPreviewStrings('fr'), vi);
  assert.equal(getMobilePromoPreviewStrings('de'), vi);
});

test('getMobilePromoPreviewStrings returns the exact mapping for each supported locale', () => {
  const langs = ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru'] as const;
  for (const lang of langs) {
    assert.equal(getMobilePromoPreviewStrings(lang), MOBILE_PROMO_I18N[lang]);
  }
});

test('resolveMobilePromoPreview verifies promo badge, title, subtitle, flash title, and time prefix across all 8 locales', () => {
  const bannerPercent: MobilePromoBannerConfig = {
    enabled: true,
    discountType: 'percent',
    discountValue: 20,
    title: 'Mừng khai trương',
    subtitle: 'Áp dụng cho mọi hóa đơn',
    badgeText: 'HOT DEAL',
  };

  const flashSale: MobileFlashSaleConfig = {
    enabled: true,
    title: 'Flash Siêu Hot',
    discountType: 'percent',
    discountValue: 30,
    startTime: '14:00',
    endTime: '16:00',
    itemIds: ['item-1', 'item-2'],
  };

  // 1. Vietnamese (vi) - title uses fallbackTitle, custom badgeText is permitted in VI
  const resVi = resolveMobilePromoPreview({
    previewLang: 'vi',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resVi.badgeStr, 'HOT DEAL');
  assert.equal(resVi.titleStr, 'Mừng khai trương');
  assert.equal(resVi.subStr, 'Áp dụng cho mọi hóa đơn');
  assert.equal(resVi.flashTitleStr, 'Flash Siêu Hot');
  assert.equal(resVi.flashDiscountLabel, '-30%');
  assert.equal(resVi.flashTimePrefix, 'Khung giờ');
  assert.equal(resVi.flashTimeRange, '14:00 - 16:00');

  // Vietnamese fallback defaults when title/subtitle/flashTitle are empty
  const bannerEmpty: MobilePromoBannerConfig = {
    enabled: false,
    title: '',
    discountType: 'percent',
    discountValue: 15,
  };
  const flashEmpty: MobileFlashSaleConfig = {
    enabled: false,
    title: '',
    discountType: 'percent',
    discountValue: 0,
    startTime: '11:00',
    endTime: '13:00',
    itemIds: [],
  };
  const resViEmpty = resolveMobilePromoPreview({
    previewLang: 'vi',
    promoBanner: bannerEmpty,
    flashSale: flashEmpty,
  });
  assert.equal(resViEmpty.badgeStr, '🔥 ƯU ĐÃI HÔM NAY');
  assert.equal(resViEmpty.titleStr, '');
  assert.equal(resViEmpty.subStr, '');
  assert.equal(resViEmpty.flashTitleStr, 'Giờ Vàng Giá Sốc');
  assert.equal(resViEmpty.flashTimePrefix, 'Khung giờ');
  assert.equal(resViEmpty.flashTimeRange, '11:00 - 13:00');

  // 2. English (en) - custom badgeText is ignored (uses locText.promoBadge), title interpolates discount
  const resEn = resolveMobilePromoPreview({
    previewLang: 'en',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resEn.badgeStr, '🔥 TODAY’S SPECIAL');
  assert.equal(resEn.titleStr, 'Get 20% OFF on your order');
  assert.equal(resEn.subStr, 'Discount automatically applied at table checkout');
  assert.equal(resEn.flashTitleStr, 'Golden Hour Flash Sale');
  assert.equal(resEn.flashDiscountLabel, '-30%');
  assert.equal(resEn.flashTimePrefix, 'Time');
  assert.equal(resEn.flashTimeRange, '14:00 - 16:00');

  // 3. Korean (ko)
  const resKo = resolveMobilePromoPreview({
    previewLang: 'ko',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resKo.badgeStr, '🔥 오늘의 프로모션');
  assert.equal(resKo.titleStr, '주문 시 20% 즉시 할인');
  assert.equal(resKo.subStr, '테이블 주문 시 할인이 자동 적용됩니다');
  assert.equal(resKo.flashTitleStr, '타임세일 한정 특가');
  assert.equal(resKo.flashDiscountLabel, '-30%');
  assert.equal(resKo.flashTimePrefix, '시간');
  assert.equal(resKo.flashTimeRange, '14:00 - 16:00');

  // 4. Japanese (ja)
  const resJa = resolveMobilePromoPreview({
    previewLang: 'ja',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resJa.badgeStr, '🔥 本日のキャンペーン');
  assert.equal(resJa.titleStr, 'ご注文で 20% 割引');
  assert.equal(resJa.subStr, 'ご注文時に割引が自動適用されます');
  assert.equal(resJa.flashTitleStr, '時間限定タイムセール');
  assert.equal(resJa.flashDiscountLabel, '-30%');
  assert.equal(resJa.flashTimePrefix, '時間');
  assert.equal(resJa.flashTimeRange, '14:00 - 16:00');

  // 5. Chinese (zh)
  const resZh = resolveMobilePromoPreview({
    previewLang: 'zh',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resZh.badgeStr, '🔥 今日特惠活动');
  assert.equal(resZh.titleStr, '扫码点餐立减 20%');
  assert.equal(resZh.subStr, '点餐结算时系统自动减免');
  assert.equal(resZh.flashTitleStr, '黄金时段限时秒杀');
  assert.equal(resZh.flashDiscountLabel, '-30%');
  assert.equal(resZh.flashTimePrefix, '时段');
  assert.equal(resZh.flashTimeRange, '14:00 - 16:00');

  // 6. Spanish (es)
  const resEs = resolveMobilePromoPreview({
    previewLang: 'es',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resEs.badgeStr, '🔥 OFERTA DE HOY');
  assert.equal(resEs.titleStr, '20% de descuento en tu pedido');
  assert.equal(resEs.subStr, 'Descuento aplicado automáticamente en mesa');
  assert.equal(resEs.flashTitleStr, 'Oferta Flash Hora Dorada');
  assert.equal(resEs.flashDiscountLabel, '-30%');
  assert.equal(resEs.flashTimePrefix, 'Horario');
  assert.equal(resEs.flashTimeRange, '14:00 - 16:00');

  // 7. Italian (it)
  const resIt = resolveMobilePromoPreview({
    previewLang: 'it',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resIt.badgeStr, '🔥 PROMO DI OGGI');
  assert.equal(resIt.titleStr, 'Sconto di 20% sul tuo ordine');
  assert.equal(resIt.subStr, 'Lo sconto viene applicato automaticamente al tavolo');
  assert.equal(resIt.flashTitleStr, 'Offerta Lampo Ora d’Oro');
  assert.equal(resIt.flashDiscountLabel, '-30%');
  assert.equal(resIt.flashTimePrefix, 'Orario');
  assert.equal(resIt.flashTimeRange, '14:00 - 16:00');

  // 8. Russian (ru)
  const resRu = resolveMobilePromoPreview({
    previewLang: 'ru',
    promoBanner: bannerPercent,
    flashSale,
  });
  assert.equal(resRu.badgeStr, '🔥 АКЦИЯ ДНЯ');
  assert.equal(resRu.titleStr, 'Скидка 20% на ваш заказ');
  assert.equal(resRu.subStr, 'Скидка применяется автоматически при заказе');
  assert.equal(resRu.flashTitleStr, 'Flash-акция Счастливые часы');
  assert.equal(resRu.flashDiscountLabel, '-30%');
  assert.equal(resRu.flashTimePrefix, 'Время');
  assert.equal(resRu.flashTimeRange, '14:00 - 16:00');
});

test('handles percent and fixed_amount discounts while preserving formatVnd output', () => {
  const expectedFixedAmountVnd = formatVnd(50000);
  assert.equal(expectedFixedAmountVnd, '50.000đ');

  const bannerFixed: MobilePromoBannerConfig = {
    enabled: true,
    title: 'Giảm giá tiền mặt',
    discountType: 'fixed_amount',
    discountValue: 50000,
  };
  const flashFixed: MobileFlashSaleConfig = {
    enabled: true,
    title: 'Flash Giảm Tiền',
    discountType: 'fixed_amount',
    discountValue: 20000,
    startTime: '10:00',
    endTime: '12:00',
    itemIds: ['item-1'],
  };

  const resFixed = resolveMobilePromoPreview({
    previewLang: 'en',
    promoBanner: bannerFixed,
    flashSale: flashFixed,
  });

  assert.equal(resFixed.discValStr, '50.000đ');
  assert.equal(resFixed.titleStr, 'Get 50.000đ OFF on your order');
  assert.equal(resFixed.flashDiscountLabel, `-${formatVnd(20000)}`);
  assert.equal(resFixed.flashTimePrefix, 'Time');
  assert.equal(resFixed.flashTimeRange, '10:00 - 12:00');

  // Default values when discountValue is missing/zero
  const bannerZero: MobilePromoBannerConfig = {
    enabled: true,
    title: '',
    discountType: 'fixed_amount',
  };
  const flashZero: MobileFlashSaleConfig = {
    enabled: true,
    title: '',
    discountType: 'fixed_amount',
    discountValue: 0,
    itemIds: [],
  };
  const resDefault = resolveMobilePromoPreview({
    previewLang: 'en',
    promoBanner: bannerZero,
    flashSale: flashZero,
  });
  assert.equal(resDefault.discValStr, formatVnd(20000));
  assert.equal(resDefault.flashDiscountLabel, `-${formatVnd(0)}`);
});

test('unknown locale falls back exactly to existing Vietnamese behavior', () => {
  const banner: MobilePromoBannerConfig = {
    enabled: true,
    title: 'Tiêu đề tùy chỉnh',
    subtitle: 'Phụ đề tùy chỉnh',
    badgeText: 'HUY HIỆU TÙY CHỈNH',
    discountType: 'percent',
    discountValue: 25,
  };
  const flash: MobileFlashSaleConfig = {
    enabled: true,
    title: 'Flash riêng',
    discountType: 'percent',
    discountValue: 15,
    startTime: '08:00',
    endTime: '10:00',
    itemIds: [],
  };

  const unknownRes = resolveMobilePromoPreview({
    previewLang: 'unknown_lang',
    promoBanner: banner,
    flashSale: flash,
  });

  const viRes = resolveMobilePromoPreview({
    previewLang: 'vi',
    promoBanner: banner,
    flashSale: flash,
  });

  assert.equal(unknownRes.locText, MOBILE_PROMO_I18N.vi);
  assert.equal(unknownRes.titleStr, viRes.titleStr);
  assert.equal(unknownRes.subStr, viRes.subStr);
  assert.equal(unknownRes.flashTitleStr, viRes.flashTitleStr);
  assert.equal(unknownRes.flashDiscountLabel, viRes.flashDiscountLabel);
  assert.equal(unknownRes.flashTimePrefix, viRes.flashTimePrefix);
  assert.equal(unknownRes.flashTimeRange, viRes.flashTimeRange);
});
