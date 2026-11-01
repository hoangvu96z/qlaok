import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import hooksClientContextMod from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import appRouterContextMod from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import StorefrontDoorPage from '../src/app/(storefront)/s/[slug]/page';
import StorefrontMenuPage from '../src/app/(storefront)/s/[slug]/menu/page';
import {
  createStorefrontDoorCoordinator,
  createStorefrontMenuCoordinator,
  StorefrontDoorCoordinatorContext,
  StorefrontMenuCoordinatorContext,
  type StorefrontDoorBundleResponse,
  type StorefrontDoorCoordinator,
  type StorefrontMenuBundleResponse,
  type StorefrontMenuCoordinator,
} from '../src/lib/storefront-navigation-state';
import { UI_LABELS } from '../src/lib/i18n-helper';
import type {
  CatalogItem,
  Category,
  Post,
  Shop,
  ShopTable,
  SupportedLocale,
} from '../src/types/qlaok';

const { PathParamsContext, PathnameContext, SearchParamsContext } =
  hooksClientContextMod as {
    PathParamsContext: React.Context<Record<string, string>>;
    PathnameContext: React.Context<string>;
    SearchParamsContext: React.Context<URLSearchParams>;
  };

const { AppRouterContext } = appRouterContextMod as {
  AppRouterContext: React.Context<{
    back(): void;
    forward(): void;
    refresh(): void;
    push(href: string): void;
    replace(href: string): void;
    prefetch(href: string): void;
  }>;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withSsrWindowStub<T>(fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  if (!descriptor) {
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener() {},
        removeEventListener() {},
      },
      configurable: true,
      writable: true,
    });
  }
  try {
    return fn();
  } finally {
    if (!descriptor) {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

function createNoopRouter(onReplace?: (href: string) => void) {
  return {
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace(href: string) {
      onReplace?.(href);
    },
    prefetch() {},
  };
}

function renderDoorRouteHtml(input: {
  slug: string;
  search?: string;
  coordinator: StorefrontDoorCoordinator;
  onReplace?: (href: string) => void;
}): string {
  const router = createNoopRouter(input.onReplace);
  const searchParams = new URLSearchParams(input.search ?? '');
  return withSsrWindowStub(() =>
    renderToStaticMarkup(
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(
          PathnameContext.Provider,
          { value: `/s/${input.slug}` },
          React.createElement(
            PathParamsContext.Provider,
            { value: { slug: input.slug } },
            React.createElement(
              SearchParamsContext.Provider,
              { value: searchParams },
              React.createElement(
                StorefrontDoorCoordinatorContext.Provider,
                { value: input.coordinator },
                React.createElement(StorefrontDoorPage)
              )
            )
          )
        )
      )
    )
  );
}

function renderMenuRouteHtml(input: {
  slug: string;
  search?: string;
  coordinator: StorefrontMenuCoordinator;
  onReplace?: (href: string) => void;
}): string {
  const router = createNoopRouter(input.onReplace);
  const searchParams = new URLSearchParams(input.search ?? '');
  return withSsrWindowStub(() =>
    renderToStaticMarkup(
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(
          PathnameContext.Provider,
          { value: `/s/${input.slug}/menu` },
          React.createElement(
            PathParamsContext.Provider,
            { value: { slug: input.slug } },
            React.createElement(
              SearchParamsContext.Provider,
              { value: searchParams },
              React.createElement(
                StorefrontMenuCoordinatorContext.Provider,
                { value: input.coordinator },
                React.createElement(StorefrontMenuPage)
              )
            )
          )
        )
      )
    )
  );
}

const ALWAYS_OPEN_HOURS: Shop['opening_hours'] = {
  mon: { open: '00:00', close: '23:59', closed: false },
  tue: { open: '00:00', close: '23:59', closed: false },
  wed: { open: '00:00', close: '23:59', closed: false },
  thu: { open: '00:00', close: '23:59', closed: false },
  fri: { open: '00:00', close: '23:59', closed: false },
  sat: { open: '00:00', close: '23:59', closed: false },
  sun: { open: '00:00', close: '23:59', closed: false },
};

const SHOP_A: Shop = {
  id: 'shop-pho-a',
  owner_id: 'owner-a',
  slug: 'pho-hoi-an',
  name: 'Phở Hội An Truyền Thống',
  vertical: 'fnb',
  tagline_i18n: {
    vi: 'Phở bò gia truyền phố Hội',
    en: 'Heritage Hoi An beef pho',
    ko: '호이안 전통 소고기 쌀국수',
  },
  description_i18n: {
    vi: 'Nước dùng ninh xương 18 giờ chuẩn vị Hội An.',
    en: '18-hour slow-simmered Hoi An beef noodle soup.',
    ko: '호이안 전통 18시간 사골 쌀국수',
  },
  logo_url: 'https://cdn.example/pho-logo.png',
  cover_urls: [
    'https://cdn.example/pho-cover-1.jpg',
    'https://cdn.example/pho-cover-2.jpg',
  ],
  theme_config: {
    primaryColor: '#10b981',
    layout: 'grid',
    promoBanner: {
      enabled: true,
      badgeText: 'HOT PHO',
      title: 'Giảm 20% combo phở buổi trưa',
    },
    welcomePopup: {
      enabled: true,
      badgeText: 'WELCOME PHO',
      title: 'Chào mừng đến Phở Hội An',
      content: 'Tặng trà thảo mộc cho khách quét QR cửa quán.',
      ctaText: 'Xem thực đơn Phở ngay',
    },
    flashSale: {
      enabled: true,
      title: 'Flash Sale Phở Hội An',
      discountType: 'percent',
      discountValue: 15,
      itemIds: ['item-pho-dac-biet'],
    },
  },
  supported_langs: ['vi', 'en', 'ko'],
  currency: 'VND',
  city: 'Hội An',
  address: '12 Trần Phú, Minh An, Hội An',
  phone_contact: '0905111222',
  zalo_phone: '0905111222',
  wifi_info: { ssid: 'PhoHoiAn_5G', password: 'phohoian123' },
  opening_hours: ALWAYS_OPEN_HOURS,
  google_review_url: 'https://review.example/pho-hoi-an',
  google_maps_url: 'https://maps.example/pho-hoi-an',
  is_published: true,
};

