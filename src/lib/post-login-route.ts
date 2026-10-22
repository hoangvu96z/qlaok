/**
 * Client-safe helpers that decide where to send a user after sign-in.
 * Pure functions so they can be unit tested without React/Next.
 */

/**
 * Accepts only same-origin relative paths ("/dashboard/orders?x=1").
 * Rejects absolute URLs, protocol-relative ("//evil.com"), backslash tricks,
 * and auth pages that would cause redirect loops.
 */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(value)) return null;
  try {
    const parsed = new URL(value, 'http://qlaok.local');
    if (parsed.origin !== 'http://qlaok.local') return null;
    const pathOnly = parsed.pathname;
    if (pathOnly === '/login' || pathOnly.startsWith('/login/')) return null;
    if (pathOnly === '/onboarding' || pathOnly.startsWith('/onboarding/')) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export interface PostLoginPayload {
  isAdmin?: boolean;
  shops?: Array<{ id: string }> | null;
  memberShops?: Array<{ id: string }> | null;
}

/**
 * Admin → /admin. Owner of any shop → `next` (if safe) or /dashboard.
 * Member-only (zero owned shops, ≥1 memberShops) → `next` (if safe) or
 * /dashboard/orders. Users with zero owned AND zero member shops → /onboarding.
 */
export function resolvePostLoginRoute(
  payload: PostLoginPayload,
  nextParam?: string | null
): { path: string; activeShopId: string | null } {
  if (payload.isAdmin) {
    return { path: '/admin', activeShopId: null };
  }
  const owned = Array.isArray(payload.shops) ? payload.shops : [];
  const member = Array.isArray(payload.memberShops) ? payload.memberShops : [];
  const firstShop = owned[0] || member[0] || null;
  if (!firstShop) {
    return { path: '/onboarding', activeShopId: null };
  }
  const defaultPath = owned.length > 0 ? '/dashboard' : '/dashboard/orders';
  const safeNext = sanitizeNextPath(nextParam);
  return {
    path: safeNext && !safeNext.startsWith('/admin') ? safeNext : defaultPath,
    activeShopId: firstShop.id,
  };
}
