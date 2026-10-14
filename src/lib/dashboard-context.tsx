'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Profile, Shop } from '@/types/qlaok';

interface DashboardContextValue {
  shops: Shop[];
  activeShop: Shop | null;
  profile: Profile | null;
  loading: boolean;
  selectShop: (shopId: string) => void;
  refreshDashboard: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue>({
  shops: [],
  activeShop: null,
  profile: null,
  loading: true,
  selectShop: () => {},
  refreshDashboard: async () => {},
});

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/shops', { cache: 'no-store' });
      const data = await res.json();
      const loadedShops: Shop[] = data.shops || [];
      setShops(loadedShops);
      setProfile(data.profile || null);

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
    } catch (err) {
      console.error('Error loading dashboard shops:', err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  return (
    <DashboardContext.Provider
      value={{
        shops,
        activeShop,
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
