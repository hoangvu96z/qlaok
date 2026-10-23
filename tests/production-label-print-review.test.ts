import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SHOP_LABEL_PRINT_CONFIG,
  MAX_LABEL_COPIES_PER_UNIT,
  MAX_MAX_LABELS_PER_PRINT,
  MIN_LABEL_COPIES_PER_UNIT,
  MIN_MAX_LABELS_PER_PRINT,
} from '@/lib/label-print-config';
import {
  buildProductionLabelBatch,
  computeRequiredLabelCount,
  type ProductionLabel,
  type ProductionLabelBatchOverLimitError,
} from '@/lib/production-label-print';
import type {
  OrderLineItem,
  ShopLabelPrintConfig,
  ShopOrder,
} from '@/types/qlaok';

function createMockLineItems(): OrderLineItem[] {
  return [
    {
      item_id: 'item_milktea',
      name_vi: 'Trà Sữa Ô Long Nướng',
      name_i18n: {
        vi: 'Trà Sữa Ô Long Nướng',
        en: 'Roasted Oolong Milk Tea',
      },
      quantity: 2,
      unit_price: 35000,
      original_unit_price: 40000,
      custom_unit_price: 35000,
      catalog_unit_price: 40000,
      extra_price: 10000,
      discount_percent: 10,
      line_discount_amount: 4000,
      selected_choices: [
        {
          id: 'opt_ice_50',
          label_vi: '50% Đá',
          label_i18n: { vi: '50% Đá', en: '50% Ice' },
          extra_price: 0,
        },
        {
          id: 'opt_pudding',
          label_vi: 'Pudding trứng',
          label_i18n: { vi: 'Pudding trứng', en: 'Egg Pudding' },
          extra_price: 10000,
        },
      ],
      custom_note: 'Ít ngọt hơn bình thường',
      quick_tags: ['takeaway', 'cold'],
    },
    {
      item_id: 'item_coffee',
      name_vi: 'Cà Phê Sữa Sài Gòn',
      name_i18n: {
        vi: 'Cà Phê Sữa Sài Gòn',
        en: 'Saigon Milk Coffee',
      },
      quantity: 1,
      unit_price: 25000,
      original_unit_price: 25000,
      catalog_unit_price: 25000,
      extra_price: 0,
      selected_choices: [],
      custom_note: 'Nhiều sữa ít đá',
      quick_tags: ['hot'],
    },
  ];
}

function createMockOrder(overrides?: Partial<ShopOrder>): ShopOrder {
  return {
    id: 'order_test_123',
    order_code: 'QL-8899',
    shop_id: 'shop_test_456',
    table_id: 'table_1',
    table_label: 'Bàn 01',
    visitor_lang: 'vi',
    customer_note: 'Giao nhanh giúp quán',
    status: 'new',
    payment_method: 'cash',
    payment_status: 'unpaid',
    total_amount: 105000,
    subtotal_amount: 105000,
    source: 'qr_table',
    created_at: '2026-10-24T02:00:00.000Z',
    updated_at: '2026-10-24T02:00:00.000Z',
    items: createMockLineItems(),
    ...overrides,
  };
}

function createMockConfig(
  overrides?: Partial<ShopLabelPrintConfig>
): ShopLabelPrintConfig {
  return {
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    enabled: true,
    paper_preset: 'cup_sticker_50x30',
    split_mode: 'per_item_unit',
    copies_per_unit: 1,
    max_labels_per_print: 50,
    ...overrides,
  };
}

