import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  dbGetAdminAuditLogs,
  dbGetShopById,
  dbGetShopOrderAuditLogs,
  dbInsertAdminAuditLog,
  dbInsertOrderAuditLogs,
  getSupabaseDbClient,
  isOrderAuditDbConfigured,
  normalizeOrderAuditLogRecord,
  type AdminAuditLogRecord,
  type GetShopOrderAuditLogsFilter,
  type OrderAuditLogInsertRow,
} from '@/lib/db';
import { isSuperAdminEmail } from '@/lib/auth-session';
import {
  dbGetShopMemberships,
  getMembershipDbClient,
  hasShopPermission,
  isShopMembershipDbAuthoritative,
  isShopScopedStaffUserId,
  normalizeStaffUsername,
  resolveUserShopMembership,
} from '@/lib/shop-permissions';
import { verifyActiveShopStaffSession } from '@/lib/staff-accounts';
import {
  isValidUuidSub,
  verifyZitadelJwt,
  type ProfileDbRow,
} from '@/lib/zitadel-oidc';
import type {
  OrderAuditLogRecord,
  OrderAuditSubjectType,
  Profile,
  ShopMembership,
  ShopPermission,
} from '@/types/qlaok';

export const SESSION_COOKIE_NAME = 'qlaok_session';
const DEVELOPMENT_SESSION_SIGNING_SECRET = crypto.randomBytes(32).toString('base64url');
let warnedAboutDevelopmentSessionSecret = false;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const POSTGREST_JWT_DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour
export const POSTGREST_JWT_ISSUER = 'qlaok-postgrest';

export interface PostgrestAuthenticatedJwtClaims {
  sub: string;
  role: 'authenticated';
  aud: 'authenticated';
  iss: typeof POSTGREST_JWT_ISSUER;
  email?: string;
  account_type: 'owner' | 'admin';
  iat: number;
  exp: number;
}

export interface VerifiedSessionUser {
  sub: string;
  email: string;
  username?: string;
  shop_id?: string;
  account_type?: 'owner' | 'staff' | 'admin';
  sv?: number;
  role: 'admin' | 'owner' | 'cashier' | 'staff';
  iat: number;
  exp: number;
}

export function isStaffSessionUser(
  user: VerifiedSessionUser | null | undefined
): boolean {
  if (!user) return false;
  return (
    user.role === 'cashier' ||
    user.role === 'staff' ||
    user.account_type === 'staff' ||
    Boolean(user.shop_id) ||
    isShopScopedStaffUserId(user.sub)
  );
}

export function isShopBoundStaffSession(
  user: VerifiedSessionUser | null | undefined
): boolean {
  if (!user) return false;
  return (
    user.account_type === 'staff' ||
    Boolean(user.shop_id) ||
    isShopScopedStaffUserId(user.sub)
  );
}

export function isServerSigningSecretConfigured(): boolean {
  const configured = process.env.SESSION_SECRET?.trim() || '';
  return configured.length >= 16;
}

function getSigningSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.trim().length >= 16) {
    return configured.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET (at least 16 characters) is required in production.');
  }
  if (!warnedAboutDevelopmentSessionSecret) {
    console.warn('SESSION_SECRET is missing or too short; using a process-local random development secret.');
    warnedAboutDevelopmentSessionSecret = true;
  }
  return DEVELOPMENT_SESSION_SIGNING_SECRET;
}

function signBase64Url(input: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('base64url');
}

function getPostgrestJwtSigningSecret(): string | null {
  const raw =
    process.env.PGRST_JWT_SECRET || process.env.SUPABASE_JWT_SECRET || '';
  const trimmed = raw.trim();
  if (trimmed.length < 32) {
    return null;
  }
  if (
    trimmed.startsWith('sb_publishable_') ||
    trimmed.startsWith('sb_secret_') ||
    trimmed.split('.').length === 3
  ) {
    return null;
  }
  const forbiddenValues = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.EXPO_PUBLIC_SUPABASE_KEY,
    process.env.EXPO_PUBLIC_POSTGREST_ANON_KEY,
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean);
  if (forbiddenValues.includes(trimmed)) {
    return null;
  }
  return trimmed;
}

export function isPostgrestJwtSecretConfigured(): boolean {
  return getPostgrestJwtSigningSecret() !== null;
}

/**
 * Issues a short-lived, narrowly claimed HS256 JWT for standalone PostgREST (`role: 'authenticated'`).
 * - Requires a canonical UUID `sub` (never issues tokens for staff accounts or non-UUIDs).
 * - Never embeds `service_role` or privileged claims.
 * - Fails closed (`null`) if `PGRST_JWT_SECRET` / `SUPABASE_JWT_SECRET` is not configured on the server.
 */
export function issuePostgrestAuthenticatedJwt(params: {
  sub: string;
  email?: string;
  isAdmin?: boolean;
  ttlSeconds?: number;
  nowSeconds?: number;
}): { token: string; expiresAt: number; claims: PostgrestAuthenticatedJwtClaims } | null {
  if (!isValidUuidSub(params.sub) || isShopScopedStaffUserId(params.sub)) {
    return null;
  }
  const secret = getPostgrestJwtSigningSecret();
  if (!secret) {
    return null;
  }
  const nowSec =
    typeof params.nowSeconds === 'number' && Number.isFinite(params.nowSeconds)
      ? Math.floor(params.nowSeconds)
      : Math.floor(Date.now() / 1000);
  const ttl =
    typeof params.ttlSeconds === 'number' &&
    Number.isFinite(params.ttlSeconds) &&
    params.ttlSeconds > 0
      ? Math.min(Math.floor(params.ttlSeconds), DEFAULT_TTL_SECONDS)
      : POSTGREST_JWT_DEFAULT_TTL_SECONDS;
  const expiresAt = nowSec + ttl;
  const emailClean =
    typeof params.email === 'string' && params.email.trim()
      ? params.email.trim().toLowerCase()
      : undefined;

  const claims: PostgrestAuthenticatedJwtClaims = {
    sub: params.sub.trim().toLowerCase(),
    role: 'authenticated',
    aud: 'authenticated',
    iss: POSTGREST_JWT_ISSUER,
    ...(emailClean ? { email: emailClean } : {}),
    account_type: params.isAdmin ? 'admin' : 'owner',
    iat: nowSec,
    exp: expiresAt,
  };

  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'utf8'
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url'
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureB64 = signBase64Url(signingInput, secret);
  return {
    token: `${signingInput}.${signatureB64}`,
    expiresAt,
    claims,
  };
}

