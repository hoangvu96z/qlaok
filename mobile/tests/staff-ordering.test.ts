import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertNoForbiddenMutationFields,
  buildAssistedOrderPayload,
  calculateCartItemCount,
  calculateCartSubtotal,
  calculateLineExtraPrice,
  calculateLineTotal,
  calculateLineUnitPrice,
  createCartLine,
  createTableSelection,
  createTakeawaySelection,
  filterActiveTables,
  getDefaultOptionChoices,
  isTakeawayLabel,
  isTakeawaySelection,
  removeCartLine,
  type StaffCatalogItem,
  type StaffOptionChoice,
  type StaffOptionGroup,
  type StaffTable,
  toggleOptionChoice,
  updateCartLineQuantity,
  validateAssistedOrderDraft,
  validateItemRequiredOptions,
} from '../src/lib/staff-ordering.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sample Catalog Fixture
const SAMPLE_SUGAR_GROUP: StaffOptionGroup = {
  id: 'grp-sugar',
  name_i18n: { vi: 'Mức đường', en: 'Sugar Level' },
  required: true,
  choices: [
    { id: 'sugar-100', label_i18n: { vi: '100% đường', en: '100% sugar' }, extra_price: 0 },
    { id: 'sugar-50', label_i18n: { vi: '50% đường', en: '50% sugar' }, extra_price: 0 },
    { id: 'sugar-0', label_i18n: { vi: 'Không đường', en: 'No sugar' }, extra_price: 0 },
  ],
};

const SAMPLE_TOPPING_GROUP: StaffOptionGroup = {
  id: 'grp-topping',
  name_i18n: { vi: 'Topping thêm', en: 'Add-on Toppings' },
  required: false,
  choices: [
    { id: 'top-pearl', label_i18n: { vi: 'Trân châu đen', en: 'Black pearl' }, extra_price: 8000 },
    { id: 'top-pudding', label_i18n: { vi: 'Pudding trứng', en: 'Egg pudding' }, extra_price: 10000 },
  ],
};

const SAMPLE_COFFEE: StaffCatalogItem = {
  id: 'item-coffee-01',
  shop_id: 'shop-cafe-01',
  category_id: 'cat-drinks',
  price: 35000,
  is_available: true,
  name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
  desc_i18n: { vi: 'Cà phê phin truyền thống', en: 'Traditional filter coffee' },
  options_json: [SAMPLE_SUGAR_GROUP, SAMPLE_TOPPING_GROUP],
};

const SAMPLE_CROISSANT: StaffCatalogItem = {
  id: 'item-bakery-01',
  shop_id: 'shop-cafe-01',
  category_id: 'cat-bakery',
  price: 28000,
  is_available: true,
  name_i18n: { vi: 'Bánh sừng bò', en: 'Croissant' },
  options_json: [],
};

const SAMPLE_TABLE_1: StaffTable = {
  id: 'tbl-01',
  shop_id: 'shop-cafe-01',
  name: 'Bàn 01',
  table_code: 'T01',
  section: 'Tầng 1',
  capacity: 4,
  sort_order: 1,
  is_active: true,
  is_archived: false,
};

const SAMPLE_TABLE_2_INACTIVE: StaffTable = {
  id: 'tbl-02',
  shop_id: 'shop-cafe-01',
  name: 'Bàn 02 (Bảo trì)',
  table_code: 'T02',
  section: 'Tầng 1',
  capacity: 2,
  sort_order: 2,
  is_active: false,
  is_archived: false,
};

const SAMPLE_TABLE_3_ARCHIVED: StaffTable = {
  id: 'tbl-03',
  shop_id: 'shop-cafe-01',
  name: 'Bàn cũ đã xóa',
  table_code: 'T03',
  capacity: 4,
  sort_order: 3,
  is_active: true,
  is_archived: true,
};

// ==========================================
// TEST SUITE
// ==========================================

