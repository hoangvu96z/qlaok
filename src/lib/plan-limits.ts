import type { PlanTier, SupportedLocale } from '@/types/qlaok';

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
  maxItems: number;
  maxLangs: number;
  allowAiOcr: boolean;
  allowCustomTheme: boolean;
  badgeText?: string;
  features: string[];
}

export const PLAN_CONFIGS: Record<PlanTier, PlanConfig> = {
  free: {
    tier: 'free',
    name: 'Gói Miễn Phí (Free)',
    priceMonthly: 0,
    maxItems: 5,
    maxLangs: 1,
    allowAiOcr: false,
    allowCustomTheme: false,
    features: [
      'Tối đa 5 món ăn / dịch vụ / sản phẩm',
      'Hỗ trợ 1 ngôn ngữ (Tiếng Việt)',
      '2 Mã QR (QR Cửa & QR Bàn)',
      'Nút gạt Còn hàng / Tạm hết thời gian thực',
    ],
  },
  basic: {
    tier: 'basic',
    name: 'Gói Cơ Bản (Basic)',
    priceMonthly: 39000,
    maxItems: 25,
    maxLangs: 3,
    allowAiOcr: false,
    allowCustomTheme: true,
    badgeText: 'Phổ biến cho quán nhỏ',
    features: [
      'Tối đa 25 món ăn / dịch vụ / sản phẩm',
      'Tự động dịch AI 3 ngôn ngữ (VD: Việt, Anh, Hàn)',
      'Thẻ "Đưa Nhân Viên Xem" chống bất đồng ngôn ngữ',
      'Tùy chỉnh màu sắc thương hiệu & mật khẩu Wi-Fi',
    ],
  },
  premium: {
    tier: 'premium',
    name: 'Gói Chuyên Nghiệp (Premium)',
    priceMonthly: 69000,
    maxItems: 999999,
    maxLangs: 8,
    allowAiOcr: true,
    allowCustomTheme: true,
    badgeText: 'Đầy đủ tính năng AI',
    features: [
      'Không giới hạn số lượng món / dịch vụ / sản phẩm',
      'Đủ 8 ngôn ngữ tự động bằng AI (Việt, Anh, Hàn, Nhật, Trung, TBN, Ý, Nga)',
      'Mở khóa AI Vision OCR: Chụp ảnh menu giấy tạo menu trong 10s',
      'Thống kê chuyên sâu ngôn ngữ khách & Top món bán chạy',
      'Ưu tiên hiển thị trên Cổng Khám Phá (Directory)',
    ],
  },
};

export function canAddMoreItems(plan: PlanTier, currentItemCount: number): {
  allowed: boolean;
  limit: number;
  reason?: string;
} {
  const cfg = PLAN_CONFIGS[plan];
  if (currentItemCount >= cfg.maxItems) {
    return {
      allowed: false,
      limit: cfg.maxItems,
      reason:
        plan === 'free'
          ? 'PLAN_LIMIT_REACHED: Gói Miễn Phí chỉ hỗ trợ tối đa 5 món/dịch vụ. Vui lòng nâng cấp gói.'
          : 'PLAN_LIMIT_REACHED: Gói Cơ Bản chỉ hỗ trợ tối đa 25 món/dịch vụ. Vui lòng nâng cấp lên gói Premium.',
    };
  }
  return { allowed: true, limit: cfg.maxItems };
}

export function getAllowedLocalesForPlan(
  plan: PlanTier,
  shopLocales: SupportedLocale[]
): SupportedLocale[] {
  const max = PLAN_CONFIGS[plan].maxLangs;
  const base = shopLocales.length > 0 ? shopLocales : (['vi'] as SupportedLocale[]);
  return base.slice(0, max);
}

// ---------------------------------------------------------------------------
// Plan limit / feature-lock error helpers (shared by API routes and UI)
// ---------------------------------------------------------------------------

export const PLAN_LIMIT_REACHED_CODE = 'PLAN_LIMIT_REACHED';
export const PLAN_FEATURE_LOCKED_CODE = 'PLAN_FEATURE_LOCKED';
export const BILLING_UPGRADE_HREF = '/dashboard/billing';

export type PlanErrorCode =
  | typeof PLAN_LIMIT_REACHED_CODE
  | typeof PLAN_FEATURE_LOCKED_CODE;

/** True when the plan includes the AI Vision OCR menu scanner. */
export function canUseAiOcr(plan?: PlanTier | null): boolean {
  if (!plan || !PLAN_CONFIGS[plan]) return false;
  return PLAN_CONFIGS[plan].allowAiOcr;
}

function extractErrorText(input: unknown): { text: string; code?: string } {
  if (!input) return { text: '' };
  if (typeof input === 'string') return { text: input };
  if (input instanceof Error) return { text: input.message };
  if (typeof input === 'object') {
    const obj = input as { error?: unknown; message?: unknown; code?: unknown };
    const text =
      typeof obj.error === 'string'
        ? obj.error
        : typeof obj.message === 'string'
          ? obj.message
          : '';
    return { text, code: typeof obj.code === 'string' ? obj.code : undefined };
  }
  return { text: '' };
}

