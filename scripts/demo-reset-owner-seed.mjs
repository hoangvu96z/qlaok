/**
 * Helper to build seed rows for resetting demo owner data.
 */

function cloneDeep(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export async function buildDemoOwnerSeedRows() {
  const { SEED_PROFILE, SEED_SHOPS } = await import('../src/lib/seed-data.ts');
  const { SEED_SHOP_TABLES } = await import('../src/lib/shop-tables.ts');
  const { ALL_SHOP_PERMISSIONS } = await import('../src/lib/shop-permissions.ts');

  // Validate all shop.owner_id equals profile.id
  for (const shop of SEED_SHOPS) {
    if (shop.owner_id !== SEED_PROFILE.id) {
      throw new Error(
        `Invariant violation: shop ${shop.id} owner_id (${shop.owner_id}) does not match profile id (${SEED_PROFILE.id})`
      );
    }
  }

  // Validate every shop_table.shop_id exists in shops
  const validShopIds = new Set(SEED_SHOPS.map((shop) => shop.id));
  for (const table of SEED_SHOP_TABLES) {
    if (!validShopIds.has(table.shop_id)) {
      throw new Error(
        `Invariant violation: shop_table ${table.id} references non-existent shop_id ${table.shop_id}`
      );
    }
  }

  const profiles = [cloneDeep(SEED_PROFILE)];
  const shops = cloneDeep(SEED_SHOPS);
  const shop_tables = cloneDeep(SEED_SHOP_TABLES);

  const shop_memberships = shops.map((shop) => ({
    id: `mem-owner-${shop.id}-${shop.owner_id}`,
    shop_id: shop.id,
    user_id: shop.owner_id,
    role: 'owner',
    permissions: cloneDeep(ALL_SHOP_PERMISSIONS),
    is_active: true,
  }));

  return {
    profiles,
    shops,
    shop_memberships,
    shop_tables,
  };
}
