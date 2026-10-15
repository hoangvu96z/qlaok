'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  QrCode,
  UtensilsCrossed,
  ScanLine,
  Wifi,
  Eye,
  Languages,
  TrendingUp,
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
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { CatalogItem, SupportedLocale } from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

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
  topItems: CatalogItem[];
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

export default function DashboardOverviewPage() {
  const { activeShop } = useDashboard();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');

  const loadAnalytics = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(
          `/api/analytics/track?shopId=${activeShop.id}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          setSummary(data);
        }
      } catch {
        // ignore
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeShop]
  );

  useEffect(() => {
    loadAnalytics(false);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = () => {
        loadAnalytics(true);
      };
    }

    const interval = setInterval(() => loadAnalytics(true), 5000);
    return () => {
      if (bc) bc.close();
      clearInterval(interval);
    };
  }, [loadAnalytics]);

  if (!activeShop) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Đang tải dữ liệu cửa hàng...
      </div>
    );
  }

  const daily7d = summary?.dailyRevenue7d || [];
  const maxDailyRev = Math.max(...daily7d.map((d) => d.revenue), 100000);
  const total7dRev = daily7d.reduce((s, d) => s + d.revenue, 0);
  const total7dOrders = daily7d.reduce((s, d) => s + d.orders, 0);

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

  const vietqrPct = summary?.paymentBreakdown?.vietqr.percentage ?? 65;
  const cashPct = summary?.paymentBreakdown?.cash.percentage ?? 35;
  const qrSourcePct = summary?.sourceBreakdown?.qr_table.percentage ?? 75;
  const posSourcePct = summary?.sourceBreakdown?.counter_pos.percentage ?? 25;

  const hourlySlots = summary?.hourlyBreakdown || [
    { slot: '06h-09h', label: 'Sáng (6-9h)', orders: 2, revenue: 165000, percentage: 45 },
    { slot: '09h-12h', label: 'Trưa (9-12h)', orders: 4, revenue: 380000, percentage: 100 },
    { slot: '12h-15h', label: 'Chiều (12-15h)', orders: 3, revenue: 290000, percentage: 76 },
    { slot: '15h-18h', label: 'Xế (15-18h)', orders: 2, revenue: 185000, percentage: 48 },
    { slot: '18h-21h', label: 'Tối (18-21h)', orders: 4, revenue: 350000, percentage: 92 },
    { slot: '21h-24h', label: 'Đêm (21-24h)', orders: 1, revenue: 95000, percentage: 25 },
  ];
  const peakSlot = [...hourlySlots].sort((a, b) => b.revenue - a.revenue)[0];

  // Funnel numbers
  const totalQrScans =
    (summary?.scanDoorCount || 0) + (summary?.scanTableCount || 0) || 120;
  const totalItemViews =
    (summary?.topItems || []).reduce((s, i) => s + (i.view_count || 0), 0) ||
    Math.round(totalQrScans * 0.72);
  const totalOrdersSubmitted =
    (summary?.totalOrdersCount || 0) + (summary?.showToStaffCount || 0) || 18;
  const completedOrders = summary?.completedOrdersCount || 12;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-emerald-700 via-emerald-800 to-slate-900 p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-3 py-0.5 text-xs font-bold text-emerald-100">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Ngành:{' '}
              {activeShop.vertical === 'fnb'
                ? 'Ẩm thực F&B (mPOS & QR Bàn)'
                : activeShop.vertical === 'service'
                  ? 'Spa / Nail / Dịch vụ'
                  : 'Bán lẻ & Đặc sản'}
            </span>
          </div>
          <h1
            style={{ color: '#ffffff' }}
            className="text-xl sm:text-2xl font-black tracking-tight text-white"
          >
            {activeShop.name}
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100">
            Đường dẫn QR:{' '}
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
              Màn hình Quầy mPOS (
              {(summary?.newOrdersCount || 0) +
                (summary?.preparingOrdersCount || 0)}{' '}
              đơn)
            </span>
          </Link>
          <Link
            href="/dashboard/reports"
            style={{ backgroundColor: '#ffffff', color: '#064e3b' }}
            className="keep-white-bg keep-dark-text inline-flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-emerald-950 shadow-md hover:bg-emerald-50 border border-emerald-200 transition-transform active:scale-95"
          >
            <BarChart3 className="h-4 w-4 text-emerald-700" />
            <span>📊 Sổ đơn &amp; Xuất Excel/CSV</span>
          </Link>
          <Link
            href="/dashboard/ai-scanner"
            style={{ backgroundColor: '#ffffff', color: '#064e3b' }}
            className="keep-white-bg keep-dark-text inline-flex items-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-emerald-950 shadow-md hover:bg-emerald-50 border border-emerald-200 transition-transform active:scale-95"
          >
            <ScanLine className="h-4 w-4 text-emerald-700" />
            <span>Quét Menu Giấy AI</span>
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
            <span>In QR Bàn</span>
          </Link>
        </div>
      </div>

      {/* Primary mPOS Revenue & Inventory KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl border-2 border-emerald-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">
              Doanh thu hôm nay
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
            {summary?.todayOrdersCount ?? 0} đơn hôm nay • TB{' '}
            {formatCurrency(summary?.avgOrderValue ?? 0, activeShop.currency)}
            /đơn
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              Tổng doanh thu lũy kế
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
            Tổng {summary?.totalOrdersCount ?? 0} đơn hàng thành công
          </p>
        </div>

        <Link
          href="/dashboard/orders"
          className="rounded-3xl border border-amber-300 bg-white p-4 shadow-2xs hover:border-amber-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">
              Đơn tại quầy &amp; bếp
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <BellRing className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : `${summary?.newOrdersCount ?? 0} đơn mới`}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
            {summary?.preparingOrdersCount ?? 0} đang làm •{' '}
            {summary?.completedOrdersCount ?? 0} hoàn tất →
          </p>
        </Link>

        <Link
          href="/dashboard/catalog"
          className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xs hover:border-emerald-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              Cảnh báo Tồn kho
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : `${summary?.lowStockCount ?? 0} sắp hết`}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-600 font-semibold">
            {summary?.outOfStockCount ?? 0} món tạm hết hàng • Cập nhật kho →
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
                  Biểu Đồ Doanh Thu &amp; Đơn Hàng 7 Ngày
                </h2>
                <p className="text-[11px] text-slate-500">
                  Tổng 7 ngày:{' '}
                  <strong className="text-emerald-600">
                    {formatCurrency(total7dRev, activeShop.currency)}
                  </strong>{' '}
                  ({total7dOrders} đơn)
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
                Đường xu hướng
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
                Cột phân kênh
              </button>
            </div>
          </div>

          {chartType === 'area' ? (
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
              {daily7d.map((day) => {
                const heightPct =
                  day.revenue > 0
                    ? Math.max(
                        Math.round((day.revenue / maxDailyRev) * 100),
                        16
                      )
                    : 6;
                const vqShare =
                  day.revenue > 0
                    ? Math.round(
                        ((day.vietqrRevenue ?? day.revenue * 0.65) /
                          day.revenue) *
                          100
                      )
                    : 50;
                return (
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
                        style={{ height: `${heightPct}%` }}
                        className="w-full rounded-lg overflow-hidden flex flex-col justify-end transition-all duration-500"
                        title={`${day.label}: ${formatCurrency(day.revenue, activeShop.currency)} (${day.orders} đơn)`}
                      >
                        <div
                          style={{ height: `${100 - vqShare}%` }}
                          className="w-full bg-amber-400"
                        />
                        <div
                          style={{ height: `${vqShare}%` }}
                          className="w-full bg-emerald-500"
                        />
                      </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-slate-700">
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                VietQR Chuyển khoản
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                Tiền mặt tại quầy
              </span>
            </div>
            <Link
              href="/dashboard/orders"
              className="font-bold text-emerald-600 hover:underline"
            >
              Chi tiết sổ đơn →
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
                  Cơ Cấu Thanh Toán &amp; Nguồn Đơn
                </h2>
                <p className="text-[11px] text-slate-500">
                  Tỷ trọng doanh thu VietQR vs Tiền mặt &amp; Kênh gọi món
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
                    stroke="#f59e0b"
                    strokeWidth="3.8"
                  />
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
                    Tiền mặt
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
                    stroke="#8b5cf6"
                    strokeWidth="3.8"
                  />
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
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-black text-slate-900">
                    {qrSourcePct}%
                  </span>
                  <span className="text-[9px] font-bold text-sky-600 uppercase">
                    QR Bàn
                  </span>
                </div>
              </div>
              <div className="w-full space-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-sky-600" />
                    Khách quét QR
                  </span>
                  <strong className="text-slate-900">{qrSourcePct}%</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-purple-500" />
                    Tại quầy POS
                  </span>
                  <strong className="text-slate-900">{posSourcePct}%</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-600">
              Doanh thu VietQR:
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
                  Biểu Đồ Khung Giờ Cao Điểm Trong Ngày
                </h2>
                <p className="text-[11px] text-slate-500">
                  Phân bổ mật độ khách &amp; doanh thu theo 6 khung giờ
                </p>
              </div>
            </div>
            {peakSlot && peakSlot.revenue > 0 && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[10px] font-black text-amber-700">
                Đông nhất: {peakSlot.slot}
              </span>
            )}
          </div>

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
                    {slot.orders} đơn
                  </span>
                  <div className="w-full flex items-end justify-center h-24 bg-slate-50 rounded-xl overflow-hidden p-1">
                    <div
                      style={{ height: `${Math.max(slot.percentage, 10)}%` }}
                      className={`w-full rounded-lg transition-all duration-500 ${
                        isPeak
                          ? 'bg-gradient-to-t from-amber-500 to-amber-400'
                          : slot.orders > 0
                            ? 'bg-emerald-500'
                            : 'bg-slate-200'
                      }`}
                      title={`${slot.label}: ${formatCurrency(slot.revenue, activeShop.currency)} (${slot.orders} đơn)`}
                    />
                  </div>
                  <span className="text-[10px] font-extrabold text-slate-700">
                    {slot.slot}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Gợi ý bố trí nhân sự quầy &amp; bàn theo khung giờ vàng</span>
            <span className="font-bold text-slate-700">
              Tổng {summary?.totalOrdersCount ?? 0} đơn
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
                  Phễu Chuyển Đổi Khách Quét QR → Đặt Món
                </h2>
                <p className="text-[11px] text-slate-500">
                  Hành trình từ lúc khách quét mã QR đến khi hoàn tất thanh toán
                </p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[10px] font-black text-emerald-700">
              Copy Wi-Fi: {summary?.wifiCopyCount ?? 0}
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {[
              {
                step: '1. Quét mã QR Cửa & Bàn',
                value: totalQrScans,
                unit: `lượt (Cửa: ${summary?.scanDoorCount ?? 0} • Bàn: ${summary?.scanTableCount ?? 0})`,
                pct: 100,
                color: 'bg-sky-500',
              },
              {
                step: '2. Xem thực đơn & Dịch ngôn ngữ',
                value: totalItemViews,
                unit: 'lượt xem món',
                pct: Math.min(
                  95,
                  Math.max(45, Math.round((totalItemViews / Math.max(totalQrScans, 1)) * 100))
                ),
                color: 'bg-indigo-500',
              },
              {
                step: '3. Gửi đơn gọi món / Đưa màn hình',
                value: totalOrdersSubmitted,
                unit: 'lượt gọi món',
                pct: Math.min(
                  85,
                  Math.max(28, Math.round((totalOrdersSubmitted / Math.max(totalQrScans, 1)) * 100))
                ),
                color: 'bg-amber-500',
              },
              {
                step: '4. Đơn hoàn tất & Thanh toán',
                value: completedOrders,
                unit: 'đơn thành công',
                pct: Math.min(
                  75,
                  Math.max(20, Math.round((completedOrders / Math.max(totalQrScans, 1)) * 100))
                ),
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
                  Top Món Bán Chạy &amp; Tồn Kho
                </h2>
                <p className="text-[11px] text-slate-500">
                  Thống kê theo số lượng bán thực tế &amp; lượng tồn còn lại
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/catalog"
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:underline"
            >
              <span>Nhập kho</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

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
                      Doanh thu:{' '}
                      <strong className="text-emerald-600">
                        {formatCurrency(item.revenue, activeShop.currency)}
                      </strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    Đã bán: {item.sold_count}
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
                    Tồn:{' '}
                    {item.stock_quantity === null ||
                    item.stock_quantity === undefined
                      ? '∞'
                      : item.stock_quantity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Language Breakdown Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Languages className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Biểu Đồ Ngôn Ngữ Khách Quét QR
                </h2>
                <p className="text-[11px] text-slate-500">
                  Tỷ lệ khách Việt Nam &amp; Quốc tế (Anh, Hàn, Nhật, Trung, TBN, Ý, Nga)
                </p>
              </div>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              8 ngôn ngữ
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {(summary?.langBreakdown || []).map((entry) => {
              const meta = LOCALE_META[entry.lang];
              return (
                <div key={entry.lang} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-2">
                      <FlagIcon locale={entry.lang} className="h-4 w-5.5" />
                      <span>
                        {meta.label} ({meta.nativeName})
                      </span>
                    </span>
                    <span className="font-extrabold text-slate-900">
                      {entry.percentage}% ({entry.count} lượt)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.max(entry.percentage, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
