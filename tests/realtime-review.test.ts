import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
]) {
  delete process.env[key];
}

const originalCwd = process.cwd();
const fixtureDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qlaok-realtime-review-')
);
process.chdir(fixtureDir);

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const { issueSessionToken } = await import('@/lib/server-auth');
const { dbUpsertShopMembership } = await import('@/lib/shop-permissions');
const { dbCreateOrder, resetMposStoreForTests } = await import(
  '@/lib/mpos-store'
);
const {
  OrderEventsBroker,
  getOrderEventsBroker,
  resetOrderEventsBrokerForTests,
  setOrderEventsClientFactoryForTests,
  setOrderEventsStreamOptionsForTests,
  DEFAULT_POSTGRES_CHANNEL,
} = await import('@/lib/order-events');
const { readOrderEvents } = await import('@/lib/order-live-sync');
const { GET: orderEventsGet } = await import('@/app/api/orders/events/route');

import type {
  OrderSseEvent,
  PostgresListenerClientLike,
  PostgresNotificationMessage,
  PostgresOrderNotification,
} from '@/lib/order-events';

interface MockUpstreamHarness {
  createClient: () => PostgresListenerClientLike;
  getConnectionCount: () => number;
  getRemovedCount: () => number;
  emitError: () => void;
  emitChange: (payload: PostgresOrderNotification) => void;
}

function createMockUpstreamHarness(): MockUpstreamHarness {
  type Listener = Parameters<NonNullable<PostgresListenerClientLike['on']>>[1];
  const connections: Array<{
    active: boolean;
    listeners: Record<string, Listener[]>;
  }> = [];
  let connectionCount = 0;
  let removedCount = 0;

  const createClient = (): PostgresListenerClientLike => {
    const connection = { active: true, listeners: {} as Record<string, Listener[]> };
    const client: PostgresListenerClientLike = {
      connect: async () => {
        connectionCount += 1;
      },
      query: async () => undefined,
      on(event, listener) {
        connection.listeners[event] = connection.listeners[event] || [];
        connection.listeners[event].push(listener);
        return client;
      },
      removeListener(event, listener) {
        connection.listeners[event] = (connection.listeners[event] || []).filter(
          (entry) => entry !== listener
        );
        return client;
      },
      end: async () => {
        if (connection.active) {
          connection.active = false;
          removedCount += 1;
        }
      },
    };
    connections.push(connection);
    return client;
  };

  return {
    createClient,
    getConnectionCount: () => connectionCount,
    getRemovedCount: () => removedCount,
    emitError: () => {
      for (const connection of connections) {
        if (!connection.active) continue;
        for (const listener of connection.listeners.error || []) {
          (listener as () => void)();
        }
      }
    },
    emitChange: (payload: PostgresOrderNotification) => {
      for (const connection of connections) {
        if (!connection.active) continue;
        for (const listener of connection.listeners.notification || []) {
          (listener as (message: PostgresNotificationMessage) => void)({
            channel: DEFAULT_POSTGRES_CHANNEL,
            payload: JSON.stringify(payload),
          });
        }
      }
    },
  };
}

