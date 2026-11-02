import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dbGetUserShopMemberships,
  resolveUserShopMembership,
  setShopMembershipDbClientForTest,
} from '@/lib/shop-permissions';

test('explicitly inactive owner membership denies synthesized owner access and query failures fail closed', async () => {
  const ownerMembership = {
    id: 'owner-membership',
    shop_id: 'disabled-shop',
    user_id: 'disabled-owner',
    role: 'owner',
    permissions: [],
    is_active: false,
  };
  let queryFails = false;
  const client = {
    from(table: string) {
      assert.equal(table, 'shop_memberships');
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          const result = queryFails
            ? { data: null, error: { message: 'synthetic query failure' } }
            : {
                data: filters.every(([column, value]) =>
                  ownerMembership[column as keyof typeof ownerMembership] === value
                )
                  ? [ownerMembership]
                  : [],
                error: null,
              };
          return Promise.resolve(result).then(resolve);
        },
      };
      return query;
    },
  };

  setShopMembershipDbClientForTest(client as never);
  try {
    const inactive = await resolveUserShopMembership({
      userId: ownerMembership.user_id,
      shopId: ownerMembership.shop_id,
      shopOwnerId: ownerMembership.user_id,
    });
    assert.equal(inactive, null);

    ownerMembership.is_active = true;
    const active = await resolveUserShopMembership({
      userId: ownerMembership.user_id,
      shopId: ownerMembership.shop_id,
      shopOwnerId: ownerMembership.user_id,
    });
    assert.equal(active?.is_active, true);
    assert.equal(active?.role, 'owner');

    queryFails = true;
    await assert.rejects(
      dbGetUserShopMemberships(ownerMembership.user_id, {
        includeInactive: true,
      }),
      /SHOP_MEMBERSHIP_QUERY_FAILED/
    );
    await assert.rejects(
      resolveUserShopMembership({
        userId: ownerMembership.user_id,
        shopId: ownerMembership.shop_id,
        shopOwnerId: ownerMembership.user_id,
      }),
      /SHOP_MEMBERSHIP_QUERY_FAILED/
    );
  } finally {
    setShopMembershipDbClientForTest(null);
  }
});
