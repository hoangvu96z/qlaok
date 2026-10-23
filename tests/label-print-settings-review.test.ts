import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { PATCH as patchShops } from '@/app/api/shops/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import {
  DEFAULT_SHOP_LABEL_PRINT_CONFIG,
  LABEL_PAPER_PRESET_SPECS,
  MAX_LABEL_COPIES_PER_UNIT,
  MAX_LABEL_FOOTER_LENGTH,
  MAX_MAX_LABELS_PER_PRINT,
  MIN_LABEL_COPIES_PER_UNIT,
  MIN_MAX_LABELS_PER_PRINT,
  VALID_LABEL_PAPER_PRESETS,
  VALID_LABEL_SPLIT_MODES,
  buildLabelPrintPatchPayload,
  cloneLabelPrintConfig,
  formatLabelValidationError,
  getDefaultShopLabelPrintConfig,
  resolveShopLabelPrintConfig,
  validateLabelPrintConfig,
  type LabelPaperPreset,
  type LabelSplitMode,
} from '@/lib/label-print-config';
import { issueSessionToken } from '@/lib/server-auth';
import { setShopMembershipDbClientForTest } from '@/lib/shop-permissions';
import type { Shop, ShopLabelPrintConfig, ShopThemeConfig } from '@/types/qlaok';

test('1. Default hydration and config resolution handle empty, partial, and custom settings', () => {
  // Empty, null, or undefined resolves to default config
  const def1 = resolveShopLabelPrintConfig(null);
  const def2 = resolveShopLabelPrintConfig(undefined);
  const def3 = resolveShopLabelPrintConfig({} as unknown as ShopThemeConfig);
  const def4 = resolveShopLabelPrintConfig({ primaryColor: '#10b981' } as unknown as ShopThemeConfig);

  assert.equal(def1.enabled, true);
  assert.equal(def1.paper_preset, 'cup_sticker_50x30');
  assert.equal(def1.split_mode, 'per_item_unit');
  assert.equal(def1.copies_per_unit, 1);
  assert.equal(def1.max_labels_per_print, 50);
  assert.equal(def1.show_shop_name, true);
  assert.equal(def1.show_order_code, true);
  assert.equal(def1.show_table_label, true);
  assert.equal(def1.show_item_name, true);
  assert.equal(def1.show_item_options, true);
  assert.equal(def1.show_item_note, true);
  assert.equal(def1.show_order_note, false);
  assert.equal(def1.show_sequence_counter, true);
  assert.equal(def1.show_timestamp, true);
  assert.equal(def1.show_price, false);
  assert.equal(def1.show_payment_qr, false);
  assert.deepEqual(def1.custom_footer_i18n, { vi: '', en: '' });

  assert.deepEqual(def1, def2);
  assert.deepEqual(def1, def3);
  assert.deepEqual(def1, def4);

  // Custom valid config embedded in theme_config
  const customConfig: ShopLabelPrintConfig = {
    enabled: false,
    paper_preset: 'production_slip_58mm',
    split_mode: 'per_line_item',
    copies_per_unit: 2,
    max_labels_per_print: 30,
    show_shop_name: false,
    show_order_code: true,
    show_table_label: true,
    show_item_name: true,
    show_item_options: false,
    show_item_note: false,
    show_order_note: true,
    show_sequence_counter: false,
    show_timestamp: true,
    show_price: true,
    show_payment_qr: true,
    custom_footer_i18n: {
      vi: 'Cảm ơn quý khách!',
      en: 'Thank you!',
    },
  };

  const resolvedCustom = resolveShopLabelPrintConfig({
    primaryColor: '#ef4444',
    labelPrintConfig: customConfig,
  } as ShopThemeConfig);

  assert.equal(resolvedCustom.enabled, false);
  assert.equal(resolvedCustom.paper_preset, 'production_slip_58mm');
  assert.equal(resolvedCustom.split_mode, 'per_line_item');
  assert.equal(resolvedCustom.copies_per_unit, 2);
  assert.equal(resolvedCustom.max_labels_per_print, 30);
  assert.equal(resolvedCustom.show_price, true);
  assert.equal(resolvedCustom.show_payment_qr, true);
  assert.equal(resolvedCustom.custom_footer_i18n?.vi, 'Cảm ơn quý khách!');
  assert.equal(resolvedCustom.custom_footer_i18n?.en, 'Thank you!');

  // Invalid embedded config falls back safely to default without throwing
  const resolvedInvalid = resolveShopLabelPrintConfig({
    labelPrintConfig: {
      paper_preset: 'corrupted_size' as never,
    },
  } as unknown as ShopThemeConfig);
  assert.equal(resolvedInvalid.paper_preset, 'cup_sticker_50x30');

  // cloneLabelPrintConfig produces a deep isolated copy
  const cloned = cloneLabelPrintConfig(customConfig);
  assert.deepEqual(cloned, customConfig);
  assert.notEqual(cloned, customConfig);
  assert.notEqual(cloned.custom_footer_i18n, customConfig.custom_footer_i18n);

  cloned.custom_footer_i18n!.vi = 'Mutated';
  assert.equal(customConfig.custom_footer_i18n?.vi, 'Cảm ơn quý khách!');
});