test('1. per_item_unit split mode produces one logical label per ordered unit with quantity=1', () => {
  const order = createMockOrder();
  const config = createMockConfig({ split_mode: 'per_item_unit', copies_per_unit: 1 });

  const result = buildProductionLabelBatch(order, config);

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.status, 'success');
  assert.equal(result.total_labels, 3); // 2 units of milktea + 1 unit of coffee
  assert.equal(result.logical_label_total, 3);
  assert.equal(result.labels.length, 3);

  // Label 1: Milktea unit 1
  const label1 = result.labels[0]!;
  assert.equal(label1.label_index, 1);
  assert.equal(label1.total_labels, 3);
  assert.equal(label1.logical_label_index, 1);
  assert.equal(label1.logical_label_total, 3);
  assert.equal(label1.unit_index, 1);
  assert.equal(label1.unit_total, 2);
  assert.equal(label1.source_line_index, 0);
  assert.equal(label1.items.length, 1);
  assert.equal(label1.items[0]?.item_id, 'item_milktea');
  assert.equal(label1.items[0]?.quantity, 1); // quantity clone = 1

  // Label 2: Milktea unit 2
  const label2 = result.labels[1]!;
  assert.equal(label2.label_index, 2);
  assert.equal(label2.total_labels, 3);
  assert.equal(label2.logical_label_index, 2);
  assert.equal(label2.logical_label_total, 3);
  assert.equal(label2.unit_index, 2);
  assert.equal(label2.unit_total, 2);
  assert.equal(label2.source_line_index, 0);
  assert.equal(label2.items.length, 1);
  assert.equal(label2.items[0]?.item_id, 'item_milktea');
  assert.equal(label2.items[0]?.quantity, 1); // quantity clone = 1

  // Label 3: Coffee unit 1
  const label3 = result.labels[2]!;
  assert.equal(label3.label_index, 3);
  assert.equal(label3.total_labels, 3);
  assert.equal(label3.logical_label_index, 3);
  assert.equal(label3.logical_label_total, 3);
  assert.equal(label3.unit_index, 1);
  assert.equal(label3.unit_total, 1);
  assert.equal(label3.source_line_index, 1);
  assert.equal(label3.items.length, 1);
  assert.equal(label3.items[0]?.item_id, 'item_coffee');
  assert.equal(label3.items[0]?.quantity, 1);
});

test('2. per_line_item split mode produces one logical label per order line preserving original quantity', () => {
  const order = createMockOrder();
  const config = createMockConfig({
    split_mode: 'per_line_item',
    paper_preset: 'production_slip_58mm',
    copies_per_unit: 1,
  });

  const result = buildProductionLabelBatch(order, config);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.total_labels, 2); // 2 order lines
  assert.equal(result.logical_label_total, 2);
  assert.equal(result.labels.length, 2);

  // Label 1: Milktea line
  const label1 = result.labels[0]!;
  assert.equal(label1.label_index, 1);
  assert.equal(label1.total_labels, 2);
  assert.equal(label1.logical_label_index, 1);
  assert.equal(label1.items.length, 1);
  assert.equal(label1.items[0]?.item_id, 'item_milktea');
  assert.equal(label1.items[0]?.quantity, 2); // original quantity preserved

  // Label 2: Coffee line
  const label2 = result.labels[1]!;
  assert.equal(label2.label_index, 2);
  assert.equal(label2.total_labels, 2);
  assert.equal(label2.logical_label_index, 2);
  assert.equal(label2.items.length, 1);
  assert.equal(label2.items[0]?.item_id, 'item_coffee');
  assert.equal(label2.items[0]?.quantity, 1);
});

test('3. single_ticket split mode produces one logical label containing all order lines', () => {
  const order = createMockOrder();
  const config = createMockConfig({
    split_mode: 'single_ticket',
    paper_preset: 'production_slip_80mm',
    copies_per_unit: 1,
  });

  const result = buildProductionLabelBatch(order, config);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.total_labels, 1);
  assert.equal(result.logical_label_total, 1);
  assert.equal(result.labels.length, 1);

  const ticket = result.labels[0]!;
  assert.equal(ticket.label_index, 1);
  assert.equal(ticket.total_labels, 1);
  assert.equal(ticket.logical_label_index, 1);
  assert.equal(ticket.items.length, 2);
  assert.equal(ticket.items[0]?.item_id, 'item_milktea');
  assert.equal(ticket.items[0]?.quantity, 2);
  assert.equal(ticket.items[1]?.item_id, 'item_coffee');
  assert.equal(ticket.items[1]?.quantity, 1);
});