export function verifyPostgrestAuthenticatedJwt(
  token?: string | null,
  nowSecondsOverride?: number
): PostgrestAuthenticatedJwtClaims | null {
  if (!token || typeof token !== 'string') return null;
  const segments = token.trim().split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return null;
  }
  const secret = getPostgrestJwtSigningSecret();
  if (!secret) {
    return null;
  }

  let header: { alg?: unknown; typ?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      Buffer.from(segments[0], 'base64url').toString('utf8')
    ) as { alg?: unknown; typ?: unknown };
    payload = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (header.alg !== 'HS256') {
    return null;
  }

  const signingInput = `${segments[0]}.${segments[1]}`;
  const expectedSig = signBase64Url(signingInput, secret);
  const sigBuf = Buffer.from(segments[2], 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  const nowSec =
    typeof nowSecondsOverride === 'number' &&
    Number.isFinite(nowSecondsOverride)
      ? Math.floor(nowSecondsOverride)
      : Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN;
  const iat = typeof payload.iat === 'number' ? payload.iat : nowSec;
  if (!Number.isFinite(exp) || exp <= nowSec) {
    return null;
  }
  if (
    payload.iss !== POSTGREST_JWT_ISSUER ||
    payload.role !== 'authenticated' ||
    payload.aud !== 'authenticated' ||
    !isValidUuidSub(payload.sub) ||
    isShopScopedStaffUserId(payload.sub)
  ) {
    return null;
  }

  const emailClean =
    typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : undefined;

  return {
    sub: payload.sub.toLowerCase(),
    role: 'authenticated',
    aud: 'authenticated',
    iss: POSTGREST_JWT_ISSUER,
    ...(emailClean ? { email: emailClean } : {}),
    account_type: payload.account_type === 'admin' ? 'admin' : 'owner',
    iat,
    exp,
  };
}

export function issueSessionToken(
  user: Pick<Profile, 'id'> & {
    email?: string;
    username?: string;
    shop_id?: string;
    account_type?: 'owner' | 'staff' | 'admin';
    session_version?: number;
    sv?: number;
    role?: 'admin' | 'owner' | 'cashier' | 'staff';
    is_admin?: boolean;
  },
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const emailLower = (user.email || '').trim().toLowerCase();
  const shopIdClean =
    typeof user.shop_id === 'string' && user.shop_id.trim()
      ? user.shop_id.trim()
      : undefined;
  const usernameClean =
    typeof user.username === 'string' && user.username.trim()
      ? normalizeStaffUsername(user.username)
      : undefined;
  const isStaffScoped =
    user.account_type === 'staff' ||
    Boolean(shopIdClean) ||
    Boolean(usernameClean) ||
    isShopScopedStaffUserId(user.id);

  const isAdmin =
    !isStaffScoped &&
    (Boolean(user.is_admin) ||
      user.role === 'admin' ||
      isSuperAdminEmail(emailLower));

  const resolvedRole: VerifiedSessionUser['role'] = isStaffScoped
    ? user.role === 'cashier'
      ? 'cashier'
      : 'staff'
    : isAdmin
      ? 'admin'
      : user.role === 'cashier' || user.role === 'staff'
        ? user.role
        : 'owner';

  const svRaw = user.sv ?? user.session_version;
  const sv =
    typeof svRaw === 'number' && Number.isFinite(svRaw) && svRaw >= 1
      ? Math.floor(svRaw)
      : undefined;

  const payload: VerifiedSessionUser = {
    sub: user.id,
    email: isStaffScoped ? emailLower : emailLower,
    ...(usernameClean ? { username: usernameClean } : {}),
    ...(shopIdClean ? { shop_id: shopIdClean } : {}),
    ...(isStaffScoped ? { account_type: 'staff' as const } : {}),
    ...(sv !== undefined ? { sv } : {}),
    role: resolvedRole,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const sigB64 = signBase64Url(payloadB64, getSigningSecret());
  return `${payloadB64}.${sigB64}`;
}

export function verifySessionToken(token?: string | null): VerifiedSessionUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = signBase64Url(payloadB64, getSigningSecret());
  const sigBuf = Buffer.from(sigB64, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as VerifiedSessionUser;

    const nowSec = Math.floor(Date.now() / 1000);
    if (
      !decoded ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub ||
      typeof decoded.exp !== 'number' ||
      decoded.exp <= nowSec
    ) {
      return null;
    }

    const shopIdClean =
      typeof decoded.shop_id === 'string' && decoded.shop_id.trim()
        ? decoded.shop_id.trim()
        : undefined;
    const usernameClean =
      typeof decoded.username === 'string' && decoded.username.trim()
        ? normalizeStaffUsername(decoded.username)
        : undefined;
    const isStaffScoped =
      decoded.account_type === 'staff' ||
      Boolean(shopIdClean) ||
      Boolean(usernameClean) ||
      isShopScopedStaffUserId(decoded.sub);

    const emailClean =
      typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';

    if (isStaffScoped) {
      if (!shopIdClean || (!usernameClean && !emailClean)) {
        return null;
      }
      const staffRole: 'cashier' | 'staff' =
        decoded.role === 'cashier' ? 'cashier' : 'staff';
      return {
        ...decoded,
        email: emailClean,
        ...(usernameClean ? { username: usernameClean } : {}),
        shop_id: shopIdClean,
        account_type: 'staff',
        role: staffRole,
      };
    }

    if (!emailClean) {
      return null;
    }

    // Re-verify admin claim server-side: only authoritative super admin email or DB admin can hold role=admin
    const resolvedRole: VerifiedSessionUser['role'] =
      decoded.role === 'admin' && isSuperAdminEmail(emailClean)
        ? 'admin'
        : decoded.role === 'cashier' || decoded.role === 'staff'
          ? decoded.role
          : 'owner';

    return {
      ...decoded,
      email: emailClean,
      role: resolvedRole,
    };
  } catch {
    return null;
  }
}

