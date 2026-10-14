'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Sparkles,
  Minus,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import {
  CatalogItem,
  OrderStatus,
  PaymentMethod,
  ShopOrder,
} from '@/types/qlaok';
import { formatCurrency, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

// Synthesize a pleasant dual-tone POS counter chime using Web Audio API
function playOrderChime() {
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
      gain.gain.setValueAtTime(0.22, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + duration
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };

    playTone(659.25, 0, 0.18); // E5
    playTone(880, 0.18, 0.35); // A5
  } catch {
    // ignore audio autoplay restrictions
  }
}

export default function CounterOrdersPage() {
  const { activeShop } = useDashboard();
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<
    'active' | 'new' | 'preparing' | 'completed' | 'cancelled'
  >('active');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [qrOrderModal, setQrOrderModal] = useState<ShopOrder | null>(null);

  // Quick Counter POS Modal state
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const [posTableLabel, setPosTableLabel] = useState('Mang về / Tại quầy');
  const [posPaymentMethod, setPosPaymentMethod] =
    useState<PaymentMethod>('cash');
  const [posCart, setPosCart] = useState<
    Record<string, { item: CatalogItem; quantity: number }>
  >({});
  const [posSubmitting, setPosSubmitting] = useState(false);

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  const fetchOrdersAndCatalog = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      if (!silent) setLoading(true);
      try {
        const [ordersRes, catRes] = await Promise.all([
          fetch(`/api/orders?shopId=${encodeURIComponent(activeShop.id)}`, {
            cache: 'no-store',
          }),
          fetch(`/api/items?shopId=${encodeURIComponent(activeShop.id)}`, {
            cache: 'no-store',
          }),
        ]);

        if (ordersRes.ok) {
          const data = await ordersRes.json();
          const fetchedOrders: ShopOrder[] = data.orders || [];

          // Detect newly arrived orders to ring chime
          if (!isFirstLoadRef.current) {
            const hasBrandNew = fetchedOrders.some(
              (o) =>
                o.status === 'new' && !knownOrderIdsRef.current.has(o.id)
            );
            if (hasBrandNew && soundEnabled) {
              playOrderChime();
            }
          }

          knownOrderIdsRef.current = new Set(fetchedOrders.map((o) => o.id));
          isFirstLoadRef.current = false;
          setOrders(fetchedOrders);
        }

        if (catRes.ok) {
          const catData = await catRes.json();
          setCatalogItems(catData.items || []);
        }
      } catch (err) {
        console.error('Failed to fetch mPOS orders:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeShop, soundEnabled]
  );

  useEffect(() => {
    isFirstLoadRef.current = true;
    fetchOrdersAndCatalog(false);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.onmessage = (ev) => {
        if (
          ev.data?.type === 'new_order_submitted' &&
          ev.data?.shopId === activeShop?.id
        ) {
          if (soundEnabled) playOrderChime();
        }
        fetchOrdersAndCatalog(true);
      };
    }

    const interval = setInterval(() => {
      fetchOrdersAndCatalog(true);
    }, 3000);

    return () => {
      if (bc) bc.close();
      clearInterval(interval);
    };
  }, [fetchOrdersAndCatalog, activeShop?.id, soundEnabled]);

  const handleUpdateOrder = async (
    orderId: string,
    updates: {
      status?: OrderStatus;
      payment_status?: 'unpaid' | 'paid';
      payment_method?: PaymentMethod;
    }
  ) => {
    if (!activeShop) return;
    setUpdatingId(orderId);
    try {
      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: activeShop.id,
          order_id: orderId,
          ...updates,
        }),
      });
      if (res.ok) {
        await fetchOrdersAndCatalog(true);
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({ type: 'order_updated', shopId: activeShop.id });
          bc.close();
        }
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateCounterPosOrder = async () => {
    if (!activeShop || posSubmitting) return;
    const entries = Object.values(posCart).filter((e) => e.quantity > 0);
    if (entries.length === 0) return;

    setPosSubmitting(true);
    try {
      const payloadItems = entries.map(({ item, quantity }) => ({
        item_id: item.id,
        name_vi: item.name_i18n.vi,
        name_i18n: item.name_i18n,
        quantity,
        unit_price: item.price,
        extra_price: 0,
        selected_choices: [],
        custom_note: '',
        quick_tags: [],
      }));

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: activeShop.id,
          table_label: posTableLabel.trim() || 'Tại quầy',
          visitor_lang: 'vi',
          payment_method: posPaymentMethod,
          source: 'counter_pos',
          items: payloadItems,
        }),
      });

      if (res.ok) {
        setPosCart({});
        setIsPosModalOpen(false);
        await fetchOrdersAndCatalog(true);
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({ type: 'order_updated', shopId: activeShop.id });
          bc.close();
        }
      }
    } finally {
      setPosSubmitting(false);
    }
  };

  if (!activeShop) return null;

  const newOrders = orders.filter((o) => o.status === 'new');
  const preparingOrders = orders.filter((o) => o.status === 'preparing');
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const cancelledOrders = orders.filter((o) => o.status === 'cancelled');

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayRevenue = orders
    .filter(
      (o) => o.status !== 'cancelled' && o.created_at.startsWith(todayPrefix)
    )
    .reduce((sum, o) => sum + o.total_amount, 0);

  const filteredOrders = orders.filter((o) => {
    if (filterTab === 'active')
      return o.status === 'new' || o.status === 'preparing';
    return o.status === filterTab;
  });

  const posTotalAmount = Object.values(posCart).reduce(
    (sum, entry) => sum + entry.item.price * entry.quantity,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-slate-900 text-white p-5 sm:p-6 shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-3 py-1 text-[11px] font-bold text-emerald-300">
            <BellRing className="h-3.5 w-3.5 animate-bounce" />
            <span>Màn hình Quầy Thu Ngân &amp; Bếp (Realtime mPOS)</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight">
            Đơn Hàng Tại Bàn &amp; Quầy • {activeShop.name}
          </h1>
          <p className="text-xs text-slate-300">
            Khách quét QR tại bàn bấm gửi đơn sẽ tự động báo chuông và trừ số
            lượng tồn kho món ngay lập tức.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playOrderChime();
            }}
            className={`inline-flex items-center gap-1.5 rounded-2xl px-3.5 py-2.5 text-xs font-bold border transition-colors ${
              soundEnabled
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-400'
            }`}
          >
            {soundEnabled ? (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Chuông báo: BẬT</span>
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4" />
                <span>Chuông báo: TẮT</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsPosModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-sm hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            <span>Tạo đơn nhanh tại quầy (POS)</span>
          </button>

          <button
            type="button"
            onClick={() => fetchOrdersAndCatalog(false)}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2.5 text-slate-300 hover:text-white"
            title="Làm mới"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

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
              Đã hoàn tất
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {completedOrders.length} đơn
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Đã lên món &amp; thanh toán
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              Doanh thu hôm nay
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Banknote className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {formatCurrency(todayRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Tự động cộng khi có đơn
          </p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          {
            id: 'active',
            label: `Đang xử lý (${newOrders.length + preparingOrders.length})`,
          },
          { id: 'new', label: `Mới chờ nhận (${newOrders.length})` },
          { id: 'preparing', label: `Đang chế biến (${preparingOrders.length})` },
          { id: 'completed', label: `Đã hoàn tất (${completedOrders.length})` },
          { id: 'cancelled', label: `Đã hủy (${cancelledOrders.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              setFilterTab(
                tab.id as
                  | 'active'
                  | 'new'
                  | 'preparing'
                  | 'completed'
                  | 'cancelled'
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
                                ? 'Hoàn tất'
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
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {order.payment_status === 'paid'
                          ? '✓ Đã thu tiền'
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
                                    {line.selected_choices.map((c, cIdx) => (
                                      <span
                                        key={cIdx}
                                        className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900"
                                      >
                                        • {c.label_i18n?.vi}
                                      </span>
                                    ))}
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
                              payment_status: 'paid',
                            })
                          }
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Đã phục vụ &amp; Hoàn tất</span>
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === order.id}
                          onClick={() =>
                            handleUpdateOrder(order.id, { status: 'cancelled' })
                          }
                          className="inline-flex items-center justify-center gap-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                        >
                          <XCircle className="h-4 w-4" />
                          <span>Hủy</span>
                        </button>
                      </>
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* VietQR Table Bill Payment Modal */}
      {qrOrderModal && (
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
                Quét VietQR Thanh Toán Đơn Hàng
              </h3>
              <p className="text-xs text-slate-500">
                Số tiền và nội dung chuyển khoản đã điền sẵn tự động
              </p>
            </div>

            <div className="mx-auto w-56 h-56 rounded-2xl border border-slate-200 p-2 bg-white shadow-inner flex items-center justify-center">
              <img
                src={`https://img.vietqr.io/image/MB-0905123456-compact2.png?amount=${qrOrderModal.total_amount}&addInfo=${encodeURIComponent(`QLAOK ${qrOrderModal.order_code}`)}&accountName=${encodeURIComponent(activeShop.name)}`}
                alt="VietQR Order Payment"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="rounded-2xl bg-slate-50 p-3 text-xs space-y-1">
              <div className="flex justify-between">
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
                  QLAOK {qrOrderModal.order_code}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                await handleUpdateOrder(qrOrderModal.id, {
                  payment_status: 'paid',
                  payment_method: 'vietqr',
                  status: 'completed',
                });
                setQrOrderModal(null);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-500"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Xác nhận đã nhận tiền &amp; Hoàn tất đơn</span>
            </button>
          </div>
        </div>
      )}

      {/* Quick Counter POS Modal */}
      {isPosModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-5 sm:p-6 shadow-2xl max-h-[90vh] flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                  <span>Tạo Đơn Nhanh Tại Quầy (Counter mPOS)</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Dành cho khách gọi trực tiếp tại quầy thu ngân hoặc mua mang
                  về — tự động trừ tồn kho
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPosModalOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Bàn / Loại đơn
                </label>
                <input
                  type="text"
                  value={posTableLabel}
                  onChange={(e) => setPosTableLabel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Hình thức thanh toán
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPosPaymentMethod('cash')}
                    className={`rounded-xl py-2 text-xs font-bold border ${
                      posPaymentMethod === 'cash'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    💵 Tiền mặt
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosPaymentMethod('vietqr')}
                    className={`rounded-xl py-2 text-xs font-bold border ${
                      posPaymentMethod === 'vietqr'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    💳 Chuyển khoản QR
                  </button>
                </div>
              </div>
            </div>

            {/* Item Picker List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {catalogItems.map((item) => {
                const qty = posCart[item.id]?.quantity || 0;
                const stock = item.stock_quantity;
                const isSoldOut =
                  !item.is_available ||
                  (typeof stock === 'number' && stock <= 0);

                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between gap-3 rounded-2xl border p-3 ${
                      qty > 0
                        ? 'border-emerald-500 bg-emerald-50/40'
                        : 'border-slate-200 bg-white'
                    } ${isSoldOut ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                        {item.name_i18n.vi}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-bold text-emerald-600">
                          {formatCurrency(item.price, activeShop.currency)}
                        </span>
                        <span>•</span>
                        <span>
                          Tồn kho:{' '}
                          <strong className="text-slate-700">
                            {stock === null || stock === undefined
                              ? '∞'
                              : stock}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={qty <= 0}
                        onClick={() =>
                          setPosCart((prev) => ({
                            ...prev,
                            [item.id]: {
                              item,
                              quantity: Math.max(0, qty - 1),
                            },
                          }))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-xs font-black text-slate-900">
                        {qty}
                      </span>
                      <button
                        type="button"
                        disabled={
                          isSoldOut ||
                          (typeof stock === 'number' && qty >= stock)
                        }
                        onClick={() =>
                          setPosCart((prev) => ({
                            ...prev,
                            [item.id]: {
                              item,
                              quantity: qty + 1,
                            },
                          }))
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3">
              <div>
                <span className="block text-[11px] text-slate-500">
                  Tổng cộng tạm tính
                </span>
                <span className="text-lg font-black text-emerald-600">
                  {formatCurrency(posTotalAmount, activeShop.currency)}
                </span>
              </div>
              <button
                type="button"
                disabled={posTotalAmount <= 0 || posSubmitting}
                onClick={handleCreateCounterPosOrder}
                className="rounded-2xl bg-emerald-600 px-5 py-3 text-xs sm:text-sm font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
              >
                {posSubmitting
                  ? 'Đang tạo đơn...'
                  : 'Xác nhận Tạo Đơn & Trừ Tồn Kho'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
