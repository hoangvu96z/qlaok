import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, Shop, ShopMembership, ShopPermission } from '@/types/qlaok';
import { hashPassword, verifyPassword } from './auth-credentials';
import { dbGetShopById, dbGetStorefrontBundle } from './db';
import {
  ALLOWED_STAFF_PERMISSIONS,
  dbDeleteShopMembership,
  dbGetShopMemberships,
  dbUpsertShopMembership,
  getMembershipDbClient,
  isShopMembershipDbAuthoritative,
  isShopScopedStaffUserId,
  isValidStaffUsername,
  normalizeMembershipRow,
  normalizeStaffUsername,
  OWNER_ONLY_SHOP_PERMISSIONS,
  validateStaffPermissionsInput,
  validateStaffRole,
} from './shop-permissions';

export interface StaffCredentialRecord {
  user_id: string;
  shop_id: string;
  username: string;
  password_hash: string;
  full_name: string | null;
  role: 'cashier' | 'staff';
  is_active: boolean;
  session_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface StaffLoginRateLimitRecord {
  bucket_key: string;
  failure_count: number;
  window_started_at: string;
  last_failed_at: string;
  blocked_until: string | null;
  expires_at: string;
  updated_at: string;
}

export interface StaffLoginRateLimitCheckResult {
  allowed: boolean;
  failureCount: number;
  retryAfterSec: number;
  blockedUntil: string | null;
}

const MIN_STAFF_PASSWORD_LENGTH = 6;
const MAX_STAFF_PASSWORD_LENGTH = 128;

export const STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const STAFF_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const STAFF_LOGIN_RATE_LIMIT_BLOCK_SECONDS = 15 * 60;
export const STAFF_LOGIN_RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60;

const STAFF_RATE_LIMIT_BUCKET_KEY_REGEX = /^rl-staff-[0-9a-f]{64}$/;

// Precomputed salted scrypt hash used for constant-time verification when a
// target shop or username does not exist, preventing user/shop enumeration.
const DUMMY_STAFF_PASSWORD_HASH = hashPassword(
  'qlaok-constant-time-dummy-staff-password'
);

// Ephemeral in-memory stores used ONLY in non-production local/test runs when
// Supabase is unconfigured. Never persisted to .local-db or disk, and never
// used in production.
const inMemoryStaffCredentialsByUserId = new Map<
  string,
  StaffCredentialRecord
>();
const inMemoryStaffLoginRateLimits = new Map<
  string,
  StaffLoginRateLimitRecord
>();

let staffRateLimitClockOverrideForTest: (() => number) | null = null;
let dummyStaffPasswordVerificationCountForTest = 0;

export function setStaffLoginRateLimitClockForTest(
  clockFn: (() => number) | null
): void {
  staffRateLimitClockOverrideForTest = clockFn;
}

export function getDummyStaffPasswordVerificationCountForTest(): number {
  return dummyStaffPasswordVerificationCountForTest;
}

function runDummyStaffPasswordVerification(rawPassword: string): void {
  dummyStaffPasswordVerificationCountForTest += 1;
  verifyPassword(rawPassword || 'invalid', DUMMY_STAFF_PASSWORD_HASH);
}

function getRateLimitNowMs(): number {
  if (staffRateLimitClockOverrideForTest) {
    return staffRateLimitClockOverrideForTest();
  }
  return Date.now();
}

export function clearInMemoryStaffCredentialsForTest(): void {
  inMemoryStaffCredentialsByUserId.clear();
  inMemoryStaffLoginRateLimits.clear();
  staffRateLimitClockOverrideForTest = null;
  dummyStaffPasswordVerificationCountForTest = 0;
}

function assertStaffStorageAvailable(): 'db' | 'memory' {
  if (isShopMembershipDbAuthoritative()) {
    return 'db';
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'STAFF_CREDENTIALS_DB_UNAVAILABLE: Không thể lưu trữ hoặc xác thực tài khoản nhân viên khi chưa cấu hình cơ sở dữ liệu bảo mật.'
    );
  }
  return 'memory';
}

type RpcCapableClient = SupabaseClient & {
  rpc?: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

function isMissingRpcFunctionError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return (
    code === 'PGRST202' ||
    /Could not find the function|function .* does not exist|unexpected rpc/i.test(
      msg
    )
  );
}

function normalizeStaffRpcError(
  rpcErr: { message?: string; code?: string },
  fallbackCode: string,
  fallbackMessage: string,
  username?: string
): Error {
  const rawMsg = String(rpcErr.message || '').trim();
  const rawCode = String(rpcErr.code || '').trim();

  if (
    rawCode === '23505' ||
    /STAFF_USERNAME_EXISTS|duplicate key|unique constraint/i.test(rawMsg)
  ) {
    const cleanUser = username || '';
    return new Error(
      `STAFF_USERNAME_EXISTS: Tên đăng nhập "${cleanUser}" đã tồn tại trong cửa hàng này.`
    );
  }

  if (/FORBIDDEN_STAFF_MEMBER_MANAGE_PERMISSION/i.test(rawMsg)) {
    return new Error(
      'FORBIDDEN_STAFF_PERMISSION: Không được phép cấp quyền quản lý nhân sự cho tài khoản nhân viên.'
    );
  }

  const codeMatch = rawMsg.match(/^([A-Z0-9_]+):\s*(.+)$/);
  if (codeMatch?.[1] && codeMatch?.[2]) {
    return new Error(`${codeMatch[1]}: ${codeMatch[2]}`);
  }

  return new Error(`${fallbackCode}: ${rawMsg || fallbackMessage}`);
}

export function validateStaffPassword(
  rawPassword: unknown
): { ok: true; password: string } | { ok: false; errorCode: string; message: string } {
  if (typeof rawPassword !== 'string') {
    return {
      ok: false,
      errorCode: 'WEAK_PASSWORD',
      message: `Mật khẩu nhân viên phải có tối thiểu ${MIN_STAFF_PASSWORD_LENGTH} ký tự.`,
    };
  }
  const trimmed = rawPassword.trim();
  if (trimmed.length < MIN_STAFF_PASSWORD_LENGTH) {
    return {
      ok: false,
      errorCode: 'WEAK_PASSWORD',
      message: `Mật khẩu nhân viên phải có tối thiểu ${MIN_STAFF_PASSWORD_LENGTH} ký tự.`,
    };
  }
  if (rawPassword.length > MAX_STAFF_PASSWORD_LENGTH) {
    return {
      ok: false,
      errorCode: 'INVALID_PASSWORD',
      message: `Mật khẩu nhân viên không được vượt quá ${MAX_STAFF_PASSWORD_LENGTH} ký tự.`,
    };
  }
  return { ok: true, password: rawPassword };
}

function normalizeStaffCredentialRow(
  row: Record<string, unknown>
): StaffCredentialRecord {
  const nowIso = new Date().toISOString();
  const rawRole = String(row.role || 'staff');
  const role: 'cashier' | 'staff' = rawRole === 'cashier' ? 'cashier' : 'staff';
  const sessionVersionRaw = Number(row.session_version);

  return {
    user_id: String(row.user_id || '').trim(),
    shop_id: String(row.shop_id || '').trim(),
    username: normalizeStaffUsername(String(row.username || '')),
    password_hash: String(row.password_hash || ''),
    full_name:
      typeof row.full_name === 'string' && row.full_name.trim()
        ? row.full_name.trim()
        : null,
    role,
    is_active: row.is_active !== false,
    session_version:
      Number.isFinite(sessionVersionRaw) && sessionVersionRaw >= 1
        ? Math.floor(sessionVersionRaw)
        : 1,
    created_by:
      typeof row.created_by === 'string' && row.created_by.trim()
        ? row.created_by.trim()
        : null,
    created_at:
      typeof row.created_at === 'string' && row.created_at
        ? row.created_at
        : nowIso,
    updated_at:
      typeof row.updated_at === 'string' && row.updated_at
        ? row.updated_at
        : nowIso,
    last_login_at:
      typeof row.last_login_at === 'string' && row.last_login_at
        ? row.last_login_at
        : null,
  };
}

/**
 * Extracts a shop slug or shop ID candidate from a raw shop identifier, code,
 * or storefront URL (e.g. `bun-bo-hue-ba-ba`, `/s/bun-bo-hue-ba-ba/menu`,
 * `https://qlaok.vn/s/bun-bo-hue-ba-ba`, or `shop-fnb-001`).
 */
