export type MobileLocale = 'vi' | 'en';

export const MOBILE_LOCALES: readonly MobileLocale[] = ['vi', 'en'] as const;

export const DEFAULT_MOBILE_LOCALE: MobileLocale = 'vi';

export const MOBILE_LOCALE_STORAGE_KEY = 'qlaok_app_locale';

export const MOBILE_LOCALE_META: Record<
  MobileLocale,
  {
    code: MobileLocale;
    shortLabel: string;
    label: string;
    nativeLabel: string;
  }
> = {
  vi: {
    code: 'vi',
    shortLabel: 'VI',
    label: 'Vietnamese',
    nativeLabel: 'Tiếng Việt',
  },
  en: {
    code: 'en',
    shortLabel: 'EN',
    label: 'English',
    nativeLabel: 'English',
  },
};

const VI_MOBILE_DICTIONARY = {
  // Common & Language Switcher
  'common.language': 'Ngôn ngữ ứng dụng',
  'common.languageShort': 'Ngôn ngữ',
  'common.switchToVi': 'Chuyển sang Tiếng Việt',
  'common.switchToEn': 'Switch to English',
  'common.tryAgain': 'Vui lòng thử lại',
  'common.close': 'Đóng',
  'common.cancel': 'Hủy',
  'common.add': 'Thêm',

  // AuthScreen
  'auth.title': 'Qlaok Quản lý',
  'auth.subtitle': 'Nhận đơn tại bàn, thu ngân, quản lý thực đơn và doanh thu',
  'auth.emailLabel': 'Email tài khoản',
  'auth.passwordLabel': 'Mật khẩu',
  'auth.submit': 'Đăng nhập',
  'auth.submitting': 'Đang đăng nhập...',
  'auth.errorFallback': 'Vui lòng kiểm tra lại email hoặc mật khẩu',
  'auth.createStorePrompt': 'Chưa có tài khoản cửa hàng? Đăng ký trên Web',
  'auth.forgotPasswordPrompt': 'Quên mật khẩu?',
  'auth.recoveryTitle': 'Khôi phục mật khẩu',
  'auth.recoverySubtitle':
    'Nhập email tài khoản để nhận mã hoặc liên kết đặt lại mật khẩu',
  'auth.recoverySendBtn': 'Gửi yêu cầu khôi phục',
  'auth.recoverySending': 'Đang gửi yêu cầu...',
  'auth.recoverySentNotice':
    'Nếu {email} là tài khoản được hỗ trợ khôi phục qua email, hướng dẫn đặt lại mật khẩu sẽ được gửi tới hộp thư. Tài khoản mật khẩu nội bộ, dùng thử hoặc quản trị cần liên hệ quản trị viên.',
  'auth.recoveryCodeLabel': 'Mã khôi phục trong email',
  'auth.recoveryNewPasswordLabel': 'Mật khẩu mới (tối thiểu 6 ký tự)',
  'auth.recoveryCompleteBtn': 'Cập nhật mật khẩu mới',
  'auth.recoveryCompleting': 'Đang cập nhật mật khẩu...',
  'auth.recoverySuccessNotice':
    'Đã đặt lại mật khẩu cho {email}. Bạn có thể đăng nhập bằng mật khẩu mới.',
  'auth.recoveryBackToLogin': '← Quay lại đăng nhập',
  'auth.recoveryOpenWebFallback': 'Mở trang khôi phục trên Web',
  'auth.recoveryErrInvalidEmail':
    'Vui lòng nhập địa chỉ email hợp lệ để khôi phục mật khẩu.',
  'auth.recoveryErrUnsupportedAccount':
    'Tài khoản dùng thử, quản trị hệ thống hoặc tài khoản mật khẩu cục bộ không hỗ trợ tự đặt lại mật khẩu trên ứng dụng.',
  'auth.recoveryErrUnsupportedProvider':
    'Tính năng đặt lại mật khẩu qua email hiện không khả dụng trên máy chủ này. Vui lòng mở trang Web hoặc liên hệ quản trị viên.',
  'auth.recoveryErrRateLimited':
    'Bạn đã gửi quá nhiều yêu cầu khôi phục. Vui lòng đợi vài phút rồi thử lại.',
  'auth.recoveryErrNetwork':
    'Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra mạng và thử lại.',
  'auth.recoveryErrInvalidCode':
    'Mã khôi phục không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại email.',
  'auth.recoveryErrWeakPassword': 'Mật khẩu mới phải có ít nhất 6 ký tự.',
  'auth.oidcBadge': 'Zitadel OIDC • PKCE S256',
  'auth.oidcSubtitle':
    'Đăng nhập Chủ quán an toàn qua cổng xác thực Zitadel (auth.vunph.click). Ứng dụng không lưu hay xử lý mật khẩu trực tiếp.',
  'auth.oidcEmailHintLabel': 'Email gợi ý đăng nhập (không bắt buộc)',
  'auth.oidcEmailHintPlaceholder': 'chuquan@tenquan.vn',
  'auth.oidcSignInBtn': 'Đăng nhập Chủ quán qua Zitadel SSO',
  'auth.oidcRegisterBtn': 'Tạo tài khoản Chủ quán trên Zitadel',
  'auth.oidcForgotPasswordBtn': 'Quên mật khẩu trên Zitadel?',
  'auth.oidcRedirecting': 'Đang mở Zitadel SSO...',
  'auth.oidcExchanging': 'Đang xác thực phiên Zitadel với Qlaok...',
  'auth.oidcConfigMissingTitle': 'Chưa cấu hình Zitadel OIDC cho thiết bị di động',
  'auth.ownerSessionExpiredNotice':
    'Phiên đăng nhập Chủ quán đã hết hạn. Vui lòng đăng nhập lại qua Zitadel.',

  // App Shell & Navigation
  'shell.defaultShopName': 'Quản lý quán',
  'shell.defaultCity': 'Đà Nẵng',
  'shell.headerSubtitle': '{city}',
  'shell.statusLive': 'Trực tiếp',
  'shell.statusAuto': 'Tự cập nhật',
  'shell.themeLight': 'Chế độ sáng',
  'shell.themeDark': 'Chế độ tối',
  'shell.logout': 'Thoát',
  'shell.logoutConfirmTitle': 'Đăng xuất tài khoản?',
  'shell.logoutConfirmDesc': 'Bạn có chắc muốn đăng xuất khỏi thiết bị này?',
  'shell.logoutErrorTitle': 'Không thể đăng xuất',
  'shell.liveOrderBadge': 'ĐƠN MỚI TẠI BÀN',
  'shell.liveOrderViewCta': 'Xem đơn',
  'shell.loadingStore': 'Đang tải dữ liệu quán...',
  'shell.noShopsTitle': 'Tài khoản chưa có cửa hàng',
  'shell.noShopsDesc':
    'Tài khoản này hiện chưa sở hữu hoặc tham gia cửa hàng nào. Bạn có thể khởi tạo cửa hàng mới trên trang web hoặc tải lại.',
  'shell.openWebOnboarding': 'Mở trang tạo cửa hàng',
  'shell.refreshStores': 'Tải lại danh sách',

  'nav.orders': 'Đơn ({count})',
  'nav.overview': 'Doanh thu',
  'nav.catalog': 'Kho ({count})',
  'nav.promotions': 'Khuyến mãi',
  'nav.settings': 'Giao diện',

  'alert.networkErrorTitle': 'Lỗi kết nối mạng',
  'alert.loadShopErrorDesc': 'Không thể tải dữ liệu cửa hàng',
  'alert.notificationShopUnavailableTitle':
    'Không thể mở cửa hàng từ thông báo',
  'alert.notificationShopUnavailableDesc':
    'Cửa hàng trong thông báo không còn khả dụng hoặc tài khoản không có quyền xem đơn của quán này. Vui lòng chọn cửa hàng khác.',
  'alert.invalidOrderResponse': 'Máy chủ trả về đơn hàng không hợp lệ',
  'alert.updateOrderFailed': 'Không thể cập nhật đơn. Vui lòng thử lại',
  'alert.permissionDeniedTitle': 'Không đủ quyền',
  'alert.permissionDeniedDesc':
    'Tài khoản hiện tại không có quyền thay đổi cài đặt hoặc khuyến mãi của quán.',
  'alert.saveErrorTitle': 'Lỗi lưu cài đặt',
  'alert.saveErrorDesc': 'Không thể lưu cài đặt',
  'alert.saveSuccessTitle': 'Đã lưu thành công',
  'alert.saveSuccessDesc':
    'Đã cập nhật giao diện, khuyến mãi và cài đặt quán!',

  // OrdersTab
  'orders.filterActive': 'Đang xử lý ({count})',
  'orders.filterNew': 'Chờ nhận ({count})',
  'orders.filterPreparing': 'Đang làm ({count})',
  'orders.filterCompleted': 'Hoàn tất',
  'orders.emptyTitle': 'Chưa có đơn hàng trong mục này',
  'orders.emptyDesc':
    'Đơn khách đặt qua mã QR tại bàn sẽ tự động báo rung và hiển thị ngay tại đây.',
  'orders.guestLang': 'Khách: {lang}',
  'orders.methodQr': 'Chuyển khoản QR',
  'orders.methodCash': 'Tiền mặt',
  'orders.statusPaid': '✓ Đã thu tiền',
  'orders.statusRefunded': '↩ Đã hoàn tiền',
  'orders.statusUnpaid': 'Chưa thu tiền',
  'orders.tableNote': 'Ghi chú bàn: {note}',
  'orders.actionAccept': 'Nhận đơn & Báo bếp',
  'orders.actionServed': 'Đã phục vụ',
  'orders.actionConfirmPaid': 'Xác nhận đã thu',
  'orders.actionRefund': 'Hoàn tiền',
  'orders.actionCancel': 'Hủy',
  'orders.actionViewReceipt': 'Xem hóa đơn',
  'orders.actionViewTicket': 'Xem phiếu in',
  'orders.confirmCancelTitle': 'Xác nhận hủy đơn',
  'orders.confirmCancelDesc': 'Bạn có chắc muốn hủy đơn #{code} ({table})?',
  'orders.cancelReasonLabel': 'Lý do hủy đơn *',
  'orders.cancelReasonPlaceholder': 'VD: Khách đổi ý, hết món...',
  'orders.cancelReasonRequired':
    'Vui lòng nhập lý do hủy đơn trước khi xác nhận.',
  'orders.confirmPaidTitle': 'Xác nhận đã thu tiền',
  'orders.confirmPaidDesc': 'Xác nhận đã thu {total} cho đơn #{code}?',
  'orders.confirmRefundTitle': 'Xác nhận hoàn tiền',
  'orders.confirmRefundDesc': 'Xác nhận hoàn tiền {total} cho đơn #{code}?',
  'orders.refundReasonLabel': 'Lý do hoàn tiền *',
  'orders.refundReasonPlaceholder':
    'VD: Món lỗi, khách hủy sau khi thanh toán...',
  'orders.refundReasonRequired':
    'Vui lòng nhập lý do hoàn tiền trước khi xác nhận.',
  'orders.reasonTooLong': 'Lý do không được vượt quá {max} ký tự.',
  'orders.paidCancelRequiresRefund':
    'Đơn đã thu tiền: hãy xác nhận hoàn tiền trước khi hủy.',
  'orders.reasonBadgeRefund': 'Lý do hoàn tiền: {reason}',
  'orders.reasonBadgeCancel': 'Lý do hủy: {reason}',
  'orders.fetchErrorTitle': 'Không thể tải danh sách đơn hàng',
  'orders.retryBtn': 'Thử lại',

  // OverviewTab
  'overview.heroLabel': 'DOANH THU ĐÃ THU HÔM NAY',
  'overview.heroSub':
    'Lũy kế đã thu: {totalRevenue} ({paidCount} đơn) • {availableCount}/{totalItems} món đang bán',
  'overview.chartHeading': '📊 Doanh thu 7 ngày qua',
  'overview.kpiActiveTitle': 'Đơn đang phục vụ',
  'overview.kpiActiveHint': 'Mới: {newCount} • Đang làm: {preparingCount}',
  'overview.kpiLowStockTitle': 'Món sắp hết (<=5)',
  'overview.kpiLowStockHint': 'Đã hết hàng: {outCount} món',
  'overview.kpiQrScansTitle': 'Tổng lượt quét QR',
  'overview.kpiQrScansHint': 'Cửa: {doorCount} • Bàn: {tableCount}',
  'overview.kpiLangsTitle': 'Ngôn ngữ menu',
  'overview.topItemsHeading': 'Món bán chạy',
  'overview.itemPriceSold': '{price} • Đã bán: {sold}',
  'overview.itemStock': 'Tồn: {stock}',

  // CatalogTab
  'catalog.quickAddHeading': '+ Thêm món',
  'catalog.namePlaceholder': 'Tên món (VD: Phở tái)',
  'catalog.pricePlaceholder': 'Giá (35000)',
  'catalog.stockPlaceholder': 'Tồn (∞)',
  'catalog.addBtn': 'Thêm',
  'catalog.filterAll': 'Tất cả ({count})',
  'catalog.itemEnSold': 'EN: {enName} • Đã bán: {sold}',
  'catalog.stockLabel': 'Tồn kho: {stock}',
  'catalog.statusInStock': 'Còn món',
  'catalog.statusSoldOut': 'Hết hàng',
  'catalog.errUpdateTitle': 'Lỗi cập nhật',
  'catalog.errPriceTitle': 'Không thể cập nhật giá',
  'catalog.errStockTitle': 'Không thể cập nhật tồn',
  'catalog.errNoCatTitle': 'Chưa có danh mục',
  'catalog.errNoCatDesc': 'Vui lòng tạo danh mục trước.',
  'catalog.errAddItemTitle': 'Không thể thêm món',
  'catalog.errInvalidNameDesc': 'Vui lòng nhập tên món.',
  'catalog.errInvalidPriceDesc': 'Vui lòng nhập giá bán hợp lệ lớn hơn 0đ.',

  // Preview & PromotionsTab
  'preview.defaultShopName': 'Tên Quán',
  'preview.liveBadge': '📱 Xem trước',
  'promo.subTabDiscount': '🔥 Giảm giá & Banner',
  'promo.subTabFlashSale': '⚡ Flash Sale',
  'promo.discountHeading': '🔥 Giảm giá hóa đơn / Theo món',
  'promo.discountTypeLabel': 'Hình thức giảm giá',
  'promo.discountTypePercent': 'Theo %',
  'promo.discountTypeFixed': 'Số tiền (đ)',
  'promo.quickDiscountLabel': 'Mức giảm nhanh',
  'promo.minOrderLabel': 'Đơn tối thiểu',
  'promo.minOrder0': '0đ (Mọi đơn)',
  'promo.minOrder50k': 'Từ 50k',
  'promo.minOrder100k': 'Từ 100k',
  'promo.minOrder200k': 'Từ 200k',
  'promo.scopeLabel': 'Phạm vi áp dụng',
  'promo.scopeAll': 'Toàn bộ Menu',
  'promo.scopeSelected': 'Chọn món ({count})',
  'promo.bannerColorLabel': 'Màu Banner',
  'promo.welcomePopupLabel': 'Lời chào khi quét QR',
  'promo.savePromosBtn': 'Lưu khuyến mãi',
  'promo.flashHeading': '⚡ Flash Sale giờ vàng',
  'promo.flashDiscountLabel': 'Mức giảm Flash Sale (%)',
  'promo.flashDurationLabel': '📅 Thời hạn chiến dịch',
  'promo.presetToday': 'Hôm nay',
  'promo.preset3Days': '3 ngày',
  'promo.preset7Days': '7 ngày',
  'promo.preset14Days': '14 ngày',
  'promo.preset30Days': '30 ngày',
  'promo.startDateLabel': 'Từ ngày (YYYY-MM-DD)',
  'promo.endDateLabel': 'Đến ngày (YYYY-MM-DD)',
  'promo.timeSlotLabel': '⏰ Khung giờ vàng mỗi ngày',
  'promo.slotLunch': '🍱 Trưa 11:00–14:00',
  'promo.slotAfternoon': '🧋 Chiều 14:00–17:00',
  'promo.slotEvening': '🍻 Tối 18:00–22:00',
  'promo.slotAllDay': '🔥 Cả ngày 00:00–23:45',
  'promo.startTimeLabel': 'Giờ bắt đầu',
  'promo.endTimeLabel': 'Giờ kết thúc',
  'promo.selectFlashItemsLabel': 'Chọn món Flash Sale ({count} món):',
  'promo.saveFlashBtn': 'Lưu Flash Sale',

  // SettingsTab
  'settings.languageHeading': '🌐 Ngôn ngữ ứng dụng',
  'settings.themeHeading': 'Giao diện',
  'settings.primaryColorLabel': 'Màu chủ đạo',
  'settings.bgStyleLabel': 'Nền màn hình khách',
  'settings.bgClean': '☀️ Sáng',
  'settings.bgWarm': '🏮 Kem ấm',
  'settings.bgDark': '🌙 Tối',
  'settings.layoutLabel': 'Bố cục hiển thị món',
  'settings.layoutList': 'Danh sách ngang',
  'settings.layoutGrid': 'Lưới 2 cột',
  'settings.storeInfoHeading': 'Thông tin quán & Wi-Fi',
  'settings.shopNameLabel': 'Tên cửa hàng',
  'settings.cityLabel': 'Tỉnh / Thành phố',
  'settings.phoneLabel': 'Số điện thoại / Zalo',
  'settings.wifiSsidLabel': 'Tên Wi-Fi',
  'settings.wifiPassLabel': 'Mật khẩu Wi-Fi',
  'settings.saveAllBtn': 'Lưu cài đặt',

  // ReceiptModal
  'receipt.modalTitle': 'Phiếu in ({size})',
  'receipt.tabKitchen': '🍳 Báo bếp',
  'receipt.tabProvisional': '📋 Tạm tính',
  'receipt.tabReceipt': '🧾 Hóa đơn',
  'receipt.paperSize80': 'Khổ K80 (80mm)',
  'receipt.paperSize58': 'Khổ K58 (58mm)',
  'receipt.headerKitchen': 'PHIẾU BÁO BẾP / BAR',
  'receipt.headerProvisional': 'PHIẾU TẠM TÍNH',
  'receipt.headerPaidReceipt': 'HÓA ĐƠN THANH TOÁN',
  'receipt.headerUnpaidReceipt': 'HÓA ĐƠN (CHƯA THU TIỀN)',
  'receipt.phonePrefix': 'ĐT: {phone}',
  'receipt.reprintBadge': '[BẢN IN LẠI LẦN {count}]',
  'receipt.orderMeta': 'Mã: #{code} • {table} • Ver #{version}',
  'receipt.subtotal': 'Tạm tính:',
  'receipt.discount': 'Giảm giá / KM:',
  'receipt.totalPaid': 'ĐÃ THANH TOÁN:',
  'receipt.totalDue': 'TỔNG THANH TOÁN:',
  'receipt.statusLine': 'Trạng thái: {status} ({method})',
  'receipt.statusPaid': '✓ ĐÃ THANH TOÁN',
  'receipt.statusRefunded': '↩ ĐÃ HOÀN TIỀN',
  'receipt.statusUnpaid': 'CHƯA THANH TOÁN',
  'receipt.methodQr': 'VietQR',
  'receipt.methodCash': 'Tiền mặt',
  'receipt.qrNotConfiguredWarning':
    '⚠️ Quán chưa cấu hình tài khoản ngân hàng nhận QR.',
  'receipt.wifiLine': 'Wi-Fi: {ssid} (Pass: {password})',
  'receipt.wifiFree': 'Miễn phí',
  'receipt.thankYou': 'Cảm ơn Quý khách & Hẹn gặp lại!',
  'receipt.printInfoBtn': 'Xem thông tin in ({size})',
  'receipt.previewAlertTitle': '📄 Bản xem trước phiếu in nhiệt',
  'receipt.previewAlertBody':
    'Phiếu "{ticket}" #{code} ({table}), khổ {size}. Chưa gửi lệnh in và chưa ghi nhận lượt in phần cứng.',
} as const;

