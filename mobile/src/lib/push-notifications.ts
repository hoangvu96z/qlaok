import type { MobileLocale } from './mobile-i18n';

export const MOBILE_ORDERS_CHANNEL_ID = 'qlaok-orders';

export interface NotificationTapRoute {
  shopId: string;
  orderId?: string;
  orderCode?: string;
  tab: 'orders';
}

export interface PushPermissionsStatus {
  status: string;
  granted?: boolean;
}

export interface PushNotificationAdapter {
  platform: string;
  getPermissionsAsync: () => Promise<PushPermissionsStatus>;
  requestPermissionsAsync: () => Promise<PushPermissionsStatus>;
  getExpoPushTokenAsync: (options: {
    projectId: string;
  }) => Promise<{ data: string }>;
  setNotificationChannelAsync?: (
    channelId: string,
    config: {
      name: string;
      importance: number;
      sound: string;
      vibrationPattern: number[];
      lightColor: string;
    }
  ) => Promise<unknown>;
}

/**
 * Resolves the EAS project ID only when explicitly configured and non-placeholder.
 * Never invents a fallback project ID.
 */
export function resolveConfiguredEasProjectId(sources: {
  envProjectId?: string | null;
  easConfigProjectId?: string | null;
  expoConfigExtraProjectId?: string | null;
}): string | null {
  const candidates = [
    sources.envProjectId,
    sources.easConfigProjectId,
    sources.expoConfigExtraProjectId,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (
      trimmed === 'your-eas-project-id' ||
      trimmed === 'replace-with-eas-project-id' ||
      trimmed === '00000000-0000-0000-0000-000000000000'
    ) {
      continue;
    }
    return trimmed;
  }
  return null;
}

/**
 * Acquires an Expo push token only when a valid EAS projectId is configured
 * and notification permission is granted on a native platform.
 */
export async function acquireMobileExpoPushToken(
  adapter: PushNotificationAdapter,
  projectId: string | null | undefined
): Promise<string | null> {
  const validProjectId = resolveConfiguredEasProjectId({
    envProjectId: projectId,
  });
  if (!validProjectId) {
    return null;
  }

  if (adapter.platform === 'web') {
    return null;
  }

  if (
    adapter.platform === 'android' &&
    typeof adapter.setNotificationChannelAsync === 'function'
  ) {
    try {
      await adapter.setNotificationChannelAsync(MOBILE_ORDERS_CHANNEL_ID, {
        name: 'Đơn hàng mới (Qlaok)',
        importance: 6, // AndroidImportance.HIGH
        sound: 'default',
        vibrationPattern: [0, 300, 150, 300],
        lightColor: '#10b981',
      });
    } catch {
      // ignore channel setup error
    }
  }

  let perm = await adapter.getPermissionsAsync();
  const isGranted = (p: PushPermissionsStatus) =>
    Boolean(p?.granted || p?.status === 'granted');

  if (!isGranted(perm)) {
    perm = await adapter.requestPermissionsAsync();
  }

  if (!isGranted(perm)) {
    return null;
  }

  const tokenRes = await adapter.getExpoPushTokenAsync({
    projectId: validProjectId,
  });
  const token = typeof tokenRes?.data === 'string' ? tokenRes.data.trim() : '';
  return token || null;
}

export async function registerShopPushTokenWithApi(
  apiCall: (path: string, init?: RequestInit) => Promise<Response>,
  params: {
    shopId: string;
    expoPushToken: string;
    locale: MobileLocale;
    platform: string;
  }
): Promise<boolean> {
  const shopId = (params.shopId || '').trim();
  const expoPushToken = (params.expoPushToken || '').trim();
  if (!shopId || !expoPushToken) return false;

  const res = await apiCall('/api/push-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shop_id: shopId,
      expo_push_token: expoPushToken,
      locale: params.locale,
      platform: params.platform,
    }),
  });
  if (res && typeof res.ok === 'boolean' && !res.ok) {
    throw new Error(`Push token registration failed (${res.status})`);
  }
  return true;
}

export async function unregisterPushTokenWithApi(
  apiCall: (path: string, init?: RequestInit) => Promise<Response>,
  params: {
    expoPushToken?: string | null;
    shopId?: string | null;
  } = {}
): Promise<boolean> {
  const body: Record<string, string> = {};
  if (params.expoPushToken && params.expoPushToken.trim()) {
    body.expo_push_token = params.expoPushToken.trim();
  }
  if (params.shopId && params.shopId.trim()) {
    body.shop_id = params.shopId.trim();
  }

  const res = await apiCall('/api/push-tokens', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res && typeof res.ok === 'boolean' && !res.ok) {
    throw new Error(`Push token unregister failed (${res.status})`);
  }
  return true;
}

