'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  MapPin,
  Phone,
  Star,
  Clock,
  ArrowRight,
  Sparkles,
  Megaphone,
  UtensilsCrossed,
  Scissors,
  ShoppingBag,
  Gift,
} from 'lucide-react';
import { Post, Shop, SupportedLocale } from '@/types/qlaok';
import {
  checkShopOpenStatus,
  DEFAULT_STOREFRONT_LOCALES,
  normalizeShopSupportedLangs,
  detectVisitorLocale,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import { getAllowedLocalesForPlan } from '@/lib/plan-limits';
import { getContrastTextColor } from '@/lib/theme-contrast';
import { LanguageSwitcher } from '@/components/storefront/LanguageSwitcher';
import { WifiBadge } from '@/components/storefront/WifiBadge';
import {
  getStorefrontBackgroundProps,
  StorefrontFlashSaleSection,
  StorefrontPromoBanner,
  StorefrontWelcomePopup,
} from '@/components/storefront/StorefrontCustomDecor';
import { CatalogItem } from '@/types/qlaok';
import { resolveStorefrontCanonicalRedirect } from '@/lib/table-helpers';

export default function StorefrontDoorPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug || 'pho-hoi-an';

  const [shop, setShop] = useState<Shop | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [allowedLangs, setAllowedLangs] = useState<SupportedLocale[]>(DEFAULT_STOREFRONT_LOCALES);
  const [locale, setLocale] = useState<SupportedLocale>('vi');
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const [loading, setLoading] = useState(true);
  const [isPromoPopupOpen, setIsPromoPopupOpen] = useState(false);
  const trackedScanShopIdRef = useRef<string | null>(null);

  const loadStorefront = useCallback(
    async (isInitial = false) => {
      try {
        const res = await fetch(`/api/shops?slug=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        const loadedShop: Shop = data.shop;
        const canonicalRedirect = resolveStorefrontCanonicalRedirect({
          requestedSlug: slug,
          canonicalSlug: loadedShop.slug,
          view: 'door',
          searchParams: searchParams.toString(),
        });
        if (canonicalRedirect?.isAlias) {
          router.replace(canonicalRedirect.canonicalUrl);
        }

        // Respect the shop's configured supported_langs (default ['vi','en']), capped by plan
        const planLangs = getAllowedLocalesForPlan(
          data.ownerPlan || 'free',
          normalizeShopSupportedLangs(loadedShop.supported_langs)
        );

        setShop(loadedShop);
        setItems(data.items || []);
        setPosts(data.posts || []);
        setAllowedLangs(planLangs);

        if (isInitial) {
          const detected = detectVisitorLocale(
            planLangs,
            searchParams.get('lang')
          );
          setLocale(detected);
          setLoading(false);

          // Auto-open Welcome Popup if enabled and not dismissed in this session
          const popupCfg = loadedShop.theme_config?.welcomePopup;
          if (popupCfg?.enabled && popupCfg.title?.trim()) {
            const seenKey = `qlaok_popup_seen_${loadedShop.id}`;
            if (!sessionStorage.getItem(seenKey)) {
              setIsPromoPopupOpen(true);
            }
          }

          if (trackedScanShopIdRef.current !== loadedShop.id) {
            trackedScanShopIdRef.current = loadedShop.id;
            // Track QR Door Scan
            fetch('/api/analytics/track', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shop_id: loadedShop.id,
                event_type: 'scan_door',
                visitor_lang: detected,
              }),
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Error loading storefront:', err);
        setLoading(false);
      }
    },
    [slug, router, searchParams]
  );

  useEffect(() => {
    loadStorefront(true);
  }, [loadStorefront]);

  // Listen for live theme / promotion updates from owner dashboard
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const bc = new BroadcastChannel('qlaok_realtime_sync');
    bc.onmessage = (ev) => {
      if (
        ev.data?.type === 'shop_updated' ||
        ev.data?.type === 'catalog_changed'
      ) {
        loadStorefront(false);
      }
    };
    return () => bc.close();
  }, [loadStorefront]);

  const handleClosePopup = () => {
    setIsPromoPopupOpen(false);
    if (shop && typeof window !== 'undefined') {
      sessionStorage.setItem(`qlaok_popup_seen_${shop.id}`, '1');
    }
  };

  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 space-y-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-semibold text-slate-500">
          {labels.loadingShopInfo}
        </p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="text-4xl">🏪</div>
        <h1 className="text-lg font-bold text-slate-900">
          {labels.shopNotFoundTitle}
        </h1>
        <p className="text-xs text-slate-500">
          <code className="font-mono text-rose-600">/s/{slug}</code>
        </p>
        <Link
          href="/explore"
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white"
        >
          {labels.backToExplore}
        </Link>
      </div>
    );
  }

  const primaryColor = shop.theme_config?.primaryColor || '#10b981';
  const primaryTextColor = getContrastTextColor(primaryColor);
  const openStatus = checkShopOpenStatus(shop.opening_hours);
  const bgProps = getStorefrontBackgroundProps(shop);
  const hasActivePopup = Boolean(
    shop.theme_config?.welcomePopup?.enabled &&
      shop.theme_config?.welcomePopup?.title?.trim()
  );

  const mainCtaLabel =
    shop.vertical === 'service'
      ? labels.viewMenuService
      : shop.vertical === 'retail'
        ? labels.viewMenuRetail
        : labels.viewMenuFnb;

  const VerticalIcon =
    shop.vertical === 'service'
      ? Scissors
      : shop.vertical === 'retail'
        ? ShoppingBag
        : UtensilsCrossed;

  return (
    <div className={`flex flex-1 flex-col pb-24 ${bgProps.containerClass}`}>
      {bgProps.backgroundLayer}

      {/* Top Language Bar */}
      <div className="sticky top-0 z-30 bg-white/95 px-3.5 py-2 backdrop-blur-md border-b border-slate-200/70 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-extrabold tracking-tight text-slate-900"
            >
              <span
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-black"
                style={{ backgroundColor: primaryColor, color: primaryTextColor }}
              >
                Q
              </span>
              <span>Qlaok</span>
            </Link>

            {hasActivePopup && (
              <button
                type="button"
                onClick={() => setIsPromoPopupOpen(true)}
                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-extrabold text-rose-700 hover:bg-rose-200"
              >
                <Gift className="h-3 w-3 text-rose-600" />
                <span>{labels.promosShort}</span>
              </button>
            )}
          </div>

          <LanguageSwitcher
            currentLocale={locale}
            supportedLangs={allowedLangs}
            onChange={setLocale}
            compact
          />
        </div>

      </div>

      {/* Hero Cover Image & Shop Identity */}
      <div className="relative z-10 h-52 w-full bg-slate-900 overflow-hidden">
        {shop.cover_urls?.[0] ? (
          <img
            src={shop.cover_urls[0]}
            alt={shop.name}
            className="h-full w-full object-cover opacity-90"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, #0f172a)`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent" />

        {/* Open / Closed Status Pill */}
        <div className="absolute left-4 top-3.5 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow-md ${
              openStatus.isOpen
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-rose-600 text-white'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                openStatus.isOpen ? 'bg-slate-950 animate-pulse' : 'bg-white'
              }`}
            />
            {openStatus.isOpen ? labels.openNow : labels.closedNow}
          </span>
          {!openStatus.todaySchedule.closed && (
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-xs">
              <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
              {openStatus.todaySchedule.open} – {openStatus.todaySchedule.close}
            </span>
          )}
        </div>

        {/* Shop Logo & Title Overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex items-end gap-3.5">
          {shop.logo_url ? (
            <img
              src={shop.logo_url}
              alt={shop.name}
              className="h-16 w-16 shrink-0 rounded-2xl border-2 border-white object-cover shadow-lg bg-white"
            />
          ) : (
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 border-white text-2xl font-black shadow-lg"
              style={{ backgroundColor: primaryColor, color: primaryTextColor }}
            >
              {shop.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 text-white">
            <h1 className="truncate text-xl font-black tracking-tight drop-shadow-xs">
              {shop.name}
            </h1>
            <p className="line-clamp-2 text-xs font-medium text-slate-200 mt-0.5">
              {tField(shop.tagline_i18n, locale)}
            </p>
          </div>
        </div>
      </div>

      {/* Main Micro-Website Body */}
      <div className="relative z-10 p-4 space-y-4">
        {/* Custom Owner Promo Banner (if enabled) */}
        <StorefrontPromoBanner
          shop={shop}
          locale={locale}
          onOpenPopup={
            hasActivePopup ? () => setIsPromoPopupOpen(true) : undefined
          }
        />

        {/* Flash Sale Countdown Section (if enabled) */}
        <StorefrontFlashSaleSection
          shop={shop}
          items={items}
          locale={locale}
        />

        {/* Primary CTA to Menu / Price List */}
        <Link
          href={`/s/${shop.slug}/menu?src=door&lang=${locale}`}
          style={{ backgroundColor: primaryColor, color: primaryTextColor }}
          className="flex items-center justify-between rounded-2xl p-4 shadow-lg transition-transform active:scale-98"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-xs">
              <VerticalIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="block text-base font-black tracking-tight">
                {mainCtaLabel}
              </span>
                <span className="block text-xs">
                  {allowedLangs
                    .map((lang) =>
                      ({
                        vi: '🇻🇳', en: '🇬🇧', ko: '🇰🇷', ja: '🇯🇵',
                        zh: '🇨🇳', es: '🇪🇸', it: '🇮🇹', ru: '🇷🇺',
                      })[lang]
                    )
                    .join(' ')}{' '}
                  • {locale === 'en' ? 'Menu' : 'Thực đơn'}
                </span>
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-900 shadow-xs">
            <ArrowRight className="h-5 w-5" />
          </div>
        </Link>

        {/* 1-Tap Wi-Fi Badge */}
        <WifiBadge
          wifi={shop.wifi_info}
          shopId={shop.id}
          locale={locale}
          primaryColor={primaryColor}
        />

        {/* Description & Address Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3 text-slate-900">
          {tField(shop.description_i18n, locale) && (
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed break-words">
              {tField(shop.description_i18n, locale)}
            </p>
          )}

          {shop.address && (
            <div className="flex items-start gap-2.5 pt-1 text-xs text-slate-700">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span className="font-medium">{shop.address}</span>
            </div>
          )}

          {/* Action Buttons: Google Maps Directions, Call/Zalo, 5-Star Google Review */}
          <div className="grid grid-cols-2 gap-2.5 pt-2">
            {shop.google_maps_url && (
              <a
                href={shop.google_maps_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-100 active:scale-98"
              >
                <MapPin className="h-4 w-4 text-rose-500" />
                <span className="truncate">{labels.directions}</span>
              </a>
            )}

            {shop.google_review_url && (
              <a
                href={shop.google_review_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-100 active:scale-98"
              >
                <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                <span className="truncate">{labels.googleReview}</span>
              </a>
            )}
          </div>

          {shop.phone_contact && (
            <a
              href={`tel:${shop.phone_contact}`}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              <span>Hotline / Zalo: {shop.phone_contact}</span>
            </a>
          )}
        </div>

        {/* Store Promotions & Announcements (posts) */}
        {posts.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 px-1">
              <Megaphone className="h-4 w-4 text-amber-500" />
              <h2
                className={`text-xs font-extrabold uppercase tracking-wider ${
                  bgProps.isDarkTheme ? 'text-slate-200' : 'text-slate-600'
                }`}
              >
                {labels.promotions}
              </h2>
            </div>

            <div className="space-y-2.5">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className={`rounded-2xl border p-4 shadow-xs text-slate-900 ${
                    post.is_pinned
                      ? 'border-amber-300 bg-amber-50/95'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      {tField(post.title_i18n, locale)}
                    </h3>
                    {post.is_pinned && (
                      <span className="shrink-0 rounded-full bg-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                        📌 {labels.pinnedBadge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    {tField(post.content_i18n, locale)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Store Gallery Preview */}
        {shop.cover_urls && shop.cover_urls.length > 1 && (
          <div className="grid grid-cols-2 gap-2.5">
            {shop.cover_urls.slice(0, 4).map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`${shop.name} ${idx + 1}`}
                className="h-32 w-full rounded-2xl object-cover border border-slate-200"
              />
            ))}
          </div>
        )}
      </div>

      {/* Welcome / Promo Popup Modal */}
      <StorefrontWelcomePopup
        shop={shop}
        locale={locale}
        isOpen={isPromoPopupOpen}
        onClose={handleClosePopup}
      />

      {/* Sticky Bottom Floating Button */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center p-3 pointer-events-none">
        <div className="w-full max-w-md pointer-events-auto">
          <Link
            href={`/s/${shop.slug}/menu?src=door&lang=${locale}`}
            style={{ backgroundColor: primaryColor, color: primaryTextColor }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 px-5 text-sm font-black shadow-xl ring-2 ring-white"
          >
            <Sparkles className="h-4 w-4" />
            <span>{mainCtaLabel}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
