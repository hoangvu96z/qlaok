export type AppLocale = 'vi' | 'en';

export const APP_LOCALES: readonly AppLocale[] = ['vi', 'en'] as const;

export const DEFAULT_APP_LOCALE: AppLocale = 'vi';

const LANGUAGE_NAMES: Record<string, Record<AppLocale, string>> = {
  vi: { vi: 'Tiếng Việt', en: 'Vietnamese' },
  en: { vi: 'Tiếng Anh', en: 'English' },
  ko: { vi: 'Tiếng Hàn', en: 'Korean' },
  ja: { vi: 'Tiếng Nhật', en: 'Japanese' },
  zh: { vi: 'Tiếng Trung', en: 'Chinese' },
  es: { vi: 'Tiếng Tây Ban Nha', en: 'Spanish' },
  it: { vi: 'Tiếng Ý', en: 'Italian' },
  ru: { vi: 'Tiếng Nga', en: 'Russian' },
};

export function appLanguageName(code: string, locale: AppLocale): string {
  return LANGUAGE_NAMES[code]?.[locale] || code.toUpperCase();
}

export const APP_LOCALE_STORAGE_KEY = 'qlaok_app_locale';
export const APP_LOCALE_CHANGE_EVENT = 'qlaok_app_locale_change';

export const APP_LOCALE_META: Record<
  AppLocale,
  {
    code: AppLocale;
    shortLabel: string;
    label: string;
    nativeLabel: string;
    bcp47: string;
  }
> = {
  vi: {
    code: 'vi',
    shortLabel: 'VI',
    label: 'Vietnamese',
    nativeLabel: 'Tiếng Việt',
    bcp47: 'vi-VN',
  },
  en: {
    code: 'en',
    shortLabel: 'EN',
    label: 'English',
    nativeLabel: 'English',
    bcp47: 'en-US',
  },
};