test('4. copies_per_unit creates exact copies in every mode and preserves contiguous 1..N sequence and copy metadata', () => {
  const order = createMockOrder();

  // Mode A: per_item_unit with copies_per_unit = 2
  const configUnit = createMockConfig({
    split_mode: 'per_item_unit',
    copies_per_unit: 2,
  });
  const resUnit = buildProductionLabelBatch(order, configUnit);
  assert.equal(resUnit.ok, true);
  if (!resUnit.ok) return;
  assert.equal(resUnit.total_labels, 6); // 3 units * 2 copies = 6
  assert.equal(resUnit.labels.length, 6);

  // Contiguous sequence from 1..6 and correct copy number metadata
  const expectedUnitSequence = [
    { label_index: 1, copy_index: 1, logical_label_index: 1, itemId: 'item_milktea' },
    { label_index: 2, copy_index: 2, logical_label_index: 1, itemId: 'item_milktea' },
    { label_index: 3, copy_index: 1, logical_label_index: 2, itemId: 'item_milktea' },
    { label_index: 4, copy_index: 2, logical_label_index: 2, itemId: 'item_milktea' },
    { label_index: 5, copy_index: 1, logical_label_index: 3, itemId: 'item_coffee' },
    { label_index: 6, copy_index: 2, logical_label_index: 3, itemId: 'item_coffee' },
  ];

  for (let i = 0; i < 6; i++) {
    const currentLabel: ProductionLabel = resUnit.labels[i]!;
    const exp = expectedUnitSequence[i]!;
    assert.equal(currentLabel.label_index, exp.label_index);
    assert.equal(currentLabel.total_labels, 6);
    assert.equal(currentLabel.copy_index, exp.copy_index);
    assert.equal(currentLabel.copy_number, exp.copy_index);
    assert.equal(currentLabel.copy_total, 2);
    assert.equal(currentLabel.total_copies, 2);
    assert.equal(currentLabel.logical_label_index, exp.logical_label_index);
    assert.equal(currentLabel.items[0]?.item_id, exp.itemId);
    assert.equal(currentLabel.items[0]?.quantity, 1);
  }

  // Mode B: per_line_item with copies_per_unit = 3
  const configLine = createMockConfig({
    split_mode: 'per_line_item',
    copies_per_unit: 3,
  });
  const resLine = buildProductionLabelBatch(order, configLine);
  assert.equal(resLine.ok, true);
  if (!resLine.ok) return;
  assert.equal(resLine.total_labels, 6); // 2 lines * 3 copies = 6
  assert.equal(resLine.labels.length, 6);

  for (let i = 0; i < 6; i++) {
    const currentLabel: ProductionLabel = resLine.labels[i]!;
    assert.equal(currentLabel.label_index, i + 1);
    assert.equal(currentLabel.total_labels, 6);
    assert.equal(currentLabel.copy_total, 3);
    const expectedCopy = (i % 3) + 1;
    assert.equal(currentLabel.copy_index, expectedCopy);
    const expectedLineIndex = i < 3 ? 0 : 1;
    assert.equal(currentLabel.source_line_index, expectedLineIndex);
  }

  // Mode C: single_ticket with copies_per_unit = 2
  const configTicket = createMockConfig({
    split_mode: 'single_ticket',
    copies_per_unit: 2,
  });
  const resTicket = buildProductionLabelBatch(order, configTicket);
  assert.equal(resTicket.ok, true);
  assert.equal(resTicket.total_labels, 2);
  assert.equal(resTicket.labels.length, 2);
  assert.equal(resTicket.labels[0]?.copy_index, 1);
  assert.equal(resTicket.labels[1]?.copy_index, 2);
  assert.equal(resTicket.labels[0]?.label_index, 1);
  assert.equal(resTicket.labels[1]?.label_index, 2);
});

