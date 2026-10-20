import assert from 'node:assert/strict';
import test from 'node:test';
import type { ShopOrder, ShopTable } from '@/types/qlaok';
import {
  buildCurrentViewExportPayload, computeReportKpiStats, createLocaleTranslator,
  filterReportOrders, getCanonicalTablesColumns, getVnDateKey, summarizeOrdersByDay, summarizeOrdersByItem,
  type ReportViewTab,
} from '@/lib/report-view';

const table: ShopTable = { id: 'table-a', shop_id: 'shop-a', table_code: 'T01', name: 'Tên bàn mới', section: '', capacity: 4, sort_order: 0, is_active: true, is_archived: false };
const line = { item_id: 'item-a', name_vi: 'Cùng tên', quantity: 2, unit_price: 80, original_unit_price: 100, extra_price: 20, selected_choices: [] };
function order(id: string, patch: Partial<ShopOrder> = {}): ShopOrder {
  return { id, order_code: id, shop_id: 'shop-a', table_id: table.id, table_label: 'Tên bàn lịch sử', visitor_lang: 'vi', status: 'preparing', payment_status: 'paid', payment_method: 'cash', total_amount: 180, discount_amount: 60, subtotal_amount: 240, source: 'qr_table', items: [{ ...line }], created_at: '2026-10-19T17:15:00Z', updated_at: '2026-10-20T00:00:00Z', ...patch };
}
const orders = [
  order('paid'),
  order('unpaid', { status: 'completed', payment_status: 'unpaid', total_amount: 50, discount_amount: 0, source: 'counter_pos', items: [{ ...line, item_id: 'item-b', quantity: 1, unit_price: 50, original_unit_price: 50, extra_price: 0 }] }),
  order('refunded', { status: 'completed', payment_status: 'refunded', total_amount: 120, discount_amount: 0, items: [{ ...line, quantity: 1 }] }),
  order('cancelled', { status: 'cancelled', total_amount: 999 }),
  order('foreign', { shop_id: 'shop-b', total_amount: 9999 }),
  order('outside', { created_at: '2026-10-19T16:59:59Z' }),
];
const filters = { dateBounds: { start: '2026-10-20', end: '2026-10-20' }, statusFilter: 'valid_only', paymentStatusFilter: 'all', paymentMethodFilter: 'all', sourceFilter: 'all', searchQuery: '' } as const;
const filtered = () => filterReportOrders(orders, filters, { shopId: 'shop-a', shopTables: [table] });
const payloadBase = () => ({ shop: { id: 'shop-a', name: 'Quán A', slug: 'quan-a', currency: 'VND' }, exportScope: 'all_filtered' as const, dateBounds: { ...filters.dateBounds, label: '20/10/2026' }, filters, filteredOrders: filtered(), shopTables: [table], tx: createLocaleTranslator('vi') });

test('report filters respect UTC+7 midnight, shop isolation, managed table search and payment/source filters', () => {
  assert.equal(getVnDateKey('2026-10-19T17:00:00Z'), '2026-10-20');
  assert.deepEqual(filtered().map(o => o.id), ['paid', 'unpaid', 'refunded']);
  assert.equal(filterReportOrders(orders, { ...filters, searchQuery: 'T01' }, { shopId: 'shop-a', shopTables: [table] }).length, 3);
  assert.deepEqual(filterReportOrders(orders, { ...filters, paymentStatusFilter: 'refunded' }, { shopId: 'shop-a' }).map(o => o.id), ['refunded']);
  assert.deepEqual(filterReportOrders(orders, { ...filters, sourceFilter: 'counter_pos' }, { shopId: 'shop-a' }).map(o => o.id), ['unpaid']);
});

