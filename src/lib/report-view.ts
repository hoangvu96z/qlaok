import type {
  OrderLineItem,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ShopOrder,
  ShopTable,
  TableOrderStats,
} from '@/types/qlaok';
import type { ExportDataset } from '@/lib/table-export';
import { summarizeOrdersByTable } from '@/lib/table-helpers';

export type DateRangeMode =
  | 'today'
  | 'yesterday'
  | '7days'
  | '30days'
  | 'this_month'
  | 'single_day'
  | 'custom_range'
  | 'all';

export type ReportViewTab =
  | 'orders_list'
  | 'tables_summary'
  | 'daily_summary'
  | 'items_summary';

export type ReportExportScope = 'all_filtered' | 'current_page';

export type ReportStatusFilter =
  | 'valid_only'
  | 'all'
  | 'completed'
  | 'preparing'
  | 'new'
  | 'cancelled';

export type ReportPaymentStatusFilter = 'all' | 'paid' | 'unpaid' | 'refunded';
export type ReportPaymentMethodFilter = 'all' | 'cash' | 'vietqr';
export type ReportSourceFilter = 'all' | 'counter_pos' | 'qr_table';
export type SortDirection = 'asc' | 'desc';

export interface ReportSortState {
  columnId: string;
  direction: SortDirection;
}

export interface ReportFilters {
  rangeMode: DateRangeMode;
  singleDate: string;
  customFrom: string;
  customTo: string;
  statusFilter: ReportStatusFilter;
  paymentStatusFilter: ReportPaymentStatusFilter;
  paymentMethodFilter: ReportPaymentMethodFilter;
  sourceFilter: ReportSourceFilter;
  searchQuery: string;
}

export interface EffectiveDateBounds {
  start: string;
  end: string;
  label: string;
}

export interface ReportTranslator {
  (
    vi: string,
    en: string,
    vars?: Record<string, string | number>
  ): string;
}

export interface OrderLinePricingBreakdown {
  quantity: number;
  baseUnitPrice: number;
  extraPrice: number;
  grossUnitPrice: number;
  grossLineTotal: number;
}

export interface ReportKpiStats {
  totalCount: number;
  validCount: number;
  cancelledCount: number;
  paidCount: number;
  unpaidCount: number;
  refundedCount: number;
  collectedRevenue: number;
  totalRevenue: number;
  unpaidAmount: number;
  refundedAmount: number;
  totalDiscount: number;
  grossItemSales: number;
  cashCount: number;
  cashRevenue: number;
  vietqrCount: number;
  vietqrRevenue: number;
  totalItemsSold: number;
  avgOrderValue: number;
}

export interface DailySummaryRow {
  dateKey: string;
  ordersCount: number;
  paidOrdersCount: number;
  unpaidOrdersCount: number;
  refundedOrdersCount: number;
  cancelledOrdersCount: number;
  itemsSold: number;
  cashRevenue: number;
  vietqrRevenue: number;
  collectedRevenue: number;
  totalRevenue: number;
  unpaidAmount: number;
  refundedAmount: number;
}

export interface ItemSummaryRow {
  itemKey: string;
  itemId: string | null;
  itemName: string;
  orderAppearances: number;
  quantitySold: number;
  paidQuantitySold: number;
  grossSales: number;
  paidGrossSales: number;
  revenue: number;
  grossSharePercent: number;
}

export interface CanonicalColumnSpec<T> {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'money';
  getExportValue: (row: T, index: number) => string | number | null;
  getSortValue?: (row: T) => string | number;
}

const defaultTx: ReportTranslator = (vi, _en, vars) => {
  if (!vars) return vi;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    vi
  );
};

export function createLocaleTranslator(locale: 'vi' | 'en'): ReportTranslator {
  return (vi, en, vars) => {
    const base = locale === 'en' ? en : vi;
    if (!vars) return base;
    return Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
      base
    );
  };
}

