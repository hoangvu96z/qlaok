import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getSupabaseDbClient } from '@/lib/db';
import { isSuperAdminEmail, SUPER_ADMIN_ID } from '@/lib/auth-session';
import {
  hasShopPermission,
  resolveUserShopMembership,
} from '@/lib/shop-permissions';
import type { Profile, ShopMembership, ShopPermission } from '@/types/qlaok';

export const SESSION_COOKIE_NAME = 'qlaok_session';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface VerifiedSessionUser {
  sub: string;
  email: string;
  role: 'admin' | 'owner' | 'cashier' | 'staff';
  iat: number;
  exp: number;
}

export function isServerSigningSecretConfigured(): boolean {
  const configured =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.PAYMENT_WEBHOOK_SECRET;
  return Boolean(configured && configured.trim().length >= 16);
}

function getSigningSecret(): string {
  const configured =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.PAYMENT_WEBHOOK_SECRET;
  if (configured && configured.trim().length >= 16) {
    return configured.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET (at least 16 characters) is required in production.');
  }
  // Deterministic fallback for local dev/test environments without SESSION_SECRET
  return 'qlaok-server-hmac-secret-key-v2-do-not-share-in-client';
}

function signBase64Url(input: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(input)
    .digest('base64url');
}

export function issueSessionToken(
  user: Pick<Profile, 'id' | 'email'> & {
    role?: 'admin' | 'owner' | 'cashier' | 'staff';
    is_admin?: boolean;
  },
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const emailLower = (user.email || '').trim().toLowerCase();
  const isAdmin =
    Boolean(user.is_admin) ||
    user.role === 'admin' ||
    isSuperAdminEmail(emailLower);

  const resolvedRole: VerifiedSessionUser['role'] = isAdmin
    ? 'admin'
    : user.role === 'cashier' || user.role === 'staff'
      ? user.role
      : 'owner';

  const payload: VerifiedSessionUser = {
    sub: user.id,
    email: emailLower,
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
      typeof decoded.email !== 'string' ||
      !decoded.email ||
      typeof decoded.exp !== 'number' ||
      decoded.exp <= nowSec
    ) {
      return null;
    }

    // Re-verify admin claim server-side: only authoritative super admin email or DB admin can hold role=admin
    const resolvedRole: VerifiedSessionUser['role'] =
      decoded.role === 'admin' && isSuperAdminEmail(decoded.email)
        ? 'admin'
        : decoded.role === 'cashier' || decoded.role === 'staff'
          ? decoded.role
          : 'owner';

    return {
      ...decoded,
      email: decoded.email.trim().toLowerCase(),
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
 * 2) Supabase Auth JWT verified on the server via `sb.auth.getUser(token)`.
 *
 * NEVER trusts unverified client headers (`x-admin-email`), query params, or request body fields.
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

  // 2. Fallback: verify Supabase JWT access token directly with Supabase Auth server
  try {
    const sb = getSupabaseDbClient();
    const { data, error } = await sb.auth.getUser(token);
    if (!error && data?.user?.email) {
      const emailLower = data.user.email.trim().toLowerCase();
      const isAdmin = isSuperAdminEmail(emailLower);
      const nowSec = Math.floor(Date.now() / 1000);
      return {
        sub: isAdmin ? SUPER_ADMIN_ID : data.user.id,
        email: emailLower,
        role: isAdmin ? 'admin' : 'owner',
        iat: nowSec,
        exp: nowSec + 3600,
      };
    }
  } catch {
    // ignore invalid JWT
  }

  return null;
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
    return {
      errorResponse: NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Lỗi cấu hình xác thực phiên quản trị trên máy chủ.',
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
  try {
    const sb = getSupabaseDbClient();
    const { data } = await sb
      .from('shops')
      .select('id, owner_id')
      .eq('id', shopId)
      .maybeSingle();
    shop = data;
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

  const shop = await lookupShopBasic(shopId);
  if (!shop && user.role !== 'admin') {
    return {
      errorResponse: NextResponse.json(
        { error: 'Không tìm thấy cửa hàng.' },
        { status: 404 }
      ),
    };
  }

  const membership = await resolveUserShopMembership({
    userId: user.sub,
    shopId,
    isSuperAdmin: user.role === 'admin',
    shopOwnerId: shop?.owner_id ?? null,
  });

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

const AUDIT_LOG_FILE = path.join(
  process.cwd(),
  '.local-db',
  'admin-audit.log.jsonl'
);

export function recordAdminAuditLog(entry: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): void {
  try {
    const dir = path.dirname(AUDIT_LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore fs write error in read-only containers
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
  try {
    const targetFile = testOrderAuditLogFileOverride || ORDER_AUDIT_LOG_FILE;
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(
      targetFile,
      `${JSON.stringify(payload)}\n`,
      'utf8'
    );
  } catch {
    // ignore fs write error in read-only containers
  }
}
