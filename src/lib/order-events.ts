import crypto from 'node:crypto';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { dbGetOrderById } from '@/lib/mpos-store';
import { requireShopPermission } from '@/lib/server-auth';
import { getSupabaseAnonKey } from '@/lib/supabase/client';

export type OrderSseEvent =
  | { type: 'ready' }
  | { type: 'fallback' }
  | { type: 'unauthorized' }
  | { type: 'change'; orderId?: string; shopId?: string };

export interface PostgresOrderChangePayload {
  table?: string;
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

export interface RealtimeChannelLike {
  on(
    type: 'postgres_changes',
    filter: {
      event: '*';
      schema: 'public';
      table: 'orders' | 'table_service_requests';
    },
    callback: (payload: PostgresOrderChangePayload) => void
  ): this;
  subscribe(callback?: (status: string, err?: Error) => void): this;
  unsubscribe?: () => Promise<unknown> | unknown;
}

export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel?: (channel: RealtimeChannelLike) => Promise<unknown> | unknown;
  realtime?: {
    setAuth?: (token: string) => void;
  };
}

export interface OrderEventsSubscriptionInput {
  shopId?: string;
  orderId?: string;
  onEvent: (event: OrderSseEvent) => void;
}

export interface OrderEventsBrokerOptions {
  createClient?: () => RealtimeClientLike | null;
  maxClients?: number;
  reconnectDelayMs?: number;
}

export interface OrderEventsStreamOptions {
  broker?: OrderEventsBroker;
  heartbeatIntervalMs?: number;
  revalidateIntervalMs?: number;
  maxStreamLifetimeMs?: number;
}

const DEFAULT_MAX_BROKER_CLIENTS = 500;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_REVALIDATE_INTERVAL_MS = 45_000; // <= 60s requirement
const DEFAULT_MAX_STREAM_LIFETIME_MS = 120_000; // ~2 minutes
const MAX_ORDER_SHOP_CACHE_SIZE = 2_000;

let testRealtimeClientFactory: (() => RealtimeClientLike | null) | null = null;
let testStreamOptionsOverride: OrderEventsStreamOptions | null = null;

export function setOrderEventsClientFactoryForTests(
  factory: (() => RealtimeClientLike | null) | null
): void {
  testRealtimeClientFactory = factory;
}

export function setOrderEventsStreamOptionsForTests(
  options: OrderEventsStreamOptions | null
): void {
  testStreamOptionsOverride = options;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function pickNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getConfiguredBackendKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();
}

export function isValidRealtimeBackendKey(rawKey?: string): boolean {
  const key = (rawKey ?? getConfiguredBackendKey()).trim();
  if (!key) return false;
  if (key.startsWith('sb_publishable_')) return false;

  const anonKey = (getSupabaseAnonKey() || '').trim();
  if (anonKey && key === anonKey) return false;

  const jwtParts = key.split('.');
  if (jwtParts.length === 3 && jwtParts[1]) {
    try {
      const payload = JSON.parse(
        Buffer.from(jwtParts[1], 'base64url').toString('utf8')
      ) as { role?: string };
      return payload.role === 'service_role';
    } catch {
      return false;
    }
  }
  return /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
}

export function hasRealtimeBackendConfig(): boolean {
  if (testRealtimeClientFactory !== null) return true;
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  if (!url || url.includes('your-project')) return false;
  return isValidRealtimeBackendKey();
}

export function isRealtimeBackendMisconfigured(): boolean {
  if (testRealtimeClientFactory !== null) return false;
  const rawKey = getConfiguredBackendKey();
  if (rawKey && !isValidRealtimeBackendKey(rawKey)) {
    return true;
  }
  if (process.env.NODE_ENV === 'production' && !hasRealtimeBackendConfig()) {
    return true;
  }
  return false;
}

function createDefaultRealtimeClient(): RealtimeClientLike | null {
  if (testRealtimeClientFactory !== null) {
    return testRealtimeClientFactory();
  }
  if (!hasRealtimeBackendConfig()) {
    return null;
  }
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = getConfiguredBackendKey();
  const client = createSupabaseJsClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client as unknown as RealtimeClientLike;
}

