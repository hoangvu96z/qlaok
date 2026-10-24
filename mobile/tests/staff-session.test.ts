import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../src/lib/api-client.ts';
import {
  clearStaffSession,
  configureStaffSessionStorage,
  createExpoSecureStoreAdapter,
  createInMemoryStaffSessionStorage,
  deserializeStaffSession,
  getStaffAccessToken,
  loadStaffSession,
  loginStaff,
  type MobileStaffSession,
  parseStaffLoginResponse,
  resetStaffSessionMemoryForTest,
  saveStaffSession,
  STAFF_SESSION_REVOKED_CODE,
  STAFF_SESSION_STORAGE_KEY,
  StaffAuthError,
  validateStaffSession,
} from '../src/lib/staff-session.ts';
import {
  createStaffApiClient,
  StaffApiError,
  staffApi,
} from '../src/lib/staff-api.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createValidStaffLoginResponsePayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    user: {
      id: 'staff-acct-11111111-2222-4333-8444-555555555555',
      email: '',
      username: 'thu_ngan_ca_sang',
      shop_id: 'shop-pho-1',
      account_type: 'staff',
      full_name: 'Thu Ngân Ca Sáng',
      plan: 'free',
      role: 'cashier',
    },
    shops: [],
    memberShops: [
      {
        id: 'shop-pho-1',
        owner_id: 'owner-1',
        slug: 'pho-hoi-an',
        name: 'Phở Hội An',
        vertical: 'fnb',
        city: 'Đà Nẵng',
        supported_langs: ['vi', 'en'],
        is_published: true,
        wifi_info: {
          ssid: 'PhoHoiAn_Guest',
          password: 'wifi-secret-should-not-persist',
        },
      },
    ],
    memberships: [
      {
        id: 'mem-staff-1',
        shop_id: 'shop-pho-1',
        user_id: 'staff-acct-11111111-2222-4333-8444-555555555555',
        username: 'thu_ngan_ca_sang',
        account_type: 'staff',
        full_name: 'Thu Ngân Ca Sáng',
        role: 'cashier',
        permissions: [
          'orders.view',
          'orders.create',
          'orders.fulfill',
          'payment.collect',
        ],
        is_active: true,
        created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T00:00:00.000Z',
      },
    ],
    activeShopId: 'shop-pho-1',
    redirectTo: '/dashboard/orders',
    isAdmin: false,
    accessToken: 'qlaok-signed-hmac-token.payload.signature',
    ...overrides,
  };
}

test.beforeEach(() => {
  resetStaffSessionMemoryForTest();
});

test('loginStaff calls POST ${baseUrl}/api/auth with no Authorization header, trims shopIdentifier/username, and preserves password bytes verbatim', async () => {
  const storage = createInMemoryStaffSessionStorage();
  const capturedRequests: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: Record<string, unknown>;
  }> = [];

  const exactPassword = '  P@ssw0rd With Spaces & Unicode Việt! \t ';

  const session = await loginStaff({
    baseUrl: 'http://dev:3000/',
    shopIdentifier: '  /s/pho-hoi-an  ',
    username: '  Thu_Ngan_Ca_Sang  ',
    password: exactPassword,
    storage,
    fetchRequest: async (input, init) => {
      const headers = new Headers(init?.headers);
      capturedRequests.push({
        url: String(input),
        method: String(init?.method || 'GET'),
        headers,
        body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
      });
      return Response.json(createValidStaffLoginResponsePayload(), {
        status: 200,
      });
    },
  });

  assert.equal(capturedRequests.length, 1);
  const req = capturedRequests[0];
  assert.equal(req.url, 'http://dev:3000/api/auth');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.get('authorization'), null);
  assert.equal(req.headers.has('authorization'), false);
  assert.equal(req.headers.get('content-type'), 'application/json');
  assert.deepEqual(req.body, {
    action: 'staff_login',
    shopIdentifier: '/s/pho-hoi-an',
    username: 'Thu_Ngan_Ca_Sang',
    password: exactPassword,
  });

  // Valid login response persists to storage
  assert.equal(
    session.accessToken,
    'qlaok-signed-hmac-token.payload.signature'
  );
  assert.equal(session.activeShopId, 'shop-pho-1');
  assert.equal(session.shop.id, 'shop-pho-1');
  assert.equal(session.user.username, 'thu_ngan_ca_sang');
  assert.equal(session.membership.role, 'cashier');

  const persisted = await loadStaffSession(storage);
  assert.deepEqual(persisted, session);

  // Raw stored JSON must never contain the staff password or wifi password
  const rawStoredJson = storage.snapshot()[STAFF_SESSION_STORAGE_KEY];
  assert.ok(rawStoredJson);
  assert.equal(rawStoredJson.includes(exactPassword), false);
  assert.equal(rawStoredJson.includes('wifi-secret-should-not-persist'), false);
  assert.equal(
    'password' in ((persisted?.user ?? {}) as unknown as Record<string, unknown>),
    false
  );
});

