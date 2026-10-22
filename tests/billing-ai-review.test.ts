import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';

// Isolated: never use credentials or AI keys from a developer shell.
for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PAYMENT_DEV_SIMULATE',
]) {
  delete process.env[key];
}

const originalCwd = process.cwd();
const fixtureDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'qlaok-billing-ai-review-')
);
process.chdir(fixtureDir);

const { setSupabaseDbClientForTests } = await import('@/lib/db');
const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_ID } = await import(
  '@/lib/auth-session'
);
const { issueSessionToken } = await import('@/lib/server-auth');
const {
  dbDeleteShopMembership,
  dbUpsertShopMembership,
  setShopMembershipDbClientForTest,
} = await import('@/lib/shop-permissions');
const {
  formatPlanLimitError,
  parsePlanErrorCode,
  isPlanLimitError,
  canUseAiOcr,
  canAddMoreItems,
  BILLING_UPGRADE_HREF,
} = await import('@/lib/plan-limits');
const { POST: translatePost } = await import('@/app/api/ai/translate/route');
const { POST: ocrPost } = await import('@/app/api/ai/ocr-menu/route');
const {
  resetAiRateLimitsForTest,
  AI_RATE_LIMITS,
  isMembershipAllowedForCatalogAi,
} = await import('@/app/api/ai/_lib/guard');
const { POST: paymentPost } = await import('@/app/api/webhooks/payment/route');

let profilePlan: string | null = 'free';
let mockShops: Array<{ id: string; owner_id: string }> = [
  { id: 'shop-review-owner', owner_id: 'review-ai-owner' },
  { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
];
let mockMemberships: Array<{
  id: string;
  shop_id: string;
  user_id: string;
  role: string;
  permissions?: string[] | null;
  is_active: boolean;
}> = [];
let mockProfiles: Record<
  string,
  { id: string; email?: string; full_name?: string; phone?: string; plan?: string | null } | null
> = {};
let mockTableErrors: Partial<Record<string, { code?: string; message: string }>> = {};
const selectedProjections: Array<{ table: string; columns: string }> = [];
const insertedTransactions: Array<Record<string, unknown>> = [];

// Authoritative column whitelist from 001_init_qlaok.sql & 004_memberships_billing_payments_audit.sql.
// Notably, public.profiles has NO `role` or `is_admin` columns.
const SCHEMA_COLUMNS_BY_TABLE: Record<string, ReadonlySet<string>> = {
  profiles: new Set([
    'id',
    'email',
    'phone',
    'full_name',
    'plan',
    'plan_expires_at',
    'created_at',
    'updated_at',
  ]),
  shops: new Set([
    'id',
    'owner_id',
    'slug',
    'name',
    'vertical',
    'tagline_i18n',
    'description_i18n',
    'logo_url',
    'cover_urls',
    'address',
    'city',
    'google_maps_url',
    'google_review_url',
    'phone_contact',
    'zalo_phone',
    'telegram_chat_id',
    'wifi_info',
    'opening_hours',
    'supported_langs',
    'currency',
    'theme_config',
    'is_published',
    'created_at',
    'updated_at',
  ]),
  shop_memberships: new Set([
    'id',
    'shop_id',
    'user_id',
    'email',
    'full_name',
    'role',
    'permissions',
    'is_active',
    'created_at',
    'updated_at',
  ]),
  payment_transactions: new Set([
    'id',
    'user_id',
    'order_code',
    'target_plan',
    'amount',
    'status',
    'bank_ref_id',
    'created_at',
    'completed_at',
  ]),
};

function validateSelectProjection(
  table: string,
  projection: string
): { code: string; message: string } | null {
  const allowed = SCHEMA_COLUMNS_BY_TABLE[table];
  if (!allowed) return null;
  const trimmed = projection.trim();
  if (!trimmed || trimmed === '*') return null;
  for (const rawCol of trimmed.split(',')) {
    const col = rawCol.trim();
    if (!col || !allowed.has(col)) {
      return {
        code: '42703',
        message: `column ${table}.${col || '<empty>'} does not exist`,
      };
    }
  }
  return null;
}

const mockSupabaseClient = {
  from(table: string) {
    const filters: Array<[string, unknown]> = [];
    const neqFilters: Array<[string, unknown]> = [];
    let insertedPayload: Record<string, unknown> | null = null;
    let updatePayload: Record<string, unknown> | null = null;
    let deleteMode = false;
    let projectionError: { code?: string; message: string } | null = null;

    const resolveError = () => projectionError ?? mockTableErrors[table] ?? null;

    const matchesFilters = (row: Record<string, unknown>) =>
      filters.every(([col, val]) => row[col] === val) &&
      neqFilters.every(([col, val]) => row[col] !== val);

    const resolveRows = () => {
      if (table === 'shops') {
        return mockShops.filter((s) =>
          matchesFilters(s as unknown as Record<string, unknown>)
        );
      }
      if (table === 'shop_memberships') {
        return mockMemberships.filter((m) =>
          matchesFilters(m as unknown as Record<string, unknown>)
        );
      }
      if (table === 'profiles') {
        const idFilter = filters.find(([col]) => col === 'id')?.[1];
        if (typeof idFilter === 'string' && idFilter in mockProfiles) {
          const entry = mockProfiles[idFilter];
          if (entry && updatePayload) {
            Object.assign(entry, updatePayload);
          }
          return entry && entry.plan !== null ? [entry] : [];
        }
        return profilePlan
          ? [
              {
                id: String(idFilter || 'review-ai-owner'),
                plan:
                  typeof updatePayload?.plan === 'string'
                    ? updatePayload.plan
                    : profilePlan,
              },
            ]
          : [];
      }
      if (table === 'payment_transactions') {
        if (insertedPayload) return [insertedPayload];
        const matched = insertedTransactions.filter((tx) => matchesFilters(tx));
        if (updatePayload) {
          for (const tx of matched) {
            Object.assign(tx, updatePayload);
          }
        }
        return matched;
      }
      return [];
    };

    const chain = {
      select: (columns = '*') => {
        selectedProjections.push({ table, columns });
        projectionError = validateSelectProjection(table, columns);
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        neqFilters.push([col, val]);
        return chain;
      },
      ilike: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      upsert: async (payload: unknown) => {
        const err = resolveError();
        if (err) return { data: null, error: err };
        if (
          table === 'shop_memberships' &&
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload)
        ) {
          const record = payload as Record<string, unknown>;
          const nextRow = {
            id: String(record.id || `mem-${record.shop_id}-${record.user_id}`),
            shop_id: String(record.shop_id),
            user_id: String(record.user_id),
            role: String(record.role || 'staff'),
            is_active: record.is_active !== false,
          };
          const idx = mockMemberships.findIndex(
            (m) =>
              m.shop_id === nextRow.shop_id && m.user_id === nextRow.user_id
          );
          if (idx !== -1) mockMemberships[idx] = nextRow;
          else mockMemberships.push(nextRow);
          return { data: [nextRow], error: null };
        }
        return { data: payload, error: null };
      },
      delete: () => {
        deleteMode = true;
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload ? { ...payload } : null;
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        if (table === 'payment_transactions' && payload && !Array.isArray(payload)) {
          insertedPayload = { ...payload };
          insertedTransactions.push(insertedPayload);
        }
        return chain;
      },
      single: async () => {
        const err = resolveError();
        if (err) return { data: null, error: err };
        const rows = resolveRows();
        return { data: rows[0] ?? null, error: null };
      },
      maybeSingle: async () => {
        const err = resolveError();
        if (err) return { data: null, error: err };
        const rows = resolveRows();
        return { data: rows[0] ?? null, error: null };
      },
      then: (
        onFulfilled: (val: {
          data: unknown[] | null;
          error: { code?: string; message: string } | null;
          count?: number | null;
        }) => unknown,
        onRejected?: (err: unknown) => unknown
      ) => {
        const err = resolveError();
        if (err) {
          return Promise.resolve({ data: null, error: err, count: null }).then(
            onFulfilled,
            onRejected
          );
        }
        if (deleteMode && table === 'shop_memberships') {
          const before = mockMemberships.length;
          mockMemberships = mockMemberships.filter(
            (m) => !matchesFilters(m as unknown as Record<string, unknown>)
          );
          return Promise.resolve({
            data: [],
            error: null,
            count: before - mockMemberships.length,
          }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: resolveRows(), error: null }).then(
          onFulfilled,
          onRejected
        );
      },
    };
    return chain;
  },
  auth: { getUser: async () => ({ data: { user: null }, error: new Error('no') }) },
};

