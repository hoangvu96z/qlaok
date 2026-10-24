import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSharedOrderQuote,
  getItemFlashSalePrice,
  getVietnamDateAndTime,
  isFlashSaleActiveNow,
} from '@/lib/order-pricing';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import type { FlashSaleConfig, Shop } from '@/types/qlaok';

const lines = ['eligible', 'excluded'].map((item_id) => ({
  item_id, name_vi: item_id, quantity: 1, unit_price: 100000, extra_price: 0, selected_choices: [],
}));

test('selected-item promotion only discounts eligible lines', () => {
  const quote = computeSharedOrderQuote({ lines, applyShopPromotions: true,
    themeConfig: { primaryColor: '#000000', layout: 'list', promoBanner: {
      enabled: true, title: 'selected items', applyScope: 'selected_items', selectedItemIds: ['eligible'],
      discountType: 'percent', discountValue: 20,
    } },
  });
  assert.equal(quote.discount_amount, 20000);
  assert.equal(quote.total_amount, 180000);
});

test('missing or unknown bank selection cannot silently generate an MB payment QR', () => {
  for (const bankId of ['', 'not-a-bank']) {
    const shop = { name: 'Fixture', theme_config: { paymentConfig: { bankId, accountNumber: '123456789' } } } as Shop;
    const qr = getShopPaymentQrInfo(shop, 100000, 'TEST');
    assert.equal(qr.isConfigured, false);
    assert.equal(qr.qrImageUrl, '');
  }
});


test('selected-item promotion with no selected items does not discount the whole menu', () => {
  const quote = computeSharedOrderQuote({ lines, applyShopPromotions: true,
    themeConfig: { primaryColor: '#000', layout: 'list', promoBanner: {
      enabled: true, title: 'No items', applyScope: 'selected_items', discountType: 'percent', discountValue: 20,
    } },
  });
  assert.equal(quote.discount_amount, 0);
});

test('Flash Sale schedule evaluates in Vietnam timezone (UTC+7) including exact start/end and outside boundaries', () => {
  // 2026-10-24T17:00:00Z is 2026-10-25 00:00 in Vietnam (UTC+7), even though UTC date is still 2026-10-24
  assert.deepEqual(
    getVietnamDateAndTime(new Date('2026-10-24T17:00:00.000Z')),
    { dateKey: '2026-10-25', timeHm: '00:00' }
  );
  assert.deepEqual(
    getVietnamDateAndTime(new Date('2026-10-24T16:59:00.000Z')),
    { dateKey: '2026-10-24', timeHm: '23:59' }
  );

  const daytimeSale: FlashSaleConfig = {
    enabled: true,
    title: 'Flash Sale Trưa',
    discountType: 'percent',
    discountValue: 25,
    startDate: '2026-10-24',
    endDate: '2026-10-26',
    startTime: '11:00',
    endTime: '14:00',
    itemIds: ['eligible'],
  };

  // Exact start boundary: 2026-10-24 11:00 VN (04:00 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-24T04:00:00.000Z')),
    true
  );
  // Immediately before start time: 2026-10-24 10:59 VN (03:59 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-24T03:59:00.000Z')),
    false
  );
  // Exact end boundary: 2026-10-26 14:00 VN (07:00 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-26T07:00:00.000Z')),
    true
  );
  // Immediately after end time: 2026-10-26 14:01 VN (07:01 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-26T07:01:00.000Z')),
    false
  );
  // One day before startDate within the daily time window: 2026-10-23 12:00 VN (05:00 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-23T05:00:00.000Z')),
    false
  );
  // One day after endDate within the daily time window: 2026-10-27 12:00 VN (05:00 UTC)
  assert.equal(
    isFlashSaleActiveNow(daytimeSale, new Date('2026-10-27T05:00:00.000Z')),
    false
  );

  // Overnight window: 22:00 -> 02:00 VN
  const overnightSale: FlashSaleConfig = {
    ...daytimeSale,
    startTime: '22:00',
    endTime: '02:00',
  };
  assert.equal(
    isFlashSaleActiveNow(overnightSale, new Date('2026-10-24T14:59:00.000Z')), // 21:59 VN
    false
  );
  assert.equal(
    isFlashSaleActiveNow(overnightSale, new Date('2026-10-24T15:00:00.000Z')), // 22:00 VN
    true
  );
  assert.equal(
    isFlashSaleActiveNow(overnightSale, new Date('2026-10-24T17:30:00.000Z')), // 2026-10-25 00:30 VN
    true
  );
  assert.equal(
    isFlashSaleActiveNow(overnightSale, new Date('2026-10-24T19:00:00.000Z')), // 2026-10-25 02:00 VN
    true
  );
  assert.equal(
    isFlashSaleActiveNow(overnightSale, new Date('2026-10-24T19:01:00.000Z')), // 2026-10-25 02:01 VN
    false
  );
});

