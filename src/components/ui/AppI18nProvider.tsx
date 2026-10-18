'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  APP_LOCALES,
  APP_LOCALE_CHANGE_EVENT,
  APP_LOCALE_META,
  APP_LOCALE_STORAGE_KEY,
  AppLocale,
  AppTranslationKey,
  DEFAULT_APP_LOCALE,
  TranslationParams,
  bilingualText,
  getStoredAppLocale,
  normalizeAppLocale,
  setStoredAppLocale,
  translateApp,
} from '@/lib/app-i18n';

export interface AppI18nContextValue {
  locale: AppLocale;
  setLocale: (next: AppLocale | string) => void;
  toggleLocale: () => void;
  t: (key: AppTranslationKey, params?: TranslationParams) => string;
  tx: (
    viText: string,
    enText?: string | null,
    params?: TranslationParams
  ) => string;
}

const AppI18nContext = createContext<AppI18nContextValue>({
  locale: DEFAULT_APP_LOCALE,
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key, params) => translateApp(DEFAULT_APP_LOCALE, key, params),
  tx: (viText, enText, params) =>
    bilingualText(DEFAULT_APP_LOCALE, viText, enText, params),
});

export function AppI18nProvider({
  children,
  initialLocale = DEFAULT_APP_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: AppLocale;
}) {
  const pathname = usePathname();
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    const stored = getStoredAppLocale(undefined, initialLocale);
    setLocaleState(stored);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === APP_LOCALE_STORAGE_KEY || e.key === null) {
        const next = normalizeAppLocale(e.newValue);
        setLocaleState(next);
      }
    };

    const handleCustom = (e: Event) => {
      const custom = e as CustomEvent<AppLocale>;
      if (custom.detail) {
        const next = normalizeAppLocale(custom.detail);
        setLocaleState(next);
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(APP_LOCALE_CHANGE_EVENT, handleCustom);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(APP_LOCALE_CHANGE_EVENT, handleCustom);
    };
  }, [initialLocale]);

  useEffect(() => {
    // The customer menu has its own eight-language locale.
    if (!pathname?.startsWith('/s/')) document.documentElement.lang = locale;
  }, [locale, pathname]);

  const setLocale = useCallback((next: AppLocale | string) => {
    const normalized = setStoredAppLocale(next);
    setLocaleState(normalized);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'vi' ? 'en' : 'vi');
  }, [locale, setLocale]);

  const t = useCallback(
    (key: AppTranslationKey, params?: TranslationParams) =>
      translateApp(locale, key, params),
    [locale]
  );

  const tx = useCallback(
    (viText: string, enText?: string | null, params?: TranslationParams) =>
      bilingualText(locale, viText, enText, params),
    [locale]
  );

  const value = useMemo<AppI18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
      tx,
    }),
    [locale, setLocale, toggleLocale, t, tx]
  );

  return (
    <AppI18nContext.Provider value={value}>{children}</AppI18nContext.Provider>
  );
}

export function useAppI18n(): AppI18nContextValue {
  return useContext(AppI18nContext);
}

/**
 * Compact VI / EN language selector pill for dashboard, auth, onboarding, and admin headers.
 */
export function AppLanguageSwitcher({
  variant = 'light',
  className = '',
}: {
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const { locale, setLocale, t } = useAppI18n();

  const containerStyles =
    variant === 'dark'
      ? 'border-slate-700 bg-slate-900 text-slate-300'
      : 'border-slate-200 bg-slate-100/90 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      data-testid="app-language-switcher"
      className={`inline-flex shrink-0 items-center rounded-xl border p-0.5 text-[11px] font-black ${containerStyles} ${className}`}
    >
      {APP_LOCALES.map((loc) => {
        const active = locale === loc;
        const meta = APP_LOCALE_META[loc];
        const tooltip =
          loc === 'vi' ? t('common.switchToVi') : t('common.switchToEn');
        return (
          <button
            key={loc}
            type="button"
            onClick={() => setLocale(loc)}
            aria-pressed={active}
            aria-label={`${meta.nativeLabel} (${meta.shortLabel})`}
            title={tooltip}
            data-testid={`app-lang-${loc}`}
            className={`rounded-lg px-2 py-1 leading-none transition-all cursor-pointer ${
              active
                ? variant === 'dark'
                  ? 'bg-amber-400 text-slate-950 shadow-2xs'
                  : 'bg-emerald-600 text-white shadow-2xs'
                : variant === 'dark'
                  ? 'text-slate-400 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {meta.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
