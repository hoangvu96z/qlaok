import fs from 'fs';
import path from 'path';
import {
  AnalyticsEvent,
  AnalyticsEventType,
  CatalogItem,
  Category,
  PaymentTransaction,
  PlanTier,
  Post,
  Profile,
  Shop,
  SupportedLocale,
} from '@/types/qlaok';
import {
  SEED_ANALYTICS,
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_POSTS,
  SEED_PROFILE,
  SEED_SHOPS,
  SEED_TRANSACTIONS,
} from './seed-data';
import { canAddMoreItems } from './plan-limits';

export interface LocalDatabaseSchema {
  profile: Profile;
  shops: Shop[];
  categories: Category[];
  items: CatalogItem[];
  posts: Post[];
  analytics: AnalyticsEvent[];
  transactions: PaymentTransaction[];
}

const DB_DIR = path.join(process.cwd(), '.local-db');
const DB_FILE = path.join(DB_DIR, 'db.json');

function getInitialData(): LocalDatabaseSchema {
  return {
    profile: structuredClone(SEED_PROFILE),
    shops: structuredClone(SEED_SHOPS),
    categories: structuredClone(SEED_CATEGORIES),
    items: structuredClone(SEED_ITEMS),
    posts: structuredClone(SEED_POSTS),
    analytics: structuredClone(SEED_ANALYTICS),
    transactions: structuredClone(SEED_TRANSACTIONS),
  };
}

export function readDb(): LocalDatabaseSchema {
  try {
    if (!fs.existsSync(DB_FILE)) {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }
      const initial = getInitialData();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as LocalDatabaseSchema;
    if (!parsed.shops || parsed.shops.length === 0) {
      const initial = getInitialData();
      writeDb(initial);
      return initial;
    }
    return parsed;
  } catch (err) {
    console.error('Error reading local DB, falling back to seed data:', err);
    return getInitialData();
  }
}

export function writeDb(data: LocalDatabaseSchema): void {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing local DB:', err);
  }
}

export function resetDb(): LocalDatabaseSchema {
  const initial = getInitialData();
  writeDb(initial);
  return initial;
}

// ================= SHOP HELPERS =================

export function getAllShops(): Shop[] {
  const db = readDb();
  return db.shops;
}

export function getShopBySlug(slug: string): Shop | undefined {
  const db = readDb();
  return db.shops.find((s) => s.slug === slug);
}

export function getShopById(id: string): Shop | undefined {
  const db = readDb();
  return db.shops.find((s) => s.id === id);
}