test('filterActiveTables filters out inactive and archived tables, sorting active ones', () => {
  const allTables = [SAMPLE_TABLE_3_ARCHIVED, SAMPLE_TABLE_2_INACTIVE, SAMPLE_TABLE_1];
  const active = filterActiveTables(allTables);

  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'tbl-01');
  assert.equal(active[0].name, 'Bàn 01');
});

test('table selection vs takeaway selection semantics', () => {
  // 1. Table selection
  const tableSel = createTableSelection(SAMPLE_TABLE_1);
  assert.equal(tableSel.kind, 'table');
  assert.equal(tableSel.tableId, 'tbl-01');
  assert.equal(tableSel.tableLabel, 'Bàn 01');
  assert.equal(isTakeawaySelection(tableSel), false);

  // 2. Takeaway selection
  const takeawaySel = createTakeawaySelection('Mang về');
  assert.equal(takeawaySel.kind, 'takeaway');
  assert.equal(takeawaySel.tableId, null);
  assert.equal(takeawaySel.tableLabel, 'Mang về');
  assert.equal(isTakeawaySelection(takeawaySel), true);

  // 3. Takeaway label identification
  assert.equal(isTakeawayLabel('Mang về'), true);
  assert.equal(isTakeawayLabel('takeaway'), true);
  assert.equal(isTakeawayLabel('Bàn 01'), false);
});

test('pricing calculation previews compute accurate unit price, extras, and subtotal', () => {
  assert.equal(calculateLineUnitPrice(SAMPLE_COFFEE), 35000);
  assert.equal(calculateLineUnitPrice(SAMPLE_CROISSANT), 28000);

  // No extra options
  assert.equal(calculateLineExtraPrice([]), 0);

  // Sugar (0đ) + Pearl (8000đ)
  const choices: StaffOptionChoice[] = [
    SAMPLE_SUGAR_GROUP.choices[1], // 50% đường, 0đ
    SAMPLE_TOPPING_GROUP.choices[0], // Trân châu, 8000đ
  ];
  assert.equal(calculateLineExtraPrice(choices), 8000);

  // Line total: (35000 + 8000) * 2 = 86000
  assert.equal(calculateLineTotal(SAMPLE_COFFEE, choices, 2), 86000);

  // Cart total
  const line1 = createCartLine(SAMPLE_COFFEE, 2, choices);
  const line2 = createCartLine(SAMPLE_CROISSANT, 1, []);
  assert.equal(calculateCartSubtotal([line1, line2]), 86000 + 28000);
  assert.equal(calculateCartItemCount([line1, line2]), 3);
});

test('option groups defaults and validation', () => {
  // Default choices pre-selects required groups
  const defaults = getDefaultOptionChoices(SAMPLE_COFFEE);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, 'sugar-100');

  // Valid when required group is satisfied
  const validCheck = validateItemRequiredOptions(SAMPLE_COFFEE, [SAMPLE_SUGAR_GROUP.choices[2]]);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.missingGroups.length, 0);

  // Invalid when required group has no selection
  const invalidCheck = validateItemRequiredOptions(SAMPLE_COFFEE, [SAMPLE_TOPPING_GROUP.choices[0]]);
  assert.equal(invalidCheck.valid, false);
  assert.equal(invalidCheck.missingGroups.length, 1);
  assert.equal(invalidCheck.missingGroups[0].id, 'grp-sugar');

  // Item without options is always valid
  const croissantCheck = validateItemRequiredOptions(SAMPLE_CROISSANT, []);
  assert.equal(croissantCheck.valid, true);
});

