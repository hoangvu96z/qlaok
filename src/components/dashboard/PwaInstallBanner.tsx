'use client';

import React, { useEffect, useState } from 'react';
import { Smartphone, Download, X, Share } from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaInstallBanner() {
  const { t } = useAppI18n();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // ignore sw registration errors in dev
      });
    }

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    setIsStandalone(standalone);

    try {
      const hidden = localStorage.getItem('qlaok_pwa_banner_dismissed') === '1';
      setDismissed(hidden);
    } catch {
      // ignore storage errors
    }

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (isStandalone || dismissed) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIos) {
      setShowIosGuide((prev) => !prev);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qlaok_pwa_banner_dismissed', '1');
      } catch {
        // ignore storage errors
      }
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50 p-3.5 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-slate-900">
              {t('installBanner.title')}
            </p>
            <p className="text-[11px] text-slate-600 truncate">
              {t('installBanner.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(deferredPrompt || isIos) && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-500 active:scale-95"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t('installBanner.cta')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('installBanner.closeAria')}
            title={t('installBanner.closeAria')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showIosGuide && (
        <div className="mt-2.5 rounded-xl bg-slate-900 p-3 text-xs text-slate-200 flex items-center gap-2">
          <Share className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{t('installBanner.iosGuide')}</span>
        </div>
      )}
    </div>
  );
}