const SHOP_A_CATEGORIES: Category[] = [
  {
    id: 'cat-pho-main',
    shop_id: SHOP_A.id,
    name_i18n: { vi: 'Phở Truyền Thống', en: 'Traditional Pho', ko: '전통 쌀국수' },
    sort_order: 1,
    is_active: true,
  },
];

const SHOP_A_ITEMS: CatalogItem[] = [
  {
    id: 'item-pho-dac-biet',
    shop_id: SHOP_A.id,
    category_id: 'cat-pho-main',
    name_i18n: {
      vi: 'Phở Bò Đặc Biệt Hội An',
      en: 'Hoi An Special Beef Pho',
      ko: '호이안 스페셜 소고기 쌀국수',
    },
    desc_i18n: { vi: 'Tái, nạm, gầu, bò viên thủ công' },
    price: 75000,
    image_url: 'https://cdn.example/item-pho.jpg',
    options_json: [],
    is_available: true,
    is_featured: true,
    view_count: 42,
    sort_order: 1,
  },
];

const SHOP_A_POSTS: Post[] = [
  {
    id: 'post-pho-1',
    shop_id: SHOP_A.id,
    title_i18n: {
      vi: 'Khai trương không gian Phố Cổ mới',
      en: 'Grand reopening in Old Town',
      ko: '올드타운 신규 매장 오픈',
    },
    content_i18n: {
      vi: 'Ưu đãi đặc biệt cho thực khách ghé Phở Hội An tuần này.',
    },
    is_pinned: true,
    is_active: true,
    created_at: '2026-10-01T08:00:00.000Z',
  },
];

const SHOP_A_TABLES: ShopTable[] = [
  {
    id: 'tbl-pho-01',
    shop_id: SHOP_A.id,
    table_code: 'T01',
    name: 'Bàn Phố Cổ 01',
    section: 'Tầng 1',
    capacity: 4,
    sort_order: 1,
    is_active: true,
    is_archived: false,
    archived_at: null,
    layout_x: 10,
    layout_y: 20,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  },
];

const SHOP_B: Shop = {
  id: 'shop-aura-b',
  owner_id: 'owner-b',
  slug: 'aura-spa',
  name: 'Aura Spa Wellness',
  vertical: 'service',
  tagline_i18n: {
    vi: 'Không gian thư giãn thảo mộc',
    en: 'Botanical wellness sanctuary',
  },
  description_i18n: {
    vi: 'Liệu trình thư giãn thảo mộc thiên nhiên.',
    en: 'Botanical relaxation & wellness rituals.',
  },
  logo_url: 'https://cdn.example/aura-logo.png',
  cover_urls: ['https://cdn.example/aura-cover-1.jpg'],
  theme_config: {
    primaryColor: '#1e293b',
    layout: 'list',
  },
  supported_langs: ['vi', 'en'],
  currency: 'VND',
  city: 'TP.HCM',
  address: '88 Nguyễn Huệ, Quận 1',
  phone_contact: '0909888777',
  zalo_phone: null,
  google_maps_url: null,
  google_review_url: null,
  wifi_info: { ssid: 'AuraSpa_Guest', password: 'relax2026' },
  opening_hours: ALWAYS_OPEN_HOURS,
  is_published: true,
};

const SHOP_B_CATEGORIES: Category[] = [
  {
    id: 'cat-aura-massage',
    shop_id: SHOP_B.id,
    name_i18n: { vi: 'Trị liệu toàn thân', en: 'Body Therapy' },
    sort_order: 1,
    is_active: true,
  },
];

const SHOP_B_ITEMS: CatalogItem[] = [
  {
    id: 'item-aura-hotstone',
    shop_id: SHOP_B.id,
    category_id: 'cat-aura-massage',
    name_i18n: { vi: 'Massage Đá Nóng Himalaya', en: 'Himalayan Hot Stone' },
    desc_i18n: { vi: '75 phút thư giãn chuyên sâu' },
    price: 450000,
    image_url: 'https://cdn.example/item-aura.jpg',
    options_json: [],
    is_available: true,
    is_featured: true,
    view_count: 19,
    sort_order: 1,
  },
];

