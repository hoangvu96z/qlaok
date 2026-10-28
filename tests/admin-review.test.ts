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
  dbCreateShop,
  ensureSupabaseReadyAndSeeded,
  hasSupabaseServiceRoleKey,
  requireSupabaseServiceRoleClient,
  setSupabaseDbClientForTests,
} = await import('@/lib/db');
const { GET: healthGet } = await import('@/app/api/health/route');
const {
  issueSessionToken,
  isServerSigningSecretConfigured,
  readAdminAuditLog,
  recordAdminAuditLog,
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

test('admin audit JSONL files are private, rotate at the size limit, and can be read newest-first', () => {
  const logPath = path.join(fixture, '.local-db', 'admin-audit.log.jsonl');
  recordAdminAuditLog({
    actorId: 'admin-fixture',
    actorEmail: 'admin@example.test',
    action: 'first-action',
  });
  assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
  assert.equal(readAdminAuditLog(1)[0]?.action, 'first-action');

  fs.writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024), { mode: 0o600 });
  recordAdminAuditLog({
    actorId: 'admin-fixture',
    actorEmail: 'admin@example.test',
    action: 'after-rotation',
  });
  assert.equal(fs.statSync(`${logPath}.1`).mode & 0o777, 0o600);
  assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
  assert.equal(readAdminAuditLog(1)[0]?.action, 'after-rotation');
});

