'use client';

import React, { useState, useEffect } from 'react';
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
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { PaymentTransaction, PlanTier } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';

export default function DashboardBillingPage() {
  const { profile, refreshDashboard } = useDashboard();
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [activeOrder, setActiveOrder] = useState<PaymentTransaction | null>(
    null
  );
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState('');

  const loadBilling = async () => {
    const query = profile?.id
      ? `?ownerId=${encodeURIComponent(profile.id)}`
      : '';
    const res = await fetch(`/api/webhooks/payment${query}`, {
      cache: 'no-store',
    });
    const data = await res.json();
    setTransactions(data.transactions || []);
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
      headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
          '🎉 Thanh toán VietQR thành công! Gói cước đã được nâng cấp tự động.'
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'switch_plan_direct',
        plan,
        ownerId: profile?.id,
      }),
    });
    await refreshDashboard();
    setToast(`Đã chuyển chế độ thử nghiệm sang gói: ${PLAN_CONFIGS[plan].name}`);
    setTimeout(() => setToast(''), 3000);
  };

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
            Gói Cước & Thanh Toán Tự Động VietQR
          </h1>
          <p className="text-xs text-slate-500">
            Tích hợp cổng VietQR động & Webhook SePay/PayOS kích hoạt gói trong 3 giây
          </p>
        </div>

        {/* Instant Sandbox Plan Switcher for Testing */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5">
          <span className="px-2 text-[11px] font-bold text-slate-500">
            Test nhanh gói:
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
              {cfg.badgeText && (
                <span className="absolute -top-3 right-5 rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-black uppercase text-white shadow-xs">
                  {cfg.badgeText}
                </span>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {cfg.name}
                  </h3>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black text-slate-950">
                      {formatCurrency(cfg.priceMonthly)}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">
                      / tháng
                    </span>
                  </div>
                </div>

                <ul className="space-y-2.5 border-t border-slate-100 pt-4">
                  {cfg.features.map((feat, i) => (
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
                    <span>Đang sử dụng gói này</span>
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
                      ? 'Chuyển về Gói Miễn Phí'
                      : `Thanh toán VietQR (${formatCurrency(cfg.priceMonthly)})`}
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
                alt="VietQR Payment"
                className="h-56 w-56 object-contain"
              />
            </div>

            <div className="flex-1 space-y-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                <QrCode className="h-3.5 w-3.5" />
                Đang chờ thanh toán qua VietQR (SePay / PayOS Auto-Webhook)
              </span>

              <h3 className="text-lg font-black text-slate-900">
                Nâng cấp lên {PLAN_CONFIGS[activeOrder.target_plan].name}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block">Số tiền chuyển khoản:</span>
                  <strong className="text-base text-emerald-700">
                    {formatCurrency(activeOrder.amount)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">
                    Nội dung chuyển khoản (Tự động):
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
                      <span>Đang xử lý Webhook...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      <span>
                        ⚡ Giả Lập Đã Chuyển Khoản Thành Công (Test Webhook)
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveOrder(null)}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Transaction History */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
        <h3 className="text-sm font-extrabold text-slate-900">
          Lịch sử giao dịch nâng cấp gói
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400">
                <th className="py-2 font-bold">Mã đơn (Order Code)</th>
                <th className="py-2 font-bold">Gói nâng cấp</th>
                <th className="py-2 font-bold">Số tiền</th>
                <th className="py-2 font-bold">Trạng thái</th>
                <th className="py-2 font-bold">Mã tham chiếu NH</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 font-mono font-bold text-slate-900">
                    {tx.order_code}
                  </td>
                  <td className="py-2.5 uppercase font-bold text-slate-700">
                    {tx.target_plan}
                  </td>
                  <td className="py-2.5 font-bold text-slate-900">
                    {formatCurrency(tx.amount)}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                        tx.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {tx.status === 'completed' ? 'Thành công' : 'Đang chờ'}
                    </span>
                  </td>
                  <td className="py-2.5 font-mono text-slate-500">
                    {tx.bank_ref_id || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
