export type AdminOrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface AdminOrderCancellationPayload extends Record<string, unknown> {
  action: 'update_order_status';
  orderId: string;
  status: 'cancelled';
  payment_status?: 'refunded';
  refund_reason?: string;
  cancelled_reason: string;
}

export type AdminOrderCancellationError =
  | 'ORDER_ID_REQUIRED'
  | 'CANCEL_REASON_REQUIRED'
  | 'REFUND_REASON_REQUIRED'
  | 'REASON_TOO_LONG';

export type BuildAdminOrderCancellationResult =
  | { ok: true; payload: AdminOrderCancellationPayload }
  | { ok: false; code: AdminOrderCancellationError };

function normalizeReason(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildAdminOrderCancellationPayload(params: {
  orderId: string;
  paymentStatus: AdminOrderPaymentStatus;
  cancelledReason: unknown;
  refundReason?: unknown;
}): BuildAdminOrderCancellationResult {
  const orderId = params.orderId.trim();
  if (!orderId) return { ok: false, code: 'ORDER_ID_REQUIRED' };

  const cancelledReason = normalizeReason(params.cancelledReason);
  if (!cancelledReason) {
    return { ok: false, code: 'CANCEL_REASON_REQUIRED' };
  }
  if (cancelledReason.length > 500) {
    return { ok: false, code: 'REASON_TOO_LONG' };
  }

  const payload: AdminOrderCancellationPayload = {
    action: 'update_order_status',
    orderId,
    status: 'cancelled',
    cancelled_reason: cancelledReason,
  };

  if (params.paymentStatus === 'paid') {
    const refundReason = normalizeReason(params.refundReason);
    if (!refundReason) {
      return { ok: false, code: 'REFUND_REASON_REQUIRED' };
    }
    if (refundReason.length > 500) {
      return { ok: false, code: 'REASON_TOO_LONG' };
    }
    payload.payment_status = 'refunded';
    payload.refund_reason = refundReason;
  }

  return { ok: true, payload };
}
