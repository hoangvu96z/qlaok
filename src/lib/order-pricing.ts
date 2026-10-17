import type {
  FlashSaleConfig,
  OrderLineItem,
  PromoBannerConfig,
  ShopThemeConfig,
} from '@/types/qlaok';

const VN_OFFSET_MS = 7 * 3600 * 1000;

export function getVietnamDateAndTime(now: Date = new Date()): {
  dateKey: string;
  timeHm: string;
} {
  const ts = now.getTime();
  const vnDate = new Date(
    (Number.isNaN(ts) ? Date.now() : ts) + VN_OFFSET_MS
  );
  const iso = vnDate.toISOString();
  return {
    dateKey: iso.slice(0, 10),
    timeHm: iso.slice(11, 16),
  };
}

export function isFlashSaleActiveNow(
  flashSale?: FlashSaleConfig | null,
  now: Date = new Date()
): boolean {
  if (!flashSale || !flashSale.enabled) return false;
  const val = Number(flashSale.discountValue || 0);
  if (!Number.isFinite(val) || val <= 0) return false;

  const { dateKey, timeHm } = getVietnamDateAndTime(now);

  if (flashSale.startDate && flashSale.startDate.trim()) {
    if (dateKey < flashSale.startDate.trim()) return false;
  }
  if (flashSale.endDate && flashSale.endDate.trim()) {
    if (dateKey > flashSale.endDate.trim()) return false;
  }

  const startHm = flashSale.startTime?.trim();
  const endHm = flashSale.endTime?.trim();
  if (startHm && endHm) {
    if (startHm <= endHm) {
      if (timeHm < startHm || timeHm > endHm) return false;
    } else {
      // Overnight window e.g. 22:00 -> 02:00
      if (timeHm < startHm && timeHm > endHm) return false;
    }
  }

  return true;
}

export function isPromoBannerActiveNow(
  promoBanner?: PromoBannerConfig | null,
  now: Date = new Date()
): boolean {
  if (!promoBanner || !promoBanner.enabled) return false;
  const val = Number(promoBanner.discountValue || 0);
  if (!Number.isFinite(val) || val <= 0) return false;

  const { dateKey, timeHm } = getVietnamDateAndTime(now);
  if (promoBanner.startDate && promoBanner.startDate.trim()) {
    if (dateKey < promoBanner.startDate.trim()) return false;
  }
  if (promoBanner.endDate && promoBanner.endDate.trim()) {
    if (dateKey > promoBanner.endDate.trim()) return false;
  }

  const startHm = promoBanner.startTime?.trim();
  const endHm = promoBanner.endTime?.trim();
  if (startHm && endHm) {
    if (startHm <= endHm) {
      if (timeHm < startHm || timeHm > endHm) return false;
    } else {
      if (timeHm < startHm && timeHm > endHm) return false;
    }
  }

  return true;
}

export function getItemFlashSalePrice(
  item: { id: string; price: number },
  flashSale?: FlashSaleConfig | null,
  now: Date = new Date()
): {
  originalPrice: number;
  effectivePrice: number;
  discountPerUnit: number;
  isFlashSaleApplied: boolean;
} {
  const basePrice = Math.max(0, Number(item.price || 0));
  if (!isFlashSaleActiveNow(flashSale, now) || !flashSale) {
    return {
      originalPrice: basePrice,
      effectivePrice: basePrice,
      discountPerUnit: 0,
      isFlashSaleApplied: false,
    };
  }

  const targetIds = Array.isArray(flashSale.itemIds) && flashSale.itemIds.length > 0
    ? flashSale.itemIds
    : Array.isArray(flashSale.selectedItemIds)
      ? flashSale.selectedItemIds
      : [];
  if (targetIds.length > 0 && !targetIds.includes(item.id)) {
    return {
      originalPrice: basePrice,
      effectivePrice: basePrice,
      discountPerUnit: 0,
      isFlashSaleApplied: false,
    };
  }

  const rawVal = Math.max(0, Number(flashSale.discountValue || 0));
  const discountPerUnit =
    flashSale.discountType === 'fixed' || flashSale.discountType === 'fixed_amount'
      ? Math.min(basePrice, Math.round(rawVal))
      : Math.min(
          basePrice,
          Math.round(basePrice * (Math.min(100, rawVal) / 100))
        );

  return {
    originalPrice: basePrice,
    effectivePrice: Math.max(0, basePrice - discountPerUnit),
    discountPerUnit,
    isFlashSaleApplied: discountPerUnit > 0,
  };
}

