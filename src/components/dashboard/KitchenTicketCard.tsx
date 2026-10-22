'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Clock,
  Loader2,
  ShoppingBag,
} from 'lucide-react';
import type { AppLocale } from '@/lib/app-i18n';
import {
  DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES,
  formatKitchenLineOptionLabel,
  formatKitchenOrderAge,
  getKitchenOrderAgeMinutes,
  getNextKitchenOrderStatus,
  isKitchenOrderOverdue,
} from '@/lib/kitchen-display';
import { isTakeawayTableLabel } from '@/lib/table-helpers';
import type { ShopOrder } from '@/types/qlaok';

export interface KitchenTicketCardProps {
  order: ShopOrder;
  locale: AppLocale;
  nowMs: number;
  canFulfill: boolean;
  isUpdating?: boolean;
  overdueThresholdMinutes?: number;
  onAdvanceStatus?: (
    order: ShopOrder,
    nextStatus: 'preparing' | 'completed'
  ) => void;
}

export function KitchenTicketCard({
  order,
  locale,
  nowMs,
  canFulfill,
  isUpdating = false,
  overdueThresholdMinutes = DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES,
  onAdvanceStatus,
}: KitchenTicketCardProps) {
  const isEn = locale === 'en';
  const isNew = order.status === 'new';
  const isPreparing = order.status === 'preparing';
  const isOverdue = isKitchenOrderOverdue(
    order.created_at,
    nowMs,
    overdueThresholdMinutes
  );
  const ageText = formatKitchenOrderAge(order.created_at, locale, nowMs);
  const ageMinutes = getKitchenOrderAgeMinutes(order.created_at, nowMs);
  const isTakeaway = isTakeawayTableLabel(order.table_label);
  const displayTableLabel =
    isTakeaway && isEn && /^mang\s*(về|đi)$/i.test((order.table_label || '').trim())
      ? 'Takeaway'
      : order.table_label;
  const displayOrderCode = (order.order_code || '').trim().startsWith('#')
    ? (order.order_code || '').trim()
    : `#${(order.order_code || '').trim()}`;
  const nextStatus = getNextKitchenOrderStatus(order.status);

  const createdDate = new Date(order.created_at);
  const createdTimeText = Number.isNaN(createdDate.getTime())
    ? ''
    : createdDate.toLocaleTimeString(isEn ? 'en-US' : 'vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      });

  const totalItemQuantity = (order.items || []).reduce(
    (sum, line) => sum + Math.max(0, Number(line.quantity || 0)),
    0
  );

  return (
    <article
      data-testid={`kds-ticket-${order.id}`}
      data-order-code={order.order_code}
      data-order-status={order.status}
      data-overdue={isOverdue ? 'true' : 'false'}
      className={`rounded-3xl bg-white dark:bg-slate-900 border-2 p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-4 transition-all ${
        isOverdue
          ? 'border-rose-500 ring-4 ring-rose-500/15 dark:border-rose-500'
          : isNew
            ? 'border-amber-400 ring-4 ring-amber-400/15 dark:border-amber-400'
            : 'border-blue-500 dark:border-blue-400'
      }`}
    >
      <div className="space-y-3.5">
        {/* Ticket Header: Table/Takeaway, Order Code, Status & Elapsed Age */}
        <div className="flex items-start justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                data-testid={`kds-ticket-table-${order.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1 text-xs sm:text-sm font-black text-amber-300 dark:bg-slate-100 dark:text-slate-950"
              >
                {isTakeaway && (
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{displayTableLabel}</span>
              </span>

              <span
                data-testid={`kds-ticket-code-${order.id}`}
                className="text-sm sm:text-base font-black text-slate-900 dark:text-white"
              >
                {displayOrderCode}
              </span>

              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase border ${
                  isNew
                    ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40'
                    : 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/40'
                }`}
              >
                {isNew
                  ? isEn
                    ? 'New'
                    : 'Chờ làm'
                  : isEn
                    ? 'Preparing'
                    : 'Đang làm'}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 flex-wrap">
              {createdTimeText && <span>{createdTimeText}</span>}
              {createdTimeText && <span aria-hidden="true">•</span>}
              <span>
                {order.source === 'counter_pos'
                  ? isEn
                    ? 'Counter POS'
                    : 'Tại quầy'
                  : isEn
                    ? 'Table QR'
                    : 'QR bàn'}
              </span>
              <span aria-hidden="true">•</span>
              <span>
                {isEn
                  ? `${totalItemQuantity} item(s)`
                  : `${totalItemQuantity} phần`}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              data-testid={`kds-ticket-age-${order.id}`}
              title={
                isEn
                  ? `Elapsed time: ${ageMinutes} minute(s)`
                  : `Thời gian chờ: ${ageMinutes} phút`
              }
              className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-black ${
                isOverdue
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-slate-100 border border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
              }`}
            >
              {isOverdue ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>
                {isOverdue
                  ? isEn
                    ? `Overdue • ${ageText}`
                    : `Quá hạn • ${ageText}`
                  : ageText}
              </span>
            </span>

            {isOverdue && (
              <span
                data-testid={`kds-ticket-overdue-badge-${order.id}`}
                className="text-[11px] font-black text-rose-700 dark:text-rose-400"
              >
                {isEn
                  ? `≥ ${overdueThresholdMinutes}m threshold`
                  : `Từ ${overdueThresholdMinutes} phút (≥ ${overdueThresholdMinutes}p)`}
              </span>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="space-y-2.5">
          {(order.items || []).map((line, idx) => {
            const itemName = isEn
              ? line.name_i18n?.en || line.name_vi
              : line.name_vi;
            const optionLabels = (line.selected_choices || [])
              .map((choice) => formatKitchenLineOptionLabel(choice, locale))
              .filter((label) => label.length > 0);
            const quickTags = (line.quick_tags || []).filter(
              (tag) => typeof tag === 'string' && tag.trim().length > 0
            );
            const customNote =
              typeof line.custom_note === 'string'
                ? line.custom_note.trim()
                : '';

            return (
              <div
                key={`${line.item_id || idx}-${idx}`}
                data-testid={`kds-ticket-item-${order.id}-${idx}`}
                className="rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 p-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    data-testid={`kds-item-qty-${order.id}-${idx}`}
                    className="flex h-8 min-w-[34px] shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-2 text-xs sm:text-sm font-black text-white"
                  >
                    x{line.quantity}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                      {itemName}
                    </p>

                    {optionLabels.length > 0 && (
                      <div
                        data-testid={`kds-item-options-${order.id}-${idx}`}
                        className="flex flex-wrap gap-1.5"
                      >
                        {optionLabels.map((label, optIdx) => (
                          <span
                            key={optIdx}
                            className="rounded-lg bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-extrabold text-amber-950 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-200"
                          >
                            • {label}
                          </span>
                        ))}
                      </div>
                    )}

                    {quickTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {quickTags.map((tag, tagIdx) => (
                          <span
                            key={tagIdx}
                            className="rounded-lg bg-rose-100 border border-rose-300 px-2 py-0.5 text-xs font-extrabold text-rose-900 dark:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-200"
                          >
                            ⚠️ {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {customNote && (
                      <p
                        data-testid={`kds-item-note-${order.id}-${idx}`}
                        className="rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-extrabold text-amber-950 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200"
                      >
                        📝 &ldquo;{customNote}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Customer / Order Note */}
        {order.customer_note && order.customer_note.trim().length > 0 && (
          <div
            data-testid={`kds-order-note-${order.id}`}
            className="rounded-2xl bg-amber-100/90 border-2 border-amber-300 px-3.5 py-2.5 text-xs sm:text-sm font-extrabold text-amber-950 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-100"
          >
            💬 {isEn ? 'Order note:' : 'Ghi chú đơn:'} &ldquo;
            {order.customer_note.trim()}&rdquo;
          </div>
        )}
      </div>

      {/* Touch Action Footer: Only shown/enabled for memberships with orders.fulfill */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
        {canFulfill && nextStatus ? (
          isNew ? (
            <button
              type="button"
              data-testid={`kds-action-start-${order.id}`}
              disabled={isUpdating}
              aria-busy={isUpdating || undefined}
              onClick={() => onAdvanceStatus?.(order, 'preparing')}
              className="min-h-[48px] w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-xs hover:bg-blue-500 active:scale-[0.99] transition disabled:opacity-50"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ChefHat className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isEn ? 'Start cooking' : 'Bắt đầu làm'}</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid={`kds-action-complete-${order.id}`}
              disabled={isUpdating}
              aria-busy={isUpdating || undefined}
              onClick={() => onAdvanceStatus?.(order, 'completed')}
              className="min-h-[48px] w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-xs hover:bg-emerald-500 active:scale-[0.99] transition disabled:opacity-50"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isEn ? 'Done (Complete)' : 'Hoàn tất món'}</span>
            </button>
          )
        ) : (
          <div
            data-testid={`kds-readonly-${order.id}`}
            className="min-h-[40px] w-full flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-center text-xs font-bold text-slate-600 dark:text-slate-300"
          >
            {isPreparing
              ? isEn
                ? 'View only — requires orders.fulfill permission to mark done'
                : 'Chỉ xem — cần quyền phục vụ (orders.fulfill) để hoàn tất món'
              : isEn
                ? 'View only — requires orders.fulfill permission to start cooking'
                : 'Chỉ xem — cần quyền phục vụ (orders.fulfill) để nhận làm món'}
          </div>
        )}
      </div>
    </article>
  );
}
