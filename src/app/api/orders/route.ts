import { NextResponse } from 'next/server';
import {
  computeShopRevenueAndInventoryStats,
  dbCreateOrder,
  dbGetOrderById,
  dbGetShopOrders,
  dbUpdateOrderStatus,
} from '@/lib/mpos-store';
import {
  dbGetShopById,
  dbGetShopCatalog,
  dbRecordAnalyticsEvent,
} from '@/lib/db';
import {
  requireShopOwnerOrAdmin,
  verifyRequestUser,
} from '@/lib/server-auth';
import type {
  OrderLineItem,
  OrderStatus,
  PaymentMethod,
  SupportedLocale,
} from '@/types/qlaok';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');
    const trackingToken = searchParams.get('trackingToken');
    const shopId = searchParams.get('shopId') || 'shop-fnb-001';

    if (orderId) {
      const order = await dbGetOrderById(orderId);
      if (!order) {
        return NextResponse.json(
          { error: 'Không tìm thấy đơn hàng' },
          { status: 404 }
        );
      }

      const sessionUser = await verifyRequestUser(req);
      let isOwnerOrAdmin = sessionUser?.role === 'admin';
      if (!isOwnerOrAdmin && sessionUser) {
        const shop = await dbGetShopById(order.shop_id);
        isOwnerOrAdmin = shop?.owner_id === sessionUser.sub;
      }

      if (isOwnerOrAdmin) {
        return NextResponse.json({ order });
      }

      // Customer order status tracker: if order has a tracking_token and caller passes a mismatched token, reject
      if (
        order.tracking_token &&
        trackingToken &&
        trackingToken !== order.tracking_token
      ) {
        return NextResponse.json(
          { error: 'Mã theo dõi đơn hàng (trackingToken) không hợp lệ.' },
          { status: 403 }
        );
      }

      // Return sanitized customer tracking view (strip internal tokens)
      const { tracking_token: _t, idempotency_key: _i, ...publicOrderView } =
        order;
      return NextResponse.json({ order: publicOrderView });
    }

    // Listing all orders, inventory & revenue stats for a shop requires Shop Owner or Super Admin authentication
    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;

    const [orders, catalog] = await Promise.all([
      dbGetShopOrders(shopId),
      dbGetShopCatalog(shopId),
    ]);

    const stats = computeShopRevenueAndInventoryStats(
      shopId,
      catalog.items,
      orders
    );

    return NextResponse.json({
      orders,
      stats,
      items: catalog.items,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Lỗi khi tải danh sách đơn',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      shop_id,
      table_label = 'Bàn khách',
      visitor_lang = 'vi',
      customer_note = '',
      payment_method = 'cash',
      payment_status,
      source = 'qr_table',
      markCompletedImmediately = false,
      discount_amount = 0,
      idempotency_key,
      items = [],
    } = body as {
      shop_id: string;
      table_label?: string;
      visitor_lang?: SupportedLocale;
      customer_note?: string;
      payment_method?: PaymentMethod;
      payment_status?: 'unpaid' | 'paid';
      source?: 'qr_table' | 'counter_pos';
      markCompletedImmediately?: boolean;
      discount_amount?: number;
      idempotency_key?: string;
      items: OrderLineItem[];
    };

    if (!shop_id) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shop_id)' },
        { status: 400 }
      );
    }

    // Check if the request comes from the authenticated shop owner/staff or Super Admin
    let isStaffAuthorized = false;
    const sessionUser = await verifyRequestUser(req);
    if (sessionUser) {
      if (sessionUser.role === 'admin') {
        isStaffAuthorized = true;
      } else {
        const shop = await dbGetShopById(shop_id);
        if (shop && shop.owner_id === sessionUser.sub) {
          isStaffAuthorized = true;
        }
      }
    }

    const order = await dbCreateOrder({
      shop_id,
      table_label,
      visitor_lang,
      customer_note,
      payment_method,
      payment_status,
      source,
      markCompletedImmediately,
      discount_amount,
      idempotency_key:
        idempotency_key || req.headers.get('x-idempotency-key') || undefined,
      isStaffAuthorized,
      items,
    });

    // Record analytics event for table order submission
    dbRecordAnalyticsEvent({
      shop_id,
      event_type: 'show_to_staff',
      visitor_lang,
    }).catch(() => {});

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Không thể tạo đơn hàng',
      },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      orderId,
      order_id,
      status,
      payment_method,
      payment_status,
      table_label,
      customer_note,
      items,
      discount_amount,
    } = body as {
      orderId?: string;
      order_id?: string;
      status?: OrderStatus;
      payment_method?: PaymentMethod;
      payment_status?: 'unpaid' | 'paid';
      table_label?: string;
      customer_note?: string;
      items?: OrderLineItem[];
      discount_amount?: number;
    };

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

    // Only the authenticated shop owner or Super Admin can update order status / edit items / mark paid
    const auth = await requireShopOwnerOrAdmin(req, existingOrder.shop_id);
    if (auth.errorResponse) return auth.errorResponse;

    const updated = await dbUpdateOrderStatus(resolvedOrderId, {
      status,
      payment_method,
      payment_status,
      table_label,
      customer_note,
      items,
      discount_amount,
    });

    return NextResponse.json({ order: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Không thể cập nhật trạng thái đơn',
      },
      { status: 400 }
    );
  }
}
