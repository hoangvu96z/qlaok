import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCatalogApiResponse,
  resolveNextCatalogData,
  shouldShowCatalogEmptyState,
  shouldShowCatalogLoadErrorBanner,
  shouldShowCatalogLoadErrorState,
} from '@/lib/dashboard-catalog';
import type { CatalogItem, Category } from '@/types/qlaok';

const sampleCategory: Category = {
  id: 'cat-1',
  shop_id: 'shop-test',
  name_i18n: { vi: 'Cà phê', en: 'Coffee' },
  sort_order: 1,
  is_active: true,
};

const sampleItem: CatalogItem = {
  id: 'item-1',
  shop_id: 'shop-test',
  category_id: 'cat-1',
  name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
  desc_i18n: { vi: '', en: '' },
  price: 35000,
  is_available: true,
  is_featured: false,
  options_json: [],
  view_count: 0,
  sort_order: 1,
};

test('parseCatalogApiResponse classifies success vs failure locale-independently without returning raw error fields', () => {
  // 1. Non-2xx with technical server error payload: classifies as failure, never returns raw error fields
  const rawDbErrorCode = 'PGRST116: JSON object requested, multiple (or no) rows returned';
  const res500WithRawError = parseCatalogApiResponse(false, {
    error: rawDbErrorCode,
    message: 'Internal server error',
    categories: [sampleCategory],
    items: [sampleItem],
  });
  assert.equal(res500WithRawError.ok, false);
  assert.equal('error' in res500WithRawError, false, 'Must not return raw error fields');
  assert.deepEqual(res500WithRawError, { ok: false });

  // 2. Non-2xx with 401/403/503 or empty payload: classifies as failure
  const res503 = parseCatalogApiResponse(false, null);
  assert.deepEqual(res503, { ok: false });

  const res401 = parseCatalogApiResponse(false, {});
  assert.deepEqual(res401, { ok: false });

  // 3. HTTP 200 OK: accepts payload
  const res200Success = parseCatalogApiResponse(true, {
    categories: [sampleCategory],
    items: [sampleItem],
    ownerPlan: 'premium',
  });
  assert.equal(res200Success.ok, true);
  if (res200Success.ok) {
    assert.equal(res200Success.categories.length, 1);
    assert.equal(res200Success.categories[0].id, 'cat-1');
    assert.equal(res200Success.items.length, 1);
    assert.equal(res200Success.items[0].id, 'item-1');
    assert.equal(res200Success.ownerPlan, 'premium');
  }

  // 4. HTTP 200 OK with missing or malformed fields safely normalizes
  const res200Missing = parseCatalogApiResponse(true, {});
  assert.equal(res200Missing.ok, true);
  if (res200Missing.ok) {
    assert.deepEqual(res200Missing.categories, []);
    assert.deepEqual(res200Missing.items, []);
    assert.equal(res200Missing.ownerPlan, 'free');
  }
});

test('shouldShowCatalogLoadErrorBanner accurately governs silent error visibility', () => {
  // Silent refresh failure: hasLoaded is true and loadError is true -> banner must be visible
  assert.equal(
    shouldShowCatalogLoadErrorBanner({
      hasLoaded: true,
      loadError: true,
    }),
    true,
    'Silent refresh failure must show load error banner'
  );

  // Initial failure: hasLoaded is false -> banner is false (handled by initial failure state panel)
  assert.equal(
    shouldShowCatalogLoadErrorBanner({
      hasLoaded: false,
      loadError: true,
    }),
    false,
    'Initial load failure must not show the silent-refresh top banner'
  );

  // Healthy loaded state: no error -> banner must be hidden
  assert.equal(
    shouldShowCatalogLoadErrorBanner({
      hasLoaded: true,
      loadError: false,
    }),
    false,
    'Healthy loaded state must hide banner'
  );

  // Initial clean state: no error -> banner must be hidden
  assert.equal(
    shouldShowCatalogLoadErrorBanner({
      hasLoaded: false,
      loadError: false,
    }),
    false,
    'Clean uninitialized state must hide banner'
  );
});

