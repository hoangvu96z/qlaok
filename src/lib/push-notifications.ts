import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ServiceRequestNotificationRule,
  ServiceRequestType,
  ShopMembership,
  ShopOrder,
  ShopThemeConfig,
  TableServiceRequest,
} from '@/types/qlaok';
import { getSupabaseDbClient } from './db';
import { SEED_SHOPS } from './seed-data';
import { dbGetShopMemberships, hasShopPermission } from './shop-permissions';
import { isSupabaseConfigured } from './supabase/client';

export type MobilePushLocale = 'vi' | 'en';
export type MobilePushPlatform = 'ios' | 'android' | 'web' | 'unknown';

export interface MobilePushTokenRecord {
  id: string;
  user_id: string;
  shop_id: string;
  expo_push_token: string;
  locale: MobilePushLocale;
  platform: MobilePushPlatform;
  device_name?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface ExpoPushMessagePayload {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: {
    type: 'new_qr_order';
    shopId: string;
    orderId: string;
    orderCode: string;
    tableLabel: string;
    tab: 'orders';
  };
}

export interface NewOrderPushDispatchResult {
  sent: number;
  skipped: boolean;
  reason?: string;
  recipientsCount: number;
  tokensCount: number;
}

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const ANDROID_ORDERS_CHANNEL_ID = 'qlaok-orders';

const EXPO_PUSH_TOKEN_REGEX =
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_.-]+\]$/;

const IS_NODE_TEST_PROCESS =
  Boolean(process.env.NODE_TEST_CONTEXT) ||
  process.argv.includes('--test') ||
  process.execArgv.includes('--test') ||
  process.env.NODE_ENV === 'test';

const PROCESS_TEST_PUSH_FILE = IS_NODE_TEST_PROCESS
  ? path.join(
      os.tmpdir(),
      `qlaok-push-tokens-test-${process.pid}-${Date.now()}`,
      'mobile-push-tokens.json'
    )
  : null;

const DEFAULT_PUSH_STORE_FILE = path.join(
  process.cwd(),
  '.local-db',
  'mobile-push-tokens.json'
);

let testPushStoreFileOverride: string | null = null;
let testPushDbClientOverride: SupabaseClient | null = null;
let testForcePushDbMode: boolean | null = null;
let testPushFetchOverride: typeof fetch | null = null;

// Bounded in-memory deduplication for successfully dispatched order notifications
// (by order.id and shop_id+idempotency_key) plus in-flight concurrency guard.
const MAX_DISPATCHED_KEYS = 2000;
const dispatchedNotificationKeys = new Set<string>();
const inFlightNotificationKeys = new Set<string>();

function rememberNotificationKey(key: string): void {
  if (!key) return;
  if (dispatchedNotificationKeys.size >= MAX_DISPATCHED_KEYS) {
    const oldest = dispatchedNotificationKeys.values().next().value;
    if (oldest) dispatchedNotificationKeys.delete(oldest);
  }
  dispatchedNotificationKeys.add(key);
}

export function resetPushNotificationStateForTests(): void {
  dispatchedNotificationKeys.clear();
  inFlightNotificationKeys.clear();
  const file = resolvePushStoreFilePath();
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // ignore cleanup errors
  }
}

export function setPushStoreFileForTests(filePath: string | null): void {
  testPushStoreFileOverride = filePath;
}

export function setPushDbClientForTests(
  client: SupabaseClient | null,
  forceDbMode?: boolean
): void {
  testPushDbClientOverride = client;
  testForcePushDbMode =
    forceDbMode !== undefined ? forceDbMode : client !== null ? true : null;
}

export function setPushFetchForTests(customFetch: typeof fetch | null): void {
  testPushFetchOverride = customFetch;
}

export function isValidExpoPushToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 256) return false;
  return EXPO_PUSH_TOKEN_REGEX.test(trimmed);
}

