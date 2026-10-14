export type SupportedLocale = 'vi' | 'en' | 'ko' | 'ja' | 'zh';
export type PlanTier = 'free' | 'basic' | 'premium';
export type BusinessVertical = 'fnb' | 'service' | 'retail';
export type AnalyticsEventType =
  | 'scan_door'
  | 'scan_table'
  | 'item_view'
  | 'show_to_staff'
  | 'wifi_copy';

export interface I18nText {
  vi: string;
  en?: string;
  ko?: string;
  ja?: string;
  zh?: string;
}

export interface WifiInfo {
  ssid: string;
  password?: string;
}

export interface DaySchedule {
  open: string;   // Format "HH:mm" e.g. "08:00"
  close: string;  // Format "HH:mm" e.g. "22:00"
  closed: boolean;
}

export type OpeningHours = Record<
  'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
  DaySchedule
>;

export interface ItemOptionChoice {
  id: string;
  label_i18n: I18nText;
  extra_price: number;
}

export interface ItemOptionGroup {
  id: string;
  name_i18n: I18nText; // VD: {"vi": "Mức đá", "en": "Ice Level", "ko": "얼음 양"}
  required: boolean;
  choices: ItemOptionChoice[];
}

export interface Shop {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  vertical: BusinessVertical;
  tagline_i18n: I18nText;
  description_i18n: I18nText;
  logo_url: string | null;
  cover_urls: string[];
  address: string | null;
  city: string;
  google_maps_url: string | null;
  google_review_url: string | null;
  phone_contact: string | null;
  zalo_phone: string | null;
  telegram_chat_id?: string | null;
  wifi_info: WifiInfo;
  opening_hours: OpeningHours;
  supported_langs: SupportedLocale[];
  currency: string;
  theme_config: {
    primaryColor: string;
    layout: 'grid' | 'list';
  };
  is_published?: boolean;
}

export interface Category {
  id: string;
  shop_id: string;
  sort_order: number;
  name_i18n: I18nText;
  is_active: boolean;
}

export interface CatalogItem {
  id: string;
  shop_id: string;
  category_id: string;
  sort_order: number;
  price: number;
  compare_at_price?: number | null;
  unit_i18n?: I18nText;
  duration_mins?: number | null; // Dùng cho Tiệm Nail, Spa, Massage, Karaoke
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  name_i18n: I18nText;
  desc_i18n: I18nText;
  options_json: ItemOptionGroup[];
  view_count: number;
  stock_quantity?: number | null; // null = không giới hạn, >= 0 = số lượng tồn kho
  sold_count?: number; // tổng số lượng đã bán
}

export type OrderStatus = 'new' | 'preparing' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'vietqr';

export interface OrderLineItem {
  item_id: string;
  name_vi: string;
  name_i18n?: I18nText;
  quantity: number;
  unit_price: number;
  extra_price: number;
  selected_choices: ItemOptionChoice[];
  custom_note?: string;
  quick_tags?: string[];
}

export interface ShopOrder {
  id: string;
  order_code: string;
  shop_id: string;
  table_label: string;
  visitor_lang: SupportedLocale;
  customer_note?: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: 'unpaid' | 'paid';
  total_amount: number;
  items: OrderLineItem[];
  source: 'qr_table' | 'counter_pos';
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  shop_id: string;
  title_i18n: I18nText;
  content_i18n: I18nText;
  banner_url?: string | null;
  is_pinned: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AnalyticsEvent {
  id: number;
  shop_id: string;
  event_type: AnalyticsEventType;
  item_id?: string | null;
  visitor_lang: SupportedLocale;
  user_agent?: string;
  created_at: string;
}

export interface PaymentTransaction {
  id: string;
  user_id: string;
  order_code: string;
  target_plan: PlanTier;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  bank_ref_id?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface Profile {
  id: string;
  email: string;
  phone?: string;
  full_name: string;
  plan: PlanTier;
  plan_expires_at?: string | null;
}

export interface CartSelection {
  item: CatalogItem;
  quantity: number;
  selectedChoices: ItemOptionChoice[];
  customNote: string;
  quickTags?: string[];
}

