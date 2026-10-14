'use client';

import React, { useState, useEffect } from 'react';
import {
  Languages,
  Trash2,
  Sparkles,
  Clock,
  Check,
  Edit3,
} from 'lucide-react';
import { CatalogItem } from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';

interface QuickItemRowProps {
  item: CatalogItem;
  onToggleAvailable: (item: CatalogItem, nextAvailable: boolean) => Promise<void>;
  onUpdatePrice: (item: CatalogItem, nextPrice: number) => Promise<void>;
  onToggleFeatured: (item: CatalogItem, nextFeatured: boolean) => Promise<void>;
  onEditTranslations: (item: CatalogItem) => void;
  onDelete: (itemId: string) => Promise<void>;
}

export function QuickItemRow({
  item,
  onToggleAvailable,
  onUpdatePrice,
  onToggleFeatured,
  onEditTranslations,
  onDelete,
}: QuickItemRowProps) {
  const [priceInput, setPriceInput] = useState(String(item.price));
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);

  useEffect(() => {
    setPriceInput(String(item.price));
  }, [item.price]);

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

  const translatedLangs = ALL_LOCALES.filter(
    (loc) => item.name_i18n?.[loc] && item.name_i18n[loc]!.trim().length > 0
  );

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
          {item.image_url ? (
            <img
              src={item.image_url}
              alt={item.name_i18n.vi}
              className="h-14 w-14 shrink-0 rounded-xl object-cover border border-slate-200 bg-slate-100"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-400">
              {item.name_i18n.vi?.slice(0, 1) || 'M'}
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {item.name_i18n.vi}
              </h4>
              {!item.is_available && (
                <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                  Tạm hết
                </span>
              )}
              {item.is_featured && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  ★ Bán chạy
                </span>
              )}
            </div>

            {item.name_i18n.en && (
              <p className="truncate text-xs text-slate-500">
                🇬🇧 {item.name_i18n.en}
              </p>
            )}

            {/* Translation status flags & duration */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <div className="flex items-center gap-1">
                {ALL_LOCALES.map((loc) => {
                  const hasTrans = translatedLangs.includes(loc);
                  return (
                    <span
                      key={loc}
                      title={`${LOCALE_META[loc].label}: ${
                        hasTrans ? item.name_i18n[loc] : 'Chưa dịch'
                      }`}
                      className={`text-xs transition-opacity ${
                        hasTrans ? 'opacity-100' : 'opacity-25 grayscale'
                      }`}
                    >
                      {LOCALE_META[loc].flag}
                    </span>
                  );
                })}
              </div>

              {item.duration_mins && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <Clock className="h-3 w-3" />
                  {item.duration_mins}p
                </span>
              )}

              <span className="text-[11px] text-slate-400">
                👁 {item.view_count || 0} lượt xem
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
            {item.is_available ? 'Còn hàng' : 'Tạm hết'}
          </span>
        </div>
      </div>

      {/* Bottom Row: Direct Price Edit & Action Buttons */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 flex-wrap">
        {/* Direct inline price input */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500">Giá:</span>
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
              className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 pr-7 text-xs font-extrabold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
            <span className="pointer-events-none absolute right-2.5 text-xs font-bold text-slate-400">
              đ
            </span>
          </div>
          {savingPrice && (
            <span className="text-[11px] font-medium text-slate-400">
              Đang lưu...
            </span>
          )}
          {priceSaved && (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Đã lưu
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleFeatured(item, !item.is_featured)}
            className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              item.is_featured
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
            title="Đánh dấu món Best Seller / Nổi bật"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Nổi bật</span>
          </button>

          <button
            type="button"
            onClick={() => onEditTranslations(item)}
            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>Sửa & Dịch 5 thứ tiếng</span>
          </button>

          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            title="Xóa món"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