export function normalizePushLocale(locale: unknown): MobilePushLocale {
  if (typeof locale === 'string' && locale.trim().toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'vi';
}

export function normalizePushPlatform(platform: unknown): MobilePushPlatform {
  if (typeof platform === 'string') {
    const clean = platform.trim().toLowerCase();
    if (clean === 'ios' || clean === 'android' || clean === 'web') {
      return clean;
    }
  }
  return 'unknown';
}

export function isPushTokenDbAuthoritative(): boolean {
  if (testForcePushDbMode !== null) return testForcePushDbMode;
  if (testPushDbClientOverride !== null) return true;
  if (
    IS_NODE_TEST_PROCESS &&
    process.env.QLAOK_ENABLE_TEST_SUPABASE !== '1'
  ) {
    return false;
  }
  const explicitLocalMode =
    process.env.QLAOK_TEST_LOCAL_DB === '1' ||
    process.env.QLAOK_FORCE_LOCAL_MEMBERSHIPS === '1';
  if (explicitLocalMode && process.env.NODE_ENV !== 'production') {
    return false;
  }
  return (
    isSupabaseConfigured() ||
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  );
}

function getPushDbClient(): SupabaseClient {
  if (testPushDbClientOverride) return testPushDbClientOverride;
  return getSupabaseDbClient();
}

function resolvePushStoreFilePath(): string {
  if (testPushStoreFileOverride) return testPushStoreFileOverride;
  if (PROCESS_TEST_PUSH_FILE) return PROCESS_TEST_PUSH_FILE;
  return DEFAULT_PUSH_STORE_FILE;
}

function readLocalPushTokens(): MobilePushTokenRecord[] {
  const file = resolvePushStoreFilePath();
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row && typeof row === 'object')
      )
      .map(normalizePushTokenRow)
      .filter((row): row is MobilePushTokenRecord => Boolean(row));
  } catch {
    return [];
  }
}

function writeLocalPushTokens(records: MobilePushTokenRecord[]): void {
  const file = resolvePushStoreFilePath();
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(records, null, 2), 'utf8');
  } catch {
    // ignore read-only fs errors in container
  }
}

function normalizePushTokenRow(
  raw: Record<string, unknown>
): MobilePushTokenRecord | null {
  const userId = String(raw.user_id || '').trim();
  const shopId = String(raw.shop_id || '').trim();
  const token = String(raw.expo_push_token || '').trim();
  if (!userId || !shopId || !isValidExpoPushToken(token)) {
    return null;
  }
  const nowIso = new Date().toISOString();
  return {
    id: String(raw.id || `push-${shopId}-${userId}`),
    user_id: userId,
    shop_id: shopId,
    expo_push_token: token,
    locale: normalizePushLocale(raw.locale),
    platform: normalizePushPlatform(raw.platform),
    device_name:
      typeof raw.device_name === 'string' && raw.device_name.trim()
        ? raw.device_name.trim()
        : null,
    is_active: raw.is_active !== undefined ? Boolean(raw.is_active) : true,
    created_at:
      typeof raw.created_at === 'string' && raw.created_at
        ? raw.created_at
        : nowIso,
    updated_at:
      typeof raw.updated_at === 'string' && raw.updated_at
        ? raw.updated_at
        : nowIso,
    last_seen_at:
      typeof raw.last_seen_at === 'string' && raw.last_seen_at
        ? raw.last_seen_at
        : nowIso,
  };
}

