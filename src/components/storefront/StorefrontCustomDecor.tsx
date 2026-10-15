'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Gift, Copy, Check, X, Flame } from 'lucide-react';
import type { Shop, ShopPromoBannerConfig } from '@/types/qlaok';

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
      containerClass: 'relative min-h-screen text-slate-900',
      backgroundLayer: (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden flex justify-center">
          <div className="relative w-full max-w-md h-full">
            <img
              src={bgUrl}
              alt=""
              className="h-full w-full object-cover"
            />
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
      containerClass: 'relative min-h-screen bg-amber-50/70 text-slate-900',
      backgroundLayer: null,
    };
  }

  return {
    isDarkTheme: false,
    containerClass: 'relative min-h-screen bg-slate-50 text-slate-900',
    backgroundLayer: null,
  };
}

export function StorefrontPromoBanner({
  shop,
  onOpenPopup,
}: {
  shop: Shop;
  onOpenPopup?: () => void;
}) {
  const banner = shop.theme_config?.promoBanner;
  if (!banner || !banner.enabled || !banner.title?.trim()) return null;

  const gradClass =
    BANNER_GRADIENT_MAP[banner.bgGradient || 'amber_rose'] ||
    BANNER_GRADIENT_MAP.amber_rose;

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-md border border-white/20">
      <div className={`bg-gradient-to-r ${gradClass} p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            {banner.badgeText && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-xs">
                <Flame className="h-3 w-3 text-amber-300" />
                {banner.badgeText}
              </span>
            )}
            <h3 className="text-sm sm:text-base font-black leading-snug">
              {banner.title}
            </h3>
            {banner.subtitle && (
              <p className="text-xs opacity-90 leading-relaxed">
                {banner.subtitle}
              </p>
            )}
            {banner.ctaText && onOpenPopup && (
              <button
                type="button"
                onClick={onOpenPopup}
                className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-black text-slate-900 shadow-xs hover:bg-slate-100 active:scale-95 transition"
              >
                <Gift className="h-3.5 w-3.5 text-rose-500" />
                <span>{banner.ctaText}</span>
              </button>
            )}
          </div>

          {banner.imageUrl && (
            <img
              src={banner.imageUrl}
              alt={banner.title}
              className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-2xl object-cover border-2 border-white/40 shadow-md"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function StorefrontWelcomePopup({
  shop,
  isOpen,
  onClose,
}: {
  shop: Shop;
  isOpen: boolean;
  onClose: () => void;
}) {
  const popup = shop.theme_config?.welcomePopup;
  const [copiedCode, setCopiedCode] = useState(false);

  if (!popup || !popup.enabled || !popup.title?.trim()) return null;

  const primaryColor = shop.theme_config?.primaryColor || '#10b981';

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
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-3xl bg-white text-slate-900 shadow-2xl border border-slate-100"
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
                  alt={popup.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                {popup.badgeText && (
                  <span className="absolute bottom-3 left-4 inline-flex items-center gap-1 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-black text-slate-950 shadow-sm">
                    <Sparkles className="h-3 w-3" />
                    {popup.badgeText}
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
                  {popup.badgeText || '🎁 ƯU ĐÃI ĐẶC BIỆT'}
                </span>
              </div>
            )}

            {/* Popup Content */}
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-lg font-black text-slate-900 leading-snug">
                  {popup.title}
                </h3>
                {popup.content && (
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {popup.content}
                  </p>
                )}
              </div>

              {/* Optional Voucher Code Box */}
              {popup.voucherCode && (
                <div className="flex items-center justify-between rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50/80 px-3.5 py-2.5">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      Mã Voucher Ưu Đãi
                    </span>
                    <span className="font-mono text-base font-black tracking-wider text-slate-900">
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
                        <span>Đã lưu mã</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy mã</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                style={{ backgroundColor: primaryColor }}
                className="w-full rounded-2xl py-3.5 text-sm font-black text-white shadow-lg transition hover:opacity-95 active:scale-98"
              >
                {popup.ctaText || 'Nhận ưu đãi & Xem Menu ngay'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
