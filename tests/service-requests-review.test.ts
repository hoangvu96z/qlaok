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
  ALL_LOCALES,
  checkShopOpenStatus,
  getTableServiceRequestLabels,
  TABLE_SERVICE_REQUEST_LABELS,
} from '../src/lib/i18n-helper';
import {
  dbCreateOrder,
  dbGetOrderById,
  resetMposStoreForTests,
} from '../src/lib/mpos-store';
import {
  getOrderEventsBroker,
  OrderEventsBroker,
  type OrderSseEvent,
  type PostgresOrderChangePayload,
  type RealtimeChannelLike,
  type RealtimeClientLike,
  resetOrderEventsBrokerForTests,
} from '../src/lib/order-events';
import {
  dbUpsertMobilePushToken,
  resetPushNotificationStateForTests,
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

    // 4. Verify upstream postgres_changes on table_service_requests routes only to matching shop
    let upstreamCallback: ((payload: PostgresOrderChangePayload) => void) | null =
      null;
    const customBroker = new OrderEventsBroker({
      createClient: () => {
        const channel: RealtimeChannelLike = {
          on(_type, filter, cb) {
            if (filter.table === 'table_service_requests') {
              upstreamCallback = cb;
            }
            return channel;
          },
          subscribe(cb) {
            cb?.('SUBSCRIBED');
            return channel;
          },
        };
        const client: RealtimeClientLike = {
          channel: () => channel,
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
    (upstreamCallback as (payload: PostgresOrderChangePayload) => void)({
      table: 'table_service_requests',
      eventType: 'INSERT',
      new: {
        id: 'srv-upstream-01',
        shop_id: SHOP_A,
        table_id: 'tbl-fnb-01',
        request_type: 'call_staff',
        status: 'pending',
      },
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
});
