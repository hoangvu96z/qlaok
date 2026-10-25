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
import type { CatalogItem } from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { FeedbackToast, type FeedbackToastMessage } from '@/components/ui/FeedbackToast';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { uploadCompressedImage } from '@/lib/upload-helper';
import {
  parseCatalogPriceValue,
  parseCatalogStockValue,
} from '@/lib/catalog-excel';

export interface QuickItemRowProps {
  item: CatalogItem;
  selected?: boolean;
  onToggleSelect?: (itemId: string, nextSelected: boolean) => void;
  selectionDisabled?: boolean;
  /** Mutation callbacks may resolve `false` when the server rejected the change (state rolled back). */
  onToggleAvailable: (item: CatalogItem, nextAvailable: boolean) => Promise<boolean | void>;
  onUpdatePrice: (item: CatalogItem, nextPrice: number) => Promise<boolean | void>;
  onUpdateStock?: (item: CatalogItem, nextStock: number | null) => Promise<boolean | void>;
  onUpdateImage?: (item: CatalogItem, nextImageUrl: string) => Promise<boolean | void>;
  onToggleFeatured: (item: CatalogItem, nextFeatured: boolean) => Promise<boolean | void>;
  onEditTranslations: (item: CatalogItem) => void;
  onDelete: (itemId: string) => Promise<boolean | void>;
}

