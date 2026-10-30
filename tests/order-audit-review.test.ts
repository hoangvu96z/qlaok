import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hasBusinessStateChanged } from '@/lib/audit-replay';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { GET as getAdminAudit } from '@/app/api/admin/audit/route';
import { POST as postAdmin } from '@/app/api/admin/route';
import { GET as getOrderAudit } from '@/app/api/orders/audit/route';
import {
  PATCH as patchOrders,
  POST as postOrders,
} from '@/app/api/orders/route';
import {
  PATCH as patchServiceRequests,
  POST as postServiceRequests,
} from '@/app/api/service-requests/route';
import {
  setOrderAuditDbClientForTests,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import {
  resetMposStoreForTests,
  setMposDbClientForTests,
} from '@/lib/mpos-store';
import {
  __resetSePayStoreForTests,
  __setSePayDbClientForTests,
  encryptSePaySecret,
  processSePayShopWebhook,
  signSePayWebhookPayload,
} from '@/lib/sepay-reconciliation';
import {
  issueSessionToken,
  queryAdminAuditLogs,
  readOrderAuditLog,
  recordAdminAuditLog,
  recordOrderAuditLog,
  setAdminAuditLogFileForTests,
  queryOrderAuditLogs,
  setOrderAuditLogFileForTests,
} from '@/lib/server-auth';
import {
  __resetLocalServiceRequestsForTests,
  __setServiceRequestsDbClientForTests,
} from '@/lib/service-requests';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import {
  setShopTablesDbClientForTests,
  signTableQr,
} from '@/lib/shop-tables';
import type { OrderAuditLogRecord, ShopOrder } from '@/types/qlaok';

test('production audit fails closed when database configuration is unavailable', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-audit-config-'));
  const previousConsoleError = console.error;
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    setOrderAuditDbClientForTests(null, { forceDbMode: false });
    setOrderAuditLogFileForTests(path.join(directory, 'audit.jsonl'));
    console.error = () => {};
    assert.equal(await recordOrderAuditLog({ shopId: 'shop-test', orderId: 'order-test', actorId: 'test', action: 'test' }), false);
    await assert.rejects(() => queryOrderAuditLogs({ shopId: 'shop-test' }), /ORDER_AUDIT_DB_UNAVAILABLE/);
    assert.equal(readOrderAuditLog(10).length, 1, 'local backup may be retained for recovery');
  } finally {
    Object.assign(process.env, { NODE_ENV: previousNodeEnv });
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    setOrderAuditDbClientForTests(null);
    setOrderAuditLogFileForTests(null);
    console.error = previousConsoleError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('idempotent replay detection ignores updated_at but not real business changes', () => {
  const base = {
    status: 'acknowledged',
    paid_at: new Date('2026-10-30T22:00:00.000Z'),
    updated_at: '2026-10-30T22:00:00.000Z',
  };
  assert.equal(
    hasBusinessStateChanged(base, {
      ...base,
      paid_at: '2026-10-31T05:00:00.000+07:00',
      updated_at: '2026-10-31T06:00:00.000Z',
    }),
    false,
    'same instants and a refreshed updated_at are a no-op replay'
  );
  assert.equal(
    hasBusinessStateChanged(base, {
      ...base,
      paid_at: new Date('2026-10-30T22:00:00.001Z'),
    }),
    true,
    'a different Date instant is a real change'
  );
  assert.equal(
    hasBusinessStateChanged(base, { ...base, status: 'resolved' }),
    true
  );
  assert.equal(hasBusinessStateChanged(null, base), true);
  assert.equal(
    hasBusinessStateChanged(
      { customer_note: '2026-10-30T22:00:00.000Z' },
      { customer_note: '2026-10-31T05:00:00.000+07:00' }
    ),
    true,
    'equivalent timestamp strings in an ordinary text field are a real change'
  );
  assert.equal(
    hasBusinessStateChanged(
      { acknowledged_at: new Date('2026-10-30T22:00:00.000Z') },
      { acknowledged_at: '2026-10-31T05:00:00.000+07:00' }
    ),
    false,
    'a Date and its offset ISO string are the same instant for a timestamp field'
  );
  assert.equal(
    hasBusinessStateChanged(
      { resolved_at: '2026-10-30T22:00:00.000Z' },
      { resolved_at: '2026-10-31T05:00:00.000+07:00' }
    ),
    false
  );
});

function createPgliteAuditSupabaseClient(
  db: PGlite,
  options?: {
    shouldFailAdminAuditInsert?: () => boolean;
    shouldFailOrderAuditInsert?: () => boolean;
    shouldFailOrderAuditSelect?: () => boolean;
  }
) {
  const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

  class PgQueryBuilder {
    private table: string;
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private columns = '*';
    private eqFilters: Array<[string, unknown]> = [];
    private neqFilters: Array<[string, unknown]> = [];
    private ilikeFilters: Array<[string, string]> = [];
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

    insert(row: Record<string, unknown>) {
      this.mode = 'insert';
      this.payload = row;
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
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
    }

    private async execute(): Promise<{ data: unknown; error: unknown }> {
      try {
        if (
          this.table === 'admin_audit_logs' &&
          this.mode === 'insert' &&
          options?.shouldFailAdminAuditInsert?.()
        ) {
          return {
            data: null,
            error: {
              message: 'simulated admin_audit_logs insert failure',
              code: 'XX000',
            },
          };
        }

        if (
          this.table === 'order_audit_logs' &&
          this.mode === 'insert' &&
          options?.shouldFailOrderAuditInsert?.()
        ) {
          return {
            data: null,
            error: {
              message: 'simulated order_audit_logs insert failure',
              code: 'XX000',
            },
          };
        }

        if (
          this.table === 'order_audit_logs' &&
          this.mode === 'select' &&
          options?.shouldFailOrderAuditSelect?.()
        ) {
          return {
            data: null,
            error: {
              message: 'simulated order_audit_logs select failure',
              code: 'XX000',
            },
          };
        }

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

  return {
    from(table: string) {
      return new PgQueryBuilder(table);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      try {
        const keys = Object.keys(args);
        const values: unknown[] = [];
        const paramList = keys
          .map((k) => {
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
}

test('P2-12 Order Audit: durable DB + JSONL writes, multi-order table bill fan-out, service_request subject FK, admin status audit, SePay idempotency, non-fatal failure, and reports.view isolation', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const tempAuditDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'qlaok-order-audit-review-')
  );
  const tempAuditFile = path.join(tempAuditDir, 'order-audit.log.jsonl');
  const tempAdminAuditFile = path.join(tempAuditDir, 'admin-audit.log.jsonl');
  setOrderAuditLogFileForTests(tempAuditFile);
  setAdminAuditLogFileForTests(tempAdminAuditFile);

  const prevTableQrSecret = process.env.TABLE_QR_SIGNING_SECRET;
  const prevSepayEncKey = process.env.SEPAY_SECRET_ENCRYPTION_KEY;
  process.env.TABLE_QR_SIGNING_SECRET =
    'test-table-qr-signing-secret-for-order-audit-review-012345';
  process.env.SEPAY_SECRET_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let failAuditInsert = false;
  let failAuditSelect = false;
  let failAdminAuditInsert = false;
  const pgClient = createPgliteAuditSupabaseClient(db, {
    shouldFailAdminAuditInsert: () => failAdminAuditInsert,
    shouldFailOrderAuditInsert: () => failAuditInsert,
    shouldFailOrderAuditSelect: () => failAuditSelect,
  });

  const ownerAId = '00000000-0000-0000-0000-000000000901';
  const ownerBId = '00000000-0000-0000-0000-000000000902';
  const staffOrdersOnlyId = '00000000-0000-0000-0000-000000000903';
  const staffReportsId = '00000000-0000-0000-0000-000000000904';
  const superAdminId = '00000000-0000-0000-0000-000000000999';

  const shopAId = 'audit-shop-a';
  const shopBId = 'audit-shop-b';
  const tableA1Id = 'tbl-audit-a1';
  const sepayWebhookSecret = 'sepay-secret-shop-a-9999';
  const shopABankAccount = '888899990001';

  try {
    resetMposStoreForTests();
    __resetSePayStoreForTests();
    __resetLocalServiceRequestsForTests();

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
        ('${ownerAId}', 'owner-a@qlaok.test', 'Owner A', 'premium'),
        ('${ownerBId}', 'owner-b@qlaok.test', 'Owner B', 'premium'),
        ('${staffOrdersOnlyId}', 'staff-orders@qlaok.test', 'Staff Orders Only', 'free'),
        ('${staffReportsId}', 'staff-reports@qlaok.test', 'Staff Reports', 'free'),
        ('${superAdminId}', 'hoangvu96z@gmail.com', 'Super Admin', 'premium');

      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES
        ('${shopAId}', '${ownerAId}', 'audit-shop-a', 'Quán Audit A', true, '{"primaryColor":"#10b981","layout":"grid","paymentConfig":{"mode":"vietqr_auto","bankId":"MB","accountNumber":"${shopABankAccount}","transferPrefix":"QLAOK"}}'::jsonb),
        ('${shopBId}', '${ownerBId}', 'audit-shop-b', 'Quán Audit B', true, '{"primaryColor":"#10b981","layout":"grid"}'::jsonb);

      INSERT INTO categories (id, shop_id, sort_order, name_i18n, is_active) VALUES
        ('cat-audit-a', '${shopAId}', 1, '{"vi":"Món chính"}'::jsonb, true),
        ('cat-audit-b', '${shopBId}', 1, '{"vi":"Món chính"}'::jsonb, true);

      INSERT INTO items (id, shop_id, category_id, sort_order, price, stock_quantity, sold_count, is_available, name_i18n, desc_i18n) VALUES
        ('item-audit-a1', '${shopAId}', 'cat-audit-a', 1, 50000, 50, 0, true, '{"vi":"Phở Tái"}'::jsonb, '{"vi":"Ngon"}'::jsonb),
        ('item-audit-a2', '${shopAId}', 'cat-audit-a', 2, 30000, 50, 0, true, '{"vi":"Trà Sâm Dứa"}'::jsonb, '{"vi":"Mát"}'::jsonb),
        ('item-audit-b1', '${shopBId}', 'cat-audit-b', 1, 45000, 50, 0, true, '{"vi":"Bún Bò"}'::jsonb, '{"vi":"Ngon"}'::jsonb);

      INSERT INTO shop_tables (id, shop_id, name, table_code, section, capacity, sort_order, is_active, is_archived) VALUES
        ('${tableA1Id}', '${shopAId}', 'Bàn 01', 'T01', 'Tầng 1', 4, 1, true, false);

      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-owner-a', '${shopAId}', '${ownerAId}', 'owner', '["orders.view","orders.create","orders.fulfill","orders.edit_items","orders.cancel_unpaid","orders.print_kitchen","orders.print_provisional","payment.collect","discount.apply","payment.refund","reports.view"]'::jsonb, true),
        ('mem-owner-b', '${shopBId}', '${ownerBId}', 'owner', '["orders.view","orders.create","reports.view"]'::jsonb, true),
        ('mem-staff-orders', '${shopAId}', '${staffOrdersOnlyId}', 'staff', '["orders.view","orders.create","orders.fulfill","payment.collect"]'::jsonb, true),
        ('mem-staff-reports', '${shopAId}', '${staffReportsId}', 'cashier', '["orders.view","payment.collect","reports.view"]'::jsonb, true);
    `);

    const encryptedSepay = encryptSePaySecret(shopAId, sepayWebhookSecret);
    await db.query(
      `INSERT INTO public.shop_sepay_configs (shop_id, enabled, secret_ciphertext, secret_iv, secret_auth_tag, key_version, updated_by)
       VALUES ($1, true, $2, $3, $4, $5, $6)`,
      [
        shopAId,
        encryptedSepay.secret_ciphertext,
        encryptedSepay.secret_iv,
        encryptedSepay.secret_auth_tag,
        encryptedSepay.key_version,
        ownerAId,
      ]
    );

    setSupabaseDbClientForTests(pgClient);
    setOrderAuditDbClientForTests(pgClient, { forceDbMode: true });
    setShopMembershipDbClientForTest(pgClient as never);
    setShopTablesDbClientForTests(pgClient);
    setMposDbClientForTests(pgClient, true);
    __setServiceRequestsDbClientForTests(pgClient as never, {
      forceDbMode: true,
    });
    __setSePayDbClientForTests(pgClient as never, { forceDbMode: true });

    const ownerAToken = issueSessionToken({
      id: ownerAId,
      email: 'owner-a@qlaok.test',
      role: 'owner',
    });
    const ownerBToken = issueSessionToken({
      id: ownerBId,
      email: 'owner-b@qlaok.test',
      role: 'owner',
    });
    const staffOrdersOnlyToken = issueSessionToken({
      id: staffOrdersOnlyId,
      email: 'staff-orders@qlaok.test',
      role: 'staff',
    });
    const staffReportsToken = issueSessionToken({
      id: staffReportsId,
      email: 'staff-reports@qlaok.test',
      role: 'cashier',
    });
    const superAdminToken = issueSessionToken({
      id: superAdminId,
      email: 'hoangvu96z@gmail.com',
      role: 'admin',
    });

    const tableA1Sig = signTableQr(shopAId, tableA1Id);

    // =========================================================================
    // 1. Individual orders + Multi-order table bill settlement fan-out
    // =========================================================================
    const createOrd1Res = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          shop_id: shopAId,
          source: 'counter_pos',
          table_id: tableA1Id,
          table_label: 'Bàn 01',
          session_id: 'sess-table-a1',
          payment_method: 'cash',
          payment_status: 'unpaid',
          items: [
            {
              item_id: 'item-audit-a1',
              name_vi: 'Phở Tái',
              quantity: 1,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(createOrd1Res.status, 201);
    const order1 = ((await createOrd1Res.json()) as { order: ShopOrder }).order;

    assert.equal(
      await recordOrderAuditLog({
        shopId: shopAId,
        subjectType: 'order',
        orderId: '',
        subjectId: order1.id,
        actorId: ownerAId,
        actorRole: 'owner',
        action: 'test_empty_order_id_fallback',
      }),
      true,
      'A blank optional orderId must not hide a valid subjectId.'
    );
    const fallbackAudit = await db.query<{ subject_id: string; order_id: string }>(
      `SELECT subject_id, order_id FROM public.order_audit_logs
       WHERE shop_id = $1 AND action = 'test_empty_order_id_fallback'`,
      [shopAId]
    );
    assert.deepEqual(fallbackAudit.rows, [
      { subject_id: order1.id, order_id: order1.id },
    ]);

    const createOrd2Res = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          shop_id: shopAId,
          source: 'counter_pos',
          table_id: tableA1Id,
          table_label: 'Bàn 01',
          session_id: 'sess-table-a1',
          payment_method: 'cash',
          payment_status: 'unpaid',
          items: [
            {
              item_id: 'item-audit-a2',
              name_vi: 'Trà Sâm Dứa',
              quantity: 2,
              unit_price: 30000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(createOrd2Res.status, 201);
    const order2 = ((await createOrd2Res.json()) as { order: ShopOrder }).order;

    // Settle the multi-order table bill (order1 + order2)
    const settleRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          action: 'settle_table_bill',
          shop_id: shopAId,
          table_id: tableA1Id,
          table_label: 'Bàn 01',
          session_id: 'sess-table-a1',
          payment_method: 'cash',
          payment_idempotency_key: 'settle-idem-a1',
          cash_received: 110000,
        }),
      })
    );
    assert.equal(settleRes.status, 200);

    const settleReplayRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          action: 'settle_table_bill',
          shop_id: shopAId,
          table_id: tableA1Id,
          table_label: 'Bàn 01',
          session_id: 'sess-table-a1',
          payment_method: 'cash',
          payment_idempotency_key: 'settle-idem-a1',
          cash_received: 110000,
        }),
      })
    );
    assert.equal(settleReplayRes.status, 200);

    // Verify settle_table_bill fanned out 1 row per settled order in public.order_audit_logs (never comma-joined)
    const settleAuditRows = (
      await db.query<{
        id: string;
        subject_type: string;
        subject_id: string;
        order_id: string | null;
        service_request_id: string | null;
        action: string;
        details: { order_ids?: string[]; order_count?: number } | null;
      }>(
        `SELECT id, subject_type, subject_id, order_id, service_request_id, action, details
         FROM public.order_audit_logs
         WHERE shop_id = $1 AND action = 'settle_table_bill'
         ORDER BY order_id ASC`,
        [shopAId]
      )
    ).rows;
    assert.equal(
      settleAuditRows.length,
      2,
      'settle_table_bill must fan out one order_audit_logs row per settled order'
    );
    assert.deepEqual(
      settleAuditRows.map((r) => r.order_id).sort(),
      [order1.id, order2.id].sort()
    );
    for (const row of settleAuditRows) {
      assert.equal(row.subject_type, 'order');
      assert.equal(row.subject_id, row.order_id);
      assert.equal(row.service_request_id, null);
      assert.equal(row.order_id?.includes(','), false);
      assert.equal(row.details?.order_count, 2);
      assert.deepEqual(
        [...(row.details?.order_ids || [])].sort(),
        [order1.id, order2.id].sort()
      );
    }

    // =========================================================================
    // 2. Service Requests audit (`subject_type = 'service_request'`, FK to table_service_requests)
    // =========================================================================
    const createSrvRes = await postServiceRequests(
      new Request('http://localhost:3000/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopAId,
          table_id: tableA1Id,
          table_qr_sig: tableA1Sig,
          request_type: 'call_staff',
          visitor_lang: 'vi',
        }),
      })
    );
    assert.equal(createSrvRes.status, 201);
    const { serviceRequest } = (await createSrvRes.json()) as {
      serviceRequest: { id: string; status: string };
    };
    assert.match(serviceRequest.id, /^srv-/);

    // Duplicate repeat tap within cooldown must not create a second audit record
    const dupSrvRes = await postServiceRequests(
      new Request('http://localhost:3000/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopAId,
          table_id: tableA1Id,
          table_qr_sig: tableA1Sig,
          request_type: 'call_staff',
          visitor_lang: 'vi',
        }),
      })
    );
    assert.equal(dupSrvRes.status, 200);

    // Staff acknowledges the service request
    const ackSrvRes = await patchServiceRequests(
      new Request('http://localhost:3000/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffOrdersOnlyToken}`,
        },
        body: JSON.stringify({
          id: serviceRequest.id,
          shop_id: shopAId,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(ackSrvRes.status, 200);

    const srvAuditRows = (
      await db.query<{
        subject_type: string;
        subject_id: string;
        order_id: string | null;
        service_request_id: string | null;
        action: string;
      }>(
        `SELECT subject_type, subject_id, order_id, service_request_id, action
         FROM public.order_audit_logs
         WHERE shop_id = $1 AND service_request_id = $2
         ORDER BY created_at ASC, id ASC`,
        [shopAId, serviceRequest.id]
      )
    ).rows;
    assert.equal(
      srvAuditRows.length,
      2,
      'create_service_request (deduplicated once) + update_service_request must produce 2 rows'
    );
    assert.deepEqual(
      srvAuditRows.map((r) => ({
        subject_type: r.subject_type,
        subject_id: r.subject_id,
        order_id: r.order_id,
        service_request_id: r.service_request_id,
        action: r.action,
      })),
      [
        {
          subject_type: 'service_request',
          subject_id: serviceRequest.id,
          order_id: null,
          service_request_id: serviceRequest.id,
          action: 'create_service_request',
        },
        {
          subject_type: 'service_request',
          subject_id: serviceRequest.id,
          order_id: null,
          service_request_id: serviceRequest.id,
          action: 'update_service_request',
        },
      ]
    );

    // Repeating the already-acknowledged PATCH is an idempotent no-op replay.
    const replayAckSrvRes = await patchServiceRequests(
      new Request('http://localhost:3000/api/service-requests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffOrdersOnlyToken}`,
        },
        body: JSON.stringify({
          id: serviceRequest.id,
          shop_id: shopAId,
          status: 'acknowledged',
        }),
      })
    );
    assert.equal(replayAckSrvRes.status, 200);
    const srvAuditRowsAfterReplay = (
      await db.query<{ action: string }>(
        `SELECT action FROM public.order_audit_logs
         WHERE shop_id = $1 AND service_request_id = $2`,
        [shopAId, serviceRequest.id]
      )
    ).rows;
    assert.deepEqual(
      srvAuditRowsAfterReplay.map((r) => r.action).sort(),
      ['create_service_request', 'update_service_request'],
      'Replaying an acknowledged service request PATCH must not add an audit row'
    );

    // =========================================================================
    // 3. Super-admin update_order_status & SePay webhook idempotency
    // =========================================================================
    const createVietQrRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          shop_id: shopAId,
          source: 'counter_pos',
          table_label: 'Mang về',
          payment_method: 'vietqr',
          payment_status: 'unpaid',
          items: [
            {
              item_id: 'item-audit-a1',
              name_vi: 'Phở Tái',
              quantity: 1,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(createVietQrRes.status, 201);
    const vietQrOrder = ((await createVietQrRes.json()) as { order: ShopOrder })
      .order;

    const sepayPayload = JSON.stringify({
      id: 778899,
      accountNumber: shopABankAccount,
      content: `QLAOK ${vietQrOrder.order_code}`,
      transferType: 'in',
      transferAmount: 50000,
      referenceCode: 'FT778899',
    });
    const tsHeader = String(Math.floor(Date.now() / 1000));
    const sigHeader = signSePayWebhookPayload(
      sepayPayload,
      tsHeader,
      sepayWebhookSecret
    );

    const firstWebhookRes = await processSePayShopWebhook({
      shopId: shopAId,
      rawBody: sepayPayload,
      timestampHeader: tsHeader,
      signatureHeader: sigHeader,
    });
    assert.equal(firstWebhookRes.httpStatus, 200);
    assert.equal(firstWebhookRes.reconciled, true);
    assert.equal(firstWebhookRes.duplicate, false);

    // Deliver identical webhook a second time -> duplicate=true
    const duplicateWebhookRes = await processSePayShopWebhook({
      shopId: shopAId,
      rawBody: sepayPayload,
      timestampHeader: tsHeader,
      signatureHeader: sigHeader,
    });
    assert.equal(duplicateWebhookRes.httpStatus, 200);
    assert.equal(duplicateWebhookRes.reconciled, true);
    assert.equal(duplicateWebhookRes.duplicate, true);
    assert.equal(duplicateWebhookRes.code, 'DUPLICATE_EVENT_NOOP');

    // Verify exactly ONE SePay audit row in DB and ONE in JSONL
    const sepayDbAuditRows = (
      await db.query<{ id: string; action: string; order_id: string }>(
        `SELECT id, action, order_id
         FROM public.order_audit_logs
         WHERE shop_id = $1 AND order_id = $2 AND action = 'sepay_webhook_reconcile'`,
        [shopAId, vietQrOrder.id]
      )
    ).rows;
    assert.equal(
      sepayDbAuditRows.length,
      1,
      'SePay reconciliation must write exactly 1 deterministic DB audit row without duplicating across RPC + TS or duplicate webhook delivery'
    );
    assert.equal(sepayDbAuditRows[0]?.id, `audit-sepay-${shopAId}-778899`);

    const localSepayAuditRows = readOrderAuditLog(500).filter(
      (r) =>
        r.shop_id === shopAId &&
        r.order_id === vietQrOrder.id &&
        r.action === 'sepay_webhook_reconcile'
    );
    assert.equal(
      localSepayAuditRows.length,
      0,
      'A successful DB SePay audit insert (and its duplicate delivery) must not append local JSONL rows'
    );

    // Super-admin cancels and refunds the paid order via /api/admin
    const adminCancelRes = await postAdmin(
      new Request('http://localhost:3000/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
        body: JSON.stringify({
          action: 'update_order_status',
          orderId: vietQrOrder.id,
          status: 'cancelled',
          payment_status: 'refunded',
          cancelled_reason: 'Admin hủy đơn kiểm thử',
          refund_reason: 'Hoàn tiền VietQR cho khách',
        }),
      })
    );
    assert.equal(adminCancelRes.status, 200);

    const adminAuditRows = (
      await db.query<{
        action: string;
        actor_user_id: string;
        actor_role: string;
        reason: string | null;
      }>(
        `SELECT action, actor_user_id, actor_role, reason
         FROM public.order_audit_logs
         WHERE shop_id = $1 AND order_id = $2 AND action = 'admin_update_order_status'`,
        [shopAId, vietQrOrder.id]
      )
    ).rows;
    assert.equal(adminAuditRows.length, 1);
    assert.equal(adminAuditRows[0]?.actor_user_id, superAdminId);
    assert.equal(adminAuditRows[0]?.actor_role, 'admin');
    assert.equal(adminAuditRows[0]?.reason, 'Hoàn tiền VietQR cho khách');

    const countAdminActionRows = async () =>
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.admin_audit_logs
           WHERE action = 'update_order_status' AND target_id = $1`,
          [vietQrOrder.id]
        )
      ).rows[0]!.n;
    assert.equal(
      await countAdminActionRows(),
      1,
      'The real admin state change records exactly one admin action row'
    );

    // Repeating the identical cancellation/refund leaves persisted state unchanged.
    const adminCancelReplayRes = await postAdmin(
      new Request('http://localhost:3000/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${superAdminToken}`,
        },
        body: JSON.stringify({
          action: 'update_order_status',
          orderId: vietQrOrder.id,
          status: 'cancelled',
          payment_status: 'refunded',
          cancelled_reason: 'Admin hủy đơn kiểm thử',
          refund_reason: 'Hoàn tiền VietQR cho khách',
        }),
      })
    );
    assert.equal(adminCancelReplayRes.status, 200);
    assert.equal(
      (
        await db.query(
          `SELECT 1 FROM public.order_audit_logs
           WHERE shop_id = $1 AND order_id = $2 AND action = 'admin_update_order_status'`,
          [shopAId, vietQrOrder.id]
        )
      ).rows.length,
      1,
      'Admin replay must not add an admin_update_order_status order audit row'
    );
    assert.equal(
      await countAdminActionRows(),
      1,
      'Admin replay must not add an admin_audit_logs action row'
    );

    // Payment collection replay on an already-paid order (idempotent no-op).
    const createPayReplayRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          shop_id: shopAId,
          source: 'counter_pos',
          table_label: 'Mang về',
          payment_method: 'cash',
          payment_status: 'unpaid',
          items: [
            {
              item_id: 'item-audit-a2',
              name_vi: 'Trà Sâm Dứa',
              quantity: 1,
              unit_price: 30000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(createPayReplayRes.status, 201);
    const payReplayOrder = (
      (await createPayReplayRes.json()) as { order: ShopOrder }
    ).order;
    const collectPayment = () =>
      patchOrders(
        new Request('http://localhost:3000/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerAToken}`,
          },
          body: JSON.stringify({
            order_id: payReplayOrder.id,
            payment_status: 'paid',
            payment_method: 'cash',
            payment_idempotency_key: 'pay-replay-idem-1',
          }),
        })
      );
    const countUpdateOrderRows = async () =>
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM public.order_audit_logs
           WHERE shop_id = $1 AND order_id = $2 AND action = 'update_order'`,
          [shopAId, payReplayOrder.id]
        )
      ).rows[0]!.n;
    assert.equal((await collectPayment()).status, 200);
    assert.equal(await countUpdateOrderRows(), 1);
    assert.equal((await collectPayment()).status, 200);
    assert.equal(
      await countUpdateOrderRows(),
      1,
      'Replaying payment collection on a paid order must not add an update_order row'
    );

    // With the DB healthy, no order-audit JSONL rows are written for these events.
    assert.equal(
      readOrderAuditLog(2000).filter((r) =>
        [
          'settle_table_bill',
          'update_service_request',
          'admin_update_order_status',
          'update_order',
        ].includes(r.action)
      ).length,
      0,
      'Successful DB audit inserts must not duplicate into local JSONL'
    );

    const adminAuditUnauthorized = await getAdminAudit(
      new Request('http://localhost:3000/api/admin/audit')
    );
    assert.equal(adminAuditUnauthorized.status, 401);

    assert.equal(
      await recordAdminAuditLog({
        actorId: superAdminId,
        actorEmail: 'ADMIN@QLAOK.TEST',
        action: 'update_owner_plan',
        targetId: ownerAId,
        details: { plan: 'premium', serviceRoleKey: 'must-not-be-stored' },
      }),
      true
    );
    const storedAdminAudit = (
      await db.query<{
        actor_user_id: string;
        actor_email: string;
        action: string;
        target_id: string;
        details: Record<string, unknown>;
      }>(
        `SELECT actor_user_id, actor_email, action, target_id, details
         FROM public.admin_audit_logs WHERE action = 'update_owner_plan'`
      )
    ).rows[0];
    assert.equal(storedAdminAudit?.actor_user_id, superAdminId);
    assert.equal(storedAdminAudit?.actor_email, 'admin@qlaok.test');
    assert.equal(storedAdminAudit?.target_id, ownerAId);
    assert.equal(storedAdminAudit?.details.serviceRoleKey, '[REDACTED]');
    assert.equal(
      (await queryAdminAuditLogs(10)).some(
        (row) => row.action === 'update_owner_plan'
      ),
      true,
      'Super Admin audit rows must be queryable from the database'
    );

    await db.exec(
      `RESET ROLE; SELECT set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`
    );
    await assert.rejects(
      db.query(
        `INSERT INTO public.admin_audit_logs (id, actor_user_id, action)
         VALUES ('client-admin-audit', '${ownerAId}', 'client_write')`
      ),
      /permission denied|row-level security/i
    );
    await assert.rejects(
      db.query('SELECT * FROM public.admin_audit_logs'),
      /permission denied|row-level security/i
    );

    await db.exec(
      `RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false); SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); SET ROLE service_role`
    );
    await db.query(
      `INSERT INTO public.admin_audit_logs (id, actor_user_id, action)
       VALUES ('service-admin-audit', '${superAdminId}', 'service_role_write')`
    );
    await assert.rejects(
      db.exec('TRUNCATE public.admin_audit_logs'),
      /permission denied|IMMUTABLE_ADMIN_AUDIT_LOG/i,
      'TRUNCATE must not bypass append-only admin audit retention.'
    );
    await assert.rejects(
      db.exec('TRUNCATE public.order_audit_logs'),
      /permission denied|IMMUTABLE_ORDER_AUDIT_LOG/i,
      'TRUNCATE must not bypass order audit retention.'
    );
    const serviceRoleAdminAudit = (
      await db.query<{ id: string }>(
        `SELECT id FROM public.admin_audit_logs WHERE id = 'service-admin-audit'`
      )
    ).rows[0];
    assert.equal(serviceRoleAdminAudit?.id, 'service-admin-audit');
    await db.exec('RESET ROLE');
    await assert.rejects(
      db.query(
        `UPDATE public.admin_audit_logs SET action = 'tampered'
         WHERE id = 'service-admin-audit'`
      ),
      /IMMUTABLE_ADMIN_AUDIT_LOG/i
    );
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.role', '', false); SELECT set_config('request.jwt.claims', '', false)`);

    // =========================================================================
    // 4. Sensitive field redaction & Non-fatal audit write failure
    // =========================================================================
    await recordOrderAuditLog({
      shopId: shopAId,
      orderId: order1.id,
      actorId: ownerAId,
      actorRole: 'owner',
      action: 'redaction_check',
      details: {
        safe_note: 'visible',
        tracking_token: 'secret-guest-tracking-token',
        password: 'super-secret-password',
        secret_ciphertext: 'ciphertext-123',
        authorization: 'Bearer eyJhbGciOi...',
      },
    });

    const redactedRow = (
      await db.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM public.order_audit_logs WHERE shop_id = $1 AND action = 'redaction_check'`,
        [shopAId]
      )
    ).rows[0];
    assert.ok(redactedRow);
    assert.equal(redactedRow.details.safe_note, 'visible');
    assert.equal(redactedRow.details.tracking_token, '[REDACTED]');
    assert.equal(redactedRow.details.password, '[REDACTED]');
    assert.equal(redactedRow.details.secret_ciphertext, '[REDACTED]');
    assert.equal(redactedRow.details.authorization, '[REDACTED]');

    // Simulate DB failure on order_audit_logs INSERT: committed order and PATCH must still succeed!
    failAuditInsert = true;
    const capturedErrors: unknown[][] = [];
    const origConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      capturedErrors.push(args);
    };
    try {
      failAdminAuditInsert = true;
      assert.equal(
        await recordAdminAuditLog({
          actorId: superAdminId,
          actorEmail: 'admin@qlaok.test',
          action: 'simulated_admin_audit_failure',
          targetId: ownerBId,
        }),
        false,
        'admin audit DB failure must be visible to the caller'
      );
      fs.appendFileSync(
        tempAdminAuditFile,
        `${JSON.stringify({
          timestamp: '2026-10-28T12:00:00.000Z',
          actorId: superAdminId,
          actorEmail: 'legacy-admin@qlaok.test',
          action: 'legacy_admin_audit',
          targetId: ownerBId,
        })}\n`,
        { mode: 0o600 }
      );
      const readableAdminAudit = await queryAdminAuditLogs(20);
      assert.equal(
        readableAdminAudit.some(
          (row) => row.action === 'simulated_admin_audit_failure'
        ),
        true,
        'private local backups remain queryable alongside DB audit rows'
      );
      assert.equal(
        readableAdminAudit.some((row) => row.action === 'legacy_admin_audit'),
        true,
        'legacy JSONL entries without database IDs remain readable'
      );
      failAdminAuditInsert = false;

      const directResult = await recordOrderAuditLog({
        shopId: shopAId,
        orderId: order1.id,
        actorId: ownerAId,
        actorRole: 'owner',
        action: 'simulated_failing_audit',
      });
      assert.equal(
        directResult,
        false,
        'recordOrderAuditLog must return false when DB audit insert fails'
      );
      assert.equal(
        capturedErrors.some((args) => args[0] === 'ORDER_AUDIT_WRITE_FAILED'),
        true,
        'recordOrderAuditLog must log structured ORDER_AUDIT_WRITE_FAILED error'
      );

      // Creating an order while order_audit_logs DB insert is failing must still return 201!
      const resilientOrderRes = await postOrders(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerAToken}`,
          },
          body: JSON.stringify({
            shop_id: shopAId,
            source: 'counter_pos',
            table_label: 'Mang về',
            payment_method: 'cash',
            payment_status: 'unpaid',
            items: [
              {
                item_id: 'item-audit-a2',
                name_vi: 'Trà Sâm Dứa',
                quantity: 1,
                unit_price: 30000,
                extra_price: 0,
                selected_choices: [],
              },
            ],
          }),
        })
      );
      assert.equal(
        resilientOrderRes.status,
        201,
        'Committed order creation must never fail when subsequent audit DB insert fails'
      );
      const resilientOrder = (
        (await resilientOrderRes.json()) as { order: ShopOrder }
      ).order;

      // Updating the order while order_audit_logs DB insert is failing must still return 200!
      const resilientPatchRes = await patchOrders(
        new Request('http://localhost:3000/api/orders', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ownerAToken}`,
          },
          body: JSON.stringify({
            order_id: resilientOrder.id,
            status: 'preparing',
          }),
        })
      );
      assert.equal(
        resilientPatchRes.status,
        200,
        'Committed order update must never fail when subsequent audit DB insert fails'
      );

      // Local JSONL backup still captured both audit events despite DB audit failure
      const localBackupForResilient = readOrderAuditLog(500).filter(
        (r) => r.order_id === resilientOrder.id
      );
      assert.equal(localBackupForResilient.length, 2);
      assert.equal(
        fs.statSync(tempAuditFile).mode & 0o777,
        0o600,
        'JSONL fallback must keep private 0600 permissions'
      );
    } finally {
      failAdminAuditInsert = false;
      console.error = origConsoleError;
      failAuditInsert = false;
    }

    // =========================================================================
    // 5. Query endpoint GET /api/orders/audit authorization & shop isolation
    // =========================================================================
    // 5a. Missing shopId -> 400
    const missingShopRes = await getOrderAudit(
      new Request('http://localhost:3000/api/orders/audit', {
        headers: { Authorization: `Bearer ${ownerAToken}` },
      })
    );
    assert.equal(missingShopRes.status, 400);
    assert.equal((await missingShopRes.json()).code, 'SHOP_ID_REQUIRED');

    // 5b. Invalid subjectType -> 400
    const badSubjectTypeRes = await getOrderAudit(
      new Request(
        `http://localhost:3000/api/orders/audit?shopId=${shopAId}&subjectType=invalid_type`,
        {
          headers: { Authorization: `Bearer ${ownerAToken}` },
        }
      )
    );
    assert.equal(badSubjectTypeRes.status, 400);
    assert.equal(
      (await badSubjectTypeRes.json()).code,
      'INVALID_AUDIT_SUBJECT_TYPE'
    );

    // 5c. Unauthenticated -> 401
    const unauthAuditRes = await getOrderAudit(
      new Request(`http://localhost:3000/api/orders/audit?shopId=${shopAId}`)
    );
    assert.equal(unauthAuditRes.status, 401);

    // 5d. Staff with orders.view / payment.collect but WITHOUT reports.view -> 403
    const staffNoReportsRes = await getOrderAudit(
      new Request(`http://localhost:3000/api/orders/audit?shopId=${shopAId}`, {
        headers: { Authorization: `Bearer ${staffOrdersOnlyToken}` },
      })
    );
    assert.equal(staffNoReportsRes.status, 403);
    assert.equal(
      (await staffNoReportsRes.json()).code,
      'INSUFFICIENT_SHOP_PERMISSION'
    );

    // 5e. Cross-shop owner (Owner B querying Shop A) -> 403
    const crossShopAuditRes = await getOrderAudit(
      new Request(`http://localhost:3000/api/orders/audit?shopId=${shopAId}`, {
        headers: { Authorization: `Bearer ${ownerBToken}` },
      })
    );
    assert.equal(crossShopAuditRes.status, 403);

    // 5f. Staff with reports.view and Owner A can query Shop A audit logs with subject filters
    for (const token of [ownerAToken, staffReportsToken]) {
      const orderFilterRes = await getOrderAudit(
        new Request(
          `http://localhost:3000/api/orders/audit?shopId=${shopAId}&orderId=${order1.id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )
      );
      assert.equal(orderFilterRes.status, 200);
      const orderFilterData = (await orderFilterRes.json()) as {
        auditLogs: OrderAuditLogRecord[];
      };
      assert.equal(
        orderFilterData.auditLogs.every(
          (r) =>
            r.shop_id === shopAId &&
            r.subject_type === 'order' &&
            r.order_id === order1.id
        ),
        true
      );
      assert.equal(
        orderFilterData.auditLogs.some((r) => r.action === 'settle_table_bill'),
        true,
        'Order 1 audit trail must include settle_table_bill fan-out record'
      );

      const srvFilterRes = await getOrderAudit(
        new Request(
          `http://localhost:3000/api/orders/audit?shopId=${shopAId}&serviceRequestId=${serviceRequest.id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )
      );
      assert.equal(srvFilterRes.status, 200);
      const srvFilterData = (await srvFilterRes.json()) as {
        auditLogs: OrderAuditLogRecord[];
      };
      assert.equal(srvFilterData.auditLogs.length, 2);
      assert.equal(
        srvFilterData.auditLogs.every(
          (r) =>
            r.shop_id === shopAId &&
            r.subject_type === 'service_request' &&
            r.service_request_id === serviceRequest.id &&
            r.order_id === null
        ),
        true
      );
    }

    // 5g. Record print (`print_kitchen`) + Guest customer cancel (`customer_cancel_order`) + JSONL 0600 permissions
    const printRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          action: 'record_print',
          orderId: order1.id,
          ticketType: 'kitchen',
        }),
      })
    );
    assert.equal(printRes.status, 200);

    const guestQrOrderRes = await postOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: shopAId,
          source: 'qr_table',
          table_id: tableA1Id,
          table_label: 'Bàn 01',
          table_qr_sig: tableA1Sig,
          payment_method: 'cash',
          items: [
            {
              item_id: 'item-audit-a1',
              name_vi: 'Phở Tái',
              quantity: 1,
              unit_price: 50000,
              extra_price: 0,
              selected_choices: [],
            },
          ],
        }),
      })
    );
    assert.equal(guestQrOrderRes.status, 201);
    const guestQrOrder = (
      (await guestQrOrderRes.json()) as { order: ShopOrder }
    ).order;
    assert.ok(guestQrOrder.tracking_token);

    const guestCancelRes = await patchOrders(
      new Request('http://localhost:3000/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: guestQrOrder.id,
          tracking_token: guestQrOrder.tracking_token,
          table_qr_sig: tableA1Sig,
          status: 'cancelled',
        }),
      })
    );
    assert.equal(guestCancelRes.status, 200);

    const printAndCustomerCancelRows = (
      await db.query<{ action: string; order_id: string }>(
        `SELECT action, order_id
         FROM public.order_audit_logs
         WHERE shop_id = $1 AND action IN ('print_kitchen', 'customer_cancel_order')
         ORDER BY action ASC`,
        [shopAId]
      )
    ).rows;
    assert.deepEqual(printAndCustomerCancelRows, [
      { action: 'customer_cancel_order', order_id: guestQrOrder.id },
      { action: 'print_kitchen', order_id: order1.id },
    ]);

    const jsonlStat = fs.statSync(tempAuditFile);
    assert.equal(
      jsonlStat.mode & 0o777,
      0o600,
      'Local order-audit.log.jsonl must be written with private 0600 permissions'
    );

    // 5h. DB select failure in DB-authoritative mode returns 503 ORDER_AUDIT_QUERY_FAILED (never falls back to local JSONL)
    failAuditSelect = true;
    try {
      const dbErrRes = await getOrderAudit(
        new Request(`http://localhost:3000/api/orders/audit?shopId=${shopAId}`, {
          headers: { Authorization: `Bearer ${ownerAToken}` },
        })
      );
      assert.equal(dbErrRes.status, 503);
      const dbErrorBody = await dbErrRes.json();
      assert.equal(dbErrorBody.code, 'ORDER_AUDIT_QUERY_FAILED');
      assert.doesNotMatch(JSON.stringify(dbErrorBody), /simulated order_audit_logs select failure/);
    } finally {
      failAuditSelect = false;
    }

    // Missing service-role configuration is database unavailability, not an internal 500.
    const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      setSupabaseDbClientForTests(null);
      setOrderAuditDbClientForTests(null, { forceDbMode: true });
      const unavailableRes = await getOrderAudit(
        new Request(`http://localhost:3000/api/orders/audit?shopId=${shopAId}`, {
          headers: { Authorization: `Bearer ${ownerAToken}` },
        })
      );
      assert.equal(unavailableRes.status, 503);
      assert.equal((await unavailableRes.json()).code, 'ORDER_AUDIT_QUERY_FAILED');
    } finally {
      if (previousSupabaseUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
      }
      if (previousServiceRoleKey === undefined) {
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      } else {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
      }
      setSupabaseDbClientForTests(pgClient);
      setOrderAuditDbClientForTests(pgClient, { forceDbMode: true });
    }
  } finally {
    setOrderAuditLogFileForTests(null);
    setOrderAuditDbClientForTests(null);
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    setShopTablesDbClientForTests(null);
    setMposDbClientForTests(null);
    __setServiceRequestsDbClientForTests(null);
    __setSePayDbClientForTests(null);
    if (prevTableQrSecret === undefined) {
      delete process.env.TABLE_QR_SIGNING_SECRET;
    } else {
      process.env.TABLE_QR_SIGNING_SECRET = prevTableQrSecret;
    }
    if (prevSepayEncKey === undefined) {
      delete process.env.SEPAY_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.SEPAY_SECRET_ENCRYPTION_KEY = prevSepayEncKey;
    }
    await db.close();
    fs.rmSync(tempAuditDir, { recursive: true, force: true });
  }
});
