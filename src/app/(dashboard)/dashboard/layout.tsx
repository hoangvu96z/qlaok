'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ScanLine,
  QrCode,
  Megaphone,
  Settings,
  CreditCard,
  ExternalLink,
  PlusCircle,
  Store,
  Crown,
} from 'lucide-react';
import { DashboardProvider, useDashboard } from '@/lib/dashboard-context';

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
  },
  {
    href: '/dashboard/catalog',
    label: 'Menu / Bảng giá',
    icon: UtensilsCrossed,
  },
  {
    href: '/dashboard/ai-scanner',
    label: 'Quét Menu AI',
    icon: ScanLine,
  },
  {
    href: '/dashboard/qr-studio',
    label: 'In Mã QR',
    icon: QrCode,
  },
  {
    href: '/dashboard/posts',
    label: 'Khuyến mãi',
    icon: Megaphone,
  },
  {
    href: '/dashboard/settings',
    label: 'Cài đặt quán',
    icon: Settings,
  },
  {
    href: '/dashboard/billing',
    label: 'Gói cước',
    icon: CreditCard,
  },
];

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { shops, activeShop, profile, selectShop } = useDashboard();

  const planBadgeColor =
    profile?.plan === 'premium'
      ? 'bg-amber-400 text-slate-950'
      : profile?.plan === 'basic'
        ? 'bg-emerald-500 text-white'
        : 'bg-slate-200 text-slate-700';

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-slate-900 text-white border-r border-slate-800">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 font-black text-lg">
              Q
            </div>
            <div>
              <span className="block text-base font-black tracking-tight">
                Qlaok CMS
              </span>
              <span className="block text-[10px] text-slate-400">
                Quét là OK • Quản trị cửa hàng
              </span>
            </div>
          </Link>

          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${planBadgeColor}`}
          >
            {profile?.plan || 'free'}
          </span>
        </div>

        {/* Store Selector */}
        <div className="p-3.5 border-b border-slate-800 space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Cửa hàng đang quản lý
          </label>
          <select
            value={activeShop?.id || ''}
            onChange={(e) => selectShop(e.target.value)}
            className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs font-bold text-white focus:border-emerald-500 focus:outline-none"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.vertical === 'fnb'
                  ? '🍜 '
                  : s.vertical === 'service'
                    ? '💆‍♀️ '
                    : '🛍️ '}
                {s.name}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {activeShop && (
              <>
                <a
                  href={`/s/${activeShop.slug}?src=door`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 rounded-lg bg-slate-800/90 hover:bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-emerald-400 border border-slate-700/80"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>QR Cửa</span>
                </a>
                <a
                  href={`/s/${activeShop.slug}/menu?src=table`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 rounded-lg bg-slate-800/90 hover:bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-amber-400 border border-slate-700/80"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>QR Bàn</span>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-2">
          <Link
            href="/onboarding"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20"
          >
            <PlusCircle className="h-4 w-4" />
            <span>Tạo cửa hàng mới</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen pb-20 md:pb-8">
        {/* Top Mobile Header */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/"
              className="md:hidden flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white font-black text-sm"
            >
              Q
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 text-emerald-600 shrink-0 hidden sm:inline" />
                <select
                  value={activeShop?.id || ''}
                  onChange={(e) => selectShop(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-900 focus:border-emerald-500 focus:outline-none max-w-[200px] sm:max-w-xs truncate"
                >
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.vertical.toUpperCase()})
                    </option>
                  ))}
                </select>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${planBadgeColor}`}
                >
                  {profile?.plan || 'free'}
                </span>
              </div>
            </div>
          </div>

          {activeShop && (
            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href={`/s/${activeShop.slug}?src=door`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Xem QR Cửa</span>
                <span className="sm:hidden">Cửa</span>
              </a>
              <a
                href={`/s/${activeShop.slug}/menu?src=table`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Xem Menu QR Bàn</span>
                <span className="sm:hidden">Menu</span>
              </a>
            </div>
          )}
        </header>

        <main className="flex-1 mx-auto w-full max-w-5xl p-4 sm:p-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-1 py-1.5 flex items-center justify-around shadow-lg">
        {NAV_ITEMS.slice(0, 6).map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname?.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-bold transition-colors ${
                active
                  ? 'text-emerald-600'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-[60px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}
