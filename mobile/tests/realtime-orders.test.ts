import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  detectBrandNewOrder,
  handleBrandNewOrderNotifications,
} from '../src/lib/realtime-orders.ts';
import {
  isOrderNotificationRecorded,
  LOCAL_ORDER_CHIME_TYPE,
  recordOrderNotification,
  resetOrderNotificationRegistry,
  resolveForegroundNotificationBehavior,
} from '../src/lib/push-notifications.ts';
import type { MobileShopOrder } from '../src/lib/supabase.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.beforeEach(() => {
  resetOrderNotificationRegistry();
});

function createMockOrder(overrides: Partial<MobileShopOrder>): MobileShopOrder {
  return {
    id: 'ord-default',
    shop_id: 'shop-1',
    order_code: 'ORD-001',
    table_label: 'Bàn 1',
    visitor_lang: 'vi',
    status: 'new',
    payment_method: 'vietqr',
    payment_status: 'unpaid',
    customer_note: 'Ghi chú',
    total_amount: 100000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

test('detectBrandNewOrder: ordinary initial sync does not trigger brand new order alert or sound', () => {
  const initialOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
    createMockOrder({ id: 'ord-3', order_code: 'ORD-003', status: 'preparing' }),
  ];

  const result = detectBrandNewOrder({
    nextOrders: initialOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: true,
  });

  // Must not trigger alert or chime on first load
  assert.equal(result.brandNewOrder, null);
  // Must remember the IDs of all currently 'new' orders to dedupe future checks
  assert.equal(result.nextKnownNewOrderIds.size, 2);
  assert.equal(result.nextKnownNewOrderIds.has('ord-1'), true);
  assert.equal(result.nextKnownNewOrderIds.has('ord-2'), true);
  assert.equal(result.nextKnownNewOrderIds.has('ord-3'), false);
});

test('detectBrandNewOrder: existing orders, reconnects, and status transitions do not trigger alert or sound', () => {
  const knownIds = new Set(['ord-1', 'ord-2']);

  // 1. Reconnect or re-fetch returns the same orders
  const refetchOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
  ];
  const refetchResult = detectBrandNewOrder({
    nextOrders: refetchOrders,
    knownNewOrderIds: knownIds,
    isFirstLoad: false,
  });
  assert.equal(refetchResult.brandNewOrder, null);
  assert.deepEqual(refetchResult.nextKnownNewOrderIds, knownIds);

  // 2. Order status transition from 'new' -> 'preparing' or 'completed'
  const transitionedOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'preparing' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
  ];
  const transitionResult = detectBrandNewOrder({
    nextOrders: transitionedOrders,
    knownNewOrderIds: knownIds,
    isFirstLoad: false,
  });
  assert.equal(transitionResult.brandNewOrder, null);
  // ord-1 is no longer 'new', so nextKnownNewOrderIds only retains ord-2
  assert.equal(transitionResult.nextKnownNewOrderIds.size, 1);
  assert.equal(transitionResult.nextKnownNewOrderIds.has('ord-2'), true);
  assert.equal(transitionResult.nextKnownNewOrderIds.has('ord-1'), false);
});

test('detectBrandNewOrder: genuinely new customer order arriving foregrounded triggers alert and captures details', () => {
  const knownIds = new Set(['ord-1', 'ord-2']);

  const nextOrdersWithNew: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
    createMockOrder({
      id: 'ord-brand-new',
      order_code: 'ORD-003',
      table_label: 'Bàn 7',
      total_amount: 185000,
      status: 'new',
    }),
  ];

  const result = detectBrandNewOrder({
    nextOrders: nextOrdersWithNew,
    knownNewOrderIds: knownIds,
    isFirstLoad: false,
  });

  // Must identify the brand new order
  assert.notEqual(result.brandNewOrder, null);
  assert.equal(result.brandNewOrder?.id, 'ord-brand-new');
  assert.equal(result.brandNewOrder?.order_code, 'ORD-003');
  assert.equal(result.brandNewOrder?.table_label, 'Bàn 7');
  assert.equal(result.brandNewOrder?.total_amount, 185000);

  // Must add the brand new order to known IDs
  assert.equal(result.nextKnownNewOrderIds.size, 3);
  assert.equal(result.nextKnownNewOrderIds.has('ord-brand-new'), true);

  // Subsequent fetch with the new order now known does not re-trigger
  const subsequentResult = detectBrandNewOrder({
    nextOrders: nextOrdersWithNew,
    knownNewOrderIds: result.nextKnownNewOrderIds,
    isFirstLoad: false,
  });
  assert.equal(subsequentResult.brandNewOrder, null);
});

