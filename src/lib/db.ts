import { createClient as createSupabaseJsClient, SupabaseClient } from '@supabase/supabase-js';
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
import {
  bulkImportCatalog as localBulkImportCatalog,
  completePaymentWebhook as localCompletePaymentWebhook,
  createPaymentOrder as localCreatePaymentOrder,
  createShop as localCreateShop,
  deleteCategory as localDeleteCategory,
  deleteItem as localDeleteItem,
  deletePost as localDeletePost,
  getAllShops as localGetAllShops,
  getShopAnalyticsSummary as localGetShopAnalyticsSummary,
  getShopById as localGetShopById,
  getShopCatalog as localGetShopCatalog,
  getShopPosts as localGetShopPosts,
  getStorefrontBundle as localGetStorefrontBundle,
  readDb as localReadDb,
  recordAnalyticsEvent as localRecordAnalyticsEvent,
  setProfilePlan as localSetProfilePlan,
  updateShop as localUpdateShop,
  upsertCategory as localUpsertCategory,
  upsertItem as localUpsertItem,
  upsertPost as localUpsertPost,
} from './local-db';
import { getSupabaseAnonKey, isSupabaseConfigured } from './supabase/client';
import { canAddMoreItems } from './plan-limits';

let cachedAdminClient: SupabaseClient | null = null;
let seedingInProgress: Promise<boolean> | null = null;

export function getSupabaseDbClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cachedAdminClient) return cachedAdminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    getSupabaseAnonKey()!;

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
  const sb = getSupabaseDbClient();
  if (!sb) {
    return { ready: false, error: 'SUPABASE_NOT_CONFIGURED' };
  }

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

    // Table exists and is empty -> seed initial data once
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

export async function dbGetAllShopsAndProfile(): Promise<{
  shops: Shop[];
  profile: Profile;
  source: 'supabase' | 'local';
}> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const [{ data: shops }, { data: profiles }] = await Promise.all([
      sb.from('shops').select('*').order('created_at', { ascending: true }),
      sb.from('profiles').select('*').limit(1),
    ]);

    if (shops && shops.length > 0) {
      return {
        shops: shops as Shop[],
        profile: (profiles?.[0] as Profile) || SEED_PROFILE,
        source: 'supabase',
      };
    }
  }

  const local = localReadDb();
  return {
    shops: localGetAllShops(),
    profile: local.profile,
    source: 'local',
  };
}

export async function dbGetShopById(shopId: string): Promise<Shop | undefined> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { data } = await sb.from('shops').select('*').eq('id', shopId).single();
    if (data) return data as Shop;
  }

  return localGetShopById(shopId);
}

export async function dbGetStorefrontBundle(slug: string) {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { data: shop } = await sb
      .from('shops')
      .select('*')
      .eq('slug', slug)
      .single();

    if (!shop) return null;

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

    return {
      shop: shop as Shop,
      categories: (categories || []) as Category[],
      items: (items || []).map((i) => ({
        ...i,
        price: Number(i.price),
        compare_at_price:
          i.compare_at_price !== null && i.compare_at_price !== undefined
            ? Number(i.compare_at_price)
            : null,
      })) as CatalogItem[],
      posts: (posts || []) as Post[],
      ownerPlan: (ownerProfile?.plan as PlanTier) || 'premium',
    };
  }

  return localGetStorefrontBundle(slug);
}

export async function dbCreateShop(
  newShop: Omit<Shop, 'id' | 'owner_id'>
): Promise<Shop> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
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

    const { data: profile } = await sb.from('profiles').select('id').limit(1).single();
    const ownerId = profile?.id || SEED_PROFILE.id;

    const payload: Shop = {
      ...newShop,
      id: `shop-${Date.now()}`,
      owner_id: ownerId,
      slug,
    };

    const { data, error } = await sb
      .from('shops')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    localCreateShop(newShop);
    return data as Shop;
  }

  return localCreateShop(newShop);
}

export async function dbUpdateShop(
  shopId: string,
  patch: Partial<Shop>
): Promise<Shop | null> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
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
    localUpdateShop(shopId, patch);
    return data as Shop;
  }

  return localUpdateShop(shopId, patch);
}

