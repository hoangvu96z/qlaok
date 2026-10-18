import React, { memo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  formatVnd,
  MobileCatalogItem,
  MobileFlashSaleConfig,
  MobilePromoBannerConfig,
} from '../lib/supabase';
import {
  ALL_8_LANGS,
  BANNER_GRADIENT_SWATCHES,
  styles,
} from '../styles/mobileStyles';
import { useMobileI18n } from './MobileI18nProvider';

interface PhoneViewerProps {
  shopName: string;
  primaryColor: string;
  layoutMode: 'list' | 'grid';
  backgroundStyle: 'clean' | 'warm' | 'dark' | 'custom_image';
  previewLang: string;
  onChangePreviewLang: (lang: string) => void;
  promoBanner: MobilePromoBannerConfig;
  flashSale: MobileFlashSaleConfig;
  items: MobileCatalogItem[];
}

const MOBILE_PROMO_I18N: Record<
  string,
  {
    promoBadge: string;
    promoTitle: (val: string, fallbackTitle: string) => string;
    promoSub: (fallbackSub?: string) => string;
    flashTitle: (fallbackFlash: string) => string;
    timePrefix: string;
  }
> = {
  vi: {
    promoBadge: '🔥 ƯU ĐÃI HÔM NAY',
    promoTitle: (_v, fallbackTitle) => fallbackTitle,
    promoSub: (fallbackSub) => fallbackSub || '',
    flashTitle: (fallbackFlash) => fallbackFlash || 'Giờ Vàng Giá Sốc',
    timePrefix: 'Khung giờ',
  },
  en: {
    promoBadge: '🔥 TODAY’S SPECIAL',
    promoTitle: (v) => `Get ${v} OFF on your order`,
    promoSub: () => 'Discount automatically applied at table checkout',
    flashTitle: () => 'Golden Hour Flash Sale',
    timePrefix: 'Time',
  },
  ko: {
    promoBadge: '🔥 오늘의 프로모션',
    promoTitle: (v) => `주문 시 ${v} 즉시 할인`,
    promoSub: () => '테이블 주문 시 할인이 자동 적용됩니다',
    flashTitle: () => '타임세일 한정 특가',
    timePrefix: '시간',
  },
  ja: {
    promoBadge: '🔥 本日のキャンペーン',
    promoTitle: (v) => `ご注文で ${v} 割引`,
    promoSub: () => 'ご注文時に割引が自動適用されます',
    flashTitle: () => '時間限定タイムセール',
    timePrefix: '時間',
  },
  zh: {
    promoBadge: '🔥 今日特惠活动',
    promoTitle: (v) => `扫码点餐立减 ${v}`,
    promoSub: () => '点餐结算时系统自动减免',
    flashTitle: () => '黄金时段限时秒杀',
    timePrefix: '时段',
  },
  es: {
    promoBadge: '🔥 OFERTA DE HOY',
    promoTitle: (v) => `${v} de descuento en tu pedido`,
    promoSub: () => 'Descuento aplicado automáticamente en mesa',
    flashTitle: () => 'Oferta Flash Hora Dorada',
    timePrefix: 'Horario',
  },
  it: {
    promoBadge: '🔥 PROMO DI OGGI',
    promoTitle: (v) => `Sconto di ${v} sul tuo ordine`,
    promoSub: () => 'Lo sconto viene applicato automaticamente al tavolo',
    flashTitle: () => 'Offerta Lampo Ora d’Oro',
    timePrefix: 'Orario',
  },
  ru: {
    promoBadge: '🔥 АКЦИЯ ДНЯ',
    promoTitle: (v) => `Скидка ${v} на ваш заказ`,
    promoSub: () => 'Скидка применяется автоматически при заказе',
    flashTitle: () => 'Flash-акция Счастливые часы',
    timePrefix: 'Время',
  },
};

