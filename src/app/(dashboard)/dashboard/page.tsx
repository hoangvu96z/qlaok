'use client';

import { appLanguageName } from '@/lib/app-i18n';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  QrCode,
  ScanLine,
  Languages,
  ArrowUpRight,
  Sparkles,
  Banknote,
  BellRing,
  Package,
  BarChart3,
  ShoppingBag,
  PieChart,
  Clock,
  Activity,
  Loader2,
  CheckCircle2,
  Circle,
  ListChecks,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { I18nText, SupportedLocale } from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';
import { evaluateShopSetupChecklist } from '@/lib/shop-setup-checklist';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

interface AnalyticsTopItemSummary {
  id: string;
  name_vi?: string;
  name_i18n?: I18nText;
  price: number;
  is_available: boolean;
  view_count: number;
  stock_quantity?: number | null;
  sold_count?: number;
}

interface AnalyticsSummary {
  scanDoorCount: number;
  scanTableCount: number;
  showToStaffCount: number;
  wifiCopyCount: number;
  totalScans: number;
  langBreakdown: Array<{
    lang: SupportedLocale;
    count: number;
    percentage: number;
  }>;
  topItems: AnalyticsTopItemSummary[];
  totalCatalogItems?: number;
  availableCatalogItems?: number;
  activeTablesCount?: number;
  todayRevenue?: number;
  totalRevenue?: number;
  todayOrdersCount?: number;
  totalOrdersCount?: number;
  newOrdersCount?: number;
  preparingOrdersCount?: number;
  completedOrdersCount?: number;
  avgOrderValue?: number;
  lowStockCount?: number;
  outOfStockCount?: number;
  dailyRevenue7d?: Array<{
    date: string;
    label: string;
    revenue: number;
    cashRevenue?: number;
    vietqrRevenue?: number;
    orders: number;
  }>;
  paymentBreakdown?: {
    vietqr: { count: number; revenue: number; percentage: number };
    cash: { count: number; revenue: number; percentage: number };
  };
  sourceBreakdown?: {
    qr_table: { count: number; revenue: number; percentage: number };
    counter_pos: { count: number; revenue: number; percentage: number };
  };
  hourlyBreakdown?: Array<{
    slot: string;
    label: string;
    orders: number;
    revenue: number;
    percentage: number;
  }>;
  topSellingItems?: Array<{
    id: string;
    name_vi: string;
    price: number;
    sold_count: number;
    stock_quantity: number | null;
    is_available: boolean;
    revenue: number;
  }>;
}

const DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS = 60000;

interface DashboardAnalyticsSyncOptions {
  shopId: string;
  onFetch: (silent: boolean) => Promise<void> | void;
}

type DashboardAnalyticsSyncHandle = () => void;

/**
 * Coordinates Dashboard Overview analytics polling and synchronization:
 * - Runs initial non-silent fetch immediately when started for an active shop.
 * - Suppresses polling and broadcasts while the tab is hidden (`document.visibilityState !== 'visible'`).
 * - Maintains a 60-second fallback timer that only fetches while visible.
 * - Refreshes immediately when the tab becomes visible again.
 * - Refreshes on `qlaok_realtime_sync` messages while visible; filters by shop when `shopId` is present in event payload.
 * - Guards against overlapping fetches while ensuring errors do not leave sync permanently stale.
 * - Cleans up timer, event listeners, and BroadcastChannel on stop.
 */
function startDashboardAnalyticsSync(
  options: DashboardAnalyticsSyncOptions
): DashboardAnalyticsSyncHandle {
  const cleanShopId = (options.shopId || '').trim();
  if (!cleanShopId) {
    return () => {};
  }

  let stopped = false;
  let inFlight = false;
  let queued = false;

  const isVisible = () =>
    typeof document === 'undefined' || document.visibilityState === 'visible';

  const triggerFetch = async (silent: boolean) => {
    if (stopped) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await options.onFetch(silent);
    } catch {
      // ignore fetch errors; inFlight is reset in finally
    } finally {
      inFlight = false;
      if (queued && !stopped) {
        queued = false;
        if (isVisible()) {
          void triggerFetch(true);
        }
      }
    }
  };

  // 1. Initial fetch once when active shop is available
  void triggerFetch(false);

  // 2. 60-second fallback interval (visible-only)
  const interval = setInterval(() => {
    if (!isVisible()) return;
    void triggerFetch(true);
  }, DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS);

  // 3. Tab visibility-return refresh
  const handleVisibilityChange = () => {
    if (isVisible()) {
      void triggerFetch(true);
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // 4. Realtime BroadcastChannel sync
  let bc: BroadcastChannel | null = null;
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        const msgShopId =
          ev.data && typeof ev.data === 'object'
            ? (ev.data.shopId ?? ev.data.shop_id)
            : undefined;

        if (
          typeof msgShopId === 'string' &&
          msgShopId.trim() &&
          msgShopId.trim() !== cleanShopId
        ) {
          return;
        }

        if (!isVisible()) {
          return;
        }

        void triggerFetch(true);
      };
    } catch {
      bc = null;
    }
  }

  // 5. Cleanup
  return () => {
    stopped = true;
    clearInterval(interval);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (bc) {
      try {
        bc.close();
      } catch {
        // ignore close errors
      }
    }
  };
}

interface OverviewDailyBarPoint {
  date: string;
  label: string;
  revenue: number;
  cashRevenue: number;
  vietqrRevenue: number;
  orders: number;
  heightPct: number;
  vqShare: number;
  cashShare: number;
}

