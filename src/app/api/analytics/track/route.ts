import { NextResponse } from 'next/server';
import {
  dbGetShopAnalyticsSummary,
  dbRecordAnalyticsEvent,
} from '@/lib/db';
import type { AnalyticsEventType, SupportedLocale } from '@/types/qlaok';
import { ALL_LOCALES } from '@/lib/i18n-helper';
import { requireShopPermission } from '@/lib/server-auth';
import { createAnalyticsRateLimiter } from '@/lib/analytics-rate-limit';

export const runtime = 'nodejs';

const ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>([
  'scan_door',
  'scan_table',
  'item_view',
  'show_to_staff',
  'wifi_copy',
]);
const ANALYTICS_LOCALES = new Set<SupportedLocale>(ALL_LOCALES);
const consumeAnalyticsRateLimit = createAnalyticsRateLimiter();

function getSafeAnalyticsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'INTERNAL_ERROR';
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)
    ? code
    : 'INTERNAL_ERROR';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = (searchParams.get('shopId') || '').trim();
  if (!shopId) {
    return NextResponse.json(
      { error: 'Thiếu mã cửa hàng (shopId).', code: 'SHOP_ID_REQUIRED' },
      { status: 400 }
    );
  }
  const auth = await requireShopPermission(req, shopId, 'reports.view');
  if (auth.errorResponse) return auth.errorResponse;
  try {
    const summary = await dbGetShopAnalyticsSummary(shopId);
    return NextResponse.json(summary);
  } catch (error) {
    const code = getSafeAnalyticsErrorCode(error);
    console.error('analytics.summary_failed', { code });
    return NextResponse.json(
      { error: 'Failed to load analytics summary', code },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      shop_id: rawShopId,
      event_type: rawEventType,
      item_id = null,
      visitor_lang = 'vi',
    } = body as {
      shop_id?: unknown;
      event_type?: unknown;
      item_id?: string | null;
      visitor_lang?: SupportedLocale;
    };

    const shop_id = typeof rawShopId === 'string' ? rawShopId.trim() : '';
    const event_type = rawEventType as AnalyticsEventType;
    const itemId = typeof item_id === 'string' ? item_id.trim() : null;
    const visitorLang = ANALYTICS_LOCALES.has(visitor_lang) ? visitor_lang : null;

    if (!shop_id || !ANALYTICS_EVENT_TYPES.has(event_type) || !visitorLang) {
      return NextResponse.json(
        { error: 'Invalid shop_id, event_type, or visitor_lang' },
        { status: 400 }
      );
    }

    if (event_type === 'item_view' && !itemId) {
      return NextResponse.json(
        { error: 'item_view requires item_id', code: 'ITEM_ID_REQUIRED' },
        { status: 400 }
      );
    }

    const retryAfterSeconds = consumeAnalyticsRateLimit(req);
    if (retryAfterSeconds !== null) {
      return NextResponse.json(
        { error: 'Analytics rate limit exceeded', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const userAgent = (req.headers.get('user-agent') || 'unknown').slice(0, 512);
    const event = await dbRecordAnalyticsEvent({
      shop_id,
      event_type,
      item_id: event_type === 'item_view' ? itemId : null,
      visitor_lang: visitorLang,
      user_agent: userAgent,
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'SHOP_NOT_TRACKABLE') {
      return NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.', code: 'SHOP_NOT_FOUND' },
        { status: 404 }
      );
    }
    if (message === 'ITEM_NOT_IN_SHOP') {
      return NextResponse.json(
        { error: 'Món không tồn tại trong cửa hàng này.', code: 'ITEM_NOT_IN_SHOP' },
        { status: 400 }
      );
    }
    console.error('analytics.track_failed', {
      code: getSafeAnalyticsErrorCode(error),
    });
    return NextResponse.json(
      { error: 'Failed to record analytics event' },
      { status: 500 }
    );
  }
}
