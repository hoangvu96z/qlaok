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