export function attachSessionCookie(
  res: NextResponse,
  token: string,
  maxAgeSeconds = DEFAULT_TTL_SECONDS
): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeSeconds,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return res;
}

export function extractRequestToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return bearer;
  }

  const customHeader = req.headers.get('x-qlaok-token');
  if (customHeader && customHeader.trim()) {
    return customHeader.trim();
  }

  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const part of cookies) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const name = part.slice(0, eqIdx).trim();
      if (name === SESSION_COOKIE_NAME) {
        const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
        if (val) return val;
      }
    }
  }

  return null;
}

/**
 * Verifies the caller's identity using:
 * 1) Qlaok HMAC-signed session token (from HttpOnly cookie or Authorization: Bearer header), OR
 * 2) Verified Zitadel JWT (JWKS signature, `iss`, `aud`, `exp`, and canonical UUID `sub`)
 *    resolved against a synced `public.profiles` row.
 *
 * NEVER trusts unverified client headers (`x-admin-email`), query params, request body fields,
 * or client-supplied/token-supplied admin/email claims when resolving authority.
 */
export async function verifyRequestUser(
  req: Request
): Promise<VerifiedSessionUser | null> {
  const token = extractRequestToken(req);
  if (!token) return null;

  // 1. Check Qlaok signed HMAC token
  const verifiedHmac = verifySessionToken(token);
  if (verifiedHmac) {
    return verifiedHmac;
  }

  // 2. Verify Zitadel OIDC/OAuth2 JWT via JWKS and require a synced public.profiles row
  if (token.split('.').length !== 3) {
    return null;
  }

  try {
    const postgrestClaims = verifyPostgrestAuthenticatedJwt(token);
    const claims: { sub: string; iat?: number; exp?: number } = postgrestClaims
      ? postgrestClaims
      : await verifyZitadelJwt(token);
    if (isShopScopedStaffUserId(claims.sub)) {
      return null;
    }

    const sb = getSupabaseDbClient();
    let profileLookup = sb
      .from('profiles')
      .select('*')
      .eq(postgrestClaims ? 'id' : 'zitadel_sub', claims.sub)
      .maybeSingle();
    let { data, error } = await profileLookup;
    if (
      !postgrestClaims &&
      !error &&
      !data &&
      isValidUuidSub(claims.sub)
    ) {
      // Legacy imports can retain the original Qlaok UUID as Zitadel's sub.
      // Prefer the explicit Zitadel mapping above whenever one exists.
      profileLookup = sb
        .from('profiles')
        .select('*')
        .eq('id', claims.sub.toLowerCase())
        .maybeSingle();
      ({ data, error } = await profileLookup);
    }
    if (error) {
      return null;
    }

    const profileRow = (
      Array.isArray(data) ? data[0] : data
    ) as ProfileDbRow | null | undefined;
    if (!profileRow || typeof profileRow.id !== 'string') {
      return null;
    }

    const profileId = profileRow.id.trim().toLowerCase();
    const subjectMatchesProfile = postgrestClaims
      ? profileId === claims.sub
      : profileRow.zitadel_sub === claims.sub ||
        (!profileRow.zitadel_sub &&
          isValidUuidSub(claims.sub) &&
          profileId === claims.sub.toLowerCase());
    if (
      !isValidUuidSub(profileId) ||
      !subjectMatchesProfile ||
      isShopScopedStaffUserId(profileId)
    ) {
      return null;
    }

    if (profileRow.role === 'cashier' || profileRow.role === 'staff') {
      return null;
    }

    const emailLower =
      typeof profileRow.email === 'string'
        ? profileRow.email.trim().toLowerCase()
        : '';
    if (!emailLower) {
      return null;
    }

    const isAdmin =
      isSuperAdminEmail(emailLower) ||
      profileRow.role === 'admin' ||
      profileRow.is_admin === true;
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      // All API authorization, membership lookups, and PostgREST calls use
      // the stable Qlaok profile UUID rather than Zitadel's opaque subject.
      sub: profileId,
      email: emailLower,
      account_type: isAdmin ? 'admin' : 'owner',
      role: isAdmin ? 'admin' : 'owner',
      iat: claims.iat ?? nowSec,
      exp: claims.exp ?? nowSec + 3600,
    };
  } catch {
    return null;
  }
}

export async function requireAuthenticatedUser(req: Request): Promise<
  | { user: VerifiedSessionUser; errorResponse?: undefined }
  | { user?: undefined; errorResponse: NextResponse }
