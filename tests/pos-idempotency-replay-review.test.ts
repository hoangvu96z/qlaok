import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { POST as postOrders } from '@/app/api/orders/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import {
  buildScopedPosWebIdempotencyKey,
  computePosOrderIntentFingerprint,
  dbCreateOrder,
  dbGetOrderByShopIdempotencyKey,
  isReservedPosWebIdempotencyKey,
  resetMposStoreForTests,
  setMposDbClientForTests,
} from '@/lib/mpos-store';
import {
  issueSessionToken,
  setOrderAuditLogFileForTests,
} from '@/lib/server-auth';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import { setShopTablesDbClientForTests } from '@/lib/shop-tables';
import type { ShopOrder } from '@/types/qlaok';

function createPgliteSupabaseClient(
  db: PGlite,
  options?: {
    shouldFailOrdersSelect?: () => boolean;
  }
) {
  class PgQueryBuilder {
    private table: string;
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private neqFilters: Array<[string, unknown]> = [];
    private likeFilters: Array<[string, string]> = [];
    private singleMode: 'none' | 'maybe' | 'single' = 'none';
    private updatePayload: Record<string, unknown> | null = null;
    private insertPayload: Record<string, unknown> | null = null;
    private limitCount: number | null = null;
    private orderSpec: { col: string; ascending: boolean } | null = null;

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
    neq(column: string, value: unknown) {
      this.neqFilters.push([column, value]);
      return this;
    }
    like(column: string, pattern: string) {
      this.likeFilters.push([column, pattern]);
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orderSpec = { col, ascending: opts?.ascending !== false };
      return this;
    }
    limit(count: number) {
      this.limitCount = count;
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
      this.insertPayload = payload;
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    async execute() {
      if (
        this.table === 'orders' &&
        !this.insertPayload &&
        !this.updatePayload &&
        options?.shouldFailOrdersSelect?.()
      ) {
        return {
          data: null,
          error: { message: 'Simulated database connection failure on orders lookup' },
        };
      }

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
        for (const [col, val] of this.neqFilters) {
          params.push(val);
          clauses.push(`${ident(col)} <> $${params.length}`);
        }
        for (const [col, pattern] of this.likeFilters) {
          params.push(pattern);
          clauses.push(`${ident(col)} LIKE $${params.length}`);
        }
        return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      };

      try {
        if (this.insertPayload) {
          const keys = Object.keys(this.insertPayload);
          const cols = keys.map(ident).join(', ');
          const vals = keys.map((k) => {
            const v = this.insertPayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `$${params.length}`;
          });
          const { rows } = await db.query(
            `INSERT INTO ${ident(this.table)} (${cols}) VALUES (${vals.join(', ')}) RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        if (this.updatePayload) {
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const whereSql = buildWhere();
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
        const whereSql = buildWhere();
        const orderSql = this.orderSpec
          ? ` ORDER BY ${ident(this.orderSpec.col)} ${this.orderSpec.ascending ? 'ASC' : 'DESC'}`
          : '';
        const limitSql =
          typeof this.limitCount === 'number'
            ? ` LIMIT ${Math.max(0, Math.floor(this.limitCount))}`
            : '';
        const { rows } = await db.query(
          `SELECT ${selectCols} FROM ${ident(this.table)}${whereSql}${orderSql}${limitSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
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

  return {
    from: (table: string) => new PgQueryBuilder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        assert.match(name, /^[a-z0-9_]+$/i);
        const keys = Object.keys(args);
        const paramList = keys
          .map((k, idx) => `${k} := $${idx + 1}::jsonb`)
          .join(', ');
        const values = keys.map((k) => JSON.stringify(args[k]));
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
}

test('POS-web idempotency key helpers enforce pos-web:/posv1: prefix only (preserving legacy pos:), max length <= 120, actor/shop scoping, and exact recursive JSON intent fingerprint', () => {
  assert.equal(isReservedPosWebIdempotencyKey('pos-web:test-1'), true);
  assert.equal(isReservedPosWebIdempotencyKey('  POS-WEB:shop-1:abc123  '), true);
  assert.equal(isReservedPosWebIdempotencyKey('posv1:deadbeef:1234:5678'), true);
  // Generic legacy `pos:` prefix is NOT reserved
  assert.equal(isReservedPosWebIdempotencyKey('pos:shop-1:abc123'), false);
  assert.equal(isReservedPosWebIdempotencyKey('  POS:shop-1:abc123  '), false);
  assert.equal(isReservedPosWebIdempotencyKey('qr-order-key-001'), false);
  assert.equal(isReservedPosWebIdempotencyKey('staff-assist-001'), false);
  assert.equal(isReservedPosWebIdempotencyKey(''), false);

  const fpBase = computePosOrderIntentFingerprint({
    shop_id: 'shop-1',
    source: 'counter_pos',
    table_id: 'tbl-1',
    table_label: 'Bàn 1',
    payment_method: 'cash',
    payment_status: 'paid',
    expected_total: 65000,
    discount_amount: 0,
    idempotency_key: 'pos-web:key-a',
    items: [
      {
        item_id: 'item-1',
        name_vi: 'Phở Bò',
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
  });

  // Reordered object keys and different top-level idempotency_key produce identical fingerprint
  const fpReorderedKeys = computePosOrderIntentFingerprint({
    idempotency_key: 'pos-web:key-b',
    items: [
      {
        selected_choices: [],
        extra_price: 0,
        unit_price: 65000,
        quantity: 1,
        name_vi: 'Phở Bò',
        item_id: 'item-1',
      },
    ],
    discount_amount: 0,
    expected_total: 65000,
    payment_status: 'paid',
    payment_method: 'cash',
    table_label: 'Bàn 1',
    table_id: 'tbl-1',
    source: 'counter_pos',
    shop_id: 'shop-1',
  });
  assert.equal(fpBase, fpReorderedKeys);

  // Any changed field — including session_id, payment_idempotency_key, or unnormalized quantity/status/price — changes the fingerprint
  for (const variant of [
    { quantity: 0 },
    { quantity: -1 },
    { payment_status: 'invalid_status' },
    { session_id: 'sess-custom-1' },
    { payment_idempotency_key: 'pay-custom-1' },
    { visitor_lang: 'en' },
  ]) {
    const modifiedPayload =
      'quantity' in variant
        ? {
            shop_id: 'shop-1',
            source: 'counter_pos',
            table_id: 'tbl-1',
            table_label: 'Bàn 1',
            payment_method: 'cash',
            payment_status: 'paid',
            expected_total: 65000,
            discount_amount: 0,
            items: [
              {
                item_id: 'item-1',
                name_vi: 'Phở Bò',
                quantity: variant.quantity,
                unit_price: 65000,
                extra_price: 0,
                selected_choices: [],
              },
            ],
          }
        : {
            shop_id: 'shop-1',
            source: 'counter_pos',
            table_id: 'tbl-1',
            table_label: 'Bàn 1',
            payment_method: 'cash',
            payment_status: 'paid',
            expected_total: 65000,
            discount_amount: 0,
            items: [
              {
                item_id: 'item-1',
                name_vi: 'Phở Bò',
                quantity: 1,
                unit_price: 65000,
                extra_price: 0,
                selected_choices: [],
              },
            ],
            ...variant,
          };
    assert.notEqual(
      computePosOrderIntentFingerprint(modifiedPayload),
      fpBase,
      `Variant ${JSON.stringify(variant)} must produce a distinct fingerprint`
    );
  }

  const scopedUserA = buildScopedPosWebIdempotencyKey({
    shopId: 'shop-1',
    actorUserId: 'user-a',
    rawIdempotencyKey: 'pos-web:shop-1:ticket-001',
    intentFingerprint: fpBase,
  });
  const scopedUserB = buildScopedPosWebIdempotencyKey({
    shopId: 'shop-1',
    actorUserId: 'user-b',
    rawIdempotencyKey: 'pos-web:shop-1:ticket-001',
    intentFingerprint: fpBase,
  });
  const scopedShopB = buildScopedPosWebIdempotencyKey({
    shopId: 'shop-2',
    actorUserId: 'user-a',
    rawIdempotencyKey: 'pos-web:shop-1:ticket-001',
    intentFingerprint: fpBase,
  });

  assert.equal(scopedUserA.keyLookupPrefix.length, 48);
  assert.ok(
    scopedUserA.scopedKey.length <= 120,
    `Scoped key length ${scopedUserA.scopedKey.length} must fit VARCHAR(120)`
  );
  assert.notEqual(scopedUserA.keyLookupPrefix, scopedUserB.keyLookupPrefix);
  assert.notEqual(scopedUserA.keyLookupPrefix, scopedShopB.keyLookupPrefix);

  assert.throws(
    () =>
      buildScopedPosWebIdempotencyKey({
        shopId: 'shop-1',
        actorUserId: 'user-a',
        rawIdempotencyKey: 'pos-web:   ',
        intentFingerprint: fpBase,
      }),
    /INVALID_POS_IDEMPOTENCY_KEY/
  );
  assert.throws(
    () =>
      buildScopedPosWebIdempotencyKey({
        shopId: 'shop-1',
        actorUserId: 'user-a',
        rawIdempotencyKey: 'pos:legacy-key',
        intentFingerprint: fpBase,
      }),
    /INVALID_POS_IDEMPOTENCY_KEY/
  );
  assert.throws(
    () =>
      buildScopedPosWebIdempotencyKey({
        shopId: 'shop-1',
        actorUserId: 'user-a',
        rawIdempotencyKey: 'posv1:forged:prefix:key',
        intentFingerprint: fpBase,
      }),
    /INVALID_POS_IDEMPOTENCY_KEY/
  );
});

test('POST /api/orders POS idempotent replay: recovers committed order after price/stock/table changes, blocks cross-user/shop/QR/modified-payload reuse, and fails closed on DB error', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const ownerId = '00000000-0000-0000-0000-000000000801';
  const cashierAId = '00000000-0000-0000-0000-000000000802';
  const cashierBId = '00000000-0000-0000-0000-000000000803';
  const viewOnlyStaffId = '00000000-0000-0000-0000-000000000804';
  const createOnlyStaffId = '00000000-0000-0000-0000-000000000805';

  let failOrdersLookup = false;
  const client = createPgliteSupabaseClient(db, {
    shouldFailOrdersSelect: () => failOrdersLookup,
  });
  const tempAuditDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qlaok-pos-idemp-audit-')
  );
  const tempAuditFile = path.join(tempAuditDir, 'order-audit.jsonl');
  setOrderAuditLogFileForTests(tempAuditFile);

  const countAuditEntriesForOrder = async (orderId: string): Promise<number> =>
    (
      await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.order_audit_logs
         WHERE order_id = $1 AND action = 'create_order'`,
        [orderId]
      )
    ).rows[0]!.count;

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
      INSERT INTO profiles (id, email, full_name, plan) VALUES
        ('${ownerId}', 'owner-pos@qlaok.test', 'Owner POS', 'premium'),
        ('${cashierAId}', 'cashier-a@qlaok.test', 'Cashier A', 'free'),
        ('${cashierBId}', 'cashier-b@qlaok.test', 'Cashier B', 'free'),
        ('${viewOnlyStaffId}', 'view-only@qlaok.test', 'View Only', 'free'),
        ('${createOnlyStaffId}', 'create-only@qlaok.test', 'Create Only', 'free');

      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES
        ('pos-shop-1', '${ownerId}', 'pos-shop-1', 'Quán POS 1', true, '{"primaryColor":"#10b981","layout":"grid"}'::jsonb),
        ('pos-shop-2', '${ownerId}', 'pos-shop-2', 'Quán POS 2', true, '{"primaryColor":"#10b981","layout":"grid"}'::jsonb);

      INSERT INTO categories (id, shop_id, sort_order, name_i18n, is_active) VALUES
        ('cat-pos-1', 'pos-shop-1', 1, '{"vi":"Món chính"}'::jsonb, true),
        ('cat-pos-2', 'pos-shop-2', 1, '{"vi":"Món chính"}'::jsonb, true);

      INSERT INTO items (id, shop_id, category_id, sort_order, price, stock_quantity, sold_count, is_available, name_i18n, desc_i18n) VALUES
        ('item-pos-1', 'pos-shop-1', 'cat-pos-1', 1, 50000, 3, 0, true, '{"vi":"Cà phê kem muối"}'::jsonb, '{"vi":"Thơm béo"}'::jsonb),
        ('item-pos-2', 'pos-shop-2', 'cat-pos-2', 1, 50000, 10, 0, true, '{"vi":"Trà đào"}'::jsonb, '{"vi":"Mát lạnh"}'::jsonb);

      INSERT INTO shop_tables (id, shop_id, name, table_code, section, capacity, sort_order, is_active, is_archived) VALUES
        ('tbl-pos-1', 'pos-shop-1', 'Bàn 01', 'T01', 'Tầng 1', 4, 1, true, false);

      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-cashier-a', 'pos-shop-1', '${cashierAId}', 'cashier', '["orders.view","orders.create","payment.collect","discount.apply"]'::jsonb, true),
        ('mem-cashier-b', 'pos-shop-1', '${cashierBId}', 'cashier', '["orders.view","orders.create","payment.collect","discount.apply"]'::jsonb, true),
        ('mem-view-only', 'pos-shop-1', '${viewOnlyStaffId}', 'staff', '["orders.view"]'::jsonb, true),
        ('mem-create-only', 'pos-shop-1', '${createOnlyStaffId}', 'staff', '["orders.create"]'::jsonb, true);
    `);

    setSupabaseDbClientForTests(client);
    setShopMembershipDbClientForTest(client as never);
    setShopTablesDbClientForTests(client);
    setMposDbClientForTests(client, true);

    const cashierAToken = issueSessionToken({
      id: cashierAId,
      email: 'cashier-a@qlaok.test',
      role: 'cashier',
    });
    const cashierBToken = issueSessionToken({
      id: cashierBId,
      email: 'cashier-b@qlaok.test',
      role: 'cashier',
    });
    const ownerToken = issueSessionToken({
      id: ownerId,
      email: 'owner-pos@qlaok.test',
      role: 'owner',
    });
    const viewOnlyToken = issueSessionToken({
      id: viewOnlyStaffId,
      email: 'view-only@qlaok.test',
      role: 'staff',
    });
    const createOnlyToken = issueSessionToken({
      id: createOnlyStaffId,
      email: 'create-only@qlaok.test',
      role: 'staff',
    });

    const rawPosKey = 'pos-web:pos-shop-1:m9xyz:ticket-replay-001';
    const basePayload = {
      shop_id: 'pos-shop-1',
      source: 'counter_pos' as const,
      table_id: 'tbl-pos-1',
      table_label: 'Bàn 01',
      visitor_lang: 'vi' as const,
      payment_method: 'cash' as const,
      payment_status: 'paid' as const,
      discount_amount: 5000,
      expected_total: 95000,
      idempotency_key: rawPosKey,
      items: [
        {
          item_id: 'item-pos-1',
          name_vi: 'Cà phê kem muối',
          quantity: 2,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    };

    // 1. Reject reserved `pos:` prefix for anonymous / QR requests
    const anonRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          source: 'qr_table',
          table_id: null,
          table_label: 'Mang về',
          payment_status: 'unpaid',
        }),
      })
    );
    assert.equal(anonRes.status, 403);
    const anonBody = await anonRes.json();
    assert.equal(anonBody.code, 'RESERVED_POS_IDEMPOTENCY_KEY_FORBIDDEN');

    // Even an authenticated owner sending source='qr_table' cannot use a reserved `pos:` key
    const authQrRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          source: 'qr_table',
        }),
      })
    );
    assert.equal(authQrRes.status, 403);
    assert.equal(
      (await authQrRes.json()).code,
      'RESERVED_POS_IDEMPOTENCY_KEY_FORBIDDEN'
    );

    // 2. Permission checks happen BEFORE lookup:
    // - Unauthenticated counter_pos -> 401
    const unauthPosRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(unauthPosRes.status, 401);

    // - Staff without orders.create -> 403
    const noCreatePermRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewOnlyToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(noCreatePermRes.status, 403);

    // - Staff with orders.create but without discount.apply or payment.collect -> 403 before lookup
    const noDiscountPermRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createOnlyToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(noDiscountPermRes.status, 403);
    assert.equal(
      (await noDiscountPermRes.json()).code,
      'INSUFFICIENT_SHOP_PERMISSION'
    );

    const noCollectPermRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createOnlyToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          discount_amount: 0,
          expected_total: 100000,
          payment_status: 'paid',
        }),
      })
    );
    assert.equal(noCollectPermRes.status, 403);
    assert.equal(
      (await noCollectPermRes.json()).code,
      'INSUFFICIENT_SHOP_PERMISSION'
    );

    // 3. Initial POS order commits cleanly for Cashier A
    const createRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(createRes.status, 201);
    const createdOrder = ((await createRes.json()) as { order: ShopOrder }).order;
    assert.ok(createdOrder.id);
    assert.equal(createdOrder.shop_id, 'pos-shop-1');
    assert.equal(createdOrder.total_amount, 95000);
    assert.equal(createdOrder.payment_status, 'paid');
    assert.ok(
      createdOrder.idempotency_key?.startsWith('posv1:'),
      'Committed POS order must store the scoped posv1 key'
    );

    // Check stock and audit log after initial commit
    const stockAfterFirst = (
      await db.query<{ stock_quantity: number; sold_count: number }>(
        `SELECT stock_quantity, sold_count FROM items WHERE id = 'item-pos-1'`
      )
    ).rows[0];
    assert.equal(stockAfterFirst.stock_quantity, 1);
    assert.equal(stockAfterFirst.sold_count, 2);
    assert.equal(await countAuditEntriesForOrder(createdOrder.id), 1);
    assert.equal(
      fs.existsSync(tempAuditFile),
      false,
      'A successful database audit insert must not be duplicated in JSONL'
    );

    // 4. Mutate item price, mark item unavailable / 0 stock, and deactivate the table!
    await db.exec(`
      UPDATE items
      SET price = 85000, stock_quantity = 0, is_available = false
      WHERE id = 'item-pos-1';

      UPDATE shop_tables
      SET is_active = false, is_archived = true
      WHERE id = 'tbl-pos-1';
    `);

    // Also insert > 1005 newer dummy orders in `pos-shop-1` to prove lookup does NOT depend on the 1000-row list window!
    await db.exec(`
      INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items, source, created_at, updated_at)
      SELECT
        'ord-bulk-' || g::text,
        'ORD-BULK-' || g::text,
        'pos-shop-1',
        'Tại quầy',
        'completed',
        'cash',
        'paid',
        10000,
        10000,
        '[]'::jsonb,
        'counter_pos',
        NOW() + (g || ' seconds')::interval,
        NOW() + (g || ' seconds')::interval
      FROM generate_series(1, 1010) AS g;
    `);

    // 5. Replay the exact same POS request from Cashier A:
    // Must return the committed order (201) BEFORE quoteOrderPricing (which would 409 PRICE_CHANGED),
    // BEFORE table active check (which would fail INACTIVE_SHOP_TABLE),
    // and BEFORE stock check (which would fail ITEM_UNAVAILABLE),
    // and despite 1010 newer orders pushing it outside the 1000-row window!
    const replayRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(
      replayRes.status,
      201,
      'Committed POS order replay must succeed even after price/stock/table changes and >1000 newer orders'
    );
    const replayedOrder = ((await replayRes.json()) as { order: ShopOrder }).order;
    assert.equal(replayedOrder.id, createdOrder.id);
    assert.equal(replayedOrder.order_code, createdOrder.order_code);
    assert.equal(replayedOrder.total_amount, 95000);
    assert.equal(replayedOrder.payment_status, 'paid');

    // Verify no duplicate order or repeated side effects (stock, sold_count, audit log)
    const stockAfterReplay = (
      await db.query<{ stock_quantity: number; sold_count: number }>(
        `SELECT stock_quantity, sold_count FROM items WHERE id = 'item-pos-1'`
      )
    ).rows[0];
    assert.equal(stockAfterReplay.stock_quantity, 0);
    assert.equal(stockAfterReplay.sold_count, 2);
    assert.equal(
      await countAuditEntriesForOrder(createdOrder.id),
      1,
      'Replay must not append duplicate create_order audit logs'
    );

    // 6. Modified payload with the same raw POS key from Cashier A must be rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH
    // Case 6a: Changed payment_status (unpaid instead of paid)
    const mismatchPaymentRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          payment_status: 'unpaid',
        }),
      })
    );
    assert.equal(mismatchPaymentRes.status, 409);
    assert.equal(
      (await mismatchPaymentRes.json()).code,
      'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
    );

    // Case 6b: Changed item quantity / expected_total
    const mismatchItemsRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          expected_total: 170000,
          items: [
            {
              ...basePayload.items[0],
              quantity: 3,
            },
          ],
        }),
      })
    );
    assert.equal(mismatchItemsRes.status, 409);
    assert.equal(
      (await mismatchItemsRes.json()).code,
      'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
    );

    // 7. Same raw POS key from ANOTHER account (Cashier B) in the same shop CANNOT retrieve Cashier A's order:
    // Because Cashier B has a different actor scope, lookup returns null and proceeds to fresh quote validation,
    // which rejects with 400 ITEM_UNAVAILABLE (or 409 PRICE_CHANGED if available) because item-pos-1 is currently unavailable.
    const otherAccountSameKeyRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierBToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(
      otherAccountSameKeyRes.status,
      400,
      'Another account must not receive Cashier A committed order on same raw key'
    );
    const otherAccountBody = await otherAccountSameKeyRes.json();
    assert.equal(otherAccountBody.code, 'ITEM_UNAVAILABLE');
    assert.equal(otherAccountBody.order, undefined);

    // Restore item-pos-1 & tbl-pos-1 so Cashier B can create a valid order with the same raw key
    await db.exec(`
      UPDATE items SET price = 50000, stock_quantity = 10, is_available = true WHERE id = 'item-pos-1';
      UPDATE shop_tables SET is_active = true, is_archived = false WHERE id = 'tbl-pos-1';
    `);
    const cashierBCreateRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierBToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(cashierBCreateRes.status, 201);
    const cashierBOrder = ((await cashierBCreateRes.json()) as { order: ShopOrder })
      .order;
    assert.notEqual(
      cashierBOrder.id,
      createdOrder.id,
      'Cashier B using same raw key creates an isolated order, never reading Cashier A order'
    );

    // 8. Same raw POS key used in ANOTHER shop (`pos-shop-2`) cannot return `pos-shop-1` order
    const otherShopRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          shop_id: 'pos-shop-2',
          table_id: null,
          table_label: 'Tại quầy',
          discount_amount: 0,
          expected_total: 50000,
          items: [
            {
              item_id: 'item-pos-2',
              name_vi: 'Trà đào',
              quantity: 1,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(otherShopRes.status, 201);
    const otherShopOrder = ((await otherShopRes.json()) as { order: ShopOrder })
      .order;
    assert.equal(otherShopOrder.shop_id, 'pos-shop-2');
    assert.notEqual(otherShopOrder.id, createdOrder.id);

    // 9. Fresh request with a new POS key still validates expected_total quote and rejects stale totals (409 PRICE_CHANGED)
    const freshStaleQuoteRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify({
          ...basePayload,
          idempotency_key: 'pos-web:pos-shop-1:fresh-stale-quote-key',
          expected_total: 12345,
        }),
      })
    );
    assert.equal(freshStaleQuoteRes.status, 409);
    assert.equal((await freshStaleQuoteRes.json()).code, 'PRICE_CHANGED');

    // 10. Database lookup failure fails closed (503 ORDER_IDEMPOTENCY_LOOKUP_FAILED) and never falls back to local store or creates a duplicate
    failOrdersLookup = true;
    const dbFailRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierAToken}`,
        },
        body: JSON.stringify(basePayload),
      })
    );
    assert.equal(dbFailRes.status, 503);
    const dbFailBody = await dbFailRes.json();
    assert.equal(dbFailBody.code, 'ORDER_IDEMPOTENCY_LOOKUP_FAILED');
    failOrdersLookup = false;

    // 11. Legacy non-POS-web idempotency keys (including generic `pos:` prefix, mobile `staff-assist-...`, or guest QR `qr-...`)
    // preserve existing behavior and deduplicate via direct shop/key lookup even beyond 1000 rows
    const legacyKey = 'pos:legacy-unreserved-key-001';
    const legacyPayload = {
      shop_id: 'pos-shop-1',
      source: 'counter_pos' as const,
      table_id: 'tbl-pos-1',
      table_label: 'Bàn 01',
      visitor_lang: 'vi' as const,
      payment_method: 'cash' as const,
      payment_status: 'unpaid' as const,
      idempotency_key: legacyKey,
      items: [
        {
          item_id: 'item-pos-1',
          name_vi: 'Cà phê kem muối',
          quantity: 1,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    };

    const legacyFirstRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createOnlyToken}`,
        },
        body: JSON.stringify(legacyPayload),
      })
    );
    assert.equal(legacyFirstRes.status, 201);
    const legacyFirstOrder = (
      (await legacyFirstRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(legacyFirstOrder.idempotency_key, legacyKey);

    const legacyReplayRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${createOnlyToken}`,
        },
        body: JSON.stringify(legacyPayload),
      })
    );
    assert.equal(legacyReplayRes.status, 201);
    const legacyReplayOrder = (
      (await legacyReplayRes.json()) as { order: ShopOrder }
    ).order;
    assert.equal(legacyReplayOrder.id, legacyFirstOrder.id);

    // 12. Concurrency & DB unique prefix index (`idx_orders_shop_posv1_idempotency_prefix`):
    // Two distinct intent suffixes under the same `(shop_id, actor_scope, raw_key)` CANNOT both commit in PostgreSQL,
    // even if both requests bypass the initial prefix lookup concurrently across separate application instances.
    const concurrentRawKey = 'pos-web:pos-shop-1:concurrent-race-key-001';
    const concurrentPayloadA = {
      ...basePayload,
      idempotency_key: concurrentRawKey,
      payment_status: 'unpaid' as const,
      discount_amount: 0,
      expected_total: 50000,
      items: [
        {
          item_id: 'item-pos-1',
          name_vi: 'Cà phê kem muối',
          quantity: 1,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    };
    const concurrentPayloadB = {
      ...basePayload,
      idempotency_key: concurrentRawKey,
      payment_status: 'paid' as const,
      discount_amount: 0,
      expected_total: 100000,
      items: [
        {
          item_id: 'item-pos-1',
          name_vi: 'Cà phê kem muối',
          quantity: 2,
          unit_price: 50000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    };

    const scopedConcurrentA = buildScopedPosWebIdempotencyKey({
      shopId: 'pos-shop-1',
      actorUserId: cashierAId,
      rawIdempotencyKey: concurrentRawKey,
      intentFingerprint: computePosOrderIntentFingerprint(concurrentPayloadA),
    });
    const scopedConcurrentB = buildScopedPosWebIdempotencyKey({
      shopId: 'pos-shop-1',
      actorUserId: cashierAId,
      rawIdempotencyKey: concurrentRawKey,
      intentFingerprint: computePosOrderIntentFingerprint(concurrentPayloadB),
    });
    assert.equal(
      scopedConcurrentA.keyLookupPrefix,
      scopedConcurrentB.keyLookupPrefix
    );
    assert.notEqual(scopedConcurrentA.scopedKey, scopedConcurrentB.scopedKey);

    // Direct PostgreSQL RPC concurrency proof: commit A via commit_order_with_inventory, then attempt to commit B
    // directly via commit_order_with_inventory (simulating a second instance that missed the pre-commit SELECT).
    const rpcCommitA = await client.rpc('commit_order_with_inventory', {
      p_order: {
        id: 'ord-race-a',
        order_code: 'ORD-RACE-A',
        shop_id: 'pos-shop-1',
        table_id: 'tbl-pos-1',
        table_label: 'Bàn 01',
        visitor_lang: 'vi',
        status: 'new',
        payment_method: 'cash',
        payment_status: 'unpaid',
        subtotal_amount: 50000,
        discount_amount: 0,
        total_amount: 50000,
        items: concurrentPayloadA.items,
        source: 'counter_pos',
        idempotency_key: scopedConcurrentA.scopedKey,
      },
      p_inventory_deltas: [{ item_id: 'item-pos-1', delta: 1 }],
    });
    assert.equal(rpcCommitA.error, null);

    const rpcCommitB = await client.rpc('commit_order_with_inventory', {
      p_order: {
        id: 'ord-race-b',
        order_code: 'ORD-RACE-B',
        shop_id: 'pos-shop-1',
        table_id: 'tbl-pos-1',
        table_label: 'Bàn 01',
        visitor_lang: 'vi',
        status: 'new',
        payment_method: 'cash',
        payment_status: 'paid',
        subtotal_amount: 100000,
        discount_amount: 0,
        total_amount: 100000,
        items: concurrentPayloadB.items,
        source: 'counter_pos',
        idempotency_key: scopedConcurrentB.scopedKey,
      },
      p_inventory_deltas: [{ item_id: 'item-pos-1', delta: 2 }],
    });
    assert.ok(
      rpcCommitB.error &&
        /idx_orders_shop_posv1_idempotency_prefix/i.test(
          rpcCommitB.error.message
        ),
      `Expected unique index violation on idx_orders_shop_posv1_idempotency_prefix, got: ${JSON.stringify(rpcCommitB.error)}`
    );

    // And when two concurrent HTTP POST /api/orders calls race with the same raw key and different payloads,
    // exactly one succeeds (201) and the other is rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
    const httpRaceKey = 'pos-web:pos-shop-1:http-race-key-002';
    const [raceRes1, raceRes2] = await Promise.all([
      postOrders(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cashierAToken}`,
          },
          body: JSON.stringify({
            ...concurrentPayloadA,
            idempotency_key: httpRaceKey,
          }),
        })
      ),
      postOrders(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cashierAToken}`,
          },
          body: JSON.stringify({
            ...concurrentPayloadB,
            idempotency_key: httpRaceKey,
          }),
        })
      ),
    ]);
    const statuses = [raceRes1.status, raceRes2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const conflictRes = raceRes1.status === 409 ? raceRes1 : raceRes2;
    assert.equal(
      (await conflictRes.json()).code,
      'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
    );
  } finally {
    setOrderAuditLogFileForTests(null);
    fs.rmSync(tempAuditDir, { recursive: true, force: true });
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setShopTablesDbClientForTests(null);
    setMposDbClientForTests(null);
    await db.close();
  }
});

test('Local store equivalent: dbGetOrderByShopIdempotencyKey and dbCreateOrder deduplicate and detect payload mismatch when DB is not configured', async () => {
  setMposDbClientForTests(null, false);
  resetMposStoreForTests();

  const rawKey = 'pos-web:shop-fnb-001:local-ticket-01';
  const selectedChoices = [{
    id: 'size-m',
    label_i18n: { vi: 'Tô Vừa (Tiêu chuẩn)' },
    extra_price: 0,
  }];
  const fp1 = computePosOrderIntentFingerprint({
    shop_id: 'shop-fnb-001',
    source: 'counter_pos',
    table_label: 'Tại quầy',
    payment_method: 'cash',
    payment_status: 'paid',
    expected_total: 65000,
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: selectedChoices,
      },
    ],
  });
  const fp2 = computePosOrderIntentFingerprint({
    shop_id: 'shop-fnb-001',
    source: 'counter_pos',
    table_label: 'Tại quầy',
    payment_method: 'vietqr',
    payment_status: 'unpaid',
    expected_total: 65000,
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: selectedChoices,
      },
    ],
  });

  const scoped1 = buildScopedPosWebIdempotencyKey({
    shopId: 'shop-fnb-001',
    actorUserId: 'local-owner-1',
    rawIdempotencyKey: rawKey,
    intentFingerprint: fp1,
  });
  const scoped2 = buildScopedPosWebIdempotencyKey({
    shopId: 'shop-fnb-001',
    actorUserId: 'local-owner-1',
    rawIdempotencyKey: rawKey,
    intentFingerprint: fp2,
  });

  const created = await dbCreateOrder({
    shop_id: 'shop-fnb-001',
    source: 'counter_pos',
    table_label: 'Tại quầy',
    payment_method: 'cash',
    payment_status: 'paid',
    isStaffAuthorized: true,
    canCollectPayment: true,
    idempotency_key: scoped1.scopedKey,
    items: [
      {
        item_id: 'item-fnb-1',
        name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: selectedChoices,
      },
    ],
  });

  const exactLookup = await dbGetOrderByShopIdempotencyKey(
    'shop-fnb-001',
    scoped1.scopedKey,
    { keyLookupPrefix: scoped1.keyLookupPrefix }
  );
  assert.equal(exactLookup.payloadMismatch, false);
  assert.equal(exactLookup.order?.id, created.id);

  const mismatchLookup = await dbGetOrderByShopIdempotencyKey(
    'shop-fnb-001',
    scoped2.scopedKey,
    { keyLookupPrefix: scoped2.keyLookupPrefix }
  );
  assert.equal(mismatchLookup.payloadMismatch, true);
  assert.equal(mismatchLookup.order?.id, created.id);

  setMposDbClientForTests(null);
});
