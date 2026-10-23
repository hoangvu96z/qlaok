import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  dbCompletePaymentWebhook,
  dbCreatePaymentOrder,
  dbGetBillingData,
  dbSetProfilePlan,
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
  OFFICIAL_PLAN_PRICES_VND,
} from '@/lib/db';
import { SEED_PROFILE, SEED_SHOPS } from '@/lib/seed-data';
import {
  requireAuthenticatedUser,
  requireSuperAdmin,
  verifyRequestUser,
  type VerifiedSessionUser,
} from '@/lib/server-auth';
import { dbGetUserShopMemberships } from '@/lib/shop-permissions';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import type { PlanTier, ShopRole } from '@/types/qlaok';

function isVerifiedSuperAdmin(
  user: VerifiedSessionUser | null | undefined
): boolean {
  return Boolean(
    user && user.role === 'admin' && isSuperAdminEmail(user.email)
  );
}

interface BillingShopRow {
  id: string;
  owner_id: string;
}

interface BillingMembershipRow {
  role: ShopRole;
  is_active: boolean;
}

interface BillingProfileRow {
  id: string;
  email?: string | null;
  plan?: PlanTier | null;
}

function forbiddenBillingPermissionResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Chỉ chủ cửa hàng hoặc Super Admin mới có quyền tạo giao dịch nâng cấp gói.',
      code: 'INSUFFICIENT_BILLING_PERMISSION',
    },
    { status: 403 }
  );
}

async function requireBillingOrderAuthority(
  req: Request,
  body: Record<string, unknown>
): Promise<
  | { user: VerifiedSessionUser; targetOwnerId: string; errorResponse?: undefined }
  | { user?: undefined; targetOwnerId?: undefined; errorResponse: NextResponse }
