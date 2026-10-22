import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStorefrontTableQueryKey,
  buildTableMenuUrl,
  createScopedTableQrVerification,
  filterSelectableTables,
  resolveScopedTableQrVerification,
  resolveStorefrontMenuTableState,
  resolveTableSelection,
} from '@/lib/table-helpers';
import type { ShopTable } from '@/types/qlaok';

const table = (id: string, shop: string, sort: number, extra: Partial<ShopTable> = {}): ShopTable => ({
  id, shop_id: shop, table_code: id, name: id, section: '', capacity: 4,
  sort_order: sort, is_active: true, is_archived: false, ...extra,
});

test('selectable tables exclude other shops, archived and inactive records without mutating input', () => {
  const rows = [
    table('T02', 'shop-a', 2), table('T01', 'shop-a', 1),
    table('foreign', 'shop-b', 0), table('inactive', 'shop-a', 0, { is_active: false }),
    table('archived', 'shop-a', 0, { is_archived: true }),
  ];
  const originalOrder = rows.map(row => row.id);
  assert.deepEqual(filterSelectableTables(rows, 'shop-a').map(row => row.id), ['T01', 'T02']);
  assert.deepEqual(rows.map(row => row.id), originalOrder);
  assert.deepEqual(filterSelectableTables(undefined, 'shop-a'), []);
});

test('table QR URL round-trips reserved characters and selection uses stable ID before legacy labels', () => {
  const selected = table('id?&=/#', 'shop-a', 1, { table_code: 'T01', name: 'Bàn cửa sổ' });
  const url = new URL(buildTableMenuUrl('https://fixture.example/', 'quán có dấu', selected.id));
  assert.equal(decodeURIComponent(url.pathname), '/s/quán có dấu/menu');
  assert.equal(url.searchParams.get('tableId'), selected.id);
  assert.equal(url.searchParams.get('src'), 'table');
  assert.equal(resolveTableSelection([selected], { tableId: selected.id, table: 'unknown' }).table?.id, selected.id);
  assert.ok(resolveTableSelection([selected], { tableId: 'invalid', table: 'T01' }).error);
  assert.equal(resolveTableSelection([selected], { table: ' bàn cửa sổ ' }).table?.id, selected.id);
  assert.equal(
    resolveTableSelection([selected], { tableId: selected.id, sig: null, requireSig: true }).table,
    null,
    'unsigned tableId must not lock the storefront menu when requireSig is true'
  );
  assert.ok(
    resolveTableSelection([selected], { tableId: selected.id, sig: null, requireSig: true }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'tampered',
      requireSig: true,
      sigVerified: false,
    }).table,
    null,
    'unverified sig must not lock the storefront menu'
  );
  assert.equal(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'tampered',
      requireSig: true,
      sigVerified: null,
    }).table,
    null,
    'non-empty tampered sig with sigVerified null must not select tableId while verification is pending/absent'
  );
  assert.ok(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'tampered',
      requireSig: true,
      sigVerified: null,
    }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'tampered',
      requireSig: true,
      sigVerified: undefined,
    }).table,
    null,
    'non-empty tampered sig with sigVerified undefined must not select tableId'
  );
  assert.ok(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'tampered',
      requireSig: true,
      sigVerified: undefined,
    }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      table: 'T01',
      sig: null,
      requireSig: true,
    }).table,
    null,
    'unsigned legacy ?table= must not select a table when requireSig is true'
  );
  assert.ok(
    resolveTableSelection([selected], {
      table: 'T01',
      sig: null,
      requireSig: true,
    }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      table: 'T01',
      sig: 'tampered',
      requireSig: true,
      sigVerified: false,
    }).table,
    null,
    'legacy ?table= with sigVerified false must be rejected'
  );
  assert.equal(
    resolveTableSelection([selected], {
      table: 'T01',
      sig: 'tampered',
      requireSig: true,
      sigVerified: null,
    }).table,
    null,
    'legacy ?table= with non-empty tampered sig and sigVerified null must recover to warning/takeaway instead of selecting table'
  );
  assert.ok(
    resolveTableSelection([selected], {
      table: 'T01',
      sig: 'tampered',
      requireSig: true,
      sigVerified: null,
    }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      table: 'Bàn cửa sổ',
      sig: 'tampered',
      requireSig: true,
      sigVerified: undefined,
    }).table,
    null,
    'legacy ?table= with non-empty tampered sig and sigVerified undefined must recover to warning/takeaway instead of selecting table'
  );
  assert.ok(
    resolveTableSelection([selected], {
      table: 'Bàn cửa sổ',
      sig: 'tampered',
      requireSig: true,
      sigVerified: undefined,
    }).error
  );
  assert.equal(
    resolveTableSelection([selected], {
      tableId: selected.id,
      sig: 'valid-hmac',
      requireSig: true,
      sigVerified: true,
    }).table?.id,
    selected.id
  );
  assert.deepEqual(
    resolveTableSelection([selected], { requireSig: true }),
    { table: null, error: null },
    'unsigned generic door/menu entry without tableId or table remains error-free'
  );
});

