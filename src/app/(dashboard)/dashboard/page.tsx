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
    orders: number;
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
  const maxDailyRev = Math.max(...daily7d.map((d) => d.revenue), 1);

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-3 py-0.5 text-xs font-bold text-emerald-300">
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
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            {activeShop.name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-300">
            Đường dẫn QR:{' '}
            <code className="rounded bg-white/10 px-2 py-0.5 font-mono text-emerald-300">
              qlaok.vn/s/{activeShop.slug}
            </code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-400 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-amber-300"
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
            href="/dashboard/ai-scanner"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400"
          >
            <ScanLine className="h-4 w-4" />
            <span>Quét Menu Giấy AI</span>
          </Link>
          <Link
            href="/dashboard/qr-studio"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 px-4 py-2.5 text-xs font-bold text-white"
          >
            <QrCode className="h-4 w-4" />
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

      {/* 7-Day Revenue Bar Chart & Best-Selling Items by Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 7-Day Daily Revenue Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-600" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Biểu Đồ Doanh Thu 7 Ngày Gần Nhất
                </h2>
                <p className="text-[11px] text-slate-400">
                  Tự động tổng hợp từ đơn QR tại bàn &amp; POS tại quầy
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/orders"
              className="text-xs font-bold text-emerald-600 hover:underline"
            >
              Xem lịch sử đơn →
            </Link>
          </div>

          <div className="grid grid-cols-7 gap-2 items-end h-44 pt-6 border-b border-slate-100 pb-2">
            {daily7d.map((day) => {
              const heightPct =
                day.revenue > 0
                  ? Math.max(Math.round((day.revenue / maxDailyRev) * 100), 14)
                  : 6;
              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center justify-end h-full gap-1.5 group"
                >
                  <span className="text-[9px] font-bold text-slate-500 truncate max-w-full">
                    {day.revenue > 0
                      ? `${Math.round(day.revenue / 1000)}k`
                      : '0'}
                  </span>
                  <div className="w-full flex items-end justify-center h-28 bg-slate-50 rounded-xl overflow-hidden p-1">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-lg transition-all duration-500 ${
                        day.revenue > 0
                          ? 'bg-emerald-500 group-hover:bg-emerald-600'
                          : 'bg-slate-200'
                      }`}
                      title={`${day.label}: ${formatCurrency(day.revenue, activeShop.currency)} (${day.orders} đơn)`}
                    />
                  </div>
                  <span className="text-[10px] font-extrabold text-slate-700">
                    {day.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Selling Items & Remaining Stock */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-amber-500" />
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Top Món Bán Chạy &amp; Tồn Kho
                </h2>
                <p className="text-[11px] text-slate-400">
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
      </div>

      {/* Secondary Row: QR Traffic Metrics */}
      <div className="grid grid-cols-3 gap-3.5">
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500">
              Lượt quét QR Cửa
            </span>
            <p className="text-lg font-black text-slate-900">
              {loading ? '...' : summary?.scanDoorCount ?? 0}
            </p>
          </div>
          <QrCode className="h-5 w-5 text-emerald-600" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500">
              Lượt quét QR Bàn
            </span>
            <p className="text-lg font-black text-slate-900">
              {loading ? '...' : summary?.scanTableCount ?? 0}
            </p>
          </div>
          <UtensilsCrossed className="h-5 w-5 text-blue-600" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500">
              Lượt Copy Wi-Fi
            </span>
            <p className="text-lg font-black text-slate-900">
              {loading ? '...' : summary?.wifiCopyCount ?? 0}
            </p>
          </div>
          <Wifi className="h-5 w-5 text-purple-600" />
        </div>
      </div>

      {/* Visitor Languages & Top Viewed Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Language Breakdown Chart */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Languages className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-extrabold text-slate-900">
                Tỷ lệ Ngôn ngữ Khách hàng
              </h2>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              5 ngôn ngữ tự động
            </span>
          </div>

          <div className="space-y-3">
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

        {/* Top 5 Viewed Items */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-amber-500" />
              <h2 className="text-base font-extrabold text-slate-900">
                Top 5 Món / Dịch vụ Xem nhiều nhất
              </h2>
            </div>
            <Link
              href="/dashboard/catalog"
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:underline"
            >
              <span>Quản lý món</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {(summary?.topItems || []).map((item, idx) => (
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
                      {item.name_i18n.vi}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {formatCurrency(item.price, activeShop.currency)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  <Eye className="h-3.5 w-3.5 text-slate-400" />
                  <span>{item.view_count || 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
