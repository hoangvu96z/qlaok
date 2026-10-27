import { NextResponse } from 'next/server';
import {
  dbGetShopById,
  ensureSupabaseReadyAndSeeded,
  getSupabaseDbClient,
} from '@/lib/db';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  attachSessionCookie,
  clearSessionCookie,
  isShopBoundStaffSession,
  isStaffSessionUser,
  issuePostgrestAuthenticatedJwt,
  issueSessionToken,
  verifyRequestUser,
} from '@/lib/server-auth';
import { SEED_PROFILE, SEED_SHOPS } from '@/lib/seed-data';
import {
  dbGetUserShopMemberships,
  isShopScopedStaffUserId,
} from '@/lib/shop-permissions';
import {
  authenticateShopStaffLogin,
  verifyActiveShopStaffSession,
} from '@/lib/staff-accounts';
import {
  formatGenericPasswordRecoveryNotice,
  isReservedUnsupportedRecoveryEmail,
  isValidRecoveryEmail,
} from '@/lib/auth-recovery';
import { resolvePostLoginRoute } from '@/lib/post-login-route';
import {
  attachOidcTransactionCookie,
  buildZitadelAuthorizeUrl,
  clearOidcTransactionCookie,
  compareConstantTimeString,
  exchangeZitadelAuthorizationCode,
  fetchZitadelUserInfo,
  getZitadelClientId,
  getZitadelMobileClientId,
  isPlaceholderOidcClientId,
  issueOidcTransactionCookieValue,
  isValidMobileRedirectUri,
  isValidPkceCodeVerifier,
  isValidUuidSub,
  normalizeOidcAuthMode,
  resolveAndSyncZitadelOwnerProfile,
  resolveMobileZitadelRedirectUri,
  resolveZitadelRedirectUri,
  verifyZitadelJwt,
  ZitadelOidcError,
} from '@/lib/zitadel-oidc';
import type { Profile, Shop, ShopMembership } from '@/types/qlaok';

const OWNER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Loads shops where the user is an active (non-owner) member so staff and
 * cashiers are routed to the dashboard instead of onboarding after login.
 */
async function loadMemberShops(
  sb: ReturnType<typeof getSupabaseDbClient>,
  userId: string,
  ownedShopIds: Set<string>
): Promise<{ memberShops: Shop[]; memberships: ShopMembership[] }> {
  const memberships = (await dbGetUserShopMemberships(userId)).filter(
    (m) => m.is_active && !ownedShopIds.has(m.shop_id)
  );
  if (memberships.length === 0) {
    return { memberShops: [], memberships: [] };
  }
  const shopIds = memberships.map((m) => m.shop_id);
  const { data, error } = await sb.from('shops').select('*').in('id', shopIds);
  if (error) {
    throw new Error(
      `Không thể tải danh sách cửa hàng được phân quyền (${error.message}).`
    );
  }
  const shopMap = new Map<string, Shop>();
  for (const shop of (data || []) as Shop[]) shopMap.set(shop.id, shop);
  for (const sid of shopIds) {
    if (!shopMap.has(sid)) {
      const seed = SEED_SHOPS.find((s) => s.id === sid);
      if (seed) shopMap.set(seed.id, seed);
    }
  }
  return {
    memberShops: Array.from(shopMap.values()),
    memberships: memberships.filter((m) => shopMap.has(m.shop_id)),
  };
}