test('Flash Sale enabled/disabled state and item targeting (including empty-selection behavior)', () => {
  const activeTime = new Date('2026-10-24T05:00:00.000Z'); // 12:00 VN

  // Disabled Flash Sale does not discount any item
  const disabledSale: FlashSaleConfig = {
    enabled: false,
    title: 'Tắt Flash Sale',
    discountType: 'percent',
    discountValue: 50,
    itemIds: ['eligible'],
  };
  assert.equal(isFlashSaleActiveNow(disabledSale, activeTime), false);
  assert.deepEqual(
    getItemFlashSalePrice({ id: 'eligible', price: 100000 }, disabledSale, activeTime),
    {
      originalPrice: 100000,
      effectivePrice: 100000,
      discountPerUnit: 0,
      isFlashSaleApplied: false,
    }
  );

  // Explicit itemIds only discounts targeted items
  const targetedSale: FlashSaleConfig = {
    enabled: true,
    title: 'Chỉ giảm món chọn',
    discountType: 'percent',
    discountValue: 30,
    itemIds: ['eligible'],
  };
  assert.deepEqual(
    getItemFlashSalePrice({ id: 'eligible', price: 100000 }, targetedSale, activeTime),
    {
      originalPrice: 100000,
      effectivePrice: 70000,
      discountPerUnit: 30000,
      isFlashSaleApplied: true,
    }
  );
  assert.deepEqual(
    getItemFlashSalePrice({ id: 'excluded', price: 100000 }, targetedSale, activeTime),
    {
      originalPrice: 100000,
      effectivePrice: 100000,
      discountPerUnit: 0,
      isFlashSaleApplied: false,
    }
  );

  // Fallback to selectedItemIds when itemIds is empty
  const fallbackSelectedSale: FlashSaleConfig = {
    enabled: true,
    title: 'Fallback selectedItemIds',
    discountType: 'fixed_amount',
    discountValue: 15000,
    itemIds: [],
    selectedItemIds: ['excluded'],
  };
  assert.equal(
    getItemFlashSalePrice({ id: 'eligible', price: 100000 }, fallbackSelectedSale, activeTime)
      .isFlashSaleApplied,
    false
  );
  assert.equal(
    getItemFlashSalePrice({ id: 'excluded', price: 100000 }, fallbackSelectedSale, activeTime)
      .discountPerUnit,
    15000
  );

  // Documented empty-selection behavior: when both itemIds and selectedItemIds are empty, Flash Sale applies to all items
  const allMenuFlashSale: FlashSaleConfig = {
    enabled: true,
    title: 'Flash Sale Toàn Menu',
    discountType: 'percent',
    discountValue: 10,
    itemIds: [],
  };
  const allMenuQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: true,
    now: activeTime,
    themeConfig: {
      primaryColor: '#000000',
      layout: 'list',
      flashSale: allMenuFlashSale,
    },
  });
  assert.equal(allMenuQuote.flash_discount_amount, 20000);
  assert.equal(allMenuQuote.total_amount, 180000);
  assert.deepEqual(allMenuQuote.applied_promotions, [
    'Flash Sale: Flash Sale Toàn Menu',
  ]);
});

test('Flash Sale fixed/percent discounts, rounding, caps, and auto-promotion opt-out in computeSharedOrderQuote', () => {
  const activeTime = new Date('2026-10-24T05:00:00.000Z'); // 12:00 VN

  // Percentage rounding (15% of 33,333 = 4,999.95 -> rounds to 5,000)
  const roundedPercent = getItemFlashSalePrice(
    { id: 'item-1', price: 33333 },
    {
      enabled: true,
      title: 'Làm tròn phần trăm',
      discountType: 'percent',
      discountValue: 15,
      itemIds: ['item-1'],
    },
    activeTime
  );
  assert.equal(roundedPercent.discountPerUnit, 5000);
  assert.equal(roundedPercent.effectivePrice, 28333);

  // Percentage > 100% is capped at 100% (effectivePrice = 0)
  const cappedPercent = getItemFlashSalePrice(
    { id: 'item-1', price: 45000 },
    {
      enabled: true,
      title: 'Trần 100%',
      discountType: 'percent',
      discountValue: 150,
      itemIds: ['item-1'],
    },
    activeTime
  );
  assert.equal(cappedPercent.discountPerUnit, 45000);
  assert.equal(cappedPercent.effectivePrice, 0);

  // Fixed discount exceeding item price is capped at item price (effectivePrice = 0)
  const cappedFixed = getItemFlashSalePrice(
    { id: 'item-1', price: 35000 },
    {
      enabled: true,
      title: 'Giảm cố định vượt giá món',
      discountType: 'fixed',
      discountValue: 50000,
      itemIds: ['item-1'],
    },
    activeTime
  );
  assert.equal(cappedFixed.discountPerUnit, 35000);
  assert.equal(cappedFixed.effectivePrice, 0);

  const themeConfig = {
    primaryColor: '#000000',
    layout: 'list' as const,
    flashSale: {
      enabled: true,
      title: 'Giảm 25k món chính',
      discountType: 'fixed_amount' as const,
      discountValue: 25000,
      startDate: '2026-10-24',
      endDate: '2026-10-24',
      startTime: '11:00',
      endTime: '14:00',
      itemIds: ['eligible'],
    },
    promoBanner: {
      enabled: true,
      title: 'Giảm thêm 10%',
      discountType: 'percent' as const,
      discountValue: 10,
      applyScope: 'all' as const,
    },
  };

  // Auto-promotion enabled: Flash Sale applies first (25,000), then banner applies on remaining subtotal (175,000 * 10% = 17,500)
  const appliedQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: true,
    now: activeTime,
    themeConfig,
  });
  assert.equal(appliedQuote.subtotal_amount, 200000);
  assert.equal(appliedQuote.flash_discount_amount, 25000);
  assert.equal(appliedQuote.promo_banner_discount_amount, 17500);
  assert.equal(appliedQuote.promo_discount_amount, 42500);
  assert.equal(appliedQuote.total_amount, 157500);

  // Auto-promotion opt-out (applyShopPromotions: false or omitted): neither Flash Sale nor auto banner applies
  for (const applyShopPromotions of [false, undefined]) {
    const optOutQuote = computeSharedOrderQuote({
      lines,
      applyShopPromotions,
      now: activeTime,
      themeConfig,
    });
    assert.equal(optOutQuote.flash_discount_amount, 0);
    assert.equal(optOutQuote.promo_banner_discount_amount, 0);
    assert.equal(optOutQuote.discount_amount, 0);
    assert.equal(optOutQuote.total_amount, 200000);
    assert.deepEqual(optOutQuote.applied_promotions, []);
  }
});

