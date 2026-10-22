import type { BusinessVertical, I18nText, OpeningHours, SupportedLocale } from '@/types/qlaok';

export const LOCALE_META: Record<
  SupportedLocale,
  {
    label: string;
    nativeName: string;
    flag: string;
    flagSrc: string;
    short: string;
  }
> = {
  vi: {
    label: 'Tiếng Việt',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    flagSrc: '/flags/vi.svg',
    short: 'VI',
  },
  en: {
    label: 'Tiếng Anh',
    nativeName: 'English',
    flag: '🇬🇧',
    flagSrc: '/flags/en.svg',
    short: 'EN',
  },
  ko: {
    label: 'Tiếng Hàn',
    nativeName: '한국어',
    flag: '🇰🇷',
    flagSrc: '/flags/ko.svg',
    short: 'KO',
  },
  ja: {
    label: 'Tiếng Nhật',
    nativeName: '日本語',
    flag: '🇯🇵',
    flagSrc: '/flags/ja.svg',
    short: 'JA',
  },
  zh: {
    label: 'Tiếng Trung',
    nativeName: '中文',
    flag: '🇨🇳',
    flagSrc: '/flags/zh.svg',
    short: 'ZH',
  },
  es: {
    label: 'Tiếng Tây Ban Nha',
    nativeName: 'Español',
    flag: '🇪🇸',
    flagSrc: '/flags/es.svg',
    short: 'ES',
  },
  it: {
    label: 'Tiếng Ý',
    nativeName: 'Italiano',
    flag: '🇮🇹',
    flagSrc: '/flags/it.svg',
    short: 'IT',
  },
  ru: {
    label: 'Tiếng Nga',
    nativeName: 'Русский',
    flag: '🇷🇺',
    flagSrc: '/flags/ru.svg',
    short: 'RU',
  },
};

export const ALL_LOCALES: SupportedLocale[] = [
  'vi',
  'en',
  'ko',
  'ja',
  'zh',
  'es',
  'it',
  'ru',
];

/** Default storefront languages when a shop has not configured supported_langs. */
export const DEFAULT_STOREFRONT_LOCALES: SupportedLocale[] = ['vi', 'en'];

/**
 * Normalize a shop's configured supported_langs: keep only known locales (deduped,
 * in configured order); fall back to ['vi', 'en'] when nothing valid is configured.
 */
export function normalizeShopSupportedLangs(
  langs: readonly unknown[] | null | undefined
): SupportedLocale[] {
  const seen = new Set<SupportedLocale>();
  for (const raw of Array.isArray(langs) ? langs : []) {
    if (typeof raw === 'string' && ALL_LOCALES.includes(raw as SupportedLocale)) {
      seen.add(raw as SupportedLocale);
    }
  }
  return seen.size > 0 ? Array.from(seen) : [...DEFAULT_STOREFRONT_LOCALES];
}

export function detectVisitorLocale(
  supportedLangs: SupportedLocale[],
  queryLang?: string | null
): SupportedLocale {
  if (queryLang && ALL_LOCALES.includes(queryLang as SupportedLocale)) {
    const q = queryLang as SupportedLocale;
    if (supportedLangs.includes(q)) return q;
  }

  if (typeof window === 'undefined') return 'vi';

  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = urlParams.get('lang') as SupportedLocale | null;
  if (urlLang && supportedLangs.includes(urlLang)) {
    localStorage.setItem('qlaok_lang', urlLang);
    return urlLang;
  }

  const saved = localStorage.getItem('qlaok_lang') as SupportedLocale | null;
  if (saved && supportedLangs.includes(saved)) return saved;

  const browserLang = navigator.language.toLowerCase();
  let detected: SupportedLocale = 'vi';

  if (browserLang.startsWith('ko')) detected = 'ko';
  else if (browserLang.startsWith('ja')) detected = 'ja';
  else if (browserLang.startsWith('zh')) detected = 'zh';
  else if (browserLang.startsWith('es')) detected = 'es';
  else if (browserLang.startsWith('it')) detected = 'it';
  else if (browserLang.startsWith('ru')) detected = 'ru';
  else if (browserLang.startsWith('vi')) detected = 'vi';
  else detected = 'en';

  if (supportedLangs.includes(detected)) return detected;
  if (supportedLangs.includes('en')) return 'en';
  if (supportedLangs.includes('vi')) return 'vi';
  return supportedLangs[0] || 'vi';
}

export function tField(
  field: I18nText | undefined | null,
  locale: SupportedLocale
): string {
  if (!field) return '';
  return field[locale] || field.en || field.vi || '';
}

export function formatCurrency(amount: number, currency = 'VND'): string {
  if (currency === 'VND') {
    return `${amount.toLocaleString('vi-VN')}đ`;
  }
  return `${amount.toLocaleString()} ${currency}`;
}

export function formatTableLabel(
  rawTable: string,
  locale: SupportedLocale
): string {
  if (!rawTable) return '';
  const trimmed = rawTable.trim();
  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  if (/^mang\s*về$/i.test(trimmed) || /^takeaway$/i.test(trimmed)) {
    return labels.takeawayOption;
  }

  const tableMatch = trimmed.match(/^(?:bàn|table)\s*(\d+|[a-z0-9-]+)$/i);
  if (tableMatch) {
    const num = tableMatch[1];
    if (locale === 'zh') return `${num}号桌`;
    return `${labels.tablePrefix} ${num}`;
  }

  return trimmed;
}

/** Default IANA timezone used to evaluate shop opening hours. */
export const DEFAULT_SHOP_TIMEZONE = 'Asia/Ho_Chi_Minh';

const OPENING_DAY_KEYS: Array<keyof OpeningHours> = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Parse "HH:mm" into minutes since midnight; returns null when unparseable. */
export function parseScheduleTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 24 || m > 59) {
    return null;
  }
  if (h === 24 && m !== 0) return null;
  return h * 60 + m;
}

/**
 * Resolve the weekday index (0=Sun) and minutes since midnight of `now`
 * in the given IANA timezone. Falls back to the default shop timezone and
 * finally to the runtime local clock when Intl cannot resolve the zone.
 */
export function getZonedWeekdayAndMinutes(
  now: Date,
  timeZone: string = DEFAULT_SHOP_TIMEZONE
): { dayIndex: number; minutes: number } {
  const tryZone = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    const dayIndex = WEEKDAY_SHORT_TO_INDEX[weekday];
    if (dayIndex === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      throw new Error('UNRESOLVED_TIMEZONE_PARTS');
    }
    return { dayIndex, minutes: (hour % 24) * 60 + minute };
  };
  try {
    return tryZone(timeZone || DEFAULT_SHOP_TIMEZONE);
  } catch {
    try {
      return tryZone(DEFAULT_SHOP_TIMEZONE);
    } catch {
      return {
        dayIndex: now.getDay(),
        minutes: now.getHours() * 60 + now.getMinutes(),
      };
    }
  }
}

export interface ShopOpenStatusOptions {
  /** Reference time (defaults to now). */
  now?: Date;
  /** IANA timezone of the shop (defaults to Asia/Ho_Chi_Minh). */
  timeZone?: string | null;
}

/**
 * Evaluate whether a shop is open in its own timezone.
 * - Supports overnight ranges (close < open, e.g. 18:00 → 02:00): the early-morning
 *   tail is attributed to the previous day's schedule.
 * - open === close is treated as open 24 hours.
 * - Missing / unparseable opening hours are treated as OPEN (fail-open), so a
 *   misconfigured shop never silently blocks orders.
 */
export function checkShopOpenStatus(
  openingHours: OpeningHours | null | undefined,
  options: ShopOpenStatusOptions = {}
): {
  isOpen: boolean;
  todaySchedule: { open: string; close: string; closed: boolean };
} {
  const now = options.now ?? new Date();
  const { dayIndex, minutes } = getZonedWeekdayAndMinutes(
    now,
    options.timeZone || DEFAULT_SHOP_TIMEZONE
  );
  const fallbackSchedule = { open: '08:00', close: '22:00', closed: false };

  if (!openingHours || typeof openingHours !== 'object') {
    return { isOpen: true, todaySchedule: fallbackSchedule };
  }

  const todayKey = OPENING_DAY_KEYS[dayIndex];
  const yesterdayKey = OPENING_DAY_KEYS[(dayIndex + 6) % 7];
  const today = openingHours[todayKey];
  const yesterday = openingHours[yesterdayKey];

  // Yesterday's overnight tail (e.g. Mon 18:00 → 02:00 covers Tue 00:00–02:00)
  if (yesterday && !yesterday.closed) {
    const yOpen = parseScheduleTime(yesterday.open);
    const yClose = parseScheduleTime(yesterday.close);
    if (yOpen !== null && yClose !== null && yClose < yOpen && minutes <= yClose) {
      return {
        isOpen: true,
        todaySchedule: today
          ? { open: today.open, close: today.close, closed: Boolean(today.closed) }
          : fallbackSchedule,
      };
    }
  }

  if (!today) {
    // No schedule configured for today → fail open
    return { isOpen: true, todaySchedule: fallbackSchedule };
  }

  const todaySchedule = {
    open: today.open,
    close: today.close,
    closed: Boolean(today.closed),
  };

  if (today.closed) {
    return { isOpen: false, todaySchedule };
  }

  const openMins = parseScheduleTime(today.open);
  const closeMins = parseScheduleTime(today.close);
  if (openMins === null || closeMins === null) {
    // Unparseable schedule → fail open
    return { isOpen: true, todaySchedule };
  }

  if (openMins === closeMins) {
    return { isOpen: true, todaySchedule };
  }

  const isOpen =
    closeMins > openMins
      ? minutes >= openMins && minutes <= closeMins
      : minutes >= openMins; // overnight: open until midnight, tail handled above
  return { isOpen, todaySchedule };
}

export interface UiLabelSet {
  openNow: string;
  closedNow: string;
  openingHours: string;
  wifiTitle: string;
  copyPassword: string;
  copied: string;
  directions: string;
  googleReview: string;
  promotions: string;
  viewMenuFnb: string;
  viewMenuService: string;
  viewMenuRetail: string;
  searchPlaceholder: string;
  allCategories: string;
  soldOut: string;
  bestSeller: string;
  durationMins: string;
  addToOrder: string;
  customNotePlaceholder: string;
  quickTagsTitle: string;
  bottomCtaFnb: string;
  bottomCtaService: string;
  bottomCtaRetail: string;
  bottomBarHint: string;
  showToStaffHeader: string;
  showToStaffSub: string;
  totalEstimated: string;
  sendZaloOrder: string;
  clearSelection: string;
  backToStore: string;
  requiredBadge: string;
  optionalBadge: string;
  stockLeftPrefix: string;
  stockLeftSuffix: string;
  qtyShort: string;
  unitPriceLabel: string;
  notePrefix: string;
  cashPayment: string;
  qrPayment: string;
  tablePrefix: string;
  tableSelectorLabel: string;
  takeawayOption: string;
  noTableSelected: string;
  selectTableBeforeSendError: string;
  tableConfirmationRequiredTitle: string;
  tableQrUnavailableTitle: string;
  tableQrInvalidError: string;
  tableInactiveError: (tableName: string) => string;
  tableNotFoundError: (tableQuery: string) => string;
  tablesLoadError: string;
  noActiveTablesTakeawayHint: string;
  qrNotConfiguredNotice: string;
  editingOrderHint: string;
  addMoreItemsBtn: string;
  keepingExistingTablePrefix: (orderCode: string) => string;
  retryBtn: string;
  submitOrderError: string;
  closeOrderModalAria: string;
  closeItemDetailAria: string;
  closePromoPopupAria: string;
  paymentMethodGroupAria: string;
  decreaseQtyAria: (itemName: string) => string;
  increaseQtyAria: (itemName: string) => string;
  clearSearchAria: string;
  selectLanguageAria: string;
  selectLanguageTitle: string;
  languagesCount: (count: number) => string;
  loadingMenu: string;
  loadingShopInfo: string;
  menuNotFoundTitle: string;
  shopNotFoundTitle: string;
  backToExplore: string;
  promosShort: string;
  pinnedBadge: string;
  emptyCartTitle: string;
  backToMenuBtn: string;
  liveOrderSentPrefix: string;
  liveOrderSentSuffix: string;
  liveOrderBannerSub: string;
  viewOrderBtn: string;
  orderItemsSentHeading: string;
  autoNotifiedSub: string;
  kitchenBilingualNote: string;
}