test('2. Edits to paper preset, split mode, display flags, and custom footer validate cleanly', () => {
  // Verify all 4 paper presets are valid and have specs
  assert.equal(VALID_LABEL_PAPER_PRESETS.length, 4);
  for (const preset of VALID_LABEL_PAPER_PRESETS) {
    const spec = LABEL_PAPER_PRESET_SPECS[preset];
    assert.ok(spec, `Preset spec for ${preset} must exist`);
    assert.equal(spec.id, preset);
    assert.ok(spec.width_mm > 0);
    assert.ok(spec.label_i18n.vi?.length);
    assert.ok(spec.label_i18n.en?.length);
  }

  // 50x30 and 40x30 are stickers with fixed height; 58mm and 80mm are slips with null height
  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_50x30.is_sticker, true);
  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_50x30.height_mm, 30);
  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_40x30.is_sticker, true);
  assert.equal(LABEL_PAPER_PRESET_SPECS.cup_sticker_40x30.height_mm, 30);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_58mm.is_sticker, false);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_58mm.height_mm, null);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_80mm.is_sticker, false);
  assert.equal(LABEL_PAPER_PRESET_SPECS.production_slip_80mm.height_mm, null);

  // Verify all 3 split modes
  assert.equal(VALID_LABEL_SPLIT_MODES.length, 3);
  assert.ok(VALID_LABEL_SPLIT_MODES.includes('per_item_unit'));
  assert.ok(VALID_LABEL_SPLIT_MODES.includes('per_line_item'));
  assert.ok(VALID_LABEL_SPLIT_MODES.includes('single_ticket'));

  // Edit fields and validate
  const draft = getDefaultShopLabelPrintConfig();
  draft.paper_preset = 'production_slip_80mm';
  draft.split_mode = 'single_ticket';
  draft.copies_per_unit = 3;
  draft.max_labels_per_print = 80;
  draft.show_shop_name = true;
  draft.show_order_code = true;
  draft.show_table_label = true;
  draft.show_item_name = true;
  draft.show_item_options = true;
  draft.show_item_note = true;
  draft.show_order_note = true;
  draft.show_sequence_counter = false;
  draft.show_timestamp = true;
  draft.show_price = true;
  draft.show_payment_qr = true;
  draft.custom_footer_i18n = {
    vi: 'Quý khách vui lòng kiểm tra món trước khi rời quầy',
    en: 'Please check your items before leaving the counter',
  };

  const validation = validateLabelPrintConfig(draft);
  assert.equal(validation.valid, true);
  if (validation.valid) {
    assert.equal(validation.config.paper_preset, 'production_slip_80mm');
    assert.equal(validation.config.split_mode, 'single_ticket');
    assert.equal(validation.config.copies_per_unit, 3);
    assert.equal(validation.config.max_labels_per_print, 80);
    assert.equal(validation.config.show_price, true);
    assert.equal(validation.config.show_payment_qr, true);
    assert.equal(
      validation.config.custom_footer_i18n?.vi,
      'Quý khách vui lòng kiểm tra món trước khi rời quầy'
    );
  }
});

