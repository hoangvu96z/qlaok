import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Run against an isolated local fixture, never credentials from a developer shell.
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key];
const originalCwd = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-api-review-'));
process.chdir(fixture);
after(() => { process.chdir(originalCwd); fs.rmSync(fixture, { recursive: true, force: true }); });
const { issueSessionToken } = await import('@/lib/server-auth');
const { dbUpsertShopMembership } = await import('@/lib/shop-permissions');
const { GET: analyticsGet } = await import('@/app/api/analytics/track/route');
const { POST: shopsPost, PATCH: shopsPatch } = await import('@/app/api/shops/route');
const { POST: ordersPost, PATCH: ordersPatch, GET: ordersGet } = await import('@/app/api/orders/route');
const { dbCreateOrder } = await import('@/lib/mpos-store');
const { escapeHtml } = await import('@/lib/escape-html');

function request(path: string, token: string | null, body: unknown, method = 'PATCH') {
  return new Request(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body) });
}
const token = issueSessionToken({ id: 'review-settings-staff', email: 'review@example.test' });
await dbUpsertShopMembership({ shop_id: 'shop-fnb-001', user_id: 'review-settings-staff', role: 'staff',
  permissions: ['settings.manage', 'members.manage', 'payment.collect'] });

test('anonymous analytics cannot bypass report authorization by omitting token', async () => {
  const response = await analyticsGet(new Request('http://localhost/api/analytics/track?shopId=shop-fnb-001'));
  assert.equal(response.status, 401);
});

for (const bankKey of ['paymentQr', 'paymentConfig']) {
  test(`settings.manage does not authorize bank changes through ${bankKey}`, async () => {
    const response = await shopsPatch(request('/api/shops', token, { id: 'shop-fnb-001',
      theme_config: { [bankKey]: { accountNumber: 'attacker-account' } } }));
    assert.equal(response.status, 403);
  });
}

test('appearance edits do not bypass promotion permission', async () => {
  const response = await shopsPatch(request('/api/shops', token, { id: 'shop-fnb-001', theme_config: {
    primaryColor: '#123456', promoBanner: { enabled: true, title: 'sale', discountValue: 100 },
  } }));
  assert.equal(response.status, 403);
});

test('delegated members.manage cannot promote the caller to owner', async () => {
  const response = await shopsPost(request('/api/shops', token, { action: 'upsert_member',
    shop_id: 'shop-fnb-001', user_id: 'review-settings-staff', role: 'owner' }, 'POST'));
  assert.equal(response.status, 403);
});

test('combined payment and fulfillment patches require both permissions', async () => {
  const order = await dbCreateOrder({ shop_id: 'shop-fnb-001', table_label: 'review', items: [{
    item_id: 'unit-test-item-review', name_vi: 'fixture', quantity: 1, unit_price: 10000, extra_price: 0, selected_choices: [],
  }] });
  const response = await ordersPatch(request('/api/orders', token, {
    orderId: order.id, payment_status: 'paid', status: 'completed',
  }));
  assert.equal(response.status, 403);
});

test('order tracking requires a token even for legacy orders', async () => {
  const response = await ordersGet(new Request('http://localhost/api/orders?orderId=ord-seed-101'));
  assert.equal(response.status, 403);
});

test('unknown ticket types are rejected before a print counter mutation', async () => {
  const response = await ordersPost(request('/api/orders', token, {
    action: 'record_print', orderId: 'ord-seed-101', ticketType: 'arbitrary',
  }, 'POST'));
  assert.equal(response.status, 400);
});

test('receipt text escapes user-controlled markup and quoted attributes', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("A&B's"), 'A&amp;B&#39;s');
});


test('checkout rejects stale displayed totals before creating or collecting payment', async () => {
  const response = await ordersPost(request('/api/orders', null, {
    shop_id: 'shop-fnb-001', expected_total: 1,
    items: [{ item_id: 'item-fnb-1', name_vi: 'Phở', quantity: 1, unit_price: 1, extra_price: 0, selected_choices: [] }],
  }, 'POST'));
  assert.equal(response.status, 409);
});