export async function dbUpsertMobilePushToken(input: {
  user_id: string;
  shop_id: string;
  expo_push_token: string;
  locale?: unknown;
  platform?: unknown;
  device_name?: string | null;
}): Promise<MobilePushTokenRecord> {
  const userId = String(input.user_id || '').trim();
  const shopId = String(input.shop_id || '').trim();
  const token = String(input.expo_push_token || '').trim();

  if (!userId || !shopId) {
    throw new Error('MISSING_PUSH_SCOPE: Thiếu thông tin người dùng hoặc cửa hàng.');
  }
  if (!isValidExpoPushToken(token)) {
    throw new Error('INVALID_EXPO_PUSH_TOKEN: Định dạng Expo push token không hợp lệ.');
  }

  const locale = normalizePushLocale(input.locale);
  const platform = normalizePushPlatform(input.platform);
  const deviceName =
    typeof input.device_name === 'string' && input.device_name.trim()
      ? input.device_name.trim().slice(0, 120)
      : null;
  const nowIso = new Date().toISOString();

  if (isPushTokenDbAuthoritative()) {
    const sb = getPushDbClient();
    // Ensure a physical device token is only active for the currently logged-in user on this shop
    // by deactivating any stale registrations of the same expo_push_token owned by another user.
    await sb
      .from('mobile_push_tokens')
      .delete()
      .eq('expo_push_token', token)
      .neq('user_id', userId);

    const payload = {
      id: `push-${shopId}-${userId}-${Buffer.from(token).toString('base64url').slice(0, 24)}`,
      user_id: userId,
      shop_id: shopId,
      expo_push_token: token,
      locale,
      platform,
      device_name: deviceName,
      is_active: true,
      updated_at: nowIso,
      last_seen_at: nowIso,
    };

    const { data, error } = await sb
      .from('mobile_push_tokens')
      .upsert(payload, { onConflict: 'user_id,shop_id,expo_push_token' })
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(
        `DB_UPSERT_PUSH_TOKEN_FAILED: ${error.message || 'Không thể lưu push token.'}`
      );
    }

    if (data && typeof data === 'object') {
      const normalized = normalizePushTokenRow(data as Record<string, unknown>);
      if (normalized) return normalized;
    }

    return {
      ...payload,
      created_at: nowIso,
    };
  }

  const list = readLocalPushTokens().filter(
    (r) => !(r.expo_push_token === token && r.user_id !== userId)
  );
  const idx = list.findIndex(
    (r) =>
      r.user_id === userId &&
      r.shop_id === shopId &&
      r.expo_push_token === token
  );
  const existing = idx !== -1 ? list[idx] : null;
  const record: MobilePushTokenRecord = {
    id:
      existing?.id ||
      `push-${shopId}-${userId}-${Buffer.from(token).toString('base64url').slice(0, 24)}`,
    user_id: userId,
    shop_id: shopId,
    expo_push_token: token,
    locale,
    platform,
    device_name: deviceName,
    is_active: true,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
    last_seen_at: nowIso,
  };

  if (idx !== -1) {
    list[idx] = record;
  } else {
    list.push(record);
  }
  writeLocalPushTokens(list);
  return record;
}

export async function dbDeleteMobilePushTokens(params: {
  user_id: string;
  shop_id?: string | null;
  expo_push_token?: string | null;
}): Promise<number> {
  const userId = String(params.user_id || '').trim();
  const shopId = params.shop_id ? String(params.shop_id).trim() : '';
  const token = params.expo_push_token
    ? String(params.expo_push_token).trim()
    : '';

  if (!userId) {
    throw new Error('MISSING_USER_ID: Thiếu định danh người dùng.');
  }

  if (isPushTokenDbAuthoritative()) {
    const sb = getPushDbClient();
    let query = sb
      .from('mobile_push_tokens')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    if (shopId) {
      query = query.eq('shop_id', shopId);
    }
    if (token) {
      query = query.eq('expo_push_token', token);
    }
    const { error, count } = await query;
    if (error) {
      throw new Error(
        `DB_DELETE_PUSH_TOKEN_FAILED: ${error.message || 'Không thể xóa push token.'}`
      );
    }
    return typeof count === 'number' ? count : 0;
  }

  const list = readLocalPushTokens();
  const remaining = list.filter((r) => {
    if (r.user_id !== userId) return true;
    if (shopId && r.shop_id !== shopId) return true;
    if (token && r.expo_push_token !== token) return true;
    return false;
  });
  const deleted = list.length - remaining.length;
  if (deleted > 0) {
    writeLocalPushTokens(remaining);
  }
  return deleted;
}

export async function dbGetShopActivePushTokens(
  shopId: string
): Promise<MobilePushTokenRecord[]> {
  if (!shopId) return [];

  if (isPushTokenDbAuthoritative()) {
    const sb = getPushDbClient();
    const { data, error } = await sb
      .from('mobile_push_tokens')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true);

    if (error || !Array.isArray(data)) {
      return [];
    }
    return data
      .map((row) =>
        row && typeof row === 'object'
          ? normalizePushTokenRow(row as Record<string, unknown>)
          : null
      )
      .filter((row): row is MobilePushTokenRecord => Boolean(row && row.is_active));
  }

  return readLocalPushTokens().filter(
    (r) => r.shop_id === shopId && r.is_active
  );
}

export const DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE: ServiceRequestNotificationRule =
  'all_order_staff';

export function isValidServiceRequestNotificationRule(
  value: unknown
): value is ServiceRequestNotificationRule {
  return value === 'all_order_staff' || value === 'owner_only';
}