interface InternalSubscriber {
  id: string;
  shopId?: string;
  orderId?: string;
  onEvent: (event: OrderSseEvent) => void;
}

export class OrderEventsBroker {
  private readonly createClientFn: () => RealtimeClientLike | null;
  private readonly maxClients: number;
  private readonly reconnectDelayMs: number;

  private readonly clients = new Map<string, InternalSubscriber>();
  private readonly shopSubscribers = new Map<string, Set<InternalSubscriber>>();
  private readonly orderSubscribers = new Map<string, Set<InternalSubscriber>>();
  private readonly orderShopCache = new Map<string, string>();

  private upstreamClient: RealtimeClientLike | null = null;
  private upstreamChannel: RealtimeChannelLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'idle' | 'connecting' | 'subscribed' | 'fallback' = 'idle';
  private hasSubscribedOnce = false;
  private activeUpstreamChannels = 0;
  private totalUpstreamSubscribes = 0;

  constructor(options: OrderEventsBrokerOptions = {}) {
    this.createClientFn = options.createClient ?? createDefaultRealtimeClient;
    this.maxClients = options.maxClients ?? DEFAULT_MAX_BROKER_CLIENTS;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  public getActiveClientCount(): number {
    return this.clients.size;
  }

  public getActiveUpstreamChannelCount(): number {
    return this.activeUpstreamChannels;
  }

  public getTotalUpstreamSubscribes(): number {
    return this.totalUpstreamSubscribes;
  }

  public getStatus(): 'idle' | 'connecting' | 'subscribed' | 'fallback' {
    return this.status;
  }

  public rememberOrderShop(orderId: string, shopId: string): void {
    const cleanOrderId = pickNonEmptyString(orderId);
    const cleanShopId = pickNonEmptyString(shopId);
    if (!cleanOrderId || !cleanShopId) return;
    if (this.orderShopCache.has(cleanOrderId)) {
      this.orderShopCache.delete(cleanOrderId);
    } else if (this.orderShopCache.size >= MAX_ORDER_SHOP_CACHE_SIZE) {
      const oldestKey = this.orderShopCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.orderShopCache.delete(oldestKey);
      }
    }
    this.orderShopCache.set(cleanOrderId, cleanShopId);
  }

