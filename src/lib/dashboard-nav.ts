import type { ShopMembership, ShopPermission } from '@/types/qlaok';

/**
 * Client-safe navigation permission rules for the dashboard shell.
 * UI gating only — every API still enforces permissions server-side.
 */
export type DashboardNavRequirement =
  | { anyOf: ShopPermission[] }
  | { ownerOnly: true };

/**
 * Client copy of ALL_SHOP_PERMISSIONS (server module imports node:fs).
 * A unit test keeps both lists in sync.
 */
export const CLIENT_ALL_SHOP_PERMISSIONS: ShopPermission[] = [
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

export const DASHBOARD_NAV_REQUIREMENTS: Record<string, DashboardNavRequirement> = {
  '/dashboard': { anyOf: ['reports.view'] },
  '/dashboard/orders': { anyOf: ['orders.view'] },
  '/dashboard/kitchen': { anyOf: ['orders.view'] },
  '/dashboard/reports': { anyOf: ['reports.view'] },
  '/dashboard/catalog': { anyOf: ['catalog.manage', 'inventory.adjust'] },
  '/dashboard/ai-scanner': { anyOf: ['catalog.manage'] },
  // Mirrors GET /api/tables (orders.view | reports.view | settings.manage);
  // table writes stay owner-only inside the page.
  '/dashboard/qr-studio': {
    anyOf: ['orders.view', 'reports.view', 'settings.manage'],
  },
  '/dashboard/posts': { anyOf: ['promotions.manage'] },
  '/dashboard/settings': { anyOf: ['settings.manage'] },
  '/dashboard/billing': { ownerOnly: true },
};

type MembershipLike = Pick<ShopMembership, 'role' | 'permissions' | 'is_active'>;

export function membershipHasPermission(
  membership: MembershipLike | null | undefined,
  permission: ShopPermission
): boolean {
  if (!membership || !membership.is_active) return false;
  if (membership.role === 'owner') return true;
  return Array.isArray(membership.permissions)
    ? membership.permissions.includes(permission)
    : false;
}

/** Finds the nav requirement for a pathname (longest matching prefix). */
export function getNavRequirementForPath(
  pathname: string | null | undefined
): DashboardNavRequirement | null {
  if (!pathname) return null;
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    return DASHBOARD_NAV_REQUIREMENTS['/dashboard'];
  }
  let best: string | null = null;
  for (const href of Object.keys(DASHBOARD_NAV_REQUIREMENTS)) {
    if (href === '/dashboard') continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best ? DASHBOARD_NAV_REQUIREMENTS[best] : null;
}

/**
 * Returns true only when the membership is loaded and satisfies the rule.
 * A missing membership (still loading / not a member) is never "allowed".
 */
export function canAccessDashboardHref(
  href: string,
  membership: MembershipLike | null | undefined
): boolean {
  const requirement =
    DASHBOARD_NAV_REQUIREMENTS[href] ?? getNavRequirementForPath(href);
  if (!membership || !membership.is_active) return false;
  if (!requirement) return true;
  if ('ownerOnly' in requirement) return membership.role === 'owner';
  return requirement.anyOf.some((perm) => membershipHasPermission(membership, perm));
}

/** True for owners (incl. platform admins mapped to owner membership). */
export function isShopOwnerMembership(
  membership: MembershipLike | null | undefined
): boolean {
  return Boolean(membership?.is_active && membership.role === 'owner');
}

/**
 * First dashboard route the membership may open, used when the current
 * route is not permitted (e.g. staff landing on the overview).
 */
export function getFallbackDashboardHref(
  membership: MembershipLike | null | undefined
): string | null {
  const order = [
    '/dashboard/orders',
    '/dashboard/kitchen',
    '/dashboard',
    '/dashboard/catalog',
    '/dashboard/qr-studio',
    '/dashboard/reports',
    '/dashboard/posts',
    '/dashboard/settings',
  ];
  return order.find((href) => canAccessDashboardHref(href, membership)) || null;
}

/**
 * Route-ownership helper for order live sync.
 * CounterOrdersPage (/dashboard/orders) owns its own SSE, fetch, and chime/notification alerts.
 * DashboardShell should suspend background sync when on /dashboard/orders or nested orders routes.
 */
export function isOrdersDashboardRoute(
  pathname: string | null | undefined
): boolean {
  if (!pathname) return false;
  const clean = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return clean === '/dashboard/orders' || clean.startsWith('/dashboard/orders/');
}

/**
 * Returns true if DashboardShell should run background order live sync.
 * Suspends on /dashboard/orders and nested paths to avoid duplicate SSE streams and refreshes.
 */
export function shouldDashboardShellSyncOrders(
  pathname: string | null | undefined
): boolean {
  return !isOrdersDashboardRoute(pathname);
}
