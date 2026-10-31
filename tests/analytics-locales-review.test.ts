import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '@/app/api/analytics/track/route';
import { setSupabaseDbClientForTests } from '@/lib/db';

function createAnalyticsTestClient(
  recorded: Array<Record<string, unknown>>,
  rpcError?: (args: Record<string, unknown>) => string | null
) {
  return {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            return {
              async limit() {
                return { data: [{ id: 'qa-shop' }], error: null };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, 'record_analytics_event_atomic');
      const message = rpcError?.(args);
      if (message) return { data: null, error: { message } };
      const event = {
        id: recorded.length + 1,
        shop_id: args.p_shop_id,
        event_type: args.p_event_type,
        item_id: args.p_item_id,
        visitor_lang: args.p_visitor_lang,
        user_agent: args.p_user_agent,
        created_at: '2026-11-01T00:00:00.000Z',
      };
      recorded.push(event);
      return { data: event, error: null };
    },
  };
}

test('analytics accepts each storefront locale and rejects unsupported values', async () => {
  const recorded: Array<Record<string, unknown>> = [];
  const client = createAnalyticsTestClient(recorded);
  setSupabaseDbClientForTests(client);
  try {
    for (const locale of ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru']) {
      const response = await POST(new Request('http://localhost/api/analytics/track', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.40' },
        body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'scan_door', visitor_lang: locale }),
      }));
      assert.equal(response.status, 201, locale);
      assert.equal(recorded.at(-1)?.visitor_lang, locale);
    }
    const invalid = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.40' },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'scan_door', visitor_lang: 'xx' }),
    }));
    assert.equal(invalid.status, 400);
    assert.equal(recorded.length, 8);

    const oversizedAgent = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '198.51.100.40',
        'user-agent': 'x'.repeat(2048),
      },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'scan_door', visitor_lang: 'vi' }),
    }));
    assert.equal(oversizedAgent.status, 201);
    assert.equal(String(recorded.at(-1)?.user_agent).length, 512);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('analytics rate limit is shared across shops and ignores spoofed forwarded-for', async () => {
  const recorded: Array<Record<string, unknown>> = [];
  setSupabaseDbClientForTests(createAnalyticsTestClient(recorded));
  try {
    for (let index = 0; index < 120; index += 1) {
      const response = await POST(new Request('http://localhost/api/analytics/track', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-real-ip': '203.0.113.120',
          'x-forwarded-for': `198.51.100.${(index % 250) + 1}`,
        },
        body: JSON.stringify({
          shop_id: `qa-shop-${index % 3}`,
          event_type: 'scan_door',
          visitor_lang: 'vi',
        }),
      }));
      assert.equal(response.status, 201, `request ${index + 1}`);
    }

    const sameIpDifferentShop = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.120',
        'x-forwarded-for': '192.0.2.88',
      },
      body: JSON.stringify({ shop_id: 'qa-shop-other', event_type: 'scan_door', visitor_lang: 'vi' }),
    }));
    assert.equal(sameIpDifferentShop.status, 429);
    assert.equal(sameIpDifferentShop.headers.get('retry-after') !== null, true);

    const differentIp = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': '203.0.113.121',
        'x-forwarded-for': '192.0.2.88',
      },
      body: JSON.stringify({ shop_id: 'qa-shop-0', event_type: 'scan_door', visitor_lang: 'vi' }),
    }));
    assert.equal(differentIp.status, 201);
    assert.equal(recorded.length, 121);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('analytics maps shop and item validation failures without recording an event', async () => {
  const recorded: Array<Record<string, unknown>> = [];
  const client = createAnalyticsTestClient(recorded, (args) => {
    if (args.p_shop_id === 'unpublished-shop') return 'SHOP_NOT_TRACKABLE';
    if (args.p_item_id === 'cross-shop-item') return 'ITEM_NOT_IN_SHOP';
    return null;
  });
  setSupabaseDbClientForTests(client);
  try {
    const unpublished = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.122' },
      body: JSON.stringify({ shop_id: 'unpublished-shop', event_type: 'scan_door', visitor_lang: 'vi' }),
    }));
    assert.equal(unpublished.status, 404);
    assert.equal((await unpublished.json()).code, 'SHOP_NOT_FOUND');

    const crossShopItem = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.122' },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'item_view', item_id: 'cross-shop-item', visitor_lang: 'vi' }),
    }));
    assert.equal(crossShopItem.status, 400);
    assert.equal((await crossShopItem.json()).code, 'ITEM_NOT_IN_SHOP');
    assert.equal(recorded.length, 0);

    const invalidEvent = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.122' },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'delete_all', visitor_lang: 'vi' }),
    }));
    assert.equal(invalidEvent.status, 400);
    assert.equal(recorded.length, 0);

    const missingItemId = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.122' },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'item_view', visitor_lang: 'vi' }),
    }));
    assert.equal(missingItemId.status, 400);
    assert.equal((await missingItemId.json()).code, 'ITEM_ID_REQUIRED');
    assert.equal(recorded.length, 0);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});
