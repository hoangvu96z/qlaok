import crypto from 'node:crypto';
import { Client as PgClient } from 'pg';
import { NextResponse } from 'next/server';
import { dbGetOrderById } from '@/lib/mpos-store';
import { requireShopPermission } from '@/lib/server-auth';
import { getSupabaseAnonKey } from '@/lib/supabase/client';

export type OrderSseEvent =
  | { type: 'ready' }
  | { type: 'fallback' }
  | { type: 'unauthorized' }
  | { type: 'change'; orderId?: string; shopId?: string };

export const DEFAULT_POSTGRES_CHANNEL = 'qlaok_order_events';

export interface PostgresNotificationMessage {
  channel: string;
  payload?: string;
}

type PostgresClientEventName = 'notification' | 'error' | 'end';
type PostgresClientEventListener =
  | ((message: PostgresNotificationMessage) => void)
  | (() => void);

export interface PostgresOrderNotification {
  table?: string;
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  action?: string;
  orderId?: string;
  order_id?: string;
  shopId?: string;
  shop_id?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

export interface PostgresListenerClientLike {
  connect?: () => Promise<unknown> | unknown;
  query?: (sql: string, params?: unknown[]) => Promise<unknown> | unknown;
  on?(event: PostgresClientEventName, listener: PostgresClientEventListener): unknown;
  removeListener?(event: PostgresClientEventName, listener: PostgresClientEventListener): unknown;
  end?: () => Promise<unknown> | unknown;
}

export interface OrderEventsSubscriptionInput {
  shopId?: string;
  orderId?: string;
  onEvent: (event: OrderSseEvent) => void;
}

export type PostgresClientFactory = () =>
  | PostgresListenerClientLike
  | null
  | Promise<PostgresListenerClientLike | null>;

export interface OrderEventsBrokerOptions {
  createClient?: PostgresClientFactory;
  maxClients?: number;
  reconnectDelayMs?: number;
  channelName?: string;
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

let testRealtimeClientFactory: PostgresClientFactory | null = null;
let testStreamOptionsOverride: OrderEventsStreamOptions | null = null;

export function setOrderEventsClientFactoryForTests(
  factory: PostgresClientFactory | null
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

function getPostgresConnectionString(): string {
  return (
    process.env.QLAOK_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    ''
  ).trim();
}

export function isValidPostgresUrl(raw?: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('postgres://') ||
    trimmed.startsWith('postgresql://')
  );
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
  const conn = getPostgresConnectionString();
  if (conn && isValidPostgresUrl(conn)) return true;
  return false;
}

export function isRealtimeBackendMisconfigured(): boolean {
  if (testRealtimeClientFactory !== null) return false;
  const rawConn = getPostgresConnectionString();
  if (rawConn && !isValidPostgresUrl(rawConn)) {
    return true;
  }
  const rawKey = getConfiguredBackendKey();
  if (rawKey && !isValidRealtimeBackendKey(rawKey)) {
    return true;
  }
  if (process.env.NODE_ENV === 'production' && !hasRealtimeBackendConfig()) {
    return true;
  }
  return false;
}

function createDefaultPostgresClient(): PostgresListenerClientLike | null {
  if (testRealtimeClientFactory !== null) {
    const res = testRealtimeClientFactory();
    return res as PostgresListenerClientLike | null;
  }
  const connectionString = getPostgresConnectionString();
  if (!connectionString || !isValidPostgresUrl(connectionString)) {
    return null;
  }
  try {
    const client = new PgClient({
      connectionString,
      ssl:
        connectionString.includes('sslmode=require') ||
        connectionString.includes('supabase.co')
          ? { rejectUnauthorized: false }
          : undefined,
    });
    // The pg client's generic event overload is narrower than this small adapter
    // interface, while the events used by the broker match its runtime contract.
    return client as unknown as PostgresListenerClientLike;
  } catch {
    return null;
  }
}

interface InternalSubscriber {
  id: string;
  shopId?: string;
  orderId?: string;
  onEvent: (event: OrderSseEvent) => void;
}

export class OrderEventsBroker {
  private readonly createClientFn: PostgresClientFactory;
  private readonly maxClients: number;
  private readonly reconnectDelayMs: number;
  private readonly channelName: string;

  private readonly clients = new Map<string, InternalSubscriber>();
  private readonly shopSubscribers = new Map<string, Set<InternalSubscriber>>();
  private readonly orderSubscribers = new Map<string, Set<InternalSubscriber>>();
  private readonly orderShopCache = new Map<string, string>();

  private upstreamClient: PostgresListenerClientLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: 'idle' | 'connecting' | 'subscribed' | 'fallback' = 'idle';
  private hasSubscribedOnce = false;
  private activeUpstreamChannels = 0;
  private totalUpstreamSubscribes = 0;

