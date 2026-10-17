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
  ShoppingBag,
  Edit3,
} from 'lucide-react';
import {
  CartSelection,
  PaymentMethod,
  Shop,
  ShopOrder,
  SupportedLocale,
} from '@/types/qlaok';
import {
  formatCurrency,
  formatTableLabel,
  LOCALE_META,
  QUICK_TAGS_BY_VERTICAL,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import {
  calculateOrderPromoDiscount,
  PROMO_LOCALE_TEXT,
} from '@/components/storefront/StorefrontCustomDecor';

interface ShowToStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop;
  locale: SupportedLocale;
  cart: CartSelection[];
  initialTableLabel?: string;
  activeOrderProp?: ShopOrder | null;
  editingOrder?: ShopOrder | null;
  onEditOrder?: (order: ShopOrder) => void;
  onCancelEditOrder?: () => void;
  onUpdateQuantity: (index: number, delta: number) => void;
  onClearCart: () => void;
  onOrderCreated?: (order: ShopOrder) => void;
}

const SEND_ORDER_LABELS: Record<
  SupportedLocale,
  {
    sendBtn: string;
    updateBtn: string;
    editOrderBtn: string;
    sending: string;
    tablePrompt: string;
    tableInputPlaceholder: string;
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
    updateBtn: '💾 Lưu Cập Nhật Đơn Hàng',
    editOrderBtn: '✏️ Sửa đơn / Đổi hoặc thêm món',
    sending: 'Đang gửi đơn xuống quầy...',
    tablePrompt: 'Chọn Bàn / Vị trí ngồi:',
    tableInputPlaceholder: 'Nhập số bàn khác (VD: Bàn 12, Phòng VIP 2...)',
    notePlaceholder: 'Ghi chú chung cho quầy (VD: mang ra cùng lúc, xin thêm chén...)',
    trackerTitle: 'Trạng Thái Đơn Hàng Trực Tiếp (Realtime)',
    stepNew: 'Chờ quầy xác nhận',
    stepPreparing: 'Đang chuẩn bị / chế biến',
    stepCompleted: 'Đã phục vụ & Hoàn tất',
    orderMoreBtn: 'Đóng / Xem thêm thực đơn',
  },
  en: {
    sendBtn: '🚀 Send Order to Counter Now',
    updateBtn: '💾 Save Order Changes',
    editOrderBtn: '✏️ Edit Order / Change Items',
    sending: 'Sending order to counter...',
    tablePrompt: 'Select Table / Seat:',
    tableInputPlaceholder: 'Or enter table / room number (e.g. Table 12, VIP 2...)',
    notePlaceholder: 'Note for counter (e.g. extra napkins, serve together...)',
    trackerTitle: 'Live Order Status Tracker',
    stepNew: 'Sent to Counter',
    stepPreparing: 'Preparing / Cooking',
    stepCompleted: 'Served & Completed',
    orderMoreBtn: 'Close / Browse Menu',
  },
  ko: {
    sendBtn: '🚀 카운터로 바로 주문 전송',
    updateBtn: '💾 주문 변경사항 저장',
    editOrderBtn: '✏️ 주문 수정 / 메뉴 변경·추가',
    sending: '주문을 전송하는 중...',
    tablePrompt: '테이블 / 좌석 번호 선택:',
    tableInputPlaceholder: '다른 테이블 번호 직접 입력 (예: 테이블 12, VIP 2...)',
    notePlaceholder: '요청사항 입력 (예: 앞접시 추가, 같이 서빙해주세요)',
    trackerTitle: '실시간 주문 진행 상태',
    stepNew: '주문 접수 대기',
    stepPreparing: '조리 및 준비 중',
    stepCompleted: '제공 및 완료',
    orderMoreBtn: '닫기 / 메뉴 더 보기',
  },
  ja: {
    sendBtn: '🚀 レジ・厨房へ注文を送信',
    updateBtn: '💾 注文の変更を保存',
    editOrderBtn: '✏️ 注文内容を変更・追加する',
    sending: '注文を送信中...',
    tablePrompt: 'テーブル / 座席番号:',
    tableInputPlaceholder: 'その他のテーブル番号を入力（例：テーブル 12、VIP 2）',
    notePlaceholder: 'メモ（例：取り皿をお願いします、一緒に出してください）',
    trackerTitle: 'リアルタイム注文状況',
    stepNew: '受付待ち',
    stepPreparing: '調理・準備中',
    stepCompleted: '提供完了',
    orderMoreBtn: '閉じる / メニューを見る',
  },
  zh: {
    sendBtn: '🚀 立即发送订单到吧台/厨房',
    updateBtn: '💾 保存订单修改',
    editOrderBtn: '✏️ 修改订单 / 增减菜品',
    sending: '正在发送订单...',
    tablePrompt: '选择桌号 / 座位:',
    tableInputPlaceholder: '或输入其他桌号/包厢（如：12号桌、VIP 2）',
    notePlaceholder: '备注（例如：多拿一个碗、一起上菜...）',
    trackerTitle: '实时订单状态追踪',
    stepNew: '等待吧台确认',
    stepPreparing: '正在制作/准备中',
    stepCompleted: '已上菜 / 已完成',
    orderMoreBtn: '关闭 / 返回菜单',
  },
  es: {
    sendBtn: '🚀 Enviar Pedido a Cocina Ahora',
    updateBtn: '💾 Guardar Cambios del Pedido',
    editOrderBtn: '✏️ Editar Pedido / Cambiar Platos',
    sending: 'Enviando pedido al mostrador...',
    tablePrompt: 'Selecciona Mesa / Ubicación:',
    tableInputPlaceholder: 'O escribe otro número de mesa (ej. Mesa 12, VIP 2...)',
    notePlaceholder: 'Nota para el mostrador (ej. servilletas extra, servir todo junto...)',
    trackerTitle: 'Estado del Pedido en Tiempo Real',
    stepNew: 'Enviado al mostrador',
    stepPreparing: 'En preparación / cocina',
    stepCompleted: 'Servido y completado',
    orderMoreBtn: 'Cerrar / Ver Menú',
  },
  it: {
    sendBtn: '🚀 Invia Ordine in Cucina Ora',
    updateBtn: '💾 Salva Modifiche Ordine',
    editOrderBtn: '✏️ Modifica Ordine / Cambia Piatti',
    sending: 'Invio ordine in corso...',
    tablePrompt: 'Seleziona Tavolo / Posto:',
    tableInputPlaceholder: 'Oppure inserisci numero tavolo (es. Tavolo 12, VIP 2...)',
    notePlaceholder: 'Nota per la cassa (es. tovaglioli extra, servire insieme...)',
    trackerTitle: 'Stato Ordine in Tempo Reale',
    stepNew: 'Inviato alla cassa',
    stepPreparing: 'In preparazione / cottura',
    stepCompleted: 'Servito e completato',
    orderMoreBtn: 'Chiudi / Torna al Menu',
  },
  ru: {
    sendBtn: '🚀 Отправить заказ на кухню',
    updateBtn: '💾 Сохранить изменения заказа',
    editOrderBtn: '✏️ Изменить заказ / Добавить блюда',
    sending: 'Отправка заказа...',
    tablePrompt: 'Выберите стол / место:',
    tableInputPlaceholder: 'Или введите другой номер стола (напр. Стол 12, VIP 2...)',
    notePlaceholder: 'Комментарий к заказу (напр. салфетки, подать всё вместе...)',
    trackerTitle: 'Статус заказа в реальном времени',
    stepNew: 'Отправлен на кассу',
    stepPreparing: 'Готовится на кухне',
    stepCompleted: 'Подано и завершено',
    orderMoreBtn: 'Закрыть / Вернуться в меню',
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
  activeOrderProp = null,
  editingOrder = null,
  onEditOrder,
  onCancelEditOrder,
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
  const quickTagsPool = QUICK_TAGS_BY_VERTICAL[shop.vertical] || [];

  useEffect(() => {
    if (initialTableLabel) {
      setTableNumber(initialTableLabel);
    }
  }, [initialTableLabel]);

  // Sync activeOrder when modal opens with an existing activeOrderProp (and not currently editing cart)
  useEffect(() => {
    if (isOpen && cart.length === 0 && activeOrderProp && !editingOrder) {
      setActiveOrder(activeOrderProp);
    }
    if (editingOrder) {
      setActiveOrder(null);
      setTableNumber(editingOrder.table_label || initialTableLabel || 'Bàn 01');
      setPaymentMethod(editingOrder.payment_method || 'cash');
      setCustomerNote(editingOrder.customer_note || '');
    }
  }, [isOpen, cart.length, activeOrderProp, editingOrder, initialTableLabel]);

  // Poll live order status when an order has been submitted
  useEffect(() => {
    if (!activeOrder) return;
    const poll = async () => {
      try {
        const tokenParam = activeOrder.tracking_token
          ? `&trackingToken=${encodeURIComponent(activeOrder.tracking_token)}`
          : '';
        const res = await fetch(
          `/api/orders?orderId=${encodeURIComponent(activeOrder.id)}${tokenParam}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.order) {
            setActiveOrder((prev) => ({
              ...data.order,
              tracking_token: data.order.tracking_token || prev?.tracking_token,
            }));
            onOrderCreated?.({
              ...data.order,
              tracking_token:
                data.order.tracking_token || activeOrder.tracking_token,
            });
          }
        }
      } catch {
        // ignore network hiccup
      }
    };
    const timer = setInterval(poll, 3500);
    return () => clearInterval(timer);
  }, [activeOrder, onOrderCreated]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window) || !activeOrder) {
      return;
    }
    const bc = new BroadcastChannel('qlaok_realtime_sync');
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'order_updated' && ev.data?.order?.id === activeOrder.id) {
        setActiveOrder(ev.data.order);
      }
    };
    return () => bc.close();
  }, [activeOrder]);

  const subtotal = cart.reduce((sum, entry) => {
    const extraTotal = entry.selectedChoices.reduce(
      (s, c) => s + (c.extra_price || 0),
      0
    );
    return sum + (entry.item.price + extraTotal) * entry.quantity;
  }, 0);

  const promoCalc = calculateOrderPromoDiscount(
    cart.map((entry) => {
      const extraTotal = entry.selectedChoices.reduce(
        (s, c) => s + (c.extra_price || 0),
        0
      );
      return {
        item: entry.item,
        quantity: entry.quantity,
        lineTotal: (entry.item.price + extraTotal) * entry.quantity,
      };
    }),
    shop,
    locale
  );

  const grandTotal = Math.max(0, subtotal - promoCalc.discountAmount);

  const handleSendOrderToMpos = async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      const promoNoteSuffix =
        promoCalc.discountAmount > 0
          ? ` [KM${promoCalc.voucherCode ? ` ${promoCalc.voucherCode}` : ''}: -${formatCurrency(promoCalc.discountAmount, shop.currency)}]`
          : '';
      const mappedItems = cart.map((entry) => {
        const extraPrice = entry.selectedChoices.reduce(
          (s, c) => s + (c.extra_price || 0),
          0
        );
        return {
          item_id: entry.item.id,
          name_vi: entry.item.name_i18n.vi,
          name_i18n: entry.item.name_i18n,
          quantity: entry.quantity,
          unit_price: entry.item.price,
          extra_price: extraPrice,
          selected_choices: entry.selectedChoices.map((c) => ({
            id: c.id,
            label_vi: c.label_i18n.vi,
            label_i18n: c.label_i18n,
            extra_price: c.extra_price || 0,
          })),
          quick_tags: entry.quickTags,
          custom_note: entry.customNote || undefined,
        };
      });

      const isEditingExisting = Boolean(
        editingOrder &&
          editingOrder.status === 'new' &&
          editingOrder.payment_status === 'unpaid'
      );

      const res = await fetch('/api/orders', {
        method: isEditingExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEditingExisting && editingOrder
            ? {
                order_id: editingOrder.id,
                tracking_token: editingOrder.tracking_token,
                table_label:
                  tableNumber.trim() || editingOrder.table_label || 'Bàn khách QR',
                customer_note:
                  `${customerNote.trim()}${promoNoteSuffix}`.trim() || undefined,
                items: mappedItems,
              }
            : {
                shop_id: shop.id,
                table_label: tableNumber.trim() || 'Bàn khách QR',
                visitor_lang: locale,
                customer_note:
                  `${customerNote.trim()}${promoNoteSuffix}`.trim() || undefined,
                payment_method: paymentMethod,
                source: 'qr_table',
                apply_shop_promotions: true,
                discount_code: promoCalc.voucherCode || undefined,
                discount_amount: promoCalc.discountAmount,
                items: mappedItems,
              }
        ),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit order');
      }

      const savedOrder: ShopOrder = {
        ...data.order,
        tracking_token:
          data.order?.tracking_token || editingOrder?.tracking_token,
      };
      setActiveOrder(savedOrder);
      onOrderCreated?.(savedOrder);
      onCancelEditOrder?.();
      onClearCart();

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({
          type: isEditingExisting ? 'order_updated' : 'order_created',
          order: savedOrder,
          shopId: shop.id,
        });
        bc.close();
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to send order'
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
          className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white"
        >
          {/* Top Checkout Confirmation Banner */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-4 shadow-lg">
            <div className="mx-auto flex max-w-lg items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-100">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>{labels.showToStaffHeader}</span>
                </div>
                <h2 className="mt-2 flex flex-wrap items-center gap-1.5 text-lg font-black leading-tight text-white">
                  <span>{shop.name}</span>
                  <span className="text-emerald-200">•</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-bold">
                    <FlagIcon locale={locale} className="h-3.5 w-5 rounded-[2px]" />
                    <span>{visitorMeta.nativeName}</span>
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-emerald-100/90">
                  {labels.showToStaffSub}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveOrder(null);
                  onClose();
                }}
                aria-label="Close"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/25 text-white hover:bg-black/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Main Content: Either Live Order Tracker OR Cart Selection */}
          <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {activeOrder ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border-2 border-emerald-500/40 bg-slate-900 p-5 shadow-2xl space-y-5"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      {orderText.trackerTitle}
                    </span>
                    <h3 className="mt-2 text-2xl font-black text-white">
                      {activeOrder.order_code} •{' '}
                      <span className="text-emerald-400">
                        {formatTableLabel(activeOrder.table_label, locale)}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {labels.autoNotifiedSub}
                    </p>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400">
                    {activeOrder.status === 'completed' ? (
                      <CheckCircle2 className="h-8 w-8" />
                    ) : activeOrder.status === 'preparing' ? (
                      <ChefHat className="h-8 w-8 animate-bounce" />
                    ) : (
                      <Clock className="h-8 w-8 animate-pulse" />
                    )}
                  </div>
                </div>

                {/* 3-Step Visual Progress Bar */}
                <div className="space-y-3">
                  {[
                    {
                      key: 'new',
                      title: orderText.stepNew,
                      active:
                        activeOrder.status === 'new' ||
                        activeOrder.status === 'preparing' ||
                        activeOrder.status === 'completed',
                    },
                    {
                      key: 'preparing',
                      title: orderText.stepPreparing,
                      active:
                        activeOrder.status === 'preparing' ||
                        activeOrder.status === 'completed',
                    },
                    {
                      key: 'completed',
                      title: orderText.stepCompleted,
                      active: activeOrder.status === 'completed',
                    },
                  ].map((step, i) => (
                    <div
                      key={step.key}
                      className={`flex items-center gap-3 rounded-2xl border p-3.5 transition ${
                        step.active
                          ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                          : 'border-slate-800 bg-slate-900/50 text-slate-500'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                          step.active
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {step.active ? '✓' : i + 1}
                      </div>
                      <span className="text-sm font-bold">{step.title}</span>
                    </div>
                  ))}
                </div>

                {/* Ordered Items Summary */}
                <div className="rounded-2xl bg-slate-950/70 p-4 space-y-2 border border-slate-800">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {labels.orderItemsSentHeading}
                  </p>
                  {activeOrder.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm py-1 border-b border-slate-800/60 last:border-none"
                    >
                      <div>
                        <span className="font-black text-emerald-400 mr-2">
                          {it.quantity}x
                        </span>
                        <span className="font-bold text-white">
                          {locale === 'vi'
                            ? it.name_vi
                            : it.name_i18n
                              ? tField(it.name_i18n, locale)
                              : it.name_vi}
                        </span>
                        {locale !== 'vi' && (
                          <span className="ml-1.5 text-xs text-slate-400">
                            ({it.name_vi})
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-slate-300">
                        {formatCurrency(
                          (it.unit_price + it.extra_price) * it.quantity,
                          shop.currency
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 text-base font-black text-emerald-400">
                    <span>{labels.totalEstimated}</span>
                    <span>
                      {formatCurrency(activeOrder.total_amount, shop.currency)}
                    </span>
                  </div>
                </div>

                {/* Live Shop Payment QR when customer selected VietQR */}
                {activeOrder.payment_method === 'vietqr' &&
                  activeOrder.payment_status !== 'paid' &&
                  (() => {
                    const qrInfo = getShopPaymentQrInfo(
                      shop,
                      activeOrder.total_amount,
                      activeOrder.order_code
                    );
                    if (!qrInfo.isConfigured || !qrInfo.qrImageUrl) {
                      return (
                        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-3.5 text-center text-xs font-bold text-amber-200">
                          {locale === 'vi'
                            ? 'Quán chưa cấu hình mã VietQR tự động. Vui lòng thanh toán trực tiếp với nhân viên tại bàn/quầy.'
                            : 'Online QR is not configured for this shop. Please pay with staff at your table or counter.'}
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-4 text-center space-y-2.5">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-300">
                          <QrCode className="h-3.5 w-3.5" />
                          <span>{labels.qrPayment}</span>
                        </div>
                        <div
                          style={{ backgroundColor: '#ffffff' }}
                          className="qr-light-surface mx-auto h-48 w-48 rounded-2xl bg-white p-2 shadow-lg flex items-center justify-center"
                        >
                          <img
                            src={qrInfo.qrImageUrl}
                            alt="VietQR Payment"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="text-xs text-slate-300 space-y-0.5">
                          <p className="font-bold text-white">
                            {qrInfo.bankShortName}{' '}
                            {qrInfo.accountNumber
                              ? `• ${qrInfo.accountNumber}`
                              : ''}
                          </p>
                          <p className="text-[11px] text-slate-400 uppercase">
                            {qrInfo.accountName}
                          </p>
                          <p className="text-[11px] font-mono text-amber-300">
                            {qrInfo.transferContent}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                {/* Allow Customer to Edit Order / Change Dishes ONLY while status === 'new' and unpaid */}
                {activeOrder.status === 'new' &&
                  activeOrder.payment_status === 'unpaid' &&
                  onEditOrder && (
                    <button
                      type="button"
                      onClick={() => {
                        const target = activeOrder;
                        setActiveOrder(null);
                        onEditOrder(target);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-amber-400/20 py-3.5 text-sm font-black text-amber-300 hover:bg-amber-400/30 transition"
                    >
                      <Edit3 className="h-4 w-4" />
                      <span>{orderText.editOrderBtn}</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => {
                    setActiveOrder(null);
                    onClose();
                  }}
                  className="w-full rounded-2xl bg-slate-800 py-3.5 text-sm font-bold text-white hover:bg-slate-700"
                >
                  {orderText.orderMoreBtn}
                </button>
              </motion.div>
            ) : (
              <>
                {editingOrder && (
                  <div className="flex items-center justify-between gap-2 rounded-2xl border-2 border-amber-400 bg-amber-500/15 px-3.5 py-2.5 text-amber-200">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-amber-300">
                        ✏️ #{editingOrder.order_code} •{' '}
                        {formatTableLabel(editingOrder.table_label, locale)}
                      </p>
                      <p className="text-[11px] text-amber-100/90">
                        {locale === 'vi'
                          ? 'Bạn có thể tăng/giảm món tại đây hoặc đóng cửa sổ này để chọn thêm món ngoài thực đơn.'
                          : 'Adjust quantities here or close this sheet to add more dishes from the menu.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="shrink-0 rounded-xl bg-amber-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-300"
                    >
                      {locale === 'vi' ? '+ Chọn thêm món' : '+ Add Items'}
                    </button>
                  </div>
                )}

                {/* Quick Table Selector & Payment Method */}
                {cart.length > 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-extrabold uppercase tracking-wider text-emerald-400 mb-2">
                        {orderText.tablePrompt}
                      </label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {QUICK_TABLES.map((tb) => (
                          <button
                            key={tb}
                            type="button"
                            onClick={() => setTableNumber(tb)}
                            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                              tableNumber === tb
                                ? 'bg-emerald-500 text-slate-950 shadow-sm'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {formatTableLabel(tb, locale)}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={
                          QUICK_TABLES.includes(tableNumber)
                            ? formatTableLabel(tableNumber, locale)
                            : tableNumber
                        }
                        onChange={(e) => setTableNumber(e.target.value)}
                        placeholder={orderText.tableInputPlaceholder}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    {/* Payment Method Toggle */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cash')}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-bold transition ${
                          paymentMethod === 'cash'
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                            : 'border-slate-800 bg-slate-950 text-slate-400'
                        }`}
                      >
                        <Banknote className="h-4 w-4" />
                        <span>{labels.cashPayment}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('vietqr')}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-bold transition ${
                          paymentMethod === 'vietqr'
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                            : 'border-slate-800 bg-slate-950 text-slate-400'
                        }`}
                      >
                        <QrCode className="h-4 w-4" />
                        <span>{labels.qrPayment}</span>
                      </button>
                    </div>

                    {/* General Order Note */}
                    <input
                      type="text"
                      value={customerNote}
                      onChange={(e) => setCustomerNote(e.target.value)}
                      placeholder={orderText.notePlaceholder}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                )}

                {locale !== 'vi' && cart.length > 0 && (
                  <p className="px-1 text-[11px] font-medium text-slate-400">
                    ℹ️ {labels.kitchenBilingualNote}
                  </p>
                )}

                {/* Cart Items List */}
                {cart.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">
                    <p className="text-base font-medium">
                      {labels.emptyCartTitle}
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="mt-4 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-bold text-white"
                    >
                      {labels.backToMenuBtn}
                    </button>
                  </div>
                ) : (
                  cart.map((entry, idx) => {
                    const extraTotal = entry.selectedChoices.reduce(
                      (s, c) => s + (c.extra_price || 0),
                      0
                    );
                    const unitWithExtra = entry.item.price + extraTotal;
                    const lineTotal = unitWithExtra * entry.quantity;
                    const primaryName = tField(entry.item.name_i18n, locale);

                    return (
                      <div
                        key={`${entry.item.id}-${idx}`}
                        className="rounded-3xl border-2 border-slate-800 bg-slate-900 p-4 shadow-md"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            {/* Giant Quantity Badge */}
                            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black shadow-md">
                              <span className="text-[10px] uppercase leading-none font-extrabold">
                                {labels.qtyShort}
                              </span>
                              <span className="text-xl leading-tight">
                                {entry.quantity}
                              </span>
                            </div>

                            <div>
                              {/* Primary Item Name in Customer's Selected Language */}
                              <h3 className="text-lg font-black leading-snug text-white">
                                {primaryName}
                              </h3>

                              {/* Secondary Vietnamese Name for Kitchen/Counter Accuracy */}
                              {locale !== 'vi' && (
                                <p className="mt-0.5 text-xs font-semibold text-emerald-300/90">
                                  🇻🇳 {entry.item.name_i18n.vi}
                                </p>
                              )}

                              {/* Selected Options */}
                              {entry.selectedChoices.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {entry.selectedChoices.map((c) => (
                                    <span
                                      key={c.id}
                                      className="rounded-lg bg-emerald-950/90 border border-emerald-700/60 px-2.5 py-1 text-xs font-bold text-emerald-300"
                                    >
                                      • {tField(c.label_i18n, locale)}
                                      {c.extra_price > 0
                                        ? ` (+${formatCurrency(c.extra_price, shop.currency)})`
                                        : ''}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Quick Tags */}
                              {entry.quickTags && entry.quickTags.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {entry.quickTags.map((tagVi, tIdx) => {
                                    const matchedTag = quickTagsPool.find(
                                      (t) => t.i18n.vi === tagVi
                                    );
                                    const displayTag = matchedTag
                                      ? tField(matchedTag.i18n, locale)
                                      : tagVi;
                                    return (
                                      <span
                                        key={tIdx}
                                        className="rounded-lg bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-xs font-bold text-amber-300"
                                      >
                                        ⚠️ {displayTag}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Custom Note */}
                              {entry.customNote && (
                                <p className="mt-2 rounded-xl bg-rose-950/60 border border-rose-700/50 px-3 py-1.5 text-xs font-bold text-rose-200">
                                  📝 {labels.notePrefix}: &ldquo;{entry.customNote}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Bottom Line: Price & Quantity Adjuster */}
                        <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                          <div>
                            <span className="text-xs text-slate-400">
                              {labels.unitPriceLabel}:{' '}
                              {formatCurrency(unitWithExtra, shop.currency)}
                            </span>
                            <p className="text-base font-black text-emerald-400">
                              {formatCurrency(lineTotal, shop.currency)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(idx, -1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center text-sm font-black">
                              {entry.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(idx, 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>

          {/* Sticky Footer: Total & Direct mPOS Order Action */}
          {!activeOrder && cart.length > 0 && (
            <div className="border-t border-slate-800 bg-slate-900 px-4 pt-4 pb-6">
              <div className="mx-auto max-w-lg space-y-3">
                {submitError && (
                  <div className="rounded-xl bg-rose-950/80 border border-rose-700 px-3 py-2 text-xs font-bold text-rose-200">
                    ⚠️ {submitError}
                  </div>
                )}

                {promoCalc.discountAmount > 0 && (
                  <div className="flex items-center justify-between rounded-xl bg-emerald-950/70 border border-emerald-700/60 px-3 py-2 text-xs">
                    <span className="font-bold text-emerald-300">
                      🎁{' '}
                      {promoCalc.promoTitle ||
                        (PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi)
                          .promoBadge}
                      {promoCalc.voucherCode ? ` (${promoCalc.voucherCode})` : ''}
                    </span>
                    <span className="font-black text-emerald-400">
                      -{formatCurrency(promoCalc.discountAmount, shop.currency)}
                    </span>
                  </div>
                )}

                {promoCalc.minOrderNeeded > 0 && (
                  <div className="rounded-xl bg-amber-950/60 border border-amber-700/50 px-3 py-1.5 text-[11px] font-semibold text-amber-300">
                    {(
                      PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi
                    ).unlockHint(
                      formatCurrency(promoCalc.minOrderNeeded, shop.currency),
                      promoCalc.promoTitle || ''
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-300">
                    {labels.totalEstimated} (
                    {formatTableLabel(tableNumber || 'Bàn 01', locale)})
                  </span>
                  <div className="text-right">
                    {promoCalc.discountAmount > 0 && (
                      <span className="block text-xs text-slate-500 line-through">
                        {formatCurrency(subtotal, shop.currency)}
                      </span>
                    )}
                    <span className="text-2xl font-black text-emerald-400">
                      {formatCurrency(grandTotal, shop.currency)}
                    </span>
                  </div>
                </div>

                {/* Primary Button: Send Directly to Counter mPOS */}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSendOrderToMpos}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-4 text-base font-black text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{orderText.sending}</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-5 w-5" />
                      <span>
                        {editingOrder ? orderText.updateBtn : orderText.sendBtn}
                      </span>
                    </>
                  )}
                </button>

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onClearCart();
                      onClose();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    <span>{labels.clearSelection}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
