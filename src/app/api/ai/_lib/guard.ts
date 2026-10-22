import { NextResponse } from 'next/server';
import { getSupabaseDbClient } from '@/lib/db';
import {
  canUseAiOcr,
  PLAN_FEATURE_LOCKED_CODE,
} from '@/lib/plan-limits';
import {
  requireAuthenticatedUser,
  type VerifiedSessionUser,
} from '@/lib/server-auth';
import type { PlanTier } from '@/types/qlaok';

/**
 * Shared guards for the paid AI endpoints (/api/ai/translate, /api/ai/ocr-menu).
 *
 * - Requires a verified Qlaok session / Supabase JWT (same helper as other business APIs).
 * - Applies a simple in-memory sliding-window rate limit per user + bucket.
 *   NOTE: in-memory state is per server instance; it is a best-effort abuse guard,
 *   not a global quota.
 */

export const AI_RATE_LIMITS = {
  translate: { max: 30, windowMs: 10 * 60 * 1000 },
  ocr: { max: 10, windowMs: 10 * 60 * 1000 },
} as const;

export type AiRateBucket = keyof typeof AI_RATE_LIMITS;

const hits = new Map<string, number[]>();

/** Test helper: clears all in-memory rate limit counters. */
export function resetAiRateLimitsForTest(): void {
  hits.clear();
}

export function consumeAiRateLimit(
  bucket: AiRateBucket,
  userId: string,
  now = Date.now()
): { allowed: boolean; retryAfterSec: number; remaining: number } {
  const { max, windowMs } = AI_RATE_LIMITS[bucket];
  const key = `${bucket}:${userId}`;
  const recent = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((recent[0] + windowMs - now) / 1000)
    );
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  recent.push(now);
  hits.set(key, recent);
  // Opportunistic cleanup to bound memory
  if (hits.size > 5000) {
    for (const [k, list] of hits) {
      if (!list.some((ts) => now - ts < windowMs)) hits.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0, remaining: max - recent.length };
}

export async function requireAiCaller(
  req: Request,
  bucket: AiRateBucket
): Promise<
  | { user: VerifiedSessionUser; errorResponse?: undefined }
  | { user?: undefined; errorResponse: NextResponse }
> {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth;

  const limit = consumeAiRateLimit(bucket, auth.user.sub);
  if (!limit.allowed) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Bạn đã gửi quá nhiều yêu cầu AI trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
          code: 'AI_RATE_LIMITED',
          retryAfterSec: limit.retryAfterSec,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSec) },
        }
      ),
    };
  }
  return { user: auth.user };
}

/**
 * Server-side plan gate for AI Vision OCR. Super admins always pass.
 * Fails closed when the caller's plan cannot be determined.
 */
export async function requireAiOcrPlan(
  user: VerifiedSessionUser
): Promise<NextResponse | null> {
  if (user.role === 'admin') return null;

  let plan: PlanTier | null = null;
  try {
    const sb = getSupabaseDbClient();
    const { data } = await sb
      .from('profiles')
      .select('plan')
      .eq('id', user.sub)
      .maybeSingle();
    plan = ((data as { plan?: PlanTier } | null)?.plan as PlanTier) || null;
  } catch {
    plan = null;
  }

  if (canUseAiOcr(plan)) return null;

  return NextResponse.json(
    {
      error:
        'PLAN_FEATURE_LOCKED: AI Vision OCR chỉ có trong gói Premium. Vui lòng nâng cấp gói để sử dụng.',
      code: PLAN_FEATURE_LOCKED_CODE,
      upgradeHref: '/dashboard/billing',
    },
    { status: 403 }
  );
}
