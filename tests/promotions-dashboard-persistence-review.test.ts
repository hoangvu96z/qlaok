import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type {
  CatalogItem,
  Shop,
  ShopFlashSaleConfig,
  ShopPromoBannerConfig,
  ShopThemeConfig,
} from '@/types/qlaok';
import * as realShopPromotions from '@/lib/shop-promotions';

interface VNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
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

function createDashboardPageHarness(params: {
  initialActiveShop: Shop;
  unrelatedShop: Shop;
  catalogItems: CatalogItem[];
}) {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const callbacks: Array<{ deps?: unknown[]; fn: (...args: never[]) => unknown }> = [];
  const effects: Array<{ deps?: unknown[]; fn: () => void | (() => void) }> = [];
  let cursor = 0;
  let refCursor = 0;
  let callbackCursor = 0;
  let effectCursor = 0;
  const pendingEffects: Array<() => void | (() => void)> = [];

  // In-memory isolated store
  const shopsById = new Map<string, Shop>([
    [params.initialActiveShop.id, JSON.parse(JSON.stringify(params.initialActiveShop))],
    [params.unrelatedShop.id, JSON.parse(JSON.stringify(params.unrelatedShop))],
  ]);

  let currentActiveShop: Shop = shopsById.get(params.initialActiveShop.id)!;
  let simulatePatchError: string | null = null;
  const capturedPatches: Array<{ url: string; body: { id: string; theme_config: ShopThemeConfig } }> = [];
  const networkAudit = {
    blockedExternalAttempts: [] as string[],
    internalCalls: [] as string[],
  };

  const reactMock = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = cursor++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = states[idx] as T;
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
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
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: unknown[]): T {
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
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
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

  // Mock isolated fetch - strictly fails if attempting live external network
  const mockedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    networkAudit.internalCalls.push(urlStr);

    // Strict network isolation guard: block any external protocol or domain
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      const parsed = new URL(urlStr);
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        networkAudit.blockedExternalAttempts.push(urlStr);
        throw new Error(`LIVE_NETWORK_ATTEMPT_FORBIDDEN: Attempted mutation to external host: ${urlStr}`);
      }
    }

    const [pathname, searchStr] = urlStr.split('?');
    const searchParams = new URLSearchParams(searchStr || '');

    if (pathname === '/api/posts') {
      return new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/api/catalog') {
      const shopId = searchParams.get('shopId');
      const filtered = params.catalogItems.filter((i) => i.shop_id === shopId);
      return new Response(JSON.stringify({ items: filtered }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (pathname === '/api/shops') {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'PATCH') {
        if (simulatePatchError) {
          return new Response(
            JSON.stringify({ error: simulatePatchError }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        const body = JSON.parse(String(init?.body || '{}'));
        capturedPatches.push({ url: urlStr, body });

        const targetShop = shopsById.get(body.id);
        if (!targetShop) {
          return new Response(JSON.stringify({ error: 'Shop not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        targetShop.theme_config = {
          ...targetShop.theme_config,
          ...body.theme_config,
        };
        shopsById.set(targetShop.id, targetShop);
        currentActiveShop = JSON.parse(JSON.stringify(targetShop));

        return new Response(JSON.stringify({ ok: true, shop: targetShop }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // GET /api/shops
      return new Response(
        JSON.stringify({
          shops: Array.from(shopsById.values()),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    throw new Error(`Unhandled mock endpoint: ${urlStr}`);
  };

  const customStubs: Record<string, unknown> = {
    'react': { ...reactMock, default: reactMock },
    '@/lib/app-i18n': { appLanguageName: (l: string) => l },
    'lucide-react': new Proxy({}, { get: (_, prop) => String(prop) }),
    '@/lib/dashboard-context': {
      useDashboard: () => ({
        activeShop: currentActiveShop,
        refreshDashboard: async () => {
          // Re-hydrate currentActiveShop from persisted shop store
          const persisted = shopsById.get(currentActiveShop.id);
          if (persisted) {
            currentActiveShop = JSON.parse(JSON.stringify(persisted));
          }
        },
      }),
    },
    '@/lib/auth-session': {
      getAuthHeaders: (h?: Record<string, string>) => ({
        ...(h || {}),
        Authorization: 'Bearer isolated-qa-token',
      }),
    },
    '@/types/qlaok': {},
    '@/lib/i18n-helper': {
      ALL_LOCALES: ['vi', 'en'],
      LOCALE_META: { vi: { label: 'Tiếng Việt' }, en: { label: 'English' } },
      formatCurrency: (n: number) => `${n}đ`,
    },
    '@/components/ui/FlagIcon': { FlagIcon: 'FlagIcon' },
    '@/components/ui/FeedbackToast': { FeedbackToast: 'FeedbackToast' },
    '@/components/storefront/StorefrontCustomDecor': { StorefrontWelcomePopup: 'StorefrontWelcomePopup' },
    '@/components/dashboard/RightPreviewSidebar': { RightPreviewSidebar: 'RightPreviewSidebar' },
    '@/components/ui/TimeSchedulePicker': { FlashSaleSchedulePicker: 'FlashSaleSchedulePicker' },
    '@/components/ui/AppI18nProvider': {
      useAppI18n: () => ({
        locale: 'vi',
        t: (k: string) => k,
        tx: (vi: string, _en: string, vars?: Record<string, unknown>) => {
          let res = vi;
          if (vars) {
            for (const [k, v] of Object.entries(vars)) {
              res = res.replace(`{${k}}`, String(v));
            }
          }
          return res;
        },
      }),
    },
    '@/components/ui/ConfirmDialog': {
      useConfirmDialog: () => ({ confirm: async () => true, dialog: null }),
    },
    '@/lib/shop-promotions': realShopPromotions,
  };

  const fullPath = path.join(process.cwd(), 'src/app/(dashboard)/dashboard/posts/page.tsx');
  const source = fs.readFileSync(fullPath, 'utf8');
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
    if (id in customStubs) return customStubs[id];
    throw new Error(`Unstubbed import: ${id}`);
  };
  const fn = new Function('exports', 'require', 'module', transpiled.outputText);
  fn(exportsObj, req, moduleObj);

  const Component = moduleObj.exports.default as () => VNode;

  function render(runEffects = true): VNode {
    cursor = 0;
    refCursor = 0;
    callbackCursor = 0;
    effectCursor = 0;
    pendingEffects.length = 0;

    const out = Component();

    if (runEffects && pendingEffects.length > 0) {
      const toRun = pendingEffects.splice(0, pendingEffects.length);
      for (const eff of toRun) {
        eff();
      }
    }

    return out;
  }

  return {
    render,
    mockedFetch,
    getStore: () => shopsById,
    getActiveShop: () => currentActiveShop,
    setActiveShop: (s: Shop) => {
      currentActiveShop = s;
      shopsById.set(s.id, JSON.parse(JSON.stringify(s)));
    },
    getCapturedPatches: () => capturedPatches,
    getNetworkAudit: () => networkAudit,
    setSimulatePatchError: (err: string | null) => {
      simulatePatchError = err;
    },
    getState: (index: number) => states[index],
    getStates: () => states,
  };
}

test('Owner Promotion Save -> Reload QA on Isolated Local Fixture (Promo Banner & Flash Sale)', async () => {
  const originalFetch = globalThis.fetch;

  const shopOwner1 = {
    id: 'shop-qa-promotions-01',
    owner_id: 'owner-qa-01',
    name: 'Quán Trà Sữa QA Local',
    slug: 'quan-tra-sua-qa-local',
    vertical: 'fnb',
    currency: 'VND',
    locale: 'vi',
    status: 'active',
    theme_config: { primaryColor: '#000000', layout: 'grid' }, // Initially empty promotion config
    supported_langs: ['vi', 'en'],
  } as unknown as Shop;

  const shopUnrelated2 = {
    id: 'shop-unrelated-02',
    owner_id: 'owner-other-99',
    name: 'Cửa hàng khác',
    slug: 'cua-hang-khac',
    vertical: 'retail',
    currency: 'VND',
    locale: 'vi',
    status: 'active',
    theme_config: {
      primaryColor: '#000000',
      layout: 'grid',
      promoBanner: {
        enabled: true,
        title: 'Khuyến mãi shop khác không được chạm',
        discountType: 'percent',
        discountValue: 90,
      },
    },
    supported_langs: ['vi'],
  } as unknown as Shop;

  const catalogItems: CatalogItem[] = [
    {
      id: 'item-ts-01',
      shop_id: 'shop-qa-promotions-01',
      name_i18n: { vi: 'Trà Sữa Trân Châu Hoàng Gia' },
      price: 45000,
      is_available: true,
    },
    {
      id: 'item-ts-02',
      shop_id: 'shop-qa-promotions-01',
      name_i18n: { vi: 'Trà Đào Cam Sả' },
      price: 42000,
      is_available: true,
    },
    {
      id: 'item-ts-03',
      shop_id: 'shop-qa-promotions-01',
      name_i18n: { vi: 'Cà Phê Muối Hải Phòng' },
      price: 35000,
      is_available: true,
    },
    {
      id: 'item-cross-shop-99',
      shop_id: 'shop-unrelated-02', // Belongs to unrelated shop
      name_i18n: { vi: 'Sản phẩm shop khác' },
      price: 999000,
      is_available: true,
    },
  ].map((item) => ({ category_id: 'category-qa', sort_order: 0, is_featured: false, desc_i18n: { vi: '' }, options_json: [], view_count: 0, ...item }));

  const harness = createDashboardPageHarness({
    initialActiveShop: shopOwner1,
    unrelatedShop: shopUnrelated2,
    catalogItems,
  });

  globalThis.fetch = harness.mockedFetch as typeof fetch;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: INITIAL MOUNT & SHOP-SCOPED CATALOG HYDRATION
    // -------------------------------------------------------------------------
    let vnode = harness.render();

    // Await async catalog fetch effect
    await new Promise((r) => setTimeout(r, 10));
    vnode = harness.render();

    // Verify initial promotion draft states:
    // State index 7: promoBanner (ShopPromoBannerConfig)
    // State index 8: welcomePopup (ShopPopupConfig)
    // State index 9: flashSale (ShopFlashSaleConfig)
    const initialBanner = harness.getState(7) as ShopPromoBannerConfig;
    const initialFlash = harness.getState(9) as ShopFlashSaleConfig;

    assert.equal(initialBanner.enabled, false, 'Initial promo banner must be disabled');
    assert.equal(initialBanner.discountType, 'percent');
    assert.equal(initialBanner.discountValue, 15);
    assert.equal(initialBanner.voucherCode, '');

    assert.equal(initialFlash.enabled, false, 'Initial flash sale must be disabled');
    // Prepopulation takes first 3 items from shop-qa-promotions-01, excluding cross-shop item
    assert.deepEqual(
      initialFlash.itemIds,
      ['item-ts-01', 'item-ts-02', 'item-ts-03'],
      'Flash sale items must only contain current shop items, strictly excluding shop-unrelated-02'
    );
    assert.ok(
      !initialFlash.itemIds.includes('item-cross-shop-99'),
      'Cross-shop catalog items must never contaminate flash sale draft'
    );

    // -------------------------------------------------------------------------
    // STEP 2: OWNER FORM EDITS (PROMO BANNER & FLASH SALE)
    // -------------------------------------------------------------------------
    // Find controls in the rendered tree
    // 2.1 Enable Promo Banner
    const bannerCheckbox = findNodes(vnode, (n) =>
      Boolean(n.props && n.props.type === 'checkbox' && n.props.checked === false)
    )[0];
    assert.ok(bannerCheckbox, 'Must find promo banner enable checkbox');
    const onToggleBanner = bannerCheckbox.props.onChange as (e: unknown) => void;
    onToggleBanner({ target: { checked: true } });
    vnode = harness.render();

    // 2.2 Change Voucher Code to 'BANMAI20'
    const voucherInput = findNodes(vnode, (n) =>
      Boolean(n.props && typeof n.props.value === 'string' && n.props.placeholder && String(n.props.placeholder).includes('QLAOK15'))
    )[0];
    assert.ok(voucherInput, 'Must find voucher code input');
    const onVoucherChange = voucherInput.props.onChange as (e: unknown) => void;
    onVoucherChange({ target: { value: 'banmai20' } }); // Component auto-uppercases to BANMAI20
    vnode = harness.render();

    // 2.3 Set Min Order Amount to 120,000đ
    const minOrderInput = findNodes(vnode, (n) =>
      Boolean(n.props && n.props.type === 'number' && n.props.step === 10000)
    )[0];
    assert.ok(minOrderInput, 'Must find min order amount input');
    const onMinOrderChange = minOrderInput.props.onChange as (e: unknown) => void;
    onMinOrderChange({ target: { value: '120000' } });
    vnode = harness.render();

    // Verify draft updates for Banner
    const editedBanner = harness.getState(7) as ShopPromoBannerConfig;
    assert.equal(editedBanner.enabled, true);
    assert.equal(editedBanner.voucherCode, 'BANMAI20');
    assert.equal(editedBanner.minOrderAmount, 120000);
    assert.match(editedBanner.title, /Giảm ngay 15% cho đơn từ 120000/);

    // 2.4 Switch to Flash Sale Tab and Edit Flash Sale Config
    const flashTabBtn = findNodes(vnode, (n) =>
      Boolean(n.props && typeof n.props.onClick === 'function' && (
        String(n.props.children).includes('Flash Sale') ||
        JSON.stringify(n.props).includes('Flash Sale')
      ))
    )[0];
    assert.ok(flashTabBtn, 'Must find Flash Sale tab switcher');
    (flashTabBtn.props.onClick as () => void)();
    vnode = harness.render();

    // In Flash Sale tab: enable flash sale
    const flashCheckbox = findNodes(vnode, (n) =>
      Boolean(n.props && n.props.type === 'checkbox' && n.props.checked === false)
    )[0];
    assert.ok(flashCheckbox, 'Must find Flash Sale enable checkbox');
    (flashCheckbox.props.onChange as (e: unknown) => void)({ target: { checked: true } });
    vnode = harness.render();

    // Switch Flash Sale discount to fixed amount (15,000đ)
    const fixedAmountBtn = findNodes(vnode, (n) =>
      Boolean(n.props && typeof n.props.onClick === 'function' && (
        String(n.props.children).includes('Số tiền') || String(n.props.children).includes('Fixed amount')
      ))
    )[0];
    assert.ok(fixedAmountBtn, 'Must find fixed amount discount button');
    (fixedAmountBtn.props.onClick as () => void)();
    vnode = harness.render();

    vnode = harness.render();

    // Verify Flash Sale draft state
    const editedFlash = harness.getState(9) as ShopFlashSaleConfig;
    assert.equal(editedFlash.enabled, true);
    assert.equal(editedFlash.discountType, 'fixed_amount');
    assert.equal(editedFlash.discountValue, 15000);

    // -------------------------------------------------------------------------
    // STEP 3: SIMULATED API / DB FAILURE -> DRAFT PRESERVATION
    // -------------------------------------------------------------------------
    harness.setSimulatePatchError('PGRST_ERROR: database transaction timeout');

    // Find Save & Apply button
    const saveBtn = findNodes(vnode, (n) =>
      Boolean(n.props && typeof n.props.onClick === 'function' && (
        String(n.props.children).includes('Lưu & áp dụng') ||
        JSON.stringify(n.props).includes('Lưu & áp dụng') ||
        JSON.stringify(n.props).includes('Save')
      ))
    )[0];
    assert.ok(saveBtn, 'Must find Save button');

    // Trigger save while DB write is set to fail
    await (saveBtn.props.onClick as () => Promise<void>)();
    vnode = harness.render();

    // Check error feedback state (State 4)
    const errorFeedback = harness.getState(4) as { kind: string; message: string } | null;
    assert.ok(errorFeedback, 'Error toast feedback must be set on failure');
    assert.equal(errorFeedback.kind, 'error');
    assert.match(errorFeedback.message, /database transaction timeout/);

    // CRITICAL QA INVARIANT: Drafts MUST NOT be wiped or reset on error
    const preservedBannerAfterError = harness.getState(7) as ShopPromoBannerConfig;
    const preservedFlashAfterError = harness.getState(9) as ShopFlashSaleConfig;

    assert.equal(
      preservedBannerAfterError.enabled,
      true,
      'Promo banner draft must preserve enabled: true after failure'
    );
    assert.equal(
      preservedBannerAfterError.voucherCode,
      'BANMAI20',
      'Voucher code draft must preserve BANMAI20 after failure'
    );
    assert.equal(
      preservedBannerAfterError.minOrderAmount,
      120000,
      'Min order amount draft must preserve 120000 after failure'
    );
    assert.equal(
      preservedFlashAfterError.enabled,
      true,
      'Flash sale draft must preserve enabled: true after failure'
    );
    assert.equal(
      preservedFlashAfterError.discountType,
      'fixed_amount',
      'Flash sale discountType must preserve fixed_amount after failure'
    );
    assert.equal(
      preservedFlashAfterError.discountValue,
      15000,
      'Flash sale discountValue must preserve 15000 after failure'
    );

    // Verify in-memory DB fixture was NOT altered during failed save
    const untouchedDbShop = harness.getStore().get('shop-qa-promotions-01')!;
    assert.deepEqual(
      untouchedDbShop.theme_config,
      { primaryColor: '#000000', layout: 'grid' },
      'In-memory DB fixture must remain pristine after failed save'
    );

    // -------------------------------------------------------------------------
    // STEP 4: SUCCESSFUL SAVE -> LOCAL STORE PERSISTENCE
    // -------------------------------------------------------------------------
    harness.setSimulatePatchError(null);

    // Re-click Save button with intact drafts
    await (saveBtn.props.onClick as () => Promise<void>)();
    vnode = harness.render();

    // Verify success feedback state
    const successFeedback = harness.getState(4) as { kind: string; message: string } | null;
    assert.ok(successFeedback, 'Success feedback toast must be set on successful save');
    assert.equal(successFeedback.kind, 'success');
    assert.match(successFeedback.message, /Đã lưu và áp dụng khuyến mãi/);

    // Verify captured PATCH payload and shop scoping
    const patches = harness.getCapturedPatches();
    assert.equal(patches.length, 1, 'Exactly one successful PATCH call recorded');
    assert.equal(
      patches[0].body.id,
      'shop-qa-promotions-01',
      'Mutation must be scoped strictly to active shop'
    );
    assert.equal(patches[0].body.theme_config.promoBanner?.enabled, true);
    assert.equal(patches[0].body.theme_config.promoBanner?.voucherCode, 'BANMAI20');
    assert.equal(patches[0].body.theme_config.promoBanner?.minOrderAmount, 120000);
    assert.equal(patches[0].body.theme_config.flashSale?.enabled, true);
    assert.equal(patches[0].body.theme_config.flashSale?.discountType, 'fixed_amount');
    assert.equal(patches[0].body.theme_config.flashSale?.discountValue, 15000);

    // Verify in-memory DB fixture now contains the persisted configuration
    const persistedDbShop = harness.getStore().get('shop-qa-promotions-01')!;
    assert.equal(persistedDbShop.theme_config.promoBanner?.enabled, true);
    assert.equal(persistedDbShop.theme_config.promoBanner?.voucherCode, 'BANMAI20');
    assert.equal(persistedDbShop.theme_config.flashSale?.enabled, true);
    assert.equal(persistedDbShop.theme_config.flashSale?.discountValue, 15000);

    // Verify cross-shop isolation: unrelated shop remains untouched
    const unrelatedShopAfter = harness.getStore().get('shop-unrelated-02')!;
    assert.equal(
      unrelatedShopAfter.theme_config.promoBanner?.discountValue,
      90,
      'Unrelated shop must not be mutated'
    );

    // -------------------------------------------------------------------------
    // STEP 5: RELOAD FROM PERSISTED FIXTURE -> VALUE REHYDRATION
    // -------------------------------------------------------------------------
    // Create a fresh harness instance simulating a browser reload / new session
    // initialized with the persisted shop record from the previous run
    const reloadedHarness = createDashboardPageHarness({
      initialActiveShop: persistedDbShop,
      unrelatedShop: unrelatedShopAfter,
      catalogItems,
    });

    globalThis.fetch = reloadedHarness.mockedFetch as typeof fetch;

    reloadedHarness.render();
    await new Promise((r) => setTimeout(r, 10));
    reloadedHarness.render();

    // Verify newly hydrated component states match persisted values
    const reloadedBanner = reloadedHarness.getState(7) as ShopPromoBannerConfig;
    const reloadedFlash = reloadedHarness.getState(9) as ShopFlashSaleConfig;

    assert.equal(
      reloadedBanner.enabled,
      true,
      'Reloaded promo banner must reflect persisted enabled: true'
    );
    assert.equal(
      reloadedBanner.voucherCode,
      'BANMAI20',
      'Reloaded promo banner must reflect persisted voucher code BANMAI20'
    );
    assert.equal(
      reloadedBanner.minOrderAmount,
      120000,
      'Reloaded promo banner must reflect persisted minOrderAmount 120000'
    );
    assert.equal(
      reloadedFlash.enabled,
      true,
      'Reloaded flash sale must reflect persisted enabled: true'
    );
    assert.equal(
      reloadedFlash.discountType,
      'fixed_amount',
      'Reloaded flash sale must reflect persisted discountType fixed_amount'
    );
    assert.equal(
      reloadedFlash.discountValue,
      15000,
      'Reloaded flash sale must reflect persisted discountValue 15000'
    );

    // -------------------------------------------------------------------------
    // STEP 6: NETWORK ISOLATION VERIFICATION
    // -------------------------------------------------------------------------
    const audit = harness.getNetworkAudit();
    assert.equal(
      audit.blockedExternalAttempts.length,
      0,
      'Zero external network calls must be attempted'
    );
    assert.ok(
      audit.internalCalls.every((u) => u.startsWith('/api/')),
      'All fetch calls must be strictly confined to local mock /api/* endpoints'
    );

    // Also assert that attempting to fetch an external host throws immediately
    await assert.rejects(
      async () => {
        await (harness.mockedFetch as typeof fetch)('https://api.production.qlaok.vn/v1/promotions');
      },
      /LIVE_NETWORK_ATTEMPT_FORBIDDEN/,
      'Mocked fetch must block and throw on live external network attempt'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