test('loginStaff preserves server generic 401 and 429 rate-limit errors without storing a session or leaking secrets', async () => {
  const storage = createInMemoryStaffSessionStorage();
  const secretPassword = 'top-secret-staff-password-999';

  // 1. Generic 401 INVALID_STAFF_CREDENTIALS
  await assert.rejects(
    loginStaff({
      baseUrl: 'http://dev:3000',
      shopIdentifier: 'pho-hoi-an',
      username: 'thu_ngan',
      password: secretPassword,
      storage,
      fetchRequest: async () =>
        Response.json(
          {
            error:
              'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không chính xác.',
            code: 'INVALID_STAFF_CREDENTIALS',
          },
          { status: 401 }
        ),
    }),
    (err: unknown) => {
      assert.ok(err instanceof StaffAuthError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'INVALID_STAFF_CREDENTIALS');
      assert.match(err.message, /không chính xác/);
      assert.equal(err.message.includes(secretPassword), false);
      return true;
    }
  );
  assert.equal(await loadStaffSession(storage), null);
  assert.deepEqual(storage.snapshot(), {});

  // 2. 429 STAFF_LOGIN_RATE_LIMITED with Retry-After header and retryAfterSec
  await assert.rejects(
    loginStaff({
      baseUrl: 'http://dev:3000',
      shopIdentifier: 'pho-hoi-an',
      username: 'thu_ngan',
      password: secretPassword,
      storage,
      fetchRequest: async () =>
        Response.json(
          {
            error:
              'Quá nhiều lần đăng nhập nhân viên thất bại. Vui lòng thử lại sau ít phút.',
            code: 'STAFF_LOGIN_RATE_LIMITED',
            retryAfterSec: 900,
          },
          {
            status: 429,
            headers: { 'Retry-After': '900' },
          }
        ),
    }),
    (err: unknown) => {
      assert.ok(err instanceof StaffAuthError);
      assert.equal(err.status, 429);
      assert.equal(err.code, 'STAFF_LOGIN_RATE_LIMITED');
      assert.equal(err.retryAfterSec, 900);
      assert.match(err.message, /Quá nhiều lần đăng nhập nhân viên thất bại/);
      assert.equal(err.message.includes(secretPassword), false);
      return true;
    }
  );
  assert.equal(await loadStaffSession(storage), null);
  assert.deepEqual(storage.snapshot(), {});
});

