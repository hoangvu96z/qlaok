import type {
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobilePromoBannerConfig,
  MobileShop,
  MobileShopMembership,
  MobileShopPaymentConfig,
  MobileShopPermission,
  MobileShopRole,
  MobileShopThemeConfig,
} from './supabase.ts';

declare const require: ((moduleId: string) => unknown) | undefined;

export const STAFF_SESSION_STORAGE_KEY = 'qlaok_mobile_staff_session_v1';
export const STAFF_SESSION_REVOKED_CODE = 'STAFF_SESSION_REVOKED';
export const DEFAULT_STAFF_BACKEND_ORIGIN = 'https://qlaok.vunph.click';

export type MobileStaffRole = Exclude<MobileShopRole, 'owner'>;

export interface MobileStaffUser {
  id: string;
  username: string;
  full_name: string;
  role: MobileStaffRole;
  shop_id: string;
  account_type: 'staff';
}

export type StaffSessionUser = MobileStaffUser;

/**
 * Isolated mobile staff session DTO containing only the server-verified login
 * response values required to establish staff mode.
 * Never stores passwords and never derives trust from locally decoded token claims.
 */
export interface MobileStaffSession {
  accessToken: string;
  user: MobileStaffUser;
  shop: MobileShop;
  activeShopId: string;
  membership: MobileShopMembership;
}

export type StaffSession = MobileStaffSession;

export interface StandardStaffSessionStorage {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem?: (key: string) => Promise<void> | void;
  deleteItemAsync?: (key: string) => Promise<void> | void;
}

export interface ExpoSecureStoreLike {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

export type StaffSessionStorageAdapter =
  | StandardStaffSessionStorage
  | ExpoSecureStoreLike;

interface NormalizedStaffSessionStorage {
  targetKey: object;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export class StaffAuthError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      retryAfterSec?: number;
    }
  ) {
    super(message);
    this.name = 'StaffAuthError';
    this.status = options?.status;
    this.code = options?.code;
    this.retryAfterSec = options?.retryAfterSec;
  }
}

