'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Home,
  Search,
  X,
  Plus,
  Minus,
  Trash2,
  SlidersHorizontal,
  MessageSquarePlus,
  Utensils,
  Banknote,
  QrCode,
  ChevronRight,
  Delete,
  Check,
  Sparkles,
  Maximize2,
  Minimize2,
  Printer,
  Edit3,
} from 'lucide-react';
import {
  CatalogItem,
  Category,
  ItemOptionChoice,
  PaymentMethod,
  Shop,
  ShopOrder,
} from '@/types/qlaok';
import { formatCurrency, QUICK_TAGS_BY_VERTICAL } from '@/lib/i18n-helper';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';

export interface PosOrderLine {
  lineId: string;
  item: CatalogItem;
  quantity: number;
  customUnitPrice?: number;
  discountPercent: number;
  selectedChoices: ItemOptionChoice[];
  quickTags: string[];
  customNote: string;
}

interface PosCounterWorkspaceProps {
  shop: Shop;
  categories: Category[];
  items: CatalogItem[];
  autoPrintOnPay: boolean;
  onOrderCreated: (order: ShopOrder, shouldPrint: boolean) => void;
  onEditCatalogItem?: (item: CatalogItem) => void;
}

const TABLE_PRESETS = [
  'Mang về / Tại quầy',
  'Bàn 01',
  'Bàn 02',
  'Bàn 03',
  'Bàn 04',
  'Bàn 05',
  'Bàn 06',
  'Bàn 07',
  'Bàn 08',
  'Giao hàng (Ship)',
];

