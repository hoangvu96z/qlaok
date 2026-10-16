import { NextResponse } from 'next/server';
import {
  dbCreateShop,
  dbGetAllShopsAndProfile,
  dbGetShopById,
  dbGetStorefrontBundle,
  dbUpdateShop,
} from '@/lib/db';
import {
  requireAuthenticatedUser,
  requireShopOwnerOrAdmin,
  verifyRequestUser,
} from '@/lib/server-auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const shopId = searchParams.get('shopId');
  const ownerId = searchParams.get('ownerId') || undefined;
  const sessionUser = await verifyRequestUser(req);

  if (slug) {
    // Allow owner or admin to preview unpublished storefront if authenticated
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
    const isOwnerOrAdmin =
      sessionUser?.role === 'admin' || sessionUser?.sub === shop.owner_id;
    if (!shop.is_published && !isOwnerOrAdmin) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json({ shop });
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
    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await req.json();
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

    const auth = await requireShopOwnerOrAdmin(req, id);
    if (auth.errorResponse) return auth.errorResponse;

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
