import type { MobileShopOrder } from './supabase.ts';
import {
  buildLocalOrderChimeNotification,
  isOrderNotificationRecorded,
  recordOrderNotification,
  releaseOrderNotification,
  type LocalOrderChimePayload,
} from './push-notifications.ts';

export interface DetectBrandNewOrderResult {
  brandNewOrder: MobileShopOrder | null;
  nextKnownNewOrderIds: Set<string>;
}

/**
 * Pure deduplication logic for detecting brand-new orders in realtime stream.
 * - Initial load (isFirstLoad = true): seeds known IDs and returns null brandNewOrder (no alert/sound).
 * - Subsequent fetches/reconnects: returns brandNewOrder only for previously unseen orders with status === 'new'.
 * - Existing orders and status updates: returns null brandNewOrder.
 */
export function detectBrandNewOrder(params: {
  nextOrders: readonly MobileShopOrder[];
  knownNewOrderIds: ReadonlySet<string>;
  isFirstLoad: boolean;
}): DetectBrandNewOrderResult {
  const newList = params.nextOrders.filter((o) => o.status === 'new');
  let brandNewOrder: MobileShopOrder | null = null;

  if (!params.isFirstLoad) {
    const found = newList.find((o) => !params.knownNewOrderIds.has(o.id));
    if (found) {
      brandNewOrder = found;
    }
  }

  return {
    brandNewOrder,
    nextKnownNewOrderIds: new Set(newList.map((o) => o.id)),
  };
}

export interface HandleBrandNewOrderNotificationsParams {
  nextOrders: readonly MobileShopOrder[];
  knownNewOrderIds: ReadonlySet<string>;
  isFirstLoad: boolean;
  onAlert?: (alert: {
    orderCode: string;
    tableLabel: string;
    totalAmount: number;
  }) => void;
  onVibrate?: () => void;
  scheduleNotificationAsync?: (
    request: LocalOrderChimePayload
  ) => Promise<unknown> | unknown;
  onAdvanceKnownOrderIds?: (nextKnownNewOrderIds: Set<string>) => void;
  isOrderNotified?: (orderId: string) => boolean;
  recordOrderNotified?: (orderId: string) => void;
  releaseOrderNotified?: (orderId: string) => void;
}

export interface HandleBrandNewOrderNotificationsResult {
  brandNewOrder: MobileShopOrder | null;
  nextKnownNewOrderIds: Set<string>;
  scheduledNotification: LocalOrderChimePayload | null;
}

/**
 * Orchestrates deduplicated order detection, in-app alert, vibration, and local notification chime.
 * Guarantees exactly one notification presentation is scheduled only for genuinely brand-new orders.
 * When an order was already notified via remote push fallback, keeps in-app alert and vibration but skips local chime.
 * Marks the local chime in the registry before scheduling to close races with remote pushes;
 * if native scheduling fails synchronously or asynchronously, releases the local claim so remote push can act as fallback.
 * Synchronously advances known-order state before invoking scheduling so concurrent refreshes cannot duplicate.
 * Scheduling errors or skips must be caught without breaking dedupe or LiveOrderAlert.
 */
export function handleBrandNewOrderNotifications(
  params: HandleBrandNewOrderNotificationsParams
): HandleBrandNewOrderNotificationsResult {
  const { brandNewOrder, nextKnownNewOrderIds } = detectBrandNewOrder({
    nextOrders: params.nextOrders,
    knownNewOrderIds: params.knownNewOrderIds,
    isFirstLoad: params.isFirstLoad,
  });

  // Synchronously advance known-order state before scheduling
  // so concurrent refreshes cannot duplicate
  params.onAdvanceKnownOrderIds?.(nextKnownNewOrderIds);

  let scheduledNotification: LocalOrderChimePayload | null = null;

  if (brandNewOrder) {
    try {
      params.onVibrate?.();
    } catch {
      // ignore vibration errors on web/simulator
    }

    try {
      params.onAlert?.({
        orderCode: brandNewOrder.order_code,
        tableLabel: brandNewOrder.table_label,
        totalAmount: brandNewOrder.total_amount,
      });
    } catch {
      // ignore alert callback errors
    }

    const checkNotified = params.isOrderNotified ?? isOrderNotificationRecorded;
    const markNotified = params.recordOrderNotified ?? recordOrderNotification;
    const releaseNotified =
      params.releaseOrderNotified ?? releaseOrderNotification;

    const orderAlreadyNotified = checkNotified(brandNewOrder.id);

    // If order was already notified (e.g. remote push fallback arrived first),
    // keep in-app alert + vibration but skip scheduling duplicate local chime.
    if (!orderAlreadyNotified && params.scheduleNotificationAsync) {
      const payload = buildLocalOrderChimeNotification(brandNewOrder);
      // Mark local chime before scheduling to close race with remote push
      markNotified(brandNewOrder.id);
      try {
        const scheduleResult = params.scheduleNotificationAsync(payload);
        if (
          scheduleResult &&
          typeof (scheduleResult as Promise<unknown>).catch === 'function'
        ) {
          (scheduleResult as Promise<unknown>).catch(() => {
            // Asynchronous scheduling failure: release the local claim
            // so a later remote push can still act as fallback
            releaseNotified(brandNewOrder.id);
          });
        }
        scheduledNotification = payload;
      } catch {
        // Synchronous scheduling failure: release the local claim
        // so a later remote push can still act as fallback
        releaseNotified(brandNewOrder.id);
      }
    }
  }

  return {
    brandNewOrder,
    nextKnownNewOrderIds,
    scheduledNotification,
  };
}