export interface MobilePushRegistrationState {
  expoPushToken: string | null;
  lastRegisteredScope: string;
  registeredShopIds: Set<string>;
}

export function createMobilePushRegistrationState(): MobilePushRegistrationState {
  return {
    expoPushToken: null,
    lastRegisteredScope: '',
    registeredShopIds: new Set<string>(),
  };
}

const sharedMobilePushRegistrationState: MobilePushRegistrationState =
  createMobilePushRegistrationState();

export function getSharedMobilePushRegistrationState(): MobilePushRegistrationState {
  return sharedMobilePushRegistrationState;
}

export function resetSharedMobilePushRegistrationState(): void {
  sharedMobilePushRegistrationState.expoPushToken = null;
  sharedMobilePushRegistrationState.lastRegisteredScope = '';
  sharedMobilePushRegistrationState.registeredShopIds.clear();
}

/**
 * Synchronizes Expo push token registration for the active shop when the user
 * is logged in and has `orders.view`. Preserves retry eligibility when network
 * or API registration fails so subsequent attempts can succeed.
 */
export async function syncMobilePushRegistration(params: {
  state: MobilePushRegistrationState;
  isLoggedIn: boolean;
  userId: string;
  activeShopId?: string | null;
  canViewOrders: boolean;
  locale: MobileLocale;
  projectId: string | null | undefined;
  adapter: PushNotificationAdapter;
  apiCall: (path: string, init?: RequestInit) => Promise<Response>;
  isCancelled?: () => boolean;
}): Promise<{
  registered: boolean;
  skipped: boolean;
  token: string | null;
  scopeKey: string;
}> {
  const shopId = (params.activeShopId || '').trim();
  const userId = (params.userId || '').trim();
  if (!params.isLoggedIn || !userId || !shopId || !params.canViewOrders) {
    return {
      registered: false,
      skipped: true,
      token: params.state.expoPushToken,
      scopeKey: '',
    };
  }

  const validProjectId = resolveConfiguredEasProjectId({
    envProjectId: params.projectId,
  });
  if (!validProjectId) {
    return {
      registered: false,
      skipped: true,
      token: params.state.expoPushToken,
      scopeKey: '',
    };
  }

  let token = params.state.expoPushToken;
  if (!token) {
    token = await acquireMobileExpoPushToken(params.adapter, validProjectId);
    if (!token || params.isCancelled?.()) {
      return {
        registered: false,
        skipped: true,
        token: null,
        scopeKey: '',
      };
    }
    params.state.expoPushToken = token;
  }

  const scopeKey = `${userId}:${shopId}:${token}:${params.locale}`;
  if (params.state.lastRegisteredScope === scopeKey) {
    return {
      registered: false,
      skipped: true,
      token,
      scopeKey,
    };
  }

  // Only record lastRegisteredScope AFTER the API registration succeeds so
  // failed attempts remain retryable on next sync/foreground/retry cycle.
  await registerShopPushTokenWithApi(params.apiCall, {
    shopId,
    expoPushToken: token,
    locale: params.locale,
    platform: params.adapter.platform,
  });

  if (!params.isCancelled?.()) {
    params.state.lastRegisteredScope = scopeKey;
    params.state.registeredShopIds.add(shopId);
  }

  return {
    registered: true,
    skipped: false,
    token,
    scopeKey,
  };
}

/**
 * Unregisters the mobile device push token through the authenticated API
 * BEFORE auth credentials are cleared by `signOut`. Never blocks local sign-out
 * if the network or backend is unreachable, or if the access token is already
 * invalid/expired on automatic HTTP 401 sign-out.
 *
 * Limitation when access token is invalid:
 * `DELETE /api/push-tokens` requires a valid user token (`requireAuthenticatedUser`).
 * On automatic HTTP 401 sign-out, cleanup is still attempted first before clearing
 * local credentials, without recursive 401 handling; if the backend rejects the
 * expired token with 401, `unregistered` returns `false` and local `signOut` still
 * completes to clear the local session.
 */
