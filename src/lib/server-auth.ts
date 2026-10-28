import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { dbGetShopById, getSupabaseDbClient } from '@/lib/db';
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
import type { Profile, ShopMembership, ShopPermission } from '@/types/qlaok';

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
): void {
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
  } catch (error) {
    console.error(`Failed to append ${label} audit record:`, error);
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

export function recordAdminAuditLog(entry: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): void {
  appendPrivateAuditRecord(
    AUDIT_LOG_FILE,
    { timestamp: new Date().toISOString(), ...entry },
    'admin'
  );
}

export function readAdminAuditLog(limit = 200): Record<string, unknown>[] {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.floor(limit)))
    : 200;
  try {
    const lines = fs
      .readFileSync(AUDIT_LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
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

const ORDER_AUDIT_LOG_FILE = path.join(
  process.cwd(),
  '.local-db',
  'order-audit.log.jsonl'
);

let testOrderAuditLogFileOverride: string | null = null;

export function setOrderAuditLogFileForTests(path: string | null): void {
  testOrderAuditLogFileOverride = path;
}

export function recordOrderAuditLog(entry: {
  shopId: string;
  orderId: string;
  actorId: string;
  actorRole?: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  details?: Record<string, unknown>;
}): void {
  const targetFile = testOrderAuditLogFileOverride || ORDER_AUDIT_LOG_FILE;
  appendPrivateAuditRecord(
    targetFile,
    { timestamp: new Date().toISOString(), ...entry },
    'order'
  );
}