function collectSseEvents(response: Response): {
  events: OrderSseEvent[];
  done: Promise<void>;
  waitForCount: (count: number, timeoutMs?: number) => Promise<OrderSseEvent[]>;
} {
  assert.ok(response.body, 'Expected SSE response body');
  const events: OrderSseEvent[] = [];
  const waiters: Array<() => void> = [];

  const done = readOrderEvents(response.body, (raw) => {
    events.push(raw as OrderSseEvent);
    while (waiters.length > 0) {
      waiters.shift()?.();
    }
  }).catch(() => {
    // Aborted stream closes reader
  });

  const waitForCount = async (
    count: number,
    timeoutMs = 1500
  ): Promise<OrderSseEvent[]> => {
    const deadline = Date.now() + timeoutMs;
    while (events.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for ${count} SSE events; got ${JSON.stringify(events)}`
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(remaining, 25));
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return events;
  };

  return { events, done, waitForCount };
}

beforeEach(() => {
  resetOrderEventsBrokerForTests();
  setOrderEventsClientFactoryForTests(null);
  setOrderEventsStreamOptionsForTests(null);
  resetMposStoreForTests();
  for (const key of [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
  ]) {
    delete process.env[key];
  }
});

test('rejects invalid query params, unauthenticated shop streams, unauthorized roles, and invalid guest tracking tokens', async () => {
  // Missing both shopId and orderId
  const missingParamsRes = await orderEventsGet(
    new Request('http://localhost/api/orders/events')
  );
  assert.equal(missingParamsRes.status, 400);

  // Providing both shopId and orderId
  const bothParamsRes = await orderEventsGet(
    new Request(
      'http://localhost/api/orders/events?shopId=shop-fnb-001&orderId=ord-seed-101'
    )
  );
  assert.equal(bothParamsRes.status, 400);

  // Unauthenticated shopId request
  const unauthShopRes = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001')
  );
  assert.equal(unauthShopRes.status, 401);

  // Staff member without orders.view permission
  const noOrdersViewToken = issueSessionToken({
    id: 'realtime-no-view-user',
    email: 'noview@example.test',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'realtime-no-view-user',
    role: 'staff',
    permissions: ['catalog.manage'],
  });
  const forbiddenShopRes = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${noOrdersViewToken}` },
    })
  );
  assert.equal(forbiddenShopRes.status, 403);

  // Guest order stream requires x-tracking-token header (query param alone must not bypass header requirement)
  const order = await dbCreateOrder({
    shop_id: 'shop-fnb-001',
    table_label: 'Bàn 9',
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở',
        quantity: 1,
        unit_price: 55000,
        extra_price: 0,
        selected_choices: [{ id: 'size-m', label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' }, extra_price: 0 }],
      },
    ],
  });
  assert.ok(order.tracking_token);

  const missingHeaderRes = await orderEventsGet(
    new Request(
      `http://localhost/api/orders/events?orderId=${encodeURIComponent(order.id)}&trackingToken=${encodeURIComponent(order.tracking_token)}`
    )
  );
  assert.equal(missingHeaderRes.status, 401);

  const wrongTokenRes = await orderEventsGet(
    new Request(
      `http://localhost/api/orders/events?orderId=${encodeURIComponent(order.id)}`,
      {
        headers: { 'x-tracking-token': 'forged-token-value' },
      }
    )
  );
  assert.equal(wrongTokenRes.status, 403);
});

test('returns 503 when production backend key is missing or publishable key is supplied, and emits fallback in local test mode', async () => {
  const staffToken = issueSessionToken({
    id: 'realtime-staff-1',
    email: 'staff1@example.test',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'realtime-staff-1',
    role: 'staff',
    permissions: ['orders.view'],
  });

  // 1. Production with missing SUPABASE_SERVICE_ROLE_KEY -> 503
  const prevNodeEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'production-session-secret-key-at-least-16';
  try {
    const prodRes = await orderEventsGet(
      new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
        headers: { Authorization: `Bearer ${staffToken}` },
      })
    );
    assert.equal(prodRes.status, 503);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    delete process.env.SESSION_SECRET;
  }

  // 2. Misconfigured publishable key in SUPABASE_SERVICE_ROLE_KEY -> 503
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_not_a_service_key';
  const badKeyRes = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${staffToken}` },
    })
  );
  assert.equal(badKeyRes.status, 503);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 3. Local test mode without Supabase backend key -> opens SSE stream and emits {type:"fallback"}, never faking ready
  const abortController = new AbortController();
  const localRes = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${staffToken}` },
      signal: abortController.signal,
    })
  );
  assert.equal(localRes.status, 200);
  const collector = collectSseEvents(localRes);
  await collector.waitForCount(1);
  assert.deepEqual(collector.events, [{ type: 'fallback' }]);
  abortController.abort();
  await collector.done;
});

