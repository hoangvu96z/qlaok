export type SupportedLocale = 'vi' | 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'it' | 'ru';
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
  es?: string;
  it?: string;
  ru?: string;
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
  label_vi?: string;
  label_i18n: I18nText;
  desc_i18n?: I18nText;
  extra_price: number;
}

export interface ItemOptionGroup {
  id: string;
  name_i18n: I18nText; // VD: {"vi": "Mức đá", "en": "Ice Level", "ko": "얼음 양"}
  desc_i18n?: I18nText;
  required: boolean;
  choices: ItemOptionChoice[];
}

export interface ShopPromoBannerConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  bgGradient?: 'amber_rose' | 'emerald_teal' | 'violet_fuchsia' | 'royal_gold';
  ctaText?: string;
  discountType?: 'percent' | 'fixed_amount' | 'fixed';
  discountValue?: number;
  minOrderAmount?: number;
  applyScope?: 'all' | 'selected_items';
  selectedItemIds?: string[];
  voucherCode?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}

export interface ShopFlashSaleConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  discountType: 'percent' | 'fixed_amount' | 'fixed';
  discountValue: number;
  startDate?: string; // Format "YYYY-MM-DD" e.g. "2026-10-15"
  endDate?: string;   // Format "YYYY-MM-DD" e.g. "2026-10-22"
  startTime?: string; // Format "HH:mm" e.g. "11:00"
  endTime?: string;   // Format "HH:mm" e.g. "22:00"
  itemIds: string[];
  selectedItemIds?: string[];
}

export interface ShopPopupConfig {
  enabled: boolean;
  badgeText?: string;
  title: string;
  content: string;
  imageUrl?: string;
  voucherCode?: string;
  ctaText?: string;
}

export type PromoBannerConfig = ShopPromoBannerConfig;
export type FlashSaleConfig = ShopFlashSaleConfig;

export interface ShopPaymentConfig {
  mode?: 'vietqr_auto' | 'vietqr' | 'custom_qr';
  bankId?: string;          // VietQR bank code, e.g. 'MB', 'VCB', 'TCB', 'ACB', 'BIDV', 'ICB', 'VPB', 'TPB', 'STB', 'VBA'
  bankBin?: string;
  bankShortName?: string;
  bankName?: string;        // Readable bank name, e.g. 'MB Bank (Quân Đội)'
  accountNumber?: string;   // Bank account number
  accountNo?: string;
  accountName?: string;     // Account holder name (uppercase, non-accented)
  template?: 'compact2' | 'compact' | 'qr_only' | 'print';
  transferPrefix?: string;  // Prefix for transfer description, e.g. 'QLAOK'
  customQrUrl?: string;     // Custom uploaded/pasted QR image URL (MoMo, ZaloPay, static bank QR)
  qrImageUrl?: string;
  paymentNote?: string;     // Optional note shown below QR
}

export interface ShopThemeConfig {
  primaryColor: string;
  layout: 'grid' | 'list';
  fontStyle?: string;
  backgroundStyle?: 'clean' | 'warm' | 'dark' | 'custom_image';
  backgroundImageUrl?: string;
  backgroundOverlayOpacity?: number;
  promoBanner?: ShopPromoBannerConfig;
  flashSale?: ShopFlashSaleConfig;
  welcomePopup?: ShopPopupConfig;
  paymentConfig?: ShopPaymentConfig;
  paymentQr?: ShopPaymentConfig;
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
  theme_config: ShopThemeConfig;
  is_published?: boolean;
  created_at?: string;
  updated_at?: string;
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
  image_url?: string | null;
  is_available: boolean;
  is_featured: boolean;
  name_i18n: I18nText;
  desc_i18n: I18nText;
  options_json: ItemOptionGroup[];
  view_count: number;
  stock_quantity?: number | null; // null = không giới hạn, >= 0 = số lượng tồn kho
  sold_count?: number; // tổng số lượng đã bán
  created_at?: string;
}

export type OrderStatus = 'new' | 'preparing' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'vietqr';
export type OrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type TicketPrintType = 'kitchen' | 'provisional' | 'receipt';

export type ShopRole = 'owner' | 'cashier' | 'staff';

export type ShopPermission =
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
  | 'members.manage';

export interface ShopMembership {
  id: string;
  shop_id: string;
  user_id: string;
  email?: string;
  full_name?: string;
  role: ShopRole;
  permissions: ShopPermission[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderLineItem {
  item_id: string;
  name_vi: string;
  name_i18n?: I18nText;
  quantity: number;
  unit_price: number;
  original_unit_price?: number;
  custom_unit_price?: number | null;
  catalog_unit_price?: number;
  extra_price: number;
  discount_percent?: number;
  line_discount_amount?: number;
  selected_choices: ItemOptionChoice[];
  custom_note?: string;
  quick_tags?: string[];
}

export interface ShopOrder {
  id: string;
  order_code: string;
  shop_id: string;
  table_label: string;
  session_id?: string;
  visitor_lang: SupportedLocale;
  customer_note?: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: OrderPaymentStatus;
  subtotal_amount?: number;
  discount_amount?: number;
  promo_discount_amount?: number;
  manual_discount_amount?: number;
  discount_code?: string;
  discount_reason?: string;
  voucher_code?: string;
  total_amount: number;
  bill_version?: number;
  items: OrderLineItem[];
  source: 'qr_table' | 'counter_pos';
  tracking_token?: string;
  idempotency_key?: string;
  payment_idempotency_key?: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  payment_reference?: string | null;
  cash_received?: number | null;
  change_due?: number | null;
  refunded_at?: string | null;
  refunded_by?: string | null;
  refund_amount?: number | null;
  refund_reason?: string | null;
  cancel_reason?: string | null;
  cancelled_reason?: string | null;
  restock_items?: boolean;
  waste_recorded?: boolean;
  print_count?: number;
  kitchen_printed_count?: number;
  provisional_printed_count?: number;
  receipt_printed_count?: number;
  last_printed_at?: string | null;
  last_printed_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TableBillSummary {
  shop_id: string;
  session_id: string;
  table_label: string;
  order_ids: string[];
  order_codes: string[];
  rounds_count?: number;
  items?: OrderLineItem[];
  combined_items?: OrderLineItem[];
  orders?: ShopOrder[];
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  payment_status: OrderPaymentStatus;
  bill_version?: number;
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
  is_admin?: boolean;
  role?: 'admin' | 'owner' | 'cashier' | 'staff';
  created_at?: string;
  updated_at?: string;
}

export interface CartSelection {
  item: CatalogItem;
  quantity: number;
  selectedChoices: ItemOptionChoice[];
  customNote: string;
  quickTags?: string[];
}
