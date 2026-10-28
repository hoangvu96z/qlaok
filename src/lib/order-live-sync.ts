export type OrderLiveStatus = 'connecting' | 'connected' | 'fallback' | 'unauthorized';

export interface OrderLiveSyncHandle {
  (): void;
  reconnect: () => void;
}

export interface CounterTodayTabState {
  todayValidCount: number;
  todayPaidCount: number;
  todayRevenue: number;
  tabOrdersCount: number;
  isHistoryFallback: boolean;
}

export function getVnDateKey(dateInput: Date | string | number = new Date()): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export function filterCounterTodayTabOrders<T extends {
  created_at?: string;
  status: string;
  payment_status?: string;
}>(orders: T[], todayVnKey: string = getVnDateKey()): T[] {
  const hasTodayValidOrders = orders.some(
    (o) => o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayVnKey
  );
  return orders.filter((o) => {
    if (hasTodayValidOrders) {
      return (
        o.status === 'new' ||
        o.status === 'preparing' ||
        (o.status !== 'cancelled' && o.payment_status === 'unpaid') ||
        (o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayVnKey)
      );
    }
    return o.status !== 'cancelled';
  });
}

export function computeCounterTodayTabState<T extends {
  created_at?: string;
  status: string;
  payment_status?: string;
  total_amount?: number | string | null;
}>(params: {
  orders: T[];
  todayVnKey?: string;
}): CounterTodayTabState {
  const todayVnKey = params.todayVnKey ?? getVnDateKey();
  const orders = params.orders;

  const todayValidOrders = orders.filter(
    (o) => o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayVnKey
  );
  const todayPaidOrders = todayValidOrders.filter(
    (o) => o.payment_status === 'paid'
  );
  const todayRevenue = todayPaidOrders.reduce(
    (sum, o) => sum + Number(o.total_amount || 0),
    0
  );

  const hasTodayValidOrders = todayValidOrders.length > 0;
  const tabOrders = orders.filter((o) => {
    if (hasTodayValidOrders) {
      return (
        o.status === 'new' ||
        o.status === 'preparing' ||
        (o.status !== 'cancelled' && o.payment_status === 'unpaid') ||
        (o.status !== 'cancelled' && getVnDateKey(o.created_at) === todayVnKey)
      );
    }
    return o.status !== 'cancelled';
  });

  const isHistoryFallback = !hasTodayValidOrders && tabOrders.length > 0;

  return {
    todayValidCount: todayValidOrders.length,
    todayPaidCount: todayPaidOrders.length,
    todayRevenue,
    tabOrdersCount: tabOrders.length,
    isHistoryFallback,
  };
}

export function resolveCounterTodayTabLabel(params: {
  tabOrdersCount: number | string;
  isHistoryFallback: boolean;
  locale?: string;
  tx?: (
    viText: string,
    enText?: string | null,
    params?: Record<string, string | number | null | undefined>
  ) => string;
}): string {
  const { tabOrdersCount, isHistoryFallback, tx } = params;
  if (tx) {
    if (isHistoryFallback) {
      return tx('Đơn gần đây ({count})', 'Recent orders ({count})', {
        count: tabOrdersCount,
      });
    }
    return tx('Hôm nay & cần xử lý ({count})', 'Today & pending ({count})', {
      count: tabOrdersCount,
    });
  }
  const isEn = params.locale === 'en';
  if (isHistoryFallback) {
    return isEn
      ? `Recent orders (${tabOrdersCount})`
      : `Đơn gần đây (${tabOrdersCount})`;
  }
  return isEn
    ? `Today & pending (${tabOrdersCount})`
    : `Hôm nay & cần xử lý (${tabOrdersCount})`;
}

export interface CounterOrdersSnapshotState {
  shopId: string | null;
  hasLoaded: boolean;
  fetchError: string | null;
}

export interface CounterOrdersFetchOutcome {
  shopId: string;
  activeShopId: string | null | undefined;
  disposed?: boolean;
  ok: boolean;
  status?: number;
  errorMessage?: string | null;
}

export interface CounterOrdersViewState {
  effectiveState: CounterOrdersSnapshotState;
  hasAuthoritativeSnapshot: boolean;
  showSessionExpiredBanner: boolean;
  showInitialLoadErrorState: boolean;
  showRefreshErrorBanner: boolean;
  showConfirmedEmptyQueue: boolean;
}

export function createInitialCounterOrdersState(
  shopId: string | null = null
): CounterOrdersSnapshotState {
  const cleanShopId = typeof shopId === 'string' && shopId.trim() ? shopId.trim() : null;
  return { shopId: cleanShopId, hasLoaded: false, fetchError: null };
}

export function reconcileCounterOrdersFetch(
  prevState: CounterOrdersSnapshotState,
  outcome: CounterOrdersFetchOutcome
): CounterOrdersSnapshotState {
  const shopId = outcome.shopId.trim();
  const activeShopId =
    typeof outcome.activeShopId === 'string' && outcome.activeShopId.trim()
      ? outcome.activeShopId.trim()
      : null;

  if (outcome.disposed || !shopId || shopId !== activeShopId) return prevState;

  const sameShop = prevState.shopId === shopId;
  const hasLoaded = sameShop && prevState.hasLoaded;
  if (outcome.ok) return { shopId, hasLoaded: true, fetchError: null };

  // Keep session failures on the existing sign-in banner, without a second generic error.
  if (outcome.status === 401 || outcome.status === 403) {
    return { shopId, hasLoaded, fetchError: null };
  }

  return {
    shopId,
    hasLoaded,
    fetchError: outcome.errorMessage?.trim() || 'Could not load orders from server.',
  };
}

