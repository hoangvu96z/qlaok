export type MobileOrderStatus =
  | 'new'
  | 'preparing'
  | 'completed'
  | 'cancelled';

export type MobileOrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';

export type MobileOrderReasonActionType = 'refund' | 'cancel';

export type MobileOrderActionErrorCode =
  | 'REFUND_REASON_REQUIRED'
  | 'CANCEL_REASON_REQUIRED'
  | 'REASON_TOO_LONG'
  | 'PAID_ORDER_REQUIRES_REFUND_FIRST'
  | 'INVALID_ORDER_RESPONSE';

export interface MobileOrderStatusUpdateOptions {
  refundReason?: string;
  cancelledReason?: string;
  restockItems?: boolean;
}

export interface MobileOrderSnapshotForAction {
  id: string;
  status: MobileOrderStatus;
  payment_status: MobileOrderPaymentStatus;
  total_amount: number;
}

export interface BuildOrderStatusPatchParams {
  shopId: string;
  orderId: string;
  status: MobileOrderStatus;
  payment_status?: MobileOrderPaymentStatus;
  existingOrder?: MobileOrderSnapshotForAction | null;
  options?: MobileOrderStatusUpdateOptions;
}

export interface OrderStatusPatchPayload {
  shop_id: string;
  orderId: string;
  status: MobileOrderStatus;
  payment_status?: MobileOrderPaymentStatus;
  refund_reason?: string;
  cancelled_reason?: string;
  restock_items?: boolean;
  payment_idempotency_key?: string;
  expected_total?: number;
}

export const MAX_ORDER_REASON_LENGTH = 500;

export function normalizeOrderReason(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function validateOrderActionReason(
  action: MobileOrderReasonActionType,
  rawReason: unknown
):
  | { ok: true; reason: string }
  | {
      ok: false;
      code:
        | 'REFUND_REASON_REQUIRED'
        | 'CANCEL_REASON_REQUIRED'
        | 'REASON_TOO_LONG';
    } {
  const reason = normalizeOrderReason(rawReason);
  if (!reason) {
    return {
      ok: false,
      code:
        action === 'refund'
          ? 'REFUND_REASON_REQUIRED'
          : 'CANCEL_REASON_REQUIRED',
    };
  }
  if (reason.length > MAX_ORDER_REASON_LENGTH) {
    return {
      ok: false,
      code: 'REASON_TOO_LONG',
    };
  }
  return { ok: true, reason };
}

export function buildOrderStatusPatchPayload(
  params: BuildOrderStatusPatchParams
):
  | { ok: true; payload: OrderStatusPatchPayload }
  | {
      ok: false;
      code: Exclude<MobileOrderActionErrorCode, 'INVALID_ORDER_RESPONSE'>;
    } {
  const { shopId, orderId, status, payment_status, existingOrder, options } =
    params;

  if (
    status === 'cancelled' &&
    existingOrder?.payment_status === 'paid' &&
    payment_status !== 'refunded'
  ) {
    return {
      ok: false,
      code: 'PAID_ORDER_REQUIRES_REFUND_FIRST',
    };
  }

  let refundReason: string | undefined;
  if (payment_status === 'refunded') {
    const validation = validateOrderActionReason(
      'refund',
      options?.refundReason
    );
    if (!validation.ok) {
      return validation;
    }
    refundReason = validation.reason;
  }

  let cancelledReason: string | undefined;
  if (status === 'cancelled') {
    const validation = validateOrderActionReason(
      'cancel',
      options?.cancelledReason
    );
    if (!validation.ok) {
      return validation;
    }
    cancelledReason = validation.reason;
  }

  const shouldSetRestockItemsFalse =
    status === 'cancelled' &&
    (options?.restockItems === false ||
      (options?.restockItems === undefined &&
        Boolean(existingOrder && existingOrder.status !== 'new')));

  const payload: OrderStatusPatchPayload = {
    shop_id: shopId,
    orderId,
    status,
    ...(payment_status !== undefined ? { payment_status } : {}),
    ...(refundReason ? { refund_reason: refundReason } : {}),
    ...(cancelledReason ? { cancelled_reason: cancelledReason } : {}),
    ...(shouldSetRestockItemsFalse ? { restock_items: false } : {}),
    ...(payment_status === 'paid'
      ? {
          payment_idempotency_key: `${orderId}:paid`,
          ...(typeof existingOrder?.total_amount === 'number'
            ? { expected_total: existingOrder.total_amount }
            : {}),
        }
      : {}),
  };

  return { ok: true, payload };
}

export async function executeMobileOrderStatusPatch<
  TOrder extends { id?: string } = { id?: string },
>(
  params: BuildOrderStatusPatchParams & {
    sendPatch: (
      path: string,
      init: { method: 'PATCH'; body: string }
    ) => Promise<{ order?: TOrder } | null | undefined>;
  }
): Promise<
  | { ok: true; payload: OrderStatusPatchPayload; order: TOrder }
  | { ok: false; code: MobileOrderActionErrorCode }
> {
  const built = buildOrderStatusPatchPayload(params);
  if (!built.ok) {
    return built;
  }

  const response = await params.sendPatch('/api/orders', {
    method: 'PATCH',
    body: JSON.stringify(built.payload),
  });

  if (!response?.order?.id) {
    return {
      ok: false,
      code: 'INVALID_ORDER_RESPONSE',
    };
  }

  return {
    ok: true,
    payload: built.payload,
    order: response.order,
  };
}
