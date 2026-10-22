'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { ALL_LOCALES, LOCALE_META, UI_LABELS } from '@/lib/i18n-helper';
import { SupportedLocale } from '@/types/qlaok';
import { FlagIcon } from '@/components/ui/FlagIcon';

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
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const available =
    supportedLangs && supportedLangs.length > 1
      ? supportedLangs
      : ALL_LOCALES;

  const activeMeta = LOCALE_META[currentLocale] || LOCALE_META.vi;
  const labels = UI_LABELS[currentLocale] || UI_LABELS.vi;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSelect = (loc: SupportedLocale) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('qlaok_lang', loc);
    }
    onChange(loc);
    setOpen(false);
  };

  if (compact) {
    return (
      <div ref={dropdownRef} className="relative z-50 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
          className="qr-light-surface inline-flex items-center gap-1.5 rounded-full border-2 border-emerald-500/70 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-900 shadow-sm hover:border-emerald-600 active:scale-95 transition"
          aria-label={labels.selectLanguageAria}
        >
          <Globe className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <FlagIcon locale={currentLocale} className="h-3.5 w-5 shrink-0" />
          <span>{activeMeta.nativeName}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open && (
          <div
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            className="qr-light-surface absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ring-1 ring-black/5 z-50"
          >
            <div className="px-2.5 py-1.5 border-b border-slate-100 mb-1 flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                🌐 {labels.selectLanguageTitle}
              </span>
              <span className="text-[10px] font-bold text-emerald-600">
                {labels.languagesCount(available.length)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 max-h-72 overflow-y-auto">
              {ALL_LOCALES.map((loc) => {
                if (!available.includes(loc)) return null;
                const meta = LOCALE_META[loc];
                const isActive = currentLocale === loc;

                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => handleSelect(loc)}
                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <FlagIcon locale={loc} className="h-4 w-5.5 shrink-0" />
                      <span>{meta.nativeName}</span>
                      <span className="text-[10px] font-medium text-slate-400">
                        ({meta.short})
                      </span>
                    </span>
                    {isActive && (
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="qr-light-surface flex items-center gap-1 overflow-x-auto no-scrollbar rounded-full bg-slate-100/95 p-1 border border-slate-200/80"
      role="group"
      aria-label={labels.selectLanguageAria}
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
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-all whitespace-nowrap ${
              isActive
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-700 hover:text-slate-950 hover:bg-white'
            }`}
            title={meta.nativeName}
          >
            <FlagIcon locale={loc} className="h-3.5 w-5" />
            <span>{meta.nativeName}</span>
          </button>
        );
      })}
    </div>
  );
}
