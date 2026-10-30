'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  ShopTable,
} from '@/types/qlaok';
import { formatCurrency, QUICK_TAGS_BY_VERTICAL } from '@/lib/i18n-helper';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { getAuthHeaders } from '@/lib/auth-session';
import { filterSelectableTables } from '@/lib/table-helpers';
import {
  buildPosOrderDiscountPayload,
  calculateOrderDiscountTotals,
  getStoredManualDiscountAmount,
  getStoredPromoDiscountAmount,
} from '@/lib/order-discounts';
import {
  clearPendingPosOrder,
  clearConfirmedPosOrder,
  posRecoveryStorageKey,
  readPendingPosOrder,
  savePendingPosOrder,
  sendPendingPosOrder,
  subscribePosRecoveryChanges,
  withPosRecoveryLock,
  type PendingPosOrder,
  type PendingRead,
  type PosRecoveryChannelMessage,
} from '@/lib/pos-order-recovery';

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
  accountId?: string | null;
  categories: Category[];
  items: CatalogItem[];
  tables?: ShopTable[];
  orders?: ShopOrder[];
  editingOrder?: ShopOrder | null;
  autoPrintOnPay: boolean;
  canApplyDiscount: boolean;
  onOrderCreated: (order: ShopOrder, shouldPrint: boolean) => void;
  onCancelEditOrder?: () => void;
  onPrintOrder?: (order: ShopOrder) => void;
  onUpdateOrder?: (
    orderId: string,
    updates: {
      status?: 'new' | 'preparing' | 'completed' | 'cancelled';
      payment_status?: 'unpaid' | 'paid' | 'refunded';
    }
  ) => Promise<unknown>;
  onEditCatalogItem?: (item: CatalogItem) => void;
}

const NON_TABLE_PRESETS = ['Mang về / Tại quầy', 'Giao hàng (Ship)'] as const;

function formatTablePresetLabel(label: string, locale: 'vi' | 'en'): string {
  if (locale === 'vi') return label;
  if (label === 'Mang về / Tại quầy') return 'Takeaway / Counter';
  if (label === 'Mang về') return 'Takeaway';
  if (label === 'Tại quầy') return 'Counter';
  if (label === 'Giao hàng (Ship)') return 'Delivery';
  const match = /^Bàn\s+(\d+)$/i.exec(label.trim());
  if (match) return `Table ${match[1]}`;
  return label;
}

function getVnDateKey(dateInput: Date | string | number = new Date()): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function hydratePosLinesFromOrder(
  order: ShopOrder,
  catalogItems: CatalogItem[],
  shopId: string
): PosOrderLine[] {
  return (order.items || []).map((line, idx) => {
    const matched = catalogItems.find((i) => i.id === line.item_id);
    const fallbackItem: CatalogItem = matched || {
      id: line.item_id || `custom-${idx}`,
      shop_id: shopId,
      category_id: catalogItems[0]?.category_id || 'cat-default',
      sort_order: idx + 1,
      price: Number(line.unit_price || 0),
      compare_at_price: null,
      unit_i18n: { vi: 'phần', en: 'portion', ko: '인분', ja: '人前', zh: '份' },
      duration_mins: null,
      image_url: null,
      is_available: true,
      is_featured: false,
      name_i18n: line.name_i18n || {
        vi: line.name_vi,
        en: line.name_vi,
        ko: line.name_vi,
        ja: line.name_vi,
        zh: line.name_vi,
      },
      desc_i18n: { vi: '', en: '', ko: '', ja: '', zh: '' },
      options_json: [],
      view_count: 0,
      created_at: new Date().toISOString(),
    };

    const normalizedChoices: ItemOptionChoice[] = (
      line.selected_choices || []
    ).map((rawChoice, cIdx) => {
      if (typeof rawChoice === 'string') {
        return {
          id: `ch_${cIdx}_${rawChoice}`,
          label_i18n: {
            vi: rawChoice,
            en: rawChoice,
            ko: rawChoice,
            ja: rawChoice,
            zh: rawChoice,
          },
          extra_price: 0,
        };
      }
      const labelVi =
        rawChoice.label_i18n?.vi ||
        (rawChoice as { label_vi?: string }).label_vi ||
        'Tùy chọn';
      return {
        id: rawChoice.id || `ch_${cIdx}_${labelVi}`,
        label_i18n: rawChoice.label_i18n || {
          vi: labelVi,
          en: labelVi,
          ko: labelVi,
          ja: labelVi,
          zh: labelVi,
        },
        extra_price: Number(rawChoice.extra_price || 0),
      };
    });

    const lineUnitPrice = Number(line.unit_price ?? fallbackItem.price);
    const hasCustomPrice = lineUnitPrice !== Number(fallbackItem.price);

    return {
      lineId: `edit_${order.id}_${idx}_${Date.now()}`,
      item: fallbackItem,
      quantity: Math.max(1, Number(line.quantity || 1)),
      customUnitPrice: hasCustomPrice ? lineUnitPrice : undefined,
      discountPercent: 0,
      selectedChoices: normalizedChoices,
      quickTags: Array.isArray(line.quick_tags) ? [...line.quick_tags] : [],
      customNote: (line.custom_note || '').replace(
        /\s*•?\s*Giảm \d+% \(-[^)]+\)/g,
        ''
      ),
    };
  });
}

export type PosNumpadMode = 'qty' | 'disc' | 'price';

/** Percent discount and custom price both require `canApplyDiscount`. */
export function isNumpadModeAllowed(
  mode: PosNumpadMode,
  canApplyDiscount: boolean
): boolean {
  return mode === 'qty' || canApplyDiscount;
}

