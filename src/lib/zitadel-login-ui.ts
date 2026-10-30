import crypto from 'node:crypto';
import {
  assertAuthEmailConfigured,
  AuthEmailError,
  type AuthEmailLocale,
  type AuthEmailSendHandler,
  type AuthEmailSmtpConfig,
  normalizeAuthEmailLocale,
  sendQlaokPasswordResetEmail,
  sendQlaokRegistrationVerificationEmail,
} from '@/lib/auth-email';
import {
  getSupabaseDbClient,
  isSupabaseDbClientOverriddenForTests,
} from '@/lib/db';
import { resolveTrustedQlaokEmailOrigin } from '@/lib/auth-email-templates';
import {
  escapePostgrestIlikePattern,
  isPendingAdminOwnerInvitation,
} from '@/lib/owner-invitations';
import { isShopMembershipDbAuthoritative } from '@/lib/shop-permissions';
import {
  compareConstantTimeString,
  getZitadelClientId,
  getZitadelIssuerUrl,
  getZitadelMobileClientId,
  isPlaceholderOidcClientId,
  resolveMobileZitadelRedirectUri,
  resolveZitadelRedirectUri,
} from '@/lib/zitadel-oidc';

type FetchLike = typeof fetch;

const AUTH_REQUEST_ID_REGEX = /^V2_[A-Za-z0-9_-]{8,160}$/;
const USER_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PKCE_CHALLENGE_REGEX = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFICATION_CODE_REGEX = /^[A-Za-z0-9]{4,16}$/;
const PASSWORD_RESET_CODE_REGEX = /^[A-Za-z0-9_-]{4,128}$/;
export const REGISTRATION_TICKET_TTL_SECONDS = 15 * 60;
const LOGIN_UI_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_UI_MAX_BUCKETS = 4096;
export const MAX_REGISTRATION_VERIFY_FAILURES = 5;
export const PASSWORD_RESET_REQUEST_IP_MAX_ATTEMPTS = 10;
export const PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS = 5;
export const PASSWORD_RESET_COMPLETE_IP_MAX_ATTEMPTS = 12;
export const MAX_PASSWORD_RESET_VERIFY_FAILURES = 5;
const REGISTRATION_VERIFY_LOCKOUT_MS = REGISTRATION_TICKET_TTL_SECONDS * 1000;

interface InMemoryFailureBucket {
  failureCount: number;
  windowStartedAt: number;
  blockedUntil: number | null;
}

const loginUiRateLimitBuckets = new Map<string, number[]>();
const loginUiFailureLockBuckets = new Map<string, InMemoryFailureBucket>();

/**
 * Production Nginx overwrites X-Real-IP with $remote_addr.
 * Ignore client-controlled X-Forwarded-For so spoofed headers cannot reset rate limits.
 */
function isOwnerLoginUiDbAuthoritative(): boolean {
  if (isSupabaseDbClientOverriddenForTests()) {
    return true;
  }
  return isShopMembershipDbAuthoritative();
}

export function getClientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim() || '';
  if (!realIp || realIp.length > 64 || /[\s,]/.test(realIp)) {
    return 'unknown';
  }
  return realIp.toLowerCase();
}

export function buildZitadelLoginUiRateLimitBucketKey(rawKey: string): string {
  const normalized = rawKey.trim().toLowerCase() || 'anonymous';
  const digest = crypto
    .createHash('sha256')
    .update(`qlaok:owner_login_ui_rl:v1:${normalized}`)
    .digest('hex');
  return `rl-staff-${digest}`;
}

function pruneExpiredInMemoryRateLimitBuckets(
  nowMs: number,
  windowMs: number
): void {
  const cutoff = nowMs - windowMs;
  for (const [k, timestamps] of loginUiRateLimitBuckets.entries()) {
    const active = timestamps.filter((ts) => ts > cutoff);
    if (active.length === 0) {
      loginUiRateLimitBuckets.delete(k);
    } else if (active.length !== timestamps.length) {
      loginUiRateLimitBuckets.set(k, active);
    }
  }
  for (const [k, entry] of loginUiFailureLockBuckets.entries()) {
    const lockExpired =
      entry.blockedUntil !== null && entry.blockedUntil <= nowMs;
    const windowExpired =
      entry.blockedUntil === null &&
      nowMs - entry.windowStartedAt >= REGISTRATION_VERIFY_LOCKOUT_MS;
    if (lockExpired || windowExpired) {
      loginUiFailureLockBuckets.delete(k);
    }
  }
}

export function checkZitadelLoginUiRateLimit(
  key: string,
  maxAttempts = 12,
  windowMs = LOGIN_UI_RATE_LIMIT_WINDOW_MS,
  nowMs = Date.now(),
  maxBuckets = LOGIN_UI_MAX_BUCKETS
): void {
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(key);
  const cutoff = nowMs - windowMs;
  const existing = loginUiRateLimitBuckets.get(bucketKey) ?? [];
  const active = existing.filter((ts) => ts > cutoff);
  if (active.length >= maxAttempts) {
    loginUiRateLimitBuckets.set(bucketKey, active);
    throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
  }
  if (
    !loginUiRateLimitBuckets.has(bucketKey) &&
    loginUiRateLimitBuckets.size >= maxBuckets
  ) {
    pruneExpiredInMemoryRateLimitBuckets(nowMs, windowMs);
    if (loginUiRateLimitBuckets.size >= maxBuckets) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
  }
  active.push(nowMs);
  loginUiRateLimitBuckets.set(bucketKey, active);
}

