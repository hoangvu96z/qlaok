import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExcelJS from 'exceljs';
import ts from 'typescript';
import { QuickItemRow } from '@/components/dashboard/QuickItemRow';
import { isNumpadModeAllowed } from '@/components/dashboard/PosCounterWorkspace';
import {
  buildCatalogExcelBulkUpdateItems,
  parseAndValidateCatalogExcel,
} from '@/lib/catalog-excel';
import { membershipHasPermission } from '@/lib/dashboard-nav';
import type {
  CatalogItem,
  Category,
  ShopMembership,
} from '@/types/qlaok';

// Synthetic seed data only; no production APIs or credentials.
const item = {
  id: 'item-1',
  shop_id: 'shop-test',
  category_id: 'cat-1',
  name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
  desc_i18n: { vi: '', en: '' },
  price: 35000,
  is_available: true,
  is_featured: false,
  image_url: 'https://example.invalid/coffee.png',
  stock_quantity: 5,
  options_json: [],
  view_count: 0,
  sort_order: 1,
} as unknown as CatalogItem;

const itemWithOptions: CatalogItem = {
  ...item,
  id: 'item-with-opts',
  options_json: [
    {
      id: 'opt-ice',
      name_i18n: { vi: 'Mức đá', en: 'Ice Level' },
      required: true,
      choices: [
        {
          id: 'ice-normal',
          label_i18n: { vi: 'Đá vừa', en: 'Regular ice' },
          extra_price: 0,
        },
      ],
    },
    {
      id: 'opt-sugar',
      name_i18n: { vi: 'Mức đường', en: 'Sugar Level' },
      required: false,
      choices: [
        {
          id: 'sugar-50',
          label_i18n: { vi: '50% đường', en: '50% sugar' },
          extra_price: 0,
        },
      ],
    },
  ],
};

function renderRow(
  canManageCatalog: boolean,
  canAdjustInventory: boolean,
  targetItem: CatalogItem = item
) {
  return renderToStaticMarkup(
    React.createElement(QuickItemRow, {
      item: targetItem,
      canManageCatalog,
      canAdjustInventory,
      onToggleAvailable: async () => true,
      onUpdatePrice: async () => true,
      onUpdateStock: async () => true,
      onUpdateImage: async () => true,
      onToggleFeatured: async () => true,
      onEditTranslations: () => {},
      onDelete: async () => true,
    })
  );
}

const CATALOG_ONLY_ROW_MARKERS = [
  'data-testid="item-thumbnail-upload"',
  'data-testid="item-price-input"',
  'aria-label="Giá bán"',
  'data-testid="item-featured-toggle"',
  'aria-label="Nổi bật"',
  'data-testid="item-edit-translations-button"',
  'aria-label="Tùy chọn &amp; Dịch 8 ngôn ngữ"',
  'data-testid="item-change-photo-action"',
  'aria-label="Đổi ảnh món"',
  'data-testid="item-delete-button"',
  'aria-label="Xóa"',
] as const;

const INVENTORY_ROW_MARKERS = [
  'data-testid="item-availability-switch"',
  'aria-label="Đang còn hàng"',
  'data-testid="item-stock-input"',
  'aria-label="Số lượng tồn kho"',
] as const;

test('QuickItemRow: inventory-only member hides all catalog-only controls while catalog manager renders them (verified via stable test IDs and Vietnamese aria-labels)', () => {
  const inventoryOnlyHtml = renderRow(false, true);
  assert.equal(inventoryOnlyHtml.includes('type="file"'), false);
  assert.ok(inventoryOnlyHtml.includes('data-testid="item-thumbnail-preview"'));
  assert.ok(inventoryOnlyHtml.includes('coffee.png'));

  for (const marker of CATALOG_ONLY_ROW_MARKERS) {
    assert.equal(
      inventoryOnlyHtml.includes(marker),
      false,
      `Inventory-only row must NOT render catalog.manage marker: ${marker}`
    );
  }
  for (const marker of INVENTORY_ROW_MARKERS) {
    assert.equal(
      inventoryOnlyHtml.includes(marker),
      true,
      `Inventory-only row must keep inventory.adjust marker: ${marker}`
    );
  }

  // Positive control: prove every catalog-only marker above is genuinely present for catalog.manage
  const catalogManagerHtml = renderRow(true, true);
  assert.equal(catalogManagerHtml.split('type="file"').length - 1, 2);
  assert.equal(
    catalogManagerHtml.includes('data-testid="item-thumbnail-preview"'),
    false
  );
  for (const marker of CATALOG_ONLY_ROW_MARKERS) {
    assert.equal(
      catalogManagerHtml.includes(marker),
      true,
      `Catalog manager row MUST render catalog.manage marker: ${marker}`
    );
  }
  for (const marker of INVENTORY_ROW_MARKERS) {
    assert.equal(
      catalogManagerHtml.includes(marker),
      true,
      `Catalog manager row MUST render inventory.adjust marker: ${marker}`
    );
  }
});

