import crypto from 'node:crypto';
import type { NextResponse } from 'next/server';
import { sanitizeNextPath } from '@/lib/post-login-route';
import { getSupabaseDbClient } from '@/lib/db';
import { isSuperAdminEmail } from '@/lib/auth-session';
import type { PlanTier, Profile } from '@/types/qlaok';

type SubscriptionPlan = PlanTier;

export const DEFAULT_ZITADEL_ISSUER_URL = 'https://auth.vunph.click';
export const DEFAULT_PRODUCTION_CALLBACK_URL =
  'https://qlaok.vunph.click/api/auth/callback';
export const DEFAULT_MOBILE_REDIRECT_URI = 'qlaok://auth/callback';
export const OIDC_TX_COOKIE_NAME = 'qlaok_oidc_tx';
export const OIDC_TX_TTL_SECONDS = 10 * 60; // 10 minutes

const UUID_SUB_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_CLIENT_ID_REGEX =
  /^(?:your[-_]|placeholder|changeme|todo|example|unset)/i;
const PKCE_CODE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;

const ALLOWED_JWS_ALGS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;

export type OidcAuthMode = 'login' | 'register' | 'reset';

export interface OidcTransactionPayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  nextPath: string;
  mode: OidcAuthMode;
  iat: number;
  exp: number;
}
export interface ZitadelDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

export interface ZitadelJwk extends crypto.JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
  kty?: string;
}

export interface ZitadelJwksDocument {
  keys: ZitadelJwk[];
}

export interface ZitadelTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
}

export interface VerifiedZitadelJwtClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  email?: string;
  emailVerified?: boolean;
  fullName?: string;
  phone?: string;
  rawClaims: Record<string, unknown>;
}

export class ZitadelOidcError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ZitadelOidcError';
    this.code = code;
    this.status = status;
  }
}

export interface ZitadelOidcTestHooks {
  fetch?: typeof globalThis.fetch;
  discovery?: ZitadelDiscoveryDocument | null;
  jwks?: ZitadelJwksDocument | null;
  nowSeconds?: () => number;
}

let testHooks: ZitadelOidcTestHooks | null = null;
let discoveryCache: {
  issuerUrl: string;
  doc: ZitadelDiscoveryDocument;
  expiresAtMs: number;
} | null = null;
let jwksCache: {
  jwksUri: string;
  doc: ZitadelJwksDocument;
  expiresAtMs: number;
} | null = null;

export function setZitadelOidcTestHooks(
  hooks: ZitadelOidcTestHooks | null
): void {
  testHooks = hooks;
}

export function clearZitadelOidcCaches(): void {
  discoveryCache = null;
  jwksCache = null;
}

function getNowSeconds(): number {
  if (testHooks?.nowSeconds) {
    return testHooks.nowSeconds();
  }
  return Math.floor(Date.now() / 1000);
}

function getFetchImpl(): typeof globalThis.fetch {
  return testHooks?.fetch ?? globalThis.fetch;
}

export function normalizeIssuerUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '');
}

export function getZitadelIssuerUrl(): string {
  const configured =
    process.env.ZITADEL_ISSUER_URL ||
    process.env.NEXT_PUBLIC_ZITADEL_ISSUER_URL ||
    DEFAULT_ZITADEL_ISSUER_URL;
  return normalizeIssuerUrl(configured);
}

export function isPlaceholderOidcClientId(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_CLIENT_ID_REGEX.test(trimmed);
}

export function getZitadelClientId(): string {
  const candidates = [
    process.env.ZITADEL_CLIENT_ID,
    process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID,
  ];
  for (const candidate of candidates) {
    if (candidate && !isPlaceholderOidcClientId(candidate)) {
      return candidate.trim();
    }
  }
  return '';
}

export function getZitadelMobileClientId(): string {
  const candidates = [
    process.env.ZITADEL_MOBILE_CLIENT_ID,
    process.env.EXPO_PUBLIC_ZITADEL_CLIENT_ID,
    process.env.ZITADEL_CLIENT_ID,
    process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID,
  ];
  for (const candidate of candidates) {
    if (candidate && !isPlaceholderOidcClientId(candidate)) {
      return candidate.trim();
    }
  }
  return '';
}

export function resolveMobileZitadelRedirectUri(): string {
  const configured = (
    process.env.ZITADEL_MOBILE_REDIRECT_URI ||
    process.env.EXPO_PUBLIC_ZITADEL_REDIRECT_URI ||
    DEFAULT_MOBILE_REDIRECT_URI
  ).trim();
  return configured || DEFAULT_MOBILE_REDIRECT_URI;
}

export function isValidMobileRedirectUri(rawUri?: string | null): boolean {
  if (!rawUri || typeof rawUri !== 'string') return false;
  return rawUri.trim() === resolveMobileZitadelRedirectUri();
}

