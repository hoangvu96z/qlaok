import React, { memo, useState } from 'react';
import {
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatVnd,
  MobileCatalogItem,
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobilePromoBannerConfig,
} from '../../lib/supabase';
import {
  BANNER_GRADIENT_SWATCHES,
  MobileThemePalette,
  styles,
} from '../../styles/mobileStyles';
import { useMobileI18n } from '../MobileI18nProvider';
import { PhoneViewer } from '../PhoneViewer';

interface PromotionsTabProps {
  shopName: string;
  primaryColor: string;
  layoutMode: 'list' | 'grid';
  backgroundStyle: 'clean' | 'warm' | 'dark' | 'custom_image';
  previewLang: string;
  onChangePreviewLang: (lang: string) => void;
  promoBanner: MobilePromoBannerConfig;
  setPromoBanner: React.Dispatch<React.SetStateAction<MobilePromoBannerConfig>>;
  welcomePopup: MobilePopupConfig;
  setWelcomePopup: React.Dispatch<React.SetStateAction<MobilePopupConfig>>;
  flashSale: MobileFlashSaleConfig;
  setFlashSale: React.Dispatch<React.SetStateAction<MobileFlashSaleConfig>>;
  items: MobileCatalogItem[];
  onSaveShopAndTheme: () => void;
  theme: MobileThemePalette;
}

