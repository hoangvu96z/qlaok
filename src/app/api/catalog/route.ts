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

const MAX_BULK_CATALOG_ITEMS = 2000;
const BULK_SELECT_CHUNK_SIZE = 1000;

function validateBulkCatalogItemIds(
  rawItemIds: unknown
):
  | { valid: true; itemIds: string[] }
  | { valid: false; code: string; error: string } {
  if (!Array.isArray(rawItemIds) || rawItemIds.length === 0) {
    return {
      valid: false,
      code: 'INVALID_ITEM_IDS',
      error: 'Danh sách mã món (itemIds) phải là mảng không rỗng.',
    };
  }

  if (rawItemIds.length > MAX_BULK_CATALOG_ITEMS) {
    return {
      valid: false,
      code: 'TOO_MANY_ITEMS',
      error: `Vượt quá giới hạn ${MAX_BULK_CATALOG_ITEMS.toLocaleString('en-US')} món mỗi lần thao tác.`,
    };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawItemIds.length; i++) {
    const entry = rawItemIds[i];
    if (typeof entry !== 'string') {
      return {
        valid: false,
        code: 'MALFORMED_ITEM_ID',
        error: `Mã món tại vị trí ${i + 1} không hợp lệ (phải là chuỗi).`,
      };
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      return {
        valid: false,
        code: 'MALFORMED_ITEM_ID',
        error: `Mã món tại vị trí ${i + 1} không được để trống.`,
      };
    }

    if (seen.has(trimmed)) {
      return {
        valid: false,
        code: 'DUPLICATE_ITEM_ID',
        error: `Mã món "${trimmed}" bị trùng lặp trong yêu cầu.`,
      };
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return { valid: true, itemIds: normalized };
}

async function fetchAndVerifyShopItems(
  sb: ReturnType<typeof getSupabaseDbClient>,
  shopId: string,
  itemIds: string[]
): Promise<
  | {
      ok: true;
      itemsById: Map<
        string,
        { id: string; shop_id: string; category_id: string }
      >;
    }
  | { ok: false; status: number; code: string; error: string }
> {
  const itemsById = new Map<
    string,
    { id: string; shop_id: string; category_id: string }
  >();

  for (
    let offset = 0;
    offset < itemIds.length;
    offset += BULK_SELECT_CHUNK_SIZE
  ) {
    const chunk = itemIds.slice(offset, offset + BULK_SELECT_CHUNK_SIZE);
    const { data: rows, error: selectErr } = await sb
      .from('items')
      .select('id, shop_id, category_id')
      .eq('shop_id', shopId)
      .in('id', chunk);

    if (selectErr) {
      return {
        ok: false,
        status: 500,
        code: 'DB_ITEM_LOOKUP_FAILED',
        error: selectErr.message || 'Không thể kiểm tra danh sách món.',
      };
    }

    for (const row of rows || []) {
      if (row && typeof row.id === 'string' && row.shop_id === shopId) {
        itemsById.set(row.id, {
          id: row.id,
          shop_id: row.shop_id,
          category_id:
            typeof row.category_id === 'string' ? row.category_id : '',
        });
      }
    }
  }

  for (const requestedId of itemIds) {
    const found = itemsById.get(requestedId);
    if (!found || found.shop_id !== shopId) {
      return {
        ok: false,
        status: 400,
        code: 'ITEM_NOT_IN_SHOP',
        error: 'Một hoặc nhiều món không tồn tại hoặc không thuộc cửa hàng này.',
      };
    }
  }

  return { ok: true, itemsById };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = searchParams.get('shopId') || undefined;
  const { shop, categories, items, ownerPlan } = await dbGetShopCatalog(shopId);
  return NextResponse.json({
    shop,
    categories,
    items,
    ownerPlan,
  });
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

    if (action === 'bulk_move_items') {
      const targetShopId =
        typeof body.shopId === 'string' ? body.shopId.trim() : '';
      if (!targetShopId) {
        return NextResponse.json(
          { success: false, code: 'INVALID_SHOP_ID', error: 'Missing shopId' },
          { status: 400 }
        );
      }

      const auth = await requireShopPermission(
        req,
        targetShopId,
        'catalog.manage'
      );
      if (auth.errorResponse) return auth.errorResponse;

      const targetCategoryId =
        typeof body.categoryId === 'string' ? body.categoryId.trim() : '';
      if (!targetCategoryId) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_CATEGORY_ID',
            error: 'Danh mục đích (categoryId) không hợp lệ hoặc bị trống.',
          },
          { status: 400 }
        );
      }

      const parsedIds = validateBulkCatalogItemIds(body.itemIds);
      if (!parsedIds.valid) {
        return NextResponse.json(
          {
            success: false,
            code: parsedIds.code,
            error: parsedIds.error,
          },
          { status: 400 }
        );
      }
      const normalizedItemIds = parsedIds.itemIds;

      const sb = getSupabaseDbClient();

      const { data: targetCategory, error: categoryErr } = await sb
        .from('categories')
        .select('id, shop_id')
        .eq('id', targetCategoryId)
        .eq('shop_id', targetShopId)
        .maybeSingle();

      if (categoryErr) {
        return NextResponse.json(
          {
            success: false,
            code: 'DB_CATEGORY_LOOKUP_FAILED',
            error: categoryErr.message || 'Không thể kiểm tra danh mục đích.',
          },
          { status: 500 }
        );
      }

      if (!targetCategory || targetCategory.shop_id !== targetShopId) {
        return NextResponse.json(
          {
            success: false,
            code: 'CATEGORY_NOT_IN_SHOP',
            error: 'Danh mục đích không tồn tại hoặc không thuộc cửa hàng này.',
          },
          { status: 400 }
        );
      }

      const verifiedItems = await fetchAndVerifyShopItems(
        sb,
        targetShopId,
        normalizedItemIds
      );
      if (!verifiedItems.ok) {
        return NextResponse.json(
          {
            success: false,
            code: verifiedItems.code,
            error: verifiedItems.error,
          },
          { status: verifiedItems.status }
        );
      }

      const itemsToMoveIds = normalizedItemIds.filter(
        (id) => verifiedItems.itemsById.get(id)?.category_id !== targetCategoryId
      );
      const unchangedCount = normalizedItemIds.length - itemsToMoveIds.length;

      if (itemsToMoveIds.length === 0) {
        return NextResponse.json({
          success: true,
          updatedCount: 0,
          movedCount: 0,
          unchangedCount,
          unchanged: true,
          categoryId: targetCategoryId,
          itemIds: normalizedItemIds,
        });
      }

      const {
        data: updatedRows,
        error: updateErr,
        count: updateCount,
      } = await sb
        .from('items')
        .update({ category_id: targetCategoryId }, { count: 'exact' })
        .eq('shop_id', targetShopId)
        .in('id', itemsToMoveIds);

      if (updateErr) {
        return NextResponse.json(
          {
            success: false,
            code: 'DB_UPDATE_FAILED',
            error:
              updateErr.message ||
              'Không thể chuyển danh mục cho các món đã chọn.',
          },
          { status: 500 }
        );
      }

      const rawUpdatedRows = updatedRows as unknown;
      const affectedCount =
        typeof updateCount === 'number'
          ? updateCount
          : Array.isArray(rawUpdatedRows)
            ? rawUpdatedRows.length
            : null;

      if (affectedCount === null || affectedCount !== itemsToMoveIds.length) {
        return NextResponse.json(
          {
            success: false,
            code: 'BULK_MOVE_COUNT_MISMATCH',
            error: 'Số lượng món được cập nhật không khớp với yêu cầu.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        updatedCount: affectedCount,
        movedCount: affectedCount,
        unchangedCount,
        unchanged: false,
        categoryId: targetCategoryId,
        itemIds: normalizedItemIds,
      });
    }

    if (action === 'bulk_delete_items') {
      const targetShopId =
        typeof body.shopId === 'string' ? body.shopId.trim() : '';
      if (!targetShopId) {
        return NextResponse.json(
          { success: false, code: 'INVALID_SHOP_ID', error: 'Missing shopId' },
          { status: 400 }
        );
      }

      const auth = await requireShopPermission(
        req,
        targetShopId,
        'catalog.manage'
      );
      if (auth.errorResponse) return auth.errorResponse;

      const parsedIds = validateBulkCatalogItemIds(body.itemIds);
      if (!parsedIds.valid) {
        return NextResponse.json(
          {
            success: false,
            code: parsedIds.code,
            error: parsedIds.error,
          },
          { status: 400 }
        );
      }
      const normalizedItemIds = parsedIds.itemIds;

      const sb = getSupabaseDbClient();

      const verifiedItems = await fetchAndVerifyShopItems(
        sb,
        targetShopId,
        normalizedItemIds
      );
      if (!verifiedItems.ok) {
        return NextResponse.json(
          {
            success: false,
            code: verifiedItems.code,
            error: verifiedItems.error,
          },
          { status: verifiedItems.status }
        );
      }

      const {
        data: deletedRows,
        error: deleteErr,
        count: deleteCount,
      } = await sb
        .from('items')
        .delete({ count: 'exact' })
        .eq('shop_id', targetShopId)
        .in('id', normalizedItemIds);

      if (deleteErr) {
        return NextResponse.json(
          {
            success: false,
            code: 'DB_DELETE_FAILED',
            deletedCount: 0,
            count: 0,
            error: deleteErr.message || 'Không thể xóa các món đã chọn.',
          },
          { status: 500 }
        );
      }

      const rawDeletedRows = deletedRows as unknown;
      const affectedCount =
        typeof deleteCount === 'number'
          ? deleteCount
          : Array.isArray(rawDeletedRows)
            ? rawDeletedRows.length
            : null;

      if (affectedCount === null || affectedCount !== normalizedItemIds.length) {
        return NextResponse.json(
          {
            success: false,
            code: 'BULK_DELETE_COUNT_MISMATCH',
            deletedCount: 0,
            count: 0,
            error: 'Số lượng món đã xóa không khớp với yêu cầu.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        deletedCount: affectedCount,
        count: affectedCount,
        itemIds: normalizedItemIds,
      });
    }

    if (
      action === 'bulk_update_availability' ||
      action === 'bulk_set_availability'
    ) {
      const targetShopId =
        typeof body.shopId === 'string' ? body.shopId.trim() : '';
      if (!targetShopId) {
        return NextResponse.json(
          { success: false, code: 'INVALID_SHOP_ID', error: 'Missing shopId' },
          { status: 400 }
        );
      }

      const auth = await requireShopPermission(req, targetShopId, []);
      if (auth.errorResponse) return auth.errorResponse;

      const permissionOptions: Array<'catalog.manage' | 'inventory.adjust'> = [
        'catalog.manage',
        'inventory.adjust',
      ];
      if (!hasAnyShopPermission(auth.membership, permissionOptions)) {
        return NextResponse.json(
          {
            success: false,
            error: `Tài khoản (${auth.membership.role}) không có quyền thực hiện thao tác này (cần quyền: ${permissionOptions.join(' hoặc ')}).`,
            code: 'INSUFFICIENT_SHOP_PERMISSION',
            role: auth.membership.role,
            requiredPermissions: permissionOptions,
          },
          { status: 403 }
        );
      }

      const hasCamel = body.isAvailable !== undefined;
      const hasSnake = body.is_available !== undefined;
      if (
        (!hasCamel && !hasSnake) ||
        (hasCamel && typeof body.isAvailable !== 'boolean') ||
        (hasSnake && typeof body.is_available !== 'boolean') ||
        (hasCamel && hasSnake && body.isAvailable !== body.is_available)
      ) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_AVAILABILITY',
            error: 'Trạng thái còn món (is_available) phải là kiểu boolean.',
          },
          { status: 400 }
        );
      }
      const targetAvailable: boolean = hasCamel
        ? body.isAvailable
        : body.is_available;

      const parsedIds = validateBulkCatalogItemIds(body.itemIds);
      if (!parsedIds.valid) {
        return NextResponse.json(
          {
            success: false,
            code: parsedIds.code,
            error: parsedIds.error,
          },
          { status: 400 }
        );
      }
      const normalizedItemIds = parsedIds.itemIds;

      const sb = getSupabaseDbClient();

      const verifiedItems = await fetchAndVerifyShopItems(
        sb,
        targetShopId,
        normalizedItemIds
      );
      if (!verifiedItems.ok) {
        return NextResponse.json(
          {
            success: false,
            code: verifiedItems.code,
            error: verifiedItems.error,
          },
          { status: verifiedItems.status }
        );
      }

      const {
        data: updatedRows,
        error: updateErr,
        count: updateCount,
      } = await sb
        .from('items')
        .update({ is_available: targetAvailable }, { count: 'exact' })
        .eq('shop_id', targetShopId)
        .in('id', normalizedItemIds);

      if (updateErr) {
        return NextResponse.json(
          {
            success: false,
            code: 'DB_UPDATE_FAILED',
            updatedCount: 0,
            count: 0,
            error:
              updateErr.message ||
              'Không thể cập nhật trạng thái còn món cho các món đã chọn.',
          },
          { status: 500 }
        );
      }

      const rawUpdatedRows = updatedRows as unknown;
      const affectedCount =
        typeof updateCount === 'number'
          ? updateCount
          : Array.isArray(rawUpdatedRows)
            ? rawUpdatedRows.length
            : null;

      if (affectedCount === null || affectedCount !== normalizedItemIds.length) {
        return NextResponse.json(
          {
            success: false,
            code: 'BULK_AVAILABILITY_COUNT_MISMATCH',
            updatedCount: 0,
            count: 0,
            error:
              'Số lượng món được cập nhật trạng thái không khớp với yêu cầu.',
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        updatedCount: affectedCount,
        count: affectedCount,
        is_available: targetAvailable,
        isAvailable: targetAvailable,
        itemIds: normalizedItemIds,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Catalog operation failed';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
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
