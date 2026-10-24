/**
 * Helper to build seed rows for resetting demo owner data.
 */

function cloneDeep(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export async function buildDemoSeedRows() {
  const {
    SEED_PROFILE,
    SEED_SHOPS,
    SEED_CATEGORIES,
    SEED_ITEMS,
    SEED_POSTS,
    SEED_TRANSACTIONS,
    SEED_ANALYTICS,
  } = await import('../src/lib/seed-data.ts');
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

  const validShopIds = new Set(SEED_SHOPS.map((shop) => shop.id));

  // Validate every shop_table.shop_id exists in shops
  for (const table of SEED_SHOP_TABLES) {
    if (!validShopIds.has(table.shop_id)) {
      throw new Error(
        `Invariant violation: shop_table ${table.id} references non-existent shop_id ${table.shop_id}`
      );
    }
  }

  // Validate category references (shop_id)
  for (const category of SEED_CATEGORIES) {
    if (!validShopIds.has(category.shop_id)) {
      throw new Error(
        `Invariant violation: category ${category.id} references non-existent shop_id ${category.shop_id}`
      );
    }
  }

  const validCategoryIds = new Set(SEED_CATEGORIES.map((cat) => cat.id));

  // Validate item references (shop_id and category_id)
  for (const item of SEED_ITEMS) {
    if (!validShopIds.has(item.shop_id)) {
      throw new Error(
        `Invariant violation: item ${item.id} references non-existent shop_id ${item.shop_id}`
      );
    }
    if (!validCategoryIds.has(item.category_id)) {
      throw new Error(
        `Invariant violation: item ${item.id} references non-existent category_id ${item.category_id}`
      );
    }
  }

  const validItemIds = new Set(SEED_ITEMS.map((item) => item.id));

  // Validate post references (shop_id)
  for (const post of SEED_POSTS) {
    if (!validShopIds.has(post.shop_id)) {
      throw new Error(
        `Invariant violation: post ${post.id} references non-existent shop_id ${post.shop_id}`
      );
    }
  }

  // Validate transaction references (user_id points to existing profile)
  for (const tx of SEED_TRANSACTIONS) {
    if (tx.user_id !== SEED_PROFILE.id) {
      throw new Error(
        `Invariant violation: transaction ${tx.id} user_id (${tx.user_id}) does not match profile id (${SEED_PROFILE.id})`
      );
    }
  }

  // Validate analytics references (shop_id and optional item_id)
  for (const event of SEED_ANALYTICS) {
    if (!validShopIds.has(event.shop_id)) {
      throw new Error(
        `Invariant violation: analytics event ${event.id ?? 'unknown'} references non-existent shop_id ${event.shop_id}`
      );
    }
    if (event.item_id && !validItemIds.has(event.item_id)) {
      throw new Error(
        `Invariant violation: analytics event ${event.id ?? 'unknown'} references non-existent item_id ${event.item_id}`
      );
    }
  }

  const profiles = [cloneDeep(SEED_PROFILE)];
  const shops = cloneDeep(SEED_SHOPS);
  const shop_tables = cloneDeep(SEED_SHOP_TABLES);
  const categories = cloneDeep(SEED_CATEGORIES);
  const items = cloneDeep(SEED_ITEMS);
  const posts = cloneDeep(SEED_POSTS);
  const payment_transactions = cloneDeep(SEED_TRANSACTIONS);
  const analytics_events = cloneDeep(
    SEED_ANALYTICS.map(({ id: _id, ...rest }) => rest)
  );

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
    categories,
    items,
    posts,
    payment_transactions,
    analytics_events,
  };
}

export const buildDemoOwnerSeedRows = buildDemoSeedRows;
