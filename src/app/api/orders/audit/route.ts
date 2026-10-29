import { NextResponse } from 'next/server';
import { queryOrderAuditLogs, requireShopPermission } from '@/lib/server-auth';
import type { OrderAuditSubjectType } from '@/types/qlaok';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shopId = (
      url.searchParams.get('shopId') ||
      url.searchParams.get('shop_id') ||
      ''
    ).trim();

    if (!shopId) {
      return NextResponse.json(
        {
          error: 'Thiếu mã cửa hàng (shopId).',
          code: 'SHOP_ID_REQUIRED',
        },
        { status: 400 }
      );
    }

    const auth = await requireShopPermission(req, shopId, 'reports.view');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const rawSubjectType = (
      url.searchParams.get('subjectType') ||
      url.searchParams.get('subject_type') ||
      ''
    ).trim();

    if (
      rawSubjectType &&
      rawSubjectType !== 'order' &&
      rawSubjectType !== 'service_request'
    ) {
      return NextResponse.json(
        {
          error:
            'Tham số subjectType không hợp lệ (chỉ chấp nhận "order" hoặc "service_request").',
          code: 'INVALID_AUDIT_SUBJECT_TYPE',
        },
        { status: 400 }
      );
    }

    const orderId =
      (
        url.searchParams.get('orderId') ||
        url.searchParams.get('order_id') ||
        ''
      ).trim() || null;

    const serviceRequestId =
      (
        url.searchParams.get('serviceRequestId') ||
        url.searchParams.get('service_request_id') ||
        ''
      ).trim() || null;

    const subjectId =
      (
        url.searchParams.get('subjectId') ||
        url.searchParams.get('subject_id') ||
        ''
      ).trim() || null;

    const action = (url.searchParams.get('action') || '').trim() || null;

    const rawLimit = url.searchParams.get('limit');
    let limit = 100;
    if (rawLimit !== null && rawLimit.trim() !== '') {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          {
            error: 'Tham số limit phải là số nguyên dương.',
            code: 'INVALID_AUDIT_LIMIT',
          },
          { status: 400 }
        );
      }
      limit = Math.min(200, Math.max(1, Math.trunc(parsed)));
    }

    const resolvedSubjectType: OrderAuditSubjectType | null = rawSubjectType
      ? (rawSubjectType as OrderAuditSubjectType)
      : serviceRequestId && !orderId
        ? 'service_request'
        : orderId && !serviceRequestId
          ? 'order'
          : null;

    const auditLogs = await queryOrderAuditLogs({
      shopId,
      subjectType: resolvedSubjectType,
      subjectId,
      orderId,
      serviceRequestId,
      action,
      limit,
    });

    return NextResponse.json({
      auditLogs,
      membership: auth.membership,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể tải nhật ký kiểm toán đơn hàng.';
    const status = /ORDER_AUDIT_QUERY_FAILED|ORDER_AUDIT_DB_UNAVAILABLE|MISSING_SERVICE_ROLE_KEY|SUPABASE_NOT_CONFIGURED|SERVICE_ROLE_REQUIRED/.test(message)
      ? 503
      : 500;
    return NextResponse.json(
      {
        error: 'Không thể tải nhật ký kiểm toán đơn hàng.',
        code: 'ORDER_AUDIT_QUERY_FAILED',
      },
      { status }
    );
  }
}