export function getVnDateKey(
  dateInput: Date | string | number = new Date()
): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export function getVnDateTimeString(
  dateInput: Date | string | number
): string {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function getVnTimeString(dateInput: Date | string | number): string {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const base = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return getVnDateKey();
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export function formatDateKeyVi(dateKey: string): string {
  const [y, m, d] = String(dateKey || '').split('-');
  if (!y || !m || !d) return dateKey;
  return `${d}/${m}/${y}`;
}

export function formatChoicesText(choices: unknown): string {
  if (!Array.isArray(choices) || choices.length === 0) return '';
  return choices
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        const obj = c as {
          label_vi?: string;
          label_i18n?: { vi?: string; en?: string };
          extra_price?: number;
        };
        return obj.label_vi || obj.label_i18n?.vi || obj.label_i18n?.en || '';
      }
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

export function formatOrderItemsText(
  order: Pick<ShopOrder, 'items' | 'customer_note'>,
  separator = ' | '
): string {
  const linesText = (order.items || [])
    .map((it) => {
      const qty = Math.max(1, Number(it.quantity || 1));
      const optText = formatChoicesText(it.selected_choices);
      const noteText = it.custom_note ? ` [${it.custom_note}]` : '';
      return `${qty}x ${it.name_vi}${optText ? ` (${optText})` : ''}${noteText}`;
    })
    .join(separator);

  if (order.customer_note && order.customer_note.trim()) {
    return linesText
      ? `${linesText} — (${order.customer_note.trim()})`
      : order.customer_note.trim();
  }
  return linesText;
}

export function getOrderTotalQuantity(
  order: Pick<ShopOrder, 'items'>
): number {
  return (order.items || []).reduce(
    (sum, it) => sum + Math.max(1, Number(it.quantity || 1)),
    0
  );
}

/**
 * Canonical line pricing derived from server-validated OrderLineItem:
 * `original_unit_price ?? unit_price` is catalog base price, `extra_price` is option add-ons.
 */
export function computeOrderLinePricing(
  line: OrderLineItem
): OrderLinePricingBreakdown {
  const quantity = Math.max(1, Number(line?.quantity || 1));
  const baseUnitPrice = Math.max(
    0,
    Number(
      line?.original_unit_price ??
        line?.catalog_unit_price ??
        line?.unit_price ??
        0
    )
  );
  const extraPrice = Math.max(0, Number(line?.extra_price || 0));
  const grossUnitPrice = baseUnitPrice + extraPrice;
  const grossLineTotal = grossUnitPrice * quantity;

  return {
    quantity,
    baseUnitPrice,
    extraPrice,
    grossUnitPrice,
    grossLineTotal,
  };
}

export function computeEffectiveDateBounds(
  params: {
    rangeMode: DateRangeMode;
    singleDate?: string;
    customFrom?: string;
    customTo?: string;
    nowKey?: string;
  },
  tx: ReportTranslator = defaultTx
): EffectiveDateBounds {
  const nowKey = params.nowKey || getVnDateKey();
  switch (params.rangeMode) {
    case 'today':
      return {
        start: nowKey,
        end: nowKey,
        label: tx('Hôm nay ({date})', 'Today ({date})', {
          date: formatDateKeyVi(nowKey),
        }),
      };
    case 'yesterday': {
      const yKey = shiftDateKey(nowKey, -1);
      return {
        start: yKey,
        end: yKey,
        label: tx('Hôm qua ({date})', 'Yesterday ({date})', {
          date: formatDateKeyVi(yKey),
        }),
      };
    }
    case '7days': {
      const sKey = shiftDateKey(nowKey, -6);
      return {
        start: sKey,
        end: nowKey,
        label: tx(
          '7 ngày qua ({start} - {end})',
          'Last 7 days ({start} - {end})',
          {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }
        ),
      };
    }
    case '30days': {
      const sKey = shiftDateKey(nowKey, -29);
      return {
        start: sKey,
        end: nowKey,
        label: tx(
          '30 ngày qua ({start} - {end})',
          'Last 30 days ({start} - {end})',
          {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }
        ),
      };
    }
    case 'this_month': {
      const sKey = `${nowKey.slice(0, 7)}-01`;
      return {
        start: sKey,
        end: nowKey,
        label: tx(
          'Tháng này ({start} - {end})',
          'This month ({start} - {end})',
          {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }
        ),
      };
    }
    case 'single_day': {
      const dKey = params.singleDate || nowKey;
      return {
        start: dKey,
        end: dKey,
        label: tx('Ngày {date}', 'Date {date}', {
          date: formatDateKeyVi(dKey),
        }),
      };
    }
    case 'custom_range': {
      const from = params.customFrom || nowKey;
      const to = params.customTo || nowKey;
      const start = from <= to ? from : to;
      const end = from <= to ? to : from;
      return {
        start,
        end,
        label: tx('Từ {start} đến {end}', '{start} to {end}', {
          start: formatDateKeyVi(start),
          end: formatDateKeyVi(end),
        }),
      };
    }
    case 'all':
    default:
      return {
        start: '0000-01-01',
        end: '9999-12-31',
        label: tx('Tất cả thời gian', 'All time'),
      };
  }
}

export function buildManagedTableMap(
  shopTables?: ShopTable[] | null,
  shopId?: string | null
): Map<string, ShopTable> {
  const map = new Map<string, ShopTable>();
  const cleanShopId = (shopId ?? '').trim();
  for (const tb of shopTables ?? []) {
    if (!tb || !tb.id) continue;
    if (cleanShopId && tb.shop_id !== cleanShopId) continue;
    map.set(tb.id, tb);
  }
  return map;
}

export function filterReportOrders(
  orders: ShopOrder[],
  filters: {
    dateBounds: Pick<EffectiveDateBounds, 'start' | 'end'>;
    statusFilter: ReportStatusFilter;
    paymentStatusFilter: ReportPaymentStatusFilter;
    paymentMethodFilter: ReportPaymentMethodFilter;
    sourceFilter: ReportSourceFilter;
    searchQuery: string;
  },
  options?: {
    shopId?: string | null;
    tableById?: Map<string, ShopTable>;
    shopTables?: ShopTable[];
  }
): ShopOrder[] {
  if (!Array.isArray(orders)) return [];
  const cleanShopId = (options?.shopId ?? '').trim();
  const tableMap =
    options?.tableById ??
    buildManagedTableMap(options?.shopTables, cleanShopId || undefined);
  const q = (filters.searchQuery || '').trim().toLowerCase();

  return orders.filter((ord) => {
    if (!ord) return false;
    if (cleanShopId && ord.shop_id !== cleanShopId) return false;

    const ordDateKey = getVnDateKey(ord.created_at);
    if (
      ordDateKey < filters.dateBounds.start ||
      ordDateKey > filters.dateBounds.end
    ) {
      return false;
    }

    if (filters.statusFilter === 'valid_only' && ord.status === 'cancelled') {
      return false;
    }
    if (
      filters.statusFilter !== 'valid_only' &&
      filters.statusFilter !== 'all' &&
      ord.status !== filters.statusFilter
    ) {
      return false;
    }

    if (
      filters.paymentStatusFilter !== 'all' &&
      ord.payment_status !== filters.paymentStatusFilter
    ) {
      return false;
    }

    if (
      filters.paymentMethodFilter !== 'all' &&
      ord.payment_method !== filters.paymentMethodFilter
    ) {
      return false;
    }

    if (
      filters.sourceFilter !== 'all' &&
      ord.source !== filters.sourceFilter
    ) {
      return false;
    }

    if (q) {
      const managedTable = ord.table_id
        ? tableMap.get(ord.table_id)
        : undefined;
      const matchCode = ord.order_code?.toLowerCase().includes(q);
      const matchTable =
        ord.table_label?.toLowerCase().includes(q) ||
        managedTable?.name?.toLowerCase().includes(q) ||
        managedTable?.table_code?.toLowerCase().includes(q);
      const matchNote = ord.customer_note?.toLowerCase().includes(q);
      const matchItems = (ord.items || []).some((it) =>
        it.name_vi?.toLowerCase().includes(q)
      );
      if (!matchCode && !matchTable && !matchNote && !matchItems) {
        return false;
      }
    }

    return true;
  });
}

export function computeReportKpiStats(
  filteredOrders: ShopOrder[]
): ReportKpiStats {
  const list = Array.isArray(filteredOrders) ? filteredOrders : [];
  const validOrders = list.filter((o) => o.status !== 'cancelled');
  const cancelledOrders = list.filter((o) => o.status === 'cancelled');
  const paidOrders = validOrders.filter((o) => o.payment_status === 'paid');
  const unpaidOrders = validOrders.filter(
    (o) => o.payment_status !== 'paid' && o.payment_status !== 'refunded'
  );
  const refundedOrders = list.filter((o) => o.payment_status === 'refunded');

  const collectedRevenue = paidOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.total_amount || 0)),
    0
  );
  const unpaidAmount = unpaidOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.total_amount || 0)),
    0
  );
  const refundedAmount = refundedOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.total_amount || 0)),
    0
  );
  const totalDiscount = validOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.discount_amount || 0)),
    0
  );
  const grossItemSales = validOrders.reduce(
    (sum, o) =>
      sum +
      (o.items || []).reduce(
        (lineSum, line) => lineSum + computeOrderLinePricing(line).grossLineTotal,
        0
      ),
    0
  );

  const cashOrders = paidOrders.filter((o) => o.payment_method === 'cash');
  const vietqrOrders = paidOrders.filter((o) => o.payment_method === 'vietqr');
  const cashRevenue = cashOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.total_amount || 0)),
    0
  );
  const vietqrRevenue = vietqrOrders.reduce(
    (sum, o) => sum + Math.max(0, Number(o.total_amount || 0)),
    0
  );
  const totalItemsSold = validOrders.reduce(
    (sum, o) => sum + getOrderTotalQuantity(o),
    0
  );

  return {
    totalCount: list.length,
    validCount: validOrders.length,
    cancelledCount: cancelledOrders.length,
    paidCount: paidOrders.length,
    unpaidCount: unpaidOrders.length,
    refundedCount: refundedOrders.length,
    collectedRevenue,
    totalRevenue: collectedRevenue,
    unpaidAmount,
    refundedAmount,
    totalDiscount,
    grossItemSales,
    cashCount: cashOrders.length,
    cashRevenue,
    vietqrCount: vietqrOrders.length,
    vietqrRevenue,
    totalItemsSold,
    avgOrderValue:
      paidOrders.length > 0
        ? Math.round(collectedRevenue / paidOrders.length)
        : 0,
  };
}

