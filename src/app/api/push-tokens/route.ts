import { NextResponse } from 'next/server';
import {
  requireAuthenticatedUser,
  requireShopPermission,
} from '@/lib/server-auth';
import {
  dbDeleteMobilePushTokens,
  dbUpsertMobilePushToken,
  isValidExpoPushToken,
} from '@/lib/push-notifications';

function extractPushErrorCode(message: string): string | undefined {
  const match = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(message.trim());
  return match ? match[1] : undefined;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      shop_id?: string;
      shopId?: string;
      expo_push_token?: string;
      expoPushToken?: string;
      token?: string;
      locale?: string;
      platform?: string;
      device_name?: string;
      deviceName?: string;
    };

    const shopId = (body.shop_id || body.shopId || '').trim();
    const expoPushToken = (
      body.expo_push_token ||
      body.expoPushToken ||
      body.token ||
      ''
    ).trim();

    if (!shopId) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shop_id).', code: 'MISSING_SHOP_ID' },
        { status: 400 }
      );
    }

    if (!isValidExpoPushToken(expoPushToken)) {
      return NextResponse.json(
        {
          error: 'Định dạng Expo push token không hợp lệ.',
          code: 'INVALID_EXPO_PUSH_TOKEN',
        },
        { status: 400 }
      );
    }

    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) return auth.errorResponse;

    const record = await dbUpsertMobilePushToken({
      user_id: auth.user.sub,
      shop_id: shopId,
      expo_push_token: expoPushToken,
      locale: body.locale,
      platform: body.platform,
      device_name: body.device_name ?? body.deviceName ?? null,
    });

    return NextResponse.json({
      success: true,
      registration: {
        id: record.id,
        shop_id: record.shop_id,
        user_id: record.user_id,
        locale: record.locale,
        platform: record.platform,
        is_active: record.is_active,
        updated_at: record.updated_at,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể đăng ký nhận thông báo đơn hàng.';
    const code = extractPushErrorCode(message);
    const status = code?.startsWith('DB_') ? 503 : 400;
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as {
      shop_id?: string;
      shopId?: string;
      expo_push_token?: string;
      expoPushToken?: string;
      token?: string;
    };

    const shopId = (
      body.shop_id ||
      body.shopId ||
      searchParams.get('shopId') ||
      searchParams.get('shop_id') ||
      ''
    ).trim();

    const expoPushToken = (
      body.expo_push_token ||
      body.expoPushToken ||
      body.token ||
      searchParams.get('token') ||
      searchParams.get('expo_push_token') ||
      ''
    ).trim();

    if (expoPushToken && !isValidExpoPushToken(expoPushToken)) {
      return NextResponse.json(
        {
          error: 'Định dạng Expo push token không hợp lệ.',
          code: 'INVALID_EXPO_PUSH_TOKEN',
        },
        { status: 400 }
      );
    }

    const deletedCount = await dbDeleteMobilePushTokens({
      user_id: auth.user.sub,
      shop_id: shopId || null,
      expo_push_token: expoPushToken || null,
    });

    return NextResponse.json({
      success: true,
      deletedCount,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể hủy đăng ký nhận thông báo.';
    const code = extractPushErrorCode(message);
    const status = code?.startsWith('DB_') ? 503 : 400;
    return NextResponse.json(
      { error: message, ...(code ? { code } : {}) },
      { status }
    );
  }
}
