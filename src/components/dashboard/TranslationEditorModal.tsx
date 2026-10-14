'use client';

import React, { useState, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import {
  X,
  Sparkles,
  Loader2,
  Upload,
  Check,
  Languages,
  Clock,
} from 'lucide-react';
import {
  BusinessVertical,
  CatalogItem,
  Category,
  I18nText,
  SupportedLocale,
} from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';

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
  });
  const [descI18n, setDescI18n] = useState<I18nText>({
    vi: '',
    en: '',
    ko: '',
    ja: '',
    zh: '',
  });

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
      });
      setDescI18n({
        vi: editingItem.desc_i18n?.vi || '',
        en: editingItem.desc_i18n?.en || '',
        ko: editingItem.desc_i18n?.ko || '',
        ja: editingItem.desc_i18n?.ja || '',
        zh: editingItem.desc_i18n?.zh || '',
      });
    } else {
      setCategoryId(defaultCategoryId || categories[0]?.id || '');
      setPrice('45000');
      setCompareAtPrice('');
      setDurationMins(vertical === 'service' ? '60' : '');
      setImageUrl('');
      setIsFeatured(false);
      setIsAvailable(true);
      setNameI18n({ vi: '', en: '', ko: '', ja: '', zh: '' });
      setDescI18n({ vi: '', en: '', ko: '', ja: '', zh: '' });
    }
    setActiveTab('vi');
  }, [editingItem, defaultCategoryId, categories, vertical, isOpen]);

  if (!isOpen) return null;

  const handleAiTranslate = async () => {
    if (!nameI18n.vi.trim()) {
      setErrorMsg('Vui lòng nhập Tên món / dịch vụ bằng Tiếng Việt trước khi dịch AI.');
      return;
    }
    setErrorMsg('');
    setTranslating(true);
    try {
      const currentCategory = categories.find((c) => c.id === categoryId);
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical,
          categoryNameVi: currentCategory?.name_i18n.vi || 'Danh mục',
          itemNameVi: nameI18n.vi,
          itemDescVi: descI18n.vi,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Dịch tự động thất bại');
      }
      if (data.name_i18n) {
        setNameI18n(data.name_i18n);
      }
      if (data.desc_i18n) {
        setDescI18n(data.desc_i18n);
      }
      setActiveTab('en');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi dịch tự động');
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
      // Compress client-side to .webp (max 800px, <150KB) per technical specification
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.14,
        maxWidthOrHeight: 800,
        useWebWorker: true,
        fileType: 'image/webp',
      });

      const reader = new FileReader();
      const base64Data: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name.replace(/\.[^.]+$/, '.webp'),
          contentType: 'image/webp',
          base64Data,
        }),
      });
      const data = await res.json();
      if (data.publicUrl) {
        setImageUrl(data.publicUrl);
      }
    } catch (err) {
      console.error('Image compression/upload error:', err);
      setErrorMsg('Không thể nén/tải ảnh lên. Bạn có thể dán trực tiếp URL ảnh.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameI18n.vi.trim()) {
      setErrorMsg('Tên Tiếng Việt không được để trống.');
      return;
    }
    if (!categoryId) {
      setErrorMsg('Vui lòng chọn danh mục.');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
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
          is_available: isAvailable,
          is_featured: isFeatured,
          name_i18n: nameI18n,
          desc_i18n: descI18n,
          options_json: editingItem?.options_json || [],
        },
      };

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể lưu món');
      }

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({ type: 'item_updated' });
        bc.close();
      }

      onSaved();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi lưu dữ liệu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Languages className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                {editingItem
                  ? 'Chỉnh sửa Món / Dịch vụ & Bản dịch 5 Ngôn ngữ'
                  : 'Thêm Món / Dịch vụ Mới (AI Tự Dịch 5 Ngôn Ngữ)'}
              </h3>
              <p className="text-xs text-slate-500">
                Chỉ cần nhập Tiếng Việt, AI sẽ tự động bản địa hóa sang Anh, Hàn, Nhật, Trung
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200/70 text-slate-600 hover:bg-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Basic Info Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Danh mục *
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_i18n.vi}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Giá bán (VNĐ) *
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="45000"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>

            {vertical === 'service' ? (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Thời lượng (Phút)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={durationMins}
                    onChange={(e) => setDurationMins(e.target.value)}
                    placeholder="VD: 60"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                  />
                  <Clock className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Giá gốc (Nếu đang giảm)
                </label>
                <input
                  type="number"
                  value={compareAtPrice}
                  onChange={(e) => setCompareAtPrice(e.target.value)}
                  placeholder="Tuỳ chọn"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Vietnamese Source Input + AI Translate Button */}
          <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-950">
                🇻🇳 Nhập nội dung gốc Tiếng Việt
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
                    <span>Đang dịch 4 ngôn ngữ...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>✨ Dịch tự động 5 ngôn ngữ bằng AI</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Tên món / dịch vụ / sản phẩm (Tiếng Việt) *
                </label>
                <input
                  type="text"
                  value={nameI18n.vi}
                  onChange={(e) =>
                    setNameI18n((prev) => ({ ...prev, vi: e.target.value }))
                  }
                  placeholder="VD: Bạc xỉu đá, Phở bò tái nạm, Gội đầu dưỡng sinh thảo dược..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Mô tả ngắn (Để trống AI sẽ tự viết mô tả hấp dẫn)
                </label>
                <textarea
                  rows={2}
                  value={descI18n.vi || ''}
                  onChange={(e) =>
                    setDescI18n((prev) => ({ ...prev, vi: e.target.value }))
                  }
                  placeholder="VD: Nước dùng ninh xương bò 18 tiếng thanh ngọt tự nhiên..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 5-Language Tabs Editor */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-700">
                Kiểm tra & Chỉnh sửa tay bản dịch 5 ngôn ngữ:
              </span>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {ALL_LOCALES.map((loc) => {
                  const meta = LOCALE_META[loc];
                  const hasValue = Boolean(nameI18n[loc]?.trim());
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveTab(loc)}
                      className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                        activeTab === loc
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <span>{meta.flag}</span>
                      <span>{meta.short}</span>
                      {hasValue && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Tên hiển thị ({LOCALE_META[activeTab].flag}{' '}
                  {LOCALE_META[activeTab].label})
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
                  placeholder={`Bản dịch tên sang ${LOCALE_META[activeTab].label}...`}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Mô tả ({LOCALE_META[activeTab].flag}{' '}
                  {LOCALE_META[activeTab].label})
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
                  placeholder={`Bản dịch mô tả sang ${LOCALE_META[activeTab].label}...`}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Image Upload (Client-side WebP compression) + URL Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Ảnh minh họa (Tự động nén WebP &lt; 150KB)
              </label>
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                  <Upload className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    {uploadingImage ? 'Đang nén WebP...' : 'Tải ảnh từ máy'}
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
                  placeholder="Hoặc dán link ảnh https://..."
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-3 sm:pt-5">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>★ Món Best Seller / Nổi bật</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Đang còn hàng</span>
              </label>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Lưu vào Cửa Hàng</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