setSupabaseDbClientForTests(mockSupabaseClient);
setShopMembershipDbClientForTest(mockSupabaseClient as never);
after(() => {
  setSupabaseDbClientForTests(null);
  setShopMembershipDbClientForTest(null);
  process.chdir(originalCwd);
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});
beforeEach(() => {
  resetAiRateLimitsForTest();
  profilePlan = 'free';
  mockProfiles = {};
  mockMemberships = [];
  mockTableErrors = {};
  selectedProjections.length = 0;
  insertedTransactions.length = 0;
});

function post(path: string, token: string | null, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ownerToken = issueSessionToken({
  id: 'review-ai-owner',
  email: 'ai-owner@example.test',
  role: 'owner',
});

test('formatPlanLimitError maps PLAN_LIMIT_REACHED to localized message + billing link', () => {
  const reason = canAddMoreItems('free', 5).reason;
  assert.ok(reason);
  const vi = formatPlanLimitError({ error: reason }, 'vi');
  assert.ok(vi);
  assert.equal(vi.code, 'PLAN_LIMIT_REACHED');
  assert.equal(vi.upgradeHref, BILLING_UPGRADE_HREF);
  assert.match(vi.message, /5/);
  const en = formatPlanLimitError(new Error(reason), 'en');
  assert.ok(en && /upgrade/i.test(en.message));
  assert.equal(formatPlanLimitError('Network down', 'vi'), null);
  assert.equal(parsePlanErrorCode({ code: 'PLAN_FEATURE_LOCKED', error: 'x' }), 'PLAN_FEATURE_LOCKED');
  assert.equal(isPlanLimitError('PLAN_LIMIT_REACHED'), true);
  assert.equal(canUseAiOcr('premium'), true);
  assert.equal(canUseAiOcr('basic'), false);
  assert.equal(canUseAiOcr(null), false);
});

test('/api/ai/translate requires an authenticated user', async () => {
  const res = await translatePost(
    post('/api/ai/translate', null, { itemNameVi: 'Phở bò' })
  );
  assert.equal(res.status, 401);
});

test('/api/ai/translate rate limits per user with 429', async () => {
  const max = AI_RATE_LIMITS.translate.max;
  // Empty itemNameVi -> 400 after the guard consumed quota (avoids any network AI call).
  for (let i = 0; i < max; i += 1) {
    const ok = await translatePost(
      post('/api/ai/translate', ownerToken, { itemNameVi: '' })
    );
    assert.equal(ok.status, 400);
  }
  const limited = await translatePost(
    post('/api/ai/translate', ownerToken, { itemNameVi: 'Phở bò' })
  );
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('Retry-After'));
});

