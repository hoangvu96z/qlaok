import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllShopOrdersPaginatedForStats } from '@/lib/mpos-store';

type Row = { id: string; shop_id: string; created_at: string };

function makeRows(shopId: string, count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${shopId}-order-${i}`,
    shop_id: shopId,
    created_at: new Date(2026, 0, 1, 0, 0, count - i).toISOString(),
  }));
}

function makeClient(
  rows: Row[],
  opts: { withRange: boolean }
): { client: SupabaseClient; ranges: Array<[number, number]>; filters: Array<[string, unknown]>; tables: string[] } {
  const ranges: Array<[number, number]> = [];
  const filters: Array<[string, unknown]> = [];
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      let current = rows;
      let window: [number, number] | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          current = current.filter((r) => (r as Record<string, unknown>)[col] === val);
          return builder;
        },
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
          const data = window
            ? current.slice(window[0], window[1] + 1)
            : current.slice(0, 1000);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      if (opts.withRange) {
        builder.range = (from: number, to: number) => {
          ranges.push([from, to]);
          window = [from, to];
          return builder;
        };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, ranges, filters, tables };
}

test('stats pagination returns all rows across pages with correct ranges and shop filter', async () => {
  const rows = [...makeRows('shop-a', 4), ...makeRows('shop-b', 3)];
  // Duplicate id on shop-a to verify uniqueness is preserved.
  rows.splice(2, 0, { ...rows[1] });
  const { client, ranges, filters, tables } = makeClient(rows, { withRange: true });

  const result = await fetchAllShopOrdersPaginatedForStats('shop-a', client, {
    pageSize: 2,
    maxPages: 10,
  });

  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
  assert.ok(tables.every((t) => t === 'orders'));
  assert.ok(filters.every(([c, v]) => c === 'shop_id' && v === 'shop-a'));
  const ids = result.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [...ids].sort(),
    makeRows('shop-a', 4).map((r) => r.id).sort()
  );
});

test('stats pagination fails when client lacks range() and returns a full page', async () => {
  const { client } = makeClient(makeRows('shop-a', 5), { withRange: false });
  await assert.rejects(
    fetchAllShopOrdersPaginatedForStats('shop-a', client, { pageSize: 3, maxPages: 5 }),
    /DB_STATS_PAGE_LIMIT_REACHED/
  );
});

test('stats pagination fails when maxPages is reached on a full final page', async () => {
  const { client, ranges } = makeClient(makeRows('shop-a', 10), { withRange: true });
  await assert.rejects(
    fetchAllShopOrdersPaginatedForStats('shop-a', client, { pageSize: 2, maxPages: 3 }),
    /DB_STATS_PAGE_LIMIT_REACHED/
  );
  assert.deepEqual(ranges, [
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
});