test('shares one upstream subscription across clients, enforces shop/order isolation, strips sensitive data, and cleans up on abort', async () => {
  const harness = createMockUpstreamHarness();
  setOrderEventsClientFactoryForTests(() => harness.createClient());

  const shop1Token = issueSessionToken({
    id: 'realtime-shop1-staff',
    email: 'shop1@example.test',
  });
  const shop2Token = issueSessionToken({
    id: 'realtime-shop2-staff',
    email: 'shop2@example.test',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'realtime-shop1-staff',
    role: 'staff',
    permissions: ['orders.view'],
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-service-002',
    user_id: 'realtime-shop2-staff',
    role: 'staff',
    permissions: ['orders.view'],
  });

  const order1 = await dbCreateOrder({
    shop_id: 'shop-fnb-001',
    table_label: 'Bàn 1',
    customer_note: 'Sensitive note',
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở',
        quantity: 1,
        unit_price: 55000,
        extra_price: 0,
        selected_choices: [{ id: 'size-m', label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' }, extra_price: 0 }],
      },
    ],
  });
  const order2 = await dbCreateOrder({
    shop_id: 'shop-fnb-001',
    table_label: 'Bàn 2',
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở',
        quantity: 1,
        unit_price: 55000,
        extra_price: 0,
        selected_choices: [{ id: 'size-m', label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' }, extra_price: 0 }],
      },
    ],
  });

  const abortShop1 = new AbortController();
  const abortShop2 = new AbortController();
  const abortGuest1 = new AbortController();

  const resShop1 = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${shop1Token}` },
      signal: abortShop1.signal,
    })
  );
  const resShop2 = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-service-002', {
      headers: { Authorization: `Bearer ${shop2Token}` },
      signal: abortShop2.signal,
    })
  );
  const resGuest1 = await orderEventsGet(
    new Request(
      `http://localhost/api/orders/events?orderId=${encodeURIComponent(order1.id)}`,
      {
        headers: { 'x-tracking-token': order1.tracking_token! },
        signal: abortGuest1.signal,
      }
    )
  );

  const streamShop1 = collectSseEvents(resShop1);
  const streamShop2 = collectSseEvents(resShop2);
  const streamGuest1 = collectSseEvents(resGuest1);

  const broker = getOrderEventsBroker();
  assert.equal(broker.getActiveClientCount(), 3);
  assert.equal(broker.getActiveUpstreamChannelCount(), 1);
  assert.equal(
    harness.getConnectionCount(),
    1,
    'must open only one upstream PostgreSQL connection'
  );

  // Must NOT fake ready before upstream emits SUBSCRIBED
  assert.equal(streamShop1.events.length, 0);
  assert.equal(streamShop2.events.length, 0);
  assert.equal(streamGuest1.events.length, 0);

  // PostgreSQL LISTEN succeeds -> all clients receive {type:"ready"}
  await streamShop1.waitForCount(1);
  await streamShop2.waitForCount(1);
  await streamGuest1.waitForCount(1);
  assert.deepEqual(streamShop1.events, [{ type: 'ready' }]);
  assert.deepEqual(streamShop2.events, [{ type: 'ready' }]);
  assert.deepEqual(streamGuest1.events, [{ type: 'ready' }]);

  // Emit change for order1 in shop-fnb-001 with sensitive fields
  harness.emitChange({
    eventType: 'UPDATE',
    new: {
      id: order1.id,
      shop_id: 'shop-fnb-001',
      customer_note: 'Private customer phone 0909123456',
      total_amount: 999000,
      payment_status: 'paid',
      tracking_token: order1.tracking_token,
    },
  });

  await streamShop1.waitForCount(2);
  await streamGuest1.waitForCount(2);

  // Shop 1 and Guest 1 receive minimal change event without customer/payment data
  assert.deepEqual(streamShop1.events[1], {
    type: 'change',
    orderId: order1.id,
    shopId: 'shop-fnb-001',
  });
  assert.deepEqual(streamGuest1.events[1], {
    type: 'change',
    orderId: order1.id,
    shopId: 'shop-fnb-001',
  });
  // Shop 2 must NOT receive Shop 1 events
  assert.equal(streamShop2.events.length, 1);

  // Emit change for order2 in shop-fnb-001: Shop 1 receives it, Guest 1 (subscribed to order1) must NOT
  harness.emitChange({
    eventType: 'UPDATE',
    new: {
      id: order2.id,
      shop_id: 'shop-fnb-001',
      status: 'preparing',
    },
  });
  await streamShop1.waitForCount(3);
  assert.deepEqual(streamShop1.events[2], {
    type: 'change',
    orderId: order2.id,
    shopId: 'shop-fnb-001',
  });
  assert.equal(
    streamGuest1.events.length,
    2,
    'guest subscribed to order1 must not receive events for order2'
  );
  assert.equal(streamShop2.events.length, 1);

  // Disconnect all 3 clients and verify upstream channel is torn down
  abortShop1.abort();
  abortShop2.abort();
  abortGuest1.abort();
  await Promise.all([streamShop1.done, streamShop2.done, streamGuest1.done]);

  assert.equal(broker.getActiveClientCount(), 0);
  assert.equal(broker.getActiveUpstreamChannelCount(), 0);
  assert.equal(harness.getRemovedCount(), 1);
});

