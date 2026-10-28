import type { ShopOrder } from '@/types/qlaok';

type OrderDiscountFields = Pick<
  ShopOrder,
  'discount_amount' | 'promo_discount_amount' | 'manual_discount_amount'
>;

function toNonNegativeInteger(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function getStoredPromoDiscountAmount(order: OrderDiscountFields): number {
  return toNonNegativeInteger(order.promo_discount_amount);
}

export function getStoredManualDiscountAmount(order: OrderDiscountFields): number {
  if (order.manual_discount_amount !== undefined && order.manual_discount_amount !== null) {
    return toNonNegativeInteger(order.manual_discount_amount);
  }

  return Math.max(
    0,
    toNonNegativeInteger(order.discount_amount) - getStoredPromoDiscountAmount(order)
  );
}

export function calculateOrderDiscountTotals(params: {
  subtotalAmount: number;
  lineManualDiscountAmount?: number;
  inheritedManualDiscountAmount?: number;
  promoDiscountAmount?: number;
}): {
  manualDiscountAmount: number;
  promoDiscountAmount: number;
  discountAmount: number;
  totalAmount: number;
} {
  const subtotalAmount = toNonNegativeInteger(params.subtotalAmount);
  const promoDiscountAmount = Math.min(
    subtotalAmount,
    toNonNegativeInteger(params.promoDiscountAmount)
  );
  const requestedManualDiscount =
    toNonNegativeInteger(params.lineManualDiscountAmount) +
    toNonNegativeInteger(params.inheritedManualDiscountAmount);
  const manualDiscountAmount = Math.min(
    Math.max(0, subtotalAmount - promoDiscountAmount),
    requestedManualDiscount
  );
  const discountAmount = promoDiscountAmount + manualDiscountAmount;

  return {
    manualDiscountAmount,
    promoDiscountAmount,
    discountAmount,
    totalAmount: Math.max(0, subtotalAmount - discountAmount),
  };
}

export function buildPosOrderDiscountPayload(totals: {
  manualDiscountAmount: number;
  totalAmount: number;
}): {
  discount_amount: number;
  expected_total: number;
  apply_shop_promotions: false;
} {
  return {
    discount_amount: totals.manualDiscountAmount,
    expected_total: totals.totalAmount,
    apply_shop_promotions: false,
  };
}
