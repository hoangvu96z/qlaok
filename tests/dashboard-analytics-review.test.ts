import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';

// Load and evaluate the dashboard analytics sync engine from page.tsx source
// without requiring full React DOM rendering dependencies in headless Node.js.
function loadDashboardAnalyticsSyncFromSource() {
  const pagePath = path.resolve('src/app/(dashboard)/dashboard/page.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  const startMarker = 'const DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS';
  const endMarker = 'export default function DashboardOverviewPage';
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
    throw new Error('Failed to locate startDashboardAnalyticsSync in page.tsx');
  }

  const snippet = source.slice(startIndex, endIndex);
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

  const fn = new Function(
    'exports',
    `${transpiled}\nreturn { start: startDashboardAnalyticsSync, interval: DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS };`
  );

  const evaluated = fn({}) as {
    start: (options: {
      shopId: string;
      onFetch: (silent: boolean) => Promise<void> | void;
    }) => () => void;
    interval: number;
  };

  return { ...evaluated, source };
}

const settle = async (ticks = 20) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};

class MockBroadcastChannel extends EventTarget {
  name: string;
  closed = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  static instances: MockBroadcastChannel[] = [];

  constructor(name: string) {
    super();
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    if (this.closed) return;
    for (const inst of MockBroadcastChannel.instances) {
      if (inst !== this && inst.name === this.name && !inst.closed) {
        const ev = { data };
        inst.onmessage?.(ev);
        inst.dispatchEvent(new Event('message'));
      }
    }
  }

  close() {
    this.closed = true;
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx !== -1) MockBroadcastChannel.instances.splice(idx, 1);
  }
}

