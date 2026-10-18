'use client';

import React, { useState, useEffect } from 'react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Sparkles,
  Gift,
  Copy,
  Check,
  X,
  Flame,
  Zap,
  Clock,
  Plus,
  Tag,
  Wifi,
  Smartphone,
} from 'lucide-react';
import type {
  CatalogItem,
  Shop,
  ShopPromoBannerConfig,
  SupportedLocale,
} from '@/types/qlaok';
import {
  ALL_LOCALES,
  formatCurrency,
  LOCALE_META,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

export const BANNER_GRADIENT_MAP: Record<
  NonNullable<ShopPromoBannerConfig['bgGradient']>,
  string
> = {
  amber_rose: 'from-amber-500 via-orange-500 to-rose-600 text-white',
  emerald_teal: 'from-emerald-600 via-teal-600 to-cyan-700 text-white',
  violet_fuchsia: 'from-violet-600 via-purple-600 to-fuchsia-600 text-white',
  royal_gold: 'from-slate-900 via-amber-950 to-amber-700 text-amber-100',
};

export function getStorefrontBackgroundProps(shop: Shop): {
  isDarkTheme: boolean;
  containerClass: string;
  backgroundLayer: React.ReactNode;
} {
  const style = shop.theme_config?.backgroundStyle || 'clean';
  const bgUrl = shop.theme_config?.backgroundImageUrl?.trim();
  const overlayOpacity =
    typeof shop.theme_config?.backgroundOverlayOpacity === 'number'
      ? shop.theme_config.backgroundOverlayOpacity
      : 0.72;

  if (style === 'custom_image' && bgUrl) {
    return {
      isDarkTheme: true,
      containerClass: 'relative min-h-screen text-slate-900 dark:text-slate-100',
      backgroundLayer: (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden flex justify-center">
          <div className="relative w-full max-w-md h-full">
            <img src={bgUrl} alt="" className="h-full w-full object-cover" />
            <div
              className="absolute inset-0 bg-slate-950"
              style={{ opacity: overlayOpacity }}
            />
          </div>
        </div>
      ),
    };
  }

  if (style === 'dark') {
    return {
      isDarkTheme: true,
      containerClass: 'relative min-h-screen bg-slate-950 text-slate-100',
      backgroundLayer: null,
    };
  }

  if (style === 'warm') {
    return {
      isDarkTheme: false,
      containerClass:
        'relative min-h-screen bg-[#fdf8ee] dark:bg-slate-950 text-slate-900 dark:text-slate-100',
      backgroundLayer: null,
    };
  }

  return {
    isDarkTheme: false,
    containerClass:
      'relative min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100',
    backgroundLayer: null,
  };
}

/**
 * Calculates the effective price of an item if it is part of an active Flash Sale
 * or a selected-items Promo Campaign.
 */
export function getItemEffectivePrice(
  item: CatalogItem,
  shop?: Shop | null
): {
  finalPrice: number;
  originalPrice: number | null;
  discountBadge: string | null;
  isFlashSale: boolean;
} {
  const basePrice = item.price;
  if (!shop) {
    return {
      finalPrice: basePrice,
      originalPrice:
        item.compare_at_price && item.compare_at_price > basePrice
          ? item.compare_at_price
          : null,
      discountBadge: null,
      isFlashSale: false,
    };
  }

  // 1. Check active Flash Sale first
  const fs = shop.theme_config?.flashSale;
  if (
    fs?.enabled &&
    fs.discountValue > 0 &&
    Array.isArray(fs.itemIds) &&
    fs.itemIds.includes(item.id)
  ) {
    const discounted =
      fs.discountType === 'percent'
        ? Math.max(
            0,
            Math.round((basePrice * (100 - Math.min(fs.discountValue, 95))) / 100)
          )
        : Math.max(0, basePrice - fs.discountValue);

    const badge =
      fs.discountType === 'percent'
        ? `⚡ -${fs.discountValue}%`
        : `⚡ -${Math.round(fs.discountValue / 1000)}k`;

    return {
      finalPrice: discounted,
      originalPrice: basePrice,
      discountBadge: badge,
      isFlashSale: true,
    };
  }

  // 2. Check selected-item Promo Banner discount (when minOrderAmount is 0)
  const promo = shop.theme_config?.promoBanner;
  if (
    promo?.enabled &&
    promo.discountValue &&
    promo.discountValue > 0 &&
    (!promo.minOrderAmount || promo.minOrderAmount <= 0) &&
    promo.applyScope === 'selected_items' &&
    Array.isArray(promo.selectedItemIds) &&
    promo.selectedItemIds.includes(item.id)
  ) {
    const discounted =
      promo.discountType === 'percent'
        ? Math.max(
            0,
            Math.round(
              (basePrice * (100 - Math.min(promo.discountValue, 95))) / 100
            )
          )
        : Math.max(0, basePrice - promo.discountValue);

    const badge =
      promo.discountType === 'percent'
        ? `🔥 -${promo.discountValue}%`
        : `🔥 -${Math.round(promo.discountValue / 1000)}k`;

    return {
      finalPrice: discounted,
      originalPrice: basePrice,
      discountBadge: badge,
      isFlashSale: false,
    };
  }

  return {
    finalPrice: basePrice,
    originalPrice:
      item.compare_at_price && item.compare_at_price > basePrice
        ? item.compare_at_price
        : null,
    discountBadge: null,
    isFlashSale: false,
  };
}

export interface PromoLocaleText {
  flashBadge: string;
  flashTitle: string;
  flashTimeSlot: (start: string, end: string) => string;
  promoBadge: string;
  discountOff: (val: string) => string;
  minOrder: (amt: string) => string;
  selectedItemsScope: (count: number) => string;
  buildPromoTitle: (
    valText: string,
    minAmtText: string | null,
    selectedCount: number | null
  ) => string;
  promoSubtitle: string;
  copiedCode: string;
  copyCode: string;
  claimOffer: string;
  popupBadge: string;
  voucherLabel: string;
  copiedFull: string;
  copyFull: string;
  popupCta: string;
  savedDiscount: (amt: string) => string;
  unlockHint: (amt: string, title: string) => string;
}

export const PROMO_LOCALE_TEXT: Record<SupportedLocale, PromoLocaleText> = {
  vi: {
    flashBadge: 'FLASH SALE GIỜ VÀNG',
    flashTitle: 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
    flashTimeSlot: (s, e) => `Khung giờ: ${s} – ${e}`,
    promoBadge: 'KHUYẾN MÃI HÔM NAY',
    discountOff: (val) => `Giảm ${val}`,
    minOrder: (amt) => `Đơn từ ${amt}`,
    selectedItemsScope: (c) => `Áp dụng ${c} món chọn lọc`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? ` cho đơn từ ${minAmt}` : '';
      const scopePart = count
        ? ` (${count} món chọn lọc)`
        : ' toàn bộ thực đơn';
      return `Giảm ngay ${val}${minPart}${scopePart}`;
    },
    promoSubtitle: 'Ưu đãi tự động áp dụng khi đặt món tại bàn',
    copiedCode: '✓ Đã lưu',
    copyCode: '• Copy',
    claimOffer: 'Nhận ưu đãi',
    popupBadge: '🎁 ƯU ĐÃI ĐẶC BIỆT',
    voucherLabel: 'Mã Voucher Ưu Đãi',
    copiedFull: 'Đã lưu mã',
    copyFull: 'Copy mã',
    popupCta: 'Nhận ưu đãi & Xem Menu ngay',
    savedDiscount: (amt) => `🎁 Đã giảm ${amt}`,
    unlockHint: (amt, title) =>
      `💡 Chọn thêm ${amt} để được áp dụng: ${title}`,
  },
  en: {
    flashBadge: 'GOLDEN HOUR FLASH SALE',
    flashTitle: 'Flash Sale - Limited Time Offer',
    flashTimeSlot: (s, e) => `Time slot: ${s} – ${e}`,
    promoBadge: 'TODAY’S SPECIAL',
    discountOff: (val) => `${val} OFF`,
    minOrder: (amt) => `Min. order ${amt}`,
    selectedItemsScope: (c) => `Applies to ${c} selected items`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? ` on orders from ${minAmt}` : '';
      const scopePart = count
        ? ` (${count} selected items)`
        : ' across the menu';
      return `Get ${val} OFF${minPart}${scopePart}`;
    },
    promoSubtitle: 'Discount is automatically applied when ordering at table',
    copiedCode: '✓ Copied',
    copyCode: '• Copy',
    claimOffer: 'View Offer',
    popupBadge: '🎁 SPECIAL OFFER',
    voucherLabel: 'Promo Voucher Code',
    copiedFull: 'Copied',
    copyFull: 'Copy Code',
    popupCta: 'Claim Offer & View Menu',
    savedDiscount: (amt) => `🎁 Saved ${amt}`,
    unlockHint: (amt, title) => `💡 Add ${amt} more to unlock: ${title}`,
  },
  ko: {
    flashBadge: '타임세일 특가',
    flashTitle: '한정 수량 타임세일 특가',
    flashTimeSlot: (s, e) => `진행 시간: ${s} – ${e}`,
    promoBadge: '오늘의 프로모션',
    discountOff: (val) => `${val} 할인`,
    minOrder: (amt) => `최소 주문 ${amt}`,
    selectedItemsScope: (c) => `선택 메뉴 ${c}개 적용`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? `${minAmt} 이상 주문 시 ` : '';
      const scopePart = count ? `(선택 메뉴 ${count}개) ` : '전 메뉴 ';
      return `${minPart}${scopePart}${val} 즉시 할인`;
    },
    promoSubtitle: '테이블 주문 시 할인이 자동으로 적용됩니다',
    copiedCode: '✓ 복사됨',
    copyCode: '• 복사',
    claimOffer: '혜택 보기',
    popupBadge: '🎁 특별 할인 혜택',
    voucherLabel: '할인 쿠폰 코드',
    copiedFull: '복사 완료',
    copyFull: '코드 복사',
    popupCta: '혜택 받고 메뉴 보기',
    savedDiscount: (amt) => `🎁 ${amt} 할인 적용됨`,
    unlockHint: (amt, title) => `💡 ${amt} 더 담으면 적용: ${title}`,
  },
  ja: {
    flashBadge: 'タイムセール特価',
    flashTitle: '時間限定タイムセール - 数量限定',
    flashTimeSlot: (s, e) => `開催時間: ${s} – ${e}`,
    promoBadge: '本日のキャンペーン',
    discountOff: (val) => `${val} OFF`,
    minOrder: (amt) => `${amt}以上のご注文`,
    selectedItemsScope: (c) => `対象メニュー ${c}品`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? `${minAmt}以上のご注文で` : '';
      const scopePart = count ? `（対象${count}品）` : '全メニュー';
      return `${minPart}${scopePart} ${val} 割引`;
    },
    promoSubtitle: 'ご注文時に割引が自動的に適用されます',
    copiedCode: '✓ コピー済',
    copyCode: '• コピー',
    claimOffer: '特典を見る',
    popupBadge: '🎁 特別キャンペーン',
    voucherLabel: 'クーポンコード',
    copiedFull: 'コピー完了',
    copyFull: 'コードをコピー',
    popupCta: '特典を受け取ってメニューを見る',
    savedDiscount: (amt) => `🎁 ${amt} 割引適用済`,
    unlockHint: (amt, title) => `💡 あと${amt}追加で適用: ${title}`,
  },
  zh: {
    flashBadge: '限时秒杀特惠',
    flashTitle: '黄金时段限时特惠 - 数量有限',
    flashTimeSlot: (s, e) => `活动时段: ${s} – ${e}`,
    promoBadge: '今日特惠活动',
    discountOff: (val) => `立减 ${val}`,
    minOrder: (amt) => `满 ${amt} 可用`,
    selectedItemsScope: (c) => `指定 ${c} 款菜品适用`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? `满 ${minAmt} ` : '全场点餐 ';
      const scopePart = count ? `（指定 ${count} 款菜品）` : '';
      return `${minPart}立减 ${val}${scopePart}`;
    },
    promoSubtitle: '扫码点餐结算时系统自动减免',
    copiedCode: '✓ 已复制',
    copyCode: '• 复制',
    claimOffer: '查看优惠',
    popupBadge: '🎁 专属特惠礼遇',
    voucherLabel: '优惠券代码',
    copiedFull: '已复制代码',
    copyFull: '复制代码',
    popupCta: '领取优惠并查看菜单',
    savedDiscount: (amt) => `🎁 已减 ${amt}`,
    unlockHint: (amt, title) => `💡 再加购 ${amt} 即可享受: ${title}`,
  },
  es: {
    flashBadge: 'OFERTA FLASH',
    flashTitle: 'Hora Dorada - Oferta por Tiempo Limitado',
    flashTimeSlot: (s, e) => `Horario: ${s} – ${e}`,
    promoBadge: 'OFERTA DE HOY',
    discountOff: (val) => `-${val} DTO.`,
    minOrder: (amt) => `Pedido mín. ${amt}`,
    selectedItemsScope: (c) => `Válido en ${c} platos seleccionados`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? ` en pedidos desde ${minAmt}` : '';
      const scopePart = count
        ? ` (${cLabel(count, 'es')})`
        : ' en todo el menú';
      return `${val} de descuento${minPart}${scopePart}`;
    },
    promoSubtitle: 'El descuento se aplica automáticamente al pedir en mesa',
    copiedCode: '✓ Copiado',
    copyCode: '• Copiar',
    claimOffer: 'Ver oferta',
    popupBadge: '🎁 OFERTA ESPECIAL',
    voucherLabel: 'Código de Cupón',
    copiedFull: 'Código copiado',
    copyFull: 'Copiar código',
    popupCta: 'Recibir oferta y ver menú',
    savedDiscount: (amt) => `🎁 Ahorras ${amt}`,
    unlockHint: (amt, title) => `💡 Añade ${amt} más para activar: ${title}`,
  },
  it: {
    flashBadge: 'OFFERTA LAMPO',
    flashTitle: 'Ora d’Oro - Offerta a Tempo Limitato',
    flashTimeSlot: (s, e) => `Orario: ${s} – ${e}`,
    promoBadge: 'PROMO DI OGGI',
    discountOff: (val) => `Sconto ${val}`,
    minOrder: (amt) => `Ordine min. ${amt}`,
    selectedItemsScope: (c) => `Valido su ${c} piatti selezionati`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? ` per ordini da ${minAmt}` : '';
      const scopePart = count ? ` (${cLabel(count, 'it')})` : ' su tutto il menu';
      return `Sconto di ${val}${minPart}${scopePart}`;
    },
    promoSubtitle: 'Lo sconto viene applicato automaticamente al tavolo',
    copiedCode: '✓ Copiato',
    copyCode: '• Copia',
    claimOffer: 'Vedi offerta',
    popupBadge: '🎁 OFFERTA SPECIALE',
    voucherLabel: 'Codice Voucher',
    copiedFull: 'Codice copiato',
    copyFull: 'Copia codice',
    popupCta: 'Ottieni offerta e vedi menu',
    savedDiscount: (amt) => `🎁 Risparmi ${amt}`,
    unlockHint: (amt, title) => `💡 Aggiungi ${amt} per sbloccare: ${title}`,
  },
  ru: {
    flashBadge: 'FLASH-АКЦИЯ',
    flashTitle: 'Счастливые часы — количество ограничено',
    flashTimeSlot: (s, e) => `Время акции: ${s} – ${e}`,
    promoBadge: 'АКЦИЯ ДНЯ',
    discountOff: (val) => `Скидка ${val}`,
    minOrder: (amt) => `От ${amt}`,
    selectedItemsScope: (c) => `На ${c} выбр. блюд`,
    buildPromoTitle: (val, minAmt, count) => {
      const minPart = minAmt ? ` при заказе от ${minAmt}` : '';
      const scopePart = count ? ` (${count} блюд)` : ' на всё меню';
      return `Скидка ${val}${minPart}${scopePart}`;
    },
    promoSubtitle: 'Скидка применяется автоматически при заказе за столом',
    copiedCode: '✓ Скопировано',
    copyCode: '• Копировать',
    claimOffer: 'Подробнее',
    popupBadge: '🎁 СПЕЦПРЕДЛОЖЕНИЕ',
    voucherLabel: 'Промокод на скидку',
    copiedFull: 'Скопировано',
    copyFull: 'Копировать код',
    popupCta: 'Получить скидку и открыть меню',
    savedDiscount: (amt) => `🎁 Скидка ${amt}`,
    unlockHint: (amt, title) => `💡 Добавьте ещё на ${amt} для акции: ${title}`,
  },
};

