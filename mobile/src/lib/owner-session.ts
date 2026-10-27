export const OWNER_SESSION_STORAGE_KEY = 'qlaok_mobile_owner_session_v1';
export const OWNER_OIDC_TX_STORAGE_KEY = 'qlaok_mobile_owner_oidc_tx_v1';

export const DEFAULT_ZITADEL_ISSUER_URL = 'https://auth.vunph.click';
export const DEFAULT_MOBILE_OIDC_REDIRECT_URI = 'qlaok://auth/callback';
export const OWNER_OIDC_TX_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_OWNER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const OWNER_TOKEN_EXPIRY_SKEW_SECONDS = 30;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_CLIENT_ID_REGEX =
  /^(?:your[-_]|placeholder|changeme|todo|example|unset)/i;
const PKCE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;
const FORBIDDEN_URL_TOKEN_PARAMS = [
  'access_token',
  'id_token',
  'refresh_token',
  'token',
] as const;

export type MobileOidcAuthMode = 'login' | 'register' | 'reset';

export interface MobileZitadelOidcConfig {
  issuerUrl: string;
  clientId: string;
  redirectUri: typeof DEFAULT_MOBILE_OIDC_REDIRECT_URI;
}

export type MobileZitadelOidcConfigResolution =
  | {
      ok: true;
      config: MobileZitadelOidcConfig;
    }
  | {
      ok: false;
      code:
        | 'OIDC_CLIENT_ID_MISSING'
        | 'OIDC_REDIRECT_URI_INVALID'
        | 'OIDC_ISSUER_INVALID';
      messageVi: string;
      messageEn: string;
    };

export interface PendingOwnerOidcTransaction {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: typeof DEFAULT_MOBILE_OIDC_REDIRECT_URI;
  clientId: string;
  issuerUrl: string;
  mode: MobileOidcAuthMode;
  createdAt: number;
  expiresAt: number;
}

export interface MobileOwnerProfile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  plan: 'free' | 'pro' | 'premium';
  plan_expires_at?: string | null;
  role: 'owner' | 'admin';
  is_admin?: boolean;
  account_type?: 'owner' | 'admin';
  created_at?: string;
}

export interface MobileOwnerSession {
  version: 1;
  accessToken: string;
  expiresAt: number; // epoch seconds
  postgrestToken: string | null;
  postgrestExpiresAt: number | null; // epoch seconds
  user: MobileOwnerProfile;
  isAdmin: boolean;
  savedAt: string;
}

export interface OwnerSessionStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MobileOwnerOidcError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'MobileOwnerOidcError';
    this.code = code;
    this.status = status;
  }
}