const VI_APP_DICTIONARY = {
  // Common actions & statuses
  'common.save': 'Lưu thay đổi',
  'common.saving': 'Đang lưu...',
  'common.saved': 'Đã lưu',
  'common.cancel': 'Hủy',
  'common.close': 'Đóng',
  'common.delete': 'Xóa',
  'common.edit': 'Sửa',
  'common.add': 'Thêm',
  'common.create': 'Tạo mới',
  'common.refresh': 'Làm mới',
  'common.loading': 'Đang tải...',
  'common.search': 'Tìm kiếm...',
  'common.clearFilters': 'Xóa bộ lọc',
  'common.all': 'Tất cả',
  'common.enabled': 'Bật',
  'common.disabled': 'Tắt',
  'common.copy': 'Sao chép',
  'common.copied': 'Đã chép',
  'common.back': 'Quay lại',
  'common.continue': 'Tiếp tục',
  'common.confirm': 'Xác nhận',
  'common.language': 'Ngôn ngữ ứng dụng',
  'common.switchToVi': 'Chuyển sang Tiếng Việt',
  'common.switchToEn': 'Switch to English',

  // Theme toggle
  'theme.light': 'Sáng',
  'theme.dark': 'Tối',
  'theme.toggleAria': 'Đổi giao diện Sáng / Tối',
  'theme.switchToLightTooltip': 'Chuyển sang giao diện Sáng',
  'theme.switchToDarkTooltip': 'Chuyển sang giao diện Tối',

  // Header & Sidebar Navigation
  'nav.overview': 'Tổng quan',
  'nav.orders': 'Đơn hàng',
  'nav.kitchen': 'Màn hình bếp',
  'nav.reports': 'Báo cáo',
  'nav.catalog': 'Menu & Tồn kho',
  'nav.aiScanner': 'Quét Menu AI',
  'nav.qrStudio': 'Mã QR',
  'nav.promotions': 'Khuyến mãi',
  'nav.settings': 'Cài đặt',
  'nav.billing': 'Gói cước',
  'nav.superAdmin': 'Quản trị hệ thống',
  'nav.GroupOperations': 'Bán hàng & Vận hành',
  'nav.GroupStore': 'Thực đơn & Cửa hàng',
  'nav.GroupAccount': 'Tài khoản',

  'header.collapseMenu': 'Thu gọn menu',
  'header.expandMenu': 'Mở menu',
  'header.openMobileMenu': 'Mở menu điều hướng',
  'header.closeMobileMenu': 'Đóng menu điều hướng',
  'header.alertsOff': 'Bật TB',
  'header.alertsOn': 'TB: Bật',
  'header.alertsTooltipOff': 'Bật thông báo màn hình khi có đơn mới',
  'header.alertsTooltipOn': 'Thông báo màn hình đang bật (bấm để thử)',
  'header.posButton': 'Bán hàng',
  'header.viewMenu': 'Xem menu',
  'header.addBranch': 'Thêm quán',
  'header.logout': 'Đăng xuất',
  'header.exitAdminView': 'Thoát xem thay',
  'header.adminViewingShop': 'Đang quản trị quán: {shopName}',
  'header.newTableOrderBadge': 'ĐƠN MỚI TẠI BÀN',
  'header.openOrdersNow': 'Mở xử lý đơn',

  // PWA / Home screen banner (jargon-free)
  'installBanner.title': 'Thêm Qlaok ra màn hình chính',
  'installBanner.subtitle': 'Mở toàn màn hình, cập nhật món và nhận đơn nhanh hơn',
  'installBanner.cta': 'Thêm ngay',
  'installBanner.closeAria': 'Đóng gợi ý thêm màn hình chính',
  'installBanner.iosGuide':
    'Trên iPhone/iPad: Bấm nút Chia sẻ (Share) ở trình duyệt Safari rồi chọn "Thêm vào MH chính" (Add to Home Screen).',

  // Orders & POS Workspace
  'orders.pageTitle': 'Đơn hàng',
  'orders.modePosSubtitle': 'Chọn món, thanh toán và in hóa đơn tại quầy',
  'orders.modeQueueSubtitle': 'Nhận đơn tại bàn, báo bếp và thu ngân',
  'orders.tabPos': 'Bán tại quầy',
  'orders.tabQueue': 'Đơn bàn & quầy ({count})',
  'orders.autoPrintOn': 'Tự in: Bật',
  'orders.autoPrintOff': 'Tự in: Tắt',
  'orders.autoPrintTooltip': 'Tự động mở phiếu in hóa đơn ngay khi xác nhận thu tiền',
  'orders.chimeMax': 'Chuông: Siêu to',
  'orders.chimeLoud': 'Chuông: To',
  'orders.chimeNormal': 'Chuông: Vừa',
  'orders.chimeOff': 'Chuông: Tắt',
  'orders.chimeSettings': 'Cài chuông',
  'orders.chimeSettingsTooltip': 'Chọn kiểu chuông, âm lượng và thử chuông báo đơn mới',
  'orders.filterActive': 'Đang phục vụ ({count})',
  'orders.filterNew': 'Chờ nhận ({count})',
  'orders.filterPreparing': 'Đang làm ({count})',
  'orders.filterCompleted': 'Hoàn tất ({count})',
  'orders.filterAll': 'Tất cả ({count})',
  'orders.kpiNew': 'Chờ nhận',
  'orders.kpiPreparing': 'Đang chế biến',
  'orders.kpiPaidToday': 'Đã thu hôm nay ({count} đơn)',
  'orders.kpiUnpaid': 'Chờ thanh toán ({count} đơn)',
  'orders.emptyQueueTitle': 'Chưa có đơn hàng trong mục này',
  'orders.emptyQueueDesc': 'Đơn khách gọi qua mã QR tại bàn hoặc tạo từ quầy sẽ hiển thị ngay tại đây.',
  'orders.openPosCta': 'Tạo đơn',
  'orders.actionEdit': 'Sửa đơn',
  'orders.actionAccept': 'Nhận đơn',
  'orders.actionServed': 'Đã phục vụ',
  'orders.actionMarkPaid': 'Đã thu tiền',
  'orders.actionProvisionalBill': 'In tạm tính',
  'orders.actionPrintReceipt': 'In hóa đơn',
  'orders.actionRefund': 'Hoàn tiền',
  'orders.actionCancel': 'Hủy',
  'orders.statusNew': 'Mới chờ nhận',
  'orders.statusPreparing': 'Đang làm',
  'orders.statusCompleted': 'Hoàn tất',
  'orders.statusCancelled': 'Đã hủy',
  'orders.paymentPaid': 'Đã thu tiền',
  'orders.paymentUnpaid': 'Chưa thu tiền',
  'orders.paymentRefunded': 'Đã hoàn tiền',
  'orders.paymentMethodCash': 'Tiền mặt',
  'orders.paymentMethodQr': 'Chuyển khoản QR',
  'orders.syncLive': 'Đang đồng bộ trực tiếp',
  'orders.syncPolling': 'Tự động cập nhật định kỳ',

  // Chime Settings Modal
  'chime.modalTitle': 'Cài đặt chuông báo đơn mới',
  'chime.modalSubtitle': 'Tùy chỉnh âm thanh và thông báo khi có đơn hàng mới',
  'chime.soundLabel': 'Âm báo tại quầy thu ngân',
  'chime.soundDesc': 'Tự động phát chuông khi có đơn mới gửi vào hệ thống',
  'chime.desktopNotifTitle': 'Thông báo màn hình máy tính',
  'chime.desktopNotifDesc': 'Hiện thông báo góc màn hình ngay cả khi thu nhỏ trình duyệt',
  'chime.volumeLabel': 'Mức âm lượng chuông',
  'chime.volumeNormal': 'Vừa phải',
  'chime.volumeLoud': 'To rõ',
  'chime.volumeBoost': 'Siêu to (Quán đông)',
  'chime.selectSoundLabel': 'Chọn kiểu chuông báo',
  'chime.testButton': 'Nghe thử',
  'chime.saveAndTest': 'Lưu & Thử chuông',

  // POS Counter
  'pos.tableTypeCounter': 'Mang về / Tại quầy',
  'pos.tableTypeDineIn': 'Ăn tại bàn',
  'pos.searchPlaceholder': 'Tìm tên món hoặc danh mục...',
  'pos.cartTitle': 'Hóa đơn đang chọn',
  'pos.emptyCart': 'Chạm vào món bên trái để thêm vào đơn',
  'pos.customerNotePlaceholder': 'Ghi chú đơn (VD: Ít đá, không hành...)',
  'pos.subtotal': 'Tạm tính',
  'pos.discount': 'Giảm giá',
  'pos.total': 'Khách cần trả',
  'pos.cashReceived': 'Tiền khách đưa',
  'pos.changeDue': 'Tiền thừa trả khách',
  'pos.saveUnpaidOrder': 'Lưu đơn chờ thanh toán',
  'pos.collectAndComplete': 'Thu tiền & Hoàn tất',
  'pos.saveOrderChanges': 'Lưu cập nhật đơn',

  // Receipt Print Modal
  'receipt.modalTitle': 'Phiếu in nhiệt ({size})',
  'receipt.ticketKitchen': 'Phiếu bếp',
  'receipt.ticketProvisional': 'Tạm tính',
  'receipt.ticketReceipt': 'Hóa đơn',
  'receipt.printNow': 'In phiếu ngay ({size})',

  // Auth & Login
  'auth.badge': 'Quản lý cửa hàng & Bán hàng',
  'auth.loginTitle': 'Đăng nhập quản lý quán',
  'auth.registerTitle': 'Tạo tài khoản chủ quán',
  'auth.subtitle': 'Quản lý thực đơn đa ngôn ngữ, nhận đơn tại bàn và theo dõi doanh thu',
  'auth.tabLogin': 'Đăng nhập',
  'auth.tabRegister': 'Đăng ký mới',
  'auth.emailLabel': 'Email tài khoản',
  'auth.passwordLabel': 'Mật khẩu',
  'auth.fullNameLabel': 'Họ và tên chủ quán',
  'auth.loginSubmit': 'Đăng nhập',
  'auth.registerSubmit': 'Đăng ký & Tạo quán',
  'auth.submitting': 'Đang xử lý...',
  'auth.backToHome': 'Về trang chủ Qlaok',

  // Onboarding
  'onboarding.title': 'Khởi tạo cửa hàng mới',
  'onboarding.subtitle': 'Thiết lập thông tin cơ bản để tạo thực đơn QR đa ngôn ngữ và quầy bán hàng',
  'onboarding.shopNameLabel': 'Tên quán / Cửa hàng',
  'onboarding.verticalLabel': 'Ngành hàng kinh doanh',
  'onboarding.cityLabel': 'Tỉnh / Thành phố',
  'onboarding.phoneLabel': 'Số điện thoại / Zalo liên hệ',
  'onboarding.wifiNameLabel': 'Tên Wi-Fi quán (tùy chọn)',
  'onboarding.wifiPassLabel': 'Mật khẩu Wi-Fi (tùy chọn)',
  'onboarding.submitButton': 'Tạo cửa hàng & Vào trang quản lý',

  // Admin Console
  'admin.title': 'Quản trị hệ thống Qlaok',
  'admin.subtitle': 'Giám sát cửa hàng, tài khoản chủ quán, đơn hàng và gói dịch vụ',
  'admin.tabOverview': 'Tổng quan',
  'admin.tabAccounts': 'Tài khoản',
  'admin.tabShops': 'Cửa hàng',
  'admin.tabOrders': 'Đơn hàng',
  'admin.tabBilling': 'Giao dịch gói',
  'admin.tabSystem': 'Hệ thống',
  'admin.refreshData': 'Làm mới',
  'admin.backToCms': 'Về trang quản lý quán',
  'admin.logout': 'Đăng xuất',
} as const;