export async function enforceZitadelLoginUiRateLimit(
  key: string,
  maxAttempts = 12,
  windowMs = LOGIN_UI_RATE_LIMIT_WINDOW_MS,
  nowMs = Date.now()
): Promise<void> {
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(key);
  const isProd = process.env.NODE_ENV === 'production';

  if (isOwnerLoginUiDbAuthoritative()) {
    const sb = getSupabaseDbClient() as unknown as {
      rpc?: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    if (typeof sb?.rpc === 'function') {
      const nowIso = new Date(nowMs).toISOString();
      const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
      let checkData: unknown;
      let checkErr: { message?: string } | null = null;
      try {
        const checkRes = await sb.rpc('check_staff_login_rate_limit_atomic', {
          p_bucket_key: bucketKey,
          p_now: nowIso,
          p_window_seconds: windowSeconds,
        });
        checkData = checkRes.data;
        checkErr = checkRes.error;
      } catch {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
      if (
        checkErr ||
        !checkData ||
        typeof checkData !== 'object' ||
        Array.isArray(checkData)
      ) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
      if ((checkData as Record<string, unknown>).allowed !== true) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }

      let recordData: unknown;
      let recordErr: { message?: string } | null = null;
      try {
        const recordRes = await sb.rpc('record_staff_login_failure_atomic', {
          p_bucket_key: bucketKey,
          p_now: nowIso,
          p_max_attempts: maxAttempts + 1,
          p_window_seconds: windowSeconds,
          p_block_seconds: windowSeconds,
        });
        recordData = recordRes.data;
        recordErr = recordRes.error;
      } catch {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
      if (
        recordErr ||
        !recordData ||
        typeof recordData !== 'object' ||
        Array.isArray(recordData)
      ) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
      if ((recordData as Record<string, unknown>).allowed !== true) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
      return;
    }
    if (isProd) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
  } else if (isProd) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }

  checkZitadelLoginUiRateLimit(key, maxAttempts, windowMs, nowMs);
}

async function checkRegistrationVerifyFailureBucket(
  rawKey: string,
  nowMs: number
): Promise<void> {
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(rawKey);
  const isProd = process.env.NODE_ENV === 'production';

  if (isOwnerLoginUiDbAuthoritative()) {
    const sb = getSupabaseDbClient() as unknown as {
      rpc?: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    if (typeof sb?.rpc === 'function') {
      try {
        const lockoutSeconds = Math.max(
          1,
          Math.ceil(REGISTRATION_VERIFY_LOCKOUT_MS / 1000)
        );
        const { data, error } = await sb.rpc(
          'check_staff_login_rate_limit_atomic',
          {
            p_bucket_key: bucketKey,
            p_now: new Date(nowMs).toISOString(),
            p_window_seconds: lockoutSeconds,
          }
        );
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
          throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
        }
        if ((data as Record<string, unknown>).allowed !== true) {
          throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
        }
        return;
      } catch (err) {
        if (err instanceof ZitadelLoginUiError) throw err;
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
    }
    if (isProd) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
  } else if (isProd) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }

  const existing = loginUiFailureLockBuckets.get(bucketKey);
  if (!existing) return;
  if (existing.blockedUntil !== null) {
    if (existing.blockedUntil > nowMs) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
    loginUiFailureLockBuckets.delete(bucketKey);
  }
}

async function recordRegistrationVerifyFailureBucket(
  rawKey: string,
  nowMs: number
): Promise<boolean> {
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(rawKey);
  const isProd = process.env.NODE_ENV === 'production';

  if (isOwnerLoginUiDbAuthoritative()) {
    const sb = getSupabaseDbClient() as unknown as {
      rpc?: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    if (typeof sb?.rpc === 'function') {
      try {
        const lockoutSeconds = Math.max(
          1,
          Math.ceil(REGISTRATION_VERIFY_LOCKOUT_MS / 1000)
        );
        const { data, error } = await sb.rpc(
          'record_staff_login_failure_atomic',
          {
            p_bucket_key: bucketKey,
            p_now: new Date(nowMs).toISOString(),
            p_max_attempts: MAX_REGISTRATION_VERIFY_FAILURES,
            p_window_seconds: lockoutSeconds,
            p_block_seconds: lockoutSeconds,
          }
        );
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
          throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
        }
        return (data as Record<string, unknown>).allowed !== true;
      } catch (err) {
        if (err instanceof ZitadelLoginUiError) throw err;
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
    }
    if (isProd) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
  } else if (isProd) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }

  const existing = loginUiFailureLockBuckets.get(bucketKey);
  if (
    !existing &&
    loginUiFailureLockBuckets.size >= LOGIN_UI_MAX_BUCKETS
  ) {
    pruneExpiredInMemoryRateLimitBuckets(
      nowMs,
      REGISTRATION_VERIFY_LOCKOUT_MS
    );
    if (loginUiFailureLockBuckets.size >= LOGIN_UI_MAX_BUCKETS) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
  }

  if (
    !existing ||
    (existing.blockedUntil !== null && existing.blockedUntil <= nowMs) ||
    nowMs - existing.windowStartedAt >= REGISTRATION_VERIFY_LOCKOUT_MS
  ) {
    const blocked = 1 >= MAX_REGISTRATION_VERIFY_FAILURES;
    loginUiFailureLockBuckets.set(bucketKey, {
      failureCount: 1,
      windowStartedAt: nowMs,
      blockedUntil: blocked ? nowMs + REGISTRATION_VERIFY_LOCKOUT_MS : null,
    });
    return blocked;
  }

  const nextCount = existing.failureCount + 1;
  const blocked = nextCount >= MAX_REGISTRATION_VERIFY_FAILURES;
  loginUiFailureLockBuckets.set(bucketKey, {
    failureCount: nextCount,
    windowStartedAt: existing.windowStartedAt,
    blockedUntil: blocked ? nowMs + REGISTRATION_VERIFY_LOCKOUT_MS : null,
  });
  return blocked;
}

async function resetRegistrationVerifyFailureBucket(
  rawKey: string
): Promise<void> {
  const bucketKey = buildZitadelLoginUiRateLimitBucketKey(rawKey);
  loginUiFailureLockBuckets.delete(bucketKey);

  if (isOwnerLoginUiDbAuthoritative()) {
    const sb = getSupabaseDbClient() as unknown as {
      rpc?: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    if (typeof sb?.rpc === 'function') {
      try {
        await sb.rpc('reset_staff_login_rate_limit_atomic', {
          p_bucket_key: bucketKey,
        });
      } catch {
        // Ignore reset failure; check/record paths remain fail-closed
      }
    }
  }
}

export function resetZitadelLoginUiRateLimitsForTests(): void {
  loginUiRateLimitBuckets.clear();
  loginUiFailureLockBuckets.clear();
}

export interface ZitadelLoginRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  loginHint?: string;
  state?: string;
  prompt?: string[];
}

export class ZitadelLoginUiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number
  ) {
    super(code);
    this.name = 'ZitadelLoginUiError';
    this.code = code;
    this.status = status;
  }
}

export interface ZitadelLoginUiConfig {
  issuerUrl: string;
  serviceToken: string;
  organizationId?: string;
  webClientId: string;
  mobileClientId: string;
  webRedirectUri: string;
  mobileRedirectUri: string;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
}

function mapAuthEmailErrorToLoginUiError(err: unknown): ZitadelLoginUiError {
  if (err instanceof ZitadelLoginUiError) {
    return err;
  }
  if (err instanceof AuthEmailError) {
    if (err.code === 'EMAIL_SERVICE_NOT_CONFIGURED') {
      return new ZitadelLoginUiError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    if (err.code === 'INVALID_EMAIL_RECIPIENT') {
      return new ZitadelLoginUiError('INVALID_EMAIL', 400);
    }
    return new ZitadelLoginUiError('EMAIL_DELIVERY_FAILED', 503);
  }
  return new ZitadelLoginUiError('EMAIL_DELIVERY_FAILED', 503);
}

function ensureAuthEmailReady(
  config: ZitadelLoginUiConfig,
  overrides?: {
    smtpConfig?: AuthEmailSmtpConfig;
    sendEmail?: AuthEmailSendHandler;
  }
): void {
  try {
    assertAuthEmailConfigured({
      smtpConfig: overrides?.smtpConfig ?? config.smtpConfig,
      sendEmail: overrides?.sendEmail ?? config.sendEmail,
    });
  } catch (err) {
    throw mapAuthEmailErrorToLoginUiError(err);
  }
}

function getConfig(origin: string): ZitadelLoginUiConfig {
  const serviceToken = (
    process.env.ZITADEL_LOGIN_CLIENT_PAT ||
    process.env.ZITADEL_SERVICE_USER_TOKEN ||
    ''
  ).trim();
  const rawOrganizationId = (
    process.env.ZITADEL_ORGANIZATION_ID ||
    process.env.ZITADEL_ORG_ID ||
    ''
  ).trim();
  const organizationId =
    rawOrganizationId && !isPlaceholderOidcClientId(rawOrganizationId)
      ? rawOrganizationId
      : undefined;
  const webClientId = getZitadelClientId();
  const mobileClientId = getZitadelMobileClientId();
  if (
    !serviceToken ||
    isPlaceholderOidcClientId(serviceToken) ||
    !webClientId ||
    !mobileClientId
  ) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }
  return {
    issuerUrl: getZitadelIssuerUrl(),
    serviceToken,
    organizationId,
    webClientId,
    mobileClientId,
    webRedirectUri: resolveZitadelRedirectUri(origin),
    mobileRedirectUri: resolveMobileZitadelRedirectUri(),
  };
}

function normalizePromptEntry(value: string): string {
  return value.trim().replace(/^PROMPT_/i, '').toLowerCase();
}

export function isRegistrationLoginRequest(
  loginRequest: Pick<ZitadelLoginRequest, 'prompt'>
): boolean {
  return (
    loginRequest.prompt?.some(
      (entry) => normalizePromptEntry(entry) === 'create'
    ) ?? false
  );
}

function getLoginRequest(
  value: unknown,
  config: ZitadelLoginUiConfig,
  expectedAuthRequestId?: string
): ZitadelLoginRequest {
  if (!value || typeof value !== 'object') {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const clientId =
    typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
  const redirectUri =
    typeof raw.redirectUri === 'string' ? raw.redirectUri.trim() : '';
  const isWeb =
    Boolean(config.webClientId) &&
    Boolean(config.webRedirectUri) &&
    clientId === config.webClientId &&
    redirectUri === config.webRedirectUri;
  const isMobile =
    Boolean(config.mobileClientId) &&
    Boolean(config.mobileRedirectUri) &&
    clientId === config.mobileClientId &&
    redirectUri === config.mobileRedirectUri;
  if (
    !AUTH_REQUEST_ID_REGEX.test(id) ||
    (expectedAuthRequestId !== undefined && id !== expectedAuthRequestId) ||
    (!isWeb && !isMobile)
  ) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const prompt = Array.isArray(raw.prompt)
    ? raw.prompt
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizePromptEntry)
        .filter(Boolean)
    : undefined;
  return {
    id,
    clientId,
    redirectUri,
    loginHint:
      typeof raw.loginHint === 'string' ? raw.loginHint.slice(0, 256) : '',
    state: typeof raw.state === 'string' ? raw.state : undefined,
    prompt,
  };
}

