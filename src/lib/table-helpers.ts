import type {
  ShopOrder,
  ShopTable,
  SupportedLocale,
  TableOrderStats,
} from '@/types/qlaok';
import { UI_LABELS } from '@/lib/i18n-helper';

const TAKEAWAY_LABELS = new Set([
  'mang về',
  'mang ve',
  'takeaway',
  'take away',
  'take-away',
  'tại quầy',
  'tai quay',
  'counter',
  'quầy',
  'quay',
]);

export function isTakeawayTableLabel(label?: string | null): boolean {
  const normalized = (label ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    TAKEAWAY_LABELS.has(normalized) ||
    normalized.startsWith('mang về') ||
    normalized.startsWith('mang ve') ||
    normalized.startsWith('takeaway') ||
    normalized.startsWith('take away')
  );
}

export function buildTableMenuUrl(
  baseUrl: string,
  slug: string,
  tableId: string,
  qrSig?: string | null
): string {
  const normalizedBase = (baseUrl ?? '').trim().replace(/\/+$/, '');
  const cleanSlug = encodeURIComponent((slug ?? '').trim());
  const cleanTableId = (tableId ?? '').trim();
  const cleanSig = (qrSig ?? '').trim();
  const path = `${normalizedBase}/s/${cleanSlug}/menu`;
  if (!cleanTableId) {
    return `${path}?src=table`;
  }
  const baseQuery = `${path}?src=table&tableId=${encodeURIComponent(cleanTableId)}`;
  if (!cleanSig) {
    return baseQuery;
  }
  return `${baseQuery}&sig=${encodeURIComponent(cleanSig)}`;
}

export function filterSelectableTables(
  tables: ShopTable[] | null | undefined,
  shopId?: string | null
): ShopTable[] {
  if (!Array.isArray(tables)) return [];
  const cleanShopId = (shopId ?? '').trim();
  return tables
    .filter((t) => {
      if (!t || !t.id || !t.name) return false;
      if (cleanShopId && t.shop_id !== cleanShopId) return false;
      return !t.is_archived && Boolean(t.is_active);
    })
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      return a.name.localeCompare(b.name, 'vi');
    });
}

export function resolveTableSelection(
  tables: ShopTable[],
  input: { tableId?: string | null; table?: string | null },
  locale: SupportedLocale = 'vi'
): { table: ShopTable | null; error: string | null } {
  const rawTableId = (input?.tableId ?? '').trim();
  const rawTable = (input?.table ?? '').trim();

  if (!rawTableId && !rawTable) {
    return { table: null, error: null };
  }

  const list = Array.isArray(tables) ? tables : [];
  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  // tableId takes precedence when provided
  if (rawTableId) {
    const exactOrCaseMatch =
      list.find((t) => t.id === rawTableId) ||
      list.find((t) => t.id.trim().toLowerCase() === rawTableId.toLowerCase());

    if (!exactOrCaseMatch) {
      return {
        table: null,
        error: labels.tableQrInvalidError,
      };
    }

    if (exactOrCaseMatch.is_archived || !exactOrCaseMatch.is_active) {
      return {
        table: null,
        error: labels.tableInactiveError(exactOrCaseMatch.name),
      };
    }

    return { table: exactOrCaseMatch, error: null };
  }

  // Fallback to legacy ?table= code or name parameter
  const needle = rawTable.toLowerCase();
  const activeMatch = list.find(
    (t) =>
      !t.is_archived &&
      t.is_active &&
      (t.id.trim().toLowerCase() === needle ||
        t.table_code.trim().toLowerCase() === needle ||
        t.name.trim().toLowerCase() === needle)
  );

  if (activeMatch) {
    return { table: activeMatch, error: null };
  }

  const inactiveMatch = list.find(
    (t) =>
      t.id.trim().toLowerCase() === needle ||
      t.table_code.trim().toLowerCase() === needle ||
      t.name.trim().toLowerCase() === needle
  );

  if (inactiveMatch) {
    return {
      table: null,
      error: labels.tableInactiveError(inactiveMatch.name),
    };
  }

  return {
    table: null,
    error: labels.tableNotFoundError(rawTable),
  };
}

export function summarizeOrdersByTable(
  orders: ShopOrder[],
  shopId: string,
  tables?: ShopTable[]
): TableOrderStats[] {
  const cleanShopId = (shopId ?? '').trim();
  if (!cleanShopId || !Array.isArray(orders)) {
    return [];
  }

  const tableById = new Map<string, ShopTable>();
  for (const t of tables ?? []) {
    if (t && t.shop_id === cleanShopId && t.id) {
      tableById.set(t.id, t);
    }
  }

  const seenOrderIds = new Set<string>();
  const groups = new Map<string, TableOrderStats>();

  for (const order of orders) {
    if (!order || order.shop_id !== cleanShopId) continue;
    if (order.id) {
      if (seenOrderIds.has(order.id)) continue;
      seenOrderIds.add(order.id);
    }

    const rawTableId = (order.table_id ?? '').trim();
    const rawLabel = (order.table_label ?? '').trim();

    let key: string;
    let tableId: string | null = null;
    let tableLabel: string;
    let kind: 'managed' | 'takeaway' | 'legacy';

    if (rawTableId) {
      key = `managed:${rawTableId}`;
      tableId = rawTableId;
      kind = 'managed';
      const managed = tableById.get(rawTableId);
      tableLabel = managed?.name || rawLabel || rawTableId;
    } else if (isTakeawayTableLabel(rawLabel)) {
      key = 'takeaway';
      tableId = null;
      kind = 'takeaway';
      tableLabel = 'Mang về';
    } else {
      const legacyDisplay = rawLabel || 'Khách lẻ';
      key = `legacy:${legacyDisplay.toLowerCase()}`;
      tableId = null;
      kind = 'legacy';
      tableLabel = legacyDisplay;
    }

    let stats = groups.get(key);
    if (!stats) {
      stats = {
        key,
        table_id: tableId,
        table_label: tableLabel,
        kind,
        orderCount: 0,
        paidOrderCount: 0,
        unpaidOrderCount: 0,
        cancelledOrderCount: 0,
        refundedOrderCount: 0,
        collectedRevenue: 0,
        unpaidAmount: 0,
        refundedAmount: 0,
      };
      groups.set(key, stats);
    } else if (kind === 'managed' && tableById.has(rawTableId)) {
      stats.table_label = tableById.get(rawTableId)!.name;
    }

    const amount = Math.max(0, Number(order.total_amount || 0));
    stats.orderCount += 1;

    if (order.status === 'cancelled') {
      stats.cancelledOrderCount += 1;
      if (order.payment_status === 'refunded') {
        stats.refundedOrderCount += 1;
        stats.refundedAmount += amount;
      }
      continue;
    }

    if (order.payment_status === 'paid') {
      stats.paidOrderCount += 1;
      stats.collectedRevenue += amount;
    } else if (order.payment_status === 'refunded') {
      stats.refundedOrderCount += 1;
      stats.refundedAmount += amount;
    } else {
      stats.unpaidOrderCount += 1;
      stats.unpaidAmount += amount;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (b.collectedRevenue !== a.collectedRevenue) {
      return b.collectedRevenue - a.collectedRevenue;
    }
    if (b.orderCount !== a.orderCount) {
      return b.orderCount - a.orderCount;
    }
    return a.table_label.localeCompare(b.table_label, 'vi');
  });
}