test('emits fallback on upstream channel error, resyncs on reconnect, and disconnects revoked members on revalidation', async () => {
  const harness = createMockUpstreamHarness();
  const fastBroker = new OrderEventsBroker({
    createClient: () => harness.createClient(),
    reconnectDelayMs: 10,
  });
  setOrderEventsStreamOptionsForTests({
    broker: fastBroker,
    heartbeatIntervalMs: 30,
    revalidateIntervalMs: 40,
    maxStreamLifetimeMs: 2_000,
  });

  const revocableToken = issueSessionToken({
    id: 'realtime-revocable-user',
    email: 'revocable@example.test',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'realtime-revocable-user',
    role: 'staff',
    permissions: ['orders.view'],
    is_active: true,
  });

  const abortController = new AbortController();
  const res = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${revocableToken}` },
      signal: abortController.signal,
    })
  );
  const collector = collectSseEvents(res);

  await collector.waitForCount(1);
  assert.deepEqual(collector.events[0], { type: 'ready' });

  // PostgreSQL connection error -> emits fallback
  harness.emitError();
  await collector.waitForCount(2);
  assert.deepEqual(collector.events[1], { type: 'fallback' });

  // PostgreSQL reconnect -> emits ready + resync change event
  await collector.waitForCount(4);
  assert.deepEqual(collector.events[2], { type: 'ready' });
  assert.deepEqual(collector.events[3], {
    type: 'change',
    shopId: 'shop-fnb-001',
  });

  // Revoke orders.view permission -> revalidation timer emits {type:"unauthorized"} and closes stream
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'realtime-revocable-user',
    role: 'staff',
    permissions: [],
    is_active: false,
  });

  await collector.waitForCount(5, 1000);
  assert.deepEqual(collector.events[4], { type: 'unauthorized' });
  await collector.done;
  assert.equal(fastBroker.getActiveClientCount(), 0);
  assert.equal(fastBroker.getActiveUpstreamChannelCount(), 0);
});

test('enforces max stream lifetime reconnect closure and bounded broker capacity', async () => {
  const harness = createMockUpstreamHarness();
  setOrderEventsClientFactoryForTests(() => harness.createClient());
  const broker = getOrderEventsBroker();
  setOrderEventsStreamOptionsForTests({
    broker,
    heartbeatIntervalMs: 25,
    revalidateIntervalMs: 500,
    maxStreamLifetimeMs: 80,
  });

  const order = await dbCreateOrder({
    shop_id: 'shop-fnb-001',
    table_label: 'Bàn 5',
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở',
        quantity: 1,
        unit_price: 55000,
        extra_price: 0,
        selected_choices: [{ id: 'size-m', label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' }, extra_price: 0 }],
      },
    ],
  });

  const res = await orderEventsGet(
    new Request(
      `http://localhost/api/orders/events?orderId=${encodeURIComponent(order.id)}`,
      {
        headers: { 'x-tracking-token': order.tracking_token! },
      }
    )
  );
  const collector = collectSseEvents(res);
  await collector.waitForCount(1);
  assert.deepEqual(collector.events, [{ type: 'ready' }]);

  // Stream should automatically close after maxStreamLifetimeMs (~80ms) and release upstream
  await collector.done;
  assert.equal(broker.getActiveClientCount(), 0);
  assert.equal(broker.getActiveUpstreamChannelCount(), 0);
});