interface CallZitadelOptions {
  bearerToken?: string;
  mapError?: (
    status: number,
    errorPayload: Record<string, unknown> | null
  ) => ZitadelLoginUiError | null;
}

async function callZitadel<T>(
  config: ZitadelLoginUiConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
  options?: CallZitadelOptions
): Promise<T> {
  const token = (options?.bearerToken || config.serviceToken || '').trim();
  if (!token || isPlaceholderOidcClientId(token)) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }
  let response: Response;
  try {
    response = await fetchImpl(
      new URL(path, `${config.issuerUrl.replace(/\/+$/, '')}/`),
      {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    throw new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
    if (options?.mapError) {
      let errorPayload: Record<string, unknown> | null = null;
      try {
        const parsed = await response.json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          errorPayload = parsed as Record<string, unknown>;
        }
      } catch {
        errorPayload = null;
      }
      const mapped = options.mapError(status, errorPayload);
      if (mapped) {
        throw mapped;
      }
    }
    if (status === 400 || status === 404) {
      throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
    }
    if (status === 401 || status === 403) {
      throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
    }
    throw new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }
}

export async function fetchZitadelLoginRequest(
  authRequestId: string,
  origin: string,
  options: {
    fetchImpl?: FetchLike;
    config?: ZitadelLoginUiConfig;
  } = {}
): Promise<ZitadelLoginRequest> {
  const authRequest = authRequestId.trim();
  if (!AUTH_REQUEST_ID_REGEX.test(authRequest)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const config = options.config ?? getConfig(origin);
  const response = await callZitadel<{ authRequest?: unknown }>(
    config,
    `/v2/oidc/auth_requests/${encodeURIComponent(authRequest)}`,
    { method: 'GET' },
    options.fetchImpl
  ).catch((error: unknown) => {
    if (
      error instanceof ZitadelLoginUiError &&
      error.code === 'LOGIN_REJECTED'
    ) {
      throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
    }
    throw error;
  });
  return getLoginRequest(response.authRequest, config, authRequest);
}

export function getHostedRegistrationUrl(
  authRequest: ZitadelLoginRequest,
  issuerUrl: string = getZitadelIssuerUrl()
): string {
  const id = typeof authRequest?.id === 'string' ? authRequest.id.trim() : '';
  if (!AUTH_REQUEST_ID_REGEX.test(id)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const url = new URL('/ui/v2/login/loginname', `${issuerUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('authRequest', id);
  return url.toString();
}

export async function completeZitadelLoginRequest(params: {
  authRequestId: string;
  loginName: string;
  password: string;
  origin: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
}): Promise<string> {
  const rawAuthRequestId =
    typeof params.authRequestId === 'string' ? params.authRequestId.trim() : '';
  if (!AUTH_REQUEST_ID_REGEX.test(rawAuthRequestId)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const loginName = params.loginName.trim();
  if (!loginName || loginName.length > 256) {
    throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
  }
  if (!params.password || params.password.length > 1024) {
    throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
  }
  const config = params.config ?? getConfig(params.origin);
  const fetchImpl = params.fetchImpl ?? fetch;
  const authRequest = await fetchZitadelLoginRequest(
    rawAuthRequestId,
    params.origin,
    { config, fetchImpl }
  );

  const created = await callZitadel<{
    sessionId?: unknown;
    session?: { id?: unknown };
    sessionToken?: unknown;
  }>(
    config,
    '/v2/sessions',
    {
      method: 'POST',
      body: JSON.stringify({ checks: { user: { loginName } } }),
    },
    fetchImpl
  );
  const sessionId =
    typeof created.sessionId === 'string' && created.sessionId.trim()
      ? created.sessionId.trim()
      : typeof created.session?.id === 'string' && created.session.id.trim()
        ? created.session.id.trim()
        : '';
  const initialSessionToken =
    typeof created.sessionToken === 'string' ? created.sessionToken.trim() : '';
  if (!sessionId || !initialSessionToken) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  const updated = await callZitadel<{ sessionToken?: unknown }>(
    config,
    `/v2/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        checks: { password: { password: params.password } },
      }),
    },
    fetchImpl
  );
  const latestSessionToken =
    typeof updated.sessionToken === 'string' ? updated.sessionToken.trim() : '';
  if (!latestSessionToken) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  const finalized = await callZitadel<{ callbackUrl?: unknown }>(
    config,
    `/v2/oidc/auth_requests/${encodeURIComponent(authRequest.id)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        session: {
          sessionId,
          sessionToken: latestSessionToken,
        },
      }),
    },
    fetchImpl
  ).catch((error: unknown) => {
    if (
      error instanceof ZitadelLoginUiError &&
      error.code === 'LOGIN_REJECTED'
    ) {
      throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
    }
    throw error;
  });
  const callbackUrl =
    typeof finalized.callbackUrl === 'string'
      ? finalized.callbackUrl.trim()
      : '';
  if (!callbackUrl) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  let parsedCallback: URL;
  let parsedRedirect: URL;
  try {
    parsedCallback = new URL(callbackUrl);
    parsedRedirect = new URL(authRequest.redirectUri);
  } catch {
    throw new ZitadelLoginUiError('CALLBACK_URL_INVALID', 502);
  }
  const callbackState = parsedCallback.searchParams.get('state')?.trim() || '';
  const callbackCode = parsedCallback.searchParams.get('code')?.trim() || '';
  if (
    parsedCallback.protocol !== parsedRedirect.protocol ||
    parsedCallback.host !== parsedRedirect.host ||
    parsedCallback.pathname !== parsedRedirect.pathname ||
    parsedCallback.username ||
    parsedCallback.password ||
    parsedCallback.hash ||
    parsedCallback.searchParams.get('error') ||
    !callbackState ||
    (authRequest.state && callbackState !== authRequest.state) ||
    !callbackCode ||
    !callbackUrl.startsWith(`${authRequest.redirectUri}?`)
  ) {
    throw new ZitadelLoginUiError('CALLBACK_URL_INVALID', 502);
  }
  return callbackUrl;
}

export function splitOwnerFullNameForZitadel(rawFullName: string): {
  displayName: string;
  givenName: string;
  familyName: string;
} {
  const cleaned = rawFullName
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 120) {
    throw new ZitadelLoginUiError('INVALID_FULL_NAME', 400);
  }
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 0) {
    throw new ZitadelLoginUiError('INVALID_FULL_NAME', 400);
  }
  if (parts.length === 1) {
    return {
      displayName: cleaned,
      givenName: cleaned,
      familyName: cleaned,
    };
  }
  return {
    displayName: cleaned,
    givenName: parts.slice(0, -1).join(' '),
    familyName: parts[parts.length - 1],
  };
}

export function validateOwnerRegistrationPassword(
  password: string,
  confirmPassword?: string
): void {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 256 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9\s]/.test(password)
  ) {
    throw new ZitadelLoginUiError('PASSWORD_WEAK', 400);
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    throw new ZitadelLoginUiError('PASSWORD_MISMATCH', 400);
  }
}

export interface ZitadelRegistrationTicketPayload {
  v: 1;
  userId: string;
  email: string;
  fullName: string;
  authRequestId: string;
  clientKind: 'web' | 'mobile';
  lang?: 'vi' | 'en';
  iat: number;
  exp: number;
}

function getRegistrationTicketSecret(): Buffer {
  const rawSecret = (process.env.SESSION_SECRET || '').trim();
  if (!rawSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
    }
    return crypto
      .createHash('sha256')
      .update('qlaok-dev-zitadel-registration-ticket-secret-v1')
      .digest();
  }
  return crypto
    .createHmac('sha256', rawSecret)
    .update('qlaok-zitadel-registration-ticket-v1')
    .digest();
}

export function issueZitadelRegistrationTicket(params: {
  userId: string;
  email: string;
  fullName: string;
  authRequestId: string;
  clientKind: 'web' | 'mobile';
  lang?: 'vi' | 'en';
  nowSeconds?: number;
  ttlSeconds?: number;
}): string {
  const nowSec = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttlSec = params.ttlSeconds ?? REGISTRATION_TICKET_TTL_SECONDS;
  const payload: ZitadelRegistrationTicketPayload = {
    v: 1,
    userId: params.userId.trim(),
    email: params.email.trim().toLowerCase(),
    fullName: params.fullName.trim(),
    authRequestId: params.authRequestId.trim(),
    clientKind: params.clientKind,
    ...(params.lang === 'en' || params.lang === 'vi'
      ? { lang: params.lang }
      : {}),
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url'
  );
  const signature = crypto
    .createHmac('sha256', getRegistrationTicketSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyZitadelRegistrationTicket(
  rawTicket: string,
  nowSeconds?: number
): ZitadelRegistrationTicketPayload {
  const trimmed = typeof rawTicket === 'string' ? rawTicket.trim() : '';
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx <= 0 || dotIdx !== trimmed.lastIndexOf('.')) {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  const encodedPayload = trimmed.slice(0, dotIdx);
  const providedSig = trimmed.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  const expectedSig = crypto
    .createHmac('sha256', getRegistrationTicketSecret())
    .update(encodedPayload)
    .digest('base64url');
  if (!compareConstantTimeString(providedSig, expectedSig)) {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    );
  } catch {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  const obj = parsed as Record<string, unknown>;
  const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  const email =
    typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : '';
  const fullName = typeof obj.fullName === 'string' ? obj.fullName.trim() : '';
  const authRequestId =
    typeof obj.authRequestId === 'string' ? obj.authRequestId.trim() : '';
  const clientKind =
    obj.clientKind === 'mobile'
      ? 'mobile'
      : obj.clientKind === 'web'
        ? 'web'
        : null;
  const lang =
    obj.lang === 'en' ? 'en' : obj.lang === 'vi' ? 'vi' : undefined;
  const exp = typeof obj.exp === 'number' ? obj.exp : 0;
  const iat = typeof obj.iat === 'number' ? obj.iat : 0;
  if (
    obj.v !== 1 ||
    !USER_ID_REGEX.test(userId) ||
    !EMAIL_REGEX.test(email) ||
    !fullName ||
    !AUTH_REQUEST_ID_REGEX.test(authRequestId) ||
    !clientKind ||
    !Number.isFinite(exp) ||
    !Number.isFinite(iat)
  ) {
    throw new ZitadelLoginUiError('REGISTRATION_TICKET_INVALID', 400);
  }
  const nowSec = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (exp <= nowSec) {
    throw new ZitadelLoginUiError('REGISTRATION_EXPIRED', 400);
  }
  return {
    v: 1,
    userId,
    email,
    fullName,
    authRequestId,
    clientKind,
    ...(lang ? { lang } : {}),
    iat,
    exp,
  };
}

export interface OidcAuthorizeBootstrapParams {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  loginHint?: string;
  lang?: 'vi' | 'en';
}

export async function bootstrapZitadelOidcAuthRequestId(params: {
  oidc: OidcAuthorizeBootstrapParams;
  origin: string;
  config?: ZitadelLoginUiConfig;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const config = params.config ?? getConfig(params.origin);
  const fetchImpl = params.fetchImpl ?? fetch;
  const clientId = (params.oidc.clientId || '').trim();
  const redirectUri = (params.oidc.redirectUri || '').trim();
  const state = (params.oidc.state || '').trim();
  const nonce = (params.oidc.nonce || '').trim();
  const codeChallenge = (params.oidc.codeChallenge || '').trim();
  const codeChallengeMethod = (
    params.oidc.codeChallengeMethod || 'S256'
  ).trim();

  const isWeb =
    clientId === config.webClientId && redirectUri === config.webRedirectUri;
  const isMobile =
    clientId === config.mobileClientId &&
    redirectUri === config.mobileRedirectUri;
  if (
    (!isWeb && !isMobile) ||
    state.length < 16 ||
    state.length > 256 ||
    nonce.length < 16 ||
    nonce.length > 256 ||
    !PKCE_CHALLENGE_REGEX.test(codeChallenge) ||
    codeChallengeMethod !== 'S256'
  ) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }

  const authorizeUrl = new URL(
    '/oauth/v2/authorize',
    `${config.issuerUrl.replace(/\/+$/, '')}/`
  );
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('prompt', 'create');
  authorizeUrl.searchParams.set(
    'ui_locales',
    params.oidc.lang === 'en' ? 'en' : 'vi'
  );
  if (params.oidc.loginHint && params.oidc.loginHint.trim()) {
    authorizeUrl.searchParams.set(
      'login_hint',
      params.oidc.loginHint.trim().slice(0, 256)
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(authorizeUrl, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
  }

  if (response.status === 429) {
    throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
  }

  const location = response.headers.get('location') || '';
  if (!location) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }

  let extractedAuthRequestId = '';
  try {
    const redirectUrl = new URL(location, config.issuerUrl);
    extractedAuthRequestId = (
      redirectUrl.searchParams.get('authRequest') ||
      redirectUrl.searchParams.get('authRequestID') ||
      ''
    ).trim();
  } catch {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }

  if (!AUTH_REQUEST_ID_REGEX.test(extractedAuthRequestId)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  return extractedAuthRequestId;
}

function generateTemporaryRegistrationPassword(): string {
  // Unguessable CSPRNG credential satisfying uppercase, lowercase, digit, and symbol policies.
  // Never returned, logged, or persisted outside the initial unverified user creation request.
  return `${crypto.randomBytes(24).toString('base64url')}Aa1!`;
}

export function isZitadelDuplicateUserError(
  status: number,
  payload: Record<string, unknown> | null
): boolean {
  if (status === 409) {
    return true;
  }
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const grpcCode = payload.code;
  if (
    grpcCode === 6 ||
    (typeof grpcCode === 'string' &&
      grpcCode.trim().toUpperCase() === 'ALREADY_EXISTS')
  ) {
    return true;
  }
  const statusStr =
    typeof payload.status === 'string'
      ? payload.status.trim().toUpperCase()
      : '';
  if (statusStr === 'ALREADY_EXISTS') {
    return true;
  }
  if (Array.isArray(payload.details)) {
    for (const item of payload.details) {
      if (item && typeof item === 'object') {
        const detail = item as Record<string, unknown>;
        const id =
          typeof detail.id === 'string' ? detail.id.trim().toLowerCase() : '';
        const reason =
          typeof detail.reason === 'string'
            ? detail.reason.trim().toLowerCase()
            : '';
        const msg =
          typeof detail.message === 'string'
            ? detail.message.trim().toLowerCase()
            : '';
        if (
          id === 'user-4590s' ||
          id === 'user-5m9fs' ||
          id === 'user-b3s1q' ||
          reason.includes('already_exists') ||
          reason.includes('duplicate') ||
          msg.includes('already exists') ||
          msg.includes('duplicate') ||
          msg.includes('unique')
        ) {
          return true;
        }
      }
    }
  }
  const rawMessage =
    typeof payload.message === 'string'
      ? payload.message.trim().toLowerCase()
      : '';
  if (
    rawMessage.includes('already_exists') ||
    rawMessage.includes('already exists') ||
    rawMessage.includes('duplicate') ||
    rawMessage.includes('unique') ||
    (rawMessage.includes('username') && rawMessage.includes('taken')) ||
    (rawMessage.includes('email') && rawMessage.includes('taken'))
  ) {
    return true;
  }
  return false;
}

function extractCreatedZitadelUserId(payload: {
  id?: unknown;
  userId?: unknown;
  user?: { id?: unknown; userId?: unknown };
}): string {
  if (typeof payload.id === 'string' && payload.id.trim()) {
    return payload.id.trim();
  }
  if (typeof payload.userId === 'string' && payload.userId.trim()) {
    return payload.userId.trim();
  }
  if (typeof payload.user?.id === 'string' && payload.user.id.trim()) {
    return payload.user.id.trim();
  }
  if (typeof payload.user?.userId === 'string' && payload.user.userId.trim()) {
    return payload.user.userId.trim();
  }
  return '';
}

function extractZitadelReturnedCode(
  payload: unknown,
  codeRegex: RegExp = VERIFICATION_CODE_REGEX
): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }
  const record = payload as Record<string, unknown>;
  const nestedUser =
    record.user && typeof record.user === 'object' && !Array.isArray(record.user)
      ? (record.user as Record<string, unknown>)
      : null;
  const nestedHuman =
    record.human &&
    typeof record.human === 'object' &&
    !Array.isArray(record.human)
      ? (record.human as Record<string, unknown>)
      : null;

  const candidates = [
    record.emailCode,
    record.verificationCode,
    record.code,
    nestedUser?.emailCode,
    nestedUser?.verificationCode,
    nestedUser?.code,
    nestedHuman?.emailCode,
    nestedHuman?.verificationCode,
    nestedHuman?.code,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!stripped || stripped !== raw.trim()) continue;
    if (codeRegex.test(stripped)) {
      return stripped;
    }
  }
  return '';
}

async function tryRecoverUnverifiedZitadelUser(params: {
  email: string;
  fullName: string;
  authRequestId: string;
  clientKind: 'web' | 'mobile';
  lang?: AuthEmailLocale;
  origin: string;
  config: ZitadelLoginUiConfig;
  fetchImpl: FetchLike;
  nowSeconds?: number;
  clientIp?: string;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
}): Promise<{
  registrationTicket: string;
  authRequestId: string;
  email: string;
} | null> {
  const locale = normalizeAuthEmailLocale(params.lang);
  // Existing owners cannot use registration to link an unrelated identity. A
  // Super Admin-created pending invitation is the only exception: its exact
  // email must still be verified by Zitadel before the profile can be claimed.
  if (isOwnerLoginUiDbAuthoritative()) {
    try {
      const sb = getSupabaseDbClient();
      const { data: existingByEmail, error: emailErr } = await sb
        .from('profiles')
        .select('id, email, zitadel_sub, owner_invite_pending')
        .ilike('email', escapePostgrestIlikePattern(params.email))
        .limit(1);
      if (emailErr && emailErr.code !== 'PGRST116') {
        return null;
      }
      const existingRow = Array.isArray(existingByEmail)
        ? existingByEmail[0]
        : existingByEmail;
      if (
        existingRow &&
        !isPendingAdminOwnerInvitation(
          existingRow as {
            id: string;
            email?: string | null;
            zitadel_sub?: string | null;
            owner_invite_pending?: boolean | null;
          },
          params.email
        )
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }

  let searchResult: {
    result?: unknown[];
  };
  try {
    searchResult = await callZitadel<{ result?: unknown[] }>(
      params.config,
      '/v2/users',
      {
        method: 'POST',
        body: JSON.stringify({
          query: {
            offset: '0',
            limit: 2,
            asc: true,
          },
          queries: [
            {
              emailQuery: {
                emailAddress: params.email,
                method: 'TEXT_QUERY_METHOD_EQUALS',
              },
            },
          ],
        }),
      },
      params.fetchImpl,
      {
        bearerToken: params.config.serviceToken,
      }
    );
  } catch {
    return null;
  }

  if (
    !searchResult ||
    !Array.isArray(searchResult.result) ||
    searchResult.result.length !== 1
  ) {
    return null;
  }

  const rawUser = searchResult.result[0];
  if (!rawUser || typeof rawUser !== 'object') {
    return null;
  }
  const userRecord = rawUser as Record<string, unknown>;
  const existingUserId =
    typeof userRecord.userId === 'string' && userRecord.userId.trim()
      ? userRecord.userId.trim()
      : typeof userRecord.id === 'string' && userRecord.id.trim()
        ? userRecord.id.trim()
        : '';
  if (!existingUserId || !USER_ID_REGEX.test(existingUserId)) {
    return null;
  }

  const humanRecord =
    userRecord.human && typeof userRecord.human === 'object'
      ? (userRecord.human as Record<string, unknown>)
      : null;
  const emailRecord =
    humanRecord?.email && typeof humanRecord.email === 'object'
      ? (humanRecord.email as Record<string, unknown>)
      : null;
  if (!emailRecord) {
    return null;
  }

  const candidateEmail =
    typeof emailRecord.email === 'string'
      ? emailRecord.email.trim().toLowerCase()
      : '';
  // Fail closed: ONLY recover when email matches AND isVerified is explicitly false.
  if (candidateEmail !== params.email || emailRecord.isVerified !== false) {
    return null;
  }

  if (isOwnerLoginUiDbAuthoritative()) {
    try {
      const sb = getSupabaseDbClient();
      const { data: existingBySub, error: subErr } = await sb
        .from('profiles')
        .select('id')
        .eq('zitadel_sub', existingUserId)
        .maybeSingle();
      if (subErr && subErr.code !== 'PGRST116') {
        return null;
      }
      if (existingBySub && typeof (existingBySub as { id?: unknown }).id === 'string') {
        return null;
      }
    } catch {
      return null;
    }
  }

  const resendPayload = await callZitadel<Record<string, unknown>>(
    params.config,
    `/v2/users/${encodeURIComponent(existingUserId)}/email/resend`,
    {
      method: 'POST',
      body: JSON.stringify({
        returnCode: {},
      }),
    },
    params.fetchImpl,
    {
      bearerToken: params.config.serviceToken,
      mapError: (status) => {
        if (status === 401 || status === 403) {
          return new ZitadelLoginUiError(
            'REGISTRATION_SERVICE_NOT_CONFIGURED',
            503
          );
        }
        return null;
      },
    }
  );

  const verificationCode = extractZitadelReturnedCode(
    resendPayload,
    VERIFICATION_CODE_REGEX
  );
  if (!verificationCode) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  try {
    await sendQlaokRegistrationVerificationEmail({
      to: params.email,
      fullName: params.fullName,
      verificationCode,
      lang: locale,
      origin: params.origin,
      isResend: false,
      issuerUrl: params.config.issuerUrl,
      webRedirectUri: params.config.webRedirectUri,
      smtpConfig: params.smtpConfig ?? params.config.smtpConfig,
      sendEmail: params.sendEmail ?? params.config.sendEmail,
    });
  } catch (err) {
    throw mapAuthEmailErrorToLoginUiError(err);
  }

  await resetRegistrationVerifyFailureBucket(
    `reg_verify_fail:user:${existingUserId}`
  );

  const registrationTicket = issueZitadelRegistrationTicket({
    userId: existingUserId,
    email: params.email,
    fullName: params.fullName,
    authRequestId: params.authRequestId,
    clientKind: params.clientKind,
    lang: locale,
    nowSeconds: params.nowSeconds,
  });

  return {
    registrationTicket,
    authRequestId: params.authRequestId,
    email: params.email,
  };
}

export async function startZitadelRegistration(params: {
  authRequestId?: string;
  oidc?: OidcAuthorizeBootstrapParams;
  fullName: string;
  email: string;
  password: string;
  confirmPassword?: string;
  lang?: 'vi' | 'en';
  origin: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
  nowSeconds?: number;
  clientIp?: string;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
}): Promise<{
  registrationTicket: string;
  authRequestId: string;
  email: string;
}> {
  const nameParts = splitOwnerFullNameForZitadel(params.fullName || '');
  const email = (params.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
    throw new ZitadelLoginUiError('INVALID_EMAIL', 400);
  }
  validateOwnerRegistrationPassword(params.password, params.confirmPassword);

  const locale = normalizeAuthEmailLocale(params.lang);
  const config = params.config ?? getConfig(params.origin);
  ensureAuthEmailReady(config, {
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
  });
  const fetchImpl = params.fetchImpl ?? fetch;

  let resolvedAuthRequestId = (params.authRequestId || '').trim();
  if (!resolvedAuthRequestId && params.oidc) {
    resolvedAuthRequestId = await bootstrapZitadelOidcAuthRequestId({
      oidc: {
        ...params.oidc,
        loginHint: email,
        lang: locale,
      },
      origin: params.origin,
      config,
      fetchImpl,
    });
  }
  if (!AUTH_REQUEST_ID_REGEX.test(resolvedAuthRequestId)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }

  const authRequest = await fetchZitadelLoginRequest(
    resolvedAuthRequestId,
    params.origin,
    { config, fetchImpl }
  );
  const clientKind: 'web' | 'mobile' =
    authRequest.clientId === config.mobileClientId ? 'mobile' : 'web';

  // Use an unguessable temporary credential during initial user creation so the
  // user-supplied password is never active on an unverified identity.
  const temporaryPassword = generateTemporaryRegistrationPassword();

  let createdUser: {
    id?: unknown;
    userId?: unknown;
    emailCode?: unknown;
    verificationCode?: unknown;
    code?: unknown;
    user?: {
      id?: unknown;
      userId?: unknown;
      emailCode?: unknown;
      verificationCode?: unknown;
      code?: unknown;
    };
  };
  try {
    createdUser = await callZitadel<typeof createdUser>(
      config,
      '/v2/users/new',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(config.organizationId
            ? { organizationId: config.organizationId }
            : {}),
          username: email,
          human: {
            profile: {
              givenName: nameParts.givenName,
              familyName: nameParts.familyName,
              displayName: nameParts.displayName,
              preferredLanguage: locale,
            },
            email: {
              email,
              returnCode: {},
            },
            password: {
              password: temporaryPassword,
              changeRequired: false,
            },
          },
        }),
      },
      fetchImpl,
      {
        bearerToken: config.serviceToken,
        mapError: (status, payload) => {
          if (isZitadelDuplicateUserError(status, payload)) {
            return new ZitadelLoginUiError('EMAIL_ALREADY_EXISTS', 409);
          }
          const msg = JSON.stringify(payload || {}).toLowerCase();
          if (status === 400) {
            if (msg.includes('password') || msg.includes('complexity')) {
              return new ZitadelLoginUiError('PASSWORD_WEAK', 400);
            }
            if (msg.includes('email')) {
              return new ZitadelLoginUiError('INVALID_EMAIL', 400);
            }
            return new ZitadelLoginUiError('REGISTRATION_REJECTED', 400);
          }
          if (status === 401 || status === 403) {
            return new ZitadelLoginUiError(
              'REGISTRATION_SERVICE_NOT_CONFIGURED',
              503
            );
          }
          return null;
        },
      }
    );
  } catch (err) {
    if (
      err instanceof ZitadelLoginUiError &&
      err.code === 'EMAIL_ALREADY_EXISTS'
    ) {
      const recovered = await tryRecoverUnverifiedZitadelUser({
        email,
        fullName: nameParts.displayName,
        authRequestId: authRequest.id,
        clientKind,
        lang: locale,
        origin: params.origin,
        config,
        fetchImpl,
        nowSeconds: params.nowSeconds,
        smtpConfig: params.smtpConfig,
        sendEmail: params.sendEmail,
      });
      if (recovered) {
        return recovered;
      }

      // Keep register_start indistinguishable for existing and new addresses.
      // The existing account receives reset instructions; a short-lived decoy
      // ticket keeps the public response shape the same without changing its
      // password or account state.
      try {
        await requestZitadelPasswordReset({
          email,
          lang: locale,
          origin: params.origin,
          clientIp: params.clientIp,
          fetchImpl,
          config,
          nowMs:
            params.nowSeconds !== undefined
              ? params.nowSeconds * 1000
              : undefined,
          smtpConfig: params.smtpConfig ?? config.smtpConfig,
          sendEmail: params.sendEmail ?? config.sendEmail,
        });
      } catch {
        // Preserve the same public registration response when mail delivery is
        // throttled or unavailable. The reset endpoint logs delivery failures.
      }
      return {
        registrationTicket: issueZitadelRegistrationTicket({
          userId: crypto.randomUUID(),
          email,
          fullName: nameParts.displayName,
          authRequestId: authRequest.id,
          clientKind,
          lang: locale,
          nowSeconds: params.nowSeconds,
        }),
        authRequestId: authRequest.id,
        email,
      };
    }
    throw err;
  }

  const userId = extractCreatedZitadelUserId(createdUser);
  if (!userId || !USER_ID_REGEX.test(userId)) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  const verificationCode = extractZitadelReturnedCode(
    createdUser,
    VERIFICATION_CODE_REGEX
  );
  if (!verificationCode) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  try {
    await sendQlaokRegistrationVerificationEmail({
      to: email,
      fullName: nameParts.displayName,
      verificationCode,
      lang: locale,
      origin: params.origin,
      isResend: false,
      issuerUrl: config.issuerUrl,
      webRedirectUri: config.webRedirectUri,
      smtpConfig: params.smtpConfig ?? config.smtpConfig,
      sendEmail: params.sendEmail ?? config.sendEmail,
    });
  } catch (err) {
    throw mapAuthEmailErrorToLoginUiError(err);
  }

  const registrationTicket = issueZitadelRegistrationTicket({
    userId,
    email,
    fullName: nameParts.displayName,
    authRequestId: authRequest.id,
    clientKind,
    lang: locale,
    nowSeconds: params.nowSeconds,
  });

  return {
    registrationTicket,
    authRequestId: authRequest.id,
    email,
  };
}

export async function resendZitadelRegistrationCode(params: {
  registrationTicket: string;
  lang?: 'vi' | 'en';
  origin: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
  nowSeconds?: number;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
}): Promise<{ email: string }> {
  const ticket = verifyZitadelRegistrationTicket(
    params.registrationTicket,
    params.nowSeconds
  );
  const locale = normalizeAuthEmailLocale(params.lang ?? ticket.lang);
  const config = params.config ?? getConfig(params.origin);
  ensureAuthEmailReady(config, {
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
  });
  const fetchImpl = params.fetchImpl ?? fetch;

  await fetchZitadelLoginRequest(ticket.authRequestId, params.origin, {
    config,
    fetchImpl,
  });

  const resendPayload = await callZitadel<Record<string, unknown>>(
    config,
    `/v2/users/${encodeURIComponent(ticket.userId)}/email/resend`,
    {
      method: 'POST',
      body: JSON.stringify({
        returnCode: {},
      }),
    },
    fetchImpl,
    {
      bearerToken: config.serviceToken,
      mapError: (status, payload) => {
        if (status === 404) {
          return new ZitadelLoginUiError('REGISTRATION_EXPIRED', 400);
        }
        if (status === 401 || status === 403) {
          return new ZitadelLoginUiError(
            'REGISTRATION_SERVICE_NOT_CONFIGURED',
            503
          );
        }
        if (status === 400 || status === 409) {
          const msg = JSON.stringify(payload || {}).toLowerCase();
          if (msg.includes('already verified') || msg.includes('already_verified')) {
            return new ZitadelLoginUiError(
              'REGISTRATION_VERIFIED_LOGIN_REQUIRED',
              409
            );
          }
          return new ZitadelLoginUiError('REGISTRATION_RESEND_FAILED', 400);
        }
        return null;
      },
    }
  );

  const verificationCode = extractZitadelReturnedCode(
    resendPayload,
    VERIFICATION_CODE_REGEX
  );
  if (!verificationCode) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  try {
    await sendQlaokRegistrationVerificationEmail({
      to: ticket.email,
      fullName: ticket.fullName,
      verificationCode,
      lang: locale,
      origin: params.origin,
      isResend: true,
      issuerUrl: config.issuerUrl,
      webRedirectUri: config.webRedirectUri,
      smtpConfig: params.smtpConfig ?? config.smtpConfig,
      sendEmail: params.sendEmail ?? config.sendEmail,
    });
  } catch (err) {
    throw mapAuthEmailErrorToLoginUiError(err);
  }

  await resetRegistrationVerifyFailureBucket(
    `reg_verify_fail:ticket:${ticket.userId}:${ticket.iat}`
  );
  await resetRegistrationVerifyFailureBucket(
    `reg_verify_fail:user:${ticket.userId}`
  );

  return { email: ticket.email };
}

export async function completeZitadelRegistrationVerification(params: {
  registrationTicket: string;
  verificationCode: string;
  password: string;
  origin: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
  nowSeconds?: number;
}): Promise<{ callbackUrl: string; email: string; fullName: string }> {
  const ticket = verifyZitadelRegistrationTicket(
    params.registrationTicket,
    params.nowSeconds
  );
  const cleanCode = (params.verificationCode || '')
    .trim()
    .replace(/[\s-]+/g, '');
  if (!VERIFICATION_CODE_REGEX.test(cleanCode)) {
    throw new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
  }
  validateOwnerRegistrationPassword(params.password);

  const nowMs =
    params.nowSeconds !== undefined ? params.nowSeconds * 1000 : Date.now();
  const ticketLockKey = `reg_verify_fail:ticket:${ticket.userId}:${ticket.iat}`;
  const userLockKey = `reg_verify_fail:user:${ticket.userId}`;

  await checkRegistrationVerifyFailureBucket(ticketLockKey, nowMs);
  await checkRegistrationVerifyFailureBucket(userLockKey, nowMs);

  const config = params.config ?? getConfig(params.origin);
  const fetchImpl = params.fetchImpl ?? fetch;

  try {
    await callZitadel<Record<string, unknown>>(
      config,
      `/v2/users/${encodeURIComponent(ticket.userId)}/email/verify`,
      {
        method: 'POST',
        body: JSON.stringify({
          verificationCode: cleanCode,
        }),
      },
      fetchImpl,
      {
        bearerToken: config.serviceToken,
        mapError: (status, payload) => {
          const msg = JSON.stringify(payload || {}).toLowerCase();
          if (status === 404) {
            return new ZitadelLoginUiError('REGISTRATION_EXPIRED', 400);
          }
          if (status === 400) {
            if (msg.includes('expired') || msg.includes('timeout')) {
              return new ZitadelLoginUiError('VERIFICATION_CODE_EXPIRED', 400);
            }
            return new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
          }
          if (status === 401 || status === 403) {
            return new ZitadelLoginUiError(
              'REGISTRATION_SERVICE_NOT_CONFIGURED',
              503
            );
          }
          return null;
        },
      }
    );
  } catch (err) {
    if (
      err instanceof ZitadelLoginUiError &&
      (err.code === 'VERIFICATION_CODE_INVALID' ||
        err.code === 'VERIFICATION_CODE_EXPIRED')
    ) {
      const ticketLocked = await recordRegistrationVerifyFailureBucket(
        ticketLockKey,
        nowMs
      );
      const userLocked = await recordRegistrationVerifyFailureBucket(
        userLockKey,
        nowMs
      );
      if (ticketLocked || userLocked) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
    }
    throw err;
  }

  // Only set the user's chosen password AFTER email verification code succeeds
  // via the supported UpdateUser contract (PATCH /v2/users/{userId}).
  await callZitadel<Record<string, unknown>>(
    config,
    `/v2/users/${encodeURIComponent(ticket.userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        human: {
          password: {
            password: {
              password: params.password,
              changeRequired: false,
            },
          },
        },
      }),
    },
    fetchImpl,
    {
      bearerToken: config.serviceToken,
      mapError: (status, payload) => {
        const msg = JSON.stringify(payload || {}).toLowerCase();
        if (status === 404) {
          return new ZitadelLoginUiError('REGISTRATION_EXPIRED', 400);
        }
        if (status === 400) {
          if (msg.includes('password') || msg.includes('complexity')) {
            return new ZitadelLoginUiError('PASSWORD_WEAK', 400);
          }
          return new ZitadelLoginUiError('REGISTRATION_REJECTED', 400);
        }
        if (status === 401 || status === 403) {
          return new ZitadelLoginUiError(
            'REGISTRATION_SERVICE_NOT_CONFIGURED',
            503
          );
        }
        return null;
      },
    }
  );

  await resetRegistrationVerifyFailureBucket(ticketLockKey);
  await resetRegistrationVerifyFailureBucket(userLockKey);

  let callbackUrl: string;
  try {
    callbackUrl = await completeZitadelLoginRequest({
      authRequestId: ticket.authRequestId,
      loginName: ticket.email,
      password: params.password,
      origin: params.origin,
      fetchImpl,
      config,
    });
  } catch {
    // Email verification and password setup succeeded, so the account is active and
    // ready for direct sign-in even if the pending OIDC authRequest expired.
    throw new ZitadelLoginUiError('REGISTRATION_VERIFIED_LOGIN_REQUIRED', 409);
  }

  return {
    callbackUrl,
    email: ticket.email,
    fullName: ticket.fullName,
  };
}

