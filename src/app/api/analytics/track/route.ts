import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  dbGetShopAnalyticsSummary,
  dbRecordAnalyticsEvent,
} from '@/lib/db';
import type { AnalyticsEventType, SupportedLocale } from '@/types/qlaok';
import { ALL_LOCALES } from '@/lib/i18n-helper';
import { requireShopPermission } from '@/lib/server-auth';

const ANALYTICS_RATE_WINDOW_MS = 60_000;
const ANALYTICS_RATE_MAX = 120;
const ANALYTICS_RATE_MAX_BUCKETS = 5000;
const ANALYTICS_EVENT_TYPES = new Set<AnalyticsEventType>([
  'scan_door',
  'scan_table',
  'item_view',
  'show_to_staff',
  'wifi_copy',
]);
const ANALYTICS_LOCALES = new Set<SupportedLocale>(ALL_LOCALES);
const analyticsRateBuckets = new Map<string, number[]>();

function getSafeAnalyticsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'INTERNAL_ERROR';
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(code)
    ? code
    : 'INTERNAL_ERROR';
}

function consumeAnalyticsRateLimit(req: Request, shopId: string): number | null {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = req.headers.get('x-real-ip')?.trim() || forwardedFor || 'unknown';
  const bucketKey = crypto
    .createHash('sha256')
    .update(`${shopId}:${address}`)
    .digest('hex');
  const now = Date.now();
  const current = (analyticsRateBuckets.get(bucketKey) || []).filter(
    (timestamp) => now - timestamp < ANALYTICS_RATE_WINDOW_MS
  );
  if (current.length >= ANALYTICS_RATE_MAX) {
    analyticsRateBuckets.set(bucketKey, current);
    return Math.max(1, Math.ceil((current[0] + ANALYTICS_RATE_WINDOW_MS - now) / 1000));
  }
  if (!analyticsRateBuckets.has(bucketKey) && analyticsRateBuckets.size >= ANALYTICS_RATE_MAX_BUCKETS) {
    const oldestKey = analyticsRateBuckets.keys().next().value;
    if (oldestKey) analyticsRateBuckets.delete(oldestKey);
  }
  current.push(now);
  analyticsRateBuckets.set(bucketKey, current);
  return null;
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
  const summary = await dbGetShopAnalyticsSummary(shopId);
  return NextResponse.json(summary);
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

    const retryAfterSeconds = consumeAnalyticsRateLimit(req, shop_id);
    if (retryAfterSeconds !== null) {
      return NextResponse.json(
        { error: 'Analytics rate limit exceeded', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const userAgent = req.headers.get('user-agent') || 'unknown';
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
