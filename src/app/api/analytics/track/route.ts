import { NextResponse } from 'next/server';
import {
  dbGetShopAnalyticsSummary,
  dbRecordAnalyticsEvent,
} from '@/lib/db';
import { AnalyticsEventType, SupportedLocale } from '@/types/qlaok';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = searchParams.get('shopId') || undefined;
  const summary = await dbGetShopAnalyticsSummary(shopId);
  return NextResponse.json(summary);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      shop_id,
      event_type,
      item_id = null,
      visitor_lang = 'vi',
    } = body as {
      shop_id: string;
      event_type: AnalyticsEventType;
      item_id?: string | null;
      visitor_lang?: SupportedLocale;
    };

    if (!shop_id || !event_type) {
      return NextResponse.json(
        { error: 'Missing shop_id or event_type' },
        { status: 400 }
      );
    }

    const userAgent = req.headers.get('user-agent') || 'unknown';
    const event = await dbRecordAnalyticsEvent({
      shop_id,
      event_type,
      item_id,
      visitor_lang,
      user_agent: userAgent,
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error('Analytics track error:', error);
    return NextResponse.json(
      { error: 'Failed to record analytics event' },
      { status: 500 }
    );
  }
}

