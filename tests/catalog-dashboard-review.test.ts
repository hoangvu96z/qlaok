import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCategoryNameI18n,
  getCategoryRenameAction,
  isCurrentCatalogRequest,
  isCurrentCatalogShop,
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

test('isCurrentCatalogShop guards actions, confirmation, and responses against shop-switch races', () => {
  // Reject when active shop has changed
  assert.equal(
    isCurrentCatalogShop({
      actionShopId: 'shop-a',
      currentShopId: 'shop-b',
    }),
    false,
    'Operations initiated for shop-a must be rejected after switching to shop-b'
  );

  // Reject when current shop is unset or blank
  assert.equal(
    isCurrentCatalogShop({
      actionShopId: 'shop-a',
      currentShopId: null,
    }),
    false,
    'Operations must be rejected when active shop becomes null'
  );
  assert.equal(
    isCurrentCatalogShop({
      actionShopId: 'shop-a',
      currentShopId: undefined,
    }),
    false
  );
  assert.equal(
    isCurrentCatalogShop({
      actionShopId: '',
      currentShopId: '',
    }),
    false,
    'Empty shop id cannot match'
  );

  // Accept when action shop id matches current active shop
  assert.equal(
    isCurrentCatalogShop({
      actionShopId: 'shop-a',
      currentShopId: 'shop-a',
    }),
    true,
    'Operations must proceed when shop context matches the current active shop'
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
    mobileCatalogSource.includes('onReloadShopData(activeShop?.id)') ||
      mobileCatalogSource.includes('reloadCatalogItemsSilently(activeShop?.id'),
    'Mobile CatalogTab must reload shop data when a stock update conflicts or fails'
  );
});

