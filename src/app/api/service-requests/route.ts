import { NextResponse } from 'next/server';
import { getOrderEventsBroker } from '@/lib/order-events';
import { sendServiceRequestPushNotifications } from '@/lib/push-notifications';
import {
  recordOrderAuditLog,
  requireAuthenticatedUser,
  requireShopPermission,
} from '@/lib/server-auth';
import {
  dbCreateTableServiceRequest,
  dbGetServiceRequestById,
  dbGetShopServiceRequests,
  dbUpdateServiceRequestStatus,
} from '@/lib/service-requests';
import type {
  ServiceRequestStatus,
  SupportedLocale,
} from '@/types/qlaok';

function extractErrorCode(message: string): string | undefined {
  const match = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(message.trim());
  return match ? match[1] : undefined;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopId =
      (searchParams.get('shopId') || searchParams.get('shop_id') || '').trim() ||
      'shop-fnb-001';
    const includeResolved =
      searchParams.get('includeResolved') === '1' ||
      searchParams.get('includeResolved') === 'true';
    const tableId =
      searchParams.get('tableId') || searchParams.get('table_id') || undefined;

    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) return auth.errorResponse;

    const serviceRequests = await dbGetShopServiceRequests(shopId, {
      includeResolved,
      tableId: tableId || undefined,
    });

    return NextResponse.json({
      serviceRequests,
      membership: auth.membership,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể tải danh sách yêu cầu phục vụ.';
    const code = extractErrorCode(message);
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const rawShopId =
      typeof body.shop_id === 'string'
        ? body.shop_id
        : typeof body.shopId === 'string'
          ? body.shopId
          : undefined;
    const rawTableId =
      typeof body.table_id === 'string'
        ? body.table_id
        : typeof body.tableId === 'string'
          ? body.tableId
          : undefined;
    const rawTableLabel =
      typeof body.table_label === 'string'
        ? body.table_label
        : typeof body.tableLabel === 'string'
          ? body.tableLabel
          : undefined;
    const rawTableQrSig =
      typeof body.table_qr_sig === 'string'
        ? body.table_qr_sig
        : typeof body.tableQrSig === 'string'
          ? body.tableQrSig
          : typeof body.sig === 'string'
            ? body.sig
            : req.headers.get('x-table-qr-sig') ?? undefined;
    const rawRequestType =
      typeof body.request_type === 'string'
        ? body.request_type
        : typeof body.requestType === 'string'
          ? body.requestType
          : typeof body.type === 'string'
            ? body.type
            : undefined;
    const rawVisitorLang =
      typeof body.visitor_lang === 'string'
        ? body.visitor_lang
        : typeof body.visitorLang === 'string'
          ? body.visitorLang
          : 'vi';
    const rawIdempotencyKey =
      typeof body.idempotency_key === 'string'
        ? body.idempotency_key
        : typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey
          : req.headers.get('x-idempotency-key') ?? undefined;

    const result = await dbCreateTableServiceRequest({
      shop_id: rawShopId,
      table_id: rawTableId,
      table_label: rawTableLabel,
      table_qr_sig: rawTableQrSig,
      request_type: rawRequestType,
      visitor_lang: rawVisitorLang as SupportedLocale,
      idempotency_key: rawIdempotencyKey,
    });

    const { serviceRequest, deduplicated } = result;

    if (!deduplicated) {
      recordOrderAuditLog({
        shopId: serviceRequest.shop_id,
        orderId: serviceRequest.id,
        actorId: 'customer_qr',
        actorRole: 'customer',
        action: 'create_service_request',
        after: {
          table_id: serviceRequest.table_id,
          table_code: serviceRequest.table_code,
          table_label: serviceRequest.table_label,
          request_type: serviceRequest.request_type,
          status: serviceRequest.status,
        },
      });

      getOrderEventsBroker().notifyShopChange(serviceRequest.shop_id);
    }

    await sendServiceRequestPushNotifications({
      serviceRequest,
      isDeduplicated: deduplicated,
    }).catch(() => {});

    return NextResponse.json(
      { serviceRequest, deduplicated },
      { status: deduplicated ? 200 : 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể gửi yêu cầu phục vụ.';
    const code = extractErrorCode(message);
    const status =
      code === 'INVALID_TABLE_SHOP' ||
      code === 'INVALID_TABLE_QR_SIGNATURE' ||
      code === 'MISSING_TABLE_QR_SIGNATURE' ||
      code === 'TAKEAWAY_SERVICE_REQUEST_FORBIDDEN'
        ? 403
        : code === 'INACTIVE_SHOP_TABLE'
          ? 409
          : 400;
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const sessionAuth = await requireAuthenticatedUser(req);
    if (sessionAuth.errorResponse) return sessionAuth.errorResponse;

    const body = (await req.json()) as Record<string, unknown>;
    const requestId = (
      typeof body.id === 'string'
        ? body.id
        : typeof body.requestId === 'string'
          ? body.requestId
          : typeof body.request_id === 'string'
            ? body.request_id
            : typeof body.serviceRequestId === 'string'
              ? body.serviceRequestId
              : ''
    ).trim();

    if (!requestId) {
      return NextResponse.json(
        {
          error: 'MISSING_SERVICE_REQUEST_ID: Thiếu mã yêu cầu phục vụ (id).',
          code: 'MISSING_SERVICE_REQUEST_ID',
        },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const requestedShopId = (
      typeof body.shop_id === 'string'
        ? body.shop_id
        : typeof body.shopId === 'string'
          ? body.shopId
          : searchParams.get('shopId') || searchParams.get('shop_id') || ''
    ).trim();

    if (!requestedShopId) {
      return NextResponse.json(
        {
          error: 'MISSING_SHOP_ID: Thiếu mã cửa hàng (shop_id).',
          code: 'MISSING_SHOP_ID',
        },
        { status: 400 }
      );
    }

    const auth = await requireShopPermission(
      req,
      requestedShopId,
      'orders.view'
    );
    if (auth.errorResponse) return auth.errorResponse;

    const existing = await dbGetServiceRequestById(requestId, {
      shopId: requestedShopId,
    });
    if (!existing) {
      return NextResponse.json(
        {
          error: 'SERVICE_REQUEST_NOT_FOUND: Không tìm thấy yêu cầu phục vụ.',
          code: 'SERVICE_REQUEST_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const nextStatus = (
      typeof body.status === 'string' ? body.status.trim() : ''
    ) as ServiceRequestStatus;

    const updated = await dbUpdateServiceRequestStatus({
      id: existing.id,
      shop_id: requestedShopId,
      status: nextStatus,
      actor_id: auth.user.sub,
    });

    recordOrderAuditLog({
      shopId: requestedShopId,
      orderId: existing.id,
      actorId: auth.user.sub,
      actorRole: auth.membership.role,
      action: 'update_service_request',
      before: {
        status: existing.status,
        acknowledged_at: existing.acknowledged_at ?? null,
        resolved_at: existing.resolved_at ?? null,
      },
      after: {
        status: updated.status,
        acknowledged_at: updated.acknowledged_at ?? null,
        resolved_at: updated.resolved_at ?? null,
      },
    });

    getOrderEventsBroker().notifyShopChange(requestedShopId);

    return NextResponse.json({
      serviceRequest: updated,
      membership: auth.membership,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể cập nhật trạng thái yêu cầu phục vụ.';
    const code = extractErrorCode(message);
    const status =
      code === 'INVALID_SERVICE_REQUEST_TRANSITION'
        ? 409
        : code === 'FORBIDDEN_CROSS_SHOP_SERVICE_REQUEST'
          ? 403
          : code === 'SERVICE_REQUEST_NOT_FOUND'
            ? 404
            : 400;
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status }
    );
  }
}
