'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  Plus,
  Minus,
  Trash2,
  MessageCircle,
  Volume2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { CartSelection, Shop, SupportedLocale } from '@/types/qlaok';
import { formatCurrency, LOCALE_META, tField, UI_LABELS } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';

interface ShowToStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop;
  locale: SupportedLocale;
  cart: CartSelection[];
  onUpdateQuantity: (index: number, delta: number) => void;
  onClearCart: () => void;
}

export function ShowToStaffModal({
  isOpen,
  onClose,
  shop,
  locale,
  cart,
  onUpdateQuantity,
  onClearCart,
}: ShowToStaffModalProps) {
  const [tableNumber, setTableNumber] = useState('');
  const [copiedZalo, setCopiedZalo] = useState(false);
  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const visitorMeta = LOCALE_META[locale] || LOCALE_META.vi;

  useEffect(() => {
    if (isOpen && cart.length > 0) {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shop.id,
          event_type: 'show_to_staff',
          visitor_lang: locale,
        }),
      }).catch(() => {});
    }
  }, [isOpen, cart.length, shop.id, locale]);

  const grandTotal = cart.reduce((sum, entry) => {
    const extra = entry.selectedChoices.reduce(
      (s, c) => s + (c.extra_price || 0),
      0
    );
    return sum + (entry.item.price + extra) * entry.quantity;
  }, 0);

  const buildVietnameseOrderSummary = () => {
    const lines = [
      `📋 ĐƠN ĐẶT TẠI: ${shop.name.toUpperCase()}`,
      tableNumber ? `📍 Bàn / Vị trí: ${tableNumber}` : null,
      `🌐 Ngôn ngữ khách: ${visitorMeta.flag} ${visitorMeta.label}`,
      `------------------------`,
      ...cart.map((entry, idx) => {
        const extra = entry.selectedChoices.reduce(
          (s, c) => s + (c.extra_price || 0),
          0
        );
        const linePrice = (entry.item.price + extra) * entry.quantity;
        const choicesVi = entry.selectedChoices
          .map((c) => c.label_i18n.vi)
          .join(', ');
        const tagsVi = (entry.quickTags || []).join(', ');
        const notes = [choicesVi, tagsVi, entry.customNote]
          .filter(Boolean)
          .join(' | ');
        return `${idx + 1}. [${entry.quantity}x] ${entry.item.name_i18n.vi} - ${formatCurrency(linePrice, shop.currency)}${
          notes ? `\n   👉 Ghi chú: ${notes}` : ''
        }`;
      }),
      `------------------------`,
      `💰 TỔNG TẠM TÍNH: ${formatCurrency(grandTotal, shop.currency)}`,
    ].filter(Boolean);

    return lines.join('\n');
  };

  const handleSendZalo = async () => {
    const summaryText = buildVietnameseOrderSummary();
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedZalo(true);
      setTimeout(() => setCopiedZalo(false), 3000);
    } catch {
      // ignore clipboard error
    }
    const phone = shop.zalo_phone || shop.phone_contact;
    if (phone) {
      window.open(`https://zalo.me/${phone.replace(/\D/g, '')}`, '_blank');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-y-auto"
        >
          {/* High-Contrast Top Banner for Staff */}
          <div className="bg-amber-400 text-slate-950 px-4 py-3.5 shadow-md">
            <div className="mx-auto max-w-md flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-amber-400 font-black text-lg">
                  <FlagIcon locale="vi" className="h-5 w-7" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-black uppercase tracking-tight leading-tight">
                    {labels.showToStaffHeader}
                  </h2>
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1 flex-wrap">
                    <span>Xin chào nhân viên! Khách (</span>
                    <FlagIcon locale={locale} className="h-3.5 w-5" />
                    <span>{visitorMeta.label}) muốn đặt các mục dưới đây:</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950/15 text-slate-950 hover:bg-slate-950/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Main Vietnamese High-Contrast Card List */}
          <div className="mx-auto w-full max-w-md flex-1 px-4 py-5 space-y-4">
            {/* Optional Table / Seat Input */}
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900 border border-slate-800 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-400">
                Số bàn / Ghế (Table No.):
              </span>
              <input
                type="text"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="VD: Bàn 05"
                className="w-28 rounded-lg bg-slate-800 px-3 py-1 text-right text-sm font-bold text-amber-400 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>

            {cart.length === 0 ? (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-10 text-center space-y-3">
                <p className="text-base font-semibold text-slate-300">
                  Chưa có món / dịch vụ nào được chọn
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950"
                >
                  Quay lại chọn món
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((entry, index) => {
                  const extra = entry.selectedChoices.reduce(
                    (s, c) => s + (c.extra_price || 0),
                    0
                  );
                  const lineTotal = (entry.item.price + extra) * entry.quantity;

                  return (
                    <div
                      key={`${entry.item.id}-${index}`}
                      className="rounded-2xl border-2 border-slate-800 bg-slate-900 p-4 shadow-lg"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {/* Huge Quantity Badge for Staff */}
                          <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black">
                            <span className="text-[10px] uppercase leading-none font-bold">
                              SL
                            </span>
                            <span className="text-xl leading-tight">
                              x{entry.quantity}
                            </span>
                          </div>

                          <div className="space-y-1">
                            {/* Large Vietnamese Name for Staff */}
                            <h3 className="text-lg sm:text-xl font-black text-white leading-snug">
                              {entry.item.name_i18n.vi}
                            </h3>

                            {/* Visitor's own language subtitle for reassurance */}
                            {locale !== 'vi' && (
                              <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                                <FlagIcon locale={locale} className="h-3.5 w-5" />
                                <span>{tField(entry.item.name_i18n, locale)}</span>
                              </p>
                            )}

                            {/* Selected options in Vietnamese */}
                            {entry.selectedChoices.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {entry.selectedChoices.map((c) => (
                                  <span
                                    key={c.id}
                                    className="rounded-lg bg-amber-400/20 border border-amber-400/40 px-2.5 py-0.5 text-xs font-bold text-amber-300"
                                  >
                                    • {c.label_i18n.vi}
                                    {locale !== 'vi' &&
                                      c.label_i18n[locale] &&
                                      ` (${c.label_i18n[locale]})`}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Quick Tags in Vietnamese */}
                            {entry.quickTags && entry.quickTags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {entry.quickTags.map((tagVi, idx) => (
                                  <span
                                    key={idx}
                                    className="rounded-lg bg-rose-500/20 border border-rose-400/40 px-2.5 py-0.5 text-xs font-bold text-rose-300"
                                  >
                                    ⚠️ {tagVi}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Custom Note */}
                            {entry.customNote && (
                              <p className="mt-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-amber-200">
                                📝 Ghi chú khách: &ldquo;{entry.customNote}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-base font-black text-emerald-400">
                            {formatCurrency(lineTotal, shop.currency)}
                          </div>
                          {entry.item.duration_mins && (
                            <div className="text-[11px] text-slate-400">
                              ⏱ {entry.item.duration_mins} phút
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quantity adjusters inside modal */}
                      <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                        <span className="text-[11px] text-slate-400">
                          Đơn giá: {formatCurrency(entry.item.price + extra, shop.currency)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(index, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-5 text-center text-xs font-bold">
                            {entry.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(index, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sticky Footer Summary */}
          {cart.length > 0 && (
            <div className="sticky bottom-0 border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-md">
              <div className="mx-auto max-w-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-400">
                      {labels.totalEstimated} (Tổng cộng tạm tính)
                    </p>
                    <p className="text-2xl font-black text-amber-400">
                      {formatCurrency(grandTotal, shop.currency)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClearCart();
                      onClose();
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    <span>{labels.clearSelection}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(shop.zalo_phone || shop.phone_contact) && (
                    <button
                      type="button"
                      onClick={handleSendZalo}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-blue-500 active:scale-98"
                    >
                      {copiedZalo ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Đã copy đơn & Mở Zalo!</span>
                        </>
                      ) : (
                        <>
                          <MessageCircle className="h-4 w-4" />
                          <span>{labels.sendZaloOrder}</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg hover:bg-emerald-400 active:scale-98"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>OK / Quay lại Menu</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
