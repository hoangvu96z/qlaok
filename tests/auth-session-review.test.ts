import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  revokeAndClearStoredAuthOwner,
} = await import('@/lib/auth-session');

test('owner logout revokes the server session before removing browser credentials', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  );
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const values = new Map<string, string>([
    ['qlaok_auth_owner_v1', JSON.stringify({ id: 'owner-test' })],
    ['qlaok_auth_token_v1', 'owner-session-token'],
    ['qlaok_active_shop_id', 'shop-test'],
    ['qlaok_admin_backup_v1', JSON.stringify({ id: 'admin-test' })],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  try {
    let calls = 0;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        assert.equal(String(input), '/api/auth');
        assert.equal(init?.method, 'POST');
        assert.equal(init?.credentials, 'same-origin');
        assert.equal(
          new Headers(init?.headers).get('authorization'),
          'Bearer owner-session-token'
        );
        assert.deepEqual(JSON.parse(String(init?.body)), {
          action: 'logout',
        });
        assert.equal(values.get('qlaok_auth_token_v1'), 'owner-session-token');
        return new Response(JSON.stringify({ success: false }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await assert.rejects(
      revokeAndClearStoredAuthOwner(),
      /OWNER_SESSION_REVOCATION_FAILED/
    );
    assert.equal(calls, 1);
    assert.equal(values.get('qlaok_auth_token_v1'), 'owner-session-token');
    assert.ok(values.has('qlaok_auth_owner_v1'));

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    await revokeAndClearStoredAuthOwner();
    assert.equal(values.size, 0);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', originalFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  }
});