export interface ExpoSecureStoreLike {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

export interface WebCryptoRandomLike {
  getRandomValues: <T extends Uint8Array>(array: T) => T;
}

export interface ExpoCryptoLike {
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

export interface RandomBytesSourceOptions {
  webCrypto?: Partial<WebCryptoRandomLike> | null;
  expoCrypto?: Partial<ExpoCryptoLike> | null;
}

/**
 * Wraps Expo SecureStore into an `OwnerSessionStorageAdapter` for native iOS/Android.
 * Returns `null` on web or when SecureStore methods are unavailable.
 */
export function createExpoSecureStoreAdapter(
  secureStore: Partial<ExpoSecureStoreLike> | null | undefined,
  platformOs?: string | null
): OwnerSessionStorageAdapter | null {
  if (platformOs === 'web') {
    return null;
  }
  if (
    !secureStore ||
    typeof secureStore.getItemAsync !== 'function' ||
    typeof secureStore.setItemAsync !== 'function' ||
    typeof secureStore.deleteItemAsync !== 'function'
  ) {
    return null;
  }
  const getItemAsync = secureStore.getItemAsync.bind(secureStore);
  const setItemAsync = secureStore.setItemAsync.bind(secureStore);
  const deleteItemAsync = secureStore.deleteItemAsync.bind(secureStore);
  return {
    getItem: (key: string) => getItemAsync(key),
    setItem: (key: string, value: string) => setItemAsync(key, value),
    removeItem: (key: string) => deleteItemAsync(key),
  };
}

const memoryFallbackStore = new Map<string, string>();
let resolvedNativeStorageCache: OwnerSessionStorageAdapter | null | undefined;
let resolvedNativeExpoCryptoCache: Partial<ExpoCryptoLike> | null | undefined;
let defaultStorageAdapter: OwnerSessionStorageAdapter | null = null;
let cachedOwnerSession: MobileOwnerSession | null = null;
let cachedOwnerSessionLoaded = false;

function normalizeExpoCryptoModule(
  mod: unknown
): Partial<ExpoCryptoLike> | null {
  if (!mod || typeof mod !== 'object') {
    return null;
  }
  const record = mod as Record<string, unknown>;
  if (typeof record.getRandomValues === 'function') {
    return record as Partial<ExpoCryptoLike>;
  }
  if (record.default && typeof record.default === 'object') {
    const def = record.default as Record<string, unknown>;
    if (typeof def.getRandomValues === 'function') {
      return def as Partial<ExpoCryptoLike>;
    }
  }
  return null;
}

function resolveNativeExpoCrypto(): Partial<ExpoCryptoLike> | null {
  if (resolvedNativeExpoCryptoCache !== undefined) {
    return resolvedNativeExpoCryptoCache;
  }
  try {
    if (typeof require === 'function') {
      const rawModule = require('expo-crypto') as unknown;
      resolvedNativeExpoCryptoCache = normalizeExpoCryptoModule(rawModule);
      return resolvedNativeExpoCryptoCache;
    }
  } catch {
    // Outside Expo / React Native runtime (e.g. Node test environment)
  }
  resolvedNativeExpoCryptoCache = null;
  return null;
}

function resolveNativeSecureStoreAdapter(): OwnerSessionStorageAdapter | null {
  if (resolvedNativeStorageCache !== undefined) {
    return resolvedNativeStorageCache;
  }
  try {
    if (typeof require === 'function') {
      const rn = require('react-native') as
        | { Platform?: { OS?: string } }
        | null
        | undefined;
      const platformOs = rn?.Platform?.OS;
      if (platformOs && platformOs !== 'web') {
        const secureStore = require('expo-secure-store') as
          | Partial<ExpoSecureStoreLike>
          | null
          | undefined;
        resolvedNativeStorageCache = createExpoSecureStoreAdapter(
          secureStore,
          platformOs
        );
        return resolvedNativeStorageCache;
      }
    }
  } catch {
    // Falls back to browser/Node storage below
  }
  resolvedNativeStorageCache = null;
  return null;
}

export function resetOwnerSessionMemoryForTest(): void {
  defaultStorageAdapter = null;
  resolvedNativeStorageCache = undefined;
  resolvedNativeExpoCryptoCache = undefined;
  cachedOwnerSession = null;
  cachedOwnerSessionLoaded = false;
  memoryFallbackStore.clear();
}

type OwnerSessionListener = (
  session: MobileOwnerSession | null,
  reason?: 'login' | 'sync' | 'logout' | 'expired'
) => void;
const sessionListeners = new Set<OwnerSessionListener>();

export function subscribeOwnerSessionChanges(
  listener: OwnerSessionListener
): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function notifyOwnerSessionListeners(
  session: MobileOwnerSession | null,
  reason?: 'login' | 'sync' | 'logout' | 'expired'
): void {
  for (const listener of sessionListeners) {
    try {
      listener(session, reason);
    } catch {
      // ignore subscriber errors
    }
  }
}

async function resolveDefaultStorageAdapter(): Promise<OwnerSessionStorageAdapter> {
  if (defaultStorageAdapter) {
    return defaultStorageAdapter;
  }

  const nativeAdapter = resolveNativeSecureStoreAdapter();
  if (nativeAdapter) {
    defaultStorageAdapter = nativeAdapter;
    return defaultStorageAdapter;
  }

  let isNativePlatform = false;
  try {
    if (typeof require === 'function') {
      const rn = require('react-native') as
        | { Platform?: { OS?: string } }
        | null
        | undefined;
      const os = rn?.Platform?.OS;
      if (os && os !== 'web') {
        isNativePlatform = true;
      }
    }
  } catch {
    // Not running in React Native
  }

  // Native owner tokens must only be persisted in SecureStore.
  // When running on native without SecureStore, do not fall back to persistent localStorage.
  if (
    !isNativePlatform &&
    typeof globalThis !== 'undefined' &&
    'localStorage' in globalThis &&
    globalThis.localStorage &&
    typeof globalThis.localStorage.getItem === 'function'
  ) {
    defaultStorageAdapter = {
      getItem: async (key: string) => globalThis.localStorage.getItem(key),
      setItem: async (key: string, value: string) => {
        globalThis.localStorage.setItem(key, value);
      },
      removeItem: async (key: string) => {
        globalThis.localStorage.removeItem(key);
      },
    };
    return defaultStorageAdapter;
  }

  defaultStorageAdapter = {
    getItem: async (key: string) => memoryFallbackStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memoryFallbackStore.set(key, value);
    },
    removeItem: async (key: string) => {
      memoryFallbackStore.delete(key);
    },
  };
  return defaultStorageAdapter;
}

export function isPlaceholderOidcClientId(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_CLIENT_ID_REGEX.test(trimmed);
}

export function isValidOwnerUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('staff-acct-')) return false;
  return UUID_REGEX.test(trimmed);
}

