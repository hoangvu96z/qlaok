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
