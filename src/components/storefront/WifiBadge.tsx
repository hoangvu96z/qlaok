'use client';

import React, { useState } from 'react';
import { Wifi, Copy, Check } from 'lucide-react';
import { SupportedLocale, WifiInfo } from '@/types/qlaok';
import { UI_LABELS } from '@/lib/i18n-helper';
import { getContrastTextColor } from '@/lib/theme-contrast';

interface WifiBadgeProps {
  wifi: WifiInfo;
  shopId: string;
  locale: SupportedLocale;
  primaryColor?: string;
}

export function WifiBadge({
  wifi,
  shopId,
  locale,
  primaryColor = '#10b981',
}: WifiBadgeProps) {
  const [copied, setCopied] = useState(false);
  const labels = UI_LABELS[locale] || UI_LABELS.vi;
  const iconColor = getContrastTextColor(primaryColor);

  if (!wifi?.ssid) return null;

  const handleCopy = async () => {
    if (!wifi.password) return;
    try {
      await navigator.clipboard.writeText(wifi.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);

      // Fire analytics event in background
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          event_type: 'wifi_copy',
          visitor_lang: locale,
        }),
      }).catch(() => {});
    } catch {
      // Fallback copy
      const input = document.createElement('input');
      input.value = wifi.password;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm"
          style={{ backgroundColor: primaryColor, color: iconColor }}
        >
          <Wifi className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {labels.wifiTitle}
            </span>
          </div>
          <p className="truncate text-sm font-bold text-slate-900">
            {wifi.ssid}
          </p>
          {wifi.password && (
            <p className="truncate text-xs text-slate-500 font-mono">
              Pass: <span className="font-semibold text-slate-700">{wifi.password}</span>
            </p>
          )}
        </div>
      </div>

      {wifi.password && (
        <button
          type="button"
          onClick={handleCopy}
          className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
            copied
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
          }`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>{labels.copied}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>{labels.copyPassword}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
