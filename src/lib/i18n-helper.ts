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
  return 'vi';
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

export function checkShopOpenStatus(openingHours: OpeningHours): {
  isOpen: boolean;
  todaySchedule: { open: string; close: string; closed: boolean };
} {
  const days: Array<keyof OpeningHours> = [
    'sun',
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
  ];
  const now = new Date();
  const dayKey = days[now.getDay()];
  const schedule = openingHours?.[dayKey] || {
    open: '08:00',
    close: '22:00',
    closed: false,
  };

  if (schedule.closed) {
    return { isOpen: false, todaySchedule: schedule };
  }

  const currentMins = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = schedule.open.split(':').map(Number);
  const [closeH, closeM] = schedule.close.split(':').map(Number);
  const openMins = (openH ?? 8) * 60 + (openM ?? 0);
  const closeMins = (closeH ?? 22) * 60 + (closeM ?? 0);

  const isOpen = currentMins >= openMins && currentMins <= closeMins;
  return { isOpen, todaySchedule: schedule };
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
  stockLeftPrefix: string;
  stockLeftSuffix: string;
  qtyShort: string;
  unitPriceLabel: string;
  notePrefix: string;
  cashPayment: string;
  qrPayment: string;
  tablePrefix: string;
  takeawayOption: string;
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
    showToStaffSub: 'Kiểm tra món đã chọn, chọn vị trí bàn và gửi đơn trực tiếp xuống quầy',
    totalEstimated: 'Tổng cộng tạm tính',
    sendZaloOrder: 'Gửi đơn qua Zalo quán',
    clearSelection: 'Xóa danh sách chọn',
    backToStore: 'Thông tin quán',
    requiredBadge: 'Bắt buộc',
    stockLeftPrefix: 'Còn ',
    stockLeftSuffix: '',
    qtyShort: 'SL',
    unitPriceLabel: 'Đơn giá',
    notePrefix: 'Ghi chú',
    cashPayment: 'Tiền mặt tại quầy',
    qrPayment: 'Chuyển khoản QR',
    tablePrefix: 'Bàn',
    takeawayOption: 'Mang về',
    emptyCartTitle: 'Chưa có món / dịch vụ nào được chọn',
    backToMenuBtn: 'Quay lại chọn món',
    liveOrderSentPrefix: 'Đơn ',
    liveOrderSentSuffix: ' đã gửi xuống quầy',
    liveOrderBannerSub: 'Chạm để xem tiến độ chế biến & phục vụ trực tiếp',
    viewOrderBtn: 'Xem đơn',
    orderItemsSentHeading: 'Chi tiết món đã gửi xuống quầy',
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
    bottomCtaFnb: 'Review Order & Send to Kitchen',
    bottomCtaService: 'Review Services & Confirm Booking',
    bottomCtaRetail: 'Review Cart & Place Order',
    bottomBarHint: '🚀 Send your order directly to the counter & kitchen in real time',
    showToStaffHeader: 'REVIEW & CONFIRM YOUR ORDER',
    showToStaffSub: 'Check your items, select your table number, and send directly to the kitchen',
    totalEstimated: 'Estimated Total',
    sendZaloOrder: 'Send via Zalo',
    clearSelection: 'Clear All',
    backToStore: 'Store Info',
    requiredBadge: 'Required',
    stockLeftPrefix: '',
    stockLeftSuffix: ' left',
    qtyShort: 'QTY',
    unitPriceLabel: 'Unit price',
    notePrefix: 'Note',
    cashPayment: 'Cash at Counter',
    qrPayment: 'QR Bank Transfer',
    tablePrefix: 'Table',
    takeawayOption: 'Takeaway',
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
    stockLeftPrefix: '잔여 ',
    stockLeftSuffix: '개',
    qtyShort: '수량',
    unitPriceLabel: '단가',
    notePrefix: '요청사항',
    cashPayment: '현금 결제 (Cash)',
    qrPayment: 'QR 계좌이체',
    tablePrefix: '테이블',
    takeawayOption: '포장 (Takeaway)',
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
    stockLeftPrefix: '残り ',
    stockLeftSuffix: '点',
    qtyShort: '数量',
    unitPriceLabel: '単価',
    notePrefix: 'メモ',
    cashPayment: '現金払い (Cash)',
    qrPayment: 'QR銀行振込',
    tablePrefix: 'テーブル',
    takeawayOption: 'お持ち帰り',
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
    stockLeftPrefix: '仅剩 ',
    stockLeftSuffix: ' 份',
    qtyShort: '数量',
    unitPriceLabel: '单价',
    notePrefix: '备注',
    cashPayment: '现金支付 (Cash)',
    qrPayment: 'QR 扫码转账',
    tablePrefix: '桌号',
    takeawayOption: '打包带走',
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
    stockLeftPrefix: 'Quedan ',
    stockLeftSuffix: '',
    qtyShort: 'CANT',
    unitPriceLabel: 'Precio unitario',
    notePrefix: 'Nota',
    cashPayment: 'Efectivo (Cash)',
    qrPayment: 'Transferencia QR',
    tablePrefix: 'Mesa',
    takeawayOption: 'Para llevar',
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
    stockLeftPrefix: 'Ultimi ',
    stockLeftSuffix: '',
    qtyShort: 'QTÀ',
    unitPriceLabel: 'Prezzo unitario',
    notePrefix: 'Nota',
    cashPayment: 'Contanti (Cash)',
    qrPayment: 'Bonifico QR',
    tablePrefix: 'Tavolo',
    takeawayOption: 'Da asporto',
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
    stockLeftPrefix: 'Осталось ',
    stockLeftSuffix: ' шт.',
    qtyShort: 'КОЛ',
    unitPriceLabel: 'Цена за шт.',
    notePrefix: 'Прим.',
    cashPayment: 'Наличные (Cash)',
    qrPayment: 'Оплата по QR',
    tablePrefix: 'Стол',
    takeawayOption: 'С собой',
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
