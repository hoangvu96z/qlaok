import type {
  MobileFlashSaleConfig,
  MobilePromoBannerConfig,
} from './supabase';

/**
 * Formats a currency amount in Vietnamese Dong (VND).
 * e.g. 50000 -> "50.000đ"
 */
export function formatVnd(amount: number): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

export interface MobilePromoPreviewStrings {
  promoBadge: string;
  promoTitle: (val: string, fallbackTitle: string) => string;
  promoSub: (fallbackSub?: string) => string;
  flashTitle: (fallbackFlash: string) => string;
  timePrefix: string;
}

export const MOBILE_PROMO_I18N: Record<string, MobilePromoPreviewStrings> = {
  vi: {
    promoBadge: '🔥 ƯU ĐÃI HÔM NAY',
    promoTitle: (_v, fallbackTitle) => fallbackTitle,
    promoSub: (fallbackSub) => fallbackSub || '',
    flashTitle: (fallbackFlash) => fallbackFlash || 'Giờ Vàng Giá Sốc',
    timePrefix: 'Khung giờ',
  },
  en: {
    promoBadge: '🔥 TODAY’S SPECIAL',
    promoTitle: (v) => `Get ${v} OFF on your order`,
    promoSub: () => 'Discount automatically applied at table checkout',
    flashTitle: () => 'Golden Hour Flash Sale',
    timePrefix: 'Time',
  },
  ko: {
    promoBadge: '🔥 오늘의 프로모션',
    promoTitle: (v) => `주문 시 ${v} 즉시 할인`,
    promoSub: () => '테이블 주문 시 할인이 자동 적용됩니다',
    flashTitle: () => '타임세일 한정 특가',
    timePrefix: '시간',
  },
  ja: {
    promoBadge: '🔥 本日のキャンペーン',
    promoTitle: (v) => `ご注文で ${v} 割引`,
    promoSub: () => 'ご注文時に割引が自動適用されます',
    flashTitle: () => '時間限定タイムセール',
    timePrefix: '時間',
  },
  zh: {
    promoBadge: '🔥 今日特惠活动',
    promoTitle: (v) => `扫码点餐立减 ${v}`,
    promoSub: () => '点餐结算时系统自动减免',
    flashTitle: () => '黄金时段限时秒杀',
    timePrefix: '时段',
  },
  es: {
    promoBadge: '🔥 OFERTA DE HOY',
    promoTitle: (v) => `${v} de descuento en tu pedido`,
    promoSub: () => 'Descuento aplicado automáticamente en mesa',
    flashTitle: () => 'Oferta Flash Hora Dorada',
    timePrefix: 'Horario',
  },
  it: {
    promoBadge: '🔥 PROMO DI OGGI',
    promoTitle: (v) => `Sconto di ${v} sul tuo ordine`,
    promoSub: () => 'Lo sconto viene applicato automaticamente al tavolo',
    flashTitle: () => 'Offerta Lampo Ora d’Oro',
    timePrefix: 'Orario',
  },
  ru: {
    promoBadge: '🔥 АКЦИЯ ДНЯ',
    promoTitle: (v) => `Скидка ${v} на ваш заказ`,
    promoSub: () => 'Скидка применяется автоматически при заказе',
    flashTitle: () => 'Flash-акция Счастливые часы',
    timePrefix: 'Время',
  },
};

export function getMobilePromoPreviewStrings(
  previewLang?: string | null
): MobilePromoPreviewStrings {
  if (previewLang && previewLang in MOBILE_PROMO_I18N) {
    return MOBILE_PROMO_I18N[previewLang];
  }
  return MOBILE_PROMO_I18N.vi;
}

export interface ResolveMobilePromoPreviewParams {
  previewLang?: string | null;
  promoBanner: MobilePromoBannerConfig;
  flashSale: MobileFlashSaleConfig;
}

export interface ResolvedMobilePromoPreview {
  locText: MobilePromoPreviewStrings;
  discValStr: string;
  badgeStr: string;
  titleStr: string;
  subStr: string;
  flashTitleStr: string;
  flashDiscountLabel: string;
  flashTimePrefix: string;
  flashTimeRange: string;
}

export function resolveMobilePromoPreview(
  params: ResolveMobilePromoPreviewParams
): ResolvedMobilePromoPreview {
  const { previewLang, promoBanner, flashSale } = params;
  const locText = getMobilePromoPreviewStrings(previewLang);

  const discValStr =
    promoBanner.discountType === 'percent'
      ? `${promoBanner.discountValue || 15}%`
      : formatVnd(promoBanner.discountValue || 20000);

  const badgeStr =
    previewLang === 'vi'
      ? promoBanner.badgeText || locText.promoBadge
      : locText.promoBadge;

  const titleStr = locText.promoTitle(discValStr, promoBanner.title || '');
  const subStr = locText.promoSub(promoBanner.subtitle);

  const flashTitleResolved = locText.flashTitle(flashSale.title || '');
  const flashDiscountLabel =
    flashSale.discountType === 'percent'
      ? `-${flashSale.discountValue}%`
      : `-${formatVnd(flashSale.discountValue || 0)}`;

  const flashTimePrefix = locText.timePrefix;
  const flashTimeRange = `${flashSale.startTime || ''} - ${flashSale.endTime || ''}`;

  return {
    locText,
    discValStr,
    badgeStr,
    titleStr,
    subStr,
    flashTitleStr: flashTitleResolved,
    flashDiscountLabel,
    flashTimePrefix,
    flashTimeRange,
  };
}