function cLabel(count: number, lang: 'es' | 'it') {
  return lang === 'es'
    ? `${count} platos seleccionados`
    : `${count} piatti selezionati`;
}

export function getLocalizedPromoBannerStrings(
  banner: ShopPromoBannerConfig,
  currency = 'VND',
  locale: SupportedLocale = 'vi'
): {
  badgeText: string;
  title: string;
  subtitle: string;
  ctaText: string;
  discountChip: string | null;
  minOrderChip: string | null;
  scopeChip: string | null;
} {
  const pt = PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi;
  const hasDiscountRule = Boolean(
    banner.discountValue && banner.discountValue > 0
  );
  const valStr = hasDiscountRule
    ? banner.discountType === 'percent'
      ? `${banner.discountValue}%`
      : formatCurrency(banner.discountValue || 0, currency)
    : '';

  const minAmtStr =
    banner.minOrderAmount && banner.minOrderAmount > 0
      ? formatCurrency(banner.minOrderAmount, currency)
      : null;

  const selectedCount =
    banner.applyScope === 'selected_items' &&
    Array.isArray(banner.selectedItemIds) &&
    banner.selectedItemIds.length > 0
      ? banner.selectedItemIds.length
      : null;

  const discountChip = hasDiscountRule ? pt.discountOff(valStr) : null;
  const minOrderChip = minAmtStr ? pt.minOrder(minAmtStr) : null;
  const scopeChip = selectedCount ? pt.selectedItemsScope(selectedCount) : null;

  if (locale === 'vi') {
    return {
      badgeText: banner.badgeText || pt.promoBadge,
      title:
        banner.title ||
        (hasDiscountRule
          ? pt.buildPromoTitle(valStr, minAmtStr, selectedCount)
          : ''),
      subtitle: banner.subtitle || pt.promoSubtitle,
      ctaText: banner.ctaText || pt.claimOffer,
      discountChip,
      minOrderChip,
      scopeChip,
    };
  }

  return {
    badgeText: pt.promoBadge,
    title: hasDiscountRule
      ? pt.buildPromoTitle(valStr, minAmtStr, selectedCount)
      : banner.title,
    subtitle: pt.promoSubtitle,
    ctaText: pt.claimOffer,
    discountChip,
    minOrderChip,
    scopeChip,
  };
}