describe('Dashboard Overview analytics polling rate reduction and sync behavior', () => {
  const { start: startDashboardAnalyticsSync, interval, source } =
    loadDashboardAnalyticsSyncFromSource();

  test('fallback interval is configured to exactly 60 seconds (60000ms)', () => {
    assert.equal(interval, 60000);
  });

  test('sync engine: initial fetch, 60s visible fallback, hidden pause, visibility return, and cleanup', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const descriptors = Object.fromEntries(
      ['document', 'window', 'BroadcastChannel'].map((k) => [
        k,
        Object.getOwnPropertyDescriptor(globalThis, k),
      ])
    );

    MockBroadcastChannel.instances = [];
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    const win = Object.assign(new EventTarget(), {
      BroadcastChannel: MockBroadcastChannel,
    });

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: doc,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: win,
    });
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel,
    });

    t.after(() => {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });

    const fetches: Array<{ silent: boolean; timestamp: number }> = [];
    const onFetch = async (silent: boolean) => {
      fetches.push({ silent, timestamp: Date.now() });
    };

    const stop = startDashboardAnalyticsSync({
      shopId: 'shop-test-1',
      onFetch,
    });
    await settle();

    // 1. Initial fetch once when active shop is available (silent = false)
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].silent, false);

    // 2. 60-second fallback while visible (silent = true)
    t.mock.timers.tick(60000);
    await settle();
    assert.equal(fetches.length, 2);
    assert.equal(fetches[1].silent, true);

    t.mock.timers.tick(60000);
    await settle();
    assert.equal(fetches.length, 3);

    // 3. Hidden-tab suppression: timer ticks while hidden must not call onFetch
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();

    t.mock.timers.tick(60000);
    await settle();
    t.mock.timers.tick(120000);
    await settle();
    assert.equal(
      fetches.length,
      3,
      'Timer ticks while hidden must not trigger analytics fetch'
    );

    // Broadcast messages while hidden must not trigger analytics fetch
    const senderBc = new MockBroadcastChannel('qlaok_realtime_sync');
    senderBc.postMessage({ type: 'order_created', shopId: 'shop-test-1' });
    await settle();
    assert.equal(
      fetches.length,
      3,
      'Broadcast message while hidden must not trigger analytics fetch'
    );

    // 4. Tab becomes visible again: refresh once immediately
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    assert.equal(
      fetches.length,
      4,
      'Visibility return must refresh immediately'
    );
    assert.equal(fetches[3].silent, true);

    // 5. Broadcast message for different shop is filtered out
    senderBc.postMessage({ type: 'order_created', shopId: 'other-shop' });
    await settle();
    assert.equal(
      fetches.length,
      4,
      'Broadcast message for another shop must be filtered out'
    );

    // Broadcast message for matching shop triggers refresh
    senderBc.postMessage({ type: 'order_created', shopId: 'shop-test-1' });
    await settle();
    assert.equal(
      fetches.length,
      5,
      'Broadcast message for active shop must refresh'
    );

    // Broadcast message without shopId (e.g. catalog_changed, bulk_imported) triggers refresh
    senderBc.postMessage({ type: 'catalog_changed' });
    await settle();
    assert.equal(
      fetches.length,
      6,
      'Unscoped producer messages must refresh'
    );

    // 6. Effect teardown: clean up timer, event listener, and BroadcastChannel
    stop();
    t.mock.timers.tick(120000);
    await settle();
    doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    senderBc.postMessage({ type: 'order_created', shopId: 'shop-test-1' });
    await settle();

    assert.equal(
      fetches.length,
      6,
      'No fetches must be triggered after stop() cleanup'
    );
  });

  test('sync engine: prevents overlapping fetches and recovers after errors', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const descriptors = Object.fromEntries(
      ['document', 'window', 'BroadcastChannel'].map((k) => [
        k,
        Object.getOwnPropertyDescriptor(globalThis, k),
      ])
    );

    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: doc,
    });

    t.after(() => {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });

    let resolveFirstPromise: (() => void) | undefined;
    let callCount = 0;
    let firstCompleted = false;

    const onFetch = async () => {
      callCount++;
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstPromise = resolve;
        });
        firstCompleted = true;
      }
    };

    const stop = startDashboardAnalyticsSync({
      shopId: 'shop-test-1',
      onFetch,
    });
    await settle();

    assert.equal(callCount, 1, 'Initial call is in-flight');
    assert.equal(firstCompleted, false);

    // Advance 60s timer while first fetch is still in-flight
    t.mock.timers.tick(60000);
    await settle();
    assert.equal(
      callCount,
      1,
      'Second fetch was queued and not executed concurrently'
    );

    // Trigger another tick while still in-flight
    t.mock.timers.tick(60000);
    await settle();
    assert.equal(
      callCount,
      1,
      'Queued calls coalesce into one refresh, not multiple'
    );

    // Resolve first fetch
    resolveFirstPromise?.();
    await settle();
    assert.equal(firstCompleted, true);
    assert.equal(
      callCount,
      2,
      'Queued refresh executes once after the in-flight fetch completes'
    );

    stop();

    // Verify error recovery: fetch failure resets inFlight and does not lock sync permanently
    let failedOnce = true;
    let failureTestCalls = 0;
    const onFetchWithError = async () => {
      failureTestCalls++;
      if (failedOnce) {
        failedOnce = false;
        throw new Error('Simulated network/DB error');
      }
    };

    const stop2 = startDashboardAnalyticsSync({
      shopId: 'shop-test-1',
      onFetch: onFetchWithError,
    });
    await settle();
    assert.equal(failureTestCalls, 1, 'Initial fetch failed with error');

    // Subsequent 60s timer tick must not be blocked
    t.mock.timers.tick(60000);
    await settle();
    assert.equal(
      failureTestCalls,
      2,
      'Recovered after error; analytics is not permanently locked or stale'
    );

    stop2();
  });

  test('source invariants: page.tsx removes 5s poll, enforces 60s fallback, and preserves route contracts', () => {
    // 1. Unconditional 5-second interval must be completely removed
    assert.doesNotMatch(
      source,
      /setInterval\([^,]+,\s*5000\)/,
      'Must remove unconditional 5000ms polling interval'
    );

    // 2. 60-second fallback constant must be present and used
    assert.match(
      source,
      /const DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS = 60000/,
      'Must define 60-second fallback interval constant'
    );

    // 3. Tab visibility handling must be present
    assert.match(
      source,
      /visibilitychange/,
      'Must register visibilitychange listener'
    );
    assert.match(
      source,
      /document\.visibilityState/,
      'Must check document.visibilityState'
    );

    // 4. Realtime BroadcastChannel must listen to qlaok_realtime_sync
    assert.match(
      source,
      /new BroadcastChannel\('qlaok_realtime_sync'\)/,
      'Must subscribe to qlaok_realtime_sync channel'
    );

    // 5. API endpoint and authorization headers must remain intact
    assert.match(
      source,
      /\/api\/analytics\/track\?shopId=/,
      'Must query /api/analytics/track with shopId'
    );
    assert.match(
      source,
      /headers:\s*getAuthHeaders\(\)/,
      'Must supply getAuthHeaders()'
    );
    assert.match(
      source,
      /cache:\s*'no-store'/,
      'Must supply cache: no-store'
    );

    // 6. Loading state, summary contract, and shop checklist evaluation preserved
    assert.match(
      source,
      /interface AnalyticsSummary/,
      'Must preserve AnalyticsSummary contract'
    );
    assert.match(
      source,
      /loading\s*&&\s*!summary/,
      'Must preserve initial loading spinner condition'
    );
    assert.match(
      source,
      /evaluateShopSetupChecklist/,
      'Must preserve shop setup checklist evaluation'
    );

    // 7. Architectural testing limits:
    // Testing the full Next.js page React component directly in a headless Node runner
    // requires a full React DOM / jsdom environment (which does not exist in dependencies).
    // The test architecture exercises the standalone sync engine and source invariants,
    // which verify the lifecycle, timers, visibility transitions, and channel events.
    assert.ok(true, 'Test architecture limits documented');
  });
});
