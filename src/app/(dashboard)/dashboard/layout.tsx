'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  BellRing,
  ChefHat,
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
  ChevronLeft,
  ChevronRight,
  Monitor,
  RefreshCw,
  Globe,
  EyeOff,
} from 'lucide-react';
import { DashboardProvider, useDashboard } from '@/lib/dashboard-context';
import {
  clearStoredAuthOwner,
  getAdminBackupSession,
  getAuthHeaders,
  getStoredAuthOwner,
  isSuperAdmin,
  stopAdminImpersonation,
} from '@/lib/auth-session';
import { startOrderLiveSync } from '@/lib/order-live-sync';
import { PwaInstallBanner } from '@/components/dashboard/PwaInstallBanner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandLogo } from '@/components/ui/BrandLogo';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';
import {
  AppTranslationKey,
  formatNotificationToggleLabel,
} from '@/lib/app-i18n';
import { ShopOrder, TableServiceRequest } from '@/types/qlaok';
import {
  canAccessDashboardHref,
  getFallbackDashboardHref,
  getNavRequirementForPath,
  isOrdersDashboardRoute,
  isShopOwnerMembership,
  membershipHasPermission,
  shouldDashboardShellSyncOrders,
} from '@/lib/dashboard-nav';
import { formatCurrency } from '@/lib/i18n-helper';
import {
  getUnseenPendingServiceRequests,
  shouldNotifyBrowserServiceRequest,
} from '@/lib/service-request-browser-notifications';
import {
  ensureAudioContextUnlocked,
  getBrowserNotificationPermission,
  loadOrderChimeSettings,
  playOrderAlertChime,
  requestBrowserNotificationPermission,
  sendBrowserOrderNotification,
  sendBrowserServiceRequestNotification,
  CHIME_SETTINGS_EVENT,
  type OrderToastPosition,
} from '@/lib/order-chime';

const NAV_ITEMS: Array<{
  href: string;
  labelKey: AppTranslationKey;
  icon: React.ComponentType<{ className?: string }>;
  isOrders?: boolean;
}> = [
  {
    href: '/dashboard',
    labelKey: 'nav.overview',
    icon: LayoutDashboard,
  },
  {
    href: '/dashboard/orders',
    labelKey: 'nav.orders',
    icon: BellRing,
    isOrders: true,
  },
  {
    href: '/dashboard/kitchen',
    labelKey: 'nav.kitchen',
    icon: ChefHat,
  },
  {
    href: '/dashboard/reports',
    labelKey: 'nav.reports',
    icon: FileSpreadsheet,
  },
  {
    href: '/dashboard/catalog',
    labelKey: 'nav.catalog',
    icon: UtensilsCrossed,
  },
  {
    href: '/dashboard/ai-scanner',
    labelKey: 'nav.aiScanner',
    icon: ScanLine,
  },
  {
    href: '/dashboard/qr-studio',
    labelKey: 'nav.qrStudio',
    icon: QrCode,
  },
  {
    href: '/dashboard/posts',
    labelKey: 'nav.promotions',
    icon: Megaphone,
  },
  {
    href: '/dashboard/settings',
    labelKey: 'nav.settings',
    icon: Settings,
  },
  {
    href: '/dashboard/billing',
    labelKey: 'nav.billing',
    icon: CreditCard,
  },
];

export const TOAST_POSITION_CLASSES: Record<OrderToastPosition, string> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
};

export interface LiveToastOrderData {
  orderCode: string;
  tableLabel: string;
  totalAmount: number;
}

export interface NewOrderToastCardProps {
  order: LiveToastOrderData;
  position?: OrderToastPosition;
  currency?: string;
  targetHref?: string;
  onOpenOrders: () => void;
  openOrdersLabel: string;
  newOrderBadgeLabel: string;
  totalLabel: string;
}

