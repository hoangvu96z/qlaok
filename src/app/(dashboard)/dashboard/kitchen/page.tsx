'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChefHat,
  Clock,
  LogIn,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import {
  buildKitchenFulfillPatchPayload,
  buildKitchenOrdersUrl,
  canPerformKitchenFulfill,
  createInitialKitchenOrdersState,
  createKitchenShopScopeTracker,
  DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES,
  type KitchenOrdersState,
  type KitchenShopScopeToken,
  type KitchenShopScopeTracker,
  type KitchenStatusFilter,
  reconcileKitchenOrdersFetch,
  selectAndSortKitchenOrders,
  shouldShowKitchenConfirmedEmptyState,
  summarizeKitchenQueue,
} from '@/lib/kitchen-display';
import { startOrderLiveSync, type OrderLiveStatus } from '@/lib/order-live-sync';
import { KitchenTicketCard } from '@/components/dashboard/KitchenTicketCard';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import type { ShopMembership, ShopOrder } from '@/types/qlaok';

export default function KitchenDisplayPage() {
  const { activeShop, activeMembership } = useDashboard();
  const { locale, t, tx } = useAppI18n();
  const translateRef = useRef(tx);
  translateRef.current = tx;

  const [liveStatus, setLiveStatus] = useState<OrderLiveStatus>('connecting');
  const [ordersState, setOrdersState] = useState<KitchenOrdersState>(() =>
    createInitialKitchenOrdersState(activeShop?.id ?? null)
  );
  const [membership, setMembership] = useState<ShopMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<KitchenStatusFilter>('all');
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [actionToast, setActionToast] = useState<{
    kind: 'error' | 'success';
    message: string;
  } | null>(null);

  const scopeTrackerRef = useRef<KitchenShopScopeTracker | null>(null);
  if (!scopeTrackerRef.current) {
    scopeTrackerRef.current = createKitchenShopScopeTracker(activeShop?.id);
  }
  scopeTrackerRef.current.setActiveShop(activeShop?.id);

  const inFlightRef = useRef<{
    scope: KitchenShopScopeToken;
    shopId: string;
    again: boolean;
  } | null>(null);
  const updatingRef = useRef<{ shopId: string; orderId: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tracker = createKitchenShopScopeTracker(activeShop?.id);
    scopeTrackerRef.current = tracker;
    return () => {
      tracker.dispose();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // Only manage mount/unmount lifecycle here; activeShop updates via setActiveShop above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showActionToast = useCallback(
    (kind: 'error' | 'success', message: string) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setActionToast({ kind, message });
      toastTimerRef.current = setTimeout(
        () => setActionToast(null),
        kind === 'error' ? 7000 : 3000
      );
    },
    []
  );

  // Tick local clock every 15s while tab is visible so ticket ages and 15m overdue highlights stay current without polling the server
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        typeof document === 'undefined' ||
        document.visibilityState !== 'hidden'
      ) {
        setNowMs(Date.now());
      }
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const fetchKitchenOrders = useCallback(
    async function refresh(
      silent = false,
      requestedShopId?: string | null
    ): Promise<void> {
      const targetShopId = (requestedShopId ?? activeShop?.id ?? '').trim();
      const tracker = scopeTrackerRef.current;
      const scopeToken = tracker?.canStartForShop(targetShopId) ?? null;
      if (!tracker || !scopeToken || !targetShopId) return;

      if (
        inFlightRef.current?.scope === scopeToken &&
        inFlightRef.current.shopId === targetShopId
      ) {
        inFlightRef.current.again = true;
        return;
      }

      const request = {
        scope: scopeToken,
        shopId: targetShopId,
        again: false,
      };
      inFlightRef.current = request;

      if (!silent) {
        setLoading(true);
      }

      const fallbackFetchError = translateRef.current(
        'Không thể tải danh sách phiếu bếp. Vui lòng thử lại.',
        'Could not load kitchen tickets. Please try again.'
      );

      const isRequestStillCurrent = () =>
        Boolean(
          scopeTrackerRef.current &&
            scopeTrackerRef.current.isCurrent(scopeToken, targetShopId)
        );

      try {
        const res = await fetch(buildKitchenOrdersUrl(targetShopId), {
          cache: 'no-store',
          headers: getAuthHeaders(),
        });

        if (!isRequestStillCurrent()) return;

        if (res.ok) {
          const data = await res.json();
          if (!isRequestStillCurrent()) return;
          const fetchedOrders: ShopOrder[] = Array.isArray(data.orders)
            ? data.orders
            : [];
          if (data.membership && isRequestStillCurrent()) {
            const incomingMembership = data.membership as ShopMembership;
            if (
              !incomingMembership.shop_id ||
              incomingMembership.shop_id === targetShopId
            ) {
              setMembership(incomingMembership);
            }
          }
          setNowMs(Date.now());
          setOrdersState((prev) =>
            reconcileKitchenOrdersFetch(prev, {
              shopId: targetShopId,
              activeShopId:
                scopeTrackerRef.current?.getCurrentScope().shopId ?? null,
              ok: true,
              orders: fetchedOrders,
            })
          );
        } else {
          const errData = await res.json().catch(() => null);
          if (!isRequestStillCurrent()) return;
          const errMessage =
            res.status === 401
              ? translateRef.current(
                  'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
                  'Your session has expired. Please sign in again.'
                )
              : (errData as { error?: string } | null)?.error ||
                `${fallbackFetchError} (HTTP ${res.status})`;
          setOrdersState((prev) =>
            reconcileKitchenOrdersFetch(prev, {
              shopId: targetShopId,
              activeShopId:
                scopeTrackerRef.current?.getCurrentScope().shopId ?? null,
              ok: false,
              status: res.status,
              error: errMessage,
            })
          );
        }
      } catch (err) {
        if (!isRequestStillCurrent()) return;
        const errMessage =
          err instanceof Error && err.message
            ? err.message
            : fallbackFetchError;
        setOrdersState((prev) =>
          reconcileKitchenOrdersFetch(prev, {
            shopId: targetShopId,
            activeShopId:
              scopeTrackerRef.current?.getCurrentScope().shopId ?? null,
            ok: false,
            error: errMessage,
          })
        );
      } finally {
        if (inFlightRef.current === request) {
          inFlightRef.current = null;
        }
        if (isRequestStillCurrent()) {
          setLoading(false);
          if (request.again) {
            queueMicrotask(() => {
              if (isRequestStillCurrent()) {
                void refresh(true, targetShopId);
              }
            });
          }
        }
      }
    },
    [activeShop?.id]
  );

  // Reset shop-scoped state and start authenticated SSE sync when activeShop.id changes
  useEffect(() => {
    const shopId = (activeShop?.id ?? '').trim() || null;
    const effectScope =
      scopeTrackerRef.current?.setActiveShop(shopId) ?? null;
    setMembership(null);
    setUpdatingOrderId(null);
    updatingRef.current = null;
    setOrdersState((prev) =>
      prev.shopId === shopId ? prev : createInitialKitchenOrdersState(shopId)
    );

    if (!shopId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchKitchenOrders(false, shopId);

    const isEffectScopeCurrent = () =>
      Boolean(
        scopeTrackerRef.current &&
          scopeTrackerRef.current.isCurrent(effectScope, shopId)
      );

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        if (
          ev.data?.shopId === shopId &&
          isEffectScopeCurrent() &&
          document.visibilityState !== 'hidden'
        ) {
          void fetchKitchenOrders(true, shopId);
        }
      };
    }

    const stopSync = startOrderLiveSync({
      query: new URLSearchParams({ shopId }).toString(),
      headers: getAuthHeaders,
      onChange: () => {
        if (isEffectScopeCurrent()) {
          void fetchKitchenOrders(true, shopId);
        }
      },
      onStatus: (nextStatus) => {
        if (isEffectScopeCurrent()) {
          setLiveStatus(nextStatus);
        }
      },
    });

    return () => {
      if (bc) bc.close();
      stopSync();
    };
  }, [activeShop?.id, fetchKitchenOrders]);

  const effectiveMembership =
    (membership && (!membership.shop_id || membership.shop_id === activeShop?.id)
      ? membership
      : null) ??
    (activeMembership &&
    (!activeMembership.shop_id || activeMembership.shop_id === activeShop?.id)
      ? activeMembership
      : null);
  const canFulfill = canPerformKitchenFulfill(effectiveMembership);

  const handleAdvanceStatus = async (
    order: ShopOrder,
    nextStatus: 'preparing' | 'completed'
  ) => {
    const operationShopId = (activeShop?.id ?? '').trim();
    const patchScopeToken =
      scopeTrackerRef.current?.canStartForShop(operationShopId) ?? null;
    if (!operationShopId || !patchScopeToken || !canFulfill) return;
    if (order.shop_id && order.shop_id !== operationShopId) return;
    if (
      updatingRef.current &&
      updatingRef.current.shopId === operationShopId &&
      updatingRef.current.orderId === order.id
    ) {
      return;
    }

    const payload = buildKitchenFulfillPatchPayload({
      shopId: operationShopId,
      orderId: order.id,
      currentStatus: order.status,
    });
    if (!payload || payload.status !== nextStatus) return;

    const isPatchStillCurrent = () =>
      Boolean(
        scopeTrackerRef.current &&
          scopeTrackerRef.current.isCurrent(patchScopeToken, operationShopId)
      );

    updatingRef.current = { shopId: operationShopId, orderId: order.id };
    setUpdatingOrderId(order.id);
    const fallbackError = tx(
      'Không thể cập nhật trạng thái món.',
      'Could not update kitchen ticket status.'
    );

    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (!isPatchStillCurrent()) return;
        await fetchKitchenOrders(true, operationShopId);
        if (
          isPatchStillCurrent() &&
          typeof window !== 'undefined' &&
          'BroadcastChannel' in window
        ) {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({ type: 'order_updated', shopId: operationShopId });
          bc.close();
        }
        return;
      }

      if (!isPatchStillCurrent()) return;

      if (res.status === 401) {
        setOrdersState((prev) =>
          prev.shopId === operationShopId
            ? { ...prev, sessionExpired: true }
            : prev
        );
      }
      const errData = await res.json().catch(() => null);
      if (!isPatchStillCurrent()) return;
      showActionToast(
        'error',
        res.status === 401
          ? tx(
              'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
              'Your session has expired. Please sign in again.'
            )
          : (errData as { error?: string } | null)?.error || fallbackError
      );
      if (res.status === 409 && isPatchStillCurrent()) {
        void fetchKitchenOrders(true, operationShopId);
      }
    } catch (err) {
      if (!isPatchStillCurrent()) return;
      showActionToast(
        'error',
        err instanceof Error && err.message ? err.message : fallbackError
      );
    } finally {
      if (
        updatingRef.current?.shopId === operationShopId &&
        updatingRef.current?.orderId === order.id
      ) {
        updatingRef.current = null;
      }
      if (isPatchStillCurrent()) {
        setUpdatingOrderId((prev) => (prev === order.id ? null : prev));
      }
    }
  };

  if (!activeShop) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center space-y-3 shadow-2xs">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
          {tx('Đang tải dữ liệu cửa hàng...', 'Loading store data...')}
        </p>
      </div>
    );
  }

  const queueSummary = summarizeKitchenQueue(ordersState.orders, {
    shopId: activeShop.id,
    nowMs,
    overdueThresholdMinutes: DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES,
  });

  const visibleTickets = selectAndSortKitchenOrders(ordersState.orders, {
    shopId: activeShop.id,
    statusFilter,
  });

  const showConfirmedEmptyState = shouldShowKitchenConfirmedEmptyState({
    state: ordersState,
    activeShopId: activeShop.id,
    visibleTicketsCount: visibleTickets.length,
    loading,
  });

  const showSessionExpired =
    ordersState.sessionExpired || liveStatus === 'unauthorized';

  const syncLabel =
    liveStatus === 'connected'
      ? t('orders.syncLive')
      : liveStatus === 'unauthorized'
        ? tx('Cần đăng nhập lại', 'Sign in again')
        : t('orders.syncPolling');

  return (
    <div className="space-y-4" data-testid="kds-page">
      {/* Session Expired Alert Banner */}
      {showSessionExpired && (
        <div
          role="alert"
          data-testid="kds-session-expired-banner"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-rose-400 bg-rose-50 dark:bg-rose-950/60 dark:border-rose-500/60 px-4 py-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5 text-sm font-black text-rose-800 dark:text-rose-200">
            <XCircle
              className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            <span>
              {tx(
                'Phiên đăng nhập hết hạn — phiếu bếp mới sẽ không tự cập nhật.',
                'Session expired — new kitchen tickets will not update automatically.'
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchKitchenOrders(false, activeShop.id)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-black text-rose-800 dark:text-rose-200 hover:bg-rose-100"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{tx('Thử lại', 'Retry')}</span>
            </button>
            <Link
              href="/login?next=/dashboard/kitchen"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-500"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>{tx('Đăng nhập lại', 'Sign in again')}</span>
            </Link>
          </div>
        </div>
      )}

      {/* Fetch / Connection Error Banner (Preserves existing tickets when loaded; never claims queue is empty on initial failure) */}
      {ordersState.fetchError && !showSessionExpired && (
        <div
          role="alert"
          data-testid="kds-fetch-error-banner"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/60 dark:border-amber-500/60 px-4 py-3 shadow-xs"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-amber-950 dark:text-amber-100">
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <span>
                {ordersState.hasLoaded
                  ? tx(
                      'Lỗi kết nối khi đồng bộ phiếu bếp — đang giữ nguyên các phiếu hiện có trên màn hình.',
                      'Connection error while syncing kitchen tickets — keeping existing tickets on screen.'
                    )
                  : tx(
                      'Không thể tải danh sách phiếu bếp ban đầu — vui lòng kiểm tra kết nối và thử lại.',
                      'Could not load initial kitchen tickets — please check your connection and retry.'
                    )}
              </span>
            </div>
            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 break-all">
              {ordersState.fetchError}
            </p>
          </div>
          <button
            type="button"
            data-testid="kds-retry-button"
            disabled={loading}
            onClick={() => void fetchKitchenOrders(false, activeShop.id)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60 shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{tx('Thử tải lại', 'Retry now')}</span>
          </button>
        </div>
      )}

      {/* Action Error Toast */}
      {actionToast && (
        <div
          role={actionToast.kind === 'error' ? 'alert' : 'status'}
          data-testid="kds-action-toast"
          className={`fixed bottom-20 md:bottom-6 right-4 z-[60] flex max-w-sm items-start gap-2 rounded-2xl border px-4 py-3 text-xs font-bold shadow-xl ${
            actionToast.kind === 'error'
              ? 'border-rose-300 bg-rose-600 text-white'
              : 'border-slate-700 bg-slate-900 text-white'
          }`}
        >
          <span className="flex-1">{actionToast.message}</span>
          <button
            type="button"
            onClick={() => setActionToast(null)}
            aria-label={t('common.close')}
            className="-m-1 rounded-full p-1 hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KDS Top Header Card (Respects Light Default & Dark Mode) */}
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-2xs shrink-0">
                <ChefHat className="h-4 w-4" aria-hidden="true" />
              </span>
              <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                {tx('Màn hình bếp (KDS)', 'Kitchen Display (KDS)')}
              </h1>
              <span
                title={activeShop.name}
                data-testid="kds-shop-name-badge"
                className="inline-block max-w-[200px] sm:max-w-[280px] truncate rounded-xl border border-emerald-200 dark:border-slate-700 bg-emerald-50 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-400"
              >
                {activeShop.name}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {tx(
                'Ưu tiên đơn chờ lâu nhất lên đầu • Cảnh báo quá hạn từ {minutes} phút (≥ {minutes}p) • Hoàn tất món không tự động tính là đã thu tiền.',
                'Oldest active orders first • Overdue alert at {minutes}+ minutes (≥ {minutes}m) • Completing prep never marks an order as paid.',
                { minutes: DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES }
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              role="status"
              aria-label={syncLabel}
              title={syncLabel}
              data-testid="kds-live-status"
              data-status={liveStatus}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              <span
                aria-hidden="true"
                className={
                  liveStatus === 'connected'
                    ? 'text-emerald-500'
                    : liveStatus === 'unauthorized'
                      ? 'text-rose-500'
                      : 'text-amber-500'
                }
              >
                ●
              </span>
              <span>{syncLabel}</span>
            </div>

            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-black text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{tx('Quầy & Lịch sử đơn', 'POS & Order History')}</span>
            </Link>

            <button
              type="button"
              data-testid="kds-refresh-button"
              onClick={() => void fetchKitchenOrders(false, activeShop.id)}
              className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-black text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{t('common.refresh')}</span>
            </button>
          </div>
        </div>

        {/* Read-only membership notice when user lacks orders.fulfill */}
        {effectiveMembership && !canFulfill && (
          <div
            role="status"
            data-testid="kds-permission-readonly-banner"
            className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300"
          >
            <ShieldAlert
              className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <span>
              {tx(
                'Tài khoản đang ở chế độ chỉ xem bếp — cần quyền phục vụ (orders.fulfill) để bấm Bắt đầu làm hoặc Hoàn tất món.',
                'Your account is in view-only mode — orders.fulfill permission is required to start cooking or complete tickets.'
              )}
            </span>
          </div>
        )}

        {/* Queue KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                {tx('Đang chờ bếp', 'Active tickets')}
              </span>
              <ChefHat className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            </div>
            <p
              data-testid="kds-kpi-active"
              className="mt-1 text-xl sm:text-2xl font-black text-slate-900 dark:text-white"
            >
              {queueSummary.totalActive}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                {tx('Mới chờ làm', 'Waiting (New)')}
              </span>
              <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <p
              data-testid="kds-kpi-new"
              className="mt-1 text-xl sm:text-2xl font-black text-amber-900 dark:text-amber-200"
            >
              {queueSummary.newCount}
            </p>
          </div>

          <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-950/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                {tx('Đang chế biến', 'Preparing')}
              </span>
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <p
              data-testid="kds-kpi-preparing"
              className="mt-1 text-xl sm:text-2xl font-black text-blue-900 dark:text-blue-200"
            >
              {queueSummary.preparingCount}
            </p>
          </div>

          <div
            className={`rounded-2xl border p-3 ${
              queueSummary.overdueCount > 0
                ? 'border-rose-300 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-950/40'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-xs font-bold ${
                  queueSummary.overdueCount > 0
                    ? 'text-rose-900 dark:text-rose-200'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tx(
                  'Quá hạn (≥ {minutes}p)',
                  'Overdue (≥ {minutes}m)',
                  { minutes: DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES }
                )}
              </span>
              <AlertTriangle
                className={`h-4 w-4 ${
                  queueSummary.overdueCount > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-400'
                }`}
              />
            </div>
            <p
              data-testid="kds-kpi-overdue"
              className={`mt-1 text-xl sm:text-2xl font-black ${
                queueSummary.overdueCount > 0
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {queueSummary.overdueCount}
            </p>
          </div>
        </div>

        {/* Touch-friendly Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
          {[
            {
              id: 'all' as const,
              label: tx(
                'Tất cả đang làm ({count})',
                'All active ({count})',
                { count: queueSummary.totalActive }
              ),
            },
            {
              id: 'new' as const,
              label: tx('Mới chờ làm ({count})', 'New ({count})', {
                count: queueSummary.newCount,
              }),
            },
            {
              id: 'preparing' as const,
              label: tx('Đang chế biến ({count})', 'Preparing ({count})', {
                count: queueSummary.preparingCount,
              }),
            },
          ].map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`kds-filter-${tab.id}`}
                onClick={() => setStatusFilter(tab.id)}
                className={`min-h-[42px] shrink-0 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition-all ${
                  active
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tickets Grid */}
      {visibleTickets.length > 0 ? (
        <div
          data-testid="kds-tickets-grid"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {visibleTickets.map((order) => (
            <KitchenTicketCard
              key={order.id}
              order={order}
              locale={locale}
              nowMs={nowMs}
              canFulfill={canFulfill}
              isUpdating={updatingOrderId === order.id}
              overdueThresholdMinutes={DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES}
              onAdvanceStatus={handleAdvanceStatus}
            />
          ))}
        </div>
      ) : loading ? (
        <div
          role="status"
          data-testid="kds-loading-state"
          className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3 shadow-2xs"
        >
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {tx(
              'Đang tải danh sách phiếu bếp...',
              'Loading kitchen tickets...'
            )}
          </p>
        </div>
      ) : showConfirmedEmptyState ? (
        <div
          data-testid="kds-empty-state"
          className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3 shadow-2xs"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {tx(
              'Bếp đã xử lý hết các đơn đang chờ!',
              'All active kitchen tickets are cleared!'
            )}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {tx(
              'Đơn mới từ QR bàn hoặc quầy POS sẽ tự động hiện ngay tại đây theo thứ tự đơn chờ lâu nhất.',
              'New orders from table QR or counter POS will appear here automatically, oldest first.'
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
