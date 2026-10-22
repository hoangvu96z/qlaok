import { NextResponse } from 'next/server';
import {
  dbBulkImportCatalog,
  dbDeleteCategory,
  dbDeleteItem,
  dbGetShopCatalog,
  dbUpsertCategory,
  dbUpsertItem,
  getSupabaseDbClient,
} from '@/lib/db';
import { requireShopPermission } from '@/lib/server-auth';
import {
  buildInventoryOnlyItemPatch,
  getCatalogItemUpdatePermissionOptions,
  hasAnyShopPermission,
  hasShopPermission,
} from '@/lib/shop-permissions';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = searchParams.get('shopId') || undefined;
  const data = await dbGetShopCatalog(shopId);
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'upsert_category') {
      const targetShopId = body.category?.shop_id;
      const auth = await requireShopPermission(
        req,
        targetShopId,
        'catalog.manage'
      );
      if (auth.errorResponse) return auth.errorResponse;

      const category = await dbUpsertCategory(body.category);
      return NextResponse.json({ category });
    }

    if (action === 'upsert_item') {
      const targetShopId = body.item?.shop_id;
      // Validate an active membership first; the specific permission depends
      // on which fields actually change.
      const auth = await requireShopPermission(req, targetShopId, []);
      if (auth.errorResponse) return auth.errorResponse;

      const incoming = (body.item || {}) as Record<string, unknown>;
      let existing: Record<string, unknown> | null = null;
      if (typeof incoming.id === 'string' && incoming.id) {
        const { data: existingRow, error: existingErr } = await getSupabaseDbClient()
          .from('items')
          .select('*')
          .eq('id', incoming.id)
          .maybeSingle();
        if (existingErr) {
          return NextResponse.json(
            { error: existingErr.message },
            { status: 500 }
          );
        }
        existing = (existingRow as Record<string, unknown> | null) || null;
      }

      const permissionOptions = getCatalogItemUpdatePermissionOptions(
        incoming,
        existing
      );
      if (!hasAnyShopPermission(auth.membership, permissionOptions)) {
        return NextResponse.json(
          {
            error: `Tài khoản (${auth.membership.role}) không có quyền thực hiện thao tác này (cần quyền: ${permissionOptions.join(' hoặc ')}).`,
            code: 'INSUFFICIENT_SHOP_PERMISSION',
            role: auth.membership.role,
            requiredPermissions: permissionOptions,
          },
          { status: 403 }
        );
      }

      const canManageCatalog = hasShopPermission(
        auth.membership,
        'catalog.manage'
      );
      const payload =
        canManageCatalog || !existing
          ? body.item
          : buildInventoryOnlyItemPatch(incoming, existing);

      const item = await dbUpsertItem(payload);
      return NextResponse.json({ item });
    }

    if (action === 'bulk_import') {
      const targetShopId = body.shopId;
      const auth = await requireShopPermission(
        req,
        targetShopId,
        'catalog.manage'
      );
      if (auth.errorResponse) return auth.errorResponse;

      const result = await dbBulkImportCatalog(body.shopId, body.categories);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Catalog operation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get('itemId');
  const categoryId = searchParams.get('categoryId');
  const sb = getSupabaseDbClient();

  if (itemId) {
    const { data: item } = await sb
      .from('items')
      .select('id, shop_id')
      .eq('id', itemId)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const auth = await requireShopPermission(
      req,
      item.shop_id,
      'catalog.manage'
    );
    if (auth.errorResponse) return auth.errorResponse;

    const ok = await dbDeleteItem(itemId);
    return NextResponse.json({ deleted: ok });
  }

  if (categoryId) {
    const { data: category } = await sb
      .from('categories')
      .select('id, shop_id')
      .eq('id', categoryId)
      .maybeSingle();

    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    const auth = await requireShopPermission(
      req,
      category.shop_id,
      'catalog.manage'
    );
    if (auth.errorResponse) return auth.errorResponse;

    const ok = await dbDeleteCategory(categoryId);
    return NextResponse.json({ deleted: ok });
  }

  return NextResponse.json(
    { error: 'Missing itemId or categoryId' },
    { status: 400 }
  );
}