export const UI_LABELS: Record<SupportedLocale, UiLabelSet> = {
  vi: {
    openNow: 'Đang mở cửa',
    closedNow: 'Đã đóng cửa',
    openingHours: 'Giờ mở cửa hôm nay',
    wifiTitle: 'Wi-Fi Miễn Phí',
    copyPassword: 'Chạm copy mật khẩu',
    copied: 'Đã copy mật khẩu!',
    directions: 'Chỉ đường Google Maps',
    googleReview: 'Đánh giá 5⭐ trên Google',
    promotions: 'Ưu đãi & Thông báo từ quán',
    viewMenuFnb: 'Xem Thực Đơn & Gọi Món',
    viewMenuService: 'Xem Bảng Giá Dịch Vụ',
    viewMenuRetail: 'Xem Danh Mục Sản Phẩm',
    searchPlaceholder: 'Tìm món ăn, dịch vụ, sản phẩm...',
    allCategories: 'Tất cả',
    soldOut: 'Tạm hết',
    bestSeller: 'Bán chạy',
    durationMins: 'phút',
    addToOrder: 'Thêm vào đơn hàng',
    customNotePlaceholder: 'Ghi chú thêm (VD: không cay, dị ứng...)',
    quickTagsTitle: 'Ghi chú nhanh',
    bottomCtaFnb: 'Xem giỏ món & Đặt đơn ngay',
    bottomCtaService: 'Xem dịch vụ & Đặt lịch ngay',
    bottomCtaRetail: 'Xem giỏ hàng & Đặt mua ngay',
    bottomBarHint: '🚀 Gửi đơn trực tiếp xuống quầy thu ngân & báo bếp tự động',
    showToStaffHeader: 'XÁC NHẬN ĐƠN HÀNG CỦA BẠN',
    showToStaffSub:
      'Mời quý khách kiểm tra lại món trước khi bấm nút gửi đến quầy.',
    totalEstimated: 'Tổng cộng tạm tính',
    sendZaloOrder: 'Gửi đơn qua Zalo quán',
    clearSelection: 'Xóa danh sách chọn',
    backToStore: 'Thông tin quán',
    requiredBadge: 'Bắt buộc',
    optionalBadge: 'Chọn thêm (Nhiều mục)',
    stockLeftPrefix: 'Còn ',
    stockLeftSuffix: '',
    qtyShort: 'SL',
    unitPriceLabel: 'Đơn giá',
    notePrefix: 'Ghi chú',
    cashPayment: 'Tiền mặt tại quầy',
    qrPayment: 'Chuyển khoản QR',
    tablePrefix: 'Bàn',
    tableSelectorLabel: 'Vị trí:',
    takeawayOption: 'Mang về',
    noTableSelected: 'Chưa chọn bàn',
    selectTableBeforeSendError:
      'Mời quý khách chọn bàn phục vụ hoặc chọn Mang về trước khi bấm nút gửi đến quầy.',
    tableConfirmationRequiredTitle: 'Cần xác nhận lại bàn phục vụ',
    tableQrUnavailableTitle:
      'Mã QR bàn không khả dụng — vui lòng chọn lại bàn hoặc Mang về',
    tableQrInvalidError:
      'Mã bàn từ QR không hợp lệ hoặc không thuộc quán này. Vui lòng chọn bàn đang hoạt động hoặc Mang về.',
    tableInactiveError: (tableName) =>
      `Bàn "${tableName}" hiện đang tạm ngưng phục vụ. Vui lòng chọn bàn khác hoặc Mang về.`,
    tableNotFoundError: (tableQuery) =>
      `Không tìm thấy bàn "${tableQuery}" tại quán này. Vui lòng chọn bàn đang hoạt động hoặc Mang về.`,
    tablesLoadError:
      'Không thể tải danh sách bàn của quán. Vui lòng thử lại.',
    noActiveTablesTakeawayHint:
      'Quán hiện chưa mở bàn tại chỗ. Bạn có thể chọn "Mang về" để gửi đơn.',
    qrNotConfiguredNotice:
      'Quán chưa cấu hình mã VietQR tự động. Vui lòng thanh toán trực tiếp với nhân viên tại bàn/quầy.',
    editingOrderHint:
      'Mời quý khách kiểm tra lại món, tăng/giảm số lượng hoặc chọn thêm món trước khi bấm nút gửi đến quầy.',
    addMoreItemsBtn: '+ Chọn thêm món',
    keepingExistingTablePrefix: (orderCode) =>
      `Đang giữ nguyên vị trí của đơn #${orderCode}: `,
    retryBtn: 'Thử lại',
    submitOrderError: 'Không thể gửi đơn hàng. Vui lòng thử lại.',
    closeOrderModalAria: 'Đóng cửa sổ đặt món',
    closeItemDetailAria: 'Đóng chi tiết món',
    closePromoPopupAria: 'Đóng hộp thoại ưu đãi',
    paymentMethodGroupAria: 'Phương thức thanh toán',
    decreaseQtyAria: (itemName) => `Giảm số lượng ${itemName}`,
    increaseQtyAria: (itemName) => `Tăng số lượng ${itemName}`,
    clearSearchAria: 'Xóa từ khóa tìm kiếm',
    selectLanguageAria: 'Chọn ngôn ngữ',
    selectLanguageTitle: 'Chọn ngôn ngữ',
    languagesCount: (count) => `${count} ngôn ngữ`,
    loadingMenu: 'Đang tải thực đơn đa ngôn ngữ...',
    loadingShopInfo: 'Đang tải thông tin cửa hàng...',
    menuNotFoundTitle: 'Không tìm thấy thực đơn cửa hàng',
    shopNotFoundTitle: 'Không tìm thấy cửa hàng',
    backToExplore: 'Quay lại trang khám phá',
    promosShort: 'Ưu đãi',
    pinnedBadge: 'Đã ghim',
    emptyCartTitle: 'Chưa có món / dịch vụ nào được chọn',
    backToMenuBtn: 'Quay lại chọn món',
    liveOrderSentPrefix: 'Đơn ',
    liveOrderSentSuffix: ' đã gửi đến quầy',
    liveOrderBannerSub: 'Chạm để xem tiến độ chế biến & phục vụ trực tiếp',
    viewOrderBtn: 'Xem đơn',
    orderItemsSentHeading: 'Chi tiết món đã gửi đến quầy',
    autoNotifiedSub: 'Quầy thu ngân & bếp đã nhận thông báo tự động',
    kitchenBilingualNote: 'Tên món Tiếng Việt được đính kèm bên dưới để bếp chế biến chính xác',
  },
  en: {
    openNow: 'Open Now',
    closedNow: 'Closed',
    openingHours: "Today's Hours",
    wifiTitle: 'Free Wi-Fi',
    copyPassword: 'Tap to copy password',
    copied: 'Password copied!',
    directions: 'Google Maps Directions',
    googleReview: 'Rate us 5⭐ on Google',
    promotions: 'Special Offers & Announcements',
    viewMenuFnb: 'View Menu & Order',
    viewMenuService: 'View Service Price List',
    viewMenuRetail: 'Browse Product Catalog',
    searchPlaceholder: 'Search menu, services, products...',
    allCategories: 'All',
    soldOut: 'Sold Out',
    bestSeller: 'Popular',
    durationMins: 'mins',
    addToOrder: 'Add to Order',
    customNotePlaceholder: 'Special requests (e.g. no peanuts, allergies...)',
    quickTagsTitle: 'Quick Notes',
    bottomCtaFnb: 'Review Order & Send to Counter',
    bottomCtaService: 'Review Services & Confirm Booking',
    bottomCtaRetail: 'Review Cart & Place Order',
    bottomBarHint: '🚀 Send your order directly to the counter & kitchen in real time',
    showToStaffHeader: 'REVIEW & CONFIRM YOUR ORDER',
    showToStaffSub:
      'Please review your items before tapping the button to send to the counter.',
    totalEstimated: 'Estimated Total',
    sendZaloOrder: 'Send via Zalo',
    clearSelection: 'Clear All',
    backToStore: 'Store Info',
    requiredBadge: 'Required',
    optionalBadge: 'Optional / Add-ons',
    stockLeftPrefix: '',
    stockLeftSuffix: ' left',
    qtyShort: 'QTY',
    unitPriceLabel: 'Unit price',
    notePrefix: 'Note',
    cashPayment: 'Cash at Counter',
    qrPayment: 'QR Bank Transfer',
    tablePrefix: 'Table',
    tableSelectorLabel: 'Table:',
    takeawayOption: 'Takeaway',
    noTableSelected: 'No table selected',
    selectTableBeforeSendError:
      'Please select an active table or choose Takeaway before sending your order to the counter.',
    tableConfirmationRequiredTitle: 'Table confirmation required',
    tableQrUnavailableTitle:
      'Table QR unavailable — please select an active table or Takeaway',
    tableQrInvalidError:
      'This table QR is invalid or does not belong to this shop. Please select an active table or Takeaway.',
    tableInactiveError: (tableName) =>
      `Table "${tableName}" is currently unavailable. Please select another table or Takeaway.`,
    tableNotFoundError: (tableQuery) =>
      `Table "${tableQuery}" was not found at this shop. Please select an active table or Takeaway.`,
    tablesLoadError:
      'Unable to load the table list for this shop. Please try again.',
    noActiveTablesTakeawayHint:
      'No dine-in tables are currently active. You can select "Takeaway" to place your order.',
    qrNotConfiguredNotice:
      'Online QR is not configured for this shop. Please pay with staff at your table or counter.',
    editingOrderHint:
      'Please review your items, adjust quantities, or add more dishes before sending to the counter.',
    addMoreItemsBtn: '+ Add Items',
    keepingExistingTablePrefix: (orderCode) =>
      `Keeping existing table for #${orderCode}: `,
    retryBtn: 'Retry',
    submitOrderError: 'Unable to send order. Please try again.',
    closeOrderModalAria: 'Close order modal',
    closeItemDetailAria: 'Close item details',
    closePromoPopupAria: 'Close promotion popup',
    paymentMethodGroupAria: 'Payment method',
    decreaseQtyAria: (itemName) => `Decrease quantity of ${itemName}`,
    increaseQtyAria: (itemName) => `Increase quantity of ${itemName}`,
    clearSearchAria: 'Clear search',
    selectLanguageAria: 'Select language',
    selectLanguageTitle: 'Select language',
    languagesCount: (count) => `${count} languages`,
    loadingMenu: 'Loading multilingual menu...',
    loadingShopInfo: 'Loading store information...',
    menuNotFoundTitle: 'Storefront menu not found',
    shopNotFoundTitle: 'Store not found',
    backToExplore: 'Back to Explore',
    promosShort: 'Promos',
    pinnedBadge: 'Pinned',
    emptyCartTitle: 'Your order list is currently empty',
    backToMenuBtn: 'Back to Menu',
    liveOrderSentPrefix: 'Order ',
    liveOrderSentSuffix: ' sent to kitchen',
    liveOrderBannerSub: 'Tap to track live preparation & serving status',
    viewOrderBtn: 'Track Order',
    orderItemsSentHeading: 'Items sent to counter & kitchen',
    autoNotifiedSub: 'Counter & kitchen have been notified automatically',
    kitchenBilingualNote: 'Vietnamese dish names are shown below each item for kitchen accuracy',
  },
  ko: {
    openNow: '영업 중',
    closedNow: '영업 종료',
    openingHours: '오늘 영업시간',
    wifiTitle: '무료 와이파이 (Wi-Fi)',
    copyPassword: '비밀번호 복사하기',
    copied: '복사 완료!',
    directions: '구글 지도 길찾기',
    googleReview: '구글 리뷰 남기기 ⭐',
    promotions: '프로모션 및 공지사항',
    viewMenuFnb: '메뉴판 보기 & 주문하기',
    viewMenuService: '서비스 가격표 보기',
    viewMenuRetail: '상품 카탈로그 보기',
    searchPlaceholder: '메뉴, 서비스, 상품 검색...',
    allCategories: '전체',
    soldOut: '품절',
    bestSeller: '인기',
    durationMins: '분',
    addToOrder: '주문 목록에 담기',
    customNotePlaceholder: '추가 요청사항 (예: 고수 빼주세요...)',
    quickTagsTitle: '빠른 요청 태그',
    bottomCtaFnb: '주문 내역 확인 & 바로 주문하기',
    bottomCtaService: '선택 서비스 확인 & 예약 접수',
    bottomCtaRetail: '장바구니 확인 & 주문하기',
    bottomBarHint: '🚀 직원 호출 없이 카운터 및 주방으로 주문이 즉시 전송됩니다',
    showToStaffHeader: '주문 확인 및 카운터 전송',
    showToStaffSub: '선택한 메뉴와 테이블 번호를 확인한 후 아래 주문 전송 버튼을 눌러주세요',
    totalEstimated: '예상 합계 금액',
    sendZaloOrder: 'Zalo로 주문 전송',
    clearSelection: '목록 비우기',
    backToStore: '매장 정보',
    requiredBadge: '필수',
    optionalBadge: '선택 사항 (다중 선택)',
    stockLeftPrefix: '잔여 ',
    stockLeftSuffix: '개',
    qtyShort: '수량',
    unitPriceLabel: '단가',
    notePrefix: '요청사항',
    cashPayment: '현금 결제 (Cash)',
    qrPayment: 'QR 계좌이체',
    tablePrefix: '테이블',
    tableSelectorLabel: '테이블:',
    takeawayOption: '포장 (Takeaway)',
    noTableSelected: '테이블 미선택',
    selectTableBeforeSendError:
      '주문을 전송하기 전에 이용 중인 테이블이나 포장(Takeaway)을 선택해 주세요.',
    tableConfirmationRequiredTitle: '테이블 다시 확인 필요',
    tableQrUnavailableTitle:
      '테이블 QR을 사용할 수 없습니다 — 이용 가능한 테이블이나 포장을 선택해 주세요',
    tableQrInvalidError:
      '유효하지 않거나 이 매장에 속하지 않은 테이블 QR입니다. 이용 가능한 테이블이나 포장을 선택해 주세요.',
    tableInactiveError: (tableName) =>
      `"${tableName}" 테이블은 현재 이용할 수 없습니다. 다른 테이블이나 포장을 선택해 주세요.`,
    tableNotFoundError: (tableQuery) =>
      `이 매장에서 "${tableQuery}" 테이블을 찾을 수 없습니다. 이용 가능한 테이블이나 포장을 선택해 주세요.`,
    tablesLoadError:
      '매장 테이블 목록을 불러올 수 없습니다. 다시 시도해 주세요.',
    noActiveTablesTakeawayHint:
      '현재 이용 가능한 매장 내 테이블이 없습니다. "포장 (Takeaway)"을 선택하여 주문하실 수 있습니다.',
    qrNotConfiguredNotice:
      '이 매장은 온라인 QR 결제가 설정되어 있지 않습니다. 테이블이나 카운터에서 직원에게 직접 결제해 주세요.',
    editingOrderHint:
      '카운터로 전송하기 전에 메뉴를 확인하고 수량을 조절하거나 메뉴를 추가해 주세요.',
    addMoreItemsBtn: '+ 메뉴 추가',
    keepingExistingTablePrefix: (orderCode) =>
      `주문 #${orderCode}의 기존 테이블 유지: `,
    retryBtn: '다시 시도',
    submitOrderError: '주문을 전송할 수 없습니다. 다시 시도해 주세요.',
    closeOrderModalAria: '주문 창 닫기',
    closeItemDetailAria: '메뉴 상세 닫기',
    closePromoPopupAria: '프로모션 팝업 닫기',
    paymentMethodGroupAria: '결제 수단',
    decreaseQtyAria: (itemName) => `${itemName} 수량 줄이기`,
    increaseQtyAria: (itemName) => `${itemName} 수량 늘리기`,
    clearSearchAria: '검색어 지우기',
    selectLanguageAria: '언어 선택',
    selectLanguageTitle: '언어 선택',
    languagesCount: (count) => `${count}개 언어`,
    loadingMenu: '다국어 메뉴를 불러오는 중...',
    loadingShopInfo: '매장 정보를 불러오는 중...',
    menuNotFoundTitle: '매장 메뉴를 찾을 수 없습니다',
    shopNotFoundTitle: '매장을 찾을 수 없습니다',
    backToExplore: '매장 탐색으로 돌아가기',
    promosShort: '혜택',
    pinnedBadge: '고정됨',
    emptyCartTitle: '선택된 메뉴나 서비스가 없습니다',
    backToMenuBtn: '메뉴판으로 돌아가기',
    liveOrderSentPrefix: '주문 ',
    liveOrderSentSuffix: ' 카운터 접수 완료',
    liveOrderBannerSub: '터치하여 실시간 조리 및 서빙 상태를 확인하세요',
    viewOrderBtn: '진행 보기',
    orderItemsSentHeading: '카운터로 전송된 주문 내역',
    autoNotifiedSub: '카운터와 주방에 주문 알림이 자동으로 전달되었습니다',
    kitchenBilingualNote: '정확한 조리를 위해 각 메뉴 아래에 베트남어 원문이 함께 표기됩니다',
  },
  ja: {
    openNow: '営業中',
    closedNow: '営業時間外',
    openingHours: '本日の営業時間',
    wifiTitle: '無料 Wi-Fi',
    copyPassword: 'パスワードをコピー',
    copied: 'コピーしました！',
    directions: 'Googleマップで経路案内',
    googleReview: 'Googleでクチコミを書く ⭐',
    promotions: 'キャンペーン・お知らせ',
    viewMenuFnb: 'メニューを見る・注文する',
    viewMenuService: 'サービス料金表を見る',
    viewMenuRetail: '商品カタログを見る',
    searchPlaceholder: 'メニュー・サービス・商品を検索...',
    allCategories: 'すべて',
    soldOut: '売り切れ',
    bestSeller: '人気No.1',
    durationMins: '分',
    addToOrder: '注文リストに追加',
    customNotePlaceholder: 'ご要望（例：パクチー抜きなど）',
    quickTagsTitle: 'クイックメモ',
    bottomCtaFnb: '注文内容を確認して送信する',
    bottomCtaService: '選択メニューを確認して予約送信',
    bottomCtaRetail: 'カートを確認して注文する',
    bottomBarHint: '🚀 スタッフを呼ばずにそのままレジ・キッチンへ注文を送信できます',
    showToStaffHeader: 'ご注文内容の確認・オーダー送信',
    showToStaffSub: 'メニューとテーブル番号をご確認の上、下のボタンから注文を送信してください',
    totalEstimated: '合計目安',
    sendZaloOrder: 'Zaloで送信',
    clearSelection: 'クリア',
    backToStore: '店舗情報',
    requiredBadge: '必須',
    optionalBadge: 'オプション（複数選択可）',
    stockLeftPrefix: '残り ',
    stockLeftSuffix: '点',
    qtyShort: '数量',
    unitPriceLabel: '単価',
    notePrefix: 'メモ',
    cashPayment: '現金払い (Cash)',
    qrPayment: 'QR銀行振込',
    tablePrefix: 'テーブル',
    tableSelectorLabel: 'テーブル:',
    takeawayOption: 'お持ち帰り',
    noTableSelected: 'テーブル未選択',
    selectTableBeforeSendError:
      '注文を送信する前に、ご利用のテーブルまたはお持ち帰りを選択してください。',
    tableConfirmationRequiredTitle: 'テーブルの再確認が必要です',
    tableQrUnavailableTitle:
      'テーブルQRが利用できません — 利用可能なテーブルまたはお持ち帰りを選択してください',
    tableQrInvalidError:
      'このテーブルQRは無効か、この店舗のものではありません。利用可能なテーブルまたはお持ち帰りを選択してください。',
    tableInactiveError: (tableName) =>
      `テーブル「${tableName}」は現在ご利用いただけません。別のテーブルまたはお持ち帰りを選択してください。`,
    tableNotFoundError: (tableQuery) =>
      `この店舗でテーブル「${tableQuery}」が見つかりませんでした。利用可能なテーブルまたはお持ち帰りを選択してください。`,
    tablesLoadError:
      '店舗のテーブル一覧を読み込めませんでした。もう一度お試しください。',
    noActiveTablesTakeawayHint:
      '現在利用可能な店内テーブルがありません。「お持ち帰り」を選択して注文できます。',
    qrNotConfiguredNotice:
      'この店舗ではオンラインQR決済が設定されていません。テーブルまたはレジにてスタッフへ直接お支払いください。',
    editingOrderHint:
      '送信前にメニュー内容の確認、数量の変更、または追加を行ってください。',
    addMoreItemsBtn: '+ メニュー追加',
    keepingExistingTablePrefix: (orderCode) =>
      `注文 #${orderCode} の現在のテーブルを維持: `,
    retryBtn: '再試行',
    submitOrderError: '注文を送信できませんでした。もう一度お試しください。',
    closeOrderModalAria: '注文画面を閉じる',
    closeItemDetailAria: '商品詳細を閉じる',
    closePromoPopupAria: 'キャンペーン画面を閉じる',
    paymentMethodGroupAria: 'お支払い方法',
    decreaseQtyAria: (itemName) => `${itemName} の数量を減らす`,
    increaseQtyAria: (itemName) => `${itemName} の数量を増やす`,
    clearSearchAria: '検索キーワードをクリア',
    selectLanguageAria: '言語を選択',
    selectLanguageTitle: '言語を選択',
    languagesCount: (count) => `${count}言語`,
    loadingMenu: '多言語メニューを読み込み中...',
    loadingShopInfo: '店舗情報を読み込み中...',
    menuNotFoundTitle: 'メニューが見つかりません',
    shopNotFoundTitle: '店舗が見つかりません',
    backToExplore: '店舗一覧へ戻る',
    promosShort: '特典',
    pinnedBadge: '固定',
    emptyCartTitle: '選択されたメニュー・サービスはありません',
    backToMenuBtn: 'メニューに戻る',
    liveOrderSentPrefix: '注文 ',
    liveOrderSentSuffix: ' を送信しました',
    liveOrderBannerSub: 'タップして調理・提供状況をリアルタイムで確認',
    viewOrderBtn: '状況を見る',
    orderItemsSentHeading: 'キッチンへ送信済みの注文内容',
    autoNotifiedSub: 'レジとキッチンへ自動的に通知されました',
    kitchenBilingualNote: '正確な調理のため、各メニューの下にベトナム語名を併記しています',
  },
  zh: {
    openNow: '营业中',
    closedNow: '已打烊',
    openingHours: '今日营业时间',
    wifiTitle: '免费 Wi-Fi',
    copyPassword: '点击复制密码',
    copied: '密码已复制！',
    directions: 'Google 地图导航',
    googleReview: '在 Google 上给 5⭐ 好评',
    promotions: '门店优惠与公告',
    viewMenuFnb: '查看菜单 & 点餐',
    viewMenuService: '查看服务价目表',
    viewMenuRetail: '查看商品目录',
    searchPlaceholder: '搜索菜品、服务、商品...',
    allCategories: '全部',
    soldOut: '已售罄',
    bestSeller: '招牌推荐',
    durationMins: '分钟',
    addToOrder: '加入点餐清单',
    customNotePlaceholder: '备注需求（如：不要香菜、过敏等）',
    quickTagsTitle: '快捷备注',
    bottomCtaFnb: '查看已选餐品 & 立即下单',
    bottomCtaService: '查看已选服务 & 立即预约',
    bottomCtaRetail: '查看购物袋 & 立即下单',
    bottomBarHint: '🚀 无需呼叫店员，点击直接发送订单至吧台与后厨',
    showToStaffHeader: '确认您的订单并发送至吧台',
    showToStaffSub: '请核对餐品、桌号与支付方式，点击底部按钮直接下单',
    totalEstimated: '预计总计',
    sendZaloOrder: '通过 Zalo 发送',
    clearSelection: '清空清单',
    backToStore: '门店主页',
    requiredBadge: '必选',
    optionalBadge: '可选加料（可多选）',
    stockLeftPrefix: '仅剩 ',
    stockLeftSuffix: ' 份',
    qtyShort: '数量',
    unitPriceLabel: '单价',
    notePrefix: '备注',
    cashPayment: '现金支付 (Cash)',
    qrPayment: 'QR 扫码转账',
    tablePrefix: '桌号',
    tableSelectorLabel: '桌号:',
    takeawayOption: '打包带走',
    noTableSelected: '未选择桌号',
    selectTableBeforeSendError:
      '发送订单前，请先选择就餐桌号或选择打包带走。',
    tableConfirmationRequiredTitle: '需要重新确认桌号',
    tableQrUnavailableTitle:
      '桌号二维码不可用 — 请重新选择可用桌号或打包带走',
    tableQrInvalidError:
      '二维码中的桌号无效或不属于本店，请选择可用桌号或打包带走。',
    tableInactiveError: (tableName) =>
      `桌号“${tableName}”当前暂停服务，请选择其他桌号或打包带走。`,
    tableNotFoundError: (tableQuery) =>
      `未在本店找到桌号“${tableQuery}”，请选择可用桌号或打包带走。`,
    tablesLoadError: '无法加载门店桌号列表，请重试。',
    noActiveTablesTakeawayHint:
      '当前暂无开放的堂食桌号，您可以选择“打包带走”提交订单。',
    qrNotConfiguredNotice:
      '本店暂未配置在线 QR 收款码，请在餐桌或吧台直接向店员付款。',
    editingOrderHint:
      '发送至吧台前，请核对餐品、调整数量或继续加菜。',
    addMoreItemsBtn: '+ 继续加菜',
    keepingExistingTablePrefix: (orderCode) =>
      `保持订单 #${orderCode} 的原桌号：`,
    retryBtn: '重试',
    submitOrderError: '无法发送订单，请重试。',
    closeOrderModalAria: '关闭点餐窗口',
    closeItemDetailAria: '关闭菜品详情',
    closePromoPopupAria: '关闭优惠弹窗',
    paymentMethodGroupAria: '支付方式',
    decreaseQtyAria: (itemName) => `减少 ${itemName} 数量`,
    increaseQtyAria: (itemName) => `增加 ${itemName} 数量`,
    clearSearchAria: '清除搜索词',
    selectLanguageAria: '选择语言',
    selectLanguageTitle: '选择语言',
    languagesCount: (count) => `${count} 种语言`,
    loadingMenu: '正在加载多语言菜单...',
    loadingShopInfo: '正在加载门店信息...',
    menuNotFoundTitle: '未找到门店菜单',
    shopNotFoundTitle: '未找到门店',
    backToExplore: '返回探索页面',
    promosShort: '优惠',
    pinnedBadge: '置顶',
    emptyCartTitle: '暂未选择任何餐品或服务',
    backToMenuBtn: '返回菜单点餐',
    liveOrderSentPrefix: '订单 ',
    liveOrderSentSuffix: ' 已发送至吧台',
    liveOrderBannerSub: '点击实时查看后厨制作与上菜进度',
    viewOrderBtn: '查看进度',
    orderItemsSentHeading: '已发送至吧台的餐品明细',
    autoNotifiedSub: '收银台与后厨已自动收到您的订单通知',
    kitchenBilingualNote: '每道菜品下方附带越南语原名，确保后厨准确备餐',
  },
  es: {
    openNow: 'Abierto ahora',
    closedNow: 'Cerrado',
    openingHours: 'Horario de hoy',
    wifiTitle: 'Wi-Fi Gratis',
    copyPassword: 'Toca para copiar contraseña',
    copied: '¡Contraseña copiada!',
    directions: 'Cómo llegar (Google Maps)',
    googleReview: 'Valóranos 5⭐ en Google',
    promotions: 'Ofertas y Novedades',
    viewMenuFnb: 'Ver Menú y Pedir',
    viewMenuService: 'Ver Lista de Precios y Servicios',
    viewMenuRetail: 'Ver Catálogo de Productos',
    searchPlaceholder: 'Buscar platos, servicios, productos...',
    allCategories: 'Todos',
    soldOut: 'Agotado',
    bestSeller: 'Popular',
    durationMins: 'min',
    addToOrder: 'Añadir al pedido',
    customNotePlaceholder: 'Notas especiales (ej. sin cilantro, alergias...)',
    quickTagsTitle: 'Notas rápidas',
    bottomCtaFnb: 'Revisar pedido y enviar a cocina',
    bottomCtaService: 'Revisar servicios y confirmar cita',
    bottomCtaRetail: 'Ver carrito y confirmar pedido',
    bottomBarHint: '🚀 Envía tu pedido directamente al mostrador y cocina en tiempo real',
    showToStaffHeader: 'REVISAR Y CONFIRMAR TU PEDIDO',
    showToStaffSub: 'Verifica tus platos, elige tu mesa y envía el pedido directamente a cocina',
    totalEstimated: 'Total estimado',
    sendZaloOrder: 'Enviar por Zalo',
    clearSelection: 'Vaciar todo',
    backToStore: 'Info del local',
    requiredBadge: 'Obligatorio',
    optionalBadge: 'Opcional / Extras',
    stockLeftPrefix: 'Quedan ',
    stockLeftSuffix: '',
    qtyShort: 'CANT',
    unitPriceLabel: 'Precio unitario',
    notePrefix: 'Nota',
    cashPayment: 'Efectivo (Cash)',
    qrPayment: 'Transferencia QR',
    tablePrefix: 'Mesa',
    tableSelectorLabel: 'Mesa:',
    takeawayOption: 'Para llevar',
    noTableSelected: 'Sin mesa seleccionada',
    selectTableBeforeSendError:
      'Por favor selecciona una mesa activa o Para llevar antes de enviar tu pedido al mostrador.',
    tableConfirmationRequiredTitle: 'Se requiere confirmar la mesa',
    tableQrUnavailableTitle:
      'QR de mesa no disponible — selecciona una mesa activa o Para llevar',
    tableQrInvalidError:
      'El código QR de mesa no es válido o no pertenece a este local. Selecciona una mesa activa o Para llevar.',
    tableInactiveError: (tableName) =>
      `La mesa "${tableName}" no está disponible en este momento. Selecciona otra mesa o Para llevar.`,
    tableNotFoundError: (tableQuery) =>
      `No se encontró la mesa "${tableQuery}" en este local. Selecciona una mesa activa o Para llevar.`,
    tablesLoadError:
      'No se pudo cargar la lista de mesas del local. Inténtalo de nuevo.',
    noActiveTablesTakeawayHint:
      'Actualmente no hay mesas activas en el local. Puedes elegir "Para llevar" para enviar tu pedido.',
    qrNotConfiguredNotice:
      'El pago QR en línea no está configurado en este local. Por favor paga con el personal en tu mesa o en el mostrador.',
    editingOrderHint:
      'Revisa tus platos, ajusta las cantidades o añade más antes de enviar al mostrador.',
    addMoreItemsBtn: '+ Añadir platos',
    keepingExistingTablePrefix: (orderCode) =>
      `Manteniendo la mesa actual del pedido #${orderCode}: `,
    retryBtn: 'Reintentar',
    submitOrderError: 'No se pudo enviar el pedido. Inténtalo de nuevo.',
    closeOrderModalAria: 'Cerrar ventana de pedido',
    closeItemDetailAria: 'Cerrar detalles del plato',
    closePromoPopupAria: 'Cerrar ventana de promoción',
    paymentMethodGroupAria: 'Método de pago',
    decreaseQtyAria: (itemName) => `Disminuir cantidad de ${itemName}`,
    increaseQtyAria: (itemName) => `Aumentar cantidad de ${itemName}`,
    clearSearchAria: 'Borrar búsqueda',
    selectLanguageAria: 'Seleccionar idioma',
    selectLanguageTitle: 'Seleccionar idioma',
    languagesCount: (count) => `${count} idiomas`,
    loadingMenu: 'Cargando menú multilingüe...',
    loadingShopInfo: 'Cargando información del local...',
    menuNotFoundTitle: 'Menú del local no encontrado',
    shopNotFoundTitle: 'Local no encontrado',
    backToExplore: 'Volver a Explorar',
    promosShort: 'Ofertas',
    pinnedBadge: 'Fijado',
    emptyCartTitle: 'Aún no has seleccionado ningún plato o servicio',
    backToMenuBtn: 'Volver al menú',
    liveOrderSentPrefix: 'Pedido ',
    liveOrderSentSuffix: ' enviado a cocina',
    liveOrderBannerSub: 'Toca para ver el estado de preparación en vivo',
    viewOrderBtn: 'Ver pedido',
    orderItemsSentHeading: 'Detalle del pedido enviado a cocina',
    autoNotifiedSub: 'El mostrador y la cocina han recibido tu pedido automáticamente',
    kitchenBilingualNote: 'El nombre en vietnamita se incluye debajo para mayor precisión en cocina',
  },
  it: {
    openNow: 'Aperto ora',
    closedNow: 'Chiuso',
    openingHours: 'Orari di oggi',
    wifiTitle: 'Wi-Fi Gratuito',
    copyPassword: 'Tocca per copiare la password',
    copied: 'Password copiata!',
    directions: 'Indicazioni su Google Maps',
    googleReview: 'Lascia una recensione 5⭐',
    promotions: 'Offerte Speciali e Novità',
    viewMenuFnb: 'Vedi Menu e Ordina',
    viewMenuService: 'Vedi Listino Servizi',
    viewMenuRetail: 'Sfoglia Catalogo Prodotti',
    searchPlaceholder: 'Cerca piatti, servizi, prodotti...',
    allCategories: 'Tutti',
    soldOut: 'Esaurito',
    bestSeller: 'Popolare',
    durationMins: 'min',
    addToOrder: "Aggiungi all'ordine",
    customNotePlaceholder: 'Richieste speciali (es. senza coriandolo, allergie...)',
    quickTagsTitle: 'Note rapide',
    bottomCtaFnb: 'Rivedi ordine e invia in cucina',
    bottomCtaService: 'Rivedi servizi e conferma prenotazione',
    bottomCtaRetail: 'Vedi carrello e conferma ordine',
    bottomBarHint: '🚀 Invia il tuo ordine direttamente alla cassa e in cucina in tempo reale',
    showToStaffHeader: 'RIVEDI E CONFERMA IL TUO ORDINE',
    showToStaffSub: 'Controlla i piatti scelti, seleziona il tavolo e invia direttamente in cucina',
    totalEstimated: 'Totale stimato',
    sendZaloOrder: 'Invia tramite Zalo',
    clearSelection: 'Svuota tutto',
    backToStore: 'Info locale',
    requiredBadge: 'Obbligatorio',
    optionalBadge: 'Opzionale / Extra',
    stockLeftPrefix: 'Ultimi ',
    stockLeftSuffix: '',
    qtyShort: 'QTÀ',
    unitPriceLabel: 'Prezzo unitario',
    notePrefix: 'Nota',
    cashPayment: 'Contanti (Cash)',
    qrPayment: 'Bonifico QR',
    tablePrefix: 'Tavolo',
    tableSelectorLabel: 'Tavolo:',
    takeawayOption: 'Da asporto',
    noTableSelected: 'Nessun tavolo selezionato',
    selectTableBeforeSendError:
      'Seleziona un tavolo attivo o Da asporto prima di inviare l’ordine alla cassa.',
    tableConfirmationRequiredTitle: 'Conferma del tavolo richiesta',
    tableQrUnavailableTitle:
      'QR del tavolo non disponibile — seleziona un tavolo attivo o Da asporto',
    tableQrInvalidError:
      'Il codice QR del tavolo non è valido o non appartiene a questo locale. Seleziona un tavolo attivo o Da asporto.',
    tableInactiveError: (tableName) =>
      `Il tavolo "${tableName}" è attualmente non disponibile. Seleziona un altro tavolo o Da asporto.`,
    tableNotFoundError: (tableQuery) =>
      `Tavolo "${tableQuery}" non trovato in questo locale. Seleziona un tavolo attivo o Da asporto.`,
    tablesLoadError:
      'Impossibile caricare l’elenco dei tavoli del locale. Riprova.',
    noActiveTablesTakeawayHint:
      'Al momento non ci sono tavoli attivi in sala. Puoi selezionare "Da asporto" per inviare l’ordine.',
    qrNotConfiguredNotice:
      'Il pagamento QR online non è configurato per questo locale. Paga direttamente al personale al tavolo o alla cassa.',
    editingOrderHint:
      'Controlla i piatti, modifica le quantità o aggiungine altri prima di inviare alla cassa.',
    addMoreItemsBtn: '+ Aggiungi piatti',
    keepingExistingTablePrefix: (orderCode) =>
      `Mantenimento del tavolo attuale per l’ordine #${orderCode}: `,
    retryBtn: 'Riprova',
    submitOrderError: 'Impossibile inviare l’ordine. Riprova.',
    closeOrderModalAria: 'Chiudi finestra ordine',
    closeItemDetailAria: 'Chiudi dettagli piatto',
    closePromoPopupAria: 'Chiudi finestra promozione',
    paymentMethodGroupAria: 'Metodo di pagamento',
    decreaseQtyAria: (itemName) => `Diminuisci quantità di ${itemName}`,
    increaseQtyAria: (itemName) => `Aumenta quantità di ${itemName}`,
    clearSearchAria: 'Cancella ricerca',
    selectLanguageAria: 'Seleziona lingua',
    selectLanguageTitle: 'Seleziona lingua',
    languagesCount: (count) => `${count} lingue`,
    loadingMenu: 'Caricamento menu multilingue...',
    loadingShopInfo: 'Caricamento informazioni del locale...',
    menuNotFoundTitle: 'Menu del locale non trovato',
    shopNotFoundTitle: 'Locale non trovato',
    backToExplore: 'Torna a Esplora',
    promosShort: 'Offerte',
    pinnedBadge: 'In evidenza',
    emptyCartTitle: 'Non hai ancora selezionato alcun piatto o servizio',
    backToMenuBtn: 'Torna al menu',
    liveOrderSentPrefix: 'Ordine ',
    liveOrderSentSuffix: ' inviato in cucina',
    liveOrderBannerSub: 'Tocca per seguire la preparazione in tempo reale',
    viewOrderBtn: 'Segui ordine',
    orderItemsSentHeading: 'Dettagli ordine inviato in cucina',
    autoNotifiedSub: 'La cassa e la cucina hanno ricevuto la notifica automaticamente',
    kitchenBilingualNote: 'Il nome in vietnamita è mostrato sotto ogni piatto per la cucina',
  },
  ru: {
    openNow: 'Открыто',
    closedNow: 'Закрыто',
    openingHours: 'Часы работы сегодня',
    wifiTitle: 'Бесплатный Wi-Fi',
    copyPassword: 'Нажмите, чтобы скопировать пароль',
    copied: 'Пароль скопирован!',
    directions: 'Маршрут в Google Картах',
    googleReview: 'Оцените нас на 5⭐ в Google',
    promotions: 'Акции и специальные предложения',
    viewMenuFnb: 'Открыть меню и заказать',
    viewMenuService: 'Прайс-лист на услуги',
    viewMenuRetail: 'Каталог товаров',
    searchPlaceholder: 'Поиск блюд, услуг, товаров...',
    allCategories: 'Все',
    soldOut: 'Продано',
    bestSeller: 'Хит продаж',
    durationMins: 'мин',
    addToOrder: 'Добавить в заказ',
    customNotePlaceholder: 'Пожелания (напр.: без кинзы, аллергия...)',
    quickTagsTitle: 'Быстрые пометки',
    bottomCtaFnb: 'Проверить заказ и отправить на кухню',
    bottomCtaService: 'Проверить услуги и записаться',
    bottomCtaRetail: 'Корзина и подтверждение заказа',
    bottomBarHint: '🚀 Отправьте заказ напрямую на кассу и кухню без ожидания официанта',
    showToStaffHeader: 'ПРОВЕРКА И ОТПРАВКА ЗАКАЗА',
    showToStaffSub: 'Проверьте выбранные позиции, укажите номер стола и отправьте заказ на кухню',
    totalEstimated: 'Итого к оплате',
    sendZaloOrder: 'Отправить через Zalo',
    clearSelection: 'Очистить всё',
    backToStore: 'О заведении',
    requiredBadge: 'Обязательно',
    optionalBadge: 'Дополнительно (необязательно)',
    stockLeftPrefix: 'Осталось ',
    stockLeftSuffix: ' шт.',
    qtyShort: 'КОЛ',
    unitPriceLabel: 'Цена за шт.',
    notePrefix: 'Прим.',
    cashPayment: 'Наличные (Cash)',
    qrPayment: 'Оплата по QR',
    tablePrefix: 'Стол',
    tableSelectorLabel: 'Стол:',
    takeawayOption: 'С собой',
    noTableSelected: 'Стол не выбран',
    selectTableBeforeSendError:
      'Пожалуйста, выберите активный стол или «С собой» перед отправкой заказа на кассу.',
    tableConfirmationRequiredTitle: 'Требуется подтверждение стола',
    tableQrUnavailableTitle:
      'QR-код стола недоступен — выберите активный стол или «С собой»',
    tableQrInvalidError:
      'QR-код стола недействителен или не принадлежит этому заведению. Выберите активный стол или «С собой».',
    tableInactiveError: (tableName) =>
      `Стол «${tableName}» временно не обслуживается. Пожалуйста, выберите другой стол или «С собой».`,
    tableNotFoundError: (tableQuery) =>
      `Стол «${tableQuery}» не найден в этом заведении. Выберите активный стол или «С собой».`,
    tablesLoadError:
      'Не удалось загрузить список столов заведения. Попробуйте ещё раз.',
    noActiveTablesTakeawayHint:
      'Сейчас нет активных столов в зале. Вы можете выбрать «С собой», чтобы отправить заказ.',
    qrNotConfiguredNotice:
      'Онлайн QR-оплата не настроена для этого заведения. Пожалуйста, оплатите сотруднику за столом или на кассе.',
    editingOrderHint:
      'Проверьте блюда, измените количество или добавьте позиции перед отправкой на кассу.',
    addMoreItemsBtn: '+ Добавить блюда',
    keepingExistingTablePrefix: (orderCode) =>
      `Сохраняется текущий стол для заказа #${orderCode}: `,
    retryBtn: 'Повторить',
    submitOrderError: 'Не удалось отправить заказ. Попробуйте ещё раз.',
    closeOrderModalAria: 'Закрыть окно заказа',
    closeItemDetailAria: 'Закрыть описание блюда',
    closePromoPopupAria: 'Закрыть окно акции',
    paymentMethodGroupAria: 'Способ оплаты',
    decreaseQtyAria: (itemName) => `Уменьшить количество ${itemName}`,
    increaseQtyAria: (itemName) => `Увеличить количество ${itemName}`,
    clearSearchAria: 'Очистить поиск',
    selectLanguageAria: 'Выбрать язык',
    selectLanguageTitle: 'Выбрать язык',
    languagesCount: (count) => `${count} яз.`,
    loadingMenu: 'Загрузка многоязычного меню...',
    loadingShopInfo: 'Загрузка информации о заведении...',
    menuNotFoundTitle: 'Меню заведения не найдено',
    shopNotFoundTitle: 'Заведение не найдено',
    backToExplore: 'Вернуться к обзору',
    promosShort: 'Акции',
    pinnedBadge: 'Закреплено',
    emptyCartTitle: 'Вы ещё не выбрали блюда или услуги',
    backToMenuBtn: 'Вернуться в меню',
    liveOrderSentPrefix: 'Заказ ',
    liveOrderSentSuffix: ' отправлен на кухню',
    liveOrderBannerSub: 'Нажмите, чтобы отслеживать статус приготовления онлайн',
    viewOrderBtn: 'Статус заказа',
    orderItemsSentHeading: 'Детали отправленного заказа',
    autoNotifiedSub: 'Касса и кухня автоматически получили ваш заказ',
    kitchenBilingualNote: 'Вьетнамское название указано ниже для точности приготовления на кухне',
  },
};

