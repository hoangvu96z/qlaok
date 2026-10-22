import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as createOrderRoute } from '../src/app/api/orders/route';
import {
  DELETE as deletePushTokensRoute,
  POST as registerPushTokenRoute,
} from '../src/app/api/push-tokens/route';
import { resetMposStoreForTests } from '../src/lib/mpos-store';
import {
  buildLocalizedNewOrderPushMessage,
  dbGetShopActivePushTokens,
  type ExpoPushMessagePayload,
  isValidExpoPushToken,
  resetPushNotificationStateForTests,
  sendNewGuestOrderPushNotifications,
  setPushFetchForTests,
} from '../src/lib/push-notifications';
import { issueSessionToken } from '../src/lib/server-auth';
import {
  dbDeleteShopMembership,
  dbUpsertShopMembership,
} from '../src/lib/shop-permissions';

const SHOP_A = 'shop-fnb-001'; // owner-demo-001
const SHOP_B = 'shop-service-002'; // owner-demo-001
const OWNER_A_ID = 'owner-demo-001';
const STAFF_VIEW_ID = 'staff-push-view-001';
const STAFF_NO_VIEW_ID = 'staff-push-noview-001';
const OUTSIDER_ID = 'outsider-push-001';

function makeAuthHeader(userId: string, email: string): Record<string, string> {
  const token = issueSessionToken({
    id: userId,
    email,
    role: 'owner',
    is_admin: false,
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

test('isValidExpoPushToken accepts valid ExpoPushToken/ExponentPushToken and rejects invalid tokens', () => {
  assert.equal(isValidExpoPushToken('ExponentPushToken[abc123_XYZ-99]'), true);
  assert.equal(isValidExpoPushToken('ExpoPushToken[token.123_abc]'), true);
  assert.equal(isValidExpoPushToken(''), false);
  assert.equal(isValidExpoPushToken('ExponentPushToken[]'), false);
  assert.equal(isValidExpoPushToken('fcm-raw-token-12345'), false);
  assert.equal(isValidExpoPushToken(null), false);
});

test('POST/DELETE /api/push-tokens enforces authentication, orders.view permission, and user scoping', async () => {
  resetPushNotificationStateForTests();
  try {

  // Setup shop memberships for test users
  await dbUpsertShopMembership({
    shop_id: SHOP_A,
    user_id: STAFF_VIEW_ID,
    email: 'staff-view@qlaok.test',
    role: 'staff',
    permissions: ['orders.view', 'orders.fulfill'],
    is_active: true,
  });
  await dbUpsertShopMembership({
    shop_id: SHOP_A,
    user_id: STAFF_NO_VIEW_ID,
    email: 'staff-noview@qlaok.test',
    role: 'staff',
    permissions: ['catalog.view'],
    is_active: true,
  });
  await dbDeleteShopMembership(SHOP_A, OUTSIDER_ID).catch(() => {});

  // 1. Unauthenticated request -> 401
  const unauthRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[unauth123]',
      }),
    })
  );
  assert.equal(unauthRes.status, 401);

  // 2. Outsider without membership -> 403
  const outsiderRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(OUTSIDER_ID, 'outsider@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[outsider123]',
      }),
    })
  );
  assert.equal(outsiderRes.status, 403);

  // 3. Active member WITHOUT orders.view -> 403
  const noViewRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(STAFF_NO_VIEW_ID, 'staff-noview@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[noview123]',
      }),
    })
  );
  assert.equal(noViewRes.status, 403);

  // 4. Invalid token format -> 400
  const badTokenRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'not-an-expo-token',
      }),
    })
  );
  assert.equal(badTokenRes.status, 400);

  // 5. Shop owner & active staff with orders.view can register
  const ownerRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[ownerDeviceA]',
        locale: 'vi',
        platform: 'ios',
      }),
    })
  );
  assert.equal(ownerRes.status, 200);

  const staffRes = await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(STAFF_VIEW_ID, 'staff-view@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[staffDeviceA]',
        locale: 'en-US',
        platform: 'android',
      }),
    })
  );
  assert.equal(staffRes.status, 200);

  const tokensAfterRegister = await dbGetShopActivePushTokens(SHOP_A);
  assert.equal(tokensAfterRegister.length, 2);

  // 6. Outsider DELETE cannot remove owner or staff tokens
  const outsiderDelRes = await deletePushTokensRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'DELETE',
      headers: makeAuthHeader(OUTSIDER_ID, 'outsider@qlaok.test'),
      body: JSON.stringify({
        expo_push_token: 'ExponentPushToken[ownerDeviceA]',
      }),
    })
  );
  assert.equal(outsiderDelRes.status, 200);
  const outsiderDelJson = await outsiderDelRes.json();
  assert.equal(outsiderDelJson.deletedCount, 0);
  assert.equal((await dbGetShopActivePushTokens(SHOP_A)).length, 2);

  // 7. Staff logout DELETE removes only that user's token
  const staffDelRes = await deletePushTokensRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'DELETE',
      headers: makeAuthHeader(STAFF_VIEW_ID, 'staff-view@qlaok.test'),
      body: JSON.stringify({
        expo_push_token: 'ExponentPushToken[staffDeviceA]',
      }),
    })
  );
  assert.equal(staffDelRes.status, 200);
  const remaining = await dbGetShopActivePushTokens(SHOP_A);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].user_id, OWNER_A_ID);
  } finally {
    await dbDeleteShopMembership(SHOP_A, STAFF_VIEW_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_A, STAFF_NO_VIEW_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_A, OUTSIDER_ID).catch(() => {});
  }
});

