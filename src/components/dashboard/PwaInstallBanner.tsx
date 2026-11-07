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
    <div className="mb-3 rounded-xl border border-emerald-800 bg-emerald-700 p-2.5 text-white shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-white">
              {t('installBanner.title')}
            </p>
            <p className="line-clamp-1 text-[10px] text-emerald-50">
              {t('installBanner.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {(deferredPrompt || isIos) && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-emerald-800 shadow-xs hover:bg-emerald-50 active:scale-95"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('installBanner.cta')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('installBanner.closeAria')}
            title={t('installBanner.closeAria')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-50 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showIosGuide && (
        <div className="mt-2 rounded-lg border border-white/20 bg-white/10 p-2.5 text-xs text-white flex items-center gap-2">
          <Share className="h-4 w-4 text-emerald-100 shrink-0" aria-hidden="true" />
          <span>{t('installBanner.iosGuide')}</span>
        </div>
      )}
    </div>
  );
}