export function getStorefrontBundle(slug: string) {
  const db = readDb();
  const shop = db.shops.find((s) => s.slug === slug);
  if (!shop) return null;

  const categories = db.categories
    .filter((c) => c.shop_id === shop.id && c.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const items = db.items
    .filter((i) => i.shop_id === shop.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const posts = db.posts
    .filter((p) => p.shop_id === shop.id && p.is_active)
    .sort((a, b) => (a.is_pinned === b.is_pinned ? 0 : a.is_pinned ? -1 : 1));

  return {
    shop,
    categories,
    items,
    posts,
    ownerPlan: db.profile.plan,
  };
}

export function updateShop(shopId: string, patch: Partial<Shop>): Shop | null {
  const db = readDb();
  const idx = db.shops.findIndex((s) => s.id === shopId);
  if (idx === -1) return null;

  if (patch.slug && patch.slug !== db.shops[idx].slug) {
    const exists = db.shops.some((s, i) => i !== idx && s.slug === patch.slug);
    if (exists) {
      throw new Error('SLUG_ALREADY_EXISTS: Đường dẫn (slug) này đã có cửa hàng sử dụng.');
    }
  }

  db.shops[idx] = { ...db.shops[idx], ...patch, id: shopId };
  writeDb(db);
  return db.shops[idx];
}

export function createShop(newShop: Omit<Shop, 'id' | 'owner_id'>): Shop {
  const db = readDb();
  let slug = newShop.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');

  if (!slug) slug = `shop-${Date.now()}`;
  if (db.shops.some((s) => s.slug === slug)) {
    slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
  }

  const created: Shop = {
    ...newShop,
    id: `shop-${Date.now()}`,
    owner_id: db.profile.id,
    slug,
  };
  db.shops.push(created);
  writeDb(db);
  return created;
}

// ================= CATEGORY & ITEM HELPERS =================

export function getShopCatalog(shopId: string) {
  const db = readDb();
  const shop = db.shops.find((s) => s.id === shopId) || db.shops[0];
  const categories = db.categories
    .filter((c) => c.shop_id === shop.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const items = db.items
    .filter((i) => i.shop_id === shop.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  return { shop, categories, items, profile: db.profile };
}

export function upsertCategory(category: Partial<Category> & { shop_id: string }): Category {
  const db = readDb();
  if (category.id) {
    const idx = db.categories.findIndex((c) => c.id === category.id);
    if (idx !== -1) {
      db.categories[idx] = { ...db.categories[idx], ...category };
      writeDb(db);
      return db.categories[idx];
    }
  }

  const shopCats = db.categories.filter((c) => c.shop_id === category.shop_id);
  const created: Category = {
    id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: category.shop_id,
    sort_order: category.sort_order ?? shopCats.length + 1,
    name_i18n: category.name_i18n || { vi: 'Danh mục mới', en: 'New Category' },
    is_active: category.is_active ?? true,
  };
  db.categories.push(created);
  writeDb(db);
  return created;
}

export function deleteCategory(categoryId: string): boolean {
  const db = readDb();
  const initialLen = db.categories.length;
  db.categories = db.categories.filter((c) => c.id !== categoryId);
  db.items = db.items.filter((i) => i.category_id !== categoryId);
  writeDb(db);
  return db.categories.length < initialLen;
}

export function upsertItem(
  item: Partial<CatalogItem> & { shop_id: string; category_id: string }
): CatalogItem {
  const db = readDb();

  if (item.id) {
    const idx = db.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      db.items[idx] = { ...db.items[idx], ...item };
      writeDb(db);
      return db.items[idx];
    }
  }

  // Enforce plan limits on new item creation (matching PostgreSQL trigger check_item_plan_limit)
  const currentShopItems = db.items.filter((i) => i.shop_id === item.shop_id);
  const check = canAddMoreItems(db.profile.plan, currentShopItems.length);
  if (!check.allowed) {
    throw new Error(check.reason || 'PLAN_LIMIT_REACHED');
  }

  const created: CatalogItem = {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: item.shop_id,
    category_id: item.category_id,
    sort_order: item.sort_order ?? currentShopItems.length + 1,
    price: Number(item.price ?? 0),
    compare_at_price: item.compare_at_price ?? null,
    unit_i18n: item.unit_i18n || {
      vi: 'phần',
      en: 'portion',
      ko: '인분',
      ja: '人前',
      zh: '份',
    },
    duration_mins: item.duration_mins ?? null,
    image_url: item.image_url || null,
    is_available: item.is_available ?? true,
    is_featured: item.is_featured ?? false,
    name_i18n: item.name_i18n || { vi: 'Món mới' },
    desc_i18n: item.desc_i18n || { vi: '' },
    options_json: item.options_json || [],
    view_count: item.view_count ?? 0,
  };

  db.items.push(created);
  writeDb(db);
  return created;
}

export function deleteItem(itemId: string): boolean {
  const db = readDb();
  const initialLen = db.items.length;
  db.items = db.items.filter((i) => i.id !== itemId);
  writeDb(db);
  return db.items.length < initialLen;
}

export function bulkImportCatalog(
  shopId: string,
  categoriesPayload: Array<{
    name_i18n: Category['name_i18n'];
    items: Array<{
      price: number;
      duration_mins?: number | null;
      name_i18n: CatalogItem['name_i18n'];
      desc_i18n: CatalogItem['desc_i18n'];
      image_url?: string | null;
    }>;
  }>
) {
  const db = readDb();
  const createdCategories: Category[] = [];
  const createdItems: CatalogItem[] = [];

  let catOrder = db.categories.filter((c) => c.shop_id === shopId).length + 1;
  let itemOrder = db.items.filter((i) => i.shop_id === shopId).length + 1;

  for (const catData of categoriesPayload) {
    const newCat: Category = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      shop_id: shopId,
      sort_order: catOrder++,
      name_i18n: catData.name_i18n,
      is_active: true,
    };
    db.categories.push(newCat);
    createdCategories.push(newCat);

    for (const itemData of catData.items) {
      const currentCount = db.items.filter((i) => i.shop_id === shopId).length;
      const limitCheck = canAddMoreItems(db.profile.plan, currentCount);
      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason);
      }

      const newItem: CatalogItem = {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        shop_id: shopId,
        category_id: newCat.id,
        sort_order: itemOrder++,
        price: Number(itemData.price || 0),
        duration_mins: itemData.duration_mins ?? null,
        unit_i18n: {
          vi: 'phần',
          en: 'portion',
          ko: '인분',
          ja: '人前',
          zh: '份',
        },
        image_url: itemData.image_url || null,
        is_available: true,
        is_featured: false,
        name_i18n: itemData.name_i18n,
        desc_i18n: itemData.desc_i18n,
        options_json: [],
        view_count: 0,
      };
      db.items.push(newItem);
      createdItems.push(newItem);
    }
  }

  writeDb(db);
  return { createdCategories, createdItems };
}

// ================= POSTS HELPERS =================

export function getShopPosts(shopId: string): Post[] {
  const db = readDb();
  return db.posts
    .filter((p) => p.shop_id === shopId)
    .sort((a, b) => (a.is_pinned === b.is_pinned ? 0 : a.is_pinned ? -1 : 1));
}

export function upsertPost(post: Partial<Post> & { shop_id: string }): Post {
  const db = readDb();
  if (post.id) {
    const idx = db.posts.findIndex((p) => p.id === post.id);
    if (idx !== -1) {
      db.posts[idx] = { ...db.posts[idx], ...post };
      writeDb(db);
      return db.posts[idx];
    }
  }

  const created: Post = {
    id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: post.shop_id,
    title_i18n: post.title_i18n || { vi: '' },
    content_i18n: post.content_i18n || { vi: '' },
    banner_url: post.banner_url || null,
    is_pinned: post.is_pinned ?? false,
    is_active: post.is_active ?? true,
    created_at: new Date().toISOString(),
  };
  db.posts.unshift(created);
  writeDb(db);
  return created;
}