test('3. Validation enforces strict limits, rejects forbidden fields, and formats localized error messages', () => {
  // Non-object
  const nonObjRes = validateLabelPrintConfig('invalid_string');
  assert.equal(nonObjRes.valid, false);
  assert.equal(nonObjRes.errors[0]?.code, 'INVALID_CONFIG_OBJECT');
  assert.match(
    formatLabelValidationError(nonObjRes.errors[0]!, 'vi'),
    /đối tượng hợp lệ/
  );
  assert.match(
    formatLabelValidationError(nonObjRes.errors[0]!, 'en'),
    /valid object/
  );

  // Forbidden fields (security boundary: payment_status, mark_paid, etc.)
  for (const forbiddenKey of [
    'payment_status',
    'payment_method',
    'mark_paid',
    'auto_pay',
    'collect_payment',
    'status',
  ]) {
    const forbiddenRes = validateLabelPrintConfig({
      ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
      [forbiddenKey]: 'injected',
    });
    assert.equal(forbiddenRes.valid, false);
    assert.equal(forbiddenRes.errors[0]?.code, 'FORBIDDEN_LABEL_CONFIG_FIELD');
    assert.match(
      formatLabelValidationError(forbiddenRes.errors[0]!, 'vi'),
      new RegExp(forbiddenKey)
    );
  }

  // Invalid paper preset
  const badPresetRes = validateLabelPrintConfig({
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    paper_preset: 'a4_paper' as never,
  });
  assert.equal(badPresetRes.valid, false);
  assert.equal(badPresetRes.errors[0]?.code, 'INVALID_PAPER_PRESET');
  assert.match(
    formatLabelValidationError(badPresetRes.errors[0]!, 'vi'),
    /Khổ giấy/
  );

  // Invalid split mode
  const badSplitRes = validateLabelPrintConfig({
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    split_mode: 'batch_all' as never,
  });
  assert.equal(badSplitRes.valid, false);
  assert.equal(badSplitRes.errors[0]?.code, 'INVALID_SPLIT_MODE');

  // Copies per unit out of bounds (< 1, > 5, or float)
  for (const badCopies of [0, -1, 6, 10, 2.5, '2' as never]) {
    const res = validateLabelPrintConfig({
      ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
      copies_per_unit: badCopies as number,
    });
    assert.equal(res.valid, false);
    assert.equal(res.errors[0]?.code, 'INVALID_COPIES_PER_UNIT');
    assert.match(
      formatLabelValidationError(res.errors[0]!, 'vi'),
      new RegExp(`${MIN_LABEL_COPIES_PER_UNIT}.*${MAX_LABEL_COPIES_PER_UNIT}`)
    );
  }

  // Max labels per print out of bounds (< 1, > 100, or float)
  for (const badMax of [0, -5, 101, 500, 20.5]) {
    const res = validateLabelPrintConfig({
      ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
      max_labels_per_print: badMax,
    });
    assert.equal(res.valid, false);
    assert.equal(res.errors[0]?.code, 'INVALID_MAX_LABELS_PER_PRINT');
    assert.match(
      formatLabelValidationError(res.errors[0]!, 'vi'),
      new RegExp(`${MIN_MAX_LABELS_PER_PRINT}.*${MAX_MAX_LABELS_PER_PRINT}`)
    );
  }

  // Boolean flags non-boolean
  const badFlagRes = validateLabelPrintConfig({
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    show_price: 'true' as never,
  });
  assert.equal(badFlagRes.valid, false);
  assert.equal(badFlagRes.errors[0]?.code, 'INVALID_BOOLEAN_FLAG');

  // Custom footer length > 120
  const longFooter = 'A'.repeat(121);
  const longFooterRes = validateLabelPrintConfig({
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    custom_footer_i18n: { vi: longFooter, en: '' },
  });
  assert.equal(longFooterRes.valid, false);
  assert.equal(longFooterRes.errors[0]?.code, 'CUSTOM_FOOTER_TOO_LONG');
  assert.match(
    formatLabelValidationError(longFooterRes.errors[0]!, 'vi'),
    new RegExp(String(MAX_LABEL_FOOTER_LENGTH))
  );

  // Custom footer unsafe HTML or control characters
  const unsafeFooterRes = validateLabelPrintConfig({
    ...DEFAULT_SHOP_LABEL_PRINT_CONFIG,
    custom_footer_i18n: { vi: '<script>alert(1)</script>', en: '' },
  });
  assert.equal(unsafeFooterRes.valid, false);
  assert.equal(unsafeFooterRes.errors[0]?.code, 'UNSAFE_CUSTOM_FOOTER');
  assert.match(
    formatLabelValidationError(unsafeFooterRes.errors[0]!, 'vi'),
    /HTML/
  );
});

