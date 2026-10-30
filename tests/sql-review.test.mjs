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
      if (file === '20261030000300_admin_owner_invitation_claims.sql') {
        await db.exec(`INSERT INTO profiles (id, email, zitadel_sub) VALUES
          ('owner-00000000-0000-4000-8000-000000000001', 'legacy-owner@example.test', NULL),
          ('owner-demo-001', 'demo-owner@example.test', NULL),
          ('owner-not-uuid', 'invalid-owner@example.test', NULL);`);
      }
      if (file === '002z_reconcile_legacy_bank_refs.sql') {
        await db.exec(`INSERT INTO profiles (id) VALUES ('legacy-payer');
          INSERT INTO payment_transactions (id,user_id,order_code,target_plan,amount,status,bank_ref_id,created_at)
          VALUES ('legacy-a','legacy-payer','LEGACY-A','basic',100000,'completed','FT2628799999','2026-01-01'),
                 ('legacy-b','legacy-payer','LEGACY-B','basic',200000,'completed','FT2628799999','2026-01-02');`);
        await assert.rejects(db.exec('CREATE UNIQUE INDEX failing_bank_ref_index ON payment_transactions(bank_ref_id) WHERE bank_ref_id IS NOT NULL'), /duplicat|unique/i);
      }
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }
    const pendingOwnerInvitations = (
      await db.query(
        "SELECT id, owner_invite_pending FROM profiles WHERE id IN ('owner-00000000-0000-4000-8000-000000000001', 'owner-demo-001', 'owner-not-uuid') ORDER BY id"
      )
    ).rows;
    assert.deepEqual(
      pendingOwnerInvitations,
      [
        { id: 'owner-00000000-0000-4000-8000-000000000001', owner_invite_pending: true },
        { id: 'owner-demo-001', owner_invite_pending: false },
        { id: 'owner-not-uuid', owner_invite_pending: false },
      ],
      'only the legacy admin owner-UUID format is backfilled as an invitation'
    );
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
    for (const file of migrations.filter((name) => name.startsWith('004_') || name.startsWith('005_') || name.startsWith('007_') || name.startsWith('017_'))) {
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
    await db.exec('SET ROLE service_role');
    const serverCreatedInvitation = await db.query(
      "INSERT INTO profiles (id, email, owner_invite_pending) VALUES ('server-created-invitation', 'server@example.test', TRUE) RETURNING owner_invite_pending"
    );
    assert.equal(
      serverCreatedInvitation.rows[0]?.owner_invite_pending,
      true,
      'trusted service_role must be able to create invitations'
    );
    await db.exec('RESET ROLE');
    for (const user of [staff, cashier]) {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);
        SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${user}"}', false);`);
      assert.equal((await db.query('SELECT id FROM orders')).rows.length, 1, 'member should read assigned orders');
      assert.equal((await db.query("SELECT id FROM shop_tables WHERE shop_id='sql-shop'")).rows.length, 2, 'member should read all shop_tables including inactive');
      await assert.rejects(db.query("SELECT commit_order_with_inventory('{}'::jsonb, '[]'::jsonb)"), /permission denied/i);
      for (const mutation of [
        "UPDATE orders SET total_amount=1 WHERE id='sql-order' RETURNING id",
        "UPDATE orders SET payment_status='paid' WHERE id='sql-order' RETURNING id",
        "UPDATE profiles SET owner_invite_pending=TRUE WHERE id='owner-00000000-0000-4000-8000-000000000001' RETURNING id",
        "INSERT INTO profiles (id, email, owner_invite_pending) VALUES ('client-created-invitation', 'client@example.test', TRUE) RETURNING id",
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

    // Verify 010_shop_order_stats_summary.sql: server-only execution and idempotent re-application
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);");
    await db.exec(fs.readFileSync('supabase/migrations/010_shop_order_stats_summary.sql', 'utf8'));
    await db.exec('SET ROLE service_role');
    const statsRes = (await db.query("SELECT public.get_shop_order_stats_summary('sql-shop') AS res")).rows[0].res;
    assert.equal(typeof statsRes.totalRevenue, 'number');
    assert.equal(Array.isArray(statsRes.dailyRevenue7d), true);
    assert.equal(statsRes.dailyRevenue7d.length, 7);
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${staff}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`);
    await assert.rejects(
      db.query("SELECT public.get_shop_order_stats_summary('sql-shop')"),
      /permission denied|Direct client execution/i
    );

    // Verify 011_sepay_order_reconciliation.sql: private config RLS, theme_config secret guard, idempotent event ledger, and atomic reconciliation RPC
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);");
    await db.exec(fs.readFileSync('supabase/migrations/011_sepay_order_reconciliation.sql', 'utf8'));
    // Verify migration 011 is idempotent when re-applied
    await db.exec(fs.readFileSync('supabase/migrations/011_sepay_order_reconciliation.sql', 'utf8'));
    await db.exec('SET ROLE service_role');

    await db.query(`INSERT INTO shop_sepay_configs (shop_id, enabled, secret_ciphertext, secret_iv, secret_auth_tag, updated_by)
      VALUES ('sql-shop', true, 'cipher-abc', 'iv-123456789012', 'tag-1234567890123456', '${owner}')`);

    // Block storing SePay secrets inside public.shops.theme_config
    await assert.rejects(
      db.query(`UPDATE shops SET theme_config = '{"sepaySecret":"leaked"}'::jsonb WHERE id = 'sql-shop'`),
      /FORBIDDEN_PUBLIC_SEPAY_SECRET/i
    );
    await assert.rejects(
      db.query(`UPDATE shops SET theme_config = '{"paymentConfig":{"webhookSecret":"leaked"}}'::jsonb WHERE id = 'sql-shop'`),
      /FORBIDDEN_PUBLIC_SEPAY_SECRET/i
    );

    // Direct client access (even as shop owner) is blocked on shop_sepay_configs, sepay_webhook_events, and reconcile_sepay_order_payment_atomic
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${owner}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`);
    await assert.rejects(
      db.query("SELECT * FROM shop_sepay_configs WHERE shop_id = 'sql-shop'"),
      /permission denied/i
    );
    await assert.rejects(
      db.query("INSERT INTO shop_sepay_configs (shop_id, enabled, secret_ciphertext, secret_iv, secret_auth_tag) VALUES ('sql-pub-shop', true, 'c', 'i', 't')"),
      /permission denied|FORBIDDEN_SEPAY_CONFIG_DIRECT_ACCESS/i
    );
    await assert.rejects(
      db.query("SELECT * FROM sepay_webhook_events WHERE shop_id = 'sql-shop'"),
      /permission denied/i
    );
    await assert.rejects(
      db.query("SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', 'tx-client', 'hash-1', 'in', 50000)"),
      /permission denied|Direct client execution/i
    );

    // Service role atomic reconciliation preserves fulfillment status and handles replay/conflict/mismatch invariants
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role");
    await db.query(`INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items)
      VALUES ('ord-sepay-1', 'ORD-901', 'sql-shop', 'Bàn 01', 'preparing', 'vietqr', 'unpaid', 85000, 85000, '[]'::jsonb),
             ('ord-sepay-cash', 'ORD-902', 'sql-shop', 'Bàn 02', 'new', 'cash', 'unpaid', 40000, 40000, '[]'::jsonb)`);

    // Wrong amount rejected without marking paid
    const wrongAmtRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9000', 'hash-wrong-amt', 'in', 84000, '0905123456', 'FT-WRONG', 'ORD-901', 'ord-sepay-1', NULL, '{}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(wrongAmtRes.reconciled, false);
    assert.equal(wrongAmtRes.reason_code, 'AMOUNT_MISMATCH');
    const unpaidCheck = (await db.query("SELECT status, payment_status FROM orders WHERE id = 'ord-sepay-1'")).rows[0];
    assert.equal(unpaidCheck.payment_status, 'unpaid');
    assert.equal(unpaidCheck.status, 'preparing');

    // Cash order rejected without marking paid
    const cashRejRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9000-cash', 'hash-cash', 'in', 40000, '0905123456', 'FT-CASH', 'ORD-902', 'ord-sepay-cash', NULL, '{}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(cashRejRes.reconciled, false);
    assert.equal(cashRejRes.reason_code, 'PAYMENT_METHOD_NOT_VIETQR');

    // Exact match reconciles payment while preserving status = 'preparing'
    const okRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9001', 'hash-ok-9001', 'in', 85000, '0905123456', 'FT-9001', 'ORD-901', 'ord-sepay-1', NULL, '{"id":9001}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(okRes.reconciled, true);
    assert.equal(okRes.duplicate, false);
    assert.equal(okRes.reason_code, 'OK');
    assert.equal(okRes.order.payment_status, 'paid');
    assert.equal(okRes.order.status, 'preparing', 'payment reconciliation must never alter fulfillment status');
    assert.equal(okRes.order.payment_idempotency_key, 'sepay:sql-shop:9001');

    // Identical replay returns duplicate=true, reconciled=true without duplicate effects
    const dupRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9001', 'hash-ok-9001', 'in', 85000, '0905123456', 'FT-9001', 'ORD-901', 'ord-sepay-1', NULL, '{"id":9001}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(dupRes.reconciled, true);
    assert.equal(dupRes.duplicate, true);
    assert.equal(dupRes.delivery_count, 2);

    // Conflicting reuse of same sepay_transaction_id with different payload_hash is rejected and recorded
    const conflictRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9001', 'hash-tampered-9001', 'in', 999000, '0905123456', 'FT-9001', 'ORD-901', 'ord-sepay-1', NULL, '{"id":9001,"transferAmount":999000}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(conflictRes.reconciled, false);
    assert.equal(conflictRes.outcome, 'conflict');
    assert.equal(conflictRes.reason_code, 'CONFLICTING_WEBHOOK_EVENT');
    assert.equal(conflictRes.conflict_count, 1);

    // Conflicting reuse of same bank reference_code with a different transaction ID is rejected
    const refConflictRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9002', 'hash-9002', 'in', 85000, '0905123456', 'FT-9001', 'ORD-901', 'ord-sepay-1', NULL, '{"id":9002}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(refConflictRes.reconciled, false);
    assert.equal(refConflictRes.outcome, 'conflict');
    assert.equal(refConflictRes.reason_code, 'CONFLICTING_BANK_REFERENCE');

    // Recoverable rejection: payment arrives before order exists (ORDER_NOT_FOUND), then order is created and identical retry reconciles once
    const earlyRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9003', 'hash-9003', 'in', 115000, '0905123456', 'FT-9003', 'ORD-903', NULL, NULL, '{"id":9003}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(earlyRes.reconciled, false);
    assert.equal(earlyRes.duplicate, false);
    assert.equal(earlyRes.reason_code, 'ORDER_NOT_FOUND');
    assert.equal(earlyRes.delivery_count, 1);

    await db.query(`INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items)
      VALUES ('ord-sepay-late', 'ORD-903', 'sql-shop', 'Bàn 03', 'new', 'vietqr', 'unpaid', 115000, 115000, '[]'::jsonb)`);

    const recoveredRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9003', 'hash-9003', 'in', 115000, '0905123456', 'FT-9003', 'ORD-903', 'ord-sepay-late', NULL, '{"id":9003}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(recoveredRes.reconciled, true);
    assert.equal(recoveredRes.duplicate, false);
    assert.equal(recoveredRes.reason_code, 'OK');
    assert.equal(recoveredRes.delivery_count, 2);
    assert.equal(recoveredRes.order.payment_status, 'paid');

    const postRecoverDupRes = (await db.query(
      `SELECT public.reconcile_sepay_order_payment_atomic('sql-shop', '9003', 'hash-9003', 'in', 115000, '0905123456', 'FT-9003', 'ORD-903', 'ord-sepay-late', NULL, '{"id":9003}'::jsonb) AS res`
    )).rows[0].res;
    assert.equal(postRecoverDupRes.reconciled, true);
    assert.equal(postRecoverDupRes.duplicate, true);
    assert.equal(postRecoverDupRes.delivery_count, 3);

    // The global order_code index blocks the cross-shop collision that previously
    // made SePay reconciliation ambiguous.
    await db.query(`INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items)
      VALUES ('ord-collide-a', 'ORD-COLLIDE-1', 'sql-shop', 'Bàn A', 'new', 'vietqr', 'unpaid', 60000, 60000, '[]'::jsonb)`);
    await assert.rejects(
      db.query(`INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items)
        VALUES ('ord-collide-b', 'ORD-COLLIDE-1', 'sql-pub-shop', 'Bàn B', 'new', 'vietqr', 'unpaid', 60000, 60000, '[]'::jsonb)`),
      /idx_orders_order_code_unique/
    );

    const collideOrders = (await db.query("SELECT id, payment_status FROM orders WHERE id IN ('ord-collide-a', 'ord-collide-b')")).rows;
    assert.deepEqual(collideOrders, [
      { id: 'ord-collide-a', payment_status: 'unpaid' },
    ]);

    // Verify 013_opening_hours_confirmed.sql: NOT NULL DEFAULT FALSE, existing shops default to false, idempotent re-run
    await db.exec('RESET ROLE');
    const colMeta = (
      await db.query(
        "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'opening_hours_confirmed'"
      )
    ).rows[0];
    assert.ok(colMeta, 'shops.opening_hours_confirmed column must exist');
    assert.equal(colMeta.data_type, 'boolean');
    assert.equal(colMeta.is_nullable, 'NO');
    assert.match(String(colMeta.column_default), /false/i);

    const existingShopHoursFlags = (
      await db.query(
        "SELECT id, opening_hours_confirmed FROM shops WHERE id IN ('sql-shop', 'sql-pub-shop') ORDER BY id"
      )
    ).rows;
    assert.deepEqual(existingShopHoursFlags, [
      { id: 'sql-pub-shop', opening_hours_confirmed: false },
      { id: 'sql-shop', opening_hours_confirmed: false },
    ]);

    await db.query(
      "UPDATE shops SET opening_hours_confirmed = TRUE WHERE id = 'sql-shop'"
    );
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/013_opening_hours_confirmed.sql',
        'utf8'
      )
    );
    const afterReapply = (
      await db.query(
        "SELECT opening_hours_confirmed FROM shops WHERE id = 'sql-shop'"
      )
    ).rows[0];
    assert.equal(
      afterReapply.opening_hours_confirmed,
      true,
      'Re-applying migration 013 must be idempotent and preserve confirmed shops'
    );
    await assert.rejects(
      db.query(
        "UPDATE shops SET opening_hours_confirmed = NULL WHERE id = 'sql-shop'"
      ),
      /null value in column "opening_hours_confirmed"|not-null/i
    );

    // Verify 014_shop_slug_aliases.sql: durable aliases, repeated changes, revert, collision prevention, and RLS
    await db.exec(
      fs.readFileSync('supabase/migrations/014_shop_slug_aliases.sql', 'utf8')
    );

    // 1. Changing canonical slug records old slug as alias
    await db.query(
      "UPDATE shops SET slug = '  SQL-PUB-SHOP-V2  ' WHERE id = 'sql-pub-shop'"
    );
    const updatedPubShop = (
      await db.query("SELECT slug FROM shops WHERE id = 'sql-pub-shop'")
    ).rows[0];
    assert.equal(updatedPubShop.slug, 'sql-pub-shop-v2');

    let pubAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases WHERE shop_id = 'sql-pub-shop' ORDER BY slug"
      )
    ).rows;
    assert.deepEqual(pubAliases, [
      { slug: 'sql-pub-shop', shop_id: 'sql-pub-shop' },
    ]);

    // 2. No-op update does not create a self-alias for the active canonical slug
    await db.query(
      "UPDATE shops SET slug = 'SQL-PUB-SHOP-V2' WHERE id = 'sql-pub-shop'"
    );
    pubAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases WHERE shop_id = 'sql-pub-shop' ORDER BY slug"
      )
    ).rows;
    assert.deepEqual(pubAliases, [
      { slug: 'sql-pub-shop', shop_id: 'sql-pub-shop' },
    ]);

    // 3. Repeated slug change keeps all previous slugs as aliases for the same shop
    await db.query(
      "UPDATE shops SET slug = 'sql-pub-shop-v3' WHERE id = 'sql-pub-shop'"
    );
    pubAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases WHERE shop_id = 'sql-pub-shop' ORDER BY slug"
      )
    ).rows;
    assert.deepEqual(pubAliases, [
      { slug: 'sql-pub-shop', shop_id: 'sql-pub-shop' },
      { slug: 'sql-pub-shop-v2', shop_id: 'sql-pub-shop' },
    ]);

    // 4. Cross-shop collision with another shop's canonical slug or reserved alias is rejected
    await assert.rejects(
      db.query(
        "UPDATE shops SET slug = 'sql-pub-shop-v3' WHERE id = 'sql-shop'"
      ),
      /SLUG_ALREADY_EXISTS/i
    );
    await assert.rejects(
      db.query("UPDATE shops SET slug = 'sql-pub-shop' WHERE id = 'sql-shop'"),
      /SLUG_ALREADY_EXISTS/i
    );
    await assert.rejects(
      db.query(
        "INSERT INTO shops (id, owner_id, slug, name, is_published) VALUES ('sql-collide-shop', '00000000-0000-0000-0000-000000000001', 'sql-pub-shop-v2', 'Colliding Shop', true)"
      ),
      /SLUG_ALREADY_EXISTS/i
    );

    // 5. Reverting a shop back to one of its own former aliases succeeds and removes that canonical slug from aliases
    await db.query(
      "UPDATE shops SET slug = 'sql-pub-shop' WHERE id = 'sql-pub-shop'"
    );
    pubAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases WHERE shop_id = 'sql-pub-shop' ORDER BY slug"
      )
    ).rows;
    assert.deepEqual(pubAliases, [
      { slug: 'sql-pub-shop-v2', shop_id: 'sql-pub-shop' },
      { slug: 'sql-pub-shop-v3', shop_id: 'sql-pub-shop' },
    ]);

    // 6. Unpublished shop alias visibility & direct client write boundaries
    await db.query(
      "UPDATE shops SET slug = 'sql-shop-v2' WHERE id = 'sql-shop'"
    );
    await db.exec(
      "SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); SET ROLE anon"
    );
    const anonVisibleAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases ORDER BY slug"
      )
    ).rows;
    assert.deepEqual(
      anonVisibleAliases,
      [
        { slug: 'sql-pub-shop-v2', shop_id: 'sql-pub-shop' },
        { slug: 'sql-pub-shop-v3', shop_id: 'sql-pub-shop' },
      ],
      'anon must only see aliases for published shops and never see unpublished shop aliases'
    );
    await assert.rejects(
      db.query(
        "INSERT INTO shop_slug_aliases (slug, shop_id) VALUES ('hijack-alias', 'sql-pub-shop')"
      ),
      /permission denied|row-level security|FORBIDDEN_SHOP_SLUG_ALIAS_MUTATION/i
    );

    // Authorized member of unpublished sql-shop can read its alias
    await db.exec(
      `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${staff}', false); SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${staff}"}', false);`
    );
    const staffVisibleUnpubAliases = (
      await db.query(
        "SELECT slug, shop_id FROM shop_slug_aliases WHERE shop_id = 'sql-shop'"
      )
    ).rows;
    assert.deepEqual(staffVisibleUnpubAliases, [
      { slug: 'sql-shop', shop_id: 'sql-shop' },
    ]);
    await db.exec('RESET ROLE');

    // Verify 015_atomic_payment_completion.sql: atomic execution, rollback, idempotency, invariants & grants
    const saasUser = '00000000-0000-0000-0000-000000000099';
    await db.query(
      `INSERT INTO profiles (id, email, plan) VALUES ('${saasUser}', 'saas-owner@example.com', 'free')`
    );

    // 1. Direct client call (anon / authenticated) is strictly blocked
    await db.exec(
      `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${saasUser}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`
    );
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('ORDER-CLIENT-DIRECT', 'FT-CLIENT-1', 69000)"
      ),
      /permission denied/i
    );

    await db.exec(
      "RESET ROLE; SET ROLE anon; SELECT set_config('request.jwt.claim.role', 'anon', false);"
    );
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('ORDER-CLIENT-DIRECT', 'FT-CLIENT-1', 69000)"
      ),
      /permission denied/i
    );

    // Switch to service_role for backend server tests
    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    // 2. Validate input and unknown order
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('NON_EXISTENT_ORDER_CODE_99999', 'FT-TEST', 69000)"
      ),
      /PAYMENT_ORDER_NOT_FOUND/i
    );

    // Create fixture pending order
    await db.exec('RESET ROLE');
    await db.query(`
      INSERT INTO payment_transactions (id, user_id, order_code, target_plan, amount, status)
      VALUES ('tx-atomic-test-1', '${saasUser}', 'QLAOKP_ATOMIC_1', 'premium', 69000, 'pending')
    `);
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    // 3. Underpayment is rejected and status remains pending
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', 'FT-UNDERPAY', 50000)"
      ),
      /PAYMENT_AMOUNT_MISMATCH/i
    );
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', 'FT-UNDERPAY', 0)"
      ),
      /PAYMENT_AMOUNT_MISMATCH/i
    );
    const txAfterUnderpay = (
      await db.query(
        "SELECT status, bank_ref_id FROM payment_transactions WHERE id = 'tx-atomic-test-1'"
      )
    ).rows[0];
    assert.equal(txAfterUnderpay.status, 'pending');
    assert.equal(txAfterUnderpay.bank_ref_id, null);

    // Empty bank reference is rejected
    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', '   ', 69000)"
      ),
      /MISSING_BANK_REF/i
    );

    // 4. Atomic rollback: Inject a failing profile trigger and prove payment_transactions stays pending
    await db.exec('RESET ROLE');
    await db.exec(`
      CREATE OR REPLACE FUNCTION trg_test_injected_profile_failure()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'INJECTED_PROFILE_FAILURE';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_test_injected_profile_fail
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION trg_test_injected_profile_failure();
    `);
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', 'FT-ATOMIC-1', 69000)"
      ),
      /INJECTED_PROFILE_FAILURE/i
    );

    // Verify transaction row was NOT updated to completed (rolled back!)
    const txAfterRollback = (
      await db.query(
        "SELECT status, bank_ref_id, completed_at FROM payment_transactions WHERE id = 'tx-atomic-test-1'"
      )
    ).rows[0];
    assert.equal(
      txAfterRollback.status,
      'pending',
      'payment_transactions must stay pending when profile update rolls back'
    );
    assert.equal(txAfterRollback.bank_ref_id, null);
    assert.equal(txAfterRollback.completed_at, null);

    // Verify profile was NOT upgraded
    const profileAfterRollback = (
      await db.query(
        `SELECT plan, plan_expires_at FROM profiles WHERE id = '${saasUser}'`
      )
    ).rows[0];
    assert.equal(
      profileAfterRollback.plan,
      'free',
      'profile plan must stay free when trigger rolls back'
    );
    assert.equal(profileAfterRollback.plan_expires_at, null);

    // Remove simulated failing trigger
    await db.exec('RESET ROLE');
    await db.exec('DROP TRIGGER trg_test_injected_profile_fail ON public.profiles;');
    await db.exec('DROP FUNCTION trg_test_injected_profile_failure();');
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    // 5. Successful atomic completion: updates both payment_transactions and profiles
    const completeResRaw = (
      await db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', 'FT-ATOMIC-1', 69000) AS res"
      )
    ).rows[0].res;
    const completeRes =
      typeof completeResRaw === 'string'
        ? JSON.parse(completeResRaw)
        : completeResRaw;
    assert.equal(completeRes.status, 'completed');
    assert.equal(completeRes.owner_id, saasUser);
    assert.equal(completeRes.target_plan, 'premium');
    assert.ok(completeRes.plan_expires_at);

    const txAfterSuccess = (
      await db.query(
        "SELECT status, bank_ref_id, completed_at FROM payment_transactions WHERE id = 'tx-atomic-test-1'"
      )
    ).rows[0];
    assert.equal(txAfterSuccess.status, 'completed');
    assert.equal(txAfterSuccess.bank_ref_id, 'FT-ATOMIC-1');
    assert.ok(txAfterSuccess.completed_at);

    const profileAfterSuccess = (
      await db.query(
        `SELECT plan, plan_expires_at FROM profiles WHERE id = '${saasUser}'`
      )
    ).rows[0];
    assert.equal(profileAfterSuccess.plan, 'premium');
    assert.ok(profileAfterSuccess.plan_expires_at);
    const firstExpiresAt = profileAfterSuccess.plan_expires_at;

    // 6. Idempotent retry: returns status already_completed, does NOT re-extend plan_expires_at
    const retryResRaw = (
      await db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_1', 'FT-ATOMIC-1', 69000) AS res"
      )
    ).rows[0].res;
    const retryRes =
      typeof retryResRaw === 'string' ? JSON.parse(retryResRaw) : retryResRaw;
    assert.equal(retryRes.status, 'already_completed');
    assert.equal(retryRes.owner_id, saasUser);

    const profileAfterRetry = (
      await db.query(
        `SELECT plan, plan_expires_at FROM profiles WHERE id = '${saasUser}'`
      )
    ).rows[0];
    assert.equal(profileAfterRetry.plan, 'premium');
    assert.equal(
      new Date(profileAfterRetry.plan_expires_at).toISOString(),
      new Date(firstExpiresAt).toISOString(),
      'retry must not extend plan_expires_at'
    );

    // 7. Duplicate bank reference is rejected with DUPLICATE_BANK_REF
    await db.exec('RESET ROLE');
    await db.query(`
      INSERT INTO payment_transactions (id, user_id, order_code, target_plan, amount, status)
      VALUES ('tx-atomic-test-2', '${saasUser}', 'QLAOKP_ATOMIC_2', 'basic', 39000, 'pending')
    `);
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_2', 'FT-ATOMIC-1', 39000)"
      ),
      /DUPLICATE_BANK_REF/i
    );
    const tx2AfterDup = (
      await db.query(
        "SELECT status, bank_ref_id FROM payment_transactions WHERE id = 'tx-atomic-test-2'"
      )
    ).rows[0];
    assert.equal(tx2AfterDup.status, 'pending');
    assert.equal(tx2AfterDup.bank_ref_id, null);

    // 8. Non-pending status (e.g. cancelled) is rejected with PAYMENT_ORDER_NOT_PENDING
    await db.exec('RESET ROLE');
    await db.query(
      "UPDATE payment_transactions SET status = 'cancelled' WHERE id = 'tx-atomic-test-2'"
    );
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    await assert.rejects(
      db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_2', 'FT-ATOMIC-2', 39000)"
      ),
      /PAYMENT_ORDER_NOT_PENDING/i
    );

    // 9. p_allow_unverified_amount=true allows dev simulator to complete without transfer amount check
    await db.exec('RESET ROLE');
    await db.query(`
      INSERT INTO payment_transactions (id, user_id, order_code, target_plan, amount, status)
      VALUES ('tx-atomic-test-3', '${saasUser}', 'QLAOKP_ATOMIC_3', 'basic', 39000, 'pending')
    `);
    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    const devResRaw = (
      await db.query(
        "SELECT public.complete_payment_webhook_atomic('QLAOKP_ATOMIC_3', 'FT-DEV-SIM-3', NULL, true) AS res"
      )
    ).rows[0].res;
    const devRes =
      typeof devResRaw === 'string' ? JSON.parse(devResRaw) : devResRaw;
    assert.equal(devRes.status, 'completed');
    assert.equal(devRes.target_plan, 'basic');

    await db.exec('RESET ROLE');

    // Verify 016_order_workflow_and_label_printing.sql: additive columns, nonnegative counter check constraint, idempotency, and preserved order/payment invariants
    const idx015 = migrations.indexOf('015_atomic_payment_completion.sql');
    const idx016 = migrations.indexOf(
      '016_order_workflow_and_label_printing.sql'
    );
    assert.ok(idx015 >= 0, '015_atomic_payment_completion.sql must exist');
    assert.ok(
      idx016 > idx015,
      '016_order_workflow_and_label_printing.sql must sort after 015_atomic_payment_completion.sql'
    );

    const orderWorkflowColMeta = (
      await db.query(
        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name IN ('workflow_step_id', 'label_printed_count') ORDER BY column_name"
      )
    ).rows;
    assert.equal(orderWorkflowColMeta.length, 2);
    assert.equal(orderWorkflowColMeta[0].column_name, 'label_printed_count');
    assert.equal(orderWorkflowColMeta[0].data_type, 'integer');
    assert.equal(orderWorkflowColMeta[0].is_nullable, 'NO');
    assert.match(String(orderWorkflowColMeta[0].column_default), /^0\b/);
    assert.equal(orderWorkflowColMeta[1].column_name, 'workflow_step_id');
    assert.equal(orderWorkflowColMeta[1].data_type, 'text');
    assert.equal(orderWorkflowColMeta[1].is_nullable, 'YES');

    // Existing rows remain valid with workflow_step_id = NULL and label_printed_count = 0
    const existingOrder016 = (
      await db.query(
        "SELECT id, status, payment_status, workflow_step_id, label_printed_count FROM orders WHERE id = 'ord-sepay-1'"
      )
    ).rows[0];
    assert.equal(existingOrder016.workflow_step_id, null);
    assert.equal(existingOrder016.label_printed_count, 0);

    // Updating workflow_step_id and label_printed_count works on paid and unpaid orders without altering payment_status
    await db.query(
      "UPDATE orders SET workflow_step_id = 'bar_making', label_printed_count = 3 WHERE id = 'ord-sepay-1'"
    );
    const updatedOrder016 = (
      await db.query(
        "SELECT status, payment_status, workflow_step_id, label_printed_count FROM orders WHERE id = 'ord-sepay-1'"
      )
    ).rows[0];
    assert.equal(updatedOrder016.workflow_step_id, 'bar_making');
    assert.equal(updatedOrder016.label_printed_count, 3);
    assert.equal(updatedOrder016.payment_status, 'paid');
    assert.equal(updatedOrder016.status, 'preparing');

    // Negative label_printed_count and NULL label_printed_count are rejected
    await assert.rejects(
      db.query(
        "UPDATE orders SET label_printed_count = -1 WHERE id = 'ord-sepay-1'"
      ),
      /orders_label_printed_count_check|check constraint/i
    );
    await assert.rejects(
      db.query(
        "INSERT INTO orders (id, order_code, shop_id, table_label, status, payment_method, payment_status, subtotal_amount, total_amount, items, label_printed_count) VALUES ('ord-neg-label', 'ORD-NEG-1', 'sql-shop', 'Bàn 01', 'new', 'cash', 'unpaid', 10000, 10000, '[]'::jsonb, -5)"
      ),
      /orders_label_printed_count_check|check constraint/i
    );
    await assert.rejects(
      db.query(
        "UPDATE orders SET label_printed_count = NULL WHERE id = 'ord-sepay-1'"
      ),
      /null value in column "label_printed_count"|not-null/i
    );

    // Re-applying 016_order_workflow_and_label_printing.sql is idempotent and preserves existing values
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/016_order_workflow_and_label_printing.sql',
        'utf8'
      )
    );
    const afterReapply016 = (
      await db.query(
        "SELECT workflow_step_id, label_printed_count FROM orders WHERE id = 'ord-sepay-1'"
      )
    ).rows[0];
    assert.equal(afterReapply016.workflow_step_id, 'bar_making');
    assert.equal(afterReapply016.label_printed_count, 3);

    // =========================================================================
    // Migration 017: Order Workflow Step & Label Print Counter RPC Support
    // =========================================================================
    const idx017 = migrations.indexOf('017_order_workflow_rpc.sql');
    assert.ok(
      idx017 > idx016,
      '017_order_workflow_rpc.sql must sort after 016_order_workflow_and_label_printing.sql'
    );

    // Ensure anon and authenticated cannot execute commit_order_with_inventory or update_order_with_inventory directly
    await db.exec('SET ROLE anon');
    await assert.rejects(
      db.query(
        "SELECT public.commit_order_with_inventory('{\"id\":\"ord-anon-1\",\"order_code\":\"ORD-ANON\",\"shop_id\":\"sql-shop\"}'::jsonb, '[]'::jsonb)"
      ),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        "SELECT public.update_order_with_inventory('ord-sepay-1', '{\"status\":\"completed\"}'::jsonb, '[]'::jsonb, '{}'::jsonb)"
      ),
      /permission denied/i
    );

    await db.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(
      db.query(
        "SELECT public.commit_order_with_inventory('{\"id\":\"ord-auth-1\",\"order_code\":\"ORD-AUTH\",\"shop_id\":\"sql-shop\"}'::jsonb, '[]'::jsonb)"
      ),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        "SELECT public.update_order_with_inventory('ord-sepay-1', '{\"status\":\"completed\"}'::jsonb, '[]'::jsonb, '{}'::jsonb)"
      ),
      /permission denied/i
    );

    // service_role can execute both RPCs and round-trip workflow_step_id and label_printed_count
    await db.exec('RESET ROLE; SET ROLE service_role');
    await db.query(
      `SELECT public.commit_order_with_inventory($1::jsonb, '[]'::jsonb)`,
      [
        JSON.stringify({
          id: 'ord-rpc-wf-1',
          order_code: 'ORD-RPC-WF1',
          shop_id: 'sql-shop',
          table_label: 'Tại quầy',
          status: 'new',
          workflow_step_id: 'counter_received',
          payment_method: 'cash',
          payment_status: 'unpaid',
          subtotal_amount: 45000,
          discount_amount: 0,
          total_amount: 45000,
          items: [],
          print_count: 1,
          kitchen_printed_count: 0,
          provisional_printed_count: 0,
          receipt_printed_count: 0,
          label_printed_count: 1,
        }),
      ]
    );

    const committedWfRow = (
      await db.query(
        "SELECT id, status, workflow_step_id, payment_status, print_count, label_printed_count, kitchen_printed_count FROM orders WHERE id = 'ord-rpc-wf-1'"
      )
    ).rows[0];
    assert.equal(committedWfRow.status, 'new');
    assert.equal(committedWfRow.workflow_step_id, 'counter_received');
    assert.equal(committedWfRow.payment_status, 'unpaid');
    assert.equal(committedWfRow.print_count, 1);
    assert.equal(committedWfRow.label_printed_count, 1);
    assert.equal(committedWfRow.kitchen_printed_count, 0);

    // Advance workflow_step_id and label_printed_count via update_order_with_inventory without changing payment_status
    await db.query(
      `SELECT public.update_order_with_inventory('ord-rpc-wf-1', $1::jsonb, '[]'::jsonb, $2::jsonb)`,
      [
        JSON.stringify({
          status: 'preparing',
          workflow_step_id: 'bar_making',
          payment_status: 'unpaid',
          print_count: 2,
          label_printed_count: 2,
        }),
        JSON.stringify({ expected_bill_version: 1 }),
      ]
    );
    const updatedWfRow = (
      await db.query(
        "SELECT status, workflow_step_id, payment_status, print_count, label_printed_count FROM orders WHERE id = 'ord-rpc-wf-1'"
      )
    ).rows[0];
    assert.equal(updatedWfRow.status, 'preparing');
    assert.equal(updatedWfRow.workflow_step_id, 'bar_making');
    assert.equal(updatedWfRow.payment_status, 'unpaid');
    assert.equal(updatedWfRow.print_count, 2);
    assert.equal(updatedWfRow.label_printed_count, 2);

    // Partial update omitting workflow_step_id and label_printed_count preserves existing values
    await db.query(
      `SELECT public.update_order_with_inventory('ord-rpc-wf-1', $1::jsonb, '[]'::jsonb, '{}'::jsonb)`,
      [JSON.stringify({ customer_note: 'Ít đá' })]
    );
    const preservedWfRow = (
      await db.query(
        "SELECT customer_note, status, workflow_step_id, label_printed_count FROM orders WHERE id = 'ord-rpc-wf-1'"
      )
    ).rows[0];
    assert.equal(preservedWfRow.customer_note, 'Ít đá');
    assert.equal(preservedWfRow.status, 'preparing');
    assert.equal(preservedWfRow.workflow_step_id, 'bar_making');
    assert.equal(preservedWfRow.label_printed_count, 2);

    // Legacy commit payload omitting workflow_step_id and label_printed_count defaults cleanly
    await db.query(
      `SELECT public.commit_order_with_inventory($1::jsonb, '[]'::jsonb)`,
      [
        JSON.stringify({
          id: 'ord-rpc-legacy-1',
          order_code: 'ORD-RPC-LEG1',
          shop_id: 'sql-shop',
          table_label: 'Bàn 02',
          status: 'new',
          payment_method: 'cash',
          payment_status: 'unpaid',
          subtotal_amount: 30000,
          total_amount: 30000,
          items: [],
        }),
      ]
    );
    const legacyWfRow = (
      await db.query(
        "SELECT workflow_step_id, label_printed_count, print_count FROM orders WHERE id = 'ord-rpc-legacy-1'"
      )
    ).rows[0];
    assert.equal(legacyWfRow.workflow_step_id, null);
    assert.equal(legacyWfRow.label_printed_count, 0);
    assert.equal(legacyWfRow.print_count, 0);

    // =========================================================================
    // Migration 018: Shop-Scoped Staff Accounts (No-Email Login & RLS)
    // =========================================================================
    await db.exec('RESET ROLE');
    const idx018 = migrations.indexOf('018_shop_staff_accounts.sql');
    assert.ok(
      idx018 > idx017,
      '018_shop_staff_accounts.sql must sort after 017_order_workflow_rpc.sql'
    );

    // Re-apply 018_shop_staff_accounts.sql to verify idempotency and restore strict table REVOKE after test harness GRANT ALL
    await db.exec(
      fs.readFileSync('supabase/migrations/018_shop_staff_accounts.sql', 'utf8')
    );

    await db.exec(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role"
    );

    const sampleScryptHash =
      'scrypt$0123456789abcdef0123456789abcdef$' + 'a'.repeat(128);

    // 1. Insert staff credential + membership in sql-shop (normalizes username to lowercase)
    await db.query(
      `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, full_name, role, is_active, session_version, created_by)
       VALUES ('staff-acct-sql-0001', 'sql-shop', '  ThuNgan_01  ', $1, 'Thu Ngân Ca Sáng', 'cashier', true, 1, $2)`,
      [sampleScryptHash, owner]
    );
    await db.query(
      `INSERT INTO shop_memberships (id, shop_id, user_id, username, full_name, role, permissions, is_active)
       VALUES ('mem-staff-sql-0001', 'sql-shop', 'staff-acct-sql-0001', '  ThuNgan_01  ', 'Thu Ngân Ca Sáng', 'cashier', '["orders.view","payment.collect"]'::jsonb, true)`
    );

    const savedCred1 = (
      await db.query(
        "SELECT user_id, shop_id, username, role, session_version FROM shop_staff_credentials WHERE user_id = 'staff-acct-sql-0001'"
      )
    ).rows[0];
    assert.equal(savedCred1.username, 'thungan_01');
    assert.equal(savedCred1.role, 'cashier');
    assert.equal(savedCred1.session_version, 1);

    // 2. Duplicate username in the SAME shop fails on both shop_staff_credentials and shop_memberships
    await assert.rejects(
      db.query(
        `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, role)
         VALUES ('staff-acct-sql-dup1', 'sql-shop', 'THUNGAN_01', $1, 'staff')`,
        [sampleScryptHash]
      ),
      /duplicate|unique/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_memberships (id, shop_id, user_id, username, role, permissions)
         VALUES ('mem-staff-sql-dup1', 'sql-shop', 'staff-acct-sql-dup1', 'thungan_01', 'staff', '["orders.view"]'::jsonb)`
      ),
      /duplicate|unique/i
    );

    // 3. Same username in a DIFFERENT shop succeeds
    await db.query(
      `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, full_name, role, is_active)
       VALUES ('staff-acct-sql-0002', 'sql-pub-shop', 'thungan_01', $1, 'Thu Ngân Quán 2', 'staff', true)`,
      [sampleScryptHash]
    );
    await db.query(
      `INSERT INTO shop_memberships (id, shop_id, user_id, username, full_name, role, permissions, is_active)
       VALUES ('mem-staff-sql-0002', 'sql-pub-shop', 'staff-acct-sql-0002', 'thungan_01', 'Thu Ngân Quán 2', 'staff', '["orders.view"]'::jsonb, true)`
    );

    // 4. Reject owner role, members.manage permission, cross-shop reuse of staff-acct-* user_id, plaintext password hash, and staff owning a shop
    await assert.rejects(
      db.query(
        `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, role)
         VALUES ('staff-acct-sql-badrole', 'sql-shop', 'bad_owner', $1, 'owner')`,
        [sampleScryptHash]
      ),
      /FORBIDDEN_STAFF_OWNER_ROLE|check constraint/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, role)
         VALUES ('staff-acct-sql-badhash', 'sql-shop', 'bad_hash', 'plaintext123', 'staff')`
      ),
      /INVALID_STAFF_PASSWORD_HASH|check constraint/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_memberships (id, shop_id, user_id, username, role, permissions)
         VALUES ('mem-staff-bad-owner', 'sql-shop', 'staff-acct-sql-badowner', 'bad_owner', 'owner', '["orders.view"]'::jsonb)`
      ),
      /FORBIDDEN_STAFF_OWNER_ROLE|check constraint/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_memberships (id, shop_id, user_id, username, role, permissions)
         VALUES ('mem-staff-bad-perm', 'sql-shop', 'staff-acct-sql-badperm', 'bad_perm', 'staff', '["orders.view","members.manage"]'::jsonb)`
      ),
      /FORBIDDEN_STAFF_MEMBER_MANAGE_PERMISSION/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_memberships (id, shop_id, user_id, username, role, permissions)
         VALUES ('mem-staff-cross-shop', 'sql-pub-shop', 'staff-acct-sql-0001', 'cross_shop_user', 'staff', '["orders.view"]'::jsonb)`
      ),
      /FORBIDDEN_CROSS_SHOP_STAFF_MEMBERSHIP|duplicate|unique/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shops (id, owner_id, slug, name)
         VALUES ('staff-owned-shop', 'staff-acct-sql-0001', 'staff-owned-shop', 'Illegal Staff Shop')`
      ),
      /shops_owner_not_staff_account_check|check constraint/i
    );

    // 5. Table service requests accept staff-acct-* actor IDs without public.profiles rows and preserve them after staff deletion
    await db.query(
      `INSERT INTO table_service_requests (id, shop_id, table_id, table_code, table_label, request_type, status, visitor_lang)
       VALUES ('srv-staff-acct-1', 'sql-shop', 'sql-tbl-reused', 'T01-NEW', 'Bàn 01', 'call_staff', 'pending', 'vi')`
    );
    await db.query(
      `UPDATE table_service_requests
       SET status = 'acknowledged', acknowledged_by = 'staff-acct-sql-0001'
       WHERE id = 'srv-staff-acct-1'`
    );
    await db.query(
      `UPDATE table_service_requests
       SET status = 'resolved', resolved_by = 'staff-acct-sql-0001'
       WHERE id = 'srv-staff-acct-1'`
    );
    await db.query(
      `DELETE FROM shop_staff_credentials WHERE user_id = 'staff-acct-sql-0002'`
    );
    await db.query(
      `DELETE FROM shop_memberships WHERE user_id = 'staff-acct-sql-0002'`
    );
    const srvAfterStaffOps = (
      await db.query(
        "SELECT acknowledged_by, resolved_by FROM table_service_requests WHERE id = 'srv-staff-acct-1'"
      )
    ).rows[0];
    assert.equal(srvAfterStaffOps.acknowledged_by, 'staff-acct-sql-0001');
    assert.equal(srvAfterStaffOps.resolved_by, 'staff-acct-sql-0001');

    // 6. Atomic multi-row staff account RPCs & transactional rollback on failure
    const atomicCreatedRes = await db.query(
      `SELECT public.create_shop_staff_account_atomic(
        'staff-acct-rpc-0001',
        'sql-shop',
        '  Barista_RPC_01  ',
        $1,
        'Barista Nguyên Tử',
        'staff',
        '["orders.view","orders.fulfill"]'::jsonb,
        true,
        $2,
        'mem-staff-acct-rpc-0001'
      ) AS membership`,
      [sampleScryptHash, owner]
    );
    const atomicCreatedMem = atomicCreatedRes.rows[0].membership;
    assert.equal(atomicCreatedMem.user_id, 'staff-acct-rpc-0001');
    assert.equal(atomicCreatedMem.username, 'barista_rpc_01');
    assert.equal(atomicCreatedMem.role, 'staff');
    assert.equal(atomicCreatedMem.is_active, true);

    // Failed atomic create (invalid permission on membership step) rolls back credential insert completely
    await assert.rejects(
      db.query(
        `SELECT public.create_shop_staff_account_atomic(
          'staff-acct-rpc-rollback-1',
          'sql-shop',
          'rollback_user_01',
          $1,
          'Rollback User',
          'staff',
          '["orders.view","members.manage"]'::jsonb,
          true,
          $2,
          'mem-staff-acct-rpc-rollback-1'
        )`,
        [sampleScryptHash, owner]
      ),
      /FORBIDDEN_STAFF_MEMBER_MANAGE_PERMISSION/i
    );
    const rolledBackCredRows = (
      await db.query(
        "SELECT * FROM shop_staff_credentials WHERE user_id = 'staff-acct-rpc-rollback-1'"
      )
    ).rows;
    const rolledBackMemRows = (
      await db.query(
        "SELECT * FROM shop_memberships WHERE user_id = 'staff-acct-rpc-rollback-1'"
      )
    ).rows;
    assert.equal(rolledBackCredRows.length, 0, 'atomic create failure must roll back credential insert');
    assert.equal(rolledBackMemRows.length, 0, 'atomic create failure must not leave membership row');

    // Failed atomic update (illegal permission on membership step) rolls back credential update completely
    await assert.rejects(
      db.query(
        `SELECT public.update_shop_staff_account_atomic(
          'sql-shop',
          'staff-acct-rpc-0001',
          'renamed_should_rollback',
          'Renamed Rollback',
          'cashier',
          '["orders.view","unknown.permission.key"]'::jsonb,
          false
        )`
      ),
      /INVALID_PERMISSION/i
    );
    const credAfterFailedUpdate = (
      await db.query(
        "SELECT username, full_name, role, is_active, session_version FROM shop_staff_credentials WHERE user_id = 'staff-acct-rpc-0001'"
      )
    ).rows[0];
    assert.equal(credAfterFailedUpdate.username, 'barista_rpc_01');
    assert.equal(credAfterFailedUpdate.role, 'staff');
    assert.equal(credAfterFailedUpdate.is_active, true);
    assert.equal(credAfterFailedUpdate.session_version, 1);

    // Valid atomic update updates both tables and bumps session_version on role change
    const atomicUpdatedRes = await db.query(
      `SELECT public.update_shop_staff_account_atomic(
        'sql-shop',
        'staff-acct-rpc-0001',
        'barista_rpc_01',
        'Barista Thu Ngân',
        'cashier',
        '["orders.view","payment.collect"]'::jsonb,
        true
      ) AS membership`
    );
    assert.equal(atomicUpdatedRes.rows[0].membership.role, 'cashier');
    const credAfterValidUpdate = (
      await db.query(
        "SELECT role, session_version FROM shop_staff_credentials WHERE user_id = 'staff-acct-rpc-0001'"
      )
    ).rows[0];
    assert.equal(credAfterValidUpdate.role, 'cashier');
    assert.equal(credAfterValidUpdate.session_version, 2);

    // Atomic password reset updates credential hash, bumps session_version, and clears login rate limit bucket
    const sampleBucketKey = 'rl-staff-' + 'b'.repeat(64);
    await db.query(
      `SELECT public.record_staff_login_failure_atomic($1, '2026-10-24T10:00:00Z'::timestamptz, 5, 900, 900, 86400)`,
      [sampleBucketKey]
    );
    const resetAtomicRes = (
      await db.query(
        `SELECT public.reset_shop_staff_password_atomic(
          'sql-shop',
          'staff-acct-rpc-0001',
          $1,
          $2
        ) AS result`,
        [
          'scrypt$fedcba9876543210fedcba9876543210$' + 'c'.repeat(128),
          sampleBucketKey,
        ]
      )
    ).rows[0].result;
    assert.equal(resetAtomicRes.session_version, 3);
    const bucketAfterReset = (
      await db.query(
        'SELECT * FROM staff_login_rate_limits WHERE bucket_key = $1',
        [sampleBucketKey]
      )
    ).rows;
    assert.equal(bucketAfterReset.length, 0, 'password reset RPC clears rate-limit bucket');

    // Atomic delete removes both credential and membership rows
    const deleteAtomicRes = (
      await db.query(
        `SELECT public.delete_shop_staff_account_atomic('sql-shop', 'staff-acct-rpc-0001', NULL) AS result`
      )
    ).rows[0].result;
    assert.equal(deleteAtomicRes.deleted, true);
    assert.equal(
      (
        await db.query(
          "SELECT * FROM shop_staff_credentials WHERE user_id = 'staff-acct-rpc-0001'"
        )
      ).rows.length,
      0
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM shop_memberships WHERE user_id = 'staff-acct-rpc-0001'"
        )
      ).rows.length,
      0
    );

    // 7. Staff login rate limiter RPCs: windowing, temporary cooldown, recovery, and retention cleanup
    const rlKey = 'rl-staff-' + 'a'.repeat(64);
    await assert.rejects(
      db.query(
        `INSERT INTO staff_login_rate_limits (bucket_key, failure_count) VALUES ('192.168.1.1:raw-ip-forbidden', 1)`
      ),
      /INVALID_STAFF_RATE_LIMIT_BUCKET_KEY|check constraint/i
    );

    for (let i = 1; i <= 5; i += 1) {
      const rec = (
        await db.query(
          `SELECT public.record_staff_login_failure_atomic($1, '2026-10-24T12:00:00Z'::timestamptz, 5, 900, 900, 86400) AS r`,
          [rlKey]
        )
      ).rows[0].r;
      assert.equal(rec.failure_count, i);
      assert.equal(rec.allowed, true);
      assert.equal(rec.newly_blocked, i === 5);
    }

    // During active 15-minute cooldown, check returns allowed = false
    const checkBlocked = (
      await db.query(
        `SELECT public.check_staff_login_rate_limit_atomic($1, '2026-10-24T12:05:00Z'::timestamptz, 900) AS r`,
        [rlKey]
      )
    ).rows[0].r;
    assert.equal(checkBlocked.allowed, false);
    assert.equal(checkBlocked.retry_after_sec, 600);

    // After 15-minute cooldown expires (no permanent lockout), check resets and allows login
    const checkRecovered = (
      await db.query(
        `SELECT public.check_staff_login_rate_limit_atomic($1, '2026-10-24T12:15:01Z'::timestamptz, 900) AS r`,
        [rlKey]
      )
    ).rows[0].r;
    assert.equal(checkRecovered.allowed, true);
    assert.equal(checkRecovered.failure_count, 0);

    // Expired retention rows are cleaned up by cleanup_expired_staff_login_rate_limits
    const staleKey = 'rl-staff-' + 'd'.repeat(64);
    await db.query(
      `SELECT public.record_staff_login_failure_atomic($1, '2026-10-20T00:00:00Z'::timestamptz, 5, 900, 900, 3600)`,
      [staleKey]
    );
    const cleanedCount = (
      await db.query(
        `SELECT public.cleanup_expired_staff_login_rate_limits('2026-10-24T12:00:00Z'::timestamptz, 100) AS count`
      )
    ).rows[0].count;
    assert.equal(cleanedCount, 1);

    // 8. Strict RLS & privilege boundaries on shop_staff_credentials, staff_login_rate_limits, and atomic RPCs
    await db.exec(
      `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${owner}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated`
    );
    await assert.rejects(
      db.query("SELECT * FROM shop_staff_credentials WHERE shop_id = 'sql-shop'"),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        `INSERT INTO shop_staff_credentials (user_id, shop_id, username, password_hash, role)
         VALUES ('staff-acct-client-hijack', 'sql-shop', 'hijack_staff', '${sampleScryptHash}', 'staff')`
      ),
      /permission denied|FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS/i
    );
    await assert.rejects(
      db.query('SELECT * FROM staff_login_rate_limits'),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        `SELECT public.check_staff_login_rate_limit_atomic('${rlKey}', NOW(), 900)`
      ),
      /permission denied|FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS/i
    );
    await assert.rejects(
      db.query(
        `SELECT public.create_shop_staff_account_atomic('staff-acct-client-rpc', 'sql-shop', 'client_rpc', '${sampleScryptHash}', 'Client', 'staff', '["orders.view"]'::jsonb, true, null, null)`
      ),
      /permission denied|FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS/i
    );

    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', 'anon', false); SET ROLE anon"
    );
    await assert.rejects(
      db.query('SELECT * FROM shop_staff_credentials'),
      /permission denied/i
    );
    await assert.rejects(
      db.query('SELECT * FROM staff_login_rate_limits'),
      /permission denied/i
    );
    await assert.rejects(
      db.query(
        `SELECT public.record_staff_login_failure_atomic('${rlKey}', NOW(), 5, 900, 900, 86400)`
      ),
      /permission denied|FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS/i
    );

    await db.exec('RESET ROLE');

    // 9. Verify 019_revoke_staff_trigger_execute.sql: neither anon nor authenticated can EXECUTE staff boundary trigger helpers
    const idx019 = migrations.indexOf('019_revoke_staff_trigger_execute.sql');
    assert.ok(
      idx019 > idx018,
      '019_revoke_staff_trigger_execute.sql must sort after 018_shop_staff_accounts.sql'
    );

    const checkTriggerHelperPrivileges = async () => {
      const { rows } = await db.query(`
        SELECT
          has_function_privilege('anon', 'public.enforce_shop_staff_credentials_boundaries()', 'EXECUTE') AS anon_cred_trigger_exec,
          has_function_privilege('authenticated', 'public.enforce_shop_staff_credentials_boundaries()', 'EXECUTE') AS authenticated_cred_trigger_exec,
          has_function_privilege('anon', 'public.enforce_staff_login_rate_limits_boundaries()', 'EXECUTE') AS anon_rate_limit_trigger_exec,
          has_function_privilege('authenticated', 'public.enforce_staff_login_rate_limits_boundaries()', 'EXECUTE') AS authenticated_rate_limit_trigger_exec
      `);
      return rows[0];
    };

    assert.deepEqual(await checkTriggerHelperPrivileges(), {
      anon_cred_trigger_exec: false,
      authenticated_cred_trigger_exec: false,
      anon_rate_limit_trigger_exec: false,
      authenticated_rate_limit_trigger_exec: false,
    });

    // Re-applying 019_revoke_staff_trigger_execute.sql is idempotent and preserves trigger enforcement
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/019_revoke_staff_trigger_execute.sql',
        'utf8'
      )
    );
    assert.deepEqual(await checkTriggerHelperPrivileges(), {
      anon_cred_trigger_exec: false,
      authenticated_cred_trigger_exec: false,
      anon_rate_limit_trigger_exec: false,
      authenticated_rate_limit_trigger_exec: false,
    });

    // 10. Verify 022_postgres_realtime_notifications.sql:
    // Publishes minimal notifications on INSERT/UPDATE/DELETE for orders and table_service_requests
    await db.exec(
      'RESET ROLE; SELECT set_config(\'request.jwt.claim.role\', \'service_role\', false), set_config(\'request.jwt.claims\', \'{"role":"service_role"}\', false); SET ROLE service_role;'
    );

    const realtimeEvents = [];
    await db.listen('qlaok_order_events', (payload) => {
      try {
        realtimeEvents.push(JSON.parse(payload));
      } catch {
        realtimeEvents.push(payload);
      }
    });

    // Test INSERT on orders
    const testOrderId = '00000000-0000-0000-0000-000000000101';
    await db.exec(`
      INSERT INTO orders (id, shop_id, order_code, table_label, total_amount, status, payment_status, items)
      VALUES ('${testOrderId}', 'sql-shop', 'ORD-REAL-1', 'Bàn 1', 120000, 'new', 'unpaid', '[]');
    `);

    assert.equal(realtimeEvents.length, 1);
    assert.deepEqual(realtimeEvents[0], {
      table: 'orders',
      eventType: 'INSERT',
      action: 'INSERT',
      orderId: testOrderId,
      shopId: 'sql-shop',
    });
    // Payload MUST NOT contain sensitive customer/amount/status/payment fields
    assert.equal(realtimeEvents[0].total_amount, undefined);
    assert.equal(realtimeEvents[0].payment_status, undefined);
    assert.equal(realtimeEvents[0].items, undefined);

    // Test UPDATE on orders with shop reassignment: must notify BOTH old and new shops
    await db.exec(`
      UPDATE orders SET shop_id = 'sql-pub-shop' WHERE id = '${testOrderId}';
    `);

    assert.equal(realtimeEvents.length, 3); // 1 + 2 notifications
    const shopPubEvent = realtimeEvents.find(e => e.eventType === 'UPDATE' && e.shopId === 'sql-pub-shop');
    const shopOldEvent = realtimeEvents.find(e => e.eventType === 'UPDATE' && e.shopId === 'sql-shop');
    assert.ok(shopPubEvent, 'must notify new shop');
    assert.ok(shopOldEvent, 'must notify old shop on reassignment');
    assert.equal(shopPubEvent.orderId, testOrderId);
    assert.equal(shopOldEvent.orderId, testOrderId);

    // Test DELETE on orders: must notify with OLD shop and OLD orderId
    await db.exec(`DELETE FROM orders WHERE id = '${testOrderId}';`);
    assert.equal(realtimeEvents.length, 4);
    assert.deepEqual(realtimeEvents[3], {
      table: 'orders',
      eventType: 'DELETE',
      action: 'DELETE',
      orderId: testOrderId,
      shopId: 'sql-pub-shop',
    });

    // Test INSERT on table_service_requests
    await db.exec(`
      INSERT INTO shop_tables (id, shop_id, table_code, name, is_active, is_archived)
      VALUES ('sql-real-tbl', 'sql-shop', 'R01', 'Bàn Realtime', true, false);

      INSERT INTO table_service_requests (id, shop_id, table_id, table_code, table_label, request_type, status)
      VALUES ('srv-real-1', 'sql-shop', 'sql-real-tbl', 'R01', 'Bàn Realtime', 'call_staff', 'pending');
    `);
    assert.equal(realtimeEvents.length, 5);
    assert.deepEqual(realtimeEvents[4], {
      table: 'table_service_requests',
      eventType: 'INSERT',
      action: 'INSERT',
      orderId: null,
      shopId: 'sql-shop',
    });

    // 11. Verify 20261029000100_bulk_set_items_availability_atomic.sql:
    // Re-run migration to verify idempotency
    await db.exec('RESET ROLE');
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/20261029000100_bulk_set_items_availability_atomic.sql',
        'utf8'
      )
    );

    // Direct client execution by anon and authenticated is denied
    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.role', 'anon', false), set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); SET ROLE anon;"
    );
    await assert.rejects(
      db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['item-1']::text[], true)"
      ),
      /permission denied/i
    );

    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', false); SET ROLE authenticated;"
    );
    await assert.rejects(
      db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['item-1']::text[], true)"
      ),
      /permission denied/i
    );

    // Switch to service_role and seed catalog fixtures for bulk atomic availability tests
    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role;"
    );
    await db.exec(`
      INSERT INTO categories (id, shop_id, sort_order, name_i18n)
      VALUES
        ('sql-bulk-cat', 'sql-shop', 1, '{"vi":"Món Chính"}'),
        ('sql-bulk-pub-cat', 'sql-pub-shop', 1, '{"vi":"Món Khác"}');
      INSERT INTO items (id, shop_id, category_id, name_i18n, price, stock_quantity, sold_count, is_available)
      VALUES
        ('sql-bulk-null', 'sql-shop', 'sql-bulk-cat', '{"vi":"Trà Đá"}', 5000, NULL, 0, false),
        ('sql-bulk-pos', 'sql-shop', 'sql-bulk-cat', '{"vi":"Phở Bò"}', 55000, 4, 0, false),
        ('sql-bulk-zero', 'sql-shop', 'sql-bulk-cat', '{"vi":"Bánh Mì"}', 25000, 0, 3, false),
        ('sql-bulk-other-shop', 'sql-pub-shop', 'sql-bulk-pub-cat', '{"vi":"Bún Chả"}', 45000, 5, 0, false);
    `);

    // Cross-shop item in batch must fail all-or-nothing with ITEM_NOT_IN_SHOP
    const crossShopBulkRes = (
      await db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['sql-bulk-null','sql-bulk-other-shop']::text[], true) AS result"
      )
    ).rows[0].result;
    assert.equal(crossShopBulkRes.success, false);
    assert.equal(crossShopBulkRes.code, 'ITEM_NOT_IN_SHOP');

    // Zero-stock item in batch with p_is_available = true must fail all-or-nothing with ZERO_STOCK_CANNOT_MARK_AVAILABLE
    const zeroStockBulkRes = (
      await db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['sql-bulk-null','sql-bulk-pos','sql-bulk-zero']::text[], true) AS result"
      )
    ).rows[0].result;
    assert.equal(zeroStockBulkRes.success, false);
    assert.equal(zeroStockBulkRes.code, 'ZERO_STOCK_CANNOT_MARK_AVAILABLE');
    assert.deepEqual(zeroStockBulkRes.zero_stock_item_ids, ['sql-bulk-zero']);

    const itemsAfterRejectedBulk = (
      await db.query(
        "SELECT id, is_available FROM items WHERE id IN ('sql-bulk-null','sql-bulk-pos','sql-bulk-zero') ORDER BY id"
      )
    ).rows;
    assert.deepEqual(itemsAfterRejectedBulk, [
      { id: 'sql-bulk-null', is_available: false },
      { id: 'sql-bulk-pos', is_available: false },
      { id: 'sql-bulk-zero', is_available: false },
    ]);

    // Valid batch (unlimited null + positive stock) succeeds atomically
    const validBulkTrueRes = (
      await db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['sql-bulk-null','sql-bulk-pos']::text[], true) AS result"
      )
    ).rows[0].result;
    assert.equal(validBulkTrueRes.success, true);
    assert.equal(validBulkTrueRes.updated_count, 2);

    const itemsAfterValidBulkTrue = (
      await db.query(
        "SELECT id, is_available FROM items WHERE id IN ('sql-bulk-null','sql-bulk-pos','sql-bulk-zero') ORDER BY id"
      )
    ).rows;
    assert.deepEqual(itemsAfterValidBulkTrue, [
      { id: 'sql-bulk-null', is_available: true },
      { id: 'sql-bulk-pos', is_available: true },
      { id: 'sql-bulk-zero', is_available: false },
    ]);

    // Bulk false succeeds on all items including zero-stock
    const validBulkFalseRes = (
      await db.query(
        "SELECT public.bulk_set_items_availability_atomic('sql-shop', ARRAY['sql-bulk-null','sql-bulk-pos','sql-bulk-zero']::text[], false) AS result"
      )
    ).rows[0].result;
    assert.equal(validBulkFalseRes.success, true);
    assert.equal(validBulkFalseRes.updated_count, 3);

    // 12. Verify 20261030000100_order_audit_logs_subjects.sql:
    // Re-run migration to verify idempotency
    await db.exec('RESET ROLE');
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/20261030000100_order_audit_logs_subjects.sql',
        'utf8'
      )
    );
    // Re-apply table-level grants as done in test harness setup to verify trigger + RLS still block client writes
    await db.exec(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_audit_logs TO anon, authenticated, service_role;'
    );

    await db.exec(
      "RESET ROLE; SELECT set_config('request.jwt.claim.role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); SET ROLE service_role;"
    );

    // Seed an order in sql-pub-shop for cross-shop mismatch verification
    await db.exec(`
      INSERT INTO orders (id, shop_id, order_code, table_label, total_amount, status, payment_status, items)
      VALUES ('sql-pub-order', 'sql-pub-shop', 'PUB-ORD-1', 'Bàn 1', 80000, 'new', 'unpaid', '[]');
    `);

    // 12a. Legacy order-only insert (like migration 011 SePay RPC) auto-populates subject_type='order' and subject_id=order_id
    await db.exec(`
      INSERT INTO public.order_audit_logs (
        id, shop_id, order_id, actor_user_id, actor_role, action, previous_state, next_state, reason
      ) VALUES (
        'audit-sql-order-legacy',
        'sql-shop',
        'sql-order',
        'sepay:9001',
        'webhook',
        'sepay_webhook_reconcile',
        '{"payment_status":"unpaid"}'::jsonb,
        '{"payment_status":"paid"}'::jsonb,
        'SePay VietQR automatic reconciliation'
      );
    `);

    // 12b. Service request audit insert with subject_type='service_request', service_request_id='srv-real-1', order_id=NULL
    await db.exec(`
      INSERT INTO public.order_audit_logs (
        id, shop_id, subject_type, subject_id, order_id, service_request_id, actor_user_id, actor_role, action, next_state, details
      ) VALUES (
        'audit-sql-srv-1',
        'sql-shop',
        'service_request',
        'srv-real-1',
        NULL,
        'srv-real-1',
        'customer_qr',
        'customer',
        'create_service_request',
        '{"status":"pending","request_type":"call_staff"}'::jsonb,
        '{"table_code":"R01"}'::jsonb
      );
    `);

    const insertedAuditRows = (
      await db.query(
        "SELECT id, shop_id, subject_type, subject_id, order_id, service_request_id, action FROM public.order_audit_logs WHERE id IN ('audit-sql-order-legacy', 'audit-sql-srv-1') ORDER BY id"
      )
    ).rows;
    assert.deepEqual(insertedAuditRows, [
      {
        id: 'audit-sql-order-legacy',
        shop_id: 'sql-shop',
        subject_type: 'order',
        subject_id: 'sql-order',
        order_id: 'sql-order',
        service_request_id: null,
        action: 'sepay_webhook_reconcile',
      },
      {
        id: 'audit-sql-srv-1',
        shop_id: 'sql-shop',
        subject_type: 'service_request',
        subject_id: 'srv-real-1',
        order_id: null,
        service_request_id: 'srv-real-1',
        action: 'create_service_request',
      },
    ]);

    // 12c. Reject comma-joined order_id, cross-shop order_id, cross-shop service_request_id, and UPDATE mutation
    await assert.rejects(
      db.query(`
        INSERT INTO public.order_audit_logs (
          id, shop_id, order_id, actor_user_id, actor_role, action
        ) VALUES (
          'audit-bad-comma', 'sql-shop', 'sql-order,sql-pub-order', 'owner', 'owner', 'settle_table_bill'
        )
      `),
      /INVALID_ORDER_AUDIT_SUBJECT/
    );

    await assert.rejects(
      db.query(`
        INSERT INTO public.order_audit_logs (
          id, shop_id, order_id, actor_user_id, actor_role, action
        ) VALUES (
          'audit-bad-cross-order', 'sql-shop', 'sql-pub-order', 'owner', 'owner', 'update_order'
        )
      `),
      /ORDER_AUDIT_SHOP_MISMATCH/
    );

    await assert.rejects(
      db.query(`
        INSERT INTO public.order_audit_logs (
          id, shop_id, subject_type, service_request_id, actor_user_id, actor_role, action
        ) VALUES (
          'audit-bad-cross-srv', 'sql-pub-shop', 'service_request', 'srv-real-1', 'owner', 'owner', 'update_service_request'
        )
      `),
      /SERVICE_REQUEST_AUDIT_SHOP_MISMATCH/
    );

    await assert.rejects(
      db.query(`
        UPDATE public.order_audit_logs SET action = 'tampered' WHERE id = 'audit-sql-order-legacy'
      `),
      /IMMUTABLE_ORDER_AUDIT_LOG/
    );

    // 12d. Direct client INSERT/UPDATE/DELETE is blocked even for shop owner; SELECT requires reports.view
    await db.exec(`
      RESET ROLE;
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${owner}', false);
      SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${owner}"}', false);
    `);

    const ownerAuditRead = (
      await db.query(
        "SELECT id FROM public.order_audit_logs WHERE shop_id = 'sql-shop' ORDER BY id"
      )
    ).rows;
    assert.deepEqual(
      ownerAuditRead.map((r) => r.id),
      [
        'audit-sepay-sql-shop-9001',
        'audit-sepay-sql-shop-9003',
        'audit-sql-order-legacy',
        'audit-sql-srv-1',
      ],
      'shop owner with reports.view can read shop order_audit_logs via RLS'
    );

    await assert.rejects(
      db.query(`
        INSERT INTO public.order_audit_logs (
          id, shop_id, order_id, actor_user_id, actor_role, action
        ) VALUES (
          'audit-client-forged', 'sql-shop', 'sql-order', '${owner}', 'owner', 'forged'
        )
      `),
      /FORBIDDEN_ORDER_AUDIT_DIRECT_MUTATION|row-level security|permission denied/i
    );

    let clientDeletedAudit = false;
    try {
      clientDeletedAudit =
        (
          await db.query(
            "DELETE FROM public.order_audit_logs WHERE id = 'audit-sql-order-legacy' RETURNING id"
          )
        ).rows.length > 0;
    } catch {
      clientDeletedAudit = false;
    }
    assert.equal(
      clientDeletedAudit,
      false,
      'direct client DELETE on order_audit_logs must be denied'
    );

    // Staff and cashier without reports.view cannot read order_audit_logs via RLS
    for (const nonReportMember of [staff, cashier]) {
      await db.exec(`
        RESET ROLE;
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${nonReportMember}', false);
        SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${nonReportMember}"}', false);
      `);
      const nonReportRows = (
        await db.query(
          "SELECT id FROM public.order_audit_logs WHERE shop_id = 'sql-shop'"
        )
      ).rows;
      assert.equal(
        nonReportRows.length,
        0,
        'member without reports.view must not read order_audit_logs'
      );
    }

  } finally { await db.close(); }
});
