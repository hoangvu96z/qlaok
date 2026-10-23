import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import React from 'react';
import type { PaymentTransaction } from '@/types/qlaok';

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
const { POST: paymentPost, GET: paymentGet } = await import(
  '@/app/api/webhooks/payment/route'
);
const { canReopenPaymentTransaction, buildBillingColumns } = await import(
  '@/lib/billing-table'
);

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
let mockRpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let mockRpcHandler:
  | ((
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>)
  | null = null;
let mockRpcError: { message: string } | null = null;

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
  rpc: async (fn: string, args: Record<string, unknown>) => {
    mockRpcCalls.push({ name: fn, args: { ...args } });
    if (mockRpcHandler) {
      return mockRpcHandler(fn, args);
    }
    if (mockRpcError) {
      return { data: null, error: mockRpcError };
    }
    if (fn === 'complete_payment_webhook_atomic') {
      const orderCode = String(args.p_order_code || '').trim().toUpperCase();
      const tx = insertedTransactions.find(
        (t) => String(t.order_code || '').trim().toUpperCase() === orderCode
      );
      if (!tx) {
        return {
          data: null,
          error: {
            message: `PAYMENT_ORDER_NOT_FOUND: Không tìm thấy đơn thanh toán "${orderCode}".`,
          },
        };
      }
      if (tx.status === 'completed') {
        const profile = mockProfiles[String(tx.user_id)];
        return {
          data: {
            status: 'already_completed',
            owner_id: tx.user_id,
            target_plan: tx.target_plan,
            plan_expires_at:
              profile && 'plan_expires_at' in profile
                ? (profile as Record<string, unknown>).plan_expires_at
                : new Date().toISOString(),
            order_code: tx.order_code,
            bank_ref_id: tx.bank_ref_id,
          },
          error: null,
        };
      }
      if (tx.status !== 'pending') {
        return {
          data: null,
          error: {
            message: `PAYMENT_ORDER_NOT_PENDING: Trạng thái đơn thanh toán là "${tx.status}", không thể hoàn tất.`,
          },
        };
      }
      const allowUnverified = Boolean(args.p_allow_unverified_amount);
      const verifiedAmount = args.p_verified_transfer_amount;
      if (!allowUnverified) {
        if (
          verifiedAmount === null ||
          verifiedAmount === undefined ||
          Number(verifiedAmount) <= 0 ||
          !Number.isFinite(Number(verifiedAmount))
        ) {
          return {
            data: null,
            error: {
              message:
                'PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản không hợp lệ (phải là số dương lớn hơn 0).',
            },
          };
        }
        if (Number(verifiedAmount) < Number(tx.amount || 0)) {
          return {
            data: null,
            error: {
              message: `PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản (${verifiedAmount}) nhỏ hơn số tiền gói cước yêu cầu (${tx.amount}).`,
            },
          };
        }
      }
      const bankRef = String(args.p_bank_ref_id || '').trim();
      if (!bankRef) {
        return {
          data: null,
          error: {
            message:
              'MISSING_BANK_REF: Thiếu mã tham chiếu ngân hàng (bank_ref_id).',
          },
        };
      }
      const dup = insertedTransactions.find(
        (t) => t.id !== tx.id && t.bank_ref_id === bankRef
      );
      if (dup) {
        return {
          data: null,
          error: {
            message: `DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "${bankRef}" đã được sử dụng cho giao dịch khác.`,
          },
        };
      }
      tx.status = 'completed';
      tx.bank_ref_id = bankRef;
      const completedAt = new Date().toISOString();
      tx.completed_at = completedAt;
      const expires = new Date();
      expires.setDate(expires.getDate() + 30);
      const expiresAt = expires.toISOString();
      const ownerId = String(tx.user_id);
      if (!mockProfiles[ownerId]) {
        mockProfiles[ownerId] = {
          id: ownerId,
          email: `${ownerId}@qlaok.vn`,
          plan: tx.target_plan as string,
          plan_expires_at: expiresAt,
        } as never;
      } else {
        mockProfiles[ownerId]!.plan = tx.target_plan as string;
        (mockProfiles[ownerId] as Record<string, unknown>).plan_expires_at =
          expiresAt;
      }
      return {
        data: {
          status: 'completed',
          owner_id: tx.user_id,
          target_plan: tx.target_plan,
          plan_expires_at: expiresAt,
          order_code: tx.order_code,
          bank_ref_id: bankRef,
        },
        error: null,
      };
    }
    return { data: null, error: { message: `UNKNOWN_RPC: ${fn}` } };
  },
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
  mockShops = [
    { id: 'shop-review-owner', owner_id: 'review-ai-owner' },
    { id: 'shop-fnb-001', owner_id: 'owner-demo-001' },
  ];
  mockProfiles = {};
  mockMemberships = [];
  mockTableErrors = {};
  selectedProjections.length = 0;
  insertedTransactions.length = 0;
  mockRpcCalls.length = 0;
  mockRpcHandler = null;
  mockRpcError = null;
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

function get(path: string, token: string | null) {
  return new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

test('payment webhook Section 1.5 hardening: requires positive amount, rejects outbound transfer, preserves sandbox simulator, and DB lookup error does not succeed via SEED_TRANSACTIONS', async () => {
  const previousSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  const previousSim = process.env.PAYMENT_DEV_SIMULATE;
  delete process.env.PAYMENT_DEV_SIMULATE;
  // <16 chars so it never becomes the session signing secret fallback
  process.env.PAYMENT_WEBHOOK_SECRET = 'whsec-sec-1-5';

  try {
    // 1. Create a pending order for testing
    const createRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(createRes.status, 201);
    const { transaction: testTx } = await createRes.json();
    assert.equal(testTx.amount, 69000);

    // 2. Provider webhook missing both transferAmount and amount -> 400 PAYMENT_AMOUNT_REQUIRED
    const missingAmtRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          referenceCode: 'BANK-REF-MISSING-AMT',
        }),
      })
    );
    assert.equal(missingAmtRes.status, 400);
    const missingAmtBody = await missingAmtRes.json();
    assert.equal(missingAmtBody.code, 'PAYMENT_AMOUNT_REQUIRED');

    // 3. Provider webhook with zero amount -> 400 INVALID_PAYMENT_AMOUNT
    const zeroAmtRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 0,
        }),
      })
    );
    assert.equal(zeroAmtRes.status, 400);
    assert.equal((await zeroAmtRes.json()).code, 'INVALID_PAYMENT_AMOUNT');

    // 4. Provider webhook with negative amount -> 400 INVALID_PAYMENT_AMOUNT
    const negAmtRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: -69000,
        }),
      })
    );
    assert.equal(negAmtRes.status, 400);
    assert.equal((await negAmtRes.json()).code, 'INVALID_PAYMENT_AMOUNT');

    // 5. Provider webhook with malformed non-numeric string amount -> 400 INVALID_PAYMENT_AMOUNT
    const malformedAmtRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 'not-a-number',
        }),
      })
    );
    assert.equal(malformedAmtRes.status, 400);
    assert.equal((await malformedAmtRes.json()).code, 'INVALID_PAYMENT_AMOUNT');

    // 6. Provider webhook with outbound transferType ('out') -> 400 INVALID_TRANSFER_TYPE
    const outboundRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 69000,
          transferType: 'out',
        }),
      })
    );
    assert.equal(outboundRes.status, 400);
    assert.equal((await outboundRes.json()).code, 'INVALID_TRANSFER_TYPE');

    // 7. Case-insensitive 'OUT' -> 400 INVALID_TRANSFER_TYPE
    const outboundUpperRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 69000,
          transferType: 'OUT',
        }),
      })
    );
    assert.equal(outboundUpperRes.status, 400);
    assert.equal((await outboundUpperRes.json()).code, 'INVALID_TRANSFER_TYPE');

    // 7b. Explicit null transferType (and snake_case alias transfer_type: null) -> 400 INVALID_TRANSFER_TYPE
    const nullTypeRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 69000,
          transferType: null,
        }),
      })
    );
    assert.equal(nullTypeRes.status, 400);
    assert.equal((await nullTypeRes.json()).code, 'INVALID_TRANSFER_TYPE');

    const nullSnakeTypeRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 69000,
          transfer_type: null,
        }),
      })
    );
    assert.equal(nullSnakeTypeRes.status, 400);
    assert.equal((await nullSnakeTypeRes.json()).code, 'INVALID_TRANSFER_TYPE');

    // 8. Super Admin completing through payment webhook callback still requires amount
    const superAdminToken = issueSessionToken({
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const adminNoAmtRes = await paymentPost(
      post('/api/webhooks/payment', superAdminToken, {
        orderCode: testTx.order_code,
      })
    );
    assert.equal(adminNoAmtRes.status, 400);
    assert.equal((await adminNoAmtRes.json()).code, 'PAYMENT_AMOUNT_REQUIRED');

    // 9. Sandbox simulator path with PAYMENT_DEV_SIMULATE='true': owner tests without bank transfer
    process.env.PAYMENT_DEV_SIMULATE = 'true';
    const simOrderRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    const { transaction: simTx } = await simOrderRes.json();

    const simNoAmtRes = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        orderCode: simTx.order_code,
        simulateWebhook: true,
        // no amount or transferAmount
      })
    );
    assert.equal(simNoAmtRes.status, 200);
    const simNoAmtBody = await simNoAmtRes.json();
    assert.equal(simNoAmtBody.success, true);

    // 10. Valid provider path with transferType: 'In' (case-insensitive) and valid positive amount
    delete process.env.PAYMENT_DEV_SIMULATE;
    const validInboundRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: testTx.order_code,
          transferAmount: 69000,
          transferType: 'In',
          referenceCode: 'BANK-REF-VALID-IN-01',
        }),
      })
    );
    assert.equal(validInboundRes.status, 200);
    const validInboundBody = await validInboundRes.json();
    assert.equal(validInboundBody.success, true);

    // 11. DB lookup error does NOT fall back to matching seed transaction
    const { SEED_TRANSACTIONS } = await import('@/lib/seed-data');
    const seedTx = SEED_TRANSACTIONS[0];
    assert.ok(seedTx && seedTx.order_code);

    // Case A: Supabase returns { error } on payment_transactions lookup
    mockTableErrors['payment_transactions'] = {
      code: '57P01',
      message: 'Database lookup failed: connection dropped',
    };

    const dbErrRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: seedTx.order_code,
          transferAmount: 69000,
          referenceCode: 'BANK-REF-SEED-EXPLOIT',
        }),
      })
    );
    // Must return 500, must NOT succeed, must NOT complete seed order
    assert.equal(dbErrRes.status, 500);
    const dbErrBody = await dbErrRes.json();
    assert.match(dbErrBody.error, /DB_PAYMENT_LOOKUP_FAILED/);

    delete mockTableErrors['payment_transactions'];

    // Case B: Thrown exception from DB client during lookup
    const throwingDbClient = {
      from: (tbl: string) => {
        if (tbl === 'payment_transactions') {
          throw new Error('Supabase client crash: connection terminated abruptly');
        }
        return mockSupabaseClient.from(tbl);
      },
      auth: mockSupabaseClient.auth,
    };
    setSupabaseDbClientForTests(throwingDbClient as never);
    try {
      const throwRes = await paymentPost(
        new Request('http://localhost/api/webhooks/payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'whsec-sec-1-5',
          },
          body: JSON.stringify({
            orderCode: seedTx.order_code,
            transferAmount: 69000,
            referenceCode: 'BANK-REF-SEED-EXPLOIT-THROW',
          }),
        })
      );
      assert.equal(throwRes.status, 500);
      const throwBody = await throwRes.json();
      assert.match(throwBody.error, /connection terminated abruptly/);
    } finally {
      setSupabaseDbClientForTests(mockSupabaseClient);
    }

    // Case C: Unknown order with healthy DB returns 404
    const unknownRes = await paymentPost(
      new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'whsec-sec-1-5',
        },
        body: JSON.stringify({
          orderCode: 'QLAOKP_COMPLETELY_NON_EXISTENT_99999',
          transferAmount: 69000,
          referenceCode: 'BANK-REF-NON-EXISTENT',
        }),
      })
    );
    assert.equal(unknownRes.status, 404);
    const unknownBody = await unknownRes.json();
    assert.match(unknownBody.error, /PAYMENT_ORDER_NOT_FOUND/);
  } finally {
    delete mockTableErrors['payment_transactions'];
    setSupabaseDbClientForTests(mockSupabaseClient);
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

  // Under Section 1.5 billing-account scoping:
  // A membership-only role 'owner' in another shop does NOT authorize billing.
  // Reject any non-owner member who owns no shop directly (403 INSUFFICIENT_BILLING_PERMISSION).
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
  mockProfiles['multi-shop-owner-01'] = {
    id: 'multi-shop-owner-01',
    email: 'multi-owner@qlaok.vn',
    plan: 'free',
  };
  const multiOwnerToken = issueSessionToken({
    id: 'multi-shop-owner-01',
    email: 'multi-owner@qlaok.vn',
    role: 'owner',
  });
  // Without directly owned shop -> 403 INSUFFICIENT_BILLING_PERMISSION
  const multiOwnerDeniedRes = await paymentPost(
    post('/api/webhooks/payment', multiOwnerToken, {
      action: 'create_order',
      targetPlan: 'premium',
    })
  );
  assert.equal(multiOwnerDeniedRes.status, 403);
  assert.equal(
    (await multiOwnerDeniedRes.json()).code,
    'INSUFFICIENT_BILLING_PERMISSION'
  );

  // When the user directly owns a separate shop, they can create their own account plan
  mockShops.push({
    id: 'shop-multi-owned',
    owner_id: 'multi-shop-owner-01',
  });
  try {
    const multiOwnerAllowedRes = await paymentPost(
      post('/api/webhooks/payment', multiOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(multiOwnerAllowedRes.status, 201);
    assert.equal(insertedTransactions.length, 3);
  } finally {
    mockShops = mockShops.filter((s) => s.id !== 'shop-multi-owned');
  }
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

test('billing history action visibility is owner/admin-only and completed/failed rows have no action', () => {
  const pendingTx: PaymentTransaction = {
    id: 'tx-pending-01',
    user_id: 'user-01',
    order_code: 'QLAOKP12345',
    target_plan: 'basic',
    amount: 39000,
    status: 'pending',
    bank_ref_id: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  };
  const completedTx: PaymentTransaction = {
    ...pendingTx,
    id: 'tx-completed-01',
    order_code: 'QLAOKP12346',
    status: 'completed',
    completed_at: new Date().toISOString(),
  };
  const failedTx: PaymentTransaction = {
    ...pendingTx,
    id: 'tx-failed-01',
    order_code: 'QLAOKP12347',
    status: 'failed',
  };

  const viTx = (vi: string, _en?: string | null) => vi;
  const enTx = (_vi: string, en?: string | null) => en || _vi;

  // 1. Predicate unit verification: owner/admin can reopen pending, completed/failed and staff cannot
  assert.equal(canReopenPaymentTransaction(pendingTx, true), true, 'Owner/admin can reopen pending transaction');
  assert.equal(canReopenPaymentTransaction(completedTx, true), false, 'Completed transaction cannot be reopened');
  assert.equal(canReopenPaymentTransaction(failedTx, true), false, 'Failed transaction cannot be reopened');
  assert.equal(canReopenPaymentTransaction(pendingTx, false), false, 'Staff/cashier cannot reopen pending transaction');
  assert.equal(canReopenPaymentTransaction(completedTx, false), false, 'Staff/cashier cannot reopen completed transaction');
  assert.equal(canReopenPaymentTransaction(failedTx, false), false, 'Staff/cashier cannot reopen failed transaction');
  assert.equal(canReopenPaymentTransaction(null, true), false, 'Null transaction cannot be reopened');

  // 2. Staff columns (canManageBilling: false) must NOT show the action column
  const staffCols = buildBillingColumns({ tx: viTx, canManageBilling: false });
  assert.equal(
    staffCols.some((col) => col.id === 'action'),
    false,
    'Staff table columns must not have action column'
  );

  // 3. Owner columns (canManageBilling: true) have localized action for pending row only
  let reopenedOrder: PaymentTransaction | null = null;
  const ownerColsVi = buildBillingColumns({
    tx: viTx,
    canManageBilling: true,
    onReopenPendingOrder: (order) => {
      reopenedOrder = order;
    },
  });
  const actionColVi = ownerColsVi.find((col) => col.id === 'action');
  assert.ok(actionColVi, 'Owner columns must include action column');
  assert.equal(actionColVi.name, 'Thao tác');
  assert.ok(actionColVi.cell, 'Action column must have cell renderer');

  // Pending row renders action button in Vietnamese
  const viActionElement = actionColVi.cell(
    pendingTx,
    0,
    actionColVi,
    'action'
  ) as React.ReactElement<{
    children: React.ReactNode[];
    onClick: () => void;
  }>;
  assert.ok(viActionElement, 'Pending row renders action element');
  assert.equal(viActionElement.type, 'button');
  assert.match(JSON.stringify(viActionElement.props), /Xem QR/);

  // Completed & failed rows return null (no action)
  assert.equal(
    actionColVi.cell(completedTx, 1, actionColVi, 'action'),
    null,
    'Completed row has no action element'
  );
  assert.equal(
    actionColVi.cell(failedTx, 2, actionColVi, 'action'),
    null,
    'Failed row has no action element'
  );

  // English localization
  const ownerColsEn = buildBillingColumns({
    tx: enTx,
    canManageBilling: true,
    onReopenPendingOrder: (order) => {
      reopenedOrder = order;
    },
  });
  const actionColEn = ownerColsEn.find((col) => col.id === 'action')!;
  assert.equal(actionColEn.name, 'Action');
  assert.ok(actionColEn.cell, 'English action column must have cell renderer');
  const enActionElement = actionColEn.cell(
    pendingTx,
    0,
    actionColEn,
    'action'
  ) as React.ReactElement<{
    children: React.ReactNode[];
    onClick: () => void;
  }>;
  assert.match(JSON.stringify(enActionElement.props), /View QR/);
});

test('reopening a pending billing transaction re-opens the exact existing order without creating another transaction or calling create_order', () => {
  const existingPendingTx: PaymentTransaction = {
    id: 'tx-existing-reopen-001',
    user_id: 'review-ai-owner',
    order_code: 'QLAOKP88888',
    target_plan: 'premium',
    amount: 69000,
    status: 'pending',
    bank_ref_id: null,
    created_at: '2026-10-22T10:00:00.000Z',
    completed_at: null,
  };

  let reopenCallCount = 0;
  let reopenedOrder: PaymentTransaction | null = null;

  const mockOnReopen = (order: PaymentTransaction) => {
    reopenCallCount += 1;
    reopenedOrder = order;
  };

  const columns = buildBillingColumns({
    tx: (vi) => vi,
    canManageBilling: true,
    onReopenPendingOrder: mockOnReopen,
  });

  const actionCol = columns.find((c) => c.id === 'action')!;
  assert.ok(actionCol.cell, 'Action column must have cell renderer');
  const actionButton = actionCol.cell(
    existingPendingTx,
    0,
    actionCol,
    'action'
  ) as React.ReactElement<{
    onClick: () => void;
  }>;

  // Simulate clicking "Xem QR"
  actionButton.props.onClick();

  assert.equal(reopenCallCount, 1, 'Reopen callback invoked exactly once');
  assert.ok(reopenedOrder, 'Reopen callback was called');
  assert.equal(
    reopenedOrder,
    existingPendingTx,
    'Reopen callback received the exact existing transaction object'
  );
  assert.equal((reopenedOrder as PaymentTransaction).id, existingPendingTx.id);
  assert.equal((reopenedOrder as PaymentTransaction).order_code, 'QLAOKP88888');
  assert.equal((reopenedOrder as PaymentTransaction).amount, 69000);
  assert.equal((reopenedOrder as PaymentTransaction).target_plan, 'premium');

  // Verify DashboardBillingPage source invariants:
  // 1. handleReopenPendingOrder clears stale errors and timeout, sets activeOrder to existing transaction
  // 2. Does NOT invoke create_order or network POST
  // 3. Guards with canManageBilling / canReopenPaymentTransaction
  const pageSrc = fs.readFileSync(
    path.resolve(originalCwd, 'src/app/(dashboard)/dashboard/billing/page.tsx'),
    'utf8'
  );
  assert.match(
    pageSrc,
    /handleReopenPendingOrder[\s\S]*?canReopenPaymentTransaction/,
    'Reopen handler must guard with canReopenPaymentTransaction'
  );
  assert.match(
    pageSrc,
    /handleReopenPendingOrder[\s\S]*?setErrorMsg\(''\)/,
    'Reopen handler must clear stale error message'
  );
  assert.match(
    pageSrc,
    /handleReopenPendingOrder[\s\S]*?setPollTimedOut\(false\)/,
    'Reopen handler must clear stale poll timeout'
  );
  assert.match(
    pageSrc,
    /handleReopenPendingOrder[\s\S]*?setActiveOrder\(/,
    'Reopen handler must set activeOrder to existing transaction'
  );
  assert.doesNotMatch(
    pageSrc,
    /handleReopenPendingOrder[\s\S]*?create_order/,
    'Reopen handler must never call create_order'
  );
});

test('POST /api/webhooks/payment calls complete_payment_webhook_atomic with exact args, deterministic fallback bank ref, and ignores client allowUnverifiedAmount', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  try {
    const txId = 'tx-atomic-test-101';
    const orderCode = 'QLAOKP88881';
    const merchantId = 'merchant-owner-101';

    insertedTransactions.push({
      id: txId,
      user_id: merchantId,
      order_code: orderCode,
      target_plan: 'premium',
      amount: 69000,
      status: 'pending',
      bank_ref_id: null,
      created_at: new Date().toISOString(),
    });
    mockProfiles[merchantId] = {
      id: merchantId,
      email: 'merchant101@qlaok.vn',
      plan: 'free',
    };

    // Provider webhook callback without bankRefId/referenceCode, sending amount=69000 and body attempt allowUnverifiedAmount=true
    const req = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
        allowUnverifiedAmount: true, // Untrusted client flag MUST NOT affect RPC argument
      }),
    });

    const res = await paymentPost(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.alreadyCompleted, false);
    assert.equal(body.profile.plan, 'premium');

    assert.equal(mockRpcCalls.length, 1);
    assert.equal(mockRpcCalls[0].name, 'complete_payment_webhook_atomic');
    assert.deepEqual(mockRpcCalls[0].args, {
      p_order_code: 'QLAOKP88881',
      p_bank_ref_id: 'FT-QLAOKP88881',
      p_verified_transfer_amount: 69000,
      p_allow_unverified_amount: false,
    });
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST /api/webhooks/payment missing amount is allowed ONLY for explicit dev sandbox simulator (provider and super admin require valid amount)', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  const merchantId = 'merchant-owner-sim-01';
  const orderCode = 'QLAOKP_SIM_001';

  insertedTransactions.push({
    id: 'tx-sim-001',
    user_id: merchantId,
    order_code: orderCode,
    target_plan: 'basic',
    amount: 39000,
    status: 'pending',
    bank_ref_id: null,
    created_at: new Date().toISOString(),
  });
  mockProfiles[merchantId] = {
    id: merchantId,
    email: 'merchant-sim@qlaok.vn',
    plan: 'free',
  };

  try {
    // 1. Provider webhook without amount -> 400 PAYMENT_AMOUNT_REQUIRED
    const providerMissingAmtReq = new Request(
      'http://localhost/api/webhooks/payment',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify({ orderCode }),
      }
    );
    const providerRes = await paymentPost(providerMissingAmtReq);
    assert.equal(providerRes.status, 400);
    const providerBody = await providerRes.json();
    assert.equal(providerBody.code, 'PAYMENT_AMOUNT_REQUIRED');
    assert.equal(
      mockRpcCalls.length,
      0,
      'Must not reach RPC when provider omits amount'
    );

    // 2. Super Admin caller without amount -> 400 PAYMENT_AMOUNT_REQUIRED
    const adminToken = issueSessionToken({
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const adminMissingAmtReq = post('/api/webhooks/payment', adminToken, {
      orderCode,
    });
    const adminRes = await paymentPost(adminMissingAmtReq);
    assert.equal(adminRes.status, 400);
    const adminBody = await adminRes.json();
    assert.equal(adminBody.code, 'PAYMENT_AMOUNT_REQUIRED');
    assert.equal(
      mockRpcCalls.length,
      0,
      'Must not reach RPC when Super Admin omits amount'
    );

    // 3. Super Admin caller with valid amount -> calls RPC with p_allow_unverified_amount=false
    const adminWithAmtReq = post('/api/webhooks/payment', adminToken, {
      orderCode,
      transferAmount: 39000,
    });
    const adminSuccessRes = await paymentPost(adminWithAmtReq);
    assert.equal(adminSuccessRes.status, 200);
    assert.equal(mockRpcCalls.length, 1);
    assert.equal(mockRpcCalls[0].name, 'complete_payment_webhook_atomic');
    assert.equal(mockRpcCalls[0].args.p_allow_unverified_amount, false);
    assert.equal(mockRpcCalls[0].args.p_verified_transfer_amount, 39000);

    // Reset for simulator test
    mockRpcCalls.length = 0;
    insertedTransactions[0].status = 'pending';
    mockProfiles[merchantId]!.plan = 'free';

    // 4. Dev sandbox simulator outside production with PAYMENT_DEV_SIMULATE=true
    process.env.PAYMENT_DEV_SIMULATE = 'true';
    const ownerToken = issueSessionToken({
      id: merchantId,
      email: 'merchant-sim@qlaok.vn',
      role: 'owner',
    });

    const simReq = post('/api/webhooks/payment', ownerToken, {
      orderCode,
      simulateWebhook: true,
      // Note: transferAmount omitted
    });
    const simRes = await paymentPost(simReq);
    assert.equal(simRes.status, 200);
    const simBody = await simRes.json();
    assert.equal(simBody.success, true);
    assert.equal(simBody.profile.plan, 'basic');
    assert.equal(mockRpcCalls.length, 1);
    assert.equal(mockRpcCalls[0].name, 'complete_payment_webhook_atomic');
    assert.equal(mockRpcCalls[0].args.p_allow_unverified_amount, true);
    assert.equal(mockRpcCalls[0].args.p_verified_transfer_amount, null);
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    delete process.env.PAYMENT_DEV_SIMULATE;
  }
});

test('POST /api/webhooks/payment RPC errors propagate without table-update fallback, and unavailable RPC fails closed', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  const merchantId = 'merchant-owner-err-01';
  const orderCode = 'QLAOKP_ERR_001';

  insertedTransactions.push({
    id: 'tx-err-001',
    user_id: merchantId,
    order_code: orderCode,
    target_plan: 'premium',
    amount: 69000,
    status: 'pending',
    bank_ref_id: null,
    created_at: new Date().toISOString(),
  });
  mockProfiles[merchantId] = {
    id: merchantId,
    email: 'merchant-err@qlaok.vn',
    plan: 'free',
  };

  try {
    // 1. Amount mismatch error from RPC propagates as 400 without mutating table rows
    mockRpcError = {
      message:
        'PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản (39000) nhỏ hơn số tiền gói cước yêu cầu (69000).',
    };

    const mismatchReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 39000,
      }),
    });
    const mismatchRes = await paymentPost(mismatchReq);
    assert.equal(mismatchRes.status, 400);
    const mismatchBody = await mismatchRes.json();
    assert.match(mismatchBody.error, /PAYMENT_AMOUNT_MISMATCH/);

    // Verify row was NOT mutated via any client-side write fallback
    assert.equal(insertedTransactions[0].status, 'pending');
    assert.equal(insertedTransactions[0].bank_ref_id, null);
    assert.equal(mockProfiles[merchantId]!.plan, 'free');

    // 2. Duplicate bank ref error propagates as 400
    mockRpcError = {
      message:
        'DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "FT-DUP-1" đã được sử dụng cho giao dịch khác.',
    };
    const dupRefReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        bankRefId: 'FT-DUP-1',
        transferAmount: 69000,
      }),
    });
    const dupRes = await paymentPost(dupRefReq);
    assert.equal(dupRes.status, 400);
    assert.match((await dupRes.json()).error, /DUPLICATE_BANK_REF/);
    assert.equal(insertedTransactions[0].status, 'pending');
    assert.equal(mockProfiles[merchantId]!.plan, 'free');

    // 3. Non-pending status error propagates as 409
    mockRpcError = {
      message:
        'PAYMENT_ORDER_NOT_PENDING: Trạng thái đơn thanh toán là "cancelled", không thể hoàn tất.',
    };
    const notPendingReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
      }),
    });
    const notPendingRes = await paymentPost(notPendingReq);
    assert.equal(notPendingRes.status, 409);
    assert.match(
      (await notPendingRes.json()).error,
      /PAYMENT_ORDER_NOT_PENDING/
    );

    // 4. sb.rpc unavailable -> fails closed with 500 DB_RPC_UNAVAILABLE, never marks completed
    mockRpcError = null;
    const clientWithoutRpc = {
      ...mockSupabaseClient,
      rpc: undefined,
    };
    setSupabaseDbClientForTests(clientWithoutRpc as never);
    try {
      const noRpcReq = new Request('http://localhost/api/webhooks/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': secret,
        },
        body: JSON.stringify({
          orderCode,
          transferAmount: 69000,
        }),
      });
      const noRpcRes = await paymentPost(noRpcReq);
      assert.equal(noRpcRes.status, 500);
      assert.match((await noRpcRes.json()).error, /DB_RPC_UNAVAILABLE/);
      assert.equal(insertedTransactions[0].status, 'pending');
      assert.equal(mockProfiles[merchantId]!.plan, 'free');
    } finally {
      setSupabaseDbClientForTests(mockSupabaseClient);
    }
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST /api/webhooks/payment authoritative owner from transaction/RPC drives profile upgrade and billing response, ignoring caller ownerId', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  const realOwnerId = 'real-merchant-victim-999';
  const attackerCallerId = 'attacker-caller-888';
  const orderCode = 'QLAOKP_SEC_001';

  insertedTransactions.push({
    id: 'tx-sec-001',
    user_id: realOwnerId,
    order_code: orderCode,
    target_plan: 'premium',
    amount: 69000,
    status: 'pending',
    bank_ref_id: null,
    created_at: new Date().toISOString(),
  });
  mockProfiles[realOwnerId] = {
    id: realOwnerId,
    email: 'victim@qlaok.vn',
    plan: 'free',
  };
  mockProfiles[attackerCallerId] = {
    id: attackerCallerId,
    email: 'attacker@qlaok.vn',
    plan: 'free',
  };

  try {
    // Caller attempts to pass ownerId='attacker-caller-888' in webhook body
    const req = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
        ownerId: attackerCallerId,
      }),
    });

    const res = await paymentPost(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    // Response profile must be real owner, upgraded to premium
    assert.equal(body.profile.id, realOwnerId);
    assert.equal(body.profile.plan, 'premium');
    // Attacker profile must NOT receive upgrade
    assert.equal(mockProfiles[attackerCallerId]!.plan, 'free');
    assert.equal(mockProfiles[realOwnerId]!.plan, 'premium');
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST /api/webhooks/payment idempotent already_completed status returns HTTP 200 with alreadyCompleted=true and no-op', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  const merchantId = 'merchant-owner-idem-01';
  const orderCode = 'QLAOKP_IDEM_001';
  const initialExpiry = new Date(Date.now() + 15 * 86400000).toISOString();

  insertedTransactions.push({
    id: 'tx-idem-001',
    user_id: merchantId,
    order_code: orderCode,
    target_plan: 'premium',
    amount: 69000,
    status: 'completed',
    bank_ref_id: 'FT-EXISTING-REF',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    completed_at: new Date(Date.now() - 86400000).toISOString(),
  });
  mockProfiles[merchantId] = {
    id: merchantId,
    email: 'merchant-idem@qlaok.vn',
    plan: 'premium',
    plan_expires_at: initialExpiry,
  } as never;

  try {
    const req = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
        bankRefId: 'FT-EXISTING-REF',
      }),
    });

    const res = await paymentPost(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.alreadyCompleted, true);
    assert.equal(body.profile.plan, 'premium');
    assert.equal(
      (mockProfiles[merchantId] as Record<string, unknown>).plan_expires_at,
      initialExpiry,
      'Idempotent duplicate webhook must not alter plan_expires_at'
    );
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST /api/webhooks/payment HTTP error mappings preserve 404 for missing orders, 400 for amount/ref/duplicate errors, and 409 for non-pending orders', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;

  try {
    // 1. Unknown orderCode -> 404
    const notFoundReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode: 'QLAOKP_NOT_EXIST',
        transferAmount: 69000,
      }),
    });
    const notFoundRes = await paymentPost(notFoundReq);
    assert.equal(notFoundRes.status, 404);
    assert.match((await notFoundRes.json()).error, /PAYMENT_ORDER_NOT_FOUND/);

    // 2. Non-pending order (e.g. cancelled) -> 409
    insertedTransactions.push({
      id: 'tx-status-409',
      user_id: 'owner-409',
      order_code: 'QLAOKP_409',
      target_plan: 'basic',
      amount: 39000,
      status: 'cancelled',
      bank_ref_id: null,
      created_at: new Date().toISOString(),
    });
    mockProfiles['owner-409'] = {
      id: 'owner-409',
      email: 'o409@qlaok.vn',
      plan: 'free',
    };

    const nonPendingReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode: 'QLAOKP_409',
        transferAmount: 39000,
      }),
    });
    const nonPendingRes = await paymentPost(nonPendingReq);
    assert.equal(nonPendingRes.status, 409);
    assert.match(
      (await nonPendingRes.json()).error,
      /PAYMENT_ORDER_NOT_PENDING/
    );
  } finally {
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST /api/webhooks/payment RPC invalid response (malformed status, missing owner, mismatched owner) fails closed with HTTP 500 and never succeeds', async () => {
  const secret = 'whsec_payment_review_atomic_2026';
  process.env.PAYMENT_WEBHOOK_SECRET = secret;
  const merchantId = 'merchant-owner-rpc-inv-01';
  const orderCode = 'QLAOKP_RPC_INV_001';

  insertedTransactions.push({
    id: 'tx-rpc-inv-001',
    user_id: merchantId,
    order_code: orderCode,
    target_plan: 'premium',
    amount: 69000,
    status: 'pending',
    bank_ref_id: null,
    created_at: new Date().toISOString(),
  });
  mockProfiles[merchantId] = {
    id: merchantId,
    email: 'merchant-inv@qlaok.vn',
    plan: 'free',
  };

  try {
    // 1. Malformed / unexpected status from RPC -> HTTP 500, DB_RPC_INVALID_RESPONSE, no success response
    mockRpcHandler = async () => ({
      data: {
        status: 'unexpected_status',
        owner_id: merchantId,
      },
      error: null,
    });

    const badStatusReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
      }),
    });
    const badStatusRes = await paymentPost(badStatusReq);
    assert.equal(badStatusRes.status, 500);
    const badStatusBody = await badStatusRes.json();
    assert.equal(badStatusBody.success, undefined);
    assert.match(badStatusBody.error, /DB_RPC_INVALID_RESPONSE/);
    assert.equal(mockProfiles[merchantId]!.plan, 'free');

    // 2. Missing owner_id from RPC -> HTTP 500, DB_RPC_INVALID_RESPONSE, no fallback to transaction/caller owner
    mockRpcHandler = async () => ({
      data: {
        status: 'completed',
        // owner_id omitted
      },
      error: null,
    });

    const missingOwnerReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
      }),
    });
    const missingOwnerRes = await paymentPost(missingOwnerReq);
    assert.equal(missingOwnerRes.status, 500);
    const missingOwnerBody = await missingOwnerRes.json();
    assert.equal(missingOwnerBody.success, undefined);
    assert.match(missingOwnerBody.error, /DB_RPC_INVALID_RESPONSE/);
    assert.equal(mockProfiles[merchantId]!.plan, 'free');

    // 2b. Empty whitespace owner_id from RPC -> HTTP 500, DB_RPC_INVALID_RESPONSE
    mockRpcHandler = async () => ({
      data: {
        status: 'completed',
        owner_id: '   ',
      },
      error: null,
    });

    const emptyOwnerReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
      }),
    });
    const emptyOwnerRes = await paymentPost(emptyOwnerReq);
    assert.equal(emptyOwnerRes.status, 500);
    const emptyOwnerBody = await emptyOwnerRes.json();
    assert.equal(emptyOwnerBody.success, undefined);
    assert.match(emptyOwnerBody.error, /DB_RPC_INVALID_RESPONSE/);
    assert.equal(mockProfiles[merchantId]!.plan, 'free');

    // 3. Mismatched owner_id between transaction and RPC -> HTTP 500, DB_RPC_INVALID_RESPONSE
    const mismatchedOwnerId = 'attacker-imposter-owner-999';
    mockProfiles[mismatchedOwnerId] = {
      id: mismatchedOwnerId,
      email: 'imposter@qlaok.vn',
      plan: 'free',
    };

    mockRpcHandler = async () => ({
      data: {
        status: 'completed',
        owner_id: mismatchedOwnerId,
      },
      error: null,
    });

    const mismatchReq = new Request('http://localhost/api/webhooks/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({
        orderCode,
        transferAmount: 69000,
      }),
    });
    const mismatchRes = await paymentPost(mismatchReq);
    assert.equal(mismatchRes.status, 500);
    const mismatchBody = await mismatchRes.json();
    assert.equal(mismatchBody.success, undefined);
    assert.match(mismatchBody.error, /DB_RPC_INVALID_RESPONSE/);
    assert.equal(mockProfiles[merchantId]!.plan, 'free');
    assert.equal(mockProfiles[mismatchedOwnerId]!.plan, 'free');
  } finally {
    mockRpcHandler = null;
    delete process.env.PAYMENT_WEBHOOK_SECRET;
  }
});

