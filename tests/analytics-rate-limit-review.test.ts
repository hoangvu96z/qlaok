import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalyticsRateLimiter } from '@/lib/analytics-rate-limit';
import { getRequestRateLimiterBucketCountsForTests } from '@/lib/request-rate-limit';

function requestFrom(realIp: string, forwardedFor = '192.0.2.1'): Request {
  return new Request('http://localhost/api/analytics/track', {
    headers: {
      'x-real-ip': realIp,
      'x-forwarded-for': forwardedFor,
    },
  });
}

test('analytics limiter groups IPv6 /64 addresses and IPv4-mapped equivalents', () => {
  const ipv6Limiter = createAnalyticsRateLimiter();
  for (let index = 1; index <= 120; index += 1) {
    assert.equal(
      ipv6Limiter(requestFrom(`2001:db8:abcd:1::${index.toString(16)}`), 1000),
      null
    );
  }
  assert.equal(
    ipv6Limiter(requestFrom('2001:0db8:abcd:0001:ffff::1'), 1000),
    60
  );
  assert.equal(ipv6Limiter(requestFrom('2001:db8:abcd:2::1'), 1000), null);

  const mappedLimiter = createAnalyticsRateLimiter();
  for (let index = 0; index < 120; index += 1) {
    assert.equal(mappedLimiter(requestFrom('192.0.2.44'), 2000), null);
  }
  assert.equal(mappedLimiter(requestFrom('::ffff:c000:22c'), 2000), 60);
});

test('analytics limiter preserves per-IP quotas and does not reject newcomers at capacity', () => {
  const limiter = createAnalyticsRateLimiter();
  const now = 3000;

  for (let index = 0; index < 4999; index += 1) {
    const secondOctet = Math.floor(index / 254);
    const thirdOctet = (index % 254) + 1;
    const result = limiter(
      requestFrom(`198.18.${secondOctet}.${thirdOctet}`),
      now
    );
    assert.equal(result, null, `initial IP ${index + 1}`);
  }

  for (let index = 0; index < 120; index += 1) {
    assert.equal(
      limiter(requestFrom('198.18.20.1'), now),
      null,
      `allowed request ${index + 1}`
    );
  }
  assert.equal(limiter(requestFrom('198.18.20.1'), now), 60);

  // A distinct client still gets its own quota even when the previous client is saturated.
  for (let index = 0; index < 120; index += 1) {
    assert.equal(limiter(requestFrom('198.18.21.1'), now), null);
  }
  assert.equal(limiter(requestFrom('198.18.21.1'), now), 60);

  // Previously known exact identities retain their own active quota.
  assert.equal(limiter(requestFrom('198.18.0.1'), now), null);
  assert.equal(limiter(requestFrom('198.18.20.1'), now), 60);

  const state = getRequestRateLimiterBucketCountsForTests().at(-1);
  assert.equal(state?.maxBuckets, 5128);
  assert.equal(state?.exactBucketCount, 5000);
  assert.equal(state?.overflowBucketCount, 1);
});