const SHOP_B_POSTS: Post[] = [
  {
    id: 'post-aura-1',
    shop_id: SHOP_B.id,
    title_i18n: { vi: 'Ưu đãi khung giờ vàng tại Aura Spa' },
    content_i18n: { vi: 'Giảm 10% khi đặt lịch trước 14h.' },
    is_pinned: false,
    is_active: true,
    created_at: '2026-10-02T08:00:00.000Z',
  },
];

function assertNoShopALeakage(html: string, contextLabel: string) {
  const forbiddenMarkers = [
    SHOP_A.name,
    'pho-logo.png',
    'pho-cover-1.jpg',
    'pho-cover-2.jpg',
    'PhoHoiAn_5G',
    '12 Trần Phú',
    '0905111222',
    'maps.example/pho-hoi-an',
    'review.example/pho-hoi-an',
    'Phở Bò Đặc Biệt Hội An',
    'Khai trương không gian Phố Cổ mới',
    'Giảm 20% combo phở buổi trưa',
    'Chào mừng đến Phở Hội An',
    'Bàn Phố Cổ 01',
    '/s/pho-hoi-an/menu',
    '/s/pho-hoi-an?',
  ];
  for (const marker of forbiddenMarkers) {
    assert.equal(
      html.includes(marker),
      false,
      `${contextLabel}: expected no stale Shop A marker "${marker}" in rendered HTML`
    );
  }
}

test('StorefrontDoorPage A -> B navigation clears previous shop immediately on slug change, while pending, and after B resolves', async () => {
  const pendingByUrl = new Map<string, Deferred<Response>>();
  const doorScans: Array<{ shop_id: string; visitor_lang: SupportedLocale }> = [];

  const coordinator = createStorefrontDoorCoordinator({
    initialSlug: 'pho-hoi-an',
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      const deferred = createDeferred<Response>();
      pendingByUrl.set(url, deferred);
      return deferred.promise;
    }) as typeof fetch,
    hasSeenWelcomePopup: () => false,
    trackDoorScan: (payload) => {
      doorScans.push({
        shop_id: payload.shop_id,
        visitor_lang: payload.visitor_lang,
      });
    },
    onError: () => {},
  });

  // 1. Load Shop A (/s/pho-hoi-an)
  const navAPromise = coordinator.navigate({ slug: 'pho-hoi-an' });
  const reqA = pendingByUrl.get('/api/shops?slug=pho-hoi-an');
  assert.ok(reqA, 'expected /api/shops?slug=pho-hoi-an request');
  reqA.resolve(
    jsonResponse({
      shop: SHOP_A,
      items: SHOP_A_ITEMS,
      posts: SHOP_A_POSTS,
      ownerPlan: 'premium',
    } satisfies StorefrontDoorBundleResponse)
  );
  await navAPromise;

  const htmlA = renderDoorRouteHtml({ slug: 'pho-hoi-an', coordinator });
  assert.ok(htmlA.includes(SHOP_A.name));
  assert.ok(htmlA.includes('pho-cover-1.jpg'));
  assert.ok(htmlA.includes('PhoHoiAn_5G'));
  assert.ok(htmlA.includes('0905111222'));
  assert.ok(htmlA.includes('Phở Bò Đặc Biệt Hội An'));
  assert.ok(htmlA.includes('Khai trương không gian Phố Cổ mới'));
  assert.ok(htmlA.includes('Chào mừng đến Phở Hội An'));
  assert.ok(htmlA.includes('/s/pho-hoi-an/menu?src=door&amp;lang=vi'));
  assert.equal(doorScans.length, 1);
  assert.equal(doorScans[0].shop_id, SHOP_A.id);

  // 2. Synchronous render frame immediately after route param changes to "aura-spa"
  //    (BEFORE passive useEffect calls coordinator.navigate)
  const htmlSyncBeforeEffect = renderDoorRouteHtml({
    slug: 'aura-spa',
    coordinator,
  });
  assert.ok(
    htmlSyncBeforeEffect.includes(UI_LABELS.vi.loadingShopInfo),
    'synchronous transition frame must render loading state, not previous shop'
  );
  assertNoShopALeakage(htmlSyncBeforeEffect, 'synchronous A -> B frame');

  // 3. While /api/shops?slug=aura-spa is in flight
  const navBPromise = coordinator.navigate({ slug: 'aura-spa' });
  const htmlWhileBPending = renderDoorRouteHtml({
    slug: 'aura-spa',
    coordinator,
  });
  assert.ok(htmlWhileBPending.includes(UI_LABELS.vi.loadingShopInfo));
  assertNoShopALeakage(htmlWhileBPending, 'pending B request');

  // 4. Resolve Shop B
  const reqB = pendingByUrl.get('/api/shops?slug=aura-spa');
  assert.ok(reqB, 'expected /api/shops?slug=aura-spa request');
  reqB.resolve(
    jsonResponse({
      shop: SHOP_B,
      items: SHOP_B_ITEMS,
      posts: SHOP_B_POSTS,
      ownerPlan: 'free',
    } satisfies StorefrontDoorBundleResponse)
  );
  await navBPromise;

  const htmlB = renderDoorRouteHtml({ slug: 'aura-spa', coordinator });
  assert.ok(htmlB.includes(SHOP_B.name));
  assert.ok(htmlB.includes('aura-cover-1.jpg'));
  assert.ok(htmlB.includes('AuraSpa_Guest'));
  assert.ok(htmlB.includes('0909888777'));
  assert.ok(htmlB.includes('Ưu đãi khung giờ vàng tại Aura Spa'));
  assert.ok(htmlB.includes('/s/aura-spa/menu?src=door&amp;lang=vi'));
  assertNoShopALeakage(htmlB, 'settled Shop B');
  assert.equal(doorScans.length, 2);
  assert.equal(doorScans[1].shop_id, SHOP_B.id);
});

