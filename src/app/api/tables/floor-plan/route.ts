import { NextResponse } from 'next/server';
import { requireShopPermission } from '@/lib/server-auth';
import { requireSupabaseServiceRoleClient } from '@/lib/db';
import {
  computeTableFloorPlanSummaries,
  type TableFloorPlanTableInput,
  type TableFloorPlanOrderInput,
} from '@/lib/table-floor-plan';
import type {
  OrderPaymentStatus,
  OrderStatus,
  TableFloorPlanItem,
} from '@/types/qlaok';

export type { TableFloorPlanItem };

const PAGE_SIZE = 500;
const MAX_RECORDS = 10000;

interface TableRow extends TableFloorPlanTableInput {
  section: string;
  capacity: number;
  layout_x?: number | null;
  layout_y?: number | null;
}

interface OrderRow extends TableFloorPlanOrderInput {
  id: string;
  shop_id: string;
  table_id?: string | null;
  table_label?: string | null;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  total_amount: number;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

async function fetchAllWithPagination<T>(
  createQuery: () => {
    range: (from: number, to: number) => PromiseLike<QueryResult<T>>;
  },
  entityName: string
): Promise<T[]> {
  const records: T[] = [];
  let from = 0;

  while (records.length < MAX_RECORDS) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await createQuery().range(from, to);

    if (error) {
      throw new Error(
        `QUERY_FAILED_${entityName.toUpperCase()}: ${error.message}`
      );
    }

    if (!Array.isArray(data)) {
      throw new Error(
        `QUERY_FAILED_${entityName.toUpperCase()}: Dữ liệu truy vấn không hợp lệ.`
      );
    }

    if (data.length === 0) {
      break;
    }

    records.push(...data);

    if (data.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  if (records.length > MAX_RECORDS) {
    throw new Error(
      `MAX_RECORDS_EXCEEDED_${entityName.toUpperCase()}: Vượt quá giới hạn tối đa ${MAX_RECORDS} bản ghi.`
    );
  }

  if (records.length === MAX_RECORDS) {
    const { data: lookaheadData, error: lookaheadError } = await createQuery().range(
      MAX_RECORDS,
      MAX_RECORDS
    );

    if (lookaheadError) {
      throw new Error(
        `QUERY_FAILED_${entityName.toUpperCase()}: ${lookaheadError.message}`
      );
    }

    if (!Array.isArray(lookaheadData)) {
      throw new Error(
        `QUERY_FAILED_${entityName.toUpperCase()}: Dữ liệu truy vấn không hợp lệ.`
      );
    }

    if (lookaheadData.length > 0) {
      throw new Error(
        `MAX_RECORDS_EXCEEDED_${entityName.toUpperCase()}: Vượt quá giới hạn tối đa ${MAX_RECORDS} bản ghi.`
      );
    }
  }

  return records;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopId = (
      searchParams.get('shopId') ||
      searchParams.get('shop_id') ||
      ''
    ).trim();

    if (!shopId) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shopId).' },
        { status: 400 }
      );
    }

    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const sb = requireSupabaseServiceRoleClient('GET /api/tables/floor-plan');

    const [tables, orders] = await Promise.all([
      fetchAllWithPagination<TableRow>(
        () =>
          sb
            .from('shop_tables')
            .select(
              'id, shop_id, name, table_code, section, capacity, is_active, is_archived, layout_x, layout_y'
            )
            .eq('shop_id', shopId)
            .eq('is_archived', false)
            .order('id', { ascending: true }),
        'tables'
      ),
      fetchAllWithPagination<OrderRow>(
        () =>
          sb
            .from('orders')
            .select(
              'id, shop_id, table_id, table_label, status, payment_status, total_amount'
            )
            .eq('shop_id', shopId)
            .or('status.in.(new,preparing),and(status.eq.completed,payment_status.eq.unpaid)')
            .order('id', { ascending: true }),
        'orders'
      ),
    ]);

    const summaries = computeTableFloorPlanSummaries(tables, orders);
    const summaryMap = new Map(summaries.map((s) => [s.table_id, s]));

    const responseTables: TableFloorPlanItem[] = tables.map((t) => {
      const summary = summaryMap.get(t.id);
      return {
        id: t.id,
        shop_id: t.shop_id,
        name: t.name,
        table_code: t.table_code,
        section: t.section ?? '',
        capacity: t.capacity ?? 4,
        is_active: Boolean(t.is_active),
        is_archived: Boolean(t.is_archived),
        layout_x: t.layout_x ?? null,
        layout_y: t.layout_y ?? null,
        floor_status:
          summary?.floor_status ?? (t.is_active ? 'free' : 'inactive'),
        open_order_count: summary?.open_order_count ?? 0,
        unpaid_amount: summary?.unpaid_amount ?? 0,
      };
    });

    return NextResponse.json({ tables: responseTables });
  } catch (error) {
    console.error('Lỗi truy vấn sơ đồ bàn:', error);
    return NextResponse.json(
      {
        error: 'Lỗi truy vấn sơ đồ bàn.',
        code: 'TABLE_FLOOR_PLAN_FETCH_FAILED',
      },
      { status: 500 }
    );
  }
}