const ALLOWED_STAFF_SHOP_PERMISSIONS = new Set<MobileShopPermission>([
  'orders.view',
  'orders.create',
  'orders.fulfill',
  'orders.edit_items',
  'orders.cancel_unpaid',
  'orders.print_kitchen',
  'orders.print_provisional',
  'payment.collect',
  'discount.apply',
  'payment.refund',
  'catalog.view',
  'catalog.manage',
  'promotions.manage',
  'settings.manage',
  'settings.bank',
  'reports.view',
  'order.view',
  'order.refund',
  'inventory.adjust',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMobileStaffRole(value: unknown): value is MobileStaffRole {
  return value === 'cashier' || value === 'staff';
}

function isAllowedStaffPermission(
  value: unknown
): value is MobileShopPermission {
  return (
    typeof value === 'string' &&
    ALLOWED_STAFF_SHOP_PERMISSIONS.has(value as MobileShopPermission)
  );
}

export function redactSensitiveText(
  message: string,
  secrets: ReadonlyArray<string | null | undefined>
): string {
  let sanitized = String(message || '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
      const trimmed = secret.trim();
      if (trimmed.length > 0 && trimmed !== secret) {
        sanitized = sanitized.split(trimmed).join('[REDACTED]');
      }
    }
  }
  return sanitized;
}

function sanitizeThemeConfig(
  rawTheme: unknown
): MobileShopThemeConfig | undefined {
  if (!isPlainRecord(rawTheme)) return undefined;

  const theme: MobileShopThemeConfig = {};

  if (typeof rawTheme.primaryColor === 'string' && rawTheme.primaryColor.trim()) {
    theme.primaryColor = rawTheme.primaryColor.trim();
  }
  if (rawTheme.layout === 'list' || rawTheme.layout === 'grid') {
    theme.layout = rawTheme.layout;
  }
  if (
    rawTheme.backgroundStyle === 'clean' ||
    rawTheme.backgroundStyle === 'warm' ||
    rawTheme.backgroundStyle === 'dark' ||
    rawTheme.backgroundStyle === 'custom_image'
  ) {
    theme.backgroundStyle = rawTheme.backgroundStyle;
  }
  if (
    typeof rawTheme.backgroundImageUrl === 'string' &&
    rawTheme.backgroundImageUrl.trim()
  ) {
    theme.backgroundImageUrl = rawTheme.backgroundImageUrl.trim();
  }
  if (
    typeof rawTheme.backgroundOverlayOpacity === 'number' &&
    Number.isFinite(rawTheme.backgroundOverlayOpacity)
  ) {
    theme.backgroundOverlayOpacity = rawTheme.backgroundOverlayOpacity;
  }
  if (isPlainRecord(rawTheme.promoBanner)) {
    theme.promoBanner = {
      ...(rawTheme.promoBanner as unknown as MobilePromoBannerConfig),
      enabled: Boolean(rawTheme.promoBanner.enabled),
      title:
        typeof rawTheme.promoBanner.title === 'string'
          ? rawTheme.promoBanner.title
          : '',
    };
  }
  if (isPlainRecord(rawTheme.flashSale)) {
    theme.flashSale = {
      ...(rawTheme.flashSale as unknown as MobileFlashSaleConfig),
      enabled: Boolean(rawTheme.flashSale.enabled),
      title:
        typeof rawTheme.flashSale.title === 'string'
          ? rawTheme.flashSale.title
          : '',
      discountType:
        rawTheme.flashSale.discountType === 'fixed_amount'
          ? 'fixed_amount'
          : 'percent',
      discountValue:
        typeof rawTheme.flashSale.discountValue === 'number' &&
        Number.isFinite(rawTheme.flashSale.discountValue)
          ? rawTheme.flashSale.discountValue
          : 0,
      itemIds: Array.isArray(rawTheme.flashSale.itemIds)
        ? rawTheme.flashSale.itemIds.filter(
            (id): id is string => typeof id === 'string'
          )
        : [],
    };
  }
  if (isPlainRecord(rawTheme.welcomePopup)) {
    theme.welcomePopup = {
      ...(rawTheme.welcomePopup as unknown as MobilePopupConfig),
      enabled: Boolean(rawTheme.welcomePopup.enabled),
      title:
        typeof rawTheme.welcomePopup.title === 'string'
          ? rawTheme.welcomePopup.title
          : '',
      content:
        typeof rawTheme.welcomePopup.content === 'string'
          ? rawTheme.welcomePopup.content
          : '',
    };
  }
  if (isPlainRecord(rawTheme.paymentConfig)) {
    theme.paymentConfig = {
      ...(rawTheme.paymentConfig as unknown as MobileShopPaymentConfig),
    };
  }
  if (isPlainRecord(rawTheme.paymentQr)) {
    theme.paymentQr = {
      ...(rawTheme.paymentQr as unknown as MobileShopPaymentConfig),
    };
  }

  return Object.keys(theme).length > 0 ? theme : undefined;
}

function validateAndNormalizeMobileShop(rawShop: unknown): MobileShop | null {
  if (!isPlainRecord(rawShop)) return null;

  const id = typeof rawShop.id === 'string' ? rawShop.id.trim() : '';
  const slug = typeof rawShop.slug === 'string' ? rawShop.slug.trim() : '';
  const name = typeof rawShop.name === 'string' ? rawShop.name.trim() : '';
  if (!id || !slug || !name) return null;

  if (
    rawShop.owner_id !== undefined &&
    typeof rawShop.owner_id !== 'string'
  ) {
    return null;
  }
  const ownerId =
    typeof rawShop.owner_id === 'string' ? rawShop.owner_id.trim() : '';

  let vertical: 'fnb' | 'service' | 'retail' = 'fnb';
  if (rawShop.vertical !== undefined) {
    if (
      rawShop.vertical !== 'fnb' &&
      rawShop.vertical !== 'service' &&
      rawShop.vertical !== 'retail'
    ) {
      return null;
    }
    vertical = rawShop.vertical;
  }

  if (rawShop.city !== undefined && typeof rawShop.city !== 'string') {
    return null;
  }
  const city = typeof rawShop.city === 'string' ? rawShop.city.trim() : '';

  let supportedLangs: string[] = ['vi'];
  if (rawShop.supported_langs !== undefined) {
    if (!Array.isArray(rawShop.supported_langs)) return null;
    const filtered = rawShop.supported_langs
      .filter((lang): lang is string => typeof lang === 'string')
      .map((lang) => lang.trim())
      .filter(Boolean);
    supportedLangs = filtered.length > 0 ? filtered : ['vi'];
  }

  if (
    rawShop.is_published !== undefined &&
    typeof rawShop.is_published !== 'boolean'
  ) {
    return null;
  }
  const isPublished =
    typeof rawShop.is_published === 'boolean' ? rawShop.is_published : true;

  const normalized: MobileShop = {
    id,
    owner_id: ownerId,
    slug,
    name,
    vertical,
    city,
    supported_langs: supportedLangs,
    is_published: isPublished,
  };

  if (typeof rawShop.address === 'string' && rawShop.address.trim()) {
    normalized.address = rawShop.address.trim();
  }
  if (
    typeof rawShop.phone_contact === 'string' &&
    rawShop.phone_contact.trim()
  ) {
    normalized.phone_contact = rawShop.phone_contact.trim();
  }
  if (typeof rawShop.zalo_phone === 'string' && rawShop.zalo_phone.trim()) {
    normalized.zalo_phone = rawShop.zalo_phone.trim();
  }
  if (
    isPlainRecord(rawShop.wifi_info) &&
    typeof rawShop.wifi_info.ssid === 'string' &&
    rawShop.wifi_info.ssid.trim()
  ) {
    // Deliberately omit wifi password from stored staff session credentials
    normalized.wifi_info = {
      ssid: rawShop.wifi_info.ssid.trim(),
    };
  }
  const themeConfig = sanitizeThemeConfig(rawShop.theme_config);
  if (themeConfig) {
    normalized.theme_config = themeConfig;
  }

  return normalized;
}

function validateAndNormalizeStaffUser(
  rawUser: unknown,
  expectedShopId: string
): MobileStaffUser | null {
  if (!isPlainRecord(rawUser)) return null;

  if ('password' in rawUser && rawUser.password !== undefined) {
    return null;
  }
  if ('password_hash' in rawUser && rawUser.password_hash !== undefined) {
    return null;
  }
  if (rawUser.is_admin === true) {
    return null;
  }

  const id = typeof rawUser.id === 'string' ? rawUser.id.trim() : '';
  const username =
    typeof rawUser.username === 'string' ? rawUser.username.trim() : '';
  if (!id || !username) return null;

  if (!isMobileStaffRole(rawUser.role)) {
    return null;
  }

  if (
    rawUser.account_type !== undefined &&
    rawUser.account_type !== 'staff'
  ) {
    return null;
  }

  if (rawUser.shop_id !== undefined) {
    if (
      typeof rawUser.shop_id !== 'string' ||
      rawUser.shop_id.trim() !== expectedShopId
    ) {
      return null;
    }
  }

  if (
    rawUser.full_name !== undefined &&
    rawUser.full_name !== null &&
    typeof rawUser.full_name !== 'string'
  ) {
    return null;
  }

  const fullName =
    typeof rawUser.full_name === 'string' && rawUser.full_name.trim()
      ? rawUser.full_name.trim()
      : username;

  return {
    id,
    username,
    full_name: fullName,
    role: rawUser.role,
    shop_id: expectedShopId,
    account_type: 'staff',
  };
}

function validateAndNormalizeStaffMembership(
  rawMembership: unknown,
  expectedShopId: string,
  expectedUser: MobileStaffUser
): MobileShopMembership | null {
  if (!isPlainRecord(rawMembership)) return null;

  const id =
    typeof rawMembership.id === 'string' ? rawMembership.id.trim() : '';
  const shopId =
    typeof rawMembership.shop_id === 'string'
      ? rawMembership.shop_id.trim()
      : '';
  const userId =
    typeof rawMembership.user_id === 'string'
      ? rawMembership.user_id.trim()
      : '';

  if (!id || !shopId || !userId) return null;
  if (shopId !== expectedShopId) return null;
  if (userId !== expectedUser.id) return null;

  if (!isMobileStaffRole(rawMembership.role)) return null;
  if (rawMembership.role !== expectedUser.role) return null;

  if (rawMembership.is_active !== true) return null;

  if (!Array.isArray(rawMembership.permissions)) return null;
  const permissions: MobileShopPermission[] = [];
  const seen = new Set<MobileShopPermission>();
  for (const perm of rawMembership.permissions) {
    if (!isAllowedStaffPermission(perm)) {
      return null;
    }
    if (!seen.has(perm)) {
      seen.add(perm);
      permissions.push(perm);
    }
  }

  return {
    id,
    shop_id: shopId,
    user_id: userId,
    role: rawMembership.role,
    permissions,
    is_active: true,
  };
}

/**
 * Validates a candidate staff session DTO (or login response payload) and returns
 * a sanitized `MobileStaffSession` containing only the verified fields needed for
 * staff mode. Returns `null` if any field or shop/user/membership binding is malformed.
 */
export function validateStaffSession(
  candidate: unknown
): MobileStaffSession | null {
  if (!isPlainRecord(candidate)) return null;

  if ('password' in candidate && candidate.password !== undefined) {
    return null;
  }
  if (candidate.isAdmin === true) {
    return null;
  }
  if (
    candidate.shops !== undefined &&
    (!Array.isArray(candidate.shops) || candidate.shops.length > 0)
  ) {
    return null;
  }

  const accessToken =
    typeof candidate.accessToken === 'string'
      ? candidate.accessToken.trim()
      : '';
  if (!accessToken || /\s/.test(accessToken)) {
    return null;
  }

  const activeShopId =
    typeof candidate.activeShopId === 'string'
      ? candidate.activeShopId.trim()
      : '';
  if (!activeShopId) {
    return null;
  }

  let rawShop: unknown = candidate.shop;
  if (rawShop === undefined && candidate.memberShops !== undefined) {
    if (
      !Array.isArray(candidate.memberShops) ||
      candidate.memberShops.length !== 1
    ) {
      return null;
    }
    rawShop = candidate.memberShops[0];
  } else if (
    candidate.memberShops !== undefined &&
    (!Array.isArray(candidate.memberShops) ||
      candidate.memberShops.length !== 1)
  ) {
    return null;
  }

  let rawMembership: unknown = candidate.membership;
  if (rawMembership === undefined && candidate.memberships !== undefined) {
    if (
      !Array.isArray(candidate.memberships) ||
      candidate.memberships.length !== 1
    ) {
      return null;
    }
    rawMembership = candidate.memberships[0];
  } else if (
    candidate.memberships !== undefined &&
    (!Array.isArray(candidate.memberships) ||
      candidate.memberships.length !== 1)
  ) {
    return null;
  }

  const shop = validateAndNormalizeMobileShop(rawShop);
  if (!shop || shop.id !== activeShopId) {
    return null;
  }

  const user = validateAndNormalizeStaffUser(candidate.user, activeShopId);
  if (!user) {
    return null;
  }

  const membership = validateAndNormalizeStaffMembership(
    rawMembership,
    activeShopId,
    user
  );
  if (!membership) {
    return null;
  }

  return {
    accessToken,
    user,
    shop,
    activeShopId,
    membership,
  };
}

/**
 * Validates the raw JSON payload returned by `POST /api/auth` (`action: 'staff_login'`).
 * Requires `{ user, memberShops: [shop], memberships: [membership], activeShopId, accessToken }`
 * with consistent shop, user, and active membership bindings.
 */
export function parseStaffLoginResponse(payload: unknown): MobileStaffSession {
  if (!isPlainRecord(payload)) {
    throw new StaffAuthError(
      'Phản hồi đăng nhập nhân viên không hợp lệ từ máy chủ.',
      { code: 'INVALID_STAFF_SESSION_RESPONSE' }
    );
  }

  if (
    !Array.isArray(payload.memberShops) ||
    payload.memberShops.length !== 1 ||
    !Array.isArray(payload.memberships) ||
    payload.memberships.length !== 1
  ) {
    throw new StaffAuthError(
      'Phản hồi đăng nhập nhân viên không hợp lệ từ máy chủ.',
      { code: 'INVALID_STAFF_SESSION_RESPONSE' }
    );
  }

  const session = validateStaffSession(payload);
  if (!session) {
    throw new StaffAuthError(
      'Phản hồi đăng nhập nhân viên không hợp lệ từ máy chủ.',
      { code: 'INVALID_STAFF_SESSION_RESPONSE' }
    );
  }

  return session;
}

export function serializeStaffSession(session: MobileStaffSession): string {
  const validated = validateStaffSession(session);
  if (!validated) {
    throw new StaffAuthError(
      'Dữ liệu phiên nhân viên không hợp lệ để lưu trữ.',
      { code: 'INVALID_STAFF_SESSION' }
    );
  }
  return JSON.stringify(validated);
}

export function deserializeStaffSession(
  raw: string | null | undefined
): MobileStaffSession | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return validateStaffSession(parsed);
  } catch {
    return null;
  }
}