/**
 * Daily summary aligned with KPI & table summary:
 * - `cashRevenue`, `vietqrRevenue`, `collectedRevenue` (`totalRevenue`) count ONLY non-cancelled PAID orders.
 * - `ordersCount` and `itemsSold` count non-cancelled valid orders and their sold item quantities.
 * - `unpaidAmount` and `refundedAmount` are tracked separately and never mixed into collected revenue.
 */
export function summarizeOrdersByDay(
  filteredOrders: ShopOrder[]
): DailySummaryRow[] {
  const map = new Map<string, DailySummaryRow>();

  for (const ord of filteredOrders || []) {
    if (!ord) continue;
    const dKey = getVnDateKey(ord.created_at);
    const amount = Math.max(0, Number(ord.total_amount || 0));

    if (ord.status === 'cancelled') {
      if (ord.payment_status === 'refunded') {
        const curr = map.get(dKey) || {
          dateKey: dKey,
          ordersCount: 0,
          paidOrdersCount: 0,
          unpaidOrdersCount: 0,
          refundedOrdersCount: 0,
          cancelledOrdersCount: 0,
          itemsSold: 0,
          cashRevenue: 0,
          vietqrRevenue: 0,
          collectedRevenue: 0,
          totalRevenue: 0,
          unpaidAmount: 0,
          refundedAmount: 0,
        };
        curr.cancelledOrdersCount += 1;
        curr.refundedOrdersCount += 1;
        curr.refundedAmount += amount;
        map.set(dKey, curr);
      }
      continue;
    }

    const curr = map.get(dKey) || {
      dateKey: dKey,
      ordersCount: 0,
      paidOrdersCount: 0,
      unpaidOrdersCount: 0,
      refundedOrdersCount: 0,
      cancelledOrdersCount: 0,
      itemsSold: 0,
      cashRevenue: 0,
      vietqrRevenue: 0,
      collectedRevenue: 0,
      totalRevenue: 0,
      unpaidAmount: 0,
      refundedAmount: 0,
    };

    const itemQty = getOrderTotalQuantity(ord);
    curr.ordersCount += 1;
    curr.itemsSold += itemQty;

    if (ord.payment_status === 'paid') {
      curr.paidOrdersCount += 1;
      curr.collectedRevenue += amount;
      curr.totalRevenue = curr.collectedRevenue;
      if (ord.payment_method === 'vietqr') {
        curr.vietqrRevenue += amount;
      } else {
        curr.cashRevenue += amount;
      }
    } else if (ord.payment_status === 'refunded') {
      curr.refundedOrdersCount += 1;
      curr.refundedAmount += amount;
    } else {
      curr.unpaidOrdersCount += 1;
      curr.unpaidAmount += amount;
    }

    map.set(dKey, curr);
  }

  return Array.from(map.values()).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey)
  );
}

/**
 * Item summary using canonical line totals `(original_unit_price ?? unit_price) + extra_price`.
 * Distinguishes gross item sales (`grossSales`) from order-level net collected revenue.
 */
