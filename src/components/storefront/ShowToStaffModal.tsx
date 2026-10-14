'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Sparkles,
  Send,
  Clock,
  ChefHat,
  Loader2,
  Banknote,
  QrCode,
} from 'lucide-react';
import {
  CartSelection,
  PaymentMethod,
  Shop,
  ShopOrder,
  SupportedLocale,
} from '@/types/qlaok';
import { formatCurrency, LOCALE_META, tField, UI_LABELS } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

interface ShowToStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop;
  locale: SupportedLocale;
  cart: CartSelection[];
  initialTableLabel?: string;
  onUpdateQuantity: (index: number, delta: number) => void;
  onClearCart: () => void;
  onOrderCreated?: (order: ShopOrder) => void;
}

const SEND_ORDER_LABELS: Record<
  SupportedLocale,
  {
    sendBtn: string;
    sending: string;
    tablePrompt: string;
    notePlaceholder: string;
    trackerTitle: string;
    stepNew: string;
    stepPreparing: string;
    stepCompleted: string;
    orderMoreBtn: string;
  }
> = {
  vi: {
    sendBtn: '🚀 Gửi Đơn Xuống Quầy / Bếp Ngay',
    sending: 'Đang gửi đơn xuống quầy...',
    tablePrompt: 'Chọn Bàn / Vị trí ngồi:',
    notePlaceholder: 'Ghi chú chung cho quầy (VD: mang ra cùng lúc, xin thêm chén...)',
    trackerTitle: 'Trạng Thái Đơn Hàng Trực Tiếp (Realtime)',
    stepNew: 'Chờ quầy xác nhận',
    stepPreparing: 'Đang chuẩn bị / chế biến',
    stepCompleted: 'Đã phục vụ & Hoàn tất',
    orderMoreBtn: 'Đóng / Đặt thêm món khác',
  },
  en: {
    sendBtn: '🚀 Send Order to Counter Now',
    sending: 'Sending order to counter...',
    tablePrompt: 'Select Table / Seat:',
    notePlaceholder: 'Note for counter (e.g. extra napkins, serve together...)',
    trackerTitle: 'Live Order Status Tracker',
    stepNew: 'Sent to Counter',
    stepPreparing: 'Preparing / Cooking',
    stepCompleted: 'Served & Completed',
    orderMoreBtn: 'Close / Order More Items',
  },
  ko: {
    sendBtn: '🚀 카운터로 바로 주문 전송',
    sending: '주문을 전송하는 중...',
    tablePrompt: '테이블 / 좌석 번호 선택:',
    notePlaceholder: '요청사항 입력 (예: 앞접시 추가, 같이 서빙해주세요)',
    trackerTitle: '실시간 주문 진행 상태',
    stepNew: '주문 접수 대기',
    stepPreparing: '조리 및 준비 중',
    stepCompleted: '제공 및 완료',
    orderMoreBtn: '닫기 / 추가 주문하기',
  },
  ja: {
    sendBtn: '🚀 レジ・厨房へ注文を送信',
    sending: '注文を送信中...',
    tablePrompt: 'テーブル / 座席番号:',
    notePlaceholder: 'メモ（例：取り皿をお願いします、一緒に出してください）',
    trackerTitle: 'リアルタイム注文状況',
    stepNew: '受付待ち',
    stepPreparing: '調理・準備中',
    stepCompleted: '提供完了',
    orderMoreBtn: '閉じる / 追加注文する',
  },
  zh: {
    sendBtn: '🚀 立即发送订单到吧台/厨房',
    sending: '正在发送订单...',
    tablePrompt: '选择桌号 / 座位:',
    notePlaceholder: '备注（例如：多拿一个碗、一起上菜...）',
    trackerTitle: '实时订单状态追踪',
    stepNew: '等待吧台确认',
    stepPreparing: '正在制作/准备中',
    stepCompleted: '已上菜 / 已完成',
    orderMoreBtn: '关闭 / 继续加单',
  },
};

const QUICK_TABLES = ['Bàn 01', 'Bàn 02', 'Bàn 03', 'Bàn 05', 'Bàn 08', 'Mang về'];