test('/api/ai/ocr-menu requires auth and gates real OCR by plan allowAiOcr', async () => {
  const anon = await ocrPost(post('/api/ai/ocr-menu', null, { useDemo: true }));
  assert.equal(anon.status, 401);

  profilePlan = 'free';
  const locked = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, { rawOcrText: 'CA PHE DEN 25K' })
  );
  assert.equal(locked.status, 403);
  const lockedBody = await locked.json();
  assert.equal(lockedBody.code, 'PLAN_FEATURE_LOCKED');

  profilePlan = null; // unknown plan -> fail closed
  const unknown = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, { rawOcrText: 'CA PHE DEN 25K' })
  );
  assert.equal(unknown.status, 403);

  profilePlan = 'premium';
  // Empty payload -> 400 validation error *after* the plan gate passed (no network AI call).
  const allowed = await ocrPost(post('/api/ai/ocr-menu', ownerToken, {}));
  assert.equal(allowed.status, 400);
});

test('/api/ai/ocr-menu rate limits at 10 requests per window', async () => {
  profilePlan = 'free';
  for (let i = 0; i < AI_RATE_LIMITS.ocr.max; i += 1) {
    const demo = await ocrPost(
      post('/api/ai/ocr-menu', ownerToken, { useDemo: true, vertical: 'fnb' })
    );
    assert.equal(demo.status, 200);
  }
  const limited = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, { useDemo: true, vertical: 'fnb' })
  );
  assert.equal(limited.status, 429);
});

test('/api/ai/ocr-menu enforces server-resolved authorized shop owner plan instead of member profile plan', async () => {
  // 1. Free-plan staff member on a Premium owner's shop is ALLOWED (both with explicit shopId and unambiguous membership)
  mockProfiles['review-ai-owner'] = {
    id: 'review-ai-owner',
    plan: 'premium',
  };
  mockProfiles['staff-free-profile'] = {
    id: 'staff-free-profile',
    plan: 'free',
  };
  mockMemberships.push({
    id: 'mem-staff-premium-shop',
    shop_id: 'shop-review-owner',
    user_id: 'staff-free-profile',
    role: 'staff',
    permissions: ['catalog.manage', 'orders.view'],
    is_active: true,
  });

  const freeStaffToken = issueSessionToken({
    id: 'staff-free-profile',
    email: 'staff-free@qlaok.vn',
    role: 'staff',
  });

  // Explicit shopId -> passes plan gate (returns 400 for empty OCR input after plan check)
  const memberOnPremiumShopRes = await ocrPost(
    post('/api/ai/ocr-menu', freeStaffToken, {
      shopId: 'shop-review-owner',
    })
  );
  assert.equal(memberOnPremiumShopRes.status, 400);

  // Unambiguous single active membership when shopId is omitted -> also resolves shop owner's premium plan
  const memberImplicitShopRes = await ocrPost(
    post('/api/ai/ocr-menu', freeStaffToken, {})
  );
  assert.equal(memberImplicitShopRes.status, 400);

  // 2. Premium-plan member working on a Free/Basic owner's shop is REJECTED with 403 PLAN_FEATURE_LOCKED
  mockProfiles['owner-demo-001'] = {
    id: 'owner-demo-001',
    plan: 'basic',
  };
  mockProfiles['member-with-own-premium'] = {
    id: 'member-with-own-premium',
    plan: 'premium',
  };
  mockMemberships.push({
    id: 'mem-premium-user-on-basic-shop',
    shop_id: 'shop-fnb-001',
    user_id: 'member-with-own-premium',
    role: 'staff',
    permissions: ['catalog.manage'],
    is_active: true,
  });

  const premiumMemberToken = issueSessionToken({
    id: 'member-with-own-premium',
    email: 'premium-member@qlaok.vn',
    role: 'staff',
  });

  const memberOnBasicShopExplicit = await ocrPost(
    post('/api/ai/ocr-menu', premiumMemberToken, {
      shopId: 'shop-fnb-001',
      rawOcrText: 'CA PHE DEN 25K',
      // Forged client claims must be ignored by the server:
      ownerId: 'member-with-own-premium',
      owner_id: 'review-ai-owner',
      plan: 'premium',
    })
  );
  assert.equal(memberOnBasicShopExplicit.status, 403);
  const basicLockedBody = await memberOnBasicShopExplicit.json();
  assert.equal(basicLockedBody.code, 'PLAN_FEATURE_LOCKED');

  const memberOnBasicShopImplicit = await ocrPost(
    post('/api/ai/ocr-menu', premiumMemberToken, {
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(memberOnBasicShopImplicit.status, 403);
  const basicImplicitBody = await memberOnBasicShopImplicit.json();
  assert.equal(basicImplicitBody.code, 'PLAN_FEATURE_LOCKED');

  // 3. Multi-shop user who owns a Premium shop ('shop-review-owner') AND is a member of a Basic shop ('shop-fnb-001')
  mockMemberships.push({
    id: 'mem-owner-as-staff-on-basic-shop',
    shop_id: 'shop-fnb-001',
    user_id: 'review-ai-owner',
    role: 'staff',
    permissions: ['catalog.manage'],
    is_active: true,
  });

  // Targeting the Basic shop -> 403 PLAN_FEATURE_LOCKED (uses shop-fnb-001 owner's basic plan, NOT caller's premium plan)
  const multiShopBasicTarget = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      shopId: 'shop-fnb-001',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(multiShopBasicTarget.status, 403);
  assert.equal((await multiShopBasicTarget.json()).code, 'PLAN_FEATURE_LOCKED');

  // Targeting their own Premium shop -> passes plan gate (400 empty input)
  const multiShopPremiumTarget = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      shopId: 'shop-review-owner',
    })
  );
  assert.equal(multiShopPremiumTarget.status, 400);

  // Omitting shopId when authorized across multiple distinct shop owners -> fails closed (403 AMBIGUOUS_SHOP_CONTEXT)
  const multiShopAmbiguous = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(multiShopAmbiguous.status, 403);
  assert.equal(
    (await multiShopAmbiguous.json()).code,
    'AMBIGUOUS_SHOP_CONTEXT'
  );
});

