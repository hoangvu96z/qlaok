import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Run against an isolated local fixture, never credentials from a developer shell.
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
const originalCwd = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-api-review-'));
process.chdir(fixture);
after(() => { process.chdir(originalCwd); fs.rmSync(fixture, { recursive: true, force: true }); });
const { issueSessionToken } = await import('@/lib/server-auth');
const { dbUpsertShopMembership } = await import('@/lib/shop-permissions');
const { GET: analyticsGet } = await import('@/app/api/analytics/track/route');
const { GET: shopsGet, POST: shopsPost, PATCH: shopsPatch } = await import('@/app/api/shops/route');
const { POST: ordersPost, PATCH: ordersPatch, GET: ordersGet } = await import('@/app/api/orders/route');
const { GET: tablesGet, POST: tablesPost, PATCH: tablesPatch, DELETE: tablesDelete } = await import('@/app/api/tables/route');
const { dbCreateOrder } = await import('@/lib/mpos-store');
const { escapeHtml } = await import('@/lib/escape-html');

function request(path: string, token: string | null, body: unknown, method = 'PATCH') {
  return new Request(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
}
const token = issueSessionToken({ id: 'review-settings-staff', email: 'review@example.test' });
const ownerToken = issueSessionToken({ id: 'owner-demo-001', email: 'chuquan@qlaok.vn', role: 'owner' });
await dbUpsertShopMembership({ shop_id: 'shop-fnb-001', user_id: 'review-settings-staff', role: 'staff',
  permissions: ['settings.manage', 'members.manage', 'payment.collect', 'orders.view'] });

test('anonymous analytics cannot bypass report authorization by omitting token', async () => {
  const response = await analyticsGet(new Request('http://localhost/api/analytics/track?shopId=shop-fnb-001'));
  assert.equal(response.status, 401);
});

for (const bankKey of ['paymentQr', 'paymentConfig']) {
  test(`settings.manage does not authorize bank changes through ${bankKey}`, async () => {
    const response = await shopsPatch(request('/api/shops', token, { id: 'shop-fnb-001',
      theme_config: { [bankKey]: { accountNumber: 'attacker-account' } } }));
    assert.equal(response.status, 403);
  });
}

test('appearance edits do not bypass promotion permission', async () => {
  const response = await shopsPatch(request('/api/shops', token, { id: 'shop-fnb-001', theme_config: {
    primaryColor: '#123456', promoBanner: { enabled: true, title: 'sale', discountValue: 100 },
  } }));
  assert.equal(response.status, 403);
});

test('delegated members.manage cannot promote the caller to owner', async () => {
  const response = await shopsPost(request('/api/shops', token, { action: 'upsert_member',
    shop_id: 'shop-fnb-001', user_id: 'review-settings-staff', role: 'owner' }, 'POST'));
  assert.equal(response.status, 403);
});

test('combined payment and fulfillment patches require both permissions', async () => {
  const order = await dbCreateOrder({ shop_id: 'shop-fnb-001', table_label: 'review', items: [{
    item_id: 'unit-test-item-review', name_vi: 'fixture', quantity: 1, unit_price: 10000, extra_price: 0, selected_choices: [],
  }] });
  const response = await ordersPatch(request('/api/orders', token, {
    orderId: order.id, payment_status: 'paid', status: 'completed',
  }));
  assert.equal(response.status, 403);
});

test('order tracking requires a token even for legacy orders', async () => {
  const response = await ordersGet(new Request('http://localhost/api/orders?orderId=ord-seed-101'));
  assert.equal(response.status, 403);
});

test('unknown ticket types are rejected before a print counter mutation', async () => {
  const response = await ordersPost(request('/api/orders', token, {
    action: 'record_print', orderId: 'ord-seed-101', ticketType: 'arbitrary',
  }, 'POST'));
  assert.equal(response.status, 400);
});

test('receipt text escapes user-controlled markup and quoted attributes', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("A&B's"), 'A&amp;B&#39;s');
});