test('loginStaff and parseStaffLoginResponse reject malformed success responses and never persist them', async () => {
  const basePayload = createValidStaffLoginResponsePayload();

  const malformedPayloads: Array<{ name: string; payload: unknown }> = [
    {
      name: 'missing accessToken',
      payload: { ...basePayload, accessToken: '   ' },
    },
    {
      name: 'whitespace in accessToken',
      payload: { ...basePayload, accessToken: 'bad token with spaces' },
    },
    {
      name: 'empty memberShops array',
      payload: { ...basePayload, memberShops: [] },
    },
    {
      name: 'multiple memberShops (not single-shop bound)',
      payload: {
        ...basePayload,
        memberShops: [basePayload.memberShops[0], { ...basePayload.memberShops[0], id: 'shop-2' }],
      },
    },
    {
      name: 'activeShopId mismatch with shop.id',
      payload: { ...basePayload, activeShopId: 'shop-other' },
    },
    {
      name: 'membership shop_id mismatch with shop.id',
      payload: {
        ...basePayload,
        memberships: [{ ...basePayload.memberships[0], shop_id: 'shop-other' }],
      },
    },
    {
      name: 'membership user_id mismatch with user.id',
      payload: {
        ...basePayload,
        memberships: [{ ...basePayload.memberships[0], user_id: 'staff-acct-other' }],
      },
    },
    {
      name: 'inactive membership (is_active: false)',
      payload: {
        ...basePayload,
        memberships: [{ ...basePayload.memberships[0], is_active: false }],
      },
    },
    {
      name: 'owner role in staff response',
      payload: {
        ...basePayload,
        user: { ...basePayload.user, role: 'owner' },
        memberships: [{ ...basePayload.memberships[0], role: 'owner' }],
      },
    },
    {
      name: 'role mismatch between user and membership',
      payload: {
        ...basePayload,
        user: { ...basePayload.user, role: 'staff' },
        memberships: [{ ...basePayload.memberships[0], role: 'cashier' }],
      },
    },
    {
      name: 'owner-only members.manage permission on staff membership',
      payload: {
        ...basePayload,
        memberships: [
          {
            ...basePayload.memberships[0],
            permissions: ['orders.view', 'members.manage'],
          },
        ],
      },
    },
    {
      name: 'password field leaked in user payload',
      payload: {
        ...basePayload,
        user: { ...basePayload.user, password: 'leaked-password' },
      },
    },
    {
      name: 'non-empty owner shops array in staff login response',
      payload: {
        ...basePayload,
        shops: [basePayload.memberShops[0]],
      },
    },
  ];

  for (const { name, payload } of malformedPayloads) {
    const storage = createInMemoryStaffSessionStorage();
    assert.throws(
      () => parseStaffLoginResponse(payload),
      (err: unknown) =>
        err instanceof StaffAuthError &&
        err.code === 'INVALID_STAFF_SESSION_RESPONSE',
      `Expected parseStaffLoginResponse to reject: ${name}`
    );

    await assert.rejects(
      loginStaff({
        baseUrl: 'http://dev:3000',
        shopIdentifier: 'pho-hoi-an',
        username: 'thu_ngan_ca_sang',
        password: 'validPassword123',
        storage,
        fetchRequest: async () => Response.json(payload, { status: 200 }),
      }),
      (err: unknown) => {
        assert.ok(err instanceof StaffAuthError);
        assert.equal(err.code, 'INVALID_STAFF_SESSION_RESPONSE');
        return true;
      },
      `Expected loginStaff to reject malformed payload: ${name}`
    );

    assert.equal(
      await loadStaffSession(storage),
      null,
      `Malformed payload must not persist: ${name}`
    );
    assert.deepEqual(storage.snapshot(), {});
  }
});

test('Expo SecureStore adapter persists, loads, and clears native session and purges corrupted storage entries', async () => {
  const rawStore = new Map<string, string>();
  const calls: string[] = [];

  const mockExpoSecureStore = {
    getItemAsync: async (key: string) => {
      calls.push(`get:${key}`);
      return rawStore.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      calls.push(`set:${key}`);
      rawStore.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      calls.push(`delete:${key}`);
      rawStore.delete(key);
    },
  };

  // Web platform does not use native SecureStore
  assert.equal(createExpoSecureStoreAdapter(mockExpoSecureStore, 'web'), null);

  // Native iOS/Android uses SecureStore
  const nativeAdapter = createExpoSecureStoreAdapter(
    mockExpoSecureStore,
    'ios'
  );
  assert.ok(nativeAdapter);

  const validSession = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload()
  );
  await saveStaffSession(validSession, nativeAdapter);
  assert.equal(rawStore.has(STAFF_SESSION_STORAGE_KEY), true);

  const loaded = await loadStaffSession(nativeAdapter);
  assert.deepEqual(loaded, validSession);
  assert.equal(
    await getStaffAccessToken(nativeAdapter),
    validSession.accessToken
  );

  await clearStaffSession(nativeAdapter);
  assert.equal(rawStore.has(STAFF_SESSION_STORAGE_KEY), false);
  assert.equal(await loadStaffSession(nativeAdapter), null);

  assert.deepEqual(calls, [
    `set:${STAFF_SESSION_STORAGE_KEY}`,
    `get:${STAFF_SESSION_STORAGE_KEY}`,
    `get:${STAFF_SESSION_STORAGE_KEY}`,
    `delete:${STAFF_SESSION_STORAGE_KEY}`,
    `get:${STAFF_SESSION_STORAGE_KEY}`,
  ]);

  // Corrupted JSON in SecureStore is automatically purged on load
  rawStore.set(STAFF_SESSION_STORAGE_KEY, '{"corrupted":true}');
  const corruptedLoad = await loadStaffSession(nativeAdapter);
  assert.equal(corruptedLoad, null);
  assert.equal(rawStore.has(STAFF_SESSION_STORAGE_KEY), false);
  assert.equal(deserializeStaffSession('not-json'), null);
  assert.equal(validateStaffSession(null), null);
});