export function resolveMobileZitadelOidcConfig(
  envOverride?: Record<string, string | undefined>
): MobileZitadelOidcConfigResolution {
  const env = envOverride ?? (process.env as Record<string, string | undefined>);
  const rawIssuer = (
    env.EXPO_PUBLIC_ZITADEL_ISSUER_URL || DEFAULT_ZITADEL_ISSUER_URL
  )
    .trim()
    .replace(/\/+$/, '');
  const rawClientId = (env.EXPO_PUBLIC_ZITADEL_CLIENT_ID || '').trim();
  const rawRedirectUri = (
    env.EXPO_PUBLIC_ZITADEL_REDIRECT_URI || DEFAULT_MOBILE_OIDC_REDIRECT_URI
  ).trim();

  if (!rawIssuer || !/^https:\/\/[^/\s]+$/i.test(rawIssuer)) {
    return {
      ok: false,
      code: 'OIDC_ISSUER_INVALID',
      messageVi:
        'Đăng nhập tạm thời chưa khả dụng. Vui lòng liên hệ hỗ trợ Qlaok.',
      messageEn:
        'Sign-in is temporarily unavailable. Please contact Qlaok support.',
    };
  }

  if (rawRedirectUri !== DEFAULT_MOBILE_OIDC_REDIRECT_URI) {
    return {
      ok: false,
      code: 'OIDC_REDIRECT_URI_INVALID',
      messageVi:
        'Đăng nhập tạm thời chưa khả dụng. Vui lòng liên hệ hỗ trợ Qlaok.',
      messageEn:
        'Sign-in is temporarily unavailable. Please contact Qlaok support.',
    };
  }

  if (isPlaceholderOidcClientId(rawClientId)) {
    return {
      ok: false,
      code: 'OIDC_CLIENT_ID_MISSING',
      messageVi:
        'Đăng nhập Chủ quán tạm thời chưa khả dụng. Vui lòng liên hệ hỗ trợ Qlaok.',
      messageEn:
        'Owner sign-in is temporarily unavailable. Please contact Qlaok support.',
    };
  }

  return {
    ok: true,
    config: {
      issuerUrl: rawIssuer,
      clientId: rawClientId,
      redirectUri: DEFAULT_MOBILE_OIDC_REDIRECT_URI,
    },
  };
}

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function bytesToBase64Url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  const len = bytes.length;
  for (; i + 2 < len; i += 3) {
    const triplet = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64URL_ALPHABET[(triplet >>> 18) & 63] +
      BASE64URL_ALPHABET[(triplet >>> 12) & 63] +
      BASE64URL_ALPHABET[(triplet >>> 6) & 63] +
      BASE64URL_ALPHABET[triplet & 63];
  }
  const remaining = len - i;
  if (remaining === 1) {
    const byte = bytes[i];
    result +=
      BASE64URL_ALPHABET[(byte >>> 2) & 63] +
      BASE64URL_ALPHABET[(byte & 3) << 4];
  } else if (remaining === 2) {
    const pair = (bytes[i] << 8) | bytes[i + 1];
    result +=
      BASE64URL_ALPHABET[(pair >>> 10) & 63] +
      BASE64URL_ALPHABET[(pair >>> 4) & 63] +
      BASE64URL_ALPHABET[(pair & 15) << 2];
  }
  return result;
}

function asciiToBytes(input: string): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    out[i] = input.charCodeAt(i) & 0xff;
  }
  return out;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Pure TypeScript FIPS 180-4 SHA-256 implementation so PKCE S256 works identically
 * across React Native (Hermes), Web, and Node test runners without native crypto addons.
 */
