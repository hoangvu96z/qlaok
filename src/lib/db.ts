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
  ShopMembership,
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
import { ALL_LOCALES } from './i18n-helper';
import { smartFallbackTranslate } from './gemini';
import {
  ALL_SHOP_PERMISSIONS,
  dbGetUserShopMemberships,
} from './shop-permissions';
import {
  dbComputeShopRevenueAndInventoryStats,
  enrichItemsWithInventory,
  setItemStockMetadata,
} from './mpos-store';

let cachedAdminClient: SupabaseClient | null = null;
let cachedAdminClientKey = '';
let testDbClientOverride: SupabaseClient | null = null;
let seedingInProgress: Promise<{ ok: boolean; error?: string }> | null = null;

export function setSupabaseDbClientForTests(client: unknown | null): void {
  testDbClientOverride = (client as SupabaseClient | null) ?? null;
}

export function isSupabaseDbClientOverriddenForTests(): boolean {
  return testDbClientOverride !== null;
}

export function hasSupabaseServiceRoleKey(): boolean {
  if (testDbClientOverride) return true;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) return false;
  if (serviceKey.startsWith('sb_publishable_')) return false;

  const anonKey = (getSupabaseAnonKey() || '').trim();
  if (anonKey && serviceKey === anonKey) return false;

  const jwtParts = serviceKey.split('.');
  if (jwtParts.length === 3 && jwtParts[1]) {
    try {
      const payload = JSON.parse(
        Buffer.from(jwtParts[1], 'base64url').toString('utf8')
      ) as { role?: string };
      if (payload.role && payload.role !== 'service_role') {
        return false;
      }
    } catch {
      // non-JWT or opaque key
    }
  }
  return true;
}

export function getSupabaseDbClient(): SupabaseClient {
  if (testDbClientOverride) return testDbClientOverride;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    getSupabaseAnonKey() ||
    ''
  ).trim();

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment.'
    );
  }

  const cacheSignature = `${url}::${key}`;
  if (cachedAdminClient && cachedAdminClientKey === cacheSignature) {
    return cachedAdminClient;
  }

  const client = createSupabaseJsClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  cachedAdminClient = client;
  cachedAdminClientKey = cacheSignature;
  return cachedAdminClient;
}

/**
 * Creates a fresh, non-persistent Supabase client for public user Auth flows
 * (`signInWithPassword`, `signUp`, `getUser`) using the anon/publishable key when
 * available so user JWT sessions never contaminate the shared service-role DB client.
 */
export function createSupabasePublicAuthClient(): SupabaseClient {
  if (testDbClientOverride) return testDbClientOverride;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (
    getSupabaseAnonKey() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in environment.'
    );
  }

  return createSupabaseJsClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function requireSupabaseServiceRoleClient(
  contextLabel = 'Super Admin API'
): SupabaseClient {
  if (testDbClientOverride) return testDbClientOverride;
  if (!isSupabaseConfigured() && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(
      `SUPABASE_NOT_CONFIGURED: ${contextLabel} yêu cầu cấu hình NEXT_PUBLIC_SUPABASE_URL trên máy chủ.`
    );
  }
  if (!hasSupabaseServiceRoleKey()) {
    throw new Error(
      `MISSING_SERVICE_ROLE_KEY: ${contextLabel} yêu cầu cấu hình SUPABASE_SERVICE_ROLE_KEY hợp lệ trên máy chủ (sau migration bảo mật RLS 003–005, khóa anon/publishable không được phép truy vấn hoặc ghi dữ liệu quản trị toàn hệ thống).`
    );
  }
  return getSupabaseDbClient();
}

