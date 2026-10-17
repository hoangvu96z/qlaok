import { NextResponse } from 'next/server';
import {
  dbCreateShop,
  dbGetAllShopsAndProfile,
  dbGetShopById,
  dbGetStorefrontBundle,
  dbUpdateShop,
} from '@/lib/db';
import {
  getRequestShopMembership,
  requireAuthenticatedUser,
  requireShopOwnerOrAdmin,
  requireShopPermission,
  verifyRequestUser,
} from '@/lib/server-auth';
import {
  dbDeleteShopMembership,
  dbGetShopMemberships,
  dbUpsertShopMembership,
  hasShopPermission,
} from '@/lib/shop-permissions';
import type { ShopPermission, ShopRole, ShopThemeConfig } from '@/types/qlaok';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const shopId = searchParams.get('shopId');
  const ownerId = searchParams.get('ownerId') || undefined;
  const memberFlag = searchParams.get('member');
  const action = searchParams.get('action');
  const sessionUser = await verifyRequestUser(req);

  if (action === 'memberships' && shopId) {
    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) return auth.errorResponse;

    if (hasShopPermission(auth.membership, 'members.manage')) {
      const memberships = await dbGetShopMemberships(shopId);
      return NextResponse.json({
        memberships,
        myMembership: auth.membership,
      });
    }
    return NextResponse.json({
      memberships: [auth.membership],
      myMembership: auth.membership,
    });
  }

  if (slug) {
    let allowUnpublished = sessionUser?.role === 'admin';
    if (!allowUnpublished && sessionUser) {
      const data = await dbGetAllShopsAndProfile(sessionUser.sub);
      allowUnpublished = data.shops.some((s) => s.slug === slug);
    }

    const bundle = await dbGetStorefrontBundle(slug, { allowUnpublished });
    if (!bundle) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json(bundle);
  }

  if (shopId) {
    const shop = await dbGetShopById(shopId);
    if (!shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    const { membership } = await getRequestShopMembership(req, shopId);
    const isMemberOrAdmin =
      sessionUser?.role === 'admin' ||
      sessionUser?.sub === shop.owner_id ||
      Boolean(membership?.is_active);
    if (!shop.is_published && !isMemberOrAdmin) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json({ shop, membership: membership || undefined });
  }

  if (memberFlag === '1') {
    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;
    const data = await dbGetAllShopsAndProfile(auth.user.sub);
    return NextResponse.json(data);
  }

  if (ownerId) {
    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;

    if (auth.user.role !== 'admin' && auth.user.sub !== ownerId) {
      return NextResponse.json(
        {
          error:
            'Bạn không có quyền xem danh sách cửa hàng của tài khoản khác.',
        },
        { status: 403 }
      );
    }

    const data = await dbGetAllShopsAndProfile(ownerId);
    return NextResponse.json(data);
  }

  const data = await dbGetAllShopsAndProfile(undefined);
  if (sessionUser?.role === 'admin') {
    return NextResponse.json(data);
  }

  // Public directory (/explore): only return published shops
  return NextResponse.json({
    shops: data.shops.filter((s) => s.is_published !== false),
    source: data.source,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body?.action === 'upsert_member') {
      const targetShopId = body.shop_id || body.shopId;
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const membership = await dbUpsertShopMembership({
        shop_id: targetShopId,
        user_id: body.user_id || body.userId,
        email: body.email,
        full_name: body.full_name || body.fullName,
        role: (body.role as ShopRole) || 'staff',
        permissions: body.permissions,
        is_active: body.is_active !== false,
      });
      return NextResponse.json({ membership });
    }

    if (body?.action === 'delete_member') {
      const targetShopId = body.shop_id || body.shopId;
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const deleted = await dbDeleteShopMembership(
        targetShopId,
        body.user_id || body.userId
      );
      return NextResponse.json({ deleted });
    }

    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;

    const effectiveOwnerId =
      auth.user.role === 'admin' && body.owner_id
        ? body.owner_id
        : auth.user.sub;

    const created = await dbCreateShop(body, effectiveOwnerId);
    return NextResponse.json({ shop: created }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create shop';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...patch } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing shop id' }, { status: 400 });
    }

    let existingShop: Awaited<ReturnType<typeof dbGetShopById>> = undefined;
    try {
      existingShop = await dbGetShopById(id);
    } catch {
      const { SEED_SHOPS } = await import('@/lib/seed-data');
      existingShop = SEED_SHOPS.find((s) => s.id === id);
    }
    if (!existingShop) {
      // Check auth first so cross-owner or unauthenticated requests get proper 401/403/404
      const auth = await requireShopPermission(req, id, 'settings.manage');
      if (auth.errorResponse) return auth.errorResponse;
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const requiredPerms = new Set<ShopPermission>();
    const incomingTheme = patch.theme_config as ShopThemeConfig | undefined;
    const prevTheme = existingShop.theme_config || {};
    if (patch.theme_config !== undefined && (!incomingTheme || typeof incomingTheme !== 'object' || Array.isArray(incomingTheme))) {
      return NextResponse.json({ error: 'theme_config phải là object' }, { status: 400 });
    }
    const bankKeys = ['paymentQr', 'paymentConfig'];
    const promoKeys = ['promoBanner', 'welcomePopup', 'flashSale'];
    for (const key of Object.keys(incomingTheme || {})) {
      if (JSON.stringify(incomingTheme?.[key as keyof ShopThemeConfig]) === JSON.stringify(prevTheme[key as keyof ShopThemeConfig])) continue;
      if (bankKeys.includes(key)) requiredPerms.add('settings.bank');
      else if (promoKeys.includes(key)) requiredPerms.add('promotions.manage');
      else requiredPerms.add('settings.manage');
    }
    if (Object.keys(patch).some((key) => key !== 'theme_config') || !requiredPerms.size) {
      requiredPerms.add('settings.manage');
    }

    const auth = await requireShopPermission(
      req,
      id,
      Array.from(requiredPerms)
    );
    if (auth.errorResponse) return auth.errorResponse;

    // Safely merge theme_config so partial updates do not drop imageUrl, ctaText, or paymentQr
    if (incomingTheme) {
      patch.theme_config = {
        ...prevTheme,
        ...incomingTheme,
        promoBanner: incomingTheme.promoBanner
          ? {
              ...(prevTheme.promoBanner || {}),
              ...incomingTheme.promoBanner,
            }
          : prevTheme.promoBanner,
        welcomePopup: incomingTheme.welcomePopup
          ? {
              ...(prevTheme.welcomePopup || {}),
              ...incomingTheme.welcomePopup,
            }
          : prevTheme.welcomePopup,
        flashSale: incomingTheme.flashSale
          ? {
              ...(prevTheme.flashSale || {}),
              ...incomingTheme.flashSale,
            }
          : prevTheme.flashSale,
        paymentQr:
          incomingTheme.paymentQr !== undefined
            ? incomingTheme.paymentQr
            : prevTheme.paymentQr,
      };
    }

    const updated = await dbUpdateShop(id, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json({ shop: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to update shop';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