test('promoBanner minimum order, voucherCode, and welcomePopup voucher conditions in computeSharedOrderQuote', () => {
  const activeTime = new Date('2026-10-24T05:00:00.000Z');

  // 1. Minimum order condition blocks banner when subtotal < minOrderAmount
  const belowMinQuote = computeSharedOrderQuote({
    lines, // subtotal = 200,000
    applyShopPromotions: true,
    now: activeTime,
    themeConfig: {
      primaryColor: '#000000',
      layout: 'list',
      promoBanner: {
        enabled: true,
        title: 'Đơn từ 250k giảm 30k',
        discountType: 'fixed_amount',
        discountValue: 30000,
        minOrderAmount: 250000,
        applyScope: 'all',
      },
    },
  });
  assert.equal(belowMinQuote.promo_banner_discount_amount, 0);
  assert.equal(belowMinQuote.total_amount, 200000);

  // 2. Voucher-gated promoBanner requires matching discountCode (case-insensitive) and respects applyShopPromotions !== false
  const voucherTheme = {
    primaryColor: '#000000',
    layout: 'list' as const,
    promoBanner: {
      enabled: true,
      title: 'Voucher 15%',
      discountType: 'percent' as const,
      discountValue: 15,
      minOrderAmount: 150000,
      applyScope: 'all' as const,
      voucherCode: 'QLAOK15',
    },
  };

  const withoutCodeQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: true,
    now: activeTime,
    themeConfig: voucherTheme,
  });
  assert.equal(withoutCodeQuote.promo_banner_discount_amount, 0);
  assert.equal(withoutCodeQuote.applied_discount_code, undefined);

  const wrongCodeQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: true,
    discountCode: 'WRONGCODE',
    now: activeTime,
    themeConfig: voucherTheme,
  });
  assert.equal(wrongCodeQuote.promo_banner_discount_amount, 0);

  const matchingCodeQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: true,
    discountCode: '  qlaok15 ',
    now: activeTime,
    themeConfig: voucherTheme,
  });
  assert.equal(matchingCodeQuote.promo_banner_discount_amount, 30000);
  assert.equal(matchingCodeQuote.total_amount, 170000);
  assert.equal(matchingCodeQuote.applied_discount_code, 'QLAOK15');

  const optedOutVoucherQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: false,
    discountCode: 'QLAOK15',
    now: activeTime,
    themeConfig: voucherTheme,
  });
  assert.equal(optedOutVoucherQuote.promo_banner_discount_amount, 0);

  // 3. Banner without voucherCode can be claimed via enabled welcomePopup.voucherCode
  const popupVoucherTheme = {
    primaryColor: '#000000',
    layout: 'list' as const,
    promoBanner: {
      enabled: true,
      title: 'Ưu đãi khách mới',
      discountType: 'fixed_amount' as const,
      discountValue: 25000,
      applyScope: 'selected_items' as const,
      selectedItemIds: ['eligible'],
    },
    welcomePopup: {
      enabled: true,
      title: 'Chào bạn mới',
      content: 'Nhập WELCOME25',
      voucherCode: 'WELCOME25',
    },
  };

  const popupClaimedQuote = computeSharedOrderQuote({
    lines,
    applyShopPromotions: undefined, // even when auto-promos not set, explicit code claims popup voucher
    discountCode: 'welcome25',
    now: activeTime,
    themeConfig: popupVoucherTheme,
  });
  assert.equal(popupClaimedQuote.promo_banner_discount_amount, 25000);
  assert.equal(popupClaimedQuote.applied_discount_code, 'WELCOME25');
});
