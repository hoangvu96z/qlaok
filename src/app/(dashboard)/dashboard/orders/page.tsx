'use client';

import { appLanguageName } from '@/lib/app-i18n';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  BellRing,
  CheckCircle2,
  ChefHat,
  Clock,
  Plus,
  QrCode,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Banknote,
  ShoppingBag,
  Printer,
  Settings,
  Monitor,
  Edit3,
  Loader2,
  LogIn,
} from 'lucide-react';
import { startOrderLiveSync, type OrderLiveStatus } from '@/lib/order-live-sync';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import {
  CatalogItem,
  Category,
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  ServiceRequestStatus,
  ShopMembership,
  ShopOrder,
  TableServiceRequest,
} from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { formatChimeSummaryLabel } from '@/lib/app-i18n';
import { ReceiptPrintModal } from '@/components/dashboard/ReceiptPrintModal';
import { PosCounterWorkspace } from '@/components/dashboard/PosCounterWorkspace';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import {
  CHIME_SETTINGS_EVENT,
  CHIME_SOUND_OPTIONS,
  ChimeSoundId,
  ChimeVolumePreset,
  DEFAULT_CHIME_SETTINGS,
  ensureAudioContextUnlocked,
  getBrowserNotificationPermission,
  loadOrderChimeSettings,
  OrderChimeSettings,
  playOrderAlertChime,
  requestBrowserNotificationPermission,
  saveOrderChimeSettings,
  sendBrowserOrderNotification,
  sendBrowserServiceRequestNotification,
} from '@/lib/order-chime';

const EN_CHIME_SOUND_TEXT: Record<
  ChimeSoundId,
  { label: string; desc: string; badge?: string }
> = {
  kitchen_gong: {
    label: '🛎️ 3-Strike Kitchen Gong (Recommended)',
    desc: 'Clear 3-strike metallic bell that cuts through kitchen noise',
    badge: 'Clear & Loud',
  },
  siren_urgent: {
    label: '🚨 High-Alert Order Siren (Max Loudness)',
    desc: 'High-penetration dual-tone alert for busy counters and kitchens',
    badge: 'Loudest',
  },
  voice_vi: {
    label: '🗣️ Bell + Vietnamese Voice Prompt',
    desc: 'Plays attention bell followed by a spoken Vietnamese order alert',
    badge: 'Voice',
  },
  melody_upbeat: {
    label: '🎵 Upbeat Counter Chime',
    desc: 'Friendly 4-note melody ideal for cafes, bakeries, and tea shops',
  },
  bell_classic: {
    label: '🔔 Soft Ding-Dong Bell',
    desc: 'Gentle two-tone chime suited for spas, salons, or quiet venues',
  },
};

