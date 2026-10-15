import { createClient as createSupabaseJsClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
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
import { getSupabaseAnonKey, isSupabaseConfigured } from './supabase/client';
import { canAddMoreItems } from './plan-limits';
import {
  computeShopRevenueAndInventoryStats,
  enrichItemsWithInventory,
  setItemStockMetadata,
} from './mpos-store';

let cachedAdminClient: SupabaseClient | null = null;
let seedingInProgress: Promise<boolean> | null = null;

export function getSupabaseDbClient(): SupabaseClient {
  if (cachedAdminClient) return cachedAdminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment.'
    );
  }

  cachedAdminClient = createSupabaseJsClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedAdminClient;
}

/**
 * Checks whether the Supabase schema (public.shops) has been created,
 * and automatically seeds the 3 demo shops if the tables exist and are empty.
 */
export async function ensureSupabaseReadyAndSeeded(): Promise<{
  ready: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { ready: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }

  const sb = getSupabaseDbClient();

  try {
    const { data: shops, error } = await sb
      .from('shops')
      .select('id')
      .limit(1);

    if (error) {
      return {
        ready: false,
        error: `${error.code || 'ERR'}: ${error.message}`,
      };
    }

    if (shops && shops.length > 0) {
      return { ready: true };
    }

    if (!seedingInProgress) {
      seedingInProgress = (async () => {
        try {
          await sb.from('profiles').upsert([SEED_PROFILE], { onConflict: 'id' });
          await sb.from('shops').upsert(SEED_SHOPS, { onConflict: 'id' });
          await sb.from('categories').upsert(SEED_CATEGORIES, { onConflict: 'id' });
          await sb.from('items').upsert(SEED_ITEMS, { onConflict: 'id' });
          await sb.from('posts').upsert(SEED_POSTS, { onConflict: 'id' });
          await sb
            .from('payment_transactions')
            .upsert(SEED_TRANSACTIONS, { onConflict: 'id' });

          const analyticsToInsert = SEED_ANALYTICS.map(({ id: _id, ...rest }) => rest);
          await sb.from('analytics_events').insert(analyticsToInsert);
          return true;
        } catch (seedErr) {
          console.error('Supabase auto-seed error:', seedErr);
          return false;
        } finally {
          seedingInProgress = null;
        }
      })();
    }

    await seedingInProgress;
    return { ready: true };
  } catch (err) {
    return {
      ready: false,
      error: err instanceof Error ? err.message : 'Unknown Supabase error',
    };
  }
}

// ================= SHOP HELPERS =================

function hydrateShopWithSeedDefaults(rawShop: Shop): Shop {
  const seedMatch = SEED_SHOPS.find(
    (s) => s.id === rawShop.id || s.slug === rawShop.slug
  );
  const currentLangs: SupportedLocale[] = Array.isArray(rawShop.supported_langs)
    ? rawShop.supported_langs
    : ['vi', 'en', 'ko', 'ja', 'zh'];

  // Upgrade legacy 5-lang shops to 8-lang automatically
  const hasBase5 = (['vi', 'en', 'ko', 'ja', 'zh'] as SupportedLocale[]).every(
    (l) => currentLangs.includes(l)
  );
  const nextLangs: SupportedLocale[] = hasBase5
    ? Array.from(
        new Set<SupportedLocale>([...currentLangs, 'es', 'it', 'ru'])
      )
    : currentLangs;

  return {
    ...rawShop,
    supported_langs: nextLangs,
    tagline_i18n: {
      ...(seedMatch?.tagline_i18n || {}),
      ...(rawShop.tagline_i18n || { vi: '' }),
    },
    description_i18n: {
      ...(seedMatch?.description_i18n || {}),
      ...(rawShop.description_i18n || { vi: '' }),
    },
    theme_config: {
      ...(seedMatch?.theme_config || { primaryColor: '#10b981', layout: 'list' }),
      ...(rawShop.theme_config || {}),
    },
  };
}

