import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPosOrderDiscountPayload,
  calculateOrderDiscountTotals,
  getStoredManualDiscountAmount,
  getStoredPromoDiscountAmount,
} from '@/lib/order-discounts';
import { computeSharedOrderQuote } from '@/lib/order-pricing';
import type { ShopOrder } from '@/types/qlaok';

const discountedOrders = [
  {
    label: 'promo only',
    order: { subtotal_amount: 100000, discount_amount: 10000, promo_discount_amount: 10000, manual_discount_amount: 0, total_amount: 90000 },
  },
  {
    label: 'manual only',
    order: { subtotal_amount: 100000, discount_amount: 5000, promo_discount_amount: 0, manual_discount_amount: 5000, total_amount: 95000 },
  },
  {
    label: 'promo and manual',
    order: { subtotal_amount: 100000, discount_amount: 15000, promo_discount_amount: 10000, manual_discount_amount: 5000, total_amount: 85000 },
  },
];

for (const { label, order } of discountedOrders) {
  test(`POS edit round-trips ${label} discount without folding promo into manual`, () => {
    const stored = order as Pick<ShopOrder, 'discount_amount' | 'promo_discount_amount' | 'manual_discount_amount'>;
    const totals = calculateOrderDiscountTotals({
      subtotalAmount: order.subtotal_amount,
      inheritedManualDiscountAmount: getStoredManualDiscountAmount(stored),
      promoDiscountAmount: getStoredPromoDiscountAmount(stored),
    });
    const payload = buildPosOrderDiscountPayload({
      manualDiscountAmount: totals.manualDiscountAmount,
      totalAmount: totals.totalAmount,
    });

    assert.equal(totals.discountAmount, order.discount_amount);
    assert.equal(totals.totalAmount, order.total_amount);
    assert.equal(payload.discount_amount, order.manual_discount_amount);
    assert.equal(payload.expected_total, order.total_amount);
    assert.equal(payload.apply_shop_promotions, false);
  });
}

test('legacy aggregate discount without split fields is preserved as manual', () => {
  const stored = {
    discount_amount: 12000,
    promo_discount_amount: 3000,
  } as Pick<ShopOrder, 'discount_amount' | 'promo_discount_amount' | 'manual_discount_amount'>;

  assert.equal(getStoredManualDiscountAmount(stored), 9000);
  assert.equal(getStoredPromoDiscountAmount(stored), 3000);
});

test('POS edit preserves a stored promo after it is no longer active and applies manual discount separately', () => {
  const quote = computeSharedOrderQuote({
    lines: [
      {
        item_id: 'item-1',
        name_vi: 'Test item',
        quantity: 1,
        unit_price: 100000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
    applyShopPromotions: false,
    preservedPromoDiscountAmount: 10000,
    manualOrderDiscountAmount: 5000,
    canApplyManualDiscount: true,
  });

  assert.equal(quote.promo_discount_amount, 10000);
  assert.equal(quote.manual_discount_amount, 5000);
  assert.equal(quote.discount_amount, 15000);
  assert.equal(quote.total_amount, 85000);
});
