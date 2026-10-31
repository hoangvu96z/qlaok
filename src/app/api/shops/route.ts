import { NextResponse } from 'next/server';
import {
  dbCreateShop,
  dbGetAllShopsAndProfile,
  dbGetShopById,
  dbGetStorefrontBundle,
  dbUpdateShop,
  getSupabaseDbClient,
} from '@/lib/db';
import {
  getRequestShopMembership,
  isShopBoundStaffSession,
  isStaffSessionUser,
  requireActiveShopOwner,
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
  isShopScopedStaffUserId,
  validateStaffPermissionsInput,
  validateStaffRole,
} from '@/lib/shop-permissions';
import {
  dbCreateShopStaffAccount,
  dbDeleteShopStaffAccount,
  dbResetShopStaffPassword,
  dbUpdateShopStaffAccount,
  verifyActiveShopStaffSession,
} from '@/lib/staff-accounts';
import {
  assertNoSePaySecretInThemeConfig,
  dbDeleteShopSePayConfig,
  dbGetRedactedShopSePayConfig,
  dbUpsertShopSePayConfig,
} from '@/lib/sepay-reconciliation';
import { verifyTableQrSignature } from '@/lib/shop-tables';
import { validateOrderWorkflowConfig } from '@/lib/order-workflow';
import { validateLabelPrintConfig } from '@/lib/label-print-config';
import { isValidServiceRequestNotificationRule } from '@/lib/push-notifications';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  getShopSettingsPlanRestriction,
  normalizePlanTier,
} from '@/lib/plan-limits';
import { ALL_LOCALES } from '@/lib/i18n-helper';
import { validateOpeningHoursInput } from '@/lib/shop-setup-checklist';
import type { ShopPermission, ShopRole, ShopThemeConfig } from '@/types/qlaok';

/** Roles an owner may assign to invited staff (owner is never invitable). */
const INVITABLE_MEMBER_ROLES: ShopRole[] = ['cashier', 'staff'];

