import assert from 'node:assert/strict';
import test from 'node:test';
import { PATCH as patchOrder } from '../src/app/api/orders/route';
import {
  GET as getShops,
  PATCH as patchShop,
  POST as postShops,
} from '../src/app/api/shops/route';
import {
  GET as getSePayByShopRoute,
  POST as postSePayByShopRoute,
} from '../src/app/api/webhooks/sepay/[shopId]/route';
import {
  dbCreateOrder,
  dbGetOrderById,
  dbGetShopOrders,
  dbSetOrderCodeForTests,
  enrichItemsWithInventory,
  resetMposStoreForTests,
  setMposDbClientForTests,
} from '../src/lib/mpos-store';
import { SEED_SHOPS } from '../src/lib/seed-data';
import {
  __resetSePayStoreForTests,
  __setSePayDbClientForTests,
  dbGetShopSePayWebhookEvents,
  dbUpsertShopSePayConfig,
  decryptSePaySecret,
  encryptSePaySecret,
  hasCrossShopOrderCollisionOnSameAccount,
  listOtherCandidateShopsOnSameAccount,
  SEPAY_MAX_WEBHOOK_BODY_BYTES,
  SEPAY_SHOP_DISCOVERY_PAGE_SIZE,
  signSePayWebhookPayload,
} from '../src/lib/sepay-reconciliation';
import { issueSessionToken } from '../src/lib/server-auth';
import { dbUpsertShopMembership } from '../src/lib/shop-permissions';

const TEST_ENCRYPTION_KEY =
  'test-sepay-aes256gcm-master-encryption-key-2026-secure-998877';
const SHOP_A_ID = 'shop-fnb-001';
const SHOP_B_ID = 'shop-service-002';
const SHOP_A_SECRET = 'sepay_hmac_secret_pho_hoi_an_2026_abcd1234';
const SHOP_B_SECRET = 'sepay_hmac_secret_linh_spa_2026_xyz98765';
const SHOP_A_ACCOUNT = '0905123456';
const SHOP_B_ACCOUNT = '0905888999';

function configureSeedShopBankAccount(
  shopId: string,
  accountNumber: string,
  transferPrefix = 'QLAOK'
) {
  const shop = SEED_SHOPS.find((s) => s.id === shopId);
  if (!shop) throw new Error(`Seed shop not found: ${shopId}`);
  const prevPaymentConfig = shop.theme_config?.paymentConfig;
  shop.theme_config = {
    ...shop.theme_config,
    paymentConfig: {
      mode: 'vietqr_auto',
      bankId: 'MB',
      bankName: 'MB Bank',
      accountNumber,
      accountName: 'CHU QUAN QLAOK',
      transferPrefix,
      template: 'compact2',
    },
  };
  return () => {
    shop.theme_config = {
      ...shop.theme_config,
      paymentConfig: prevPaymentConfig,
    };
  };
}

function buildAuthCookieHeader(user: {
  sub: string;
  email: string;
  role: 'owner' | 'cashier' | 'staff' | 'admin';
  name: string;
}): string {
  const token = issueSessionToken({
    id: user.sub,
    email: user.email,
    role: user.role,
  });
  return `qlaok_session=${token}`;
}

function buildSignedWebhookRequest(params: {
  shopId: string;
  secret: string;
  payload: Record<string, unknown> | string;
  timestamp?: string;
  signatureOverride?: string | null;
}): Request {
  const rawBody =
    typeof params.payload === 'string'
      ? params.payload
      : JSON.stringify(params.payload);
  const timestamp = params.timestamp ?? '1761120000';
  const signature =
    params.signatureOverride !== undefined
      ? params.signatureOverride
      : signSePayWebhookPayload(rawBody, timestamp, params.secret);

  const headers = new Headers({
    'content-type': 'application/json',
  });
  if (timestamp !== '') {
    headers.set('X-SePay-Timestamp', timestamp);
  }
  if (signature !== null && signature !== '') {
    headers.set('X-SePay-Signature', signature);
  }

  return new Request(
    `http://localhost:3000/api/webhooks/sepay/${encodeURIComponent(params.shopId)}`,
    {
      method: 'POST',
      headers,
      body: rawBody,
    }
  );
}