export function PosCounterWorkspace({
  shop,
  accountId,
  categories,
  items,
  tables: initialTables,
  orders = [],
  editingOrder = null,
  autoPrintOnPay,
  canApplyDiscount,
  onOrderCreated,
  onCancelEditOrder,
  onPrintOrder,
  onUpdateOrder,
}: PosCounterWorkspaceProps) {
  const { locale, t, tx } = useAppI18n();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Managed Shop Tables state
  const [managedTables, setManagedTables] = useState<ShopTable[]>(() =>
    filterSelectableTables(initialTables || [], shop.id)
  );
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tablesRetryTick, setTablesRetryTick] = useState(0);

  useEffect(() => {
    if (Array.isArray(initialTables)) {
      setManagedTables(filterSelectableTables(initialTables, shop.id));
    }
  }, [initialTables, shop.id]);

  useEffect(() => {
    const targetShopId = shop.id;
    if (!targetShopId) return;
    let cancelled = false;
    setTablesLoading(true);
    setTablesError(null);

    fetch(`/api/tables?shopId=${encodeURIComponent(targetShopId)}`, {
      headers: getAuthHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data || !Array.isArray(data.tables)) {
          setTablesError(
            data?.error ||
              tx(
                'Không tải được danh sách bàn đã cấu hình.',
                'Failed to load configured tables.'
              )
          );
          return;
        }
        setManagedTables(filterSelectableTables(data.tables, targetShopId));
      })
      .catch(() => {
        if (!cancelled) {
          setTablesError(
            tx(
              'Lỗi mạng khi tải danh sách bàn.',
              'Network error loading tables.'
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // Intentionally omit tx so switching locale never refetches or resets POS draft state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id, tablesRetryTick]);

  // Active order currently being edited inside POS Terminal
  const [activeEditingOrder, setActiveEditingOrder] =
    useState<ShopOrder | null>(editingOrder);

  // Ticket State
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableLabel, setTableLabel] = useState('Mang về / Tại quầy');
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [lines, setLines] = useState<PosOrderLine[]>([]);
  const [inheritedDiscounts, setInheritedDiscounts] = useState({
    manual: 0,
    promo: 0,
  });
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Load editingOrder prop into POS ticket whenever editingOrder changes
  const loadOrderIntoPos = (targetOrder: ShopOrder) => {
    setActiveEditingOrder(targetOrder);
    setSelectedTableId(targetOrder.table_id ?? null);
    setTableLabel(targetOrder.table_label || 'Mang về / Tại quầy');
    setPaymentMethod(targetOrder.payment_method || 'cash');
    setInheritedDiscounts({
      manual: getStoredManualDiscountAmount(targetOrder),
      promo: getStoredPromoDiscountAmount(targetOrder),
    });
    const hydrated = hydratePosLinesFromOrder(targetOrder, items, shop.id);
    setLines(hydrated);
    setSelectedLineId(hydrated[0]?.lineId || null);
    setShowTodayOrdersModal(false);
    setSubmitError(null);
  };

  const clearEditingOrder = () => {
    setActiveEditingOrder(null);
    setLines([]);
    setInheritedDiscounts({ manual: 0, promo: 0 });
    setSelectedLineId(null);
    setSelectedTableId(null);
    setTableLabel('Mang về / Tại quầy');
    setSubmitError(null);
    onCancelEditOrder?.();
  };

  useEffect(() => {
    if (editingOrder) {
      loadOrderIntoPos(editingOrder);
    } else {
      setActiveEditingOrder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingOrder?.id]);

  // Numpad State ('qty' | 'disc' | 'price')
  const [numpadMode, setNumpadMode] = useState<PosNumpadMode>('qty');

  useEffect(() => {
    if (!isNumpadModeAllowed(numpadMode, canApplyDiscount)) {
      setNumpadMode('qty');
    }
  }, [canApplyDiscount, numpadMode]);
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

  // VietQR Payment Confirmation Modal & Today POS Orders Drawer
  const [showQrConfirmModal, setShowQrConfirmModal] = useState(false);
  const [showTodayOrdersModal, setShowTodayOrdersModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const recoveryContext = `${accountId || ''}\u0000${shop.id}`;
  const currentRecoveryContext = useRef(recoveryContext);
  currentRecoveryContext.current = recoveryContext;
  const [loadedRecoveryContext, setLoadedRecoveryContext] = useState('');
  const [recovery, setRecovery] = useState<PendingRead>({ kind: 'unavailable' });
  const recoveryReadSeq = useRef(0);
  const originatedPendingKeyRef = useRef<string | null>(null);

  const getSafeLocalStorage = (): Storage | null => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  };

  const getSafeIndexedDb = (): IDBFactory | undefined => {
    try {
      return typeof window !== 'undefined' ? window.indexedDB : undefined;
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    originatedPendingKeyRef.current = null;
    setSubmitError(null);
    const targetContext = recoveryContext;
    if (!accountId || !shop.id) {
      recoveryReadSeq.current += 1;
      setRecovery({ kind: 'unavailable' });
      setLoadedRecoveryContext(targetContext);
      return;
    }
    let cancelled = false;
    const key = posRecoveryStorageKey(accountId, shop.id);

    const refreshFromStore = (message?: PosRecoveryChannelMessage) => {
      const seq = ++recoveryReadSeq.current;
      void readPendingPosOrder(
        getSafeIndexedDb(),
        accountId,
        shop.id,
        getSafeLocalStorage(),
      ).then((next) => {
        if (cancelled || currentRecoveryContext.current !== targetContext || recoveryReadSeq.current !== seq) return;
        if (
          next.kind === 'empty' &&
          message?.reason === 'confirmed' &&
          message.requestKey &&
          originatedPendingKeyRef.current === message.requestKey
        ) {
          originatedPendingKeyRef.current = null;
          setLines([]);
          setInheritedDiscounts({ manual: 0, promo: 0 });
          setSelectedLineId(null);
          setShowQrConfirmModal(false);
          setActiveEditingOrder(null);
          onCancelEditOrder?.();
        }
        if (next.kind === 'empty') {
          setSubmitError(null);
        }
        setRecovery(next);
        setLoadedRecoveryContext(targetContext);
      });
    };

    refreshFromStore();

    const unsubscribeChannel = subscribePosRecoveryChanges(accountId, shop.id, (message) => {
      refreshFromStore(message);
    });

    const onStorage = (event: StorageEvent) => {
      try {
        if (event.key !== key && event.key !== null) return;
        refreshFromStore();
      } catch {
        setRecovery({ kind: 'unavailable' });
      }
    };

    const onFocusOrVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshFromStore();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      cancelled = true;
      unsubscribeChannel();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, shop.id, recoveryContext]);

  const todayStats = useMemo(() => {
    const todayKey = getVnDateKey();
    const validToday = orders.filter(
      (o) => o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayKey
    );
    const paidToday = validToday.filter((o) => o.payment_status === 'paid');
    const revenue = paidToday.reduce(
      (s, o) => s + Number(o.total_amount || 0),
      0
    );
    const cashRev = paidToday
      .filter((o) => o.payment_method === 'cash')
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const qrRev = paidToday
      .filter((o) => o.payment_method !== 'cash')
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    return {
      todayOrders: validToday,
      count: validToday.length,
      revenue,
      cashRev,
      qrRev,
    };
  }, [orders]);

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

  // Calculate line unit price, extra price, and total against catalog price
  const calcLineAmounts = (line: PosOrderLine) => {
    const catalogPrice = Math.max(0, Number(line.item.price || 0));
    const basePrice =
      line.customUnitPrice !== undefined
        ? Math.max(0, Number(line.customUnitPrice))
        : catalogPrice;
    const extraPrice = line.selectedChoices.reduce(
      (sum, c) => sum + (c.extra_price || 0),
      0
    );
    const catalogGrossUnit = catalogPrice + extraPrice;
    const grossUnit = basePrice + extraPrice;
    const discMultiplier =
      Math.max(0, Math.min(100, 100 - (line.discountPercent || 0))) / 100;
    const finalLineTotal = Math.round(
      grossUnit * line.quantity * discMultiplier
    );
    const discountSaved = Math.max(
      0,
      Math.round(catalogGrossUnit * line.quantity - finalLineTotal)
    );
    return {
      catalogPrice,
      basePrice,
      extraPrice,
      catalogGrossUnit,
      grossUnit,
      finalLineTotal,
      discountSaved,
    };
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalQty = 0;

    for (const line of lines) {
      const { catalogGrossUnit, discountSaved } = calcLineAmounts(line);
      subtotal += catalogGrossUnit * line.quantity;
      totalDiscount += discountSaved;
      totalQty += line.quantity;
    }

    const discountTotals = calculateOrderDiscountTotals({
      subtotalAmount: subtotal,
      lineManualDiscountAmount: totalDiscount,
      inheritedManualDiscountAmount: inheritedDiscounts.manual,
      promoDiscountAmount: inheritedDiscounts.promo,
    });

    return {
      subtotal,
      totalDiscount: discountTotals.discountAmount,
      manualDiscountAmount: discountTotals.manualDiscountAmount,
      promoDiscountAmount: discountTotals.promoDiscountAmount,
      grandTotal: discountTotals.totalAmount,
      totalQty,
    };
  }, [lines, inheritedDiscounts]);

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
    if (!isNumpadModeAllowed(numpadMode, canApplyDiscount)) return;

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

  const resetPosTicketDraft = () => {
    setLines([]);
    setInheritedDiscounts({ manual: 0, promo: 0 });
    setSelectedLineId(null);
    setShowQrConfirmModal(false);
    setActiveEditingOrder(null);
    onCancelEditOrder?.();
  };

  const finishSavedOrder = (order: ShopOrder, shouldPrint: boolean, clearTicket = true) => {
    if (clearTicket) {
      resetPosTicketDraft();
    }
    onOrderCreated(order, shouldPrint);
  };

  const resolvePendingOrder = async (pending: PendingPosOrder) => {
    const result = await sendPendingPosOrder(pending, (body) => fetch('/api/orders', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body,
    }));
    if (currentRecoveryContext.current !== `${pending.accountId}\u0000${pending.shopId}`) return;
    if (result.kind === 'confirmed') {
      try {
        const cleared = await withPosRecoveryLock(navigator.locks, pending.accountId, pending.shopId,
          () => clearConfirmedPosOrder(getSafeIndexedDb(), pending, getSafeLocalStorage()));
        if (currentRecoveryContext.current !== `${pending.accountId}\u0000${pending.shopId}`) return;
        const originatedHere = originatedPendingKeyRef.current === pending.key;
        if (cleared === 'cleared') {
          if (originatedHere) originatedPendingKeyRef.current = null;
          recoveryReadSeq.current += 1;
          setRecovery({ kind: 'empty' });
          setSubmitError(null);
          finishSavedOrder(result.order, pending.openReceipt, originatedHere || lines.length === 0);
          return;
        }
        if (cleared === 'already-cleared') {
          // Another tab completed this same request; clear draft if originated here, otherwise preserve this tab's separate draft.
          if (originatedHere) {
            originatedPendingKeyRef.current = null;
            resetPosTicketDraft();
          }
          recoveryReadSeq.current += 1;
          setRecovery({ kind: 'empty' });
          setSubmitError(null);
          return;
        }
      } catch {
        // Keep the pending request if browser storage cannot be cleared.
      }
      setSubmitError(tx('Đã nhận kết quả đơn nhưng không thể xóa yêu cầu chờ. Vui lòng thử lại.', 'The order was received but the pending request could not be cleared. Please retry.'));
      return;
    }
    setSubmitError(tx('Chưa xác nhận được kết quả. Đơn có thể đã được tạo; hãy kiểm tra hoặc thử lại yêu cầu này.', 'The result is not confirmed. The order may already exist; check it or retry this request.'));
  };

  const retryPendingOrder = async () => {
    if (recovery.kind !== 'pending' || submissionLock.current || loadedRecoveryContext !== recoveryContext) return;
    submissionLock.current = true;
    setSubmitting(true);
    try {
      await resolvePendingOrder(recovery.request);
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  // Submit Counter POS Order (Creates new order OR updates existing unpaid order)
  const submitPosOrder = async (
    markPaidImmediately = true,
    shouldOpenReceipt?: boolean
  ) => {
    if (lines.length === 0 || submitting || submissionLock.current ||
        loadedRecoveryContext !== recoveryContext || recovery.kind !== 'empty') return;
    submissionLock.current = true;
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

      setSubmitError(null);

      const isEditing = Boolean(activeEditingOrder);
      const discountPayload = buildPosOrderDiscountPayload({
        manualDiscountAmount: totals.manualDiscountAmount,
        totalAmount: totals.grandTotal,
      });
      if (!isEditing) {
        if (!accountId || typeof window.crypto?.randomUUID !== 'function') {
          setSubmitError(tx('Không thể chuẩn bị đơn an toàn. Vui lòng tải lại trang.', 'Could not prepare the order safely. Please reload the page.'));
          return;
        }
        const key = `pos-web:${window.crypto.randomUUID()}`;
        const body = JSON.stringify({
          shop_id: shop.id,
          table_id: selectedTableId,
          table_label: tableLabel.trim() || 'Tại quầy',
          visitor_lang: 'vi',
          payment_method: paymentMethod,
          payment_status: markPaidImmediately ? 'paid' : 'unpaid',
          source: 'counter_pos',
          items: payloadItems,
          ...discountPayload,
          idempotency_key: key,
        });
        const pending: PendingPosOrder = {
          version: 1, accountId, shopId: shop.id, key, body,
          openReceipt: typeof shouldOpenReceipt === 'boolean'
            ? shouldOpenReceipt : paymentMethod === 'vietqr' ? true : autoPrintOnPay,
        };
        try {
          const outcome = await withPosRecoveryLock(navigator.locks, accountId, shop.id, async () => {
            if (currentRecoveryContext.current !== `${accountId}\u0000${shop.id}`) {
              return { saved: false, state: { kind: 'unavailable' as const } };
            }
            const saved = await savePendingPosOrder(getSafeIndexedDb(), pending, getSafeLocalStorage());
            if (saved) {
              return { saved: true, state: { kind: 'pending' as const, request: pending } };
            }
            const existing = await readPendingPosOrder(getSafeIndexedDb(), accountId, shop.id, getSafeLocalStorage());
            return {
              saved: false,
              state: existing.kind === 'empty' ? { kind: 'unavailable' as const } : existing,
            };
          });
          if (currentRecoveryContext.current !== `${accountId}\u0000${shop.id}`) return;
          if (!outcome.saved) {
            recoveryReadSeq.current += 1;
            setRecovery(outcome.state);
            setSubmitError(tx('Không thể lưu yêu cầu chờ an toàn. Vui lòng kiểm tra bộ nhớ trình duyệt.', 'Could not safely save the pending request. Please check browser storage.'));
            return;
          }
        } catch {
          recoveryReadSeq.current += 1;
          setRecovery({ kind: 'unavailable' });
          setSubmitError(tx('Không thể truy cập bộ nhớ trình duyệt.', 'Browser storage is unavailable.'));
          return;
        }
        originatedPendingKeyRef.current = pending.key;
        recoveryReadSeq.current += 1;
        setRecovery({ kind: 'pending', request: pending });
        await resolvePendingOrder(pending);
        return;
      }

      const res = await fetch('/api/orders', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(
          activeEditingOrder
            ? {
                order_id: activeEditingOrder.id,
                table_id: selectedTableId,
                table_label:
                  tableLabel.trim() ||
                  activeEditingOrder.table_label ||
                  'Tại quầy',
                payment_method: paymentMethod,
                payment_status: markPaidImmediately
                  ? 'paid'
                  : activeEditingOrder.payment_status,
                ...discountPayload,
                items: payloadItems,
              }
            : {}
        ),
      });

      const resData = await res.json().catch(() => null);
      if (!res.ok) {
        setSubmitError(
          resData?.error ||
            tx(
              'Không thể lưu đơn hàng. Vui lòng thử lại.',
              'Could not save order. Please try again.'
            )
        );
        return;
      }

      const savedOrder: ShopOrder | null = resData?.order || null;
      if (!savedOrder?.id || savedOrder.id !== activeEditingOrder?.id || savedOrder.shop_id !== shop.id) {
        setSubmitError(tx('Không xác nhận được đơn đã lưu.', 'Could not confirm the saved order.'));
        return;
      }
      const shouldPrint = typeof shouldOpenReceipt === 'boolean'
        ? shouldOpenReceipt : paymentMethod === 'vietqr' ? true : autoPrintOnPay;
      finishSavedOrder(savedOrder, shouldPrint);
    } catch {
      setSubmitError(
        tx(
          'Lỗi kết nối máy chủ khi lưu đơn hàng.',
          'Server connection error while saving order.'
        )
      );
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  };

  const handlePaymentButtonClick = () => {
    if (lines.length === 0 || submitting) return;
    if (paymentMethod === 'vietqr') {
      // Create/Update order immediately and open ReceiptPrintModal with QR printed on the bill
      submitPosOrder(false, true);
      return;
    }
    submitPosOrder(true);
  };

  if (loadedRecoveryContext !== recoveryContext) {
    return <div role="status" className="rounded-2xl bg-white p-6 text-sm">{tx('Đang kiểm tra đơn chờ...', 'Checking pending orders...')}</div>;
  }

  if (recovery.kind === 'unavailable') {
    return (
      <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-950">
        {tx('Không thể kiểm tra đơn chờ an toàn. Hãy kiểm tra đăng nhập và bộ nhớ trình duyệt, dùng trình duyệt được cập nhật qua HTTPS rồi tải lại trang.', 'Cannot safely check pending orders. Check your sign-in and browser storage, use an up-to-date browser over HTTPS, then reload.')}
      </div>
    );
  }

  if (recovery.kind === 'pending') {
    const pending = recovery.request;
    return (
      <div role="alert" data-testid="pos-pending-order" className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-950">
        <p className="font-bold">{tx('Đơn trước chưa được xác nhận', 'Previous order not confirmed')}</p>
        <p>{tx('Đơn có thể đã được tạo. Thử lại sẽ gửi đúng yêu cầu trước đó, không tự động tạo yêu cầu mới.', 'The order may already exist. Retry sends the same request and does not automatically create a new one.')}</p>
        {submitError && <p>{submitError}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={submitting} onClick={retryPendingOrder} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50">
            {submitting ? tx('Đang kiểm tra...', 'Checking...') : tx('Thử lại đơn chờ', 'Retry pending order')}
          </button>
          <button type="button" disabled={submitting} onClick={async () => {
            if (!window.confirm(tx('Hãy kiểm tra danh sách đơn trước. Chỉ bỏ yêu cầu chờ sau khi bạn đã xác nhận và xử lý đơn đó. Tiếp tục?', 'Check the order list first. Only discard this pending request after confirming and handling that order. Continue?'))) return;
            try {
              const cleared = await withPosRecoveryLock(navigator.locks, pending.accountId, pending.shopId,
                () => clearPendingPosOrder(getSafeIndexedDb(), pending, getSafeLocalStorage()));
              if (currentRecoveryContext.current !== `${pending.accountId}\u0000${pending.shopId}`) return;
              if (cleared) {
                if (originatedPendingKeyRef.current === pending.key) {
                  originatedPendingKeyRef.current = null;
                }
                recoveryReadSeq.current += 1;
                setRecovery({ kind: 'empty' });
                setSubmitError(null);
              } else {
                const current = await readPendingPosOrder(getSafeIndexedDb(), pending.accountId, pending.shopId, getSafeLocalStorage());
                if (currentRecoveryContext.current !== `${pending.accountId}\u0000${pending.shopId}`) return;
                recoveryReadSeq.current += 1;
                setRecovery(current);
                if (current.kind === 'empty') {
                  setSubmitError(null);
                } else {
                  setSubmitError(tx('Không thể xóa yêu cầu chờ.', 'Could not clear the pending request.'));
                }
              }
            } catch {
              setSubmitError(tx('Không thể truy cập bộ nhớ trình duyệt.', 'Browser storage is unavailable.'));
            }
          }} className="rounded-xl border border-amber-700 px-4 py-2 font-bold disabled:opacity-50">
            {tx('Tôi đã kiểm tra, bỏ yêu cầu chờ', 'I checked, discard pending request')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-slate-100 flex flex-col overflow-hidden'
          : 'rounded-3xl border-2 border-slate-300 bg-slate-100 shadow-lg overflow-hidden flex flex-col h-[calc(100vh-145px)] min-h-[680px]'
      }
    >
      {/* Top POS Status & Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-4 py-2.5 text-white shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-black text-slate-950">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{tx('POS THU NGÂN', 'COUNTER POS')}</span>
          </span>
          <span className="truncate text-sm font-extrabold text-white">
            {shop.name}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live Today Shift Stats & Order History Button right inside POS Terminal */}
          <button
            type="button"
            onClick={() => setShowTodayOrdersModal(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-300 hover:bg-emerald-500/25 transition"
            title={tx(
              'Xem danh sách đơn trong ngày & in lại hóa đơn',
              "View today's orders & reprint receipts"
            )}
          >
            <Banknote className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              {tx('Ca hôm nay:', 'Today:')}{' '}
              <strong className="text-white">
                {todayStats.count} {tx('đơn', 'orders')}
              </strong>{' '}
              •{' '}
              <strong className="text-amber-300">
                {formatCurrency(todayStats.revenue, shop.currency, locale)}
              </strong>
            </span>
            <span className="rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
              {tx('Xem đơn', 'Orders')}
            </span>
          </button>

          <Link
            href="/dashboard/reports"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-slate-700"
            title={tx(
              'Tra cứu sổ đơn theo ngày & xuất file Excel / CSV',
              'View daily order ledger & export Excel / CSV'
            )}
          >
            <span>📊 {tx('Sổ đơn & Xuất Excel', 'Reports & Export')}</span>
          </Link>

          <Link
            href="/dashboard/catalog"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              {tx('Cấu hình Option / Topping món', 'Item Options / Toppings')}
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-slate-700"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>{tx('Thu nhỏ', 'Exit Fullscreen')}</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>{tx('Toàn màn hình POS', 'Fullscreen POS')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {submitError && (
        <div className="flex items-center justify-between gap-2 bg-rose-600 px-4 py-2 text-xs font-bold text-white shrink-0">
          <span>⚠️ {submitError}</span>
          <button
            type="button"
            onClick={() => setSubmitError(null)}
            className="rounded-lg bg-white/20 px-2 py-0.5 text-[11px] font-black hover:bg-white/30"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Main Split-Screen POS Body: Left Ticket + Numpad | Right Category + Product Grid */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* ================= LEFT PANE: ORDER TICKET + NUMPAD + PAYMENT ================= */}
        <div className="w-full lg:w-[410px] xl:w-[450px] shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-300 flex flex-col min-h-0">
          {/* Active Editing Order Banner */}
          {activeEditingOrder && (
            <div className="flex items-center justify-between gap-2 bg-amber-500 px-3.5 py-2 text-slate-950 shrink-0 border-b border-amber-600">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-black">
                  <Edit3 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {tx(
                      `ĐANG SỬA ĐƠN #${activeEditingOrder.order_code} (${activeEditingOrder.table_label})`,
                      `EDITING ORDER #${activeEditingOrder.order_code} (${formatTablePresetLabel(activeEditingOrder.table_label, locale)})`
                    )}
                  </span>
                </div>
                <p className="text-[10px] font-bold text-slate-900 truncate">
                  {tx(
                    'Thêm/bớt món, đổi Option hoặc bấm Lưu cập nhật đơn trước khi thanh toán',
                    'Add/remove items, edit options, or save order changes before checkout'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={clearEditingOrder}
                className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-black text-white hover:bg-slate-800"
              >
                {tx('Thoát sửa', 'Exit edit')}
              </button>
            </div>
          )}

          {/* Ticket Top Header: Table / Order Type & Clear Button */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2 shrink-0">
            <div className="relative flex-1 min-w-0">
              <button
                type="button"
                data-testid="pos-table-picker-trigger"
                onClick={() => setShowTablePicker((prev) => !prev)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-900 shadow-2xs hover:border-emerald-500"
              >
                <Utensils className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">
                  {formatTablePresetLabel(tableLabel, locale)}
                </span>
              </button>

              {showTablePicker && (
                <div
                  data-testid="pos-table-picker-popover"
                  className="absolute left-0 top-10 z-30 w-72 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xl space-y-2"
                >
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold text-slate-500">
                      {tx(
                        'Chọn Bàn / Mang về:',
                        'Select Table / Takeaway:'
                      )}
                    </span>
                    <Link
                      href="/dashboard/qr-studio#table-management"
                      className="text-[10px] font-bold text-emerald-700 hover:underline"
                    >
                      {tx('Quản lý bàn', 'Manage tables')}
                    </Link>
                  </div>

                  {tablesError && (
                    <div
                      data-testid="pos-tables-load-error"
                      className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700"
                    >
                      <span className="truncate">{tablesError}</span>
                      <button
                        type="button"
                        onClick={() => setTablesRetryTick((c) => c + 1)}
                        className="shrink-0 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white hover:bg-rose-500"
                      >
                        {tx('Thử lại', 'Retry')}
                      </button>
                    </div>
                  )}

                  {/* Non-table presets (Takeaway / Counter / Delivery) */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {NON_TABLE_PRESETS.map((preset) => {
                      const isSelected =
                        selectedTableId === null && tableLabel === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setSelectedTableId(null);
                            setTableLabel(preset);
                            setShowTablePicker(false);
                          }}
                          className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {formatTablePresetLabel(preset, locale)}
                        </button>
                      );
                    })}
                  </div>

                  {/* Managed Active ShopTables */}
                  {managedTables.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pt-1 border-t border-slate-100">
                      {managedTables.map((tb) => {
                        const isSelected =
                          selectedTableId === tb.id ||
                          (selectedTableId === null && tableLabel === tb.name);
                        return (
                          <button
                            key={tb.id}
                            type="button"
                            data-testid={`pos-table-option-${tb.table_code}`}
                            onClick={() => {
                              setSelectedTableId(tb.id);
                              setTableLabel(tb.name);
                              setShowTablePicker(false);
                            }}
                            className={`rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${
                              isSelected
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            <div className="truncate">{tb.name}</div>
                            {tb.section && (
                              <div
                                className={`text-[10px] font-normal truncate ${
                                  isSelected
                                    ? 'text-emerald-100'
                                    : 'text-slate-500'
                                }`}
                              >
                                {tb.section}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    !tablesLoading && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
                        {tx(
                          'Chưa có bàn cấu hình. Vào QR Studio để tạo danh sách bàn.',
                          'No configured tables yet. Open QR Studio to create tables.'
                        )}
                      </div>
                    )
                  )}

                  <input
                    type="text"
                    value={tableLabel}
                    onChange={(e) => {
                      const nextLabel = e.target.value;
                      setTableLabel(nextLabel);
                      const matched = managedTables.find(
                        (tb) =>
                          tb.name.toLowerCase() ===
                            nextLabel.trim().toLowerCase() ||
                          tb.table_code.toLowerCase() ===
                            nextLabel.trim().toLowerCase()
                      );
                      setSelectedTableId(matched ? matched.id : null);
                    }}
                    placeholder={tx(
                      'Hoặc nhập tên bàn / tên khách...',
                      'Or enter table / customer name...'
                    )}
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
                <span>{tx('Xóa hết món', 'Clear all')}</span>
              </button>
            )}
          </div>

          {/* Scrollable Order Lines List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 min-h-[180px]">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                <Utensils className="h-10 w-10 stroke-[1.5] mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-600">
                  {t('pos.cartTitle')}
                </p>
                <p className="text-xs text-slate-400 mt-0.5 max-w-[240px]">
                  {t('pos.emptyCart')}
                </p>
              </div>
            ) : (
              lines.map((line) => {
                const isSelected = line.lineId === selectedLineId;
                const { basePrice, extraPrice, finalLineTotal } =
                  calcLineAmounts(line);
                const lineName =
                  locale === 'en' && line.item.name_i18n.en
                    ? line.item.name_i18n.en
                    : line.item.name_i18n.vi;

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
                        {lineName}
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
                        {tx('Món', 'x')} x{' '}
                        {formatCurrency(basePrice, shop.currency)}
                        {extraPrice > 0 && (
                          <span className="text-amber-700 font-bold">
                            {' '}
                            (+{tx('Topping', 'Add-on')}{' '}
                            {formatCurrency(extraPrice, shop.currency)})
                          </span>
                        )}
                        {line.discountPercent > 0 && (
                          <span className="ml-1.5 inline-flex items-center rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                            {tx(
                              `Giảm ${line.discountPercent}%`,
                              `-${line.discountPercent}%`
                            )}
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
                          title={tx(
                            'Chọn lại Option / Topping / Ghi chú',
                            'Edit options / toppings / notes'
                          )}
                          className="flex h-6 items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100"
                        >
                          <Edit3 className="h-2.5 w-2.5" />
                          <span>{tx('Option', 'Options')}</span>
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
                        {line.selectedChoices.map((c) => {
                          const choiceLabel =
                            locale === 'en' && c.label_i18n.en
                              ? c.label_i18n.en
                              : c.label_i18n.vi;
                          return (
                            <span
                              key={c.id}
                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                c.extra_price > 0
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                            >
                              + {choiceLabel}
                              {c.extra_price > 0
                                ? ` (+${formatCurrency(c.extra_price, shop.currency)})`
                                : ''}
                            </span>
                          );
                        })}
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
                {t('pos.subtotal')} ({totals.totalQty} {tx('món', 'items')}):
              </span>
              <span className="font-bold text-slate-800">
                {formatCurrency(totals.subtotal, shop.currency)}
              </span>
            </div>
            {totals.promoDiscountAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-rose-600">
                <span>{tx('Khuyến mãi quán:', 'Shop promotion:')}</span>
                <span className="font-bold">
                  -{formatCurrency(totals.promoDiscountAmount, shop.currency)}
                </span>
              </div>
            )}
            {totals.manualDiscountAmount > 0 && (
              <div className="flex items-center justify-between text-xs text-rose-600">
                <span>{t('pos.discount')}:</span>
                <span className="font-bold">
                  -{formatCurrency(totals.manualDiscountAmount, shop.currency)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-0.5">
              <span className="text-sm font-black uppercase text-slate-900">
                {t('pos.total')}:
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
              <span className="truncate">
                {tx('Option / Topping', 'Options / Toppings')}
              </span>
            </button>

            <button
              type="button"
              disabled={!selectedLine}
              onClick={() => handleOpenEditSelectedLineModal()}
              className="flex items-center justify-center gap-1 rounded-lg bg-white py-2 px-2 text-xs font-bold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-45"
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-amber-600" />
              <span className="truncate">{tx('Ghi chú món', 'Item Note')}</span>
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
                  <span className="truncate">{tx('CK VietQR', 'VietQR')}</span>
                </>
              ) : (
                <>
                  <Banknote className="h-3.5 w-3.5 text-emerald-700" />
                  <span className="truncate">{tx('Tiền mặt', 'Cash')}</span>
                </>
              )}
            </button>
          </div>

          {/* Save Edited Order Without Marking Paid Button (Only when editing an unpaid order) */}
          {activeEditingOrder && (
            <div className="border-t border-amber-300 bg-amber-50 p-1.5 shrink-0">
              <button
                type="button"
                disabled={lines.length === 0 || submitting}
                onClick={() => submitPosOrder(false, false)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2 px-3 text-xs font-black text-slate-950 shadow-xs hover:bg-amber-400 disabled:opacity-50"
              >
                <Check className="h-4 w-4 stroke-[2.5]" />
                <span>
                  {t('pos.saveOrderChanges')} #{activeEditingOrder.order_code} (
                  {tx('Chưa thu tiền', 'Unpaid')})
                </span>
              </button>
            </div>
          )}

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
                  ? t('common.saving')
                  : paymentMethod === 'vietqr'
                    ? activeEditingOrder
                      ? tx('Lưu & In Bill QR', 'Save & Print QR')
                      : tx('In Bill Kèm QR', 'Print QR Bill')
                    : activeEditingOrder
                      ? tx('Lưu & Thu Tiền', 'Save & Charge')
                      : t('pos.collectAndComplete')}
              </span>
              <span className="text-[11px] font-bold text-emerald-100 text-center">
                {paymentMethod === 'vietqr'
                  ? tx('🖨️ In mã QR ra bill', '🖨️ Print QR on receipt')
                  : autoPrintOnPay
                    ? tx('🖨️ Tự động in bill', '🖨️ Auto-print receipt')
                    : tx('Lưu & Báo bếp', 'Save & Send to kitchen')}
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
                {tx('SL (Qty)', 'Qty')}
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
              {canApplyDiscount && <button
                type="button"
                onClick={() => setNumpadMode('disc')}
                className={`py-2.5 text-xs font-black transition ${
                  numpadMode === 'disc'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tx('% Giảm', '% Disc')}
              </button>}

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
              {canApplyDiscount && (
                <button
                  type="button"
                  onClick={() => setNumpadMode('price')}
                  className={`py-2.5 text-xs font-black transition ${
                    numpadMode === 'price'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {tx('Giá', 'Price')}
                </button>
              )}

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
                <span>
                  {t('common.all')} ({items.length})
                </span>
              </button>

              {categories.map((cat) => {
                const active = selectedCategoryId === cat.id;
                const catName =
                  locale === 'en' && cat.name_i18n.en
                    ? cat.name_i18n.en
                    : cat.name_i18n.vi;
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
                    {catName}
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
                placeholder={t('pos.searchPlaceholder')}
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
                  {tx('Không tìm thấy món phù hợp', 'No matching items found')}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {tx(
                    'Hãy thử từ khóa khác hoặc chọn danh mục "Tất cả"',
                    'Try another keyword or select the "All" category'
                  )}
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
                  const itemName =
                    locale === 'en' && item.name_i18n.en
                      ? item.name_i18n.en
                      : item.name_i18n.vi;
                  const itemDesc =
                    locale === 'en' && item.desc_i18n?.en
                      ? item.desc_i18n.en
                      : item.desc_i18n?.vi;

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
                            alt={itemName}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl bg-slate-100">
                            🍜
                          </div>
                        )}

                        {/* Top-Right Price Badge (Odoo/Viindoo POS style) */}
                        <span className="absolute right-2 top-2 rounded-lg bg-emerald-600/95 px-2 py-0.5 text-[11px] font-black text-white shadow-xs backdrop-blur-2xs">
                          {formatCurrency(item.price, shop.currency, locale)}
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
                              {tx('Kho:', 'Stock:')} {stock}
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
                            title={tx(
                              'Chọn Option / Độ ngọt / Đá / Topping / Ghi chú',
                              'Select Options / Sweetness / Ice / Toppings / Note'
                            )}
                            className={`absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-extrabold shadow-xs transition ${
                              hasOptions
                                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                : 'bg-slate-900/75 text-white hover:bg-slate-900'
                            }`}
                          >
                            <SlidersHorizontal className="h-2.5 w-2.5" />
                            <span>
                              {hasOptions
                                ? `${item.options_json!.length} ${tx('Option', 'Options')}`
                                : tx('Ghi chú', 'Note')}
                            </span>
                          </button>
                        )}

                        {isSoldOut && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
                            <span className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-black text-white uppercase">
                              {tx('Hết hàng', 'Sold out')}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Product Title & Description & Option Preview */}
                      <div className="flex flex-1 flex-col justify-between p-2.5 space-y-1">
                        <div>
                          <h4 className="line-clamp-2 text-xs font-extrabold text-slate-900 leading-snug">
                            {itemName}
                          </h4>
                          {itemDesc && (
                            <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-500">
                              {itemDesc}
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
                                {locale === 'en' && g.name_i18n.en
                                  ? g.name_i18n.en
                                  : g.name_i18n.vi}
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
                    ? tx(
                        'Chỉnh sửa Option / Topping món',
                        'Edit Item Options / Toppings'
                      )
                    : tx(
                        'Chọn Option / Topping & Ghi chú',
                        'Select Options / Toppings & Note'
                      )}
                </span>
                <h3 className="truncate text-base sm:text-lg font-black">
                  {locale === 'en' && optionModalState.item.name_i18n.en
                    ? optionModalState.item.name_i18n.en
                    : optionModalState.item.name_i18n.vi}{' '}
                  —{' '}
                  <span className="text-emerald-400">
                    {formatCurrency(optionModalState.item.price, shop.currency)}
                  </span>
                </h3>
                {(locale === 'en'
                  ? optionModalState.item.desc_i18n?.en ||
                    optionModalState.item.desc_i18n?.vi
                  : optionModalState.item.desc_i18n?.vi) && (
                  <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">
                    {locale === 'en' && optionModalState.item.desc_i18n?.en
                      ? optionModalState.item.desc_i18n.en
                      : optionModalState.item.desc_i18n?.vi}
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
                            {locale === 'en' && group.name_i18n.en
                              ? group.name_i18n.en
                              : group.name_i18n.vi}
                          </h4>
                          {(locale === 'en'
                            ? group.desc_i18n?.en || group.desc_i18n?.vi
                            : group.desc_i18n?.vi) && (
                            <p className="text-[11px] text-slate-500">
                              {locale === 'en' && group.desc_i18n?.en
                                ? group.desc_i18n.en
                                : group.desc_i18n?.vi}
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
                            ? tx('Bắt buộc (Chọn 1)', 'Required (Pick 1)')
                            : tx(
                                'Chọn thêm / Topping (Chọn nhiều)',
                                'Optional / Toppings (Multi-select)'
                              )}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {group.choices.map((choice) => {
                          const isSelected =
                            optionModalState.selectedChoices.some(
                              (c) => c.id === choice.id
                            );
                          const choiceLabel =
                            locale === 'en' && choice.label_i18n.en
                              ? choice.label_i18n.en
                              : choice.label_i18n.vi;
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
                                  {choiceLabel}
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
                                  {locale === 'en' && choice.desc_i18n.en
                                    ? choice.desc_i18n.en
                                    : choice.desc_i18n.vi}
                                </p>
                              )}

                              <div className="mt-1.5">
                                {choice.extra_price > 0 ? (
                                  <span className="inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-900">
                                    +
                                    {formatCurrency(
                                      choice.extra_price,
                                      shop.currency
                                    )}
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
                    {tx(
                      'Món này chưa cấu hình nhóm Option/Topping có cộng tiền riêng.',
                      'No paid option/topping groups configured for this item yet.'
                    )}
                  </span>
                  <Link
                    href="/dashboard/catalog"
                    className="shrink-0 font-bold text-emerald-700 underline"
                  >
                    {tx('+ Cấu hình trong Menu', '+ Configure in Menu')}
                  </Link>
                </div>
              )}

              {/* Fast Counter Quick Tags (Ít đá, Ít đường, Không hành, Mang về...) */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600">
                  {tx(
                    'Ghi chú nhanh tại quầy (Bấm để chọn):',
                    'Quick counter tags (Tap to toggle):'
                  )}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { vi: 'Ít đường', en: 'Less sugar' },
                    { vi: 'Nhiều đường', en: 'Extra sugar' },
                    { vi: 'Không đường', en: 'No sugar' },
                    { vi: 'Ít đá', en: 'Less ice' },
                    { vi: 'Đá riêng', en: 'Ice on side' },
                    { vi: 'Không đá', en: 'No ice' },
                    ...verticalQuickTags.map((tagObj) => ({
                      vi: tagObj.i18n.vi,
                      en: tagObj.i18n.en || tagObj.i18n.vi,
                    })),
                  ]
                    .filter(
                      (v, idx, arr) =>
                        arr.findIndex((item) => item.vi === v.vi) === idx
                    )
                    .map((tagPair) => {
                      const active = optionModalState.quickTags.includes(
                        tagPair.vi
                      );
                      return (
                        <button
                          key={tagPair.vi}
                          type="button"
                          onClick={() => toggleModalQuickTag(tagPair.vi)}
                          className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {locale === 'en' ? tagPair.en : tagPair.vi}
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Custom Free-Text Note */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {tx(
                    'Ghi chú thêm cho pha chế / bếp:',
                    'Additional note for bar / kitchen:'
                  )}
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
                  placeholder={t('pos.customerNotePlaceholder')}
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
                        ? tx('Cập nhật dòng món', 'Update item line')
                        : tx('Thêm vào phiếu POS', 'Add to POS ticket')}
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
                    💳 {tx('Thanh toán QR tại quầy', 'Counter QR Payment')} •{' '}
                    {formatTablePresetLabel(tableLabel, locale)}
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
                        {tx('Số tài khoản:', 'Account No.:')}
                      </span>
                      <span className="font-mono font-black text-slate-900">
                        {qrInfo.accountNumber}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500">{t('pos.total')}:</span>
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
                        ? t('common.saving')
                        : tx(
                            'Đã nhận chuyển khoản & In Hóa Đơn',
                            'Transfer Received & Print Receipt'
                          )}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => submitPosOrder(false)}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    <span>
                      {tx(
                        'Tạo đơn chưa thu',
                        'Create unpaid order'
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* ================= TODAY POS SHIFT ORDERS & STATS MODAL ================= */}
      {showTodayOrdersModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
          onClick={() => setShowTodayOrdersModal(false)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
              <div>
                <h3 className="text-sm sm:text-base font-black">
                  {tx(
                    'Thống Kê & Đơn Hàng Ca Hôm Nay',
                    "Today's Shift Summary & Orders"
                  )}{' '}
                  • {shop.name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {tx(
                    'Đồng bộ trực tiếp từ cơ sở dữ liệu máy chủ (tự động lưu vĩnh viễn)',
                    'Synced directly with server database (saved permanently)'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTodayOrdersModal(false)}
                className="rounded-xl bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 3 KPI Summary Boxes */}
            <div className="grid grid-cols-3 gap-2.5 bg-slate-50 border-b border-slate-200 px-5 py-3.5">
              <div className="rounded-2xl bg-white border border-emerald-200 p-3">
                <div className="text-[11px] font-bold text-slate-500">
                  {tx('Tổng doanh thu hôm nay', "Today's Paid Revenue")}
                </div>
                <div className="mt-0.5 text-base sm:text-lg font-black text-emerald-600">
                  {formatCurrency(todayStats.revenue, shop.currency)}
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
                  {todayStats.count}{' '}
                  {tx('đơn hợp lệ trong ngày', 'valid orders today')}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 p-3">
                <div className="text-[11px] font-bold text-slate-500">
                  {tx('Tiền mặt tại quầy', 'Counter Cash')}
                </div>
                <div className="mt-0.5 text-base sm:text-lg font-black text-slate-900">
                  {formatCurrency(todayStats.cashRev, shop.currency)}
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
                  {tx('Thu trực tiếp', 'Collected in cash')}
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-blue-200 p-3">
                <div className="text-[11px] font-bold text-blue-700">
                  {tx('Chuyển khoản QR', 'QR Transfer')}
                </div>
                <div className="mt-0.5 text-base sm:text-lg font-black text-blue-700">
                  {formatCurrency(todayStats.qrRev, shop.currency)}
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
                  {tx('VietQR / Ngân hàng', 'VietQR / Bank')}
                </div>
              </div>
            </div>

            {/* Orders List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-4 space-y-2.5">
              {todayStats.todayOrders.length === 0 ? (
                <div className="py-12 text-center text-xs font-semibold text-slate-500">
                  {tx(
                    'Chưa có đơn hàng nào phát sinh trong ngày hôm nay.',
                    'No orders recorded today yet.'
                  )}
                </div>
              ) : (
                todayStats.todayOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="rounded-2xl border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-lg bg-slate-900 px-2.5 py-0.5 text-xs font-black text-amber-400">
                          {formatTablePresetLabel(ord.table_label, locale)}
                        </span>
                        <span className="text-xs font-black text-slate-900">
                          #{ord.order_code}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                            ord.payment_status === 'paid'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {ord.payment_status === 'paid'
                            ? `✓ ${t('orders.paymentPaid')}`
                            : `⏳ ${t('orders.paymentUnpaid')}`}{' '}
                          (
                          {ord.payment_method === 'vietqr'
                            ? 'QR'
                            : tx('Tiền mặt', 'Cash')}
                          )
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">
                          {new Date(ord.created_at).toLocaleTimeString(
                            locale === 'en' ? 'en-US' : 'vi-VN',
                            {
                              hour: '2-digit',
                              minute: '2-digit',
                            }
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 truncate">
                        {(ord.items || [])
                          .map((i) => `${i.quantity}x ${i.name_vi}`)
                          .join(', ')}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap shrink-0">
                      <span className="text-sm font-black text-emerald-700 mr-1">
                        {formatCurrency(ord.total_amount, shop.currency)}
                      </span>

                      {ord.payment_status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() => loadOrderIntoPos(ord)}
                          className="inline-flex items-center gap-1 rounded-xl border border-amber-400 bg-amber-100 px-2.5 py-1.5 text-[11px] font-black text-amber-950 hover:bg-amber-200"
                          title={tx(
                            'Mở đơn này vào màn hình POS để thêm/bớt món hoặc đổi Option',
                            'Load this order into POS to add/remove items or change options'
                          )}
                        >
                          <Edit3 className="h-3.5 w-3.5 text-amber-700" />
                          <span>{t('orders.actionEdit')}</span>
                        </button>
                      )}

                      {onUpdateOrder && ord.payment_status !== 'paid' && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateOrder(ord.id, { payment_status: 'paid' })
                          }
                          className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-emerald-500"
                        >
                          {tx('Đã thu tiền', 'Mark Paid')}
                        </button>
                      )}

                      {onUpdateOrder && ord.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateOrder(ord.id, {
                              status: 'completed',
                              payment_status: 'paid',
                            })
                          }
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-black text-emerald-800 hover:bg-emerald-100"
                        >
                          {tx('Đã thu & Hoàn tất', 'Mark paid & complete')}
                        </button>
                      )}

                      {onPrintOrder && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowTodayOrdersModal(false);
                            onPrintOrder(ord);
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-200"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>{tx('In lại Bill', 'Reprint Bill')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
