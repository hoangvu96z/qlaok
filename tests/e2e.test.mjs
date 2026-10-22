import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const LOCALES = ["vi", "en", "ko", "ja", "zh"];

let cachedAccessToken = null;

async function ensureAccessToken() {
  if (cachedAccessToken) return cachedAccessToken;
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "demo_login" }),
  });
  if (res.ok) {
    const data = await res.json();
    cachedAccessToken = data.accessToken || null;
  }
  return cachedAccessToken;
}

async function fetchJson(path, options = {}) {
  const token =
    options.unauthenticated === true ? null : await ensureAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  return { status: res.status, data };
}

test("1. Health Check API & Live Supabase Connection (/api/health)", async () => {
  const { status, data } = await fetchJson("/api/health");
  assert.equal(status, 200);
  assert.equal(data.status, "ok");
  assert.equal(data.service, "qlaok-backend");
  assert.equal(data.dataSource, "supabase");
  assert.equal(data.environment.supabaseConfigured, true);
  assert.equal(data.environment.supabaseTablesReady, true);
  assert.equal(data.counts.provinces, 34, "Should have all 34 Vietnam provinces");
  assert.ok(data.counts.shops >= 3, "Should have at least 3 seeded demo shops");
  assert.ok(data.counts.categories >= 6, "Should have seeded categories");
  assert.ok(data.counts.items >= 10, "Should have seeded items");
});


test("2. Shops API - List, Storefront Bundle & Patch (/api/shops)", async () => {
  const { status, data } = await fetchJson("/api/shops");
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.shops));
  const slugs = data.shops.map((s) => s.slug);
  assert.ok(slugs.includes("pho-hoi-an"), "Contains fnb demo shop");
  assert.ok(slugs.includes("linh-spa-nail"), "Contains service demo shop");
  assert.ok(slugs.includes("dac-san-mien-trung"), "Contains retail demo shop");

  // Fetch single shop bundle by slug
  const detail = await fetchJson("/api/shops?slug=pho-hoi-an");
  assert.equal(detail.status, 200);
  assert.equal(detail.data.shop.slug, "pho-hoi-an");
  assert.equal(detail.data.shop.vertical, "fnb");
  assert.ok(detail.data.categories.length >= 2);
  assert.ok(detail.data.items.length >= 4);

  // Check 5-language translation (vi, en, ko, ja, zh) on first item
  const firstItem = detail.data.items[0];
  for (const locale of LOCALES) {
    assert.ok(
      firstItem.name_i18n[locale],
      `Item should have ${locale} name_i18n translation`
    );
  }
});

test("3. AI Translation API - 5 Languages (/api/ai/translate)", async () => {
  const { status, data } = await fetchJson("/api/ai/translate", {
    method: "POST",
    body: JSON.stringify({
      vertical: "fnb",
      categoryNameVi: "Cà phê Việt Nam",
      itemNameVi: "Bạc xỉu đá",
      itemDescVi: "Cà phê sữa tươi nhiều sữa đặc thơm béo",
    }),
  });
  assert.equal(status, 200);
  assert.ok(data.name_i18n, "Must return name_i18n");
  assert.ok(data.desc_i18n, "Must return desc_i18n");
  for (const locale of LOCALES) {
    assert.ok(
      typeof data.name_i18n[locale] === "string" &&
        data.name_i18n[locale].length > 0,
      `name_i18n.${locale} must be non-empty`
    );
    assert.ok(
      typeof data.desc_i18n[locale] === "string" &&
        data.desc_i18n[locale].length > 0,
      `desc_i18n.${locale} must be non-empty`
    );
  }
});

test("4. AI Menu OCR Vision API (/api/ai/ocr-menu)", async () => {
  for (const vertical of ["fnb", "service", "retail"]) {
    const { status, data } = await fetchJson("/api/ai/ocr-menu", {
      method: "POST",
      body: JSON.stringify({
        vertical,
        useDemo: true,
      }),
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.categories), `OCR for ${vertical} returns categories`);
    assert.ok(data.categories.length >= 1);
    const firstCat = data.categories[0];
    assert.ok(firstCat.name_i18n.vi);
    assert.ok(firstCat.items.length >= 1);
    for (const locale of LOCALES) {
      assert.ok(
        firstCat.items[0].name_i18n[locale],
        `OCR item for ${vertical} has ${locale} translation`
      );
    }
  }
});