function resolvePasswordResetQlaokOrigin(
  rawOrigin: string,
  config?: Pick<ZitadelLoginUiConfig, 'issuerUrl' | 'webRedirectUri'>
): string {
  return resolveTrustedQlaokEmailOrigin(rawOrigin, {
    issuerUrl: config?.issuerUrl,
    webRedirectUri: config?.webRedirectUri,
  });
}

export function buildZitadelPasswordResetUrlTemplate(
  origin = 'https://qlaok.vunph.click',
  config?: Pick<ZitadelLoginUiConfig, 'issuerUrl' | 'webRedirectUri'>
): string {
  const resolvedOrigin = resolvePasswordResetQlaokOrigin(origin, config);
  return `${resolvedOrigin}/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}`;
}

export function buildQlaokPasswordResetUrl(params: {
  origin?: string;
  userId: string;
  code: string;
  orgId?: string;
  lang?: 'vi' | 'en';
  config?: Pick<
    ZitadelLoginUiConfig,
    'issuerUrl' | 'webRedirectUri' | 'organizationId'
  >;
}): string {
  const userId = (params.userId || '').trim();
  const code = normalizePasswordResetVerificationCode(params.code);
  if (
    !userId ||
    !USER_ID_REGEX.test(userId) ||
    userId.startsWith('staff-acct-')
  ) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }
  const resolvedOrigin = resolvePasswordResetQlaokOrigin(
    params.origin || 'https://qlaok.vunph.click',
    params.config
  );
  const query = new URLSearchParams({
    mode: 'reset',
    userID: userId,
    code,
  });
  const orgId = (
    params.orgId ??
    params.config?.organizationId ??
    ''
  ).trim();
  if (orgId && USER_ID_REGEX.test(orgId)) {
    query.set('orgID', orgId);
  }
  if (params.lang === 'en' || params.lang === 'vi') {
    query.set('lang', params.lang);
  }
  return `${resolvedOrigin}/login?${query.toString()}`;
}