export function sha256Bytes(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLenHi = Math.floor((msgLen * 8) / 0x100000000);
  const bitLenLo = (msgLen * 8) >>> 0;

  const paddedLen = ((msgLen + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[msgLen] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 =
        rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, h0, false);
  digestView.setUint32(4, h1, false);
  digestView.setUint32(8, h2, false);
  digestView.setUint32(12, h3, false);
  digestView.setUint32(16, h4, false);
  digestView.setUint32(20, h5, false);
  digestView.setUint32(24, h6, false);
  digestView.setUint32(28, h7, false);
  return digest;
}

export function generateRandomBytes(
  byteLength = 32,
  sources?: RandomBytesSourceOptions
): Uint8Array {
  if (
    typeof byteLength !== 'number' ||
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > 1024
  ) {
    throw new MobileOwnerOidcError(
      'OIDC_CSPRNG_UNAVAILABLE',
      'Không thể bắt đầu đăng nhập an toàn. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.'
    );
  }

  const hasExplicitWebCrypto =
    sources !== undefined &&
    Object.prototype.hasOwnProperty.call(sources, 'webCrypto');
  const hasExplicitExpoCrypto =
    sources !== undefined &&
    Object.prototype.hasOwnProperty.call(sources, 'expoCrypto');

  const webCryptoCandidate = hasExplicitWebCrypto
    ? sources?.webCrypto
    : typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Partial<WebCryptoRandomLike> | undefined)
      : undefined;

  if (
    webCryptoCandidate &&
    typeof webCryptoCandidate.getRandomValues === 'function'
  ) {
    try {
      const bytes = new Uint8Array(byteLength);
      const returned = webCryptoCandidate.getRandomValues(bytes);
      const output = returned instanceof Uint8Array ? returned : bytes;
      if (output.byteLength === byteLength) {
        return output;
      }
    } catch {
      // Fall through to native Expo Crypto CSPRNG when WebCrypto stub fails
    }
  }

  const expoCryptoCandidate = hasExplicitExpoCrypto
    ? normalizeExpoCryptoModule(sources?.expoCrypto)
    : resolveNativeExpoCrypto();

  if (expoCryptoCandidate) {
    if (typeof expoCryptoCandidate.getRandomValues === 'function') {
      try {
        const bytes = new Uint8Array(byteLength);
        const returned = expoCryptoCandidate.getRandomValues(bytes);
        const output = returned instanceof Uint8Array ? returned : bytes;
        if (output.byteLength === byteLength) {
          return output;
        }
      } catch {
        // Fail closed below; never fall back when getRandomValues throws
      }
    }
  }

  throw new MobileOwnerOidcError(
    'OIDC_CSPRNG_UNAVAILABLE',
    'Không thể khởi tạo phiên đăng nhập an toàn trên thiết bị này. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.'
  );
}

export function generateMobileRandomUrlSafe(
  byteLength = 32,
  sources?: RandomBytesSourceOptions
): string {
  return bytesToBase64Url(generateRandomBytes(byteLength, sources));
}

export function computeMobileS256CodeChallenge(codeVerifier: string): string {
  const trimmed = (codeVerifier || '').trim();
  if (!PKCE_VERIFIER_REGEX.test(trimmed)) {
    throw new MobileOwnerOidcError(
      'OIDC_PKCE_VERIFIER_INVALID',
      'Yêu cầu đăng nhập không hợp lệ. Vui lòng thử lại.'
    );
  }
  return bytesToBase64Url(sha256Bytes(asciiToBytes(trimmed)));
}

export function createMobilePkcePair(
  customVerifier?: string,
  sources?: RandomBytesSourceOptions
): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  const codeVerifier =
    customVerifier || generateMobileRandomUrlSafe(32, sources);
  const codeChallenge = computeMobileS256CodeChallenge(codeVerifier);
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

