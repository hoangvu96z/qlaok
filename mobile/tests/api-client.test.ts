import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/lib/api-client.ts';

for (const status of [401, 403, 409, 500]) {
  test(`HTTP ${status} rejects without replaying against production`, async () => {
    const calls: string[] = [];
    const api = createApiClient('http://dev:3000', async () => 'jwt', async (url, init) => {
      calls.push(String(url));
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer jwt');
      assert.equal(init?.method, 'PATCH');
      return Response.json({ error: 'denied' }, { status });
    });
    await assert.rejects(api('/api/orders', { method: 'PATCH' }), /denied/);
    assert.deepEqual(calls, ['http://dev:3000/api/orders']);
  });
}

test('network failure is not retried on another host', async () => {
  let calls = 0;
  const api = createApiClient('http://dev:3000', async () => 'jwt', async () => {
    calls++; throw new Error('offline');
  });
  await assert.rejects(api('/api/orders', { method: 'POST' }), /offline/);
  assert.equal(calls, 1);
});

test('logged-out requests do not reach the network', async () => {
  const api = createApiClient('http://dev:3000', async () => null, async () => {
    assert.fail('must not fetch');
  });
  await assert.rejects(api('/api/orders'), /đăng nhập/);
});

test('reads the current token each time and preserves headers/body/abort signal', async () => {
  let token = 'old';
  const abort = new AbortController();
  const api = createApiClient('http://dev:3000', async () => token, async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), `Bearer ${token}`);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(init?.body, '{}');
    assert.ok(init?.signal);
    assert.equal(init?.signal?.aborted, false);
    return Response.json({ order: { payment_status: 'paid' } });
  });
  const init = { method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: abort.signal };
  await api('/api/orders', init);
  token = 'refreshed';
  const result = await api('/api/orders', init);
  assert.equal((await result.json()).order.payment_status, 'paid');
});

test('non-JSON errors remain errors', async () => {
  const api = createApiClient('http://dev:3000', async () => 'jwt', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(api('/api/orders'), /503/);
});

test('forwards caller cancellation to the network request', async () => {
  const controller = new AbortController();
  const api = createApiClient('http://dev:3000', async () => 'jwt', async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw new Error('aborted');
  });
  controller.abort();
  await assert.rejects(api('/api/orders', { signal: controller.signal }), /aborted/);
});

test('invokes onUnauthorized callback on HTTP 401 only', async () => {
  let signOutCount = 0;
  let nextStatus = 403;
  const api = createApiClient(
    'http://dev:3000',
    async () => 'jwt',
    async () => Response.json({ error: 'auth error' }, { status: nextStatus }),
    async () => {
      signOutCount++;
    }
  );
  await assert.rejects(api('/api/orders'), /auth error/);
  assert.equal(signOutCount, 0);

  nextStatus = 401;
  await assert.rejects(api('/api/orders'), /auth error/);
  assert.equal(signOutCount, 1);
});