export function createInMemoryStaffSessionStorage(
  initialEntries?: Record<string, string>
): StandardStaffSessionStorage & { snapshot: () => Record<string, string> } {
  const map = new Map<string, string>(
    initialEntries ? Object.entries(initialEntries) : []
  );
  return {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
    snapshot: () => Object.fromEntries(map.entries()),
  };
}

/**
 * Wraps Expo SecureStore into a `StaffSessionStorageAdapter` for native iOS/Android.
 * Returns `null` on web or when SecureStore methods are unavailable.
 */
export function createExpoSecureStoreAdapter(
  secureStore: Partial<ExpoSecureStoreLike> | null | undefined,
  platformOs?: string | null
): StandardStaffSessionStorage | null {
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

const defaultMemoryStorage = createInMemoryStaffSessionStorage();
let configuredDefaultStorage: StaffSessionStorageAdapter | null | undefined;
let resolvedNativeStorageCache: StandardStaffSessionStorage | null | undefined;

function resolveNativeSecureStoreAdapter(): StandardStaffSessionStorage | null {
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
    // Outside React Native runtime (e.g. Node test environment)
  }
  resolvedNativeStorageCache = null;
  return null;
}

function normalizeStorageAdapter(
  adapter?: StaffSessionStorageAdapter | null
): NormalizedStaffSessionStorage {
  const target: StaffSessionStorageAdapter =
    adapter ??
    configuredDefaultStorage ??
    resolveNativeSecureStoreAdapter() ??
    defaultMemoryStorage;

  if ('getItemAsync' in target && typeof target.getItemAsync === 'function') {
    return {
      targetKey: target,
      getItem: async (key: string) => target.getItemAsync(key),
      setItem: async (key: string, value: string) => {
        await target.setItemAsync(key, value);
      },
      removeItem: async (key: string) => {
        await target.deleteItemAsync(key);
      },
    };
  }

  const std = target as StandardStaffSessionStorage;
  return {
    targetKey: target,
    getItem: async (key: string) => await std.getItem(key),
    setItem: async (key: string, value: string) => {
      await std.setItem(key, value);
    },
    removeItem: async (key: string) => {
      if (typeof std.removeItem === 'function') {
        await std.removeItem(key);
      } else if (typeof std.deleteItemAsync === 'function') {
        await std.deleteItemAsync(key);
      } else {
        await std.setItem(key, '');
      }
    },
  };
}

