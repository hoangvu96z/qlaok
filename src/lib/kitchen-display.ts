import type { AppLocale } from '@/lib/app-i18n';
import { membershipHasPermission } from '@/lib/dashboard-nav';
import type {
  ItemOptionChoice,
  OrderStatus,
  ShopMembership,
  ShopOrder,
} from '@/types/qlaok';

/**
 * Established Kitchen Display System (KDS) overdue threshold: 15 minutes.
 */
export const DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES = 15;
export const DEFAULT_KDS_OVERDUE_THRESHOLD_MS =
  DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES * 60 * 1000;

export type KitchenStatusFilter = 'all' | 'new' | 'preparing';

export interface KitchenQueueSummary {
  totalActive: number;
  newCount: number;
  preparingCount: number;
  overdueCount: number;
}

export interface KitchenFulfillPatchPayload {
  shop_id: string;
  order_id: string;
  status: 'preparing' | 'completed';
}

export interface KitchenOrdersState {
  shopId: string | null;
  orders: ShopOrder[];
  fetchError: string | null;
  sessionExpired: boolean;
  hasLoaded: boolean;
}

export interface KitchenShopScopeToken {
  readonly shopId: string | null;
}

export interface KitchenShopScopeTracker {
  getCurrentScope(): KitchenShopScopeToken;
  setActiveShop(shopId: string | null | undefined): KitchenShopScopeToken;
  dispose(): void;
  isDisposed(): boolean;
  isCurrent(
    token: KitchenShopScopeToken | null | undefined,
    expectedShopId?: string | null
  ): boolean;
  canStartForShop(
    shopId: string | null | undefined
  ): KitchenShopScopeToken | null;
}

function normalizeShopId(shopId: string | null | undefined): string | null {
  if (typeof shopId !== 'string') return null;
  const trimmed = shopId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Creates the initial KDS orders state for a shop before any fetch has succeeded.
 * `hasLoaded` starts as `false` so initial-load errors never render a false
 * "all active tickets cleared" empty state.
 */
export function createInitialKitchenOrdersState(
  shopId: string | null | undefined = null
): KitchenOrdersState {
  return {
    shopId: normalizeShopId(shopId),
    orders: [],
    fetchError: null,
    sessionExpired: false,
    hasLoaded: false,
  };
}

/**
 * Builds the scoped KDS orders endpoint URL (`GET /api/orders?shopId=...&view=kds`),
 * which filters to active (`new`, `preparing`) orders at the database level before pagination.
 */
export function buildKitchenOrdersUrl(shopId: string): string {
  const cleanShopId = (shopId ?? '').trim();
  const params = new URLSearchParams({
    shopId: cleanShopId,
    view: 'kds',
  });
  return `/api/orders?${params.toString()}`;
}

/**
 * Returns true only when an async KDS operation's captured `operationShopId`
 * still matches the currently active `currentShopId` and the view has not been disposed.
 */
export function isKitchenShopScopeCurrent(params: {
  operationShopId: string | null | undefined;
  currentShopId: string | null | undefined;
  disposed?: boolean;
}): boolean {
  if (params.disposed) return false;
  const opShop = normalizeShopId(params.operationShopId);
  const curShop = normalizeShopId(params.currentShopId);
  if (!opShop || !curShop) return false;
  return opShop === curShop;
}

/**
 * Tracks the active shop scope for async KDS operations (fetches, membership updates,
 * PATCH follow-up refreshes, and BroadcastChannel notifications) so stale closures
 * from a previous shop cannot start new requests or write into the current shop's state.
 */
export function createKitchenShopScopeTracker(
  initialShopId: string | null | undefined = null
): KitchenShopScopeTracker {
  let currentToken: KitchenShopScopeToken = {
    shopId: normalizeShopId(initialShopId),
  };
  let disposed = false;

  return {
    getCurrentScope() {
      return currentToken;
    },
    setActiveShop(shopId: string | null | undefined) {
      const normalized = normalizeShopId(shopId);
      if (currentToken.shopId !== normalized) {
        currentToken = { shopId: normalized };
      }
      return currentToken;
    },
    dispose() {
      disposed = true;
    },
    isDisposed() {
      return disposed;
    },
    isCurrent(
      token: KitchenShopScopeToken | null | undefined,
      expectedShopId?: string | null
    ) {
      if (disposed || !token || token !== currentToken) return false;
      if (!currentToken.shopId) return false;
      if (expectedShopId !== undefined) {
        const cleanExpected = normalizeShopId(expectedShopId);
        if (!cleanExpected || cleanExpected !== currentToken.shopId) {
          return false;
        }
      }
      return true;
    },
    canStartForShop(shopId: string | null | undefined) {
      const cleanTarget = normalizeShopId(shopId);
      if (
        !isKitchenShopScopeCurrent({
          operationShopId: cleanTarget,
          currentShopId: currentToken.shopId,
          disposed,
        })
      ) {
        return null;
      }
      return currentToken;
    },
  };
}

function parseTimestampMs(raw: string | number | Date | null | undefined): number {
  if (raw === null || raw === undefined) return Number.NaN;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : Number.NaN;
  }
  if (raw instanceof Date) {
    return raw.getTime();
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return Number.NaN;
    return Date.parse(trimmed);
  }
  return Number.NaN;
}

