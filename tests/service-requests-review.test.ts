import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

import {
  GET as getOrdersRoute,
} from '../src/app/api/orders/route';
import {
  GET as getServiceRequestsRoute,
  PATCH as patchServiceRequestsRoute,
  POST as postServiceRequestsRoute,
} from '../src/app/api/service-requests/route';
import {
  GET as getShopRoute,
  PATCH as patchShopsRoute,
} from '../src/app/api/shops/route';
import { setSupabaseDbClientForTests } from '../src/lib/db';
import {
  ALL_LOCALES,
  checkShopOpenStatus,
  getTableServiceRequestLabels,
  TABLE_SERVICE_REQUEST_LABELS,
} from '../src/lib/i18n-helper';
import {
  dbCreateOrder,
  dbGetOrderById,
  dbUpdateOrderStatus,
  resetMposStoreForTests,
  setMposDbClientForTests,
} from '../src/lib/mpos-store';
import {
  DEFAULT_POSTGRES_CHANNEL,
  getOrderEventsBroker,
  OrderEventsBroker,
  type PostgresListenerClientLike,
  type OrderSseEvent,
  resetOrderEventsBrokerForTests,
} from '../src/lib/order-events';
import {
  dbUpsertMobilePushToken,
  isValidServiceRequestNotificationRule,
  resetPushNotificationStateForTests,
  resolveAuthorizedServiceRequestNotificationUserIds,
  resolveServiceRequestNotificationRecipientUserIds,
  resolveShopServiceRequestNotificationRule,
  type ServiceRequestExpoPushMessagePayload,
  sendNewGuestOrderPushNotifications,
  sendServiceRequestPushNotifications,
  setPushDbClientForTests,
  setPushFetchForTests,
  setPushStoreFileForTests,
} from '../src/lib/push-notifications';
import { issueSessionToken } from '../src/lib/server-auth';
import {
  __resetLocalServiceRequestsForTests,
  __setServiceRequestsDbClientForTests,
  __setServiceRequestsLocalPathForTests,
  dbGetShopServiceRequests,
} from '../src/lib/service-requests';
import {
  dbDeleteShopMembership,
  dbUpsertShopMembership,
  setShopMembershipDbClientForTest,
} from '../src/lib/shop-permissions';
import {
  dbCreateShopTable,
  dbUpdateShopTable,
  setShopTablesDbClientForTests,
  setShopTablesFileForTests,
  signTableQr,
} from '../src/lib/shop-tables';
import {
  buildStorefrontTableQueryKey,
  canUseStorefrontTableServiceActions,
  createScopedTableQrVerification,
  resolveStorefrontMenuTableState,
} from '../src/lib/table-helpers';
import type { ShopMembership, ShopThemeConfig } from '../src/types/qlaok';

const SHOP_A = 'shop-fnb-001';
const SHOP_B = 'shop-service-002';

const OWNER_A_TOKEN = issueSessionToken({
  id: 'owner-demo-001',
  email: 'chuquan@qlaok.vn',
  role: 'owner',
});

const OWNER_B_ID = 'owner-service-999';
const OWNER_B_TOKEN = issueSessionToken({
  id: OWNER_B_ID,
  email: 'owner-b@qlaok.vn',
  role: 'owner',
});

const STAFF_A_ID = 'staff-service-req-001';
const STAFF_A_TOKEN = issueSessionToken({
  id: STAFF_A_ID,
  email: 'staff-service@qlaok.vn',
  role: 'staff',
});

const INACTIVE_STAFF_ID = 'staff-inactive-req-002';
const INACTIVE_STAFF_TOKEN = issueSessionToken({
  id: INACTIVE_STAFF_ID,
  email: 'inactive-service@qlaok.vn',
  role: 'staff',
});