export function normalizeServiceRequestNotificationRule(
  value: unknown
): ServiceRequestNotificationRule {
  return value === 'owner_only' ? 'owner_only' : 'all_order_staff';
}

export function resolveShopServiceRequestNotificationRule(
  themeOrRule?: ShopThemeConfig | ServiceRequestNotificationRule | unknown
): ServiceRequestNotificationRule {
  if (typeof themeOrRule === 'string') {
    const trimmed = themeOrRule.trim();
    if (isValidServiceRequestNotificationRule(trimmed)) {
      return trimmed;
    }
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        return normalizeServiceRequestNotificationRule(
          parsed?.serviceRequestNotificationRule
        );
      } catch {
        return DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
      }
    }
    return DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
  }
  if (
    themeOrRule &&
    typeof themeOrRule === 'object' &&
    !Array.isArray(themeOrRule) &&
    'serviceRequestNotificationRule' in themeOrRule
  ) {
    return normalizeServiceRequestNotificationRule(
      (themeOrRule as Record<string, unknown>).serviceRequestNotificationRule
    );
  }
  return DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
}

async function lookupShopOwnerAndName(
  shopId: string
): Promise<{ ownerId: string | null; shopName: string }> {
  if (isPushTokenDbAuthoritative()) {
    try {
      const sb = getPushDbClient();
      const { data, error } = await sb
        .from('shops')
        .select('owner_id, name')
        .eq('id', shopId)
        .maybeSingle();
      if (!error && data) {
        return {
          ownerId: typeof data.owner_id === 'string' ? data.owner_id : null,
          shopName:
            typeof data.name === 'string' && data.name.trim()
              ? data.name.trim()
              : 'Qlaok',
        };
      }
    } catch {
      // fall through
    }
  }
  const seed = SEED_SHOPS.find((s) => s.id === shopId);
  return {
    ownerId: seed?.owner_id ?? null,
    shopName: seed?.name || 'Qlaok',
  };
}

async function lookupShopServiceRequestNotificationRule(
  shopId: string
): Promise<ServiceRequestNotificationRule> {
  if (!shopId) return DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
  if (isPushTokenDbAuthoritative()) {
    try {
      const sb = getPushDbClient();
      const { data, error } = await sb
        .from('shops')
        .select('theme_config')
        .eq('id', shopId)
        .maybeSingle();
      if (!error && data) {
        return resolveShopServiceRequestNotificationRule(
          (data as { theme_config?: unknown }).theme_config
        );
      }
    } catch {
      // fall through to seed / default recipient rule
    }
  }
  try {
    const seed = SEED_SHOPS.find((s) => s.id === shopId);
    return resolveShopServiceRequestNotificationRule(seed?.theme_config);
  } catch {
    return DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
  }
}

/**
 * Pure recipient resolver for table service requests and order notifications.
 * - For `call_staff`, missing/invalid legacy rule defaults to `all_order_staff`
 *   (true shop owner unless explicitly inactive + active members with `orders.view`),
 *   while `owner_only` targets only the true shop owner unless explicitly inactive.
 * - For `request_bill`, the recipient rule is always `all_order_staff`.
 */
export function resolveServiceRequestNotificationRecipientUserIds(params: {
  ownerId: string | null | undefined;
  memberships: ShopMembership[];
  requestType: ServiceRequestType;
  rule?: ServiceRequestNotificationRule | unknown;
}): Set<string> {
  const authorized = new Set<string>();
  const ownerId =
    typeof params.ownerId === 'string' && params.ownerId.trim()
      ? params.ownerId.trim()
      : null;
  const memberships = Array.isArray(params.memberships)
    ? params.memberships
    : [];

  const memberByUser = new Map(memberships.map((m) => [m.user_id, m]));
  if (ownerId) {
    const ownerMem = memberByUser.get(ownerId);
    // True shop owner always receives notifications unless explicitly deactivated
    if (!ownerMem || ownerMem.is_active) {
      authorized.add(ownerId);
    }
  }

  const effectiveRule: ServiceRequestNotificationRule =
    params.requestType === 'call_staff'
      ? resolveShopServiceRequestNotificationRule(params.rule)
      : 'all_order_staff';

  if (effectiveRule === 'owner_only') {
    return authorized;
  }

  for (const m of memberships) {
    if (m.is_active && hasShopPermission(m, 'orders.view')) {
      authorized.add(m.user_id);
    }
  }

  return authorized;
}

