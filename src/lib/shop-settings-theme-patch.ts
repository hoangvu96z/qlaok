import type {
  BusinessVertical,
  ServiceRequestNotificationRule,
  ShopPaymentConfig,
  ShopThemeConfig,
} from '@/types/qlaok';

export interface ShopSettingsCustomTheme {
  primaryColor: string;
  layout: ShopThemeConfig['layout'];
  backgroundStyle: NonNullable<ShopThemeConfig['backgroundStyle']>;
  backgroundImageUrl: string;
  backgroundOverlayOpacity: number;
}

export interface ShopSettingsThemeConfigPatchInput {
  customTheme?: ShopSettingsCustomTheme;
  initialCustomTheme?: ShopSettingsCustomTheme;
  paymentConfig?: ShopPaymentConfig;
  serviceRequestNotificationRule?: ServiceRequestNotificationRule;
  initialServiceRequestNotificationRule?: ServiceRequestNotificationRule;
}

export function resolveInitialShopSettingsCustomTheme(
  theme: Partial<ShopThemeConfig> | null | undefined,
  vertical: BusinessVertical
): ShopSettingsCustomTheme {
  return {
    primaryColor: theme?.primaryColor || '#10b981',
    layout: theme?.layout || (vertical === 'retail' ? 'grid' : 'list'),
    backgroundStyle: theme?.backgroundStyle || 'clean',
    backgroundImageUrl: theme?.backgroundImageUrl || '',
    backgroundOverlayOpacity:
      typeof theme?.backgroundOverlayOpacity === 'number'
        ? theme.backgroundOverlayOpacity
        : 0.72,
  };
}

export function hasShopSettingsPaymentConfigChanged(
  current: ShopPaymentConfig,
  initial: ShopPaymentConfig | null | undefined
): boolean {
  if (!initial) return false;
  const editableFields: Array<keyof ShopPaymentConfig> = [
    'mode',
    'bankId',
    'bankName',
    'accountNumber',
    'accountName',
    'template',
    'transferPrefix',
    'customQrUrl',
    'paymentNote',
  ];
  return editableFields.some((field) => current[field] !== initial[field]);
}

/** Build a partial patch containing only settings values changed from hydration. */
export function buildShopSettingsThemeConfigPatch(
  input: ShopSettingsThemeConfigPatchInput
): Partial<ShopThemeConfig> {
  const currentCustomTheme = input.customTheme
    ? {
        ...input.customTheme,
        // An empty string explicitly clears an existing background image.
        backgroundImageUrl: input.customTheme.backgroundImageUrl.trim(),
      }
    : null;
  const customThemeKeys: Array<keyof ShopSettingsCustomTheme> = [
    'primaryColor',
    'layout',
    'backgroundStyle',
    'backgroundImageUrl',
    'backgroundOverlayOpacity',
  ];
  const customThemePatch = currentCustomTheme
    ? (Object.fromEntries(
        customThemeKeys.flatMap((key) => {
          const currentValue = currentCustomTheme[key];
          const initialValue = input.initialCustomTheme?.[key];
          const normalizedInitialValue =
            key === 'backgroundImageUrl' && typeof initialValue === 'string'
              ? initialValue.trim()
              : initialValue;
          return input.initialCustomTheme &&
            Object.is(currentValue, normalizedInitialValue)
            ? []
            : [[key, currentValue]];
        })
      ) as Partial<ShopSettingsCustomTheme>)
    : {};

  return {
    ...customThemePatch,
    ...(input.paymentConfig ? { paymentConfig: input.paymentConfig } : {}),
    ...(input.serviceRequestNotificationRule &&
    input.serviceRequestNotificationRule !==
      input.initialServiceRequestNotificationRule
      ? {
          serviceRequestNotificationRule:
            input.serviceRequestNotificationRule,
        }
      : {}),
  };
}
