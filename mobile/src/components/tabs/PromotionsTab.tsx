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
            🔥 Giảm Giá &amp; Banner
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
            ⚡ Flash Sale Giờ Vàng
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
              🔥 Giảm Giá Hóa Đơn / Theo Món
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
            Hình thức giảm giá
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
                Giảm theo %
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
                Giảm số tiền (đ)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Discount Value Chips */}
          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            Mức giảm nhanh
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
            Đơn tối thiểu
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: '0đ (Mọi đơn)', val: 0 },
              { label: 'Từ 50k', val: 50000 },
              { label: 'Từ 100k', val: 100000 },
              { label: 'Từ 200k', val: 200000 },
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
            Phạm vi áp dụng
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
                Toàn bộ Menu
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
                Chọn món ({(promoBanner.selectedItemIds || []).length})
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
            Màu Banner
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
              🎁 Bật thêm Popup Chào Mừng khi khách quét QR
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
              Lưu &amp; Áp Dụng Khuyến Mãi
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
              ⚡ Flash Sale Giờ Vàng
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
            Mức giảm Flash Sale (%)
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
            📅 Thời hạn chiến dịch Flash Sale (Nhiều ngày)
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
              { label: 'Chỉ hôm nay', days: 0 },
              { label: '3 Ngày tới', days: 2 },
              { label: '7 Ngày', days: 6 },
              { label: '14 Ngày', days: 13 },
              { label: '30 Ngày', days: 29 },
            ].map((preset) => {
              const dStart = new Date();
              const startIso = dStart.toISOString().slice(0, 10);
              const dEnd = new Date();
              dEnd.setDate(dEnd.getDate() + preset.days);
              const endIso = dEnd.toISOString().slice(0, 10);
              const isActive =
                flashSale.startDate === startIso &&
                flashSale.endDate === endIso;
              return (
                <TouchableOpacity
                  key={preset.label}
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
                Từ ngày (YYYY-MM-DD)
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
                Đến hết ngày (YYYY-MM-DD)
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
            ⏰ Khung giờ vàng mỗi ngày
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
              { label: '🍱 Trưa 11:00–14:00', s: '11:00', e: '14:00' },
              { label: '🧋 Chiều 14:00–17:00', s: '14:00', e: '17:00' },
              { label: '🍻 Tối 18:00–22:00', s: '18:00', e: '22:00' },
              { label: '🔥 Cả ngày 00:00–23:45', s: '00:00', e: '23:45' },
            ].map((slot) => {
              const isActive =
                flashSale.startTime === slot.s && flashSale.endTime === slot.e;
              return (
                <TouchableOpacity
                  key={slot.label}
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
                Giờ bắt đầu
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
                onChangeText={(t: string) =>
                  setFlashSale((prev) => ({ ...prev, startTime: t }))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                Giờ kết thúc
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
                onChangeText={(t: string) =>
                  setFlashSale((prev) => ({ ...prev, endTime: t }))
                }
              />
            </View>
          </View>

          <Text style={[styles.fieldLabel, { color: theme.subText }]}>
            Tích chọn sản phẩm chạy Flash Sale ({flashSale.itemIds.length} món):
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
              Lưu &amp; Kích Hoạt Flash Sale
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});