test('toggleOptionChoice enforces single-select for required and multi-select for optional', () => {
  let choices: StaffOptionChoice[] = [SAMPLE_SUGAR_GROUP.choices[0]]; // 100% sugar

  // Required group: clicking 50% sugar replaces 100% sugar
  choices = toggleOptionChoice(choices, SAMPLE_SUGAR_GROUP, SAMPLE_SUGAR_GROUP.choices[1]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].id, 'sugar-50');

  // Optional group: clicking pearl adds it
  choices = toggleOptionChoice(choices, SAMPLE_TOPPING_GROUP, SAMPLE_TOPPING_GROUP.choices[0]);
  assert.equal(choices.length, 2);
  assert.ok(choices.some((c) => c.id === 'top-pearl'));

  // Optional group: clicking pudding adds it too (multi-select)
  choices = toggleOptionChoice(choices, SAMPLE_TOPPING_GROUP, SAMPLE_TOPPING_GROUP.choices[1]);
  assert.equal(choices.length, 3);
  assert.ok(choices.some((c) => c.id === 'top-pudding'));

  // Optional group: clicking pearl again removes it (toggle off)
  choices = toggleOptionChoice(choices, SAMPLE_TOPPING_GROUP, SAMPLE_TOPPING_GROUP.choices[0]);
  assert.equal(choices.length, 2);
  assert.ok(!choices.some((c) => c.id === 'top-pearl'));
});

test('cart line operations: create, update quantity, and remove', () => {
  const line1 = createCartLine(SAMPLE_COFFEE, 1);
  const line2 = createCartLine(SAMPLE_CROISSANT, 2);
  let cart = [line1, line2];

  // Update quantity
  cart = updateCartLineQuantity(cart, line1.lineId, 3);
  assert.equal(cart.find((l) => l.lineId === line1.lineId)?.quantity, 3);

  // Decreasing to 0 removes line
  cart = updateCartLineQuantity(cart, line1.lineId, 0);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].lineId, line2.lineId);

  // Manual remove
  cart = removeCartLine(cart, line2.lineId);
  assert.equal(cart.length, 0);
});

