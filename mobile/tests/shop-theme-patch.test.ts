import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildMobileCustomThemePatch,
  buildMobilePromotionsPatchPayload,
  buildMobileSettingsPatchPayload,
  resolveInitialMobileCustomTheme,
} from '../src/lib/shop-theme-patch.ts';
import type {
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobilePromoBannerConfig,
  MobileShopThemeConfig,
} from '../src/lib/supabase.ts';

const SAMPLE_PROMO_BANNER: MobilePromoBannerConfig = {
  enabled: true,
  badgeText: '🔥 GIẢM GIÁ SỐC',
  title: 'Giảm 20% toàn menu',
  subtitle: 'Áp dụng khi đặt qua QR tại bàn',
  bgGradient: 'amber_rose',
  ctaText: 'Đặt ngay',
  discountType: 'percent',
  discountValue: 20,
  minOrderAmount: 100000,
  applyScope: 'selected_items',
  selectedItemIds: ['item-1', 'item-2'],
  voucherCode: 'QR20',
};

const SAMPLE_WELCOME_POPUP: MobilePopupConfig = {
  enabled: true,
  badgeText: '🎁 QUÀ TẶNG MỚI',
  title: 'Tặng mã giảm giá khách mới',
  content: 'Nhập mã tại bước thanh toán',
  imageUrl: 'https://qlaok.vunph.click/popup.jpg',
  voucherCode: '',
  ctaText: 'Nhận mã ngay',
};

const SAMPLE_FLASH_SALE: MobileFlashSaleConfig = {
  enabled: true,
  badgeText: '⚡ GIỜ VÀNG',
  title: 'Flash Sale Buổi Trưa',
  discountType: 'fixed_amount',
  discountValue: 15000,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  startTime: '11:00',
  endTime: '14:00',
  itemIds: ['item-1'],
};

test('buildMobilePromotionsPatchPayload sends only promotion keys and preserves nested promotion fields without spreading existing theme_config', () => {
  const payload = buildMobilePromotionsPatchPayload({
    shopId: 'shop-mobile-001',
    promoBanner: SAMPLE_PROMO_BANNER,
    welcomePopup: SAMPLE_WELCOME_POPUP,
    flashSale: SAMPLE_FLASH_SALE,
  });

  assert.equal(payload.id, 'shop-mobile-001');
  assert.deepEqual(Object.keys(payload.theme_config).sort(), [
    'flashSale',
    'promoBanner',
    'welcomePopup',
  ]);
  assert.deepEqual(payload.theme_config.promoBanner, SAMPLE_PROMO_BANNER);
  assert.deepEqual(payload.theme_config.flashSale, SAMPLE_FLASH_SALE);
  assert.deepEqual(payload.theme_config.welcomePopup, {
    ...SAMPLE_WELCOME_POPUP,
    voucherCode: 'QR20',
  });
  assert.equal('primaryColor' in payload.theme_config, false);
  assert.equal('layout' in payload.theme_config, false);
  assert.equal('backgroundStyle' in payload.theme_config, false);
  assert.equal('paymentQr' in payload.theme_config, false);
});

test('buildMobileSettingsPatchPayload omits theme_config when custom-theme fields match hydrated defaults and sends only changed custom-theme keys', () => {
  const existingThemeWithoutBackgroundStyle: MobileShopThemeConfig = {
    primaryColor: '#10b981',
    layout: 'list',
    promoBanner: SAMPLE_PROMO_BANNER,
    paymentQr: {
      bankId: 'VCB',
      accountNo: '0123456789',
      accountName: 'NGUYEN VAN A',
    },
  };

  // 1. Hydrated initial state (where undefined backgroundStyle hydrates to 'clean')
  const hydratedTheme = resolveInitialMobileCustomTheme(
    existingThemeWithoutBackgroundStyle,
    'fnb'
  );
  assert.deepEqual(hydratedTheme, {
    primaryColor: '#10b981',
    layout: 'list',
    backgroundStyle: 'clean',
  });

  // 2. Saving basic info with untouched hydrated theme omits theme_config completely
  const basicInfoOnlyPayload = buildMobileSettingsPatchPayload({
    shopId: 'shop-mobile-001',
    name: '  Quán Phở Hội An  ',
    city: '  Đà Nẵng ',
    phoneContact: ' 0905111222 ',
    wifiSsid: ' PhoHoiAn_5G ',
    wifiPassword: ' 88888888 ',
    currentTheme: hydratedTheme,
    activeShopThemeConfig: existingThemeWithoutBackgroundStyle,
    activeShopVertical: 'fnb',
  });

  assert.deepEqual(basicInfoOnlyPayload, {
    id: 'shop-mobile-001',
    name: 'Quán Phở Hội An',
    city: 'Đà Nẵng',
    phone_contact: '0905111222',
    wifi_info: {
      ssid: 'PhoHoiAn_5G',
      password: '88888888',
    },
  });
  assert.equal('theme_config' in basicInfoOnlyPayload, false);

  // 3. Changing only primaryColor sends only { primaryColor } in theme_config
  const colorChangedPayload = buildMobileSettingsPatchPayload({
    shopId: 'shop-mobile-001',
    name: 'Quán Phở Hội An',
    city: 'Đà Nẵng',
    phoneContact: '0905111222',
    wifiSsid: 'PhoHoiAn_5G',
    wifiPassword: '88888888',
    currentTheme: {
      ...hydratedTheme,
      primaryColor: '#ea580c',
    },
    activeShopThemeConfig: existingThemeWithoutBackgroundStyle,
    activeShopVertical: 'fnb',
  });

  assert.deepEqual(colorChangedPayload.theme_config, {
    primaryColor: '#ea580c',
  });

  // 4. Retail vertical default layout ('grid') is respected when theme_config.layout is absent
  const retailHydrated = resolveInitialMobileCustomTheme({}, 'retail');
  assert.equal(retailHydrated.layout, 'grid');
  assert.equal(
    buildMobileCustomThemePatch({
      currentTheme: retailHydrated,
      activeShopThemeConfig: {},
      activeShopVertical: 'retail',
    }),
    undefined
  );
});

test('mobile/App.tsx uses buildMobilePromotionsPatchPayload and buildMobileSettingsPatchPayload without spreading activeShop.theme_config', () => {
  const appSource = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', 'App.tsx'),
    'utf8'
  );

  assert.match(appSource, /buildMobilePromotionsPatchPayload\(/);
  assert.match(appSource, /buildMobileSettingsPatchPayload\(/);
  assert.doesNotMatch(appSource, /\.\.\.existingTc/);
});