// ================= CATALOG HELPERS =================

export async function dbGetShopCatalog(shopId?: string) {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { data: shops } = await sb
      .from('shops')
      .select('*')
      .order('created_at', { ascending: true });

    const shop =
      (shops || []).find((s) => s.id === shopId) || (shops?.[0] as Shop);

    if (shop) {
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

      return {
        shop: shop as Shop,
        categories: (categories || []) as Category[],
        items: (items || []).map((i) => ({
          ...i,
          price: Number(i.price),
          compare_at_price:
            i.compare_at_price !== null && i.compare_at_price !== undefined
              ? Number(i.compare_at_price)
              : null,
        })) as CatalogItem[],
        profile: (profiles?.[0] as Profile) || SEED_PROFILE,
      };
    }
  }

  const fallbackShopId = shopId || localReadDb().shops[0]?.id;
  return localGetShopCatalog(fallbackShopId);
}

export async function dbUpsertCategory(
  category: Partial<Category> & { shop_id: string }
): Promise<Category> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    if (category.id) {
      const { data, error } = await sb
        .from('categories')
        .update(category)
        .eq('id', category.id)
        .select('*')
        .single();
      if (!error && data) {
        localUpsertCategory(category);
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
    localUpsertCategory(payload);
    return data as Category;
  }

  return localUpsertCategory(category);
}

export async function dbDeleteCategory(categoryId: string): Promise<boolean> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { error } = await sb.from('categories').delete().eq('id', categoryId);
    localDeleteCategory(categoryId);
    return !error;
  }

  return localDeleteCategory(categoryId);
}

