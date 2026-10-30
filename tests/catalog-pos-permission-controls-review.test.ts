import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuickItemRow } from '@/components/dashboard/QuickItemRow';
import { isNumpadModeAllowed } from '@/components/dashboard/PosCounterWorkspace';
import type { CatalogItem } from '@/types/qlaok';

// Synthetic seed data only; no production APIs or credentials.
const item = {
  id: 'item-1',
  shop_id: 'shop-test',
  category_id: 'cat-1',
  name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
  desc_i18n: { vi: '', en: '' },
  price: 35000,
  is_available: true,
  is_featured: false,
  image_url: 'https://example.invalid/coffee.png',
  stock_quantity: 5,
  options_json: [],
  view_count: 0,
  sort_order: 1,
} as unknown as CatalogItem;

function renderRow(canManageCatalog: boolean, canAdjustInventory: boolean) {
  return renderToStaticMarkup(
    React.createElement(QuickItemRow, {
      item,
      canManageCatalog,
      canAdjustInventory,
      onToggleAvailable: async () => true,
      onUpdatePrice: async () => true,
      onUpdateStock: async () => true,
      onUpdateImage: async () => true,
      onToggleFeatured: async () => true,
      onEditTranslations: () => {},
      onDelete: async () => true,
    })
  );
}

test('QuickItemRow: inventory-only member has no upload input and catalog-only controls', () => {
  const html = renderRow(false, true);
  assert.equal(html.includes('type="file"'), false);
  assert.ok(html.includes('data-testid="item-thumbnail-preview"'));
  assert.ok(html.includes('coffee.png'));
  assert.equal(html.includes('Featured'), false);
  assert.equal(html.includes('Change photo'), false);
  assert.equal(html.includes('Options'), false);
  // inventory.adjust controls remain
  assert.ok(html.includes('type="number"') || html.includes('inputMode') || html.includes('inputmode'));
});

test('QuickItemRow: catalog manager keeps image upload', () => {
  const html = renderRow(true, true);
  assert.equal(html.split('type="file"').length - 1, 2);
  assert.equal(html.includes('data-testid="item-thumbnail-preview"'), false);
});

test('isNumpadModeAllowed gates disc and price on canApplyDiscount', () => {
  assert.equal(isNumpadModeAllowed('qty', false), true);
  assert.equal(isNumpadModeAllowed('disc', false), false);
  assert.equal(isNumpadModeAllowed('price', false), false);
  assert.equal(isNumpadModeAllowed('disc', true), true);
  assert.equal(isNumpadModeAllowed('price', true), true);
});