test('POST & GET /api/webhooks/payment Section 1.5 billing-account scoping: restricts order creation to canonical shop owner or standalone user without active memberships, and keeps GET scoped to authenticated session user', async () => {
  const memberOnlyUserId = 'scoped-member-owner-001';
  const memberShopId = 'shop-fnb-001'; // owned by 'owner-demo-001'

  mockProfiles[memberOnlyUserId] = {
    id: memberOnlyUserId,
    email: 'member-owner@qlaok.vn',
    plan: 'free',
  };
  await dbUpsertShopMembership({
    shop_id: memberShopId,
    user_id: memberOnlyUserId,
    email: 'member-owner@qlaok.vn',
    role: 'owner',
  });

  const memberOwnerToken = issueSessionToken({
    id: memberOnlyUserId,
    email: 'member-owner@qlaok.vn',
    role: 'owner',
  });

  try {
    // 1. Active membership-owner, no directly owned shop, POST create_order with shopId for their member shop
    //    -> 403 INSUFFICIENT_BILLING_PERMISSION; no transaction insert.
    const resWithShopId = await paymentPost(
      post('/api/webhooks/payment', memberOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
        shopId: memberShopId,
      })
    );
    assert.equal(resWithShopId.status, 403);
    const bodyWithShopId = await resWithShopId.json();
    assert.equal(bodyWithShopId.code, 'INSUFFICIENT_BILLING_PERMISSION');
    assert.equal(
      insertedTransactions.length,
      0,
      'Must not insert transaction for non-canonical shop owner'
    );

    // 2. Same membership-owner, POST create_order without shopId
    //    -> same 403; no insert.
    const resWithoutShopId = await paymentPost(
      post('/api/webhooks/payment', memberOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(resWithoutShopId.status, 403);
    const bodyWithoutShopId = await resWithoutShopId.json();
    assert.equal(bodyWithoutShopId.code, 'INSUFFICIENT_BILLING_PERMISSION');
    assert.equal(
      insertedTransactions.length,
      0,
      'Must not insert transaction for member without directly owned shop'
    );

    // 3. A normal member must be rejected when shopId points at someone else's shop even if requireShopOwnerOrAdmin would accept its membership role
    //    (Tested with cashier role in member shop, and tested with a user owning a separate shop but passing memberShopId).
    const cashierMemberId = 'scoped-cashier-001';
    mockProfiles[cashierMemberId] = {
      id: cashierMemberId,
      email: 'cashier@qlaok.vn',
      plan: 'free',
    };
    await dbUpsertShopMembership({
      shop_id: memberShopId,
      user_id: cashierMemberId,
      email: 'cashier@qlaok.vn',
      role: 'cashier',
    });
    const cashierToken = issueSessionToken({
      id: cashierMemberId,
      email: 'cashier@qlaok.vn',
      role: 'cashier',
    });
    const cashierMemberRes = await paymentPost(
      post('/api/webhooks/payment', cashierToken, {
        action: 'create_order',
        targetPlan: 'basic',
        shopId: memberShopId,
      })
    );
    assert.equal(cashierMemberRes.status, 403);
    assert.equal(
      (await cashierMemberRes.json()).code,
      'INSUFFICIENT_BILLING_PERMISSION'
    );

    // User who directly owns Shop A, but passes shopId for Shop B where they are a member:
    // Must be rejected for Shop B!
    const separateOwnerId = 'owner-separate-001';
    const separateShopId = 'shop-separate-001';
    mockProfiles[separateOwnerId] = {
      id: separateOwnerId,
      email: 'separate-owner@qlaok.vn',
      plan: 'free',
    };
    mockShops.push({
      id: separateShopId,
      owner_id: separateOwnerId,
    });
    await dbUpsertShopMembership({
      shop_id: memberShopId,
      user_id: separateOwnerId,
      email: 'separate-owner@qlaok.vn',
      role: 'owner',
    });
    const separateOwnerToken = issueSessionToken({
      id: separateOwnerId,
      email: 'separate-owner@qlaok.vn',
      role: 'owner',
    });

    const crossShopRes = await paymentPost(
      post('/api/webhooks/payment', separateOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
        shopId: memberShopId, // Points to someone else's shop
      })
    );
    assert.equal(crossShopRes.status, 403);
    assert.equal(
      (await crossShopRes.json()).code,
      'INSUFFICIENT_BILLING_PERMISSION'
    );
    assert.equal(insertedTransactions.length, 0);

    // 4. A canonical direct shop owner can still create an order for their own shop
    const canonicalOrderRes = await paymentPost(
      post('/api/webhooks/payment', separateOwnerToken, {
        action: 'create_order',
        targetPlan: 'basic',
        shopId: separateShopId,
      })
    );
    assert.equal(canonicalOrderRes.status, 201);
    const canonicalBody = await canonicalOrderRes.json();
    assert.equal(canonicalBody.transaction.user_id, separateOwnerId);
    assert.equal(canonicalBody.transaction.target_plan, 'basic');
    assert.equal(insertedTransactions.length, 1);

    // Also: direct shop owner without shopId succeeds for self
    const canonicalNoShopIdRes = await paymentPost(
      post('/api/webhooks/payment', separateOwnerToken, {
        action: 'create_order',
        targetPlan: 'premium',
      })
    );
    assert.equal(canonicalNoShopIdRes.status, 201);
    assert.equal(insertedTransactions.length, 2);

    // 5. A standalone profile with no shops and no active memberships can still create its own account-level order
    const standaloneUserId = 'standalone-solo-001';
    mockProfiles[standaloneUserId] = {
      id: standaloneUserId,
      email: 'solo@qlaok.vn',
      plan: 'free',
    };
    const standaloneToken = issueSessionToken({
      id: standaloneUserId,
      email: 'solo@qlaok.vn',
      role: 'owner',
    });
    const standaloneRes = await paymentPost(
      post('/api/webhooks/payment', standaloneToken, {
        action: 'create_order',
        targetPlan: 'basic',
      })
    );
    assert.equal(standaloneRes.status, 201);
    const standaloneBody = await standaloneRes.json();
    assert.equal(standaloneBody.transaction.user_id, standaloneUserId);
    assert.equal(standaloneBody.transaction.target_plan, 'basic');
    assert.equal(insertedTransactions.length, 3);

    // 6. Preserve/verify GET ignores non-admin caller-supplied ownerId and returns only the authenticated user's own data
    const victimOwnerId = 'victim-merchant-001';
    mockProfiles[victimOwnerId] = {
      id: victimOwnerId,
      email: 'victim-merchant@qlaok.vn',
      plan: 'premium',
    };
    insertedTransactions.push({
      id: 'tx-victim-secret-01',
      user_id: victimOwnerId,
      order_code: 'QLAOKPV999',
      target_plan: 'premium',
      amount: 69000,
      status: 'completed',
      bank_ref_id: 'FT-VICTIM-01',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const snooperGetRes = await paymentGet(
      get(`/api/webhooks/payment?ownerId=${victimOwnerId}`, standaloneToken)
    );
    assert.equal(snooperGetRes.status, 200);
    const snooperData = await snooperGetRes.json();
    // Must return standaloneUserId's own data, NOT victim's data
    assert.equal(snooperData.profile.id, standaloneUserId);
    assert.equal(snooperData.profile.plan, 'free');
    assert.equal(
      snooperData.transactions.some(
        (t: PaymentTransaction) => t.user_id === victimOwnerId
      ),
      false,
      'GET must never expose another owner transactions to non-admin caller'
    );
    assert.equal(
      snooperData.transactions.every(
        (t: PaymentTransaction) => t.user_id === standaloneUserId
      ),
      true,
      'GET returns only the authenticated user transactions'
    );

    // Super Admin passing ?ownerId=victimOwnerId CAN view victim's data
    const adminToken = issueSessionToken({
      id: SUPER_ADMIN_ID,
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const adminGetRes = await paymentGet(
      get(`/api/webhooks/payment?ownerId=${victimOwnerId}`, adminToken)
    );
    assert.equal(adminGetRes.status, 200);
    const adminData = await adminGetRes.json();
    assert.equal(adminData.profile.id, victimOwnerId);
    assert.equal(adminData.profile.plan, 'premium');
    assert.equal(
      adminData.transactions.some(
        (t: PaymentTransaction) => t.user_id === victimOwnerId
      ),
      true,
      'Super Admin can view targeted owner billing data'
    );
  } finally {
    mockShops = mockShops.filter((s) => s.id !== 'shop-separate-001');
    await dbDeleteShopMembership(memberShopId, memberOnlyUserId);
    await dbDeleteShopMembership(memberShopId, 'scoped-cashier-001');
    await dbDeleteShopMembership(memberShopId, 'owner-separate-001');
  }
});

test('DashboardBillingPage invariants: restricts canManageBilling to canonical shop owner or standalone user without membership, and stops sending ownerId in GET and POST', () => {
  const pageSrc = fs.readFileSync(
    path.resolve(originalCwd, 'src/app/(dashboard)/dashboard/billing/page.tsx'),
    'utf8'
  );

  // 1. canManageBilling must NOT grant permission for activeMembership.role === 'owner'
  assert.doesNotMatch(
    pageSrc,
    /activeMembership\?\.role === 'owner'/,
    'canManageBilling must not authorize billing based on membership role owner'
  );

  // 2. canManageBilling requires activeShop.owner_id === profile.id for selected shop, and profile.id && !activeMembership for standalone
  assert.match(
    pageSrc,
    /activeShop\.owner_id === profile(\?\.|\.)id/,
    'canManageBilling must require canonical activeShop.owner_id === profile.id'
  );
  assert.match(
    pageSrc,
    /Boolean\(\s*profile\?\.id\s*&&\s*!activeMembership\s*\)/,
    'canManageBilling must require loaded profile id and no active membership for standalone access'
  );

  // 3. Normal UI fetchBilling must NOT send ?ownerId query parameter
  assert.doesNotMatch(
    pageSrc,
    /fetch\(`\/api\/webhooks\/payment\$\{query\}`/,
    'fetchBilling must not append ownerId query param'
  );

  // 4. Normal UI handleCreateVietQrOrder must NOT send ownerId in POST body
  const createOrderFn =
    pageSrc.match(/const handleCreateVietQrOrder[\s\S]*?finally \{/)?.[0] || '';
  assert.doesNotMatch(
    createOrderFn,
    /ownerId:/,
    'handleCreateVietQrOrder must not send ownerId in request body'
  );

  // 5. Normal UI handleSimulateWebhookSuccess must NOT send ownerId in POST body
  const simFn =
    pageSrc.match(/const handleSimulateWebhookSuccess[\s\S]*?finally \{/)?.[0] || '';
  assert.doesNotMatch(
    simFn,
    /ownerId:/,
    'handleSimulateWebhookSuccess must not send ownerId in request body'
  );
});