export function extractShopIdentifierCandidate(
  rawIdentifier: string | null | undefined
): string {
  const trimmed = String(rawIdentifier ?? '').trim();
  if (!trimmed) return '';

  const decodeSafe = (val: string): string => {
    try {
      return decodeURIComponent(val).trim();
    } catch {
      return val.trim();
    }
  };

  // Match /s/<slug> in full URLs or relative paths
  const storefrontMatch = trimmed.match(/(?:^|\/)s\/([^/?#]+)/i);
  if (storefrontMatch?.[1]) {
    return decodeSafe(storefrontMatch[1]);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const segments = parsed.pathname
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments[0]?.toLowerCase() === 's' && segments[1]) {
        return decodeSafe(segments[1]);
      }
      if (segments.length === 1 && segments[0]) {
        return decodeSafe(segments[0]);
      }
      return '';
    } catch {
      return '';
    }
  }

  // Strip leading/trailing slashes or query strings if user pasted a partial path
  const withoutQuery = trimmed.split(/[?#]/)[0]?.replace(/^\/+|\/+$/g, '') || '';
  if (withoutQuery.includes('/')) {
    return '';
  }
  return decodeSafe(withoutQuery);
}

/**
 * Fixed global rate-limit bucket key for any nonexistent or unresolvable shop.
 * Ensures arbitrary caller-supplied shop identifiers cannot create new rows in
 * `public.staff_login_rate_limits`.
 */
export function computeStaffLoginUnknownShopRateLimitKey(): string {
  const digest = crypto
    .createHash('sha256')
    .update('qlaok:staff_login_rl:v1:unknown_shop')
    .digest('hex');
  return `rl-staff-${digest}`;
}

/**
 * Fixed shop-scoped rate-limit bucket key for any nonexistent or invalid
 * username targeting a known shop (`knownShopId`).
 * Ensures arbitrary caller-supplied usernames for a known shop collapse to a
 * single row per shop in `public.staff_login_rate_limits`.
 */
export function computeStaffLoginUnknownUserRateLimitKey(
  knownShopId: string | null | undefined
): string {
  const cleanShopId = String(knownShopId ?? '')
    .trim()
    .toLowerCase();
  if (!cleanShopId) {
    return computeStaffLoginUnknownShopRateLimitKey();
  }
  const digest = crypto
    .createHash('sha256')
    .update(`qlaok:staff_login_rl:v1:shop_unknown_user:${cleanShopId}`)
    .digest('hex');
  return `rl-staff-${digest}`;
}

/**
 * Derives a deterministic, privacy-preserving, bounded SHA-256 rate-limit
 * bucket key (`rl-staff-<64 hex chars>`):
 * - Missing/unknown shop -> fixed global `unknown_shop` bucket (1 global key)
 * - Known shop + missing/invalid/unknown username -> fixed `shop_unknown_user`
 *   bucket (1 key per real shop)
 * - Known shop + existing staff credential username -> `shop_account` bucket
 *   (1 key per real staff account)
 *
 * Total possible rows in `public.staff_login_rate_limits` are bounded by
 * `1 + |shops| + |shop_staff_credentials|`, never by raw request strings.
 * Never trusts client-supplied IP headers or stores raw usernames/passwords/IPs.
 */
export function computeStaffLoginRateLimitKey(
  knownShopId: string | null | undefined,
  knownStaffUsername?: string | null | undefined
): string {
  const cleanShopId = String(knownShopId ?? '')
    .trim()
    .toLowerCase();
  if (!cleanShopId) {
    return computeStaffLoginUnknownShopRateLimitKey();
  }
  const normalizedUser = normalizeStaffUsername(knownStaffUsername);
  if (!normalizedUser || !isValidStaffUsername(normalizedUser)) {
    return computeStaffLoginUnknownUserRateLimitKey(cleanShopId);
  }
  const digest = crypto
    .createHash('sha256')
    .update(
      `qlaok:staff_login_rl:v1:shop_account:${cleanShopId}:${normalizedUser}`
    )
    .digest('hex');
  return `rl-staff-${digest}`;
}

function normalizeRateLimitRpcPayload(
  raw: unknown
): StaffLoginRateLimitCheckResult {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const allowed = obj.allowed !== false;
  const failureCountRaw = Number(obj.failure_count ?? obj.failureCount ?? 0);
  const retryAfterRaw = Number(obj.retry_after_sec ?? obj.retryAfterSec ?? 0);
  const blockedUntil =
    typeof obj.blocked_until === 'string' && obj.blocked_until
      ? obj.blocked_until
      : typeof obj.blockedUntil === 'string' && obj.blockedUntil
        ? obj.blockedUntil
        : null;

  return {
    allowed,
    failureCount: Number.isFinite(failureCountRaw)
      ? Math.max(0, Math.floor(failureCountRaw))
      : 0,
    retryAfterSec: Number.isFinite(retryAfterRaw)
      ? Math.max(0, Math.ceil(retryAfterRaw))
      : 0,
    blockedUntil,
  };
}

function pruneExpiredInMemoryRateLimits(nowMs: number): number {
  let deleted = 0;
  for (const [key, row] of inMemoryStaffLoginRateLimits.entries()) {
    const expiresMs = Date.parse(row.expires_at);
    const blockedMs = row.blocked_until ? Date.parse(row.blocked_until) : 0;
    if (
      Number.isFinite(expiresMs) &&
      expiresMs <= nowMs &&
      (!blockedMs || blockedMs <= nowMs)
    ) {
      inMemoryStaffLoginRateLimits.delete(key);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * Cleans up expired staff login rate-limit rows whose retention and cooldown
 * windows have elapsed. Runs via service-role RPC or table/memory fallback.
 */
export async function cleanupExpiredStaffLoginRateLimits(options?: {
  nowMs?: number;
  batchLimit?: number;
}): Promise<number> {
  const nowMs = options?.nowMs ?? getRateLimitNowMs();
  const batchLimit = Math.max(
    1,
    Math.min(options?.batchLimit ?? 500, 5000)
  );
  const nowIso = new Date(nowMs).toISOString();
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;
    if (typeof sb.rpc === 'function') {
      const { data, error } = await sb.rpc(
        'cleanup_expired_staff_login_rate_limits',
        {
          p_now: nowIso,
          p_batch_limit: batchLimit,
        }
      );
      if (!error) {
        const count = Number(data);
        return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
      }
      if (!isMissingRpcFunctionError(error)) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể dọn bộ giới hạn đăng nhập nhân viên.'}`
        );
      }
    }

    const { data: rows, error: selErr } = await sb
      .from('staff_login_rate_limits')
      .select('*');
    if (selErr) {
      throw new Error(
        `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${selErr.message || 'Không thể đọc bộ giới hạn đăng nhập nhân viên.'}`
      );
    }

    const expiredKeys: string[] = [];
    for (const rawRow of (rows || []) as Array<Record<string, unknown>>) {
      const key = String(rawRow.bucket_key || '');
      const expiresMs = Date.parse(String(rawRow.expires_at || ''));
      const blockedMs = rawRow.blocked_until
        ? Date.parse(String(rawRow.blocked_until))
        : 0;
      if (
        key &&
        Number.isFinite(expiresMs) &&
        expiresMs <= nowMs &&
        (!blockedMs || blockedMs <= nowMs)
      ) {
        expiredKeys.push(key);
        if (expiredKeys.length >= batchLimit) break;
      }
    }

    for (const key of expiredKeys) {
      const { error: delErr } = await sb
        .from('staff_login_rate_limits')
        .delete()
        .eq('bucket_key', key);
      if (delErr) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${delErr.message || 'Không thể xóa mục giới hạn đăng nhập hết hạn.'}`
        );
      }
    }
    return expiredKeys.length;
  }

  return pruneExpiredInMemoryRateLimits(nowMs);
}

/**
 * Checks whether `bucketKey` is currently rate-limited before running expensive
 * scrypt verification. Fails closed if the authoritative DB limiter fails.
 */
export async function checkStaffLoginRateLimit(
  bucketKey: string,
  options?: { nowMs?: number; windowSeconds?: number }
): Promise<StaffLoginRateLimitCheckResult> {
  const cleanKey = String(bucketKey || '')
    .trim()
    .toLowerCase();
  if (!STAFF_RATE_LIMIT_BUCKET_KEY_REGEX.test(cleanKey)) {
    throw new Error(
      'INVALID_STAFF_RATE_LIMIT_BUCKET_KEY: Khóa giới hạn tần suất đăng nhập không hợp lệ.'
    );
  }

  const nowMs = options?.nowMs ?? getRateLimitNowMs();
  const windowSeconds =
    options?.windowSeconds ?? STAFF_LOGIN_RATE_LIMIT_WINDOW_SECONDS;
  const windowMs = windowSeconds * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;
    if (typeof sb.rpc === 'function') {
      const { data, error } = await sb.rpc(
        'check_staff_login_rate_limit_atomic',
        {
          p_bucket_key: cleanKey,
          p_now: nowIso,
          p_window_seconds: windowSeconds,
        }
      );
      if (!error && data) {
        return normalizeRateLimitRpcPayload(data);
      }
      if (error && !isMissingRpcFunctionError(error)) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể kiểm tra giới hạn tần suất đăng nhập.'}`
        );
      }
    }

    await cleanupExpiredStaffLoginRateLimits({ nowMs, batchLimit: 100 });

    const { data, error } = await sb
      .from('staff_login_rate_limits')
      .select('*')
      .eq('bucket_key', cleanKey)
      .maybeSingle();

    if (error) {
      throw new Error(
        `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể truy vấn giới hạn tần suất đăng nhập.'}`
      );
    }
    if (!data) {
      return {
        allowed: true,
        failureCount: 0,
        retryAfterSec: 0,
        blockedUntil: null,
      };
    }

    const row = data as Record<string, unknown>;
    const failureCount = Math.max(0, Number(row.failure_count || 0));
    const windowStartedMs = Date.parse(String(row.window_started_at || ''));
    const expiresMs = Date.parse(String(row.expires_at || ''));
    const blockedUntilStr =
      typeof row.blocked_until === 'string' && row.blocked_until
        ? row.blocked_until
        : null;
    const blockedUntilMs = blockedUntilStr ? Date.parse(blockedUntilStr) : 0;

    if (blockedUntilMs && blockedUntilMs > nowMs) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((blockedUntilMs - nowMs) / 1000)
      );
      return {
        allowed: false,
        failureCount,
        retryAfterSec,
        blockedUntil: blockedUntilStr,
      };
    }

    if (
      (blockedUntilMs && blockedUntilMs <= nowMs) ||
      (Number.isFinite(windowStartedMs) && windowStartedMs + windowMs <= nowMs) ||
      (Number.isFinite(expiresMs) && expiresMs <= nowMs)
    ) {
      const { error: delErr } = await sb
        .from('staff_login_rate_limits')
        .delete()
        .eq('bucket_key', cleanKey);
      if (delErr) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${delErr.message || 'Không thể đặt lại cửa sổ giới hạn đăng nhập hết hạn.'}`
        );
      }
      return {
        allowed: true,
        failureCount: 0,
        retryAfterSec: 0,
        blockedUntil: null,
      };
    }

    return {
      allowed: true,
      failureCount,
      retryAfterSec: 0,
      blockedUntil: null,
    };
  }

  pruneExpiredInMemoryRateLimits(nowMs);
  const existing = inMemoryStaffLoginRateLimits.get(cleanKey);
  if (!existing) {
    return {
      allowed: true,
      failureCount: 0,
      retryAfterSec: 0,
      blockedUntil: null,
    };
  }

  const blockedUntilMs = existing.blocked_until
    ? Date.parse(existing.blocked_until)
    : 0;
  const windowStartedMs = Date.parse(existing.window_started_at);
  const expiresMs = Date.parse(existing.expires_at);

  if (blockedUntilMs && blockedUntilMs > nowMs) {
    return {
      allowed: false,
      failureCount: existing.failure_count,
      retryAfterSec: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)),
      blockedUntil: existing.blocked_until,
    };
  }

  if (
    (blockedUntilMs && blockedUntilMs <= nowMs) ||
    windowStartedMs + windowMs <= nowMs ||
    expiresMs <= nowMs
  ) {
    inMemoryStaffLoginRateLimits.delete(cleanKey);
    return {
      allowed: true,
      failureCount: 0,
      retryAfterSec: 0,
      blockedUntil: null,
    };
  }

  return {
    allowed: true,
    failureCount: existing.failure_count,
    retryAfterSec: 0,
    blockedUntil: null,
  };
}

/**
 * Atomically records a failed staff login attempt and enters a temporary
 * cooldown once `maxAttempts` is reached within `windowSeconds`.
 */
export async function recordStaffLoginFailure(
  bucketKey: string,
  options?: {
    nowMs?: number;
    maxAttempts?: number;
    windowSeconds?: number;
    blockSeconds?: number;
    retentionSeconds?: number;
  }
): Promise<StaffLoginRateLimitCheckResult> {
  const cleanKey = String(bucketKey || '')
    .trim()
    .toLowerCase();
  if (!STAFF_RATE_LIMIT_BUCKET_KEY_REGEX.test(cleanKey)) {
    throw new Error(
      'INVALID_STAFF_RATE_LIMIT_BUCKET_KEY: Khóa giới hạn tần suất đăng nhập không hợp lệ.'
    );
  }

  const nowMs = options?.nowMs ?? getRateLimitNowMs();
  const maxAttempts = Math.max(
    1,
    options?.maxAttempts ?? STAFF_LOGIN_RATE_LIMIT_MAX_ATTEMPTS
  );
  const windowSeconds = Math.max(
    1,
    options?.windowSeconds ?? STAFF_LOGIN_RATE_LIMIT_WINDOW_SECONDS
  );
  const blockSeconds = Math.max(
    1,
    options?.blockSeconds ?? STAFF_LOGIN_RATE_LIMIT_BLOCK_SECONDS
  );
  const retentionSeconds = Math.max(
    windowSeconds,
    blockSeconds,
    options?.retentionSeconds ?? STAFF_LOGIN_RATE_LIMIT_RETENTION_SECONDS
  );

  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + retentionSeconds * 1000).toISOString();
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;
    if (typeof sb.rpc === 'function') {
      const { data, error } = await sb.rpc(
        'record_staff_login_failure_atomic',
        {
          p_bucket_key: cleanKey,
          p_now: nowIso,
          p_max_attempts: maxAttempts,
          p_window_seconds: windowSeconds,
          p_block_seconds: blockSeconds,
          p_retention_seconds: retentionSeconds,
        }
      );
      if (!error && data) {
        return normalizeRateLimitRpcPayload(data);
      }
      if (error && !isMissingRpcFunctionError(error)) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể ghi nhận giới hạn tần suất đăng nhập.'}`
        );
      }
    }

    await cleanupExpiredStaffLoginRateLimits({ nowMs, batchLimit: 100 });

    const { data: existingRaw, error: selErr } = await sb
      .from('staff_login_rate_limits')
      .select('*')
      .eq('bucket_key', cleanKey)
      .maybeSingle();

    if (selErr) {
      throw new Error(
        `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${selErr.message || 'Không thể đọc trạng thái giới hạn tần suất đăng nhập.'}`
      );
    }

    const windowMs = windowSeconds * 1000;
    const blockMs = blockSeconds * 1000;

    if (existingRaw) {
      const row = existingRaw as Record<string, unknown>;
      const prevCount = Math.max(0, Number(row.failure_count || 0));
      const windowStartedMs = Date.parse(String(row.window_started_at || ''));
      const rowExpiresMs = Date.parse(String(row.expires_at || ''));
      const blockedUntilStr =
        typeof row.blocked_until === 'string' && row.blocked_until
          ? row.blocked_until
          : null;
      const blockedUntilMs = blockedUntilStr ? Date.parse(blockedUntilStr) : 0;

      if (blockedUntilMs && blockedUntilMs > nowMs) {
        const nextCount = prevCount + 1;
        const retryAfterSec = Math.max(
          1,
          Math.ceil((blockedUntilMs - nowMs) / 1000)
        );
        const { error: updErr } = await sb
          .from('staff_login_rate_limits')
          .upsert({
            bucket_key: cleanKey,
            failure_count: nextCount,
            window_started_at: String(row.window_started_at || nowIso),
            last_failed_at: nowIso,
            blocked_until: blockedUntilStr,
            expires_at: expiresIso,
            updated_at: nowIso,
          });
        if (updErr) {
          throw new Error(
            `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${updErr.message || 'Không thể cập nhật bộ giới hạn đăng nhập.'}`
          );
        }
        return {
          allowed: false,
          failureCount: nextCount,
          retryAfterSec,
          blockedUntil: blockedUntilStr,
        };
      }

      const windowExpired =
        (blockedUntilMs && blockedUntilMs <= nowMs) ||
        !Number.isFinite(windowStartedMs) ||
        windowStartedMs + windowMs <= nowMs ||
        (Number.isFinite(rowExpiresMs) && rowExpiresMs <= nowMs);

      if (!windowExpired) {
        const nextCount = prevCount + 1;
        const nextBlockedUntil =
          nextCount >= maxAttempts
            ? new Date(nowMs + blockMs).toISOString()
            : null;
        const retryAfterSec = nextBlockedUntil ? blockSeconds : 0;

        const { error: updErr } = await sb
          .from('staff_login_rate_limits')
          .upsert({
            bucket_key: cleanKey,
            failure_count: nextCount,
            window_started_at: String(row.window_started_at || nowIso),
            last_failed_at: nowIso,
            blocked_until: nextBlockedUntil,
            expires_at: expiresIso,
            updated_at: nowIso,
          });
        if (updErr) {
          throw new Error(
            `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${updErr.message || 'Không thể cập nhật bộ giới hạn đăng nhập.'}`
          );
        }
        return {
          allowed: nextCount <= maxAttempts,
          failureCount: nextCount,
          retryAfterSec,
          blockedUntil: nextBlockedUntil,
        };
      }
    }

    const firstBlockedUntil =
      1 >= maxAttempts ? new Date(nowMs + blockMs).toISOString() : null;
    const { error: insErr } = await sb.from('staff_login_rate_limits').upsert({
      bucket_key: cleanKey,
      failure_count: 1,
      window_started_at: nowIso,
      last_failed_at: nowIso,
      blocked_until: firstBlockedUntil,
      expires_at: expiresIso,
      updated_at: nowIso,
    });
    if (insErr) {
      throw new Error(
        `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${insErr.message || 'Không thể khởi tạo bộ giới hạn đăng nhập.'}`
      );
    }
    return {
      allowed: true,
      failureCount: 1,
      retryAfterSec: firstBlockedUntil ? blockSeconds : 0,
      blockedUntil: firstBlockedUntil,
    };
  }

  pruneExpiredInMemoryRateLimits(nowMs);
  const windowMs = windowSeconds * 1000;
  const blockMs = blockSeconds * 1000;
  const existing = inMemoryStaffLoginRateLimits.get(cleanKey);

  if (existing) {
    const blockedUntilMs = existing.blocked_until
      ? Date.parse(existing.blocked_until)
      : 0;
    const windowStartedMs = Date.parse(existing.window_started_at);
    const expiresMs = Date.parse(existing.expires_at);

    if (blockedUntilMs && blockedUntilMs > nowMs) {
      const nextCount = existing.failure_count + 1;
      inMemoryStaffLoginRateLimits.set(cleanKey, {
        ...existing,
        failure_count: nextCount,
        last_failed_at: nowIso,
        expires_at: expiresIso,
        updated_at: nowIso,
      });
      return {
        allowed: false,
        failureCount: nextCount,
        retryAfterSec: Math.max(1, Math.ceil((blockedUntilMs - nowMs) / 1000)),
        blockedUntil: existing.blocked_until,
      };
    }

    const expired =
      (blockedUntilMs && blockedUntilMs <= nowMs) ||
      windowStartedMs + windowMs <= nowMs ||
      expiresMs <= nowMs;

    if (!expired) {
      const nextCount = existing.failure_count + 1;
      const nextBlockedUntil =
        nextCount >= maxAttempts
          ? new Date(nowMs + blockMs).toISOString()
          : null;
      inMemoryStaffLoginRateLimits.set(cleanKey, {
        ...existing,
        failure_count: nextCount,
        last_failed_at: nowIso,
        blocked_until: nextBlockedUntil,
        expires_at: expiresIso,
        updated_at: nowIso,
      });
      return {
        allowed: nextCount <= maxAttempts,
        failureCount: nextCount,
        retryAfterSec: nextBlockedUntil ? blockSeconds : 0,
        blockedUntil: nextBlockedUntil,
      };
    }
  }

  const firstBlockedUntil =
    1 >= maxAttempts ? new Date(nowMs + blockMs).toISOString() : null;
  inMemoryStaffLoginRateLimits.set(cleanKey, {
    bucket_key: cleanKey,
    failure_count: 1,
    window_started_at: nowIso,
    last_failed_at: nowIso,
    blocked_until: firstBlockedUntil,
    expires_at: expiresIso,
    updated_at: nowIso,
  });

  return {
    allowed: true,
    failureCount: 1,
    retryAfterSec: firstBlockedUntil ? blockSeconds : 0,
    blockedUntil: firstBlockedUntil,
  };
}