export function isValidPkceCodeVerifier(rawVerifier?: string | null): boolean {
  if (!rawVerifier || typeof rawVerifier !== 'string') return false;
  return PKCE_CODE_VERIFIER_REGEX.test(rawVerifier.trim());
}

export function resolveZitadelRedirectUri(requestOrigin: string): string {
  const configured = (process.env.ZITADEL_REDIRECT_URI || '').trim();
  if (configured) {
    return configured;
  }
  const normalizedOrigin = (requestOrigin || 'https://qlaok.vunph.click')
    .trim()
    .replace(/\/+$/, '');
  return `${normalizedOrigin}/api/auth/callback`;
}

/**
 * Validates that a Zitadel `sub` claim is a canonical UUID matching `public.profiles.id`.
 * Rejects leading/trailing whitespace, staff subjects (`staff-acct-*`), numeric IDs,
 * and malformed strings while preserving hex case compatibility.
 */
export function isValidUuidSub(sub: unknown): sub is string {
  if (typeof sub !== 'string') return false;
  if (!sub || sub.startsWith('staff-acct-')) return false;
  return UUID_SUB_REGEX.test(sub);
}

/**
 * OIDC subjects are opaque, case-sensitive identifiers. Keep this separate
 * from isValidUuidSub, which protects Qlaok/PostgREST UUID user IDs.
 */
export function isValidZitadelSub(sub: unknown): sub is string {
  return (
    typeof sub === 'string' &&
    sub.length > 0 &&
    sub.length <= 128 &&
    /^[\x21-\x7E]+$/.test(sub) &&
    !sub.startsWith('staff-acct-')
  );
}

function getOidcSigningSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.trim().length >= 16) {
    return crypto
      .createHmac('sha256', 'qlaok-oidc-tx-v1')
      .update(configured.trim())
      .digest('hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new ZitadelOidcError(
      'OIDC_SESSION_SECRET_MISSING',
      'Missing SESSION_SECRET (at least 16 characters) in production.',
      500
    );
  }
  return 'qlaok-local-dev-oidc-tx-secret-do-not-use-in-prod';
}

