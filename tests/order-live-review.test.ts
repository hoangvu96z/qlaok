import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOrderEvents, startOrderLiveSync } from '@/lib/order-live-sync';

test('SSE parser handles split CRLF frames and ignores heartbeats/malformed JSON', async () => {
  const chunks = ['data: {"type":"rea', 'dy"}\r', '\n\r\n: heartbeat\n\ndata: invalid\n\ndata: {"type":"change"}\n\n'];
  const stream = new ReadableStream({ start(c) { for (const part of chunks) c.enqueue(new TextEncoder().encode(part)); c.close(); } });
  const received: string[] = [];
  await readOrderEvents(stream, e => received.push(e.type));
  assert.deepEqual(received, ['ready', 'change']);
});

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

for (const mode of ['connected', 'fallback', 'unauthorized'] as const) {
  test(`live sync ${mode}: bounded refresh, visibility pause, cleanup and auth headers`, async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const descriptors = Object.fromEntries(['document', 'window', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const win = new EventTarget();
    let connections = 0;
    let refreshes = 0;
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    let lastHeaders: HeadersInit | undefined;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url: unknown, init: RequestInit) => {
      connections++; lastHeaders = init.headers;
      if (mode === 'unauthorized') return new Response('{}', { status: 403 });
      if (mode === 'fallback') return new Response('{}', { status: 503 });
      const stream = new ReadableStream<Uint8Array>({ start(c) { streamController = c; c.enqueue(new TextEncoder().encode('data: {"type":"ready"}\n\n')); } });
      init.signal?.addEventListener('abort', () => { try { streamController.error(new DOMException('Aborted', 'AbortError')); } catch {} }, { once: true });
      return new Response(stream);
    } });
    let stop: (() => void) | undefined;
    t.after(() => {
      stop?.();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    stop = startOrderLiveSync({ query: 'shopId=fixture', headers: () => ({ Authorization: 'Bearer fixture' }), onChange: () => { refreshes++; } });
    await settle();
    assert.equal(new Headers(lastHeaders).get('authorization'), 'Bearer fixture');
    t.mock.timers.tick(200); await settle();
    assert.equal(refreshes, mode === 'connected' ? 1 : 0);
    t.mock.timers.tick(30000); await settle(); t.mock.timers.tick(200); await settle();
    assert.equal(refreshes, mode === 'connected' ? 1 : mode === 'fallback' ? 1 : 0);
    if (mode === 'connected') {
      streamController!.enqueue(new TextEncoder().encode('data: {"type":"change"}\n\ndata: {"type":"change"}\n\n'));
      await settle(); t.mock.timers.tick(200); await settle();
      assert.equal(refreshes, 2, 'bursts coalesce to one HTTP refresh');
    }
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); await settle();
    const before = { connections, refreshes };
    t.mock.timers.tick(120000); await settle();
    assert.deepEqual({ connections, refreshes }, before, 'hidden screens perform no polling or reconnect');
    stop();
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('online'));
    t.mock.timers.tick(120000); await settle();
    assert.deepEqual({ connections, refreshes }, before, 'no work after unmount');
  });
}