/**
 * Resets the failure counter and cooldown for `bucketKey` after a successful
 * staff login or an owner password reset.
 */
export async function resetStaffLoginRateLimit(
  bucketKey: string,
  options?: { strict?: boolean }
): Promise<void> {
  const cleanKey = String(bucketKey || '')
    .trim()
    .toLowerCase();
  if (!STAFF_RATE_LIMIT_BUCKET_KEY_REGEX.test(cleanKey)) {
    return;
  }

  const mode = assertStaffStorageAvailable();
  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;
    if (typeof sb.rpc === 'function') {
      const { error } = await sb.rpc('reset_staff_login_rate_limit_atomic', {
        p_bucket_key: cleanKey,
      });
      if (!error) {
        return;
      }
      if (!isMissingRpcFunctionError(error)) {
        if (options?.strict !== false) {
          throw new Error(
            `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể đặt lại bộ giới hạn đăng nhập.'}`
          );
        }
        return;
      }
    }

    try {
      const { error } = await sb
        .from('staff_login_rate_limits')
        .delete()
        .eq('bucket_key', cleanKey);
      if (error && options?.strict !== false) {
        throw new Error(
          `STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE: ${error.message || 'Không thể xóa bộ giới hạn đăng nhập.'}`
        );
      }
    } catch (err) {
      if (options?.strict !== false) {
        throw err;
      }
    }
    return;
  }

  inMemoryStaffLoginRateLimits.delete(cleanKey);
}