test('requireSuperAdmin and requireAuthenticatedUser return structured 500 when production SESSION_SECRET is missing', async () => {
  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-that-must-not-sign-sessions';
  process.env.PAYMENT_WEBHOOK_SECRET = 'payment-webhook-key-that-must-not-sign-sessions';

  try {
    assert.equal(
      isServerSigningSecretConfigured(),
      false,
      'service and webhook secrets must never substitute for SESSION_SECRET'
    );
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
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.PAYMENT_WEBHOOK_SECRET;
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

test('/api/admin routes owner password recovery through Zitadel instead of local credentials', async () => {
  const adminToken = issueSessionToken({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });
  setSupabaseDbClientForTests(null);

  const resetResponse = await adminPost(
    new Request('http://localhost/api/admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        action: 'reset_owner_password',
        ownerId: 'owner-1',
        email: 'owner@example.test',
        newPassword: 'ignored-password',
      }),
    })
  );
  assert.equal(resetResponse.status, 410);
  assert.equal(
    (await resetResponse.json()).code,
    'OWNER_PASSWORD_RESET_VIA_OIDC'
  );

  const adminPageSource = fs.readFileSync(
    path.join(originalCwd, 'src/app/(admin)/admin/page.tsx'),
    'utf8'
  );
  const adminRouteSource = fs.readFileSync(
    path.join(originalCwd, 'src/app/api/admin/route.ts'),
    'utf8'
  );
  const credentialSource = fs.readFileSync(
    path.join(originalCwd, 'src/lib/auth-credentials.ts'),
    'utf8'
  );
  assert.doesNotMatch(adminPageSource, /newOwnerPassword|handleResetOwnerPassword/);
  assert.match(adminPageSource, /Owners sign in and recover passwords through Zitadel/);
  assert.doesNotMatch(adminRouteSource, /readCredentials|writeCredentials/);
  assert.doesNotMatch(credentialSource, /CredentialMap|readCredentials|writeCredentials|INITIAL_SUPER_ADMIN_PASSWORD/);
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

test('POST /api/auth sync_user surfaces Super Admin profile DB errors instead of swallowing them', async () => {
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

  const adminToken = issueSessionToken({
    id: 'a3a30894-e8ae-415d-a3dc-7947b0399dd1',
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });

  setSupabaseDbClientForTests(failingAuthDbClient as never);
  try {
    const res = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          action: 'sync_user',
          email: SUPER_ADMIN_EMAIL,
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

test('POST /api/auth rejects direct owner password login/register with OIDC_REQUIRED and keeps cachedAdminClient service_role Authorization untouched on sync_user and /api/admin', async () => {
  setSupabaseDbClientForTests(null);
  const originalFetch = globalThis.fetch;
  const serviceRoleKey = makeJwtWithRole('service_role');
  const publishableKey = 'sb_publishable_mock_anon_key';

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

  const adminUuid = 'a3a30894-e8ae-415d-a3dc-7947b0399dd1';
  const ownerUuid = '7d21f8ae-6b7c-414b-ba28-3f932ab062f7';

  const profilesStore: Array<Record<string, unknown>> = [
    {
      id: adminUuid,
      email: SUPER_ADMIN_EMAIL,
      full_name: 'Hoàng Vũ (Super Admin)',
      phone: '0905649696',
      plan: 'premium',
      plan_expires_at: '2030-12-31T23:59:59Z',
    },
    {
      id: ownerUuid,
      email: 'supabase-owner@qlaok.com',
      full_name: 'Existing Owner',
      phone: '0901234567',
      plan: 'pro',
      plan_expires_at: '2029-12-31T23:59:59Z',
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
      return new Response(JSON.stringify({ error: 'unexpected GoTrue call' }), {
        status: 500,
      });
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      restCalls.push({ url: url.pathname + url.search, apikey, authorization });

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
        const eqId = url.searchParams.get('id');
        if (eqId?.startsWith('eq.')) {
          const targetId = eqId.slice('eq.'.length).toLowerCase();
          const matches = profilesStore.filter(
            (p) => String(p.id).toLowerCase() === targetId
          );
          return new Response(
            JSON.stringify(isSingleObject ? (matches[0] ?? null) : matches),
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
            owner_id: ownerUuid,
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
    // 1. Direct owner password registration is rejected with OIDC_REQUIRED (zero GoTrue calls)
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
    assert.equal(regRes.status, 400);
    assert.equal((await regRes.json()).code, 'OIDC_REQUIRED');

    // 2. Direct owner password login is rejected with OIDC_REQUIRED (zero GoTrue calls)
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
    assert.equal(ownerLoginRes.status, 400);
    assert.equal((await ownerLoginRes.json()).code, 'OIDC_REQUIRED');
    assert.equal(authCalls.length, 0, 'Must never call Supabase GoTrue /auth/v1/*');

    // 3. Super Admin sync_user resolves against UUID profile and keeps service_role Authorization
    const adminSessionToken = issueSessionToken({
      id: adminUuid,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const adminSyncRes = await authPost(
      new Request('http://localhost/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSessionToken}`,
        },
        body: JSON.stringify({
          action: 'sync_user',
        }),
      })
    );
    assert.equal(adminSyncRes.status, 200);
    const adminLoginBody = await adminSyncRes.json();
    assert.equal(adminLoginBody.isAdmin, true);
    assert.equal(adminLoginBody.user.email, SUPER_ADMIN_EMAIL);
    assert.equal(adminLoginBody.user.id, adminUuid);
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

test('Super Admin profile seeding ignores the obsolete initial password environment variable', async () => {
  const { ensureSuperAdminSeeded } = await import('@/lib/auth-credentials');
  const previousInitialPassword = process.env.INITIAL_SUPER_ADMIN_PASSWORD;
  process.env.INITIAL_SUPER_ADMIN_PASSWORD = 'obsolete-fixture-password';
  const profile = { id: SUPER_ADMIN_ID, email: SUPER_ADMIN_EMAIL, full_name: 'Admin fixture', plan: 'premium' };
  function chain(result: unknown): Record<string, unknown> {
    const value: Record<string, unknown> = { then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'ilike', 'order', 'limit', 'maybeSingle']) value[method] = () => value;
    return value;
  }
  const db = { from: (table: string) => chain({ data: table === 'profiles' ? [profile] : [{ id: 'fixture-shop' }], error: null }) };
  setSupabaseDbClientForTests(db as never);
  try {
    const seeded = await ensureSuperAdminSeeded();
    assert.equal(seeded.id, SUPER_ADMIN_ID);
    assert.equal(seeded.is_admin, true);
    assert.equal(
      fs.existsSync(path.join(fixture, '.local-db', 'auth-credentials.json')),
      false
    );
  } finally {
    setSupabaseDbClientForTests(null);
    if (previousInitialPassword === undefined) {
      delete process.env.INITIAL_SUPER_ADMIN_PASSWORD;
    } else {
      process.env.INITIAL_SUPER_ADMIN_PASSWORD = previousInitialPassword;
    }
  }
});

test('ensureSupabaseReadyAndSeeded and /api/health never auto-seed demo shops in NODE_ENV=production when public.shops is empty while preserving non-production demo seeding', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const writeOperations: Array<{
    table: string;
    op: 'upsert' | 'insert';
    payload: unknown;
  }> = [];
  let shopsRows: Array<Record<string, unknown>> = [];
  let profilesRows: Array<Record<string, unknown>> = [];
  let failWriteOnTable: string | null = null;
  let failWriteError: { code: string; message: string } | null = null;

  const mockDbClient = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select(_columns?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) {
            const count =
              table === 'shops'
                ? shopsRows.length
                : table === 'provinces'
                  ? 34
                  : 0;
            return Promise.resolve({ data: null, count, error: null });
          }
          const rows =
            table === 'shops'
              ? shopsRows
              : table === 'profiles'
                ? profilesRows
                : [];
          const selectChain: Record<string, unknown> = {
            limit: (n: number) => {
              const sliced = rows.slice(0, n);
              return {
                then: (resolve: (r: unknown) => unknown) =>
                  Promise.resolve({ data: sliced, error: null }).then(resolve),
                single: () =>
                  Promise.resolve({
                    data: sliced[0] ?? null,
                    error: null,
                  }),
              };
            },
            eq: (col: string, val: unknown) => {
              const filtered = rows.filter((r) => r[col] === val);
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: filtered[0] ?? null,
                    error: null,
                  }),
                single: () =>
                  Promise.resolve({
                    data: filtered[0] ?? null,
                    error: null,
                  }),
                order: () =>
                  Promise.resolve({ data: filtered, error: null }),
              };
            },
            order: () => Promise.resolve({ data: rows, error: null }),
          };
          return selectChain;
        },
        upsert(payload: unknown) {
          writeOperations.push({ table, op: 'upsert', payload });
          if (failWriteOnTable === table && failWriteError) {
            return Promise.resolve({ data: null, error: failWriteError });
          }
          if (table === 'profiles') {
            const items = Array.isArray(payload) ? payload : [payload];
            for (const item of items) {
              if (item && typeof item === 'object') {
                profilesRows.push(item as Record<string, unknown>);
              }
            }
          }
          if (table === 'shops' && Array.isArray(payload)) {
            shopsRows.push(
              ...(payload as Array<Record<string, unknown>>)
            );
          }
          return Promise.resolve({ data: payload, error: null });
        },
        insert(payload: unknown) {
          writeOperations.push({ table, op: 'insert', payload });
          if (failWriteOnTable === table && failWriteError) {
            return Promise.resolve({ data: null, error: failWriteError });
          }
          if (table === 'shops' && payload && typeof payload === 'object') {
            const shopRow = payload as Record<string, unknown>;
            shopsRows.push(shopRow);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: shopRow, error: null }),
              }),
            };
          }
          return Promise.resolve({ data: payload, error: null });
        },
      };
      return builder;
    },
  };

  setSupabaseDbClientForTests(mockDbClient as never);
  const prevSessionSecretForProdTest = process.env.SESSION_SECRET;
  try {
    // 1. In production with an empty public.shops table: zero seed writes occur and schema is reported ready
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'prod-test-session-secret-32-chars-minimum!';
    const prodReady = await ensureSupabaseReadyAndSeeded();
    assert.equal(prodReady.ready, true);
    assert.equal(prodReady.seeded, false);
    assert.equal(
      writeOperations.length,
      0,
      'ensureSupabaseReadyAndSeeded must not write any demo records in production'
    );

    // Diagnostics (and therefore dataSource) are Super-Admin only; anonymous callers
    // get the minimal public status.
    const anonHealthRes = await healthGet(
      new Request('http://localhost/api/health')
    );
    assert.equal(anonHealthRes.status, 200);
    const anonHealthBody = await anonHealthRes.json();
    assert.deepEqual(Object.keys(anonHealthBody).sort(), [
      'service',
      'status',
      'timestamp',
    ]);
    assert.equal(
      'dataSource' in anonHealthBody,
      false,
      'public health response must not leak diagnostics'
    );

    const prodAdminToken = issueSessionToken({
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const healthRes = await healthGet(
      new Request('http://localhost/api/health', {
        headers: { Authorization: `Bearer ${prodAdminToken}` },
      })
    );
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.dataSource, 'self-hosted-postgres');
    assert.equal(typeof healthBody.environment.postgresConfigured, 'boolean');
    assert.equal(typeof healthBody.environment.garageConfigured, 'boolean');
    assert.equal(healthBody.environment.postgresTablesReady, true);
    assert.equal(healthBody.counts.shops, 0);
    assert.equal(
      writeOperations.length,
      0,
      'GET /api/health must not trigger demo seed writes in production'
    );

    // 2. A real owner can create the first shop on the empty production DB without triggering demo seeding
    const createdShop = await dbCreateShop(
      {
        slug: 'quan-that-01',
        name: 'Quán Thật Đầu Tiên',
        vertical: 'fnb',
        tagline_i18n: { vi: 'Quán thật' },
        description_i18n: { vi: 'Mô tả' },
        logo_url: '',
        cover_urls: [],
        address: '1 Nguyễn Huệ',
        city: 'Đà Nẵng',
        google_maps_url: '',
        google_review_url: '',
        phone_contact: '0912345678',
        zalo_phone: '0912345678',
        wifi_info: { ssid: '', password: '' },
        opening_hours: {
          mon: { open: '07:00', close: '22:00', closed: false },
          tue: { open: '07:00', close: '22:00', closed: false },
          wed: { open: '07:00', close: '22:00', closed: false },
          thu: { open: '07:00', close: '22:00', closed: false },
          fri: { open: '07:00', close: '22:00', closed: false },
          sat: { open: '07:00', close: '22:00', closed: false },
          sun: { open: '07:00', close: '22:00', closed: false },
        },
        supported_langs: ['vi', 'en'],
        currency: 'VND',
        theme_config: { primaryColor: '#10b981', layout: 'list' },
        is_published: true,
      },
      'real-owner-001'
    );
    assert.equal(createdShop.slug, 'quan-that-01');
    assert.equal(createdShop.owner_id, 'real-owner-001');
    assert.equal(shopsRows.length, 1);
    assert.equal(shopsRows[0].id, createdShop.id);
    assert.equal(
      writeOperations.some(
        (w) =>
          w.table === 'categories' ||
          w.table === 'items' ||
          w.table === 'posts' ||
          w.table === 'payment_transactions' ||
          w.table === 'analytics_events'
      ),
      false,
      'creating the first real shop in production must never seed demo catalog/posts/transactions/analytics'
    );

    // 3. In non-production, if any upsert/insert returns a PostgREST { error } object (without throwing),
    // ensureSupabaseReadyAndSeeded and /api/health must NOT report ready/seeded success
    shopsRows = [];
    profilesRows = [];
    writeOperations.length = 0;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    failWriteOnTable = 'items';
    failWriteError = {
      code: '42501',
      message: 'new row violates row-level security policy for table "items"',
    };

    const failedSeedStatus = await ensureSupabaseReadyAndSeeded();
    assert.equal(failedSeedStatus.ready, false);
    assert.equal(failedSeedStatus.seeded, false);
    assert.match(
      failedSeedStatus.error || '',
      /SEED_FAILED \(items\): 42501: new row violates row-level security policy/i
    );

    // Reset shopsRows so /api/health also hits the failed seed path
    shopsRows = [];
    profilesRows = [];
    const failedHealthRes = await healthGet(
      new Request('http://localhost/api/health', {
        headers: { Authorization: `Bearer ${prodAdminToken}` },
      })
    );
    assert.equal(failedHealthRes.status, 503);
    const failedHealthBody = await failedHealthRes.json();
    assert.equal(failedHealthBody.status, 'degraded');
    assert.equal(failedHealthBody.environment.postgresTablesReady, false);
    assert.equal(failedHealthBody.environment.postgresSeeded, false);
    assert.match(
      failedHealthBody.environment.postgresMessage,
      /SEED_FAILED \(items\)/i
    );

    // Also verify analytics_events insert error (does not throw) is caught
    shopsRows = [];
    profilesRows = [];
    failWriteOnTable = 'analytics_events';
    failWriteError = {
      code: '23503',
      message: 'insert or update on table "analytics_events" violates foreign key constraint',
    };
    const failedAnalyticsSeed = await ensureSupabaseReadyAndSeeded();
    assert.equal(failedAnalyticsSeed.ready, false);
    assert.equal(failedAnalyticsSeed.seeded, false);
    assert.match(
      failedAnalyticsSeed.error || '',
      /SEED_FAILED \(analytics_events\): 23503/i
    );

    // 4. In non-production with an empty public.shops table and healthy writes, existing auto-seed behavior succeeds
    shopsRows = [];
    profilesRows = [];
    writeOperations.length = 0;
    failWriteOnTable = null;
    failWriteError = null;

    const devReady = await ensureSupabaseReadyAndSeeded();
    assert.equal(devReady.ready, true);
    assert.equal(devReady.seeded, true);
    assert.ok(
      writeOperations.some((w) => w.table === 'shops' && w.op === 'upsert'),
      'non-production environment still auto-seeds demo shops when public.shops is empty'
    );
    assert.equal(shopsRows.length, 3);

    // 5. POST /api/admin action reseed_demo_data is rejected in NODE_ENV=production before any DB write
    try {
      writeOperations.length = 0;
      (process.env as Record<string, string | undefined>).NODE_ENV =
        'production';

      const prodReseedRes = await adminPost(
        new Request('http://localhost/api/admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${prodAdminToken}`,
          },
          body: JSON.stringify({ action: 'reseed_demo_data' }),
        })
      );
      assert.equal(prodReseedRes.status, 403);
      const prodReseedBody = await prodReseedRes.json();
      assert.equal(
        prodReseedBody.code,
        'DEMO_RESEED_FORBIDDEN_IN_PRODUCTION'
      );
      assert.equal(
        writeOperations.length,
        0,
        'POST /api/admin reseed_demo_data in production must make zero Supabase writes'
      );

      // 6. In dev/test, POST /api/admin reseed_demo_data still works and checks PostgREST write errors
      (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
      writeOperations.length = 0;
      failWriteOnTable = 'categories';
      failWriteError = {
        code: '42501',
        message: 'permission denied for table categories',
      };

      const failedReseedRes = await adminPost(
        new Request('http://localhost/api/admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${prodAdminToken}`,
          },
          body: JSON.stringify({ action: 'reseed_demo_data' }),
        })
      );
      assert.equal(failedReseedRes.status, 500);
      const failedReseedBody = await failedReseedRes.json();
      assert.equal(failedReseedBody.code, 'RESEED_DEMO_DATA_FAILED');
      assert.equal(failedReseedBody.table, 'categories');

      failWriteOnTable = null;
      failWriteError = null;
      writeOperations.length = 0;

      const devReseedRes = await adminPost(
        new Request('http://localhost/api/admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${prodAdminToken}`,
          },
          body: JSON.stringify({ action: 'reseed_demo_data' }),
        })
      );
      assert.equal(devReseedRes.status, 200);
      const devReseedBody = await devReseedRes.json();
      assert.equal(devReseedBody.ok, true);
      assert.equal(
        writeOperations.length,
        6,
        'dev/test reseed_demo_data upserts profiles, shops, categories, items, posts, and payment_transactions'
      );
    } finally {
      if (prevSessionSecretForProdTest === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = prevSessionSecretForProdTest;
      }
    }

    // 7. Admin UI source disables the reseed button in production and when systemHealth.demoReseedAllowed is false
    const adminPageSource = fs.readFileSync(
      path.join(originalCwd, 'src/app/(admin)/admin/page.tsx'),
      'utf8'
    );
    assert.match(
      adminPageSource,
      /const canReseedDemoData =\s*process\.env\.NODE_ENV !== 'production' &&\s*data\?\.systemHealth\?\.demoReseedAllowed !== false/,
      'Admin UI must gate demo reseed on non-production NODE_ENV and systemHealth.demoReseedAllowed'
    );
    assert.match(
      adminPageSource,
      /disabled=\{actionBusy \|\| !canReseedDemoData\}/,
      'Admin UI reseed button must be disabled when canReseedDemoData is false'
    );
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/admin approve_transaction validates payment amount and maps RPC/DB payment error statuses', async () => {
  function createMockAdminPaymentDb(options?: {
    tx?: {
      id?: string;
      order_code: string;
      user_id: string;
      amount: number;
      status: string;
      target_plan?: string;
      bank_ref_id?: string;
    } | null;
    paymentLookupError?: { message: string } | null;
    rpcError?: { message: string } | null;
  }) {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (options?.rpcError) {
          return { data: null, error: options.rpcError };
        }
        return {
          data: {
            status: 'completed',
            owner_id: options?.tx?.user_id || 'owner-mock-001',
            target_plan: options?.tx?.target_plan || 'premium',
          },
          error: null,
        };
      },
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const resolveData = () => {
          if (table === 'shops') {
            return [{ id: 'shop-mock-001', owner_id: 'owner-mock-001' }];
          }
          if (table === 'profiles') {
            return [
              {
                id: 'owner-mock-001',
                email: 'owner@mock.test',
                plan: 'premium',
              },
            ];
          }
          if (table === 'payment_transactions') {
            if (options?.paymentLookupError) {
              return null;
            }
            return options?.tx ? [options.tx] : [];
          }
          return [];
        };

        for (const m of ['select', 'eq', 'neq', 'ilike', 'order', 'limit']) {
          chain[m] = () => chain;
        }

        chain.maybeSingle = async () => {
          if (table === 'payment_transactions' && options?.paymentLookupError) {
            return { data: null, error: options.paymentLookupError };
          }
          const rows = resolveData();
          return {
            data: rows && rows.length > 0 ? rows[0] : null,
            error: null,
          };
        };

        chain.single = async () => {
          const rows = resolveData();
          return {
            data: rows && rows.length > 0 ? rows[0] : null,
            error: null,
          };
        };

        chain.then = (
          onFulfilled: (val: { data: unknown; error: unknown }) => unknown,
          onRejected?: (err: unknown) => unknown
        ) => {
          if (table === 'payment_transactions' && options?.paymentLookupError) {
            return Promise.resolve({
              data: null,
              error: options.paymentLookupError,
            }).then(onFulfilled, onRejected);
          }
          const data = resolveData();
          return Promise.resolve({ data, error: null }).then(
            onFulfilled,
            onRejected
          );
        };

        return chain;
      },
    };

    return { client, rpcCalls };
  }

  const adminToken = issueSessionToken({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });

  const sendApprove = async (body: Record<string, unknown>) => {
    return adminPost(
      new Request('http://localhost/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ action: 'approve_transaction', ...body }),
      })
    );
  };

  // 1. Missing amounts must return 400 PAYMENT_AMOUNT_REQUIRED and NOT call the RPC
  {
    const { client, rpcCalls } = createMockAdminPaymentDb();
    setSupabaseDbClientForTests(client as never);
    try {
      const res1 = await sendApprove({ orderCode: 'ORD-TEST-001' });
      assert.equal(res1.status, 400);
      const body1 = await res1.json();
      assert.equal(body1.code, 'PAYMENT_AMOUNT_REQUIRED');

      const res2 = await sendApprove({
        orderCode: 'ORD-TEST-001',
        amount: null,
      });
      assert.equal(res2.status, 400);
      const body2 = await res2.json();
      assert.equal(body2.code, 'PAYMENT_AMOUNT_REQUIRED');

      const res3 = await sendApprove({
        orderCode: 'ORD-TEST-001',
        transferAmount: null,
      });
      assert.equal(res3.status, 400);
      const body3 = await res3.json();
      assert.equal(body3.code, 'PAYMENT_AMOUNT_REQUIRED');

      assert.equal(
        rpcCalls.length,
        0,
        'RPC must not be called when amount is missing'
      );
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 2. Invalid/zero/negative amounts must return 400 INVALID_PAYMENT_AMOUNT and NOT call the RPC
  {
    const { client, rpcCalls } = createMockAdminPaymentDb();
    setSupabaseDbClientForTests(client as never);
    try {
      const invalidAmounts = [
        0,
        -50000,
        'invalid',
        '',
        '   ',
        true,
        false,
        {},
        [],
      ];
      for (const amount of invalidAmounts) {
        const res = await sendApprove({ orderCode: 'ORD-TEST-001', amount });
        assert.equal(
          res.status,
          400,
          `Expected status 400 for invalid amount: ${JSON.stringify(amount)}`
        );
        const body = await res.json();
        assert.equal(
          body.code,
          'INVALID_PAYMENT_AMOUNT',
          `Expected INVALID_PAYMENT_AMOUNT for: ${JSON.stringify(amount)}`
        );
      }
      assert.equal(
        rpcCalls.length,
        0,
        'RPC must not be called when amount is invalid'
      );
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 3. Valid amount passes through to RPC with allowUnverifiedAmount: false, respecting transferAmount precedence
  {
    const sampleTx = {
      id: 'tx-001',
      order_code: 'ORD-TEST-001',
      user_id: 'owner-mock-001',
      amount: 50000,
      status: 'pending',
      target_plan: 'premium',
    };
    const { client, rpcCalls } = createMockAdminPaymentDb({ tx: sampleTx });
    setSupabaseDbClientForTests(client as never);
    try {
      // JSON number
      const res1 = await sendApprove({
        orderCode: 'ORD-TEST-001',
        amount: 50000,
      });
      assert.equal(res1.status, 200);
      const body1 = await res1.json();
      assert.equal(body1.ok, true);
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].fn, 'complete_payment_webhook_atomic');
      assert.equal(rpcCalls[0].args.p_order_code, 'ORD-TEST-001');
      assert.equal(rpcCalls[0].args.p_verified_transfer_amount, 50000);
      assert.equal(rpcCalls[0].args.p_allow_unverified_amount, false);

      // Non-empty numeric string
      const res2 = await sendApprove({
        orderCode: 'ORD-TEST-001',
        amount: ' 50000 ',
      });
      assert.equal(res2.status, 200);
      assert.equal(rpcCalls.length, 2);
      assert.equal(rpcCalls[1].args.p_verified_transfer_amount, 50000);

      // transferAmount precedence over amount
      const res3 = await sendApprove({
        orderCode: 'ORD-TEST-001',
        amount: 30000,
        transferAmount: 50000,
      });
      assert.equal(res3.status, 200);
      assert.equal(rpcCalls.length, 3);
      assert.equal(rpcCalls[2].args.p_verified_transfer_amount, 50000);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 4. RPC underpayment returns HTTP 400
  {
    const sampleTx = {
      id: 'tx-002',
      order_code: 'ORD-TEST-002',
      user_id: 'owner-mock-001',
      amount: 100000,
      status: 'pending',
    };
    const { client } = createMockAdminPaymentDb({
      tx: sampleTx,
      rpcError: {
        message:
          'PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản (50000) nhỏ hơn số tiền gói cước yêu cầu (100000).',
      },
    });
    setSupabaseDbClientForTests(client as never);
    try {
      const res = await sendApprove({
        orderCode: 'ORD-TEST-002',
        amount: 50000,
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /PAYMENT_AMOUNT_MISMATCH/);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 5. Non-pending order returns HTTP 409
  {
    const sampleTx = {
      id: 'tx-003',
      order_code: 'ORD-TEST-003',
      user_id: 'owner-mock-001',
      amount: 50000,
      status: 'completed',
    };
    const { client } = createMockAdminPaymentDb({
      tx: sampleTx,
      rpcError: {
        message:
          'PAYMENT_ORDER_NOT_PENDING: Trạng thái đơn thanh toán là "completed", không thể hoàn tất.',
      },
    });
    setSupabaseDbClientForTests(client as never);
    try {
      const res = await sendApprove({
        orderCode: 'ORD-TEST-003',
        amount: 50000,
      });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /PAYMENT_ORDER_NOT_PENDING/);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 6. Unknown order returns HTTP 404
  {
    const { client } = createMockAdminPaymentDb({ tx: null });
    setSupabaseDbClientForTests(client as never);
    try {
      const res = await sendApprove({
        orderCode: 'ORD-UNKNOWN-999',
        amount: 50000,
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.match(body.error, /PAYMENT_ORDER_NOT_FOUND/);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }

  // 7. Generic DB error returns HTTP 500
  {
    const { client } = createMockAdminPaymentDb({
      paymentLookupError: { message: 'connection failure to replica' },
    });
    setSupabaseDbClientForTests(client as never);
    try {
      const res = await sendApprove({
        orderCode: 'ORD-TEST-007',
        amount: 50000,
      });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /DB_PAYMENT_LOOKUP_FAILED/);
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }
});