export async function unregisterPushOnLogout(params: {
  state?: MobilePushRegistrationState;
  apiCall: (path: string, init?: RequestInit) => Promise<Response>;
  signOut?: () => Promise<{ error?: { message?: string } | null } | void>;
}): Promise<{
  unregistered: boolean;
  token: string | null;
  signOutError: string | null;
}> {
  const targetState = params.state ?? sharedMobilePushRegistrationState;
  const token = targetState.expoPushToken;
  targetState.lastRegisteredScope = '';
  targetState.expoPushToken = null;
  targetState.registeredShopIds.clear();

  let unregistered = false;
  try {
    await unregisterPushTokenWithApi(params.apiCall, {
      expoPushToken: token,
    });
    unregistered = true;
  } catch {
    // Do not block local logout if network/server unregister fails or token is already invalid (401)
    unregistered = false;
  }

  let signOutError: string | null = null;
  if (typeof params.signOut === 'function') {
    try {
      const res = await params.signOut();
      if (res && typeof res === 'object' && res.error?.message) {
        signOutError = res.error.message;
      }
    } catch (err) {
      signOutError =
        err instanceof Error && err.message
          ? err.message
          : 'Không thể xóa phiên đăng nhập cục bộ.';
    }
  }

  return {
    unregistered,
    token,
    signOutError,
  };
}

export interface NotificationTapShopCandidate {
  id: string;
  owner_id: string;
}

export interface NotificationTapMembershipCandidate {
  shop_id: string;
  is_active: boolean;
  permissions: string[];
}

export type NotificationTapResolution<
  TShop extends NotificationTapShopCandidate = NotificationTapShopCandidate,
> =
  | {
      ok: true;
      shop: TShop;
      tab: 'orders';
      orderId?: string;
      orderCode?: string;
    }
  | {
      ok: false;
      shop: null;
      reason: 'invalid_route' | 'shop_unavailable' | 'permission_denied';
    };

/**
 * Validates that the target shop from a notification tap exists in the user's
 * accessible shops AND that the user has active `orders.view` permission on it.
 * Never falls back to `shops[0]` or any other shop when the target shop is unavailable.
 */
export function resolveNotificationTapTargetShop<
  TShop extends NotificationTapShopCandidate,
>(params: {
  route: NotificationTapRoute | null | undefined;
  shops: readonly TShop[];
  memberships: Record<string, NotificationTapMembershipCandidate | undefined>;
  userId: string;
}): NotificationTapResolution<TShop> {
  const shopId = (params.route?.shopId || '').trim();
  if (!shopId) {
    return {
      ok: false,
      shop: null,
      reason: 'invalid_route',
    };
  }

  const targetShop = params.shops.find((s) => s.id === shopId) || null;
  if (!targetShop) {
    return {
      ok: false,
      shop: null,
      reason: 'shop_unavailable',
    };
  }

  const membership = params.memberships[targetShop.id];
  const canViewOrders = membership
    ? Boolean(
        membership.is_active &&
          Array.isArray(membership.permissions) &&
          (membership.permissions.includes('orders.view') ||
            membership.permissions.includes('order.view'))
      )
    : Boolean(params.userId && targetShop.owner_id === params.userId);

  if (!canViewOrders) {
    return {
      ok: false,
      shop: null,
      reason: 'permission_denied',
    };
  }

  return {
    ok: true,
    shop: targetShop,
    tab: 'orders',
    ...(params.route?.orderId ? { orderId: params.route.orderId } : {}),
    ...(params.route?.orderCode ? { orderCode: params.route.orderCode } : {}),
  };
}

export function extractNotificationTapRoute(
  response: unknown
): NotificationTapRoute | null {
  if (!response || typeof response !== 'object') return null;

  const notification = (response as Record<string, unknown>).notification as
    | Record<string, unknown>
    | undefined;
  const request = notification?.request as Record<string, unknown> | undefined;
  const content = request?.content as Record<string, unknown> | undefined;
  const data = (content?.data ??
    (response as Record<string, unknown>).data) as
    | Record<string, unknown>
    | undefined;

  if (!data || typeof data !== 'object') return null;

  const shopId = String(data.shopId || data.shop_id || '').trim();
  if (!shopId) return null;

  const orderId =
    typeof data.orderId === 'string' && data.orderId.trim()
      ? data.orderId.trim()
      : typeof data.order_id === 'string' && data.order_id.trim()
        ? data.order_id.trim()
        : undefined;
  const orderCode =
    typeof data.orderCode === 'string' && data.orderCode.trim()
      ? data.orderCode.trim()
      : undefined;

  return {
    shopId,
    ...(orderId ? { orderId } : {}),
    ...(orderCode ? { orderCode } : {}),
    tab: 'orders',
  };
}

