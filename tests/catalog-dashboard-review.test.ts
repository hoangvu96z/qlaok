import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategoryNameI18n,
  getCategoryRenameAction,
  isCurrentCatalogRequest,
  parseCatalogApiResponse,
  resolveNextCatalogData,
  shouldShowCatalogEmptyState,
  shouldShowCatalogLoadErrorBanner,
  shouldShowCatalogLoadErrorState,
} from '@/lib/dashboard-catalog';
import type { CatalogItem, Category, I18nText } from '@/types/qlaok';

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

test('isCurrentCatalogRequest ignores stale responses from an earlier request or shop', () => {
  assert.equal(
    isCurrentCatalogRequest({
      requestShopId: 'shop-a',
      currentShopId: 'shop-b',
      requestId: 2,
      currentRequestId: 2,
    }),
    false,
    'A response from the previously active shop must be discarded'
  );
  assert.equal(
    isCurrentCatalogRequest({
      requestShopId: 'shop-a',
      currentShopId: 'shop-a',
      requestId: 1,
      currentRequestId: 2,
    }),
    false,
    'An older request for the same shop must be discarded after a newer refresh'
  );
  assert.equal(
    isCurrentCatalogRequest({
      requestShopId: 'shop-a',
      currentShopId: 'shop-a',
      requestId: 2,
      currentRequestId: 2,
    }),
    true
  );
});

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

test('buildCategoryNameI18n handles translation fallback and prevents stale translation leakage', () => {
  // 1. Translation fallback when AI fails or returns null/undefined/empty
  const fallbackNull = buildCategoryNameI18n('Món Nước', null);
  assert.deepEqual(
    fallbackNull,
    { vi: 'Món Nước', en: 'Món Nước' },
    'Null translation must fall back to { vi: newName, en: newName }'
  );

  const fallbackUndef = buildCategoryNameI18n('Món Nước');
  assert.deepEqual(
    fallbackUndef,
    { vi: 'Món Nước', en: 'Món Nước' },
    'Undefined translation must fall back to { vi: newName, en: newName }'
  );

  const fallbackEmpty = buildCategoryNameI18n('  Món Nước  ', {});
  assert.deepEqual(
    fallbackEmpty,
    { vi: 'Món Nước', en: 'Món Nước' },
    'Empty translation map must trim name and fall back to { vi: newName, en: newName }'
  );

  const fallbackBlankEn = buildCategoryNameI18n('Món Nước', { en: '   ' });
  assert.deepEqual(
    fallbackBlankEn,
    { vi: 'Món Nước', en: 'Món Nước' },
    'Blank en translation must fall back to newName for en'
  );

  // 2. Fresh translation adoption
  const freshWithTranslations = buildCategoryNameI18n('Món Nước', {
    en: 'Beverages',
    ko: '음료',
    ja: '飲み物',
  });
  assert.deepEqual(
    freshWithTranslations,
    { vi: 'Món Nước', en: 'Beverages', ko: '음료', ja: '飲み物' },
    'Valid fresh translations must be adopted with trimmed Vietnamese name'
  );

  // 3. Stale-translation avoidance
  // Given an existing category that previously had old translations:
  const oldCategoryNameI18n: I18nText = {
    vi: 'Cà phê',
    en: 'Old Coffee',
    ja: '古いコーヒー',
    ko: '오래된 커피',
  };
  // When renaming to 'Trà Đào' and translation fails:
  const renameFallback = buildCategoryNameI18n('Trà Đào', null);
  assert.deepEqual(
    renameFallback,
    { vi: 'Trà Đào', en: 'Trà Đào' },
    'Renaming with translation fallback must not retain old category translations'
  );
  assert.equal('ja' in renameFallback, false, 'Must not reuse stale ja from old category');
  assert.equal('ko' in renameFallback, false, 'Must not reuse stale ko from old category');
  assert.notEqual(renameFallback.en, oldCategoryNameI18n.en, 'Must not keep old English name');

  // When renaming to 'Trà Đào' with fresh AI translation that only translated en:
  const renameFreshEn = buildCategoryNameI18n('Trà Đào', { en: 'Peach Tea' });
  assert.deepEqual(
    renameFreshEn,
    { vi: 'Trà Đào', en: 'Peach Tea' },
    'Must strictly use fresh translation and not inherit stale translations from old category'
  );
  assert.equal('ja' in renameFreshEn, false, 'Must not carry over previous ja translation');
});

