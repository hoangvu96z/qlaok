import fs from 'node:fs';
import path from 'node:path';
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { ShopMembership, ShopPermission, ShopRole } from '@/types/qlaok';
import { getSupabaseDbClient } from './db';
import { SEED_SHOPS } from './seed-data';
import { getSupabaseAnonKey, isSupabaseConfigured } from './supabase/client';

export const ALL_SHOP_PERMISSIONS: ShopPermission[] = [
  'orders.view',
  'orders.create',
  'orders.fulfill',
  'orders.edit_items',
  'orders.cancel_unpaid',
  'orders.print_kitchen',
  'orders.print_provisional',
  'payment.collect',
  'discount.apply',
  'payment.refund',
  'catalog.view',
  'catalog.manage',
  'promotions.manage',
  'settings.manage',
  'settings.bank',
  'reports.view',
  'members.manage',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<ShopRole, ShopPermission[]> = {
  owner: [...ALL_SHOP_PERMISSIONS],
  cashier: [
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.edit_items',
    'orders.cancel_unpaid',
    'orders.print_kitchen',
    'orders.print_provisional',
    'payment.collect',
    'discount.apply',
    'catalog.view',
  ],
  staff: [
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
    'catalog.view',
  ],
};

export function getDefaultPermissionsForRole(role: ShopRole): ShopPermission[] {
  return [...(DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.staff)];
}

export function normalizePermissions(
  role: ShopRole,
  explicitPermissions?: ShopPermission[] | null
): ShopPermission[] {
  if (role === 'owner') {
    return [...ALL_SHOP_PERMISSIONS];
  }
  if (Array.isArray(explicitPermissions)) {
    const validSet = new Set<ShopPermission>(ALL_SHOP_PERMISSIONS);
    return Array.from(
      new Set(explicitPermissions.filter((p): p is ShopPermission => validSet.has(p)))
    );
  }
  return getDefaultPermissionsForRole(role);
}

export function hasShopPermission(
  membership: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null | undefined,
  required: ShopPermission | ShopPermission[]
): boolean {
  if (!membership || !membership.is_active) return false;
  if (membership.role === 'owner') return true;
  const requiredList = Array.isArray(required) ? required : [required];
  const granted = new Set<ShopPermission>(
    Array.isArray(membership.permissions)
      ? membership.permissions
      : getDefaultPermissionsForRole(membership.role)
  );
  return requiredList.every((perm) => granted.has(perm));
}

const MEMBERSHIPS_DIR = path.join(process.cwd(), '.local-db');
const MEMBERSHIPS_FILE = path.join(MEMBERSHIPS_DIR, 'shop-memberships.json');

// Optional test override for isolated unit testing of authoritative DB behavior
let testDbClientOverride: SupabaseClient | null = null;

export function setShopMembershipDbClientForTest(
  client: SupabaseClient | null
): void {
  testDbClientOverride = client;
}

/**
 * Returns true when Supabase DB is configured and should be used as the sole,
 * authoritative source of truth (fail-closed, no local union/cache).
 * Local demo storage is only used when DB is genuinely unconfigured or when
 * explicit local test mode is enabled.
 */
export function isShopMembershipDbAuthoritative(): boolean {
  if (testDbClientOverride) {
    return true;
  }

  const explicitLocalMode =
    process.env.QLAOK_MEMBERSHIP_MODE === 'local' ||
    process.env.QLAOK_FORCE_LOCAL_MEMBERSHIPS === '1' ||
    process.env.QLAOK_FORCE_LOCAL_MEMBERSHIPS === 'true' ||
    process.env.QLAOK_TEST_LOCAL_DB === '1';
  if (explicitLocalMode && process.env.NODE_ENV !== 'production') {
    return false;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || getSupabaseAnonKey()
  )?.trim();

  return (
    isSupabaseConfigured() ||
    Boolean(url && key && !url.includes('your-project'))
  );
}

function getMembershipDbClient(): SupabaseClient {
  if (testDbClientOverride) {
    return testDbClientOverride;
  }

  const sb = getSupabaseDbClient();
  const currentUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const currentKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || getSupabaseAnonKey()
  )?.trim();
  const cachedUrl = (sb as unknown as { supabaseUrl?: string })?.supabaseUrl;

  if (currentUrl && currentKey && cachedUrl && cachedUrl !== currentUrl) {
    return createSupabaseJsClient(currentUrl, currentKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return sb;
}

function normalizeMembershipRow(row: Record<string, unknown>): ShopMembership {
  const rawRole = String(row.role || 'staff') as ShopRole;
  const role: ShopRole =
    rawRole === 'owner' || rawRole === 'cashier' || rawRole === 'staff'
      ? rawRole
      : 'staff';
  const nowIso = new Date().toISOString();

  return {
    id: String(row.id || `mem-${row.shop_id}-${row.user_id}`),
    shop_id: String(row.shop_id),
    user_id: String(row.user_id),
    email:
      typeof row.email === 'string' && row.email.trim()
        ? row.email.trim()
        : undefined,
    full_name:
      typeof row.full_name === 'string' && row.full_name.trim()
        ? row.full_name.trim()
        : undefined,
    role,
    permissions: normalizePermissions(
      role,
      Array.isArray(row.permissions)
        ? (row.permissions as ShopPermission[])
        : undefined
    ),
    is_active: row.is_active !== false,
    created_at:
      typeof row.created_at === 'string' && row.created_at
        ? row.created_at
        : nowIso,
    updated_at:
      typeof row.updated_at === 'string' && row.updated_at
        ? row.updated_at
        : nowIso,
  };
}

function buildInitialSeedMemberships(): ShopMembership[] {
  const nowIso = new Date().toISOString();
  return [
    {
      id: 'mem-owner-fnb-001',
      shop_id: 'shop-fnb-001',
      user_id: 'owner-demo-001',
      email: 'chuquan@qlaok.vn',
      full_name: 'Nguyễn Văn Minh (Chủ Quán)',
      role: 'owner',
      permissions: getDefaultPermissionsForRole('owner'),
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: 'mem-cashier-fnb-001',
      shop_id: 'shop-fnb-001',
      user_id: 'cashier-demo-001',
      email: 'thungan@qlaok.vn',
      full_name: 'Trần Thị Thu Ngân',
      role: 'cashier',
      permissions: getDefaultPermissionsForRole('cashier'),
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: 'mem-staff-fnb-001',
      shop_id: 'shop-fnb-001',
      user_id: 'staff-demo-001',
      email: 'nhanvien@qlaok.vn',
      full_name: 'Lê Văn Phục Vụ',
      role: 'staff',
      permissions: getDefaultPermissionsForRole('staff'),
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];
}

function readLocalMemberships(): ShopMembership[] {
  try {
    if (!fs.existsSync(MEMBERSHIPS_FILE)) {
      fs.mkdirSync(MEMBERSHIPS_DIR, { recursive: true });
      const initial = buildInitialSeedMemberships();
      fs.writeFileSync(MEMBERSHIPS_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(MEMBERSHIPS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return buildInitialSeedMemberships();
    return parsed.map((m) => ({
      ...m,
      role: (m.role as ShopRole) || 'staff',
      permissions: normalizePermissions(
        (m.role as ShopRole) || 'staff',
        m.permissions
      ),
      is_active: m.is_active !== false,
    }));
  } catch {
    return buildInitialSeedMemberships();
  }
}

function writeLocalMemberships(memberships: ShopMembership[]): void {
  try {
    fs.mkdirSync(MEMBERSHIPS_DIR, { recursive: true });
    fs.writeFileSync(
      MEMBERSHIPS_FILE,
      JSON.stringify(memberships, null, 2),
      'utf8'
    );
  } catch {
    // ignore read-only fs errors in local demo mode
  }
}

export async function dbGetShopMemberships(
  shopId: string
): Promise<ShopMembership[]> {
  if (!shopId) return [];

  if (isShopMembershipDbAuthoritative()) {
    try {
      const sb = getMembershipDbClient();
      const { data, error } = await sb
        .from('shop_memberships')
        .select('*')
        .eq('shop_id', shopId);
      if (error || !Array.isArray(data)) {
        return [];
      }
      const byUser = new Map<string, ShopMembership>();
      for (const row of data) {
        if (!row || typeof row !== 'object' || !('user_id' in row)) continue;
        const norm = normalizeMembershipRow(row as Record<string, unknown>);
        byUser.set(norm.user_id, norm);
      }
      return Array.from(byUser.values());
    } catch {
      // Fail closed when Supabase is configured
      return [];
    }
  }

  const local = readLocalMemberships().filter((m) => m.shop_id === shopId);
  const byUser = new Map<string, ShopMembership>();
  for (const m of local) {
    byUser.set(m.user_id, m);
  }
  return Array.from(byUser.values());
}

export async function dbGetUserShopMemberships(
  userId: string
): Promise<ShopMembership[]> {
  if (!userId) return [];

  if (isShopMembershipDbAuthoritative()) {
    try {
      const sb = getMembershipDbClient();
      const { data, error } = await sb
        .from('shop_memberships')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true);
      if (error || !Array.isArray(data)) {
        return [];
      }
      const byShop = new Map<string, ShopMembership>();
      for (const row of data) {
        if (!row || typeof row !== 'object' || !('shop_id' in row)) continue;
        const norm = normalizeMembershipRow(row as Record<string, unknown>);
        if (norm.is_active) {
          byShop.set(norm.shop_id, norm);
        }
      }
      return Array.from(byShop.values());
    } catch {
      // Fail closed when Supabase is configured
      return [];
    }
  }

  const local = readLocalMemberships().filter(
    (m) => m.user_id === userId && m.is_active
  );
  const byShop = new Map<string, ShopMembership>();
  for (const m of local) {
    byShop.set(m.shop_id, m);
  }
  return Array.from(byShop.values());
}

export async function dbUpsertShopMembership(input: {
  shop_id: string;
  user_id: string;
  email?: string;
  full_name?: string;
  role: ShopRole;
  permissions?: ShopPermission[];
  is_active?: boolean;
}): Promise<ShopMembership> {
  const validRoles: ShopRole[] = ['owner', 'cashier', 'staff'];
  if (!validRoles.includes(input.role)) {
    throw new Error(`INVALID_ROLE: Vai trò "${input.role}" không hợp lệ.`);
  }
  if (!input.shop_id || !input.user_id) {
    throw new Error('MISSING_MEMBERSHIP_FIELDS: Thiếu shop_id hoặc user_id.');
  }

  const nowIso = new Date().toISOString();
  const permissions = normalizePermissions(input.role, input.permissions);

  if (isShopMembershipDbAuthoritative()) {
    const emailClean =
      typeof input.email === 'string' && input.email.trim()
        ? input.email.trim()
        : undefined;
    const fullNameClean =
      typeof input.full_name === 'string' && input.full_name.trim()
        ? input.full_name.trim()
        : undefined;

    const record: ShopMembership = {
      id: `mem-${input.shop_id}-${input.user_id}`,
      shop_id: input.shop_id,
      user_id: input.user_id,
      ...(emailClean !== undefined ? { email: emailClean } : {}),
      ...(fullNameClean !== undefined ? { full_name: fullNameClean } : {}),
      role: input.role,
      permissions,
      is_active: input.is_active !== undefined ? input.is_active : true,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const dbPayload = {
      id: record.id,
      shop_id: record.shop_id,
      user_id: record.user_id,
      email: emailClean ?? null,
      full_name: fullNameClean ?? null,
      role: record.role,
      permissions: record.permissions,
      is_active: record.is_active,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };

    const sb = getMembershipDbClient();
    const { data, error } = await sb
      .from('shop_memberships')
      .upsert(dbPayload, { onConflict: 'shop_id,user_id' });

    if (error) {
      throw new Error(
        `DB_UPSERT_MEMBERSHIP_FAILED: ${error.message || 'Không thể lưu phân quyền nhân sự vào cơ sở dữ liệu.'}`
      );
    }

    const returnedRows = data as unknown;
    if (
      Array.isArray(returnedRows) &&
      returnedRows.length > 0 &&
      returnedRows[0]
    ) {
      return normalizeMembershipRow(returnedRows[0] as Record<string, unknown>);
    }

    return record;
  }

  const list = readLocalMemberships();
  const idx = list.findIndex(
    (m) => m.shop_id === input.shop_id && m.user_id === input.user_id
  );
  const existing = idx !== -1 ? list[idx] : null;

  const record: ShopMembership = {
    id: existing?.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: input.shop_id,
    user_id: input.user_id,
    email: input.email ?? existing?.email,
    full_name: input.full_name ?? existing?.full_name,
    role: input.role,
    permissions,
    is_active: input.is_active !== undefined ? input.is_active : true,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  };

  if (idx !== -1) {
    list[idx] = record;
  } else {
    list.push(record);
  }
  writeLocalMemberships(list);

  return record;
}

export async function dbDeleteShopMembership(
  shopId: string,
  userId: string
): Promise<boolean> {
  if (!shopId || !userId) {
    throw new Error('MISSING_MEMBERSHIP_FIELDS: Thiếu shop_id hoặc user_id.');
  }

  if (isShopMembershipDbAuthoritative()) {
    const sb = getMembershipDbClient();
    const { data, error, count } = await sb
      .from('shop_memberships')
      .delete({ count: 'exact' })
      .eq('shop_id', shopId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(
        `DB_DELETE_MEMBERSHIP_FAILED: ${error.message || 'Không thể xóa phân quyền nhân sự khỏi cơ sở dữ liệu.'}`
      );
    }

    if (typeof count === 'number') {
      return count > 0;
    }
    const deletedRows = data as unknown;
    if (Array.isArray(deletedRows)) {
      return deletedRows.length > 0;
    }
    return true;
  }

  const list = readLocalMemberships();
  const next = list.filter(
    (m) => !(m.shop_id === shopId && m.user_id === userId)
  );
  writeLocalMemberships(next);

  return next.length !== list.length;
}

export async function resolveUserShopMembership(params: {
  userId: string;
  shopId: string;
  isSuperAdmin?: boolean;
  shopOwnerId?: string | null;
}): Promise<ShopMembership | null> {
  const { userId, shopId, isSuperAdmin } = params;
  if (!userId || !shopId) return null;

  const nowIso = new Date().toISOString();

  if (isSuperAdmin) {
    return {
      id: `mem-admin-${shopId}`,
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
      permissions: [...ALL_SHOP_PERMISSIONS],
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  let ownerId = params.shopOwnerId;
  if (ownerId === undefined) {
    if (isShopMembershipDbAuthoritative()) {
      try {
        const sb = getMembershipDbClient();
        const { data, error } = await sb
          .from('shops')
          .select('owner_id')
          .eq('id', shopId)
          .maybeSingle();
        if (error) {
          return null;
        }
        ownerId = data?.owner_id ?? null;
      } catch {
        // Fail closed when Supabase is configured
        return null;
      }
    } else {
      const seedMatch = SEED_SHOPS.find((s) => s.id === shopId);
      ownerId = seedMatch?.owner_id ?? null;
    }
  }

  if (ownerId && ownerId === userId) {
    return {
      id: `mem-owner-${shopId}-${userId}`,
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
      permissions: [...ALL_SHOP_PERMISSIONS],
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  const members = await dbGetShopMemberships(shopId);
  const found = members.find((m) => m.user_id === userId && m.is_active);
  return found || null;
}

