import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSharedOrderQuote } from '@/lib/order-pricing';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import type { Shop } from '@/types/qlaok';

const lines = ['eligible', 'excluded'].map((item_id) => ({
  item_id, name_vi: item_id, quantity: 1, unit_price: 100000, extra_price: 0, selected_choices: [],
}));

test('selected-item promotion only discounts eligible lines', () => {
  const quote = computeSharedOrderQuote({ lines, applyShopPromotions: true,
    themeConfig: { primaryColor: '#000000', layout: 'list', promoBanner: {
      enabled: true, title: 'selected items', applyScope: 'selected_items', selectedItemIds: ['eligible'],
      discountType: 'percent', discountValue: 20,
    } },
  });
  assert.equal(quote.discount_amount, 20000);
  assert.equal(quote.total_amount, 180000);
});

test('missing or unknown bank selection cannot silently generate an MB payment QR', () => {
  for (const bankId of ['', 'not-a-bank']) {
    const shop = { name: 'Fixture', theme_config: { paymentConfig: { bankId, accountNumber: '123456789' } } } as Shop;
    const qr = getShopPaymentQrInfo(shop, 100000, 'TEST');
    assert.equal(qr.isConfigured, false);
    assert.equal(qr.qrImageUrl, '');
  }
});


test('selected-item promotion with no selected items does not discount the whole menu', () => {
  const quote = computeSharedOrderQuote({ lines, applyShopPromotions: true,
    themeConfig: { primaryColor: '#000', layout: 'list', promoBanner: {
      enabled: true, title: 'No items', applyScope: 'selected_items', discountType: 'percent', discountValue: 20,
    } },
  });
  assert.equal(quote.discount_amount, 0);
});