/**
 * Resolves a submitted shop identifier (slug, alias, shop ID, or storefront link)
 * to at most one Shop.
 */
export async function resolveShopForStaffLogin(
  rawIdentifier: string | null | undefined
): Promise<Shop | null> {
  const candidate = extractShopIdentifierCandidate(rawIdentifier);
  if (!candidate) return null;

  const slugCandidate = candidate.toLowerCase();

  if (isShopMembershipDbAuthoritative()) {
    try {
      const sb = getMembershipDbClient();
      const query = sb.from('shops').select('*').eq('slug', slugCandidate);
      const { data, error } =
        typeof query.maybeSingle === 'function'
          ? await query.maybeSingle()
          : await query.single();
      if (!error && data) {
        return data as Shop;
      }
    } catch {
      // Fall through to storefront bundle / alias / ID lookup
    }
  }

  try {
    const bundle = await dbGetStorefrontBundle(slugCandidate, {
      allowUnpublished: true,
      includePosts: false,
    });
    if (bundle?.shop) {
      return bundle.shop;
    }
  } catch {
    // Fall through to ID lookup
  }

  const byId = await dbGetShopById(candidate);
  if (byId) {
    return byId;
  }

  if (slugCandidate !== candidate) {
    const byLowerId = await dbGetShopById(slugCandidate);
    if (byLowerId) {
      return byLowerId;
    }
  }

  return null;
}

export async function dbGetShopStaffCredentialByUserId(
  shopId: string,
  userId: string
): Promise<StaffCredentialRecord | null> {
  if (!shopId || !userId) return null;
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient();
    const { data, error } = await sb
      .from('shop_staff_credentials')
      .select('*')
      .eq('shop_id', shopId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `DB_READ_STAFF_CREDENTIAL_FAILED: ${error.message || 'Không thể đọc thông tin đăng nhập nhân viên.'}`
      );
    }
    if (!data) {
      return null;
    }
    return normalizeStaffCredentialRow(data as Record<string, unknown>);
  }

  const found = inMemoryStaffCredentialsByUserId.get(userId);
  if (!found || found.shop_id !== shopId) {
    return null;
  }
  return { ...found };
}

export async function dbGetShopStaffCredentialByUsername(
  shopId: string,
  rawUsername: string
): Promise<StaffCredentialRecord | null> {
  const username = normalizeStaffUsername(rawUsername);
  if (!shopId || !isValidStaffUsername(username)) return null;
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient();
    const { data, error } = await sb
      .from('shop_staff_credentials')
      .select('*')
      .eq('shop_id', shopId)
      .eq('username', username)
      .maybeSingle();

    if (error) {
      throw new Error(
        `DB_READ_STAFF_CREDENTIAL_FAILED: ${error.message || 'Không thể đọc thông tin đăng nhập nhân viên.'}`
      );
    }
    if (!data) {
      return null;
    }
    return normalizeStaffCredentialRow(data as Record<string, unknown>);
  }

  for (const record of inMemoryStaffCredentialsByUserId.values()) {
    if (record.shop_id === shopId && record.username === username) {
      return { ...record };
    }
  }
  return null;
}