export type AppTranslationKey = keyof typeof VI_APP_DICTIONARY;

const EN_APP_DICTIONARY: Record<AppTranslationKey, string> = {
  // Common actions & statuses
  'common.save': 'Save changes',
  'common.saving': 'Saving...',
  'common.saved': 'Saved',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.create': 'Create',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading...',
  'common.search': 'Search...',
  'common.clearFilters': 'Clear filters',
  'common.all': 'All',
  'common.enabled': 'On',
  'common.disabled': 'Off',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.confirm': 'Confirm',
  'common.language': 'App language',
  'common.switchToVi': 'Chuyển sang Tiếng Việt',
  'common.switchToEn': 'Switch to English',

  // Theme toggle
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.toggleAria': 'Toggle Light / Dark theme',
  'theme.switchToLightTooltip': 'Switch to Light theme',
  'theme.switchToDarkTooltip': 'Switch to Dark theme',

  // Header & Sidebar Navigation
  'nav.overview': 'Overview',
  'nav.orders': 'Orders',
  'nav.kitchen': 'Kitchen',
  'nav.reports': 'Reports',
  'nav.catalog': 'Menu & Stock',
  'nav.aiScanner': 'AI Menu Scan',
  'nav.qrStudio': 'QR codes',
  'nav.promotions': 'Promotions',
  'nav.settings': 'Settings',
  'nav.billing': 'Plans',
  'nav.superAdmin': 'System Admin',
  'nav.GroupOperations': 'Sales & Operations',
  'nav.GroupStore': 'Menu & Storefront',
  'nav.GroupAccount': 'Account',

  'header.collapseMenu': 'Collapse menu',
  'header.expandMenu': 'Expand menu',
  'header.openMobileMenu': 'Open navigation menu',
  'header.closeMobileMenu': 'Close navigation menu',
  'header.alertsOff': 'Alerts',
  'header.alertsOn': 'Alerts: On',
  'header.alertsTooltipOff': 'Enable desktop notifications for new orders',
  'header.alertsTooltipOn': 'Desktop notifications enabled (click to test)',
  'header.posButton': 'POS',
  'header.viewMenu': 'Storefront',
  'header.addBranch': 'New Store',
  'header.logout': 'Sign out',
  'header.exitAdminView': 'Exit view',
  'header.adminViewingShop': 'Managing store: {shopName}',
  'header.newTableOrderBadge': 'NEW TABLE ORDER',
  'header.openOrdersNow': 'View orders',

  // PWA / Home screen banner (jargon-free)
  'installBanner.title': 'Add Qlaok to Home Screen',
  'installBanner.subtitle': 'Open full screen, update items, and manage orders faster',
  'installBanner.cta': 'Add now',
  'installBanner.closeAria': 'Dismiss home screen prompt',
  'installBanner.iosGuide':
    'On iPhone/iPad: Tap the Share button in Safari and select "Add to Home Screen".',

  // Orders & POS Workspace
  'orders.pageTitle': 'Orders',
  'orders.modePosSubtitle': 'Select items, collect payment, and print receipts',
  'orders.modeQueueSubtitle': 'Manage table orders, kitchen prep, and cashier checkout',
  'orders.tabPos': 'Counter POS',
  'orders.tabQueue': 'Orders ({count})',
  'orders.autoPrintOn': 'Auto-print: On',
  'orders.autoPrintOff': 'Auto-print: Off',
  'orders.autoPrintTooltip': 'Automatically open thermal receipt preview when marking an order as paid',
  'orders.chimeMax': 'Chime: Max',
  'orders.chimeLoud': 'Chime: Loud',
  'orders.chimeNormal': 'Chime: Normal',
  'orders.chimeOff': 'Chime: Off',
  'orders.chimeSettings': 'Chime',
  'orders.chimeSettingsTooltip': 'Configure order alert chime sound and volume',
  'orders.filterActive': 'Active ({count})',
  'orders.filterNew': 'New ({count})',
  'orders.filterPreparing': 'Preparing ({count})',
  'orders.filterCompleted': 'Completed ({count})',
  'orders.filterAll': 'All ({count})',
  'orders.kpiNew': 'New orders',
  'orders.kpiPreparing': 'Preparing',
  'orders.kpiPaidToday': 'Paid today ({count})',
  'orders.kpiUnpaid': 'Unpaid ({count})',
  'orders.emptyQueueTitle': 'No orders in this view',
  'orders.emptyQueueDesc': 'Orders placed via table QR or counter POS will appear here.',
  'orders.openPosCta': 'New order',
  'orders.actionEdit': 'Edit',
  'orders.actionAccept': 'Accept',
  'orders.actionServed': 'Served',
  'orders.actionMarkPaid': 'Mark paid',
  'orders.actionProvisionalBill': 'Provisional bill',
  'orders.actionPrintReceipt': 'Print receipt',
  'orders.actionRefund': 'Refund',
  'orders.actionCancel': 'Cancel',
  'orders.statusNew': 'New',
  'orders.statusPreparing': 'Preparing',
  'orders.statusCompleted': 'Completed',
  'orders.statusCancelled': 'Cancelled',
  'orders.paymentPaid': 'Paid',
  'orders.paymentUnpaid': 'Unpaid',
  'orders.paymentRefunded': 'Refunded',
  'orders.paymentMethodCash': 'Cash',
  'orders.paymentMethodQr': 'QR Transfer',
  'orders.syncLive': 'Live sync active',
  'orders.syncPolling': 'Auto-refreshing',

  // Chime Settings Modal
  'chime.modalTitle': 'Order Chime Settings',
  'chime.modalSubtitle': 'Customize sound alerts and desktop notifications for incoming orders',
  'chime.soundLabel': 'Cashier sound alert',
  'chime.soundDesc': 'Play chime automatically when a new order arrives',
  'chime.desktopNotifTitle': 'Desktop notifications',
  'chime.desktopNotifDesc': 'Show system notifications when the browser window is in the background',
  'chime.volumeLabel': 'Chime volume',
  'chime.volumeNormal': 'Normal',
  'chime.volumeLoud': 'Loud',
  'chime.volumeBoost': 'Max (Busy shop)',
  'chime.selectSoundLabel': 'Select chime tone',
  'chime.testButton': 'Test',
  'chime.saveAndTest': 'Save & Test',

  // POS Counter
  'pos.tableTypeCounter': 'Takeaway / Counter',
  'pos.tableTypeDineIn': 'Dine-in table',
  'pos.searchPlaceholder': 'Search items or categories...',
  'pos.cartTitle': 'Current order',
  'pos.emptyCart': 'Tap items on the left to add them to the order',
  'pos.customerNotePlaceholder': 'Order note (e.g., Less ice, no onions...)',
  'pos.subtotal': 'Subtotal',
  'pos.discount': 'Discount',
  'pos.total': 'Total due',
  'pos.cashReceived': 'Cash received',
  'pos.changeDue': 'Change due',
  'pos.saveUnpaidOrder': 'Save unpaid order',
  'pos.collectAndComplete': 'Collect & Complete',
  'pos.saveOrderChanges': 'Save order changes',

  // Receipt Print Modal
  'receipt.modalTitle': 'Thermal Receipt ({size})',
  'receipt.ticketKitchen': 'Kitchen ticket',
  'receipt.ticketProvisional': 'Provisional bill',
  'receipt.ticketReceipt': 'Receipt',
  'receipt.printNow': 'Print ticket ({size})',

  // Auth & Login
  'auth.badge': 'Store & POS Management',
  'auth.loginTitle': 'Sign in to manage your store',
  'auth.registerTitle': 'Create a store owner account',
  'auth.subtitle': 'Manage multilingual menus, receive table orders, and track sales',
  'auth.tabLogin': 'Sign in',
  'auth.tabRegister': 'Create account',
  'auth.emailLabel': 'Email address',
  'auth.passwordLabel': 'Password',
  'auth.fullNameLabel': 'Owner full name',
  'auth.loginSubmit': 'Sign in',
  'auth.registerSubmit': 'Sign up & Create store',
  'auth.submitting': 'Processing...',
  'auth.backToHome': 'Back to Qlaok home',

  // Onboarding
  'onboarding.title': 'Create your new store',
  'onboarding.subtitle': 'Enter basic store details to launch your multilingual QR menu and POS',
  'onboarding.shopNameLabel': 'Store / Restaurant name',
  'onboarding.verticalLabel': 'Business category',
  'onboarding.cityLabel': 'City / Province',
  'onboarding.phoneLabel': 'Phone / Zalo contact',
  'onboarding.wifiNameLabel': 'Store Wi-Fi name (optional)',
  'onboarding.wifiPassLabel': 'Wi-Fi password (optional)',
  'onboarding.submitButton': 'Create store & Open dashboard',

  // Admin Console
  'admin.title': 'Qlaok System Administration',
  'admin.subtitle': 'Monitor stores, owner accounts, orders, and subscription plans',
  'admin.tabOverview': 'Overview',
  'admin.tabAccounts': 'Accounts',
  'admin.tabShops': 'Stores',
  'admin.tabOrders': 'Orders',
  'admin.tabBilling': 'Billing',
  'admin.tabSystem': 'System',
  'admin.refreshData': 'Refresh',
  'admin.backToCms': 'Back to Store CMS',
  'admin.logout': 'Sign out',
};

