import type { CatalogItem, Category, I18nText, PlanTier } from '@/types/qlaok';

export interface ParsedCatalogSuccess {
  ok: true;
  categories: Category[];
  items: CatalogItem[];
  ownerPlan: PlanTier;
}

export interface ParsedCatalogFailure {
  ok: false;
}

export type ParsedCatalogResponse = ParsedCatalogSuccess | ParsedCatalogFailure;

export function isCurrentCatalogRequest(params: {
  requestShopId: string;
  currentShopId: string | null;
  requestId: number;
  currentRequestId: number;
}): boolean {
  return (
    params.requestShopId === params.currentShopId &&
    params.requestId === params.currentRequestId
  );
}

/**
 * Validates and extracts catalog data from the /api/catalog HTTP response.
 * Strictly verifies `responseOk` before accepting any payload.
 * When `responseOk` is false, returns a locale-independent failure classification ({ ok: false })
 * without returning or leaking any raw server error fields.
 */
export function parseCatalogApiResponse(
  responseOk: boolean,
  data: unknown
): ParsedCatalogResponse {
  if (!responseOk) {
    return { ok: false };
  }

  const payload = (data && typeof data === 'object' ? data : {}) as {
    categories?: unknown;
    items?: unknown;
    ownerPlan?: unknown;
  };

  const categories = Array.isArray(payload.categories)
    ? (payload.categories as Category[])
    : [];
  const items = Array.isArray(payload.items)
    ? (payload.items as CatalogItem[])
    : [];
  const rawPlan = payload.ownerPlan;
  const ownerPlan: PlanTier =
    rawPlan === 'basic' || rawPlan === 'premium' ? rawPlan : 'free';

  return {
    ok: true,
    categories,
    items,
    ownerPlan,
  };
}

/**
 * Resolves the catalog categories, items, and owner plan.
 * On failure, preserves existing data so silent refreshes never replace useful menu content.
 */
export function resolveNextCatalogData<
  T extends { categories: Category[]; items: CatalogItem[]; ownerPlan: PlanTier },
>(current: T, result: ParsedCatalogResponse): T {
  if (!result.ok) {
    return current;
  }
  return {
    ...current,
    categories: result.categories,
    items: result.items,
    ownerPlan: result.ownerPlan,
  };
}

/**
 * Determines whether the separate load-error banner should be displayed.
 * Visible whenever hasLoaded is true and loadError is present (silent refresh failure).
 */
export function shouldShowCatalogLoadErrorBanner(params: {
  hasLoaded: boolean;
  loadError: boolean;
}): boolean {
  return params.hasLoaded && Boolean(params.loadError);
}

/**
 * Determines whether the initial load failure panel should be rendered.
 * Visible on initial fetch failure before any successful catalog load.
 */
export function shouldShowCatalogLoadErrorState(params: {
  hasLoaded: boolean;
  loadError: boolean;
  loading?: boolean;
}): boolean {
  if (params.loading) return false;
  return !params.hasLoaded && Boolean(params.loadError);
}

/**
 * Determines whether the empty catalog prompt (`catalog-empty-state`) should be rendered.
 * Invariant: A failed initial load must NOT render the empty catalog prompt.
 */
export function shouldShowCatalogEmptyState(params: {
  hasLoaded: boolean;
  loadError?: boolean;
  filteredCount: number;
  loading?: boolean;
}): boolean {
  if (params.loading) return false;
  if (!params.hasLoaded) return false;
  return params.filteredCount === 0;
}

/**
 * Determines whether a category rename input is a valid mutation, a no-op, or invalid blank.
 */
export function getCategoryRenameAction(
  currentNameVi: string,
  nextNameVi: string
): 'noop' | 'invalid_blank' | 'save' {
  const trimmed = nextNameVi.trim();
  if (!trimmed) {
    return 'invalid_blank';
  }
  if (trimmed === currentNameVi.trim()) {
    return 'noop';
  }
  return 'save';
}

/**
 * Builds the name_i18n object for category rename (or creation) from a fresh translation result.
 * If translation fails or lacks a non-empty English translation, falls back strictly to { vi: newName, en: newName }.
 * Old translations from prior category states are NOT retained or merged to avoid stale labels.
 */
export function buildCategoryNameI18n(
  newNameVi: string,
  freshTranslation?: Partial<I18nText> | null
): I18nText {
  const trimmed = newNameVi.trim();
  if (
    freshTranslation &&
    typeof freshTranslation === 'object' &&
    typeof freshTranslation.en === 'string' &&
    freshTranslation.en.trim()
  ) {
    return {
      ...freshTranslation,
      vi: trimmed,
      en: freshTranslation.en.trim(),
    };
  }
  return {
    vi: trimmed,
    en: trimmed,
  };
}