export function localizeStorefrontTableError(
  error: string | null | undefined,
  locale: SupportedLocale
): string | null {
  if (!error) return null;
  const trimmed = error.trim();
  if (!trimmed) return null;
  const labels = UI_LABELS[locale] || UI_LABELS.vi;

  if (
    trimmed === UI_LABELS.vi.tableQrInvalidError ||
    trimmed === UI_LABELS.en.tableQrInvalidError
  ) {
    return labels.tableQrInvalidError;
  }

  const viInactiveMatch = trimmed.match(
    /^Bàn "(.+)" hiện đang tạm ngưng phục vụ\. Vui lòng chọn bàn khác hoặc Mang về\.$/
  );
  if (viInactiveMatch) {
    return labels.tableInactiveError(viInactiveMatch[1]);
  }

  const enInactiveMatch = trimmed.match(
    /^Table "(.+)" is currently unavailable\. Please select another table or Takeaway\.$/
  );
  if (enInactiveMatch) {
    return labels.tableInactiveError(enInactiveMatch[1]);
  }

  const viNotFoundMatch = trimmed.match(
    /^Không tìm thấy bàn "(.+)" tại quán này\. Vui lòng chọn bàn đang hoạt động hoặc Mang về\.$/
  );
  if (viNotFoundMatch) {
    return labels.tableNotFoundError(viNotFoundMatch[1]);
  }

  const enNotFoundMatch = trimmed.match(
    /^Table "(.+)" was not found at this shop\. Please select an active table or Takeaway\.$/
  );
  if (enNotFoundMatch) {
    return labels.tableNotFoundError(enNotFoundMatch[1]);
  }

  if (
    trimmed === UI_LABELS.vi.tablesLoadError ||
    trimmed === UI_LABELS.en.tablesLoadError
  ) {
    return labels.tablesLoadError;
  }

  return error;
}