/**
 * Calculates order-level discount from ShopPromoBannerConfig
 */
export function calculateOrderPromoDiscount(
  cartItems: Array<{ item: CatalogItem; quantity: number; lineTotal: number }>,
  shop?: Shop | null,
  locale: SupportedLocale = 'vi'
): {
  discountAmount: number;
  promoTitle: string | null;
  voucherCode: string | null;
  minOrderNeeded: number;
} {
  const promo = shop?.theme_config?.promoBanner;
  if (
    !promo ||
    !promo.enabled ||
    !promo.discountValue ||
    promo.discountValue <= 0
  ) {
    return {
      discountAmount: 0,
      promoTitle: null,
      voucherCode: null,
      minOrderNeeded: 0,
    };
  }

  const localizedPromo = getLocalizedPromoBannerStrings(
    promo,
    shop?.currency || 'VND',
    locale
  );

  // If already applied per item (minOrderAmount === 0 && applyScope === 'selected_items'), don't double-deduct
  if (
    (!promo.minOrderAmount || promo.minOrderAmount <= 0) &&
    promo.applyScope === 'selected_items'
  ) {
    return {
      discountAmount: 0,
      promoTitle: localizedPromo.title,
      voucherCode: promo.voucherCode || null,
      minOrderNeeded: 0,
    };
  }

  const eligibleSubtotal = cartItems.reduce((sum, entry) => {
    if (
      promo.applyScope === 'selected_items' &&
      Array.isArray(promo.selectedItemIds) &&
      promo.selectedItemIds.length > 0
    ) {
      if (!promo.selectedItemIds.includes(entry.item.id)) return sum;
    }
    return sum + entry.lineTotal;
  }, 0);

  const minReq = promo.minOrderAmount || 0;
  if (eligibleSubtotal < minReq || eligibleSubtotal <= 0) {
    return {
      discountAmount: 0,
      promoTitle: localizedPromo.title,
      voucherCode: promo.voucherCode || null,
      minOrderNeeded: Math.max(0, minReq - eligibleSubtotal),
    };
  }

  const rawDiscount =
    promo.discountType === 'percent'
      ? Math.round(
          (eligibleSubtotal * Math.min(promo.discountValue, 95)) / 100
        )
      : promo.discountValue;

  return {
    discountAmount: Math.min(eligibleSubtotal, Math.max(0, rawDiscount)),
    promoTitle: localizedPromo.title,
    voucherCode: promo.voucherCode || null,
    minOrderNeeded: 0,
  };
}

