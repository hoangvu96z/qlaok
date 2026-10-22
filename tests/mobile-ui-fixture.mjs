// Disposable, loopback-only UI fixture. Never connects to Supabase or production.
// Start Expo with EXPO_PUBLIC_API_URL and EXPO_PUBLIC_SUPABASE_URL set to http://127.0.0.1:8090.
import http from 'node:http';
const ids = { owner: '00000000-0000-0000-0000-000000000001', cashier: '00000000-0000-0000-0000-000000000002', staff: '00000000-0000-0000-0000-000000000003' };
const permissions = { staff: ['orders.view', 'orders.create', 'orders.fulfill', 'orders.print_kitchen', 'catalog.view'], cashier: ['orders.view', 'orders.create', 'orders.fulfill', 'orders.edit_items', 'orders.cancel_unpaid', 'orders.print_kitchen', 'orders.print_provisional', 'payment.collect', 'discount.apply', 'catalog.view'], owner: ['orders.view', 'orders.create', 'orders.fulfill', 'orders.edit_items', 'orders.cancel_unpaid', 'orders.print_kitchen', 'orders.print_provisional', 'payment.collect', 'discount.apply', 'payment.refund', 'catalog.view', 'catalog.manage', 'settings.manage', 'settings.bank', 'promotions.manage', 'reports.view', 'members.manage'] };
const shops = ['a', 'b'].map((suffix) => ({ id: `fixture-${suffix}`, owner_id: ids.owner, slug: `fixture-${suffix}`, name: `Quán Test ${suffix.toUpperCase()}`, city: 'Đà Nẵng', vertical: 'fnb', supported_langs: ['vi'], is_published: true, theme_config: suffix === 'a' ? { primaryColor: '#10b981', promoBanner: { enabled: true, title: 'Ưu đãi riêng quán A', discountType: 'percent', discountValue: 10 } } : {} }));
let role = 'owner', firstPaymentFails = true, orders = [];
const item = (shopId) => ({ id: `item-${shopId}`, shop_id: shopId, category_id: `cat-${shopId}`, sort_order: 1, price: 65000, stock_quantity: 10, sold_count: 0, name_i18n: { vi: 'Phở bò test', en: 'Test beef noodles' }, desc_i18n: {}, is_available: true, is_featured: false, view_count: 0 });
const reset = () => { orders = shops.map((shop) => ({ id: `order-${shop.id}`, shop_id: shop.id, order_code: shop.id === 'fixture-a' ? 'TEST-A' : 'TEST-B', table_label: 'Bàn 01', visitor_lang: 'vi', status: 'new', payment_method: 'cash', payment_status: 'unpaid', subtotal_amount: 65000, discount_amount: 0, total_amount: 65000, bill_version: 1, items: [{ item_id: item(shop.id).id, name_vi: 'Phở bò test', quantity: 1, unit_price: 65000, extra_price: 0, selected_choices: [] }], source: 'qr_table', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })); firstPaymentFails = true; };
reset();
const membership = (shop_id) => ({ id: `mem-${shop_id}`, shop_id, user_id: ids[role], role, permissions: permissions[role], is_active: true });
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1:8090');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); console.log(`${req.method} ${url.pathname} -> ${status}`); };
  let body = '';
  for await (const chunk of req) body += chunk;
  body = body ? JSON.parse(body) : {};
  if (url.pathname === '/auth/v1/token') {
    const selected = Object.keys(ids).find((value) => body.email === `${value}@fixture.test`);
    if (!selected || body.password !== 'fixture-password') return send({ error: 'invalid_grant', error_description: 'Email hoặc mật khẩu không đúng (fixture)' }, 400);
    role = selected; reset();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: ids[role], email: body.email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
    const access_token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 })).toString('base64url'), 'fixture-signature'].join('.');
    return send({ user, access_token, token_type: 'bearer', refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: exp });
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204).end(); return; }
  if (url.pathname === '/api/shops') return send({ shops, memberships: Object.fromEntries(shops.map((shop) => [shop.id, membership(shop.id)])) });
  const shopId = url.searchParams.get('shopId') || url.searchParams.get('shop_id')?.replace('eq.', '') || 'fixture-a';
  if (url.pathname === '/api/orders' && req.method === 'GET') {
    const shopOrders = orders.filter((order) => order.shop_id === shopId);
    const validOrders = shopOrders.filter((order) => order.status !== 'cancelled');
    const paidOrders = validOrders.filter((order) => order.payment_status === 'paid');
    const paidRevenue = paidOrders.reduce((sum, order) => sum + order.total_amount, 0);
    const canReports = permissions[role].includes('reports.view');
    const vnDate = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    return send({
      orders: shopOrders,
      items: [item(shopId)],
      membership: membership(shopId),
      stats: {
        todayRevenue: canReports ? paidRevenue : null,
        totalRevenue: canReports ? paidRevenue : null,
        paidOrdersCount: canReports ? paidOrders.length : null,
        todayPaidOrdersCount: canReports ? paidOrders.length : null,
        todayOrdersCount: validOrders.length,
        totalOrdersCount: validOrders.length,
        newOrdersCount: shopOrders.filter((order) => order.status === 'new').length,
        preparingOrdersCount: shopOrders.filter((order) => order.status === 'preparing').length,
        dailyRevenue7d: canReports ? [{ date: vnDate, label: vnDate.slice(8, 10), revenue: paidRevenue, ordersCount: validOrders.length }] : [],
      },
    });
  }
  if (url.pathname === '/api/orders' && req.method === 'PATCH') {
    const order = orders.find((order) => order.id === body.orderId);
    if (!order) return send({ error: 'Order not found' }, 404);
    if (body.payment_status === 'paid' && (!permissions[role].includes('payment.collect') || firstPaymentFails)) {
      firstPaymentFails = false; return send({ error: 'Không thể thu tiền: API từ chối thử nghiệm (403)' }, 403);
    }
    Object.assign(order, { ...(body.status ? { status: body.status } : {}), ...(body.payment_status ? { payment_status: body.payment_status } : {}) });
    return send({ order });
  }
  if (url.pathname === '/rest/v1/categories') return send([{ id: `cat-${shopId}`, shop_id: shopId, name_i18n: { vi: 'Món chính' }, is_active: true, sort_order: 1 }]);
  if (url.pathname === '/rest/v1/items') return send([item(shopId)]);
  if (url.pathname === '/rest/v1/analytics_events') return send([]);
  if (url.pathname === '/rest/v1/shops') return send(shops);
  return send({ error: 'Unsupported fixture route' }, 404);
});
server.listen(8090, '127.0.0.1', () => console.log('Mobile UI fixture: http://127.0.0.1:8090 (owner/cashier/staff@fixture.test, password fixture-password)'));
