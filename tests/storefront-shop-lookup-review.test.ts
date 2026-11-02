import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dbGetStorefrontBundle,
  setSupabaseDbClientForTests,
} from '@/lib/db';

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function createStorefrontLookupClient(params: {
  canonical: QueryResult;
  alias: QueryResult;
  aliasedShop: QueryResult;
  legacySingleForShops?: boolean;
}) {
  return {
    from(table: string) {
      if (table === 'shops') {
        return {
          select(columns: string) {
            if (columns === 'id') {
              return {
                limit: async () => ({
                  data: [{ id: 'shop-qa' }],
                  error: null,
                }),
              };
            }

            return {
              eq(column: string) {
                if (column === 'slug') {
                  return params.legacySingleForShops
                    ? { single: async () => params.canonical }
                    : { maybeSingle: async () => params.canonical };
                }
                if (column === 'id') {
                  return params.legacySingleForShops
                    ? { single: async () => params.aliasedShop }
                    : { maybeSingle: async () => params.aliasedShop };
                }
                throw new Error(`Unexpected shops filter: ${column}`);
              },
            };
          },
        };
      }

      if (table === 'shop_slug_aliases') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => params.alias }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('storefront slug lookup propagates canonical Supabase query errors', async () => {
  setSupabaseDbClientForTests(
    createStorefrontLookupClient({
      canonical: {
        data: null,
        error: { code: '42501', message: 'permission denied on shops' },
      },
      alias: { data: null, error: null },
      aliasedShop: { data: null, error: null },
    })
  );

  try {
    await assert.rejects(
      dbGetStorefrontBundle('qlaok'),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'STOREFRONT_SHOP_LOOKUP_FAILED' &&
        !error.message.includes('permission denied')
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('storefront slug lookup propagates errors resolving an alias to its shop', async () => {
  setSupabaseDbClientForTests(
    createStorefrontLookupClient({
      canonical: { data: null, error: null },
      alias: {
        data: { slug: 'old-qlaok', shop_id: 'shop-qa' },
        error: null,
      },
      aliasedShop: {
        data: null,
        error: { code: 'XX000', message: 'database is temporarily unavailable' },
      },
    })
  );

  try {
    await assert.rejects(
      dbGetStorefrontBundle('old-qlaok'),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'STOREFRONT_SHOP_ALIAS_LOOKUP_FAILED' &&
        !error.message.includes('temporarily unavailable')
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('storefront slug lookup still returns null when no canonical shop or alias exists', async () => {
  setSupabaseDbClientForTests(
    createStorefrontLookupClient({
      canonical: { data: null, error: null },
      alias: { data: null, error: null },
      aliasedShop: { data: null, error: null },
    })
  );

  try {
    assert.equal(await dbGetStorefrontBundle('missing-shop'), null);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('legacy single() lookup still treats PGRST116 as a missing canonical shop', async () => {
  setSupabaseDbClientForTests(
    createStorefrontLookupClient({
      canonical: { data: null, error: { code: 'PGRST116', message: 'No rows' } },
      alias: { data: null, error: null },
      aliasedShop: { data: null, error: null },
      legacySingleForShops: true,
    })
  );

  try {
    assert.equal(await dbGetStorefrontBundle('missing-shop'), null);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});
