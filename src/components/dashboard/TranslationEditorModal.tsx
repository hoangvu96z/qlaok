'use client';

import { appLanguageName } from '@/lib/app-i18n';

import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Loader2,
  Upload,
  Check,
  Languages,
  Clock,
  Plus,
  Trash2,
  SlidersHorizontal,
  FileText,
} from 'lucide-react';
import {
  BusinessVertical,
  CatalogItem,
  Category,
  I18nText,
  ItemOptionChoice,
  ItemOptionGroup,
  SupportedLocale,
} from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META, formatCurrency } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { uploadCompressedImage } from '@/lib/upload-helper';
import {
  ITEM_OPTION_GROUP_PRESETS,
  normalizeAndTranslateOptionGroups,
} from '@/lib/item-options-presets';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import Link from 'next/link';
import { getAuthHeaders } from '@/lib/auth-session';
import { formatPlanLimitError } from '@/lib/plan-limits';

const PRESET_BUTTON_LABELS: Record<string, { vi: string; en: string }> = {
  sugar_level: { vi: '+ Mức đường', en: '+ Sugar level' },
  ice_level: { vi: '+ Mức đá', en: '+ Ice level' },
  drink_size: { vi: '+ Kích cỡ (M/L)', en: '+ Size (M/L)' },
  drink_toppings: { vi: '+ Topping đồ uống', en: '+ Drink toppings' },
  food_addons: { vi: '+ Món gọi thêm', en: '+ Extra add-ons' },
};

interface TranslationEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
  vertical: BusinessVertical;
  categories: Category[];
  editingItem: CatalogItem | null;
  defaultCategoryId?: string;
  onSaved: () => void;
}