test('StorefrontDoorPage renders not-found state on 404, 500, and network failure after visiting Shop A (never falls back to stale shop)', async () => {
  let mode: 'shop-a' | '404' | '500' | 'network-error' = 'shop-a';

  const coordinator = createStorefrontDoorCoordinator({
    initialSlug: 'pho-hoi-an',
    fetchImpl: (async () => {
      if (mode === 'shop-a') {
        return jsonResponse({
          shop: SHOP_A,
          items: SHOP_A_ITEMS,
          posts: SHOP_A_POSTS,
          ownerPlan: 'premium',
        } satisfies StorefrontDoorBundleResponse);
      }
      if (mode === '404') {
        return jsonResponse({ error: 'Shop not found' }, 404);
      }
      if (mode === '500') {
        return jsonResponse({ error: 'Upstream DB timeout' }, 500);
      }
      throw new TypeError('Failed to fetch');
    }) as typeof fetch,
    hasSeenWelcomePopup: () => false,
    trackDoorScan: () => {},
    onError: () => {},
  });

  await coordinator.navigate({ slug: 'pho-hoi-an' });
  assert.ok(
    renderDoorRouteHtml({ slug: 'pho-hoi-an', coordinator }).includes(
      SHOP_A.name
    )
  );

  // Navigate A -> missing-shop (404)
  mode = '404';
  await coordinator.navigate({ slug: 'missing-shop' });
  const html404 = renderDoorRouteHtml({ slug: 'missing-shop', coordinator });
  assert.ok(html404.includes(UI_LABELS.vi.shopNotFoundTitle));
  assert.ok(html404.includes('/s/missing-shop'));
  assert.ok(html404.includes('href="/explore"'));
  assertNoShopALeakage(html404, 'A -> B (404)');

  // Reload Shop A, then navigate A -> error-shop (500)
  mode = 'shop-a';
  await coordinator.navigate({ slug: 'pho-hoi-an' });
  mode = '500';
  await coordinator.navigate({ slug: 'error-shop' });
  const html500 = renderDoorRouteHtml({ slug: 'error-shop', coordinator });
  assert.ok(html500.includes(UI_LABELS.vi.shopNotFoundTitle));
  assert.ok(html500.includes('/s/error-shop'));
  assertNoShopALeakage(html500, 'A -> B (500)');

  // Reload Shop A, then navigate A -> offline-shop (network rejection)
  mode = 'shop-a';
  await coordinator.navigate({ slug: 'pho-hoi-an' });
  mode = 'network-error';
  await coordinator.navigate({ slug: 'offline-shop' });
  const htmlOffline = renderDoorRouteHtml({
    slug: 'offline-shop',
    coordinator,
  });
  assert.ok(htmlOffline.includes(UI_LABELS.vi.shopNotFoundTitle));
  assert.ok(htmlOffline.includes('/s/offline-shop'));
  assertNoShopALeakage(htmlOffline, 'A -> B (network failure)');
});