export type MobileTranslationKey = keyof typeof VI_MOBILE_DICTIONARY;

const EN_MOBILE_DICTIONARY: Record<MobileTranslationKey, string> = {
  // Common & Language Switcher
  'common.language': 'App language',
  'common.languageShort': 'Language',
  'common.switchToVi': 'Chuyển sang Tiếng Việt',
  'common.switchToEn': 'Switch to English',
  'common.tryAgain': 'Please try again',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.add': 'Add',

  // AuthScreen
  'auth.title': 'Qlaok Store Manager',
  'auth.subtitle': 'Manage table orders, checkout, menu, and daily sales',
  'auth.emailLabel': 'Email',
  'auth.passwordLabel': 'Password',
  'auth.submit': 'Sign in',
  'auth.submitting': 'Signing in...',
  'auth.errorFallback': 'Please check your email or password',
  'auth.createStorePrompt': 'Need a store account? Register on Web',
  'auth.forgotPasswordPrompt': 'Forgot password?',
  'auth.recoveryTitle': 'Reset password',
  'auth.recoverySubtitle':
    'Enter your account email to receive a password reset link or code',
  'auth.recoverySendBtn': 'Send reset instructions',
  'auth.recoverySending': 'Sending request...',
  'auth.recoverySentNotice':
    'If {email} belongs to an account that supports email recovery, reset instructions will be sent to your inbox. Local-password, demo, or admin accounts require administrator support.',
  'auth.recoveryCodeLabel': 'Recovery code from email',
  'auth.recoveryNewPasswordLabel': 'New password (at least 6 characters)',
  'auth.recoveryCompleteBtn': 'Save new password',
  'auth.recoveryCompleting': 'Updating password...',
  'auth.recoverySuccessNotice':
    'Password updated for {email}. You can now sign in with your new password.',
  'auth.recoveryBackToLogin': '← Back to sign in',
  'auth.recoveryOpenWebFallback': 'Open password recovery on Web',
  'auth.recoveryErrInvalidEmail':
    'Please enter a valid email address to reset your password.',
  'auth.recoveryErrUnsupportedAccount':
    'Demo, system, or custom-credential accounts do not support self-service password reset in the app.',
  'auth.recoveryErrUnsupportedProvider':
    'Email password reset is currently unavailable on this server. Please use the web recovery page or contact your administrator.',
  'auth.recoveryErrRateLimited':
    'Too many reset requests. Please wait a few minutes and try again.',
  'auth.recoveryErrNetwork':
    'Unable to reach the authentication server. Please check your connection and try again.',
  'auth.recoveryErrInvalidCode':
    'The recovery code is invalid or expired. Please check your email and try again.',
  'auth.recoveryErrWeakPassword':
    'New password must be at least 6 characters.',
  'auth.oidcBadge': 'Zitadel OIDC • PKCE S256',
  'auth.oidcSubtitle':
    'Sign in securely as a Store Owner via Zitadel SSO (auth.vunph.click). Passwords are never entered or stored in the app.',
  'auth.oidcEmailHintLabel': 'Email login hint (optional)',
  'auth.oidcEmailHintPlaceholder': 'owner@yourstore.vn',
  'auth.oidcSignInBtn': 'Sign in as Owner with Zitadel SSO',
  'auth.oidcRegisterBtn': 'Create Owner account on Zitadel',
  'auth.oidcForgotPasswordBtn': 'Forgot password on Zitadel?',
  'auth.oidcRedirecting': 'Opening Zitadel SSO...',
  'auth.oidcExchanging': 'Verifying Zitadel session with Qlaok...',
  'auth.oidcConfigMissingTitle': 'Mobile Zitadel OIDC not configured',
  'auth.ownerSessionExpiredNotice':
    'Your Owner session has expired. Please sign in again with Zitadel.',

  // App Shell & Navigation
  'shell.defaultShopName': 'Store Manager',
  'shell.defaultCity': 'Da Nang',
  'shell.headerSubtitle': '{city}',
  'shell.statusLive': 'Live',
  'shell.statusAuto': 'Auto',
  'shell.themeLight': 'Light mode',
  'shell.themeDark': 'Dark mode',
  'shell.logout': 'Sign out',
  'shell.logoutConfirmTitle': 'Sign out?',
  'shell.logoutConfirmDesc': 'Are you sure you want to sign out of this device?',
  'shell.logoutErrorTitle': 'Unable to sign out',
  'shell.liveOrderBadge': 'NEW TABLE ORDER',
  'shell.liveOrderViewCta': 'View',
  'shell.loadingStore': 'Loading store data...',
  'shell.noShopsTitle': 'No stores found',
  'shell.noShopsDesc':
    'This account does not own or belong to any store yet. You can create a new store on the web app or refresh.',
  'shell.openWebOnboarding': 'Create store on Web',
  'shell.refreshStores': 'Refresh list',

  'nav.orders': 'Orders ({count})',
  'nav.overview': 'Sales',
  'nav.catalog': 'Menu ({count})',
  'nav.promotions': 'Promos',
  'nav.settings': 'Settings',

  'alert.networkErrorTitle': 'Connection error',
  'alert.loadShopErrorDesc': 'Unable to load store data',
  'alert.notificationShopUnavailableTitle':
    'Store from notification unavailable',
  'alert.notificationShopUnavailableDesc':
    'The store from this notification is unavailable or your account cannot view its orders. Please select an available store.',
  'alert.invalidOrderResponse': 'Invalid order response from server',
  'alert.updateOrderFailed': 'Unable to update order. Please try again',
  'alert.permissionDeniedTitle': 'Permission denied',
  'alert.permissionDeniedDesc':
    'Your account does not have permission to change store settings or promotions.',
  'alert.saveErrorTitle': 'Save failed',
  'alert.saveErrorDesc': 'Unable to save settings',
  'alert.saveSuccessTitle': 'Saved',
  'alert.saveSuccessDesc':
    'Store theme, promotions, and settings have been updated!',

  // OrdersTab
  'orders.filterActive': 'Active ({count})',
  'orders.filterNew': 'New ({count})',
  'orders.filterPreparing': 'Preparing ({count})',
  'orders.filterCompleted': 'Completed',
  'orders.emptyTitle': 'No orders in this view',
  'orders.emptyDesc':
    'Orders placed via table QR will vibrate and appear here automatically.',
  'orders.guestLang': 'Guest: {lang}',
  'orders.methodQr': 'QR Transfer',
  'orders.methodCash': 'Cash',
  'orders.statusPaid': '✓ Paid',
  'orders.statusRefunded': '↩ Refunded',
  'orders.statusUnpaid': 'Unpaid',
  'orders.tableNote': 'Table note: {note}',
  'orders.actionAccept': 'Accept & Prep',
  'orders.actionServed': 'Served',
  'orders.actionConfirmPaid': 'Mark paid',
  'orders.actionRefund': 'Refund',
  'orders.actionCancel': 'Cancel',
  'orders.actionViewReceipt': 'View receipt',
  'orders.actionViewTicket': 'Print preview',
  'orders.confirmCancelTitle': 'Cancel order',
  'orders.confirmCancelDesc': 'Are you sure you want to cancel order #{code} ({table})?',
  'orders.cancelReasonLabel': 'Cancellation reason *',
  'orders.cancelReasonPlaceholder': 'e.g. Guest changed mind, item sold out...',
  'orders.cancelReasonRequired':
    'Please enter a cancellation reason before confirming.',
  'orders.confirmPaidTitle': 'Confirm payment',
  'orders.confirmPaidDesc': 'Confirm collecting {total} for order #{code}?',
  'orders.confirmRefundTitle': 'Confirm refund',
  'orders.confirmRefundDesc': 'Confirm refunding {total} for order #{code}?',
  'orders.refundReasonLabel': 'Refund reason *',
  'orders.refundReasonPlaceholder':
    'e.g. Wrong item, guest cancelled after paying...',
  'orders.refundReasonRequired':
    'Please enter a refund reason before confirming.',
  'orders.reasonTooLong': 'Reason must not exceed {max} characters.',
  'orders.paidCancelRequiresRefund':
    'Paid order: please confirm a refund before cancelling.',
  'orders.reasonBadgeRefund': 'Refund reason: {reason}',
  'orders.reasonBadgeCancel': 'Cancel reason: {reason}',
  'orders.fetchErrorTitle': 'Unable to load orders',
  'orders.retryBtn': 'Retry',

  // OverviewTab
  'overview.heroLabel': 'PAID REVENUE TODAY',
  'overview.heroSub':
    'Total collected: {totalRevenue} ({paidCount} orders) • {availableCount}/{totalItems} items active',
  'overview.chartHeading': '📊 Last 7 Days Revenue',
  'overview.kpiActiveTitle': 'Active orders',
  'overview.kpiActiveHint': 'New: {newCount} • Preparing: {preparingCount}',
  'overview.kpiLowStockTitle': 'Low stock (<=5)',
  'overview.kpiLowStockHint': 'Out of stock: {outCount}',
  'overview.kpiQrScansTitle': 'Total QR scans',
  'overview.kpiQrScansHint': 'Door: {doorCount} • Table: {tableCount}',
  'overview.kpiLangsTitle': 'Menu languages',
  'overview.topItemsHeading': 'Best sellers',
  'overview.itemPriceSold': '{price} • Sold: {sold}',
  'overview.itemStock': 'Stock: {stock}',

  // CatalogTab
  'catalog.quickAddHeading': '+ Add item',
  'catalog.namePlaceholder': 'Item name (e.g. Pho)',
  'catalog.pricePlaceholder': 'Price (35000)',
  'catalog.stockPlaceholder': 'Stock (∞)',
  'catalog.addBtn': 'Add',
  'catalog.filterAll': 'All ({count})',
  'catalog.itemEnSold': 'EN: {enName} • Sold: {sold}',
  'catalog.stockLabel': 'Stock: {stock}',
  'catalog.statusInStock': 'In stock',
  'catalog.statusSoldOut': 'Sold out',
  'catalog.errUpdateTitle': 'Update failed',
  'catalog.errPriceTitle': 'Unable to update price',
  'catalog.errStockTitle': 'Unable to update stock',
  'catalog.errNoCatTitle': 'No category',
  'catalog.errNoCatDesc': 'Please create a category first.',
  'catalog.errAddItemTitle': 'Unable to add item',
  'catalog.errInvalidNameDesc': 'Please enter an item name.',
  'catalog.errInvalidPriceDesc': 'Please enter a valid price greater than 0.',

  // Preview & PromotionsTab
  'preview.defaultShopName': 'Store Name',
  'preview.liveBadge': '📱 Live preview',
  'promo.subTabDiscount': '🔥 Discount & Banner',
  'promo.subTabFlashSale': '⚡ Flash Sale',
  'promo.discountHeading': '🔥 Order & Item Discount',
  'promo.discountTypeLabel': 'Discount type',
  'promo.discountTypePercent': 'Percentage (%)',
  'promo.discountTypeFixed': 'Fixed amount (đ)',
  'promo.quickDiscountLabel': 'Quick discount',
  'promo.minOrderLabel': 'Minimum order',
  'promo.minOrder0': '0đ (All orders)',
  'promo.minOrder50k': 'Min 50k',
  'promo.minOrder100k': 'Min 100k',
  'promo.minOrder200k': 'Min 200k',
  'promo.scopeLabel': 'Apply to',
  'promo.scopeAll': 'Entire menu',
  'promo.scopeSelected': 'Selected items ({count})',
  'promo.bannerColorLabel': 'Banner color',
  'promo.welcomePopupLabel': 'Welcome message on QR scan',
  'promo.savePromosBtn': 'Save promotions',
  'promo.flashHeading': '⚡ Flash Sale',
  'promo.flashDiscountLabel': 'Flash Sale discount (%)',
  'promo.flashDurationLabel': '📅 Campaign duration',
  'promo.presetToday': 'Today',
  'promo.preset3Days': '3 days',
  'promo.preset7Days': '7 days',
  'promo.preset14Days': '14 days',
  'promo.preset30Days': '30 days',
  'promo.startDateLabel': 'Start date (YYYY-MM-DD)',
  'promo.endDateLabel': 'End date (YYYY-MM-DD)',
  'promo.timeSlotLabel': '⏰ Daily time slot',
  'promo.slotLunch': '🍱 Lunch 11:00–14:00',
  'promo.slotAfternoon': '🧋 Afternoon 14:00–17:00',
  'promo.slotEvening': '🍻 Evening 18:00–22:00',
  'promo.slotAllDay': '🔥 All day 00:00–23:45',
  'promo.startTimeLabel': 'Start time',
  'promo.endTimeLabel': 'End time',
  'promo.selectFlashItemsLabel': 'Select Flash Sale items ({count}):',
  'promo.saveFlashBtn': 'Save Flash Sale',

  // SettingsTab
  'settings.languageHeading': '🌐 App Language',
  'settings.themeHeading': 'Appearance',
  'settings.primaryColorLabel': 'Primary color',
  'settings.bgStyleLabel': 'Storefront background',
  'settings.bgClean': '☀️ Light',
  'settings.bgWarm': '🏮 Warm',
  'settings.bgDark': '🌙 Dark',
  'settings.layoutLabel': 'Menu layout',
  'settings.layoutList': 'List view',
  'settings.layoutGrid': '2-column grid',
  'settings.storeInfoHeading': 'Store Info & Wi-Fi',
  'settings.shopNameLabel': 'Store name',
  'settings.cityLabel': 'City / Province',
  'settings.phoneLabel': 'Phone / Zalo',
  'settings.wifiSsidLabel': 'Wi-Fi name',
  'settings.wifiPassLabel': 'Wi-Fi password',
  'settings.saveAllBtn': 'Save settings',

  // ReceiptModal
  'receipt.modalTitle': 'Print preview ({size})',
  'receipt.tabKitchen': '🍳 Kitchen',
  'receipt.tabProvisional': '📋 Provisional',
  'receipt.tabReceipt': '🧾 Receipt',
  'receipt.paperSize80': 'Size K80 (80mm)',
  'receipt.paperSize58': 'Size K58 (58mm)',
  'receipt.headerKitchen': 'KITCHEN / BAR TICKET',
  'receipt.headerProvisional': 'PROVISIONAL BILL',
  'receipt.headerPaidReceipt': 'PAYMENT RECEIPT',
  'receipt.headerUnpaidReceipt': 'RECEIPT (UNPAID)',
  'receipt.phonePrefix': 'Tel: {phone}',
  'receipt.reprintBadge': '[REPRINT #{count}]',
  'receipt.orderMeta': 'No: #{code} • {table} • Ver #{version}',
  'receipt.subtotal': 'Subtotal:',
  'receipt.discount': 'Discount:',
  'receipt.totalPaid': 'TOTAL PAID:',
  'receipt.totalDue': 'TOTAL DUE:',
  'receipt.statusLine': 'Status: {status} ({method})',
  'receipt.statusPaid': '✓ PAID',
  'receipt.statusRefunded': '↩ REFUNDED',
  'receipt.statusUnpaid': 'UNPAID',
  'receipt.methodQr': 'VietQR',
  'receipt.methodCash': 'Cash',
  'receipt.qrNotConfiguredWarning':
    '⚠️ Store bank account for QR payment is not configured.',
  'receipt.wifiLine': 'Wi-Fi: {ssid} (Pass: {password})',
  'receipt.wifiFree': 'Free',
  'receipt.thankYou': 'Thank you & See you again!',
  'receipt.printInfoBtn': 'Print info ({size})',
  'receipt.previewAlertTitle': '📄 Thermal receipt preview',
  'receipt.previewAlertBody':
    'Ticket "{ticket}" #{code} ({table}), size {size}. Preview only — no hardware print job was sent.',
};

