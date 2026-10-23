export type OrderLiveStatus = 'connecting' | 'connected' | 'fallback' | 'unauthorized';

export interface OrderLiveSyncHandle {
  (): void;
  reconnect: () => void;
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
    if (stopped) return;
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
