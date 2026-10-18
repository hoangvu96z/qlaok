'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { startOrderLiveSync } from '@/lib/order-live-sync';
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
  AlertTriangle,
  Utensils,
  RefreshCw,
} from 'lucide-react';
import {
  CartSelection,
  PaymentMethod,
  Shop,
  ShopOrder,
  ShopTable,
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
import {
  filterSelectableTables,
  isTakeawayTableLabel,
} from '@/lib/table-helpers';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import {
  calculateOrderPromoDiscount,
  PROMO_LOCALE_TEXT,
} from '@/components/storefront/StorefrontCustomDecor';

export interface ShowToStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop;
  locale: SupportedLocale;
  cart: CartSelection[];
  tables?: ShopTable[];
  selectedTableId?: string | null;
  isTakeawaySelected?: boolean;
  tableResolutionError?: string | null;
  tablesLoadError?: string | null;
  onSelectTable?: (selection: {
    tableId: string | null;
    tableLabel: string;
    isTakeaway: boolean;
  }) => void;
  onRetryLoadTables?: () => void;
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
    noteLabel: string;
    notePlaceholder: string;
    trackerTitle: string;
    stepNew: string;
    stepPreparing: string;
    stepCompleted: string;
    orderMoreBtn: string;
  }
> = {
  vi: {
    sendBtn: 'Gửi đơn đến quầy',
    updateBtn: 'Lưu cập nhật & gửi đến quầy',
    editOrderBtn: 'Sửa đơn / Đổi hoặc thêm món',
    sending: 'Đang gửi đơn đến quầy...',
    tablePrompt: 'Chọn bàn / Hình thức phục vụ:',
    noteLabel: 'Ghi chú đơn hàng',
    notePlaceholder:
      'Ghi chú chung cho quầy (VD: mang ra cùng lúc, xin thêm chén...)',
    trackerTitle: 'Trạng Thái Đơn Hàng Trực Tiếp (Realtime)',
    stepNew: 'Chờ quầy xác nhận',
    stepPreparing: 'Đang chuẩn bị / chế biến',
    stepCompleted: 'Đã phục vụ & Hoàn tất',
    orderMoreBtn: 'Đóng / Xem thêm thực đơn',
  },
  en: {
    sendBtn: 'Send Order to Counter',
    updateBtn: 'Save & Send Order Changes',
    editOrderBtn: 'Edit Order / Change Items',
    sending: 'Sending order to counter...',
    tablePrompt: 'Select Table / Service Mode:',
    noteLabel: 'Order note',
    notePlaceholder:
      'Note for counter (e.g. extra napkins, serve together...)',
    trackerTitle: 'Live Order Status Tracker',
    stepNew: 'Sent to Counter',
    stepPreparing: 'Preparing / Cooking',
    stepCompleted: 'Served & Completed',
    orderMoreBtn: 'Close / Browse Menu',
  },
  ko: {
    sendBtn: '카운터로 바로 주문 전송',
    updateBtn: '주문 변경사항 저장',
    editOrderBtn: '주문 수정 / 메뉴 변경·추가',
    sending: '주문을 전송하는 중...',
    tablePrompt: '테이블 / 포장 선택:',
    noteLabel: '주문 요청사항',
    notePlaceholder: '요청사항 입력 (예: 앞접시 추가, 같이 서빙해주세요)',
    trackerTitle: '실시간 주문 진행 상태',
    stepNew: '주문 접수 대기',
    stepPreparing: '조리 및 준비 중',
    stepCompleted: '제공 및 완료',
    orderMoreBtn: '닫기 / 메뉴 더 보기',
  },
  ja: {
    sendBtn: 'レジ・厨房へ注文を送信',
    updateBtn: '注文の変更を保存',
    editOrderBtn: '注文内容を変更・追加する',
    sending: '注文を送信中...',
    tablePrompt: 'テーブル / お持ち帰り選択:',
    noteLabel: '注文メモ',
    notePlaceholder:
      'メモ（例：取り皿をお願いします、一緒に出してください）',
    trackerTitle: 'リアルタイム注文状況',
    stepNew: '受付待ち',
    stepPreparing: '調理・準備中',
    stepCompleted: '提供完了',
    orderMoreBtn: '閉じる / メニューを見る',
  },
  zh: {
    sendBtn: '立即发送订单到吧台/厨房',
    updateBtn: '保存订单修改',
    editOrderBtn: '修改订单 / 增减菜品',
    sending: '正在发送订单...',
    tablePrompt: '选择桌号 / 打包外带:',
    noteLabel: '订单备注',
    notePlaceholder: '备注（例如：多拿一个碗、一起上菜...）',
    trackerTitle: '实时订单状态追踪',
    stepNew: '等待吧台确认',
    stepPreparing: '正在制作/准备中',
    stepCompleted: '已上菜 / 已完成',
    orderMoreBtn: '关闭 / 返回菜单',
  },
  es: {
    sendBtn: 'Enviar Pedido al Mostrador',
    updateBtn: 'Guardar Cambios del Pedido',
    editOrderBtn: 'Editar Pedido / Cambiar Platos',
    sending: 'Enviando pedido al mostrador...',
    tablePrompt: 'Selecciona Mesa / Para llevar:',
    noteLabel: 'Nota del pedido',
    notePlaceholder:
      'Nota para el mostrador (ej. servilletas extra, servir todo junto...)',
    trackerTitle: 'Estado del Pedido en Tiempo Real',
    stepNew: 'Enviado al mostrador',
    stepPreparing: 'En preparación / cocina',
    stepCompleted: 'Servido y completado',
    orderMoreBtn: 'Cerrar / Ver Menú',
  },
  it: {
    sendBtn: 'Invia Ordine alla Cassa',
    updateBtn: 'Salva Modifiche Ordine',
    editOrderBtn: 'Modifica Ordine / Cambia Piatti',
    sending: 'Invio ordine in corso...',
    tablePrompt: 'Seleziona Tavolo / Asporto:',
    noteLabel: 'Nota ordine',
    notePlaceholder:
      'Nota per la cassa (es. tovaglioli extra, servire insieme...)',
    trackerTitle: 'Stato Ordine in Tempo Reale',
    stepNew: 'Inviato alla cassa',
    stepPreparing: 'In preparazione / cottura',
    stepCompleted: 'Servito e completato',
    orderMoreBtn: 'Chiudi / Torna al Menu',
  },
  ru: {
    sendBtn: 'Отправить заказ на кассу',
    updateBtn: 'Сохранить изменения заказа',
    editOrderBtn: 'Изменить заказ / Добавить блюда',
    sending: 'Отправка заказа...',
    tablePrompt: 'Выберите стол / Навынос:',
    noteLabel: 'Комментарий к заказу',
    notePlaceholder:
      'Комментарий к заказу (напр. салфетки, подать всё вместе...)',
    trackerTitle: 'Статус заказа в реальном времени',
    stepNew: 'Отправлен на кассу',
    stepPreparing: 'Готовится на кухне',
    stepCompleted: 'Подано и завершено',
    orderMoreBtn: 'Закрыть / Вернуться в меню',
  },
};

