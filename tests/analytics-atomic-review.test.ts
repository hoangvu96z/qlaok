import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

test('analytics event and item view count commit or roll back atomically', async () => {
  const db = new PGlite({ extensions: { uuid_ossp } });
  const recordEvent = (
    shopId: string,
    eventType: 'scan_door' | 'item_view',
    itemId: string | null = null,
    visitorLang = 'vi'
  ) =>
    db.query<{ event_type: string }>(
      `SELECT public.record_analytics_event_atomic(
         $1::text,
         $2::public.analytics_event_type,
         $3::text,
         $4::text,
         'analytics-test'::text
       )->>'event_type' AS event_type`,
      [shopId, eventType, itemId, visitorLang]
    );

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
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
    }

    await db.exec(`
      INSERT INTO public.profiles(id) VALUES ('analytics-owner');
      INSERT INTO public.shops(id, owner_id, slug, name)
        VALUES ('analytics-shop', 'analytics-owner', 'analytics-shop', 'Analytics QA');
      INSERT INTO public.shops(id, owner_id, slug, name, is_published)
        VALUES ('analytics-hidden-shop', 'analytics-owner', 'analytics-hidden-shop', 'Hidden QA', FALSE);
      INSERT INTO public.shops(id, owner_id, slug, name)
        VALUES ('analytics-locale-shop', 'analytics-owner', 'analytics-locale-shop', 'Locale QA');
      INSERT INTO public.categories(id, shop_id) VALUES
        ('analytics-category', 'analytics-shop'),
        ('analytics-hidden-category', 'analytics-hidden-shop');
      INSERT INTO public.items(id, shop_id, category_id, name_i18n, price) VALUES
        ('analytics-item', 'analytics-shop', 'analytics-category', '{"vi":"QA item"}', 1000),
        ('analytics-foreign-item', 'analytics-hidden-shop', 'analytics-hidden-category', '{"vi":"Other item"}', 1000);
    `);

    for (const locale of ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru']) {
      const event = await recordEvent(
        'analytics-locale-shop',
        'scan_door',
        null,
        locale
      );
      assert.equal(event.rows[0].event_type, 'scan_door', locale);
    }
    await assert.rejects(
      recordEvent('analytics-locale-shop', 'scan_door', null, 'xx'),
      /INVALID_VISITOR_LANG/
    );

    await assert.rejects(
      recordEvent('analytics-hidden-shop', 'scan_door'),
      /SHOP_NOT_TRACKABLE/
    );
    await assert.rejects(
      recordEvent('analytics-shop', 'item_view', 'analytics-foreign-item'),
      /ITEM_NOT_IN_SHOP/
    );

    await db.exec(`
      CREATE FUNCTION public.reject_analytics_insert_for_test()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TEST_ANALYTICS_INSERT_FAILED'; END;
      $$;
      CREATE TRIGGER reject_analytics_insert_for_test
      BEFORE INSERT ON public.analytics_events
      FOR EACH ROW EXECUTE FUNCTION public.reject_analytics_insert_for_test();
    `);
    await assert.rejects(
      recordEvent('analytics-shop', 'item_view', 'analytics-item'),
      /TEST_ANALYTICS_INSERT_FAILED/
    );
    await db.exec(`
      DROP TRIGGER reject_analytics_insert_for_test ON public.analytics_events;
      DROP FUNCTION public.reject_analytics_insert_for_test();
    `);

    const eventCountAfterInsertFailure = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.analytics_events WHERE shop_id = 'analytics-shop'`
    );
    const viewsAfterInsertFailure = await db.query<{ view_count: number }>(
      `SELECT view_count FROM public.items WHERE id = 'analytics-item'`
    );
    assert.equal(Number(eventCountAfterInsertFailure.rows[0].count), 0);
    assert.equal(viewsAfterInsertFailure.rows[0].view_count, 0);

    await db.exec('SET ROLE service_role');
    try {
      const inserted = await recordEvent(
        'analytics-shop',
        'item_view',
        'analytics-item'
      );
      assert.equal(inserted.rows[0].event_type, 'item_view');
    } finally {
      await db.exec('RESET ROLE');
    }

    const eventCountAfterSuccess = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.analytics_events WHERE shop_id = 'analytics-shop'`
    );
    const viewsAfterSuccess = await db.query<{ view_count: number }>(
      `SELECT view_count FROM public.items WHERE id = 'analytics-item'`
    );
    assert.equal(Number(eventCountAfterSuccess.rows[0].count), 1);
    assert.equal(viewsAfterSuccess.rows[0].view_count, 1);

    await db.exec(`
      CREATE FUNCTION public.reject_view_count_update_for_test()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'TEST_VIEW_COUNT_UPDATE_FAILED'; END;
      $$;
      CREATE TRIGGER reject_view_count_update_for_test
      BEFORE UPDATE OF view_count ON public.items
      FOR EACH ROW EXECUTE FUNCTION public.reject_view_count_update_for_test();
    `);
    await assert.rejects(
      recordEvent('analytics-shop', 'item_view', 'analytics-item'),
      /TEST_VIEW_COUNT_UPDATE_FAILED/
    );

    const eventCountAfterUpdateFailure = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.analytics_events WHERE shop_id = 'analytics-shop'`
    );
    const viewsAfterUpdateFailure = await db.query<{ view_count: number }>(
      `SELECT view_count FROM public.items WHERE id = 'analytics-item'`
    );
    assert.equal(Number(eventCountAfterUpdateFailure.rows[0].count), 1);
    assert.equal(viewsAfterUpdateFailure.rows[0].view_count, 1);

    const grants = await db.query<{
      anon_can_execute: boolean;
      authenticated_can_execute: boolean;
      service_role_can_execute: boolean;
    }>(`
      SELECT
        has_function_privilege('anon', 'public.record_analytics_event_atomic(text,public.analytics_event_type,text,text,text)', 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', 'public.record_analytics_event_atomic(text,public.analytics_event_type,text,text,text)', 'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role', 'public.record_analytics_event_atomic(text,public.analytics_event_type,text,text,text)', 'EXECUTE') AS service_role_can_execute
    `);
    assert.deepEqual(grants.rows[0], {
      anon_can_execute: false,
      authenticated_can_execute: false,
      service_role_can_execute: true,
    });
  } finally {
    await db.close();
  }
});
