import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import { isValidOpeningHoursTime } from '@/lib/i18n-helper';
import type { OpeningHours, Shop } from '@/types/qlaok';

export type ShopSetupChecklistStepId =
  | 'store_info'
  | 'opening_hours'
  | 'payment_qr'
  | 'catalog_menu'
  | 'tables_qr'
  | 'store_published';

export interface ShopSetupChecklistStep {
  id: ShopSetupChecklistStepId;
  completed: boolean;
  href: string;
  titleVi: string;
  titleEn: string;
  descVi: string;
  descEn: string;
  ctaVi: string;
  ctaEn: string;
}

export interface ShopSetupChecklistSummary {
  steps: ShopSetupChecklistStep[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  isAllCompleted: boolean;
}

const PLACEHOLDER_WIFI_SSIDS = new Set([
  'free_wifi',
  'quancafe_free5g',
  'phohoian_free5g',
  'hoian_spa_vip',
  'hoiangift_free',
]);

const PLACEHOLDER_PHONES = new Set(['0905111222', '0905333444', '0905666777']);

export function normalizeShopSlugInput(
  raw: string | null | undefined
): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function requiresSlugChangeConfirmation(
  currentSlug: string | null | undefined,
  nextSlug: string | null | undefined
): {
  required: boolean;
  currentNormalized: string;
  nextNormalized: string;
} {
  const currentNormalized = normalizeShopSlugInput(currentSlug);
  const nextNormalized = normalizeShopSlugInput(nextSlug);
  const required =
    Boolean(currentNormalized) &&
    Boolean(nextNormalized) &&
    currentNormalized !== nextNormalized;

  return {
    required,
    currentNormalized,
    nextNormalized,
  };
}

export function hasConfiguredStoreInfo(
  shop:
    | Pick<
        Shop,
        'name' | 'address' | 'city' | 'phone_contact' | 'zalo_phone' | 'wifi_info'
      >
    | null
    | undefined
): boolean {
  if (!shop) return false;
  const name = (shop.name ?? '').trim();
  const address = (shop.address ?? '').trim();
  const city = (shop.city ?? '').trim();
  const phone = (shop.phone_contact || shop.zalo_phone || '').trim();
  const ssid = (shop.wifi_info?.ssid ?? '').trim();

  if (!name || !address || !phone || !ssid) {
    return false;
  }
  if (city && address.toLowerCase() === city.toLowerCase()) {
    return false;
  }
  if (PLACEHOLDER_PHONES.has(phone)) {
    return false;
  }
  if (PLACEHOLDER_WIFI_SSIDS.has(ssid.toLowerCase())) {
    return false;
  }
  return true;
}

export function hasConfirmedOpeningHours(
  shop: Pick<Shop, 'opening_hours_confirmed'> | null | undefined
): boolean {
  return Boolean(shop && shop.opening_hours_confirmed === true);
}

export interface OpeningHoursSettingsState {
  openingHours: OpeningHours | null;
  openingHoursConfirmed: boolean;
}

export const OPENING_HOURS_DAY_KEYS: ReadonlyArray<keyof OpeningHours> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
];

