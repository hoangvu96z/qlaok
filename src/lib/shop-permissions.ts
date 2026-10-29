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
  'inventory.adjust',
  'promotions.manage',
  'settings.manage',
  'settings.bank',
  'reports.view',
  'members.manage',
];

export const OWNER_ONLY_SHOP_PERMISSIONS: ShopPermission[] = [
  'members.manage',
];

export const ALLOWED_STAFF_PERMISSIONS: ShopPermission[] =
  ALL_SHOP_PERMISSIONS.filter(
    (perm) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(perm)
  );

export const STAFF_ACCOUNT_ROLES: Array<'cashier' | 'staff'> = [
  'cashier',
  'staff',
];

const STAFF_USER_ID_PREFIX = 'staff-acct-';
const STAFF_USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

export function isShopScopedStaffUserId(
  userId: string | null | undefined
): boolean {
  return Boolean(
    typeof userId === 'string' && userId.trim().startsWith(STAFF_USER_ID_PREFIX)
  );
}

export function normalizeStaffUsername(
  raw: string | null | undefined
): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

export function isValidStaffUsername(
  username: string | null | undefined
): boolean {
  const normalized = normalizeStaffUsername(username);
  return STAFF_USERNAME_REGEX.test(normalized);
}

export function validateStaffRole(
  rawRole: unknown
): { ok: true; role: 'cashier' | 'staff' } | { ok: false; errorCode: string; message: string } {
  if (typeof rawRole !== 'string' || !rawRole.trim()) {
    return {
      ok: false,
      errorCode: 'INVALID_ROLE',
      message: 'Vai trò nhân sự phải là "cashier" (Thu ngân) hoặc "staff" (Nhân viên).',
    };
  }
  const normalized = rawRole.trim() as ShopRole;
  if (normalized === 'owner' || normalized === ('admin' as unknown as ShopRole)) {
    return {
      ok: false,
      errorCode: 'FORBIDDEN_STAFF_OWNER_ROLE',
      message: 'Không được phép gán vai trò chủ quán hoặc quản trị viên cho tài khoản nhân viên.',
    };
  }
  if (normalized !== 'cashier' && normalized !== 'staff') {
    return {
      ok: false,
      errorCode: 'INVALID_ROLE',
      message: 'Vai trò nhân sự chỉ chấp nhận "cashier" (Thu ngân) hoặc "staff" (Nhân viên).',
    };
  }
  return { ok: true, role: normalized };
}

export function validateStaffPermissionsInput(
  role: 'cashier' | 'staff',
  rawPermissions: unknown
):
  | { ok: true; permissions: ShopPermission[] }
  | { ok: false; errorCode: string; message: string } {
  if (rawPermissions === undefined || rawPermissions === null) {
    return {
      ok: true,
      permissions: getDefaultPermissionsForRole(role).filter(
        (perm) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(perm)
      ),
    };
  }
  if (!Array.isArray(rawPermissions)) {
    return {
      ok: false,
      errorCode: 'INVALID_PERMISSION',
      message: 'Danh sách quyền hạn (permissions) phải là một mảng hợp lệ.',
    };
  }

  const validAll = new Set<string>(ALL_SHOP_PERMISSIONS);
  const ownerOnly = new Set<string>([
    ...OWNER_ONLY_SHOP_PERMISSIONS,
    'staff.manage',
  ]);
  const deduped: ShopPermission[] = [];
  const seen = new Set<ShopPermission>();

  for (const entry of rawPermissions) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return {
        ok: false,
        errorCode: 'INVALID_PERMISSION',
        message: 'Quyền hạn không hợp lệ.',
      };
    }
    const perm = entry.trim();
    if (ownerOnly.has(perm)) {
      return {
        ok: false,
        errorCode: 'FORBIDDEN_STAFF_PERMISSION',
        message: `Quyền "${perm}" chỉ dành cho chủ quán, không được cấp cho nhân viên.`,
      };
    }
    if (!validAll.has(perm)) {
      return {
        ok: false,
        errorCode: 'INVALID_PERMISSION',
        message: `Quyền "${perm}" không tồn tại trong hệ thống.`,
      };
    }
    const typedPerm = perm as ShopPermission;
    if (!seen.has(typedPerm)) {
      seen.add(typedPerm);
      deduped.push(typedPerm);
    }
  }

  return { ok: true, permissions: deduped };
}

/**
 * Item fields that may be changed with only `inventory.adjust` (toggle
 * availability / stock). Any other field change still requires
 * `catalog.manage`.
 */
export const INVENTORY_ADJUST_ITEM_FIELDS = [
  'is_available',
  'stock_quantity',
] as const;

/** Fields that identify an item but are not treated as edits. */
const ITEM_IDENTITY_FIELDS = ['id', 'shop_id'] as const;

/**
 * Server-managed / derived fields that clients echo back from GET or pass as
 * CAS guards, and that are never treated as catalog content edits.
 */