export function summarizeOrdersByItem(
  filteredOrders: ShopOrder[],
  fallbackItemName = 'Món khác'
): ItemSummaryRow[] {
  const map = new Map<
    string,
    {
      itemKey: string;
      itemId: string | null;
      itemName: string;
      orderAppearances: number;
      quantitySold: number;
      paidQuantitySold: number;
      grossSales: number;
      paidGrossSales: number;
    }
  >();

  let totalGrossSales = 0;

  for (const ord of filteredOrders || []) {
    if (!ord || ord.status === 'cancelled') continue;
    const isPaid = ord.payment_status === 'paid';
    const seenKeysInOrder = new Set<string>();

    for (const line of ord.items || []) {
      if (!line) continue;
      const cleanId = (line.item_id ?? '').trim();
      const cleanName = (line.name_vi ?? '').trim();
      const itemKey = cleanId
        ? `item:${cleanId}`
        : `name:${(cleanName || fallbackItemName).toLowerCase()}`;
      const displayName = cleanName || cleanId || fallbackItemName;

      const curr = map.get(itemKey) || {
        itemKey,
        itemId: cleanId || null,
        itemName: displayName,
        orderAppearances: 0,
        quantitySold: 0,
        paidQuantitySold: 0,
        grossSales: 0,
        paidGrossSales: 0,
      };
      if (cleanName && curr.itemName === cleanId) {
        curr.itemName = cleanName;
      }

      const { quantity, grossLineTotal } = computeOrderLinePricing(line);
      if (!seenKeysInOrder.has(itemKey)) {
        curr.orderAppearances += 1;
        seenKeysInOrder.add(itemKey);
      }
      curr.quantitySold += quantity;
      curr.grossSales += grossLineTotal;
      totalGrossSales += grossLineTotal;

      if (isPaid) {
        curr.paidQuantitySold += quantity;
        curr.paidGrossSales += grossLineTotal;
      }

      map.set(itemKey, curr);
    }
  }

  return Array.from(map.values())
    .map((item) => {
      const grossSharePercent =
        totalGrossSales > 0
          ? Math.round((item.grossSales / totalGrossSales) * 1000) / 10
          : 0;
      return {
        ...item,
        revenue: item.grossSales,
        grossSharePercent,
      };
    })
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold ||
        b.grossSales - a.grossSales ||
        a.itemName.localeCompare(b.itemName, 'vi')
    );
}

export function formatPaymentStatusLabel(
  status: OrderPaymentStatus | string | undefined,
  tx: ReportTranslator = defaultTx
): string {
  if (status === 'paid') {
    return tx('Đã thu tiền', 'Paid');
  }
  if (status === 'refunded') {
    return tx('Đã hoàn tiền', 'Refunded');
  }
  return tx('Chưa thu tiền', 'Unpaid');
}

export function formatPaymentMethodLabel(
  method: PaymentMethod | string | undefined,
  tx: ReportTranslator = defaultTx
): string {
  if (method === 'vietqr') {
    return tx('Chuyển khoản VietQR', 'VietQR Transfer');
  }
  return tx('Tiền mặt', 'Cash');
}

export function formatOrderStatusLabel(
  status: OrderStatus | string | undefined,
  tx: ReportTranslator = defaultTx
): string {
  switch (status) {
    case 'completed':
      return tx('Hoàn tất', 'Completed');
    case 'preparing':
      return tx('Đang chế biến', 'Preparing');
    case 'new':
      return tx('Mới chờ nhận', 'New');
    case 'cancelled':
      return tx('Đã hủy', 'Cancelled');
    default:
      return String(status || '');
  }
}

export function formatOrderSourceLabel(
  source: ShopOrder['source'] | string | undefined,
  tx: ReportTranslator = defaultTx
): string {
  if (source === 'counter_pos') {
    return tx('Tại quầy (POS)', 'Counter POS');
  }
  return tx('Khách quét QR', 'Table QR');
}

export function formatTableKindLabel(
  kind: TableOrderStats['kind'],
  tx: ReportTranslator = defaultTx
): string {
  if (kind === 'managed') {
    return tx('Bàn quản lý', 'Managed table');
  }
  if (kind === 'takeaway') {
    return tx('Mang về', 'Takeaway');
  }
  return tx('Lịch sử / Khác', 'Legacy / Other');
}

export function getCanonicalOrdersColumns(
  tx: ReportTranslator = defaultTx,
  tableById?: Map<string, ShopTable>
): CanonicalColumnSpec<ShopOrder>[] {
  return [
    {
      key: 'order_code',
      label: tx('Mã đơn', 'Order Code'),
      kind: 'text',
      getExportValue: (ord) => `#${ord.order_code}`,
      getSortValue: (ord) => ord.order_code || '',
    },
    {
      key: 'created_at',
      label: tx('Ngày & Giờ (VN)', 'Date & Time (VN)'),
      kind: 'text',
      getExportValue: (ord) => getVnDateTimeString(ord.created_at),
      getSortValue: (ord) => new Date(ord.created_at).getTime() || 0,
    },
    {
      key: 'table_label',
      label: tx('Bàn / Vị trí', 'Table / Location'),
      kind: 'text',
      getExportValue: (ord) => {
        const managed =
          ord.table_id && tableById ? tableById.get(ord.table_id) : undefined;
        if (managed && managed.name && managed.name !== ord.table_label) {
          return `${ord.table_label} (${tx('Hiện tại:', 'Current:')} ${managed.name})`;
        }
        return ord.table_label || '';
      },
      getSortValue: (ord) => ord.table_label || '',
    },
    {
      key: 'source',
      label: tx('Nguồn đơn', 'Source'),
      kind: 'text',
      getExportValue: (ord) => formatOrderSourceLabel(ord.source, tx),
      getSortValue: (ord) => formatOrderSourceLabel(ord.source, tx),
    },
    {
      key: 'items_summary',
      label: tx('Chi tiết món & Ghi chú', 'Ordered Items & Notes'),
      kind: 'text',
      getExportValue: (ord) => formatOrderItemsText(ord, ' | '),
      getSortValue: (ord) => formatOrderItemsText(ord, ' | '),
    },
    {
      key: 'items_qty',
      label: tx('SL món', 'Qty'),
      kind: 'number',
      getExportValue: (ord) => getOrderTotalQuantity(ord),
      getSortValue: (ord) => getOrderTotalQuantity(ord),
    },
    {
      key: 'total_amount',
      label: tx('Tổng tiền đơn', 'Order Total'),
      kind: 'money',
      getExportValue: (ord) => Math.max(0, Number(ord.total_amount || 0)),
      getSortValue: (ord) => Math.max(0, Number(ord.total_amount || 0)),
    },
    {
      key: 'payment_status',
      label: tx('Trạng thái thu tiền', 'Payment Status'),
      kind: 'text',
      getExportValue: (ord) => formatPaymentStatusLabel(ord.payment_status, tx),
      getSortValue: (ord) => formatPaymentStatusLabel(ord.payment_status, tx),
    },
    {
      key: 'payment_method',
      label: tx('Phương thức TT', 'Payment Method'),
      kind: 'text',
      getExportValue: (ord) => formatPaymentMethodLabel(ord.payment_method, tx),
      getSortValue: (ord) => formatPaymentMethodLabel(ord.payment_method, tx),
    },
    {
      key: 'status',
      label: tx('Trạng thái phục vụ', 'Order Status'),
      kind: 'text',
      getExportValue: (ord) => formatOrderStatusLabel(ord.status, tx),
      getSortValue: (ord) => formatOrderStatusLabel(ord.status, tx),
    },
  ];
}

