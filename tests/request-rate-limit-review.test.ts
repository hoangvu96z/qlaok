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

test('bounded limiter prunes expired buckets first and evicts least-recently-used entry at hard cap', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 3,
  });

  // Fill all 3 buckets; expiring-key has oldest window start (1_000)
  assert.equal(limit('expiring-key', 1_000), null);
  assert.equal(limit('expiring-key', 1_000), null);
  assert.equal(limit('active-oldest', 10_000), null);
  assert.equal(limit('active-oldest', 10_000), null);
  assert.equal(limit('active-newest', 10_000), null);
  assert.equal(limit('active-newest', 10_000), null);

  // Refresh expiring-key recency via a rate-limited hit so active-oldest becomes LRU
  assert.equal(limit('expiring-key', 20_000), 41);

  // At 61_000, expiring-key has expired; pruning frees a slot without evicting active-oldest
  assert.equal(limit('after-expiry', 61_000), null);
  assert.equal(limit('active-oldest', 61_000), 9);
  assert.equal(limit('active-newest', 61_000), 9);

  // Current recency order after the two checks above: [after-expiry, active-oldest, active-newest].
  // Repeated after-expiry hits keep it recent, so newcomer-d evicts active-oldest.
  assert.equal(limit('after-expiry', 61_000), null);
  assert.equal(limit('after-expiry', 61_000), 60);
  // Recency order is now: [active-oldest, active-newest, after-expiry].
  assert.equal(limit('newcomer-d', 61_000), null);

  // active-newest and after-expiry remain rate-limited, while evicted active-oldest regains a fresh bucket (LRU tradeoff)
  assert.equal(limit('active-newest', 61_000), 9);
  assert.equal(limit('after-expiry', 61_000), 60);
  assert.equal(limit('active-oldest', 61_000), null);
});

test('saturated overflow identity cannot reject distinct newcomers while recently active known keys stay limited', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 3,
  });
  const now = 1_000;

  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-b', now), null);
  assert.equal(limit('known-c', now), null);

  // Saturate known-a and verify its recency is refreshed even when rate-limited
  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-a', now), 60);

  // One noisy newcomer beyond maxBuckets saturates its own bucket
  assert.equal(limit('noisy-overflow', now), null);
  assert.equal(limit('noisy-overflow', now), null);
  assert.equal(limit('noisy-overflow', now), 60);

  // Refresh known-a via rate-limited hit so it stays MRU ahead of noisy-overflow
  assert.equal(limit('known-a', now + 500), 60);

  // Distinct unseen newcomers must not suffer collateral 429s from noisy-overflow
  assert.equal(limit('newcomer-1', now + 500), null);
  assert.equal(limit('known-a', now + 500), 60);
  assert.equal(limit('newcomer-2', now + 500), null);

  // Recently active known-a remains rate-limited until its window expires
  assert.equal(limit('known-a', now + 500), 60);
  assert.equal(limit('known-a', now + 60_000), null);
});

test('test reset clears limiter state without changing configured limits', () => {
  const limit = createBoundedRateLimiter({ windowMs: 60_000, maxRequests: 1 });
  assert.equal(limit('same-key', 1_000), null);
  assert.equal(limit('same-key', 1_000), 60);

  resetRequestRateLimitersForTests();

  assert.equal(limit('same-key', 1_000), null);
});