/**
 * Detects a plan error code from an API error payload, Error, or string
 * (e.g. `"PLAN_LIMIT_REACHED: Gói Miễn Phí chỉ hỗ trợ tối đa 5 món..."`
 * or `{ error, code: 'PLAN_FEATURE_LOCKED' }`). Returns null otherwise.
 */
export function parsePlanErrorCode(input: unknown): PlanErrorCode | null {
  const { text, code } = extractErrorText(input);
  const haystack = `${code || ''} ${text}`;
  if (haystack.includes(PLAN_LIMIT_REACHED_CODE)) return PLAN_LIMIT_REACHED_CODE;
  if (haystack.includes(PLAN_FEATURE_LOCKED_CODE)) return PLAN_FEATURE_LOCKED_CODE;
  return null;
}

export function isPlanLimitError(input: unknown): boolean {
  return parsePlanErrorCode(input) !== null;
}

const PLAN_LIMIT_MESSAGES: Record<
  SupportedLocale,
  { limit: string; limitN: string; feature: string; cta: string }
> = {
  vi: {
    limit: 'Bạn đã đạt giới hạn số món của gói hiện tại. Nâng cấp gói để thêm món mới.',
    limitN: 'Gói hiện tại chỉ cho phép tối đa {n} món/dịch vụ. Nâng cấp gói để thêm món mới.',
    feature: 'Tính năng này chưa có trong gói hiện tại. Vui lòng nâng cấp gói để sử dụng.',
    cta: 'Xem gói nâng cấp',
  },
  en: {
    limit: 'You have reached the item limit of your current plan. Upgrade to add more items.',
    limitN: 'Your current plan allows up to {n} items. Upgrade to add more items.',
    feature: 'This feature is not included in your current plan. Please upgrade to use it.',
    cta: 'View upgrade plans',
  },
  ko: {
    limit: '현재 요금제의 항목 한도에 도달했습니다. 더 추가하려면 업그레이드하세요.',
    limitN: '현재 요금제는 최대 {n}개 항목만 허용합니다. 더 추가하려면 업그레이드하세요.',
    feature: '현재 요금제에는 이 기능이 포함되어 있지 않습니다. 업그레이드해 주세요.',
    cta: '요금제 보기',
  },
  ja: {
    limit: '現在のプランの品目上限に達しました。追加するにはアップグレードしてください。',
    limitN: '現在のプランでは最大{n}品目までです。追加するにはアップグレードしてください。',
    feature: 'この機能は現在のプランに含まれていません。アップグレードしてください。',
    cta: 'プランを見る',
  },
  zh: {
    limit: '您已达到当前套餐的项目上限。请升级以添加更多项目。',
    limitN: '当前套餐最多允许 {n} 个项目。请升级以添加更多项目。',
    feature: '当前套餐不包含此功能。请升级后使用。',
    cta: '查看升级套餐',
  },
  es: {
    limit: 'Has alcanzado el límite de artículos de tu plan actual. Mejora tu plan para añadir más.',
    limitN: 'Tu plan actual permite hasta {n} artículos. Mejora tu plan para añadir más.',
    feature: 'Esta función no está incluida en tu plan actual. Mejora tu plan para usarla.',
    cta: 'Ver planes',
  },
  it: {
    limit: 'Hai raggiunto il limite di articoli del piano attuale. Passa a un piano superiore per aggiungerne altri.',
    limitN: 'Il piano attuale consente al massimo {n} articoli. Passa a un piano superiore per aggiungerne altri.',
    feature: 'Questa funzione non è inclusa nel piano attuale. Passa a un piano superiore per usarla.',
    cta: 'Vedi i piani',
  },
  ru: {
    limit: 'Достигнут лимит позиций текущего тарифа. Повысьте тариф, чтобы добавить больше.',
    limitN: 'Текущий тариф позволяет не более {n} позиций. Повысьте тариф, чтобы добавить больше.',
    feature: 'Эта функция не входит в текущий тариф. Повысьте тариф, чтобы её использовать.',
    cta: 'Посмотреть тарифы',
  },
};

export interface FormattedPlanError {
  code: PlanErrorCode;
  message: string;
  ctaLabel: string;
  upgradeHref: string;
}

/**
 * Maps a PLAN_LIMIT_REACHED / PLAN_FEATURE_LOCKED error (string, Error or
 * API JSON payload) to a friendly localized message plus a billing link.
 * Returns null when the input is not a plan error, so callers can fall back
 * to their generic error display.
 */
export function formatPlanLimitError(
  input: unknown,
  locale: SupportedLocale = 'vi'
): FormattedPlanError | null {
  const code = parsePlanErrorCode(input);
  if (!code) return null;
  const copy = PLAN_LIMIT_MESSAGES[locale] || PLAN_LIMIT_MESSAGES.en;
  let message = copy.feature;
  if (code === PLAN_LIMIT_REACHED_CODE) {
    const { text } = extractErrorText(input);
    const limitMatch = text.match(/(?:tối đa|up to|max(?:imum)?)\s*(\d+)/i);
    const limitNum = limitMatch ? Number(limitMatch[1]) : NaN;
    message = Number.isFinite(limitNum)
      ? copy.limitN.replace('{n}', String(limitNum))
      : copy.limit;
  }
  return {
    code,
    message,
    ctaLabel: copy.cta,
    upgradeHref: BILLING_UPGRADE_HREF,
  };
}