test('handleBrandNewOrderNotifications: triggers exactly one local notification chime, vibration, and in-app alert for a genuinely new order', () => {
  const knownIds = new Set(['ord-1', 'ord-2']);
  const scheduledPayloads: unknown[] = [];
  const alerts: unknown[] = [];
  let vibrationCount = 0;

  const nextOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
    createMockOrder({
      id: 'ord-brand-new',
      order_code: 'ORD-003',
      table_label: 'Bàn 7',
      total_amount: 185000,
      shop_id: 'shop-abc',
      status: 'new',
    }),
  ];

  const result = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: knownIds,
    isFirstLoad: false,
    onAlert: (alert) => alerts.push(alert),
    onVibrate: () => {
      vibrationCount += 1;
    },
    scheduleNotificationAsync: (req) => {
      scheduledPayloads.push(req);
      return Promise.resolve('notif-123');
    },
  });

  // Exactly one brand-new order detected
  assert.equal(result.brandNewOrder?.id, 'ord-brand-new');

  // In-app alert was called exactly once with order details
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0], {
    orderCode: 'ORD-003',
    tableLabel: 'Bàn 7',
    totalAmount: 185000,
  });

  // Vibration was triggered exactly once
  assert.equal(vibrationCount, 1);

  // Exactly one local notification sound was scheduled via expo-notifications contract
  assert.equal(scheduledPayloads.length, 1);
  const payload = scheduledPayloads[0] as {
    content: {
      sound: string;
      data: { type: string; orderId: string; orderCode: string; shopId: string };
    };
    trigger: { channelId: string } | null;
  };
  assert.equal(payload.content.sound, 'default');
  assert.equal(payload.content.data.type, LOCAL_ORDER_CHIME_TYPE);
  assert.equal(payload.content.data.orderId, 'ord-brand-new');
  assert.equal(payload.content.data.orderCode, 'ORD-003');
  assert.equal(payload.content.data.shopId, 'shop-abc');
  assert.deepEqual(payload.trigger, { channelId: 'qlaok-orders' });

  // Subsequent update with the same orders does NOT re-trigger sound, vibration, or alert
  const secondRunScheduled: unknown[] = [];
  let secondVibration = 0;
  const secondAlerts: unknown[] = [];

  const secondResult = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: result.nextKnownNewOrderIds,
    isFirstLoad: false,
    onAlert: (alert) => secondAlerts.push(alert),
    onVibrate: () => {
      secondVibration += 1;
    },
    scheduleNotificationAsync: (req) => {
      secondRunScheduled.push(req);
      return Promise.resolve('notif-456');
    },
  });

  assert.equal(secondResult.brandNewOrder, null);
  assert.equal(secondRunScheduled.length, 0);
  assert.equal(secondVibration, 0);
  assert.equal(secondAlerts.length, 0);
});

test('handleBrandNewOrderNotifications: initial fetch, reconnect, status transition, and shop switch never schedule notification chime', () => {
  const scheduled: unknown[] = [];
  let vibration = 0;
  const alerts: unknown[] = [];

  const helperParams = {
    scheduleNotificationAsync: (req: unknown) => {
      scheduled.push(req);
      return Promise.resolve('id');
    },
    onVibrate: () => {
      vibration += 1;
    },
    onAlert: (alert: unknown) => {
      alerts.push(alert);
    },
  };

  // 1. Initial fetch on cold start (isFirstLoad = true)
  const initialOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
  ];
  const initialResult = handleBrandNewOrderNotifications({
    ...helperParams,
    nextOrders: initialOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: true,
  });
  assert.equal(initialResult.brandNewOrder, null);
  assert.equal(scheduled.length, 0);
  assert.equal(vibration, 0);
  assert.equal(alerts.length, 0);

  // 2. Reconnect / duplicate fetch
  const reconnectResult = handleBrandNewOrderNotifications({
    ...helperParams,
    nextOrders: initialOrders,
    knownNewOrderIds: initialResult.nextKnownNewOrderIds,
    isFirstLoad: false,
  });
  assert.equal(reconnectResult.brandNewOrder, null);
  assert.equal(scheduled.length, 0);
  assert.equal(vibration, 0);
  assert.equal(alerts.length, 0);

  // 3. Status transition from 'new' -> 'preparing'
  const transitionedOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'preparing' }),
    createMockOrder({ id: 'ord-2', order_code: 'ORD-002', status: 'new' }),
  ];
  const transitionResult = handleBrandNewOrderNotifications({
    ...helperParams,
    nextOrders: transitionedOrders,
    knownNewOrderIds: reconnectResult.nextKnownNewOrderIds,
    isFirstLoad: false,
  });
  assert.equal(transitionResult.brandNewOrder, null);
  assert.equal(scheduled.length, 0);
  assert.equal(vibration, 0);
  assert.equal(alerts.length, 0);

  // 4. Shop switch: resetting known IDs and resetting isFirstLoad = true for new shop
  const newShopOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'shop2-ord-1', order_code: 'ORD-999', shop_id: 'shop-2', status: 'new' }),
  ];
  const shopSwitchResult = handleBrandNewOrderNotifications({
    ...helperParams,
    nextOrders: newShopOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: true,
  });
  assert.equal(shopSwitchResult.brandNewOrder, null);
  assert.equal(scheduled.length, 0);
  assert.equal(vibration, 0);
  assert.equal(alerts.length, 0);
});

