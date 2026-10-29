import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeCounterTodayTabState,
  createInitialCounterOrdersState,
  deriveCounterOrdersViewState,
  filterCounterTodayTabOrders,
  readOrderEvents,
  reconcileCounterOrdersFetch,
  resolveCounterTodayTabLabel,
  startOrderLiveSync,
} from '@/lib/order-live-sync';
import { APP_DICTIONARY } from '@/lib/app-i18n';

test('SSE parser handles split CRLF frames and ignores heartbeats/malformed JSON', async () => {
  const chunks = ['data: {"type":"rea', 'dy"}\r', '\n\r\n: heartbeat\n\ndata: invalid\n\ndata: {"type":"change"}\n\n'];
  const stream = new ReadableStream({ start(c) { for (const part of chunks) c.enqueue(new TextEncoder().encode(part)); c.close(); } });
  const received: string[] = [];
  await readOrderEvents(stream, e => received.push(e.type));
  assert.deepEqual(received, ['ready', 'change']);
});

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const mode of ['connected', 'fallback', 'unauthorized'] as const) {
  test(`live sync ${mode}: bounded refresh, visibility pause, cleanup and auth headers`, async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const descriptors = Object.fromEntries(['document', 'window', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const win = new EventTarget();
    let connections = 0;
    let refreshes = 0;
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    let lastHeaders: HeadersInit | undefined;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
      connections++; lastHeaders = init.headers;
      if (mode === 'unauthorized') return new Response('{}', { status: 403 });
      if (mode === 'fallback') return new Response('{}', { status: 503 });
      const stream = new ReadableStream<Uint8Array>({ start(c) { streamController = c; c.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n')); } });
      init.signal?.addEventListener('abort', () => { try { streamController.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
      return new Response(stream);
    } });
    let stop: (() => void) | undefined = undefined;
    t.after(() => {
      stop?.();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    stop = startOrderLiveSync({ query: 'shopId=fixture', headers: () => ({ Authorization: 'Bearer fixture' }), onChange: () => { refreshes++; } });
    await settle();
    assert.equal(new Headers(lastHeaders).get('authorization'), 'Bearer fixture');
    t.mock.timers.tick(200); await settle();
    assert.equal(refreshes, mode === 'connected' ? 1 : 0);
    t.mock.timers.tick(30000); await settle(); t.mock.timers.tick(200); await settle();
    assert.equal(refreshes, mode === 'connected' ? 1 : mode === 'fallback' ? 1 : 0);
    if (mode === 'connected') {
      streamController!.enqueue(new TextEncoder().encode('data: {"type":"change"}\n\ndata: {"type":"change"}\n\n'));
      await settle(); t.mock.timers.tick(200); await settle();
      assert.equal(refreshes, 2, 'bursts coalesce to one HTTP refresh');
    }
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); await settle();
    const before = { connections, refreshes };
    t.mock.timers.tick(120000); await settle();
    assert.deepEqual({ connections, refreshes }, before, 'hidden screens perform no polling or reconnect');
    stop();
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('online'));
    t.mock.timers.tick(120000); await settle();
    assert.deepEqual({ connections, refreshes }, before, 'no work after unmount');
  });
}

test('route ownership helper accurately distinguishes /dashboard/orders and nested paths from other routes', async () => {
  const { isOrdersDashboardRoute, shouldDashboardShellSyncOrders } = await import(
    '@/lib/dashboard-nav'
  );

  // Exact orders route
  assert.equal(isOrdersDashboardRoute('/dashboard/orders'), true);
  assert.equal(shouldDashboardShellSyncOrders('/dashboard/orders'), false);

  // Nested orders routes and trailing slashes
  assert.equal(isOrdersDashboardRoute('/dashboard/orders/'), true);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders/123'), true);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders/table/5'), true);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders/export/csv'), true);
  assert.equal(shouldDashboardShellSyncOrders('/dashboard/orders/123'), false);

  // Orders routes with query params or hash
  assert.equal(isOrdersDashboardRoute('/dashboard/orders?tab=today&view=pos'), true);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders#actions'), true);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders/?tab=new'), true);
  assert.equal(shouldDashboardShellSyncOrders('/dashboard/orders?tab=new'), false);

  // Other dashboard routes must NOT be identified as orders routes (layout background sync preserved)
  const otherDashboardRoutes = [
    '/dashboard',
    '/dashboard/',
    '/dashboard/kitchen',
    '/dashboard/reports',
    '/dashboard/catalog',
    '/dashboard/ai-scanner',
    '/dashboard/qr-studio',
    '/dashboard/posts',
    '/dashboard/settings',
    '/dashboard/billing',
  ];
  for (const route of otherDashboardRoutes) {
    assert.equal(
      isOrdersDashboardRoute(route),
      false,
      `expected ${route} not to be treated as orders route`
    );
    assert.equal(
      shouldDashboardShellSyncOrders(route),
      true,
      `expected layout to sync orders on ${route}`
    );
  }

  // Similar prefix paths that are not orders route
  assert.equal(isOrdersDashboardRoute('/dashboard/orders-archive'), false);
  assert.equal(isOrdersDashboardRoute('/dashboard/orders_legacy'), false);
  assert.equal(shouldDashboardShellSyncOrders('/dashboard/orders-archive'), true);

  // Storefront, auth, and external routes
  assert.equal(isOrdersDashboardRoute('/s/demo-shop'), false);
  assert.equal(isOrdersDashboardRoute('/s/demo-shop/menu'), false);
  assert.equal(isOrdersDashboardRoute('/login'), false);
  assert.equal(isOrdersDashboardRoute('/onboarding'), false);

  // Falsy or empty paths
  assert.equal(isOrdersDashboardRoute(''), false);
  assert.equal(isOrdersDashboardRoute(null), false);
  assert.equal(isOrdersDashboardRoute(undefined), false);
});

test('DashboardShell gates order sync effect, teardown, and reminder chimes by route ownership', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const layoutSource = fsMod.readFileSync(
    pathMod.join(process.cwd(), 'src/app/(dashboard)/dashboard/layout.tsx'),
    'utf8'
  );

  // Imports route ownership helpers from @/lib/dashboard-nav
  assert.match(layoutSource, /isOrdersDashboardRoute/);
  assert.match(layoutSource, /shouldDashboardShellSyncOrders/);

  // Evaluates route ownership from current pathname
  assert.match(
    layoutSource,
    /const\s+shouldSyncOrders\s*=\s*shouldDashboardShellSyncOrders\(pathname\)/
  );

  // Sync effect early-exits when shouldSyncOrders is false
  assert.match(layoutSource, /if\s*\(!shouldSyncOrders\)\s*\{\s*setLiveToastOrder\(null\);\s*return;\s*\}/);

  // checkLiveOrders guards against running or updating on orders route
  assert.match(
    layoutSource,
    /if\s*\(\s*!shopId\s*\|\|\s*disposedRef\.current\s*\|\|\s*isOrdersDashboardRoute\(pathnameRef\.current\)\s*\)\s*\{\s*return;\s*\}/
  );

  // BroadcastChannel and startOrderLiveSync are cleaned up on teardown
  assert.match(layoutSource, /if\s*\(bc\)\s*bc\.close\(\);/);
  assert.match(layoutSource, /stopSync\(\);/);

  // Reminder chime effect is suspended on orders route
  assert.match(
    layoutSource,
    /if\s*\(isOrdersDashboardRoute\(pathname\)\s*\|\|\s*newOrdersCount\s*===\s*0\)\s*return;/
  );
});

test('live sync unauthorized recovers when reconnect is called after session restoration', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const descriptors = Object.fromEntries(
    ['document', 'window', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ])
  );
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  let statusResult: string | undefined;
  let authValid = false;
  let refreshes = 0;
  let fetchAttempts = 0;

  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_url: unknown, init: RequestInit) => {
      fetchAttempts++;
      if (!authValid) {
        return new Response('{}', { status: 401 });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n'));
        },
      });
      init.signal?.addEventListener('abort', () => {});
      return new Response(stream);
    },
  });

  let stop: ReturnType<typeof startOrderLiveSync> | undefined = undefined;
  t.after(() => {
    stop?.();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  stop = startOrderLiveSync({
    query: 'shopId=fixture',
    headers: () => ({ Authorization: authValid ? 'Bearer valid' : 'Bearer expired' }),
    onChange: () => {
      refreshes++;
    },
    onStatus: (s) => {
      statusResult = s;
    },
  });

  await settle();
  assert.equal(statusResult, 'unauthorized', 'initial 401 transitions live sync to unauthorized');
  assert.equal(refreshes, 0, 'no refreshes while unauthorized');
  assert.equal(fetchAttempts, 1);

  // While unauthorized, fallback intervals and visibility changes must not loop
  t.mock.timers.tick(60000);
  await settle();
  doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(fetchAttempts, 1, 'unauthorized state suppresses retries and polling');

  // Simulate user re-authenticating and triggering recovery via reconnect
  authValid = true;
  stop.reconnect();
  await settle();
  t.mock.timers.tick(200);
  await settle();

  assert.equal(statusResult, 'connected', 'reconnect transitions live sync to connected');
  assert.equal(refreshes, 1, 'fires onChange upon ready event on reconnected stream');
  assert.equal(fetchAttempts, 2, 'reconnect initiates exactly one fresh connection');

  stop();
});