test('validateAssistedOrderDraft blocks invalid drafts before parent submission', () => {
  const validTable = createTableSelection(SAMPLE_TABLE_1);
  const validLine = createCartLine(SAMPLE_COFFEE, 1, [SAMPLE_SUGAR_GROUP.choices[0]]);

  // 1. Missing shopId
  const noShop = validateAssistedOrderDraft({
    shopId: '',
    table: validTable,
    cart: [validLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(noShop.ok, false);
  assert.equal(noShop.code, 'MISSING_SHOP_ID');

  // 2. Missing table selection
  const noTable = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: null,
    cart: [validLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(noTable.ok, false);
  assert.equal(noTable.code, 'TABLE_REQUIRED');

  // 3. Empty cart
  const emptyCart = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: validTable,
    cart: [],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(emptyCart.ok, false);
  assert.equal(emptyCart.code, 'EMPTY_CART');

  // 4. Invalid quantity (0)
  const zeroQtyLine = { ...validLine, quantity: 0 };
  const zeroQty = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: validTable,
    cart: [zeroQtyLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(zeroQty.ok, false);
  assert.equal(zeroQty.code, 'INVALID_QUANTITY');

  // 5. Item unavailable
  const unavailableLine = {
    ...validLine,
    item: { ...SAMPLE_COFFEE, is_available: false },
  };
  const unavail = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: validTable,
    cart: [unavailableLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(unavail.ok, false);
  assert.equal(unavail.code, 'ITEM_UNAVAILABLE');

  // 6. Missing required option
  const missingReqLine = {
    ...validLine,
    selectedChoices: [], // no sugar chosen
  };
  const missingReq = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: validTable,
    cart: [missingReqLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(missingReq.ok, false);
  assert.equal(missingReq.code, 'MISSING_REQUIRED_OPTIONS');

  // 7. Valid draft passes
  const validDraft = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table: validTable,
    cart: [validLine],
    idempotencyKey: 'idemp-1',
  });
  assert.equal(validDraft.ok, true);
});

test('buildAssistedOrderPayload produces exact POST /api/orders contract for table service', () => {
  const table = createTableSelection(SAMPLE_TABLE_1);
  const line1 = createCartLine(
    SAMPLE_COFFEE,
    2,
    [SAMPLE_SUGAR_GROUP.choices[1], SAMPLE_TOPPING_GROUP.choices[0]],
    'Ít đá riêng'
  );
  const line2 = createCartLine(SAMPLE_CROISSANT, 1, [], 'Làm nóng');

  const payload = buildAssistedOrderPayload({
    shopId: 'shop-cafe-01',
    table,
    cart: [line1, line2],
    idempotencyKey: 'pos-test-idemp-12345',
    visitorLang: 'vi',
  });

  // Verify top-level contract
  assert.equal(payload.shop_id, 'shop-cafe-01');
  assert.equal(payload.source, 'counter_pos');
  assert.equal(payload.table_id, 'tbl-01');
  assert.equal(payload.table_label, 'Bàn 01');
  assert.equal(payload.visitor_lang, 'vi');
  assert.equal(payload.idempotency_key, 'pos-test-idemp-12345');
  assert.equal(payload.items.length, 2);

  // Line 1 verification
  const pLine1 = payload.items[0];
  assert.equal(pLine1.item_id, 'item-coffee-01');
  assert.equal(pLine1.name_vi, 'Cà phê sữa đá');
  assert.deepEqual(pLine1.name_i18n, { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' });
  assert.equal(pLine1.quantity, 2);
  assert.equal(pLine1.unit_price, 35000);
  assert.equal(pLine1.extra_price, 8000);
  assert.equal(pLine1.custom_note, 'Ít đá riêng');
  assert.equal(pLine1.selected_choices.length, 2);
  assert.equal(pLine1.selected_choices[0].id, 'sugar-50');
  assert.equal(pLine1.selected_choices[1].id, 'top-pearl');
  assert.equal(pLine1.selected_choices[1].extra_price, 8000);

  // Line 2 verification
  const pLine2 = payload.items[1];
  assert.equal(pLine2.item_id, 'item-bakery-01');
  assert.equal(pLine2.name_vi, 'Bánh sừng bò');
  assert.equal(pLine2.quantity, 1);
  assert.equal(pLine2.unit_price, 28000);
  assert.equal(pLine2.extra_price, 0);
  assert.equal(pLine2.custom_note, 'Làm nóng');
  assert.deepEqual(pLine2.selected_choices, []);
});

test('buildAssistedOrderPayload correctly maps takeaway option with table_id = null without faking table', () => {
  const takeaway = createTakeawaySelection('Mang về');
  const line = createCartLine(SAMPLE_CROISSANT, 1);

  const payload = buildAssistedOrderPayload({
    shopId: 'shop-cafe-01',
    table: takeaway,
    cart: [line],
    idempotencyKey: 'idemp-takeaway-1',
  });

  assert.equal(payload.source, 'counter_pos');
  assert.equal(payload.table_id, null);
  assert.equal(payload.table_label, 'Mang về');
});

test('assertNoForbiddenMutationFields verifies the payload NEVER contains payment, discount, or fulfillment overrides', () => {
  const table = createTableSelection(SAMPLE_TABLE_1);
  const line = createCartLine(SAMPLE_COFFEE, 1, [SAMPLE_SUGAR_GROUP.choices[0]]);
  const payload = buildAssistedOrderPayload({
    shopId: 'shop-cafe-01',
    table,
    cart: [line],
    idempotencyKey: 'idemp-safe-check',
  });

  // Pure assertion passes on valid payload
  assertNoForbiddenMutationFields(payload);

  // Verify that injecting any forbidden fields immediately throws
  const forbiddenMutations: Array<Record<string, unknown>> = [
    { payment_status: 'paid' },
    { payment_status: 'unpaid' },
    { payment_method: 'cash' },
    { payment_method: 'vietqr' },
    { paid_at: new Date().toISOString() },
    { paid_by: 'staff-user-1' },
    { status: 'completed' },
    { status: 'preparing' },
    { status: 'new' },
    { workflow_step_id: 'step-done' },
    { markCompletedImmediately: true },
    { discount_amount: 10000 },
    { discount_code: 'DISC10' },
    { customer_name: 'Nguyen Van A' },
    { notes: 'Top level note' },
    { selected_options: ['opt1'] },
    { total_amount: 50000 },
  ];

  for (const forbidden of forbiddenMutations) {
    const tainted = { ...payload, ...forbidden };
    assert.throws(
      () => assertNoForbiddenMutationFields(tainted),
      /FORBIDDEN_MUTATION_FIELD/
    );
  }

  // Verify line item price override injection is blocked
  const taintedLinePayload = {
    ...payload,
    items: [
      {
        ...payload.items[0],
        custom_unit_price: 20000,
      },
    ],
  };
  assert.throws(
    () => assertNoForbiddenMutationFields(taintedLinePayload),
    /FORBIDDEN_MUTATION_FIELD/
  );

  const taintedLineOptions = {
    ...payload,
    items: [
      {
        ...payload.items[0],
        selected_options: ['invalid_key'],
      },
    ],
  };
  assert.throws(
    () => assertNoForbiddenMutationFields(taintedLineOptions),
    /FORBIDDEN_LINE_FIELD/
  );
});

test('quantity boundary validation and custom note trimming', () => {
  const table = createTableSelection(SAMPLE_TABLE_1);
  const baseLine = createCartLine(SAMPLE_CROISSANT, 1);

  // Boundary 999 passes
  const valid999 = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table,
    cart: [{ ...baseLine, quantity: 999 }],
    idempotencyKey: 'idemp-999',
  });
  assert.equal(valid999.ok, true);

  // Boundary 1000 fails
  const invalid1000 = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table,
    cart: [{ ...baseLine, quantity: 1000 }],
    idempotencyKey: 'idemp-1000',
  });
  assert.equal(invalid1000.ok, false);
  assert.equal(invalid1000.code, 'INVALID_QUANTITY');

  // Fractional quantity fails
  const invalidFraction = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table,
    cart: [{ ...baseLine, quantity: 1.5 }],
    idempotencyKey: 'idemp-frac',
  });
  assert.equal(invalidFraction.ok, false);
  assert.equal(invalidFraction.code, 'INVALID_QUANTITY');

  // Custom note with only whitespace is omitted in payload
  const lineWithWhitespaceNote = createCartLine(SAMPLE_CROISSANT, 1, [], '    \n\t  ');
  const payloadEmptyNote = buildAssistedOrderPayload({
    shopId: 'shop-cafe-01',
    table,
    cart: [lineWithWhitespaceNote],
    idempotencyKey: 'idemp-note',
  });
  assert.equal(payloadEmptyNote.items[0].custom_note, undefined);

  // Client lineId is NOT leaked to payload
  assert.equal((payloadEmptyNote.items[0] as unknown as Record<string, unknown>).lineId, undefined);
});

test('multi-group required option validation requires all required groups', () => {
  const table = createTableSelection(SAMPLE_TABLE_1);
  const secondRequiredGroup: StaffOptionGroup = {
    id: 'grp-ice',
    name_i18n: { vi: 'Mức đá', en: 'Ice Level' },
    required: true,
    choices: [
      { id: 'ice-100', label_i18n: { vi: 'Đá chung', en: 'Regular ice' }, extra_price: 0 },
      { id: 'ice-0', label_i18n: { vi: 'Không đá', en: 'No ice' }, extra_price: 0 },
    ],
  };

  const itemWithTwoRequired: StaffCatalogItem = {
    ...SAMPLE_COFFEE,
    id: 'item-coffee-dual-req',
    options_json: [SAMPLE_SUGAR_GROUP, secondRequiredGroup],
  };

  // Only sugar chosen -> ice missing -> fails
  const onlySugarLine = createCartLine(itemWithTwoRequired, 1, [SAMPLE_SUGAR_GROUP.choices[0]]);
  const checkOnlySugar = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table,
    cart: [onlySugarLine],
    idempotencyKey: 'idemp-dual-1',
  });
  assert.equal(checkOnlySugar.ok, false);
  assert.equal(checkOnlySugar.code, 'MISSING_REQUIRED_OPTIONS');
  assert.equal(checkOnlySugar.missingGroups?.length, 1);
  assert.equal(checkOnlySugar.missingGroups?.[0].id, 'grp-ice');

  // Both chosen -> passes
  const bothChosenLine = createCartLine(itemWithTwoRequired, 1, [
    SAMPLE_SUGAR_GROUP.choices[0],
    secondRequiredGroup.choices[0],
  ]);
  const checkBoth = validateAssistedOrderDraft({
    shopId: 'shop-cafe-01',
    table,
    cart: [bothChosenLine],
    idempotencyKey: 'idemp-dual-2',
  });
  assert.equal(checkBoth.ok, true);
});

