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
import { resolveMobilePromoPreview } from '../lib/promo-preview-i18n';
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

  const promoPreview = resolveMobilePromoPreview({
    previewLang,
    promoBanner,
    flashSale,
  });

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
              {promoPreview.badgeStr}
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
              {promoPreview.titleStr}
            </Text>
            {promoPreview.subStr ? (
              <Text style={{ fontSize: 10, color: '#ffedd5', marginTop: 1 }}>
                {promoPreview.subStr}
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
                ⚡ {promoPreview.flashTitleStr} (
                {promoPreview.flashDiscountLabel})
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '900',
                  color: '#fde047',
                }}
              >
                ⏱ {promoPreview.flashTimePrefix}: {promoPreview.flashTimeRange}
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