test('staffApi sends only the stored staff token, never falls back to owner token, and fails before network when logged out', async () => {
  const storage = createInMemoryStaffSessionStorage();
  configureStaffSessionStorage(storage);

  let networkCalls = 0;
  const client = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    fetchRequest: async (_url, init) => {
      networkCalls += 1;
      const authHeader = new Headers(init?.headers).get('authorization');
      return Response.json({ authHeader });
    },
  });

  // 1. When no staff session is stored, staffApi rejects without calling network (and never falls back to owner token)
  await assert.rejects(
    client('/api/orders?shopId=shop-pho-1'),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.status, 401);
      assert.equal(err.code, 'STAFF_SESSION_MISSING');
      return true;
    }
  );
  assert.equal(networkCalls, 0);

  // 2. When staff session is stored, staffApi sends ONLY the staff token
  const session: MobileStaffSession = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload({
      accessToken: 'staff-only-hmac-token-xyz',
    })
  );
  await saveStaffSession(session, storage);

  const response = await client('/api/orders?shopId=shop-pho-1');
  const body = (await response.json()) as { authHeader: string };
  assert.equal(networkCalls, 1);
  assert.equal(body.authHeader, 'Bearer staff-only-hmac-token-xyz');

  // 3. Default exported staffApi also uses configured storage and rejects invalid paths
  await assert.rejects(
    staffApi('https://evil.example.com/api/orders'),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.code, 'INVALID_API_PATH');
      return true;
    }
  );
});

test('staffApi clears the stored staff session on HTTP 401 and on explicit STAFF_SESSION_REVOKED (including HTTP 403)', async () => {
  const storage = createInMemoryStaffSessionStorage();
  const validSession = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload({
      accessToken: 'staff-token-to-be-cleared',
    })
  );

  // Case 1: HTTP 401 clears staff session
  await saveStaffSession(validSession, storage);
  const clearedEvents: Array<{ status: number; code?: string }> = [];

  const client401 = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    onSessionCleared: (ctx) => {
      clearedEvents.push({ status: ctx.status, code: ctx.code });
    },
    fetchRequest: async () =>
      Response.json(
        {
          error:
            'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        },
        { status: 401 }
      ),
  });

  await assert.rejects(
    client401('/api/orders?shopId=shop-pho-1'),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.status, 401);
      assert.equal(err.sessionCleared, true);
      assert.equal(err.message.includes('staff-token-to-be-cleared'), false);
      return true;
    }
  );
  assert.equal(await loadStaffSession(storage), null);
  assert.deepEqual(clearedEvents, [
    { status: 401, code: undefined as string | undefined },
  ]);

  // Case 2: HTTP 403 with explicit code: 'STAFF_SESSION_REVOKED' (e.g. GET /api/shops?member=1) clears staff session
  await saveStaffSession(validSession, storage);
  const clientRevoked403 = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    onSessionCleared: (ctx) => {
      clearedEvents.push({ status: ctx.status, code: ctx.code });
    },
    fetchRequest: async () =>
      Response.json(
        {
          error:
            'Tài khoản nhân viên đã bị ngừng kích hoạt hoặc không còn quyền truy cập.',
          code: STAFF_SESSION_REVOKED_CODE,
        },
        { status: 403 }
      ),
  });

  await assert.rejects(
    clientRevoked403('/api/shops?member=1'),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, STAFF_SESSION_REVOKED_CODE);
      assert.equal(err.sessionCleared, true);
      return true;
    }
  );
  assert.equal(await loadStaffSession(storage), null);
  assert.deepEqual(clearedEvents, [
    { status: 401, code: undefined },
    { status: 403, code: STAFF_SESSION_REVOKED_CODE },
  ]);
});

