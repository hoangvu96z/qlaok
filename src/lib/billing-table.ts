import React from 'react';
import { QrCode } from 'lucide-react';
import type { TableColumn } from 'react-data-table-component';
import type { PaymentTransaction } from '@/types/qlaok';
import type { TranslationParams } from '@/lib/app-i18n';
import { formatCurrency } from '@/lib/i18n-helper';

export interface BillingTableColumnsOptions {
  tx: (
    viText: string,
    enText?: string | null,
    params?: TranslationParams
  ) => string;
  canManageBilling: boolean;
  onReopenPendingOrder?: (order: PaymentTransaction) => void;
}

/**
 * Staff read-only boundary & row eligibility check:
 * Only owner/admin can reopen pending payment transactions.
 * Completed or failed rows must never show the reopen action.
 */
export function canReopenPaymentTransaction(
  transaction: Pick<PaymentTransaction, 'status'> | null | undefined,
  canManageBilling: boolean
): boolean {
  if (!canManageBilling || !transaction) return false;
  return transaction.status === 'pending';
}

/**
 * Builds the data table columns for payment transactions in DashboardBillingPage.
 * Adds a localized "Xem QR / View QR" action column for eligible pending rows
 * when the user has billing management permissions (owner/super-admin).
 */
export function buildBillingColumns({
  tx,
  canManageBilling,
  onReopenPendingOrder,
}: BillingTableColumnsOptions): TableColumn<PaymentTransaction>[] {
  const columns: TableColumn<PaymentTransaction>[] = [
    {
      id: 'order_code',
      name: tx('Mã giao dịch', 'Order code'),
      sortable: true,
      selector: (item) => item.order_code,
      minWidth: '150px',
      cell: (item) =>
        React.createElement(
          'span',
          { className: 'font-mono font-bold text-slate-900 dark:text-slate-100' },
          item.order_code
        ),
    },
    {
      id: 'target_plan',
      name: tx('Gói nâng cấp', 'Target plan'),
      sortable: true,
      selector: (item) => item.target_plan,
      minWidth: '130px',
      cell: (item) =>
        React.createElement(
          'span',
          { className: 'uppercase font-bold text-slate-700 dark:text-slate-200' },
          item.target_plan
        ),
    },
    {
      id: 'amount',
      name: tx('Số tiền', 'Amount'),
      sortable: true,
      right: true,
      selector: (item) => item.amount,
      sortFunction: (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
      minWidth: '130px',
      cell: (item) =>
        React.createElement(
          'span',
          { className: 'font-bold text-slate-900 dark:text-slate-100' },
          formatCurrency(item.amount)
        ),
    },
    {
      id: 'status',
      name: tx('Trạng thái', 'Status'),
      sortable: true,
      selector: (item) => item.status,
      minWidth: '140px',
      cell: (item) => {
        const isCompleted = item.status === 'completed';
        const isPending = item.status === 'pending';
        const isFailed = item.status === 'failed';
        const className = isCompleted
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
          : isPending
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
            : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300';
        const label = isCompleted
          ? tx('Thành công', 'Completed')
          : isPending
            ? tx('Đang chờ', 'Pending')
            : isFailed
              ? tx('Thất bại', 'Failed')
              : item.status;
        return React.createElement(
          'span',
          {
            className: `rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${className}`,
          },
          label
        );
      },
    },
    {
      id: 'bank_ref_id',
      name: tx('Mã tham chiếu NH', 'Bank reference'),
      sortable: true,
      selector: (item) => item.bank_ref_id || '',
      minWidth: '160px',
      cell: (item) =>
        React.createElement(
          'span',
          { className: 'font-mono text-slate-500 dark:text-slate-400' },
          item.bank_ref_id || '—'
        ),
    },
  ];

  if (canManageBilling) {
    columns.push({
      id: 'action',
      name: tx('Thao tác', 'Action'),
      right: true,
      minWidth: '130px',
      cell: (item) => {
        if (!canReopenPaymentTransaction(item, canManageBilling)) return null;
        return React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': `billing-reopen-${item.order_code}`,
            'aria-label': tx('Xem QR cho giao dịch {code}', 'View QR for order {code}', {
              code: item.order_code,
            }),
            onClick: () => onReopenPendingOrder?.(item),
            className:
              'inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 shadow-2xs hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 transition-colors',
          },
          React.createElement(QrCode, { className: 'h-3.5 w-3.5 shrink-0' }),
          React.createElement('span', null, tx('Xem QR', 'View QR'))
        );
      },
    });
  }

  return columns;
}