test('simulate parent onSubmit: cart preserved on failure, cleared on success', async () => {
  const table = createTableSelection(SAMPLE_TABLE_1);
  let cart = [createCartLine(SAMPLE_CROISSANT, 2)];
  let submissionError = '';
  let submittedSuccess = false;

  // 1. Failing submission mock
  const failingSubmit = async () => {
    throw new Error('PRICE_CHANGED: Giá món đã thay đổi trên server');
  };

  try {
    buildAssistedOrderPayload({
      shopId: 'shop-cafe-01',
      table,
      cart,
      idempotencyKey: 'idemp-fail-sim',
    });
    await failingSubmit();
    cart = [];
    submittedSuccess = true;
  } catch (err) {
    submissionError = (err as Error).message;
    // Cart is preserved!
  }

  assert.equal(submissionError, 'PRICE_CHANGED: Giá món đã thay đổi trên server');
  assert.equal(submittedSuccess, false);
  assert.equal(cart.length, 1); // Cart remains intact!

  // 2. Successful submission mock
  const successfulSubmit = async (p: unknown) => {
    assert.ok(p);
  };

  try {
    const payload = buildAssistedOrderPayload({
      shopId: 'shop-cafe-01',
      table,
      cart,
      idempotencyKey: 'idemp-success-sim',
    });
    await successfulSubmit(payload);
    cart = [];
    submittedSuccess = true;
    submissionError = '';
  } catch (err) {
    submissionError = (err as Error).message;
  }

  assert.equal(submittedSuccess, true);
  assert.equal(submissionError, '');
  assert.equal(cart.length, 0); // Cart is cleared!
});

