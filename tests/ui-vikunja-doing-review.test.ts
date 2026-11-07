import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorefrontWelcomePopup } from '../src/components/storefront/StorefrontCustomDecor';
import { ItemDetailDrawer } from '../src/components/storefront/ItemDetailDrawer';
import { ShowToStaffModal } from '../src/components/storefront/ShowToStaffModal';
import type { CatalogItem, Shop, ShopOrder } from '../src/types/qlaok';

const repoRoot = process.cwd();
const readSource = (relPath: string) =>
  fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

const sampleShop: Shop = {
  id: 'shop-ui-review',
  owner_id: 'owner-ui-review',
  slug: 'pho-ngon-hoi-an',
  name: 'Phở Ngon Hội An',
  vertical: 'fnb',
  tagline_i18n: { vi: 'Phở truyền thống' },
  description_i18n: { vi: 'Nước dùng ninh xương 12 giờ' },
  logo_url: null,
  cover_urls: [],
  address: '12 Trần Phú, Hội An',
  city: 'Hội An',
  google_maps_url: null,
  google_review_url: null,
  phone_contact: '0905123456',
  zalo_phone: null,
  wifi_info: { ssid: 'test-only-network', password: 'test-only-password' },
  opening_hours: {
    mon: { open: '06:30', close: '22:00', closed: false },
    tue: { open: '06:30', close: '22:00', closed: false },
    wed: { open: '06:30', close: '22:00', closed: false },
    thu: { open: '06:30', close: '22:00', closed: false },
    fri: { open: '06:30', close: '22:00', closed: false },
    sat: { open: '06:30', close: '22:00', closed: false },
    sun: { open: '06:30', close: '22:00', closed: false },
  },
  supported_langs: ['vi', 'en', 'ko', 'ja'],
  currency: 'VND',
  theme_config: {
    primaryColor: '#10b981',
    layout: 'grid',
    welcomePopup: {
      enabled: true,
      badgeText: 'ƯU ĐÃI HÔM NAY',
      title: 'Chào mừng quý khách đến Phở Ngon!',
      content: 'Nhập mã để giảm ngay 10% tổng hóa đơn.',
      voucherCode: 'WELCOME10',
      ctaText: 'Xem thực đơn ngay',
    },
  },
  is_published: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

const sampleItem: CatalogItem = {
  id: 'item-pho-bo-dac-biet',
  shop_id: sampleShop.id,
  category_id: 'cat-main',
  name_i18n: {
    vi: 'Phở Bò Tái Nạm Đặc Biệt',
    en: 'Special Rare & Brisket Beef Pho',
  },
  desc_i18n: {
    vi: 'Nước dùng ninh xương 12 giờ.',
    en: '12-hour slow-simmered bone broth.',
  },
  price: 65000,
  compare_at_price: 75000,
  image_url: null,
  is_available: true,
  is_featured: true,
  sort_order: 1,
  view_count: 10,
  options_json: [],
};

test('Task #4: RightPreviewSidebar is collapsed by default under xl, capped at min(380px,100vw), clear of xl header, and Settings/SePay rows wrap cleanly', () => {
  const sidebarSource = readSource(
    'src/components/dashboard/RightPreviewSidebar.tsx'
  );
  const layoutSource = readSource(
    'src/app/(dashboard)/dashboard/layout.tsx'
  );
  const settingsSource = readSource(
    'src/app/(dashboard)/dashboard/settings/page.tsx'
  );
  const postsSource = readSource(
    'src/app/(dashboard)/dashboard/posts/page.tsx'
  );
  const sepaySource = readSource(
    'src/components/dashboard/ShopSePayWebhookManager.tsx'
  );

  // Responsive drawer width <= 380px and never wider than viewport; docked below xl header
  assert.match(
    sidebarSource,
    /fixed inset-y-0 xl:top-14 right-0 z-40 w-full max-w-\[min\(380px,100vw\)\]/
  );
  assert.match(layoutSource, /<header className="sticky top-0 z-30[^"]*xl:h-14/);

  // Accessible open/close controls preserved
  assert.match(sidebarSource, /aria-expanded=\{isOpen\}/);
  assert.match(sidebarSource, /aria-hidden=\{!isOpen\}/);

  // Settings and Posts collapse preview by default under xl (< 1280px)
  for (const [name, src] of [
    ['settings/page.tsx', settingsSource],
    ['posts/page.tsx', postsSource],
  ] as const) {
    assert.match(
      src,
      /const \[isPreviewSidebarOpen, setIsPreviewSidebarOpen\] = useState\(false\);/,
      `${name} must initialize preview sidebar closed for SSR/narrow viewports`
    );
    assert.match(
      src,
      /if \(window\.innerWidth < 1280\)\s*\{\s*setIsPreviewSidebarOpen\(false\);\s*return;\s*\}/,
      `${name} must collapse preview sidebar by default under xl (< 1280px)`
    );
  }

  // Settings upload rows and SePay Copy URL row allow wrapping without document overflow
  assert.ok(
    (settingsSource.match(/flex flex-wrap items-center gap-2\.5/g) || [])
      .length >= 2,
    'Logo and Cover upload rows in Settings must wrap cleanly'
  );
  assert.ok(
    (settingsSource.match(/min-w-\[140px\] flex-1/g) || []).length >= 4,
    'Logo, Cover, Wallpaper, and Custom QR inputs in Settings must allow wrapping'
  );
  assert.match(
    sepaySource,
    /id="sepay-callback-url-input"[\s\S]*?min-w-\[160px\] flex-1/
  );
});