> {
  let user: VerifiedSessionUser | null = null;
  try {
    user = await verifyRequestUser(req);
  } catch (err) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Lỗi cấu hình xác thực phiên trên máy chủ.',
          code: 'SERVER_AUTH_MISCONFIGURED',
        },
        { status: 500 }
      ),
    };
  }
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        },
        { status: 401 }
      ),
    };
  }
  return { user };
}

export async function requireSuperAdmin(req: Request): Promise<
  | { user: VerifiedSessionUser; errorResponse?: undefined }
  | { user?: undefined; errorResponse: NextResponse }
> {
  let user: VerifiedSessionUser | null = null;
  try {
    user = await verifyRequestUser(req);
  } catch (err) {
    console.error('[auth] Super-admin session verification failed', err);
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Lỗi cấu hình xác thực phiên quản trị trên máy chủ.',
          code: 'SERVER_AUTH_MISCONFIGURED',
        },
        { status: 500 }
      ),
    };
  }
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Chưa xác thực phiên đăng nhập quản trị (Missing or invalid session token).',
        },
        { status: 401 }
      ),
    };
  }

  if (user.role !== 'admin' || !isSuperAdminEmail(user.email)) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Truy cập bị từ chối. Tài khoản hiện tại không có quyền Super Admin.',
        },
        { status: 403 }
      ),
    };
  }

  return { user };
}

async function lookupShopBasic(
  shopId: string
): Promise<{ id: string; owner_id: string } | null> {
  if (!shopId) return null;
  let shop: { id: string; owner_id: string } | null = null;
  if (isShopMembershipDbAuthoritative()) {
    try {
      const sb = getMembershipDbClient();
      const { data } = await sb
        .from('shops')
        .select('id, owner_id')
        .eq('id', shopId)
        .maybeSingle();
      if (data && typeof data.id === 'string') {
        shop = { id: data.id, owner_id: String(data.owner_id || '') };
      }
    } catch {
      // fail closed when authoritative DB is configured
    }
    return shop;
  }

  try {
    const found = await dbGetShopById(shopId);
    if (found) {
      shop = { id: found.id, owner_id: found.owner_id };
    }
  } catch {
    // fallback to seed shops
  }

  if (!shop) {
    const { SEED_SHOPS } = await import('@/lib/seed-data');
    const seedMatch = SEED_SHOPS.find((s) => s.id === shopId);
    if (seedMatch) {
      shop = { id: seedMatch.id, owner_id: seedMatch.owner_id };
    }
  }
  return shop;
}

export async function getRequestShopMembership(
  req: Request,
  shopId: string
): Promise<{
  user: VerifiedSessionUser | null;
  membership: ShopMembership | null;
}> {
  const user = await verifyRequestUser(req);
  if (!user || !shopId) {
    return { user: user || null, membership: null };
  }
  if (user.shop_id && user.shop_id !== shopId) {
    return { user, membership: null };
  }
  if (isShopBoundStaffSession(user)) {
    const staffCheck = await verifyActiveShopStaffSession({
      userId: user.sub,
      shopId,
      sessionVersion: user.sv,
    });
    return {
      user,
      membership: staffCheck.active ? staffCheck.membership : null,
    };
  }
  const shop = await lookupShopBasic(shopId);
  const membership = await resolveUserShopMembership({
    userId: user.sub,
    shopId,
    isSuperAdmin: user.role === 'admin',
    shopOwnerId: shop?.owner_id ?? null,
  });
  return { user, membership };
}

export async function requireShopPermission(
  req: Request,
  shopId: string,
  requiredPermissions: ShopPermission | ShopPermission[]
): Promise<
  | {
      user: VerifiedSessionUser;
      membership: ShopMembership;
      errorResponse?: undefined;
    }
  | {
      user?: undefined;
      membership?: undefined;
      errorResponse: NextResponse;
    }
> {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth;
  const { user } = auth;

  if (!shopId) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shopId).' },
        { status: 400 }
      ),
    };
  }

  if (user.shop_id && user.shop_id !== shopId) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Tài khoản nhân viên chỉ được phép truy cập vào cửa hàng đã được phân công.',
          code: 'FORBIDDEN_CROSS_SHOP_ACCESS',
        },
        { status: 403 }
      ),
    };
  }

  const shop = await lookupShopBasic(shopId);
  if (!shop && user.role !== 'admin') {
    return {
      errorResponse: NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.' },
        { status: 404 }
      ),
    };
  }

  let membership: ShopMembership | null = null;
  if (isShopBoundStaffSession(user)) {
    const staffCheck = await verifyActiveShopStaffSession({
      userId: user.sub,
      shopId,
      sessionVersion: user.sv,
    });
    membership = staffCheck.active ? staffCheck.membership : null;
  } else {
    membership = await resolveUserShopMembership({
      userId: user.sub,
      shopId,
      isSuperAdmin: user.role === 'admin',
      shopOwnerId: shop?.owner_id ?? null,
    });
  }

  if (!membership || !membership.is_active) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Bạn không có quyền truy cập hoặc chỉnh sửa dữ liệu của cửa hàng này.',
        },
        { status: 403 }
      ),
    };
  }

  if (!hasShopPermission(membership, requiredPermissions)) {
    const requiredList = Array.isArray(requiredPermissions)
      ? requiredPermissions.join(', ')
      : requiredPermissions;
    return {
      errorResponse: NextResponse.json(
        {
          error: `Tài khoản (${membership.role}) không có quyền thực hiện thao tác này (cần quyền: ${requiredList}).`,
          code: 'INSUFFICIENT_SHOP_PERMISSION',
          role: membership.role,
          requiredPermissions: Array.isArray(requiredPermissions)
            ? requiredPermissions
            : [requiredPermissions],
        },
        { status: 403 }
      ),
    };
  }

  return { user, membership };
}