function handleOidcStart(
  req: Request,
  options: {
    mode?: string | null;
    nextPath?: string | null;
    loginHint?: string | null;
    lang?: string | null;
    format?: string | null;
  }
): NextResponse {
  const reqUrl = new URL(req.url);
  const clientId = getZitadelClientId();
  if (!clientId) {
    return NextResponse.json(
      {
        error:
          'Thiếu cấu hình ZITADEL_CLIENT_ID trên máy chủ cho xác thực OIDC.',
        code: 'ZITADEL_CLIENT_ID_MISSING',
      },
      { status: 500 }
    );
  }

  const redirectUri = resolveZitadelRedirectUri(reqUrl.origin);
  const mode = normalizeOidcAuthMode(options.mode);
  const { cookieValue, transaction, codeChallenge, codeChallengeMethod } =
    issueOidcTransactionCookieValue({
      redirectUri,
      nextPath: options.nextPath,
      mode,
    });

  const authorizeUrl = buildZitadelAuthorizeUrl({
    clientId,
    redirectUri,
    state: transaction.state,
    nonce: transaction.nonce,
    codeChallenge,
    mode: transaction.mode,
    loginHint: options.loginHint || undefined,
    lang:
      options.lang === 'en' ? 'en' : options.lang === 'vi' ? 'vi' : undefined,
  });

  const accept = (req.headers.get('accept') || '').toLowerCase();
  const wantsJson =
    options.format === 'json' || accept.includes('application/json');

  if (wantsJson) {
    const res = NextResponse.json({
      authorizeUrl,
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge,
      codeChallengeMethod,
      redirectUri: transaction.redirectUri,
      nextPath: transaction.nextPath,
      mode: transaction.mode,
    });
    attachOidcTransactionCookie(res, cookieValue);
    return res;
  }

  const res = NextResponse.redirect(authorizeUrl, { status: 302 });
  attachOidcTransactionCookie(res, cookieValue);
  return res;
}

