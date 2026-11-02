import test from 'node:test';
import assert from 'node:assert/strict';
import { dbGetShopCatalog, setSupabaseDbClientForTests } from '@/lib/db';

function createCatalogDbMock(failingTable: string) {
  const shop = {
    id: 'shop-alpha',
    owner_id: 'owner-alpha',
    name: 'Alpha',
    slug: 'alpha',
  };

  class QueryBuilder {
    private columns = '*';
    private single = false;
    private readonly table: string;
    constructor(table: string) {
      this.table = table;
    }

    select(columns = '*') {
      this.columns = columns;
      return this;
    }

    order() {
      return this;
    }

    eq() {
      return this;
    }

    limit() {
      return this;
    }

    maybeSingle() {
      this.single = true;
      return this;
    }

    private execute() {
      if (this.table === failingTable) {
        return Promise.resolve({
          data: null,
          error: { code: 'XX000', message: 'Synthetic query failure' },
        });
      }
      const data =
        this.table === 'shops'
          ? this.columns === 'id'
            ? [{ id: shop.id }]
            : [shop]
          : this.table === 'profiles' && this.single
            ? { plan: 'basic' }
            : [];
      return Promise.resolve({ data, error: null });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new QueryBuilder(table);
    },
  };
}

for (const [table, code] of [
  ['shops', 'SHOP_CATALOG_SHOP_QUERY_FAILED'],
  ['categories', 'SHOP_CATALOG_CATEGORIES_QUERY_FAILED'],
  ['items', 'SHOP_CATALOG_ITEMS_QUERY_FAILED'],
] as const) {
  test(`dbGetShopCatalog surfaces ${table} read failures`, async () => {
    setSupabaseDbClientForTests(createCatalogDbMock(table) as never);
    try {
      await assert.rejects(dbGetShopCatalog('shop-alpha'), new RegExp(code));
    } finally {
      setSupabaseDbClientForTests(null);
    }
  });
}
