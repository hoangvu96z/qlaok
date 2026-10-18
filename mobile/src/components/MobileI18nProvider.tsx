import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  bilingualMobileText,
  DEFAULT_MOBILE_LOCALE,
  getStoredMobileLocale,
  loadPersistedMobileLocale,
  MOBILE_LOCALE_META,
  MOBILE_LOCALES,
  type MobileLocale,
  type MobileTranslationKey,
  type MobileTranslationParams,
  normalizeMobileLocale,
  savePersistedMobileLocale,
  translateMobile,
} from '../lib/mobile-i18n';

export interface MobileI18nContextValue {
  locale: MobileLocale;
  setLocale: (next: MobileLocale | string) => void;
  toggleLocale: () => void;
  t: (
    key: MobileTranslationKey,
    params?: MobileTranslationParams
  ) => string;
  tb: (
    viText: string,
    enText?: string | null,
    params?: MobileTranslationParams
  ) => string;
}

const nativeStorageAdapter =
  Platform.OS !== 'web'
    ? {
        getItem: (key: string) => SecureStore.getItemAsync(key),
        setItem: (key: string, value: string) =>
          SecureStore.setItemAsync(key, value),
      }
    : null;

const MobileI18nContext = createContext<MobileI18nContextValue | null>(null);

export function MobileI18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: MobileLocale;
}) {
  const [locale, setLocaleState] = useState<MobileLocale>(() =>
    initialLocale
      ? normalizeMobileLocale(initialLocale)
      : getStoredMobileLocale(undefined, DEFAULT_MOBILE_LOCALE)
  );

  useEffect(() => {
    if (initialLocale) return;
    let alive = true;
    loadPersistedMobileLocale(nativeStorageAdapter, DEFAULT_MOBILE_LOCALE).then(
      (saved) => {
        if (alive) {
          setLocaleState(saved);
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [initialLocale]);

  const setLocale = useCallback((next: MobileLocale | string) => {
    const normalized = normalizeMobileLocale(next, DEFAULT_MOBILE_LOCALE);
    setLocaleState(normalized);
    void savePersistedMobileLocale(normalized, nativeStorageAdapter);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'vi' ? 'en' : 'vi');
  }, [locale, setLocale]);

  const t = useCallback(
    (
      key: MobileTranslationKey,
      params?: MobileTranslationParams
    ): string => translateMobile(locale, key, params),
    [locale]
  );

  const tb = useCallback(
    (
      viText: string,
      enText?: string | null,
      params?: MobileTranslationParams
    ): string => bilingualMobileText(locale, viText, enText, params),
    [locale]
  );

  const value = useMemo<MobileI18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
      tb,
    }),
    [locale, setLocale, toggleLocale, t, tb]
  );

  return (
    <MobileI18nContext.Provider value={value}>
      {children}
    </MobileI18nContext.Provider>
  );
}

export function useMobileI18n(): MobileI18nContextValue {
  const context = useContext(MobileI18nContext);
  if (context) return context;
  const fallbackLocale = getStoredMobileLocale(undefined, DEFAULT_MOBILE_LOCALE);
  return {
    locale: fallbackLocale,
    setLocale: (next: MobileLocale | string) => {
      void savePersistedMobileLocale(next, nativeStorageAdapter);
    },
    toggleLocale: () => {
      const next: MobileLocale = fallbackLocale === 'vi' ? 'en' : 'vi';
      void savePersistedMobileLocale(next, nativeStorageAdapter);
    },
    t: (key, params) => translateMobile(fallbackLocale, key, params),
    tb: (viText, enText, params) =>
      bilingualMobileText(fallbackLocale, viText, enText, params),
  };
}

interface MobileLanguageSwitcherProps {
  variant?: 'compact' | 'dark' | 'full';
}

export const MobileLanguageSwitcher = memo(function MobileLanguageSwitcher({
  variant = 'compact',
}: MobileLanguageSwitcherProps) {
  const { locale, setLocale, t } = useMobileI18n();
  const isDarkSurface = variant === 'dark';

  if (variant === 'full') {
    return (
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {MOBILE_LOCALES.map((code) => {
          const active = locale === code;
          const meta = MOBILE_LOCALE_META[code];
          return (
            <TouchableOpacity
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                code === 'vi' ? t('common.switchToVi') : t('common.switchToEn')
              }
              onPress={() => setLocale(code)}
              style={{
                flex: 1,
                paddingVertical: 9,
                paddingHorizontal: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: active ? '#10b981' : '#cbd5e1',
                backgroundColor: active ? '#ecfdf5' : '#f1f5f9',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: active ? '#065f46' : '#475569',
                }}
              >
                {meta.shortLabel} • {meta.nativeLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('common.language')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: isDarkSurface ? '#334155' : '#cbd5e1',
        backgroundColor: isDarkSurface ? '#020617' : '#f1f5f9',
        padding: 2,
      }}
    >
      {MOBILE_LOCALES.map((code) => {
        const active = locale === code;
        const meta = MOBILE_LOCALE_META[code];
        return (
          <TouchableOpacity
            key={code}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              code === 'vi' ? t('common.switchToVi') : t('common.switchToEn')
            }
            onPress={() => setLocale(code)}
            style={{
              paddingHorizontal: 7,
              paddingVertical: 4,
              borderRadius: 8,
              backgroundColor: active ? '#10b981' : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 10,
                fontWeight: '900',
                color: active
                  ? '#ffffff'
                  : isDarkSurface
                    ? '#cbd5e1'
                    : '#475569',
              }}
            >
              {meta.shortLabel}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});
