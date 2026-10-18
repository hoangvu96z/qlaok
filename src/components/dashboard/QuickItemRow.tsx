'use client';

import React, { useState, useEffect } from 'react';
import {
  Languages,
  Trash2,
  Sparkles,
  Clock,
  Check,
  Package,
  Camera,
  Loader2,
} from 'lucide-react';
import { CatalogItem } from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { uploadCompressedImage } from '@/lib/upload-helper';

interface QuickItemRowProps {
  item: CatalogItem;
  onToggleAvailable: (item: CatalogItem, nextAvailable: boolean) => Promise<void>;
  onUpdatePrice: (item: CatalogItem, nextPrice: number) => Promise<void>;
  onUpdateStock?: (item: CatalogItem, nextStock: number | null) => Promise<void>;
  onUpdateImage?: (item: CatalogItem, nextImageUrl: string) => Promise<void>;
  onToggleFeatured: (item: CatalogItem, nextFeatured: boolean) => Promise<void>;
  onEditTranslations: (item: CatalogItem) => void;
  onDelete: (itemId: string) => Promise<void>;
}

export function QuickItemRow({
  item,
  onToggleAvailable,
  onUpdatePrice,
  onUpdateStock,
  onUpdateImage,
  onToggleFeatured,
  onEditTranslations,
  onDelete,
}: QuickItemRowProps) {
  const { locale, t, tx } = useAppI18n();
  const [priceInput, setPriceInput] = useState(String(item.price));
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);

  const [stockInput, setStockInput] = useState(
    item.stock_quantity === null || item.stock_quantity === undefined
      ? ''
      : String(item.stock_quantity)
  );
  const [stockSaved, setStockSaved] = useState(false);

  useEffect(() => {
    setPriceInput(String(item.price));
  }, [item.price]);

  useEffect(() => {
    setImgBroken(false);
  }, [item.image_url]);

  useEffect(() => {
    setStockInput(
      item.stock_quantity === null || item.stock_quantity === undefined
        ? ''
        : String(item.stock_quantity)
    );
  }, [item.stock_quantity]);

  const handlePriceBlurOrEnter = async () => {
    const numeric = Number(priceInput.replace(/[^\d]/g, ''));
    if (isNaN(numeric) || numeric === item.price) {
      setPriceInput(String(item.price));
      return;
    }
    setSavingPrice(true);
    await onUpdatePrice(item, numeric);
    setSavingPrice(false);
    setPriceSaved(true);
    setTimeout(() => setPriceSaved(false), 1800);
  };

  const handleStockBlurOrEnter = async () => {
    if (!onUpdateStock) return;
    const trimmed = stockInput.trim();
    const nextStock =
      trimmed === '' ? null : Math.max(0, Number(trimmed.replace(/[^\d]/g, '')));
    const currentStock =
      item.stock_quantity === undefined ? null : item.stock_quantity;

    if (nextStock === currentStock || (nextStock !== null && isNaN(nextStock))) {
      setStockInput(currentStock === null ? '' : String(currentStock));
      return;
    }

    await onUpdateStock(item, nextStock);
    setStockSaved(true);
    setTimeout(() => setStockSaved(false), 1800);
  };

  const handleDirectPhotoSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateImage) return;
    setUploadingPhoto(true);
    try {
      const publicUrl = await uploadCompressedImage(file);
      if (publicUrl) {
        setImgBroken(false);
        await onUpdateImage(item, publicUrl);
      }
    } catch (err) {
      console.error('Quick photo upload failed:', err);
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const translatedLangs = ALL_LOCALES.filter(
    (loc) => item.name_i18n?.[loc] && item.name_i18n[loc]!.trim().length > 0
  );

  const isLowStock =
    typeof item.stock_quantity === 'number' &&
    item.stock_quantity > 0 &&
    item.stock_quantity <= 5;

  const hasValidImage = Boolean(item.image_url && !imgBroken);

  return (
    <div
      className={`rounded-2xl border bg-white p-3.5 shadow-2xs transition-all ${
        item.is_available
          ? 'border-slate-200'
          : 'border-rose-200 bg-rose-50/30 opacity-80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Clickable Dish Image Thumbnail with 1-Tap Upload */}
          <label
            title={tx(
              'Bấm để tải lên hoặc đổi ảnh món',
              'Click to upload or change item photo'
            )}
            className="group relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
          >
            {hasValidImage ? (
              <img
                src={item.image_url!}
                alt={item.name_i18n.vi}
                onError={() => setImgBroken(true)}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-slate-400">
                <Camera className="h-4 w-4 text-emerald-600" />
                <span className="text-[9px] font-extrabold text-emerald-700">
                  {tx('+ Tải ảnh', '+ Photo')}
                </span>
              </div>
            )}

            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-slate-900/75 py-0.5 text-[9px] font-bold text-white">
              {uploadingPhoto ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <>
                  <Camera className="h-2.5 w-2.5 text-emerald-400" />
                  <span>
                    {hasValidImage
                      ? tx('Đổi ảnh', 'Change')
                      : tx('Tải ảnh', 'Upload')}
                  </span>
                </>
              )}
            </span>

            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDirectPhotoSelect}
            />
          </label>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {item.name_i18n.vi}
              </h4>
              {!item.is_available && (
                <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                  {tx('Tạm hết', 'Sold out')}
                </span>
              )}
              {isLowStock && (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  {tx(
                    '⚠️ Sắp hết ({count})',
                    '⚠️ Low stock ({count})',
                    { count: item.stock_quantity }
                  )}
                </span>
              )}
              {item.is_featured && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {tx('★ Bán chạy', '★ Popular')}
                </span>
              )}
            </div>

            {item.name_i18n.en && (
              <p className="truncate text-xs text-slate-500 flex items-center gap-1.5">
                <FlagIcon locale="en" className="h-3 w-4" />
                <span className="truncate">{item.name_i18n.en}</span>
              </p>
            )}

            {(locale === 'en'
              ? item.desc_i18n?.en || item.desc_i18n?.vi
              : item.desc_i18n?.vi) && (
              <p className="line-clamp-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-2 py-1 border border-slate-100">
                📝{' '}
                {locale === 'en'
                  ? item.desc_i18n?.en || item.desc_i18n?.vi
                  : item.desc_i18n?.vi}
              </p>
            )}

            {/* Option Groups & Toppings Summary Badges */}
            {item.options_json && item.options_json.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {item.options_json.map((group) => {
                  const hasPaidChoice = group.choices?.some(
                    (c) => (c.extra_price || 0) > 0
                  );
                  const groupName =
                    locale === 'en'
                      ? group.name_i18n?.en || group.name_i18n?.vi
                      : group.name_i18n?.vi;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => onEditTranslations(item)}
                      title={group.choices
                        ?.map((c) => {
                          const choiceLabel =
                            locale === 'en'
                              ? c.label_i18n?.en || c.label_i18n?.vi
                              : c.label_i18n?.vi;
                          return `${choiceLabel}${
                            c.extra_price > 0
                              ? ` (+${c.extra_price.toLocaleString('vi-VN')}đ)`
                              : ''
                          }`;
                        })
                        .join(', ')}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold transition hover:opacity-80 ${
                        hasPaidChoice
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-800'
                      }`}
                    >
                      <span>{hasPaidChoice ? '🧋' : '⚙️'}</span>
                      <span>
                        {groupName} ({group.choices?.length || 0})
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Translation status flags & duration */}
            <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
              <div className="flex items-center gap-1.5">
                {ALL_LOCALES.map((loc) => {
                  const hasTrans = translatedLangs.includes(loc);
                  return (
                    <span
                      key={loc}
                      title={`${LOCALE_META[loc].nativeName}: ${
                        hasTrans
                          ? item.name_i18n[loc]
                          : tx('Chưa dịch', 'Not translated')
                      }`}
                      className={`inline-flex items-center transition-opacity ${
                        hasTrans ? 'opacity-100' : 'opacity-25 grayscale'
                      }`}
                    >
                      <FlagIcon locale={loc} className="h-3.5 w-5" />
                    </span>
                  );
                })}
              </div>

              {item.duration_mins && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <Clock className="h-3 w-3" />
                  {tx('{mins}p', '{mins}m', { mins: item.duration_mins })}
                </span>
              )}

              <span className="text-[11px] font-semibold text-emerald-700">
                {tx('🔥 Đã bán: {count}', '🔥 Sold: {count}', {
                  count: item.sold_count || 0,
                })}
              </span>

              <span className="text-[11px] text-slate-400">
                {tx('👁 {count} lượt xem', '👁 {count} views', {
                  count: item.view_count || 0,
                })}
              </span>
            </div>
          </div>
        </div>

        {/* 1-Tap Availability Switch */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={item.is_available}
            aria-label={
              item.is_available
                ? tx('Đang còn hàng', 'Available')
                : tx('Đang tạm hết', 'Sold out')
            }
            onClick={() => onToggleAvailable(item, !item.is_available)}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              item.is_available ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                item.is_available ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <span
            className={`text-[10px] font-bold ${
              item.is_available ? 'text-emerald-700' : 'text-rose-600'
            }`}
          >
            {item.is_available
              ? tx('Còn hàng', 'Available')
              : tx('Tạm hết', 'Sold out')}
          </span>
        </div>
      </div>

      {/* Bottom Row: Direct Price Edit, Stock Quantity Edit & Action Buttons */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Direct inline price input */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">
              {tx('Giá:', 'Price:')}
            </span>
            <div className="relative flex items-center">
              <input
                type="text"
                inputMode="numeric"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                onBlur={handlePriceBlurOrEnter}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 pr-6 text-xs font-extrabold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
              <span className="pointer-events-none absolute right-2 text-xs font-bold text-slate-400">
                đ
              </span>
            </div>
            {savingPrice && (
              <span className="text-[11px] font-medium text-slate-400">
                {t('common.saving')}
              </span>
            )}
            {priceSaved && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </div>

          {/* Direct inline Stock Quantity input */}
          {onUpdateStock && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Package className="h-3.5 w-3.5 text-slate-400" />
                <span>{tx('Tồn kho:', 'Stock:')}</span>
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={stockInput}
                placeholder="∞"
                onChange={(e) => setStockInput(e.target.value)}
                onBlur={handleStockBlurOrEnter}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                title={tx(
                  'Nhập số lượng tồn kho (để trống = không giới hạn ∞)',
                  'Enter stock quantity (leave blank for unlimited ∞)'
                )}
                className={`w-16 rounded-xl border px-2.5 py-1.5 text-center text-xs font-extrabold focus:bg-white focus:outline-none ${
                  item.stock_quantity === 0
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : isLowStock
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-emerald-500'
                }`}
              />
              {stockSaved && (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> {t('common.saved')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            {uploadingPhoto ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
            ) : (
              <Camera className="h-3.5 w-3.5 text-emerald-600" />
            )}
            <span>
              {uploadingPhoto
                ? t('common.loading')
                : item.image_url
                  ? tx('Đổi ảnh', 'Change photo')
                  : tx('Tải ảnh', 'Upload photo')}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDirectPhotoSelect}
            />
          </label>

          <button
            type="button"
            onClick={() => onToggleFeatured(item, !item.is_featured)}
            className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              item.is_featured
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
            title={tx(
              'Đánh dấu món Bán chạy / Nổi bật',
              'Mark item as Popular / Featured'
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {tx('Nổi bật', 'Featured')}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onEditTranslations(item)}
            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{tx('⚙️ Tùy chọn & Dịch', '⚙️ Options & Translate')}</span>
          </button>

          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            title={t('common.delete')}
            aria-label={t('common.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
