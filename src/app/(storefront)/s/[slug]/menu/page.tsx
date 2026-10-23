'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  X,
  Gift,
  ShoppingBag,
  AlertTriangle,
  RefreshCw,
  Lock,
  Clock,
} from 'lucide-react';
import {
  CartSelection,
  CatalogItem,
  Category,
  ServiceRequestType,
  Shop,
  ShopOrder,
  ShopTable,
  SupportedLocale,
} from '@/types/qlaok';
import {
  checkShopOpenStatus,
  DEFAULT_STOREFRONT_LOCALES,
  detectVisitorLocale,
  formatCurrency,
  formatTableLabel,
  getGuestOrderLabels,
  getTableServiceRequestLabels,
  localizeStorefrontTableError,
  normalizeShopSupportedLangs,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import {
  buildStorefrontTableQueryKey,
  buildTableQrVerificationKey,
  canUseStorefrontTableServiceActions,
  createScopedTableQrVerification,
  filterSelectableTables,
  resolveScopedTableQrVerification,
  resolveStorefrontCanonicalRedirect,
  resolveStorefrontMenuTableState,
  shouldRefreshStorefrontCatalog,
  STOREFRONT_MENU_POLL_INTERVAL_MS,
  STOREFRONT_MENU_STALE_REFRESH_MS,
  type ScopedTableQrVerification,
  type StorefrontTableChoice,
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

/** Persisted guest active order (per shop) so tracker / edit / VietQR survive reloads. */
interface StoredGuestOrder {
  orderId: string;
  trackingToken: string;
  orderCode: string;
  savedAt: number;
}

const GUEST_ORDER_STORAGE_PREFIX = 'qlaok_guest_order_';
const GUEST_ORDER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function guestOrderStorageKey(shopId: string) {
  return `${GUEST_ORDER_STORAGE_PREFIX}${shopId}`;
}

function readStoredGuestOrder(shopId: string): StoredGuestOrder | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(guestOrderStorageKey(shopId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGuestOrder>;
    if (
      typeof parsed?.orderId !== 'string' ||
      typeof parsed?.trackingToken !== 'string' ||
      !parsed.orderId ||
      !parsed.trackingToken
    ) {
      return null;
    }
    if (
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt > GUEST_ORDER_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(guestOrderStorageKey(shopId));
      return null;
    }
    return {
      orderId: parsed.orderId,
      trackingToken: parsed.trackingToken,
      orderCode: typeof parsed.orderCode === 'string' ? parsed.orderCode : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeStoredGuestOrder(shopId: string, order: ShopOrder) {
  if (typeof window === 'undefined' || !order.id || !order.tracking_token) return;
  try {
    const existing = readStoredGuestOrder(shopId);
    const payload: StoredGuestOrder = {
      orderId: order.id,
      trackingToken: order.tracking_token,
      orderCode: order.order_code || '',
      savedAt:
        existing && existing.orderId === order.id ? existing.savedAt : Date.now(),
    };
    window.localStorage.setItem(
      guestOrderStorageKey(shopId),
      JSON.stringify(payload)
    );
  } catch {
    // storage unavailable (private mode / quota) — tracker still works in-memory
  }
}

function clearStoredGuestOrder(shopId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(guestOrderStorageKey(shopId));
  } catch {
    // ignore
  }
}

export default function StorefrontMenuPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug || 'pho-hoi-an';

  const qrTableIdParam = searchParams.get('tableId');
  const qrTableSigParam = searchParams.get('sig');
  const qrTableParam = searchParams.get('table');
  const langParam = searchParams.get('lang');
  const srcParam = searchParams.get('src');
  // Only real table-QR entries count as scan_table (door page already logged scan_door)
  const isTableQrEntry =
    srcParam !== 'door' &&
    (srcParam === 'table' || Boolean(qrTableIdParam) || Boolean(qrTableParam));

  const [shop, setShop] = useState<Shop | null>(null);
  const [resolvedRequestSlug, setResolvedRequestSlug] = useState<string | null>(
    null
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [tables, setTables] = useState<ShopTable[]>([]);
  const [tablesLoadError, setTablesLoadError] = useState<string | null>(null);
  const [tableQrVerification, setTableQrVerification] =
    useState<ScopedTableQrVerification | null>(null);
  const [allowedLangs, setAllowedLangs] = useState<SupportedLocale[]>(
    DEFAULT_STOREFRONT_LOCALES
  );
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
    useState<StorefrontTableChoice | null>(null);
  const [submittingServiceRequest, setSubmittingServiceRequest] =
    useState<ServiceRequestType | null>(null);
  const [serviceRequestFeedback, setServiceRequestFeedback] = useState<{
    kind: 'sent' | 'deduplicated' | 'error';
    requestType: ServiceRequestType;
    tableLabel: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // Minute ticker so the opening-hours banner flips without a reload
  const [clockTick, setClockTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const currentVerificationKey = useMemo(
    () =>
      buildTableQrVerificationKey({
        shopSlug: slug,
        tableId: qrTableIdParam,
        sig: qrTableSigParam,
      }),
    [slug, qrTableIdParam, qrTableSigParam]
  );
  const currentTableQueryKey = useMemo(
    () =>
      buildStorefrontTableQueryKey({
        shopSlug: slug,
        tableId: qrTableIdParam,
        sig: qrTableSigParam,
        table: qrTableParam,
      }),
    [slug, qrTableIdParam, qrTableSigParam, qrTableParam]
  );

  const activeSlugRef = useRef(slug);
  const activeTableIdRef = useRef(qrTableIdParam);
  const activeTableSigRef = useRef(qrTableSigParam);
  const activeVerificationKeyRef = useRef(currentVerificationKey);
  activeSlugRef.current = slug;
  activeTableIdRef.current = qrTableIdParam;
  activeTableSigRef.current = qrTableSigParam;
  activeVerificationKeyRef.current = currentVerificationKey;

  const previousSlugRef = useRef(slug);
  const previousTableQueryKeyRef = useRef(currentTableQueryKey);
  const restoredOrderShopRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const initializedSlugRef = useRef<string | null>(null);
  const trackedTableScanKeyRef = useRef<string | null>(null);
  const inFlightFetchRef = useRef(false);
  const lastFetchedAtRef = useRef(0);

  // Reset shop-scoped cart/order/selection state when navigating to a different shop slug,
  // and clear stale table QR verification / manual choice when table query params change on the same slug.
  useEffect(() => {
    const slugChanged = previousSlugRef.current !== slug;
    const tableQueryChanged =
      previousTableQueryKeyRef.current !== currentTableQueryKey;

    if (slugChanged) {
      const prevNormalized = previousSlugRef.current.trim().toLowerCase();
      const nextNormalized = slug.trim().toLowerCase();
      const isCanonicalizingSameShop =
        Boolean(shop?.slug) &&
        shop?.slug.trim().toLowerCase() === nextNormalized &&
        resolvedRequestSlug === prevNormalized;

      previousSlugRef.current = slug;
      previousTableQueryKeyRef.current = currentTableQueryKey;

      if (isCanonicalizingSameShop) {
        setResolvedRequestSlug(nextNormalized);
        return;
      }

      setCart([]);
      setLastOrder(null);
      setEditingOrder(null);
      setUserTableChoice(null);
      setServiceRequestFeedback(null);
      setSelectedCategoryId('all');
      setSearchQuery('');
      setTables([]);
      setTablesLoadError(null);
      setTableQrVerification(null);
      setResolvedRequestSlug(null);
      setLoading(true);
      return;
    }

    if (tableQueryChanged) {
      previousTableQueryKeyRef.current = currentTableQueryKey;
      setUserTableChoice(null);
      setServiceRequestFeedback(null);
      setTableQrVerification((prev) => {
        if (!prev) return null;
        const stillMatches =
          resolveScopedTableQrVerification(prev, {
            shopSlug: slug,
            shopId: shop?.id,
            tableId: qrTableIdParam,
            sig: qrTableSigParam,
          }) !== null;
        return stillMatches ? prev : null;
      });
    }
  }, [
    slug,
    currentTableQueryKey,
    qrTableIdParam,
    qrTableSigParam,
    resolvedRequestSlug,
    shop?.id,
    shop?.slug,
  ]);

  const fetchCatalogData = useCallback(
    async (isInitial = false) => {
      const currentSlug = slug;
      const requestedTableId = (qrTableIdParam ?? '').trim();
      const requestedTableSig = (qrTableSigParam ?? '').trim();
      const requestedVerificationKey = buildTableQrVerificationKey({
        shopSlug: currentSlug,
        tableId: requestedTableId,
        sig: requestedTableSig,
      });
      const seq = ++requestSeqRef.current;
      const isStaleRequest = () =>
        activeSlugRef.current !== currentSlug ||
        activeVerificationKeyRef.current !== requestedVerificationKey ||
        seq !== requestSeqRef.current;

      try {
        inFlightFetchRef.current = true;
        const shopUrlParams = new URLSearchParams({
          slug: currentSlug,
          view: 'menu',
        });
        if (requestedTableId) {
          shopUrlParams.set('tableId', requestedTableId);
          if (requestedTableSig) {
            shopUrlParams.set('sig', requestedTableSig);
          }
        }
        const res = await fetch(`/api/shops?${shopUrlParams.toString()}`, {
          cache: 'no-store',
        });
        if (isStaleRequest()) {
          return;
        }
        if (!res.ok) {
          if (isInitial) setLoading(false);
          return;
        }
        const data = await res.json();
        if (isStaleRequest()) {
          return;
        }
        lastFetchedAtRef.current = Date.now();

        const loadedShop: Shop = data.shop;
        // Respect the shop's configured supported_langs (default ['vi','en']), capped by plan
        const planLangs = getAllowedLocalesForPlan(
          data.ownerPlan || 'free',
          normalizeShopSupportedLangs(loadedShop.supported_langs)
        );

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

        if (isStaleRequest()) {
          return;
        }

        const activeOnlyTables = loadedTables.filter(
          (t) =>
            t &&
            t.shop_id === loadedShop.id &&
            Boolean(t.is_active) &&
            !t.is_archived
        );

        const canonicalRedirect = resolveStorefrontCanonicalRedirect({
          requestedSlug: currentSlug,
          canonicalSlug: loadedShop.slug,
          view: 'menu',
          searchParams: searchParams.toString(),
        });

        setShop(loadedShop);
        setResolvedRequestSlug(currentSlug.trim().toLowerCase());
        setCategories(data.categories || []);
        setItems(data.items || []);
        setTables(activeOnlyTables);
        setTableQrVerification(
          createScopedTableQrVerification({
            shopSlug: currentSlug,
            canonicalSlug: loadedShop.slug,
            shopId: loadedShop.id,
            tableId: requestedTableId,
            sig: requestedTableSig,
            tableQrVerified:
              typeof data.tableQrVerified === 'boolean'
                ? data.tableQrVerified
                : null,
            activeSlug: activeSlugRef.current,
            activeTableId: activeTableIdRef.current,
            activeSig: activeTableSigRef.current,
          })
        );
        setAllowedLangs(planLangs);

        if (canonicalRedirect?.isAlias) {
          router.replace(canonicalRedirect.canonicalUrl);
        }

        if (isInitial || initializedSlugRef.current !== loadedShop.id) {
          initializedSlugRef.current = loadedShop.id;
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

          // Track QR Table Scan (skip door-page / explore navigation to avoid double counting)
          const tableScanKey = `${loadedShop.id}:${requestedTableId}:${requestedTableSig}:${qrTableParam || ''}`;
          if (isTableQrEntry && trackedTableScanKeyRef.current !== tableScanKey) {
            trackedTableScanKeyRef.current = tableScanKey;
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
        }
      } catch (err) {
        console.error('Failed to fetch storefront menu:', err);
        if (isInitial && activeSlugRef.current === currentSlug) {
          setLoading(false);
        }
      } finally {
        if (seq === requestSeqRef.current) {
          inFlightFetchRef.current = false;
        }
      }
    },
    [
      slug,
      router,
      searchParams,
      langParam,
      isTableQrEntry,
      qrTableIdParam,
      qrTableSigParam,
      qrTableParam,
    ]
  );

  useEffect(() => {
    lastFetchedAtRef.current = 0;
    fetchCatalogData(true);

    const refreshIfEligible = (minAgeMs: number) => {
      const visibilityState =
        typeof document !== 'undefined' ? document.visibilityState : 'visible';
      const isOnline =
        typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
          ? navigator.onLine
          : true;
      if (
        shouldRefreshStorefrontCatalog({
          visibilityState,
          isOnline,
          isFetchInFlight: inFlightFetchRef.current,
          lastFetchedAtMs: lastFetchedAtRef.current,
          nowMs: Date.now(),
          minAgeMs,
        })
      ) {
        void fetchCatalogData(false);
      }
    };

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = () => {
        void fetchCatalogData(false);
      };
    }

    const handleVisibilityOrFocus = () => {
      refreshIfEligible(STOREFRONT_MENU_STALE_REFRESH_MS);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
      window.addEventListener('online', handleVisibilityOrFocus);
    }

    const interval = setInterval(() => {
      refreshIfEligible(STOREFRONT_MENU_POLL_INTERVAL_MS);
    }, STOREFRONT_MENU_POLL_INTERVAL_MS);

    return () => {
      if (bc) bc.close();
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityOrFocus
        );
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
        window.removeEventListener('online', handleVisibilityOrFocus);
      }
      clearInterval(interval);
    };
  }, [fetchCatalogData]);

  // Refresh catalog/table availability when opening the order modal if data is stale
  useEffect(() => {
    if (!isStaffModalOpen) return;
    const visibilityState =
      typeof document !== 'undefined' ? document.visibilityState : 'visible';
    const isOnline =
      typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;
    if (
      shouldRefreshStorefrontCatalog({
        visibilityState,
        isOnline,
        isFetchInFlight: inFlightFetchRef.current,
        lastFetchedAtMs: lastFetchedAtRef.current,
        nowMs: Date.now(),
        minAgeMs: STOREFRONT_MENU_STALE_REFRESH_MS,
      })
    ) {
      void fetchCatalogData(false);
    }
  }, [isStaffModalOpen, fetchCatalogData]);

  const normalizedCurrentSlug = slug.trim().toLowerCase();
  const currentShopId =
    shop &&
    (!shop.slug ||
      shop.slug.trim().toLowerCase() === normalizedCurrentSlug ||
      resolvedRequestSlug === normalizedCurrentSlug)
      ? shop.id
      : null;

  // Active tables sorted for display
  const activeTables = useMemo(() => {
    if (!currentShopId) return [];
    return filterSelectableTables(tables, currentShopId);
  }, [tables, currentShopId]);

  // Resolve QR table parameters (?tableId=...&sig=... or ?table=...) and table lock
  // scoped to the exact current shop/slug + tableId + sig so stale or in-flight responses never lock a table.
  const tableState = useMemo(
    () =>
      resolveStorefrontMenuTableState({
        shopSlug: slug,
        shopId: currentShopId,
        tables: activeTables,
        qrTableIdParam,
        qrTableSigParam,
        qrTableParam,
        verification: tableQrVerification,
        userTableChoice,
        locale,
      }),
    [
      slug,
      currentShopId,
      activeTables,
      qrTableIdParam,
      qrTableSigParam,
      qrTableParam,
      tableQrVerification,
      userTableChoice,
      locale,
    ]
  );

  const lockedTable = tableState.lockedTable;

  const localizedTablesLoadError = useMemo(
    () => localizeStorefrontTableError(tablesLoadError, locale),
    [tablesLoadError, locale]
  );

  const handleSelectTableChoice = useCallback(
    (selection: {
      tableId: string | null;
      tableLabel: string;
      isTakeaway: boolean;
    }) => {
      setUserTableChoice({
        shopSlug: slug,
        tableQueryKey: currentTableQueryKey,
        tableId: selection.tableId,
        tableLabel: selection.tableLabel,
        isTakeaway: selection.isTakeaway,
      });
    },
    [slug, currentTableQueryKey]
  );

  // Restore a persisted guest order (per shop) after reload so tracker/edit/VietQR survive
  useEffect(() => {
    if (!shop?.id || restoredOrderShopRef.current === shop.id) return;
    restoredOrderShopRef.current = shop.id;
    const stored = readStoredGuestOrder(shop.id);
    if (!stored) return;
    const shopId = shop.id;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/orders?orderId=${encodeURIComponent(stored.orderId)}`,
          {
            headers: { 'x-tracking-token': stored.trackingToken },
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        if (res.status === 403 || res.status === 404) {
          clearStoredGuestOrder(shopId);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.order || data.order.shop_id !== shopId) {
          clearStoredGuestOrder(shopId);
          return;
        }
        if (activeSlugRef.current !== slug) return;
        setLastOrder((prev) =>
          prev ? prev : { ...data.order, tracking_token: stored.trackingToken }
        );
      } catch {
        // offline / aborted — keep stored order for the next load
      }
    })();
    return () => controller.abort();
  }, [shop?.id, slug]);

  // Persist the active guest order whenever it changes
  useEffect(() => {
    if (!shop?.id || !lastOrder?.id || !lastOrder.tracking_token) return;
    if (lastOrder.shop_id && lastOrder.shop_id !== shop.id) return;
    writeStoredGuestOrder(shop.id, lastOrder);
  }, [shop?.id, lastOrder]);

  const handleDismissGuestOrder = useCallback(() => {
    if (shop?.id) clearStoredGuestOrder(shop.id);
    setLastOrder(null);
    setEditingOrder(null);
  }, [shop?.id]);

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

  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 space-y-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {labels.loadingMenu}
        </p>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center space-y-3">
        <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
          {labels.menuNotFoundTitle}
        </h1>
        <Link
          href="/explore"
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
        >
          {labels.backToExplore}
        </Link>
      </div>
    );
  }

  const primaryColor = shop.theme_config?.primaryColor || '#10b981';
  const bgProps = getStorefrontBackgroundProps(shop);
  const guestLabels = getGuestOrderLabels(locale);
  const serviceReqLabels = getTableServiceRequestLabels(locale);
  const openStatus = checkShopOpenStatus(shop.opening_hours, {
    now: new Date(clockTick),
  });
  const isShopClosed = !openStatus.isOpen;
  const canUseTableServiceActions = canUseStorefrontTableServiceActions({
    lockedTable,
    tableQrVerified: tableState.tableQrVerified,
    isTakeawaySelected: tableState.isTakeawaySelected,
    error: tableState.error,
    qrTableSigParam,
  });

  const handleSubmitServiceRequest = async (requestType: ServiceRequestType) => {
    if (
      !canUseTableServiceActions ||
      !lockedTable ||
      !shop?.id ||
      !qrTableSigParam ||
      submittingServiceRequest
    ) {
      return;
    }

    setSubmittingServiceRequest(requestType);
    try {
      const res = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          table_id: lockedTable.id,
          table_qr_sig: qrTableSigParam.trim(),
          request_type: requestType,
          visitor_lang: locale,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.serviceRequest) {
        setServiceRequestFeedback({
          kind: 'error',
          requestType,
          tableLabel: lockedTable.name,
        });
        return;
      }

      setServiceRequestFeedback({
        kind: data.deduplicated ? 'deduplicated' : 'sent',
        requestType,
        tableLabel: data.serviceRequest.table_label || lockedTable.name,
      });

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        try {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({
            type: 'service_request_created',
            shopId: shop.id,
            serviceRequestId: data.serviceRequest.id,
          });
          bc.close();
        } catch {
          // ignore
        }
      }
    } catch {
      setServiceRequestFeedback({
        kind: 'error',
        requestType,
        tableLabel: lockedTable.name,
      });
    } finally {
      setSubmittingServiceRequest(null);
    }
  };
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
                <span>{labels.promosShort}</span>
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

        {/* Configured Table / Takeaway Selector Bar (locked when a valid QR tableId is present) */}
        {lockedTable ? (
          <div
            data-testid="menu-table-locked-bar"
            className="px-3.5 pb-2 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-0.5">
                  {labels.tableSelectorLabel}
                </span>
                <span
                  data-testid="menu-table-locked-chip"
                  className="inline-flex items-center gap-1 rounded-xl border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950"
                >
                  <Lock className="h-3 w-3" />
                  <span>{lockedTable.name}</span>
                </span>
                <span className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {guestLabels.tableLockedHint}
                </span>
              </div>

              {canUseTableServiceActions && (
                <div
                  data-testid="menu-table-service-actions"
                  className="flex items-center gap-1.5 shrink-0"
                >
                  <button
                    type="button"
                    data-testid="menu-service-request-call-staff"
                    disabled={submittingServiceRequest !== null}
                    onClick={() => handleSubmitServiceRequest('call_staff')}
                    className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-extrabold text-amber-900 shadow-2xs transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60"
                  >
                    <span>
                      {submittingServiceRequest === 'call_staff'
                        ? serviceReqLabels.sending
                        : serviceReqLabels.callStaffBtn}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="menu-service-request-request-bill"
                    disabled={submittingServiceRequest !== null}
                    onClick={() => handleSubmitServiceRequest('request_bill')}
                    className="inline-flex items-center gap-1 rounded-xl border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-[11px] font-extrabold text-indigo-900 shadow-2xs transition hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/40 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
                  >
                    <span>
                      {submittingServiceRequest === 'request_bill'
                        ? serviceReqLabels.sending
                        : serviceReqLabels.requestBillBtn}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {canUseTableServiceActions && serviceRequestFeedback && (
              <div
                role="status"
                data-testid="menu-service-request-feedback"
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5 text-[11px] font-bold ${
                  serviceRequestFeedback.kind === 'error'
                    ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-950/60 dark:text-rose-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-200'
                }`}
              >
                <span>
                  {serviceRequestFeedback.kind === 'error'
                    ? serviceReqLabels.requestError
                    : serviceRequestFeedback.kind === 'deduplicated'
                      ? serviceReqLabels.alreadyRequestedNotice(
                          serviceRequestFeedback.tableLabel
                        )
                      : serviceRequestFeedback.requestType === 'request_bill'
                        ? serviceReqLabels.requestBillSentToast(
                            serviceRequestFeedback.tableLabel
                          )
                        : serviceReqLabels.callStaffSentToast(
                            serviceRequestFeedback.tableLabel
                          )}
                </span>
                <button
                  type="button"
                  onClick={() => setServiceRequestFeedback(null)}
                  className="shrink-0 rounded-lg p-0.5 text-current opacity-70 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div
            data-testid="menu-table-selector-bar"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-3.5 pb-2"
          >
            <span className="shrink-0 text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-0.5">
              {labels.tableSelectorLabel}
            </span>
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
            <span
              data-testid="menu-rescan-table-qr-hint"
              className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400"
            >
              {guestLabels.rescanTableQrHint}
            </span>
          </div>
        )}

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
                aria-label={labels.clearSearchAria}
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
                {labels.tableQrUnavailableTitle}
              </p>
              <p className="text-xs font-medium leading-relaxed">
                {tableState.error}
              </p>
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                {guestLabels.rescanTableQrHint}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
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

      {/* Shop Closed Banner (server also rejects guest orders with SHOP_CLOSED) */}
      {isShopClosed && (
        <div
          role="status"
          data-testid="menu-shop-closed-banner"
          className="relative z-10 mx-3.5 mt-3 flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/70 dark:text-rose-100"
        >
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="space-y-0.5">
            <p className="text-xs font-black">{guestLabels.shopClosedTitle}</p>
            <p className="text-[11px] font-medium leading-relaxed">
              {openStatus.todaySchedule.closed
                ? guestLabels.shopClosedDayOff
                : guestLabels.shopClosedSub(
                    openStatus.todaySchedule.open,
                    openStatus.todaySchedule.close
                  )}
            </p>
          </div>
        </div>
      )}

      {/* Tables Load Error Banner */}
      {localizedTablesLoadError && (
        <div
          role="alert"
          data-testid="menu-tables-load-error"
          className="relative z-10 mx-3.5 mt-3 flex items-center justify-between gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/70 dark:text-rose-200"
        >
          <span>⚠️ {localizedTablesLoadError}</span>
          <button
            type="button"
            onClick={() => fetchCatalogData(false)}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-rose-500"
          >
            <RefreshCw className="h-3 w-3" />
            <span>{labels.retryBtn}</span>
          </button>
        </div>
      )}

      {/* Active Order Realtime Banner if Guest Just Sent an Order */}
      {lastOrder && (
        <div className="relative z-10 mx-3.5 mt-3">
          <button
            type="button"
            data-testid="menu-live-order-banner"
            onClick={() => setIsStaffModalOpen(true)}
            className={`flex w-full items-center justify-between gap-2 rounded-2xl border bg-white dark:bg-slate-900 px-3.5 py-2.5 text-left text-slate-900 dark:text-white shadow-md ${
              lastOrder.status === 'cancelled'
                ? 'border-rose-400/60'
                : 'border-emerald-500/40'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`flex h-2.5 w-2.5 shrink-0 rounded-full ${
                  lastOrder.status === 'cancelled'
                    ? 'bg-rose-500'
                    : lastOrder.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-emerald-500 animate-ping'
                }`}
              />
              <div className="min-w-0">
                {lastOrder.status === 'cancelled' ? (
                  <p className="truncate text-xs font-extrabold text-rose-700 dark:text-rose-400">
                    #{lastOrder.order_code} • {guestLabels.statusCancelledTitle}
                  </p>
                ) : lastOrder.status === 'completed' ? (
                  <p className="truncate text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                    #{lastOrder.order_code} • {guestLabels.thankYouTitle}
                  </p>
                ) : (
                  <p className="truncate text-xs font-extrabold text-emerald-700 dark:text-emerald-400">
                    {labels.liveOrderSentPrefix}#{lastOrder.order_code} •{' '}
                    {formatTableLabel(lastOrder.table_label, locale)}
                    {labels.liveOrderSentSuffix}
                  </p>
                )}
                <p className="truncate text-[11px] text-slate-600 dark:text-slate-300">
                  {lastOrder.payment_status === 'paid'
                    ? `✓ ${guestLabels.paidBadge}`
                    : labels.liveOrderBannerSub}
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-xl px-2.5 py-1 text-[11px] font-black ${
                lastOrder.status === 'cancelled'
                  ? 'bg-rose-500 text-white'
                  : 'bg-emerald-500 text-slate-950'
              }`}
            >
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
        lockedTable={lockedTable}
        tableQrSignature={
          tableState.tableQrVerified === true ? qrTableSigParam : null
        }
        isTableQrEntry={Boolean(lockedTable)}
        isShopClosed={isShopClosed}
        selectedTableId={tableState.selectedTableId}
        isTakeawaySelected={tableState.isTakeawaySelected}
        tableResolutionError={tableState.error}
        tablesLoadError={localizedTablesLoadError}
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
        onDismissOrder={handleDismissGuestOrder}
      />
    </div>
  );
}