export interface ForegroundNotificationBehavior {
  shouldShowAlert: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * Extracts notification data payload safely from an incoming notification or response object.
 */
export function extractNotificationData(
  notification: unknown
): Record<string, unknown> | null {
  if (!notification || typeof notification !== 'object') return null;
  const n = notification as Record<string, unknown>;
  const req = (n.request ??
    (n.notification as Record<string, unknown> | undefined)?.request) as
    | Record<string, unknown>
    | undefined;
  const content = req?.content as Record<string, unknown> | undefined;
  const data = (content?.data ?? n.data) as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return null;
  return data;
}

export const LOCAL_ORDER_CHIME_TYPE = 'local_order_chime';

export interface LocalOrderChimePayload {
  content: {
    title: string;
    body: string;
    sound: 'default';
    data: {
      type: typeof LOCAL_ORDER_CHIME_TYPE;
      orderId: string;
      orderCode: string;
      shopId: string;
    };
  };
  trigger: { channelId: string } | null;
}

/**
 * Builds the notification payload for the local foreground chime triggered by the realtime stream.
 * Adheres to Expo SDK 52 scheduleNotificationAsync contract:
 * - content: title, body, sound: 'default', and distinct data.type === 'local_order_chime'.
 * - trigger: { channelId: MOBILE_ORDERS_CHANNEL_ID } for Android channel routing (immediate trigger).
 */
export function buildLocalOrderChimeNotification(order: {
  id: string;
  order_code: string;
  table_label?: string | null;
  shop_id?: string | null;
}): LocalOrderChimePayload {
  const tableLabel = order.table_label ? ` • ${order.table_label}` : '';
  return {
    content: {
      title: '🔔 Đơn hàng mới',
      body: `Mã đơn #${order.order_code}${tableLabel}`,
      sound: 'default',
      data: {
        type: LOCAL_ORDER_CHIME_TYPE,
        orderId: order.id,
        orderCode: order.order_code,
        shopId: order.shop_id || '',
      },
    },
    trigger: { channelId: MOBILE_ORDERS_CHANNEL_ID },
  };
}

export interface LocalNotificationSchedulerAdapter {
  scheduleNotificationAsync: (
    request: LocalOrderChimePayload
  ) => Promise<string | unknown>;
}

export const ORDER_NOTIFICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const ORDER_NOTIFICATION_REGISTRY_MAX_SIZE = 1000;

const orderNotificationRegistry = new Map<string, number>();

/**
 * Prunes expired entries and enforces max size on the order notification registry.
 */
function pruneOrderNotificationRegistry(
  now: number = Date.now(),
  ttlMs: number = ORDER_NOTIFICATION_TTL_MS,
  maxSize: number = ORDER_NOTIFICATION_REGISTRY_MAX_SIZE
): void {
  for (const [id, timestamp] of orderNotificationRegistry.entries()) {
    if (now - timestamp > ttlMs) {
      orderNotificationRegistry.delete(id);
    }
  }
  while (orderNotificationRegistry.size >= maxSize) {
    const oldestKey = orderNotificationRegistry.keys().next().value;
    if (oldestKey !== undefined) {
      orderNotificationRegistry.delete(oldestKey);
    } else {
      break;
    }
  }
}

/**
 * Records that a notification (local chime or remote push) has been initiated/presented
 * for the given orderId.
 */
export function recordOrderNotification(
  orderId: string,
  options?: { now?: number; ttlMs?: number; maxSize?: number }
): boolean {
  const trimmed = typeof orderId === 'string' ? orderId.trim() : '';
  if (!trimmed) return false;

  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? ORDER_NOTIFICATION_TTL_MS;
  const maxSize = options?.maxSize ?? ORDER_NOTIFICATION_REGISTRY_MAX_SIZE;

  pruneOrderNotificationRegistry(now, ttlMs, maxSize);
  orderNotificationRegistry.set(trimmed, now);
  return true;
}

/**
 * Checks if an order notification has already been recorded and has not expired.
 */
export function isOrderNotificationRecorded(
  orderId: string,
  options?: { now?: number; ttlMs?: number }
): boolean {
  const trimmed = typeof orderId === 'string' ? orderId.trim() : '';
  if (!trimmed) return false;

  const recordedAt = orderNotificationRegistry.get(trimmed);
  if (recordedAt === undefined) return false;

  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? ORDER_NOTIFICATION_TTL_MS;

  if (now - recordedAt > ttlMs) {
    orderNotificationRegistry.delete(trimmed);
    return false;
  }

  return true;
}

/**
 * Releases the recorded notification for an order (e.g. if local chime scheduling fails).
 */
export function releaseOrderNotification(orderId: string): void {
  const trimmed = typeof orderId === 'string' ? orderId.trim() : '';
  if (!trimmed) return;
  orderNotificationRegistry.delete(trimmed);
}

/**
 * Resets the shared in-memory order notification registry (for test isolation).
 */
export function resetOrderNotificationRegistry(): void {
  orderNotificationRegistry.clear();
}

/**
 * Returns current size of order notification registry (for diagnostics and tests).
 */
export function getOrderNotificationRegistrySize(): number {
  return orderNotificationRegistry.size;
}

/**
 * Schedules the local order chime notification using the provided scheduler adapter.
 * Catches errors safely for environments where notification scheduling may fail (e.g. web/simulator).
 * Marks the local chime in the registry before scheduling to close races with remote pushes,
 * and releases the claim if native scheduling fails.
 */
export async function scheduleLocalOrderChime(
  order: {
    id: string;
    order_code: string;
    table_label?: string | null;
    shop_id?: string | null;
  },
  scheduler: LocalNotificationSchedulerAdapter
): Promise<boolean> {
  if (!scheduler || typeof scheduler.scheduleNotificationAsync !== 'function') {
    return false;
  }
  const orderId = typeof order.id === 'string' ? order.id.trim() : '';
  if (orderId) {
    recordOrderNotification(orderId);
  }
  try {
    const payload = buildLocalOrderChimeNotification(order);
    await scheduler.scheduleNotificationAsync(payload);
    return true;
  } catch {
    if (orderId) {
      releaseOrderNotification(orderId);
    }
    return false;
  }
}

/**
 * Checks if an incoming notification payload is a local order chime ('local_order_chime').
 */
export function isLocalOrderChimeNotification(notification: unknown): boolean {
  const data = extractNotificationData(notification);
  return data?.type === LOCAL_ORDER_CHIME_TYPE;
}

/**
 * Checks if an incoming notification is for a genuinely new customer order (type === 'new_qr_order').
 */
export function isNewOrderNotification(notification: unknown): boolean {
  const data = extractNotificationData(notification);
  return data?.type === 'new_qr_order';
}

/**
 * Resolves the foreground presentation behavior for an incoming notification:
 * - Local order chime ('local_order_chime'): plays native sound without OS banner
 *   (shouldShowAlert: false, shouldPlaySound: true), because in-app LiveOrderAlert
 *   banner and vibration are already handled by useShopRealtimeOrders.
 * - Remote new order push ('new_qr_order'):
 *   - If orderId is missing: preserves normal foreground notification behavior
 *     (shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false).
 *   - If order was already notified (via local chime or previous remote push):
 *     suppresses both sound and OS banner (shouldShowAlert: false, shouldPlaySound: false).
 *   - If order was NOT yet notified (e.g. realtime disconnected, delayed, or unavailable):
 *     shows normal foreground banner and sound as fallback, and records the order so
 *     later duplicates or local chime are suppressed.
 * - Non-order notifications (e.g. table service requests): preserves the pre-existing
 *   non-order foreground behavior exactly (shows OS alert banner and plays sound:
 *   shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false).
 */
export function resolveForegroundNotificationBehavior(
  notification: unknown,
  options?: { now?: number; ttlMs?: number }
): ForegroundNotificationBehavior {
  if (isLocalOrderChimeNotification(notification)) {
    const data = extractNotificationData(notification);
    const rawOrderId = data?.orderId ?? data?.order_id;
    const orderId = typeof rawOrderId === 'string' ? rawOrderId.trim() : '';
    if (orderId) {
      recordOrderNotification(orderId, options);
    }
    return {
      shouldShowAlert: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  }

  if (isNewOrderNotification(notification)) {
    const data = extractNotificationData(notification);
    const rawOrderId = data?.orderId ?? data?.order_id;
    const orderId = typeof rawOrderId === 'string' ? rawOrderId.trim() : '';

    if (!orderId) {
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    }

    if (isOrderNotificationRecorded(orderId, options)) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    recordOrderNotification(orderId, options);
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  }

  return {
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  };
}
