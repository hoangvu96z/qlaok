import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildOrderEventsSseHeaders,
  buildOrderEventsSseUrl,
  processOrderSseMessage,
} from '../src/lib/realtime-orders.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('buildOrderEventsSseUrl and buildOrderEventsSseHeaders construct safe authenticated SSE contracts', () => {
  const url = buildOrderEventsSseUrl('https://qlaok.vunph.click/', 'shop-fnb-001');
  assert.equal(url, 'https://qlaok.vunph.click/api/orders/events?shopId=shop-fnb-001');
  assert.doesNotMatch(url, /Bearer/);
  assert.doesNotMatch(url, /token/i);

  const headers = buildOrderEventsSseHeaders('jwt-mobile-access-token-xyz');
  assert.deepEqual(headers, {
    Authorization: 'Bearer jwt-mobile-access-token-xyz',
    Accept: 'text/event-stream',
  });
});

test('processOrderSseMessage: dispatches ready, change, fallback, and unauthorized while ignoring keepalives and malformed data', () => {
  let readyCalled = 0;
  let changeShopId: string | undefined;
  let fallbackCalled = 0;
  let unauthorizedCalled = 0;

  const callbacks = {
    onReady: () => {
      readyCalled++;
    },
    onChange: (shopId?: string) => {
      changeShopId = shopId;
    },
    onFallback: () => {
      fallbackCalled++;
    },
    onUnauthorized: () => {
      unauthorizedCalled++;
    },
  };

  // 1. Ready event
  processOrderSseMessage(JSON.stringify({ type: 'ready' }), callbacks);
  assert.equal(readyCalled, 1);

  // 2. Change event with shopId
  processOrderSseMessage(JSON.stringify({ type: 'change', shopId: 'shop-123' }), callbacks);
  assert.equal(changeShopId, 'shop-123');

  // 3. Fallback event
  processOrderSseMessage(JSON.stringify({ type: 'fallback' }), callbacks);
  assert.equal(fallbackCalled, 1);

  // 4. Unauthorized event
  processOrderSseMessage(JSON.stringify({ type: 'unauthorized' }), callbacks);
  assert.equal(unauthorizedCalled, 1);

  // 5. Keepalive comment frame or whitespace -> ignored safely without error
  processOrderSseMessage(': heartbeat', callbacks);
  processOrderSseMessage(': stream-open', callbacks);
  processOrderSseMessage('   ', callbacks);
  processOrderSseMessage('not json at all', callbacks);
  assert.equal(readyCalled, 1);
  assert.equal(fallbackCalled, 1);
  assert.equal(unauthorizedCalled, 1);
});

test('useShopRealtimeOrders.ts replaces Supabase channel with authenticated SSE and preserves invariants', () => {
  const hookSource = fs.readFileSync(
    path.join(__dirname, '../src/hooks/useShopRealtimeOrders.ts'),
    'utf8'
  );

  // Must NOT subscribe via Supabase channel or postgres_changes
  assert.doesNotMatch(hookSource, /supabase\s*\.\s*channel/);
  assert.doesNotMatch(hookSource, /postgres_changes/);
  assert.doesNotMatch(hookSource, /removeChannel/);

  // Must use SSE connection with EventSource
  assert.match(hookSource, /react-native-sse/);
  assert.match(hookSource, /buildOrderEventsSseUrl/);
  assert.match(hookSource, /buildOrderEventsSseHeaders/);
  assert.match(hookSource, /processOrderSseMessage/);

  // Must preserve 30-second safety polling
  assert.match(hookSource, /30000/);

  // Must preserve foreground resync
  assert.match(hookSource, /AppState\.addEventListener/);

  // Must clean up EventSource on unmount / change
  assert.match(hookSource, /es\.close\(\)/);
});