> {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth;
  const { user } = auth;
  const isAdminCaller = isVerifiedSuperAdmin(user);

  const rawOwnerId = body.ownerId ?? body.owner_id;
  if (
    rawOwnerId !== undefined &&
    rawOwnerId !== null &&
    typeof rawOwnerId !== 'string'
  ) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Mã chủ quán (ownerId) không hợp lệ.',
          code: 'INVALID_OWNER_ID',
        },
        { status: isAdminCaller ? 400 : 403 }
      ),
    };
  }
  const requestedOwnerId =
    typeof rawOwnerId === 'string' ? rawOwnerId.trim() : '';

  if (!isAdminCaller && requestedOwnerId && requestedOwnerId !== user.sub) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Chỉ Super Admin mới được phép tạo giao dịch nâng cấp gói cho tài khoản chủ quán khác.',
          code: 'FORBIDDEN_OWNER_TARGET',
        },
        { status: 403 }
      ),
    };
  }

  if (isAdminCaller) {
    return {
      user,
      targetOwnerId: requestedOwnerId || user.sub,
    };
  }

  if (user.role === 'cashier' || user.role === 'staff') {
    return { errorResponse: forbiddenBillingPermissionResponse() };
  }

  const rawShopId = body.shopId ?? body.shop_id;
  if (
    rawShopId !== undefined &&
    rawShopId !== null &&
    typeof rawShopId !== 'string'
  ) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Mã cửa hàng (shopId) không hợp lệ.' },
        { status: 400 }
      ),
    };
  }
  const requestedShopId =
    typeof rawShopId === 'string' ? rawShopId.trim() : '';

  const dbActive =
    isSupabaseDbClientOverriddenForTests() || isSupabaseConfigured();

  if (dbActive) {
    try {
      const sb = getSupabaseDbClient();
      const [shopRes, membershipsRes, profileRes] = await Promise.all([
        requestedShopId
          ? sb
              .from('shops')
              .select('id, owner_id')
              .eq('id', requestedShopId)
              .maybeSingle<BillingShopRow>()
          : sb
              .from('shops')
              .select('id, owner_id')
              .eq('owner_id', user.sub)
              .limit(1)
              .maybeSingle<BillingShopRow>(),
        sb
          .from('shop_memberships')
          .select<string, BillingMembershipRow>('role, is_active')
          .eq('user_id', user.sub)
          .eq('is_active', true),
        sb
          .from('profiles')
          .select('id, email, plan')
          .eq('id', user.sub)
          .maybeSingle<BillingProfileRow>(),
      ]);

      if (shopRes.error || membershipsRes.error || profileRes.error) {
        return {
          errorResponse: NextResponse.json(
            {
              error:
                'Không thể xác minh quyền chủ cửa hàng cho giao dịch nâng cấp gói.',
              code: 'BILLING_AUTH_CHECK_FAILED',
            },
            { status: 403 }
          ),
        };
      }

      const hasProfile = profileRes.data?.id === user.sub;
      if (!hasProfile) {
        return { errorResponse: forbiddenBillingPermissionResponse() };
      }

      if (requestedShopId) {
        const targetShop = shopRes.data;
        if (!targetShop || targetShop.owner_id !== user.sub) {
          return { errorResponse: forbiddenBillingPermissionResponse() };
        }
        return {
          user,
          targetOwnerId: user.sub,
        };
      }

      const ownsDirectShop = Boolean(
        shopRes.data?.id && shopRes.data.owner_id === user.sub
      );
      if (ownsDirectShop) {
        return {
          user,
          targetOwnerId: user.sub,
        };
      }

      const hasActiveMemberships = (membershipsRes.data ?? []).some(
        (m) => m.is_active
      );
      if (hasActiveMemberships) {
        return { errorResponse: forbiddenBillingPermissionResponse() };
      }

      return {
        user,
        targetOwnerId: user.sub,
      };
    } catch {
      return {
        errorResponse: NextResponse.json(
          {
            error:
              'Không thể xác minh quyền chủ cửa hàng cho giao dịch nâng cấp gói.',
            code: 'BILLING_AUTH_CHECK_FAILED',
          },
          { status: 403 }
        ),
      };
    }
  } else if (process.env.NODE_ENV !== 'production') {
    const hasProfile = user.sub === SEED_PROFILE.id;
    if (!hasProfile) {
      return { errorResponse: forbiddenBillingPermissionResponse() };
    }

    if (requestedShopId) {
      const targetShop = SEED_SHOPS.find((s) => s.id === requestedShopId);
      if (!targetShop || targetShop.owner_id !== user.sub) {
        return { errorResponse: forbiddenBillingPermissionResponse() };
      }
      return {
        user,
        targetOwnerId: user.sub,
      };
    }

    const ownsDirectShop = SEED_SHOPS.some((s) => s.owner_id === user.sub);
    if (ownsDirectShop) {
      return {
        user,
        targetOwnerId: user.sub,
      };
    }

    const mems = await dbGetUserShopMemberships(user.sub);
    const hasActiveMemberships = mems.some((m) => m.is_active);
    if (hasActiveMemberships) {
      return { errorResponse: forbiddenBillingPermissionResponse() };
    }

    return {
      user,
      targetOwnerId: user.sub,
    };
  }

  return { errorResponse: forbiddenBillingPermissionResponse() };
}

/**
 * Returns the configured webhook secret, or null when it is missing/blank.
 * There is intentionally NO hardcoded fallback: an unset secret means
 * provider webhooks cannot be authenticated and must be rejected.
 */
function getConfiguredWebhookSecret(): string | null {
  const secret = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  return secret.length > 0 ? secret : null;
}