const storageQueues = new WeakMap<object, Promise<unknown>>();

function enqueueStorageOp<T>(
  normalized: NormalizedStaffSessionStorage,
  operation: () => Promise<T>
): Promise<T> {
  const prev = storageQueues.get(normalized.targetKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(operation);
  storageQueues.set(normalized.targetKey, next);
  return next;
}

export function configureStaffSessionStorage(
  adapter: StaffSessionStorageAdapter | null | undefined
): void {
  configuredDefaultStorage = adapter;
}

export function resetStaffSessionMemoryForTest(): void {
  configuredDefaultStorage = undefined;
  void defaultMemoryStorage.removeItem?.(STAFF_SESSION_STORAGE_KEY);
}

export async function saveStaffSession(
  session: MobileStaffSession,
  storage?: StaffSessionStorageAdapter | null
): Promise<MobileStaffSession> {
  const validated = validateStaffSession(session);
  if (!validated) {
    throw new StaffAuthError(
      'Dữ liệu phiên nhân viên không hợp lệ để lưu trữ.',
      { code: 'INVALID_STAFF_SESSION' }
    );
  }
  const serialized = JSON.stringify(validated);
  const normalized = normalizeStorageAdapter(storage);
  await enqueueStorageOp(normalized, async () => {
    await normalized.setItem(STAFF_SESSION_STORAGE_KEY, serialized);
  });
  return validated;
}

export const persistStaffSession = saveStaffSession;
export const storeStaffSession = saveStaffSession;

export async function clearStaffSession(
  storage?: StaffSessionStorageAdapter | null
): Promise<void> {
  const normalized = normalizeStorageAdapter(storage);
  await enqueueStorageOp(normalized, async () => {
    await normalized.removeItem(STAFF_SESSION_STORAGE_KEY);
  });
}

export async function loadStaffSession(
  storage?: StaffSessionStorageAdapter | null
): Promise<MobileStaffSession | null> {
  const normalized = normalizeStorageAdapter(storage);
  return enqueueStorageOp(normalized, async () => {
    const raw = await normalized.getItem(STAFF_SESSION_STORAGE_KEY);
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }
    const parsed = deserializeStaffSession(raw);
    if (!parsed) {
      try {
        await normalized.removeItem(STAFF_SESSION_STORAGE_KEY);
      } catch {
        // Ignore cleanup errors when purging malformed stored session data
      }
      return null;
    }
    return parsed;
  });
}