test('StorefrontDoorPage ignores out-of-order responses when A resolves after B (both 200 and 404 targets, including alias redirects and background refreshes)', async () => {
  const requests: Array<{
    url: string;
    signal?: AbortSignal | null;
    deferred: Deferred<Response>;
  }> = [];
  const replacedUrls: string[] = [];
  const doorScans: string[] = [];

  const coordinator = createStorefrontDoorCoordinator({
    initialSlug: 'pho-hoi-an-old-alias',
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const deferred = createDeferred<Response>();
      requests.push({
        url: String(input),
        signal: init?.signal,
        deferred,
      });
      return deferred.promise;
    }) as typeof fetch,
    onReplaceUrl: (url) => {
      replacedUrls.push(url);
    },
    hasSeenWelcomePopup: () => false,
    trackDoorScan: (payload) => {
      doorScans.push(payload.shop_id);
    },
    onError: () => {},
  });

  // Start request #1 for an alias of Shop A, then immediately navigate to Shop B before #1 resolves
  const navAPromise = coordinator.navigate({
    slug: 'pho-hoi-an-old-alias',
    searchParams: 'src=door&lang=ko',
    langParam: 'ko',
  });
  assert.equal(requests.length, 1);

  const navBPromise = coordinator.navigate({
    slug: 'aura-spa',
    searchParams: 'lang=en',
    langParam: 'en',
  });
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].signal?.aborted,
    true,
    'starting navigation to B must abort in-flight request for A'
  );

  // Resolve B first
  requests[1].deferred.resolve(
    jsonResponse({
      shop: SHOP_B,
      items: SHOP_B_ITEMS,
      posts: SHOP_B_POSTS,
      ownerPlan: 'premium',
    } satisfies StorefrontDoorBundleResponse)
  );
  await navBPromise;

  // Now resolve A late (even though aborted, verifying sequence/slug guard independently of fetch abort handling)
  requests[0].deferred.resolve(
    jsonResponse({
      shop: SHOP_A,
      items: SHOP_A_ITEMS,
      posts: SHOP_A_POSTS,
      ownerPlan: 'premium',
    } satisfies StorefrontDoorBundleResponse)
  );
  await navAPromise;

  const htmlAfterLateA = renderDoorRouteHtml({
    slug: 'aura-spa',
    search: 'lang=en',
    coordinator,
  });
  assert.ok(htmlAfterLateA.includes(SHOP_B.name));
  assertNoShopALeakage(htmlAfterLateA, 'out-of-order A resolving after B 200');
  assert.deepEqual(
    replacedUrls,
    [],
    'stale alias response for A must never trigger router.replace while on B'
  );
  assert.deepEqual(
    doorScans,
    [SHOP_B.id],
    'stale response for A must never record scan_door analytics'
  );
  assert.equal(coordinator.getSnapshot().locale, 'en');

  // Now start a background refresh while on Shop B, navigate to a 404 slug C,
  // resolve C's 404 first, then let B's refresh resolve 200 late.
  const refreshBPromise = coordinator.refresh();
  assert.equal(requests.length, 3);

  const navCPromise = coordinator.navigate({ slug: 'deleted-shop' });
  assert.equal(requests.length, 4);
  assert.equal(requests[2].signal?.aborted, true);

  requests[3].deferred.resolve(jsonResponse({ error: 'Not found' }, 404));
  await navCPromise;

  requests[2].deferred.resolve(
    jsonResponse({
      shop: SHOP_B,
      items: SHOP_B_ITEMS,
      posts: SHOP_B_POSTS,
      ownerPlan: 'premium',
    } satisfies StorefrontDoorBundleResponse)
  );
  await refreshBPromise;

  const htmlAfterLateRefresh = renderDoorRouteHtml({
    slug: 'deleted-shop',
    coordinator,
  });
  assert.ok(htmlAfterLateRefresh.includes(UI_LABELS.en.shopNotFoundTitle));
  assert.ok(htmlAfterLateRefresh.includes('/s/deleted-shop'));
  assert.equal(htmlAfterLateRefresh.includes(SHOP_B.name), false);
});

test('StorefrontDoorPage preserves canonical redirects, refresh state, and a new scan each time a visitor returns to a shop', async () => {
  const fetchCalls: string[] = [];
  const replacedUrls: string[] = [];
  const doorScans: Array<{ shop_id: string; visitor_lang: SupportedLocale }> = [];
  const seenPopups = new Set<string>();
  let currentPosts = SHOP_A_POSTS;

  const coordinator = createStorefrontDoorCoordinator({
    initialSlug: 'pho-hoi-an-legacy',
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.includes('slug=aura-spa')) {
        return jsonResponse({
          shop: SHOP_B,
          items: SHOP_B_ITEMS,
          posts: SHOP_B_POSTS,
          ownerPlan: 'free',
        } satisfies StorefrontDoorBundleResponse);
      }
      return jsonResponse({
        shop: SHOP_A,
        items: SHOP_A_ITEMS,
        posts: currentPosts,
        ownerPlan: 'premium',
      } satisfies StorefrontDoorBundleResponse);
    }) as typeof fetch,
    onReplaceUrl: (url) => {
      replacedUrls.push(url);
    },
    hasSeenWelcomePopup: (shopId) => seenPopups.has(shopId),
    markWelcomePopupSeen: (shopId) => {
      seenPopups.add(shopId);
    },
    trackDoorScan: (payload) => {
      doorScans.push({
        shop_id: payload.shop_id,
        visitor_lang: payload.visitor_lang,
      });
    },
    onError: () => {},
  });

  // 1. Enter via legacy alias with ?src=door&lang=ko&utm_source=qr_standee
  await coordinator.navigate({
    slug: 'pho-hoi-an-legacy',
    searchParams: 'src=door&lang=ko&utm_source=qr_standee',
    langParam: 'ko',
  });

  assert.deepEqual(replacedUrls, [
    '/s/pho-hoi-an?src=door&lang=ko&utm_source=qr_standee',
  ]);
  assert.equal(coordinator.getSnapshot().locale, 'ko');
  assert.equal(coordinator.getSnapshot().isPromoPopupOpen, true);
  assert.deepEqual(doorScans, [{ shop_id: SHOP_A.id, visitor_lang: 'ko' }]);

  // 2. Render both immediately after router.replace updates slug -> "pho-hoi-an"
  //    (before navigate effect) and after navigate effect runs: zero loading flash, zero extra fetch!
  const htmlDuringCanonicalTransition = renderDoorRouteHtml({
    slug: 'pho-hoi-an',
    search: 'src=door&lang=ko&utm_source=qr_standee',
    coordinator,
  });
  assert.ok(htmlDuringCanonicalTransition.includes(SHOP_A.name));
  assert.equal(
    htmlDuringCanonicalTransition.includes(UI_LABELS.ko.loadingShopInfo),
    false
  );

  await coordinator.navigate({
    slug: 'pho-hoi-an',
    searchParams: 'src=door&lang=ko&utm_source=qr_standee',
    langParam: 'ko',
  });
  assert.equal(
    fetchCalls.length,
    1,
    'canonical slug replacement must not refetch /api/shops'
  );
  assert.equal(doorScans.length, 1);

  // 3. Visitor manually switches locale to English and closes welcome popup, then BroadcastChannel refresh fires
  coordinator.setLocale('en');
  coordinator.closePromoPopup();
  assert.equal(seenPopups.has(SHOP_A.id), true);

  currentPosts = [
    ...SHOP_A_POSTS,
    {
      id: 'post-pho-live',
      shop_id: SHOP_A.id,
      title_i18n: {
        vi: 'Mới ra lò: Phở Gà Ta Hội An',
        en: 'Fresh today: Hoi An Free-Range Chicken Pho',
      },
      content_i18n: {
        vi: 'Phục vụ từ 17h tối nay.',
        en: 'Available starting 5 PM tonight.',
      },
      is_pinned: false,
      is_active: true,
      created_at: '2026-10-03T10:00:00.000Z',
    },
  ];

  await coordinator.refresh();

  const htmlAfterRefresh = renderDoorRouteHtml({
    slug: 'pho-hoi-an',
    search: 'src=door&lang=ko&utm_source=qr_standee',
    coordinator,
  });
  assert.ok(
    htmlAfterRefresh.includes('Fresh today: Hoi An Free-Range Chicken Pho'),
    'same-slug refresh must render updated posts in the visitor-selected locale'
  );
  assert.equal(
    coordinator.getSnapshot().locale,
    'en',
    'same-slug BroadcastChannel refresh must not reset visitor-selected locale'
  );
  assert.equal(
    coordinator.getSnapshot().isPromoPopupOpen,
    false,
    'same-slug refresh must not reopen a dismissed welcome popup'
  );
  assert.equal(
    doorScans.length,
    1,
    'same-slug refresh must not re-fire scan_door'
  );

  // 4. Navigating A -> B -> A represents three shop visits, while same-shop refreshes above stay deduplicated.
  await coordinator.navigate({ slug: 'aura-spa' });
  await coordinator.navigate({ slug: 'pho-hoi-an' });
  assert.deepEqual(doorScans, [
    { shop_id: SHOP_A.id, visitor_lang: 'ko' },
    { shop_id: SHOP_B.id, visitor_lang: 'vi' },
    { shop_id: SHOP_A.id, visitor_lang: 'vi' },
  ]);
});

