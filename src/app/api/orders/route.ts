import { NextResponse } from 'next/server';
import {
  computeShopRevenueAndInventoryStats,
  dbCreateOrder,
  dbGetOrderById,
  dbGetShopOrders,
  dbUpdateOrderStatus,
} from '@/lib/mpos-store';
import { dbGetShopCatalog, dbRecordAnalyticsEvent } from '@/lib/db';
import {
  OrderLineItem,
  OrderStatus,
  PaymentMethod,
  SupportedLocale,
} from '@/types/qlaok';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('orderId');
    const shopId = searchParams.get('shopId') || 'shop-fnb-001';

    if (orderId) {
      const order = await dbGetOrderById(orderId);
      if (!order) {
        return NextResponse.json(
          { error: 'Không tìm thấy đơn hàng' },
          { status: 404 }
        );
      }
      return NextResponse.json({ order });
    }

    const [orders, catalog] = await Promise.all([
      dbGetShopOrders(shopId),
      dbGetShopCatalog(shopId),
    ]);

    const stats = computeShopRevenueAndInventoryStats(shopId, catalog.items);

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
      source = 'qr_table',
      markCompletedImmediately = false,
      items = [],
    } = body as {
      shop_id: string;
      table_label?: string;
      visitor_lang?: SupportedLocale;
      customer_note?: string;
      payment_method?: PaymentMethod;
      source?: 'qr_table' | 'counter_pos';
      markCompletedImmediately?: boolean;
      items: OrderLineItem[];
    };

    if (!shop_id) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shop_id)' },
        { status: 400 }
      );
    }

    const order = await dbCreateOrder({
      shop_id,
      table_label,
      visitor_lang,
      customer_note,
      payment_method,
      source,
      markCompletedImmediately,
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
    } = body as {
      orderId?: string;
      order_id?: string;
      status?: OrderStatus;
      payment_method?: PaymentMethod;
      payment_status?: 'unpaid' | 'paid';
    };

    const resolvedOrderId = orderId || order_id;
    if (!resolvedOrderId) {
      return NextResponse.json(
        { error: 'Thiếu mã đơn hàng (orderId / order_id)' },
        { status: 400 }
      );
    }

    const updated = await dbUpdateOrderStatus(resolvedOrderId, {
      status,
      payment_method,
      payment_status,
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