export const APP_DICTIONARY: Record<
  AppLocale,
  Record<AppTranslationKey, string>
> = {
  vi: VI_APP_DICTIONARY,
  en: EN_APP_DICTIONARY,
};

export type TranslationParams = Record<
  string,
  string | number | undefined | null
>;

/**
 * Normalizes any raw locale input into a supported AppLocale ('vi' | 'en').
 */
export function normalizeAppLocale(
  raw: unknown,
  fallback: AppLocale = DEFAULT_APP_LOCALE
): AppLocale {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().toLowerCase();
  if (
    cleaned === 'en' ||
    cleaned.startsWith('en-') ||
    cleaned.startsWith('en_')
  ) {
    return 'en';
  }
  if (
    cleaned === 'vi' ||
    cleaned.startsWith('vi-') ||
    cleaned.startsWith('vi_')
  ) {
    return 'vi';
  }
  return fallback;
}

/**
 * Replaces `{param}` tokens in a template string with values from `params`.
 * - Provided string/number values are converted to string.
 * - Provided `null` or `undefined` values resolve to empty string `""`.
 * - Missing keys not present in `params` remain `{token}` so missing bindings are visible.
 */
export function interpolateAppTemplate(
  template: string,
  params?: TranslationParams
): string {
  if (!template || !params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (fullMatch, token: string) => {
    if (Object.prototype.hasOwnProperty.call(params, token)) {
      const value = params[token];
      return value === undefined || value === null ? '' : String(value);
    }
    return fullMatch;
  });
}

