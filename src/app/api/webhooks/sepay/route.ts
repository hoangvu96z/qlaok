import { NextResponse } from 'next/server';
import {
  dbGetRedactedShopSePayConfig,
  handleSePayShopWebhookHttpRequest,
} from '@/lib/sepay-reconciliation';
import { requireShopOwnerOrAdmin } from '@/lib/server-auth';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    const shopId = (
      url.searchParams.get('shopId') ||
      url.searchParams.get('shop_id') ||
      ''
    ).trim();
    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;

    const sepayConfig = await dbGetRedactedShopSePayConfig(shopId, {
      baseOrigin: url.origin,
    });
    return NextResponse.json({ sepayConfig });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể tải cấu hình SePay của cửa hàng.';
    const status = message.startsWith('SHOP_NOT_FOUND') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  return handleSePayShopWebhookHttpRequest(req);
}
