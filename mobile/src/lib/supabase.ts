import { createClient } from '@supabase/supabase-js';
import { NativeModules, Platform } from 'react-native';
import { createApiClient } from './api-client';
import {
  clearOwnerSession,
  getOwnerAccessToken,
  getOwnerPostgrestToken,
  MobileOwnerOidcError,
} from './owner-session';
import {
  getSharedMobilePushRegistrationState,
  unregisterPushOnLogout,
} from './push-notifications';

export const PRODUCTION_API_URL = 'https://qlaok.vunph.click';
const SELF_HOSTED_POSTGREST_CLIENT_PLACEHOLDER_KEY =
  'qlaok-self-hosted-postgrest-public-client';

export function isSupabaseCloudUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  return /\.supabase\.co(?:[/:?#]|$)/i.test(rawUrl.trim());
}

/**
 * Dynamically resolves the API Base URL so physical devices on Expo Go / LAN
 * never get stuck calling `http://localhost:3000` (which points to the phone itself).
 *
 * Priority:
 * 1. Explicit `EXPO_PUBLIC_API_URL` if it is a non-localhost URL (or if running on web/simulator).
 * 2. Auto-detected LAN IP from React Native Metro `SourceCode.scriptURL` (e.g. `http://192.168.1.x:3000`).
 * 3. Android Emulator loopback (`http://10.0.2.2:3000`) when running in dev on Android emulator.
 * 4. Production HTTPS server (`https://qlaok.vunph.click`).
 */
export function resolveApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  // Extract Metro bundler host IP if available in dev mode
  let metroHostIp: string | null = null;
  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^/:]+)(?::\d+)?\//i);
      if (match?.[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        metroHostIp = match[1];
      }
    }
  } catch {
    // ignore NativeModules inspection errors
  }

  if (envUrl) {
    const isLocalhostEnv =
      envUrl.includes('localhost') || envUrl.includes('127.0.0.1');
    if (!isLocalhostEnv) {
      return envUrl.replace(/\/+$/, '');
    }
    // If .env has localhost but we are on a physical phone connected via LAN IP to Metro, swap localhost -> metroHostIp
    if (metroHostIp) {
      return envUrl
        .replace('localhost', metroHostIp)
        .replace('127.0.0.1', metroHostIp)
        .replace(/\/+$/, '');
    }
    if (Platform.OS === 'android') {
      return envUrl
        .replace('localhost', '10.0.2.2')
        .replace('127.0.0.1', '10.0.2.2')
        .replace(/\/+$/, '');
    }
    return envUrl.replace(/\/+$/, '');
  }

  if (__DEV__) {
    if (metroHostIp) {
      return `http://${metroHostIp}:3000`;
    }
    if (Platform.OS === 'android') {
      return 'http://10.0.2.2:3000';
    }
    if (Platform.OS === 'web') {
      return 'http://localhost:3000';
    }
  }

  if (__DEV__) return 'http://localhost:3000';
  return PRODUCTION_API_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();

export function resolveSelfHostedPostgrestBaseUrl(
  envOverride?: Record<string, string | undefined>,
  fallbackApiBaseUrl = API_BASE_URL
): string {
  const env = envOverride ?? (process.env as Record<string, string | undefined>);
  const rawConfigured = (
    env.EXPO_PUBLIC_POSTGREST_URL ||
    env.EXPO_PUBLIC_SUPABASE_URL ||
    fallbackApiBaseUrl ||
    PRODUCTION_API_URL
  )
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');

  if (isSupabaseCloudUrl(rawConfigured)) {
    throw new MobileOwnerOidcError(
      'SELF_HOSTED_POSTGREST_CLOUD_FORBIDDEN',
      'Supabase cloud URLs (*.supabase.co) are forbidden. Configure EXPO_PUBLIC_POSTGREST_URL / EXPO_PUBLIC_API_URL to point at the self-hosted Qlaok server.'
    );
  }

  return rawConfigured || PRODUCTION_API_URL;
}

export const POSTGREST_BASE_URL = resolveSelfHostedPostgrestBaseUrl();
export const POSTGREST_PUBLIC_KEY =
  (
    process.env.EXPO_PUBLIC_POSTGREST_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_KEY ||
    SELF_HOSTED_POSTGREST_CLIENT_PLACEHOLDER_KEY
  ).trim() || SELF_HOSTED_POSTGREST_CLIENT_PLACEHOLDER_KEY;

export function createAuthenticatedPostgrestFetch(options?: {
  getPostgrestToken?: () => Promise<string | null>;
  baseFetch?: typeof fetch;
}): typeof fetch {
  const getToken = options?.getPostgrestToken ?? (() => getOwnerPostgrestToken());
  const baseFetch = options?.baseFetch ?? fetch;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const targetUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (isSupabaseCloudUrl(targetUrl)) {
      throw new MobileOwnerOidcError(
        'SELF_HOSTED_POSTGREST_CLOUD_FORBIDDEN',
        'Refusing to send request to *.supabase.co.'
      );
    }

    const token = await getToken();
    if (!token) {
      throw new MobileOwnerOidcError(
        'POSTGREST_AUTH_TOKEN_UNAVAILABLE',
        'Missing or expired server-issued authenticated PostgREST JWT. Direct PostgREST queries fail closed without anon fallback.',
        401
      );
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Authorization', `Bearer ${token}`);

    return baseFetch(input, {
      ...init,
      headers,
    });
  };
}