export async function dbUpsertItem(
  item: Partial<CatalogItem> & { shop_id: string; category_id: string }
): Promise<CatalogItem> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    if (item.id) {
      const { data: existing } = await sb
        .from('items')
        .select('id')
        .eq('id', item.id)
        .maybeSingle();

      if (existing) {
        const { data, error } = await sb
          .from('items')
          .update({
            ...item,
            price: item.price !== undefined ? Number(item.price) : undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .select('*')
          .single();

        if (error) throw new Error(error.message);
        localUpsertItem(item);
        return { ...data, price: Number(data.price) } as CatalogItem;
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

    const payload: CatalogItem = {
      id:
        item.id ||
        `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
      is_available: item.is_available ?? true,
      is_featured: item.is_featured ?? false,
      name_i18n: item.name_i18n || { vi: 'Món mới' },
      desc_i18n: item.desc_i18n || { vi: '' },
      options_json: item.options_json || [],
      view_count: item.view_count ?? 0,
    };

    const { data, error } = await sb
      .from('items')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    localUpsertItem(payload);
    return { ...data, price: Number(data.price) } as CatalogItem;
  }

  return localUpsertItem(item);
}

export async function dbDeleteItem(itemId: string): Promise<boolean> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { error } = await sb.from('items').delete().eq('id', itemId);
    localDeleteItem(itemId);
    return !error;
  }

  return localDeleteItem(itemId);
}

export async function dbBulkImportCatalog(
  shopId: string,
  categoriesPayload: Parameters<typeof localBulkImportCatalog>[1]
) {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
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

  return localBulkImportCatalog(shopId, categoriesPayload);
}

// ================= POSTS HELPERS =================

export async function dbGetShopPosts(shopId?: string): Promise<Post[]> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    let targetShopId = shopId;
    if (!targetShopId) {
      const { data: firstShop } = await sb
        .from('shops')
        .select('id')
        .limit(1)
        .single();
      targetShopId = firstShop?.id;
    }
    if (targetShopId) {
      const { data } = await sb
        .from('posts')
        .select('*')
        .eq('shop_id', targetShopId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (data) return data as Post[];
    }
  }

  const fallbackShopId = shopId || localReadDb().shops[0]?.id;
  return localGetShopPosts(fallbackShopId);
}

export async function dbUpsertPost(
  post: Partial<Post> & { shop_id: string }
): Promise<Post> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
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
    localUpsertPost(payload);
    return data as Post;
  }

  return localUpsertPost(post);
}

export async function dbDeletePost(postId: string): Promise<boolean> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { error } = await sb.from('posts').delete().eq('id', postId);
    localDeletePost(postId);
    return !error;
  }

  return localDeletePost(postId);
}

// ================= ANALYTICS & BILLING HELPERS =================

export async function dbRecordAnalyticsEvent(params: {
  shop_id: string;
  event_type: AnalyticsEventType;
  item_id?: string | null;
  visitor_lang?: SupportedLocale;
  user_agent?: string;
}): Promise<AnalyticsEvent> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
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

    localRecordAnalyticsEvent(params);
    if (!error && data) return data as AnalyticsEvent;
  }

  return localRecordAnalyticsEvent(params);
}

export async function dbGetShopAnalyticsSummary(shopId?: string) {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    let targetShopId = shopId;
    if (!targetShopId) {
      const { data: firstShop } = await sb
        .from('shops')
        .select('id')
        .limit(1)
        .single();
      targetShopId = firstShop?.id;
    }

    if (targetShopId) {
      const [{ data: eventsData }, { data: itemsData }] = await Promise.all([
        sb
          .from('analytics_events')
          .select('*')
          .eq('shop_id', targetShopId)
          .order('created_at', { ascending: false }),
        sb.from('items').select('*').eq('shop_id', targetShopId),
      ]);

      const events = (eventsData || []) as AnalyticsEvent[];
      const items = (itemsData || []) as CatalogItem[];

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
        recentEvents: events.slice(0, 15),
      };
    }
  }

  const fallbackShopId = shopId || localReadDb().shops[0]?.id;
  return localGetShopAnalyticsSummary(fallbackShopId);
}

export async function dbGetBillingData() {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const [{ data: profiles }, { data: transactions }] = await Promise.all([
      sb.from('profiles').select('*').limit(1),
      sb
        .from('payment_transactions')
        .select('*')
        .order('created_at', { ascending: false }),
    ]);

    return {
      profile: (profiles?.[0] as Profile) || SEED_PROFILE,
      transactions: (transactions || []).map((t) => ({
        ...t,
        amount: Number(t.amount),
      })) as PaymentTransaction[],
    };
  }

  const local = localReadDb();
  return {
    profile: local.profile,
    transactions: local.transactions,
  };
}

export async function dbCreatePaymentOrder(
  targetPlan: PlanTier,
  amount: number
): Promise<PaymentTransaction> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const orderCode = `QLAOK${targetPlan.toUpperCase().slice(0, 1)}${Math.floor(10000 + Math.random() * 90000)}`;
    const tx: PaymentTransaction = {
      id: `tx-${Date.now()}`,
      user_id: SEED_PROFILE.id,
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

    localCreatePaymentOrder(targetPlan, amount);
    if (!error && data) {
      return { ...data, amount: Number(data.amount) } as PaymentTransaction;
    }
  }

  return localCreatePaymentOrder(targetPlan, amount);
}

export async function dbCompletePaymentWebhook(
  orderCode: string,
  bankRefId?: string
) {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { data: existingTx } = await sb
      .from('payment_transactions')
      .select('*')
      .ilike('order_code', orderCode)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const refId = bankRefId || `FT${Date.now()}`;
    let targetPlan: PlanTier = 'premium';

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
        user_id: SEED_PROFILE.id,
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
      .eq('id', SEED_PROFILE.id);

    localCompletePaymentWebhook(orderCode, bankRefId);
    return dbGetBillingData();
  }

  return localCompletePaymentWebhook(orderCode, bankRefId);
}

export async function dbSetProfilePlan(plan: PlanTier): Promise<Profile> {
  const status = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (status.ready && sb) {
    const { data } = await sb
      .from('profiles')
      .update({ plan, updated_at: new Date().toISOString() })
      .eq('id', SEED_PROFILE.id)
      .select('*')
      .single();

    localSetProfilePlan(plan);
    if (data) return data as Profile;
  }

  return localSetProfilePlan(plan);
}
