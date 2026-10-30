import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildAdminOrderCancellationPayload } from '../src/lib/admin-order-actions';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(relativePath), 'utf8');

test('admin cancellation payload keeps unpaid cancellation separate from payment', () => {
  const result = buildAdminOrderCancellationPayload({
    orderId: ' order-1 ',
    paymentStatus: 'unpaid',
    cancelledReason: '  Khách đổi ý  ',
  });

  assert.deepEqual(result, {
    ok: true,
    payload: {
      action: 'update_order_status',
      orderId: 'order-1',
      status: 'cancelled',
      cancelled_reason: 'Khách đổi ý',
    },
  });
});

test('admin cancellation of a paid order requires both reasons and explicitly records refund', () => {
  const missingRefundReason = buildAdminOrderCancellationPayload({
    orderId: 'order-2',
    paymentStatus: 'paid',
    cancelledReason: 'Khách yêu cầu hủy',
  });
  assert.deepEqual(missingRefundReason, {
    ok: false,
    code: 'REFUND_REASON_REQUIRED',
  });

  const missingCancelReason = buildAdminOrderCancellationPayload({
    orderId: 'order-2',
    paymentStatus: 'paid',
    refundReason: 'Đã hoàn qua ngân hàng',
    cancelledReason: '  ',
  });
  assert.deepEqual(missingCancelReason, {
    ok: false,
    code: 'CANCEL_REASON_REQUIRED',
  });

  const result = buildAdminOrderCancellationPayload({
    orderId: 'order-2',
    paymentStatus: 'paid',
    refundReason: '  Đã hoàn qua ngân hàng  ',
    cancelledReason: '  Khách yêu cầu hủy  ',
  });
  assert.deepEqual(result, {
    ok: true,
    payload: {
      action: 'update_order_status',
      orderId: 'order-2',
      status: 'cancelled',
      payment_status: 'refunded',
      refund_reason: 'Đã hoàn qua ngân hàng',
      cancelled_reason: 'Khách yêu cầu hủy',
    },
  });
});

test('admin cancellation helper enforces the server 500-character reason limit', () => {
  assert.deepEqual(
    buildAdminOrderCancellationPayload({
      orderId: 'order-3',
      paymentStatus: 'paid',
      refundReason: 'ok',
      cancelledReason: 'x'.repeat(501),
    }),
    { ok: false, code: 'REASON_TOO_LONG' }
  );
  assert.deepEqual(
    buildAdminOrderCancellationPayload({
      orderId: 'order-3',
      paymentStatus: 'paid',
      refundReason: 'x'.repeat(501),
      cancelledReason: 'ok',
    }),
    { ok: false, code: 'REASON_TOO_LONG' }
  );
});

test('admin UI exposes explicit paid refund and cancel and keeps completion status-only', () => {
  const adminPage = read('src/app/(admin)/admin/page.tsx');
  const helper = read('src/lib/admin-order-actions.ts');

  assert.match(
    adminPage,
    /order\.status !== 'cancelled' && order\.payment_status === 'paid'/
  );
  assert.match(adminPage, /buildAdminOrderCancellationPayload\(/);
  assert.match(adminPage, /cancelledReason,\s*refundReason,/);
  assert.match(helper, /payment_status = 'refunded'/);
  assert.match(helper, /refund_reason = refundReason/);
  assert.match(helper, /cancelled_reason: cancelledReason/);
  assert.match(adminPage, /window\.confirm\(/);
  assert.match(adminPage, /Qlaok, không chuyển tiền/);
  assert.match(adminPage, /does not transfer money/);
  assert.match(
    adminPage,
    /action: 'update_order_status',\s*orderId: order\.id,\s*status: 'completed',\s*\}/
  );
});
