import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  DEMO_PURGE_TABLES,
  PRESERVED_PUBLIC_TABLES,
  DEMO_PURGE_STATEMENTS,
  buildDemoPurgeSql,
} from '../scripts/demo-reset-purge.mjs';
import { PUBLIC_TABLES } from '../scripts/preflight-demo-reset.mjs';

const EXPECTED_PURGE_ORDER = [
  'staff_login_rate_limits',
  'payment_bank_ref_conflicts',
  'sepay_webhook_events',
  'order_audit_logs',
  'orders',
  'table_service_requests',
  'shop_tables',
  'mobile_push_tokens',
  'shop_sepay_configs',
  'shop_staff_credentials',
  'shop_memberships',
  'shop_slug_aliases',
  'analytics_events',
  'posts',
  'items',
  'categories',
  'payment_transactions',
  'shops',
  'profiles',
];

const SHOP_CHILD_TABLES = [
  'sepay_webhook_events',
  'order_audit_logs',
  'orders',
  'table_service_requests',
  'shop_tables',
  'mobile_push_tokens',
  'shop_sepay_configs',
  'shop_staff_credentials',
  'shop_memberships',
  'shop_slug_aliases',
  'analytics_events',
  'posts',
  'items',
  'categories',
];

test('DEMO_PURGE_TABLES: exports an immutable ordered list of the exact 19 app data tables', () => {
  assert.equal(Object.isFrozen(DEMO_PURGE_TABLES), true);
  assert.equal(Object.isFrozen(PRESERVED_PUBLIC_TABLES), true);
  assert.equal(Object.isFrozen(DEMO_PURGE_STATEMENTS), true);

  assert.equal(DEMO_PURGE_TABLES.length, 19);
  assert.deepEqual([...DEMO_PURGE_TABLES], EXPECTED_PURGE_ORDER);
  assert.deepEqual([...PRESERVED_PUBLIC_TABLES], [
    'provinces',
    'schema_migrations',
  ]);

  // Verify no duplicates and exact partitioning of the 21 public tables
  const uniquePurge = new Set(DEMO_PURGE_TABLES);
  assert.equal(uniquePurge.size, 19);
  assert.equal(uniquePurge.has('provinces'), false);
  assert.equal(uniquePurge.has('schema_migrations'), false);

  const combined = [...DEMO_PURGE_TABLES, ...PRESERVED_PUBLIC_TABLES].sort();
  assert.deepEqual(combined, [...PUBLIC_TABLES].sort());
});

test('DEMO_PURGE_TABLES: enforces child-first FK and trigger dependency ordering', () => {
  const indexOf = (table) => {
    const idx = DEMO_PURGE_TABLES.indexOf(table);
    assert.notEqual(idx, -1, `Expected table ${table} in DEMO_PURGE_TABLES`);
    return idx;
  };

  // Unlinked tables included explicitly
  assert.ok(DEMO_PURGE_TABLES.includes('staff_login_rate_limits'));
  assert.ok(DEMO_PURGE_TABLES.includes('payment_bank_ref_conflicts'));

  // Trigger boundary 1: sepay_webhook_events before orders
  assert.ok(
    indexOf('sepay_webhook_events') < indexOf('orders'),
    'sepay_webhook_events must be deleted before orders'
  );
  assert.ok(
    indexOf('order_audit_logs') < indexOf('orders'),
    'order_audit_logs must be deleted before orders'
  );

  // Trigger boundary 2: orders and table_service_requests before shop_tables
  assert.ok(
    indexOf('orders') < indexOf('shop_tables'),
    'orders must be deleted before shop_tables'
  );
  assert.ok(
    indexOf('table_service_requests') < indexOf('shop_tables'),
    'table_service_requests must be deleted before shop_tables'
  );

  // Catalog hierarchy: analytics_events -> items -> categories -> shops
  assert.ok(
    indexOf('analytics_events') < indexOf('items'),
    'analytics_events must be deleted before items'
  );
  assert.ok(
    indexOf('items') < indexOf('categories'),
    'items must be deleted before categories'
  );

  // All shop children before parent shops
  const shopsIdx = indexOf('shops');
  for (const childTable of SHOP_CHILD_TABLES) {
    assert.ok(
      indexOf(childTable) < shopsIdx,
      `${childTable} must be deleted before shops`
    );
  }

  // All profile children before parent profiles
  const profilesIdx = indexOf('profiles');
  assert.ok(
    indexOf('payment_transactions') < profilesIdx,
    'payment_transactions must be deleted before profiles'
  );
  assert.ok(
    shopsIdx < profilesIdx,
    'shops must be deleted before profiles'
  );
});