test('AssistedOrderScreen source inspection: adheres to UI requirements, error handling, and no WebView', () => {
  const componentSource = fs.readFileSync(
    path.join(__dirname, '../src/components/staff/AssistedOrderScreen.tsx'),
    'utf8'
  );

  // 1. No WebView
  assert.doesNotMatch(componentSource, /WebView/i);

  // 2. Uses MobileI18nProvider hook and tb(vi, en)
  assert.match(componentSource, /useMobileI18n/);
  assert.match(componentSource, /tb\(/);

  // 3. No payment collection or discount UI exposed
  assert.doesNotMatch(componentSource, /confirmMarkPaid/);
  assert.doesNotMatch(componentSource, /confirmRefund/);
  assert.doesNotMatch(componentSource, /discount_amount/);
  assert.doesNotMatch(componentSource, /apply_discount/i);
  assert.doesNotMatch(componentSource, /markCompleted/);

  // 4. Clearly shows order is unpaid
  assert.match(componentSource, /Chưa thanh toán/);
  assert.match(componentSource, /Unpaid/);

  // 5. Preserves cart on submission error and clears only on success
  assert.match(componentSource, /setSubmissionError\(msg\)/);
  assert.match(componentSource, /setCart\(\[\]\)/);
  assert.match(componentSource, /setSuccessOrderSummary/);

  // 6. Prominent table selection
  assert.match(componentSource, /tableSelectorBtn/);
  assert.match(componentSource, /isTablePickerOpen/);
  assert.match(componentSource, /createTakeawaySelection/);

  // 7. Option customization and validation
  assert.match(componentSource, /validateItemRequiredOptions/);
  assert.match(componentSource, /getDefaultOptionChoices/);
  assert.match(componentSource, /toggleOptionChoice/);

  // 8. Catalog item card does not nest interactive TouchableOpacity buttons
  assert.match(componentSource, /<View[^>]*compStyles\.itemCard/);
  assert.doesNotMatch(componentSource, /<TouchableOpacity[^>]*compStyles\.itemCard/);
});