export function getCanonicalTablesColumns(
  tx: ReportTranslator = defaultTx,
  tableById?: Map<string, ShopTable>
): CanonicalColumnSpec<TableOrderStats>[] {
  return [
    {
      key: 'table_label',
      label: tx('Bàn / Vị trí', 'Table / Location'),
      kind: 'text',
      getExportValue: (row) => {
        const managed =
          row.table_id && tableById ? tableById.get(row.table_id) : undefined;
        return [
          row.table_label,
          managed?.table_code ? `#${managed.table_code}` : '',
          managed?.is_archived ? tx('Đã lưu trữ', 'Archived')
            : managed && !managed.is_active ? tx('Tạm ngưng', 'Inactive') : '',
          managed?.section,
        ].filter(Boolean).join(' · ');
      },
      getSortValue: (row) => row.table_label || '',
    },
    {
      key: 'kind',
      label: tx('Phân loại', 'Type'),
      kind: 'text',
      getExportValue: (row) => formatTableKindLabel(row.kind, tx),
      getSortValue: (row) => formatTableKindLabel(row.kind, tx),
    },
    {
      key: 'orderCount',
      label: tx('Tổng đơn', 'Total Orders'),
      kind: 'number',
      getExportValue: (row) => row.orderCount,
      getSortValue: (row) => row.orderCount,
    },
    {
      key: 'paidOrderCount',
      label: tx('Đơn đã thu', 'Paid Orders'),
      kind: 'number',
      getExportValue: (row) => row.paidOrderCount,
      getSortValue: (row) => row.paidOrderCount,
    },
    {
      key: 'collectedRevenue',
      label: tx('Thực thu (Đã TT)', 'Collected Revenue (Paid)'),
      kind: 'money',
      getExportValue: (row) => row.collectedRevenue,
      getSortValue: (row) => row.collectedRevenue,
    },
    {
      key: 'unpaidOrderCount',
      label: tx('Đơn chưa thu', 'Unpaid Orders'),
      kind: 'number',
      getExportValue: (row) => row.unpaidOrderCount,
      getSortValue: (row) => row.unpaidOrderCount,
    },
    {
      key: 'unpaidAmount',
      label: tx('Tiền chưa thu', 'Unpaid Amount'),
      kind: 'money',
      getExportValue: (row) => row.unpaidAmount,
      getSortValue: (row) => row.unpaidAmount,
    },
    {
      key: 'refundedAmount',
      label: tx('Hoàn tiền', 'Refunded Amount'),
      kind: 'money',
      getExportValue: (row) => row.refundedAmount,
      getSortValue: (row) => row.refundedAmount,
    },
    {
      key: 'cancelledOrderCount',
      label: tx('Đơn hủy', 'Cancelled Orders'),
      kind: 'number',
      getExportValue: (row) => row.cancelledOrderCount,
      getSortValue: (row) => row.cancelledOrderCount,
    },
  ];
}

export function getCanonicalDailyColumns(
  tx: ReportTranslator = defaultTx
): CanonicalColumnSpec<DailySummaryRow>[] {
  return [
    {
      key: 'dateKey',
      label: tx('Ngày (VN)', 'Date (VN)'),
      kind: 'text',
      getExportValue: (row) => formatDateKeyVi(row.dateKey),
      getSortValue: (row) => row.dateKey,
    },
    {
      key: 'ordersCount',
      label: tx('Đơn hợp lệ', 'Valid Orders'),
      kind: 'number',
      getExportValue: (row) => row.ordersCount,
      getSortValue: (row) => row.ordersCount,
    },
    {
      key: 'paidOrdersCount',
      label: tx('Đơn đã thu tiền', 'Paid Orders'),
      kind: 'number',
      getExportValue: (row) => row.paidOrdersCount,
      getSortValue: (row) => row.paidOrdersCount,
    },
    {
      key: 'itemsSold',
      label: tx('SL món (đơn hợp lệ)', 'Items Sold (Valid Orders)'),
      kind: 'number',
      getExportValue: (row) => row.itemsSold,
      getSortValue: (row) => row.itemsSold,
    },
    {
      key: 'cashRevenue',
      label: tx('Thu tiền mặt (Đã TT)', 'Paid Cash Revenue'),
      kind: 'money',
      getExportValue: (row) => row.cashRevenue,
      getSortValue: (row) => row.cashRevenue,
    },
    {
      key: 'vietqrRevenue',
      label: tx('Thu VietQR (Đã TT)', 'Paid VietQR Revenue'),
      kind: 'money',
      getExportValue: (row) => row.vietqrRevenue,
      getSortValue: (row) => row.vietqrRevenue,
    },
    {
      key: 'collectedRevenue',
      label: tx('Thực thu ngày (Đã TT)', 'Collected Daily Revenue (Paid)'),
      kind: 'money',
      getExportValue: (row) => row.collectedRevenue,
      getSortValue: (row) => row.collectedRevenue,
    },
    {
      key: 'unpaidAmount',
      label: tx('Chưa thu trong ngày', 'Unpaid Amount'),
      kind: 'money',
      getExportValue: (row) => row.unpaidAmount,
      getSortValue: (row) => row.unpaidAmount,
    },
    {
      key: 'refundedAmount',
      label: tx('Hoàn tiền trong ngày', 'Refunded Amount'),
      kind: 'money',
      getExportValue: (row) => row.refundedAmount,
      getSortValue: (row) => row.refundedAmount,
    },
  ];
}

