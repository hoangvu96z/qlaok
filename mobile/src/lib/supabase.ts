import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://kftmrjmmympztzztunxf.supabase.co';

export const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  'sb_publishable_BpW2kqz1l3LfN8MFvngWLw_2YxmIgBv';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

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
  supported_langs: string[];
  is_published: boolean;
}

export interface MobileCategory {
  id: string;
  shop_id: string;
  sort_order: number;
  name_i18n: Record<string, string>;
  is_active: boolean;
}

export interface MobileCatalogItem {
  id: string;
  shop_id: string;
  category_id: string;
  sort_order: number;
  price: number;
  is_available: boolean;
  is_featured: boolean;
  stock_quantity?: number | null;
  sold_count?: number;
  name_i18n: Record<string, string>;
  desc_i18n: Record<string, string>;
  view_count: number;
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
  visitor_lang: string;
  status: 'new' | 'preparing' | 'completed' | 'cancelled';
  payment_method: 'cash' | 'vietqr';
  payment_status: 'unpaid' | 'paid';
  items: MobileOrderLineItem[];
  total_amount: number;
  customer_note?: string;
  source?: 'qr_table' | 'counter_pos';
  created_at: string;
  updated_at: string;
}

export interface MobileAnalyticsEvent {
  id: number;
  shop_id: string;
  event_type:
    | 'scan_door'
    | 'scan_table'
    | 'item_view'
    | 'show_to_staff'
    | 'wifi_copy';
  item_id?: string | null;
  visitor_lang: string;
  created_at: string;
}

export function formatVnd(amount: number): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}
