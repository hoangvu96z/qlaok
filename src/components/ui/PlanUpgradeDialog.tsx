'use client';

import Link from 'next/link';
import { ArrowRight, Lock, X } from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { BILLING_UPGRADE_HREF } from '@/lib/plan-limits';
import type { PlanTier } from '@/types/qlaok';

export interface PlanUpgradeDialogProps {
  open: boolean;
  currentPlan: PlanTier;
  requiredPlan: PlanTier;
  feature: 'custom_theme' | 'supported_languages';
  onClose: () => void;
}

export function PlanUpgradeDialog({
  open,
  currentPlan,
  requiredPlan,
  feature,
  onClose,
}: PlanUpgradeDialogProps) {
  const { tx } = useAppI18n();
  if (!open) return null;

  const planName = (plan: PlanTier) =>
    plan === 'basic'
      ? tx('Gói Cơ Bản (Basic)', 'Basic plan')
      : plan === 'premium'
        ? tx('Gói Chuyên Nghiệp (Premium)', 'Premium plan')
        : tx('Gói Miễn Phí (Free)', 'Free plan');
  const featureName =
    feature === 'custom_theme'
      ? tx('tùy chỉnh giao diện quán', 'store theme customization')
      : tx('thêm ngôn ngữ thực đơn', 'additional menu languages');

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-upgrade-dialog-title"
        aria-describedby="plan-upgrade-dialog-description"
        data-testid="plan-upgrade-dialog"
        className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2
              id="plan-upgrade-dialog-title"
              className="text-base font-black text-slate-900"
            >
              {tx(
                'Tính năng cần nâng cấp gói',
                'This feature requires an upgrade'
              )}
            </h2>
            <p
              id="plan-upgrade-dialog-description"
              className="text-sm leading-relaxed text-slate-600"
            >
              {tx(
                '{feature} không có trong {currentPlan}. Nâng cấp lên {requiredPlan} để sử dụng.',
                '{feature} is not included in the {currentPlan}. Upgrade to {requiredPlan} to use it.',
                {
                  feature: featureName,
                  currentPlan: planName(currentPlan),
                  requiredPlan: planName(requiredPlan),
                }
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label={tx('Đóng thông báo', 'Close message')}
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {tx('Để sau', 'Maybe later')}
          </button>
          <Link
            href={BILLING_UPGRADE_HREF}
            data-testid="plan-upgrade-dialog-cta"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700"
          >
            {tx('Nâng cấp lên {plan}', 'Upgrade to {plan}', {
              plan: planName(requiredPlan),
            })}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
