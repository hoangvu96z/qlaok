import React, { memo } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MobileCatalogItem,
  MobileFlashSaleConfig,
  MobilePromoBannerConfig,
} from '../../lib/supabase';
import {
  BRAND_COLOR_SWATCHES,
  MobileThemePalette,
  styles,
} from '../../styles/mobileStyles';
import { PhoneViewer } from '../PhoneViewer';

interface SettingsTabProps {
  editShopName: string;
  setEditShopName: (v: string) => void;
  editCity: string;
  setEditCity: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editWifiSsid: string;
  setEditWifiSsid: (v: string) => void;
  editWifiPass: string;
  setEditWifiPass: (v: string) => void;
  primaryColor: string;
  setPrimaryColor: (hex: string) => void;
  layoutMode: 'list' | 'grid';
  setLayoutMode: (m: 'list' | 'grid') => void;
  backgroundStyle: 'clean' | 'warm' | 'dark' | 'custom_image';
  setBackgroundStyle: (
    s: 'clean' | 'warm' | 'dark' | 'custom_image'
  ) => void;
  previewLang: string;
  onChangePreviewLang: (lang: string) => void;
  promoBanner: MobilePromoBannerConfig;
  flashSale: MobileFlashSaleConfig;
  items: MobileCatalogItem[];
  onSaveShopAndTheme: () => void;
  theme: MobileThemePalette;
}

export const SettingsTab = memo(function SettingsTab({
  editShopName,
  setEditShopName,
  editCity,
  setEditCity,
  editPhone,
  setEditPhone,
  editWifiSsid,
  setEditWifiSsid,
  editWifiPass,
  setEditWifiPass,
  primaryColor,
  setPrimaryColor,
  layoutMode,
  setLayoutMode,
  backgroundStyle,
  setBackgroundStyle,
  previewLang,
  onChangePreviewLang,
  promoBanner,
  flashSale,
  items,
  onSaveShopAndTheme,
  theme,
}: SettingsTabProps) {
  return (
    <View style={styles.sectionStack}>
      {/* Live Phone Viewer */}
      <PhoneViewer
        shopName={editShopName}
        primaryColor={primaryColor}
        layoutMode={layoutMode}
        backgroundStyle={backgroundStyle}
        previewLang={previewLang}
        onChangePreviewLang={onChangePreviewLang}
        promoBanner={promoBanner}
        flashSale={flashSale}
        items={items}
      />

      {/* Theme & Color Customizer */}
      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.cardHeading, { color: theme.text }]}>
          🎨 Giao Diện &amp; Màu Sắc Màn Hình Quán
        </Text>

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Màu chủ đạo
        </Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 6,
          }}
        >
          {BRAND_COLOR_SWATCHES.map((hex) => {
            const selected = primaryColor.toLowerCase() === hex.toLowerCase();
            return (
              <TouchableOpacity
                key={hex}
                onPress={() => setPrimaryColor(hex)}
                style={[
                  styles.colorCircle,
                  { backgroundColor: hex },
                  selected && styles.colorCircleActive,
                ]}
              >
                {selected && (
                  <Ionicons name="checkmark" size={16} color="#ffffff" />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Nền màn hình khách
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {[
            { id: 'clean', label: '☀️ Sáng' },
            { id: 'warm', label: '🏮 Kem Ấm' },
            { id: 'dark', label: '🌙 Tối' },
          ].map((bg) => {
            const active = backgroundStyle === bg.id;
            return (
              <TouchableOpacity
                key={bg.id}
                onPress={() =>
                  setBackgroundStyle(bg.id as 'clean' | 'warm' | 'dark')
                }
                style={[styles.choiceBtn, active && styles.choiceBtnActive]}
              >
                <Text
                  style={[
                    styles.choiceBtnText,
                    active && styles.choiceBtnTextActive,
                  ]}
                >
                  {bg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Bố cục hiển thị món
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <TouchableOpacity
            onPress={() => setLayoutMode('list')}
            style={[
              styles.choiceBtn,
              layoutMode === 'list' && styles.choiceBtnActive,
            ]}
          >
            <Text
              style={[
                styles.choiceBtnText,
                layoutMode === 'list' && styles.choiceBtnTextActive,
              ]}
            >
              Danh sách ngang
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setLayoutMode('grid')}
            style={[
              styles.choiceBtn,
              layoutMode === 'grid' && styles.choiceBtnActive,
            ]}
          >
            <Text
              style={[
                styles.choiceBtnText,
                layoutMode === 'grid' && styles.choiceBtnTextActive,
              ]}
            >
              Lưới ảnh 2 cột
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Basic Store Info & Wi-Fi */}
      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Ionicons
            name="storefront"
            size={16}
            color="#10b981"
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              styles.cardHeading,
              { marginBottom: 0, color: theme.text },
            ]}
          >
            Thông Tin Quán &amp; Wi-Fi 1 Chạm
          </Text>
        </View>

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Tên cửa hàng
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
          value={editShopName}
          onChangeText={setEditShopName}
        />

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Tỉnh / Thành phố
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
          value={editCity}
          onChangeText={setEditCity}
        />

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Số điện thoại / Zalo
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
          value={editPhone}
          onChangeText={setEditPhone}
        />

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Tên Wi-Fi (SSID)
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
          value={editWifiSsid}
          onChangeText={setEditWifiSsid}
        />

        <Text style={[styles.fieldLabel, { color: theme.subText }]}>
          Mật khẩu Wi-Fi
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
          value={editWifiPass}
          onChangeText={setEditWifiPass}
        />

        <TouchableOpacity
          style={styles.saveSettingsBtn}
          onPress={onSaveShopAndTheme}
        >
          <Text style={styles.saveSettingsBtnText}>Lưu Tất Cả Cài Đặt</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