function verifyWebhookSignatureOrSecret(
  req: Request,
  rawBody: string
): { valid: boolean; status?: number; reason?: string } {
  const configuredSecret = getConfiguredWebhookSecret();
  if (!configuredSecret) {
    return {
      valid: false,
      status: 503,
      reason:
        'Webhook thanh toán chưa được cấu hình (thiếu PAYMENT_WEBHOOK_SECRET). Từ chối mọi callback.',
    };
  }

  const headerSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers
      .get('authorization')
      ?.replace(/^Apikey\s+/i, '')
      .trim();

  const headerSignature = req.headers.get('x-webhook-signature');

  if (headerSignature) {
    const expectedHmac = crypto
      .createHmac('sha256', configuredSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const a = Buffer.from(headerSignature.trim(), 'utf8');
    const b = Buffer.from(expectedHmac, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'Chữ ký Webhook (HMAC) không hợp lệ.' };
    }
    return { valid: true };
  }

  if (headerSecret) {
    const a = Buffer.from(headerSecret, 'utf8');
    const b = Buffer.from(configuredSecret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'Webhook Secret không hợp lệ.' };
    }
    return { valid: true };
  }

  return {
    valid: false,
    reason: 'Thiếu chữ ký hoặc khóa xác thực Webhook (x-webhook-secret / x-webhook-signature).',
  };
}

