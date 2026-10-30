import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '@/app/api/health/route';
import { setSupabaseDbClientForTests } from '@/lib/db';
import { issueSessionToken } from '@/lib/server-auth';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-session';

function createHealthDbClient() {
  return {
    from(table: string) {
      return {
        select(columns?: string) {
          if (table === 'shops' && columns === 'id') {
            return {
              limit: async () => ({
                data: [{ id: 'health-test-shop' }],
                error: null,
              }),
            };
          }

          return Promise.resolve({ data: null, error: null, count: 42 });
        },
      };
    },
  };
}

function healthRequest(token?: string): Request {
  return new Request('https://qlaok.test/api/health', {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

test('public health response excludes diagnostics for guests and regular accounts', async () => {
  setSupabaseDbClientForTests(createHealthDbClient());
  try {
    const ownerToken = issueSessionToken({
      id: 'owner-health-test-id',
      email: 'owner@qlaok.test',
      role: 'owner',
    });

    for (const token of [undefined, ownerToken]) {
      const response = await GET(healthRequest(token));
      assert.equal(response.status, 200);

      const body = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), [
        'service',
        'status',
        'timestamp',
      ]);
      assert.equal(body.status, 'ok');
      assert.equal(body.service, 'qlaok-backend');
      assert.equal(typeof body.timestamp, 'string');
    }
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('Super Admin health response retains operational diagnostics', async () => {
  setSupabaseDbClientForTests(createHealthDbClient());
  try {
    const token = issueSessionToken({
      id: 'super-admin-health-test-id',
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const response = await GET(healthRequest(token));
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      dataSource?: string;
      environment?: Record<string, unknown>;
      counts?: Record<string, number>;
    };
    assert.equal(body.dataSource, 'self-hosted-postgres');
    assert.ok(body.environment);
    assert.ok(body.counts);
    assert.deepEqual(Object.keys(body.counts).sort(), [
      'analyticsEvents',
      'categories',
      'items',
      'posts',
      'provinces',
      'shops',
    ]);
    assert.equal(body.counts.shops, 42);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});