const ITEM_IGNORED_DIFF_FIELDS = [
  'created_at',
  'updated_at',
  'sold_count',
  'view_count',
  'expected_stock_quantity',
  'expectedStockQuantity',
  'expected_is_available',
  'expectedIsAvailable',
] as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function itemValuesEquivalent(a: unknown, b: unknown): boolean {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  if (isNumericLike(a) && isNumericLike(b)) return Number(a) === Number(b);
  return stableStringify(a) === stableStringify(b);
}

/**
 * Returns the permissions that are each sufficient to apply `incoming` to the
 * stored `existing` item. Updates to an existing item that only change
 * stock/availability accept `inventory.adjust` OR `catalog.manage`; creating
 * items or changing any other field requires `catalog.manage`.
 */
export function getCatalogItemUpdatePermissionOptions(
  incoming: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown> | null | undefined
): ShopPermission[] {
  if (!incoming || !existing) return ['catalog.manage'];
  const inventoryFields = new Set<string>(INVENTORY_ADJUST_ITEM_FIELDS);
  const identityFields = new Set<string>(ITEM_IDENTITY_FIELDS);
  const ignoredFields = new Set<string>(ITEM_IGNORED_DIFF_FIELDS);
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || ignoredFields.has(key) || inventoryFields.has(key)) {
      continue;
    }
    if (identityFields.has(key)) {
      if (String(value) !== String(existing[key])) return ['catalog.manage'];
      continue;
    }
    if (!itemValuesEquivalent(value, existing[key])) return ['catalog.manage'];
  }
  return ['catalog.manage', 'inventory.adjust'];
}

/**
 * Builds the minimal write payload for an inventory-only update so that no
 * other item field can be written through the `inventory.adjust` path.
 */
export function buildInventoryOnlyItemPatch(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    id: existing.id,
    shop_id: existing.shop_id,
    category_id: existing.category_id,
  };
  if (typeof incoming.is_available === 'boolean') {
    patch.is_available = incoming.is_available;
  }
  if (incoming.stock_quantity === null) {
    patch.stock_quantity = null;
  } else if (isNumericLike(incoming.stock_quantity)) {
    const num = Number(incoming.stock_quantity);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(
        num < 0
          ? 'INVALID_STOCK_QUANTITY: Tồn kho không được âm.'
          : 'INVALID_STOCK_QUANTITY: Tồn kho phải là số nguyên.'
      );
    }
    patch.stock_quantity = num;
  } else if (incoming.stock_quantity !== undefined) {
    throw new Error('INVALID_STOCK_QUANTITY: Tồn kho không hợp lệ.');
  }
  const hasExpectedSnake = Object.prototype.hasOwnProperty.call(
    incoming,
    'expected_stock_quantity'
  );
  const hasExpectedCamel = Object.prototype.hasOwnProperty.call(
    incoming,
    'expectedStockQuantity'
  );
  const rawExpected = hasExpectedSnake
    ? incoming.expected_stock_quantity
    : incoming.expectedStockQuantity;
  if ((hasExpectedSnake || hasExpectedCamel) && rawExpected !== undefined) {
    if (rawExpected === null) {
      patch.expected_stock_quantity = null;
    } else if (isNumericLike(rawExpected)) {
      const expNum = Number(rawExpected);
      if (!Number.isInteger(expNum) || expNum < 0) {
        throw new Error(
          expNum < 0
            ? 'INVALID_EXPECTED_STOCK_QUANTITY: Tồn kho đối chiếu không được âm.'
            : 'INVALID_EXPECTED_STOCK_QUANTITY: Tồn kho đối chiếu phải là số nguyên.'
        );
      }
      patch.expected_stock_quantity = expNum;
    } else {
      throw new Error(
        'INVALID_EXPECTED_STOCK_QUANTITY: Tồn kho đối chiếu không hợp lệ.'
      );
    }
  }
  const hasExpectedAvailSnake =
    Object.prototype.hasOwnProperty.call(incoming, 'expected_is_available') &&
    incoming.expected_is_available !== undefined;
  const hasExpectedAvailCamel =
    Object.prototype.hasOwnProperty.call(incoming, 'expectedIsAvailable') &&
    incoming.expectedIsAvailable !== undefined;
  const rawExpectedAvail = hasExpectedAvailSnake
    ? incoming.expected_is_available
    : incoming.expectedIsAvailable;
  if (hasExpectedAvailSnake || hasExpectedAvailCamel) {
    if (typeof rawExpectedAvail !== 'boolean') {
      throw new Error(
        'INVALID_EXPECTED_AVAILABILITY: Trạng thái còn hàng đối chiếu (expected_is_available) phải là boolean.'
      );
    }
    patch.expected_is_available = rawExpectedAvail;
  }
  return patch;
}

