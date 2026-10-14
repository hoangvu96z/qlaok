import { PlanTier, SupportedLocale } from '@/types/qlaok';

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
    maxLangs: 5,
    allowAiOcr: true,
    allowCustomTheme: true,
    badgeText: 'Đầy đủ tính năng AI',
    features: [
      'Không giới hạn số lượng món / dịch vụ / sản phẩm',
      'Đủ 5 ngôn ngữ tự động bằng AI (Việt, Anh, Hàn, Nhật, Trung)',
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
