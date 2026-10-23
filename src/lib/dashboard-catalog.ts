import type { CatalogItem, Category, PlanTier } from '@/types/qlaok';

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
