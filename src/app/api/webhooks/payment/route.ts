import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  dbCompletePaymentWebhook,
  dbCreatePaymentOrder,
  dbGetBillingData,
  dbSetProfilePlan,
  OFFICIAL_PLAN_PRICES_VND,
} from '@/lib/db';
import {
  requireAuthenticatedUser,
  requireSuperAdmin,
  verifyRequestUser,
} from '@/lib/server-auth';
import type { PlanTier } from '@/types/qlaok';

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
    auth.user.role === 'admin' && requestedOwnerId
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

    // 1. Authenticated Shop Owner creates a pending payment order (server decides price)
    if (action === 'create_order') {
      const auth = await requireAuthenticatedUser(req);
      if (auth.errorResponse) return auth.errorResponse;

      const targetPlan: PlanTier = body.targetPlan || 'premium';
      if (targetPlan !== 'basic' && targetPlan !== 'premium') {
        return NextResponse.json(
          { error: 'Gói nâng cấp không hợp lệ (chỉ hỗ trợ basic hoặc premium).' },
          { status: 400 }
        );
      }

      const targetOwnerId =
        auth.user.role === 'admin' && ownerId ? ownerId : auth.user.sub;
      const authoritativeAmount = OFFICIAL_PLAN_PRICES_VND[targetPlan];

      const transaction = await dbCreatePaymentOrder(
        targetPlan,
        authoritativeAmount,
        targetOwnerId
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
    const isSuperAdminCaller = sessionUser?.role === 'admin';
    // Non-admin sandbox simulation is only possible outside production AND
    // when explicitly enabled via PAYMENT_DEV_SIMULATE=true. It is further
    // restricted below to the caller's own pending orders.
    const isDevSandboxSimulator =
      !isSuperAdminCaller &&
      process.env.NODE_ENV !== 'production' &&
      process.env.PAYMENT_DEV_SIMULATE === 'true' &&
      body.simulateWebhook === true &&
      Boolean(sessionUser);

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

    const verifiedTransferAmount =
      body.transferAmount !== undefined
        ? Number(body.transferAmount)
        : body.amount !== undefined
          ? Number(body.amount)
          : undefined;

    const result = await dbCompletePaymentWebhook(
      orderCode,
      body.referenceCode || body.bankRefId,
      ownerId,
      { verifiedTransferAmount }
    );
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : 'Payment processing failed';
    const status = msg.startsWith('PAYMENT_ORDER_NOT_FOUND')
      ? 404
      : msg.startsWith('PAYMENT_AMOUNT_MISMATCH') ||
          msg.startsWith('DUPLICATE_BANK_REF') ||
          msg.startsWith('MISSING_ORDER_CODE')
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
