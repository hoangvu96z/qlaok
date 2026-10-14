import { Profile } from '@/types/qlaok';

const AUTH_STORAGE_KEY = 'qlaok_auth_owner_v1';
const ACTIVE_SHOP_KEY = 'qlaok_active_shop_id';

export function getStoredAuthOwner(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (parsed && typeof parsed.id === 'string' && parsed.email) {
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
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

export function clearStoredAuthOwner(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_SHOP_KEY);
  } catch {
    // ignore storage errors
  }
}