test('/api/ai/ocr-menu rejects unauthorized, inactive-member, insufficient-permission, invalid-shopId, and DB-error requests', async () => {
  mockProfiles['review-ai-owner'] = {
    id: 'review-ai-owner',
    plan: 'premium',
  };
  mockProfiles['outsider-user'] = {
    id: 'outsider-user',
    plan: 'free',
  };

  const outsiderToken = issueSessionToken({
    id: 'outsider-user',
    email: 'outsider@qlaok.vn',
    role: 'owner',
  });

  // 1. Outsider targeting a Premium shop they do not own or belong to -> 403 FORBIDDEN_SHOP_ACCESS
  const crossShopRes = await ocrPost(
    post('/api/ai/ocr-menu', outsiderToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(crossShopRes.status, 403);
  assert.equal((await crossShopRes.json()).code, 'FORBIDDEN_SHOP_ACCESS');

  // 2. Deactivated member (is_active: false) on a Premium shop -> 403 FORBIDDEN_SHOP_ACCESS
  mockMemberships.push({
    id: 'mem-inactive-staff',
    shop_id: 'shop-review-owner',
    user_id: 'outsider-user',
    role: 'staff',
    permissions: ['catalog.manage'],
    is_active: false,
  });
  const inactiveRes = await ocrPost(
    post('/api/ai/ocr-menu', outsiderToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(inactiveRes.status, 403);
  assert.equal((await inactiveRes.json()).code, 'FORBIDDEN_SHOP_ACCESS');

  // 3. Active cashier without catalog.manage permission -> 403 INSUFFICIENT_SHOP_PERMISSION
  mockMemberships[0] = {
    id: 'mem-cashier-no-catalog',
    shop_id: 'shop-review-owner',
    user_id: 'outsider-user',
    role: 'cashier',
    permissions: ['orders.view', 'orders.manage'],
    is_active: true,
  };
  const cashierRes = await ocrPost(
    post('/api/ai/ocr-menu', outsiderToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(cashierRes.status, 403);
  assert.equal(
    (await cashierRes.json()).code,
    'INSUFFICIENT_SHOP_PERMISSION'
  );

  // 4. Invalid shopId type or blank string -> 400 INVALID_SHOP_ID
  const badShopIdRes = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      shopId: 99999,
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(badShopIdRes.status, 400);
  assert.equal((await badShopIdRes.json()).code, 'INVALID_SHOP_ID');

  // 5. Nonexistent shopId -> 404 SHOP_NOT_FOUND
  const missingShopRes = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      shopId: 'shop-nonexistent-999',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(missingShopRes.status, 404);
  assert.equal((await missingShopRes.json()).code, 'SHOP_NOT_FOUND');

  // 6. DB failure on shops or shop_memberships fails closed with 403
  resetAiRateLimitsForTest();
  mockTableErrors.shops = { code: 'XX000', message: 'db down' };
  const dbFailRes = await ocrPost(
    post('/api/ai/ocr-menu', ownerToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(dbFailRes.status, 403);
  assert.equal((await dbFailRes.json()).code, 'AI_SHOP_AUTH_CHECK_FAILED');
});

test('isMembershipAllowedForCatalogAi and /api/ai/ocr-menu enforce canonical role defaults for null permissions, fail closed on unknown roles, allow explicit catalog.manage or active owner, and deny inactive memberships', async () => {
  mockProfiles['review-ai-owner'] = {
    id: 'review-ai-owner',
    plan: 'premium',
  };

  // Unit assertions on isMembershipAllowedForCatalogAi:
  // 1. Active staff/cashier with null or omitted permissions -> denied (role defaults lack catalog.manage)
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-staff-null',
      shop_id: 'shop-review-owner',
      user_id: 'u-staff',
      role: 'staff',
      permissions: null,
      is_active: true,
    }),
    false
  );
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-cashier-null',
      shop_id: 'shop-review-owner',
      user_id: 'u-cashier',
      role: 'cashier',
      permissions: null,
      is_active: true,
    }),
    false
  );
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-staff-undef',
      shop_id: 'shop-review-owner',
      user_id: 'u-staff',
      role: 'staff',
      is_active: true,
    }),
    false
  );

  // 2. Active staff/cashier with explicit catalog.manage -> allowed
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-staff-explicit',
      shop_id: 'shop-review-owner',
      user_id: 'u-staff',
      role: 'staff',
      permissions: ['catalog.manage'],
      is_active: true,
    }),
    true
  );
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-cashier-explicit',
      shop_id: 'shop-review-owner',
      user_id: 'u-cashier',
      role: 'cashier',
      permissions: ['orders.view', 'catalog.manage'],
      is_active: true,
    }),
    true
  );

  // 3. Active owner -> allowed regardless of permissions array/null
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-owner-null',
      shop_id: 'shop-review-owner',
      user_id: 'u-owner',
      role: 'owner',
      permissions: null,
      is_active: true,
    }),
    true
  );
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-owner-empty',
      shop_id: 'shop-review-owner',
      user_id: 'u-owner',
      role: 'owner',
      permissions: [],
      is_active: true,
    }),
    true
  );

  // 4. Inactive memberships -> denied even for owner or explicit catalog.manage
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-owner-inactive',
      shop_id: 'shop-review-owner',
      user_id: 'u-owner',
      role: 'owner',
      permissions: null,
      is_active: false,
    }),
    false
  );
  assert.equal(
    isMembershipAllowedForCatalogAi({
      id: 'mem-staff-inactive',
      shop_id: 'shop-review-owner',
      user_id: 'u-staff',
      role: 'staff',
      permissions: ['catalog.manage'],
      is_active: false,
    }),
    false
  );

  // 5. Unknown roles -> fail closed even with null or explicit catalog.manage permissions
  for (const unknownRole of ['manager', 'viewer', 'admin', '']) {
    assert.equal(
      isMembershipAllowedForCatalogAi({
        id: `mem-unknown-${unknownRole}`,
        shop_id: 'shop-review-owner',
        user_id: 'u-unknown',
        role: unknownRole,
        permissions: null,
        is_active: true,
      }),
      false
    );
    assert.equal(
      isMembershipAllowedForCatalogAi({
        id: `mem-unknown-explicit-${unknownRole}`,
        shop_id: 'shop-review-owner',
        user_id: 'u-unknown',
        role: unknownRole,
        permissions: ['catalog.manage'],
        is_active: true,
      }),
      false
    );
  }

  // Route-level regression assertions against /api/ai/ocr-menu on a Premium owner's shop:
  const memberId = 'member-role-defaults-01';
  mockProfiles[memberId] = { id: memberId, plan: 'free' };
  const memberToken = issueSessionToken({
    id: memberId,
    email: 'member-defaults@qlaok.vn',
    role: 'staff',
  });

  // Active staff with permissions: null -> 403 INSUFFICIENT_SHOP_PERMISSION (explicit shopId) and 403 FORBIDDEN_SHOP_ACCESS (implicit)
  mockMemberships = [
    {
      id: 'mem-route-staff-null',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'staff',
      permissions: null,
      is_active: true,
    },
  ];
  const staffNullExplicit = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(staffNullExplicit.status, 403);
  assert.equal(
    (await staffNullExplicit.json()).code,
    'INSUFFICIENT_SHOP_PERMISSION'
  );

  const staffNullImplicit = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(staffNullImplicit.status, 403);
  assert.equal((await staffNullImplicit.json()).code, 'FORBIDDEN_SHOP_ACCESS');

  // Active cashier with permissions: null -> 403 INSUFFICIENT_SHOP_PERMISSION
  mockMemberships = [
    {
      id: 'mem-route-cashier-null',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'cashier',
      permissions: null,
      is_active: true,
    },
  ];
  const cashierNullExplicit = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(cashierNullExplicit.status, 403);
  assert.equal(
    (await cashierNullExplicit.json()).code,
    'INSUFFICIENT_SHOP_PERMISSION'
  );

  // Unknown role with explicit catalog.manage -> 403 INSUFFICIENT_SHOP_PERMISSION (fails closed)
  mockMemberships = [
    {
      id: 'mem-route-unknown-role',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'manager',
      permissions: ['catalog.manage'],
      is_active: true,
    },
  ];
  const unknownRoleRes = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(unknownRoleRes.status, 403);
  assert.equal(
    (await unknownRoleRes.json()).code,
    'INSUFFICIENT_SHOP_PERMISSION'
  );

  // Active cashier with explicit catalog.manage -> passes guard (returns 400 on empty OCR input)
  resetAiRateLimitsForTest();
  mockMemberships = [
    {
      id: 'mem-route-cashier-explicit',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'cashier',
      permissions: ['catalog.manage'],
      is_active: true,
    },
  ];
  const cashierExplicitAllowed = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
    })
  );
  assert.equal(cashierExplicitAllowed.status, 400);

  // Active owner membership with permissions: null -> passes guard (returns 400 on empty OCR input)
  mockMemberships = [
    {
      id: 'mem-route-owner-null',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'owner',
      permissions: null,
      is_active: true,
    },
  ];
  const ownerMembershipAllowed = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
    })
  );
  assert.equal(ownerMembershipAllowed.status, 400);

  // Inactive owner membership -> 403 FORBIDDEN_SHOP_ACCESS
  mockMemberships = [
    {
      id: 'mem-route-owner-inactive',
      shop_id: 'shop-review-owner',
      user_id: memberId,
      role: 'owner',
      permissions: null,
      is_active: false,
    },
  ];
  const inactiveOwnerDenied = await ocrPost(
    post('/api/ai/ocr-menu', memberToken, {
      shopId: 'shop-review-owner',
      rawOcrText: 'CA PHE DEN 25K',
    })
  );
  assert.equal(inactiveOwnerDenied.status, 403);
  assert.equal((await inactiveOwnerDenied.json()).code, 'FORBIDDEN_SHOP_ACCESS');
});