function normalizePasswordResetEmail(rawEmail: string): string {
  if (typeof rawEmail !== 'string') {
    throw new ZitadelLoginUiError('INVALID_EMAIL', 400);
  }
  const stripped = rawEmail.replace(/[\u0000-\u001F\u007F]/g, '');
  if (stripped !== rawEmail) {
    throw new ZitadelLoginUiError('INVALID_EMAIL', 400);
  }
  const email = stripped.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
    throw new ZitadelLoginUiError('INVALID_EMAIL', 400);
  }
  return email;
}

function normalizePasswordResetVerificationCode(rawCode: string): string {
  if (typeof rawCode !== 'string') {
    throw new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
  }
  const stripped = rawCode.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!stripped || stripped !== rawCode.trim()) {
    throw new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
  }
  const cleaned = /^\d+(?:[\s-]+\d+)+$/.test(stripped)
    ? stripped.replace(/[\s-]+/g, '')
    : stripped.replace(/\s+/g, '');
  if (!PASSWORD_RESET_CODE_REGEX.test(cleaned)) {
    throw new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
  }
  return cleaned;
}

function extractEligiblePasswordResetHumanUser(
  searchResult: { result?: unknown[] } | null | undefined,
  expectedEmail: string
): { userId: string; displayName?: string } | null {
  if (
    !searchResult ||
    !Array.isArray(searchResult.result) ||
    searchResult.result.length !== 1
  ) {
    return null;
  }
  const rawUser = searchResult.result[0];
  if (!rawUser || typeof rawUser !== 'object' || Array.isArray(rawUser)) {
    return null;
  }
  const userRecord = rawUser as Record<string, unknown>;
  if (userRecord.machine) {
    return null;
  }
  const userId =
    typeof userRecord.userId === 'string' && userRecord.userId.trim()
      ? userRecord.userId.trim()
      : typeof userRecord.id === 'string' && userRecord.id.trim()
        ? userRecord.id.trim()
        : '';
  if (
    !userId ||
    !USER_ID_REGEX.test(userId) ||
    userId.startsWith('staff-acct-')
  ) {
    return null;
  }
  if (typeof userRecord.state === 'string' && userRecord.state.trim()) {
    const normalizedState = userRecord.state
      .trim()
      .replace(/^USER_STATE_/i, '')
      .toLowerCase();
    if (
      normalizedState === 'inactive' ||
      normalizedState === 'deleted' ||
      normalizedState === 'locked' ||
      normalizedState === 'suspended'
    ) {
      return null;
    }
  }
  const humanRecord =
    userRecord.human &&
    typeof userRecord.human === 'object' &&
    !Array.isArray(userRecord.human)
      ? (userRecord.human as Record<string, unknown>)
      : null;
  const emailRecord =
    humanRecord?.email &&
    typeof humanRecord.email === 'object' &&
    !Array.isArray(humanRecord.email)
      ? (humanRecord.email as Record<string, unknown>)
      : null;
  if (!emailRecord) {
    return null;
  }
  const candidateEmail =
    typeof emailRecord.email === 'string' && emailRecord.email.trim()
      ? emailRecord.email.trim().toLowerCase()
      : typeof emailRecord.emailAddress === 'string' &&
          emailRecord.emailAddress.trim()
        ? emailRecord.emailAddress.trim().toLowerCase()
        : '';
  if (candidateEmail !== expectedEmail || emailRecord.isVerified !== true) {
    return null;
  }
  const profileRecord =
    humanRecord?.profile &&
    typeof humanRecord.profile === 'object' &&
    !Array.isArray(humanRecord.profile)
      ? (humanRecord.profile as Record<string, unknown>)
      : null;
  const displayName =
    typeof profileRecord?.displayName === 'string' &&
    profileRecord.displayName.trim()
      ? profileRecord.displayName.trim()
      : typeof profileRecord?.givenName === 'string' &&
          profileRecord.givenName.trim()
        ? profileRecord.givenName.trim()
        : undefined;
  return { userId, ...(displayName ? { displayName } : {}) };
}

