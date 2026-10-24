import { NextResponse } from 'next/server';
import {
  dbComputeShopRevenueAndInventoryStats,
  dbCreateOrder,
  dbGetOrderById,
  dbGetShopActiveKitchenOrders,
  dbGetShopOrders,
  dbGetTableBill,
  dbRecordOrderPrint,
  dbSettleTableBill,
  dbUpdateOrderStatus,
  quoteOrderPricing,
  wasOrderNewlyCreated,
} from '@/lib/mpos-store';
import {
  dbGetShopCatalog,
  dbRecordAnalyticsEvent,
} from '@/lib/db';
import { sendNewGuestOrderPushNotifications } from '@/lib/push-notifications';
import { dbGetShopServiceRequests } from '@/lib/service-requests';
import {
  getRequestShopMembership,
  recordOrderAuditLog,
  requireShopPermission,
} from '@/lib/server-auth';
import { hasShopPermission } from '@/lib/shop-permissions';
import { isTakeawayTableLabel } from '@/lib/table-helpers';
import type {
  OrderLineItem,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ShopOrder,
  ShopPermission,
  SupportedLocale,
  TicketPrintType,
} from '@/types/qlaok';

/** Extract a stable machine-readable code from "CODE: human message" errors. */
function extractOrderErrorCode(message: string): string | undefined {
  const match = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(message.trim());
  return match ? match[1] : undefined;
}

function isQueryFlagDisabled(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '0' || normalized === 'false';
}

