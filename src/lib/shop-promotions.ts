import { getVietnamDateKey } from '@/lib/date-utils';
import type {
  CatalogItem,
  ShopFlashSaleConfig,
  ShopPopupConfig,
  ShopPromoBannerConfig,
  ShopThemeConfig,
} from '@/types/qlaok';

export interface ShopPromotionsDraftState {
  promoBanner: ShopPromoBannerConfig;
  welcomePopup: ShopPopupConfig;
  flashSale: ShopFlashSaleConfig;
}

export function normalizeShopPromoBannerConfig(
  raw?: Partial<ShopPromoBannerConfig> | null
): ShopPromoBannerConfig {
  return {
    enabled: Boolean(raw?.enabled),
    badgeText: raw?.badgeText || '🔥 ƯU ĐÃI ĐẶC BIỆT',
    title: raw?.title || '',
    subtitle: raw?.subtitle || '',
    bgGradient: raw?.bgGradient || 'amber_rose',
    ctaText: raw?.ctaText || 'Xem chi tiết',
    discountType: raw?.discountType || 'percent',
    discountValue:
      typeof raw?.discountValue === 'number' &&
      Number.isFinite(raw.discountValue)
        ? raw.discountValue
        : 15,
    minOrderAmount:
      typeof raw?.minOrderAmount === 'number' &&
      Number.isFinite(raw.minOrderAmount)
        ? raw.minOrderAmount
        : 0,
    applyScope: raw?.applyScope === 'selected_items' ? 'selected_items' : 'all',
    selectedItemIds: Array.isArray(raw?.selectedItemIds)
      ? [...raw.selectedItemIds]
      : [],
    voucherCode: raw?.voucherCode || '',
  };
}

export function normalizeShopWelcomePopupConfig(
  raw?: Partial<ShopPopupConfig> | null
): ShopPopupConfig {
  return {
    enabled: Boolean(raw?.enabled),
    badgeText: raw?.badgeText || '🎁 VOUCHER CHÀO MỪNG',
    title: raw?.title || '',
    content: raw?.content || '',
    imageUrl: raw?.imageUrl || '',
    voucherCode: raw?.voucherCode || '',
    ctaText: raw?.ctaText || 'Nhận Ưu Đãi & Xem Menu',
  };
}

export function normalizeShopFlashSaleConfig(
  raw?: Partial<ShopFlashSaleConfig> | null,
  todayIso: string = getVietnamDateKey()
): ShopFlashSaleConfig {
  return {
    enabled: Boolean(raw?.enabled),
    badgeText: raw?.badgeText || '⚡ FLASH SALE GIỜ VÀNG',
    title: raw?.title || 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
    discountType: raw?.discountType || 'percent',
    discountValue:
      typeof raw?.discountValue === 'number' &&
      Number.isFinite(raw.discountValue)
        ? raw.discountValue
        : 25,
    startDate: raw?.startDate || todayIso,
    endDate: raw?.endDate || raw?.startDate || todayIso,
    startTime: raw?.startTime || '11:00',
    endTime: raw?.endTime || '22:00',
    itemIds: Array.isArray(raw?.itemIds) ? [...raw.itemIds] : [],
  };
}

export function hydrateShopPromotionsState(
  themeConfig?: Partial<ShopThemeConfig> | null,
  todayIso: string = getVietnamDateKey()
): ShopPromotionsDraftState {
  return {
    promoBanner: normalizeShopPromoBannerConfig(themeConfig?.promoBanner),
    welcomePopup: normalizeShopWelcomePopupConfig(themeConfig?.welcomePopup),
    flashSale: normalizeShopFlashSaleConfig(themeConfig?.flashSale, todayIso),
  };
}

export function applyCatalogItemsToFlashSaleDraft(params: {
  currentFlashSale: ShopFlashSaleConfig;
  savedFlashSale?: Partial<ShopFlashSaleConfig> | null;
  fetchedItems: ReadonlyArray<Pick<CatalogItem, 'id'> & { shop_id?: string }>;
  requestShopId: string | null | undefined;
  activeShopId: string | null | undefined;
  cancelled?: boolean;
}): ShopFlashSaleConfig {
  if (params.cancelled) {
    return params.currentFlashSale;
  }

  const cleanRequestShopId = (params.requestShopId ?? '').trim();
  const cleanActiveShopId = (params.activeShopId ?? '').trim();
  if (
    !cleanRequestShopId ||
    !cleanActiveShopId ||
    cleanRequestShopId !== cleanActiveShopId
  ) {
    return params.currentFlashSale;
  }

  const hasSavedItems =
    Array.isArray(params.savedFlashSale?.itemIds) &&
    params.savedFlashSale.itemIds.length > 0;
  if (hasSavedItems || params.currentFlashSale.itemIds.length > 0) {
    return params.currentFlashSale;
  }

  const scopedItems = (
    Array.isArray(params.fetchedItems) ? params.fetchedItems : []
  ).filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      item.id.trim().length > 0 &&
      (!item.shop_id || item.shop_id === cleanActiveShopId)
  );

  if (scopedItems.length === 0) {
    return params.currentFlashSale;
  }

  return {
    ...params.currentFlashSale,
    itemIds: scopedItems.slice(0, 3).map((item) => item.id),
  };
}