export async function requestZitadelPasswordReset(params: {
  email: string;
  lang?: 'vi' | 'en';
  origin: string;
  clientIp?: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
  nowMs?: number;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
}): Promise<{ ok: true }> {
  const email = normalizePasswordResetEmail(params.email);
  const locale = normalizeAuthEmailLocale(params.lang);
  const config = params.config ?? getConfig(params.origin);
  ensureAuthEmailReady(config, {
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
  });
  const fetchImpl = params.fetchImpl ?? fetch;
  const nowMs = params.nowMs ?? Date.now();
  const normalizedIp =
    (params.clientIp || 'unknown').trim().toLowerCase() || 'unknown';

  await enforceZitadelLoginUiRateLimit(
    `password_reset_request:ip:${normalizedIp}`,
    PASSWORD_RESET_REQUEST_IP_MAX_ATTEMPTS,
    LOGIN_UI_RATE_LIMIT_WINDOW_MS,
    nowMs
  );
  await enforceZitadelLoginUiRateLimit(
    `password_reset_request:email:${email}`,
    PASSWORD_RESET_REQUEST_EMAIL_MAX_ATTEMPTS,
    LOGIN_UI_RATE_LIMIT_WINDOW_MS,
    nowMs
  );

  const searchResult = await callZitadel<{ result?: unknown[] }>(
    config,
    '/v2/users',
    {
      method: 'POST',
      body: JSON.stringify({
        query: {
          offset: '0',
          limit: 2,
          asc: true,
        },
        queries: [
          {
            emailQuery: {
              emailAddress: email,
              method: 'TEXT_QUERY_METHOD_EQUALS',
            },
          },
        ],
      }),
    },
    fetchImpl,
    {
      bearerToken: config.serviceToken,
      mapError: (status) => {
        if (status === 401 || status === 403) {
          return new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
        }
        return new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
      },
    }
  );

  const eligibleUser = extractEligiblePasswordResetHumanUser(
    searchResult,
    email
  );
  if (!eligibleUser) {
    return { ok: true };
  }

  try {
    const resetPayload = await callZitadel<Record<string, unknown>>(
      config,
      `/v2/users/${encodeURIComponent(eligibleUser.userId)}/password_reset`,
      {
        method: 'POST',
        body: JSON.stringify({
          returnCode: {},
        }),
      },
      fetchImpl,
      {
        bearerToken: config.serviceToken,
        mapError: (status) => {
          if (status === 401 || status === 403) {
            return new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
          }
          return new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
        },
      }
    );

    const verificationCode = extractZitadelReturnedCode(
      resetPayload,
      PASSWORD_RESET_CODE_REGEX
    );
    if (!verificationCode) {
      throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
    }

    const resetUrl = buildQlaokPasswordResetUrl({
      origin: params.origin,
      userId: eligibleUser.userId,
      code: verificationCode,
      orgId: config.organizationId,
      lang: locale,
      config,
    });

    await sendQlaokPasswordResetEmail({
      to: email,
      displayName: eligibleUser.displayName,
      resetUrl,
      lang: locale,
      origin: params.origin,
      issuerUrl: config.issuerUrl,
      webRedirectUri: config.webRedirectUri,
      smtpConfig: params.smtpConfig ?? config.smtpConfig,
      sendEmail: params.sendEmail ?? config.sendEmail,
    });

    await resetRegistrationVerifyFailureBucket(
      `password_reset_fail:user:${eligibleUser.userId}`
    );
  } catch {
    // Keep the public response identical to an unknown account. Operational
    // logs must not contain the recipient, reset code, URL, or provider error.
    console.error('Password reset email processing failed');
  }

  return { ok: true };
}

