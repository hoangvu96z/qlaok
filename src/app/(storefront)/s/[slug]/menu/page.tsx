'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  X,
  Gift,
  Utensils,
  ShoppingBag,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  CartSelection,
  CatalogItem,
  Category,
  Shop,
  ShopOrder,
  ShopTable,
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
import {
  filterSelectableTables,
  isTakeawayTableLabel,
  resolveTableSelection,
} from '@/lib/table-helpers';
import { getAllowedLocalesForPlan } from '@/lib/plan-limits';
import { LanguageSwitcher } from '@/components/storefront/LanguageSwitcher';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
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

interface UserTableChoice {
  shopSlug: string;
  tableId: string | null;
  tableLabel: string;
  isTakeaway: boolean;
}

export default function StorefrontMenuPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug || 'pho-hoi-an';

  const qrTableIdParam = searchParams.get('tableId');
  const qrTableParam = searchParams.get('table');
  const langParam = searchParams.get('lang');

  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [tables, setTables] = useState<ShopTable[]>([]);
  const [tablesLoadError, setTablesLoadError] = useState<string | null>(null);
  const [allowedLangs, setAllowedLangs] =
    useState<SupportedLocale[]>(ALL_LOCALES);
  const [locale, setLocale] = useState<SupportedLocale>('vi');
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
  const [userTableChoice, setUserTableChoice] =
    useState<UserTableChoice | null>(null);
  const [loading, setLoading] = useState(true);

  const activeSlugRef = useRef(slug);
  const requestSeqRef = useRef(0);
  const initializedSlugRef = useRef<string | null>(null);

  // Reset shop-scoped cart/order/selection state when navigating to a different shop slug
  useEffect(() => {
    if (activeSlugRef.current !== slug) {
      activeSlugRef.current = slug;
      setCart([]);
      setLastOrder(null);
      setEditingOrder(null);
      setUserTableChoice(null);
      setSelectedCategoryId('all');
      setSearchQuery('');
      setTables([]);
      setTablesLoadError(null);
      setLoading(true);
    }
  }, [slug]);

  const fetchCatalogData = useCallback(
    async (isInitial = false) => {
      const currentSlug = slug;
      const seq = ++requestSeqRef.current;

      try {
        const res = await fetch(
          `/api/shops?slug=${encodeURIComponent(currentSlug)}`,
          {
            cache: 'no-store',
          }
        );
        if (activeSlugRef.current !== currentSlug || seq !== requestSeqRef.current) {
          return;
        }
        if (!res.ok) {
          if (isInitial) setLoading(false);
          return;
        }
        const data = await res.json();
        if (activeSlugRef.current !== currentSlug || seq !== requestSeqRef.current) {
          return;
        }

        const loadedShop: Shop = data.shop;
        const rawPlanLangs = getAllowedLocalesForPlan(
          data.ownerPlan || 'premium',
          loadedShop.supported_langs
        );
        const planLangs =
          rawPlanLangs.length > 1 ? rawPlanLangs : ALL_LOCALES;

        let loadedTables: ShopTable[] = [];
        if (Array.isArray(data.tables)) {
          loadedTables = data.tables;
          setTablesLoadError(null);
        } else if (loadedShop?.id) {
          try {
            const tblRes = await fetch(
              `/api/tables?shopId=${encodeURIComponent(loadedShop.id)}`,
              { cache: 'no-store' }
            );
            if (tblRes.ok) {
              const tblData = await tblRes.json();
              loadedTables = Array.isArray(tblData.tables)
                ? tblData.tables
                : [];
              setTablesLoadError(null);
            } else {
              const errData = await tblRes.json().catch(() => null);
              setTablesLoadError(
                errData?.error ||
                  'Không thể tải danh sách bàn của quán. Vui lòng thử lại.'
              );
            }
          } catch {
            setTablesLoadError(
              'Không thể tải danh sách bàn của quán. Vui lòng thử lại.'
            );
          }
        }

        if (activeSlugRef.current !== currentSlug) {
          return;
        }

        const activeOnlyTables = loadedTables.filter(
          (t) =>
            t &&
            t.shop_id === loadedShop.id &&
            Boolean(t.is_active) &&
            !t.is_archived
        );

        setShop(loadedShop);
        setCategories(data.categories || []);
        setItems(data.items || []);
        setTables(activeOnlyTables);
        setAllowedLangs(planLangs);

        if (isInitial || initializedSlugRef.current !== currentSlug) {
          initializedSlugRef.current = currentSlug;
          const detected = detectVisitorLocale(planLangs, langParam);
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
        if (isInitial && activeSlugRef.current === currentSlug) {
          setLoading(false);
        }
      }
    },
    [slug, langParam]
  );

  useEffect(() => {
    fetchCatalogData(true);

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

  // Active tables sorted for display
  const activeTables = useMemo(() => {
    if (!shop) return [];
    return filterSelectableTables(tables, shop.id);
  }, [tables, shop]);

  // Resolve QR table parameters (?tableId=... or ?table=...) against activeTables
  const tableState = useMemo(() => {
    // 1. User explicitly chose a table or takeaway in this shop session
    if (userTableChoice && userTableChoice.shopSlug === slug) {
      if (userTableChoice.isTakeaway) {
        return {
          selectedTable: null as ShopTable | null,
          selectedTableId: null as string | null,
          isTakeawaySelected: true,
          error: null as string | null,
        };
      }
      if (userTableChoice.tableId) {
        const check = resolveTableSelection(activeTables, {
          tableId: userTableChoice.tableId,
        });
        if (check.table) {
          return {
            selectedTable: check.table,
            selectedTableId: check.table.id,
            isTakeawaySelected: false,
            error: null,
          };
        }
        return {
          selectedTable: null,
          selectedTableId: null,
          isTakeawaySelected: false,
          error: check.error,
        };
      }
    }

    // 2. Legacy ?table=Mang về / takeaway URL parameter (when no tableId)
    if (!qrTableIdParam && qrTableParam && isTakeawayTableLabel(qrTableParam)) {
      return {
        selectedTable: null,
        selectedTableId: null,
        isTakeawaySelected: true,
        error: null,
      };
    }

    // 3. Resolve QR ?tableId= or ?table= via pure resolveTableSelection helper
    const resolved = resolveTableSelection(activeTables, {
      tableId: qrTableIdParam,
      table: qrTableParam,
    });

    return {
      selectedTable: resolved.table,
      selectedTableId: resolved.table?.id ?? null,
      isTakeawaySelected: false,
      error: resolved.error,
    };
  }, [
    userTableChoice,
    slug,
    activeTables,
    qrTableIdParam,
    qrTableParam,
  ]);

  const handleSelectTableChoice = useCallback(
    (selection: {
      tableId: string | null;
      tableLabel: string;
      isTakeaway: boolean;
    }) => {
      setUserTableChoice({
        shopSlug: slug,
        tableId: selection.tableId,
        tableLabel: selection.tableLabel,
        isTakeaway: selection.isTakeaway,
      });
    },
    [slug]
  );

  const handleClosePopup = () => {
    setIsPromoPopupOpen(false);
    if (shop && typeof window !== 'undefined') {
      sessionStorage.setItem(`qlaok_popup_seen_${shop.id}`, '1');
    }
  };

  // Compute effective items with Flash Sale / Selected Item Discounts applied
  const effectiveItems: CatalogItem[] = useMemo(() => {
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

  // Keep cart item prices/snapshots synced with latest effective catalog without resetting cart
  useEffect(() => {
    if (effectiveItems.length === 0) return;
    setCart((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((entry) => {
        const latest = effectiveItems.find((i) => i.id === entry.item.id);
        if (latest && latest !== entry.item) {
          changed = true;
          return { ...entry, item: latest };
        }
        return entry;
      });
      return changed ? next : prev;
    });
  }, [effectiveItems]);

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
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {locale === 'vi'
            ? 'Đang tải thực đơn đa ngôn ngữ...'
            : 'Loading multilingual menu...'}
        </p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center space-y-3">
        <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
          {locale === 'vi'
            ? 'Không tìm thấy thực đơn cửa hàng'
            : 'Storefront menu not found'}
        </h1>
        <Link
          href="/explore"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
        >
          {locale === 'vi' ? 'Quay lại trang khám phá' : 'Back to Explore'}
        </Link>
      </div>
    );
  }

  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const tx = (vi: string, en: string) => (locale === 'vi' ? vi : en);
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
    <div
      className={`flex flex-1 flex-col min-h-screen ${bgProps.containerClass}`}
    >
      {bgProps.backgroundLayer}

      {/* Top Header with Back to Store Info, Theme Toggle & Compact Language Dropdown */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-2xs text-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href={`/s/${shop.slug}?lang=${locale}`}
              className="flex items-center gap-2 min-w-0"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                <ArrowLeft className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                  {shop.name}
                </h1>
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {labels.backToStore}
                  {shop.wifi_info?.ssid ? ` • 📶 ${shop.wifi_info.ssid}` : ''}
                </p>
              </div>
            </Link>

            {hasActivePopup && (
              <button
                type="button"
                onClick={() => setIsPromoPopupOpen(true)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-700 hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300"
              >
                <Gift className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                <span>{tx('Ưu đãi', 'Promos')}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <ThemeToggle compact />
            <LanguageSwitcher
              currentLocale={locale}
              supportedLangs={allowedLangs}
              onChange={setLocale}
              compact
            />
          </div>
        </div>

        {/* Configured Table / Takeaway Selector Bar */}
        <div
          data-testid="menu-table-selector-bar"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3.5 pb-2"
        >
          <span className="shrink-0 text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-0.5">
            {tx('Vị trí:', 'Table:')}
          </span>
          {activeTables.map((tb) => {
            const active =
              !tableState.isTakeawaySelected &&
              tableState.selectedTableId === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                aria-pressed={active}
                data-testid={`menu-table-chip-${tb.id}`}
                onClick={() =>
                  handleSelectTableChoice({
                    tableId: tb.id,
                    tableLabel: tb.name,
                    isTakeaway: false,
                  })
                }
                className={`shrink-0 inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950'
                    : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Utensils className="h-3 w-3" />
                <span>{tb.name}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={tableState.isTakeawaySelected}
            data-testid="menu-table-chip-takeaway"
            onClick={() =>
              handleSelectTableChoice({
                tableId: null,
                tableLabel: 'Mang về',
                isTakeaway: true,
              })
            }
            className={`shrink-0 inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
              tableState.isTakeawaySelected
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950'
                : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <ShoppingBag className="h-3 w-3" />
            <span>{formatTableLabel('Mang về', locale)}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="px-3.5 pb-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <label htmlFor="storefront-menu-search" className="sr-only">
              {labels.searchPlaceholder}
            </label>
            <input
              id="storefront-menu-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              className="w-full rounded-xl border border-slate-200 bg-slate-100/80 pl-9 pr-8 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100 dark:focus:bg-slate-800"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label={tx('Xóa từ khóa tìm kiếm', 'Clear search')}
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
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
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {tField(cat.name_i18n, locale)}
              </button>
            );
          })}
        </div>
      </header>

      {/* Invalid / Inactive / Foreign QR Table Warning Banner */}
      {tableState.error && (
        <div
          role="alert"
          data-testid="menu-table-resolution-warning"
          className="relative z-10 mx-3.5 mt-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3.5 text-amber-950 shadow-sm dark:border-amber-500/60 dark:bg-amber-950/80 dark:text-amber-100 space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-black text-amber-900 dark:text-amber-300">
                {tx(
                  'Mã QR bàn không khả dụng — vui lòng chọn lại bàn hoặc Mang về',
                  'Table QR unavailable — please select an active table or Takeaway'
                )}
              </p>
              <p className="text-xs font-medium leading-relaxed">
                {tableState.error}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {activeTables.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() =>
                  handleSelectTableChoice({
                    tableId: tb.id,
                    tableLabel: tb.name,
                    isTakeaway: false,
                  })
                }
                className="inline-flex items-center gap-1 rounded-xl border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
              >
                <Utensils className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                <span>{tb.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                handleSelectTableChoice({
                  tableId: null,
                  tableLabel: 'Mang về',
                  isTakeaway: true,
                })
              }
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-500"
            >
              <ShoppingBag className="h-3 w-3" />
              <span>{formatTableLabel('Mang về', locale)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Tables Load Error Banner */}
      {tablesLoadError && (
        <div
          role="alert"
          data-testid="menu-tables-load-error"
          className="relative z-10 mx-3.5 mt-3 flex items-center justify-between gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/70 dark:text-rose-200"
        >
          <span>⚠️ {tablesLoadError}</span>
          <button
            type="button"
            onClick={() => fetchCatalogData(false)}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-rose-500"
          >
            <RefreshCw className="h-3 w-3" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      )}

      {/* Active Order Realtime Banner if Guest Just Sent an Order */}
      {lastOrder && (
        <div className="relative z-10 mx-3.5 mt-3">
          <button
            type="button"
            onClick={() => setIsStaffModalOpen(true)}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-emerald-500/40 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-left text-slate-900 dark:text-white shadow-md"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 animate-ping" />
              <div className="min-w-0">
                <p className="truncate text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                  {labels.liveOrderSentPrefix}#{lastOrder.order_code} •{' '}
                  {formatTableLabel(lastOrder.table_label, locale)}
                  {labels.liveOrderSentSuffix}
                </p>
                <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">
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
                      ? (
                          PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi
                        ).savedDiscount(
                          formatCurrency(
                            promoCalc.discountAmount,
                            shop.currency
                          )
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
        tables={activeTables}
        selectedTableId={tableState.selectedTableId}
        isTakeawaySelected={tableState.isTakeawaySelected}
        tableResolutionError={tableState.error}
        tablesLoadError={tablesLoadError}
        onSelectTable={handleSelectTableChoice}
        onRetryLoadTables={() => fetchCatalogData(false)}
        initialTableLabel={
          tableState.selectedTable?.name ||
          (tableState.isTakeawaySelected ? 'Mang về' : '')
        }
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
