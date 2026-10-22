import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquireMobileExpoPushToken,
  createMobilePushRegistrationState,
  extractNotificationTapRoute,
  MOBILE_ORDERS_CHANNEL_ID,
  registerShopPushTokenWithApi,
  resolveConfiguredEasProjectId,
  resolveNotificationTapTargetShop,
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

test('unregisterPushOnLogout attempts cleanup before signOut and still clears local session when DELETE fails with 401', async () => {
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
  assert.equal(state.expoPushToken, null);
  assert.equal(state.lastRegisteredScope, '');
  assert.equal(state.registeredShopIds.size, 0);
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