export function getCanonicalItemsColumns(
  tx: ReportTranslator = defaultTx
): CanonicalColumnSpec<ItemSummaryRow>[] {
  return [
    {
      key: 'itemName',
      label: tx('Tên món ăn / Dịch vụ', 'Item Name'),
      kind: 'text',
      getExportValue: (row) => row.itemName,
      getSortValue: (row) => row.itemName,
    },
    {
      key: 'orderAppearances',
      label: tx('Số đơn có gọi', 'Orders Containing Item'),
      kind: 'number',
      getExportValue: (row) => row.orderAppearances,
      getSortValue: (row) => row.orderAppearances,
    },
    {
      key: 'quantitySold',
      label: tx('Tổng SL bán (đơn hợp lệ)', 'Total Qty Sold (Valid Orders)'),
      kind: 'number',
      getExportValue: (row) => row.quantitySold,
      getSortValue: (row) => row.quantitySold,
    },
    {
      key: 'paidQuantitySold',
      label: tx('SL trong đơn đã thu', 'Qty in Paid Orders'),
      kind: 'number',
      getExportValue: (row) => row.paidQuantitySold,
      getSortValue: (row) => row.paidQuantitySold,
    },
    {
      key: 'grossSales',
      label: tx(
        'Doanh số món gộp (trước giảm giá đơn)',
        'Gross Item Sales (Pre-order Discount)'
      ),
      kind: 'money',
      getExportValue: (row) => row.grossSales,
      getSortValue: (row) => row.grossSales,
    },
    {
      key: 'paidGrossSales',
      label: tx(
        'Tiền món gộp (đơn đã thu, trước giảm giá)',
        'Paid Orders Gross Item Sales (Pre-discount)'
      ),
      kind: 'money',
      getExportValue: (row) => row.paidGrossSales,
      getSortValue: (row) => row.paidGrossSales,
    },
    {
      key: 'grossSharePercent',
      label: tx('Tỷ trọng doanh số gộp (%)', 'Gross Sales Share (%)'),
      kind: 'number',
      getExportValue: (row) => row.grossSharePercent,
      getSortValue: (row) => row.grossSharePercent,
    },
  ];
}

export function sortRowsByColumnSpecs<T>(
  rows: readonly T[],
  specs: readonly CanonicalColumnSpec<T>[],
  sortState?: ReportSortState | null,
  tieBreaker?: (a: T, b: T) => number
): T[] {
  const copy = [...rows];
  if (!sortState || !sortState.columnId) {
    return copy;
  }
  const spec = specs.find((c) => c.key === sortState.columnId);
  if (!spec) {
    return copy;
  }
  const dirMultiplier = sortState.direction === 'desc' ? -1 : 1;

  return copy.sort((a, b) => {
    const valA = spec.getSortValue
      ? spec.getSortValue(a)
      : spec.getExportValue(a, 0) ?? '';
    const valB = spec.getSortValue
      ? spec.getSortValue(b)
      : spec.getExportValue(b, 0) ?? '';

    let cmp = 0;
    if (typeof valA === 'number' && typeof valB === 'number') {
      cmp = valA - valB;
    } else {
      cmp = String(valA).localeCompare(String(valB), 'vi', { numeric: true });
    }

    if (cmp !== 0) {
      return cmp * dirMultiplier;
    }
    return tieBreaker ? tieBreaker(a, b) : 0;
  });
}

export function clampReportPage(
  page: number,
  totalRows: number,
  rowsPerPage: number
): number {
  const safePerPage = Math.max(1, Math.floor(Number(rowsPerPage) || 10));
  if (totalRows <= 0) return 1;
  const maxPage = Math.max(1, Math.ceil(totalRows / safePerPage));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  return Math.min(safePage, maxPage);
}

export function paginateReportRows<T>(
  rows: readonly T[],
  page: number,
  rowsPerPage: number
): {
  page: number;
  rowsPerPage: number;
  totalRows: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  rows: T[];
} {
  const totalRows = rows.length;
  const safePerPage = Math.max(1, Math.floor(Number(rowsPerPage) || 10));
  const totalPages = Math.max(1, Math.ceil(totalRows / safePerPage));
  const clampedPage = clampReportPage(page, totalRows, safePerPage);
  const startIndex = totalRows === 0 ? 0 : (clampedPage - 1) * safePerPage;
  const endIndex =
    totalRows === 0 ? 0 : Math.min(totalRows, startIndex + safePerPage);
  return {
    page: clampedPage,
    rowsPerPage: safePerPage,
    totalRows,
    totalPages,
    startIndex,
    endIndex,
    rows: rows.slice(startIndex, endIndex),
  };
}