export interface GuestOrderLabelSet {
  shopClosedTitle: string;
  shopClosedSub: (open: string, close: string) => string;
  shopClosedDayOff: string;
  shopClosedSubmitDisabled: string;
  tableLockedTitle: string;
  tableLockedHint: string;
  rescanTableQrHint: string;
  errorShopClosed: string;
  errorItemUnavailable: string;
  errorInsufficientStock: string;
  errorOrderAccepted: string;
  errorPriceChanged: string;
  errorTableInvalid: string;
  errorTableInactive: string;
  errorTrackingToken: string;
  errorGeneric: string;
  statusCancelledTitle: string;
  statusCancelledSub: string;
  paidBadge: string;
  unpaidBadge: string;
  thankYouTitle: string;
  thankYouSub: string;
  cancelOrderBtn: string;
  cancelOrderConfirm: string;
  cancellingOrder: string;
  clearSelectionConfirm: string;
  dismissOrderBtn: string;
}

const GUEST_ORDER_LABELS_EN: GuestOrderLabelSet = {
  shopClosedTitle: 'The shop is currently closed',
  shopClosedSub: (open, close) =>
    `Today's hours: ${open} – ${close}. You can browse the menu, but orders can only be sent during opening hours.`,
  shopClosedDayOff:
    'The shop is closed today. You can browse the menu, but ordering is unavailable.',
  shopClosedSubmitDisabled: 'Ordering is unavailable while the shop is closed',
  tableLockedTitle: 'Your table',
  tableLockedHint: 'Assigned from the table QR code',
  rescanTableQrHint:
    'Scan the QR code at your table to order for dine-in, or select Takeaway.',
  errorShopClosed:
    'The shop is closed right now and cannot accept orders. Please come back during opening hours.',
  errorItemUnavailable:
    'One or more items are no longer available. Please remove them and try again.',
  errorInsufficientStock:
    'Some items do not have enough stock left. Please reduce the quantity and try again.',
  errorOrderAccepted:
    'The counter has already accepted (or you have paid for) this order, so it can no longer be changed. Please ask the staff.',
  errorPriceChanged:
    'Prices or promotions have changed. Please review your order total and send again.',
  errorTableInvalid:
    'This table is not valid for this shop. Please select an active table or Takeaway.',
  errorTableInactive:
    'This table is currently unavailable. Please select another table or Takeaway.',
  errorTrackingToken:
    'This order can no longer be tracked from this device. Please ask the staff.',
  errorGeneric: 'Unable to send order. Please try again.',
  statusCancelledTitle: 'Order cancelled',
  statusCancelledSub:
    'This order has been cancelled. Please ask the staff if you have any questions.',
  paidBadge: 'Paid',
  unpaidBadge: 'Not paid yet',
  thankYouTitle: 'Thank you!',
  thankYouSub: 'Your order is complete. We hope you enjoyed it — see you again soon!',
  cancelOrderBtn: 'Cancel this order',
  cancelOrderConfirm:
    'Cancel this order? The counter has not accepted it yet, so it will be cancelled immediately.',
  cancellingOrder: 'Cancelling order...',
  clearSelectionConfirm: 'Remove all selected items?',
  dismissOrderBtn: 'Close & start a new order',
};

