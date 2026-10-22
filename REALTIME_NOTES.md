# Qlaok Server-Brokered Order Realtime Notes (`REALTIME_NOTES.md`)

## 1. Security & Architecture Overview

- **Why a Server Broker instead of Browser Supabase Realtime**:
  - Qlaok web sessions authenticate with custom HMAC-signed application session tokens (`qlaok_session` / `Authorization: Bearer ...`), not Supabase Auth JWTs.
  - Guest storefront order tracking uses per-order `tracking_token` secrets (`x-tracking-token` header).
  - Subscribing directly from the browser with the public anon/publishable key would either fail under RLS (`003_security_rls_and_atomic_mpos.sql` / `004_memberships_billing_payments_audit.sql`) or require weakening RLS on `public.orders`.
- **Single Upstream Privileged Subscription**:
  - `src/lib/order-events.ts` maintains a bounded, reference-counted singleton `OrderEventsBroker`.
  - When at least one authorized SSE client is connected, the broker opens a single server-side Supabase Realtime `postgres_changes` channel (`event: '*'`, `schema: 'public'`, `table: 'orders'` and `table: 'table_service_requests'`) authenticated exclusively with the backend `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`), and also broadcasts immediate `{ "type": "change", "shopId" }` invalidations via `notifyShopChange(shopId)` when table service requests (`call_staff` / `request_bill`) are created or updated.
  - The backend key is validated (`isValidRealtimeBackendKey`) to reject empty keys, `sb_publishable_*` keys, keys equal to the public anon key, and JWTs whose `role` claim is not `service_role`.
  - When the last SSE client disconnects, the upstream Realtime channel and any reconnect timers are immediately torn down (`getActiveUpstreamChannelCount() === 0`).

## 2. Endpoint Authorization & Revalidation (`GET /api/orders/events`)

- **Staff / Merchant Mode (`?shopId=...`)**:
  - Requires `requireShopPermission(req, shopId, 'orders.view')`.
  - Revalidates membership and `orders.view` permission every `<= 60s` (`45s` default). If a member is deactivated or `orders.view` is revoked, `{ "type": "unauthorized" }` is emitted and the stream is immediately closed.
- **Guest Order Tracker Mode (`?orderId=...`)**:
  - Requires header `x-tracking-token` verified with `crypto.timingSafeEqual` against `dbGetOrderById(orderId).tracking_token` (query string tokens are not accepted as a substitute for the header).
  - Revalidates the order's `tracking_token` by primary-key lookup (`dbGetOrderById`) every `<= 60s` (`45s` default).
- **No Table-Scan per Heartbeat**:
  - SSE `: heartbeat\n\n` frames are sent every `15s` purely as socket keep-alive comments without touching the database or local store.
  - Streams have a bounded lifetime (`~2 minutes`) and clean up on `req.signal` `abort` or `ReadableStream.cancel()`.

## 3. Minimal Event Payload & Fallback Semantics

- **Events emitted (`data: <JSON>\n\n`)**:
  - `{ "type": "ready" }`: Emitted only when the upstream Supabase Realtime channel is genuinely `SUBSCRIBED` (never faked on initial HTTP connection).
  - `{ "type": "change", "orderId"?: string, "shopId"?: string }`: Emitted only to subscribers matching `shopId` or `orderId`, and also emitted upon upstream reconnect `SUBSCRIBED` to trigger client resync. Contains zero customer, item, or payment fields.
  - `{ "type": "fallback" }`: Emitted on upstream channel errors/timeouts (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) or in non-production local test mode when no backend Supabase Realtime key is configured, instructing clients (`src/lib/order-live-sync.ts`) to use 30-second fallback polling.
  - `{ "type": "unauthorized" }`: Emitted when periodic revalidation detects revoked permissions or invalidated tokens.
- **Production Missing Key Handling**:
  - In `NODE_ENV === 'production'` (or if an invalid non-service-role key such as `sb_publishable_*` is configured), `GET /api/orders/events` returns `503 Service Unavailable`.

## 4. Migration Publication Inspection (`002` vs `006`)

- Inspected `supabase/migrations/002_mpos_orders_inventory.sql`:
  - `002_mpos_orders_inventory.sql` created `public.orders` and enabled RLS, but did **not** add `public.orders` to the `supabase_realtime` publication.
  - `supabase/migrations/006_orders_realtime_publication.sql` already exists in the workspace and idempotently executes `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;` when `supabase_realtime` exists and `public.orders` is not yet a member.
  - No SQL files were modified.

## Frontend integration and verification

- Both the dashboard shell (`src/app/(dashboard)/dashboard/layout.tsx`) and the web
  counter (`src/app/(dashboard)/dashboard/orders/page.tsx`) use authenticated fetch SSE
  (`order-live-sync.ts` with `getAuthHeaders()`) because legacy Qlaok HMAC sessions
  cannot authorize Supabase Postgres Changes directly. The legacy 3.5-second
  unauthenticated shell polling loop has been removed.
- While connected, no interval reloads orders/catalog. On failure only, data sync
  runs every 30 seconds; reconnects back off to 30 seconds. Hidden tabs disconnect
  and stop polling. Resume/subscription-ready refreshes canonical API data.
- Events are debounced and requests serialized, with a trailing refresh for an
  event received during a request. Shop-switch generations reject stale responses
  and clear old-shop badges and toast notifications; language changes use a
  translation ref without tearing down the live subscription or clearing known order IDs.
  Duplicate sound/browser alerts are suppressed in the shell when `/dashboard/orders`
  is active and already handling order alerts.
- Catalog loads on entry/manual refresh. Order refreshes reuse catalog items already
  returned by `/api/orders`, without a separate `/api/catalog` request each time.
  Catalog lookup now filters the shop in SQL and limits it to one row.
- Guest tracker connects only while open with a valid tracking token; closes after
  cancellation/refund or completion+paid. It never subscribes to public order rows.
- Mobile pauses the subscription in background, debounces events, resyncs on
  subscription and uses its 30s fallback only when disconnected/HTTP sync failed.
- Client tests cover split SSE frames, coalescing, idle connected behavior, fallback,
  authentication rejection, hidden screens and unmount cleanup. SQL test verifies
  publication membership and migration replay safety in isolated PostgreSQL.
- Browser fixture test: actual Next UI rendered `LIVE-1` on an injected SSE event;
  idle counts remained bounded without 3.5-second shell polling, and browser console
  had no errors. Screenshot `/tmp/qlaok-realtime-ui/live-order.png`.
- Deployment runs `scripts/check-order-realtime.mjs` on VPS using runtime config,
  verifies SUBSCRIBED on real `public.orders`, and logs no keys/order payloads.
  SSE response disables proxy buffering. Revalidation failures close the stream
  until authorization can be checked again; slow consumer queues are bounded.
- Remaining scope: list/statistics still use full order history on a refresh;
  SQL aggregates/pagination can reduce payload further as history grows. Catalog
  changes alone appear on entry/manual refresh; this change streams order events.
