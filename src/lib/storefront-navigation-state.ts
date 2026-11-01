import { createContext } from 'react';
import type {
  CatalogItem,
  Category,
  Post,
  Shop,
  ShopTable,
  SupportedLocale,
} from '@/types/qlaok';
import {
  DEFAULT_STOREFRONT_LOCALES,
  detectVisitorLocale,
  normalizeShopSupportedLangs,
} from '@/lib/i18n-helper';
import { getAllowedLocalesForPlan } from '@/lib/plan-limits';
import {
  buildStorefrontTableQueryKey,
  buildTableQrVerificationKey,
  createScopedTableQrVerification,
  resolveScopedTableQrVerification,
  resolveStorefrontCanonicalRedirect,
  serializeStorefrontSearchParams,
  type ScopedTableQrVerification,
  type StorefrontSearchParamsInput,
} from '@/lib/table-helpers';

export function normalizeStorefrontSlug(slug?: string | null): string {
  return (slug ?? '').trim().toLowerCase();
}

/**
 * Returns true only when `shop` was loaded for `currentSlug` (either directly via
 * `resolvedRequestSlug` or after canonical alias replacement to `shop.slug`).
 */
export function isStorefrontShopMatchingSlug(input: {
  shop: Pick<Shop, 'slug'> | null | undefined;
  resolvedRequestSlug: string | null | undefined;
  currentSlug: string | null | undefined;
}): boolean {
  const { shop } = input;
  if (!shop) return false;
  const target = normalizeStorefrontSlug(input.currentSlug);
  if (!target) return false;
  const resolved = normalizeStorefrontSlug(input.resolvedRequestSlug);
  if (resolved && resolved === target) {
    return true;
  }
  const canonical = normalizeStorefrontSlug(shop.slug);
  return Boolean(canonical) && canonical === target;
}

/**
 * Detects an in-place alias -> canonical slug replacement (`router.replace`)
 * for the shop already loaded in state so we preserve rendered content without flashing.
 */
export function isCanonicalizingLoadedShop(input: {
  shop: Pick<Shop, 'slug'> | null | undefined;
  resolvedRequestSlug: string | null | undefined;
  previousSlug: string | null | undefined;
  nextSlug: string | null | undefined;
}): boolean {
  const prev = normalizeStorefrontSlug(input.previousSlug);
  const next = normalizeStorefrontSlug(input.nextSlug);
  if (!prev || !next || prev === next) return false;
  const canonical = normalizeStorefrontSlug(input.shop?.slug);
  const resolved = normalizeStorefrontSlug(input.resolvedRequestSlug);
  return Boolean(canonical) && canonical === next && resolved === prev;
}

/**
 * Synchronously derives whether the current route `currentSlug` has a matching
 * loaded shop, is still loading, or settled in a terminal not-found/error state.
 * Because `currentSlug` is checked at render time, navigating to a new slug hides
 * the previous shop immediately—even before passive `useEffect` hooks run.
 */
export function resolveStorefrontSlugViewState<
  TShop extends Pick<Shop, 'id' | 'slug'>,
>(input: {
  currentSlug: string;
  shop: TShop | null;
  resolvedRequestSlug: string | null;
  failedRequestSlug: string | null;
  loading: boolean;
}): {
  activeShop: TShop | null;
  isLoading: boolean;
  isNotFound: boolean;
} {
  const normalizedTarget = normalizeStorefrontSlug(input.currentSlug);
  const matches = isStorefrontShopMatchingSlug({
    shop: input.shop,
    resolvedRequestSlug: input.resolvedRequestSlug,
    currentSlug: normalizedTarget,
  });
  const activeShop = matches ? input.shop : null;
  if (activeShop) {
    return {
      activeShop,
      isLoading: false,
      isNotFound: false,
    };
  }

  const hasFailedForCurrentSlug =
    Boolean(normalizedTarget) &&
    normalizeStorefrontSlug(input.failedRequestSlug) === normalizedTarget &&
    !input.loading;

  if (hasFailedForCurrentSlug) {
    return {
      activeShop: null,
      isLoading: false,
      isNotFound: true,
    };
  }

  return {
    activeShop: null,
    isLoading: true,
    isNotFound: false,
  };
}

function defaultHasSeenWelcomePopup(shopId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.sessionStorage.getItem(`qlaok_popup_seen_${shopId}`));
  } catch {
    return false;
  }
}

function defaultMarkWelcomePopupSeen(shopId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`qlaok_popup_seen_${shopId}`, '1');
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

// ============================================================================
// Door Route (`/s/[slug]`) State & Request Coordinator
// ============================================================================

export interface StorefrontDoorBundleResponse {
  shop?: Shop | null;
  items?: CatalogItem[] | null;
  posts?: Post[] | null;
  ownerPlan?: string | null;
}

