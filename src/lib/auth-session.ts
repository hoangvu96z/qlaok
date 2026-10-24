import type { Profile } from '@/types/qlaok';

const AUTH_STORAGE_KEY = 'qlaok_auth_owner_v1';
const AUTH_TOKEN_KEY = 'qlaok_auth_token_v1';
const ACTIVE_SHOP_KEY = 'qlaok_active_shop_id';
const ADMIN_BACKUP_KEY = 'qlaok_admin_backup_v1';

export const SUPER_ADMIN_EMAIL = 'hoangvu96z@gmail.com';
export const SUPER_ADMIN_ID = 'admin-hoangvu96z';

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isSuperAdmin(profile?: Profile | null): boolean {
  if (!profile) return false;
  if (
    profile.account_type === 'staff' ||
    profile.role === 'cashier' ||
    profile.role === 'staff' ||
    Boolean(profile.shop_id)
  ) {
    return false;
  }
  return (
    Boolean(profile.is_admin) ||
    profile.role === 'admin' ||
    isSuperAdminEmail(profile.email)
  );
}

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getAuthHeaders(
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getStoredAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getStoredAuthOwner(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    const hasIdentity =
      parsed &&
      typeof parsed.id === 'string' &&
      parsed.id.trim() !== '' &&
      (Boolean(parsed.email) ||
        Boolean(parsed.username && parsed.shop_id) ||
        parsed.account_type === 'staff');
    if (hasIdentity) {
      if (
        parsed.account_type !== 'staff' &&
        !parsed.shop_id &&
        isSuperAdminEmail(parsed.email)
      ) {
        parsed.is_admin = true;
        parsed.role = 'admin';
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredAuthOwner(profile: Profile, accessToken?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized: Profile = {
      ...profile,
      ...(isSuperAdminEmail(profile.email)
        ? { is_admin: true, role: 'admin', plan: 'premium' }
        : {}),
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
    if (accessToken) {
      localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
    }
  } catch {
    // ignore storage errors
  }
}

export function clearStoredAuthOwner(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(ACTIVE_SHOP_KEY);
    localStorage.removeItem(ADMIN_BACKUP_KEY);
    // Also clear server HttpOnly session cookie asynchronously
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    }).catch(() => {});
  } catch {
    // ignore storage errors
  }
}

export function getAdminBackupSession(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ADMIN_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (parsed && isSuperAdmin(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function startAdminImpersonation(
  adminProfile: Profile,
  targetOwner: Profile,
  targetShopId: string
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ADMIN_BACKUP_KEY, JSON.stringify(adminProfile));
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(targetOwner));
    localStorage.setItem(ACTIVE_SHOP_KEY, targetShopId);
  } catch {
    // ignore storage errors
  }
}

export function stopAdminImpersonation(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const backup = getAdminBackupSession();
    if (backup) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(backup));
      localStorage.removeItem(ADMIN_BACKUP_KEY);
      localStorage.removeItem(ACTIVE_SHOP_KEY);
      return backup;
    }
    return null;
  } catch {
    return null;
  }
}
