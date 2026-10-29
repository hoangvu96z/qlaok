import { createClient as createSupabaseJsClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  CatalogItem,
  Category,
  I18nText,
  PaymentTransaction,
  PlanTier,
  Post,
  Profile,
  Shop,
  ShopMembership,
  ShopSlugAlias,
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
  syncLocalItemStockOnly,
} from './mpos-store';
import {
  parseCatalogPriceValue,
  parseCatalogStockValue,
} from './catalog-excel';

let cachedAdminClient: SupabaseClient | null = null;
let cachedAdminClientKey = '';
let testDbClientOverride: SupabaseClient | null = null;
let seedingInProgress: Promise<{ ok: boolean; error?: string }> | null = null;
const READY_SEEDED_CACHE_MS = 60_000;
let readySeededCache: { client: SupabaseClient; expiresAt: number } | null = null;
let readySeededInFlight: {
  client: SupabaseClient;
  promise: Promise<{ ready: boolean; seeded?: boolean; error?: string }>;
} | null = null;
const inMemoryShopSlugAliases = new Map<string, string>(); // normalizedSlug -> shopId

export function dbClearShopSlugAliasesForTests(): void {
  inMemoryShopSlugAliases.clear();
}

export function setSupabaseDbClientForTests(client: unknown | null): void {
  testDbClientOverride = (client as SupabaseClient | null) ?? null;
  readySeededCache = null;
  readySeededInFlight = null;
  inMemoryShopSlugAliases.clear();
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

  if (readySeededCache?.client === sb && readySeededCache.expiresAt > Date.now()) {
    return { ready: true, seeded: true };
  }
  if (readySeededInFlight?.client === sb) {
    return readySeededInFlight.promise;
  }

  const verification = (async () => {
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
  })();

  readySeededInFlight = { client: sb, promise: verification };
  try {
    const result = await verification;
    if (readySeededInFlight?.promise === verification && result.ready && result.seeded) {
      readySeededCache = { client: sb, expiresAt: Date.now() + READY_SEEDED_CACHE_MS };
    }
    return result;
  } finally {
    if (readySeededInFlight?.promise === verification) {
      readySeededInFlight = null;
    }
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
    opening_hours_confirmed: Boolean(rawShop.opening_hours_confirmed === true),
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
  if (!testDbClientOverride && !isSupabaseConfigured()) {
    if (ownerId) {
      const ownedShops = SEED_SHOPS.filter((s) => s.owner_id === ownerId);
      const ownerProfile = ownerId === SEED_PROFILE.id ? SEED_PROFILE : null;
      const userMemberships = await dbGetUserShopMemberships(ownerId);
      const shopMap = new Map<string, Shop>();
      const membershipsMap: Record<string, ShopMembership> = {};
      const nowIso = new Date().toISOString();

      for (const raw of ownedShops) {
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

      for (const mem of userMemberships) {
        if (!mem.is_active) continue;
        if (!shopMap.has(mem.shop_id)) {
          const seedShop = SEED_SHOPS.find((s) => s.id === mem.shop_id);
          if (seedShop) {
            shopMap.set(seedShop.id, hydrateShopWithSeedDefaults(seedShop));
          }
        }
        if (shopMap.has(mem.shop_id)) {
          const shop = shopMap.get(mem.shop_id)!;
          if (shop.owner_id !== ownerId) {
            membershipsMap[mem.shop_id] = mem;
          }
        }
      }

      const primaryMembership = userMemberships.find((m) => m.is_active);
      const fallbackProfile: Profile = primaryMembership
        ? {
            id: ownerId,
            email: primaryMembership.email || '',
            ...(primaryMembership.username
              ? { username: primaryMembership.username }
              : {}),
            ...(primaryMembership.username || ownerId.startsWith('staff-acct-')
              ? {
                  shop_id: primaryMembership.shop_id,
                  account_type: 'staff' as const,
                }
              : {}),
            full_name:
              primaryMembership.full_name ||
              primaryMembership.username ||
              primaryMembership.email ||
              'Nhân viên',
            plan: 'free',
            role: primaryMembership.role,
          }
        : {
            ...SEED_PROFILE,
            id: ownerId,
            plan: 'free',
          };

      return {
        shops: Array.from(shopMap.values()),
        profile: ownerProfile || fallbackProfile,
        memberships: membershipsMap,
        source: 'supabase',
      };
    }

    return {
      shops: SEED_SHOPS.map(hydrateShopWithSeedDefaults),
      profile: SEED_PROFILE,
      source: 'supabase',
    };
  }

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

    const primaryMembership = userMemberships.find((m) => m.is_active);
    const fallbackProfile: Profile = primaryMembership
      ? {
          id: ownerId,
          email: primaryMembership.email || '',
          ...(primaryMembership.username
            ? { username: primaryMembership.username }
            : {}),
          ...(primaryMembership.username || ownerId.startsWith('staff-acct-')
            ? {
                shop_id: primaryMembership.shop_id,
                account_type: 'staff' as const,
              }
            : {}),
          full_name:
            primaryMembership.full_name ||
            primaryMembership.username ||
            primaryMembership.email ||
            'Nhân viên',
          plan: 'free',
          role: primaryMembership.role,
        }
      : {
          ...SEED_PROFILE,
          id: ownerId,
          plan: 'free',
        };

    return {
      shops: Array.from(shopMap.values()),
      profile: (ownerProfile as Profile) || fallbackProfile,
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

function normalizeShopSlugValue(slug: unknown): string {
  return typeof slug === 'string' ? slug.trim().toLowerCase() : '';
}

function isIgnorableSlugAliasTableError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : String(err ?? '');
  return (
    /unexpected table/i.test(msg) ||
    (/shop_slug_aliases/i.test(msg) &&
      /does not exist|not found|schema cache|relation/i.test(msg))
  );
}

async function queryShopSlugAliasOwner(
  sb: SupabaseClient | null,
  slug: string
): Promise<string | null> {
  const normalized = normalizeShopSlugValue(slug);
  if (!normalized) return null;

  if (sb) {
    try {
      const tableRef = sb.from('shop_slug_aliases') as unknown as {
        select?: (cols: string) => {
          eq?: (
            col: string,
            val: string
          ) => {
            maybeSingle?: () => Promise<{
              data?: { shop_id?: string } | null;
              error?: { message?: string } | null;
            }>;
            single?: () => Promise<{
              data?: { shop_id?: string } | null;
              error?: { message?: string } | null;
            }>;
          };
        };
      };
      const eqChain = tableRef?.select?.('slug, shop_id')?.eq?.('slug', normalized);
      const fetchFn = eqChain?.maybeSingle ?? eqChain?.single;
      if (typeof fetchFn === 'function') {
        const res = await fetchFn.call(eqChain);
        if (res?.error) {
          if (!isIgnorableSlugAliasTableError(res.error)) {
            throw new Error(String(res.error.message || 'SLUG_ALIAS_LOOKUP_FAILED'));
          }
        } else if (
          res?.data &&
          typeof res.data.shop_id === 'string' &&
          res.data.shop_id.trim()
        ) {
          const ownerShopId = res.data.shop_id.trim();
          inMemoryShopSlugAliases.set(normalized, ownerShopId);
          return ownerShopId;
        }
      }
    } catch (err) {
      if (!isIgnorableSlugAliasTableError(err)) {
        throw err;
      }
    }
  }

  return inMemoryShopSlugAliases.get(normalized) ?? null;
}

async function recordShopSlugAlias(
  sb: SupabaseClient | null,
  shopId: string,
  previousSlug: string,
  nextSlug: string
): Promise<void> {
  const normalizedPrev = normalizeShopSlugValue(previousSlug);
  const normalizedNext = normalizeShopSlugValue(nextSlug);
  if (!shopId || !normalizedPrev || !normalizedNext || normalizedPrev === normalizedNext) {
    return;
  }

  // If the shop is reverting to one of its own former slugs, remove that slug from aliases
  if (inMemoryShopSlugAliases.get(normalizedNext) === shopId) {
    inMemoryShopSlugAliases.delete(normalizedNext);
  }

  if (sb) {
    try {
      const deleteTable = sb.from('shop_slug_aliases') as unknown as {
        delete?: () => {
          eq?: (
            col: string,
            val: string
          ) => {
            eq?: (
              col2: string,
              val2: string
            ) => Promise<{ error?: { message?: string } | null }>;
          } & PromiseLike<{ error?: { message?: string } | null }>;
        };
      };
      const firstEq = deleteTable?.delete?.()?.eq?.('slug', normalizedNext);
      if (firstEq) {
        if (typeof firstEq.eq === 'function') {
          await firstEq.eq('shop_id', shopId);
        } else if (typeof (firstEq as PromiseLike<unknown>).then === 'function') {
          await firstEq;
        }
      }
    } catch (err) {
      if (!isIgnorableSlugAliasTableError(err)) {
        throw err;
      }
    }

    try {
      const upsertTable = sb.from('shop_slug_aliases') as unknown as {
        upsert?: (
          payload: Record<string, unknown>,
          opts?: { onConflict?: string }
        ) => Promise<{ error?: { message?: string } | null }>;
      };
      if (typeof upsertTable?.upsert === 'function') {
        const nowIso = new Date().toISOString();
        const res = await upsertTable.upsert(
          {
            slug: normalizedPrev,
            shop_id: shopId,
            updated_at: nowIso,
          },
          { onConflict: 'slug' }
        );
        if (res?.error && !isIgnorableSlugAliasTableError(res.error)) {
          throw new Error(String(res.error.message || 'SLUG_ALIAS_PERSIST_FAILED'));
        }
      }
    } catch (err) {
      if (!isIgnorableSlugAliasTableError(err)) {
        throw err;
      }
    }
  }

  inMemoryShopSlugAliases.set(normalizedPrev, shopId);
}

export async function dbDeleteShopSlugAliases(
  shopId: string,
  sbClient?: SupabaseClient
): Promise<void> {
  const cleanShopId = (shopId ?? '').trim();
  if (!cleanShopId) return;

  for (const [aliasSlug, ownerId] of inMemoryShopSlugAliases.entries()) {
    if (ownerId === cleanShopId) {
      inMemoryShopSlugAliases.delete(aliasSlug);
    }
  }

  const sb =
    sbClient ??
    (testDbClientOverride || isSupabaseConfigured() ? getSupabaseDbClient() : null);
  if (!sb) return;

  try {
    const deleteTable = sb.from('shop_slug_aliases') as unknown as {
      delete?: () => {
        eq?: (
          col: string,
          val: string
        ) => Promise<{ error?: { message?: string } | null }>;
      };
    };
    const deleteChain = deleteTable?.delete?.()?.eq?.('shop_id', cleanShopId);
    if (deleteChain && typeof deleteChain.then === 'function') {
      const res = await deleteChain;
      if (res?.error && !isIgnorableSlugAliasTableError(res.error)) {
        throw new Error(String(res.error.message));
      }
    }
  } catch (err) {
    if (!isIgnorableSlugAliasTableError(err)) {
      throw err;
    }
  }
}

export async function dbGetShopSlugAliases(
  shopId?: string
): Promise<ShopSlugAlias[]> {
  const cleanShopId = (shopId ?? '').trim();
  const merged = new Map<string, ShopSlugAlias>();

  for (const [slug, ownerShopId] of inMemoryShopSlugAliases.entries()) {
    if (!cleanShopId || ownerShopId === cleanShopId) {
      merged.set(slug, { slug, shop_id: ownerShopId });
    }
  }

  if (testDbClientOverride || isSupabaseConfigured()) {
    const sb = getSupabaseDbClient();
    try {
      let query = sb.from('shop_slug_aliases').select('*');
      if (cleanShopId && typeof query.eq === 'function') {
        query = query.eq('shop_id', cleanShopId);
      }
      const res = await query;
      if (res?.error) {
        if (!isIgnorableSlugAliasTableError(res.error)) {
          throw new Error(res.error.message);
        }
      } else if (Array.isArray(res?.data)) {
        for (const row of res.data as ShopSlugAlias[]) {
          const norm = normalizeShopSlugValue(row.slug);
          if (norm && row.shop_id) {
            merged.set(norm, { ...row, slug: norm });
          }
        }
      }
    } catch (err) {
      if (!isIgnorableSlugAliasTableError(err)) {
        throw err;
      }
    }
  }

  return Array.from(merged.values());
}

export async function dbGetStorefrontBundle(
  slug: string,
  options?: {
    allowUnpublished?: boolean;
    allowedUnpublishedShopIds?: string[];
    includePosts?: boolean;
  }
) {
  const { dbGetPublicShopTables } = await import('@/lib/shop-tables');
  const shouldIncludePosts = options?.includePosts !== false;
  const normalizedSlug = normalizeShopSlugValue(slug);
  if (!normalizedSlug) return null;

  const allowedShopIds = new Set(
    (options?.allowedUnpublishedShopIds || [])
      .map((id) => (id ?? '').trim())
      .filter(Boolean)
  );
  const canViewShop = (candidate: { id: string; is_published?: boolean | null }) =>
    candidate.is_published !== false ||
    Boolean(options?.allowUnpublished) ||
    allowedShopIds.has(candidate.id);

  if (!testDbClientOverride && !isSupabaseConfigured()) {
    let seedShop = SEED_SHOPS.find(
      (s) => normalizeShopSlugValue(s.slug) === normalizedSlug
    );
    if (!seedShop) {
      const aliasedShopId = inMemoryShopSlugAliases.get(normalizedSlug);
      if (aliasedShopId) {
        seedShop = SEED_SHOPS.find((s) => s.id === aliasedShopId);
      }
    }
    if (!seedShop) return null;
    if (!canViewShop(seedShop)) {
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

  // 1. Canonical lookup first (never let an alias shadow a current canonical slug)
  const canonicalQuery = sb.from('shops').select('*').eq('slug', normalizedSlug);
  const { data: canonicalShop } =
    typeof canonicalQuery.maybeSingle === 'function'
      ? await canonicalQuery.maybeSingle()
      : await canonicalQuery.single();

  let rawShop = (canonicalShop as Shop | null) ?? null;

  // 2. If no shop currently owns normalizedSlug as its canonical slug, resolve via shop_slug_aliases
  if (!rawShop) {
    const aliasedShopId = await queryShopSlugAliasOwner(sb, normalizedSlug);
    if (aliasedShopId) {
      const aliasShopQuery = sb.from('shops').select('*').eq('id', aliasedShopId);
      const { data: aliasedShop } =
        typeof aliasShopQuery.maybeSingle === 'function'
          ? await aliasShopQuery.maybeSingle()
          : await aliasShopQuery.single();
      rawShop = (aliasedShop as Shop | null) ?? null;
    }
  }

  if (!rawShop) return null;
  if (!canViewShop(rawShop)) {
    return null;
  }
  const shop = hydrateShopWithSeedDefaults(rawShop as Shop);

  const [
    { data: categories },
    { data: items },
    postsRes,
    tables,
    ownerProfileRes,
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
    (async () => {
      if (!shop.owner_id) return { data: null, error: null };
      try {
        const query = sb
          .from('profiles')
          .select('plan')
          .eq('id', shop.owner_id);
        const fetchFn =
          typeof query.maybeSingle === 'function'
            ? query.maybeSingle
            : typeof query.single === 'function'
              ? query.single
              : undefined;
        if (typeof fetchFn === 'function') {
          return await fetchFn.call(query);
        }
        return { data: null, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    })(),
  ]);
  const posts = postsRes?.data;

  let ownerPlan: PlanTier = 'free';
  if (ownerProfileRes && !ownerProfileRes.error && ownerProfileRes.data) {
    const rawPlan = (ownerProfileRes.data as { plan?: unknown }).plan;
    if (rawPlan === 'basic' || rawPlan === 'premium') {
      ownerPlan = rawPlan;
    }
  }

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
    ownerPlan,
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
  const existingAliasOwner = await queryShopSlugAliasOwner(sb, slug);

  if (existingSlug || existingAliasOwner) {
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
    opening_hours_confirmed: Boolean(newShop.opening_hours_confirmed === true),
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
  'opening_hours_confirmed',
  'supported_langs',
  'currency',
  'theme_config',
  'is_published',
];

export async function dbUpdateShop(
  shopId: string,
  patch: Partial<Shop>,
  options?: {
    allowOwnerIdPatch?: boolean;
    sbClient?: SupabaseClient;
    skipEnsureSeeded?: boolean;
  }
): Promise<Shop | null> {
  if (!options?.skipEnsureSeeded) {
    await ensureSupabaseReadyAndSeeded();
  }
  const sb = options?.sbClient ?? getSupabaseDbClient();

  const sanitizedPatch: Record<string, unknown> = {};
  for (const key of ALLOWED_SHOP_PATCH_FIELDS) {
    if (patch[key] !== undefined) {
      sanitizedPatch[key] = patch[key];
    }
  }
  if (options?.allowOwnerIdPatch && patch.owner_id !== undefined) {
    sanitizedPatch.owner_id = patch.owner_id;
  }

  let previousSlug = '';
  let nextSlug = '';

  if (sanitizedPatch.slug !== undefined) {
    nextSlug = normalizeShopSlugValue(sanitizedPatch.slug);
    if (!nextSlug) {
      throw new Error(
        'INVALID_SHOP_SLUG: Đường dẫn cửa hàng (slug) không hợp lệ.'
      );
    }
    sanitizedPatch.slug = nextSlug;

    const { data: duplicate } = await sb
      .from('shops')
      .select('id')
      .eq('slug', nextSlug)
      .neq('id', shopId)
      .maybeSingle();

    if (duplicate) {
      throw new Error(
        'SLUG_ALREADY_EXISTS: Đường dẫn (slug) này đã có cửa hàng sử dụng.'
      );
    }

    const aliasOwnerShopId = await queryShopSlugAliasOwner(sb, nextSlug);
    if (aliasOwnerShopId && aliasOwnerShopId !== shopId) {
      throw new Error(
        'SLUG_ALREADY_EXISTS: Đường dẫn (slug) này đã được bảo lưu từ mã QR cũ của cửa hàng khác.'
      );
    }

    try {
      const currentShopQuery = sb
        .from('shops')
        .select('id, slug')
        .eq('id', shopId) as unknown as {
        maybeSingle?: () => Promise<{ data?: { slug?: string } | null }>;
        single?: () => Promise<{ data?: { slug?: string } | null }>;
      };
      const fetchCurrent =
        currentShopQuery?.maybeSingle ?? currentShopQuery?.single;
      if (typeof fetchCurrent === 'function') {
        const currentRes = await fetchCurrent.call(currentShopQuery);
        if (currentRes?.data && typeof currentRes.data.slug === 'string') {
          previousSlug = normalizeShopSlugValue(currentRes.data.slug);
        }
      }
    } catch {
      // Fallback handled below if mock does not support select('id, slug').eq('id', shopId)
    }

    if (!previousSlug) {
      const seedMatch = SEED_SHOPS.find((s) => s.id === shopId);
      if (seedMatch) {
        previousSlug = normalizeShopSlugValue(seedMatch.slug);
      }
    }
  }

  const { data, error } = await sb
    .from('shops')
    .update({ ...sanitizedPatch, updated_at: new Date().toISOString() })
    .eq('id', shopId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  if (!data) return null;
  const updated = data as Shop;

  if (nextSlug && previousSlug && previousSlug !== nextSlug) {
    await recordShopSlugAlias(sb, shopId, previousSlug, nextSlug);
  }

  return {
    ...updated,
    opening_hours_confirmed: Boolean(updated.opening_hours_confirmed === true),
  };
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

function applyItemFilter<T>(query: T, column: string, value: unknown): T {
  const q = query as Record<string, unknown>;
  if (value === null && typeof q.is === 'function') {
    return (q.is as (col: string, val: null) => T)(column, null);
  }
  if (typeof q.eq === 'function') {
    return (q.eq as (col: string, val: unknown) => T)(column, value);
  }
  return query;
}

function applyNonZeroStockFilter<T>(query: T): T {
  const q = query as Record<string, unknown>;
  if (typeof q.or === 'function') {
    return (q.or as (filters: string) => T)(
      'stock_quantity.is.null,stock_quantity.gt.0'
    );
  }
  return query;
}

export async function dbUpsertItem(
  item: Partial<CatalogItem> & {
    shop_id: string;
    category_id: string;
    expected_stock_quantity?: number | null;
    expectedStockQuantity?: number | null;
  }
): Promise<CatalogItem> {
  let validatedPrice: number | undefined = undefined;
  if (item.price !== undefined) {
    const parsedPrice = parseCatalogPriceValue(item.price);
    if (!parsedPrice.valid) {
      throw new Error(`INVALID_ITEM_PRICE: ${parsedPrice.error}`);
    }
    validatedPrice = parsedPrice.price;
  }

  const {
    stock_quantity: rawIncomingStock,
    sold_count: _ignoredSoldCount,
    view_count: _ignoredViewCount,
    created_at: _ignoredCreatedAt,
    updated_at: _ignoredUpdatedAt,
    expected_stock_quantity: rawExpectedStockSnake,
    expectedStockQuantity: rawExpectedStockCamel,
    ...dbSafeItem
  } = item as Partial<CatalogItem> & {
    shop_id: string;
    category_id: string;
    expected_stock_quantity?: unknown;
    expectedStockQuantity?: unknown;
    updated_at?: unknown;
  };

  let validatedStock: number | null | undefined = undefined;
  if (rawIncomingStock !== undefined) {
    const parsedStock = parseCatalogStockValue(rawIncomingStock);
    if (!parsedStock.valid) {
      throw new Error(`INVALID_STOCK_QUANTITY: ${parsedStock.error}`);
    }
    validatedStock = parsedStock.stock;
  }

  const hasExpectedStock =
    (Object.prototype.hasOwnProperty.call(item, 'expected_stock_quantity') &&
      rawExpectedStockSnake !== undefined) ||
    (Object.prototype.hasOwnProperty.call(item, 'expectedStockQuantity') &&
      rawExpectedStockCamel !== undefined);
  const rawExpectedStock =
    Object.prototype.hasOwnProperty.call(item, 'expected_stock_quantity') &&
    rawExpectedStockSnake !== undefined
      ? rawExpectedStockSnake
      : rawExpectedStockCamel;

  let validatedExpectedStock: number | null | undefined = undefined;
  if (hasExpectedStock) {
    const parsedExpected = parseCatalogStockValue(rawExpectedStock);
    if (!parsedExpected.valid) {
      throw new Error(
        `INVALID_EXPECTED_STOCK_QUANTITY: ${parsedExpected.error}`
      );
    }
    validatedExpectedStock = parsedExpected.stock;
  }

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

  if (item.id) {
    const { data: existing } = await sb
      .from('items')
      .select('id, stock_quantity, sold_count, is_available')
      .eq('id', item.id)
      .maybeSingle();

    if (existing) {
      const effectiveStock =
        validatedStock !== undefined ? validatedStock : existing.stock_quantity;
      const nextAvailable =
        effectiveStock === 0
          ? false
          : dbSafeItem.is_available !== undefined
            ? Boolean(dbSafeItem.is_available)
            : validatedStock !== undefined &&
                validatedStock !== null &&
                validatedStock > 0
              ? true
              : undefined;

      const updatePatch: Record<string, unknown> = {
        ...dbSafeItem,
        updated_at: new Date().toISOString(),
      };
      if (validatedStock !== undefined) {
        updatePatch.stock_quantity = validatedStock;
      } else {
        delete updatePatch.stock_quantity;
      }
      delete updatePatch.sold_count;
      delete updatePatch.view_count;
      if (nextAvailable !== undefined) {
        updatePatch.is_available = nextAvailable;
      } else {
        delete updatePatch.is_available;
      }
      if (validatedPrice !== undefined) {
        updatePatch.price = validatedPrice;
      } else {
        delete updatePatch.price;
      }

      const currentExistingStock =
        existing.stock_quantity === undefined ? null : existing.stock_quantity;
      if (validatedStock !== undefined) {
        if (!hasExpectedStock) {
          throw new Error(
            'STOCK_CONFLICT: Thiếu thông tin tồn kho đối chiếu (expected_stock_quantity). Vui lòng tải lại dữ liệu mới nhất trước khi cập nhật tồn kho.'
          );
        }
        const casExpectedStock = validatedExpectedStock ?? null;
        if (casExpectedStock !== currentExistingStock) {
          throw new Error(
            'STOCK_CONFLICT: Tồn kho của món đã thay đổi do có đơn hàng hoặc cập nhật khác. Vui lòng tải lại dữ liệu mới nhất trước khi chỉnh sửa tồn kho.'
          );
        }
      }

      let updateQuery = sb
        .from('items')
        .update(updatePatch)
        .eq('id', item.id);

      if (typeof (updateQuery as { eq?: unknown }).eq === 'function') {
        updateQuery = applyItemFilter(updateQuery, 'shop_id', item.shop_id);
        if (validatedStock !== undefined) {
          updateQuery = applyItemFilter(
            updateQuery,
            'stock_quantity',
            validatedExpectedStock ?? null
          );
        } else if (nextAvailable === true) {
          updateQuery = applyNonZeroStockFilter(updateQuery);
        }
      }

      let { data, error } = await updateQuery.select('*').single();

      const isNoRowMatchResult = (
        row: unknown,
        err: { code?: string; message?: string } | null | undefined
      ): boolean =>
        (!err && !row) ||
        Boolean(
          err &&
            (err.code === 'PGRST116' ||
              /row not found|no rows|0 rows|multiple \(or no\) rows/i.test(
                err.message || ''
              ))
        );

      const isNoRowMatchError = isNoRowMatchResult(
        data,
        error as { code?: string; message?: string } | null
      );

      if (validatedStock !== undefined && isNoRowMatchError) {
        throw new Error(
          'STOCK_CONFLICT: Tồn kho của món đã thay đổi do có đơn hàng hoặc cập nhật khác. Vui lòng tải lại dữ liệu mới nhất trước khi chỉnh sửa tồn kho.'
        );
      }

      if (
        validatedStock === undefined &&
        nextAvailable === true &&
        isNoRowMatchError
      ) {
        const { data: currentRow, error: currentLookupError } = await sb
          .from('items')
          .select('*')
          .eq('id', item.id)
          .maybeSingle();
        if (currentLookupError) {
          throw new Error(currentLookupError.message);
        }
        if (!currentRow || currentRow.shop_id !== item.shop_id) {
          throw new Error('ITEM_NOT_FOUND: Không tìm thấy món cần cập nhật.');
        }
        if (currentRow.stock_quantity === 0) {
          const zeroStockPatch: Record<string, unknown> = {
            ...updatePatch,
            is_available: false,
          };
          let zeroStockQuery = sb
            .from('items')
            .update(zeroStockPatch)
            .eq('id', item.id);
          if (typeof (zeroStockQuery as { eq?: unknown }).eq === 'function') {
            zeroStockQuery = applyItemFilter(
              zeroStockQuery,
              'shop_id',
              item.shop_id
            );
            zeroStockQuery = applyItemFilter(
              zeroStockQuery,
              'stock_quantity',
              0
            );
          }
          const { data: zeroStockData, error: zeroStockError } =
            await zeroStockQuery.select('*').single();
          if (zeroStockData && !zeroStockError) {
            data = zeroStockData;
            error = null;
          } else if (
            isNoRowMatchResult(
              zeroStockData,
              zeroStockError as { code?: string; message?: string } | null
            )
          ) {
            throw new Error(
              'STOCK_CONFLICT: Tồn kho đã thay đổi. Vui lòng tải lại và thử lại.'
            );
          } else {
            throw new Error(
              zeroStockError?.message ||
                'Không thể cập nhật món khi tồn kho bằng 0.'
            );
          }
        } else {
          throw new Error(
            'STOCK_CONFLICT: Tồn kho đã thay đổi. Vui lòng tải lại và thử lại.'
          );
        }
      }

      if (error) throw new Error(error.message);
      if (!data) {
        throw new Error('ITEM_NOT_FOUND: Không tìm thấy món cần cập nhật.');
      }

      if (validatedStock !== undefined) {
        const authoritativeSoldCount =
          typeof (data as { sold_count?: unknown }).sold_count === 'number'
            ? ((data as { sold_count: number }).sold_count)
            : typeof existing.sold_count === 'number'
              ? existing.sold_count
              : 0;
        syncLocalItemStockOnly(
          item.id,
          validatedStock,
          authoritativeSoldCount
        );
      }

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
    ...(validatedStock !== undefined ? { stock_quantity: validatedStock } : {}),
    sold_count: 0,
    shop_id: item.shop_id,
    category_id: item.category_id,
    sort_order: item.sort_order ?? (count || 0) + 1,
    price: validatedPrice ?? 0,
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
    is_available: validatedStock === 0 ? false : (item.is_available ?? true),
    is_featured: item.is_featured ?? false,
    name_i18n: item.name_i18n || { vi: 'Món mới' },
    desc_i18n: item.desc_i18n || { vi: '' },
    options_json: item.options_json || [],
    view_count: 0,
  };

  const { data, error } = await sb
    .from('items')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  if (validatedStock !== undefined) {
    syncLocalItemStockOnly(newItemId, validatedStock);
  }
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
  if (!Array.isArray(categoriesPayload)) {
    throw new Error(
      'INVALID_CATEGORIES_PAYLOAD: Danh sách danh mục nhập hàng loạt không hợp lệ.'
    );
  }

  const normalizedCategories = categoriesPayload.map((catData) => {
    if (
      !catData ||
      typeof catData !== 'object' ||
      !Array.isArray(catData.items)
    ) {
      throw new Error(
        'INVALID_CATEGORIES_PAYLOAD: Danh sách món trong danh mục nhập hàng loạt không hợp lệ.'
      );
    }

    const normalizedItems = catData.items.map((itemData) => {
      if (!itemData || typeof itemData !== 'object') {
        throw new Error(
          'INVALID_ITEM_PRICE: Dữ liệu món nhập hàng loạt không hợp lệ.'
        );
      }
      const parsedPrice = parseCatalogPriceValue(itemData.price);
      if (!parsedPrice.valid) {
        throw new Error(`INVALID_ITEM_PRICE: ${parsedPrice.error}`);
      }
      return {
        ...itemData,
        price: parsedPrice.price,
      };
    });

    return {
      ...catData,
      items: normalizedItems,
    };
  });

  await ensureSupabaseReadyAndSeeded();

  const createdCategories: Category[] = [];
  const createdItems: CatalogItem[] = [];

  for (const catData of normalizedCategories) {
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
        price: itemData.price,
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

  const { data: shop, error: shopError } = await sb
    .from('shops')
    .select('id, is_published')
    .eq('id', params.shop_id)
    .maybeSingle();
  if (shopError) throw new Error('ANALYTICS_SHOP_LOOKUP_FAILED', { cause: shopError });
  if (!shop || shop.is_published === false) {
    throw new Error('SHOP_NOT_TRACKABLE');
  }

  const itemId = params.item_id?.trim() || null;
  if (params.event_type === 'item_view') {
    if (!itemId) throw new Error('ITEM_NOT_IN_SHOP');
    const { data: item, error: itemError } = await sb
      .from('items')
      .select('id')
      .eq('id', itemId)
      .eq('shop_id', params.shop_id)
      .maybeSingle();
    if (itemError) throw new Error('ANALYTICS_ITEM_LOOKUP_FAILED', { cause: itemError });
    if (!item) throw new Error('ITEM_NOT_IN_SHOP');
  }

  const { data, error } = await sb
    .from('analytics_events')
    .insert({
      shop_id: params.shop_id,
      event_type: params.event_type,
      item_id: itemId,
      visitor_lang: params.visitor_lang || 'vi',
      user_agent: params.user_agent || 'unknown',
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  if (params.event_type === 'item_view' && itemId) {
    const { error: incrementError } = await sb.rpc(
      'increment_item_view_count',
      { p_shop_id: params.shop_id, p_item_id: itemId }
    );
    if (incrementError) {
      throw new Error('ANALYTICS_VIEW_COUNT_UPDATE_FAILED', {
        cause: incrementError,
      });
    }
  }
  return data as AnalyticsEvent;
}

export const ANALYTICS_SUMMARY_EVENT_SELECT_COLUMNS =
  'id,shop_id,event_type,item_id,visitor_lang,created_at';

export const ANALYTICS_SUMMARY_ITEM_SELECT_COLUMNS =
  'id,name_i18n,price,is_available,view_count,stock_quantity,sold_count';

export interface ShopAnalyticsItemSummary {
  id: string;
  name_vi: string;
  name_i18n: I18nText;
  price: number;
  is_available: boolean;
  view_count: number;
  stock_quantity: number | null;
  sold_count: number;
}

export interface ShopAnalyticsRecentEvent {
  id: number;
  shop_id: string;
  event_type: AnalyticsEventType;
  item_id?: string | null;
  visitor_lang: SupportedLocale;
  created_at: string;
}

function projectAnalyticsItemSummary(
  item: Partial<CatalogItem>
): ShopAnalyticsItemSummary {
  const nameI18n: I18nText =
    item.name_i18n && typeof item.name_i18n === 'object'
      ? item.name_i18n
      : { vi: '' };
  return {
    id: String(item.id || ''),
    name_vi: nameI18n.vi || 'Món',
    name_i18n: nameI18n,
    price: Number(item.price || 0),
    is_available: item.is_available !== false,
    view_count: Number(item.view_count || 0),
    stock_quantity:
      item.stock_quantity === undefined || item.stock_quantity === null
        ? null
        : Number(item.stock_quantity),
    sold_count: Number(item.sold_count || 0),
  };
}

function projectAnalyticsEventSummary(
  ev: AnalyticsEvent
): ShopAnalyticsRecentEvent {
  return {
    id: ev.id,
    shop_id: ev.shop_id,
    event_type: ev.event_type,
    ...(ev.item_id !== undefined ? { item_id: ev.item_id } : {}),
    visitor_lang: ev.visitor_lang,
    created_at: ev.created_at,
  };
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
        .select(ANALYTICS_SUMMARY_EVENT_SELECT_COLUMNS)
        .eq('shop_id', resolvedShopId)
        .order('created_at', { ascending: false }),
      sb
        .from('items')
        .select(ANALYTICS_SUMMARY_ITEM_SELECT_COLUMNS)
        .eq('shop_id', resolvedShopId),
      dbGetPublicShopTables(resolvedShopId).catch(() => []),
    ]);

  const events = ((eventsData || []) as AnalyticsEvent[]).map(
    projectAnalyticsEventSummary
  );
  const rawItems = ((itemsData || []) as CatalogItem[]).map(
    (i) =>
      ({
        id: i.id,
        name_i18n: i.name_i18n,
        price: Number(i.price),
        is_available: i.is_available,
        view_count: Number(i.view_count || 0),
        ...(i.stock_quantity !== undefined
          ? { stock_quantity: i.stock_quantity }
          : {}),
        ...(i.sold_count !== undefined ? { sold_count: i.sold_count } : {}),
      }) as CatalogItem
  );
  const items = enrichItemsWithInventory(rawItems).map(
    projectAnalyticsItemSummary
  );
  const rawMposStats = await dbComputeShopRevenueAndInventoryStats(
    resolvedShopId,
    items as unknown as CatalogItem[]
  );
  const projectedLowStockItems = rawMposStats.lowStockItems.map(
    projectAnalyticsItemSummary
  );
  const projectedTopSellingItems = rawMposStats.topSellingItems.map((item) => ({
    ...projectAnalyticsItemSummary(item),
    name_vi: item.name_vi || item.name_i18n?.vi || 'Món',
    sold_count: Number(item.sold_count || 0),
    stock_quantity:
      item.stock_quantity === undefined ? null : item.stock_quantity,
    revenue: Number(item.revenue || 0),
    estimated_revenue: Number(
      item.estimated_revenue ?? item.revenue ?? 0
    ),
  }));
  const mposStats = {
    ...rawMposStats,
    lowStockItems: projectedLowStockItems,
    topSellingItems: projectedTopSellingItems,
  };
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

export interface DbCompletePaymentWebhookOptions {
  verifiedTransferAmount?: number | null;
  allowUnverifiedAmount?: boolean;
}

export async function dbCompletePaymentWebhook(
  orderCode: string,
  bankRefId?: string,
  optionsOrLegacyOwner?: string | DbCompletePaymentWebhookOptions,
  legacyOptions?: DbCompletePaymentWebhookOptions
) {
  const options: DbCompletePaymentWebhookOptions | undefined =
    typeof optionsOrLegacyOwner === 'object' && optionsOrLegacyOwner !== null
      ? optionsOrLegacyOwner
      : typeof legacyOptions === 'object' && legacyOptions !== null
        ? legacyOptions
        : undefined;

  const normalizedCode = (orderCode || '').trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('MISSING_ORDER_CODE: Thiếu mã đơn thanh toán.');
  }

  await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();
  const { data, error } = await sb
    .from('payment_transactions')
    .select('*')
    .ilike('order_code', normalizedCode)
    .maybeSingle();

  if (error) {
    throw new Error(`DB_PAYMENT_LOOKUP_FAILED: ${error.message}`);
  }

  const existingTx = (data as PaymentTransaction | null) || null;

  // P0 #5 Fix: Never fabricate a completed transaction when orderCode does not exist
  if (!existingTx) {
    throw new Error(
      `PAYMENT_ORDER_NOT_FOUND: Mã giao dịch "${normalizedCode}" không tồn tại trên hệ thống.`
    );
  }

  const safeFallbackBankRef = `FT-${normalizedCode}`.slice(0, 100);
  const refId = (bankRefId || '').trim() || safeFallbackBankRef;

  const verifiedAmount =
    options?.verifiedTransferAmount !== undefined &&
    options.verifiedTransferAmount !== null
      ? Number(options.verifiedTransferAmount)
      : null;

  const allowUnverifiedAmount = Boolean(options?.allowUnverifiedAmount);

  // Execute atomic payment completion and profile upgrade via Postgres RPC (migration 015)
  if (typeof sb.rpc !== 'function') {
    throw new Error(
      'DB_RPC_UNAVAILABLE: complete_payment_webhook_atomic is not available on database client.'
    );
  }

  const { data: rpcData, error: rpcError } = await sb.rpc(
    'complete_payment_webhook_atomic',
    {
      p_order_code: normalizedCode,
      p_bank_ref_id: refId,
      p_verified_transfer_amount: verifiedAmount,
      p_allow_unverified_amount: allowUnverifiedAmount,
    }
  );

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  let rpcResult: Record<string, unknown> | null = null;
  if (typeof rpcData === 'string') {
    try {
      rpcResult = JSON.parse(rpcData) as Record<string, unknown>;
    } catch {
      throw new Error(
        'DB_RPC_INVALID_RESPONSE: Phản hồi không hợp lệ từ complete_payment_webhook_atomic.'
      );
    }
  } else if (rpcData && typeof rpcData === 'object') {
    rpcResult = rpcData as Record<string, unknown>;
  }

  if (!rpcResult || typeof rpcResult !== 'object') {
    throw new Error(
      'DB_RPC_INVALID_RESPONSE: Phản hồi không hợp lệ từ complete_payment_webhook_atomic.'
    );
  }

  if (
    rpcResult.status !== 'completed' &&
    rpcResult.status !== 'already_completed'
  ) {
    throw new Error(
      'DB_RPC_INVALID_RESPONSE: Trạng thái phản hồi RPC không hợp lệ từ complete_payment_webhook_atomic.'
    );
  }

  if (
    typeof rpcResult.owner_id !== 'string' ||
    !rpcResult.owner_id.trim()
  ) {
    throw new Error(
      'DB_RPC_INVALID_RESPONSE: Thiếu owner_id hợp lệ từ complete_payment_webhook_atomic.'
    );
  }

  const resolvedOwnerId = rpcResult.owner_id.trim();

  if (existingTx.user_id && resolvedOwnerId !== existingTx.user_id) {
    throw new Error(
      'DB_RPC_INVALID_RESPONSE: Mã chủ tài khoản từ RPC không khớp với đơn thanh toán.'
    );
  }

  const alreadyCompleted = rpcResult.status === 'already_completed';

  const billingData = await dbGetBillingData(resolvedOwnerId);
  return {
    ...billingData,
    alreadyCompleted,
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