test('StorefrontMenuPage A -> B navigation, B 404/network error, out-of-order catalog + /api/tables responses, and canonical signed table QR redirect', async () => {
  const requests: Array<{
    url: string;
    signal?: AbortSignal | null;
    deferred: Deferred<Response>;
  }> = [];
  const replacedUrls: string[] = [];
  const tableScans: Array<{ shop_id: string; visitor_lang: SupportedLocale }> =
    [];

  const coordinator = createStorefrontMenuCoordinator({
    initialSlug: 'pho-hoi-an-old',
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const deferred = createDeferred<Response>();
      requests.push({
        url: String(input),
        signal: init?.signal,
        deferred,
      });
      return deferred.promise;
    }) as typeof fetch,
    onReplaceUrl: (url) => {
      replacedUrls.push(url);
    },
    hasSeenWelcomePopup: () => false,
    trackTableScan: (payload) => {
      tableScans.push({
        shop_id: payload.shop_id,
        visitor_lang: payload.visitor_lang,
      });
    },
    onError: () => {},
  });

  // 1. Visit printed signed table QR on legacy alias: /s/pho-hoi-an-old/menu?src=table&tableId=tbl-pho-01&sig=valid-hmac&lang=en
  const tableSearch =
    'src=table&tableId=tbl-pho-01&sig=valid-hmac&table=T01&lang=en';
  const navAliasPromise = coordinator.navigate({
    slug: 'pho-hoi-an-old',
    searchParams: tableSearch,
    tableId: 'tbl-pho-01',
    sig: 'valid-hmac',
    table: 'T01',
    langParam: 'en',
    srcParam: 'table',
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    '/api/shops?slug=pho-hoi-an-old&view=menu&tableId=tbl-pho-01&sig=valid-hmac'
  );

  requests[0].deferred.resolve(
    jsonResponse({
      shop: SHOP_A,
      categories: SHOP_A_CATEGORIES,
      items: SHOP_A_ITEMS,
      tables: SHOP_A_TABLES,
      ownerPlan: 'premium',
      tableQrVerified: true,
    } satisfies StorefrontMenuBundleResponse)
  );
  await navAliasPromise;

  assert.deepEqual(replacedUrls, [`/s/pho-hoi-an/menu?${tableSearch}`]);
  assert.deepEqual(tableScans, [{ shop_id: SHOP_A.id, visitor_lang: 'en' }]);

  // Table is locked both before and after canonical slug replacement, with zero loading flash
  const htmlOnOldSlug = renderMenuRouteHtml({
    slug: 'pho-hoi-an-old',
    search: tableSearch,
    coordinator,
  });
  assert.ok(htmlOnOldSlug.includes(SHOP_A.name));
  assert.ok(htmlOnOldSlug.includes('Hoi An Special Beef Pho'));
  assert.ok(htmlOnOldSlug.includes('data-testid="menu-table-locked-bar"'));
  assert.ok(htmlOnOldSlug.includes('Bàn Phố Cổ 01'));

  const htmlOnCanonicalBeforeEffect = renderMenuRouteHtml({
    slug: 'pho-hoi-an',
    search: tableSearch,
    coordinator,
  });
  assert.ok(htmlOnCanonicalBeforeEffect.includes(SHOP_A.name));
  assert.ok(
    htmlOnCanonicalBeforeEffect.includes('data-testid="menu-table-locked-bar"')
  );
  assert.equal(
    htmlOnCanonicalBeforeEffect.includes(UI_LABELS.en.loadingMenu),
    false
  );

  await coordinator.navigate({
    slug: 'pho-hoi-an',
    searchParams: tableSearch,
    tableId: 'tbl-pho-01',
    sig: 'valid-hmac',
    table: 'T01',
    langParam: 'en',
    srcParam: 'table',
  });
  assert.equal(
    requests.length,
    1,
    'canonical menu redirect must not trigger duplicate fetch'
  );
  assert.equal(tableScans.length, 1);

  // 2. Synchronous render frame when navigating from /s/pho-hoi-an/menu -> /s/missing-menu/menu
  const htmlSyncMenuTransition = renderMenuRouteHtml({
    slug: 'missing-menu',
    coordinator,
  });
  assert.ok(htmlSyncMenuTransition.includes(UI_LABELS.en.loadingMenu));
  assertNoShopALeakage(htmlSyncMenuTransition, 'menu synchronous A -> B frame');

  // 3. Target menu slug returns HTTP 404 -> must render menuNotFoundTitle, NEVER stale Shop A menu
  const nav404Promise = coordinator.navigate({ slug: 'missing-menu' });
  assert.equal(requests.length, 2);
  requests[1].deferred.resolve(jsonResponse({ error: 'Shop not found' }, 404));
  await nav404Promise;

  const htmlMenu404 = renderMenuRouteHtml({
    slug: 'missing-menu',
    coordinator,
  });
  assert.ok(htmlMenu404.includes(UI_LABELS.en.menuNotFoundTitle));
  assertNoShopALeakage(htmlMenu404, 'menu A -> B (404)');

  // 4. Out-of-order secondary /api/tables request:
  //    Navigate to pho-hoi-an where /api/shops omits inline `tables` (triggering /api/tables?shopId=...),
  //    then navigate to aura-spa BEFORE /api/tables finishes, resolve aura-spa 200, then fail Shop A's /api/tables.
  const navAWithFallbackTables = coordinator.navigate({ slug: 'pho-hoi-an' });
  assert.equal(requests.length, 3);
  requests[2].deferred.resolve(
    jsonResponse({
      shop: SHOP_A,
      categories: SHOP_A_CATEGORIES,
      items: SHOP_A_ITEMS,
      // omit `tables` so coordinator requests `/api/tables?shopId=shop-pho-a`
      ownerPlan: 'premium',
    } satisfies StorefrontMenuBundleResponse)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 4);
  assert.equal(requests[3].url, `/api/tables?shopId=${SHOP_A.id}`);

  // Navigate to Shop B while Shop A's /api/tables fetch is still pending
  const navMenuBPromise = coordinator.navigate({ slug: 'aura-spa' });
  assert.equal(requests.length, 5);
  assert.equal(requests[3].signal?.aborted, true);

  requests[4].deferred.resolve(
    jsonResponse({
      shop: SHOP_B,
      categories: SHOP_B_CATEGORIES,
      items: SHOP_B_ITEMS,
      tables: [],
      ownerPlan: 'basic',
    } satisfies StorefrontMenuBundleResponse)
  );
  await navMenuBPromise;

  // Late failure from Shop A's /api/tables must not leak tablesLoadError or Shop A state onto Shop B
  requests[3].deferred.resolve(
    jsonResponse({ error: 'Stale tables failure from Shop A' }, 500)
  );
  await navAWithFallbackTables;

  const htmlMenuB = renderMenuRouteHtml({ slug: 'aura-spa', coordinator });
  assert.ok(htmlMenuB.includes(SHOP_B.name));
  assert.ok(htmlMenuB.includes('Massage Đá Nóng Himalaya'));
  assert.equal(htmlMenuB.includes('data-testid="menu-tables-load-error"'), false);
  assert.equal(coordinator.getSnapshot().tablesLoadError, null);
  assertNoShopALeakage(htmlMenuB, 'menu out-of-order /api/tables completion');

  // 5. Same-slug menu refresh updates catalog items while keeping visitor-chosen locale
  coordinator.setLocale('en');
  const refreshMenuB = coordinator.refresh();
  assert.equal(requests.length, 6);
  requests[5].deferred.resolve(
    jsonResponse({
      shop: SHOP_B,
      categories: SHOP_B_CATEGORIES,
      items: [
        ...SHOP_B_ITEMS,
        {
          id: 'item-aura-herbal',
          shop_id: SHOP_B.id,
          category_id: 'cat-aura-massage',
          name_i18n: {
            vi: 'Ngâm Chân Thảo Dược',
            en: 'Herbal Foot Ritual',
          },
          desc_i18n: { vi: '30 phút', en: '30 minutes' },
          price: 190000,
          options_json: [],
          is_available: true,
          is_featured: false,
          view_count: 5,
          sort_order: 2,
        },
      ],
      tables: [],
      ownerPlan: 'basic',
    } satisfies StorefrontMenuBundleResponse)
  );
  await refreshMenuB;

  const htmlMenuBAfterRefresh = renderMenuRouteHtml({
    slug: 'aura-spa',
    coordinator,
  });
  assert.ok(htmlMenuBAfterRefresh.includes('Herbal Foot Ritual'));
  assert.equal(coordinator.getSnapshot().locale, 'en');
  assert.equal(tableScans.length, 1);

  // Re-entering the same QR after visiting a different table QR is a new scan.
  const tableQrParams = {
    searchParams:
      'src=table&tableId=tbl-aura-01&sig=valid-aura-hmac&table=T01&lang=en',
    tableId: 'tbl-aura-01',
    sig: 'valid-aura-hmac',
    table: 'T01',
    langParam: 'en',
    srcParam: 'table',
  };
  const navAuraTable = coordinator.navigate({
    slug: 'aura-spa',
    ...tableQrParams,
  });
  assert.equal(requests.length, 7);
  requests[6].deferred.resolve(
    jsonResponse({
      shop: SHOP_B,
      categories: SHOP_B_CATEGORIES,
      items: SHOP_B_ITEMS,
      tables: [],
      ownerPlan: 'basic',
      tableQrVerified: false,
    } satisfies StorefrontMenuBundleResponse)
  );
  await navAuraTable;

  const navPhoTableAgain = coordinator.navigate({
    slug: 'pho-hoi-an',
    ...{
      ...tableQrParams,
      searchParams:
        'src=table&tableId=tbl-pho-01&sig=valid-pho-hmac&table=T01&lang=en',
      tableId: 'tbl-pho-01',
      sig: 'valid-pho-hmac',
    },
  });
  assert.equal(requests.length, 8);
  requests[7].deferred.resolve(
    jsonResponse({
      shop: SHOP_A,
      categories: SHOP_A_CATEGORIES,
      items: SHOP_A_ITEMS,
      tables: SHOP_A_TABLES,
      ownerPlan: 'premium',
      tableQrVerified: true,
    } satisfies StorefrontMenuBundleResponse)
  );
  await navPhoTableAgain;
  assert.deepEqual(tableScans, [
    { shop_id: SHOP_A.id, visitor_lang: 'en' },
    { shop_id: SHOP_B.id, visitor_lang: 'en' },
    { shop_id: SHOP_A.id, visitor_lang: 'en' },
  ]);
});