/**
 * Self-hosted PostgREST client (`https://qlaok.vunph.click/rest/v1`).
 * Never uses Supabase Auth or `*.supabase.co`, and fails closed if no server-issued
 * `role: authenticated` PostgREST JWT is available.
 */
export const postgrestClient = createClient(
  POSTGREST_BASE_URL,
  POSTGREST_PUBLIC_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: createAuthenticatedPostgrestFetch(),
    },
  }
);

export const supabase = postgrestClient;

export const fetchApi = createApiClient(
  API_BASE_URL,
  () => getOwnerAccessToken(),
  fetch,
  async ({ requestWithoutUnauthorizedHandler }) => {
    await unregisterPushOnLogout({
      state: getSharedMobilePushRegistrationState(),
      apiCall: requestWithoutUnauthorizedHandler,
      signOut: () => clearOwnerSession({ reason: 'expired' }),
    });
  }
);

export interface MobilePromoBannerConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  subtitle?: string;
  bgGradient?: 'amber_rose' | 'emerald_teal' | 'violet_fuchsia' | 'royal_gold';
  ctaText?: string;
  discountType?: 'percent' | 'fixed_amount';
  discountValue?: number;
  minOrderAmount?: number;
  applyScope?: 'all' | 'selected_items';
  selectedItemIds?: string[];
  voucherCode?: string;
}

export interface MobileFlashSaleConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  discountType: 'percent' | 'fixed_amount';
  discountValue: number;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  itemIds: string[];
}

export interface MobilePopupConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  content: string;
  imageUrl?: string;
  voucherCode?: string;
  ctaText?: string;
}

export type MobileShopRole = 'owner' | 'cashier' | 'staff';

export type MobileShopPermission =
  | 'orders.view'
  | 'orders.create'
  | 'orders.fulfill'
  | 'orders.edit_items'
  | 'orders.cancel_unpaid'
  | 'orders.print_kitchen'
  | 'orders.print_provisional'
  | 'payment.collect'
  | 'discount.apply'
  | 'payment.refund'
  | 'catalog.view'
  | 'catalog.manage'
  | 'promotions.manage'
  | 'settings.manage'
  | 'settings.bank'
  | 'reports.view'
  | 'members.manage'
  | 'order.view'
  | 'order.refund'
  | 'inventory.adjust'
  | 'staff.manage';

export interface MobileShopMembership {
  id: string;
  shop_id: string;
  user_id: string;
  role: MobileShopRole;
  permissions: MobileShopPermission[];
  is_active: boolean;
}

export type MobileOrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type MobileTicketPrintType = 'kitchen' | 'provisional' | 'receipt';

export interface MobileShopPaymentConfig {
  mode?: 'vietqr' | 'custom_qr';
  bankId?: string;
  bankBin?: string;
  bankShortName?: string;
  accountNumber?: string;
  accountNo?: string;
  accountName?: string;
  customQrUrl?: string;
  qrImageUrl?: string;
}

export interface MobileShopThemeConfig {
  primaryColor?: string;
  layout?: 'list' | 'grid';
  backgroundStyle?: 'clean' | 'warm' | 'dark' | 'custom_image';
  backgroundImageUrl?: string;
  backgroundOverlayOpacity?: number;
  promoBanner?: MobilePromoBannerConfig;
  flashSale?: MobileFlashSaleConfig;
  welcomePopup?: MobilePopupConfig;
  paymentConfig?: MobileShopPaymentConfig;
  paymentQr?: MobileShopPaymentConfig;
  recent_orders?: MobileShopOrder[];
}

export interface MobileShop {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  vertical: 'fnb' | 'service' | 'retail';
  city: string;
  address?: string;
  phone_contact?: string;
  zalo_phone?: string;
  wifi_info?: {
    ssid: string;
    password?: string;
  };
  theme_config?: MobileShopThemeConfig;
  supported_langs: string[];
  is_published: boolean;
}

export type {
  MobileAnalyticsEvent,
  MobileCatalogItem,
  MobileDailyRevenuePoint,
  MobileShopOrderStats,
} from './overview-metrics';

export interface MobileCategory {
  id: string;
  shop_id: string;
  sort_order: number;
  name_i18n: Record<string, string>;
  is_active: boolean;
}

export interface MobileOrderLineItem {
  item_id: string;
  name_vi: string;
  name_i18n?: Record<string, string>;
  quantity: number;
  unit_price: number;
  extra_price: number;
  selected_choices?: Array<{
    id: string;
    label_i18n: Record<string, string>;
    extra_price: number;
  }>;
  custom_note?: string;
  quick_tags?: string[];
}

export interface MobileShopOrder {
  id: string;
  shop_id: string;
  order_code: string;
  table_label: string;
  session_id?: string;
  visitor_lang: string;
  status: 'new' | 'preparing' | 'completed' | 'cancelled';
  payment_method: 'cash' | 'vietqr';
  payment_status: MobileOrderPaymentStatus;
  items: MobileOrderLineItem[];
  subtotal_amount?: number;
  discount_amount?: number;
  promo_discount_amount?: number;
  manual_discount_amount?: number;
  total_amount: number;
  bill_version?: number;
  print_count?: number;
  kitchen_printed_count?: number;
  provisional_printed_count?: number;
  receipt_printed_count?: number;
  customer_note?: string;
  refund_reason?: string | null;
  cancelled_reason?: string | null;
  restock_items?: boolean;
  waste_recorded?: boolean;
  source?: 'qr_table' | 'counter_pos';
  created_at: string;
  updated_at: string;
}

export function formatVnd(amount: number): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}