export function QuickItemRow({
  item,
  selected = false,
  onToggleSelect,
  selectionDisabled = false,
  onToggleAvailable,
  onUpdatePrice,
  onUpdateStock,
  onUpdateImage,
  onToggleFeatured,
  onEditTranslations,
  onDelete,
}: QuickItemRowProps) {
  const { t, tx } = useAppI18n();
  const [priceInput, setPriceInput] = useState(String(item.price));
  const [priceError, setPriceError] = useState<string | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<FeedbackToastMessage | null>(null);
  const [imgBroken, setImgBroken] = useState(false);

  const [stockInput, setStockInput] = useState(
    item.stock_quantity === null || item.stock_quantity === undefined
      ? ''
      : String(item.stock_quantity)
  );
  const [stockError, setStockError] = useState<string | null>(null);
  const [savingStock, setSavingStock] = useState(false);
  const [stockSaved, setStockSaved] = useState(false);

  useEffect(() => {
    setPriceInput(String(item.price));
    setPriceError(null);
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
    setStockError(null);
  }, [item.stock_quantity]);

  const handlePriceBlurOrEnter = async () => {
    const parseResult = parseCatalogPriceValue(priceInput);
    if (!parseResult.valid) {
      // Invalid input: perform no request, preserve the invalid input with visible validation feedback,
      // and never silently turn it into zero or another amount.
      setPriceError(parseResult.error);
      return;
    }
    setPriceError(null);

    const nextPrice = parseResult.price;
    if (nextPrice === item.price) {
      setPriceInput(String(item.price));
      return;
    }

    setSavingPrice(true);
    let ok: boolean | void = false;
    try {
      ok = await onUpdatePrice(item, nextPrice);
    } finally {
      setSavingPrice(false);
    }
    if (ok === false) {
      setPriceInput(String(item.price));
      return;
    }
    setPriceInput(String(nextPrice));
    setPriceSaved(true);
    setTimeout(() => setPriceSaved(false), 1800);
  };

  const handleStockBlurOrEnter = async () => {
    if (!onUpdateStock) return;
    const parseResult = parseCatalogStockValue(stockInput);
    if (!parseResult.valid) {
      // Invalid input: perform no request, preserve the invalid input with visible validation feedback,
      // and never silently turn it into zero or another amount.
      setStockError(parseResult.error);
      return;
    }
    setStockError(null);

    const nextStock = parseResult.stock;
    const currentStock =
      item.stock_quantity === undefined ? null : item.stock_quantity;

    if (nextStock === currentStock) {
      setStockInput(currentStock === null ? '' : String(currentStock));
      return;
    }

    setSavingStock(true);
    let ok: boolean | void = false;
    try {
      ok = await onUpdateStock(item, nextStock);
    } finally {
      setSavingStock(false);
    }
    if (ok === false) {
      setStockInput(currentStock === null ? '' : String(currentStock));
      return;
    }
    setStockInput(nextStock === null ? '' : String(nextStock));
    setStockSaved(true);
    setTimeout(() => setStockSaved(false), 1800);
  };

  const handleDirectPhotoSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateImage) return;
    setPhotoFeedback(null);
    setUploadingPhoto(true);
    try {
      const publicUrl = await uploadCompressedImage(file);
      const saved = await onUpdateImage(item, publicUrl);
      if (saved === false) {
        setPhotoFeedback({
          kind: 'error',
          message: tx('Không thể lưu ảnh món. Vui lòng thử lại.', 'Could not save the item photo. Please try again.'),
        });
        return;
      }
      setImgBroken(false);
      setPhotoFeedback({
        kind: 'success',
        message: tx('Đã lưu ảnh món.', 'Item photo saved.'),
      });
    } catch {
      setPhotoFeedback({
        kind: 'error',
        message: tx('Không thể tải ảnh món lên. Vui lòng thử lại.', 'Could not upload the item photo. Please try again.'),
      });
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
      data-testid={`catalog-item-row-${item.id}`}
      className={`rounded-2xl border bg-white p-2.5 sm:p-3 transition-all shadow-2xs hover:border-slate-300 ${
        selected
          ? 'border-emerald-500 bg-emerald-50/10 ring-2 ring-emerald-500/20'
          : item.is_available
            ? 'border-slate-200'
            : 'border-rose-200 bg-rose-50/20 opacity-85'
      }`}
    >
      <FeedbackToast
        feedback={photoFeedback}
        dismissLabel={tx('Đóng thông báo', 'Dismiss notification')}
        onDismiss={() => setPhotoFeedback(null)}
      />
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
        {/* Left Section: Checkbox + Thumbnail + Item Identity + Metadata */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {/* Accessible Row Selection Checkbox */}
          <label
            htmlFor={`select-item-${item.id}`}
            className="-ml-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-slate-50"
            title={tx('Chọn món: {name}', 'Select item: {name}', {
              name: item.name_i18n.vi,
            })}
          >
            <input
              id={`select-item-${item.id}`}
              data-testid={`catalog-item-checkbox-${item.id}`}
              type="checkbox"
              checked={Boolean(selected)}
              disabled={selectionDisabled}
              onChange={(e) => onToggleSelect?.(item.id, e.target.checked)}
              aria-label={tx('Chọn món {name}', 'Select item {name}', {
                name: item.name_i18n.vi,
              })}
              className="h-[1.15em] w-[1.15em] cursor-pointer rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          {/* Clickable Image Thumbnail with 1-Tap Upload Overlay */}
          <label
            title={tx(
              'Bấm để tải lên hoặc đổi ảnh món',
              'Click to upload or change item photo'
            )}
            className="group relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
          >
            {hasValidImage ? (
              <img
                src={item.image_url!}
                alt={item.name_i18n.vi}
                onError={() => setImgBroken(true)}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center text-slate-400">
                <Camera className="h-4 w-4 text-emerald-600" />
              </div>
            )}

            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-slate-900/70 py-0.5 text-[8px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {uploadingPhoto ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Camera className="h-2.5 w-2.5 text-emerald-400" />
              )}
            </span>

            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleDirectPhotoSelect}
            />
          </label>

          {/* Item Details */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate leading-snug">
                {item.name_i18n.vi}
              </h4>
              {!item.is_available && (
                <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                  {tx('Tạm hết', 'Sold out')}
                </span>
              )}
              {isLowStock && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {tx('⚠️ Sắp hết ({count})', '⚠️ Low stock ({count})', {
                    count: item.stock_quantity,
                  })}
                </span>
              )}
              {item.is_featured && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {tx('★ Bán chạy', '★ Popular')}
                </span>
              )}
              {item.name_i18n.en && (
                <span className="text-xs text-slate-400 truncate hidden sm:inline">
                  ({item.name_i18n.en})
                </span>
              )}
            </div>

            {/* Sub-line metadata */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5 text-[11px]">
              {/* Language flags */}
              <div className="flex items-center gap-1 shrink-0">
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
                        hasTrans ? 'opacity-100' : 'opacity-20 grayscale'
                      }`}
                    >
                      <FlagIcon locale={loc} className="h-3 w-4" />
                    </span>
                  );
                })}
              </div>

              {/* Options badge */}
              {item.options_json && item.options_json.length > 0 && (
                <button
                  type="button"
                  onClick={() => onEditTranslations(item)}
                  className="inline-flex items-center gap-0.5 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.2 text-[10px] font-bold text-indigo-800 hover:bg-indigo-100"
                  title={tx('Xem tùy chọn & topping', 'View options & toppings')}
                >
                  <span>⚙️</span>
                  <span>
                    {item.options_json.length}{' '}
                    {tx('nhóm tùy chọn', 'options')}
                  </span>
                </button>
              )}

              {/* Sold count */}
              {Boolean(item.sold_count) && (
                <span className="font-semibold text-emerald-700">
                  {tx('🔥 Đã bán: {count}', '🔥 Sold: {count}', {
                    count: item.sold_count || 0,
                  })}
                </span>
              )}

              {/* Duration */}
              {item.duration_mins && (
                <span className="inline-flex items-center gap-0.5 font-medium text-slate-400">
                  <Clock className="h-3 w-3" />
                  {tx('{mins}p', '{mins}m', { mins: item.duration_mins })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Section: Availability + Inline Price & Stock + Action Buttons */}
        <div className="flex items-center justify-between lg:justify-end gap-2 sm:gap-3 shrink-0 flex-wrap sm:flex-nowrap border-t border-slate-100 pt-2 lg:border-t-0 lg:pt-0">
          {/* Availability Toggle Switch */}
          <div className="flex items-center gap-1.5 shrink-0">
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
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                item.is_available ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                  item.is_available ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span
              className={`text-[11px] font-bold hidden sm:inline ${
                item.is_available ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              {item.is_available
                ? tx('Còn hàng', 'Available')
                : tx('Tạm hết', 'Sold out')}
            </span>
          </div>

          {/* Quick Price Input */}
          <div className="flex items-center gap-1 shrink-0">
            <label
              htmlFor={`price-${item.id}`}
              className="text-xs font-semibold text-slate-500"
            >
              {tx('Giá:', 'Price:')}
            </label>
            <div className="relative flex items-center">
              <input
                id={`price-${item.id}`}
                type="text"
                inputMode="numeric"
                value={priceInput}
                onChange={(e) => {
                  setPriceInput(e.target.value);
                  if (priceError) setPriceError(null);
                }}
                onBlur={handlePriceBlurOrEnter}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                aria-label={tx('Giá bán', 'Price')}
                aria-invalid={priceError ? 'true' : 'false'}
                title={
                  priceError ||
                  tx(
                    'Nhập giá bán (VD: 35000 hoặc 35.000đ)',
                    'Enter price (e.g. 35000 or 35.000)'
                  )
                }
                className={`w-20 sm:w-24 rounded-xl border px-2 py-1 pr-5 text-xs font-extrabold focus:outline-none ${
                  priceError
                    ? 'border-rose-400 bg-rose-50 text-rose-700 focus:border-rose-500 focus:bg-white'
                    : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-emerald-500 focus:bg-white'
                }`}
              />
              <span className="pointer-events-none absolute right-1.5 text-[11px] font-bold text-slate-400">
                đ
              </span>
            </div>
            {savingPrice && (
              <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
            )}
            {priceSaved && (
              <span
                className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600"
                title={t('common.saved')}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
            {priceError && (
              <span
                className="inline-flex items-center justify-center text-xs font-black text-rose-600"
                role="alert"
                aria-label={priceError}
                title={priceError}
              >
                !
              </span>
            )}
          </div>

          {/* Quick Stock Input */}
          {onUpdateStock && (
            <div className="flex items-center gap-1 shrink-0">
              <label
                htmlFor={`stock-${item.id}`}
                className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-500"
                title={tx(
                  'Tồn kho (để trống hoặc ∞ = không giới hạn)',
                  'Stock (blank or ∞ = unlimited)'
                )}
              >
                <Package className="h-3.5 w-3.5 text-slate-400" />
                <span className="hidden sm:inline">{tx('Tồn:', 'Stock:')}</span>
              </label>
              <input
                id={`stock-${item.id}`}
                type="text"
                inputMode="numeric"
                value={stockInput}
                placeholder="∞"
                onChange={(e) => {
                  setStockInput(e.target.value);
                  if (stockError) setStockError(null);
                }}
                onBlur={handleStockBlurOrEnter}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                aria-label={tx('Số lượng tồn kho', 'Stock quantity')}
                aria-invalid={stockError ? 'true' : 'false'}
                title={
                  stockError ||
                  tx(
                    'Nhập tồn kho (để trống hoặc ∞ = không giới hạn)',
                    'Enter stock quantity (blank or ∞ = unlimited)'
                  )
                }
                className={`w-14 sm:w-16 rounded-xl border px-2 py-1 text-center text-xs font-extrabold focus:outline-none ${
                  stockError
                    ? 'border-rose-400 bg-rose-50 text-rose-700 focus:border-rose-500 focus:bg-white'
                    : item.stock_quantity === 0
                      ? 'border-rose-300 bg-rose-50 text-rose-700 focus:bg-white'
                      : isLowStock
                        ? 'border-amber-300 bg-amber-50 text-amber-800 focus:bg-white'
                        : 'border-slate-200 bg-slate-50 text-slate-900 focus:border-emerald-500 focus:bg-white'
                }`}
              />
              {savingStock && (
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
              )}
              {stockSaved && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600"
                  title={t('common.saved')}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
              {stockError && (
                <span
                  className="inline-flex items-center justify-center text-xs font-black text-rose-600"
                  role="alert"
                  aria-label={stockError}
                  title={stockError}
                >
                  !
                </span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Featured toggle */}
            <button
              type="button"
              onClick={() => onToggleFeatured(item, !item.is_featured)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
                item.is_featured
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-amber-600'
              }`}
              title={tx(
                'Đánh dấu món Bán chạy / Nổi bật',
                'Mark item as Popular / Featured'
              )}
              aria-label={tx('Nổi bật', 'Featured')}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>

            {/* Options & Translations */}
            <button
              type="button"
              onClick={() => onEditTranslations(item)}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
              title={tx('Tùy chọn & Dịch 8 ngôn ngữ', 'Options & 8-language translations')}
            >
              <Languages className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{tx('Tùy chọn', 'Options')}</span>
            </button>

            {/* Photo upload action */}
            <label
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title={tx('Đổi ảnh món', 'Change photo')}
              aria-label={tx('Đổi ảnh món', 'Change photo')}
            >
              {uploadingPhoto ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              ) : (
                <Camera className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleDirectPhotoSelect}
              />
            </label>

            {/* Delete button */}
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
    </div>
  );
}
