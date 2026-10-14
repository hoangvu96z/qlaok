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
};

export const ALL_LOCALES: SupportedLocale[] = ['vi', 'en', 'ko', 'ja', 'zh'];

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
  const openMins = (openH || 8) * 60 + (openM || 0);
  const closeMins = (closeH || 22) * 60 + (closeM || 0);

  const isOpen = currentMins >= openMins && currentMins <= closeMins;
  return { isOpen, todaySchedule: schedule };
}

export const UI_LABELS: Record<
  SupportedLocale,
  {
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
    showToStaffHeader: string;
    showToStaffSub: string;
    totalEstimated: string;
    sendZaloOrder: string;
    clearSelection: string;
    backToStore: string;
  }
> = {
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
    addToOrder: 'Thêm vào danh sách chọn',
    customNotePlaceholder: 'Ghi chú thêm (VD: không cay, dị ứng...)',
    quickTagsTitle: 'Ghi chú nhanh',
    bottomCtaFnb: 'Gọi món / Đưa nhân viên xem',
    bottomCtaService: 'Chọn dịch vụ & Đưa lễ tân xem',
    bottomCtaRetail: 'Xem giỏ hàng & Hỏi nhân viên',
    showToStaffHeader: 'ĐƯA MÀN HÌNH NÀY CHO NHÂN VIÊN',
    showToStaffSub: 'Nhân viên quán sẽ đọc danh sách Tiếng Việt bên dưới để phục vụ bạn',
    totalEstimated: 'Tổng cộng tạm tính',
    sendZaloOrder: 'Gửi đơn qua Zalo quán',
    clearSelection: 'Xóa danh sách chọn',
    backToStore: 'Thông tin quán',
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
    addToOrder: 'Add to Selection',
    customNotePlaceholder: 'Special requests (e.g. no peanuts, allergies...)',
    quickTagsTitle: 'Quick Notes',
    bottomCtaFnb: 'Order / Show to Staff',
    bottomCtaService: 'Select Services & Show Reception',
    bottomCtaRetail: 'View Cart & Ask Staff',
    showToStaffHeader: 'PLEASE SHOW THIS SCREEN TO STAFF',
    showToStaffSub: 'Our staff will read your order in Vietnamese below',
    totalEstimated: 'Estimated Total',
    sendZaloOrder: 'Send via Zalo',
    clearSelection: 'Clear All',
    backToStore: 'Store Info',
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
    addToOrder: '선택 목록에 추가',
    customNotePlaceholder: '추가 요청사항 (예: 고수 빼주세요...)',
    quickTagsTitle: '빠른 요청 태그',
    bottomCtaFnb: '주문하기 / 직원에게 보여주기',
    bottomCtaService: '서비스 선택 & 카운터에 보여주기',
    bottomCtaRetail: '장바구니 보기 & 직원 문의',
    showToStaffHeader: '이 화면을 직원에게 보여주세요',
    showToStaffSub: '직원이 아래 베트남어 주문서를 확인하고 도와드립니다',
    totalEstimated: '예상 합계 금액',
    sendZaloOrder: 'Zalo로 주문 전송',
    clearSelection: '목록 비우기',
    backToStore: '매장 정보',
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
    addToOrder: '選択リストに追加',
    customNotePlaceholder: 'ご要望（例：パクチー抜きなど）',
    quickTagsTitle: 'クイックメモ',
    bottomCtaFnb: '注文 / スタッフに見せる',
    bottomCtaService: 'メニューを選んで受付に見せる',
    bottomCtaRetail: 'カートを見る・スタッフに聞く',
    showToStaffHeader: 'この画面をスタッフにお見せください',
    showToStaffSub: 'スタッフが下のベトナム語リストを確認して対応いたします',
    totalEstimated: '合計目安',
    sendZaloOrder: 'Zaloで送信',
    clearSelection: 'クリア',
    backToStore: '店舗情報',
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
    addToOrder: '加入已选清单',
    customNotePlaceholder: '备注需求（如：不要香菜、过敏等）',
    quickTagsTitle: '快捷备注',
    bottomCtaFnb: '点餐 / 出示给店员看',
    bottomCtaService: '选择服务 & 出示给前台',
    bottomCtaRetail: '查看购物袋 & 咨询店员',
    showToStaffHeader: '请将此屏幕出示给店员',
    showToStaffSub: '店员将阅读下方的越南语清单为您服务',
    totalEstimated: '预计总计',
    sendZaloOrder: '通过 Zalo 发送',
    clearSelection: '清空清单',
    backToStore: '门店主页',
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
      },
    },
  ],
};