export async function dbCreateShopStaffAccount(input: {
  shop_id: string;
  username: string;
  password: string;
  full_name?: string;
  role: unknown;
  permissions?: unknown;
  is_active?: boolean;
  created_by?: string;
}): Promise<ShopMembership> {
  const shopId = String(input.shop_id || '').trim();
  if (!shopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu shop_id.');
  }

  const username = normalizeStaffUsername(input.username);
  if (!isValidStaffUsername(username)) {
    throw new Error(
      'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (chỉ gồm chữ thường a-z, số 0-9, dấu chấm, gạch dưới hoặc gạch ngang).'
    );
  }

  const passwordCheck = validateStaffPassword(input.password);
  if (!passwordCheck.ok) {
    throw new Error(`${passwordCheck.errorCode}: ${passwordCheck.message}`);
  }

  const roleCheck = validateStaffRole(input.role);
  if (!roleCheck.ok) {
    throw new Error(`${roleCheck.errorCode}: ${roleCheck.message}`);
  }

  const permsCheck = validateStaffPermissionsInput(
    roleCheck.role,
    input.permissions
  );
  if (!permsCheck.ok) {
    throw new Error(`${permsCheck.errorCode}: ${permsCheck.message}`);
  }

  const mode = assertStaffStorageAvailable();

  const userId = `staff-acct-${crypto.randomUUID()}`;
  const membershipId = `mem-${userId}`;
  const nowIso = new Date().toISOString();
  const fullNameClean =
    typeof input.full_name === 'string' && input.full_name.trim()
      ? input.full_name.trim()
      : null;
  const isActive = input.is_active !== undefined ? Boolean(input.is_active) : true;
  const passwordHash = hashPassword(passwordCheck.password);
  const createdByClean =
    typeof input.created_by === 'string' && input.created_by.trim()
      ? input.created_by.trim()
      : null;

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;

    // 1. Prefer atomic service-role SQL RPC so credentials + membership are
    //    written in a single PostgreSQL transaction.
    if (typeof sb.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await sb.rpc(
        'create_shop_staff_account_atomic',
        {
          p_user_id: userId,
          p_shop_id: shopId,
          p_username: username,
          p_password_hash: passwordHash,
          p_full_name: fullNameClean ?? username,
          p_role: roleCheck.role,
          p_permissions: permsCheck.permissions,
          p_is_active: isActive,
          p_created_by: createdByClean,
          p_membership_id: membershipId,
        }
      );

      if (!rpcErr && rpcData && typeof rpcData === 'object') {
        return normalizeMembershipRow(rpcData as Record<string, unknown>);
      }
      if (rpcErr && !isMissingRpcFunctionError(rpcErr)) {
        throw normalizeStaffRpcError(
          rpcErr,
          'DB_CREATE_STAFF_ACCOUNT_FAILED',
          'Không thể tạo tài khoản nhân viên.',
          username
        );
      }
    }

    // 2. Compensated two-table fallback for table-only test mocks
    const existingCred = await dbGetShopStaffCredentialByUsername(
      shopId,
      username
    );
    if (existingCred) {
      throw new Error(
        `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`
      );
    }
    const existingMembers = await dbGetShopMemberships(shopId);
    if (
      existingMembers.some(
        (m) => m.username && normalizeStaffUsername(m.username) === username
      )
    ) {
      throw new Error(
        `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`
      );
    }

    const { error: credErr } = await sb.from('shop_staff_credentials').insert({
      user_id: userId,
      shop_id: shopId,
      username,
      password_hash: passwordHash,
      full_name: fullNameClean,
      role: roleCheck.role,
      is_active: isActive,
      session_version: 1,
      created_by: createdByClean,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (credErr) {
      const msg = credErr.message || '';
      if (/duplicate|unique|23505/i.test(msg)) {
        throw new Error(
          `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`
        );
      }
      throw new Error(
        `DB_CREATE_STAFF_CREDENTIAL_FAILED: ${msg || 'Không thể tạo thông tin đăng nhập nhân viên.'}`
      );
    }

    try {
      const membership = await dbUpsertShopMembership({
        shop_id: shopId,
        user_id: userId,
        username,
        full_name: fullNameClean ?? username,
        role: roleCheck.role,
        permissions: permsCheck.permissions,
        is_active: isActive,
      });
      return membership;
    } catch (memErr) {
      // Compensate: remove credential row so no orphaned credential remains
      const { error: rollbackErr } = await sb
        .from('shop_staff_credentials')
        .delete()
        .eq('shop_id', shopId)
        .eq('user_id', userId);
      if (rollbackErr) {
        try {
          await sb
            .from('shop_staff_credentials')
            .update({ is_active: false, session_version: 999999 })
            .eq('shop_id', shopId)
            .eq('user_id', userId);
        } catch {
          // ignore secondary fallback error
        }
        throw new Error(
          `DB_CREATE_STAFF_ROLLBACK_FAILED: ${rollbackErr.message || 'Không thể hoàn tác bản ghi thông tin đăng nhập sau khi lưu phân quyền thất bại.'}`
        );
      }
      throw memErr;
    }
  }

  // Non-production in-memory test mode
  const existingCred = await dbGetShopStaffCredentialByUsername(shopId, username);
  if (existingCred) {
    throw new Error(
      `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`
    );
  }
  const existingMembers = await dbGetShopMemberships(shopId);
  if (
    existingMembers.some(
      (m) => m.username && normalizeStaffUsername(m.username) === username
    )
  ) {
    throw new Error(
      `STAFF_USERNAME_EXISTS: Tên đăng nhập "${username}" đã tồn tại trong cửa hàng này.`
    );
  }

  const credentialRecord: StaffCredentialRecord = {
    user_id: userId,
    shop_id: shopId,
    username,
    password_hash: passwordHash,
    full_name: fullNameClean,
    role: roleCheck.role,
    is_active: isActive,
    session_version: 1,
    created_by: createdByClean,
    created_at: nowIso,
    updated_at: nowIso,
    last_login_at: null,
  };

  inMemoryStaffCredentialsByUserId.set(userId, credentialRecord);
  try {
    const membership = await dbUpsertShopMembership({
      shop_id: shopId,
      user_id: userId,
      username,
      full_name: fullNameClean ?? username,
      role: roleCheck.role,
      permissions: permsCheck.permissions,
      is_active: isActive,
    });
    return membership;
  } catch (memErr) {
    inMemoryStaffCredentialsByUserId.delete(userId);
    throw memErr;
  }
}

export async function dbUpdateShopStaffAccount(input: {
  shop_id: string;
  user_id?: string;
  username?: string;
  full_name?: string;
  role?: unknown;
  permissions?: unknown;
  is_active?: boolean;
}): Promise<ShopMembership> {
  const shopId = String(input.shop_id || '').trim();
  if (!shopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu shop_id.');
  }

  const members = await dbGetShopMemberships(shopId);
  const targetUserId = input.user_id ? String(input.user_id).trim() : '';
  const targetUsername = input.username
    ? normalizeStaffUsername(input.username)
    : '';

  const existingMembership = members.find(
    (m) =>
      (targetUserId && m.user_id === targetUserId) ||
      (!targetUserId &&
        targetUsername &&
        m.username &&
        normalizeStaffUsername(m.username) === targetUsername)
  );

  const existingCred = targetUserId
    ? await dbGetShopStaffCredentialByUserId(shopId, targetUserId)
    : targetUsername
      ? await dbGetShopStaffCredentialByUsername(shopId, targetUsername)
      : null;

  if (!existingMembership && !existingCred) {
    throw new Error(
      'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên trong cửa hàng này.'
    );
  }

  const resolvedUserId =
    existingCred?.user_id || existingMembership?.user_id || targetUserId;

  if (
    !existingCred ||
    !existingMembership ||
    !isShopScopedStaffUserId(resolvedUserId)
  ) {
    throw new Error(
      'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên hợp lệ trong cửa hàng này.'
    );
  }

  let nextRole: 'cashier' | 'staff' = existingCred.role;
  if (input.role !== undefined) {
    const roleCheck = validateStaffRole(input.role);
    if (!roleCheck.ok) {
      throw new Error(`${roleCheck.errorCode}: ${roleCheck.message}`);
    }
    nextRole = roleCheck.role;
  }

  let nextPermissions: ShopPermission[];
  if (input.permissions !== undefined) {
    const permsCheck = validateStaffPermissionsInput(
      nextRole,
      input.permissions
    );
    if (!permsCheck.ok) {
      throw new Error(`${permsCheck.errorCode}: ${permsCheck.message}`);
    }
    nextPermissions = permsCheck.permissions;
  } else if (existingMembership.permissions) {
    nextPermissions = existingMembership.permissions.filter(
      (p) =>
        ALLOWED_STAFF_PERMISSIONS.includes(p) &&
        !OWNER_ONLY_SHOP_PERMISSIONS.includes(p)
    );
  } else {
    const defaultPerms = validateStaffPermissionsInput(nextRole, undefined);
    nextPermissions = defaultPerms.ok ? defaultPerms.permissions : [];
  }

  let nextUsername =
    existingCred.username ||
    (existingMembership.username
      ? normalizeStaffUsername(existingMembership.username)
      : '');
  if (input.username !== undefined) {
    const candidateUsername = normalizeStaffUsername(input.username);
    if (!isValidStaffUsername(candidateUsername)) {
      throw new Error(
        'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (a-z, 0-9, ., _, -).'
      );
    }
    if (candidateUsername !== nextUsername) {
      const conflictCred = await dbGetShopStaffCredentialByUsername(
        shopId,
        candidateUsername
      );
      if (conflictCred && conflictCred.user_id !== resolvedUserId) {
        throw new Error(
          `STAFF_USERNAME_EXISTS: Tên đăng nhập "${candidateUsername}" đã tồn tại trong cửa hàng này.`
        );
      }
      const conflictMem = members.find(
        (m) =>
          m.user_id !== resolvedUserId &&
          m.username &&
          normalizeStaffUsername(m.username) === candidateUsername
      );
      if (conflictMem) {
        throw new Error(
          `STAFF_USERNAME_EXISTS: Tên đăng nhập "${candidateUsername}" đã tồn tại trong cửa hàng này.`
        );
      }
      nextUsername = candidateUsername;
    }
  }

  const nextFullName =
    input.full_name !== undefined
      ? input.full_name.trim() || nextUsername
      : existingMembership.full_name || existingCred.full_name || nextUsername;

  const nextIsActive =
    input.is_active !== undefined
      ? Boolean(input.is_active)
      : existingMembership.is_active ?? existingCred.is_active ?? true;

  const mode = assertStaffStorageAvailable();
  const nowIso = new Date().toISOString();

  const shouldBumpSession =
    (existingCred.is_active && !nextIsActive) ||
    existingCred.role !== nextRole ||
    existingCred.username !== nextUsername;
  const nextSessionVersion = shouldBumpSession
    ? existingCred.session_version + 1
    : existingCred.session_version;

  const prevCredSnapshot: StaffCredentialRecord = { ...existingCred };
  const oldUsernameRateLimitKey =
    prevCredSnapshot.username !== nextUsername
      ? computeStaffLoginRateLimitKey(shopId, prevCredSnapshot.username)
      : '';

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;

    // 1. Prefer atomic service-role SQL RPC
    if (typeof sb.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await sb.rpc(
        'update_shop_staff_account_atomic',
        {
          p_shop_id: shopId,
          p_user_id: resolvedUserId,
          p_username: nextUsername,
          p_full_name: nextFullName,
          p_role: nextRole,
          p_permissions: nextPermissions,
          p_is_active: nextIsActive,
        }
      );

      if (!rpcErr && rpcData && typeof rpcData === 'object') {
        if (oldUsernameRateLimitKey) {
          await resetStaffLoginRateLimit(oldUsernameRateLimitKey, {
            strict: false,
          });
        }
        return normalizeMembershipRow(rpcData as Record<string, unknown>);
      }
      if (rpcErr && !isMissingRpcFunctionError(rpcErr)) {
        throw normalizeStaffRpcError(
          rpcErr,
          'DB_UPDATE_STAFF_ACCOUNT_FAILED',
          'Không thể cập nhật tài khoản nhân viên.',
          nextUsername
        );
      }
    }

    // 2. Compensated two-table fallback for table-only test mocks
    const { error: credErr } = await sb
      .from('shop_staff_credentials')
      .update({
        username: nextUsername,
        full_name: nextFullName,
        role: nextRole,
        is_active: nextIsActive,
        session_version: nextSessionVersion,
        updated_at: nowIso,
      })
      .eq('shop_id', shopId)
      .eq('user_id', resolvedUserId);

    if (credErr) {
      const msg = credErr.message || '';
      if (/duplicate|unique|23505/i.test(msg)) {
        throw new Error(
          `STAFF_USERNAME_EXISTS: Tên đăng nhập "${nextUsername}" đã tồn tại trong cửa hàng này.`
        );
      }
      throw new Error(
        `DB_UPDATE_STAFF_CREDENTIAL_FAILED: ${msg || 'Không thể cập nhật tài khoản nhân viên.'}`
      );
    }

    try {
      const updatedMembership = await dbUpsertShopMembership({
        shop_id: shopId,
        user_id: resolvedUserId,
        ...(nextUsername ? { username: nextUsername } : {}),
        full_name: nextFullName,
        role: nextRole,
        permissions: nextPermissions,
        is_active: nextIsActive,
      });
      if (oldUsernameRateLimitKey) {
        await resetStaffLoginRateLimit(oldUsernameRateLimitKey, {
          strict: false,
        });
      }
      return updatedMembership;
    } catch (memErr) {
      // Compensate: restore shop_staff_credentials back to prevCredSnapshot
      const { error: rollbackErr } = await sb
        .from('shop_staff_credentials')
        .update({
          username: prevCredSnapshot.username,
          full_name: prevCredSnapshot.full_name,
          role: prevCredSnapshot.role,
          is_active: prevCredSnapshot.is_active,
          session_version: prevCredSnapshot.session_version,
          updated_at: prevCredSnapshot.updated_at,
        })
        .eq('shop_id', shopId)
        .eq('user_id', resolvedUserId);

      if (rollbackErr) {
        try {
          await sb
            .from('shop_staff_credentials')
            .update({
              is_active: false,
              session_version: prevCredSnapshot.session_version + 2,
            })
            .eq('shop_id', shopId)
            .eq('user_id', resolvedUserId);
        } catch {
          // ignore secondary fallback error
        }
        throw new Error(
          `DB_UPDATE_STAFF_ROLLBACK_FAILED: ${rollbackErr.message || 'Không thể hoàn tác thông tin đăng nhập sau khi cập nhật phân quyền thất bại.'}`
        );
      }
      throw memErr;
    }
  }

  inMemoryStaffCredentialsByUserId.set(resolvedUserId, {
    ...existingCred,
    username: nextUsername,
    full_name: nextFullName,
    role: nextRole,
    is_active: nextIsActive,
    session_version: nextSessionVersion,
    updated_at: nowIso,
  });

  try {
    const updatedMembership = await dbUpsertShopMembership({
      shop_id: shopId,
      user_id: resolvedUserId,
      ...(nextUsername ? { username: nextUsername } : {}),
      full_name: nextFullName,
      role: nextRole,
      permissions: nextPermissions,
      is_active: nextIsActive,
    });
    if (oldUsernameRateLimitKey) {
      await resetStaffLoginRateLimit(oldUsernameRateLimitKey, {
        strict: false,
      });
    }
    return updatedMembership;
  } catch (memErr) {
    inMemoryStaffCredentialsByUserId.set(resolvedUserId, prevCredSnapshot);
    throw memErr;
  }
}