test('4. PATCH payload builder scopes strictly to theme_config.labelPrintConfig', () => {
  const config = getDefaultShopLabelPrintConfig();
  const payload = buildLabelPrintPatchPayload('shop-sample-01', config);

  assert.deepEqual(Object.keys(payload).sort(), ['id', 'theme_config']);
  assert.equal(payload.id, 'shop-sample-01');
  assert.deepEqual(Object.keys(payload.theme_config), ['labelPrintConfig']);
  assert.deepEqual(payload.theme_config.labelPrintConfig, config);

  // Ensure no leakage of unrelated shop columns or theme keys
  assert.equal('primaryColor' in payload.theme_config, false);
  assert.equal('orderWorkflow' in payload.theme_config, false);
  assert.equal('promoBanner' in payload.theme_config, false);
  assert.equal('paymentQr' in payload.theme_config, false);
});

test('5. Component controller, permissions, save error handling, and SSR rendering', async () => {
  await import('./tsx-review-loader.mjs');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const {
    ShopLabelPrintSettingsEditor,
    canActorEditLabelPrintConfig,
    saveShopLabelPrintConfig,
  } = await import('@/components/dashboard/ShopLabelPrintSettingsEditor');

  // Permissions tests
  // Owner
  assert.equal(
    canActorEditLabelPrintConfig({ role: 'owner', permissions: [], is_active: true }),
    true
  );

  // Super Admin profile
  assert.equal(
    canActorEditLabelPrintConfig(
      { role: 'staff', permissions: ['settings.manage'], is_active: true },
      { role: 'admin', is_admin: true }
    ),
    true
  );

  // Admin override
  assert.equal(canActorEditLabelPrintConfig(null, null, true), true);

  // Staff or Cashier without owner / super admin
  assert.equal(
    canActorEditLabelPrintConfig({ role: 'staff', permissions: ['settings.manage'], is_active: true }),
    false
  );
  assert.equal(
    canActorEditLabelPrintConfig({ role: 'cashier', permissions: ['orders.view'], is_active: true }),
    false
  );
  assert.equal(canActorEditLabelPrintConfig(null, null, false), false);

  // saveShopLabelPrintConfig tests
  // A. Missing shop ID fails immediately
  const missingIdRes = await saveShopLabelPrintConfig({
    shopId: '',
    draft: getDefaultShopLabelPrintConfig(),
  });
  assert.equal(missingIdRes.ok, false);
  assert.match(missingIdRes.error, /cửa hàng|store/i);

  // B. Invalid draft blocks network call
  let networkCalled = false;
  const invalidDraft = {
    ...getDefaultShopLabelPrintConfig(),
    copies_per_unit: 99,
  };
  const invalidDraftRes = await saveShopLabelPrintConfig({
    shopId: 'shop-001',
    draft: invalidDraft,
    fetchImpl: async () => {
      networkCalled = true;
      return new Response('{}', { status: 200 });
    },
  });
  assert.equal(invalidDraftRes.ok, false);
  assert.equal(networkCalled, false);
  assert.ok((invalidDraftRes.validationErrors?.length ?? 0) > 0);

  // C. Network error / rejection handled cleanly
  const netErrRes = await saveShopLabelPrintConfig({
    shopId: 'shop-001',
    draft: getDefaultShopLabelPrintConfig(),
    locale: 'vi',
    fetchImpl: async () => {
      throw new Error('Connection reset by peer');
    },
  });
  assert.equal(netErrRes.ok, false);
  assert.match(netErrRes.error, /Connection reset/);

  // D. Server returns HTTP 400 with error message
  const serverErrRes = await saveShopLabelPrintConfig({
    shopId: 'shop-001',
    draft: getDefaultShopLabelPrintConfig(),
    locale: 'vi',
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({ error: 'Cấu hình in tem nhãn không hợp lệ.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  assert.equal(serverErrRes.ok, false);
  assert.equal(serverErrRes.error, 'Cấu hình in tem nhãn không hợp lệ.');

  // E. Server returns HTTP 200 but shop ID does not match expected shop -> NEVER report success
  const mismatchedRes = await saveShopLabelPrintConfig({
    shopId: 'shop-target',
    draft: getDefaultShopLabelPrintConfig(),
    locale: 'en',
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          shop: { id: 'shop-wrong', name: 'Other Shop' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  assert.equal(mismatchedRes.ok, false);
  assert.match(mismatchedRes.error, /Could not save label print settings/);

  // F. Successful save invokes onUpdateActiveShop and onRefreshDashboard
  let activeShopUpdated: Shop | null = null;
  let refreshCalled = false;
  const validSavedConfig = {
    ...getDefaultShopLabelPrintConfig(),
    paper_preset: 'cup_sticker_40x30' as const,
  };

  const successRes = await saveShopLabelPrintConfig({
    shopId: 'shop-target',
    draft: validSavedConfig,
    locale: 'vi',
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          shop: {
            id: 'shop-target',
            name: 'Target Shop',
            theme_config: {
              labelPrintConfig: validSavedConfig,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
    onUpdateActiveShop: (s) => {
      activeShopUpdated = s;
    },
    onRefreshDashboard: async () => {
      refreshCalled = true;
    },
  });

  assert.equal(successRes.ok, true);
  assert.equal(activeShopUpdated !== null, true);
  assert.equal(refreshCalled, true);
  if (successRes.ok) {
    assert.equal(successRes.config.paper_preset, 'cup_sticker_40x30');
  }

  // G. SSR Markup of ShopLabelPrintSettingsEditor component
  const dummyShop: Shop = {
    id: 'shop-ssr-test',
    owner_id: '00000000-0000-4000-8000-000000000001',
    slug: 'shop-ssr-test',
    name: 'Quán Trà Sữa Thử Nghiệm',
    tagline_i18n: { vi: '' },
    description_i18n: { vi: '' },
    vertical: 'fnb',
    logo_url: null,
    cover_urls: [],
    supported_langs: ['vi', 'en'],
    currency: 'VND',
    address: '123 Đường Test',
    city: 'da-nang',
    phone_contact: '',
    zalo_phone: '',
    google_maps_url: '',
    google_review_url: '',
    opening_hours: {
      mon: { open: '08:00', close: '22:00', closed: false },
      tue: { open: '08:00', close: '22:00', closed: false },
      wed: { open: '08:00', close: '22:00', closed: false },
      thu: { open: '08:00', close: '22:00', closed: false },
      fri: { open: '08:00', close: '22:00', closed: false },
      sat: { open: '08:00', close: '22:00', closed: false },
      sun: { open: '08:00', close: '22:00', closed: false },
    },
    wifi_info: { ssid: '', password: '' },
    theme_config: {
      primaryColor: '#10b981',
      layout: 'grid',
      labelPrintConfig: validSavedConfig,
    },
    is_published: true,
    created_at: new Date().toISOString(),
  };

  const ownerHtml = renderToStaticMarkup(
    React.createElement(ShopLabelPrintSettingsEditor, {
      shop: dummyShop,
      membership: { role: 'owner', permissions: [], is_active: true },
      locale: 'vi',
    })
  );

  // Verify all essential controls and testids are rendered in SSR HTML
  assert.match(ownerHtml, /data-testid="label-print-enabled-checkbox"/);
  assert.match(ownerHtml, /data-testid="label-preset-cup_sticker_50x30"/);
  assert.match(ownerHtml, /data-testid="label-preset-cup_sticker_40x30"/);
  assert.match(ownerHtml, /data-testid="label-preset-production_slip_58mm"/);
  assert.match(ownerHtml, /data-testid="label-preset-production_slip_80mm"/);
  assert.match(ownerHtml, /data-testid="label-split-mode-per_item_unit"/);
  assert.match(ownerHtml, /data-testid="label-split-mode-per_line_item"/);
  assert.match(ownerHtml, /data-testid="label-split-mode-single_ticket"/);
  assert.match(ownerHtml, /data-testid="label-copies-per-unit-input"/);
  assert.match(ownerHtml, /data-testid="label-max-labels-input"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_shop_name"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_order_code"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_table_label"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_item_name"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_item_options"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_item_note"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_order_note"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_sequence_counter"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_timestamp"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_price"/);
  assert.match(ownerHtml, /data-testid="label-toggle-show_payment_qr"/);
  assert.match(ownerHtml, /data-testid="label-footer-vi-input"/);
  assert.match(ownerHtml, /data-testid="label-footer-en-input"/);
  assert.match(ownerHtml, /data-testid="label-print-live-preview"/);
  assert.match(ownerHtml, /data-testid="label-save-button"/);

  // Staff read-only view disables controls and displays badge
  const staffHtml = renderToStaticMarkup(
    React.createElement(ShopLabelPrintSettingsEditor, {
      shop: dummyShop,
      membership: { role: 'staff', permissions: ['orders.view'], is_active: true },
      locale: 'vi',
    })
  );
  assert.match(staffHtml, /Chỉ xem \(Cần quyền Owner\)/);

  // Null shop renders null / empty markup cleanly without error
  const nullShopHtml = renderToStaticMarkup(
    React.createElement(ShopLabelPrintSettingsEditor, {
      shop: null,
      membership: { role: 'owner', permissions: [], is_active: true },
      locale: 'vi',
    })
  );
  assert.equal(nullShopHtml, '');
});

test('6. End-to-end PATCH /api/shops persistence with PGlite preserves unrelated settings and enforces owner permissions', async () => {
  await import('./tsx-review-loader.mjs');
  const { saveShopLabelPrintConfig } = await import(
    '@/components/dashboard/ShopLabelPrintSettingsEditor'
  );

  const db = new PGlite({ extensions: { uuid_ossp } });
  const ownerId = '00000000-0000-4000-8000-000000000601';
  const staffId = '00000000-0000-4000-8000-000000000602';
  const testShopId = 'shop-label-persistence-test';

  function ident(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  class PgQueryBuilder {
    private table: string;
    private filters: Array<{ col: string; val: unknown }> = [];
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    private updatePayload: Record<string, unknown> | null = null;
    constructor(table: string) {
      this.table = table;
    }
    select() {
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ col, val });
      return this;
    }
    single() {
      this.singleMode = 'single';
      return this;
    }
    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this;
    }
    async execute(): Promise<{
      data: unknown;
      error: { message: string } | null;
    }> {
      try {
        const params: unknown[] = [];
        const whereSql =
          this.filters.length > 0
            ? ' WHERE ' +
              this.filters
                .map((f) => {
                  params.push(f.val);
                  return `${ident(f.col)} = $${params.length}`;
                })
                .join(' AND ')
            : '';
        if (this.updatePayload) {
          const keys = Object.keys(this.updatePayload);
          const setClauses = keys.map((k) => {
            const v = this.updatePayload![k];
            params.push(
              typeof v === 'object' && v !== null ? JSON.stringify(v) : v
            );
            return `${ident(k)} = $${params.length}`;
          });
          const { rows } = await db.query(
            `UPDATE ${ident(this.table)} SET ${setClauses.join(', ')}${whereSql} RETURNING *`,
            params
          );
          return {
            data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
            error: null,
          };
        }
        const { rows } = await db.query(
          `SELECT * FROM ${ident(this.table)}${whereSql}`,
          params
        );
        return {
          data: this.singleMode !== 'none' ? (rows[0] ?? null) : rows,
          error: null,
        };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    then(
      resolve: (result: unknown) => unknown,
      reject: (err: unknown) => unknown
    ) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    from: (table: string) => new PgQueryBuilder(table),
  };

  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
    for (const file of fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      await db.exec(
        fs.readFileSync(path.join('supabase/migrations', file), 'utf8')
      );
    }

    // Seed initial shop with unrelated theme_config properties:
    // primaryColor, promoBanner, paymentQr, orderWorkflow
    await db.exec(`
      INSERT INTO profiles (id) VALUES ('${ownerId}'), ('${staffId}');
      INSERT INTO shops (id, owner_id, slug, name, is_published, theme_config) VALUES (
        '${testShopId}',
        '${ownerId}',
        'shop-label-test',
        'Quán Trà Sữa Label Test',
        true,
        '{"primaryColor":"#8b5cf6","layout":"grid","paymentQr":{"bankId":"MB","accountNo":"99998888","accountName":"CHU QUAN"},"promoBanner":{"enabled":true,"discountValue":20,"title":"Khuyến mãi hè"},"orderWorkflow":{"template_id":"classic_kitchen","start_step_id":"new","steps":[{"id":"new","stage":"new","next_step_ids":["completed"]}]}}'::jsonb
      );
      INSERT INTO shop_memberships (id, shop_id, user_id, role, permissions, is_active) VALUES
        ('mem-staff-label', '${testShopId}', '${staffId}', 'staff', '["orders.view","settings.manage"]'::jsonb, true);
    `);

    setSupabaseDbClientForTests(client);
    setShopMembershipDbClientForTest(client as never);

    const ownerToken = issueSessionToken({
      id: ownerId,
      email: 'owner-label@qlaok.test',
      role: 'owner',
    });
    const staffToken = issueSessionToken({
      id: staffId,
      email: 'staff-label@qlaok.test',
      role: 'staff',
    });

    const makeFetch =
      (token: string): typeof fetch =>
      async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const rawBody = init?.body ? String(init.body) : '{}';
        return patchShops(
          new Request(`http://localhost${url}`, {
            method: init?.method || 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: rawBody,
          })
        );
      };

    // A. Staff attempt to change labelPrintConfig is rejected with 403
    const staffDraft: ShopLabelPrintConfig = {
      ...getDefaultShopLabelPrintConfig(),
      paper_preset: 'production_slip_58mm',
    };
    const staffResult = await saveShopLabelPrintConfig({
      shopId: testShopId,
      draft: staffDraft,
      locale: 'vi',
      fetchImpl: makeFetch(staffToken),
    });
    assert.equal(staffResult.ok, false);
    assert.match(staffResult.error, /quyền|permission/i);

    // B. Owner saves custom labelPrintConfig -> HTTP 200, strictly preserves unrelated theme settings
    const ownerDraft: ShopLabelPrintConfig = {
      enabled: true,
      paper_preset: 'cup_sticker_40x30',
      split_mode: 'per_item_unit',
      copies_per_unit: 2,
      max_labels_per_print: 40,
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
      show_payment_qr: false,
      custom_footer_i18n: {
        vi: 'Chúc bạn một ngày vui vẻ!',
        en: 'Have a wonderful day!',
      },
    };

    let updatedShop: Shop | null = null;
    const ownerResult = await saveShopLabelPrintConfig({
      shopId: testShopId,
      draft: ownerDraft,
      locale: 'vi',
      fetchImpl: makeFetch(ownerToken),
      onUpdateActiveShop: (s) => {
        updatedShop = s;
      },
    });

    assert.equal(ownerResult.ok, true);
    assert.ok(updatedShop);

    // Inspect updated shop theme_config in DB
    const dbResult = await db.query<{ theme_config: string | Record<string, unknown> }>(
      `SELECT theme_config FROM shops WHERE id = '${testShopId}'`
    );
    const dbRow = dbResult.rows[0];
    assert.ok(dbRow);
    const dbTheme = (typeof dbRow.theme_config === 'string'
      ? JSON.parse(dbRow.theme_config)
      : dbRow.theme_config) as Record<string, any>;

    // Verify labelPrintConfig is saved accurately
    assert.equal(dbTheme.labelPrintConfig.paper_preset, 'cup_sticker_40x30');
    assert.equal(dbTheme.labelPrintConfig.copies_per_unit, 2);
    assert.equal(dbTheme.labelPrintConfig.max_labels_per_print, 40);
    assert.equal(dbTheme.labelPrintConfig.show_price, true);
    assert.equal(
      dbTheme.labelPrintConfig.custom_footer_i18n.vi,
      'Chúc bạn một ngày vui vẻ!'
    );

    // Verify UNRELATED theme keys are strictly preserved!
    assert.equal(dbTheme.primaryColor, '#8b5cf6');
    assert.equal(dbTheme.layout, 'grid');
    assert.equal(dbTheme.promoBanner.title, 'Khuyến mãi hè');
    assert.equal(dbTheme.promoBanner.discountValue, 20);
    assert.equal(dbTheme.paymentQr.bankId, 'MB');
    assert.equal(dbTheme.orderWorkflow.template_id, 'classic_kitchen');

    // C. General Settings save (which omits labelPrintConfig) does NOT overwrite or wipe labelPrintConfig
    const generalSettingsPatch = {
      id: testShopId,
      name: 'Quán Trà Sữa Đổi Tên',
      theme_config: {
        primaryColor: '#10b981',
        layout: 'list',
        promoBanner: {
          enabled: true,
          title: 'Khuyến mãi mùa thu',
        },
      },
    };

    const genSaveRes = await patchShops(
      new Request('http://localhost/api/shops', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify(generalSettingsPatch),
      })
    );
    assert.equal(genSaveRes.status, 200);

    const postGenResult = await db.query<{ name: string; theme_config: string | Record<string, unknown> }>(
      `SELECT name, theme_config FROM shops WHERE id = '${testShopId}'`
    );
    const postGenShop = postGenResult.rows[0];
    assert.ok(postGenShop);
    assert.equal(postGenShop.name, 'Quán Trà Sữa Đổi Tên');

    const postGenTheme = (typeof postGenShop.theme_config === 'string'
      ? JSON.parse(postGenShop.theme_config)
      : postGenShop.theme_config) as Record<string, any>;

    // Primary color updated by general settings
    assert.equal(postGenTheme.primaryColor, '#10b981');
    assert.equal(postGenTheme.layout, 'list');

    // Label print config was NOT wiped or touched!
    assert.ok(postGenTheme.labelPrintConfig, 'labelPrintConfig must be preserved');
    assert.equal(postGenTheme.labelPrintConfig.paper_preset, 'cup_sticker_40x30');
    assert.equal(postGenTheme.labelPrintConfig.copies_per_unit, 2);
    assert.equal(
      postGenTheme.labelPrintConfig.custom_footer_i18n.vi,
      'Chúc bạn một ngày vui vẻ!'
    );
    // orderWorkflow was also preserved
    assert.equal(postGenTheme.orderWorkflow.template_id, 'classic_kitchen');
  } finally {
    setSupabaseDbClientForTests(null);
    setShopMembershipDbClientForTest(null);
    await db.close();
  }
});
