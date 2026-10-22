import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../src/lib/api-client.ts';
import { translateMobile } from '../src/lib/mobile-i18n.ts';
import {
  buildOrderStatusPatchPayload,
  executeMobileOrderStatusPatch,
  MAX_ORDER_REASON_LENGTH,
  normalizeOrderReason,
  validateOrderActionReason,
} from '../src/lib/order-actions.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('validateOrderActionReason requires a non-empty reason, trims whitespace, and enforces max length', () => {
  assert.equal(normalizeOrderReason(undefined), '');
  assert.equal(normalizeOrderReason(null), '');
  assert.equal(normalizeOrderReason('   \n\t  '), '');
  assert.equal(normalizeOrderReason('  Khách đổi món  '), 'Khách đổi món');

  assert.deepEqual(validateOrderActionReason('refund', ''), {
    ok: false,
    code: 'REFUND_REASON_REQUIRED',
  });
  assert.deepEqual(validateOrderActionReason('refund', '   \t\n '), {
    ok: false,
    code: 'REFUND_REASON_REQUIRED',
  });
  assert.deepEqual(validateOrderActionReason('cancel', ''), {
    ok: false,
    code: 'CANCEL_REASON_REQUIRED',
  });
  assert.deepEqual(validateOrderActionReason('cancel', '   '), {
    ok: false,
    code: 'CANCEL_REASON_REQUIRED',
  });

  const tooLong = 'a'.repeat(MAX_ORDER_REASON_LENGTH + 1);
  assert.deepEqual(validateOrderActionReason('refund', tooLong), {
    ok: false,
    code: 'REASON_TOO_LONG',
  });
  assert.deepEqual(validateOrderActionReason('cancel', tooLong), {
    ok: false,
    code: 'REASON_TOO_LONG',
  });

  assert.deepEqual(
    validateOrderActionReason('refund', '  Món bị nguội, khách yêu cầu hoàn  '),
    {
      ok: true,
      reason: 'Món bị nguội, khách yêu cầu hoàn',
    }
  );
  assert.deepEqual(
    validateOrderActionReason('cancel', '  Guest changed mind before prep  '),
    {
      ok: true,
      reason: 'Guest changed mind before prep',
    }
  );
});

test('buildOrderStatusPatchPayload requires user-entered refund_reason and never falls back to a hard-coded string', () => {
  const paidOrder = {
    id: 'ord-paid-1',
    status: 'completed' as const,
    payment_status: 'paid' as const,
    total_amount: 125000,
  };

  assert.deepEqual(
    buildOrderStatusPatchPayload({
      shopId: 'shop-1',
      orderId: paidOrder.id,
      status: paidOrder.status,
      payment_status: 'refunded',
      existingOrder: paidOrder,
    }),
    {
      ok: false,
      code: 'REFUND_REASON_REQUIRED',
    }
  );

  assert.deepEqual(
    buildOrderStatusPatchPayload({
      shopId: 'shop-1',
      orderId: paidOrder.id,
      status: paidOrder.status,
      payment_status: 'refunded',
      existingOrder: paidOrder,
      options: { refundReason: '   ' },
    }),
    {
      ok: false,
      code: 'REFUND_REASON_REQUIRED',
    }
  );

  const validRefund = buildOrderStatusPatchPayload({
    shopId: 'shop-1',
    orderId: paidOrder.id,
    status: paidOrder.status,
    payment_status: 'refunded',
    existingOrder: paidOrder,
    options: { refundReason: '  Pha nhầm món cho bàn 03  ' },
  });

  assert.equal(validRefund.ok, true);
  if (validRefund.ok) {
    assert.deepEqual(validRefund.payload, {
      shop_id: 'shop-1',
      orderId: 'ord-paid-1',
      status: 'completed',
      payment_status: 'refunded',
      refund_reason: 'Pha nhầm món cho bàn 03',
    });
    assert.notEqual(
      validRefund.payload.refund_reason,
      'Hoàn tiền xác nhận tại quầy'
    );
  }
});