test('QuickItemRow: options badge is read-only without catalog.manage and interactive with catalog.manage', () => {
  const inventoryOnlyHtml = renderRow(false, true, itemWithOptions);
  assert.ok(
    inventoryOnlyHtml.includes('data-testid="item-options-badge-readonly"'),
    'Inventory-only member must see a non-interactive options count badge'
  );
  assert.equal(
    inventoryOnlyHtml.includes('data-testid="item-options-badge-button"'),
    false,
    'Inventory-only member must NOT render an interactive options editor button'
  );
  assert.ok(inventoryOnlyHtml.includes('2 nhóm tùy chọn'));

  const catalogManagerHtml = renderRow(true, true, itemWithOptions);
  assert.ok(
    catalogManagerHtml.includes('data-testid="item-options-badge-button"'),
    'Catalog manager must render an interactive options badge button'
  );
  assert.ok(
    catalogManagerHtml.includes('title="Xem tùy chọn &amp; topping"'),
    'Catalog manager options badge button must carry Vietnamese accessible title'
  );
  assert.equal(
    catalogManagerHtml.includes('data-testid="item-options-badge-readonly"'),
    false
  );

  const unresolvedHtml = renderRow(false, false, itemWithOptions);
  assert.ok(
    /data-testid="catalog-item-checkbox-item-with-opts"[^>]*disabled=""/.test(
      unresolvedHtml
    ),
    'Row selection checkbox must be disabled when neither catalog.manage nor inventory.adjust is granted'
  );
  for (const marker of [...CATALOG_ONLY_ROW_MARKERS, ...INVENTORY_ROW_MARKERS]) {
    assert.equal(
      unresolvedHtml.includes(marker),
      false,
      `Unresolved membership row must omit control: ${marker}`
    );
  }
});

test('isNumpadModeAllowed gates disc and price on canApplyDiscount', () => {
  assert.equal(isNumpadModeAllowed('qty', false), true);
  assert.equal(isNumpadModeAllowed('disc', false), false);
  assert.equal(isNumpadModeAllowed('price', false), false);
  assert.equal(isNumpadModeAllowed('disc', true), true);
  assert.equal(isNumpadModeAllowed('price', true), true);
});

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
    useState<T>(
      initial: T | (() => T)
    ): [T, (next: T | ((prev: T) => T)) => void] {
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

  function render<P>(
    Component: (props: P) => VNode | null,
    props: P
  ): VNode | null {
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

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => collectText(child)).join(' ');
  }
  if (typeof node === 'object' && 'props' in (node as VNode)) {
    return collectText((node as VNode).props?.children);
  }
  return '';
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
  const fn = new Function(
    'exports',
    'require',
    'module',
    transpiled.outputText
  );
  fn(exportsObj, req, moduleObj);
  return moduleObj.exports as T;
}