/**
 * Guest-flow strings (closed banner, table lock, tracker states, localized server
 * errors). Locales may be partial; missing keys fall back to English.
 */
export const GUEST_ORDER_LABELS: Record<
  SupportedLocale,
  Partial<GuestOrderLabelSet>
> = {
  en: GUEST_ORDER_LABELS_EN,
  vi: {
    shopClosedTitle: 'Quán hiện đang đóng cửa',
    shopClosedSub: (open, close) =>
      `Giờ mở cửa hôm nay: ${open} – ${close}. Quý khách vẫn có thể xem thực đơn, nhưng chỉ gửi đơn được trong giờ mở cửa.`,
    shopClosedDayOff:
      'Hôm nay quán nghỉ. Quý khách vẫn có thể xem thực đơn nhưng chưa thể gửi đơn.',
    shopClosedSubmitDisabled: 'Quán đang đóng cửa — tạm chưa nhận đơn',
    tableLockedTitle: 'Bàn của bạn',
    tableLockedHint: 'Đã xác định theo mã QR tại bàn',
    rescanTableQrHint:
      'Quét mã QR tại bàn để gọi món tại bàn, hoặc chọn Mang về.',
    errorShopClosed:
      'Quán hiện đang đóng cửa, chưa thể nhận đơn. Vui lòng quay lại trong giờ mở cửa.',
    errorItemUnavailable:
      'Có món đã tạm hết. Vui lòng bỏ món đó khỏi danh sách và gửi lại.',
    errorInsufficientStock:
      'Một số món không còn đủ số lượng. Vui lòng giảm số lượng và gửi lại.',
    errorOrderAccepted:
      'Quầy đã tiếp nhận (hoặc đơn đã thanh toán) nên không thể tự chỉnh sửa. Vui lòng báo nhân viên.',
    errorPriceChanged:
      'Giá hoặc ưu đãi vừa thay đổi. Vui lòng kiểm tra lại tổng tiền và gửi lại.',
    errorTableInvalid:
      'Bàn không hợp lệ hoặc không thuộc quán này. Vui lòng chọn bàn đang hoạt động hoặc Mang về.',
    errorTableInactive:
      'Bàn này đang tạm ngưng phục vụ. Vui lòng chọn bàn khác hoặc Mang về.',
    errorTrackingToken:
      'Không thể theo dõi đơn này trên thiết bị hiện tại. Vui lòng báo nhân viên.',
    errorGeneric: 'Không thể gửi đơn hàng. Vui lòng thử lại.',
    statusCancelledTitle: 'Đơn hàng đã bị hủy',
    statusCancelledSub:
      'Đơn này đã được hủy. Nếu cần hỗ trợ, vui lòng liên hệ nhân viên.',
    paidBadge: 'Đã thanh toán',
    unpaidBadge: 'Chưa thanh toán',
    thankYouTitle: 'Cảm ơn quý khách!',
    thankYouSub: 'Đơn hàng đã hoàn tất. Chúc quý khách ngon miệng và hẹn gặp lại!',
    cancelOrderBtn: 'Hủy đơn này',
    cancelOrderConfirm:
      'Bạn chắc chắn muốn hủy đơn? Quầy chưa tiếp nhận nên đơn sẽ được hủy ngay.',
    cancellingOrder: 'Đang hủy đơn...',
    clearSelectionConfirm: 'Xóa toàn bộ món đã chọn?',
    dismissOrderBtn: 'Đóng & đặt đơn mới',
  },
  ko: {
    shopClosedTitle: '현재 영업 시간이 아닙니다',
    shopClosedSub: (open, close) =>
      `오늘 영업시간: ${open} – ${close}. 메뉴는 볼 수 있지만 주문은 영업시간에만 가능합니다.`,
    shopClosedDayOff: '오늘은 휴무입니다. 메뉴는 볼 수 있지만 주문은 할 수 없습니다.',
    shopClosedSubmitDisabled: '영업 종료 중에는 주문할 수 없습니다',
    tableLockedTitle: '내 테이블',
    tableLockedHint: '테이블 QR 코드로 지정됨',
    rescanTableQrHint:
      '매장 식사는 테이블의 QR 코드를 스캔하거나 포장을 선택해 주세요.',
    errorShopClosed: '현재 영업 종료로 주문을 받을 수 없습니다. 영업시간에 다시 이용해 주세요.',
    errorItemUnavailable: '품절된 메뉴가 있습니다. 해당 메뉴를 삭제한 후 다시 시도해 주세요.',
    errorInsufficientStock: '재고가 부족한 메뉴가 있습니다. 수량을 줄인 후 다시 시도해 주세요.',
    errorOrderAccepted: '이미 접수(또는 결제)된 주문이라 변경할 수 없습니다. 직원에게 문의해 주세요.',
    errorPriceChanged: '가격 또는 프로모션이 변경되었습니다. 총액을 확인한 후 다시 보내 주세요.',
    errorTableInvalid: '유효하지 않은 테이블입니다. 이용 가능한 테이블 또는 포장을 선택해 주세요.',
    errorTableInactive: '이 테이블은 현재 이용할 수 없습니다. 다른 테이블 또는 포장을 선택해 주세요.',
    errorGeneric: '주문을 보낼 수 없습니다. 다시 시도해 주세요.',
    statusCancelledTitle: '주문이 취소되었습니다',
    statusCancelledSub: '이 주문은 취소되었습니다. 문의 사항은 직원에게 말씀해 주세요.',
    paidBadge: '결제 완료',
    unpaidBadge: '미결제',
    thankYouTitle: '감사합니다!',
    thankYouSub: '주문이 완료되었습니다. 맛있게 드시고 또 방문해 주세요!',
    cancelOrderBtn: '주문 취소',
    cancelOrderConfirm: '주문을 취소하시겠습니까? 아직 접수 전이므로 즉시 취소됩니다.',
    cancellingOrder: '주문 취소 중...',
    clearSelectionConfirm: '선택한 메뉴를 모두 삭제하시겠습니까?',
    dismissOrderBtn: '닫고 새 주문하기',
  },
  ja: {
    shopClosedTitle: '現在営業時間外です',
    shopClosedSub: (open, close) =>
      `本日の営業時間: ${open} – ${close}。メニューは閲覧できますが、注文は営業時間内のみ可能です。`,
    shopClosedDayOff: '本日は定休日です。メニューは閲覧できますが、注文はできません。',
    shopClosedSubmitDisabled: '営業時間外のため注文できません',
    tableLockedTitle: 'あなたのテーブル',
    tableLockedHint: 'テーブルのQRコードで指定済み',
    rescanTableQrHint:
      '店内飲食はテーブルのQRコードをスキャンするか、お持ち帰りを選択してください。',
    errorShopClosed: '現在営業時間外のため注文を受け付けられません。営業時間内に再度お試しください。',
    errorItemUnavailable: '品切れの商品があります。削除してから再度お試しください。',
    errorInsufficientStock: '在庫が不足している商品があります。数量を減らして再度お試しください。',
    errorOrderAccepted: 'この注文はすでに受付済み（または支払い済み）のため変更できません。スタッフにお声がけください。',
    errorPriceChanged: '価格またはキャンペーンが変更されました。合計金額をご確認のうえ再送信してください。',
    errorTableInvalid: '無効なテーブルです。利用可能なテーブルまたはお持ち帰りを選択してください。',
    errorTableInactive: 'このテーブルは現在ご利用いただけません。別のテーブルまたはお持ち帰りを選択してください。',
    errorGeneric: '注文を送信できませんでした。もう一度お試しください。',
    statusCancelledTitle: '注文はキャンセルされました',
    statusCancelledSub: 'この注文はキャンセルされました。ご不明な点はスタッフにお尋ねください。',
    paidBadge: '支払い済み',
    unpaidBadge: '未払い',
    thankYouTitle: 'ありがとうございました！',
    thankYouSub: 'ご注文が完了しました。またのご来店をお待ちしております！',
    cancelOrderBtn: 'この注文をキャンセル',
    cancelOrderConfirm: '注文をキャンセルしますか？まだ受付前のため、すぐにキャンセルされます。',
    cancellingOrder: 'キャンセル中...',
    clearSelectionConfirm: '選択した商品をすべて削除しますか？',
    dismissOrderBtn: '閉じて新しく注文する',
  },
  zh: {
    shopClosedTitle: '本店目前已打烊',
    shopClosedSub: (open, close) =>
      `今日营业时间：${open} – ${close}。您可以浏览菜单，但仅能在营业时间内下单。`,
    shopClosedDayOff: '本店今日休息。您可以浏览菜单，但暂时无法下单。',
    shopClosedSubmitDisabled: '打烊期间无法下单',
    tableLockedTitle: '您的桌号',
    tableLockedHint: '已根据桌上二维码确定',
    rescanTableQrHint: '堂食请扫描桌上的二维码，或选择外带。',
    errorShopClosed: '本店目前已打烊，暂不接单。请在营业时间内再来。',
    errorItemUnavailable: '部分菜品已售罄，请移除后重试。',
    errorInsufficientStock: '部分菜品库存不足，请减少数量后重试。',
    errorOrderAccepted: '订单已被接单（或已付款），无法自行修改。请联系服务员。',
    errorPriceChanged: '价格或优惠已变更，请核对总金额后重新提交。',
    errorTableInvalid: '桌号无效，请选择可用的桌号或外带。',
    errorTableInactive: '该桌暂停服务，请选择其他桌号或外带。',
    errorGeneric: '无法发送订单，请重试。',
    statusCancelledTitle: '订单已取消',
    statusCancelledSub: '该订单已取消。如有疑问请联系服务员。',
    paidBadge: '已付款',
    unpaidBadge: '未付款',
    thankYouTitle: '谢谢光临！',
    thankYouSub: '订单已完成，祝您用餐愉快，欢迎再次光临！',
    cancelOrderBtn: '取消此订单',
    cancelOrderConfirm: '确定取消订单吗？店家尚未接单，订单将立即取消。',
    cancellingOrder: '正在取消订单...',
    clearSelectionConfirm: '确定清空所有已选菜品吗？',
    dismissOrderBtn: '关闭并重新下单',
  },
  es: {
    shopClosedTitle: 'El local está cerrado ahora',
    shopClosedSub: (open, close) =>
      `Horario de hoy: ${open} – ${close}. Puedes ver el menú, pero solo se aceptan pedidos en horario de apertura.`,
    shopClosedDayOff: 'Hoy el local está cerrado. Puedes ver el menú, pero no hacer pedidos.',
    shopClosedSubmitDisabled: 'No se aceptan pedidos mientras el local está cerrado',
    tableLockedTitle: 'Tu mesa',
    tableLockedHint: 'Asignada por el código QR de la mesa',
    rescanTableQrHint:
      'Escanea el código QR en tu mesa para comer aquí, o selecciona Para llevar.',
    errorShopClosed: 'El local está cerrado y no puede aceptar pedidos. Vuelve en horario de apertura.',
    errorItemUnavailable: 'Algún producto ya no está disponible. Elimínalo e inténtalo de nuevo.',
    errorInsufficientStock: 'No hay suficiente stock de algunos productos. Reduce la cantidad e inténtalo de nuevo.',
    errorOrderAccepted: 'El pedido ya fue aceptado (o pagado) y no se puede modificar. Consulta al personal.',
    errorPriceChanged: 'Los precios o promociones han cambiado. Revisa el total y envía de nuevo.',
    errorTableInvalid: 'Mesa no válida. Selecciona una mesa activa o Para llevar.',
    errorTableInactive: 'Esta mesa no está disponible. Selecciona otra mesa o Para llevar.',
    errorGeneric: 'No se pudo enviar el pedido. Inténtalo de nuevo.',
    statusCancelledTitle: 'Pedido cancelado',
    statusCancelledSub: 'Este pedido ha sido cancelado. Consulta al personal si tienes dudas.',
    paidBadge: 'Pagado',
    unpaidBadge: 'Pendiente de pago',
    thankYouTitle: '¡Gracias!',
    thankYouSub: 'Tu pedido está completo. ¡Esperamos verte pronto!',
    cancelOrderBtn: 'Cancelar este pedido',
    cancelOrderConfirm: '¿Cancelar el pedido? Aún no ha sido aceptado, se cancelará de inmediato.',
    cancellingOrder: 'Cancelando pedido...',
    clearSelectionConfirm: '¿Eliminar todos los productos seleccionados?',
    dismissOrderBtn: 'Cerrar y hacer un nuevo pedido',
  },
  it: {
    shopClosedTitle: 'Il locale è attualmente chiuso',
    shopClosedSub: (open, close) =>
      `Orario di oggi: ${open} – ${close}. Puoi consultare il menu, ma gli ordini sono accettati solo durante l'orario di apertura.`,
    shopClosedDayOff: 'Oggi il locale è chiuso. Puoi consultare il menu, ma non ordinare.',
    shopClosedSubmitDisabled: 'Ordini non disponibili a locale chiuso',
    tableLockedTitle: 'Il tuo tavolo',
    tableLockedHint: 'Assegnato dal QR code del tavolo',
    rescanTableQrHint:
      'Scansiona il codice QR al tuo tavolo per consumare al tavolo, oppure seleziona Asporto.',
    errorShopClosed: 'Il locale è chiuso e non può accettare ordini. Torna durante l\'orario di apertura.',
    errorItemUnavailable: 'Alcuni prodotti non sono più disponibili. Rimuovili e riprova.',
    errorInsufficientStock: 'Scorte insufficienti per alcuni prodotti. Riduci la quantità e riprova.',
    errorOrderAccepted: 'L\'ordine è già stato accettato (o pagato) e non può essere modificato. Chiedi al personale.',
    errorPriceChanged: 'Prezzi o promozioni sono cambiati. Controlla il totale e invia di nuovo.',
    errorTableInvalid: 'Tavolo non valido. Seleziona un tavolo attivo o Asporto.',
    errorTableInactive: 'Questo tavolo non è disponibile. Seleziona un altro tavolo o Asporto.',
    errorGeneric: 'Impossibile inviare l\'ordine. Riprova.',
    statusCancelledTitle: 'Ordine annullato',
    statusCancelledSub: 'Questo ordine è stato annullato. Per domande rivolgiti al personale.',
    paidBadge: 'Pagato',
    unpaidBadge: 'Da pagare',
    thankYouTitle: 'Grazie!',
    thankYouSub: 'Il tuo ordine è completato. Speriamo di rivederti presto!',
    cancelOrderBtn: 'Annulla questo ordine',
    cancelOrderConfirm: 'Annullare l\'ordine? Non è ancora stato accettato, verrà annullato subito.',
    cancellingOrder: 'Annullamento in corso...',
    clearSelectionConfirm: 'Rimuovere tutti i prodotti selezionati?',
    dismissOrderBtn: 'Chiudi e fai un nuovo ordine',
  },
  ru: {
    shopClosedTitle: 'Заведение сейчас закрыто',
    shopClosedSub: (open, close) =>
      `Часы работы сегодня: ${open} – ${close}. Меню можно смотреть, но заказы принимаются только в рабочее время.`,
    shopClosedDayOff: 'Сегодня выходной. Меню можно смотреть, но заказать нельзя.',
    shopClosedSubmitDisabled: 'Заказы недоступны, пока заведение закрыто',
    tableLockedTitle: 'Ваш стол',
    tableLockedHint: 'Определён по QR-коду стола',
    rescanTableQrHint:
      'Отсканируйте QR-код на вашем столе для заказа в зале или выберите «Навынос».',
    errorShopClosed: 'Заведение закрыто и не принимает заказы. Пожалуйста, вернитесь в рабочее время.',
    errorItemUnavailable: 'Некоторые блюда закончились. Удалите их и попробуйте снова.',
    errorInsufficientStock: 'Недостаточно остатка для некоторых блюд. Уменьшите количество и попробуйте снова.',
    errorOrderAccepted: 'Заказ уже принят (или оплачен) и не может быть изменён. Обратитесь к персоналу.',
    errorPriceChanged: 'Цены или акции изменились. Проверьте сумму и отправьте снова.',
    errorTableInvalid: 'Недействительный стол. Выберите активный стол или «Навынос».',
    errorTableInactive: 'Этот стол недоступен. Выберите другой стол или «Навынос».',
    errorGeneric: 'Не удалось отправить заказ. Попробуйте снова.',
    statusCancelledTitle: 'Заказ отменён',
    statusCancelledSub: 'Этот заказ был отменён. По вопросам обратитесь к персоналу.',
    paidBadge: 'Оплачено',
    unpaidBadge: 'Не оплачено',
    thankYouTitle: 'Спасибо!',
    thankYouSub: 'Ваш заказ выполнен. Приятного аппетита и до новых встреч!',
    cancelOrderBtn: 'Отменить заказ',
    cancelOrderConfirm: 'Отменить заказ? Он ещё не принят, поэтому будет отменён сразу.',
    cancellingOrder: 'Отмена заказа...',
    clearSelectionConfirm: 'Удалить все выбранные блюда?',
    dismissOrderBtn: 'Закрыть и сделать новый заказ',
  },
};

