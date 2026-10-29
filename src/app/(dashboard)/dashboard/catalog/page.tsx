'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Plus,
  FolderPlus,
  Trash2,
  Sparkles,
  Search,
  Crown,
  Loader2,
  UtensilsCrossed,
  X,
  AlertCircle,
  RefreshCw,
  Download,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FolderInput,
  Tag,
  Pencil,
  Check,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { membershipHasPermission } from '@/lib/dashboard-nav';
import { CatalogItem, Category, PlanTier } from '@/types/qlaok';
import { PLAN_CONFIGS, formatPlanLimitError } from '@/lib/plan-limits';
import { QuickItemRow } from '@/components/dashboard/QuickItemRow';
import { TranslationEditorModal } from '@/components/dashboard/TranslationEditorModal';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { useConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  CATALOG_PAGE_SIZES,
  CatalogPageSize,
  clampCatalogPage,
  paginateCatalogItems,
  getCatalogPaginationRange,
} from '@/lib/catalog-pagination';
import {
  downloadCatalogXlsx,
  parseCatalogPriceValue,
} from '@/lib/catalog-excel';
import { CatalogExcelImportModal } from '@/components/dashboard/CatalogExcelImportModal';
import {
  buildCategoryNameI18n,
  getCategoryRenameAction,
  isCurrentCatalogRequest,
  parseCatalogApiResponse,
  resolveNextCatalogData,
  shouldShowCatalogEmptyState,
  shouldShowCatalogLoadErrorBanner,
  shouldShowCatalogLoadErrorState,
} from '@/lib/dashboard-catalog';

interface CatalogMutationError {
  message: string;
  upgradeHref?: string;
  ctaLabel?: string;
}

interface CategoryChipProps {
  cat: Category;
  count: number;
  active: boolean;
  canManageCatalog: boolean;
  isEditing: boolean;
  isSaving: boolean;
  editingName: string;
  deletingCategoryId?: string | null;
  savingCategoryId?: string | null;
  categoriesCount: number;
  onSelect: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onChangeEditingName: (name: string) => void;
  onSubmitRename: () => void;
  onDelete: () => void;
}

