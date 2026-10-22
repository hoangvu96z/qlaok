import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { dbCreateOrder, dbGetOrderById, dbGetTableBill, dbUpdateOrderStatus, setMposDbClientForTests } from '@/lib/mpos-store';
import { setSupabaseDbClientForTests } from '@/lib/db';
import {
  buildTableMenuUrl,
  createScopedTableQrVerification,
  resolveStorefrontMenuTableState,
  resolveTableSelection,
  summarizeOrdersByTable,
} from '@/lib/table-helpers';
import type { ShopOrder, ShopTable } from '@/types/qlaok';
import {
  buildCanonicalTableQrPayload,
  dbCreateShopTable,
  dbGetPublicShopTables,
  dbUpdateShopTable,
  setShopTablesDbClientForTests,
  signTableQr,
  verifyTableQrSignature,
} from '@/lib/shop-tables';
import { PATCH as patchOrders, POST as postOrders } from '@/app/api/orders/route';
import { GET as getShops } from '@/app/api/shops/route';
import { GET as getTables, POST as postTables } from '@/app/api/tables/route';
import { issueSessionToken } from '@/lib/server-auth';
import { localizeGuestOrderError } from '@/lib/i18n-helper';

test('table mutations must not report persistence when the DB returns no written row', async () => {
  const existing = { id: 'existing', shop_id: 'review-shop', table_code: 'T01', name: 'Existing', section: '', capacity: 4, sort_order: 1, is_active: true, is_archived: false };
  const client = { from() {
    let mutation = false;
    let single = false;
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; },
      insert() { mutation = true; return query; }, update() { mutation = true; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve: (result: unknown) => unknown, reject: (err: unknown) => unknown) {
        return Promise.resolve({ data: mutation ? null : single ? existing : [existing], error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  setShopTablesDbClientForTests(client, true);
  try {
    await assert.rejects(dbCreateShopTable({ shop_id: 'review-shop', name: 'New table', table_code: 'T02' }), /TABLE|persist|bàn/i);
    await assert.rejects(dbUpdateShopTable({ shop_id: 'review-shop', id: 'existing', name: 'Renamed' }), /TABLE|persist|bàn/i);
  } finally { setShopTablesDbClientForTests(null); }
});

// Independent Codex regression: exercise the actual engine and migrated PostgreSQL,
// including behavior that must survive adding managed table identity.
test('table QR selection and report totals preserve identity, payment states and shop scope', () => {
  const table = { id: 'table-1', shop_id: 'shop-1', table_code: 'T01', name: 'Bàn mới', section: '', capacity: 4, sort_order: 1, is_active: true, is_archived: false } as ShopTable;
  const inactive = { ...table, id: 'inactive', is_active: false };
  assert.equal(resolveTableSelection([table], { tableId: 'table-1' }).table?.id, table.id);
  assert.equal(resolveTableSelection([table], { table: 'T01' }).table?.id, table.id);
  assert.ok(resolveTableSelection([table], { tableId: 'foreign', table: 'T01' }).error, 'an invalid ID must not silently fall back to another parameter');
  assert.ok(resolveTableSelection([inactive], { tableId: inactive.id }).error);
  assert.equal(resolveTableSelection([table], {}).table, null, 'generic QR must not assign an arbitrary table');
  const url = new URL(buildTableMenuUrl('https://fixture.example/', 'shop-test', table.id));
  assert.equal(url.pathname, '/s/shop-test/menu');
  assert.equal(url.searchParams.get('tableId'), table.id);
  const order = (id: string, amount: number, payment: ShopOrder['payment_status'], status: ShopOrder['status'] = 'new', extra: Partial<ShopOrder> = {}) => ({ id, shop_id: 'shop-1', table_id: table.id, table_label: 'Tên lịch sử', total_amount: amount, payment_status: payment, status, ...extra } as ShopOrder);
  const paid = order('paid', 100, 'paid');
  const rows = summarizeOrdersByTable([
    paid, paid, order('unpaid', 200, 'unpaid'), order('refunded', 300, 'refunded'),
    order('cancelled', 400, 'paid', 'cancelled'), order('cancelled-refund', 500, 'refunded', 'cancelled'),
    order('foreign', 1000, 'paid', 'new', { shop_id: 'other-shop' }),
    order('takeaway', 50, 'paid', 'new', { table_id: null, table_label: 'Mang về' }),
    order('legacy', 75, 'paid', 'new', { table_id: null, table_label: 'Tên lịch sử' }),
  ], 'shop-1', [table]);
  const managed = rows.find(row => row.table_id === table.id)!;
  assert.equal(managed.table_label, 'Bàn mới');
  assert.equal(managed.orderCount, 5);
  assert.equal(managed.collectedRevenue, 100);
  assert.equal(managed.unpaidAmount, 200);
  assert.equal(managed.refundedAmount, 800);
  assert.equal(managed.cancelledOrderCount, 2);
  assert.equal(managed.refundedOrderCount, 2);
  assert.equal(rows.length, 3, 'managed, takeaway and legacy remain separate');
  assert.equal(rows.reduce((sum, row) => sum + row.collectedRevenue, 0), 225);
});

test('managed table identity preserves unpaid edits, stock deltas and historical labels', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  class SelectQuery {
    private table: string;
    private columns = '*';
    private filters: Array<[string, unknown]> = [];
    private single = false;
    constructor(table: string) { this.table = table; }
    select(columns: string) { this.columns = columns; return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    order() { return this; }
    maybeSingle() { this.single = true; return this; }
    async execute() {
      const identifier = (value: string) => { assert.match(value, /^[a-z_]+$/i); return `"${value}"`; };
      const where = this.filters.map(([key], i) => `${identifier(key)}=$${i + 1}`).join(' AND ');
      const { rows } = await db.query(`SELECT ${this.columns === '*' ? '*' : this.columns.split(',').map((value) => identifier(value.trim())).join(',')} FROM ${identifier(this.table)}${where ? ` WHERE ${where}` : ''}`, this.filters.map(([, value]) => value));
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    }
    then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) { return this.execute().then(resolve, reject); }
  }
  const client = {
    from: (table: string) => new SelectQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {

      const names = Object.keys(args);
      assert.match(name, /^[a-z_]+$/);
      const parameters = names.map((key, i) => { assert.match(key, /^[a-z_]+$/); return `${key} => $${i + 1}`; }).join(',');
      try {
        const { rows } = await db.query<{ result: unknown }>(`SELECT ${name}(${parameters}) AS result`, names.map((key) => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
        return { data: rows[0].result, error: null };
      } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
    },
  };
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs.readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    await db.exec(`INSERT INTO profiles(id) VALUES ('review-owner');
      INSERT INTO shops(id,owner_id,slug,name) VALUES ('review-shop','review-owner','review-shop','Review'), ('other-review-shop','review-owner','other-review-shop','Other');
      INSERT INTO categories(id,shop_id) VALUES ('review-cat','review-shop');
      INSERT INTO items(id,shop_id,category_id,price,stock_quantity) VALUES ('review-item','review-shop','review-cat',10000,10);
      INSERT INTO shop_tables(id,shop_id,table_code,name) VALUES ('review-table','review-shop','T01','Bàn gốc'), ('other-review-table','other-review-shop','T01','Bàn khác quán');`);
    setMposDbClientForTests(client, true);
    setSupabaseDbClientForTests(client);
    const line = (quantity: number) => ({ item_id: 'review-item', name_vi: 'Món thử', quantity, unit_price: 1, extra_price: 0, selected_choices: [] });
    const params = { shop_id: 'review-shop', table_id: 'review-table', table_label: 'Tên giả từ client', items: [line(2)] };
    const created = await dbCreateOrder(params);
    assert.equal(created.total_amount, 20000);
    assert.equal((created as typeof created & { table_id?: string }).table_id, 'review-table', 'table identity must survive the engine/RPC round trip');
    assert.equal(created.table_label, 'Bàn gốc', 'server must snapshot the managed name');
    await dbUpdateOrderStatus(created.id, { items: [line(3)] });
    const edited = await dbGetOrderById(created.id);
    assert.equal(edited?.total_amount, 30000, 'unpaid item edits remain supported');
    assert.equal((await db.query<{ stock_quantity: number }>("SELECT stock_quantity FROM items WHERE id='review-item'")).rows[0].stock_quantity, 7, 'positive stock demand deducts, not restores');
    await db.exec("UPDATE shop_tables SET name='Bàn đổi tên' WHERE id='review-table'");
    assert.equal((await dbGetOrderById(created.id))?.table_label, 'Bàn gốc', 'rename must preserve existing label snapshot');
    await db.exec("UPDATE shop_tables SET is_archived=true WHERE id='review-table'");
    await dbUpdateOrderStatus(created.id, { payment_status: 'paid', expected_total: 30000 });
    assert.equal((await dbGetOrderById(created.id))?.payment_status, 'paid', 'archive must not prevent settlement of existing orders');
    assert.equal((await dbGetOrderById(created.id))?.table_label, 'Bàn gốc');
    await assert.rejects(dbCreateOrder({ ...params, items: [line(1)] }), /INACTIVE|ARCHIV|TABLE.*(INVALID|NOT.*ACTIVE)/i);
    await assert.rejects(dbCreateOrder({ ...params, table_id: 'other-review-table', items: [line(1)] }), /TABLE|bàn/i);
    assert.equal((await db.query<{ stock_quantity: number }>("SELECT stock_quantity FROM items WHERE id='review-item'")).rows[0].stock_quantity, 7, 'rejected table selections must not consume stock');
    assert.equal((await db.query('SELECT id FROM orders')).rows.length, 1);
    await db.exec("INSERT INTO orders(id,order_code,shop_id,table_label,total_amount) VALUES ('legacy-same-label','LEGACY-LABEL','review-shop','Bàn đổi tên',9999)");
    const managedBill = await dbGetTableBill({ shop_id: 'review-shop', table_id: 'review-table', table_label: 'Bàn đổi tên' });
    assert.deepEqual(managedBill.order_ids, [], 'managed bill preview must not include legacy orders sharing a display name when settlement excludes them');
  } finally { setMposDbClientForTests(null); setSupabaseDbClientForTests(null); await db.close(); }
});

// Test database boundaries independently of API guards and UI visibility.
test('table RLS limits mutations to each shop owner and public reads to active published tables', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const owner = '00000000-0000-0000-0000-000000000011';
  const other = '00000000-0000-0000-0000-000000000012';
  const staff = '00000000-0000-0000-0000-000000000013';
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    for (const file of fs.readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT SELECT ON public.shops TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO service_role;
      INSERT INTO profiles(id) VALUES ('${owner}'), ('${other}'), ('${staff}');
      INSERT INTO shops(id,owner_id,slug,name,is_published) VALUES ('owner-shop','${owner}','owner-shop','Owner',true), ('private-shop','${other}','private-shop','Private',false);
      INSERT INTO shop_memberships(id,shop_id,user_id,role,permissions) VALUES ('table-staff','owner-shop','${staff}','staff','["orders.view","settings.manage","members.manage"]');
      INSERT INTO shop_tables(id,shop_id,table_code,name,is_active) VALUES ('active-table','owner-shop','A','Active',true), ('inactive-table','owner-shop','I','Inactive',false), ('private-table','private-shop','P','Private',true);`);
    const login = async (role: string, sub: string) => {
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${sub}', false); SELECT set_config('request.jwt.claims', '{"role":"${role}","sub":"${sub}"}', false); SET ROLE ${role}`);
    };
    await login('anon', '');
    assert.deepEqual((await db.query<{ id: string }>('SELECT id FROM shop_tables ORDER BY id')).rows.map(row => row.id), ['active-table']);
    await assert.rejects(db.exec("INSERT INTO shop_tables(shop_id,table_code,name) VALUES ('owner-shop','X','Hacked')"), /permission|policy|OWNER/i);
    await login('authenticated', staff);
    assert.equal((await db.query("UPDATE shop_tables SET name='Staff hacked' WHERE id='active-table' RETURNING id")).rows.length, 0);
    await assert.rejects(db.exec("INSERT INTO shop_tables(shop_id,table_code,name) VALUES ('owner-shop','X','Staff created')"), /permission|policy|OWNER/i);
    await login('authenticated', owner);
    assert.equal((await db.query("UPDATE shop_tables SET name='Owner renamed' WHERE id='active-table' RETURNING id")).rows.length, 1);
    await assert.rejects(db.exec("INSERT INTO shop_tables(shop_id,table_code,name) VALUES ('private-shop','X','Other shop')"), /permission|policy|OWNER/i);
    await assert.rejects(db.exec("UPDATE shop_tables SET shop_id='private-shop' WHERE id='active-table'"), /permission|policy|IMMUTABLE|OWNER/i);
    await login('service_role', '');
    await assert.rejects(db.exec("INSERT INTO orders(id,order_code,shop_id,table_id,total_amount) VALUES ('cross-table','CROSS','owner-shop','private-table',0)"), /INVALID_TABLE_SHOP/i);
    await assert.rejects(db.exec("INSERT INTO orders(id,order_code,shop_id,table_id,total_amount) VALUES ('inactive-order','INACTIVE','owner-shop','inactive-table',0)"), /INACTIVE_SHOP_TABLE/i);
    await db.exec("INSERT INTO orders(id,order_code,shop_id,table_id,total_amount) VALUES ('historic-order','HISTORY','owner-shop','active-table',10000)");
    await db.exec("UPDATE shop_tables SET is_archived=true WHERE id='active-table'");
    assert.equal((await db.query<{ table_label: string }>("SELECT table_label FROM orders WHERE id='historic-order'")).rows[0].table_label, 'Owner renamed');
    await assert.rejects(db.exec("DELETE FROM shop_tables WHERE id='active-table'"), /HISTORICAL|ARCHIVE/i);
    await db.exec("INSERT INTO shop_tables(id,shop_id,table_code,name) VALUES ('replacement-table','owner-shop','R','Owner renamed'); INSERT INTO orders(id,order_code,shop_id,table_id,total_amount) VALUES ('replacement-order','REPLACEMENT','owner-shop','replacement-table',20000)");
    const settlement = await db.query<{ result: Array<{ id: string }> }>("SELECT settle_table_bill_atomic('owner-shop', NULL, 'Owner renamed', 'cash', 'table-reuse-check') AS result");
    assert.deepEqual(settlement.rows[0].result.map(order => order.id), ['replacement-order'], 'reused names must not collect archived table orders');
    assert.equal((await db.query<{ payment_status: string }>("SELECT payment_status FROM orders WHERE id='historic-order'")).rows[0].payment_status, 'unpaid');
    await db.exec("UPDATE shop_tables SET is_archived=true WHERE id='replacement-table'");
    await login('anon', '');
    assert.equal((await db.query('SELECT id FROM shop_tables')).rows.length, 0);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claims', '{}', false); SELECT set_config('request.jwt.claim.sub', '', false)");
    const beforeReplay = (await db.query("SELECT id,table_id,table_label,payment_status,total_amount FROM orders ORDER BY id")).rows;
    await db.exec(fs.readFileSync('supabase/migrations/007_shop_tables.sql', 'utf8'));
    assert.deepEqual((await db.query("SELECT id,table_id,table_label,payment_status,total_amount FROM orders ORDER BY id")).rows, beforeReplay, 'migration replay must preserve order associations and money');
  } finally { await db.close(); }
});

test('table QR HMAC-SHA256 signing secures anonymous table orders and guest PATCH against spoofing while preserving takeaway and staff POS', async () => {
  const prevSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-session-secret-for-table-qr-hmac-2026';
  try {
    const shopId = 'shop-fnb-001';
    const table1Id = 'tbl-fnb-01';
    const table2Id = 'tbl-fnb-02';
    const otherShopId = 'shop-service-002';
    const otherShopTableId = 'tbl-service-01';

    // 1. Canonical HMAC-SHA256 signature stability and URL embedding
    assert.equal(
      buildCanonicalTableQrPayload(' shop-fnb-001 ', ' tbl-fnb-01 '),
      'qlaok-table-qr:v1:shop-fnb-001:tbl-fnb-01'
    );
    const sig1 = signTableQr(shopId, table1Id);
    const sig1Repeat = signTableQr(shopId, table1Id);
    const sig2 = signTableQr(shopId, table2Id);
    assert.ok(sig1.length >= 32);
    assert.equal(sig1, sig1Repeat, 'HMAC-SHA256 signature must be deterministic');
    assert.notEqual(sig1, sig2, 'different tables must have distinct signatures');

    const signedUrl = new URL(
      buildTableMenuUrl('https://qlaok.example', 'pho-hoi-an', table1Id, sig1)
    );
    assert.equal(signedUrl.pathname, '/s/pho-hoi-an/menu');
    assert.equal(signedUrl.searchParams.get('src'), 'table');
    assert.equal(signedUrl.searchParams.get('tableId'), table1Id);
    assert.equal(signedUrl.searchParams.get('sig'), sig1);

    assert.equal(
      verifyTableQrSignature({ shop_id: shopId, table_id: table1Id, signature: sig1 }),
      true
    );
    assert.equal(
      verifyTableQrSignature({ shop_id: shopId, table_id: table2Id, signature: sig1 }),
      false,
      'signature for table 1 must fail when customer changes tableId to table 2'
    );
    assert.equal(
      verifyTableQrSignature({ shop_id: shopId, table_id: table1Id, signature: '' }),
      false
    );
    assert.equal(
      verifyTableQrSignature({ shop_id: otherShopId, table_id: table1Id, signature: sig1 }),
      false,
      'cross-shop signature verification must fail'
    );

    // Public tables list must NOT leak qr_sig so guests cannot harvest other tables' signatures
    const publicTables = await dbGetPublicShopTables(shopId);
    assert.ok(publicTables.length > 0);
    assert.equal(
      publicTables.some((t) => Boolean(t.qr_sig)),
      false,
      'public table list must not expose qr_sig'
    );

    const publicRes = await getTables(
      new Request(`http://localhost/api/tables?shopId=${shopId}`)
    );
    const publicJson = (await publicRes.json()) as { tables: ShopTable[] };
    assert.equal(publicRes.status, 200);
    assert.equal(publicJson.tables.some((t) => Boolean(t.qr_sig)), false);

    // Authenticated management list & POST issue qr_sig for owner/staff standees
    const adminToken = issueSessionToken({
      id: 'admin-hoangvu96z',
      email: 'hoangvu96z@gmail.com',
      role: 'admin',
      is_admin: true,
    });
    const mgmtRes = await getTables(
      new Request(
        `http://localhost/api/tables?shopId=${shopId}&includeInactive=1&includeArchived=1`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      )
    );
    const mgmtJson = (await mgmtRes.json()) as { tables: ShopTable[] };
    assert.equal(mgmtRes.status, 200);
    const mgmtTable1 = mgmtJson.tables.find((t) => t.id === table1Id);
    assert.equal(mgmtTable1?.qr_sig, sig1);

    const sampleItems = [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: [],
      },
    ];

    // 2. Valid signed table QR order succeeds
    const validRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table1Id,
          table_label: 'Bàn 01',
          qr_table_mode: true,
          table_qr_sig: sig1,
          source: 'qr_table',
          visitor_lang: 'en',
          items: sampleItems,
        }),
      })
    );
    const validData = (await validRes.json()) as { order?: ShopOrder; error?: string };
    assert.equal(validRes.status, 201, validData.error);
    assert.equal(validData.order?.table_id, table1Id);
    assert.equal(validData.order?.table_label, 'Bàn 01');

    // 3. Tampered tableId (customer scanned table 1 QR with sig1, but changed tableId to table 2) -> rejected
    const tamperedTableRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table2Id,
          table_label: 'Bàn 02',
          qr_table_mode: true,
          table_qr_sig: sig1,
          source: 'qr_table',
          visitor_lang: 'en',
          items: sampleItems,
        }),
      })
    );
    const tamperedTableData = (await tamperedTableRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(tamperedTableRes.status, 400);
    assert.equal(tamperedTableData.code, 'INVALID_TABLE_QR_SIGNATURE');
    assert.equal(
      localizeGuestOrderError(
        {
          code: tamperedTableData.code,
          error: tamperedTableData.error,
          status: tamperedTableRes.status,
        },
        'en'
      ),
      'This table is not valid for this shop. Please select an active table or Takeaway.'
    );
    assert.equal(
      localizeGuestOrderError(
        {
          code: tamperedTableData.code,
          error: tamperedTableData.error,
          status: tamperedTableRes.status,
        },
        'vi'
      ),
      'Bàn không hợp lệ hoặc không thuộc quán này. Vui lòng chọn bàn đang hoạt động hoặc Mang về.'
    );

    // 4. Tampered signature string -> rejected even without qr_table_mode flag
    const forgedSigRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table1Id,
          table_qr_sig: `${sig1.slice(0, -2)}ab`,
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const forgedSigData = (await forgedSigRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(forgedSigRes.status, 400);
    assert.equal(forgedSigData.code, 'INVALID_TABLE_QR_SIGNATURE');

    // 5. Missing signature in table QR mode -> rejected with localized error
    const missingSigRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table1Id,
          qr_table_mode: true,
          table_qr_sig: '',
          source: 'qr_table',
          visitor_lang: 'vi',
          items: sampleItems,
        }),
      })
    );
    const missingSigData = (await missingSigRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(missingSigRes.status, 400);
    assert.equal(missingSigData.code, 'MISSING_TABLE_QR_SIGNATURE');
    assert.equal(
      localizeGuestOrderError(
        {
          code: missingSigData.code,
          error: missingSigData.error,
          status: missingSigRes.status,
        },
        'ko'
      ),
      '유효하지 않은 테이블입니다. 이용 가능한 테이블 또는 포장을 선택해 주세요.'
    );

    // 6. Cross-shop signature / tableId -> rejected
    const otherSig = signTableQr(otherShopId, otherShopTableId);
    const crossShopTableRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: otherShopTableId,
          qr_table_mode: true,
          table_qr_sig: otherSig,
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const crossShopTableData = (await crossShopTableRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(crossShopTableRes.status, 400);
    assert.equal(crossShopTableData.code, 'INVALID_TABLE_SHOP');

    const crossShopSigOnLocalTableRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table1Id,
          qr_table_mode: true,
          table_qr_sig: signTableQr(otherShopId, table1Id),
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const crossShopSigData = (await crossShopSigOnLocalTableRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(crossShopSigOnLocalTableRes.status, 400);
    assert.equal(crossShopSigData.code, 'INVALID_TABLE_QR_SIGNATURE');

    // 7. Anonymous table-bound POST /api/orders without table_qr_sig is rejected even when qr_table_mode is omitted
    const unsignedDoorTableRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table2Id,
          table_label: 'Bàn 02',
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const unsignedDoorTableData = (await unsignedDoorTableRes.json()) as {
      error?: string;
      code?: string;
    };
    assert.equal(unsignedDoorTableRes.status, 400);
    assert.equal(unsignedDoorTableData.code, 'MISSING_TABLE_QR_SIGNATURE');

    const unsignedTableCodeRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_code: 'T02',
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const unsignedTableCodeData = (await unsignedTableCodeRes.json()) as {
      code?: string;
    };
    assert.equal(unsignedTableCodeRes.status, 400);
    assert.equal(unsignedTableCodeData.code, 'MISSING_TABLE_QR_SIGNATURE');

    const unsignedTableLabelRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_label: 'Bàn 02',
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const unsignedTableLabelData = (await unsignedTableLabelRes.json()) as {
      code?: string;
    };
    assert.equal(unsignedTableLabelRes.status, 400);
    assert.equal(unsignedTableLabelData.code, 'MISSING_TABLE_QR_SIGNATURE');

    // 8. Legitimate anonymous takeaway order (door QR / generic menu) succeeds without table_qr_sig
    const doorTakeawayRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: null,
          table_label: 'Mang về',
          source: 'qr_table',
          items: sampleItems,
        }),
      })
    );
    const doorTakeawayData = (await doorTakeawayRes.json()) as {
      order?: ShopOrder;
      error?: string;
    };
    assert.equal(doorTakeawayRes.status, 201, doorTakeawayData.error);
    assert.equal(doorTakeawayData.order?.table_id, null);
    assert.equal(doorTakeawayData.order?.table_label, 'Mang về');

    // 9. Authenticated POS / counter order for a managed table succeeds without table_qr_sig
    const staffPosRes = await postOrders(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          shop_id: shopId,
          table_id: table2Id,
          source: 'counter_pos',
          items: sampleItems,
        }),
      })
    );
    const staffPosData = (await staffPosRes.json()) as {
      order?: ShopOrder;
      error?: string;
    };
    assert.equal(staffPosRes.status, 201, staffPosData.error);
    assert.equal(staffPosData.order?.table_id, table2Id);

    // 10. Unsigned or tampered tableId cannot lock the storefront menu; GET /api/shops verifies sig
    const activeTable1 = publicTables.find((t) => t.id === table1Id)!;
    assert.equal(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: null,
        requireSig: true,
      }).table,
      null,
      'unsigned tableId must not resolve to a locked table when signature is required'
    );
    assert.ok(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: null,
        requireSig: true,
      }).error
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig2,
        requireSig: true,
        sigVerified: false,
      }).table,
      null,
      'tampered sig must not resolve to a locked table'
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig2,
        requireSig: true,
        sigVerified: null,
      }).table,
      null,
      'non-empty tampered sig with sigVerified null must not resolve tableId'
    );
    assert.ok(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig2,
        requireSig: true,
        sigVerified: null,
      }).error
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig2,
        requireSig: true,
        sigVerified: undefined,
      }).table,
      null,
      'non-empty tampered sig with sigVerified undefined must not resolve tableId'
    );
    assert.ok(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig2,
        requireSig: true,
        sigVerified: undefined,
      }).error
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        table: activeTable1.table_code,
        sig: sig2,
        requireSig: true,
        sigVerified: null,
      }).table,
      null,
      'legacy ?table= with non-empty tampered sig and sigVerified null must not select a table'
    );
    assert.ok(
      resolveTableSelection([activeTable1], {
        table: activeTable1.table_code,
        sig: sig2,
        requireSig: true,
        sigVerified: null,
      }).error
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        table: activeTable1.name,
        sig: sig2,
        requireSig: true,
        sigVerified: undefined,
      }).table,
      null,
      'legacy ?table= with non-empty tampered sig and sigVerified undefined must not select a table'
    );
    assert.ok(
      resolveTableSelection([activeTable1], {
        table: activeTable1.name,
        sig: sig2,
        requireSig: true,
        sigVerified: undefined,
      }).error
    );
    assert.equal(
      resolveTableSelection([activeTable1], {
        tableId: table1Id,
        sig: sig1,
        requireSig: true,
        sigVerified: true,
      }).table?.id,
      table1Id,
      'verified signed QR resolves to the locked table'
    );

    const shopVerifiedRes = await getShops(
      new Request(
        `http://localhost/api/shops?slug=pho-hoi-an&tableId=${table1Id}&sig=${sig1}`
      )
    );
    const shopVerifiedData = (await shopVerifiedRes.json()) as {
      tableQrVerified?: boolean;
    };
    assert.equal(shopVerifiedData.tableQrVerified, true);

    const shopTamperedRes = await getShops(
      new Request(
        `http://localhost/api/shops?slug=pho-hoi-an&tableId=${table1Id}&sig=${sig2}`
      )
    );
    const shopTamperedData = (await shopTamperedRes.json()) as {
      tableQrVerified?: boolean;
    };
    assert.equal(shopTamperedData.tableQrVerified, false);

    // 10b. Scoped verification state prevents a verified table1Id+sig1 result from locking table2Id on same-slug query changes
    const scopedVerifiedTable1 = createScopedTableQrVerification({
      shopSlug: 'pho-hoi-an',
      shopId,
      tableId: table1Id,
      sig: sig1,
      tableQrVerified: shopVerifiedData.tableQrVerified,
      activeSlug: 'pho-hoi-an',
      activeTableId: table1Id,
      activeSig: sig1,
    });
    assert.equal(
      resolveStorefrontMenuTableState({
        shopSlug: 'pho-hoi-an',
        shopId,
        tables: publicTables,
        qrTableIdParam: table1Id,
        qrTableSigParam: sig1,
        verification: scopedVerifiedTable1,
      }).lockedTable?.id,
      table1Id
    );
    const staleOnTable2Query = resolveStorefrontMenuTableState({
      shopSlug: 'pho-hoi-an',
      shopId,
      tables: publicTables,
      qrTableIdParam: table2Id,
      qrTableSigParam: sig2,
      verification: scopedVerifiedTable1,
    });
    assert.equal(
      staleOnTable2Query.lockedTable,
      null,
      'stale table1Id+sig1 verification must not lock table2Id when searchParams changes on the same slug'
    );
    assert.equal(staleOnTable2Query.tableQrVerified, null);

    // 11. Guest PATCH /api/orders must preserve table identity or require valid signed QR proof for table changes
    const createdGuestOrder = validData.order!;
    assert.ok(createdGuestOrder.tracking_token);

    // 11a. Guest PATCH updating items/note while preserving existing table identity succeeds
    const guestPreserveTableRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: createdGuestOrder.id,
          tracking_token: createdGuestOrder.tracking_token,
          customer_note: 'Ít hành',
          items: sampleItems,
        }),
      })
    );
    const guestPreserveTableData = (await guestPreserveTableRes.json()) as {
      order?: ShopOrder;
      error?: string;
    };
    assert.equal(guestPreserveTableRes.status, 200, guestPreserveTableData.error);
    assert.equal(guestPreserveTableData.order?.table_id, table1Id);

    // 11b. Guest PATCH changing table_id without table_qr_sig is rejected
    const guestUnsignedTableChangeRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: createdGuestOrder.id,
          tracking_token: createdGuestOrder.tracking_token,
          table_id: table2Id,
        }),
      })
    );
    const guestUnsignedTableChangeData =
      (await guestUnsignedTableChangeRes.json()) as { code?: string };
    assert.equal(guestUnsignedTableChangeRes.status, 400);
    assert.equal(
      guestUnsignedTableChangeData.code,
      'MISSING_TABLE_QR_SIGNATURE'
    );

    // 11c. Guest PATCH changing table_id with wrong/tampered signature is rejected
    const guestTamperedTableChangeRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: createdGuestOrder.id,
          tracking_token: createdGuestOrder.tracking_token,
          table_id: table2Id,
          table_qr_sig: sig1,
        }),
      })
    );
    const guestTamperedTableChangeData =
      (await guestTamperedTableChangeRes.json()) as { code?: string };
    assert.equal(guestTamperedTableChangeRes.status, 400);
    assert.equal(
      guestTamperedTableChangeData.code,
      'INVALID_TABLE_QR_SIGNATURE'
    );

    // 11d. Guest PATCH attempting to strip table_id or spoof table_label on a table-bound order is rejected
    const guestStripTableRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: createdGuestOrder.id,
          tracking_token: createdGuestOrder.tracking_token,
          table_id: null,
          table_label: 'Mang về',
        }),
      })
    );
    const guestStripTableData = (await guestStripTableRes.json()) as {
      code?: string;
    };
    assert.equal(guestStripTableRes.status, 400);
    assert.equal(guestStripTableData.code, 'MISSING_TABLE_QR_SIGNATURE');

    // 11e. Guest PATCH on takeaway order attempting to attach a table without signature is rejected
    const takeawayOrder = doorTakeawayData.order!;
    const takeawaySpoofTableRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: takeawayOrder.id,
          tracking_token: takeawayOrder.tracking_token,
          table_label: 'Bàn 02',
        }),
      })
    );
    const takeawaySpoofTableData = (await takeawaySpoofTableRes.json()) as {
      code?: string;
    };
    assert.equal(takeawaySpoofTableRes.status, 400);
    assert.equal(takeawaySpoofTableData.code, 'MISSING_TABLE_QR_SIGNATURE');

    // 11f. Guest PATCH changing table_id with a valid signature for the target table succeeds
    const guestSignedTableChangeRes = await patchOrders(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: createdGuestOrder.id,
          tracking_token: createdGuestOrder.tracking_token,
          table_id: table2Id,
          table_qr_sig: sig2,
        }),
      })
    );
    const guestSignedTableChangeData =
      (await guestSignedTableChangeRes.json()) as {
        order?: ShopOrder;
        error?: string;
      };
    assert.equal(
      guestSignedTableChangeRes.status,
      200,
      guestSignedTableChangeData.error
    );
    assert.equal(guestSignedTableChangeData.order?.table_id, table2Id);
    assert.equal(guestSignedTableChangeData.order?.table_label, 'Bàn 02');
  } finally {
    if (prevSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = prevSecret;
    }
  }
});
