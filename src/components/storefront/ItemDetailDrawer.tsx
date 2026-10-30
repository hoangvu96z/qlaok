'use client';

import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Plus, Minus, Clock, Sparkles, Check } from 'lucide-react';
import {
  BusinessVertical,
  CartSelection,
  CatalogItem,
  ItemOptionChoice,
  SupportedLocale,
} from '@/types/qlaok';
import {
  formatCurrency,
  QUICK_TAGS_BY_VERTICAL,
  tField,
  UI_LABELS,
} from '@/lib/i18n-helper';
import {
  getAccessibleAccentTextColor,
  getContrastTextColor,
} from '@/lib/theme-contrast';
import { StorefrontProductImage } from '@/components/storefront/StorefrontProductImage';

interface ItemDetailDrawerProps {
  item: CatalogItem | null;
  vertical: BusinessVertical;
  locale: SupportedLocale;
  currency?: string;
  primaryColor?: string;
  onClose: () => void;
  onAddToCart: (selection: CartSelection) => void;
}

export function ItemDetailDrawer({
  item,
  vertical,
  locale,
  currency = 'VND',
  primaryColor = '#10b981',
  onClose,
  onAddToCart,
}: ItemDetailDrawerProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedChoices, setSelectedChoices] = useState<ItemOptionChoice[]>([]);
  const [selectedQuickTagIds, setSelectedQuickTagIds] = useState<string[]>([]);
  const [customNote, setCustomNote] = useState('');

  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const quickTags = QUICK_TAGS_BY_VERTICAL[vertical] || [];
  const accentTextColor = getAccessibleAccentTextColor(primaryColor);
  const accentOnPrimaryColor = getContrastTextColor(primaryColor);

  useEffect(() => {
    if (item) {
      setQuantity(1);
      setCustomNote('');
      setSelectedQuickTagIds([]);
      // Pre-select first choice of required option groups
      const defaults: ItemOptionChoice[] = [];
      for (const group of item.options_json || []) {
        if (group.required && group.choices?.length > 0) {
          defaults.push(group.choices[0]);
        }
      }
      setSelectedChoices(defaults);
    }
  }, [item]);

  if (!item) return null;

  const toggleChoice = (groupId: string, choice: ItemOptionChoice, required: boolean) => {
    const group = item.options_json?.find((g) => g.id === groupId);
    if (!group) return;

    const groupChoiceIds = new Set(group.choices.map((c) => c.id));
    const isAlreadySelected = selectedChoices.some((c) => c.id === choice.id);

    if (required) {
      // Single-select replacement within group
      const filtered = selectedChoices.filter((c) => !groupChoiceIds.has(c.id));
      setSelectedChoices([...filtered, choice]);
    } else {
      if (isAlreadySelected) {
        setSelectedChoices(selectedChoices.filter((c) => c.id !== choice.id));
      } else {
        setSelectedChoices([...selectedChoices, choice]);
      }
    }
  };

  const toggleQuickTag = (tagId: string) => {
    setSelectedQuickTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const extraOptionsPrice = selectedChoices.reduce(
    (sum, c) => sum + (c.extra_price || 0),
    0
  );
  const unitPrice = item.price + extraOptionsPrice;
  const totalPrice = unitPrice * quantity;

  const handleConfirm = () => {
    // Convert selected quick tags into Vietnamese + Visitor language notes for staff clarity
    const resolvedQuickTags = selectedQuickTagIds
      .map((id) => {
        const found = quickTags.find((t) => t.id === id);
        if (!found) return null;
        return found.i18n.vi;
      })
      .filter(Boolean) as string[];

    onAddToCart({
      item,
      quantity,
      selectedChoices,
      customNote: customNote.trim(),
      quickTags: resolvedQuickTags,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {item && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl flex flex-col"
          >
            {/* Header / Image */}
            {item.image_url ? (
              <div className="relative h-52 w-full shrink-0 bg-slate-100">
                <StorefrontProductImage
                  src={item.image_url}
                  alt={tField(item.name_i18n, locale)}
                  vertical={vertical}
                  className="h-full w-full object-cover"
                  emojiClassName="flex h-full w-full items-center justify-center text-5xl bg-slate-100"
                />
                <button
                  type="button"
                  aria-label={labels.closeItemDetailAria}
                  onClick={onClose}
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-xs hover:bg-black/70"
                >
                  <X className="h-5 w-5" />
                </button>
                {item.is_featured && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white shadow-xs">
                    <Sparkles className="h-3.5 w-3.5" />
                    {labels.bestSeller}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between border-b border-slate-100 px-5 pt-4 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Qlaok Smart Menu
                </span>
                <button
                  type="button"
                  aria-label={labels.closeItemDetailAria}
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="p-5 space-y-5 overflow-y-auto">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-bold text-slate-900 leading-snug">
                    {tField(item.name_i18n, locale)}
                  </h3>
                  <div className="text-right shrink-0">
                    <div
                      className="text-lg font-extrabold"
                      style={{ color: accentTextColor }}
                    >
                      {formatCurrency(item.price, currency)}
                    </div>
                    {item.compare_at_price && item.compare_at_price > item.price && (
                      <div className="text-xs text-slate-400 line-through">
                        {formatCurrency(item.compare_at_price, currency)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Always show Vietnamese original name underneath for foreign tourists */}
                {locale !== 'vi' && item.name_i18n.vi && (
                  <p className="mt-0.5 text-xs font-medium text-slate-400">
                    🇻🇳 {item.name_i18n.vi}
                  </p>
                )}

                {item.duration_mins && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                    <span>
                      {item.duration_mins} {labels.durationMins}
                    </span>
                  </div>
                )}

                {tField(item.desc_i18n, locale) && (
                  <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
                    {tField(item.desc_i18n, locale)}
                  </p>
                )}
              </div>

              {/* Option Groups (e.g. Sugar level, Ice level, Size, Toppings) */}
              {item.options_json && item.options_json.length > 0 && (
                <div className="space-y-4">
                  {item.options_json.map((group) => {
                    const groupDesc = group.desc_i18n
                      ? tField(group.desc_i18n, locale)
                      : '';
                    return (
                      <fieldset
                        key={group.id}
                        aria-describedby={
                          groupDesc
                            ? `storefront-option-description-${item.id}-${group.id}`
                            : undefined
                        }
                        className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3.5 space-y-2.5"
                      >
                        <legend className="w-full">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                              {tField(group.name_i18n, locale)}
                            </span>
                            {group.required ? (
                              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                {labels.requiredBadge}
                              </span>
                            ) : (
                              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                {labels.optionalBadge}
                              </span>
                            )}
                          </span>
                        </legend>
                        {groupDesc && (
                          <p
                            id={`storefront-option-description-${item.id}-${group.id}`}
                            className="text-[11px] text-slate-500"
                          >
                            {groupDesc}
                          </p>
                        )}

                        <div className="grid grid-cols-1 gap-2">
                          {group.choices.map((choice) => {
                            const isSelected = selectedChoices.some(
                              (c) => c.id === choice.id
                            );
                            const choiceDesc = choice.desc_i18n
                              ? tField(choice.desc_i18n, locale)
                              : '';
                            const inputId = `storefront-option-${item.id}-${group.id}-${choice.id}`;
                            return (
                              <div key={choice.id}>
                                <input
                                  id={inputId}
                                  type={group.required ? 'radio' : 'checkbox'}
                                  name={
                                    group.required
                                      ? `storefront-option-${item.id}-${group.id}`
                                      : undefined
                                  }
                                  checked={isSelected}
                                  required={group.required}
                                  onChange={() =>
                                    toggleChoice(group.id, choice, group.required)
                                  }
                                  className="peer sr-only"
                                />
                                <label
                                  htmlFor={inputId}
                                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-600 peer-focus-visible:ring-offset-2 ${
                                    isSelected
                                      ? 'border-emerald-600 bg-emerald-50 text-slate-900 font-semibold shadow-2xs'
                                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <span className="flex items-start gap-2.5 min-w-0">
                                    <span
                                      aria-hidden="true"
                                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${
                                        group.required
                                          ? 'rounded-full'
                                          : 'rounded-md'
                                      } border ${
                                        isSelected
                                          ? 'border-emerald-600 bg-emerald-600 text-white'
                                          : 'border-slate-300 bg-white'
                                      }`}
                                    >
                                      {isSelected && (
                                        <Check className="h-2.5 w-2.5" />
                                      )}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-xs font-bold text-slate-900">
                                        {tField(choice.label_i18n, locale)}
                                      </span>
                                      {locale !== 'vi' && choice.label_i18n.vi && (
                                        <span className="block text-[10px] text-slate-400">
                                          🇻🇳 {choice.label_i18n.vi}
                                        </span>
                                      )}
                                      {choiceDesc && (
                                        <span className="mt-0.5 block text-[11px] font-normal text-slate-500 leading-snug">
                                          {choiceDesc}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                  {choice.extra_price > 0 ? (
                                    <span className="shrink-0 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-900">
                                      +{formatCurrency(choice.extra_price, currency)}
                                    </span>
                                  ) : (
                                    <span className="shrink-0 text-[10px] font-semibold text-slate-400">
                                      +0đ
                                    </span>
                                  )}
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              )}

              {/* Quick Tags by Vertical */}
              {quickTags.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    {labels.quickTagsTitle}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {quickTags.map((tag) => {
                      const active = selectedQuickTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleQuickTag(tag.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {tField(tag.i18n, locale)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Note */}
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder={labels.customNotePlaceholder}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
                />
              </div>

              {/* Quantity & Add to Selection CTA */}
              <div className="flex items-center gap-3 pt-2">
                <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    aria-label={labels.decreaseQtyAria(
                      tField(item.name_i18n, locale)
                    )}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 hover:bg-white active:scale-95"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center text-base font-bold text-slate-900">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={labels.increaseQtyAria(
                      tField(item.name_i18n, locale)
                    )}
                    onClick={() => setQuantity((q) => q + 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-700 hover:bg-white active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!item.is_available}
                  className="flex-1 flex items-center justify-between rounded-2xl px-5 py-3.5 text-sm font-bold shadow-md transition-transform active:scale-98 disabled:opacity-50"
                  style={{
                    backgroundColor: item.is_available ? primaryColor : '#94a3b8',
                    color: item.is_available ? accentOnPrimaryColor : '#ffffff',
                  }}
                >
                  <span>{labels.addToOrder}</span>
                  <span>{formatCurrency(totalPrice, currency)}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
