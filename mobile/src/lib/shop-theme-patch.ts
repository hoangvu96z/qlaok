import type {
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobilePromoBannerConfig,
  MobileShop,
  MobileShopThemeConfig,
} from './supabase.ts';

export type MobileCustomThemeLayout = 'list' | 'grid';
export type MobileCustomThemeBackgroundStyle =
  | 'clean'
  | 'warm'
  | 'dark'
  | 'custom_image';

export interface MobileCustomThemeValues {
  primaryColor: string;
  layout: MobileCustomThemeLayout;
  backgroundStyle: MobileCustomThemeBackgroundStyle;
}

export type MobileCustomThemePatch = Partial<
  Pick<MobileShopThemeConfig, 'primaryColor' | 'layout' | 'backgroundStyle'>
>;

export interface MobilePromotionsThemePatch {
  promoBanner: MobilePromoBannerConfig;
  welcomePopup: MobilePopupConfig;
  flashSale: MobileFlashSaleConfig;
}

export function resolveInitialMobileCustomTheme(
  themeConfig?: MobileShopThemeConfig | null,
  vertical?: MobileShop['vertical']
): MobileCustomThemeValues {
  return {
    primaryColor: themeConfig?.primaryColor || '#10b981',
    layout:
      themeConfig?.layout || (vertical === 'retail' ? 'grid' : 'list'),
    backgroundStyle: themeConfig?.backgroundStyle || 'clean',
  };
}

export function buildMobileCustomThemePatch(params: {
  currentTheme: MobileCustomThemeValues;
  activeShopThemeConfig?: MobileShopThemeConfig | null;
  activeShopVertical?: MobileShop['vertical'];
}): MobileCustomThemePatch | undefined {
  const initial = resolveInitialMobileCustomTheme(
    params.activeShopThemeConfig,
    params.activeShopVertical
  );
  const patch: MobileCustomThemePatch = {};

  if (params.currentTheme.primaryColor !== initial.primaryColor) {
    patch.primaryColor = params.currentTheme.primaryColor;
  }
  if (params.currentTheme.layout !== initial.layout) {
    patch.layout = params.currentTheme.layout;
  }
  if (params.currentTheme.backgroundStyle !== initial.backgroundStyle) {
    patch.backgroundStyle = params.currentTheme.backgroundStyle;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function buildMobileSettingsPatchPayload(params: {
  shopId: string;
  name: string;
  city: string;
  phoneContact: string;
  wifiSsid: string;
  wifiPassword: string;
  currentTheme: MobileCustomThemeValues;
  activeShopThemeConfig?: MobileShopThemeConfig | null;
  activeShopVertical?: MobileShop['vertical'];
}): {
  id: string;
  name: string;
  city: string;
  phone_contact: string;
  wifi_info: {
    ssid: string;
    password: string;
  };
  theme_config?: MobileCustomThemePatch;
} {
  const themePatch = buildMobileCustomThemePatch({
    currentTheme: params.currentTheme,
    activeShopThemeConfig: params.activeShopThemeConfig,
    activeShopVertical: params.activeShopVertical,
  });

  return {
    id: params.shopId,
    name: params.name.trim(),
    city: params.city.trim(),
    phone_contact: params.phoneContact.trim(),
    wifi_info: {
      ssid: params.wifiSsid.trim(),
      password: params.wifiPassword.trim(),
    },
    ...(themePatch ? { theme_config: themePatch } : {}),
  };
}

export function buildMobilePromotionsPatchPayload(params: {
  shopId: string;
  promoBanner: MobilePromoBannerConfig;
  welcomePopup: MobilePopupConfig;
  flashSale: MobileFlashSaleConfig;
}): {
  id: string;
  theme_config: MobilePromotionsThemePatch;
} {
  return {
    id: params.shopId,
    theme_config: {
      promoBanner: params.promoBanner,
      welcomePopup: {
        ...params.welcomePopup,
        voucherCode:
          params.promoBanner.voucherCode || params.welcomePopup.voucherCode,
      },
      flashSale: params.flashSale,
    },
  };
}