/**
 * Resolves the set of authorized user IDs for a shop who are permitted to
 * receive new-order push notifications: the shop owner and active shop members
 * with `orders.view`.
 */
export async function resolveAuthorizedOrderNotificationUserIds(
  shopId: string
): Promise<Set<string>> {
  const authorized = new Set<string>();
  if (!shopId) return authorized;

  const { ownerId } = await lookupShopOwnerAndName(shopId);
  const memberships = await dbGetShopMemberships(shopId);

  return resolveServiceRequestNotificationRecipientUserIds({
    ownerId,
    memberships,
    requestType: 'request_bill',
    rule: 'all_order_staff',
  });
}

/**
 * Resolves the set of authorized user IDs for a table service request push notification.
 * Applies `shops.theme_config.serviceRequestNotificationRule` only to `call_staff`
 * and falls back safely to `all_order_staff` if loading the optional rule fails.
 */
export async function resolveAuthorizedServiceRequestNotificationUserIds(
  shopId: string,
  requestType: ServiceRequestType = 'call_staff'
): Promise<Set<string>> {
  const authorized = new Set<string>();
  if (!shopId) return authorized;

  if (requestType !== 'call_staff') {
    return resolveAuthorizedOrderNotificationUserIds(shopId);
  }

  const [{ ownerId }, memberships, rule] = await Promise.all([
    lookupShopOwnerAndName(shopId),
    dbGetShopMemberships(shopId),
    lookupShopServiceRequestNotificationRule(shopId).catch(
      () => DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE
    ),
  ]);

  return resolveServiceRequestNotificationRecipientUserIds({
    ownerId,
    memberships,
    requestType,
    rule,
  });
}

export function buildLocalizedNewOrderPushMessage(params: {
  expoPushToken: string;
  locale: MobilePushLocale;
  shopId: string;
  orderId: string;
  orderCode: string;
  tableLabel: string;
  totalAmount: number;
}): ExpoPushMessagePayload {
  const formattedTotal = `${Math.max(0, Math.round(Number(params.totalAmount || 0))).toLocaleString('vi-VN')}đ`;
  const tableLabel = (params.tableLabel || '').trim() || (params.locale === 'en' ? 'Guest table' : 'Bàn khách');
  const orderCode = (params.orderCode || '').trim() || 'ORD';

  const title =
    params.locale === 'en'
      ? `New QR order • ${tableLabel}`
      : `Đơn QR mới • ${tableLabel}`;
  const body =
    params.locale === 'en'
      ? `#${orderCode} • ${formattedTotal}`
      : `#${orderCode} • ${formattedTotal}`;

  return {
    to: params.expoPushToken,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: ANDROID_ORDERS_CHANNEL_ID,
    data: {
      type: 'new_qr_order',
      shopId: params.shopId,
      orderId: params.orderId,
      orderCode,
      tableLabel,
      tab: 'orders',
    },
  };
}

/**
 * Sends a minimal localized new-order push notification to the shop owner and
 * active members with `orders.view` after a guest QR order is created.
 *
 * Invariants:
 * - Only dispatches for guest QR orders (`source === 'qr_table'` and not staff counter POS).
 * - Deduplicates when `isReplay` is true (idempotent order replay detected by `dbCreateOrder`),
 *   when a dispatch for the same order ID or `(shop_id, idempotency_key)` is already in-flight,
 *   or after at least one provider ticket has succeeded (`sent > 0`).
 * - Failed dispatches (`sent === 0` due to provider HTTP error, network failure, or all error tickets)
 *   are not recorded as sent so retries can still deliver.
 * - Counts only provider tickets with `status === 'ok'` as successful sends (`sent`), and
 *   prunes `DeviceNotRegistered` error tokens automatically.
 * - Filters stored tokens against live shop ownership & active `orders.view` membership
 *   at dispatch time so revoked/cross-shop users never receive notifications.
 * - Never throws: provider or network failures are caught so a committed order never fails.
 */