export interface StorefrontDoorState {
  activeSlug: string;
  shop: Shop | null;
  resolvedRequestSlug: string | null;
  failedRequestSlug: string | null;
  items: CatalogItem[];
  posts: Post[];
  allowedLangs: SupportedLocale[];
  locale: SupportedLocale;
  loading: boolean;
  isPromoPopupOpen: boolean;
}

export interface StorefrontDoorRenderState {
  shop: Shop | null;
  items: CatalogItem[];
  posts: Post[];
  allowedLangs: SupportedLocale[];
  locale: SupportedLocale;
  isLoading: boolean;
  isNotFound: boolean;
  isPromoPopupOpen: boolean;
}

export function resolveStorefrontDoorRenderState(
  state: StorefrontDoorState,
  currentSlug: string
): StorefrontDoorRenderState {
  const viewState = resolveStorefrontSlugViewState({
    currentSlug,
    shop: state.shop,
    resolvedRequestSlug: state.resolvedRequestSlug,
    failedRequestSlug: state.failedRequestSlug,
    loading: state.loading,
  });

  if (!viewState.activeShop) {
    return {
      shop: null,
      items: [],
      posts: [],
      allowedLangs: DEFAULT_STOREFRONT_LOCALES,
      locale: state.locale,
      isLoading: viewState.isLoading,
      isNotFound: viewState.isNotFound,
      isPromoPopupOpen: false,
    };
  }

  return {
    shop: viewState.activeShop,
    items: state.items,
    posts: state.posts,
    allowedLangs: state.allowedLangs,
    locale: state.locale,
    isLoading: false,
    isNotFound: false,
    isPromoPopupOpen: state.isPromoPopupOpen,
  };
}

export interface StorefrontDoorCoordinatorOptions {
  initialSlug?: string;
  fetchImpl?: typeof fetch;
  onReplaceUrl?: (url: string) => void;
  detectLocale?: (
    allowedLangs: SupportedLocale[],
    explicitQueryLang?: string | null
  ) => SupportedLocale;
  hasSeenWelcomePopup?: (shopId: string) => boolean;
  markWelcomePopupSeen?: (shopId: string) => void;
  trackDoorScan?: (payload: {
    shop_id: string;
    event_type: 'scan_door';
    visitor_lang: SupportedLocale;
  }) => void;
  onError?: (error: unknown) => void;
}

export interface StorefrontDoorRouteInput {
  slug: string;
  searchParams?: StorefrontSearchParamsInput;
  langParam?: string | null;
}

export interface StorefrontDoorCoordinator {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StorefrontDoorState;
  navigate(route: StorefrontDoorRouteInput): Promise<void>;
  refresh(): Promise<void>;
  setLocale(locale: SupportedLocale): void;
  setPromoPopupOpen(open: boolean): void;
  closePromoPopup(): void;
  cancelInFlight(): void;
}