export async function requireShopOwnerOrAdmin(
  req: Request,
  shopId: string
): Promise<
  | { user: VerifiedSessionUser; errorResponse?: undefined }
  | { user?: undefined; errorResponse: NextResponse }
> {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth;
  const { user } = auth;

  if (isStaffSessionUser(user)) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Tài khoản nhân viên không có quyền thực hiện thao tác dành riêng cho chủ quán.',
          code: 'FORBIDDEN_STAFF_OWNER_ACTION',
        },
        { status: 403 }
      ),
    };
  }

  if (user.role === 'admin') {
    return { user };
  }

  if (!shopId) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shopId).' },
        { status: 400 }
      ),
    };
  }

  const shop = await lookupShopBasic(shopId);
  if (!shop) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.' },
        { status: 404 }
      ),
    };
  }

  const explicitMemberships = await dbGetShopMemberships(shopId);
  const explicitRow = explicitMemberships.find((m) => m.user_id === user.sub);
  if (explicitRow && !explicitRow.is_active) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Tài khoản chủ quán hiện đang bị vô hiệu hóa tại cửa hàng này.',
        },
        { status: 403 }
      ),
    };
  }

  if (shop.owner_id !== user.sub) {
    const membership = await resolveUserShopMembership({
      userId: user.sub,
      shopId,
      isSuperAdmin: false,
      shopOwnerId: shop.owner_id,
    });
    if (!membership || membership.role !== 'owner' || !membership.is_active) {
      return {
        errorResponse: NextResponse.json(
          {
            error:
              'Bạn không có quyền truy cập hoặc chỉnh sửa dữ liệu của cửa hàng này.',
          },
          { status: 403 }
        ),
      };
    }
  }

  return { user };
}

export async function requireActiveShopOwner(
  req: Request,
  shopId: string
): Promise<
  | { user: VerifiedSessionUser; errorResponse?: undefined }
  | { user?: undefined; errorResponse: NextResponse }
> {
  const auth = await requireAuthenticatedUser(req);
  if (auth.errorResponse) return auth;
  const { user } = auth;

  if (isStaffSessionUser(user) || user.role === 'admin') {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Chỉ chủ quán đang hoạt động của cửa hàng này mới được phép tạo hoặc quản lý tài khoản nhân viên.',
          code: 'FORBIDDEN_NOT_ACTIVE_SHOP_OWNER',
        },
        { status: 403 }
      ),
    };
  }

  if (!shopId) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Thiếu mã cửa hàng (shopId).' },
        { status: 400 }
      ),
    };
  }

  const shop = await lookupShopBasic(shopId);
  if (!shop) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.' },
        { status: 404 }
      ),
    };
  }

  const explicitMemberships = await dbGetShopMemberships(shopId);
  const explicitRow = explicitMemberships.find((m) => m.user_id === user.sub);
  if (explicitRow && !explicitRow.is_active) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Tài khoản chủ quán hiện đang bị vô hiệu hóa tại cửa hàng này.',
          code: 'FORBIDDEN_INACTIVE_SHOP_OWNER',
        },
        { status: 403 }
      ),
    };
  }

  const isTrueOwner = shop.owner_id === user.sub;
  const isExplicitActiveOwner =
    Boolean(explicitRow) &&
    explicitRow?.role === 'owner' &&
    explicitRow?.is_active === true &&
    !explicitRow?.username &&
    !isShopScopedStaffUserId(user.sub);

  if (!isTrueOwner && !isExplicitActiveOwner) {
    return {
      errorResponse: NextResponse.json(
        {
          error:
            'Chỉ chủ quán đang hoạt động của cửa hàng này mới được phép tạo hoặc quản lý tài khoản nhân viên.',
          code: 'FORBIDDEN_NOT_ACTIVE_SHOP_OWNER',
        },
        { status: 403 }
      ),
    };
  }

  return { user };
}

const AUDIT_LOG_FILE = path.join(
  process.cwd(),
  '.local-db',
  'admin-audit.log.jsonl'
);
const MAX_AUDIT_LOG_BYTES = 5 * 1024 * 1024;

function appendPrivateAuditRecord(
  targetFile: string,
  payload: Record<string, unknown>,
  label: string
): boolean {
  let fd: number | null = null;
  try {
    const dir = path.dirname(targetFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size >= MAX_AUDIT_LOG_BYTES) {
      const rotatedFile = `${targetFile}.1`;
      if (fs.existsSync(rotatedFile)) fs.unlinkSync(rotatedFile);
      fs.renameSync(targetFile, rotatedFile);
      fs.chmodSync(rotatedFile, 0o600);
    }

    fd = fs.openSync(
      targetFile,
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, `${JSON.stringify(payload)}\n`, undefined, 'utf8');
    return true;
  } catch (error) {
    console.error(`Failed to append ${label} audit record:`, error);
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        console.error(`Failed to close ${label} audit log:`, error);
      }
    }
  }
}