export async function sendNewGuestOrderPushNotifications(params: {
  order: ShopOrder;
  isGuestOrder: boolean;
  isReplay?: boolean;
}): Promise<NewOrderPushDispatchResult> {
  try {
    const { order, isGuestOrder, isReplay } = params;
    if (!order || !order.id || !order.shop_id) {
      return {
        sent: 0,
        skipped: true,
        reason: 'invalid_order',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    if (!isGuestOrder || order.source !== 'qr_table') {
      return {
        sent: 0,
        skipped: true,
        reason: 'not_guest_qr_order',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    const orderKey = `order:${order.shop_id}:${order.id}`;
    const idempKey = order.idempotency_key?.trim()
      ? `idemp:${order.shop_id}:${order.idempotency_key.trim()}`
      : null;

    if (isReplay) {
      rememberNotificationKey(orderKey);
      if (idempKey) rememberNotificationKey(idempKey);
      return {
        sent: 0,
        skipped: true,
        reason: 'duplicate_or_replay',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    if (
      dispatchedNotificationKeys.has(orderKey) ||
      (idempKey && dispatchedNotificationKeys.has(idempKey)) ||
      inFlightNotificationKeys.has(orderKey) ||
      (idempKey && inFlightNotificationKeys.has(idempKey))
    ) {
      return {
        sent: 0,
        skipped: true,
        reason: 'duplicate_or_replay',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    inFlightNotificationKeys.add(orderKey);
    if (idempKey) inFlightNotificationKeys.add(idempKey);

    try {
      const [authorizedUsers, shopTokens] = await Promise.all([
        resolveAuthorizedOrderNotificationUserIds(order.shop_id),
        dbGetShopActivePushTokens(order.shop_id),
      ]);

      if (authorizedUsers.size === 0 || shopTokens.length === 0) {
        return {
          sent: 0,
          skipped: true,
          reason: 'no_recipients_or_tokens',
          recipientsCount: authorizedUsers.size,
          tokensCount: 0,
        };
      }

      // Deduplicate by expo_push_token while strictly enforcing recipient authorization for this shop
      const uniqueTokenMap = new Map<string, MobilePushTokenRecord>();
      const recipientUserIds = new Set<string>();
      for (const record of shopTokens) {
        if (record.shop_id !== order.shop_id || !record.is_active) continue;
        if (!authorizedUsers.has(record.user_id)) continue;
        if (!isValidExpoPushToken(record.expo_push_token)) continue;
        recipientUserIds.add(record.user_id);
        uniqueTokenMap.set(record.expo_push_token, record);
      }

      const targetTokens = Array.from(uniqueTokenMap.values());
      if (targetTokens.length === 0) {
        return {
          sent: 0,
          skipped: true,
          reason: 'no_authorized_tokens',
          recipientsCount: recipientUserIds.size,
          tokensCount: 0,
        };
      }

      const messages = targetTokens.map((t) =>
        buildLocalizedNewOrderPushMessage({
          expoPushToken: t.expo_push_token,
          locale: t.locale,
          shopId: order.shop_id,
          orderId: order.id,
          orderCode: order.order_code,
          tableLabel: order.table_label,
          totalAmount: order.total_amount,
        })
      );

      const fetchFn = testPushFetchOverride || globalThis.fetch;
      if (typeof fetchFn !== 'function') {
        return {
          sent: 0,
          skipped: true,
          reason: 'fetch_unavailable',
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      }

      // In node:test without a testPushFetchOverride, avoid hitting live exp.host
      if (IS_NODE_TEST_PROCESS && !testPushFetchOverride) {
        return {
          sent: 0,
          skipped: true,
          reason: 'test_mode_external_push_disabled',
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      };
      const expoAccessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
      if (expoAccessToken) {
        headers.Authorization = `Bearer ${expoAccessToken}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetchFn(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            sent: 0,
            skipped: false,
            reason: `provider_http_${response.status}`,
            recipientsCount: recipientUserIds.size,
            tokensCount: messages.length,
          };
        }

        // Inspect tickets: count only status === 'ok' as sent and auto-prune DeviceNotRegistered tokens
        const resultJson = (await response.json().catch(() => null)) as {
          data?: Array<{
            status?: string;
            message?: string;
            details?: { error?: string };
          }>;
        } | null;

        if (!resultJson || !Array.isArray(resultJson.data)) {
          return {
            sent: 0,
            skipped: false,
            reason: 'provider_invalid_response',
            recipientsCount: recipientUserIds.size,
            tokensCount: messages.length,
          };
        }

        let sentCount = 0;
        let errorCount = 0;
        for (let i = 0; i < targetTokens.length; i++) {
          const ticket = resultJson.data[i];
          const target = targetTokens[i];
          if (ticket?.status === 'ok') {
            sentCount += 1;
            continue;
          }
          errorCount += 1;
          if (
            ticket?.status === 'error' &&
            ticket?.details?.error === 'DeviceNotRegistered' &&
            target
          ) {
            await dbDeleteMobilePushTokens({
              user_id: target.user_id,
              shop_id: target.shop_id,
              expo_push_token: target.expo_push_token,
            }).catch(() => {});
          }
        }

        if (sentCount > 0) {
          rememberNotificationKey(orderKey);
          if (idempKey) rememberNotificationKey(idempKey);
        }

        return {
          sent: sentCount,
          skipped: false,
          ...(errorCount > 0
            ? {
                reason:
                  sentCount === 0
                    ? 'provider_ticket_error'
                    : 'partial_ticket_error',
              }
            : {}),
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      inFlightNotificationKeys.delete(orderKey);
      if (idempKey) inFlightNotificationKeys.delete(idempKey);
    }
  } catch (err) {
    return {
      sent: 0,
      skipped: false,
      reason: err instanceof Error ? err.message : 'push_dispatch_failed',
      recipientsCount: 0,
      tokensCount: 0,
    };
  }
}

export interface ServiceRequestExpoPushMessagePayload {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: {
    type: 'table_service_request';
    shopId: string;
    serviceRequestId: string;
    tableId: string;
    tableLabel: string;
    requestType: ServiceRequestType;
    tab: 'orders';
  };
}

export function buildLocalizedServiceRequestPushMessage(params: {
  expoPushToken: string;
  locale: MobilePushLocale;
  shopId: string;
  serviceRequestId: string;
  tableId: string;
  tableLabel: string;
  requestType: ServiceRequestType;
}): ServiceRequestExpoPushMessagePayload {
  const tableLabel =
    (params.tableLabel || '').trim() ||
    (params.locale === 'en' ? 'Guest table' : 'Bàn khách');
  const isBill = params.requestType === 'request_bill';

  const title =
    params.locale === 'en'
      ? isBill
        ? `Bill request • ${tableLabel}`
        : `Guest calling staff • ${tableLabel}`
      : isBill
        ? `Khách xin hóa đơn • ${tableLabel}`
        : `Khách gọi phục vụ • ${tableLabel}`;

  const body =
    params.locale === 'en'
      ? isBill
        ? `${tableLabel} requested the bill / payment assistance.`
        : `${tableLabel} is calling staff to the table.`
      : isBill
        ? `${tableLabel} yêu cầu kiểm tra hóa đơn / thanh toán.`
        : `${tableLabel} đang gọi nhân viên hỗ trợ tại bàn.`;

  return {
    to: params.expoPushToken,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: ANDROID_ORDERS_CHANNEL_ID,
    data: {
      type: 'table_service_request',
      shopId: params.shopId,
      serviceRequestId: params.serviceRequestId,
      tableId: params.tableId,
      tableLabel,
      requestType: params.requestType,
      tab: 'orders',
    },
  };
}

export async function sendServiceRequestPushNotifications(params: {
  serviceRequest: TableServiceRequest;
  isDeduplicated?: boolean;
}): Promise<NewOrderPushDispatchResult> {
  try {
    const { serviceRequest, isDeduplicated } = params;
    if (
      !serviceRequest ||
      !serviceRequest.id ||
      !serviceRequest.shop_id ||
      !serviceRequest.table_id
    ) {
      return {
        sent: 0,
        skipped: true,
        reason: 'invalid_service_request',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    const reqKey = `service_req:${serviceRequest.shop_id}:${serviceRequest.id}`;

    if (isDeduplicated) {
      rememberNotificationKey(reqKey);
      return {
        sent: 0,
        skipped: true,
        reason: 'duplicate_or_replay',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    if (
      dispatchedNotificationKeys.has(reqKey) ||
      inFlightNotificationKeys.has(reqKey)
    ) {
      return {
        sent: 0,
        skipped: true,
        reason: 'duplicate_or_replay',
        recipientsCount: 0,
        tokensCount: 0,
      };
    }

    inFlightNotificationKeys.add(reqKey);

    try {
      const [authorizedUsers, shopTokens] = await Promise.all([
        resolveAuthorizedServiceRequestNotificationUserIds(
          serviceRequest.shop_id,
          serviceRequest.request_type
        ),
        dbGetShopActivePushTokens(serviceRequest.shop_id),
      ]);

      if (authorizedUsers.size === 0 || shopTokens.length === 0) {
        return {
          sent: 0,
          skipped: true,
          reason: 'no_recipients_or_tokens',
          recipientsCount: authorizedUsers.size,
          tokensCount: 0,
        };
      }

      const uniqueTokenMap = new Map<string, MobilePushTokenRecord>();
      const recipientUserIds = new Set<string>();
      for (const record of shopTokens) {
        if (record.shop_id !== serviceRequest.shop_id || !record.is_active) {
          continue;
        }
        if (!authorizedUsers.has(record.user_id)) continue;
        if (!isValidExpoPushToken(record.expo_push_token)) continue;
        recipientUserIds.add(record.user_id);
        uniqueTokenMap.set(record.expo_push_token, record);
      }

      const targetTokens = Array.from(uniqueTokenMap.values());
      if (targetTokens.length === 0) {
        return {
          sent: 0,
          skipped: true,
          reason: 'no_authorized_tokens',
          recipientsCount: recipientUserIds.size,
          tokensCount: 0,
        };
      }

      const messages = targetTokens.map((t) =>
        buildLocalizedServiceRequestPushMessage({
          expoPushToken: t.expo_push_token,
          locale: t.locale,
          shopId: serviceRequest.shop_id,
          serviceRequestId: serviceRequest.id,
          tableId: serviceRequest.table_id,
          tableLabel: serviceRequest.table_label,
          requestType: serviceRequest.request_type,
        })
      );

      const fetchFn = testPushFetchOverride || globalThis.fetch;
      if (typeof fetchFn !== 'function') {
        return {
          sent: 0,
          skipped: true,
          reason: 'fetch_unavailable',
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      }

      if (IS_NODE_TEST_PROCESS && !testPushFetchOverride) {
        return {
          sent: 0,
          skipped: true,
          reason: 'test_mode_external_push_disabled',
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      }

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      };
      const expoAccessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
      if (expoAccessToken) {
        headers.Authorization = `Bearer ${expoAccessToken}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetchFn(EXPO_PUSH_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            sent: 0,
            skipped: false,
            reason: `provider_http_${response.status}`,
            recipientsCount: recipientUserIds.size,
            tokensCount: messages.length,
          };
        }

        const resultJson = (await response.json().catch(() => null)) as {
          data?: Array<{
            status?: string;
            message?: string;
            details?: { error?: string };
          }>;
        } | null;

        if (!resultJson || !Array.isArray(resultJson.data)) {
          return {
            sent: 0,
            skipped: false,
            reason: 'provider_invalid_response',
            recipientsCount: recipientUserIds.size,
            tokensCount: messages.length,
          };
        }

        let sentCount = 0;
        let errorCount = 0;
        for (let i = 0; i < targetTokens.length; i++) {
          const ticket = resultJson.data[i];
          const target = targetTokens[i];
          if (ticket?.status === 'ok') {
            sentCount += 1;
            continue;
          }
          errorCount += 1;
          if (
            ticket?.status === 'error' &&
            ticket?.details?.error === 'DeviceNotRegistered' &&
            target
          ) {
            await dbDeleteMobilePushTokens({
              user_id: target.user_id,
              shop_id: target.shop_id,
              expo_push_token: target.expo_push_token,
            }).catch(() => {});
          }
        }

        if (sentCount > 0) {
          rememberNotificationKey(reqKey);
        }

        return {
          sent: sentCount,
          skipped: false,
          ...(errorCount > 0
            ? {
                reason:
                  sentCount === 0
                    ? 'provider_ticket_error'
                    : 'partial_ticket_error',
              }
            : {}),
          recipientsCount: recipientUserIds.size,
          tokensCount: messages.length,
        };
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      inFlightNotificationKeys.delete(reqKey);
    }
  } catch (err) {
    return {
      sent: 0,
      skipped: false,
      reason: err instanceof Error ? err.message : 'push_dispatch_failed',
      recipientsCount: 0,
      tokensCount: 0,
    };
  }
}