async function getShopForMemberAction(
  shopId: string
): Promise<Awaited<ReturnType<typeof dbGetShopById>>> {
  try {
    const shop = await dbGetShopById(shopId);
    if (shop) return shop;
  } catch {
    // fall back to seed shops below
  }
  const { SEED_SHOPS } = await import('@/lib/seed-data');
  return SEED_SHOPS.find((s) => s.id === shopId);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const shopId = searchParams.get('shopId');
  const ownerId = searchParams.get('ownerId') || undefined;
  const memberFlag = searchParams.get('member');
  const action = searchParams.get('action');
  const sessionUser = await verifyRequestUser(req);

  if (action === 'sepay_config' && shopId) {
    const auth = await requireShopOwnerOrAdmin(req, shopId);
    if (auth.errorResponse) return auth.errorResponse;
    try {
      const origin = new URL(req.url, 'http://localhost:3000').origin;
      const sepayConfig = await dbGetRedactedShopSePayConfig(shopId, {
        baseOrigin: origin,
      });
      return NextResponse.json({ sepayConfig });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Không thể tải cấu hình SePay.';
      return NextResponse.json(
        { error: message },
        { status: message.startsWith('SHOP_NOT_FOUND') ? 404 : 400 }
      );
    }
  }

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
    const normalizedSlug = slug.trim().toLowerCase();
    let allowUnpublished = sessionUser?.role === 'admin';
    let allowedUnpublishedShopIds: string[] = [];
    if (!allowUnpublished && sessionUser) {
      const data = await dbGetAllShopsAndProfile(sessionUser.sub);
      allowedUnpublishedShopIds = data.shops.map((s) => s.id);
      allowUnpublished = data.shops.some(
        (s) => s.slug.trim().toLowerCase() === normalizedSlug
      );
    }

    const view = (searchParams.get('view') ?? '').trim().toLowerCase();
    const bundle = await dbGetStorefrontBundle(slug, {
      allowUnpublished,
      allowedUnpublishedShopIds,
      includePosts: view !== 'menu',
    });
    if (!bundle) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    const tableIdParam = (searchParams.get('tableId') ?? '').trim();
    if (tableIdParam) {
      const tableQrVerified = verifyTableQrSignature({
        shop_id: bundle.shop.id,
        table_id: tableIdParam,
        signature: searchParams.get('sig'),
      });
      return NextResponse.json({ ...bundle, tableQrVerified });
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
    if (isShopBoundStaffSession(auth.user)) {
      const boundShopId = auth.user.shop_id || '';
      const staffCheck = await verifyActiveShopStaffSession({
        userId: auth.user.sub,
        shopId: boundShopId,
        sessionVersion: auth.user.sv,
      });
      if (!staffCheck.active || !staffCheck.membership) {
        return NextResponse.json(
          {
            error:
              'Tài khoản nhân viên đã bị ngừng kích hoạt hoặc không còn quyền truy cập.',
            code: 'STAFF_SESSION_REVOKED',
          },
          { status: 403 }
        );
      }
      const data = await dbGetAllShopsAndProfile(auth.user.sub);
      const scopedShops = data.shops.filter((s) => s.id === boundShopId);
      return NextResponse.json({
        ...data,
        shops: scopedShops,
        memberships: { [boundShopId]: staffCheck.membership },
      });
    }
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

    if (isShopBoundStaffSession(auth.user)) {
      const boundShopId = auth.user.shop_id || '';
      const staffCheck = await verifyActiveShopStaffSession({
        userId: auth.user.sub,
        shopId: boundShopId,
        sessionVersion: auth.user.sv,
      });
      if (!staffCheck.active || !staffCheck.membership) {
        return NextResponse.json(
          {
            error:
              'Tài khoản nhân viên đã bị ngừng kích hoạt hoặc không còn quyền truy cập.',
            code: 'STAFF_SESSION_REVOKED',
          },
          { status: 403 }
        );
      }
      const data = await dbGetAllShopsAndProfile(ownerId);
      const scopedShops = data.shops.filter((s) => s.id === boundShopId);
      return NextResponse.json({
        ...data,
        shops: scopedShops,
        memberships: { [boundShopId]: staffCheck.membership },
      });
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

    if (body?.action === 'invite_member') {
      const targetShopId = body.shop_id || body.shopId;
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !email.includes('@')) {
        return NextResponse.json(
          { error: 'Vui lòng nhập email hợp lệ của nhân viên.', code: 'INVALID_EMAIL' },
          { status: 400 }
        );
      }
      const role = body.role as ShopRole;
      if (!INVITABLE_MEMBER_ROLES.includes(role)) {
        return NextResponse.json(
          {
            error: `Vai trò "${String(body.role)}" không hợp lệ. Chỉ được mời: ${INVITABLE_MEMBER_ROLES.join(', ')}.`,
            code: 'INVALID_ROLE',
          },
          { status: 400 }
        );
      }

      const shop = await getShopForMemberAction(targetShopId);
      if (!shop) {
        return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
      }

      const { data: profiles, error: profileErr } = await getSupabaseDbClient()
        .from('profiles')
        .select('id, email, full_name')
        .ilike('email', email)
        .limit(1);
      if (profileErr) {
        return NextResponse.json(
          {
            error: `Không thể tra cứu tài khoản (${profileErr.message}).`,
            code: 'PROFILE_LOOKUP_FAILED',
          },
          { status: 500 }
        );
      }
      const profile = profiles?.[0] as
        | { id: string; email?: string; full_name?: string }
        | undefined;
      if (!profile) {
        return NextResponse.json(
          {
            error:
              'Chưa có tài khoản Qlaok nào dùng email này. Hãy nhờ nhân viên đăng ký tài khoản trước, sau đó mời lại.',
            code: 'MEMBER_ACCOUNT_NOT_FOUND',
          },
          { status: 404 }
        );
      }
      if (profile.id === shop.owner_id) {
        return NextResponse.json(
          {
            error: 'Email này là chủ cửa hàng, không thể thêm làm nhân viên.',
            code: 'MEMBER_IS_OWNER',
          },
          { status: 400 }
        );
      }

      const membership = await dbUpsertShopMembership({
        shop_id: targetShopId,
        user_id: profile.id,
        email: profile.email || email,
        full_name:
          (typeof body.full_name === 'string' && body.full_name.trim()) ||
          profile.full_name,
        role,
        is_active: true,
      });
      return NextResponse.json({ membership }, { status: 201 });
    }

    if (
      body?.action === 'create_staff_member' ||
      body?.action === 'create_staff'
    ) {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireActiveShopOwner(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const shop = await getShopForMemberAction(targetShopId);
      if (!shop) {
        return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
      }

      try {
        const membership = await dbCreateShopStaffAccount({
          shop_id: targetShopId,
          username: body.username,
          password: body.password,
          full_name:
            typeof body.full_name === 'string'
              ? body.full_name
              : typeof body.fullName === 'string'
                ? body.fullName
                : undefined,
          role: body.role !== undefined ? body.role : 'staff',
          permissions: body.permissions,
          is_active: body.is_active !== false,
          created_by: auth.user.sub,
        });
        return NextResponse.json({ membership }, { status: 201 });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Không thể tạo tài khoản nhân viên.';
        const codeMatch = message.match(/^([A-Z0-9_]+):\s*(.*)$/);
        const code = codeMatch?.[1] || 'CREATE_STAFF_FAILED';
        const status =
          code === 'STAFF_USERNAME_EXISTS'
            ? 409
            : code.startsWith('DB_')
              ? 500
              : 400;
        return NextResponse.json({ error: message, code }, { status });
      }
    }

    if (
      body?.action === 'update_staff_member' ||
      body?.action === 'update_staff' ||
      body?.action === 'set_staff_active'
    ) {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireActiveShopOwner(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const targetUserId = body.user_id || body.userId;
      const shopForMember = await getShopForMemberAction(targetShopId);
      if (shopForMember && targetUserId === shopForMember.owner_id) {
        return NextResponse.json(
          {
            error: 'Không thể thay đổi vai trò của chủ cửa hàng.',
            code: 'MEMBER_IS_OWNER',
          },
          { status: 400 }
        );
      }

      try {
        const membership = await dbUpdateShopStaffAccount({
          shop_id: targetShopId,
          user_id: targetUserId,
          username: body.username,
          full_name:
            typeof body.full_name === 'string'
              ? body.full_name
              : typeof body.fullName === 'string'
                ? body.fullName
                : undefined,
          role: body.role,
          permissions: body.permissions,
          is_active:
            typeof body.is_active === 'boolean' ? body.is_active : undefined,
        });
        return NextResponse.json({ membership });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Không thể cập nhật tài khoản nhân viên.';
        const codeMatch = message.match(/^([A-Z0-9_]+):\s*(.*)$/);
        const code = codeMatch?.[1] || 'UPDATE_STAFF_FAILED';
        const status =
          code === 'STAFF_MEMBER_NOT_FOUND'
            ? 404
            : code === 'STAFF_USERNAME_EXISTS'
              ? 409
              : code.startsWith('DB_')
                ? 500
                : 400;
        return NextResponse.json({ error: message, code }, { status });
      }
    }

    if (
      body?.action === 'reset_staff_password' ||
      body?.action === 'reset_member_password'
    ) {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireActiveShopOwner(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      try {
        const resetResult = await dbResetShopStaffPassword({
          shop_id: targetShopId,
          user_id: body.user_id || body.userId,
          username: body.username,
          new_password:
            body.new_password ?? body.newPassword ?? body.password,
        });
        return NextResponse.json({
          ok: true,
          user_id: resetResult.user_id,
          shop_id: resetResult.shop_id,
          username: resetResult.username,
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Không thể đặt lại mật khẩu nhân viên.';
        const codeMatch = message.match(/^([A-Z0-9_]+):\s*(.*)$/);
        const code = codeMatch?.[1] || 'RESET_STAFF_PASSWORD_FAILED';
        const status =
          code === 'STAFF_MEMBER_NOT_FOUND'
            ? 404
            : code.startsWith('DB_')
              ? 500
              : 400;
        return NextResponse.json({ error: message, code }, { status });
      }
    }

    if (body?.action === 'upsert_member') {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const targetUserId = String(body.user_id || body.userId || '').trim();
      const shopForMember = await getShopForMemberAction(targetShopId);
      if (shopForMember && targetUserId === shopForMember.owner_id) {
        return NextResponse.json(
          {
            error: 'Không thể thay đổi vai trò của chủ cửa hàng.',
            code: 'MEMBER_IS_OWNER',
          },
          { status: 400 }
        );
      }

      // Preserve identity fields when the caller only changes role/status.
      const existingMember = targetUserId
        ? (await dbGetShopMemberships(targetShopId)).find(
            (m) => m.user_id === targetUserId
          )
        : undefined;

      const roleCandidate =
        body.role !== undefined
          ? body.role
          : existingMember?.role || 'staff';
      const roleCheck = validateStaffRole(roleCandidate);
      if (!roleCheck.ok) {
        return NextResponse.json(
          { error: roleCheck.message, code: roleCheck.errorCode },
          { status: 400 }
        );
      }

      const permsCheck = validateStaffPermissionsInput(
        roleCheck.role,
        body.permissions !== undefined
          ? body.permissions
          : existingMember?.permissions
      );
      if (!permsCheck.ok) {
        return NextResponse.json(
          { error: permsCheck.message, code: permsCheck.errorCode },
          { status: 400 }
        );
      }

      const isTargetStaffAccount =
        isShopScopedStaffUserId(targetUserId) ||
        Boolean(existingMember?.username) ||
        Boolean(body.username);

      if (isTargetStaffAccount) {
        const ownerCheck = await requireActiveShopOwner(req, targetShopId);
        if (ownerCheck.errorResponse) return ownerCheck.errorResponse;

        try {
          const membership = await dbUpdateShopStaffAccount({
            shop_id: targetShopId,
            user_id: targetUserId || undefined,
            username: body.username ?? existingMember?.username,
            full_name:
              body.full_name || body.fullName || existingMember?.full_name,
            role: roleCheck.role,
            permissions: permsCheck.permissions,
            is_active:
              typeof body.is_active === 'boolean'
                ? body.is_active
                : existingMember?.is_active ?? true,
          });
          return NextResponse.json({ membership });
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : 'Không thể cập nhật tài khoản nhân viên.';
          const codeMatch = message.match(/^([A-Z0-9_]+):\s*(.*)$/);
          const code = codeMatch?.[1] || 'UPDATE_STAFF_FAILED';
          const status =
            code === 'STAFF_MEMBER_NOT_FOUND'
              ? 404
              : code === 'STAFF_USERNAME_EXISTS'
                ? 409
                : code.startsWith('DB_')
                  ? 500
                  : 400;
          return NextResponse.json({ error: message, code }, { status });
        }
      }

      const membership = await dbUpsertShopMembership({
        shop_id: targetShopId,
        user_id: targetUserId,
        email: body.email ?? existingMember?.email,
        full_name: body.full_name || body.fullName || existingMember?.full_name,
        role: roleCheck.role,
        permissions: permsCheck.permissions,
        is_active: body.is_active !== false,
      });
      return NextResponse.json({ membership });
    }

    if (
      body?.action === 'delete_member' ||
      body?.action === 'delete_staff_member'
    ) {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const targetUserId = String(body.user_id || body.userId || '').trim();
      const existingMembers = targetShopId
        ? await dbGetShopMemberships(targetShopId)
        : [];
      const existingTargetMember = existingMembers.find(
        (m) => m.user_id === targetUserId
      );
      const isTargetStaffAccount =
        body?.action === 'delete_staff_member' ||
        isShopScopedStaffUserId(targetUserId) ||
        Boolean(existingTargetMember?.username) ||
        existingTargetMember?.account_type === 'staff';

      if (isTargetStaffAccount) {
        const ownerAuth = await requireActiveShopOwner(req, targetShopId);
        if (ownerAuth.errorResponse) return ownerAuth.errorResponse;
      } else {
        const auth = await requireShopOwnerOrAdmin(req, targetShopId);
        if (auth.errorResponse) return auth.errorResponse;
      }

      const shopForMember = await getShopForMemberAction(targetShopId);
      if (shopForMember && targetUserId === shopForMember.owner_id) {
        return NextResponse.json(
          {
            error: 'Không thể xóa chủ cửa hàng khỏi danh sách nhân sự.',
            code: 'MEMBER_IS_OWNER',
          },
          { status: 400 }
        );
      }

      try {
        const deleted = isTargetStaffAccount
          ? await dbDeleteShopStaffAccount(targetShopId, targetUserId)
          : await dbDeleteShopMembership(targetShopId, targetUserId);
        return NextResponse.json({ deleted });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Không thể xóa tài khoản nhân sự.';
        const codeMatch = message.match(/^([A-Z0-9_]+):\s*(.*)$/);
        const code = codeMatch?.[1] || 'DELETE_STAFF_FAILED';
        const status = code.startsWith('DB_') ? 500 : 400;
        return NextResponse.json({ error: message, code }, { status });
      }
    }

    if (body?.action === 'upsert_sepay_config') {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      try {
        const origin = new URL(req.url, 'http://localhost:3000').origin;
        const sepayConfig = await dbUpsertShopSePayConfig({
          shopId: targetShopId,
          secret: typeof body.secret === 'string' ? body.secret : undefined,
          enabled:
            body.enabled !== undefined ? Boolean(body.enabled) : undefined,
          updatedBy: auth.user.sub,
          baseOrigin: origin,
        });
        return NextResponse.json({ sepayConfig });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Không thể lưu cấu hình SePay.';
        const status = message.startsWith('SEPAY_ENCRYPTION_NOT_CONFIGURED')
          ? 503
          : message.startsWith('SHOP_NOT_FOUND')
            ? 404
            : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }

    if (body?.action === 'delete_sepay_config') {
      const targetShopId = String(body.shop_id || body.shopId || '').trim();
      const auth = await requireShopOwnerOrAdmin(req, targetShopId);
      if (auth.errorResponse) return auth.errorResponse;

      const origin = new URL(req.url, 'http://localhost:3000').origin;
      const sepayConfig = await dbDeleteShopSePayConfig(targetShopId, {
        baseOrigin: origin,
      });
      return NextResponse.json({ sepayConfig });
    }

    const auth = await requireAuthenticatedUser(req);
    if (auth.errorResponse) return auth.errorResponse;

    if (
      isStaffSessionUser(auth.user) ||
      (typeof body?.owner_id === 'string' &&
        isShopScopedStaffUserId(body.owner_id))
    ) {
      return NextResponse.json(
        {
          error:
            'Tài khoản nhân viên không được phép đăng ký chủ quán hoặc tạo cửa hàng mới.',
          code: 'FORBIDDEN_STAFF_SHOP_CREATE',
        },
        { status: 403 }
      );
    }

    assertNoSePaySecretInThemeConfig(body?.theme_config);

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
    assertNoSePaySecretInThemeConfig(incomingTheme);
    const bankKeys = ['paymentQr', 'paymentConfig'];
    const promoKeys = ['promoBanner', 'welcomePopup', 'flashSale'];
    const ownerOnlyKeys = [
      'orderWorkflow',
      'labelPrintConfig',
      'serviceRequestNotificationRule',
    ];
    let requiresOwnerOrAdmin = false;
    let nonOwnerThemeKeyChanged = false;
    let nonBankThemeKeySubmitted = false;
    let bankKeySubmitted = false;
    for (const key of Object.keys(incomingTheme || {})) {
      const changed =
        JSON.stringify(incomingTheme?.[key as keyof ShopThemeConfig]) !==
        JSON.stringify(prevTheme[key as keyof ShopThemeConfig]);
      if (bankKeys.includes(key)) bankKeySubmitted = true;
      else nonBankThemeKeySubmitted = true;
      if (ownerOnlyKeys.includes(key)) {
        if (changed) {
          requiresOwnerOrAdmin = true;
        }
        continue;
      }
      if (!changed) continue;
      nonOwnerThemeKeyChanged = true;
      if (promoKeys.includes(key)) requiredPerms.add('promotions.manage');
      else if (bankKeys.includes(key)) requiredPerms.add('settings.bank');
      else requiredPerms.add('settings.manage');
    }
    const hasExplicitOwnerOnlyKey = Boolean(
      incomingTheme &&
        ('orderWorkflow' in incomingTheme ||
          'labelPrintConfig' in incomingTheme ||
          'serviceRequestNotificationRule' in incomingTheme)
    );
    if (
      hasExplicitOwnerOnlyKey &&
      !nonOwnerThemeKeyChanged &&
      !Object.keys(patch).some((key) => key !== 'theme_config')
    ) {
      requiresOwnerOrAdmin = true;
    }
    if (Object.keys(patch).some((key) => key !== 'theme_config')) {
      requiredPerms.add('settings.manage');
    } else if (!requiredPerms.size) {
      // Nothing changed. A payload that only carries bank keys is still a
      // bank-settings save (bank-only managers re-saving the payment tab), while
      // re-sending an unchanged bank block together with general settings must
      // not escalate to settings.bank.
      requiredPerms.add(
        bankKeySubmitted && !nonBankThemeKeySubmitted
          ? 'settings.bank'
          : 'settings.manage'
      );
    }

    if (requiresOwnerOrAdmin) {
      const ownerAuth = await requireShopOwnerOrAdmin(req, id);
      if (ownerAuth.errorResponse) return ownerAuth.errorResponse;
    }

    const auth = await requireShopPermission(
      req,
      id,
      Array.from(requiredPerms)
    );
    if (auth.errorResponse) return auth.errorResponse;

    const incomingSupportedLangs = patch.supported_langs;
    if (
      incomingSupportedLangs !== undefined &&
      (!Array.isArray(incomingSupportedLangs) ||
        incomingSupportedLangs.some(
          (locale) =>
            typeof locale !== 'string' ||
            !ALL_LOCALES.includes(locale as (typeof ALL_LOCALES)[number])
        ))
    ) {
      return NextResponse.json(
        {
          error: 'Danh sách ngôn ngữ cửa hàng không hợp lệ.',
          code: 'INVALID_SUPPORTED_LANGS',
        },
        { status: 400 }
      );
    }

    const currentSupportedLangs =
      existingShop.supported_langs?.length
        ? existingShop.supported_langs
        : ['vi'];
    const supportedLangsChanged =
      incomingSupportedLangs !== undefined &&
      JSON.stringify(incomingSupportedLangs) !==
        JSON.stringify(currentSupportedLangs);
    const requestedLanguageCount =
      incomingSupportedLangs === undefined
        ? undefined
        : new Set(incomingSupportedLangs as string[]).size;

    const customThemeKeys: Array<keyof ShopThemeConfig> = [
      'primaryColor',
      'layout',
      'backgroundStyle',
      'backgroundImageUrl',
      'backgroundOverlayOpacity',
    ];
    const customThemeChanged = Boolean(
      incomingTheme &&
        customThemeKeys.some(
          (key) =>
            key in incomingTheme &&
            JSON.stringify(incomingTheme[key]) !==
              JSON.stringify(prevTheme[key])
        )
    );

    const isSuperAdminBypass =
      auth.user.role === 'admin' && isSuperAdminEmail(auth.user.email);
    const needsOwnerPlanCheck =
      customThemeChanged ||
      (supportedLangsChanged && (requestedLanguageCount ?? 0) > 1);

    if (!isSuperAdminBypass && needsOwnerPlanCheck) {
      let rawOwnerPlan: unknown;
      try {
        const { data: ownerProfile, error: ownerPlanError } =
          await getSupabaseDbClient()
            .from('profiles')
            .select('plan')
            .eq('id', existingShop.owner_id)
            .maybeSingle();
        if (ownerPlanError || !ownerProfile) {
          return NextResponse.json(
            {
              error:
                'Không thể xác minh gói dịch vụ của chủ cửa hàng. Vui lòng thử lại.',
              code: 'PLAN_ACCESS_CHECK_FAILED',
            },
            { status: 503 }
          );
        }
        rawOwnerPlan = (ownerProfile as { plan?: unknown }).plan;
      } catch {
        return NextResponse.json(
          {
            error:
              'Không thể xác minh gói dịch vụ của chủ cửa hàng. Vui lòng thử lại.',
            code: 'PLAN_ACCESS_CHECK_FAILED',
          },
          { status: 503 }
        );
      }

      const ownerPlan = normalizePlanTier(rawOwnerPlan);
      const restriction = getShopSettingsPlanRestriction(ownerPlan, {
        customThemeChanged,
        ...(supportedLangsChanged && requestedLanguageCount !== undefined
          ? { supportedLanguageCount: requestedLanguageCount }
          : {}),
      });

      if (restriction) {
        const error =
          restriction.feature === 'custom_theme'
            ? `${restriction.code}: Tùy chỉnh giao diện cửa hàng chỉ có từ gói Basic. Vui lòng nâng cấp gói.`
            : `${restriction.code}: Gói hiện tại chỉ hỗ trợ tối đa ${restriction.maxLanguages} ngôn ngữ. Vui lòng nâng cấp để thêm ngôn ngữ.`;
        return NextResponse.json(
          {
            error,
            code: restriction.code,
            currentPlan: ownerPlan,
            requiredPlan: restriction.requiredPlan,
            ...(restriction.maxLanguages !== undefined
              ? { maxLanguages: restriction.maxLanguages }
              : {}),
            upgradeHref: '/dashboard/billing',
          },
          { status: 403 }
        );
      }
    }

    let validatedOrderWorkflow = prevTheme.orderWorkflow;
    if (incomingTheme && 'orderWorkflow' in incomingTheme && incomingTheme.orderWorkflow !== undefined) {
      const wfValidation = validateOrderWorkflowConfig(incomingTheme.orderWorkflow);
      if (!wfValidation.valid || !wfValidation.config) {
        const primaryError = wfValidation.errors[0];
        return NextResponse.json(
          {
            error:
              primaryError?.message ||
              'Cấu hình quy trình đơn hàng không hợp lệ.',
            code: primaryError?.code || 'INVALID_WORKFLOW_CONFIG',
            errors: wfValidation.errors,
          },
          { status: 400 }
        );
      }
      validatedOrderWorkflow = wfValidation.config;
    }

    let validatedLabelPrintConfig = prevTheme.labelPrintConfig;
    if (
      incomingTheme &&
      'labelPrintConfig' in incomingTheme &&
      incomingTheme.labelPrintConfig !== undefined
    ) {
      const labelValidation = validateLabelPrintConfig(
        incomingTheme.labelPrintConfig
      );
      if (!labelValidation.valid || !labelValidation.config) {
        const primaryError = labelValidation.errors[0];
        return NextResponse.json(
          {
            error:
              primaryError?.message ||
              'Cấu hình in tem nhãn không hợp lệ.',
            code: primaryError?.code || 'INVALID_LABEL_PRINT_CONFIG',
            errors: labelValidation.errors,
          },
          { status: 400 }
        );
      }
      validatedLabelPrintConfig = labelValidation.config;
    }

    let validatedServiceRequestNotificationRule =
      prevTheme.serviceRequestNotificationRule;
    if (
      incomingTheme &&
      'serviceRequestNotificationRule' in incomingTheme &&
      incomingTheme.serviceRequestNotificationRule !== undefined
    ) {
      if (
        !isValidServiceRequestNotificationRule(
          incomingTheme.serviceRequestNotificationRule
        )
      ) {
        return NextResponse.json(
          {
            error:
              'Cấu hình người nhận thông báo gọi phục vụ không hợp lệ (chỉ chấp nhận all_order_staff hoặc owner_only).',
            code: 'INVALID_SERVICE_REQUEST_NOTIFICATION_RULE',
          },
          { status: 400 }
        );
      }
      validatedServiceRequestNotificationRule =
        incomingTheme.serviceRequestNotificationRule;
    }

    if (patch.opening_hours !== undefined) {
      const openingHoursValidation = validateOpeningHoursInput(
        patch.opening_hours
      );
      if (!openingHoursValidation.valid) {
        return NextResponse.json(
          {
            error: openingHoursValidation.error,
            code: openingHoursValidation.code,
          },
          { status: 400 }
        );
      }
      patch.opening_hours = openingHoursValidation.openingHours;
    }

    if (
      patch.opening_hours_confirmed !== undefined &&
      typeof patch.opening_hours_confirmed !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'opening_hours_confirmed phải là kiểu boolean' },
        { status: 400 }
      );
    }

    if (
      patch.opening_hours_confirmed === true &&
      (patch.opening_hours === undefined || patch.opening_hours === null)
    ) {
      return NextResponse.json(
        {
          error:
            'INVALID_OPENING_HOURS: Cần gửi lịch mở cửa hợp lệ cùng lúc xác nhận giờ mở cửa.',
          code: 'INVALID_OPENING_HOURS',
        },
        { status: 400 }
      );
    }

    // Safely merge theme_config so partial updates do not drop imageUrl, ctaText, paymentQr, orderWorkflow, labelPrintConfig, or serviceRequestNotificationRule
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
        ...(validatedOrderWorkflow !== undefined
          ? { orderWorkflow: validatedOrderWorkflow }
          : {}),
        ...(validatedLabelPrintConfig !== undefined
          ? { labelPrintConfig: validatedLabelPrintConfig }
          : {}),
        ...(validatedServiceRequestNotificationRule !== undefined
          ? {
              serviceRequestNotificationRule:
                validatedServiceRequestNotificationRule,
            }
          : {}),
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
