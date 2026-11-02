import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGetAllShopsAndProfile, setSupabaseDbClientForTests } from '@/lib/db';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';

const ownerId = 'owner-member-snapshot-test';
const ownedShop = {
  id: 'owned-shop-member-snapshot-test',
  owner_id: ownerId,
  name: 'Owned shop',
  slug: 'owned-shop-member-snapshot-test',
};
const memberShop = {
  id: 'member-shop-snapshot-test',
  owner_id: 'another-owner',
  name: 'Member shop',
  slug: 'member-shop-snapshot-test',
};
const activeMembership = {
  id: 'membership-snapshot-test',
  user_id: ownerId,
  shop_id: memberShop.id,
  role: 'staff',
  permissions: ['orders.view'],
  is_active: true,
};

function createDbClients(memberShopResult: {
  data: unknown;
  error: { message: string } | null;
}) {
  const dbClient = {
    from(table: string) {
      let columns = '';
      let rowLimit: number | null = null;
      const filters: Record<string, unknown> = {};
      const query = {
        select(nextColumns: string) {
          columns = nextColumns;
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        in(column: string, values: unknown[]) {
          filters[column] = values;
          return query;
        },
        order() {
          return query;
        },
        limit(count: number) {
          rowLimit = count;
          return query;
        },
        maybeSingle() {
          assert.equal(table, 'profiles');
          return Promise.resolve({
            data: { id: ownerId, email: 'owner@example.test' },
            error: null,
          });
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          let result: { data: unknown; error: { message: string } | null };
          if (table === 'shops' && columns === 'id' && rowLimit === 1) {
            result = { data: [{ id: ownedShop.id }], error: null };
          } else if (table === 'shops' && filters.owner_id === ownerId) {
            result = { data: [ownedShop], error: null };
          } else if (
            table === 'shops' &&
            Array.isArray(filters.id) &&
            filters.id.includes(memberShop.id)
          ) {
            result = memberShopResult;
          } else {
            throw new Error(`Unexpected mocked query: ${table}`);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };

  const membershipClient = {
    from(table: string) {
      assert.equal(table, 'shop_memberships');
      const filters: Record<string, unknown> = {};
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          assert.equal(filters.user_id, ownerId);
          return Promise.resolve({ data: [activeMembership], error: null }).then(
            resolve,
            reject
          );
        },
      };
      return query;
    },
  };

  return { dbClient, membershipClient };
}

async function withMockedClients<T>(
  memberShopResult: { data: unknown; error: { message: string } | null },
  run: () => Promise<T>
): Promise<T> {
  const { dbClient, membershipClient } = createDbClients(memberShopResult);
  setSupabaseDbClientForTests(dbClient);
  setShopMembershipDbClientForTest(membershipClient as never);
  try {
    return await run();
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
  }
}

test('P3-23: member-shop query errors fail the owner snapshot without leaking database details', async () => {
  await withMockedClients(
    { data: null, error: { message: 'private synthetic database detail' } },
    async () => {
      await assert.rejects(
        dbGetAllShopsAndProfile(ownerId),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, 'SHOP_MEMBER_SHOPS_QUERY_FAILED');
          assert.doesNotMatch(error.message, /private synthetic database detail/);
          return true;
        }
      );
    }
  );
});

test('P3-23: local/demo owner snapshot fails when an active member shop is unavailable', async () => {
  const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const { membershipClient } = createDbClients({ data: [], error: null });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  setSupabaseDbClientForTests(null);
  setShopMembershipDbClientForTest(membershipClient as never);

  try {
    await assert.rejects(
      dbGetAllShopsAndProfile(ownerId),
      /SHOP_MEMBER_SHOP_SNAPSHOT_INCOMPLETE/
    );
  } finally {
    setShopMembershipDbClientForTest(null);
    setSupabaseDbClientForTests(null);
    if (previousSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
    }
  }
});

test('P3-23: a partial member-shop result fails instead of returning an incomplete 200 snapshot', async () => {
  await withMockedClients({ data: [], error: null }, async () => {
    await assert.rejects(
      dbGetAllShopsAndProfile(ownerId),
      /SHOP_MEMBER_SHOP_SNAPSHOT_INCOMPLETE/
    );
  });
});

test('P3-23: successful owner snapshot contains active member shops and memberships', async () => {
  await withMockedClients({ data: [memberShop], error: null }, async () => {
    const snapshot = await dbGetAllShopsAndProfile(ownerId);

    assert.deepEqual(
      snapshot.shops.map((shop) => shop.id).sort(),
      [ownedShop.id, memberShop.id].sort()
    );
    assert.equal(snapshot.memberships?.[memberShop.id]?.is_active, true);
    assert.equal(snapshot.memberships?.[memberShop.id]?.role, 'staff');
  });
});
