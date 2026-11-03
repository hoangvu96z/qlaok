import type {
  ServiceRequestNotificationRule,
  ShopPaymentConfig,
  ShopThemeConfig,
} from '@/types/qlaok';

export interface ShopSettingsThemeConfigPatchInput {
  customTheme?: {
    primaryColor: string;
    layout: ShopThemeConfig['layout'];
    backgroundStyle: NonNullable<ShopThemeConfig['backgroundStyle']>;
    backgroundImageUrl: string;
    backgroundOverlayOpacity: number;
  };
  paymentConfig?: ShopPaymentConfig;
  serviceRequestNotificationRule?: ServiceRequestNotificationRule;
}

/** Build a partial patch containing only values owned by the settings editor. */
export function buildShopSettingsThemeConfigPatch(
  input: ShopSettingsThemeConfigPatchInput
): Partial<ShopThemeConfig> {
  return {
    ...(input.customTheme
      ? {
          ...input.customTheme,
          // An empty string explicitly clears an existing background image.
          backgroundImageUrl: input.customTheme.backgroundImageUrl.trim(),
        }
      : {}),
    ...(input.paymentConfig ? { paymentConfig: input.paymentConfig } : {}),
    ...(input.serviceRequestNotificationRule
      ? {
          serviceRequestNotificationRule:
            input.serviceRequestNotificationRule,
        }
      : {}),
  };
}
