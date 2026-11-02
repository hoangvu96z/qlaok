import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOwnerShopSnapshot,
  getMemberShopIdsToLoad,
  isValidOwnerShopSnapshotPayload,
} from '../src/lib/owner-shop-snapshot.ts';

const ownerShop = { id: 'shop-owned', owner_id: 'owner-1' };
const memberShop = { id: 'shop-member', owner_id: 'owner-2' };
const activeMemberships = [
  {
    shop_id: 'shop-owned',
    is_active: true,
    permissions: ['orders.view'],
    role: 'owner',
  },
  {
    shop_id: 'shop-member',
    is_active: true,
    permissions: ['orders.view'],
    role: 'staff',
  },
  {
    shop_id: 'shop-inactive',
    is_active: false,
    permissions: [],
    role: 'staff',
  },
];

test('fallback loads active member shops but does not query owned or inactive memberships', () => {
  assert.deepEqual(getMemberShopIdsToLoad([ownerShop], activeMemberships), [
    'shop-member',
  ]);
});

test('fallback snapshot retains member shops and filters inactive unowned memberships', () => {
  const snapshot = buildOwnerShopSnapshot({
    ownedShops: [ownerShop],
    memberShops: [memberShop],
    memberships: activeMemberships,
  });

  assert.deepEqual(
    snapshot.shops.map((shop) => shop.id),
    ['shop-owned', 'shop-member']
  );
  assert.deepEqual(Object.keys(snapshot.memberships).sort(), [
    'shop-member',
    'shop-owned',
  ]);
});

test('fallback rejects an incomplete member-shop query instead of returning a pruned snapshot', () => {
  assert.throws(
    () =>
      buildOwnerShopSnapshot({
        ownedShops: [ownerShop],
        memberShops: [],
        memberships: activeMemberships,
      }),
    /MOBILE_MEMBER_SHOP_SNAPSHOT_INCOMPLETE/
  );
});

test('fallback preserves an explicit inactive owner membership to prevent synthesized owner access', () => {
  const revokedOwnerMembership = {
    shop_id: ownerShop.id,
    is_active: false,
    permissions: [],
    role: 'owner',
  };
  const snapshot = buildOwnerShopSnapshot({
    ownedShops: [ownerShop],
    memberShops: [],
    memberships: [revokedOwnerMembership],
  });

  assert.equal(snapshot.memberships[ownerShop.id].is_active, false);
  assert.deepEqual(snapshot.memberships[ownerShop.id].permissions, []);
});

test('fallback rejects duplicate membership rows instead of letting the last row override permissions', () => {
  assert.throws(
    () =>
      buildOwnerShopSnapshot({
        ownedShops: [ownerShop],
        memberShops: [memberShop],
        memberships: [
          activeMemberships[1],
          {
            shop_id: memberShop.id,
            is_active: false,
            permissions: [],
            role: 'staff',
          },
        ],
      }),
    /MOBILE_MEMBERSHIP_SNAPSHOT_DUPLICATE/
  );
});

test('API snapshot validation rejects malformed rows and incomplete membership references', () => {
  const validPayload = {
    shops: [ownerShop, memberShop],
    memberships: {
      [ownerShop.id]: activeMemberships[0],
      [memberShop.id]: activeMemberships[1],
    },
  };

  assert.equal(isValidOwnerShopSnapshotPayload(validPayload), true);
  assert.equal(isValidOwnerShopSnapshotPayload(null), false);
  assert.equal(isValidOwnerShopSnapshotPayload({ shops: null, memberships: {} }), false);
  assert.equal(
    isValidOwnerShopSnapshotPayload({
      shops: [{ name: 'shop without id' }],
      memberships: {},
    }),
    false
  );
  assert.equal(
    isValidOwnerShopSnapshotPayload({ shops: [ownerShop], memberships: [] }),
    false
  );
  assert.equal(
    isValidOwnerShopSnapshotPayload({
      shops: [ownerShop],
      memberships: {
        [ownerShop.id]: {
          ...activeMemberships[0],
          is_active: 'false',
        },
      },
    }),
    false
  );
  assert.equal(
    isValidOwnerShopSnapshotPayload({
      shops: [ownerShop],
      memberships: {
        [ownerShop.id]: { ...activeMemberships[1] },
      },
    }),
    false
  );
});