interface OverviewHourlySlotPoint {
  slot: string;
  label: string;
  orders: number;
  revenue: number;
  percentage: number;
  barHeightPct: number;
}

interface OverviewDerivedMetrics {
  daily7d: OverviewDailyBarPoint[];
  maxDailyRev: number;
  total7dRev: number;
  total7dOrders: number;
  vietqrPct: number;
  cashPct: number;
  hasPaymentActivity: boolean;
  qrSourcePct: number;
  posSourcePct: number;
  hasSourceActivity: boolean;
  hourlySlots: OverviewHourlySlotPoint[];
  peakSlot: OverviewHourlySlotPoint | null;
  totalQrScans: number;
  totalItemViews: number;
  totalOrdersSubmitted: number;
  completedOrders: number;
  funnelSteps: {
    scanPct: number;
    itemViewPct: number;
    ordersSubmittedPct: number;
    completedOrdersPct: number;
  };
}

function deriveOverviewMetrics(
  summary: AnalyticsSummary | null | undefined
): OverviewDerivedMetrics {
  const rawDaily7d = Array.isArray(summary?.dailyRevenue7d)
    ? summary.dailyRevenue7d
    : [];
  const maxDailyRev = Math.max(
    ...rawDaily7d.map((d) => Math.max(0, Number(d?.revenue ?? 0))),
    100000
  );
  const total7dRev = rawDaily7d.reduce(
    (s, d) => s + Math.max(0, Number(d?.revenue ?? 0)),
    0
  );
  const total7dOrders = rawDaily7d.reduce(
    (s, d) => s + Math.max(0, Number(d?.orders ?? 0)),
    0
  );

  const daily7d: OverviewDailyBarPoint[] = rawDaily7d.map((day) => {
    const revenue = Math.max(0, Number(day?.revenue ?? 0));
    const orders = Math.max(0, Number(day?.orders ?? 0));
    const vietqrRevenue = Math.max(0, Number(day?.vietqrRevenue ?? 0));
    const cashRevenue = Math.max(0, Number(day?.cashRevenue ?? 0));
    const heightPct =
      revenue > 0
        ? Math.max(Math.round((revenue / maxDailyRev) * 100), 16)
        : 0;
    const vqShare =
      revenue > 0
        ? Math.min(
            100,
            Math.max(0, Math.round((vietqrRevenue / revenue) * 100))
          )
        : 0;
    const cashShare = revenue > 0 ? Math.max(0, 100 - vqShare) : 0;

    return {
      date: String(day?.date ?? ''),
      label: String(day?.label ?? ''),
      revenue,
      cashRevenue,
      vietqrRevenue,
      orders,
      heightPct,
      vqShare,
      cashShare,
    };
  });

  const vietqrRev = Math.max(
    0,
    Number(summary?.paymentBreakdown?.vietqr?.revenue ?? 0)
  );
  const cashRev = Math.max(
    0,
    Number(summary?.paymentBreakdown?.cash?.revenue ?? 0)
  );
  const vietqrCount = Math.max(
    0,
    Number(summary?.paymentBreakdown?.vietqr?.count ?? 0)
  );
  const cashCount = Math.max(
    0,
    Number(summary?.paymentBreakdown?.cash?.count ?? 0)
  );
  const rawVietqrPct = Math.min(
    100,
    Math.max(0, Math.round(Number(summary?.paymentBreakdown?.vietqr?.percentage ?? 0)))
  );
  const rawCashPct = Math.min(
    100,
    Math.max(0, Math.round(Number(summary?.paymentBreakdown?.cash?.percentage ?? 0)))
  );
  const hasPaymentActivity =
    vietqrRev + cashRev > 0 ||
    (vietqrCount + cashCount > 0 && rawVietqrPct + rawCashPct > 0);
  const vietqrPct = hasPaymentActivity ? rawVietqrPct : 0;
  const cashPct = hasPaymentActivity ? rawCashPct : 0;

  const qrSourceRev = Math.max(
    0,
    Number(summary?.sourceBreakdown?.qr_table?.revenue ?? 0)
  );
  const posSourceRev = Math.max(
    0,
    Number(summary?.sourceBreakdown?.counter_pos?.revenue ?? 0)
  );
  const qrSourceCount = Math.max(
    0,
    Number(summary?.sourceBreakdown?.qr_table?.count ?? 0)
  );
  const posSourceCount = Math.max(
    0,
    Number(summary?.sourceBreakdown?.counter_pos?.count ?? 0)
  );
  const rawQrSourcePct = Math.min(
    100,
    Math.max(0, Math.round(Number(summary?.sourceBreakdown?.qr_table?.percentage ?? 0)))
  );
  const rawPosSourcePct = Math.min(
    100,
    Math.max(0, Math.round(Number(summary?.sourceBreakdown?.counter_pos?.percentage ?? 0)))
  );
  const hasSourceActivity =
    qrSourceRev + posSourceRev > 0 ||
    (qrSourceCount + posSourceCount > 0 && rawQrSourcePct + rawPosSourcePct > 0);
  const qrSourcePct = hasSourceActivity ? rawQrSourcePct : 0;
  const posSourcePct = hasSourceActivity ? rawPosSourcePct : 0;

  const rawHourly = Array.isArray(summary?.hourlyBreakdown)
    ? summary.hourlyBreakdown
    : [];
  const hourlySlots: OverviewHourlySlotPoint[] = rawHourly.map((slot) => {
    const orders = Math.max(0, Number(slot?.orders ?? 0));
    const revenue = Math.max(0, Number(slot?.revenue ?? 0));
    const percentage =
      revenue > 0
        ? Math.min(100, Math.max(0, Math.round(Number(slot?.percentage ?? 0))))
        : 0;
    const barHeightPct = revenue > 0 ? Math.max(percentage, 10) : 0;
    return {
      slot: String(slot?.slot ?? ''),
      label: String(slot?.label ?? ''),
      orders,
      revenue,
      percentage,
      barHeightPct,
    };
  });

  const peakSlot =
    [...hourlySlots]
      .filter((slot) => slot.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)[0] || null;

  const scanDoorCount = Math.max(0, Number(summary?.scanDoorCount ?? 0));
  const scanTableCount = Math.max(0, Number(summary?.scanTableCount ?? 0));
  const totalScans = Math.max(0, Number(summary?.totalScans ?? 0));
  const totalQrScans =
    scanDoorCount + scanTableCount > 0
      ? scanDoorCount + scanTableCount
      : totalScans;

  const totalItemViews = (
    Array.isArray(summary?.topItems) ? summary.topItems : []
  ).reduce((s, item) => s + Math.max(0, Number(item?.view_count ?? 0)), 0);

  const totalOrdersCount = Math.max(0, Number(summary?.totalOrdersCount ?? 0));
  const showToStaffCount = Math.max(0, Number(summary?.showToStaffCount ?? 0));
  const totalOrdersSubmitted = totalOrdersCount + showToStaffCount;
  const completedOrders = Math.max(
    0,
    Number(summary?.completedOrdersCount ?? 0)
  );

  const toFunnelPct = (value: number): number =>
    totalQrScans > 0
      ? Math.min(100, Math.max(0, Math.round((value / totalQrScans) * 100)))
      : 0;

  return {
    daily7d,
    maxDailyRev,
    total7dRev,
    total7dOrders,
    vietqrPct,
    cashPct,
    hasPaymentActivity,
    qrSourcePct,
    posSourcePct,
    hasSourceActivity,
    hourlySlots,
    peakSlot,
    totalQrScans,
    totalItemViews,
    totalOrdersSubmitted,
    completedOrders,
    funnelSteps: {
      scanPct: toFunnelPct(totalQrScans),
      itemViewPct: toFunnelPct(totalItemViews),
      ordersSubmittedPct: toFunnelPct(totalOrdersSubmitted),
      completedOrdersPct: toFunnelPct(completedOrders),
    },
  };
}