function sanitizeCustomerOrderView(order: ShopOrder) {
  const {
    tracking_token: _t,
    idempotency_key: _i,
    payment_idempotency_key: _pi,
    paid_by: _pb,
    refunded_by: _rb,
    ...publicOrderView
  } = order;
  return publicOrderView;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');
    const trackingToken =
      searchParams.get('trackingToken') ||
      req.headers.get('x-tracking-token');
    const rawShopId = (searchParams.get('shopId') || '').trim();
    const shopId = rawShopId || 'shop-fnb-001';
    const action = searchParams.get('action');
    const view = searchParams.get('view');

    if (orderId) {
      const order = await dbGetOrderById(orderId);
      if (!order) {
        return NextResponse.json(
          { error: 'Không tìm thấy đơn hàng' },
          { status: 404 }
        );
      }

      const { membership } = await getRequestShopMembership(
        req,
        order.shop_id
      );
      if (hasShopPermission(membership, 'orders.view')) {
        return NextResponse.json({ order, membership });
      }

      // Customer order status tracker: require matching trackingToken when order has tracking_token
      if (
        !order.tracking_token || !trackingToken || trackingToken !== order.tracking_token
      ) {
        return NextResponse.json(
          {
            error:
              'Mã theo dõi đơn hàng (trackingToken) không hợp lệ hoặc bị thiếu.',
          },
          { status: 403 }
        );
      }

      return NextResponse.json({ order: sanitizeCustomerOrderView(order) });
    }

    if (action === 'table_bill' || searchParams.get('tableBill') === '1') {
      const auth = await requireShopPermission(req, shopId, 'orders.view');
      if (auth.errorResponse) return auth.errorResponse;

      const tableId =
        searchParams.get('tableId') || searchParams.get('table_id') || undefined;
      const tableLabel =
        searchParams.get('tableLabel') ||
        searchParams.get('table_label') ||
        undefined;
      const sessionId =
        searchParams.get('sessionId') ||
        searchParams.get('session_id') ||
        undefined;
      const tableBill = await dbGetTableBill({
        shop_id: shopId,
        table_id: tableId,
        table_label: tableLabel,
        session_id: sessionId,
      });
      return NextResponse.json({ tableBill, membership: auth.membership });
    }

    // Scoped Kitchen Display System (KDS) read path: requires explicit shopId and 'orders.view',
    // filters to active ('new', 'preparing') orders at the DB level before pagination/limits,
    // and avoids unrelated catalog/stats/service-request queries.
    if (
      view === 'kds' ||
      action === 'kds' ||
      searchParams.get('kds') === '1'
    ) {
      if (!rawShopId) {
        return NextResponse.json(
          {
            error: 'Thiếu mã cửa hàng (shopId).',
            code: 'SHOP_ID_REQUIRED',
          },
          { status: 400 }
        );
      }
      const auth = await requireShopPermission(req, rawShopId, 'orders.view');
      if (auth.errorResponse) return auth.errorResponse;

      const activeOrders = await dbGetShopActiveKitchenOrders(rawShopId);
      return NextResponse.json({
        orders: activeOrders,
        membership: auth.membership,
      });
    }

    // Lightweight dashboard header badge & live-notification read path: requires explicit shopId
    // and 'orders.view', reuses the scoped active-order helper filtered to 'new' orders plus
    // pending service requests, and avoids catalog and stats queries.
    if (view === 'badge') {
      if (!rawShopId) {
        return NextResponse.json(
          {
            error: 'Thiếu mã cửa hàng (shopId).',
            code: 'SHOP_ID_REQUIRED',
          },
          { status: 400 }
        );
      }
      const auth = await requireShopPermission(req, rawShopId, 'orders.view');
      if (auth.errorResponse) return auth.errorResponse;

      const [activeOrders, serviceRequests] = await Promise.all([
        dbGetShopActiveKitchenOrders(rawShopId),
        dbGetShopServiceRequests(rawShopId, {
          statuses: ['pending'],
        }).catch(() => []),
      ]);
      const newOrders = activeOrders.filter((order) => order.status === 'new');
      const pendingServiceRequests = serviceRequests.filter(
        (request) => request.status === 'pending'
      );

      return NextResponse.json({
        orders: newOrders,
        serviceRequests: pendingServiceRequests,
        membership: auth.membership,
      });
    }

    // Listing orders for a shop requires 'orders.view' permission
    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) return auth.errorResponse;

    const includeCatalog = !isQueryFlagDisabled(
      searchParams.get('includeCatalog')
    );
    const includeStats = !isQueryFlagDisabled(
      searchParams.get('includeStats')
    );

    const [orders, serviceRequests] = await Promise.all([
      dbGetShopOrders(shopId),
      dbGetShopServiceRequests(shopId).catch(() => []),
    ]);
    let catalogItems: Awaited<ReturnType<typeof dbGetShopCatalog>>['items'] = [];
    if (includeCatalog || includeStats) {
      try {
        const catalog = await dbGetShopCatalog(shopId);
        catalogItems = catalog.items;
      } catch {
        const { SEED_ITEMS } = await import('@/lib/seed-data');
        catalogItems = SEED_ITEMS.filter((i) => i.shop_id === shopId);
      }
    }

    const canViewReports = hasShopPermission(auth.membership, 'reports.view');
    const visibleOrders = canViewReports ? orders : orders.filter((order) =>
      order.status !== 'cancelled' && (order.status !== 'completed' || order.payment_status === 'unpaid')
    );
    let stats: unknown;
    if (includeStats) {
      const fullStats = await dbComputeShopRevenueAndInventoryStats(
        shopId,
        catalogItems
      );
      stats = canViewReports
        ? fullStats
        : {
            todayRevenue: null,
            todayGrossOrderAmount: null,
            todayUnpaidAmount: null,
            todayRefundedAmount: null,
            totalRefundedAmount: null,
            totalRevenue: null,
            avgOrderValue: null,
            todayOrdersCount: fullStats.todayOrdersCount,
            todayPaidOrdersCount: fullStats.todayPaidOrdersCount,
            todayCompletedCount: fullStats.todayCompletedCount,
            completedOrdersCount: fullStats.completedOrdersCount,
            paidOrdersCount: fullStats.paidOrdersCount,
            totalOrdersCount: fullStats.totalOrdersCount,
            newOrdersCount: fullStats.newOrdersCount,
            preparingOrdersCount: fullStats.preparingOrdersCount,
            lowStockCount: fullStats.lowStockCount,
            outOfStockCount: fullStats.outOfStockCount,
            lowStockItems: fullStats.lowStockItems,
            dailyRevenue7d: [],
            dailyRevenue7Days: [],
            paymentBreakdown: null,
            sourceBreakdown: null,
            hourlyBreakdown: [],
            topSellingItems: [],
          };
    }

    return NextResponse.json({
      orders: visibleOrders,
      serviceRequests,
      ...(includeStats ? { stats } : {}),
      ...(includeCatalog ? { items: catalogItems } : {}),
      membership: auth.membership,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Lỗi khi tải danh sách đơn';
    const code = extractOrderErrorCode(message);
    return NextResponse.json(
      {
        error: message,
        ...(code ? { code } : {}),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body as { action?: string };

    if (action === 'quote') {
      const shopId = body.shop_id || body.shopId;
      if (!shopId) {
        return NextResponse.json(
          { error: 'Thiếu mã cửa hàng (shop_id)' },
          { status: 400 }
        );
      }
      const { membership } = await getRequestShopMembership(req, shopId);
      const canApplyManualDiscount = hasShopPermission(
        membership,
        'discount.apply'
      );
      const quote = await quoteOrderPricing({
        shop_id: shopId,
        items: body.items || [],
        discount_amount: body.discount_amount,
        discount_code: body.discount_code,
        apply_shop_promotions: body.apply_shop_promotions !== false,
        canApplyManualDiscount,
      });
      return NextResponse.json({ quote });
    }

    if (action === 'settle_table_bill') {
      const shopId = body.shop_id || body.shopId;
      if (!shopId) {
        return NextResponse.json(
          { error: 'Thiếu mã cửa hàng (shop_id)' },
          { status: 400 }
        );
      }
      const auth = await requireShopPermission(
        req,
        shopId,
        body.markCompleted ? ['payment.collect', 'orders.fulfill'] : 'payment.collect'
      );
      if (auth.errorResponse) return auth.errorResponse;

      const tableBill = await dbSettleTableBill({
        shop_id: shopId,
        table_id: body.table_id ?? body.tableId,
        table_label: body.table_label || body.tableLabel,
        session_id: body.session_id || body.sessionId,
        payment_method: body.payment_method || 'cash',
        payment_idempotency_key:
          body.payment_idempotency_key ||
          req.headers.get('x-idempotency-key') ||
          undefined,
        paid_by: auth.user.sub,
        markCompleted: Boolean(body.markCompleted),
      });

      recordOrderAuditLog({
        shopId,
        orderId: tableBill.order_ids.join(','),
        actorId: auth.user.sub,
        actorRole: auth.membership.role,
        action: 'settle_table_bill',
        details: {
          table_id: tableBill.table_id ?? null,
          table_label: tableBill.table_label,
          session_id: tableBill.session_id,
          total_amount: tableBill.total_amount,
          payment_method: body.payment_method || 'cash',
        },
      });

      return NextResponse.json({ tableBill });
    }

    if (action === 'record_print') {
      const resolvedOrderId = body.orderId || body.order_id;
      const ticketType = (body.ticketType ||
        body.ticket_type ||
        body.printType ||
        body.print_type ||
        'receipt') as TicketPrintType;
      if (!['kitchen', 'provisional', 'receipt', 'label'].includes(ticketType)) {
        return NextResponse.json({ error: 'Loại phiếu không hợp lệ' }, { status: 400 });
      }
      if (!resolvedOrderId) {
        return NextResponse.json(
          { error: 'Thiếu mã đơn hàng (orderId)' },
          { status: 400 }
        );
      }
      const existing = await dbGetOrderById(resolvedOrderId);
      if (!existing) {
        return NextResponse.json(
          { error: 'Không tìm thấy đơn hàng' },
          { status: 404 }
        );
      }

      const requiredPerm: ShopPermission =
        ticketType === 'kitchen' || ticketType === 'label'
          ? 'orders.print_kitchen'
          : ticketType === 'provisional'
            ? 'orders.print_provisional'
            : 'orders.view';

      const auth = await requireShopPermission(
        req,
        existing.shop_id,
        requiredPerm
      );
      if (auth.errorResponse) return auth.errorResponse;

      if (ticketType === 'receipt' && existing.payment_status !== 'paid') {
        return NextResponse.json(
          {
            error:
              'Không thể in biên lai đã thu tiền cho đơn chưa thanh toán. Vui lòng chọn Phiếu tạm tính hoặc xác nhận thu tiền trước.',
          },
          { status: 409 }
        );
      }

      const printResult = await dbRecordOrderPrint(resolvedOrderId, ticketType);
      recordOrderAuditLog({
        shopId: existing.shop_id,
        orderId: existing.id,
        actorId: auth.user.sub,
        actorRole: auth.membership.role,
        action: `print_${ticketType}`,
        details: {
          printCount: printResult.printCount,
          isReprint: printResult.isReprint,
          bill_version: printResult.order.bill_version,
        },
      });

      return NextResponse.json(printResult);
    }

    const {
      shop_id,
      table_id,
      tableId,
      table_code,
      tableCode,
      table_label = 'Bàn khách',
      table_qr_sig,
      tableQrSig,
      sig,
      qr_table_mode,
      qrTableMode,
      session_id,
      visitor_lang = 'vi',
      customer_note = '',
      payment_method = 'cash',
      payment_status,
      source = 'qr_table',
      markCompletedImmediately = false,
      discount_amount = 0,
      discount_code,
      apply_shop_promotions,
      idempotency_key,
      payment_idempotency_key,
      items = [],
    } = body as {
      shop_id: string;
      table_id?: string | null;
      tableId?: string | null;
      table_code?: string | null;
      tableCode?: string | null;
      table_label?: string;
      table_qr_sig?: string | null;
      tableQrSig?: string | null;
      sig?: string | null;
      qr_table_mode?: boolean;
      qrTableMode?: boolean;
      session_id?: string;
      visitor_lang?: SupportedLocale;
      customer_note?: string;
      payment_method?: PaymentMethod;
      payment_status?: OrderPaymentStatus;
      source?: 'qr_table' | 'counter_pos';
      markCompletedImmediately?: boolean;
      discount_amount?: number;
      discount_code?: string;
      apply_shop_promotions?: boolean;
      idempotency_key?: string;
      payment_idempotency_key?: string;
      items: OrderLineItem[];
    };

    if (!shop_id) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shop_id)' },
        { status: 400 }
      );
    }

    const { user: sessionUser, membership } = await getRequestShopMembership(
      req,
      shop_id
    );

    const hasCreatePerm = hasShopPermission(membership, 'orders.create');
    const canApplyDiscount = hasShopPermission(membership, 'discount.apply');
    const canCollectPayment = hasShopPermission(membership, 'payment.collect');

    // Counter POS orders require an authenticated shop member with 'orders.create'
    if (source === 'counter_pos') {
      if (!sessionUser) {
        return NextResponse.json(
          { error: 'Vui lòng đăng nhập để tạo đơn tại quầy POS.' },
          { status: 401 }
        );
      }
      if (!hasCreatePerm) {
        return NextResponse.json(
          {
            error:
              'Bạn không có quyền tạo đơn hàng tại quầy cho cửa hàng này.',
          },
          { status: 403 }
        );
      }

      const hasLineDiscountRequest =
        Array.isArray(items) &&
        items.some(
          (l) =>
            (l.discount_percent !== undefined &&
              Number(l.discount_percent) > 0) ||
            (l.custom_unit_price !== undefined &&
              l.custom_unit_price !== null &&
              Number(l.custom_unit_price) < Number(l.unit_price || 0))
        );
      if (
        (Number(discount_amount || 0) > 0 || hasLineDiscountRequest) &&
        !canApplyDiscount
      ) {
        return NextResponse.json(
          {
            error: `Tài khoản (${membership?.role || 'staff'}) không có quyền áp dụng giảm giá.`,
            code: 'INSUFFICIENT_SHOP_PERMISSION',
          },
          { status: 403 }
        );
      }

      if (payment_status === 'paid' && !canCollectPayment) {
        return NextResponse.json(
          {
            error: `Tài khoản (${membership?.role || 'staff'}) không có quyền xác nhận thu tiền.`,
            code: 'INSUFFICIENT_SHOP_PERMISSION',
          },
          { status: 403 }
        );
      }
    } else if (hasCreatePerm && payment_status === 'paid' && !canCollectPayment) {
      return NextResponse.json(
        {
          error: `Tài khoản (${membership?.role || 'staff'}) không có quyền xác nhận thu tiền.`,
          code: 'INSUFFICIENT_SHOP_PERMISSION',
        },
        { status: 403 }
      );
    }

    if (body.expected_total !== undefined) {
      const expectedQuote = await quoteOrderPricing({
        shop_id, items, discount_amount, discount_code,
        apply_shop_promotions: Boolean(apply_shop_promotions) || Boolean(discount_code),
        canApplyManualDiscount: canApplyDiscount,
      });
      if (!Number.isFinite(Number(body.expected_total)) || Number(body.expected_total) !== expectedQuote.total_amount) {
        return NextResponse.json({ error: 'Giá hoặc ưu đãi đã thay đổi. Vui lòng kiểm tra lại tổng tiền.', code: 'PRICE_CHANGED', quote: expectedQuote }, { status: 409 });
      }
    }

    const rawTableId = table_id !== undefined ? table_id : tableId;
    const rawTableCode = table_code !== undefined ? table_code : tableCode;
    const rawTableLabel =
      typeof body.table_label === 'string'
        ? body.table_label
        : typeof body.tableLabel === 'string'
          ? body.tableLabel
          : undefined;
    const resolvedTableQrSig =
      table_qr_sig !== undefined
        ? table_qr_sig
        : tableQrSig !== undefined
          ? tableQrSig
          : sig !== undefined
            ? sig
            : req.headers.get('x-table-qr-sig') ?? undefined;
    const isAnonymousTakeaway =
      !hasCreatePerm &&
      !qr_table_mode &&
      !qrTableMode &&
      !(resolvedTableQrSig && String(resolvedTableQrSig).trim()) &&
      !(rawTableId && String(rawTableId).trim()) &&
      !(rawTableCode && String(rawTableCode).trim()) &&
      Boolean(rawTableLabel && isTakeawayTableLabel(rawTableLabel));
    const requireTableQrSig =
      Boolean(qr_table_mode || qrTableMode) ||
      (!hasCreatePerm && !isAnonymousTakeaway);

    const order = await dbCreateOrder({
      shop_id,
      table_id: rawTableId,
      table_code: rawTableCode,
      table_label,
      table_qr_sig: resolvedTableQrSig,
      require_table_qr_sig: requireTableQrSig,
      session_id,
      visitor_lang,
      customer_note,
      payment_method,
      payment_status,
      source,
      markCompletedImmediately,
      discount_amount,
      discount_code,
      apply_shop_promotions,
      canApplyDiscount,
      canCollectPayment,
      paid_by: canCollectPayment ? sessionUser?.sub : undefined,
      idempotency_key:
        idempotency_key || req.headers.get('x-idempotency-key') || undefined,
      payment_idempotency_key,
      isStaffAuthorized: hasCreatePerm,
      items,
    });

    const isOrderReplay = !wasOrderNewlyCreated(order);

    if (!isOrderReplay) {
      recordOrderAuditLog({
        shopId: shop_id,
        orderId: order.id,
        actorId: sessionUser?.sub || 'customer_qr',
        actorRole: membership?.role || 'customer',
        action: 'create_order',
        after: {
          status: order.status,
          payment_status: order.payment_status,
          subtotal_amount: order.subtotal_amount,
          discount_amount: order.discount_amount,
          total_amount: order.total_amount,
          source: order.source,
        },
      });

      // Record analytics event for table order submission
      dbRecordAnalyticsEvent({
        shop_id,
        event_type: 'show_to_staff',
        visitor_lang,
      }).catch(() => {});
    }

    // Dispatch localized mobile push notifications to shop owner and active members with orders.view
    // after guest QR order creation. Provider/network errors never fail the created order.
    const isGuestQrOrder =
      source !== 'counter_pos' && order.source === 'qr_table';
    if (isGuestQrOrder) {
      await sendNewGuestOrderPushNotifications({
        order,
        isGuestOrder: true,
        isReplay: isOrderReplay,
      }).catch(() => {});
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Không thể tạo đơn hàng';
    const code = extractOrderErrorCode(message);
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status: code === 'SHOP_CLOSED' ? 409 : 400 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      orderId,
      order_id,
      trackingToken,
      tracking_token,
      status,
      workflow_step_id,
      workflowStepId,
      payment_method,
      payment_status,
      payment_idempotency_key,
      refund_reason,
      cancelled_reason,
      restock_items,
      table_id,
      tableId,
      table_code,
      tableCode,
      table_label,
      table_qr_sig,
      tableQrSig,
      sig,
      customer_note,
      items,
      discount_amount,
    } = body as {
      orderId?: string;
      order_id?: string;
      trackingToken?: string;
      tracking_token?: string;
      status?: OrderStatus;
      workflow_step_id?: string | null;
      workflowStepId?: string | null;
      payment_method?: PaymentMethod;
      payment_status?: OrderPaymentStatus;
      payment_idempotency_key?: string;
      refund_reason?: string;
      cancelled_reason?: string;
      restock_items?: boolean;
      table_id?: string | null;
      tableId?: string | null;
      table_code?: string | null;
      tableCode?: string | null;
      table_label?: string;
      table_qr_sig?: string | null;
      tableQrSig?: string | null;
      sig?: string | null;
      customer_note?: string;
      items?: OrderLineItem[];
      discount_amount?: number;
    };

    const resolvedWorkflowStepId =
      workflow_step_id !== undefined ? workflow_step_id : workflowStepId;

    const resolvedTableId = table_id !== undefined ? table_id : tableId;
    const resolvedTableCode = table_code !== undefined ? table_code : tableCode;
    const resolvedTableQrSig =
      table_qr_sig !== undefined
        ? table_qr_sig
        : tableQrSig !== undefined
          ? tableQrSig
          : sig !== undefined
            ? sig
            : req.headers.get('x-table-qr-sig') ?? undefined;

    const resolvedOrderId = orderId || order_id;
    if (!resolvedOrderId) {
      return NextResponse.json(
        { error: 'Thiếu mã đơn hàng (orderId / order_id)' },
        { status: 400 }
      );
    }

    const existingOrder = await dbGetOrderById(resolvedOrderId);
    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Không tìm thấy đơn hàng' },
        { status: 404 }
      );
    }

    const { membership } = await getRequestShopMembership(
      req,
      existingOrder.shop_id
    );

    const resolvedTrackingToken =
      trackingToken ||
      tracking_token ||
      req.headers.get('x-tracking-token') ||
      undefined;

    // Customer pre-acceptance self-edit/cancel flow via trackingToken (when not an authenticated shop member)
    if ((!membership || !membership.is_active) && resolvedTrackingToken) {
      if (
        !existingOrder.tracking_token ||
        resolvedTrackingToken !== existingOrder.tracking_token
      ) {
        return NextResponse.json(
          {
            error: 'Mã theo dõi đơn hàng (trackingToken) không hợp lệ.',
            code: 'INVALID_TRACKING_TOKEN',
          },
          { status: 403 }
        );
      }

      if (
        existingOrder.status !== 'new' ||
        existingOrder.payment_status !== 'unpaid'
      ) {
        return NextResponse.json(
          {
            error:
              'Đơn hàng đã được bếp tiếp nhận hoặc đã thanh toán, không thể tự chỉnh sửa. Vui lòng báo nhân viên.',
            code: 'ORDER_ALREADY_ACCEPTED',
          },
          { status: 409 }
        );
      }

      if (
        (status && status !== 'new' && status !== 'cancelled') ||
        resolvedWorkflowStepId !== undefined ||
        (payment_status && payment_status !== 'unpaid') ||
        (discount_amount !== undefined && Number(discount_amount) > 0)
      ) {
        return NextResponse.json(
          {
            error:
              'Khách hàng chỉ được phép cập nhật món hoặc hủy đơn khi quán chưa tiếp nhận.',
            code: 'CUSTOMER_ACTION_FORBIDDEN',
          },
          { status: 403 }
        );
      }

      const updatedByCustomer = await dbUpdateOrderStatus(resolvedOrderId, {
        status: status === 'cancelled' ? 'cancelled' : undefined,
        table_id: resolvedTableId,
        table_code: resolvedTableCode,
        table_label,
        table_qr_sig: resolvedTableQrSig,
        require_table_qr_sig: true,
        customer_note,
        items,
        canApplyDiscount: false,
        require_new_unpaid: true,
      });

      recordOrderAuditLog({
        shopId: existingOrder.shop_id,
        orderId: existingOrder.id,
        actorId: 'customer_tracking',
        actorRole: 'customer',
        action:
          status === 'cancelled'
            ? 'customer_cancel_order'
            : 'customer_edit_order',
        before: {
          status: existingOrder.status,
          total_amount: existingOrder.total_amount,
          bill_version: existingOrder.bill_version,
        },
        after: {
          status: updatedByCustomer.status,
          total_amount: updatedByCustomer.total_amount,
          bill_version: updatedByCustomer.bill_version,
        },
      });

      return NextResponse.json({
        order: sanitizeCustomerOrderView(updatedByCustomer),
      });
    }

    // Authenticated shop member flow: determine required permissions from requested patch fields
    const requiredPerms = new Set<ShopPermission>();

    const isMarkingPaid =
      payment_status === 'paid' && existingOrder.payment_status !== 'paid';
    const isRefunding =
      payment_status === 'refunded' ||
      (existingOrder.payment_status === 'paid' && status === 'cancelled');
    const isChangingDiscount =
      discount_amount !== undefined &&
      Number(discount_amount) !== Number(existingOrder.discount_amount || 0);
    const isEditingItems = Array.isArray(items);
    const isCancellingUnpaid =
      status === 'cancelled' && existingOrder.payment_status !== 'paid';

    if (payment_status !== undefined || payment_method !== undefined || payment_idempotency_key !== undefined) {
      requiredPerms.add(payment_status === 'refunded' ? 'payment.refund' : 'payment.collect');
    }
    if (isRefunding) requiredPerms.add('payment.refund');
    if (isChangingDiscount || (Array.isArray(items) && items.some((line) =>
      line.discount_percent !== undefined || line.custom_unit_price != null
    ))) requiredPerms.add('discount.apply');
    if (
      isEditingItems ||
      resolvedTableId !== undefined ||
      resolvedTableCode !== undefined ||
      table_label !== undefined ||
      customer_note !== undefined
    ) {
      requiredPerms.add('orders.edit_items');
    }
    if (isCancellingUnpaid) requiredPerms.add('orders.cancel_unpaid');
    if (
      (status !== undefined &&
        status !== existingOrder.status &&
        status !== 'cancelled') ||
      (resolvedWorkflowStepId !== undefined && status !== 'cancelled')
    ) {
      requiredPerms.add('orders.fulfill');
    }
    if (requiredPerms.size === 0) requiredPerms.add('orders.fulfill');

    const auth = await requireShopPermission(
      req,
      existingOrder.shop_id,
      Array.from(requiredPerms)
    );
    if (auth.errorResponse) return auth.errorResponse;

    if (body.expected_total !== undefined) {
      const quote = Array.isArray(items) || discount_amount !== undefined
        ? await quoteOrderPricing({
            shop_id: existingOrder.shop_id, items: items || existingOrder.items,
            discount_amount: discount_amount ?? existingOrder.discount_amount,
            apply_shop_promotions: false,
            canApplyManualDiscount: hasShopPermission(auth.membership, 'discount.apply'),
          })
        : { total_amount: existingOrder.total_amount };
      if (!Number.isFinite(Number(body.expected_total)) || Number(body.expected_total) !== Number(quote.total_amount)) {
        return NextResponse.json({ error: 'Tổng tiền đã thay đổi. Vui lòng tải lại đơn trước khi xác nhận.', quote }, { status: 409 });
      }
    }

    if (status === 'cancelled' && existingOrder.payment_status === 'paid' && payment_status !== 'refunded') {
      return NextResponse.json({ error: 'Đơn đã thu tiền: hãy xác nhận hoàn tiền trước khi hủy.' }, { status: 409 });
    }

    const rawRefundReason =
      typeof refund_reason === 'string'
        ? refund_reason
        : typeof (body as { refundReason?: unknown }).refundReason === 'string'
          ? (body as { refundReason: string }).refundReason
          : undefined;
    const rawCancelledReason =
      typeof cancelled_reason === 'string'
        ? cancelled_reason
        : typeof (body as { cancel_reason?: unknown }).cancel_reason === 'string'
          ? (body as { cancel_reason: string }).cancel_reason
          : typeof (body as { cancelledReason?: unknown }).cancelledReason ===
              'string'
            ? (body as { cancelledReason: string }).cancelledReason
            : undefined;

    if (
      payment_status === 'refunded' &&
      existingOrder.payment_status !== 'refunded'
    ) {
      const trimmedRefundReason = rawRefundReason ? rawRefundReason.trim() : '';
      if (!trimmedRefundReason) {
        return NextResponse.json(
          {
            error: 'Vui lòng nhập lý do hoàn tiền.',
            code: 'REFUND_REASON_REQUIRED',
          },
          { status: 400 }
        );
      }
      if (trimmedRefundReason.length > 500) {
        return NextResponse.json(
          {
            error: 'Lý do hoàn tiền không được vượt quá 500 ký tự.',
            code: 'REASON_TOO_LONG',
          },
          { status: 400 }
        );
      }
    }

    if (status === 'cancelled' && existingOrder.status !== 'cancelled') {
      const trimmedCancelledReason = rawCancelledReason
        ? rawCancelledReason.trim()
        : '';
      if (!trimmedCancelledReason) {
        return NextResponse.json(
          {
            error: 'Vui lòng nhập lý do hủy đơn.',
            code: 'CANCEL_REASON_REQUIRED',
          },
          { status: 400 }
        );
      }
      if (trimmedCancelledReason.length > 500) {
        return NextResponse.json(
          {
            error: 'Lý do hủy đơn không được vượt quá 500 ký tự.',
            code: 'REASON_TOO_LONG',
          },
          { status: 400 }
        );
      }
    }

    const updated = await dbUpdateOrderStatus(resolvedOrderId, {
      status,
      workflow_step_id: resolvedWorkflowStepId,
      payment_method,
      payment_status,
      payment_idempotency_key:
        payment_idempotency_key ||
        req.headers.get('x-idempotency-key') ||
        undefined,
      paid_by: isMarkingPaid ? auth.user.sub : undefined,
      refund_reason: rawRefundReason?.trim(),
      refunded_by: isRefunding ? auth.user.sub : undefined,
      cancelled_reason: rawCancelledReason?.trim(),
      restock_items,
      table_id: resolvedTableId,
      table_code: resolvedTableCode,
      table_label,
      customer_note,
      items,
      discount_amount,
      canApplyDiscount: hasShopPermission(auth.membership, 'discount.apply'),
      expected_total: body.expected_total,
    });

    recordOrderAuditLog({
      shopId: existingOrder.shop_id,
      orderId: existingOrder.id,
      actorId: auth.user.sub,
      actorRole: auth.membership.role,
      action: 'update_order',
      before: {
        status: existingOrder.status,
        workflow_step_id: existingOrder.workflow_step_id,
        payment_status: existingOrder.payment_status,
        subtotal_amount: existingOrder.subtotal_amount,
        discount_amount: existingOrder.discount_amount,
        total_amount: existingOrder.total_amount,
        bill_version: existingOrder.bill_version,
      },
      after: {
        status: updated.status,
        workflow_step_id: updated.workflow_step_id,
        payment_status: updated.payment_status,
        subtotal_amount: updated.subtotal_amount,
        discount_amount: updated.discount_amount,
        total_amount: updated.total_amount,
        bill_version: updated.bill_version,
        waste_recorded: updated.waste_recorded,
        ...(updated.refund_reason
          ? { refund_reason: updated.refund_reason }
          : {}),
        ...(updated.cancelled_reason
          ? { cancelled_reason: updated.cancelled_reason }
          : {}),
      },
    });

    return NextResponse.json({ order: updated });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể cập nhật trạng thái đơn';
    const statusCode = /ORDER_ALREADY_PAID|CONCURRENT_|CUSTOMER_EDIT_LOCKED|AMBIGUOUS_WORKFLOW_TRANSITION/.test(message) ? 409 : message.startsWith('DB_COMMIT_FAILED') ? 503 : 400;
    const code = extractOrderErrorCode(message);
    return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: statusCode });
  }
}
