'use client';

import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'qlaok_theme';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return 'light';
}

export function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.setAttribute('data-theme', 'light');
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyThemeToDom(initial);
    setMounted(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
        applyThemeToDom(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      const customEvent = e as CustomEvent<ThemeMode>;
      if (customEvent.detail) {
        setTheme(customEvent.detail);
        applyThemeToDom(customEvent.detail);
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('qlaok_theme_change', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('qlaok_theme_change', onCustom);
    };
  }, []);

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next);
      applyThemeToDom(next);
      window.dispatchEvent(new CustomEvent('qlaok_theme_change', { detail: next }));
    }
  };

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Đổi giao diện Sáng / Tối"
        className={`inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs ${className}`}
      >
        <Sun className="h-3.5 w-3.5 text-amber-500" />
        <span>Sáng</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Chuyển sang giao diện Sáng (Light Mode)' : 'Chuyển sang giao diện Tối (Dark Mode)'}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
        theme === 'dark'
          ? 'border-slate-700 bg-slate-800 text-amber-300 hover:border-amber-400 hover:bg-slate-700'
          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400 hover:bg-slate-50 shadow-2xs'
      } ${className}`}
    >
      {theme === 'dark' ? (
        <>
          <Sun className="h-3.5 w-3.5 text-amber-400" />
          <span>Giao diện: Tối</span>
        </>
      ) : (
        <>
          <Moon className="h-3.5 w-3.5 text-slate-600" />
          <span>Giao diện: Sáng</span>
        </>
      )}
    </button>
  );
}
