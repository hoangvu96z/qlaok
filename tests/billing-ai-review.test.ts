import assert from 'node:assert/strict';
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

const { setSupabaseDbClientForTests } = await import('@/lib/db');
const { issueSessionToken } = await import('@/lib/server-auth');
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
const { resetAiRateLimitsForTest, AI_RATE_LIMITS } = await import(
  '@/app/api/ai/_lib/guard'
);
const { POST: paymentPost } = await import('@/app/api/webhooks/payment/route');

let profilePlan: string | null = 'free';
setSupabaseDbClientForTests({
  from() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: profilePlan ? { plan: profilePlan } : null,
        error: null,
      }),
    };
    return chain;
  },
  auth: { getUser: async () => ({ data: { user: null }, error: new Error('no') }) },
});
after(() => setSupabaseDbClientForTests(null));
beforeEach(() => resetAiRateLimitsForTest());

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

test('payment webhook: owner simulateWebhook is not accepted without PAYMENT_DEV_SIMULATE', async () => {
  const previous = process.env.PAYMENT_WEBHOOK_SECRET;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  try {
    const res = await paymentPost(
      post('/api/webhooks/payment', ownerToken, {
        orderCode: 'QLAOKP99999',
        simulateWebhook: true,
      })
    );
    assert.equal(res.status, 503);
  } finally {
    if (previous !== undefined) process.env.PAYMENT_WEBHOOK_SECRET = previous;
  }
});