export const MOBILE_DICTIONARY: Record<
  MobileLocale,
  Record<MobileTranslationKey, string>
> = {
  vi: VI_MOBILE_DICTIONARY,
  en: EN_MOBILE_DICTIONARY,
};

export type MobileTranslationParams = Record<
  string,
  string | number | undefined | null
>;

export interface MobileLocaleStorageAdapter {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

let inMemoryLocale: MobileLocale | null = null;
let localeRevision = 0;
const pendingWrites = new WeakMap<object, Promise<void>>();

/**
 * Normalizes any raw locale input into a supported MobileLocale ('vi' | 'en').
 */
export function normalizeMobileLocale(
  raw: unknown,
  fallback: MobileLocale = DEFAULT_MOBILE_LOCALE
): MobileLocale {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'en' || cleaned.startsWith('en-')) return 'en';
  if (cleaned === 'vi' || cleaned.startsWith('vi-')) return 'vi';
  return fallback;
}

/**
 * Replaces `{param}` tokens in a template string with values from `params`.
 */
export function interpolateMobileTemplate(
  template: string,
  params?: MobileTranslationParams
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
 * Converts a dot-separated key into a readable fallback label if an unknown key is passed.
 */
export function humanizeMobileTranslationKey(key: string): string {
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
 * Typed translation function with parameter interpolation and multi-step fallback:
 * 1. Target locale entry (if non-empty)
 * 2. Fallback locale ('vi' by default) entry (if non-empty)
 * 3. Humanized key fallback
 */
export function translateMobile(
  locale: MobileLocale | string | undefined | null,
  key: MobileTranslationKey | string,
  params?: MobileTranslationParams,
  fallbackLocale: MobileLocale = DEFAULT_MOBILE_LOCALE
): string {
  const resolvedLocale = normalizeMobileLocale(locale, fallbackLocale);
  const targetDict = MOBILE_DICTIONARY[resolvedLocale] as Record<string, string>;
  const fallbackDict = MOBILE_DICTIONARY[fallbackLocale] as Record<
    string,
    string
  >;

  const rawTarget = targetDict?.[key];
  const rawFallback = fallbackDict?.[key];

  const template =
    typeof rawTarget === 'string' && rawTarget.trim().length > 0
      ? rawTarget
      : typeof rawFallback === 'string' && rawFallback.trim().length > 0
        ? rawFallback
        : humanizeMobileTranslationKey(String(key));

  return interpolateMobileTemplate(template, params);
}

/**
 * Inline bilingual helper with fallback to Vietnamese when English text is empty,
 * plus `{param}` interpolation support.
 */
export function bilingualMobileText(
  locale: MobileLocale | string | undefined | null,
  viText: string,
  enText?: string | null,
  params?: MobileTranslationParams
): string {
  const resolved = normalizeMobileLocale(locale, DEFAULT_MOBILE_LOCALE);
  const chosen =
    resolved === 'en' && typeof enText === 'string' && enText.trim().length > 0
      ? enText
      : viText;
  return interpolateMobileTemplate(chosen, params);
}

/**
 * Synchronously reads persisted mobile locale from provided storage, browser localStorage, or memory.
 */
export function getStoredMobileLocale(
  storage?: Pick<Storage, 'getItem'> | null,
  fallback: MobileLocale = DEFAULT_MOBILE_LOCALE
): MobileLocale {
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    if (targetStorage) {
      const saved = targetStorage.getItem(MOBILE_LOCALE_STORAGE_KEY);
      if (saved) {
        const normalized = normalizeMobileLocale(saved, fallback);
        inMemoryLocale = normalized;
        return normalized;
      }
    }
    if (inMemoryLocale) return inMemoryLocale;
    return fallback;
  } catch {
    return inMemoryLocale || fallback;
  }
}

/**
 * Synchronously persists mobile locale to provided storage, browser localStorage, and memory.
 */
export function setStoredMobileLocale(
  locale: MobileLocale | string,
  storage?: Pick<Storage, 'setItem'> | null
): MobileLocale {
  const normalized = normalizeMobileLocale(locale, DEFAULT_MOBILE_LOCALE);
  localeRevision++;
  inMemoryLocale = normalized;
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    targetStorage?.setItem(MOBILE_LOCALE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage quota or restricted webstorage errors
  }
  return normalized;
}

/**
 * Asynchronously loads persisted mobile locale (supports Expo SecureStore on native and localStorage on web).
 */
export async function loadPersistedMobileLocale(
  adapter?: Pick<MobileLocaleStorageAdapter, 'getItem'> | null,
  fallback: MobileLocale = DEFAULT_MOBILE_LOCALE
): Promise<MobileLocale> {
  const revision = localeRevision;
  try {
    if (adapter) {
      const saved = await adapter.getItem(MOBILE_LOCALE_STORAGE_KEY);
      if (revision !== localeRevision) return inMemoryLocale || fallback;
      if (saved) {
        const normalized = normalizeMobileLocale(saved, fallback);
        inMemoryLocale = normalized;
        return normalized;
      }
    }
  } catch {
    // Ignore async storage errors and fall back to sync/memory
  }
  return getStoredMobileLocale(undefined, fallback);
}

/**
 * Asynchronously saves persisted mobile locale (supports Expo SecureStore on native and localStorage on web).
 */
export async function savePersistedMobileLocale(
  locale: MobileLocale | string,
  adapter?: Pick<MobileLocaleStorageAdapter, 'setItem'> | null
): Promise<MobileLocale> {
  const normalized = setStoredMobileLocale(locale);
  try {
    if (adapter) {
      // SecureStore writes may finish out of order when someone switches quickly.
      const previous = pendingWrites.get(adapter) || Promise.resolve();
      const write = previous.catch(() => {}).then(() =>
        adapter.setItem(MOBILE_LOCALE_STORAGE_KEY, normalized)
      );
      pendingWrites.set(adapter, write);
      await write;
    }
  } catch {
    // Ignore async storage errors
  }
  return normalized;
}