test("5. Catalog CRUD API - Category, Item, Out-of-Stock Toggle & Cleanup (/api/catalog)", async () => {
  // Ensure profile plan is premium so item creation is unrestricted
  await fetchJson("/api/webhooks/payment", {
    method: "POST",
    body: JSON.stringify({ action: "switch_plan_direct", plan: "premium" }),
  });

  const shopId = "shop-fnb-001";

  // 5.1 Create category
  const createCat = await fetchJson("/api/catalog", {
    method: "POST",
    body: JSON.stringify({
      action: "upsert_category",
      category: {
        shop_id: shopId,
        name_i18n: {
          vi: "Menu Thử Nghiệm E2E",
          en: "E2E Test Menu",
          ko: "E2E 테스트 메뉴",
          ja: "E2Eテストメニュー",
          zh: "E2E 测试菜单",
        },
      },
    }),
  });
  assert.equal(createCat.status, 200);
  const categoryId = createCat.data.category.id;
  assert.ok(categoryId);

  // 5.2 Create item
  const createItem = await fetchJson("/api/catalog", {
    method: "POST",
    body: JSON.stringify({
      action: "upsert_item",
      item: {
        shop_id: shopId,
        category_id: categoryId,
        price: 55000,
        name_i18n: {
          vi: "Trà Đào Cam Sả Test",
          en: "Peach Lemongrass Tea Test",
          ko: "복숭아 레몬그라스 티",
          ja: "ピーチレモングラスティー",
          zh: "桃子香茅茶",
        },
        desc_i18n: {
          vi: "Thơm mát giải nhiệt",
          en: "Refreshing iced tea",
          ko: "상큼한 아이스티",
          ja: "爽やかなアイスティー",
          zh: "清爽冰茶",
        },
      },
    }),
  });
  assert.equal(createItem.status, 200);
  const itemId = createItem.data.item.id;
  assert.equal(createItem.data.item.price, 55000);
  assert.equal(createItem.data.item.is_available, true);

  // 5.3 Toggle availability (Out of stock) & update price
  const updateItem = await fetchJson("/api/catalog", {
    method: "POST",
    body: JSON.stringify({
      action: "upsert_item",
      item: {
        id: itemId,
        shop_id: shopId,
        category_id: categoryId,
        is_available: false,
        price: 60000,
      },
    }),
  });
  assert.equal(updateItem.status, 200);
  assert.equal(updateItem.data.item.is_available, false);
  assert.equal(updateItem.data.item.price, 60000);

  // 5.4 Delete item & category
  const delItem = await fetchJson(`/api/catalog?itemId=${itemId}`, {
    method: "DELETE",
  });
  assert.equal(delItem.status, 200);
  assert.equal(delItem.data.deleted, true);

  const delCat = await fetchJson(`/api/catalog?categoryId=${categoryId}`, {
    method: "DELETE",
  });
  assert.equal(delCat.status, 200);
  assert.equal(delCat.data.deleted, true);
});

test("6. Plan Limit Enforcement - Free Tier Max 5 Items Rule", async () => {
  // Switch to free plan
  await fetchJson("/api/webhooks/payment", {
    method: "POST",
    body: JSON.stringify({ action: "switch_plan_direct", plan: "free" }),
  });

  // Attempt to add a 6th+ item to shop-fnb-001 (already has >=5 items)
  const blocked = await fetchJson("/api/catalog", {
    method: "POST",
    body: JSON.stringify({
      action: "upsert_item",
      item: {
        shop_id: "shop-fnb-001",
        category_id: "cat-fnb-1",
        price: 45000,
        name_i18n: { vi: "Món Vượt Giới Hạn Free" },
      },
    }),
  });
  assert.equal(blocked.status, 400, "Free plan should block adding beyond 5 items");
  assert.ok(blocked.data.error);

  // Restore premium plan
  await fetchJson("/api/webhooks/payment", {
    method: "POST",
    body: JSON.stringify({ action: "switch_plan_direct", plan: "premium" }),
  });
});

