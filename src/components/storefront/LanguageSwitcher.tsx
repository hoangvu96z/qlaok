'use client';

import React from 'react';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';
import { SupportedLocale } from '@/types/qlaok';

interface LanguageSwitcherProps {
  currentLocale: SupportedLocale;
  supportedLangs?: SupportedLocale[];
  onChange: (locale: SupportedLocale) => void;
  compact?: boolean;
}

export function LanguageSwitcher({
  currentLocale,
  supportedLangs = ALL_LOCALES,
  onChange,
  compact = false,
}: LanguageSwitcherProps) {
  const available =
    supportedLangs.length > 0 ? supportedLangs : (['vi'] as SupportedLocale[]);

  const handleSelect = (loc: SupportedLocale) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('qlaok_lang', loc);
    }
    onChange(loc);
  };

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-full bg-slate-100/90 p-1 border border-slate-200/80"
      role="group"
      aria-label="Language Switcher"
    >
      {ALL_LOCALES.map((loc) => {
        const meta = LOCALE_META[loc];
        const isSupported = available.includes(loc);
        const isActive = currentLocale === loc;

        if (!isSupported) return null;

        return (
          <button
            key={loc}
            type="button"
            onClick={() => handleSelect(loc)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
              isActive
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
            title={meta.nativeName}
          >
            <span className="text-sm leading-none">{meta.flag}</span>
            <span>{compact ? meta.short : meta.nativeName}</span>
          </button>
        );
      })}
    </div>
  );
}
