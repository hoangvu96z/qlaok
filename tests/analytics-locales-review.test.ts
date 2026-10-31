import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '@/app/api/analytics/track/route';
import { setSupabaseDbClientForTests } from '@/lib/db';

test('analytics accepts each storefront locale and rejects unsupported values', async () => {
  const recorded: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === 'shops') {
        return {
          select() {
            return {
              async limit() { return { data: [{ id: 'qa-shop' }], error: null }; },
              eq() { return { async maybeSingle() { return { data: { id: 'qa-shop', is_published: true }, error: null }; } }; },
            };
          },
        };
      }
      if (table === 'analytics_events') {
        return {
          insert(row: Record<string, unknown>) {
            recorded.push(row);
            return { select() { return { async single() { return { data: row, error: null }; } }; } };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  setSupabaseDbClientForTests(client);
  try {
    for (const locale of ['vi', 'en', 'ko', 'ja', 'zh', 'es', 'it', 'ru']) {
      const response = await POST(new Request('http://localhost/api/analytics/track', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'scan_door', visitor_lang: locale }),
      }));
      assert.equal(response.status, 201, locale);
      assert.equal(recorded.at(-1)?.visitor_lang, locale);
    }
    const invalid = await POST(new Request('http://localhost/api/analytics/track', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shop_id: 'qa-shop', event_type: 'scan_door', visitor_lang: 'xx' }),
    }));
    assert.equal(invalid.status, 400);
    assert.equal(recorded.length, 8);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});
