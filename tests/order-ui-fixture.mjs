// Loopback UI harness: real Next UI on 3101, disposable mock APIs on 3102.
import http from 'node:http';
const profile = { id: 'fixture-owner', email: 'owner@fixture.test', full_name: 'Owner Fixture', role: 'owner', plan: 'premium' };
const shop = { id: 'fixture-shop', owner_id: profile.id, slug: 'fixture', name: 'Quán Realtime Test', vertical: 'fnb', currency: 'VND', city: 'Đà Nẵng', is_published: true, supported_langs: ['vi','en'], theme_config: {}, wifi_info: {} };
Object.assign(shop, { tagline_i18n: { vi: 'Quán dùng để kiểm thử' }, description_i18n: { vi: '' }, logo_url: null, cover_urls: [], address: 'Địa chỉ kiểm thử', google_maps_url: null, google_review_url: null, phone_contact: null, zalo_phone: null, opening_hours: Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(day => [day, { open: '08:00', close: '22:00', closed: false }])) });
const membership = { shop_id: shop.id, user_id: profile.id, role: 'owner', is_active: true, permissions: ['orders.view','orders.create','orders.fulfill','orders.cancel_unpaid','payment.collect','payment.refund','reports.view','catalog.manage'] };
const items = [{ id: 'fixture-item', shop_id: shop.id, category_id: 'fixture-cat', name_i18n: { vi: 'Phở realtime' }, price: 65000, is_available: true, sort_order: 1 }];
const categories = [{ id: 'fixture-cat', shop_id: shop.id, name_i18n: { vi: 'Món chính' }, is_active: true, sort_order: 1 }];
let orders = [];
let catalogReads = 0;
let orderReads = 0;
const streams = new Set();
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3102');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/fixture/stats' && req.method === 'GET') return send({ catalogReads, orderReads, streams: streams.size });
  if (url.pathname === '/fixture') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<h1>Realtime UI fixture</h1><p>Catalog reads: ${catalogReads}; Order reads: ${orderReads}; Streams: ${streams.size}</p><form method="post" action="/fixture/order"><button>Thêm đơn thử</button></form>`);
  }
  if (url.pathname === '/fixture/order' && req.method === 'POST') {
    const id = 'fixture-order-' + (orders.length + 1);
    orders.push({ id, shop_id: shop.id, order_code: 'LIVE-' + (orders.length + 1), table_label: 'Bàn 01', visitor_lang: 'vi', payment_method: 'cash', payment_status: 'unpaid', status: 'new', total_amount: 65000, subtotal_amount: 65000, discount_amount: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), items: [{ item_id: items[0].id, name_vi: 'Phở realtime', quantity: 1, unit_price: 65000, extra_price: 0 }] });
    for (const stream of streams) stream.write('data: {"type":"change"}\n\n');
    res.writeHead(303, { Location: '/fixture' }); return res.end();
  }
  if (url.pathname === '/api/auth') {
    let text = ''; for await (const part of req) text += part;
    const body = JSON.parse(text);
    if (body.action === 'logout') {
      res.setHeader('Set-Cookie', 'qlaok_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
      return send({ success: true });
    }
    if (body.password !== 'fixture-password') return send({ error: 'Fixture password: fixture-password' }, 401);
    res.setHeader('Set-Cookie', 'qlaok_session=fixture-owner-token; HttpOnly; Path=/; SameSite=Lax');
    return send({ user: profile, shops: [shop], isAdmin: false, accessToken: 'fixture-owner-token' });
  }
  if (url.pathname.startsWith('/api/')) {
    // Read-only local data for reviewing all management routes; never proxy APIs.
    if (url.pathname === '/api/catalog' && req.method === 'GET') { catalogReads++; return send({ shop, items, categories, profile }); }
    if (url.pathname === '/api/shops' && req.method === 'GET' && !req.headers.authorization) return send({ shops: [shop] });
    if (url.pathname === '/api/analytics/track' && req.method === 'GET') return send({ scanDoorCount: 0, scanTableCount: 0, showToStaffCount: 0, wifiCopyCount: 0, totalScans: 0, langBreakdown: [], topItems: [], todayRevenue: 0, totalRevenue: 0, todayOrdersCount: orders.length, totalOrdersCount: orders.length, newOrdersCount: orders.length, preparingOrdersCount: 0, completedOrdersCount: 0, avgOrderValue: 0, lowStockCount: 0, outOfStockCount: 0, dailyRevenue7d: [], topSellingItems: [] });
    if (req.headers.authorization !== 'Bearer fixture-owner-token' && !/(?:^|;\s*)qlaok_session=fixture-owner-token(?:;|$)/.test(req.headers.cookie || '')) return send({ error: 'Fixture session required' }, 401);
    if (url.pathname === '/api/posts' && req.method === 'GET') return send({ posts: [] });
    if (url.pathname === '/api/webhooks/payment' && req.method === 'GET') return send({ profile, transactions: [] });
    if (url.pathname === '/api/orders/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: {"type":"ready"}\n\n'); streams.add(res);
      res.on('close', () => streams.delete(res)); return;
    }
    if (url.pathname === '/api/shops') return send({ shops: [shop], profile, memberships: { [shop.id]: membership } });
    if (url.pathname === '/api/orders') { orderReads++; return send({ orders, items, membership, stats: {} }); }
    return send({ error: 'Unsupported fixture route' }, 404);
  }
  const proxy = http.request({ hostname: '127.0.0.1', port: 3101, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3101' } }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
  proxy.on('error', () => { res.writeHead(502); res.end('Start Next on 3101'); }); req.pipe(proxy);
}).listen(3102, '127.0.0.1', () => console.log('Order UI fixture http://127.0.0.1:3102/login — owner@fixture.test / fixture-password. Controls: /fixture'));