export async function completeZitadelPasswordReset(params: {
  userID: string;
  code: string;
  password: string;
  confirmPassword?: string;
  lang?: 'vi' | 'en';
  origin: string;
  clientIp?: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
  nowMs?: number;
}): Promise<{ ok: true }> {
  const rawUserId =
    typeof params.userID === 'string' ? params.userID.trim() : '';
  if (
    !rawUserId ||
    !USER_ID_REGEX.test(rawUserId) ||
    rawUserId.startsWith('staff-acct-')
  ) {
    throw new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
  }
  const cleanCode = normalizePasswordResetVerificationCode(params.code);
  validateOwnerRegistrationPassword(params.password, params.confirmPassword);

  const config = params.config ?? getConfig(params.origin);
  const fetchImpl = params.fetchImpl ?? fetch;
  const nowMs = params.nowMs ?? Date.now();
  const normalizedIp =
    (params.clientIp || 'unknown').trim().toLowerCase() || 'unknown';
  const userLockKey = `password_reset_fail:user:${rawUserId}`;

  await enforceZitadelLoginUiRateLimit(
    `password_reset_complete:ip:${normalizedIp}`,
    PASSWORD_RESET_COMPLETE_IP_MAX_ATTEMPTS,
    LOGIN_UI_RATE_LIMIT_WINDOW_MS,
    nowMs
  );
  await checkRegistrationVerifyFailureBucket(userLockKey, nowMs);

  try {
    await callZitadel<Record<string, unknown>>(
      config,
      `/v2/users/${encodeURIComponent(rawUserId)}/password`,
      {
        method: 'POST',
        body: JSON.stringify({
          newPassword: {
            password: params.password,
            changeRequired: false,
          },
          verificationCode: cleanCode,
        }),
      },
      fetchImpl,
      {
        bearerToken: config.serviceToken,
        mapError: (status, payload) => {
          const msg = JSON.stringify(payload || {}).toLowerCase();
          if (status === 404) {
            return new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
          }
          if (status === 400) {
            if (msg.includes('expired') || msg.includes('timeout')) {
              return new ZitadelLoginUiError('VERIFICATION_CODE_EXPIRED', 400);
            }
            if (
              msg.includes('code') ||
              msg.includes('token') ||
              msg.includes('verify') ||
              msg.includes('verification')
            ) {
              return new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
            }
            if (
              msg.includes('complexity') ||
              msg.includes('policy') ||
              msg.includes('weak') ||
              msg.includes('symbol') ||
              msg.includes('uppercase') ||
              msg.includes('lowercase') ||
              msg.includes('number') ||
              msg.includes('length')
            ) {
              return new ZitadelLoginUiError('PASSWORD_WEAK', 400);
            }
            return new ZitadelLoginUiError('VERIFICATION_CODE_INVALID', 400);
          }
          if (status === 401 || status === 403) {
            return new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
          }
          return new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
        },
      }
    );
  } catch (err) {
    if (
      err instanceof ZitadelLoginUiError &&
      (err.code === 'VERIFICATION_CODE_INVALID' ||
        err.code === 'VERIFICATION_CODE_EXPIRED')
    ) {
      const userLocked = await recordRegistrationVerifyFailureBucket(
        userLockKey,
        nowMs
      );
      if (userLocked) {
        throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
      }
    }
    throw err;
  }

  await resetRegistrationVerifyFailureBucket(userLockKey);

  return { ok: true };
}
