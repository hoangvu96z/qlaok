'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  Lock,
  QrCode,
  Zap,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { getAuthHeaders, isSuperAdmin } from '@/lib/auth-session';
import clsx from 'clsx';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { getPlanCopy as localizedPlanCopy } from '@/lib/plan-copy';
import { PaymentTransaction, PlanTier } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import {
  canReopenPaymentTransaction,
  buildBillingColumns,
} from '@/lib/billing-table';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import {
  AppDataTable,
  type TableColumn,
} from '@/components/ui/AppDataTable';
import {
  getSaasPublicBankConfigs,
  selectSaasPublicBankConfig,
  buildSaasVietQrUrl,
} from '@/lib/saas-bank-accounts';

/** Poll interval and max duration while waiting for the bank webhook. */
const PAYMENT_POLL_INTERVAL_MS = 4000;
const PAYMENT_POLL_MAX_MS = 5 * 60 * 1000;

async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function DashboardBillingPage() {
  const { profile, activeShop, activeMembership, refreshDashboard } =
    useDashboard();
  const { locale, t, tx } = useAppI18n();
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loadingBilling, setLoadingBilling] = useState(true);
  const [activeOrder, setActiveOrder] = useState<PaymentTransaction | null>(
    null
  );
  const [creatingTier, setCreatingTier] = useState<PlanTier | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [showBankNotConfigured, setShowBankNotConfigured] = useState(false);
  const qrCardRef = useRef<HTMLDivElement | null>(null);

  const bankConfigs = useMemo(() => getSaasPublicBankConfigs(), []);
  const [selectedBankIndex, setSelectedBankIndex] = useState(0);
  const selectedBank = selectSaasPublicBankConfig(
    bankConfigs,
    selectedBankIndex
  );
  const isAdmin = isSuperAdmin(profile);
  const isProduction = process.env.NODE_ENV === 'production';
  const canSimulate = isAdmin && !isProduction;
  // Staff/cashier or membership-owner of someone else's shop must not manage billing.
  // The page may manage billing for verified admin; a selected shop only when
  // activeShop.owner_id === profile.id; and standalone profile with no selected shop
  // only if there is a loaded profile and no active membership.
  const canManageBilling =
    isAdmin ||
    (activeShop
      ? Boolean(profile?.id && activeShop.owner_id === profile.id)
      : Boolean(profile?.id && !activeMembership));

  const getPlanCopy = (tier: PlanTier) => localizedPlanCopy(tier, locale);

  const showToast = useCallback((message: string, ms = 4000) => {
    setToast(message);
    setTimeout(() => setToast(''), ms);
  }, []);

  const fetchBilling = useCallback(async (): Promise<{
    profilePlan?: PlanTier;
    transactions: PaymentTransaction[];
  } | null> => {
    const res = await fetch('/api/webhooks/payment', {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    const data = await readJsonSafe(res);
    if (!res.ok) {
      throw new Error(
        typeof data.error === 'string'
          ? data.error
          : tx('Không tải được dữ liệu gói cước.', 'Could not load billing data.')
      );
    }
    const list = Array.isArray(data.transactions)
      ? (data.transactions as PaymentTransaction[])
      : [];
    const profilePlan = (data.profile as { plan?: PlanTier } | undefined)?.plan;
    return { profilePlan, transactions: list };
  }, [tx]);

  const loadBilling = useCallback(async () => {
    setLoadingBilling(true);
    try {
      const data = await fetchBilling();
      setTransactions(data?.transactions || []);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx('Không tải được dữ liệu gói cước.', 'Could not load billing data.')
      );
    } finally {
      setLoadingBilling(false);
    }
  }, [fetchBilling, tx]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  const currentPlan: PlanTier = profile?.plan || 'free';

  // Bring the QR card into view right after the order is created (mobile: card sits above the grid).
  useEffect(() => {
    if ((activeOrder || showBankNotConfigured) && qrCardRef.current) {
      qrCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeOrder, showBankNotConfigured]);

  const handlePaymentConfirmed = useCallback(
    async (plan: PlanTier) => {
      setActiveOrder(null);
      setPollTimedOut(false);
      await refreshDashboard();
      await loadBilling();
      showToast(
        tx(
          '🎉 Thanh toán thành công! Đã kích hoạt {plan}.',
          '🎉 Payment confirmed! {plan} is now active.',
          { plan: localizedPlanCopy(plan, locale).name }
        )
      );
    },
    [refreshDashboard, loadBilling, showToast, tx, locale]
  );

  // Poll transaction / plan status while waiting for the bank webhook.
  useEffect(() => {
    if (!activeOrder) return;
    const orderCode = activeOrder.order_code.toUpperCase();
    const targetPlan = activeOrder.target_plan;
    const startedAt = Date.now();
    let cancelled = false;
    let inFlight = false;

    const timer = setInterval(async () => {
      if (cancelled || inFlight) return;
      if (Date.now() - startedAt > PAYMENT_POLL_MAX_MS) {
        clearInterval(timer);
        setPollTimedOut(true);
        return;
      }
      inFlight = true;
      try {
        const data = await fetchBilling();
        if (cancelled || !data) return;
        setTransactions(data.transactions);
        const tx0 = data.transactions.find(
          (item) => item.order_code.toUpperCase() === orderCode
        );
        if (tx0?.status === 'completed') {
          clearInterval(timer);
          await handlePaymentConfirmed(targetPlan);
        } else if (tx0?.status === 'failed') {
          clearInterval(timer);
          setActiveOrder(null);
          setErrorMsg(
            tx(
              'Giao dịch {code} thất bại. Vui lòng tạo lại mã thanh toán hoặc liên hệ hỗ trợ.',
              'Transaction {code} failed. Please create a new payment or contact support.',
              { code: orderCode }
            )
          );
        }
      } catch {
        // transient network error — keep polling
      } finally {
        inFlight = false;
      }
    }, PAYMENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeOrder, fetchBilling, handlePaymentConfirmed, tx]);

  const handleCreateVietQrOrder = async (targetPlan: PlanTier) => {
    if (targetPlan === 'free') return;
    setErrorMsg('');
    setPollTimedOut(false);

    if (!canManageBilling) {
      setErrorMsg(
        tx(
          'Chỉ chủ cửa hàng mới có thể nâng cấp gói.',
          'Only the store owner can upgrade the plan.'
        )
      );
      return;
    }

    if (bankConfigs.length === 0 && !isAdmin) {
      setActiveOrder(null);
      setShowBankNotConfigured(true);
      return;
    }
    setShowBankNotConfigured(false);

    const cfg = PLAN_CONFIGS[targetPlan];
    setCreatingTier(targetPlan);
    try {
      const res = await fetch('/api/webhooks/payment', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'create_order',
          targetPlan,
          amount: cfg.priceMonthly,
          ...(activeShop?.id ? { shopId: activeShop.id } : {}),
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok || !data.transaction) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : tx(
                'Không tạo được mã thanh toán. Vui lòng thử lại.',
                'Could not create the payment order. Please try again.'
              )
        );
      }
      setActiveOrder(data.transaction as PaymentTransaction);
      await loadBilling();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx(
              'Không tạo được mã thanh toán. Vui lòng thử lại.',
              'Could not create the payment order. Please try again.'
            )
      );
    } finally {
      setCreatingTier(null);
    }
  };

  const handleSimulateWebhookSuccess = async (orderCode: string) => {
    if (!canSimulate || !activeOrder) return;
    setSimulating(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/webhooks/payment', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          orderCode,
          referenceCode: `SEPAY_${Date.now()}`,
          simulateWebhook: true,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : tx('Giả lập thanh toán thất bại.', 'Payment simulation failed.')
        );
      }
      await handlePaymentConfirmed(activeOrder.target_plan);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx('Giả lập thanh toán thất bại.', 'Payment simulation failed.')
      );
    } finally {
      setSimulating(false);
    }
  };

  const handleDirectSwitch = async (plan: PlanTier) => {
    if (!isAdmin) return;
    setErrorMsg('');
    try {
      const res = await fetch('/api/webhooks/payment', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'switch_plan_direct',
          plan,
          ownerId: profile?.id,
        }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : tx('Không đổi được gói.', 'Could not switch plan.')
        );
      }
      await refreshDashboard();
      showToast(
        tx('Đã chuyển nhanh sang: {plan}', 'Switched test plan to: {plan}', {
          plan: getPlanCopy(plan).name,
        }),
        3000
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : tx('Không đổi được gói.', 'Could not switch plan.')
      );
    }
  };

  const handleReopenPendingOrder = useCallback(
    (transaction: PaymentTransaction) => {
      if (!canReopenPaymentTransaction(transaction, canManageBilling)) return;
      setErrorMsg('');
      setPollTimedOut(false);
      setShowBankNotConfigured(false);
      setActiveOrder({ ...transaction });
    },
    [canManageBilling]
  );

  const billingColumns = useMemo<TableColumn<PaymentTransaction>[]>(
    () =>
      buildBillingColumns({
        tx,
        canManageBilling,
        onReopenPendingOrder: handleReopenPendingOrder,
      }),
    [canManageBilling, handleReopenPendingOrder, tx]
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-extrabold text-emerald-900 shadow-md"
        >
          {toast}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs font-bold text-rose-900 shadow-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg('')}
            className="rounded-lg px-2 text-rose-700 hover:bg-rose-100"
            aria-label={t('common.close')}
          >
            ×
          </button>
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

        {/* Instant plan switcher — Super Admin only (server also enforces) */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5">
            <span className="px-2 text-[11px] font-bold text-slate-500">
              {tx('Đổi nhanh gói (Admin):', 'Quick switch (Admin):')}
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
        )}
      </div>

      {!canManageBilling && (
        <div
          data-testid="billing-readonly-notice"
          className="flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs font-bold text-amber-900"
        >
          <Lock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {tx(
              'Bạn đang xem với quyền nhân viên. Chỉ chủ cửa hàng mới có thể nâng cấp hoặc thanh toán gói dịch vụ.',
              'You are viewing as staff. Only the store owner can upgrade or pay for a plan.'
            )}
          </span>
        </div>
      )}

      {/* Payment not configured state (no fake QR) */}
      {showBankNotConfigured && !activeOrder && (
        <div
          ref={qrCardRef}
          data-testid="billing-payment-not-configured"
          className="scroll-mt-24 rounded-3xl border-2 border-amber-400 bg-amber-50 p-6 shadow-md space-y-2"
        >
          <div className="flex items-center gap-2 text-sm font-black text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            {tx(
              'Thanh toán chưa được cấu hình',
              'Payment is not configured yet'
            )}
          </div>
          <p className="text-xs font-semibold text-amber-900">
            {tx(
              'Hệ thống chưa cấu hình tài khoản nhận thanh toán. Vui lòng liên hệ bộ phận hỗ trợ Qlaok để nâng cấp gói.',
              'The receiving bank account has not been configured. Please contact Qlaok support to upgrade your plan.'
            )}
          </p>
          <button
            type="button"
            onClick={() => setShowBankNotConfigured(false)}
            className="rounded-xl border border-amber-300 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Active Dynamic VietQR Card — rendered above the grid so it is visible right after tapping pay */}
      {activeOrder && (
        <div
          ref={qrCardRef}
          data-testid="billing-active-order"
          className="scroll-mt-24 rounded-3xl border-2 border-emerald-500 bg-white p-6 shadow-xl space-y-5"
        >
          {/* Multiple bank accounts selector */}
          {bankConfigs.length > 1 && (
            <div
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2"
              role="region"
              aria-label={tx(
                'Chọn tài khoản ngân hàng nhận thanh toán',
                'Select receiving bank account'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">
                  {tx(
                    'Chọn tài khoản nhận chuyển khoản:',
                    'Select transfer recipient account:'
                  )}
                </span>
                <span className="text-[11px] font-medium text-slate-500">
                  {tx(
                    '{count} tài khoản',
                    '{count} accounts',
                    { count: bankConfigs.length }
                  )}
                </span>
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={tx('Danh sách tài khoản VietQR', 'VietQR account list')}
              >
                {bankConfigs.map((cfg, idx) => {
                  const isSelected = idx === selectedBankIndex;
                  return (
                    <button
                      key={`${cfg.bin}-${cfg.account}-${idx}`}
                      type="button"
                      onClick={() => setSelectedBankIndex(idx)}
                      aria-pressed={isSelected}
                      data-testid={`billing-bank-option-${idx}`}
                      className={clsx(
                        'flex flex-col items-start rounded-xl border px-3 py-2 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500',
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-sm ring-1 ring-emerald-600'
                          : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700'
                      )}
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-extrabold text-slate-900">
                          {cfg.bankName}
                        </span>
                        <span className="font-mono text-slate-700">
                          {cfg.account}
                        </span>
                      </div>
                      {cfg.accountName ? (
                        <span className="text-[11px] font-semibold text-slate-500 truncate max-w-[220px]">
                          {cfg.accountName}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col md:flex-row items-center gap-6">
            {selectedBank ? (
              <div
                style={{ backgroundColor: '#ffffff' }}
                className="qr-light-surface shrink-0 rounded-2xl border border-slate-200 p-3 bg-white shadow-md"
              >
                <img
                  src={buildSaasVietQrUrl(
                    selectedBank,
                    activeOrder.amount,
                    activeOrder.order_code
                  )}
                  alt={tx('Mã thanh toán VietQR', 'VietQR Payment')}
                  className="h-56 w-56 object-contain"
                />
              </div>
            ) : (
              <div className="shrink-0 flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-400 bg-amber-50 p-4 text-center text-xs font-bold text-amber-900">
                <AlertTriangle className="h-6 w-6" />
                {tx(
                  'Chưa cấu hình tài khoản nhận (NEXT_PUBLIC_SAAS_BANK_*). Không hiển thị QR.',
                  'Receiving account not configured (NEXT_PUBLIC_SAAS_BANK_*). QR hidden.'
                )}
              </div>
            )}

            <div className="flex-1 space-y-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900">
                {pollTimedOut ? (
                  <QrCode className="h-3.5 w-3.5" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {pollTimedOut
                  ? tx(
                      'Chưa nhận được xác nhận từ ngân hàng',
                      'No bank confirmation received yet'
                    )
                  : tx(
                      'Đang chờ thanh toán qua VietQR — tự động cập nhật',
                      'Waiting for VietQR transfer — updates automatically'
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
                {selectedBank && (
                  <>
                    <div>
                      <span className="text-slate-400 block">
                        {tx('Ngân hàng:', 'Bank:')}
                      </span>
                      <strong className="text-sm text-slate-900">
                        {selectedBank.bankName}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block">
                        {tx('Số tài khoản:', 'Account number:')}
                      </span>
                      <strong className="text-sm font-mono text-slate-900">
                        {selectedBank.account}
                      </strong>
                      {selectedBank.accountName && (
                        <span className="block text-[11px] font-semibold text-slate-500">
                          {selectedBank.accountName}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {pollTimedOut && (
                <p className="text-xs font-semibold text-slate-600">
                  {tx(
                    'Nếu bạn đã chuyển khoản, gói sẽ được kích hoạt ngay khi ngân hàng xác nhận. Tải lại trang sau ít phút hoặc liên hệ hỗ trợ kèm mã giao dịch.',
                    'If you already transferred, the plan activates as soon as the bank confirms. Reload in a few minutes or contact support with the order code.'
                  )}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {canSimulate && (
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
                            '⚡ Giả lập đã chuyển khoản thành công (Admin/dev)',
                            '⚡ Simulate successful transfer (Admin/dev)'
                          )}
                        </span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setActiveOrder(null);
                    setPollTimedOut(false);
                  }}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3 Pricing Tiers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {(['free', 'basic', 'premium'] as PlanTier[]).map((tier) => {
          const cfg = PLAN_CONFIGS[tier];
          const copy = getPlanCopy(tier);
          const isCurrent = currentPlan === tier;
          const isPremium = tier === 'premium';
          const isCreating = creatingTier === tier;

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
                ) : tier === 'free' ? (
                  <div className="flex w-full items-center justify-center rounded-2xl border border-slate-200 py-3 px-4 text-center text-[11px] font-semibold text-slate-500">
                    {tx(
                      'Gói sẽ tự động về Miễn phí khi gói trả phí hết hạn.',
                      'Your plan returns to Free automatically when the paid plan expires.'
                    )}
                  </div>
                ) : !canManageBilling ? (
                  <div className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-slate-200 py-3 text-xs font-bold text-slate-500">
                    <Lock className="h-4 w-4" />
                    <span>{tx('Chỉ chủ quán', 'Owner only')}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleCreateVietQrOrder(tier)}
                    disabled={creatingTier !== null}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3 px-4 text-xs font-black transition-transform active:scale-95 disabled:opacity-60 ${
                      isPremium
                        ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-500'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                    {tx(
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
