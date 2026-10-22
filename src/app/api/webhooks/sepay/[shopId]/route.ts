import { NextResponse } from 'next/server';
import {
  dbGetRedactedShopSePayConfig,
  handleSePayShopWebhookHttpRequest,
} from '@/lib/sepay-reconciliation';
import { requireShopOwnerOrAdmin } from '@/lib/server-auth';

interface RouteContext {
  params: Promise<{ shopId: string }>;
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const resolvedParams = await Promise.resolve(context.params);
    const shopId = (resolvedParams?.shopId || '').trim();
    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;

    const url = new URL(req.url, 'http://localhost:3000');
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

export async function POST(req: Request, context: RouteContext) {
  const resolvedParams = await Promise.resolve(context.params);
  const shopId = (resolvedParams?.shopId || '').trim();
  return handleSePayShopWebhookHttpRequest(req, shopId);
}