export async function recordAdminAuditLog(entry: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  const createdAt = new Date().toISOString();
  const targetFile = testAdminAuditLogFileOverride || AUDIT_LOG_FILE;
  const row: AdminAuditLogRecord = {
    id: crypto.randomUUID(),
    actor_user_id: String(entry.actorId || '').trim() || 'system',
    actor_email: String(entry.actorEmail || '').trim().toLowerCase(),
    action: String(entry.action || '').trim(),
    target_id:
      typeof entry.targetId === 'string' && entry.targetId.trim()
        ? entry.targetId.trim()
        : null,
    details: sanitizeAuditRecordObject(entry.details),
    created_at: createdAt,
  };

  if (!row.action) {
    console.error('ADMIN_AUDIT_WRITE_FAILED', {
      code: 'ADMIN_AUDIT_INVALID_ACTION',
      backupWritten: false,
    });
    return false;
  }

  if (isOrderAuditDbConfigured()) {
    try {
      await dbInsertAdminAuditLog(row);
      return true;
    } catch {
      const backupWritten = appendPrivateAuditRecord(
        targetFile,
        {
          ...row,
          timestamp: row.created_at,
          actorId: row.actor_user_id,
          actorEmail: row.actor_email,
          targetId: row.target_id,
        },
        'admin'
      );
      console.error('ADMIN_AUDIT_WRITE_FAILED', {
        code: 'ADMIN_AUDIT_DB_WRITE_FAILED',
        backupWritten,
      });
      return false;
    }
  }

  const backupWritten = appendPrivateAuditRecord(
    targetFile,
    {
      ...row,
      timestamp: row.created_at,
      actorId: row.actor_user_id,
      actorEmail: row.actor_email,
      targetId: row.target_id,
    },
    'admin'
  );
  if (process.env.NODE_ENV === 'production') {
    console.error('ADMIN_AUDIT_WRITE_FAILED', {
      code: 'ADMIN_AUDIT_DB_UNAVAILABLE',
      backupWritten,
    });
    return false;
  }
  return backupWritten;
}

export function readAdminAuditLog(limit = 200): Record<string, unknown>[] {
  const targetFile = testAdminAuditLogFileOverride || AUDIT_LOG_FILE;
  const safeLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.floor(limit)))
    : 200;
  try {
    const lines = [`${targetFile}.1`, targetFile]
      .flatMap((file) => {
        try {
          return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            throw error;
          }
          return [];
        }
      })
      .slice(-safeLimit);
    return lines.flatMap((line) => {
      try {
        const entry = JSON.parse(line) as unknown;
        return entry && typeof entry === 'object' && !Array.isArray(entry)
          ? [entry as Record<string, unknown>]
          : [];
      } catch {
        return [];
      }
    }).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error('Failed to read admin audit log:', error);
    }
    return [];
  }
}

function normalizeAdminAuditBackupRecord(
  raw: Record<string, unknown>
): AdminAuditLogRecord | null {
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!action) return null;

  const createdAt =
    typeof raw.created_at === 'string'
      ? raw.created_at
      : typeof raw.timestamp === 'string'
        ? raw.timestamp
        : new Date(0).toISOString();
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `legacy-${crypto
          .createHash('sha256')
          .update(JSON.stringify(raw))
          .digest('hex')
          .slice(0, 24)}`;

  return {
    id,
    actor_user_id:
      typeof raw.actor_user_id === 'string'
        ? raw.actor_user_id
        : typeof raw.actorId === 'string'
          ? raw.actorId
          : 'system',
    actor_email:
      typeof raw.actor_email === 'string'
        ? raw.actor_email
        : typeof raw.actorEmail === 'string'
          ? raw.actorEmail
          : '',
    action,
    target_id:
      typeof raw.target_id === 'string'
        ? raw.target_id
        : typeof raw.targetId === 'string'
          ? raw.targetId
          : null,
    details: sanitizeAuditRecordObject(
      raw.details as Record<string, unknown> | null | undefined
    ),
    created_at: createdAt,
  };
}

export async function queryAdminAuditLogs(
  limit = 100
): Promise<AdminAuditLogRecord[]> {
  const clampedLimit = Math.min(
    500,
    Math.max(1, Math.trunc(Number(limit) || 100))
  );

  if (!isOrderAuditDbConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_AUDIT_DB_UNAVAILABLE');
    }
    return readAdminAuditLog(clampedLimit).flatMap((raw) => {
      const normalized = normalizeAdminAuditBackupRecord(raw);
      return normalized ? [normalized] : [];
    });
  }

  const databaseRows = await dbGetAdminAuditLogs(clampedLimit);
  const seenIds = new Set(databaseRows.map((row) => row.id));
  const backupRows = readAdminAuditLog(500).flatMap((raw) => {
    const normalized = normalizeAdminAuditBackupRecord(raw);
    if (!normalized || seenIds.has(normalized.id)) return [];
    seenIds.add(normalized.id);
    return [normalized];
  });

  return [...databaseRows, ...backupRows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, clampedLimit);
}

const ORDER_AUDIT_LOG_FILE = path.join(
  process.cwd(),
  '.local-db',
  'order-audit.log.jsonl'
);

let testOrderAuditLogFileOverride: string | null = null;
let testAdminAuditLogFileOverride: string | null = null;

export function setAdminAuditLogFileForTests(pathOverride: string | null): void {
  testAdminAuditLogFileOverride = pathOverride;
}

export function setOrderAuditLogFileForTests(pathOverride: string | null): void {
  testOrderAuditLogFileOverride = pathOverride;
}