test('buildOrderStatusPatchPayload requires cancelled_reason, blocks cancelling paid orders without refund, and preserves restock_items semantics', () => {
  const paidOrder = {
    id: 'ord-paid-2',
    status: 'preparing' as const,
    payment_status: 'paid' as const,
    total_amount: 90000,
  };

  assert.deepEqual(
    buildOrderStatusPatchPayload({
      shopId: 'shop-1',
      orderId: paidOrder.id,
      status: 'cancelled',
      existingOrder: paidOrder,
      options: { cancelledReason: 'Khách muốn hủy' },
    }),
    {
      ok: false,
      code: 'PAID_ORDER_REQUIRES_REFUND_FIRST',
    }
  );

  const newUnpaidOrder = {
    id: 'ord-new-1',
    status: 'new' as const,
    payment_status: 'unpaid' as const,
    total_amount: 65000,
  };

  assert.deepEqual(
    buildOrderStatusPatchPayload({
      shopId: 'shop-1',
      orderId: newUnpaidOrder.id,
      status: 'cancelled',
      existingOrder: newUnpaidOrder,
    }),
    {
      ok: false,
      code: 'CANCEL_REASON_REQUIRED',
    }
  );

  const cancelNew = buildOrderStatusPatchPayload({
    shopId: 'shop-1',
    orderId: newUnpaidOrder.id,
    status: 'cancelled',
    existingOrder: newUnpaidOrder,
    options: { cancelledReason: '  Khách đổi ý trước khi bếp làm  ' },
  });
  assert.equal(cancelNew.ok, true);
  if (cancelNew.ok) {
    assert.deepEqual(cancelNew.payload, {
      shop_id: 'shop-1',
      orderId: 'ord-new-1',
      status: 'cancelled',
      cancelled_reason: 'Khách đổi ý trước khi bếp làm',
    });
    assert.equal('restock_items' in cancelNew.payload, false);
  }

  const preparingUnpaidOrder = {
    id: 'ord-prep-1',
    status: 'preparing' as const,
    payment_status: 'unpaid' as const,
    total_amount: 65000,
  };

  const cancelPreparing = buildOrderStatusPatchPayload({
    shopId: 'shop-1',
    orderId: preparingUnpaidOrder.id,
    status: 'cancelled',
    existingOrder: preparingUnpaidOrder,
    options: { cancelledReason: 'Khách rời quán khi đang chế biến' },
  });
  assert.equal(cancelPreparing.ok, true);
  if (cancelPreparing.ok) {
    assert.deepEqual(cancelPreparing.payload, {
      shop_id: 'shop-1',
      orderId: 'ord-prep-1',
      status: 'cancelled',
      cancelled_reason: 'Khách rời quán khi đang chế biến',
      restock_items: false,
    });
  }
});

test('buildOrderStatusPatchPayload preserves fulfillment and payment collection payloads without reason prompts', () => {
  const unpaidOrder = {
    id: 'ord-unpaid-1',
    status: 'preparing' as const,
    payment_status: 'unpaid' as const,
    total_amount: 145000,
  };

  const markServed = buildOrderStatusPatchPayload({
    shopId: 'shop-1',
    orderId: unpaidOrder.id,
    status: 'completed',
    existingOrder: unpaidOrder,
  });
  assert.equal(markServed.ok, true);
  if (markServed.ok) {
    assert.deepEqual(markServed.payload, {
      shop_id: 'shop-1',
      orderId: 'ord-unpaid-1',
      status: 'completed',
    });
    assert.equal('payment_status' in markServed.payload, false);
  }

  const markPaid = buildOrderStatusPatchPayload({
    shopId: 'shop-1',
    orderId: unpaidOrder.id,
    status: unpaidOrder.status,
    payment_status: 'paid',
    existingOrder: unpaidOrder,
  });
  assert.equal(markPaid.ok, true);
  if (markPaid.ok) {
    assert.deepEqual(markPaid.payload, {
      shop_id: 'shop-1',
      orderId: 'ord-unpaid-1',
      status: 'preparing',
      payment_status: 'paid',
      payment_idempotency_key: 'ord-unpaid-1:paid',
      expected_total: 145000,
    });
  }
});