test('live sync handles 403 Forbidden as unauthorized and halts reconnect until reconnect is invoked', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const descriptors = Object.fromEntries(
    ['document', 'window', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ])
  );
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  let statusResult: string | undefined;
  let fetchCount = 0;

  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      fetchCount++;
      return new Response('{}', { status: 403 });
    },
  });

  let stop: ReturnType<typeof startOrderLiveSync> | undefined = undefined;
  t.after(() => {
    stop?.();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  stop = startOrderLiveSync({
    query: 'shopId=fixture',
    onChange: () => {},
    onStatus: (s) => {
      statusResult = s;
    },
  });

  await settle();
  assert.equal(statusResult, 'unauthorized', 'HTTP 403 maps directly to unauthorized status');
  assert.equal(fetchCount, 1);

  // Must not poll or retry on 403
  t.mock.timers.tick(60000);
  await settle();
  doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(fetchCount, 1, 'does not loop on 403');

  // Simulate permission recovery and triggering live sync recovery via reconnect
  let streamOpened = false;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      fetchCount++;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          streamOpened = true;
          c.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n'));
        },
      });
      return new Response(stream);
    },
  });

  stop.reconnect();
  await settle();
  t.mock.timers.tick(200);
  await settle();

  assert.equal(statusResult, 'connected', 'reconnect transitions live sync from 403 unauthorized to connected');
  assert.equal(fetchCount, 2, 'reconnect initiates exactly one fresh connection after 403 recovery');
  assert.equal(streamOpened, true, 'stream was opened successfully on 403 recovery');

  stop();
});

