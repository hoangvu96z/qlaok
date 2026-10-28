import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  DEFAULT_SHOP_LABEL_PRINT_CONFIG,
  LABEL_PAPER_PRESET_SPECS,
  type LabelPaperPreset,
} from '@/lib/label-print-config';
import {
  buildProductionLabelBatch,
  type ProductionLabel,
} from '@/lib/production-label-print';
import {
  formatDeterministicTimestamp,
  prepareOrderProductionLabelPrint,
  renderProductionLabelDocument,
  renderProductionLabelHtml,
  renderProductionLabelTemplate,
  type ProductionLabelQrPayload,
} from '@/lib/production-label-template';
import type {
  OrderLineItem,
  Shop,
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
        ko: '구운 우롱 밀크티',
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
          label_i18n: { vi: '50% Đá', en: '50% Ice', ko: '얼음 50%' },
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
    show_shop_name: true,
    show_order_code: true,
    show_table_label: true,
    show_item_name: true,
    show_item_options: true,
    show_item_note: true,
    show_order_note: true,
    show_sequence_counter: true,
    show_timestamp: true,
    show_price: true,
    show_payment_qr: true,
    custom_footer_i18n: {
      vi: 'Chúc quý khách ngon miệng!',
      en: 'Enjoy your beverage!',
    },
    ...overrides,
  };
}

function getBatchLabels(
  configOverrides?: Partial<ShopLabelPrintConfig>,
  orderOverrides?: Partial<ShopOrder>
): ProductionLabel[] {
  const order = createMockOrder(orderOverrides);
  const config = createMockConfig(configOverrides);
  const batchResult = buildProductionLabelBatch(order, config);
  assert.equal(batchResult.ok, true);
  return batchResult.labels;
}

const mockQrPayload: ProductionLabelQrPayload = {
  qrImageUrl: 'https://img.vietqr.io/image/970422-12345678-compact2.png',
  bankShortName: 'MBBank',
  accountNumber: '123456789',
  accountName: 'NGUYEN VAN A',
  transferContent: 'QL-8899',
  amount: 105000,
};