  public subscribeClient(input: OrderEventsSubscriptionInput): () => void {
    const shopId = pickNonEmptyString(input.shopId);
    const orderId = pickNonEmptyString(input.orderId);
    if ((!shopId && !orderId) || (shopId && orderId)) {
      throw new Error(
        'OrderEventsBroker.subscribeClient requires exactly one of shopId or orderId.'
      );
    }
    if (this.clients.size >= this.maxClients) {
      throw new Error('ORDER_EVENTS_BROKER_CAPACITY_EXCEEDED');
    }

    const subscriber: InternalSubscriber = {
      id: crypto.randomUUID(),
      shopId,
      orderId,
      onEvent: input.onEvent,
    };

    this.clients.set(subscriber.id, subscriber);
    if (shopId) {
      let bucket = this.shopSubscribers.get(shopId);
      if (!bucket) {
        bucket = new Set();
        this.shopSubscribers.set(shopId, bucket);
      }
      bucket.add(subscriber);
    }
    if (orderId) {
      let bucket = this.orderSubscribers.get(orderId);
      if (!bucket) {
        bucket = new Set();
        this.orderSubscribers.set(orderId, bucket);
      }
      bucket.add(subscriber);
    }

    if (this.status === 'idle') {
      this.ensureUpstream();
    } else if (this.status === 'subscribed') {
      subscriber.onEvent({ type: 'ready' });
    } else if (this.status === 'fallback') {
      subscriber.onEvent({ type: 'fallback' });
      if (!this.upstreamChannel && !this.reconnectTimer) {
        this.ensureUpstream();
      }
    }

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.clients.delete(subscriber.id);
      if (shopId) {
        const bucket = this.shopSubscribers.get(shopId);
        if (bucket) {
          bucket.delete(subscriber);
          if (bucket.size === 0) {
            this.shopSubscribers.delete(shopId);
          }
        }
      }
      if (orderId) {
        const bucket = this.orderSubscribers.get(orderId);
        if (bucket) {
          bucket.delete(subscriber);
          if (bucket.size === 0) {
            this.orderSubscribers.delete(orderId);
          }
        }
      }

      if (this.clients.size === 0) {
        this.teardownUpstream();
      }
    };
  }

  private ensureUpstream(): void {
    if (this.upstreamChannel || this.clients.size === 0) {
      return;
    }

    let client: RealtimeClientLike | null = null;
    try {
      client = this.createClientFn();
    } catch {
      client = null;
    }

    if (!client) {
      this.status = 'fallback';
      this.broadcastControl({ type: 'fallback' });
      return;
    }

    this.upstreamClient = client;
    this.status = 'connecting';
    const channel = client.channel('qlaok-orders-broker');
    this.upstreamChannel = channel;
    this.activeUpstreamChannels += 1;
    this.totalUpstreamSubscribes += 1;

    const onPostgresChange = (payload: PostgresOrderChangePayload) => {
      if (this.upstreamChannel !== channel) return;
      this.handlePostgresChange(payload);
    };

    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        onPostgresChange
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'table_service_requests' },
        onPostgresChange
      )
      .subscribe((status) => {
        if (this.upstreamChannel !== channel) return;

        if (status === 'SUBSCRIBED') {
          this.clearReconnectTimer();
          const isResync =
            this.hasSubscribedOnce || this.status === 'fallback';
          this.hasSubscribedOnce = true;
          this.status = 'subscribed';
          for (const sub of this.clients.values()) {
            try {
              sub.onEvent({ type: 'ready' });
              if (isResync) {
                sub.onEvent({
                  type: 'change',
                  ...(sub.orderId ? { orderId: sub.orderId } : {}),
                  ...(sub.shopId ? { shopId: sub.shopId } : {}),
                });
              }
            } catch {
              // ignore individual listener errors
            }
          }
          return;
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          this.status = 'fallback';
          this.broadcastControl({ type: 'fallback' });
          this.scheduleReconnect();
        }
      });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.clients.size === 0) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.clients.size === 0) return;
      this.releaseUpstreamChannel();
      this.ensureUpstream();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private releaseUpstreamChannel(): void {
    const channel = this.upstreamChannel;
    const client = this.upstreamClient;
    this.upstreamChannel = null;
    this.upstreamClient = null;
    if (channel) {
      this.activeUpstreamChannels = Math.max(0, this.activeUpstreamChannels - 1);
      try {
        if (client?.removeChannel) {
          void Promise.resolve(client.removeChannel(channel)).catch(() => {});
        } else if (channel.unsubscribe) {
          void Promise.resolve(channel.unsubscribe()).catch(() => {});
        }
      } catch {
        // ignore channel cleanup errors
      }
    }
  }

  private teardownUpstream(): void {
    this.clearReconnectTimer();
    this.releaseUpstreamChannel();
    this.status = 'idle';
    this.hasSubscribedOnce = false;
  }

  public reset(): void {
    this.clients.clear();
    this.shopSubscribers.clear();
    this.orderSubscribers.clear();
    this.orderShopCache.clear();
    this.teardownUpstream();
    this.activeUpstreamChannels = 0;
    this.totalUpstreamSubscribes = 0;
  }

  private broadcastControl(
    event: { type: 'ready' } | { type: 'fallback' }
  ): void {
    for (const sub of this.clients.values()) {
      try {
        sub.onEvent(event);
      } catch {
        // ignore individual listener errors
      }
    }
  }

  public notifyShopChange(shopId: string): void {
    const cleanShopId = pickNonEmptyString(shopId);
    if (!cleanShopId) return;
    const shopSet = this.shopSubscribers.get(cleanShopId);
    if (!shopSet || shopSet.size === 0) return;

    const minimalEvent: OrderSseEvent = {
      type: 'change',
      shopId: cleanShopId,
    };

    for (const sub of shopSet) {
      try {
        sub.onEvent(minimalEvent);
      } catch {
        // ignore individual stream failure
      }
    }
  }

  private handlePostgresChange(payload: PostgresOrderChangePayload): void {
    const nextRow =
      payload?.new && typeof payload.new === 'object' ? payload.new : null;
    const oldRow =
      payload?.old && typeof payload.old === 'object' ? payload.old : null;

    const isServiceRequestRow =
      payload?.table === 'table_service_requests' ||
      pickNonEmptyString(nextRow?.request_type) !== undefined ||
      pickNonEmptyString(oldRow?.request_type) !== undefined;

    if (isServiceRequestRow) {
      const serviceShopId =
        pickNonEmptyString(nextRow?.shop_id) ??
        pickNonEmptyString(oldRow?.shop_id);
      if (serviceShopId) {
        this.notifyShopChange(serviceShopId);
      }
      return;
    }

    const orderId =
      pickNonEmptyString(nextRow?.id) ?? pickNonEmptyString(oldRow?.id);
    let shopId =
      pickNonEmptyString(nextRow?.shop_id) ??
      pickNonEmptyString(oldRow?.shop_id);

    if (orderId && shopId) {
      this.rememberOrderShop(orderId, shopId);
    } else if (orderId && !shopId) {
      shopId = this.orderShopCache.get(orderId);
    }

    if (!orderId && !shopId) {
      return;
    }

    const minimalEvent: OrderSseEvent = {
      type: 'change',
      ...(orderId ? { orderId } : {}),
      ...(shopId ? { shopId } : {}),
    };

    const notified = new Set<InternalSubscriber>();
    if (shopId) {
      const shopSet = this.shopSubscribers.get(shopId);
      if (shopSet) {
        for (const sub of shopSet) {
          notified.add(sub);
        }
      }
    }
    if (orderId) {
      const orderSet = this.orderSubscribers.get(orderId);
      if (orderSet) {
        for (const sub of orderSet) {
          notified.add(sub);
        }
      }
    }

    for (const sub of notified) {
      try {
        sub.onEvent(minimalEvent);
      } catch {
        // ignore individual stream failure
      }
    }
  }
}

