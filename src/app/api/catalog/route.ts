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

function isEchoedCatalogItemStockSnapshot(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
  incomingStockNormalized: number | null,
  existingStockNormalized: number | null
): boolean {
  if (incomingStockNormalized === existingStockNormalized) {
    return true;
  }
  return (
    typeof incomingStockNormalized === 'number' &&
    typeof existingStockNormalized === 'number' &&
    typeof incoming.sold_count === 'number' &&
    Number.isInteger(incoming.sold_count) &&
    incoming.sold_count >= 0 &&
    typeof existing.sold_count === 'number' &&
    Number.isInteger(existing.sold_count) &&
    existing.sold_count >= 0 &&
    incomingStockNormalized + incoming.sold_count ===
      existingStockNormalized + existing.sold_count
  );
}

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
        {
          id: string;
          shop_id: string;
          category_id: string;
          stock_quantity: number | null;
        }
      >;
    }
  | { ok: false; status: number; code: string; error: string }
> {
  const itemsById = new Map<
    string,
    {
      id: string;
      shop_id: string;
      category_id: string;
      stock_quantity: number | null;
    }
  >();

  for (
    let offset = 0;
    offset < itemIds.length;
    offset += BULK_SELECT_CHUNK_SIZE
  ) {
    const chunk = itemIds.slice(offset, offset + BULK_SELECT_CHUNK_SIZE);
    const { data: rows, error: selectErr } = await sb
      .from('items')
      .select('id, shop_id, category_id, stock_quantity')
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
          stock_quantity:
            typeof row.stock_quantity === 'number' ? row.stock_quantity : null,
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
  const shopId = (searchParams.get('shopId') || '').trim();
  if (!shopId) {
    return NextResponse.json(
      { error: 'Thiếu mã cửa hàng (shopId).', code: 'SHOP_ID_REQUIRED' },
      { status: 400 }
    );
  }

  const { shop, categories, items, ownerPlan } = await dbGetShopCatalog(shopId);
  if (!shop || shop.id !== shopId) {
    return NextResponse.json(
      { error: 'Không tìm thấy cửa hàng.', code: 'SHOP_NOT_FOUND' },
      { status: 404 }
    );
  }

  if (shop.is_published === false) {
    const auth = await requireShopPermission(req, shopId, []);
    if (auth.errorResponse) {
      return NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.', code: 'SHOP_NOT_FOUND' },
        { status: 404 }
      );
    }
  }

  const publicShop = {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    vertical: shop.vertical,
    tagline_i18n: shop.tagline_i18n,
    description_i18n: shop.description_i18n,
    logo_url: shop.logo_url,
    cover_urls: shop.cover_urls,
    address: shop.address,
    city: shop.city,
    google_maps_url: shop.google_maps_url,
    google_review_url: shop.google_review_url,
    phone_contact: shop.phone_contact,
    zalo_phone: shop.zalo_phone,
    wifi_info: shop.wifi_info,
    opening_hours: shop.opening_hours,
    opening_hours_confirmed: shop.opening_hours_confirmed,
    supported_langs: shop.supported_langs,
    currency: shop.currency,
    theme_config: shop.theme_config,
    is_published: shop.is_published ?? true,
  };

  return NextResponse.json({
    shop: publicShop,
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
      const hasExpectedStock =
        (Object.prototype.hasOwnProperty.call(
          incoming,
          'expected_stock_quantity'
        ) &&
          incoming.expected_stock_quantity !== undefined) ||
        (Object.prototype.hasOwnProperty.call(
          incoming,
          'expectedStockQuantity'
        ) &&
          incoming.expectedStockQuantity !== undefined);

      const hasExpectedAvailability =
        (Object.prototype.hasOwnProperty.call(
          incoming,
          'expected_is_available'
        ) &&
          incoming.expected_is_available !== undefined) ||
        (Object.prototype.hasOwnProperty.call(
          incoming,
          'expectedIsAvailable'
        ) &&
          incoming.expectedIsAvailable !== undefined);
      const rawExpectedAvailability =
        Object.prototype.hasOwnProperty.call(
          incoming,
          'expected_is_available'
        ) && incoming.expected_is_available !== undefined
          ? incoming.expected_is_available
          : incoming.expectedIsAvailable;
      if (
        hasExpectedAvailability &&
        typeof rawExpectedAvailability !== 'boolean'
      ) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_EXPECTED_AVAILABILITY',
            error:
              'Trạng thái còn hàng đối chiếu (expected_is_available) phải là boolean.',
          },
          { status: 400 }
        );
      }
      const expectedAvailability = hasExpectedAvailability
        ? (rawExpectedAvailability as boolean)
        : undefined;
      if (
        existing &&
        hasExpectedAvailability &&
        expectedAvailability !== Boolean(existing.is_available)
      ) {
        return NextResponse.json(
          {
            success: false,
            code: 'STOCK_CONFLICT',
            error:
              'Trạng thái còn hàng của món đã thay đổi bởi thao tác khác. Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật.',
          },
          { status: 409 }
        );
      }

      const hasNonInventoryCatalogChanges =
        Boolean(existing) && !permissionOptions.includes('inventory.adjust');

      let payload: Record<string, unknown>;
      if (canManageCatalog || !existing) {
        payload = { ...incoming };

        if (payload.price !== undefined) {
          const parsedPrice = parseCatalogPriceValue(payload.price);
          if (!parsedPrice.valid) {
            return NextResponse.json(
              {
                success: false,
                code: 'INVALID_ITEM_PRICE',
                error: parsedPrice.error,
              },
              { status: 400 }
            );
          }
          payload.price = parsedPrice.price;
        }

        if (payload.stock_quantity !== undefined) {
          const parsedStock = parseCatalogStockValue(payload.stock_quantity);
          if (!parsedStock.valid) {
            return NextResponse.json(
              {
                success: false,
                code: 'INVALID_STOCK_QUANTITY',
                error: parsedStock.error,
              },
              { status: 400 }
            );
          }
          payload.stock_quantity = parsedStock.stock;
        }

        if (hasExpectedAvailability) {
          payload.expected_is_available = expectedAvailability;
        }

        if (hasExpectedStock) {
          const rawExpected = Object.prototype.hasOwnProperty.call(
            incoming,
            'expected_stock_quantity'
          )
            ? incoming.expected_stock_quantity
            : incoming.expectedStockQuantity;
          const parsedExpected = parseCatalogStockValue(rawExpected);
          if (!parsedExpected.valid) {
            return NextResponse.json(
              {
                success: false,
                code: 'INVALID_EXPECTED_STOCK_QUANTITY',
                error: parsedExpected.error,
              },
              { status: 400 }
            );
          }
          payload.expected_stock_quantity = parsedExpected.stock;
        } else if (existing && payload.stock_quantity !== undefined) {
          const incomingStockNormalized = payload.stock_quantity as
            | number
            | null;
          const existingStockNormalized =
            existing.stock_quantity === undefined
              ? null
              : (existing.stock_quantity as number | null);
          const isUnchangedStock =
            incomingStockNormalized === existingStockNormalized;
          const isEchoedSnapshotStock = isEchoedCatalogItemStockSnapshot(
            incoming,
            existing,
            incomingStockNormalized,
            existingStockNormalized
          );
          const hasAvailabilityToggle =
            typeof incoming.is_available === 'boolean' &&
            incoming.is_available !== Boolean(existing.is_available);
          const isStalePreExhaustionAvailable =
            existingStockNormalized === 0 &&
            incomingStockNormalized !== 0 &&
            incoming.is_available === true;
          const hasExplicitAvailabilityChange =
            hasAvailabilityToggle && !isStalePreExhaustionAvailable;

          if (hasNonInventoryCatalogChanges && isEchoedSnapshotStock) {
            if (hasExpectedAvailability) {
              delete payload.stock_quantity;
              delete payload.sold_count;
              payload.expected_is_available = expectedAvailability;
              if (
                typeof incoming.is_available === 'boolean' &&
                incoming.is_available !== expectedAvailability
              ) {
                payload.is_available = incoming.is_available;
              } else {
                delete payload.is_available;
              }
            } else if (!hasAvailabilityToggle || isStalePreExhaustionAvailable) {
              delete payload.stock_quantity;
              delete payload.sold_count;
              delete payload.is_available;
            } else {
              return NextResponse.json(
                {
                  success: false,
                  code: 'STOCK_CONFLICT',
                  error:
                    'Trạng thái còn hàng (is_available) trong bản chụp món không khớp với dữ liệu hiện tại hoặc thiếu expected_is_available khi cập nhật đồng thời. Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật.',
                },
                { status: 409 }
              );
            }
          } else if (
            !hasNonInventoryCatalogChanges &&
            hasExplicitAvailabilityChange &&
            isEchoedSnapshotStock
          ) {
            if (!hasExpectedAvailability) {
              return NextResponse.json(
                { success: false, code: 'STOCK_CONFLICT', error: 'Thiếu trạng thái bán đối chiếu (expected_is_available). Vui lòng tải lại và thử lại.' },
                { status: 409 }
              );
            }
            delete payload.stock_quantity;
            delete payload.sold_count;
          } else if (
            !hasNonInventoryCatalogChanges &&
            !hasAvailabilityToggle &&
            isUnchangedStock
          ) {
            delete payload.stock_quantity;
            delete payload.is_available;
            delete payload.sold_count;
          } else {
            return NextResponse.json(
              {
                success: false,
                code: 'STOCK_CONFLICT',
                error:
                  'Thiếu thông tin tồn kho đối chiếu (expected_stock_quantity) hoặc tồn kho đã thay đổi. Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật tồn kho.',
              },
              { status: 409 }
            );
          }
        }

        const hasSnapshotMetadataFields =
          incoming.sold_count !== undefined ||
          incoming.view_count !== undefined ||
          incoming.created_at !== undefined ||
          incoming.updated_at !== undefined;
        if (
          existing &&
          hasNonInventoryCatalogChanges &&
          hasSnapshotMetadataFields &&
          !hasExpectedAvailability &&
          typeof payload.is_available === 'boolean' &&
          payload.is_available !== Boolean(existing.is_available)
        ) {
          return NextResponse.json(
            {
              success: false,
              code: 'STOCK_CONFLICT',
              error:
                'Trạng thái còn hàng (is_available) trong bản chụp món không khớp với dữ liệu hiện tại hoặc thiếu expected_is_available khi cập nhật đồng thời. Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật.',
            },
            { status: 409 }
          );
        }
        if (
          existing &&
          hasExpectedAvailability &&
          hasNonInventoryCatalogChanges &&
          typeof incoming.is_available === 'boolean' &&
          incoming.is_available === expectedAvailability
        ) {
          delete payload.is_available;
        }
      } else {
        payload = buildInventoryOnlyItemPatch(incoming, existing);
        if (
          existing &&
          !hasExpectedStock &&
          payload.stock_quantity !== undefined
        ) {
          const incomingStockNormalized = payload.stock_quantity as
            | number
            | null;
          const existingStockNormalized =
            existing.stock_quantity === undefined
              ? null
              : (existing.stock_quantity as number | null);
          const isUnchangedStock =
            incomingStockNormalized === existingStockNormalized;
          const isEchoedSnapshotStock = isEchoedCatalogItemStockSnapshot(
            incoming,
            existing,
            incomingStockNormalized,
            existingStockNormalized
          );
          const hasAvailabilityToggle =
            typeof incoming.is_available === 'boolean' &&
            incoming.is_available !== Boolean(existing.is_available);
          const isStalePreExhaustionAvailable =
            existingStockNormalized === 0 &&
            incomingStockNormalized !== 0 &&
            incoming.is_available === true;
          const hasExplicitAvailabilityChange =
            hasAvailabilityToggle && !isStalePreExhaustionAvailable;
          if (hasExplicitAvailabilityChange && isEchoedSnapshotStock) {
            if (!hasExpectedAvailability) {
              return NextResponse.json(
                { success: false, code: 'STOCK_CONFLICT', error: 'Thiếu trạng thái bán đối chiếu (expected_is_available). Vui lòng tải lại và thử lại.' },
                { status: 409 }
              );
            }
            delete payload.stock_quantity;
          } else if (!hasAvailabilityToggle && isUnchangedStock) {
            delete payload.stock_quantity;
            delete payload.is_available;
          } else {
            return NextResponse.json(
              {
                success: false,
                code: 'STOCK_CONFLICT',
                error:
                  'Thiếu thông tin tồn kho đối chiếu (expected_stock_quantity) hoặc tồn kho đã thay đổi. Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật tồn kho.',
              },
              { status: 409 }
            );
          }
        }
      }

      const item = await dbUpsertItem(
        payload as Parameters<typeof dbUpsertItem>[0]
      );
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

      if (!Array.isArray(body.categories)) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_CATEGORIES_PAYLOAD',
            error: 'Danh sách danh mục nhập hàng loạt không hợp lệ.',
          },
          { status: 400 }
        );
      }

      for (const catData of body.categories) {
        if (
          !catData ||
          typeof catData !== 'object' ||
          !Array.isArray((catData as { items?: unknown }).items)
        ) {
          return NextResponse.json(
            {
              success: false,
              code: 'INVALID_CATEGORIES_PAYLOAD',
              error: 'Danh sách món trong danh mục nhập hàng loạt không hợp lệ.',
            },
            { status: 400 }
          );
        }
        for (const itemData of (catData as { items: unknown[] }).items) {
          const rawPrice =
            itemData && typeof itemData === 'object'
              ? (itemData as Record<string, unknown>).price
              : undefined;
          const parsedPrice = parseCatalogPriceValue(rawPrice);
          if (!parsedPrice.valid) {
            return NextResponse.json(
              {
                success: false,
                code: 'INVALID_ITEM_PRICE',
                error: parsedPrice.error,
              },
              { status: 400 }
            );
          }
        }
      }

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
      const results: Array<{
        id: string;
        success: boolean;
        code?: string;
        error?: string;
      }> = [];
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

        const hasExpectedStock =
          (Object.prototype.hasOwnProperty.call(
            rawEntry,
            'expected_stock_quantity'
          ) &&
            rawEntry.expected_stock_quantity !== undefined) ||
          (Object.prototype.hasOwnProperty.call(
            rawEntry,
            'expectedStockQuantity'
          ) &&
            rawEntry.expectedStockQuantity !== undefined);
        let expectedStockNormalized: number | null | undefined = undefined;
        if (hasExpectedStock) {
          const rawExp = Object.prototype.hasOwnProperty.call(
            rawEntry,
            'expected_stock_quantity'
          )
            ? rawEntry.expected_stock_quantity
            : rawEntry.expectedStockQuantity;
          const parsedExpRes = parseCatalogStockValue(rawExp);
          if (!parsedExpRes.valid) {
            results.push({
              id: itemId,
              success: false,
              code: 'INVALID_EXPECTED_STOCK_QUANTITY',
              error: parsedExpRes.error,
            });
            continue;
          }
          expectedStockNormalized = parsedExpRes.stock;
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
          nextStock !== undefined &&
          (nextStock !== currentStockNormalized ||
            (hasExpectedStock &&
              expectedStockNormalized !== currentStockNormalized));
        if (
          (stockWillChange || nextStock !== undefined) &&
          !canManageCatalog &&
          !canAdjustInventory
        ) {
          results.push({
            id: itemId,
            success: false,
            error: `Tài khoản (${auth.membership.role}) không có quyền sửa tồn kho (cần quyền: inventory.adjust hoặc catalog.manage).`,
          });
          continue;
        }

        if (nextStock !== undefined && !hasExpectedStock) {
          results.push({
            id: itemId,
            success: false,
            code: 'STOCK_CONFLICT',
            error:
              'Thiếu thông tin tồn kho đối chiếu (expected_stock_quantity). Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật tồn kho.',
          });
          continue;
        }

        if (!priceWillChange && !stockWillChange) {
          results.push({ id: itemId, success: true });
          continue;
        }

        // Match handleUpdateStock semantics for derived availability when stock_quantity is updated:
        // Setting stock to 0 sets is_available = false (sold out).
        // Restoring stock to > 0 sets is_available = true.
        // Unlimited stock (null) or untouched stock leaves is_available unchanged.
        const nextAvailable =
          nextStock === 0
            ? false
            : typeof nextStock === 'number' && nextStock > 0
              ? true
              : undefined;

        try {
          // Strictly protect all immutable fields and untouched inventory fields:
          // Never pass sold_count or view_count, and only write stock_quantity /
          // derived is_available when stock_quantity was actually provided.
          await dbUpsertItem({
            id: existing.id,
            shop_id: targetShopId,
            category_id: existing.category_id,
            ...(priceWillChange && nextPrice !== undefined
              ? { price: nextPrice }
              : {}),
            ...(stockWillChange && nextStock !== undefined
              ? {
                  stock_quantity: nextStock,
                  ...(hasExpectedStock
                    ? { expected_stock_quantity: expectedStockNormalized }
                    : {}),
                  ...(nextAvailable !== undefined
                    ? { is_available: nextAvailable }
                    : {}),
                }
              : {}),
          });
          updatedCount++;
          results.push({ id: itemId, success: true });
        } catch (updateErr) {
          const rawMsg =
            updateErr instanceof Error ? updateErr.message : 'Cập nhật thất bại.';
          const isConflict = rawMsg.startsWith('STOCK_CONFLICT:');
          const cleanMsg = isConflict
            ? rawMsg.replace(/^STOCK_CONFLICT:\s*/, '')
            : rawMsg;
          results.push({
            id: itemId,
            success: false,
            ...(isConflict ? { code: 'STOCK_CONFLICT' } : {}),
            error: cleanMsg,
          });
        }
      }

      const overallSuccess = results.length > 0 && results.every((r) => r.success);
      const hasStockConflict = results.some((r) => r.code === 'STOCK_CONFLICT');

      return NextResponse.json(
        {
          success: overallSuccess,
          ...(hasStockConflict ? { code: 'STOCK_CONFLICT' } : {}),
          updatedCount,
          results,
        },
        { status: updatedCount === 0 && hasStockConflict ? 409 : 200 }
      );
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
      const rpcClient = sb as unknown as {
        rpc?: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{
          data: unknown;
          error: { message?: string; code?: string } | null;
        }>;
      };

      if (typeof rpcClient.rpc === 'function') {
        const { data: rpcRawData, error: rpcError } = await rpcClient.rpc(
          'bulk_set_items_availability_atomic',
          {
            p_shop_id: targetShopId,
            p_item_ids: normalizedItemIds,
            p_is_available: targetAvailable,
          }
        );

        if (rpcError) {
          return NextResponse.json(
            {
              success: false,
              code: 'DB_UPDATE_FAILED',
              updatedCount: 0,
              count: 0,
              error:
                rpcError.message ||
                'Không thể cập nhật trạng thái còn món cho các món đã chọn.',
            },
            { status: 500 }
          );
        }

        const unwrappedRpcData = Array.isArray(rpcRawData)
          ? rpcRawData[0]
          : rpcRawData;
        const rpcPayload =
          unwrappedRpcData &&
          typeof unwrappedRpcData === 'object' &&
          'bulk_set_items_availability_atomic' in
            (unwrappedRpcData as Record<string, unknown>)
            ? (unwrappedRpcData as Record<string, unknown>)
                .bulk_set_items_availability_atomic
            : unwrappedRpcData;

        if (
          !rpcPayload ||
          typeof rpcPayload !== 'object' ||
          typeof (rpcPayload as { success?: unknown }).success !== 'boolean'
        ) {
          return NextResponse.json(
            {
              success: false,
              code: 'DB_UPDATE_FAILED',
              updatedCount: 0,
              count: 0,
              error:
                'Không thể xác nhận kết quả cập nhật trạng thái còn món từ cơ sở dữ liệu.',
            },
            { status: 500 }
          );
        }

        const typedRpc = rpcPayload as {
          success: boolean;
          code?: string;
          error?: string;
          updated_count?: unknown;
          count?: unknown;
          zero_stock_item_ids?: unknown;
        };

        if (!typedRpc.success) {
          const failureCode =
            typeof typedRpc.code === 'string'
              ? typedRpc.code
              : 'DB_UPDATE_FAILED';

          if (failureCode === 'ITEM_NOT_IN_SHOP') {
            return NextResponse.json(
              {
                success: false,
                code: 'ITEM_NOT_IN_SHOP',
                error:
                  typedRpc.error ||
                  'Một hoặc nhiều món không tồn tại hoặc không thuộc cửa hàng này.',
              },
              { status: 400 }
            );
          }

          if (failureCode === 'ZERO_STOCK_CANNOT_MARK_AVAILABLE') {
            const zeroStockItemIds = Array.isArray(
              typedRpc.zero_stock_item_ids
            )
              ? typedRpc.zero_stock_item_ids.filter(
                  (id): id is string => typeof id === 'string'
                )
              : [];
            return NextResponse.json(
              {
                success: false,
                code: 'ZERO_STOCK_CANNOT_MARK_AVAILABLE',
                updatedCount: 0,
                count: 0,
                zeroStockItemIds,
                error:
                  typedRpc.error ||
                  'Không thể bật còn hàng cho món có tồn kho bằng 0. Vui lòng nhập thêm tồn kho hoặc chuyển món sang tồn kho không giới hạn (∞) trước.',
              },
              { status: 409 }
            );
          }

          if (failureCode === 'BULK_AVAILABILITY_COUNT_MISMATCH') {
            return NextResponse.json(
              {
                success: false,
                code: 'BULK_AVAILABILITY_COUNT_MISMATCH',
                updatedCount: 0,
                count: 0,
                error:
                  typedRpc.error ||
                  'Số lượng món được cập nhật trạng thái không khớp với yêu cầu.',
              },
              { status: 409 }
            );
          }

          if (
            failureCode === 'INVALID_SHOP_ID' ||
            failureCode === 'INVALID_AVAILABILITY' ||
            failureCode === 'EMPTY_ITEM_IDS' ||
            failureCode === 'INVALID_ITEM_IDS'
          ) {
            return NextResponse.json(
              {
                success: false,
                code: failureCode,
                error:
                  typedRpc.error || 'Dữ liệu cập nhật hàng loạt không hợp lệ.',
              },
              { status: 400 }
            );
          }

          return NextResponse.json(
            {
              success: false,
              code: 'DB_UPDATE_FAILED',
              updatedCount: 0,
              count: 0,
              error:
                typedRpc.error ||
                'Không thể cập nhật trạng thái còn món cho các món đã chọn.',
            },
            { status: 500 }
          );
        }

        const rpcAffectedCount =
          typeof typedRpc.updated_count === 'number'
            ? typedRpc.updated_count
            : typeof typedRpc.count === 'number'
              ? typedRpc.count
              : null;

        if (
          rpcAffectedCount === null ||
          rpcAffectedCount !== normalizedItemIds.length
        ) {
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
          updatedCount: rpcAffectedCount,
          count: rpcAffectedCount,
          is_available: targetAvailable,
          isAvailable: targetAvailable,
          itemIds: normalizedItemIds,
        });
      }

      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          {
            success: false,
            code: 'DB_UPDATE_FAILED',
            updatedCount: 0,
            count: 0,
            error:
              'Cơ sở dữ liệu không hỗ trợ RPC cập nhật trạng thái món nguyên tử (bulk_set_items_availability_atomic).',
          },
          { status: 500 }
        );
      }

      // Non-production unit-test mock fallback when `sb.rpc` is not implemented on the stub.
      // Never performs compensating snapshot rollback updates that could clobber concurrent writes.
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

      if (targetAvailable) {
        const zeroStockItemIds = normalizedItemIds.filter(
          (id) => verifiedItems.itemsById.get(id)?.stock_quantity === 0
        );
        if (zeroStockItemIds.length > 0) {
          return NextResponse.json(
            {
              success: false,
              code: 'ZERO_STOCK_CANNOT_MARK_AVAILABLE',
              updatedCount: 0,
              count: 0,
              zeroStockItemIds,
              error:
                'Không thể bật còn hàng cho món có tồn kho bằng 0. Vui lòng nhập thêm tồn kho hoặc chuyển món sang tồn kho không giới hạn (∞) trước.',
            },
            { status: 409 }
          );
        }
      }

      let updateQuery = sb
        .from('items')
        .update({ is_available: targetAvailable }, { count: 'exact' })
        .eq('shop_id', targetShopId)
        .in('id', normalizedItemIds);

      if (
        targetAvailable &&
        typeof (updateQuery as { or?: unknown }).or === 'function'
      ) {
        updateQuery = (
          updateQuery as unknown as {
            or: (filters: string) => typeof updateQuery;
          }
        ).or('stock_quantity.is.null,stock_quantity.gt.0');
      }

      const {
        data: updatedRows,
        error: updateErr,
        count: updateCount,
      } = await updateQuery;

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
    if (message.startsWith('STOCK_CONFLICT:')) {
      return NextResponse.json(
        {
          success: false,
          code: 'STOCK_CONFLICT',
          error: message.replace(/^STOCK_CONFLICT:\s*/, ''),
        },
        { status: 409 }
      );
    }
    if (message.startsWith('INVALID_STOCK_QUANTITY:')) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_STOCK_QUANTITY',
          error: message.replace(/^INVALID_STOCK_QUANTITY:\s*/, ''),
        },
        { status: 400 }
      );
    }
    if (message.startsWith('INVALID_EXPECTED_STOCK_QUANTITY:')) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_EXPECTED_STOCK_QUANTITY',
          error: message.replace(/^INVALID_EXPECTED_STOCK_QUANTITY:\s*/, ''),
        },
        { status: 400 }
      );
    }
    if (message.startsWith('INVALID_EXPECTED_AVAILABILITY:')) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_EXPECTED_AVAILABILITY',
          error: message.replace(/^INVALID_EXPECTED_AVAILABILITY:\s*/, ''),
        },
        { status: 400 }
      );
    }
    if (message.startsWith('INVALID_ITEM_PRICE:')) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_ITEM_PRICE',
          error: message.replace(/^INVALID_ITEM_PRICE:\s*/, ''),
        },
        { status: 400 }
      );
    }
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