test('buildDemoPurgeSql: returns only schema-qualified DELETE statements without transaction wrapper or dynamic input', () => {
  assert.throws(
    () => buildDemoPurgeSql('public.shops'),
    /does not accept dynamic arguments/
  );

  const sql = buildDemoPurgeSql();
  const lines = sql.split('\n');
  assert.equal(lines.length, 19);

  for (let i = 0; i < EXPECTED_PURGE_ORDER.length; i++) {
    const table = EXPECTED_PURGE_ORDER[i];
    assert.equal(lines[i], `DELETE FROM public.${table};`);
    assert.match(lines[i], /^DELETE FROM public\.[a-z_]+;$/);
  }

  assert.equal(/\b(BEGIN|COMMIT|ROLLBACK|TRUNCATE|DROP|ALTER)\b/i.test(sql), false);
  assert.equal(/\b(provinces|schema_migrations)\b/i.test(sql), false);
  assert.equal(/\b(auth|storage|realtime)\./i.test(sql), false);
});

test('PGlite execution: enforces FK/trigger boundaries and cleanly purges all 19 app tables while preserving static and migration tables', async () => {
  const db = new PGlite();
  try {
    // 1. Create minimal faithful schema with FKs and the two deletion-blocking triggers
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL
      );

      CREATE TABLE public.schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL
      );

      CREATE TABLE public.provinces (
        code VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL
      );

      CREATE TABLE public.profiles (
        id TEXT PRIMARY KEY,
        email TEXT
      );

      CREATE TABLE public.payment_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        order_code TEXT UNIQUE NOT NULL
      );

      CREATE TABLE public.payment_bank_ref_conflicts (
        transaction_id TEXT PRIMARY KEY,
        retained_transaction_id TEXT NOT NULL
      );

      CREATE TABLE public.shops (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL
      );

      CREATE TABLE public.shop_slug_aliases (
        slug VARCHAR(100) PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE
      );

      CREATE TABLE public.categories (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE
      );

      CREATE TABLE public.items (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE
      );

      CREATE TABLE public.posts (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE
      );

      CREATE TABLE public.analytics_events (
        id BIGSERIAL PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES public.items(id) ON DELETE SET NULL
      );

      CREATE TABLE public.shop_tables (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        table_code TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE public.orders (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        table_id TEXT REFERENCES public.shop_tables(id) ON DELETE SET NULL,
        order_code TEXT NOT NULL
      );

      CREATE TABLE public.order_audit_logs (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE
      );

      CREATE TABLE public.table_service_requests (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        table_id TEXT NOT NULL REFERENCES public.shop_tables(id) ON DELETE CASCADE
      );

      CREATE TABLE public.shop_memberships (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL
      );

      CREATE TABLE public.shop_staff_credentials (
        user_id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        username TEXT NOT NULL
      );

      CREATE TABLE public.staff_login_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        failure_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE public.mobile_push_tokens (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL
      );

      CREATE TABLE public.shop_sepay_configs (
        shop_id TEXT PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE public.sepay_webhook_events (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
        order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('reconciled', 'rejected', 'conflict'))
      );

      -- Trigger 1 (from 007_shop_tables.sql): blocks deleting shop_tables when historical orders exist
      CREATE OR REPLACE FUNCTION public.enforce_shop_table_boundaries()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = OLD.id) THEN
            RAISE EXCEPTION 'TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD: Bàn đã có lịch sử đơn hàng, vui lòng lưu trữ (archive) thay vì xóa vĩnh viễn.';
          END IF;
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_enforce_shop_table_boundaries
      BEFORE DELETE ON public.shop_tables
      FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_table_boundaries();

      -- Trigger 2 (from 011_sepay_order_reconciliation.sql): blocks mutating order_id on reconciled webhook events
      CREATE OR REPLACE FUNCTION public.enforce_sepay_webhook_events_boundaries()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          IF OLD.outcome = 'reconciled' AND (
            NEW.outcome IS DISTINCT FROM 'reconciled'
            OR NEW.order_id IS DISTINCT FROM OLD.order_id
          ) THEN
            RAISE EXCEPTION 'IMMUTABLE_SEPAY_EVENT_OUTCOME: Sự kiện SePay đã đối soát thành công không thể đổi ngược trạng thái.';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_enforce_sepay_webhook_events_boundaries
      BEFORE UPDATE ON public.sepay_webhook_events
      FOR EACH ROW EXECUTE FUNCTION public.enforce_sepay_webhook_events_boundaries();
    `);

    // 2. Populate rows in auth.users, preserved tables, and all 19 app data tables
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('owner-demo-001', 'chuquan@qlaok.vn'),
        ('admin-super-001', 'hoangvu96z@gmail.com');

      INSERT INTO public.schema_migrations (filename, checksum) VALUES
        ('001_init_qlaok.sql', 'chk-001'),
        ('019_revoke_staff_trigger_execute.sql', 'chk-019');

      INSERT INTO public.provinces (code, name) VALUES
        ('ha-noi', 'Hà Nội'),
        ('da-nang', 'Đà Nẵng'),
        ('tp-ho-chi-minh', 'TP. Hồ Chí Minh');

      INSERT INTO public.profiles (id, email) VALUES
        ('owner-demo-001', 'chuquan@qlaok.vn'),
        ('qa-owner-001', 'hvtekshop@gmail.com');

      INSERT INTO public.payment_transactions (id, user_id, order_code) VALUES
        ('tx-001', 'owner-demo-001', 'QLAOK-TX-001');

      INSERT INTO public.payment_bank_ref_conflicts (transaction_id, retained_transaction_id) VALUES
        ('tx-conflict-001', 'tx-001');

      INSERT INTO public.shops (id, owner_id, slug, name) VALUES
        ('shop-fnb-001', 'owner-demo-001', 'pho-hoi-an', 'Phở Hội An'),
        ('shop-qa-999', 'qa-owner-001', 'qa-shop', 'QA Test Shop');

      INSERT INTO public.shop_slug_aliases (slug, shop_id) VALUES
        ('pho-hoi-an-old', 'shop-fnb-001');

      INSERT INTO public.categories (id, shop_id) VALUES
        ('cat-001', 'shop-fnb-001');

      INSERT INTO public.items (id, shop_id, category_id) VALUES
        ('item-001', 'shop-fnb-001', 'cat-001');

      INSERT INTO public.posts (id, shop_id) VALUES
        ('post-001', 'shop-fnb-001');

      INSERT INTO public.analytics_events (shop_id, item_id) VALUES
        ('shop-fnb-001', 'item-001');

      INSERT INTO public.shop_tables (id, shop_id, table_code, name) VALUES
        ('tbl-fnb-01', 'shop-fnb-001', 'T01', 'Bàn 01');

      INSERT INTO public.orders (id, shop_id, table_id, order_code) VALUES
        ('ord-769', 'shop-fnb-001', 'tbl-fnb-01', 'ORD-769');

      INSERT INTO public.order_audit_logs (id, shop_id, order_id) VALUES
        ('audit-001', 'shop-fnb-001', 'ord-769');

      INSERT INTO public.table_service_requests (id, shop_id, table_id) VALUES
        ('srv-001', 'shop-fnb-001', 'tbl-fnb-01');

      INSERT INTO public.shop_memberships (id, shop_id, user_id) VALUES
        ('mem-001', 'shop-fnb-001', 'owner-demo-001');

      INSERT INTO public.shop_staff_credentials (user_id, shop_id, username) VALUES
        ('staff-acct-0000001', 'shop-fnb-001', 'thungan01');

      INSERT INTO public.staff_login_rate_limits (bucket_key, failure_count) VALUES
        ('rl-staff-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 3);

      INSERT INTO public.mobile_push_tokens (id, shop_id, user_id) VALUES
        ('push-001', 'shop-fnb-001', 'owner-demo-001');

      INSERT INTO public.shop_sepay_configs (shop_id, enabled) VALUES
        ('shop-fnb-001', TRUE);

      INSERT INTO public.sepay_webhook_events (id, shop_id, order_id, outcome) VALUES
        ('sepay-evt-001', 'shop-fnb-001', 'ord-769', 'reconciled');
    `);

    // Confirm all 21 public tables have rows before purge
    for (const table of PUBLIC_TABLES) {
      const res = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.${table}`);
      assert.ok(
        res.rows[0].cnt > 0,
        `Expected public.${table} to be populated before purge`
      );
    }

    // 3. Prove the trigger boundaries are active when deletion order is violated
    await db.exec('BEGIN; SAVEPOINT before_bad_deletes;');
    await assert.rejects(
      db.exec('DELETE FROM public.orders;'),
      /IMMUTABLE_SEPAY_EVENT_OUTCOME/,
      'Deleting orders before sepay_webhook_events must fail due to ON DELETE SET NULL hitting the reconciled webhook immutability trigger'
    );
    await db.exec('ROLLBACK TO SAVEPOINT before_bad_deletes;');

    await assert.rejects(
      db.exec('DELETE FROM public.shop_tables;'),
      /TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD/,
      'Deleting shop_tables before orders must fail due to BEFORE DELETE table history guard'
    );
    await db.exec('ROLLBACK TO SAVEPOINT before_bad_deletes;');

    await assert.rejects(
      db.exec('DELETE FROM public.shops;'),
      /TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD|IMMUTABLE_SEPAY_EVENT_OUTCOME/,
      'Parent-first cascade delete on shops must fail due to child triggers'
    );
    await db.exec('ROLLBACK;');

    // 4. Execute generated purge SQL inside a transaction (matching reset executor usage)
    const purgeSql = buildDemoPurgeSql();
    await db.exec(`BEGIN;\n${purgeSql}\nCOMMIT;`);

    // 5. Assert all 19 target app tables are now empty
    for (const table of DEMO_PURGE_TABLES) {
      const res = await db.query(`SELECT COUNT(*)::int AS cnt FROM public.${table}`);
      assert.equal(
        res.rows[0].cnt,
        0,
        `Expected public.${table} to be empty after purge`
      );
    }

    // 6. Assert preserved public tables and auth.users remain intact
    const migrationsAfter = await db.query(
      'SELECT filename FROM public.schema_migrations ORDER BY filename'
    );
    assert.deepEqual(
      migrationsAfter.rows.map((r) => r.filename),
      ['001_init_qlaok.sql', '019_revoke_staff_trigger_execute.sql']
    );

    const provincesAfter = await db.query(
      'SELECT code FROM public.provinces ORDER BY code'
    );
    assert.deepEqual(
      provincesAfter.rows.map((r) => r.code),
      ['da-nang', 'ha-noi', 'tp-ho-chi-minh']
    );

    const authUsersAfter = await db.query(
      'SELECT id FROM auth.users ORDER BY id'
    );
    assert.deepEqual(
      authUsersAfter.rows.map((r) => r.id),
      ['admin-super-001', 'owner-demo-001']
    );
  } finally {
    await db.close();
  }
});
