/**
 * Pure pagination helpers and constants for the catalog dashboard.
 * Enforces page sizes of exactly 10, 20, 50, and 100.
 */

export const CATALOG_PAGE_SIZES = [10, 20, 50, 100] as const;
export type CatalogPageSize = (typeof CATALOG_PAGE_SIZES)[number];

export const DEFAULT_CATALOG_PAGE_SIZE: CatalogPageSize = 20;

export function isValidCatalogPageSize(size: unknown): size is CatalogPageSize {
  return typeof size === 'number' && (CATALOG_PAGE_SIZES as readonly number[]).includes(size);
}

export function normalizeCatalogPageSize(size: unknown): CatalogPageSize {
  if (isValidCatalogPageSize(size)) {
    return size;
  }
  return DEFAULT_CATALOG_PAGE_SIZE;
}

/**
 * Calculates total pages for a given item count and page size.
 * Always returns at least 1 page.
 */
export function calculateCatalogTotalPages(totalItems: number, pageSize: number): number {
  const safeSize = Math.max(1, Math.floor(pageSize));
  const safeItems = Math.max(0, Math.floor(totalItems));
  if (safeItems === 0) return 1;
  return Math.max(1, Math.ceil(safeItems / safeSize));
}

/**
 * Clamps the requested page number within valid bounds [1, totalPages].
 */
export function clampCatalogPage(page: number, totalItems: number, pageSize: number): number {
  const totalPages = calculateCatalogTotalPages(totalItems, pageSize);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), totalPages);
}

export interface CatalogPaginationRange {
  page: number;
  pageSize: CatalogPageSize;
  totalItems: number;
  totalPages: number;
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Calculates 1-based display ranges (e.g. items 1 to 20 of 45).
 */
export function getCatalogPaginationRange(
  page: number,
  pageSize: CatalogPageSize,
  totalItems: number
): CatalogPaginationRange {
  const safeSize = normalizeCatalogPageSize(pageSize);
  const totalPages = calculateCatalogTotalPages(totalItems, safeSize);
  const clampedPage = clampCatalogPage(page, totalItems, safeSize);
  const safeTotal = Math.max(0, Math.floor(totalItems));

  const start = safeTotal === 0 ? 0 : (clampedPage - 1) * safeSize + 1;
  const end = safeTotal === 0 ? 0 : Math.min(clampedPage * safeSize, safeTotal);

  return {
    page: clampedPage,
    pageSize: safeSize,
    totalItems: safeTotal,
    totalPages,
    start,
    end,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
  };
}

/**
 * Slices the filtered catalog list according to the current page and page size.
 */
export function paginateCatalogItems<T>(
  items: readonly T[],
  page: number,
  pageSize: CatalogPageSize
): T[] {
  const safeSize = normalizeCatalogPageSize(pageSize);
  const clampedPage = clampCatalogPage(page, items.length, safeSize);
  const start = (clampedPage - 1) * safeSize;
  return items.slice(start, start + safeSize);
}