/** Resolve guest-flow labels for a locale, falling back to English per key. */
export function getGuestOrderLabels(locale: SupportedLocale): GuestOrderLabelSet {
  return { ...GUEST_ORDER_LABELS_EN, ...(GUEST_ORDER_LABELS[locale] || {}) };
}

/**
 * Map a server order error (stable `code` field and/or "CODE: message" text and HTTP
 * status) to a localized guest-facing message. Never returns raw server text.
 */
export function localizeGuestOrderError(
  input: { code?: string | null; error?: string | null; status?: number | null },
  locale: SupportedLocale
): string {
  const labels = getGuestOrderLabels(locale);
  const rawError = (input.error || '').trim();
  const code =
    (input.code || '').trim().toUpperCase() ||
    (/^([A-Z][A-Z0-9_]{2,})\s*:/.exec(rawError)?.[1] ?? '');

  switch (code) {
    case 'SHOP_CLOSED':
      return labels.errorShopClosed;
    case 'ITEM_UNAVAILABLE':
    case 'ITEM_NOT_IN_SHOP':
    case 'INVALID_ITEM_ID':
    case 'INVALID_OPTION':
      return labels.errorItemUnavailable;
    case 'INSUFFICIENT_STOCK':
      return labels.errorInsufficientStock;
    case 'ORDER_ALREADY_ACCEPTED':
    case 'ORDER_ALREADY_PAID':
    case 'CUSTOMER_EDIT_LOCKED':
    case 'CUSTOMER_ACTION_FORBIDDEN':
      return labels.errorOrderAccepted;
    case 'PRICE_CHANGED':
      return labels.errorPriceChanged;
    case 'INVALID_SHOP_TABLE':
    case 'INVALID_TABLE_SHOP':
    case 'TABLE_NOT_FOUND':
    case 'FORBIDDEN_CROSS_SHOP_TABLE':
    case 'MISSING_TABLE_IDENTITY':
    case 'MISSING_TABLE_QR_SIGNATURE':
    case 'INVALID_TABLE_QR_SIGNATURE':
      return labels.errorTableInvalid;
    case 'INACTIVE_SHOP_TABLE':
      return labels.errorTableInactive;
    case 'INVALID_TRACKING_TOKEN':
      return labels.errorTrackingToken;
    default:
      break;
  }

  if (input.status === 409) {
    // Legacy 409 payloads without a code: price change vs. already accepted
    if (/giá|ưu đãi|tổng tiền/i.test(rawError)) return labels.errorPriceChanged;
    return labels.errorOrderAccepted;
  }

  return labels.errorGeneric;
}