export function compareConstantTime(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function buildMobileZitadelAuthorizeUrl(params: {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  mode?: MobileOidcAuthMode;
  loginHint?: string;
  lang?: 'vi' | 'en';
}): string {
  const issuer = params.issuerUrl.trim().replace(/\/+$/, '');
  const url = new URL(`${issuer}/oauth/v2/authorize`);
  url.searchParams.set('client_id', params.clientId.trim());
  url.searchParams.set('redirect_uri', params.redirectUri.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile offline_access');
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

export async function prepareOwnerOidcAuthorizationRequest(options?: {
  mode?: MobileOidcAuthMode;
  loginHint?: string;
  lang?: 'vi' | 'en';
  env?: Record<string, string | undefined>;
  storage?: OwnerSessionStorageAdapter;
  nowMs?: number;
  state?: string;
  nonce?: string;
  codeVerifier?: string;
  randomSources?: RandomBytesSourceOptions;
}): Promise<{
  authorizeUrl: string;
  transaction: PendingOwnerOidcTransaction;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}> {
  const resolution = resolveMobileZitadelOidcConfig(options?.env);
  if (!resolution.ok) {
    throw new MobileOwnerOidcError(
      resolution.code,
      options?.lang === 'en' ? resolution.messageEn : resolution.messageVi
    );
  }

  const { config } = resolution;
  const nowMs = options?.nowMs ?? Date.now();
  const state =
    options?.state || generateMobileRandomUrlSafe(24, options?.randomSources);
  const nonce =
    options?.nonce || generateMobileRandomUrlSafe(24, options?.randomSources);
  const pkce = createMobilePkcePair(
    options?.codeVerifier,
    options?.randomSources
  );
  const mode: MobileOidcAuthMode = options?.mode ?? 'login';

  const transaction: PendingOwnerOidcTransaction = {
    version: 1,
    state,
    nonce,
    codeVerifier: pkce.codeVerifier,
    redirectUri: config.redirectUri,
    clientId: config.clientId,
    issuerUrl: config.issuerUrl,
    mode,
    createdAt: nowMs,
    expiresAt: nowMs + OWNER_OIDC_TX_TTL_MS,
  };

  const store = options?.storage ?? (await resolveDefaultStorageAdapter());
  await store.setItem(OWNER_OIDC_TX_STORAGE_KEY, JSON.stringify(transaction));

  const authorizeUrl = buildMobileZitadelAuthorizeUrl({
    issuerUrl: config.issuerUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    nonce,
    codeChallenge: pkce.codeChallenge,
    mode,
    loginHint: options?.loginHint,
    lang: options?.lang,
  });

  return {
    authorizeUrl,
    transaction,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  };
}

export async function startOwnerOidcLogin(options?: {
  mode?: MobileOidcAuthMode;
  loginHint?: string;
  lang?: 'vi' | 'en';
  env?: Record<string, string | undefined>;
  storage?: OwnerSessionStorageAdapter;
  openUrl?: (url: string) => Promise<unknown>;
  randomSources?: RandomBytesSourceOptions;
}): Promise<{
  authorizeUrl: string;
  transaction: PendingOwnerOidcTransaction;
}> {
  const prepared = await prepareOwnerOidcAuthorizationRequest(options);
  if (options?.openUrl) {
    await options.openUrl(prepared.authorizeUrl);
  } else {
    let openUrlFn: ((url: string) => Promise<unknown>) | undefined;
    try {
      if (typeof require === 'function') {
        const rn = require('react-native') as
          | { Linking?: { openURL?: (url: string) => Promise<unknown> } }
          | null
          | undefined;
        if (typeof rn?.Linking?.openURL === 'function') {
          openUrlFn = rn.Linking.openURL.bind(rn.Linking);
        }
      }
    } catch {
      // Fallback to dynamic import below
    }
    if (openUrlFn) {
      await openUrlFn(prepared.authorizeUrl);
    } else {
      const rn = await import('react-native');
      await rn.Linking.openURL(prepared.authorizeUrl);
    }
  }
  return {
    authorizeUrl: prepared.authorizeUrl,
    transaction: prepared.transaction,
  };
}

export function isOwnerOidcCallbackUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  return /^qlaok:\/\/auth\/callback(?:[?#]|$)/i.test(trimmed);
}

export type ParsedOwnerOidcCallback =
  | {
      kind: 'code';
      code: string;
      state: string;
    }
  | {
      kind: 'error';
      error: string;
      errorDescription?: string;
      state?: string;
    };

export function parseOwnerOidcCallbackUrl(
  rawUrl: string
): ParsedOwnerOidcCallback {
  if (!isOwnerOidcCallbackUrl(rawUrl)) {
    throw new MobileOwnerOidcError(
      'OIDC_CALLBACK_URI_MISMATCH',
      'Không thể hoàn tất đăng nhập. Vui lòng thử lại.'
    );
  }

  const trimmed = rawUrl.trim();
  const hashIdx = trimmed.indexOf('#');
  const queryIdx = trimmed.indexOf('?');

  const fragmentRaw = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : '';
  const queryRaw =
    queryIdx >= 0
      ? trimmed.slice(queryIdx + 1, hashIdx >= 0 ? hashIdx : undefined)
      : '';

  const queryParams = new URLSearchParams(queryRaw);
  const fragmentParams = new URLSearchParams(fragmentRaw);

  for (const forbidden of FORBIDDEN_URL_TOKEN_PARAMS) {
    if (queryParams.has(forbidden) || fragmentParams.has(forbidden)) {
      throw new MobileOwnerOidcError(
        'OIDC_IMPLICIT_TOKEN_FORBIDDEN',
        'Phản hồi đăng nhập không an toàn. Yêu cầu bị từ chối để bảo vệ tài khoản.'
      );
    }
  }

  const error =
    queryParams.get('error')?.trim() ||
    fragmentParams.get('error')?.trim() ||
    '';
  const errorDescription =
    queryParams.get('error_description')?.trim() ||
    fragmentParams.get('error_description')?.trim() ||
    undefined;
  const state =
    queryParams.get('state')?.trim() ||
    fragmentParams.get('state')?.trim() ||
    '';

  if (error) {
    return {
      kind: 'error',
      error,
      errorDescription,
      state: state || undefined,
    };
  }

  const code = queryParams.get('code')?.trim() || '';
  if (!code || !state) {
    throw new MobileOwnerOidcError(
      'OIDC_CALLBACK_MISSING_PARAMS',
      'Thông tin phản hồi đăng nhập không đầy đủ. Vui lòng thử đăng nhập lại.'
    );
  }

  return {
    kind: 'code',
    code,
    state,
  };
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLen);
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(
        Buffer.from(padded, 'base64').toString('utf8')
      ) as Record<string, unknown>;
    }
    if (typeof globalThis.atob === 'function') {
      return JSON.parse(globalThis.atob(padded)) as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function validatePostgrestTokenClaims(
  token: unknown,
  expectedOwnerId: string,
  nowSec = Math.floor(Date.now() / 1000)
): { token: string; expiresAt: number } | null {
  if (typeof token !== 'string' || !token.trim()) return null;
  const trimmed = token.trim();
  const segments = trimmed.split('.');
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return null;
  }
  const payload = decodeBase64UrlJson(segments[1]);
  if (!payload) return null;

  if (
    payload.role !== 'authenticated' ||
    typeof payload.sub !== 'string' ||
    payload.sub.trim().toLowerCase() !== expectedOwnerId.trim().toLowerCase() ||
    !isValidOwnerUuid(payload.sub)
  ) {
    return null;
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : NaN;
  if (!Number.isFinite(exp) || exp <= nowSec) {
    return null;
  }

  return {
    token: trimmed,
    expiresAt: Math.floor(exp),
  };
}

export function validateOwnerSession(
  raw: unknown,
  nowSec = Math.floor(Date.now() / 1000)
): MobileOwnerSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  const accessToken =
    typeof candidate.accessToken === 'string'
      ? candidate.accessToken.trim()
      : '';
  if (!accessToken) return null;

  const rawUser = candidate.user as Record<string, unknown> | undefined;
  if (!rawUser || typeof rawUser !== 'object') return null;

  const userId = typeof rawUser.id === 'string' ? rawUser.id.trim().toLowerCase() : '';
  if (!isValidOwnerUuid(userId)) {
    return null;
  }

  // Strictly reject any staff account or staff role in owner session
  if (
    rawUser.account_type === 'staff' ||
    rawUser.role === 'cashier' ||
    rawUser.role === 'staff' ||
    (typeof rawUser.shop_id === 'string' && rawUser.shop_id.trim().length > 0)
  ) {
    return null;
  }

  const email =
    typeof rawUser.email === 'string' ? rawUser.email.trim().toLowerCase() : '';
  if (!email) return null;

  let expiresAt =
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt)
      ? Math.floor(candidate.expiresAt)
      : NaN;

  if (!Number.isFinite(expiresAt)) {
    // Inspect 2-part Qlaok HMAC token payload if present
    const parts = accessToken.split('.');
    if (parts.length === 2 && parts[0]) {
      const decoded = decodeBase64UrlJson(parts[0]);
      if (decoded && typeof decoded.exp === 'number') {
        expiresAt = Math.floor(decoded.exp);
      }
    }
  }
  if (!Number.isFinite(expiresAt)) {
    expiresAt = nowSec + DEFAULT_OWNER_SESSION_TTL_SECONDS;
  }

  if (expiresAt <= nowSec) {
    return null;
  }

  const isAdmin =
    Boolean(candidate.isAdmin) ||
    Boolean(rawUser.is_admin) ||
    rawUser.role === 'admin';
  const plan: 'free' | 'pro' | 'premium' =
    rawUser.plan === 'premium' || rawUser.plan === 'pro'
      ? rawUser.plan
      : isAdmin
        ? 'premium'
        : 'free';

  const validatedPostgrest = validatePostgrestTokenClaims(
    candidate.postgrestToken,
    userId,
    nowSec
  );

  return {
    version: 1,
    accessToken,
    expiresAt,
    postgrestToken: validatedPostgrest?.token ?? null,
    postgrestExpiresAt:
      validatedPostgrest?.expiresAt ??
      (typeof candidate.postgrestExpiresAt === 'number' &&
      validatedPostgrest !== null
        ? Math.floor(candidate.postgrestExpiresAt)
        : null),
    user: {
      id: userId,
      email,
      full_name:
        typeof rawUser.full_name === 'string' && rawUser.full_name.trim()
          ? rawUser.full_name.trim()
          : email.split('@')[0] || 'Chủ cửa hàng',
      ...(typeof rawUser.phone === 'string' && rawUser.phone.trim()
        ? { phone: rawUser.phone.trim() }
        : {}),
      plan,
      plan_expires_at:
        typeof rawUser.plan_expires_at === 'string'
          ? rawUser.plan_expires_at
          : null,
      role: isAdmin ? 'admin' : 'owner',
      is_admin: isAdmin,
      account_type: isAdmin ? 'admin' : 'owner',
      ...(typeof rawUser.created_at === 'string'
        ? { created_at: rawUser.created_at }
        : {}),
    },
    isAdmin,
    savedAt:
      typeof candidate.savedAt === 'string' && candidate.savedAt
        ? candidate.savedAt
        : new Date().toISOString(),
  };
}

export function isOwnerSessionExpired(
  session: MobileOwnerSession | null | undefined,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!session) return true;
  return session.expiresAt - OWNER_TOKEN_EXPIRY_SKEW_SECONDS <= nowSec;
}

export async function loadOwnerSession(
  storage?: OwnerSessionStorageAdapter,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<MobileOwnerSession | null> {
  const store = storage ?? (await resolveDefaultStorageAdapter());
  const raw = await store.getItem(OWNER_SESSION_STORAGE_KEY);
  if (!raw) {
    if (!storage) {
      cachedOwnerSession = null;
      cachedOwnerSessionLoaded = true;
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const valid = validateOwnerSession(parsed, nowSec);
    if (!valid || isOwnerSessionExpired(valid, nowSec)) {
      await store.removeItem(OWNER_SESSION_STORAGE_KEY);
      if (!storage) {
        cachedOwnerSession = null;
        cachedOwnerSessionLoaded = true;
      }
      return null;
    }
    if (!storage) {
      cachedOwnerSession = valid;
      cachedOwnerSessionLoaded = true;
    }
    return valid;
  } catch {
    await store.removeItem(OWNER_SESSION_STORAGE_KEY);
    if (!storage) {
      cachedOwnerSession = null;
      cachedOwnerSessionLoaded = true;
    }
    return null;
  }
}

export async function saveOwnerSession(
  sessionInput: unknown,
  options?: {
    storage?: OwnerSessionStorageAdapter;
    reason?: 'login' | 'sync';
    nowSec?: number;
  }
): Promise<MobileOwnerSession> {
  const valid = validateOwnerSession(sessionInput, options?.nowSec);
  if (!valid) {
    throw new MobileOwnerOidcError(
      'INVALID_OWNER_SESSION',
      'Phiên đăng nhập chủ quán không hợp lệ.'
    );
  }
  const store = options?.storage ?? (await resolveDefaultStorageAdapter());
  await store.setItem(OWNER_SESSION_STORAGE_KEY, JSON.stringify(valid));
  if (!options?.storage) {
    cachedOwnerSession = valid;
    cachedOwnerSessionLoaded = true;
    notifyOwnerSessionListeners(valid, options?.reason ?? 'login');
  }
  return valid;
}

export async function clearOwnerSession(options?: {
  storage?: OwnerSessionStorageAdapter;
  reason?: 'logout' | 'expired';
}): Promise<void> {
  const store = options?.storage ?? (await resolveDefaultStorageAdapter());
  await store.removeItem(OWNER_SESSION_STORAGE_KEY);
  await store.removeItem(OWNER_OIDC_TX_STORAGE_KEY);
  if (!options?.storage) {
    cachedOwnerSession = null;
    cachedOwnerSessionLoaded = true;
    notifyOwnerSessionListeners(null, options?.reason ?? 'logout');
  }
}

export async function getOwnerAccessToken(
  storage?: OwnerSessionStorageAdapter,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  if (!storage && cachedOwnerSessionLoaded && cachedOwnerSession) {
    if (!isOwnerSessionExpired(cachedOwnerSession, nowSec)) {
      return cachedOwnerSession.accessToken;
    }
    await clearOwnerSession({ reason: 'expired' });
    return null;
  }
  const session = await loadOwnerSession(storage, nowSec);
  if (!session || isOwnerSessionExpired(session, nowSec)) {
    return null;
  }
  return session.accessToken;
}

export async function getOwnerPostgrestToken(
  storage?: OwnerSessionStorageAdapter,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const session =
    !storage && cachedOwnerSessionLoaded && cachedOwnerSession
      ? cachedOwnerSession
      : await loadOwnerSession(storage, nowSec);

  if (!session || isOwnerSessionExpired(session, nowSec)) {
    return null;
  }
  const validated = validatePostgrestTokenClaims(
    session.postgrestToken,
    session.user.id,
    nowSec + OWNER_TOKEN_EXPIRY_SKEW_SECONDS
  );
  return validated?.token ?? null;
}

export async function requireOwnerPostgrestToken(
  storage?: OwnerSessionStorageAdapter,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<string> {
  const token = await getOwnerPostgrestToken(storage, nowSec);
  if (!token) {
    throw new MobileOwnerOidcError(
      'POSTGREST_AUTH_TOKEN_UNAVAILABLE',
      'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
      401
    );
  }
  return token;
}

export async function completeOwnerOidcCallback(
  callbackUrl: string,
  options: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    storage?: OwnerSessionStorageAdapter;
    nowMs?: number;
  }
): Promise<MobileOwnerSession> {
  const store = options.storage ?? (await resolveDefaultStorageAdapter());
  const rawTx = await store.getItem(OWNER_OIDC_TX_STORAGE_KEY);
  // Always clear pending transaction on callback attempt (single-use)
  await store.removeItem(OWNER_OIDC_TX_STORAGE_KEY);

  const parsedCallback = parseOwnerOidcCallbackUrl(callbackUrl);

  if (!rawTx) {
    throw new MobileOwnerOidcError(
      'OIDC_TRANSACTION_MISSING',
      'Không tìm thấy phiên đăng nhập đang chờ. Vui lòng thử đăng nhập lại.'
    );
  }

  let tx: PendingOwnerOidcTransaction;
  try {
    tx = JSON.parse(rawTx) as PendingOwnerOidcTransaction;
  } catch {
    throw new MobileOwnerOidcError(
      'OIDC_TRANSACTION_INVALID',
      'Dữ liệu phiên đăng nhập không hợp lệ. Vui lòng thử lại.'
    );
  }

  const nowMs = options.nowMs ?? Date.now();
  if (
    !tx ||
    typeof tx.state !== 'string' ||
    !tx.state ||
    typeof tx.nonce !== 'string' ||
    !tx.nonce ||
    typeof tx.codeVerifier !== 'string' ||
    !tx.codeVerifier ||
    typeof tx.expiresAt !== 'number' ||
    nowMs > tx.expiresAt
  ) {
    throw new MobileOwnerOidcError(
      'OIDC_TRANSACTION_EXPIRED',
      'Phiên đăng nhập đã hết hạn. Vui lòng thử đăng nhập lại.'
    );
  }

  if (parsedCallback.kind === 'error') {
    if (
      parsedCallback.state &&
      !compareConstantTime(parsedCallback.state, tx.state)
    ) {
      throw new MobileOwnerOidcError(
        'OIDC_STATE_MISMATCH',
        'Yêu cầu đăng nhập không hợp lệ. Vui lòng thử lại.'
      );
    }
    const friendlyProviderMessage =
      parsedCallback.error === 'access_denied'
        ? 'Yêu cầu đăng nhập đã bị hủy hoặc bị từ chối. Vui lòng thử lại.'
        : 'Đăng nhập không thành công. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.';
    throw new MobileOwnerOidcError(
      'OIDC_PROVIDER_ERROR',
      friendlyProviderMessage
    );
  }

  if (!compareConstantTime(parsedCallback.state, tx.state)) {
    throw new MobileOwnerOidcError(
      'OIDC_STATE_MISMATCH',
      'Yêu cầu đăng nhập không hợp lệ. Yêu cầu bị từ chối để bảo vệ tài khoản.'
    );
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const cleanBaseUrl = options.baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchFn(`${cleanBaseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        action: 'oidc_mobile_exchange',
        code: parsedCallback.code,
        codeVerifier: tx.codeVerifier,
        redirectUri: tx.redirectUri,
        nonce: tx.nonce,
        state: parsedCallback.state,
        expectedState: tx.state,
        clientId: tx.clientId,
      }),
    });
  } catch (err) {
    throw new MobileOwnerOidcError(
      'OIDC_EXCHANGE_NETWORK_ERROR',
      'Không thể kết nối để hoàn tất đăng nhập. Vui lòng kiểm tra mạng rồi thử lại.'
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!res.ok) {
    const code =
      typeof payload.code === 'string' && payload.code
        ? payload.code
        : 'OIDC_EXCHANGE_FAILED';
    const message =
      'Không thể hoàn tất đăng nhập. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.';
    throw new MobileOwnerOidcError(code, message, res.status);
  }

  return saveOwnerSession(payload, {
    storage: options.storage,
    reason: 'login',
    nowSec: Math.floor(nowMs / 1000),
  });
}

export async function revalidateOwnerSession(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  storage?: OwnerSessionStorageAdapter;
  nowSec?: number;
}): Promise<{
  status: 'valid' | 'expired' | 'unauthenticated' | 'transient_error';
  session: MobileOwnerSession | null;
}> {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const current = await loadOwnerSession(options.storage, nowSec);
  if (!current) {
    return { status: 'unauthenticated', session: null };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const cleanBaseUrl = options.baseUrl.replace(/\/+$/, '');
  try {
    const res = await fetchFn(`${cleanBaseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${current.accessToken}`,
      },
      body: JSON.stringify({
        action: 'sync_user',
      }),
    });

    if (res.status === 401) {
      await clearOwnerSession({
        storage: options.storage,
        reason: 'expired',
      });
      return { status: 'expired', session: null };
    }

    if (!res.ok) {
      // Transient 5xx or 403/429: NEVER clear a valid owner session
      return { status: 'transient_error', session: current };
    }

    const payload = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const updated = await saveOwnerSession(
      {
        ...payload,
        accessToken:
          typeof payload.accessToken === 'string' && payload.accessToken
            ? payload.accessToken
            : current.accessToken,
        expiresAt:
          typeof payload.expiresAt === 'number'
            ? payload.expiresAt
            : current.expiresAt,
        postgrestToken:
          payload.postgrestToken !== undefined
            ? payload.postgrestToken
            : current.postgrestToken,
        postgrestExpiresAt:
          payload.postgrestExpiresAt !== undefined
            ? payload.postgrestExpiresAt
            : current.postgrestExpiresAt,
      },
      {
        storage: options.storage,
        reason: 'sync',
        nowSec,
      }
    );
    return { status: 'valid', session: updated };
  } catch {
    // Transient network error: preserve existing valid session
    return { status: 'transient_error', session: current };
  }
}
