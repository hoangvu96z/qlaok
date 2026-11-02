import { ALL_LOCALES } from '@/lib/i18n-helper';
import type {
  BusinessVertical,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';

const SHOP_CREATE_FIELDS = [
  'name',
  'slug',
  'vertical',
  'tagline_i18n',
  'description_i18n',
  'logo_url',
  'cover_urls',
  'address',
  'city',
  'google_maps_url',
  'google_review_url',
  'phone_contact',
  'zalo_phone',
  'telegram_chat_id',
  'wifi_info',
  'opening_hours',
  'supported_langs',
  'currency',
  'theme_config',
  'is_published',
] as const;

const SHOP_THEME_FIELDS = [
  'primaryColor',
  'layout',
  'fontStyle',
  'backgroundStyle',
  'backgroundImageUrl',
  'backgroundOverlayOpacity',
  'promoBanner',
  'flashSale',
  'welcomePopup',
  'paymentConfig',
  'paymentQr',
  'orderWorkflow',
  'labelPrintConfig',
  'serviceRequestNotificationRule',
] as const satisfies readonly (keyof ShopThemeConfig)[];

const CUSTOM_THEME_FIELDS = [
  'primaryColor',
  'layout',
  'backgroundStyle',
  'backgroundImageUrl',
  'backgroundOverlayOpacity',
] as const;

const VERTICALS = ['fnb', 'service', 'retail'] as const;

export type ShopCreationInput = {
  payload: Record<string, unknown> & {
    vertical: BusinessVertical;
    supported_langs: SupportedLocale[];
    theme_config: ShopThemeConfig;
  };
  customThemeChanged: boolean;
};

export type ShopCreationInputResult =
  | ({ valid: true } & ShopCreationInput)
  | { valid: false; code: string; error: string };

export function getDefaultShopThemeConfig(
  vertical: BusinessVertical
): ShopThemeConfig {
  return {
    primaryColor:
      vertical === 'service'
        ? '#8b5cf6'
        : vertical === 'retail'
          ? '#f59e0b'
          : '#10b981',
    layout: vertical === 'retail' ? 'grid' : 'list',
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeShopCreationInput(
  raw: unknown
): ShopCreationInputResult {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      code: 'INVALID_SHOP_PAYLOAD',
      error: 'Thông tin cửa hàng không hợp lệ.',
    };
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  const vertical = raw.vertical ?? 'fnb';
  if (!name || !slug || !VERTICALS.includes(vertical as BusinessVertical)) {
    return {
      valid: false,
      code: 'INVALID_SHOP_PAYLOAD',
      error: 'Tên, đường dẫn hoặc ngành hàng của cửa hàng không hợp lệ.',
    };
  }

  const rawLocales = raw.supported_langs ?? ['vi'];
  if (
    !Array.isArray(rawLocales) ||
    rawLocales.length === 0 ||
    rawLocales.some(
      (locale) =>
        typeof locale !== 'string' ||
        !ALL_LOCALES.includes(locale as SupportedLocale)
    )
  ) {
    return {
      valid: false,
      code: 'INVALID_SUPPORTED_LANGS',
      error: 'Danh sách ngôn ngữ cửa hàng không hợp lệ.',
    };
  }

  const resolvedVertical = vertical as BusinessVertical;
  const defaultTheme = getDefaultShopThemeConfig(resolvedVertical);
  const rawTheme = raw.theme_config ?? {};
  if (!isPlainRecord(rawTheme)) {
    return {
      valid: false,
      code: 'INVALID_THEME_CONFIG',
      error: 'theme_config phải là object.',
    };
  }

  const theme = Object.fromEntries(
    Object.entries(rawTheme).filter(([key]) =>
      (SHOP_THEME_FIELDS as readonly string[]).includes(key)
    )
  ) as Partial<ShopThemeConfig>;
  const themeConfig = { ...defaultTheme, ...theme } as ShopThemeConfig;

  if (
    typeof themeConfig.primaryColor !== 'string' ||
    !/^#[\da-f]{6}$/i.test(themeConfig.primaryColor) ||
    !['grid', 'list'].includes(themeConfig.layout)
  ) {
    return {
      valid: false,
      code: 'INVALID_THEME_CONFIG',
      error: 'Màu sắc hoặc bố cục cửa hàng không hợp lệ.',
    };
  }

  const payload: Record<string, unknown> = {};
  for (const field of SHOP_CREATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      payload[field] = raw[field];
    }
  }
  payload.name = name;
  payload.slug = slug;
  payload.vertical = resolvedVertical;
  payload.supported_langs = Array.from(new Set(rawLocales)) as SupportedLocale[];
  payload.theme_config = themeConfig;
  if (typeof payload.currency !== 'string') payload.currency = 'VND';
  if (typeof payload.is_published !== 'boolean') payload.is_published = false;

  return {
    valid: true,
    payload: payload as ShopCreationInput['payload'],
    customThemeChanged: CUSTOM_THEME_FIELDS.some(
      (field) =>
        JSON.stringify(themeConfig[field]) !==
        JSON.stringify(defaultTheme[field])
    ),
  };
}

export function resolveShopCreationOwnerId(input: {
  authenticatedUserId: string;
  requestedOwnerId: unknown;
  isSuperAdmin: boolean;
}): { allowed: true; ownerId: string } | { allowed: false } {
  const requestedOwnerId =
    typeof input.requestedOwnerId === 'string'
      ? input.requestedOwnerId.trim()
      : '';
  if (
    requestedOwnerId &&
    requestedOwnerId !== input.authenticatedUserId &&
    !input.isSuperAdmin
  ) {
    return { allowed: false };
  }

  return {
    allowed: true,
    ownerId:
      input.isSuperAdmin && requestedOwnerId
        ? requestedOwnerId
        : input.authenticatedUserId,
  };
}
