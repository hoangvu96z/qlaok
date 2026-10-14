'use client';

import React from 'react';
import Link from 'next/link';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { PlanTier } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';

export default function MarketingPricingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white font-black text-lg">
              Q
            </div>
            <span className="text-base font-black text-slate-900">
              Qlaok Pricing
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/explore"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
            >
              Danh bạ quán
            </Link>
            <Link
              href="/dashboard/billing"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white"
            >
              Nâng cấp qua VietQR
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl flex-1 px-4 py-12 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800">
            <Sparkles className="h-3.5 w-3.5" />
            Chi phí chỉ bằng 1 ly cà phê mỗi tháng
          </span>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900">
            Bảng Giá Minh Bạch Cho Mọi Cửa Hàng
          </h1>
          <p className="text-sm text-slate-600">
            Bắt đầu miễn phí trọn đời với 5 món. Nâng cấp bất cứ lúc nào qua mã VietQR tự động kích hoạt trong 3 giây.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(['free', 'basic', 'premium'] as PlanTier[]).map((tier) => {
            const cfg = PLAN_CONFIGS[tier];
            const isPremium = tier === 'premium';

            return (
              <div
                key={tier}
                className={`rounded-3xl border bg-white p-6 flex flex-col justify-between ${
                  isPremium
                    ? 'border-2 border-emerald-500 shadow-xl relative'
                    : 'border-slate-200 shadow-2xs'
                }`}
              >
                {cfg.badgeText && (
                  <span className="absolute -top-3 right-5 rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-black uppercase text-white">
                    {cfg.badgeText}
                  </span>
                )}

                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">
                      {cfg.name}
                    </h2>
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
                    {cfg.features.map((feat, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-xs font-medium text-slate-700"
                      >
                        <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-6">
                  <Link
                    href={tier === 'free' ? '/onboarding' : '/dashboard/billing'}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 px-4 text-xs font-black ${
                      isPremium
                        ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-500'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    <span>
                      {tier === 'free'
                        ? 'Tạo Cửa Hàng Miễn Phí'
                        : 'Chọn Gói & Thanh Toán VietQR'}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
