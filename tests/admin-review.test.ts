import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
  'PAYMENT_WEBHOOK_SECRET',
]) {
  delete process.env[key];
}

const originalCwd = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-admin-review-'));
process.chdir(fixture);
after(() => {
  process.chdir(originalCwd);
  fs.rmSync(fixture, { recursive: true, force: true });
});

const {
  hasSupabaseServiceRoleKey,
  requireSupabaseServiceRoleClient,
  setSupabaseDbClientForTests,
} = await import('@/lib/db');
const {
  issueSessionToken,
  requireSuperAdmin,
  requireAuthenticatedUser,
} = await import('@/lib/server-auth');
const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID } = await import(
  '@/lib/auth-session'
);
const { GET: adminGet, POST: adminPost } = await import(
  '@/app/api/admin/route'
);
const { POST: authPost } = await import('@/app/api/auth/route');

function makeJwtWithRole(role: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url');
  return `${header}.${payload}.signature`;
}

test('requireSupabaseServiceRoleClient rejects missing, publishable, and anon role keys', () => {
  setSupabaseDbClientForTests(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = makeJwtWithRole('anon');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.equal(hasSupabaseServiceRoleKey(), false);
  assert.throws(
    () => requireSupabaseServiceRoleClient('Test Admin'),
    /MISSING_SERVICE_ROLE_KEY/
  );

  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_fake_key';
  assert.equal(hasSupabaseServiceRoleKey(), false);
  assert.throws(
    () => requireSupabaseServiceRoleClient('Test Admin'),
    /MISSING_SERVICE_ROLE_KEY/
  );

  process.env.SUPABASE_SERVICE_ROLE_KEY = makeJwtWithRole('anon');
  assert.equal(hasSupabaseServiceRoleKey(), false);
  assert.throws(
    () => requireSupabaseServiceRoleClient('Test Admin'),
    /MISSING_SERVICE_ROLE_KEY/
  );

  process.env.SUPABASE_SERVICE_ROLE_KEY = makeJwtWithRole('service_role');
  assert.equal(hasSupabaseServiceRoleKey(), true);
  const client = requireSupabaseServiceRoleClient('Test Admin');
  assert.ok(client);

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test('requireSuperAdmin and requireAuthenticatedUser return structured 500 when production SESSION_SECRET is missing', async () => {
  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PAYMENT_WEBHOOK_SECRET;

  try {
    const req = new Request('http://localhost/api/admin', {
      headers: { Authorization: 'Bearer fake.token' },
    });

    const authCheck = await requireAuthenticatedUser(req);
    assert.ok(authCheck.errorResponse);
    assert.equal(authCheck.errorResponse.status, 500);
    const authBody = await authCheck.errorResponse.json();
    assert.equal(authBody.code, 'SERVER_AUTH_MISCONFIGURED');

    const adminCheck = await requireSuperAdmin(req);
    assert.ok(adminCheck.errorResponse);
    assert.equal(adminCheck.errorResponse.status, 500);
    const adminBody = await adminCheck.errorResponse.json();
    assert.equal(adminBody.code, 'SERVER_AUTH_MISCONFIGURED');
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  }
});

test('/api/admin enforces Super Admin authentication and rejects missing service_role key', async () => {
  setSupabaseDbClientForTests(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = makeJwtWithRole('anon');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Unauthenticated request -> 401
    const unauthRes = await adminGet(new Request('http://localhost/api/admin'));
    assert.equal(unauthRes.status, 401);

    // 2. Non-admin owner token -> 403
    const ownerToken = issueSessionToken({
      id: 'owner-fnb-001',
      email: 'owner@qlaok.com',
      role: 'owner',
      is_admin: false,
    });
    const forbiddenRes = await adminGet(
      new Request('http://localhost/api/admin', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
    );
    assert.equal(forbiddenRes.status, 403);

    // 3. Super Admin token without SUPABASE_SERVICE_ROLE_KEY -> 500 MISSING_SERVICE_ROLE_KEY
    const adminToken = issueSessionToken({
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const missingRoleRes = await adminGet(
      new Request('http://localhost/api/admin', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    );
    assert.equal(missingRoleRes.status, 500);
    const missingRoleBody = await missingRoleRes.json();
    assert.match(missingRoleBody.error, /MISSING_SERVICE_ROLE_KEY/);
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('/api/admin surfaces database query errors instead of returning empty fake data', async () => {
  const adminToken = issueSessionToken({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });

  // Inject a mock DB client where seeding check and super admin seed check succeed,
  // but table list query (`order(...)`) on `shops` in /api/admin fails with an RLS/DB error.
  const makeThenableChain = (
    resolvedValue: { data: unknown; error: { message: string } | null },
    overrides?: Record<string, () => unknown>
  ) => {
    const promise = Promise.resolve(resolvedValue);
    const chain: Record<string, unknown> = {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
      limit: () => makeThenableChain(resolvedValue, overrides),
      order: () => makeThenableChain(resolvedValue, overrides),
      eq: () => makeThenableChain(resolvedValue, overrides),
      ilike: () => makeThenableChain(resolvedValue, overrides),
      maybeSingle: () => promise,
      ...overrides,
    };
    return chain;
  };

  const failingDbClient = {
    from(table: string) {
      return {
        select(columns?: string) {
          if (table === 'shops' && columns === 'id') {
            return makeThenableChain({
              data: [{ id: 'shop-fnb-001' }],
              error: null,
            });
          }
          if (table === 'profiles') {
            return makeThenableChain({
              data: [
                {
                  id: SUPER_ADMIN_ID,
                  email: SUPER_ADMIN_EMAIL,
                  full_name: 'Super Admin',
                  plan: 'premium',
                  is_admin: true,
                  role: 'admin',
                },
              ],
              error: null,
            });
          }
          if (table === 'shops') {
            return makeThenableChain({
              data: null,
              error: { message: 'permission denied for table shops' },
            });
          }
          return makeThenableChain({ data: [], error: null });
        },
        update() {
          return makeThenableChain({
            data: null,
            error: { message: 'permission denied for table profiles' },
          });
        },
      };
    },
  };

  setSupabaseDbClientForTests(failingDbClient as never);
  try {
    const res = await adminGet(
      new Request('http://localhost/api/admin', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    );
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'ADMIN_DB_QUERY_FAILED');
    assert.match(body.error, /permission denied for table shops/i);

    const postRes = await adminPost(
      new Request('http://localhost/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          action: 'update_owner_plan',
          ownerId: 'owner-fnb-001',
          plan: 'premium',
        }),
      })
    );
    assert.equal(postRes.status, 500);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/auth login surfaces Super Admin profile DB errors instead of swallowing them', async () => {
  const failingAuthDbClient = {
    from() {
      return {
        select() {
          return {
            ilike() {
              return {
                limit() {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        'new row violates row-level security policy for table "profiles"',
                    },
                  });
                },
              };
            },
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        'new row violates row-level security policy for table "profiles"',
                    },
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  setSupabaseDbClientForTests(failingAuthDbClient as never);
  try {
    const res = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email: SUPER_ADMIN_EMAIL,
          password: 'any-password',
        }),
      })
    );
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.match(body.error, /row-level security|Super Admin/i);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/auth signUp and signInWithPassword isolate user JWTs on non-persistent public auth clients and keep cachedAdminClient service_role Authorization untouched (mocked-fetch regression)', async () => {
  setSupabaseDbClientForTests(null);
  const originalFetch = globalThis.fetch;
  const serviceRoleKey = makeJwtWithRole('service_role');
  const publishableKey = 'sb_publishable_mock_anon_key';
  const leakedUserJwt = makeJwtWithRole('authenticated');

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-qlaok.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  const authCalls: Array<{
    url: string;
    apikey: string | null;
    authorization: string | null;
  }> = [];
  const restCalls: Array<{
    url: string;
    apikey: string | null;
    authorization: string | null;
  }> = [];

  const profilesStore: Array<Record<string, unknown>> = [
    {
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      full_name: 'Hoàng Vũ (Super Admin)',
      phone: '0905649696',
      plan: 'premium',
      plan_expires_at: '2030-12-31T23:59:59Z',
    },
  ];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    const apikey = headers.get('apikey');
    const authorization = headers.get('Authorization');

    if (url.pathname.startsWith('/auth/v1/')) {
      authCalls.push({ url: url.pathname + url.search, apikey, authorization });

      if (url.pathname === '/auth/v1/signup') {
        return new Response(
          JSON.stringify({
            access_token: leakedUserJwt,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh-signup',
            user: {
              id: 'owner-signup-uuid-001',
              email: 'newowner@qlaok.com',
              user_metadata: { full_name: 'New Owner' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.pathname === '/auth/v1/token') {
        const bodyText =
          typeof init?.body === 'string' ? init.body : '{}';
        const parsed = JSON.parse(bodyText) as { email?: string };
        const email = (parsed.email || '').toLowerCase();
        return new Response(
          JSON.stringify({
            access_token: leakedUserJwt,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh-login',
            user: {
              // Intentionally use a Supabase Auth UUID different from SUPER_ADMIN_ID ('super-admin-001')
              id:
                email === SUPER_ADMIN_EMAIL
                  ? 'auth-users-uuid-admin-999'
                  : 'owner-login-uuid-002',
              email,
              user_metadata: { full_name: 'Logged In User' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      restCalls.push({ url: url.pathname + url.search, apikey, authorization });

      // Simulate strict RLS (migrations 003-005): if cachedAdminClient ever sends the
      // signed-in user's JWT instead of the service_role key, reject with 42501 RLS error.
      if (
        apikey !== serviceRoleKey ||
        authorization !== `Bearer ${serviceRoleKey}`
      ) {
        return new Response(
          JSON.stringify({
            code: '42501',
            message:
              'new row violates row-level security policy (contaminated user JWT on admin DB client)',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const table = url.pathname.replace('/rest/v1/', '');
      const accept = headers.get('Accept') || '';
      const isSingleObject = accept.includes(
        'application/vnd.pgrst.object+json'
      );

      if (table === 'profiles') {
        if (init?.method === 'POST' || init?.method === 'PATCH') {
          const bodyText =
            typeof init?.body === 'string' ? init.body : '{}';
          const parsed = JSON.parse(bodyText);
          const row = Array.isArray(parsed) ? parsed[0] : parsed;
          const existingIdx = profilesStore.findIndex(
            (p) => p.id === row.id || p.email === row.email
          );
          const merged =
            existingIdx >= 0
              ? { ...profilesStore[existingIdx], ...row }
              : row;
          if (existingIdx >= 0) {
            profilesStore[existingIdx] = merged;
          } else {
            profilesStore.push(merged);
          }
          return new Response(
            JSON.stringify(isSingleObject ? merged : [merged]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const ilikeEmail = url.searchParams.get('email');
        if (ilikeEmail?.startsWith('ilike.')) {
          const targetEmail = ilikeEmail.slice('ilike.'.length).toLowerCase();
          const matches = profilesStore.filter(
            (p) => String(p.email).toLowerCase() === targetEmail
          );
          return new Response(
            JSON.stringify(isSingleObject ? (matches[0] ?? null) : matches),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify(
            isSingleObject ? (profilesStore[0] ?? null) : profilesStore
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (table === 'shops') {
        const shops = [
          {
            id: 'shop-fnb-001',
            owner_id: 'owner-fnb-001',
            slug: 'pho-gia-truyen',
            name: 'Phở Gia Truyền',
            vertical: 'fnb',
            is_published: true,
          },
        ];
        return new Response(
          JSON.stringify(isSingleObject ? shops[0] : shops),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify(isSingleObject ? null : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;

  try {
    // 1. Public shop owner registration triggers auth.signUp (which returns a user session JWT)
    const regRes = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          email: 'newowner@qlaok.com',
          password: 'OwnerPass!123',
          fullName: 'New Owner',
        }),
      })
    );
    assert.equal(regRes.status, 201);

    // 2. Public shop owner login via Supabase Auth password triggers auth.signInWithPassword
    const ownerLoginRes = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email: 'supabase-owner@qlaok.com',
          password: 'SupabaseOwnerPass!123',
        }),
      })
    );
    assert.equal(ownerLoginRes.status, 200);

    // 3. Super Admin login via Supabase Auth password must succeed and not be blocked by RLS
    const adminLoginRes = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email: SUPER_ADMIN_EMAIL,
          password: 'AdminSupabasePassword!123',
        }),
      })
    );
    assert.equal(adminLoginRes.status, 200);
    const adminLoginBody = await adminLoginRes.json();
    assert.equal(adminLoginBody.isAdmin, true);
    assert.equal(adminLoginBody.user.email, SUPER_ADMIN_EMAIL);
    assert.equal(adminLoginBody.user.id, SUPER_ADMIN_ID);
    assert.ok(adminLoginBody.accessToken);

    // 4. Subsequent GET /api/admin using shared cachedAdminClient must still use service_role key
    const adminApiRes = await adminGet(
      new Request('http://localhost/api/admin', {
        headers: { Authorization: `Bearer ${adminLoginBody.accessToken}` },
      })
    );
    assert.equal(adminApiRes.status, 200);
    const adminApiBody = await adminApiRes.json();
    assert.equal(adminApiBody.systemHealth?.supabaseConnected, true);

    // Verify all GoTrue /auth/v1/* calls used the publishable/anon key, never the service_role key
    assert.ok(authCalls.length >= 3, 'Expected signup and password token calls');
    for (const call of authCalls) {
      assert.equal(
        call.apikey,
        publishableKey,
        `Auth endpoint ${call.url} must use publishable/anon key`
      );
    }

    // Verify every single PostgREST /rest/v1/* call kept Authorization: Bearer <serviceRoleKey>
    assert.ok(restCalls.length > 0, 'Expected PostgREST queries');
    for (const call of restCalls) {
      assert.equal(
        call.apikey,
        serviceRoleKey,
        `PostgREST query ${call.url} must use service_role apikey`
      );
      assert.equal(
        call.authorization,
        `Bearer ${serviceRoleKey}`,
        `PostgREST query ${call.url} must keep service_role Bearer token and never leak user JWT`
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    setSupabaseDbClientForTests(null);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('existing Super Admin password still authenticates against the real profile without changing credentials', async () => {
  const { writeCredentials, readCredentials, hashPassword } = await import('@/lib/auth-credentials');
  const passwordHash = hashPassword('fixture-old-password');
  writeCredentials({ [SUPER_ADMIN_EMAIL]: { passwordHash, profileId: SUPER_ADMIN_ID } });
  const profile = { id: SUPER_ADMIN_ID, email: SUPER_ADMIN_EMAIL, full_name: 'Admin fixture', plan: 'premium' };
  function chain(result: unknown): Record<string, unknown> {
    const value: Record<string, unknown> = { then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'ilike', 'order', 'limit', 'maybeSingle']) value[method] = () => value;
    return value;
  }
  const db = { from: (table: string) => chain({ data: table === 'profiles' ? [profile] : [{ id: 'fixture-shop' }], error: null }) };
  setSupabaseDbClientForTests(db as never);
  try {
    const response = await authPost(new Request('http://localhost/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: SUPER_ADMIN_EMAIL, password: 'fixture-old-password' }),
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.user.id, SUPER_ADMIN_ID);
    assert.equal(body.isAdmin, true);
    assert.equal(readCredentials()[SUPER_ADMIN_EMAIL].passwordHash, passwordHash);
  } finally { setSupabaseDbClientForTests(null); }
});
