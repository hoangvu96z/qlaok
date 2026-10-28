import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireMobileExpoPushToken,
  buildLocalOrderChimeNotification,
  createMobilePushRegistrationState,
  extractNotificationData,
  extractNotificationTapRoute,
  getOrderNotificationRegistrySize,
  isLocalOrderChimeNotification,
  isNewOrderNotification,
  isOrderNotificationRecorded,
  LOCAL_ORDER_CHIME_TYPE,
  MOBILE_ORDERS_CHANNEL_ID,
  ORDER_NOTIFICATION_REGISTRY_MAX_SIZE,
  ORDER_NOTIFICATION_TTL_MS,
  recordOrderNotification,
  registerShopPushTokenWithApi,
  releaseOrderNotification,
  resetOrderNotificationRegistry,
  resolveConfiguredEasProjectId,
  resolveForegroundNotificationBehavior,
  resolveNotificationTapTargetShop,
  scheduleLocalOrderChime,
  syncMobilePushRegistration,
  unregisterPushOnLogout,
  unregisterPushTokenWithApi,
} from '../src/lib/push-notifications.ts';

test('resolveConfiguredEasProjectId rejects empty or placeholder IDs and returns valid projectId', () => {
  assert.equal(resolveConfiguredEasProjectId({}), null);
  assert.equal(
    resolveConfiguredEasProjectId({
      envProjectId: '   ',
      easConfigProjectId: 'your-eas-project-id',
      expoConfigExtraProjectId: '00000000-0000-0000-0000-000000000000',
    }),
    null
  );
  assert.equal(
    resolveConfiguredEasProjectId({
      envProjectId: '11111111-2222-3333-4444-555555555555',
    }),
    '11111111-2222-3333-4444-555555555555'
  );
  assert.equal(
    resolveConfiguredEasProjectId({
      envProjectId: '',
      easConfigProjectId: 'eas-project-uuid-123',
    }),
    'eas-project-uuid-123'
  );
});

test('acquireMobileExpoPushToken skips token request when projectId is missing or on web', async () => {
  let tokenRequested = false;
  const resultNoProject = await acquireMobileExpoPushToken(
    {
      platform: 'ios',
      getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      requestPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      getExpoPushTokenAsync: async () => {
        tokenRequested = true;
        return { data: 'ExponentPushToken[abc]' };
      },
    },
    ''
  );
  assert.equal(resultNoProject, null);
  assert.equal(tokenRequested, false);

  const resultWeb = await acquireMobileExpoPushToken(
    {
      platform: 'web',
      getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      requestPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      getExpoPushTokenAsync: async () => {
        tokenRequested = true;
        return { data: 'ExponentPushToken[abc]' };
      },
    },
    'valid-project-id-123'
  );
  assert.equal(resultWeb, null);
  assert.equal(tokenRequested, false);
});

test('acquireMobileExpoPushToken configures Android channel, requests permission when needed, and returns Expo token', async () => {
  const channels: Array<{ id: string; sound: string }> = [];
  let requestedPerm = false;
  let passedProjectId = '';

  const token = await acquireMobileExpoPushToken(
    {
      platform: 'android',
      setNotificationChannelAsync: async (id, cfg) => {
        channels.push({ id, sound: cfg.sound });
      },
      getPermissionsAsync: async () => ({ status: 'undetermined', granted: false }),
      requestPermissionsAsync: async () => {
        requestedPerm = true;
        return { status: 'granted', granted: true };
      },
      getExpoPushTokenAsync: async ({ projectId }) => {
        passedProjectId = projectId;
        return { data: 'ExponentPushToken[androidToken999]' };
      },
    },
    'eas-proj-999'
  );

  assert.equal(token, 'ExponentPushToken[androidToken999]');
  assert.equal(requestedPerm, true);
  assert.equal(passedProjectId, 'eas-proj-999');
  assert.deepEqual(channels, [
    { id: MOBILE_ORDERS_CHANNEL_ID, sound: 'default' },
  ]);
});