export function deletePost(postId: string): boolean {
  const db = readDb();
  const initialLen = db.posts.length;
  db.posts = db.posts.filter((p) => p.id !== postId);
  writeDb(db);
  return db.posts.length < initialLen;
}

// ================= ANALYTICS & BILLING HELPERS =================

export function recordAnalyticsEvent(params: {
  shop_id: string;
  event_type: AnalyticsEventType;
  item_id?: string | null;
  visitor_lang?: SupportedLocale;
  user_agent?: string;
}): AnalyticsEvent {
  const db = readDb();
  const nextId = db.analytics.length > 0 ? Math.max(...db.analytics.map((a) => a.id)) + 1 : 1;
  const event: AnalyticsEvent = {
    id: nextId,
    shop_id: params.shop_id,
    event_type: params.event_type,
    item_id: params.item_id || null,
    visitor_lang: params.visitor_lang || 'vi',
    user_agent: params.user_agent,
    created_at: new Date().toISOString(),
  };
  db.analytics.unshift(event);

  if (params.event_type === 'item_view' && params.item_id) {
    const itemIdx = db.items.findIndex((i) => i.id === params.item_id);
    if (itemIdx !== -1) {
      db.items[itemIdx].view_count = (db.items[itemIdx].view_count || 0) + 1;
    }
  }

  writeDb(db);
  return event;
}

export function getShopAnalyticsSummary(shopId: string) {
  const db = readDb();
  const events = db.analytics.filter((e) => e.shop_id === shopId);
  const items = db.items.filter((i) => i.shop_id === shopId);

  const scanDoorCount = events.filter((e) => e.event_type === 'scan_door').length;
  const scanTableCount = events.filter((e) => e.event_type === 'scan_table').length;
  const showToStaffCount = events.filter((e) => e.event_type === 'show_to_staff').length;
  const wifiCopyCount = events.filter((e) => e.event_type === 'wifi_copy').length;

  const langCounts: Record<SupportedLocale, number> = {
    vi: 0,
    en: 0,
    ko: 0,
    ja: 0,
    zh: 0,
  };

  for (const ev of events) {
    if (langCounts[ev.visitor_lang] !== undefined) {
      langCounts[ev.visitor_lang]++;
    }
  }

  const totalEvents = events.length || 1;
  const langBreakdown = (Object.keys(langCounts) as SupportedLocale[]).map((lang) => ({
    lang,
    count: langCounts[lang],
    percentage: Math.round((langCounts[lang] / totalEvents) * 100),
  }));

  const topItems = [...items]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 5);

  return {
    scanDoorCount,
    scanTableCount,
    showToStaffCount,
    wifiCopyCount,
    totalScans: scanDoorCount + scanTableCount,
    langBreakdown,
    topItems,
    recentEvents: events.slice(0, 15),
  };
}

export function createPaymentOrder(targetPlan: PlanTier, amount: number): PaymentTransaction {
  const db = readDb();
  const orderCode = `QLAOK${targetPlan.toUpperCase().slice(0, 1)}${Math.floor(10000 + Math.random() * 90000)}`;
  const tx: PaymentTransaction = {
    id: `tx-${Date.now()}`,
    user_id: db.profile.id,
    order_code: orderCode,
    target_plan: targetPlan,
    amount,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  db.transactions.unshift(tx);
  writeDb(db);
  return tx;
}

export function completePaymentWebhook(orderCode: string, bankRefId?: string) {
  const db = readDb();
  const txIdx = db.transactions.findIndex(
    (t) => t.order_code.toUpperCase() === orderCode.toUpperCase()
  );

  if (txIdx !== -1) {
    db.transactions[txIdx].status = 'completed';
    db.transactions[txIdx].bank_ref_id = bankRefId || `FT${Date.now()}`;
    db.transactions[txIdx].completed_at = new Date().toISOString();
    db.profile.plan = db.transactions[txIdx].target_plan;
  } else {
    // Support direct plan upgrade simulation even without pre-existing orderCode
    const inferredPlan: PlanTier = orderCode.startsWith('QLAOKB') ? 'basic' : 'premium';
    const newTx: PaymentTransaction = {
      id: `tx-${Date.now()}`,
      user_id: db.profile.id,
      order_code: orderCode,
      target_plan: inferredPlan,
      amount: inferredPlan === 'basic' ? 39000 : 69000,
      status: 'completed',
      bank_ref_id: bankRefId || `FT${Date.now()}`,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };
    db.transactions.unshift(newTx);
    db.profile.plan = inferredPlan;
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  db.profile.plan_expires_at = expires.toISOString();

  writeDb(db);
  return {
    profile: db.profile,
    transactions: db.transactions,
  };
}

export function setProfilePlan(plan: PlanTier): Profile {
  const db = readDb();
  db.profile.plan = plan;
  writeDb(db);
  return db.profile;
}