export async function dbResetShopStaffPassword(input: {
  shop_id: string;
  user_id?: string;
  username?: string;
  new_password: unknown;
}): Promise<{
  user_id: string;
  shop_id: string;
  username: string;
  session_version: number;
}> {
  const shopId = String(input.shop_id || '').trim();
  if (!shopId) {
    throw new Error('MISSING_SHOP_ID: Thiếu shop_id.');
  }

  const passwordCheck = validateStaffPassword(input.new_password);
  if (!passwordCheck.ok) {
    throw new Error(`${passwordCheck.errorCode}: ${passwordCheck.message}`);
  }

  const targetUserId = input.user_id ? String(input.user_id).trim() : '';
  const targetUsername = input.username
    ? normalizeStaffUsername(input.username)
    : '';

  const existingCred = targetUserId
    ? await dbGetShopStaffCredentialByUserId(shopId, targetUserId)
    : targetUsername
      ? await dbGetShopStaffCredentialByUsername(shopId, targetUsername)
      : null;

  const memberships = await dbGetShopMemberships(shopId);
  const existingMembership = existingCred
    ? memberships.find((m) => m.user_id === existingCred.user_id) || null
    : null;

  if (!existingCred || !existingMembership) {
    throw new Error(
      'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên trong cửa hàng này.'
    );
  }

  const nextPasswordHash = hashPassword(passwordCheck.password);
  const nextSessionVersion = existingCred.session_version + 1;
  const nowIso = new Date().toISOString();
  const rateLimitBucketKey = computeStaffLoginRateLimitKey(
    shopId,
    existingCred.username
  );
  const prevCredSnapshot: StaffCredentialRecord = { ...existingCred };
  const mode = assertStaffStorageAvailable();

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;

    // 1. Prefer atomic service-role SQL RPC
    if (typeof sb.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await sb.rpc(
        'reset_shop_staff_password_atomic',
        {
          p_shop_id: shopId,
          p_user_id: existingCred.user_id,
          p_new_password_hash: nextPasswordHash,
          p_rate_limit_bucket_key: rateLimitBucketKey,
        }
      );

      if (!rpcErr && rpcData && typeof rpcData === 'object') {
        const resObj = rpcData as Record<string, unknown>;
        const sv = Number(resObj.session_version);
        return {
          user_id: existingCred.user_id,
          shop_id: shopId,
          username: existingCred.username,
          session_version:
            Number.isFinite(sv) && sv >= 1 ? Math.floor(sv) : nextSessionVersion,
        };
      }
      if (rpcErr && !isMissingRpcFunctionError(rpcErr)) {
        throw normalizeStaffRpcError(
          rpcErr,
          'DB_RESET_STAFF_PASSWORD_FAILED',
          'Không thể đặt lại mật khẩu nhân viên.'
        );
      }
    }

    // 2. Compensated two-table fallback for table-only test mocks
    const { error: credErr } = await sb
      .from('shop_staff_credentials')
      .update({
        password_hash: nextPasswordHash,
        session_version: nextSessionVersion,
        updated_at: nowIso,
      })
      .eq('shop_id', shopId)
      .eq('user_id', existingCred.user_id);

    if (credErr) {
      throw new Error(
        `DB_RESET_STAFF_PASSWORD_FAILED: ${credErr.message || 'Không thể đặt lại mật khẩu nhân viên.'}`
      );
    }

    try {
      await dbUpsertShopMembership({
        shop_id: shopId,
        user_id: existingCred.user_id,
        username: existingCred.username,
        full_name:
          existingMembership.full_name ||
          existingCred.full_name ||
          existingCred.username,
        role: existingCred.role,
        permissions: existingMembership.permissions,
        is_active: existingCred.is_active,
      });
    } catch (memErr) {
      // Compensate: restore previous password_hash and session_version
      const { error: rollbackErr } = await sb
        .from('shop_staff_credentials')
        .update({
          password_hash: prevCredSnapshot.password_hash,
          session_version: prevCredSnapshot.session_version,
          updated_at: prevCredSnapshot.updated_at,
        })
        .eq('shop_id', shopId)
        .eq('user_id', existingCred.user_id);

      if (rollbackErr) {
        try {
          await sb
            .from('shop_staff_credentials')
            .update({ is_active: false })
            .eq('shop_id', shopId)
            .eq('user_id', existingCred.user_id);
        } catch {
          // ignore secondary fallback error
        }
        throw new Error(
          `DB_RESET_STAFF_PASSWORD_ROLLBACK_FAILED: ${rollbackErr.message || 'Không thể hoàn tác mật khẩu sau khi cập nhật phân quyền thất bại.'}`
        );
      }
      throw memErr;
    }

    await resetStaffLoginRateLimit(rateLimitBucketKey, { strict: false });

    return {
      user_id: existingCred.user_id,
      shop_id: shopId,
      username: existingCred.username,
      session_version: nextSessionVersion,
    };
  }

  inMemoryStaffCredentialsByUserId.set(existingCred.user_id, {
    ...existingCred,
    password_hash: nextPasswordHash,
    session_version: nextSessionVersion,
    updated_at: nowIso,
  });

  try {
    await dbUpsertShopMembership({
      shop_id: shopId,
      user_id: existingCred.user_id,
      username: existingCred.username,
      full_name:
        existingMembership.full_name ||
        existingCred.full_name ||
        existingCred.username,
      role: existingCred.role,
      permissions: existingMembership.permissions,
      is_active: existingCred.is_active,
    });
  } catch (memErr) {
    inMemoryStaffCredentialsByUserId.set(existingCred.user_id, prevCredSnapshot);
    throw memErr;
  }

  await resetStaffLoginRateLimit(rateLimitBucketKey, { strict: false });

  return {
    user_id: existingCred.user_id,
    shop_id: shopId,
    username: existingCred.username,
    session_version: nextSessionVersion,
  };
}