/**
 * Converts a dot-separated key like `orders.actionAccept` into a readable fallback label
 * if an unknown key is ever passed at runtime.
 */
export function humanizeTranslationKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  const lastSegment = trimmed.split('.').pop() || trimmed;
  const spaced = lastSegment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Core typed translation function with parameter interpolation and multi-step fallback:
 * 1. Target locale entry (if non-empty)
 * 2. Fallback locale ('vi' by default) entry (if non-empty)
 * 3. Humanized key fallback
 */
export function translateApp(
  locale: AppLocale | string | undefined | null,
  key: AppTranslationKey | string,
  params?: TranslationParams,
  fallbackLocale: AppLocale = DEFAULT_APP_LOCALE
): string {
  const resolvedLocale = normalizeAppLocale(locale, fallbackLocale);
  const targetDict = APP_DICTIONARY[resolvedLocale] as Record<string, string>;
  const fallbackDict = APP_DICTIONARY[fallbackLocale] as Record<string, string>;

  const rawTarget = targetDict?.[key];
  const rawFallback = fallbackDict?.[key];

  const template =
    typeof rawTarget === 'string' && rawTarget.trim().length > 0
      ? rawTarget
      : typeof rawFallback === 'string' && rawFallback.trim().length > 0
        ? rawFallback
        : humanizeTranslationKey(String(key));

  return interpolateAppTemplate(template, params);
}