export const getStoredStaffSession = loadStaffSession;
export const readStaffSession = loadStaffSession;

export async function getStaffAccessToken(
  storage?: StaffSessionStorageAdapter | null
): Promise<string | null> {
  const session = await loadStaffSession(storage);
  return session?.accessToken ?? null;
}

export interface StaffLoginCredentials {
  shopIdentifier: string;
  username: string;
  password: string;
}

export interface StaffLoginOptions {
  baseUrl?: string;
  fetchRequest?: typeof fetch;
  fetchImpl?: typeof fetch;
  storage?: StaffSessionStorageAdapter | null;
  signal?: AbortSignal;
}

export type LoginStaffParams = StaffLoginCredentials & StaffLoginOptions;

let defaultStaffApiBaseUrlResolver: () => string = () => {
  const envUrl =
    typeof process !== 'undefined'
      ? process.env?.EXPO_PUBLIC_API_URL?.trim()
      : '';
  return (envUrl || DEFAULT_STAFF_BACKEND_ORIGIN).replace(/\/+$/, '');
};

export function setDefaultStaffApiBaseUrlResolver(
  resolver: () => string
): void {
  defaultStaffApiBaseUrlResolver = resolver;
}

function resolveBaseUrl(explicitBaseUrl?: string): string {
  const candidate =
    typeof explicitBaseUrl === 'string' && explicitBaseUrl.trim()
      ? explicitBaseUrl.trim()
      : defaultStaffApiBaseUrlResolver();
  return candidate.replace(/\/+$/, '');
}

