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
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { CatalogItem, Category } from '@/types/qlaok';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { QuickItemRow } from '@/components/dashboard/QuickItemRow';
import { TranslationEditorModal } from '@/components/dashboard/TranslationEditorModal';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export default function DashboardCatalogPage() {
  const { activeShop, profile } = useDashboard();
  const { t, tx } = useAppI18n();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
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

  const loadCatalog = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/catalog?shopId=${activeShop.id}`, {
          headers: getAuthHeaders(),
          cache: 'no-store',
        });
        const data = await res.json();
        setCategories(data.categories || []);
        setItems(data.items || []);
      } catch {
        // ignore network errors
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

  const handleToggleAvailable = async (
    item: CatalogItem,
    nextAvailable: boolean
  ) => {
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_available: nextAvailable } : i
      )
    );
    await fetch('/api/catalog', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upsert_item',
        item: {
          ...item,
          is_available: nextAvailable,
        },
      }),
    });
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
  };

  const handleUpdatePrice = async (item: CatalogItem, nextPrice: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, price: nextPrice } : i))
    );
    await fetch('/api/catalog', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upsert_item',
        item: {
          ...item,
          price: nextPrice,
        },
      }),
    });
    notifyRealtime();
  };

  const handleUpdateStock = async (
    item: CatalogItem,
    nextStock: number | null
  ) => {
    const nextAvailable =
      nextStock === 0 ? false : nextStock && nextStock > 0 ? true : item.is_available;
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, stock_quantity: nextStock, is_available: nextAvailable }
          : i
      )
    );
    await fetch('/api/catalog', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upsert_item',
        item: {
          ...item,
          stock_quantity: nextStock,
          is_available: nextAvailable,
        },
      }),
    });
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
  };

  const handleToggleFeatured = async (
    item: CatalogItem,
    nextFeatured: boolean
  ) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_featured: nextFeatured } : i
      )
    );
    await fetch('/api/catalog', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upsert_item',
        item: {
          ...item,
          is_featured: nextFeatured,
        },
      }),
    });
    notifyRealtime();
  };

  const handleUpdateImage = async (item: CatalogItem, nextImageUrl: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, image_url: nextImageUrl } : i
      )
    );
    await fetch('/api/catalog', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upsert_item',
        item: {
          ...item,
          image_url: nextImageUrl,
        },
      }),
    });
    notifyRealtime();
    showToast(
      tx('Đã cập nhật ảnh món: {name}', 'Updated item photo: {name}', {
        name: item.name_i18n.vi,
      })
    );
  };

  const handleDeleteItem = async (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    await fetch(`/api/catalog?itemId=${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    notifyRealtime();
    showToast(tx('Đã xóa món khỏi thực đơn', 'Deleted item from menu'));
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShop || !newCategoryName.trim()) return;
    setAddingCategory(true);
    try {
      // Translate category name via AI API
      const transRes = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical: activeShop.vertical,
          categoryNameVi: newCategoryName.trim(),
          itemNameVi: newCategoryName.trim(),
        }),
      });
      const transData = await transRes.json();

      await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'upsert_category',
          category: {
            shop_id: activeShop.id,
            name_i18n: transData.name_i18n || {
              vi: newCategoryName.trim(),
              en: newCategoryName.trim(),
            },
          },
        }),
      });
      setNewCategoryName('');
      await loadCatalog(true);
      notifyRealtime();
      showToast(
        tx(
          'Đã tạo danh mục mới và dịch tự động',
          'Created category with auto-translation'
        )
      );
    } finally {
      setAddingCategory(false);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    await fetch(`/api/catalog?categoryId=${encodeURIComponent(catId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (selectedCategoryId === catId) setSelectedCategoryId('all');
    await loadCatalog(true);
    notifyRealtime();
    showToast(tx('Đã xóa danh mục', 'Deleted category'));
  };

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

  const planTier = profile?.plan || 'free';
  const planCfg = PLAN_CONFIGS[planTier];
  const planLabel =
    planTier === 'premium'
      ? tx('Gói Cao Cấp (Premium)', 'Premium Plan')
      : planTier === 'basic'
        ? tx('Gói Cơ Bản (Basic)', 'Basic Plan')
        : tx('Gói Khởi Đầu (Free)', 'Starter Plan (Free)');
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

  return (
    <div className="space-y-5">
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

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/ai-scanner"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Sparkles className="h-4 w-4" />
            <span>{tx('Quét ảnh thực đơn', 'Scan Menu Photo')}</span>
          </Link>

          <button
            type="button"
            onClick={() => {
              setEditingItem(null);
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>{tx('Thêm món mới', 'Add Item')}</span>
          </button>
        </div>
      </div>

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
            onClick={() => setSelectedCategoryId('all')}
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
                  onClick={() => setSelectedCategoryId(cat.id)}
                >
                  {cat.name_i18n.vi} ({count})
                </button>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat.id)}
                    className="ml-1 opacity-60 hover:opacity-100"
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
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={tx(
            'Tìm nhanh món hoặc dịch vụ để đổi trạng thái, sửa giá...',
            'Search items or services to toggle stock or edit price...'
          )}
          className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Quick Item List / Loading / Empty State */}
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
      ) : filteredItems.length === 0 ? (
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
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
          {filteredItems.map((item) => (
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
    </div>
  );
}