test('getCategoryRenameAction validates blank names and detects unchanged names as no-op', () => {
  // Blank inputs: whitespace-only or empty
  assert.equal(getCategoryRenameAction('Cà phê', ''), 'invalid_blank');
  assert.equal(getCategoryRenameAction('Cà phê', '   '), 'invalid_blank');

  // Unchanged name (with or without surrounding whitespace) -> noop
  assert.equal(getCategoryRenameAction('Cà phê', 'Cà phê'), 'noop');
  assert.equal(getCategoryRenameAction('Cà phê', '  Cà phê  '), 'noop');

  // Valid new name -> save
  assert.equal(getCategoryRenameAction('Cà phê', 'Cà phê muối'), 'save');
  assert.equal(getCategoryRenameAction('Cà phê', '  Trà sữa  '), 'save');
});

test('QuickItemRow and DashboardCatalogPage render accessible row and page selection checkboxes', async () => {
  await import('./tsx-review-loader.mjs');
  const { registerHooks } = await import('node:module');
  registerHooks({
    load(url, context, next) {
      if (url.includes('dashboard-context')) {
        return {
          format: 'module',
          shortCircuit: true,
          source:
            "export function useDashboard() { const perms = globalThis.__TEST_DASHBOARD_PERMISSIONS__ || ['catalog.manage', 'inventory.adjust', 'inventory.view']; const role = perms.includes('catalog.manage') ? 'owner' : 'cashier'; const mem = { id: 'mem-1', shop_id: 'shop-test', user_id: 'user-1', role, is_active: true, permissions: perms }; return { activeShop: { id: 'shop-test', name: 'Test Shop', vertical: 'fnb', membership: mem }, activeMembership: mem, profile: { id: 'user-1', plan: 'free' } }; }",
        };
      }
      return next(url, context);
    },
  });
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QuickItemRow } = await import('@/components/dashboard/QuickItemRow');
  const { default: DashboardCatalogPage } = await import('@/app/(dashboard)/dashboard/catalog/page');

  const uncheckedRowHtml = renderToStaticMarkup(
    createElement(QuickItemRow, {
      item: sampleItem,
      selected: false,
      canManageCatalog: true,
      canAdjustInventory: true,
      onToggleSelect: () => {},
      onToggleAvailable: async () => true,
      onUpdatePrice: async () => true,
      onToggleFeatured: async () => true,
      onEditTranslations: () => {},
      onDelete: async () => true,
    })
  );
  assert.ok(
    uncheckedRowHtml.includes('data-testid="catalog-item-checkbox-item-1"'),
    'QuickItemRow must render an accessible selection checkbox when onToggleSelect is provided'
  );
  assert.ok(
    uncheckedRowHtml.includes('type="checkbox"'),
    'QuickItemRow selection control must be a native checkbox input'
  );
  assert.ok(
    uncheckedRowHtml.includes('id="select-item-item-1"'),
    'QuickItemRow checkbox must have an id matching label htmlFor'
  );
  assert.match(
    uncheckedRowHtml,
    /aria-label="[^"]*Cà phê sữa đá[^"]*"/,
    'QuickItemRow checkbox must include an accessible aria-label naming the item'
  );
  assert.ok(
    !uncheckedRowHtml.includes('checked=""'),
    'Unselected QuickItemRow checkbox must not be checked'
  );
  assert.ok(
    !uncheckedRowHtml.includes('disabled=""'),
    'Unselected QuickItemRow checkbox must not be disabled by default'
  );

  const checkedRowHtml = renderToStaticMarkup(
    createElement(QuickItemRow, {
      item: sampleItem,
      selected: true,
      selectionDisabled: true,
      canManageCatalog: true,
      canAdjustInventory: true,
      onToggleSelect: () => {},
      onToggleAvailable: async () => true,
      onUpdatePrice: async () => true,
      onToggleFeatured: async () => true,
      onEditTranslations: () => {},
      onDelete: async () => true,
    })
  );
  assert.ok(
    checkedRowHtml.includes('checked=""'),
    'Selected QuickItemRow checkbox must render checked attribute'
  );
  assert.ok(
    checkedRowHtml.includes('disabled=""'),
    'Disabled QuickItemRow checkbox must render disabled attribute while bulk action is pending'
  );
  assert.match(
    checkedRowHtml,
    /ring-2|ring-emerald-500/,
    'Selected QuickItemRow must visually reflect selected state'
  );

  const pageHtml = renderToStaticMarkup(createElement(DashboardCatalogPage));
  assert.ok(
    !pageHtml.includes('data-testid="catalog-bulk-action-bar"'),
    'DashboardCatalogPage must hide bulk toolbar when zero items are selected'
  );
  assert.ok(
    !pageHtml.includes('data-testid="catalog-bulk-selected-count"'),
    'DashboardCatalogPage must not show bulk selected count when zero items are selected'
  );
  assert.ok(
    !pageHtml.includes('data-testid="catalog-bulk-result-banner"'),
    'DashboardCatalogPage must not show bulk result banner on initial render'
  );
  assert.ok(
    pageHtml.includes('data-testid="catalog-loading-state"'),
    'DashboardCatalogPage must render initial loading state while fetching catalog data'
  );

  // Permission gate: category mutation affordances (creation form) must be visible to catalog managers
  assert.ok(
    pageHtml.includes('Thêm danh mục') || pageHtml.includes('Add Category'),
    'DashboardCatalogPage must render Add Category affordance for members with catalog.manage'
  );

  // Permission gate: inventory-only members must NOT see structural mutation controls
  // @ts-expect-error test hook override
  globalThis.__TEST_DASHBOARD_PERMISSIONS__ = ['inventory.adjust', 'inventory.view'];
  const inventoryOnlyPageHtml = renderToStaticMarkup(createElement(DashboardCatalogPage));
  // @ts-expect-error test hook cleanup
  delete globalThis.__TEST_DASHBOARD_PERMISSIONS__;

  assert.ok(
    !inventoryOnlyPageHtml.includes('Thêm danh mục') &&
      !inventoryOnlyPageHtml.includes('Add Category'),
    'DashboardCatalogPage must NOT render category create control for inventory-only members'
  );
  assert.ok(
    inventoryOnlyPageHtml.includes('data-testid="catalog-loading-state"'),
    'Inventory-only members must still see the standard catalog loading state and menu navigation'
  );
});

