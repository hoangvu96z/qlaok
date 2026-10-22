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
    for (const file of migrations.filter((name) => name.startsWith('004_') || name.startsWith('005_') || name.startsWith('007_'))) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    const owner = '00000000-0000-0000-0000-000000000001';
    const staff = '00000000-0000-0000-0000-000000000002';
    const cashier = '00000000-0000-0000-0000-000000000003';
    await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      INSERT INTO profiles (id) VALUES ('${owner}'), ('${staff}'), ('${cashier}');
      INSERT INTO shops (id, owner_id, slug, name, is_published) VALUES ('sql-shop', '${owner}', 'sql-shop', 'SQL fixture', false);
      INSERT INTO shops (id, owner_id, slug, name, is_published) VALUES ('sql-pub-shop', '${owner}', 'sql-pub-shop', 'Published SQL fixture', true);
      INSERT INTO shop_tables (id, shop_id, table_code, name, is_active, is_archived) VALUES
        ('sql-tbl-1', 'sql-shop', 'T01', 'Bàn 01', true, false),
        ('sql-tbl-inactive', 'sql-shop', 'T02', 'Bàn 02', false, false),
        ('sql-pub-tbl-active', 'sql-pub-shop', 'P01', 'Bàn Công Khai 1', true, false),
        ('sql-pub-tbl-inactive', 'sql-pub-shop', 'P02', 'Bàn Công Khai 2', false, false);
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions) VALUES
        ('staff', 'sql-shop', '${staff}', 'staff', '["orders.view","orders.fulfill","members.manage","settings.manage"]'),
        ('cashier', 'sql-shop', '${cashier}', 'cashier', '["orders.view","payment.collect"]');
      INSERT INTO orders (id, order_code, shop_id, total_amount) VALUES ('sql-order', 'SQL-1', 'sql-shop', 100000);`);
    for (const user of [staff, cashier]) {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);
        SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${user}"}', false);`);
      assert.equal((await db.query('SELECT id FROM orders')).rows.length, 1, 'member should read assigned orders');
      assert.equal((await db.query("SELECT id FROM shop_tables WHERE shop_id='sql-shop'")).rows.length, 2, 'member should read all shop_tables including inactive');
      await assert.rejects(db.query("SELECT commit_order_with_inventory('{}'::jsonb, '[]'::jsonb)"), /permission denied/i);
      for (const mutation of [
        "UPDATE orders SET total_amount=1 WHERE id='sql-order' RETURNING id",
        "UPDATE orders SET payment_status='paid' WHERE id='sql-order' RETURNING id",
        "UPDATE shops SET theme_config='{\"paymentConfig\":{\"accountNumber\":\"hijack\"}}' WHERE id='sql-shop' RETURNING id",
        "UPDATE shop_memberships SET role='owner' WHERE user_id=auth.uid()::text RETURNING id",
        "INSERT INTO shop_tables (id, shop_id, table_code, name) VALUES ('hijack-tbl', 'sql-shop', 'T99', 'Bàn 99') RETURNING id",
        "UPDATE shop_tables SET name='Hijacked' WHERE id='sql-tbl-1' RETURNING id",
        "DELETE FROM shop_tables WHERE id='sql-tbl-1' RETURNING id",
      ]) {
        let changed = false;
        try { changed = (await db.query(mutation)).rows.length > 0; } catch { /* policy or trigger denial */ }
        assert.equal(changed, false, `direct mutation should be denied: ${mutation}`);
      }
      await db.exec('RESET ROLE');
    }
    await db.exec("SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); SET ROLE anon");
    assert.equal((await db.query('SELECT id FROM orders')).rows.length, 0);
    assert.deepEqual(
      (await db.query("SELECT id FROM shop_tables WHERE shop_id IN ('sql-shop', 'sql-pub-shop') ORDER BY id")).rows.map((r) => r.id),
      ['sql-pub-tbl-active'],
      'anon should only see active unarchived tables of published shops'
    );
    await assert.rejects(db.query("SELECT settle_table_bill_atomic('sql-shop', NULL, 'review')"), /permission denied/i);

    // Owner can manage their own shop_tables via RLS
    await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${owner}', false);
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${owner}"}', false);`);
    assert.equal(
      (await db.query("INSERT INTO shop_tables (id, shop_id, table_code, name) VALUES ('sql-tbl-owner', 'sql-shop', 'T03', 'Bàn 03') RETURNING id")).rows.length,
      1,
      'owner should be able to create shop_tables'
    );

    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role");
    assert.equal((await db.query("UPDATE orders SET payment_status='paid' WHERE id='sql-order' RETURNING id")).rows.length, 1);
    await db.exec("INSERT INTO categories (id, shop_id) VALUES ('sql-cat', 'sql-shop'); INSERT INTO items (id, shop_id, category_id, price, stock_quantity) VALUES ('sql-item', 'sql-shop', 'sql-cat', 10000, 5)");
    const order = { id: 'atomic-order', order_code: 'ATOM-1', shop_id: 'sql-shop', table_id: 'sql-tbl-1', table_label: 'Spoofed Name', idempotency_key: 'atomic-create',
      total_amount: 20000, subtotal_amount: 20000, payment_status: 'unpaid', status: 'new',
      items: [{ item_id: 'sql-item', quantity: 2, unit_price: 10000, extra_price: 0 }],
    };
    const commit = (value, delta) => db.query('SELECT commit_order_with_inventory($1::jsonb, $2::jsonb) AS result',
      [JSON.stringify(value), JSON.stringify([{ item_id: 'sql-item', delta }])]);
    const committedAtomic = (await commit(order, 2)).rows[0].result;
    assert.equal(committedAtomic.table_id, 'sql-tbl-1');
    assert.equal(committedAtomic.table_label, 'Bàn 01', 'commit_order_with_inventory must snapshot canonical table name');
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3);
    await commit(order, 2);
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3, 'idempotent create must not deduct twice');
    await assert.rejects(
      commit({ ...order, id: 'cross-shop-tbl-order', idempotency_key: 'cross-tbl-key', table_id: 'sql-pub-tbl-active' }, 1),
      /INVALID_TABLE_SHOP/
    );
    await assert.rejects(
      commit({ ...order, id: 'inactive-tbl-order', idempotency_key: 'inactive-tbl-key', table_id: 'sql-tbl-inactive' }, 1),
      /INACTIVE_SHOP_TABLE/
    );
    await assert.rejects(
      db.query("DELETE FROM shop_tables WHERE id='sql-tbl-1'"),
      /TABLE_HAS_HISTORICAL_ORDERS_ARCHIVE_INSTEAD/
    );
    await assert.rejects(commit({ ...order, id: 'out-of-stock', idempotency_key: 'other-key' }, 4));
    assert.equal((await db.query("SELECT id FROM orders WHERE id='out-of-stock'")).rows.length, 0, 'failed inventory transaction must not leave an order');
    assert.equal((await db.query("SELECT stock_quantity FROM items WHERE id='sql-item'")).rows[0].stock_quantity, 3);
    await assert.rejects(db.query("SELECT update_order_with_inventory('sql-order', '{\"payment_status\":\"unpaid\"}'::jsonb, '[]'::jsonb, '{}'::jsonb)"), /INVALID_PAYMENT_TRANSITION/);
    await assert.rejects(db.query("SELECT update_order_with_inventory('atomic-order', '{\"customer_note\":\"stale edit\"}'::jsonb, '[]'::jsonb, '{\"expected_bill_version\":999}'::jsonb)"), /CONCURRENT_BILL_VERSION/);

    // Archive table T01 ('Bàn 01'), create a new table reusing 'Bàn 01', and verify settle_table_bill_atomic by table_id does not merge them
    await db.query("UPDATE shop_tables SET is_archived=true WHERE id='sql-tbl-1'");
    assert.equal((await db.query("SELECT is_active FROM shop_tables WHERE id='sql-tbl-1'")).rows[0].is_active, false, 'archiving table auto-deactivates it');
    assert.equal((await db.query("SELECT table_label FROM orders WHERE id='atomic-order'")).rows[0].table_label, 'Bàn 01', 'archiving table preserves historical order table_label');
    await db.query("INSERT INTO shop_tables (id, shop_id, table_code, name, is_active, is_archived) VALUES ('sql-tbl-reused', 'sql-shop', 'T01-NEW', 'Bàn 01', true, false)");
    await commit({
      ...order,
      id: 'atomic-order-reused',
      order_code: 'ATOM-2',
      table_id: 'sql-tbl-reused',
      idempotency_key: 'atomic-create-reused',
      items: [{ item_id: 'sql-item', quantity: 1, unit_price: 10000, extra_price: 0 }],
      total_amount: 10000,
      subtotal_amount: 10000,
    }, 1);
    const settledReused = (
      await db.query("SELECT settle_table_bill_atomic('sql-shop', NULL, 'sql-tbl-reused', 'cash', 'settle-reused-1', NULL, false) AS result")
    ).rows[0].result;
    assert.equal(settledReused.length, 1, 'settle_table_bill_atomic with table_id must only settle that table_id');
    assert.equal((await db.query("SELECT payment_status FROM orders WHERE id='atomic-order'")).rows[0].payment_status, 'unpaid', 'archived table order with same label must remain unpaid');
    assert.equal((await db.query("SELECT payment_status FROM orders WHERE id='atomic-order-reused'")).rows[0].payment_status, 'paid');

    // Verify 008_mobile_push_tokens.sql: server-only reads/writes and restrictive RLS
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);");
    await db.exec(fs.readFileSync('supabase/migrations/008_mobile_push_tokens.sql', 'utf8'));
    await db.exec('SET ROLE service_role');
    await db.query(`INSERT INTO mobile_push_tokens (id, user_id, shop_id, expo_push_token, locale, platform)
      VALUES ('push-1', '${owner}', 'sql-shop', 'ExponentPushToken[ownerToken123]', 'vi', 'ios')`);
    assert.equal((await db.query("SELECT * FROM mobile_push_tokens WHERE shop_id='sql-shop'")).rows.length, 1);

    await assert.rejects(
      db.query(`INSERT INTO mobile_push_tokens (id, user_id, shop_id, expo_push_token)
        VALUES ('push-bad', '${owner}', 'sql-shop', 'invalid-token-format')`),
      /mobile_push_tokens_token_format_check/i
    );

    // Authenticated client cannot read or mutate mobile_push_tokens directly (server-only)
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${owner}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`);
    await assert.rejects(
      db.query("SELECT * FROM mobile_push_tokens"),
      /permission denied/i
    );
    await assert.rejects(
      db.query(`INSERT INTO mobile_push_tokens (id, user_id, shop_id, expo_push_token)
        VALUES ('push-client', '${owner}', 'sql-shop', 'ExponentPushToken[clientToken]')`),
      /permission denied|FORBIDDEN_PUSH_TOKEN_DIRECT_ACCESS/i
    );

    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false); SET ROLE anon`);
    await assert.rejects(
      db.query("SELECT * FROM mobile_push_tokens"),
      /permission denied/i
    );

    // Verify 009_table_service_requests.sql: publication, RLS, server-only mutations, and status transition triggers
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);");
    await db.exec(fs.readFileSync('supabase/migrations/009_table_service_requests.sql', 'utf8'));
    assert.equal(
      (await db.query("SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='table_service_requests'")).rows.length,
      1,
      'table_service_requests publication membership is idempotent'
    );

    await db.exec('SET ROLE service_role');
    await db.query(`INSERT INTO table_service_requests (id, shop_id, table_id, table_code, table_label, request_type, status, visitor_lang)
      VALUES ('srv-sql-1', 'sql-shop', 'sql-tbl-reused', 'SPOOF', 'Spoofed Label', 'request_bill', 'pending', 'vi')`);
    const createdSrv = (await db.query("SELECT * FROM table_service_requests WHERE id='srv-sql-1'")).rows[0];
    assert.equal(createdSrv.table_code, 'T01-NEW', 'trigger snaps canonical table_code from shop_tables');
    assert.equal(createdSrv.table_label, 'Bàn 01', 'trigger snaps canonical table_label from shop_tables');

    // Reject inactive table and cross-shop table in trigger
    await assert.rejects(
      db.query(`INSERT INTO table_service_requests (id, shop_id, table_id, table_code, table_label, request_type)
        VALUES ('srv-inactive', 'sql-shop', 'sql-tbl-inactive', 'T02', 'Bàn 02', 'call_staff')`),
      /INACTIVE_SHOP_TABLE/i
    );
    await assert.rejects(
      db.query(`INSERT INTO table_service_requests (id, shop_id, table_id, table_code, table_label, request_type)
        VALUES ('srv-cross-shop', 'sql-pub-shop', 'sql-tbl-reused', 'T01-NEW', 'Bàn 01', 'call_staff')`),
      /INVALID_TABLE_SHOP/i
    );

    // Authenticated staff with orders.view can SELECT their shop's service requests, but cannot INSERT/UPDATE directly or execute create_table_service_request_atomic
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${staff}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`);
    const staffVisibleSrv = (await db.query("SELECT id, status FROM table_service_requests WHERE shop_id='sql-shop'")).rows;
    assert.equal(staffVisibleSrv.length, 1);
    await assert.rejects(
      db.query("UPDATE table_service_requests SET status='acknowledged' WHERE id='srv-sql-1'"),
      /permission denied|Direct client mutations/i
    );
    await assert.rejects(
      db.query(`SELECT public.create_table_service_request_atomic('{"id":"srv-client-rpc","shop_id":"sql-shop","table_id":"sql-tbl-reused","request_type":"call_staff"}'::jsonb, 60000)`),
      /permission denied|Direct client execution/i
    );

    // Valid status transitions via service_role, atomic RPC deduplication, and rejection of backward transitions
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role");
    const rpcFirst = (await db.query(`SELECT public.create_table_service_request_atomic('{"id":"srv-rpc-1","shop_id":"sql-shop","table_id":"sql-tbl-reused","request_type":"call_staff","visitor_lang":"vi"}'::jsonb, 60000) AS res`)).rows[0].res;
    assert.equal(rpcFirst.deduplicated, false);
    assert.equal(rpcFirst.service_request.id, 'srv-rpc-1');
    assert.equal(rpcFirst.service_request.table_label, 'Bàn 01');
    const rpcDup = (await db.query(`SELECT public.create_table_service_request_atomic('{"id":"srv-rpc-2","shop_id":"sql-shop","table_id":"sql-tbl-reused","request_type":"call_staff","visitor_lang":"vi"}'::jsonb, 60000) AS res`)).rows[0].res;
    assert.equal(rpcDup.deduplicated, true);
    assert.equal(rpcDup.service_request.id, 'srv-rpc-1');
    await db.query(`UPDATE table_service_requests SET status='acknowledged', acknowledged_by='${staff}' WHERE id='srv-sql-1'`);
    await assert.rejects(
      db.query("UPDATE table_service_requests SET status='pending' WHERE id='srv-sql-1'"),
      /INVALID_SERVICE_REQUEST_TRANSITION/i
    );
    await db.query(`UPDATE table_service_requests SET status='resolved', resolved_by='${owner}' WHERE id='srv-sql-1'`);
    await assert.rejects(
      db.query("UPDATE table_service_requests SET status='acknowledged' WHERE id='srv-sql-1'"),
      /INVALID_SERVICE_REQUEST_TRANSITION/i
    );

  } finally { await db.close(); }
});
