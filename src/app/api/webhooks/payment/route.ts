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
import {
  getConfiguredSaasReceivingAccounts,
  normalizeReceivingAccount,
} from '@/lib/saas-bank-accounts';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  extractPayOSOrderCodeFromDescription,
  getSaasPaymentWebhookPayload,
  isPayOSWebhookEnvelope,
  isSuccessfulPayOSWebhook,
  verifySaasPaymentWebhookAuthentication,
} from '@/lib/saas-payment-webhook';
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
  rawBody: string,
  body: unknown
): { valid: boolean; status?: number; reason?: string } {
  return verifySaasPaymentWebhookAuthentication(
    req,
    rawBody,
    body,
    getConfiguredWebhookSecret()
  );
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
    const payOSWebhook = isPayOSWebhookEnvelope(body);
    const paymentPayload = getSaasPaymentWebhookPayload(body);

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
    const sessionUser = payOSWebhook ? null : await verifyRequestUser(req);
    const isSuperAdminCaller =
      !payOSWebhook && isVerifiedSuperAdmin(sessionUser);
    // Non-admin sandbox simulation is only possible outside production AND
    // when explicitly enabled via PAYMENT_DEV_SIMULATE=true. It is further
    // restricted below to the caller's own pending orders.
    const isDevSandboxSimulator =
      !payOSWebhook &&
      !isSuperAdminCaller &&
      process.env.NODE_ENV !== 'production' &&
      process.env.PAYMENT_DEV_SIMULATE === 'true' &&
      body.simulateWebhook === true &&
      Boolean(sessionUser) &&
      sessionUser?.role !== 'cashier' &&
      sessionUser?.role !== 'staff';

    if (!isSuperAdminCaller && !isDevSandboxSimulator) {
      const verification = verifyWebhookSignatureOrSecret(req, rawBody, body);
      if (!verification.valid) {
        return NextResponse.json(
          { error: verification.reason || 'Unauthorized webhook request' },
          { status: verification.status || 401 }
        );
      }
    }

    if (payOSWebhook && !isSuccessfulPayOSWebhook(body)) {
      return NextResponse.json(
        {
          error: 'Webhook PayOS không xác nhận giao dịch thành công.',
          code: 'UNSUCCESSFUL_PAYMENT_EVENT',
        },
        { status: 400 }
      );
    }

    const orderCodeCandidate = payOSWebhook
      ? extractPayOSOrderCodeFromDescription(paymentPayload)
      : paymentPayload.orderCode ||
        paymentPayload.code ||
        (typeof paymentPayload.content === 'string'
          ? paymentPayload.content.match(/QLAOK[A-Z0-9]+/i)?.[0]
          : null);
    const orderCode =
      typeof orderCodeCandidate === 'string' ||
      typeof orderCodeCandidate === 'number'
        ? String(orderCodeCandidate).trim()
        : '';

    if (payOSWebhook && !orderCode) {
      return NextResponse.json(
        {
          success: true,
          ignored: true,
          code: 'PAYOS_NON_QLAOK_EVENT_IGNORED',
          reason:
            'PayOS webhook does not contain a Qlaok orderCode in data.description.',
        },
        { status: 200 }
      );
    }

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
      paymentPayload.transferType !== undefined ||
      paymentPayload.transfer_type !== undefined;

    if (hasTransferType) {
      const rawTransferType =
        paymentPayload.transferType !== undefined
          ? paymentPayload.transferType
          : paymentPayload.transfer_type;
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
      const hasTransferAmount = paymentPayload.transferAmount !== undefined;
      const hasAmount = paymentPayload.amount !== undefined;
      const rawAmount = hasTransferAmount
        ? paymentPayload.transferAmount
        : hasAmount
          ? paymentPayload.amount
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
        paymentPayload.transferAmount !== undefined
          ? paymentPayload.transferAmount
          : paymentPayload.amount;
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

    if (!isDevSandboxSimulator) {
      const configuredReceivingAccounts = getConfiguredSaasReceivingAccounts();
      if (configuredReceivingAccounts.length === 0) {
        return NextResponse.json(
          {
            error:
              'Tài khoản nhận tiền SaaS chưa được cấu hình (thiếu SAAS_BANK_ACCOUNTS, SAAS_BANK_ACCOUNT hoặc NEXT_PUBLIC_SAAS_BANK_ACCOUNT).',
            code: 'RECEIVING_ACCOUNT_NOT_CONFIGURED',
          },
          { status: 503 }
        );
      }

      const rawAccountNumber =
        paymentPayload.accountNumber !== undefined
          ? paymentPayload.accountNumber
          : paymentPayload.account_number;

      if (
        rawAccountNumber === undefined ||
        rawAccountNumber === null ||
        rawAccountNumber === '' ||
        (typeof rawAccountNumber !== 'string' &&
          typeof rawAccountNumber !== 'number') ||
        String(rawAccountNumber).trim().length === 0 ||
        String(rawAccountNumber).replace(/\s+/g, '').length === 0
      ) {
        return NextResponse.json(
          {
            error:
              'Thiếu số tài khoản nhận tiền (accountNumber) trong payload webhook.',
            code: 'RECEIVING_ACCOUNT_REQUIRED',
          },
          { status: 400 }
        );
      }

      const normalizedProvided = normalizeReceivingAccount(
        String(rawAccountNumber)
      );

      if (!configuredReceivingAccounts.includes(normalizedProvided)) {
        return NextResponse.json(
          {
            error:
              'Số tài khoản nhận tiền không khớp với tài khoản ngân hàng SaaS đã cấu hình.',
            code: 'RECEIVING_ACCOUNT_MISMATCH',
          },
          { status: 400 }
        );
      }
    }

    const rawBankReference =
      paymentPayload.referenceCode ||
      paymentPayload.bankRefId ||
      paymentPayload.reference;
    const bankReference =
      typeof rawBankReference === 'string' ||
      typeof rawBankReference === 'number'
        ? String(rawBankReference).trim() || undefined
        : undefined;

    const result = await dbCompletePaymentWebhook(
      orderCode,
      bankReference,
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
