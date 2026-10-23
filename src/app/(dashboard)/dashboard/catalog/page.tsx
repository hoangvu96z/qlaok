'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
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
import { downloadCatalogXlsx } from '@/lib/catalog-excel';
import { CatalogExcelImportModal } from '@/components/dashboard/CatalogExcelImportModal';
import {
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

export default function DashboardCatalogPage() {
  const { activeShop } = useDashboard();
  const { locale, t, tx } = useAppI18n();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [mutationError, setMutationError] = useState<CatalogMutationError | null>(
    null
  );
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
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

  const [pageSize, setPageSize] = useState<CatalogPageSize>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const loadCatalog = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/catalog?shopId=${activeShop.id}`, {
          headers: getAuthHeaders(),
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
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
        setLoadError(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeShop]
  );

  useEffect(() => {
    setCategories([]);
    setItems([]);
    setSelectedCategoryId('all');
    setCurrentPage(1);
    setOwnerPlan('free');
    setLoadError(false);
    setHasLoaded(false);
    void loadCatalog(false);
  }, [loadCatalog]);

  const notifyRealtime = () => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel('qlaok_realtime_sync');
      bc.postMessage({ type: 'catalog_changed' });
      bc.close();
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2500);
  };

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
    try {
      const res = await fetch(input, init);
      if (res.ok) {
        setMutationError(null);
        return true;
      }
      const payload = await res.json().catch(() => null);
      setMutationError(toMutationError(payload, fallback));
      return false;
    } catch (err) {
      setMutationError(toMutationError(err, fallback));
      return false;
    }
  };

  const upsertItem = (item: CatalogItem) =>
    sendCatalogMutation(
      '/api/catalog',
      {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'upsert_item', item }),
      },
      tx('Không thể lưu thay đổi món', 'Could not save item changes')
    );

  /** Restores the server-confirmed item snapshot after a rejected optimistic update. */
  const rollbackItem = (original: CatalogItem) => {
    setItems((prev) => prev.map((i) => (i.id === original.id ? original : i)));
  };

  const handleToggleAvailable = async (
    item: CatalogItem,
    nextAvailable: boolean
  ): Promise<boolean> => {
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_available: nextAvailable } : i
      )
    );
    const ok = await upsertItem({ ...item, is_available: nextAvailable });
    if (!ok) {
      rollbackItem(item);
      return false;
    }
    notifyRealtime();
    showToast(
      nextAvailable
        ? tx('Đã bật còn món: {name}', 'Marked available: {name}', {
            name: item.name_i18n.vi,
          })
        : tx('Đã chuyển tạm hết: {name}', 'Marked sold out: {name}', {
            name: item.name_i18n.vi,
          })
    );
    return true;
  };

  const handleUpdatePrice = async (
    item: CatalogItem,
    nextPrice: number
  ): Promise<boolean> => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, price: nextPrice } : i))
    );
    const ok = await upsertItem({ ...item, price: nextPrice });
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
    const nextAvailable =
      nextStock === 0 ? false : nextStock && nextStock > 0 ? true : item.is_available;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, stock_quantity: nextStock, is_available: nextAvailable }
          : i
      )
    );
    const ok = await upsertItem({
      ...item,
      stock_quantity: nextStock,
      is_available: nextAvailable,
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
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_featured: nextFeatured } : i
      )
    );
    const ok = await upsertItem({ ...item, is_featured: nextFeatured });
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
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, image_url: nextImageUrl } : i
      )
    );
    const ok = await upsertItem({ ...item, image_url: nextImageUrl });
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
    if (!confirmed) return false;

    const originalIndex = items.findIndex((i) => i.id === itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    const ok = await sendCatalogMutation(
      `/api/catalog?itemId=${encodeURIComponent(itemId)}`,
      { method: 'DELETE', headers: getAuthHeaders() },
      tx('Không thể xóa món', 'Could not delete item')
    );
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
    notifyRealtime();
    showToast(tx('Đã xóa món khỏi thực đơn', 'Deleted item from menu'));
    return true;
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShop || !newCategoryName.trim()) return;
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
              name_i18n: translatedName || { vi: nameVi, en: nameVi },
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

  const handleDeleteCategory = async (cat: Category) => {
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
      if (selectedCategoryId === cat.id) setSelectedCategoryId('all');
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

  // Synchronize currentPage state to valid bounds whenever the filtered item count or pageSize changes.
  useEffect(() => {
    setCurrentPage((prev) => {
      const clamped = clampCatalogPage(prev, filteredItems.length, pageSize);
      return prev === clamped ? prev : clamped;
    });
  }, [filteredItems.length, pageSize]);

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

  const planTier = ownerPlan;
  const planCfg = PLAN_CONFIGS[planTier];
  const itemLimitReached = items.length >= planCfg.maxItems;
  const planLabel =
    planTier === 'premium'
      ? tx('Gói Cao Cấp (Premium)', 'Premium Plan')
      : planTier === 'basic'
        ? tx('Gói Cơ Bản (Basic)', 'Basic Plan')
        : tx('Gói Khởi Đầu (Free)', 'Starter Plan (Free)');

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

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
          <button
            type="button"
            onClick={() => {
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
            return (
              <div
                key={cat.id}
                className={`inline-flex items-center gap-1 shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    setCurrentPage(1);
                  }}
                >
                  {cat.name_i18n.vi} ({count})
                </button>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteCategory(cat)}
                    disabled={deletingCategoryId === cat.id}
                    className="ml-1 opacity-60 hover:opacity-100 disabled:cursor-wait disabled:opacity-30"
                    title={tx('Xóa danh mục', 'Delete category')}
                    aria-label={tx('Xóa danh mục', 'Delete category')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
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
          <div className="space-y-2">
            {pagedItems.map((item) => (
              <QuickItemRow
                key={item.id}
                item={item}
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