test("7. Posts CRUD API (/api/posts)", async () => {
  const shopId = "shop-fnb-001";
  const created = await fetchJson("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      shop_id: shopId,
      is_pinned: true,
      is_active: true,
      title_i18n: {
        vi: "Khuyến mãi Test E2E",
        en: "E2E Test Promo",
        ko: "E2E 프로모션",
        ja: "E2Eプロモーション",
        zh: "E2E促销",
      },
      content_i18n: {
        vi: "Giảm 20% toàn menu",
        en: "20% off all items",
      },
    }),
  });
  assert.equal(created.status, 200);
  const postId = created.data.post.id;
  assert.ok(postId);

  const toggled = await fetchJson("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      id: postId,
      shop_id: shopId,
      is_active: false,
    }),
  });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.data.post.is_active, false);

  const deleted = await fetchJson(`/api/posts?postId=${postId}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);
});

test("8. QR Scan Analytics Tracking & Aggregation (/api/analytics/track)", async () => {
  const shopId = "shop-fnb-001";
  const before = await fetchJson(`/api/analytics/track?shopId=${shopId}`);
  assert.equal(before.status, 200);
  const prevTableScans = before.data.scanTableCount;

  const tracked = await fetchJson("/api/analytics/track", {
    method: "POST",
    body: JSON.stringify({
      shop_id: shopId,
      event_type: "scan_table",
      visitor_lang: "ko",
    }),
  });
  assert.equal(tracked.status, 201);
  assert.equal(tracked.data.event.event_type, "scan_table");
  assert.equal(tracked.data.event.visitor_lang, "ko");

  const after = await fetchJson(`/api/analytics/track?shopId=${shopId}`);
  assert.equal(after.status, 200);
  assert.equal(after.data.scanTableCount, prevTableScans + 1);
});

test("9. Payment Order & SePay/PayOS Webhook Auto-Upgrade (/api/webhooks/payment)", async () => {
  // Create pending order
  const orderRes = await fetchJson("/api/webhooks/payment", {
    method: "POST",
    body: JSON.stringify({
      action: "create_order",
      targetPlan: "premium",
      amount: 69000,
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderCode = orderRes.data.transaction.order_code;
  assert.ok(orderCode.startsWith("QLAOKP"));

  // Simulate webhook callback from bank transfer (server must have PAYMENT_WEBHOOK_SECRET configured;
  // there is no hardcoded fallback secret).
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "";
  assert.ok(webhookSecret, "PAYMENT_WEBHOOK_SECRET must be set for the e2e webhook test");
  const webhook = await fetchJson("/api/webhooks/payment", {
    method: "POST",
    headers: { "x-webhook-secret": webhookSecret },
    body: JSON.stringify({
      content: `CHUYEN KHOAN ${orderCode} NANG CAP GOI`,
      referenceCode: "FT2628799999",
    }),
  });
  assert.equal(webhook.status, 200);
  assert.equal(webhook.data.success, true);
  assert.equal(webhook.data.profile.plan, "premium");
});

test("10. All 19 Frontend Routes Render 200 OK with Expected Content", async () => {
  const routes = [
    { path: "/", mustContain: "Qlaok" },
    { path: "/explore", mustContain: "Qlaok Directory" },
    { path: "/pricing", mustContain: "39.000" },
    { path: "/login", mustContain: "Qlaok" },
    { path: "/onboarding", mustContain: "Qlaok" },
    { path: "/dashboard", mustContain: "Qlaok" },
    { path: "/dashboard/orders", mustContain: "Qlaok" },
    { path: "/dashboard/catalog", mustContain: "Qlaok" },
    { path: "/dashboard/ai-scanner", mustContain: "Qlaok" },
    { path: "/dashboard/qr-studio", mustContain: "Qlaok" },
    { path: "/dashboard/posts", mustContain: "Qlaok" },
    { path: "/dashboard/settings", mustContain: "Qlaok" },
    { path: "/dashboard/billing", mustContain: "Qlaok" },
    { path: "/s/pho-hoi-an", mustContain: "Phở" },
    { path: "/s/pho-hoi-an/menu", mustContain: "Phở" },
    { path: "/s/linh-spa-nail", mustContain: "Linh" },
    { path: "/s/linh-spa-nail/menu", mustContain: "Linh" },
    { path: "/s/dac-san-mien-trung", mustContain: "Đặc Sản" },
    { path: "/s/dac-san-mien-trung/menu", mustContain: "Đặc Sản" },
  ];

  for (const r of routes) {
    const res = await fetch(`${BASE_URL}${r.path}`);
    assert.equal(res.status, 200, `Route ${r.path} should return 200 OK`);
    const html = await res.text();
    assert.ok(
      html.includes(r.mustContain),
      `Route ${r.path} HTML must contain "${r.mustContain}"`
    );
  }
});

test("11. PWA Manifest, Icon & Service Worker (/manifest.webmanifest, /icon.svg, /sw.js)", async () => {
  const manifestRes = await fetch(`${BASE_URL}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  const manifest = await manifestRes.json();
  assert.equal(manifest.short_name, "Qlaok CMS");
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.display, "standalone");

  const iconRes = await fetch(`${BASE_URL}/icon.svg`);
  assert.equal(iconRes.status, 200);
  const iconText = await iconRes.text();
  assert.ok(iconText.includes("<svg"));

  const swRes = await fetch(`${BASE_URL}/sw.js`);
  assert.equal(swRes.status, 200);
  const swText = await swRes.text();
  assert.ok(swText.includes("qlaok-pwa-v1"));
});

