import { NextResponse } from 'next/server';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
} from '@/lib/db';
import {
  canUseAiOcr,
  PLAN_FEATURE_LOCKED_CODE,
} from '@/lib/plan-limits';
import { SEED_SHOPS } from '@/lib/seed-data';
import {
  requireAuthenticatedUser,
  type VerifiedSessionUser,
} from '@/lib/server-auth';
import {
  hasShopPermission,
  normalizePermissions,
  resolveUserShopMembership,
} from '@/lib/shop-permissions';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { PlanTier, ShopPermission, ShopRole } from '@/types/qlaok';

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

export interface AiOcrPlanGuardContext {
  shopId?: unknown;
}

interface DbShopOwnerRow {
  id: string;
  owner_id: string;
}

interface DbMembershipRow {
  id: string;
  shop_id: string;
  user_id: string;
  role: string;
  permissions?: string[] | null;
  is_active: boolean;
}

function isShopRole(role: unknown): role is ShopRole {
  return role === 'owner' || role === 'cashier' || role === 'staff';
}

export function isMembershipAllowedForCatalogAi(row: DbMembershipRow): boolean {
  if (!row || row.is_active !== true) return false;
  if (!isShopRole(row.role)) return false;
  const permissions = normalizePermissions(
    row.role,
    Array.isArray(row.permissions)
      ? (row.permissions as ShopPermission[])
      : null
  );
  return hasShopPermission(
    {
      role: row.role,
      permissions,
      is_active: row.is_active,
    },
    'catalog.manage'
  );
}

/**
 * Server-side plan gate for AI Vision OCR. Super admins always pass.
 * Resolves the active authorized shop's owner on the server and enforces
 * the shop owner's plan rather than the authenticated member's profile plan.
 * Fails closed when shop authorization or the owner's plan cannot be determined.
 */
