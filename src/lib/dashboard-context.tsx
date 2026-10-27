'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useRouter } from 'next/navigation';
import { Profile, Shop, ShopMembership } from '@/types/qlaok';
import {
  clearStoredAuthOwner,
  getAuthHeaders,
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
} from '@/lib/auth-session';
import { CLIENT_ALL_SHOP_PERMISSIONS } from '@/lib/dashboard-nav';

interface DashboardContextValue {
  shops: Shop[];
  activeShop: Shop | null;
  activeMembership: ShopMembership | null;
  memberships: Record<string, ShopMembership>;
  profile: Profile | null;
  loading: boolean;
  /** Non-auth failure (network/server) while loading the session/shops. */
  error: string | null;
  /** True once memberships for the loaded shops are known. */
  membershipsLoaded: boolean;
  selectShop: (shopId: string) => void;
  updateActiveShop: (updatedShop: Shop) => void;
  refreshDashboard: () => Promise<void>;
}

/** Builds `/login?next=<current path>` so users return after signing in. */
function buildLoginRedirect(): string {
  if (typeof window === 'undefined') return '/login';
  const current = `${window.location.pathname}${window.location.search}`;
  if (!current.startsWith('/dashboard')) return '/login';
  return `/login?next=${encodeURIComponent(current)}`;
}

const DashboardContext = createContext<DashboardContextValue>({
  shops: [],
  activeShop: null,
  activeMembership: null,
  memberships: {},
  profile: null,
  loading: true,
  error: null,
  membershipsLoaded: false,
  selectShop: () => {},
  updateActiveShop: () => {},
  refreshDashboard: async () => {},
});

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [shops, setShops] = useState<Shop[]>([]);
  const [memberships, setMemberships] = useState<
    Record<string, ShopMembership>
  >({});
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);

  const refreshDashboard = useCallback(async () => {
    setError(null);
    try {
      let owner = getStoredAuthOwner();

      // If not in localStorage yet, hydrate from the server HttpOnly session cookie (e.g. after Zitadel OIDC callback)
      if (!owner) {
        try {
          const syncRes = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'sync_user' }),
          });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            if (syncData.user) {
              owner = syncData.user as Profile;
              setStoredAuthOwner(owner, syncData.accessToken);
              const firstShop =
                (Array.isArray(syncData.shops) && syncData.shops[0]) ||
                (Array.isArray(syncData.memberShops) &&
                  syncData.memberShops[0]);
              if (
                typeof window !== 'undefined' &&
                firstShop?.id &&
                !localStorage.getItem('qlaok_active_shop_id')
              ) {
                localStorage.setItem('qlaok_active_shop_id', firstShop.id);
              }
            }
          }
        } catch {
          // Fall through to unauthenticated handling if session sync fails
        }
      }

      if (!owner) {
        clearStoredAuthOwner();
        router.replace(buildLoginRedirect());
        return;
      }

      const res = await fetch(
        `/api/shops?ownerId=${encodeURIComponent(owner.id)}`,
        {
          headers: getAuthHeaders(),
          cache: 'no-store',
        }
      );

      if (res.status === 401 || res.status === 403) {
        clearStoredAuthOwner();
        router.replace(buildLoginRedirect());
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      let loadedShops: Shop[] = data.shops || [];
      const loadedMemberships: Record<string, ShopMembership> =
        data.memberships && typeof data.memberships === 'object'
          ? { ...(data.memberships as Record<string, ShopMembership>) }
          : {};
      const loadedProfile: Profile = {
        ...(data.profile || owner),
        ...(isSuperAdmin(owner)
          ? { is_admin: true, role: 'admin', plan: 'premium' }
          : {}),
      };

      // If Super Admin visits /dashboard and has no personal shops yet, load all platform shops
      if (loadedShops.length === 0 && isSuperAdmin(loadedProfile)) {
        const allRes = await fetch('/api/shops', {
          headers: getAuthHeaders(),
          cache: 'no-store',
        });
        if (allRes.ok) {
          const allData = await allRes.json();
          loadedShops = allData.shops || [];
        }
      }

      // Platform admins act as owner on every shop (server resolves the same).
      if (isSuperAdmin(loadedProfile)) {
        const nowIso = new Date().toISOString();
        for (const shop of loadedShops) {
          if (!loadedMemberships[shop.id]) {
            loadedMemberships[shop.id] = {
              id: `mem-admin-${shop.id}`,
              shop_id: shop.id,
              user_id: loadedProfile.id,
              role: 'owner',
              permissions: [...CLIENT_ALL_SHOP_PERMISSIONS],
              is_active: true,
              created_at: nowIso,
              updated_at: nowIso,
            };
          }
        }
      }

      setMemberships(loadedMemberships);
      setMembershipsLoaded(true);
      setProfile(loadedProfile);
      setStoredAuthOwner(loadedProfile);
      setShops(loadedShops);

      if (loadedShops.length === 0) {
        router.replace('/onboarding');
        return;
      }

      const savedId =
        typeof window !== 'undefined'
          ? localStorage.getItem('qlaok_active_shop_id')
          : null;

      if (savedId && loadedShops.some((s) => s.id === savedId)) {
        setActiveShopId((prev) => prev || savedId);
      } else if (loadedShops.length > 0) {
        setActiveShopId((prev) =>
          loadedShops.some((s) => s.id === prev) ? prev : loadedShops[0].id
        );
      }
      setLoading(false);
    } catch (err) {
      console.error('Error loading dashboard shops:', err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'NETWORK_ERROR'
      );
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
      return;
    }
    const bc = new BroadcastChannel('qlaok_realtime_sync');
    bc.onmessage = (ev) => {
      if (ev.data?.type === 'shop_updated') {
        if (ev.data.shop && typeof ev.data.shop === 'object') {
          const incoming = ev.data.shop as Shop;
          if (incoming.id) {
            setShops((prev) =>
              prev.some((s) => s.id === incoming.id)
                ? prev.map((s) =>
                    s.id === incoming.id ? { ...s, ...incoming } : s
                  )
                : prev
            );
          }
        }
        void refreshDashboard();
      }
    };
    return () => {
      bc.close();
    };
  }, [refreshDashboard]);

  const selectShop = (shopId: string) => {
    setActiveShopId(shopId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('qlaok_active_shop_id', shopId);
    }
  };

  const updateActiveShop = useCallback((updatedShop: Shop) => {
    if (!updatedShop?.id) return;
    setShops((prev) =>
      prev.some((s) => s.id === updatedShop.id)
        ? prev.map((s) =>
            s.id === updatedShop.id ? { ...s, ...updatedShop } : s
          )
        : prev
    );
  }, []);

  const activeShop =
    shops.find((s) => s.id === activeShopId) || shops[0] || null;
  const activeMembership = activeShop
    ? memberships[activeShop.id] || null
    : null;

  return (
    <DashboardContext.Provider
      value={{
        shops,
        activeShop,
        activeMembership,
        memberships,
        profile,
        loading,
        error,
        membershipsLoaded,
        selectShop,
        updateActiveShop,
        refreshDashboard,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardContext);
}
