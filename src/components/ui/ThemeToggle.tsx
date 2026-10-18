'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'qlaok_theme';
export const THEME_CHANGE_EVENT = 'qlaok_theme_change';

let inMemoryThemePreference: ThemePreference = 'light';

export function normalizeThemePreference(raw?: string | null): ThemePreference {
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return 'light';
}

export function getStoredThemePreference(
  storage?: Pick<Storage, 'getItem'> | null
): ThemePreference {
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!targetStorage) return 'light';
    const raw = targetStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      if (storage === undefined) {
        inMemoryThemePreference = raw;
      }
      return raw;
    }
    return 'light';
  } catch {
    return storage === undefined ? inMemoryThemePreference : 'light';
  }
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark?: boolean
): ThemeMode {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  if (typeof systemPrefersDark === 'boolean') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  }
  return 'light';
}

export function getInitialTheme(
  storage?: Pick<Storage, 'getItem'> | null,
  systemPrefersDark?: boolean
): ThemeMode {
  const pref = getStoredThemePreference(storage);
  return resolveEffectiveTheme(pref, systemPrefersDark);
}

export function applyThemeToDom(
  themeOrPreference: ThemePreference | ThemeMode,
  systemPrefersDark?: boolean
): ThemeMode {
  const pref = normalizeThemePreference(themeOrPreference);
  const resolved = resolveEffectiveTheme(pref, systemPrefersDark);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    }
    root.setAttribute('data-theme-preference', pref);
  }
  return resolved;
}

export function setThemePreference(
  next: ThemePreference,
  storage?: Pick<Storage, 'setItem'> | null,
  systemPrefersDark?: boolean
): ThemeMode {
  const pref = normalizeThemePreference(next);
  if (storage === undefined) {
    inMemoryThemePreference = pref;
  }
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (targetStorage) {
      targetStorage.setItem(THEME_STORAGE_KEY, pref);
    }
  } catch {
    // ignore storage getter or write errors
  }
  const resolved = applyThemeToDom(pref, systemPrefersDark);
  if (typeof window !== 'undefined' && storage === undefined) {
    try {
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, { detail: pref })
      );
    } catch {
      // ignore event dispatch errors in restricted environments
    }
  }
  return resolved;
}

export function ThemeToggle({
  className = '',
  compact = false,
  allowSystem = false,
}: {
  className?: string;
  compact?: boolean;
  allowSystem?: boolean;
}) {
  const { t, tx } = useAppI18n();
  const [preference, setPreference] = useState<ThemePreference>('light');
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const syncFromPreference = (pref: ThemePreference) => {
      const normalized = normalizeThemePreference(pref);
      setPreference(normalized);
      const effective = applyThemeToDom(normalized);
      setTheme(effective);
    };

    syncFromPreference(getStoredThemePreference());
    setMounted(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) {
        syncFromPreference(normalizeThemePreference(e.newValue));
      }
    };
    const onCustom = (e: Event) => {
      const customEvent = e as CustomEvent<ThemePreference | ThemeMode>;
      if (customEvent.detail) {
        syncFromPreference(normalizeThemePreference(customEvent.detail));
      }
    };

    const mql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const onMediaChange = (e: MediaQueryListEvent) => {
      const currentPref = getStoredThemePreference();
      if (currentPref === 'system') {
        const nextMode = applyThemeToDom('system', e.matches);
        setPreference('system');
        setTheme(nextMode);
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(THEME_CHANGE_EVENT, onCustom);
    if (mql) {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onMediaChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(onMediaChange);
      }
    }

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, onCustom);
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', onMediaChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(onMediaChange);
        }
      }
    };
  }, []);

  const toggleTheme = () => {
    let nextPref: ThemePreference;
    if (allowSystem) {
      nextPref =
        preference === 'light'
          ? 'dark'
          : preference === 'dark'
            ? 'system'
            : 'light';
    } else {
      nextPref = theme === 'dark' ? 'light' : 'dark';
    }
    const nextMode = setThemePreference(nextPref);
    setPreference(nextPref);
    setTheme(nextMode);
  };

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label={t('theme.toggleAria')}
        title={t('theme.toggleAria')}
        data-testid="theme-toggle"
        className={`inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs ${className}`}
      >
        <Sun className="h-3.5 w-3.5 text-amber-500" />
        {!compact && <span className="hidden sm:inline">{t('theme.light')}</span>}
      </button>
    );
  }

  const labelText =
    preference === 'system' && allowSystem
      ? tx('Hệ thống', 'System')
      : theme === 'dark'
        ? t('theme.dark')
        : t('theme.light');

  const tooltipText =
    theme === 'dark'
      ? t('theme.switchToLightTooltip')
      : t('theme.switchToDarkTooltip');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('theme.toggleAria')}
      aria-pressed={theme === 'dark'}
      title={tooltipText}
      data-testid="theme-toggle"
      data-theme-preference={preference}
      data-theme-mode={theme}
      className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-all active:scale-95 ${
        theme === 'dark'
          ? 'border-slate-700 bg-slate-800 text-amber-300 hover:border-amber-400 hover:bg-slate-700'
          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-slate-50 shadow-2xs'
      } ${className}`}
    >
      {preference === 'system' && allowSystem ? (
        <Monitor className="h-3.5 w-3.5 text-emerald-500" />
      ) : theme === 'dark' ? (
        <Sun className="h-3.5 w-3.5 text-amber-400" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-slate-600" />
      )}
      {!compact && <span className="hidden sm:inline">{labelText}</span>}
    </button>
  );
}