export const PhoneViewer = memo(function PhoneViewer({
  shopName,
  primaryColor,
  layoutMode,
  backgroundStyle,
  previewLang,
  onChangePreviewLang,
  promoBanner,
  flashSale,
  items,
}: PhoneViewerProps) {
  const { t } = useMobileI18n();
  const previewSurfaceBg =
    backgroundStyle === 'dark'
      ? '#0f172a'
      : backgroundStyle === 'warm'
        ? '#fdf8ee'
        : '#ffffff';
  const previewTextCol = backgroundStyle === 'dark' ? '#f8fafc' : '#0f172a';

  const locText = MOBILE_PROMO_I18N[previewLang] || MOBILE_PROMO_I18N.vi;
  const discValStr =
    promoBanner.discountType === 'percent'
      ? `${promoBanner.discountValue || 15}%`
      : formatVnd(promoBanner.discountValue || 20000);

  const badgeStr =
    previewLang === 'vi'
      ? promoBanner.badgeText || locText.promoBadge
      : locText.promoBadge;
  const subStr = locText.promoSub(promoBanner.subtitle);

  return (
    <View
      style={[
        styles.phoneViewerFrame,
        { backgroundColor: previewSurfaceBg, borderColor: '#0f172a' },
      ]}
    >
      {/* Top Notch + Header */}
      <View style={styles.phoneViewerHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={[styles.phoneViewerLogo, { backgroundColor: primaryColor }]}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
              Q
            </Text>
          </View>
          <Text
            style={{ fontSize: 12, fontWeight: '900', color: '#0f172a' }}
            numberOfLines={1}
          >
            {shopName || t('preview.defaultShopName')}
          </Text>
        </View>
        <Text style={{ fontSize: 10, fontWeight: '800', color: '#10b981' }}>
          {t('preview.liveBadge')}
        </Text>
      </View>

      {/* 1-Tap 8-Language Flag Strip inside Viewer */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e2e8f0',
        }}
      >
        {ALL_8_LANGS.map((l) => {
          const active = previewLang === l.code;
          return (
            <TouchableOpacity
              key={l.code}
              onPress={() => onChangePreviewLang(l.code)}
              style={[
                styles.langPreviewPill,
                active && { backgroundColor: primaryColor },
              ]}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '800',
                  color: active ? '#ffffff' : '#334155',
                }}
              >
                {l.flag} {l.short}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Phone Body */}
      <View style={{ padding: 10, gap: 8 }}>
        {/* Promo Banner Preview */}
        {promoBanner.enabled && (
          <View
            style={[
              styles.previewBannerBox,
              {
                backgroundColor:
                  BANNER_GRADIENT_SWATCHES.find(
                    (s) => s.id === promoBanner.bgGradient
                  )?.hex || '#f97316',
              },
            ]}
          >
            <Text
              style={{
                fontSize: 9,
                fontWeight: '900',
                color: '#fef08a',
              }}
            >
              {badgeStr}
              {promoBanner.voucherCode ? ` • ${promoBanner.voucherCode}` : ''}
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '900',
                color: '#ffffff',
                marginTop: 2,
              }}
            >
              {locText.promoTitle(discValStr, promoBanner.title)}
            </Text>
            {subStr ? (
              <Text style={{ fontSize: 10, color: '#ffedd5', marginTop: 1 }}>
                {subStr}
              </Text>
            ) : null}
          </View>
        )}

        {/* Flash Sale Preview */}
        {flashSale.enabled && (
          <View style={styles.previewFlashBox}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '900',
                  color: '#ffffff',
                  flex: 1,
                }}
              >
                ⚡ {locText.flashTitle(flashSale.title)} (
                {flashSale.discountType === 'percent'
                  ? `-${flashSale.discountValue}%`
                  : `-${formatVnd(flashSale.discountValue)}`}
                )
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '900',
                  color: '#fde047',
                }}
              >
                ⏱ {locText.timePrefix}: {flashSale.startTime} -{' '}
                {flashSale.endTime}
              </Text>
            </View>
          </View>
        )}

        {/* Sample Menu Items inside Phone Viewer */}
        <View
          style={
            layoutMode === 'grid'
              ? { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
              : { gap: 6 }
          }
        >
          {items.slice(0, 2).map((it) => {
            const isFs = flashSale.enabled && flashSale.itemIds.includes(it.id);
            const isPromoSelected =
              promoBanner.enabled &&
              promoBanner.applyScope === 'selected_items' &&
              (promoBanner.selectedItemIds || []).includes(it.id);
            let effPrice = it.price;
            if (isFs) {
              effPrice =
                flashSale.discountType === 'percent'
                  ? Math.round(
                      (it.price * (100 - flashSale.discountValue)) / 100
                    )
                  : Math.max(0, it.price - flashSale.discountValue);
            } else if (isPromoSelected) {
              effPrice =
                promoBanner.discountType === 'percent'
                  ? Math.round(
                      (it.price * (100 - (promoBanner.discountValue || 0))) /
                        100
                    )
                  : Math.max(0, it.price - (promoBanner.discountValue || 0));
            }

            return (
              <View
                key={it.id}
                style={[
                  styles.previewItemRow,
                  layoutMode === 'grid' && { width: '48%' },
                  {
                    backgroundColor:
                      backgroundStyle === 'dark' ? '#1e293b' : '#ffffff',
                    borderColor:
                      backgroundStyle === 'dark' ? '#334155' : '#e2e8f0',
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: previewTextCol,
                    }}
                    numberOfLines={1}
                  >
                    {it.name_i18n?.[previewLang] || it.name_i18n?.vi}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 2,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '900',
                        color: primaryColor,
                      }}
                    >
                      {formatVnd(effPrice)}
                    </Text>
                    {effPrice < it.price && (
                      <Text
                        style={{
                          fontSize: 9,
                          color: '#94a3b8',
                          textDecorationLine: 'line-through',
                        }}
                      >
                        {formatVnd(it.price)}
                      </Text>
                    )}
                  </View>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    backgroundColor: primaryColor,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: '900',
                    }}
                  >
                    +
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
});