  constructor(options: OrderEventsBrokerOptions = {}) {
    this.createClientFn = options.createClient ?? createDefaultPostgresClient;
    this.maxClients = options.maxClients ?? DEFAULT_MAX_BROKER_CLIENTS;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.channelName = options.channelName ?? DEFAULT_POSTGRES_CHANNEL;
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
      if (!this.upstreamClient && !this.reconnectTimer) {
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
    if (this.upstreamClient || this.clients.size === 0) {
      return;
    }

    let client: PostgresListenerClientLike | null = null;
    try {
      const produced = this.createClientFn();
      if (produced && typeof (produced as Promise<unknown>).then === 'function') {
        Promise.resolve(produced).then(
          (c) => {
            if (this.clients.size === 0) {
              try {
                c?.end?.();
              } catch {}
              return;
            }
            if (c) {
              this.attachUpstream(c);
            } else {
              this.status = 'fallback';
              this.broadcastControl({ type: 'fallback' });
              this.scheduleReconnect();
            }
          },
          () => {
            this.status = 'fallback';
            this.broadcastControl({ type: 'fallback' });
            this.scheduleReconnect();
          }
        );
        return;
      }
      client = produced as PostgresListenerClientLike | null;
    } catch {
      client = null;
    }

    if (!client) {
      this.status = 'fallback';
      this.broadcastControl({ type: 'fallback' });
      this.scheduleReconnect();
      return;
    }

    this.attachUpstream(client);
  }

  private attachUpstream(client: PostgresListenerClientLike): void {
    if (this.clients.size === 0) {
      try {
        client.end?.();
      } catch {}
      return;
    }

    // Native PostgreSQL LISTEN connection
    this.upstreamClient = client;
    this.status = 'connecting';
    this.activeUpstreamChannels = 1;
    this.totalUpstreamSubscribes += 1;

    let localDisposed = false;

    const onNotification = (msg: PostgresNotificationMessage) => {
      if (this.upstreamClient !== client || localDisposed) return;
      if (msg.channel && msg.channel !== this.channelName) return;
      if (!msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload);
        this.handlePostgresNotification(parsed);
      } catch {
        // ignore unparseable payloads
      }
    };

    const onErrorOrClose = () => {
      if (this.upstreamClient !== client || localDisposed) return;
      localDisposed = true;
      this.status = 'fallback';
      this.broadcastControl({ type: 'fallback' });
      this.scheduleReconnect();
    };

    if (typeof client.on === 'function') {
      client.on('notification', onNotification);
      client.on('error', onErrorOrClose);
      client.on('end', onErrorOrClose);
    }

    const startListening = async () => {
      try {
        if (typeof client.connect === 'function') {
          await client.connect();
        }
        if (this.upstreamClient !== client || localDisposed) return;

        if (typeof client.query === 'function') {
          await client.query(`LISTEN ${this.channelName}`);
        }
        if (this.upstreamClient !== client || localDisposed) return;

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
          } catch {}
        }
      } catch {
        onErrorOrClose();
      }
    };

    void startListening();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.clients.size === 0) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.clients.size === 0) return;
      this.releaseUpstreamClient();
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

  private releaseUpstreamClient(): void {
    const client = this.upstreamClient;
    this.upstreamClient = null;
    this.activeUpstreamChannels = 0;

    if (client) {
      try {
        if (typeof client.end === 'function') {
          void Promise.resolve(client.end()).catch(() => {});
        }
      } catch {
        // ignore client cleanup errors
      }
    }
  }

  private teardownUpstream(): void {
    this.clearReconnectTimer();
    this.releaseUpstreamClient();
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

  public notifyOrderChange(shopId: string, orderId?: string): void {
    const cleanShopId = pickNonEmptyString(shopId);
    const cleanOrderId = pickNonEmptyString(orderId);
    if (!cleanShopId && !cleanOrderId) return;

    if (cleanOrderId && cleanShopId) {
      this.rememberOrderShop(cleanOrderId, cleanShopId);
    }

    const minimalEvent: OrderSseEvent = {
      type: 'change',
      ...(cleanOrderId ? { orderId: cleanOrderId } : {}),
      ...(cleanShopId ? { shopId: cleanShopId } : {}),
    };

    const notified = new Set<InternalSubscriber>();
    if (cleanShopId) {
      const shopSet = this.shopSubscribers.get(cleanShopId);
      if (shopSet) {
        for (const sub of shopSet) {
          notified.add(sub);
        }
      }
    }
    if (cleanOrderId) {
      const orderSet = this.orderSubscribers.get(cleanOrderId);
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

  public handlePostgresNotification(payload: PostgresOrderNotification): void {
    if (!payload || typeof payload !== 'object') return;

    const table =
      pickNonEmptyString(payload.table) ??
      (pickNonEmptyString(payload.new?.request_type) !== undefined ||
      pickNonEmptyString(payload.old?.request_type) !== undefined
        ? 'table_service_requests'
        : 'orders');

    const nextRow =
      payload.new && typeof payload.new === 'object' ? payload.new : null;
    const oldRow =
      payload.old && typeof payload.old === 'object' ? payload.old : null;

    if (table === 'table_service_requests') {
      const serviceShopId =
        pickNonEmptyString(payload.shopId) ??
        pickNonEmptyString(payload.shop_id) ??
        pickNonEmptyString(nextRow?.shop_id) ??
        pickNonEmptyString(oldRow?.shop_id);

      if (serviceShopId) {
        this.notifyShopChange(serviceShopId);
      }
      return;
    }

    const orderId =
      pickNonEmptyString(payload.orderId) ??
      pickNonEmptyString(payload.order_id) ??
      pickNonEmptyString(nextRow?.id) ??
      pickNonEmptyString(oldRow?.id);

    let shopId =
      pickNonEmptyString(payload.shopId) ??
      pickNonEmptyString(payload.shop_id) ??
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

    // Deliver ONLY the minimal IDs to authorized shop/order subscribers
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
          'Realtime order broker chưa được cấu hình cơ sở dữ liệu PostgreSQL hợp lệ (QLAOK_DATABASE_URL).',
        code: 'REALTIME_BACKEND_CONFIG_MISSING',
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