export function ShowToStaffModal({
  isOpen,
  onClose,
  shop,
  locale,
  cart,
  tables,
  selectedTableId = null,
  isTakeawaySelected = false,
  tableResolutionError = null,
  tablesLoadError = null,
  onSelectTable,
  onRetryLoadTables,
  initialTableLabel = '',
  activeOrderProp = null,
  editingOrder = null,
  onEditOrder,
  onCancelEditOrder,
  onUpdateQuantity,
  onClearCart,
  onOrderCreated,
}: ShowToStaffModalProps) {
  const tx = (vi: string, en: string) => (locale === 'vi' ? vi : en);

  // Active unarchived tables belonging to this shop
  const activeTables = useMemo(
    () => filterSelectableTables(tables, shop.id),
    [tables, shop.id]
  );

  // Local selection state (synced with parent props when provided)
  const [localTableId, setLocalTableId] = useState<string | null>(
    selectedTableId
  );
  const [localTakeaway, setLocalTakeaway] = useState<boolean>(
    Boolean(isTakeawaySelected) || isTakeawayTableLabel(initialTableLabel)
  );
  const [hasEditedOrderTable, setHasEditedOrderTable] = useState(false);

  const [customerNote, setCustomerNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [activeOrder, setActiveOrder] = useState<ShopOrder | null>(null);

  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const orderText = SEND_ORDER_LABELS[locale] || SEND_ORDER_LABELS.vi;
  const visitorMeta = LOCALE_META[locale] || LOCALE_META.vi;
  const quickTagsPool = QUICK_TAGS_BY_VERTICAL[shop.vertical] || [];

  // Sync parent selection into modal state when not editing an existing order
  useEffect(() => {
    if (editingOrder) return;
    setLocalTableId(selectedTableId ?? null);
    setLocalTakeaway(
      Boolean(isTakeawaySelected) ||
        (!selectedTableId && isTakeawayTableLabel(initialTableLabel))
    );
  }, [
    selectedTableId,
    isTakeawaySelected,
    initialTableLabel,
    editingOrder,
  ]);

  // Sync activeOrder or editingOrder when modal opens
  useEffect(() => {
    if (isOpen && cart.length === 0 && activeOrderProp && !editingOrder) {
      setActiveOrder(activeOrderProp);
    }
    if (editingOrder) {
      setActiveOrder(null);
      setHasEditedOrderTable(false);
      setLocalTableId(editingOrder.table_id ?? null);
      setLocalTakeaway(
        !editingOrder.table_id && isTakeawayTableLabel(editingOrder.table_label)
      );
      setPaymentMethod(editingOrder.payment_method || 'cash');
      setCustomerNote(editingOrder.customer_note || '');
      setSubmitError('');
    }
  }, [isOpen, cart.length, activeOrderProp, editingOrder]);

  const selectedActiveTable = useMemo(() => {
    if (!localTableId) return null;
    return activeTables.find((t) => t.id === localTableId) || null;
  }, [activeTables, localTableId]);

  const handleChooseManagedTable = (table: ShopTable) => {
    setLocalTableId(table.id);
    setLocalTakeaway(false);
    setHasEditedOrderTable(true);
    setSubmitError('');
    onSelectTable?.({
      tableId: table.id,
      tableLabel: table.name,
      isTakeaway: false,
    });
  };

  const handleChooseTakeaway = () => {
    setLocalTableId(null);
    setLocalTakeaway(true);
    setHasEditedOrderTable(true);
    setSubmitError('');
    onSelectTable?.({
      tableId: null,
      tableLabel: 'Mang về',
      isTakeaway: true,
    });
  };

  const isEditingExisting = Boolean(
    editingOrder &&
      editingOrder.status === 'new' &&
      editingOrder.payment_status === 'unpaid'
  );

  // Determine current effective table display & whether selection is valid
  const currentSelectionDisplay = useMemo(() => {
    if (isEditingExisting && editingOrder && !hasEditedOrderTable) {
      return formatTableLabel(editingOrder.table_label, locale);
    }
    if (selectedActiveTable) {
      return selectedActiveTable.name;
    }
    if (localTakeaway) {
      return formatTableLabel('Mang về', locale);
    }
    if (tables === undefined && initialTableLabel && !tableResolutionError) {
      return formatTableLabel(initialTableLabel, locale);
    }
    return tx('Chưa chọn bàn', 'No table selected');
  }, [
    isEditingExisting,
    editingOrder,
    hasEditedOrderTable,
    selectedActiveTable,
    localTakeaway,
    tables,
    initialTableLabel,
    tableResolutionError,
    locale,
  ]);

  const isSelectionResolved = useMemo(() => {
    if (isEditingExisting && editingOrder && !hasEditedOrderTable) {
      return true;
    }
    if (selectedActiveTable || localTakeaway) {
      return true;
    }
    if (tables === undefined && !tableResolutionError && !tablesLoadError) {
      return true;
    }
    return false;
  }, [
    isEditingExisting,
    editingOrder,
    hasEditedOrderTable,
    selectedActiveTable,
    localTakeaway,
    tables,
    tableResolutionError,
    tablesLoadError,
  ]);

  const onOrderCreatedRef = useRef(onOrderCreated);
  onOrderCreatedRef.current = onOrderCreated;
  const trackingFinished =
    activeOrder?.status === 'cancelled' ||
    activeOrder?.payment_status === 'refunded' ||
    (activeOrder?.status === 'completed' &&
      activeOrder?.payment_status === 'paid');

  useEffect(() => {
    const orderId = activeOrder?.id;
    const token = activeOrder?.tracking_token;
    if (!isOpen || !orderId || !token || trackingFinished) return;
    let disposed = false;
    let busy = false;
    let again = false;
    let request = new AbortController();
    const refresh = async () => {
      if (disposed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      do {
        again = false;
        const current = new AbortController();
        request = current;
        try {
          const res = await fetch(
            `/api/orders?orderId=${encodeURIComponent(orderId)}`,
            {
              headers: { 'x-tracking-token': token },
              cache: 'no-store',
              signal: current.signal,
            }
          );
          if (res.ok && !disposed) {
            const data = await res.json();
            if (data.order && !disposed) {
              const merged = { ...data.order, tracking_token: token };
              setActiveOrder(merged);
              onOrderCreatedRef.current?.(merged);
            }
          }
        } catch {
          // ignore network errors
        }
      } while (again && !disposed);
      busy = false;
    };
    const stop = startOrderLiveSync({
      query: `orderId=${encodeURIComponent(orderId)}`,
      headers: () => ({ 'x-tracking-token': token }),
      onChange: () => {
        void refresh();
      },
    });
    return () => {
      disposed = true;
      request.abort();
      stop();
    };
  }, [
    isOpen,
    activeOrder?.id,
    activeOrder?.tracking_token,
    trackingFinished,
    shop.id,
  ]);

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

    if (!isSelectionResolved) {
      setSubmitError(
        tableResolutionError ||
          tx(
            'Mời quý khách chọn bàn phục vụ hoặc chọn Mang về trước khi bấm nút gửi đến quầy.',
            'Please select an active table or choose Takeaway before sending your order to the counter.'
          )
      );
      return;
    }

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

      const resolvedNewTableId = selectedActiveTable
        ? selectedActiveTable.id
        : null;
      const resolvedNewTableLabel = selectedActiveTable
        ? selectedActiveTable.name
        : localTakeaway
          ? 'Mang về'
          : initialTableLabel.trim() || 'Mang về';

      const requestBody =
        isEditingExisting && editingOrder
          ? {
              order_id: editingOrder.id,
              tracking_token: editingOrder.tracking_token,
              ...(hasEditedOrderTable
                ? {
                    table_id: resolvedNewTableId,
                    table_label: resolvedNewTableLabel,
                  }
                : {}),
              customer_note:
                `${customerNote.trim()}${promoNoteSuffix}`.trim() || undefined,
              items: mappedItems,
            }
          : {
              shop_id: shop.id,
              table_id: resolvedNewTableId,
              table_label: resolvedNewTableLabel,
              visitor_lang: locale,
              customer_note:
                `${customerNote.trim()}${promoNoteSuffix}`.trim() || undefined,
              payment_method: paymentMethod,
              source: 'qr_table',
              apply_shop_promotions: true,
              discount_code: promoCalc.voucherCode || undefined,
              discount_amount: promoCalc.discountAmount,
              items: mappedItems,
            };

      const res = await fetch('/api/orders', {
        method: isEditingExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="show-to-staff-modal-title"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
        >
          {/* Top Checkout Confirmation Banner */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3.5 sm:py-4 shadow-md shrink-0">
            <div className="mx-auto flex max-w-lg items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-50">
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{labels.showToStaffHeader}</span>
                </div>
                <h2
                  id="show-to-staff-modal-title"
                  className="mt-1.5 flex flex-wrap items-center gap-1.5 text-base sm:text-lg font-black leading-tight text-white"
                >
                  <span className="truncate">{shop.name}</span>
                  <span className="text-emerald-200">•</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-0.5 text-xs font-bold">
                    <FlagIcon
                      locale={locale}
                      className="h-3.5 w-5 rounded-[2px]"
                    />
                    <span>{visitorMeta.nativeName}</span>
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-emerald-50/95">
                  {labels.showToStaffSub}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveOrder(null);
                  onClose();
                }}
                aria-label={tx('Đóng cửa sổ đặt món', 'Close order modal')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/35 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Main Content: Either Live Order Tracker OR Cart Selection */}
          <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-3.5 sm:px-4 py-4 space-y-4">
            {activeOrder ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl border-2 border-emerald-500/40 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-lg space-y-5"
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 px-3 py-1 text-xs font-black">
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{orderText.trackerTitle}</span>
                    </span>
                    <h3 className="mt-2 text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                      {activeOrder.order_code} •{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {formatTableLabel(activeOrder.table_label, locale)}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {labels.autoNotifiedSub}
                    </p>
                  </div>
                  <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                    {activeOrder.status === 'completed' ? (
                      <CheckCircle2 className="h-7 w-7 sm:h-8 sm:w-8" />
                    ) : activeOrder.status === 'preparing' ? (
                      <ChefHat className="h-7 w-7 sm:h-8 sm:w-8 animate-bounce" />
                    ) : (
                      <Clock className="h-7 w-7 sm:h-8 sm:w-8 animate-pulse" />
                    )}
                  </div>
                </div>

                {/* 3-Step Visual Progress Bar */}
                <div className="space-y-2.5">
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
                          ? 'border-emerald-500/50 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-slate-200 bg-slate-100/70 text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-500'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                          step.active
                            ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-500'
                        }`}
                      >
                        {step.active ? '✓' : i + 1}
                      </div>
                      <span className="text-sm font-bold">{step.title}</span>
                    </div>
                  ))}
                </div>

                {/* Ordered Items Summary */}
                <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/70 p-4 space-y-2 border border-slate-200 dark:border-slate-800">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {labels.orderItemsSentHeading}
                  </p>
                  {activeOrder.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-slate-200/80 dark:border-slate-800/60 last:border-none"
                    >
                      <div className="min-w-0">
                        <span className="font-black text-emerald-600 dark:text-emerald-400 mr-2">
                          {it.quantity}x
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          {locale === 'vi'
                            ? it.name_vi
                            : it.name_i18n
                              ? tField(it.name_i18n, locale)
                              : it.name_vi}
                        </span>
                        {locale !== 'vi' && (
                          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                            ({it.name_vi})
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">
                        {formatCurrency(
                          (it.unit_price + it.extra_price) * it.quantity,
                          shop.currency
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 text-base font-black text-emerald-700 dark:text-emerald-400">
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
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200 p-3.5 text-center text-xs font-bold">
                          {tx(
                            'Quán chưa cấu hình mã VietQR tự động. Vui lòng thanh toán trực tiếp với nhân viên tại bàn/quầy.',
                            'Online QR is not configured for this shop. Please pay with staff at your table or counter.'
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="rounded-2xl border border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-slate-900 p-4 text-center space-y-2.5">
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 px-3 py-1 text-xs font-black">
                          <QrCode className="h-3.5 w-3.5" />
                          <span>{labels.qrPayment}</span>
                        </div>
                        {/* Keep actual QR strictly light high-contrast in both light & dark modes */}
                        <div
                          style={{ backgroundColor: '#ffffff' }}
                          className="qr-light-surface mx-auto h-48 w-48 rounded-2xl bg-white p-2 shadow-md border border-slate-200 flex items-center justify-center"
                        >
                          <img
                            src={qrInfo.qrImageUrl}
                            alt="VietQR Payment"
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 space-y-0.5">
                          <p className="font-bold text-slate-900 dark:text-white">
                            {qrInfo.bankShortName}{' '}
                            {qrInfo.accountNumber
                              ? `• ${qrInfo.accountNumber}`
                              : ''}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase">
                            {qrInfo.accountName}
                          </p>
                          <p className="text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300">
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
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30 py-3.5 text-sm font-black transition"
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
                  className="w-full rounded-2xl bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 py-3.5 text-sm font-bold transition"
                >
                  {orderText.orderMoreBtn}
                </button>
              </motion.div>
            ) : (
              <>
                {editingOrder && (
                  <div className="flex items-center justify-between gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-500/15 dark:text-amber-200 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-amber-900 dark:text-amber-300">
                        ✏️ #{editingOrder.order_code} •{' '}
                        {formatTableLabel(editingOrder.table_label, locale)}
                      </p>
                      <p className="text-[11px] text-amber-800 dark:text-amber-100/90">
                        {tx(
                          'Mời quý khách kiểm tra lại món, tăng/giảm số lượng hoặc chọn thêm món trước khi bấm nút gửi đến quầy.',
                          'Please review your items, adjust quantities, or add more dishes before sending to the counter.'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="shrink-0 rounded-xl bg-amber-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-300"
                    >
                      {tx('+ Chọn thêm món', '+ Add Items')}
                    </button>
                  </div>
                )}

                {/* Invalid / Inactive QR Table Resolution Warning */}
                {tableResolutionError && !isSelectionResolved && (
                  <div
                    role="alert"
                    data-testid="modal-table-resolution-warning"
                    className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3.5 text-amber-950 dark:border-amber-500/60 dark:bg-amber-950/50 dark:text-amber-100 space-y-1.5"
                  >
                    <div className="flex items-center gap-2 text-xs font-black text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        {tx(
                          'Cần xác nhận lại bàn phục vụ',
                          'Table confirmation required'
                        )}
                      </span>
                    </div>
                    <p className="text-xs font-semibold leading-relaxed">
                      {tableResolutionError}
                    </p>
                  </div>
                )}

                {/* Tables Load Error Banner */}
                {tablesLoadError && (
                  <div
                    role="alert"
                    data-testid="modal-tables-load-error"
                    className="flex items-center justify-between gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-800 dark:border-rose-700/60 dark:bg-rose-950/50 dark:text-rose-200"
                  >
                    <span>⚠️ {tablesLoadError}</span>
                    {onRetryLoadTables && (
                      <button
                        type="button"
                        onClick={onRetryLoadTables}
                        className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-rose-500"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>{tx('Thử lại', 'Retry')}</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Configured Active Tables + Takeaway Selector & Payment Method */}
                {cart.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90 p-4 space-y-3.5 shadow-2xs">
                    <div
                      role="group"
                      aria-labelledby="modal-table-selector-heading"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span
                          id="modal-table-selector-heading"
                          className="block text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400"
                        >
                          {orderText.tablePrompt}
                        </span>
                        <span
                          data-testid="modal-selected-table-badge"
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${
                            isSelectionResolved
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                          }`}
                        >
                          {currentSelectionDisplay}
                        </span>
                      </div>

                      {isEditingExisting && editingOrder && !hasEditedOrderTable && (
                        <p className="mb-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          {tx(
                            `Đang giữ nguyên vị trí của đơn #${editingOrder.order_code}: `,
                            `Keeping existing table for #${editingOrder.order_code}: `
                          )}
                          <strong className="text-slate-900 dark:text-white">
                            {formatTableLabel(editingOrder.table_label, locale)}
                          </strong>
                        </p>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {activeTables.map((tb) => {
                          const isSelected =
                            (!isEditingExisting || hasEditedOrderTable) &&
                            !localTakeaway &&
                            selectedActiveTable?.id === tb.id;
                          return (
                            <button
                              key={tb.id}
                              type="button"
                              aria-pressed={isSelected}
                              data-testid={`modal-table-chip-${tb.id}`}
                              onClick={() => handleChooseManagedTable(tb)}
                              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                                isSelected
                                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950'
                                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                              }`}
                            >
                              <Utensils className="h-3.5 w-3.5 shrink-0" />
                              <span>{tb.name}</span>
                              {tb.section ? (
                                <span
                                  className={`text-[10px] font-semibold ${
                                    isSelected
                                      ? 'text-emerald-100 dark:text-slate-900'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  ({tb.section})
                                </span>
                              ) : null}
                            </button>
                          );
                        })}

                        {/* Takeaway Option */}
                        <button
                          type="button"
                          aria-pressed={
                            (!isEditingExisting || hasEditedOrderTable) &&
                            localTakeaway
                          }
                          data-testid="modal-table-chip-takeaway"
                          onClick={handleChooseTakeaway}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                            (!isEditingExisting || hasEditedOrderTable) &&
                            localTakeaway
                              ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs dark:border-emerald-500 dark:bg-emerald-500 dark:text-slate-950'
                              : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                          <span>{formatTableLabel('Mang về', locale)}</span>
                        </button>
                      </div>

                      {tables !== undefined &&
                        activeTables.length === 0 &&
                        !tablesLoadError && (
                          <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {tx(
                              'Quán hiện chưa mở bàn tại chỗ. Bạn có thể chọn "Mang về" để gửi đơn.',
                              'No dine-in tables are currently active. You can select "Takeaway" to place your order.'
                            )}
                          </p>
                        )}
                    </div>

                    {/* Payment Method Toggle */}
                    <div
                      role="group"
                      aria-label={tx(
                        'Phương thức thanh toán',
                        'Payment method'
                      )}
                      className="grid grid-cols-2 gap-2 pt-1"
                    >
                      <button
                        type="button"
                        aria-pressed={paymentMethod === 'cash'}
                        onClick={() => setPaymentMethod('cash')}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition ${
                          paymentMethod === 'cash'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                        }`}
                      >
                        <Banknote className="h-4 w-4" />
                        <span>{labels.cashPayment}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={paymentMethod === 'vietqr'}
                        onClick={() => setPaymentMethod('vietqr')}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition ${
                          paymentMethod === 'vietqr'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                        }`}
                      >
                        <QrCode className="h-4 w-4" />
                        <span>{labels.qrPayment}</span>
                      </button>
                    </div>

                    {/* General Order Note */}
                    <div>
                      <label
                        htmlFor="order-customer-note"
                        className="sr-only"
                      >
                        {orderText.noteLabel}
                      </label>
                      <input
                        id="order-customer-note"
                        type="text"
                        value={customerNote}
                        onChange={(e) => setCustomerNote(e.target.value)}
                        placeholder={orderText.notePlaceholder}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                )}

                {locale !== 'vi' && cart.length > 0 && (
                  <p className="px-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    ℹ️ {labels.kitchenBilingualNote}
                  </p>
                )}

                {/* Cart Items List */}
                {cart.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 py-16 px-6 text-center text-slate-600 dark:text-slate-400 shadow-2xs">
                    <p className="text-base font-bold text-slate-800 dark:text-slate-200">
                      {labels.emptyCartTitle}
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="mt-4 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition"
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
                        className="rounded-3xl border border-slate-200 bg-white dark:border-2 dark:border-slate-800 dark:bg-slate-900 p-4 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            {/* Giant Quantity Badge */}
                            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black shadow-xs">
                              <span className="text-[10px] uppercase leading-none font-extrabold">
                                {labels.qtyShort}
                              </span>
                              <span className="text-xl leading-tight">
                                {entry.quantity}
                              </span>
                            </div>

                            <div>
                              {/* Primary Item Name in Customer's Selected Language */}
                              <h3 className="text-base sm:text-lg font-black leading-snug text-slate-900 dark:text-white">
                                {primaryName}
                              </h3>

                              {/* Secondary Vietnamese Name for Kitchen/Counter Accuracy */}
                              {locale !== 'vi' && (
                                <p className="mt-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300/90">
                                  🇻🇳 {entry.item.name_i18n.vi}
                                </p>
                              )}

                              {/* Selected Options */}
                              {entry.selectedChoices.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {entry.selectedChoices.map((c) => (
                                    <span
                                      key={c.id}
                                      className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/90 dark:border-emerald-700/60 dark:text-emerald-300"
                                    >
                                      + {tField(c.label_i18n, locale)}
                                      {locale !== 'vi' &&
                                      c.label_i18n.vi &&
                                      c.label_i18n.vi !==
                                        tField(c.label_i18n, locale)
                                        ? ` (${c.label_i18n.vi})`
                                        : ''}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Dietary / Service Quick Tags */}
                              {entry.quickTags && entry.quickTags.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {entry.quickTags.map((tagVi, tIdx) => {
                                    const matchedTag = quickTagsPool.find(
                                      (qt) => qt.i18n.vi === tagVi
                                    );
                                    const localTag = matchedTag
                                      ? tField(matchedTag.i18n, locale)
                                      : tagVi;
                                    const displayTag =
                                      locale !== 'vi' && localTag !== tagVi
                                        ? `${localTag} (${tagVi})`
                                        : tagVi;

                                    return (
                                      <span
                                        key={tIdx}
                                        className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-extrabold text-amber-800 dark:bg-amber-950/90 dark:border-amber-700/60 dark:text-amber-300"
                                      >
                                        ⚠️ {displayTag}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Custom Note */}
                              {entry.customNote && (
                                <p className="mt-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-800 dark:bg-rose-950/60 dark:border-rose-700/50 dark:text-rose-200">
                                  📝 {labels.notePrefix}: &ldquo;
                                  {entry.customNote}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Bottom Line: Price & Quantity Adjuster */}
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                          <div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {labels.unitPriceLabel}:{' '}
                              {formatCurrency(unitWithExtra, shop.currency)}
                            </span>
                            <p className="text-base font-black text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(lineTotal, shop.currency)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={tx(
                                `Giảm số lượng ${primaryName}`,
                                `Decrease quantity of ${primaryName}`
                              )}
                              onClick={() => onUpdateQuantity(idx, -1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-6 text-center text-sm font-black text-slate-900 dark:text-white">
                              {entry.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={tx(
                                `Tăng số lượng ${primaryName}`,
                                `Increase quantity of ${primaryName}`
                              )}
                              onClick={() => onUpdateQuantity(idx, 1)}
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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
            <div className="border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900 px-4 pt-3.5 pb-6 shrink-0">
              <div className="mx-auto max-w-lg space-y-3">
                {submitError && (
                  <div
                    role="alert"
                    data-testid="modal-submit-error"
                    className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-bold text-rose-800 dark:bg-rose-950/80 dark:border-rose-700 dark:text-rose-200"
                  >
                    ⚠️ {submitError}
                  </div>
                )}

                {promoCalc.discountAmount > 0 && (
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs dark:bg-emerald-950/70 dark:border-emerald-700/60">
                    <span className="font-bold text-emerald-800 dark:text-emerald-300">
                      🎁{' '}
                      {promoCalc.promoTitle ||
                        (PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi)
                          .promoBadge}
                      {promoCalc.voucherCode
                        ? ` (${promoCalc.voucherCode})`
                        : ''}
                    </span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400">
                      -{formatCurrency(promoCalc.discountAmount, shop.currency)}
                    </span>
                  </div>
                )}

                {promoCalc.minOrderNeeded > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:border-amber-700/50 dark:text-amber-300">
                    {(
                      PROMO_LOCALE_TEXT[locale] || PROMO_LOCALE_TEXT.vi
                    ).unlockHint(
                      formatCurrency(promoCalc.minOrderNeeded, shop.currency),
                      promoCalc.promoTitle || ''
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {labels.totalEstimated} ({currentSelectionDisplay})
                  </span>
                  <div className="text-right">
                    {promoCalc.discountAmount > 0 && (
                      <span className="block text-xs text-slate-400 dark:text-slate-500 line-through">
                        {formatCurrency(subtotal, shop.currency)}
                      </span>
                    )}
                    <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
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
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
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