export function buildReportMetadata(params: {
  shopName: string;
  shopSlug: string;
  activeTab: ReportViewTab;
  dateBounds: EffectiveDateBounds;
  filters: Pick<
    ReportFilters,
    | 'statusFilter'
    | 'paymentStatusFilter'
    | 'paymentMethodFilter'
    | 'sourceFilter'
    | 'searchQuery'
  >;
  exportScope: ReportExportScope;
  exportedRowCount: number;
  totalFilteredRowCount: number;
  page?: number;
  rowsPerPage?: number;
  sortState?: ReportSortState | null;
  tx?: ReportTranslator;
}): Array<[string, string | number]> {
  const tx = params.tx || defaultTx;

  const tabLabel =
    params.activeTab === 'orders_list'
      ? tx('Danh sách đơn hàng', 'Orders List')
      : params.activeTab === 'tables_summary'
        ? tx('Thống kê theo bàn', 'By Table Summary')
        : params.activeTab === 'daily_summary'
          ? tx('Thống kê theo ngày', 'Daily Summary')
          : tx('Thống kê theo món', 'By Item Summary');

  const statusLabel =
    params.filters.statusFilter === 'valid_only'
      ? tx('Đơn hợp lệ (không tính đơn hủy)', 'Valid orders (excl. cancelled)')
      : params.filters.statusFilter === 'all'
        ? tx('Tất cả (gồm cả đơn hủy)', 'All (incl. cancelled)')
        : formatOrderStatusLabel(params.filters.statusFilter, tx);

  const paymentStatusLabel =
    params.filters.paymentStatusFilter === 'all'
      ? tx('Tất cả', 'All')
      : formatPaymentStatusLabel(params.filters.paymentStatusFilter, tx);

  const paymentMethodLabel =
    params.filters.paymentMethodFilter === 'all'
      ? tx('Tất cả', 'All')
      : formatPaymentMethodLabel(params.filters.paymentMethodFilter, tx);

  const sourceLabel =
    params.filters.sourceFilter === 'all'
      ? tx('Tất cả', 'All')
      : formatOrderSourceLabel(params.filters.sourceFilter, tx);

  const scopeLabel =
    params.exportScope === 'current_page'
      ? tx(
          'Trang hiện tại (Trang {page}, {count}/{total} dòng)',
          'Current page (Page {page}, {count}/{total} rows)',
          {
            page: params.page || 1,
            count: params.exportedRowCount,
            total: params.totalFilteredRowCount,
          }
        )
      : tx(
          'Toàn bộ kết quả đang lọc ({count} dòng)',
          'All filtered results ({count} rows)',
          { count: params.exportedRowCount }
        );

  return [
    [tx('Cửa hàng', 'Shop'), `${params.shopName} (${params.shopSlug})`],
    [tx('Bảng báo cáo', 'Report View'), tabLabel],
    [tx('Kỳ báo cáo (UTC+7)', 'Period (UTC+7)'), params.dateBounds.label],
    [
      tx('Khoảng ngày (UTC+7)', 'Date Bounds (UTC+7)'),
      `${params.dateBounds.start} -> ${params.dateBounds.end}`,
    ],
    [tx('Bộ lọc trạng thái đơn', 'Order Status Filter'), statusLabel],
    [tx('Bộ lọc thu tiền', 'Payment Status Filter'), paymentStatusLabel],
    [tx('Bộ lọc phương thức TT', 'Payment Method Filter'), paymentMethodLabel],
    [tx('Bộ lọc nguồn đơn', 'Order Source Filter'), sourceLabel],
    [
      tx('Từ khóa tìm kiếm', 'Search Query'),
      params.filters.searchQuery.trim() || tx('(Không có)', '(None)'),
    ],
    [tx('Phạm vi xuất', 'Export Scope'), scopeLabel],
    [tx('Số dòng xuất', 'Exported Rows'), params.exportedRowCount],
    [tx('Tổng dòng khớp bộ lọc', 'Total Filtered Rows'), params.totalFilteredRowCount],
    ...(params.sortState?.columnId
      ? ([
          [
            tx('Sắp xếp', 'Sort Order'),
            `${params.sortState.columnId} (${params.sortState.direction.toUpperCase()})`,
          ],
        ] as Array<[string, string | number]>)
      : []),
    [tx('Múi giờ kế toán', 'Accounting Timezone'), 'Asia/Ho_Chi_Minh (UTC+7)'],
  ];
}

export function buildReportFilenameBase(params: {
  shopSlug: string;
  activeTab: ReportViewTab;
  dateBounds: Pick<EffectiveDateBounds, 'start' | 'end'>;
  exportScope: ReportExportScope;
  page?: number;
}): string {
  const tabSlug =
    params.activeTab === 'orders_list'
      ? 'orders'
      : params.activeTab === 'tables_summary'
        ? 'tables'
        : params.activeTab === 'daily_summary'
          ? 'daily'
          : 'items';
  const datePart =
    params.dateBounds.start === '0000-01-01'
      ? 'all-time'
      : params.dateBounds.start === params.dateBounds.end
        ? params.dateBounds.start
        : `${params.dateBounds.start}_to_${params.dateBounds.end}`;
  const scopePart =
    params.exportScope === 'current_page'
      ? `_page-${Math.max(1, Number(params.page || 1))}`
      : '';
  return `qlaok-${params.shopSlug || 'shop'}-${tabSlug}-${datePart}${scopePart}`;
}

export function buildDatasetFromColumnSpecs<T>(params: {
  title: string;
  currency?: string;
  specs: readonly CanonicalColumnSpec<T>[];
  rows: readonly T[];
  metadata?: Array<[string, string | number]>;
}): ExportDataset {
  return {
    title: params.title,
    currency: params.currency || 'VND',
    columns: params.specs.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind,
    })),
    rows: params.rows.map((row, idx) => {
      const record: Record<string, string | number | null> = {};
      for (const col of params.specs) {
        record[col.key] = col.getExportValue(row, idx);
      }
      return record;
    }),
    metadata: params.metadata,
  };
}