export async function GET(req: Request) {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth.errorResponse;

  const { searchParams } = new URL(req.url);
  const requestedOwnerId = searchParams.get('ownerId');
  const resolvedOwnerId =
    isVerifiedSuperAdmin(auth.user) && requestedOwnerId
      ? requestedOwnerId
      : auth.user.sub;

  const data = await dbGetBillingData(resolvedOwnerId);
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    const { action, ownerId } = body;

    // 1. Authenticated Shop/Profile Owner or Verified Super Admin creates a pending payment order (server decides price)
    if (action === 'create_order') {
      const auth = await requireBillingOrderAuthority(req, body);
      if (auth.errorResponse) return auth.errorResponse;

      const targetPlan: PlanTier =
        body.targetPlan === undefined ? 'premium' : body.targetPlan;
      if (targetPlan !== 'basic' && targetPlan !== 'premium') {
        return NextResponse.json(
          {
            error:
              'Gói nâng cấp không hợp lệ (chỉ hỗ trợ basic hoặc premium).',
            code: 'INVALID_TARGET_PLAN',
          },
          { status: 400 }
        );
      }

      const authoritativeAmount = OFFICIAL_PLAN_PRICES_VND[targetPlan];

      const transaction = await dbCreatePaymentOrder(
        targetPlan,
        authoritativeAmount,
        auth.targetOwnerId
      );
      return NextResponse.json({ transaction }, { status: 201 });
    }

    // 2. Direct plan switch is strictly restricted to verified Super Admin
    if (action === 'switch_plan_direct') {
      const adminAuth = await requireSuperAdmin(req);
      if (adminAuth.errorResponse) {
        return NextResponse.json(
          {
            error:
              'Không được phép tự đổi gói trực tiếp khi chưa thanh toán. Chỉ Super Admin mới có quyền cấp gói thủ công.',
          },
          { status: 403 }
        );
      }
      const plan: PlanTier = body.plan || 'premium';
      const profile = await dbSetProfilePlan(plan, ownerId || adminAuth.user.sub);
      return NextResponse.json({ profile });
    }

    // 3. SePay / PayOS Webhook completion
    const sessionUser = await verifyRequestUser(req);
    const isSuperAdminCaller = isVerifiedSuperAdmin(sessionUser);
    // Non-admin sandbox simulation is only possible outside production AND
    // when explicitly enabled via PAYMENT_DEV_SIMULATE=true. It is further
    // restricted below to the caller's own pending orders.
    const isDevSandboxSimulator =
      !isSuperAdminCaller &&
      process.env.NODE_ENV !== 'production' &&
      process.env.PAYMENT_DEV_SIMULATE === 'true' &&
      body.simulateWebhook === true &&
      Boolean(sessionUser) &&
      sessionUser?.role !== 'cashier' &&
      sessionUser?.role !== 'staff';

    if (!isSuperAdminCaller && !isDevSandboxSimulator) {
      const verification = verifyWebhookSignatureOrSecret(req, rawBody);
      if (!verification.valid) {
        return NextResponse.json(
          { error: verification.reason || 'Unauthorized webhook request' },
          { status: verification.status || 401 }
        );
      }
    }

    const orderCode =
      body.orderCode ||
      body.code ||
      (typeof body.content === 'string'
        ? body.content.match(/QLAOK[A-Z0-9]+/i)?.[0]
        : null);

    if (!orderCode) {
      return NextResponse.json(
        { error: 'Missing orderCode in webhook payload' },
        { status: 400 }
      );
    }

    if (isDevSandboxSimulator && sessionUser) {
      const own = await dbGetBillingData(sessionUser.sub);
      const ownsOrder = own.transactions.some(
        (tx) =>
          tx.order_code.toUpperCase() === String(orderCode).trim().toUpperCase()
      );
      if (!ownsOrder) {
        return NextResponse.json(
          { error: 'Chỉ được giả lập thanh toán cho đơn của chính bạn.' },
          { status: 403 }
        );
      }
    }

    const hasTransferType =
      body.transferType !== undefined || body.transfer_type !== undefined;

    if (hasTransferType) {
      const rawTransferType =
        body.transferType !== undefined
          ? body.transferType
          : body.transfer_type;
      const normalizedTransferType =
        typeof rawTransferType === 'string'
          ? rawTransferType.trim().toLowerCase()
          : '';
      if (normalizedTransferType !== 'in') {
        return NextResponse.json(
          {
            error:
              'Loại giao dịch không hợp lệ. Chỉ chấp nhận giao dịch tiền vào (inbound transfer).',
            code: 'INVALID_TRANSFER_TYPE',
          },
          { status: 400 }
        );
      }
    }

    let verifiedTransferAmount: number | undefined;

    if (!isDevSandboxSimulator) {
      const hasTransferAmount = body.transferAmount !== undefined;
      const hasAmount = body.amount !== undefined;
      const rawAmount = hasTransferAmount
        ? body.transferAmount
        : hasAmount
          ? body.amount
          : undefined;

      if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
        return NextResponse.json(
          {
            error:
              'Thiếu số tiền chuyển khoản (transferAmount hoặc amount).',
            code: 'PAYMENT_AMOUNT_REQUIRED',
          },
          { status: 400 }
        );
      }

      const parsedAmount =
        typeof rawAmount === 'number'
          ? rawAmount
          : typeof rawAmount === 'string' && rawAmount.trim() !== ''
            ? Number(rawAmount.trim())
            : NaN;

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return NextResponse.json(
          {
            error:
              'Số tiền chuyển khoản không hợp lệ (phải là số dương lớn hơn 0).',
            code: 'INVALID_PAYMENT_AMOUNT',
          },
          { status: 400 }
        );
      }

      verifiedTransferAmount = parsedAmount;
    } else {
      const rawAmount =
        body.transferAmount !== undefined ? body.transferAmount : body.amount;
      if (rawAmount !== undefined && rawAmount !== null && rawAmount !== '') {
        const candidate =
          typeof rawAmount === 'number'
            ? rawAmount
            : typeof rawAmount === 'string' && rawAmount.trim() !== ''
              ? Number(rawAmount.trim())
              : NaN;
        if (Number.isFinite(candidate) && candidate > 0) {
          verifiedTransferAmount = candidate;
        }
      }
    }

    const result = await dbCompletePaymentWebhook(
      orderCode,
      body.referenceCode || body.bankRefId,
      {
        verifiedTransferAmount,
        allowUnverifiedAmount: Boolean(isDevSandboxSimulator),
      }
    );
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Payment processing failed';
    let status = 500;
    if (msg.startsWith('PAYMENT_ORDER_NOT_FOUND')) {
      status = 404;
    } else if (
      msg.startsWith('PAYMENT_ORDER_NOT_PENDING') ||
      msg.startsWith('INVALID_PAYMENT_STATUS')
    ) {
      status = 409;
    } else if (
      msg.startsWith('PAYMENT_AMOUNT_MISMATCH') ||
      msg.startsWith('DUPLICATE_BANK_REF') ||
      msg.startsWith('MISSING_ORDER_CODE') ||
      msg.startsWith('MISSING_BANK_REF') ||
      msg.startsWith('INVALID_PAYMENT_AMOUNT')
    ) {
      status = 400;
    }
    return NextResponse.json({ error: msg }, { status });
  }
}