export function TranslationEditorModal({
  isOpen,
  onClose,
  shopId,
  vertical,
  categories,
  editingItem,
  defaultCategoryId,
  onSaved,
}: TranslationEditorModalProps) {
  const { locale, t, tx } = useAppI18n();
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('45000');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [durationMins, setDurationMins] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);

  const [nameI18n, setNameI18n] = useState<I18nText>({
    vi: '',
    en: '',
    ko: '',
    ja: '',
    zh: '',
    es: '',
    it: '',
    ru: '',
  });
  const [descI18n, setDescI18n] = useState<I18nText>({
    vi: '',
    en: '',
    ko: '',
    ja: '',
    zh: '',
    es: '',
    it: '',
    ru: '',
  });

  // Rich Option Groups & Toppings state
  const [optionGroups, setOptionGroups] = useState<ItemOptionGroup[]>([]);

  const [activeTab, setActiveTab] = useState<SupportedLocale>('vi');
  const [translating, setTranslating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setErrorMsg('');
    if (editingItem) {
      setCategoryId(editingItem.category_id);
      setPrice(String(editingItem.price));
      setCompareAtPrice(
        editingItem.compare_at_price ? String(editingItem.compare_at_price) : ''
      );
      setDurationMins(
        editingItem.duration_mins ? String(editingItem.duration_mins) : ''
      );
      setImageUrl(editingItem.image_url || '');
      setIsFeatured(editingItem.is_featured);
      setIsAvailable(editingItem.is_available);
      setNameI18n({
        vi: editingItem.name_i18n?.vi || '',
        en: editingItem.name_i18n?.en || '',
        ko: editingItem.name_i18n?.ko || '',
        ja: editingItem.name_i18n?.ja || '',
        zh: editingItem.name_i18n?.zh || '',
        es: editingItem.name_i18n?.es || '',
        it: editingItem.name_i18n?.it || '',
        ru: editingItem.name_i18n?.ru || '',
      });
      setDescI18n({
        vi: editingItem.desc_i18n?.vi || '',
        en: editingItem.desc_i18n?.en || '',
        ko: editingItem.desc_i18n?.ko || '',
        ja: editingItem.desc_i18n?.ja || '',
        zh: editingItem.desc_i18n?.zh || '',
        es: editingItem.desc_i18n?.es || '',
        it: editingItem.desc_i18n?.it || '',
        ru: editingItem.desc_i18n?.ru || '',
      });
      setOptionGroups(
        Array.isArray(editingItem.options_json)
          ? JSON.parse(JSON.stringify(editingItem.options_json))
          : []
      );
    } else {
      setCategoryId(defaultCategoryId || categories[0]?.id || '');
      setPrice('45000');
      setCompareAtPrice('');
      setDurationMins(vertical === 'service' ? '60' : '');
      setImageUrl('');
      setIsFeatured(false);
      setIsAvailable(true);
      setNameI18n({
        vi: '',
        en: '',
        ko: '',
        ja: '',
        zh: '',
        es: '',
        it: '',
        ru: '',
      });
      setDescI18n({
        vi: '',
        en: '',
        ko: '',
        ja: '',
        zh: '',
        es: '',
        it: '',
        ru: '',
      });
      setOptionGroups([]);
    }
    setActiveTab('vi');
  }, [editingItem, defaultCategoryId, categories, vertical, isOpen]);

  if (!isOpen) return null;

  // Option Groups Manipulation Helpers
  const handleAddBlankOptionGroup = () => {
    const newGroup: ItemOptionGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name_i18n: {
        vi: 'Nhóm tùy chọn mới',
        en: 'New option group',
      },
      desc_i18n: { vi: '' },
      required: false,
      choices: [
        {
          id: `ch-${Date.now()}-1`,
          label_i18n: { vi: 'Lựa chọn 1', en: 'Option 1' },
          desc_i18n: { vi: '' },
          extra_price: 0,
        },
      ],
    };
    setOptionGroups((prev) => [...prev, newGroup]);
  };

  const handleAddPresetGroup = (createFn: () => ItemOptionGroup) => {
    setOptionGroups((prev) => [...prev, createFn()]);
  };

  const handleRemoveOptionGroup = (groupId: string) => {
    setOptionGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const handleUpdateGroupField = (
    groupId: string,
    updater: (group: ItemOptionGroup) => ItemOptionGroup
  ) => {
    setOptionGroups((prev) =>
      prev.map((g) => (g.id === groupId ? updater(g) : g))
    );
  };

  const handleAddChoiceToGroup = (groupId: string) => {
    const newChoice: ItemOptionChoice = {
      id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label_i18n: { vi: '' },
      desc_i18n: { vi: '' },
      extra_price: 0,
    };
    handleUpdateGroupField(groupId, (g) => ({
      ...g,
      choices: [...g.choices, newChoice],
    }));
  };

  const handleUpdateChoice = (
    groupId: string,
    choiceId: string,
    updater: (choice: ItemOptionChoice) => ItemOptionChoice
  ) => {
    handleUpdateGroupField(groupId, (g) => ({
      ...g,
      choices: g.choices.map((c) => (c.id === choiceId ? updater(c) : c)),
    }));
  };

  const handleRemoveChoice = (groupId: string, choiceId: string) => {
    handleUpdateGroupField(groupId, (g) => ({
      ...g,
      choices: g.choices.filter((c) => c.id !== choiceId),
    }));
  };

  const handleAiTranslate = async () => {
    if (!nameI18n.vi.trim()) {
      setErrorMsg(
        tx(
          'Vui lòng nhập tên món bằng Tiếng Việt trước khi dịch.',
          'Please enter the Vietnamese item name before translating.'
        )
      );
      return;
    }
    setErrorMsg('');
    setTranslating(true);
    try {
      const currentCategory = categories.find((c) => c.id === categoryId);
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          vertical,
          categoryNameVi: currentCategory?.name_i18n.vi || 'Danh mục',
          itemNameVi: nameI18n.vi,
          itemDescVi: descI18n.vi,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || tx('Dịch tự động thất bại', 'Auto-translation failed')
        );
      }
      if (data.name_i18n) {
        setNameI18n(data.name_i18n);
      }
      if (data.desc_i18n) {
        setDescI18n(data.desc_i18n);
      }
      // Also normalize/auto-translate option groups
      setOptionGroups((prev) => normalizeAndTranslateOptionGroups(prev));
      setActiveTab('en');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx('Lỗi khi dịch tự động', 'Auto-translation error')
      );
    } finally {
      setTranslating(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setErrorMsg('');
    try {
      const publicUrl = await uploadCompressedImage(file);
      if (publicUrl) {
        setImageUrl(publicUrl);
      }
    } catch (err) {
      console.error('Image compression/upload error:', err);
      setErrorMsg(
        tx(
          'Không thể tải ảnh lên. Bạn có thể dán trực tiếp link ảnh.',
          'Could not upload image. You can paste an image URL instead.'
        )
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameI18n.vi.trim()) {
      setErrorMsg(
        tx(
          'Tên Tiếng Việt không được để trống.',
          'Vietnamese item name is required.'
        )
      );
      return;
    }
    if (!categoryId) {
      setErrorMsg(tx('Vui lòng chọn danh mục.', 'Please select a category.'));
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      const normalizedOptions = normalizeAndTranslateOptionGroups(optionGroups);

      const payload = {
        action: 'upsert_item',
        item: {
          id: editingItem?.id,
          shop_id: shopId,
          category_id: categoryId,
          price: Number(price.replace(/[^\d]/g, '')) || 0,
          compare_at_price: compareAtPrice
            ? Number(compareAtPrice.replace(/[^\d]/g, ''))
            : null,
          duration_mins: durationMins ? Number(durationMins) : null,
          image_url: imageUrl.trim() || null,
          ...(!editingItem || isAvailable !== editingItem.is_available
            ? { is_available: isAvailable }
            : {}),
          is_featured: isFeatured,
          name_i18n: nameI18n,
          desc_i18n: descI18n,
          options_json: normalizedOptions,
        },
      };

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || tx('Không thể lưu món', 'Could not save item')
        );
      }

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({ type: 'item_updated' });
        bc.close();
      }

      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx('Lỗi khi lưu dữ liệu', 'Failed to save item')
      );
    } finally {
      setSaving(false);
    }
  };

  const planLimitErr = errorMsg ? formatPlanLimitError(errorMsg, locale) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Languages className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                {editingItem
                  ? tx('Chỉnh sửa món ({name})', 'Edit item ({name})', {
                      name:
                        (locale === 'en' && editingItem.name_i18n.en) ||
                        editingItem.name_i18n.vi,
                    })
                  : tx(
                      'Thêm món mới & dịch 8 ngôn ngữ',
                      'Add item & 8-language translation'
                    )}
              </h3>
              <p className="text-xs text-slate-500">
                {tx(
                  'Cài đặt giá bán, mô tả, tùy chọn đi kèm và bản dịch trên thực đơn QR.',
                  'Set price, description, add-on options, and translations for the QR menu.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200/70 text-slate-600 hover:bg-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="p-5 space-y-5 max-h-[82vh] overflow-y-auto"
        >
          {errorMsg && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 flex flex-wrap items-center justify-between gap-2">
              <span>⚠️ {planLimitErr ? planLimitErr.message : errorMsg}</span>
              {planLimitErr && (
                <Link
                  href={planLimitErr.upgradeHref}
                  onClick={onClose}
                  className="inline-flex items-center rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-500"
                >
                  {planLimitErr.ctaLabel}
                </Link>
              )}
            </div>
          )}

          {/* Top Grid: Left Image + Basic Price/Category */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Dish Image Upload */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 flex items-center gap-3.5">
              <label
                title={tx('Chọn ảnh món từ máy', 'Upload item image')}
                className="group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-emerald-400 bg-white shadow-2xs"
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={tx('Ảnh món', 'Item preview')}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-emerald-700">
                    <Upload className="h-5 w-5" />
                    <span className="text-[10px] font-extrabold">
                      {tx('Chọn ảnh', 'Upload')}
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-extrabold text-slate-900">
                    📷 {tx('Ảnh món', 'Item photo')}
                  </span>
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => setImageUrl('')}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      {tx('Xoá ảnh', 'Remove')}
                    </button>
                  )}
                </div>

                <label className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-2xs hover:bg-emerald-500">
                  <Upload className="h-3.5 w-3.5" />
                  <span>
                    {uploadingImage
                      ? tx('Đang tải...', 'Uploading...')
                      : tx('Tải ảnh lên', 'Upload photo')}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>

                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder={tx(
                    'Hoặc dán link ảnh https://...',
                    'Or paste image URL https://...'
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-800 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Category, Base Price & Flags */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {tx('Danh mục *', 'Category *')}
                  </label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {(locale === 'en' && c.name_i18n.en) || c.name_i18n.vi}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {tx('Giá bán (VNĐ) *', 'Price (VND) *')}
                  </label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="45000"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-emerald-700 focus:border-emerald-500 focus:bg-white focus:outline-none"
                  />
                </div>

                {vertical === 'service' ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Thời lượng (phút)', 'Duration (mins)')}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={durationMins}
                        onChange={(e) => setDurationMins(e.target.value)}
                        placeholder={tx('VD: 60', 'e.g. 60')}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                      />
                      <Clock className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Giá gốc gạch ngang', 'Compare-at price')}
                    </label>
                    <input
                      type="number"
                      value={compareAtPrice}
                      onChange={(e) => setCompareAtPrice(e.target.value)}
                      placeholder={tx('Tuỳ chọn', 'Optional')}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFeatured}
                    onChange={(e) => setIsFeatured(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    {tx('★ Món bán chạy / Nổi bật', '★ Best seller / Featured')}
                  </span>
                </label>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => setIsAvailable(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{tx('Đang còn món', 'In stock / Available')}</span>
                </label>
              </div>
            </div>
          </div>

          {/* SECTION 1: Vietnamese Name & Detailed Description for Customers */}
          <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-950">
                <FileText className="h-4 w-4 text-emerald-600" />
                <span>
                  {tx(
                    '1. Tên món & mô tả gốc (Tiếng Việt)',
                    '1. Source Name & Description (Vietnamese)'
                  )}
                </span>
              </span>

              <button
                type="button"
                onClick={handleAiTranslate}
                disabled={translating}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 active:scale-95"
              >
                {translating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>
                      {tx('Đang dịch 8 ngôn ngữ...', 'Translating 8 languages...')}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      {tx(
                        '✨ Dịch tự động sang 8 ngôn ngữ',
                        '✨ Auto-translate to 8 languages'
                      )}
                    </span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {tx('Tên món / dịch vụ (Tiếng Việt) *', 'Item / service name (Vietnamese) *')}
                </label>
                <input
                  type="text"
                  value={nameI18n.vi}
                  onChange={(e) =>
                    setNameI18n((prev) => ({ ...prev, vi: e.target.value }))
                  }
                  placeholder={tx(
                    'VD: Trà sữa Ô Long Kem Cheese, Phở Bò...',
                    'e.g. Oolong Cheese Milk Tea, Beef Pho...'
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div className="md:col-span-7">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  {tx(
                    'Mô tả thành phần / hương vị',
                    'Ingredients / flavor description'
                  )}
                </label>
                <textarea
                  rows={2}
                  value={descI18n.vi || ''}
                  onChange={(e) =>
                    setDescI18n((prev) => ({ ...prev, vi: e.target.value }))
                  }
                  placeholder={tx(
                    'VD: Trà Ô Long nướng đậm vị kết hợp sữa tươi và kem cheese...',
                    'e.g. Roasted Oolong tea with fresh milk and savory cream cheese...'
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Option Groups & Toppings Builder (Sugar/Ice/Size/Toppings +Extra Price) */}
          <div className="rounded-2xl border-2 border-amber-400/50 bg-amber-50/30 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/70 pb-3">
              <div>
                <h4 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4 text-amber-600" />
                  <span>
                    {tx(
                      '2. Tùy chọn & Topping đi kèm ({count} nhóm)',
                      '2. Options & Add-ons ({count} groups)',
                      { count: optionGroups.length }
                    )}
                  </span>
                </h4>
                <p className="text-[11px] text-slate-600">
                  {tx(
                    'Thêm mức đường, đá, kích cỡ hoặc topping cộng thêm tiền trên thực đơn QR và tại quầy.',
                    'Add sugar, ice, size, or paid toppings shown on the QR menu and counter.'
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddBlankOptionGroup}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white shadow-xs hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5 text-amber-400" />
                <span>{tx('Tạo nhóm tùy chọn', 'Add option group')}</span>
              </button>
            </div>

            {/* 1-Click Quick Preset Templates */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-extrabold text-slate-600">
                ⚡ {tx('Chèn nhanh nhóm mẫu:', 'Quick presets:')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ITEM_OPTION_GROUP_PRESETS.map((preset) => {
                  const lbl = PRESET_BUTTON_LABELS[preset.key];
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => handleAddPresetGroup(preset.createGroup)}
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-800 shadow-2xs hover:bg-amber-100/70 hover:border-amber-400 transition"
                    >
                      <span>{lbl ? tx(lbl.vi, lbl.en) : preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Option Groups List */}
            {optionGroups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 text-center space-y-1">
                <p className="text-xs font-bold text-slate-600">
                  {tx(
                    'Món này chưa có nhóm tùy chọn hoặc topping.',
                    'No option groups or toppings yet.'
                  )}
                </p>
                <p className="text-[11px] text-slate-400">
                  {tx(
                    'Chọn một nhóm mẫu phía trên để thêm nhanh.',
                    'Click a preset button above to add one in a second.'
                  )}
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {optionGroups.map((group, gIdx) => (
                  <div
                    key={group.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3"
                  >
                    {/* Group Header Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-start border-b border-slate-100 pb-3">
                      <div className="md:col-span-4">
                        <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                          {tx(
                            'Tên nhóm #{index} *',
                            'Group name #{index} *',
                            { index: gIdx + 1 }
                          )}
                        </label>
                        <input
                          type="text"
                          value={group.name_i18n?.vi || ''}
                          onChange={(e) =>
                            handleUpdateGroupField(group.id, (g) => ({
                              ...g,
                              name_i18n: { ...g.name_i18n, vi: e.target.value },
                            }))
                          }
                          placeholder={tx(
                            'VD: Mức đường, Chọn Size, Topping...',
                            'e.g. Sugar level, Size, Toppings...'
                          )}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div className="md:col-span-4">
                        <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                          {tx('Ghi chú nhóm', 'Group note')}
                        </label>
                        <input
                          type="text"
                          value={group.desc_i18n?.vi || ''}
                          onChange={(e) =>
                            handleUpdateGroupField(group.id, (g) => ({
                              ...g,
                              desc_i18n: {
                                ...(g.desc_i18n || { vi: '' }),
                                vi: e.target.value,
                              },
                            }))
                          }
                          placeholder={tx(
                            'VD: Chọn 1 mức ngọt hoặc nhiều topping...',
                            'e.g. Pick 1 level or multiple toppings...'
                          )}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 focus:border-emerald-500 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div className="md:col-span-3">
                        <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1">
                          {tx('Kiểu chọn', 'Selection rule')}
                        </label>
                        <select
                          value={group.required ? 'single_required' : 'multi_optional'}
                          onChange={(e) =>
                            handleUpdateGroupField(group.id, (g) => ({
                              ...g,
                              required: e.target.value === 'single_required',
                            }))
                          }
                          className={`w-full rounded-xl border px-2.5 py-2 text-xs font-bold ${
                            group.required
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : 'border-amber-300 bg-amber-50 text-amber-900'
                          }`}
                        >
                          <option value="single_required">
                            {tx('🔘 Bắt buộc chọn 1', '🔘 Required (pick 1)')}
                          </option>
                          <option value="multi_optional">
                            {tx('☑️ Tùy chọn (chọn nhiều)', '☑️ Optional (multi-select)')}
                          </option>
                        </select>
                      </div>

                      <div className="md:col-span-1 flex justify-end pt-4">
                        <button
                          type="button"
                          onClick={() => handleRemoveOptionGroup(group.id)}
                          title={tx('Xóa nhóm này', 'Remove group')}
                          aria-label={tx('Xóa nhóm này', 'Remove group')}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Choices List inside Group */}
                    <div className="space-y-2">
                      <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-1 text-[10px] font-extrabold uppercase text-slate-400">
                        <div className="col-span-4">
                          {tx('Tên lựa chọn *', 'Option label *')}
                        </div>
                        <div className="col-span-5">
                          {tx('Mô tả ngắn', 'Short note')}
                        </div>
                        <div className="col-span-2">
                          {tx('Giá cộng (+đ)', 'Extra (+VND)')}
                        </div>
                        <div className="col-span-1 text-right">
                          {t('common.delete')}
                        </div>
                      </div>

                      {group.choices.map((choice) => (
                        <div
                          key={choice.id}
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded-xl bg-slate-50/90 p-2 border border-slate-200/80"
                        >
                          <div className="sm:col-span-4">
                            <input
                              type="text"
                              value={choice.label_i18n?.vi || ''}
                              onChange={(e) =>
                                handleUpdateChoice(group.id, choice.id, (c) => ({
                                  ...c,
                                  label_i18n: {
                                    ...c.label_i18n,
                                    vi: e.target.value,
                                  },
                                }))
                              }
                              placeholder={tx(
                                'VD: Ít đường (70%) hoặc Trân châu',
                                'e.g. Less sugar (70%) or Boba'
                              )}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900"
                            />
                          </div>

                          <div className="sm:col-span-5">
                            <input
                              type="text"
                              value={choice.desc_i18n?.vi || ''}
                              onChange={(e) =>
                                handleUpdateChoice(group.id, choice.id, (c) => ({
                                  ...c,
                                  desc_i18n: {
                                    ...(c.desc_i18n || { vi: '' }),
                                    vi: e.target.value,
                                  },
                                }))
                              }
                              placeholder={tx(
                                'Mô tả ngắn (VD: Ngọt thanh / Giòn...)',
                                'Short note (e.g. Lightly sweet / Crispy...)'
                              )}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600"
                            />
                          </div>

                          <div className="sm:col-span-2 relative">
                            <input
                              type="number"
                              step="1000"
                              min="0"
                              value={choice.extra_price ?? 0}
                              onChange={(e) =>
                                handleUpdateChoice(group.id, choice.id, (c) => ({
                                  ...c,
                                  extra_price: Math.max(
                                    0,
                                    Number(e.target.value) || 0
                                  ),
                                }))
                              }
                              className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-black ${
                                (choice.extra_price || 0) > 0
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 bg-white text-slate-600'
                              }`}
                            />
                            {(choice.extra_price || 0) > 0 && (
                              <span className="block text-[9px] font-bold text-emerald-600 mt-0.5">
                                +{formatCurrency(choice.extra_price, 'VND')}
                              </span>
                            )}
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveChoice(group.id, choice.id)
                              }
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              title={tx('Xóa lựa chọn', 'Remove option')}
                              aria-label={tx('Xóa lựa chọn', 'Remove option')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => handleAddChoiceToGroup(group.id)}
                        className="inline-flex items-center gap-1 rounded-xl border border-dashed border-emerald-400 bg-emerald-50/50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100/70"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>
                          {tx(
                            'Thêm lựa chọn vào "{name}"',
                            'Add option to "{name}"',
                            { name: group.name_i18n.vi }
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 3: 8-Language Tabs Editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700">
                {tx(
                  '3. Kiểm tra bản dịch 8 ngôn ngữ:',
                  '3. Review 8-language translations:'
                )}
              </span>
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
                {ALL_LOCALES.map((loc) => {
                  const meta = LOCALE_META[loc];
                  const hasValue = Boolean(nameI18n[loc]?.trim());
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveTab(loc)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                        activeTab === loc
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <FlagIcon locale={loc} title={appLanguageName(loc, locale)} className="h-3.5 w-5" />
                      <span>{meta.short}</span>
                      {hasValue && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1">
              <div className="md:col-span-5">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
                  <span>{tx('Tên hiển thị (', 'Display name (')}</span>
                  <FlagIcon locale={activeTab} title={appLanguageName(activeTab, locale)} className="h-3 w-4" />
                  <span>{appLanguageName(activeTab, locale)})</span>
                </label>
                <input
                  type="text"
                  value={nameI18n[activeTab] || ''}
                  onChange={(e) =>
                    setNameI18n((prev) => ({
                      ...prev,
                      [activeTab]: e.target.value,
                    }))
                  }
                  placeholder={tx(
                    'Bản dịch tên sang {lang}...',
                    'Translated name in {lang}...',
                    { lang: appLanguageName(activeTab, locale) }
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="md:col-span-7">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
                  <span>{tx('Mô tả món (', 'Description (')}</span>
                  <FlagIcon locale={activeTab} title={appLanguageName(activeTab, locale)} className="h-3 w-4" />
                  <span>{appLanguageName(activeTab, locale)})</span>
                </label>
                <textarea
                  rows={2}
                  value={descI18n[activeTab] || ''}
                  onChange={(e) =>
                    setDescI18n((prev) => ({
                      ...prev,
                      [activeTab]: e.target.value,
                    }))
                  }
                  placeholder={tx(
                    'Bản dịch mô tả sang {lang}...',
                    'Translated description in {lang}...',
                    { lang: appLanguageName(activeTab, locale) }
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('common.saving')}</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>{tx('Lưu món vào thực đơn', 'Save item to menu')}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
