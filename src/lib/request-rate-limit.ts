import crypto from 'node:crypto';
import { isIP } from 'node:net';

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  maxBuckets?: number;
};

const DEFAULT_MAX_BUCKETS = 5000;
const activeBucketMaps = new Set<Map<string, number[]>>();

/** Clears in-memory limiter state so route-level test cases remain isolated. */
export function resetRequestRateLimitersForTests(): void {
  for (const buckets of activeBucketMaps) buckets.clear();
}

function normalizeRateLimitAddress(rawAddress: string | null): string {
  const address = rawAddress?.trim() || '';
  const version = isIP(address);
  if (version === 4) return `ipv4:${address}`;
  if (version !== 6) return 'unknown';

  let expandedAddress = address.toLowerCase();
  const ipv4Suffix = expandedAddress.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Suffix) {
    const octets = ipv4Suffix.split('.').map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    expandedAddress = `${expandedAddress.slice(0, -ipv4Suffix.length)}${high}:${low}`;
  }

  const halves = expandedAddress.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omittedSegmentCount = 8 - left.length - right.length;
  if (
    halves.length > 2 ||
    omittedSegmentCount < (halves.length === 2 ? 1 : 0) ||
    (halves.length === 1 && omittedSegmentCount !== 0)
  ) {
    return 'unknown';
  }

  const segments = [
    ...left,
    ...Array.from({ length: omittedSegmentCount }, () => '0'),
    ...right,
  ].map((segment) => segment.padStart(4, '0'));
  if (
    segments.length !== 8 ||
    segments.some((segment) => !/^[0-9a-f]{4}$/.test(segment))
  ) {
    return 'unknown';
  }

  if (
    segments.slice(0, 5).every((segment) => segment === '0000') &&
    segments[5] === 'ffff'
  ) {
    const octets = [
      parseInt(segments[6].slice(0, 2), 16),
      parseInt(segments[6].slice(2), 16),
      parseInt(segments[7].slice(0, 2), 16),
      parseInt(segments[7].slice(2), 16),
    ];
    return `ipv4:${octets.join('.')}`;
  }

  return `ipv6:${segments.slice(0, 4).join(':')}/64`;
}

function hashIdentity(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Returns an opaque bucket key based on the proxy-supplied client address. */
export function createClientRateLimitKey(req: Request, scope: string): string {
  // Nginx overwrites X-Real-IP from its trusted socket/Cloudflare address.
  // X-Forwarded-For may contain client-supplied values and is intentionally ignored.
  return hashIdentity(`${scope}\0${normalizeRateLimitAddress(req.headers.get('x-real-ip'))}`);
}

/** Returns an opaque shared key for a validated logical scope such as a shop/table. */
export function createScopedRateLimitKey(
  scope: string,
  ...parts: Array<string | null | undefined>
): string {
  return hashIdentity(
    [scope, ...parts.map((part) => (part ?? '').trim().slice(0, 256))].join('\0')
  );
}

function pruneExpiredBuckets(
  buckets: Map<string, number[]>,
  now: number,
  windowMs: number
): void {
  for (const [bucketKey, timestamps] of buckets) {
    const active = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (active.length === 0) buckets.delete(bucketKey);
    else buckets.set(bucketKey, active);
  }
}

/** Creates a bounded, per-process sliding-window limiter. Returns retry delay in seconds. */
export function createBoundedRateLimiter({
  windowMs,
  maxRequests,
  maxBuckets = DEFAULT_MAX_BUCKETS,
}: RateLimitOptions): (key: string, now?: number) => number | null {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new RangeError('windowMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests <= 0) {
    throw new RangeError('maxRequests must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 2) {
    throw new RangeError('maxBuckets must be a safe integer greater than one');
  }

  const buckets = new Map<string, number[]>();
  if (process.env.NODE_ENV !== 'production') activeBucketMaps.add(buckets);
  return (key, now = Date.now()) => {
    const digest = hashIdentity(key || 'unknown');
    const existing = buckets.get(digest);

    if (existing === undefined && buckets.size >= maxBuckets) {
      pruneExpiredBuckets(buckets, now, windowMs);
      if (buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) {
          buckets.delete(oldestKey);
        }
      }
    }

    const current = (existing || []).filter(
      (timestamp) => now - timestamp < windowMs
    );
    if (existing !== undefined) {
      buckets.delete(digest);
    }
    if (current.length >= maxRequests) {
      buckets.set(digest, current);
      return Math.max(1, Math.ceil((current[0] + windowMs - now) / 1000));
    }

    current.push(now);
    buckets.set(digest, current);
    return null;
  };
}