test('payment webhook: owner simulateWebhook is not accepted without PAYMENT_DEV_SIMULATE, and provider webhook / dev simulation enforce secret and ownership', async () => {
  const previousSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  const previousSim = process.env.PAYMENT_DEV_SIMULATE;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  delete process.env.PAYMENT_DEV_SIMULATE;
  try {
    // 1. Without PAYMENT_DEV_SIMULATE or PAYMENT_WEBHOOK_SECRET -> 503
    const res = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        orderCode: 'QLAOKP99999',
        simulateWebhook: true,
      })
    );
    assert.equal(res.status, 503);

    // Create two pending orders: one for review-ai-owner, one for owner-demo-001
    const createOwnRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(createOwnRes.status, 201);
    const { transaction: ownTx } = await createOwnRes.json();

    const otherOwnerToken = issueSessionToken({
      id: 'owner-demo-001',
      email: 'chuquan@qlaok.vn',
      role: 'owner',
    });
    const createOtherRes = await paymentPost(
      post('/api/webhooks/payment', otherOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(createOtherRes.status, 201);
    const { transaction: otherTx } = await createOtherRes.json();

    // 2. With PAYMENT_DEV_SIMULATE=true, owner can simulate own pending order (200),
    //    cannot simulate another owner's order (403), and cashier cannot simulate (503).
    process.env.PAYMENT_DEV_SIMULATE = 'true';
    const crossSimRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        orderCode: otherTx.order_code,
        simulateWebhook: true,
      })
    );
    assert.equal(crossSimRes.status, 403);

    const cashierToken = issueSessionToken({
      id: 'cashier-sim-01',
      email: 'cashier-sim@qlaok.vn',
      role: 'cashier',
    });
    const cashierSimRes = await paymentPost(
      post('/api/webhooks/payment', cashierToken, {
        orderCode: ownTx.order_code,
        simulateWebhook: true,
      })
    );
    assert.equal(cashierSimRes.status, 503);

    const ownSimRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        orderCode: ownTx.order_code,
        simulateWebhook: true,
        transferAmount: 39000,
      })
    );
    assert.equal(ownSimRes.status, 200);
    const ownSimBody = await ownSimRes.json();
    assert.equal(ownSimBody.success, true);

    // 3. Provider webhook requires valid x-webhook-secret when PAYMENT_DEV_SIMULATE is off
    delete process.env.PAYMENT_DEV_SIMULATE;
    process.env.PAYMENT_WEBHOOK_SECRET = 'whsec-short-test';

    const badSecretRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'wrong-secret',
        },
        body: JSON.stringify({
          orderCode: otherTx.order_code,
          transferAmount: 69000,
        }),
      })
    );
    assert.equal(badSecretRes.status, 401);

    const validProviderRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-short-test',
        },
        body: JSON.stringify({
          orderCode: otherTx.order_code,
          transferAmount: 69000,
          referenceCode: 'BANK-REF-REVIEW-01',
        }),
      })
    );
    assert.equal(validProviderRes.status, 200);
    const validProviderBody = await validProviderRes.json();
    assert.equal(validProviderBody.success, true);
  } finally {
    if (previousSecret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = previousSecret;
    if (previousSim === undefined) delete process.env.PAYMENT_DEV_SIMULATE;
    else process.env.PAYMENT_DEV_SIMULATE = previousSim;
  }
});

