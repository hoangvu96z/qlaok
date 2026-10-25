import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import {
  computeShopRevenueAndInventoryStats,
  dbComputeShopRevenueAndInventoryStats,
  dbCreateOrder,
  dbGetOrderById,
  dbGetShopActiveKitchenOrders,
  dbGetShopOrders,
  dbSettleTableBill,
  dbUpdateOrderStatus,
  fetchAllShopOrdersPaginatedForStats,
  setMposDbClientForTests,
} from '@/lib/mpos-store';
import {
  dbGetShopAnalyticsSummary,
  dbGetShopCatalog,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import { issueSessionToken, SESSION_COOKIE_NAME } from '@/lib/server-auth';
import {
  GET as getOrdersRoute,
  PATCH as patchOrdersRoute,
} from '@/app/api/orders/route';
import { buildMobileOverviewMetrics } from '../mobile/src/lib/overview-metrics';
import { buildOrderStatusPatchPayload } from '../mobile/src/lib/order-actions';

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
      const identifier = (value: string) => { assert.match(value, /^[a-z_][a-z0-9_]*$/i); return `"${value}"`; };
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

test('order summary RPC, paginated fallback, analytics summary, GET /api/orders, and mobile overview include orders beyond PostgREST 1000-row cap while preserving financial invariants', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  let disableStatsRpc = false;
  let disableRangeSupport = false;

  // PostgREST-faithful query builder that caps unpaginated .select() at 1000 rows
  // and supports .order(), .limit(), and .range(from, to).
  class PostgrestSelectQuery {
    private table: string;
    private columns = '*';
    private filters: Array<[string, unknown]> = [];
    private inFilters: Array<[string, readonly unknown[]]> = [];
    private orderColumns: Array<{ column: string; ascending: boolean }> = [];
    private rowLimit: number | null = null;
    private rowOffset = 0;
    private single = false;
    range?: (from: number, to: number) => PostgrestSelectQuery;

    constructor(table: string) {
      this.table = table;
      if (!disableRangeSupport) {
        this.range = (from: number, to: number) => {
          this.rowOffset = Math.max(0, from);
          this.rowLimit = Math.min(Math.max(0, to - from + 1), 1000);
          return this;
        };
      }
    }
    select(columns: string) {
      this.columns = columns;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    in(column: string, values: readonly unknown[]) {
      this.inFilters.push([column, values]);
      return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.orderColumns.push({
        column,
        ascending: options?.ascending !== false,
      });
      return this;
    }
    limit(count: number) {
      this.rowLimit = Math.min(count, 1000);
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    async execute() {
      const identifier = (value: string) => {
        assert.match(value, /^[a-z_][a-z0-9_]*$/i);
        return `"${value}"`;
      };
      const params: unknown[] = [];
      const whereParts: string[] = [];
      for (const [key, value] of this.filters) {
        params.push(value);
        whereParts.push(`${identifier(key)}=$${params.length}`);
      }
      for (const [key, values] of this.inFilters) {
        params.push(values.map((v) => String(v)));
        whereParts.push(`${identifier(key)} = ANY($${params.length}::text[])`);
      }
      const where = whereParts.join(' AND ');
      const orderBy =
        this.orderColumns.length > 0
          ? ` ORDER BY ${this.orderColumns
              .map(
                (o) => `${identifier(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`
              )
              .join(', ')}`
          : '';
      // PostgREST silently caps every select response at 1000 rows max per request
      const effectiveLimit = this.single
        ? 1
        : Math.min(this.rowLimit ?? 1000, 1000);
      const sql = `SELECT ${
        this.columns === '*'
          ? '*'
          : this.columns
              .split(',')
              .map((value) => identifier(value.trim()))
              .join(',')
      } FROM ${identifier(this.table)}${where ? ` WHERE ${where}` : ''}${orderBy} LIMIT ${effectiveLimit} OFFSET ${this.rowOffset}`;
      const { rows } = await db.query(sql, params);
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (error: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PostgrestSelectQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (disableStatsRpc && name === 'get_shop_order_stats_summary') {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message:
              'Could not find the function public.get_shop_order_stats_summary in the schema cache',
          },
        };
      }
      const names = Object.keys(args);
      assert.match(name, /^[a-z_]+$/);
      const parameters = names
        .map((key, i) => {
          assert.match(key, /^[a-z_]+$/);
          return `${key} => $${i + 1}`;
        })
        .join(',');
      try {
        const { rows } = await db.query<{ result: unknown }>(
          `SELECT ${name}(${parameters}) AS result`,
          names.map((key) =>
            typeof args[key] === 'object' && args[key] !== null
              ? JSON.stringify(args[key])
              : args[key]
          )
        );
        return { data: rows[0].result, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      await db.exec(
        fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      );
    }

    await db.exec(`
      INSERT INTO profiles(id, email) VALUES ('owner-stats', 'owner-stats@test.local'), ('staff-stats', 'staff-stats@test.local');
      INSERT INTO shops(id, owner_id, slug, name, is_published) VALUES ('stats-shop', 'owner-stats', 'stats-shop', 'Stats Shop', true);
      INSERT INTO categories(id, shop_id, name_i18n) VALUES ('stats-cat', 'stats-shop', '{"vi":"Đồ uống"}');
      INSERT INTO items(id, shop_id, category_id, price, stock_quantity, is_available, name_i18n)
        VALUES ('stats-item', 'stats-shop', 'stats-cat', 10000, 50, true, '{"vi":"Cà phê muối"}');
      INSERT INTO shop_memberships(id, shop_id, user_id, role, permissions, is_active)
        VALUES ('mem-staff-stats', 'stats-shop', 'staff-stats', 'staff', '["orders.view","orders.fulfill"]'::jsonb, true);
    `);

    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    const todayVnDate = vnNow.toISOString().slice(0, 10);
    const threeDaysAgoVn = new Date(vnNow.getTime() - 3 * 86400 * 1000)
      .toISOString()
      .slice(0, 10);

    // Insert 1000 newer paid orders on the first page (12:00:00+07 down to 11:43:21+07 today in Vietnam timezone)
    await db.query(
      `INSERT INTO orders (
        id, shop_id, order_code, table_label, visitor_lang, status, payment_method, payment_status,
        items, subtotal_amount, discount_amount, total_amount, source, created_at, updated_at
      )
      SELECT
        'ord-page1-' || lpad(g::text, 4, '0'),
        'stats-shop',
        'P1-' || lpad(g::text, 4, '0'),
        'Bàn 01',
        'vi',
        'completed',
        'cash',
        'paid',
        '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":1,"unit_price":10000,"extra_price":0,"selected_choices":[]}]'::jsonb,
        10000,
        0,
        10000,
        'qr_table',
        ($1::timestamptz - make_interval(secs => g)),
        ($1::timestamptz - make_interval(secs => g))
      FROM generate_series(1, 1000) AS g`,
      [`${todayVnDate}T12:00:00.000+07:00`]
    );

    // Insert 5 older orders beyond the 1000-row cap (rows 1001..1005 when ordered by created_at DESC):
    // - #1001: paid today (777,000đ via vietqr) -> must increase todayRevenue, totalRevenue, paidOrdersCount
    // - #1002: paid 3 days ago (333,000đ via cash) -> must increase totalRevenue, paidOrdersCount, dailyRevenue7d[3d ago]
    // - #1003: completed but UNPAID today (999,000đ) -> must NOT count as collected revenue!
    // - #1004: status='new' unpaid today (50,000đ) -> must increase newOrdersCount
    // - #1005: status='preparing' unpaid today (60,000đ) -> must increase preparingOrdersCount
    await db.query(
      `INSERT INTO orders (
        id, shop_id, order_code, table_label, visitor_lang, status, payment_method, payment_status,
        items, subtotal_amount, discount_amount, total_amount, source, created_at, updated_at
      ) VALUES
        (
          'ord-beyond-1001-paid-today', 'stats-shop', 'BYD-1001', 'Bàn 02', 'vi', 'completed', 'vietqr', 'paid',
          '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":3,"unit_price":259000,"extra_price":0,"selected_choices":[]}]'::jsonb,
          777000, 0, 777000, 'qr_table', $1::timestamptz, $1::timestamptz
        ),
        (
          'ord-beyond-1002-paid-3d', 'stats-shop', 'BYD-1002', 'Bàn 03', 'vi', 'completed', 'cash', 'paid',
          '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":2,"unit_price":166500,"extra_price":0,"selected_choices":[]}]'::jsonb,
          333000, 0, 333000, 'counter_pos', $2::timestamptz, $2::timestamptz
        ),
        (
          'ord-beyond-1003-completed-unpaid', 'stats-shop', 'BYD-1003', 'Bàn 04', 'vi', 'completed', 'cash', 'unpaid',
          '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":1,"unit_price":999000,"extra_price":0,"selected_choices":[]}]'::jsonb,
          999000, 0, 999000, 'qr_table', $3::timestamptz, $3::timestamptz
        ),
        (
          'ord-beyond-1004-new-unpaid', 'stats-shop', 'BYD-1004', 'Bàn 05', 'vi', 'new', 'cash', 'unpaid',
          '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":1,"unit_price":50000,"extra_price":0,"selected_choices":[]}]'::jsonb,
          50000, 0, 50000, 'qr_table', $4::timestamptz, $4::timestamptz
        ),
        (
          'ord-beyond-1005-prep-unpaid', 'stats-shop', 'BYD-1005', 'Bàn 06', 'vi', 'preparing', 'cash', 'unpaid',
          '[{"item_id":"stats-item","name_vi":"Cà phê muối","quantity":1,"unit_price":60000,"extra_price":0,"selected_choices":[]}]'::jsonb,
          60000, 0, 60000, 'qr_table', $5::timestamptz, $5::timestamptz
        )`,
      [
        `${todayVnDate}T08:00:00.000+07:00`,
        `${threeDaysAgoVn}T12:00:00.000+07:00`,
        `${todayVnDate}T07:00:00.000+07:00`,
        `${todayVnDate}T06:00:00.000+07:00`,
        `${todayVnDate}T05:00:00.000+07:00`,
      ]
    );

    setMposDbClientForTests(client, true);
    setSupabaseDbClientForTests(client);
    setShopMembershipDbClientForTest(client as never);

    // 1. Order list remains bounded at 1000 rows, so naive client-side calculation misses rows 1001..1005
    const cappedOrders = await dbGetShopOrders('stats-shop');
    assert.equal(cappedOrders.length, 1000, 'order list stays bounded to 1000 rows');
    const { items } = await dbGetShopCatalog('stats-shop');
    const naiveCappedStats = computeShopRevenueAndInventoryStats(
      'stats-shop',
      items,
      cappedOrders
    );
    assert.equal(naiveCappedStats.todayRevenue, 10000000);
    assert.equal(naiveCappedStats.totalRevenue, 10000000);
    assert.equal(naiveCappedStats.paidOrdersCount, 1000);
    assert.equal(naiveCappedStats.newOrdersCount, 0);
    assert.equal(naiveCappedStats.preparingOrdersCount, 0);

    // 2. Server-side RPC summary includes rows 1001..1005 and excludes unpaid completed order from revenue
    const rpcStats = await dbComputeShopRevenueAndInventoryStats('stats-shop', items);
    assert.equal(
      rpcStats.todayRevenue,
      10777000,
      'RPC summary includes >1000th paid order today and excludes unpaid completed order'
    );
    assert.equal(
      rpcStats.totalRevenue,
      11110000,
      'RPC summary includes >1000th paid orders today and 3 days ago'
    );
    assert.equal(rpcStats.paidOrdersCount, 1002);
    assert.equal(rpcStats.todayPaidOrdersCount, 1001);
    assert.equal(rpcStats.totalOrdersCount, 1005);
    assert.equal(rpcStats.todayOrdersCount, 1004);
    assert.equal(rpcStats.completedOrdersCount, 1003);
    assert.equal(rpcStats.todayUnpaidAmount, 1109000);
    assert.equal(rpcStats.newOrdersCount, 1);
    assert.equal(rpcStats.preparingOrdersCount, 1);
    const emptyRpcStats = await dbComputeShopRevenueAndInventoryStats(
      'stats-empty-shop',
      []
    );
    assert.equal(emptyRpcStats.totalRevenue, 0);
    assert.equal(emptyRpcStats.paidOrdersCount, 0);
    assert.equal(emptyRpcStats.paymentBreakdown.vietqr.percentage, 0);
    assert.equal(emptyRpcStats.paymentBreakdown.cash.percentage, 0);
    assert.equal(emptyRpcStats.sourceBreakdown.qr_table.percentage, 0);
    assert.equal(emptyRpcStats.sourceBreakdown.counter_pos.percentage, 0);
    assert.equal(emptyRpcStats.hourlyBreakdown.length, 6);
    assert.ok(
      emptyRpcStats.hourlyBreakdown.every(
        (slot) => slot.revenue === 0 && slot.percentage === 0
      )
    );
    const rpcDay3dAgo = rpcStats.dailyRevenue7d.find(
      (d) => d.date === threeDaysAgoVn
    );
    const rpcDayToday = rpcStats.dailyRevenue7d.find(
      (d) => d.date === todayVnDate
    );
    assert.equal(rpcDay3dAgo?.revenue, 333000);
    assert.equal(rpcDayToday?.revenue, 10777000);
    assert.equal(rpcStats.topSellingItems[0]?.sold_count, 1008);
    assert.equal(rpcStats.topSellingItems[0]?.revenue, 12219000);

    // 3. Paginated .range() fallback path (when RPC is unavailable) also aggregates all 1005 orders across pages
    disableStatsRpc = true;
    const paginatedStats = await dbComputeShopRevenueAndInventoryStats(
      'stats-shop',
      items
    );
    assert.equal(paginatedStats.todayRevenue, 10777000);
    assert.equal(paginatedStats.totalRevenue, 11110000);
    assert.equal(paginatedStats.paidOrdersCount, 1002);
    assert.equal(paginatedStats.totalOrdersCount, 1005);
    assert.equal(paginatedStats.newOrdersCount, 1);
    assert.equal(paginatedStats.preparingOrdersCount, 1);

    // 3b. Fail-closed when .range() pagination is unavailable and a full 1000-row page indicates possible truncation
    disableRangeSupport = true;
    await assert.rejects(
      fetchAllShopOrdersPaginatedForStats('stats-shop'),
      /DB_STATS_PAGE_LIMIT_REACHED/
    );
    await assert.rejects(
      dbComputeShopRevenueAndInventoryStats('stats-shop', items),
      /DB_STATS_PAGE_LIMIT_REACHED/
    );
    const truncatedGetRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${issueSessionToken({
            id: 'owner-stats',
            email: 'owner-stats@test.local',
            role: 'owner',
          })}`,
        },
      })
    );
    assert.equal(truncatedGetRes.status, 500);
    const truncatedGetJson = await truncatedGetRes.json();
    assert.equal(truncatedGetJson.code, 'DB_STATS_PAGE_LIMIT_REACHED');
    disableRangeSupport = false;

    // 3c. Fail-closed when maxPages is reached while the final page is still full (both bounded maxPages=1 on PGlite and default 100-page cap)
    await assert.rejects(
      dbComputeShopRevenueAndInventoryStats('stats-shop', items, {
        maxPages: 1,
      }),
      /DB_STATS_PAGE_LIMIT_REACHED/
    );

    let fullPagesRequested = 0;
    const hundredFullPagesClient = {
      from: () => {
        let rangeStart = 0;
        let rangeEnd = 999;
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          range: (from: number, to: number) => {
            rangeStart = from;
            rangeEnd = to;
            return builder;
          },
          then: (
            resolve: (result: unknown) => unknown,
            reject: (error: unknown) => unknown
          ) => {
            fullPagesRequested += 1;
            const count = rangeEnd - rangeStart + 1;
            const rows = Array.from({ length: count }, (_, idx) => ({
              id: `synthetic-ord-${rangeStart + idx}`,
              shop_id: 'stats-shop',
              status: 'completed',
              payment_status: 'paid',
              payment_method: 'cash',
              source: 'qr_table',
              total_amount: 10000,
              items: [],
              created_at: `${todayVnDate}T12:00:00.000+07:00`,
              updated_at: `${todayVnDate}T12:00:00.000+07:00`,
            }));
            return Promise.resolve({ data: rows, error: null }).then(
              resolve,
              reject
            );
          },
        };
        return builder;
      },
    };
    await assert.rejects(
      fetchAllShopOrdersPaginatedForStats(
        'stats-shop',
        hundredFullPagesClient as never
      ),
      /DB_STATS_PAGE_LIMIT_REACHED/
    );
    assert.equal(
      fullPagesRequested,
      100,
      'default STATS_ORDER_MAX_PAGES=100 must fail closed when the 100th page is still full'
    );

    disableStatsRpc = false;

    // 4. dbGetShopAnalyticsSummary uses the uncapped server-side summary
    const analyticsSummary = await dbGetShopAnalyticsSummary('stats-shop');
    assert.equal(analyticsSummary.todayRevenue, 10777000);
    assert.equal(analyticsSummary.totalRevenue, 11110000);
    assert.equal(analyticsSummary.totalOrdersCount, 1005);
    assert.equal(analyticsSummary.completedOrdersCount, 1003);

    // 5. GET /api/orders returns bounded 1000-row orders list + uncapped stats for reports.view owner,
    //    and Mobile Overview (buildMobileOverviewMetrics) reflects the uncapped >1000-order summary
    const ownerToken = issueSessionToken({
      id: 'owner-stats',
      email: 'owner-stats@test.local',
      role: 'owner',
    });
    const ownerRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${ownerToken}` },
      })
    );
    assert.equal(ownerRes.status, 200);
    const ownerJson = await ownerRes.json();
    assert.equal(ownerJson.orders.length, 1000);
    assert.equal(ownerJson.stats.todayRevenue, 10777000);
    assert.equal(ownerJson.stats.totalRevenue, 11110000);
    assert.equal(ownerJson.stats.paidOrdersCount, 1002);
    assert.equal(ownerJson.stats.newOrdersCount, 1);
    assert.equal(ownerJson.stats.preparingOrdersCount, 1);

    const mobileOverview = buildMobileOverviewMetrics({
      stats: ownerJson.stats,
      items: ownerJson.items,
      events: [],
    });
    assert.equal(mobileOverview.todayRevenue, 10777000);
    assert.equal(mobileOverview.totalRevenue, 11110000);
    assert.equal(mobileOverview.validOrdersCount, 1002);
    assert.equal(mobileOverview.newOrdersCount, 1);
    assert.equal(mobileOverview.preparingOrdersCount, 1);
    assert.equal(
      mobileOverview.sevenDayBars.find((b) => b.dateKey === threeDaysAgoVn)
        ?.revenue,
      333000
    );
    assert.equal(
      mobileOverview.sevenDayBars.find((b) => b.dateKey === todayVnDate)
        ?.revenue,
      10777000
    );

    // 6. Staff without reports.view gets redacted financial fields (null) while operational counts remain uncapped
    const staffToken = issueSessionToken({
      id: 'staff-stats',
      email: 'staff-stats@test.local',
      role: 'staff',
    });
    const staffRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${staffToken}` },
      })
    );
    assert.equal(staffRes.status, 200);
    const staffJson = await staffRes.json();
    assert.equal(staffJson.stats.todayRevenue, null);
    assert.equal(staffJson.stats.totalRevenue, null);
    assert.equal(staffJson.stats.avgOrderValue, null);
    assert.equal(staffJson.stats.paidOrdersCount, 1002);
    assert.deepEqual(staffJson.stats.dailyRevenue7d, []);
    assert.equal(staffJson.stats.totalOrdersCount, 1005);
    assert.equal(staffJson.stats.newOrdersCount, 1);
    assert.equal(staffJson.stats.preparingOrdersCount, 1);

    // 6b. KDS read path (dbGetShopActiveKitchenOrders & GET /api/orders?shopId=...&view=kds):
    //     - Filters to 'new' and 'preparing' in the DB BEFORE the 1000-row cap so active orders older than
    //       1000 newer completed orders are never lost.
    //     - Paginates across pages via .range(), isolates by shopId, requires orders.view, and omits catalog/stats work.
    await db.exec(`
      INSERT INTO profiles(id, email) VALUES ('catalog-only-user', 'catalog-only@test.local'), ('other-shop-owner', 'other-owner@test.local');
      INSERT INTO shops(id, owner_id, slug, name, is_published) VALUES ('other-kds-shop', 'other-shop-owner', 'other-kds-shop', 'Other KDS Shop', true);
      INSERT INTO shop_memberships(id, shop_id, user_id, role, permissions, is_active)
        VALUES ('mem-catalog-only', 'stats-shop', 'catalog-only-user', 'staff', '["catalog.manage"]'::jsonb, true);
      INSERT INTO orders (
        id, shop_id, order_code, table_label, visitor_lang, status, payment_method, payment_status,
        items, subtotal_amount, discount_amount, total_amount, source, created_at, updated_at
      ) VALUES (
        'ord-other-shop-active', 'other-kds-shop', 'OTH-01', 'Bàn 01', 'vi', 'new', 'cash', 'unpaid',
        '[]'::jsonb, 10000, 0, 10000, 'qr_table', NOW(), NOW()
      );
    `);

    // General dbGetShopOrders('stats-shop') only sees the 1000 newer completed orders
    assert.equal(
      cappedOrders.some(
        (o) =>
          o.id === 'ord-beyond-1004-new-unpaid' ||
          o.id === 'ord-beyond-1005-prep-unpaid'
      ),
      false,
      'Unfiltered 1000-row list misses the 2 older active orders behind 1000 completed orders'
    );

    // Scoped KDS helper retrieves both older active orders sorted oldest-first (05:00 before 06:00)
    const activeKdsOrders = await dbGetShopActiveKitchenOrders('stats-shop');
    assert.deepEqual(
      activeKdsOrders.map((o) => o.id),
      ['ord-beyond-1005-prep-unpaid', 'ord-beyond-1004-new-unpaid'],
      'dbGetShopActiveKitchenOrders must return active orders older than 1000 newer completed orders, oldest first'
    );

    // Multi-page .range() pagination for KDS when active orders span multiple pages
    const multiPageKdsOrders = await dbGetShopActiveKitchenOrders(
      'stats-shop',
      undefined,
      { pageSize: 1, maxPages: 5 }
    );
    assert.deepEqual(
      multiPageKdsOrders.map((o) => o.id),
      ['ord-beyond-1005-prep-unpaid', 'ord-beyond-1004-new-unpaid']
    );
    await assert.rejects(
      dbGetShopActiveKitchenOrders('stats-shop', undefined, {
        pageSize: 1,
        maxPages: 1,
      }),
      /DB_KDS_PAGE_LIMIT_REACHED/
    );

    // KDS API route: anonymous -> 401, missing shopId -> 400, member without orders.view -> 403, cross-shop -> 403
    const anonKdsRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop&view=kds')
    );
    assert.equal(anonKdsRes.status, 401);

    const missingShopKdsRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?view=kds', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${staffToken}` },
      })
    );
    assert.equal(missingShopKdsRes.status, 400);
    const missingShopKdsJson = await missingShopKdsRes.json();
    assert.equal(missingShopKdsJson.code, 'SHOP_ID_REQUIRED');

    const catalogOnlyToken = issueSessionToken({
      id: 'catalog-only-user',
      email: 'catalog-only@test.local',
      role: 'staff',
    });
    const forbiddenKdsRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop&view=kds', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${catalogOnlyToken}` },
      })
    );
    assert.equal(forbiddenKdsRes.status, 403);

    const crossShopKdsRes = await getOrdersRoute(
      new Request(
        'http://localhost/api/orders?shopId=other-kds-shop&view=kds',
        {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${staffToken}` },
        }
      )
    );
    assert.equal(crossShopKdsRes.status, 403);

    // Authorized KDS API route returns only active orders for stats-shop + membership, without stats/catalog/serviceRequests
    const kdsRes = await getOrdersRoute(
      new Request('http://localhost/api/orders?shopId=stats-shop&view=kds', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${staffToken}` },
      })
    );
    assert.equal(kdsRes.status, 200);
    const kdsJson = await kdsRes.json();
    assert.deepEqual(
      kdsJson.orders.map((o: { id: string }) => o.id),
      ['ord-beyond-1005-prep-unpaid', 'ord-beyond-1004-new-unpaid']
    );
    assert.equal(kdsJson.membership?.user_id, 'staff-stats');
    assert.equal('stats' in kdsJson, false, 'KDS response must omit stats work');
    assert.equal(
      'serviceRequests' in kdsJson,
      false,
      'KDS response must omit serviceRequests work'
    );

    // 7. PATCH /api/orders requires non-empty refund_reason and cancelled_reason and persists user-entered reasons
    const orderForRefund = await dbCreateOrder({
      shop_id: 'stats-shop',
      table_label: 'Bàn 08',
      items: [
        {
          item_id: 'stats-item',
          name_vi: 'Cà phê muối',
          quantity: 1,
          unit_price: 10000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(orderForRefund.id, {
      status: 'completed',
      payment_status: 'paid',
      expected_total: 10000,
    });

    const emptyRefundRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`,
        },
        body: JSON.stringify({
          shop_id: 'stats-shop',
          orderId: orderForRefund.id,
          status: 'completed',
          payment_status: 'refunded',
          refund_reason: '   ',
        }),
      })
    );
    assert.equal(emptyRefundRes.status, 400);
    const emptyRefundJson = await emptyRefundRes.json();
    assert.equal(emptyRefundJson.code, 'REFUND_REASON_REQUIRED');

    const mobileRefundBuilt = buildOrderStatusPatchPayload({
      shopId: 'stats-shop',
      orderId: orderForRefund.id,
      status: 'completed',
      payment_status: 'refunded',
      options: { refundReason: '  Khách báo món bị nguội  ' },
    });
    assert.equal(mobileRefundBuilt.ok, true);
    if (mobileRefundBuilt.ok) {
      const validRefundRes = await patchOrdersRoute(
        new Request('http://localhost/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`,
          },
          body: JSON.stringify(mobileRefundBuilt.payload),
        })
      );
      assert.equal(validRefundRes.status, 200);
      const validRefundJson = await validRefundRes.json();
      assert.equal(validRefundJson.order.payment_status, 'refunded');
      assert.equal(
        validRefundJson.order.refund_reason,
        'Khách báo món bị nguội'
      );
    }

    const orderForCancel = await dbCreateOrder({
      shop_id: 'stats-shop',
      table_label: 'Bàn 09',
      items: [
        {
          item_id: 'stats-item',
          name_vi: 'Cà phê muối',
          quantity: 1,
          unit_price: 10000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    await dbUpdateOrderStatus(orderForCancel.id, { status: 'preparing' });

    const emptyCancelRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`,
        },
        body: JSON.stringify({
          shop_id: 'stats-shop',
          orderId: orderForCancel.id,
          status: 'cancelled',
        }),
      })
    );
    assert.equal(emptyCancelRes.status, 400);
    const emptyCancelJson = await emptyCancelRes.json();
    assert.equal(emptyCancelJson.code, 'CANCEL_REASON_REQUIRED');

    const mobileCancelBuilt = buildOrderStatusPatchPayload({
      shopId: 'stats-shop',
      orderId: orderForCancel.id,
      status: 'cancelled',
      existingOrder: {
        id: orderForCancel.id,
        status: 'preparing',
        payment_status: 'unpaid',
        total_amount: 10000,
      },
      options: { cancelledReason: '  Khách hủy món khi đang làm  ' },
    });
    assert.equal(mobileCancelBuilt.ok, true);
    if (mobileCancelBuilt.ok) {
      const validCancelRes = await patchOrdersRoute(
        new Request('http://localhost/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            cookie: `${SESSION_COOKIE_NAME}=${ownerToken}`,
          },
          body: JSON.stringify(mobileCancelBuilt.payload),
        })
      );
      assert.equal(validCancelRes.status, 200);
      const validCancelJson = await validCancelRes.json();
      assert.equal(validCancelJson.order.status, 'cancelled');
      assert.equal(
        validCancelJson.order.cancelled_reason,
        'Khách hủy món khi đang làm'
      );
      assert.equal(mobileCancelBuilt.payload.restock_items, false);
      assert.equal(validCancelJson.order.waste_recorded, true);
    }
  } finally {
    setMposDbClientForTests(null);
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    await db.close();
  }
});