test('DashboardCatalogPage: gates header/editor/handler mutations on catalog.manage vs inventory.adjust and fails closed when membership is missing', async () => {

  const sampleCategory: Category = {
    id: 'cat-1',
    shop_id: 'shop-test',
    name_i18n: { vi: 'Cà phê', en: 'Coffee' },
    sort_order: 1,
    is_active: true,
  };
  const freePlanItems: CatalogItem[] = Array.from({ length: 15 }, (_, idx) => ({
    ...itemWithOptions,
    id: `item-${idx + 1}`,
    sort_order: idx + 1,
  }));

  const QuickItemRowSymbol = 'QuickItemRow';
  const TranslationEditorModalSymbol = 'TranslationEditorModal';
  const CatalogExcelImportModalSymbol = 'CatalogExcelImportModal';
  const dashboardCatalogReal = await import('@/lib/dashboard-catalog');
  const catalogPaginationReal = await import('@/lib/catalog-pagination');
  const catalogExcelReal = await import('@/lib/catalog-excel');
  const planLimitsReal = await import('@/lib/plan-limits');

  let currentMembership: ShopMembership | null = null;
  let confirmCalls = 0;
  const mutationRequests: Array<{ method: string; url: string; body: unknown }> =
    [];

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            categories: [sampleCategory],
            items: freePlanItems,
            ownerPlan: 'free',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
      mutationRequests.push({
        method,
        url: String(input),
        body: parsedBody,
      });
      return new Response(
        JSON.stringify({
          item: {
            ...freePlanItems[0],
            stock_quantity: 9,
            is_available: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const harness = createStatefulHarness();
    const lucideStub = new Proxy(
      {},
      {
        get: (_target, prop) => String(prop),
      }
    );
    const activeShopStub = {
      id: 'shop-test',
      name: 'Test Shop',
      vertical: 'fnb',
    };
    const profileStub = { id: 'user-1', plan: 'free' };
    const { default: CatalogPage } = loadComponentModule<{
      default: () => VNode | null;
    }>('src/app/(dashboard)/dashboard/catalog/page.tsx', harness.reactMock, {
      'next/link': { default: 'Link' },
      'lucide-react': lucideStub,
      '@/lib/auth-session': {
        getAuthHeaders: (h?: Record<string, string>) => h || {},
      },
      '@/lib/dashboard-context': {
        useDashboard: () => ({
          activeShop: activeShopStub,
          activeMembership: currentMembership,
          profile: profileStub,
        }),
      },
      '@/lib/dashboard-nav': { membershipHasPermission },
      '@/lib/plan-limits': planLimitsReal,
      '@/components/dashboard/QuickItemRow': {
        QuickItemRow: QuickItemRowSymbol,
      },
      '@/components/dashboard/TranslationEditorModal': {
        TranslationEditorModal: TranslationEditorModalSymbol,
      },
      '@/components/dashboard/CatalogExcelImportModal': {
        CatalogExcelImportModal: CatalogExcelImportModalSymbol,
      },
      '@/components/ui/AppI18nProvider': {
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
      },
      '@/components/ui/ConfirmDialog': {
        useConfirmDialog: () => ({
          confirm: async () => {
            confirmCalls++;
            return true;
          },
          dialog: null,
        }),
      },
      '@/lib/catalog-pagination': catalogPaginationReal,
      '@/lib/catalog-excel': catalogExcelReal,
      '@/lib/dashboard-catalog': dashboardCatalogReal,
    });

    // 1. Missing/unresolved membership (null) -> fails closed on all catalog & inventory mutations
    let tree = harness.render(CatalogPage, {});
    await new Promise((r) => setTimeout(r, 10));
    tree = harness.render(CatalogPage, {});

    assert.equal(
      findNodes(tree, (n) => n.props['data-testid'] === 'catalog-add-item-btn')
        .length,
      0
    );
    assert.equal(
      findNodes(
        tree,
        (n) => n.props['data-testid'] === 'catalog-scan-menu-link'
      ).length,
      0
    );
    assert.equal(
      findNodes(
        tree,
        (n) => n.props['data-testid'] === 'catalog-import-excel-btn'
      ).length,
      0
    );
    assert.equal(
      findNodes(tree, (n) => n.props.href === '/dashboard/billing').length,
      0
    );
    const selectPageNull = findNodes(
      tree,
      (n) => n.props['data-testid'] === 'catalog-select-page-checkbox'
    )[0];
    assert.equal(selectPageNull.props.disabled, true);

    let rows = findNodes(tree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(rows.length, 15);
    assert.equal(rows[0].props.canManageCatalog, false);
    assert.equal(rows[0].props.canAdjustInventory, false);
    assert.equal(rows[0].props.selectionDisabled, true);
    const excelModalNull = findNodes(
      tree,
      (n) => n.type === CatalogExcelImportModalSymbol
    )[0];
    assert.equal(excelModalNull.props.isOpen, false);
    assert.equal(excelModalNull.props.canManageCatalog, false);

    await (
      rows[0].props.onToggleAvailable as (
        i: CatalogItem,
        next: boolean
      ) => Promise<boolean>
    )(freePlanItems[0], false);
    await (
      rows[0].props.onUpdateStock as (
        i: CatalogItem,
        next: number | null
      ) => Promise<boolean>
    )(freePlanItems[0], 2);
    await (rows[0].props.onDelete as (id: string) => Promise<boolean>)(
      freePlanItems[0].id
    );
    assert.equal(mutationRequests.length, 0);
    assert.equal(confirmCalls, 0);

    // 2. Inventory-only staff member (inventory.adjust without catalog.manage)
    currentMembership = {
      id: 'mem-staff',
      shop_id: 'shop-test',
      user_id: 'user-staff',
      role: 'staff',
      permissions: ['catalog.view', 'inventory.adjust'],
      is_active: true,
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-02T00:00:00.000Z',
    };
    tree = harness.render(CatalogPage, {});

    assert.equal(
      findNodes(tree, (n) => n.props['data-testid'] === 'catalog-add-item-btn')
        .length,
      0,
      'Inventory-only staff must NOT see the Add Item button'
    );
    assert.equal(
      findNodes(
        tree,
        (n) => n.props['data-testid'] === 'catalog-scan-menu-link'
      ).length,
      0,
      'Inventory-only staff must NOT see the Scan Menu Photo link'
    );
    assert.equal(
      findNodes(
        tree,
        (n) => n.props['data-testid'] === 'catalog-item-limit-hint'
      ).length,
      0,
      'Inventory-only staff must NOT see the item-limit creation banner'
    );
    assert.equal(
      findNodes(tree, (n) => n.props.href === '/dashboard/billing').length,
      0,
      'Non-owner staff must NOT see owner-only /dashboard/billing links'
    );

    const excelImportBtn = findNodes(
      tree,
      (n) => n.props['data-testid'] === 'catalog-import-excel-btn'
    )[0];
    assert.ok(
      excelImportBtn,
      'Inventory-only staff keeps Import Excel for bulk stock updates'
    );
    assert.ok(String(excelImportBtn.props.title).includes('tồn kho'));

    const selectPageStaff = findNodes(
      tree,
      (n) => n.props['data-testid'] === 'catalog-select-page-checkbox'
    )[0];
    assert.equal(selectPageStaff.props.disabled, false);

    rows = findNodes(tree, (n) => n.type === QuickItemRowSymbol);
    assert.equal(rows[0].props.canManageCatalog, false);
    assert.equal(rows[0].props.canAdjustInventory, true);
    assert.equal(rows[0].props.selectionDisabled, false);
    const excelModalStaff = findNodes(
      tree,
      (n) => n.type === CatalogExcelImportModalSymbol
    )[0];
    assert.equal(excelModalStaff.props.canManageCatalog, false);

    // Forbidden catalog.manage handlers are blocked before modal/confirm/network
    (rows[0].props.onEditTranslations as (target: CatalogItem) => void)(
      freePlanItems[0]
    );
    const priceRes = await (
      rows[0].props.onUpdatePrice as (
        i: CatalogItem,
        next: number
      ) => Promise<boolean>
    )(freePlanItems[0], 99000);
    const featRes = await (
      rows[0].props.onToggleFeatured as (
        i: CatalogItem,
        next: boolean
      ) => Promise<boolean>
    )(freePlanItems[0], true);
    const imgRes = await (
      rows[0].props.onUpdateImage as (
        i: CatalogItem,
        url: string
      ) => Promise<boolean>
    )(freePlanItems[0], 'https://example.invalid/new.png');
    const delRes = await (
      rows[0].props.onDelete as (id: string) => Promise<boolean>
    )(freePlanItems[0].id);
    assert.equal(priceRes, false);
    assert.equal(featRes, false);
    assert.equal(imgRes, false);
    assert.equal(delRes, false);
    assert.equal(confirmCalls, 0);
    assert.equal(mutationRequests.length, 0);

    tree = harness.render(CatalogPage, {});
    const editorModalStaff = findNodes(
      tree,
      (n) => n.type === TranslationEditorModalSymbol
    )[0];
    assert.equal(editorModalStaff.props.isOpen, false);

    // Permitted inventory.adjust handler succeeds
    const stockRes = await (
      rows[0].props.onUpdateStock as (
        i: CatalogItem,
        next: number | null
      ) => Promise<boolean>
    )(freePlanItems[0], 9);
    assert.equal(stockRes, true);
    assert.equal(mutationRequests.length, 1);

    // 3. Non-owner catalog manager vs Owner billing link gating
    currentMembership = {
      id: 'mem-manager',
      shop_id: 'shop-test',
      user_id: 'user-mgr',
      role: 'staff',
      permissions: ['catalog.manage', 'inventory.adjust'],
      is_active: true,
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-02T00:00:00.000Z',
    };
    tree = harness.render(CatalogPage, {});
    assert.equal(
      findNodes(tree, (n) => n.props['data-testid'] === 'catalog-add-item-btn')
        .length,
      1
    );
    assert.equal(
      findNodes(
        tree,
        (n) => n.props['data-testid'] === 'catalog-scan-menu-link'
      ).length,
      1
    );
    assert.equal(
      findNodes(tree, (n) => n.props.href === '/dashboard/billing').length,
      0,
      'Non-owner catalog manager still does not see owner-only /dashboard/billing links'
    );

    rows = findNodes(tree, (n) => n.type === QuickItemRowSymbol);
    (rows[0].props.onEditTranslations as (target: CatalogItem) => void)(
      freePlanItems[0]
    );
    tree = harness.render(CatalogPage, {});
    assert.equal(
      findNodes(tree, (n) => n.type === TranslationEditorModalSymbol)[0].props
        .isOpen,
      true,
      'Catalog manager can open TranslationEditorModal'
    );

    // Revoking catalog.manage while modal is open immediately closes TranslationEditorModal
    currentMembership = {
      ...currentMembership,
      permissions: ['inventory.adjust'],
    };
    tree = harness.render(CatalogPage, {});
    assert.equal(
      findNodes(tree, (n) => n.type === TranslationEditorModalSymbol)[0].props
        .isOpen,
      false,
      'TranslationEditorModal fails closed if catalog.manage is revoked while open'
    );
    assert.equal(
      findNodes(tree, (n) => n.type === CatalogExcelImportModalSymbol)[0].props
        .canManageCatalog,
      false,
      'CatalogExcelImportModal switches canManageCatalog to false when catalog.manage is revoked'
    );

    // 4. Shop owner sees both catalog management controls and /dashboard/billing upgrade CTAs
    currentMembership = {
      id: 'mem-owner',
      shop_id: 'shop-test',
      user_id: 'user-owner',
      role: 'owner',
      permissions: ['catalog.manage', 'inventory.adjust'],
      is_active: true,
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-02T00:00:00.000Z',
    };
    tree = harness.render(CatalogPage, {});
    assert.equal(
      findNodes(tree, (n) => n.props.href === '/dashboard/billing').length,
      2
    );
    assert.equal(
      findNodes(tree, (n) => n.type === CatalogExcelImportModalSymbol)[0].props
        .canManageCatalog,
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function buildWorkbookBytes(
  headers: string[],
  rows: unknown[][]
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ThucDon');
  ws.addRow(headers);
  for (const r of rows) {
    ws.addRow(r);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

test('parseAndValidateCatalogExcel and buildCatalogExcelBulkUpdateItems enforce stock-only mode when allowPriceChanges is false and preserve price+stock mode when true', async () => {
  const catalogItems: CatalogItem[] = [
    { ...item, id: 'item-a', price: 35000, stock_quantity: 5 },
    { ...item, id: 'item-b', price: 45000, stock_quantity: 10 },
    { ...item, id: 'item-c', price: 55000, stock_quantity: 8 },
    { ...item, id: 'item-d', price: 65000, stock_quantity: null },
  ];

  // 1. Worksheet without Price column succeeds in stock-only mode, fails in catalog.manage mode
  const stockOnlyTwoColBytes = await buildWorkbookBytes(
    ['Mã món (Item ID)', 'Tồn kho (Stock)'],
    [
      ['item-a', 18], // stock changed 5 -> 18
      ['item-b', 10], // stock unchanged
      ['item-d', '∞'], // unlimited stock unchanged
    ]
  );

  const stockOnlyTwoColRes = await parseAndValidateCatalogExcel(
    stockOnlyTwoColBytes,
    catalogItems,
    { allowPriceChanges: false }
  );
  assert.equal(stockOnlyTwoColRes.ok, true);
  assert.equal(stockOnlyTwoColRes.errors.length, 0);
  assert.equal(stockOnlyTwoColRes.validRows.length, 1);
  assert.equal(stockOnlyTwoColRes.unchangedRows.length, 2);
  assert.equal(stockOnlyTwoColRes.invalidRows.length, 0);
  assert.equal(stockOnlyTwoColRes.validRows[0].rawId, 'item-a');
  assert.equal(stockOnlyTwoColRes.validRows[0].priceChanged, false);
  assert.equal(stockOnlyTwoColRes.validRows[0].parsedPrice, undefined);
  assert.equal(stockOnlyTwoColRes.validRows[0].stockChanged, true);
  assert.equal(stockOnlyTwoColRes.validRows[0].parsedStock, 18);

  const twoColPayload = buildCatalogExcelBulkUpdateItems(
    stockOnlyTwoColRes.validRows,
    { allowPriceChanges: false }
  );
  assert.deepEqual(twoColPayload, [
    {
      id: 'item-a',
      stock_quantity: 18,
      expected_stock_quantity: 5,
    },
  ]);
  assert.equal('price' in twoColPayload[0], false);

  const managerMissingPriceRes = await parseAndValidateCatalogExcel(
    stockOnlyTwoColBytes,
    catalogItems,
    { allowPriceChanges: true }
  );
  assert.equal(managerMissingPriceRes.ok, false);
  assert.ok(
    managerMissingPriceRes.errors.some((e) => e.includes('Giá bán (Price)'))
  );

  // 2. Worksheet with changed price, invalid price, and price-only row
  const mixedPriceSheetBytes = await buildWorkbookBytes(
    ['Mã món (Item ID)', 'Giá bán (Price)', 'Tồn kho (Stock)'],
    [
      ['item-a', 99000, 12], // changed price + changed stock
      ['item-b', 'INVALID_PRICE', 0], // invalid price + changed stock
      ['item-c', 88000, 8], // price-only change (stock unchanged)
      ['item-d', -12345, 4], // negative invalid price + changed unlimited->4 stock
    ]
  );

  const stockOnlyMixedRes = await parseAndValidateCatalogExcel(
    mixedPriceSheetBytes,
    catalogItems,
    { allowPriceChanges: false }
  );
  assert.equal(stockOnlyMixedRes.ok, true);
  assert.equal(stockOnlyMixedRes.invalidRows.length, 0);
  assert.equal(stockOnlyMixedRes.validRows.length, 3);
  assert.equal(stockOnlyMixedRes.unchangedRows.length, 1);
  assert.equal(
    stockOnlyMixedRes.unchangedRows[0].rawId,
    'item-c',
    'Price-only changed row must be classified as unchanged in stock-only mode'
  );
  assert.equal(stockOnlyMixedRes.unchangedRows[0].priceChanged, false);
  assert.equal(stockOnlyMixedRes.unchangedRows[0].stockChanged, false);

  for (const row of stockOnlyMixedRes.validRows) {
    assert.equal(row.priceChanged, false);
    assert.equal(row.parsedPrice, undefined);
    assert.equal(row.stockChanged, true);
  }

  const stockOnlyMixedPayload = buildCatalogExcelBulkUpdateItems(
    stockOnlyMixedRes.validRows,
    { allowPriceChanges: false }
  );
  assert.deepEqual(stockOnlyMixedPayload, [
    { id: 'item-a', stock_quantity: 12, expected_stock_quantity: 5 },
    { id: 'item-b', stock_quantity: 0, expected_stock_quantity: 10 },
    { id: 'item-d', stock_quantity: 4, expected_stock_quantity: null },
  ]);
  for (const entry of stockOnlyMixedPayload) {
    assert.equal('price' in entry, false);
  }

  // 3. Catalog manager mode preserves price validation and price+stock updates
  const managerMixedRes = await parseAndValidateCatalogExcel(
    mixedPriceSheetBytes,
    catalogItems,
    { allowPriceChanges: true }
  );
  assert.equal(managerMixedRes.ok, false);
  assert.equal(managerMixedRes.invalidRows.length, 2); // item-b and item-d have invalid prices
  assert.equal(managerMixedRes.validRows.length, 2); // item-a (price+stock) and item-c (price-only)
  const managerPayload = buildCatalogExcelBulkUpdateItems(
    managerMixedRes.validRows,
    { allowPriceChanges: true }
  );
  assert.deepEqual(managerPayload, [
    {
      id: 'item-a',
      price: 99000,
      stock_quantity: 12,
      expected_stock_quantity: 5,
    },
    {
      id: 'item-c',
      price: 88000,
    },
  ]);

  // Defense-in-depth: passing manager-parsed rows into buildCatalogExcelBulkUpdateItems with allowPriceChanges=false
  // strips price from price+stock rows and drops price-only rows entirely (no empty { id } no-op mutation)
  const strippedPayload = buildCatalogExcelBulkUpdateItems(
    managerMixedRes.validRows,
    { allowPriceChanges: false }
  );
  assert.deepEqual(strippedPayload, [
    {
      id: 'item-a',
      stock_quantity: 12,
      expected_stock_quantity: 5,
    },
  ]);
  assert.equal('price' in strippedPayload[0], false);
});

test('CatalogExcelImportModal: restricts UI copy, preview columns, and POST /api/catalog payload to stock-only for inventory-only members while preserving price+stock imports for catalog managers', async () => {
  const modalItems: CatalogItem[] = [
    {
      ...item,
      id: 'item-1',
      name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
      price: 35000,
      stock_quantity: 5,
    },
    {
      ...item,
      id: 'item-2',
      name_i18n: { vi: 'Trà đào cam sả', en: 'Peach Lemongrass Tea' },
      price: 45000,
      stock_quantity: 10,
    },
    {
      ...item,
      id: 'item-3',
      name_i18n: { vi: 'Bánh sừng bò', en: 'Croissant' },
      price: 30000,
      stock_quantity: 7,
    },
  ];
  const modalCategories: Category[] = [
    {
      id: 'cat-1',
      shop_id: 'shop-test',
      name_i18n: { vi: 'Đồ uống', en: 'Drinks' },
      sort_order: 1,
      is_active: true,
    },
  ];

  const lucideStub = new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    }
  );
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
  const catalogExcelReal = await import('@/lib/catalog-excel');

  const submittedBodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      submittedBodies.push(parsed);
      const reqItems = Array.isArray(parsed.items) ? parsed.items : [];
      return new Response(
        JSON.stringify({
          success: true,
          updatedCount: reqItems.length,
          results: reqItems.map((entry: { id: string }) => ({
            id: entry.id,
            success: true,
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    function createFakeXlsxFile(name: string, bytes: Uint8Array): File {
      return {
        name,
        size: bytes.byteLength,
        arrayBuffer: async () => {
          const buf = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buf).set(bytes);
          return buf;
        },
      } as unknown as File;
    }

    // -------------------------------------------------------------------------
    // Part A: Inventory-only member (canManageCatalog = false)
    // -------------------------------------------------------------------------
    const staffHarness = createStatefulHarness();
    const { CatalogExcelImportModal: StaffModal } = loadComponentModule<{
      CatalogExcelImportModal: (props: Record<string, unknown>) => VNode | null;
    }>(
      'src/components/dashboard/CatalogExcelImportModal.tsx',
      staffHarness.reactMock,
      {
        'lucide-react': lucideStub,
        '@/components/ui/AppI18nProvider': i18nStub,
        '@/lib/auth-session': {
          getAuthHeaders: (h?: Record<string, string>) => h || {},
        },
        '@/lib/catalog-excel': catalogExcelReal,
      }
    );

    let staffClosed = 0;
    const staffSuccessCounts: number[] = [];
    const renderStaffModal = (canManageCatalog = false) =>
      staffHarness.render(StaffModal, {
        isOpen: true,
        canManageCatalog,
        onClose: () => {
          staffClosed++;
        },
        shopId: 'shop-test',
        shopName: 'Test Shop',
        currentItems: modalItems,
        categories: modalCategories,
        onSuccess: (count: number) => {
          staffSuccessCounts.push(count);
        },
      });

    let staffTree = renderStaffModal(false);
    const initialStaffText = collectText(staffTree);
    assert.ok(
      initialStaffText.includes('Nhập tồn kho từ Excel'),
      'Stock-only modal title must state stock-only import'
    );
    assert.equal(
      initialStaffText.includes('Nhập giá & tồn kho từ Excel'),
      false,
      'Stock-only modal must NOT advertise price & stock import in title'
    );
    assert.ok(
      initialStaffText.includes('bỏ qua cột giá bán') ||
        initialStaffText.includes('cột Giá bán không bắt buộc'),
      'Stock-only dropzone/header copy must explain that Price column is optional and ignored'
    );

    // Upload a sheet with changed price (99000), invalid price ("BAD_PRICE"), and price-only row (77000)
    const staffUploadBytes = await buildWorkbookBytes(
      ['Mã món (Item ID)', 'Giá bán (Price)', 'Tồn kho (Stock)'],
      [
        ['item-1', 99000, 14], // unauthorized price change + valid stock change
        ['item-2', 'BAD_PRICE', 0], // invalid price cell + valid stock change
        ['item-3', 77000, 7], // price-only change -> unchanged in stock-only mode
      ]
    );
    const fileInputStaff = findNodes(
      staffTree,
      (n) => n.props['data-testid'] === 'catalog-excel-file-input'
    )[0];
    (
      fileInputStaff.props.onChange as (e: {
        target: { files: File[] };
      }) => void
    )({
      target: { files: [createFakeXlsxFile('stock-update.xlsx', staffUploadBytes)] },
    });
    await new Promise((r) => setTimeout(r, 40));
    staffTree = renderStaffModal(false);

    const safetyNoteNode = findNodes(
      staffTree,
      (n) => n.props['data-testid'] === 'catalog-excel-safety-note'
    )[0];
    assert.ok(safetyNoteNode);
    assert.ok(
      collectText(safetyNoteNode).includes('Chế độ chỉ nhập tồn kho'),
      'Safety copy must state stock-only import mode'
    );

    const previewTableStaff = findNodes(
      staffTree,
      (n) => n.props['data-testid'] === 'catalog-excel-preview-table'
    )[0];
    assert.ok(previewTableStaff);
    const previewTableStaffText = collectText(previewTableStaff);
    assert.equal(
      previewTableStaffText.includes('Giá bán'),
      false,
      'Stock-only preview table must omit the Price column'
    );
    for (const forbiddenPriceToken of [
      '99.000',
      '99,000',
      '99000',
      '77.000',
      '77,000',
      '77000',
      'BAD_PRICE',
    ]) {
      assert.equal(
        previewTableStaffText.includes(forbiddenPriceToken),
        false,
        `Stock-only preview table must NOT display incoming price value: ${forbiddenPriceToken}`
      );
    }
    assert.ok(previewTableStaffText.includes('Tồn kho cập nhật'));

    const applyBtnStaff = findNodes(
      staffTree,
      (n) => n.props['data-testid'] === 'catalog-excel-apply-btn'
    )[0];
    assert.ok(applyBtnStaff);
    assert.equal(applyBtnStaff.props.disabled, false);
    assert.ok(
      collectText(applyBtnStaff).includes('Áp dụng 2 món hợp lệ'),
      'Only the 2 stock-changed rows are counted as valid; price-only row is unchanged'
    );

    await (applyBtnStaff.props.onClick as () => Promise<void>)();
    assert.equal(submittedBodies.length, 1);
    assert.equal(submittedBodies[0].action, 'bulk_update_price_stock');
    assert.equal(submittedBodies[0].shopId, 'shop-test');
    assert.deepEqual(submittedBodies[0].items, [
      { id: 'item-1', stock_quantity: 14, expected_stock_quantity: 5 },
      { id: 'item-2', stock_quantity: 0, expected_stock_quantity: 10 },
    ]);
    for (const payloadEntry of submittedBodies[0].items as Array<
      Record<string, unknown>
    >) {
      assert.equal('price' in payloadEntry, false);
    }
    assert.deepEqual(staffSuccessCounts, [2]);
    assert.equal(staffClosed, 1);

    // Price-only sheet in stock-only mode disables Apply and triggers zero network mutations
    const priceOnlyHarness = createStatefulHarness();
    const { CatalogExcelImportModal: PriceOnlyStaffModal } = loadComponentModule<{
      CatalogExcelImportModal: (props: Record<string, unknown>) => VNode | null;
    }>(
      'src/components/dashboard/CatalogExcelImportModal.tsx',
      priceOnlyHarness.reactMock,
      {
        'lucide-react': lucideStub,
        '@/components/ui/AppI18nProvider': i18nStub,
        '@/lib/auth-session': {
          getAuthHeaders: (h?: Record<string, string>) => h || {},
        },
        '@/lib/catalog-excel': catalogExcelReal,
      }
    );
    const renderPriceOnlyModal = () =>
      priceOnlyHarness.render(PriceOnlyStaffModal, {
        isOpen: true,
        canManageCatalog: false,
        onClose: () => {},
        shopId: 'shop-test',
        currentItems: modalItems,
        categories: modalCategories,
        onSuccess: () => {},
      });
    let priceOnlyTree = renderPriceOnlyModal();
    const priceOnlyBytes = await buildWorkbookBytes(
      ['Mã món (Item ID)', 'Giá bán (Price)', 'Tồn kho (Stock)'],
      [['item-1', 99000, 5]] // price changed, stock unchanged
    );
    (
      findNodes(
        priceOnlyTree,
        (n) => n.props['data-testid'] === 'catalog-excel-file-input'
      )[0].props.onChange as (e: { target: { files: File[] } }) => void
    )({
      target: { files: [createFakeXlsxFile('price-only.xlsx', priceOnlyBytes)] },
    });
    await new Promise((r) => setTimeout(r, 40));
    priceOnlyTree = renderPriceOnlyModal();
    const disabledApplyBtn = findNodes(
      priceOnlyTree,
      (n) => n.props['data-testid'] === 'catalog-excel-apply-btn'
    )[0];
    assert.equal(disabledApplyBtn.props.disabled, true);
    await (disabledApplyBtn.props.onClick as () => Promise<void>)();
    assert.equal(
      submittedBodies.length,
      1,
      'Price-only workbook in stock-only mode must not send any POST mutation'
    );

    // -------------------------------------------------------------------------
    // Part B: Catalog manager (canManageCatalog = true) + live permission drop
    // -------------------------------------------------------------------------
    const managerHarness = createStatefulHarness();
    const { CatalogExcelImportModal: ManagerModal } = loadComponentModule<{
      CatalogExcelImportModal: (props: Record<string, unknown>) => VNode | null;
    }>(
      'src/components/dashboard/CatalogExcelImportModal.tsx',
      managerHarness.reactMock,
      {
        'lucide-react': lucideStub,
        '@/components/ui/AppI18nProvider': i18nStub,
        '@/lib/auth-session': {
          getAuthHeaders: (h?: Record<string, string>) => h || {},
        },
        '@/lib/catalog-excel': catalogExcelReal,
      }
    );
    const renderManagerModal = (canManageCatalog = true) =>
      managerHarness.render(ManagerModal, {
        isOpen: true,
        canManageCatalog,
        onClose: () => {},
        shopId: 'shop-test',
        currentItems: modalItems,
        categories: modalCategories,
        onSuccess: () => {},
      });

    let managerTree = renderManagerModal(true);
    assert.ok(collectText(managerTree).includes('Nhập giá & tồn kho từ Excel'));

    const managerUploadBytes = await buildWorkbookBytes(
      ['Mã món (Item ID)', 'Giá bán (Price)', 'Tồn kho (Stock)'],
      [
        ['item-1', 42000, 11], // price + stock changed
        ['item-3', 36000, 7], // price-only changed
      ]
    );
    (
      findNodes(
        managerTree,
        (n) => n.props['data-testid'] === 'catalog-excel-file-input'
      )[0].props.onChange as (e: { target: { files: File[] } }) => void
    )({
      target: { files: [createFakeXlsxFile('manager.xlsx', managerUploadBytes)] },
    });
    await new Promise((r) => setTimeout(r, 40));
    managerTree = renderManagerModal(true);

    const managerTableText = collectText(
      findNodes(
        managerTree,
        (n) => n.props['data-testid'] === 'catalog-excel-preview-table'
      )[0]
    );
    assert.ok(managerTableText.includes('Giá bán'));
    assert.ok(
      managerTableText.includes('42.000') || managerTableText.includes('42,000'),
      'Catalog manager preview shows incoming price delta'
    );

    const managerApplyBtn = findNodes(
      managerTree,
      (n) => n.props['data-testid'] === 'catalog-excel-apply-btn'
    )[0];
    assert.ok(collectText(managerApplyBtn).includes('Áp dụng 2 món hợp lệ'));

    // Verify catalog manager submission includes price updates
    await (managerApplyBtn.props.onClick as () => Promise<void>)();
    assert.equal(submittedBodies.length, 2);
    assert.deepEqual(submittedBodies[1].items, [
      {
        id: 'item-1',
        price: 42000,
        stock_quantity: 11,
        expected_stock_quantity: 5,
      },
      {
        id: 'item-3',
        price: 36000,
      },
    ]);

    // -------------------------------------------------------------------------
    // Part C: Revoking catalog.manage while modal is open immediately purges
    // price preview and re-validates file in stock-only mode
    // -------------------------------------------------------------------------
    const revokeHarness = createStatefulHarness();
    const { CatalogExcelImportModal: RevokeModal } = loadComponentModule<{
      CatalogExcelImportModal: (props: Record<string, unknown>) => VNode | null;
    }>(
      'src/components/dashboard/CatalogExcelImportModal.tsx',
      revokeHarness.reactMock,
      {
        'lucide-react': lucideStub,
        '@/components/ui/AppI18nProvider': i18nStub,
        '@/lib/auth-session': {
          getAuthHeaders: (h?: Record<string, string>) => h || {},
        },
        '@/lib/catalog-excel': catalogExcelReal,
      }
    );
    const renderRevokeModal = (canManageCatalog: boolean) =>
      revokeHarness.render(RevokeModal, {
        isOpen: true,
        canManageCatalog,
        onClose: () => {},
        shopId: 'shop-test',
        currentItems: modalItems,
        categories: modalCategories,
        onSuccess: () => {},
      });

    let revokeTree = renderRevokeModal(true);
    (
      findNodes(
        revokeTree,
        (n) => n.props['data-testid'] === 'catalog-excel-file-input'
      )[0].props.onChange as (e: { target: { files: File[] } }) => void
    )({
      target: { files: [createFakeXlsxFile('revoke.xlsx', managerUploadBytes)] },
    });
    await new Promise((r) => setTimeout(r, 40));
    revokeTree = renderRevokeModal(true);
    assert.ok(collectText(revokeTree).includes('Áp dụng 2 món hợp lệ'));

    // Drop catalog.manage -> immediately drops stale manager preview and re-parses as stock-only
    revokeTree = renderRevokeModal(false);
    await new Promise((r) => setTimeout(r, 40));
    revokeTree = renderRevokeModal(false);
    const revokedText = collectText(revokeTree);
    assert.ok(revokedText.includes('Nhập tồn kho từ Excel'));
    assert.equal(revokedText.includes('42.000'), false);
    assert.equal(revokedText.includes('36.000'), false);
    const revokedApplyBtn = findNodes(
      revokeTree,
      (n) => n.props['data-testid'] === 'catalog-excel-apply-btn'
    )[0];
    assert.ok(
      collectText(revokedApplyBtn).includes('Áp dụng 1 món hợp lệ'),
      'After revoking catalog.manage, price-only row becomes unchanged and only stock-changed row remains valid'
    );
    await (revokedApplyBtn.props.onClick as () => Promise<void>)();
    assert.equal(submittedBodies.length, 3);
    assert.deepEqual(submittedBodies[2].items, [
      {
        id: 'item-1',
        stock_quantity: 11,
        expected_stock_quantity: 5,
      },
    ]);
    assert.equal(
      'price' in (submittedBodies[2].items as Array<Record<string, unknown>>)[0],
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