/**
 * Returns true only for active kitchen orders (`new` or `preparing`),
 * optionally scoped to a specific shop. Completed and cancelled orders are
 * excluded from the KDS while remaining preserved in order history/reports.
 */
export function isActiveKitchenOrder(
  order: Pick<ShopOrder, 'status' | 'shop_id'> | null | undefined,
  shopId?: string | null
): boolean {
  if (!order) return false;
  if (order.status !== 'new' && order.status !== 'preparing') {
    return false;
  }
  const cleanShopId = typeof shopId === 'string' ? shopId.trim() : '';
  if (cleanShopId && order.shop_id !== cleanShopId) {
    return false;
  }
  return true;
}

/**
 * Selects only active orders (`new`, `preparing`) for the shop (and optional
 * status sub-filter) and sorts them oldest-first by `created_at` ascending.
 */
export function selectAndSortKitchenOrders(
  orders: readonly ShopOrder[] | null | undefined,
  options?: {
    shopId?: string | null;
    statusFilter?: KitchenStatusFilter;
  }
): ShopOrder[] {
  if (!Array.isArray(orders) || orders.length === 0) {
    return [];
  }

  const cleanShopId =
    typeof options?.shopId === 'string' ? options.shopId.trim() : '';
  const statusFilter: KitchenStatusFilter = options?.statusFilter || 'all';
  const seenIds = new Set<string>();
  const filtered: ShopOrder[] = [];

  for (const order of orders) {
    if (!isActiveKitchenOrder(order, cleanShopId)) continue;
    if (statusFilter !== 'all' && order.status !== statusFilter) continue;
    if (order.id) {
      if (seenIds.has(order.id)) continue;
      seenIds.add(order.id);
    }
    filtered.push(order);
  }

  return filtered.sort((a, b) => {
    const aMs = parseTimestampMs(a.created_at);
    const bMs = parseTimestampMs(b.created_at);
    const aValid = !Number.isNaN(aMs);
    const bValid = !Number.isNaN(bMs);

    if (aValid && bValid && aMs !== bMs) {
      return aMs - bMs; // Oldest first
    }
    if (aValid !== bValid) {
      return aValid ? -1 : 1;
    }

    // Tie-break: 'new' before 'preparing', then order_code, then id
    if (a.status !== b.status) {
      return a.status === 'new' ? -1 : 1;
    }
    const codeCompare = String(a.order_code || '').localeCompare(
      String(b.order_code || '')
    );
    if (codeCompare !== 0) return codeCompare;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * Computes whole elapsed minutes since `createdAt` relative to `nowMs`.
 */
export function getKitchenOrderAgeMinutes(
  createdAt: string | number | Date | null | undefined,
  nowMs: number = Date.now()
): number {
  const createdMs = parseTimestampMs(createdAt);
  const currentMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Number.isNaN(createdMs)) return 0;
  const elapsedMs = Math.max(0, currentMs - createdMs);
  return Math.floor(elapsedMs / 60000);
}

/**
 * Returns true once the order age reaches or exceeds `thresholdMinutes`
 * (defaults to 15 minutes).
 */
export function isKitchenOrderOverdue(
  createdAt: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
  thresholdMinutes: number = DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES
): boolean {
  const createdMs = parseTimestampMs(createdAt);
  const currentMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Number.isNaN(createdMs)) return false;
  const safeThresholdMinutes =
    Number.isFinite(thresholdMinutes) && thresholdMinutes > 0
      ? thresholdMinutes
      : DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES;
  const elapsedMs = currentMs - createdMs;
  return elapsedMs >= safeThresholdMinutes * 60 * 1000;
}

/**
 * Formats order age since `created_at` in Vietnamese or English.
 */
export function formatKitchenOrderAge(
  createdAt: string | number | Date | null | undefined,
  locale: AppLocale = 'vi',
  nowMs: number = Date.now()
): string {
  const ageMinutes = getKitchenOrderAgeMinutes(createdAt, nowMs);
  const isEn = locale === 'en';
  if (ageMinutes < 1) {
    return isEn ? 'Just now' : 'Vừa xong';
  }
  if (ageMinutes < 60) {
    return isEn ? `${ageMinutes}m` : `${ageMinutes} phút`;
  }
  const hours = Math.floor(ageMinutes / 60);
  const mins = ageMinutes % 60;
  if (isEn) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return mins > 0 ? `${hours} giờ ${mins} phút` : `${hours} giờ`;
}

/**
 * Summarizes active KDS queue counts (`new`, `preparing`, `overdue`) for a shop.
 */
export function summarizeKitchenQueue(
  orders: readonly ShopOrder[] | null | undefined,
  options?: {
    shopId?: string | null;
    nowMs?: number;
    overdueThresholdMinutes?: number;
  }
): KitchenQueueSummary {
  const activeOrders = selectAndSortKitchenOrders(orders, {
    shopId: options?.shopId,
    statusFilter: 'all',
  });
  const nowMs = options?.nowMs ?? Date.now();
  const threshold =
    options?.overdueThresholdMinutes ?? DEFAULT_KDS_OVERDUE_THRESHOLD_MINUTES;

  let newCount = 0;
  let preparingCount = 0;
  let overdueCount = 0;

  for (const order of activeOrders) {
    if (order.status === 'new') newCount += 1;
    else if (order.status === 'preparing') preparingCount += 1;
    if (isKitchenOrderOverdue(order.created_at, nowMs, threshold)) {
      overdueCount += 1;
    }
  }

  return {
    totalActive: activeOrders.length,
    newCount,
    preparingCount,
    overdueCount,
  };
}

/**
 * Returns true only when the active shop membership is loaded, active, and
 * holds `orders.fulfill` (or is the shop `owner`).
 */
export function canPerformKitchenFulfill(
  membership:
    | Pick<ShopMembership, 'role' | 'permissions' | 'is_active'>
    | null
    | undefined
): boolean {
  return membershipHasPermission(membership, 'orders.fulfill');
}

/**
 * Returns the next KDS fulfillment status (`new -> preparing`, `preparing -> completed`),
 * or `null` if the order is not in an active KDS state.
 */
export function getNextKitchenOrderStatus(
  status: OrderStatus | string | null | undefined
): 'preparing' | 'completed' | null {
  if (status === 'new') return 'preparing';
  if (status === 'preparing') return 'completed';
  return null;
}

/**
 * Builds the minimal `/api/orders` PATCH payload for KDS fulfillment transitions.
 * Never sets `payment_status`, `payment_method`, or `payment_idempotency_key`.
 */
export function buildKitchenFulfillPatchPayload(params: {
  shopId: string;
  orderId: string;
  currentStatus: OrderStatus | string | null | undefined;
}): KitchenFulfillPatchPayload | null {
  const cleanShopId = (params.shopId ?? '').trim();
  const cleanOrderId = (params.orderId ?? '').trim();
  const nextStatus = getNextKitchenOrderStatus(params.currentStatus);
  if (!cleanShopId || !cleanOrderId || !nextStatus) {
    return null;
  }
  return {
    shop_id: cleanShopId,
    order_id: cleanOrderId,
    status: nextStatus,
  };
}

/**
 * Extracts a localized option choice label for a KDS line item.
 */
export function formatKitchenLineOptionLabel(
  choice: ItemOptionChoice | string | null | undefined,
  locale: AppLocale = 'vi'
): string {
  if (!choice) return '';
  if (typeof choice === 'string') return choice.trim();
  const label =
    (locale === 'en' ? choice.label_i18n?.en : undefined) ||
    choice.label_vi ||
    choice.label_i18n?.vi ||
    '';
  return label.trim();
}

/**
 * State reducer helper for KDS order fetches:
 * - Ignores stale fetch results when `activeShopId` is provided and does not match `result.shopId`.
 * - Marks `hasLoaded: true` only after a successful fetch (`ok: true`) for that shop.
 * - Preserves existing tickets and `hasLoaded` for the same shop when a transient fetch error occurs.
 * - Keeps `hasLoaded: false` when the initial fetch for a shop fails, preventing a false confirmed-empty state.
 * - Clears tickets from a previous shop when switching shops so cross-shop data never leaks.
 */
export function reconcileKitchenOrdersFetch(
  prevState: KitchenOrdersState,
  result: {
    shopId: string;
    activeShopId?: string | null;
    ok: boolean;
    status?: number;
    orders?: ShopOrder[];
    error?: string | null;
  }
): KitchenOrdersState {
  const cleanShopId = (result.shopId ?? '').trim();
  if (result.activeShopId !== undefined) {
    const cleanActiveShopId = (result.activeShopId ?? '').trim();
    if (!cleanShopId || cleanShopId !== cleanActiveShopId) {
      return prevState;
    }
  }

  const isSameShop = prevState.shopId === cleanShopId;
  const prevHasLoaded = isSameShop ? Boolean(prevState.hasLoaded) : false;

  if (result.ok) {
    return {
      shopId: cleanShopId,
      orders: Array.isArray(result.orders) ? result.orders : [],
      fetchError: null,
      sessionExpired: false,
      hasLoaded: true,
    };
  }

  return {
    shopId: cleanShopId,
    orders: isSameShop ? prevState.orders : [],
    fetchError: result.error || 'FETCH_ERROR',
    sessionExpired:
      result.status === 401
        ? true
        : isSameShop
          ? prevState.sessionExpired
          : false,
    hasLoaded: prevHasLoaded,
  };
}

/**
 * Returns true only after a fetch for the active shop has succeeded (`hasLoaded === true`)
 * and there are zero visible active tickets. Initial-load failures (`hasLoaded === false`)
 * return false so the UI never claims "all active kitchen tickets are cleared".
 */
export function shouldShowKitchenConfirmedEmptyState(params: {
  state: KitchenOrdersState;
  activeShopId: string | null | undefined;
  visibleTicketsCount: number;
  loading?: boolean;
}): boolean {
  if (params.loading) return false;
  const cleanActiveShopId = normalizeShopId(params.activeShopId);
  if (!cleanActiveShopId) return false;
  if (params.state.shopId !== cleanActiveShopId) return false;
  if (!params.state.hasLoaded) return false;
  if (params.state.fetchError || params.state.sessionExpired) return false;
  if (params.visibleTicketsCount > 0) return false;
  return true;
}