test('Guest QR order creation sends localized push only to target shop owner & orders.view members, deduplicates idempotency replay, and skips revoked members', async () => {
  resetMposStoreForTests();
  resetPushNotificationStateForTests();

  const sentPayloads: ExpoPushMessagePayload[][] = [];
  setPushFetchForTests(async (_url, init) => {
    const parsed = JSON.parse(String(init?.body || '[]')) as ExpoPushMessagePayload[];
    sentPayloads.push(parsed);
    return Response.json({
      data: parsed.map(() => ({ status: 'ok', id: 'receipt-1' })),
    });
  });

  try {
    // Active staff with orders.view on SHOP_A
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: STAFF_VIEW_ID,
      email: 'staff-view@qlaok.test',
      role: 'staff',
      permissions: ['orders.view', 'orders.fulfill'],
      is_active: true,
    });

    // Register owner on SHOP_A (VI) and SHOP_B (VI)
    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          expo_push_token: 'ExponentPushToken[ownerShopA]',
          locale: 'vi',
          platform: 'ios',
        }),
      })
    );
    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_B,
          expo_push_token: 'ExponentPushToken[ownerShopB]',
          locale: 'vi',
          platform: 'ios',
        }),
      })
    );

    // Register staff on SHOP_A (EN)
    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(STAFF_VIEW_ID, 'staff-view@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          expo_push_token: 'ExponentPushToken[staffShopA]',
          locale: 'en',
          platform: 'android',
        }),
      })
    );

    // Revoke staff's orders.view permission AFTER they registered their token
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: STAFF_NO_VIEW_ID,
      email: 'staff-noview@qlaok.test',
      role: 'staff',
      permissions: ['orders.view'],
      is_active: true,
    });
    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(STAFF_NO_VIEW_ID, 'staff-noview@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          expo_push_token: 'ExponentPushToken[revokedStaffShopA]',
          locale: 'vi',
          platform: 'android',
        }),
      })
    );
    // Now downgrade STAFF_NO_VIEW_ID to catalog.view only
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: STAFF_NO_VIEW_ID,
      email: 'staff-noview@qlaok.test',
      role: 'staff',
      permissions: ['catalog.view'],
      is_active: true,
    });

    const idempotencyKey = `qr-push-idemp-${Date.now()}`;
    const orderBody = {
      shop_id: SHOP_A,
      table_label: 'Bàn 01',
      source: 'qr_table',
      idempotency_key: idempotencyKey,
      items: [
        {
          item_id: 'item-fnb-1',
          name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
          quantity: 1,
          unit_price: 65000,
          extra_price: 0,
          selected_choices: [
            {
              id: 'size-m',
              label_vi: 'Tô Vừa (Tiêu chuẩn)',
              label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' },
              extra_price: 0,
            },
          ],
        },
      ],
    };

    const createRes1 = await createOrderRoute(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      })
    );
    assert.equal(createRes1.status, 201);
    const created1 = await createRes1.json();
    assert.ok(created1.order?.id);

    // Wait briefly or check immediately since POST awaits sendNewGuestOrderPushNotifications
    assert.equal(sentPayloads.length, 1);
    const batch = sentPayloads[0];
    // Should include ONLY ownerShopA (VI) and staffShopA (EN) — NOT ownerShopB and NOT revokedStaffShopA
    assert.equal(batch.length, 2);

    const ownerMsg = batch.find((m) => m.to === 'ExponentPushToken[ownerShopA]');
    const staffMsg = batch.find((m) => m.to === 'ExponentPushToken[staffShopA]');
    assert.ok(ownerMsg, 'owner of SHOP_A receives notification');
    assert.ok(staffMsg, 'active orders.view staff of SHOP_A receives notification');

    assert.match(ownerMsg.title, /Đơn QR mới • Bàn 01/);
    assert.match(staffMsg.title, /New QR order • Bàn 01/);
    assert.equal(ownerMsg.sound, 'default');
    assert.equal(ownerMsg.data.shopId, SHOP_A);
    assert.equal(ownerMsg.data.orderId, created1.order.id);
    assert.equal(ownerMsg.data.tab, 'orders');

    // Replay the exact same guest QR order with the same idempotency_key -> must NOT send a duplicate push
    const createRes2 = await createOrderRoute(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      })
    );
    assert.equal(createRes2.status, 201);
    const created2 = await createRes2.json();
    assert.equal(created2.order.id, created1.order.id);
    assert.equal(
      sentPayloads.length,
      1,
      'idempotent order replay must not send duplicate push notification'
    );

    // Counter POS order created by staff -> must NOT trigger guest QR push notification
    const counterRes = await createOrderRoute(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_label: 'Tại quầy',
          source: 'counter_pos',
          items: [
            {
              item_id: 'item-fnb-1',
              name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
              quantity: 1,
              unit_price: 65000,
              extra_price: 0,
              selected_choices: [
                {
                  id: 'size-m',
                  label_vi: 'Tô Vừa (Tiêu chuẩn)',
                  label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' },
                  extra_price: 0,
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(counterRes.status, 201);
    assert.equal(
      sentPayloads.length,
      1,
      'counter_pos orders must not trigger guest QR order push'
    );
  } finally {
    setPushFetchForTests(null);
    await dbDeleteShopMembership(SHOP_A, STAFF_VIEW_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_A, STAFF_NO_VIEW_ID).catch(() => {});
  }
});

test('Push provider HTTP error or network rejection does not turn a created guest QR order into failure', async () => {
  resetMposStoreForTests();
  resetPushNotificationStateForTests();

  await registerPushTokenRoute(
    new Request('http://localhost:3000/api/push-tokens', {
      method: 'POST',
      headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
      body: JSON.stringify({
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[ownerFailTest]',
        locale: 'vi',
        platform: 'ios',
      }),
    })
  );

  setPushFetchForTests(async () => {
    throw new Error('Expo push service unreachable');
  });

  try {
    const res = await createOrderRoute(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_label: 'Bàn 02',
          source: 'qr_table',
          items: [
            {
              item_id: 'item-fnb-1',
              name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
              quantity: 1,
              unit_price: 65000,
              extra_price: 0,
              selected_choices: [
                {
                  id: 'size-m',
                  label_vi: 'Tô Vừa (Tiêu chuẩn)',
                  label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' },
                  extra_price: 0,
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.order?.id);
  } finally {
    setPushFetchForTests(null);
    await dbDeleteShopMembership(SHOP_A, STAFF_VIEW_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_A, STAFF_NO_VIEW_ID).catch(() => {});
  }
});

test('buildLocalizedNewOrderPushMessage formats minimal VI and EN payloads without leaking sensitive tokens', () => {
  const msgVi = buildLocalizedNewOrderPushMessage({
    expoPushToken: 'ExponentPushToken[tokenVi]',
    locale: 'vi',
    shopId: SHOP_A,
    orderId: 'ord-123',
    orderCode: 'ORD-888',
    tableLabel: 'Bàn 05',
    totalAmount: 125000,
  });
  assert.equal(msgVi.title, 'Đơn QR mới • Bàn 05');
  assert.equal(msgVi.body, '#ORD-888 • 125.000đ');
  assert.equal('tracking_token' in (msgVi.data as Record<string, unknown>), false);

  const msgEn = buildLocalizedNewOrderPushMessage({
    expoPushToken: 'ExponentPushToken[tokenEn]',
    locale: 'en',
    shopId: SHOP_A,
    orderId: 'ord-123',
    orderCode: 'ORD-888',
    tableLabel: 'Table 5',
    totalAmount: 125000,
  });
  assert.equal(msgEn.title, 'New QR order • Table 5');
  assert.equal(msgEn.body, '#ORD-888 • 125.000đ');
});

test('Provider ticket handling counts only status==="ok" tickets, prunes DeviceNotRegistered tokens, and preserves retry eligibility when all tickets fail', async () => {
  resetMposStoreForTests();
  resetPushNotificationStateForTests();

  try {
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: STAFF_VIEW_ID,
      email: 'staff-view@qlaok.test',
      role: 'staff',
      permissions: ['orders.view'],
      is_active: true,
    });

    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(OWNER_A_ID, 'owner@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          expo_push_token: 'ExponentPushToken[validOwnerToken]',
          locale: 'vi',
          platform: 'ios',
        }),
      })
    );
    await registerPushTokenRoute(
      new Request('http://localhost:3000/api/push-tokens', {
        method: 'POST',
        headers: makeAuthHeader(STAFF_VIEW_ID, 'staff-view@qlaok.test'),
        body: JSON.stringify({
          shop_id: SHOP_A,
          expo_push_token: 'ExponentPushToken[deadStaffToken]',
          locale: 'en',
          platform: 'android',
        }),
      })
    );

    const sampleOrder = {
      id: `ord-ticket-test-${Date.now()}`,
      order_code: 'ORD-TKT1',
      shop_id: SHOP_A,
      table_label: 'Bàn 08',
      visitor_lang: 'vi' as const,
      status: 'new' as const,
      payment_method: 'cash' as const,
      payment_status: 'unpaid' as const,
      total_amount: 95000,
      items: [],
      source: 'qr_table' as const,
      idempotency_key: `idemp-ticket-${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 1. First attempt: all tickets return error -> sent must be 0, and retry must remain allowed
    setPushFetchForTests(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body || '[]')) as ExpoPushMessagePayload[];
      return Response.json({
        data: parsed.map(() => ({
          status: 'error',
          message: 'Provider rate limit',
          details: { error: 'MessageRateExceeded' },
        })),
      });
    });

    const allErrorResult = await sendNewGuestOrderPushNotifications({
      order: sampleOrder,
      isGuestOrder: true,
    });
    assert.equal(allErrorResult.sent, 0);
    assert.equal(allErrorResult.skipped, false);
    assert.equal(allErrorResult.reason, 'provider_ticket_error');
    assert.equal(allErrorResult.tokensCount, 2);

    // 2. Retry same order: 1 ok ticket + 1 DeviceNotRegistered error ticket -> sent must be 1 (not 2!), and dead token is pruned
    setPushFetchForTests(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body || '[]')) as ExpoPushMessagePayload[];
      return Response.json({
        data: parsed.map((msg) =>
          msg.to === 'ExponentPushToken[deadStaffToken]'
            ? {
                status: 'error',
                message: 'Device is not registered',
                details: { error: 'DeviceNotRegistered' },
              }
            : {
                status: 'ok',
                id: 'receipt-ok-1',
              }
        ),
      });
    });

    const partialResult = await sendNewGuestOrderPushNotifications({
      order: sampleOrder,
      isGuestOrder: true,
    });
    assert.equal(
      partialResult.sent,
      1,
      'must count only status==="ok" tickets as successful sends'
    );
    assert.equal(partialResult.tokensCount, 2);
    assert.equal(partialResult.reason, 'partial_ticket_error');

    const remainingTokens = await dbGetShopActivePushTokens(SHOP_A);
    assert.equal(remainingTokens.length, 1);
    assert.equal(
      remainingTokens[0].expo_push_token,
      'ExponentPushToken[validOwnerToken]',
      'DeviceNotRegistered token must be automatically pruned'
    );

    // 3. Subsequent call after a successful send (sent > 0) is deduplicated
    const afterSuccessResult = await sendNewGuestOrderPushNotifications({
      order: sampleOrder,
      isGuestOrder: true,
    });
    assert.equal(afterSuccessResult.sent, 0);
    assert.equal(afterSuccessResult.skipped, true);
    assert.equal(afterSuccessResult.reason, 'duplicate_or_replay');
  } finally {
    setPushFetchForTests(null);
    await dbDeleteShopMembership(SHOP_A, STAFF_VIEW_ID).catch(() => {});
  }
});