export async function dbGetAllShopsAndProfile(ownerId?: string): Promise<{
  shops: Shop[];
  profile: Profile;
  source: 'supabase';
}> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (ownerId) {
    const [{ data: shops, error: shopsErr }, { data: ownerProfile }] =
      await Promise.all([
        sb
          .from('shops')
          .select('*')
          .eq('owner_id', ownerId)
          .order('created_at', { ascending: true }),
        sb.from('profiles').select('*').eq('id', ownerId).maybeSingle(),
      ]);

    if (shopsErr) {
      throw new Error(shopsErr.message);
    }

    return {
      shops: ((shops || []) as Shop[]).map(hydrateShopWithSeedDefaults),
      profile:
        (ownerProfile as Profile) || {
          ...SEED_PROFILE,
          id: ownerId,
          plan: 'free',
        },
      source: 'supabase',
    };
  }

  const [{ data: shops, error: shopsErr }, { data: profiles }] =
    await Promise.all([
      sb.from('shops').select('*').order('created_at', { ascending: true }),
      sb.from('profiles').select('*').limit(1),
    ]);

  if (shopsErr) {
    throw new Error(shopsErr.message);
  }

  return {
    shops: ((shops || []) as Shop[]).map(hydrateShopWithSeedDefaults),
    profile: (profiles?.[0] as Profile) || SEED_PROFILE,
    source: 'supabase',
  };
}

export async function dbGetShopById(shopId: string): Promise<Shop | undefined> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data } = await sb.from('shops').select('*').eq('id', shopId).single();
  return data ? hydrateShopWithSeedDefaults(data as Shop) : undefined;
}

export async function dbGetStorefrontBundle(slug: string) {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data: rawShop } = await sb
    .from('shops')
    .select('*')
    .eq('slug', slug)
    .single();

  if (!rawShop) return null;
  const shop = hydrateShopWithSeedDefaults(rawShop as Shop);

  const [
    { data: categories },
    { data: items },
    { data: posts },
    { data: ownerProfile },
  ] = await Promise.all([
    sb
      .from('categories')
      .select('*')
      .eq('shop_id', shop.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    sb
      .from('items')
      .select('*')
      .eq('shop_id', shop.id)
      .order('sort_order', { ascending: true }),
    sb
      .from('posts')
      .select('*')
      .eq('shop_id', shop.id)
      .eq('is_active', true)
      .order('is_pinned', { ascending: false }),
    sb.from('profiles').select('plan').eq('id', shop.owner_id).single(),
  ]);

  const normalizedCategories = ((categories || []) as Category[]).map((c) => {
    const seedCat = SEED_CATEGORIES.find((sc) => sc.id === c.id);
    return seedCat
      ? { ...c, name_i18n: { ...seedCat.name_i18n, ...c.name_i18n } }
      : c;
  });

  const normalizedItems = (items || []).map((i) => {
    const seedItem = SEED_ITEMS.find((si) => si.id === i.id);
    return {
      ...i,
      price: Number(i.price),
      compare_at_price:
        i.compare_at_price !== null && i.compare_at_price !== undefined
          ? Number(i.compare_at_price)
          : null,
      name_i18n: seedItem
        ? { ...seedItem.name_i18n, ...i.name_i18n }
        : i.name_i18n,
      desc_i18n: seedItem
        ? { ...seedItem.desc_i18n, ...i.desc_i18n }
        : i.desc_i18n,
      options_json: seedItem?.options_json?.length
        ? seedItem.options_json
        : i.options_json,
    };
  }) as CatalogItem[];

  const normalizedPosts = ((posts || []) as Post[]).map((p) => {
    const seedPost = SEED_POSTS.find((sp) => sp.id === p.id);
    return seedPost
      ? {
          ...p,
          title_i18n: { ...seedPost.title_i18n, ...p.title_i18n },
          content_i18n: { ...seedPost.content_i18n, ...p.content_i18n },
        }
      : p;
  });

  return {
    shop,
    categories: normalizedCategories,
    items: enrichItemsWithInventory(normalizedItems),
    posts: normalizedPosts,
    ownerPlan: (ownerProfile?.plan as PlanTier) || 'premium',
  };
}

