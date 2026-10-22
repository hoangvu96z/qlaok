import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Vibration } from 'react-native';
import {
  fetchApi,
  MobileCatalogItem,
  MobileShopMembership,
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
  onMembershipSynced?: (membership: MobileShopMembership) => void;
}

export function useShopRealtimeOrders({
  isLoggedIn,
  shopId,
  onItemsSynced,
  onMembershipSynced,
}: UseShopRealtimeOrdersOptions) {
  const [orders, setOrders] = useState<MobileShopOrder[]>([]);
  const [liveOrderAlert, setLiveOrderAlert] = useState<LiveOrderAlert | null>(
    null
  );
  const [realtimeStatus, setRealtimeStatus] = useState<
    'connecting' | 'connected' | 'fallback'
  >('connecting');
  const [fetchError, setFetchError] = useState<string>('');

  const knownNewOrderIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);
  const onItemsSyncedRef = useRef(onItemsSynced);
  onItemsSyncedRef.current = onItemsSynced;
  const onMembershipSyncedRef = useRef(onMembershipSynced);
  onMembershipSyncedRef.current = onMembershipSynced;

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

  const scopeRef = useRef({ shopId, isLoggedIn, generation: 0 });
  if (scopeRef.current.shopId !== shopId || scopeRef.current.isLoggedIn !== isLoggedIn) {
    scopeRef.current = { shopId, isLoggedIn, generation: scopeRef.current.generation + 1 };
  }
  const requestId = useRef(0);
  const needsSyncRef = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => () => { scopeRef.current = { ...scopeRef.current, generation: scopeRef.current.generation + 1 }; }, []);

  const fetchOrdersFromApi = useCallback(
    async (targetShopId: string, _silent = false) => {
      const scope = scopeRef.current;
      if (!scope.isLoggedIn || targetShopId !== scope.shopId) return;
      const request = ++requestId.current;
      try {
        const res = await fetchApi(`/api/orders?shopId=${encodeURIComponent(targetShopId)}`);
        const data = await res.json();
        if (scope !== scopeRef.current || request !== requestId.current) return;
        if (!Array.isArray(data.orders)) throw new Error('Danh sách đơn không hợp lệ');
        needsSyncRef.current = false;
        setFetchError('');
        notifyIfBrandNewOrder(data.orders);
        setOrders(data.orders);
        if (Array.isArray(data.items)) onItemsSyncedRef.current?.(data.items);
        if (data.membership) onMembershipSyncedRef.current?.(data.membership as MobileShopMembership);
      } catch (err) {
        if (scope !== scopeRef.current || request !== requestId.current) return;
        needsSyncRef.current = true;
        setRealtimeStatus('fallback');
        setFetchError(
          err instanceof Error && err.message
            ? err.message
            : 'Không thể tải danh sách đơn hàng'
        );
        // Never read public theme_config.recent_orders after a failed authenticated request,
        // and preserve previously loaded orders in memory rather than wiping the screen on transient network hiccup.
      }
    },
    [notifyIfBrandNewOrder]
  );

  useEffect(() => {
    isFirstLoadRef.current = true;
    knownNewOrderIdsRef.current = new Set();
    setOrders([]);
    setLiveOrderAlert(null);
    setFetchError('');
    if (isLoggedIn && shopId) void fetchOrdersFromApi(shopId);
  }, [isLoggedIn, shopId, fetchOrdersFromApi]);

  // Subscribe to Supabase Realtime Postgres Changes via WebSocket
  useEffect(() => {
    if (!isLoggedIn || !shopId || !appActive) return;

    setRealtimeStatus('connecting');

    let disposed = false;
    let connected = false;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
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
        () => {
          if (disposed || changeTimer) return;
          changeTimer = setTimeout(() => { changeTimer = undefined; if (!disposed) void fetchOrdersFromApi(shopId, true); }, 200);
        }
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          connected = true;
          setRealtimeStatus('connected');
          void fetchOrdersFromApi(shopId, true);
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          connected = false;
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
      if ((!connected || needsSyncRef.current) && !disposed) void fetchOrdersFromApi(shopId, true);
    }, 30000);

    return () => {
      disposed = true;
      supabase.removeChannel(channel);
      appStateSub.remove();
      clearInterval(safetyInterval);
      clearTimeout(changeTimer);
    };
  }, [isLoggedIn, shopId, appActive, fetchOrdersFromApi, notifyIfBrandNewOrder]);

  return {
    orders,
    setOrders,
    liveOrderAlert,
    setLiveOrderAlert,
    realtimeStatus,
    fetchError,
    fetchOrdersFromApi,
  };
}