test('Bug 4 & Bug 5 regression: TranslationEditorModal and DashboardCatalogPage reflect server zero-stock normalization, refresh on 409 conflicts, and preserve user drafts', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const ts = (await import('typescript')).default;

  type VNode = {
    type: unknown;
    props: Record<string, unknown>;
  };

  function createStatefulHarness() {
    const states: unknown[] = [];
    const refs: Array<{ current: unknown }> = [];
    const effects: Array<{ deps?: unknown[]; fn: () => void | (() => void) }> =
      [];
    const callbacks: Array<{ deps?: unknown[]; fn: unknown }> = [];
    let cursor = 0;
    let refCursor = 0;
    let effectCursor = 0;
    let callbackCursor = 0;

    let stateMutated = false;
    const pendingEffects: Array<() => void | (() => void)> = [];

    const reactMock = {
      useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
        const idx = cursor++;
        if (!(idx in states)) {
          states[idx] =
            typeof initial === 'function' ? (initial as () => T)() : initial;
        }
        const setState = (next: T | ((prev: T) => T)) => {
          const prev = states[idx] as T;
          const resolved =
            typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
          if (!Object.is(prev, resolved)) {
            stateMutated = true;
          }
          states[idx] = resolved;
        };
        return [states[idx] as T, setState];
      },
      useRef<T>(initial: T): { current: T } {
        const idx = refCursor++;
        if (!refs[idx]) {
          refs[idx] = { current: initial };
        }
        return refs[idx] as { current: T };
      },
      useCallback<T extends (...args: never[]) => unknown>(
        fn: T,
        deps?: unknown[]
      ): T {
        const idx = callbackCursor++;
        const prev = callbacks[idx];
        const changed =
          !prev ||
          !deps ||
          !prev.deps ||
          deps.length !== prev.deps.length ||
          deps.some((d, i) => !Object.is(d, prev.deps![i]));
        if (changed) {
          callbacks[idx] = { deps, fn };
        }
        return callbacks[idx].fn as T;
      },
      useMemo<T>(fn: () => T): T {
        return fn();
      },
      useEffect(fn: () => void | (() => void), deps?: unknown[]) {
        const idx = effectCursor++;
        const prev = effects[idx];
        const changed =
          !prev ||
          !deps ||
          !prev.deps ||
          deps.length !== prev.deps.length ||
          deps.some((d, i) => !Object.is(d, prev.deps![i]));
        effects[idx] = { deps, fn };
        if (changed) {
          pendingEffects.push(fn);
        }
      },
      createElement(
        type: unknown,
        props: Record<string, unknown> | null,
        ...children: unknown[]
      ): VNode {
        const flatChildren = children.flat(Infinity);
        return {
          type,
          props: {
            ...(props || {}),
            children:
              flatChildren.length === 0
                ? undefined
                : flatChildren.length === 1
                  ? flatChildren[0]
                  : flatChildren,
          },
        };
      },
      Fragment: 'Fragment',
    };

    function render<P>(Component: (props: P) => VNode | null, props: P): VNode | null {
      let out: VNode | null = null;
      for (let pass = 0; pass < 4; pass++) {
        cursor = 0;
        refCursor = 0;
        effectCursor = 0;
        callbackCursor = 0;
        stateMutated = false;
        pendingEffects.length = 0;
        out = Component(props);
        if (pendingEffects.length === 0) break;
        const toRun = pendingEffects.splice(0, pendingEffects.length);
        for (const eff of toRun) {
          eff();
        }
        if (!stateMutated) break;
      }
      return out;
    }

    return { reactMock, render };
  }

  function findNodes(
    node: unknown,
    predicate: (vnode: VNode) => boolean,
    acc: VNode[] = []
  ): VNode[] {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      for (const child of node) findNodes(child, predicate, acc);
      return acc;
    }
    const vnode = node as VNode;
    if ('type' in vnode && 'props' in vnode && vnode.props) {
      if (predicate(vnode)) acc.push(vnode);
      if (vnode.props.children) {
        findNodes(vnode.props.children, predicate, acc);
      }
    }
    return acc;
  }

  function loadComponentModule<T>(
    relPath: string,
    reactMock: Record<string, unknown>,
    customStubs: Record<string, unknown>
  ): T {
    const fullPath = path.join(process.cwd(), relPath);
    const source = readFileSync(fullPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
      fileName: fullPath,
    });
    const exportsObj: Record<string, unknown> = {};
    const moduleObj = { exports: exportsObj };
    const req = (id: string): unknown => {
      if (id === 'react') return { ...reactMock, default: reactMock };
      if (id in customStubs) return customStubs[id];
      throw new Error(`Unstubbed import in test harness: ${id}`);
    };
    const fn = new Function('exports', 'require', 'module', transpiled.outputText);
    fn(exportsObj, req, moduleObj);
    return moduleObj.exports as T;
  }

  const i18nStub = {
    useAppI18n: () => ({
      locale: 'vi',
      t: (k: string) => k,
      tx: (vi: string, _en: string, vars?: Record<string, unknown>) => {
        let out = vi;
        if (vars) {
          for (const [k, v] of Object.entries(vars)) {
            out = out.replace(`{${k}}`, String(v));
          }
        }
        return out;
      },
    }),
  };

  const lucideStub = new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    }
  );

  // ---------------------------------------------------------------------------
  // Part A: TranslationEditorModal (Bug 4 + draft preservation on conflict/reload)
  // ---------------------------------------------------------------------------
  const modalHarness = createStatefulHarness();
  const modalFetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let nextModalResponse: { status: number; body: Record<string, unknown> } = {
    status: 409,
    body: {
      error: 'Tồn kho của món đã thay đổi bởi thao tác khác.',
      code: 'STOCK_CONFLICT',
    },
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      modalFetchCalls.push({ url, body });
      return new Response(JSON.stringify(nextModalResponse.body), {
        status: nextModalResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const { TranslationEditorModal } = loadComponentModule<{
      TranslationEditorModal: (props: Record<string, unknown>) => VNode | null;
    }>('src/components/dashboard/TranslationEditorModal.tsx', modalHarness.reactMock, {
      '@/lib/app-i18n': { appLanguageName: (l: string) => l },
      'lucide-react': lucideStub,
      '@/lib/i18n-helper': {
        ALL_LOCALES: ['vi', 'en'],
        LOCALE_META: {
          vi: { label: 'Tiếng Việt' },
          en: { label: 'English' },
        },
        formatCurrency: (n: number) => `${n}đ`,
      },
      '@/components/ui/FlagIcon': { FlagIcon: 'FlagIcon' },
      '@/lib/upload-helper': { uploadCompressedImage: async () => '' },
      '@/lib/item-options-presets': {
        ITEM_OPTION_GROUP_PRESETS: [],
        normalizeAndTranslateOptionGroups: (g: unknown) => g,
      },
      '@/components/ui/AppI18nProvider': i18nStub,
      'next/link': { default: 'Link' },
      '@/lib/auth-session': { getAuthHeaders: (h?: Record<string, string>) => h || {} },
      '@/lib/plan-limits': { formatPlanLimitError: () => null },
    });

    const zeroStockItem: CatalogItem = {
      ...sampleItem,
      id: 'item-zero-modal',
      price: 35000,
      stock_quantity: 0,
      is_available: false,
    };

    let closeCalls = 0;
    let conflictCalls = 0;
    const savedCalls: Array<{
      item?: CatalogItem;
      meta?: { requestedAvailable?: boolean };
    }> = [];

    const renderModal = (categoriesOverride: Category[] = [sampleCategory]) =>
      modalHarness.render(TranslationEditorModal, {
        isOpen: true,
        onClose: () => {
          closeCalls++;
        },
        shopId: 'shop-test',
        vertical: 'fnb',
        categories: categoriesOverride,
        editingItem: zeroStockItem,
        defaultCategoryId: 'cat-1',
        onConflict: () => {
          conflictCalls++;
        },
        onSaved: (
          savedItem?: CatalogItem,
          meta?: { requestedAvailable?: boolean }
        ) => {
          savedCalls.push({ item: savedItem, meta });
        },
      });

    let tree = renderModal();
    assert.ok(tree, 'TranslationEditorModal must render when isOpen=true');

    // User edits price to 55000 and checks the "isAvailable" checkbox
    const inputs = findNodes(tree, (n) => n.type === 'input');
    const priceInput = inputs.find((n) => n.props.value === '35000');
    const checkboxes = inputs.filter((n) => n.props.type === 'checkbox');
    const availableCheckbox = checkboxes[1];
    assert.ok(priceInput, 'Price input must be present');
    assert.ok(availableCheckbox, 'Availability checkbox must be present');
    assert.equal(availableCheckbox.props.checked, false);

    (priceInput.props.onChange as (e: unknown) => void)({
      target: { value: '55000' },
    });
    (availableCheckbox.props.onChange as (e: unknown) => void)({
      target: { checked: true },
    });

    // Background catalog refresh passes a brand new categories array reference while modal is open:
    // user draft (price='55000', isAvailable=true) MUST be preserved!
    tree = renderModal([{ ...sampleCategory }]);
    const inputsAfterRefresh = findNodes(tree, (n) => n.type === 'input');
    assert.ok(
      inputsAfterRefresh.some((n) => n.props.value === '55000'),
      'Open TranslationEditorModal must preserve unsaved price draft across background catalog refreshes'
    );
    assert.equal(
      inputsAfterRefresh.filter((n) => n.props.type === 'checkbox')[1].props
        .checked,
      true,
      'Open TranslationEditorModal must preserve unsaved isAvailable draft across background catalog refreshes'
    );

    // Case 1: Server returns 409 STOCK_CONFLICT -> onConflict() called, modal stays open, draft preserved
    const formNode = findNodes(tree, (n) => n.type === 'form')[0];
    await (formNode.props.onSubmit as (e: unknown) => Promise<void>)({
      preventDefault: () => {},
    });
    assert.equal(
      conflictCalls,
      1,
      'TranslationEditorModal must invoke onConflict when server returns 409 STOCK_CONFLICT'
    );
    assert.equal(closeCalls, 0, 'Modal must stay open on 409 conflict');
    assert.equal(savedCalls.length, 0);

    // Case 2 (Bug 4): Server returns 200 OK with price=55000, but normalizes is_available=false because stock_quantity=0
    nextModalResponse = {
      status: 200,
      body: {
        item: {
          ...zeroStockItem,
          price: 55000,
          stock_quantity: 0,
          is_available: false,
        },
      },
    };
    tree = renderModal();
    const formNode2 = findNodes(tree, (n) => n.type === 'form')[0];
    await (formNode2.props.onSubmit as (e: unknown) => Promise<void>)({
      preventDefault: () => {},
    });

    assert.equal(
      savedCalls.length,
      1,
      'onSaved must be called with the canonical server item'
    );
    assert.equal(savedCalls[0].item?.price, 55000);
    assert.equal(savedCalls[0].item?.is_available, false);
    assert.equal(savedCalls[0].meta?.requestedAvailable, true);
    assert.equal(
      closeCalls,
      0,
      'Bug 4 regression: modal must NOT close silently when requested is_available=true was normalized to false by the server'
    );

    tree = renderModal();
    const updatedAvailCheckbox = findNodes(
      tree,
      (n) => n.type === 'input' && n.props.type === 'checkbox'
    )[1];
    assert.equal(
      updatedAvailCheckbox.props.checked,
      false,
      'Bug 4 regression: modal checkbox must reflect server-returned is_available=false'
    );
    const treeText = JSON.stringify(tree);
    assert.ok(
      treeText.includes('tồn kho bằng 0 nên máy chủ tiếp tục giữ trạng thái hết hàng'),
      'Bug 4 regression: modal must display inline explanation that the server kept the item sold out due to 0 stock'
    );

    // -------------------------------------------------------------------------
    // Part B: DashboardCatalogPage (Bug 4 onSaved handling + Bug 5 409 refresh
    //         on handleToggleAvailable / handleBulkSetAvailability / handleUpdateStock
    //         while preserving drafts)
    // -------------------------------------------------------------------------
    const pageHarness = createStatefulHarness();
    let serverItemsState: CatalogItem[] = [
      {
        ...sampleItem,
        id: 'item-1',
        price: 35000,
        stock_quantity: 5,
        is_available: false,
      },
      {
        ...sampleItem,
        id: 'item-2',
        name_i18n: { vi: 'Bạc xỉu', en: 'White Coffee' },
        price: 40000,
        stock_quantity: 5,
        is_available: true,
      },
    ];
    let catalogGetCount = 0;
    const postPayloads: Array<Record<string, unknown>> = [];
    let nextPostResponse: { status: number; body: Record<string, unknown> } = {
      status: 409,
      body: {
        error: 'Món đang có tồn kho bằng 0 nên không thể bật còn hàng.',
        code: 'ZERO_STOCK_CANNOT_MARK_AVAILABLE',
      },
    };

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        catalogGetCount++;
        return new Response(
          JSON.stringify({
            categories: [sampleCategory],
            items: serverItemsState,
            ownerPlan: 'premium',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const body = init.body ? JSON.parse(String(init.body)) : {};
      postPayloads.push(body);
      return new Response(JSON.stringify(nextPostResponse.body), {
        status: nextPostResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const QuickItemRowSymbol = 'QuickItemRow';
    const TranslationEditorModalSymbol = 'TranslationEditorModal';
    const dashboardCatalogReal = await import('@/lib/dashboard-catalog');
    const catalogPaginationReal = await import('@/lib/catalog-pagination');
    const catalogExcelReal = await import('@/lib/catalog-excel');
    const planLimitsReal = await import('@/lib/plan-limits');

    const activeShopStub = {
      id: 'shop-test',
      name: 'Test Shop',
      vertical: 'fnb',
    };
    const activeMembershipStub = {
      id: 'mem-1',
      shop_id: 'shop-test',
      user_id: 'user-1',
      role: 'owner',
      is_active: true,
      permissions: ['catalog.manage', 'inventory.adjust', 'inventory.view'],
    };
    const profileStub = { id: 'user-1', plan: 'premium' };
    const getAuthHeadersStub = (h?: Record<string, string>) => h || {};

    const { default: CatalogPage } = loadComponentModule<{
      default: () => VNode | null;
    }>('src/app/(dashboard)/dashboard/catalog/page.tsx', pageHarness.reactMock, {
      'next/link': { default: 'Link' },
      'lucide-react': lucideStub,
      '@/lib/auth-session': { getAuthHeaders: getAuthHeadersStub },
      '@/lib/dashboard-context': {
        useDashboard: () => ({
          activeShop: activeShopStub,
          activeMembership: activeMembershipStub,
          profile: profileStub,
        }),
      },
      '@/lib/dashboard-nav': { membershipHasPermission: () => true },
      '@/lib/plan-limits': planLimitsReal,
      '@/components/dashboard/QuickItemRow': { QuickItemRow: QuickItemRowSymbol },
      '@/components/dashboard/TranslationEditorModal': {
        TranslationEditorModal: TranslationEditorModalSymbol,
      },
      '@/components/ui/AppI18nProvider': i18nStub,
      '@/components/ui/ConfirmDialog': {
        useConfirmDialog: () => ({
          confirm: async () => true,
          confirmDialog: null,
        }),
      },
      '@/lib/catalog-pagination': catalogPaginationReal,
      '@/lib/catalog-excel': catalogExcelReal,
      '@/components/dashboard/CatalogExcelImportModal': {
        CatalogExcelImportModal: 'CatalogExcelImportModal',
      },
      '@/lib/dashboard-catalog': dashboardCatalogReal,
    });

    // Initial render triggers loadCatalog()
    let pageTree = pageHarness.render(CatalogPage, {});
    await new Promise((r) => setTimeout(r, 10));
    pageTree = pageHarness.render(CatalogPage, {});
    assert.equal(catalogGetCount, 1, 'Initial mount must load catalog once');

    // User enters a category name draft and selects both items + enters a bulk price draft
    const catDraftInput = findNodes(
      pageTree,
      (n) =>
        n.type === 'input' &&
        typeof n.props.placeholder === 'string' &&
        n.props.placeholder.includes('danh mục mới')
    )[0];
    assert.ok(catDraftInput, 'Category creation draft input must exist');
    (catDraftInput.props.onChange as (e: unknown) => void)({
      target: { value: 'Món tráng miệng' },
    });

    let rowNodes = findNodes(pageTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(rowNodes.length, 2, 'Both catalog items must render');
    (
      rowNodes[0].props.onToggleSelect as (id: string, next: boolean) => void
    )('item-1', true);
    (
      rowNodes[1].props.onToggleSelect as (id: string, next: boolean) => void
    )('item-2', true);

    pageTree = pageHarness.render(CatalogPage, {});
    const bulkPriceInput = findNodes(
      pageTree,
      (n) => n.props['data-testid'] === 'catalog-bulk-price-input'
    )[0];
    assert.ok(bulkPriceInput, 'Bulk price input must render when items are selected');
    (bulkPriceInput.props.onChange as (e: unknown) => void)({
      target: { value: '49000' },
    });

    // 1. Bug 5a: Single-row handleToggleAvailable on item-1 fails with 409 ZERO_STOCK_CANNOT_MARK_AVAILABLE
    //    because server stock became 0 -> must reload catalog from server and preserve drafts!
    serverItemsState = [
      { ...serverItemsState[0], stock_quantity: 0, is_available: false },
      serverItemsState[1],
    ];
    rowNodes = findNodes(pageTree, (n) => n.type === QuickItemRowSymbol);
    const toggleOk = await (
      rowNodes[0].props.onToggleAvailable as (
        item: CatalogItem,
        next: boolean
      ) => Promise<boolean>
    )(rowNodes[0].props.item as CatalogItem, true);
    assert.equal(toggleOk, false);
    await new Promise((r) => setTimeout(r, 10));
    pageTree = pageHarness.render(CatalogPage, {});

    assert.equal(
      catalogGetCount,
      2,
      'Bug 5 regression: handleToggleAvailable must call loadCatalog(true) on HTTP 409'
    );
    rowNodes = findNodes(pageTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(
      (rowNodes[0].props.item as CatalogItem).stock_quantity,
      0,
      'Refreshed item-1 must show canonical server stock_quantity=0'
    );

    // 2. Bug 5b: Bulk handleBulkSetAvailability fails with 409 ZERO_STOCK_CANNOT_MARK_AVAILABLE
    //    while item-2 was concurrently updated on the server to stock_quantity=1 -> must reload catalog and preserve bulk drafts!
    serverItemsState = [
      serverItemsState[0],
      { ...serverItemsState[1], stock_quantity: 1, price: 42000 },
    ];
    const bulkAvailBtn = findNodes(
      pageTree,
      (n) => n.props['data-testid'] === 'catalog-bulk-available-btn'
    )[0];
    assert.ok(bulkAvailBtn, 'Bulk mark-available button must exist');
    await (bulkAvailBtn.props.onClick as () => Promise<void>)();
    await new Promise((r) => setTimeout(r, 10));
    pageTree = pageHarness.render(CatalogPage, {});

    assert.equal(
      catalogGetCount,
      3,
      'Bug 5 regression: handleBulkSetAvailability must call loadCatalog(true) on HTTP 409'
    );
    rowNodes = findNodes(pageTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(
      (rowNodes[1].props.item as CatalogItem).stock_quantity,
      1,
      'Refreshed item-2 must show canonical server stock_quantity=1 after bulk 409 reload'
    );

    // Verify all user drafts (category draft, bulk selection, bulk price input) are still intact!
    const catDraftAfterBulk409 = findNodes(
      pageTree,
      (n) =>
        n.type === 'input' &&
        typeof n.props.placeholder === 'string' &&
        n.props.placeholder.includes('danh mục mới')
    )[0];
    assert.equal(
      catDraftAfterBulk409.props.value,
      'Món tráng miệng',
      'Category draft must be preserved across 409 conflict reloads'
    );
    const bulkPriceAfterBulk409 = findNodes(
      pageTree,
      (n) => n.props['data-testid'] === 'catalog-bulk-price-input'
    )[0];
    assert.equal(
      bulkPriceAfterBulk409.props.value,
      '49000',
      'Bulk price draft and item selection must be preserved across 409 conflict reloads'
    );

    // 3. Bug 5c: handleUpdateStock on 409 STOCK_CONFLICT must rollback BEFORE loadCatalog(true)
    //    so fresh server stock_quantity=3 is NOT clobbered by rollbackItem!
    nextPostResponse = {
      status: 409,
      body: {
        error: 'Tồn kho của món đã thay đổi bởi thao tác khác.',
        code: 'STOCK_CONFLICT',
      },
    };
    serverItemsState = [
      serverItemsState[0],
      { ...serverItemsState[1], stock_quantity: 3, is_available: true },
    ];
    const stockOk = await (
      rowNodes[1].props.onUpdateStock as (
        item: CatalogItem,
        nextStock: number | null
      ) => Promise<boolean>
    )(rowNodes[1].props.item as CatalogItem, 15);
    assert.equal(stockOk, false);
    await new Promise((r) => setTimeout(r, 10));
    pageTree = pageHarness.render(CatalogPage, {});

    assert.equal(catalogGetCount, 4);
    rowNodes = findNodes(pageTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(
      (rowNodes[1].props.item as CatalogItem).stock_quantity,
      3,
      'After 409 STOCK_CONFLICT on handleUpdateStock, item must reflect fresh server stock_quantity=3 rather than stale rollback value'
    );

    // 4. Bug 4 on DashboardCatalogPage: TranslationEditorModal onSaved with requestedAvailable=true
    //    and savedItem.is_available=false must set mutationError and NOT show false-positive success toast
    const modalNode = findNodes(
      pageTree,
      (n) => n.type === TranslationEditorModalSymbol
    )[0];
    assert.ok(modalNode, 'TranslationEditorModal node must exist on page');
    (
      modalNode.props.onSaved as (
        savedItem?: CatalogItem,
        meta?: { requestedAvailable?: boolean }
      ) => void
    )(
      {
        ...serverItemsState[0],
        price: 55000,
        stock_quantity: 0,
        is_available: false,
      },
      { requestedAvailable: true }
    );
    pageTree = pageHarness.render(CatalogPage, {});
    const pageJson = JSON.stringify(pageTree);
    assert.ok(
      pageJson.includes('tồn kho bằng 0 nên máy chủ tiếp tục giữ trạng thái hết hàng'),
      'DashboardCatalogPage must show mutation error banner when modal save kept item sold out due to 0 stock'
    );
    assert.ok(
      !pageJson.includes('Đã lưu món và cập nhật bản dịch 8 ngôn ngữ!'),
      'DashboardCatalogPage must NOT show green success toast when requested availability was rejected by 0 stock'
    );

    // 5. Shop-switch race regression: bulk operations confirmed or arriving after a shop switch
    //    must not mutate the newly active shop's state or display toast/banner for the old shop.
    let switchShopActiveId = 'shop-test';
    let confirmResolver: ((val: boolean) => void) | null = null;
    let fetchResolver: ((res: Response) => void) | null = null;
    let fetchCallCount = 0;
    const fetchShopIdsDispatched: string[] = [];

    const raceActiveShop = {
      get id() {
        return switchShopActiveId;
      },
      name: 'Active Shop',
      vertical: 'fnb',
    };

    const raceHarness = createStatefulHarness();
    const { default: RaceCatalogPage } = loadComponentModule<{
      default: () => VNode | null;
    }>('src/app/(dashboard)/dashboard/catalog/page.tsx', raceHarness.reactMock, {
      'next/link': { default: 'Link' },
      'lucide-react': lucideStub,
      '@/lib/auth-session': { getAuthHeaders: getAuthHeadersStub },
      '@/lib/dashboard-context': {
        useDashboard: () => ({
          activeShop: raceActiveShop,
          activeMembership: activeMembershipStub,
          profile: profileStub,
        }),
      },
      '@/lib/dashboard-nav': { membershipHasPermission: () => true },
      '@/lib/plan-limits': planLimitsReal,
      '@/components/dashboard/QuickItemRow': { QuickItemRow: QuickItemRowSymbol },
      '@/components/dashboard/TranslationEditorModal': {
        TranslationEditorModal: TranslationEditorModalSymbol,
      },
      '@/components/ui/AppI18nProvider': i18nStub,
      '@/components/ui/ConfirmDialog': {
        useConfirmDialog: () => ({
          confirm: () =>
            new Promise<boolean>((resolve) => {
              confirmResolver = resolve;
            }),
          confirmDialog: null,
        }),
      },
      '@/lib/catalog-pagination': catalogPaginationReal,
      '@/lib/catalog-excel': catalogExcelReal,
      '@/components/dashboard/CatalogExcelImportModal': {
        CatalogExcelImportModal: 'CatalogExcelImportModal',
      },
      '@/lib/dashboard-catalog': dashboardCatalogReal,
    });

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(
          JSON.stringify({
            categories: [sampleCategory],
            items: [
              {
                ...sampleItem,
                id: 'item-1',
                shop_id: switchShopActiveId,
                is_available: false,
              },
              {
                ...sampleItem,
                id: 'item-2',
                shop_id: switchShopActiveId,
                is_available: false,
              },
            ],
            ownerPlan: 'premium',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      fetchCallCount++;
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (body.shopId) {
        fetchShopIdsDispatched.push(body.shopId);
      }
      return new Promise<Response>((resolve) => {
        fetchResolver = resolve;
      });
    }) as typeof fetch;

    let raceTree = raceHarness.render(RaceCatalogPage, {});
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      raceTree = raceHarness.render(RaceCatalogPage, {});
      if (findNodes(raceTree, (n) => n.type === QuickItemRowSymbol).length === 2) {
        break;
      }
    }

    // Select item-1 for bulk deletion
    let raceRows = findNodes(raceTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(raceRows.length, 2, 'Two rows must be loaded before selecting');
    (raceRows[0].props.onToggleSelect as (id: string, next: boolean) => void)(
      'item-1',
      true
    );
    raceTree = raceHarness.render(RaceCatalogPage, {});

    const deleteBtn = findNodes(
      raceTree,
      (n) => n.props['data-testid'] === 'catalog-bulk-delete-btn'
    )[0];
    assert.ok(deleteBtn, 'Bulk delete button must be present when items selected');

    // Trigger bulk delete -> enters confirmation dialog
    const deletePromise = (deleteBtn.props.onClick as () => Promise<void>)();

    // While confirmation dialog is pending, switch active shop to 'shop-other'!
    switchShopActiveId = 'shop-other';
    raceTree = raceHarness.render(RaceCatalogPage, {});
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      raceTree = raceHarness.render(RaceCatalogPage, {});
    }

    // Now user confirms delete in dialog
    assert.ok(confirmResolver !== null, 'Confirmation resolver must be waiting');
    confirmResolver!(true);
    await deletePromise;
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(
      fetchCallCount,
      0,
      'When shop switches while confirm dialog is open, POST /api/catalog bulk delete must NOT be dispatched for the stale shop'
    );
    assert.equal(fetchShopIdsDispatched.length, 0);

    // Test in-flight race: start bulk availability on shop-other, then switch shop while fetch is in-flight
    raceRows = findNodes(raceTree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(raceRows.length, 2, 'Two rows must be loaded for shop-other');
    (raceRows[0].props.onToggleSelect as (id: string, next: boolean) => void)(
      'item-1',
      true
    );
    raceTree = raceHarness.render(RaceCatalogPage, {});
    const bulkAvailBtn2 = findNodes(
      raceTree,
      (n) => n.props['data-testid'] === 'catalog-bulk-available-btn'
    )[0];
    assert.ok(bulkAvailBtn2, 'Bulk available button must exist');

    const availPromise = (bulkAvailBtn2.props.onClick as () => Promise<void>)();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      fetchCallCount,
      1,
      'POST /api/catalog bulk availability should be in-flight'
    );
    assert.equal(fetchShopIdsDispatched[0], 'shop-other');

    // Merchant switches back to 'shop-test' before server response returns
    switchShopActiveId = 'shop-test';
    raceTree = raceHarness.render(RaceCatalogPage, {});

    // Resolve in-flight response from shop-other
    assert.ok(fetchResolver !== null, 'Fetch resolver must be active');
    fetchResolver!(
      new Response(
        JSON.stringify({
          success: true,
          updatedCount: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await availPromise;
    await new Promise((r) => setTimeout(r, 10));

    raceTree = raceHarness.render(RaceCatalogPage, {});
    const raceJson = JSON.stringify(raceTree);
    raceRows = findNodes(raceTree, (n) => n.type === QuickItemRowSymbol);
    const staleShopRowItem = raceRows[0]?.props.item as
      | { is_available?: unknown }
      | undefined;
    assert.equal(
      staleShopRowItem?.is_available,
      false,
      'Stale availability response must not update the newly active shop item'
    );
    assert.ok(
      !raceJson.includes('Đã bật còn hàng cho 1 món'),
      'Stale in-flight bulk response from shop-other must NOT display success message in shop-test'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