test('Door and Menu coordinators recover cleanly after StrictMode/unmount cancelInFlight and render not-found on Menu network rejection', async () => {
  let doorFetchCount = 0;
  const doorCoord = createStorefrontDoorCoordinator({
    initialSlug: 'pho-hoi-an',
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      doorFetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      return jsonResponse({
        shop: SHOP_A,
        items: SHOP_A_ITEMS,
        posts: SHOP_A_POSTS,
        ownerPlan: 'premium',
      } satisfies StorefrontDoorBundleResponse);
    }) as typeof fetch,
    trackDoorScan: () => {},
    onError: () => {},
  });

  // Simulate React StrictMode mount -> effect -> cleanup -> remount effect on same slug
  const firstDoorNav = doorCoord.navigate({ slug: 'pho-hoi-an' });
  doorCoord.cancelInFlight();
  await firstDoorNav;

  await doorCoord.navigate({ slug: 'pho-hoi-an' });
  assert.equal(doorFetchCount, 2);
  assert.ok(
    renderDoorRouteHtml({ slug: 'pho-hoi-an', coordinator: doorCoord }).includes(
      SHOP_A.name
    )
  );

  // Menu StrictMode recovery + subsequent A -> B network failure
  let menuShouldThrowNetwork = false;
  let menuFetchCount = 0;
  const menuCoord = createStorefrontMenuCoordinator({
    initialSlug: 'pho-hoi-an',
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      menuFetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (menuShouldThrowNetwork) {
        throw new TypeError('Network offline');
      }
      return jsonResponse({
        shop: SHOP_A,
        categories: SHOP_A_CATEGORIES,
        items: SHOP_A_ITEMS,
        tables: SHOP_A_TABLES,
        ownerPlan: 'premium',
      } satisfies StorefrontMenuBundleResponse);
    }) as typeof fetch,
    trackTableScan: () => {},
    onError: () => {},
  });

  const firstMenuNav = menuCoord.navigate({ slug: 'pho-hoi-an' });
  menuCoord.cancelInFlight();
  await firstMenuNav;

  await menuCoord.navigate({ slug: 'pho-hoi-an' });
  assert.equal(menuFetchCount, 2);
  assert.ok(
    renderMenuRouteHtml({ slug: 'pho-hoi-an', coordinator: menuCoord }).includes(
      SHOP_A.name
    )
  );

  menuShouldThrowNetwork = true;
  await menuCoord.navigate({ slug: 'offline-menu-target' });
  const htmlMenuOffline = renderMenuRouteHtml({
    slug: 'offline-menu-target',
    coordinator: menuCoord,
  });
  assert.ok(htmlMenuOffline.includes(UI_LABELS.vi.menuNotFoundTitle));
  assertNoShopALeakage(htmlMenuOffline, 'menu A -> B (network failure)');
});
