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
import { requireShopOwnerOrAdmin } from '@/lib/server-auth';

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
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const category = await dbUpsertCategory(body.category);
      return NextResponse.json({ category });
    }

    if (action === 'upsert_item') {
      const targetShopId = body.item?.shop_id;
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const item = await dbUpsertItem(body.item);
      return NextResponse.json({ item });
    }

    if (action === 'bulk_import') {
      const targetShopId = body.shopId;
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
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

    const auth = await requireShopOwnerOrAdmin(req, item.shop_id);
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

    const auth = await requireShopOwnerOrAdmin(req, category.shop_id);
    if (auth.errorResponse) return auth.errorResponse;

    const ok = await dbDeleteCategory(categoryId);
    return NextResponse.json({ deleted: ok });
  }

  return NextResponse.json(
    { error: 'Missing itemId or categoryId' },
    { status: 400 }
  );
}