export async function dbCreateShop(
  newShop: Omit<Shop, 'id' | 'owner_id'> & { owner_id?: string },
  ownerId?: string
): Promise<Shop> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  let slug = newShop.slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
  if (!slug) slug = `shop-${Date.now()}`;

  const { data: existingSlug } = await sb
    .from('shops')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (existingSlug) {
    slug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
  }

  let resolvedOwnerId = ownerId || newShop.owner_id;
  if (!resolvedOwnerId) {
    const { data: profile } = await sb
      .from('profiles')
      .select('id')
      .limit(1)
      .single();
    resolvedOwnerId = profile?.id || SEED_PROFILE.id;
  } else {
    // Ensure owner profile exists in public.profiles to satisfy FK constraint
    const { data: existingOwner } = await sb
      .from('profiles')
      .select('id')
      .eq('id', resolvedOwnerId)
      .maybeSingle();

    if (!existingOwner) {
      await sb.from('profiles').upsert(
        {
          id: resolvedOwnerId,
          email: `${resolvedOwnerId}@qlaok.vn`,
          full_name: 'Chủ Quán Qlaok',
          plan: 'free',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }
  }

  const finalOwnerId: string = resolvedOwnerId || SEED_PROFILE.id;

  const payload: Shop = {
    ...newShop,
    id: `shop-${Date.now()}`,
    owner_id: finalOwnerId,
    slug,
  };

  const { data, error } = await sb
    .from('shops')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Shop;
}

export async function dbUpdateShop(
  shopId: string,
  patch: Partial<Shop>
): Promise<Shop | null> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (patch.slug) {
    const { data: duplicate } = await sb
      .from('shops')
      .select('id')
      .eq('slug', patch.slug)
      .neq('id', shopId)
      .maybeSingle();

    if (duplicate) {
      throw new Error(
        'SLUG_ALREADY_EXISTS: Đường dẫn (slug) này đã có cửa hàng sử dụng.'
      );
    }
  }

  const { data, error } = await sb
    .from('shops')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', shopId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Shop;
}

// ================= CATALOG HELPERS =================

export async function dbGetShopCatalog(shopId?: string) {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data: shops } = await sb
    .from('shops')
    .select('*')
    .order('created_at', { ascending: true });

  const shop =
    (shops || []).find((s) => s.id === shopId) || (shops?.[0] as Shop);

  if (!shop) {
    return {
      shop: SEED_SHOPS[0],
      categories: [],
      items: [],
      profile: SEED_PROFILE,
    };
  }

  const [{ data: categories }, { data: items }, { data: profiles }] =
    await Promise.all([
      sb
        .from('categories')
        .select('*')
        .eq('shop_id', shop.id)
        .order('sort_order', { ascending: true }),
      sb
        .from('items')
        .select('*')
        .eq('shop_id', shop.id)
        .order('sort_order', { ascending: true }),
      sb.from('profiles').select('*').limit(1),
    ]);

  const normalizedItems = (items || []).map((i) => ({
    ...i,
    price: Number(i.price),
    compare_at_price:
      i.compare_at_price !== null && i.compare_at_price !== undefined
        ? Number(i.compare_at_price)
        : null,
  })) as CatalogItem[];

  return {
    shop: shop as Shop,
    categories: (categories || []) as Category[],
    items: enrichItemsWithInventory(normalizedItems),
    profile: (profiles?.[0] as Profile) || SEED_PROFILE,
  };
}

