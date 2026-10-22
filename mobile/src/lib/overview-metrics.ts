export interface MobileCatalogItem {
  id: string;
  shop_id: string;
  category_id: string;
  sort_order: number;
  price: number;
  is_available: boolean;
  is_featured: boolean;
  stock_quantity?: number | null;
  sold_count?: number;
  name_i18n: Record<string, string>;
  desc_i18n: Record<string, string>;
  view_count: number;
}

export interface MobileAnalyticsEvent {
  id: number;
  shop_id: string;
  event_type:
    | 'scan_door'
    | 'scan_table'
    | 'item_view'
    | 'show_to_staff'
    | 'wifi_copy';
  item_id?: string | null;
  visitor_lang: string;
  created_at: string;
}

export interface MobileDailyRevenuePoint {
  date: string;
  label: string;
  revenue: number;
  cashRevenue?: number;
  vietqrRevenue?: number;
  orders?: number;
  ordersCount?: number;
  orderCount?: number;
}

export interface MobileShopOrderStats {
  todayRevenue?: number | null;
  todayGrossOrderAmount?: number | null;
  todayUnpaidAmount?: number | null;
  todayRefundedAmount?: number | null;
  totalRefundedAmount?: number | null;
  totalRevenue?: number | null;
  todayOrdersCount?: number;
  todayPaidOrdersCount?: number | null;
  paidOrdersCount?: number | null;
  todayCompletedCount?: number;
  completedOrdersCount?: number;
  totalOrdersCount?: number;
  newOrdersCount?: number;
  preparingOrdersCount?: number;
  avgOrderValue?: number | null;
  lowStockCount?: number;
  outOfStockCount?: number;
  dailyRevenue7d?: MobileDailyRevenuePoint[];
  topSellingItems?: Array<
    MobileCatalogItem & {
      name_vi?: string;
      revenue?: number;
      estimated_revenue?: number;
    }
  >;
}

export interface MobileSevenDayBar {
  dateKey: string;
  label: string;
  revenue: number;
}

export interface MobileOverviewMetrics {
  newOrdersCount: number;
  preparingOrdersCount: number;
  validOrdersCount: number;
  todayRevenue: number;
  totalRevenue: number;
  sevenDayBars: MobileSevenDayBar[];
  maxDayRev: number;
  lowStockCount: number;
  outOfStockCount: number;
  scanDoorCount: number;
  scanTableCount: number;
  topItems: MobileCatalogItem[];
}

export function formatVnDayMonthFromDateKey(
  dateKey: string,
  fallbackLabel = ''
): string {
  const parts = String(dateKey || '').split('-');
  if (parts.length === 3) {
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isFinite(day) && Number.isFinite(month) && day > 0 && month > 0) {
      return `${day}/${month}`;
    }
  }
  return fallbackLabel || dateKey;
}

export function buildEmptySevenDayBars(
  nowInput: Date | string | number = new Date()
): MobileSevenDayBar[] {
  const ts = new Date(nowInput).getTime();
  const safeNowMs = Number.isNaN(ts) ? Date.now() : ts;
  return Array.from({ length: 7 }, (_, i) => {
    const vnDate = new Date(safeNowMs + 7 * 3600 * 1000);
    vnDate.setUTCDate(vnDate.getUTCDate() - (6 - i));
    const dateKey = vnDate.toISOString().slice(0, 10);
    const label = `${vnDate.getUTCDate()}/${vnDate.getUTCMonth() + 1}`;
    return { dateKey, label, revenue: 0 };
  });
}

/**
 * Builds the Mobile Overview dashboard metrics from the authoritative
 * server-side `stats` summary returned by `GET /api/orders` (which aggregates
 * across all shop orders without PostgREST's 1000-row `.select('*')` cap),
 * rather than recomputing totals from the client order list.
 */
export function buildMobileOverviewMetrics(params: {
  stats?: MobileShopOrderStats | null;
  items: MobileCatalogItem[];
  events: MobileAnalyticsEvent[];
  now?: Date | string | number;
}): MobileOverviewMetrics {
  const { stats, items, events, now } = params;

  const newOrdersCount = Math.max(0, Number(stats?.newOrdersCount ?? 0));
  const preparingOrdersCount = Math.max(
    0,
    Number(stats?.preparingOrdersCount ?? 0)
  );
  const validOrdersCount = Math.max(
    0,
    Number(stats?.paidOrdersCount ?? stats?.todayPaidOrdersCount ?? 0)
  );
  const todayRevenue = Math.max(0, Number(stats?.todayRevenue ?? 0));
  const totalRevenue = Math.max(0, Number(stats?.totalRevenue ?? 0));

  const sevenDayBars: MobileSevenDayBar[] =
    Array.isArray(stats?.dailyRevenue7d) && stats.dailyRevenue7d.length > 0
      ? stats.dailyRevenue7d.map((d) => ({
          dateKey: String(d.date || ''),
          label: formatVnDayMonthFromDateKey(d.date, d.label),
          revenue: Math.max(0, Number(d.revenue || 0)),
        }))
      : buildEmptySevenDayBars(now);

  const maxDayRev = Math.max(...sevenDayBars.map((b) => b.revenue), 100000);

  const computedLowStockCount = items.filter(
    (i) =>
      typeof i.stock_quantity === 'number' &&
      i.stock_quantity > 0 &&
      i.stock_quantity <= 5
  ).length;
  const computedOutOfStockCount = items.filter(
    (i) => !i.is_available || i.stock_quantity === 0
  ).length;

  const lowStockCount =
    typeof stats?.lowStockCount === 'number'
      ? Math.max(0, stats.lowStockCount)
      : computedLowStockCount;
  const outOfStockCount =
    typeof stats?.outOfStockCount === 'number'
      ? Math.max(0, stats.outOfStockCount)
      : computedOutOfStockCount;

  const scanDoorCount = events.filter(
    (e) => e.event_type === 'scan_door'
  ).length;
  const scanTableCount = events.filter(
    (e) => e.event_type === 'scan_table'
  ).length;

  const serverTopSoldById = new Map<string, number>();
  if (Array.isArray(stats?.topSellingItems)) {
    for (const topItem of stats.topSellingItems) {
      if (topItem && typeof topItem.id === 'string') {
        serverTopSoldById.set(
          topItem.id,
          Math.max(0, Number(topItem.sold_count || 0))
        );
      }
    }
  }

  const topItems = [...items]
    .map((item) => {
      const serverSold = serverTopSoldById.get(item.id);
      if (serverSold === undefined) return item;
      return {
        ...item,
        sold_count: Math.max(Number(item.sold_count || 0), serverSold),
      };
    })
    .sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0))
    .slice(0, 6);

  return {
    newOrdersCount,
    preparingOrdersCount,
    validOrdersCount,
    todayRevenue,
    totalRevenue,
    sevenDayBars,
    maxDayRev,
    lowStockCount,
    outOfStockCount,
    scanDoorCount,
    scanTableCount,
    topItems,
  };
}
