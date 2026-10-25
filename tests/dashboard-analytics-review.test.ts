import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';
import {
  ANALYTICS_SUMMARY_EVENT_SELECT_COLUMNS,
  ANALYTICS_SUMMARY_ITEM_SELECT_COLUMNS,
  dbGetShopAnalyticsSummary,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { setMposDbClientForTests } from '@/lib/mpos-store';
import { setShopTablesDbClientForTests } from '@/lib/shop-tables';

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
    `${transpiled}\nreturn {
      start: startDashboardAnalyticsSync,
      interval: DASHBOARD_ANALYTICS_FALLBACK_INTERVAL_MS,
      deriveOverviewMetrics,
      createInitialOverviewAnalyticsState,
      applyOverviewAnalyticsFetchStart,
      applyOverviewAnalyticsFetchSuccess,
      applyOverviewAnalyticsFetchFailure,
    };`
  );

  const evaluated = fn({}) as {
    start: (options: {
      shopId: string;
      onFetch: (silent: boolean) => Promise<void> | void;
    }) => () => void;
    interval: number;
    deriveOverviewMetrics: (summary: Record<string, unknown> | null | undefined) => {
      daily7d: Array<{
        date: string;
        label: string;
        revenue: number;
        cashRevenue: number;
        vietqrRevenue: number;
        orders: number;
        heightPct: number;
        vqShare: number;
        cashShare: number;
      }>;
      maxDailyRev: number;
      total7dRev: number;
      total7dOrders: number;
      vietqrPct: number;
      cashPct: number;
      hasPaymentActivity: boolean;
      qrSourcePct: number;
      posSourcePct: number;
      hasSourceActivity: boolean;
      hourlySlots: Array<{
        slot: string;
        label: string;
        orders: number;
        revenue: number;
        percentage: number;
        barHeightPct: number;
      }>;
      peakSlot: {
        slot: string;
        label: string;
        orders: number;
        revenue: number;
        percentage: number;
        barHeightPct: number;
      } | null;
      totalQrScans: number;
      totalItemViews: number;
      totalOrdersSubmitted: number;
      completedOrders: number;
      funnelSteps: {
        scanPct: number;
        itemViewPct: number;
        ordersSubmittedPct: number;
        completedOrdersPct: number;
      };
    };
    createInitialOverviewAnalyticsState: () => {
      summary: Record<string, unknown> | null;
      loading: boolean;
      error: string | null;
    };
    applyOverviewAnalyticsFetchStart: (
      prev: {
        summary: Record<string, unknown> | null;
        loading: boolean;
        error: string | null;
      },
      silent: boolean
    ) => {
      summary: Record<string, unknown> | null;
      loading: boolean;
      error: string | null;
    };
    applyOverviewAnalyticsFetchSuccess: (data: Record<string, unknown>) => {
      summary: Record<string, unknown> | null;
      loading: boolean;
      error: string | null;
    };
    applyOverviewAnalyticsFetchFailure: (
      prev: {
        summary: Record<string, unknown> | null;
        loading: boolean;
        error: string | null;
      },
      errorMessage: string
    ) => {
      summary: Record<string, unknown> | null;
      loading: boolean;
      error: string | null;
    };
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

  test('dbGetShopAnalyticsSummary: projects lean event/item columns, strips large image/description/option payloads and user_agent, and preserves exact metrics', async (t) => {
    t.after(() => {
      setSupabaseDbClientForTests(null);
      setMposDbClientForTests(null);
      setShopTablesDbClientForTests(null);
    });

    const shopId = 'shop-analytics-lean-test';
    const largeDataUri = `data:image/png;base64,${'A'.repeat(120_000)}`;

    const rawEventFixtures = [
      {
        id: 101,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) SecretAgent/101',
        created_at: '2026-10-24T10:01:00.000Z',
      },
      {
        id: 102,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'en',
        user_agent: 'Mozilla/5.0 SecretAgent/102',
        created_at: '2026-10-24T10:02:00.000Z',
      },
      {
        id: 103,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'ko',
        user_agent: 'Mozilla/5.0 SecretAgent/103',
        created_at: '2026-10-24T10:03:00.000Z',
      },
      {
        id: 104,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/104',
        created_at: '2026-10-24T10:04:00.000Z',
      },
      {
        id: 105,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/105',
        created_at: '2026-10-24T10:05:00.000Z',
      },
      {
        id: 106,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'en',
        user_agent: 'Mozilla/5.0 SecretAgent/106',
        created_at: '2026-10-24T10:06:00.000Z',
      },
      {
        id: 107,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'ko',
        user_agent: 'Mozilla/5.0 SecretAgent/107',
        created_at: '2026-10-24T10:07:00.000Z',
      },
      {
        id: 108,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'ja',
        user_agent: 'Mozilla/5.0 SecretAgent/108',
        created_at: '2026-10-24T10:08:00.000Z',
      },
      {
        id: 109,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'zh',
        user_agent: 'Mozilla/5.0 SecretAgent/109',
        created_at: '2026-10-24T10:09:00.000Z',
      },
      {
        id: 110,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-1',
        visitor_lang: 'es',
        user_agent: 'Mozilla/5.0 SecretAgent/110',
        created_at: '2026-10-24T10:10:00.000Z',
      },
      {
        id: 111,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-2',
        visitor_lang: 'it',
        user_agent: 'Mozilla/5.0 SecretAgent/111',
        created_at: '2026-10-24T10:11:00.000Z',
      },
      {
        id: 112,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-3',
        visitor_lang: 'ru',
        user_agent: 'Mozilla/5.0 SecretAgent/112',
        created_at: '2026-10-24T10:12:00.000Z',
      },
      {
        id: 113,
        shop_id: shopId,
        event_type: 'show_to_staff',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/113',
        created_at: '2026-10-24T10:13:00.000Z',
      },
      {
        id: 114,
        shop_id: shopId,
        event_type: 'show_to_staff',
        item_id: null,
        visitor_lang: 'en',
        user_agent: 'Mozilla/5.0 SecretAgent/114',
        created_at: '2026-10-24T10:14:00.000Z',
      },
      {
        id: 115,
        shop_id: shopId,
        event_type: 'show_to_staff',
        item_id: null,
        visitor_lang: 'ko',
        user_agent: 'Mozilla/5.0 SecretAgent/115',
        created_at: '2026-10-24T10:15:00.000Z',
      },
      {
        id: 116,
        shop_id: shopId,
        event_type: 'show_to_staff',
        item_id: null,
        visitor_lang: 'ja',
        user_agent: 'Mozilla/5.0 SecretAgent/116',
        created_at: '2026-10-24T10:16:00.000Z',
      },
      {
        id: 117,
        shop_id: shopId,
        event_type: 'wifi_copy',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/117',
        created_at: '2026-10-24T10:17:00.000Z',
      },
      {
        id: 118,
        shop_id: shopId,
        event_type: 'wifi_copy',
        item_id: null,
        visitor_lang: 'zh',
        user_agent: 'Mozilla/5.0 SecretAgent/118',
        created_at: '2026-10-24T10:18:00.000Z',
      },
      {
        id: 119,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/119',
        created_at: '2026-10-24T10:19:00.000Z',
      },
      {
        id: 120,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/120',
        created_at: '2026-10-24T10:20:00.000Z',
      },
    ];

    const rawItemFixtures = [
      {
        id: 'item-1',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 1,
        price: 55000,
        compare_at_price: 65000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: true,
        name_i18n: { vi: 'Phở Bò Đặc Biệt', en: 'Special Beef Pho' },
        desc_i18n: {
          vi: 'Mô tả rất dài '.repeat(50),
          en: 'Very long description '.repeat(50),
        },
        options_json: [
          {
            id: 'opt-1',
            name_i18n: { vi: 'Cỡ tô', en: 'Bowl size' },
            required: true,
            choices: [
              { id: 'c-1', name_i18n: { vi: 'Tô lớn' }, extra_price: 15000 },
            ],
          },
        ],
        view_count: 120,
        stock_quantity: 3, // low stock (1..5)
        sold_count: 10,
      },
      {
        id: 'item-2',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 2,
        price: 35000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Cà Phê Muối', en: 'Salted Coffee' },
        desc_i18n: { vi: 'Cà phê muối đậm đà '.repeat(40) },
        options_json: [],
        view_count: 95,
        stock_quantity: null, // unlimited stock
        sold_count: 30,
      },
      {
        id: 'item-3',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 3,
        price: 45000,
        image_url: largeDataUri,
        is_available: false, // unavailable -> out of stock
        is_featured: false,
        name_i18n: { vi: 'Trà Đào Cam Sả', en: 'Peach Lemongrass Tea' },
        desc_i18n: { vi: 'Trà đào tươi mát '.repeat(40) },
        options_json: [],
        view_count: 80,
        stock_quantity: 0, // out of stock
        sold_count: 25,
      },
      {
        id: 'item-4',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 4,
        price: 60000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Bún Bò Huế', en: 'Hue Beef Noodle' },
        desc_i18n: { vi: 'Bún bò chuẩn vị '.repeat(40) },
        options_json: [],
        view_count: 60,
        stock_quantity: 5, // low stock boundary (<= 5)
        sold_count: 18,
      },
      {
        id: 'item-5',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 5,
        price: 25000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Quẩy Giòn', en: 'Crispy Dough' },
        desc_i18n: { vi: 'Quẩy nóng giòn '.repeat(40) },
        options_json: [],
        view_count: 40,
        stock_quantity: 20,
        sold_count: 12,
      },
      {
        id: 'item-6',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 6,
        price: 30000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Sữa Đậu Nành', en: 'Soy Milk' },
        desc_i18n: { vi: 'Sữa đậu nành nhà nấu '.repeat(40) },
        options_json: [],
        view_count: 15,
        stock_quantity: 12,
        sold_count: 5,
      },
    ];

    const rawTableFixtures = [
      {
        id: 'tbl-1',
        shop_id: shopId,
        name: 'Bàn 1',
        table_code: 'T01',
        is_active: true,
        is_archived: false,
        sort_order: 1,
      },
      {
        id: 'tbl-2',
        shop_id: shopId,
        name: 'Bàn 2',
        table_code: 'T02',
        is_active: true,
        is_archived: false,
        sort_order: 2,
      },
      {
        id: 'tbl-3',
        shop_id: shopId,
        name: 'Bàn 3 (Tắt)',
        table_code: 'T03',
        is_active: false,
        is_archived: false,
        sort_order: 3,
      },
      {
        id: 'tbl-4',
        shop_id: shopId,
        name: 'Bàn 4 (Lưu trữ)',
        table_code: 'T04',
        is_active: true,
        is_archived: true,
        sort_order: 4,
      },
    ];

    const recordedQueries: Array<{
      table: string;
      columns: string;
      filters: Array<[string, unknown]>;
      orders: Array<{ column: string; ascending: boolean }>;
      limit: number | null;
    }> = [];

    const mockClient = {
      from(table: string) {
        let selectedColumns = '*';
        const filters: Array<[string, unknown]> = [];
        const orders: Array<{ column: string; ascending: boolean }> = [];
        let rowLimit: number | null = null;
        let isSingle = false;

        const builder = {
          select(cols = '*') {
            selectedColumns = cols;
            return builder;
          },
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          order(col: string, opts?: { ascending?: boolean }) {
            orders.push({
              column: col,
              ascending: opts?.ascending !== false,
            });
            return builder;
          },
          limit(n: number) {
            rowLimit = n;
            return builder;
          },
          single() {
            isSingle = true;
            return builder;
          },
          maybeSingle() {
            isSingle = true;
            return builder;
          },
          async execute() {
            recordedQueries.push({
              table,
              columns: selectedColumns,
              filters: [...filters],
              orders: [...orders],
              limit: rowLimit,
            });

            let rows: Array<Record<string, unknown>> = [];
            if (table === 'shops') {
              rows = [{ id: shopId }];
            } else if (table === 'analytics_events') {
              rows = [...rawEventFixtures];
            } else if (table === 'items') {
              rows = [...rawItemFixtures];
            } else if (table === 'shop_tables') {
              rows = [...rawTableFixtures];
            }

            for (const [col, val] of filters) {
              rows = rows.filter((r) => r[col] === val);
            }

            for (const ord of orders) {
              rows.sort((a, b) => {
                const av = String(a[ord.column] ?? '');
                const bv = String(b[ord.column] ?? '');
                return ord.ascending
                  ? av.localeCompare(bv)
                  : bv.localeCompare(av);
              });
            }

            if (rowLimit !== null) {
              rows = rows.slice(0, rowLimit);
            }

            // Simulate PostgREST column projection while leaving one fixture row unprojected
            // if needed to verify that application-level projection also strips stray fields.
            if (selectedColumns !== '*') {
              const allowedCols = selectedColumns
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean);
              rows = rows.map((r, idx) => {
                if (idx === 0) {
                  // Keep raw fields on first row in mock to prove application-level projection
                  // also strips any stray image_url / desc_i18n / options_json / user_agent.
                  return { ...r };
                }
                const projected: Record<string, unknown> = {};
                for (const col of allowedCols) {
                  if (col in r) projected[col] = r[col];
                }
                return projected;
              });
            }

            return {
              data: isSingle ? (rows[0] ?? null) : rows,
              error: null,
            };
          },
          then(
            resolve: (res: unknown) => unknown,
            reject: (err: unknown) => unknown
          ) {
            return builder.execute().then(resolve, reject);
          },
        };
        return builder;
      },
      rpc(fnName: string, args: Record<string, unknown>) {
        assert.equal(fnName, 'get_shop_order_stats_summary');
        assert.equal(args.p_shop_id, shopId);
        return Promise.resolve({
          data: {
            todayRevenue: 450000,
            todayGrossOrderAmount: 510000,
            todayUnpaidAmount: 60000,
            todayRefundedAmount: 0,
            totalRefundedAmount: 0,
            todayOrdersCount: 9,
            todayPaidOrdersCount: 8,
            todayCompletedCount: 8,
            completedOrdersCount: 40,
            paidOrdersCount: 38,
            totalRevenue: 2450000,
            totalOrdersCount: 42,
            newOrdersCount: 2,
            preparingOrdersCount: 1,
            avgOrderValue: 64474,
            dailyRevenue7d: [
              {
                date: '2026-10-18',
                label: '18/10',
                revenue: 300000,
                cashRevenue: 100000,
                vietqrRevenue: 200000,
                orders: 5,
                orderCount: 5,
              },
            ],
            paymentBreakdown: {
              vietqr: { count: 28, revenue: 1800000, percentage: 74 },
              cash: { count: 10, revenue: 650000, percentage: 26 },
            },
            sourceBreakdown: {
              qr_table: { count: 30, revenue: 1950000, percentage: 79 },
              counter_pos: { count: 8, revenue: 500000, percentage: 21 },
            },
            hourlyBreakdown: [
              {
                slot: '09h-12h',
                label: 'Trưa (9-12h)',
                orders: 18,
                revenue: 1100000,
                percentage: 100,
              },
            ],
            itemSales: [
              // item-1 has 40 sold from orders (> 10 on item.sold_count) with 2,200,000đ revenue
              { item_id: 'item-1', qty: 40, rev: 2200000 },
              // item-2 has 30 sold on item.sold_count (>= 20 in orderSales) -> uses 30 * 35000 = 1,050,000đ
              { item_id: 'item-2', qty: 20, rev: 700000 },
            ],
          },
          error: null,
        });
      },
    };

    setSupabaseDbClientForTests(mockClient);
    setMposDbClientForTests(mockClient, true);
    setShopTablesDbClientForTests(mockClient, true);

    const summary = await dbGetShopAnalyticsSummary(shopId);

    // 1. Assert query projections exclude unused large fields and keep full event history (no .limit() on analytics_events)
    const eventsQuery = recordedQueries.find(
      (q) => q.table === 'analytics_events'
    );
    assert.ok(eventsQuery, 'Must query analytics_events');
    assert.equal(
      eventsQuery.columns,
      ANALYTICS_SUMMARY_EVENT_SELECT_COLUMNS,
      'analytics_events select must project only needed columns'
    );
    assert.ok(
      !eventsQuery.columns.includes('*') &&
        !eventsQuery.columns.includes('user_agent'),
      'analytics_events select must not fetch * or user_agent'
    );
    assert.equal(
      eventsQuery.limit,
      null,
      'analytics_events query must not apply an arbitrary .limit() that truncates historical totals'
    );
    assert.deepEqual(eventsQuery.orders, [
      { column: 'created_at', ascending: false },
    ]);

    const itemsQuery = recordedQueries.find((q) => q.table === 'items');
    assert.ok(itemsQuery, 'Must query items');
    assert.equal(
      itemsQuery.columns,
      ANALYTICS_SUMMARY_ITEM_SELECT_COLUMNS,
      'items select must project only needed columns'
    );
    for (const forbiddenCol of [
      '*',
      'image_url',
      'desc_i18n',
      'options_json',
      'unit_i18n',
    ]) {
      assert.ok(
        !itemsQuery.columns.includes(forbiddenCol),
        `items select must exclude ${forbiddenCol}`
      );
    }

    // 2. Assert response item summaries and serialized payload never contain image data, descriptions, options, or user_agent
    const serializedSummary = JSON.stringify(summary);
    assert.ok(
      !serializedSummary.includes('data:image/'),
      'Response payload must not contain inline base64 data URI images'
    );
    assert.ok(
      !serializedSummary.includes('image_url'),
      'Response payload must not contain image_url field'
    );
    assert.ok(
      !serializedSummary.includes('desc_i18n'),
      'Response payload must not contain desc_i18n field'
    );
    assert.ok(
      !serializedSummary.includes('options_json'),
      'Response payload must not contain options_json field'
    );
    assert.ok(
      !serializedSummary.includes('user_agent') &&
        !serializedSummary.includes('SecretAgent'),
      'Response payload must not contain user_agent data'
    );

    // 3. Assert event counts, language percentages/denominator across all 20 events, and newest-15 recentEvents order
    assert.equal(summary.scanDoorCount, 4);
    assert.equal(summary.scanTableCount, 7);
    assert.equal(summary.totalScans, 11);
    assert.equal(summary.showToStaffCount, 4);
    assert.equal(summary.wifiCopyCount, 2);

    const langMap = new Map(
      summary.langBreakdown.map((entry) => [entry.lang, entry])
    );
    // Out of 20 total events: vi=7 (35%), en=3 (15%), ko=3 (15%), ja=2 (10%), zh=2 (10%), es=1 (5%), it=1 (5%), ru=1 (5%)
    assert.deepEqual(langMap.get('vi'), {
      lang: 'vi',
      count: 7,
      percentage: 35,
    });
    assert.deepEqual(langMap.get('en'), {
      lang: 'en',
      count: 3,
      percentage: 15,
    });
    assert.deepEqual(langMap.get('ko'), {
      lang: 'ko',
      count: 3,
      percentage: 15,
    });
    assert.deepEqual(langMap.get('ja'), {
      lang: 'ja',
      count: 2,
      percentage: 10,
    });
    assert.deepEqual(langMap.get('zh'), {
      lang: 'zh',
      count: 2,
      percentage: 10,
    });
    assert.deepEqual(langMap.get('es'), {
      lang: 'es',
      count: 1,
      percentage: 5,
    });
    assert.deepEqual(langMap.get('it'), {
      lang: 'it',
      count: 1,
      percentage: 5,
    });
    assert.deepEqual(langMap.get('ru'), {
      lang: 'ru',
      count: 1,
      percentage: 5,
    });

    assert.equal(summary.recentEvents.length, 15);
    assert.deepEqual(
      summary.recentEvents.map((e) => e.id),
      [
        120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 109, 108, 107,
        106,
      ],
      'recentEvents must contain the newest 15 events in descending created_at order'
    );
    for (const ev of summary.recentEvents) {
      assert.equal('user_agent' in ev, false);
    }

    // 4. Assert catalog, table, inventory, topItems, topSellingItems, and revenue metrics
    assert.equal(summary.totalCatalogItems, 6);
    assert.equal(summary.availableCatalogItems, 5);
    assert.equal(summary.activeTablesCount, 2);
    assert.equal(summary.lowStockCount, 2); // item-1 (3) and item-4 (5)
    assert.equal(summary.outOfStockCount, 1); // item-3 (stock 0, is_available false)
    assert.deepEqual(
      summary.lowStockItems.map((i) => i.id),
      ['item-1', 'item-4']
    );
    assert.deepEqual(
      summary.mposStats.lowStockItems.map((i) => i.id),
      ['item-1', 'item-4']
    );

    assert.equal(summary.topItems.length, 5);
    assert.deepEqual(
      summary.topItems.map((i) => ({
        id: i.id,
        name_vi: i.name_vi,
        price: i.price,
        view_count: i.view_count,
        sold_count: i.sold_count,
        stock_quantity: i.stock_quantity,
        is_available: i.is_available,
      })),
      [
        {
          id: 'item-1',
          name_vi: 'Phở Bò Đặc Biệt',
          price: 55000,
          view_count: 120,
          sold_count: 10,
          stock_quantity: 3,
          is_available: true,
        },
        {
          id: 'item-2',
          name_vi: 'Cà Phê Muối',
          price: 35000,
          view_count: 95,
          sold_count: 30,
          stock_quantity: null,
          is_available: true,
        },
        {
          id: 'item-3',
          name_vi: 'Trà Đào Cam Sả',
          price: 45000,
          view_count: 80,
          sold_count: 25,
          stock_quantity: 0,
          is_available: false,
        },
        {
          id: 'item-4',
          name_vi: 'Bún Bò Huế',
          price: 60000,
          view_count: 60,
          sold_count: 18,
          stock_quantity: 5,
          is_available: true,
        },
        {
          id: 'item-5',
          name_vi: 'Quẩy Giòn',
          price: 25000,
          view_count: 40,
          sold_count: 12,
          stock_quantity: 20,
          is_available: true,
        },
      ]
    );

    assert.equal(summary.topSellingItems.length, 5);
    assert.deepEqual(
      summary.topSellingItems.map((i) => ({
        id: i.id,
        name_vi: i.name_vi,
        price: i.price,
        sold_count: i.sold_count,
        stock_quantity: i.stock_quantity,
        is_available: i.is_available,
        revenue: i.revenue,
      })),
      [
        {
          id: 'item-1',
          name_vi: 'Phở Bò Đặc Biệt',
          price: 55000,
          sold_count: 40,
          stock_quantity: 3,
          is_available: true,
          revenue: 2200000,
        },
        {
          id: 'item-2',
          name_vi: 'Cà Phê Muối',
          price: 35000,
          sold_count: 30,
          stock_quantity: null,
          is_available: true,
          revenue: 1050000,
        },
        {
          id: 'item-3',
          name_vi: 'Trà Đào Cam Sả',
          price: 45000,
          sold_count: 25,
          stock_quantity: 0,
          is_available: false,
          revenue: 1125000,
        },
        {
          id: 'item-4',
          name_vi: 'Bún Bò Huế',
          price: 60000,
          sold_count: 18,
          stock_quantity: 5,
          is_available: true,
          revenue: 1080000,
        },
        {
          id: 'item-5',
          name_vi: 'Quẩy Giòn',
          price: 25000,
          sold_count: 12,
          stock_quantity: 20,
          is_available: true,
          revenue: 300000,
        },
      ]
    );

    assert.equal(summary.todayRevenue, 450000);
    assert.equal(summary.totalRevenue, 2450000);
    assert.equal(summary.todayOrdersCount, 9);
    assert.equal(summary.totalOrdersCount, 42);
    assert.equal(summary.newOrdersCount, 2);
    assert.equal(summary.preparingOrdersCount, 1);
    assert.equal(summary.completedOrdersCount, 40);
    assert.equal(summary.avgOrderValue, 64474);
  });

  test('dbGetShopAnalyticsSummary: falls back to paginated order scan when stats RPC is missing and preserves accurate analytics summary', async (t) => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-10-24T10:00:00.000Z'),
    });
    t.after(() => {
      setSupabaseDbClientForTests(null);
      setMposDbClientForTests(null);
      setShopTablesDbClientForTests(null);
    });

    const shopId = 'shop-analytics-fallback-test';
    const largeDataUri = `data:image/png;base64,${'B'.repeat(120_000)}`;

    const rawEventFixtures = [
      {
        id: 201,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/201',
        created_at: '2026-10-24T10:01:00.000Z',
      },
      {
        id: 202,
        shop_id: shopId,
        event_type: 'scan_door',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/202',
        created_at: '2026-10-24T10:02:00.000Z',
      },
      {
        id: 203,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'en',
        user_agent: 'Mozilla/5.0 SecretAgent/203',
        created_at: '2026-10-24T10:03:00.000Z',
      },
      {
        id: 204,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'en',
        user_agent: 'Mozilla/5.0 SecretAgent/204',
        created_at: '2026-10-24T10:04:00.000Z',
      },
      {
        id: 205,
        shop_id: shopId,
        event_type: 'scan_table',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/205',
        created_at: '2026-10-24T10:05:00.000Z',
      },
      {
        id: 206,
        shop_id: shopId,
        event_type: 'show_to_staff',
        item_id: null,
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/206',
        created_at: '2026-10-24T10:06:00.000Z',
      },
      {
        id: 207,
        shop_id: shopId,
        event_type: 'wifi_copy',
        item_id: null,
        visitor_lang: 'ko',
        user_agent: 'Mozilla/5.0 SecretAgent/207',
        created_at: '2026-10-24T10:07:00.000Z',
      },
      {
        id: 208,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-1',
        visitor_lang: 'ja',
        user_agent: 'Mozilla/5.0 SecretAgent/208',
        created_at: '2026-10-24T10:08:00.000Z',
      },
      {
        id: 209,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-2',
        visitor_lang: 'zh',
        user_agent: 'Mozilla/5.0 SecretAgent/209',
        created_at: '2026-10-24T10:09:00.000Z',
      },
      {
        id: 210,
        shop_id: shopId,
        event_type: 'item_view',
        item_id: 'item-4',
        visitor_lang: 'vi',
        user_agent: 'Mozilla/5.0 SecretAgent/210',
        created_at: '2026-10-24T10:10:00.000Z',
      },
    ];

    const rawItemFixtures = [
      {
        id: 'item-1',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 1,
        price: 55000,
        compare_at_price: 65000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: true,
        name_i18n: { vi: 'Phở Bò Đặc Biệt', en: 'Special Beef Pho' },
        desc_i18n: {
          vi: 'Mô tả rất dài '.repeat(50),
          en: 'Very long description '.repeat(50),
        },
        options_json: [
          {
            id: 'opt-1',
            name_i18n: { vi: 'Cỡ tô', en: 'Bowl size' },
            required: true,
            choices: [
              { id: 'c-1', name_i18n: { vi: 'Tô lớn' }, extra_price: 15000 },
            ],
          },
        ],
        view_count: 100,
        stock_quantity: 3, // low stock (1..5)
        sold_count: 5,
      },
      {
        id: 'item-2',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 2,
        price: 35000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Cà Phê Muối', en: 'Salted Coffee' },
        desc_i18n: { vi: 'Cà phê muối đậm đà '.repeat(40) },
        options_json: [],
        view_count: 80,
        stock_quantity: null, // unlimited stock
        sold_count: 10,
      },
      {
        id: 'item-3',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 3,
        price: 45000,
        image_url: largeDataUri,
        is_available: false, // unavailable -> out of stock
        is_featured: false,
        name_i18n: { vi: 'Trà Đào Cam Sả', en: 'Peach Lemongrass Tea' },
        desc_i18n: { vi: 'Trà đào tươi mát '.repeat(40) },
        options_json: [],
        view_count: 60,
        stock_quantity: 0, // out of stock
        sold_count: 2,
      },
      {
        id: 'item-4',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 4,
        price: 60000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Bún Bò Huế', en: 'Hue Beef Noodle' },
        desc_i18n: { vi: 'Bún bò chuẩn vị '.repeat(40) },
        options_json: [],
        view_count: 50,
        stock_quantity: 5, // low stock boundary (<= 5)
        sold_count: 8,
      },
      {
        id: 'item-5',
        shop_id: shopId,
        category_id: 'cat-1',
        sort_order: 5,
        price: 25000,
        image_url: largeDataUri,
        is_available: true,
        is_featured: false,
        name_i18n: { vi: 'Quẩy Giòn', en: 'Crispy Dough' },
        desc_i18n: { vi: 'Quẩy nóng giòn '.repeat(40) },
        options_json: [],
        view_count: 30,
        stock_quantity: 20,
        sold_count: 1,
      },
    ];

    const rawTableFixtures = [
      {
        id: 'tbl-1',
        shop_id: shopId,
        name: 'Bàn 1',
        table_code: 'T01',
        is_active: true,
        is_archived: false,
        sort_order: 1,
      },
      {
        id: 'tbl-2',
        shop_id: shopId,
        name: 'Bàn 2',
        table_code: 'T02',
        is_active: true,
        is_archived: false,
        sort_order: 2,
      },
      {
        id: 'tbl-3',
        shop_id: shopId,
        name: 'Bàn 3 (Tắt)',
        table_code: 'T03',
        is_active: false,
        is_archived: false,
        sort_order: 3,
      },
      {
        id: 'tbl-4',
        shop_id: shopId,
        name: 'Bàn 4 (Lưu trữ)',
        table_code: 'T04',
        is_active: true,
        is_archived: true,
        sort_order: 4,
      },
    ];

    const rawOrderFixtures = [
      {
        id: 'ord-101',
        shop_id: shopId,
        status: 'completed',
        payment_status: 'paid',
        payment_method: 'vietqr',
        source: 'qr_table',
        total_amount: 110000,
        items: [{ item_id: 'item-1', quantity: 2, unit_price: 55000 }],
        created_at: '2026-10-24T09:15:00.000Z',
        updated_at: '2026-10-24T09:20:00.000Z',
        user_agent: 'Mozilla/5.0 SecretAgent/Order101',
      },
      {
        id: 'ord-102',
        shop_id: shopId,
        status: 'completed',
        payment_status: 'paid',
        payment_method: 'cash',
        source: 'counter_pos',
        total_amount: 70000,
        items: [{ item_id: 'item-2', quantity: 2, unit_price: 35000 }],
        created_at: '2026-10-24T09:30:00.000Z',
        updated_at: '2026-10-24T09:35:00.000Z',
      },
      {
        id: 'ord-103',
        shop_id: shopId,
        status: 'new',
        payment_status: 'unpaid',
        payment_method: 'cash',
        source: 'qr_table',
        total_amount: 45000,
        items: [{ item_id: 'item-3', quantity: 1, unit_price: 45000 }],
        created_at: '2026-10-24T09:45:00.000Z',
        updated_at: '2026-10-24T09:45:00.000Z',
      },
      {
        id: 'ord-104',
        shop_id: shopId,
        status: 'preparing',
        payment_status: 'paid',
        payment_method: 'vietqr',
        source: 'qr_table',
        total_amount: 60000,
        items: [{ item_id: 'item-4', quantity: 1, unit_price: 60000 }],
        created_at: '2026-10-24T09:50:00.000Z',
        updated_at: '2026-10-24T09:50:00.000Z',
      },
      {
        id: 'ord-105',
        shop_id: shopId,
        status: 'completed',
        payment_status: 'paid',
        payment_method: 'vietqr',
        source: 'qr_table',
        total_amount: 165000,
        items: [{ item_id: 'item-1', quantity: 3, unit_price: 55000 }],
        created_at: '2026-10-23T10:00:00.000Z',
        updated_at: '2026-10-23T10:15:00.000Z',
      },
      {
        id: 'ord-106',
        shop_id: shopId,
        status: 'cancelled',
        payment_status: 'refunded',
        payment_method: 'cash',
        source: 'counter_pos',
        total_amount: 25000,
        items: [{ item_id: 'item-5', quantity: 1, unit_price: 25000 }],
        created_at: '2026-10-24T09:00:00.000Z',
        updated_at: '2026-10-24T09:05:00.000Z',
      },
    ];

    const recordedQueries: Array<{
      table: string;
      columns: string;
      filters: Array<[string, unknown]>;
      orders: Array<{ column: string; ascending: boolean }>;
      limit: number | null;
      offset: number;
    }> = [];

    const rpcInvocations: Array<{
      fnName: string;
      args: Record<string, unknown>;
    }> = [];

    const mockClient = {
      from(table: string) {
        let selectedColumns = '*';
        const filters: Array<[string, unknown]> = [];
        const orders: Array<{ column: string; ascending: boolean }> = [];
        let rowOffset = 0;
        let rowLimit: number | null = null;
        let isSingle = false;

        const builder = {
          select(cols = '*') {
            selectedColumns = cols;
            return builder;
          },
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          order(col: string, opts?: { ascending?: boolean }) {
            orders.push({
              column: col,
              ascending: opts?.ascending !== false,
            });
            return builder;
          },
          limit(n: number) {
            rowLimit = n;
            return builder;
          },
          range(from: number, to: number) {
            rowOffset = Math.max(0, from);
            rowLimit = Math.max(0, to - from + 1);
            return builder;
          },
          single() {
            isSingle = true;
            return builder;
          },
          maybeSingle() {
            isSingle = true;
            return builder;
          },
          async execute() {
            recordedQueries.push({
              table,
              columns: selectedColumns,
              filters: [...filters],
              orders: [...orders],
              limit: rowLimit,
              offset: rowOffset,
            });

            let rows: Array<Record<string, unknown>> = [];
            if (table === 'shops') {
              rows = [{ id: shopId }];
            } else if (table === 'analytics_events') {
              rows = [...rawEventFixtures];
            } else if (table === 'items') {
              rows = [...rawItemFixtures];
            } else if (table === 'shop_tables') {
              rows = [...rawTableFixtures];
            } else if (table === 'orders') {
              rows = [...rawOrderFixtures];
            }

            for (const [col, val] of filters) {
              rows = rows.filter((r) => r[col] === val);
            }

            for (const ord of orders) {
              rows.sort((a, b) => {
                const av = String(a[ord.column] ?? '');
                const bv = String(b[ord.column] ?? '');
                return ord.ascending
                  ? av.localeCompare(bv)
                  : bv.localeCompare(av);
              });
            }

            if (rowLimit !== null) {
              rows = rows.slice(rowOffset, rowOffset + rowLimit);
            } else if (rowOffset > 0) {
              rows = rows.slice(rowOffset);
            }

            if (selectedColumns !== '*') {
              const allowedCols = selectedColumns
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean);
              rows = rows.map((r, idx) => {
                if (idx === 0) {
                  return { ...r };
                }
                const projected: Record<string, unknown> = {};
                for (const col of allowedCols) {
                  if (col in r) projected[col] = r[col];
                }
                return projected;
              });
            }

            return {
              data: isSingle ? (rows[0] ?? null) : rows,
              error: null,
            };
          },
          then(
            resolve: (res: unknown) => unknown,
            reject: (err: unknown) => unknown
          ) {
            return builder.execute().then(resolve, reject);
          },
        };
        return builder;
      },
      rpc(fnName: string, args: Record<string, unknown>) {
        rpcInvocations.push({ fnName, args });
        assert.equal(fnName, 'get_shop_order_stats_summary');
        assert.equal(args.p_shop_id, shopId);
        return Promise.resolve({
          data: null,
          error: {
            code: 'PGRST202',
            message:
              'Could not find the function public.get_shop_order_stats_summary in the schema cache',
          },
        });
      },
    };

    setSupabaseDbClientForTests(mockClient);
    setMposDbClientForTests(mockClient, true);
    setShopTablesDbClientForTests(mockClient, true);

    const summary = await dbGetShopAnalyticsSummary(shopId);

    // 1. Assert RPC invocation attempt and fallback order scan queries
    assert.equal(rpcInvocations.length, 1);
    assert.equal(
      rpcInvocations[0].fnName,
      'get_shop_order_stats_summary',
      'Must attempt get_shop_order_stats_summary RPC first'
    );

    const ordersQuery = recordedQueries.find((q) => q.table === 'orders');
    assert.ok(ordersQuery, 'Must query orders table when stats RPC is missing');
    assert.equal(
      ordersQuery.columns,
      'id,shop_id,status,payment_status,payment_method,source,total_amount,items,created_at,updated_at',
      'orders query must select required stats projection columns'
    );
    assert.deepEqual(ordersQuery.filters, [['shop_id', shopId]]);
    assert.deepEqual(ordersQuery.orders, [
      { column: 'created_at', ascending: false },
    ]);
    assert.equal(ordersQuery.offset, 0);

    const eventsQuery = recordedQueries.find(
      (q) => q.table === 'analytics_events'
    );
    assert.ok(eventsQuery, 'Must query analytics_events');
    assert.equal(
      eventsQuery.columns,
      ANALYTICS_SUMMARY_EVENT_SELECT_COLUMNS
    );

    const itemsQuery = recordedQueries.find((q) => q.table === 'items');
    assert.ok(itemsQuery, 'Must query items');
    assert.equal(
      itemsQuery.columns,
      ANALYTICS_SUMMARY_ITEM_SELECT_COLUMNS
    );

    // 2. Assert serialized payload and item summaries never leak large image/description/options/user-agent data
    const serializedSummary = JSON.stringify(summary);
    assert.ok(
      !serializedSummary.includes('data:image/'),
      'Response payload must not contain inline base64 data URI images'
    );
    assert.ok(
      !serializedSummary.includes('image_url'),
      'Response payload must not contain image_url field'
    );
    assert.ok(
      !serializedSummary.includes('desc_i18n'),
      'Response payload must not contain desc_i18n field'
    );
    assert.ok(
      !serializedSummary.includes('options_json'),
      'Response payload must not contain options_json field'
    );
    assert.ok(
      !serializedSummary.includes('user_agent') &&
        !serializedSummary.includes('SecretAgent'),
      'Response payload must not contain user_agent data'
    );

    // 3. Assert event counts and recentEvents
    assert.equal(summary.scanDoorCount, 2);
    assert.equal(summary.scanTableCount, 3);
    assert.equal(summary.totalScans, 5);
    assert.equal(summary.showToStaffCount, 1);
    assert.equal(summary.wifiCopyCount, 1);
    assert.equal(summary.recentEvents.length, 10);
    for (const ev of summary.recentEvents) {
      assert.equal('user_agent' in ev, false);
    }

    // 4. Assert financial and order metrics computed from paginated orders
    assert.equal(summary.todayRevenue, 240000);
    assert.equal(summary.totalRevenue, 405000);
    assert.equal(summary.todayGrossOrderAmount, 285000);
    assert.equal(summary.todayUnpaidAmount, 45000);
    assert.equal(summary.todayRefundedAmount, 25000);
    assert.equal(summary.totalRefundedAmount, 25000);
    assert.equal(summary.todayOrdersCount, 4);
    assert.equal(summary.todayPaidOrdersCount, 3);
    assert.equal(summary.todayCompletedCount, 3);
    assert.equal(summary.completedOrdersCount, 4);
    assert.equal(summary.paidOrdersCount, 4);
    assert.equal(summary.totalOrdersCount, 5);
    assert.equal(summary.newOrdersCount, 1);
    assert.equal(summary.preparingOrdersCount, 1);
    assert.equal(summary.avgOrderValue, 101250);

    // 5. Assert catalog, table, and inventory counts
    assert.equal(summary.totalCatalogItems, 5);
    assert.equal(summary.availableCatalogItems, 4);
    assert.equal(summary.activeTablesCount, 2);
    assert.equal(summary.lowStockCount, 2); // item-1 (3) and item-4 (5)
    assert.equal(summary.outOfStockCount, 1); // item-3 (stock 0, is_available false)
    assert.deepEqual(
      summary.lowStockItems.map((i) => i.id),
      ['item-1', 'item-4']
    );
    assert.deepEqual(
      summary.mposStats.lowStockItems.map((i) => i.id),
      ['item-1', 'item-4']
    );

    // 6. Assert topSellingItems projected with sold quantities, stock, and revenue
    assert.equal(summary.topSellingItems.length, 5);
    assert.deepEqual(
      summary.topSellingItems.map((i) => ({
        id: i.id,
        name_vi: i.name_vi,
        price: i.price,
        sold_count: i.sold_count,
        stock_quantity: i.stock_quantity,
        is_available: i.is_available,
        revenue: i.revenue,
      })),
      [
        {
          id: 'item-2',
          name_vi: 'Cà Phê Muối',
          price: 35000,
          sold_count: 10,
          stock_quantity: null,
          is_available: true,
          revenue: 350000,
        },
        {
          id: 'item-4',
          name_vi: 'Bún Bò Huế',
          price: 60000,
          sold_count: 8,
          stock_quantity: 5,
          is_available: true,
          revenue: 480000,
        },
        {
          id: 'item-1',
          name_vi: 'Phở Bò Đặc Biệt',
          price: 55000,
          sold_count: 5,
          stock_quantity: 3,
          is_available: true,
          revenue: 275000,
        },
        {
          id: 'item-3',
          name_vi: 'Trà Đào Cam Sả',
          price: 45000,
          sold_count: 2,
          stock_quantity: 0,
          is_available: false,
          revenue: 90000,
        },
        {
          id: 'item-5',
          name_vi: 'Quẩy Giòn',
          price: 25000,
          sold_count: 1,
          stock_quantity: 20,
          is_available: true,
          revenue: 25000,
        },
      ]
    );

    // 7. Assert topItems catalog ranking by view_count
    assert.equal(summary.topItems.length, 5);
    assert.deepEqual(
      summary.topItems.map((i) => ({
        id: i.id,
        name_vi: i.name_vi,
        price: i.price,
        view_count: i.view_count,
        sold_count: i.sold_count,
        stock_quantity: i.stock_quantity,
        is_available: i.is_available,
      })),
      [
        {
          id: 'item-1',
          name_vi: 'Phở Bò Đặc Biệt',
          price: 55000,
          view_count: 100,
          sold_count: 5,
          stock_quantity: 3,
          is_available: true,
        },
        {
          id: 'item-2',
          name_vi: 'Cà Phê Muối',
          price: 35000,
          view_count: 80,
          sold_count: 10,
          stock_quantity: null,
          is_available: true,
        },
        {
          id: 'item-3',
          name_vi: 'Trà Đào Cam Sả',
          price: 45000,
          view_count: 60,
          sold_count: 2,
          stock_quantity: 0,
          is_available: false,
        },
        {
          id: 'item-4',
          name_vi: 'Bún Bò Huế',
          price: 60000,
          view_count: 50,
          sold_count: 8,
          stock_quantity: 5,
          is_available: true,
        },
        {
          id: 'item-5',
          name_vi: 'Quẩy Giòn',
          price: 25000,
          view_count: 30,
          sold_count: 1,
          stock_quantity: 20,
          is_available: true,
        },
      ]
    );

    // 8. Assert payment, source, and 7-day revenue breakdowns
    assert.deepEqual(summary.paymentBreakdown, {
      vietqr: { count: 3, revenue: 335000, percentage: 83 },
      cash: { count: 1, revenue: 70000, percentage: 17 },
    });
    assert.deepEqual(summary.sourceBreakdown, {
      qr_table: { count: 3, revenue: 335000, percentage: 75 },
      counter_pos: { count: 1, revenue: 70000, percentage: 25 },
    });
    assert.equal(summary.dailyRevenue7d.length, 7);
    const todayDaily = summary.dailyRevenue7d[6];
    assert.equal(todayDaily.date, '2026-10-24');
    assert.equal(todayDaily.label, 'Hôm nay');
    assert.equal(todayDaily.revenue, 240000);
    assert.equal(todayDaily.cashRevenue, 70000);
    assert.equal(todayDaily.vietqrRevenue, 170000);
    assert.equal(todayDaily.orders, 4);

    const yesterdayDaily = summary.dailyRevenue7d[5];
    assert.equal(yesterdayDaily.date, '2026-10-23');
    assert.equal(yesterdayDaily.label, '23/10');
    assert.equal(yesterdayDaily.revenue, 165000);
    assert.equal(yesterdayDaily.cashRevenue, 0);
    assert.equal(yesterdayDaily.vietqrRevenue, 165000);
    assert.equal(yesterdayDaily.orders, 1);
  });

  test('Overview metric derivation never invents funnel, chart, payment, source, or hourly values for zero or missing data', () => {
    const { deriveOverviewMetrics, source } =
      loadDashboardAnalyticsSyncFromSource();

    // 1. Missing / empty summary
    const missingMetrics = deriveOverviewMetrics({});
    assert.equal(missingMetrics.vietqrPct, 0);
    assert.equal(missingMetrics.cashPct, 0);
    assert.equal(missingMetrics.hasPaymentActivity, false);
    assert.equal(missingMetrics.qrSourcePct, 0);
    assert.equal(missingMetrics.posSourcePct, 0);
    assert.equal(missingMetrics.hasSourceActivity, false);
    assert.deepEqual(missingMetrics.hourlySlots, []);
    assert.equal(missingMetrics.peakSlot, null);
    assert.equal(missingMetrics.totalQrScans, 0);
    assert.equal(missingMetrics.totalItemViews, 0);
    assert.equal(missingMetrics.totalOrdersSubmitted, 0);
    assert.equal(missingMetrics.completedOrders, 0);
    assert.deepEqual(missingMetrics.funnelSteps, {
      scanPct: 0,
      itemViewPct: 0,
      ordersSubmittedPct: 0,
      completedOrdersPct: 0,
    });

    // 2. Explicit zero summary with 7 zero-revenue days and 6 zero-revenue hourly slots
    const zeroMetrics = deriveOverviewMetrics({
      scanDoorCount: 0,
      scanTableCount: 0,
      showToStaffCount: 0,
      wifiCopyCount: 0,
      totalScans: 0,
      totalOrdersCount: 0,
      completedOrdersCount: 0,
      topItems: [
        { id: 'item-1', name_vi: 'Cà phê', price: 30000, is_available: true, view_count: 0 },
      ],
      dailyRevenue7d: [
        { date: '2026-10-25', label: 'Hôm nay', revenue: 0, cashRevenue: 0, vietqrRevenue: 0, orders: 0 },
      ],
      paymentBreakdown: {
        vietqr: { count: 0, revenue: 0, percentage: 0 },
        cash: { count: 0, revenue: 0, percentage: 0 },
      },
      sourceBreakdown: {
        qr_table: { count: 0, revenue: 0, percentage: 0 },
        counter_pos: { count: 0, revenue: 0, percentage: 0 },
      },
      hourlyBreakdown: [
        { slot: '06h-09h', label: 'Sáng (6-9h)', orders: 0, revenue: 0, percentage: 0 },
        { slot: '09h-12h', label: 'Trưa (9-12h)', orders: 0, revenue: 0, percentage: 0 },
      ],
    });

    assert.equal(zeroMetrics.vietqrPct, 0);
    assert.equal(zeroMetrics.cashPct, 0);
    assert.equal(zeroMetrics.qrSourcePct, 0);
    assert.equal(zeroMetrics.posSourcePct, 0);
    assert.equal(zeroMetrics.totalQrScans, 0);
    assert.equal(zeroMetrics.totalItemViews, 0);
    assert.equal(zeroMetrics.totalOrdersSubmitted, 0);
    assert.equal(zeroMetrics.completedOrders, 0);
    assert.deepEqual(zeroMetrics.funnelSteps, {
      scanPct: 0,
      itemViewPct: 0,
      ordersSubmittedPct: 0,
      completedOrdersPct: 0,
    });
    assert.equal(zeroMetrics.daily7d[0].heightPct, 0);
    assert.equal(zeroMetrics.daily7d[0].vqShare, 0);
    assert.equal(zeroMetrics.daily7d[0].cashShare, 0);
    assert.equal(zeroMetrics.hourlySlots.length, 2);
    assert.ok(
      zeroMetrics.hourlySlots.every(
        (s) => s.orders === 0 && s.revenue === 0 && s.percentage === 0 && s.barHeightPct === 0
      )
    );
    assert.equal(zeroMetrics.peakSlot, null);

    // 3. Nonzero summary preserves genuine metrics
    const activeMetrics = deriveOverviewMetrics({
      scanDoorCount: 15,
      scanTableCount: 25,
      showToStaffCount: 2,
      totalScans: 40,
      totalOrdersCount: 8,
      completedOrdersCount: 6,
      topItems: [
        { id: 'item-1', name_vi: 'Cà phê', price: 30000, is_available: true, view_count: 20 },
        { id: 'item-2', name_vi: 'Trà đào', price: 40000, is_available: true, view_count: 10 },
      ],
      dailyRevenue7d: [
        { date: '2026-10-25', label: 'Hôm nay', revenue: 200000, cashRevenue: 50000, vietqrRevenue: 150000, orders: 6 },
      ],
      paymentBreakdown: {
        vietqr: { count: 4, revenue: 150000, percentage: 75 },
        cash: { count: 2, revenue: 50000, percentage: 25 },
      },
      sourceBreakdown: {
        qr_table: { count: 5, revenue: 170000, percentage: 83 },
        counter_pos: { count: 1, revenue: 30000, percentage: 17 },
      },
      hourlyBreakdown: [
        { slot: '06h-09h', label: 'Sáng (6-9h)', orders: 0, revenue: 0, percentage: 0 },
        { slot: '09h-12h', label: 'Trưa (9-12h)', orders: 6, revenue: 200000, percentage: 100 },
      ],
    });

    assert.equal(activeMetrics.vietqrPct, 75);
    assert.equal(activeMetrics.cashPct, 25);
    assert.equal(activeMetrics.hasPaymentActivity, true);
    assert.equal(activeMetrics.qrSourcePct, 83);
    assert.equal(activeMetrics.posSourcePct, 17);
    assert.equal(activeMetrics.hasSourceActivity, true);
    assert.equal(activeMetrics.totalQrScans, 40);
    assert.equal(activeMetrics.totalItemViews, 30);
    assert.equal(activeMetrics.totalOrdersSubmitted, 10);
    assert.equal(activeMetrics.completedOrders, 6);
    assert.deepEqual(activeMetrics.funnelSteps, {
      scanPct: 100,
      itemViewPct: 75,
      ordersSubmittedPct: 25,
      completedOrdersPct: 15,
    });
    assert.equal(activeMetrics.daily7d[0].vqShare, 75);
    assert.equal(activeMetrics.daily7d[0].cashShare, 25);
    assert.equal(activeMetrics.peakSlot?.slot, '09h-12h');
    assert.equal(activeMetrics.hourlySlots[0].barHeightPct, 0);
    assert.equal(activeMetrics.hourlySlots[1].barHeightPct, 100);

    const overcountedViews = deriveOverviewMetrics({
      scanDoorCount: 10,
      scanTableCount: 0,
      totalScans: 10,
      topItems: [
        { id: 'item-1', name_vi: 'Cà phê', price: 30000, is_available: true, view_count: 40 },
      ],
    });
    assert.equal(overcountedViews.funnelSteps.scanPct, 100);
    assert.equal(overcountedViews.funnelSteps.itemViewPct, 100);

    // 4. Source invariants: hardcoded sample fallbacks are absent from page.tsx
    assert.doesNotMatch(source, /\|\|\s*120\b/);
    assert.doesNotMatch(source, /\*\s*0\.72\b/);
    assert.doesNotMatch(source, /\|\|\s*18\b/);
    assert.doesNotMatch(source, /\|\|\s*12\b/);
    assert.doesNotMatch(source, /\?\?\s*65\b/);
    assert.doesNotMatch(source, /\?\?\s*35\b/);
    assert.doesNotMatch(source, /\?\?\s*75\b/);
    assert.doesNotMatch(source, /\?\?\s*25\b/);
  });

  test('Overview analytics fetch state surfaces initial failure, preserves last good snapshot on silent refresh failure, and clears on retry or shop change', () => {
    const {
      createInitialOverviewAnalyticsState,
      applyOverviewAnalyticsFetchStart,
      applyOverviewAnalyticsFetchSuccess,
      applyOverviewAnalyticsFetchFailure,
      source,
    } = loadDashboardAnalyticsSyncFromSource();

    // 1. Initial load failure: summary remains null (never renders fake success), loading becomes false, error is populated
    const initial = createInitialOverviewAnalyticsState();
    assert.deepEqual(initial, { summary: null, loading: true, error: null });

    const afterInitialStart = applyOverviewAnalyticsFetchStart(initial, false);
    assert.deepEqual(afterInitialStart, {
      summary: null,
      loading: true,
      error: null,
    });

    const afterInitialError = applyOverviewAnalyticsFetchFailure(
      afterInitialStart,
      'HTTP_500'
    );
    assert.equal(afterInitialError.summary, null);
    assert.equal(afterInitialError.loading, false);
    assert.equal(afterInitialError.error, 'HTTP_500');

    // 2. Manual retry succeeds: clears error and populates summary
    const afterRetryStart = applyOverviewAnalyticsFetchStart(
      afterInitialError,
      false
    );
    assert.equal(afterRetryStart.loading, true);
    assert.equal(afterRetryStart.error, null);

    const goodSnapshot = { todayRevenue: 180000, totalOrdersCount: 4 };
    const afterRetrySuccess = applyOverviewAnalyticsFetchSuccess(goodSnapshot);
    assert.deepEqual(afterRetrySuccess, {
      summary: goodSnapshot,
      loading: false,
      error: null,
    });

    // 3. Background (silent) refresh fails: preserves last good snapshot while exposing refresh error
    const afterSilentStart = applyOverviewAnalyticsFetchStart(
      afterRetrySuccess,
      true
    );
    assert.deepEqual(afterSilentStart, {
      summary: goodSnapshot,
      loading: false,
      error: null,
    });

    const afterSilentFailure = applyOverviewAnalyticsFetchFailure(
      afterSilentStart,
      'NETWORK_ERROR'
    );
    assert.deepEqual(afterSilentFailure.summary, goodSnapshot);
    assert.equal(afterSilentFailure.loading, false);
    assert.equal(afterSilentFailure.error, 'NETWORK_ERROR');

    // 4. Subsequent refresh succeeds: clears refresh error
    const afterRecovery = applyOverviewAnalyticsFetchSuccess({
      todayRevenue: 220000,
      totalOrdersCount: 5,
    });
    assert.equal(afterRecovery.error, null);
    assert.equal(afterRecovery.loading, false);
    assert.deepEqual(afterRecovery.summary, {
      todayRevenue: 220000,
      totalOrdersCount: 5,
    });

    // 5. Shop change resets summary and error
    const afterShopSwitch = createInitialOverviewAnalyticsState();
    assert.deepEqual(afterShopSwitch, {
      summary: null,
      loading: true,
      error: null,
    });

    // 6. Verify error & retry UI testids exist in page.tsx
    assert.match(source, /data-testid="overview-error-state"/);
    assert.match(source, /data-testid="overview-retry-button"/);
    assert.match(source, /data-testid="overview-refresh-error-banner"/);
    assert.match(source, /data-testid="overview-refresh-retry-button"/);
  });
});
