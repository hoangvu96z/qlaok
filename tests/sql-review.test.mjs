import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

test('migrations apply and enforce staff/cashier mutation boundaries in isolated PostgreSQL', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await db.exec('CREATE PUBLICATION supabase_realtime');
    const migrations = fs.readdirSync('supabase/migrations').filter((file) => file.endsWith('.sql')).sort();
    for (const file of migrations) {
      if (file === '002z_reconcile_legacy_bank_refs.sql') {
        await db.exec(`INSERT INTO profiles (id) VALUES ('legacy-payer');
          INSERT INTO payment_transactions (id,user_id,order_code,target_plan,amount,status,bank_ref_id,created_at)
          VALUES ('legacy-a','legacy-payer','LEGACY-A','basic',100000,'completed','FT2628799999','2026-01-01'),
                 ('legacy-b','legacy-payer','LEGACY-B','basic',200000,'completed','FT2628799999','2026-01-02');`);
        await assert.rejects(db.exec('CREATE UNIQUE INDEX failing_bank_ref_index ON payment_transactions(bank_ref_id) WHERE bank_ref_id IS NOT NULL'), /duplicat|unique/i);
      }
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    const repaired = (await db.query("SELECT id,amount,status,bank_ref_id FROM payment_transactions ORDER BY id")).rows;
    await db.exec(fs.readFileSync('supabase/migrations/006_orders_realtime_publication.sql', 'utf8'));
    assert.equal((await db.query("SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='orders'")).rows.length, 1, 'orders publication membership is idempotent');
    assert.deepEqual(repaired.map(r => [r.id, Number(r.amount), r.status, r.bank_ref_id]), [
      ['legacy-a',100000,'completed','FT2628799999'], ['legacy-b',200000,'completed',null],
    ]);
    const archived = (await db.query('SELECT * FROM payment_bank_ref_conflicts ORDER BY transaction_id')).rows;
    assert.equal(archived.length, 2, 'preserve the entire conflicting group for reconciliation');
    assert.equal(archived[1].original_transaction.bank_ref_id, 'FT2628799999');
    assert.equal(archived[1].retained_transaction_id, 'legacy-a');
    await db.exec(fs.readFileSync('supabase/migrations/002z_reconcile_legacy_bank_refs.sql', 'utf8'));
    assert.equal((await db.query('SELECT * FROM payment_bank_ref_conflicts')).rows.length, 2);
    await assert.rejects(db.exec("INSERT INTO payment_transactions (user_id,order_code,target_plan,amount,bank_ref_id) VALUES ('legacy-payer','REPLAY','basic',1,'FT2628799999')"), /duplicat|unique/i);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query('SELECT * FROM payment_bank_ref_conflicts'), /permission denied/i);
    await db.exec('RESET ROLE');
    for (const file of migrations.filter((name) => name.startsWith('004_') || name.startsWith('005_'))) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    const owner = '00000000-0000-0000-0000-000000000001';
    const staff = '00000000-0000-0000-0000-000000000002';
    const cashier = '00000000-0000-0000-0000-000000000003';
    await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      INSERT INTO profiles (id) VALUES ('${owner}'), ('${staff}'), ('${cashier}');
      INSERT INTO shops (id, owner_id, slug, name, is_published) VALUES ('sql-shop', '${owner}', 'sql-shop', 'SQL fixture', false);
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions) VALUES
        ('staff', 'sql-shop', '${staff}', 'staff', '["orders.view","orders.fulfill","members.manage","settings.manage"]'),
        ('cashier', 'sql-shop', '${cashier}', 'cashier', '["orders.view","payment.collect"]');
      INSERT INTO orders (id, order_code, shop_id, total_amount) VALUES ('sql-order', 'SQL-1', 'sql-shop', 100000);`);
    for (const user of [staff, cashier]) {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);
        SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${user}"}', false);`);
      assert.equal((await db.query('SELECT id FROM orders')).rows.length, 1, 'member should read assigned orders');
      await assert.rejects(db.query("SELECT commit_order_with_inventory('{}'::jsonb, '[]'::jsonb)"), /permission denied/i);
      for (const mutation of [
        "UPDATE orders SET total_amount=1 WHERE id='sql-order' RETURNING id",
        "UPDATE orders SET payment_status='paid' WHERE id='sql-order' RETURNING id",
        "UPDATE shops SET theme_config='{\"paymentConfig\":{\"accountNumber\":\"hijack\"}}' WHERE id='sql-shop' RETURNING id",
        "UPDATE shop_memberships SET role='owner' WHERE user_id=auth.uid()::text RETURNING id",
      ]) {
        let changed = false;
        try { changed = (await db.query(mutation)).rows.length > 0; } catch { /* policy or trigger denial */ }
        assert.equal(changed, false, `direct mutation should be denied: ${mutation}`);
      }
      await db.exec('RESET ROLE');
    }
    await db.exec("SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); SET ROLE anon");
    assert.equal((await db.query('SELECT id FROM orders')).rows.length, 0);
    await assert.rejects(db.query("SELECT settle_table_bill_atomic('sql-shop', NULL, 'review')"), /permission denied/i);
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role");
    assert.equal((await db.query("UPDATE orders SET payment_status='paid' WHERE id='sql-order' RETURNING id")).rows.length, 1);
    await db.exec("INSERT INTO categories (id, shop_id) VALUES ('sql-cat', 'sql-shop'); INSERT INTO items (id, shop_id, category_id, price, stock_quantity) VALUES ('sql-item', 'sql-shop', 'sql-cat', 10000, 5)");
    const order = { id: 'atomic-order', order_code: 'ATOM-1', shop_id: 'sql-shop', idempotency_key: 'atomic-create',
      total_amount: 20000, subtotal_amount: 20000, payment_status: 'unpaid', status: 'new',
      items: [{ item_id: 'sql-item', quantity: 2, unit_price: 10000, extra_price: 0 }],
    };
    const commit = (value, delta) => db.query('SELECT commit_order_with_inventory($1::jsonb, $2::jsonb) AS result',
      [JSON.stringify(value), JSON.stringify([{ item_id: 'sql-item', delta }])]);
    await commit(order, 2);
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3);
    await commit(order, 2);
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3, 'idempotent create must not deduct twice');
    await assert.rejects(commit({ ...order, id: 'out-of-stock', idempotency_key: 'other-key' }, 4));
    assert.equal((await db.query("SELECT id FROM orders WHERE id='out-of-stock'")).rows.length, 0, 'failed inventory transaction must not leave an order');
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3);
    await assert.rejects(db.query("SELECT update_order_with_inventory('sql-order', '{\"payment_status\":\"unpaid\"}'::jsonb, '[]'::jsonb, '{}'::jsonb)"), /INVALID_PAYMENT_TRANSITION/);
    await assert.rejects(db.query("SELECT update_order_with_inventory('atomic-order', '{\"customer_note\":\"stale edit\"}'::jsonb, '[]'::jsonb, '{\"expected_bill_version\":999}'::jsonb)"), /CONCURRENT_BILL_VERSION/);

  } finally { await db.close(); }
});
