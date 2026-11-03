import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoundedRateLimiter,
  createClientRateLimitKey,
  createScopedRateLimitKey,
  getRequestRateLimiterBucketCountsForTests,
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

test('bounded limiter prunes expired buckets before using bounded overflow capacity', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 8,
  });

  // Fill all six exact slots; expiring-key has the oldest window start.
  assert.equal(limit('expiring-key', 1_000), null);
  assert.equal(limit('expiring-key', 1_000), null);
  assert.equal(limit('active-oldest', 10_000), null);
  assert.equal(limit('active-oldest', 10_000), null);
  assert.equal(limit('active-newest', 10_000), null);
  assert.equal(limit('active-newest', 10_000), null);
  assert.equal(limit('active-fill', 10_000), null);
  assert.equal(limit('active-fill', 10_000), null);
  assert.equal(limit('active-fill-2', 10_000), null);
  assert.equal(limit('active-fill-2', 10_000), null);
  assert.equal(limit('active-fill-3', 10_000), null);
  assert.equal(limit('active-fill-3', 10_000), null);

  // A rate-limited hit does not extend the sliding window.
  assert.equal(limit('expiring-key', 20_000), 41);

  // At 61_000, pruning frees the naturally expired exact bucket.
  assert.equal(limit('after-expiry', 61_000), null);
  assert.equal(limit('active-oldest', 61_000), 9);
  assert.equal(limit('active-newest', 61_000), 9);

  // Reach the exact cap and start bounded overflow without dropping known quotas.
  assert.equal(limit('after-expiry', 61_000), null);
  assert.equal(limit('after-expiry', 61_000), 60);
  assert.equal(limit('newcomer-d', 61_000), null);

  // Every active exact identity remains limited, even after identity churn.
  for (let index = 0; index < 20; index += 1) {
    limit(`churn-${index}`, 61_001);
  }
  assert.equal(limit('active-newest', 61_000), 9);
  assert.equal(limit('after-expiry', 61_000), 60);
  assert.equal(limit('active-oldest', 61_000), 9);
  assert.ok(
    getRequestRateLimiterBucketCountsForTests().every(
      ({ bucketCount, maxBuckets }) => bucketCount <= maxBuckets
    )
  );
});

test('active identity quota cannot be reset by churn after the exact bucket cap', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    maxBuckets: 4,
  });
  const now = 1_000;

  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-b', now), null);
  assert.equal(limit('known-c', now), null);
  assert.equal(limit('known-a', now), null);
  assert.equal(limit('known-a', now), 60);

  for (let index = 0; index < 100; index += 1) {
    limit(`attacker-${index}`, now + 500);
  }

  // The original active identity never receives a fresh bucket before expiry.
  assert.equal(limit('known-a', now + 500), 60);
  assert.equal(limit('known-a', now + 61_000), null);
  assert.ok(
    getRequestRateLimiterBucketCountsForTests().every(
      ({ bucketCount, maxBuckets }) => bucketCount <= maxBuckets
    )
  );
});

test('overflow identities use independent bounded shards instead of one shared bucket', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    maxBuckets: 12,
  });
  const now = 1_000;

  // Fill exact capacity before the first overflow identity arrives.
  for (let index = 0; index < 10; index += 1) {
    assert.equal(limit(`exact-${index}`, now), null);
  }

  let saturatedShardIdentity: string | null = null;
  for (let index = 0; index < 100; index += 1) {
    const identity = `overflow-first-${index}`;
    if (limit(identity, now) === null) {
      assert.equal(limit(identity, now), 60);
      saturatedShardIdentity = identity;
      break;
    }
  }
  assert.notEqual(saturatedShardIdentity, null);

  let independentShardIdentity: string | null = null;
  for (let index = 0; index < 100; index += 1) {
    const identity = `overflow-second-${index}`;
    if (limit(identity, now) === null) {
      independentShardIdentity = identity;
      break;
    }
  }
  assert.notEqual(independentShardIdentity, null);
  assert.equal(limit(independentShardIdentity!, now), 60);
  assert.equal(limit(saturatedShardIdentity!, now), 60);
  assert.ok(
    getRequestRateLimiterBucketCountsForTests().every(
      ({ bucketCount, maxBuckets }) => bucketCount <= maxBuckets
    )
  );
});

test('overflow mode recovers after its last accepted request expires', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    maxBuckets: 6,
  });

  assert.equal(limit('exact-a', 1_000), null);
  assert.equal(limit('exact-b', 1_000), null);
  assert.equal(limit('exact-c', 1_000), null);
  assert.equal(limit('exact-d', 1_000), null);
  assert.equal(limit('overflow', 1_000), null);
  assert.equal(limit('overflow', 1_000), 60);

  // At the exact window boundary, old exact and overflow entries are expired.
  assert.equal(limit('after-window', 61_000), null);
  assert.equal(limit('after-window', 61_000), 60);
  assert.ok(
    getRequestRateLimiterBucketCountsForTests().every(
      ({ bucketCount, maxBuckets }) => bucketCount <= maxBuckets
    )
  );
});

test('minimum bucket capacity keeps two overflow shards and rejects smaller caps', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    maxBuckets: 3,
  });
  const now = 1_000;

  assert.equal(limit('only-exact', now), null);

  let firstOverflow: string | null = null;
  for (let index = 0; index < 100; index += 1) {
    const identity = `minimum-overflow-first-${index}`;
    if (limit(identity, now) === null) {
      assert.equal(limit(identity, now), 60);
      firstOverflow = identity;
      break;
    }
  }
  assert.notEqual(firstOverflow, null);

  let secondOverflow: string | null = null;
  for (let index = 0; index < 100; index += 1) {
    const identity = `minimum-overflow-second-${index}`;
    if (limit(identity, now) === null) {
      secondOverflow = identity;
      break;
    }
  }
  assert.notEqual(secondOverflow, null);
  assert.equal(limit(secondOverflow!, now), 60);
  assert.equal(limit(firstOverflow!, now), 60);

  assert.throws(
    () => createBoundedRateLimiter({ windowMs: 60_000, maxRequests: 1, maxBuckets: 2 }),
    /at least three/
  );
  assert.ok(
    getRequestRateLimiterBucketCountsForTests().every(
      ({ bucketCount, maxBuckets }) => bucketCount <= maxBuckets
    )
  );
});

test('test reset clears limiter state without changing configured limits', () => {
  const limit = createBoundedRateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    maxBuckets: 4,
  });
  assert.equal(limit('same-key', 1_000), null);
  assert.equal(limit('exact-key-2', 1_000), null);
  assert.equal(limit('overflow-key', 1_000), null);
  assert.equal(limit('overflow-key', 1_000), 60);

  resetRequestRateLimitersForTests();

  assert.equal(limit('same-key', 1_000), null);
  assert.equal(limit('exact-key-2', 1_000), null);
  const resetState = getRequestRateLimiterBucketCountsForTests().at(-1);
  assert.equal(resetState?.exactBucketCount, 2);
  assert.equal(resetState?.overflowBucketCount, 0);
  assert.equal(limit('overflow-key', 1_000), null);
});
