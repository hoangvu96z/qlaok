import { isTakeawayTableLabel } from '@/lib/table-helpers';
import type { ShopOrder, ShopTable, TableFloorStatus } from '@/types/qlaok';

export type { TableFloorStatus };

export type TableFloorPlanTableInput = Pick<
  ShopTable,
  'id' | 'shop_id' | 'name' | 'table_code' | 'is_active' | 'is_archived'
>;

export type TableFloorPlanOrderInput = Pick<
  ShopOrder,
  'id' | 'shop_id' | 'status' | 'payment_status' | 'total_amount'
> & {
  table_id?: string | null;
  table_label?: string | null;
};

export interface TableFloorPlanSummary {
  table_id: string;
  floor_status: TableFloorStatus;
  open_order_count: number;
  unpaid_amount: number;
}

/**
 * Safely converts total_amount into a finite, non-negative numeric amount.
 * Only finite numeric values contribute; negatives are clamped to zero,
 * and NaN, Infinity, or malformed truthy non-numeric values return 0.
 */
function toSafeFiniteAmount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

/**
 * Resolves the target table ID for an order.
 * Follows exact shop_id + canonical table_id matching first.
 * If table_id is absent, applies legacy fallback only when unambiguous
 * within the shop (label matches exactly one table's id, code, or name,
 * and is not a takeaway label).
 */
function resolveOrderTableId(
  order: TableFloorPlanOrderInput,
  tables: readonly TableFloorPlanTableInput[]
): string | null {
  const cleanOrderShopId = (order?.shop_id ?? '').trim();
  if (!cleanOrderShopId) return null;

  const rawTableId = (order?.table_id ?? '').trim();
  if (rawTableId) {
    return rawTableId;
  }

  const rawLabel = (order?.table_label ?? '').trim();
  if (!rawLabel || isTakeawayTableLabel(rawLabel)) {
    return null;
  }

  const needle = rawLabel.toLowerCase();
  const shopTables = (tables ?? []).filter(
    (t): t is TableFloorPlanTableInput => Boolean(t) && (t.shop_id ?? '').trim() === cleanOrderShopId
  );

  const matched = shopTables.filter((t) => {
    const idMatch = (t.id ?? '').trim().toLowerCase() === needle;
    const codeMatch = (t.table_code ?? '').trim().toLowerCase() === needle;
    const nameMatch = (t.name ?? '').trim().toLowerCase() === needle;
    return idMatch || codeMatch || nameMatch;
  });

  if (matched.length === 1) {
    return (matched[0]?.id ?? '').trim() || null;
  }

  return null;
}

/**
 * Pure aggregation function that summarizes floor plan metrics for each non-archived table.
 *
 * Rules:
 * - Inactive table => 'inactive'
 * - Else occupied if any non-cancelled new/preparing order
 * - Else waiting_payment if any completed unpaid order
 * - Else 'free'
 *
 * Open orders: non-cancelled new/preparing orders plus completed unpaid orders.
 * Unpaid amount: sum total_amount from non-cancelled orders with payment_status === 'unpaid'.
 */
export function computeTableFloorPlanSummaries(
  tables: readonly TableFloorPlanTableInput[],
  orders: readonly TableFloorPlanOrderInput[] = []
): TableFloorPlanSummary[] {
  if (!Array.isArray(tables) || tables.length === 0) {
    return [];
  }

  // Deduplicate orders by order.id when present to avoid double counting
  const seenOrderIds = new Set<string>();
  const deduplicatedOrders: TableFloorPlanOrderInput[] = [];
  for (const order of orders ?? []) {
    if (!order) continue;
    const cleanId = (order.id ?? '').trim();
    if (cleanId) {
      if (seenOrderIds.has(cleanId)) continue;
      seenOrderIds.add(cleanId);
    }
    deduplicatedOrders.push(order);
  }

  // Group orders by shop_id and resolved table_id for exact isolation
  const ordersByTableKey = new Map<string, TableFloorPlanOrderInput[]>();
  for (const order of deduplicatedOrders) {
    const cleanOrderShopId = (order.shop_id ?? '').trim();
    if (!cleanOrderShopId) continue;

    const resolvedTableId = resolveOrderTableId(order, tables);
    if (!resolvedTableId) continue;

    const key = `${cleanOrderShopId}::${resolvedTableId}`;
    const list = ordersByTableKey.get(key);
    if (list) {
      list.push(order);
    } else {
      ordersByTableKey.set(key, [order]);
    }
  }

  const summaries: TableFloorPlanSummary[] = [];

  for (const table of tables) {
    if (!table || table.is_archived) {
      continue;
    }

    const cleanShopId = (table.shop_id ?? '').trim();
    const cleanTableId = (table.id ?? '').trim();
    const key = `${cleanShopId}::${cleanTableId}`;
    const matchingOrders = ordersByTableKey.get(key) ?? [];

    const isInactive = table.is_active === false;

    let hasNonCancelledNewOrPreparing = false;
    let hasCompletedUnpaid = false;
    let open_order_count = 0;
    let unpaid_amount = 0;

    for (const order of matchingOrders) {
      const isCancelled = order.status === 'cancelled';
      const isNewOrPreparing =
        order.status === 'new' || order.status === 'preparing';
      const isCompleted = order.status === 'completed';
      const isUnpaid = order.payment_status === 'unpaid';

      if (!isCancelled && isNewOrPreparing) {
        hasNonCancelledNewOrPreparing = true;
      }

      if (!isCancelled && isCompleted && isUnpaid) {
        hasCompletedUnpaid = true;
      }

      if (!isCancelled && (isNewOrPreparing || (isCompleted && isUnpaid))) {
        open_order_count += 1;
      }

      if (!isCancelled && isUnpaid) {
        const amount = toSafeFiniteAmount(order.total_amount);
        unpaid_amount += amount;
      }
    }

    let floor_status: TableFloorStatus;
    if (isInactive) {
      floor_status = 'inactive';
    } else if (hasNonCancelledNewOrPreparing) {
      floor_status = 'occupied';
    } else if (hasCompletedUnpaid) {
      floor_status = 'waiting_payment';
    } else {
      floor_status = 'free';
    }

    summaries.push({
      table_id: table.id,
      floor_status,
      open_order_count,
      unpaid_amount,
    });
  }

  return summaries;
}

export const aggregateTableFloorPlan = computeTableFloorPlanSummaries;
export const aggregateTableFloorPlans = computeTableFloorPlanSummaries;
export const summarizeTableFloorPlan = computeTableFloorPlanSummaries;
export const summarizeTableFloorPlans = computeTableFloorPlanSummaries;
export const getTableFloorPlanSummaries = computeTableFloorPlanSummaries;

export default computeTableFloorPlanSummaries;
