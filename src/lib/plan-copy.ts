import {
  type AppLocale,
  DEFAULT_APP_LOCALE,
  bilingualText,
  normalizeAppLocale,
} from '@/lib/app-i18n';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import type { PlanTier } from '@/types/qlaok';

export interface PlanCopy {
  tier: PlanTier;
  name: string;
  badge?: string;
  badgeText?: string;
  features: string[];
}

/**
 * Returns localized presentation copy (name, badge, features) for a subscription plan tier
 * in Vietnamese ('vi') or English ('en') without mutating `PLAN_CONFIGS` business limits,
 * pricing, or feature flags.
 */
export function getPlanCopy(
  plan: PlanTier,
  locale: AppLocale | string | null | undefined = DEFAULT_APP_LOCALE
): PlanCopy {
  const resolvedLocale = normalizeAppLocale(locale, DEFAULT_APP_LOCALE);
  const tx = (viText: string, enText: string) =>
    bilingualText(resolvedLocale, viText, enText);

  if (plan === 'premium') {
    const badge = tx('Đầy đủ tính năng', 'Full features');
    return {
      tier: 'premium',
      name: tx('Chuyên nghiệp', 'Premium'),
      badge,
      badgeText: badge,
      features: [
        tx(
          'Không giới hạn số lượng món / dịch vụ',
          'Unlimited menu items & services'
        ),
        tx(
          'Tự động dịch 8 ngôn ngữ (Việt, Anh, Hàn, Nhật, Trung, TBN, Ý, Nga)',
          '8-language auto-translation (VI, EN, KO, JA, ZH, ES, IT, RU)'
        ),
        tx(
          'Quét ảnh thực đơn giấy tạo menu trong 10 giây',
          'Scan paper menu photos into digital items in 10s'
        ),
        tx(
          'Thống kê ngôn ngữ khách & Top món bán chạy',
          'Guest language & best-seller analytics'
        ),
        tx(
          'Ưu tiên hiển thị trên trang Khám Phá',
          'Priority placement on the Explore directory'
        ),
      ],
    };
  }

  if (plan === 'basic') {
    const badge = tx('Phổ biến cho quán nhỏ', 'Popular for small shops');
    return {
      tier: 'basic',
      name: tx('Cơ bản', 'Basic'),
      badge,
      badgeText: badge,
      features: [
        tx('Tối đa 25 món / dịch vụ / sản phẩm', 'Up to 25 items / services'),
        tx(
          'Tự động dịch 3 ngôn ngữ (VD: Việt, Anh, Hàn)',
          '3-language auto-translation (e.g. VI, EN, KO)'
        ),
        tx(
          'Thẻ "Đưa Nhân Viên Xem" hỗ trợ khách quốc tế',
          '"Show to Staff" card for international guests'
        ),
        tx(
          'Tùy chỉnh màu thương hiệu & mật khẩu Wi-Fi',
          'Custom brand colors & Wi-Fi sharing'
        ),
      ],
    };
  }

  // Fallback / 'free' tier
  const fallbackCfg = PLAN_CONFIGS[plan] ?? PLAN_CONFIGS.free;
  return {
    tier: fallbackCfg.tier,
    name: tx('Miễn phí', 'Free'),
    badge: undefined,
    badgeText: undefined,
    features: [
      tx('Tối đa 5 món / dịch vụ / sản phẩm', 'Up to 5 items / services'),
      tx('Hỗ trợ 1 ngôn ngữ (Tiếng Việt)', '1 language (Vietnamese)'),
      tx('Bộ 2 mã QR (QR Cửa & QR Bàn)', '2 QR codes (Door QR & Table QR)'),
      tx(
        'Bật/tắt Còn món hoặc Tạm hết tức thì',
        'Instant in-stock / sold-out toggle'
      ),
    ],
  };
}
