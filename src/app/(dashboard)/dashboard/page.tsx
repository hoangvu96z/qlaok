'use client';

import React, { useEffect, useState } from 'react';
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
  MessageSquare,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { CatalogItem, SupportedLocale } from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';

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
}

export default function DashboardOverviewPage() {
  const { activeShop, profile } = useDashboard();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeShop) return;
    setLoading(true);
    fetch(`/api/analytics/track?shopId=${activeShop.id}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setSummary(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [activeShop]);

  if (!activeShop) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Đang tải dữ liệu cửa hàng...
      </div>
    );
  }

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
                ? 'Ẩm thực F&B'
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
            <span>Tải Bảng QR In Ấn</span>
          </Link>
        </div>
      </div>

      {/* 4 Key Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              Lượt quét QR Cửa
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <QrCode className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : summary?.scanDoorCount ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Xem thông tin quán & Wi-Fi
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              Lượt quét QR Bàn
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <UtensilsCrossed className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : summary?.scanTableCount ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Mở trực tiếp Menu / Bảng giá
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              Thẻ Đưa Nhân Viên Xem
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <MessageSquare className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : summary?.showToStaffCount ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Khách bật màn hình gọi món
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">
              Lượt Copy Wi-Fi
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Wifi className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {loading ? '...' : summary?.wifiCopyCount ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Chạm copy mật khẩu 1 chạm
          </p>
        </div>
      </div>

      {/* Two-Column Analytics Breakdown: Visitor Languages & Top 5 Viewed Items */}
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
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <span className="text-base">{meta.flag}</span>
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