test('registerShopPushTokenWithApi and unregisterPushTokenWithApi send expected payloads', async () => {
  const calls: Array<{ path: string; method?: string; body: Record<string, unknown> }> = [];
  const fakeApi = async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method,
      body: JSON.parse(String(init?.body || '{}')),
    });
    return Response.json({ success: true });
  };

  await registerShopPushTokenWithApi(fakeApi, {
    shopId: 'shop-fnb-001',
    expoPushToken: 'ExponentPushToken[xyz]',
    locale: 'vi',
    platform: 'ios',
  });

  await unregisterPushTokenWithApi(fakeApi, {
    expoPushToken: 'ExponentPushToken[xyz]',
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    path: '/api/push-tokens',
    method: 'POST',
    body: {
      shop_id: 'shop-fnb-001',
      expo_push_token: 'ExponentPushToken[xyz]',
      locale: 'vi',
      platform: 'ios',
    },
  });
  assert.deepEqual(calls[1], {
    path: '/api/push-tokens',
    method: 'DELETE',
    body: {
      expo_push_token: 'ExponentPushToken[xyz]',
    },
  });
});

test('extractNotificationTapRoute parses notification response payload into target shop Orders tab', () => {
  assert.equal(extractNotificationTapRoute(null), null);
  assert.equal(extractNotificationTapRoute({}), null);

  const route = extractNotificationTapRoute({
    notification: {
      request: {
        content: {
          data: {
            type: 'new_qr_order',
            shopId: 'shop-service-001',
            orderId: 'ord-555',
            orderCode: 'ORD-555',
            tab: 'orders',
          },
        },
      },
    },
  });

  assert.deepEqual(route, {
    shopId: 'shop-service-001',
    orderId: 'ord-555',
    orderCode: 'ORD-555',
    tab: 'orders',
  });
});

test('syncMobilePushRegistration retries after failed registration and unregisterPushOnLogout unregisters BEFORE clearing auth credentials', async () => {
  const state = createMobilePushRegistrationState();
  let tokenAcquisitions = 0;
  let shouldFailPost = true;
  let hasActiveSession = true;
  const events: string[] = [];

  const adapter = {
    platform: 'ios',
    getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
    requestPermissionsAsync: async () => ({ status: 'granted', granted: true }),
    getExpoPushTokenAsync: async () => {
      tokenAcquisitions += 1;
      return { data: 'ExponentPushToken[retryAndLogoutToken]' };
    },
  };

  const authenticatedApi = async (path: string, init?: RequestInit) => {
    if (!hasActiveSession) {
      throw new Error('Vui lòng đăng nhập lại');
    }
    const method = init?.method || 'GET';
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, string>;
    if (method === 'POST' && shouldFailPost) {
      events.push(`POST:fail:${body.shop_id}`);
      throw new Error('Transient network failure');
    }
    events.push(`${method}:ok:${body.shop_id || body.expo_push_token || ''}`);
    return Response.json({ success: true });
  };

  // 1. First registration attempt fails on network error -> must not mark scope as registered
  await assert.rejects(
    syncMobilePushRegistration({
      state,
      isLoggedIn: true,
      userId: 'user-1',
      activeShopId: 'shop-a',
      canViewOrders: true,
      locale: 'vi',
      projectId: 'eas-project-123',
      adapter,
      apiCall: authenticatedApi,
    }),
    /Transient network failure/
  );
  assert.equal(state.expoPushToken, 'ExponentPushToken[retryAndLogoutToken]');
  assert.equal(state.lastRegisteredScope, '');
  assert.equal(tokenAcquisitions, 1);

  // 2. Retry succeeds for the same scope without re-acquiring device token
  shouldFailPost = false;
  const retryResult = await syncMobilePushRegistration({
    state,
    isLoggedIn: true,
    userId: 'user-1',
    activeShopId: 'shop-a',
    canViewOrders: true,
    locale: 'vi',
    projectId: 'eas-project-123',
    adapter,
    apiCall: authenticatedApi,
  });
  assert.equal(retryResult.registered, true);
  assert.equal(tokenAcquisitions, 1);
  assert.equal(
    state.lastRegisteredScope,
    'user-1:shop-a:ExponentPushToken[retryAndLogoutToken]:vi'
  );

  // 3. Subsequent sync with unchanged scope is a no-op
  const duplicateSync = await syncMobilePushRegistration({
    state,
    isLoggedIn: true,
    userId: 'user-1',
    activeShopId: 'shop-a',
    canViewOrders: true,
    locale: 'vi',
    projectId: 'eas-project-123',
    adapter,
    apiCall: authenticatedApi,
  });
  assert.equal(duplicateSync.registered, false);
  assert.equal(duplicateSync.skipped, true);

  // 4. Logout unregisters token via authenticated API BEFORE signOut clears auth session
  const logoutResult = await unregisterPushOnLogout({
    state,
    apiCall: authenticatedApi,
    signOut: async () => {
      events.push('signOut:clearSession');
      hasActiveSession = false;
    },
  });

  assert.equal(logoutResult.unregistered, true);
  assert.equal(logoutResult.token, 'ExponentPushToken[retryAndLogoutToken]');
  assert.equal(logoutResult.signOutError, null);
  assert.equal(state.expoPushToken, null);
  assert.equal(state.lastRegisteredScope, '');
  assert.deepEqual(events, [
    'POST:fail:shop-a',
    'POST:ok:shop-a',
    'DELETE:ok:ExponentPushToken[retryAndLogoutToken]',
    'signOut:clearSession',
  ]);
});