export function ShowToStaffModal({
  isOpen,
  onClose,
  shop,
  locale,
  cart,
  initialTableLabel = 'Bàn 01',
  onUpdateQuantity,
  onClearCart,
  onOrderCreated,
}: ShowToStaffModalProps) {
  const [tableNumber, setTableNumber] = useState(initialTableLabel || 'Bàn 01');
  const [customerNote, setCustomerNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [activeOrder, setActiveOrder] = useState<ShopOrder | null>(null);

  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const orderText = SEND_ORDER_LABELS[locale] || SEND_ORDER_LABELS.vi;
  const visitorMeta = LOCALE_META[locale] || LOCALE_META.vi;

  useEffect(() => {
    if (initialTableLabel) {
      setTableNumber(initialTableLabel);
    }
  }, [initialTableLabel]);

  // Poll live order status when an order has been submitted
  useEffect(() => {
    if (!activeOrder) return;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/orders?orderId=${encodeURIComponent(activeOrder.id)}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.order) {
            setActiveOrder(data.order);
          }
        }
      } catch {
        // ignore network hiccup
      }
    };

    const interval = setInterval(poll, 2500);
    return () => clearInterval(interval);
  }, [activeOrder]);

  const grandTotal = cart.reduce((sum, entry) => {
    const extra = entry.selectedChoices.reduce(
      (s, c) => s + (c.extra_price || 0),
      0
    );
    return sum + (entry.item.price + extra) * entry.quantity;
  }, 0);

  const handleSubmitOrderToCounter = async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      const payloadItems = cart.map((entry) => {
        const extra = entry.selectedChoices.reduce(
          (s, c) => s + (c.extra_price || 0),
          0
        );
        return {
          item_id: entry.item.id,
          name_vi: entry.item.name_i18n.vi,
          name_i18n: entry.item.name_i18n,
          quantity: entry.quantity,
          unit_price: entry.item.price,
          extra_price: extra,
          selected_choices: entry.selectedChoices,
          custom_note: entry.customNote,
          quick_tags: entry.quickTags || [],
        };
      });

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          table_label: tableNumber.trim() || 'Bàn khách',
          visitor_lang: locale,
          customer_note: customerNote,
          payment_method: paymentMethod,
          source: 'qr_table',
          items: payloadItems,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể gửi đơn hàng xuống quầy');
      }

      const createdOrder: ShopOrder = data.order;
      setActiveOrder(createdOrder);
      onClearCart();
      if (onOrderCreated) {
        onOrderCreated(createdOrder);
      }

      // Broadcast instant notification to Counter mPOS tab
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({
          type: 'new_order_submitted',
          shopId: shop.id,
          orderId: createdOrder.id,
          orderCode: createdOrder.order_code,
          tableLabel: createdOrder.table_label,
          totalAmount: createdOrder.total_amount,
        });
        bc.close();
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Lỗi khi gửi đơn hàng'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-y-auto"
        >
          {/* High-Contrast Top Banner */}
          <div className="bg-emerald-500 text-slate-950 px-4 py-3.5 shadow-md">
            <div className="mx-auto max-w-md flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-emerald-400 font-black text-lg">
                  <FlagIcon locale={locale} className="h-5 w-7" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-black uppercase tracking-tight leading-tight">
                    {activeOrder
                      ? `${orderText.trackerTitle} • #${activeOrder.order_code}`
                      : labels.showToStaffHeader}
                  </h2>
                  <p className="text-xs font-bold text-slate-900 flex items-center gap-1 flex-wrap">
                    <span>{shop.name} • Khách (</span>
                    <FlagIcon locale={locale} className="h-3.5 w-5" />
                    <span>{visitorMeta.label})</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (activeOrder && cart.length > 0) {
                    setActiveOrder(null);
                  }
                  onClose();
                }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950/15 text-slate-950 hover:bg-slate-950/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* VIEW 1: LIVE ORDER TRACKER AFTER SUBMITTING */}
          {activeOrder && cart.length === 0 ? (
            <div className="mx-auto w-full max-w-md flex-1 px-4 py-6 space-y-5">
              <div className="rounded-3xl border-2 border-emerald-500/50 bg-slate-900 p-5 text-center space-y-3 shadow-xl">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <span className="inline-block rounded-full bg-amber-400 px-3 py-0.5 text-xs font-black text-slate-950">
                    {activeOrder.table_label} • #{activeOrder.order_code}
                  </span>
                  <h3 className="mt-2 text-lg font-black text-white">
                    {activeOrder.status === 'new'
                      ? orderText.stepNew
                      : activeOrder.status === 'preparing'
                        ? orderText.stepPreparing
                        : orderText.stepCompleted}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Quầy thu ngân &amp; bếp đã nhận thông báo tự động
                  </p>
                </div>

                {/* 3-Step Live Progress */}
                <div className="grid grid-cols-3 gap-2 pt-3">
                  <div
                    className={`rounded-2xl p-2.5 border text-center ${
                      activeOrder.status === 'new'
                        ? 'border-amber-400 bg-amber-400/15 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    }`}
                  >
                    <Clock className="mx-auto h-4 w-4 mb-1" />
                    <span className="block text-[10px] font-bold">
                      1. {orderText.stepNew}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl p-2.5 border text-center ${
                      activeOrder.status === 'preparing'
                        ? 'border-blue-400 bg-blue-500/20 text-blue-300'
                        : activeOrder.status === 'completed'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-slate-800 bg-slate-800/60 text-slate-500'
                    }`}
                  >
                    <ChefHat className="mx-auto h-4 w-4 mb-1" />
                    <span className="block text-[10px] font-bold">
                      2. {orderText.stepPreparing}
                    </span>
                  </div>
                  <div
                    className={`rounded-2xl p-2.5 border text-center ${
                      activeOrder.status === 'completed'
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                        : 'border-slate-800 bg-slate-800/60 text-slate-500'
                    }`}
                  >
                    <CheckCircle2 className="mx-auto h-4 w-4 mb-1" />
                    <span className="block text-[10px] font-bold">
                      3. {orderText.stepCompleted}
                    </span>
                  </div>
                </div>
              </div>

              {/* Submitted Order Items */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <span className="text-xs font-bold text-slate-400">
                    Chi tiết món đã gửi xuống quầy
                  </span>
                  <span className="text-sm font-black text-amber-400">
                    {formatCurrency(activeOrder.total_amount, shop.currency)}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {activeOrder.items.map((line, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-2 text-xs border-b border-slate-800/60 pb-2 last:border-none last:pb-0"
                    >
                      <div>
                        <span className="font-black text-emerald-400 mr-1.5">
                          x{line.quantity}
                        </span>
                        <span className="font-bold text-white">
                          {line.name_vi}
                        </span>
                        {locale !== 'vi' && line.name_i18n?.[locale] && (
                          <span className="block text-[11px] text-slate-400">
                            {line.name_i18n[locale]}
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-slate-200 shrink-0">
                        {formatCurrency(
                          (line.unit_price + line.extra_price) * line.quantity,
                          shop.currency
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg hover:bg-emerald-400"
              >
                <Sparkles className="h-4 w-4" />
                <span>{orderText.orderMoreBtn}</span>
              </button>
            </div>
          ) : (
            /* VIEW 2: CART REVIEW & SEND TO COUNTER FORM */
            <>
              <div className="mx-auto w-full max-w-md flex-1 px-4 py-4 space-y-4">
                {/* Table / Seat Selector */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-300">
                      📍 {orderText.tablePrompt}
                    </span>
                    <input
                      type="text"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      placeholder="VD: Bàn 05"
                      className="w-32 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-right text-xs font-black text-amber-400 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TABLES.map((tbl) => (
                      <button
                        key={tbl}
                        type="button"
                        onClick={() => setTableNumber(tbl)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                          tableNumber === tbl
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {tbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Method & General Note */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold border ${
                        paymentMethod === 'cash'
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-800 bg-slate-800/60 text-slate-400'
                      }`}
                    >
                      <Banknote className="h-4 w-4" />
                      <span>Tiền mặt (Cash)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('vietqr')}
                      className={`flex items-center justify-center gap-1.5 rounded-xl py-2 px-3 text-xs font-bold border ${
                        paymentMethod === 'vietqr'
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-800 bg-slate-800/60 text-slate-400'
                      }`}
                    >
                      <QrCode className="h-4 w-4" />
                      <span>Chuyển khoản QR</span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={customerNote}
                    onChange={(e) => setCustomerNote(e.target.value)}
                    placeholder={orderText.notePlaceholder}
                    className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {submitError && (
                  <div className="rounded-2xl border border-rose-500/50 bg-rose-500/15 p-3 text-xs font-bold text-rose-300">
                    ⚠️ {submitError}
                  </div>
                )}

                {cart.length === 0 ? (
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-10 text-center space-y-3">
                    <p className="text-base font-semibold text-slate-300">
                      Chưa có món / dịch vụ nào được chọn
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950"
                    >
                      Quay lại chọn món
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map((entry, index) => {
                      const extra = entry.selectedChoices.reduce(
                        (s, c) => s + (c.extra_price || 0),
                        0
                      );
                      const lineTotal =
                        (entry.item.price + extra) * entry.quantity;

                      return (
                        <div
                          key={`${entry.item.id}-${index}`}
                          className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4 shadow-lg"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black">
                                <span className="text-[10px] uppercase leading-none font-bold">
                                  SL
                                </span>
                                <span className="text-xl leading-tight">
                                  x{entry.quantity}
                                </span>
                              </div>

                              <div className="space-y-1">
                                <h3 className="text-base sm:text-lg font-black text-white leading-snug">
                                  {entry.item.name_i18n.vi}
                                </h3>

                                {locale !== 'vi' && (
                                  <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                                    <FlagIcon
                                      locale={locale}
                                      className="h-3.5 w-5"
                                    />
                                    <span>
                                      {tField(entry.item.name_i18n, locale)}
                                    </span>
                                  </p>
                                )}

                                {entry.selectedChoices.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    {entry.selectedChoices.map((c) => (
                                      <span
                                        key={c.id}
                                        className="rounded-lg bg-amber-400/20 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-amber-300"
                                      >
                                        • {c.label_i18n.vi}
                                        {locale !== 'vi' &&
                                          c.label_i18n[locale] &&
                                          ` (${c.label_i18n[locale]})`}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {entry.quickTags &&
                                  entry.quickTags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                      {entry.quickTags.map((tagVi, idx) => (
                                        <span
                                          key={idx}
                                          className="rounded-lg bg-rose-500/20 border border-rose-400/40 px-2.5 py-0.5 text-xs font-bold text-rose-300"
                                        >
                                          ⚠️ {tagVi}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                {entry.customNote && (
                                  <p className="mt-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-amber-200">
                                    📝 Ghi chú: &ldquo;{entry.customNote}&rdquo;
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-base font-black text-emerald-400">
                                {formatCurrency(lineTotal, shop.currency)}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                            <span className="text-[11px] text-slate-400">
                              Đơn giá:{' '}
                              {formatCurrency(
                                entry.item.price + extra,
                                shop.currency
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onUpdateQuantity(index, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="w-5 text-center text-xs font-bold">
                                {entry.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => onUpdateQuantity(index, 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Sticky Footer: Send Order to Counter Button */}
              {cart.length > 0 && (
                <div className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-md">
                  <div className="mx-auto max-w-md space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-slate-400">
                          {labels.totalEstimated} ({tableNumber})
                        </p>
                        <p className="text-2xl font-black text-amber-400">
                          {formatCurrency(grandTotal, shop.currency)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onClearCart();
                          onClose();
                        }}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        <span>{labels.clearSelection}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleSubmitOrderToCounter}
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-4 text-sm sm:text-base font-black text-slate-950 shadow-xl hover:bg-emerald-400 active:scale-98 disabled:opacity-60"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span>{orderText.sending}</span>
                        </>
                      ) : (
                        <>
                          <Send className="h-5 w-5" />
                          <span>{orderText.sendBtn}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