test('Task #5: Billing plan comparison grid stacks vertically until xl (1280px) and prevents card overflow', () => {
  const billingSource = readSource(
    'src/app/(dashboard)/dashboard/billing/page.tsx'
  );

  assert.match(
    billingSource,
    /<div className="grid grid-cols-1 xl:grid-cols-3 gap-5">/,
    'Billing plan cards must stack 1 per row below xl and use 3 columns at xl'
  );
  assert.doesNotMatch(
    billingSource,
    /<div className="grid grid-cols-1 md:grid-cols-3 gap-5">/,
    'Billing plan cards must not switch to 3 columns at md (768px)'
  );
  assert.match(
    billingSource,
    /min-w-0 rounded-3xl border p-6 flex flex-col justify-between/
  );
});

test('Task #6: StorefrontWelcomePopup and ItemDetailDrawer expose role="dialog", aria-modal="true", and meaningful aria-labelledby title', () => {
  const popupHtml = renderToStaticMarkup(
    React.createElement(StorefrontWelcomePopup, {
      shop: sampleShop,
      locale: 'vi',
      isOpen: true,
      onClose: () => {},
    })
  );

  assert.match(
    popupHtml,
    /<div[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="storefront-welcome-popup-title"/,
    'StorefrontWelcomePopup must expose role="dialog", aria-modal="true", and aria-labelledby'
  );
  assert.match(
    popupHtml,
    /<h3 id="storefront-welcome-popup-title"[^>]*>Chào mừng quý khách đến Phở Ngon!<\/h3>/,
    'StorefrontWelcomePopup title heading must match aria-labelledby id'
  );

  const drawerHtml = renderToStaticMarkup(
    React.createElement(ItemDetailDrawer, {
      item: sampleItem,
      vertical: 'fnb',
      locale: 'vi',
      currency: 'VND',
      primaryColor: '#10b981',
      onClose: () => {},
      onAddToCart: () => {},
    })
  );

  const expectedTitleId = `storefront-item-detail-title-${sampleItem.id}`;
  assert.match(
    drawerHtml,
    new RegExp(
      `<div[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="${expectedTitleId}"`
    ),
    'ItemDetailDrawer must expose role="dialog", aria-modal="true", and aria-labelledby'
  );
  assert.match(
    drawerHtml,
    new RegExp(
      `<h3 id="${expectedTitleId}"[^>]*>Phở Bò Tái Nạm Đặc Biệt<\\/h3>`
    ),
    'ItemDetailDrawer item heading must match aria-labelledby id'
  );

  // Verify Escape handler in ItemDetailDrawer respects isSubmitting guard
  const drawerSource = readSource(
    'src/components/storefront/ItemDetailDrawer.tsx'
  );
  assert.match(drawerSource, /if \(!item \|\| isSubmitting\) return;/);
  assert.match(drawerSource, /if \(e\.key === 'Escape'\)/);
});

test('Task #8: ShowToStaffModal live order tracker renders compact green status dot and "Live" while preserving accessible trackerTitle label', () => {
  const sampleOrder: ShopOrder = {
    id: 'order-live-1',
    shop_id: sampleShop.id,
    order_code: 'ORD-8899',
    table_label: 'Bàn 05',
    visitor_lang: 'vi',
    source: 'qr_table',
    customer_note: '',
    status: 'preparing',
    payment_method: 'cash',
    payment_status: 'unpaid',
    total_amount: 65000,
    tracking_token: 'tok-live-123456',
    items: [
      {
        item_id: sampleItem.id,
        name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
        name_i18n: sampleItem.name_i18n,
        quantity: 1,
        unit_price: 65000,
        extra_price: 0,
        selected_choices: [],
        quick_tags: [],
        custom_note: '',
      },
    ],
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:05:00.000Z',
  };

  const modalHtml = renderToStaticMarkup(
    React.createElement(ShowToStaffModal, {
      isOpen: true,
      onClose: () => {},
      shop: sampleShop,
      locale: 'vi',
      cart: [],
      tables: [],
      activeOrderProp: sampleOrder,
      onUpdateQuantity: () => {},
      onClearCart: () => {},
    })
  );

  // Must render compact Live badge with green dot and accessible label
  assert.match(
    modalHtml,
    /data-testid="guest-order-live-badge"[^>]*aria-label="Trạng thái đơn hàng đang cập nhật"/,
    'Live order badge must preserve localized accessible label'
  );
  assert.match(
    modalHtml,
    /<span aria-hidden="true" class="[^"]*bg-emerald-500 animate-pulse[^"]*"><\/span><span>Live<\/span>/,
    'Live order badge must display green dot and "Live" text'
  );
  assert.doesNotMatch(
    modalHtml,
    />Trạng Thái Đơn Hàng Trực Tiếp \(Realtime\)</,
    'Long technical trackerTitle string must not be rendered as visible text'
  );
});