export async function dbUpsertCategory(
  category: Partial<Category> & { shop_id: string }
): Promise<Category> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (category.id) {
    const { data, error } = await sb
      .from('categories')
      .update(category)
      .eq('id', category.id)
      .select('*')
      .single();
    if (!error && data) {
      return data as Category;
    }
  }

  const { count } = await sb
    .from('categories')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', category.shop_id);

  const payload: Category = {
    id:
      category.id ||
      `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: category.shop_id,
    sort_order: category.sort_order ?? (count || 0) + 1,
    name_i18n: category.name_i18n || {
      vi: 'Danh mục mới',
      en: 'New Category',
    },
    is_active: category.is_active ?? true,
  };

  const { data, error } = await sb
    .from('categories')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Category;
}

export async function dbDeleteCategory(categoryId: string): Promise<boolean> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { error } = await sb.from('categories').delete().eq('id', categoryId);
  return !error;
}

export async function dbUpsertItem(
  item: Partial<CatalogItem> & { shop_id: string; category_id: string }
): Promise<CatalogItem> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const {
    stock_quantity: incomingStock,
    sold_count: incomingSold,
    ...dbSafeItem
  } = item;

  if (item.id) {
    const { data: existing } = await sb
      .from('items')
      .select('id')
      .eq('id', item.id)
      .maybeSingle();

    if (existing) {
      if (incomingStock !== undefined || incomingSold !== undefined) {
        await setItemStockMetadata(item.id, incomingStock, incomingSold);
      }

      const nextAvailable =
        incomingStock === 0
          ? false
          : dbSafeItem.is_available !== undefined
            ? dbSafeItem.is_available
            : undefined;

      const { data, error } = await sb
        .from('items')
        .update({
          ...dbSafeItem,
          is_available: nextAvailable,
          price:
            dbSafeItem.price !== undefined ? Number(dbSafeItem.price) : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      const updated = { ...data, price: Number(data.price) } as CatalogItem;
      return enrichItemsWithInventory([updated])[0];
    }
  }

  const [{ count }, { data: profiles }] = await Promise.all([
    sb
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', item.shop_id),
    sb.from('profiles').select('plan').limit(1),
  ]);

  const currentPlan = (profiles?.[0]?.plan as PlanTier) || 'premium';
  const check = canAddMoreItems(currentPlan, count || 0);
  if (!check.allowed) {
    throw new Error(check.reason || 'PLAN_LIMIT_REACHED');
  }

  const newItemId =
    item.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const payload: CatalogItem = {
    id: newItemId,
    shop_id: item.shop_id,
    category_id: item.category_id,
    sort_order: item.sort_order ?? (count || 0) + 1,
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
    is_available: incomingStock === 0 ? false : (item.is_available ?? true),
    is_featured: item.is_featured ?? false,
    name_i18n: item.name_i18n || { vi: 'Món mới' },
    desc_i18n: item.desc_i18n || { vi: '' },
    options_json: item.options_json || [],
    view_count: item.view_count ?? 0,
  };

  if (incomingStock !== undefined || incomingSold !== undefined) {
    await setItemStockMetadata(newItemId, incomingStock, incomingSold);
  }

  const { data, error } = await sb
    .from('items')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  const created = { ...data, price: Number(data.price) } as CatalogItem;
  return enrichItemsWithInventory([created])[0];
}

export async function dbDeleteItem(itemId: string): Promise<boolean> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { error } = await sb.from('items').delete().eq('id', itemId);
  return !error;
}

export async function dbBulkImportCatalog(
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
  await ensureSupabaseReadyAndSeeded();

  const createdCategories: Category[] = [];
  const createdItems: CatalogItem[] = [];

  for (const catData of categoriesPayload) {
    const newCat = await dbUpsertCategory({
      shop_id: shopId,
      name_i18n: catData.name_i18n,
      is_active: true,
    });
    createdCategories.push(newCat);

    for (const itemData of catData.items) {
      const newItem = await dbUpsertItem({
        shop_id: shopId,
        category_id: newCat.id,
        price: Number(itemData.price || 0),
        duration_mins: itemData.duration_mins ?? null,
        image_url: itemData.image_url || null,
        name_i18n: itemData.name_i18n,
        desc_i18n: itemData.desc_i18n,
      });
      createdItems.push(newItem);
    }
  }

  return { createdCategories, createdItems };
}

// ================= POSTS HELPERS =================

export async function dbGetShopPosts(shopId?: string): Promise<Post[]> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  let targetShopId = shopId;
  if (!targetShopId) {
    const { data: firstShop } = await sb
      .from('shops')
      .select('id')
      .limit(1)
      .single();
    targetShopId = firstShop?.id;
  }

  if (!targetShopId) return [];

  const { data } = await sb
    .from('posts')
    .select('*')
    .eq('shop_id', targetShopId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  return (data || []) as Post[];
}

export async function dbUpsertPost(
  post: Partial<Post> & { shop_id: string }
): Promise<Post> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const payload: Post = {
    id:
      post.id ||
      `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: post.shop_id,
    title_i18n: post.title_i18n || { vi: '' },
    content_i18n: post.content_i18n || { vi: '' },
    banner_url: post.banner_url || null,
    is_pinned: post.is_pinned ?? false,
    is_active: post.is_active ?? true,
    created_at: post.created_at || new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('posts')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Post;
}