/**
 * Inline bilingual helper with fallback to Vietnamese when English text is empty,
 * plus `{param}` interpolation support.
 */
export function bilingualText(
  locale: AppLocale | string | undefined | null,
  viText: string,
  enText?: string | null,
  params?: TranslationParams
): string {
  const resolved = normalizeAppLocale(locale, DEFAULT_APP_LOCALE);
  const cleanVi = typeof viText === 'string' ? viText : '';
  const cleanEn = typeof enText === 'string' ? enText : '';
  const chosen =
    resolved === 'en'
      ? cleanEn.trim().length > 0
        ? cleanEn
        : cleanVi
      : cleanVi.trim().length > 0
        ? cleanVi
        : cleanEn;
  return interpolateAppTemplate(chosen, params);
}

/**
 * Reads persisted app locale from storage (or browser localStorage when available).
 */
export function getStoredAppLocale(
  storage?: Pick<Storage, 'getItem'> | null,
  fallback: AppLocale = DEFAULT_APP_LOCALE
): AppLocale {
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    if (!targetStorage) return fallback;
    const saved = targetStorage.getItem(APP_LOCALE_STORAGE_KEY);
    if (!saved) return fallback;
    return normalizeAppLocale(saved, fallback);
  } catch {
    return fallback;
  }
}