const OPENING_HOURS_DAY_KEY_SET = new Set<string>(OPENING_HOURS_DAY_KEYS);
const OPENING_HOURS_SCHEDULE_KEY_SET = new Set<string>([
  'open',
  'close',
  'closed',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type ValidateOpeningHoursResult =
  | {
      valid: true;
      openingHours: OpeningHours | null;
    }
  | {
      valid: false;
      code: 'INVALID_OPENING_HOURS';
      error: string;
    };

export function validateOpeningHoursInput(
  raw: unknown
): ValidateOpeningHoursResult {
  if (raw === null) {
    return { valid: true, openingHours: null };
  }

  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      code: 'INVALID_OPENING_HOURS',
      error:
        'INVALID_OPENING_HOURS: Cấu hình giờ mở cửa (opening_hours) phải là object lịch tuần hoặc null.',
    };
  }

  const normalized: Partial<OpeningHours> = {};

  for (const dayKey of Object.keys(raw)) {
    if (!OPENING_HOURS_DAY_KEY_SET.has(dayKey)) {
      return {
        valid: false,
        code: 'INVALID_OPENING_HOURS',
        error: `INVALID_OPENING_HOURS: Khóa ngày "${dayKey}" không hợp lệ (chỉ chấp nhận mon, tue, wed, thu, fri, sat, sun).`,
      };
    }

    const daySchedule = raw[dayKey];
    if (!isPlainRecord(daySchedule)) {
      return {
        valid: false,
        code: 'INVALID_OPENING_HOURS',
        error: `INVALID_OPENING_HOURS: Lịch ngày "${dayKey}" phải là object gồm open, close (HH:mm) và closed (boolean).`,
      };
    }

    for (const fieldKey of Object.keys(daySchedule)) {
      if (!OPENING_HOURS_SCHEDULE_KEY_SET.has(fieldKey)) {
        return {
          valid: false,
          code: 'INVALID_OPENING_HOURS',
          error: `INVALID_OPENING_HOURS: Trường "${fieldKey}" trong lịch ngày "${dayKey}" không hợp lệ.`,
        };
      }
    }

    const { open, close, closed } = daySchedule;
    if (typeof closed !== 'boolean') {
      return {
        valid: false,
        code: 'INVALID_OPENING_HOURS',
        error: `INVALID_OPENING_HOURS: Trạng thái nghỉ (closed) của ngày "${dayKey}" phải là kiểu boolean.`,
      };
    }

    let normalizedOpen: string;
    let normalizedClose: string;
    if (closed) {
      normalizedOpen = isValidOpeningHoursTime(open) ? open : '';
      normalizedClose = isValidOpeningHoursTime(close) ? close : '';
    } else if (
      isValidOpeningHoursTime(open) &&
      isValidOpeningHoursTime(close)
    ) {
      normalizedOpen = open;
      normalizedClose = close;
    } else {
      return {
        valid: false,
        code: 'INVALID_OPENING_HOURS',
        error: `INVALID_OPENING_HOURS: Giờ mở/đóng cửa của ngày "${dayKey}" phải đúng định dạng HH:mm (00:00–23:59).`,
      };
    }

    normalized[dayKey as keyof OpeningHours] = {
      open: normalizedOpen,
      close: normalizedClose,
      closed,
    };
  }

  return {
    valid: true,
    openingHours: normalized as OpeningHours,
  };
}

export function createInitialOpeningHoursSettingsState(
  shop:
    | Pick<Shop, 'opening_hours' | 'opening_hours_confirmed'>
    | null
    | undefined
): OpeningHoursSettingsState {
  return {
    openingHours: shop?.opening_hours ?? null,
    openingHoursConfirmed: hasConfirmedOpeningHours(shop),
  };
}

export function applyOpeningHoursScheduleChange(
  _state: OpeningHoursSettingsState,
  nextOpeningHours: OpeningHours
): {
  openingHours: OpeningHours;
  openingHoursConfirmed: boolean;
} {
  return {
    openingHours: nextOpeningHours,
    openingHoursConfirmed: false,
  };
}

export function applyOpeningHoursConfirmationToggle(
  state: OpeningHoursSettingsState,
  confirmed: boolean
): OpeningHoursSettingsState {
  return {
    openingHours: state.openingHours,
    openingHoursConfirmed: Boolean(confirmed),
  };
}

export function buildOpeningHoursSettingsPatch(state: {
  openingHours: OpeningHours;
  openingHoursConfirmed: boolean;
}): {
  opening_hours: OpeningHours;
  opening_hours_confirmed: boolean;
} {
  return {
    opening_hours: state.openingHours,
    opening_hours_confirmed: Boolean(state.openingHoursConfirmed),
  };
}

