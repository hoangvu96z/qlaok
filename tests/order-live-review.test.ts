import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOrderEvents, startOrderLiveSync } from '@/lib/order-live-sync';

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
    let stop: (() => void) | undefined;
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

  let stop: ReturnType<typeof startOrderLiveSync> | undefined;
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

  let stop: ReturnType<typeof startOrderLiveSync> | undefined;
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

  let stop: ReturnType<typeof startOrderLiveSync> | undefined;
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

