import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTableFloorPlanSummaries,
  aggregateTableFloorPlan,
  type TableFloorPlanSummary,
} from '@/lib/table-floor-plan';
import type { ShopOrder, ShopTable } from '@/types/qlaok';

function makeTable(overrides: Partial<ShopTable> = {}): ShopTable {
  return {
    id: overrides.id ?? 'tbl-1',
    shop_id: overrides.shop_id ?? 'shop-001',
    table_code: overrides.table_code ?? 'T01',
    name: overrides.name ?? 'Bàn 01',
    section: overrides.section ?? 'Khu A',
    capacity: overrides.capacity ?? 4,
    sort_order: overrides.sort_order ?? 1,
    is_active: overrides.is_active ?? true,
    is_archived: overrides.is_archived ?? false,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<ShopOrder> = {}): ShopOrder {
  return {
    id: overrides.id ?? 'ord-1',
    order_code: overrides.order_code ?? 'ORD-001',
    shop_id: overrides.shop_id ?? 'shop-001',
    table_id: overrides.table_id !== undefined ? overrides.table_id : 'tbl-1',
    table_label: overrides.table_label ?? 'Bàn 01',
    visitor_lang: 'vi',
    status: overrides.status ?? 'new',
    payment_method: overrides.payment_method ?? 'cash',
    payment_status: overrides.payment_status ?? 'unpaid',
    total_amount: overrides.total_amount ?? 50000,
    items: [],
    source: 'qr_table',
    created_at: overrides.created_at ?? '2026-10-22T10:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('table-floor-plan aggregation slice', () => {
  test('mixed active states/priority: new/preparing takes priority over completed unpaid, and completed unpaid over free', () => {
    const table = makeTable({ id: 'tbl-prio', is_active: true });

    // Table has both a preparing order (paid) and a completed unpaid order
    const preparingPaidOrder = makeOrder({
      id: 'ord-prep-paid',
      table_id: 'tbl-prio',
      status: 'preparing',
      payment_status: 'paid',
      total_amount: 100000,
    });
    const completedUnpaidOrder = makeOrder({
      id: 'ord-comp-unpaid',
      table_id: 'tbl-prio',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 60000,
    });

    const summaries = computeTableFloorPlanSummaries(
      [table],
      [preparingPaidOrder, completedUnpaidOrder]
    );

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-prio',
      floor_status: 'occupied', // Preparing order makes it occupied, not waiting_payment
      open_order_count: 2, // Both are open
      unpaid_amount: 60000, // Only completed unpaid order contributes to unpaid_amount
    });

    // Test with new order + completed unpaid order
    const newUnpaidOrder = makeOrder({
      id: 'ord-new',
      table_id: 'tbl-prio',
      status: 'new',
      payment_status: 'unpaid',
      total_amount: 40000,
    });

    const summaries2 = computeTableFloorPlanSummaries(
      [table],
      [newUnpaidOrder, completedUnpaidOrder]
    );
    assert.equal(summaries2[0].floor_status, 'occupied');
    assert.equal(summaries2[0].open_order_count, 2);
    assert.equal(summaries2[0].unpaid_amount, 100000);

    // Test completed unpaid + completed paid -> waiting_payment
    const completedPaidOrder = makeOrder({
      id: 'ord-comp-paid',
      table_id: 'tbl-prio',
      status: 'completed',
      payment_status: 'paid',
      total_amount: 90000,
    });

    const summaries3 = computeTableFloorPlanSummaries(
      [table],
      [completedUnpaidOrder, completedPaidOrder]
    );
    assert.equal(summaries3[0].floor_status, 'waiting_payment');
    assert.equal(summaries3[0].open_order_count, 1);
    assert.equal(summaries3[0].unpaid_amount, 60000);
  });

  test('paid order still preparing: occupied status, open count 1, unpaid amount 0', () => {
    const table = makeTable({ id: 'tbl-prep', is_active: true });
    const order = makeOrder({
      id: 'ord-prep',
      table_id: 'tbl-prep',
      status: 'preparing',
      payment_status: 'paid',
      total_amount: 150000,
    });

    const summaries = computeTableFloorPlanSummaries([table], [order]);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-prep',
      floor_status: 'occupied',
      open_order_count: 1,
      unpaid_amount: 0,
    });
  });

  test('completed unpaid: waiting_payment status, open count 1, unpaid amount summed', () => {
    const table = makeTable({ id: 'tbl-unpaid', is_active: true });
    const order = makeOrder({
      id: 'ord-comp-unpaid-only',
      table_id: 'tbl-unpaid',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 85000,
    });

    const summaries = computeTableFloorPlanSummaries([table], [order]);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-unpaid',
      floor_status: 'waiting_payment',
      open_order_count: 1,
      unpaid_amount: 85000,
    });
  });

  test('refunded/paid/cancelled excluded from unpaid_amount and cancelled excluded from open', () => {
    const table = makeTable({ id: 'tbl-excl', is_active: true });

    const orders: ShopOrder[] = [
      makeOrder({
        id: 'ord-cancelled-unpaid',
        table_id: 'tbl-excl',
        status: 'cancelled',
        payment_status: 'unpaid',
        total_amount: 100000,
      }),
      makeOrder({
        id: 'ord-cancelled-refunded',
        table_id: 'tbl-excl',
        status: 'cancelled',
        payment_status: 'refunded',
        total_amount: 50000,
      }),
      makeOrder({
        id: 'ord-completed-paid',
        table_id: 'tbl-excl',
        status: 'completed',
        payment_status: 'paid',
        total_amount: 70000,
      }),
      makeOrder({
        id: 'ord-completed-refunded',
        table_id: 'tbl-excl',
        status: 'completed',
        payment_status: 'refunded',
        total_amount: 40000,
      }),
      makeOrder({
        id: 'ord-completed-unpaid-valid',
        table_id: 'tbl-excl',
        status: 'completed',
        payment_status: 'unpaid',
        total_amount: 25000,
      }),
    ];

    const summaries = computeTableFloorPlanSummaries([table], orders);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-excl',
      floor_status: 'waiting_payment',
      open_order_count: 1, // Only ord-completed-unpaid-valid is open
      unpaid_amount: 25000, // Only ord-completed-unpaid-valid is counted in unpaid_amount
    });

    // If only cancelled orders exist, table is free and unpaid is 0
    const onlyCancelled = computeTableFloorPlanSummaries([table], [orders[0], orders[1]]);
    assert.deepEqual(onlyCancelled[0], {
      table_id: 'tbl-excl',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });
  });

  test('inactive tables: always inactive floor_status regardless of orders, with open counts and unpaid amounts intact', () => {
    const inactiveTableWithOrders = makeTable({
      id: 'tbl-inact-1',
      is_active: false,
    });
    const inactiveTableEmpty = makeTable({
      id: 'tbl-inact-2',
      is_active: false,
    });

    const activeOrder = makeOrder({
      id: 'ord-inact',
      table_id: 'tbl-inact-1',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 120000,
    });

    const summaries = computeTableFloorPlanSummaries(
      [inactiveTableWithOrders, inactiveTableEmpty],
      [activeOrder]
    );

    assert.equal(summaries.length, 2);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-inact-1',
      floor_status: 'inactive', // inactive overrides occupied
      open_order_count: 1,
      unpaid_amount: 120000,
    });
    assert.deepEqual(summaries[1], {
      table_id: 'tbl-inact-2',
      floor_status: 'inactive',
      open_order_count: 0,
      unpaid_amount: 0,
    });
  });

  test('no orders: free status, 0 open orders, 0 unpaid amount', () => {
    const activeTable = makeTable({ id: 'tbl-free-1', is_active: true });
    const inactiveTable = makeTable({ id: 'tbl-free-2', is_active: false });

    // Empty orders array
    const summariesEmpty = computeTableFloorPlanSummaries(
      [activeTable, inactiveTable],
      []
    );
    assert.equal(summariesEmpty.length, 2);
    assert.deepEqual(summariesEmpty[0], {
      table_id: 'tbl-free-1',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });
    assert.deepEqual(summariesEmpty[1], {
      table_id: 'tbl-free-2',
      floor_status: 'inactive',
      open_order_count: 0,
      unpaid_amount: 0,
    });

    // Default orders parameter
    const summariesDefault = computeTableFloorPlanSummaries([activeTable]);
    assert.deepEqual(summariesDefault[0], {
      table_id: 'tbl-free-1',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });

    // Empty tables input
    assert.deepEqual(computeTableFloorPlanSummaries([], [makeOrder()]), []);
  });

  test('archived tables excluded from returned summaries', () => {
    const activeTable = makeTable({ id: 'tbl-active', is_archived: false });
    const archivedTable = makeTable({ id: 'tbl-archived', is_archived: true });

    const orderArchived = makeOrder({
      id: 'ord-archived',
      table_id: 'tbl-archived',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 50000,
    });

    const summaries = computeTableFloorPlanSummaries(
      [activeTable, archivedTable],
      [orderArchived]
    );

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].table_id, 'tbl-active');
    assert.equal(summaries[0].floor_status, 'free');
  });

  test('cross-shop and table isolation: orders do not bleed across shop boundaries or tables', () => {
    const tableShopA = makeTable({
      id: 'tbl-shared-id',
      shop_id: 'shop-A',
      is_active: true,
    });
    const tableShopB = makeTable({
      id: 'tbl-shared-id',
      shop_id: 'shop-B',
      is_active: true,
    });
    const tableOtherA = makeTable({
      id: 'tbl-other-a',
      shop_id: 'shop-A',
      is_active: true,
    });

    const orderShopA = makeOrder({
      id: 'ord-a',
      shop_id: 'shop-A',
      table_id: 'tbl-shared-id',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 80000,
    });

    const summaries = computeTableFloorPlanSummaries(
      [tableShopA, tableShopB, tableOtherA],
      [orderShopA]
    );

    // tableShopA receives the order
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-shared-id',
      floor_status: 'occupied',
      open_order_count: 1,
      unpaid_amount: 80000,
    });

    // tableShopB is completely isolated even though it shares table_id
    assert.deepEqual(summaries[1], {
      table_id: 'tbl-shared-id',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });

    // tableOtherA in shop-A is unaffected
    assert.deepEqual(summaries[2], {
      table_id: 'tbl-other-a',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });
  });

  test('legacy fallback: resolves unambiguous table_label when table_id is absent, rejects ambiguous labels and takeaway', () => {
    const table1 = makeTable({
      id: 'tbl-vip-1',
      shop_id: 'shop-001',
      table_code: 'VIP1',
      name: 'Phòng VIP 1',
    });
    const table2 = makeTable({
      id: 'tbl-vip-2',
      shop_id: 'shop-001',
      table_code: 'VIP2',
      name: 'Phòng VIP 2',
    });
    const tableAmbiguousA = makeTable({
      id: 'tbl-amb-a',
      shop_id: 'shop-001',
      table_code: 'A1',
      name: 'Bàn Trùng',
    });
    const tableAmbiguousB = makeTable({
      id: 'tbl-amb-b',
      shop_id: 'shop-001',
      table_code: 'A2',
      name: 'Bàn Trùng',
    });

    // 1. Unambiguous legacy order matches table1 by name
    const orderUnambiguous = makeOrder({
      id: 'ord-unambig',
      shop_id: 'shop-001',
      table_id: null,
      table_label: 'Phòng VIP 1',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 35000,
    });

    // 2. Ambiguous legacy order matches two tables -> must NOT match either
    const orderAmbiguous = makeOrder({
      id: 'ord-ambig',
      shop_id: 'shop-001',
      table_id: null,
      table_label: 'Bàn Trùng',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 50000,
    });

    // 3. Takeaway order label -> must NOT match any table
    const orderTakeaway = makeOrder({
      id: 'ord-takeaway',
      shop_id: 'shop-001',
      table_id: null,
      table_label: 'Mang về',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 90000,
    });

    // 4. Order with explicit table_id takes precedence over table_label
    const orderExplicitTableId = makeOrder({
      id: 'ord-explicit',
      shop_id: 'shop-001',
      table_id: 'tbl-vip-2',
      table_label: 'Phòng VIP 1', // Mismatched legacy label is ignored because table_id is explicit
      status: 'preparing',
      payment_status: 'paid',
      total_amount: 45000,
    });

    const tables = [table1, table2, tableAmbiguousA, tableAmbiguousB];
    const orders = [
      orderUnambiguous,
      orderAmbiguous,
      orderTakeaway,
      orderExplicitTableId,
    ];

    const summaries = computeTableFloorPlanSummaries(tables, orders);

    // table1 gets orderUnambiguous
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-vip-1',
      floor_status: 'waiting_payment',
      open_order_count: 1,
      unpaid_amount: 35000,
    });

    // table2 gets orderExplicitTableId
    assert.deepEqual(summaries[1], {
      table_id: 'tbl-vip-2',
      floor_status: 'occupied',
      open_order_count: 1,
      unpaid_amount: 0, // Paid order
    });

    // tableAmbiguousA is free because orderAmbiguous was ambiguous
    assert.deepEqual(summaries[2], {
      table_id: 'tbl-amb-a',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });

    // tableAmbiguousB is free because orderAmbiguous was ambiguous
    assert.deepEqual(summaries[3], {
      table_id: 'tbl-amb-b',
      floor_status: 'free',
      open_order_count: 0,
      unpaid_amount: 0,
    });
  });

  test('purity and immutability: inputs are frozen and not mutated', () => {
    const frozenTable = Object.freeze(makeTable({ id: 'tbl-frozen' }));
    const frozenOrder = Object.freeze(
      makeOrder({
        id: 'ord-frozen',
        table_id: 'tbl-frozen',
        status: 'preparing',
        payment_status: 'unpaid',
        total_amount: 75000,
      })
    );

    const tables = Object.freeze([frozenTable]);
    const orders = Object.freeze([frozenOrder]);

    const summaries = aggregateTableFloorPlan(tables, orders);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-frozen',
      floor_status: 'occupied',
      open_order_count: 1,
      unpaid_amount: 75000,
    });
  });

  test('safely ignores nullish entries in tables list when resolving legacy table_label', () => {
    const tableValid = makeTable({
      id: 'tbl-target',
      shop_id: 'shop-001',
      table_code: 'T10',
      name: 'Bàn 10',
    });

    const tables = [
      null as unknown as ShopTable,
      tableValid,
      undefined as unknown as ShopTable,
    ];

    const orderLegacy = makeOrder({
      id: 'ord-legacy-nullish',
      shop_id: 'shop-001',
      table_id: null,
      table_label: 'Bàn 10',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 45000,
    });

    const summaries = computeTableFloorPlanSummaries(tables, [orderLegacy]);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-target',
      floor_status: 'waiting_payment',
      open_order_count: 1,
      unpaid_amount: 45000,
    });
  });

  test('safely converts total_amount: finite numeric values contribute, negatives clamp to zero, and NaN/Infinity/malformed truthy values do not poison unpaid_amount', () => {
    const table = makeTable({ id: 'tbl-amount-safety', is_active: true });

    const validOrder = makeOrder({
      id: 'ord-valid',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 50000,
    });

    const negativeOrder = makeOrder({
      id: 'ord-negative',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: -20000,
    });

    const nanOrder = makeOrder({
      id: 'ord-nan',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: NaN,
    });

    const infinityOrder = makeOrder({
      id: 'ord-infinity',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: Infinity,
    });

    const negInfinityOrder = makeOrder({
      id: 'ord-neg-infinity',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: -Infinity,
    });

    const malformedStringOrder = makeOrder({
      id: 'ord-malformed-str',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 'not-a-number' as unknown as number,
    });

    const malformedNanStringOrder = makeOrder({
      id: 'ord-malformed-nan-str',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 'NaN' as unknown as number,
    });

    const malformedInfinityStringOrder = makeOrder({
      id: 'ord-malformed-inf-str',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 'Infinity' as unknown as number,
    });

    const malformedBoolOrder = makeOrder({
      id: 'ord-malformed-bool',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: true as unknown as number,
    });

    const malformedObjectOrder = makeOrder({
      id: 'ord-malformed-obj',
      table_id: 'tbl-amount-safety',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: { amount: 99999 } as unknown as number,
    });

    const summaries = computeTableFloorPlanSummaries([table], [
      validOrder,
      negativeOrder,
      nanOrder,
      infinityOrder,
      negInfinityOrder,
      malformedStringOrder,
      malformedNanStringOrder,
      malformedInfinityStringOrder,
      malformedBoolOrder,
      malformedObjectOrder,
    ]);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-amount-safety',
      floor_status: 'waiting_payment',
      open_order_count: 10,
      unpaid_amount: 50000,
    });
    assert.ok(Number.isFinite(summaries[0].unpaid_amount));
    assert.ok(!Number.isNaN(summaries[0].unpaid_amount));
  });

  test('duplicate order IDs count once for open orders and unpaid amount', () => {
    const table = makeTable({ id: 'tbl-dup', is_active: true });

    const orderOriginal = makeOrder({
      id: 'ord-dup-1',
      table_id: 'tbl-dup',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 30000,
    });

    const orderDuplicate = makeOrder({
      id: 'ord-dup-1',
      table_id: 'tbl-dup',
      status: 'completed',
      payment_status: 'unpaid',
      total_amount: 30000,
    });

    const orderAnother = makeOrder({
      id: 'ord-unique-2',
      table_id: 'tbl-dup',
      status: 'preparing',
      payment_status: 'unpaid',
      total_amount: 25000,
    });

    const summaries = computeTableFloorPlanSummaries([table], [
      orderOriginal,
      orderDuplicate,
      orderAnother,
    ]);

    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0], {
      table_id: 'tbl-dup',
      floor_status: 'occupied',
      open_order_count: 2, // 1 deduplicated completed + 1 unique preparing
      unpaid_amount: 55000, // 30000 + 25000 (duplicate 30000 counts only once)
    });
  });
});