function getVnDateKey(dateInput: Date | string | number = new Date()): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function CounterOrdersPage() {
  const { activeShop } = useDashboard();
  const { locale, t, tx } = useAppI18n();
  const translateRef = useRef(tx);
  translateRef.current = tx;
  const [liveStatus, setLiveStatus] = useState<OrderLiveStatus>('connecting');
  const scopeRef = useRef({ shopId: activeShop?.id });
  if (scopeRef.current.shopId !== activeShop?.id) scopeRef.current = { shopId: activeShop?.id };
  const inFlight = useRef<{ scope: object; again: boolean; catalog: boolean } | null>(null);
  const disposedRef = useRef(false);
  useEffect(() => { disposedRef.current = false; return () => { disposedRef.current = true; }; }, []);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [serviceRequests, setServiceRequests] = useState<TableServiceRequest[]>([]);
  const [updatingServiceReqId, setUpdatingServiceReqId] = useState<string | null>(null);
  const [membership, setMembership] = useState<ShopMembership | null>(null);
  const [catalogCategories, setCatalogCategories] = useState<Category[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceMode, setWorkspaceMode] = useState<
    'kitchen_orders' | 'pos_terminal'
  >('kitchen_orders');
  const [filterTab, setFilterTab] = useState<
    'today' | 'active' | 'new' | 'preparing' | 'completed' | 'cancelled' | 'all'
  >('today');
  const [chimeSettings, setChimeSettings] = useState<OrderChimeSettings>(
    DEFAULT_CHIME_SETTINGS
  );
  const [browserNotifPerm, setBrowserNotifPerm] = useState<
    NotificationPermission | 'unsupported'
  >('default');
  const [isChimeModalOpen, setIsChimeModalOpen] = useState(false);
  const [autoPrintOnPay, setAutoPrintOnPay] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [qrOrderModal, setQrOrderModal] = useState<ShopOrder | null>(null);
  const [printingOrder, setPrintingOrder] = useState<ShopOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<ShopOrder | null>(null);
  const [updatingAction, setUpdatingAction] = useState<string | null>(null);
  const updatingRef = useRef<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [actionToast, setActionToast] = useState<{
    kind: 'error' | 'success';
    message: string;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const knownServiceRequestIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const chimeSettingsRef = useRef<OrderChimeSettings>(DEFAULT_CHIME_SETTINGS);

  useEffect(() => {
    const syncFromStorage = () => {
      const loaded = loadOrderChimeSettings();
      setChimeSettings(loaded);
      chimeSettingsRef.current = loaded;
      setBrowserNotifPerm(getBrowserNotificationPermission());
    };
    syncFromStorage();

    if (typeof window !== 'undefined') {
      try {
        const savedMode = sessionStorage.getItem('qlaok_pos_workspace_mode');
        if (savedMode === 'pos_terminal' || savedMode === 'kitchen_orders') {
          setWorkspaceMode(savedMode);
        }
      } catch {
        // ignore storage errors
      }

      const unlockHandler = () => {
        ensureAudioContextUnlocked();
      };
      window.addEventListener('pointerdown', unlockHandler, { passive: true });
      window.addEventListener('keydown', unlockHandler, { passive: true });
      window.addEventListener(CHIME_SETTINGS_EVENT, syncFromStorage);
      window.addEventListener('focus', syncFromStorage);

      return () => {
        window.removeEventListener('pointerdown', unlockHandler);
        window.removeEventListener('keydown', unlockHandler);
        window.removeEventListener(CHIME_SETTINGS_EVENT, syncFromStorage);
        window.removeEventListener('focus', syncFromStorage);
      };
    }
  }, []);

  const switchWorkspaceMode = (mode: 'kitchen_orders' | 'pos_terminal') => {
    setWorkspaceMode(mode);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('qlaok_pos_workspace_mode', mode);
      } catch {
        // ignore storage errors
      }
    }
  };

  const handleOpenEditOrderInPos = (order: ShopOrder) => {
    setEditingOrder(order);
    switchWorkspaceMode('pos_terminal');
  };

  const updateChimeSettings = (patch: Partial<OrderChimeSettings>) => {
    setChimeSettings((prev) => {
      const next = { ...prev, ...patch };
      chimeSettingsRef.current = next;
      saveOrderChimeSettings(next);
      return next;
    });
  };

  const fetchOrdersAndCatalog = useCallback(
    async function refresh(silent = false): Promise<void> {
      if (!activeShop || disposedRef.current) return;
      if (inFlight.current?.scope === scopeRef.current) {
        inFlight.current.again = true;
        inFlight.current.catalog ||= !silent;
        return;
      }
      const scope = scopeRef.current;
      const request = { scope, again: false, catalog: false };
      inFlight.current = request;
      if (!silent) setLoading(true);
      try {
        const [ordersRes, catRes] = await Promise.all([
          fetch(`/api/orders?shopId=${encodeURIComponent(activeShop.id)}`, {
            cache: 'no-store', headers: getAuthHeaders(),
          }),
          silent ? Promise.resolve(null) : fetch(`/api/catalog?shopId=${encodeURIComponent(activeShop.id)}`, {
            cache: 'no-store', headers: getAuthHeaders(),
          }),
        ]);

        if (disposedRef.current || scopeRef.current !== scope) return;
        if (ordersRes.status === 401) {
          setSessionExpired(true);
        } else if (ordersRes.ok) {
          setSessionExpired(false);
        }
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          if (disposedRef.current || scopeRef.current !== scope) return;
          const fetchedOrders: ShopOrder[] = data.orders || [];
          const fetchedServiceRequests: TableServiceRequest[] = Array.isArray(
            data.serviceRequests
          )
            ? data.serviceRequests
            : [];
          if (Array.isArray(data.items)) setCatalogItems(data.items);
          if (data.membership) {
            setMembership(data.membership as ShopMembership);
          }

          if (!isFirstLoadRef.current) {
            const brandNewOrder = fetchedOrders.find(
              (o) =>
                o.status === 'new' && !knownOrderIdsRef.current.has(o.id)
            );
            const brandNewServiceReq = fetchedServiceRequests.find(
              (r) =>
                r.status === 'pending' &&
                !knownServiceRequestIdsRef.current.has(r.id)
            );
            if (brandNewOrder) {
              const latestChime = loadOrderChimeSettings();
              chimeSettingsRef.current = latestChime;
              if (latestChime.enabled) {
                playOrderAlertChime(
                  latestChime,
                  brandNewOrder.table_label,
                  brandNewOrder.order_code
                );
              }
              const itemsSummary = Array.isArray(brandNewOrder.items)
                ? brandNewOrder.items
                    .slice(0, 3)
                    .map(
                      (it) =>
                        `${it.quantity}x ${it.name_vi || translateRef.current('Món', 'Item')}`
                    )
                    .join(', ')
                : undefined;
              sendBrowserOrderNotification({
                orderCode: brandNewOrder.order_code || translateRef.current('MỚI', 'NEW'),
                tableLabel: brandNewOrder.table_label || translateRef.current('Tại quầy', 'Counter'),
                totalFormatted: formatCurrency(
                  Number(brandNewOrder.total_amount) || 0,
                  activeShop.currency
                ),
                itemsSummary,
                shopName: activeShop.name,
              });
            } else if (brandNewServiceReq) {
              const latestChime = loadOrderChimeSettings();
              chimeSettingsRef.current = latestChime;
              if (latestChime.enabled) {
                playOrderAlertChime(
                  latestChime,
                  brandNewServiceReq.table_label
                );
              }
              sendBrowserServiceRequestNotification({
                requestId: brandNewServiceReq.id,
                tableLabel: brandNewServiceReq.table_label,
                requestType: brandNewServiceReq.request_type,
                shopName: activeShop.name,
              });
            }
          }

          knownOrderIdsRef.current = new Set(fetchedOrders.map((o) => o.id));
          knownServiceRequestIdsRef.current = new Set(
            fetchedServiceRequests.map((r) => r.id)
          );
          isFirstLoadRef.current = false;
          setOrders(fetchedOrders);
          setServiceRequests(fetchedServiceRequests);
        }

        if (catRes?.ok) {
          const catData = await catRes.json();
          if (disposedRef.current || scopeRef.current !== scope) return;
          setCatalogCategories(catData.categories || []);
          setCatalogItems(catData.items || []);
        }
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        if (inFlight.current === request) inFlight.current = null;
        if (!disposedRef.current && scopeRef.current === scope && request.again) queueMicrotask(() => { void refresh(!request.catalog); });
        if (!silent && !disposedRef.current && scopeRef.current === scope) setLoading(false);
      }
    },
    [activeShop]
  );

  useEffect(() => {
    isFirstLoadRef.current = true;
    knownOrderIdsRef.current = new Set();
    knownServiceRequestIdsRef.current = new Set();
    setOrders([]);
    setServiceRequests([]);
    setCatalogItems([]);
    setCatalogCategories([]);
    setMembership(null);
    if (!activeShop?.id) return;
    void fetchOrdersAndCatalog(false);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        const msgType = ev.data?.type;
        // Guest modal (ShowToStaffModal) broadcasts 'order_created' / 'order_updated' with
        // the saved order; legacy flows send 'new_order_submitted' with flat fields.
        // Only brand-new orders chime; updates just trigger a silent refresh below.
        const isNewOrderMessage =
          msgType === 'new_order_submitted' || msgType === 'order_created';
        if (isNewOrderMessage && ev.data?.shopId === activeShop?.id) {
          const msgOrder: Partial<ShopOrder> | undefined =
            ev.data?.order && typeof ev.data.order === 'object'
              ? ev.data.order
              : undefined;
          const orderCode: string | undefined =
            ev.data?.orderCode || msgOrder?.order_code;
          const tableLabel: string | undefined =
            ev.data?.tableLabel || msgOrder?.table_label;
          const totalAmount =
            Number(
              ev.data?.totalAmount ?? ev.data?.totalVnd ?? msgOrder?.total_amount
            ) || 0;
          // Mark as known so the follow-up refresh does not chime a second time.
          if (msgOrder?.id) knownOrderIdsRef.current.add(msgOrder.id);
          const latestChime = loadOrderChimeSettings();
          chimeSettingsRef.current = latestChime;
          if (latestChime.enabled) {
            playOrderAlertChime(
              latestChime,
              tableLabel || translateRef.current('Khách mới', 'New guest'),
              orderCode
            );
          }
          if (orderCode) {
            sendBrowserOrderNotification({
              orderCode,
              tableLabel: tableLabel || translateRef.current('Tại quầy', 'Counter'),
              totalFormatted: formatCurrency(
                totalAmount,
                activeShop?.currency || 'VND'
              ),
              shopName: activeShop?.name,
            });
          }
        }
        if (ev.data?.shopId === activeShop.id && document.visibilityState !== 'hidden') void fetchOrdersAndCatalog(true);
      };
    }

    const stopSync = startOrderLiveSync({
      query: new URLSearchParams({ shopId: activeShop.id }).toString(),
      headers: getAuthHeaders,
      onChange: () => { void fetchOrdersAndCatalog(true); },
      onStatus: setLiveStatus,
    });

    return () => {
      if (bc) bc.close();
      stopSync();
    };
  }, [fetchOrdersAndCatalog, activeShop?.id, activeShop?.name, activeShop?.currency]);

  // Repeating reminder chime every 10 seconds if there are unaccepted 'new' orders or pending service requests and remindUntilAccepted is enabled
  useEffect(() => {
    const pendingNewOrders = orders.filter((o) => o.status === 'new');
    const pendingServiceReqs = serviceRequests.filter(
      (r) => r.status === 'pending'
    );
    if (
      !chimeSettings.enabled ||
      !chimeSettings.remindUntilAccepted ||
      (pendingNewOrders.length === 0 && pendingServiceReqs.length === 0)
    ) {
      return;
    }

    const reminderTimer = setInterval(() => {
      const latestChime = loadOrderChimeSettings();
      if (latestChime.enabled && latestChime.remindUntilAccepted) {
        playOrderAlertChime(
          latestChime,
          pendingNewOrders[0]?.table_label ||
            pendingServiceReqs[0]?.table_label
        );
      }
    }, 10000);

    return () => clearInterval(reminderTimer);
  }, [
    orders,
    serviceRequests,
    chimeSettings.enabled,
    chimeSettings.remindUntilAccepted,
  ]);

  const handleUpdateServiceRequestStatus = async (
    requestId: string,
    status: ServiceRequestStatus
  ) => {
    if (!activeShop || updatingServiceReqId === requestId) return;
    setUpdatingServiceReqId(requestId);
    try {
      const res = await fetch('/api/service-requests', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: requestId,
          shop_id: activeShop.id,
          status,
        }),
      });
      if (res.status === 401) {
        setSessionExpired(true);
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        showActionToast(
          'error',
          data?.error ||
            tx(
              'Không thể cập nhật trạng thái yêu cầu phục vụ.',
              'Could not update service request status.'
            )
        );
        return;
      }

      await fetchOrdersAndCatalog(true);
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({
          type: 'service_request_updated',
          shopId: activeShop.id,
        });
        bc.close();
      }
    } catch (error) {
      showActionToast(
        'error',
        error instanceof Error && error.message
          ? error.message
          : tx(
              'Không thể cập nhật trạng thái yêu cầu phục vụ.',
              'Could not update service request status.'
            )
      );
    } finally {
      setUpdatingServiceReqId(null);
    }
  };

  const handleUpdateOrder = async (
    orderId: string,
    updates: {
      status?: OrderStatus;
      payment_status?: OrderPaymentStatus;
      payment_method?: PaymentMethod;
      restock_items?: boolean;
      refund_reason?: string;
      cancelled_reason?: string;
    },
    forcePrint = false,
    actionKey = 'update'
  ): Promise<ShopOrder | null> => {
    if (!activeShop) return null;
    // Guard against double-submits while a mutation for this order is in flight.
    if (updatingRef.current === orderId) return null;
    updatingRef.current = orderId;
    setUpdatingId(orderId);
    setUpdatingAction(actionKey);
    const fallbackError = tx('Không thể cập nhật đơn hàng', 'Could not update order');
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          shop_id: activeShop.id,
          order_id: orderId,
          ...updates,
          ...(updates.payment_status === 'paid'
            ? { payment_idempotency_key: `${orderId}:paid`, expected_total: orders.find((o) => o.id === orderId)?.total_amount }
            : {}),
        }),
      });
      if (res.ok) {
        const resData = await res.json().catch(() => null);
        const updatedOrder: ShopOrder | null = resData?.order || null;

        await fetchOrdersAndCatalog(true);
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({ type: 'order_updated', shopId: activeShop.id });
          bc.close();
        }

        if (
          updatedOrder &&
          (forcePrint || (updates.payment_status === 'paid' && autoPrintOnPay))
        ) {
          setPrintingOrder(updatedOrder);
        }
        return updatedOrder;
      }
      if (res.status === 401) setSessionExpired(true);
      const error = await res.json().catch(() => null);
      showActionToast(
        'error',
        res.status === 401
          ? tx(
              'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
              'Your session has expired. Please sign in again.'
            )
          : error?.error || fallbackError
      );
      // Server state may have moved on (e.g. 409 total changed) — resync silently.
      if (res.status === 409) void fetchOrdersAndCatalog(true);
      return null;
    } catch (error) {
      showActionToast(
        'error',
        error instanceof Error && error.message ? error.message : fallbackError
      );
      return null;
    } finally {
      if (updatingRef.current === orderId) updatingRef.current = null;
      setUpdatingId(null);
      setUpdatingAction(null);
    }
  };

  const hasPermission = (permission: ShopMembership['permissions'][number]) =>
    Boolean(
      membership &&
        (membership.role === 'owner' ||
          membership.permissions.includes(permission))
    );
  // Non-destructive capabilities keep the legacy optimistic default while membership loads;
  // the server still enforces every permission on PATCH.
  const canCollectPayment =
    !membership || membership.permissions.includes('payment.collect');
  const canViewReports =
    !membership || membership.permissions.includes('reports.view');
  // Destructive / editing actions: default deny until membership is known.
  const canRefundOrder = hasPermission('payment.refund');
  const canEditItems = hasPermission('orders.edit_items');
  const canCancelUnpaid = hasPermission('orders.cancel_unpaid');

  const paymentMethodLabel = (method?: PaymentMethod | null) =>
    method === 'vietqr'
      ? t('orders.paymentMethodQr')
      : t('orders.paymentMethodCash');

  const isActionPending = (orderId: string, actionKey: string) =>
    updatingId === orderId && updatingAction === actionKey;

  const renderOrderSummary = (order: ShopOrder, method?: PaymentMethod | null) => (
    <dl className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{tx('Đơn', 'Order')}</dt>
        <dd className="font-bold text-slate-900">
          {order.table_label} • #{order.order_code}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-slate-500">{tx('Số tiền', 'Amount')}</dt>
        <dd className="font-black text-emerald-600">
          {formatCurrency(Number(order.total_amount) || 0, activeShop?.currency || 'VND')}
        </dd>
      </div>
      {method !== undefined && (
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">{tx('Phương thức', 'Method')}</dt>
          <dd className="font-bold text-slate-900">{paymentMethodLabel(method)}</dd>
        </div>
      )}
    </dl>
  );

  const requestMarkPaid = async (
    order: ShopOrder,
    options: { method?: PaymentMethod; status?: OrderStatus; forcePrint?: boolean } = {}
  ): Promise<ShopOrder | null> => {
    const method = options.method || order.payment_method || 'cash';
    const result = await confirm({
      title: tx('Xác nhận đã thu tiền?', 'Confirm payment received?'),
      description: tx(
        'Chỉ xác nhận khi đã nhận đủ tiền từ khách.',
        'Only confirm once the full amount has been received.'
      ),
      details: renderOrderSummary(order, method),
      confirmLabel: tx('Đã thu tiền', 'Mark paid'),
    });
    if (!result) return null;
    return handleUpdateOrder(
      order.id,
      {
        payment_status: 'paid',
        ...(options.method ? { payment_method: options.method } : {}),
        ...(options.status ? { status: options.status } : {}),
      },
      Boolean(options.forcePrint),
      'pay'
    );
  };

  const requestCancelOrder = async (order: ShopOrder) => {
    const isPreparingOrder = order.status === 'preparing';
    // Restock choice only matters when at least one line tracks inventory (or catalog is unknown).
    const restockApplicable =
      catalogItems.length === 0 ||
      order.items.some((line) => {
        const catalogItem = catalogItems.find((item) => item.id === line.item_id);
        return catalogItem?.stock_quantity !== null && catalogItem?.stock_quantity !== undefined;
      });
    const defaultRestock = !isPreparingOrder;
    const result = await confirm({
      variant: 'danger',
      title: tx('Hủy đơn #{code}?', 'Cancel order #{code}?', {
        code: order.order_code,
      }),
      description: tx(
        'Đơn sẽ chuyển sang Đã hủy. Thao tác này không thể hoàn tác.',
        'The order will be marked as cancelled. This cannot be undone.'
      ),
      details: renderOrderSummary(order),
      reason: {
        label: tx('Lý do hủy', 'Cancellation reason'),
        placeholder: tx(
          'VD: Khách đổi ý, hết món...',
          'e.g. Guest changed mind, item sold out...'
        ),
        required: true,
      },
      checkbox: restockApplicable
        ? {
            label: tx('Hoàn lại tồn kho các món', 'Restock items'),
            description: isPreparingOrder
              ? tx(
                  'Bếp đã bắt đầu làm — bỏ chọn để ghi nhận hao hụt.',
                  'Kitchen already started — leave unchecked to record waste.'
                )
              : tx(
                  'Cộng lại số lượng món vào tồn kho.',
                  'Return item quantities to inventory.'
                ),
            defaultChecked: defaultRestock,
          }
        : undefined,
      confirmLabel: tx('Hủy đơn', 'Cancel order'),
      cancelLabel: tx('Giữ đơn', 'Keep order'),
    });
    if (!result) return;
    await handleUpdateOrder(
      order.id,
      {
        status: 'cancelled',
        restock_items: restockApplicable ? result.checked : defaultRestock,
        ...(result.reason ? { cancelled_reason: result.reason } : {}),
      },
      false,
      'cancel'
    );
  };

  const requestRefundOrder = async (order: ShopOrder) => {
    const result = await confirm({
      variant: 'danger',
      title: tx('Hoàn tiền đơn #{code}?', 'Refund order #{code}?', {
        code: order.order_code,
      }),
      description: tx(
        'Ghi nhận hoàn trả toàn bộ số tiền cho khách. Thao tác này không thể hoàn tác.',
        'Records a full refund to the guest. This cannot be undone.'
      ),
      details: renderOrderSummary(order, order.payment_method),
      reason: {
        label: tx('Lý do hoàn tiền', 'Refund reason'),
        placeholder: tx(
          'VD: Món lỗi, khách hủy sau khi thanh toán...',
          'e.g. Wrong item, guest cancelled after paying...'
        ),
        required: true,
      },
      confirmLabel: tx('Hoàn tiền', 'Refund'),
    });
    if (!result) return;
    await handleUpdateOrder(
      order.id,
      { payment_status: 'refunded', refund_reason: result.reason },
      false,
      'refund'
    );
  };

  if (!activeShop) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-sm font-bold text-slate-800">
          {tx('Đang tải dữ liệu cửa hàng...', 'Loading store data...')}
        </p>
      </div>
    );
  }

  const newOrders = orders.filter((o) => o.status === 'new');
  const preparingOrders = orders.filter((o) => o.status === 'preparing');
  const activeOrders = orders.filter(
    (o) =>
      o.status === 'new' ||
      o.status === 'preparing' ||
      (o.status !== 'cancelled' && o.payment_status === 'unpaid')
  );
  const completedOrders = orders.filter(
    (o) => o.status === 'completed' && o.payment_status === 'paid'
  );
  const cancelledOrders = orders.filter((o) => o.status === 'cancelled');

  const todayVnKey = getVnDateKey();
  const todayValidOrders = orders.filter(
    (o) => o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayVnKey
  );
  const todayPaidOrders = todayValidOrders.filter(
    (o) => o.payment_status === 'paid'
  );
  const todayRevenue = todayPaidOrders.reduce(
    (sum, o) => sum + Number(o.total_amount || 0),
    0
  );

  const statusPriority: Record<OrderStatus, number> = {
    new: 0,
    preparing: 1,
    completed: 2,
    cancelled: 3,
  };

  const filteredOrders = orders
    .filter((o) => {
      if (filterTab === 'today') {
        if (todayValidOrders.length > 0) {
          return (
            o.status === 'new' ||
            o.status === 'preparing' ||
            (o.status !== 'cancelled' && o.payment_status === 'unpaid') ||
            (o.status !== 'cancelled' &&
              getVnDateKey(o.created_at) === todayVnKey)
          );
        }
        return o.status !== 'cancelled';
      }
      if (filterTab === 'active') {
        return (
          o.status === 'new' ||
          o.status === 'preparing' ||
          (o.status !== 'cancelled' && o.payment_status === 'unpaid')
        );
      }
      if (filterTab === 'all') return true;
      return o.status === filterTab;
    })
    .sort((a, b) => {
      if (filterTab === 'today') {
        const pa = statusPriority[a.status] ?? 2;
        const pb = statusPriority[b.status] ?? 2;
        if (pa !== pb) return pa - pb;
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

  const chimeSummaryText = formatChimeSummaryLabel(chimeSettings, locale);
  const syncLabel = liveStatus === 'connected'
    ? t('orders.syncLive')
    : liveStatus === 'unauthorized'
      ? tx('Cần đăng nhập lại', 'Sign in again')
      : t('orders.syncPolling');

  const activeServiceRequests = serviceRequests.filter(
    (r) => r.status === 'pending' || r.status === 'acknowledged'
  );
  const pendingServiceRequestsCount = activeServiceRequests.filter(
    (r) => r.status === 'pending'
  ).length;

  const showSessionExpired = sessionExpired || liveStatus === 'unauthorized';

  return (
    <div className="space-y-4">
      {activeServiceRequests.length > 0 && (
        <section
          aria-live="polite"
          data-testid="orders-service-requests-panel"
          className="rounded-3xl border-2 border-amber-400 bg-amber-50/95 p-4 shadow-md dark:border-amber-500/60 dark:bg-amber-950/60 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-2xs">
                <BellRing
                  className={`h-4 w-4 ${
                    pendingServiceRequestsCount > 0 ? 'animate-bounce' : ''
                  }`}
                />
              </span>
              <div>
                <h2 className="text-sm font-black text-amber-950 dark:text-amber-100">
                  {tx(
                    'Yêu cầu hỗ trợ từ QR bàn ({count})',
                    'Table QR service requests ({count})',
                    { count: activeServiceRequests.length }
                  )}
                </h2>
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  {tx(
                    'Khách tại bàn đang gọi phục vụ hoặc xin hóa đơn. Tiếp nhận và hoàn tất yêu cầu không tự động đánh dấu đơn đã thu tiền.',
                    'Guests at tables are calling staff or requesting a bill. Acknowledging or resolving never marks an order as paid.'
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {activeServiceRequests.map((req) => {
              const isBill = req.request_type === 'request_bill';
              const isPending = req.status === 'pending';
              const isBusy = updatingServiceReqId === req.id;
              return (
                <div
                  key={req.id}
                  data-testid={`service-request-item-${req.id}`}
                  className={`flex flex-col justify-between gap-2.5 rounded-2xl border p-3 shadow-2xs ${
                    isPending
                      ? 'border-amber-400 bg-white dark:border-amber-500/60 dark:bg-slate-900'
                      : 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-slate-900/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">
                          {req.table_label}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${
                            isBill
                              ? 'bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-200'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                          }`}
                        >
                          {isBill
                            ? tx('🧾 Xin hóa đơn', '🧾 Request bill')
                            : tx('🔔 Gọi phục vụ', '🔔 Call staff')}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        {isPending
                          ? tx('Chờ tiếp nhận', 'Pending acknowledgement')
                          : tx('Đã tiếp nhận — đang hỗ trợ', 'Acknowledged — in progress')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    {isPending && (
                      <button
                        type="button"
                        data-testid={`service-request-ack-${req.id}`}
                        disabled={isBusy}
                        onClick={() =>
                          handleUpdateServiceRequestStatus(
                            req.id,
                            'acknowledged'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-xl border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-60"
                      >
                        <span>{tx('Đã nhận', 'Acknowledge')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`service-request-resolve-${req.id}`}
                      disabled={isBusy}
                      onClick={() =>
                        handleUpdateServiceRequestStatus(req.id, 'resolved')
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{tx('Hoàn tất', 'Resolve')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {showSessionExpired && (
        <div
          role="alert"
          data-testid="orders-session-expired-banner"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-rose-400 bg-rose-50 px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-2.5 text-sm font-black text-rose-800">
            <XCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
            <span>
              {tx(
                'Phiên đăng nhập hết hạn — đơn mới sẽ không tự cập nhật.',
                'Session expired — new orders will not update automatically.'
              )}
            </span>
          </div>
          <Link
            href="/login?next=/dashboard/orders"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-500"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>{tx('Đăng nhập lại', 'Sign in again')}</span>
          </Link>
        </div>
      )}

      {actionToast && (
        <div
          role={actionToast.kind === 'error' ? 'alert' : 'status'}
          data-testid="orders-action-toast"
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

      {/* Header Banner + Mode Switcher (POS Terminal vs Kitchen/Table Orders) */}
      <div className="rounded-3xl bg-slate-900 text-white p-4 sm:p-5 shadow-md space-y-3.5">
        {/* Top Row: Short Heading + Separate Truncated Shop Name + Primary Mode Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white shrink-0">
                {t('orders.pageTitle')}
              </h1>
              <span
                title={activeShop.name}
                data-testid="orders-shop-name-badge"
                className="inline-block max-w-[200px] sm:max-w-[280px] truncate rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-extrabold text-emerald-400"
              >
                {activeShop.name}
              </span>
            </div>
            {canViewReports && <p className="text-xs text-slate-300 mt-1">
                  {tx('Đã thu hôm nay:', 'Paid today:')}{' '}
                  <strong className="text-emerald-400 font-black">
                    {formatCurrency(todayRevenue, activeShop.currency)}
                  </strong>
            </p>}
          </div>

          {/* Primary Workspace Mode Tabs */}
          <div className="inline-flex flex-wrap rounded-2xl bg-slate-800 p-1 border border-slate-700 shrink-0 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => switchWorkspaceMode('pos_terminal')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black transition-all ${
                workspaceMode === 'pos_terminal'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Monitor className="h-4 w-4 shrink-0" />
              <span>{t('orders.tabPos')}</span>
            </button>

            <button
              type="button"
              onClick={() => switchWorkspaceMode('kitchen_orders')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black transition-all ${
                workspaceMode === 'kitchen_orders'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <BellRing
                className={`h-4 w-4 shrink-0 ${
                  newOrders.length > 0 ? 'animate-bounce text-amber-300' : ''
                }`}
              />
              <span>
                {t('orders.tabQueue', { count: todayValidOrders.length })}
              </span>
              {newOrders.length > 0 && (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                  {tx('{count} mới', '{count} new', {
                    count: newOrders.length,
                  })}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Row: Utility Controls & Quick Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoPrintOnPay((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-bold border transition-colors ${
                autoPrintOnPay
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
              title={t('orders.autoPrintTooltip')}
            >
              <Printer className="h-4 w-4" />
              <span>
                {autoPrintOnPay
                  ? t('orders.autoPrintOn')
                  : t('orders.autoPrintOff')}
              </span>
            </button>

            <div className="inline-flex items-center rounded-2xl border border-emerald-500/40 bg-slate-800/90 p-0.5">
              <button
                type="button"
                data-testid="orders-chime-summary"
                onClick={() => {
                  const nextEnabled = !chimeSettings.enabled;
                  const next = { ...chimeSettings, enabled: nextEnabled };
                  updateChimeSettings({ enabled: nextEnabled });
                  if (nextEnabled)
                    playOrderAlertChime(next, tx('Bàn 01', 'Table 01'));
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  chimeSettings.enabled
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {chimeSettings.enabled ? (
                  <Volume2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <VolumeX className="h-4 w-4" />
                )}
                <span>{chimeSummaryText}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsChimeModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-700/80 px-2.5 py-1.5 text-[11px] font-black text-amber-300 hover:bg-slate-700"
                title={t('orders.chimeSettingsTooltip')}
                aria-label={t('orders.chimeSettings')}
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>

            <Link
              href="/dashboard/kitchen"
              className="inline-flex items-center gap-1.5 rounded-2xl border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-black text-amber-300 hover:bg-amber-500/25 transition"
            >
              <ChefHat className="h-3.5 w-3.5" />
              <span>{t('nav.kitchen')}</span>
            </Link>

            <Link
              href="/dashboard/reports"
              className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/25 transition"
            >
              <span>{tx('Báo cáo', 'Reports')}</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span role="status" aria-label={syncLabel} title={syncLabel}
              className={`text-xs ${liveStatus === 'connected' ? 'text-emerald-400' : liveStatus === 'unauthorized' ? 'text-rose-400' : 'text-amber-400'}`}>
              <span aria-hidden="true">●</span>
            </span>
            {workspaceMode === 'kitchen_orders' && (
              <button
                type="button"
                onClick={() => switchWorkspaceMode('pos_terminal')}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3.5 py-1.5 text-xs font-black text-slate-950 shadow-sm hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                <span>{t('orders.openPosCta')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchOrdersAndCatalog(false)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Live Incoming Table Order Banner when cashier is inside POS Terminal */}
      {workspaceMode === 'pos_terminal' && newOrders.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-2.5 text-xs font-black text-amber-950">
            <BellRing className="h-4 w-4 text-amber-600 animate-bounce" />
            <span>
              {tx(
                'Có {count} đơn khách gọi tại bàn qua QR đang chờ nhận!',
                '{count} new table QR order(s) waiting for confirmation!',
                { count: newOrders.length }
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFilterTab('new');
              switchWorkspaceMode('kitchen_orders');
            }}
            className="rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-amber-500"
          >
            {t('header.openOrdersNow')} →
          </button>
        </div>
      )}

      {/* MODE 1: DEDICATED SPLIT-SCREEN COUNTER POS TERMINAL */}
      {workspaceMode === 'pos_terminal' ? (
        loading && catalogItems.length === 0 ? (
          <div
            role="status"
            data-testid="pos-loading-state"
            className="rounded-3xl bg-white border border-slate-200 p-12 text-center space-y-3 shadow-2xs"
          >
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            <p className="text-sm font-bold text-slate-800">
              {tx(
                'Đang tải dữ liệu thực đơn & bàn quầy POS...',
                'Loading POS menu & table data...'
              )}
            </p>
            <p className="text-xs text-slate-500">
              {tx('Vui lòng đợi trong giây lát', 'Please wait a moment')}
            </p>
          </div>
        ) : (
          <PosCounterWorkspace
            shop={activeShop}
            categories={catalogCategories}
            items={catalogItems}
            orders={orders}
            editingOrder={editingOrder}
            onCancelEditOrder={() => setEditingOrder(null)}
            autoPrintOnPay={autoPrintOnPay}
            onPrintOrder={(ord) => setPrintingOrder(ord)}
            onUpdateOrder={(id, up) => {
              const target = orders.find((o) => o.id === id);
              if (target && up.payment_status === 'paid') {
                return requestMarkPaid(target, { status: up.status });
              }
              if (target && up.status === 'cancelled') {
                return requestCancelOrder(target);
              }
              return handleUpdateOrder(id, up);
            }}
            onOrderCreated={async (createdOrder, shouldPrint) => {
              setEditingOrder(null);
              await fetchOrdersAndCatalog(true);
              if (
                typeof window !== 'undefined' &&
                'BroadcastChannel' in window
              ) {
                const bc = new BroadcastChannel('qlaok_realtime_sync');
                bc.postMessage({ type: 'order_updated', shopId: activeShop.id });
                bc.close();
              }
              if (shouldPrint) {
                setPrintingOrder(createdOrder);
              }
            }}
          />
        )
      ) : (
        <>
          {/* 4 Live Counter KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="rounded-3xl bg-white border-2 border-amber-300 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-700">
                  {t('orders.kpiNew')}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <Clock className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {newOrders.length}
              </p>
            </div>

            <div className="rounded-3xl bg-white border border-blue-200 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-700">
                  {t('orders.kpiPreparing')}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <ChefHat className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {preparingOrders.length}
              </p>
            </div>

            <div className="rounded-3xl bg-white border border-emerald-200 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700">
                  {tx('Đơn hôm nay', 'Today’s orders')}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-black text-slate-900">
                {todayValidOrders.length}
              </p>
              <p className="text-[11px] font-medium text-slate-500">
                {t('orders.filterCompleted', { count: completedOrders.length })}
              </p>
            </div>

            <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">
                  {t('orders.kpiPaidToday', { count: todayPaidOrders.length })}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
                {canViewReports
                  ? formatCurrency(todayRevenue, activeShop.currency)
                  : tx('🔒 Chỉ Chủ quán / Thu ngân', '🔒 Owner / Cashier only')}
              </p>
              <p className="text-[11px] font-medium text-slate-500">
                {tx(
                  'Chỉ tính đơn đã xác nhận thu tiền',
                  'Includes confirmed paid orders only'
                )}
              </p>
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {[
              {
                id: 'today',
                label: tx('Hôm nay ({count})', 'Today ({count})', {
                  count: todayValidOrders.length,
                }),
              },
              {
                id: 'active',
                label: t('orders.filterActive', { count: activeOrders.length }),
              },
              {
                id: 'new',
                label: t('orders.filterNew', { count: newOrders.length }),
              },
              {
                id: 'preparing',
                label: t('orders.filterPreparing', {
                  count: preparingOrders.length,
                }),
              },
              {
                id: 'completed',
                label: t('orders.filterCompleted', {
                  count: orders.filter((o) => o.status === 'completed').length,
                }),
              },
              {
                id: 'cancelled',
                label: tx('Đã hủy ({count})', 'Cancelled ({count})', {
                  count: cancelledOrders.length,
                }),
              },
              {
                id: 'all',
                label: t('orders.filterAll', { count: orders.length }),
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setFilterTab(
                    tab.id as
                      | 'today'
                      | 'active'
                      | 'new'
                      | 'preparing'
                      | 'completed'
                      | 'cancelled'
                      | 'all'
                  )
                }
                className={`shrink-0 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition-all ${
                  filterTab === tab.id
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Orders Grid */}
          {loading ? (
            <div
              role="status"
              data-testid="orders-loading-state"
              className="rounded-3xl bg-white border border-slate-200 p-12 text-center space-y-3 shadow-2xs"
            >
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
              <p className="text-sm font-bold text-slate-800">
                {tx(
                  'Đang tải dữ liệu đơn hàng...',
                  'Loading orders data...'
                )}
              </p>
              <p className="text-xs text-slate-500">
                {tx('Vui lòng đợi trong giây lát', 'Please wait a moment')}
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <ShoppingBag className="h-6 w-6" />
              </div>
              <p className="text-sm font-bold text-slate-800">
                {t('orders.emptyQueueTitle')}
              </p>
              <p className="text-xs text-slate-500">
                {t('orders.emptyQueueDesc')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredOrders.map((order) => {
                const visitorMeta =
                  LOCALE_META[order.visitor_lang] || LOCALE_META.vi;
                const isNew = order.status === 'new';
                const isPreparing = order.status === 'preparing';
                const isCompleted = order.status === 'completed';
                const isCancelled = order.status === 'cancelled';
                const isOrderUpdating = updatingId === order.id;

                return (
                  <div
                    key={order.id}
                    className={`rounded-3xl bg-white border-2 p-5 shadow-xs flex flex-col justify-between gap-4 transition-all ${
                      isNew
                        ? 'border-amber-400 ring-4 ring-amber-400/15'
                        : isPreparing
                          ? 'border-blue-400'
                          : isCancelled
                            ? 'border-slate-200 opacity-75'
                            : 'border-slate-200'
                    }`}
                  >
                    <div className="space-y-3.5">
                      {/* Ticket Top Bar */}
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-xl bg-slate-900 px-3 py-1 text-xs font-black text-amber-400">
                              {order.table_label}
                            </span>
                            <span className="text-sm font-black text-slate-900">
                              #{order.order_code}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                                isNew
                                  ? 'bg-amber-100 text-amber-800'
                                  : isPreparing
                                    ? 'bg-blue-100 text-blue-800'
                                    : isCompleted
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {isNew
                                ? t('orders.statusNew')
                                : isPreparing
                                  ? t('orders.statusPreparing')
                                  : isCompleted
                                    ? t('orders.statusCompleted')
                                    : t('orders.statusCancelled')}
                            </span>
                          </div>

                          <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <FlagIcon
                                locale={order.visitor_lang}
                                className="h-3.5 w-5"
                              />
                              <span>
                                {locale === 'en'
                                  ? appLanguageName(order.visitor_lang, locale)
                                  : `Khách ${visitorMeta.label}`}
                              </span>
                            </span>
                            <span>•</span>
                            <span>
                              {new Date(order.created_at).toLocaleTimeString(
                                locale === 'en' ? 'en-US' : 'vi-VN',
                                {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }
                              )}
                            </span>
                            <span>•</span>
                            <span>
                              {order.source === 'counter_pos'
                                ? tx('🖥️ Tại quầy', '🖥️ Counter POS')
                                : tx('📱 Quét QR bàn', '📱 Table QR')}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-base font-black text-emerald-600">
                            {formatCurrency(
                              order.total_amount,
                              activeShop.currency
                            )}
                          </p>
                          <span
                            className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                              order.payment_status === 'paid'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : order.payment_status === 'refunded'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {order.payment_status === 'paid'
                              ? `✓ ${t('orders.paymentPaid')}`
                              : order.payment_status === 'refunded'
                                ? `↩ ${t('orders.paymentRefunded')}`
                                : t('orders.paymentUnpaid')}{' '}
                            (
                            {order.payment_method === 'vietqr'
                              ? t('orders.paymentMethodQr')
                              : t('orders.paymentMethodCash')}
                            )
                          </span>
                        </div>
                      </div>

                      {/* Line Items */}
                      <div className="space-y-2.5">
                        {order.items.map((line, idx) => (
                          <div
                            key={idx}
                            className="rounded-2xl bg-slate-50 border border-slate-200/70 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white">
                                  x{line.quantity}
                                </span>
                                <div>
                                  <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                                    {locale === 'en'
                                      ? line.name_i18n?.en || line.name_vi
                                      : line.name_vi}
                                  </p>
                                  {line.selected_choices &&
                                    line.selected_choices.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {line.selected_choices.map(
                                          (c, cIdx) => {
                                            const label =
                                              typeof c === 'string'
                                                ? c
                                                : (locale === 'en'
                                                    ? c.label_i18n?.en
                                                    : undefined) ||
                                                  c.label_vi ||
                                                  c.label_i18n?.vi ||
                                                  '';
                                            if (!label) return null;
                                            return (
                                              <span
                                                key={cIdx}
                                                className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900"
                                              >
                                                • {label}
                                              </span>
                                            );
                                          }
                                        )}
                                      </div>
                                    )}
                                  {line.quick_tags &&
                                    line.quick_tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {line.quick_tags.map((tag, tIdx) => (
                                          <span
                                            key={tIdx}
                                            className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800"
                                          >
                                            ⚠️ {tag}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  {line.custom_note && (
                                    <p className="mt-1 text-[11px] font-bold text-amber-800">
                                      📝 &ldquo;{line.custom_note}&rdquo;
                                    </p>
                                  )}
                                </div>
                              </div>
                              <span className="text-xs font-bold text-slate-700 shrink-0">
                                {formatCurrency(
                                  (line.unit_price + line.extra_price) *
                                    line.quantity,
                                  activeShop.currency
                                )}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {order.customer_note && (
                        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2 text-xs font-bold text-amber-900">
                          💬 {tx('Ghi chú bàn:', 'Table note:')} &ldquo;
                          {order.customer_note}&rdquo;
                        </div>
                      )}
                    </div>

                    {/* Action Buttons Footer */}
                    {!isCancelled && (
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        {order.payment_status === 'unpaid' && canEditItems && (
                          <button
                            type="button"
                            disabled={isOrderUpdating}
                            onClick={() => handleOpenEditOrderInPos(order)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-amber-400 bg-amber-100 px-3.5 py-2.5 text-xs font-black text-amber-950 shadow-2xs hover:bg-amber-200 transition disabled:opacity-50"
                            title={tx(
                              'Mở giao diện bán hàng tại quầy để thêm/bớt món hoặc đổi tùy chọn trước khi thanh toán',
                              'Open Counter POS to add/remove items or edit options before checkout'
                            )}
                          >
                            <Edit3 className="h-4 w-4 text-amber-700" />
                            <span>{t('orders.actionEdit')}</span>
                          </button>
                        )}

                        {isNew && (
                          <button
                            type="button"
                            disabled={isOrderUpdating}
                            aria-busy={isActionPending(order.id, 'accept') || undefined}
                            onClick={() =>
                              handleUpdateOrder(
                                order.id,
                                { status: 'preparing' },
                                false,
                                'accept'
                              )
                            }
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-blue-500 disabled:opacity-50"
                          >
                            {isActionPending(order.id, 'accept') ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <ChefHat className="h-4 w-4" />
                            )}
                            <span>{t('orders.actionAccept')}</span>
                          </button>
                        )}

                        {isPreparing && (
                          <button
                            type="button"
                            disabled={isOrderUpdating}
                            aria-busy={isActionPending(order.id, 'serve') || undefined}
                            onClick={() =>
                              handleUpdateOrder(
                                order.id,
                                { status: 'completed' },
                                false,
                                'serve'
                              )
                            }
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-blue-500 disabled:opacity-50"
                          >
                            {isActionPending(order.id, 'serve') ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            <span>{t('orders.actionServed')}</span>
                          </button>
                        )}

                        {(isPreparing || isCompleted) &&
                          order.payment_status === 'unpaid' &&
                          canCollectPayment && (
                            <button
                              type="button"
                              disabled={isOrderUpdating}
                              aria-busy={isActionPending(order.id, 'pay') || undefined}
                              onClick={() => void requestMarkPaid(order)}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
                            >
                              {isActionPending(order.id, 'pay') ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Banknote className="h-4 w-4" />
                              )}
                              <span>{t('orders.actionMarkPaid')}</span>
                            </button>
                          )}

                        {(isNew || isPreparing) &&
                          order.payment_status !== 'paid' &&
                          canCancelUnpaid && (
                            <button
                              type="button"
                              disabled={isOrderUpdating}
                              aria-busy={isActionPending(order.id, 'cancel') || undefined}
                              onClick={() => void requestCancelOrder(order)}
                              className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              {isActionPending(order.id, 'cancel') ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                              <span>{t('orders.actionCancel')}</span>
                            </button>
                          )}

                        {order.payment_status === 'paid' && canRefundOrder && (
                          <button
                            type="button"
                            disabled={isOrderUpdating}
                            aria-busy={isActionPending(order.id, 'refund') || undefined}
                            onClick={() => void requestRefundOrder(order)}
                            className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            {isActionPending(order.id, 'refund') ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            <span>{t('orders.actionRefund')}</span>
                          </button>
                        )}

                        {order.payment_status === 'unpaid' && (
                          <button
                            type="button"
                            onClick={() => setQrOrderModal(order)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200"
                          >
                            <QrCode className="h-4 w-4 text-emerald-600" />
                            <span>{tx('Mã QR', 'QR Pay')}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setPrintingOrder(order)}
                          className={`inline-flex items-center justify-center gap-1.5 rounded-2xl border px-3.5 py-2.5 text-xs font-black transition-colors ${
                            isCompleted
                              ? 'flex-1 border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <Printer className="h-4 w-4 text-emerald-600" />
                          <span>
                            {order.payment_status === 'paid'
                              ? t('orders.actionPrintReceipt')
                              : t('orders.actionProvisionalBill')}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* VietQR / Custom QR Table Bill Payment Modal */}
      {qrOrderModal &&
        (() => {
          const qrInfo = getShopPaymentQrInfo(
            activeShop,
            qrOrderModal.total_amount,
            qrOrderModal.order_code
          );
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4 text-center">
                <div className="flex items-center justify-between">
                  <span className="rounded-xl bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                    {qrOrderModal.table_label} • #{qrOrderModal.order_code}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQrOrderModal(null)}
                    aria-label={t('common.close')}
                    title={t('common.close')}
                    className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {tx(
                      'Quét Mã QR Thanh Toán Đơn Hàng',
                      'Scan QR Code to Pay Order'
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {qrInfo.mode === 'custom_qr'
                      ? tx(
                          'Mã QR thanh toán do quán cài đặt',
                          'Store custom payment QR code'
                        )
                      : tx(
                          'Số tiền và nội dung chuyển khoản đã điền sẵn tự động',
                          'Amount and transfer memo are pre-filled automatically'
                        )}
                  </p>
                </div>

                {!qrInfo.isConfigured || !qrInfo.qrImageUrl ? (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-xs font-bold text-amber-900 space-y-2">
                    <p>
                      {tx(
                        '⚠️ Quán chưa cài đặt Số Tài Khoản / Mã QR nhận tiền. Vui lòng cấu hình trong Cài đặt quán.',
                        '⚠️ Bank account / payment QR is not configured yet. Please set it up in Store Settings.'
                      )}
                    </p>
                    <Link
                      href="/dashboard/settings#payment-qr-settings"
                      className="inline-block underline font-black text-emerald-700"
                    >
                      {tx(
                        'Cài đặt tài khoản ngân hàng ngay →',
                        'Configure bank account now →'
                      )}
                    </Link>
                  </div>
                ) : (
                  <div
                    style={{ backgroundColor: '#ffffff' }}
                    className="qr-light-surface mx-auto w-56 h-56 rounded-2xl border border-slate-200 p-2 bg-white shadow-inner flex items-center justify-center"
                  >
                    <img
                      src={qrInfo.qrImageUrl}
                      alt="VietQR Order Payment"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

                <div className="rounded-2xl bg-slate-50 p-3 text-xs space-y-1 text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      {tx('Ngân hàng / Ví:', 'Bank / Wallet:')}
                    </span>
                    <span className="font-bold text-slate-900">
                      {qrInfo.bankShortName}
                    </span>
                  </div>
                  {qrInfo.accountNumber && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">
                        {tx('Số tài khoản:', 'Account number:')}
                      </span>
                      <span className="font-mono font-black text-slate-900">
                        {qrInfo.accountNumber}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      {tx('Chủ tài khoản:', 'Account holder:')}
                    </span>
                    <span className="font-bold text-slate-900 uppercase">
                      {qrInfo.accountName}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200/80">
                    <span className="text-slate-500">
                      {tx('Tổng thanh toán:', 'Total amount:')}
                    </span>
                    <span className="font-black text-emerald-600 text-sm">
                      {formatCurrency(
                        qrOrderModal.total_amount,
                        activeShop.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      {tx('Nội dung CK:', 'Transfer memo:')}
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {qrInfo.transferContent}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {canCollectPayment && (
                    <button
                      type="button"
                      disabled={updatingId === qrOrderModal.id}
                      onClick={async () => {
                        const targetOrder = qrOrderModal;
                        setQrOrderModal(null);
                        await handleUpdateOrder(
                          targetOrder.id,
                          {
                            payment_status: 'paid',
                            payment_method: 'vietqr',
                          },
                          true,
                          'pay'
                        );
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        {tx(
                          'Xác nhận đã nhận tiền & In hóa đơn',
                          'Confirm payment received & Print receipt'
                        )}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const targetOrder = qrOrderModal;
                      setQrOrderModal(null);
                      setPrintingOrder(targetOrder);
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    <Printer className="h-4 w-4 text-slate-700" />
                    <span>
                      {tx(
                        'In phiếu tạm tính kèm mã QR cho khách',
                        'Print provisional bill with QR code'
                      )}
                    </span>
                  </button>

                  <Link
                    href="/dashboard/settings#payment-qr-settings"
                    className="inline-flex items-center justify-center gap-1 pt-1 text-[11px] font-bold text-slate-500 hover:text-emerald-600"
                  >
                    <Settings className="h-3 w-3" />
                    <span>
                      {tx(
                        'Đổi Số Tài Khoản / Mã QR trong Cài đặt quán',
                        'Change bank account / QR in Store Settings'
                      )}
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Chime Sound & Volume Booster Settings Modal (Detailed chime copy lives strictly inside this modal) */}
      {isChimeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white">
                  <BellRing className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {t('chime.modalTitle')}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {t('chime.modalSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsChimeModalOpen(false)}
                aria-label={t('common.close')}
                title={t('common.close')}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 1. Master Volume / Loudness Boost */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-700">
                1. {t('chime.volumeLabel')}:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'normal',
                      title: `🔈 ${t('chime.volumeNormal')}`,
                      sub: tx('Quán yên tĩnh', 'Quiet venue'),
                    },
                    {
                      id: 'loud',
                      title: `🔉 ${t('chime.volumeLoud')}`,
                      sub: tx('Quầy thu ngân', 'Cashier counter'),
                    },
                    {
                      id: 'max_boost',
                      title: `🔊 ${t('chime.volumeBoost')}`,
                      sub: tx('Quán đông / Bếp ồn', 'Busy shop / Kitchen'),
                    },
                  ] as Array<{
                    id: ChimeVolumePreset;
                    title: string;
                    sub: string;
                  }>
                ).map((vol) => {
                  const active = chimeSettings.volumePreset === vol.id;
                  return (
                    <button
                      key={vol.id}
                      type="button"
                      onClick={() => {
                        const next = {
                          ...chimeSettings,
                          enabled: true,
                          volumePreset: vol.id,
                        };
                        updateChimeSettings({
                          enabled: true,
                          volumePreset: vol.id,
                        });
                        playOrderAlertChime(next, tx('Bàn 01', 'Table 01'));
                      }}
                      className={`rounded-2xl border p-2.5 text-left transition ${
                        active
                          ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-black text-slate-900">
                        {vol.title}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                        {vol.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Select Chime Sound Style */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-700">
                2. {t('chime.selectSoundLabel')}:
              </label>
              <div className="space-y-2">
                {CHIME_SOUND_OPTIONS.map((opt) => {
                  const active = chimeSettings.soundId === opt.id;
                  const enMeta = EN_CHIME_SOUND_TEXT[opt.id];
                  const displayLabel =
                    locale === 'en' && enMeta ? enMeta.label : opt.label;
                  const displayDesc =
                    locale === 'en' && enMeta ? enMeta.desc : opt.desc;
                  const displayBadge =
                    locale === 'en' && enMeta ? enMeta.badge : opt.badge;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => {
                        const next = {
                          ...chimeSettings,
                          enabled: true,
                          soundId: opt.id as ChimeSoundId,
                        };
                        updateChimeSettings({
                          enabled: true,
                          soundId: opt.id as ChimeSoundId,
                        });
                        playOrderAlertChime(next, tx('Bàn 02', 'Table 02'));
                      }}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-3 cursor-pointer transition ${
                        active
                          ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-black text-slate-900">
                            {displayLabel}
                          </span>
                          {displayBadge && (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                              {displayBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {displayDesc}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playOrderAlertChime(
                            {
                              ...chimeSettings,
                              enabled: true,
                              soundId: opt.id as ChimeSoundId,
                            },
                            tx('Bàn 05', 'Table 05')
                          );
                        }}
                        className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>{t('chime.testButton')}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Repeat Count & Persistent Reminder */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">
                  {tx(
                    'Số hồi chuông đổ mỗi lần có đơn:',
                    'Chime repeats per new order:'
                  )}
                </span>
                <div className="inline-flex rounded-xl bg-white border border-slate-200 p-0.5">
                  {([1, 2, 3] as Array<1 | 2 | 3>).map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => updateChimeSettings({ repeatCount: cnt })}
                      className={`rounded-lg px-3 py-1 text-xs font-black transition ${
                        chimeSettings.repeatCount === cnt
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {tx('{cnt} hồi', '{cnt}x', { cnt })}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t border-slate-200/80">
                <input
                  type="checkbox"
                  checked={chimeSettings.remindUntilAccepted}
                  onChange={(e) =>
                    updateChimeSettings({
                      remindUntilAccepted: e.target.checked,
                    })
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                <div className="text-xs">
                  <span className="font-black text-slate-900 block">
                    {tx(
                      '🔁 Tự động nhắc chuông mỗi 10 giây khi còn đơn Mới chưa nhận',
                      '🔁 Repeat chime every 10 seconds while new orders await confirmation'
                    )}
                  </span>
                  <span className="text-slate-500 text-[11px]">
                    {tx(
                      'Đảm bảo nhân viên không bỏ sót đơn khách đặt qua QR khi đang bận pha chế',
                      'Ensures staff never miss incoming table QR orders during busy hours'
                    )}
                  </span>
                </div>
              </label>

              {/* 4. Desktop Notification */}
              <div className="pt-2.5 border-t border-slate-200/80 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={chimeSettings.browserNotificationEnabled}
                      onChange={async (e) => {
                        const checked = e.target.checked;
                        updateChimeSettings({
                          browserNotificationEnabled: checked,
                        });
                        if (checked && browserNotifPerm === 'default') {
                          const perm =
                            await requestBrowserNotificationPermission();
                          setBrowserNotifPerm(perm);
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    <div className="text-xs">
                      <span className="font-black text-slate-900 block">
                        🖥️ {t('chime.desktopNotifTitle')}
                      </span>
                      <span className="text-slate-500 text-[11px]">
                        {t('chime.desktopNotifDesc')}
                      </span>
                    </div>
                  </label>

                  {browserNotifPerm !== 'unsupported' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const perm =
                          await requestBrowserNotificationPermission();
                        setBrowserNotifPerm(perm);
                        if (perm === 'granted') {
                          updateChimeSettings({
                            browserNotificationEnabled: true,
                          });
                          sendBrowserOrderNotification({
                            orderCode: 'TEST-88',
                            tableLabel: tx(
                              'Bàn 02 (Thử thông báo)',
                              'Table 02 (Test alert)'
                            ),
                            totalFormatted: formatCurrency(
                              125000,
                              activeShop?.currency || 'VND'
                            ),
                            itemsSummary: tx(
                              '2x Phở Bò Tái Lăn, 1x Trà Đào',
                              '2x Rare Beef Pho, 1x Peach Tea'
                            ),
                            shopName: activeShop?.name,
                            forceTest: true,
                          });
                        }
                      }}
                      className={`shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-black transition ${
                        browserNotifPerm === 'granted'
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                          : browserNotifPerm === 'denied'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm'
                      }`}
                    >
                      {browserNotifPerm === 'granted'
                        ? t('header.alertsOn')
                        : browserNotifPerm === 'denied'
                          ? tx('Đã chặn trên trình duyệt', 'Blocked in browser')
                          : t('header.alertsOff')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  const testConfig = { ...chimeSettings, enabled: true };
                  playOrderAlertChime(testConfig, tx('Bàn 01', 'Table 01'));
                  if (browserNotifPerm === 'default') {
                    const perm = await requestBrowserNotificationPermission();
                    setBrowserNotifPerm(perm);
                  }
                  sendBrowserOrderNotification({
                    orderCode: 'TEST-01',
                    tableLabel: tx('Bàn 01', 'Table 01'),
                    totalFormatted: formatCurrency(
                      85000,
                      activeShop?.currency || 'VND'
                    ),
                    itemsSummary: tx(
                      '2x Cà phê sữa đá, 1x Bánh sừng bò',
                      '2x Iced Milk Coffee, 1x Croissant'
                    ),
                    shopName: activeShop?.name,
                    forceTest: true,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200"
              >
                <Volume2 className="h-4 w-4 text-emerald-600" />
                <span>{t('chime.testButton')}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsChimeModalOpen(false)}
                className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500"
              >
                {t('chime.saveAndTest')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thermal Receipt Print Modal */}
      {printingOrder && (
        <ReceiptPrintModal
          order={printingOrder}
          shop={activeShop}
          onClose={() => setPrintingOrder(null)}
          onConfirmPaid={
            canCollectPayment
              ? async (targetOrder) => {
                  const updated = await handleUpdateOrder(
                    targetOrder.id,
                    {
                      payment_status: 'paid',
                      status:
                        targetOrder.status === 'new'
                          ? 'preparing'
                          : targetOrder.status,
                    },
                    false
                  );
                  if (updated) {
                    setPrintingOrder(updated);
                  }
                }
              : undefined
          }
        />
      )}

      {confirmDialog}
    </div>
  );
}