export async function dbDeletePost(postId: string): Promise<boolean> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { error } = await sb.from('posts').delete().eq('id', postId);
  return !error;
}

// ================= ANALYTICS & BILLING HELPERS =================

export async function dbRecordAnalyticsEvent(params: {
  shop_id: string;
  event_type: AnalyticsEventType;
  item_id?: string | null;
  visitor_lang?: SupportedLocale;
  user_agent?: string;
}): Promise<AnalyticsEvent> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data, error } = await sb
    .from('analytics_events')
    .insert({
      shop_id: params.shop_id,
      event_type: params.event_type,
      item_id: params.item_id || null,
      visitor_lang: params.visitor_lang || 'vi',
      user_agent: params.user_agent || 'unknown',
    })
    .select('*')
    .single();

  if (params.event_type === 'item_view' && params.item_id) {
    const { data: currentItem } = await sb
      .from('items')
      .select('view_count')
      .eq('id', params.item_id)
      .single();

    if (currentItem) {
      await sb
        .from('items')
        .update({ view_count: (currentItem.view_count || 0) + 1 })
        .eq('id', params.item_id);
    }
  }

  if (error) throw new Error(error.message);
  return data as AnalyticsEvent;
}

export async function dbGetShopAnalyticsSummary(shopId?: string) {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  let targetShopId = shopId;
  if (!targetShopId) {
    const { data: firstShop } = await sb
      .from('shops')
      .select('id')
      .limit(1)
      .single();
    targetShopId = firstShop?.id || SEED_SHOPS[0].id;
  }

  const [{ data: eventsData }, { data: itemsData }] = await Promise.all([
    sb
      .from('analytics_events')
      .select('*')
      .eq('shop_id', targetShopId)
      .order('created_at', { ascending: false }),
    sb.from('items').select('*').eq('shop_id', targetShopId),
  ]);

  const events = (eventsData || []) as AnalyticsEvent[];
  const rawItems = ((itemsData || []) as CatalogItem[]).map((i) => ({
    ...i,
    price: Number(i.price),
  }));
  const items = enrichItemsWithInventory(rawItems);
  const mposStats = computeShopRevenueAndInventoryStats(
    targetShopId || SEED_SHOPS[0].id,
    items
  );

  const scanDoorCount = events.filter(
    (e) => e.event_type === 'scan_door'
  ).length;
  const scanTableCount = events.filter(
    (e) => e.event_type === 'scan_table'
  ).length;
  const showToStaffCount = events.filter(
    (e) => e.event_type === 'show_to_staff'
  ).length;
  const wifiCopyCount = events.filter(
    (e) => e.event_type === 'wifi_copy'
  ).length;

  const langCounts: Record<SupportedLocale, number> = {
    vi: 0,
    en: 0,
    ko: 0,
    ja: 0,
    zh: 0,
    es: 0,
    it: 0,
    ru: 0,
  };

  for (const ev of events) {
    if (langCounts[ev.visitor_lang] !== undefined) {
      langCounts[ev.visitor_lang]++;
    }
  }

  const totalEvents = events.length || 1;
  const langBreakdown = (Object.keys(langCounts) as SupportedLocale[]).map(
    (lang) => ({
      lang,
      count: langCounts[lang],
      percentage: Math.round((langCounts[lang] / totalEvents) * 100),
    })
  );

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
    ...mposStats,
    mposStats,
    recentEvents: events.slice(0, 15),
  };
}

