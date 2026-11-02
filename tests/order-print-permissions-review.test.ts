import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  canPrintTicketType,
  getAllowedTicketTypes,
  resolvePermittedDefaultTicketType,
  getRequiredPrintPermission,
} from '@/lib/order-print-permissions';
import { ReceiptPrintModal } from '@/components/dashboard/ReceiptPrintModal';
import type { Shop, ShopOrder, ShopPermission } from '@/types/qlaok';

const mockShop: Shop = {
  id: 'shop-test-1',
  owner_id: 'owner-1',
  slug: 'test-shop',
  name: 'Test Café',
  phone: '0901234567',
  address: '123 Đường Test, Quận 1',
  vertical: 'fnb',
  currency: 'VND',
  is_published: true,
  theme_config: {},
  created_at: new Date().toISOString(),
} as unknown as Shop;

function createMockOrder(overrides: Partial<ShopOrder> = {}): ShopOrder {
  return {
    id: 'ord-test-1',
    shop_id: 'shop-test-1',
    order_code: 'TEST01',
    table_label: 'Bàn 1',
    status: 'new',
    payment_status: 'unpaid',
    payment_method: 'cash',
    total_amount: 50000,
    subtotal_amount: 50000,
    discount_amount: 0,
    bill_version: 1,
    visitor_lang: 'vi',
    items: [
      {
        item_id: 'item-1',
        name_vi: 'Cà phê sữa đá',
        name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced milk coffee' },
        quantity: 1,
        unit_price: 50000,
        extra_price: 0,
        selected_choices: [],
      },
    ],
    created_at: new Date().toISOString(),
    ...overrides,
  } as unknown as ShopOrder;
}

test('getRequiredPrintPermission maps ticket types to authoritative permissions matching API route', () => {
  assert.equal(getRequiredPrintPermission('kitchen'), 'orders.print_kitchen');
  assert.equal(getRequiredPrintPermission('label'), 'orders.print_kitchen');
  assert.equal(getRequiredPrintPermission('provisional'), 'orders.print_provisional');
  assert.equal(getRequiredPrintPermission('receipt'), 'orders.view');
});

test('Role & ticket type permission matrix: unpaid orders', () => {
  // 1. Default staff: has orders.view, orders.create, orders.fulfill, orders.print_kitchen (NO orders.print_provisional)
  const staffPerms = new Set<ShopPermission>([
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
    'catalog.view',
    'inventory.adjust',
  ]);
  const hasStaffPerm = (p: ShopPermission) => staffPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'unpaid', hasPermission: hasStaffPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'unpaid', hasPermission: hasStaffPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'unpaid', hasPermission: hasStaffPerm }), false);
  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'unpaid', hasPermission: hasStaffPerm }), false);
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'unpaid', hasPermission: hasStaffPerm }),
    ['kitchen', 'label']
  );

  // 2. Cashier: has orders.print_provisional and orders.print_kitchen and orders.view
  const cashierPerms = new Set<ShopPermission>([
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
    'orders.print_provisional',
    'payment.collect',
  ]);
  const hasCashierPerm = (p: ShopPermission) => cashierPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'unpaid', hasPermission: hasCashierPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'unpaid', hasPermission: hasCashierPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'unpaid', hasPermission: hasCashierPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'unpaid', hasPermission: hasCashierPerm }), false); // unpaid receipt denied
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'unpaid', hasPermission: hasCashierPerm }),
    ['kitchen', 'provisional', 'label']
  );

  // 3. Provisional-only custom role: has orders.view and orders.print_provisional (NO print_kitchen)
  const provisionalOnlyPerms = new Set<ShopPermission>(['orders.view', 'orders.print_provisional']);
  const hasProvisionalOnly = (p: ShopPermission) => provisionalOnlyPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'unpaid', hasPermission: hasProvisionalOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'unpaid', hasPermission: hasProvisionalOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'unpaid', hasPermission: hasProvisionalOnly }), true);
  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'unpaid', hasPermission: hasProvisionalOnly }), false);
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'unpaid', hasPermission: hasProvisionalOnly }),
    ['provisional']
  );

  // 4. Kitchen-only role: has orders.print_kitchen (NO orders.view, NO print_provisional)
  const kitchenOnlyPerms = new Set<ShopPermission>(['orders.print_kitchen']);
  const hasKitchenOnly = (p: ShopPermission) => kitchenOnlyPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'unpaid', hasPermission: hasKitchenOnly }), true);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'unpaid', hasPermission: hasKitchenOnly }), true);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'unpaid', hasPermission: hasKitchenOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'unpaid', hasPermission: hasKitchenOnly }), false);

  // 5. View-only role: has orders.view (NO print permissions)
  const viewOnlyPerms = new Set<ShopPermission>(['orders.view']);
  const hasViewOnly = (p: ShopPermission) => viewOnlyPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'unpaid', hasPermission: hasViewOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'unpaid', hasPermission: hasViewOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'unpaid', hasPermission: hasViewOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'unpaid', hasPermission: hasViewOnly }), false);
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'unpaid', hasPermission: hasViewOnly }),
    []
  );
});