test('POST /api/webhooks/payment create_order rejects anonymous and invalid tokens with 401', async () => {
  const anonRes = await paymentPost(
    post('/api/webhooks/payment', null, {
      action: 'create_order',
      targetPlan: 'premium',
    })
  );
  assert.equal(anonRes.status, 401);

  const expiredToken = issueSessionToken(
    { id: 'review-ai-owner', email: 'ai-owner@example.test', role: 'owner' },
    -10
  );
  const expiredRes = await paymentPost(
    post('/api/webhooks/payment', expiredToken, {
      action: 'create_order',
      targetPlan: 'basic',
    })
  );
  assert.equal(expiredRes.status, 401);
  assert.equal(insertedTransactions.length, 0);
});

test('POST /api/webhooks/payment create_order rejects cashier and staff roles with 403 across membership and session semantics', async () => {
  const cashierMemberId = 'cashier-billing-review-01';
  const staffMemberId = 'staff-billing-review-01';

  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: cashierMemberId,
    email: 'cashier-billing@qlaok.vn',
    role: 'cashier',
  });
  await dbUpsertShopMembership({
    shop_id: 'shop-fnb-001',
    user_id: staffMemberId,
    email: 'staff-billing@qlaok.vn',
    role: 'staff',
  });

  try {
    // Even when /api/auth issues role='owner' on the session token and the user has a profile row
    // in public.profiles (schema: id, email, plan), active cashier/staff membership without shop
    // ownership must be denied (403).
    mockProfiles[cashierMemberId] = {
      id: cashierMemberId,
      email: 'cashier-billing@qlaok.vn',
      plan: 'free',
    };
    mockProfiles[staffMemberId] = {
      id: staffMemberId,
      email: 'staff-billing@qlaok.vn',
      plan: 'free',
    };

    const cashierSessionAsOwner = issueSessionToken({
      id: cashierMemberId,
      email: 'cashier-billing@qlaok.vn',
      role: 'owner',
    });
    const staffSessionAsOwner = issueSessionToken({
      id: staffMemberId,
      email: 'staff-billing@qlaok.vn',
      role: 'owner',
    });

    const cashierRes = await paymentPost(
      post('/api/webhooks/payment', cashierSessionAsOwner, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(cashierRes.status, 403);
    const cashierBody = await cashierRes.json();
    assert.equal(cashierBody.code, 'INSUFFICIENT_BILLING_PERMISSION');

    const staffRes = await paymentPost(
      post('/api/webhooks/payment', staffSessionAsOwner, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(staffRes.status, 403);
    const staffBody = await staffRes.json();
    assert.equal(staffBody.code, 'INSUFFICIENT_BILLING_PERMISSION');

    // Cashier/staff trying to create a billing order targeting their shop owner's ownerId -> 403
    const staffTargetOwnerRes = await paymentPost(
      post('/api/webhooks/payment', staffSessionAsOwner, {
        action: 'create_order',
        targetPlan: 'premium',
        ownerId: 'owner-demo-001',
      })
    );
    assert.equal(staffTargetOwnerRes.status, 403);
    const staffTargetOwnerBody = await staffTargetOwnerRes.json();
    assert.equal(staffTargetOwnerBody.code, 'FORBIDDEN_OWNER_TARGET');

    // Explicit cashier/staff role in session token -> 403
    const explicitCashierToken = issueSessionToken({
      id: 'cashier-token-only',
      email: 'cashier-token@qlaok.vn',
      role: 'cashier',
    });
    const explicitCashierRes = await paymentPost(
      post('/api/webhooks/payment', explicitCashierToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(explicitCashierRes.status, 403);

    // Authenticated user with active DB shop_memberships role='staff' (plus own profile row) -> 403
    const dbStaffId = 'db-staff-member-only';
    mockProfiles[dbStaffId] = {
      id: dbStaffId,
      email: 'db-staff@qlaok.vn',
      plan: 'free',
    };
    mockMemberships.push({
      id: 'mem-db-staff-01',
      shop_id: 'shop-fnb-001',
      user_id: dbStaffId,
      role: 'staff',
      is_active: true,
    });
    const dbStaffToken = issueSessionToken({
      id: dbStaffId,
      email: 'db-staff@qlaok.vn',
      role: 'owner',
    });
    const dbStaffRes = await paymentPost(
      post('/api/webhooks/payment', dbStaffToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(dbStaffRes.status, 403);
    const dbStaffBody = await dbStaffRes.json();
    assert.equal(dbStaffBody.code, 'INSUFFICIENT_BILLING_PERMISSION');

    // Authenticated user with no shop ownership, no owner membership, and no profile row -> 403
    mockProfiles['no-profile-user'] = null;
    const noProfileToken = issueSessionToken({
      id: 'no-profile-user',
      email: 'noprofile@qlaok.vn',
      role: 'owner',
    });
    const noProfileRes = await paymentPost(
      post('/api/webhooks/payment', noProfileToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(noProfileRes.status, 403);
    const noProfileBody = await noProfileRes.json();
    assert.equal(noProfileBody.code, 'INSUFFICIENT_BILLING_PERMISSION');

    assert.equal(insertedTransactions.length, 0);
  } finally {
    await dbDeleteShopMembership('shop-fnb-001', cashierMemberId);
    await dbDeleteShopMembership('shop-fnb-001', staffMemberId);
  }
});

test('POST /api/webhooks/payment create_order queries only real public.profiles schema columns, allows own-profile owners before shop creation, and fails closed on DB lookup errors', async () => {
  // Newly registered owner in public.profiles (001_init_qlaok.sql columns only: no role, no is_admin)
  // who has not yet created a shop in public.shops.
  const onboardingOwnerId = 'onboarding-owner-001';
  mockProfiles[onboardingOwnerId] = {
    id: onboardingOwnerId,
    email: 'new-owner@qlaok.vn',
    full_name: 'Chủ Quán Mới Đăng Ký',
    phone: '0909000111',
    plan: 'free',
  };
  const onboardingOwnerToken = issueSessionToken({
    id: onboardingOwnerId,
    email: 'new-owner@qlaok.vn',
    role: 'owner',
  });

  selectedProjections.length = 0;
  const res = await paymentPost(
    post('/api/webhooks/payment', onboardingOwnerToken, {
      action: 'create_order',
      targetPlan: 'premium',
      amount: 100, // forged client amount must be ignored
    })
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.transaction.user_id, onboardingOwnerId);
  assert.equal(body.transaction.target_plan, 'premium');
  assert.equal(body.transaction.amount, 69000);
  assert.equal(insertedTransactions.length, 1);

  // Verify every SELECT projection against 001_init_qlaok.sql & 004_memberships_billing_payments_audit.sql
  // and ensure shop_memberships is only queried once per create_order authorization check.
  const membershipQueries = selectedProjections.filter(
    (q) => q.table === 'shop_memberships'
  );
  assert.equal(
    membershipQueries.length,
    1,
    'Must read shop_memberships only once during billing authorization'
  );
  const profileQueries = selectedProjections.filter((q) => q.table === 'profiles');
  assert.ok(profileQueries.length > 0, 'Must query public.profiles during billing authorization');
  for (const q of selectedProjections) {
    assert.equal(
      validateSelectProjection(q.table, q.columns),
      null,
      `Invalid schema projection on ${q.table}: ${q.columns}`
    );
  }
  for (const q of profileQueries) {
    const cols = q.columns.split(',').map((c) => c.trim());
    assert.ok(!cols.includes('role'), 'public.profiles has no role column');
    assert.ok(!cols.includes('is_admin'), 'public.profiles has no is_admin column');
  }
  assert.ok(
    validateSelectProjection('profiles', 'id, email, role, is_admin, plan') !== null,
    'Schema validator must reject nonexistent profiles.role / profiles.is_admin columns'
  );

  // Real DB lookup failure on profiles / shops / shop_memberships must fail closed with 403 BILLING_AUTH_CHECK_FAILED
  for (const failingTable of ['profiles', 'shops', 'shop_memberships']) {
    mockTableErrors = {
      [failingTable]: {
        code: '42703',
        message: `Simulated PostgREST error on ${failingTable}`,
      },
    };
    const failRes = await paymentPost(
      post('/api/webhooks/payment', onboardingOwnerToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(failRes.status, 403, `Expected 403 when ${failingTable} lookup fails`);
    const failBody = await failRes.json();
    assert.equal(failBody.code, 'BILLING_AUTH_CHECK_FAILED');
  }
  assert.equal(insertedTransactions.length, 1);
});

test('POST /api/webhooks/payment create_order allows authenticated owner for self with authoritative pricing and blocks ownerId spoofing', async () => {
  // Owner creates basic order for self (forged client amount=1 is ignored in favor of 39000)
  const selfRes = await paymentPost(
    post('/api/webhooks/payment', ownerToken, {
      action: 'create_order',
      targetPlan: 'basic',
      amount: 1,
      ownerId: 'review-ai-owner',
    })
  );
  assert.equal(selfRes.status, 201);
  const selfBody = await selfRes.json();
  assert.equal(selfBody.transaction.user_id, 'review-ai-owner');
  assert.equal(selfBody.transaction.target_plan, 'basic');
  assert.equal(selfBody.transaction.amount, 39000);
  assert.equal(selfBody.transaction.status, 'pending');
  assert.equal(insertedTransactions.length, 1);

  // Owner attempting to spoof another ownerId (even with forged admin claims in body/headers) -> 403
  const spoofReq = new Request('http://localhost/api/webhooks/payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerToken}`,
      'x-admin-email': SUPER_ADMIN_EMAIL,
    },
    body: JSON.stringify({
      action: 'create_order',
      targetPlan: 'premium',
      ownerId: 'victim-owner-999',
      role: 'admin',
      is_admin: true,
      adminEmail: SUPER_ADMIN_EMAIL,
    }),
  });
  const spoofRes = await paymentPost(spoofReq);
  assert.equal(spoofRes.status, 403);
  const spoofBody = await spoofRes.json();
  assert.equal(spoofBody.code, 'FORBIDDEN_OWNER_TARGET');

  // Optional shopId must pass requireShopOwnerOrAdmin (own shop -> 201, cross-owner shop -> 403, non-string shopId -> 400)
  const crossShopRes = await paymentPost(
    post('/api/webhooks/payment', ownerToken, {
      action: 'create_order',
      targetPlan: 'basic',
      shopId: 'shop-fnb-001',
    })
  );
  assert.equal(crossShopRes.status, 403);

  const badShopIdRes = await paymentPost(
    post('/api/webhooks/payment', ownerToken, {
      action: 'create_order',
      targetPlan: 'basic',
      shopId: 12345,
    })
  );
  assert.equal(badShopIdRes.status, 400);

  const ownShopRes = await paymentPost(
    post('/api/webhooks/payment', ownerToken, {
      action: 'create_order',
      targetPlan: 'basic',
      shopId: 'shop-review-owner',
    })
  );
  assert.equal(ownShopRes.status, 201);

  // User who is staff in one shop but active owner in another shop is still permitted
  mockMemberships.push(
    {
      id: 'mem-multi-staff',
      shop_id: 'shop-fnb-001',
      user_id: 'multi-shop-owner-01',
      role: 'staff',
      is_active: true,
    },
    {
      id: 'mem-multi-owner',
      shop_id: 'shop-review-owner',
      user_id: 'multi-shop-owner-01',
      role: 'owner',
      is_active: true,
    }
  );
  const multiOwnerToken = issueSessionToken({
    id: 'multi-shop-owner-01',
    email: 'multi-owner@qlaok.vn',
    role: 'owner',
  });
  const multiOwnerRes = await paymentPost(
    post('/api/webhooks/payment', multiOwnerToken, {
      action: 'create_order',
      targetPlan: 'premium',
    })
  );
  assert.equal(multiOwnerRes.status, 201);
  assert.equal(insertedTransactions.length, 3);
});

test('POST /api/webhooks/payment create_order allows verified Super Admin to target another ownerId and rejects invalid plans', async () => {
  const adminToken = issueSessionToken({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
    is_admin: true,
  });

  // Super Admin targets another merchant ownerId
  const targetRes = await paymentPost(
    post('/api/webhooks/payment', adminToken, {
      action: 'create_order',
      targetPlan: 'premium',
      ownerId: 'merchant-target-007',
      amount: 500,
    })
  );
  assert.equal(targetRes.status, 201);
  const targetBody = await targetRes.json();
  assert.equal(targetBody.transaction.user_id, 'merchant-target-007');
  assert.equal(targetBody.transaction.target_plan, 'premium');
  assert.equal(targetBody.transaction.amount, 69000);

  // Invalid targetPlan values (free, unknown tier, empty string, null) are rejected with 400
  for (const invalidPlan of ['free', 'enterprise', '', null]) {
    const badPlanRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        action: 'create_order',
        targetPlan: invalidPlan,
      })
    );
    assert.equal(
      badPlanRes.status,
      400,
      `Expected 400 for invalid targetPlan=${String(invalidPlan)}`
    );
    const badPlanBody = await badPlanRes.json();
    assert.equal(badPlanBody.code, 'INVALID_TARGET_PLAN');
  }
  assert.equal(insertedTransactions.length, 1);
});