test('staffApi retains the stored staff session on ordinary 403 permission denials, 5xx errors, and network failures', async () => {
  const storage = createInMemoryStaffSessionStorage();
  const validSession = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload({
      accessToken: 'staff-token-must-survive',
    })
  );
  await saveStaffSession(validSession, storage);

  let clearedCount = 0;

  // 1. Ordinary 403 permission denial (INSUFFICIENT_SHOP_PERMISSION)
  const clientPerm403 = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    onSessionCleared: () => {
      clearedCount += 1;
    },
    fetchRequest: async () =>
      Response.json(
        {
          error:
            'Tài khoản (cashier) không có quyền thực hiện thao tác này (cần quyền: catalog.manage).',
          code: 'INSUFFICIENT_SHOP_PERMISSION',
        },
        { status: 403 }
      ),
  });

  await assert.rejects(
    clientPerm403('/api/catalog', { method: 'POST' }),
    (err: unknown) => {
      assert.ok(err instanceof StaffApiError);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'INSUFFICIENT_SHOP_PERMISSION');
      assert.equal(err.sessionCleared, false);
      return true;
    }
  );
  assert.equal(clearedCount, 0);
  assert.deepEqual(await loadStaffSession(storage), validSession);

  // 2. Non-JSON 403 / 503 responses
  for (const status of [403, 500, 503]) {
    const clientNonJson = createStaffApiClient({
      baseUrl: 'http://dev:3000',
      storage,
      onSessionCleared: () => {
        clearedCount += 1;
      },
      fetchRequest: async () => new Response('plain error text', { status }),
    });

    await assert.rejects(
      clientNonJson('/api/orders?shopId=shop-pho-1'),
      (err: unknown) => {
        assert.ok(err instanceof StaffApiError);
        assert.equal(err.status, status);
        assert.equal(err.sessionCleared, false);
        return true;
      }
    );
    assert.equal(clearedCount, 0);
    assert.deepEqual(await loadStaffSession(storage), validSession);
  }

  // 3. Network failure (offline / DNS / timeout)
  const clientOffline = createStaffApiClient({
    baseUrl: 'http://dev:3000',
    storage,
    onSessionCleared: () => {
      clearedCount += 1;
    },
    fetchRequest: async () => {
      throw new Error('Network request failed');
    },
  });

  await assert.rejects(
    clientOffline('/api/orders?shopId=shop-pho-1'),
    /Network request failed/
  );
  assert.equal(clearedCount, 0);
  assert.deepEqual(await loadStaffSession(storage), validSession);
});

test('owner createApiClient and module boundaries remain isolated with no import cycle between supabase.ts and staff-session.ts', async () => {
  const storage = createInMemoryStaffSessionStorage();
  const validSession = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload({
      accessToken: 'staff-token-isolated',
    })
  );
  await saveStaffSession(validSession, storage);

  // Owner API client continues to use only its own getAccessToken (Supabase JWT)
  const ownerClient = createApiClient(
    'http://dev:3000',
    async () => 'owner-supabase-jwt-token',
    async (_url, init) => {
      return Response.json({
        auth: new Headers(init?.headers).get('authorization'),
      });
    }
  );
  const ownerRes = await ownerClient('/api/shops?member=1');
  const ownerData = (await ownerRes.json()) as { auth: string };
  assert.equal(ownerData.auth, 'Bearer owner-supabase-jwt-token');

  // Verify staff-session.ts has only type imports from supabase.ts and never calls supabase.auth
  const staffSessionSource = fs.readFileSync(
    path.join(__dirname, '../src/lib/staff-session.ts'),
    'utf8'
  );
  const staffApiSource = fs.readFileSync(
    path.join(__dirname, '../src/lib/staff-api.ts'),
    'utf8'
  );

  assert.doesNotMatch(staffSessionSource, /API_BASE_URL/);
  assert.doesNotMatch(staffSessionSource, /supabase\.auth/);
  assert.doesNotMatch(staffApiSource, /supabase\.auth/);
  assert.doesNotMatch(staffSessionSource, /console\.(log|info|warn|error|debug)/);
  assert.doesNotMatch(staffApiSource, /console\.(log|info|warn|error|debug)/);

  // Never derives trust from locally decoded token claims
  const forgedTokenClaims = Buffer.from(
    JSON.stringify({
      sub: 'forged-admin-id',
      role: 'owner',
      shop_id: 'forged-shop-id',
      is_admin: true,
    })
  ).toString('base64url');
  const opaqueSignedToken = `${forgedTokenClaims}.forged-signature`;
  const parsedFromServerDto = parseStaffLoginResponse(
    createValidStaffLoginResponsePayload({
      accessToken: opaqueSignedToken,
    })
  );
  assert.equal(parsedFromServerDto.accessToken, opaqueSignedToken);
  assert.equal(
    parsedFromServerDto.user.id,
    'staff-acct-11111111-2222-4333-8444-555555555555'
  );
  assert.equal(parsedFromServerDto.user.role, 'cashier');
  assert.equal(parsedFromServerDto.activeShopId, 'shop-pho-1');
  assert.equal(parsedFromServerDto.shop.id, 'shop-pho-1');
});