describe('Table QR Service Requests ("Gọi phục vụ / Xin hóa đơn ngay từ QR bàn")', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-service-req-test-'));
    setShopTablesDbClientForTests(null, false);
    setShopTablesFileForTests(path.join(tmpDir, 'shop-tables.json'));

    __setServiceRequestsDbClientForTests(null, { forceDbMode: false });
    __setServiceRequestsLocalPathForTests(
      path.join(tmpDir, 'service-requests.json')
    );
    __resetLocalServiceRequestsForTests();

    resetMposStoreForTests();
    resetOrderEventsBrokerForTests();

    setPushDbClientForTests(null, false);
    setPushStoreFileForTests(path.join(tmpDir, 'push-tokens.json'));
    setPushFetchForTests(null);
    resetPushNotificationStateForTests();

    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: STAFF_A_ID,
      email: 'staff-service@qlaok.vn',
      role: 'staff',
      is_active: true,
    });
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: INACTIVE_STAFF_ID,
      email: 'inactive-service@qlaok.vn',
      role: 'staff',
      is_active: false,
    });
    await dbUpsertShopMembership({
      shop_id: SHOP_B,
      user_id: OWNER_B_ID,
      email: 'owner-b@qlaok.vn',
      role: 'owner',
      is_active: true,
    });
  });

  afterEach(async () => {
    resetOrderEventsBrokerForTests();
    setPushFetchForTests(null);
    setShopTablesFileForTests(null);
    await dbDeleteShopMembership(SHOP_A, STAFF_A_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_A, INACTIVE_STAFF_ID).catch(() => {});
    await dbDeleteShopMembership(SHOP_B, OWNER_B_ID).catch(() => {});
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('1. Storefront i18n & table lock gating: all 8 locales localized, actions hidden for takeaway or invalid/unverified/inactive table', async () => {
    for (const locale of ALL_LOCALES) {
      const labels = getTableServiceRequestLabels(locale);
      assert.ok(labels.callStaffBtn.trim().length > 0, `callStaffBtn for ${locale}`);
      assert.ok(labels.requestBillBtn.trim().length > 0, `requestBillBtn for ${locale}`);
      assert.ok(
        labels.callStaffSentToast('Bàn 01').includes('Bàn 01'),
        `callStaffSentToast includes table label for ${locale}`
      );
      assert.ok(
        labels.requestBillSentToast('Bàn 01').includes('Bàn 01'),
        `requestBillSentToast includes table label for ${locale}`
      );
      assert.equal(labels, TABLE_SERVICE_REQUEST_LABELS[locale]);
    }

    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');
    const activeTable = {
      id: 'tbl-fnb-01',
      shop_id: SHOP_A,
      table_code: 'T01',
      name: 'Bàn 01',
      section: 'Tầng 1',
      capacity: 4,
      sort_order: 1,
      is_active: true,
      is_archived: false,
    };

    // Valid verified table QR locks table
    const verifiedState = resolveStorefrontMenuTableState({
      shopSlug: 'pho-hoi-an',
      shopId: SHOP_A,
      tables: [activeTable],
      qrTableIdParam: 'tbl-fnb-01',
      qrTableSigParam: validSig,
      qrTableParam: null,
      verification: createScopedTableQrVerification({
        shopSlug: 'pho-hoi-an',
        shopId: SHOP_A,
        tableId: 'tbl-fnb-01',
        sig: validSig,
        tableQrVerified: true,
        activeSlug: 'pho-hoi-an',
        activeTableId: 'tbl-fnb-01',
        activeSig: validSig,
      }),
      userTableChoice: null,
      locale: 'vi',
    });
    assert.equal(verifiedState.tableQrVerified, true);
    assert.equal(verifiedState.lockedTable?.id, 'tbl-fnb-01');
    assert.equal(verifiedState.isTakeawaySelected, false);
    assert.equal(verifiedState.error, null);
    assert.equal(
      canUseStorefrontTableServiceActions({
        lockedTable: verifiedState.lockedTable,
        tableQrVerified: verifiedState.tableQrVerified,
        isTakeawaySelected: verifiedState.isTakeawaySelected,
        error: verifiedState.error,
        qrTableSigParam: validSig,
      }),
      true
    );

    // Even after posted opening hours (isShopClosed === true), a customer already seated at a verified managed table can still call staff or request a bill
    const closedScheduleStatus = checkShopOpenStatus(
      {
        mon: { open: '08:00', close: '09:00', closed: true },
        tue: { open: '08:00', close: '09:00', closed: true },
        wed: { open: '08:00', close: '09:00', closed: true },
        thu: { open: '08:00', close: '09:00', closed: true },
        fri: { open: '08:00', close: '09:00', closed: true },
        sat: { open: '08:00', close: '09:00', closed: true },
        sun: { open: '08:00', close: '09:00', closed: true },
      },
      { now: new Date('2026-10-22T16:30:00.000Z') }
    );
    assert.equal(closedScheduleStatus.isOpen, false);
    assert.equal(
      canUseStorefrontTableServiceActions({
        lockedTable: verifiedState.lockedTable,
        tableQrVerified: verifiedState.tableQrVerified,
        isTakeawaySelected: verifiedState.isTakeawaySelected,
        error: verifiedState.error,
        qrTableSigParam: validSig,
      }),
      true,
      'seated guest at a verified active table can call staff/request bill even after posted opening hours'
    );

    // Unverified / tampered QR never locks table
    const unverifiedState = resolveStorefrontMenuTableState({
      shopSlug: 'pho-hoi-an',
      shopId: SHOP_A,
      tables: [activeTable],
      qrTableIdParam: 'tbl-fnb-01',
      qrTableSigParam: 'forged-sig',
      qrTableParam: null,
      verification: createScopedTableQrVerification({
        shopSlug: 'pho-hoi-an',
        shopId: SHOP_A,
        tableId: 'tbl-fnb-01',
        sig: 'forged-sig',
        tableQrVerified: false,
        activeSlug: 'pho-hoi-an',
        activeTableId: 'tbl-fnb-01',
        activeSig: 'forged-sig',
      }),
      userTableChoice: null,
      locale: 'vi',
    });
    assert.equal(unverifiedState.lockedTable, null);
    assert.ok(unverifiedState.error);
    assert.equal(
      canUseStorefrontTableServiceActions({
        lockedTable: unverifiedState.lockedTable,
        tableQrVerified: unverifiedState.tableQrVerified,
        isTakeawaySelected: unverifiedState.isTakeawaySelected,
        error: unverifiedState.error,
        qrTableSigParam: 'forged-sig',
      }),
      false
    );

    // Takeaway / generic menu without QR never locks table
    const takeawayState = resolveStorefrontMenuTableState({
      shopSlug: 'pho-hoi-an',
      shopId: SHOP_A,
      tables: [activeTable],
      qrTableIdParam: null,
      qrTableSigParam: null,
      qrTableParam: null,
      verification: null,
      userTableChoice: {
        shopSlug: 'pho-hoi-an',
        tableQueryKey: buildStorefrontTableQueryKey({ shopSlug: 'pho-hoi-an' }),
        tableId: null,
        tableLabel: 'Mang về',
        isTakeaway: true,
      },
      locale: 'vi',
    });
    assert.equal(takeawayState.lockedTable, null);
    assert.equal(takeawayState.isTakeawaySelected, true);
    assert.equal(
      canUseStorefrontTableServiceActions({
        lockedTable: takeawayState.lockedTable,
        tableQrVerified: takeawayState.tableQrVerified,
        isTakeawaySelected: takeawayState.isTakeawaySelected,
        error: takeawayState.error,
        qrTableSigParam: null,
      }),
      false
    );
    assert.equal(
      canUseStorefrontTableServiceActions({
        lockedTable: { ...activeTable, is_active: false },
        tableQrVerified: true,
        isTakeawaySelected: false,
        error: null,
        qrTableSigParam: validSig,
      }),
      false
    );
  });

  test('2. Proof & ownership validation: derives shop/table/label from verified proof and rejects invalid type, takeaway, missing/forged sig, cross-shop, inactive, or archived table', async () => {
    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');

    // Valid call_staff request: server ignores spoofed client table_label and derives canonical Bàn 01 & SHOP_A
    const callRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          table_label: 'Spoofed VIP Table 999',
          request_type: 'call_staff',
          visitor_lang: 'ko',
        }),
      })
    );
    assert.equal(callRes.status, 201);
    const callData = await callRes.json();
    assert.equal(callData.deduplicated, false);
    assert.equal(callData.serviceRequest.shop_id, SHOP_A);
    assert.equal(callData.serviceRequest.table_id, 'tbl-fnb-01');
    assert.equal(callData.serviceRequest.table_code, 'T01');
    assert.equal(callData.serviceRequest.table_label, 'Bàn 01');
    assert.equal(callData.serviceRequest.request_type, 'call_staff');
    assert.equal(callData.serviceRequest.status, 'pending');
    assert.equal(callData.serviceRequest.visitor_lang, 'ko');

    // Reject unsupported request type
    const badTypeRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'bring_water',
        }),
      })
    );
    assert.equal(badTypeRes.status, 400);
    const badTypeJson = await badTypeRes.json();
    assert.equal(badTypeJson.code, 'INVALID_SERVICE_REQUEST_TYPE');

    // Reject takeaway
    const takeawayRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_label: 'Mang về',
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(takeawayRes.status, 403);
    const takeawayJson = await takeawayRes.json();
    assert.equal(takeawayJson.code, 'TAKEAWAY_SERVICE_REQUEST_FORBIDDEN');

    // Reject missing QR signature
    const missingSigRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(missingSigRes.status, 403);
    const missingSigJson = await missingSigRes.json();
    assert.equal(missingSigJson.code, 'MISSING_TABLE_QR_SIGNATURE');

    // Reject forged QR signature or signature from another table
    const table2Sig = signTableQr(SHOP_A, 'tbl-fnb-02');
    const forgedSigRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: table2Sig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(forgedSigRes.status, 403);
    const forgedSigJson = await forgedSigRes.json();
    assert.equal(forgedSigJson.code, 'INVALID_TABLE_QR_SIGNATURE');

    // Reject cross-shop mismatch
    const crossShopRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_B,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(crossShopRes.status, 403);
    const crossShopJson = await crossShopRes.json();
    assert.equal(crossShopJson.code, 'INVALID_TABLE_SHOP');

    // Reject inactive table
    await dbUpdateShopTable({
      shop_id: SHOP_A,
      id: 'tbl-fnb-02',
      is_active: false,
    });
    const inactiveRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-02',
          table_qr_sig: table2Sig,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(inactiveRes.status, 409);
    const inactiveJson = await inactiveRes.json();
    assert.equal(inactiveJson.code, 'INACTIVE_SHOP_TABLE');

    // Reject archived table
    const tempTable = await dbCreateShopTable({
      shop_id: SHOP_A,
      name: 'Bàn Tạm 99',
      table_code: 'T99',
    });
    const tempSig = signTableQr(SHOP_A, tempTable.id);
    await dbUpdateShopTable({
      shop_id: SHOP_A,
      id: tempTable.id,
      is_archived: true,
    });
    const archivedRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: tempTable.id,
          table_qr_sig: tempSig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(archivedRes.status, 409);
    const archivedJson = await archivedRes.json();
    assert.equal(archivedJson.code, 'INACTIVE_SHOP_TABLE');
  });

  test('3. Duplicate suppression: rapid repeat taps of the same type on the same table are deduplicated while distinct type is allowed', async () => {
    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');

    const firstRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(firstRes.status, 201);
    const firstJson = await firstRes.json();
    assert.equal(firstJson.deduplicated, false);

    // Rapid second tap of call_staff on the same table returns 200 deduplicated with same ID
    const secondRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(secondRes.status, 200);
    const secondJson = await secondRes.json();
    assert.equal(secondJson.deduplicated, true);
    assert.equal(secondJson.serviceRequest.id, firstJson.serviceRequest.id);

    // Submitting request_bill on the same table succeeds immediately because request_type differs
    const billRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(billRes.status, 201);
    const billJson = await billRes.json();
    assert.equal(billJson.deduplicated, false);
    assert.notEqual(billJson.serviceRequest.id, firstJson.serviceRequest.id);

    const active = await dbGetShopServiceRequests(SHOP_A);
    assert.equal(active.length, 2);
  });

  test('4. Permissions, status transitions, and financial non-mutation on request_bill', async () => {
    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');

    // Create an unpaid guest order on Bàn 01 first
    const unpaidOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_id: 'tbl-fnb-01',
      table_qr_sig: validSig,
      require_table_qr_sig: true,
      source: 'qr_table',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 2,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(unpaidOrder.payment_status, 'unpaid');
    assert.equal(unpaidOrder.total_amount, 110000);

    // Guest submits a bill request on Bàn 01
    const createBillReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(createBillReqRes.status, 201);
    const { serviceRequest: billReq } = await createBillReqRes.json();

    // Unauthenticated GET & PATCH -> 401
    const unauthGet = await getServiceRequestsRoute(
      new Request(`http://localhost/api/service-requests?shopId=${SHOP_A}`)
    );
    assert.equal(unauthGet.status, 401);

    const unauthPatch = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: billReq.id, status: 'acknowledged' }),
      })
    );
    assert.equal(unauthPatch.status, 401);

    // Missing shop_id on authenticated PATCH -> 400 MISSING_SHOP_ID before lookup
    const missingShopPatch = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({ id: billReq.id, status: 'acknowledged' }),
      })
    );
    assert.equal(missingShopPatch.status, 400);
    const missingShopPatchData = await missingShopPatch.json();
    assert.equal(missingShopPatchData.code, 'MISSING_SHOP_ID');

    // Cross-shop owner & inactive staff -> 403 when targeting SHOP_A
    const wrongShopGet = await getServiceRequestsRoute(
      new Request(`http://localhost/api/service-requests?shopId=${SHOP_A}`, {
        headers: { Authorization: `Bearer ${OWNER_B_TOKEN}` },
      })
    );
    assert.equal(wrongShopGet.status, 403);

    const wrongShopPatch = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_B_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(wrongShopPatch.status, 403);

    // Cross-shop probing: OWNER_B passes their own authorized SHOP_B with SHOP_A's request ID -> returns 404 identical to nonexistent ID
    const crossShopProbeExistingRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_B_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_B,
          status: 'acknowledged',
        }),
      })
    );
    const crossShopProbeMissingRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_B_TOKEN}`,
        },
        body: JSON.stringify({
          id: 'srv-does-not-exist-999',
          shop_id: SHOP_B,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(crossShopProbeExistingRes.status, 404);
    assert.equal(crossShopProbeMissingRes.status, 404);
    const probeExistingJson = await crossShopProbeExistingRes.json();
    const probeMissingJson = await crossShopProbeMissingRes.json();
    assert.equal(probeExistingJson.code, 'SERVICE_REQUEST_NOT_FOUND');
    assert.deepEqual(
      probeExistingJson,
      probeMissingJson,
      'cross-shop ID probe must return the exact same not-found response as a nonexistent ID'
    );

    const inactiveStaffPatch = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${INACTIVE_STAFF_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(inactiveStaffPatch.status, 403);

    // Authorized staff with orders.view sees pending request in GET /api/orders and GET /api/service-requests
    const staffOrdersRes = await getOrdersRoute(
      new Request(`http://localhost/api/orders?shopId=${SHOP_A}`, {
        headers: { Authorization: `Bearer ${STAFF_A_TOKEN}` },
      })
    );
    assert.equal(staffOrdersRes.status, 200);
    const staffOrdersData = await staffOrdersRes.json();
    assert.equal(staffOrdersData.serviceRequests.length, 1);
    assert.equal(staffOrdersData.serviceRequests[0].id, billReq.id);

    // Staff acknowledges the bill request: pending -> acknowledged
    const ackRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(ackRes.status, 200);
    const ackData = await ackRes.json();
    assert.equal(ackData.serviceRequest.status, 'acknowledged');
    assert.equal(ackData.serviceRequest.acknowledged_by, STAFF_A_ID);
    assert.ok(ackData.serviceRequest.acknowledged_at);

    // Backward transition acknowledged -> pending is rejected (409)
    const backwardPendingRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'pending',
        }),
      })
    );
    assert.equal(backwardPendingRes.status, 409);

    // Staff resolves the bill request: acknowledged -> resolved
    const resolveRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'resolved',
        }),
      })
    );
    assert.equal(resolveRes.status, 200);
    const resolveData = await resolveRes.json();
    assert.equal(resolveData.serviceRequest.status, 'resolved');
    assert.equal(resolveData.serviceRequest.resolved_by, 'owner-demo-001');
    assert.ok(resolveData.serviceRequest.resolved_at);

    // Backward transition resolved -> acknowledged is rejected (409)
    const backwardAckRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: billReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(backwardAckRes.status, 409);

    // Critical financial invariant: order remains unpaid and financial fields are untouched!
    const orderAfterBillReq = await dbGetOrderById(unpaidOrder.id);
    assert.ok(orderAfterBillReq);
    assert.equal(orderAfterBillReq.payment_status, 'unpaid');
    assert.equal(orderAfterBillReq.total_amount, 110000);
    assert.equal(orderAfterBillReq.subtotal_amount, 110000);
    assert.equal(orderAfterBillReq.discount_amount, 0);
    assert.equal(orderAfterBillReq.paid_at ?? null, null);
  });

  test('5. Realtime SSE broker & mobile push notification delivery for service requests (with deduplication)', async () => {
    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');

    // Subscribe a shop staff listener on the global OrderEventsBroker
    const broker = getOrderEventsBroker();
    const receivedSseEvents: OrderSseEvent[] = [];
    const unsubscribe = broker.subscribeClient({
      shopId: SHOP_A,
      onEvent: (ev) => receivedSseEvents.push(ev),
    });

    // Register a mobile push token for STAFF_A_ID (authorized orders.view member)
    const expoToken = 'ExponentPushToken[ServiceReqStaffToken01]';
    await dbUpsertMobilePushToken({
      user_id: STAFF_A_ID,
      shop_id: SHOP_A,
      expo_push_token: expoToken,
      locale: 'vi',
      platform: 'ios',
    });

    const sentPushPayloads: unknown[] = [];
    setPushFetchForTests((async (_url, init) => {
      const parsed = JSON.parse(String(init?.body || '[]'));
      sentPushPayloads.push(parsed);
      return new Response(
        JSON.stringify({ data: parsed.map(() => ({ status: 'ok' })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch);

    const initialSseChanges = receivedSseEvents.filter(
      (e) => e.type === 'change'
    ).length;

    // 1. Create a new service request -> triggers SSE change event AND 1 push dispatch
    const createRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(createRes.status, 201);
    const { serviceRequest } = await createRes.json();

    const afterCreateChanges = receivedSseEvents.filter(
      (e) => e.type === 'change' && e.shopId === SHOP_A
    );
    assert.equal(afterCreateChanges.length, initialSseChanges + 1);
    assert.equal(sentPushPayloads.length, 1);

    // 2. Rapid duplicate tap -> deduplicated, NO extra SSE change event and NO extra push dispatch
    const dupRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSig,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(dupRes.status, 200);
    assert.equal(
      receivedSseEvents.filter((e) => e.type === 'change' && e.shopId === SHOP_A)
        .length,
      initialSseChanges + 1
    );
    assert.equal(sentPushPayloads.length, 1);

    // 3. Staff acknowledges -> triggers SSE change event for shop subscribers
    const ackRes = await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: serviceRequest.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(ackRes.status, 200);
    assert.equal(
      receivedSseEvents.filter((e) => e.type === 'change' && e.shopId === SHOP_A)
        .length,
      initialSseChanges + 2
    );

    unsubscribe();

    // 4. PostgreSQL NOTIFY on table_service_requests routes only to matching shop
    let upstreamCallback: ((message: { channel: string; payload?: string }) => void) | null =
      null;
    const customBroker = new OrderEventsBroker({
      createClient: () => {
        const client: PostgresListenerClientLike = {
          connect: async () => undefined,
          query: async () => undefined,
          on(event, listener) {
            if (event === 'notification') {
              upstreamCallback = listener as (
                message: { channel: string; payload?: string }
              ) => void;
            }
            return client;
          },
          end: async () => undefined,
        };
        return client;
      },
    });

    const shopAEvents: OrderSseEvent[] = [];
    const shopBEvents: OrderSseEvent[] = [];
    const unsubA = customBroker.subscribeClient({
      shopId: SHOP_A,
      onEvent: (e) => shopAEvents.push(e),
    });
    const unsubB = customBroker.subscribeClient({
      shopId: SHOP_B,
      onEvent: (e) => shopBEvents.push(e),
    });

    assert.ok(upstreamCallback);
    (upstreamCallback as (message: { channel: string; payload?: string }) => void)({
      channel: DEFAULT_POSTGRES_CHANNEL,
      payload: JSON.stringify({
        table: 'table_service_requests',
        eventType: 'INSERT',
        shopId: SHOP_A,
      }),
    });

    assert.equal(
      shopAEvents.filter((e) => e.type === 'change' && e.shopId === SHOP_A)
        .length,
      1
    );
    assert.equal(
      shopBEvents.filter((e) => e.type === 'change').length,
      0
    );

    unsubA();
    unsubB();
    customBroker.reset();
  });

  test('6. Atomic database-boundary deduplication (PGlite + create_table_service_request_atomic RPC): parallel guest POSTs and multi-instance RPC calls cannot create duplicate rows or duplicate notifications', async () => {
    const db = new PGlite({ extensions: { uuid_ossp } });
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    class PgLiteTableQuery {
      private table: string;
      private columns = '*';
      private eqFilters: Array<[string, unknown]> = [];
      private inFilters: Array<[string, unknown[]]> = [];
      private singleMode: 'none' | 'maybe' | 'single' = 'none';
      private updatePayload: Record<string, unknown> | null = null;
      private insertPayload: Record<string, unknown> | null = null;

      constructor(table: string) {
        this.table = table;
      }

      select(columns = '*') {
        this.columns = columns;
        return this;
      }

      eq(column: string, value: unknown) {
        this.eqFilters.push([column, value]);
        return this;
      }

      in(column: string, values: unknown[]) {
        this.inFilters.push([column, values]);
        return this;
      }

      order() {
        return this;
      }

      maybeSingle() {
        this.singleMode = 'maybe';
        return this;
      }

      single() {
        this.singleMode = 'single';
        return this;
      }

      insert(payload: Record<string, unknown>) {
        if (this.table === 'table_service_requests') {
          throw new Error(
            'Direct insert on table_service_requests is forbidden; dbCreateTableServiceRequest must use create_table_service_request_atomic RPC.'
          );
        }
        this.insertPayload = payload;
        return this;
      }

      update(payload: Record<string, unknown>) {
        this.updatePayload = payload;
        return this;
      }

      async execute() {
        const ident = (value: string) => {
          assert.match(value, /^[a-z_]+$/i);
          return `"${value}"`;
        };
        const params: unknown[] = [];
        const buildWhere = () => {
          const clauses: string[] = [];
          for (const [col, val] of this.eqFilters) {
            params.push(val);
            clauses.push(`${ident(col)} = $${params.length}`);
          }
          for (const [col, vals] of this.inFilters) {
            const placeholders = vals.map((v) => {
              params.push(v);
              return `$${params.length}`;
            });
            clauses.push(`${ident(col)} IN (${placeholders.join(', ')})`);
          }
          return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
        };

        try {
          if (this.insertPayload) {
            const keys = Object.keys(this.insertPayload);
            const cols = keys.map(ident).join(', ');
            const vals = keys.map((k) => {
              params.push(this.insertPayload![k]);
              return `$${params.length}`;
            });
            const { rows } = await db.query(
              `INSERT INTO ${ident(this.table)} (${cols}) VALUES (${vals.join(', ')}) RETURNING *`,
              params
            );
            return {
              data:
                this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
              error: null,
            };
          }

          if (this.updatePayload) {
            const keys = Object.keys(this.updatePayload);
            const setClauses = keys.map((k) => {
              params.push(this.updatePayload![k]);
              return `${ident(k)} = $${params.length}`;
            });
            const whereSql = buildWhere();
            const { rows } = await db.query(
              `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
              params
            );
            return {
              data:
                this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
              error: null,
            };
          }

          const selectCols =
            this.columns === '*'
              ? '*'
              : this.columns
                  .split(',')
                  .map((c) => ident(c.trim()))
                  .join(', ');
          const whereSql = buildWhere();
          const { rows } = await db.query(
            `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql} ORDER BY created_at DESC`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        } catch (err) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      then(
        resolve: (result: unknown) => unknown,
        reject: (err: unknown) => unknown
      ) {
        return this.execute().then(resolve, reject);
      }
    }

    const pgliteClient = {
      from: (table: string) => new PgLiteTableQuery(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        assert.match(name, /^[a-z_]+$/);
        const keys = Object.keys(args);
        const paramSql = keys
          .map((key, idx) => {
            assert.match(key, /^[a-z_]+$/);
            return `${key} => $${idx + 1}`;
          })
          .join(', ');
        const paramValues = keys.map((key) =>
          typeof args[key] === 'object' && args[key] !== null
            ? JSON.stringify(args[key])
            : args[key]
        );
        try {
          const { rows } = await db.query<{ result: unknown }>(
            `SELECT ${name}(${paramSql}) AS result`,
            paramValues
          );
          return { data: rows[0]?.result ?? null, error: null };
        } catch (err) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
    };

    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
      `);
      for (const file of fs
        .readdirSync('supabase/migrations')
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        await db.exec(
          fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
        );
      }

      await db.exec(`
        INSERT INTO profiles (id, email) VALUES ('owner-demo-001', 'chuquan@qlaok.vn'), ('${STAFF_A_ID}', 'staff-service@qlaok.vn');
        INSERT INTO shops (id, owner_id, slug, name, is_published)
          VALUES ('${SHOP_A}', 'owner-demo-001', 'pho-hoi-an', 'Phở Hội An', true);
        INSERT INTO shop_tables (id, shop_id, table_code, name, is_active, is_archived)
          VALUES ('tbl-fnb-01', '${SHOP_A}', 'B01', 'Bàn 01', true, false);
      `);

      setShopTablesDbClientForTests(pgliteClient, true);
      __setServiceRequestsDbClientForTests(pgliteClient as never, {
        forceDbMode: true,
      });

      const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');

      const broker = getOrderEventsBroker();
      const receivedSseEvents: OrderSseEvent[] = [];
      const unsubscribe = broker.subscribeClient({
        shopId: SHOP_A,
        onEvent: (ev) => receivedSseEvents.push(ev),
      });

      await dbUpsertMobilePushToken({
        user_id: STAFF_A_ID,
        shop_id: SHOP_A,
        expo_push_token: 'ExponentPushToken[ParallelServiceReqToken01]',
        locale: 'vi',
        platform: 'ios',
      });
      const sentPushPayloads: unknown[] = [];
      setPushFetchForTests((async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '[]')) as unknown[];
        sentPushPayloads.push(...parsed);
        return new Response(
          JSON.stringify({ data: parsed.map(() => ({ status: 'ok' })) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch);

      const initialSseChanges = receivedSseEvents.filter(
        (e) => e.type === 'change' && e.shopId === SHOP_A
      ).length;

      // Part A: Fire 6 parallel POST /api/service-requests requests for the same verified table + request_type
      const parallelResponses = await Promise.all(
        Array.from({ length: 6 }, () =>
          postServiceRequestsRoute(
            new Request('http://localhost/api/service-requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shop_id: SHOP_A,
                table_id: 'tbl-fnb-01',
                table_qr_sig: validSig,
                request_type: 'call_staff',
                visitor_lang: 'vi',
              }),
            })
          )
        )
      );

      const parallelPayloads = await Promise.all(
        parallelResponses.map(async (res) => ({
          status: res.status,
          body: (await res.json()) as {
            serviceRequest: { id: string; table_label: string; status: string };
            deduplicated: boolean;
          },
        }))
      );

      // Verify all 6 requests exercised the atomic PostgreSQL RPC path
      assert.equal(
        rpcCalls.filter(
          (call) => call.name === 'create_table_service_request_atomic'
        ).length,
        6
      );

      const createdResponses = parallelPayloads.filter(
        (p) => p.status === 201 && p.body.deduplicated === false
      );
      const deduplicatedResponses = parallelPayloads.filter(
        (p) => p.status === 200 && p.body.deduplicated === true
      );
      assert.equal(
        createdResponses.length,
        1,
        'exactly 1 parallel request must create a new service request (201)'
      );
      assert.equal(
        deduplicatedResponses.length,
        5,
        'all other parallel requests must be deduplicated (200)'
      );

      const canonicalId = createdResponses[0].body.serviceRequest.id;
      for (const item of parallelPayloads) {
        assert.equal(item.body.serviceRequest.id, canonicalId);
        assert.equal(item.body.serviceRequest.table_label, 'Bàn 01');
      }

      // Verify PostgreSQL table contains strictly 1 row for call_staff
      const dbCallStaffRows = await db.query<{ id: string }>(
        `SELECT id FROM public.table_service_requests WHERE shop_id = $1 AND table_id = $2 AND request_type = 'call_staff'`,
        [SHOP_A, 'tbl-fnb-01']
      );
      assert.equal(dbCallStaffRows.rows.length, 1);
      assert.equal(dbCallStaffRows.rows[0].id, canonicalId);

      // Verify strictly 1 SSE change event and 1 push notification were sent
      assert.equal(
        receivedSseEvents.filter(
          (e) => e.type === 'change' && e.shopId === SHOP_A
        ).length,
        initialSseChanges + 1
      );
      assert.equal(sentPushPayloads.length, 1);

      // Part B: Parallel POST /api/service-requests requests for request_bill on the same table (distinct request_type) also invoke the RPC and deduplicate to 1 row & 1 notification
      const parallelBillResponses = await Promise.all(
        Array.from({ length: 5 }, () =>
          postServiceRequestsRoute(
            new Request('http://localhost/api/service-requests', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shop_id: SHOP_A,
                table_id: 'tbl-fnb-01',
                table_qr_sig: validSig,
                request_type: 'request_bill',
                visitor_lang: 'en',
              }),
            })
          )
        )
      );

      const parallelBillPayloads = await Promise.all(
        parallelBillResponses.map(async (res) => ({
          status: res.status,
          body: (await res.json()) as {
            serviceRequest: { id: string; table_label: string; status: string };
            deduplicated: boolean;
          },
        }))
      );
      assert.equal(
        rpcCalls.filter(
          (call) => call.name === 'create_table_service_request_atomic'
        ).length,
        11
      );
      assert.equal(
        parallelBillPayloads.filter(
          (p) => p.status === 201 && p.body.deduplicated === false
        ).length,
        1,
        'only 1 parallel POST for request_bill may create a row (201)'
      );
      assert.equal(
        parallelBillPayloads.filter(
          (p) => p.status === 200 && p.body.deduplicated === true
        ).length,
        4,
        'remaining parallel POSTs for request_bill must return 200 deduplicated=true'
      );
      const winningBillId = parallelBillPayloads.find(
        (p) => !p.body.deduplicated
      )!.body.serviceRequest.id;
      for (const payload of parallelBillPayloads) {
        assert.equal(payload.body.serviceRequest.id, winningBillId);
        assert.equal(payload.body.serviceRequest.table_label, 'Bàn 01');
      }

      const dbBillRows = await db.query<{ id: string }>(
        `SELECT id FROM public.table_service_requests WHERE shop_id = $1 AND table_id = $2 AND request_type = 'request_bill'`,
        [SHOP_A, 'tbl-fnb-01']
      );
      assert.equal(dbBillRows.rows.length, 1);
      assert.equal(
        receivedSseEvents.filter(
          (e) => e.type === 'change' && e.shopId === SHOP_A
        ).length,
        initialSseChanges + 2
      );
      assert.equal(sentPushPayloads.length, 2);

      // Part C: Resolving the active request allows a new request of the same type to be created
      const resolveRes = await patchServiceRequestsRoute(
        new Request('http://localhost/api/service-requests', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${STAFF_A_TOKEN}`,
          },
          body: JSON.stringify({
            id: canonicalId,
            shop_id: SHOP_A,
            status: 'resolved',
          }),
        })
      );
      assert.equal(resolveRes.status, 200);

      const postResolveRes = await postServiceRequestsRoute(
        new Request('http://localhost/api/service-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: SHOP_A,
            table_id: 'tbl-fnb-01',
            table_qr_sig: validSig,
            request_type: 'call_staff',
          }),
        })
      );
      assert.equal(postResolveRes.status, 201);
      const postResolveData = await postResolveRes.json();
      assert.equal(postResolveData.deduplicated, false);
      assert.notEqual(postResolveData.serviceRequest.id, canonicalId);

      unsubscribe();
    } finally {
      setShopTablesDbClientForTests(null, false);
      __setServiceRequestsDbClientForTests(null, { forceDbMode: false });
      await db.close();
    }
  });

  test('7. Pure recipient resolver: default/invalid legacy rules, owner_only vs all_order_staff, inactive owner/member, active member without orders.view, and request_bill independence', () => {
    assert.equal(isValidServiceRequestNotificationRule('all_order_staff'), true);
    assert.equal(isValidServiceRequestNotificationRule('owner_only'), true);
    assert.equal(isValidServiceRequestNotificationRule('invalid_rule'), false);
    assert.equal(isValidServiceRequestNotificationRule(''), false);
    assert.equal(isValidServiceRequestNotificationRule(null), false);
    assert.equal(isValidServiceRequestNotificationRule(undefined), false);

    assert.equal(
      resolveShopServiceRequestNotificationRule(undefined),
      'all_order_staff'
    );
    assert.equal(
      resolveShopServiceRequestNotificationRule(null),
      'all_order_staff'
    );
    assert.equal(
      resolveShopServiceRequestNotificationRule({
        primaryColor: '#10b981',
        layout: 'grid',
      }),
      'all_order_staff'
    );
    assert.equal(
      resolveShopServiceRequestNotificationRule({
        serviceRequestNotificationRule: 'legacy_bogus_value',
      }),
      'all_order_staff'
    );
    assert.equal(
      resolveShopServiceRequestNotificationRule({
        serviceRequestNotificationRule: 'owner_only',
      }),
      'owner_only'
    );

    const nowIso = '2026-10-24T00:00:00.000Z';
    const memberships: ShopMembership[] = [
      {
        id: 'mem-active-orders',
        shop_id: SHOP_A,
        user_id: 'staff-orders-view',
        role: 'staff',
        permissions: ['orders.view', 'orders.fulfill'],
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'mem-active-cashier',
        shop_id: SHOP_A,
        user_id: 'cashier-orders-view',
        role: 'cashier',
        permissions: ['orders.view', 'payment.collect'],
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'mem-active-catalog-only',
        shop_id: SHOP_A,
        user_id: 'staff-no-orders-view',
        role: 'staff',
        permissions: ['catalog.manage', 'settings.manage'],
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      },
      {
        id: 'mem-inactive-orders',
        shop_id: SHOP_A,
        user_id: 'staff-inactive-orders',
        role: 'staff',
        permissions: ['orders.view', 'orders.fulfill'],
        is_active: false,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ];

    // 1. Missing/default rule on call_staff -> true owner + active members with orders.view
    for (const rule of [undefined, null, 'invalid_value', 'all_order_staff']) {
      const recipients = resolveServiceRequestNotificationRecipientUserIds({
        ownerId: 'owner-true-001',
        memberships,
        requestType: 'call_staff',
        rule,
      });
      assert.deepEqual(
        Array.from(recipients).sort(),
        ['cashier-orders-view', 'owner-true-001', 'staff-orders-view'],
        `rule=${String(rule)} should include active owner and active orders.view staff only`
      );
      assert.equal(recipients.has('staff-no-orders-view'), false);
      assert.equal(recipients.has('staff-inactive-orders'), false);
    }

    // 2. owner_only on call_staff -> only true shop owner
    const ownerOnlyRecipients =
      resolveServiceRequestNotificationRecipientUserIds({
        ownerId: 'owner-true-001',
        memberships: [
          ...memberships,
          {
            id: 'mem-impostor-owner-role',
            shop_id: SHOP_A,
            user_id: 'non-true-owner-999',
            role: 'owner',
            permissions: ['orders.view'],
            is_active: true,
            created_at: nowIso,
            updated_at: nowIso,
          },
        ],
        requestType: 'call_staff',
        rule: 'owner_only',
      });
    assert.deepEqual(Array.from(ownerOnlyRecipients), ['owner-true-001']);

    // 3. Inactive owner is excluded under both owner_only and all_order_staff
    const membershipsWithInactiveOwner: ShopMembership[] = [
      ...memberships,
      {
        id: 'mem-owner-deactivated',
        shop_id: SHOP_A,
        user_id: 'owner-true-001',
        role: 'owner',
        permissions: ['orders.view'],
        is_active: false,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ];
    const inactiveOwnerOnly = resolveServiceRequestNotificationRecipientUserIds(
      {
        ownerId: 'owner-true-001',
        memberships: membershipsWithInactiveOwner,
        requestType: 'call_staff',
        rule: 'owner_only',
      }
    );
    assert.equal(inactiveOwnerOnly.size, 0);

    const inactiveOwnerAllStaff =
      resolveServiceRequestNotificationRecipientUserIds({
        ownerId: 'owner-true-001',
        memberships: membershipsWithInactiveOwner,
        requestType: 'call_staff',
        rule: 'all_order_staff',
      });
    assert.deepEqual(Array.from(inactiveOwnerAllStaff).sort(), [
      'cashier-orders-view',
      'staff-orders-view',
    ]);

    // 4. request_bill always fans out to all_order_staff even when rule is owner_only
    const billUnderOwnerOnly =
      resolveServiceRequestNotificationRecipientUserIds({
        ownerId: 'owner-true-001',
        memberships,
        requestType: 'request_bill',
        rule: 'owner_only',
      });
    assert.deepEqual(Array.from(billUnderOwnerOnly).sort(), [
      'cashier-orders-view',
      'owner-true-001',
      'staff-orders-view',
    ]);
  });

  test('8. Push dispatch for call_staff vs request_bill & new guest orders: multiple localized tokens, owner_only filtering, rule-load error fallback, and non-blocking push failure', async () => {
    const validSig = signTableQr(SHOP_A, 'tbl-fnb-01');
    const CATALOG_ONLY_STAFF_ID = 'staff-catalog-only-003';

    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: CATALOG_ONLY_STAFF_ID,
      email: 'catalog-only@qlaok.vn',
      role: 'staff',
      permissions: ['catalog.manage'],
      is_active: true,
    });

    try {
      // Register multiple active tokens across owner (en + vi), active orders.view staff (vi),
      // active non-orders.view staff, and inactive staff
      const ownerEnToken = 'ExponentPushToken[OwnerCallStaffEn01]';
      const ownerViToken = 'ExponentPushToken[OwnerCallStaffVi02]';
      const staffViToken = 'ExponentPushToken[StaffOrdersViewVi03]';
      const catalogOnlyToken = 'ExponentPushToken[StaffCatalogOnly04]';
      const inactiveStaffToken = 'ExponentPushToken[StaffInactive05]';

      await dbUpsertMobilePushToken({
        user_id: 'owner-demo-001',
        shop_id: SHOP_A,
        expo_push_token: ownerEnToken,
        locale: 'en',
        platform: 'ios',
      });
      await dbUpsertMobilePushToken({
        user_id: 'owner-demo-001',
        shop_id: SHOP_A,
        expo_push_token: ownerViToken,
        locale: 'vi',
        platform: 'android',
      });
      await dbUpsertMobilePushToken({
        user_id: STAFF_A_ID,
        shop_id: SHOP_A,
        expo_push_token: staffViToken,
        locale: 'vi',
        platform: 'ios',
      });
      await dbUpsertMobilePushToken({
        user_id: CATALOG_ONLY_STAFF_ID,
        shop_id: SHOP_A,
        expo_push_token: catalogOnlyToken,
        locale: 'vi',
        platform: 'android',
      });
      await dbUpsertMobilePushToken({
        user_id: INACTIVE_STAFF_ID,
        shop_id: SHOP_A,
        expo_push_token: inactiveStaffToken,
        locale: 'vi',
        platform: 'ios',
      });

      let currentThemeConfig: Record<string, unknown> | null = {};
      let throwOnThemeSelect = false;

      const tokenRows = [
        {
          id: 'tok-1',
          user_id: 'owner-demo-001',
          shop_id: SHOP_A,
          expo_push_token: ownerEnToken,
          locale: 'en',
          platform: 'ios',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'tok-2',
          user_id: 'owner-demo-001',
          shop_id: SHOP_A,
          expo_push_token: ownerViToken,
          locale: 'vi',
          platform: 'android',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'tok-3',
          user_id: STAFF_A_ID,
          shop_id: SHOP_A,
          expo_push_token: staffViToken,
          locale: 'vi',
          platform: 'ios',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'tok-4',
          user_id: CATALOG_ONLY_STAFF_ID,
          shop_id: SHOP_A,
          expo_push_token: catalogOnlyToken,
          locale: 'vi',
          platform: 'android',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        {
          id: 'tok-5',
          user_id: INACTIVE_STAFF_ID,
          shop_id: SHOP_A,
          expo_push_token: inactiveStaffToken,
          locale: 'vi',
          platform: 'ios',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
      ];

      const fullMockPushClient = {
        from: (table: string) => ({
          select: (columns = '*') => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              },
              maybeSingle: async () => {
                if (table === 'shops' && filters.id === SHOP_A) {
                  if (columns.includes('theme_config') && throwOnThemeSelect) {
                    throw new Error('simulated_theme_config_db_error');
                  }
                  return {
                    data: {
                      owner_id: 'owner-demo-001',
                      name: 'Phở Hội An',
                      theme_config: currentThemeConfig,
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
              // biome-ignore lint/suspicious/noThenProperty: Supabase query builder mock
              then: (
                resolve: (val: unknown) => unknown,
                reject: (err: unknown) => unknown
              ) => {
                if (table === 'mobile_push_tokens') {
                  return Promise.resolve({
                    data: tokenRows.filter(
                      (r) =>
                        (!filters.shop_id || r.shop_id === filters.shop_id) &&
                        (filters.is_active === undefined ||
                          r.is_active === filters.is_active)
                    ),
                    error: null,
                  }).then(resolve, reject);
                }
                return Promise.resolve({ data: [], error: null }).then(
                  resolve,
                  reject
                );
              },
            };
            return builder;
          },
        }),
      };

      setPushDbClientForTests(fullMockPushClient as never, true);

      const sentBatches: ServiceRequestExpoPushMessagePayload[][] = [];
      setPushFetchForTests((async (_url, init) => {
        const parsed = JSON.parse(
          String(init?.body || '[]')
        ) as ServiceRequestExpoPushMessagePayload[];
        sentBatches.push(parsed);
        return new Response(
          JSON.stringify({ data: parsed.map(() => ({ status: 'ok' })) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch);

      // Case A: Default (missing serviceRequestNotificationRule) -> all_order_staff
      // Sends localized call_staff messages to all 3 eligible tokens (owner EN, owner VI, staff VI)
      const defaultRes = await sendServiceRequestPushNotifications({
        serviceRequest: {
          id: 'srv-rule-default-01',
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_code: 'T01',
          table_label: 'Bàn 01',
          request_type: 'call_staff',
          status: 'pending',
          visitor_lang: 'vi',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      assert.equal(defaultRes.skipped, false);
      assert.equal(defaultRes.recipientsCount, 2);
      assert.equal(defaultRes.tokensCount, 3);
      assert.equal(defaultRes.sent, 3);
      assert.equal(sentBatches.length, 1);

      const batchA = sentBatches[0];
      assert.deepEqual(
        batchA.map((m) => m.to).sort(),
        [ownerEnToken, ownerViToken, staffViToken].sort()
      );
      const ownerEnMsg = batchA.find((m) => m.to === ownerEnToken)!;
      assert.equal(ownerEnMsg.title, 'Guest calling staff • Bàn 01');
      assert.equal(
        ownerEnMsg.body,
        'Bàn 01 is calling staff to the table.'
      );
      const ownerViMsg = batchA.find((m) => m.to === ownerViToken)!;
      assert.equal(ownerViMsg.title, 'Khách gọi phục vụ • Bàn 01');
      const staffViMsg = batchA.find((m) => m.to === staffViToken)!;
      assert.equal(staffViMsg.title, 'Khách gọi phục vụ • Bàn 01');

      // Case B: Shop configured with owner_only -> call_staff sends ONLY to owner's 2 tokens
      currentThemeConfig = { serviceRequestNotificationRule: 'owner_only' };
      const ownerOnlyRes = await sendServiceRequestPushNotifications({
        serviceRequest: {
          id: 'srv-rule-owner-only-02',
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_code: 'T01',
          table_label: 'Bàn 01',
          request_type: 'call_staff',
          status: 'pending',
          visitor_lang: 'vi',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      assert.equal(ownerOnlyRes.skipped, false);
      assert.equal(ownerOnlyRes.recipientsCount, 1);
      assert.equal(ownerOnlyRes.tokensCount, 2);
      assert.equal(ownerOnlyRes.sent, 2);
      assert.equal(sentBatches.length, 2);
      assert.deepEqual(
        sentBatches[1].map((m) => m.to).sort(),
        [ownerEnToken, ownerViToken].sort()
      );

      // Case C: request_bill under owner_only STILL fans out to all_order_staff (owner + orders.view staff = 3 tokens)
      const billUnderOwnerOnlyRes = await sendServiceRequestPushNotifications({
        serviceRequest: {
          id: 'srv-rule-bill-unchanged-03',
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_code: 'T01',
          table_label: 'Bàn 01',
          request_type: 'request_bill',
          status: 'pending',
          visitor_lang: 'vi',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      assert.equal(billUnderOwnerOnlyRes.recipientsCount, 2);
      assert.equal(billUnderOwnerOnlyRes.tokensCount, 3);
      assert.equal(billUnderOwnerOnlyRes.sent, 3);
      assert.deepEqual(
        sentBatches[2].map((m) => m.to).sort(),
        [ownerEnToken, ownerViToken, staffViToken].sort()
      );

      // Case D: Guest new-order push under owner_only STILL fans out to all_order_staff (owner + orders.view staff = 3 tokens)
      const newOrderUnderOwnerOnlyRes = await sendNewGuestOrderPushNotifications(
        {
          order: {
            id: 'ord-under-owner-only-04',
            order_code: 'ORD-904',
            shop_id: SHOP_A,
            table_id: 'tbl-fnb-01',
            table_label: 'Bàn 01',
            visitor_lang: 'vi',
            status: 'new',
            source: 'qr_table',
            payment_method: 'cash',
            payment_status: 'unpaid',
            total_amount: 85000,
            items: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          isGuestOrder: true,
        }
      );
      assert.equal(newOrderUnderOwnerOnlyRes.recipientsCount, 2);
      assert.equal(newOrderUnderOwnerOnlyRes.tokensCount, 3);
      assert.equal(newOrderUnderOwnerOnlyRes.sent, 3);

      // Case E: If loading theme_config fails, call_staff falls back to all_order_staff (owner + active orders.view staff, excluding catalog-only & inactive)
      throwOnThemeSelect = true;
      const fallbackUsers =
        await resolveAuthorizedServiceRequestNotificationUserIds(
          SHOP_A,
          'call_staff'
        );
      assert.equal(fallbackUsers.has('owner-demo-001'), true);
      assert.equal(fallbackUsers.has(STAFF_A_ID), true);
      assert.equal(fallbackUsers.has(CATALOG_ONLY_STAFF_ID), false);
      assert.equal(fallbackUsers.has(INACTIVE_STAFF_ID), false);
      throwOnThemeSelect = false;

      // Case F: Client spoofing recipient rule in POST /api/service-requests is ignored,
      // and push/network failure does not prevent the service request from succeeding (201)
      currentThemeConfig = {
        serviceRequestNotificationRule: 'all_order_staff',
      };
      const postSpoofRes = await postServiceRequestsRoute(
        new Request('http://localhost/api/service-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: SHOP_A,
            table_id: 'tbl-fnb-01',
            table_qr_sig: validSig,
            request_type: 'call_staff',
            serviceRequestNotificationRule: 'owner_only',
            recipientUserIds: ['owner-demo-001'],
          }),
        })
      );
      assert.equal(postSpoofRes.status, 201);
      const lastBatch = sentBatches[sentBatches.length - 1];
      assert.deepEqual(
        lastBatch.map((m) => m.to).sort(),
        [ownerEnToken, ownerViToken, staffViToken].sort(),
        'client payload must never override server-side call_staff recipient rule'
      );

      // Network failure on Expo push still returns 201 for table service request creation
      setPushFetchForTests((async () => {
        throw new Error('simulated_expo_network_outage');
      }) as typeof fetch);

      const postWithPushFailureRes = await postServiceRequestsRoute(
        new Request('http://localhost/api/service-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shop_id: SHOP_A,
            table_id: 'tbl-fnb-01',
            table_qr_sig: validSig,
            request_type: 'request_bill',
          }),
        })
      );
      assert.equal(postWithPushFailureRes.status, 201);
      const createdDespitePushFailure = await postWithPushFailureRes.json();
      assert.equal(
        createdDespitePushFailure.serviceRequest.request_type,
        'request_bill'
      );
    } finally {
      setPushDbClientForTests(null, false);
      await dbDeleteShopMembership(SHOP_A, CATALOG_ONLY_STAFF_ID).catch(
        () => {}
      );
    }
  });

  test('9. PATCH /api/shops validates serviceRequestNotificationRule, enforces owner/admin-only changes, and preserves other theme_config keys', async () => {
    const db = new PGlite({ extensions: { uuid_ossp } });
    const ownerId = '00000000-0000-0000-0000-000000000501';
    const staffId = '00000000-0000-0000-0000-000000000502';
    const cashierId = '00000000-0000-0000-0000-000000000503';
    const adminId = '00000000-0000-0000-0000-000000000504';
    const testShopId = 'sr-rule-shop-1';

    class PgShopQueryBuilder {
      private table: string;
      private columns = '*';
      private eqFilters: Array<[string, unknown]> = [];
      private singleMode: 'none' | 'maybe' | 'single' = 'none';
      private updatePayload: Record<string, unknown> | null = null;

      constructor(table: string) {
        this.table = table;
      }
      select(columns = '*') {
        this.columns = columns;
        return this;
      }
      eq(column: string, value: unknown) {
        this.eqFilters.push([column, value]);
        return this;
      }
      order() {
        return this;
      }
      maybeSingle() {
        this.singleMode = 'maybe';
        return this;
      }
      single() {
        this.singleMode = 'single';
        return this;
      }
      update(payload: Record<string, unknown>) {
        this.updatePayload = payload;
        return this;
      }
      async execute() {
        const ident = (value: string) => {
          assert.match(value, /^[a-z_]+$/i);
          return `"${value}"`;
        };
        const params: unknown[] = [];
        const clauses = this.eqFilters.map(([col, val]) => {
          params.push(val);
          return `${ident(col)} = $${params.length}`;
        });
        const whereSql =
          clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';

        try {
          if (this.updatePayload) {
            const keys = Object.keys(this.updatePayload);
            const setClauses = keys.map((k) => {
              const v = this.updatePayload![k];
              params.push(
                typeof v === 'object' && v !== null ? JSON.stringify(v) : v
              );
              return `${ident(k)} = $${params.length}`;
            });
            const { rows } = await db.query(
              `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
              params
            );
            return {
              data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
              error: null,
            };
          }

          const selectCols =
            this.columns === '*'
              ? '*'
              : this.columns
                  .split(',')
                  .map((c) => ident(c.trim()))
                  .join(', ');
          const { rows } = await db.query(
            `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        } catch (err) {
          return {
            data: null,
            error: {
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builder mock
      then(
        resolve: (result: unknown) => unknown,
        reject: (err: unknown) => unknown
      ) {
        return this.execute().then(resolve, reject);
      }
    }

    const client = {
      from: (table: string) => new PgShopQueryBuilder(table),
    };

    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
      `);
      for (const file of fs
        .readdirSync('supabase/migrations')
        .filter((f) => f.endsWith('.sql'))
        .sort()) {
        await db.exec(
          fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
        );
      }

      await db.exec(`
        INSERT INTO profiles (id) VALUES
          ('${ownerId}'),
          ('${staffId}'),
          ('${cashierId}'),
          ('${adminId}');
        INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
          '${testShopId}',
          '${ownerId}',
          'sr-rule-shop-1',
          'Quán Phở Gọi Phục Vụ',
          true,
          '{"primaryColor":"#10b981","layout":"grid","fontStyle":"modern","paymentQr":{"bankId":"VCB","accountNo":"998877","accountName":"CHU QUAN"},"promoBanner":{"enabled":true,"discountValue":15,"title":"Giảm 15%"}}'::jsonb
        );
        INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
          ('mem-sr-staff', '${testShopId}', '${staffId}', 'staff', '["orders.view","orders.fulfill","settings.manage"]'::jsonb, true),
          ('mem-sr-cashier', '${testShopId}', '${cashierId}', 'cashier', '["orders.view","orders.create","payment.collect","settings.manage"]'::jsonb, true);
      `);

      setSupabaseDbClientForTests(client);
      setShopMembershipDbClientForTest(client as never);

      const ownerToken = issueSessionToken({
        id: ownerId,
        email: 'owner@qlaok.test',
        role: 'owner',
      });
      const staffToken = issueSessionToken({
        id: staffId,
        email: 'staff@qlaok.test',
        role: 'staff',
      });
      const cashierToken = issueSessionToken({
        id: cashierId,
        email: 'cashier@qlaok.test',
        role: 'cashier',
      });
      const adminToken = issueSessionToken({
        id: adminId,
        email: 'hoangvu96z@gmail.com',
        role: 'admin',
        is_admin: true,
      });

      // 1. Staff and cashier (even with settings.manage) are rejected with 403 when changing serviceRequestNotificationRule
      for (const token of [staffToken, cashierToken]) {
        const unauthorizedRes = await patchShopsRoute(
          new Request('http://localhost/api/shops', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              id: testShopId,
              theme_config: {
                serviceRequestNotificationRule: 'owner_only',
              },
            }),
          })
        );
        assert.equal(unauthorizedRes.status, 403);
      }

      // 2. Owner sending invalid values receives 400 INVALID_SERVICE_REQUEST_NOTIFICATION_RULE
      for (const badValue of ['everyone', '', null, 123, {}]) {
        const badRes = await patchShopsRoute(
          new Request('http://localhost/api/shops', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${ownerToken}`,
            },
            body: JSON.stringify({
              id: testShopId,
              theme_config: {
                serviceRequestNotificationRule: badValue,
              },
            }),
          })
        );
        assert.equal(
          badRes.status,
          400,
          `Invalid value ${JSON.stringify(badValue)} must return 400`
        );
        const badBody = (await badRes.json()) as { code?: string };
        assert.equal(
          badBody.code,
          'INVALID_SERVICE_REQUEST_NOTIFICATION_RULE'
        );
      }

      // 3. Owner saves owner_only; other theme_config keys are preserved
      const ownerSaveRes = await patchShopsRoute(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerToken}`,
          },
          body: JSON.stringify({
            id: testShopId,
            theme_config: {
              serviceRequestNotificationRule: 'owner_only',
            },
          }),
        })
      );
      assert.equal(ownerSaveRes.status, 200);
      const ownerSaveBody = (await ownerSaveRes.json()) as {
        shop: { theme_config: ShopThemeConfig };
      };
      assert.equal(
        ownerSaveBody.shop.theme_config.serviceRequestNotificationRule,
        'owner_only'
      );
      assert.equal(ownerSaveBody.shop.theme_config.primaryColor, '#10b981');
      assert.equal(ownerSaveBody.shop.theme_config.fontStyle, 'modern');
      assert.equal(ownerSaveBody.shop.theme_config.paymentQr?.bankId, 'VCB');
      assert.equal(
        ownerSaveBody.shop.theme_config.promoBanner?.discountValue,
        15
      );

      const reloadRes = await getShopRoute(
        new Request(
          `http://localhost/api/shops?shopId=${encodeURIComponent(testShopId)}`,
          { headers: { Authorization: `Bearer ${ownerToken}` } }
        )
      );
      assert.equal(reloadRes.status, 200);
      const reloadBody = (await reloadRes.json()) as {
        shop: { theme_config: ShopThemeConfig };
      };
      assert.equal(
        reloadBody.shop.theme_config.serviceRequestNotificationRule,
        'owner_only'
      );

      // 4. Staff with settings.manage can update general theme keys (fontStyle) while spreading unchanged theme_config, and cannot mutate serviceRequestNotificationRule
      const staffGeneralRes = await patchShopsRoute(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
          },
          body: JSON.stringify({
            id: testShopId,
            theme_config: {
              ...ownerSaveBody.shop.theme_config,
              fontStyle: 'serif',
            },
          }),
        })
      );
      assert.equal(staffGeneralRes.status, 200);
      const staffGeneralBody = (await staffGeneralRes.json()) as {
        shop: { theme_config: ShopThemeConfig };
      };
      assert.equal(staffGeneralBody.shop.theme_config.fontStyle, 'serif');
      assert.equal(
        staffGeneralBody.shop.theme_config.serviceRequestNotificationRule,
        'owner_only'
      );

      // Staff trying to flip owner_only -> all_order_staff alongside fontStyle is rejected with 403
      const staffFlipRes = await patchShopsRoute(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${staffToken}`,
          },
          body: JSON.stringify({
            id: testShopId,
            theme_config: {
              ...staffGeneralBody.shop.theme_config,
              fontStyle: 'playful',
              serviceRequestNotificationRule: 'all_order_staff',
            },
          }),
        })
      );
      assert.equal(staffFlipRes.status, 403);

      // 5. Super Admin can update serviceRequestNotificationRule back to all_order_staff
      const adminSaveRes = await patchShopsRoute(
        new Request('http://localhost/api/shops', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            id: testShopId,
            theme_config: {
              serviceRequestNotificationRule: 'all_order_staff',
            },
          }),
        })
      );
      assert.equal(adminSaveRes.status, 200);
      const adminSaveBody = (await adminSaveRes.json()) as {
        shop: { theme_config: ShopThemeConfig };
      };
      assert.equal(
        adminSaveBody.shop.theme_config.serviceRequestNotificationRule,
        'all_order_staff'
      );
      assert.equal(adminSaveBody.shop.theme_config.fontStyle, 'serif');
      assert.equal(adminSaveBody.shop.theme_config.paymentQr?.bankId, 'VCB');
    } finally {
      setSupabaseDbClientForTests(null);
      setShopMembershipDbClientForTest(null);
      await db.close();
    }
  });

  test('10. GET /api/orders?view=badge enforces shopId and orders.view, returns only new orders and pending service requests without catalog/stats work, and preserves default/KDS contracts', async () => {
    const validSigA1 = signTableQr(SHOP_A, 'tbl-fnb-01');
    const validSigA2 = signTableQr(SHOP_A, 'tbl-fnb-02');
    const validSigA3 = signTableQr(SHOP_A, 'tbl-fnb-03');

    const catalogOnlyStaffId = 'staff-catalog-only-badge-001';
    const catalogOnlyStaffToken = issueSessionToken({
      id: catalogOnlyStaffId,
      email: 'catalog-only-badge@qlaok.vn',
      role: 'staff',
    });
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: catalogOnlyStaffId,
      email: 'catalog-only-badge@qlaok.vn',
      role: 'staff',
      permissions: ['catalog.view'],
      is_active: true,
    });

    // Fail-closed checks: missing shopId -> 400 SHOP_ID_REQUIRED, anonymous -> 401, unauthorized -> 403
    for (const missingUrl of [
      'http://localhost/api/orders?view=badge',
      'http://localhost/api/orders?shopId=%20%20&view=badge',
    ]) {
      const missingShopRes = await getOrdersRoute(
        new Request(missingUrl, {
          headers: { Authorization: `Bearer ${STAFF_A_TOKEN}` },
        })
      );
      assert.equal(missingShopRes.status, 400);
      const missingShopJson = await missingShopRes.json();
      assert.equal(missingShopJson.code, 'SHOP_ID_REQUIRED');
    }

    const anonBadgeRes = await getOrdersRoute(
      new Request(`http://localhost/api/orders?shopId=${SHOP_A}&view=badge`)
    );
    assert.equal(anonBadgeRes.status, 401);

    for (const unauthorizedToken of [
      OWNER_B_TOKEN,
      INACTIVE_STAFF_TOKEN,
      catalogOnlyStaffToken,
    ]) {
      const forbiddenRes = await getOrdersRoute(
        new Request(`http://localhost/api/orders?shopId=${SHOP_A}&view=badge`, {
          headers: { Authorization: `Bearer ${unauthorizedToken}` },
        })
      );
      assert.equal(forbiddenRes.status, 403);
    }

    // Seed orders across statuses ('new', 'preparing', 'completed', 'cancelled') and shops
    const newOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_id: 'tbl-fnb-01',
      table_qr_sig: validSigA1,
      require_table_qr_sig: true,
      source: 'qr_table',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 2,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const preparingOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_id: 'tbl-fnb-02',
      table_qr_sig: validSigA2,
      require_table_qr_sig: true,
      source: 'qr_table',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(preparingOrder.id, { status: 'preparing' });

    const completedOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_id: 'tbl-fnb-03',
      table_qr_sig: validSigA3,
      require_table_qr_sig: true,
      source: 'qr_table',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(completedOrder.id, { status: 'completed' });

    const cancelledOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_label: 'Bàn 04',
      source: 'counter_pos',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(cancelledOrder.id, {
      status: 'cancelled',
      cancelled_reason: 'Khách đổi ý',
    });

    // Seed service requests in pending, acknowledged, and resolved states
    const pendingReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSigA1,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(pendingReqRes.status, 201);
    const { serviceRequest: pendingReq } = await pendingReqRes.json();

    const ackReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-02',
          table_qr_sig: validSigA2,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(ackReqRes.status, 201);
    const { serviceRequest: ackReq } = await ackReqRes.json();
    await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: ackReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );

    const resolvedReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-03',
          table_qr_sig: validSigA3,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(resolvedReqRes.status, 201);
    const { serviceRequest: resolvedReq } = await resolvedReqRes.json();
    await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OWNER_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: resolvedReq.id,
          shop_id: SHOP_A,
          status: 'resolved',
        }),
      })
    );

    // Valid staff and owner requests to view=badge receive only new orders and pending service requests,
    // preserving toast fields and omitting top-level stats and items
    for (const [token, expectedUserId] of [
      [STAFF_A_TOKEN, STAFF_A_ID],
      [OWNER_A_TOKEN, 'owner-demo-001'],
    ] as const) {
      const badgeRes = await getOrdersRoute(
        new Request(`http://localhost/api/orders?shopId=${SHOP_A}&view=badge`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      assert.equal(badgeRes.status, 200);
      const badgeData = await badgeRes.json();

      assert.deepEqual(
        Object.keys(badgeData).sort(),
        ['membership', 'orders', 'serviceRequests'],
        'view=badge must return only { orders, serviceRequests, membership }'
      );
      assert.equal('stats' in badgeData, false, 'view=badge must omit stats');
      assert.equal('items' in badgeData, false, 'view=badge must omit catalog items');
      assert.equal(badgeData.membership?.user_id, expectedUserId);

      assert.ok(
        badgeData.orders.every((o: { status: string; shop_id: string }) =>
          o.status === 'new' && o.shop_id === SHOP_A
        ),
        'view=badge must return only SHOP_A orders with status === "new"'
      );
      assert.deepEqual(
        badgeData.orders.map((o: { id: string }) => o.id),
        ['ord-seed-101', newOrder.id],
        'view=badge must return only orders with status === "new"'
      );
      const returnedNewOrder = badgeData.orders.find(
        (o: { id: string }) => o.id === newOrder.id
      );
      assert.ok(returnedNewOrder);
      assert.equal(returnedNewOrder.id, newOrder.id);
      assert.equal(returnedNewOrder.order_code, newOrder.order_code);
      assert.equal(returnedNewOrder.table_label, newOrder.table_label);
      assert.equal(returnedNewOrder.total_amount, 110000);
      assert.ok(Array.isArray(returnedNewOrder.items));
      assert.equal(returnedNewOrder.items.length, 1);
      assert.equal(returnedNewOrder.items[0].quantity, 2);
      assert.equal(
        returnedNewOrder.items[0].name_vi,
        'Mì Quảng Tôm Thịt Trứng Cút'
      );

      assert.deepEqual(
        badgeData.serviceRequests.map((r: { id: string }) => r.id),
        [pendingReq.id],
        'view=badge must return only pending service requests'
      );
    }

    // Prove view=badge returns before any call to dbGetShopCatalog or dbComputeShopRevenueAndInventoryStats
    const queriedTables: string[] = [];
    const calledRpcs: string[] = [];
    setSupabaseDbClientForTests({
      from(table: string) {
        queriedTables.push(table);
        if (table === 'categories' || table === 'items') {
          throw new Error(`UNEXPECTED_CATALOG_QUERY_${table}`);
        }
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return Promise.resolve({ data: [], error: null });
                  },
                  limit() {
                    return Promise.resolve({ data: [], error: null });
                  },
                  maybeSingle() {
                    return Promise.resolve({ data: null, error: null });
                  },
                };
              },
              order() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      },
      rpc(fnName: string) {
        calledRpcs.push(fnName);
        if (fnName === 'get_shop_order_stats_summary') {
          throw new Error('UNEXPECTED_STATS_RPC');
        }
        return Promise.resolve({ data: null, error: null });
      },
    });
    try {
      const noCatalogBadgeRes = await getOrdersRoute(
        new Request(`http://localhost/api/orders?shopId=${SHOP_A}&view=badge`, {
          headers: { Authorization: `Bearer ${STAFF_A_TOKEN}` },
        })
      );
      assert.equal(noCatalogBadgeRes.status, 200);
      assert.equal(
        queriedTables.includes('categories') || queriedTables.includes('items'),
        false,
        'view=badge must return before calling dbGetShopCatalog (categories/items)'
      );
      assert.equal(
        calledRpcs.includes('get_shop_order_stats_summary'),
        false,
        'view=badge must return before calling dbComputeShopRevenueAndInventoryStats'
      );
    } finally {
      setSupabaseDbClientForTests(null);
    }

    // Default and KDS endpoints preserve their existing contracts
    const defaultRes = await getOrdersRoute(
      new Request(`http://localhost/api/orders?shopId=${SHOP_A}`, {
        headers: { Authorization: `Bearer ${OWNER_A_TOKEN}` },
      })
    );
    assert.equal(defaultRes.status, 200);
    const defaultData = await defaultRes.json();
    assert.equal('stats' in defaultData, true);
    assert.equal(Array.isArray(defaultData.items), true);
    assert.deepEqual(
      defaultData.serviceRequests.map((r: { id: string }) => r.id).sort(),
      [pendingReq.id, ackReq.id].sort(),
      'default GET /api/orders continues returning pending and acknowledged service requests'
    );

    const kdsRes = await getOrdersRoute(
      new Request(`http://localhost/api/orders?shopId=${SHOP_A}&view=kds`, {
        headers: { Authorization: `Bearer ${STAFF_A_TOKEN}` },
      })
    );
    assert.equal(kdsRes.status, 200);
    const kdsData = await kdsRes.json();
    assert.deepEqual(
      Object.keys(kdsData).sort(),
      ['membership', 'orders'],
      'view=kds contract remains { orders, membership }'
    );
    assert.deepEqual(
      kdsData.orders.map((o: { id: string }) => o.id),
      ['ord-seed-102', 'ord-seed-101', newOrder.id, preparingOrder.id]
    );

    // DashboardShell checkLiveOrders polls with view=badge
    const layoutSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(dashboard)/dashboard/layout.tsx'),
      'utf8'
    );
    assert.match(
      layoutSource,
      /\/api\/orders\?shopId=\$\{encodeURIComponent\(shopId\)\}&view=badge/
    );
  });

  test('11. GET /api/orders includeCatalog=0 and includeStats=0 opt-outs preserve auth, orders, serviceRequests, and membership while skipping catalog/stats helpers on silent refresh', async () => {
    const validSigA1 = signTableQr(SHOP_A, 'tbl-fnb-01');
    const validSigA2 = signTableQr(SHOP_A, 'tbl-fnb-02');

    const catalogOnlyStaffId = 'staff-catalog-only-silent-001';
    const catalogOnlyStaffToken = issueSessionToken({
      id: catalogOnlyStaffId,
      email: 'catalog-only-silent@qlaok.vn',
      role: 'staff',
    });
    await dbUpsertShopMembership({
      shop_id: SHOP_A,
      user_id: catalogOnlyStaffId,
      email: 'catalog-only-silent@qlaok.vn',
      role: 'staff',
      permissions: ['catalog.view'],
      is_active: true,
    });

    // 1. Permission checks remain intact on the lightweight silent-refresh path
    const anonSilentRes = await getOrdersRoute(
      new Request(
        `http://localhost/api/orders?shopId=${SHOP_A}&includeCatalog=0&includeStats=0`
      )
    );
    assert.equal(anonSilentRes.status, 401);

    for (const unauthorizedToken of [
      OWNER_B_TOKEN,
      INACTIVE_STAFF_TOKEN,
      catalogOnlyStaffToken,
    ]) {
      const forbiddenRes = await getOrdersRoute(
        new Request(
          `http://localhost/api/orders?shopId=${SHOP_A}&includeCatalog=0&includeStats=0`,
          {
            headers: { Authorization: `Bearer ${unauthorizedToken}` },
          }
        )
      );
      assert.equal(forbiddenRes.status, 403);
    }

    // 2. Seed orders and service requests; verify default vs silent-refresh response parity for owner and staff
    const newOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_id: 'tbl-fnb-01',
      table_qr_sig: validSigA1,
      require_table_qr_sig: true,
      source: 'qr_table',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    const cancelledOrder = await dbCreateOrder({
      shop_id: SHOP_A,
      table_label: 'Bàn 02',
      source: 'counter_pos',
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-fnb-2',
          name_vi: 'Mì Quảng Tôm Thịt Trứng Cút',
          quantity: 1,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(cancelledOrder.id, {
      status: 'cancelled',
      cancelled_reason: 'Khách hủy',
    });

    const pendingReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-01',
          table_qr_sig: validSigA1,
          request_type: 'call_staff',
        }),
      })
    );
    assert.equal(pendingReqRes.status, 201);

    const ackReqRes = await postServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: SHOP_A,
          table_id: 'tbl-fnb-02',
          table_qr_sig: validSigA2,
          request_type: 'request_bill',
        }),
      })
    );
    assert.equal(ackReqRes.status, 201);
    const { serviceRequest: ackReq } = await ackReqRes.json();
    await patchServiceRequestsRoute(
      new Request('http://localhost/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STAFF_A_TOKEN}`,
        },
        body: JSON.stringify({
          id: ackReq.id,
          shop_id: SHOP_A,
          status: 'acknowledged',
        }),
      })
    );

    for (const token of [OWNER_A_TOKEN, STAFF_A_TOKEN] as const) {
      const defaultRes = await getOrdersRoute(
        new Request(`http://localhost/api/orders?shopId=${SHOP_A}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      assert.equal(defaultRes.status, 200);
      const defaultData = await defaultRes.json();
      assert.deepEqual(
        Object.keys(defaultData).sort(),
        ['items', 'membership', 'orders', 'serviceRequests', 'stats']
      );
      assert.equal(Array.isArray(defaultData.items), true);
      assert.equal(typeof defaultData.stats, 'object');
      assert.ok(defaultData.orders.some((o: { id: string }) => o.id === newOrder.id));

      for (const querySuffix of [
        'includeCatalog=0&includeStats=0',
        'includeCatalog=false&includeStats=false',
      ]) {
        const silentRes = await getOrdersRoute(
          new Request(
            `http://localhost/api/orders?shopId=${SHOP_A}&${querySuffix}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          )
        );
        assert.equal(silentRes.status, 200);
        const silentData = await silentRes.json();

        assert.deepEqual(
          Object.keys(silentData).sort(),
          ['membership', 'orders', 'serviceRequests'],
          `GET /api/orders with ${querySuffix} must omit items and stats`
        );
        assert.equal('items' in silentData, false);
        assert.equal('stats' in silentData, false);
        assert.deepEqual(silentData.orders, defaultData.orders);
        assert.deepEqual(
          silentData.serviceRequests,
          defaultData.serviceRequests
        );
        const {
          created_at: _sc,
          updated_at: _su,
          ...silentMembershipRest
        } = silentData.membership || {};
        const {
          created_at: _dc,
          updated_at: _du,
          ...defaultMembershipRest
        } = defaultData.membership || {};
        assert.deepEqual(silentMembershipRest, defaultMembershipRest);
      }
    }

    // 3. Prove helper execution: called by default, skipped when disabled (both together and independently)
    const queriedTables: string[] = [];
    const calledRpcs: string[] = [];
    const mockDbClient = {
      from(table: string) {
        queriedTables.push(table);
        const makeResult = () => {
          if (table === 'shops') {
            return {
              data: [
                {
                  id: SHOP_A,
                  owner_id: 'owner-demo-001',
                  name: 'Phở Hội An',
                },
              ],
              error: null,
            };
          }
          if (table === 'items') {
            return {
              data: [
                {
                  id: 'item-fnb-2',
                  shop_id: SHOP_A,
                  category_id: 'cat-fnb-1',
                  name_i18n: { vi: 'Mì Quảng Tôm Thịt Trứng Cút' },
                  price: 55000,
                  is_available: true,
                  stock_quantity: 10,
                  sold_count: 5,
                },
              ],
              error: null,
            };
          }
          if (table === 'profiles') {
            return {
              data: [
                {
                  id: 'owner-demo-001',
                  email: 'chuquan@qlaok.vn',
                  role: 'owner',
                  plan: 'free',
                },
              ],
              error: null,
            };
          }
          return { data: [], error: null };
        };
        const makeSingleResult = () => {
          if (table === 'shops') {
            return {
              data: {
                id: SHOP_A,
                owner_id: 'owner-demo-001',
                name: 'Phở Hội An',
              },
              error: null,
            };
          }
          if (table === 'profiles') {
            return { data: { plan: 'free' }, error: null };
          }
          return { data: null, error: null };
        };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve(makeSingleResult()),
          single: () => Promise.resolve(makeSingleResult()),
          then: (
            resolve: (val: unknown) => unknown,
            reject?: (err: unknown) => unknown
          ) => Promise.resolve(makeResult()).then(resolve, reject),
        };
        return chain;
      },
      rpc(fnName: string) {
        calledRpcs.push(fnName);
        return Promise.resolve({
          data: {
            total_orders_count: 1,
            completed_orders_count: 0,
            paid_orders_count: 0,
            new_orders_count: 1,
            preparing_orders_count: 0,
            total_revenue: 0,
            total_refunded_amount: 0,
            today_orders_count: 1,
            today_paid_orders_count: 0,
            today_completed_count: 0,
            today_revenue: 0,
            today_gross_order_amount: 55000,
            today_unpaid_amount: 55000,
            today_refunded_amount: 0,
            daily_revenue_7d: [],
            payment_breakdown: { cash: 0, vietqr: 0 },
            source_breakdown: { qr_table: 1, counter_pos: 0 },
            hourly_breakdown: [],
            sold_items: [],
          },
          error: null,
        });
      },
    };

    setSupabaseDbClientForTests(mockDbClient);
    setMposDbClientForTests(mockDbClient, true);
    try {
      // 3a. Default call invokes both dbGetShopCatalog and dbComputeShopRevenueAndInventoryStats
      queriedTables.length = 0;
      calledRpcs.length = 0;
      const defaultWithMockRes = await getOrdersRoute(
        new Request(`http://localhost/api/orders?shopId=${SHOP_A}`, {
          headers: { Authorization: `Bearer ${OWNER_A_TOKEN}` },
        })
      );
      assert.equal(defaultWithMockRes.status, 200);
      const defaultWithMockData = await defaultWithMockRes.json();
      assert.equal(
        queriedTables.includes('categories') && queriedTables.includes('items'),
        true,
        'default GET /api/orders must call dbGetShopCatalog (categories/items)'
      );
      assert.equal(
        calledRpcs.includes('get_shop_order_stats_summary'),
        true,
        'default GET /api/orders must call dbComputeShopRevenueAndInventoryStats'
      );
      assert.equal(Array.isArray(defaultWithMockData.items), true);
      assert.equal('stats' in defaultWithMockData, true);

      // 3b. Both disabled (includeCatalog=0&includeStats=0) skips both helpers
      queriedTables.length = 0;
      calledRpcs.length = 0;
      const bothDisabledRes = await getOrdersRoute(
        new Request(
          `http://localhost/api/orders?shopId=${SHOP_A}&includeCatalog=0&includeStats=0`,
          {
            headers: { Authorization: `Bearer ${OWNER_A_TOKEN}` },
          }
        )
      );
      assert.equal(bothDisabledRes.status, 200);
      const bothDisabledData = await bothDisabledRes.json();
      assert.equal(
        queriedTables.includes('categories') || queriedTables.includes('items'),
        false,
        'includeCatalog=0&includeStats=0 must not call dbGetShopCatalog'
      );
      assert.equal(
        calledRpcs.includes('get_shop_order_stats_summary'),
        false,
        'includeCatalog=0&includeStats=0 must not call dbComputeShopRevenueAndInventoryStats'
      );
      assert.equal('items' in bothDisabledData, false);
      assert.equal('stats' in bothDisabledData, false);

      // 3c. Independent includeCatalog=0 loads catalog for stats computation, returns identical stats, but omits items from response
      queriedTables.length = 0;
      calledRpcs.length = 0;
      const noCatalogOnlyRes = await getOrdersRoute(
        new Request(
          `http://localhost/api/orders?shopId=${SHOP_A}&includeCatalog=0`,
          {
            headers: { Authorization: `Bearer ${OWNER_A_TOKEN}` },
          }
        )
      );
      assert.equal(noCatalogOnlyRes.status, 200);
      const noCatalogOnlyData = await noCatalogOnlyRes.json();
      assert.equal(
        queriedTables.includes('categories') && queriedTables.includes('items'),
        true,
        'includeCatalog=0 with stats enabled must still call dbGetShopCatalog for accurate stats'
      );
      assert.equal(
        calledRpcs.includes('get_shop_order_stats_summary'),
        true,
        'includeCatalog=0 alone must still call dbComputeShopRevenueAndInventoryStats'
      );
      assert.equal('items' in noCatalogOnlyData, false);
      assert.equal('stats' in noCatalogOnlyData, true);
      assert.deepEqual(
        noCatalogOnlyData.stats,
        defaultWithMockData.stats,
        'includeCatalog=0 must preserve equivalent stats to default response'
      );
      assert.deepEqual(
        Object.keys(noCatalogOnlyData).sort(),
        ['membership', 'orders', 'serviceRequests', 'stats'],
        'only the items response field must be omitted when includeCatalog=0'
      );

      // 3d. Independent includeStats=0 skips stats only and still loads catalog
      queriedTables.length = 0;
      calledRpcs.length = 0;
      const noStatsOnlyRes = await getOrdersRoute(
        new Request(
          `http://localhost/api/orders?shopId=${SHOP_A}&includeStats=0`,
          {
            headers: { Authorization: `Bearer ${OWNER_A_TOKEN}` },
          }
        )
      );
      assert.equal(noStatsOnlyRes.status, 200);
      const noStatsOnlyData = await noStatsOnlyRes.json();
      assert.equal(
        queriedTables.includes('categories') && queriedTables.includes('items'),
        true,
        'includeStats=0 alone must still call dbGetShopCatalog'
      );
      assert.equal(
        calledRpcs.includes('get_shop_order_stats_summary'),
        false,
        'includeStats=0 must not call dbComputeShopRevenueAndInventoryStats'
      );
      assert.equal(Array.isArray(noStatsOnlyData.items), true);
      assert.equal('stats' in noStatsOnlyData, false);
    } finally {
      setMposDbClientForTests(null, false);
      setSupabaseDbClientForTests(null);
      await dbDeleteShopMembership(SHOP_A, catalogOnlyStaffId).catch(() => {});
    }

    // 4. Dashboard orders page fetchOrdersAndCatalog sends includeCatalog=0&includeStats=0 on silent refresh and keeps full initial load
    const ordersPageSource = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/app/(dashboard)/dashboard/orders/page.tsx'
      ),
      'utf8'
    );
    assert.match(
      ordersPageSource,
      /\/api\/orders\?shopId=\$\{encodeURIComponent\(activeShop\.id\)\}&includeCatalog=0&includeStats=0/
    );
    assert.match(
      ordersPageSource,
      /\/api\/orders\?shopId=\$\{encodeURIComponent\(activeShop\.id\)\}`/
    );
  });
});
