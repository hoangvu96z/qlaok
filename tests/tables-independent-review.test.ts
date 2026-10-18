import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { dbCreateOrder, dbGetOrderById, dbGetTableBill, dbUpdateOrderStatus, setMposDbClientForTests } from '@/lib/mpos-store';
import { setSupabaseDbClientForTests } from '@/lib/db';
import { buildTableMenuUrl, resolveTableSelection, summarizeOrdersByTable } from '@/lib/table-helpers';
import type { ShopOrder, ShopTable } from '@/types/qlaok';
import { dbCreateShopTable, dbUpdateShopTable, setShopTablesDbClientForTests } from '@/lib/shop-tables';

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