export async function dbDeleteShopStaffAccount(
  shopId: string,
  userId: string
): Promise<boolean> {
  const cleanShopId = String(shopId || '').trim();
  const cleanUserId = String(userId || '').trim();
  if (!cleanShopId || !cleanUserId) {
    throw new Error('MISSING_MEMBERSHIP_FIELDS: Thiếu shop_id hoặc user_id.');
  }

  const mode = assertStaffStorageAvailable();
  const prevCred = await dbGetShopStaffCredentialByUserId(
    cleanShopId,
    cleanUserId
  );
  const memberships = await dbGetShopMemberships(cleanShopId);
  const prevMembership =
    memberships.find((m) => m.user_id === cleanUserId) || null;
  const rateLimitBucketKey = prevCred
    ? computeStaffLoginRateLimitKey(cleanShopId, prevCred.username)
    : prevMembership?.username
      ? computeStaffLoginRateLimitKey(cleanShopId, prevMembership.username)
      : '';

  if (mode === 'db') {
    const sb = getMembershipDbClient() as RpcCapableClient;

    // 1. Prefer atomic service-role SQL RPC
    if (typeof sb.rpc === 'function') {
      const { data: rpcData, error: rpcErr } = await sb.rpc(
        'delete_shop_staff_account_atomic',
        {
          p_shop_id: cleanShopId,
          p_user_id: cleanUserId,
          p_rate_limit_bucket_key: rateLimitBucketKey || null,
        }
      );

      if (!rpcErr && rpcData && typeof rpcData === 'object') {
        return Boolean((rpcData as Record<string, unknown>).deleted);
      }
      if (rpcErr && !isMissingRpcFunctionError(rpcErr)) {
        throw normalizeStaffRpcError(
          rpcErr,
          'DB_DELETE_STAFF_ACCOUNT_FAILED',
          'Không thể xóa tài khoản nhân viên.'
        );
      }
    }

    // 2. Compensated two-table fallback for table-only test mocks
    const { error, count } = await sb
      .from('shop_staff_credentials')
      .delete({ count: 'exact' })
      .eq('shop_id', cleanShopId)
      .eq('user_id', cleanUserId);

    if (error) {
      throw new Error(
        `DB_DELETE_STAFF_CREDENTIAL_FAILED: ${error.message || 'Không thể xóa thông tin đăng nhập nhân viên.'}`
      );
    }
    const deletedCred = typeof count === 'number' ? count > 0 : Boolean(prevCred);

    try {
      const deletedMem = await dbDeleteShopMembership(cleanShopId, cleanUserId);
      if (rateLimitBucketKey) {
        await resetStaffLoginRateLimit(rateLimitBucketKey, { strict: false });
      }
      return deletedCred || deletedMem;
    } catch (memErr) {
      // Compensate: restore deleted credential row so the account does not end
      // up in an inconsistent half-deleted state.
      if (prevCred) {
        const { error: restoreErr } = await sb
          .from('shop_staff_credentials')
          .insert({
            user_id: prevCred.user_id,
            shop_id: prevCred.shop_id,
            username: prevCred.username,
            password_hash: prevCred.password_hash,
            full_name: prevCred.full_name,
            role: prevCred.role,
            is_active: prevCred.is_active,
            session_version: prevCred.session_version,
            created_by: prevCred.created_by,
            created_at: prevCred.created_at,
            updated_at: prevCred.updated_at,
            last_login_at: prevCred.last_login_at,
          });
        if (restoreErr) {
          // Fail-safe: deactivate membership if credential restore also failed
          if (prevMembership) {
            try {
              await dbUpsertShopMembership({
                shop_id: cleanShopId,
                user_id: cleanUserId,
                username: prevMembership.username,
                full_name: prevMembership.full_name,
                role: prevMembership.role,
                permissions: prevMembership.permissions,
                is_active: false,
              });
            } catch {
              // ignore secondary fallback error
            }
          }
          throw new Error(
            `DB_DELETE_STAFF_ROLLBACK_FAILED: ${restoreErr.message || 'Không thể khôi phục thông tin đăng nhập nhân viên sau khi xóa phân quyền thất bại.'}`
          );
        }
      }
      throw memErr;
    }
  }

  let deletedCred = false;
  if (prevCred && prevCred.shop_id === cleanShopId) {
    inMemoryStaffCredentialsByUserId.delete(cleanUserId);
    deletedCred = true;
  }

  try {
    const deletedMem = await dbDeleteShopMembership(cleanShopId, cleanUserId);
    if (rateLimitBucketKey) {
      await resetStaffLoginRateLimit(rateLimitBucketKey, { strict: false });
    }
    return deletedCred || deletedMem;
  } catch (memErr) {
    if (prevCred && deletedCred) {
      inMemoryStaffCredentialsByUserId.set(cleanUserId, prevCred);
    }
    throw memErr;
  }
}