export function buildCurrentViewExportPayload(params: {
  shop: { id: string; name: string; slug: string; currency?: string };
  activeTab: ReportViewTab;
  exportScope: ReportExportScope;
  dateBounds: EffectiveDateBounds;
  filters: Pick<
    ReportFilters,
    | 'statusFilter'
    | 'paymentStatusFilter'
    | 'paymentMethodFilter'
    | 'sourceFilter'
    | 'searchQuery'
  >;
  filteredOrders: ShopOrder[];
  shopTables?: ShopTable[];
  sortState?: ReportSortState | null;
  page?: number;
  rowsPerPage?: number;
  tx?: ReportTranslator;
}): {
  dataset: ExportDataset;
  filenameBase: string;
  exportedRowCount: number;
  totalFilteredRowCount: number;
} {
  const tx = params.tx || defaultTx;
  const tableById = buildManagedTableMap(params.shopTables, params.shop.id);
  const page = Math.max(1, Number(params.page || 1));
  const rowsPerPage = Math.max(1, Number(params.rowsPerPage || 10));

  if (params.activeTab === 'orders_list') {
    const specs = getCanonicalOrdersColumns(tx, tableById);
    const sorted = sortRowsByColumnSpecs(
      params.filteredOrders,
      specs,
      params.sortState,
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
        a.id.localeCompare(b.id)
    );
    const paged = paginateReportRows(sorted, page, rowsPerPage);
    const targetRows =
      params.exportScope === 'current_page' ? paged.rows : sorted;
    const metadata = buildReportMetadata({
      shopName: params.shop.name,
      shopSlug: params.shop.slug,
      activeTab: params.activeTab,
      dateBounds: params.dateBounds,
      filters: params.filters,
      exportScope: params.exportScope,
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
      page: paged.page,
      rowsPerPage: paged.rowsPerPage,
      sortState: params.sortState,
      tx,
    });
    return {
      dataset: buildDatasetFromColumnSpecs({
        title: tx('Danh sách đơn hàng', 'Orders Report'),
        currency: params.shop.currency,
        specs,
        rows: targetRows,
        metadata,
      }),
      filenameBase: buildReportFilenameBase({
        shopSlug: params.shop.slug,
        activeTab: params.activeTab,
        dateBounds: params.dateBounds,
        exportScope: params.exportScope,
        page: paged.page,
      }),
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
    };
  }

  if (params.activeTab === 'tables_summary') {
    const rawRows = summarizeOrdersByTable(
      params.filteredOrders,
      params.shop.id,
      params.shopTables
    );
    const specs = getCanonicalTablesColumns(tx, tableById);
    const sorted = sortRowsByColumnSpecs(
      rawRows,
      specs,
      params.sortState,
      (a, b) => a.key.localeCompare(b.key)
    );
    const paged = paginateReportRows(sorted, page, rowsPerPage);
    const targetRows =
      params.exportScope === 'current_page' ? paged.rows : sorted;
    const metadata = buildReportMetadata({
      shopName: params.shop.name,
      shopSlug: params.shop.slug,
      activeTab: params.activeTab,
      dateBounds: params.dateBounds,
      filters: params.filters,
      exportScope: params.exportScope,
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
      page: paged.page,
      rowsPerPage: paged.rowsPerPage,
      sortState: params.sortState,
      tx,
    });
    return {
      dataset: buildDatasetFromColumnSpecs({
        title: tx('Báo cáo theo bàn / vị trí', 'By Table Summary Report'),
        currency: params.shop.currency,
        specs,
        rows: targetRows,
        metadata,
      }),
      filenameBase: buildReportFilenameBase({
        shopSlug: params.shop.slug,
        activeTab: params.activeTab,
        dateBounds: params.dateBounds,
        exportScope: params.exportScope,
        page: paged.page,
      }),
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
    };
  }

  if (params.activeTab === 'daily_summary') {
    const rawRows = summarizeOrdersByDay(params.filteredOrders);
    const specs = getCanonicalDailyColumns(tx);
    const sorted = sortRowsByColumnSpecs(
      rawRows,
      specs,
      params.sortState,
      (a, b) => b.dateKey.localeCompare(a.dateKey)
    );
    const paged = paginateReportRows(sorted, page, rowsPerPage);
    const targetRows =
      params.exportScope === 'current_page' ? paged.rows : sorted;
    const metadata = buildReportMetadata({
      shopName: params.shop.name,
      shopSlug: params.shop.slug,
      activeTab: params.activeTab,
      dateBounds: params.dateBounds,
      filters: params.filters,
      exportScope: params.exportScope,
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
      page: paged.page,
      rowsPerPage: paged.rowsPerPage,
      sortState: params.sortState,
      tx,
    });
    return {
      dataset: buildDatasetFromColumnSpecs({
        title: tx('Báo cáo doanh thu theo ngày', 'Daily Summary Report'),
        currency: params.shop.currency,
        specs,
        rows: targetRows,
        metadata,
      }),
      filenameBase: buildReportFilenameBase({
        shopSlug: params.shop.slug,
        activeTab: params.activeTab,
        dateBounds: params.dateBounds,
        exportScope: params.exportScope,
        page: paged.page,
      }),
      exportedRowCount: targetRows.length,
      totalFilteredRowCount: sorted.length,
    };
  }

  const rawRows = summarizeOrdersByItem(
    params.filteredOrders,
    tx('Món khác', 'Other item')
  );
  const specs = getCanonicalItemsColumns(tx);
  const sorted = sortRowsByColumnSpecs(
    rawRows,
    specs,
    params.sortState,
    (a, b) => a.itemKey.localeCompare(b.itemKey)
  );
  const paged = paginateReportRows(sorted, page, rowsPerPage);
  const targetRows =
    params.exportScope === 'current_page' ? paged.rows : sorted;
  const metadata = buildReportMetadata({
    shopName: params.shop.name,
    shopSlug: params.shop.slug,
    activeTab: params.activeTab,
    dateBounds: params.dateBounds,
    filters: params.filters,
    exportScope: params.exportScope,
    exportedRowCount: targetRows.length,
    totalFilteredRowCount: sorted.length,
    page: paged.page,
    rowsPerPage: paged.rowsPerPage,
    sortState: params.sortState,
    tx,
  });
  return {
    dataset: buildDatasetFromColumnSpecs({
      title: tx('Báo cáo tổng hợp theo món', 'By Item Summary Report'),
      currency: params.shop.currency,
      specs,
      rows: targetRows,
      metadata,
    }),
    filenameBase: buildReportFilenameBase({
      shopSlug: params.shop.slug,
      activeTab: params.activeTab,
      dateBounds: params.dateBounds,
      exportScope: params.exportScope,
      page: paged.page,
    }),
    exportedRowCount: targetRows.length,
    totalFilteredRowCount: sorted.length,
  };
}