async function handleMobileOidcExchange(
  body: Record<string, unknown>
): Promise<NextResponse> {
  const configuredClientId = getZitadelMobileClientId();
  if (!configuredClientId) {
    return NextResponse.json(
      {
        error:
          'Thiếu cấu hình ZITADEL_MOBILE_CLIENT_ID / EXPO_PUBLIC_ZITADEL_CLIENT_ID trên máy chủ.',
        code: 'ZITADEL_CLIENT_ID_MISSING',
      },
      { status: 500 }
    );
  }

  const rawClientId =
    typeof body.clientId === 'string'
      ? body.clientId.trim()
      : typeof body.client_id === 'string'
        ? body.client_id.trim()
        : '';
  if (rawClientId) {
    if (
      isPlaceholderOidcClientId(rawClientId) ||
      rawClientId !== configuredClientId
    ) {
      return NextResponse.json(
        {
          error:
            'Zitadel client_id từ ứng dụng di động không khớp với cấu hình máy chủ.',
          code: 'OIDC_CLIENT_ID_MISMATCH',
        },
        { status: 400 }
      );
    }
  }

  const expectedRedirectUri = resolveMobileZitadelRedirectUri();
  const rawRedirectUri =
    typeof body.redirectUri === 'string'
      ? body.redirectUri.trim()
      : typeof body.redirect_uri === 'string'
        ? body.redirect_uri.trim()
        : '';
  if (!rawRedirectUri || !isValidMobileRedirectUri(rawRedirectUri)) {
    return NextResponse.json(
      {
        error: `redirect_uri không hợp lệ. Phải khớp chính xác với ${expectedRedirectUri}.`,
        code: 'OIDC_REDIRECT_URI_MISMATCH',
      },
      { status: 400 }
    );
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json(
      {
        error: 'Thiếu mã xác thực (authorization code) từ Zitadel.',
        code: 'OIDC_CODE_MISSING',
      },
      { status: 400 }
    );
  }

  const codeVerifier =
    typeof body.codeVerifier === 'string'
      ? body.codeVerifier.trim()
      : typeof body.code_verifier === 'string'
        ? body.code_verifier.trim()
        : '';
  if (!isValidPkceCodeVerifier(codeVerifier)) {
    return NextResponse.json(
      {
        error: 'PKCE code_verifier không hợp lệ hoặc bị thiếu.',
        code: 'OIDC_PKCE_VERIFIER_INVALID',
      },
      { status: 400 }
    );
  }

  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  if (!nonce) {
    return NextResponse.json(
      {
        error: 'Thiếu nonce xác thực OIDC.',
        code: 'OIDC_NONCE_MISSING',
      },
      { status: 400 }
    );
  }

  const state = typeof body.state === 'string' ? body.state.trim() : '';
  const expectedState =
    typeof body.expectedState === 'string' ? body.expectedState.trim() : '';
  if (expectedState && (!state || !compareConstantTimeString(state, expectedState))) {
    return NextResponse.json(
      {
        error: 'State xác thực OIDC không khớp.',
        code: 'OIDC_STATE_MISMATCH',
      },
      { status: 400 }
    );
  }

  const tokenResponse = await exchangeZitadelAuthorizationCode({
    code,
    codeVerifier,
    redirectUri: expectedRedirectUri,
    clientId: configuredClientId,
  });

  const claims = await verifyZitadelJwt(tokenResponse.id_token!, {
    expectedAudience: configuredClientId,
    expectedNonce: nonce,
    requireNonce: true,
  });

  let resolvedEmail = claims.email;
  let resolvedFullName = claims.fullName;
  let resolvedPhone = claims.phone;

  if ((!resolvedEmail || !resolvedFullName) && tokenResponse.access_token) {
    const userInfo = await fetchZitadelUserInfo(tokenResponse.access_token);
    if (userInfo) {
      if (!userInfo.sub || userInfo.sub !== claims.sub) {
        throw new ZitadelOidcError(
          'OIDC_USERINFO_SUB_MISMATCH',
          'Subject từ UserInfo không khớp với id_token.',
          401
        );
      }
      if (!resolvedEmail && userInfo.email) resolvedEmail = userInfo.email;
      if (!resolvedFullName && userInfo.fullName)
        resolvedFullName = userInfo.fullName;
      if (!resolvedPhone && userInfo.phone) resolvedPhone = userInfo.phone;
    }
  }

  await ensureSupabaseReadyAndSeeded();
  const { user: finalUser, isAdmin } = await resolveAndSyncZitadelOwnerProfile({
    sub: claims.sub,
    email: resolvedEmail,
    fullName: resolvedFullName,
    phone: resolvedPhone,
    allowInsert: true,
  });

  const sb = getSupabaseDbClient();
  const { data: ownerShops, error: shopsLookupErr } = await sb
    .from('shops')
    .select('*')
    .eq('owner_id', finalUser.id)
    .order('created_at', { ascending: true });

  if (shopsLookupErr) {
    return NextResponse.json(
      {
        error: `Không thể tải danh sách cửa hàng (${shopsLookupErr.message}).`,
        code: 'AUTH_SHOPS_QUERY_FAILED',
      },
      { status: 500 }
    );
  }

  let memberData: { memberShops: Shop[]; memberships: ShopMembership[] } = {
    memberShops: [],
    memberships: [],
  };
  if (!isAdmin) {
    try {
      memberData = await loadMemberShops(
        sb,
        finalUser.id,
        new Set(((ownerShops || []) as Shop[]).map((s) => s.id))
      );
    } catch {
      // Non-fatal: app reloads memberships via /api/shops?member=1
    }
  }

  const nextPath =
    typeof body.next === 'string' ? body.next : '/dashboard';
  const resolvedTarget = resolvePostLoginRoute(
    {
      isAdmin,
      shops: (ownerShops || []) as Shop[],
      memberShops: memberData.memberShops,
    },
    nextPath
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + OWNER_SESSION_TTL_SECONDS;
  const accessToken = issueSessionToken(
    {
      id: finalUser.id,
      email: finalUser.email,
      role: isAdmin ? 'admin' : 'owner',
      is_admin: isAdmin,
    },
    OWNER_SESSION_TTL_SECONDS
  );
  const postgrestIssued = issuePostgrestAuthenticatedJwt({
    sub: finalUser.id,
    email: finalUser.email,
    isAdmin,
  });

  const res = NextResponse.json(
    {
      user: finalUser,
      shops: (ownerShops || []) as Shop[],
      memberShops: memberData.memberShops,
      memberships: memberData.memberships,
      isAdmin,
      redirectTo: resolvedTarget.path,
      accessToken,
      expiresAt,
      postgrestToken: postgrestIssued?.token ?? null,
      postgrestExpiresAt: postgrestIssued?.expiresAt ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  return attachSessionCookie(res, accessToken, OWNER_SESSION_TTL_SECONDS);
}

export async function GET(req: Request) {
  try {
    const reqUrl = new URL(req.url);
    const action = reqUrl.searchParams.get('action');
    if (action === 'oidc_start') {
      return handleOidcStart(req, {
        mode: reqUrl.searchParams.get('mode'),
        nextPath: reqUrl.searchParams.get('next'),
        loginHint: reqUrl.searchParams.get('login_hint'),
        lang: reqUrl.searchParams.get('lang'),
        format: reqUrl.searchParams.get('format'),
      });
    }

    const verified = await verifyRequestUser(req);
    if (!verified) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    if (isShopBoundStaffSession(verified)) {
      const boundShopId = verified.shop_id || '';
      const staffCheck = await verifyActiveShopStaffSession({
        userId: verified.sub,
        shopId: boundShopId,
        sessionVersion: verified.sv,
      });
      if (!staffCheck.active || !staffCheck.membership) {
        return NextResponse.json(
          { authenticated: false, code: 'STAFF_SESSION_REVOKED' },
          { status: 401 }
        );
      }
      return NextResponse.json({
        authenticated: true,
        session: {
          ...verified,
          role: staffCheck.membership.role,
        },
      });
    }
    return NextResponse.json({
      authenticated: true,
      session: verified,
    });
  } catch (err) {
    if (err instanceof ZitadelOidcError) {
      return NextResponse.json(
        {
          authenticated: false,
          error: err.message,
          code: err.code,
        },
        { status: err.status }
      );
    }
    return NextResponse.json(
      {
        authenticated: false,
        error:
          err instanceof Error
            ? err.message
            : 'Lỗi cấu hình xác thực phiên trên máy chủ.',
        code: 'SERVER_AUTH_MISCONFIGURED',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      action,
      email = '',
      username = '',
      password = '',
      fullName = '',
      phone = '',
    } = body as {
      action:
        | 'oidc_start'
        | 'oidc_mobile_exchange'
        | 'oidc_exchange'
        | 'register'
        | 'login'
        | 'staff_login'
        | 'demo_login'
        | 'sync_user'
        | 'logout'
        | 'check_recovery';
      mode?: string;
      next?: string;
      loginHint?: string;
      lang?: string;
      email?: string;
      username?: string;
      password?: string;
      fullName?: string;
      phone?: string;
      userId?: string;
      role?: string;
      account_type?: string;
      shopIdentifier?: string;
      shop_identifier?: string;
      shopSlug?: string;
      shop_slug?: string;
      shopId?: string;
      shop_id?: string;
      shopCode?: string;
      shop_code?: string;
      shop?: string;
    };

    const rawShopIdentifier = String(
      body.shopIdentifier ??
        body.shop_identifier ??
        body.shopSlug ??
        body.shop_slug ??
        body.shopId ??
        body.shop_id ??
        body.shopCode ??
        body.shop_code ??
        body.shop ??
        ''
    ).trim();

    if (action === 'logout') {
      const res = NextResponse.json({ success: true });
      clearOidcTransactionCookie(res);
      return clearSessionCookie(res);
    }

    if (action === 'oidc_start') {
      return handleOidcStart(req, {
        mode: body.mode,
        nextPath: body.next,
        loginHint: body.loginHint || email,
        lang: body.lang,
        format: 'json',
      });
    }

    if (action === 'oidc_mobile_exchange' || action === 'oidc_exchange') {
      return await handleMobileOidcExchange(body as Record<string, unknown>);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isAdminUser = isSuperAdminEmail(normalizedEmail);

    if (action === 'check_recovery') {
      if (!isValidRecoveryEmail(normalizedEmail)) {
        return NextResponse.json(
          {
            accepted: false,
            supported: false,
            reason: 'invalid_email',
            code: 'INVALID_EMAIL',
            error: 'Vui lòng nhập địa chỉ email hợp lệ.',
          },
          { status: 400 }
        );
      }
      if (isReservedUnsupportedRecoveryEmail(normalizedEmail) || isAdminUser) {
        return NextResponse.json(
          {
            accepted: false,
            supported: false,
            reason: 'unsupported_account',
            code: 'RECOVERY_UNSUPPORTED_ACCOUNT',
            error:
              'Tài khoản dùng thử hoặc quản trị hệ thống không hỗ trợ tự đặt lại mật khẩu qua email.',
          },
          { status: 409 }
        );
      }
      return NextResponse.json({
        accepted: true,
        supported: true,
        notice: formatGenericPasswordRecoveryNotice(null, 'vi'),
      });
    }

    // Security Guard: Reject staff or Super Admin registration attempts BEFORE any OIDC/DB flow
    if (action === 'register') {
      const callerSession = await verifyRequestUser(req);
      if (
        isStaffSessionUser(callerSession) ||
        Boolean(username && String(username).trim()) ||
        Boolean(rawShopIdentifier) ||
        isShopScopedStaffUserId(body.userId) ||
        body.role === 'staff' ||
        body.role === 'cashier' ||
        body.account_type === 'staff'
      ) {
        return NextResponse.json(
          {
            error:
              'Tài khoản nhân viên do chủ quán cấp, không được phép tự đăng ký hoặc nâng quyền thành chủ quán.',
            code: 'FORBIDDEN_STAFF_REGISTER',
          },
          { status: 403 }
        );
      }
      if (isAdminUser) {
        return NextResponse.json(
          {
            error:
              'Email Quản trị hệ thống không thể đăng ký mới hoặc ghi đè mật khẩu qua luồng công khai. Vui lòng sử dụng chức năng Đăng nhập.',
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error:
            'Đăng ký tài khoản Chủ quán sử dụng Zitadel OIDC (Authorization Code + PKCE). Trình duyệt không gửi mật khẩu trực tiếp tới Qlaok.',
          code: 'OIDC_REQUIRED',
          authorizePath: '/api/auth?action=oidc_start&mode=register',
        },
        { status: 400 }
      );
    }

    // Shop-scoped Staff Account Login (shop identifier + username + password, no email)
    if (
      action === 'staff_login' ||
      (action === 'login' &&
        (Boolean(rawShopIdentifier) ||
          (Boolean(username && String(username).trim()) && !normalizedEmail)))
    ) {
      const candidateUsername = String(
        username || (!normalizedEmail.includes('@') ? email : '')
      ).trim();

      const staffAuth = await authenticateShopStaffLogin({
        shopIdentifier: rawShopIdentifier,
        username: candidateUsername,
        password,
      });

      if (!staffAuth.ok) {
        const headers: Record<string, string> = {};
        if (
          staffAuth.status === 429 &&
          typeof staffAuth.retryAfterSec === 'number' &&
          staffAuth.retryAfterSec > 0
        ) {
          headers['Retry-After'] = String(staffAuth.retryAfterSec);
        }
        return NextResponse.json(
          {
            error: staffAuth.message,
            code: staffAuth.errorCode,
            ...(typeof staffAuth.retryAfterSec === 'number' &&
            staffAuth.retryAfterSec > 0
              ? { retryAfterSec: staffAuth.retryAfterSec }
              : {}),
          },
          { status: staffAuth.status, headers }
        );
      }

      const accessToken = issueSessionToken({
        id: staffAuth.user.id,
        email: '',
        username: staffAuth.user.username,
        shop_id: staffAuth.shop.id,
        account_type: 'staff',
        sv: staffAuth.sessionVersion,
        role: staffAuth.membership.role,
        is_admin: false,
      });

      const res = NextResponse.json({
        user: staffAuth.user,
        shops: [] as Shop[],
        memberShops: [staffAuth.shop],
        memberships: [staffAuth.membership],
        activeShopId: staffAuth.shop.id,
        redirectTo: '/dashboard/orders',
        isAdmin: false,
        accessToken,
      });
      return attachSessionCookie(res, accessToken);
    }

    // Verify caller session on sync_user BEFORE DB access
    const preVerifiedSyncSession =
      action === 'sync_user' ? await verifyRequestUser(req) : null;
    if (action === 'sync_user') {
      if (!preVerifiedSyncSession) {
        return NextResponse.json(
          {
            error:
              'Không thể đồng bộ người dùng: Thiếu hoặc sai token xác thực phiên đăng nhập (Unauthorized).',
          },
          { status: 401 }
        );
      }

      if (isShopBoundStaffSession(preVerifiedSyncSession)) {
        const boundShopId = preVerifiedSyncSession.shop_id || '';
        const staffCheck = await verifyActiveShopStaffSession({
          userId: preVerifiedSyncSession.sub,
          shopId: boundShopId,
          sessionVersion: preVerifiedSyncSession.sv,
        });
        if (!staffCheck.active || !staffCheck.membership) {
          return NextResponse.json(
            {
              error:
                'Phiên đăng nhập nhân viên đã bị thu hồi hoặc ngừng kích hoạt.',
              code: 'STAFF_SESSION_REVOKED',
            },
            { status: 401 }
          );
        }
        const boundShop = await dbGetShopById(boundShopId);
        if (!boundShop) {
          return NextResponse.json(
            { error: 'Không tìm thấy cửa hàng được phân công.' },
            { status: 404 }
          );
        }
        const staffUser: Profile = {
          id: preVerifiedSyncSession.sub,
          email: '',
          username:
            staffCheck.membership.username ||
            preVerifiedSyncSession.username ||
            '',
          shop_id: boundShopId,
          account_type: 'staff',
          full_name:
            staffCheck.membership.full_name ||
            staffCheck.membership.username ||
            preVerifiedSyncSession.username ||
            'Nhân viên',
          plan: 'free',
          role: staffCheck.membership.role,
        };
        const accessToken = issueSessionToken({
          id: staffUser.id,
          email: '',
          username: staffUser.username,
          shop_id: boundShopId,
          account_type: 'staff',
          sv:
            staffCheck.credential?.session_version ??
            preVerifiedSyncSession.sv,
          role: staffCheck.membership.role,
          is_admin: false,
        });
        const res = NextResponse.json({
          user: staffUser,
          shops: [] as Shop[],
          memberShops: [boundShop],
          memberships: [staffCheck.membership],
          activeShopId: boundShopId,
          redirectTo: '/dashboard/orders',
          isAdmin: false,
          accessToken,
        });
        return attachSessionCookie(res, accessToken);
      }

      if (
        normalizedEmail &&
        preVerifiedSyncSession.email &&
        normalizedEmail !== preVerifiedSyncSession.email
      ) {
        return NextResponse.json(
          {
            error:
              'Email yêu cầu đồng bộ không khớp với phiên đăng nhập đã xác thực.',
          },
          { status: 403 }
        );
      }
    }

    await ensureSupabaseReadyAndSeeded();
    const sb = getSupabaseDbClient();

    // 1. Explicit Demo Account Login (non-admin demo shop owner)
    if (
      action === 'demo_login' ||
      (action === 'login' &&
        normalizedEmail === 'chuquan@qlaok.vn' &&
        password === 'qlaok123456')
    ) {
      const [{ data: demoProfile }, { data: demoShops }] = await Promise.all([
        sb.from('profiles').select('*').eq('id', SEED_PROFILE.id).maybeSingle(),
        sb
          .from('shops')
          .select('*')
          .eq('owner_id', SEED_PROFILE.id)
          .order('created_at', { ascending: true }),
      ]);

      const resolvedUser = ((demoProfile as Profile) || SEED_PROFILE) as Profile;
      const accessToken = issueSessionToken({
        id: resolvedUser.id,
        email: resolvedUser.email,
        role: 'owner',
        is_admin: false,
      });

      const res = NextResponse.json({
        user: resolvedUser,
        shops: (demoShops || []) as Shop[],
        isAdmin: false,
        accessToken,
      });
      return attachSessionCookie(res, accessToken);
    }

    // 2. Reject direct password login for owners/admins — require Zitadel OIDC
    if (action === 'login') {
      return NextResponse.json(
        {
          error:
            'Đăng nhập Chủ quán / Quản trị viên sử dụng Zitadel OIDC (Authorization Code + PKCE). Trình duyệt không gửi mật khẩu trực tiếp tới Qlaok.',
          code: 'OIDC_REQUIRED',
          authorizePath: '/api/auth?action=oidc_start&mode=login',
        },
        { status: 400 }
      );
    }

    // 3. Sync authenticated owner/admin session (from Qlaok HttpOnly cookie or Zitadel JWT)
    if (action === 'sync_user') {
      const verifiedSession = preVerifiedSyncSession!;
      let finalUser: Profile;

      // verifyRequestUser has already resolved raw Zitadel subjects to the
      // canonical Qlaok profile UUID. Re-read that profile by id here; passing
      // the UUID back as though it were a Zitadel sub breaks opaque-sub users.
      const verifiedEmail = (
        verifiedSession.email ||
        normalizedEmail ||
        ''
      )
        .trim()
        .toLowerCase();
      let row: Profile | null = null;

      if (isValidUuidSub(verifiedSession.sub)) {
        const { data: existingById, error: lookupErr } = await sb
          .from('profiles')
          .select('*')
          .eq('id', verifiedSession.sub.toLowerCase())
          .maybeSingle();

        if (lookupErr && lookupErr.code !== 'PGRST116') {
          return NextResponse.json(
            {
              error: `Không thể truy vấn hồ sơ người dùng (${lookupErr.message}).`,
              code: 'AUTH_PROFILE_QUERY_FAILED',
            },
            { status: 500 }
          );
        }

        row = Array.isArray(existingById)
          ? ((existingById[0] as Profile | undefined) ?? null)
          : ((existingById as Profile | null) ?? null);

        if (!row) {
          const isSuperAdmin = isSuperAdminEmail(verifiedEmail);
          return NextResponse.json(
            {
              error: isSuperAdmin
                ? 'Hồ sơ Super Admin phải được cấp sẵn trong cơ sở dữ liệu.'
                : 'Không tìm thấy hồ sơ chủ quán đã đồng bộ.',
              code: isSuperAdmin
                ? 'FORBIDDEN_SUPER_ADMIN_AUTO_CREATE'
                : 'OIDC_PROFILE_NOT_FOUND',
            },
            { status: isSuperAdmin ? 403 : 404 }
          );
        }
      }

      const verifiedIsAdmin =
        isSuperAdminEmail(verifiedEmail) ||
        row?.role === 'admin' ||
        row?.is_admin === true;
      finalUser = row || {
        // Non-UUID local session (e.g. a seeded demo owner) is not a
        // PostgREST profile identity and remains on its existing local path.
        id: verifiedSession.sub,
        email: verifiedEmail,
        full_name:
          fullName ||
          (verifiedIsAdmin
            ? 'Hoàng Vũ (Super Admin)'
            : verifiedEmail.split('@')[0] || 'Chủ cửa hàng'),
        phone: phone || undefined,
        plan: verifiedIsAdmin ? 'premium' : 'free',
        is_admin: verifiedIsAdmin,
        role: verifiedIsAdmin ? 'admin' : 'owner',
        account_type: 'owner',
      };

      if (verifiedIsAdmin) {
        finalUser = {
          ...finalUser,
          plan: 'premium',
          is_admin: true,
          role: 'admin',
        };
      }

      const { data: ownerShops, error: shopsLookupErr } = await sb
        .from('shops')
        .select('*')
        .eq('owner_id', finalUser.id)
        .order('created_at', { ascending: true });

      if (shopsLookupErr) {
        return NextResponse.json(
          {
            error: `Không thể tải danh sách cửa hàng (${shopsLookupErr.message}).`,
            code: 'AUTH_SHOPS_QUERY_FAILED',
          },
          { status: 500 }
        );
      }

      let syncMemberData: {
        memberShops: Shop[];
        memberships: ShopMembership[];
      } = { memberShops: [], memberships: [] };
      if (!verifiedIsAdmin) {
        try {
          syncMemberData = await loadMemberShops(
            sb,
            finalUser.id,
            new Set(((ownerShops || []) as Shop[]).map((s) => s.id))
          );
        } catch {
          // Non-fatal for sync: dashboard reloads memberships authoritatively.
        }
      }

      const resolvedTarget = resolvePostLoginRoute(
        {
          isAdmin: verifiedIsAdmin,
          shops: (ownerShops || []) as Shop[],
          memberShops: syncMemberData.memberShops,
        },
        body.next
      );
      const redirectTo = resolvedTarget.path;

      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = nowSec + OWNER_SESSION_TTL_SECONDS;
      const accessToken = issueSessionToken(
        {
          id: finalUser.id,
          email: finalUser.email,
          role: verifiedIsAdmin ? 'admin' : 'owner',
          is_admin: verifiedIsAdmin,
        },
        OWNER_SESSION_TTL_SECONDS
      );
      const postgrestIssued = issuePostgrestAuthenticatedJwt({
        sub: finalUser.id,
        email: finalUser.email,
        isAdmin: verifiedIsAdmin,
      });

      const res = NextResponse.json({
        user: finalUser,
        shops: (ownerShops || []) as Shop[],
        memberShops: syncMemberData.memberShops,
        memberships: syncMemberData.memberships,
        isAdmin: verifiedIsAdmin,
        redirectTo,
        accessToken,
        expiresAt,
        postgrestToken: postgrestIssued?.token ?? null,
        postgrestExpiresAt: postgrestIssued?.expiresAt ?? null,
      });
      return attachSessionCookie(res, accessToken, OWNER_SESSION_TTL_SECONDS);
    }

    return NextResponse.json({ error: 'Invalid auth action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ZitadelOidcError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi xử lý xác thực tài khoản',
      },
      { status: 500 }
    );
  }
}