test('handleBrandNewOrderNotifications: synchronously updates known order IDs and first-load state BEFORE scheduler executes', () => {
  const nextOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-brand-new', order_code: 'ORD-999', status: 'new' }),
  ];

  const executionSequence: string[] = [];
  let isKnownAtScheduleTime = false;
  let isFirstLoadAtScheduleTime = true;

  const state = {
    knownNewOrderIds: new Set<string>(['ord-1']),
    isFirstLoad: false,
  };

  const result = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: state.knownNewOrderIds,
    isFirstLoad: state.isFirstLoad,
    onAdvanceKnownOrderIds: (nextIds) => {
      executionSequence.push('advance_state');
      state.knownNewOrderIds = nextIds;
      state.isFirstLoad = false;
    },
    onAlert: () => {
      executionSequence.push('alert');
    },
    onVibrate: () => {
      executionSequence.push('vibrate');
    },
    scheduleNotificationAsync: (payload) => {
      executionSequence.push('schedule');
      isKnownAtScheduleTime = state.knownNewOrderIds.has(payload.content.data.orderId);
      isFirstLoadAtScheduleTime = state.isFirstLoad;
      return Promise.resolve('ok');
    },
  });

  // Function returns synchronously, not a Promise
  assert.equal(typeof (result as unknown as Promise<unknown>).then, 'undefined');
  assert.equal(result.brandNewOrder?.id, 'ord-brand-new');

  // Verify advance_state ran before schedule
  assert.ok(executionSequence.indexOf('advance_state') < executionSequence.indexOf('schedule'));
  assert.equal(isKnownAtScheduleTime, true);
  assert.equal(isFirstLoadAtScheduleTime, false);
});

test('handleBrandNewOrderNotifications: scheduling failure resilience (both synchronous throw and async rejection)', async () => {
  const nextOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-1', order_code: 'ORD-001', status: 'new' }),
    createMockOrder({ id: 'ord-brand-new', order_code: 'ORD-999', status: 'new' }),
  ];

  // 1. Synchronous throw from scheduler does NOT throw and does NOT break alert or dedupe
  let syncAlertCalled = false;
  let syncVibrateCalled = false;
  let syncAdvanceCalled = false;

  const syncResult = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: new Set<string>(['ord-1']),
    isFirstLoad: false,
    onAdvanceKnownOrderIds: () => {
      syncAdvanceCalled = true;
    },
    onAlert: () => {
      syncAlertCalled = true;
    },
    onVibrate: () => {
      syncVibrateCalled = true;
    },
    scheduleNotificationAsync: () => {
      throw new Error('Immediate native module crash');
    },
  });

  assert.equal(syncAdvanceCalled, true);
  assert.equal(syncAlertCalled, true);
  assert.equal(syncVibrateCalled, true);
  assert.equal(syncResult.brandNewOrder?.id, 'ord-brand-new');
  assert.equal(syncResult.scheduledNotification, null);
  // Claim released so a later remote push can still act as fallback
  assert.equal(isOrderNotificationRecorded('ord-brand-new'), false);

  // 2. Asynchronous Promise rejection does NOT crash or break dedupe
  let asyncAlertCalled = false;
  let asyncAdvanceCalled = false;

  const asyncResult = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: new Set<string>(['ord-1']),
    isFirstLoad: false,
    onAdvanceKnownOrderIds: () => {
      asyncAdvanceCalled = true;
    },
    onAlert: () => {
      asyncAlertCalled = true;
    },
    scheduleNotificationAsync: () => {
      return Promise.reject(new Error('Async push notification rejection'));
    },
  });

  assert.equal(asyncAdvanceCalled, true);
  assert.equal(asyncAlertCalled, true);
  assert.equal(asyncResult.brandNewOrder?.id, 'ord-brand-new');
  // Allow promise rejection microtasks to settle
  await new Promise((resolve) => setTimeout(resolve, 5));
  // Claim released so a later remote push can still act as fallback
  assert.equal(isOrderNotificationRecorded('ord-brand-new'), false);
});