const SENSITIVE_AUDIT_KEY_PATTERN =
  /^(?:password|pass|secret|secret_ciphertext|secret_iv|secret_tag|token|access_token|refresh_token|id_token|tracking_token|service_role|service_role_key|api_key|private_key|authorization|cookie|set-cookie|sepay_secret|sepaysecret)$/i;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = k
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
      if (SENSITIVE_AUDIT_KEY_PATTERN.test(normalizedKey)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeAuditValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function sanitizeAuditRecordObject(
  input?: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return sanitizeAuditValue(input, 0) as Record<string, unknown>;
}

function extractCleanAuditSubjectIds(
  raw: string | readonly string[] | null | undefined
): string[] {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        parts.push(...item.split(','));
      }
    }
  } else if (typeof raw === 'string') {
    parts.push(...raw.split(','));
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export interface RecordOrderAuditLogEntry {
  id?: string;
  shopId: string;
  orderId?: string | readonly string[] | null;
  serviceRequestId?: string | null;
  subjectType?: OrderAuditSubjectType;
  subjectId?: string | readonly string[] | null;
  actorId: string;
  actorRole?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
  reason?: string | null;
}

export async function recordOrderAuditLog(
  entry: RecordOrderAuditLogEntry
): Promise<boolean> {
  const targetFile = testOrderAuditLogFileOverride || ORDER_AUDIT_LOG_FILE;
  const cleanShopId = String(entry.shopId || '').trim();
  const cleanAction = String(entry.action || '').trim();
  const cleanActorId = String(entry.actorId || '').trim() || 'system';
  const cleanActorRole =
    typeof entry.actorRole === 'string' && entry.actorRole.trim()
      ? entry.actorRole.trim()
      : 'system';

  const hasExplicitServiceRequestId =
    typeof entry.serviceRequestId === 'string' &&
    entry.serviceRequestId.trim().length > 0;
  const hasExplicitOrderId =
    extractCleanAuditSubjectIds(entry.orderId).length > 0;

  const resolvedSubjectType: OrderAuditSubjectType =
    entry.subjectType === 'service_request' ||
    (!entry.subjectType && hasExplicitServiceRequestId && !hasExplicitOrderId)
      ? 'service_request'
      : 'order';

  const targetSubjectIds = (
    resolvedSubjectType === 'service_request'
      ? [entry.serviceRequestId, entry.subjectId, entry.orderId]
      : [entry.orderId, entry.subjectId]
  )
    .map((candidate) => extractCleanAuditSubjectIds(candidate))
    .find((candidateIds) => candidateIds.length > 0) || [];

  if (!cleanShopId || !cleanAction || targetSubjectIds.length === 0) {
    console.error('ORDER_AUDIT_WRITE_FAILED', {
      code: 'ORDER_AUDIT_INVALID_SUBJECT',
      shopId: cleanShopId || null,
      subjectType: resolvedSubjectType,
      subjectCount: targetSubjectIds.length,
      action: cleanAction || null,
    });
    return false;
  }

  const sanitizedBefore = sanitizeAuditRecordObject(entry.before);
  const sanitizedAfter = sanitizeAuditRecordObject(entry.after);
  const sanitizedDetails = sanitizeAuditRecordObject(entry.details);
  const explicitReason =
    typeof entry.reason === 'string' && entry.reason.trim()
      ? entry.reason.trim()
      : typeof sanitizedDetails?.reason === 'string' &&
          sanitizedDetails.reason.trim()
        ? sanitizedDetails.reason.trim()
        : typeof sanitizedAfter?.refund_reason === 'string' &&
            sanitizedAfter.refund_reason.trim()
          ? sanitizedAfter.refund_reason.trim()
          : typeof sanitizedAfter?.cancelled_reason === 'string' &&
              sanitizedAfter.cancelled_reason.trim()
            ? sanitizedAfter.cancelled_reason.trim()
            : typeof sanitizedAfter?.cancel_reason === 'string' &&
                sanitizedAfter.cancel_reason.trim()
              ? sanitizedAfter.cancel_reason.trim()
              : null;

  const nowIso = new Date().toISOString();
  const baseExplicitId =
    typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;

  const dbRows: OrderAuditLogInsertRow[] = [];
  const localPayloads: Record<string, unknown>[] = [];

  for (let idx = 0; idx < targetSubjectIds.length; idx += 1) {
    const subjectId = targetSubjectIds[idx]!;
    const rowId = baseExplicitId
      ? targetSubjectIds.length === 1
        ? baseExplicitId
        : `${baseExplicitId}-${idx + 1}`
      : typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${idx}`;

    const orderIdValue = resolvedSubjectType === 'order' ? subjectId : null;
    const serviceRequestIdValue =
      resolvedSubjectType === 'service_request' ? subjectId : null;

    dbRows.push({
      id: rowId,
      shop_id: cleanShopId,
      subject_type: resolvedSubjectType,
      subject_id: subjectId,
      order_id: orderIdValue,
      service_request_id: serviceRequestIdValue,
      actor_id: cleanActorId,
      actor_role: cleanActorRole,
      action: cleanAction,
      before_state: sanitizedBefore,
      after_state: sanitizedAfter,
      details: sanitizedDetails,
      reason: explicitReason,
      created_at: nowIso,
      allowDuplicateIdSkip: Boolean(baseExplicitId),
    });

    const localPayload: Record<string, unknown> = {
      id: rowId,
      timestamp: nowIso,
      created_at: nowIso,
      shopId: cleanShopId,
      shop_id: cleanShopId,
      subjectType: resolvedSubjectType,
      subject_type: resolvedSubjectType,
      subjectId,
      subject_id: subjectId,
      orderId: orderIdValue,
      order_id: orderIdValue,
      serviceRequestId: serviceRequestIdValue,
      service_request_id: serviceRequestIdValue,
      actorId: cleanActorId,
      actor_id: cleanActorId,
      actor_user_id: cleanActorId,
      actorRole: cleanActorRole,
      actor_role: cleanActorRole,
      action: cleanAction,
      before: sanitizedBefore,
      before_state: sanitizedBefore,
      previous_state: sanitizedBefore,
      after: sanitizedAfter,
      after_state: sanitizedAfter,
      next_state: sanitizedAfter,
      details: sanitizedDetails,
      reason: explicitReason,
    };

    localPayloads.push(localPayload);
  }

  // Local JSONL is a private fallback only: it is written when the DB is
  // unconfigured or the DB insert fails, never after a successful DB insert.
  const writeLocalFallback = (): boolean => {
    let allWritten = true;
    for (const payload of localPayloads) {
      if (!appendPrivateAuditRecord(targetFile, payload, 'order')) {
        allWritten = false;
      }
    }
    return allWritten;
  };

  if (isOrderAuditDbConfigured()) {
    try {
      await dbInsertOrderAuditLogs(dbRows);
      return true;
    } catch {
      const localWriteSucceeded = writeLocalFallback();
      console.error('ORDER_AUDIT_WRITE_FAILED', {
        code: 'ORDER_AUDIT_DB_WRITE_FAILED',
        shopId: cleanShopId,
        subjectType: resolvedSubjectType,
        subjectIds: targetSubjectIds,
        action: cleanAction,
        localBackupWritten: localWriteSucceeded,
      });
      return false;
    }
  }

  const localWriteSucceeded = writeLocalFallback();

  if (process.env.NODE_ENV === 'production') {
    console.error('ORDER_AUDIT_WRITE_FAILED', {
      code: 'ORDER_AUDIT_DB_UNAVAILABLE',
      localBackupWritten: localWriteSucceeded,
    });
    return false;
  }

  if (!localWriteSucceeded) {
    console.error('ORDER_AUDIT_WRITE_FAILED', {
      code: 'ORDER_AUDIT_LOCAL_WRITE_FAILED',
      shopId: cleanShopId,
      subjectType: resolvedSubjectType,
      subjectIds: targetSubjectIds,
      action: cleanAction,
    });
    return false;
  }

  return true;
}

export function readOrderAuditLog(limit = 200): OrderAuditLogRecord[] {
  const targetFile = testOrderAuditLogFileOverride || ORDER_AUDIT_LOG_FILE;
  const safeLimit = Number.isFinite(limit)
    ? Math.min(2000, Math.max(1, Math.floor(limit)))
    : 200;
  try {
    const lines = fs
      .readFileSync(targetFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-safeLimit);
    return lines
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as unknown;
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return [];
          }
          const raw = entry as Record<string, unknown>;
          return [
            normalizeOrderAuditLogRecord({
              id: raw.id ?? `local-${ String(raw.timestamp || '') }`,
              shop_id: raw.shop_id ?? raw.shopId ?? '',
              subject_type: raw.subject_type ?? raw.subjectType ?? undefined,
              subject_id: raw.subject_id ?? raw.subjectId ?? undefined,
              order_id: raw.order_id ?? raw.orderId ?? null,
              service_request_id:
                raw.service_request_id ?? raw.serviceRequestId ?? null,
              actor_user_id:
                raw.actor_user_id ?? raw.actor_id ?? raw.actorId ?? 'system',
              actor_id:
                raw.actor_user_id ?? raw.actor_id ?? raw.actorId ?? 'system',
              actor_role: raw.actor_role ?? raw.actorRole ?? null,
              action: raw.action ?? '',
              previous_state:
                raw.previous_state ?? raw.before_state ?? raw.before ?? null,
              next_state:
                raw.next_state ?? raw.after_state ?? raw.after ?? null,
              before_state:
                raw.previous_state ?? raw.before_state ?? raw.before ?? null,
              after_state:
                raw.next_state ?? raw.after_state ?? raw.after ?? null,
              details: raw.details ?? null,
              reason: raw.reason ?? null,
              created_at: raw.created_at ?? raw.timestamp ?? '',
            }),
          ];
        } catch {
          return [];
        }
      })
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error('Failed to read order audit log:', error);
    }
    return [];
  }
}

export async function queryOrderAuditLogs(
  filter: GetShopOrderAuditLogsFilter
): Promise<OrderAuditLogRecord[]> {
  const cleanShopId = (filter.shopId || '').trim();
  if (!cleanShopId) {
    throw new Error('SHOP_ID_REQUIRED: Thiếu mã cửa hàng (shopId).');
  }

  if (isOrderAuditDbConfigured()) {
    return dbGetShopOrderAuditLogs(filter);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ORDER_AUDIT_DB_UNAVAILABLE');
  }

  const clampedLimit = Math.min(
    200,
    Math.max(1, Math.trunc(Number(filter.limit) || 100))
  );
  const cleanSubjectType = filter.subjectType?.trim() as
    | OrderAuditSubjectType
    | undefined;
  const cleanSubjectId = filter.subjectId?.trim() || null;
  const cleanOrderId = filter.orderId?.trim() || null;
  const cleanServiceRequestId = filter.serviceRequestId?.trim() || null;
  const cleanAction = filter.action?.trim() || null;

  const localRecords = readOrderAuditLog(2000);
  const seenIds = new Set<string>();
  const filtered: OrderAuditLogRecord[] = [];

  for (const record of localRecords) {
    if (record.id && seenIds.has(record.id)) {
      continue;
    }
    if (record.shop_id !== cleanShopId) continue;
    if (cleanSubjectType && record.subject_type !== cleanSubjectType) continue;
    if (cleanSubjectId && record.subject_id !== cleanSubjectId) continue;
    if (cleanOrderId && record.order_id !== cleanOrderId) continue;
    if (
      cleanServiceRequestId &&
      record.service_request_id !== cleanServiceRequestId
    ) {
      continue;
    }
    if (cleanAction && record.action !== cleanAction) continue;
    if (record.id) {
      seenIds.add(record.id);
    }
    filtered.push(record);
    if (filtered.length >= clampedLimit) break;
  }

  return filtered;
}