/** True when the membership holds at least one of the listed permissions. */
export function hasAnyShopPermission(
  membership: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null | undefined,
  anyOf: ShopPermission[]
): boolean {
  return anyOf.some((perm) => hasShopPermission(membership, perm));
}

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
    'inventory.adjust',
  ],
  staff: [
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
    'catalog.view',
    'inventory.adjust',
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

export function getMembershipDbClient(): SupabaseClient {
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

export function normalizeMembershipRow(row: Record<string, unknown>): ShopMembership {
  const userId = String(row.user_id);
  const usernameClean =
    typeof row.username === 'string' && row.username.trim()
      ? normalizeStaffUsername(row.username)
      : undefined;
  const isStaffScoped = Boolean(usernameClean) || isShopScopedStaffUserId(userId);
  const rawRole = String(row.role || 'staff') as ShopRole;
  const role: ShopRole = isStaffScoped
    ? rawRole === 'cashier' || rawRole === 'staff'
      ? rawRole
      : 'staff'
    : rawRole === 'owner' || rawRole === 'cashier' || rawRole === 'staff'
      ? rawRole
      : 'staff';
  const nowIso = new Date().toISOString();
  const normalizedPerms = normalizePermissions(
    role,
    Array.isArray(row.permissions)
      ? (row.permissions as ShopPermission[])
      : undefined
  );
  const permissions = isStaffScoped
    ? normalizedPerms.filter((p) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(p))
    : normalizedPerms;

  return {
    id: String(row.id || `mem-${row.shop_id}-${userId}`),
    shop_id: String(row.shop_id),
    user_id: userId,
    email:
      typeof row.email === 'string' && row.email.trim()
        ? row.email.trim()
        : undefined,
    ...(usernameClean ? { username: usernameClean } : {}),
    account_type: isStaffScoped ? 'staff' : 'email',
    full_name:
      typeof row.full_name === 'string' && row.full_name.trim()
        ? row.full_name.trim()
        : undefined,
    role,
    permissions,
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
    return parsed.map((m) =>
      normalizeMembershipRow(m as Record<string, unknown>)
    );
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
  username?: string;
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

  const usernameClean =
    typeof input.username === 'string' && input.username.trim()
      ? normalizeStaffUsername(input.username)
      : undefined;
  const isStaffScoped =
    Boolean(usernameClean) || isShopScopedStaffUserId(input.user_id);

  if (usernameClean !== undefined && !isValidStaffUsername(usernameClean)) {
    throw new Error(
      'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (a-z, 0-9, ., _, -).'
    );
  }

  if (isStaffScoped && input.role === 'owner') {
    throw new Error(
      'FORBIDDEN_STAFF_OWNER_ROLE: Tài khoản nhân viên theo quán không được gán quyền chủ quán.'
    );
  }

  const nowIso = new Date().toISOString();
  const rawPermissions = normalizePermissions(input.role, input.permissions);
  const permissions = isStaffScoped
    ? rawPermissions.filter((p) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(p))
    : rawPermissions;

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
      ...(usernameClean !== undefined ? { username: usernameClean } : {}),
      account_type: isStaffScoped ? 'staff' : 'email',
      ...(fullNameClean !== undefined ? { full_name: fullNameClean } : {}),
      role: input.role,
      permissions,
      is_active: input.is_active !== undefined ? input.is_active : true,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const dbPayload: Record<string, unknown> = {
      id: record.id,
      shop_id: record.shop_id,
      user_id: record.user_id,
      email: emailClean ?? null,
      ...(usernameClean !== undefined ? { username: usernameClean } : {}),
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
  if (isShopScopedStaffUserId(input.user_id)) {
    const crossShop = list.find(
      (m) => m.user_id === input.user_id && m.shop_id !== input.shop_id
    );
    if (crossShop) {
      throw new Error(
        'FORBIDDEN_CROSS_SHOP_STAFF_MEMBERSHIP: Tài khoản nhân viên chỉ được gắn với duy nhất một cửa hàng.'
      );
    }
  }

  const idx = list.findIndex(
    (m) => m.shop_id === input.shop_id && m.user_id === input.user_id
  );
  const existing = idx !== -1 ? list[idx] : null;
  const effectiveUsername = usernameClean ?? existing?.username;

  if (effectiveUsername) {
    const duplicateUsername = list.find(
      (m) =>
        m.shop_id === input.shop_id &&
        m.user_id !== input.user_id &&
        m.username &&
        normalizeStaffUsername(m.username) === effectiveUsername
    );
    if (duplicateUsername) {
      throw new Error(
        `STAFF_USERNAME_EXISTS: Tên đăng nhập "${effectiveUsername}" đã tồn tại trong cửa hàng này.`
      );
    }
  }

  const record: ShopMembership = {
    id: existing?.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shop_id: input.shop_id,
    user_id: input.user_id,
    email: input.email ?? existing?.email,
    ...(effectiveUsername ? { username: effectiveUsername } : {}),
    account_type:
      effectiveUsername || isShopScopedStaffUserId(input.user_id)
        ? 'staff'
        : 'email',
    full_name: input.full_name ?? existing?.full_name,
    role: input.role,
    permissions:
      effectiveUsername || isShopScopedStaffUserId(input.user_id)
        ? permissions.filter((p) => !OWNER_ONLY_SHOP_PERMISSIONS.includes(p))
        : permissions,
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
  const isStaffAccount = isShopScopedStaffUserId(userId);

  if (isSuperAdmin && !isStaffAccount) {
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
  if (!isStaffAccount && ownerId === undefined) {
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

  if (!isStaffAccount && ownerId && ownerId === userId) {
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