test('scoped table QR verification prevents stale or in-flight results from locking another tableId/sig on query changes', () => {
  const table1 = table('table-1', 'shop-a', 1, {
    table_code: 'T01',
    name: 'Bàn 01',
  });
  const table2 = table('table-2', 'shop-a', 2, {
    table_code: 'T02',
    name: 'Bàn 02',
  });
  const tables = [table1, table2];

  // 1. Initial verified QR for table-1 + sig-1 locks table-1
  const verifiedTable1 = createScopedTableQrVerification({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tableId: 'table-1',
    sig: 'sig-1',
    tableQrVerified: true,
    activeSlug: 'pho-hoi-an',
    activeTableId: 'table-1',
    activeSig: 'sig-1',
  });
  assert.ok(verifiedTable1);

  const initialLocked = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-1',
    qrTableSigParam: 'sig-1',
    verification: verifiedTable1,
  });
  assert.equal(initialLocked.tableQrVerified, true);
  assert.equal(initialLocked.lockedTable?.id, 'table-1');
  assert.equal(initialLocked.selectedTableId, 'table-1');
  assert.equal(initialLocked.error, null);

  // 2. Same slug, query changes to table-2 + tampered-sig while verifiedTable1 is still in state:
  // must NOT lock table-2 or table-1 using the old verification result
  const afterSwitchToTamperedTable2 = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-2',
    qrTableSigParam: 'tampered-sig',
    verification: verifiedTable1,
  });
  assert.equal(afterSwitchToTamperedTable2.tableQrVerified, null);
  assert.equal(afterSwitchToTamperedTable2.lockedTable, null);
  assert.equal(afterSwitchToTamperedTable2.selectedTable, null);
  assert.equal(afterSwitchToTamperedTable2.selectedTableId, null);
  assert.ok(afterSwitchToTamperedTable2.error);

  // 3. Same slug + same table-1, query changes sig from sig-1 to tampered-sig:
  // must NOT stay locked using the old sig-1 verification
  const afterSwitchToTamperedSigOnSameTable = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-1',
    qrTableSigParam: 'tampered-sig',
    verification: verifiedTable1,
  });
  assert.equal(afterSwitchToTamperedSigOnSameTable.tableQrVerified, null);
  assert.equal(afterSwitchToTamperedSigOnSameTable.lockedTable, null);
  assert.equal(afterSwitchToTamperedSigOnSameTable.selectedTable, null);
  assert.ok(afterSwitchToTamperedSigOnSameTable.error);

  // 4. Same slug, query changes to table-2 + valid sig-2 while verification request for table-2 is still in flight:
  // must remain unlocked until the response scoped to table-2 + sig-2 arrives
  const whileTable2InFlight = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-2',
    qrTableSigParam: 'sig-2',
    verification: verifiedTable1,
  });
  assert.equal(whileTable2InFlight.tableQrVerified, null);
  assert.equal(whileTable2InFlight.lockedTable, null);
  assert.equal(whileTable2InFlight.selectedTable, null);

  // 5. Late/in-flight old response for table-1 + sig-1 arriving after URL already changed to table-2 + sig-2 is dropped
  const lateStaleResponse = createScopedTableQrVerification({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tableId: 'table-1',
    sig: 'sig-1',
    tableQrVerified: true,
    activeSlug: 'pho-hoi-an',
    activeTableId: 'table-2',
    activeSig: 'sig-2',
  });
  assert.equal(lateStaleResponse, null);

  // 6. Once the verification scoped to table-2 + sig-2 arrives, table-2 locks cleanly
  const verifiedTable2 = createScopedTableQrVerification({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tableId: 'table-2',
    sig: 'sig-2',
    tableQrVerified: true,
    activeSlug: 'pho-hoi-an',
    activeTableId: 'table-2',
    activeSig: 'sig-2',
  });
  const afterTable2Verified = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-2',
    qrTableSigParam: 'sig-2',
    verification: verifiedTable2,
  });
  assert.equal(afterTable2Verified.tableQrVerified, true);
  assert.equal(afterTable2Verified.lockedTable?.id, 'table-2');
  assert.equal(afterTable2Verified.selectedTableId, 'table-2');
  assert.equal(afterTable2Verified.error, null);

  // 7. Cross-shop / cross-slug isolation: verification for shop-a cannot lock a table on another slug or shopId
  assert.equal(
    resolveScopedTableQrVerification(verifiedTable2, {
      shopSlug: 'other-shop',
      shopId: 'shop-a',
      tableId: 'table-2',
      sig: 'sig-2',
    }),
    null
  );
  assert.equal(
    resolveScopedTableQrVerification(verifiedTable2, {
      shopSlug: 'pho-hoi-an',
      shopId: 'shop-b',
      tableId: 'table-2',
      sig: 'sig-2',
    }),
    null
  );

  // 8. Generic/door entry and takeaway behavior remain intact, and switching QR URLs does not carry over an old takeaway dismissal to mask a broken QR
  const doorState = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    verification: verifiedTable2,
  });
  assert.equal(doorState.lockedTable, null);
  assert.equal(doorState.selectedTable, null);
  assert.equal(doorState.isTakeawaySelected, false);
  assert.equal(doorState.error, null);

  const brokenQr1Key = buildStorefrontTableQueryKey({
    shopSlug: 'pho-hoi-an',
    tableId: 'table-1',
    sig: 'bad-1',
  });
  const takeawayOnBrokenQr1 = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-1',
    qrTableSigParam: 'bad-1',
    verification: null,
    userTableChoice: {
      shopSlug: 'pho-hoi-an',
      tableQueryKey: brokenQr1Key,
      tableId: null,
      tableLabel: 'Mang về',
      isTakeaway: true,
    },
  });
  assert.equal(takeawayOnBrokenQr1.isTakeawaySelected, true);
  assert.equal(takeawayOnBrokenQr1.error, null);

  const switchedToBrokenQr2 = resolveStorefrontMenuTableState({
    shopSlug: 'pho-hoi-an',
    shopId: 'shop-a',
    tables,
    qrTableIdParam: 'table-2',
    qrTableSigParam: 'bad-2',
    verification: null,
    userTableChoice: {
      shopSlug: 'pho-hoi-an',
      tableQueryKey: brokenQr1Key,
      tableId: null,
      tableLabel: 'Mang về',
      isTakeaway: true,
    },
  });
  assert.equal(switchedToBrokenQr2.isTakeawaySelected, false);
  assert.equal(switchedToBrokenQr2.lockedTable, null);
  assert.ok(switchedToBrokenQr2.error);
});