export async function requireAiOcrPlan(
  user: VerifiedSessionUser,
  context?: AiOcrPlanGuardContext | string | null
): Promise<NextResponse | null> {
  if (user.role === 'admin' && isSuperAdminEmail(user.email)) return null;

  const rawShopId =
    typeof context === 'string'
      ? context
      : context && typeof context === 'object'
        ? context.shopId
        : undefined;

  if (
    rawShopId !== undefined &&
    rawShopId !== null &&
    (typeof rawShopId !== 'string' || !rawShopId.trim())
  ) {
    return NextResponse.json(
      {
        error: 'shopId không hợp lệ.',
        code: 'INVALID_SHOP_ID',
      },
      { status: 400 }
    );
  }

  const requestedShopId =
    typeof rawShopId === 'string' ? rawShopId.trim() : null;
  const isDbAuthoritative =
    isSupabaseDbClientOverriddenForTests() || isSupabaseConfigured();

  let resolvedOwnerId: string | null = null;

  try {
    const sb = getSupabaseDbClient();

    if (requestedShopId) {
      const { data: shopData, error: shopErr } = await sb
        .from('shops')
        .select('id, owner_id')
        .eq('id', requestedShopId)
        .maybeSingle();

      if (shopErr) {
        return NextResponse.json(
          {
            error:
              'Không thể xác thực quyền truy cập cửa hàng trên máy chủ. Vui lòng thử lại.',
            code: 'AI_SHOP_AUTH_CHECK_FAILED',
          },
          { status: 403 }
        );
      }

      let shopRow = (shopData as DbShopOwnerRow | null) ?? null;
      if (!shopRow && !isDbAuthoritative) {
        const seedShop = SEED_SHOPS.find((s) => s.id === requestedShopId);
        if (seedShop) {
          shopRow = { id: seedShop.id, owner_id: seedShop.owner_id };
        }
      }

      if (!shopRow) {
        return NextResponse.json(
          {
            error: 'Không tìm thấy cửa hàng.',
            code: 'SHOP_NOT_FOUND',
          },
          { status: 404 }
        );
      }

      const isDirectOwner =
        shopRow.owner_id === user.sub &&
        user.role !== 'cashier' &&
        user.role !== 'staff';

      if (isDirectOwner) {
        resolvedOwnerId = shopRow.owner_id;
      } else {
        const { data: memRows, error: memErr } = await sb
          .from('shop_memberships')
          .select('id, shop_id, user_id, role, permissions, is_active')
          .eq('shop_id', shopRow.id)
          .eq('user_id', user.sub)
          .eq('is_active', true);

        if (memErr) {
          return NextResponse.json(
            {
              error:
                'Không thể xác thực quyền thành viên cửa hàng trên máy chủ. Vui lòng thử lại.',
              code: 'AI_SHOP_AUTH_CHECK_FAILED',
            },
            { status: 403 }
          );
        }

        const activeMem = (
          (memRows as DbMembershipRow[] | null) || []
        ).find((m) => m.is_active !== false);

        if (activeMem) {
          if (!isMembershipAllowedForCatalogAi(activeMem)) {
            return NextResponse.json(
              {
                error:
                  'Tài khoản nhân viên không có quyền quản lý thực đơn cho cửa hàng này.',
                code: 'INSUFFICIENT_SHOP_PERMISSION',
              },
              { status: 403 }
            );
          }
          resolvedOwnerId = shopRow.owner_id;
        } else if (!isDbAuthoritative) {
          const fallbackMem = await resolveUserShopMembership({
            shopId: shopRow.id,
            userId: user.sub,
            shopOwnerId: shopRow.owner_id,
          });
          if (!fallbackMem) {
            return NextResponse.json(
              {
                error: 'Bạn không có quyền sử dụng AI OCR cho cửa hàng này.',
                code: 'FORBIDDEN_SHOP_ACCESS',
              },
              { status: 403 }
            );
          }
          if (!hasShopPermission(fallbackMem, 'catalog.manage')) {
            return NextResponse.json(
              {
                error:
                  'Tài khoản nhân viên không có quyền quản lý thực đơn cho cửa hàng này.',
                code: 'INSUFFICIENT_SHOP_PERMISSION',
              },
              { status: 403 }
            );
          }
          resolvedOwnerId = shopRow.owner_id;
        } else {
          return NextResponse.json(
            {
              error: 'Bạn không có quyền sử dụng AI OCR cho cửa hàng này.',
              code: 'FORBIDDEN_SHOP_ACCESS',
            },
            { status: 403 }
          );
        }
      }
    } else {
      const [ownedRes, memRes] = await Promise.all([
        sb.from('shops').select('id, owner_id').eq('owner_id', user.sub),
        sb
          .from('shop_memberships')
          .select('id, shop_id, user_id, role, permissions, is_active')
          .eq('user_id', user.sub)
          .eq('is_active', true),
      ]);

      if (ownedRes.error || memRes.error) {
        return NextResponse.json(
          {
            error:
              'Không thể xác thực quyền truy cập cửa hàng trên máy chủ. Vui lòng thử lại.',
            code: 'AI_SHOP_AUTH_CHECK_FAILED',
          },
          { status: 403 }
        );
      }

      const distinctOwnerIds = new Set<string>();
      const ownedShops =
        user.role !== 'cashier' && user.role !== 'staff'
          ? ((ownedRes.data as DbShopOwnerRow[] | null) || [])
          : [];

      for (const owned of ownedShops) {
        if (owned?.owner_id) {
          distinctOwnerIds.add(owned.owner_id);
        }
      }

      const activeMemberships = (
        (memRes.data as DbMembershipRow[] | null) || []
      ).filter(isMembershipAllowedForCatalogAi);

      const memberShopIds = Array.from(
        new Set(
          activeMemberships
            .map((m) => m.shop_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      for (const memberShopId of memberShopIds) {
        const alreadyOwned = ownedShops.find((s) => s.id === memberShopId);
        if (alreadyOwned) {
          distinctOwnerIds.add(alreadyOwned.owner_id);
          continue;
        }

        const { data: memberShopData, error: memberShopErr } = await sb
          .from('shops')
          .select('id, owner_id')
          .eq('id', memberShopId)
          .maybeSingle();

        if (memberShopErr) {
          return NextResponse.json(
            {
              error:
                'Không thể xác thực quyền truy cập cửa hàng trên máy chủ. Vui lòng thử lại.',
              code: 'AI_SHOP_AUTH_CHECK_FAILED',
            },
            { status: 403 }
          );
        }

        let memberShopRow = (memberShopData as DbShopOwnerRow | null) ?? null;
        if (!memberShopRow && !isDbAuthoritative) {
          const seedShop = SEED_SHOPS.find((s) => s.id === memberShopId);
          if (seedShop) {
            memberShopRow = { id: seedShop.id, owner_id: seedShop.owner_id };
          }
        }

        if (memberShopRow?.owner_id) {
          distinctOwnerIds.add(memberShopRow.owner_id);
        }
      }

      if (distinctOwnerIds.size === 0) {
        return NextResponse.json(
          {
            error: 'Bạn không có quyền sử dụng AI OCR cho cửa hàng này.',
            code: 'FORBIDDEN_SHOP_ACCESS',
          },
          { status: 403 }
        );
      }

      if (distinctOwnerIds.size > 1) {
        return NextResponse.json(
          {
            error:
              'Vui lòng chọn cửa hàng đang thao tác (shopId) để kiểm tra gói dịch vụ của chủ quán.',
            code: 'AMBIGUOUS_SHOP_CONTEXT',
          },
          { status: 403 }
        );
      }

      resolvedOwnerId = Array.from(distinctOwnerIds)[0] ?? null;
    }
  } catch {
    return NextResponse.json(
      {
        error:
          'Không thể xác thực quyền truy cập cửa hàng trên máy chủ. Vui lòng thử lại.',
        code: 'AI_SHOP_AUTH_CHECK_FAILED',
      },
      { status: 403 }
    );
  }

  if (!resolvedOwnerId) {
    return NextResponse.json(
      {
        error: 'Bạn không có quyền sử dụng AI OCR cho cửa hàng này.',
        code: 'FORBIDDEN_SHOP_ACCESS',
      },
      { status: 403 }
    );
  }

  let plan: PlanTier | null = null;
  try {
    const sb = getSupabaseDbClient();
    const { data, error } = await sb
      .from('profiles')
      .select('plan')
      .eq('id', resolvedOwnerId)
      .maybeSingle();
    if (!error) {
      plan = ((data as { plan?: PlanTier } | null)?.plan as PlanTier) || null;
    }
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
