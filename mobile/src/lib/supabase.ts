import { createClient } from '@supabase/supabase-js';
import { NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createApiClient } from './api-client';
import {
  getSharedMobilePushRegistrationState,
  unregisterPushOnLogout,
} from './push-notifications';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://kftmrjmmympztzztunxf.supabase.co';

export const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  'sb_publishable_BpW2kqz1l3LfN8MFvngWLw_2YxmIgBv';

export const PRODUCTION_API_URL = 'https://qlaok.vunph.click';

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

// Native refresh tokens live in OS-protected storage; web uses Supabase's browser storage.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      removeItem: (key: string) => SecureStore.deleteItemAsync(key),
    } } : {}),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const fetchApi = createApiClient(
  API_BASE_URL,
  async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.access_token ?? null;
  },
  fetch,
  async ({ requestWithoutUnauthorizedHandler }) => {
    await unregisterPushOnLogout({
      state: getSharedMobilePushRegistrationState(),
      apiCall: requestWithoutUnauthorizedHandler,
      signOut: () => supabase.auth.signOut({ scope: 'local' }),
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
  source?: 'qr_table' | 'counter_pos';
  created_at: string;
  updated_at: string;
}

export function formatVnd(amount: number): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}