interface OverviewAnalyticsState {
  summary: AnalyticsSummary | null;
  loading: boolean;
  error: string | null;
}

function createInitialOverviewAnalyticsState(): OverviewAnalyticsState {
  return {
    summary: null,
    loading: true,
    error: null,
  };
}

function applyOverviewAnalyticsFetchStart(
  prev: OverviewAnalyticsState,
  silent: boolean
): OverviewAnalyticsState {
  if (silent) {
    return prev;
  }
  return {
    ...prev,
    loading: true,
    error: null,
  };
}

function applyOverviewAnalyticsFetchSuccess(
  data: AnalyticsSummary
): OverviewAnalyticsState {
  return {
    summary: data,
    loading: false,
    error: null,
  };
}

function applyOverviewAnalyticsFetchFailure(
  prev: OverviewAnalyticsState,
  errorMessage: string
): OverviewAnalyticsState {
  return {
    summary: prev.summary,
    loading: false,
    error: errorMessage || 'ANALYTICS_LOAD_FAILED',
  };
}

export default function DashboardOverviewPage() {
  const { activeShop } = useDashboard();
  const { locale, tx } = useAppI18n();
  const [analyticsState, setAnalyticsState] = useState<OverviewAnalyticsState>(
    createInitialOverviewAnalyticsState
  );
  const { summary, loading, error } = analyticsState;
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const activeShopRef = useRef(activeShop);
  activeShopRef.current = activeShop;

  const loadAnalytics = useCallback(
    async (silent = false) => {
      const targetShopId = activeShopRef.current?.id;
      if (!targetShopId) return;
      setAnalyticsState((prev) =>
        applyOverviewAnalyticsFetchStart(prev, silent)
      );
      try {
        const res = await fetch(
          `/api/analytics/track?shopId=${encodeURIComponent(targetShopId)}`,
          { headers: getAuthHeaders(), cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (activeShopRef.current?.id === targetShopId) {
            setAnalyticsState(applyOverviewAnalyticsFetchSuccess(data));
          }
        } else {
          const errBody = await res.json().catch(() => null);
          const errMessage =
            typeof errBody?.error === 'string' && errBody.error.trim()
              ? errBody.error.trim()
              : `HTTP_${res.status}`;
          if (activeShopRef.current?.id === targetShopId) {
            setAnalyticsState((prev) =>
              applyOverviewAnalyticsFetchFailure(prev, errMessage)
            );
          }
        }
      } catch (err) {
        const errMessage =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : 'NETWORK_ERROR';
        if (activeShopRef.current?.id === targetShopId) {
          setAnalyticsState((prev) =>
            applyOverviewAnalyticsFetchFailure(prev, errMessage)
          );
        }
      }
    },
    []
  );

  useEffect(() => {
    setAnalyticsState(createInitialOverviewAnalyticsState());
    if (!activeShop?.id) return;

    return startDashboardAnalyticsSync({
      shopId: activeShop.id,
      onFetch: loadAnalytics,
    });
  }, [activeShop?.id, loadAnalytics]);

  if (!activeShop) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
        <p className="text-sm font-bold text-slate-800">
          {tx('Đang tải dữ liệu cửa hàng...', 'Loading store data...')}
        </p>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div
        role="status"
        data-testid="overview-loading-state"
        className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs"
      >
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
        <p className="text-sm font-bold text-slate-800">
          {tx(
            'Đang tải dữ liệu tổng quan & thống kê...',
            'Loading overview & analytics data...'
          )}
        </p>
        <p className="text-xs text-slate-500">
          {tx('Vui lòng đợi trong giây lát', 'Please wait a moment')}
        </p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        role="alert"
        data-testid="overview-error-state"
        className="rounded-3xl border border-rose-200 bg-white p-10 text-center space-y-4 shadow-2xs"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div className="space-y-1.5 max-w-md mx-auto">
          <h2 className="text-base font-extrabold text-slate-900">
            {tx(
              'Không thể tải dữ liệu tổng quan & thống kê',
              'Unable to load overview & analytics data'
            )}
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            {tx(
              'Đã xảy ra lỗi khi tải số liệu thống kê cửa hàng. Hệ thống không hiển thị số liệu mẫu giả lập khi chưa có dữ liệu thực tế.',
              'An error occurred while loading store analytics. Sample placeholder numbers are never shown when live data is unavailable.'
            )}
          </p>
        </div>
        <div className="pt-1">
          <button
            type="button"
            data-testid="overview-retry-button"
            onClick={() => void loadAnalytics(false)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-500 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      </div>
    );
  }

  const {
    daily7d,
    maxDailyRev,
    total7dRev,
    total7dOrders,
    vietqrPct,
    cashPct,
    hasPaymentActivity,
    qrSourcePct,
    posSourcePct,
    hasSourceActivity,
    hourlySlots,
    peakSlot,
    totalQrScans,
    totalItemViews,
    totalOrdersSubmitted,
    completedOrders,
    funnelSteps,
  } = deriveOverviewMetrics(summary);

  // Compute SVG polyline / area coordinates for 7-day trend chart (viewBox 560 x 170)
  const svgWidth = 560;
  const svgHeight = 165;
  const padX = 36;
  const padTop = 24;
  const padBottom = 26;
  const plotW = svgWidth - padX * 2;
  const plotH = svgHeight - padTop - padBottom;

  const chartPoints = daily7d.map((day, idx) => {
    const x =
      daily7d.length > 1
        ? padX + (idx / (daily7d.length - 1)) * plotW
        : svgWidth / 2;
    const ratio = Math.min(1, Math.max(0, day.revenue / maxDailyRev));
    const y = padTop + plotH - ratio * plotH;
    return { x, y, day };
  });

  const polylinePoints = chartPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPath =
    chartPoints.length > 1
      ? `M ${chartPoints[0].x},${padTop + plotH} ` +
        chartPoints.map((p) => `L ${p.x},${p.y}`).join(' ') +
        ` L ${chartPoints[chartPoints.length - 1].x},${padTop + plotH} Z`
      : '';

  const setupChecklist = evaluateShopSetupChecklist({
    shop: activeShop,
    totalCatalogItems: summary?.totalCatalogItems,
    availableCatalogItems:
      summary?.availableCatalogItems ??
      summary?.topItems?.filter((item) => item.is_available !== false).length,
    activeTablesCount: summary?.activeTablesCount,
  });

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          data-testid="overview-refresh-error-banner"
          className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start sm:items-center gap-2.5 text-xs">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              {tx(
                'Không thể làm mới số liệu mới nhất. Đang hiển thị bản chụp dữ liệu gần nhất.',
                'Could not refresh the latest analytics. Showing the last loaded snapshot.'
              )}
            </span>
          </div>
          <button
            type="button"
            data-testid="overview-refresh-retry-button"
            disabled={loading}
            onClick={() => void loadAnalytics(false)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100/70 disabled:opacity-60 transition-colors shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      )}
      {/* Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-emerald-700 via-emerald-800 to-slate-900 p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-3 py-0.5 text-xs font-bold text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {tx('Mô hình:', 'Category:')}{' '}
              {activeShop.vertical === 'fnb'
                ? tx('Ẩm thực & Đồ uống (F&B)', 'Food & Beverage (F&B)')
                : activeShop.vertical === 'service'
                  ? tx('Spa / Nail / Dịch vụ', 'Spa / Nail / Services')
                  : tx('Bán lẻ & Đặc sản', 'Retail & Specialties')}
            </span>
          </div>
          <h1
            style={{ color: '#ffffff' }}
            className="text-xl sm:text-2xl font-black tracking-tight text-white"
          >
            {activeShop.name}
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100">
            {tx('Đường dẫn QR:', 'QR link:')}{' '}
            <code className="rounded bg-black/30 px-2 py-0.5 font-mono text-amber-300">
              qlaok.vn/s/{activeShop.slug}
            </code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/dashboard/orders"
            style={{ backgroundColor: '#fbbf24', color: '#020617' }}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-400 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-amber-300 transition-transform active:scale-95"
          >
            <BellRing className="h-4 w-4" />
            <span>
              {tx('Bán hàng & Đơn ({count})', 'Counter & Orders ({count})', {
                count:
                  (summary?.newOrdersCount || 0) +
                  (summary?.preparingOrdersCount || 0),
              })}
            </span>
          </Link>
          <Link
            href="/dashboard/reports"
            style={{ backgroundColor: '#ffffff', color: '#064e3b' }}
            className="keep-white-bg keep-dark-text inline-flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-emerald-950 shadow-md hover:bg-emerald-50 border border-emerald-200 transition-transform active:scale-95"
          >
            <BarChart3 className="h-4 w-4 text-emerald-700" />
            <span>📊 {tx('Báo cáo & Xuất file', 'Reports & Export')}</span>
          </Link>
          <Link
            href="/dashboard/ai-scanner"
            style={{ backgroundColor: '#ffffff', color: '#064e3b' }}
            className="keep-white-bg keep-dark-text inline-flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-emerald-950 shadow-md hover:bg-emerald-50 border border-emerald-200 transition-transform active:scale-95"
          >
            <ScanLine className="h-4 w-4 text-emerald-700" />
            <span>{tx('Quét ảnh thực đơn', 'Scan Menu Photo')}</span>
          </Link>
          <Link
            href="/dashboard/qr-studio"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.25)',
              color: '#ffffff',
              borderColor: 'rgba(167, 243, 208, 0.65)',
            }}
            className="inline-flex items-center gap-1.5 rounded-2xl border-2 px-4 py-2.5 text-xs font-black text-white shadow-md hover:opacity-90 transition-transform active:scale-95"
          >
            <QrCode className="h-4 w-4 text-emerald-200" />
            <span>{tx('In mã QR', 'Print QR')}</span>
          </Link>
        </div>
      </div>

      {/* First-Run Store Setup Checklist (derived from persisted state) */}
      <div
        data-testid="dashboard-setup-checklist"
        className={`rounded-3xl border p-5 shadow-2xs space-y-4 ${
          setupChecklist.isAllCompleted
            ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-slate-900'
            : 'border-amber-300 bg-white dark:border-amber-500/40 dark:bg-slate-900'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                setupChecklist.isAllCompleted
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-400 text-slate-950'
              }`}
            >
              <ListChecks className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                  {setupChecklist.isAllCompleted
                    ? tx(
                        'Đã hoàn tất thiết lập cửa hàng (6/6)',
                        'Essential store setup complete (6/6)'
                      )
                    : tx(
                        'Checklist thiết lập quán lần đầu',
                        'First-run store setup checklist'
                      )}
                </h2>
                <span
                  data-testid="dashboard-setup-progress-badge"
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${
                    setupChecklist.isAllCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {tx(
                    '{done}/{total} bước hoàn tất',
                    '{done}/{total} completed',
                    {
                      done: setupChecklist.completedCount,
                      total: setupChecklist.totalCount,
                    }
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {setupChecklist.isAllCompleted
                  ? tx(
                      'Thông tin liên hệ, giờ mở cửa, VietQR, thực đơn, mã QR bàn và trạng thái công khai của quán đều đã sẵn sàng đón khách.',
                      'Store contact info, opening hours, VietQR payment, menu items, table QR codes, and live status are all configured.'
                    )
                  : tx(
                      'Hoàn thành các bước cơ bản dưới đây để khách quét QR tại bàn, gọi món và thanh toán trơn tru.',
                      'Complete these essential steps so guests can scan table QR codes, order, and pay smoothly.'
                    )}
              </p>
            </div>
          </div>

          <div className="w-full sm:w-44 shrink-0 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-300">
              <span>{tx('Tiến độ', 'Progress')}</span>
              <span>{setupChecklist.progressPercent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                style={{ width: `${setupChecklist.progressPercent}%` }}
                className="h-full rounded-full bg-emerald-600 transition-all duration-300"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {setupChecklist.steps.map((step) => (
            <Link
              key={step.id}
              href={step.href}
              data-testid={`setup-checklist-step-${step.id}`}
              data-completed={step.completed ? 'true' : 'false'}
              className={`group flex flex-col justify-between rounded-2xl border p-3.5 transition-all ${
                step.completed
                  ? 'border-emerald-200 bg-white/90 hover:border-emerald-400 dark:border-emerald-900/50 dark:bg-slate-950/60'
                  : 'border-amber-200 bg-amber-50/50 hover:border-amber-400 hover:bg-amber-50 dark:border-slate-800 dark:bg-slate-950'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  {step.completed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      {tx('Đã xong', 'Done')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-extrabold text-amber-950">
                      <Circle className="h-3 w-3 text-amber-700" />
                      {tx('Cần thiết lập', 'Action needed')}
                    </span>
                  )}
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                </div>
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white">
                  {tx(step.titleVi, step.titleEn)}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {tx(step.descVi, step.descEn)}
                </p>
              </div>
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 dark:text-emerald-400 group-hover:underline">
                {tx(step.ctaVi, step.ctaEn)} →
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Primary Revenue & Inventory KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl border-2 border-emerald-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">
              {tx('Doanh thu hôm nay', "Today's revenue")}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Banknote className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {loading
              ? '...'
              : formatCurrency(summary?.todayRevenue ?? 0, activeShop.currency)}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            {tx(
              '{orders} đơn hôm nay • TB {avg}/đơn',
              '{orders} orders today • Avg {avg}/order',
              {
                orders: summary?.todayOrdersCount ?? 0,
                avg: formatCurrency(
                  summary?.avgOrderValue ?? 0,
                  activeShop.currency
                ),
              }
            )}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              {tx('Tổng doanh thu lũy kế', 'Total revenue')}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <BarChart3 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-slate-900">
            {loading
              ? '...'
              : formatCurrency(summary?.totalRevenue ?? 0, activeShop.currency)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {tx('Tổng {count} đơn hoàn tất', '{count} total orders', {
              count: summary?.totalOrdersCount ?? 0,
            })}
          </p>
        </div>

        <Link
          href="/dashboard/orders"
          className="rounded-3xl border border-amber-300 bg-white p-4 shadow-2xs hover:border-amber-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">
              {tx('Đơn tại quầy & bếp', 'Counter & kitchen')}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <BellRing className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading
              ? '...'
              : tx('{count} đơn mới', '{count} new orders', {
                  count: summary?.newOrdersCount ?? 0,
                })}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
            {tx(
              '{prep} đang làm • {done} hoàn tất →',
              '{prep} preparing • {done} completed →',
              {
                prep: summary?.preparingOrdersCount ?? 0,
                done: summary?.completedOrdersCount ?? 0,
              }
            )}
          </p>
        </Link>

        <Link
          href="/dashboard/catalog"
          className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-emerald-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              {tx('Cảnh báo tồn kho', 'Stock alerts')}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading
              ? '...'
              : tx('{count} sắp hết', '{count} low stock', {
                  count: summary?.lowStockCount ?? 0,
                })}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-600 font-semibold">
            {tx(
              '{count} món tạm hết • Cập nhật →',
              '{count} sold out • Update →',
              { count: summary?.outOfStockCount ?? 0 }
            )}
          </p>
        </Link>
      </div>

      {/* ROW 1 CHARTS: 7-Day Interactive SVG Area/Bar Revenue Chart & Payment/Source Donut Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* CHART 1: 7-Day Revenue Area / Stacked Bar Chart (7 cols) */}
        <div className="lg:col-span-7 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx(
                    'Doanh thu & Đơn hàng 7 ngày',
                    '7-Day Revenue & Orders'
                  )}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx('Tổng 7 ngày:', '7-day total:')}{' '}
                  <strong className="text-emerald-600">
                    {formatCurrency(total7dRev, activeShop.currency)}
                  </strong>{' '}
                  (
                  {tx('{count} đơn', '{count} orders', {
                    count: total7dOrders,
                  })}
                  )
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setChartType('area')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                  chartType === 'area'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tx('Đường xu hướng', 'Trend line')}
              </button>
              <button
                type="button"
                onClick={() => setChartType('bar')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                  chartType === 'bar'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tx('Cột phân kênh', 'Stacked bars')}
              </button>
            </div>
          </div>

          {daily7d.length === 0 ? (
            <div
              data-testid="overview-daily7d-empty"
              className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-xs font-semibold text-slate-500"
            >
              {tx(
                'Chưa có dữ liệu doanh thu 7 ngày qua.',
                'No 7-day revenue data available yet.'
              )}
            </div>
          ) : chartType === 'area' ? (
            <div className="w-full overflow-hidden">
              <svg
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="w-full h-48 overflow-visible"
              >
                <defs>
                  <linearGradient
                    id="revAreaGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.5, 1].map((step, i) => {
                  const y = padTop + step * plotH;
                  return (
                    <line
                      key={i}
                      x1={padX}
                      y1={y}
                      x2={svgWidth - padX}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Area under curve */}
                {areaPath && <path d={areaPath} fill="url(#revAreaGrad)" />}

                {/* Trend Line */}
                {polylinePoints && (
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={polylinePoints}
                  />
                )}

                {/* Data Points & Labels */}
                {chartPoints.map(({ x, y, day }) => (
                  <g key={day.date}>
                    <circle
                      cx={x}
                      cy={y}
                      r="5"
                      fill="#ffffff"
                      stroke="#059669"
                      strokeWidth="3"
                    />
                    <text
                      x={x}
                      y={y - 10}
                      textAnchor="middle"
                      className="fill-slate-700 text-[10px] font-bold"
                    >
                      {day.revenue > 0
                        ? `${Math.round(day.revenue / 1000)}k`
                        : '0'}
                    </text>
                    <text
                      x={x}
                      y={svgHeight - 6}
                      textAnchor="middle"
                      className="fill-slate-500 text-[10px] font-extrabold"
                    >
                      {day.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2 items-end h-48 pt-6 border-b border-slate-100 pb-2">
              {daily7d.map((day) => (
                <div
                  key={day.date}
                  className="flex flex-col items-center justify-end h-full gap-1.5 group"
                >
                  <span className="text-[9px] font-bold text-slate-600 truncate max-w-full">
                    {day.revenue > 0
                      ? `${Math.round(day.revenue / 1000)}k`
                      : '0'}
                  </span>
                  <div className="w-full flex items-end justify-center h-32 bg-slate-50 rounded-xl overflow-hidden p-1">
                    <div
                      style={{ height: `${day.heightPct}%` }}
                      className="w-full rounded-lg overflow-hidden flex flex-col justify-end transition-all duration-500"
                      title={tx(
                        '{label}: {rev} ({orders} đơn)',
                        '{label}: {rev} ({orders} orders)',
                        {
                          label: day.label,
                          rev: formatCurrency(
                            day.revenue,
                            activeShop.currency
                          ),
                          orders: day.orders,
                        }
                      )}
                    >
                      <div
                        style={{ height: `${day.cashShare}%` }}
                        className="w-full bg-amber-400"
                      />
                      <div
                        style={{ height: `${day.vqShare}%` }}
                        className="w-full bg-emerald-500"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-extrabold text-slate-700">
                    {day.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                {tx('Chuyển khoản VietQR', 'VietQR transfer')}
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                {tx('Tiền mặt tại quầy', 'Cash at counter')}
              </span>
            </div>
            <Link
              href="/dashboard/orders"
              className="font-bold text-emerald-600 hover:underline"
            >
              {tx('Xem đơn hàng →', 'View orders →')}
            </Link>
          </div>
        </div>

        {/* CHART 2: Dual Donut Charts - Payment Method & Order Source (5 cols) */}
        <div className="lg:col-span-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx(
                    'Thanh toán & Nguồn đơn',
                    'Payment Methods & Order Sources'
                  )}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx(
                    'Tỷ trọng doanh thu VietQR / Tiền mặt và kênh gọi món',
                    'Share of VietQR vs. Cash and ordering channel'
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 py-1">
            {/* Donut 1: Payment Method */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 flex flex-col items-center text-center space-y-2">
              <div className="relative h-28 w-28 flex items-center justify-center">
                <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke={hasPaymentActivity ? '#f59e0b' : '#e2e8f0'}
                    strokeWidth="3.8"
                  />
                  {vietqrPct > 0 && (
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="transparent"
                      stroke="#10b981"
                      strokeWidth="3.8"
                      strokeDasharray={`${vietqrPct} ${100 - vietqrPct}`}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-black text-slate-900">
                    {vietqrPct}%
                  </span>
                  <span className="text-[9px] font-bold text-emerald-600 uppercase">
                    VietQR
                  </span>
                </div>
              </div>
              <div className="w-full space-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    VietQR
                  </span>
                  <strong className="text-slate-900">{vietqrPct}%</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    {tx('Tiền mặt', 'Cash')}
                  </span>
                  <strong className="text-slate-900">{cashPct}%</strong>
                </div>
              </div>
            </div>

            {/* Donut 2: Order Source */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 flex flex-col items-center text-center space-y-2">
              <div className="relative h-28 w-28 flex items-center justify-center">
                <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="transparent"
                    stroke={hasSourceActivity ? '#8b5cf6' : '#e2e8f0'}
                    strokeWidth="3.8"
                  />
                  {qrSourcePct > 0 && (
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="transparent"
                      stroke="#0284c7"
                      strokeWidth="3.8"
                      strokeDasharray={`${qrSourcePct} ${100 - qrSourcePct}`}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-black text-slate-900">
                    {qrSourcePct}%
                  </span>
                  <span className="text-[9px] font-bold text-sky-600 uppercase">
                    {tx('QR Bàn', 'Table QR')}
                  </span>
                </div>
              </div>
              <div className="w-full space-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-sky-600" />
                    {tx('Khách quét QR', 'Table QR')}
                  </span>
                  <strong className="text-slate-900">{qrSourcePct}%</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-purple-500" />
                    {tx('Tại quầy', 'Counter')}
                  </span>
                  <strong className="text-slate-900">{posSourcePct}%</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              {tx('Doanh thu VietQR:', 'VietQR revenue:')}
            </span>
            <strong className="text-emerald-600">
              {formatCurrency(
                summary?.paymentBreakdown?.vietqr.revenue ?? 0,
                activeShop.currency
              )}
            </strong>
          </div>
        </div>
      </div>

      {/* ROW 2 CHARTS: Peak Hours Chart & QR Conversion Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* CHART 3: Peak Hours Traffic & Revenue Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx('Khung giờ cao điểm', 'Peak Hours')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx(
                    'Phân bổ lượng đơn và doanh thu theo 6 khung giờ',
                    'Order volume and revenue across 6 time slots'
                  )}
                </p>
              </div>
            </div>
            {peakSlot && peakSlot.revenue > 0 && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[10px] font-black text-amber-700">
                {tx('Đông nhất: {slot}', 'Peak: {slot}', {
                  slot: peakSlot.slot,
                })}
              </span>
            )}
          </div>

          {hourlySlots.length === 0 ? (
            <div
              data-testid="overview-hourly-empty"
              className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-xs font-semibold text-slate-500"
            >
              {tx(
                'Chưa có dữ liệu khung giờ trong ngày.',
                'No hourly activity recorded yet.'
              )}
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-2 items-end h-40 pt-4 border-b border-slate-100 pb-2">
              {hourlySlots.map((slot) => {
                const isPeak =
                  peakSlot &&
                  slot.slot === peakSlot.slot &&
                  peakSlot.revenue > 0;
                return (
                  <div
                    key={slot.slot}
                    className="flex flex-col items-center justify-end h-full gap-1.5"
                  >
                    <span className="text-[9px] font-bold text-slate-500">
                      {tx('{count} đơn', '{count} ord', { count: slot.orders })}
                    </span>
                    <div className="w-full flex items-end justify-center h-24 bg-slate-50 rounded-xl overflow-hidden p-1">
                      <div
                        style={{ height: `${slot.barHeightPct}%` }}
                        className={`w-full rounded-lg transition-all duration-500 ${
                          isPeak
                            ? 'bg-gradient-to-t from-amber-500 to-amber-400'
                            : slot.orders > 0
                              ? 'bg-emerald-500'
                              : 'bg-slate-200'
                        }`}
                        title={tx(
                          '{label}: {rev} ({orders} đơn)',
                          '{label}: {rev} ({orders} orders)',
                          {
                            label: slot.label,
                            rev: formatCurrency(
                              slot.revenue,
                              activeShop.currency
                            ),
                            orders: slot.orders,
                          }
                        )}
                      />
                    </div>
                    <span className="text-[10px] font-extrabold text-slate-700">
                      {slot.slot}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {tx(
                'Gợi ý sắp xếp nhân sự theo khung giờ đông khách',
                'Staffing reference by busy hours'
              )}
            </span>
            <span className="font-bold text-slate-700">
              {tx('Tổng {count} đơn', 'Total {count} orders', {
                count: summary?.totalOrdersCount ?? 0,
              })}
            </span>
          </div>
        </div>

        {/* CHART 4: QR Conversion Funnel Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-sky-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx('Hành trình khách quét QR → Đặt món', 'QR Scan → Order Funnel')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx(
                    'Từ lúc khách quét mã QR đến khi hoàn tất thanh toán',
                    'From scanning the QR code to completing payment'
                  )}
                </p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[10px] font-black text-emerald-700">
              {tx('Chép Wi-Fi: {count}', 'Wi-Fi copies: {count}', {
                count: summary?.wifiCopyCount ?? 0,
              })}
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {[
              {
                step: tx('1. Quét mã QR Cửa & Bàn', '1. Scan Door & Table QR'),
                value: totalQrScans,
                unit: tx(
                  'lượt (Cửa: {door} • Bàn: {table})',
                  'scans (Door: {door} • Table: {table})',
                  {
                    door: summary?.scanDoorCount ?? 0,
                    table: summary?.scanTableCount ?? 0,
                  }
                ),
                pct: funnelSteps.scanPct,
                color: 'bg-sky-500',
              },
              {
                step: tx(
                  '2. Xem thực đơn & đổi ngôn ngữ',
                  '2. View menu & switch language'
                ),
                value: totalItemViews,
                unit: tx('lượt xem món', 'item views'),
                pct: funnelSteps.itemViewPct,
                color: 'bg-indigo-500',
              },
              {
                step: tx(
                  '3. Gửi đơn gọi món / Đưa màn hình',
                  '3. Place order / Show screen to staff'
                ),
                value: totalOrdersSubmitted,
                unit: tx('lượt gọi món', 'orders placed'),
                pct: funnelSteps.ordersSubmittedPct,
                color: 'bg-amber-500',
              },
              {
                step: tx(
                  '4. Đơn hoàn tất & Thanh toán',
                  '4. Completed & Paid orders'
                ),
                value: completedOrders,
                unit: tx('đơn hoàn tất', 'completed orders'),
                pct: funnelSteps.completedOrdersPct,
                color: 'bg-emerald-500',
              },
            ].map((row) => (
              <div key={row.step} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">{row.step}</span>
                  <span className="font-extrabold text-slate-900">
                    {row.value}{' '}
                    <span className="font-normal text-slate-500 text-[11px]">
                      {row.unit}
                    </span>
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    style={{ width: `${row.pct}%` }}
                    className={`h-full rounded-full ${row.color} transition-all duration-500`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 3: Top Selling Items & Visitor Languages */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top Selling Items & Remaining Stock */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-amber-500" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx('Món bán chạy & Tồn kho', 'Best Sellers & Stock')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx(
                    'Thống kê theo số lượng bán thực tế và tồn kho còn lại',
                    'Ranked by units sold and remaining stock'
                  )}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/catalog"
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:underline"
            >
              <span>{tx('Cập nhật kho', 'Manage stock')}</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {(summary?.topSellingItems || []).length === 0 ? (
            <div
              data-testid="overview-bestsellers-empty"
              className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-xs font-semibold text-slate-500"
            >
              {tx(
                'Chưa có dữ liệu món bán chạy.',
                'No best-selling items recorded yet.'
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {(summary?.topSellingItems || []).slice(0, 5).map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                        idx === 0
                          ? 'bg-amber-400 text-slate-950'
                          : idx === 1
                            ? 'bg-slate-200 text-slate-800'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">
                        {item.name_vi}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {tx('Doanh thu:', 'Revenue:')}{' '}
                        <strong className="text-emerald-600">
                          {formatCurrency(item.revenue, activeShop.currency)}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                      {tx('Đã bán: {count}', 'Sold: {count}', {
                        count: item.sold_count,
                      })}
                    </span>
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[11px] font-bold border ${
                        item.stock_quantity === 0
                          ? 'bg-rose-50 border-rose-200 text-rose-700'
                          : typeof item.stock_quantity === 'number' &&
                              item.stock_quantity <= 5
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-slate-100 border-slate-200 text-slate-700'
                      }`}
                    >
                      {tx('Tồn:', 'Stock:')}{' '}
                      {item.stock_quantity === null ||
                      item.stock_quantity === undefined
                        ? '∞'
                        : item.stock_quantity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Language Breakdown Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Languages className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {tx('Ngôn ngữ khách quét QR', 'Visitor Languages')}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {tx(
                    'Tỷ lệ khách Việt Nam và quốc tế (Anh, Hàn, Nhật, Trung, TBN, Ý, Nga)',
                    'Share of Vietnamese and international guests (EN, KO, JA, ZH, ES, IT, RU)'
                  )}
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              {tx('8 ngôn ngữ', '8 languages')}
            </span>
          </div>

          {(summary?.langBreakdown || []).length === 0 ? (
            <div
              data-testid="overview-lang-empty"
              className="flex h-36 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center text-xs font-semibold text-slate-500"
            >
              {tx(
                'Chưa có dữ liệu ngôn ngữ khách truy cập.',
                'No visitor language data recorded yet.'
              )}
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {(summary?.langBreakdown || []).map((entry) => {
                const meta = LOCALE_META[entry.lang];
                const barWidth =
                  entry.count > 0 && entry.percentage > 0
                    ? Math.max(entry.percentage, 4)
                    : 0;
                return (
                  <div key={entry.lang} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-2">
                        <FlagIcon locale={entry.lang} className="h-4 w-5.5" />
                        <span>
                          {appLanguageName(entry.lang, locale)} ({meta.nativeName})
                        </span>
                      </span>
                      <span className="font-extrabold text-slate-900">
                        {entry.percentage}% (
                        {tx('{count} lượt', '{count} views', {
                          count: entry.count,
                        })}
                        )
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