test('collected daily revenue agrees with KPI and excludes completed-unpaid, refunded and cancelled orders', () => {
  const scoped = filterReportOrders(orders, { ...filters, statusFilter: 'all' }, { shopId: 'shop-a' });
  const kpi = computeReportKpiStats(scoped);
  const daily = summarizeOrdersByDay(scoped);
  assert.equal(kpi.collectedRevenue, 180);
  assert.equal(kpi.unpaidAmount, 50);
  assert.equal(kpi.refundedAmount, 120);
  assert.equal(kpi.cancelledCount, 1);
  assert.equal(daily.reduce((sum, row) => sum + row.collectedRevenue, 0), 180);
  assert.equal(daily[0].cashRevenue, 180);
  assert.equal(daily[0].ordersCount, 3);
  assert.equal(daily[0].paidOrdersCount, 1);
});

test('item gross keeps add-ons once, separates same-name item identities and counts each order once', () => {
  const withRepeatedLine = filtered().map(o => o.id === 'paid' ? { ...o, items: [...o.items, { ...o.items[0], quantity: 1 }] } : o);
  const items = summarizeOrdersByItem(withRepeatedLine);
  assert.equal(items.length, 2);
  const a = items.find(i => i.itemId === 'item-a')!;
  const b = items.find(i => i.itemId === 'item-b')!;
  assert.equal(a.grossSales, 480); // 3 paid units + 1 refunded unit, each 100 + 20.
  assert.equal(a.paidGrossSales, 360);
  assert.equal(a.orderAppearances, 2);
  assert.equal(b.grossSales, 50);
  assert.notEqual(a.grossSales, computeReportKpiStats(withRepeatedLine).collectedRevenue);
});

test('order export uses the same sorted scope, excludes private fields and labels refunds correctly in VI/EN', () => {
  const all = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'orders_list', sortState: { columnId: 'total_amount', direction: 'desc' } });
  assert.deepEqual(all.dataset.rows.map(r => r.order_code), ['#paid', '#refunded', '#unpaid']);
  assert.equal(all.dataset.rows[1].payment_status, 'Đã hoàn tiền');
  assert.ok(!all.dataset.columns.some(c => ['tracking_token', 'id', 'actions', 'shop_id'].includes(c.key)));
  const page = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'orders_list', exportScope: 'current_page', page: 99, rowsPerPage: 2, sortState: { columnId: 'total_amount', direction: 'desc' } });
  assert.deepEqual(page.dataset.rows.map(r => r.order_code), ['#unpaid']);
  assert.equal(page.totalFilteredRowCount, 3);
  assert.ok(page.filenameBase.endsWith('_page-2'));
  const en = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'orders_list', tx: createLocaleTranslator('en') });
  assert.equal(en.dataset.rows.find(r => r.order_code === '#refunded')!.payment_status, 'Refunded');
});

test('each active summary tab exports its own canonical columns and values, not raw order details', () => {
  const views: ReportViewTab[] = ['tables_summary', 'daily_summary', 'items_summary'];
  for (const activeTab of views) {
    const p = buildCurrentViewExportPayload({ ...payloadBase(), activeTab });
    assert.ok(p.dataset.rows.length > 0);
    assert.ok(!p.dataset.columns.some(c => c.key === 'order_code'));
    assert.deepEqual(Object.keys(p.dataset.rows[0]), p.dataset.columns.map(c => c.key));
    assert.ok(p.dataset.metadata?.some(([key]) => key.includes('Múi giờ')));
  }
  const daily = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'daily_summary' });
  assert.equal(daily.dataset.rows[0].collectedRevenue, 180);
  const tables = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'tables_summary' });
  assert.equal(tables.dataset.rows.reduce((sum, row) => sum + Number(row.collectedRevenue), 0), 180);
  const items = buildCurrentViewExportPayload({ ...payloadBase(), activeTab: 'items_summary' });
  assert.equal(items.dataset.rows.reduce((sum, row) => sum + Number(row.grossSales), 0), 410);
});


test('table export retains the visible code, section and availability badge', () => {
  const managed = { ...table, section: 'Tầng 2', is_active: false };
  const column = getCanonicalTablesColumns(createLocaleTranslator('vi'), new Map([[table.id, managed]]))[0];
  const value = column.getExportValue({ table_id: table.id, table_label: 'Bàn 01' } as Parameters<typeof column.getExportValue>[0], 0);
  assert.equal(value, 'Bàn 01 · #T01 · Tạm ngưng · Tầng 2');
});
