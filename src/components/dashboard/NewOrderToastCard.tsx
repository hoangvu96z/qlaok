'use client';

import React from 'react';
import Link from 'next/link';
import { BellRing, X } from 'lucide-react';
import { formatCurrency } from '@/lib/i18n-helper';
import type { OrderToastPosition } from '@/lib/order-chime';

export const TOAST_POSITION_CLASSES: Record<OrderToastPosition, string> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
};

export interface LiveToastOrderData {
  orderCode: string;
  tableLabel: string;
  totalAmount: number;
}

export interface NewOrderToastCardProps {
  order: LiveToastOrderData;
  position?: OrderToastPosition;
  currency?: string;
  targetHref?: string;
  onOpenOrders: () => void;
  openOrdersLabel: string;
  newOrderBadgeLabel: string;
  totalLabel: string;
}

export function NewOrderToastCard({
  order,
  position = 'top-right',
  currency = 'VND',
  targetHref = '/dashboard/orders',
  onOpenOrders,
  openOrdersLabel,
  newOrderBadgeLabel,
  totalLabel,
}: NewOrderToastCardProps) {
  const positionClass = TOAST_POSITION_CLASSES[position] || 'top-4 right-4';
  const ariaLabel = `${order.tableLabel} • #${order.orderCode} - ${openOrdersLabel}`;

  return (
    <Link
      href={targetHref}
      onClick={() => {
        onOpenOrders();
      }}
      aria-live="polite"
      aria-label={ariaLabel}
      data-testid="new-order-toast-card"
      className={`fixed ${positionClass} z-50 block w-[calc(100vw-2rem)] max-w-sm rounded-3xl bg-slate-950 text-white border-2 border-amber-400 p-4 shadow-2xl animate-bounce focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer select-none group`}
    >
      <div
        data-testid="toast-card-content"
        className="flex items-start justify-between gap-3 pointer-events-none"
      >
        <div className="flex items-start gap-3">
          <div
            data-testid="toast-card-bell"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950"
          >
            <BellRing className="h-5 w-5" />
          </div>
          <div>
            <span
              data-testid="toast-card-badge"
              className="inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400 uppercase"
            >
              {newOrderBadgeLabel}
            </span>
            <h4
              data-testid="toast-card-title"
              className="mt-1 text-sm font-black text-white"
            >
              {order.tableLabel} • #{order.orderCode}
            </h4>
            <p
              data-testid="toast-card-total"
              className="text-xs font-bold text-amber-400"
            >
              {totalLabel}{' '}
              {formatCurrency(
                order.totalAmount,
                currency
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                data-testid="toast-card-cta"
                className="rounded-xl bg-amber-400 px-3 py-1.5 text-[11px] font-black text-slate-950 group-hover:bg-amber-300 transition-colors"
              >
                {openOrdersLabel}
              </span>
            </div>
          </div>
        </div>
        <span
          data-testid="toast-card-close"
          aria-hidden="true"
          className="rounded-lg p-1 text-slate-400 group-hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