test('executeMobileOrderStatusPatch sends authorized PATCH /api/orders with user-entered reason and propagates server validation errors', async () => {
  const calls: { url: string; method: string; auth: string; body: unknown }[] =
    [];

  const fetchApi = createApiClient(
    'http://127.0.0.1:8090',
    async () => 'jwt-owner-token',
    async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({
        url: String(input),
        method: init?.method || 'GET',
        auth: headers.get('Authorization') || '',
        body: parsedBody,
      });

      if (
        parsedBody?.payment_status === 'refunded' &&
        parsedBody?.refund_reason === 'REJECT_BY_SERVER'
      ) {
        return new Response(
          JSON.stringify({
            error: 'Vui lòng nhập lý do hoàn tiền hợp lệ.',
            code: 'REFUND_REASON_REQUIRED',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          order: {
            id: parsedBody.orderId,
            shop_id: parsedBody.shop_id,
            status: parsedBody.status,
            payment_status: parsedBody.payment_status ?? 'unpaid',
            refund_reason: parsedBody.refund_reason ?? null,
            cancelled_reason: parsedBody.cancelled_reason ?? null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  );

  const sendPatch = async (
    routePath: string,
    init: { method: 'PATCH'; body: string }
  ) => {
    const res = await fetchApi(routePath, {
      method: init.method,
      headers: { 'Content-Type': 'application/json' },
      body: init.body,
    });
    return (await res.json()) as {
      order?: {
        id: string;
        shop_id: string;
        status: string;
        payment_status: string;
        refund_reason: string | null;
        cancelled_reason: string | null;
      };
    };
  };

  // 1. Missing refund reason is blocked client-side before any network call
  const blockedRefund = await executeMobileOrderStatusPatch({
    shopId: 'shop-1',
    orderId: 'ord-1',
    status: 'completed',
    payment_status: 'refunded',
    options: { refundReason: '   ' },
    sendPatch,
  });
  assert.deepEqual(blockedRefund, {
    ok: false,
    code: 'REFUND_REASON_REQUIRED',
  });
  assert.equal(calls.length, 0);

  // 2. Valid user-entered refund reason is sent through authorized API
  const refundRes = await executeMobileOrderStatusPatch({
    shopId: 'shop-1',
    orderId: 'ord-1',
    status: 'completed',
    payment_status: 'refunded',
    options: { refundReason: '  Khách báo món bị mặn  ' },
    sendPatch,
  });
  assert.equal(refundRes.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8090/api/orders');
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].auth, 'Bearer jwt-owner-token');
  assert.deepEqual(calls[0].body, {
    shop_id: 'shop-1',
    orderId: 'ord-1',
    status: 'completed',
    payment_status: 'refunded',
    refund_reason: 'Khách báo món bị mặn',
  });
  if (refundRes.ok) {
    assert.equal(refundRes.order.refund_reason, 'Khách báo món bị mặn');
  }

  // 3. Valid user-entered cancellation reason is sent through authorized API
  const cancelRes = await executeMobileOrderStatusPatch({
    shopId: 'shop-1',
    orderId: 'ord-2',
    status: 'cancelled',
    existingOrder: {
      id: 'ord-2',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 55000,
    },
    options: { cancelledReason: '  Hết nguyên liệu đột xuất  ' },
    sendPatch,
  });
  assert.equal(cancelRes.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, {
    shop_id: 'shop-1',
    orderId: 'ord-2',
    status: 'cancelled',
    cancelled_reason: 'Hết nguyên liệu đột xuất',
    restock_items: false,
  });

  // 4. Server validation error propagates as Error with HTTP status
  await assert.rejects(
    () =>
      executeMobileOrderStatusPatch({
        shopId: 'shop-1',
        orderId: 'ord-1',
        status: 'completed',
        payment_status: 'refunded',
        options: { refundReason: 'REJECT_BY_SERVER' },
        sendPatch,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Vui lòng nhập lý do hoàn tiền hợp lệ/i);
      return true;
    }
  );
});

test('mobile App.tsx and OrdersTab.tsx use localized reason prompt and never hard-code refund_reason', () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, '../App.tsx'),
    'utf8'
  );
  const ordersTabSource = fs.readFileSync(
    path.join(__dirname, '../src/components/tabs/OrdersTab.tsx'),
    'utf8'
  );

  assert.doesNotMatch(appSource, /Hoàn tiền xác nhận tại quầy/);
  assert.match(appSource, /buildOrderStatusPatchPayload/);

  assert.match(ordersTabSource, /validateOrderActionReason/);
  assert.match(ordersTabSource, /orders\.refundReasonLabel/);
  assert.match(ordersTabSource, /orders\.refundReasonPlaceholder/);
  assert.match(ordersTabSource, /orders\.refundReasonRequired/);
  assert.match(ordersTabSource, /orders\.cancelReasonLabel/);
  assert.match(ordersTabSource, /orders\.cancelReasonPlaceholder/);
  assert.match(ordersTabSource, /orders\.cancelReasonRequired/);

  // Verify VI and EN translations for refund and cancellation reason prompts
  assert.equal(
    translateMobile('vi', 'orders.refundReasonLabel'),
    'Lý do hoàn tiền *'
  );
  assert.equal(
    translateMobile('en', 'orders.refundReasonLabel'),
    'Refund reason *'
  );
  assert.equal(
    translateMobile('vi', 'orders.cancelReasonLabel'),
    'Lý do hủy đơn *'
  );
  assert.equal(
    translateMobile('en', 'orders.cancelReasonLabel'),
    'Cancellation reason *'
  );
});
