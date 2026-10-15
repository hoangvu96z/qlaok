'use client';

import React from 'react';
import { Plus, Clock, Sparkles, ShoppingBag } from 'lucide-react';
import {
  BusinessVertical,
  CatalogItem,
  Category,
  SupportedLocale,
} from '@/types/qlaok';
import { formatCurrency, tField, UI_LABELS } from '@/lib/i18n-helper';

interface VerticalRendererProps {
  vertical: BusinessVertical;
  categories: Category[];
  items: CatalogItem[];
  locale: SupportedLocale;
  currency?: string;
  primaryColor?: string;
  layoutMode?: 'list' | 'grid';
  isDarkTheme?: boolean;
  selectedCategoryId: string | 'all';
  searchQuery: string;
  onSelectItem: (item: CatalogItem) => void;
  onQuickAdd: (item: CatalogItem, e: React.MouseEvent) => void;
}

export function VerticalRenderer({
  vertical,
  categories,
  items,
  locale,
  currency = 'VND',
  primaryColor = '#10b981',
  layoutMode,
  isDarkTheme = false,
  selectedCategoryId,
  searchQuery,
  onSelectItem,
  onQuickAdd,
}: VerticalRendererProps) {
  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const q = searchQuery.trim().toLowerCase();
  const useGridLayout = layoutMode === 'grid' || (layoutMode !== 'list' && vertical === 'retail');

  const visibleCategories =
    selectedCategoryId === 'all'
      ? categories
      : categories.filter((c) => c.id === selectedCategoryId);

  const filterItemsByQuery = (catItems: CatalogItem[]) => {
    if (!q) return catItems;
    return catItems.filter((item) => {
      const nameTarget = tField(item.name_i18n, locale).toLowerCase();
      const nameVi = (item.name_i18n.vi || '').toLowerCase();
      const descTarget = tField(item.desc_i18n, locale).toLowerCase();
      return (
        nameTarget.includes(q) || nameVi.includes(q) || descTarget.includes(q)
      );
    });
  };

  return (
    <div className="space-y-6 pb-28">
      {visibleCategories.map((category) => {
        const catItems = filterItemsByQuery(
          items.filter((i) => i.category_id === category.id)
        );

        if (catItems.length === 0) return null;

        return (
          <section key={category.id} id={`cat-${category.id}`} className="space-y-3">
            <div className={`flex items-center justify-between border-b pb-1.5 ${isDarkTheme ? 'border-slate-700/80' : 'border-slate-200/80'}`}>
              <h2 className={`text-base font-extrabold tracking-tight ${isDarkTheme ? 'text-white drop-shadow-xs' : 'text-slate-900'}`}>
                {tField(category.name_i18n, locale)}
              </h2>
              <span className={`text-xs font-medium ${isDarkTheme ? 'text-slate-300' : 'text-slate-400'}`}>
                {catItems.length}
              </span>
            </div>

            {/* 1. F&B List Layout: Horizontal row cards with 80x80 rounded square image on right & '+' button */}
            {!useGridLayout && vertical === 'fnb' && (
              <div className="space-y-2.5">
                {catItems.map((item) => {
                  const unavailable = !item.is_available;
                  return (
                    <div
                      key={item.id}
                      onClick={() => !unavailable && onSelectItem(item)}
                      className={`group relative flex items-center justify-between gap-3.5 rounded-2xl border bg-white p-3.5 shadow-xs transition-all ${
                        unavailable
                          ? 'border-slate-200 opacity-55 cursor-not-allowed'
                          : 'border-slate-200/90 hover:border-slate-300 hover:shadow-md cursor-pointer active:scale-[0.99]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.is_featured && (
                            <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                              <Sparkles className="h-2.5 w-2.5" />
                              {labels.bestSeller}
                            </span>
                          )}
                          {unavailable && (
                            <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                              {labels.soldOut}
                            </span>
                          )}
                          {!unavailable &&
                            item.stock_quantity !== null &&
                            item.stock_quantity !== undefined && (
                              <span
                                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                  item.stock_quantity <= 5
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {item.stock_quantity <= 5 ? '🔥 ' : ''}
                                {`${labels.stockLeftPrefix}${item.stock_quantity}${labels.stockLeftSuffix}`}
                              </span>
                            )}
                        </div>

                        <h3 className="text-sm font-bold text-slate-900 leading-snug">
                          {tField(item.name_i18n, locale)}
                        </h3>

                        {locale !== 'vi' && item.name_i18n.vi && (
                          <p className="text-[11px] font-medium text-slate-400">
                            {item.name_i18n.vi}
                          </p>
                        )}

                        {tField(item.desc_i18n, locale) && (
                          <p className="line-clamp-2 text-xs text-slate-500 leading-relaxed">
                            {tField(item.desc_i18n, locale)}
                          </p>
                        )}

                        <div className="pt-1 flex items-baseline gap-2">
                          <span
                            className="text-sm font-extrabold"
                            style={{ color: primaryColor }}
                          >
                            {formatCurrency(item.price, currency)}
                          </span>
                          {item.compare_at_price &&
                            item.compare_at_price > item.price && (
                              <span className="text-xs text-slate-400 line-through">
                                {formatCurrency(item.compare_at_price, currency)}
                              </span>
                            )}
                        </div>
                      </div>

                      <div className="relative h-20 w-20 shrink-0">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={tField(item.name_i18n, locale)}
                            className="h-20 w-20 rounded-xl object-cover bg-slate-100 border border-slate-100"
                          />
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-xl">
                            🍜
                          </div>
                        )}
                        {!unavailable && (
                          <button
                            type="button"
                            onClick={(e) => onQuickAdd(item, e)}
                            style={{ backgroundColor: primaryColor }}
                            className="absolute -bottom-1.5 -right-1.5 flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white transition-transform active:scale-90"
                            aria-label="Add item"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. Service Layout (Spa, Nail, Massage, Salon): Elegant Price List with Duration & Dotted Leaders */}
            {!useGridLayout && vertical === 'service' && (
              <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 shadow-xs overflow-hidden">
                {catItems.map((item) => {
                  const unavailable = !item.is_available;
                  return (
                    <div
                      key={item.id}
                      onClick={() => !unavailable && onSelectItem(item)}
                      className={`p-4 transition-colors ${
                        unavailable
                          ? 'opacity-50 cursor-not-allowed bg-slate-50'
                          : 'hover:bg-slate-50/80 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900">
                            {tField(item.name_i18n, locale)}
                          </h3>
                          {item.is_featured && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                              ★ {labels.bestSeller}
                            </span>
                          )}
                          {unavailable && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                              {labels.soldOut}
                            </span>
                          )}
                          {!unavailable &&
                            item.stock_quantity !== null &&
                            item.stock_quantity !== undefined && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  item.stock_quantity <= 5
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {`${labels.stockLeftPrefix}${item.stock_quantity}${labels.stockLeftSuffix}`}
                              </span>
                            )}
                        </div>

                        {/* Dotted leader line */}
                        <div className="flex-1 border-b border-dotted border-slate-300 mx-1 min-w-[20px]" />

                        <div className="text-right shrink-0 flex items-center gap-2">
                          <span
                            className="text-sm font-extrabold"
                            style={{ color: primaryColor }}
                          >
                            {formatCurrency(item.price, currency)}
                          </span>
                          {!unavailable && (
                            <button
                              type="button"
                              onClick={(e) => onQuickAdd(item, e)}
                              style={{ backgroundColor: primaryColor }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-xs active:scale-90"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        {item.duration_mins && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            <Clock className="h-3 w-3 text-slate-500" />⏱{' '}
                            {item.duration_mins} {labels.durationMins}
                          </span>
                        )}
                        {locale !== 'vi' && item.name_i18n.vi && (
                          <span className="text-[11px] text-slate-400">
                            🇻🇳 {item.name_i18n.vi}
                          </span>
                        )}
                      </div>

                      {tField(item.desc_i18n, locale) && (
                        <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                          {tField(item.desc_i18n, locale)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3. Grid Layout (Retail default or when owner chooses Grid Layout): 2-Column Grid with 1:1 square image */}
            {useGridLayout && (
              <div className="grid grid-cols-2 gap-3">
                {catItems.map((item) => {
                  const unavailable = !item.is_available;
                  return (
                    <div
                      key={item.id}
                      onClick={() => !unavailable && onSelectItem(item)}
                      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-xs transition-all ${
                        unavailable
                          ? 'border-slate-200 opacity-55 cursor-not-allowed'
                          : 'border-slate-200 hover:shadow-md cursor-pointer active:scale-[0.99]'
                      }`}
                    >
                      <div className="relative aspect-square w-full bg-slate-100 overflow-hidden">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={tField(item.name_i18n, locale)}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl">
                            {vertical === 'fnb' ? '🍜' : vertical === 'service' ? '💆‍♀️' : '🛍️'}
                          </div>
                        )}
                        {item.is_featured && (
                          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                            {labels.bestSeller}
                          </span>
                        )}
                        {!unavailable &&
                          item.stock_quantity !== null &&
                          item.stock_quantity !== undefined && (
                            <span
                              className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-xs ${
                                item.stock_quantity <= 5
                                  ? 'bg-orange-600'
                                  : 'bg-slate-900/75'
                              }`}
                            >
                              {`${labels.stockLeftPrefix}${item.stock_quantity}${labels.stockLeftSuffix}`}
                            </span>
                          )}
                        {unavailable && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                            <span className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white">
                              {labels.soldOut}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-3 space-y-2">
                        <div>
                          <h3 className="line-clamp-2 text-xs font-bold text-slate-900 leading-snug">
                            {tField(item.name_i18n, locale)}
                          </h3>
                          {locale !== 'vi' && item.name_i18n.vi && (
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">
                              🇻🇳 {item.name_i18n.vi}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <div>
                            <div
                              className="text-sm font-extrabold"
                              style={{ color: primaryColor }}
                            >
                              {formatCurrency(item.price, currency)}
                            </div>
                            {item.compare_at_price &&
                              item.compare_at_price > item.price && (
                                <div className="text-[10px] text-slate-400 line-through">
                                  {formatCurrency(item.compare_at_price, currency)}
                                </div>
                              )}
                          </div>

                          {!unavailable && (
                            <button
                              type="button"
                              onClick={(e) => onQuickAdd(item, e)}
                              style={{ backgroundColor: primaryColor }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-white shadow-xs active:scale-90"
                              aria-label="Add product"
                            >
                              <ShoppingBag className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
