'use client';

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
  ShopMembership,
  ShopOrder,
} from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { ReceiptPrintModal } from '@/components/dashboard/ReceiptPrintModal';
import { PosCounterWorkspace } from '@/components/dashboard/PosCounterWorkspace';
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
} from '@/lib/order-chime';

function getVnDateKey(dateInput: Date | string | number = new Date()): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export default function CounterOrdersPage() {
  const { activeShop } = useDashboard();
  const [liveStatus, setLiveStatus] = useState<OrderLiveStatus>('connecting');
  const scopeRef = useRef({ shopId: activeShop?.id });
  if (scopeRef.current.shopId !== activeShop?.id) scopeRef.current = { shopId: activeShop?.id };
  const inFlight = useRef<{ scope: object; again: boolean; catalog: boolean } | null>(null);
  const disposedRef = useRef(false);
  useEffect(() => { disposedRef.current = false; return () => { disposedRef.current = true; }; }, []);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
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

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
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
      const savedMode = sessionStorage.getItem('qlaok_pos_workspace_mode');
      if (savedMode === 'pos_terminal' || savedMode === 'kitchen_orders') {
        setWorkspaceMode(savedMode);
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
      sessionStorage.setItem('qlaok_pos_workspace_mode', mode);
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
      const shopId = activeShop.id;
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
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          if (disposedRef.current || scopeRef.current !== scope) return;
          const fetchedOrders: ShopOrder[] = data.orders || [];
          if (Array.isArray(data.items)) setCatalogItems(data.items);
          if (data.membership) {
            setMembership(data.membership as ShopMembership);
          }

          // Detect newly arrived orders to ring chime & push Windows notification
          if (!isFirstLoadRef.current) {
            const brandNewOrder = fetchedOrders.find(
              (o) =>
                o.status === 'new' && !knownOrderIdsRef.current.has(o.id)
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
                        `${it.quantity}x ${it.name_vi || 'Món'}`
                    )
                    .join(', ')
                : undefined;
              sendBrowserOrderNotification({
                orderCode: brandNewOrder.order_code || 'MỚI',
                tableLabel: brandNewOrder.table_label || 'Tại quầy',
                totalFormatted: formatCurrency(
                  Number(brandNewOrder.total_amount) || 0,
                  activeShop.currency
                ),
                itemsSummary,
                shopName: activeShop.name,
              });
            }
          }

          knownOrderIdsRef.current = new Set(fetchedOrders.map((o) => o.id));
          isFirstLoadRef.current = false;
          setOrders(fetchedOrders);
        }

        if (catRes?.ok) {
          const catData = await catRes.json();
          if (disposedRef.current || scopeRef.current !== scope) return;
          setCatalogCategories(catData.categories || []);
          setCatalogItems(catData.items || []);
        }
      } catch (err) {
        console.error('Failed to fetch mPOS orders:', err);
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
    setOrders([]); setCatalogItems([]); setCatalogCategories([]); setMembership(null);
    if (!activeShop?.id) return;
    void fetchOrdersAndCatalog(false);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        if (
          ev.data?.type === 'new_order_submitted' &&
          ev.data?.shopId === activeShop?.id
        ) {
          const latestChime = loadOrderChimeSettings();
          chimeSettingsRef.current = latestChime;
          if (latestChime.enabled) {
            playOrderAlertChime(
              latestChime,
              ev.data?.tableLabel || 'Khách mới',
              ev.data?.orderCode
            );
          }
          if (ev.data?.orderCode) {
            sendBrowserOrderNotification({
              orderCode: ev.data.orderCode,
              tableLabel: ev.data.tableLabel || 'Tại quầy',
              totalFormatted: formatCurrency(
                Number(ev.data.totalAmount || ev.data.totalVnd) || 0,
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
  }, [fetchOrdersAndCatalog, activeShop?.id, activeShop?.name]);

  // Repeating reminder chime every 10 seconds if there are unaccepted 'new' orders and remindUntilAccepted is enabled
  useEffect(() => {
    const pendingNewOrders = orders.filter((o) => o.status === 'new');
    if (
      !chimeSettings.enabled ||
      !chimeSettings.remindUntilAccepted ||
      pendingNewOrders.length === 0
    ) {
      return;
    }

    const reminderTimer = setInterval(() => {
      const latestChime = loadOrderChimeSettings();
      if (latestChime.enabled && latestChime.remindUntilAccepted) {
        playOrderAlertChime(
          latestChime,
          pendingNewOrders[0]?.table_label
        );
      }
    }, 10000);

    return () => clearInterval(reminderTimer);
  }, [orders, chimeSettings.enabled, chimeSettings.remindUntilAccepted]);

  const handleUpdateOrder = async (
    orderId: string,
    updates: {
      status?: OrderStatus;
      payment_status?: OrderPaymentStatus;
      payment_method?: PaymentMethod;
      restock_items?: boolean;
      refund_reason?: string;
    },
    forcePrint = false
  ): Promise<ShopOrder | null> => {
    if (!activeShop) return null;
    setUpdatingId(orderId);
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
      const error = await res.json().catch(() => null);
      window.alert(error?.error || 'Không thể cập nhật đơn hàng');
      return null;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Không thể cập nhật đơn hàng');
      return null;
    } finally {
      setUpdatingId(null);
    }
  };

  const canCollectPayment =
    !membership || membership.permissions.includes('payment.collect');
  const canViewReports =
    !membership || membership.permissions.includes('reports.view');
  const canRefundOrder =
    !membership || membership.permissions.includes('payment.refund');

  if (!activeShop) return null;

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

  return (
    <div className="space-y-4">
      {/* Header Banner + Mode Switcher (POS Terminal vs Kitchen/Table Orders) */}
      <div className="rounded-3xl bg-slate-900 text-white p-4 sm:p-5 shadow-md space-y-3.5">
        {/* Top Row: Title & Revenue Summary + Primary Mode Switcher */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-black tracking-tight text-white">
              {workspaceMode === 'pos_terminal'
                ? `Máy POS Thu Ngân Tại Quầy • ${activeShop.name}`
                : `Đơn Hàng Tại Bàn & Quầy • ${activeShop.name}`}
            </h1>
            <p className="text-xs text-slate-300 mt-0.5">
              {canViewReports ? (
                <>
                  Doanh thu đã thu hôm nay:{' '}
                  <strong className="text-emerald-400 font-black">
                    {formatCurrency(todayRevenue, activeShop.currency)}
                  </strong>{' '}
                  •{' '}
                </>
              ) : null}
              Hoàn tất &amp; đã thu: <strong className="text-white">{completedOrders.length} đơn</strong>
            </p>
          </div>

          {/* Primary Workspace Mode Tabs */}
          <div className="inline-flex flex-wrap rounded-2xl bg-slate-800 p-1 border border-slate-700 shrink-0 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => switchWorkspaceMode('pos_terminal')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all ${
                workspaceMode === 'pos_terminal'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Monitor className="h-4 w-4 shrink-0" />
              <span>Màn Hình POS Bán Hàng Tại Quầy</span>
            </button>

            <button
              type="button"
              onClick={() => switchWorkspaceMode('kitchen_orders')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition-all ${
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
                Đơn Bàn &amp; Quầy ({todayValidOrders.length} đơn hôm nay)
              </span>
              {newOrders.length > 0 && (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
                  {newOrders.length} mới
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
              className={`inline-flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-xs font-bold border transition-colors ${
                autoPrintOnPay
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400'
              }`}
              title="Tự động bật cửa sổ in hóa đơn ngay sau khi xác nhận thanh toán"
            >
              <Printer className="h-4 w-4" />
              <span>In bill khi thu tiền: {autoPrintOnPay ? 'BẬT' : 'TẮT'}</span>
            </button>

            <div className="inline-flex items-center rounded-2xl border border-emerald-500/40 bg-slate-800/90 p-0.5">
              <button
                type="button"
                onClick={() => {
                  const nextEnabled = !chimeSettings.enabled;
                  const next = { ...chimeSettings, enabled: nextEnabled };
                  updateChimeSettings({ enabled: nextEnabled });
                  if (nextEnabled) playOrderAlertChime(next, 'Bàn 01');
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  chimeSettings.enabled
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {chimeSettings.enabled ? (
                  <>
                    <Volume2 className="h-4 w-4 text-emerald-400" />
                    <span>
                      Chuông:{' '}
                      {CHIME_SOUND_OPTIONS.find(
                        (o) => o.id === chimeSettings.soundId
                      )?.label.replace(/^[^\s]+\s/, '') || 'Đã bật'}{' '}
                      •{' '}
                      {chimeSettings.volumePreset === 'max_boost'
                        ? 'SIÊU TO'
                        : chimeSettings.volumePreset === 'loud'
                          ? 'TO'
                          : 'VỪA'}
                    </span>
                  </>
                ) : (
                  <>
                    <VolumeX className="h-4 w-4" />
                    <span>Chuông: TẮT</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsChimeModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-slate-700/80 px-2.5 py-1.5 text-[11px] font-black text-amber-300 hover:bg-slate-700"
                title="Đổi kiểu chuông báo, kích âm lượng lớn & bật thông báo đẩy Windows"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Kiểu chuông &amp; TB Windows</span>
              </button>
            </div>

            <Link
              href="/dashboard/reports"
              className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-black text-emerald-300 hover:bg-emerald-500/25 transition"
            >
              <span>📊 Sổ đơn &amp; Xuất Excel/CSV</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span role="status" className="text-xs font-semibold text-slate-500">
              {liveStatus === 'connected' ? '● Trực tiếp' : liveStatus === 'unauthorized' ? 'Phiên đăng nhập cần kiểm tra lại' : 'Đồng bộ dự phòng'}
            </span>
            {workspaceMode === 'kitchen_orders' && (
              <button
                type="button"
                onClick={() => switchWorkspaceMode('pos_terminal')}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 shadow-sm hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                <span>Tạo đơn nhanh tại quầy (POS)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchOrdersAndCatalog(false)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
              title="Làm mới"
            >
              <RefreshCw className="h-4 w-4" />
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
              Có {newOrders.length} đơn khách gọi tại bàn qua QR đang chờ xác
              nhận báo bếp!
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
            Xem &amp; Nhận đơn ngay →
          </button>
        </div>
      )}

      {/* MODE 1: DEDICATED SPLIT-SCREEN COUNTER POS TERMINAL */}
      {workspaceMode === 'pos_terminal' ? (
        <PosCounterWorkspace
          shop={activeShop}
          categories={catalogCategories}
          items={catalogItems}
          orders={orders}
          editingOrder={editingOrder}
          onCancelEditOrder={() => setEditingOrder(null)}
          autoPrintOnPay={autoPrintOnPay}
          onPrintOrder={(ord) => setPrintingOrder(ord)}
          onUpdateOrder={(id, up) => handleUpdateOrder(id, up)}
          onOrderCreated={async (createdOrder, shouldPrint) => {
            setEditingOrder(null);
            await fetchOrdersAndCatalog(true);
            if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
              const bc = new BroadcastChannel('qlaok_realtime_sync');
              bc.postMessage({ type: 'order_updated', shopId: activeShop.id });
              bc.close();
            }
            if (shouldPrint) {
              setPrintingOrder(createdOrder);
            }
          }}
        />
      ) : (
        <>

      {/* 4 Live Counter KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl bg-white border-2 border-amber-300 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">
              Chờ xác nhận (Mới)
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {newOrders.length} đơn
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Cần xác nhận báo bếp ngay
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-blue-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-700">
              Đang chế biến / làm
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <ChefHat className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {preparingOrders.length} đơn
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Đang phục vụ tại bàn
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-emerald-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">
              Đơn trong ngày / Hoàn tất
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {todayValidOrders.length} đơn hôm nay
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Đã hoàn tất / thu tiền: {completedOrders.length} đơn
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              Doanh thu đã thu hôm nay
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Banknote className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {canViewReports
              ? formatCurrency(todayRevenue, activeShop.currency)
              : '🔒 Chỉ Chủ quán / Thu ngân'}
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Chỉ tính đơn đã xác nhận thu tiền
          </p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          {
            id: 'today',
            label: `Đơn hôm nay (${todayValidOrders.length})`,
          },
          {
            id: 'active',
            label: `Đang xử lý (${activeOrders.length})`,
          },
          { id: 'new', label: `Mới chờ nhận (${newOrders.length})` },
          { id: 'preparing', label: `Đang chế biến (${preparingOrders.length})` },
          {
            id: 'completed',
            label: `Đã hoàn tất (${orders.filter((o) => o.status === 'completed').length})`,
          },
          { id: 'cancelled', label: `Đã hủy (${cancelledOrders.length})` },
          { id: 'all', label: `Tất cả lịch sử (${orders.length})` },
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
        <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center text-xs font-semibold text-slate-500">
          Đang tải danh sách đơn hàng mPOS...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <ShoppingBag className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-800">
            Không có đơn hàng nào trong mục này
          </p>
          <p className="text-xs text-slate-500">
            Khi khách quét mã QR tại bàn và bấm gửi đơn, phiếu gọi món sẽ hiện
            ngay tại đây.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredOrders.map((order) => {
            const visitorMeta =
              LOCALE_META[order.visitor_lang] || LOCALE_META.vi;
            const isNew = order.status === 'new';
            const isPreparing = order.status === 'preparing';
            const isCompleted = order.status === 'completed';
            const isCancelled = order.status === 'cancelled';

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
                            ? 'Mới chờ nhận'
                            : isPreparing
                              ? 'Đang chế biến'
                              : isCompleted
                                ? 'Đã phục vụ'
                                : 'Đã hủy'}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <FlagIcon
                            locale={order.visitor_lang}
                            className="h-3.5 w-5"
                          />
                          <span>Khách {visitorMeta.label}</span>
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(order.created_at).toLocaleTimeString(
                            'vi-VN',
                            {
                              hour: '2-digit',
                              minute: '2-digit',
                            }
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          {order.source === 'counter_pos'
                            ? '🖥️ Tạo tại quầy'
                            : '📱 Khách quét QR'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-base font-black text-emerald-600">
                        {formatCurrency(order.total_amount, activeShop.currency)}
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
                          ? '✓ Đã thu tiền'
                          : order.payment_status === 'refunded'
                            ? '↩ Đã hoàn tiền'
                            : 'Chưa thu tiền'}{' '}
                        ({order.payment_method === 'vietqr' ? 'VietQR' : 'Tiền mặt'})
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
                                {line.name_vi}
                              </p>
                              {line.selected_choices &&
                                line.selected_choices.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {line.selected_choices.map((c, cIdx) => {
                                      const label =
                                        typeof c === 'string'
                                          ? c
                                          : c.label_vi || c.label_i18n?.vi || '';
                                      if (!label) return null;
                                      return (
                                        <span
                                          key={cIdx}
                                          className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900"
                                        >
                                          • {label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              {line.quick_tags && line.quick_tags.length > 0 && (
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
                      💬 Ghi chú bàn: &ldquo;{order.customer_note}&rdquo;
                    </div>
                  )}
                </div>

                {/* Action Buttons Footer */}
                {!isCancelled && (
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    {order.payment_status === 'unpaid' && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditOrderInPos(order)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-amber-400 bg-amber-100 px-3.5 py-2.5 text-xs font-black text-amber-950 shadow-2xs hover:bg-amber-200 transition"
                        title="Mở giao diện mPOS để thêm/bớt món, đổi Option của đơn này trước khi thanh toán"
                      >
                        <Edit3 className="h-4 w-4 text-amber-700" />
                        <span>Sửa đơn / Sửa món (Mở mPOS)</span>
                      </button>
                    )}

                    {isNew && (
                      <>
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, { status: 'preparing' })
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-blue-500 disabled:opacity-50"
                        >
                          <ChefHat className="h-4 w-4" />
                          <span>Nhận đơn &amp; Báo bếp</span>
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, { status: 'cancelled' })
                          }
                          className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>Hủy</span>
                        </button>
                      </>
                    )}

                    {isPreparing && (
                      <>
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, {
                              status: 'completed',
                            })
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-blue-500 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Đã phục vụ</span>
                        </button>
                        {order.payment_status === 'unpaid' && canCollectPayment && (
                          <button
                            type="button"
                            disabled={updatingId === order.id}
                            onClick={() =>
                              handleUpdateOrder(order.id, {
                                payment_status: 'paid',
                              })
                            }
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <Banknote className="h-4 w-4" />
                            <span>Xác nhận đã thu tiền</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, {
                              status: 'cancelled',
                              restock_items: false,
                            })
                          }
                          className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>Hủy</span>
                        </button>
                      </>
                    )}

                    {isCompleted &&
                      order.payment_status === 'unpaid' &&
                      canCollectPayment && (
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, {
                              payment_status: 'paid',
                            })
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Banknote className="h-4 w-4" />
                          <span>Xác nhận đã thu tiền</span>
                        </button>
                      )}

                    {order.payment_status === 'paid' && canRefundOrder && (
                      <button
                        type="button"
                        disabled={updatingId === order.id}
                        onClick={() =>
                          handleUpdateOrder(order.id, {
                            payment_status: 'refunded',
                            refund_reason: 'Hoàn tiền tại quầy',
                          })
                        }
                        className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        <span>Hoàn tiền</span>
                      </button>
                    )}

                    {order.payment_status === 'unpaid' && (
                      <button
                        type="button"
                        onClick={() => setQrOrderModal(order)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200"
                      >
                        <QrCode className="h-4 w-4 text-emerald-600" />
                        <span>Mã VietQR</span>
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
                          ? 'In hóa đơn'
                          : 'In bill tạm tính'}
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
                    className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Quét Mã QR Thanh Toán Đơn Hàng
                  </h3>
                  <p className="text-xs text-slate-500">
                    {qrInfo.mode === 'custom_qr'
                      ? 'Mã QR thanh toán do quán cài đặt'
                      : 'Số tiền và nội dung chuyển khoản đã điền sẵn tự động'}
                  </p>
                </div>

                {!qrInfo.isConfigured || !qrInfo.qrImageUrl ? (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-xs font-bold text-amber-900 space-y-2">
                    <p>
                      ⚠️ Quán chưa cài đặt Số Tài Khoản / Mã QR nhận tiền thật.
                      Hệ thống đã chặn hiển thị QR mặc định để tránh chuyển nhầm
                      tài khoản.
                    </p>
                    <Link
                      href="/dashboard/settings#payment-qr-settings"
                      className="inline-block underline font-black text-emerald-700"
                    >
                      Cài đặt tài khoản ngân hàng ngay →
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
                    <span className="text-slate-500">Ngân hàng / Ví:</span>
                    <span className="font-bold text-slate-900">
                      {qrInfo.bankShortName}
                    </span>
                  </div>
                  {qrInfo.accountNumber && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Số tài khoản:</span>
                      <span className="font-mono font-black text-slate-900">
                        {qrInfo.accountNumber}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Chủ tài khoản:</span>
                    <span className="font-bold text-slate-900 uppercase">
                      {qrInfo.accountName}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200/80">
                    <span className="text-slate-500">Tổng thanh toán:</span>
                    <span className="font-black text-emerald-600 text-sm">
                      {formatCurrency(
                        qrOrderModal.total_amount,
                        activeShop.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Nội dung CK:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {qrInfo.transferContent}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {canCollectPayment && (
                    <button
                      type="button"
                      onClick={async () => {
                        const targetOrder = qrOrderModal;
                        setQrOrderModal(null);
                        await handleUpdateOrder(
                          targetOrder.id,
                          {
                            payment_status: 'paid',
                            payment_method: 'vietqr',
                          },
                          true
                        );
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Xác nhận đã nhận tiền &amp; In hóa đơn</span>
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
                    <span>In phiếu tạm tính kèm mã QR cho khách</span>
                  </button>

                  <Link
                    href="/dashboard/settings#payment-qr-settings"
                    className="inline-flex items-center justify-center gap-1 pt-1 text-[11px] font-bold text-slate-500 hover:text-emerald-600"
                  >
                    <Settings className="h-3 w-3" />
                    <span>Đổi Số Tài Khoản / Mã QR trong Cài đặt quán</span>
                  </Link>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Chime Sound & Volume Booster Settings Modal */}
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
                    Cài Đặt Chuông Báo Đơn Mới &amp; Khuếch Đại Âm Lượng
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tùy chỉnh kiểu chuông, giọng đọc Tiếng Việt và kích âm lượng
                    cực đại cho quán đông
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsChimeModalOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 1. Master Volume / Loudness Boost */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wide text-slate-700">
                1. Độ lớn âm lượng (Khuếch đại âm thanh):
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'normal',
                      title: '🔈 Vừa (100%)',
                      sub: 'Quán yên tĩnh',
                    },
                    {
                      id: 'loud',
                      title: '🔉 To (150%)',
                      sub: 'Quầy thu ngân',
                    },
                    {
                      id: 'max_boost',
                      title: '🔊 CỰC ĐẠI (300%)',
                      sub: 'Quán đông / Bếp ồn',
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
                        playOrderAlertChime(next, 'Bàn 01');
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
                2. Chọn kiểu chuông báo / Giọng đọc:
              </label>
              <div className="space-y-2">
                {CHIME_SOUND_OPTIONS.map((opt) => {
                  const active = chimeSettings.soundId === opt.id;
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
                        playOrderAlertChime(next, 'Bàn 02');
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
                            {opt.label}
                          </span>
                          {opt.badge && (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                              {opt.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {opt.desc}
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
                            'Bàn 05'
                          );
                        }}
                        className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Nghe thử</span>
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
                  Số hồi chuông đổ mỗi lần có đơn:
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
                      {cnt} hồi
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
                    🔁 Tự động đổ chuông nhắc lại mỗi 10 giây khi còn đơn Mới chưa
                    nhận
                  </span>
                  <span className="text-slate-500 text-[11px]">
                    Đảm bảo nhân viên không bao giờ bỏ sót đơn khách đặt qua QR
                    khi đang bận pha chế
                  </span>
                </div>
              </label>

              {/* 4. Native Browser / Windows OS Desktop Notification */}
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
                        🖥️ Đẩy thông báo ra màn hình Windows / Mac (Kết hợp với
                        hộp thoại trên web)
                      </span>
                      <span className="text-slate-500 text-[11px]">
                        Hiển thị popup thông báo gốc của Windows ở góc dưới màn
                        hình ngay cả khi thu nhỏ trình duyệt hoặc đang mở phần
                        mềm khác
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
                            tableLabel: 'Bàn 02 (Thử thông báo)',
                            totalFormatted: formatCurrency(
                              125000,
                              activeShop?.currency || 'VND'
                            ),
                            itemsSummary: '2x Phở Bò Tái Lăn, 1x Trà Đào',
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
                        ? '✓ Đã cấp quyền (Bấm test)'
                        : browserNotifPerm === 'denied'
                          ? 'Bị chặn trên trình duyệt'
                          : 'Bật quyền TB Windows'}
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
                  playOrderAlertChime(testConfig, 'Bàn 01');
                  if (browserNotifPerm === 'default') {
                    const perm = await requestBrowserNotificationPermission();
                    setBrowserNotifPerm(perm);
                  }
                  sendBrowserOrderNotification({
                    orderCode: 'TEST-01',
                    tableLabel: 'Bàn 01',
                    totalFormatted: formatCurrency(
                      85000,
                      activeShop?.currency || 'VND'
                    ),
                    itemsSummary: '2x Cà phê sữa đá, 1x Bánh sừng bò',
                    shopName: activeShop?.name,
                    forceTest: true,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-200"
              >
                <Volume2 className="h-4 w-4 text-emerald-600" />
                <span>Test Chuông + Đẩy TB Windows</span>
              </button>
              <button
                type="button"
                onClick={() => setIsChimeModalOpen(false)}
                className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500"
              >
                Lưu &amp; Đóng
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
    </div>
  );
}
