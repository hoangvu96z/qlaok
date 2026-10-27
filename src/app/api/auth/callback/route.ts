import { NextResponse } from 'next/server';
import {
  ensureSupabaseReadyAndSeeded,
  getSupabaseDbClient,
} from '@/lib/db';
import {
  attachSessionCookie,
  issueSessionToken,
} from '@/lib/server-auth';
import { SEED_SHOPS } from '@/lib/seed-data';
import { dbGetUserShopMemberships } from '@/lib/shop-permissions';
import {
  resolvePostLoginRoute,
  sanitizeNextPath,
} from '@/lib/post-login-route';
import { getRequestOrigin } from '@/lib/request-origin';
import {
  clearOidcTransactionCookie,
  compareConstantTimeString,
  exchangeZitadelAuthorizationCode,
  fetchZitadelUserInfo,
  readOidcTransactionFromRequest,
  resolveAndSyncZitadelOwnerProfile,
  verifyZitadelJwt,
  ZitadelOidcError,
} from '@/lib/zitadel-oidc';
import type { Shop, ShopMembership } from '@/types/qlaok';

async function loadMemberShopsForCallback(
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
    throw new ZitadelOidcError(
      'AUTH_MEMBER_SHOPS_QUERY_FAILED',
      `Không thể tải danh sách cửa hàng được phân quyền (${error.message}).`,
      500
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

function sanitizeCallbackUserMessage(code: string, rawMessage: string): string {
  switch (code) {
    case 'OIDC_PROVIDER_ERROR':
      return 'Đăng nhập đã bị hủy hoặc từ chối. Vui lòng thử lại.';
    case 'OIDC_MISSING_PARAMS':
      return 'Thông tin phản hồi đăng nhập không đầy đủ. Vui lòng thử lại.';
    case 'OIDC_INVALID_TRANSACTION':
      return 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.';
    case 'OIDC_STATE_MISMATCH':
      return 'Trạng thái phiên đăng nhập không khớp. Vui lòng thử lại.';
    case 'OIDC_EMAIL_NOT_VERIFIED':
      return 'Email tài khoản chưa được xác thực. Vui lòng hoàn tất xác thực email trước khi tiếp tục.';
    case 'OIDC_PROFILE_ID_CONFLICT':
    case 'OIDC_SUBJECT_ALREADY_LINKED':
      return 'Email hoặc hồ sơ này đã được liên kết với một tài khoản khác.';
    case 'OIDC_EMAIL_REQUIRED':
      return 'Tài khoản chưa có địa chỉ email hợp lệ.';
    case 'FORBIDDEN_SUPER_ADMIN_AUTO_CREATE':
      return 'Tài khoản Quản trị hệ thống không thể tự tạo mới qua đăng nhập.';
    default: {
      const cleaned = rawMessage
        .replace(/\bZitadel\b/gi, '')
        .replace(/\bOIDC\b/gi, '')
        .replace(/\bPKCE\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return (
        cleaned || 'Không thể hoàn tất đăng nhập lúc này. Vui lòng thử lại.'
      );
    }
  }
}

function respondCallbackError(
  req: Request,
  reqUrl: URL,
  code: string,
  message: string,
  status: number,
  nextPath?: string
): NextResponse {
  const safeMessage = sanitizeCallbackUserMessage(code, message);
  const accept = (req.headers.get('accept') || '').toLowerCase();
  const wantsHtmlRedirect =
    reqUrl.searchParams.get('format') !== 'json' &&
    accept.includes('text/html') &&
    !accept.includes('application/json');

  if (wantsHtmlRedirect) {
    const loginUrl = new URL('/login', getRequestOrigin(req));
    loginUrl.searchParams.set('error', safeMessage);
    loginUrl.searchParams.set('error_code', code);
    const safeNext = sanitizeNextPath(nextPath) || '/dashboard';
    if (safeNext && safeNext !== '/dashboard') {
      loginUrl.searchParams.set('next', safeNext);
    }
    const res = NextResponse.redirect(loginUrl, { status: 302 });
    clearOidcTransactionCookie(res);
    return res;
  }

  const res = NextResponse.json({ error: safeMessage, code }, { status });
  clearOidcTransactionCookie(res);
  return res;
}

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);

  try {
    const providerError = (reqUrl.searchParams.get('error') || '').trim();
    if (providerError) {
      return respondCallbackError(
        req,
        reqUrl,
        'OIDC_PROVIDER_ERROR',
        'Đăng nhập đã bị hủy hoặc từ chối. Vui lòng thử lại.',
        400
      );
    }

    const code = (reqUrl.searchParams.get('code') || '').trim();
    const state = (reqUrl.searchParams.get('state') || '').trim();
    if (!code || !state) {
      return respondCallbackError(
        req,
        reqUrl,
        'OIDC_MISSING_PARAMS',
        'Thông tin phản hồi đăng nhập không đầy đủ. Vui lòng thử lại.',
        400
      );
    }

    const tx = readOidcTransactionFromRequest(req);
    if (!tx) {
      return respondCallbackError(
        req,
        reqUrl,
        'OIDC_INVALID_TRANSACTION',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        400
      );
    }

    if (!compareConstantTimeString(state, tx.state)) {
      return respondCallbackError(
        req,
        reqUrl,
        'OIDC_STATE_MISMATCH',
        'Trạng thái phiên đăng nhập không khớp. Vui lòng thử lại.',
        400,
        tx.nextPath
      );
    }

    const tokenRes = await exchangeZitadelAuthorizationCode({
      code,
      codeVerifier: tx.codeVerifier,
      redirectUri: tx.redirectUri,
    });

    const claims = await verifyZitadelJwt(tokenRes.id_token || '', {
      expectedNonce: tx.nonce,
      requireNonce: true,
    });

    let email = claims.email;
    let emailVerified = claims.emailVerified;
    let fullName = claims.fullName;
    let phone = claims.phone;

    if (
      (!email || !fullName || emailVerified === undefined) &&
      tokenRes.access_token
    ) {
      const userInfo = await fetchZitadelUserInfo(tokenRes.access_token);
      if (userInfo) {
        if (!userInfo.sub || userInfo.sub !== claims.sub) {
          throw new ZitadelOidcError(
            'OIDC_USERINFO_SUB_MISMATCH',
            'Định danh người dùng không khớp với phiên đăng nhập.',
            401
          );
        }
        email = email || userInfo.email;
        if (emailVerified === undefined && userInfo.emailVerified !== undefined) {
          emailVerified = userInfo.emailVerified;
        }
        fullName = fullName || userInfo.fullName;
        phone = phone || userInfo.phone;
      }
    }

    await ensureSupabaseReadyAndSeeded();
    const sb = getSupabaseDbClient();

    const { user: finalUser, isAdmin } = await resolveAndSyncZitadelOwnerProfile(
      {
        sub: claims.sub,
        email,
        emailVerified,
        fullName,
        phone,
        allowInsert: true,
      }
    );

    const { data: ownerShops, error: shopsLookupErr } = await sb
      .from('shops')
      .select('*')
      .eq('owner_id', finalUser.id)
      .order('created_at', { ascending: true });

    if (shopsLookupErr) {
      throw new ZitadelOidcError(
        'AUTH_SHOPS_QUERY_FAILED',
        `Không thể tải danh sách cửa hàng của tài khoản (${shopsLookupErr.message}).`,
        500
      );
    }

    let memberData: { memberShops: Shop[]; memberships: ShopMembership[] } = {
      memberShops: [],
      memberships: [],
    };
    if (!isAdmin) {
      try {
        memberData = await loadMemberShopsForCallback(
          sb,
          finalUser.id,
          new Set(((ownerShops || []) as Shop[]).map((s) => s.id))
        );
      } catch {
        // Non-fatal on callback: dashboard reloads memberships authoritatively
      }
    }

    const resolvedTarget = resolvePostLoginRoute(
      {
        isAdmin,
        shops: (ownerShops || []) as Shop[],
        memberShops: memberData.memberShops,
      },
      tx.nextPath
    );
    const redirectTo = resolvedTarget.path;

    const accessToken = issueSessionToken({
      id: finalUser.id,
      email: finalUser.email,
      role: isAdmin ? 'admin' : 'owner',
      is_admin: isAdmin,
    });

    if (reqUrl.searchParams.get('format') === 'json') {
      const jsonRes = NextResponse.json({
        user: finalUser,
        shops: (ownerShops || []) as Shop[],
        memberShops: memberData.memberShops,
        memberships: memberData.memberships,
        isAdmin,
        accessToken,
        redirectTo,
      });
      attachSessionCookie(jsonRes, accessToken);
      clearOidcTransactionCookie(jsonRes);
      return jsonRes;
    }

    const redirectUrl = new URL(redirectTo, getRequestOrigin(req));
    const res = NextResponse.redirect(redirectUrl, { status: 302 });
    attachSessionCookie(res, accessToken);
    clearOidcTransactionCookie(res);
    return res;
  } catch (err) {
    if (err instanceof ZitadelOidcError) {
      return respondCallbackError(
        req,
        reqUrl,
        err.code,
        err.message,
        err.status
      );
    }
    return respondCallbackError(
      req,
      reqUrl,
      'OIDC_CALLBACK_ERROR',
      err instanceof Error
        ? err.message
        : 'Không thể hoàn tất đăng nhập lúc này. Vui lòng thử lại.',
      500
    );
  }
}