export function deriveCounterOrdersViewState(params: {
  state: CounterOrdersSnapshotState;
  activeShopId: string | null | undefined;
  loading: boolean;
  liveStatus: OrderLiveStatus;
  sessionExpired: boolean;
  filteredCount: number;
}): CounterOrdersViewState {
  const activeShopId =
    typeof params.activeShopId === 'string' && params.activeShopId.trim()
      ? params.activeShopId.trim()
      : null;
  const effectiveState =
    params.state.shopId === activeShopId
      ? params.state
      : createInitialCounterOrdersState(activeShopId);
  const showSessionExpiredBanner =
    params.sessionExpired || params.liveStatus === 'unauthorized';
  const hasAuthoritativeSnapshot = Boolean(activeShopId && effectiveState.hasLoaded);
  const hasFetchError = Boolean(!showSessionExpiredBanner && effectiveState.fetchError);
  const showInitialLoadErrorState = Boolean(
    !params.loading && !hasAuthoritativeSnapshot && hasFetchError
  );
  const showRefreshErrorBanner = Boolean(hasAuthoritativeSnapshot && hasFetchError);
  const showConfirmedEmptyQueue = Boolean(
    !params.loading && hasAuthoritativeSnapshot && params.filteredCount === 0
  );

  return {
    effectiveState,
    hasAuthoritativeSnapshot,
    showSessionExpiredBanner,
    showInitialLoadErrorState,
    showRefreshErrorBanner,
    showConfirmedEmptyQueue,
  };
}

/** SSE frames may span network chunks; never assume one chunk is one event. */
export async function readOrderEvents(stream: ReadableStream<Uint8Array>, onEvent: (event: { type: string }) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) {
          try { onEvent(JSON.parse(data)); } catch { /* ignore malformed frames */ }
        }
      }
      if (pending.length > 65536) throw new Error('Realtime frame too large');
    }
  } finally { reader.releaseLock(); }
}

/** One authenticated stream per visible screen; HTTP polling only on failure. */
export function startOrderLiveSync(options: {
  query: string;
  headers?: () => Record<string, string>;
  onChange: () => void;
  onStatus?: (status: OrderLiveStatus) => void;
}) {
  let stopped = false;
  let unauthorized = false;
  let connected = false;
  let controller: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let retryDelay = 1000;
  const visible = () => document.visibilityState !== 'hidden';
  const notify = () => {
    if (debounce || stopped || !visible()) return;
    debounce = setTimeout(() => { debounce = undefined; if (!stopped && visible()) options.onChange(); }, 200);
  };
  const status = (value: OrderLiveStatus) => {
    connected = value === 'connected';
    options.onStatus?.(value);
  };
  const connect = async () => {
    if (stopped || unauthorized || !visible() || controller) return;
    const local = new AbortController();
    const scope = ++generation;
    controller = local;
    const deadline = setTimeout(() => local.abort(), 15000);
    status('connecting');
    try {
      const response = await fetch(`/api/orders/events?${options.query}`, {
        headers: { Accept: 'text/event-stream', ...options.headers?.() },
        signal: local.signal, cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        unauthorized = true;
        status('unauthorized');
        return;
      }
      if (!response.ok || !response.body) throw new Error('Realtime unavailable');
      await readOrderEvents(response.body, event => {
        if (stopped || local.signal.aborted || scope !== generation) return;
        if (event.type === 'ready') { clearTimeout(deadline); retryDelay = 1000; status('connected'); notify(); }
        if (event.type === 'change') notify();
        if (event.type === 'fallback') status('fallback');
        if (event.type === 'unauthorized') { unauthorized = true; status('unauthorized'); local.abort(); }
      });
    } catch { /* fallback sync below; preserve existing data */ }
    finally {
      clearTimeout(deadline);
      if (controller === local) controller = null;
      if (!stopped && scope === generation && visible() && !unauthorized) {
        status('fallback');
        const delay = retryDelay;
        retryDelay = Math.min(30000, retryDelay * 2);
        retry = setTimeout(() => { retry = undefined; void connect(); }, delay);
      }
    }
  };
  const fallback = setInterval(() => {
    if (!stopped && !unauthorized && !connected && visible()) notify();
  }, 30000);
  const resume = () => {
    if (!visible()) {
      generation++;
      controller?.abort(); controller = null;
      connected = false;
      clearTimeout(retry); retry = undefined;
      clearTimeout(debounce); debounce = undefined;
    } else if (!unauthorized) { notify(); void connect(); }
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  void connect();
  const stop = (() => {
    stopped = true; generation++;
    controller?.abort();
    clearTimeout(retry); clearTimeout(debounce); clearInterval(fallback);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  }) as OrderLiveSyncHandle;
  stop.reconnect = () => {
    if (stopped || !unauthorized) return;
    unauthorized = false;
    retryDelay = 1000;
    if (visible()) {
      generation++;
      controller?.abort();
      controller = null;
      void connect();
    }
  };
  return stop;
}