export function createStorefrontDoorCoordinator(
  options: StorefrontDoorCoordinatorOptions = {}
): StorefrontDoorCoordinator {
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const detectLocale = options.detectLocale ?? detectVisitorLocale;
  const hasSeenWelcomePopup =
    options.hasSeenWelcomePopup ?? defaultHasSeenWelcomePopup;
  const markWelcomePopupSeen =
    options.markWelcomePopupSeen ?? defaultMarkWelcomePopupSeen;
  const trackDoorScan =
    options.trackDoorScan ??
    ((payload) => {
      fetchImpl('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    });
  const onError =
    options.onError ??
    ((err) => {
      console.error('Error loading storefront:', err);
    });

  const initialRawSlug =
    (options.initialSlug || 'pho-hoi-an').trim() || 'pho-hoi-an';

  let state: StorefrontDoorState = {
    activeSlug: initialRawSlug,
    shop: null,
    resolvedRequestSlug: null,
    failedRequestSlug: null,
    items: [],
    posts: [],
    allowedLangs: DEFAULT_STOREFRONT_LOCALES,
    locale: 'vi',
    loading: true,
    isPromoPopupOpen: false,
  };

  const listeners = new Set<() => void>();
  let activeRawSlug = initialRawSlug;
  let activeNormalizedSlug = normalizeStorefrontSlug(initialRawSlug);
  let activeSearchParams = '';
  let activeLangParam: string | null = null;
  let hasNavigatedOnce = false;
  let requestSeq = 0;
  let inFlightNormalizedSlug: string | null = null;
  let activeAbortController: AbortController | null = null;
  let initializedShopId: string | null = null;
  let lastTrackedScanShopId: string | null = null;

  const setState = (next: StorefrontDoorState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const cancelInFlight = () => {
    requestSeq += 1;
    inFlightNormalizedSlug = null;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  };

  const load = async (params: {
    requestedSlug: string;
    isInitial: boolean;
  }): Promise<void> => {
    const cleanRequestedSlug =
      (params.requestedSlug || 'pho-hoi-an').trim() || 'pho-hoi-an';
    const normalizedRequested = normalizeStorefrontSlug(cleanRequestedSlug);
    const seq = ++requestSeq;

    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortController = controller;
    inFlightNormalizedSlug = normalizedRequested;

    const isStale = (): boolean =>
      seq !== requestSeq || activeNormalizedSlug !== normalizedRequested;

    const hasMatchingLoadedShop = isStorefrontShopMatchingSlug({
      shop: state.shop,
      resolvedRequestSlug: state.resolvedRequestSlug,
      currentSlug: normalizedRequested,
    });

    if (params.isInitial || !hasMatchingLoadedShop) {
      setState({
        ...state,
        activeSlug: activeRawSlug,
        ...(hasMatchingLoadedShop
          ? {}
          : {
              shop: null,
              resolvedRequestSlug: null,
              items: [],
              posts: [],
              allowedLangs: DEFAULT_STOREFRONT_LOCALES,
              isPromoPopupOpen: false,
            }),
        failedRequestSlug: null,
        loading: true,
      });
    }

    try {
      const res = await fetchImpl(
        `/api/shops?slug=${encodeURIComponent(cleanRequestedSlug)}`,
        {
          cache: 'no-store',
          ...(controller ? { signal: controller.signal } : {}),
        }
      );

      if (isStale()) {
        return;
      }

      if (!res.ok) {
        const stillHasMatchingShop = isStorefrontShopMatchingSlug({
          shop: state.shop,
          resolvedRequestSlug: state.resolvedRequestSlug,
          currentSlug: normalizedRequested,
        });
        if (params.isInitial || !stillHasMatchingShop || res.status === 404) {
          setState({
            ...state,
            activeSlug: activeRawSlug,
            shop: null,
            resolvedRequestSlug: null,
            failedRequestSlug: normalizedRequested,
            items: [],
            posts: [],
            allowedLangs: DEFAULT_STOREFRONT_LOCALES,
            loading: false,
            isPromoPopupOpen: false,
          });
        }
        return;
      }

      const data = (await res.json()) as StorefrontDoorBundleResponse | null;
      if (isStale()) {
        return;
      }

      const loadedShop = data?.shop ?? null;
      if (!loadedShop || !loadedShop.id) {
        setState({
          ...state,
          activeSlug: activeRawSlug,
          shop: null,
          resolvedRequestSlug: null,
          failedRequestSlug: normalizedRequested,
          items: [],
          posts: [],
          allowedLangs: DEFAULT_STOREFRONT_LOCALES,
          loading: false,
          isPromoPopupOpen: false,
        });
        return;
      }

      const canonicalRedirect = resolveStorefrontCanonicalRedirect({
        requestedSlug: cleanRequestedSlug,
        canonicalSlug: loadedShop.slug,
        view: 'door',
        searchParams: activeSearchParams,
      });

      const planLangs = getAllowedLocalesForPlan(
        data?.ownerPlan || 'free',
        normalizeShopSupportedLangs(loadedShop.supported_langs)
      );

      const shouldInitializeForShop =
        params.isInitial || initializedShopId !== loadedShop.id;

      let nextLocale = state.locale;
      let nextPopupOpen = state.isPromoPopupOpen;

      if (shouldInitializeForShop) {
        initializedShopId = loadedShop.id;
        nextLocale = detectLocale(planLangs, activeLangParam);

        const popupCfg = loadedShop.theme_config?.welcomePopup;
        if (popupCfg?.enabled && popupCfg.title?.trim()) {
          nextPopupOpen = !hasSeenWelcomePopup(loadedShop.id);
        } else {
          nextPopupOpen = false;
        }
      } else if (!planLangs.includes(nextLocale)) {
        nextLocale = planLangs[0] || 'vi';
      }

      setState({
        activeSlug: activeRawSlug,
        shop: loadedShop,
        resolvedRequestSlug: normalizedRequested,
        failedRequestSlug: null,
        items: Array.isArray(data?.items) ? data.items : [],
        posts: Array.isArray(data?.posts) ? data.posts : [],
        allowedLangs: planLangs,
        locale: nextLocale,
        loading: false,
        isPromoPopupOpen: nextPopupOpen,
      });

      if (canonicalRedirect?.isAlias) {
        options.onReplaceUrl?.(canonicalRedirect.canonicalUrl);
      }

      if (
        shouldInitializeForShop &&
        lastTrackedScanShopId !== loadedShop.id
      ) {
        lastTrackedScanShopId = loadedShop.id;
        trackDoorScan({
          shop_id: loadedShop.id,
          event_type: 'scan_door',
          visitor_lang: nextLocale,
        });
      }
    } catch (err) {
      if (controller?.signal.aborted || isStale()) {
        return;
      }
      onError(err);
      const stillHasMatchingShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: normalizedRequested,
      });
      if (params.isInitial || !stillHasMatchingShop) {
        setState({
          ...state,
          activeSlug: activeRawSlug,
          shop: null,
          resolvedRequestSlug: null,
          failedRequestSlug: normalizedRequested,
          items: [],
          posts: [],
          allowedLangs: DEFAULT_STOREFRONT_LOCALES,
          loading: false,
          isPromoPopupOpen: false,
        });
      }
    } finally {
      if (seq === requestSeq) {
        inFlightNormalizedSlug = null;
      }
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
    navigate(route) {
      const nextRawSlug = (route.slug || 'pho-hoi-an').trim() || 'pho-hoi-an';
      const nextNormalized = normalizeStorefrontSlug(nextRawSlug);
      const nextSearchParams = serializeStorefrontSearchParams(
        route.searchParams
      );
      const nextLangParam =
        route.langParam !== undefined
          ? route.langParam
          : new URLSearchParams(nextSearchParams).get('lang');

      if (!hasNavigatedOnce) {
        hasNavigatedOnce = true;
        activeRawSlug = nextRawSlug;
        activeNormalizedSlug = nextNormalized;
        activeSearchParams = nextSearchParams;
        activeLangParam = nextLangParam;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      const prevNormalized = activeNormalizedSlug;
      const prevSearchParams = activeSearchParams;
      const prevLangParam = activeLangParam;

      if (nextNormalized !== prevNormalized) {
        const canonicalizing = isCanonicalizingLoadedShop({
          shop: state.shop,
          resolvedRequestSlug: state.resolvedRequestSlug,
          previousSlug: prevNormalized,
          nextSlug: nextNormalized,
        });

        activeRawSlug = nextRawSlug;
        activeNormalizedSlug = nextNormalized;
        activeSearchParams = nextSearchParams;
        activeLangParam = nextLangParam;

        if (canonicalizing) {
          setState({
            ...state,
            activeSlug: nextRawSlug,
            resolvedRequestSlug: nextNormalized,
            failedRequestSlug: null,
            loading: false,
          });
          return Promise.resolve();
        }

        initializedShopId = null;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      // Same normalized slug
      activeRawSlug = nextRawSlug;
      activeSearchParams = nextSearchParams;
      activeLangParam = nextLangParam;

      const hasSettledMatchingShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: nextNormalized,
      });
      const hasSettledFailure =
        normalizeStorefrontSlug(state.failedRequestSlug) === nextNormalized &&
        !state.loading;

      // Recover cleanly if a previous in-flight load was cancelled before settling (e.g. React StrictMode double-effect)
      if (
        !hasSettledMatchingShop &&
        !hasSettledFailure &&
        inFlightNormalizedSlug !== nextNormalized
      ) {
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      if (
        nextSearchParams !== prevSearchParams ||
        nextLangParam !== prevLangParam
      ) {
        if (hasSettledMatchingShop && nextLangParam !== prevLangParam) {
          const detected = detectLocale(state.allowedLangs, nextLangParam);
          if (detected !== state.locale) {
            setState({
              ...state,
              locale: detected,
            });
          }
        }
      }

      return Promise.resolve();
    },
    refresh() {
      return load({ requestedSlug: activeRawSlug, isInitial: false });
    },
    setLocale(locale) {
      if (state.locale === locale) return;
      setState({
        ...state,
        locale,
      });
    },
    setPromoPopupOpen(open) {
      if (state.isPromoPopupOpen === open) return;
      setState({
        ...state,
        isPromoPopupOpen: open,
      });
    },
    closePromoPopup() {
      const activeShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: activeNormalizedSlug,
      })
        ? state.shop
        : null;
      if (activeShop?.id) {
        markWelcomePopupSeen(activeShop.id);
      }
      if (state.isPromoPopupOpen) {
        setState({
          ...state,
          isPromoPopupOpen: false,
        });
      }
    },
    cancelInFlight,
  };
}

export const StorefrontDoorCoordinatorContext =
  createContext<StorefrontDoorCoordinator | null>(null);

// ============================================================================
// Menu Route (`/s/[slug]/menu`) State & Request Coordinator
// ============================================================================

export interface StorefrontMenuBundleResponse {
  shop?: Shop | null;
  categories?: Category[] | null;
  items?: CatalogItem[] | null;
  tables?: ShopTable[] | null;
  ownerPlan?: string | null;
  tableQrVerified?: boolean | null;
}

export interface StorefrontMenuState {
  activeSlug: string;
  shop: Shop | null;
  resolvedRequestSlug: string | null;
  failedRequestSlug: string | null;
  categories: Category[];
  items: CatalogItem[];
  tables: ShopTable[];
  tablesLoadError: string | null;
  tableQrVerification: ScopedTableQrVerification | null;
  allowedLangs: SupportedLocale[];
  locale: SupportedLocale;
  loading: boolean;
  isPromoPopupOpen: boolean;
}

export interface StorefrontMenuRenderState {
  shop: Shop | null;
  categories: Category[];
  items: CatalogItem[];
  tables: ShopTable[];
  tablesLoadError: string | null;
  tableQrVerification: ScopedTableQrVerification | null;
  allowedLangs: SupportedLocale[];
  locale: SupportedLocale;
  isLoading: boolean;
  isNotFound: boolean;
  isPromoPopupOpen: boolean;
}

export function resolveStorefrontMenuRenderState(
  state: StorefrontMenuState,
  currentRoute: {
    slug: string;
    tableId?: string | null;
    sig?: string | null;
  }
): StorefrontMenuRenderState {
  const viewState = resolveStorefrontSlugViewState({
    currentSlug: currentRoute.slug,
    shop: state.shop,
    resolvedRequestSlug: state.resolvedRequestSlug,
    failedRequestSlug: state.failedRequestSlug,
    loading: state.loading,
  });

  if (!viewState.activeShop) {
    return {
      shop: null,
      categories: [],
      items: [],
      tables: [],
      tablesLoadError: null,
      tableQrVerification: null,
      allowedLangs: DEFAULT_STOREFRONT_LOCALES,
      locale: state.locale,
      isLoading: viewState.isLoading,
      isNotFound: viewState.isNotFound,
      isPromoPopupOpen: false,
    };
  }

  const verificationStillMatches =
    state.tableQrVerification &&
    resolveScopedTableQrVerification(state.tableQrVerification, {
      shopSlug: currentRoute.slug,
      shopId: viewState.activeShop.id,
      tableId: currentRoute.tableId,
      sig: currentRoute.sig,
    }) !== null;

  return {
    shop: viewState.activeShop,
    categories: state.categories,
    items: state.items,
    tables: state.tables,
    tablesLoadError: state.tablesLoadError,
    tableQrVerification: verificationStillMatches
      ? state.tableQrVerification
      : null,
    allowedLangs: state.allowedLangs,
    locale: state.locale,
    isLoading: false,
    isNotFound: false,
    isPromoPopupOpen: state.isPromoPopupOpen,
  };
}

export interface StorefrontMenuCoordinatorOptions {
  initialSlug?: string;
  fetchImpl?: typeof fetch;
  onReplaceUrl?: (url: string) => void;
  detectLocale?: (
    allowedLangs: SupportedLocale[],
    explicitQueryLang?: string | null
  ) => SupportedLocale;
  hasSeenWelcomePopup?: (shopId: string) => boolean;
  markWelcomePopupSeen?: (shopId: string) => void;
  trackTableScan?: (payload: {
    shop_id: string;
    event_type: 'scan_table';
    visitor_lang: SupportedLocale;
  }) => void;
  onError?: (error: unknown) => void;
}

export interface StorefrontMenuRouteInput {
  slug: string;
  searchParams?: StorefrontSearchParamsInput;
  tableId?: string | null;
  sig?: string | null;
  table?: string | null;
  langParam?: string | null;
  srcParam?: string | null;
}

export interface StorefrontMenuCoordinator {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StorefrontMenuState;
  navigate(route: StorefrontMenuRouteInput): Promise<void>;
  refresh(): Promise<void>;
  setLocale(locale: SupportedLocale): void;
  setPromoPopupOpen(open: boolean): void;
  closePromoPopup(): void;
  isFetchInFlight(): boolean;
  getLastFetchedAtMs(): number;
  cancelInFlight(): void;
}

export function createStorefrontMenuCoordinator(
  options: StorefrontMenuCoordinatorOptions = {}
): StorefrontMenuCoordinator {
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const detectLocale = options.detectLocale ?? detectVisitorLocale;
  const hasSeenWelcomePopup =
    options.hasSeenWelcomePopup ?? defaultHasSeenWelcomePopup;
  const markWelcomePopupSeen =
    options.markWelcomePopupSeen ?? defaultMarkWelcomePopupSeen;
  const trackTableScan =
    options.trackTableScan ??
    ((payload) => {
      fetchImpl('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    });
  const onError =
    options.onError ??
    ((err) => {
      console.error('Failed to fetch storefront menu:', err);
    });

  const initialRawSlug =
    (options.initialSlug || 'pho-hoi-an').trim() || 'pho-hoi-an';

  let state: StorefrontMenuState = {
    activeSlug: initialRawSlug,
    shop: null,
    resolvedRequestSlug: null,
    failedRequestSlug: null,
    categories: [],
    items: [],
    tables: [],
    tablesLoadError: null,
    tableQrVerification: null,
    allowedLangs: DEFAULT_STOREFRONT_LOCALES,
    locale: 'vi',
    loading: true,
    isPromoPopupOpen: false,
  };

  const listeners = new Set<() => void>();
  let activeRawSlug = initialRawSlug;
  let activeNormalizedSlug = normalizeStorefrontSlug(initialRawSlug);
  let activeSearchParams = '';
  let activeTableId = '';
  let activeTableSig = '';
  let activeTableParam = '';
  let activeLangParam: string | null = null;
  let activeSrcParam: string | null = null;
  let activeVerificationKey = buildTableQrVerificationKey({
    shopSlug: initialRawSlug,
    tableId: '',
    sig: '',
  });
  let activeTableQueryKey = buildStorefrontTableQueryKey({
    shopSlug: initialRawSlug,
    tableId: '',
    sig: '',
    table: '',
  });

  let hasNavigatedOnce = false;
  let requestSeq = 0;
  let inFlightFetch = false;
  let inFlightVerificationKey: string | null = null;
  let lastFetchedAtMs = 0;
  let activeAbortController: AbortController | null = null;
  let initializedShopId: string | null = null;
  let lastTrackedTableScanKey: string | null = null;

  const setState = (next: StorefrontMenuState) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const cancelInFlight = () => {
    requestSeq += 1;
    inFlightFetch = false;
    inFlightVerificationKey = null;
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  };

  const load = async (params: {
    requestedSlug: string;
    isInitial: boolean;
  }): Promise<void> => {
    const cleanRequestedSlug =
      (params.requestedSlug || 'pho-hoi-an').trim() || 'pho-hoi-an';
    const normalizedRequested = normalizeStorefrontSlug(cleanRequestedSlug);
    const requestedTableId = activeTableId;
    const requestedTableSig = activeTableSig;
    const requestedTableParam = activeTableParam;
    const requestedVerificationKey = buildTableQrVerificationKey({
      shopSlug: cleanRequestedSlug,
      tableId: requestedTableId,
      sig: requestedTableSig,
    });
    const seq = ++requestSeq;

    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeAbortController = controller;
    inFlightFetch = true;
    inFlightVerificationKey = requestedVerificationKey;

    const isStale = (): boolean =>
      seq !== requestSeq ||
      activeNormalizedSlug !== normalizedRequested ||
      activeVerificationKey !== requestedVerificationKey;

    const hasMatchingLoadedShop = isStorefrontShopMatchingSlug({
      shop: state.shop,
      resolvedRequestSlug: state.resolvedRequestSlug,
      currentSlug: normalizedRequested,
    });

    if (!hasMatchingLoadedShop) {
      setState({
        ...state,
        activeSlug: activeRawSlug,
        shop: null,
        resolvedRequestSlug: null,
        failedRequestSlug: null,
        categories: [],
        items: [],
        tables: [],
        tablesLoadError: null,
        tableQrVerification: null,
        allowedLangs: DEFAULT_STOREFRONT_LOCALES,
        loading: true,
        isPromoPopupOpen: false,
      });
    } else if (params.isInitial && state.failedRequestSlug) {
      setState({
        ...state,
        failedRequestSlug: null,
      });
    }

    try {
      const shopUrlParams = new URLSearchParams({
        slug: cleanRequestedSlug,
        view: 'menu',
      });
      if (requestedTableId) {
        shopUrlParams.set('tableId', requestedTableId);
        if (requestedTableSig) {
          shopUrlParams.set('sig', requestedTableSig);
        }
      }

      const res = await fetchImpl(`/api/shops?${shopUrlParams.toString()}`, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (isStale()) {
        return;
      }

      if (!res.ok) {
        const stillHasMatchingShop = isStorefrontShopMatchingSlug({
          shop: state.shop,
          resolvedRequestSlug: state.resolvedRequestSlug,
          currentSlug: normalizedRequested,
        });
        if (params.isInitial || !stillHasMatchingShop || res.status === 404) {
          setState({
            ...state,
            activeSlug: activeRawSlug,
            shop: null,
            resolvedRequestSlug: null,
            failedRequestSlug: normalizedRequested,
            categories: [],
            items: [],
            tables: [],
            tablesLoadError: null,
            tableQrVerification: null,
            allowedLangs: DEFAULT_STOREFRONT_LOCALES,
            loading: false,
            isPromoPopupOpen: false,
          });
        }
        return;
      }

      const data = (await res.json()) as StorefrontMenuBundleResponse | null;
      if (isStale()) {
        return;
      }

      const loadedShop = data?.shop ?? null;
      if (!loadedShop || !loadedShop.id) {
        setState({
          ...state,
          activeSlug: activeRawSlug,
          shop: null,
          resolvedRequestSlug: null,
          failedRequestSlug: normalizedRequested,
          categories: [],
          items: [],
          tables: [],
          tablesLoadError: null,
          tableQrVerification: null,
          allowedLangs: DEFAULT_STOREFRONT_LOCALES,
          loading: false,
          isPromoPopupOpen: false,
        });
        return;
      }

      lastFetchedAtMs = Date.now();

      const planLangs = getAllowedLocalesForPlan(
        data?.ownerPlan || 'free',
        normalizeShopSupportedLangs(loadedShop.supported_langs)
      );

      let loadedTables: ShopTable[] = [];
      let nextTablesLoadError: string | null = null;

      if (Array.isArray(data?.tables)) {
        loadedTables = data.tables;
      } else {
        try {
          const tblRes = await fetchImpl(
            `/api/tables?shopId=${encodeURIComponent(loadedShop.id)}`,
            {
              cache: 'no-store',
              ...(controller ? { signal: controller.signal } : {}),
            }
          );
          if (tblRes.ok) {
            const tblData = (await tblRes.json()) as {
              tables?: ShopTable[] | null;
            } | null;
            loadedTables = Array.isArray(tblData?.tables)
              ? tblData.tables
              : [];
          } else {
            const errData = (await tblRes.json().catch(() => null)) as {
              error?: string;
            } | null;
            nextTablesLoadError =
              errData?.error ||
              'Không thể tải danh sách bàn của quán. Vui lòng thử lại.';
          }
        } catch (tblErr) {
          if (controller?.signal.aborted || isStale()) {
            return;
          }
          void tblErr;
          nextTablesLoadError =
            'Không thể tải danh sách bàn của quán. Vui lòng thử lại.';
        }
      }

      if (isStale()) {
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
        requestedSlug: cleanRequestedSlug,
        canonicalSlug: loadedShop.slug,
        view: 'menu',
        searchParams: activeSearchParams,
      });

      const nextVerification = createScopedTableQrVerification({
        shopSlug: cleanRequestedSlug,
        canonicalSlug: loadedShop.slug,
        shopId: loadedShop.id,
        tableId: requestedTableId,
        sig: requestedTableSig,
        tableQrVerified:
          typeof data?.tableQrVerified === 'boolean'
            ? data.tableQrVerified
            : null,
        activeSlug: activeRawSlug,
        activeTableId,
        activeSig: activeTableSig,
      });

      const shouldInitializeForShop =
        params.isInitial || initializedShopId !== loadedShop.id;

      let nextLocale = state.locale;
      let nextPopupOpen = state.isPromoPopupOpen;

      if (shouldInitializeForShop) {
        initializedShopId = loadedShop.id;
        nextLocale = detectLocale(planLangs, activeLangParam);

        const popupCfg = loadedShop.theme_config?.welcomePopup;
        if (popupCfg?.enabled && popupCfg.title?.trim()) {
          nextPopupOpen = !hasSeenWelcomePopup(loadedShop.id);
        } else {
          nextPopupOpen = false;
        }
      } else if (!planLangs.includes(nextLocale)) {
        nextLocale = planLangs[0] || 'vi';
      }

      setState({
        activeSlug: activeRawSlug,
        shop: loadedShop,
        resolvedRequestSlug: normalizedRequested,
        failedRequestSlug: null,
        categories: Array.isArray(data?.categories) ? data.categories : [],
        items: Array.isArray(data?.items) ? data.items : [],
        tables: activeOnlyTables,
        tablesLoadError: nextTablesLoadError,
        tableQrVerification: nextVerification,
        allowedLangs: planLangs,
        locale: nextLocale,
        loading: false,
        isPromoPopupOpen: nextPopupOpen,
      });

      if (canonicalRedirect?.isAlias) {
        options.onReplaceUrl?.(canonicalRedirect.canonicalUrl);
      }

      const isTableQrEntry =
        activeSrcParam !== 'door' &&
        (activeSrcParam === 'table' ||
          Boolean(requestedTableId) ||
          Boolean(requestedTableParam));
      const tableScanKey = `${loadedShop.id}:${requestedTableId}:${requestedTableSig}:${requestedTableParam}`;

      if (
        shouldInitializeForShop &&
        isTableQrEntry &&
        lastTrackedTableScanKey !== tableScanKey
      ) {
        lastTrackedTableScanKey = tableScanKey;
        trackTableScan({
          shop_id: loadedShop.id,
          event_type: 'scan_table',
          visitor_lang: nextLocale,
        });
      }
    } catch (err) {
      if (controller?.signal.aborted || isStale()) {
        return;
      }
      onError(err);
      const stillHasMatchingShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: normalizedRequested,
      });
      if (params.isInitial || !stillHasMatchingShop) {
        setState({
          ...state,
          activeSlug: activeRawSlug,
          shop: null,
          resolvedRequestSlug: null,
          failedRequestSlug: normalizedRequested,
          categories: [],
          items: [],
          tables: [],
          tablesLoadError: null,
          tableQrVerification: null,
          allowedLangs: DEFAULT_STOREFRONT_LOCALES,
          loading: false,
          isPromoPopupOpen: false,
        });
      }
    } finally {
      if (seq === requestSeq) {
        inFlightFetch = false;
        inFlightVerificationKey = null;
      }
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
    navigate(route) {
      const nextRawSlug = (route.slug || 'pho-hoi-an').trim() || 'pho-hoi-an';
      const nextNormalized = normalizeStorefrontSlug(nextRawSlug);
      const nextSearchParams = serializeStorefrontSearchParams(
        route.searchParams
      );
      const parsedSearch = new URLSearchParams(nextSearchParams);
      const nextTableId = (
        route.tableId !== undefined
          ? (route.tableId ?? '')
          : (parsedSearch.get('tableId') ?? '')
      ).trim();
      const nextTableSig = (
        route.sig !== undefined
          ? (route.sig ?? '')
          : (parsedSearch.get('sig') ?? '')
      ).trim();
      const nextTableParam = (
        route.table !== undefined
          ? (route.table ?? '')
          : (parsedSearch.get('table') ?? '')
      ).trim();
      const nextLangParam =
        route.langParam !== undefined
          ? route.langParam
          : parsedSearch.get('lang');
      const nextSrcParam =
        route.srcParam !== undefined ? route.srcParam : parsedSearch.get('src');

      const nextVerificationKey = buildTableQrVerificationKey({
        shopSlug: nextRawSlug,
        tableId: nextTableId,
        sig: nextTableSig,
      });
      const nextTableQueryKey = buildStorefrontTableQueryKey({
        shopSlug: nextRawSlug,
        tableId: nextTableId,
        sig: nextTableSig,
        table: nextTableParam,
      });

      const applyActiveRoute = () => {
        activeRawSlug = nextRawSlug;
        activeNormalizedSlug = nextNormalized;
        activeSearchParams = nextSearchParams;
        activeTableId = nextTableId;
        activeTableSig = nextTableSig;
        activeTableParam = nextTableParam;
        activeLangParam = nextLangParam;
        activeSrcParam = nextSrcParam;
        activeVerificationKey = nextVerificationKey;
        activeTableQueryKey = nextTableQueryKey;
      };

      if (!hasNavigatedOnce) {
        hasNavigatedOnce = true;
        applyActiveRoute();
        lastFetchedAtMs = 0;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      const prevNormalized = activeNormalizedSlug;
      const prevTableQueryKey = activeTableQueryKey;
      const prevLangParam = activeLangParam;
      const prevSrcParam = activeSrcParam;
      const prevTableId = activeTableId;
      const prevTableSig = activeTableSig;
      const prevTableParam = activeTableParam;

      if (nextNormalized !== prevNormalized) {
        const canonicalizing =
          isCanonicalizingLoadedShop({
            shop: state.shop,
            resolvedRequestSlug: state.resolvedRequestSlug,
            previousSlug: prevNormalized,
            nextSlug: nextNormalized,
          }) &&
          prevTableId === nextTableId &&
          prevTableSig === nextTableSig &&
          prevTableParam === nextTableParam;

        applyActiveRoute();

        if (canonicalizing) {
          setState({
            ...state,
            activeSlug: nextRawSlug,
            resolvedRequestSlug: nextNormalized,
            failedRequestSlug: null,
            loading: false,
          });
          return Promise.resolve();
        }

        initializedShopId = null;
        lastFetchedAtMs = 0;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      // Same normalized slug
      applyActiveRoute();

      if (nextTableQueryKey !== prevTableQueryKey || nextSrcParam !== prevSrcParam) {
        const stillMatches =
          state.tableQrVerification &&
          resolveScopedTableQrVerification(state.tableQrVerification, {
            shopSlug: nextRawSlug,
            shopId: state.shop?.id,
            tableId: nextTableId,
            sig: nextTableSig,
          }) !== null;
        if (!stillMatches && state.tableQrVerification !== null) {
          setState({
            ...state,
            tableQrVerification: null,
          });
        }
        lastFetchedAtMs = 0;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      const hasSettledMatchingShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: nextNormalized,
      });
      const hasSettledFailure =
        normalizeStorefrontSlug(state.failedRequestSlug) === nextNormalized &&
        !state.loading;

      if (
        !hasSettledMatchingShop &&
        !hasSettledFailure &&
        inFlightVerificationKey !== nextVerificationKey
      ) {
        lastFetchedAtMs = 0;
        return load({ requestedSlug: nextRawSlug, isInitial: true });
      }

      if (hasSettledMatchingShop && nextLangParam !== prevLangParam) {
        const detected = detectLocale(state.allowedLangs, nextLangParam);
        if (detected !== state.locale) {
          setState({
            ...state,
            locale: detected,
          });
        }
      }

      return Promise.resolve();
    },
    refresh() {
      return load({ requestedSlug: activeRawSlug, isInitial: false });
    },
    setLocale(locale) {
      if (state.locale === locale) return;
      setState({
        ...state,
        locale,
      });
    },
    setPromoPopupOpen(open) {
      if (state.isPromoPopupOpen === open) return;
      setState({
        ...state,
        isPromoPopupOpen: open,
      });
    },
    closePromoPopup() {
      const activeShop = isStorefrontShopMatchingSlug({
        shop: state.shop,
        resolvedRequestSlug: state.resolvedRequestSlug,
        currentSlug: activeNormalizedSlug,
      })
        ? state.shop
        : null;
      if (activeShop?.id) {
        markWelcomePopupSeen(activeShop.id);
      }
      if (state.isPromoPopupOpen) {
        setState({
          ...state,
          isPromoPopupOpen: false,
        });
      }
    },
    isFetchInFlight() {
      return inFlightFetch;
    },
    getLastFetchedAtMs() {
      return lastFetchedAtMs;
    },
    cancelInFlight,
  };
}

export const StorefrontMenuCoordinatorContext =
  createContext<StorefrontMenuCoordinator | null>(null);
