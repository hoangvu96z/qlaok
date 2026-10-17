import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { dbCreateOrder, dbGetOrderById, dbUpdateOrderStatus, dbSettleTableBill, setMposDbClientForTests } from '@/lib/mpos-store';

test('engine commits against isolated PostgreSQL, rejects failed writes, and enforces payment/stock invariants', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  let failRpc = false;
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
      if (failRpc) return { data: null, error: { message: 'injected DB failure' } };
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
    for (const file of fs.readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    await db.exec(`INSERT INTO profiles(id) VALUES ('owner');
      INSERT INTO shops(id,owner_id,slug,name) VALUES ('engine-shop','owner','engine-shop','Fixture');
      INSERT INTO categories(id,shop_id) VALUES ('engine-cat','engine-shop');
      INSERT INTO items(id,shop_id,category_id,price,stock_quantity) VALUES ('engine-item','engine-shop','engine-cat',10000,10);`);
    setMposDbClientForTests(client, true);
    const create = (quantity = 2, table = 'Table A') => dbCreateOrder({ shop_id: 'engine-shop', table_label: table,
      items: [{ item_id: 'engine-item', name_vi: 'Fixture', quantity, unit_price: 1, extra_price: 0, selected_choices: [] }],
    });
    const order = await create();
    assert.equal(order.total_amount, 20000, 'catalog price must override submitted price');
    assert.equal((await db.query<{ stock_quantity: number }>("SELECT stock_quantity FROM items WHERE id='engine-item'")).rows[0].stock_quantity, 8);
    failRpc = true;
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid' }), /injected DB failure/);
    assert.equal((await dbGetOrderById(order.id))?.payment_status, 'unpaid', 'failed payment must not be cached as paid');
    await assert.rejects(create(1), /injected DB failure/);
    assert.equal((await db.query('SELECT id FROM orders')).rows.length, 1);
    failRpc = false;
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid', expected_total: 1 }), /Tổng tiền/);
    const paid = await dbUpdateOrderStatus(order.id, { payment_status: 'paid', expected_total: 20000 });
    assert.equal(paid.status, 'new', 'payment must not mark fulfillment completed');
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'unpaid' }), /INVALID_PAYMENT_TRANSITION/);
    await dbUpdateOrderStatus(order.id, { payment_status: 'refunded', refund_reason: 'Fixture refund' });
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid' }), /INVALID_PAYMENT_TRANSITION/);
    const guest = await create(1);
    await dbUpdateOrderStatus(guest.id, { status: 'preparing' });
    await assert.rejects(dbUpdateOrderStatus(guest.id, { require_new_unpaid: true, customer_note: 'late customer edit' }), /ORDER_ALREADY_PAID/);
    await assert.rejects(dbCreateOrder({ shop_id: 'engine-shop', table_label: 'Fake', items: [{
      item_id: 'unit-test-item-forged', name_vi: 'Fake', quantity: 1, unit_price: 1, extra_price: 0, selected_choices: [],
    }] }), /ITEM_NOT_IN_SHOP/);
    const round1 = await create(1, 'Table B');
    const settled = await dbSettleTableBill({ shop_id: 'engine-shop', session_id: round1.session_id, payment_method: 'cash', payment_idempotency_key: 'table-b' });
    assert.deepEqual(settled.order_ids, [round1.id]);
    const round2 = await dbCreateOrder({ shop_id: 'engine-shop', table_label: 'Table B', session_id: round1.session_id,
      items: [{ item_id: 'engine-item', name_vi: 'Fixture', quantity: 1, unit_price: 1, extra_price: 0, selected_choices: [] }] });
    const replay = await dbSettleTableBill({ shop_id: 'engine-shop', session_id: round1.session_id, payment_method: 'cash', payment_idempotency_key: 'table-b' });
    assert.deepEqual(replay.order_ids, [round1.id]);
    assert.equal((await dbGetOrderById(round2.id))?.payment_status, 'unpaid', 'replay must not collect a later round');
  } finally { setMposDbClientForTests(null); await db.close(); }
});
