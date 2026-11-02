import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dbDeleteCategory,
  dbDeleteItem,
  setSupabaseDbClientForTests,
} from '@/lib/db';

type DeleteMode = 'error' | 'no-rows' | 'success';

function createDeleteDbMock(targetTable: string, mode: DeleteMode, targetId: string) {
  const rows = [{ id: targetId }];

  return {
    from(table: string) {
      if (table === 'shops') {
        const query = {
          select() {
            return query;
          },
          limit() {
            return Promise.resolve({ data: [{ id: 'ready-shop' }], error: null });
          },
        };
        return query;
      }

      if (table === targetTable) {
        const query = {
          delete() {
            return query;
          },
          eq() {
            return query;
          },
          select() {
            return query;
          },
          then(resolve: (value: unknown) => unknown) {
            const result =
              mode === 'error'
                ? { data: null, error: { code: 'XX000', message: 'delete failed' } }
                : mode === 'no-rows'
                  ? { data: [], error: null }
                  : { data: rows, error: null };
            return Promise.resolve(result).then(resolve);
          },
        };
        return query;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('catalog delete helpers require a confirmed affected row', async () => {
  const cases = [
    { mode: 'error' as const, expected: false },
    { mode: 'no-rows' as const, expected: false },
    { mode: 'success' as const, expected: true },
  ];

  for (const { mode, expected } of cases) {
    setSupabaseDbClientForTests(createDeleteDbMock('items', mode, 'item-delete-target') as never);
    try {
      assert.equal(await dbDeleteItem('item-delete-target'), expected, `item delete ${mode}`);
    } finally {
      setSupabaseDbClientForTests(null);
    }

    setSupabaseDbClientForTests(createDeleteDbMock('categories', mode, 'category-delete-target') as never);
    try {
      assert.equal(
        await dbDeleteCategory('category-delete-target'),
        expected,
        `category delete ${mode}`
      );
    } finally {
      setSupabaseDbClientForTests(null);
    }
  }
});
