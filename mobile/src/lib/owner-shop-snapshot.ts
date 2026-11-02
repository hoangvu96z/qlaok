export interface OwnerShopSnapshotMembership {
  shop_id: string;
  is_active: boolean;
  permissions: readonly string[];
}

type OwnerShopSnapshotShop = { id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidShop(value: unknown): value is OwnerShopSnapshotShop {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0
  );
}

function isValidMembership(
  value: unknown
): value is OwnerShopSnapshotMembership {
  return (
    isRecord(value) &&
    typeof value.shop_id === 'string' &&
    value.shop_id.trim().length > 0 &&
    typeof value.is_active === 'boolean' &&
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => typeof permission === 'string')
  );
}

function assertValidShopRows(shops: readonly unknown[]): void {
  if (!Array.isArray(shops) || shops.some((shop) => !isValidShop(shop))) {
    throw new Error('MOBILE_SHOP_SNAPSHOT_INVALID');
  }
  const ids = shops.map((shop) => (shop as OwnerShopSnapshotShop).id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('MOBILE_SHOP_SNAPSHOT_DUPLICATE');
  }
}

function assertValidMembershipRows(
  memberships: readonly unknown[]
): asserts memberships is readonly OwnerShopSnapshotMembership[] {
  if (
    !Array.isArray(memberships) ||
    memberships.some((membership) => !isValidMembership(membership))
  ) {
    throw new Error('MOBILE_MEMBERSHIP_SNAPSHOT_INVALID');
  }
  const shopIds = memberships.map((membership) => membership.shop_id);
  if (new Set(shopIds).size !== shopIds.length) {
    throw new Error('MOBILE_MEMBERSHIP_SNAPSHOT_DUPLICATE');
  }
}

export function isValidOwnerShopSnapshotPayload(value: unknown): value is {
  shops: OwnerShopSnapshotShop[];
  memberships: Record<string, OwnerShopSnapshotMembership>;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value.shops) ||
    !isRecord(value.memberships)
  ) {
    return false;
  }
  if (value.shops.some((shop) => !isValidShop(shop))) return false;

  const shopIds = value.shops.map((shop) => (shop as OwnerShopSnapshotShop).id);
  if (new Set(shopIds).size !== shopIds.length) return false;
  const loadedShopIds = new Set(shopIds);

  return Object.entries(value.memberships).every(
    ([shopId, membership]) =>
      shopId.trim().length > 0 &&
      loadedShopIds.has(shopId) &&
      isValidMembership(membership) &&
      membership.shop_id === shopId
  );
}

export function getMemberShopIdsToLoad<Shop extends { id: string }>(
  ownedShops: readonly Shop[],
  memberships: readonly OwnerShopSnapshotMembership[]
): string[] {
  assertValidShopRows(ownedShops);
  assertValidMembershipRows(memberships);

  const ownedShopIds = new Set(ownedShops.map((shop) => shop.id));
  const memberShopIds = new Set<string>();

  for (const membership of memberships) {
    if (
      membership.is_active === true &&
      membership.shop_id &&
      !ownedShopIds.has(membership.shop_id)
    ) {
      memberShopIds.add(membership.shop_id);
    }
  }

  return Array.from(memberShopIds);
}

export function buildOwnerShopSnapshot<
  Shop extends { id: string },
  Membership extends OwnerShopSnapshotMembership
>(params: {
  ownedShops: readonly Shop[];
  memberShops: readonly Shop[];
  memberships: readonly Membership[];
}): { shops: Shop[]; memberships: Record<string, Membership> } {
  assertValidShopRows(params.ownedShops);
  assertValidShopRows(params.memberShops);
  assertValidMembershipRows(params.memberships);

  const memberShopIds = getMemberShopIdsToLoad(
    params.ownedShops,
    params.memberships
  );
  const requestedMemberShopIds = new Set(memberShopIds);
  const shopsById = new Map<string, Shop>();

  for (const shop of params.ownedShops) shopsById.set(shop.id, shop);
  for (const shop of params.memberShops) {
    if (!requestedMemberShopIds.has(shop.id)) {
      throw new Error('MOBILE_MEMBER_SHOP_SNAPSHOT_UNEXPECTED');
    }
    if (!shopsById.has(shop.id)) shopsById.set(shop.id, shop);
  }

  if (memberShopIds.some((shopId) => !shopsById.has(shopId))) {
    throw new Error('MOBILE_MEMBER_SHOP_SNAPSHOT_INCOMPLETE');
  }

  const shops = Array.from(shopsById.values());
  const allowedShopIds = new Set(shops.map((shop) => shop.id));
  const ownedShopIds = new Set(params.ownedShops.map((shop) => shop.id));
  const memberships = Object.fromEntries(
    params.memberships
      .filter(
        (membership) =>
          allowedShopIds.has(membership.shop_id) &&
          (ownedShopIds.has(membership.shop_id) || membership.is_active)
      )
      .map((membership) => [membership.shop_id, membership])
  ) as Record<string, Membership>;

  return { shops, memberships };
}