export async function authenticateShopStaffLogin(input: {
  shopIdentifier: string;
  username: string;
  password: string;
}): Promise<
  | {
      ok: true;
      user: Profile;
      shop: Shop;
      membership: ShopMembership;
      sessionVersion: number;
    }
  | {
      ok: false;
      status: number;
      errorCode: string;
      message: string;
      retryAfterSec?: number;
    }
> {
  const genericFailure = {
    ok: false as const,
    status: 401,
    errorCode: 'INVALID_STAFF_CREDENTIALS',
    message:
      'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không chính xác.',
  };

  const rateLimitUnavailableFailure = {
    ok: false as const,
    status: 503,
    errorCode: 'STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE',
    message:
      'Hệ thống kiểm soát bảo mật đăng nhập nhân viên tạm thời gián đoạn. Vui lòng thử lại sau.',
  };

  const buildRateLimitedFailure = (retryAfterSec: number) => ({
    ok: false as const,
    status: 429,
    errorCode: 'STAFF_LOGIN_RATE_LIMITED',
    message:
      'Quá nhiều lần đăng nhập nhân viên thất bại. Vui lòng thử lại sau ít phút.',
    retryAfterSec: Math.max(1, retryAfterSec),
  });

  const rawShopIdentifier = String(input.shopIdentifier || '').trim();
  const username = normalizeStaffUsername(input.username);
  const rawPassword = typeof input.password === 'string' ? input.password : '';

  const shop = rawShopIdentifier
    ? await resolveShopForStaffLogin(rawShopIdentifier)
    : null;

  let credential: StaffCredentialRecord | null = null;
  if (shop && isValidStaffUsername(username)) {
    try {
      credential = await dbGetShopStaffCredentialByUsername(shop.id, username);
    } catch {
      return rateLimitUnavailableFailure;
    }
  }

  // Select a bounded rate-limit bucket key:
  // - Nonexistent shop -> fixed global unknown-shop bucket (1 key total)
  // - Known shop + nonexistent/invalid username -> fixed shop-scoped
  //   unknown-user bucket (1 key per real shop)
  // - Known shop + existing active/inactive staff credential -> per-account
  //   bucket (1 key per real staff account)
  const bucketKey = !shop
    ? computeStaffLoginUnknownShopRateLimitKey()
    : credential
      ? computeStaffLoginRateLimitKey(shop.id, credential.username)
      : computeStaffLoginUnknownUserRateLimitKey(shop.id);

  // 1. Check durable rate limit BEFORE running scrypt password verification.
  //    Fails closed (503) if the authoritative DB limiter is unavailable.
  let rateCheck: StaffLoginRateLimitCheckResult;
  try {
    rateCheck = await checkStaffLoginRateLimit(bucketKey);
  } catch {
    return rateLimitUnavailableFailure;
  }

  if (!rateCheck.allowed) {
    return buildRateLimitedFailure(rateCheck.retryAfterSec);
  }

  const recordFailureAndRespond = async () => {
    try {
      const failureResult = await recordStaffLoginFailure(bucketKey);
      if (!failureResult.allowed) {
        return buildRateLimitedFailure(failureResult.retryAfterSec);
      }
      return genericFailure;
    } catch {
      return rateLimitUnavailableFailure;
    }
  };

  if (!rawShopIdentifier || !username || !rawPassword) {
    runDummyStaffPasswordVerification(rawPassword);
    return recordFailureAndRespond();
  }

  if (!shop || !isValidStaffUsername(username) || !credential) {
    runDummyStaffPasswordVerification(rawPassword);
    return recordFailureAndRespond();
  }

  const passwordValid = verifyPassword(rawPassword, credential.password_hash);
  if (!passwordValid || !credential.is_active) {
    return recordFailureAndRespond();
  }

  const memberships = await dbGetShopMemberships(shop.id);
  const membership = memberships.find(
    (m) => m.user_id === credential.user_id && m.is_active
  );
  if (!membership) {
    return recordFailureAndRespond();
  }

  if (
    (membership.role !== 'cashier' && membership.role !== 'staff') ||
    credential.role !== membership.role
  ) {
    return recordFailureAndRespond();
  }

  // Clear failure window upon successful login (fail closed if DB limiter fails)
  try {
    await resetStaffLoginRateLimit(bucketKey, { strict: true });
  } catch {
    return rateLimitUnavailableFailure;
  }

  const safeMembership: ShopMembership = {
    ...membership,
    username: credential.username,
    account_type: 'staff',
    role: membership.role,
    permissions: membership.permissions.filter(
      (p) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(p)
    ),
  };

  const nowIso = new Date().toISOString();
  try {
    const mode = assertStaffStorageAvailable();
    if (mode === 'db') {
      const sb = getMembershipDbClient();
      await sb
        .from('shop_staff_credentials')
        .update({ last_login_at: nowIso })
        .eq('shop_id', shop.id)
        .eq('user_id', credential.user_id);
    } else {
      inMemoryStaffCredentialsByUserId.set(credential.user_id, {
        ...credential,
        last_login_at: nowIso,
      });
    }
  } catch {
    // Best-effort timestamp update; do not fail login
  }

  const profile: Profile = {
    id: credential.user_id,
    email: '',
    username: credential.username,
    shop_id: shop.id,
    account_type: 'staff',
    full_name:
      safeMembership.full_name || credential.full_name || credential.username,
    plan: 'free',
    role: safeMembership.role,
  };

  return {
    ok: true,
    user: profile,
    shop,
    membership: safeMembership,
    sessionVersion: credential.session_version,
  };
}

/**
 * Verifies whether a shop-scoped staff session is still active and unrevoked.
 * Checks both `shop_memberships` and `shop_staff_credentials` (including
 * `session_version` and role/username coherence).
 */
export async function verifyActiveShopStaffSession(params: {
  userId: string;
  shopId: string;
  sessionVersion?: number;
}): Promise<{
  active: boolean;
  membership: ShopMembership | null;
  credential: StaffCredentialRecord | null;
}> {
  const { userId, shopId, sessionVersion } = params;
  if (!userId || !shopId) {
    return { active: false, membership: null, credential: null };
  }

  const memberships = await dbGetShopMemberships(shopId);
  const membership =
    memberships.find((m) => m.user_id === userId && m.is_active) || null;
  if (!membership || (membership.role !== 'cashier' && membership.role !== 'staff')) {
    return { active: false, membership: null, credential: null };
  }

  let credential: StaffCredentialRecord | null = null;
  try {
    credential = await dbGetShopStaffCredentialByUserId(shopId, userId);
  } catch {
    return { active: false, membership: null, credential: null };
  }

  const isStaffIdentity =
    isShopScopedStaffUserId(userId) ||
    membership.account_type === 'staff' ||
    Boolean(membership.username);

  if (credential) {
    if (!credential.is_active || credential.shop_id !== shopId) {
      return { active: false, membership: null, credential };
    }
    if (credential.role !== membership.role) {
      return { active: false, membership: null, credential };
    }
    if (
      membership.username &&
      normalizeStaffUsername(membership.username) !== credential.username
    ) {
      return { active: false, membership: null, credential };
    }
    if (
      typeof sessionVersion === 'number' &&
      credential.session_version !== sessionVersion
    ) {
      return { active: false, membership: null, credential };
    }
  } else if (isStaffIdentity || typeof sessionVersion === 'number') {
    // Shop-scoped staff account requires an active credential row
    return { active: false, membership: null, credential: null };
  }

  return {
    active: true,
    membership: {
      ...membership,
      username: credential?.username ?? membership.username,
      account_type: 'staff',
      permissions: membership.permissions.filter(
        (p) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(p)
      ),
    },
    credential,
  };
}