test('Role & ticket type permission matrix: paid orders', () => {
  // 1. Default staff on paid order: receipt allowed via orders.view
  const staffPerms = new Set<ShopPermission>([
    'orders.view',
    'orders.create',
    'orders.fulfill',
    'orders.print_kitchen',
  ]);
  const hasStaffPerm = (p: ShopPermission) => staffPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'paid', hasPermission: hasStaffPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'paid', hasPermission: hasStaffPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'paid', hasPermission: hasStaffPerm }), true);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'paid', hasPermission: hasStaffPerm }), false);
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'paid', hasPermission: hasStaffPerm }),
    ['kitchen', 'receipt', 'label']
  );

  // 2. View-only role on paid order: receipt allowed via orders.view
  const viewOnlyPerms = new Set<ShopPermission>(['orders.view']);
  const hasViewOnly = (p: ShopPermission) => viewOnlyPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'paid', hasPermission: hasViewOnly }), true);
  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'paid', hasPermission: hasViewOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'paid', hasPermission: hasViewOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'provisional', paymentStatus: 'paid', hasPermission: hasViewOnly }), false);
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'paid', hasPermission: hasViewOnly }),
    ['receipt']
  );

  // 3. Kitchen-only role on paid order: receipt denied because orders.view is missing
  const kitchenOnlyPerms = new Set<ShopPermission>(['orders.print_kitchen']);
  const hasKitchenOnly = (p: ShopPermission) => kitchenOnlyPerms.has(p);

  assert.equal(canPrintTicketType({ ticketType: 'receipt', paymentStatus: 'paid', hasPermission: hasKitchenOnly }), false);
  assert.equal(canPrintTicketType({ ticketType: 'kitchen', paymentStatus: 'paid', hasPermission: hasKitchenOnly }), true);
  assert.equal(canPrintTicketType({ ticketType: 'label', paymentStatus: 'paid', hasPermission: hasKitchenOnly }), true);

  // 4. Owner has all permissions
  const hasOwner = () => true;
  assert.deepEqual(
    getAllowedTicketTypes({ paymentStatus: 'paid', hasPermission: hasOwner }),
    ['kitchen', 'provisional', 'receipt', 'label']
  );
});