function CategoryChip({
  cat,
  count,
  active,
  canManageCatalog,
  isEditing,
  isSaving,
  editingName,
  deletingCategoryId,
  savingCategoryId,
  categoriesCount,
  onSelect,
  onStartRename,
  onCancelRename,
  onChangeEditingName,
  onSubmitRename,
  onDelete,
}: CategoryChipProps) {
  const { tx } = useAppI18n();

  if (isEditing) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 shrink-0 rounded-xl px-2 py-1 text-xs font-bold transition-colors ${
          active
            ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
            : 'bg-slate-100 text-slate-700 ring-1 ring-slate-300'
        }`}
      >
        <form
          data-testid={`category-rename-form-${cat.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitRename();
          }}
          className="inline-flex items-center gap-1"
        >
          <label
            htmlFor={`rename-category-input-${cat.id}`}
            className="sr-only"
          >
            {tx('Tên danh mục', 'Category name')}
          </label>
          <input
            id={`rename-category-input-${cat.id}`}
            data-testid={`category-rename-input-${cat.id}`}
            type="text"
            value={editingName}
            onChange={(e) => onChangeEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelRename();
              }
            }}
            disabled={isSaving}
            autoFocus
            aria-label={tx('Tên danh mục', 'Category name')}
            className={`w-28 sm:w-36 rounded-lg px-2 py-0.5 text-xs font-semibold focus:outline-none ${
              active
                ? 'bg-emerald-700 text-white placeholder-emerald-200 border border-emerald-400 focus:border-white'
                : 'bg-white text-slate-900 border border-slate-300 focus:border-emerald-500'
            } disabled:opacity-50`}
          />
          <button
            type="submit"
            data-testid={`category-rename-save-${cat.id}`}
            disabled={isSaving || !editingName.trim()}
            className="rounded-lg p-1 opacity-80 hover:opacity-100 disabled:opacity-40"
            title={tx('Lưu', 'Save')}
            aria-label={tx('Lưu', 'Save')}
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            data-testid={`category-rename-cancel-${cat.id}`}
            onClick={onCancelRename}
            disabled={isSaving}
            className="rounded-lg p-1 opacity-80 hover:opacity-100 disabled:opacity-40"
            title={tx('Hủy', 'Cancel')}
            aria-label={tx('Hủy', 'Cancel')}
          >
            <X className="h-3 w-3" />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1 shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? 'bg-emerald-600 text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      <button
        type="button"
        data-testid={`category-chip-select-${cat.id}`}
        onClick={onSelect}
      >
        {cat.name_i18n.vi} ({count})
      </button>
      {canManageCatalog && (
        <button
          type="button"
          data-testid={`rename-category-btn-${cat.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          disabled={savingCategoryId !== null && savingCategoryId !== undefined}
          className="ml-1 opacity-60 hover:opacity-100 disabled:opacity-30"
          title={tx('Đổi tên danh mục', 'Rename category')}
          aria-label={tx('Đổi tên danh mục: {name}', 'Rename category: {name}', {
            name: cat.name_i18n.vi,
          })}
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {canManageCatalog && categoriesCount > 1 && (
        <button
          type="button"
          data-testid={`delete-category-btn-${cat.id}`}
          onClick={onDelete}
          disabled={
            deletingCategoryId === cat.id ||
            (savingCategoryId !== null && savingCategoryId !== undefined)
          }
          className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-wait disabled:opacity-30"
          title={tx('Xóa danh mục', 'Delete category')}
          aria-label={tx('Xóa danh mục', 'Delete category')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export default function DashboardCatalogPage() {
  const { activeShop, activeMembership } = useDashboard();
  const { locale, t, tx } = useAppI18n();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [mutationError, setMutationError] = useState<CatalogMutationError | null>(
    null
  );
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [ownerPlan, setOwnerPlan] = useState<PlanTier>('free');
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>(
    'all'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pageSize, setPageSize] = useState<CatalogPageSize>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkPriceInput, setBulkPriceInput] = useState('');
  const [bulkPriceError, setBulkPriceError] = useState<string | null>(null);
  const [bulkTargetCategoryId, setBulkTargetCategoryId] = useState('');
  const [bulkActionPending, setBulkActionPending] = useState<
    'delete' | 'price' | 'available' | 'sold_out' | 'move' | null
  >(null);
  const [bulkResultBanner, setBulkResultBanner] = useState<{
    status: 'success' | 'partial';
    message: string;
    details?: Array<{ id: string; name?: string; error?: string }>;
  } | null>(null);
  const selectPageCheckboxRef = useRef<HTMLInputElement>(null);
  const activeShopIdRef = useRef<string | null>(activeShop?.id ?? null);
  const catalogLoadSequenceRef = useRef(0);

  useEffect(() => {
    activeShopIdRef.current = activeShop?.id ?? null;
  }, [activeShop?.id]);

  const isItemInCurrentShop = (item: Pick<CatalogItem, 'shop_id'>) =>
    Boolean(
      activeShop?.id &&
        activeShopIdRef.current === activeShop.id &&
        item.shop_id === activeShop.id
    );

  const clearBulkSelectionAndDrafts = useCallback(() => {
    setSelectedItemIds((prev) => (prev.size === 0 ? prev : new Set()));
    setBulkPriceInput('');
    setBulkPriceError(null);
    setBulkTargetCategoryId('');
  }, []);

  const loadCatalog = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      const shopId = activeShop.id;
      const requestId = ++catalogLoadSequenceRef.current;
      const isCurrentRequest = () =>
        isCurrentCatalogRequest({
          requestShopId: shopId,
          currentShopId: activeShopIdRef.current,
          requestId,
          currentRequestId: catalogLoadSequenceRef.current,
        });
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/catalog?shopId=${encodeURIComponent(shopId)}`, {
          headers: getAuthHeaders(),
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!isCurrentRequest()) return;
        const parsed = parseCatalogApiResponse(res.ok, data);
        setCategories((prev) =>
          resolveNextCatalogData({ categories: prev, items: [], ownerPlan: 'free' }, parsed).categories
        );
        setItems((prev) =>
          resolveNextCatalogData({ categories: [], items: prev, ownerPlan: 'free' }, parsed).items
        );
        setOwnerPlan((prev) =>
          resolveNextCatalogData({ categories: [], items: [], ownerPlan: prev }, parsed).ownerPlan
        );
        if (parsed.ok) {
          setLoadError(false);
          setHasLoaded(true);
        } else {
          setLoadError(true);
        }
      } catch {
        if (isCurrentRequest()) setLoadError(true);
      } finally {
        if (!silent && isCurrentRequest()) {
          setLoading(false);
        }
      }
    },
    [activeShop]
  );

  useEffect(() => {
    setCategories([]);
    setItems([]);
    setSelectedCategoryId('all');
    setSearchQuery('');
    setCurrentPage(1);
    setOwnerPlan('free');
    setLoadError(false);
    setHasLoaded(false);
    setMutationError(null);
    setBulkResultBanner(null);
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setSavingCategoryId(null);
    clearBulkSelectionAndDrafts();
    void loadCatalog(false);
    return () => {
      catalogLoadSequenceRef.current += 1;
    };
  }, [loadCatalog, clearBulkSelectionAndDrafts]);

  useEffect(() => {
    if (!hasLoaded) return;
    const validIdSet = new Set(items.map((item) => item.id));
    setSelectedItemIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [hasLoaded, items]);

  const notifyRealtime = () => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.postMessage({ type: 'catalog_changed' });
      bc.close();
    }
  };

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
      toastTimerRef.current = null;
    }, 2500);
  };

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  /** Converts a failed response / thrown error into a user-facing message (plan limits get a billing CTA). */
  const toMutationError = (
    payload: unknown,
    fallback: string
  ): CatalogMutationError => {
    const planError = formatPlanLimitError(payload, locale);
    if (planError) {
      return {
        message: planError.message,
        upgradeHref: planError.upgradeHref,
        ctaLabel: planError.ctaLabel,
      };
    }
    if (payload && typeof payload === 'object' && !(payload instanceof Error)) {
      const errText = (payload as { error?: unknown }).error;
      if (typeof errText === 'string' && errText.trim()) return { message: errText };
    }
    if (payload instanceof Error && payload.message) return { message: payload.message };
    return { message: fallback };
  };

  /**
   * Sends a catalog mutation and resolves to true only when the server confirms it.
   * On failure the error is surfaced in the inline banner; callers roll back optimistic state.
   */
  const sendCatalogMutation = async (
    input: string,
    init: RequestInit,
    fallback: string
  ): Promise<boolean> => {
    const expectedShopId = activeShop?.id;
    if (!expectedShopId || activeShopIdRef.current !== expectedShopId) {
      return false;
    }
    try {
      const res = await fetch(input, init);
      if (activeShopIdRef.current !== expectedShopId) return false;
      if (res.ok) {
        setMutationError(null);
        return true;
      }
      const payload = await res.json().catch(() => null);
      setMutationError(toMutationError(payload, fallback));
      return false;
    } catch (err) {
      if (activeShopIdRef.current !== expectedShopId) return false;
      setMutationError(toMutationError(err, fallback));
      return false;
    }
  };

  type CatalogItemMutationPatch = Partial<CatalogItem> & {
    id: string;
    shop_id: string;
    category_id: string;
    expected_stock_quantity?: number | null;
  };

  const upsertItem = async (
    patch: CatalogItemMutationPatch
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(patch) || !activeShop) return false;
    const expectedShopId = activeShop.id;
    if (activeShopIdRef.current !== expectedShopId) return false;
    const fallback = tx(
      'Không thể lưu thay đổi món',
      'Could not save item changes'
    );
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'upsert_item',
          item: { ...patch, shop_id: expectedShopId },
        }),
      });
      if (activeShopIdRef.current !== expectedShopId) return false;
      const payload = await res.json().catch(() => null);
      if (activeShopIdRef.current !== expectedShopId) return false;

      if (!res.ok) {
        const isStockConflict =
          res.status === 409 ||
          (payload &&
            typeof payload === 'object' &&
            (payload as { code?: unknown }).code === 'STOCK_CONFLICT');
        setMutationError(toMutationError(payload, fallback));
        if (isStockConflict) {
          void loadCatalog(true);
        }
        return false;
      }

      const rawItem =
        payload && typeof payload === 'object'
          ? (payload as { item?: unknown }).item
          : null;
      if (
        rawItem &&
        typeof rawItem === 'object' &&
        (rawItem as { id?: unknown }).id === patch.id &&
        (rawItem as { shop_id?: unknown }).shop_id === expectedShopId
      ) {
        const serverItem = rawItem as CatalogItem;
        setItems((prev) =>
          prev.map((i) => (i.id === patch.id ? { ...i, ...serverItem } : i))
        );
      }
      setMutationError(null);
      return true;
    } catch (err) {
      if (activeShopIdRef.current !== expectedShopId) return false;
      setMutationError(toMutationError(err, fallback));
      return false;
    }
  };

  /** Restores the server-confirmed item snapshot after a rejected optimistic update. */
  const rollbackItem = (original: CatalogItem) => {
    if (!isItemInCurrentShop(original)) return;
    setItems((prev) => prev.map((i) => (i.id === original.id ? original : i)));
  };

  const handleToggleAvailable = async (
    item: CatalogItem,
    nextAvailable: boolean
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(item)) return false;
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_available: nextAvailable } : i
      )
    );
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item.id,
            shop_id: activeShop!.id,
            category_id: item.category_id,
            is_available: nextAvailable,
          },
        }),
      });
      if (!isItemInCurrentShop(item)) return false;

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        if (!isItemInCurrentShop(item)) return false;
        rollbackItem(item);
        setMutationError(
          toMutationError(
            payload,
            tx('Không thể lưu thay đổi món', 'Could not save item changes')
          )
        );
        return false;
      }

      const payload = await res.json().catch(() => null);
      if (!isItemInCurrentShop(item)) return false;
      const rawItem =
        payload && typeof payload === 'object'
          ? (payload as { item?: unknown }).item
          : null;
      const isValidServerItem =
        rawItem !== null &&
        typeof rawItem === 'object' &&
        typeof (rawItem as { id?: unknown }).id === 'string' &&
        (rawItem as { id: string }).id === item.id &&
        (rawItem as { shop_id?: unknown }).shop_id === item.shop_id &&
        typeof (rawItem as { is_available?: unknown }).is_available === 'boolean';

      if (!isValidServerItem) {
        rollbackItem(item);
        setMutationError(
          toMutationError(
            null,
            tx(
              'Phản hồi từ máy chủ không hợp lệ.',
              'Invalid response from server.'
            )
          )
        );
        return false;
      }

      const serverItem = rawItem as CatalogItem;

      // Replace optimistic item with server-returned item
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...serverItem } : i))
      );

      const itemName =
        (locale === 'en' && serverItem.name_i18n?.en)
          ? serverItem.name_i18n.en
          : (serverItem.name_i18n?.vi || item.name_i18n?.vi || '');

      if (serverItem.is_available !== nextAvailable) {
        // Server state differs from requested state (e.g. zero-stock normalized to false)
        // Keep the canonical state (already replaced above)
        // Do NOT show the "marked available" success toast
        // Show clear localized inline explanation that the server kept the item sold out and its stock should be checked
        setMutationError({
          message: tx(
            'Món "{name}" có tồn kho bằng 0 nên máy chủ tiếp tục giữ trạng thái hết hàng. Vui lòng kiểm tra tồn kho.',
            'Item "{name}" has 0 stock quantity, so the server kept it sold out. Please check inventory.',
            { name: itemName }
          ),
        });
        notifyRealtime();
        return false;
      }

      // Normal accepted toggle: clear any prior mutation error, notify realtime, show success toast
      setMutationError(null);
      notifyRealtime();
      showToast(
        nextAvailable
          ? tx('Đã bật còn món: {name}', 'Marked available: {name}', {
              name: itemName,
            })
          : tx('Đã chuyển tạm hết: {name}', 'Marked sold out: {name}', {
              name: itemName,
            })
      );
      return true;
    } catch (err) {
      if (!isItemInCurrentShop(item)) return false;
      rollbackItem(item);
      setMutationError(
        toMutationError(
          err,
          tx('Không thể lưu thay đổi món', 'Could not save item changes')
        )
      );
      return false;
    }
  };

  const handleUpdatePrice = async (
    item: CatalogItem,
    nextPrice: number
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(item)) return false;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, price: nextPrice } : i))
    );
    const ok = await upsertItem({
      id: item.id,
      shop_id: item.shop_id,
      category_id: item.category_id,
      price: nextPrice,
    });
    if (!ok) {
      rollbackItem(item);
      return false;
    }
    notifyRealtime();
    return true;
  };

  const handleUpdateStock = async (
    item: CatalogItem,
    nextStock: number | null
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(item)) return false;
    const prevStock =
      item.stock_quantity === undefined ? null : item.stock_quantity;
    const nextAvailable =
      nextStock === 0
        ? false
        : nextStock !== null && nextStock > 0
          ? true
          : item.is_available;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, stock_quantity: nextStock, is_available: nextAvailable }
          : i
      )
    );
    const ok = await upsertItem({
      id: item.id,
      shop_id: item.shop_id,
      category_id: item.category_id,
      stock_quantity: nextStock,
      expected_stock_quantity: prevStock,
      ...(nextStock !== null ? { is_available: nextAvailable } : {}),
    });
    if (!ok) {
      rollbackItem(item);
      return false;
    }
    notifyRealtime();
    showToast(
      nextStock === null
        ? tx(
            'Đã đặt tồn kho không giới hạn (∞): {name}',
            'Set unlimited stock (∞): {name}',
            { name: item.name_i18n.vi }
          )
        : tx(
            'Đã cập nhật tồn kho ({stock}): {name}',
            'Updated stock ({stock}): {name}',
            { stock: nextStock, name: item.name_i18n.vi }
          )
    );
    return true;
  };

  const handleToggleFeatured = async (
    item: CatalogItem,
    nextFeatured: boolean
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(item)) return false;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_featured: nextFeatured } : i
      )
    );
    const ok = await upsertItem({
      id: item.id,
      shop_id: item.shop_id,
      category_id: item.category_id,
      is_featured: nextFeatured,
    });
    if (!ok) {
      rollbackItem(item);
      return false;
    }
    notifyRealtime();
    return true;
  };

  const handleUpdateImage = async (
    item: CatalogItem,
    nextImageUrl: string
  ): Promise<boolean> => {
    if (!isItemInCurrentShop(item)) return false;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, image_url: nextImageUrl } : i
      )
    );
    const ok = await upsertItem({
      id: item.id,
      shop_id: item.shop_id,
      category_id: item.category_id,
      image_url: nextImageUrl,
    });
    if (!ok) {
      rollbackItem(item);
      return false;
    }
    notifyRealtime();
    showToast(
      tx('Đã cập nhật ảnh món: {name}', 'Updated item photo: {name}', {
        name: item.name_i18n.vi,
      })
    );
    return true;
  };

  const handleDeleteItem = async (itemId: string): Promise<boolean> => {
    const target = items.find((i) => i.id === itemId);
    if (!target || !isItemInCurrentShop(target)) return false;
    const confirmed = await confirm({
      variant: 'danger',
      title: tx('Xóa món khỏi thực đơn?', 'Delete this item from the menu?'),
      description: tx(
        'Món "{name}" sẽ bị xóa vĩnh viễn khỏi thực đơn QR. Thao tác này không thể hoàn tác.',
        '"{name}" will be permanently removed from the QR menu. This cannot be undone.',
        { name: target?.name_i18n.vi || '' }
      ),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed || !isItemInCurrentShop(target)) return false;

    const originalIndex = items.findIndex((i) => i.id === itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    const ok = await sendCatalogMutation(
      `/api/catalog?itemId=${encodeURIComponent(itemId)}`,
      { method: 'DELETE', headers: getAuthHeaders() },
      tx('Không thể xóa món', 'Could not delete item')
    );
    if (!isItemInCurrentShop(target)) return false;
    if (!ok) {
      if (target) {
        setItems((prev) => {
          if (prev.some((i) => i.id === target.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(Math.max(originalIndex, 0), next.length), 0, target);
          return next;
        });
      }
      return false;
    }
    setSelectedItemIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    notifyRealtime();
    showToast(tx('Đã xóa món khỏi thực đơn', 'Deleted item from menu'));
    return true;
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShop || !canManageCatalog || !newCategoryName.trim()) return;
    setAddingCategory(true);
    try {
      const nameVi = newCategoryName.trim();
      // Translate category name via AI API (best-effort: fall back to the Vietnamese name).
      let translatedName: Category['name_i18n'] | null = null;
      try {
        const transRes = await fetch('/api/ai/translate', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            vertical: activeShop.vertical,
            categoryNameVi: nameVi,
            itemNameVi: nameVi,
          }),
        });
        if (transRes.ok) {
          const transData = await transRes.json().catch(() => null);
          translatedName = transData?.name_i18n || null;
        }
      } catch {
        // translation is optional
      }

      const ok = await sendCatalogMutation(
        '/api/catalog',
        {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            action: 'upsert_category',
            category: {
              shop_id: activeShop.id,
              name_i18n: buildCategoryNameI18n(nameVi, translatedName),
            },
          }),
        },
        tx('Không thể tạo danh mục', 'Could not create category')
      );
      if (!ok) return;
      setNewCategoryName('');
      await loadCatalog(true);
      notifyRealtime();
      showToast(
        translatedName
          ? tx(
              'Đã tạo danh mục mới và dịch tự động',
              'Created category with auto-translation'
            )
          : tx('Đã tạo danh mục mới', 'Created new category')
      );
    } finally {
      setAddingCategory(false);
    }
  };

  const handleStartRenameCategory = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setEditingCategoryName(cat.name_i18n.vi || '');
  };

  const handleCancelRenameCategory = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
  };

  const handleRenameCategory = async (cat: Category) => {
    if (!activeShop || !canManageCatalog) return;
    const action = getCategoryRenameAction(cat.name_i18n.vi, editingCategoryName);
    if (action === 'invalid_blank') {
      setMutationError({
        message: tx('Tên danh mục không được để trống.', 'Category name cannot be blank.'),
      });
      return;
    }
    if (action === 'noop') {
      handleCancelRenameCategory();
      return;
    }

    const trimmedName = editingCategoryName.trim();
    setSavingCategoryId(cat.id);
    setMutationError(null);
    try {
      let freshTranslation: Category['name_i18n'] | null = null;
      try {
        const transRes = await fetch('/api/ai/translate', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            vertical: activeShop.vertical,
            categoryNameVi: trimmedName,
            itemNameVi: trimmedName,
          }),
        });
        if (transRes.ok) {
          const transData = await transRes.json().catch(() => null);
          freshTranslation = transData?.name_i18n || null;
        }
      } catch {
        // Translation is best-effort; fallback to { vi: trimmedName, en: trimmedName }
      }

      const nextNameI18n = buildCategoryNameI18n(trimmedName, freshTranslation);

      const ok = await sendCatalogMutation(
        '/api/catalog',
        {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            action: 'upsert_category',
            category: {
              id: cat.id,
              shop_id: activeShop.id,
              name_i18n: nextNameI18n,
            },
          }),
        },
        tx('Không thể đổi tên danh mục', 'Could not rename category')
      );

      if (!ok) {
        // Keep the editor open on save failure
        return;
      }

      handleCancelRenameCategory();
      await loadCatalog(true);
      notifyRealtime();
      showToast(
        tx('Đã đổi tên danh mục: {name}', 'Renamed category: {name}', {
          name: trimmedName,
        })
      );
    } finally {
      setSavingCategoryId(null);
    }
  };

  const handleDeleteCategory = async (cat: Category) => {
    if (!canManageCatalog) return;
    const itemCount = items.filter((i) => i.category_id === cat.id).length;
    const confirmed = await confirm({
      variant: 'danger',
      title: tx('Xóa danh mục "{name}"?', 'Delete category "{name}"?', {
        name: cat.name_i18n.vi,
      }),
      description:
        itemCount > 0
          ? tx(
              'Danh mục đang có {count} món. Thao tác này không thể hoàn tác.',
              'This category contains {count} item(s). This cannot be undone.',
              { count: itemCount }
            )
          : tx('Thao tác này không thể hoàn tác.', 'This cannot be undone.'),
      confirmLabel: t('common.delete'),
    });
    if (!confirmed) return;
    setDeletingCategoryId(cat.id);
    try {
      const ok = await sendCatalogMutation(
        `/api/catalog?categoryId=${encodeURIComponent(cat.id)}`,
        { method: 'DELETE', headers: getAuthHeaders() },
        tx('Không thể xóa danh mục', 'Could not delete category')
      );
      if (!ok) return;
      if (selectedCategoryId === cat.id) {
        setSelectedCategoryId('all');
        clearBulkSelectionAndDrafts();
      }
      await loadCatalog(true);
      notifyRealtime();
      showToast(tx('Đã xóa danh mục', 'Deleted category'));
    } finally {
      setDeletingCategoryId(null);
    }
  };

  const filteredItems = items.filter((item) => {
    const matchCat =
      selectedCategoryId === 'all' || item.category_id === selectedCategoryId;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      item.name_i18n.vi.toLowerCase().includes(q) ||
      (item.name_i18n.en || '').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const pagination = getCatalogPaginationRange(
    currentPage,
    pageSize,
    filteredItems.length
  );
  const pagedItems = paginateCatalogItems(
    filteredItems,
    pagination.page,
    pageSize
  );

  const filteredItemIdSet = new Set(filteredItems.map((item) => item.id));
  const selectedIds = filteredItems
    .filter(
      (item) => selectedItemIds.has(item.id) && filteredItemIdSet.has(item.id)
    )
    .map((item) => item.id);
  const pagedItemIds = pagedItems.map((item) => item.id);
  const selectedOnPageCount = pagedItemIds.filter((id) =>
    selectedItemIds.has(id)
  ).length;
  const allOnPageSelected =
    pagedItemIds.length > 0 && selectedOnPageCount === pagedItemIds.length;
  const someOnPageSelected = selectedOnPageCount > 0 && !allOnPageSelected;

  // Synchronize currentPage state to valid bounds whenever the filtered item count or pageSize changes.
  useEffect(() => {
    setCurrentPage((prev) => {
      const clamped = clampCatalogPage(prev, filteredItems.length, pageSize);
      return prev === clamped ? prev : clamped;
    });
  }, [filteredItems.length, pageSize]);

  // Synchronize native checkbox indeterminate DOM property for current-page selection.
  useEffect(() => {
    if (selectPageCheckboxRef.current) {
      selectPageCheckboxRef.current.indeterminate = someOnPageSelected;
    }
  }, [someOnPageSelected, allOnPageSelected, pagedItems.length]);

  if (!activeShop) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-sm font-bold text-slate-700">
          {tx('Đang tải dữ liệu cửa hàng...', 'Loading store data...')}
        </p>
      </div>
    );
  }

  const canManageCatalog = activeMembership
    ? membershipHasPermission(activeMembership, 'catalog.manage')
    : true;
  const canAdjustInventory = activeMembership
    ? canManageCatalog ||
      membershipHasPermission(activeMembership, 'inventory.adjust')
    : true;

  const planTier = ownerPlan;
  const planCfg = PLAN_CONFIGS[planTier];
  const itemLimitReached = items.length >= planCfg.maxItems;
  const planLabel =
    planTier === 'premium'
      ? tx('Gói Cao Cấp (Premium)', 'Premium Plan')
      : planTier === 'basic'
        ? tx('Gói Cơ Bản (Basic)', 'Basic Plan')
        : tx('Gói Khởi Đầu (Free)', 'Starter Plan (Free)');

  const handleToggleSelectItem = (itemId: string, nextSelected: boolean) => {
    if (bulkActionPending) return;
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (nextSelected) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  };

  const handleToggleSelectCurrentPage = () => {
    if (bulkActionPending || pagedItemIds.length === 0) return;
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      const everyOnPageSelected = pagedItemIds.every((id) => next.has(id));
      if (everyOnPageSelected) {
        for (const id of pagedItemIds) {
          next.delete(id);
        }
      } else {
        for (const id of pagedItemIds) {
          next.add(id);
        }
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (
      !activeShop ||
      bulkActionPending ||
      selectedIds.length === 0 ||
      !canManageCatalog
    ) {
      return;
    }
    const targetIds = [...selectedIds];
    const count = targetIds.length;
    const confirmBulkDelete = confirm;
    const confirmed = await confirmBulkDelete({
      variant: 'danger',
      title: tx(
        'Xóa {count} món đã chọn khỏi thực đơn?',
        'Delete {count} selected item(s) from the menu?',
        { count }
      ),
      description: tx(
        'Bạn sắp xóa vĩnh viễn {count} món đã chọn khỏi thực đơn QR. Thao tác này không thể hoàn tác.',
        'You are about to permanently remove {count} selected item(s) from the QR menu. This cannot be undone.',
        { count }
      ),
      confirmLabel: tx('Xóa {count} món', 'Delete {count} item(s)', { count }),
    });
    if (!confirmed) return;

    setBulkActionPending('delete');
    setMutationError(null);
    setBulkResultBanner(null);
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'bulk_delete_items',
          shopId: activeShop.id,
          itemIds: targetIds,
        }),
      });
      const data = await res.json().catch(() => null);
      const confirmedIds: string[] = Array.isArray(data?.itemIds)
        ? data.itemIds.filter(
            (id: unknown): id is string => typeof id === 'string'
          )
        : [];
      const deletedCount =
        typeof data?.deletedCount === 'number'
          ? data.deletedCount
          : typeof data?.count === 'number'
            ? data.count
            : 0;

      if (
        !res.ok ||
        data?.success !== true ||
        deletedCount !== targetIds.length ||
        confirmedIds.length !== targetIds.length
      ) {
        setMutationError(
          toMutationError(
            data,
            tx(
              'Không thể xóa các món đã chọn',
              'Could not delete selected items'
            )
          )
        );
        return;
      }

      const deletedSet = new Set(confirmedIds);
      setItems((prev) => prev.filter((item) => !deletedSet.has(item.id)));
      clearBulkSelectionAndDrafts();
      await loadCatalog(true);
      notifyRealtime();
      const successMsg = tx(
        'Đã xóa {count} món khỏi thực đơn',
        'Deleted {count} item(s) from menu',
        { count: deletedCount }
      );
      setBulkResultBanner({ status: 'success', message: successMsg });
      showToast(successMsg);
    } catch (err) {
      setMutationError(
        toMutationError(
          err,
          tx('Không thể xóa các món đã chọn', 'Could not delete selected items')
        )
      );
    } finally {
      setBulkActionPending(null);
    }
  };

  const handleBulkUpdatePrice = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (
      !activeShop ||
      bulkActionPending ||
      selectedIds.length === 0 ||
      !canManageCatalog
    ) {
      return;
    }

    const parsedPrice = parseCatalogPriceValue(bulkPriceInput);
    if (!parsedPrice.valid) {
      setBulkPriceError(parsedPrice.error);
      return;
    }
    setBulkPriceError(null);
    setMutationError(null);
    setBulkResultBanner(null);

    const nextPrice = parsedPrice.price;
    const targetIds = [...selectedIds];
    const targetIdSet = new Set(targetIds);
    const itemNameById = new Map(
      items.map((item) => [item.id, item.name_i18n.vi])
    );

    setBulkActionPending('price');
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId: activeShop.id,
          items: targetIds.map((id) => ({ id, price: nextPrice })),
        }),
      });
      const data = await res.json().catch(() => null);
      const rawResults: unknown[] = Array.isArray(data?.results)
        ? data.results
        : [];

      // Reconcile per-item results against the requested selected IDs exactly once.
      const resultsByTargetId = new Map<
        string,
        Array<{ success: boolean; error?: string }>
      >();
      for (const id of targetIds) {
        resultsByTargetId.set(id, []);
      }

      for (const r of rawResults) {
        if (
          r &&
          typeof r === 'object' &&
          typeof (r as { id?: unknown }).id === 'string'
        ) {
          const itemRes = r as {
            id: string;
            success?: unknown;
            error?: unknown;
          };
          if (targetIdSet.has(itemRes.id)) {
            resultsByTargetId.get(itemRes.id)!.push({
              success: itemRes.success === true,
              error:
                typeof itemRes.error === 'string'
                  ? itemRes.error
                  : undefined,
            });
          }
        }
      }

      const succeededIds: string[] = [];
      const failedResults: Array<{ id: string; error?: string }> = [];

      for (const id of targetIds) {
        const occurrences = resultsByTargetId.get(id) ?? [];
        if (occurrences.length === 0) {
          failedResults.push({
            id,
            error: tx(
              'Không nhận được kết quả cập nhật từ máy chủ',
              'Missing update result from server'
            ),
          });
        } else if (occurrences.length > 1) {
          failedResults.push({
            id,
            error: tx(
              'Kết quả cập nhật bị trùng lặp từ máy chủ',
              'Duplicate update result from server'
            ),
          });
        } else {
          const entry = occurrences[0];
          if (entry.success) {
            succeededIds.push(id);
          } else {
            failedResults.push({
              id,
              error:
                entry.error ||
                tx('Cập nhật món thất bại', 'Failed to update item'),
            });
          }
        }
      }

      const succeededCount = succeededIds.length;
      const failedCount = failedResults.length;

      if (!res.ok || succeededCount === 0) {
        if (succeededCount > 0) {
          await loadCatalog(true);
          notifyRealtime();
        }
        const firstItemErr = failedResults.find((r) => r.error)?.error;
        setMutationError(
          toMutationError(
            firstItemErr ? { error: firstItemErr } : data,
            tx(
              'Không thể cập nhật giá cho các món đã chọn',
              'Could not update price for selected items'
            )
          )
        );
        return;
      }

      await loadCatalog(true);
      notifyRealtime();
      clearBulkSelectionAndDrafts();

      if (
        data?.success === true &&
        failedCount === 0 &&
        succeededCount === targetIds.length
      ) {
        const formattedPrice = `${nextPrice.toLocaleString('vi-VN')}đ`;
        const successMsg = tx(
          'Đã cập nhật giá {price} cho {count} món',
          'Updated price to {price} for {count} item(s)',
          { price: formattedPrice, count: succeededCount }
        );
        setBulkResultBanner({ status: 'success', message: successMsg });
        showToast(successMsg);
      } else {
        const partialMsg = tx(
          'Cập nhật một phần: {succeeded} món thành công, {failed} món thất bại.',
          'Partial update: {succeeded} item(s) succeeded, {failed} item(s) failed.',
          {
            succeeded: succeededCount,
            failed: failedCount,
          }
        );
        setBulkResultBanner({
          status: 'partial',
          message: partialMsg,
          details: failedResults.map((r) => ({
            id: r.id,
            name: itemNameById.get(r.id),
            error: r.error,
          })),
        });
      }
    } catch (err) {
      setMutationError(
        toMutationError(
          err,
          tx(
            'Không thể cập nhật giá cho các món đã chọn',
            'Could not update price for selected items'
          )
        )
      );
    } finally {
      setBulkActionPending(null);
    }
  };

  const handleBulkSetAvailability = async (nextAvailable: boolean) => {
    if (
      !activeShop ||
      bulkActionPending ||
      selectedIds.length === 0 ||
      !canAdjustInventory
    ) {
      return;
    }
    const targetIds = [...selectedIds];
    setBulkActionPending(nextAvailable ? 'available' : 'sold_out');
    setMutationError(null);
    setBulkResultBanner(null);

    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'bulk_update_availability',
          shopId: activeShop.id,
          itemIds: targetIds,
          is_available: nextAvailable,
          isAvailable: nextAvailable,
        }),
      });
      const data = await res.json().catch(() => null);
      const updatedCount =
        typeof data?.updatedCount === 'number'
          ? data.updatedCount
          : typeof data?.count === 'number'
            ? data.count
            : 0;

      if (
        !res.ok ||
        data?.success !== true ||
        updatedCount !== targetIds.length
      ) {
        setMutationError(
          toMutationError(
            data,
            tx(
              'Không thể cập nhật trạng thái còn món',
              'Could not update item availability'
            )
          )
        );
        return;
      }

      const targetIdSet = new Set(targetIds);
      setItems((prev) =>
        prev.map((item) =>
          targetIdSet.has(item.id)
            ? { ...item, is_available: nextAvailable }
            : item
        )
      );
      clearBulkSelectionAndDrafts();
      await loadCatalog(true);
      notifyRealtime();
      const successMsg = nextAvailable
        ? tx(
            'Đã bật còn hàng cho {count} món',
            'Marked {count} item(s) as available',
            { count: updatedCount }
          )
        : tx(
            'Đã chuyển tạm hết cho {count} món',
            'Marked {count} item(s) as sold out',
            { count: updatedCount }
          );
      setBulkResultBanner({ status: 'success', message: successMsg });
      showToast(successMsg);
    } catch (err) {
      setMutationError(
        toMutationError(
          err,
          tx(
            'Không thể cập nhật trạng thái còn món',
            'Could not update item availability'
          )
        )
      );
    } finally {
      setBulkActionPending(null);
    }
  };

  const handleBulkMoveCategory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (
      !activeShop ||
      bulkActionPending ||
      selectedIds.length === 0 ||
      !canManageCatalog
    ) {
      return;
    }
    const targetCategoryId = bulkTargetCategoryId.trim();
    if (!targetCategoryId) {
      setMutationError({
        message: tx(
          'Vui lòng chọn danh mục đích để chuyển món.',
          'Please select a target category to move items.'
        ),
      });
      return;
    }

    const targetCategory = categories.find((c) => c.id === targetCategoryId);
    const targetIds = [...selectedIds];

    setBulkActionPending('move');
    setMutationError(null);
    setBulkResultBanner(null);

    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'bulk_move_items',
          shopId: activeShop.id,
          itemIds: targetIds,
          categoryId: targetCategoryId,
        }),
      });
      const data = await res.json().catch(() => null);

      const movedCount =
        typeof data?.movedCount === 'number'
          ? data.movedCount
          : typeof data?.updatedCount === 'number'
            ? data.updatedCount
            : null;
      const unchangedCount =
        typeof data?.unchangedCount === 'number' ? data.unchangedCount : 0;
      const returnedIds = Array.isArray(data?.itemIds) ? data.itemIds : null;

      // Validate counts against the selected batch
      if (
        !res.ok ||
        data?.success !== true ||
        movedCount === null ||
        movedCount < 0 ||
        unchangedCount < 0 ||
        movedCount + unchangedCount !== targetIds.length ||
        (returnedIds !== null && returnedIds.length !== targetIds.length)
      ) {
        setMutationError(
          toMutationError(
            data,
            tx(
              'Không thể chuyển danh mục cho các món đã chọn',
              'Could not move selected items to category'
            )
          )
        );
        return;
      }

      const targetIdSet = new Set(targetIds);
      setItems((prev) =>
        prev.map((item) =>
          targetIdSet.has(item.id)
            ? { ...item, category_id: targetCategoryId }
            : item
        )
      );
      clearBulkSelectionAndDrafts();
      await loadCatalog(true);
      notifyRealtime();

      const categoryLabel =
        (locale === 'en' && targetCategory?.name_i18n?.en
          ? targetCategory.name_i18n.en
          : targetCategory?.name_i18n?.vi) ||
        targetCategory?.name_i18n?.vi ||
        targetCategoryId;

      let successMsg: string;
      if (movedCount === 0) {
        successMsg = tx(
          '0 món được chuyển: tất cả {count} món đã thuộc danh mục "{category}"',
          '0 items moved: all {count} item(s) are already in category "{category}"',
          { count: targetIds.length, category: categoryLabel }
        );
      } else if (unchangedCount > 0) {
        successMsg = tx(
          'Đã chuyển {count} món sang danh mục "{category}" ({unchanged} món đã ở danh mục này)',
          'Moved {count} item(s) to category "{category}" ({unchanged} item(s) already in this category)',
          {
            count: movedCount,
            unchanged: unchangedCount,
            category: categoryLabel,
          }
        );
      } else {
        successMsg = tx(
          'Đã chuyển {count} món sang danh mục "{category}"',
          'Moved {count} item(s) to category "{category}"',
          { count: movedCount, category: categoryLabel }
        );
      }

      setBulkResultBanner({ status: 'success', message: successMsg });
      showToast(successMsg);
    } catch (err) {
      setMutationError(
        toMutationError(
          err,
          tx(
            'Không thể chuyển danh mục cho các món đã chọn',
            'Could not move selected items to category'
          )
        )
      );
    } finally {
      setBulkActionPending(null);
    }
  };

  const handlePageSizeChange = (newSize: CatalogPageSize) => {
    setPageSize(newSize);
    setCurrentPage((prev) =>
      clampCatalogPage(prev, filteredItems.length, newSize)
    );
  };

  const handleExportCatalog = async () => {
    if (!activeShop || exportingExcel) return;
    setExportingExcel(true);
    try {
      const filename = activeShop.slug
        ? `Thuc-don-${activeShop.slug}`
        : `Thuc-don-${activeShop.name}`;
      await downloadCatalogXlsx(items, categories, filename);
      showToast(
        tx(
          'Đã xuất file Excel thực đơn thành công!',
          'Successfully exported catalog to Excel!'
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(
        tx('Không thể xuất file: {msg}', 'Could not export file: {msg}', {
          msg,
        })
      );
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mutation error (server rejected change; optimistic state already rolled back) */}
      {mutationError && (
        <div
          role="alert"
          data-testid="catalog-mutation-error"
          className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800"
        >
          <div className="space-y-1">
            <p>{mutationError.message}</p>
            {mutationError.upgradeHref && (
              <Link
                href={mutationError.upgradeHref}
                className="inline-flex items-center gap-1 font-black text-emerald-700 underline"
              >
                <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                {mutationError.ctaLabel || tx('Nâng cấp gói', 'Upgrade plan')} →
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMutationError(null)}
            aria-label={t('common.close')}
            className="-m-1 rounded-full p-1 text-rose-500 hover:bg-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Bulk Result Banner (Total Success or Partial Failure) */}
      {bulkResultBanner && (
        <div
          role={bulkResultBanner.status === 'partial' ? 'alert' : 'status'}
          data-testid="catalog-bulk-result-banner"
          className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-bold ${
            bulkResultBanner.status === 'partial'
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {bulkResultBanner.status === 'partial' ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
              <span>{bulkResultBanner.message}</span>
            </div>
            {bulkResultBanner.details && bulkResultBanner.details.length > 0 && (
              <ul
                data-testid="catalog-bulk-result-details"
                className="list-disc space-y-1 pl-6 text-[11px] font-semibold text-amber-900"
              >
                {bulkResultBanner.details.map((detail, idx) => (
                  <li key={`${detail.id}-${idx}`}>
                    <span className="font-bold">
                      {detail.name || detail.id}
                    </span>
                    {detail.error ? `: ${detail.error}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => setBulkResultBanner(null)}
            aria-label={t('common.close')}
            className="-m-1 rounded-full p-1 opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Catalog Load Error Alert Banner (silent refresh failure) */}
      {shouldShowCatalogLoadErrorBanner({ hasLoaded, loadError }) && (
        <div
          role="alert"
          data-testid="catalog-load-error"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800 shadow-2xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
            <span data-testid="catalog-load-error-message">
              {tx(
                'Không thể tải dữ liệu thực đơn & tồn kho. Vui lòng thử lại.',
                'Could not load menu & inventory data. Please try again.'
              )}
            </span>
          </div>
          <button
            type="button"
            data-testid="catalog-load-error-retry"
            onClick={() => void loadCatalog(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3.5 py-1.5 text-xs font-black text-rose-800 hover:bg-rose-100 shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-xl border border-slate-700">
          ✨ {toastMsg}
        </div>
      )}

      {/* Header & Add Item CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            {tx('Thực đơn', 'Menu')}
          </h1>
          <p className="text-xs text-slate-500">
            {tx(
              'Bật/tắt còn món hoặc sửa giá bán trực tiếp bên dưới — cập nhật ngay trên thực đơn QR.',
              'Toggle availability or edit prices inline — updates immediately on the QR menu.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportCatalog}
            disabled={exportingExcel || items.length === 0}
            title={tx(
              'Xuất file Excel (.xlsx) để chỉnh sửa giá & tồn kho hàng loạt',
              'Export Excel (.xlsx) file to edit price & stock in bulk'
            )}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exportingExcel ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
            ) : (
              <Download className="h-4 w-4 text-emerald-600" />
            )}
            <span>{tx('Xuất Excel', 'Export Excel')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExcelModalOpen(true)}
            title={tx(
              'Nhập file Excel (.xlsx) để cập nhật giá & tồn kho hàng loạt',
              'Import Excel (.xlsx) file to bulk update price & stock'
            )}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>{tx('Nhập Excel', 'Import Excel')}</span>
          </button>

          <Link
            href="/dashboard/ai-scanner"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Sparkles className="h-4 w-4" />
            <span>{tx('Quét ảnh thực đơn', 'Scan Menu Photo')}</span>
          </Link>

          <button
            type="button"
            disabled={itemLimitReached}
            aria-describedby={itemLimitReached ? 'catalog-item-limit-hint' : undefined}
            title={
              itemLimitReached
                ? tx(
                    'Đã đạt giới hạn {max} món của gói hiện tại',
                    'Reached the {max}-item limit of your plan',
                    { max: planCfg.maxItems }
                  )
                : undefined
            }
            onClick={() => {
              if (itemLimitReached) return;
              setEditingItem(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            <Plus className="h-4 w-4" />
            <span>{tx('Thêm món mới', 'Add Item')}</span>
          </button>
        </div>
      </div>

      {itemLimitReached && (
        <div
          id="catalog-item-limit-hint"
          data-testid="catalog-item-limit-hint"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900"
        >
          <span>
            {tx(
              'Bạn đã dùng hết {max} món của {plan}. Nâng cấp để thêm món mới.',
              'You have used all {max} items on the {plan}. Upgrade to add more items.',
              { max: planCfg.maxItems, plan: planLabel }
            )}
          </span>
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 font-black text-slate-950 hover:bg-amber-400"
          >
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            {tx('Nâng cấp gói', 'Upgrade plan')}
          </Link>
        </div>
      )}

      {/* Plan Quota Usage Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 text-xs">
          <Crown className="h-4 w-4 text-amber-500" />
          <span className="font-bold text-slate-700">
            {planLabel}: {tx('Đang dùng', 'Using')}{' '}
            <strong className="text-slate-950">{items.length}</strong> /{' '}
            {planCfg.maxItems > 9000
              ? tx('Không giới hạn', 'Unlimited')
              : tx('{max} món', '{max} items', { max: planCfg.maxItems })}
          </span>
        </div>
        {planTier !== 'premium' && (
          <Link
            href="/dashboard/billing"
            className="text-xs font-bold text-emerald-600 hover:underline"
          >
            {tx('Nâng cấp mở khóa không giới hạn →', 'Upgrade for unlimited items →')}
          </Link>
        )}
      </div>

      {/* Add Category Form & Filter Pills */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        {canManageCatalog && (
          <form
            onSubmit={handleCreateCategory}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={tx(
                'Nhập tên danh mục mới (VD: Món Nước, Làm Móng, Đặc Sản)...',
                'New category name (e.g. Drinks, Nail Care, Specialties)...'
              )}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={addingCategory || !newCategoryName.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>
                {addingCategory
                  ? tx('Đang tạo...', 'Creating...')
                  : tx('Thêm danh mục', 'Add Category')}
              </span>
            </button>
          </form>
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          <button
            type="button"
            onClick={() => {
              if (selectedCategoryId !== 'all') {
                clearBulkSelectionAndDrafts();
              }
              setSelectedCategoryId('all');
              setCurrentPage(1);
            }}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
              selectedCategoryId === 'all'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t('common.all')} ({items.length})
          </button>

          {categories.map((cat) => {
            const count = items.filter((i) => i.category_id === cat.id).length;
            const active = selectedCategoryId === cat.id;
            const isEditing = canManageCatalog && editingCategoryId === cat.id;
            const isSaving = savingCategoryId === cat.id;

            return (
              <CategoryChip
                key={cat.id}
                cat={cat}
                count={count}
                active={active}
                canManageCatalog={canManageCatalog}
                isEditing={isEditing}
                isSaving={isSaving}
                editingName={editingCategoryName}
                deletingCategoryId={deletingCategoryId}
                savingCategoryId={savingCategoryId}
                categoriesCount={categories.length}
                onSelect={() => {
                  if (selectedCategoryId !== cat.id) {
                    clearBulkSelectionAndDrafts();
                  }
                  setSelectedCategoryId(cat.id);
                  setCurrentPage(1);
                }}
                onStartRename={() => handleStartRenameCategory(cat)}
                onCancelRename={handleCancelRenameCategory}
                onChangeEditingName={setEditingCategoryName}
                onSubmitRename={() => void handleRenameCategory(cat)}
                onDelete={() => void handleDeleteCategory(cat)}
              />
            );
          })}
        </div>
      </div>

      {/* Search Box */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
            clearBulkSelectionAndDrafts();
          }}
          placeholder={tx(
            'Tìm nhanh món hoặc dịch vụ để đổi trạng thái, sửa giá...',
            'Search items or services to toggle stock or edit price...'
          )}
          className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Quick Item List / Loading / Error State / Empty State */}
      {loading ? (
        <div
          role="status"
          data-testid="catalog-loading-state"
          className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs"
        >
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
          <p className="text-sm font-bold text-slate-800">
            {tx(
              'Đang tải dữ liệu thực đơn & tồn kho...',
              'Loading menu & inventory data...'
            )}
          </p>
          <p className="text-xs text-slate-500">
            {tx('Vui lòng đợi trong giây lát', 'Please wait a moment')}
          </p>
        </div>
      ) : shouldShowCatalogLoadErrorState({ hasLoaded, loadError, loading }) ? (
        <div
          role="alert"
          data-testid="catalog-load-error-state"
          className="rounded-3xl border border-dashed border-rose-300 bg-white p-12 text-center space-y-4 shadow-2xs"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-800">
              {tx(
                'Không thể tải dữ liệu thực đơn & tồn kho. Vui lòng thử lại.',
                'Could not load menu & inventory data. Please try again.'
              )}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {tx(
                'Không thể tải dữ liệu thực đơn do lỗi kết nối hoặc máy chủ. Vui lòng bấm thử lại.',
                'Failed to load menu data due to a connection or server error. Please try again.'
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="catalog-load-error-state-retry"
            onClick={() => void loadCatalog(false)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      ) : shouldShowCatalogEmptyState({ hasLoaded, loadError, filteredCount: filteredItems.length, loading }) ? (
        <div
          data-testid="catalog-empty-state"
          className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-3 shadow-2xs"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-800">
            {searchQuery.trim()
              ? tx(
                  'Không tìm thấy món hoặc sản phẩm nào khớp với từ khóa',
                  'No menu items match your search query'
                )
              : tx(
                  'Chưa có món ăn hoặc sản phẩm nào trong danh mục này',
                  'No menu items or products in this category yet'
                )}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {tx(
              'Bấm "Thêm món mới" hoặc dùng "Quét ảnh thực đơn" để thêm món và dịch tự động sang 8 ngôn ngữ.',
              'Click "Add Item" or use "Scan Menu Photo" to add dishes with automatic 8-language translation.'
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Select-Current-Page Bar */}
          {pagedItems.length > 0 && (
            <div
              data-testid="catalog-select-page-bar"
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs shadow-2xs flex-wrap"
            >
              <label
                htmlFor="catalog-select-current-page"
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 font-bold text-slate-700 select-none"
              >
                <input
                  ref={selectPageCheckboxRef}
                  id="catalog-select-current-page"
                  data-testid="catalog-select-page-checkbox"
                  type="checkbox"
                  checked={allOnPageSelected}
                  aria-checked={
                    someOnPageSelected
                      ? 'mixed'
                      : allOnPageSelected
                        ? 'true'
                        : 'false'
                  }
                  disabled={Boolean(bulkActionPending) || pagedItems.length === 0}
                  onChange={handleToggleSelectCurrentPage}
                  className="h-[1.15em] w-[1.15em] cursor-pointer rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span>
                  {tx(
                    'Chọn tất cả trên trang này ({selected}/{total} món)',
                    'Select all on this page ({selected}/{total} items)',
                    {
                      selected: selectedOnPageCount,
                      total: pagedItems.length,
                    }
                  )}
                </span>
              </label>

              {selectedIds.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-extrabold text-emerald-800 border border-emerald-200">
                    {tx(
                      'Đã chọn {count} món',
                      '{count} item(s) selected',
                      { count: selectedIds.length }
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Compact Bilingual Bulk Action Toolbar (visible only when >= 1 item is selected) */}
          {selectedIds.length > 0 && (
            <div
              role="region"
              aria-label={tx('Thao tác hàng loạt', 'Bulk actions')}
              data-testid="catalog-bulk-action-bar"
              className="rounded-2xl border-2 border-emerald-500/70 bg-emerald-50/40 p-3 shadow-sm space-y-2.5"
            >
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
                {/* Selection Count & Clear Selection */}
                <div className="flex items-center justify-between sm:justify-start gap-2.5 shrink-0">
                  <span
                    data-testid="catalog-bulk-selected-count"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-2xs"
                  >
                    <span>
                      {tx(
                        'Đã chọn {count} món',
                        '{count} selected',
                        { count: selectedIds.length }
                      )}
                    </span>
                  </span>

                  <button
                    type="button"
                    data-testid="catalog-bulk-clear-selection"
                    disabled={Boolean(bulkActionPending)}
                    onClick={clearBulkSelectionAndDrafts}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tx('Bỏ chọn', 'Clear selection')}</span>
                  </button>
                </div>

                {/* Bulk Action Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 1. Availability: Mark Available / Mark Sold Out */}
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="catalog-bulk-available-btn"
                      disabled={!canAdjustInventory || Boolean(bulkActionPending)}
                      onClick={() => void handleBulkSetAvailability(true)}
                      title={
                        !canAdjustInventory
                          ? tx(
                              'Cần quyền điều chỉnh tồn kho hoặc quản lý thực đơn',
                              'Requires inventory.adjust or catalog.manage permission'
                            )
                          : tx(
                              'Đặt trạng thái Còn hàng cho các món đã chọn (giữ nguyên số lượng tồn kho)',
                              'Mark selected items as available (leaves stock quantity untouched)'
                            )
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulkActionPending === 'available' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      <span>{tx('Bật còn hàng', 'Mark available')}</span>
                    </button>

                    <button
                      type="button"
                      data-testid="catalog-bulk-soldout-btn"
                      disabled={!canAdjustInventory || Boolean(bulkActionPending)}
                      onClick={() => void handleBulkSetAvailability(false)}
                      title={
                        !canAdjustInventory
                          ? tx(
                              'Cần quyền điều chỉnh tồn kho hoặc quản lý thực đơn',
                              'Requires inventory.adjust or catalog.manage permission'
                            )
                          : tx(
                              'Đặt trạng thái Tạm hết cho các món đã chọn (giữ nguyên số lượng tồn kho)',
                              'Mark selected items as sold out (leaves stock quantity untouched)'
                            )
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulkActionPending === 'sold_out' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      )}
                      <span>{tx('Tạm hết', 'Mark sold out')}</span>
                    </button>
                  </div>

                  {/* 2. Set One Exact VND Price */}
                  <form
                    onSubmit={handleBulkUpdatePrice}
                    className="inline-flex items-center gap-1.5"
                  >
                    <label
                      htmlFor="catalog-bulk-price-input"
                      className="sr-only"
                    >
                      {tx('Giá bán đồng loạt (VND)', 'Bulk price (VND)')}
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="catalog-bulk-price-input"
                        data-testid="catalog-bulk-price-input"
                        type="text"
                        inputMode="numeric"
                        value={bulkPriceInput}
                        disabled={!canManageCatalog || Boolean(bulkActionPending)}
                        onChange={(e) => {
                          setBulkPriceInput(e.target.value);
                          if (bulkPriceError) setBulkPriceError(null);
                        }}
                        placeholder={tx(
                          'Giá mới (VD: 35.000)',
                          'New price (e.g. 35000)'
                        )}
                        aria-invalid={bulkPriceError ? 'true' : 'false'}
                        aria-describedby={
                          bulkPriceError ? 'catalog-bulk-price-error' : undefined
                        }
                        title={
                          !canManageCatalog
                            ? tx(
                                'Cần quyền quản lý thực đơn (catalog.manage)',
                                'Requires catalog.manage permission'
                              )
                            : undefined
                        }
                        className={`w-36 sm:w-40 rounded-xl border px-2.5 py-1.5 pr-6 text-xs font-bold focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                          bulkPriceError
                            ? 'border-rose-400 bg-rose-50 text-rose-800 focus:border-rose-500 focus:bg-white'
                            : 'border-slate-200 bg-white text-slate-900 focus:border-emerald-500'
                        }`}
                      />
                      <span className="pointer-events-none absolute right-2 text-[11px] font-bold text-slate-400">
                        đ
                      </span>
                    </div>
                    <button
                      type="submit"
                      data-testid="catalog-bulk-price-apply"
                      disabled={!canManageCatalog || Boolean(bulkActionPending)}
                      title={
                        !canManageCatalog
                          ? tx(
                              'Cần quyền quản lý thực đơn (catalog.manage)',
                              'Requires catalog.manage permission'
                            )
                          : tx(
                              'Đặt cùng mức giá VND cho các món đã chọn',
                              'Set this exact VND price for all selected items'
                            )
                      }
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulkActionPending === 'price' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Tag className="h-3.5 w-3.5" />
                      )}
                      <span>{tx('Đặt giá', 'Set price')}</span>
                    </button>
                  </form>

                  {/* 3. Move to Category */}
                  <form
                    onSubmit={handleBulkMoveCategory}
                    className="inline-flex items-center gap-1.5"
                  >
                    <label
                      htmlFor="catalog-bulk-category-select"
                      className="sr-only"
                    >
                      {tx('Chuyển sang danh mục', 'Move to category')}
                    </label>
                    <select
                      id="catalog-bulk-category-select"
                      data-testid="catalog-bulk-category-select"
                      value={bulkTargetCategoryId}
                      disabled={!canManageCatalog || Boolean(bulkActionPending)}
                      onChange={(e) => setBulkTargetCategoryId(e.target.value)}
                      title={
                        !canManageCatalog
                          ? tx(
                              'Cần quyền quản lý thực đơn (catalog.manage)',
                              'Requires catalog.manage permission'
                            )
                          : undefined
                      }
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">
                        {tx('Chọn danh mục...', 'Select category...')}
                      </option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name_i18n.vi}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      data-testid="catalog-bulk-category-apply"
                      disabled={
                        !canManageCatalog ||
                        Boolean(bulkActionPending) ||
                        !bulkTargetCategoryId
                      }
                      title={
                        !canManageCatalog
                          ? tx(
                              'Cần quyền quản lý thực đơn (catalog.manage)',
                              'Requires catalog.manage permission'
                            )
                          : tx(
                              'Chuyển các món đã chọn sang danh mục này',
                              'Move selected items to this category'
                            )
                      }
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {bulkActionPending === 'move' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FolderInput className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      <span>{tx('Chuyển danh mục', 'Move category')}</span>
                    </button>
                  </form>

                  {/* 4. Bulk Delete */}
                  <button
                    type="button"
                    data-testid="catalog-bulk-delete-btn"
                    disabled={!canManageCatalog || Boolean(bulkActionPending)}
                    onClick={() => void handleBulkDelete()}
                    title={
                      !canManageCatalog
                        ? tx(
                            'Cần quyền quản lý thực đơn (catalog.manage)',
                            'Requires catalog.manage permission'
                          )
                        : tx(
                            'Xóa các món đã chọn khỏi thực đơn',
                            'Delete selected items from menu'
                          )
                    }
                    className="inline-flex items-center gap-1 rounded-xl border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulkActionPending === 'delete' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {tx('Xóa ({count})', 'Delete ({count})', {
                        count: selectedIds.length,
                      })}
                    </span>
                  </button>
                </div>
              </div>

              {bulkPriceError && (
                <p
                  id="catalog-bulk-price-error"
                  data-testid="catalog-bulk-price-error"
                  role="alert"
                  className="text-[11px] font-bold text-rose-600"
                >
                  {bulkPriceError}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {pagedItems.map((item) => (
              <QuickItemRow
                key={item.id}
                item={item}
                canManageCatalog={canManageCatalog}
                canAdjustInventory={canAdjustInventory}
                selected={selectedItemIds.has(item.id)}
                onToggleSelect={handleToggleSelectItem}
                selectionDisabled={Boolean(bulkActionPending)}
                onToggleAvailable={handleToggleAvailable}
                onUpdatePrice={handleUpdatePrice}
                onUpdateStock={handleUpdateStock}
                onUpdateImage={handleUpdateImage}
                onToggleFeatured={handleToggleFeatured}
                onEditTranslations={(target) => {
                  setEditingItem(target);
                  setIsModalOpen(true);
                }}
                onDelete={handleDeleteItem}
              />
            ))}
          </div>

          {/* Pagination Controls Bar */}
          {filteredItems.length > 0 && (
            <div
              data-testid="catalog-pagination-bar"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-xs shadow-2xs"
            >
              <div className="text-slate-500 font-medium">
                {tx(
                  'Hiển thị {start} – {end} trong số {total} món',
                  'Showing {start} – {end} of {total} items',
                  {
                    start: pagination.start,
                    end: pagination.end,
                    total: pagination.totalItems,
                  }
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap justify-between sm:justify-end">
                {/* Page Size Selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">
                    {tx('Số món / trang:', 'Per page:')}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(e) =>
                      handlePageSizeChange(
                        Number(e.target.value) as CatalogPageSize
                      )
                    }
                    aria-label={tx('Số món mỗi trang', 'Items per page')}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 font-bold text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
                  >
                    {CATALOG_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Page Prev / Next */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!pagination.hasPrev}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label={tx('Trang trước', 'Previous page')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <span className="px-2 font-bold text-slate-700">
                    {tx('Trang {current} / {total}', 'Page {current} of {total}', {
                      current: pagination.page,
                      total: pagination.totalPages,
                    })}
                  </span>

                  <button
                    type="button"
                    disabled={!pagination.hasNext}
                    onClick={() =>
                      setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))
                    }
                    aria-label={tx('Trang sau', 'Next page')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Translation & Item Editor Modal */}
      <TranslationEditorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        shopId={activeShop.id}
        vertical={activeShop.vertical}
        categories={categories}
        editingItem={editingItem}
        defaultCategoryId={
          selectedCategoryId !== 'all' ? selectedCategoryId : categories[0]?.id
        }
        onSaved={() => {
          void loadCatalog(true);
          showToast(
            tx(
              'Đã lưu món và cập nhật bản dịch 8 ngôn ngữ!',
              'Saved item and updated 8-language translations!'
            )
          );
        }}
      />

      {/* Excel Bulk Import Modal */}
      <CatalogExcelImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        shopId={activeShop.id}
        shopName={activeShop.name}
        currentItems={items}
        categories={categories}
        onSuccess={(count) => {
          void loadCatalog(true);
          notifyRealtime();
          showToast(
            tx(
              'Đã cập nhật thành công {count} món từ file Excel!',
              'Successfully updated {count} items from Excel!',
              { count }
            )
          );
        }}
      />

      {confirmDialog}
    </div>
  );
}
