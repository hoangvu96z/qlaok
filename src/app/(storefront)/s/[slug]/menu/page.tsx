'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  X,
  Gift,
} from 'lucide-react';
import {
  CartSelection,
  CatalogItem,
  Category,
  Shop,
  ShopOrder,
  SupportedLocale,
} from '@/types/qlaok';
import {
  ALL_LOCALES,
  detectVisitorLocale,
  formatCurrency,
  formatTableLabel,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import { getAllowedLocalesForPlan } from '@/lib/plan-limits';
import { LanguageSwitcher } from '@/components/storefront/LanguageSwitcher';
import { VerticalRenderer } from '@/components/storefront/VerticalRenderer';
import { ItemDetailDrawer } from '@/components/storefront/ItemDetailDrawer';
import { ShowToStaffModal } from '@/components/storefront/ShowToStaffModal';
import {
  calculateOrderPromoDiscount,
  getItemEffectivePrice,
  getStorefrontBackgroundProps,
  PROMO_LOCALE_TEXT,
  StorefrontFlashSaleSection,
  StorefrontPromoBanner,
  StorefrontWelcomePopup,
} from '@/components/storefront/StorefrontCustomDecor';

export default function StorefrontMenuPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug || 'pho-hoi-an';
  const initialTableParam = searchParams.get('table') || 'Bàn 01';

  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [allowedLangs, setAllowedLangs] =
    useState<SupportedLocale[]>(ALL_LOCALES);
  const [locale, setLocale] = useState<SupportedLocale>('vi');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeItem, setActiveItem] = useState<CatalogItem | null>(null);
  const [cart, setCart] = useState<CartSelection[]>([]);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isPromoPopupOpen, setIsPromoPopupOpen] = useState(false);
  const [lastOrder, setLastOrder] = useState<ShopOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<ShopOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCatalogData = useCallback(
    async (isInitial = false) => {
      try {
        const res = await fetch(`/api/shops?slug=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (isInitial) setLoading(false);
          return;
        }
        const data = await res.json();
        const loadedShop: Shop = data.shop;
        const rawPlanLangs = getAllowedLocalesForPlan(
          data.ownerPlan || 'premium',
          loadedShop.supported_langs
        );
        const planLangs =
          rawPlanLangs.length > 1 ? rawPlanLangs : ALL_LOCALES;

        setShop(loadedShop);
        setCategories(data.categories || []);
        setItems(data.items || []);
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

          // Track QR Table Scan
          fetch('/api/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shop_id: loadedShop.id,
              event_type: 'scan_table',
              visitor_lang: detected,
            }),
          }).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to fetch storefront menu:', err);
        if (isInitial) setLoading(false);
      }
    },
    [slug, searchParams]
  );

  useEffect(() => {
    fetchCatalogData(true);

    // Realtime sync via BroadcastChannel & lightweight polling so toggling "Sold Out" or price in CMS reflects immediately
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = () => {
        fetchCatalogData(false);
      };
    }

    const interval = setInterval(() => {
      fetchCatalogData(false);
    }, 4000);

    return () => {
      if (bc) bc.close();
      clearInterval(interval);
    };
  }, [fetchCatalogData]);

  const handleClosePopup = () => {
    setIsPromoPopupOpen(false);
    if (shop && typeof window !== 'undefined') {
      sessionStorage.setItem(`qlaok_popup_seen_${shop.id}`, '1');
    }
  };

  // Compute effective items with Flash Sale / Selected Item Discounts applied
  const effectiveItems: CatalogItem[] = React.useMemo(() => {
    if (!shop) return items;
    return items.map((rawItem) => {
      const eff = getItemEffectivePrice(rawItem, shop);
      if (eff.finalPrice !== rawItem.price) {
        return {
          ...rawItem,
          price: eff.finalPrice,
          compare_at_price: eff.originalPrice || rawItem.price,
        };
      }
      return rawItem;
    });
  }, [items, shop]);

  const handleOpenItem = (item: CatalogItem) => {
    const effItem =
      effectiveItems.find((ei) => ei.id === item.id) || item;
    setActiveItem(effItem);
    if (shop) {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          event_type: 'item_view',
          item_id: item.id,
          visitor_lang: locale,
        }),
      }).catch(() => {});
    }
  };

  const handleQuickAdd = (item: CatalogItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const effItem =
      effectiveItems.find((ei) => ei.id === item.id) || item;
    const hasOptions = Boolean(
      effItem.options_json && effItem.options_json.length > 0
    );
    if (hasOptions) {
      handleOpenItem(effItem);
      return;
    }

    setCart((prev) => {
      const existingIdx = prev.findIndex(
        (entry) =>
          entry.item.id === effItem.id &&
          entry.selectedChoices.length === 0 &&
          !entry.customNote &&
          (!entry.quickTags || entry.quickTags.length === 0)
      );
      if (existingIdx !== -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          item: effItem,
          quantity: updated[existingIdx].quantity + 1,
        };
        return updated;
      }
      return [
        ...prev,
        {
          item: effItem,
          quantity: 1,
          selectedChoices: [],
          customNote: '',
          quickTags: [],
        },
      ];
    });
  };

  const handleAddFromDrawer = (selection: CartSelection) => {
    setCart((prev) => [...prev, selection]);
  };

  const handleUpdateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const updated = [...prev];
      const nextQty = updated[index].quantity + delta;
      if (nextQty <= 0) {
        updated.splice(index, 1);
      } else {
        updated[index] = { ...updated[index], quantity: nextQty };
      }
      return updated;
    });
  };

  const handleHydrateOrderIntoCart = (order: ShopOrder) => {
    setEditingOrder(order);
    const hydratedCart: CartSelection[] = (order.items || []).map((li, idx) => {
      const matchedItem =
        effectiveItems.find((it) => it.id === li.item_id) ||
        effectiveItems.find((it) => it.name_i18n.vi === li.name_vi);

      const fallbackItem: CatalogItem = matchedItem || {
        id: li.item_id || `custom-${idx}`,
        shop_id: order.shop_id,
        category_id: categories[0]?.id || 'default',
        name_i18n: li.name_i18n || { vi: li.name_vi },
        desc_i18n: { vi: '' },
        price: Number(li.unit_price) || 0,
        options_json: [],
        is_available: true,
        is_featured: false,
        view_count: 0,
        sort_order: 999,
      };

      const rawChoices = Array.isArray(li.selected_choices)
        ? li.selected_choices
        : [];
      const selectedChoices = rawChoices.map((raw, cIdx) => {
        if (typeof raw === 'string') {
          return {
            id: `choice-${cIdx}`,
            label_i18n: { vi: raw },
            extra_price: 0,
          };
        }
        const labelVi = raw?.label_vi || raw?.label_i18n?.vi || '';
        return {
          id: raw?.id || `choice-${cIdx}`,
          label_i18n: raw?.label_i18n || { vi: labelVi },
          extra_price: Number(raw?.extra_price) || 0,
        };
      });

      return {
        item: fallbackItem,
        quantity: Math.max(1, Number(li.quantity) || 1),
        selectedChoices,
        customNote: li.custom_note || '',
        quickTags: Array.isArray(li.quick_tags) ? li.quick_tags : [],
      };
    });

    setCart(hydratedCart);
    setIsStaffModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 space-y-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-semibold text-slate-500">
          Đang tải thực đơn đa ngôn ngữ...
        </p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center space-y-3">
        <h1 className="text-base font-bold text-slate-900">
          Không tìm thấy thực đơn cửa hàng
        </h1>
        <Link
          href="/explore"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
        >
          Quay lại trang khám phá
        </Link>
      </div>
    );
  }

  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const primaryColor = shop.theme_config?.primaryColor || '#10b981';
  const bgProps = getStorefrontBackgroundProps(shop);
  const hasActivePopup = Boolean(
    shop.theme_config?.welcomePopup?.enabled &&
      shop.theme_config?.welcomePopup?.title?.trim()
  );

  const totalItemsCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const subtotalCartAmount = cart.reduce((sum, entry) => {
    const extra = entry.selectedChoices.reduce(
      (s, c) => s + (c.extra_price || 0),
      0
    );
    return sum + (entry.item.price + extra) * entry.quantity;
  }, 0);

  const promoCalc = calculateOrderPromoDiscount(
    cart.map((entry) => {
      const extra = entry.selectedChoices.reduce(
        (s, c) => s + (c.extra_price || 0),
        0
      );
      return {
        item: entry.item,
        quantity: entry.quantity,
        lineTotal: (entry.item.price + extra) * entry.quantity,
      };
    }),
    shop,
    locale
  );
  const totalCartAmount = Math.max(
    0,
    subtotalCartAmount - promoCalc.discountAmount
  );

  const bottomCtaText =
    shop.vertical === 'service'
      ? labels.bottomCtaService
      : shop.vertical === 'retail'
        ? labels.bottomCtaRetail
        : labels.bottomCtaFnb;

  return (
    <div className={`flex flex-1 flex-col min-h-screen ${bgProps.containerClass}`}>
      {bgProps.backgroundLayer}

      {/* Top Header with Back to Store Info & 8-Language Switcher */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-2xs text-slate-900">
        <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href={`/s/${shop.slug}?lang=${locale}`}
              className="flex items-center gap-2 min-w-0"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200">
                <ArrowLeft className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-extrabold text-slate-900 leading-tight">
                  {shop.name}
                </h1>
                <p className="truncate text-[11px] font-medium text-slate-500">
                  {labels.backToStore}
                  {shop.wifi_info?.ssid ? ` • 📶 ${shop.wifi_info.ssid}` : ''}
                </p>
              </div>
            </Link>

            {hasActivePopup && (
              <button
                type="button"
                onClick={() => setIsPromoPopupOpen(true)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-700 hover:bg-rose-200"
              >
                <Gift className="h-3 w-3 text-rose-600" />
                <span>Ưu đãi</span>
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

        {/* 1-Tap 8-Language Flag Quick Bar */}
        <div className="px-3.5 pb-2">
          <LanguageSwitcher
            currentLocale={locale}
            supportedLangs={allowedLangs}
            onChange={setLocale}
          />
        </div>

        {/* Search Input */}
        <div className="px-3.5 pb-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              className="w-full rounded-xl border border-slate-200 bg-slate-100/80 pl-9 pr-8 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Sticky Horizontal Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3.5 pb-2.5">
          <button
            type="button"
            onClick={() => setSelectedCategoryId('all')}
            style={
              selectedCategoryId === 'all'
                ? { backgroundColor: primaryColor, color: '#ffffff' }
                : undefined
            }
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
              selectedCategoryId === 'all'
                ? 'shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {labels.allCategories}
          </button>

          {categories.map((cat) => {
            const active = selectedCategoryId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategoryId(cat.id)}
                style={
                  active
                    ? { backgroundColor: primaryColor, color: '#ffffff' }
                    : undefined
                }
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                  active
                    ? 'shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tField(cat.name_i18n, locale)}
              </button>
            );
          })}
        </div>
      </header>

      {/* Active Order Realtime Banner if Guest Just Sent an Order */}
      {lastOrder && (
        <div className="relative z-10 mx-3.5 mt-3">
          <button
            type="button"
            onClick={() => setIsStaffModalOpen(true)}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-emerald-500/40 bg-slate-900 px-3.5 py-2.5 text-left text-white shadow-md"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 animate-ping" />
              <div className="min-w-0">
                <p className="truncate text-xs font-extrabold text-emerald-400">
                  {labels.liveOrderSentPrefix}#{lastOrder.order_code} •{' '}
                  {formatTableLabel(lastOrder.table_label, locale)}
                  {labels.liveOrderSentSuffix}
                </p>
                <p className="truncate text-[11px] text-slate-300">
                  {labels.liveOrderBannerSub}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-xl bg-emerald-500 px-2.5 py-1 text-[11px] font-black text-slate-950">
              {labels.viewOrderBtn}
            </span>
          </button>
        </div>
      )}

      {/* Owner Custom Promo Banner */}
      {shop.theme_config?.promoBanner?.enabled && (
        <div className="relative z-10 mx-3.5 mt-3">
          <StorefrontPromoBanner
            shop={shop}
            locale={locale}
            onOpenPopup={
              hasActivePopup ? () => setIsPromoPopupOpen(true) : undefined
            }
          />
        </div>
      )}

      {/* Live Flash Sale Countdown Section */}
      {shop.theme_config?.flashSale?.enabled && (
        <div className="relative z-10 mx-3.5 mt-3">
          <StorefrontFlashSaleSection
            shop={shop}
            items={items}
            locale={locale}
            onSelectItem={handleOpenItem}
            onQuickAdd={handleQuickAdd}
          />
        </div>
      )}

      {/* Main Catalog / Menu List by Vertical */}
      <main className="relative z-10 flex-1 p-3.5">
        <VerticalRenderer
          vertical={shop.vertical}
          categories={categories}
          items={effectiveItems}
          locale={locale}
          currency={shop.currency}
          primaryColor={primaryColor}
          layoutMode={shop.theme_config?.layout}
          isDarkTheme={bgProps.isDarkTheme}
          selectedCategoryId={selectedCategoryId}
          searchQuery={searchQuery}
          onSelectItem={handleOpenItem}
          onQuickAdd={handleQuickAdd}
        />
      </main>

      {/* Floating Bottom Action Bar (Review & Send Order to Kitchen) */}
      {totalItemsCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center p-3 pointer-events-none">
          <div className="w-full max-w-md pointer-events-auto">
            <button
              type="button"
              onClick={() => setIsStaffModalOpen(true)}
              style={{ backgroundColor: primaryColor }}
              className="flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-white shadow-2xl ring-2 ring-white transition-transform active:scale-98"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950/25 text-sm font-black">
                  {totalItemsCount}
                </div>
                <div className="text-left">
                  <span className="block text-xs sm:text-sm font-black leading-tight">
                    {bottomCtaText}
                  </span>
                  <span className="block text-[10px] font-medium text-white/85">
                    {promoCalc.discountAmount > 0
                      ? (PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi).savedDiscount(
                          formatCurrency(promoCalc.discountAmount, shop.currency)
                        )
                      : labels.bottomBarHint}
                  </span>
                </div>
              </div>

              <div className="text-right">
                {promoCalc.discountAmount > 0 && (
                  <span className="block text-[10px] text-white/75 line-through">
                    {formatCurrency(subtotalCartAmount, shop.currency)}
                  </span>
                )}
                <span className="text-sm sm:text-base font-black">
                  {formatCurrency(totalCartAmount, shop.currency)}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Item Detail Bottom Sheet Drawer */}
      <ItemDetailDrawer
        item={activeItem}
        vertical={shop.vertical}
        locale={locale}
        currency={shop.currency}
        primaryColor={primaryColor}
        onClose={() => setActiveItem(null)}
        onAddToCart={handleAddFromDrawer}
      />

      {/* Welcome / Promo Popup Modal */}
      <StorefrontWelcomePopup
        shop={shop}
        locale={locale}
        isOpen={isPromoPopupOpen}
        onClose={handleClosePopup}
      />

      {/* Order Confirmation & Live Order Tracker Modal */}
      <ShowToStaffModal
        isOpen={isStaffModalOpen}
        onClose={() => {
          setIsStaffModalOpen(false);
        }}
        shop={shop}
        locale={locale}
        cart={cart}
        initialTableLabel={initialTableParam}
        activeOrderProp={lastOrder}
        editingOrder={editingOrder}
        onEditOrder={handleHydrateOrderIntoCart}
        onCancelEditOrder={() => setEditingOrder(null)}
        onUpdateQuantity={handleUpdateQuantity}
        onClearCart={() => setCart([])}
        onOrderCreated={(createdOrder) => {
          setLastOrder(createdOrder);
          fetchCatalogData(false);
        }}
      />
    </div>
  );
}