test('handleBrandNewOrderNotifications: remote-first arrival keeps in-app alert and vibration but skips local notification chime', () => {
  // Remote push arrived first and recorded the order in registry
  recordOrderNotification('ord-remote-first');
  assert.equal(isOrderNotificationRecorded('ord-remote-first'), true);

  const nextOrders: MobileShopOrder[] = [
    createMockOrder({
      id: 'ord-remote-first',
      order_code: 'ORD-REMOTE-1',
      table_label: 'Bàn 2',
      total_amount: 150000,
      status: 'new',
    }),
  ];

  let alertDetails: { orderCode: string; tableLabel: string; totalAmount: number } | null = null;
  let vibrationCount = 0;
  let scheduleCount = 0;
  let advancedKnownIds = new Set<string>();

  const result = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: false,
    onAlert: (alert) => {
      alertDetails = alert;
    },
    onVibrate: () => {
      vibrationCount += 1;
    },
    scheduleNotificationAsync: () => {
      scheduleCount += 1;
      return Promise.resolve('notif-id');
    },
    onAdvanceKnownOrderIds: (ids) => {
      advancedKnownIds = ids;
    },
  });

  // Genuinely new order detected
  assert.notEqual(result.brandNewOrder, null);
  assert.equal(result.brandNewOrder?.id, 'ord-remote-first');

  // In-app alert is preserved
  assert.deepEqual(alertDetails, {
    orderCode: 'ORD-REMOTE-1',
    tableLabel: 'Bàn 2',
    totalAmount: 150000,
  });

  // Vibration is preserved
  assert.equal(vibrationCount, 1);

  // Local notification chime is skipped (no duplicate sound)
  assert.equal(scheduleCount, 0);
  assert.equal(result.scheduledNotification, null);

  // Dedupe state is preserved
  assert.equal(advancedKnownIds.has('ord-remote-first'), true);
  assert.equal(result.nextKnownNewOrderIds.has('ord-remote-first'), true);
});

test('handleBrandNewOrderNotifications: local-first arrival marks claim before scheduling and closes race with remote push', () => {
  const nextOrders: MobileShopOrder[] = [
    createMockOrder({
      id: 'ord-local-first',
      order_code: 'ORD-LOCAL-1',
      table_label: 'Bàn 9',
      status: 'new',
    }),
  ];

  let scheduleCalled = false;
  let claimedBeforeSchedule = false;

  const result = handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: false,
    scheduleNotificationAsync: () => {
      scheduleCalled = true;
      claimedBeforeSchedule = isOrderNotificationRecorded('ord-local-first');
      return Promise.resolve('notif-ok');
    },
  });

  assert.equal(scheduleCalled, true);
  assert.equal(claimedBeforeSchedule, true);
  assert.equal(result.scheduledNotification?.content.data.orderId, 'ord-local-first');
  assert.equal(isOrderNotificationRecorded('ord-local-first'), true);

  // Later remote push for ord-local-first is suppressed as duplicate
  const remotePush = {
    request: {
      content: {
        data: {
          type: 'new_qr_order',
          orderId: 'ord-local-first',
          orderCode: 'ORD-LOCAL-1',
          shopId: 'shop-1',
        },
      },
    },
  };
  const behavior = resolveForegroundNotificationBehavior(remotePush);
  assert.deepEqual(behavior, {
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
});