test("12. Mobile Owner App Direct Supabase Flow (Shops, Provinces, Menu Toggle & Analytics)", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    "https://kftmrjmmympztzztunxf.supabase.co",
    "sb_publishable_BpW2kqz1l3LfN8MFvngWLw_2YxmIgBv"
  );

  const { data: provinces, error: provErr } = await sb
    .from("provinces")
    .select("code, name, region")
    .order("sort_order", { ascending: true });
  assert.equal(provErr, null);
  assert.equal(provinces.length, 34, "Mobile app queries all 34 Vietnam provinces");

  const { data: items, error: itemErr } = await sb
    .from("items")
    .select("id, price, is_available")
    .eq("shop_id", "shop-fnb-001")
    .limit(1);
  assert.equal(itemErr, null);
  assert.equal(items.length, 1);

  const targetItem = items[0];
  const toggledVal = !targetItem.is_available;

  // Toggle availability like mobile Switch
  const { error: toggleErr } = await sb
    .from("items")
    .update({ is_available: toggledVal })
    .eq("id", targetItem.id);
  assert.equal(toggleErr, null);

  // Restore original state
  const { error: restoreErr } = await sb
    .from("items")
    .update({ is_available: targetItem.is_available })
    .eq("id", targetItem.id);
  assert.equal(restoreErr, null);
});

test("13. mPOS Realtime Table Ordering, Inventory Stock Deduction & Revenue Analytics (/api/orders)", async () => {
  const shopId = "shop-fnb-001";

  // 13.1 Check initial stock of item-fnb-1
  const catBefore = await fetchJson(`/api/catalog?shopId=${shopId}`);
  assert.equal(catBefore.status, 200);
  const targetItem = catBefore.data.items.find((i) => i.id === "item-fnb-1");
  assert.ok(targetItem, "Should find item-fnb-1");
  const initialStock = targetItem.stock_quantity;
  assert.equal(typeof initialStock, "number");

  // 13.2 Guest submits a table order for 2x item-fnb-1
  const createOrderRes = await fetchJson("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      shop_id: shopId,
      table_label: "Bàn E2E-09",
      visitor_lang: "ko",
      customer_note: "Ít hành",
      payment_method: "vietqr",
      source: "qr_table",
      items: [
        {
          item_id: "item-fnb-1",
          name_vi: targetItem.name_i18n.vi,
          name_i18n: targetItem.name_i18n,
          quantity: 2,
          unit_price: targetItem.price,
          extra_price: 0,
        },
      ],
    }),
  });
  assert.equal(createOrderRes.status, 201);
  const createdOrder = createOrderRes.data.order;
  assert.equal(createdOrder.status, "new");
  assert.equal(createdOrder.table_label, "Bàn E2E-09");
  assert.equal(createdOrder.total_amount, targetItem.price * 2);

  // 13.3 Verify stock was deducted by 2
  const catAfterOrder = await fetchJson(`/api/catalog?shopId=${shopId}`);
  const itemAfterOrder = catAfterOrder.data.items.find((i) => i.id === "item-fnb-1");
  assert.equal(itemAfterOrder.stock_quantity, Math.max(0, initialStock - 2));

  // 13.4 Counter updates order status: new -> preparing -> completed
  const prepRes = await fetchJson("/api/orders", {
    method: "PATCH",
    body: JSON.stringify({
      shop_id: shopId,
      order_id: createdOrder.id,
      status: "preparing",
    }),
  });
  assert.equal(prepRes.status, 200);
  assert.equal(prepRes.data.order.status, "preparing");

  // 13.5 Cancel the test order to verify automatic stock restoration
  const cancelRes = await fetchJson("/api/orders", {
    method: "PATCH",
    body: JSON.stringify({
      shop_id: shopId,
      order_id: createdOrder.id,
      status: "cancelled",
    }),
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.order.status, "cancelled");

  const catAfterCancel = await fetchJson(`/api/catalog?shopId=${shopId}`);
  const itemAfterCancel = catAfterCancel.data.items.find((i) => i.id === "item-fnb-1");
  assert.equal(itemAfterCancel.stock_quantity, initialStock, "Stock should be restored after order cancellation");

  // 13.6 Verify Revenue & 7-Day Analytics fields in /api/analytics/track
  const analyticsRes = await fetchJson(`/api/analytics/track?shopId=${shopId}`);
  assert.equal(analyticsRes.status, 200);
  assert.equal(typeof analyticsRes.data.todayRevenue, "number");
  assert.equal(typeof analyticsRes.data.totalRevenue, "number");
  assert.ok(Array.isArray(analyticsRes.data.dailyRevenue7d));
  assert.equal(analyticsRes.data.dailyRevenue7d.length, 7);
  assert.ok(Array.isArray(analyticsRes.data.topSellingItems));
});


