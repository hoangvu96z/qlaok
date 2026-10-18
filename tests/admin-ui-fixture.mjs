// Loopback-only UI harness. Proxies the real Next UI; replaces auth/admin HTTP
// responses with disposable fixtures. Never forwards /api requests to production.
import http from 'node:http';
const user = { id: 'fixture-admin', email: 'hoangvu96z@gmail.com', full_name: 'Admin Fixture', role: 'admin', is_admin: true, plan: 'premium' };
const kpis = Object.fromEntries(['totalOwners','estimatedMrr','totalSaasRevenue','pendingTransactionsCount','totalShops','publishedShopsCount','hiddenShopsCount','totalCategories','totalItems','totalPosts','totalOrders','newOrdersCount','preparingOrdersCount','completedOrdersCount','cancelledOrdersCount','globalMposGmv','todayMposGmv','totalQrScans','scanDoorCount','scanTableCount','showToStaffCount','wifiCopyCount','itemViewCount'].map(key => [key, 0]));
Object.assign(kpis, { planBreakdown: { free: 0, basic: 0, premium: 0 }, verticalBreakdown: { fnb: 0, service: 0, retail: 0 }, langBreakdown: [] });
let failNext = true;
let adminReads = 0;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3100');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/fixture/stats') return send({ adminReads });
  if (url.pathname === '/api/auth') {
    let body = ''; for await (const chunk of req) body += chunk;
    if (JSON.parse(body).password !== 'fixture-password') return send({ error: 'Fixture password: fixture-password' }, 401);
    failNext = true;
    return send({ user, accessToken: 'fixture-admin-token' });
  }
  if (url.pathname === '/api/admin') {
    adminReads++;
    if (req.headers.authorization !== 'Bearer fixture-admin-token') return send({ error: 'Fixture session required' }, 401);
    if (failNext) { failNext = false; return send({ error: 'FIXTURE: Không đọc được dữ liệu quản trị. Vui lòng thử lại.' }, 500); }
    if (req.method !== 'GET') return send({ error: 'Fixture is read-only' }, 403);
    return send({ adminProfile: user, kpis, owners: [], shops: [], orders: [], transactions: [], lowStockItems: [], recentEvents: [], systemHealth: { supabaseConnected: true, supabaseUrl: 'http://fixture.invalid', aiGatewayUrl: '', aiTextModel: 'fixture', aiVisionModel: 'fixture', r2Configured: false, tableCounts: {}, serverTime: new Date().toISOString() } });
  }
  if (url.pathname.startsWith('/api/')) return send({ error: 'Unsupported fixture API' }, 404);
  const upstream = http.request({ hostname: '127.0.0.1', port: 3101, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3101' } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Start Next on port 3101'); });
  req.pipe(upstream);
}).listen(3100, '127.0.0.1', () => console.log('Admin UI fixture http://127.0.0.1:3100/admin — password fixture-password; first data request fails, retry succeeds.'));
