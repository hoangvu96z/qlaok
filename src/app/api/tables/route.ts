import { NextResponse } from 'next/server';
import { dbGetShopById } from '@/lib/db';
import {
  getRequestShopMembership,
  requireAuthenticatedUser,
  requireShopOwnerOrAdmin,
} from '@/lib/server-auth';
import { hasShopPermission } from '@/lib/shop-permissions';
import {
  dbCreateShopTable,
  dbGetPublicShopTables,
  dbGetShopTableById,
  dbGetShopTables,
  dbUpdateShopTable,
  withTableQrSignature,
} from '@/lib/shop-tables';

function mapTableErrorStatus(message: string): number {
  if (message.includes('FORBIDDEN_CROSS_SHOP_TABLE')) return 403;
  if (message.includes('TABLE_NOT_FOUND')) return 404;
  if (
    message.includes('DUPLICATE_TABLE_CODE') ||
    message.includes('DUPLICATE_TABLE_NAME') ||
    message.includes('DUPLICATE_TABLE_ID')
  ) {
    return 409;
  }
  if (
    message.includes('MISSING_SHOP_ID') ||
    message.includes('MISSING_TABLE_IDENTITY') ||
    message.includes('TABLE_NAME_REQUIRED') ||
    message.includes('TABLE_CODE_REQUIRED') ||
    message.includes('INVALID_TABLE_LAYOUT_COORDINATE')
  ) {
    return 400;
  }
  return 500;
}

function getTableErrorCode(message: string): string {
  const knownCode = /^([A-Z][A-Z0-9_]{2,})\s*:/.exec(message.trim())?.[1];
  if (knownCode) return knownCode;
  if (message.includes('FORBIDDEN_CROSS_SHOP_TABLE')) return 'FORBIDDEN_CROSS_SHOP_TABLE';
  if (message.includes('TABLE_NOT_FOUND')) return 'TABLE_NOT_FOUND';
  return 'TABLE_OPERATION_FAILED';
}

function tableErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const code = getTableErrorCode(message);
  console.error('[tables] API operation failed', { code, error });
  return NextResponse.json(
    { error: 'Không thể xử lý bàn ăn lúc này. Vui lòng thử lại.', code },
    { status: mapTableErrorStatus(message) }
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shopId = (
      searchParams.get('shopId') ||
      searchParams.get('shop_id') ||
      ''
    ).trim();

    if (!shopId) {
      return NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shopId).' },
        { status: 400 }
      );
    }

    const includeInactive =
      searchParams.get('includeInactive') === '1' ||
      searchParams.get('includeInactive') === 'true';
    const includeArchived =
      searchParams.get('includeArchived') === '1' ||
      searchParams.get('includeArchived') === 'true';

    if (includeInactive || includeArchived) {
      const auth = await requireAuthenticatedUser(req);
      if (auth.errorResponse) return auth.errorResponse;

      const shop = await dbGetShopById(shopId);
      if (!shop) {
        return NextResponse.json(
          { error: 'Không tìm thấy cửa hàng.' },
          { status: 404 }
        );
      }

      if (auth.user.role !== 'admin' && auth.user.sub !== shop.owner_id) {
        const { membership } = await getRequestShopMembership(req, shopId);
        const canViewManagementList =
          Boolean(membership?.is_active) &&
          (membership?.role === 'owner' ||
            hasShopPermission(membership, 'orders.view') ||
            hasShopPermission(membership, 'reports.view') ||
            hasShopPermission(membership, 'settings.manage'));

        if (!canViewManagementList) {
          return NextResponse.json(
            {
              error:
                'Bạn không có quyền xem danh sách quản lý bàn của cửa hàng này.',
            },
            { status: 403 }
          );
        }
      }

      const tables = await dbGetShopTables(shopId, {
        includeInactive,
        includeArchived,
      });
      return NextResponse.json({ tables: tables.map(withTableQrSignature) });
    }

    const shop = await dbGetShopById(shopId);
    if (!shop) {
      return NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.' },
        { status: 404 }
      );
    }

    if (shop.is_published === false) {
      const { user, membership } = await getRequestShopMembership(req, shopId);
      const isMemberOrAdmin =
        user?.role === 'admin' ||
        user?.sub === shop.owner_id ||
        Boolean(membership?.is_active);
      if (!isMemberOrAdmin) {
        return NextResponse.json(
          { error: 'Không tìm thấy cửa hàng.' },
          { status: 404 }
        );
      }
    }

    const tables = await dbGetPublicShopTables(shopId);
    return NextResponse.json({ tables });
  } catch (error) {
    return tableErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const shopId = String(body?.shop_id || body?.shopId || '').trim();

    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;

    const table = await dbCreateShopTable({
      id: typeof body?.id === 'string' ? body.id : undefined,
      shop_id: shopId,
      name: String(body?.name ?? ''),
      table_code:
        typeof body?.table_code === 'string' ? body.table_code : undefined,
      section: typeof body?.section === 'string' ? body.section : undefined,
      capacity:
        body?.capacity !== undefined ? Number(body.capacity) : undefined,
      sort_order:
        body?.sort_order !== undefined ? Number(body.sort_order) : undefined,
      is_active:
        body?.is_active !== undefined ? Boolean(body.is_active) : true,
    });

    return NextResponse.json(
      { table: withTableQrSignature(table) },
      { status: 201 }
    );
  } catch (error) {
    return tableErrorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    let shopId = String(body?.shop_id || body?.shopId || '').trim();
    const tableId = String(
      body?.id || body?.table_id || body?.tableId || ''
    ).trim();

    if (!tableId) {
      const auth = await requireAuthenticatedUser(req);
      if (auth.errorResponse) return auth.errorResponse;
      return NextResponse.json(
        { error: 'MISSING_TABLE_IDENTITY: Thiếu id của bàn.' },
        { status: 400 }
      );
    }

    if (!shopId) {
      const auth = await requireAuthenticatedUser(req);
      if (auth.errorResponse) return auth.errorResponse;
      const existing = await dbGetShopTableById(tableId);
      if (!existing) {
        return NextResponse.json(
          { error: 'SHOP_TABLE_NOT_FOUND: Không tìm thấy bàn.' },
          { status: 404 }
        );
      }
      shopId = existing.shop_id;
    }

    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;

    const resolveCoordinate = (value: unknown): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const num = Number(value);
        if (Number.isFinite(num)) return num;
      }
      return value as number;
    };

    const hasLayoutX =
      body !== null &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'layout_x');
    const hasLayoutY =
      body !== null &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'layout_y');

    const table = await dbUpdateShopTable({
      shop_id: shopId,
      id: tableId,
      ...(typeof body?.name === 'string' ? { name: body.name } : {}),
      ...(typeof body?.table_code === 'string'
        ? { table_code: body.table_code }
        : {}),
      ...(typeof body?.section === 'string' ? { section: body.section } : {}),
      ...(body?.capacity !== undefined
        ? { capacity: Number(body.capacity) }
        : {}),
      ...(body?.sort_order !== undefined
        ? { sort_order: Number(body.sort_order) }
        : {}),
      ...(body?.is_active !== undefined
        ? { is_active: Boolean(body.is_active) }
        : {}),
      ...(body?.is_archived !== undefined
        ? { is_archived: Boolean(body.is_archived) }
        : {}),
      ...(hasLayoutX ? { layout_x: resolveCoordinate(body.layout_x) } : {}),
      ...(hasLayoutY ? { layout_y: resolveCoordinate(body.layout_y) } : {}),
    });

    return NextResponse.json({ table: withTableQrSignature(table) });
  } catch (error) {
    return tableErrorResponse(error);
  }
}

export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'TABLE_ARCHIVE_ONLY: Không hỗ trợ xóa vĩnh viễn bàn qua API để bảo toàn lịch sử đơn hàng. Vui lòng lưu trữ bàn (is_archived=true).',
    },
    { status: 405 }
  );
}