test('Web and Mobile catalog UI callers send narrow item patches, attach expected_stock_quantity on stock updates, and refresh on STOCK_CONFLICT', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const catalogPageSource = readFileSync(
    path.join(process.cwd(), 'src/app/(dashboard)/dashboard/catalog/page.tsx'),
    'utf8'
  );
  const excelModalSource = readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/CatalogExcelImportModal.tsx'),
    'utf8'
  );
  const translationModalSource = readFileSync(
    path.join(process.cwd(), 'src/components/dashboard/TranslationEditorModal.tsx'),
    'utf8'
  );
  const mobileCatalogSource = readFileSync(
    path.join(process.cwd(), 'mobile/src/components/tabs/CatalogTab.tsx'),
    'utf8'
  );

  // 1. DashboardCatalogPage sends narrow patches and expected_stock_quantity on stock updates, and reloads on 409/STOCK_CONFLICT
  assert.ok(
    catalogPageSource.includes('expected_stock_quantity: prevStock'),
    'DashboardCatalogPage handleUpdateStock must pass expected_stock_quantity: prevStock for atomic CAS'
  );
  assert.ok(
    catalogPageSource.includes(".code === 'STOCK_CONFLICT'") &&
      catalogPageSource.includes('res.status === 409') &&
      catalogPageSource.includes('void loadCatalog(true)'),
    'DashboardCatalogPage upsertItem must detect 409 / STOCK_CONFLICT and refresh catalog data'
  );
  assert.ok(
    !catalogPageSource.includes('upsertItem({ ...item, price') &&
      !catalogPageSource.includes('upsertItem({ ...item, is_featured') &&
      !catalogPageSource.includes('upsertItem({ ...item, image_url'),
    'DashboardCatalogPage quick handlers must not spread full stale item snapshots on price/featured/image edits'
  );

  // 2. CatalogExcelImportModal uses buildCatalogExcelBulkUpdateItems and refreshes catalog when updatedCount > 0 or STOCK_CONFLICT occurs
  assert.ok(
    excelModalSource.includes('buildCatalogExcelBulkUpdateItems(') &&
      excelModalSource.includes('validationResult.validRows'),
    'CatalogExcelImportModal must build narrow bulk update payloads via buildCatalogExcelBulkUpdateItems'
  );
  assert.ok(
    excelModalSource.includes("r.code === 'STOCK_CONFLICT'") &&
      excelModalSource.includes("data?.code === 'STOCK_CONFLICT'"),
    'CatalogExcelImportModal must handle STOCK_CONFLICT responses and refresh catalog state'
  );

  // 3. TranslationEditorModal does not unconditionally overwrite stock_quantity or unchanged is_available on existing items
  assert.ok(
    translationModalSource.includes('isAvailable !== editingItem.is_available'),
    'TranslationEditorModal must only send is_available on existing items when explicitly toggled'
  );

  // 4. Mobile CatalogTab sends narrow patches, passes expected_stock_quantity: prevStock, and refreshes shop data on failure/conflict
  assert.ok(
    mobileCatalogSource.includes('expected_stock_quantity: prevStock'),
    'Mobile CatalogTab handleUpdateItemStock must send expected_stock_quantity: prevStock'
  );
  assert.ok(
    !mobileCatalogSource.includes('item: { ...item, price:') &&
      !mobileCatalogSource.includes('item: { ...item, is_available:'),
    'Mobile CatalogTab must not spread full stale item objects on price or availability edits'
  );
  assert.ok(
    mobileCatalogSource.includes('onReloadShopData(activeShop?.id)'),
    'Mobile CatalogTab must reload shop data when a stock update conflicts or fails'
  );
});