export const PromotionsTab = memo(function PromotionsTab({
  shopName,
  primaryColor,
  layoutMode,
  backgroundStyle,
  previewLang,
  onChangePreviewLang,
  promoBanner,
  setPromoBanner,
  welcomePopup,
  setWelcomePopup,
  flashSale,
  setFlashSale,
  items,
  onSaveShopAndTheme,
  theme,
}: PromotionsTabProps) {
  const { t } = useMobileI18n();
  const [promoSubTab, setPromoSubTab] = useState<'discount' | 'flash_sale'>(
    'discount'
  );

  const syncBannerRule = (next: MobilePromoBannerConfig) => {
    const valStr =
      next.discountType === 'percent'
        ? `${next.discountValue || 0}%`
        : formatVnd(next.discountValue || 0);
    const minStr =
      (next.minOrderAmount || 0) > 0
        ? ` cho đơn từ ${formatVnd(next.minOrderAmount || 0)}`
        : '';
    const scopeStr =
      next.applyScope === 'selected_items'
        ? ` (${(next.selectedItemIds || []).length} món ưu đãi)`
        : ' toàn thực đơn';

    const autoTitle = `Giảm ngay ${valStr}${minStr}`;
    const autoSub = `Áp dụng${scopeStr} khi đặt món qua QR`;

    setPromoBanner({
      ...next,
      title: autoTitle,
      subtitle: autoSub,
    });
    setWelcomePopup((prev) => ({
      ...prev,
      title: autoTitle,
      voucherCode: next.voucherCode || prev.voucherCode,
    }));
  };

  const toggleBannerSelectedItem = (itemId: string) => {
    const curr = promoBanner.selectedItemIds || [];
    const nextIds = curr.includes(itemId)
      ? curr.filter((id) => id !== itemId)
      : [...curr, itemId];
    syncBannerRule({
      ...promoBanner,
      selectedItemIds: nextIds,
    });
  };

  const toggleFlashSaleItem = (itemId: string) => {
    const curr = flashSale.itemIds || [];
    const nextIds = curr.includes(itemId)
      ? curr.filter((id) => id !== itemId)
      : [...curr, itemId];
    setFlashSale((prev) => ({
      ...prev,
      itemIds: nextIds,
    }));
  };

  return (
    <View style={styles.sectionStack}>
      {/* Live Phone Viewer at Top */}
      <PhoneViewer
        shopName={shopName}
        primaryColor={primaryColor}
        layoutMode={layoutMode}
        backgroundStyle={backgroundStyle}
        previewLang={previewLang}
        onChangePreviewLang={onChangePreviewLang}
        promoBanner={promoBanner}
        flashSale={flashSale}
        items={items}
      />

      {/* Sub-tab Switcher: Discount Banner vs Flash Sale */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          onPress={() => setPromoSubTab('discount')}
          style={[
            styles.subTabBtn,
            promoSubTab === 'discount' && {
              backgroundColor: '#0f172a',
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '900',
              color: promoSubTab === 'discount' ? '#ffffff' : '#475569',
            }}
          >
            {t('promo.subTabDiscount')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setPromoSubTab('flash_sale')}
          style={[
            styles.subTabBtn,
            promoSubTab === 'flash_sale' && {
              backgroundColor: '#e11d48',
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '900',
              color: promoSubTab === 'flash_sale' ? '#ffffff' : '#475569',
            }}
          >
            {t('promo.subTabFlashSale')}
          </Text>
        </TouchableOpacity>
      </View>

      {promoSubTab === 'discount' ? (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text style={[styles.cardHeading, { color: theme.text }]}>
              {t('promo.discountHeading')}
            </Text>
            <Switch
              value={promoBanner.enabled}
              onValueChange={(v: boolean) =>
                setPromoBanner((prev) => ({ ...prev, enabled: v }))
              }
              trackColor={{ false: '#cbd5e1', true: '#10b981' }}
            />
          </View>

          {/* Discount Type: % vs VND */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.discountTypeLabel')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() =>
                syncBannerRule({
                  ...promoBanner,
                  discountType: 'percent',
                  discountValue: 15,
                })
              }
              style={[
                styles.choiceBtn,
                promoBanner.discountType !== 'fixed_amount' &&
                  styles.choiceBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.choiceBtnText,
                  promoBanner.discountType !== 'fixed_amount' &&
                    styles.choiceBtnTextActive,
                ]}
              >
                {t('promo.discountTypePercent')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                syncBannerRule({
                  ...promoBanner,
                  discountType: 'fixed_amount',
                  discountValue: 20000,
                })
              }
              style={[
                styles.choiceBtn,
                promoBanner.discountType === 'fixed_amount' &&
                  styles.choiceBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.choiceBtnText,
                  promoBanner.discountType === 'fixed_amount' &&
                    styles.choiceBtnTextActive,
                ]}
              >
                {t('promo.discountTypeFixed')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Discount Value Chips */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.quickDiscountLabel')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(promoBanner.discountType === 'fixed_amount'
              ? [10000, 20000, 30000, 50000]
              : [10, 15, 20, 30]
            ).map((val) => {
              const active = promoBanner.discountValue === val;
              return (
                <TouchableOpacity
                  key={val}
                  onPress={() =>
                    syncBannerRule({
                      ...promoBanner,
                      discountValue: val,
                    })
                  }
                  style={[
                    styles.miniChip,
                    active && { backgroundColor: '#10b981' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: active ? '#ffffff' : '#334155',
                    }}
                  >
                    {promoBanner.discountType === 'fixed_amount'
                      ? `-${val / 1000}k`
                      : `-${val}%`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Min Order Chips */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.minOrderLabel')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: t('promo.minOrder0'), val: 0 },
              { label: t('promo.minOrder50k'), val: 50000 },
              { label: t('promo.minOrder100k'), val: 100000 },
              { label: t('promo.minOrder200k'), val: 200000 },
            ].map((chip) => {
              const active = (promoBanner.minOrderAmount || 0) === chip.val;
              return (
                <TouchableOpacity
                  key={chip.val}
                  onPress={() =>
                    syncBannerRule({
                      ...promoBanner,
                      minOrderAmount: chip.val,
                    })
                  }
                  style={[
                    styles.miniChip,
                    active && { backgroundColor: '#0f172a' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: active ? '#ffffff' : '#334155',
                    }}
                  >
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Apply Scope: All vs Selected Items */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.scopeLabel')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() =>
                syncBannerRule({ ...promoBanner, applyScope: 'all' })
              }
              style={[
                styles.choiceBtn,
                promoBanner.applyScope !== 'selected_items' &&
                  styles.choiceBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.choiceBtnText,
                  promoBanner.applyScope !== 'selected_items' &&
                    styles.choiceBtnTextActive,
                ]}
              >
                {t('promo.scopeAll')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                syncBannerRule({
                  ...promoBanner,
                  applyScope: 'selected_items',
                })
              }
              style={[
                styles.choiceBtn,
                promoBanner.applyScope === 'selected_items' &&
                  styles.choiceBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.choiceBtnText,
                  promoBanner.applyScope === 'selected_items' &&
                    styles.choiceBtnTextActive,
                ]}
              >
                {t('promo.scopeSelected', {
                  count: (promoBanner.selectedItemIds || []).length,
                })}
              </Text>
            </TouchableOpacity>
          </View>

          {promoBanner.applyScope === 'selected_items' && (
            <View style={{ gap: 6, marginTop: 8 }}>
              {items.map((it) => {
                const checked = (promoBanner.selectedItemIds || []).includes(
                  it.id
                );
                return (
                  <TouchableOpacity
                    key={it.id}
                    onPress={() => toggleBannerSelectedItem(it.id)}
                    style={[
                      styles.selectableItemRow,
                      checked && {
                        borderColor: '#10b981',
                        backgroundColor: '#ecfdf5',
                      },
                    ]}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={checked ? '#10b981' : '#94a3b8'}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 12,
                        fontWeight: '700',
                        color: '#0f172a',
                      }}
                    >
                      {it.name_i18n?.vi}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: '#059669',
                      }}
                    >
                      {formatVnd(it.price)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Pure Round Banner Color Swatches */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.bannerColorLabel')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            {BANNER_GRADIENT_SWATCHES.map((sw) => {
              const active = promoBanner.bgGradient === sw.id;
              return (
                <TouchableOpacity
                  key={sw.id}
                  onPress={() =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      bgGradient: sw.id,
                    }))
                  }
                  style={[
                    styles.colorCircle,
                    { backgroundColor: sw.hex },
                    active && styles.colorCircleActive,
                  ]}
                >
                  {active && (
                    <Ionicons name="checkmark" size={16} color="#ffffff" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Welcome Popup Toggle */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 14,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: theme.border,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '800',
                color: theme.text,
                flex: 1,
              }}
            >
              {t('promo.welcomePopupLabel')}
            </Text>
            <Switch
              value={welcomePopup.enabled}
              onValueChange={(v: boolean) =>
                setWelcomePopup((prev) => ({ ...prev, enabled: v }))
              }
              trackColor={{ false: '#cbd5e1', true: '#10b981' }}
            />
          </View>

          <TouchableOpacity
            style={styles.saveSettingsBtn}
            onPress={onSaveShopAndTheme}
          >
            <Text style={styles.saveSettingsBtnText}>
              {t('promo.savePromosBtn')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text style={[styles.cardHeading, { color: theme.text }]}>
              {t('promo.flashHeading')}
            </Text>
            <Switch
              value={flashSale.enabled}
              onValueChange={(v: boolean) =>
                setFlashSale((prev) => ({ ...prev, enabled: v }))
              }
              trackColor={{ false: '#cbd5e1', true: '#e11d48' }}
            />
          </View>

          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.flashDiscountLabel')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[15, 20, 25, 30, 50].map((pct) => {
              const active =
                flashSale.discountType === 'percent' &&
                flashSale.discountValue === pct;
              return (
                <TouchableOpacity
                  key={pct}
                  onPress={() =>
                    setFlashSale((prev) => ({
                      ...prev,
                      discountType: 'percent',
                      discountValue: pct,
                    }))
                  }
                  style={[
                    styles.miniChip,
                    active && { backgroundColor: '#e11d48' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: active ? '#ffffff' : '#334155',
                    }}
                  >
                    -{pct}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Multi-Day Date Range Presets */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.flashDurationLabel')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 4,
            }}
          >
            {[
              { label: t('promo.presetToday'), days: 0 },
              { label: t('promo.preset3Days'), days: 2 },
              { label: t('promo.preset7Days'), days: 6 },
              { label: t('promo.preset14Days'), days: 13 },
              { label: t('promo.preset30Days'), days: 29 },
            ].map((preset) => {
              const formatLocalDate = (d: Date) =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const dStart = new Date();
              const startIso = formatLocalDate(dStart);
              const dEnd = new Date();
              dEnd.setDate(dEnd.getDate() + preset.days);
              const endIso = formatLocalDate(dEnd);
              const isActive =
                flashSale.startDate === startIso &&
                flashSale.endDate === endIso;
              return (
                <TouchableOpacity
                  key={preset.days}
                  onPress={() =>
                    setFlashSale((prev) => ({
                      ...prev,
                      startDate: startIso,
                      endDate: endIso,
                    }))
                  }
                  style={[
                    styles.miniChip,
                    isActive && { backgroundColor: '#e11d48' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '800',
                      color: isActive ? '#ffffff' : '#334155',
                    }}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                {t('promo.startDateLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.subCard,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={flashSale.startDate}
                onChangeText={(d: string) =>
                  setFlashSale((prev) => ({ ...prev, startDate: d }))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                {t('promo.endDateLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.subCard,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={flashSale.endDate}
                onChangeText={(d: string) =>
                  setFlashSale((prev) => ({ ...prev, endDate: d }))
                }
              />
            </View>
          </View>

          {/* Quick Time Slot Presets */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.timeSlotLabel')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 4,
            }}
          >
            {[
              { label: t('promo.slotLunch'), s: '11:00', e: '14:00' },
              { label: t('promo.slotAfternoon'), s: '14:00', e: '17:00' },
              { label: t('promo.slotEvening'), s: '18:00', e: '22:00' },
              { label: t('promo.slotAllDay'), s: '00:00', e: '23:45' },
            ].map((slot) => {
              const isActive =
                flashSale.startTime === slot.s && flashSale.endTime === slot.e;
              return (
                <TouchableOpacity
                  key={slot.s}
                  onPress={() =>
                    setFlashSale((prev) => ({
                      ...prev,
                      startTime: slot.s,
                      endTime: slot.e,
                    }))
                  }
                  style={[
                    styles.miniChip,
                    isActive && { backgroundColor: '#0f172a' },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '800',
                      color: isActive ? '#ffffff' : '#334155',
                    }}
                  >
                    {slot.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                {t('promo.startTimeLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.subCard,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={flashSale.startTime}
                onChangeText={(tVal: string) =>
                  setFlashSale((prev) => ({ ...prev, startTime: tVal }))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                {t('promo.endTimeLabel')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.subCard,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                value={flashSale.endTime}
                onChangeText={(tVal: string) =>
                  setFlashSale((prev) => ({ ...prev, endTime: tVal }))
                }
              />
            </View>
          </View>

          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            {t('promo.selectFlashItemsLabel', {
              count: flashSale.itemIds.length,
            })}
          </Text>
          <View style={{ gap: 6, marginTop: 6 }}>
            {items.map((it) => {
              const checked = flashSale.itemIds.includes(it.id);
              const salePrice = Math.max(
                0,
                Math.round((it.price * (100 - flashSale.discountValue)) / 100)
              );
              return (
                <TouchableOpacity
                  key={it.id}
                  onPress={() => toggleFlashSaleItem(it.id)}
                  style={[
                    styles.selectableItemRow,
                    checked && {
                      borderColor: '#e11d48',
                      backgroundColor: '#fff1f2',
                    },
                  ]}
                >
                  <Ionicons
                    name={checked ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={checked ? '#e11d48' : '#94a3b8'}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: '700',
                      color: '#0f172a',
                    }}
                  >
                    {it.name_i18n?.vi}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '900',
                      color: '#e11d48',
                    }}
                  >
                    ⚡ {formatVnd(salePrice)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.saveSettingsBtn, { backgroundColor: '#e11d48' }]}
            onPress={onSaveShopAndTheme}
          >
            <Text style={styles.saveSettingsBtnText}>
              {t('promo.saveFlashBtn')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});