export interface SharedOrderQuoteResult {
  subtotal_amount: number;
  flash_discount_amount: number;
  promo_banner_discount_amount: number;
  promo_discount_amount: number;
  line_manual_discount_amount: number;
  order_manual_discount_amount: number;
  manual_discount_amount: number;
  discount_amount: number;
  total_amount: number;
  applied_promotions: string[];
  applied_discount_code?: string;
}

export function computeSharedOrderQuote(params: {
  lines: OrderLineItem[];
  themeConfig?: ShopThemeConfig | null;
  applyShopPromotions?: boolean;
  discountCode?: string;
  manualOrderDiscountAmount?: number;
  canApplyManualDiscount?: boolean;
  now?: Date;
}): SharedOrderQuoteResult {
  const now = params.now || new Date();
  const lines = Array.isArray(params.lines) ? params.lines : [];
  const appliedPromotions: string[] = [];

  let subtotalAmount = 0;
  let flashDiscountAmount = 0;
  let lineManualDiscountAmount = 0;

  const flashSale = params.themeConfig?.flashSale;
  const promoBanner = params.themeConfig?.promoBanner;
  const welcomePopup = params.themeConfig?.welcomePopup;
  const requestedCode = params.discountCode?.trim() || '';
  const applyAutoPromos = params.applyShopPromotions === true;

  const selectedPromoIds =
    promoBanner?.applyScope === 'selected_items'
      ? new Set(Array.isArray(promoBanner.selectedItemIds) ? promoBanner.selectedItemIds : [])
      : null;

  let eligiblePromoSubtotal = 0;
  let eligibleFlashDiscount = 0;

  for (const line of lines) {
    const qty = Math.max(1, Number(line.quantity || 1));
    const unitPrice = Math.max(
      0,
      Number(line.original_unit_price ?? line.unit_price ?? 0)
    );
    const extraPrice = Math.max(0, Number(line.extra_price || 0));
    const lineGross = (unitPrice + extraPrice) * qty;
    subtotalAmount += lineGross;

    let lineFlashDisc = 0;
    if (applyAutoPromos) {
      const flashInfo = getItemFlashSalePrice(
        { id: line.item_id, price: unitPrice },
        flashSale,
        now
      );
      if (flashInfo.isFlashSaleApplied) {
        lineFlashDisc = flashInfo.discountPerUnit * qty;
        flashDiscountAmount += lineFlashDisc;
      }
    }

    if (!selectedPromoIds || selectedPromoIds.has(line.item_id)) {
      eligiblePromoSubtotal += lineGross;
      eligibleFlashDiscount += lineFlashDisc;
    }

    if (params.canApplyManualDiscount) {
      if (
        line.custom_unit_price !== undefined &&
        line.custom_unit_price !== null &&
        Number.isFinite(Number(line.custom_unit_price))
      ) {
        const customPrice = Math.max(0, Math.round(Number(line.custom_unit_price)));
        const diff = Math.max(0, unitPrice - customPrice);
        lineManualDiscountAmount += diff * qty;
      } else if (
        line.discount_percent !== undefined &&
        Number(line.discount_percent) > 0
      ) {
        const pct = Math.min(100, Math.max(0, Number(line.discount_percent)));
        const diff = Math.round(unitPrice * (pct / 100));
        lineManualDiscountAmount += diff * qty;
      }
    }
  }

  if (flashDiscountAmount > 0 && flashSale?.title) {
    appliedPromotions.push(`Flash Sale: ${flashSale.title}`);
  } else if (flashDiscountAmount > 0) {
    appliedPromotions.push('Flash Sale');
  }

  let promoBannerDiscountAmount = 0;
  let appliedDiscountCode: string | undefined = undefined;

  if (isPromoBannerActiveNow(promoBanner, now) && promoBanner) {
    const bannerVoucherCode = promoBanner.voucherCode?.trim() || '';
    const popupVoucherCode =
      welcomePopup?.enabled && welcomePopup?.voucherCode?.trim()
        ? welcomePopup.voucherCode.trim()
        : '';

    let canApplyBanner = false;
    if (bannerVoucherCode) {
      // Banner has an explicit voucherCode: require matching discountCode (and not explicitly disabled via applyShopPromotions === false)
      if (
        requestedCode &&
        requestedCode.toLowerCase() === bannerVoucherCode.toLowerCase() &&
        params.applyShopPromotions !== false
      ) {
        canApplyBanner = true;
      }
    } else if (requestedCode) {
      // Banner has no voucherCode, but caller sent a code: allow only if it matches welcomePopup voucherCode and promotions aren't disabled
      if (
        popupVoucherCode &&
        requestedCode.toLowerCase() === popupVoucherCode.toLowerCase() &&
        params.applyShopPromotions !== false
      ) {
        canApplyBanner = true;
      }
    } else if (applyAutoPromos) {
      // Automatic shop promo banner (no voucherCode required) when applyShopPromotions === true
      canApplyBanner = true;
    }

    if (canApplyBanner) {
      const minOrder = Math.max(0, Number(promoBanner.minOrderAmount || 0));
      const baseAfterFlash = Math.max(
        0,
        eligiblePromoSubtotal - eligibleFlashDiscount
      );
      if (subtotalAmount >= minOrder && baseAfterFlash > 0) {
        const rawVal = Math.max(0, Number(promoBanner.discountValue || 0));
        promoBannerDiscountAmount =
          promoBanner.discountType === 'fixed' ||
          promoBanner.discountType === 'fixed_amount'
            ? Math.min(baseAfterFlash, Math.round(rawVal))
            : Math.min(
                baseAfterFlash,
                Math.round(baseAfterFlash * (Math.min(100, rawVal) / 100))
              );
        if (promoBannerDiscountAmount > 0) {
          appliedPromotions.push(
            promoBanner.title
              ? `Khuyến mãi: ${promoBanner.title}`
              : 'Khuyến mãi cửa hàng'
          );
          if (requestedCode) {
            appliedDiscountCode = bannerVoucherCode || popupVoucherCode || requestedCode;
          }
        }
      }
    }
  }

  const promoDiscountAmount = Math.min(
    subtotalAmount,
    flashDiscountAmount + promoBannerDiscountAmount
  );

  const rawManualOrderDiscount = params.canApplyManualDiscount
    ? Number(params.manualOrderDiscountAmount || 0)
    : 0;
  if (!Number.isFinite(rawManualOrderDiscount) || rawManualOrderDiscount < 0) {
    throw new Error('INVALID_DISCOUNT: Số tiền giảm giá không hợp lệ.');
  }

  const orderManualDiscountAmount = Math.max(
    0,
    Math.round(rawManualOrderDiscount)
  );
  const manualDiscountAmount = Math.min(
    Math.max(0, subtotalAmount - promoDiscountAmount),
    lineManualDiscountAmount + orderManualDiscountAmount
  );

  const discountAmount = Math.min(
    subtotalAmount,
    promoDiscountAmount + manualDiscountAmount
  );
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);

  return {
    subtotal_amount: subtotalAmount,
    flash_discount_amount: flashDiscountAmount,
    promo_banner_discount_amount: promoBannerDiscountAmount,
    promo_discount_amount: promoDiscountAmount,
    line_manual_discount_amount: lineManualDiscountAmount,
    order_manual_discount_amount: orderManualDiscountAmount,
    manual_discount_amount: manualDiscountAmount,
    discount_amount: discountAmount,
    total_amount: totalAmount,
    applied_promotions: appliedPromotions,
    ...(appliedDiscountCode ? { applied_discount_code: appliedDiscountCode } : {}),
  };
}