let globalOrderEventsBroker: OrderEventsBroker | null = null;

export function getOrderEventsBroker(): OrderEventsBroker {
  if (!globalOrderEventsBroker) {
    globalOrderEventsBroker = new OrderEventsBroker();
  }
  return globalOrderEventsBroker;
}

export function resetOrderEventsBrokerForTests(): void {
  if (globalOrderEventsBroker) {
    globalOrderEventsBroker.reset();
    globalOrderEventsBroker = null;
  }
}

export function formatSseEvent(event: OrderSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function verifyGuestOrderTrackingToken(
  orderId: string,
  trackingToken: string
): Promise<{ valid: boolean; shopId?: string }> {
  if (!orderId || !trackingToken) {
    return { valid: false };
  }
  const order = await dbGetOrderById(orderId);
  if (
    !order ||
    typeof order.tracking_token !== 'string' ||
    !order.tracking_token ||
    !timingSafeStringEqual(trackingToken, order.tracking_token)
  ) {
    return { valid: false };
  }
  return { valid: true, shopId: order.shop_id };
}

export async function handleOrderEventsRequest(
  req: Request,
  options?: OrderEventsStreamOptions
): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const shopId = (searchParams.get('shopId') || '').trim();
  const orderId = (searchParams.get('orderId') || '').trim();

  if ((!shopId && !orderId) || (shopId && orderId)) {
    return NextResponse.json(
      {
        error:
          'Yêu cầu cung cấp chính xác một trong hai tham số truy vấn: shopId hoặc orderId.',
      },
      { status: 400 }
    );
  }

  if (isRealtimeBackendMisconfigured()) {
    return NextResponse.json(
      {
        error:
          'Realtime order broker chưa được cấu hình khóa máy chủ hợp lệ (SUPABASE_SERVICE_ROLE_KEY).',
        code: 'REALTIME_BACKEND_KEY_MISSING',
      },
      { status: 503 }
    );
  }

  const resolvedOptions: OrderEventsStreamOptions = {
    ...testStreamOptionsOverride,
    ...options,
  };
  const broker = resolvedOptions.broker ?? getOrderEventsBroker();
  const heartbeatIntervalMs =
    resolvedOptions.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const revalidateIntervalMs = Math.min(
    resolvedOptions.revalidateIntervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS,
    60_000
  );
  const maxStreamLifetimeMs =
    resolvedOptions.maxStreamLifetimeMs ?? DEFAULT_MAX_STREAM_LIFETIME_MS;

  let trackingToken = '';
  if (shopId) {
    const auth = await requireShopPermission(req, shopId, 'orders.view');
    if (auth.errorResponse) {
      return auth.errorResponse;
    }
  } else {
    trackingToken = (req.headers.get('x-tracking-token') || '').trim();
    if (!trackingToken) {
      return NextResponse.json(
        {
          error:
            'Thiếu header x-tracking-token để theo dõi trạng thái đơn hàng.',
        },
        { status: 401 }
      );
    }
    const check = await verifyGuestOrderTrackingToken(orderId, trackingToken);
    if (!check.valid) {
      return NextResponse.json(
        {
          error:
            'Mã theo dõi đơn hàng (x-tracking-token) không hợp lệ hoặc không khớp.',
        },
        { status: 403 }
      );
    }
    if (check.shopId) {
      broker.rememberOrderShop(orderId, check.shopId);
    }
  }

  if (req.signal?.aborted) {
    return new Response(null, { status: 499 });
  }

  const encoder = new TextEncoder();
  let cleanupStream: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribeBroker: (() => void) | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let revalidateTimer: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
      let revalidating = false;

      const writeRaw = (chunk: string) => {
        if (closed) return;
        if (controller.desiredSize !== null && controller.desiredSize <= 0) { close(); return; }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const sendEvent = (event: OrderSseEvent) => {
        writeRaw(formatSseEvent(event));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (revalidateTimer) {
          clearInterval(revalidateTimer);
          revalidateTimer = null;
        }
        if (lifetimeTimer) {
          clearTimeout(lifetimeTimer);
          lifetimeTimer = null;
        }
        if (unsubscribeBroker) {
          const unsub = unsubscribeBroker;
          unsubscribeBroker = null;
          unsub();
        }
        req.signal?.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      cleanupStream = close;
      req.signal?.addEventListener('abort', close, { once: true });

      // Initial comment frame to flush SSE headers immediately without faking ready
      writeRaw(': stream-open\n\n');

      try {
        unsubscribeBroker = broker.subscribeClient({
          shopId: shopId || undefined,
          orderId: orderId || undefined,
          onEvent: sendEvent,
        });
      } catch {
        sendEvent({ type: 'fallback' });
        close();
        return;
      }

      // Heartbeat only writes a comment frame; never queries DB or scans tables
      heartbeatTimer = setInterval(() => {
        writeRaw(': heartbeat\n\n');
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();

      // Periodic revalidation of shop permission or guest tracking token (<= 60s)
      revalidateTimer = setInterval(async () => {
        if (closed || revalidating) return;
        revalidating = true;
        try {
          if (shopId) {
            const recheck = await requireShopPermission(
              req,
              shopId,
              'orders.view'
            );
            if (recheck.errorResponse && !closed) {
              sendEvent({ type: 'unauthorized' });
              close();
            }
          } else {
            const recheck = await verifyGuestOrderTrackingToken(
              orderId,
              trackingToken
            );
            if (!recheck.valid && !closed) {
              sendEvent({ type: 'unauthorized' });
              close();
            }
          }
        } catch {
          // Stop delivering invalidations until authorization can be established
          // again; the client reconnects and uses its slower HTTP fallback.
          if (!closed) { sendEvent({ type: 'fallback' }); close(); }
        } finally {
          revalidating = false;
        }
      }, revalidateIntervalMs);
      revalidateTimer.unref?.();

      // Bounded stream lifetime (~2 minutes) so clients periodically reconnect cleanly
      lifetimeTimer = setTimeout(() => {
        close();
      }, maxStreamLifetimeMs);
      lifetimeTimer.unref?.();
    },
    cancel() {
      cleanupStream?.();
    },
  }, { highWaterMark: 65536, size: chunk => chunk.byteLength });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
