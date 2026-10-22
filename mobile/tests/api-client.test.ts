import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/lib/api-client.ts';
import {
  getSharedMobilePushRegistrationState,
  resetSharedMobilePushRegistrationState,
  unregisterPushOnLogout,
} from '../src/lib/push-notifications.ts';

for (const status of [401, 403, 409, 500]) {
  test(`HTTP ${status} rejects without replaying against production`, async () => {
    const calls: string[] = [];
    const api = createApiClient('http://dev:3000', async () => 'jwt', async (url, init) => {
      calls.push(String(url));
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer jwt');
      assert.equal(init?.method, 'PATCH');
      return Response.json({ error: 'denied' }, { status });
    });
    await assert.rejects(api('/api/orders', { method: 'PATCH' }), /denied/);
    assert.deepEqual(calls, ['http://dev:3000/api/orders']);
  });
}

test('network failure is not retried on another host', async () => {
  let calls = 0;
  const api = createApiClient('http://dev:3000', async () => 'jwt', async () => {
    calls++; throw new Error('offline');
  });
  await assert.rejects(api('/api/orders', { method: 'POST' }), /offline/);
  assert.equal(calls, 1);
});

test('logged-out requests do not reach the network', async () => {
  const api = createApiClient('http://dev:3000', async () => null, async () => {
    assert.fail('must not fetch');
  });
  await assert.rejects(api('/api/orders'), /đăng nhập/);
});

