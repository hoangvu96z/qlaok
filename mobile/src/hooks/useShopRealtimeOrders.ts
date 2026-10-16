import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Vibration } from 'react-native';
import {
  fetchWithApiFallback,
  MobileCatalogItem,
  MobileShopOrder,
  supabase,
} from '../lib/supabase';

export interface LiveOrderAlert {
  orderCode: string;
  tableLabel: string;
  totalAmount: number;
}

interface UseShopRealtimeOrdersOptions {
  isLoggedIn: boolean;
  shopId?: string;
  onItemsSynced?: (items: MobileCatalogItem[]) => void;
}

export function useShopRealtimeOrders({
  isLoggedIn,
  shopId,
  onItemsSynced,
}: UseShopRealtimeOrdersOptions) {
  const [orders, setOrders] = useState<MobileShopOrder[]>([]);
  const [liveOrderAlert, setLiveOrderAlert] = useState<LiveOrderAlert | null>(
    null
  );
  const [realtimeStatus, setRealtimeStatus] = useState<
    'connecting' | 'connected' | 'fallback'
  >('connecting');

  const knownNewOrderIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const onItemsSyncedRef = useRef(onItemsSynced);
  onItemsSyncedRef.current = onItemsSynced;

  const notifyIfBrandNewOrder = useCallback((nextOrders: MobileShopOrder[]) => {
    const newList = nextOrders.filter((o) => o.status === 'new');

    if (!isFirstLoadRef.current) {
      const brandNew = newList.find(
        (o) => !knownNewOrderIdsRef.current.has(o.id)
      );
      if (brandNew) {
        try {
          Vibration.vibrate([0, 300, 150, 300]);
        } catch {
          // ignore vibration error on web/simulator
        }
        setLiveOrderAlert({
          orderCode: brandNew.order_code,
          tableLabel: brandNew.table_label,
          totalAmount: brandNew.total_amount,
        });
      }
    }

    knownNewOrderIdsRef.current = new Set(newList.map((o) => o.id));
    isFirstLoadRef.current = false;
  }, []);

  const fetchOrdersFromApi = useCallback(
    async (targetShopId: string, silent = false) => {
      if (!targetShopId) return;
      try {
        const res = await fetchWithApiFallback(
          `/api/orders?shopId=${encodeURIComponent(targetShopId)}`
        );
        if (res.ok) {
          const data = await res.json();
          const loadedOrders: MobileShopOrder[] = data.orders || [];
          notifyIfBrandNewOrder(loadedOrders);
          setOrders(loadedOrders);

          if (
            Array.isArray(data.items) &&
            data.items.length > 0 &&
            onItemsSyncedRef.current
          ) {
            onItemsSyncedRef.current(data.items);
          }
          return;
        }
      } catch {
        // Fallback to direct Supabase query if API server is unreachable
      }

      try {
        const { data: shopRow } = await supabase
          .from('shops')
          .select('theme_config')
          .eq('id', targetShopId)
          .single();

        const recentOrders =
          (shopRow?.theme_config as { recent_orders?: MobileShopOrder[] })
            ?.recent_orders || [];

        if (Array.isArray(recentOrders)) {
          notifyIfBrandNewOrder(recentOrders);
          setOrders(recentOrders);
        }
      } catch {
        if (!silent) {
          // ignore silent background errors
        }
      }
    },
    [notifyIfBrandNewOrder]
  );

  // Reset first-load tracker when switching shops
  useEffect(() => {
    isFirstLoadRef.current = true;
    knownNewOrderIdsRef.current = new Set();
  }, [shopId]);

  // Subscribe to Supabase Realtime Postgres Changes via WebSocket
  useEffect(() => {
    if (!isLoggedIn || !shopId) return;

    setRealtimeStatus('connecting');

    const channel = supabase
      .channel(`qlaok-orders-ws-${shopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `shop_id=eq.${shopId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new) {
            const inserted = payload.new as MobileShopOrder;
            setOrders((prev) => {
              const exists = prev.some((o) => o.id === inserted.id);
              const next = exists
                ? prev.map((o) => (o.id === inserted.id ? inserted : o))
                : [inserted, ...prev];
              notifyIfBrandNewOrder(next);
              return next;
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as MobileShopOrder;
            setOrders((prev) =>
              prev.map((o) => (o.id === updated.id ? updated : o))
            );
          } else {
            fetchOrdersFromApi(shopId, true);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shops',
          filter: `id=eq.${shopId}`,
        },
        (payload) => {
          const updatedShop = payload.new as {
            theme_config?: { recent_orders?: MobileShopOrder[] };
          };
          const recentOrders = updatedShop?.theme_config?.recent_orders;
          if (Array.isArray(recentOrders)) {
            notifyIfBrandNewOrder(recentOrders);
            setOrders(recentOrders);
          } else {
            fetchOrdersFromApi(shopId, true);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          setRealtimeStatus('fallback');
        }
      });

    // Sync immediately when app returns to foreground
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        fetchOrdersFromApi(shopId, true);
      }
    };
    const appStateSub = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    // Lightweight safety fallback sync only every 30s (instead of 3.5s HTTP polling)
    const safetyInterval = setInterval(() => {
      fetchOrdersFromApi(shopId, true);
    }, 30000);

    return () => {
      supabase.removeChannel(channel);
      appStateSub.remove();
      clearInterval(safetyInterval);
    };
  }, [isLoggedIn, shopId, fetchOrdersFromApi, notifyIfBrandNewOrder]);

  return {
    orders,
    setOrders,
    liveOrderAlert,
    setLiveOrderAlert,
    realtimeStatus,
    fetchOrdersFromApi,
  };
}