test('resolvePermittedDefaultTicketType selects permitted fallback and guards forbidden initialTicketType', () => {
  const staffPerms = new Set<ShopPermission>([
    'orders.view',
    'orders.print_kitchen',
  ]);
  const hasStaffPerm = (p: ShopPermission) => staffPerms.has(p);

  // Default staff requesting 'provisional' on unpaid order: falls back to permitted 'kitchen'
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: 'provisional',
      paymentStatus: 'unpaid',
      hasPermission: hasStaffPerm,
    }),
    'kitchen'
  );

  // Default staff with no initialTicketType on unpaid order: falls back to 'kitchen'
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: undefined,
      paymentStatus: 'unpaid',
      hasPermission: hasStaffPerm,
    }),
    'kitchen'
  );

  // Default staff on paid order: defaults to 'receipt'
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: undefined,
      paymentStatus: 'paid',
      hasPermission: hasStaffPerm,
    }),
    'receipt'
  );

  // Default staff requesting 'label' on paid order: allowed -> returns 'label'
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: 'label',
      paymentStatus: 'paid',
      hasPermission: hasStaffPerm,
    }),
    'label'
  );

  // Cashier on unpaid order: defaults to 'provisional'
  const cashierPerms = new Set<ShopPermission>([
    'orders.view',
    'orders.print_kitchen',
    'orders.print_provisional',
  ]);
  const hasCashierPerm = (p: ShopPermission) => cashierPerms.has(p);
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: undefined,
      paymentStatus: 'unpaid',
      hasPermission: hasCashierPerm,
    }),
    'provisional'
  );

  // View-only on unpaid order: no permitted types -> returns null
  const hasViewOnly = (p: ShopPermission) => p === 'orders.view';
  assert.equal(
    resolvePermittedDefaultTicketType({
      initialTicketType: undefined,
      paymentStatus: 'unpaid',
      hasPermission: hasViewOnly,
    }),
    null
  );
});