test('reads the current token each time and preserves headers/body/abort signal', async () => {
  let token = 'old';
  const abort = new AbortController();
  const api = createApiClient('http://dev:3000', async () => token, async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Bearer ${token}`);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(init?.body, '{}');
    assert.ok(init?.signal);
    assert.equal(init?.signal?.aborted, false);
    return Response.json({ order: { payment_status: 'paid' } });
  });
  const init = { method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: abort.signal };
  await api('/api/orders', init);
  token = 'refreshed';
  const result = await api('/api/orders', init);
  assert.equal((await result.json()).order.payment_status, 'paid');
});

test('non-JSON errors remain errors', async () => {
  const api = createApiClient('http://dev:3000', async () => 'jwt', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(api('/api/orders'), /503/);
});

test('forwards caller cancellation to the network request', async () => {
  const controller = new AbortController();
  const api = createApiClient('http://dev:3000', async () => 'jwt', async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new Error('aborted');
  });
  controller.abort();
  await assert.rejects(api('/api/orders', { signal: controller.signal }), /aborted/);
});

test('invokes onUnauthorized callback on HTTP 401 only', async () => {
  let signOutCount = 0;
  let nextStatus = 403;
  const api = createApiClient(
    'http://dev:3000',
    async () => 'jwt',
    async () => Response.json({ error: 'auth error' }, { status: nextStatus }),
    async () => {
      signOutCount++;
    }
  );
  await assert.rejects(api('/api/orders'), /auth error/);
  assert.equal(signOutCount, 0);

  nextStatus = 401;
  await assert.rejects(api('/api/orders'), /auth error/);
  assert.equal(signOutCount, 1);
});

test('HTTP 401 automatic sign-out attempts push token cleanup before clearing local session', async () => {
  resetSharedMobilePushRegistrationState();
  const sharedState = getSharedMobilePushRegistrationState();
  sharedState.expoPushToken = 'ExponentPushToken[auto401Cleanup]';
  sharedState.lastRegisteredScope =
    'user-1:shop-a:ExponentPushToken[auto401Cleanup]:vi';
  sharedState.registeredShopIds.add('shop-a');

  let activeToken: string | null = 'jwt-before-signout';
  const events: string[] = [];

  const api = createApiClient(
    'http://dev:3000',
    async () => activeToken,
    async (url, init) => {
      const urlStr = String(url);
      const method = (init?.method || 'GET').toUpperCase();
      const authHeader = new Headers(init?.headers).get('authorization');

      if (urlStr.endsWith('/api/orders')) {
        events.push(`orders:401:${authHeader}`);
        return Response.json({ error: 'session unauthorized' }, { status: 401 });
      }

      if (urlStr.endsWith('/api/push-tokens') && method === 'DELETE') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          expo_push_token?: string;
        };
        events.push(
          `pushDelete:ok:${authHeader}:${body.expo_push_token ?? 'none'}`
        );
        return Response.json({ success: true, deletedCount: 1 });
      }

      throw new Error(`Unexpected request: ${method} ${urlStr}`);
    },
    async ({ requestWithoutUnauthorizedHandler }) => {
      const res = await unregisterPushOnLogout({
        state: sharedState,
        apiCall: requestWithoutUnauthorizedHandler,
        signOut: async () => {
          events.push('signOut:local');
          activeToken = null;
        },
      });
      events.push(`cleanupResult:unregistered=${res.unregistered}`);
    }
  );

  await assert.rejects(api('/api/orders'), /session unauthorized/);

  assert.equal(activeToken, null);
  assert.equal(sharedState.expoPushToken, null);
  assert.equal(sharedState.lastRegisteredScope, '');
  assert.equal(sharedState.registeredShopIds.size, 0);
  assert.deepEqual(events, [
    'orders:401:Bearer jwt-before-signout',
    'pushDelete:ok:Bearer jwt-before-signout:ExponentPushToken[auto401Cleanup]',
    'signOut:local',
    'cleanupResult:unregistered=true',
  ]);
});

test('HTTP 401 when access token is invalid does not recurse on DELETE /api/push-tokens 401 and still clears local session', async () => {
  resetSharedMobilePushRegistrationState();
  const sharedState = getSharedMobilePushRegistrationState();
  sharedState.expoPushToken = 'ExponentPushToken[expiredJwt401]';
  sharedState.lastRegisteredScope =
    'user-1:shop-a:ExponentPushToken[expiredJwt401]:vi';
  sharedState.registeredShopIds.add('shop-a');

  let activeToken: string | null = 'expired-jwt';
  let unauthorizedCallbacks = 0;
  let signOutCalls = 0;
  const events: string[] = [];

  const api = createApiClient(
    'http://dev:3000',
    async () => activeToken,
    async (url, init) => {
      const urlStr = String(url);
      const method = (init?.method || 'GET').toUpperCase();
      const authHeader = new Headers(init?.headers).get('authorization');
      events.push(`${method}:${urlStr}:${authHeader}:401`);
      // Both the business endpoint and the authenticated push-token DELETE reject the expired token with 401
      return Response.json({ error: 'token expired' }, { status: 401 });
    },
    async ({ requestWithoutUnauthorizedHandler }) => {
      unauthorizedCallbacks++;
      const res = await unregisterPushOnLogout({
        state: sharedState,
        apiCall: requestWithoutUnauthorizedHandler,
        signOut: async () => {
          signOutCalls++;
          events.push('signOut:local');
          activeToken = null;
        },
      });
      events.push(`cleanupResult:unregistered=${res.unregistered}`);
    }
  );

  await assert.rejects(api('/api/orders'), /token expired/);

  assert.equal(unauthorizedCallbacks, 1);
  assert.equal(signOutCalls, 1);
  assert.equal(activeToken, null);
  assert.equal(sharedState.expoPushToken, null);
  assert.equal(sharedState.lastRegisteredScope, '');
  assert.equal(sharedState.registeredShopIds.size, 0);
  assert.deepEqual(events, [
    'GET:http://dev:3000/api/orders:Bearer expired-jwt:401',
    'DELETE:http://dev:3000/api/push-tokens:Bearer expired-jwt:401',
    'signOut:local',
    'cleanupResult:unregistered=false',
  ]);
});

test('explicit logout calling DELETE /api/push-tokens that returns 401 does not trigger recursive onUnauthorized', async () => {
  resetSharedMobilePushRegistrationState();
  const sharedState = getSharedMobilePushRegistrationState();
  sharedState.expoPushToken = 'ExponentPushToken[explicitLogout401]';

  let activeToken: string | null = 'expired-jwt';
  let onUnauthorizedCount = 0;
  let explicitSignOutCount = 0;

  const api = createApiClient(
    'http://dev:3000',
    async () => activeToken,
    async () => Response.json({ error: 'token expired' }, { status: 401 }),
    async () => {
      onUnauthorizedCount++;
    }
  );

  const result = await unregisterPushOnLogout({
    state: sharedState,
    apiCall: api,
    signOut: async () => {
      explicitSignOutCount++;
      activeToken = null;
    },
  });

  assert.equal(onUnauthorizedCount, 0);
  assert.equal(explicitSignOutCount, 1);
  assert.equal(result.unregistered, false);
  assert.equal(result.token, 'ExponentPushToken[explicitLogout401]');
  assert.equal(result.signOutError, null);
  assert.equal(activeToken, null);
});