/**
 * Persists app locale to storage and dispatches a sync event.
 */
export function setStoredAppLocale(
  locale: AppLocale | string,
  storage?: Pick<Storage, 'setItem'> | null
): AppLocale {
  const normalized = normalizeAppLocale(locale, DEFAULT_APP_LOCALE);
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    targetStorage?.setItem(APP_LOCALE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage quota / privacy mode errors
  }

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AppLocale>(APP_LOCALE_CHANGE_EVENT, {
        detail: normalized,
      })
    );
  }

  return normalized;
}

/**
 * Formats the concise chime summary button label for `/dashboard/orders`.
 * Detailed 3-strike / waveform descriptions belong strictly inside the settings modal.
 */
export function formatChimeSummaryLabel(
  prefs: {
    enabled: boolean;
    volume?: 'normal' | 'loud' | 'boost' | 'max_boost';
    volumePreset?: 'normal' | 'loud' | 'boost' | 'max_boost';
  },
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  if (!prefs.enabled) {
    return translateApp(locale, 'orders.chimeOff');
  }
  const volume = prefs.volume ?? prefs.volumePreset ?? 'normal';
  if (volume === 'boost' || volume === 'max_boost') {
    return translateApp(locale, 'orders.chimeMax');
  }
  if (volume === 'loud') {
    return translateApp(locale, 'orders.chimeLoud');
  }
  return translateApp(locale, 'orders.chimeNormal');
}

/**
 * Formats the concise desktop notification button label (`Bật TB` / `TB: Bật` or `Alerts` / `Alerts: On`).
 */
export function formatNotificationToggleLabel(
  permission: string,
  locale: AppLocale = DEFAULT_APP_LOCALE
): string {
  return permission === 'granted'
    ? translateApp(locale, 'header.alertsOn')
    : translateApp(locale, 'header.alertsOff');
}