export function PosCounterWorkspace({
  shop,
  categories,
  items,
  autoPrintOnPay,
  onOrderCreated,
}: PosCounterWorkspaceProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Ticket State
  const [tableLabel, setTableLabel] = useState('Mang về / Tại quầy');
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [lines, setLines] = useState<PosOrderLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Numpad State ('qty' | 'disc' | 'price')
  const [numpadMode, setNumpadMode] = useState<'qty' | 'disc' | 'price'>('qty');
  const [numpadBuffer, setNumpadBuffer] = useState<string>('');

  // Option & Topping Modal State (when adding a dish with options or editing an existing line's options)
  const [optionModalState, setOptionModalState] = useState<{
    mode: 'add' | 'edit_line';
    item: CatalogItem;
    lineId?: string;
    quantity: number;
    selectedChoices: ItemOptionChoice[];
    quickTags: string[];
    customNote: string;
  } | null>(null);

  // VietQR Payment Confirmation Modal before finalizing POS order if VietQR is chosen
  const [showQrConfirmModal, setShowQrConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const verticalQuickTags = useMemo(
    () => QUICK_TAGS_BY_VERTICAL[shop.vertical] || QUICK_TAGS_BY_VERTICAL.fnb,
    [shop.vertical]
  );

  // Reset numpad buffer when selecting a different line or switching numpad mode
  useEffect(() => {
    setNumpadBuffer('');
  }, [selectedLineId, numpadMode]);

  const selectedLine = useMemo(
    () => lines.find((l) => l.lineId === selectedLineId) || null,
    [lines, selectedLineId]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchCat =
        selectedCategoryId === 'all' || item.category_id === selectedCategoryId;
      if (!matchCat) return false;
      if (!q) return true;
      const vi = (item.name_i18n?.vi || '').toLowerCase();
      const en = (item.name_i18n?.en || '').toLowerCase();
      const desc = (item.desc_i18n?.vi || '').toLowerCase();
      return vi.includes(q) || en.includes(q) || desc.includes(q);
    });
  }, [items, selectedCategoryId, searchQuery]);

  // Calculate line unit price, extra price, and total
  const calcLineAmounts = (line: PosOrderLine) => {
    const basePrice =
      line.customUnitPrice !== undefined
        ? line.customUnitPrice
        : line.item.price;
    const extraPrice = line.selectedChoices.reduce(
      (sum, c) => sum + (c.extra_price || 0),
      0
    );
    const grossUnit = basePrice + extraPrice;
    const discMultiplier = Math.max(
      0,
      Math.min(100, 100 - (line.discountPercent || 0))
    ) / 100;
    const finalLineTotal = Math.round(
      grossUnit * line.quantity * discMultiplier
    );
    const discountSaved = Math.round(
      grossUnit * line.quantity - finalLineTotal
    );
    return {
      basePrice,
      extraPrice,
      grossUnit,
      finalLineTotal,
      discountSaved,
    };
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let grandTotal = 0;
    let totalQty = 0;

    for (const line of lines) {
      const { grossUnit, finalLineTotal, discountSaved } =
        calcLineAmounts(line);
      subtotal += grossUnit * line.quantity;
      totalDiscount += discountSaved;
      grandTotal += finalLineTotal;
      totalQty += line.quantity;
    }

    return { subtotal, totalDiscount, grandTotal, totalQty };
  }, [lines]);

  // Add or merge line into ticket
  const addOrMergeLine = (
    item: CatalogItem,
    quantity: number,
    selectedChoices: ItemOptionChoice[],
    quickTags: string[],
    customNote: string
  ) => {
    const choiceKey = [...selectedChoices]
      .map((c) => c.id)
      .sort()
      .join('|');
    const tagKey = [...quickTags].sort().join('|');
    const noteClean = customNote.trim();

    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => {
        if (l.item.id !== item.id) return false;
        if (l.customUnitPrice !== undefined || l.discountPercent > 0)
          return false;
        const lChoiceKey = [...l.selectedChoices]
          .map((c) => c.id)
          .sort()
          .join('|');
        const lTagKey = [...l.quickTags].sort().join('|');
        return (
          lChoiceKey === choiceKey &&
          lTagKey === tagKey &&
          l.customNote.trim() === noteClean
        );
      });

      if (existingIdx !== -1) {
        const updated = [...prev];
        const target = updated[existingIdx];
        updated[existingIdx] = {
          ...target,
          quantity: target.quantity + quantity,
        };
        setSelectedLineId(target.lineId);
        return updated;
      }

      const newLineId = `line_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const newLine: PosOrderLine = {
        lineId: newLineId,
        item,
        quantity,
        discountPercent: 0,
        selectedChoices,
        quickTags,
        customNote: noteClean,
      };
      setSelectedLineId(newLineId);
      return [...prev, newLine];
    });
  };

  // Handle clicking a product card in the right grid
  const handleProductCardClick = (
    item: CatalogItem,
    forceOpenModal = false
  ) => {
    const isSoldOut =
      !item.is_available ||
      (typeof item.stock_quantity === 'number' && item.stock_quantity <= 0);
    if (isSoldOut) return;

    const hasOptions = Boolean(
      item.options_json && item.options_json.length > 0
    );

    if (hasOptions || forceOpenModal) {
      // Pre-select default choices for required groups
      const defaults: ItemOptionChoice[] = [];
      for (const group of item.options_json || []) {
        if (group.required && group.choices?.length > 0) {
          defaults.push(group.choices[0]);
        }
      }
      setOptionModalState({
        mode: 'add',
        item,
        quantity: 1,
        selectedChoices: defaults,
        quickTags: [],
        customNote: '',
      });
      return;
    }

    // Immediate 1-tap add when item has no option groups
    addOrMergeLine(item, 1, [], [], '');
  };

  // Open Option/Topping modal to edit the currently selected ticket line
  const handleOpenEditSelectedLineModal = (targetLine?: PosOrderLine) => {
    const line = targetLine || selectedLine;
    if (!line) return;
    setOptionModalState({
      mode: 'edit_line',
      item: line.item,
      lineId: line.lineId,
      quantity: line.quantity,
      selectedChoices: [...line.selectedChoices],
      quickTags: [...line.quickTags],
      customNote: line.customNote,
    });
  };

  // Save from Option & Topping Modal
  const handleConfirmOptionModal = () => {
    if (!optionModalState) return;
    const {
      mode,
      item,
      lineId,
      quantity,
      selectedChoices,
      quickTags,
      customNote,
    } = optionModalState;

    if (mode === 'edit_line' && lineId) {
      setLines((prev) =>
        prev.map((l) =>
          l.lineId === lineId
            ? {
                ...l,
                quantity,
                selectedChoices,
                quickTags,
                customNote: customNote.trim(),
              }
            : l
        )
      );
      setSelectedLineId(lineId);
    } else {
      addOrMergeLine(item, quantity, selectedChoices, quickTags, customNote);
    }
    setOptionModalState(null);
  };

  // Toggle choice inside Option Modal
  const toggleModalChoice = (
    groupId: string,
    choice: ItemOptionChoice,
    required: boolean
  ) => {
    if (!optionModalState) return;
    const group = optionModalState.item.options_json?.find(
      (g) => g.id === groupId
    );
    if (!group) return;

    const groupChoiceIds = new Set(group.choices.map((c) => c.id));
    const exists = optionModalState.selectedChoices.some(
      (c) => c.id === choice.id
    );

    if (required) {
      const filtered = optionModalState.selectedChoices.filter(
        (c) => !groupChoiceIds.has(c.id)
      );
      setOptionModalState({
        ...optionModalState,
        selectedChoices: [...filtered, choice],
      });
    } else {
      setOptionModalState({
        ...optionModalState,
        selectedChoices: exists
          ? optionModalState.selectedChoices.filter((c) => c.id !== choice.id)
          : [...optionModalState.selectedChoices, choice],
      });
    }
  };

  const toggleModalQuickTag = (tagLabelVi: string) => {
    if (!optionModalState) return;
    const exists = optionModalState.quickTags.includes(tagLabelVi);
    setOptionModalState({
      ...optionModalState,
      quickTags: exists
        ? optionModalState.quickTags.filter((t) => t !== tagLabelVi)
        : [...optionModalState.quickTags, tagLabelVi],
    });
  };

  // Handle POS Numpad Key Press
  const handleNumpadKey = (key: string) => {
    if (!selectedLine) return;

    if (key === 'BACKSPACE') {
      const nextBuf = numpadBuffer.slice(0, -1);
      setNumpadBuffer(nextBuf);
      const numeric = Number(nextBuf);

      setLines((prev) =>
        prev
          .map((l) => {
            if (l.lineId !== selectedLine.lineId) return l;
            if (numpadMode === 'qty') {
              return { ...l, quantity: nextBuf === '' ? 1 : Math.max(0, numeric) };
            }
            if (numpadMode === 'disc') {
              return {
                ...l,
                discountPercent: nextBuf === '' ? 0 : Math.min(100, numeric),
              };
            }
            return {
              ...l,
              customUnitPrice: nextBuf === '' ? undefined : numeric,
            };
          })
          .filter((l) => l.quantity > 0)
      );
      return;
    }

    if (key === 'PLUS_MINUS') {
      if (numpadMode === 'qty') {
        setLines((prev) =>
          prev.map((l) =>
            l.lineId === selectedLine.lineId
              ? { ...l, quantity: l.quantity + 1 }
              : l
          )
        );
      }
      return;
    }

    const nextBuf = `${numpadBuffer}${key}`;
    const numeric = Number(nextBuf);
    if (isNaN(numeric)) return;
    setNumpadBuffer(nextBuf);

    setLines((prev) =>
      prev
        .map((l) => {
          if (l.lineId !== selectedLine.lineId) return l;
          if (numpadMode === 'qty') {
            return { ...l, quantity: Math.max(1, Math.min(999, numeric)) };
          }
          if (numpadMode === 'disc') {
            return {
              ...l,
              discountPercent: Math.max(0, Math.min(100, numeric)),
            };
          }
          return {
            ...l,
            customUnitPrice: Math.max(0, numeric),
          };
        })
    );
  };

  const updateLineDelta = (lineId: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((l) =>
          l.lineId === lineId ? { ...l, quantity: l.quantity + delta } : l
        )
        .filter((l) => l.quantity > 0)
    );
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => {
      const filtered = prev.filter((l) => l.lineId !== lineId);
      if (selectedLineId === lineId) {
        setSelectedLineId(
          filtered.length > 0 ? filtered[filtered.length - 1].lineId : null
        );
      }
      return filtered;
    });
  };

  // Submit Counter POS Order
  const submitPosOrder = async (markPaidImmediately = true) => {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const payloadItems = lines.map((line) => {
        const { basePrice, extraPrice, discountSaved } = calcLineAmounts(line);
        const noteParts: string[] = [];
        if (line.customNote) noteParts.push(line.customNote);
        if (line.discountPercent > 0) {
          noteParts.push(
            `Giảm ${line.discountPercent}% (-${formatCurrency(
              discountSaved,
              shop.currency
            )})`
          );
        }

        // Adjust unit_price if line has % discount so order total matches exactly
        const effectiveUnitPrice =
          line.discountPercent > 0
            ? Math.max(
                0,
                Math.round(
                  basePrice - discountSaved / Math.max(1, line.quantity)
                )
              )
            : basePrice;

        return {
          item_id: line.item.id,
          name_vi: line.item.name_i18n.vi,
          name_i18n: line.item.name_i18n,
          quantity: line.quantity,
          unit_price: effectiveUnitPrice,
          extra_price: extraPrice,
          selected_choices: line.selectedChoices.map((c) => ({
            id: c.id,
            label_vi: c.label_i18n.vi,
            label_i18n: c.label_i18n,
            extra_price: c.extra_price || 0,
          })),
          custom_note: noteParts.join(' • '),
          quick_tags: line.quickTags,
        };
      });

      const createRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          table_label: tableLabel.trim() || 'Tại quầy',
          visitor_lang: 'vi',
          payment_method: paymentMethod,
          source: 'counter_pos',
          items: payloadItems,
        }),
      });

      if (createRes.ok) {
        const createData = await createRes.json().catch(() => null);
        let createdOrder: ShopOrder | null = createData?.order || null;

        // If cashier clicked Pay at Counter, mark payment_status='paid' right away
        if (createdOrder && markPaidImmediately) {
          const patchRes = await fetch('/api/orders', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shop_id: shop.id,
              order_id: createdOrder.id,
              payment_status: 'paid',
              payment_method: paymentMethod,
            }),
          });
          if (patchRes.ok) {
            const patchData = await patchRes.json().catch(() => null);
            if (patchData?.order) {
              createdOrder = patchData.order;
            } else {
              createdOrder = {
                ...createdOrder,
                payment_status: 'paid',
                payment_method: paymentMethod,
              };
            }
          }
        }

        setLines([]);
        setSelectedLineId(null);
        setShowQrConfirmModal(false);

        if (createdOrder) {
          onOrderCreated(
            createdOrder,
            paymentMethod === 'vietqr' ? true : autoPrintOnPay
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentButtonClick = () => {
    if (lines.length === 0 || submitting) return;
    if (paymentMethod === 'vietqr') {
      // Create order immediately and open ReceiptPrintModal with QR printed on the bill
      submitPosOrder(false);
      return;
    }
    submitPosOrder(true);
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden'
          : 'rounded-3xl border-2 border-slate-300 bg-slate-100 shadow-lg overflow-hidden flex flex-col h-[calc(100vh-145px)] min-h-[680px]'
      }
    >
      {/* Top POS Status & Mode Bar */}
      <div className="flex items-center justify-between gap-3 bg-slate-900 px-4 py-2.5 text-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-black text-slate-950">
            <Sparkles className="h-3.5 w-3.5" />
            <span>POS THU NGÂN</span>
          </span>
          <span className="truncate text-sm font-extrabold text-white">
            {shop.name}
          </span>
          <span className="hidden md:inline-block text-xs text-slate-400">
            • Chọn món bên phải, chỉnh số lượng / chiết khấu / topping bên trái
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/catalog"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
            <span>Cấu hình Option / Topping món</span>
          </Link>

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-slate-700"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Thu nhỏ</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Toàn màn hình POS</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Split-Screen POS Body: Left Ticket + Numpad | Right Category + Product Grid */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ================= LEFT PANE: ORDER TICKET + NUMPAD + PAYMENT ================= */}
        <div className="w-full lg:w-[410px] xl:w-[450px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-300 flex flex-col min-h-0">
          {/* Ticket Top Header: Table / Order Type & Clear Button */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2 shrink-0">
            <div className="relative flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setShowTablePicker((prev) => !prev)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-900 shadow-2xs hover:border-emerald-500"
              >
                <Utensils className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">{tableLabel}</span>
              </button>

              {showTablePicker && (
                <div className="absolute left-0 top-10 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xl space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 px-1">
                    Chọn nhanh Bàn / Mang về:
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TABLE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setTableLabel(preset);
                          setShowTablePicker(false);
                        }}
                        className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${
                          tableLabel === preset
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={tableLabel}
                    onChange={(e) => setTableLabel(e.target.value)}
                    placeholder="Hoặc nhập tên bàn / tên khách..."
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setLines([]);
                  setSelectedLineId(null);
                }}
                className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xóa đơn</span>
              </button>
            )}
          </div>

          {/* Scrollable Order Lines List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 min-h-[180px]">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                <Utensils className="h-10 w-10 stroke-[1.5] mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-600">
                  Phiếu gọi món đang trống
                </p>
                <p className="text-xs text-slate-400 mt-0.5 max-w-[240px]">
                  Bấm vào món ăn/đồ uống ở khung bên phải để thêm vào hóa đơn
                </p>
              </div>
            ) : (
              lines.map((line) => {
                const isSelected = line.lineId === selectedLineId;
                const { basePrice, extraPrice, finalLineTotal } =
                  calcLineAmounts(line);

                return (
                  <div
                    key={line.lineId}
                    onClick={() => setSelectedLineId(line.lineId)}
                    className={`cursor-pointer px-3.5 py-2.5 transition-colors ${
                      isSelected
                        ? 'bg-sky-50/90 border-l-4 border-l-sky-600'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs sm:text-sm font-black text-slate-900 leading-snug">
                        {line.item.name_i18n.vi}
                      </span>
                      <span className="text-xs sm:text-sm font-black text-slate-900 shrink-0">
                        {formatCurrency(finalLineTotal, shop.currency)}
                      </span>
                    </div>

                    {/* Quantity x Unit Price + Discount detail line */}
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-600">
                      <div>
                        <strong className="font-extrabold text-slate-800">
                          {line.quantity}
                        </strong>{' '}
                        Món x {formatCurrency(basePrice, shop.currency)}
                        {extraPrice > 0 && (
                          <span className="text-amber-700 font-bold">
                            {' '}
                            (+Topping {formatCurrency(extraPrice, shop.currency)})
                          </span>
                        )}
                        {line.discountPercent > 0 && (
                          <span className="ml-1.5 inline-flex items-center rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                            Giảm {line.discountPercent}%
                          </span>
                        )}
                      </div>

                      {/* Inline quick +/- controls */}
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => updateLineDelta(line.lineId, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateLineDelta(line.lineId, 1)}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenEditSelectedLineModal(line)}
                          title="Chọn lại Option / Topping / Ghi chú"
                          className="flex h-6 items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Edit3 className="h-2.5 w-2.5" />
                          <span>Option</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(line.lineId)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Selected Options / Toppings / QuickTags / Note badges */}
                    {(line.selectedChoices.length > 0 ||
                      line.quickTags.length > 0 ||
                      line.customNote) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {line.selectedChoices.map((c) => (
                          <span
                            key={c.id}
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              c.extra_price > 0
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-emerald-100 text-emerald-900'
                            }`}
                          >
                            + {c.label_i18n.vi}
                            {c.extra_price > 0
                              ? ` (+${formatCurrency(c.extra_price, shop.currency)})`
                              : ''}
                          </span>
                        ))}
                        {line.quickTags.map((tag, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                          >
                            {tag}
                          </span>
                        ))}
                        {line.customNote && (
                          <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            📝 {line.customNote}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Totals Summary Bar */}
          <div className="border-t-2 border-slate-200 bg-slate-50 px-4 py-2.5 space-y-1 shrink-0">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                Tạm tính ({totals.totalQty} món):
              </span>
              <span className="font-bold text-slate-800">
                {formatCurrency(totals.subtotal, shop.currency)}
              </span>
            </div>
            {totals.totalDiscount > 0 && (
              <div className="flex items-center justify-between text-xs text-rose-600">
                <span>Chiết khấu / Giảm giá:</span>
                <span className="font-bold">
                  -{formatCurrency(totals.totalDiscount, shop.currency)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-0.5">
              <span className="text-sm font-black uppercase text-slate-900">
                Tổng thu (Total):
              </span>
              <span className="text-xl font-black text-emerald-600">
                {formatCurrency(totals.grandTotal, shop.currency)}
              </span>
            </div>
          </div>

          {/* POS Quick Action Buttons Row (Option/Topping, Note, Payment Method Toggle) */}
          <div className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-slate-200 p-1 shrink-0">
            <button
              type="button"
              disabled={!selectedLine}
              onClick={() => handleOpenEditSelectedLineModal()}
              className="flex items-center justify-center gap-1 rounded-lg bg-white py-2 px-2 text-xs font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-45"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-600" />
              <span className="truncate">Option / Topping</span>
            </button>

            <button
              type="button"
              disabled={!selectedLine}
              onClick={() => handleOpenEditSelectedLineModal()}
              className="flex items-center justify-center gap-1 rounded-lg bg-white py-2 px-2 text-xs font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-45"
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-amber-600" />
              <span className="truncate">Ghi chú món</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setPaymentMethod((prev) =>
                  prev === 'cash' ? 'vietqr' : 'cash'
                )
              }
              className={`flex items-center justify-center gap-1 rounded-lg py-2 px-2 text-xs font-black transition ${
                paymentMethod === 'vietqr'
                  ? 'bg-blue-600 text-white'
                  : 'bg-emerald-50 text-emerald-900 border border-emerald-300'
              }`}
            >
              {paymentMethod === 'vietqr' ? (
                <>
                  <QrCode className="h-3.5 w-3.5" />
                  <span className="truncate">CK VietQR</span>
                </>
              ) : (
                <>
                  <Banknote className="h-3.5 w-3.5 text-emerald-700" />
                  <span className="truncate">Tiền mặt</span>
                </>
              )}
            </button>
          </div>

          {/* Bottom POS Dock: Left Big Payment CTA + Right 4x4 Interactive Numpad */}
          <div className="grid grid-cols-12 bg-slate-300 gap-[1px] border-t border-slate-300 shrink-0 select-none">
            {/* Left Payment CTA Column (4 cols) */}
            <button
              type="button"
              disabled={lines.length === 0 || submitting}
              onClick={handlePaymentButtonClick}
              className="col-span-4 flex flex-col items-center justify-center gap-1.5 bg-emerald-600 p-3 text-white transition hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
                <ChevronRight className="h-7 w-7" />
              </div>
              <span className="text-xs sm:text-sm font-black uppercase tracking-wide text-center leading-tight">
                {submitting
                  ? 'Đang lưu...'
                  : paymentMethod === 'vietqr'
                    ? 'In Bill Kèm QR'
                    : 'Thanh Toán'}
              </span>
              <span className="text-[11px] font-bold text-emerald-100 text-center">
                {paymentMethod === 'vietqr'
                  ? '🖨️ In mã QR ra bill'
                  : autoPrintOnPay
                    ? '🖨️ Tự động in bill'
                    : 'Lưu & Báo bếp'}
              </span>
            </button>

            {/* Right 4x4 Numpad Grid (8 cols) */}
            <div className="col-span-8 grid grid-cols-4 gap-[1px] bg-slate-300">
              {['1', '2', '3'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleNumpadKey(digit)}
                  className="bg-white py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50 active:bg-slate-200"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNumpadMode('qty')}
                className={`py-2.5 text-xs font-black transition ${
                  numpadMode === 'qty'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                SL (Qty)
              </button>

              {['4', '5', '6'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleNumpadKey(digit)}
                  className="bg-white py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50 active:bg-slate-200"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNumpadMode('disc')}
                className={`py-2.5 text-xs font-black transition ${
                  numpadMode === 'disc'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                % Giảm
              </button>

              {['7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleNumpadKey(digit)}
                  className="bg-white py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50 active:bg-slate-200"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setNumpadMode('price')}
                className={`py-2.5 text-xs font-black transition ${
                  numpadMode === 'price'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Giá
              </button>

              <button
                type="button"
                onClick={() => handleNumpadKey('PLUS_MINUS')}
                className="bg-slate-100 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-200"
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => handleNumpadKey('0')}
                className="bg-white py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50 active:bg-slate-200"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => handleNumpadKey('000')}
                className="bg-white py-2.5 text-xs font-black text-slate-900 hover:bg-slate-50 active:bg-slate-200"
              >
                000
              </button>
              <button
                type="button"
                onClick={() => handleNumpadKey('BACKSPACE')}
                className="flex items-center justify-center bg-slate-100 py-2.5 text-slate-700 hover:bg-rose-50 hover:text-rose-600"
              >
                <Delete className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ================= RIGHT PANE: CATEGORY BAR + SEARCH + PRODUCT GRID ================= */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-100">
          {/* Top Category Breadcrumb + Search Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-200 bg-white px-4 py-2.5 shrink-0">
            {/* Category Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`inline-flex items-center gap-1.5 shrink-0 rounded-xl px-3 py-2 text-xs font-black transition ${
                  selectedCategoryId === 'all'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Home className="h-3.5 w-3.5" />
                <span>Tất cả ({items.length})</span>
              </button>

              {categories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                      active
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {cat.name_i18n.vi}
                  </button>
                );
              })}
            </div>

            {/* Instant Search Box */}
            <div className="relative w-full sm:w-64 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm món ăn, đồ uống..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 py-1.5 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Visual Product Cards Grid */}
          <div className="flex-1 overflow-y-auto p-3.5">
            {filteredItems.length === 0 ? (
              <div className="flex h-60 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <p className="text-sm font-bold text-slate-700">
                  Không tìm thấy món phù hợp
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Hãy thử từ khóa khác hoặc chọn danh mục &ldquo;Tất cả&rdquo;
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {filteredItems.map((item) => {
                  const stock = item.stock_quantity;
                  const isSoldOut =
                    !item.is_available ||
                    (typeof stock === 'number' && stock <= 0);
                  const hasOptions = Boolean(
                    item.options_json && item.options_json.length > 0
                  );
                  const inTicketQty = lines
                    .filter((l) => l.item.id === item.id)
                    .reduce((s, l) => s + l.quantity, 0);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleProductCardClick(item, false)}
                      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-2xs transition-all select-none ${
                        isSoldOut
                          ? 'border-slate-200 opacity-50 cursor-not-allowed'
                          : inTicketQty > 0
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 cursor-pointer hover:shadow-md active:scale-[0.98]'
                            : 'border-slate-200/90 cursor-pointer hover:border-emerald-400 hover:shadow-md active:scale-[0.98]'
                      }`}
                    >
                      {/* Product Image Area */}
                      <div className="relative h-28 w-full bg-slate-100 overflow-hidden">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.name_i18n.vi}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl bg-slate-100">
                            🍜
                          </div>
                        )}

                        {/* Top-Right Price Badge (Odoo/Viindoo POS style) */}
                        <span className="absolute right-2 top-2 rounded-lg bg-emerald-600/95 px-2 py-0.5 text-[11px] font-black text-white shadow-xs backdrop-blur-2xs">
                          {formatCurrency(item.price, shop.currency)}
                        </span>

                        {/* Top-Left Quantity in Ticket or Stock Badge */}
                        {inTicketQty > 0 ? (
                          <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-600 px-1.5 text-xs font-black text-white shadow-sm">
                            {inTicketQty}
                          </span>
                        ) : (
                          stock !== null &&
                          stock !== undefined && (
                            <span
                              className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white ${
                                stock <= 5
                                  ? 'bg-amber-600'
                                  : 'bg-slate-900/70'
                              }`}
                            >
                              Kho: {stock}
                            </span>
                          )
                        )}

                        {/* Bottom-Right Quick Option / Note Button */}
                        {!isSoldOut && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProductCardClick(item, true);
                            }}
                            title="Chọn Option / Độ ngọt / Đá / Topping / Ghi chú"
                            className={`absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold shadow-xs transition ${
                              hasOptions
                                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                : 'bg-slate-900/75 text-white hover:bg-slate-900'
                            }`}
                          >
                            <SlidersHorizontal className="h-2.5 w-2.5" />
                            <span>
                              {hasOptions
                                ? `${item.options_json!.length} Option`
                                : 'Ghi chú'}
                            </span>
                          </button>
                        )}

                        {isSoldOut && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
                            <span className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-black text-white uppercase">
                              Hết hàng
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Product Title & Description & Option Preview */}
                      <div className="flex flex-1 flex-col justify-between p-2.5 space-y-1">
                        <div>
                          <h4 className="line-clamp-2 text-xs font-extrabold text-slate-900 leading-snug">
                            {item.name_i18n.vi}
                          </h4>
                          {item.desc_i18n?.vi && (
                            <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-500">
                              {item.desc_i18n.vi}
                            </p>
                          )}
                        </div>

                        {hasOptions && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {item.options_json!.slice(0, 2).map((g) => (
                              <span
                                key={g.id}
                                className="inline-flex items-center rounded bg-amber-50 border border-amber-200/80 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 truncate max-w-full"
                              >
                                {g.name_i18n.vi}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= POS OPTION, TOPPING & NOTE PICKER MODAL ================= */}
      {optionModalState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                  {optionModalState.mode === 'edit_line'
                    ? 'Chỉnh sửa Option / Topping món'
                    : 'Chọn Option / Topping & Ghi chú'}
                </span>
                <h3 className="truncate text-base sm:text-lg font-black">
                  {optionModalState.item.name_i18n.vi} —{' '}
                  <span className="text-emerald-400">
                    {formatCurrency(optionModalState.item.price, shop.currency)}
                  </span>
                </h3>
                {optionModalState.item.desc_i18n?.vi && (
                  <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">
                    {optionModalState.item.desc_i18n.vi}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOptionModalState(null)}
                className="rounded-full bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body: Option Groups + Quick Tags + Custom Note */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Configured Option & Topping Groups */}
              {optionModalState.item.options_json &&
              optionModalState.item.options_json.length > 0 ? (
                <div className="space-y-4">
                  {optionModalState.item.options_json.map((group) => (
                    <div
                      key={group.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wide text-slate-900">
                            {group.name_i18n.vi}
                          </h4>
                          {group.desc_i18n?.vi && (
                            <p className="text-[11px] text-slate-500">
                              {group.desc_i18n.vi}
                            </p>
                          )}
                        </div>
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                            group.required
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {group.required
                            ? 'Bắt buộc (Chọn 1)'
                            : 'Chọn thêm / Topping (Chọn nhiều)'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {group.choices.map((choice) => {
                          const isSelected =
                            optionModalState.selectedChoices.some(
                              (c) => c.id === choice.id
                            );
                          return (
                            <button
                              key={choice.id}
                              type="button"
                              onClick={() =>
                                toggleModalChoice(
                                  group.id,
                                  choice,
                                  group.required
                                )
                              }
                              className={`flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                                isSelected
                                  ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/20'
                                  : 'border-slate-200 bg-white hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <span className="text-xs font-extrabold text-slate-900 leading-snug">
                                  {choice.label_i18n.vi}
                                </span>
                                <span
                                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                    isSelected
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-slate-300'
                                  }`}
                                >
                                  {isSelected && (
                                    <Check className="h-2.5 w-2.5" />
                                  )}
                                </span>
                              </div>

                              {choice.desc_i18n?.vi && (
                                <p className="mt-0.5 text-[10px] text-slate-500 line-clamp-1">
                                  {choice.desc_i18n.vi}
                                </p>
                              )}

                              <div className="mt-1.5">
                                {choice.extra_price > 0 ? (
                                  <span className="inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-900">
                                    +{formatCurrency(choice.extra_price, shop.currency)}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-semibold text-slate-400">
                                    +0đ
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 flex items-center justify-between gap-2">
                  <span>
                    Món này chưa cấu hình nhóm Option/Topping có cộng tiền riêng.
                  </span>
                  <Link
                    href="/dashboard/catalog"
                    className="shrink-0 font-bold text-emerald-700 underline"
                  >
                    + Cấu hình trong Menu
                  </Link>
                </div>
              )}

              {/* Fast Counter Quick Tags (Ít đá, Ít đường, Không hành, Mang về...) */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600">
                  Ghi chú nhanh tại quầy (Bấm để chọn):
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Ít đường',
                    'Nhiều đường',
                    'Không đường',
                    'Ít đá',
                    'Đá riêng',
                    'Không đá',
                    ...verticalQuickTags.map((t) => t.i18n.vi),
                  ]
                    .filter((v, idx, arr) => arr.indexOf(v) === idx)
                    .map((tagVi) => {
                      const active =
                        optionModalState.quickTags.includes(tagVi);
                      return (
                        <button
                          key={tagVi}
                          type="button"
                          onClick={() => toggleModalQuickTag(tagVi)}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {tagVi}
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Custom Free-Text Note */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Ghi chú thêm cho pha chế / bếp:
                </label>
                <input
                  type="text"
                  value={optionModalState.customNote}
                  onChange={(e) =>
                    setOptionModalState({
                      ...optionModalState,
                      customNote: e.target.value,
                    })
                  }
                  placeholder="VD: Làm ấm, để riêng nước sốt, khách dị ứng đậu phộng..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Modal Footer: Quantity + Confirm Button */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              <div className="flex items-center rounded-2xl border border-slate-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() =>
                    setOptionModalState({
                      ...optionModalState,
                      quantity: Math.max(1, optionModalState.quantity - 1),
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-9 text-center text-sm font-black text-slate-900">
                  {optionModalState.quantity}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setOptionModalState({
                      ...optionModalState,
                      quantity: optionModalState.quantity + 1,
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {(() => {
                const extraSum = optionModalState.selectedChoices.reduce(
                  (s, c) => s + (c.extra_price || 0),
                  0
                );
                const modalTotal =
                  (optionModalState.item.price + extraSum) *
                  optionModalState.quantity;
                return (
                  <button
                    type="button"
                    onClick={handleConfirmOptionModal}
                    className="flex-1 flex items-center justify-between rounded-2xl bg-emerald-600 px-5 py-3 text-xs sm:text-sm font-black text-white shadow-md hover:bg-emerald-500"
                  >
                    <span>
                      {optionModalState.mode === 'edit_line'
                        ? 'Cập nhật dòng món'
                        : 'Thêm vào phiếu POS'}
                    </span>
                    <span>{formatCurrency(modalTotal, shop.currency)}</span>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ================= VIETQR COUNTER PAYMENT MODAL ================= */}
      {showQrConfirmModal &&
        (() => {
          const qrInfo = getShopPaymentQrInfo(
            shop,
            totals.grandTotal,
            `POS ${tableLabel}`
          );
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
              <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4 text-center">
                <div className="flex items-center justify-between">
                  <span className="rounded-xl bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">
                    💳 Thanh toán QR tại quầy • {tableLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowQrConfirmModal(false)}
                    className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div
                  style={{ backgroundColor: '#ffffff' }}
                  className="mx-auto w-56 h-56 rounded-2xl border border-slate-200 p-2 bg-white shadow-inner flex items-center justify-center"
                >
                  <img
                    src={qrInfo.qrImageUrl}
                    alt="POS VietQR"
                    className="w-full h-full object-contain"
                  />
                </div>

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
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500">Tổng thu khách:</span>
                    <span className="text-sm font-black text-emerald-600">
                      {formatCurrency(totals.grandTotal, shop.currency)}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitPosOrder(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Printer className="h-4 w-4" />
                    <span>
                      {submitting
                        ? 'Đang lưu...'
                        : 'Đã nhận chuyển khoản & In Hóa Đơn'}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitPosOrder(false)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    <span>Tạo đơn chờ thanh toán (In mã QR trên bill)</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