test('healthy live sync is not torn down or reopened when ready event triggers onChange and successful fetch calls reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const descriptors = Object.fromEntries(
    ['document', 'window', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ])
  );
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  let statusResult: string | undefined;
  let sseConnections = 0;
  let onChangeCalls = 0;
  let streamAborted = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_url: unknown, init: RequestInit) => {
      sseConnections++;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
          c.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n'));
        },
      });
      init.signal?.addEventListener('abort', () => {
        streamAborted = true;
        try {
          streamController?.error(new DOMException('Aborted', 'AbortError'));
        } catch {}
      });
      return new Response(stream);
    },
  });

  let stop: ReturnType<typeof startOrderLiveSync> | undefined = undefined;
  t.after(() => {
    stop?.();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  stop = startOrderLiveSync({
    query: 'shopId=fixture',
    onChange: () => {
      onChangeCalls++;
      // Simulates CounterOrdersPage: fetchOrdersAndCatalog(true) calls liveSyncRef.current?.reconnect?.()
      stop?.reconnect();
    },
    onStatus: (s) => {
      statusResult = s;
    },
  });

  await settle();
  // Flush debounce timer (200ms) for ready event -> onChange
  t.mock.timers.tick(200);
  await settle();

  assert.equal(statusResult, 'connected', 'stream transitions to connected');
  assert.equal(onChangeCalls, 1, 'onChange invoked once for ready event');
  assert.equal(sseConnections, 1, 'initial SSE connection established');
  assert.equal(streamAborted, false, 'reconnect() did not abort healthy stream');

  // Advance time: prove healthy stream is not torn down, reopened, or caught in infinite loop
  t.mock.timers.tick(30000);
  await settle();
  assert.equal(onChangeCalls, 1, 'no runaway onChange invocations');
  assert.equal(sseConnections, 1, 'stream was not torn down and reopened');
  assert.equal(streamAborted, false, 'healthy stream remains open and unaborted');

  stop();
});