export function shouldAutoSeedDemoData(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Checks whether the Supabase schema (public.shops) has been created.
 * In local development/test environments, automatically seeds the 3 demo shops
 * if the tables exist and are empty. In production, never auto-seeds demo data
 * and returns `{ ready: true, seeded: false }` when `public.shops` is empty.
 */
export async function ensureSupabaseReadyAndSeeded(): Promise<{
  ready: boolean;
  seeded?: boolean;
  error?: string;
}> {
  if (!testDbClientOverride && !isSupabaseConfigured()) {
    return {
      ready: false,
      seeded: false,
      error: 'SUPABASE_NOT_CONFIGURED',
    };
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
        seeded: false,
        error: `${error.code || 'ERR'}: ${error.message}`,
      };
    }

    if (shops && shops.length > 0) {
      return { ready: true, seeded: true };
    }

    if (!shouldAutoSeedDemoData()) {
      return { ready: true, seeded: false };
    }

    if (!seedingInProgress) {
      seedingInProgress = (async () => {
        try {
          const seedSteps: Array<{
            table: string;
            run: () => PromiseLike<
              | { error?: { code?: string; message?: string } | null }
              | null
              | undefined
            >;
          }> = [
            {
              table: 'profiles',
              run: () =>
                sb
                  .from('profiles')
                  .upsert([SEED_PROFILE], { onConflict: 'id' }),
            },
            {
              table: 'shops',
              run: () =>
                sb.from('shops').upsert(SEED_SHOPS, { onConflict: 'id' }),
            },
            {
              table: 'categories',
              run: () =>
                sb
                  .from('categories')
                  .upsert(SEED_CATEGORIES, { onConflict: 'id' }),
            },
            {
              table: 'items',
              run: () =>
                sb.from('items').upsert(SEED_ITEMS, { onConflict: 'id' }),
            },
            {
              table: 'posts',
              run: () =>
                sb.from('posts').upsert(SEED_POSTS, { onConflict: 'id' }),
            },
            {
              table: 'payment_transactions',
              run: () =>
                sb
                  .from('payment_transactions')
                  .upsert(SEED_TRANSACTIONS, { onConflict: 'id' }),
            },
            {
              table: 'analytics_events',
              run: () => {
                const analyticsToInsert = SEED_ANALYTICS.map(
                  ({ id: _id, ...rest }) => rest
                );
                return sb
                  .from('analytics_events')
                  .insert(analyticsToInsert);
              },
            },
          ];

          for (const step of seedSteps) {
            const stepRes = await step.run();
            if (stepRes?.error) {
              const code = stepRes.error.code || 'SEED_WRITE_FAILED';
              const message =
                stepRes.error.message ||
                `Failed to write demo seed rows to ${step.table}.`;
              return {
                ok: false,
                error: `SEED_FAILED (${step.table}): ${code}: ${message}`,
              };
            }
          }

          return { ok: true };
        } catch (seedErr) {
          console.error('Supabase auto-seed error:', seedErr);
          const message =
            seedErr instanceof Error
              ? seedErr.message
              : 'Unknown Supabase seed error';
          return {
            ok: false,
            error: `SEED_FAILED: ${message}`,
          };
        } finally {
          seedingInProgress = null;
        }
      })();
    }

    const seedResult = await seedingInProgress;
    if (!seedResult.ok) {
      return {
        ready: false,
        seeded: false,
        error:
          seedResult.error || 'SEED_FAILED: Supabase demo seed failed.',
      };
    }

    return { ready: true, seeded: true };
  } catch (err) {
    return {
      ready: false,
      seeded: false,
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
    : ALL_LOCALES;

  // Ensure shops always support all 8 languages unless explicitly customized with >5 langs
  const nextLangs: SupportedLocale[] =
    currentLangs.length <= 5
      ? ALL_LOCALES
      : Array.from(new Set<SupportedLocale>([...currentLangs, ...ALL_LOCALES]));

  const shopName = rawShop.name || 'Cửa hàng';
  const taglineVi =
    rawShop.tagline_i18n?.vi ||
    seedMatch?.tagline_i18n?.vi ||
    `Chào mừng quý khách đến với ${shopName}`;
  const descVi =
    rawShop.description_i18n?.vi ||
    seedMatch?.description_i18n?.vi ||
    `Menu & Bảng giá đa ngôn ngữ chính thức của ${shopName}.`;

  const fallbackTagline = {
    vi: taglineVi,
    en: `Welcome to ${shopName} — Official Multi-language Menu`,
    ko: `${shopName}에 오신 것을 환영합니다 — 다국어 공식 메뉴`,
    ja: `${shopName}へようこそ — 多言語公式メニュー`,
    zh: `欢迎光临 ${shopName} — 多语言官方菜单`,
    es: `Bienvenido a ${shopName} — Menú oficial multilingüe`,
    it: `Benvenuti da ${shopName} — Menu ufficiale multilingue`,
    ru: `Добро пожаловать в ${shopName} — Официальное меню`,
  };

  const fallbackDesc = {
    vi: descVi,
    en: `Explore authentic products & services at ${shopName}. Order directly from your phone.`,
    ko: `${shopName}의 대표 메뉴와 가격표를 확인하고 스마트폰으로 바로 주문하세요.`,
    ja: `${shopName}のおすすめメニューと価格表。スマホから直接注文できます。`,
    zh: `浏览 ${shopName} 的精选商品与价格表，手机直接下单。`,
    es: `Explora los productos y precios de ${shopName}. Pide directamente desde tu móvil.`,
    it: `Scopri i prodotti e il listino prezzi di ${shopName}. Ordina direttamente dal telefono.`,
    ru: `Ознакомьтесь с меню и ценами ${shopName}. Заказывайте прямо со смартфона.`,
  };

  return {
    ...rawShop,
    supported_langs: nextLangs,
    tagline_i18n: {
      ...fallbackTagline,
      ...(seedMatch?.tagline_i18n || {}),
      ...(rawShop.tagline_i18n || {}),
    },
    description_i18n: {
      ...fallbackDesc,
      ...(seedMatch?.description_i18n || {}),
      ...(rawShop.description_i18n || {}),
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
  memberships?: Record<string, ShopMembership>;
  source: 'supabase';
}> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (ownerId) {
    const [
      { data: ownedShops, error: shopsErr },
      { data: ownerProfile },
      userMemberships,
    ] = await Promise.all([
      sb
        .from('shops')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true }),
      sb.from('profiles').select('*').eq('id', ownerId).maybeSingle(),
      dbGetUserShopMemberships(ownerId),
    ]);

    if (shopsErr) {
      throw new Error(shopsErr.message);
    }

    const shopMap = new Map<string, Shop>();
    const membershipsMap: Record<string, ShopMembership> = {};
    const nowIso = new Date().toISOString();

    for (const raw of (ownedShops || []) as Shop[]) {
      const hydrated = hydrateShopWithSeedDefaults(raw);
      shopMap.set(hydrated.id, hydrated);
      membershipsMap[hydrated.id] = {
        id: `mem-owner-${hydrated.id}-${ownerId}`,
        shop_id: hydrated.id,
        user_id: ownerId,
        role: 'owner',
        permissions: [...ALL_SHOP_PERMISSIONS],
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso,
      };
    }

    const extraShopIds = userMemberships
      .filter((m) => m.is_active && !shopMap.has(m.shop_id))
      .map((m) => m.shop_id);

    if (extraShopIds.length > 0) {
      const { data: memberShops } = await sb
        .from('shops')
        .select('*')
        .in('id', extraShopIds);

      for (const raw of (memberShops || []) as Shop[]) {
        const hydrated = hydrateShopWithSeedDefaults(raw);
        shopMap.set(hydrated.id, hydrated);
      }

      if (shouldAutoSeedDemoData()) {
        for (const sid of extraShopIds) {
          if (!shopMap.has(sid)) {
            const seedShop = SEED_SHOPS.find((s) => s.id === sid);
            if (seedShop) {
              shopMap.set(seedShop.id, hydrateShopWithSeedDefaults(seedShop));
            }
          }
        }
      }
    }

    for (const mem of userMemberships) {
      if (mem.is_active && shopMap.has(mem.shop_id)) {
        const shop = shopMap.get(mem.shop_id)!;
        if (shop.owner_id !== ownerId) {
          membershipsMap[mem.shop_id] = mem;
        }
      }
    }

    return {
      shops: Array.from(shopMap.values()),
      profile:
        (ownerProfile as Profile) || {
          ...SEED_PROFILE,
          id: ownerId,
          plan: 'free',
        },
      memberships: membershipsMap,
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
  if (!testDbClientOverride && !isSupabaseConfigured()) {
    const seedShop = SEED_SHOPS.find((s) => s.id === shopId);
    return seedShop ? hydrateShopWithSeedDefaults(seedShop) : undefined;
  }

  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const { data } = await sb.from('shops').select('*').eq('id', shopId).single();
  return data ? hydrateShopWithSeedDefaults(data as Shop) : undefined;
}

export async function dbGetStorefrontBundle(
  slug: string,
  options?: { allowUnpublished?: boolean; includePosts?: boolean }
) {
  const { dbGetPublicShopTables } = await import('@/lib/shop-tables');
  const shouldIncludePosts = options?.includePosts !== false;

  if (!testDbClientOverride && !isSupabaseConfigured()) {
    const seedShop = SEED_SHOPS.find((s) => s.slug === slug);
    if (!seedShop) return null;
    if (!options?.allowUnpublished && seedShop.is_published === false) {
      return null;
    }
    const shop = hydrateShopWithSeedDefaults(seedShop);
    const categories = SEED_CATEGORIES.filter(
      (c) => c.shop_id === shop.id && c.is_active
    );
    const items = SEED_ITEMS.filter((i) => i.shop_id === shop.id);
    const posts = shouldIncludePosts
      ? SEED_POSTS.filter((p) => p.shop_id === shop.id && p.is_active)
      : [];
    const tables = await dbGetPublicShopTables(shop.id);
    return {
      shop,
      categories,
      items: enrichItemsWithInventory(items),
      posts,
      tables,
      ownerPlan: 'premium' as PlanTier,
    };
  }

  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  let query = sb.from('shops').select('*').eq('slug', slug);
  if (!options?.allowUnpublished) {
    query = query.eq('is_published', true);
  }
  const { data: rawShop } = await query.maybeSingle();

  if (!rawShop) return null;
  if (!options?.allowUnpublished && rawShop.is_published === false) {
    return null;
  }
  const shop = hydrateShopWithSeedDefaults(rawShop as Shop);

  const [
    { data: categories },
    { data: items },
    postsRes,
    tables,
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
    shouldIncludePosts
      ? sb
          .from('posts')
          .select('*')
          .eq('shop_id', shop.id)
          .eq('is_active', true)
          .order('is_pinned', { ascending: false })
      : Promise.resolve({ data: [] as Post[] }),
    dbGetPublicShopTables(shop.id),
  ]);
  const posts = postsRes?.data;

  const normalizedCategories = ((categories || []) as Category[]).map((c) => {
    const seedCat = SEED_CATEGORIES.find((sc) => sc.id === c.id);
    const autoCat = smartFallbackTranslate({
      vertical: shop.vertical,
      categoryNameVi: c.name_i18n?.vi || 'Danh mục',
      itemNameVi: c.name_i18n?.vi || 'Danh mục',
    });
    return {
      ...c,
      name_i18n: {
        ...(autoCat.category_i18n || {}),
        ...(seedCat?.name_i18n || {}),
        ...(c.name_i18n || {}),
      },
    };
  });

  const normalizedItems = (items || []).map((i) => {
    const seedItem = SEED_ITEMS.find((si) => si.id === i.id);
    const autoItem = smartFallbackTranslate({
      vertical: shop.vertical,
      itemNameVi: i.name_i18n?.vi || 'Sản phẩm',
      itemDescVi: i.desc_i18n?.vi || '',
    });
    return {
      ...i,
      price: Number(i.price),
      compare_at_price:
        i.compare_at_price !== null && i.compare_at_price !== undefined
          ? Number(i.compare_at_price)
          : null,
      name_i18n: {
        ...autoItem.name_i18n,
        ...(seedItem?.name_i18n || {}),
        ...(i.name_i18n || {}),
      },
      desc_i18n: {
        ...autoItem.desc_i18n,
        ...(seedItem?.desc_i18n || {}),
        ...(i.desc_i18n || {}),
      },
      options_json:
        Array.isArray(i.options_json) && i.options_json.length > 0
          ? i.options_json
          : seedItem?.options_json || [],
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
    tables,
    ownerPlan: 'premium' as PlanTier,
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

const ALLOWED_SHOP_PATCH_FIELDS: Array<keyof Shop> = [
  'name',
  'slug',
  'vertical',
  'tagline_i18n',
  'description_i18n',
  'logo_url',
  'cover_urls',
  'address',
  'city',
  'google_maps_url',
  'google_review_url',
  'phone_contact',
  'zalo_phone',
  'telegram_chat_id',
  'wifi_info',
  'opening_hours',
  'supported_langs',
  'currency',
  'theme_config',
  'is_published',
];

export async function dbUpdateShop(
  shopId: string,
  patch: Partial<Shop>
): Promise<Shop | null> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  const sanitizedPatch: Record<string, unknown> = {};
  for (const key of ALLOWED_SHOP_PATCH_FIELDS) {
    if (patch[key] !== undefined) {
      sanitizedPatch[key] = patch[key];
    }
  }

  if (typeof sanitizedPatch.slug === 'string' && sanitizedPatch.slug) {
    const { data: duplicate } = await sb
      .from('shops')
      .select('id')
      .eq('slug', sanitizedPatch.slug)
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
    .update({ ...sanitizedPatch, updated_at: new Date().toISOString() })
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

  let shopQuery = sb.from('shops').select('*').order('created_at', { ascending: true });
  if (shopId) shopQuery = shopQuery.eq('id', shopId);
  const { data: shops } = await shopQuery.limit(1);
  const shop = shops?.[0] as Shop | undefined;

  if (!shop) {
    return {
      shop: SEED_SHOPS[0],
      categories: [],
      items: [],
      profile: SEED_PROFILE,
      ownerPlan: 'free' as PlanTier,
    };
  }

  const [{ data: categories }, { data: items }, { data: profiles }, ownerProfileRes] =
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
      (async () => {
        if (!shop.owner_id) return { data: null, error: null };
        try {
          return await sb
            .from('profiles')
            .select('plan')
            .eq('id', shop.owner_id)
            .maybeSingle();
        } catch (err) {
          return { data: null, error: err };
        }
      })(),
    ]);

  let ownerPlan: PlanTier = 'free';
  if (ownerProfileRes && !ownerProfileRes.error && ownerProfileRes.data) {
    const rawPlan = (ownerProfileRes.data as { plan?: unknown }).plan;
    if (rawPlan === 'basic' || rawPlan === 'premium') {
      ownerPlan = rawPlan;
    }
  }

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
    ownerPlan,
  };
}

export async function dbUpsertCategory(
  category: Partial<Category> & { shop_id: string }
): Promise<Category> {
  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  if (category.id) {
    const { data: target, error: lookupError } = await sb.from('categories')
      .select('shop_id').eq('id', category.id).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (target && target.shop_id !== category.shop_id) {
      throw new Error('CATEGORY_NOT_IN_SHOP: Không được chuyển danh mục giữa cửa hàng.');
    }
  }

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

  const { data: category, error: categoryError } = await sb.from('categories')
    .select('shop_id').eq('id', item.category_id).maybeSingle();
  if (categoryError) throw new Error(categoryError.message);
  if (!category || category.shop_id !== item.shop_id) {
    throw new Error('CATEGORY_NOT_IN_SHOP: Danh mục không thuộc cửa hàng.');
  }
  if (item.id) {
    const { data: target, error: lookupError } = await sb.from('items')
      .select('shop_id').eq('id', item.id).maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (target && target.shop_id !== item.shop_id) {
      throw new Error('ITEM_NOT_IN_SHOP: Không được chuyển món giữa cửa hàng.');
    }
  }

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

  const [{ count, error: countError }, { data: shop, error: shopError }] =
    await Promise.all([
      sb
        .from('items')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', item.shop_id),
      sb
        .from('shops')
        .select('owner_id')
        .eq('id', item.shop_id)
        .maybeSingle(),
    ]);

  if (shopError) throw new Error(shopError.message);
  if (!shop) {
    throw new Error('SHOP_NOT_FOUND: Cửa hàng không tồn tại.');
  }
  if (!shop.owner_id) {
    throw new Error('OWNER_PROFILE_NOT_FOUND: Không tìm thấy thông tin chủ cửa hàng.');
  }

  const { data: ownerProfile, error: profileError } = await sb
    .from('profiles')
    .select('plan')
    .eq('id', shop.owner_id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!ownerProfile) {
    throw new Error('OWNER_PROFILE_NOT_FOUND: Không tìm thấy thông tin chủ cửa hàng.');
  }

  if (countError) throw new Error(countError.message);

  const rawPlan = ownerProfile.plan;
  const currentPlan: PlanTier =
    rawPlan === 'basic' || rawPlan === 'premium' ? rawPlan : 'free';
  const check = canAddMoreItems(currentPlan, count || 0);
  if (!check.allowed) {
    throw new Error(check.reason || 'PLAN_LIMIT_REACHED');
  }

  const newItemId =
    item.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const payload: CatalogItem = {
    id: newItemId,
    ...(incomingStock !== undefined ? { stock_quantity: incomingStock } : {}),
    ...(incomingSold !== undefined ? { sold_count: incomingSold } : {}),
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
    id?: string;
    name_i18n: Category['name_i18n'];
    items: Array<{
      id?: string;
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
    const categoryId =
      typeof catData.id === 'string' && catData.id.trim()
        ? catData.id.trim()
        : undefined;
    const newCat = await dbUpsertCategory({
      ...(categoryId ? { id: categoryId } : {}),
      shop_id: shopId,
      name_i18n: catData.name_i18n,
      is_active: true,
    });
    createdCategories.push(newCat);

    for (const itemData of catData.items) {
      const itemId =
        typeof itemData.id === 'string' && itemData.id.trim()
          ? itemData.id.trim()
          : undefined;
      const newItem = await dbUpsertItem({
        ...(itemId ? { id: itemId } : {}),
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

  const resolvedShopId = targetShopId || SEED_SHOPS[0].id;
  const { dbGetPublicShopTables } = await import('@/lib/shop-tables');
  const [{ data: eventsData }, { data: itemsData }, publicTables] =
    await Promise.all([
      sb
        .from('analytics_events')
        .select('*')
        .eq('shop_id', resolvedShopId)
        .order('created_at', { ascending: false }),
      sb.from('items').select('*').eq('shop_id', resolvedShopId),
      dbGetPublicShopTables(resolvedShopId).catch(() => []),
    ]);

  const events = (eventsData || []) as AnalyticsEvent[];
  const rawItems = ((itemsData || []) as CatalogItem[]).map((i) => ({
    ...i,
    price: Number(i.price),
  }));
  const items = enrichItemsWithInventory(rawItems);
  const mposStats = await dbComputeShopRevenueAndInventoryStats(
    resolvedShopId,
    items
  );
  const activeTablesCount = Array.isArray(publicTables)
    ? publicTables.filter((t) => t && t.is_active && !t.is_archived).length
    : 0;

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
    totalCatalogItems: items.length,
    availableCatalogItems: items.filter((i) => i.is_available !== false).length,
    activeTablesCount,
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

export const OFFICIAL_PLAN_PRICES_VND: Record<'basic' | 'premium', number> = {
  basic: 39000,
  premium: 69000,
};

export async function dbCreatePaymentOrder(
  targetPlan: PlanTier,
  _ignoredClientAmount?: number,
  ownerId?: string
): Promise<PaymentTransaction> {
  if (targetPlan !== 'basic' && targetPlan !== 'premium') {
    throw new Error(
      'INVALID_TARGET_PLAN: Chỉ hỗ trợ tạo giao dịch nâng cấp cho gói Basic hoặc Premium.'
    );
  }

  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();
  const resolvedOwnerId = ownerId || SEED_PROFILE.id;
  // Server-authoritative plan price (never trusts client-supplied amount)
  const authoritativeAmount = OFFICIAL_PLAN_PRICES_VND[targetPlan];

  const orderCode = `QLAOK${targetPlan.toUpperCase().slice(0, 1)}${Math.floor(10000 + Math.random() * 90000)}`;
  const tx: PaymentTransaction = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    user_id: resolvedOwnerId,
    order_code: orderCode,
    target_plan: targetPlan,
    amount: authoritativeAmount,
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
  ownerId?: string,
  options?: { verifiedTransferAmount?: number }
) {
  const normalizedCode = (orderCode || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('MISSING_ORDER_CODE: Thiếu mã đơn thanh toán.');
  }

  let sb: ReturnType<typeof getSupabaseDbClient> | null = null;
  let existingTx: PaymentTransaction | null = null;

  try {
    await ensureSupabaseReadyAndSeeded();
    sb = getSupabaseDbClient();
    const { data } = await sb
      .from('payment_transactions')
      .select('*')
      .ilike('order_code', normalizedCode)
      .maybeSingle();
    existingTx = (data as PaymentTransaction | null) || null;
  } catch {
    existingTx =
      SEED_TRANSACTIONS.find(
        (tx) => tx.order_code.toUpperCase() === normalizedCode
      ) || null;
  }

  // P0 #5 Fix: Never fabricate a completed transaction when orderCode does not exist
  if (!existingTx) {
    throw new Error(
      `PAYMENT_ORDER_NOT_FOUND: Mã giao dịch "${normalizedCode}" không tồn tại trên hệ thống.`
    );
  }

  if (!sb) {
    await ensureSupabaseReadyAndSeeded();
    sb = getSupabaseDbClient();
  }

  const resolvedOwnerId = existingTx.user_id || ownerId || SEED_PROFILE.id;

  // P0 #5 Fix: Idempotent webhook retry — do NOT re-extend plan_expires_at if already completed
  if (existingTx.status === 'completed') {
    const billingData = await dbGetBillingData(resolvedOwnerId);
    return {
      ...billingData,
      alreadyCompleted: true,
    };
  }

  const requiredAmount = Number(existingTx.amount || 0);
  if (
    options?.verifiedTransferAmount !== undefined &&
    options.verifiedTransferAmount !== null
  ) {
    const paidAmount = Number(options.verifiedTransferAmount);
    if (!Number.isFinite(paidAmount) || paidAmount < requiredAmount) {
      throw new Error(
        `PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản (${paidAmount}) nhỏ hơn số tiền gói cước yêu cầu (${requiredAmount}).`
      );
    }
  }

  const nowIso = new Date().toISOString();
  const refId = (bankRefId || '').trim() || `FT-${existingTx.id}`;

  // Ensure bank_ref_id has not been used by another transaction
  if (bankRefId && bankRefId.trim()) {
    const { data: duplicateRef } = await sb
      .from('payment_transactions')
      .select('id, order_code')
      .eq('bank_ref_id', refId)
      .neq('id', existingTx.id)
      .maybeSingle();

    if (duplicateRef) {
      throw new Error(
        `DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "${refId}" đã được sử dụng cho giao dịch khác.`
      );
    }
  }

  const targetPlan = existingTx.target_plan as PlanTier;

  // Conditional atomic update from status='pending' -> 'completed'
  const { data: updatedTx, error: txUpdateErr } = await sb
    .from('payment_transactions')
    .update({
      status: 'completed',
      bank_ref_id: refId,
      completed_at: nowIso,
    })
    .eq('id', existingTx.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();

  if (txUpdateErr) {
    throw new Error(txUpdateErr.message);
  }

  if (!updatedTx) {
    const billingData = await dbGetBillingData(resolvedOwnerId);
    return {
      ...billingData,
      alreadyCompleted: true,
    };
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  const { error: profileErr } = await sb
    .from('profiles')
    .update({
      plan: targetPlan,
      plan_expires_at: expires.toISOString(),
      updated_at: nowIso,
    })
    .eq('id', resolvedOwnerId);

  if (profileErr) {
    throw new Error(profileErr.message);
  }

  const billingData = await dbGetBillingData(resolvedOwnerId);
  return {
    ...billingData,
    alreadyCompleted: false,
  };
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