test('unregisterPushOnLogout attempts cleanup before signOut and keeps push state when DELETE fails with 401', async () => {
  const state = createMobilePushRegistrationState();
  state.expoPushToken = 'ExponentPushToken[invalidAccess401]';
  state.lastRegisteredScope =
    'user-1:shop-a:ExponentPushToken[invalidAccess401]:vi';
  state.registeredShopIds.add('shop-a');

  let hasLocalSession = true;
  const events: string[] = [];

  const failingAuthApi = async (path: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    // Cleanup must be attempted while local session is still present (before signOut)
    events.push(`${method}:${path}:session=${hasLocalSession}`);
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await unregisterPushOnLogout({
    state,
    apiCall: failingAuthApi,
    signOut: async () => {
      events.push('signOut:clearLocalSession');
      hasLocalSession = false;
    },
  });

  assert.equal(result.unregistered, false);
  assert.equal(result.token, 'ExponentPushToken[invalidAccess401]');
  assert.equal(result.signOutError, null);
  assert.equal(hasLocalSession, false);
  assert.equal(state.expoPushToken, 'ExponentPushToken[invalidAccess401]');
  assert.equal(
    state.lastRegisteredScope,
    'user-1:shop-a:ExponentPushToken[invalidAccess401]:vi'
  );
  assert.equal(state.registeredShopIds.has('shop-a'), true);
  assert.deepEqual(events, [
    'DELETE:/api/push-tokens:session=true',
    'signOut:clearLocalSession',
  ]);
});

test('resolveNotificationTapTargetShop never falls back to another shop when target shop is unavailable or unauthorized', () => {
  const shops = [
    { id: 'shop-fallback-a', owner_id: 'owner-1', name: 'Shop A' },
    { id: 'shop-target-b', owner_id: 'owner-2', name: 'Shop B' },
  ];

  // 1. Target shop is missing from user's available shops -> must fail with shop_unavailable, never returning shops[0]
  const missingShopRes = resolveNotificationTapTargetShop({
    route: {
      shopId: 'shop-removed-c',
      orderId: 'ord-999',
      tab: 'orders',
    },
    shops,
    memberships: {},
    userId: 'owner-1',
  });
  assert.deepEqual(missingShopRes, {
    ok: false,
    shop: null,
    reason: 'shop_unavailable',
  });

  // 2. Target shop exists in list, but user's membership lacks orders.view -> must fail with permission_denied
  const noPermRes = resolveNotificationTapTargetShop({
    route: {
      shopId: 'shop-target-b',
      orderId: 'ord-777',
      tab: 'orders',
    },
    shops,
    memberships: {
      'shop-target-b': {
        shop_id: 'shop-target-b',
        is_active: true,
        permissions: ['catalog.view'],
      },
    },
    userId: 'staff-no-orders',
  });
  assert.deepEqual(noPermRes, {
    ok: false,
    shop: null,
    reason: 'permission_denied',
  });

  // 3. Target shop exists and user has active orders.view membership -> resolves exact target shop
  const validRes = resolveNotificationTapTargetShop({
    route: {
      shopId: 'shop-target-b',
      orderId: 'ord-777',
      orderCode: 'ORD-777',
      tab: 'orders',
    },
    shops,
    memberships: {
      'shop-target-b': {
        shop_id: 'shop-target-b',
        is_active: true,
        permissions: ['orders.view'],
      },
    },
    userId: 'staff-with-orders',
  });
  assert.deepEqual(validRes, {
    ok: true,
    shop: shops[1],
    tab: 'orders',
    orderId: 'ord-777',
    orderCode: 'ORD-777',
  });
});

test('isNewOrderNotification identifies new customer order push payloads and rejects non-order payloads', () => {
  // Standard Expo push notification with request.content.data
  const orderNotification = {
    request: {
      content: {
        title: '🔔 Đơn hàng mới #ORD-101 • Bàn 5',
        body: 'Tổng đơn: 150.000đ',
        data: {
          type: 'new_qr_order',
          shopId: 'shop-123',
          orderId: 'order-xyz',
          orderCode: 'ORD-101',
          tableLabel: 'Bàn 5',
          tab: 'orders',
        },
      },
    },
  };
  assert.equal(isNewOrderNotification(orderNotification), true);

  // Top-level data fallback
  const topLevelDataNotification = {
    data: {
      type: 'new_qr_order',
      shopId: 'shop-123',
    },
  };
  assert.equal(isNewOrderNotification(topLevelDataNotification), true);

  // Table service request push (non-order)
  const serviceRequestNotification = {
    request: {
      content: {
        title: '🔔 Khách gọi phục vụ • Bàn 2',
        body: 'Bàn 2 đang gọi nhân viên hỗ trợ tại bàn.',
        data: {
          type: 'table_service_request',
          shopId: 'shop-123',
          serviceRequestId: 'req-456',
          tableId: 'tbl-2',
          tableLabel: 'Bàn 2',
          requestType: 'call_staff',
        },
      },
    },
  };
  assert.equal(isNewOrderNotification(serviceRequestNotification), false);

  // Bill request push (non-order)
  const billRequestNotification = {
    request: {
      content: {
        title: '🧾 Khách xin hóa đơn • Bàn 3',
        body: 'Bàn 3 yêu cầu kiểm tra hóa đơn.',
        data: {
          type: 'table_service_request',
          shopId: 'shop-123',
          serviceRequestId: 'req-789',
          tableId: 'tbl-3',
          tableLabel: 'Bàn 3',
          requestType: 'request_bill',
        },
      },
    },
  };
  assert.equal(isNewOrderNotification(billRequestNotification), false);

  // Promotional or generic push (non-order)
  const promoNotification = {
    request: {
      content: {
        title: 'Khuyến mãi đặc biệt',
        data: {
          type: 'promotional_announcement',
          promoId: 'promo-1',
        },
      },
    },
  };
  assert.equal(isNewOrderNotification(promoNotification), false);

  // Missing data, empty data, or invalid types
  assert.equal(isNewOrderNotification({ request: { content: {} } }), false);
  assert.equal(isNewOrderNotification({}), false);
  assert.equal(isNewOrderNotification(null), false);
  assert.equal(isNewOrderNotification(undefined), false);
  assert.equal(isNewOrderNotification('not-an-object'), false);
});

test('isLocalOrderChimeNotification identifies local order chime payloads and rejects remote pushes or non-order payloads', () => {
  // Nested request.content.data
  const nestedLocalChime = {
    request: {
      content: {
        title: '🔔 Đơn hàng mới',
        data: {
          type: LOCAL_ORDER_CHIME_TYPE,
          orderId: 'ord-1',
          orderCode: 'ORD-101',
        },
      },
    },
  };
  assert.equal(isLocalOrderChimeNotification(nestedLocalChime), true);

  // Top-level data fallback
  const topLevelLocalChime = {
    data: {
      type: LOCAL_ORDER_CHIME_TYPE,
      orderId: 'ord-2',
    },
  };
  assert.equal(isLocalOrderChimeNotification(topLevelLocalChime), true);

  // Remote new order push payload (not a local chime)
  const remotePush = {
    data: {
      type: 'new_qr_order',
      orderId: 'ord-3',
    },
  };
  assert.equal(isLocalOrderChimeNotification(remotePush), false);

  // Table service request (not a local chime)
  const serviceRequest = {
    data: {
      type: 'table_service_request',
      serviceRequestId: 'req-1',
    },
  };
  assert.equal(isLocalOrderChimeNotification(serviceRequest), false);

  // Missing data, empty data, or invalid types
  assert.equal(isLocalOrderChimeNotification({ request: { content: {} } }), false);
  assert.equal(isLocalOrderChimeNotification({}), false);
  assert.equal(isLocalOrderChimeNotification(null), false);
  assert.equal(isLocalOrderChimeNotification(undefined), false);
  assert.equal(isLocalOrderChimeNotification('not-an-object'), false);
});

test('resolveForegroundNotificationBehavior handles local-first, remote-first, repeated remote pushes, different orders, missing orderId, local chime, and baseline', () => {
  resetOrderNotificationRegistry();

  // Helper to create remote order push notification payload
  const createRemotePush = (orderId?: string | null, orderCode = 'ORD-001') => ({
    request: {
      content: {
        title: `🔔 Đơn hàng mới #${orderCode} • Bàn 1`,
        body: 'Tổng đơn: 250.000đ',
        sound: 'default',
        data: {
          type: 'new_qr_order',
          shopId: 'shop-1',
          ...(orderId !== undefined ? { orderId } : {}),
          orderCode,
          tableLabel: 'Bàn 1',
          tab: 'orders',
        },
      },
    },
  });

  // Helper to create local order chime payload
  const createLocalChime = (orderId: string, orderCode = 'ORD-001') => ({
    request: {
      content: {
        title: '🔔 Đơn hàng mới',
        body: `Mã đơn #${orderCode} • Bàn 1`,
        sound: 'default',
        data: {
          type: LOCAL_ORDER_CHIME_TYPE,
          orderId,
          orderCode,
          shopId: 'shop-1',
        },
      },
    },
  });

  // A) Local chime arrives first:
  // 1. Local chime is presented: hidden banner, audible sound
  const chimeBehavior = resolveForegroundNotificationBehavior(createLocalChime('ord-A', 'ORD-A'));
  assert.deepEqual(chimeBehavior, {
    shouldShowAlert: false,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  // 2. Later remote push for same ord-A is hidden and silent (duplicate suppressed)
  const remoteAfterChime = resolveForegroundNotificationBehavior(createRemotePush('ord-A', 'ORD-A'));
  assert.deepEqual(remoteAfterChime, {
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });

  // B) Remote push arrives first (fallback):
  // 1. First remote push for ord-B shows normal foreground banner and sound as fallback
  const firstRemoteB = resolveForegroundNotificationBehavior(createRemotePush('ord-B', 'ORD-B'));
  assert.deepEqual(firstRemoteB, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  // 2. Repeated remote push for same ord-B is suppressed (hidden and silent)
  const secondRemoteB = resolveForegroundNotificationBehavior(createRemotePush('ord-B', 'ORD-B'));
  assert.deepEqual(secondRemoteB, {
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });

  // C) Different / unseen order IDs:
  // Remote push for unseen ord-C remains visible and audible; no blanket suppression
  const remoteC = resolveForegroundNotificationBehavior(createRemotePush('ord-C', 'ORD-C'));
  assert.deepEqual(remoteC, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  // Missing or whitespace-only orderId preserves normal foreground notification behavior
  const missingOrderIdPush = resolveForegroundNotificationBehavior(createRemotePush(undefined, 'ORD-NO-ID'));
  assert.deepEqual(missingOrderIdPush, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  const emptyOrderIdPush = resolveForegroundNotificationBehavior(createRemotePush('   ', 'ORD-EMPTY'));
  assert.deepEqual(emptyOrderIdPush, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  // D) Non-order baseline notifications:
  // Service request notification preserves banner and sound
  const serviceNotification = {
    request: {
      content: {
        title: '🔔 Khách gọi phục vụ',
        data: {
          type: 'table_service_request',
          shopId: 'shop-1',
          serviceRequestId: 'req-1',
        },
      },
    },
  };
  const serviceBehavior = resolveForegroundNotificationBehavior(serviceNotification);
  assert.deepEqual(serviceBehavior, {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  // Unknown, empty, null, undefined notification payloads preserve baseline banner and sound
  assert.deepEqual(resolveForegroundNotificationBehavior({}), {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  assert.deepEqual(resolveForegroundNotificationBehavior(null), {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  assert.deepEqual(resolveForegroundNotificationBehavior(undefined), {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
});

test('order notification registry supports bounded capacity and TTL expiration', () => {
  resetOrderNotificationRegistry();

  const now = 1000000;
  const ttlMs = 5 * 60 * 1000; // 5 minutes

  // Record order at time 'now'
  assert.equal(recordOrderNotification('ord-ttl-1', { now, ttlMs }), true);
  assert.equal(isOrderNotificationRecorded('ord-ttl-1', { now, ttlMs }), true);

  // Still valid after 4 minutes (now + 240_000)
  assert.equal(isOrderNotificationRecorded('ord-ttl-1', { now: now + 240_000, ttlMs }), true);

  // Expired after 5 minutes + 1ms (now + 300_001)
  assert.equal(isOrderNotificationRecorded('ord-ttl-1', { now: now + 300_001, ttlMs }), false);

  // After expiration, resolveForegroundNotificationBehavior treats it as new fallback
  const remotePush = {
    request: {
      content: {
        data: { type: 'new_qr_order', orderId: 'ord-ttl-1' },
      },
    },
  };
  // First seen at now -> fallback
  assert.deepEqual(resolveForegroundNotificationBehavior(remotePush, { now, ttlMs }), {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });
  // Seen again within TTL -> suppressed
  assert.deepEqual(resolveForegroundNotificationBehavior(remotePush, { now: now + 60_000, ttlMs }), {
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
  // Seen after TTL -> acts as fallback again
  assert.deepEqual(resolveForegroundNotificationBehavior(remotePush, { now: now + 300_001, ttlMs }), {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  });

  // Bounded size eviction
  resetOrderNotificationRegistry();
  const maxSize = 3;
  recordOrderNotification('order-1', { now, maxSize });
  recordOrderNotification('order-2', { now, maxSize });
  recordOrderNotification('order-3', { now, maxSize });
  assert.equal(getOrderNotificationRegistrySize(), 3);

  // Adding 4th order evicts oldest (order-1)
  recordOrderNotification('order-4', { now, maxSize });
  assert.equal(getOrderNotificationRegistrySize(), 3);
  assert.equal(isOrderNotificationRecorded('order-1', { now }), false);
  assert.equal(isOrderNotificationRecorded('order-2', { now }), true);
  assert.equal(isOrderNotificationRecorded('order-3', { now }), true);
  assert.equal(isOrderNotificationRecorded('order-4', { now }), true);

  // Releasing order
  releaseOrderNotification('order-2');
  assert.equal(isOrderNotificationRecorded('order-2', { now }), false);
  assert.equal(getOrderNotificationRegistrySize(), 2);
});

test('buildLocalOrderChimeNotification and scheduleLocalOrderChime adhere to Expo SDK 52 contract', async () => {
  resetOrderNotificationRegistry();
  const order = {
    id: 'ord-100',
    order_code: 'ORD-100',
    table_label: 'Bàn 5',
    shop_id: 'shop-abc',
  };

  const payload = buildLocalOrderChimeNotification(order);
  assert.equal(payload.content.sound, 'default');
  assert.equal(payload.content.data.type, LOCAL_ORDER_CHIME_TYPE);
  assert.equal(payload.content.data.orderId, 'ord-100');
  assert.equal(payload.content.data.orderCode, 'ORD-100');
  assert.equal(payload.content.data.shopId, 'shop-abc');
  assert.deepEqual(payload.trigger, { channelId: MOBILE_ORDERS_CHANNEL_ID });

  const scheduledCalls: unknown[] = [];
  const success = await scheduleLocalOrderChime(order, {
    scheduleNotificationAsync: async (req) => {
      scheduledCalls.push(req);
      return 'notif-scheduled-id';
    },
  });
  assert.equal(success, true);
  assert.equal(scheduledCalls.length, 1);
  assert.deepEqual(scheduledCalls[0], payload);
  // Claim is recorded when scheduleLocalOrderChime succeeds
  assert.equal(isOrderNotificationRecorded('ord-100'), true);

  // Gracefully handles scheduling errors without throwing and releases claim
  const failed = await scheduleLocalOrderChime(order, {
    scheduleNotificationAsync: async () => {
      throw new Error('Native scheduler unavailable');
    },
  });
  assert.equal(failed, false);
  // Claim is released when scheduling throws
  assert.equal(isOrderNotificationRecorded('ord-100'), false);
});