test('CounterOrdersPage enforces 401/403 session expiration, displays actionable alert with retry and login cta, and reconnects live sync on recovery', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const ordersPageSource = fsMod.readFileSync(
    pathMod.join(
      process.cwd(),
      'src/app/(dashboard)/dashboard/orders/page.tsx'
    ),
    'utf8'
  );

  // 1. fetchOrdersAndCatalog checks both 401 AND 403
  assert.match(
    ordersPageSource,
    /if\s*\(\s*ordersRes\.status\s*===\s*401\s*\|\|\s*ordersRes\.status\s*===\s*403\s*\)\s*\{\s*setSessionExpired\(true\);/
  );

  // 2. fetchOrdersAndCatalog clears sessionExpired and reconnects live sync on successful fetch
  assert.match(
    ordersPageSource,
    /else\s+if\s*\(\s*ordersRes\.ok\s*\)\s*\{\s*setSessionExpired\(false\);\s*liveSyncRef\.current\?\.reconnect\?\.?\(\);/
  );

  // 3. handleUpdateServiceRequestStatus checks 401 and 403
  assert.match(
    ordersPageSource,
    /if\s*\(\s*res\.status\s*===\s*401\s*\|\|\s*res\.status\s*===\s*403\s*\)\s*\{\s*setSessionExpired\(true\);/
  );

  // 4. handleUpdateOrder checks 401 and 403
  assert.match(
    ordersPageSource,
    /if\s*\(\s*res\.status\s*===\s*401\s*\|\|\s*res\.status\s*===\s*403\s*\)\s*setSessionExpired\(true\);/
  );

  // 5. Session expired banner renders role="alert", testid, actionable Retry button, and Sign In link
  assert.match(ordersPageSource, /data-testid="orders-session-expired-banner"/);
  assert.match(ordersPageSource, /role="alert"/);
  assert.match(
    ordersPageSource,
    /<button[^>]*onClick=\{\s*\(\)\s*=>\s*void\s+fetchOrdersAndCatalog\(false\)[\s\S]*?\{tx\(\s*['"]Thử lại['"]\s*,\s*['"]Retry['"]\s*\)\}/
  );
  assert.match(
    ordersPageSource,
    /href="\/login\?next=\/dashboard\/orders"/
  );
});

test('DashboardShell renders the shared full-card new-order toast and dismisses it on open', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const layoutSource = fsMod.readFileSync(
    pathMod.join(
      process.cwd(),
      'src/app/(dashboard)/dashboard/layout.tsx'
    ),
    'utf8'
  );

  const dashboardToastMatch = layoutSource.match(
    /\{liveToastOrder\s*&&\s*\(\s*<NewOrderToastCard\b([\s\S]*?)\/>\s*\)\s*\}/
  );
  assert.ok(
    dashboardToastMatch,
    'DashboardShell must render NewOrderToastCard for liveToastOrder'
  );
  const dashboardToastProps = dashboardToastMatch[1];

  // The production shell passes the current order/configuration and closes the toast.
  assert.match(
    dashboardToastProps,
    /order=\{liveToastOrder\}/,
    'DashboardShell must pass the current order into the shared card'
  );
  assert.match(
    dashboardToastProps,
    /position=\{toastPosition\}/,
    'DashboardShell must pass the configured toast position'
  );
  assert.match(
    dashboardToastProps,
    /onOpenOrders=\{\(\)\s*=>\s*setLiveToastOrder\(null\)\}/,
    'Opening the production toast must clear liveToastOrder'
  );
  assert.match(dashboardToastProps, /openOrdersLabel=\{t\(/);
  assert.match(dashboardToastProps, /newOrderBadgeLabel=\{t\(/);
  assert.match(dashboardToastProps, /totalLabel=\{tx\(/);

  assert.match(
    layoutSource,
    /import\s*\{[\s\S]*?\bNewOrderToastCard\b[\s\S]*?\}\s*from\s*['"]@\/components\/dashboard\/NewOrderToastCard['"][\s\S]*?function DashboardShell/,
    'DashboardLayout must import shared NewOrderToastCard before DashboardShell without exporting non-layout symbols from layout.tsx'
  );

  const toastCardSource = fsMod.readFileSync(
    pathMod.join(
      process.cwd(),
      'src/components/dashboard/NewOrderToastCard.tsx'
    ),
    'utf8'
  );
  const componentMatch = toastCardSource.match(
    /export function NewOrderToastCard\([\s\S]*\n\}/
  );
  assert.ok(componentMatch, 'NewOrderToastCard implementation must exist in shared component');
  const cardComponent = componentMatch[0];

  // The actual shared component uses one full-card link and one dismiss callback.
  assert.match(
    cardComponent,
    /<Link\s+href=\{targetHref\}/,
    'The shared card must navigate through one Next Link'
  );
  assert.match(
    cardComponent,
    /onOpenOrders\(\)/,
    'The link click must invoke the dismiss callback'
  );
  assert.doesNotMatch(
    dashboardToastProps,
    /targetHref=/,
    'The production card should keep its canonical /dashboard/orders target'
  );
  assert.match(cardComponent, /aria-live="polite"/);
  assert.match(cardComponent, /data-testid="new-order-toast-card"/);
  assert.match(cardComponent, /focus-visible:ring-2/);
  assert.match(cardComponent, /pointer-events-none/);
  assert.match(cardComponent, /cursor-pointer/);

  const linkMatches = cardComponent.match(/<Link\b/g);
  assert.equal(
    linkMatches?.length,
    1,
    'The shared card must have exactly one root Link'
  );
  const buttonMatches = cardComponent.match(/<button\b/g);
  assert.equal(
    buttonMatches,
    null,
    'The shared card must not have nested buttons'
  );
});

test('orders queue does not claim empty after its initial request fails', () => {
  const initial = createInitialCounterOrdersState('shop-1');
  const failed = reconcileCounterOrdersFetch(initial, {
    shopId: 'shop-1',
    activeShopId: 'shop-1',
    ok: false,
    status: 500,
    errorMessage: 'Could not load orders from server. (HTTP 500)',
  });

  assert.equal(failed.hasLoaded, false);
  assert.equal(failed.fetchError, 'Could not load orders from server. (HTTP 500)');
  const view = deriveCounterOrdersViewState({
    state: failed,
    activeShopId: 'shop-1',
    loading: false,
    liveStatus: 'connected',
    sessionExpired: false,
    filteredCount: 0,
  });
  assert.equal(view.hasAuthoritativeSnapshot, false);
  assert.equal(view.showInitialLoadErrorState, true);
  assert.equal(view.showRefreshErrorBanner, false);
  assert.equal(view.showConfirmedEmptyQueue, false);
});

test('orders queue preserves its successful snapshot state through a failed refresh and clears the warning on recovery', () => {
  const initial = createInitialCounterOrdersState('shop-1');
  const loaded = reconcileCounterOrdersFetch(initial, {
    shopId: 'shop-1',
    activeShopId: 'shop-1',
    ok: true,
  });
  const failed = reconcileCounterOrdersFetch(loaded, {
    shopId: 'shop-1',
    activeShopId: 'shop-1',
    ok: false,
    status: 503,
    errorMessage: 'Could not load orders from server. (HTTP 503)',
  });

  assert.equal(failed.hasLoaded, true);
  const staleView = deriveCounterOrdersViewState({
    state: failed,
    activeShopId: 'shop-1',
    loading: false,
    liveStatus: 'fallback',
    sessionExpired: false,
    filteredCount: 1,
  });
  assert.equal(staleView.hasAuthoritativeSnapshot, true);
  assert.equal(staleView.showInitialLoadErrorState, false);
  assert.equal(staleView.showRefreshErrorBanner, true);
  assert.equal(staleView.showConfirmedEmptyQueue, false);

  const recovered = reconcileCounterOrdersFetch(failed, {
    shopId: 'shop-1',
    activeShopId: 'shop-1',
    ok: true,
  });
  assert.equal(recovered.hasLoaded, true);
  assert.equal(recovered.fetchError, null);
});

test('orders 401 and 403 remain on the existing session-expired path', () => {
  for (const status of [401, 403]) {
    const failed = reconcileCounterOrdersFetch(
      createInitialCounterOrdersState('shop-1'),
      { shopId: 'shop-1', activeShopId: 'shop-1', ok: false, status }
    );
    const view = deriveCounterOrdersViewState({
      state: failed,
      activeShopId: 'shop-1',
      loading: false,
      liveStatus: 'connected',
      sessionExpired: true,
      filteredCount: 0,
    });

    assert.equal(failed.fetchError, null);
    assert.equal(view.showSessionExpiredBanner, true);
    assert.equal(view.showInitialLoadErrorState, false);
    assert.equal(view.showConfirmedEmptyQueue, false);
  }
});

test('orders snapshot state ignores stale shop responses and never carries a snapshot across shops', () => {
  const initial = createInitialCounterOrdersState('shop-1');
  const loaded = reconcileCounterOrdersFetch(initial, {
    shopId: 'shop-1',
    activeShopId: 'shop-1',
    ok: true,
  });
  const stale = reconcileCounterOrdersFetch(loaded, {
    shopId: 'shop-1',
    activeShopId: 'shop-2',
    ok: false,
    status: 500,
    errorMessage: 'stale failure',
  });
  assert.equal(stale, loaded);

  const switchedView = deriveCounterOrdersViewState({
    state: loaded,
    activeShopId: 'shop-2',
    loading: false,
    liveStatus: 'connected',
    sessionExpired: false,
    filteredCount: 0,
  });
  assert.equal(switchedView.hasAuthoritativeSnapshot, false);
  assert.equal(switchedView.showConfirmedEmptyQueue, false);
});

test('counter orders tab: 0 orders today but older orders exist (QA production fallback scenario)', () => {
  const todayVnKey = '2026-10-28';
  const olderOrders = [
    {
      id: 'old-order-1',
      order_code: 'OLD-001',
      created_at: '2026-10-26T10:00:00.000Z', // 2 days ago
      status: 'completed',
      payment_status: 'paid',
      total_amount: 85000,
    },
    {
      id: 'old-order-2',
      order_code: 'OLD-002',
      created_at: '2026-10-27T15:30:00.000Z', // yesterday
      status: 'completed',
      payment_status: 'paid',
      total_amount: 120000,
    },
    {
      id: 'old-cancelled',
      order_code: 'OLD-003',
      created_at: '2026-10-27T16:00:00.000Z',
      status: 'cancelled',
      payment_status: 'unpaid',
      total_amount: 50000,
    },
  ];

  const state = computeCounterTodayTabState({
    orders: olderOrders,
    todayVnKey,
  });

  // 1. Independent today statistics: must be strictly 0 today
  assert.equal(state.todayValidCount, 0, 'Today valid orders count must be 0');
  assert.equal(state.todayPaidCount, 0, 'Today paid orders count must be 0');
  assert.equal(state.todayRevenue, 0, 'Today revenue must be 0đ');

  // 2. Fallback history detection: fallback is active
  assert.equal(state.isHistoryFallback, true, 'isHistoryFallback must be true when 0 today but older uncancelled orders exist');

  // 3. Tab orders count: reflects actual non-cancelled historical cards (2 cards, not 0)
  assert.equal(state.tabOrdersCount, 2, 'Tab orders badge count must match the 2 visible cards, fixing badge 0 defect');

  const filtered = filterCounterTodayTabOrders(olderOrders, todayVnKey);
  assert.equal(filtered.length, 2);
  assert.deepEqual(filtered.map((o) => o.id), ['old-order-1', 'old-order-2']);

  // 4. Tab label: VI & EN reflect fallback history without misleading user about today or unpaid
  const labelVi = resolveCounterTodayTabLabel({
    tabOrdersCount: state.tabOrdersCount,
    isHistoryFallback: state.isHistoryFallback,
    locale: 'vi',
  });
  const labelEn = resolveCounterTodayTabLabel({
    tabOrdersCount: state.tabOrdersCount,
    isHistoryFallback: state.isHistoryFallback,
    locale: 'en',
  });
  assert.equal(labelVi, 'Đơn gần đây (2)');
  assert.equal(labelEn, 'Recent orders (2)');

  // 5. When snapshot is not yet authoritative, count renders '—'
  const labelLoadingVi = resolveCounterTodayTabLabel({
    tabOrdersCount: '—',
    isHistoryFallback: state.isHistoryFallback,
    locale: 'vi',
  });
  assert.equal(labelLoadingVi, 'Đơn gần đây (—)');
});

test('counter orders tab: orders today mixed with older orders (in-flight & completed)', () => {
  const todayVnKey = '2026-10-28';
  const mixedOrders = [
    {
      id: 'today-order-1',
      order_code: 'TODAY-001',
      created_at: '2026-10-28T02:15:00.000Z', // today in VN (+7)
      status: 'completed',
      payment_status: 'paid',
      total_amount: 55000,
    },
    {
      id: 'today-order-2',
      order_code: 'TODAY-002',
      created_at: '2026-10-28T03:00:00.000Z',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 60000,
    },
    {
      id: 'old-unpaid',
      order_code: 'OLD-UNPAID',
      created_at: '2026-10-27T08:00:00.000Z', // yesterday in VN time (+7 -> 15:00 on Oct 27), still unpaid needing attention
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 75000,
    },
    {
      id: 'old-paid',
      order_code: 'OLD-PAID',
      created_at: '2026-10-27T10:00:00.000Z', // yesterday, settled
      status: 'completed',
      payment_status: 'paid',
      total_amount: 90000,
    },
    {
      id: 'today-cancelled',
      order_code: 'TODAY-CAN',
      created_at: '2026-10-28T04:00:00.000Z',
      status: 'cancelled',
      payment_status: 'unpaid',
      total_amount: 40000,
    },
  ];

  const state = computeCounterTodayTabState({
    orders: mixedOrders,
    todayVnKey,
  });

  // 1. Independent today statistics: only today's valid orders (cancelled excluded)
  // today-order-1 and today-order-2
  assert.equal(state.todayValidCount, 2, 'Today valid orders count must only count today non-cancelled orders');
  assert.equal(state.todayPaidCount, 1, 'Today paid orders count must only count today paid orders');
  assert.equal(state.todayRevenue, 55000, 'Today revenue must strictly include today paid orders (55,000đ)');

  // 2. Fallback history detection: false because today has valid orders
  assert.equal(state.isHistoryFallback, false);

  // 3. Tab orders count: includes today orders (today-1, today-2) + older unpaid/in-progress order (old-unpaid)
  // old-paid is excluded from this tab because today has orders and old-paid is completed & paid!
  assert.equal(state.tabOrdersCount, 3, 'Tab badge must show 3 (2 today + 1 old unpaid needing collection)');

  const filtered = filterCounterTodayTabOrders(mixedOrders, todayVnKey);
  assert.equal(filtered.length, 3);
  assert.deepEqual(filtered.map((o) => o.id), ['today-order-1', 'today-order-2', 'old-unpaid']);

  // 4. Tab label: VI & EN reflect "Hôm nay & cần xử lý"
  const labelVi = resolveCounterTodayTabLabel({
    tabOrdersCount: state.tabOrdersCount,
    isHistoryFallback: state.isHistoryFallback,
    locale: 'vi',
  });
  const labelEn = resolveCounterTodayTabLabel({
    tabOrdersCount: state.tabOrdersCount,
    isHistoryFallback: state.isHistoryFallback,
    locale: 'en',
  });
  assert.equal(labelVi, 'Hôm nay & cần xử lý (3)');
  assert.equal(labelEn, 'Today & pending (3)');

  // 5. Verify custom tx translator works identically
  const customTx = (vi: string, en?: string | null, params?: Record<string, string | number | null | undefined>) => {
    let text = vi;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
      }
    }
    return text;
  };
  const labelTx = resolveCounterTodayTabLabel({
    tabOrdersCount: state.tabOrdersCount,
    isHistoryFallback: state.isHistoryFallback,
    tx: customTx,
  });
  assert.equal(labelTx, 'Hôm nay & cần xử lý (3)');
});

test('counter orders tab: completely empty queue (0 today and 0 history)', () => {
  const state = computeCounterTodayTabState({
    orders: [],
    todayVnKey: '2026-10-28',
  });

  assert.equal(state.todayValidCount, 0);
  assert.equal(state.todayPaidCount, 0);
  assert.equal(state.todayRevenue, 0);
  assert.equal(state.tabOrdersCount, 0);
  assert.equal(state.isHistoryFallback, false);

  const labelVi = resolveCounterTodayTabLabel({
    tabOrdersCount: 0,
    isHistoryFallback: false,
    locale: 'vi',
  });
  const labelEn = resolveCounterTodayTabLabel({
    tabOrdersCount: 0,
    isHistoryFallback: false,
    locale: 'en',
  });
  assert.equal(labelVi, 'Hôm nay & cần xử lý (0)');
  assert.equal(labelEn, 'Today & pending (0)');
});

test('counter orders tab: translation dictionary keys and fallback notice parity', () => {
  assert.ok(APP_DICTIONARY.vi['orders.filterTodayPending']);
  assert.ok(APP_DICTIONARY.en['orders.filterTodayPending']);
  assert.ok(APP_DICTIONARY.vi['orders.filterRecentFallback']);
  assert.ok(APP_DICTIONARY.en['orders.filterRecentFallback']);
  assert.ok(APP_DICTIONARY.vi['orders.todayHistoryFallbackNotice']);
  assert.ok(APP_DICTIONARY.en['orders.todayHistoryFallbackNotice']);

  assert.equal(APP_DICTIONARY.vi['orders.filterTodayPending'], 'Hôm nay & cần xử lý ({count})');
  assert.equal(APP_DICTIONARY.en['orders.filterTodayPending'], 'Today & pending ({count})');
  assert.equal(APP_DICTIONARY.vi['orders.filterRecentFallback'], 'Đơn gần đây ({count})');
  assert.equal(APP_DICTIONARY.en['orders.filterRecentFallback'], 'Recent orders ({count})');

  // Verify fallback notice explains historical paid orders clearly
  assert.match(
    APP_DICTIONARY.vi['orders.todayHistoryFallbackNotice'],
    /đã thanh toán trước đó/i,
    'VI notice must explain that recent history may include settled orders'
  );
  assert.match(
    APP_DICTIONARY.en['orders.todayHistoryFallbackNotice'],
    /previously settled orders/i,
    'EN notice must explain that recent history may include settled orders'
  );
});