export function generateRandomUrlSafe(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function computeS256CodeChallenge(codeVerifier: string): string {
  return crypto
    .createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url');
}

export function createPkcePair(customVerifier?: string): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  const codeVerifier = customVerifier || generateRandomUrlSafe(32);
  const codeChallenge = computeS256CodeChallenge(codeVerifier);
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

export function generateOidcState(): string {
  return generateRandomUrlSafe(24);
}

export function generateOidcNonce(): string {
  return generateRandomUrlSafe(24);
}

export function normalizeOidcAuthMode(raw?: string | null): OidcAuthMode {
  if (raw === 'register' || raw === 'signup') return 'register';
  if (raw === 'reset' || raw === 'recovery') return 'reset';
  return 'login';
}

export function issueOidcTransactionCookieValue(
  input: {
    state?: string;
    nonce?: string;
    codeVerifier?: string;
    redirectUri: string;
    nextPath?: string | null;
    mode?: string | null;
  },
  ttlSeconds = OIDC_TX_TTL_SECONDS
): {
  cookieValue: string;
  transaction: OidcTransactionPayload;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  const now = getNowSeconds();
  const state = input.state || generateOidcState();
  const nonce = input.nonce || generateOidcNonce();
  const pkce = createPkcePair(input.codeVerifier);
  const transaction: OidcTransactionPayload = {
    state,
    nonce,
    codeVerifier: pkce.codeVerifier,
    redirectUri: input.redirectUri,
    nextPath: sanitizeNextPath(input.nextPath) || '/dashboard',
    mode: normalizeOidcAuthMode(input.mode),
    iat: now,
    exp: now + ttlSeconds,
  };

  const payloadB64 = Buffer.from(JSON.stringify(transaction), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', getOidcSigningSecret())
    .update(payloadB64)
    .digest('base64url');

  return {
    cookieValue: `${payloadB64}.${sig}`,
    transaction,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  };
}

export function verifyOidcTransactionCookieValue(
  rawCookie: string | null | undefined,
  nowSecondsOverride?: number
): OidcTransactionPayload | null {
  if (!rawCookie || typeof rawCookie !== 'string') return null;
  const trimmed = rawCookie.trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx <= 0) return null;

  const payloadB64 = trimmed.slice(0, dotIdx);
  const sig = trimmed.slice(dotIdx + 1);
  if (!payloadB64 || !sig) return null;

  let expectedSig: string;
  try {
    expectedSig = crypto
      .createHmac('sha256', getOidcSigningSecret())
      .update(payloadB64)
      .digest('base64url');
  } catch {
    return null;
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as OidcTransactionPayload;
    if (
      !decoded ||
      typeof decoded.state !== 'string' ||
      !decoded.state ||
      typeof decoded.nonce !== 'string' ||
      !decoded.nonce ||
      typeof decoded.codeVerifier !== 'string' ||
      !decoded.codeVerifier ||
      typeof decoded.redirectUri !== 'string' ||
      !decoded.redirectUri ||
      typeof decoded.exp !== 'number'
    ) {
      return null;
    }
    const now = nowSecondsOverride ?? getNowSeconds();
    if (decoded.exp <= now) {
      return null;
    }
    return {
      state: decoded.state,
      nonce: decoded.nonce,
      codeVerifier: decoded.codeVerifier,
      redirectUri: decoded.redirectUri,
      nextPath: sanitizeNextPath(decoded.nextPath) || '/dashboard',
      mode: normalizeOidcAuthMode(decoded.mode),
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

export function readOidcTransactionFromRequest(
  req: Request
): OidcTransactionPayload | null {
  const cookieHeader = req.headers.get('cookie') || '';
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name === OIDC_TX_COOKIE_NAME) {
      const rawVal = decodeURIComponent(part.slice(eqIdx + 1).trim());
      return verifyOidcTransactionCookieValue(rawVal);
    }
  }
  return null;
}

export function attachOidcTransactionCookie(
  res: NextResponse,
  cookieValue: string,
  maxAgeSeconds = OIDC_TX_TTL_SECONDS
): void {
  res.cookies.set(OIDC_TX_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearOidcTransactionCookie(res: NextResponse): void {
  res.cookies.set(OIDC_TX_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export function compareConstantTimeString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function buildZitadelAuthorizeUrl(params: {
  issuerUrl?: string;
  authorizationEndpoint?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  mode?: OidcAuthMode;
  loginHint?: string;
  lang?: 'vi' | 'en';
}): string {
  const clientId = (params.clientId || '').trim();
  if (!clientId) {
    throw new ZitadelOidcError(
      'ZITADEL_CLIENT_ID_MISSING',
      'Thiếu cấu hình ZITADEL_CLIENT_ID cho xác thực OIDC.',
      500
    );
  }
  const issuer = normalizeIssuerUrl(params.issuerUrl || getZitadelIssuerUrl());
  const endpoint =
    params.authorizationEndpoint ||
    (testHooks?.discovery?.authorization_endpoint ??
      (discoveryCache?.issuerUrl === issuer
        ? discoveryCache.doc.authorization_endpoint
        : `${issuer}/oauth/v2/authorize`));

  const url = new URL(endpoint);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  if (params.mode === 'register') {
    url.searchParams.set('prompt', 'create');
  } else if (params.mode === 'login') {
    url.searchParams.set('prompt', 'login');
  }

  if (params.loginHint && params.loginHint.trim()) {
    url.searchParams.set('login_hint', params.loginHint.trim());
  }

  if (params.lang === 'vi' || params.lang === 'en') {
    url.searchParams.set('ui_locales', params.lang);
  }

  return url.toString();
}

export async function fetchZitadelDiscovery(
  issuerUrlOverride?: string
): Promise<ZitadelDiscoveryDocument> {
  const issuerUrl = normalizeIssuerUrl(
    issuerUrlOverride || getZitadelIssuerUrl()
  );

  if (testHooks?.discovery) {
    return testHooks.discovery;
  }

  const nowMs = Date.now();
  if (
    discoveryCache &&
    discoveryCache.issuerUrl === issuerUrl &&
    discoveryCache.expiresAtMs > nowMs
  ) {
    return discoveryCache.doc;
  }

  const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await getFetchImpl()(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    throw new ZitadelOidcError(
      'OIDC_DISCOVERY_FETCH_FAILED',
      `Không thể kết nối Zitadel OIDC discovery (${err instanceof Error ? err.message : 'network error'}).`,
      502
    );
  }

  if (!res.ok) {
    throw new ZitadelOidcError(
      'OIDC_DISCOVERY_HTTP_ERROR',
      `Zitadel OIDC discovery trả về HTTP ${res.status}.`,
      502
    );
  }

  const doc = (await res.json()) as Partial<ZitadelDiscoveryDocument>;
  if (
    !doc ||
    typeof doc.issuer !== 'string' ||
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.jwks_uri !== 'string'
  ) {
    throw new ZitadelOidcError(
      'OIDC_DISCOVERY_INVALID',
      'Cấu hình OIDC discovery từ Zitadel không hợp lệ.',
      502
    );
  }

  if (normalizeIssuerUrl(doc.issuer) !== issuerUrl) {
    throw new ZitadelOidcError(
      'OIDC_ISSUER_MISMATCH',
      `Zitadel discovery issuer (${doc.issuer}) không khớp với cấu hình (${issuerUrl}).`,
      502
    );
  }

  const validated: ZitadelDiscoveryDocument = {
    issuer: normalizeIssuerUrl(doc.issuer),
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    userinfo_endpoint: doc.userinfo_endpoint,
    end_session_endpoint: doc.end_session_endpoint,
    jwks_uri: doc.jwks_uri,
  };

  discoveryCache = {
    issuerUrl,
    doc: validated,
    expiresAtMs: nowMs + DISCOVERY_CACHE_TTL_MS,
  };
  return validated;
}

export async function fetchZitadelJwks(
  jwksUri: string,
  forceRefresh = false
): Promise<ZitadelJwksDocument> {
  if (testHooks?.jwks) {
    return testHooks.jwks;
  }

  const nowMs = Date.now();
  if (
    !forceRefresh &&
    jwksCache &&
    jwksCache.jwksUri === jwksUri &&
    jwksCache.expiresAtMs > nowMs
  ) {
    return jwksCache.doc;
  }

  let res: Response;
  try {
    res = await getFetchImpl()(jwksUri, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    throw new ZitadelOidcError(
      'OIDC_JWKS_FETCH_FAILED',
      `Không thể tải JWKS từ Zitadel (${err instanceof Error ? err.message : 'network error'}).`,
      502
    );
  }

  if (!res.ok) {
    throw new ZitadelOidcError(
      'OIDC_JWKS_HTTP_ERROR',
      `Zitadel JWKS trả về HTTP ${res.status}.`,
      502
    );
  }

  const doc = (await res.json()) as Partial<ZitadelJwksDocument>;
  if (!doc || !Array.isArray(doc.keys) || doc.keys.length === 0) {
    throw new ZitadelOidcError(
      'OIDC_JWKS_INVALID',
      'JWKS từ Zitadel không chứa khóa công khai hợp lệ.',
      502
    );
  }

  const validated: ZitadelJwksDocument = { keys: doc.keys };
  jwksCache = {
    jwksUri,
    doc: validated,
    expiresAtMs: nowMs + JWKS_CACHE_TTL_MS,
  };
  return validated;
}

export async function exchangeZitadelAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
  issuerUrl?: string;
}): Promise<ZitadelTokenResponse> {
  const clientId = (params.clientId ?? getZitadelClientId()).trim();
  if (!clientId) {
    throw new ZitadelOidcError(
      'ZITADEL_CLIENT_ID_MISSING',
      'Thiếu cấu hình ZITADEL_CLIENT_ID.',
      500
    );
  }

  const discovery = await fetchZitadelDiscovery(params.issuerUrl);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  let res: Response;
  try {
    res = await getFetchImpl()(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      cache: 'no-store',
    });
  } catch (err) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_EXCHANGE_FAILED',
      `Không thể kết nối Zitadel token endpoint (${err instanceof Error ? err.message : 'network error'}).`,
      502
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const desc =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${res.status}`;
    throw new ZitadelOidcError(
      'OIDC_TOKEN_EXCHANGE_FAILED',
      `Đổi mã xác thực Zitadel thất bại: ${desc}`,
      401
    );
  }

  if (typeof payload.id_token !== 'string' || !payload.id_token.trim()) {
    throw new ZitadelOidcError(
      'OIDC_ID_TOKEN_MISSING',
      'Phản hồi từ Zitadel không chứa id_token.',
      401
    );
  }

  return {
    access_token:
      typeof payload.access_token === 'string'
        ? payload.access_token
        : undefined,
    token_type:
      typeof payload.token_type === 'string' ? payload.token_type : undefined,
    expires_in:
      typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
    id_token: payload.id_token,
    refresh_token:
      typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : undefined,
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
  };
}

function verifyJwsSignatureWithJwk(
  alg: string,
  signingInput: Buffer,
  signatureBytes: Buffer,
  jwk: ZitadelJwk
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: jwk as crypto.JsonWebKey,
      format: 'jwk',
    });

    switch (alg) {
      case 'RS256':
        return crypto.verify(
          'RSA-SHA256',
          signingInput,
          publicKey,
          signatureBytes
        );
      case 'RS384':
        return crypto.verify(
          'RSA-SHA384',
          signingInput,
          publicKey,
          signatureBytes
        );
      case 'RS512':
        return crypto.verify(
          'RSA-SHA512',
          signingInput,
          publicKey,
          signatureBytes
        );
      case 'PS256':
        return crypto.verify(
          'RSA-SHA256',
          signingInput,
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          },
          signatureBytes
        );
      case 'PS384':
        return crypto.verify(
          'RSA-SHA384',
          signingInput,
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          },
          signatureBytes
        );
      case 'PS512':
        return crypto.verify(
          'RSA-SHA512',
          signingInput,
          {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          },
          signatureBytes
        );
      case 'ES256':
        return crypto.verify(
          'sha256',
          signingInput,
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signatureBytes
        );
      case 'ES384':
        return crypto.verify(
          'sha384',
          signingInput,
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signatureBytes
        );
      case 'ES512':
        return crypto.verify(
          'sha512',
          signingInput,
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signatureBytes
        );
      case 'EdDSA':
        return crypto.verify(null, signingInput, publicKey, signatureBytes);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function selectCandidateJwks(
  keys: ZitadelJwk[],
  kid?: string,
  alg?: string
): ZitadelJwk[] {
  const signingKeys = keys.filter((k) => !k.use || k.use === 'sig');
  if (kid) {
    return signingKeys.filter((k) => k.kid === kid);
  }
  if (alg) {
    const byAlg = signingKeys.filter((k) => !k.alg || k.alg === alg);
    if (byAlg.length > 0) return byAlg;
  }
  return signingKeys;
}

export async function verifyZitadelJwt(
  token: string,
  options?: {
    expectedIssuer?: string;
    expectedAudience?: string;
    expectedNonce?: string;
    requireNonce?: boolean;
    clockSkewSeconds?: number;
  }
): Promise<VerifiedZitadelJwtClaims> {
  if (!token || typeof token !== 'string') {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_INVALID',
      'Token xác thực không hợp lệ.',
      401
    );
  }

  const segments = token.trim().split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_MALFORMED',
      'Định dạng JWT không hợp lệ.',
      401
    );
  }

  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      Buffer.from(segments[0], 'base64url').toString('utf8')
    ) as { alg?: unknown; kid?: unknown; typ?: unknown };
    payload = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  } catch {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_MALFORMED',
      'Không thể giải mã cấu trúc JWT.',
      401
    );
  }

  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!ALLOWED_JWS_ALGS.has(alg)) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_UNSUPPORTED_ALG',
      `Thuật toán chữ ký JWT không được phép: ${alg || 'none'}.`,
      401
    );
  }

  const expectedIssuer = normalizeIssuerUrl(
    options?.expectedIssuer ?? getZitadelIssuerUrl()
  );
  const allowedAudiences =
    options?.expectedAudience !== undefined
      ? [options.expectedAudience.trim()].filter(Boolean)
      : Array.from(
          new Set(
            [getZitadelClientId(), getZitadelMobileClientId()].filter(Boolean)
          )
        );
  if (allowedAudiences.length === 0) {
    throw new ZitadelOidcError(
      'ZITADEL_CLIENT_ID_MISSING',
      'Thiếu cấu hình ZITADEL_CLIENT_ID để kiểm tra audience.',
      500
    );
  }

  const discovery = await fetchZitadelDiscovery(expectedIssuer);
  const kid = typeof header.kid === 'string' ? header.kid : undefined;

  let jwksDoc = await fetchZitadelJwks(discovery.jwks_uri, false);
  let candidates = selectCandidateJwks(jwksDoc.keys, kid, alg);
  if (candidates.length === 0 && kid) {
    jwksDoc = await fetchZitadelJwks(discovery.jwks_uri, true);
    candidates = selectCandidateJwks(jwksDoc.keys, kid, alg);
  }
  if (candidates.length === 0) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_KEY_NOT_FOUND',
      'Không tìm thấy khóa công khai JWKS phù hợp để xác thực chữ ký JWT.',
      401
    );
  }

  const signingInput = Buffer.from(`${segments[0]}.${segments[1]}`, 'ascii');
  const signatureBytes = Buffer.from(segments[2], 'base64url');
  const signatureValid = candidates.some((jwk) =>
    verifyJwsSignatureWithJwk(alg, signingInput, signatureBytes, jwk)
  );
  if (!signatureValid) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_INVALID_SIGNATURE',
      'Chữ ký JWT Zitadel không hợp lệ.',
      401
    );
  }

  const tokenIssuer =
    typeof payload.iss === 'string' ? normalizeIssuerUrl(payload.iss) : '';
  if (!tokenIssuer || tokenIssuer !== expectedIssuer) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_INVALID_ISSUER',
      `Issuer của token (${tokenIssuer || 'trống'}) không khớp với Zitadel (${expectedIssuer}).`,
      401
    );
  }

  const rawAud = payload.aud;
  const audList =
    typeof rawAud === 'string'
      ? [rawAud]
      : Array.isArray(rawAud)
        ? rawAud.filter((x): x is string => typeof x === 'string')
        : [];
  if (!audList.some((aud) => allowedAudiences.includes(aud))) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_INVALID_AUDIENCE',
      'Audience (aud) của token không khớp với ZITADEL_CLIENT_ID.',
      401
    );
  }

  const now = getNowSeconds();
  const skew = options?.clockSkewSeconds ?? 30;
  const exp = typeof payload.exp === 'number' ? payload.exp : NaN;
  if (!Number.isFinite(exp) || exp + skew <= now) {
    throw new ZitadelOidcError(
      'OIDC_TOKEN_EXPIRED',
      'Token xác thực Zitadel đã hết hạn.',
      401
    );
  }

  if (payload.nbf !== undefined) {
    const nbf = typeof payload.nbf === 'number' ? payload.nbf : NaN;
    if (!Number.isFinite(nbf) || nbf - skew > now) {
      throw new ZitadelOidcError(
        'OIDC_TOKEN_NOT_YET_VALID',
        'Token xác thực Zitadel chưa tới thời점 hiệu lực (nbf).',
        401
      );
    }
  }

  const requireNonce =
    Boolean(options?.requireNonce) || options?.expectedNonce !== undefined;
  if (requireNonce) {
    const tokenNonce = typeof payload.nonce === 'string' ? payload.nonce : '';
    const expectedNonce = options?.expectedNonce ?? '';
    if (!tokenNonce || !compareConstantTimeString(tokenNonce, expectedNonce)) {
      throw new ZitadelOidcError(
        'OIDC_NONCE_MISMATCH',
        'Nonce trong id_token không khớp với phiên đăng nhập OIDC.',
        401
      );
    }
  }

  if (!isValidZitadelSub(payload.sub)) {
    throw new ZitadelOidcError(
      'INVALID_OIDC_SUB',
      'Zitadel subject (sub) không hợp lệ.',
      403
    );
  }

  const normalizedSub = payload.sub;
  const email =
    typeof payload.email === 'string' && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : undefined;
  const emailVerified =
    typeof payload.email_verified === 'boolean'
      ? payload.email_verified
      : undefined;

  const givenName =
    typeof payload.given_name === 'string' ? payload.given_name.trim() : '';
  const familyName =
    typeof payload.family_name === 'string' ? payload.family_name.trim() : '';
  const combinedName = [givenName, familyName].filter(Boolean).join(' ').trim();
  const fullName =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : combinedName || undefined;

  const phone =
    typeof payload.phone_number === 'string' && payload.phone_number.trim()
      ? payload.phone_number.trim()
      : undefined;

  return {
    sub: normalizedSub,
    iss: tokenIssuer,
    aud: typeof rawAud === 'string' ? rawAud : audList,
    exp,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    nbf: typeof payload.nbf === 'number' ? payload.nbf : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    email,
    emailVerified,
    fullName,
    phone,
    rawClaims: payload,
  };
}

export async function fetchZitadelUserInfo(
  accessToken: string,
  issuerUrlOverride?: string
): Promise<{
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  fullName?: string;
  phone?: string;
} | null> {
  if (!accessToken || !accessToken.trim()) return null;
  const discovery = await fetchZitadelDiscovery(issuerUrlOverride);
  if (!discovery.userinfo_endpoint) return null;

  try {
    const res = await getFetchImpl()(discovery.userinfo_endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const givenName =
      typeof data.given_name === 'string' ? data.given_name.trim() : '';
    const familyName =
      typeof data.family_name === 'string' ? data.family_name.trim() : '';
    const combinedName = [givenName, familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      sub: typeof data.sub === 'string' ? data.sub : undefined,
      email:
        typeof data.email === 'string' && data.email.trim()
          ? data.email.trim().toLowerCase()
          : undefined,
      emailVerified:
        typeof data.email_verified === 'boolean'
          ? data.email_verified
          : undefined,
      fullName:
        typeof data.name === 'string' && data.name.trim()
          ? data.name.trim()
          : combinedName || undefined,
      phone:
        typeof data.phone_number === 'string' && data.phone_number.trim()
          ? data.phone_number.trim()
          : undefined,
    };
  } catch {
    return null;
  }
}

export interface ProfileDbRow {
  id: string;
  zitadel_sub?: string | null;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  plan?: SubscriptionPlan | null;
  plan_expires_at?: string | null;
  role?: string | null;
  is_admin?: boolean | null;
  created_at?: string | null;
}

export interface SyncedOwnerProfileResult {
  user: Profile;
  isAdmin: boolean;
  createdNewProfile: boolean;
}

function normalizeSingleRow<T>(data: unknown): T | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  if (typeof data === 'object') {
    return data as T;
  }
  return null;
}

/**
 * Resolves an opaque verified Zitadel `sub` through the server-only
 * public.profiles.zitadel_sub mapping, preserving Qlaok's stable UUID IDs.
 * - Rejects malformed or shop-scoped staff subjects.
 * - Never derives Qlaok owner IDs from OIDC claims.
 * - For existing profiles, preserves `plan`, `plan_expires_at`, payment, role, and memberships,
 *   updating only missing minimal fields (`email`, `full_name`, `phone`).
 * - For brand-new profiles, inserts minimal fields with `plan: 'free'` only on insert.
 * - Derives admin status strictly from authoritative server/DB logic (`isSuperAdminEmail` / DB profile).
 */
export async function resolveAndSyncZitadelOwnerProfile(params: {
  sub: string;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
  allowInsert?: boolean;
}): Promise<SyncedOwnerProfileResult> {
  if (!isValidZitadelSub(params.sub)) {
    throw new ZitadelOidcError(
      'INVALID_OIDC_SUB',
      'Zitadel subject (sub) không hợp lệ.',
      403
    );
  }

  const sub = params.sub;
  const inputEmail =
    typeof params.email === 'string' && params.email.trim()
      ? params.email.trim().toLowerCase()
      : '';
  const inputFullName =
    typeof params.fullName === 'string' && params.fullName.trim()
      ? params.fullName.trim()
      : '';
  const inputPhone =
    typeof params.phone === 'string' && params.phone.trim()
      ? params.phone.trim()
      : '';

  const sb = getSupabaseDbClient();

  const { data: rawBySubject, error: bySubjectError } = await sb
    .from('profiles')
    .select('*')
    .eq('zitadel_sub', sub)
    .maybeSingle();

  if (bySubjectError && bySubjectError.code !== 'PGRST116') {
    throw new ZitadelOidcError(
      'AUTH_PROFILE_QUERY_FAILED',
      `Lỗi truy vấn hồ sơ người dùng: ${bySubjectError.message}`,
      500
    );
  }

  let existingProfile = normalizeSingleRow<ProfileDbRow>(rawBySubject);
  // Compatibility for accounts imported with their original Qlaok UUID as
  // Zitadel's subject. Never use email alone to attach an existing account.
  if (!existingProfile && isValidUuidSub(sub)) {
    const { data: rawById, error: byIdError } = await sb
      .from('profiles')
      .select('*')
      .eq('id', sub.toLowerCase())
      .maybeSingle();
    if (byIdError && byIdError.code !== 'PGRST116') {
      throw new ZitadelOidcError(
        'AUTH_PROFILE_QUERY_FAILED',
        `Lỗi truy vấn hồ sơ người dùng: ${byIdError.message}`,
        500
      );
    }
    const profileByLegacyId = normalizeSingleRow<ProfileDbRow>(rawById);
    if (profileByLegacyId) {
      if (profileByLegacyId.zitadel_sub && profileByLegacyId.zitadel_sub !== sub) {
        throw new ZitadelOidcError(
          'OIDC_SUBJECT_ALREADY_LINKED',
          'Hồ sơ này đã được liên kết với một tài khoản Zitadel khác.',
          409
        );
      }
      existingProfile = profileByLegacyId;
    }
  }
  const nowIso = new Date().toISOString();

  if (existingProfile) {
    if (existingProfile.zitadel_sub && existingProfile.zitadel_sub !== sub) {
      throw new ZitadelOidcError(
        'OIDC_SUBJECT_ALREADY_LINKED',
        'Hồ sơ này đã được liên kết với một tài khoản Zitadel khác.',
        409
      );
    }
    const existingEmail =
      typeof existingProfile.email === 'string' && existingProfile.email.trim()
        ? existingProfile.email.trim().toLowerCase()
        : '';
    const isAdmin =
      isSuperAdminEmail(existingEmail) ||
      existingProfile.role === 'admin' ||
      existingProfile.is_admin === true;

    let resolvedEmail = existingEmail;
    const minimalPatch: Record<string, unknown> = {};
    if (!existingEmail && inputEmail && !isSuperAdminEmail(inputEmail)) {
      const { data: rawCollision, error: collisionErr } = await sb
        .from('profiles')
        .select('*')
        .ilike('email', inputEmail)
        .limit(1);
      if (collisionErr && collisionErr.code !== 'PGRST116') {
        throw new ZitadelOidcError(
          'AUTH_PROFILE_QUERY_FAILED',
          `Lỗi kiểm tra email hồ sơ: ${collisionErr.message}`,
          500
        );
      }
      const existingWithInputEmail =
        normalizeSingleRow<ProfileDbRow>(rawCollision);
      if (
        existingWithInputEmail &&
        existingWithInputEmail.id &&
        existingWithInputEmail.id.trim().toLowerCase() !==
          existingProfile.id.trim().toLowerCase()
      ) {
        throw new ZitadelOidcError(
          'OIDC_PROFILE_ID_CONFLICT',
          'Email này đã gắn với một UUID chủ cửa hàng khác trong hệ thống.',
          409
        );
      }
      resolvedEmail = inputEmail;
      minimalPatch.email = inputEmail;
    }
    if (!existingProfile.full_name && inputFullName) {
      minimalPatch.full_name = inputFullName;
    }
    if (!existingProfile.phone && inputPhone) {
      minimalPatch.phone = inputPhone;
    }
    if (!existingProfile.zitadel_sub) {
      minimalPatch.zitadel_sub = sub;
    }

    if (Object.keys(minimalPatch).length > 0) {
      const tableRef = sb.from('profiles') as unknown as {
        update?: (patch: Record<string, unknown>) => {
          eq: (
            col: string,
            val: string
          ) => Promise<{ error?: { message: string } | null }>;
        };
      };
      if (typeof tableRef.update === 'function') {
        const { error: patchError } = await tableRef
          .update({
            ...minimalPatch,
            updated_at: nowIso,
          })
          .eq('id', existingProfile.id);
        if (patchError) {
          throw new ZitadelOidcError(
            'AUTH_PROFILE_UPDATE_FAILED',
            `Không thể cập nhật thông tin hồ sơ: ${patchError.message}`,
            500
          );
        }
      }
    }

    const effectivePlan: SubscriptionPlan = isAdmin
      ? 'premium'
      : (existingProfile.plan as SubscriptionPlan) || 'free';

    return {
      user: {
        ...(existingProfile as unknown as Profile),
        id: existingProfile.id,
        email: resolvedEmail,
        full_name:
          existingProfile.full_name ||
          inputFullName ||
          (isAdmin
            ? 'Hoàng Vũ (Super Admin)'
            : resolvedEmail.split('@')[0] || 'Chủ cửa hàng'),
        phone: existingProfile.phone || inputPhone || undefined,
        plan: effectivePlan,
        plan_expires_at: existingProfile.plan_expires_at ?? null,
        is_admin: isAdmin,
        role: isAdmin ? 'admin' : 'owner',
        account_type: 'owner',
        created_at: existingProfile.created_at || nowIso,
      },
      isAdmin,
      createdNewProfile: false,
    };
  }

  if (!inputEmail) {
    throw new ZitadelOidcError(
      'OIDC_EMAIL_REQUIRED',
      'Không tìm thấy hồ sơ cho subject Zitadel này và token không chứa email hợp lệ.',
      400
    );
  }

  const { data: rawByEmail, error: byEmailError } = await sb
    .from('profiles')
    .select('*')
    .ilike('email', inputEmail)
    .limit(1);

  if (byEmailError && byEmailError.code !== 'PGRST116') {
    throw new ZitadelOidcError(
      'AUTH_PROFILE_QUERY_FAILED',
      `Lỗi kiểm tra email hồ sơ: ${byEmailError.message}`,
      500
    );
  }

  const existingByEmail = normalizeSingleRow<ProfileDbRow>(rawByEmail);
  if (
    existingByEmail &&
    existingByEmail.id &&
    existingByEmail.zitadel_sub !== sub
  ) {
    throw new ZitadelOidcError(
      'OIDC_PROFILE_ID_CONFLICT',
      'Email này đã gắn với một hồ sơ người dùng khác trong hệ thống.',
      409
    );
  }

  if (params.allowInsert === false) {
    throw new ZitadelOidcError(
      'OIDC_PROFILE_NOT_FOUND',
      'Không tìm thấy hồ sơ chủ cửa hàng cho tài khoản này.',
      404
    );
  }

  if (isSuperAdminEmail(inputEmail)) {
    throw new ZitadelOidcError(
      'FORBIDDEN_SUPER_ADMIN_AUTO_CREATE',
      'Tài khoản Quản trị hệ thống phải tồn tại sẵn trong cơ sở dữ liệu và không thể tự tạo mới qua OIDC.',
      403
    );
  }

  const initialPlan: SubscriptionPlan = 'free';
  // Local Qlaok sessions already carry the canonical profile UUID. Preserve it
  // when a legacy UUID subject needs a profile row; only opaque Zitadel
  // subjects require a newly generated Qlaok UUID.
  const profileId = isValidUuidSub(sub) ? sub.toLowerCase() : crypto.randomUUID();
  const resolvedFullName =
    inputFullName || inputEmail.split('@')[0] || 'Chủ cửa hàng';

  const insertPayload = {
    id: profileId,
    zitadel_sub: sub,
    email: inputEmail,
    full_name: resolvedFullName,
    phone: inputPhone || null,
    plan: initialPlan,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const tableRef = sb.from('profiles') as unknown as {
    insert?: (
      row: Record<string, unknown>
    ) => Promise<{ error?: { message: string } | null }>;
    upsert?: (
      row: Record<string, unknown>,
      opts?: Record<string, unknown>
    ) => Promise<{ error?: { message: string } | null }>;
  };

  let writeError: { message: string } | null | undefined = null;
  if (typeof tableRef.insert === 'function') {
    const res = await tableRef.insert(insertPayload);
    writeError = res?.error;
  } else if (typeof tableRef.upsert === 'function') {
    const res = await tableRef.upsert(insertPayload, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    writeError = res?.error;
  }

  if (writeError) {
    throw new ZitadelOidcError(
      'AUTH_PROFILE_INSERT_FAILED',
      `Không thể tạo hồ sơ người dùng mới: ${writeError.message}`,
      500
    );
  }

  return {
    user: {
      id: profileId,
      email: inputEmail,
      full_name: resolvedFullName,
      phone: inputPhone || undefined,
      plan: initialPlan,
      plan_expires_at: null,
      is_admin: false,
      role: 'owner',
      account_type: 'owner',
      created_at: nowIso,
    },
    isAdmin: false,
    createdNewProfile: true,
  };
}