test('handleBrandNewOrderNotifications: failure in local chime releases claim so later remote push acts as fallback', () => {
  const nextOrders: MobileShopOrder[] = [
    createMockOrder({
      id: 'ord-fail-then-remote',
      order_code: 'ORD-FAIL-1',
      status: 'new',
    }),
  ];

  // Local chime scheduling fails synchronously
  handleBrandNewOrderNotifications({
    nextOrders,
    knownNewOrderIds: new Set<string>(),
    isFirstLoad: false,
    scheduleNotificationAsync: () => {
      throw new Error('Scheduler failed');
    },
  });

  // Claim must be released
  assert.equal(isOrderNotificationRecorded('ord-fail-then-remote'), false);

  // Later remote push arrives: shows normal foreground banner and sound as fallback
  const remotePush = {
    request: {
      content: {
        data: {
          type: 'new_qr_order',
          orderId: 'ord-fail-then-remote',
          orderCode: 'ORD-FAIL-1',
          shopId: 'shop-1',
        },
      },
    },
  };
  const behavior = resolveForegroundNotificationBehavior(remotePush);
  assert.deepEqual(behavior, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
});

test('useShopRealtimeOrders orchestration path: executes synchronously, updates refs immediately, and dedupes subsequent syncs', () => {
  // Simulates the exact state, ref wiring, and callbacks of useShopRealtimeOrders hook
  const knownNewOrderIdsRef = { current: new Set<string>() };
  const isFirstLoadRef = { current: true };
  let liveOrderAlertState: { orderCode: string; tableLabel: string; totalAmount: number } | null = null;
  const scheduledCalls: unknown[] = [];

  const hookNotify = (orders: MobileShopOrder[]) => {
    return handleBrandNewOrderNotifications({
      nextOrders: orders,
      knownNewOrderIds: knownNewOrderIdsRef.current,
      isFirstLoad: isFirstLoadRef.current,
      onAdvanceKnownOrderIds: (nextKnownNewOrderIds) => {
        knownNewOrderIdsRef.current = nextKnownNewOrderIds;
        isFirstLoadRef.current = false;
      },
      onAlert: (alert) => {
        liveOrderAlertState = alert;
      },
      scheduleNotificationAsync: (payload) => {
        scheduledCalls.push(payload);
        return Promise.resolve('scheduled-id');
      },
    });
  };

  // 1. Initial cold load (isFirstLoad = true): seeds IDs, no alert, no chime
  const initialOrders: MobileShopOrder[] = [
    createMockOrder({ id: 'ord-initial-1', order_code: 'ORD-101', status: 'new' }),
    createMockOrder({ id: 'ord-initial-2', order_code: 'ORD-102', status: 'new' }),
  ];
  const initialRes = hookNotify(initialOrders);
  assert.equal(initialRes.brandNewOrder, null);
  assert.equal(liveOrderAlertState, null);
  assert.equal(scheduledCalls.length, 0);
  assert.equal(isFirstLoadRef.current, false);
  assert.equal(knownNewOrderIdsRef.current.size, 2);

  // 2. Newly arrived order: triggers alert, schedules exactly one chime, updates known IDs synchronously
  const updatedOrders: MobileShopOrder[] = [
    ...initialOrders,
    createMockOrder({ id: 'ord-new-3', order_code: 'ORD-103', status: 'new', table_label: 'Bàn 3', total_amount: 95000 }),
  ];
  const newOrderRes = hookNotify(updatedOrders);
  assert.notEqual(newOrderRes.brandNewOrder, null);
  assert.equal(newOrderRes.brandNewOrder?.id, 'ord-new-3');
  assert.deepEqual(liveOrderAlertState, {
    orderCode: 'ORD-103',
    tableLabel: 'Bàn 3',
    totalAmount: 95000,
  });
  assert.equal(scheduledCalls.length, 1);
  assert.equal(knownNewOrderIdsRef.current.has('ord-new-3'), true);

  // 3. Subsequent sync/reconnect with same orders: deduped, no duplicate alert or chime
  const refetchRes = hookNotify(updatedOrders);
  assert.equal(refetchRes.brandNewOrder, null);
  assert.equal(scheduledCalls.length, 1); // still 1
});

test('useShopRealtimeOrders.ts delegates to handleBrandNewOrderNotifications without duplicating inline detection', () => {
  const hookSource = fs.readFileSync(
    path.join(__dirname, '../src/hooks/useShopRealtimeOrders.ts'),
    'utf8'
  );
  // Hook imports and uses the helper
  assert.match(hookSource, /handleBrandNewOrderNotifications/);
  // Hook does NOT duplicate inline detection logic
  assert.doesNotMatch(hookSource, /knownNewOrderIdsRef\.current\.has\(o\.id\)/);
  // Hook passes onAdvanceKnownOrderIds
  assert.match(hookSource, /onAdvanceKnownOrderIds/);
  // Hook does not await native scheduling
  assert.doesNotMatch(hookSource, /await\s+.*scheduleNotificationAsync/);
});
