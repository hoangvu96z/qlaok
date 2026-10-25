import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = fs.readFileSync(
  path.join('supabase', 'migrations', '020_remove_legacy_base64_images.sql'),
  'utf8'
);

test('migration 020 removes inline Base64 image data and preserves unrelated data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.shops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        logo_url TEXT,
        cover_urls TEXT[],
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE public.items (
        id TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE public.orders (
        id TEXT PRIMARY KEY,
        order_code TEXT NOT NULL
      );
      INSERT INTO public.shops (id, name, logo_url, cover_urls, updated_at) VALUES
        ('shop-with-base64', 'Base64 shop', ' data:image/png;base64,bG9nbw== ',
          ARRAY['https://cdn.example.test/cover.webp', 'data:image/webp;base64,Y292ZXI='], '2000-01-01T00:00:00Z'),
        ('shop-without-base64', 'URL shop', 'https://cdn.example.test/logo.webp',
          ARRAY['https://cdn.example.test/cover.webp'], '2000-01-01T00:00:00Z'),
        ('shop-null-covers', 'Null covers', NULL, NULL, '2000-01-01T00:00:00Z');
      INSERT INTO public.items (id, shop_id, name, price, image_url, updated_at) VALUES
        ('item-with-base64', 'shop-with-base64', 'Base64 item', 12000,
          'data:image/webp;base64,aXRlbQ==', '2000-01-01T00:00:00Z'),
        ('item-with-url', 'shop-without-base64', 'URL item', 15000,
          'https://cdn.example.test/item.webp', '2000-01-01T00:00:00Z');
      INSERT INTO public.orders (id, order_code) VALUES ('historical-order', 'ORD-KEEP');
    `);

    await db.exec(migration);

    const items = (await db.query(
      'SELECT id, shop_id, name, price, image_url, updated_at FROM public.items ORDER BY id'
    )).rows;
    assert.equal(items.length, 2);
    assert.equal(items[0].image_url, null);
    assert.equal(items[0].name, 'Base64 item');
    assert.equal(Number(items[0].price), 12000);
    assert.ok(new Date(items[0].updated_at).getTime() > Date.parse('2000-01-01T00:00:00Z'));
    assert.equal(items[1].image_url, 'https://cdn.example.test/item.webp');
    assert.equal(items[1].updated_at.toISOString(), '2000-01-01T00:00:00.000Z');

    const shops = (await db.query(
      'SELECT id, name, logo_url, cover_urls, updated_at FROM public.shops ORDER BY id'
    )).rows;
    const shopById = new Map(shops.map((shop) => [shop.id, shop]));
    const changedShop = shopById.get('shop-with-base64');
    const unchangedShop = shopById.get('shop-without-base64');
    const nullCoverShop = shopById.get('shop-null-covers');
    assert.equal(changedShop.logo_url, null);
    assert.deepEqual(changedShop.cover_urls, ['https://cdn.example.test/cover.webp']);
    assert.equal(changedShop.name, 'Base64 shop');
    assert.ok(new Date(changedShop.updated_at).getTime() > Date.parse('2000-01-01T00:00:00Z'));
    assert.equal(unchangedShop.logo_url, 'https://cdn.example.test/logo.webp');
    assert.deepEqual(unchangedShop.cover_urls, ['https://cdn.example.test/cover.webp']);
    assert.equal(unchangedShop.updated_at.toISOString(), '2000-01-01T00:00:00.000Z');
    assert.equal(nullCoverShop.cover_urls, null);
    assert.deepEqual((await db.query('SELECT id, order_code FROM public.orders')).rows, [
      { id: 'historical-order', order_code: 'ORD-KEEP' },
    ]);

    await db.exec(migration);
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM public.items WHERE image_url ILIKE 'data:image/%;base64,%'")).rows[0].count,
      0
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM public.shops WHERE logo_url ILIKE 'data:image/%;base64,%' OR EXISTS (SELECT 1 FROM unnest(COALESCE(cover_urls, ARRAY[]::TEXT[])) AS cover(value) WHERE value ILIKE 'data:image/%;base64,%')")).rows[0].count,
      0
    );
  } finally {
    await db.close();
  }
});
