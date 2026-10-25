'use client';

import React from 'react';
import Link from 'next/link';
import {
  Lock,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { BILLING_UPGRADE_HREF } from '@/lib/plan-limits';
import type { PlanTier } from '@/types/qlaok';

export interface AiScannerPaywallProps {
  plan?: PlanTier | null;
  shopName?: string;
  className?: string;
}

/**
 * Accessible paywall card and locked dialog presentation for /dashboard/ai-scanner.
 * Rendered when the active shop owner is on Free or Basic tier (AI OCR is Premium-only).
 */
export function AiScannerPaywall({
  plan = 'free',
  shopName,
  className = '',
}: AiScannerPaywallProps) {
  const { tx } = useAppI18n();

  const currentPlan = plan || 'free';
  const planName =
    currentPlan === 'basic'
      ? tx('Gói Cơ Bản (Basic)', 'Basic Plan')
      : tx('Gói Miễn Phí (Free)', 'Free Plan');

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ai-scanner-paywall-heading"
      aria-describedby="ai-scanner-paywall-desc"
      data-testid="ai-scanner-paywall"
      className={`relative overflow-hidden rounded-3xl border border-amber-200/90 bg-linear-to-b from-amber-50/70 via-white to-amber-50/40 p-6 sm:p-10 shadow-sm ${className}`}
    >
      <div className="mx-auto max-w-xl text-center space-y-6">
        {/* Badge & Lock Icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/25">
            <Lock className="h-8 w-8" />
          </div>

          <div
            data-testid="ai-scanner-current-plan"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100/80 px-3 py-1 text-xs font-black text-amber-900"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-700" />
            <span>
              {tx(
                'Gói hiện tại của quán: {planName}',
                'Current store plan: {planName}',
                { planName }
              )}
            </span>
          </div>
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h2
            id="ai-scanner-paywall-heading"
            className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight"
          >
            {tx(
              'Tính năng Quét menu AI chỉ có trong gói Chuyên Nghiệp (Premium)',
              'AI Menu Scanner is a Premium Feature'
            )}
          </h2>
          <p
            id="ai-scanner-paywall-desc"
            className="text-xs sm:text-sm text-slate-600 leading-relaxed"
          >
            {shopName
              ? tx(
                  'Cửa hàng "{shopName}" hiện đang sử dụng {planName}. Tính năng AI Vision OCR đọc thực đơn từ ảnh chụp chỉ hỗ trợ trên gói Premium. Nâng cấp ngay để tiết kiệm hàng giờ nhập liệu thực đơn thủ công!',
                  'Store "{shopName}" is currently on the {planName}. AI Vision OCR menu scanning is only available on the Premium plan. Upgrade now to save hours of manual data entry!',
                  { shopName, planName }
                )
              : tx(
                  'Tính năng AI Vision OCR đọc thực đơn từ ảnh chụp chỉ hỗ trợ trên gói Premium. Nâng cấp ngay để tự động bóc tách thực đơn, chuẩn hóa giá tiền và dịch đa ngôn ngữ trong 10 giây.',
                  'AI Vision OCR menu scanning is only available on the Premium plan. Upgrade now to auto-extract items, normalize prices, and translate in 10 seconds.'
                )}
          </p>
        </div>

        {/* Premium Features Highlight */}
        <div className="rounded-2xl border border-amber-200/60 bg-white/90 p-5 text-left shadow-2xs">
          <h3 className="text-xs font-black uppercase tracking-wider text-amber-900 mb-3 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-amber-600" />
            <span>
              {tx(
                'Quyền lợi khi nâng cấp gói Premium:',
                'Premium Plan includes:'
              )}
            </span>
          </h3>
          <ul className="space-y-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>
                <strong>{tx('AI Vision OCR:', 'AI Vision OCR:')}</strong>{' '}
                {tx(
                  'Chụp ảnh menu giấy hoặc bảng giá tạo menu tự động trong 10 giây',
                  'Snap a photo of your paper menu or price list to generate items in 10s'
                )}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>
                <strong>
                  {tx(
                    'Dịch tự động 8 ngôn ngữ:',
                    '8 Auto-Translated Languages:'
                  )}
                </strong>{' '}
                {tx(
                  'Việt, Anh, Hàn, Nhật, Trung, Tây Ban Nha, Ý, Nga',
                  'Vietnamese, English, Korean, Japanese, Chinese, Spanish, Italian, Russian'
                )}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>
                <strong>
                  {tx('Không giới hạn số lượng món:', 'Unlimited items:')}
                </strong>{' '}
                {tx(
                  'Thêm thoải mái món ăn, đồ uống hoặc dịch vụ không lo chạm giới hạn',
                  'Add unlimited items, drinks, or services without reaching limits'
                )}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
              <span>
                <strong>
                  {tx('Chuẩn hóa giá thông minh:', 'Smart Price Normalization:')}
                </strong>{' '}
                {tx(
                  'Tự động quy đổi giá tắt (35k → 35.000đ) và phân loại danh mục',
                  'Automatically converts shorthand prices (35k → 35,000đ) & categorizes'
                )}
              </span>
            </li>
          </ul>
        </div>

        {/* Upgrade CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href={BILLING_UPGRADE_HREF}
            data-testid="ai-scanner-upgrade-cta"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-6 py-3.5 text-xs sm:text-sm font-black text-white shadow-md shadow-amber-600/25 hover:bg-amber-500 active:scale-95 transition-all"
          >
            <span>
              {tx('Nâng cấp lên gói Premium ngay', 'Upgrade to Premium now')}
            </span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard/catalog"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all"
          >
            <span>{tx('Quay lại danh mục món', 'Back to Catalog')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