export function NewOrderToastCard({
  order,
  position = 'top-right',
  currency = 'VND',
  targetHref = '/dashboard/orders',
  onOpenOrders,
  openOrdersLabel,
  newOrderBadgeLabel,
  totalLabel,
}: NewOrderToastCardProps) {
  const positionClass = TOAST_POSITION_CLASSES[position] || 'top-4 right-4';
  const ariaLabel = `${order.tableLabel} • #${order.orderCode} - ${openOrdersLabel}`;

  return (
    <Link
      href={targetHref}
      onClick={() => {
        onOpenOrders();
      }}
      aria-live="polite"
      aria-label={ariaLabel}
      data-testid="new-order-toast-card"
      className={`fixed ${positionClass} z-50 block w-[calc(100vw-2rem)] max-w-sm rounded-3xl bg-slate-950 text-white border-2 border-amber-400 p-4 shadow-2xl animate-bounce focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer select-none group`}
    >
      <div
        data-testid="toast-card-content"
        className="flex items-start justify-between gap-3 pointer-events-none"
      >
        <div className="flex items-start gap-3">
          <div
            data-testid="toast-card-bell"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950"
          >
            <BellRing className="h-5 w-5" />
          </div>
          <div>
            <span
              data-testid="toast-card-badge"
              className="inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400 uppercase"
            >
              {newOrderBadgeLabel}
            </span>
            <h4
              data-testid="toast-card-title"
              className="mt-1 text-sm font-black text-white"
            >
              {order.tableLabel} • #{order.orderCode}
            </h4>
            <p
              data-testid="toast-card-total"
              className="text-xs font-bold text-amber-400"
            >
              {totalLabel}{' '}
              {formatCurrency(
                order.totalAmount,
                currency
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                data-testid="toast-card-cta"
                className="rounded-xl bg-amber-400 px-3 py-1.5 text-[11px] font-black text-slate-950 group-hover:bg-amber-300 transition-colors"
              >
                {openOrdersLabel}
              </span>
            </div>
          </div>
        </div>
        <span
          data-testid="toast-card-close"
          aria-hidden="true"
          className="rounded-lg p-1 text-slate-400 group-hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, t, tx } = useAppI18n();
  const {
    shops,
    activeShop,
    activeMembership,
    profile,
    loading,
    error: dashboardError,
    membershipsLoaded,
    selectShop,
    refreshDashboard,
  } = useDashboard();
  const [retrying, setRetrying] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [latestNewTableLabel, setLatestNewTableLabel] = useState<string>('Bàn khách');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<
    NotificationPermission | 'unsupported'
  >('default');
  const [liveToastOrder, setLiveToastOrder] = useState<{
    orderCode: string;
    tableLabel: string;
    totalAmount: number;
  } | null>(null);
  const [toastPosition, setToastPosition] =
    useState<OrderToastPosition>('top-right');

  const translateRef = useRef(tx);
  translateRef.current = tx;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const activeShopRef = useRef(activeShop);
  activeShopRef.current = activeShop;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const routerRef = useRef(router);
  routerRef.current = router;

  const scopeRef = useRef({ shopId: activeShop?.id });
  if (scopeRef.current.shopId !== activeShop?.id) {
    scopeRef.current = { shopId: activeShop?.id };
  }
  const inFlightRef = useRef<{ scope: object; again: boolean } | null>(null);
  const disposedRef = useRef(false);
  const knownNewIdsRef = useRef<Set<string>>(new Set());
  const knownServiceReqIdsRef = useRef<Set<string>>(new Set());
  const firstCheckRef = useRef(true);

  useEffect(() => {
    disposedRef.current = false;
    ensureAudioContextUnlocked();

    const handleChimeSettingsChange = () => {
      if (disposedRef.current) return;
      // Re-read the persisted value so malformed/custom event details cannot
      // bypass the position validation in loadOrderChimeSettings.
      setToastPosition(loadOrderChimeSettings().newOrderToastPosition);
    };

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('qlaok_cms_sidebar_collapsed');
        if (saved === '1') {
          setIsSidebarCollapsed(true);
        }
      } catch {
        // ignore storage errors
      }
      setBrowserPerm(getBrowserNotificationPermission());
      setToastPosition(loadOrderChimeSettings().newOrderToastPosition);
      window.addEventListener(CHIME_SETTINGS_EVENT, handleChimeSettingsChange);
    }
    const storedOwner = getStoredAuthOwner();
    if (storedOwner?.email) {
      setAuthEmail(storedOwner.email);
    }
    return () => {
      disposedRef.current = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(
          CHIME_SETTINGS_EVENT,
          handleChimeSettingsChange
        );
      }
    };
  }, []);

  const triggerOrderAlertAndNotifications = useCallback(
    (orderInfo: {
      orderCode: string;
      tableLabel: string;
      totalAmount: number;
      itemsSummary?: string;
    }) => {
      const currentShop = activeShopRef.current;
      const onOrdersRoute = isOrdersDashboardRoute(pathnameRef.current);

      if (!onOrdersRoute) {
        playOrderAlertChime(
          undefined,
          orderInfo.tableLabel,
          orderInfo.orderCode
        );

        setLiveToastOrder({
          orderCode: orderInfo.orderCode,
          tableLabel: orderInfo.tableLabel,
          totalAmount: orderInfo.totalAmount,
        });

        sendBrowserOrderNotification({
          orderCode: orderInfo.orderCode,
          tableLabel: orderInfo.tableLabel,
          totalFormatted: formatCurrency(
            orderInfo.totalAmount,
            currentShop?.currency || 'VND'
          ),
          shopName: currentShop?.name,
          itemsSummary: orderInfo.itemsSummary,
          onClickNavigate: () => {
            setLiveToastOrder(null);
            routerRef.current.push('/dashboard/orders');
          },
        });
      }
    },
    []
  );

  const checkLiveOrders = useCallback(
    async function refresh(): Promise<void> {
      const shopId = activeShopRef.current?.id;
      if (
        !shopId ||
        disposedRef.current ||
        isOrdersDashboardRoute(pathnameRef.current)
      ) {
        return;
      }
      if (inFlightRef.current?.scope === scopeRef.current) {
        inFlightRef.current.again = true;
        return;
      }
      const scope = scopeRef.current;
      const request = { scope, again: false };
      inFlightRef.current = request;
      try {
        const res = await fetch(
          `/api/orders?shopId=${encodeURIComponent(shopId)}&view=badge`,
          { cache: 'no-store', headers: getAuthHeaders() }
        );
        if (
          disposedRef.current ||
          scopeRef.current !== scope ||
          isOrdersDashboardRoute(pathnameRef.current) ||
          !res.ok
        ) {
          return;
        }
        const data = await res.json();
        if (
          disposedRef.current ||
          scopeRef.current !== scope ||
          isOrdersDashboardRoute(pathnameRef.current)
        ) {
          return;
        }
        const orders: ShopOrder[] = data.orders || [];
        const serviceRequests: TableServiceRequest[] = Array.isArray(
          data.serviceRequests
        )
          ? data.serviceRequests
          : [];
        const newList = orders.filter((o) => o.status === 'new');
        const pendingServiceReqs = serviceRequests.filter(
          (r) => r.status === 'pending'
        );
        setNewOrdersCount(newList.length + pendingServiceReqs.length);
        if (newList[0]?.table_label) {
          setLatestNewTableLabel(newList[0].table_label);
        } else if (pendingServiceReqs[0]?.table_label) {
          setLatestNewTableLabel(pendingServiceReqs[0].table_label);
        }

        if (!firstCheckRef.current) {
          const brandNew = newList.find(
            (o) => !knownNewIdsRef.current.has(o.id)
          );
          const brandNewServiceReqs = getUnseenPendingServiceRequests(
            pendingServiceReqs,
            knownServiceReqIdsRef.current
          );
          if (brandNew) {
            const itemsSummary = (brandNew.items || [])
              .slice(0, 3)
              .map(
                (it) =>
                  `${it.quantity}x ${it.name_vi || translateRef.current('Món', 'Item')}`
              )
              .join(', ');
            triggerOrderAlertAndNotifications({
              orderCode:
                brandNew.order_code || translateRef.current('MỚI', 'NEW'),
              tableLabel:
                brandNew.table_label ||
                translateRef.current('Bàn khách', 'Guest table'),
              totalAmount: brandNew.total_amount,
              itemsSummary,
            });
          }
          const notifiableServiceReqs = brandNewServiceReqs.filter((request) =>
            shouldNotifyBrowserServiceRequest({
              rule:
                activeShopRef.current?.theme_config
                  ?.serviceRequestNotificationRule,
              requestType: request.request_type,
              userId: profileRef.current?.id,
              ownerId: activeShopRef.current?.owner_id,
            })
          );
          if (!brandNew && notifiableServiceReqs.length > 0) {
            playOrderAlertChime(
              undefined,
              notifiableServiceReqs[0].table_label
            );
          }
          for (const serviceRequest of notifiableServiceReqs) {
            sendBrowserServiceRequestNotification({
              requestId: serviceRequest.id,
              tableLabel: serviceRequest.table_label,
              requestType: serviceRequest.request_type,
              shopName: activeShopRef.current?.name,
              onClickNavigate: () => {
                routerRef.current.push('/dashboard/orders');
              },
            });
          }
        }

        knownNewIdsRef.current = new Set(newList.map((o) => o.id));
        knownServiceReqIdsRef.current = new Set(
          pendingServiceReqs.map((r) => r.id)
        );
        firstCheckRef.current = false;
      } catch {
        // ignore
      } finally {
        if (inFlightRef.current === request) {
          inFlightRef.current = null;
        }
        if (
          !disposedRef.current &&
          scopeRef.current === scope &&
          !isOrdersDashboardRoute(pathnameRef.current) &&
          request.again
        ) {
          queueMicrotask(() => {
            void refresh();
          });
        }
      }
    },
    [triggerOrderAlertAndNotifications]
  );

  const shouldSyncOrders = shouldDashboardShellSyncOrders(pathname);

  useEffect(() => {
    if (!shouldSyncOrders) {
      setLiveToastOrder(null);
      return;
    }

    firstCheckRef.current = true;
    knownNewIdsRef.current = new Set();
    knownServiceReqIdsRef.current = new Set();
    setNewOrdersCount(0);
    setLiveToastOrder(null);
    setLatestNewTableLabel(translateRef.current('Bàn khách', 'Guest table'));

    const shopId = activeShop?.id;
    if (!shopId) return;

    void checkLiveOrders();

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        if (ev.data?.shopId !== shopId) return;
        if (isOrdersDashboardRoute(pathnameRef.current)) return;
        // Guest storefront sends 'order_created'; keep legacy
        // 'new_order_submitted' for compatibility.
        if (
          ev.data?.type === 'order_created' ||
          ev.data?.type === 'new_order_submitted'
        ) {
          if (typeof ev.data.orderId === 'string') {
            knownNewIdsRef.current.add(ev.data.orderId);
          }
          triggerOrderAlertAndNotifications({
            orderCode:
              ev.data.orderCode || translateRef.current('MỚI', 'NEW'),
            tableLabel:
              ev.data.tableLabel ||
              translateRef.current('Bàn khách', 'Guest table'),
            totalAmount:
              Number(ev.data.totalAmount || ev.data.totalVnd) || 0,
          });
        }
        if (document.visibilityState !== 'hidden') {
          void checkLiveOrders();
        }
      };
    }

    const stopSync = startOrderLiveSync({
      query: new URLSearchParams({ shopId }).toString(),
      headers: getAuthHeaders,
      onChange: () => {
        void checkLiveOrders();
      },
    });

    return () => {
      if (bc) bc.close();
      stopSync();
      scopeRef.current = { shopId };
    };
  }, [
    activeShop?.id,
    shouldSyncOrders,
    checkLiveOrders,
    triggerOrderAlertAndNotifications,
  ]);

  // Repeat reminder chime every 10s when on non-orders dashboard pages if there are unaccepted 'new' orders
  useEffect(() => {
    if (isOrdersDashboardRoute(pathname) || newOrdersCount === 0) return;
    const reminderInterval = setInterval(() => {
      const currentSettings = loadOrderChimeSettings();
      if (currentSettings.enabled && currentSettings.remindUntilAccepted) {
        playOrderAlertChime(currentSettings, latestNewTableLabel);
      }
    }, 10000);
    return () => clearInterval(reminderInterval);
  }, [pathname, newOrdersCount, latestNewTableLabel]);

  // Role-based route guard: e.g. staff without reports.view landing on the
  // overview are sent to the orders screen. Never "allow" before memberships load.
  const routeRequirement = getNavRequirementForPath(pathname);
  const routeAllowed =
    !routeRequirement ||
    (membershipsLoaded &&
      Boolean(activeShop) &&
      canAccessDashboardHref(pathname || '/dashboard', activeMembership));
  useEffect(() => {
    if (!membershipsLoaded || !activeShop || routeAllowed) return;
    const fallback = getFallbackDashboardHref(activeMembership);
    if (fallback && fallback !== pathname) {
      router.replace(fallback);
    }
  }, [membershipsLoaded, activeShop, activeMembership, routeAllowed, pathname, router]);

  const handleEnableOrTestBrowserNotifications = async () => {
    const perm = await requestBrowserNotificationPermission();
    setBrowserPerm(perm);
    if (perm === 'granted') {
      playOrderAlertChime(undefined, tx('Bàn 05', 'Table 05'));
      sendBrowserOrderNotification({
        orderCode: 'TEST-88',
        tableLabel: tx('Bàn 05 (Thử chuông)', 'Table 05 (Test)'),
        totalFormatted: formatCurrency(65000, activeShop?.currency || 'VND'),
        shopName: activeShop?.name,
        itemsSummary: tx(
          '2x Cà phê sữa đá, 1x Bánh sừng bò',
          '2x Iced Milk Coffee, 1x Croissant'
        ),
        forceTest: true,
        onClickNavigate: () => router.push('/dashboard/orders'),
      });
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('qlaok_cms_sidebar_collapsed', next ? '1' : '0');
        } catch {
          // ignore storage errors
        }
      }
      return next;
    });
  };

  const handleLogout = async () => {
    clearStoredAuthOwner();
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {
      // ignore network error on logout
    }
    router.replace('/login');
  };

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    canAccessDashboardHref(item.href, activeMembership)
  );
  const isOwner = isShopOwnerMembership(activeMembership);
  const canPublish = membershipHasPermission(activeMembership, 'settings.manage');
  const canViewOrders = membershipHasPermission(activeMembership, 'orders.view');

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await refreshDashboard();
    } finally {
      setRetrying(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!activeShop || publishBusy) return;
    const nextPublished = activeShop.is_published === false;
    setPublishBusy(true);
    setPublishError(null);
    try {
      const res = await fetch('/api/shops', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: activeShop.id, is_published: nextPublished }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error ||
            tx('Không thể cập nhật trạng thái công khai.', 'Could not update publish status.')
        );
      }
      await refreshDashboard();
    } catch (err) {
      setPublishError(
        err instanceof Error
          ? err.message
          : tx('Không thể cập nhật trạng thái công khai.', 'Could not update publish status.')
      );
    } finally {
      setPublishBusy(false);
    }
  };

  if (dashboardError && !profile) {
    return (
      <div
        role="alert"
        data-testid="dashboard-layout-error"
        className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4 text-center"
      >
        <p className="text-sm font-black text-rose-300">
          {tx(
            'Không thể tải dữ liệu quản lý quán. Vui lòng kiểm tra kết nối mạng.',
            'Could not load your store dashboard. Please check your connection.'
          )}
        </p>
        <p className="text-[11px] text-slate-400 break-all">{dashboardError}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            data-testid="dashboard-layout-retry"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {tx('Thử lại', 'Retry')}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800"
          >
            {t('header.logout')}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !profile) {
    return (
      <div
        role="status"
        data-testid="dashboard-layout-loading"
        className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-3"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-bold text-slate-300">
          {tx(
            'Đang tải dữ liệu quản lý quán & kiểm tra phiên đăng nhập...',
            'Loading store dashboard data & checking sign-in session...'
          )}
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

  const sidebarToggleLabel = isSidebarCollapsed
    ? t('header.expandMenu')
    : t('header.collapseMenu');

  const notifButtonLabel = formatNotificationToggleLabel(browserPerm, locale);
  const notifTooltip =
    browserPerm === 'granted'
      ? t('header.alertsTooltipOn')
      : t('header.alertsTooltipOff');

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col md:flex-row">
      {/* Global Floating New Order Toast Notification */}
      {liveToastOrder && (
        <NewOrderToastCard
          order={liveToastOrder}
          position={toastPosition}
          currency={activeShop?.currency || 'VND'}
          onOpenOrders={() => setLiveToastOrder(null)}
          openOrdersLabel={t('header.openOrdersNow')}
          newOrderBadgeLabel={t('header.newTableOrderBadge')}
          totalLabel={tx('Tổng đơn:', 'Total:')}
        />
      )}

      {/* Desktop Collapsible Sidebar (Expanded w-64 vs Collapsed w-[72px] Icon Rail) */}
      <aside
        className={`hidden md:flex md:flex-col md:fixed md:inset-y-0 z-40 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-r border-slate-200 dark:border-slate-800 transition-all duration-200 select-none ${
          isSidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'
        }`}
      >
        {/* Floating Edge Collapse/Expand Handle Tab on the right border */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarToggleLabel}
          aria-expanded={!isSidebarCollapsed}
          title={sidebarToggleLabel}
          data-testid="sidebar-edge-toggle"
          className="absolute -right-3.5 top-20 z-50 flex h-8 w-7 items-center justify-center rounded-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-md hover:border-emerald-500 hover:bg-emerald-500 hover:text-slate-950 transition-all"
        >
          {isSidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>

        {/* Sidebar Top Brand */}
        <div
          className={`border-b border-slate-200 dark:border-slate-800 flex items-center ${
            isSidebarCollapsed
              ? 'flex-col justify-center gap-2 py-3 px-2'
              : 'justify-between p-4'
          }`}
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 min-w-0"
            aria-label={tx('Qlaok • Trang chủ', 'Qlaok • Home')}
            title={tx('Qlaok • Trang chủ', 'Qlaok • Home')}
          >
            <BrandLogo
              className="h-9 w-9 rounded-xl shadow-xs"
              alt={isSidebarCollapsed ? 'Qlaok' : ''}
            />
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-base font-black tracking-tight text-slate-900 dark:text-white">
                    Qlaok
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${planBadgeColor}`}
                  >
                    {profile?.plan || 'free'}
                  </span>
                </div>
                <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {tx('Quản lý & Bán hàng', 'Store & POS')}
                </span>
              </div>
            )}
          </Link>
        </div>

        {/* Store Selector (Full when expanded, compact icon links when collapsed) */}
        {!isSidebarCollapsed ? (
          <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {tx('Cửa hàng đang quản lý', 'Active store')}
            </label>
            <select
              value={activeShop?.id || ''}
              onChange={(e) => selectShop(e.target.value)}
              aria-label={tx('Chọn cửa hàng', 'Select store')}
              className="w-full rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none truncate"
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
                    <span>{tx('QR Cửa', 'Door QR')}</span>
                  </a>
                  <a
                    href={`/s/${activeShop.slug}/menu?src=table`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-slate-700"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>{tx('QR Bàn', 'Table QR')}</span>
                  </a>
                </>
              )}
            </div>
          </div>
        ) : (
          activeShop && (
            <div className="py-2.5 px-2 border-b border-slate-200 dark:border-slate-800 flex flex-col items-center gap-1.5">
              <a
                href={`/s/${activeShop.slug}/menu?src=table`}
                target="_blank"
                rel="noopener noreferrer"
                title={tx(
                  'Mở Menu QR Bàn ({shopName})',
                  'Open Table QR Menu ({shopName})',
                  { shopName: activeShop.name }
                )}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-slate-800 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-slate-700 hover:bg-amber-100"
              >
                <QrCode className="h-4 w-4" />
              </a>
            </div>
          )
        )}

        {/* Navigation Links */}
        <nav
          className={`flex-1 space-y-1 overflow-y-auto no-scrollbar ${
            isSidebarCollapsed ? 'p-2' : 'p-3'
          }`}
        >
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={label}
                aria-label={label}
                className={`relative flex items-center rounded-xl text-xs font-bold transition-all ${
                  isSidebarCollapsed
                    ? 'justify-center p-3'
                    : 'justify-between gap-2 px-3.5 py-2.5'
                } ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  {!isSidebarCollapsed && (
                    <span className="truncate">{label}</span>
                  )}
                </div>
                {item.isOrders && newOrdersCount > 0 && (
                  <span
                    className={
                      isSidebarCollapsed
                        ? 'absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-slate-950 ring-2 ring-white dark:ring-slate-900'
                        : `rounded-full px-2 py-0.5 text-[10px] font-black shrink-0 ${
                            active
                              ? 'bg-slate-950 text-amber-400'
                              : 'bg-amber-400 text-slate-950 animate-pulse'
                          }`
                    }
                  >
                    {isSidebarCollapsed
                      ? newOrdersCount
                      : tx('{count} mới', '{count} new', {
                          count: newOrdersCount,
                        })}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Sidebar Footer */}
        <div
          className={`border-t border-slate-200 dark:border-slate-800 space-y-2 ${
            isSidebarCollapsed ? 'p-2 flex flex-col items-center' : 'p-3'
          }`}
        >
          {(isSuperAdmin(profile) || Boolean(getAdminBackupSession())) && (
            <button
              type="button"
              onClick={() => {
                stopAdminImpersonation();
                router.push('/admin');
              }}
              title={
                getAdminBackupSession()
                  ? t('header.exitAdminView')
                  : t('nav.superAdmin')
              }
              aria-label={
                getAdminBackupSession()
                  ? t('header.exitAdminView')
                  : t('nav.superAdmin')
              }
              data-testid="sidebar-exit-impersonation"
              className={`flex items-center justify-center gap-1.5 rounded-xl bg-amber-400 text-xs font-black text-slate-950 hover:bg-amber-300 shadow-sm ${
                isSidebarCollapsed ? 'h-10 w-10' : 'w-full px-3 py-2.5'
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && (
                <span>
                  {getAdminBackupSession()
                    ? t('header.exitAdminView')
                    : t('nav.superAdmin')}
                </span>
              )}
            </button>
          )}

          {isOwner && (
          <Link
            href="/onboarding?intent=new_branch"
            title={t('header.addBranch')}
            aria-label={t('header.addBranch')}
            className={`flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 ${
              isSidebarCollapsed ? 'h-10 w-10' : 'px-3 py-2.5'
            }`}
          >
            <PlusCircle className="h-4 w-4 shrink-0" />
            {!isSidebarCollapsed && <span>{t('header.addBranch')}</span>}
          </Link>
          )}

          {!isSidebarCollapsed ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 px-3 py-2 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold text-slate-900 dark:text-white">
                    {profile?.full_name || tx('Chủ quán Qlaok', 'Store Owner')}
                  </p>
                  <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                    {authEmail || profile?.email || 'chuquan@qlaok.vn'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                aria-label={t('header.logout')}
                title={t('header.logout')}
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              aria-label={t('header.logout')}
              title={`${t('header.logout')} (${authEmail || profile?.email || ''})`}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-slate-500 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area (Dynamically expands when sidebar is collapsed) */}
      <div
        className={`flex-1 flex flex-col min-h-screen pb-20 md:pb-8 transition-all duration-200 min-w-0 ${
          isSidebarCollapsed ? 'md:pl-[72px]' : 'md:pl-64'
        }`}
      >
        {/* Top Header Bar — Responsive across 390px, 768px, 1280px */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-2.5 sm:px-4 py-2 flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            <Link
              href="/"
              aria-label="Qlaok"
              className="md:hidden flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              title="Qlaok"
            >
              <BrandLogo className="h-8 w-8 rounded-xl" alt="Qlaok" />
            </Link>

            <div className="flex flex-1 items-center gap-1.5 min-w-0">
              <Store className="h-3.5 w-3.5 text-emerald-600 shrink-0 hidden lg:inline" />
              <select
                value={activeShop?.id || ''}
                onChange={(e) => selectShop(e.target.value)}
                aria-label={tx('Chọn cửa hàng', 'Select store')}
                className="min-w-0 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 sm:px-2.5 py-1.5 text-xs font-extrabold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none max-w-[115px] sm:max-w-[180px] lg:max-w-[260px] truncate"
              >
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span
                className={`hidden xl:inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${planBadgeColor}`}
              >
                {profile?.plan || 'free'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {activeShop && browserPerm !== 'unsupported' && (
              <button
                type="button"
                onClick={handleEnableOrTestBrowserNotifications}
                aria-label={notifTooltip}
                title={notifTooltip}
                data-testid="header-notification-toggle"
                className={`hidden sm:inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition shrink-0 ${
                  browserPerm === 'granted'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                <Monitor className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="hidden xl:inline">{notifButtonLabel}</span>
              </button>
            )}

            {(isSuperAdmin(profile) || Boolean(getAdminBackupSession())) && (
              <button
                type="button"
                onClick={() => {
                  stopAdminImpersonation();
                  router.push('/admin');
                }}
                aria-label={t('header.exitAdminView')}
                title={t('header.exitAdminView')}
                data-testid="header-exit-impersonation"
                className="inline-flex items-center gap-1 rounded-xl border border-amber-400/60 bg-amber-400 px-2 sm:px-2.5 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300 shrink-0"
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden lg:inline">
                  {t('header.exitAdminView')}
                </span>
              </button>
            )}

            <AppLanguageSwitcher />
            <ThemeToggle />

            {activeShop && canPublish && (
              <button
                type="button"
                onClick={handleTogglePublish}
                disabled={publishBusy}
                data-testid="header-publish-toggle"
                aria-pressed={activeShop.is_published !== false}
                title={
                  publishError ||
                  (activeShop.is_published === false
                    ? tx(
                        'Cửa hàng đang ở chế độ nháp — khách chưa xem được menu. Bấm để công khai.',
                        'Store is a draft — guests cannot see the menu yet. Click to go live.'
                      )
                    : tx(
                        'Cửa hàng đang công khai. Bấm để chuyển về nháp.',
                        'Store is live. Click to switch back to draft.'
                      ))
                }
                className={`inline-flex items-center gap-1 rounded-xl border px-2 sm:px-2.5 py-1.5 text-xs font-black shrink-0 disabled:opacity-60 ${
                  publishError
                    ? 'border-rose-400 bg-rose-50 text-rose-700'
                    : activeShop.is_published === false
                      ? 'border-amber-400 bg-amber-400 text-slate-950 hover:bg-amber-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                {activeShop.is_published === false ? (
                  <EyeOff className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {activeShop.is_published === false
                    ? tx('Nháp • Công khai', 'Draft • Go live')
                    : tx('Đang công khai', 'Live')}
                </span>
              </button>
            )}

            {activeShop && (
              <>
                {canViewOrders && (
                <Link
                  href="/dashboard/orders"
                  title={t('nav.orders')}
                  className={`relative inline-flex items-center gap-1 rounded-xl px-2 sm:px-2.5 py-1.5 text-xs font-bold border shrink-0 ${
                    newOrdersCount > 0
                      ? 'border-amber-400 bg-amber-400 text-slate-950 animate-pulse'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <BellRing className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden lg:inline">
                    {t('header.posButton')}
                  </span>
                  {newOrdersCount > 0 && (
                    <span className="rounded-full bg-slate-950 px-1.5 py-0.2 text-[10px] font-black text-amber-400">
                      {newOrdersCount}
                    </span>
                  )}
                </Link>
                )}
                <a
                  href={`/s/${activeShop.slug}/menu?src=table`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('header.viewMenu')}
                  aria-label={t('header.viewMenu')}
                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden xl:inline">
                    {t('header.viewMenu')}
                  </span>
                </a>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 w-full p-3 sm:p-5">
          <PwaInstallBanner />
          {routeAllowed ? (
            children
          ) : (
            <div
              role="status"
              data-testid="dashboard-route-forbidden"
              className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-2"
            >
              <ShieldCheck className="mx-auto h-8 w-8 text-amber-500" />
              <p className="text-sm font-black text-slate-900 dark:text-white">
                {tx(
                  'Tài khoản của bạn không có quyền mở trang này.',
                  'Your account does not have access to this page.'
                )}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {getFallbackDashboardHref(activeMembership)
                  ? tx('Đang chuyển hướng...', 'Redirecting...')
                  : tx(
                      'Vui lòng liên hệ chủ cửa hàng để được cấp quyền.',
                      'Please ask the store owner to grant access.'
                    )}
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar shadow-lg">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
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
              <span className="whitespace-nowrap">{label}</span>
              {item.isOrders && newOrdersCount > 0 && (
                <span className="absolute -top-0.5 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-black text-slate-950">
                  {newOrdersCount}
                </span>
              )}
            </Link>
          );
        })}
        {(isSuperAdmin(profile) || Boolean(getAdminBackupSession())) && (
          <button
            type="button"
            onClick={() => {
              stopAdminImpersonation();
              router.push('/admin');
            }}
            aria-label={t('header.exitAdminView')}
            title={t('header.exitAdminView')}
            data-testid="mobile-exit-impersonation"
            className="shrink-0 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-amber-400 px-2.5 py-1.5 text-[10px] font-black text-slate-950 hover:bg-amber-300"
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="whitespace-nowrap">{t('header.exitAdminView')}</span>
          </button>
        )}
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