export async function dbGetBillingData(ownerId?: string) {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();
  const resolvedOwnerId = ownerId || SEED_PROFILE.id;

  const [{ data: ownerProfile }, { data: transactions }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', resolvedOwnerId).maybeSingle(),
    sb
      .from('payment_transactions')
      .select('*')
      .eq('user_id', resolvedOwnerId)
      .order('created_at', { ascending: false }),
  ]);

  return {
    profile: (ownerProfile as Profile) || SEED_PROFILE,
    transactions: (transactions || []).map((t) => ({
      ...t,
      amount: Number(t.amount),
    })) as PaymentTransaction[],
  };
}

export async function dbCreatePaymentOrder(
  targetPlan: PlanTier,
  amount: number,
  ownerId?: string
): Promise<PaymentTransaction> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();
  const resolvedOwnerId = ownerId || SEED_PROFILE.id;

  const orderCode = `QLAOK${targetPlan.toUpperCase().slice(0, 1)}${Math.floor(10000 + Math.random() * 90000)}`;
  const tx: PaymentTransaction = {
    id: `tx-${Date.now()}`,
    user_id: resolvedOwnerId,
    order_code: orderCode,
    target_plan: targetPlan,
    amount,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('payment_transactions')
    .insert(tx)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return { ...data, amount: Number(data.amount) } as PaymentTransaction;
}

export async function dbCompletePaymentWebhook(
  orderCode: string,
  bankRefId?: string,
  ownerId?: string
) {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data: existingTx } = await sb
    .from('payment_transactions')
    .select('*')
    .ilike('order_code', orderCode)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const refId = bankRefId || `FT${Date.now()}`;
  let targetPlan: PlanTier = 'premium';
  const resolvedOwnerId = existingTx?.user_id || ownerId || SEED_PROFILE.id;

  if (existingTx) {
    targetPlan = existingTx.target_plan as PlanTier;
    await sb
      .from('payment_transactions')
      .update({
        status: 'completed',
        bank_ref_id: refId,
        completed_at: nowIso,
      })
      .eq('id', existingTx.id);
  } else {
    targetPlan = orderCode.toUpperCase().startsWith('QLAOKB')
      ? 'basic'
      : 'premium';
    await sb.from('payment_transactions').insert({
      id: `tx-${Date.now()}`,
      user_id: resolvedOwnerId,
      order_code: orderCode,
      target_plan: targetPlan,
      amount: targetPlan === 'basic' ? 39000 : 69000,
      status: 'completed',
      bank_ref_id: refId,
      created_at: nowIso,
      completed_at: nowIso,
    });
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  await sb
    .from('profiles')
    .update({
      plan: targetPlan,
      plan_expires_at: expires.toISOString(),
      updated_at: nowIso,
    })
    .eq('id', resolvedOwnerId);

  return dbGetBillingData(resolvedOwnerId);
}

export async function dbSetProfilePlan(
  plan: PlanTier,
  ownerId?: string
): Promise<Profile> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();
  const resolvedOwnerId = ownerId || SEED_PROFILE.id;

  const { data, error } = await sb
    .from('profiles')
    .update({ plan, updated_at: new Date().toISOString() })
    .eq('id', resolvedOwnerId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Profile;
}