function isButtonDisabled(html: string, testId: string): boolean {
  const match = html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`));
  if (!match) throw new Error(`Button with testid "${testId}" not found in HTML`);
  return /\sdisabled(?=[\s=>])/.test(match[0]);
}

test('ReceiptPrintModal: renders null when no print type is allowed for the user', () => {
  const unpaidOrder = createMockOrder({ payment_status: 'unpaid' });
  const hasViewOnly = (p: ShopPermission) => p === 'orders.view';

  // View-only user cannot print anything on unpaid order -> modal returns null
  const html = renderToStaticMarkup(
    React.createElement(ReceiptPrintModal, {
      order: unpaidOrder,
      shop: mockShop,
      hasPermission: hasViewOnly,
      onClose: () => {},
    })
  );

  assert.equal(html, '', 'modal renders nothing when no print type is permitted');
});

test('ReceiptPrintModal: default staff on unpaid order disables provisional and receipt tabs and defaults to kitchen', () => {
  const unpaidOrder = createMockOrder({ payment_status: 'unpaid' });
  const staffPerms = new Set<ShopPermission>(['orders.view', 'orders.print_kitchen']);
  const hasStaffPerm = (p: ShopPermission) => staffPerms.has(p);

  const html = renderToStaticMarkup(
    React.createElement(ReceiptPrintModal, {
      order: unpaidOrder,
      shop: mockShop,
      initialTicketType: 'provisional', // even if provisional was requested
      hasPermission: hasStaffPerm,
      onClose: () => {},
    })
  );

  assert.ok(html.includes('data-testid="print-tab-kitchen"'));
  assert.ok(html.includes('data-testid="print-tab-label"'));
  assert.ok(html.includes('data-testid="print-tab-provisional"'));
  assert.ok(html.includes('data-testid="print-tab-receipt"'));

  // Kitchen and label are enabled
  assert.equal(isButtonDisabled(html, 'print-tab-kitchen'), false);
  assert.equal(isButtonDisabled(html, 'print-tab-label'), false);

  // Provisional and receipt tabs are disabled
  assert.equal(isButtonDisabled(html, 'print-tab-provisional'), true);
  assert.equal(isButtonDisabled(html, 'print-tab-receipt'), true);

  // Active default is kitchen ticket (PHIẾU BẾP / CHẾ BIẾN)
  assert.ok(html.includes('PHIẾU BẾP / CHẾ BIẾN'));
});

test('ReceiptPrintModal: default staff on paid order enables receipt tab via orders.view', () => {
  const paidOrder = createMockOrder({ payment_status: 'paid' });
  const staffPerms = new Set<ShopPermission>(['orders.view', 'orders.print_kitchen']);
  const hasStaffPerm = (p: ShopPermission) => staffPerms.has(p);

  const html = renderToStaticMarkup(
    React.createElement(ReceiptPrintModal, {
      order: paidOrder,
      shop: mockShop,
      hasPermission: hasStaffPerm,
      onClose: () => {},
    })
  );

  // Receipt tab is enabled for paid order
  assert.equal(isButtonDisabled(html, 'print-tab-receipt'), false);
  // Kitchen and label tabs are enabled
  assert.equal(isButtonDisabled(html, 'print-tab-kitchen'), false);
  assert.equal(isButtonDisabled(html, 'print-tab-label'), false);
  // Provisional tab remains disabled (no orders.print_provisional)
  assert.equal(isButtonDisabled(html, 'print-tab-provisional'), true);

  // Active default is paid receipt
  assert.ok(html.includes('BIÊN LAI ĐÃ THANH TOÁN'));
});

test('ReceiptPrintModal: provisional-only role enables provisional tab and disables kitchen/label tabs', () => {
  const unpaidOrder = createMockOrder({ payment_status: 'unpaid' });
  const provisionalOnlyPerms = new Set<ShopPermission>(['orders.view', 'orders.print_provisional']);
  const hasProvisionalOnly = (p: ShopPermission) => provisionalOnlyPerms.has(p);

  const html = renderToStaticMarkup(
    React.createElement(ReceiptPrintModal, {
      order: unpaidOrder,
      shop: mockShop,
      hasPermission: hasProvisionalOnly,
      onClose: () => {},
    })
  );

  // Provisional tab is enabled
  assert.equal(isButtonDisabled(html, 'print-tab-provisional'), false);
  // Kitchen and label tabs are disabled
  assert.equal(isButtonDisabled(html, 'print-tab-kitchen'), true);
  assert.equal(isButtonDisabled(html, 'print-tab-label'), true);
  // Receipt tab is disabled because unpaid
  assert.equal(isButtonDisabled(html, 'print-tab-receipt'), true);

  // Active default is provisional bill
  assert.ok(html.includes('PHIẾU TẠM TÍNH (CHƯA THU TIỀN)'));
});

test('Source contract verification: orders/page.tsx gates actions correctly', () => {
  const pageSource = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(dashboard)/dashboard/orders/page.tsx'),
    'utf-8'
  );

  // 1. Paid receipt card button uses orders.view, unpaid provisional uses orders.print_provisional
  assert.ok(
    pageSource.includes("order.payment_status === 'paid'\n                          ? hasPermission('orders.view')\n                          : hasPermission('orders.print_provisional')") ||
    pageSource.includes("order.payment_status === 'paid' ? hasPermission('orders.view') : hasPermission('orders.print_provisional')"),
    'card print action must check orders.view for paid receipt and orders.print_provisional for unpaid provisional'
  );

  // 2. Paid receipt click sets initial ticket type to receipt, unpaid to provisional
  assert.ok(
    pageSource.includes("setPrintingInitialTicketType(\n                              order.payment_status === 'paid'\n                                ? 'receipt'\n                                : 'provisional'\n                            );") ||
    pageSource.includes("order.payment_status === 'paid' ? 'receipt' : 'provisional'"),
    'card print action must explicitly set printingInitialTicketType'
  );

  // 3. QR modal provisional print button is guarded by orders.print_provisional
  assert.ok(
    pageSource.includes("hasPermission('orders.print_provisional') && (\n                    <button\n                      type=\"button\"\n                      onClick={() => {\n                        const targetOrder = qrOrderModal;\n                        setQrOrderModal(null);\n                        setPrintingInitialTicketType('provisional');\n                        setPrintingOrder(targetOrder);"),
    'QR modal provisional print button must be guarded by orders.print_provisional and set printingInitialTicketType to provisional'
  );

  // 4. ReceiptPrintModal is passed hasPermission
  assert.ok(
    pageSource.includes('hasPermission={hasPermission}'),
    'ReceiptPrintModal must receive hasPermission prop in orders/page.tsx'
  );
});