function parsePositiveRetryAfterSeconds(
  bodyRetryAfter: unknown,
  retryAfterHeader: string | null | undefined
): number | undefined {
  if (
    typeof bodyRetryAfter === 'number' &&
    Number.isFinite(bodyRetryAfter) &&
    bodyRetryAfter > 0
  ) {
    return Math.ceil(bodyRetryAfter);
  }
  if (typeof retryAfterHeader === 'string' && retryAfterHeader.trim()) {
    const parsed = Number(retryAfterHeader.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.ceil(parsed);
    }
  }
  return undefined;
}

/**
 * Authenticates a shop-scoped staff account against `POST ${baseUrl}/api/auth`
 * with JSON `{ action: 'staff_login', shopIdentifier, username, password }` and
 * NO Authorization header.
 *
 * - Trims `shopIdentifier` and `username`.
 * - Preserves `password` bytes verbatim (never trims or logs passwords).
 * - Persists the validated `MobileStaffSession` only after a 2xx structurally valid response.
 * - Preserves server generic/rate-limit errors without storing a session.
 */
export async function loginStaff(
  params: LoginStaffParams,
  options?: StaffLoginOptions
): Promise<MobileStaffSession> {
  const shopIdentifier =
    typeof params?.shopIdentifier === 'string'
      ? params.shopIdentifier.trim()
      : '';
  const username =
    typeof params?.username === 'string' ? params.username.trim() : '';
  const password =
    typeof params?.password === 'string' ? params.password : '';

  const baseUrl = resolveBaseUrl(options?.baseUrl ?? params?.baseUrl);
  const fetchFn =
    options?.fetchRequest ??
    options?.fetchImpl ??
    params?.fetchRequest ??
    params?.fetchImpl ??
    fetch;
  const storage =
    options?.storage !== undefined ? options.storage : params?.storage;
  const callerSignal = options?.signal ?? params?.signal;

  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  headers.delete('Authorization');
  headers.delete('authorization');

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal?.aborted) abort();
  callerSignal?.addEventListener('abort', abort);
  const timeout = setTimeout(abort, 15000);

  let response: Response;
  try {
    response = await fetchFn(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'staff_login',
        shopIdentifier,
        username,
        password,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const rawMsg =
      err instanceof Error && err.message
        ? err.message
        : 'Không thể kết nối máy chủ xác thực.';
    throw new StaffAuthError(redactSensitiveText(rawMsg, [password]), {
      code: 'NETWORK_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abort);
  }

  let bodyData: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (isPlainRecord(parsed)) {
      bodyData = parsed;
    }
  } catch {
    bodyData = null;
  }

  if (!response.ok) {
    const errorCode =
      typeof bodyData?.code === 'string' && bodyData.code.trim()
        ? bodyData.code.trim()
        : undefined;
    const retryAfterSec = parsePositiveRetryAfterSeconds(
      bodyData?.retryAfterSec,
      response.headers?.get('Retry-After')
    );
    const rawError =
      typeof bodyData?.error === 'string' && bodyData.error.trim()
        ? bodyData.error.trim()
        : `Đăng nhập nhân viên thất bại (${response.status})`;
    const safeErrorMessage = redactSensitiveText(rawError, [
      password,
      typeof bodyData?.accessToken === 'string' ? bodyData.accessToken : null,
    ]);

    throw new StaffAuthError(safeErrorMessage, {
      status: response.status,
      code: errorCode,
      retryAfterSec,
    });
  }

  let validatedSession: MobileStaffSession;
  try {
    validatedSession = parseStaffLoginResponse(bodyData);
  } catch (err) {
    const rawMsg =
      err instanceof Error && err.message
        ? err.message
        : 'Phản hồi đăng nhập nhân viên không hợp lệ từ máy chủ.';
    throw new StaffAuthError(
      redactSensitiveText(rawMsg, [
        password,
        typeof bodyData?.accessToken === 'string' ? bodyData.accessToken : null,
      ]),
      {
        status: response.status,
        code:
          err instanceof StaffAuthError && err.code
            ? err.code
            : 'INVALID_STAFF_SESSION_RESPONSE',
      }
    );
  }

  await saveStaffSession(validatedSession, storage);
  return validatedSession;
}
