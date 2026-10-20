'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Check,
  Crown,
  QrCode,
  Sparkles,
  Zap,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { getAuthHeaders } from '@/lib/auth-session';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { getPlanCopy as localizedPlanCopy } from '@/lib/plan-copy';
import { PaymentTransaction, PlanTier } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import {
  AppDataTable,
  type TableColumn,
} from '@/components/ui/AppDataTable';

export default function DashboardBillingPage() {
  const { profile, refreshDashboard } = useDashboard();
  const { locale, t, tx } = useAppI18n();
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [activeOrder, setActiveOrder] = useState<PaymentTransaction | null>(
    null
  );
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState('');

  const getPlanCopy = (tier: PlanTier) => localizedPlanCopy(tier, locale);

  const loadBilling = async () => {
    setLoadingBilling(true);
    try {
      const query = profile?.id
        ? `?ownerId=${encodeURIComponent(profile.id)}`
        : '';
      const res = await fetch(`/api/webhooks/payment${query}`, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json();
      setTransactions(data.transactions || []);
    } catch {
      // ignore network error
    } finally {
      setLoadingBilling(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, [profile?.id]);

  const currentPlan: PlanTier = profile?.plan || 'free';

  const handleCreateVietQrOrder = async (targetPlan: PlanTier) => {
    const cfg = PLAN_CONFIGS[targetPlan];
    if (targetPlan === 'free') {
      await handleDirectSwitch('free');
      return;
    }

    const res = await fetch('/api/webhooks/payment', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'create_order',
        targetPlan,
        amount: cfg.priceMonthly,
        ownerId: profile?.id,
      }),
    });
    const data = await res.json();
    if (data.transaction) {
      setActiveOrder(data.transaction);
      await loadBilling();
    }
  };

  const handleSimulateWebhookSuccess = async (orderCode: string) => {
    setSimulating(true);
    try {
      const res = await fetch('/api/webhooks/payment', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          orderCode,
          referenceCode: `SEPAY_${Date.now()}`,
          ownerId: profile?.id,
        }),
      });
      if (res.ok) {
        setActiveOrder(null);
        await refreshDashboard();
        await loadBilling();
        setToast(
          tx(
            '🎉 Thanh toán VietQR thành công! Gói cước đã được nâng cấp.',
            '🎉 VietQR payment confirmed! Your plan has been upgraded.'
          )
        );
        setTimeout(() => setToast(''), 4000);
      }
    } finally {
      setSimulating(false);
    }
  };

  const handleDirectSwitch = async (plan: PlanTier) => {
    await fetch('/api/webhooks/payment', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'switch_plan_direct',
        plan,
        ownerId: profile?.id,
      }),
    });
    await refreshDashboard();
    setToast(
      tx(
        'Đã chuyển nhanh sang: {plan}',
        'Switched test plan to: {plan}',
        { plan: getPlanCopy(plan).name }
      )
    );
    setTimeout(() => setToast(''), 3000);
  };

  const billingColumns = useMemo<TableColumn<PaymentTransaction>[]>(
    () => [
      {
        id: 'order_code',
        name: tx('Mã giao dịch', 'Order code'),
        sortable: true,
        selector: (item) => item.order_code,
        minWidth: '150px',
        cell: (item) => (
          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
            {item.order_code}
          </span>
        ),
      },
      {
        id: 'target_plan',
        name: tx('Gói nâng cấp', 'Target plan'),
        sortable: true,
        selector: (item) => item.target_plan,
        minWidth: '130px',
        cell: (item) => (
          <span className="uppercase font-bold text-slate-700 dark:text-slate-200">
            {item.target_plan}
          </span>
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
        cell: (item) => (
          <span className="font-bold text-slate-900 dark:text-slate-100">
            {formatCurrency(item.amount)}
          </span>
        ),
      },
      {
        id: 'status',
        name: tx('Trạng thái', 'Status'),
        sortable: true,
        selector: (item) => item.status,
        minWidth: '140px',
        cell: (item) => (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
              item.status === 'completed'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                : item.status === 'pending'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300'
            }`}
          >
            {item.status === 'completed'
              ? tx('Thành công', 'Completed')
              : item.status === 'pending'
                ? tx('Đang chờ', 'Pending')
                : item.status === 'failed'
                  ? tx('Thất bại', 'Failed')
                  : item.status}
          </span>
        ),
      },
      {
        id: 'bank_ref_id',
        name: tx('Mã tham chiếu NH', 'Bank reference'),
        sortable: true,
        selector: (item) => item.bank_ref_id || '',
        minWidth: '160px',
        cell: (item) => (
          <span className="font-mono text-slate-500 dark:text-slate-400">
            {item.bank_ref_id || '—'}
          </span>
        ),
      },
    ],
    [tx]
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-extrabold text-emerald-900 shadow-md">
          {toast}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">
            {tx('Gói dịch vụ', 'Plans')}
          </h1>
          <p className="text-xs text-slate-500">
            {tx(
              'Nâng cấp gói qua mã chuyển khoản VietQR và kích hoạt tự động trong vài giây.',
              'Upgrade via VietQR bank transfer with automatic plan activation in seconds.'
            )}
          </p>
        </div>

        {/* Instant Sandbox Plan Switcher for Testing */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5">
          <span className="px-2 text-[11px] font-bold text-slate-500">
            {tx('Đổi nhanh gói (thử nghiệm):', 'Quick test switch:')}
          </span>
          {(['free', 'basic', 'premium'] as PlanTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => handleDirectSwitch(tier)}
              className={`rounded-xl px-2.5 py-1 text-xs font-black uppercase transition-colors ${
                currentPlan === tier
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      {/* 3 Pricing Tiers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {(['free', 'basic', 'premium'] as PlanTier[]).map((tier) => {
          const cfg = PLAN_CONFIGS[tier];
          const copy = getPlanCopy(tier);
          const isCurrent = currentPlan === tier;
          const isPremium = tier === 'premium';

          return (
            <div
              key={tier}
              className={`rounded-3xl border p-6 flex flex-col justify-between transition-all ${
                isPremium
                  ? 'border-2 border-emerald-500 bg-white shadow-xl relative'
                  : 'border-slate-200 bg-white shadow-2xs'
              }`}
            >
              {copy.badgeText && (
                <span className="absolute -top-3 right-5 rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-black uppercase text-white shadow-xs">
                  {copy.badgeText}
                </span>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {copy.name}
                  </h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-slate-950">
                      {formatCurrency(cfg.priceMonthly)}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      {tx('/ tháng', '/ month')}
                    </span>
                  </div>
                </div>

                <ul className="space-y-2.5 border-t border-slate-100 pt-4">
                  {copy.features.map((feat, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs font-medium text-slate-700"
                    >
                      <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-6">
                {isCurrent ? (
                  <div className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-slate-100 py-3 text-xs font-extrabold text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>{tx('Đang sử dụng gói này', 'Current plan')}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCreateVietQrOrder(tier)}
                    className={`w-full rounded-2xl py-3 px-4 text-xs font-black transition-transform active:scale-95 ${
                      isPremium
                        ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-500'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {tier === 'free'
                      ? tx('Chuyển về Gói Miễn Phí', 'Switch to Free Plan')
                      : tx(
                          'Thanh toán VietQR ({price})',
                          'Pay via VietQR ({price})',
                          { price: formatCurrency(cfg.priceMonthly) }
                        )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Dynamic VietQR Modal / Card */}
      {activeOrder && (
        <div className="rounded-3xl border-2 border-emerald-500 bg-white p-6 shadow-xl space-y-5">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div
              style={{ backgroundColor: '#ffffff' }}
              className="qr-light-surface shrink-0 rounded-2xl border border-slate-200 p-3 bg-white shadow-md"
            >
              <img
                src={`https://img.vietqr.io/image/MB-0905123456-compact2.png?amount=${activeOrder.amount}&addInfo=${activeOrder.order_code}&accountName=QLAOK%20SAAS`}
                alt={tx('Mã thanh toán VietQR', 'VietQR Payment')}
                className="h-56 w-56 object-contain"
              />
            </div>

            <div className="flex-1 space-y-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                <QrCode className="h-3.5 w-3.5" />
                {tx(
                  'Đang chờ thanh toán qua VietQR',
                  'Waiting for VietQR bank transfer'
                )}
              </span>

              <h3 className="text-lg font-black text-slate-900">
                {tx('Nâng cấp lên {plan}', 'Upgrade to {plan}', {
                  plan: getPlanCopy(activeOrder.target_plan).name,
                })}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block">
                    {tx('Số tiền chuyển khoản:', 'Transfer amount:')}
                  </span>
                  <strong className="text-base text-emerald-700">
                    {formatCurrency(activeOrder.amount)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">
                    {tx(
                      'Nội dung chuyển khoản (bắt buộc đúng):',
                      'Transfer memo (exact match):'
                    )}
                  </span>
                  <strong className="text-base font-mono text-rose-600">
                    {activeOrder.order_code}
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() =>
                    handleSimulateWebhookSuccess(activeOrder.order_code)
                  }
                  disabled={simulating}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-xs font-black text-white shadow-lg hover:bg-emerald-500"
                >
                  {simulating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {tx(
                          'Đang xác nhận thanh toán...',
                          'Confirming payment...'
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      <span>
                        {tx(
                          '⚡ Giả lập đã chuyển khoản thành công',
                          '⚡ Simulate successful transfer'
                        )}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveOrder(null)}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Transaction History */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          {tx('Lịch sử giao dịch nâng cấp gói', 'Plan Upgrade History')}
        </h3>
        <AppDataTable<PaymentTransaction>
          keyField="id"
          ariaLabel={tx(
            'Lịch sử giao dịch nâng cấp gói',
            'Plan Upgrade History'
          )}
          columns={billingColumns}
          data={transactions}
          progressPending={loadingBilling}
          progressComponent={
            <div data-testid="billing-loading-state" className="py-8 text-center">
              <div className="flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {tx(
                    'Đang tải dữ liệu lịch sử giao dịch...',
                    'Loading transaction history data...'
                  )}
                </span>
              </div>
            </div>
          }
          noDataComponent={
            <div
              data-testid="billing-empty-state"
              className="py-6 text-center text-xs font-semibold text-slate-400"
            >
              {tx(
                'Chưa có giao dịch nâng cấp gói nào.',
                'No plan upgrade transactions yet.'
              )}
            </div>
          }
          pagination
          paginationPerPage={10}
          paginationRowsPerPageOptions={[10, 20, 50]}
        />
      </div>
    </div>
  );
}
