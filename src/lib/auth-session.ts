import { Profile } from '@/types/qlaok';

const AUTH_STORAGE_KEY = 'qlaok_auth_owner_v1';
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
  return (
    Boolean(profile.is_admin) ||
    profile.role === 'admin' ||
    isSuperAdminEmail(profile.email)
  );
}

export function getStoredAuthOwner(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (parsed && typeof parsed.id === 'string' && parsed.email) {
      if (isSuperAdminEmail(parsed.email)) {
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

export function setStoredAuthOwner(profile: Profile): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized: Profile = {
      ...profile,
      ...(isSuperAdminEmail(profile.email)
        ? { is_admin: true, role: 'admin', plan: 'premium' }
        : {}),
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage errors
  }
}

export function clearStoredAuthOwner(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_SHOP_KEY);
    localStorage.removeItem(ADMIN_BACKUP_KEY);
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