test('5. max boundary succeeds and over-limit returns requested/max counts with NO partial labels', () => {
  // Test 5A: Exact boundary (requested == max_labels_per_print) succeeds
  const orderExact = createMockOrder({
    items: [
      {
        item_id: 'i1',
        name_vi: 'Món 1',
        quantity: 2,
        unit_price: 10000,
        extra_price: 0,
        selected_choices: [],
      },
      {
        item_id: 'i2',
        name_vi: 'Món 2',
        quantity: 2,
        unit_price: 10000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
  });
  // 4 units, 1 copy = 4 labels requested. Set max = 4.
  const configExact = createMockConfig({
    split_mode: 'per_item_unit',
    copies_per_unit: 1,
    max_labels_per_print: 4,
  });

  const resExact = buildProductionLabelBatch(orderExact, configExact);
  assert.equal(resExact.ok, true);
  assert.equal(resExact.total_labels, 4);
  assert.equal(resExact.labels.length, 4);

  // Test 5B: Over limit by 1 (requested 5, max 4) fails with over_limit and NO partial labels
  const orderOver = createMockOrder({
    items: [
      {
        item_id: 'i1',
        name_vi: 'Món 1',
        quantity: 3,
        unit_price: 10000,
        extra_price: 0,
        selected_choices: [],
      },
      {
        item_id: 'i2',
        name_vi: 'Món 2',
        quantity: 2,
        unit_price: 10000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
  });
  // 5 units, 1 copy = 5 requested. Max = 4.
  const configOver = createMockConfig({
    split_mode: 'per_item_unit',
    copies_per_unit: 1,
    max_labels_per_print: 4,
  });

  const resOver = buildProductionLabelBatch(orderOver, configOver);
  assert.equal(resOver.ok, false);
  assert.equal(resOver.success, false);
  assert.equal(resOver.status, 'over_limit');
  assert.equal(resOver.code, 'EXCEEDS_MAX_LABELS');

  const overLimit = resOver as ProductionLabelBatchOverLimitError;
  assert.equal(overLimit.requested_count, 5);
  assert.equal(overLimit.max_count, 4);
  assert.equal(overLimit.requestedCount, 5);
  assert.equal(overLimit.maxCount, 4);
  assert.equal(overLimit.labels.length, 0); // Strictly no partial labels!

  // Test 5C: Multi-copy over limit (3 lines * 4 copies = 12 requested, max 10)
  const orderMulti = createMockOrder({
    items: [
      { item_id: 'i1', name_vi: 'Món 1', quantity: 1, unit_price: 10000, extra_price: 0, selected_choices: [] },
      { item_id: 'i2', name_vi: 'Món 2', quantity: 1, unit_price: 10000, extra_price: 0, selected_choices: [] },
      { item_id: 'i3', name_vi: 'Món 3', quantity: 1, unit_price: 10000, extra_price: 0, selected_choices: [] },
    ],
  });
  const configMulti = createMockConfig({
    split_mode: 'per_line_item',
    copies_per_unit: 4,
    max_labels_per_print: 10,
  });
  const resMulti = buildProductionLabelBatch(orderMulti, configMulti);
  assert.equal(resMulti.ok, false);
  assert.equal(resMulti.status, 'over_limit');
  assert.equal(resMulti.requested_count, 12);
  assert.equal(resMulti.max_count, 10);
  assert.equal(resMulti.labels.length, 0);
});

test('6. disabled config fails closed with CONFIG_DISABLED and empty labels', () => {
  const order = createMockOrder();
  const config = createMockConfig({ enabled: false });

  const result = buildProductionLabelBatch(order, config);

  assert.equal(result.ok, false);
  assert.equal(result.success, false);
  assert.equal(result.status, 'disabled');
  assert.equal(result.code, 'CONFIG_DISABLED');
  assert.equal(result.labels.length, 0);
});

test('7. empty or invalid orders fail closed with EMPTY_ORDER or INVALID_ORDER', () => {
  const config = createMockConfig();

  // Empty items array
  const emptyOrder = createMockOrder({ items: [] });
  const resEmpty = buildProductionLabelBatch(emptyOrder, config);
  assert.equal(resEmpty.ok, false);
  assert.equal(resEmpty.status, 'empty_order');
  assert.equal(resEmpty.code, 'EMPTY_ORDER');
  assert.equal(resEmpty.labels.length, 0);

  // Missing items
  const noItemsOrder = { ...createMockOrder(), items: undefined as unknown as OrderLineItem[] };
  const resNoItems = buildProductionLabelBatch(noItemsOrder, config);
  assert.equal(resNoItems.ok, false);
  assert.equal(resNoItems.status, 'empty_order');
  assert.equal(resNoItems.code, 'EMPTY_ORDER');

  // Null order
  const resNull = buildProductionLabelBatch(null as unknown as ShopOrder, config);
  assert.equal(resNull.ok, false);
  assert.equal(resNull.status, 'invalid_order');
  assert.equal(resNull.code, 'INVALID_ORDER');
});

test('8. invalid quantities fail closed with INVALID_QUANTITY', () => {
  const config = createMockConfig();

  const invalidQuantities = [0, -1, -10, 1.5, 2.7, NaN, Infinity, -Infinity, null, undefined, '2'];

  for (const badQty of invalidQuantities) {
    const badOrder = createMockOrder({
      items: [
        {
          item_id: 'i1',
          name_vi: 'Món 1',
          quantity: badQty as unknown as number,
          unit_price: 10000,
          extra_price: 0,
          selected_choices: [],
        },
      ],
    });

    const res = buildProductionLabelBatch(badOrder, config);
    assert.equal(res.ok, false, `Expected failure for quantity: ${badQty}`);
    assert.equal(res.status, 'invalid_quantity');
    assert.equal(res.code, 'INVALID_QUANTITY');
    assert.equal(res.labels.length, 0);
  }
});

test('9. invalid config fails closed with INVALID_CONFIG', () => {
  const order = createMockOrder();

  // Null and non-object configs
  assert.equal(buildProductionLabelBatch(order, null as unknown as ShopLabelPrintConfig).code, 'INVALID_CONFIG');
  assert.equal(buildProductionLabelBatch(order, undefined as unknown as ShopLabelPrintConfig).code, 'INVALID_CONFIG');
  assert.equal(buildProductionLabelBatch(order, 'not-a-config' as unknown as ShopLabelPrintConfig).code, 'INVALID_CONFIG');

  // Invalid split_mode
  const badSplit = createMockConfig({ split_mode: 'all_at_once' as unknown as any });
  assert.equal(buildProductionLabelBatch(order, badSplit).code, 'INVALID_CONFIG');

  // Invalid paper_preset
  const badPaper = createMockConfig({ paper_preset: 'a4_printer' as unknown as any });
  assert.equal(buildProductionLabelBatch(order, badPaper).code, 'INVALID_CONFIG');

  // Invalid copies_per_unit (< 1, > 5, or float)
  for (const badCopies of [0, -1, 6, 10, 1.5, NaN]) {
    const badConfig = createMockConfig({ copies_per_unit: badCopies as unknown as number });
    const res = buildProductionLabelBatch(order, badConfig);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'invalid_config');
    assert.equal(res.code, 'INVALID_CONFIG');
  }

  // Invalid max_labels_per_print (< 1, > 100, or float)
  for (const badMax of [0, -5, 101, 200, 25.5, NaN]) {
    const badConfig = createMockConfig({ max_labels_per_print: badMax as unknown as number });
    const res = buildProductionLabelBatch(order, badConfig);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'invalid_config');
    assert.equal(res.code, 'INVALID_CONFIG');
  }
});

test('10. pure immutability: deep frozen inputs survive and mutating returned labels leaves inputs untouched', () => {
  const order = createMockOrder();
  const config = createMockConfig();

  // Deep freeze the inputs to guarantee no mutation occurs
  Object.freeze(order);
  Object.freeze(order.items);
  for (const item of order.items) {
    Object.freeze(item);
    Object.freeze(item.selected_choices);
    for (const choice of item.selected_choices) {
      Object.freeze(choice);
    }
  }
  Object.freeze(config);

  // Calling helper on deeply frozen inputs must not throw
  const result = buildProductionLabelBatch(order, config);
  assert.equal(result.ok, true);

  // Mutating returned label or items must not alter the original order
  const label1 = result.labels[0]!;
  label1.items[0]!.quantity = 999;
  if (label1.items[0]!.selected_choices[0]) {
    label1.items[0]!.selected_choices[0].label_vi = 'Mutated Choice';
  }

  assert.equal(order.items[0]?.quantity, 2);
  assert.equal(order.items[0]?.selected_choices[0]?.label_vi, '50% Đá');
});

test('11. preserves line item prices, selected options, notes, tags, and i18n exactly', () => {
  const order = createMockOrder();
  const config = createMockConfig({ split_mode: 'per_line_item' });

  const result = buildProductionLabelBatch(order, config);
  assert.equal(result.ok, true);

  const milkteaLabel = result.labels[0]!;
  const item = milkteaLabel.items[0]!;

  // Prices preserved
  assert.equal(item.unit_price, 35000);
  assert.equal(item.original_unit_price, 40000);
  assert.equal(item.custom_unit_price, 35000);
  assert.equal(item.catalog_unit_price, 40000);
  assert.equal(item.extra_price, 10000);
  assert.equal(item.discount_percent, 10);
  assert.equal(item.line_discount_amount, 4000);

  // Selected choices preserved
  assert.equal(item.selected_choices.length, 2);
  assert.equal(item.selected_choices[0]?.id, 'opt_ice_50');
  assert.equal(item.selected_choices[0]?.label_vi, '50% Đá');
  assert.deepEqual(item.selected_choices[0]?.label_i18n, { vi: '50% Đá', en: '50% Ice' });
  assert.equal(item.selected_choices[1]?.id, 'opt_pudding');
  assert.equal(item.selected_choices[1]?.extra_price, 10000);

  // Notes, tags, and names preserved
  assert.equal(item.custom_note, 'Ít ngọt hơn bình thường');
  assert.deepEqual(item.quick_tags, ['takeaway', 'cold']);
  assert.equal(item.name_vi, 'Trà Sữa Ô Long Nướng');
  assert.deepEqual(item.name_i18n, {
    vi: 'Trà Sữa Ô Long Nướng',
    en: 'Roasted Oolong Milk Tea',
  });

  // Order metadata preserved
  assert.equal(milkteaLabel.order_id, 'order_test_123');
  assert.equal(milkteaLabel.order_code, 'QL-8899');
  assert.equal(milkteaLabel.table_label, 'Bàn 01');
  assert.equal(milkteaLabel.customer_note, 'Giao nhanh giúp quán');
  assert.equal(milkteaLabel.created_at, '2026-10-24T02:00:00.000Z');
  assert.equal(milkteaLabel.visitor_lang, 'vi');
  assert.equal(milkteaLabel.source, 'qr_table');
});

test('12. supports both positional (order, config) and options object ({ order, config }) invocations', () => {
  const order = createMockOrder();
  const config = createMockConfig({ split_mode: 'per_line_item' });

  const resPositional = buildProductionLabelBatch(order, config);
  const resObject = buildProductionLabelBatch({ order, config });

  assert.equal(resPositional.ok, true);
  assert.equal(resObject.ok, true);
  assert.equal(resPositional.total_labels, resObject.total_labels);
  assert.equal(resPositional.labels.length, resObject.labels.length);
  assert.equal(resPositional.labels[0]?.id, resObject.labels[0]?.id);
});

test('13. computeRequiredLabelCount safely computes counts and returns null on invalid inputs', () => {
  const items = [{ quantity: 3 }, { quantity: 2 }];

  // Valid calculations
  assert.equal(computeRequiredLabelCount(items, 'per_item_unit', 1), 5);
  assert.equal(computeRequiredLabelCount(items, 'per_item_unit', 2), 10);
  assert.equal(computeRequiredLabelCount(items, 'per_line_item', 1), 2);
  assert.equal(computeRequiredLabelCount(items, 'per_line_item', 3), 6);
  assert.equal(computeRequiredLabelCount(items, 'single_ticket', 1), 1);
  assert.equal(computeRequiredLabelCount(items, 'single_ticket', 2), 2);

  // Empty items
  assert.equal(computeRequiredLabelCount([], 'per_item_unit', 1), 0);

  // Invalid inputs return null
  assert.equal(computeRequiredLabelCount(items, 'per_item_unit', 0), null);
  assert.equal(computeRequiredLabelCount(items, 'per_item_unit', -1), null);
  assert.equal(computeRequiredLabelCount([{ quantity: 0 }], 'per_item_unit', 1), null);
  assert.equal(computeRequiredLabelCount([{ quantity: -5 }], 'per_item_unit', 1), null);
  assert.equal(computeRequiredLabelCount([{ quantity: 1.5 }], 'per_item_unit', 1), null);
});
