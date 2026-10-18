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
    message.includes('TABLE_CODE_REQUIRED')
  ) {
    return 400;
  }
  return 500;
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
      return NextResponse.json({ tables });
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
    const message =
      error instanceof Error
        ? error.message
        : 'Không thể tải danh sách bàn của cửa hàng.';
    return NextResponse.json(
      { error: message },
      { status: mapTableErrorStatus(message) }
    );
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

    return NextResponse.json({ table }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Không thể tạo bàn mới.';
    return NextResponse.json(
      { error: message },
      { status: mapTableErrorStatus(message) }
    );
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

    const table = await dbUpdateShopTable({
      shop_id: shopId,
      id: tableId,
      name: typeof body?.name === 'string' ? body.name : undefined,
      table_code:
        typeof body?.table_code === 'string' ? body.table_code : undefined,
      section: typeof body?.section === 'string' ? body.section : undefined,
      capacity:
        body?.capacity !== undefined ? Number(body.capacity) : undefined,
      sort_order:
        body?.sort_order !== undefined ? Number(body.sort_order) : undefined,
      is_active:
        body?.is_active !== undefined ? Boolean(body.is_active) : undefined,
      is_archived:
        body?.is_archived !== undefined ? Boolean(body.is_archived) : undefined,
    });

    return NextResponse.json({ table });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Không thể cập nhật bàn.';
    return NextResponse.json(
      { error: message },
      { status: mapTableErrorStatus(message) }
    );
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
