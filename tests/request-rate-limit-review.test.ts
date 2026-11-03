import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundedRateLimiter,
  createClientRateLimitKey,
  createScopedRateLimitKey,
  resetRequestRateLimitersForTests,
} from '@/lib/request-rate-limit';

function request(realIp: string | undefined, forwardedFor = '203.0.113.9') {
  const headers = new Headers({ 'x-forwarded-for': forwardedFor });
  if (realIp !== undefined) headers.set('x-real-ip', realIp);
  return new Request('http://localhost/api/public', { headers });
}

test('bounded limiter enforces its window and reports Retry-After seconds', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
  });

  assert.equal(limit('shop-a', 1_000), null);
  assert.equal(limit('shop-a', 1_000), null);
  assert.equal(limit('shop-a', 1_000), 60);
  assert.equal(limit('shop-a', 2_001), 59);
  assert.equal(limit('shop-a', 61_000), null);
  assert.equal(limit('shop-b', 1_000), null);
});

test('client keys use only normalized x-real-ip and isolate route scopes', () => {
  const first = createClientRateLimitKey(
    request('2001:db8:abcd:1::1', '198.51.100.20'),
    'orders:create'
  );
  const sameNetwork = createClientRateLimitKey(
    request('2001:0db8:abcd:0001::2', '198.51.100.99'),
    'orders:create'
  );
  const otherNetwork = createClientRateLimitKey(
    request('2001:db8:abcd:2::1'),
    'orders:create'
  );
  const otherRoute = createClientRateLimitKey(
    request('2001:db8:abcd:1::1'),
    'orders:quote'
  );

  assert.equal(first, sameNetwork);
  assert.notEqual(first, otherNetwork);
  assert.notEqual(first, otherRoute);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(
    createClientRateLimitKey(request(undefined, '198.51.100.1'), 'orders:create'),
    createClientRateLimitKey(request(undefined, '192.0.2.8'), 'orders:create')
  );
});

test('scoped keys are stable and separate shops and tables', () => {
  assert.equal(
    createScopedRateLimitKey('service-table', 'shop-a', 'T01'),
    createScopedRateLimitKey('service-table', 'shop-a', 'T01')
  );
  assert.notEqual(
    createScopedRateLimitKey('service-table', 'shop-a', 'T01'),
    createScopedRateLimitKey('service-table', 'shop-a', 'T02')
  );
  assert.notEqual(
    createScopedRateLimitKey('service-table', 'shop-a', 'T01'),
    createScopedRateLimitKey('service-table', 'shop-b', 'T01')
  );
});

test('bounded limiter uses overflow bucket without evicting active identities', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 3,
  });
  const now = 1_000;

  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-b', now), null);
  assert.equal(limit('overflow-a', now), null);
  assert.equal(limit('overflow-b', now), null);
  assert.equal(limit('overflow-c', now), 60);
  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-a', now), 60);
  assert.equal(limit('known-c', now + 60_000), null);
});

test('test reset clears limiter state without changing configured limits', () => {
  const limit = createBoundedRateLimiter({ windowMs: 60_000, maxRequests: 1 });
  assert.equal(limit('same-key', 1_000), null);
  assert.equal(limit('same-key', 1_000), 60);

  resetRequestRateLimitersForTests();

  assert.equal(limit('same-key', 1_000), null);
});
