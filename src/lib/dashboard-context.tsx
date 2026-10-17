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
import { createClient } from '@/lib/supabase/client';

interface DashboardContextValue {
  shops: Shop[];
  activeShop: Shop | null;
  activeMembership: ShopMembership | null;
  memberships: Record<string, ShopMembership>;
  profile: Profile | null;
  loading: boolean;
  selectShop: (shopId: string) => void;
  refreshDashboard: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue>({
  shops: [],
  activeShop: null,
  activeMembership: null,
  memberships: {},
  profile: null,
  loading: true,
  selectShop: () => {},
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

  const refreshDashboard = useCallback(async () => {
    try {
      let owner = getStoredAuthOwner();

      // If not in localStorage yet, check if Supabase Auth has an active session (e.g. from OTP/Magic Link)
      if (!owner) {
        const supabase = createClient();
        if (supabase) {
          const { data: sessionRes } = await supabase.auth.getSession();
          const sbUser = sessionRes?.session?.user;
          const sbToken = sessionRes?.session?.access_token;
          if (sbUser?.email && sbToken) {
            const syncRes = await fetch('/api/auth', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${sbToken}`,
              },
              body: JSON.stringify({
                action: 'sync_user',
                userId: sbUser.id,
                email: sbUser.email,
                fullName: sbUser.user_metadata?.full_name as string,
                phone: sbUser.user_metadata?.phone as string,
                supabaseAccessToken: sbToken,
              }),
            });
            if (syncRes.ok) {
              const syncData = await syncRes.json();
              if (syncData.user) {
                owner = syncData.user as Profile;
                setStoredAuthOwner(owner, syncData.accessToken);
              }
            }
          }
        }
      }

      if (!owner) {
        clearStoredAuthOwner();
        router.replace('/login');
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
        router.replace('/login');
        return;
      }

      const data = await res.json();
      let loadedShops: Shop[] = data.shops || [];
      if (data.memberships && typeof data.memberships === 'object') {
        setMemberships(data.memberships as Record<string, ShopMembership>);
      }
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
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  const selectShop = (shopId: string) => {
    setActiveShopId(shopId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('qlaok_active_shop_id', shopId);
    }
  };

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
        selectShop,
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