test('shouldShowCatalogEmptyState and shouldShowCatalogLoadErrorState: initial error vs true empty', () => {
  // Case A: Initial load failed (hasLoaded = false, loadError = true, items = 0)
  assert.equal(
    shouldShowCatalogEmptyState({
      hasLoaded: false,
      loadError: true,
      filteredCount: 0,
      loading: false,
    }),
    false,
    'Failed initial load must NEVER show catalog-empty-state'
  );
  assert.equal(
    shouldShowCatalogLoadErrorState({
      hasLoaded: false,
      loadError: true,
      loading: false,
    }),
    true,
    'Failed initial load MUST show catalog-load-error-state'
  );

  // Case B: Loading in progress
  assert.equal(
    shouldShowCatalogEmptyState({
      hasLoaded: false,
      loadError: false,
      filteredCount: 0,
      loading: true,
    }),
    false,
    'Loading state must not show empty state'
  );
  assert.equal(
    shouldShowCatalogLoadErrorState({
      hasLoaded: false,
      loadError: false,
      loading: true,
    }),
    false,
    'Loading state must not show error state'
  );

  // Case C: Initial load succeeded and shop truly has 0 items (true confirmed empty state)
  assert.equal(
    shouldShowCatalogEmptyState({
      hasLoaded: true,
      loadError: false,
      filteredCount: 0,
      loading: false,
    }),
    true,
    'Confirmed empty catalog must show catalog-empty-state'
  );
  assert.equal(
    shouldShowCatalogLoadErrorState({
      hasLoaded: true,
      loadError: false,
      loading: false,
    }),
    false
  );

  // Case D: Silent refresh failure with existing items
  assert.equal(
    shouldShowCatalogEmptyState({
      hasLoaded: true,
      loadError: true,
      filteredCount: 5,
      loading: false,
    }),
    false,
    'Silent refresh failure with existing items must not show empty state'
  );
  assert.equal(
    shouldShowCatalogLoadErrorState({
      hasLoaded: true,
      loadError: true,
      loading: false,
    }),
    false,
    'Silent refresh failure with existing items must not show full-panel error replacing items'
  );
});

test('resolveNextCatalogData preserves current data on failure and updates on success', () => {
  const current = {
    categories: [sampleCategory],
    items: [sampleItem],
    ownerPlan: 'basic' as const,
  };

  // 1. Failure: must return exact current data without replacing useful content
  const failureResult = {
    ok: false as const,
  };
  const preserved = resolveNextCatalogData(current, failureResult);
  assert.strictEqual(
    preserved,
    current,
    'Must return exact current data reference on failure'
  );
  assert.equal(preserved.items.length, 1);
  assert.equal(preserved.categories.length, 1);
  assert.equal(preserved.ownerPlan, 'basic');

  // 2. Success: updates with new categories, items, and ownerPlan
  const newCategory: Category = { ...sampleCategory, id: 'cat-2' };
  const newItem: CatalogItem = { ...sampleItem, id: 'item-2' };
  const successResult = {
    ok: true as const,
    categories: [newCategory],
    items: [newItem],
    ownerPlan: 'premium' as const,
  };
  const updated = resolveNextCatalogData(current, successResult);
  assert.equal(updated.categories.length, 1);
  assert.equal(updated.categories[0].id, 'cat-2');
  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0].id, 'item-2');
  assert.equal(updated.ownerPlan, 'premium');
});

test('catalog pagination clamps page correctly when items change or are deleted', async () => {
  const { clampCatalogPage, calculateCatalogTotalPages, getCatalogPaginationRange } =
    await import('@/lib/catalog-pagination');

  // Suppose there are 41 items and pageSize 20 -> 3 pages. User is on page 3 (showing item 41).
  let totalItems = 41;
  const pageSize = 20;
  let currentPage = 3;
  assert.equal(calculateCatalogTotalPages(totalItems, pageSize), 3);
  assert.equal(clampCatalogPage(currentPage, totalItems, pageSize), 3);

  // User deletes item 41 -> now totalItems is 40 -> totalPages becomes 2.
  totalItems = 40;
  currentPage = clampCatalogPage(currentPage, totalItems, pageSize);
  assert.equal(calculateCatalogTotalPages(totalItems, pageSize), 2);
  assert.equal(currentPage, 2, 'Page must clamp to 2 when page 3 no longer exists');

  // Verify pagination range on clamped page
  const range = getCatalogPaginationRange(currentPage, pageSize, totalItems);
  assert.equal(range.page, 2);
  assert.equal(range.totalPages, 2);
  assert.equal(range.start, 21);
  assert.equal(range.end, 40);
  assert.equal(range.hasNext, false);
  assert.equal(range.hasPrev, true);

  // Direct assertions for out-of-range current pages after item-count and page-size changes:
  // When count drops from 40 to 15 (e.g. rows disappear), out-of-range page 2 clamps to 1
  assert.equal(
    clampCatalogPage(2, 15, 20),
    1,
    'Out-of-range page 2 must clamp to 1 when item count drops to 15'
  );

  // When search or category changes and resets page to 1, clamping preserves page 1
  assert.equal(
    clampCatalogPage(1, 15, 20),
    1,
    'Resetting to page 1 on filter/search change must be preserved'
  );
  assert.equal(
    clampCatalogPage(1, 0, 20),
    1,
    'Empty search results must preserve page 1'
  );

  // When pageSize changes (e.g. 20 to 50 with 45 items), out-of-range page 3 clamps to 1
  assert.equal(
    clampCatalogPage(3, 45, 50),
    1,
    'Out-of-range page 3 must clamp to 1 when pageSize expands to 50'
  );

  // When currentPage is already within valid bounds, page remains untouched
  assert.equal(
    clampCatalogPage(2, 35, 20),
    2,
    'In-bounds page must remain untouched'
  );
});