// ---------------------------------------------------------------------------
// 1. PAPER PRESET TESTS
// ---------------------------------------------------------------------------
test('1. renders all four paper presets from LABEL_PAPER_PRESET_SPECS with trusted sizing and @page CSS', () => {
  const presets: LabelPaperPreset[] = [
    'cup_sticker_50x30',
    'cup_sticker_40x30',
    'production_slip_58mm',
    'production_slip_80mm',
  ];

  for (const preset of presets) {
    const spec = LABEL_PAPER_PRESET_SPECS[preset];
    const labels = getBatchLabels({ paper_preset: preset });
    const result = renderProductionLabelDocument({
      labels,
      paperPreset: preset,
      shopName: 'Tiệm Trà Qlaok',
    });

    assert.equal(result.ok, true);
    assert.equal(result.success, true);
    assert.equal(result.paperPreset, preset);
    assert.equal(result.labelCount, labels.length);

    // Verify @page CSS rule matches trusted enum spec
    const expectedPageSize =
      spec.height_mm !== null
        ? `${spec.width_mm}mm ${spec.height_mm}mm`
        : `${spec.width_mm}mm auto`;
    assert.ok(
      result.html.includes(`size: ${expectedPageSize};`),
      `Expected @page size for preset ${preset} to contain "${expectedPageSize}"`
    );

    // Verify label element styling width matches trusted spec
    assert.ok(
      result.html.includes(`width:${spec.width_mm}mm;`),
      `Expected label container width to be "${spec.width_mm}mm"`
    );

    // Verify sticker fixed height vs slip continuous height
    if (spec.height_mm !== null) {
      assert.ok(
        result.html.includes(`height:${spec.height_mm}mm;`),
        `Expected sticker height to be "${spec.height_mm}mm"`
      );
      assert.ok(
        result.html.includes('overflow:hidden;'),
        'Expected sticker container to enforce overflow:hidden'
      );
    } else {
      assert.ok(
        result.html.includes('min-height:auto;'),
        'Expected slip continuous container to have min-height:auto'
      );
    }

    // Verify preset class attribute on every label page
    assert.ok(
      result.html.includes(`label-preset-${preset}`),
      `Expected class label-preset-${preset}`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. DISPLAY TOGGLES TESTS
// ---------------------------------------------------------------------------
test('2. honors every display toggle on stored label configuration', () => {
  const shopName = 'Quán Cà Phê Trúc';

  // --- shop name toggle ---
  {
    const labelsOn = getBatchLabels({ show_shop_name: true });
    const resOn = renderProductionLabelDocument(labelsOn, { shopName });
    assert.ok(resOn.html.includes(shopName));

    const labelsOff = getBatchLabels({ show_shop_name: false });
    const resOff = renderProductionLabelDocument(labelsOff, { shopName });
    assert.ok(!resOff.html.includes(shopName));
  }

  // --- order code toggle ---
  {
    const labelsOn = getBatchLabels({ show_order_code: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('#QL-8899'));

    const labelsOff = getBatchLabels({ show_order_code: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('#QL-8899'));
  }

  // --- table label toggle ---
  {
    const labelsOn = getBatchLabels({ show_table_label: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('Bàn 01'));

    const labelsOff = getBatchLabels({ show_table_label: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('Bàn 01'));
  }

  // --- item name toggle ---
  {
    const labelsOn = getBatchLabels({ show_item_name: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('Trà Sữa Ô Long Nướng'));

    const labelsOff = getBatchLabels({ show_item_name: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('Trà Sữa Ô Long Nướng'));
  }

  // --- item options and tags toggle ---
  {
    const labelsOn = getBatchLabels({ show_item_options: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('50% Đá'));
    assert.ok(resOn.html.includes('Pudding trứng'));
    assert.ok(resOn.html.includes('[takeaway, cold]'));

    const labelsOff = getBatchLabels({ show_item_options: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('50% Đá'));
    assert.ok(!resOff.html.includes('Pudding trứng'));
    assert.ok(!resOff.html.includes('[takeaway, cold]'));
  }

  // --- line item note toggle ---
  {
    const labelsOn = getBatchLabels({ show_item_note: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('Ít ngọt hơn bình thường'));

    const labelsOff = getBatchLabels({ show_item_note: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('Ít ngọt hơn bình thường'));
  }

  // --- customer order note toggle ---
  {
    const labelsOn = getBatchLabels({ show_order_note: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('Giao nhanh giúp quán'));

    const labelsOff = getBatchLabels({ show_order_note: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('Giao nhanh giúp quán'));
  }

  // --- sequence counter toggle ---
  {
    const labelsOn = getBatchLabels({ show_sequence_counter: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('[1/3]'));
    assert.ok(resOn.html.includes('[2/3]'));
    assert.ok(resOn.html.includes('[3/3]'));

    const labelsOff = getBatchLabels({ show_sequence_counter: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('[1/3]'));
    assert.ok(!resOff.html.includes('[2/3]'));
  }

  // --- timestamp toggle ---
  {
    const labelsOn = getBatchLabels({ show_timestamp: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('class="label-timestamp"'));

    const labelsOff = getBatchLabels({ show_timestamp: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('class="label-timestamp"'));
  }

  // --- price toggle ---
  {
    const labelsOn = getBatchLabels({ show_price: true });
    const resOn = renderProductionLabelDocument(labelsOn);
    assert.ok(resOn.html.includes('class="label-item-price"'));
    assert.ok(resOn.html.includes('45.000đ')); // 35k base + 10k pudding

    const labelsOff = getBatchLabels({ show_price: false });
    const resOff = renderProductionLabelDocument(labelsOff);
    assert.ok(!resOff.html.includes('class="label-item-price"'));
    assert.ok(!resOff.html.includes('45.000đ'));
  }

  // --- custom footer toggle ---
  {
    const labelsOn = getBatchLabels({
      custom_footer_i18n: { vi: 'Hẹn gặp lại quý khách!', en: 'See you again!' },
    });
    const resOn = renderProductionLabelDocument(labelsOn, { locale: 'vi' });
    assert.ok(resOn.html.includes('Hẹn gặp lại quý khách!'));

    const labelsEmpty = getBatchLabels({
      custom_footer_i18n: { vi: '', en: '' },
    });
    const resEmpty = renderProductionLabelDocument(labelsEmpty);
    assert.ok(!resEmpty.html.includes('class="label-custom-footer"'));
  }
});

// ---------------------------------------------------------------------------
// 3. LOCALIZATION (VI/EN PLUS NON-VI/EN FALLBACK)
// ---------------------------------------------------------------------------
test('3. localizes labels through supported storefront locale with VI/EN fallback', () => {
  const labels = getBatchLabels();

  // Vietnamese locale
  {
    const resVi = renderProductionLabelDocument(labels, {
      locale: 'vi',
    });
    assert.ok(resVi.html.includes('Trà Sữa Ô Long Nướng'));
    assert.ok(resVi.html.includes('50% Đá'));
    assert.ok(resVi.html.includes('Ghi chú:'));
    assert.ok(resVi.html.includes('Ghi chú đơn:'));
    assert.ok(resVi.html.includes('Chúc quý khách ngon miệng!'));
  }

  // English locale
  {
    const resEn = renderProductionLabelDocument(labels, {
      locale: 'en',
    });
    assert.ok(resEn.html.includes('Roasted Oolong Milk Tea'));
    assert.ok(resEn.html.includes('50% Ice'));
    assert.ok(resEn.html.includes('Egg Pudding'));
    assert.ok(resEn.html.includes('Note:'));
    assert.ok(resEn.html.includes('Order note:'));
    assert.ok(resEn.html.includes('Enjoy your beverage!'));
  }

  // Non-VI/EN locale with translation present (Korean)
  {
    const resKo = renderProductionLabelDocument(labels, {
      locale: 'ko',
    });
    // Milktea has ko translation: 구운 우롱 밀크티
    assert.ok(resKo.html.includes('구운 우롱 밀크티'));
    assert.ok(resKo.html.includes('얼음 50%'));
    // Pudding has no ko translation -> falls back cleanly to VI or EN
    assert.ok(
      resKo.html.includes('Pudding trứng') || resKo.html.includes('Egg Pudding')
    );
  }

  // Non-VI/EN locale with NO translation present (French 'fr' or Japanese 'ja')
  {
    const resJa = renderProductionLabelDocument(labels, {
      locale: 'ja',
    });
    // Neither milktea nor choices have ja translation -> falls back to VI or EN cleanly
    assert.ok(
      resJa.html.includes('Trà Sữa Ô Long Nướng') ||
        resJa.html.includes('Roasted Oolong Milk Tea')
    );
    assert.ok(
      resJa.html.includes('50% Đá') || resJa.html.includes('50% Ice')
    );
    // Prefixes fall back cleanly
    assert.ok(
      resJa.html.includes('Ghi chú:') || resJa.html.includes('Note:')
    );
  }

  // Bilingual footer option
  {
    const resBilingual = renderProductionLabelDocument(labels, {
      bilingualFooter: true,
    });
    assert.ok(resBilingual.html.includes('Chúc quý khách ngon miệng!'));
    assert.ok(resBilingual.html.includes('Enjoy your beverage!'));
  }
});

// ---------------------------------------------------------------------------
// 4. PER-LABEL PAGE BOUNDARIES & REPRINT INDICATION
// ---------------------------------------------------------------------------
test('4. renders all batch labels in order on distinct page boundaries with sequence and reprint indication', () => {
  const labels = getBatchLabels({ split_mode: 'per_item_unit' });
  assert.equal(labels.length, 3); // 2 milktea + 1 coffee

  // Normal first print (not reprint)
  const resFirstPrint = renderProductionLabelDocument({
    labels,
    isReprint: false,
  });
  assert.equal(resFirstPrint.ok, true);

  // Match all label page divs
  const pageMatches = resFirstPrint.html.match(/class="production-label-page[^"]*"/g);
  assert.ok(pageMatches);
  assert.equal(pageMatches.length, 3);

  // Verify page break styles
  assert.ok(
    resFirstPrint.html.includes('page-break-after:always;break-after:page;'),
    'Expected non-final labels to have page-break-after:always'
  );
  assert.ok(
    resFirstPrint.html.includes('page-break-after:auto;break-after:auto;'),
    'Expected final label to have page-break-after:auto'
  );

  // Verify sequence counters are in exact order
  const seq1Pos = resFirstPrint.html.indexOf('[1/3]');
  const seq2Pos = resFirstPrint.html.indexOf('[2/3]');
  const seq3Pos = resFirstPrint.html.indexOf('[3/3]');
  assert.ok(seq1Pos !== -1 && seq2Pos !== -1 && seq3Pos !== -1);
  assert.ok(seq1Pos < seq2Pos);
  assert.ok(seq2Pos < seq3Pos);

  // Verify no reprint badge is rendered when isReprint is false
  assert.ok(!resFirstPrint.html.includes('data-reprint="true"'));

  // Reprint print (isReprint = true with count)
  const resReprint = renderProductionLabelDocument({
    labels,
    isReprint: true,
    reprintCount: 2,
    locale: 'vi',
  });
  assert.equal(resReprint.ok, true);
  assert.ok(resReprint.html.includes('data-reprint="true"'));
  assert.ok(resReprint.html.includes('BẢN IN LẠI (#2)'));

  // English reprint
  const resReprintEn = renderProductionLabelDocument({
    labels,
    isReprint: true,
    reprintCount: 3,
    locale: 'en',
  });
  assert.ok(resReprintEn.html.includes('REPRINT (#3)'));
});

// ---------------------------------------------------------------------------
// 5. PRICES AND CURRENCY FORMATTING
// ---------------------------------------------------------------------------
test('5. formats monetary values with shop currency and handles line totals correctly', () => {
  // VND currency formatting
  {
    const labels = getBatchLabels({ split_mode: 'per_line_item' });
    const resVnd = renderProductionLabelDocument(labels, { currency: 'VND' });
    assert.equal(resVnd.ok, true);
    // Line 1: quantity=2, unit_price=35000, extra=10000 -> lineTotal = 90.000đ
    assert.ok(resVnd.html.includes('90.000đ'));
    // Line 2: quantity=1, unit_price=25000 -> lineTotal = 25.000đ
    assert.ok(resVnd.html.includes('25.000đ'));
  }

  // Foreign currency formatting (USD)
  {
    const labels = getBatchLabels({ split_mode: 'per_line_item' });
    const resUsd = renderProductionLabelDocument(labels, { currency: 'USD' });
    assert.equal(resUsd.ok, true);
    assert.ok(resUsd.html.includes('USD'));
  }

  // Extra price in options
  {
    const labels = getBatchLabels({
      split_mode: 'per_item_unit',
      show_price: true,
    });
    const res = renderProductionLabelDocument(labels, { currency: 'VND' });
    // Pudding has extra_price 10.000đ
    assert.ok(res.html.includes('10.000đ'));
  }
});

// ---------------------------------------------------------------------------
// 6. QR FLAG AND AVAILABILITY BEHAVIOR
// ---------------------------------------------------------------------------
test('6. respects QR configuration and payload availability without deriving payment state', () => {
  const labelsQrEnabled = getBatchLabels({ show_payment_qr: true });
  const labelsQrDisabled = getBatchLabels({ show_payment_qr: false });

  // 1. Config enabled + valid QR payload -> QR renders
  {
    const res = renderProductionLabelDocument(labelsQrEnabled, {
      paymentQr: mockQrPayload,
    });
    assert.equal(res.ok, true);
    assert.ok(res.html.includes('class="label-payment-qr"'));
    assert.ok(res.html.includes(mockQrPayload.qrImageUrl!));
    assert.ok(res.html.includes('MBBank'));
    assert.ok(res.html.includes('123456789'));
    assert.ok(res.html.includes('NGUYEN VAN A'));
    assert.ok(res.html.includes('QL-8899'));
  }

  // 2. Config enabled BUT missing QR payload -> QR does NOT render
  {
    const resNullQr = renderProductionLabelDocument(labelsQrEnabled, {
      paymentQr: null,
    });
    assert.ok(!resNullQr.html.includes('class="label-payment-qr"'));
    assert.ok(!resNullQr.html.includes('MBBank'));

    const resEmptyQr = renderProductionLabelDocument(labelsQrEnabled, {
      paymentQr: { qrImageUrl: '' },
    });
    assert.ok(!resEmptyQr.html.includes('class="label-payment-qr"'));
  }

  // 3. Config disabled EVEN WITH valid QR payload -> QR does NOT render
  {
    const resDisabled = renderProductionLabelDocument(labelsQrDisabled, {
      paymentQr: mockQrPayload,
    });
    assert.ok(!resDisabled.html.includes('class="label-payment-qr"'));
    assert.ok(!resDisabled.html.includes(mockQrPayload.qrImageUrl!));
    assert.ok(!resDisabled.html.includes('MBBank'));
  }

  // 4. Does not derive payment state from order: even if order is marked 'paid',
  // if caller supplies QR and config enables it, QR displays according to pure caller input.
  {
    const paidLabels = getBatchLabels(
      { show_payment_qr: true },
      { payment_status: 'paid' }
    );
    const resPaid = renderProductionLabelDocument(paidLabels, {
      paymentQr: mockQrPayload,
    });
    assert.ok(resPaid.html.includes('class="label-payment-qr"'));
  }
});

// ---------------------------------------------------------------------------
// 7. ESCAPING OF MALICIOUS DYNAMIC STRINGS (XSS PREVENTION)
// ---------------------------------------------------------------------------
test('7. strictly escapes all dynamic user-controlled strings and attributes with escapeHtml', () => {
  const maliciousOrder = createMockOrder({
    order_code: 'EVIL"><script>alert("code")</script>',
    table_label: 'Table <img src=x onerror=alert("table")>',
    customer_note: 'Note </script><script>alert("ordernote")</script>',
    items: [
      {
        item_id: 'item_xss',
        name_vi: 'Trà XSS <script>alert("item")</script>',
        name_i18n: {
          vi: 'Trà XSS <script>alert("item")</script>',
          en: 'XSS Tea <b onmouseover=alert("item_en")>x</b>',
        },
        quantity: 1,
        unit_price: 50000,
        extra_price: 0,
        selected_choices: [
          {
            id: 'opt_xss',
            label_vi: 'Topping <svg onload=alert("choice")>',
            label_i18n: {
              vi: 'Topping <svg onload=alert("choice")>',
              en: 'Evil Topping <iframe src="javascript:alert(1)">',
            },
            extra_price: 0,
          },
        ],
        custom_note: 'Note "><script>alert("itemnote")</script>',
        quick_tags: ['tag<script>alert("tag")</script>'],
      },
    ],
  });

  const validConfig = createMockConfig();
  const batch = buildProductionLabelBatch(maliciousOrder, validConfig);
  assert.equal(batch.ok, true);

  // Directly set malicious footer on label config to test defense-in-depth escaping
  batch.labels[0]!.config.custom_footer_i18n = {
    vi: 'Footer <script>alert("footer_vi")</script>',
    en: 'Footer <script>alert("footer_en")</script>',
  };

  const maliciousShopName = 'Shop <script>alert("shop")</script>';
  const maliciousQrPayload: ProductionLabelQrPayload = {
    qrImageUrl: 'https://evil.com/qr.png"><script>alert("qr_src")</script>',
    bankShortName: 'Bank <script>alert("bank")</script>',
    accountNumber: '123"><script>alert("acct")</script>',
    accountName: 'Name <script>alert("name")</script>',
    transferContent: 'Content <script>alert("memo")</script>',
  };

  const result = renderProductionLabelDocument(batch.labels, {
    shopName: maliciousShopName,
    paymentQr: maliciousQrPayload,
    locale: 'en',
  });

  assert.equal(result.ok, true);
  const html = result.html;

  // Raw unescaped HTML elements and attributes must NEVER exist in output
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<iframe'));
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('<b onmouseover'));

  // Escaped counterparts must be present
  assert.ok(html.includes('&lt;script&gt;alert(&quot;code&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(&quot;table&quot;)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;shop&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;footer_en&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;bank&quot;)&lt;/script&gt;'));
});

// ---------------------------------------------------------------------------
// 8. DETERMINISM, CALLER SIGNATURES, AND ERROR HANDLING
// ---------------------------------------------------------------------------
test('8. handles edge cases, empty batches, invalid presets, and dual function signatures deterministically', () => {
  // Empty labels array returns typed failure
  const emptyRes = renderProductionLabelDocument([]);
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.code, 'EMPTY_LABELS');
  assert.equal(emptyRes.html, '');
  assert.equal(emptyRes.labelCount, 0);

  // Missing input
  const nullRes = renderProductionLabelDocument(null);
  assert.equal(nullRes.ok, false);
  assert.equal(nullRes.code, 'EMPTY_LABELS');

  // renderProductionLabelHtml returns empty string on failure
  const emptyHtml = renderProductionLabelHtml([]);
  assert.equal(emptyHtml, '');

  // Invalid paper preset returns typed failure
  const labels = getBatchLabels();
  const invalidPresetRes = renderProductionLabelDocument(labels, {
    paperPreset: 'giant_poster_a0' as never,
  });
  assert.equal(invalidPresetRes.ok, false);
  assert.equal(invalidPresetRes.code, 'INVALID_PRESET');
  assert.equal(invalidPresetRes.html, '');

  // Positional (labels, options) vs object ({ labels, ...options }) parity
  const resPos = renderProductionLabelDocument(labels, { shopName: 'Positional Shop' });
  const resObj = renderProductionLabelDocument({ labels, shopName: 'Positional Shop' });
  assert.equal(resPos.ok, true);
  assert.equal(resObj.ok, true);
  assert.equal(resPos.html, resObj.html);

  // renderProductionLabelTemplate alias parity
  const resAlias = renderProductionLabelTemplate(labels, { shopName: 'Positional Shop' });
  assert.equal(resAlias.html, resPos.html);

  // Deterministic timestamp helper tests
  const ts1 = formatDeterministicTimestamp('2026-10-24T02:00:00.000Z', 'vi', 'Asia/Ho_Chi_Minh');
  const ts2 = formatDeterministicTimestamp('2026-10-24T02:00:00.000Z', 'vi', 'Asia/Ho_Chi_Minh');
  assert.equal(ts1, ts2);
  assert.ok(ts1.includes('2026'));
  assert.equal(formatDeterministicTimestamp(null), '');
  assert.equal(formatDeterministicTimestamp('invalid-date'), 'invalid-date');
});

function createMockShop(
  labelPrintConfig?: Partial<ShopLabelPrintConfig>,
  withBankQr = true
): Shop {
  return {
    id: 'shop_test_456',
    owner_id: 'owner_1',
    slug: 'tiem-tra-qlaok',
    name: 'Tiệm Trà Qlaok',
    vertical: 'fnb',
    tagline_i18n: { vi: '', en: '' },
    description_i18n: { vi: '', en: '' },
    logo_url: null,
    cover_urls: [],
    address: '123 Nguyễn Huệ',
    city: 'TP.HCM',
    google_maps_url: null,
    google_review_url: null,
    phone_contact: '0901234567',
    zalo_phone: null,
    wifi_info: { ssid: 'QlaokWifi', password: '123' },
    opening_hours: {
      mon: { open: '08:00', close: '22:00', closed: false },
      tue: { open: '08:00', close: '22:00', closed: false },
      wed: { open: '08:00', close: '22:00', closed: false },
      thu: { open: '08:00', close: '22:00', closed: false },
      fri: { open: '08:00', close: '22:00', closed: false },
      sat: { open: '08:00', close: '22:00', closed: false },
      sun: { open: '08:00', close: '22:00', closed: false },
    },
    supported_langs: ['vi', 'en'],
    currency: 'VND',
    theme_config: {
      primaryColor: '#10b981',
      layout: 'grid',
      ...(withBankQr
        ? {
            paymentConfig: {
              mode: 'vietqr_auto',
              bankId: 'MB',
              accountNumber: '123456789',
              accountName: 'NGUYEN VAN A',
              transferPrefix: 'QLAOK',
            },
          }
        : {}),
      ...(labelPrintConfig
        ? {
            labelPrintConfig: {
              ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
              ...labelPrintConfig,
            },
          }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 9. PREFLIGHT INTEGRATION: VALID RENDERING & FIRST-LABEL PREVIEW
// ---------------------------------------------------------------------------
test('9. prepareOrderProductionLabelPrint integrates config resolution, batch building, first-label preview, and reprint metadata', () => {
  const order = createMockOrder();
  const shop = createMockShop({
    enabled: true,
    paper_preset: 'cup_sticker_50x30',
    split_mode: 'per_item_unit',
    copies_per_unit: 1,
    max_labels_per_print: 50,
    show_order_note: true,
    show_price: true,
    custom_footer_i18n: {
      vi: 'Cảm ơn quý khách!',
      en: 'Thank you!',
    },
  });

  // Vietnamese preflight
  const viRes = prepareOrderProductionLabelPrint({
    order,
    shop,
    locale: 'vi',
  });

  assert.equal(viRes.ok, true);
  assert.equal(viRes.canPrint, true);
  assert.equal(viRes.preset, 'cup_sticker_50x30');
  assert.equal(viRes.presetLabel, 'Tem dán ly 50×30mm');
  assert.equal(viRes.labelCount, 3);
  assert.equal(viRes.maxLabels, 50);
  assert.ok(viRes.html.includes('<!DOCTYPE html>'));
  assert.ok(viRes.firstLabelPreview);
  assert.equal(viRes.firstLabelPreview.shopName, 'Tiệm Trà Qlaok');
  assert.equal(viRes.firstLabelPreview.orderCode, '#QL-8899');
  assert.equal(viRes.firstLabelPreview.tableLabel, 'Bàn 01');
  assert.equal(viRes.firstLabelPreview.sequenceText, '[1/3]');
  assert.equal(
    viRes.firstLabelPreview.items[0]?.displayName,
    'Trà Sữa Ô Long Nướng'
  );
  assert.ok(viRes.firstLabelPreview.items[0]?.optionsText.includes('50% Đá'));
  assert.ok(
    viRes.firstLabelPreview.items[0]?.noteText.includes(
      'Ít ngọt hơn bình thường'
    )
  );
  assert.ok(
    viRes.firstLabelPreview.orderNoteText.includes('Giao nhanh giúp quán')
  );
  assert.equal(viRes.firstLabelPreview.footerText, 'Cảm ơn quý khách!');
  assert.equal(viRes.firstLabelPreview.isReprint, false);

  // English preflight + server-returned reprint count
  const enReprintRes = prepareOrderProductionLabelPrint({
    order,
    shop,
    locale: 'en',
    printCount: 3,
    isReprint: true,
  });

  assert.equal(enReprintRes.ok, true);
  assert.equal(enReprintRes.presetLabel, 'Cup Sticker 50×30mm');
  assert.equal(
    enReprintRes.firstLabelPreview?.items[0]?.displayName,
    'Roasted Oolong Milk Tea'
  );
  assert.ok(
    enReprintRes.firstLabelPreview?.items[0]?.optionsText.includes('50% Ice')
  );
  assert.equal(enReprintRes.firstLabelPreview?.footerText, 'Thank you!');
  assert.equal(enReprintRes.firstLabelPreview?.isReprint, true);
  assert.equal(enReprintRes.firstLabelPreview?.printCount, 3);
  assert.ok(enReprintRes.html.includes('REPRINT (#3)'));

  // Does not mutate input order payment or fulfillment state
  assert.equal(order.status, 'new');
  assert.equal(order.payment_status, 'unpaid');
});

// ---------------------------------------------------------------------------
// 10. PREFLIGHT REJECTIONS: DISABLED CONFIG, OVER-LIMIT, AND EMPTY ORDER
// ---------------------------------------------------------------------------
test('10. prepareOrderProductionLabelPrint rejects disabled config, over-limit batches, and empty orders with VI/EN explanations', () => {
  const order = createMockOrder(); // 3 units total

  // 1. Disabled config
  const disabledShop = createMockShop({ enabled: false });
  const disabledVi = prepareOrderProductionLabelPrint({
    order,
    shop: disabledShop,
    locale: 'vi',
  });
  const disabledEn = prepareOrderProductionLabelPrint({
    order,
    shop: disabledShop,
    locale: 'en',
  });

  assert.equal(disabledVi.ok, false);
  assert.equal(disabledVi.canPrint, false);
  assert.equal(disabledVi.errorCode, 'CONFIG_DISABLED');
  assert.equal(disabledVi.html, '');
  assert.match(disabledVi.errorMessage, /đang tắt/i);
  assert.match(disabledEn.errorMessage || '', /disabled/i);

  // 2. Over-limit rejection (3 units * 2 copies = 6 > max 4)
  const overLimitShop = createMockShop({
    enabled: true,
    split_mode: 'per_item_unit',
    copies_per_unit: 2,
    max_labels_per_print: 4,
  });
  const overVi = prepareOrderProductionLabelPrint({
    order,
    shop: overLimitShop,
    locale: 'vi',
  });
  const overEn = prepareOrderProductionLabelPrint({
    order,
    shop: overLimitShop,
    locale: 'en',
  });

  assert.equal(overVi.ok, false);
  assert.equal(overVi.canPrint, false);
  assert.equal(overVi.errorCode, 'EXCEEDS_MAX_LABELS');
  assert.equal(overVi.requestedCount, 6);
  assert.equal(overVi.maxLabels, 4);
  assert.equal(overVi.html, '');
  assert.ok(overVi.errorMessage.includes('6'));
  assert.ok(overVi.errorMessage.includes('4'));
  assert.match(overEn.errorMessage || '', /exceeds/i);

  // 3. Empty order rejection
  const emptyOrder = createMockOrder({ items: [] });
  const emptyRes = prepareOrderProductionLabelPrint({
    order: emptyOrder,
    shop: createMockShop(),
    locale: 'vi',
  });
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.canPrint, false);
  assert.equal(emptyRes.errorCode, 'EMPTY_ORDER');
  assert.equal(emptyRes.html, '');
});

// ---------------------------------------------------------------------------
// 11. PREFLIGHT PAYMENT QR OPT-IN GATING
// ---------------------------------------------------------------------------
test('11. prepareOrderProductionLabelPrint only provides payment QR when show_payment_qr is true, order is unpaid, and shop QR is configured', () => {
  const unpaidOrder = createMockOrder({ payment_status: 'unpaid' });
  const paidOrder = createMockOrder({ payment_status: 'paid' });
  const refundedOrder = createMockOrder({ payment_status: 'refunded' });

  // 1. Default config (show_payment_qr: false) -> no QR even on unpaid order with configured bank
  {
    const res = prepareOrderProductionLabelPrint({
      order: unpaidOrder,
      shop: createMockShop({ show_payment_qr: false }, true),
    });
    assert.equal(res.ok, true);
    assert.equal(res.paymentQr, null);
    assert.equal(res.firstLabelPreview?.hasPaymentQr, false);
    assert.ok(!res.html.includes('class="label-payment-qr"'));
  }

  // 2. Opt-in (show_payment_qr: true) + unpaid order + configured shop bank QR -> QR included
  {
    const res = prepareOrderProductionLabelPrint({
      order: unpaidOrder,
      shop: createMockShop({ show_payment_qr: true }, true),
    });
    assert.equal(res.ok, true);
    assert.ok(res.paymentQr);
    assert.equal(res.firstLabelPreview?.hasPaymentQr, true);
    assert.ok(res.html.includes('class="label-payment-qr"'));
    assert.ok(res.html.includes('123456789'));
  }

  // 3. Opt-in (show_payment_qr: true) + PAID or REFUNDED order -> no QR
  for (const settledOrder of [paidOrder, refundedOrder]) {
    const res = prepareOrderProductionLabelPrint({
      order: settledOrder,
      shop: createMockShop({ show_payment_qr: true }, true),
    });
    assert.equal(res.ok, true);
    assert.equal(res.paymentQr, null);
    assert.equal(res.firstLabelPreview?.hasPaymentQr, false);
    assert.ok(!res.html.includes('class="label-payment-qr"'));
  }

  // 4. Opt-in (show_payment_qr: true) + unpaid order + UNCONFIGURED shop bank -> no QR
  {
    const res = prepareOrderProductionLabelPrint({
      order: unpaidOrder,
      shop: createMockShop({ show_payment_qr: true }, false),
    });
    assert.equal(res.ok, true);
    assert.equal(res.paymentQr, null);
    assert.equal(res.firstLabelPreview?.hasPaymentQr, false);
    assert.ok(!res.html.includes('class="label-payment-qr"'));
  }
});

// ---------------------------------------------------------------------------
// 12. RECEIPT PRINT MODAL UI RENDERING IN LABEL MODE vs BILL MODES
// ---------------------------------------------------------------------------
test('12. ReceiptPrintModal renders 4th label tab, shows preset/count/max and first-label preview, hides K58/K80 & bill QR in label mode, and disables printing on preflight errors', () => {
  const ssrScript = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { AppI18nProvider } from "./src/components/ui/AppI18nProvider.tsx";
    import { ReceiptPrintModal } from "./src/components/dashboard/ReceiptPrintModal.tsx";
    import { DEFAULT_SHOP_LABEL_PRINT_CONFIG } from "./src/lib/label-print-config.ts";

    const order = {
      id: "ord_ssr_1",
      order_code: "QL-9001",
      shop_id: "shop_ssr_1",
      table_label: "Bàn 05",
      visitor_lang: "vi",
      customer_note: "Ít đá chung",
      status: "new",
      payment_method: "cash",
      payment_status: "unpaid",
      total_amount: 45000,
      subtotal_amount: 45000,
      source: "qr_table",
      created_at: "2026-10-24T02:00:00.000Z",
      updated_at: "2026-10-24T02:00:00.000Z",
      items: [
        {
          item_id: "i1",
          name_vi: "Trà Đào Cam Sả",
          name_i18n: { vi: "Trà Đào Cam Sả", en: "Peach Lemongrass Tea" },
          quantity: 3,
          unit_price: 45000,
          extra_price: 0,
          selected_choices: [
            { id: "c1", label_vi: "70% Đường", label_i18n: { vi: "70% Đường", en: "70% Sugar" }, extra_price: 0 }
          ],
          custom_note: "Thêm đào miếng",
          quick_tags: ["cold"]
        }
      ]
    };

    const makeShop = (labelCfg) => ({
      id: "shop_ssr_1",
      owner_id: "owner_1",
      slug: "tra-dao",
      name: "Quán Trà Đào",
      vertical: "fnb",
      tagline_i18n: { vi: "", en: "" },
      description_i18n: { vi: "", en: "" },
      logo_url: null,
      cover_urls: [],
      address: "10 Lê Lợi",
      city: "HCM",
      google_maps_url: null,
      google_review_url: null,
      phone_contact: "0909000111",
      zalo_phone: null,
      wifi_info: { ssid: "TraDaoWifi", password: "123" },
      opening_hours: {},
      supported_langs: ["vi", "en"],
      currency: "VND",
      theme_config: {
        primaryColor: "#10b981",
        layout: "grid",
        paymentConfig: {
          mode: "vietqr_auto",
          bankId: "MB",
          accountNumber: "99998888",
          accountName: "CHU QUAN",
          transferPrefix: "QLAOK"
        },
        labelPrintConfig: {
          ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
          ...labelCfg
        }
      }
    });

    const renderModal = (initialTicketType, labelCfg) =>
      renderToStaticMarkup(
        React.createElement(
          AppI18nProvider,
          null,
          React.createElement(ReceiptPrintModal, {
            order,
            shop: makeShop(labelCfg),
            initialTicketType,
            onClose: () => {},
          })
        )
      );

    const validLabelHtml = renderModal("label", {
      enabled: true,
      paper_preset: "cup_sticker_50x30",
      split_mode: "per_item_unit",
      copies_per_unit: 1,
      max_labels_per_print: 50,
    });

    const disabledLabelHtml = renderModal("label", {
      enabled: false,
    });

    const overLimitLabelHtml = renderModal("label", {
      enabled: true,
      split_mode: "per_item_unit",
      copies_per_unit: 2,
      max_labels_per_print: 4,
    });

    const provisionalHtml = renderModal("provisional", {
      enabled: true,
    });

    console.log(JSON.stringify({
      hasAllFourTabs:
        validLabelHtml.includes('data-testid="print-tab-kitchen"') &&
        validLabelHtml.includes('data-testid="print-tab-provisional"') &&
        validLabelHtml.includes('data-testid="print-tab-receipt"') &&
        validLabelHtml.includes('data-testid="print-tab-label"'),
      showsPresetAndCounts:
        validLabelHtml.includes("Tem dán ly 50×30mm") &&
        validLabelHtml.includes("3 / tối đa 50"),
      showsFirstLabelPreview:
        validLabelHtml.includes('data-testid="label-print-preview"') &&
        validLabelHtml.includes("Trà Đào Cam Sả") &&
        validLabelHtml.includes("70% Đường") &&
        validLabelHtml.includes("Thêm đào miếng") &&
        validLabelHtml.includes("[1/3]"),
      hidesK58K80AndBillQrInLabelMode:
        !validLabelHtml.includes("Khổ K80 (80mm)") &&
        !validLabelHtml.includes("Khổ K58 (58mm)") &&
        !validLabelHtml.includes("Kèm mã QR trên bill"),
      preservesK58K80AndBillQrInProvisionalMode:
        provisionalHtml.includes("Khổ K80 (80mm)") &&
        provisionalHtml.includes("Khổ K58 (58mm)") &&
        provisionalHtml.includes("Kèm mã QR trên bill"),
      disabledConfigShowsErrorAndDisablesSubmit:
        disabledLabelHtml.includes('data-testid="label-print-preflight-error"') &&
        disabledLabelHtml.includes('data-testid="print-submit-button" disabled=""'),
      overLimitShowsErrorAndDisablesSubmit:
        overLimitLabelHtml.includes('data-testid="label-print-preflight-error"') &&
        overLimitLabelHtml.includes("6 / tối đa 4") &&
        overLimitLabelHtml.includes('data-testid="print-submit-button" disabled=""'),
    }));
  `;

  const rawOut = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './tests/register-ts.mjs',
      '--import',
      './tests/tsx-review-loader.mjs',
      '--input-type=module',
      '-e',
      ssrScript,
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 }
  );

  const jsonLine = rawOut
    .trim()
    .split('\n')
    .find((line) => line.startsWith('{'));
  assert.ok(jsonLine, 'SSR script must output JSON result');
  const parsed = JSON.parse(jsonLine);

  assert.equal(parsed.hasAllFourTabs, true);
  assert.equal(parsed.showsPresetAndCounts, true);
  assert.equal(parsed.showsFirstLabelPreview, true);
  assert.equal(parsed.hidesK58K80AndBillQrInLabelMode, true);
  assert.equal(parsed.preservesK58K80AndBillQrInProvisionalMode, true);
  assert.equal(parsed.disabledConfigShowsErrorAndDisablesSubmit, true);
  assert.equal(parsed.overLimitShowsErrorAndDisablesSubmit, true);
});
