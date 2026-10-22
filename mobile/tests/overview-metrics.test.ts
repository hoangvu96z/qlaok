import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildMobileOverviewMetrics,
  type MobileAnalyticsEvent,
  type MobileCatalogItem,
  type MobileShopOrderStats,
} from '../src/lib/overview-metrics.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('buildMobileOverviewMetrics uses server-side uncapped stats (>1000 orders) and preserves financial invariants', () => {
  const fixedNow = new Date('2026-10-22T08:00:00.000Z'); // 2026-10-22 15:00 ICT (UTC+7)
  const serverStats: MobileShopOrderStats = {
    // Includes 1005 historical orders where orders #1001..#1005 are beyond the 1000-row list cap
    todayRevenue: 1850000,
    totalRevenue: 48250000,
    paidOrdersCount: 1002,
    todayPaidOrdersCount: 42,
    todayOrdersCount: 45,
    totalOrdersCount: 1004,
    newOrdersCount: 7,
    preparingOrdersCount: 5,
    dailyRevenue7d: [
      { date: '2026-10-16', label: '16/10', revenue: 5100000, ordersCount: 120 },
      { date: '2026-10-17', label: '17/10', revenue: 6200000, ordersCount: 140 },
      { date: '2026-10-18', label: '18/10', revenue: 7300000, ordersCount: 165 },
      { date: '2026-10-19', label: '19/10', revenue: 8400000, ordersCount: 190 },
      { date: '2026-10-20', label: '20/10', revenue: 9500000, ordersCount: 210 },
      { date: '2026-10-21', label: '21/10', revenue: 9900000, ordersCount: 134 },
      { date: '2026-10-22', label: '22/10', revenue: 1850000, ordersCount: 45 },
    ],
  };

  const items: MobileCatalogItem[] = [
    {
      id: 'item-1',
      shop_id: 'shop-1',
      category_id: 'cat-1',
      sort_order: 1,
      price: 55000,
      stock_quantity: 3,
      sold_count: 640,
      name_i18n: { vi: 'Cà phê muối' },
      desc_i18n: {},
      is_available: true,
      is_featured: true,
      view_count: 100,
    },
    {
      id: 'item-2',
      shop_id: 'shop-1',
      category_id: 'cat-1',
      sort_order: 2,
      price: 45000,
      stock_quantity: 0,
      sold_count: 510,
      name_i18n: { vi: 'Trà đào cam sả' },
      desc_i18n: {},
      is_available: false,
      is_featured: false,
      view_count: 80,
    },
  ];

  const events: MobileAnalyticsEvent[] = [
    { id: 1, shop_id: 'shop-1', event_type: 'scan_door', visitor_lang: 'vi', created_at: '2026-10-22T01:00:00Z' },
    { id: 2, shop_id: 'shop-1', event_type: 'scan_table', visitor_lang: 'vi', created_at: '2026-10-22T02:00:00Z' },
    { id: 3, shop_id: 'shop-1', event_type: 'scan_table', visitor_lang: 'vi', created_at: '2026-10-22T03:00:00Z' },
  ];

  const metrics = buildMobileOverviewMetrics({
    stats: serverStats,
    items,
    events,
    now: fixedNow,
  });

  assert.equal(metrics.todayRevenue, 1850000);
  assert.equal(metrics.totalRevenue, 48250000);
  assert.equal(metrics.validOrdersCount, 1002);
  assert.equal(metrics.newOrdersCount, 7);
  assert.equal(metrics.preparingOrdersCount, 5);
  assert.equal(metrics.sevenDayBars.length, 7);
  assert.equal(metrics.sevenDayBars[6].dateKey, '2026-10-22');
  assert.equal(metrics.sevenDayBars[6].revenue, 1850000);
  assert.equal(metrics.maxDayRev, 9900000);
  assert.equal(metrics.lowStockCount, 1);
  assert.equal(metrics.outOfStockCount, 1);
  assert.equal(metrics.scanDoorCount, 1);
  assert.equal(metrics.scanTableCount, 2);
  assert.equal(metrics.topItems[0]?.id, 'item-1');
});

test('buildMobileOverviewMetrics safely handles null/redacted stats when reports.view is absent or loading', () => {
  const fixedNow = new Date('2026-10-22T08:00:00.000Z');
  const redactedStats: MobileShopOrderStats = {
    todayRevenue: null,
    totalRevenue: null,
    paidOrdersCount: null,
    newOrdersCount: 3,
    preparingOrdersCount: 2,
    dailyRevenue7d: [],
  };

  const metrics = buildMobileOverviewMetrics({
    stats: redactedStats,
    items: [],
    events: [],
    now: fixedNow,
  });

  assert.equal(metrics.todayRevenue, 0);
  assert.equal(metrics.totalRevenue, 0);
  assert.equal(metrics.validOrdersCount, 0);
  assert.equal(metrics.newOrdersCount, 3);
  assert.equal(metrics.preparingOrdersCount, 2);
  assert.equal(metrics.sevenDayBars.length, 7);
  assert.equal(metrics.sevenDayBars.every((bar) => bar.revenue === 0), true);
  assert.equal(metrics.maxDayRev, 100000);
});

test('OverviewTab consumes server stats prop and does not recompute totals from the capped orders list', () => {
  const overviewTabSource = fs.readFileSync(
    path.join(__dirname, '../src/components/tabs/OverviewTab.tsx'),
    'utf8'
  );
  assert.match(overviewTabSource, /buildMobileOverviewMetrics/);
  assert.doesNotMatch(overviewTabSource, /orders\.filter/);
});