export const QUICK_TAGS_BY_VERTICAL: Record<
  BusinessVertical,
  Array<{ id: string; i18n: I18nText }>
> = {
  fnb: [
    {
      id: 'no_onion',
      i18n: {
        vi: 'Không hành / rau mùi',
        en: 'No onion / cilantro',
        ko: '고수/파 빼주세요',
        ja: 'パクチー・ネギ抜き',
        zh: '不要葱/香菜',
        es: 'Sin cebolla / cilantro',
        it: 'Senza cipolla / coriandolo',
        ru: 'Без лука и кинзы',
      },
    },
    {
      id: 'less_ice',
      i18n: {
        vi: 'Ít đá',
        en: 'Less ice',
        ko: '얼음 조금만',
        ja: '氷少なめ',
        zh: '少冰',
        es: 'Poco hielo',
        it: 'Poco ghiaccio',
        ru: 'Меньше льда',
      },
    },
    {
      id: 'less_sweet',
      i18n: {
        vi: 'Ít ngọt',
        en: 'Less sweet',
        ko: '덜 달게 해주세요',
        ja: '甘さ控えめ',
        zh: '少糖/微甜',
        es: 'Menos dulce',
        it: 'Meno dolce',
        ru: 'Меньше сахара',
      },
    },
    {
      id: 'no_spicy',
      i18n: {
        vi: 'Không cay',
        en: 'No spicy',
        ko: '안 맵게 해주세요',
        ja: '辛くしないで',
        zh: '不要辣',
        es: 'Sin picante',
        it: 'Non piccante',
        ru: 'Не острое',
      },
    },
    {
      id: 'takeaway',
      i18n: {
        vi: 'Mang về',
        en: 'Takeaway / To-go',
        ko: '포장해 주세요',
        ja: 'お持ち帰り',
        zh: '打包带走',
        es: 'Para llevar',
        it: 'Da asporto',
        ru: 'С собой',
      },
    },
  ],
  service: [
    {
      id: 'gentle',
      i18n: {
        vi: 'Làm nhẹ tay',
        en: 'Gentle pressure please',
        ko: '살살 부드럽게 해주세요',
        ja: '優しめでお願いします',
        zh: '力度请轻柔一些',
        es: 'Presión suave por favor',
        it: 'Pressione delicata per favore',
        ru: 'Мягкое нажатие, пожалуйста',
      },
    },
    {
      id: 'consult',
      i18n: {
        vi: 'Tư vấn mẫu tại quầy',
        en: 'Consult design at counter',
        ko: '카운터에서 디자인 상담 원해요',
        ja: '受付でデザイン相談したい',
        zh: '在前台咨询款式',
        es: 'Consultar diseño en recepción',
        it: 'Consulenza design in reception',
        ru: 'Консультация по дизайну на стойке',
      },
    },
    {
      id: 'booking',
      i18n: {
        vi: 'Đặt lịch trước',
        en: 'Advance appointment',
        ko: '사전 예약 문의',
        ja: '事前予約',
        zh: '提前预约',
        es: 'Cita anticipada',
        it: 'Prenotazione anticipata',
        ru: 'Предварительная запись',
      },
    },
  ],
  retail: [
    {
      id: 'check_size',
      i18n: {
        vi: 'Kiểm tra size / màu khác',
        en: 'Check other sizes / colors',
        ko: '다른 사이즈/색상 확인해주세요',
        ja: '他のサイズ・色を確認したい',
        zh: '查看其他尺码/颜色',
        es: 'Consultar otras tallas / colores',
        it: 'Controlla altre taglie / colori',
        ru: 'Проверить другие размеры / цвета',
      },
    },
    {
      id: 'gift_wrap',
      i18n: {
        vi: 'Đóng gói làm quà tặng',
        en: 'Gift wrapping please',
        ko: '선물용 포장 부탁드려요',
        ja: 'ギフト包装をお願いします',
        zh: '请帮我做礼品包装',
        es: 'Envolver para regalo',
        it: 'Confezione regalo per favore',
        ru: 'Подарочная упаковка, пожалуйста',
      },
    },
  ],
};

