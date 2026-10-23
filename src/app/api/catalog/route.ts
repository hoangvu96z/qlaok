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
import {
  parseCatalogPriceValue,
  parseCatalogStockValue,
} from '@/lib/catalog-excel';

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

    if (action === 'bulk_update_price_stock') {
      const targetShopId = body.shopId;
      if (!targetShopId || typeof targetShopId !== 'string') {
        return NextResponse.json({ error: 'Missing shopId' }, { status: 400 });
      }

      const auth = await requireShopPermission(req, targetShopId, []);
      if (auth.errorResponse) return auth.errorResponse;

      const incomingItems = body.items;
      if (!Array.isArray(incomingItems) || incomingItems.length === 0) {
        return NextResponse.json(
          { error: 'Danh sách món cần cập nhật không hợp lệ hoặc rỗng.' },
          { status: 400 }
        );
      }

      if (incomingItems.length > 2000) {
        return NextResponse.json(
          { error: 'Vượt quá giới hạn 2,000 món mỗi lần cập nhật.' },
          { status: 400 }
        );
      }

      const canManageCatalog = hasShopPermission(
        auth.membership,
        'catalog.manage'
      );
      const canAdjustInventory = hasShopPermission(
        auth.membership,
        'inventory.adjust'
      );

      // Pre-compute ID frequencies to detect duplicates in direct payload
      const idFrequencies = new Map<string, number>();
      for (const entry of incomingItems) {
        if (
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).id === 'string'
        ) {
          const trimmed = ((entry as Record<string, unknown>).id as string).trim();
          if (trimmed) {
            idFrequencies.set(trimmed, (idFrequencies.get(trimmed) || 0) + 1);
          }
        }
      }

      const sb = getSupabaseDbClient();
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      let updatedCount = 0;

      for (let idx = 0; idx < incomingItems.length; idx++) {
        const entry = incomingItems[idx];

        // 1. Malformed entry check: non-object or array
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          results.push({
            id: typeof entry === 'string' ? entry : `entry_${idx + 1}`,
            success: false,
            error: 'Dữ liệu dòng cập nhật không hợp lệ (phải là object).',
          });
          continue;
        }

        const rawEntry = entry as Record<string, unknown>;
        const rawId = rawEntry.id;
        const itemId = typeof rawId === 'string' ? rawId.trim() : '';

        // 2. Missing ID check
        if (!itemId) {
          results.push({
            id: '',
            success: false,
            error: 'Thiếu mã món (id).',
          });
          continue;
        }

        // 3. Duplicate ID check: reject without updating that item
        if ((idFrequencies.get(itemId) ?? 0) > 1) {
          results.push({
            id: itemId,
            success: false,
            error: `Mã món "${itemId}" bị trùng lặp trong yêu cầu.`,
          });
          continue;
        }

        const { data: existing, error: existingErr } = await sb
          .from('items')
          .select('*')
          .eq('id', itemId)
          .maybeSingle();

        if (existingErr) {
          results.push({ id: itemId, success: false, error: existingErr.message });
          continue;
        }

        if (!existing || existing.shop_id !== targetShopId) {
          results.push({
            id: itemId,
            success: false,
            error: 'Món không tồn tại hoặc không thuộc cửa hàng này.',
          });
          continue;
        }

        let nextPrice: number | undefined = undefined;
        if (rawEntry.price !== undefined) {
          const parsedPriceRes = parseCatalogPriceValue(rawEntry.price);
          if (!parsedPriceRes.valid) {
            results.push({ id: itemId, success: false, error: parsedPriceRes.error });
            continue;
          }
          nextPrice = parsedPriceRes.price;
        }

        let nextStock: number | null | undefined = undefined;
        if (rawEntry.stock_quantity !== undefined) {
          const parsedStockRes = parseCatalogStockValue(rawEntry.stock_quantity);
          if (!parsedStockRes.valid) {
            results.push({ id: itemId, success: false, error: parsedStockRes.error });
            continue;
          }
          nextStock = parsedStockRes.stock;
        }

        // Must provide at least price or stock_quantity to update
        if (nextPrice === undefined && nextStock === undefined) {
          results.push({
            id: itemId,
            success: false,
            error: 'Dòng cập nhật không chứa giá bán hoặc tồn kho hợp lệ.',
          });
          continue;
        }

        const priceWillChange =
          nextPrice !== undefined && nextPrice !== Number(existing.price);
        if (priceWillChange && !canManageCatalog) {
          results.push({
            id: itemId,
            success: false,
            error: `Tài khoản (${auth.membership.role}) không có quyền sửa giá (cần quyền: catalog.manage).`,
          });
          continue;
        }

        const currentStockNormalized =
          existing.stock_quantity === undefined ? null : existing.stock_quantity;
        const stockWillChange =
          nextStock !== undefined && nextStock !== currentStockNormalized;
        if (stockWillChange && !canManageCatalog && !canAdjustInventory) {
          results.push({
            id: itemId,
            success: false,
            error: `Tài khoản (${auth.membership.role}) không có quyền sửa tồn kho (cần quyền: inventory.adjust hoặc catalog.manage).`,
          });
          continue;
        }

        if (!priceWillChange && !stockWillChange) {
          results.push({ id: itemId, success: true });
          continue;
        }

        // Match handleUpdateStock semantics for derived availability:
        // Setting stock to 0 sets is_available = false (sold out).
        // Restoring stock to > 0 sets is_available = true.
        // Unlimited stock (null) or untouched stock leaves is_available unchanged.
        const nextAvailable =
          nextStock === 0
            ? false
            : typeof nextStock === 'number' && nextStock > 0
              ? true
              : Boolean(existing.is_available);

        try {
          // Strictly protect all immutable fields from workbook/payload injection:
          // Overwrite only price, stock_quantity, and derived is_available.
          await dbUpsertItem({
            id: existing.id,
            shop_id: targetShopId,
            category_id: existing.category_id,
            name_i18n: existing.name_i18n,
            desc_i18n: existing.desc_i18n,
            image_url: existing.image_url,
            is_featured: existing.is_featured,
            sort_order: existing.sort_order,
            options_json: existing.options_json,
            sold_count: existing.sold_count,
            view_count: existing.view_count,
            price: nextPrice !== undefined ? nextPrice : Number(existing.price),
            stock_quantity: nextStock !== undefined ? nextStock : existing.stock_quantity,
            is_available: nextStock !== undefined ? nextAvailable : Boolean(existing.is_available),
          });
          updatedCount++;
          results.push({ id: itemId, success: true });
        } catch (updateErr) {
          const msg =
            updateErr instanceof Error ? updateErr.message : 'Cập nhật thất bại.';
          results.push({ id: itemId, success: false, error: msg });
        }
      }

      const overallSuccess = results.length > 0 && results.every((r) => r.success);

      return NextResponse.json({
        success: overallSuccess,
        updatedCount,
        results,
      });
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