export function StorefrontPromoBanner({
  shop,
  locale = 'vi',
  onOpenPopup,
}: {
  shop: Shop;
  locale?: SupportedLocale;
  onOpenPopup?: () => void;
}) {
  const banner = shop.theme_config?.promoBanner;
  const [copied, setCopied] = useState(false);

  if (!banner || !banner.enabled || !banner.title?.trim()) return null;

  const pt = PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi;
  const localized = getLocalizedPromoBannerStrings(
    banner,
    shop.currency,
    locale
  );

  const gradClass =
    BANNER_GRADIENT_MAP[banner.bgGradient || 'amber_rose'] ||
    BANNER_GRADIENT_MAP.amber_rose;

  const handleCopyCode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!banner.voucherCode) return;
    try {
      await navigator.clipboard.writeText(banner.voucherCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-md border border-white/25">
      <div className={`bg-gradient-to-r ${gradClass} p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {localized.badgeText && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-xs">
                  <Flame className="h-3 w-3 text-amber-300" />
                  {localized.badgeText.replace(/^🔥\s*/, '')}
                </span>
              )}
              {localized.discountChip && (
                <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-black text-rose-600 shadow-2xs">
                  {localized.discountChip}
                </span>
              )}
              {localized.minOrderChip && (
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold text-white">
                  {localized.minOrderChip}
                </span>
              )}
              {localized.scopeChip && (
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                  {localized.scopeChip}
                </span>
              )}
            </div>

            <h3 className="text-sm sm:text-base font-black leading-snug text-white">
              {localized.title}
            </h3>

            {localized.subtitle && (
              <p className="text-xs text-white/90 leading-relaxed">
                {localized.subtitle}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {banner.voucherCode && (
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-slate-900 px-3 py-1 text-[11px] font-black text-slate-900 dark:text-slate-100 shadow-xs hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition"
                >
                  <Tag className="h-3 w-3 text-rose-500" />
                  <span className="font-mono">{banner.voucherCode}</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">
                    {copied ? pt.copiedCode : pt.copyCode}
                  </span>
                </button>
              )}

              {banner.ctaText && onOpenPopup && (
                <button
                  type="button"
                  onClick={onOpenPopup}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-black/25 hover:bg-black/35 border border-white/30 px-3 py-1 text-[11px] font-bold text-white active:scale-95 transition"
                >
                  <Gift className="h-3.5 w-3.5 text-amber-300" />
                  <span>{localized.ctaText}</span>
                </button>
              )}
            </div>
          </div>

          {banner.imageUrl && (
            <img
              src={banner.imageUrl}
              alt={localized.title}
              className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-2xl object-cover border-2 border-white/40 shadow-md"
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Live Flash Sale Section with Countdown Timer and discounted items carousel/grid
 */
export function StorefrontFlashSaleSection({
  shop,
  items,
  locale,
  onSelectItem,
  onQuickAdd,
}: {
  shop: Shop;
  items: CatalogItem[];
  locale: SupportedLocale;
  onSelectItem?: (item: CatalogItem) => void;
  onQuickAdd?: (item: CatalogItem, e: React.MouseEvent) => void;
}) {
  const flashSale = shop.theme_config?.flashSale;
  const [timeLeft, setTimeLeft] = useState({
    d: 0,
    h: '02',
    m: '45',
    s: '18',
  });

  useEffect(() => {
    if (!flashSale?.enabled) return;

    const updateTimer = () => {
      const now = new Date();
      const endStr = flashSale.endTime || '23:59';
      const [endH, endM] = endStr.split(':').map((n) => parseInt(n, 10) || 0);
      const target = new Date();

      if (flashSale.endDate) {
        const [y, mo, da] = flashSale.endDate
          .split('-')
          .map((n) => parseInt(n, 10));
        if (y && mo && da) {
          target.setFullYear(y, mo - 1, da);
        }
      }

      target.setHours(endH, endM, 59, 999);
      if (target.getTime() <= now.getTime()) {
        target.setDate(now.getDate() + 1);
      }

      const diffSec = Math.max(
        0,
        Math.floor((target.getTime() - now.getTime()) / 1000)
      );
      const d = Math.floor(diffSec / 86400);
      const h = String(Math.floor((diffSec % 86400) / 3600)).padStart(2, '0');
      const m = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
      const s = String(diffSec % 60).padStart(2, '0');
      setTimeLeft({ d, h, m, s });
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [flashSale?.enabled, flashSale?.endDate, flashSale?.endTime]);

  if (
    !flashSale ||
    !flashSale.enabled ||
    !Array.isArray(flashSale.itemIds) ||
    flashSale.itemIds.length === 0
  ) {
    return null;
  }

  const flashItems = items.filter((i) => flashSale.itemIds.includes(i.id));
  if (flashItems.length === 0) return null;

  const pt = PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi;

  const badgeLabel =
    flashSale.discountType === 'percent'
      ? `-${flashSale.discountValue}%`
      : `-${formatCurrency(flashSale.discountValue, shop.currency)}`;

  const displayBadgeText =
    locale === 'vi'
      ? (flashSale.badgeText || pt.flashBadge).replace(/^⚡\s*/, '')
      : pt.flashBadge;

  const displayTitleText =
    locale === 'vi' ? flashSale.title || pt.flashTitle : pt.flashTitle;

  const formatShortDate = (iso?: string) => {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}`;
  };

  const hasMultiDayRange =
    Boolean(flashSale.startDate && flashSale.endDate) &&
    flashSale.startDate !== flashSale.endDate;

  const dateRangePrefix = hasMultiDayRange
    ? `${formatShortDate(flashSale.startDate)} – ${formatShortDate(flashSale.endDate)} • `
    : '';

  const dayUnitLabel = locale === 'vi' ? 'N' : 'd';

  return (
    <div className="rounded-3xl bg-gradient-to-br from-rose-600 via-orange-500 to-amber-500 p-3.5 shadow-lg text-white space-y-3 border border-white/25">
      {/* Flash Sale Header + Live Countdown */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-xl bg-amber-300 px-2.5 py-1 text-xs font-black text-slate-950 shadow-xs">
            <Zap className="h-3.5 w-3.5 fill-slate-950" />
            <span>{displayBadgeText}</span>
          </span>
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white leading-tight">
              {displayTitleText} ({badgeLabel})
            </h3>
            {flashSale.startTime && flashSale.endTime && (
              <p className="text-[10px] text-amber-100 font-semibold">
                {dateRangePrefix}
                {pt.flashTimeSlot(flashSale.startTime, flashSale.endTime)}
              </p>
            )}
          </div>
        </div>

        {/* Countdown Clock */}
        <div className="flex items-center gap-1 text-xs font-black">
          <Clock className="h-3.5 w-3.5 text-amber-200 mr-0.5" />
          {timeLeft.d > 0 && (
            <>
              <span className="rounded-lg bg-slate-950/80 px-1.5 py-1 text-[11px] font-mono text-amber-300">
                {timeLeft.d}
                {dayUnitLabel}
              </span>
              <span>:</span>
            </>
          )}
          <span className="rounded-lg bg-slate-950/80 px-1.5 py-1 text-[11px] font-mono text-amber-300">
            {timeLeft.h}
          </span>
          <span>:</span>
          <span className="rounded-lg bg-slate-950/80 px-1.5 py-1 text-[11px] font-mono text-amber-300">
            {timeLeft.m}
          </span>
          <span>:</span>
          <span className="rounded-lg bg-slate-950/80 px-1.5 py-1 text-[11px] font-mono text-amber-300">
            {timeLeft.s}
          </span>
        </div>
      </div>

      {/* Horizontal Flash Sale Items Strip */}
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
        {flashItems.map((item) => {
          const eff = getItemEffectivePrice(item, shop);
          const itemName = tField(item.name_i18n, locale);

          return (
            <div
              key={item.id}
              onClick={() => onSelectItem && onSelectItem(item)}
              className="shrink-0 w-40 rounded-2xl bg-white dark:bg-slate-900 p-2.5 text-slate-900 dark:text-slate-100 shadow-md flex flex-col justify-between cursor-pointer hover:scale-[1.01] transition border border-slate-100 dark:border-slate-800"
            >
              <div>
                <div className="relative h-24 w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 mb-2">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={itemName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">
                      🍲
                    </div>
                  )}
                  <span className="absolute top-1.5 left-1.5 rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs">
                    {eff.discountBadge || badgeLabel}
                  </span>
                </div>
                <h4 className="line-clamp-2 text-xs font-extrabold text-slate-900 dark:text-slate-100 leading-snug">
                  {itemName}
                </h4>
              </div>

              <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-end justify-between gap-1">
                <div>
                  <span className="block text-[10px] text-slate-400 line-through">
                    {formatCurrency(item.price, shop.currency)}
                  </span>
                  <span className="text-xs font-black text-rose-600 dark:text-rose-400">
                    {formatCurrency(eff.finalPrice, shop.currency)}
                  </span>
                </div>
                {onQuickAdd && item.is_available && (
                  <button
                    type="button"
                    onClick={(e) => onQuickAdd(item, e)}
                    className="flex h-7 w-7 items-center justify-center rounded-xl bg-rose-600 text-white shadow-xs hover:bg-rose-500 active:scale-90"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StorefrontWelcomePopup({
  shop,
  locale = 'vi',
  isOpen,
  onClose,
}: {
  shop: Shop;
  locale?: SupportedLocale;
  isOpen: boolean;
  onClose: () => void;
}) {
  const popup = shop.theme_config?.welcomePopup;
  const banner = shop.theme_config?.promoBanner;
  const [copiedCode, setCopiedCode] = useState(false);

  if (!popup || !popup.enabled || !popup.title?.trim()) return null;

  const primaryColor = shop.theme_config?.primaryColor || '#10b981';
  const pt = PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi;
  const localizedBanner = banner
    ? getLocalizedPromoBannerStrings(banner, shop.currency, locale)
    : null;

  const displayBadge =
    locale === 'vi' ? popup.badgeText || pt.popupBadge : pt.popupBadge;
  const displayTitle =
    locale === 'vi'
      ? popup.title
      : localizedBanner?.title || popup.title;
  const displayContent =
    locale === 'vi'
      ? popup.content
      : localizedBanner?.subtitle || popup.content;
  const displayCta =
    locale === 'vi' ? popup.ctaText || pt.popupCta : pt.popupCta;

  const handleCopyVoucher = async () => {
    if (!popup.voucherCode) return;
    try {
      await navigator.clipboard.writeText(popup.voucherCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 16 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl border border-slate-100 dark:border-slate-800"
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close promotion popup"
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-xs hover:bg-black/60"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Header Image or Gradient */}
            {popup.imageUrl ? (
              <div className="relative h-44 w-full bg-slate-900">
                <img
                  src={popup.imageUrl}
                  alt={displayTitle}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                {displayBadge && (
                  <span className="absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-black text-slate-950 shadow-sm">
                    <Sparkles className="h-3 w-3" />
                    {displayBadge}
                  </span>
                )}
              </div>
            ) : (
              <div
                className="px-5 pt-6 pb-4 text-white"
                style={{
                  background: `linear-gradient(135deg, ${primaryColor}, #0f172a)`,
                }}
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                  <Gift className="h-3.5 w-3.5 text-amber-300" />
                  {displayBadge}
                </span>
              </div>
            )}

            {/* Popup Content */}
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100 leading-snug">
                  {displayTitle}
                </h3>
                {displayContent && (
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {displayContent}
                  </p>
                )}
              </div>

              {/* Optional Voucher Code Box */}
              {popup.voucherCode && (
                <div className="flex items-center justify-between rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/80 dark:bg-amber-950/40 px-3.5 py-2.5">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      {pt.voucherLabel}
                    </span>
                    <span className="font-mono text-base font-black tracking-wider text-slate-900 dark:text-amber-100">
                      {popup.voucherCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyVoucher}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-400"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>{pt.copiedFull}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>{pt.copyFull}</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                style={{ backgroundColor: primaryColor, color: '#ffffff' }}
                className="w-full rounded-2xl py-3.5 text-sm font-black text-white shadow-lg transition hover:opacity-95 active:scale-98"
              >
                {displayCta}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Interactive Smartphone Mockup Viewer for Dashboard Settings & Promotions Studio
 * Lets the shop owner preview their storefront theme, colors, layout, banner, flash sale & languages live.
 */
export function StorefrontPhonePreview({
  shop,
  items = [],
  onOpenPopupPreview,
}: {
  shop: Shop;
  items?: CatalogItem[];
  onOpenPopupPreview?: () => void;
}) {
  const { tx } = useAppI18n();
  const [previewTab, setPreviewTab] = useState<'menu' | 'door'>('menu');
  const [previewLocale, setPreviewLocale] = useState<SupportedLocale>('vi');

  const primaryColor = shop.theme_config?.primaryColor || '#10b981';
  const layoutMode = shop.theme_config?.layout || 'list';
  const bgStyle = shop.theme_config?.backgroundStyle || 'clean';
  const bgUrl = shop.theme_config?.backgroundImageUrl?.trim();
  const overlayOpacity =
    typeof shop.theme_config?.backgroundOverlayOpacity === 'number'
      ? shop.theme_config.backgroundOverlayOpacity
      : 0.72;
  const isDarkSurface =
    bgStyle === 'dark' || Boolean(bgStyle === 'custom_image' && bgUrl);

  const labels = UI_LABELS[previewLocale] || UI_LABELS.vi;
  const sampleItems: CatalogItem[] =
    items.length > 0
      ? items.slice(0, 6)
      : [
          {
            id: 'preview-1',
            shop_id: shop.id,
            category_id: 'cat-1',
            sort_order: 1,
            price: 65000,
            is_available: true,
            is_featured: true,
            image_url:
              'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=400&auto=format&fit=crop&q=80',
            name_i18n: {
              vi: 'Món Đặc Trưng Quán',
              en: 'House Signature Dish',
              ko: '시그니처 대표 메뉴',
              ja: '看板おすすめメニュー',
              zh: '招牌特色菜',
              es: 'Plato Estrella de la Casa',
              it: 'Piatto Forte della Casa',
              ru: 'Фирменное блюдо',
            },
            desc_i18n: {
              vi: 'Đậm đà hương vị truyền thống',
              en: 'Rich authentic traditional flavor',
            },
            options_json: [],
            view_count: 10,
          },
          {
            id: 'preview-2',
            shop_id: shop.id,
            category_id: 'cat-1',
            sort_order: 2,
            price: 35000,
            is_available: true,
            is_featured: false,
            image_url:
              'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80',
            name_i18n: {
              vi: 'Trà Sâm Dứa / Đồ Uống',
              en: 'Pandan Herbal Tea',
              ko: '판단 허브티',
              ja: 'パンダンハーブティー',
              zh: '香兰草茶',
              es: 'Té Herbal Pandan',
              it: 'Tè alle Erbe Pandan',
              ru: 'Травяной чай Пандан',
            },
            desc_i18n: {
              vi: 'Thanh mát giải nhiệt',
              en: 'Refreshing herbal drink',
            },
            options_json: [],
            view_count: 8,
          },
        ];

  const surfaceBgColor =
    bgStyle === 'dark'
      ? '#020617'
      : bgStyle === 'warm'
        ? '#fffbeb'
        : '#f8fafc';

  return (
    <div className="flex flex-col items-center">
      {/* Top Preview Switcher Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 w-full max-w-[330px]">
        <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
          <Smartphone className="h-4 w-4 text-emerald-600" />
          <span>{tx('Xem trước', 'Preview')}</span>
        </div>
        <div className="inline-flex rounded-xl bg-slate-200/80 p-0.5 text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setPreviewTab('menu')}
            className={`rounded-lg px-2.5 py-1 transition ${
              previewTab === 'menu'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tx('Menu', 'Menu')}
          </button>
          <button
            type="button"
            onClick={() => setPreviewTab('door')}
            className={`rounded-lg px-2.5 py-1 transition ${
              previewTab === 'door'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tx('Thông tin', 'Info')}
          </button>
        </div>
      </div>

      {/* Phone Mockup Frame */}
      <div className="w-full max-w-[330px] rounded-[38px] border-[7px] border-slate-900 bg-slate-950 shadow-2xl overflow-hidden relative">
        {/* Phone Top Speaker Notch */}
        <div className="bg-slate-900 py-1.5 flex justify-center">
          <div className="h-1.5 w-16 rounded-full bg-slate-700" />
        </div>

        {/* Phone Screen Viewport */}
        <div
          style={{ backgroundColor: surfaceBgColor }}
          className="relative h-[540px] overflow-y-auto no-scrollbar flex flex-col justify-between"
        >
          {/* Optional Custom Wallpaper inside Phone Screen */}
          {bgStyle === 'custom_image' && bgUrl && (
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
              <img src={bgUrl} alt="" className="h-full w-full object-cover" />
              <div
                className="absolute inset-0 bg-slate-950"
                style={{ opacity: overlayOpacity }}
              />
            </div>
          )}

          <div className="relative z-10 flex-1 flex flex-col">
            {/* Sticky Phone Header + Interactive 8-Language Flag Strip */}
            <div
              style={{ backgroundColor: 'rgba(255,255,255,0.95)', color: '#0f172a' }}
              className="qr-light-surface sticky top-0 z-20 border-b border-slate-200 px-3 py-2 space-y-1.5 backdrop-blur-xs"
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-black text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Q
                  </span>
                  <span className="truncate text-xs font-black text-slate-900">
                    {shop.name || 'Tên Quán'}
                  </span>
                </div>

                {shop.theme_config?.welcomePopup?.enabled &&
                  onOpenPopupPreview && (
                    <button
                      type="button"
                      onClick={onOpenPopupPreview}
                      className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-700 hover:bg-rose-200"
                    >
                      🎁 Xem Popup
                    </button>
                  )}
              </div>

              {/* Interactive 8-Language Flag Bar inside Viewer */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
                {ALL_LOCALES.map((loc) => {
                  const active = previewLocale === loc;
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setPreviewLocale(loc)}
                      style={
                        active
                          ? { backgroundColor: primaryColor, color: '#ffffff' }
                          : { backgroundColor: '#f1f5f9', color: '#334155' }
                      }
                      className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold transition"
                    >
                      <FlagIcon locale={loc} className="h-2.5 w-3.5" />
                      <span>{LOCALE_META[loc].short}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Phone Screen Body */}
            <div className="p-2.5 space-y-2.5 flex-1">
              {previewTab === 'door' && (
                <div className="rounded-2xl overflow-hidden bg-slate-900 text-white relative h-28 flex items-end p-3">
                  {shop.cover_urls?.[0] ? (
                    <img
                      src={shop.cover_urls[0]}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-80"
                    />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}, #0f172a)`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                  <div className="relative z-10">
                    <span className="inline-block rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-black text-slate-950 mb-1">
                      {labels.openNow}
                    </span>
                    <h4 className="text-sm font-black text-white leading-tight">
                      {shop.name}
                    </h4>
                    <p className="text-[10px] text-slate-200 line-clamp-1">
                      {tField(shop.tagline_i18n, previewLocale)}
                    </p>
                  </div>
                </div>
              )}

              {/* Promo Banner Preview */}
              <StorefrontPromoBanner
                shop={shop}
                locale={previewLocale}
                onOpenPopup={onOpenPopupPreview}
              />

              {/* Flash Sale Preview */}
              <StorefrontFlashSaleSection
                shop={shop}
                items={sampleItems}
                locale={previewLocale}
              />

              {previewTab === 'door' ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setPreviewTab('menu')}
                    style={{ backgroundColor: primaryColor, color: '#ffffff' }}
                    className="w-full rounded-2xl p-3 text-left text-white shadow-md flex items-center justify-between"
                  >
                    <div>
                      <span className="block text-xs font-black">
                        {labels.viewMenuFnb}
                      </span>
                      <span className="block text-[9px] opacity-85">
                        8 Ngôn ngữ • Đặt món tại bàn
                      </span>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-900">
                      →
                    </span>
                  </button>

                  {shop.wifi_info?.ssid && (
                    <div
                      style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                      className="qr-light-surface rounded-xl border border-slate-200 bg-white p-2.5 flex items-center justify-between text-xs"
                    >
                      <span className="flex items-center gap-1.5 font-bold text-slate-800">
                        <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                        Wi-Fi: {shop.wifi_info.ssid}
                      </span>
                      <span
                        style={{ backgroundColor: primaryColor, color: '#ffffff' }}
                        className="rounded-lg px-2 py-0.5 text-[9px] font-bold"
                      >
                        {labels.copyPassword}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Category Pill Preview */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <span
                      style={{ backgroundColor: primaryColor, color: '#ffffff' }}
                      className="rounded-full px-2.5 py-1 text-[10px] font-black shadow-2xs"
                    >
                      {labels.allCategories}
                    </span>
                    <span
                      style={{ backgroundColor: '#ffffff', color: '#475569' }}
                      className="qr-light-surface rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-bold"
                    >
                      ⭐ {labels.bestSeller}
                    </span>
                  </div>

                  {/* Menu Items Preview (List or Grid) */}
                  <div
                    className={
                      layoutMode === 'grid'
                        ? 'grid grid-cols-2 gap-2'
                        : 'space-y-2'
                    }
                  >
                    {sampleItems.slice(0, 4).map((item) => {
                      const eff = getItemEffectivePrice(item, shop);
                      const itemTitle = tField(item.name_i18n, previewLocale);

                      if (layoutMode === 'grid') {
                        return (
                          <div
                            key={item.id}
                            style={
                              isDarkSurface
                                ? {
                                    backgroundColor: 'rgba(15,23,42,0.88)',
                                    color: '#f8fafc',
                                  }
                                : { backgroundColor: '#ffffff', color: '#0f172a' }
                            }
                            className={`rounded-xl border p-2 flex flex-col justify-between ${
                              isDarkSurface
                                ? 'border-slate-800'
                                : 'qr-light-surface border-slate-200'
                            }`}
                          >
                            <div>
                              <div className="relative h-20 w-full rounded-lg overflow-hidden bg-slate-100 mb-1.5">
                                {item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={itemTitle}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-lg">
                                    🍜
                                  </div>
                                )}
                                {eff.discountBadge && (
                                  <span className="absolute top-1 left-1 rounded bg-rose-600 px-1.5 py-0.5 text-[8px] font-black text-white">
                                    {eff.discountBadge}
                                  </span>
                                )}
                              </div>
                              <p className="line-clamp-1 text-[11px] font-extrabold">
                                {itemTitle}
                              </p>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between">
                              <div>
                                {eff.originalPrice && (
                                  <span className="block text-[8px] opacity-60 line-through">
                                    {formatCurrency(
                                      eff.originalPrice,
                                      shop.currency
                                    )}
                                  </span>
                                )}
                                <span
                                  className="text-[11px] font-black"
                                  style={{ color: primaryColor }}
                                >
                                  {formatCurrency(eff.finalPrice, shop.currency)}
                                </span>
                              </div>
                              <span
                                style={{
                                  backgroundColor: primaryColor,
                                  color: '#ffffff',
                                }}
                                className="flex h-5 w-5 items-center justify-center rounded-md text-xs font-black"
                              >
                                +
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={item.id}
                          style={
                            isDarkSurface
                              ? {
                                  backgroundColor: 'rgba(15,23,42,0.88)',
                                  color: '#f8fafc',
                                }
                              : { backgroundColor: '#ffffff', color: '#0f172a' }
                          }
                          className={`rounded-xl border p-2 flex items-center gap-2.5 ${
                            isDarkSurface
                              ? 'border-slate-800'
                              : 'qr-light-surface border-slate-200'
                          }`}
                        >
                          <div className="relative h-12 w-12 shrink-0 rounded-lg overflow-hidden bg-slate-100">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={itemTitle}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-base">
                                🍜
                              </div>
                            )}
                            {eff.discountBadge && (
                              <span className="absolute bottom-0 inset-x-0 bg-rose-600 text-center text-[7px] font-black text-white">
                                {eff.discountBadge}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-extrabold">
                              {itemTitle}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className="text-[11px] font-black"
                                style={{ color: primaryColor }}
                              >
                                {formatCurrency(eff.finalPrice, shop.currency)}
                              </span>
                              {eff.originalPrice && (
                                <span className="text-[9px] opacity-60 line-through">
                                  {formatCurrency(
                                    eff.originalPrice,
                                    shop.currency
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          <span
                            style={{
                              backgroundColor: primaryColor,
                              color: '#ffffff',
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black"
                          >
                            +
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Sticky Bottom Order Bar inside Phone Mockup */}
          <div className="sticky bottom-0 z-20 p-2 bg-gradient-to-t from-black/20 to-transparent">
            <div
              style={{ backgroundColor: primaryColor, color: '#ffffff' }}
              className="rounded-xl px-3 py-2 text-[11px] font-black flex items-center justify-between shadow-lg"
            >
              <span>🛒 2 ({labels.qtyShort})</span>
              <span>{labels.bottomCtaFnb} →</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