test('SePay secret encryption at rest requires SEPAY_SECRET_ENCRYPTION_KEY and binds shopId AAD', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  try {
    delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await assert.rejects(
      () =>
        dbUpsertShopSePayConfig({
          shopId: SHOP_A_ID,
          secret: SHOP_A_SECRET,
          enabled: true,
        }),
      /SEPAY_ENCRYPTION_NOT_CONFIGURED/
    );

    const unconfiguredReq = buildSignedWebhookRequest({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      payload: {
        id: 50001,
        accountNumber: SHOP_A_ACCOUNT,
        content: 'QLAOK ORD-101',
        transferType: 'in',
        transferAmount: 55000,
        referenceCode: 'FT50001',
      },
    });
    const unconfiguredRes = await postSePayByShopRoute(unconfiguredReq, {
      params: Promise.resolve({ shopId: SHOP_A_ID }),
    });
    assert.equal(unconfiguredRes.status, 503);
    const unconfiguredBody = (await unconfiguredRes.json()) as {
      code?: string;
      success?: boolean;
    };
    assert.equal(unconfiguredBody.success, false);
    assert.equal(unconfiguredBody.code, 'SEPAY_ENCRYPTION_NOT_CONFIGURED');

    process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    const encrypted = encryptSePaySecret(SHOP_A_ID, SHOP_A_SECRET);
    assert.notEqual(encrypted.secret_ciphertext, SHOP_A_SECRET);
    assert.equal(decryptSePaySecret(SHOP_A_ID, encrypted), SHOP_A_SECRET);

    // Cross-shop AAD check: Shop B cannot decrypt Shop A's ciphertext
    assert.throws(
      () => decryptSePaySecret(SHOP_B_ID, encrypted),
      /SEPAY_SECRET_DECRYPT_FAILED/
    );
  } finally {
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Owner-only SePay configuration redacts secret, blocks staff/cashier, and forbids theme_config secret storage', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopMembership({
      shop_id: SHOP_A_ID,
      user_id: 'user-cashier-sepay',
      email: 'cashier@qlaok.test',
      full_name: 'Cashier',
      role: 'cashier',
      is_active: true,
    });

    const ownerCookie = buildAuthCookieHeader({
      sub: 'owner-demo-001',
      email: 'chuquan@qlaok.vn',
      role: 'owner',
      name: 'Chủ Quán',
    });
    const cashierCookie = buildAuthCookieHeader({
      sub: 'user-cashier-sepay',
      email: 'cashier@qlaok.test',
      role: 'cashier',
      name: 'Cashier',
    });
    const otherOwnerCookie = buildAuthCookieHeader({
      sub: 'user-other-owner',
      email: 'other@qlaok.test',
      role: 'owner',
      name: 'Other Owner',
    });

    // Cashier is forbidden from viewing or saving SePay config
    const cashierGetRes = await getShops(
      new Request(
        `http://localhost:3000/api/shops?action=sepay_config&shopId=${SHOP_A_ID}`,
        { headers: { cookie: cashierCookie } }
      )
    );
    assert.equal(cashierGetRes.status, 403);

    const cashierPostRes = await postShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cashierCookie,
        },
        body: JSON.stringify({
          action: 'upsert_sepay_config',
          shop_id: SHOP_A_ID,
          secret: SHOP_A_SECRET,
          enabled: true,
        }),
      })
    );
    assert.equal(cashierPostRes.status, 403);

    // Another user who does not own SHOP_A_ID is forbidden
    const otherOwnerGetRes = await getSePayByShopRoute(
      new Request(`http://localhost:3000/api/webhooks/sepay/${SHOP_A_ID}`, {
        headers: { cookie: otherOwnerCookie },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(otherOwnerGetRes.status, 403);

    // Owner saves SePay config and receives strictly redacted metadata
    const ownerSaveRes = await postShops(
      new Request('http://localhost:3000/api/shops', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          action: 'upsert_sepay_config',
          shop_id: SHOP_A_ID,
          secret: SHOP_A_SECRET,
          enabled: true,
        }),
      })
    );
    assert.equal(ownerSaveRes.status, 200);
    const saveJson = (await ownerSaveRes.json()) as {
      sepayConfig: Record<string, unknown>;
    };
    const rawSavedText = JSON.stringify(saveJson);
    assert.equal(rawSavedText.includes(SHOP_A_SECRET), false);
    assert.equal('secret' in saveJson.sepayConfig, false);
    assert.equal('secret_ciphertext' in saveJson.sepayConfig, false);
    assert.equal(saveJson.sepayConfig.hasSecret, true);
    assert.equal(saveJson.sepayConfig.enabled, true);
    assert.equal(
      saveJson.sepayConfig.callbackPath,
      `/api/webhooks/sepay/${SHOP_A_ID}`
    );

    // Attempting to store SePay secret in public theme_config via PATCH /api/shops is rejected
    const themeLeakRes = await patchShop(
      new Request('http://localhost:3000/api/shops', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          id: SHOP_A_ID,
          theme_config: {
            paymentConfig: {
              mode: 'vietqr_auto',
              bankId: 'MB',
              accountNumber: SHOP_A_ACCOUNT,
              sepaySecret: SHOP_A_SECRET,
            },
          },
        }),
      })
    );
    assert.equal(themeLeakRes.status, 400);
    const themeLeakBody = (await themeLeakRes.json()) as { error?: string };
    assert.match(String(themeLeakBody.error), /FORBIDDEN_PUBLIC_SEPAY_SECRET/);
  } finally {
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('SePay webhook enforces HMAC signature over raw body, inbound transfer, account, prefix/order_code, amount, status, and payment_method invariants', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  let restoreShopA: (() => void) | null = null;
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopSePayConfig({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      enabled: true,
      updatedBy: 'owner-demo-001',
    });

    // Create a VietQR order in 'preparing' state to also test fulfillment independence
    const vietQrOrder = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-pho',
          name_vi: 'Phở Hội An Đặc Biệt',
          quantity: 2,
          unit_price: 65000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(vietQrOrder.total_amount, 130000);
    assert.equal(vietQrOrder.payment_status, 'unpaid');
    assert.equal(vietQrOrder.status, 'new');

    // Before shop configures recipient bank account -> 422 SHOP_BANK_ACCOUNT_NOT_CONFIGURED
    const noBankAcctRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70000,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${vietQrOrder.order_code}`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70000',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(noBankAcctRes.status, 422);
    assert.equal(
      (await noBankAcctRes.json()).code,
      'SHOP_BANK_ACCOUNT_NOT_CONFIGURED'
    );

    restoreShopA = configureSeedShopBankAccount(SHOP_A_ID, SHOP_A_ACCOUNT);

    const ownerCookie = buildAuthCookieHeader({
      sub: 'owner-demo-001',
      email: 'chuquan@qlaok.vn',
      role: 'owner',
      name: 'Chủ Quán',
    });

    // Move order to 'preparing' before payment arrives
    const prepRes = await patchOrder(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          order_id: vietQrOrder.id,
          status: 'preparing',
        }),
      })
    );
    assert.equal(prepRes.status, 200);

    // 1. Tampered raw body after signing -> 401 before JSON affects anything
    const validRawBody = JSON.stringify({
      id: 70001,
      accountNumber: SHOP_A_ACCOUNT,
      content: `QLAOK ${vietQrOrder.order_code}`,
      transferType: 'in',
      transferAmount: 130000,
      referenceCode: 'FT70001',
    });
    const validSig = signSePayWebhookPayload(
      validRawBody,
      '1761120001',
      SHOP_A_SECRET
    );
    const tamperedRawBody = validRawBody.replace('130000', '130000 '); // 1 byte added
    const tamperedRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: tamperedRawBody,
        timestamp: '1761120001',
        signatureOverride: validSig,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(tamperedRes.status, 401);
    assert.equal((await dbGetOrderById(vietQrOrder.id))?.payment_status, 'unpaid');

    // 2. Outbound transfer (transferType = 'out') -> 422 OUTBOUND_TRANSFER
    const outboundRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70002,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${vietQrOrder.order_code}`,
          transferType: 'out',
          transferAmount: 130000,
          referenceCode: 'FT70002',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(outboundRes.status, 422);
    assert.equal((await outboundRes.json()).code, 'OUTBOUND_TRANSFER');
    assert.equal((await dbGetOrderById(vietQrOrder.id))?.payment_status, 'unpaid');

    // 3. Wrong recipient bank account -> 422 ACCOUNT_NUMBER_MISMATCH
    const wrongAcctRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70003,
          accountNumber: '999988887777',
          content: `QLAOK ${vietQrOrder.order_code}`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70003',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(wrongAcctRes.status, 422);
    assert.equal((await wrongAcctRes.json()).code, 'ACCOUNT_NUMBER_MISMATCH');
    assert.equal((await dbGetOrderById(vietQrOrder.id))?.payment_status, 'unpaid');

    // 4. Missing transfer prefix or unmatched order_code -> 422
    const noPrefixRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70004,
          accountNumber: SHOP_A_ACCOUNT,
          content: `${vietQrOrder.order_code} chuyen khoan`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70004',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(noPrefixRes.status, 422);
    assert.equal((await noPrefixRes.json()).code, 'ORDER_CODE_MISSING');

    const unknownOrderRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70005,
          accountNumber: SHOP_A_ACCOUNT,
          content: 'QLAOK ORD-999999',
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70005',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(unknownOrderRes.status, 422);
    assert.equal((await unknownOrderRes.json()).code, 'ORDER_NOT_FOUND');

    // 5. Ambiguous order code mention -> 409 AMBIGUOUS_ORDER_CODE
    const ambiguousRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70006,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${vietQrOrder.order_code} ORD-8888`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70006',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(ambiguousRes.status, 409);
    assert.equal((await ambiguousRes.json()).code, 'AMBIGUOUS_ORDER_CODE');

    // 6. Wrong VND amount (underpaid or overpaid) -> 422 AMOUNT_MISMATCH
    const wrongAmountRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70007,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${vietQrOrder.order_code}`,
          transferType: 'in',
          transferAmount: 129999,
          referenceCode: 'FT70007',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(wrongAmountRes.status, 422);
    assert.equal((await wrongAmountRes.json()).code, 'AMOUNT_MISMATCH');
    assert.equal((await dbGetOrderById(vietQrOrder.id))?.payment_status, 'unpaid');

    // 7. Cash order & Cancelled order rejected without marking paid
    const cashOrder = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'cash',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-cash',
          name_vi: 'Trà Đá',
          quantity: 1,
          unit_price: 20000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const cashWebhookRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70008,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${cashOrder.order_code}`,
          transferType: 'in',
          transferAmount: 20000,
          referenceCode: 'FT70008',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(cashWebhookRes.status, 422);
    assert.equal((await cashWebhookRes.json()).code, 'PAYMENT_METHOD_NOT_VIETQR');
    assert.equal((await dbGetOrderById(cashOrder.id))?.payment_status, 'unpaid');

    const cancelledOrder = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-cancel',
          name_vi: 'Nước Cam',
          quantity: 1,
          unit_price: 35000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await patchOrder(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          order_id: cancelledOrder.id,
          status: 'cancelled',
          cancelled_reason: 'Khách đổi ý',
        }),
      })
    );
    const cancelledWebhookRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70009,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${cancelledOrder.order_code}`,
          transferType: 'in',
          transferAmount: 35000,
          referenceCode: 'FT70009',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(cancelledWebhookRes.status, 409);
    assert.equal((await cancelledWebhookRes.json()).code, 'ORDER_CANCELLED');
    assert.equal((await dbGetOrderById(cancelledOrder.id))?.payment_status, 'unpaid');

    // 8. Valid inbound transfer with exact VND amount marks order paid while preserving status='preparing'
    const validRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70010,
          accountNumber: SHOP_A_ACCOUNT,
          content: `MBVCB.999888.QLAOK ${vietQrOrder.order_code}.CT tu NGUYEN VAN A`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70010',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(validRes.status, 200);
    const validJson = (await validRes.json()) as {
      success: boolean;
      reconciled: boolean;
      duplicate: boolean;
      orderId: string;
    };
    assert.equal(validJson.success, true);
    assert.equal(validJson.reconciled, true);
    assert.equal(validJson.duplicate, false);
    assert.equal(validJson.orderId, vietQrOrder.id);

    const reconciledOrder = await dbGetOrderById(vietQrOrder.id);
    assert.ok(reconciledOrder);
    assert.equal(reconciledOrder.payment_status, 'paid');
    assert.equal(reconciledOrder.status, 'preparing', 'payment must never change fulfillment status');
    assert.equal(reconciledOrder.total_amount, 130000);
    assert.equal(
      reconciledOrder.payment_idempotency_key,
      `sepay:${SHOP_A_ID}:70010`
    );
    assert.equal(reconciledOrder.paid_by, 'sepay:70010:FT70010');

    // 9. Different transaction ID attempting to pay an already-paid order is rejected (409 ORDER_ALREADY_PAID)
    const secondPaymentRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 70011,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${vietQrOrder.order_code}`,
          transferType: 'in',
          transferAmount: 130000,
          referenceCode: 'FT70011',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(secondPaymentRes.status, 409);
    assert.equal((await secondPaymentRes.json()).code, 'ORDER_ALREADY_PAID');

    // 10. Completing kitchen fulfillment later keeps payment_status='paid' and SePay metadata intact
    const completeRes = await patchOrder(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          order_id: vietQrOrder.id,
          status: 'completed',
        }),
      })
    );
    assert.equal(completeRes.status, 200);
    const completedOrder = await dbGetOrderById(vietQrOrder.id);
    assert.equal(completedOrder?.status, 'completed');
    assert.equal(completedOrder?.payment_status, 'paid');
    assert.equal(
      completedOrder?.payment_idempotency_key,
      `sepay:${SHOP_A_ID}:70010`
    );
  } finally {
    restoreShopA?.();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('SePay webhook handles idempotent replay, conflicting event reuse, concurrent duplicate deliveries, and cross-shop isolation', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const restoreShopA = configureSeedShopBankAccount(SHOP_A_ID, SHOP_A_ACCOUNT);
  const restoreShopB = configureSeedShopBankAccount(SHOP_B_ID, SHOP_B_ACCOUNT);
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopSePayConfig({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      enabled: true,
    });
    await dbUpsertShopSePayConfig({
      shopId: SHOP_B_ID,
      secret: SHOP_B_SECRET,
      enabled: true,
    });

    const shopAOrder = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-concurrent-a',
          name_vi: 'Cà Phê Muối',
          quantity: 2,
          unit_price: 45000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    const shopBOrder = await dbCreateOrder({
      shop_id: SHOP_B_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-concurrent-b',
          name_vi: 'Gói Massage Cổ Vai Gáy',
          quantity: 1,
          unit_price: 250000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    // Cross-shop isolation 1: Shop B secret rejected on Shop A endpoint
    const wrongShopSigRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_B_SECRET,
        payload: {
          id: 80001,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${shopAOrder.order_code}`,
          transferType: 'in',
          transferAmount: 90000,
          referenceCode: 'FT80001',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(wrongShopSigRes.status, 401);

    // Cross-shop isolation 2: Valid Shop A webhook referencing Shop B's order_code never marks Shop B's order paid
    const crossShopOrderRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 80002,
          accountNumber: SHOP_A_ACCOUNT,
          content: `QLAOK ${shopBOrder.order_code}`,
          transferType: 'in',
          transferAmount: 250000,
          referenceCode: 'FT80002',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(crossShopOrderRes.status, 422);
    assert.equal((await dbGetOrderById(shopBOrder.id))?.payment_status, 'unpaid');

    // Concurrent duplicate safety: 8 simultaneous identical deliveries for txId=80010
    const identicalPayload = {
      id: 80010,
      accountNumber: SHOP_A_ACCOUNT,
      content: `QLAOK ${shopAOrder.order_code}`,
      transferType: 'in',
      transferAmount: 90000,
      referenceCode: 'FT80010',
    };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        postSePayByShopRoute(
          buildSignedWebhookRequest({
            shopId: SHOP_A_ID,
            secret: SHOP_A_SECRET,
            payload: identicalPayload,
          }),
          { params: Promise.resolve({ shopId: SHOP_A_ID }) }
        )
      )
    );

    const parsedBodies = await Promise.all(
      responses.map(
        async (res) =>
          ({
            status: res.status,
            body: (await res.json()) as {
              success: boolean;
              reconciled: boolean;
              duplicate: boolean;
              code: string;
            },
          })
      )
    );

    for (const item of parsedBodies) {
      assert.equal(item.status, 200);
      assert.equal(item.body.success, true);
      assert.equal(item.body.reconciled, true);
    }

    const firstTimeCount = parsedBodies.filter((x) => !x.body.duplicate).length;
    const duplicateCount = parsedBodies.filter((x) => x.body.duplicate).length;
    assert.equal(firstTimeCount, 1, 'exactly 1 delivery performs the initial reconciliation');
    assert.equal(duplicateCount, 7, 'remaining 7 concurrent deliveries are idempotent no-ops');

    // Conflicting reuse of txId=80010 with altered payload is rejected with 409 CONFLICTING_WEBHOOK_EVENT
    const conflictRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          ...identicalPayload,
          transferAmount: 95000,
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(conflictRes.status, 409);
    const conflictBody = (await conflictRes.json()) as {
      success: boolean;
      code: string;
    };
    assert.equal(conflictBody.success, false);
    assert.equal(conflictBody.code, 'CONFLICTING_WEBHOOK_EVENT');

    const events = await dbGetShopSePayWebhookEvents(SHOP_A_ID);
    const evt80010 = events.find((e) => e.sepay_transaction_id === '80010');
    assert.ok(evt80010);
    assert.equal(evt80010.delivery_count, 8);
    assert.equal(evt80010.conflict_count, 1);
  } finally {
    restoreShopA();
    restoreShopB();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Regression 1: Cross-shop duplicate order_code on shared bank account and default prefix fails closed (409 AMBIGUOUS_ORDER_CODE) and never double-reconciles', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  // Both shops share the SAME receiving account and SAME default transferPrefix ('QLAOK')
  const restoreShopA = configureSeedShopBankAccount(
    SHOP_A_ID,
    SHOP_A_ACCOUNT,
    'QLAOK'
  );
  let restoreShopB = configureSeedShopBankAccount(
    SHOP_B_ID,
    SHOP_A_ACCOUNT,
    'QLAOK'
  );
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopSePayConfig({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      enabled: true,
    });
    await dbUpsertShopSePayConfig({
      shopId: SHOP_B_ID,
      secret: SHOP_B_SECRET,
      enabled: true,
    });

    const createdA = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-collide-a',
          name_vi: 'Phở Bò Tái',
          quantity: 1,
          unit_price: 75000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const createdB = await dbCreateOrder({
      shop_id: SHOP_B_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-collide-b',
          name_vi: 'Gội Đầu Thảo Dược',
          quantity: 1,
          unit_price: 75000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    // Force duplicate legacy/pending order_code 'ORD-123' across both shops
    dbSetOrderCodeForTests(createdA.id, 'ORD-123');
    dbSetOrderCodeForTests(createdB.id, 'ORD-123');

    const fanOutPayload = {
      id: 95001,
      accountNumber: SHOP_A_ACCOUNT,
      content: 'QLAOK ORD-123',
      transferType: 'in',
      transferAmount: 75000,
      referenceCode: 'FT95001',
    };

    // SePay fans out the same bank transaction to both shop callback URLs
    const [resA, resB] = await Promise.all([
      postSePayByShopRoute(
        buildSignedWebhookRequest({
          shopId: SHOP_A_ID,
          secret: SHOP_A_SECRET,
          payload: fanOutPayload,
        }),
        { params: Promise.resolve({ shopId: SHOP_A_ID }) }
      ),
      postSePayByShopRoute(
        buildSignedWebhookRequest({
          shopId: SHOP_B_ID,
          secret: SHOP_B_SECRET,
          payload: fanOutPayload,
        }),
        { params: Promise.resolve({ shopId: SHOP_B_ID }) }
      ),
    ]);

    assert.equal(resA.status, 409);
    assert.equal(resB.status, 409);
    const bodyA = (await resA.json()) as {
      reconciled: boolean;
      code: string;
    };
    const bodyB = (await resB.json()) as {
      reconciled: boolean;
      code: string;
    };
    assert.equal(bodyA.reconciled, false);
    assert.equal(bodyB.reconciled, false);
    assert.equal(bodyA.code, 'AMBIGUOUS_ORDER_CODE');
    assert.equal(bodyB.code, 'AMBIGUOUS_ORDER_CODE');

    // Neither order is marked paid
    assert.equal((await dbGetOrderById(createdA.id))?.payment_status, 'unpaid');
    assert.equal((await dbGetOrderById(createdB.id))?.payment_status, 'unpaid');

    // Now Shop B configures a distinct transferPrefix ('QLAOK-SPA') to disambiguate the shared account.
    // Replaying the exact same transaction ('QLAOK ORD-123') recovers and reconciles ONLY Shop A!
    restoreShopB();
    restoreShopB = configureSeedShopBankAccount(
      SHOP_B_ID,
      SHOP_A_ACCOUNT,
      'QLAOK-SPA'
    );

    const retryA = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: fanOutPayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(retryA.status, 200);
    const retryABody = (await retryA.json()) as {
      success: boolean;
      reconciled: boolean;
      duplicate: boolean;
    };
    assert.equal(retryABody.success, true);
    assert.equal(retryABody.reconciled, true);
    assert.equal(retryABody.duplicate, false);

    // Even if Shop B also receives the retry of txId=95001, it is blocked both by global tx/reference claim and prefix mismatch
    const retryB = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_B_ID,
        secret: SHOP_B_SECRET,
        payload: fanOutPayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_B_ID }) }
    );
    assert.notEqual(retryB.status, 200);
    assert.equal((await dbGetOrderById(createdA.id))?.payment_status, 'paid');
    assert.equal((await dbGetOrderById(createdB.id))?.payment_status, 'unpaid');
  } finally {
    restoreShopA();
    restoreShopB();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Regression 2: Recoverable terminal rejection allows identical SePay retry to reconcile once after missing order or account mismatch is fixed', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  let restoreShopA = configureSeedShopBankAccount(
    SHOP_A_ID,
    '000011112222', // Initially misconfigured account number
    'QLAOK'
  );
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopSePayConfig({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      enabled: true,
    });

    const racePayload = {
      id: 96001,
      accountNumber: SHOP_A_ACCOUNT,
      content: 'QLAOK ORD-7799',
      transferType: 'in',
      transferAmount: 110000,
      referenceCode: 'FT96001',
    };

    // Attempt 1: Fails with ACCOUNT_NUMBER_MISMATCH (422) because shop's bank account was misconfigured
    const attempt1Res = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: racePayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(attempt1Res.status, 422);
    assert.equal(
      (await attempt1Res.json()).code,
      'ACCOUNT_NUMBER_MISMATCH'
    );

    // Owner fixes bank account, but order ORD-7799 has not finished committing yet
    restoreShopA();
    restoreShopA = configureSeedShopBankAccount(
      SHOP_A_ID,
      SHOP_A_ACCOUNT,
      'QLAOK'
    );

    // Attempt 2 (identical payload): Re-evaluates and now fails with ORDER_NOT_FOUND (422)
    const attempt2Res = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: racePayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(attempt2Res.status, 422);
    const attempt2Body = (await attempt2Res.json()) as {
      reconciled: boolean;
      duplicate: boolean;
      code: string;
    };
    assert.equal(attempt2Body.reconciled, false);
    assert.equal(attempt2Body.duplicate, false);
    assert.equal(attempt2Body.code, 'ORDER_NOT_FOUND');

    // Now the order ORD-7799 finishes committing
    const lateOrder = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Bàn 09',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-late-order',
          name_vi: 'Combo Phở + Trà',
          quantity: 1,
          unit_price: 110000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    dbSetOrderCodeForTests(lateOrder.id, 'ORD-7799');
    assert.equal((await dbGetOrderById(lateOrder.id))?.payment_status, 'unpaid');

    // Attempt 3 (SePay retry with identical payload): Re-evaluates and reconciles!
    const attempt3Res = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: racePayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(attempt3Res.status, 200);
    const attempt3Body = (await attempt3Res.json()) as {
      success: boolean;
      reconciled: boolean;
      duplicate: boolean;
      code: string;
    };
    assert.equal(attempt3Body.success, true);
    assert.equal(attempt3Body.reconciled, true);
    assert.equal(attempt3Body.duplicate, false);
    assert.equal(attempt3Body.code, 'OK');

    const paidOrder = await dbGetOrderById(lateOrder.id);
    assert.equal(paidOrder?.payment_status, 'paid');
    const firstPaidAt = paidOrder?.paid_at;
    assert.ok(firstPaidAt);

    // Attempt 4 (Subsequent identical replay after reconciliation): Idempotent no-op (duplicate=true)
    const attempt4Res = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: racePayload,
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(attempt4Res.status, 200);
    const attempt4Body = (await attempt4Res.json()) as {
      success: boolean;
      reconciled: boolean;
      duplicate: boolean;
      code: string;
    };
    assert.equal(attempt4Body.success, true);
    assert.equal(attempt4Body.reconciled, true);
    assert.equal(attempt4Body.duplicate, true);
    assert.equal(attempt4Body.code, 'DUPLICATE_EVENT_NOOP');
    assert.equal((await dbGetOrderById(lateOrder.id))?.paid_at, firstPaidAt);

    // Attempt 5 (Conflicting payload with same txId=96001): Rejected with 409 CONFLICTING_WEBHOOK_EVENT
    const attempt5Res = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          ...racePayload,
          transferAmount: 999000,
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(attempt5Res.status, 409);
    assert.equal((await attempt5Res.json()).code, 'CONFLICTING_WEBHOOK_EVENT');

    const events = await dbGetShopSePayWebhookEvents(SHOP_A_ID);
    const evt96001 = events.find((e) => e.sepay_transaction_id === '96001');
    assert.ok(evt96001);
    assert.equal(evt96001.outcome, 'reconciled');
    assert.equal(evt96001.delivery_count, 4);
    assert.equal(evt96001.conflict_count, 1);
  } finally {
    restoreShopA();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Regression 3: Webhook endpoint enforces 64 KiB body limit on both Content-Length and chunked/streamed bodies before auth or ledger writes', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const restoreShopA = configureSeedShopBankAccount(SHOP_A_ID, SHOP_A_ACCOUNT);
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    await dbUpsertShopSePayConfig({
      shopId: SHOP_A_ID,
      secret: SHOP_A_SECRET,
      enabled: true,
    });

    // 1. Declared Content-Length exceeding 64 KiB is rejected immediately with 413 PAYLOAD_TOO_LARGE
    const declaredOverLimitReq = new Request(
      `http://localhost:3000/api/webhooks/sepay/${SHOP_A_ID}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(SEPAY_MAX_WEBHOOK_BODY_BYTES + 1024),
        },
        body: '{"id":97001}',
      }
    );
    const declaredRes = await postSePayByShopRoute(declaredOverLimitReq, {
      params: Promise.resolve({ shopId: SHOP_A_ID }),
    });
    assert.equal(declaredRes.status, 413);
    const declaredBody = (await declaredRes.json()) as {
      success: boolean;
      code: string;
    };
    assert.equal(declaredBody.success, false);
    assert.equal(declaredBody.code, 'PAYLOAD_TOO_LARGE');

    // 2. Streamed/chunked body without Content-Length (or with false small Content-Length) exceeding 64 KiB cancels early and returns 413
    let chunksPulled = 0;
    const chunkSize = 16 * 1024; // 16 KiB per chunk (5th chunk crosses 64 KiB; 20 chunks total if unbounded)
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled += 1;
        if (chunksPulled > 20) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
      },
    });

    const streamedReq = new Request(
      `http://localhost:3000/api/webhooks/sepay/${SHOP_A_ID}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // False small Content-Length header to verify stream byte counting is authoritative
          'content-length': '128',
        },
        body: oversizedStream,
        // @ts-expect-error Node fetch duplex option required for ReadableStream request bodies
        duplex: 'half',
      }
    );

    const streamedRes = await postSePayByShopRoute(streamedReq, {
      params: Promise.resolve({ shopId: SHOP_A_ID }),
    });
    assert.equal(streamedRes.status, 413);
    const streamedBody = (await streamedRes.json()) as {
      success: boolean;
      code: string;
    };
    assert.equal(streamedBody.success, false);
    assert.equal(streamedBody.code, 'PAYLOAD_TOO_LARGE');
    assert.ok(
      chunksPulled <= 6,
      `Expected stream reader to cancel as soon as 64 KiB was exceeded, but pulled ${chunksPulled} chunks`
    );

    // Verify zero ledger writes occurred
    const events = await dbGetShopSePayWebhookEvents(SHOP_A_ID);
    assert.equal(events.length, 0);
  } finally {
    restoreShopA();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Regression 4: listOtherCandidateShopsOnSameAccount in DB-authoritative mode fails closed on shops query error or unsupported pagination and detects cross-shop collision on page 2', async () => {
  const prevKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.SEPAY_SECRET_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const restoreShopA = configureSeedShopBankAccount(
    SHOP_A_ID,
    SHOP_A_ACCOUNT,
    'QLAOK'
  );
  const restoreShopB = configureSeedShopBankAccount(
    SHOP_B_ID,
    SHOP_A_ACCOUNT,
    'QLAOK'
  );
  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();

    const orderA = await dbCreateOrder({
      shop_id: SHOP_A_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-page2-a',
          name_vi: 'Phở Tái Lăn',
          quantity: 1,
          unit_price: 85000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const orderB = await dbCreateOrder({
      shop_id: SHOP_B_ID,
      table_label: 'Mang về',
      payment_method: 'vietqr',
      source: 'qr_table',
      items: [
        {
          item_id: 'item-unit-test-page2-b',
          name_vi: 'Massage Đá Nóng',
          quantity: 1,
          unit_price: 85000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    dbSetOrderCodeForTests(orderA.id, 'ORD-555');
    dbSetOrderCodeForTests(orderB.id, 'ORD-555');

    const encryptedShopAConfig = encryptSePaySecret(SHOP_A_ID, SHOP_A_SECRET);
    const savedConfigRow = {
      shop_id: SHOP_A_ID,
      enabled: true,
      ...encryptedShopAConfig,
      updated_by: 'owner-demo-001',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let shopsQueryShouldError = true;
    let rpcCalls = 0;
    let lastRpcArgs = null as Record<string, unknown> | null;

    const page1FillerShops = Array.from(
      { length: SEPAY_SHOP_DISCOVERY_PAGE_SIZE },
      (_, idx) => ({
        ...SEED_SHOPS[0],
        id: `shop-filler-${String(idx).padStart(4, '0')}`,
        theme_config: {
          paymentConfig: {
            mode: 'vietqr_auto',
            bankId: 'MB',
            accountNumber: '999900001111',
            transferPrefix: 'QLAOK',
          },
        },
      })
    );
    const shopBRecord = SEED_SHOPS.find((s) => s.id === SHOP_B_ID)!;

    const mockDbClient = {
      from(table: string) {
        if (table === 'shop_sepay_configs') {
          return {
            select() {
              return {
                eq(_col: string, val: string) {
                  return {
                    async maybeSingle() {
                      return {
                        data: val === SHOP_A_ID ? savedConfigRow : null,
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === 'orders') {
          let filterCol = '';
          let filterVal = '';
          let rangeFrom = 0;
          const queryObj = {
            select() {
              return queryObj;
            },
            eq(col: string, val: string) {
              filterCol = col;
              filterVal = val;
              return queryObj;
            },
            order() {
              return queryObj;
            },
            range(from: number) {
              rangeFrom = from;
              return queryObj;
            },
            async maybeSingle() {
              if (filterCol === 'id') {
                return {
                  data:
                    filterVal === orderA.id
                      ? { ...orderA, order_code: 'ORD-555' }
                      : filterVal === orderB.id
                        ? { ...orderB, order_code: 'ORD-555' }
                        : null,
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            then(
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown
            ) {
              const rows =
                rangeFrom > 0
                  ? []
                  : filterVal === SHOP_A_ID
                    ? [{ ...orderA, order_code: 'ORD-555' }]
                    : filterVal === SHOP_B_ID
                      ? [{ ...orderB, order_code: 'ORD-555' }]
                      : [];
              return Promise.resolve({ data: rows, error: null }).then(
                resolve,
                reject
              );
            },
          };
          return queryObj;
        }
        if (table === 'shops') {
          let rangeFrom = 0;
          let rangeTo = SEPAY_SHOP_DISCOVERY_PAGE_SIZE - 1;
          const queryObj = {
            select() {
              return queryObj;
            },
            neq() {
              return queryObj;
            },
            order() {
              return queryObj;
            },
            range(from: number, to: number) {
              rangeFrom = from;
              rangeTo = to;
              return queryObj;
            },
            then(
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown
            ) {
              if (shopsQueryShouldError) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'simulated shops table read failure' },
                }).then(resolve, reject);
              }
              const allOtherShops = [...page1FillerShops, shopBRecord];
              const slice = allOtherShops.slice(rangeFrom, rangeTo + 1);
              return Promise.resolve({ data: slice, error: null }).then(
                resolve,
                reject
              );
            },
          };
          return queryObj;
        }
        throw new Error(`Unexpected table in mockDbClient: ${table}`);
      },
      async rpc(fnName: string, args: Record<string, unknown>) {
        assert.equal(fnName, 'reconcile_sepay_order_payment_atomic');
        rpcCalls += 1;
        lastRpcArgs = args;
        return {
          data: {
            outcome: 'rejected',
            reconciled: false,
            duplicate: false,
            reason_code: args.p_precheck_reason_code || 'AMBIGUOUS_ORDER_CODE',
            order_id: null,
          },
          error: null,
        };
      },
    };

    __setSePayDbClientForTests(mockDbClient as never, { forceDbMode: true });
    setMposDbClientForTests(mockDbClient as never);

    // 1. When shops query returns an error, collision discovery fails closed and atomic RPC is never called
    await assert.rejects(
      () =>
        listOtherCandidateShopsOnSameAccount({
          currentShopId: SHOP_A_ID,
          expectedAccountNumber: SHOP_A_ACCOUNT,
        }),
      /SEPAY_SHOP_DISCOVERY_FAILED/
    );

    const errWebhookRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 98001,
          accountNumber: SHOP_A_ACCOUNT,
          content: 'QLAOK ORD-555',
          transferType: 'in',
          transferAmount: 85000,
          referenceCode: 'FT98001',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(errWebhookRes.status, 500);
    const errWebhookBody = (await errWebhookRes.json()) as {
      success: boolean;
      reconciled: boolean;
      code: string;
      error: string;
    };
    assert.equal(errWebhookBody.success, false);
    assert.equal(errWebhookBody.reconciled, false);
    assert.equal(errWebhookBody.code, 'SEPAY_INTERNAL_ERROR');
    assert.match(errWebhookBody.error, /SEPAY_SHOP_DISCOVERY_FAILED/);
    assert.equal(
      rpcCalls,
      0,
      'Atomic payment RPC must not run when cross-shop collision discovery fails'
    );
    assert.equal((await dbGetOrderById(orderA.id))?.payment_status, 'unpaid');
    assert.equal((await dbGetOrderById(orderB.id))?.payment_status, 'unpaid');

    // 2. When shops query succeeds and colliding shop is on page 2 (index 1000), pagination finds it and fails closed with 409 AMBIGUOUS_ORDER_CODE
    shopsQueryShouldError = false;
    const hasCollision = await hasCrossShopOrderCollisionOnSameAccount({
      currentShopId: SHOP_A_ID,
      expectedAccountNumber: SHOP_A_ACCOUNT,
      content: 'QLAOK ORD-555',
    });
    assert.equal(hasCollision, true);

    const page2WebhookRes = await postSePayByShopRoute(
      buildSignedWebhookRequest({
        shopId: SHOP_A_ID,
        secret: SHOP_A_SECRET,
        payload: {
          id: 98002,
          accountNumber: SHOP_A_ACCOUNT,
          content: 'QLAOK ORD-555',
          transferType: 'in',
          transferAmount: 85000,
          referenceCode: 'FT98002',
        },
      }),
      { params: Promise.resolve({ shopId: SHOP_A_ID }) }
    );
    assert.equal(page2WebhookRes.status, 409);
    const page2Body = (await page2WebhookRes.json()) as {
      success: boolean;
      reconciled: boolean;
      code: string;
    };
    assert.equal(page2Body.success, false);
    assert.equal(page2Body.reconciled, false);
    assert.equal(page2Body.code, 'AMBIGUOUS_ORDER_CODE');
    assert.equal(rpcCalls, 1);
    assert.equal(
      lastRpcArgs?.p_precheck_reason_code,
      'AMBIGUOUS_ORDER_CODE',
      'Page-2 collision must pass AMBIGUOUS_ORDER_CODE precheck reason to RPC with null target_order_id'
    );
    assert.equal(lastRpcArgs?.p_target_order_id, null);
    assert.equal((await dbGetOrderById(orderA.id))?.payment_status, 'unpaid');
    assert.equal((await dbGetOrderById(orderB.id))?.payment_status, 'unpaid');

    // 3. Full page without .range() support fails closed with SEPAY_SHOP_DISCOVERY_PAGINATION_UNSUPPORTED
    const noRangeDbClient = {
      from() {
        return {
          select() {
            return {
              neq() {
                return Promise.resolve({
                  data: page1FillerShops,
                  error: null,
                });
              },
            };
          },
        };
      },
    };
    await assert.rejects(
      () =>
        listOtherCandidateShopsOnSameAccount({
          currentShopId: SHOP_A_ID,
          expectedAccountNumber: SHOP_A_ACCOUNT,
          dbClient: noRangeDbClient as never,
        }),
      /SEPAY_SHOP_DISCOVERY_PAGINATION_UNSUPPORTED/
    );
  } finally {
    __setSePayDbClientForTests(null);
    setMposDbClientForTests(null);
    restoreShopA();
    restoreShopB();
    if (prevKey === undefined) delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    else process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevKey;
  }
});

test('Regression 5: dbCreateOrder fails closed when global order_code DB lookup errors or exhausts candidates without committing order, payment, or inventory', async () => {
  resetMposStoreForTests();

  const trackedItemId = 'item-pho-dac-biet';
  const probeItem = {
    id: trackedItemId,
    shop_id: SHOP_A_ID,
    category_id: 'cat-pho',
    name: { vi: 'Phở Hội An Đặc Biệt' },
    price: 65000,
    is_available: true,
    is_featured: true,
    sort_order: 1,
    stock_quantity: 20,
    sold_count: 5,
    option_groups: [],
  };
  const beforeEnriched = enrichItemsWithInventory([probeItem as never])[0]!;
  const initialOrders = await dbGetShopOrders(SHOP_A_ID);

  let lookupMode: 'error' | 'null_data' | 'always_collide' = 'error';
  let commitRpcCalls = 0;

  const mockOrderDbClient = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: SEED_SHOPS.find((s) => s.id === SHOP_A_ID) ?? null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'items') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: trackedItemId,
                      shop_id: SHOP_A_ID,
                      category_id: 'cat-pho',
                      name: { vi: 'Phở Hội An Đặc Biệt' },
                      price: 65000,
                      is_available: true,
                      is_featured: true,
                      sort_order: 1,
                      stock_quantity: 20,
                      sold_count: 5,
                      option_groups: [],
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'orders') {
        let filterCol = '';
        const queryObj = {
          select() {
            return queryObj;
          },
          eq(col: string) {
            filterCol = col;
            return queryObj;
          },
          order() {
            return queryObj;
          },
          range() {
            return queryObj;
          },
          then(
            resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown
          ) {
            if (filterCol === 'shop_id') {
              return Promise.resolve({ data: [], error: null }).then(
                resolve,
                reject
              );
            }
            if (lookupMode === 'error') {
              return Promise.resolve({
                data: null,
                error: { message: 'simulated order_code SELECT failure' },
              }).then(resolve, reject);
            }
            if (lookupMode === 'null_data') {
              return Promise.resolve({
                data: null,
                error: null,
              }).then(resolve, reject);
            }
            return Promise.resolve({
              data: [{ id: 'existing-order-collision' }],
              error: null,
            }).then(resolve, reject);
          },
        };
        return queryObj;
      }
      throw new Error(`Unexpected table in mockOrderDbClient: ${table}`);
    },
    async rpc() {
      commitRpcCalls += 1;
      return { data: null, error: null };
    },
  };

  setMposDbClientForTests(mockOrderDbClient as never);
  try {
    // 1. Supabase error on order_code SELECT fails closed
    await assert.rejects(
      () =>
        dbCreateOrder({
          shop_id: SHOP_A_ID,
          table_label: 'Mang về',
          payment_method: 'cash',
          payment_status: 'paid',
          isStaffAuthorized: true,
          canCollectPayment: true,
          markCompletedImmediately: true,
          source: 'counter_pos',
          items: [
            {
              item_id: trackedItemId,
              name_vi: 'Phở Hội An Đặc Biệt',
              quantity: 2,
              unit_price: 65000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      /ORDER_CODE_LOOKUP_FAILED.*simulated order_code SELECT failure/
    );
    assert.equal(commitRpcCalls, 0);

    // 2. Null data without error also fails closed
    lookupMode = 'null_data';
    await assert.rejects(
      () =>
        dbCreateOrder({
          shop_id: SHOP_A_ID,
          table_label: 'Mang về',
          payment_method: 'vietqr',
          source: 'qr_table',
          items: [
            {
              item_id: trackedItemId,
              name_vi: 'Phở Hội An Đặc Biệt',
              quantity: 1,
              unit_price: 65000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      /ORDER_CODE_LOOKUP_FAILED/
    );
    assert.equal(commitRpcCalls, 0);

    // 3. Exhausting all 30 random candidate attempts fails closed with ORDER_CODE_EXHAUSTED
    lookupMode = 'always_collide';
    await assert.rejects(
      () =>
        dbCreateOrder({
          shop_id: SHOP_A_ID,
          table_label: 'Mang về',
          payment_method: 'vietqr',
          source: 'qr_table',
          items: [
            {
              item_id: trackedItemId,
              name_vi: 'Phở Hội An Đặc Biệt',
              quantity: 1,
              unit_price: 65000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      /ORDER_CODE_EXHAUSTED/
    );
    assert.equal(commitRpcCalls, 0);
  } finally {
    setMposDbClientForTests(null);
  }

  // Verify no local order or inventory mutation leaked
  const afterOrders = await dbGetShopOrders(SHOP_A_ID);
  assert.equal(afterOrders.length, initialOrders.length);
  const afterEnriched = enrichItemsWithInventory([probeItem as never])[0]!;
  assert.equal(afterEnriched.stock_quantity, 20);
  assert.equal(afterEnriched.sold_count, 5);
  assert.equal(afterEnriched.sold_count, beforeEnriched.sold_count);
});