test('PostgreSQL LISTEN listener lifecycle: connect, listen query, minimal payload dispatch, error fallback, resync on reconnect, and clean release', async () => {
  let connectCount = 0;
  let endCount = 0;
  const queries: string[] = [];
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const mockPgClient = {
    connect: async () => {
      connectCount++;
    },
    query: async (sql: string) => {
      queries.push(sql);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(listener);
      return mockPgClient;
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((l) => l !== listener);
      }
      return mockPgClient;
    },
    end: async () => {
      endCount++;
    },
  };

  setOrderEventsClientFactoryForTests(
    () => mockPgClient as unknown as PostgresListenerClientLike
  );
  const broker = getOrderEventsBroker();
  setOrderEventsStreamOptionsForTests({
    broker,
    heartbeatIntervalMs: 50,
    revalidateIntervalMs: 1000,
    maxStreamLifetimeMs: 5000,
  });

  const staffToken = issueSessionToken({
    id: 'pg-realtime-staff',
    email: 'pg-staff@example.test',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: 'pg-realtime-staff',
    role: 'staff',
    permissions: ['orders.view'],
  });

  const abortController = new AbortController();
  const res = await orderEventsGet(
    new Request('http://localhost/api/orders/events?shopId=shop-fnb-001', {
      headers: { Authorization: `Bearer ${staffToken}` },
      signal: abortController.signal,
    })
  );

  const collector = collectSseEvents(res);
  await collector.waitForCount(1);

  // Upstream established: client.connect() called and LISTEN query executed
  assert.equal(connectCount, 1);
  assert.ok(queries.some((q) => q.includes('LISTEN qlaok_order_events')));
  assert.deepEqual(collector.events[0], { type: 'ready' });
  assert.equal(broker.getStatus(), 'subscribed');
  assert.equal(broker.getActiveClientCount(), 1);
  assert.equal(broker.getActiveUpstreamChannelCount(), 1);

  // Emit PostgreSQL notification with minimal orders payload
  const notifCallbacks = listeners['notification'] || [];
  for (const cb of notifCallbacks) {
    cb({
      channel: 'qlaok_order_events',
      payload: JSON.stringify({
        table: 'orders',
        eventType: 'INSERT',
        orderId: 'ord-pg-1',
        shopId: 'shop-fnb-001',
      }),
    });
  }

  await collector.waitForCount(2);
  assert.deepEqual(collector.events[1], {
    type: 'change',
    orderId: 'ord-pg-1',
    shopId: 'shop-fnb-001',
  });

  // Emit PostgreSQL notification for table_service_requests
  for (const cb of notifCallbacks) {
    cb({
      channel: 'qlaok_order_events',
      payload: JSON.stringify({
        table: 'table_service_requests',
        eventType: 'INSERT',
        shopId: 'shop-fnb-001',
      }),
    });
  }

  await collector.waitForCount(3);
  assert.deepEqual(collector.events[2], {
    type: 'change',
    shopId: 'shop-fnb-001',
  });

  // Emit connection error -> broker enters fallback and notifies clients
  const errorCallbacks = listeners['error'] || [];
  for (const cb of errorCallbacks) {
    cb(new Error('Connection terminated'));
  }

  await collector.waitForCount(4);
  assert.deepEqual(collector.events[3], { type: 'fallback' });
  assert.equal(broker.getStatus(), 'fallback');

  // Clean disconnect: abort request closes stream and releases listener
  abortController.abort();
  await collector.done;
  assert.equal(broker.getActiveClientCount(), 0);
  assert.equal(broker.getActiveUpstreamChannelCount(), 0);
  assert.equal(broker.getStatus(), 'idle');
  assert.ok(endCount >= 1, 'must call client.end() to cleanly release PostgreSQL listener');
});
