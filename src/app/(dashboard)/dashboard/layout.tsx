'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  BellRing,
  UtensilsCrossed,
  ScanLine,
  QrCode,
  Megaphone,
  Settings,
  CreditCard,
  ExternalLink,
  PlusCircle,
  Store,
  LogOut,
  UserCheck,
  X,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';
import { DashboardProvider, useDashboard } from '@/lib/dashboard-context';
import {
  clearStoredAuthOwner,
  getAdminBackupSession,
  isSuperAdmin,
  stopAdminImpersonation,
} from '@/lib/auth-session';
import { createClient } from '@/lib/supabase/client';
import { PwaInstallBanner } from '@/components/dashboard/PwaInstallBanner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ShopOrder } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';

const NAV_ITEMS = [
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
  },
  {
    href: '/dashboard/orders',
    label: 'Đơn hàng mPOS',
    icon: BellRing,
    isOrders: true,
  },
  {
    href: '/dashboard/reports',
    label: 'Báo cáo & Xuất đơn',
    icon: FileSpreadsheet,
  },
  {
    href: '/dashboard/catalog',
    label: 'Menu / Tồn kho',
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

function playGlobalOrderChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + duration
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    playTone(659.25, 0, 0.16);
    playTone(880, 0.16, 0.32);
  } catch {
    // ignore autoplay restriction
  }
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { shops, activeShop, profile, loading, selectShop } = useDashboard();
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [liveToastOrder, setLiveToastOrder] = useState<{
    orderCode: string;
    tableLabel: string;
    totalAmount: number;
  } | null>(null);

  const knownNewIdsRef = useRef<Set<string>>(new Set());
  const firstCheckRef = useRef(true);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setAuthEmail(data.user.email);
      }
    });
  }, []);

  const checkLiveOrders = useCallback(async () => {
    if (!activeShop) return;
    try {
      const res = await fetch(
        `/api/orders?shopId=${encodeURIComponent(activeShop.id)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = await res.json();
      const orders: ShopOrder[] = data.orders || [];
      const newList = orders.filter((o) => o.status === 'new');
      setNewOrdersCount(newList.length);

      if (!firstCheckRef.current) {
        const brandNew = newList.find(
          (o) => !knownNewIdsRef.current.has(o.id)
        );
        if (brandNew) {
          playGlobalOrderChime();
          setLiveToastOrder({
            orderCode: brandNew.order_code,
            tableLabel: brandNew.table_label,
            totalAmount: brandNew.total_amount,
          });
        }
      }

      knownNewIdsRef.current = new Set(newList.map((o) => o.id));
      firstCheckRef.current = false;
    } catch {
      // ignore
    }
  }, [activeShop]);

  useEffect(() => {
    firstCheckRef.current = true;
    checkLiveOrders();

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        if (
          ev.data?.type === 'new_order_submitted' &&
          ev.data?.shopId === activeShop?.id
        ) {
          playGlobalOrderChime();
          setLiveToastOrder({
            orderCode: ev.data.orderCode || 'MỚI',
            tableLabel: ev.data.tableLabel || 'Bàn khách',
            totalAmount: ev.data.totalAmount || 0,
          });
        }
        checkLiveOrders();
      };
    }

    const interval = setInterval(checkLiveOrders, 3500);
    return () => {
      if (bc) bc.close();
      clearInterval(interval);
    };
  }, [checkLiveOrders, activeShop?.id]);

  const handleLogout = async () => {
    clearStoredAuthOwner();
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.replace('/login');
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-bold text-slate-400">
          Đang kiểm tra phiên đăng nhập Chủ quán...
        </p>
      </div>
    );
  }

  const planBadgeColor =
    profile?.plan === 'premium'
      ? 'bg-amber-400 text-slate-950'
      : profile?.plan === 'basic'
        ? 'bg-emerald-500 text-white'
        : 'bg-slate-200 text-slate-700';

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col md:flex-row">
      {/* Global Floating New Order Toast Notification */}
      {liveToastOrder && (
        <div className="fixed top-4 right-4 z-50 w-full max-w-sm rounded-3xl bg-slate-950 text-white border-2 border-amber-400 p-4 shadow-2xl animate-bounce">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950">
                <BellRing className="h-5 w-5" />
              </div>
              <div>
                <span className="inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400 uppercase">
                  Khách vừa gửi đơn mới!
                </span>
                <h4 className="mt-1 text-sm font-black text-white">
                  {liveToastOrder.tableLabel} • #{liveToastOrder.orderCode}
                </h4>
                <p className="text-xs font-bold text-amber-400">
                  Tổng đơn:{' '}
                  {formatCurrency(
                    liveToastOrder.totalAmount,
                    activeShop?.currency || 'VND'
                  )}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Link
                    href="/dashboard/orders"
                    onClick={() => setLiveToastOrder(null)}
                    className="rounded-xl bg-amber-400 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-300"
                  >
                    Mở Quầy mPOS Nhận Đơn
                  </Link>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLiveToastOrder(null)}
              className="rounded-lg p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Desktop Sidebar - Clean Light & Dark Mode High Contrast */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 font-black text-lg shadow-xs">
              Q
            </div>
            <div>
              <span className="block text-base font-black tracking-tight text-slate-900 dark:text-white">
                Qlaok mPOS
              </span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                Quét là OK • Quản trị &amp; Thu ngân
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
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Cửa hàng đang quản lý
          </label>
          <select
            value={activeShop?.id || ''}
            onChange={(e) => selectShop(e.target.value)}
            className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none"
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
                  className="flex items-center justify-center gap-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-slate-700"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>QR Cửa</span>
                </a>
                <a
                  href={`/s/${activeShop.slug}/menu?src=table`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-slate-700"
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
                className={`flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition-all ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </div>
                {item.isOrders && newOrdersCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                      active
                        ? 'bg-slate-950 text-amber-400'
                        : 'bg-amber-400 text-slate-950 animate-pulse'
                    }`}
                  >
                    {newOrdersCount} mới
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          {(isSuperAdmin(profile) || Boolean(getAdminBackupSession())) && (
            <button
              type="button"
              onClick={() => {
                stopAdminImpersonation();
                router.push('/admin');
              }}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-300 shadow-sm"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>🛡️ Super Admin Portal</span>
            </button>
          )}

          <Link
            href="/onboarding"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20"
          >
            <PlusCircle className="h-4 w-4" />
            <span>Tạo cửa hàng mới</span>
          </Link>

          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 min-w-0">
              <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-slate-900 dark:text-white">
                  {profile?.full_name || 'Chủ Quán Qlaok'}
                </p>
                <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {authEmail || profile?.email || 'chuquan@qlaok.vn'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất"
              className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen pb-20 md:pb-8">
        {/* Super Admin Impersonation / Quick Return Banner */}
        {(isSuperAdmin(profile) || Boolean(getAdminBackupSession())) && (
          <div className="bg-slate-950 text-amber-300 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="font-bold truncate">
                👑 Chế độ Super Admin ({activeShop?.name || 'Toàn sàn'})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                stopAdminImpersonation();
                router.push('/admin');
              }}
              className="shrink-0 rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-black text-slate-950 hover:bg-amber-300"
            >
              Về Trang Super Admin (/admin) →
            </button>
          </div>
        )}

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
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-extrabold text-slate-900 focus:border-emerald-500 focus:outline-none max-w-[180px] sm:max-w-xs truncate"
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
              <ThemeToggle />
              <Link
                href="/dashboard/orders"
                className={`relative inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold border ${
                  newOrdersCount > 0
                    ? 'border-amber-400 bg-amber-400 text-slate-950 animate-pulse'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <BellRing className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Quầy mPOS</span>
                {newOrdersCount > 0 && (
                  <span className="rounded-full bg-slate-950 px-1.5 py-0.2 text-[10px] font-black text-amber-400">
                    {newOrdersCount}
                  </span>
                )}
              </Link>
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

        <main className="flex-1 w-full p-3 sm:p-5">
          <PwaInstallBanner />
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Full 8-tab scrollable bar so Cài đặt & Gói cước are always accessible on mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-lg">
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
              className={`relative shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-bold transition-colors ${
                active
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{item.label}</span>
              {item.isOrders && newOrdersCount > 0 && (
                <span className="absolute -top-0.5 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-slate-950">
                  {newOrdersCount}
                </span>
              )}
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