export function evaluateShopSetupChecklist(input: {
  shop: Shop | null | undefined;
  totalCatalogItems?: number | null;
  availableCatalogItems?: number | null;
  activeTablesCount?: number | null;
}): ShopSetupChecklistSummary {
  const shop = input.shop;
  const availableItems = Math.max(
    0,
    Number(input.availableCatalogItems ?? input.totalCatalogItems ?? 0)
  );
  const activeTables = Math.max(0, Number(input.activeTablesCount ?? 0));

  const storeInfoReady = hasConfiguredStoreInfo(shop);
  const openingHoursReady = hasConfirmedOpeningHours(shop);
  const paymentQrReady = shop
    ? Boolean(getShopPaymentQrInfo(shop).isConfigured)
    : false;
  const catalogMenuReady = availableItems > 0;
  const tablesQrReady = activeTables > 0;
  const storePublishedReady = Boolean(shop && shop.is_published !== false);

  const steps: ShopSetupChecklistStep[] = [
    {
      id: 'store_info',
      completed: storeInfoReady,
      href: '/dashboard/settings',
      titleVi: 'Thông tin quán, SĐT & Wi-Fi',
      titleEn: 'Store address, phone & Wi-Fi',
      descVi:
        'Điền địa chỉ cụ thể, số điện thoại liên hệ và mật khẩu Wi-Fi thật của quán.',
      descEn:
        'Set your exact street address, contact phone, and guest Wi-Fi credentials.',
      ctaVi: 'Cài đặt quán',
      ctaEn: 'Store settings',
    },
    {
      id: 'opening_hours',
      completed: openingHoursReady,
      href: '/dashboard/settings#opening-hours-settings',
      titleVi: 'Giờ mở cửa hàng tuần',
      titleEn: 'Weekly opening hours',
      descVi:
        'Kiểm tra khung giờ mở/đóng cửa từng ngày và tích xác nhận giờ mở cửa chính xác.',
      descEn:
        'Review daily opening and closing hours and confirm that the schedule is accurate.',
      ctaVi: 'Cài giờ mở cửa',
      ctaEn: 'Set opening hours',
    },
    {
      id: 'payment_qr',
      completed: paymentQrReady,
      href: '/dashboard/settings#payment-qr-settings',
      titleVi: 'Tài khoản ngân hàng & VietQR',
      titleEn: 'Bank account & Payment QR',
      descVi:
        'Kết nối STK ngân hàng nhận tiền hoặc tải ảnh QR để khách quét thanh toán.',
      descEn:
        'Configure your receiving bank account for VietQR or upload a custom QR image.',
      ctaVi: 'Cài QR thu tiền',
      ctaEn: 'Configure QR',
    },
    {
      id: 'catalog_menu',
      completed: catalogMenuReady,
      href: '/dashboard/catalog',
      titleVi: 'Thực đơn món & giá bán',
      titleEn: 'Menu items & pricing',
      descVi:
        'Đảm bảo thực đơn có ít nhất 1 món đang mở bán (hoặc quét ảnh menu bằng AI).',
      descEn:
        'Ensure your catalog has at least 1 active item (or scan a paper menu with AI).',
      ctaVi: 'Quản lý thực đơn',
      ctaEn: 'Manage menu',
    },
    {
      id: 'tables_qr',
      completed: tablesQrReady,
      href: '/dashboard/qr-studio',
      titleVi: 'Danh sách bàn & in mã QR',
      titleEn: 'Managed tables & Table QR',
      descVi:
        'Tạo bàn phục vụ có chữ ký bảo mật và tải bản in QR đặt tại từng bàn.',
      descEn:
        'Create managed tables with signed QR links and print table standees.',
      ctaVi: 'Tạo bàn & QR',
      ctaEn: 'Tables & QR',
    },
    {
      id: 'store_published',
      completed: storePublishedReady,
      href: '/dashboard/settings',
      titleVi: 'Công khai cửa hàng đón khách',
      titleEn: 'Publish store for guests',
      descVi:
        'Bật trạng thái "Đang công khai" trên thanh đầu trang khi menu và QR đã sẵn sàng.',
      descEn:
        'Switch your store from Draft to Live in the top bar once your menu and QR are ready.',
      ctaVi: 'Kiểm tra trạng thái',
      ctaEn: 'Check status',
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return {
    steps,
    completedCount,
    totalCount,
    progressPercent,
    isAllCompleted: completedCount === totalCount,
  };
}