test('checkout rejects stale displayed totals before creating or collecting payment', async () => {
  const response = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001', expected_total: 1,
    items: [{ item_id: 'item-fnb-1', name_vi: 'Phở', quantity: 1, unit_price: 1, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(response.status, 409);
});

test('/api/tables enforces owner-only mutations, archive-only DELETE guard, and safe public vs management reads', async () => {
  // Anonymous management read must be 401
  const anonMgmtRes = await tablesGet(new Request('http://localhost/api/tables?shopId=shop-fnb-001&includeInactive=1'));
  assert.equal(anonMgmtRes.status, 401);

  // Staff with settings.manage / members.manage cannot create or mutate tables (403)
  const staffCreateRes = await tablesPost(request('/api/tables', token, {
    shop_id: 'shop-fnb-001', name: 'Bàn Staff', table_code: 'T-STAFF',
  }, 'POST'));
  assert.equal(staffCreateRes.status, 403);

  // DELETE is rejected with 405 (archive instead)
  const deleteRes = await tablesDelete();
  assert.equal(deleteRes.status, 405);

  // Owner can create a table, duplicate active name returns 409, cross-shop PATCH returns 403
  const ownerCreateRes = await tablesPost(request('/api/tables', ownerToken, {
    shop_id: 'shop-fnb-001', name: 'Bàn Sân Thượng 1', table_code: 'ROOF-1', section: 'Sân thượng', capacity: 6,
  }, 'POST'));
  assert.equal(ownerCreateRes.status, 201);
  const { table: createdTable } = await ownerCreateRes.json();
  assert.equal(createdTable.name, 'Bàn Sân Thượng 1');
  assert.equal(createdTable.table_code, 'ROOF-1');

  const dupNameRes = await tablesPost(request('/api/tables', ownerToken, {
    shop_id: 'shop-fnb-001', name: 'bàn sân thượng 1', table_code: 'ROOF-2',
  }, 'POST'));
  assert.equal(dupNameRes.status, 409);

  const crossShopPatchRes = await tablesPatch(request('/api/tables', ownerToken, {
    id: createdTable.id, shop_id: 'shop-service-002', name: 'Hijack Shop',
  }, 'PATCH'));
  assert.equal(crossShopPatchRes.status, 403);
});

test('/api/orders and /api/shops enforce table_id canonical snapshot, guest PATCH preservation, and name-reuse settlement isolation', async () => {
  // Create a dedicated active table for order lifecycle test
  const createRes = await tablesPost(request('/api/tables', ownerToken, {
    shop_id: 'shop-fnb-001', name: 'Bàn VIP 88', table_code: 'VIP-88',
  }, 'POST'));
  assert.equal(createRes.status, 201);
  const { table: vipTable } = await createRes.json();

  // Storefront bundle includes active unarchived tables
  const bundleRes = await shopsGet(new Request('http://localhost/api/shops?slug=pho-hoi-an'));
  assert.equal(bundleRes.status, 200);
  const bundle = await bundleRes.json();
  assert.ok(Array.isArray(bundle.tables));
  assert.ok(bundle.tables.some((t: { id: string }) => t.id === vipTable.id));

  // Guest creates order with table_id and spoofed table_label -> server snapshots canonical 'Bàn VIP 88'
  const orderCreateRes = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001',
    table_id: vipTable.id,
    table_label: 'Spoofed Label',
    items: [{ item_id: 'item-fnb-2', name_vi: 'Phở Tái', quantity: 1, unit_price: 55000, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(orderCreateRes.status, 201);
  const { order: createdOrder } = await orderCreateRes.json();
  assert.equal(createdOrder.table_id, vipTable.id);
  assert.equal(createdOrder.table_label, 'Bàn VIP 88');

  // Cross-shop table_id is rejected on POST /api/orders
  const crossShopOrderRes = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001',
    table_id: 'tbl-service2-01',
    items: [{ item_id: 'item-fnb-2', name_vi: 'Phở Tái', quantity: 1, unit_price: 55000, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(crossShopOrderRes.status, 400);

  // Owner renames 'Bàn VIP 88' -> 'Bàn VIP 88 (Mới)'
  const renameRes = await tablesPatch(request('/api/tables', ownerToken, {
    id: vipTable.id, name: 'Bàn VIP 88 (Mới)',
  }, 'PATCH'));
  assert.equal(renameRes.status, 200);

  // Guest edits order items via trackingToken -> historical table_label ('Bàn VIP 88') and table_id are preserved
  const guestEditRes = await ordersPatch(request('/api/orders', null, {
    orderId: createdOrder.id,
    trackingToken: createdOrder.tracking_token,
    customer_note: 'Thêm hành',
    items: [{ item_id: 'item-fnb-2', name_vi: 'Phở Tái', quantity: 2, unit_price: 55000, extra_price: 0, selected_choices: [] }],
  }, 'PATCH'));
  assert.equal(guestEditRes.status, 200);
  const { order: editedOrder } = await guestEditRes.json();
  assert.equal(editedOrder.table_id, vipTable.id);
  assert.equal(editedOrder.table_label, 'Bàn VIP 88');

  // Guest attempting to switch order to cross-shop table via PATCH is rejected with 400
  const guestCrossShopPatch = await ordersPatch(request('/api/orders', null, {
    orderId: createdOrder.id,
    trackingToken: createdOrder.tracking_token,
    table_id: 'tbl-service2-01',
  }, 'PATCH'));
  assert.equal(guestCrossShopPatch.status, 400);

  // Owner archives vipTable, then creates a new table reusing 'Bàn VIP 88'
  const archiveRes = await tablesPatch(request('/api/tables', ownerToken, {
    id: vipTable.id, is_archived: true,
  }, 'PATCH'));
  assert.equal(archiveRes.status, 200);
  const { table: archivedTable } = await archiveRes.json();
  assert.equal(archivedTable.is_active, false);
  assert.equal(archivedTable.is_archived, true);

  // Archived table is omitted from public GET /api/tables
  const publicTablesRes = await tablesGet(new Request('http://localhost/api/tables?shopId=shop-fnb-001'));
  const { tables: publicTables } = await publicTablesRes.json();
  assert.ok(!publicTables.some((t: { id: string }) => t.id === vipTable.id));

  // New order on archived table is rejected with 400
  const archivedOrderRes = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001',
    table_id: vipTable.id,
    items: [{ item_id: 'item-fnb-2', name_vi: 'Phở Tái', quantity: 1, unit_price: 55000, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(archivedOrderRes.status, 400);

  // Owner creates a new table reusing name 'Bàn VIP 88', guest places order on the new table
  const reusedTableRes = await tablesPost(request('/api/tables', ownerToken, {
    shop_id: 'shop-fnb-001', name: 'Bàn VIP 88', table_code: 'VIP-88-NEW',
  }, 'POST'));
  assert.equal(reusedTableRes.status, 201);
  const { table: reusedTable } = await reusedTableRes.json();

  const secondOrderRes = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001',
    table_id: reusedTable.id,
    items: [{ item_id: 'item-fnb-2', name_vi: 'Phở Tái', quantity: 1, unit_price: 55000, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(secondOrderRes.status, 201);
  const { order: secondOrder } = await secondOrderRes.json();

  // Settling bill for reusedTable.id only settles secondOrder, not createdOrder from archived vipTable
  const settleRes = await ordersPost(request('/api/orders', token, {
    action: 'settle_table_bill',
    shop_id: 'shop-fnb-001',
    table_id: reusedTable.id,
    payment_method: 'cash',
  }, 'POST'));
  assert.equal(settleRes.status, 200);
  const { tableBill } = await settleRes.json();
  assert.deepEqual(tableBill.order_ids, [secondOrder.id]);
});