export interface TableServiceRequestLabelSet {
  barTitle: string;
  callStaffBtn: string;
  requestBillBtn: string;
  sending: string;
  callStaffSentToast: (tableLabel: string) => string;
  requestBillSentToast: (tableLabel: string) => string;
  alreadyRequestedNotice: (tableLabel: string) => string;
  requestError: string;
}

export const TABLE_SERVICE_REQUEST_LABELS: Record<
  SupportedLocale,
  TableServiceRequestLabelSet
> = {
  vi: {
    barTitle: 'Hỗ trợ tại bàn',
    callStaffBtn: '🔔 Gọi phục vụ',
    requestBillBtn: '🧾 Xin hóa đơn',
    sending: 'Đang gửi...',
    callStaffSentToast: (tableLabel) =>
      `Đã gọi nhân viên hỗ trợ tại ${tableLabel}. Vui lòng đợi trong giây lát!`,
    requestBillSentToast: (tableLabel) =>
      `Đã gửi yêu cầu xin hóa đơn / thanh toán cho ${tableLabel}. Nhân viên sẽ mang hóa đơn tới ngay!`,
    alreadyRequestedNotice: (tableLabel) =>
      `Yêu cầu của ${tableLabel} đã được ghi nhận và đang được nhân viên xử lý.`,
    requestError: 'Không thể gửi yêu cầu hỗ trợ. Vui lòng thử lại.',
  },
  en: {
    barTitle: 'Table assistance',
    callStaffBtn: '🔔 Call staff',
    requestBillBtn: '🧾 Request bill',
    sending: 'Sending...',
    callStaffSentToast: (tableLabel) =>
      `Staff has been notified for ${tableLabel}. Someone will be with you shortly!`,
    requestBillSentToast: (tableLabel) =>
      `Bill request sent for ${tableLabel}. Staff will bring your bill shortly!`,
    alreadyRequestedNotice: (tableLabel) =>
      `Your request for ${tableLabel} is already active and being handled by staff.`,
    requestError: 'Unable to send service request. Please try again.',
  },
  ko: {
    barTitle: '테이블 빠른 요청',
    callStaffBtn: '🔔 직원 호출',
    requestBillBtn: '🧾 계산서 요청',
    sending: '전송 중...',
    callStaffSentToast: (tableLabel) =>
      `${tableLabel} 직원 호출이 접수되었습니다. 잠시만 기다려 주세요!`,
    requestBillSentToast: (tableLabel) =>
      `${tableLabel} 계산서/결제 요청이 전송되었습니다. 직원이 곧 안내해 드립니다!`,
    alreadyRequestedNotice: (tableLabel) =>
      `${tableLabel}의 요청이 이미 접수되어 직원이 확인 중입니다.`,
    requestError: '요청을 전송할 수 없습니다. 다시 시도해 주세요.',
  },
  ja: {
    barTitle: 'テーブルサポート',
    callStaffBtn: '🔔 スタッフを呼ぶ',
    requestBillBtn: '🧾 お会計・伝票',
    sending: '送信中...',
    callStaffSentToast: (tableLabel) =>
      `${tableLabel}へスタッフ呼び出しを送信しました。少々お待ちください。`,
    requestBillSentToast: (tableLabel) =>
      `${tableLabel}のお会計リクエストを送信しました。スタッフが伺います。`,
    alreadyRequestedNotice: (tableLabel) =>
      `${tableLabel}のリクエストは既に受付済みで、スタッフが対応中です。`,
    requestError: 'リクエストを送信できませんでした。もう一度お試しください。',
  },
  zh: {
    barTitle: '桌台快捷服务',
    callStaffBtn: '🔔 呼叫服务员',
    requestBillBtn: '🧾 买单 / 账单',
    sending: '发送中...',
    callStaffSentToast: (tableLabel) =>
      `已为您呼叫服务员至 ${tableLabel}，请稍候！`,
    requestBillSentToast: (tableLabel) =>
      `已发送 ${tableLabel} 的结账/账单请求，服务员将尽快为您处理！`,
    alreadyRequestedNotice: (tableLabel) =>
      `${tableLabel} 的服务请求已收到，服务员正在处理中。`,
    requestError: '无法发送服务请求，请重试。',
  },
  es: {
    barTitle: 'Asistencia en mesa',
    callStaffBtn: '🔔 Llamar personal',
    requestBillBtn: '🧾 Pedir la cuenta',
    sending: 'Enviando...',
    callStaffSentToast: (tableLabel) =>
      `Personal avisado para ${tableLabel}. ¡Enseguida le atenderemos!`,
    requestBillSentToast: (tableLabel) =>
      `Solicitud de cuenta enviada para ${tableLabel}. ¡El personal se acercará pronto!`,
    alreadyRequestedNotice: (tableLabel) =>
      `Su solicitud para ${tableLabel} ya fue recibida y está siendo atendida.`,
    requestError: 'No se pudo enviar la solicitud. Inténtelo de nuevo.',
  },
  it: {
    barTitle: 'Assistenza al tavolo',
    callStaffBtn: '🔔 Chiama staff',
    requestBillBtn: '🧾 Chiedi il conto',
    sending: 'Invio...',
    callStaffSentToast: (tableLabel) =>
      `Personale avvisato per ${tableLabel}. Arriviamo subito!`,
    requestBillSentToast: (tableLabel) =>
      `Richiesta conto inviata per ${tableLabel}. Il personale arriverà a breve!`,
    alreadyRequestedNotice: (tableLabel) =>
      `La richiesta per ${tableLabel} è già stata ricevuta ed è in gestione.`,
    requestError: 'Impossibile inviare la richiesta. Riprova.',
  },
  ru: {
    barTitle: 'Помощь за столиком',
    callStaffBtn: '🔔 Позвать персонал',
    requestBillBtn: '🧾 Попросить счёт',
    sending: 'Отправка...',
    callStaffSentToast: (tableLabel) =>
      `Персонал вызван к столику ${tableLabel}. Пожалуйста, подождите!`,
    requestBillSentToast: (tableLabel) =>
      `Запрос счёта для ${tableLabel} отправлен. Сотрудник скоро подойдёт!`,
    alreadyRequestedNotice: (tableLabel) =>
      `Ваш запрос для ${tableLabel} уже принят и обрабатывается персоналом.`,
    requestError: 'Не удалось отправить запрос. Попробуйте снова.',
  },
};

export function getTableServiceRequestLabels(
  locale: SupportedLocale
): TableServiceRequestLabelSet {
  return TABLE_SERVICE_REQUEST_LABELS[locale] || TABLE_SERVICE_REQUEST_LABELS.vi;
}
