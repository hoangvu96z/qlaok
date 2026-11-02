import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
  resetMposStoreForTests,
  setMposDbClientForTests,
} from '@/lib/mpos-store';
import {
  dbGetShopAnalyticsSummary,
  dbGetShopCatalog,
  setOrderAuditDbClientForTests,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import {
  issueSessionToken,
  SESSION_COOKIE_NAME,
  setOrderAuditLogFileForTests,
} from '@/lib/server-auth';
import { getGuestOrderIdempotencyKey } from '@/lib/guest-order-idempotency';
import {
  setShopTablesDbClientForTests,
  signTableQr,
} from '@/lib/shop-tables';
import {
  GET as getOrdersRoute,
  PATCH as patchOrdersRoute,
  POST as postOrdersRoute,
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
    const optionGroups = [
      {
        id: 'size',
        name_i18n: { vi: 'Kích cỡ' },
        required: true,
        choices: [
          { id: 'size-small', label_vi: 'Nhỏ', label_i18n: { vi: 'Nhỏ' }, extra_price: 1000 },
          { id: 'size-large', label_vi: 'Lớn', label_i18n: { vi: 'Lớn' }, extra_price: 3000 },
        ],
      },
      {
        id: 'toppings',
        name_i18n: { vi: 'Thêm món' },
        required: false,
        choices: [
          { id: 'topping-cheese', label_vi: 'Phô mai', label_i18n: { vi: 'Phô mai' }, extra_price: 2000 },
          { id: 'topping-egg', label_vi: 'Trứng', label_i18n: { vi: 'Trứng' }, extra_price: 1500 },
        ],
      },
    ];
    await db.query(
      `INSERT INTO items(id,shop_id,category_id,price,stock_quantity,options_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      ['engine-item-options', 'engine-shop', 'engine-cat', 10000, 10, JSON.stringify(optionGroups)]
    );
    setMposDbClientForTests(client, true);
    const create = (quantity = 2, table = 'Table A') => dbCreateOrder({ shop_id: 'engine-shop', table_label: table,
      items: [{ item_id: 'engine-item', name_vi: 'Fixture', quantity, unit_price: 1, extra_price: 0, selected_choices: [] }],
    });
    const createOptionsOrder = (
      table: string,
      selected_choices: Parameters<typeof dbCreateOrder>[0]['items'][number]['selected_choices']
    ) => dbCreateOrder({
      shop_id: 'engine-shop',
      table_label: table,
      apply_shop_promotions: false,
      items: [{
        item_id: 'engine-item-options',
        name_vi: 'Options fixture',
        quantity: 1,
        unit_price: 1,
        extra_price: 0,
        selected_choices,
      }],
    });
    const order = await create();
    assert.equal(order.total_amount, 20000, 'catalog price must override submitted price');
    assert.equal((await db.query<{ stock_quantity: number }>("SELECT stock_quantity FROM items WHERE id='engine-item'")).rows[0].stock_quantity, 8);
    const orderCountBeforeInvalidOptions = Number(
      (await db.query<{ count: string }>('SELECT count(*)::text AS count FROM orders')).rows[0].count
    );
    const selectedOption = (id: string, label: string, extra_price: number) => ({
      id,
      label_vi: label,
      label_i18n: { vi: label },
      extra_price,
    });
    await assert.rejects(createOptionsOrder('Missing required option', []), /REQUIRED_OPTION/);
    await assert.rejects(
      createOptionsOrder('Multiple radio choices', [
        selectedOption('size-small', 'Nhỏ', 1000),
        selectedOption('size-large', 'Lớn', 3000),
      ]),
      /MULTIPLE_OPTIONS/
    );
    await assert.rejects(
      createOptionsOrder('Duplicate checkbox choice', [
        selectedOption('size-small', 'Nhỏ', 1000),
        selectedOption('topping-egg', 'Trứng', 1500),
        selectedOption('topping-egg', 'Trứng', 1500),
      ]),
      /DUPLICATE_OPTION/
    );
    assert.equal(
      Number((await db.query<{ count: string }>('SELECT count(*)::text AS count FROM orders')).rows[0].count),
      orderCountBeforeInvalidOptions,
      'invalid option selections must fail before an order is committed'
    );
    const optionsOrder = await createOptionsOrder('Valid options', [
      selectedOption('', 'Lớn', 999999), // Legacy label form and a forged client price are canonicalized from the catalog.
      selectedOption('topping-cheese', 'Phô mai', 0),
      selectedOption('topping-egg', 'Trứng', 0),
    ]);
    assert.equal(optionsOrder.items[0].extra_price, 6500);
    assert.equal(optionsOrder.total_amount, 16500);
    assert.deepEqual(
      optionsOrder.items[0].selected_choices?.map((choice) => choice.id),
      ['size-large', 'topping-cheese', 'topping-egg']
    );
    failRpc = true;
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid' }), /injected DB failure/);
    assert.equal((await dbGetOrderById(order.id))?.payment_status, 'unpaid', 'failed payment must not be cached as paid');
    await assert.rejects(create(1), /injected DB failure/);
    assert.equal((await db.query('SELECT id FROM orders')).rows.length, orderCountBeforeInvalidOptions + 1);
    failRpc = false;
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid', expected_total: 1 }), /Tổng tiền/);
    const paid = await dbUpdateOrderStatus(order.id, { payment_status: 'paid', expected_total: 20000 });
    assert.equal(paid.status, 'new', 'payment must not mark fulfillment completed');
    await assert.rejects(
      dbUpdateOrderStatus(order.id, { status: 'completed', payment_status: 'paid' }),
      /FULFILLMENT_CANNOT_COLLECT_PAYMENT/
    );
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'unpaid' }), /INVALID_PAYMENT_TRANSITION/);
    await dbUpdateOrderStatus(order.id, { payment_status: 'refunded', refund_reason: 'Fixture refund' });
    await assert.rejects(dbUpdateOrderStatus(order.id, { payment_status: 'paid' }), /INVALID_PAYMENT_TRANSITION/);
    const paidCancellation = await create(1, 'Paid cancellation fixture');
    await dbUpdateOrderStatus(paidCancellation.id, { payment_status: 'paid' });
    await assert.rejects(
      dbUpdateOrderStatus(paidCancellation.id, { status: 'cancelled' }),
      /PAID_ORDER_REQUIRES_EXPLICIT_REFUND/
    );
    await assert.rejects(
      dbUpdateOrderStatus(paidCancellation.id, {
        status: 'cancelled',
        payment_status: 'refunded',
        cancelled_reason: 'Customer cancelled',
      }),
      /REFUND_REASON_REQUIRED/
    );
    const cancelledPaidOrder = await dbUpdateOrderStatus(paidCancellation.id, {
      status: 'cancelled',
      payment_status: 'refunded',
      refund_reason: 'Manual refund confirmed',
      cancelled_reason: 'Customer cancelled',
    });
    assert.equal(cancelledPaidOrder.payment_status, 'refunded');
    assert.equal(cancelledPaidOrder.refund_reason, 'Manual refund confirmed');
    assert.equal(cancelledPaidOrder.cancelled_reason, 'Customer cancelled');
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

    const discounted = await dbCreateOrder({
      shop_id: 'engine-shop',
      table_label: 'Discount fixture',
      discount_amount: 500,
      apply_shop_promotions: true,
      canApplyDiscount: true,
      themeConfigOverride: {
        primaryColor: '#000000',
        layout: 'list',
        promoBanner: {
          enabled: true,
          title: 'Fixture promotion',
          discountType: 'percent',
          discountValue: 10,
        },
      },
      items: [{ item_id: 'engine-item', name_vi: 'Fixture', quantity: 2, unit_price: 10000, extra_price: 0, selected_choices: [] }],
    });
    assert.equal(discounted.subtotal_amount, 20000);
    assert.equal(discounted.promo_discount_amount, 2000);
    assert.equal(discounted.manual_discount_amount, 500);
    assert.equal(discounted.discount_amount, 2500);
    assert.equal(discounted.total_amount, 17500);

    const discountPreserved = await dbUpdateOrderStatus(discounted.id, {
      items: discounted.items,
      discount_amount: discounted.manual_discount_amount,
      apply_shop_promotions: false,
      canApplyDiscount: false,
      expected_total: discounted.total_amount,
    });
    assert.equal(discountPreserved.promo_discount_amount, 2000);
    assert.equal(discountPreserved.manual_discount_amount, 500);
    assert.equal(discountPreserved.discount_amount, 2500);
    assert.equal(discountPreserved.total_amount, 17500);

    const lineDiscounted = await dbCreateOrder({
      shop_id: 'engine-shop',
      table_label: 'Line discount fixture',
      discount_amount: 500,
      canApplyDiscount: true,
      items: [
        {
          item_id: 'engine-item',
          name_vi: 'Fixture',
          quantity: 1,
          unit_price: 10000,
          original_unit_price: 10000,
          custom_unit_price: 9000,
          extra_price: 0,
          selected_choices: [],
        },
        {
          item_id: 'engine-item',
          name_vi: 'Fixture',
          quantity: 1,
          unit_price: 10000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });
    assert.equal(lineDiscounted.manual_discount_amount, 1500);
    assert.equal(lineDiscounted.total_amount, 18500);

    const guestEditPreservesOriginalLineDiscount = await dbUpdateOrderStatus(lineDiscounted.id, {
      items: lineDiscounted.items,
      canApplyDiscount: false,
      expected_total: 18500,
    });
    assert.equal(guestEditPreservesOriginalLineDiscount.items[0].custom_unit_price, 9000);
    assert.equal(guestEditPreservesOriginalLineDiscount.items[1].custom_unit_price, null);
    assert.equal(guestEditPreservesOriginalLineDiscount.manual_discount_amount, 1500);
    assert.equal(guestEditPreservesOriginalLineDiscount.total_amount, 18500);

    const removedDiscountedLine = await dbUpdateOrderStatus(lineDiscounted.id, {
      items: [{
        ...lineDiscounted.items[1],
        custom_unit_price: 0,
        discount_percent: 99,
      }],
      canApplyDiscount: false,
      expected_total: 9500,
    });
    assert.equal(removedDiscountedLine.items[0].custom_unit_price, null);
    assert.equal(removedDiscountedLine.items[0].discount_percent, undefined);
    assert.equal(removedDiscountedLine.manual_discount_amount, 500);
    assert.equal(removedDiscountedLine.total_amount, 9500);

    const orderWithDeletedCatalogItem = await dbCreateOrder({
      shop_id: 'engine-shop',
      table_label: 'Deleted item cancellation fixture',
      items: [{
        item_id: 'engine-item-options',
        name_vi: 'Options fixture',
        quantity: 1,
        unit_price: 10000,
        extra_price: 0,
        selected_choices: [selectedOption('size-large', 'Lớn', 3000)],
      }],
    });
    await db.query("DELETE FROM items WHERE id='engine-item-options'");
    const cancellationAfterCatalogDeletion = await dbUpdateOrderStatus(
      orderWithDeletedCatalogItem.id,
      { status: 'cancelled' }
    );
    assert.equal(cancellationAfterCatalogDeletion.status, 'cancelled');
    await assert.rejects(
      dbUpdateOrderStatus(orderWithDeletedCatalogItem.id, { status: 'new' }),
      /ITEM_NOT_IN_SHOP/
    );
    assert.equal(
      (await dbGetOrderById(orderWithDeletedCatalogItem.id))?.status,
      'cancelled',
      'reopening must stay blocked when its catalog item no longer exists'
    );
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
      payment_status: 'paid',
      expected_total: 10000,
    });
    await dbUpdateOrderStatus(orderForRefund.id, { status: 'completed' });

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

test('POST /api/orders guest storefront checkout against isolated PostgreSQL enforces server pricing, stock decrement, idempotent replay, and payment/fulfillment independence', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const tempAuditDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qlaok-storefront-order-qa-')
  );
  const previousSessionSecret = process.env.SESSION_SECRET;

  const ident = (name: string) => {
    assert.match(name, /^[a-z_][a-z0-9_]*$/i);
    return `"${name}"`;
  };

  class PgQueryBuilder {
    private table: string;
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private neqFilters: Array<[string, unknown]> = [];
    private ilikeFilters: Array<[string, string]> = [];
    private inFilters: Array<[string, unknown[]]> = [];
    private singleMode: 'none' | 'maybe' | 'single' = 'none';
    private payload: Record<string, unknown> | null = null;
    private orderSpecs: Array<{ col: string; ascending: boolean }> = [];
    private limitCount: number | null = null;
    private rangeSpec: { from: number; to: number } | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select(columns = '*') {
      if (this.mode === 'select') {
        this.columns = columns;
      }
      return this;
    }

    insert(row: Record<string, unknown> | Array<Record<string, unknown>>) {
      this.mode = 'insert';
      this.payload = Array.isArray(row) ? (row[0] ?? {}) : row;
      return this;
    }

    update(patch: Record<string, unknown>) {
      this.mode = 'update';
      this.payload = patch;
      return this;
    }

    delete() {
      this.mode = 'delete';
      return this;
    }

    eq(col: string, val: unknown) {
      this.eqFilters.push([col, val]);
      return this;
    }

    neq(col: string, val: unknown) {
      this.neqFilters.push([col, val]);
      return this;
    }

    ilike(col: string, pattern: string) {
      this.ilikeFilters.push([col, pattern]);
      return this;
    }

    in(col: string, values: unknown[]) {
      this.inFilters.push([col, values]);
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.orderSpecs.push({ col, ascending: opts?.ascending !== false });
      return this;
    }

    limit(n: number) {
      this.limitCount = n;
      return this;
    }

    range(from: number, to: number) {
      this.rangeSpec = { from, to };
      return this;
    }

    maybeSingle() {
      this.singleMode = 'maybe';
      return this.execute();
    }

    single() {
      this.singleMode = 'single';
      return this.execute();
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
    }

    private async execute(): Promise<{ data: unknown; error: unknown }> {
      try {
        const params: unknown[] = [];
        const buildWhere = () => {
          const clauses: string[] = [];
          for (const [col, val] of this.eqFilters) {
            if (val === null) {
              clauses.push(`${ident(col)} IS NULL`);
            } else {
              params.push(val);
              clauses.push(`${ident(col)} = $${params.length}`);
            }
          }
          for (const [col, val] of this.neqFilters) {
            params.push(val);
            clauses.push(`${ident(col)} <> $${params.length}`);
          }
          for (const [col, pat] of this.ilikeFilters) {
            params.push(pat);
            clauses.push(`${ident(col)} ILIKE $${params.length}`);
          }
          for (const [col, vals] of this.inFilters) {
            if (vals.length === 0) {
              clauses.push('FALSE');
            } else {
              const ph = vals.map((v) => {
                params.push(v);
                return `$${params.length}`;
              });
              clauses.push(`${ident(col)} IN (${ph.join(', ')})`);
            }
          }
          return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
        };

        if (this.mode === 'insert' && this.payload) {
          const keys = Object.keys(this.payload).filter(
            (k) => this.payload![k] !== undefined
          );
          const cols = keys.map(ident).join(', ');
          const placeholders = keys.map((k) => {
            const v = this.payload![k];
            if (v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v));
              return `$${params.length}::jsonb`;
            }
            params.push(v);
            return `$${params.length}`;
          });
          const { rows } = await db.query(
            `INSERT INTO ${ident(this.table)} (${cols}) VALUES (${placeholders.join(', ')}) RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }

        if (this.mode === 'update' && this.payload) {
          const keys = Object.keys(this.payload).filter(
            (k) => this.payload![k] !== undefined
          );
          const sets = keys.map((k) => {
            const v = this.payload![k];
            if (v !== null && typeof v === 'object') {
              params.push(JSON.stringify(v));
              return `${ident(k)} = $${params.length}::jsonb`;
            }
            params.push(v);
            return `${ident(k)} = $${params.length}`;
          });
          const whereSql = buildWhere();
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${sets.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }

        if (this.mode === 'delete') {
          const whereSql = buildWhere();
          const { rows } = await db.query(
            `DELETE FROM ${ident(this.table)}${whereSql} RETURNING *`,
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
        const whereSql = buildWhere();
        const orderSql = this.orderSpecs.length
          ? ` ORDER BY ${this.orderSpecs
              .map((o) => `${ident(o.col)} ${o.ascending ? 'ASC' : 'DESC'}`)
              .join(', ')}`
          : '';
        let limitOffsetSql = '';
        if (this.rangeSpec) {
          const count = Math.max(0, this.rangeSpec.to - this.rangeSpec.from + 1);
          limitOffsetSql = ` LIMIT ${count} OFFSET ${Math.max(0, this.rangeSpec.from)}`;
        } else if (typeof this.limitCount === 'number') {
          limitOffsetSql = ` LIMIT ${Math.max(0, Math.floor(this.limitCount))}`;
        }

        const { rows } = await db.query(
          `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}${orderSql}${limitOffsetSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        const pgErr = err as { code?: string; message?: string };
        return {
          data: null,
          error: {
            code: pgErr?.code || 'PGLITE_ERR',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
  }

  const pgClient = {
    from(table: string) {
      return new PgQueryBuilder(table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      try {
        assert.match(name, /^[a-z_]+$/);
        const keys = Object.keys(args);
        const values: unknown[] = [];
        const paramList = keys
          .map((k) => {
            assert.match(k, /^[a-z_]+$/);
            const v = args[k];
            if (v !== null && typeof v === 'object') {
              values.push(JSON.stringify(v));
              return `${k} := $${values.length}::jsonb`;
            }
            values.push(v);
            return `${k} := $${values.length}`;
          })
          .join(', ');
        const { rows } = await db.query<{ result: unknown }>(
          `SELECT public.${name}(${paramList}) AS result`,
          values
        );
        return { data: rows[0]?.result ?? null, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };

  try {
    process.env.SESSION_SECRET = 'synthetic-test-session-secret-storefront-qa-0000';

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

    const optionGroupsJson = JSON.stringify([
      {
        id: 'size',
        name_i18n: { vi: 'Kích cỡ', en: 'Size' },
        required: true,
        choices: [
          {
            id: 'size-regular',
            label_vi: 'Tô thường',
            label_i18n: { vi: 'Tô thường', en: 'Regular' },
            extra_price: 0,
          },
          {
            id: 'size-special',
            label_vi: 'Tô đặc biệt',
            label_i18n: { vi: 'Tô đặc biệt', en: 'Special' },
            extra_price: 15000,
          },
        ],
      },
    ]);

    await db.exec(`
      INSERT INTO profiles (id, email, plan) VALUES
        ('owner-qa-storefront', 'owner-qa@test.local', 'premium'),
        ('staff-qa-fulfill', 'staff-fulfill@test.local', 'free'),
        ('cashier-qa-collect', 'cashier-collect@test.local', 'free');
      INSERT INTO shops (id, owner_id, slug, name, is_published, opening_hours) VALUES (
        'shop-qa-storefront',
        'owner-qa-storefront',
        'shop-qa-storefront',
        'QA Storefront Shop',
        true,
        '{"mon":{"open":"00:00","close":"23:59","closed":false},"tue":{"open":"00:00","close":"23:59","closed":false},"wed":{"open":"00:00","close":"23:59","closed":false},"thu":{"open":"00:00","close":"23:59","closed":false},"fri":{"open":"00:00","close":"23:59","closed":false},"sat":{"open":"00:00","close":"23:59","closed":false},"sun":{"open":"00:00","close":"23:59","closed":false}}'::jsonb
      ), (
        'shop-qa-unpublished',
        'owner-qa-storefront',
        'shop-qa-unpublished',
        'Unpublished QA Shop',
        false,
        '{}'::jsonb
      );
      INSERT INTO categories (id, shop_id, name_i18n) VALUES
        ('cat-qa-main', 'shop-qa-storefront', '{"vi":"Món chính"}'),
        ('cat-qa-unpublished', 'shop-qa-unpublished', '{"vi":"Món thử"}');
      INSERT INTO shop_tables (id, shop_id, table_code, name, is_active, sort_order) VALUES
        ('tbl-qa-01', 'shop-qa-storefront', 'T01', 'Bàn QA 01', true, 1),
        ('tbl-qa-inactive', 'shop-qa-storefront', 'T02', 'Bàn Khóa', false, 2);
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-qa-fulfill', 'shop-qa-storefront', 'staff-qa-fulfill', 'staff', '["orders.view","orders.fulfill"]'::jsonb, true),
        ('mem-qa-collect', 'shop-qa-storefront', 'cashier-qa-collect', 'cashier', '["orders.view","payment.collect"]'::jsonb, true);
    `);
    await db.query(
      `INSERT INTO items (
        id, shop_id, category_id, price, stock_quantity, sold_count, is_available, name_i18n, options_json
      ) VALUES (
        'item-qa-pho', 'shop-qa-storefront', 'cat-qa-main', 55000, 5, 0, true, '{"vi":"Phở bò QA"}', $1::jsonb
      )`,
      [optionGroupsJson]
    );
    await db.query(
      `INSERT INTO items (
        id, shop_id, category_id, price, stock_quantity, sold_count, is_available, name_i18n
      ) VALUES (
        'item-qa-unpublished', 'shop-qa-unpublished', 'cat-qa-unpublished', 10000, 3, 0, true, '{"vi":"Món thử"}'
      )`
    );

    resetMposStoreForTests();
    setSupabaseDbClientForTests(pgClient as never);
    setMposDbClientForTests(pgClient as never, true);
    setShopMembershipDbClientForTest(pgClient as never);
    setShopTablesDbClientForTests(pgClient as never, true);
    setOrderAuditDbClientForTests(pgClient as never, { forceDbMode: true });
    setOrderAuditLogFileForTests(path.join(tempAuditDir, 'order-audit.jsonl'));

    // 1. Anonymous dine-in order WITHOUT signed Table QR is rejected (400) with zero DB mutation
    const unpublishedGuestQuote = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote',
          shop_id: 'shop-qa-unpublished',
          items: [],
        }),
      })
    );
    assert.equal(unpublishedGuestQuote.status, 404);
    assert.equal((await unpublishedGuestQuote.json()).code, 'SHOP_NOT_PUBLISHED');

    const unpublishedGuestCreate = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: 'shop-qa-unpublished', items: [] }),
      })
    );
    assert.equal(unpublishedGuestCreate.status, 404);
    assert.equal((await unpublishedGuestCreate.json()).code, 'SHOP_NOT_PUBLISHED');

    const ownerCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken({
      id: 'owner-qa-storefront',
      email: 'owner-qa@test.local',
    })}`;
    const unpublishedOwnerQuote = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          action: 'quote',
          shop_id: 'shop-qa-unpublished',
          items: [{ item_id: 'item-qa-unpublished', quantity: 1 }],
        }),
      })
    );
    assert.equal(unpublishedOwnerQuote.status, 200);
    assert.equal((await unpublishedOwnerQuote.json()).quote.total_amount, 10000);

    const unpublishedOwnerPosOrder = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          shop_id: 'shop-qa-unpublished',
          source: 'counter_pos',
          table_label: 'Mang về',
          items: [
            {
              item_id: 'item-qa-unpublished',
              name_vi: 'Món thử',
              quantity: 1,
              unit_price: 10000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(unpublishedOwnerPosOrder.status, 201);
    assert.equal(
      (await unpublishedOwnerPosOrder.json()).order.source,
      'counter_pos'
    );

    const unsignedGuestRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          table_label: 'Bàn QA 01',
          visitor_lang: 'vi',
          payment_method: 'cash',
          items: [
            {
              item_id: 'item-qa-pho',
              name_vi: 'Phở bò QA',
              quantity: 1,
              unit_price: 55000,
              extra_price: 0,
              selected_choices: [
                {
                  group_id: 'size',
                  id: 'size-regular',
                  label_vi: 'Tô thường',
                  extra_price: 0,
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(unsignedGuestRes.status, 400);
    assert.equal(
      (await unsignedGuestRes.json()).code,
      'MISSING_TABLE_QR_SIGNATURE'
    );

    const inactiveSig = signTableQr('shop-qa-storefront', 'tbl-qa-inactive');
    const inactiveTableRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          table_id: 'tbl-qa-inactive',
          table_qr_sig: inactiveSig,
          qr_table_mode: true,
          table_label: 'Bàn Khóa',
          items: [
            {
              item_id: 'item-qa-pho',
              name_vi: 'Phở bò QA',
              quantity: 1,
              unit_price: 55000,
              extra_price: 0,
              selected_choices: [
                {
                  group_id: 'size',
                  id: 'size-regular',
                  label_vi: 'Tô thường',
                  extra_price: 0,
                },
              ],
            },
          ],
        }),
      })
    );
    assert.equal(inactiveTableRes.status, 400);
    assert.equal((await inactiveTableRes.json()).code, 'INACTIVE_SHOP_TABLE');

    // 2. Valid anonymous signed Table QR storefront order:
    //    Server overrides tampered unit_price/extra_price/table_label/discount and ignores forged paid/completed flags.
    const validTableSig = signTableQr('shop-qa-storefront', 'tbl-qa-01');
    const guestQrIntent = {
      shop_id: 'shop-qa-storefront',
      table_id: 'tbl-qa-01',
      table_qr_sig: validTableSig,
      qr_table_mode: true,
      table_label: 'Spoofed VIP Table',
      visitor_lang: 'vi',
      payment_method: 'vietqr',
      expected_total: 140000,
      payment_status: 'paid',
      markCompletedImmediately: true,
      discount_amount: 40000,
      customer_note: 'Ít hành',
      items: [
        {
          item_id: 'item-qa-pho',
          name_vi: 'Tampered Client Name',
          quantity: 2,
          unit_price: 1,
          extra_price: 0,
          selected_choices: [
            {
              group_id: 'size',
              id: 'size-special',
              label_vi: 'Tampered Choice',
              extra_price: 0,
            },
          ],
        },
      ],
    };
    const guestQrPayload = {
      ...guestQrIntent,
      idempotency_key: await getGuestOrderIdempotencyKey(guestQrIntent),
    };

    const guestWithoutExpectedTotal: Record<string, unknown> = {
      ...guestQrIntent,
    };
    delete guestWithoutExpectedTotal.expected_total;
    const missingExpectedTotalRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...guestWithoutExpectedTotal,
          idempotency_key: await getGuestOrderIdempotencyKey(
            guestWithoutExpectedTotal
          ),
        }),
      })
    );
    assert.equal(missingExpectedTotalRes.status, 409);
    assert.equal((await missingExpectedTotalRes.json()).code, 'PRICE_CHANGED');

    const missingGuestIdempotencyKeyRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guestQrIntent),
      })
    );
    assert.equal(missingGuestIdempotencyKeyRes.status, 400);
    assert.equal(
      (await missingGuestIdempotencyKeyRes.json()).code,
      'GUEST_ORDER_IDEMPOTENCY_KEY_REQUIRED'
    );

    const guestQrRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guestQrPayload),
      })
    );
    const guestQrJson = await guestQrRes.json();
    assert.equal(guestQrRes.status, 201, JSON.stringify(guestQrJson));
    const createdQrOrder = guestQrJson.order;
    assert.ok(createdQrOrder?.id);
    assert.equal(createdQrOrder.source, 'qr_table');
    assert.equal(createdQrOrder.table_id, 'tbl-qa-01');
    assert.equal(createdQrOrder.table_label, 'Bàn QA 01');
    // Server authoritative pricing: (55,000 + 15,000) * 2 = 140,000 VND; unauthorized guest discount zeroed
    assert.equal(createdQrOrder.items[0].unit_price, 55000);
    assert.equal(createdQrOrder.items[0].extra_price, 15000);
    assert.equal(createdQrOrder.items[0].selected_choices[0].id, 'size-special');
    assert.equal(
      createdQrOrder.items[0].selected_choices[0].label_vi,
      'Tô đặc biệt'
    );
    assert.equal(createdQrOrder.subtotal_amount, 140000);
    assert.equal(createdQrOrder.discount_amount, 0);
    assert.equal(createdQrOrder.total_amount, 140000);
    // Payment & fulfillment invariants on guest creation
    assert.equal(createdQrOrder.status, 'new');
    assert.equal(createdQrOrder.payment_status, 'unpaid');
    assert.equal(typeof createdQrOrder.tracking_token, 'string');
    assert.ok(createdQrOrder.tracking_token.length >= 16);

    const itemAfterFirst = await db.query<{
      stock_quantity: number;
      sold_count: number;
      is_available: boolean;
    }>(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = 'item-qa-pho'`
    );
    assert.equal(itemAfterFirst.rows[0]?.stock_quantity, 3);
    assert.equal(itemAfterFirst.rows[0]?.sold_count, 2);
    assert.equal(itemAfterFirst.rows[0]?.is_available, true);

    // 3. Exact idempotent replay returns same order without double stock deduction or duplicate order/audit rows
    const replayQrRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guestQrPayload),
      })
    );
    assert.equal(replayQrRes.status, 201);
    const replayQrJson = await replayQrRes.json();
    assert.equal(replayQrJson.order.id, createdQrOrder.id);
    assert.equal(replayQrJson.order.order_code, createdQrOrder.order_code);
    assert.equal(replayQrJson.order.tracking_token, createdQrOrder.tracking_token);
    assert.equal(replayQrJson.order.total_amount, 140000);
    assert.equal('idempotency_key' in replayQrJson.order, false);

    const changedReplayPayload = {
      ...guestQrIntent,
      customer_note: 'Đổi nội dung sau lần gửi',
      idempotency_key: guestQrPayload.idempotency_key,
    };
    const changedReplayRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changedReplayPayload),
      })
    );
    assert.equal(changedReplayRes.status, 409);
    assert.equal(
      (await changedReplayRes.json()).code,
      'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
    );

    const countsAfterReplay = await db.query<{
      order_count: number;
      create_audit_count: number;
      stock_quantity: number;
      sold_count: number;
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM orders WHERE shop_id = 'shop-qa-storefront') AS order_count,
        (SELECT COUNT(*)::int FROM order_audit_logs WHERE shop_id = 'shop-qa-storefront' AND action = 'create_order') AS create_audit_count,
        (SELECT stock_quantity FROM items WHERE id = 'item-qa-pho') AS stock_quantity,
        (SELECT sold_count FROM items WHERE id = 'item-qa-pho') AS sold_count`
    );
    assert.equal(countsAfterReplay.rows[0]?.order_count, 1);
    assert.equal(countsAfterReplay.rows[0]?.create_audit_count, 1);
    assert.equal(countsAfterReplay.rows[0]?.stock_quantity, 3);
    assert.equal(countsAfterReplay.rows[0]?.sold_count, 2);

    // 4. Stale expected_total is rejected with 409 PRICE_CHANGED without mutating inventory,
    //    then anonymous Takeaway order for remaining 3 units depletes stock to 0 and marks is_available = false
    const staleQuoteIntent = {
      shop_id: 'shop-qa-storefront',
      table_id: null,
      table_label: 'Mang về',
      expected_total: 1000,
      items: [
        {
          item_id: 'item-qa-pho',
          name_vi: 'Phở bò QA',
          quantity: 3,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [
            {
              group_id: 'size',
              id: 'size-regular',
              label_vi: 'Tô thường',
              extra_price: 0,
            },
          ],
        },
      ],
    };
    const staleQuoteRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...staleQuoteIntent,
          idempotency_key:
            await getGuestOrderIdempotencyKey(staleQuoteIntent),
        }),
      })
    );
    assert.equal(staleQuoteRes.status, 409);
    const staleQuoteJson = await staleQuoteRes.json();
    assert.equal(staleQuoteJson.code, 'PRICE_CHANGED');
    assert.equal(staleQuoteJson.quote?.total_amount, 165000);

    const stateAfterStaleQuote = await db.query<{
      order_count: number;
      stock_quantity: number;
      sold_count: number;
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM orders WHERE shop_id = 'shop-qa-storefront') AS order_count,
        (SELECT stock_quantity FROM items WHERE id = 'item-qa-pho') AS stock_quantity,
        (SELECT sold_count FROM items WHERE id = 'item-qa-pho') AS sold_count`
    );
    assert.equal(stateAfterStaleQuote.rows[0]?.order_count, 1);
    assert.equal(stateAfterStaleQuote.rows[0]?.stock_quantity, 3);
    assert.equal(stateAfterStaleQuote.rows[0]?.sold_count, 2);

    const takeawayIntent = {
      shop_id: 'shop-qa-storefront',
      table_id: null,
      table_label: 'Mang về',
      expected_total: 165000,
      payment_method: 'cash',
      items: [
        {
          item_id: 'item-qa-pho',
          name_vi: 'Phở bò QA',
          quantity: 3,
          unit_price: 55000,
          extra_price: 0,
          selected_choices: [
            {
              group_id: 'size',
              id: 'size-regular',
              label_vi: 'Tô thường',
              extra_price: 0,
            },
          ],
        },
      ],
    };
    const takeawayRes = await postOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...takeawayIntent,
          idempotency_key: await getGuestOrderIdempotencyKey(takeawayIntent),
        }),
      })
    );
    assert.equal(takeawayRes.status, 201);
    const takeawayOrder = (await takeawayRes.json()).order;
    assert.equal(takeawayOrder.table_id, null);
    assert.equal(takeawayOrder.table_label, 'Mang về');
    assert.equal(takeawayOrder.total_amount, 165000);
    assert.equal(takeawayOrder.payment_status, 'unpaid');
    assert.equal(takeawayOrder.status, 'new');

    const itemDepleted = await db.query<{
      stock_quantity: number;
      sold_count: number;
      is_available: boolean;
    }>(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = 'item-qa-pho'`
    );
    assert.equal(itemDepleted.rows[0]?.stock_quantity, 0);
    assert.equal(itemDepleted.rows[0]?.sold_count, 5);
    assert.equal(itemDepleted.rows[0]?.is_available, false);

    // 5. Guest order tracking requires x-tracking-token header (no query-string fallback) and timing-safe compare;
    //    guest PATCH self-edit enforces timing-safe token validation without affecting status/payment/inventory;
    //    fulfillment completion never marks an unpaid order paid
    const unauthTrackRes = await getOrdersRoute(
      new Request(
        `http://localhost/api/orders?orderId=${encodeURIComponent(createdQrOrder.id)}`
      )
    );
    assert.equal(unauthTrackRes.status, 403);
    const unauthTrackBodyText = JSON.stringify(await unauthTrackRes.json());
    assert.equal(
      unauthTrackBodyText.includes(createdQrOrder.tracking_token),
      false
    );

    const queryOnlyTrackRes = await getOrdersRoute(
      new Request(
        `http://localhost/api/orders?orderId=${encodeURIComponent(createdQrOrder.id)}&trackingToken=${encodeURIComponent(createdQrOrder.tracking_token)}`
      )
    );
    assert.equal(
      queryOnlyTrackRes.status,
      403,
      'GET /api/orders must reject query-string trackingToken when x-tracking-token header is absent'
    );
    const queryOnlyTrackBodyText = JSON.stringify(
      await queryOnlyTrackRes.json()
    );
    assert.equal(
      queryOnlyTrackBodyText.includes(createdQrOrder.tracking_token),
      false
    );

    const flippedLastChar =
      createdQrOrder.tracking_token.slice(-1) === 'a' ? 'b' : 'a';
    const sameLengthWrongToken = `${createdQrOrder.tracking_token.slice(0, -1)}${flippedLastChar}`;

    for (const wrongHeaderToken of [
      'wrong-short-token',
      sameLengthWrongToken,
    ]) {
      const wrongHeaderTrackRes = await getOrdersRoute(
        new Request(
          `http://localhost/api/orders?orderId=${encodeURIComponent(createdQrOrder.id)}`,
          {
            headers: { 'x-tracking-token': wrongHeaderToken },
          }
        )
      );
      assert.equal(wrongHeaderTrackRes.status, 403);
      const wrongHeaderBodyText = JSON.stringify(
        await wrongHeaderTrackRes.json()
      );
      assert.equal(
        wrongHeaderBodyText.includes(createdQrOrder.tracking_token),
        false
      );
      assert.equal(wrongHeaderBodyText.includes(wrongHeaderToken), false);
    }

    const validTrackRes = await getOrdersRoute(
      new Request(
        `http://localhost/api/orders?orderId=${encodeURIComponent(createdQrOrder.id)}`,
        {
          headers: { 'x-tracking-token': createdQrOrder.tracking_token },
        }
      )
    );
    assert.equal(validTrackRes.status, 200);
    const validTrackJson = await validTrackRes.json();
    assert.equal(validTrackJson.order.id, createdQrOrder.id);
    assert.equal(validTrackJson.order.tracking_token, undefined);
    assert.equal('tracking_token' in validTrackJson.order, false);
    assert.equal(
      JSON.stringify(validTrackJson).includes(createdQrOrder.tracking_token),
      false
    );

    const staffFulfillToken = issueSessionToken({
      id: 'staff-qa-fulfill',
      email: 'staff-fulfill@test.local',
      role: 'staff',
    });

    // Authenticated shop member with orders.view retains authorization precedence even without/with mismatched x-tracking-token
    const memberOrderViewRes = await getOrdersRoute(
      new Request(
        `http://localhost/api/orders?orderId=${encodeURIComponent(createdQrOrder.id)}`,
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${staffFulfillToken}`,
            'x-tracking-token': 'ignored-for-authenticated-member',
          },
        }
      )
    );
    assert.equal(memberOrderViewRes.status, 200);
    const memberOrderViewJson = await memberOrderViewRes.json();
    assert.equal(memberOrderViewJson.order.id, createdQrOrder.id);
    assert.equal(memberOrderViewJson.membership?.role, 'staff');

    // Guest PATCH with wrong token (different length, same char length wrong value, multi-byte UTF-8 same char length, or wrong header) is forbidden
    const multiByteSameCharLengthToken = `${createdQrOrder.tracking_token.slice(0, -1)}đ`;
    for (const wrongPatchReq of [
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          trackingToken: 'wrong-short-token',
          customer_note: 'Không được phép ghi',
        }),
      }),
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          tracking_token: sameLengthWrongToken,
          customer_note: 'Không được phép ghi',
        }),
      }),
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          trackingToken: multiByteSameCharLengthToken,
          customer_note: 'Không được phép ghi',
        }),
      }),
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tracking-token': sameLengthWrongToken,
        },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          customer_note: 'Không được phép ghi',
        }),
      }),
    ]) {
      const wrongPatchRes = await patchOrdersRoute(wrongPatchReq);
      assert.equal(wrongPatchRes.status, 403);
      const wrongPatchJson = await wrongPatchRes.json();
      assert.equal(wrongPatchJson.code, 'INVALID_TRACKING_TOKEN');
      assert.equal(
        JSON.stringify(wrongPatchJson).includes(createdQrOrder.tracking_token),
        false
      );
    }

    // Guest PATCH with correct token updates customer_note while status, payment_status, and inventory stay unchanged
    const validGuestPatchRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tracking-token': createdQrOrder.tracking_token,
        },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          customer_note: 'Ít hành, thêm chanh',
        }),
      })
    );
    assert.equal(validGuestPatchRes.status, 200);
    const validGuestPatchJson = await validGuestPatchRes.json();
    assert.equal(validGuestPatchJson.order.id, createdQrOrder.id);
    assert.equal(
      validGuestPatchJson.order.customer_note,
      'Ít hành, thêm chanh'
    );
    assert.equal(validGuestPatchJson.order.status, 'new');
    assert.equal(validGuestPatchJson.order.payment_status, 'unpaid');
    assert.equal(validGuestPatchJson.order.total_amount, 140000);
    assert.equal(validGuestPatchJson.order.tracking_token, undefined);
    assert.equal('tracking_token' in validGuestPatchJson.order, false);
    assert.equal(
      JSON.stringify(validGuestPatchJson).includes(
        createdQrOrder.tracking_token
      ),
      false
    );

    const itemAfterGuestNotePatch = await db.query<{
      stock_quantity: number;
      sold_count: number;
      is_available: boolean;
    }>(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = 'item-qa-pho'`
    );
    assert.equal(itemAfterGuestNotePatch.rows[0]?.stock_quantity, 0);
    assert.equal(itemAfterGuestNotePatch.rows[0]?.sold_count, 5);
    assert.equal(itemAfterGuestNotePatch.rows[0]?.is_available, false);

    const reducedGuestItems = [
      { ...createdQrOrder.items[0], quantity: 1 },
    ];
    for (const expectedTotal of [undefined, 69999]) {
      const rejectedGuestEditRes = await patchOrdersRoute(
        new Request('http://localhost/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-tracking-token': createdQrOrder.tracking_token,
          },
          body: JSON.stringify({
            orderId: createdQrOrder.id,
            customer_note: 'Không được lưu với giá cũ',
            ...(expectedTotal === undefined ? {} : { expected_total: expectedTotal }),
            items: reducedGuestItems,
          }),
        })
      );
      const rejectedGuestEditJson = await rejectedGuestEditRes.json();
      assert.equal(
        rejectedGuestEditRes.status,
        409,
        JSON.stringify({ expectedTotal, response: rejectedGuestEditJson })
      );
      assert.equal(rejectedGuestEditJson.code, 'PRICE_CHANGED');
    }

    const unavailableGuestIncreaseRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tracking-token': createdQrOrder.tracking_token,
        },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          expected_total: 210000,
          items: [{ ...createdQrOrder.items[0], quantity: 3 }],
        }),
      })
    );
    assert.equal(unavailableGuestIncreaseRes.status, 400);
    assert.equal(
      (await unavailableGuestIncreaseRes.json()).code,
      'ITEM_UNAVAILABLE'
    );

    const orderAfterRejectedGuestEdits = await dbGetOrderById(
      createdQrOrder.id
    );
    assert.equal(orderAfterRejectedGuestEdits?.total_amount, 140000);
    assert.equal(orderAfterRejectedGuestEdits?.items[0]?.quantity, 2);
    assert.equal(orderAfterRejectedGuestEdits?.customer_note, 'Ít hành, thêm chanh');
    const itemAfterRejectedGuestEdits = await db.query<{
      stock_quantity: number;
      sold_count: number;
      is_available: boolean;
    }>(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = 'item-qa-pho'`
    );
    assert.equal(itemAfterRejectedGuestEdits.rows[0]?.stock_quantity, 0);
    assert.equal(itemAfterRejectedGuestEdits.rows[0]?.sold_count, 5);
    assert.equal(itemAfterRejectedGuestEdits.rows[0]?.is_available, false);

    const validGuestItemPatchRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tracking-token': createdQrOrder.tracking_token,
        },
        body: JSON.stringify({
          orderId: createdQrOrder.id,
          expected_total: 70000,
          customer_note: 'Ít hành, đổi thành một tô',
          items: reducedGuestItems,
        }),
      })
    );
    assert.equal(validGuestItemPatchRes.status, 200);
    const validGuestItemPatchJson = await validGuestItemPatchRes.json();
    assert.equal(validGuestItemPatchJson.order.total_amount, 70000);
    assert.equal(validGuestItemPatchJson.order.items[0]?.quantity, 1);
    assert.equal(
      validGuestItemPatchJson.order.customer_note,
      'Ít hành, đổi thành một tô'
    );
    assert.equal(validGuestItemPatchJson.order.status, 'new');
    assert.equal(validGuestItemPatchJson.order.payment_status, 'unpaid');
    const itemAfterValidGuestEdit = await db.query<{
      stock_quantity: number;
      sold_count: number;
      is_available: boolean;
    }>(
      `SELECT stock_quantity, sold_count, is_available FROM items WHERE id = 'item-qa-pho'`
    );
    assert.equal(itemAfterValidGuestEdit.rows[0]?.stock_quantity, 1);
    assert.equal(itemAfterValidGuestEdit.rows[0]?.sold_count, 4);
    assert.equal(itemAfterValidGuestEdit.rows[0]?.is_available, true);

    const prepRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${staffFulfillToken}`,
        },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          orderId: createdQrOrder.id,
          status: 'preparing',
        }),
      })
    );
    assert.equal(prepRes.status, 200);

    const completeRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${staffFulfillToken}`,
        },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          orderId: createdQrOrder.id,
          status: 'completed',
        }),
      })
    );
    assert.equal(completeRes.status, 200);
    const completeJson = await completeRes.json();
    assert.equal(completeJson.order.status, 'completed');
    assert.equal(completeJson.order.payment_status, 'unpaid');

    const staffIllegalPayRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${staffFulfillToken}`,
        },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          orderId: createdQrOrder.id,
          payment_status: 'paid',
        }),
      })
    );
    assert.equal(staffIllegalPayRes.status, 403);

    const cashierToken = issueSessionToken({
      id: 'cashier-qa-collect',
      email: 'cashier-collect@test.local',
      role: 'staff',
    });
    const cashierCollectRes = await patchOrdersRoute(
      new Request('http://localhost/api/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${SESSION_COOKIE_NAME}=${cashierToken}`,
        },
        body: JSON.stringify({
          shop_id: 'shop-qa-storefront',
          orderId: takeawayOrder.id,
          payment_status: 'paid',
        }),
      })
    );
    assert.equal(cashierCollectRes.status, 200);
    const cashierCollectJson = await cashierCollectRes.json();
    assert.equal(cashierCollectJson.order.payment_status, 'paid');
    assert.equal(cashierCollectJson.order.status, 'new');

    const persistedOrders = await db.query<{
      id: string;
      status: string;
      payment_status: string;
    }>(
      `SELECT id, status, payment_status FROM orders WHERE shop_id = 'shop-qa-storefront' ORDER BY created_at ASC`
    );
    const persistedQr = persistedOrders.rows.find(
      (r) => r.id === createdQrOrder.id
    );
    const persistedTakeaway = persistedOrders.rows.find(
      (r) => r.id === takeawayOrder.id
    );
    assert.deepEqual(persistedQr, {
      id: createdQrOrder.id,
      status: 'completed',
      payment_status: 'unpaid',
    });
    assert.deepEqual(persistedTakeaway, {
      id: takeawayOrder.id,
      status: 'new',
      payment_status: 'paid',
    });
  } finally {
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;

    setMposDbClientForTests(null);
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setShopTablesDbClientForTests(null);
    setOrderAuditDbClientForTests(null);
    setOrderAuditLogFileForTests(null);
    resetMposStoreForTests();
    fs.rmSync(tempAuditDir, { recursive: true, force: true });
    await db.close();
  }
});
