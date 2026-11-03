import crypto from 'node:crypto';
import { isIP } from 'node:net';

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  maxBuckets?: number;
};

const DEFAULT_MAX_BUCKETS = 5128;
const MAX_OVERFLOW_BUCKETS = 128;
const OVERFLOW_BUCKET_PREFIX = 'overflow:';
const EXACT_BUCKET_PREFIX = 'exact:';

type ActiveRateLimitState = {
  buckets: Map<string, number[]>;
  maxBuckets: number;
  overflowBucketKeys: Set<string>;
  overflowModeUntil: number | null;
};

const activeRateLimitStates = new Set<ActiveRateLimitState>();

/** Clears in-memory limiter state so route-level test cases remain isolated. */
export function resetRequestRateLimitersForTests(): void {
  for (const state of activeRateLimitStates) {
    state.buckets.clear();
    state.overflowBucketKeys.clear();
    state.overflowModeUntil = null;
  }
}

/** Returns bucket cardinalities without exposing keys or request identities. */
export function getRequestRateLimiterBucketCountsForTests(): Array<{
  bucketCount: number;
  maxBuckets: number;
  exactBucketCount: number;
  overflowBucketCount: number;
}> {
  if (process.env.NODE_ENV === 'production') return [];
  return Array.from(
    activeRateLimitStates,
    ({ buckets, maxBuckets, overflowBucketKeys }) => ({
      bucketCount: buckets.size,
      maxBuckets,
      exactBucketCount: buckets.size - overflowBucketKeys.size,
      overflowBucketCount: overflowBucketKeys.size,
    })
  );
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

function createOverflowBucketKey(
  digest: string,
  overflowBucketCount: number,
  salt: Buffer
): string {
  const shard = crypto
    .createHmac('sha256', salt)
    .update(digest)
    .digest()
    .readUInt32BE(0) % overflowBucketCount;
  return `${OVERFLOW_BUCKET_PREFIX}${shard}`;
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
  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 3) {
    throw new RangeError('maxBuckets must be a safe integer of at least three');
  }

  // Reserve a small portion of the hard cap for deterministic overflow shards.
  // Existing exact quotas remain intact when new identities exceed their slots.
  const overflowBucketCount = Math.min(
    MAX_OVERFLOW_BUCKETS,
    Math.max(2, Math.floor(maxBuckets / 40)),
    maxBuckets - 1
  );
  const exactBucketLimit = maxBuckets - overflowBucketCount;
  const state: ActiveRateLimitState = {
    buckets: new Map<string, number[]>(),
    maxBuckets,
    overflowBucketKeys: new Set<string>(),
    overflowModeUntil: null,
  };
  const overflowSalt = crypto.randomBytes(32);
  if (process.env.NODE_ENV !== 'production') activeRateLimitStates.add(state);

  return (key, now = Date.now()) => {
    const digest = hashIdentity(key || 'unknown');
    const { buckets } = state;

    if (
      state.overflowModeUntil !== null &&
      now >= state.overflowModeUntil
    ) {
      for (const bucketKey of state.overflowBucketKeys) {
        buckets.delete(bucketKey);
      }
      state.overflowBucketKeys.clear();
      state.overflowModeUntil = null;
    }

    const exactBucketKey = `${EXACT_BUCKET_PREFIX}${digest}`;
    const existingExact = buckets.get(exactBucketKey);
    let usesOverflow = false;
    let bucketKey = exactBucketKey;

    if (existingExact === undefined) {
      if (state.overflowModeUntil !== null) {
        usesOverflow = true;
      } else {
        if (buckets.size >= exactBucketLimit) {
          pruneExpiredBuckets(buckets, now, windowMs);
        }
        if (buckets.size >= exactBucketLimit) {
          state.overflowModeUntil = now;
          usesOverflow = true;
        }
      }

      if (usesOverflow) {
        bucketKey = createOverflowBucketKey(
          digest,
          overflowBucketCount,
          overflowSalt
        );
      }
    }

    const existing = buckets.get(bucketKey);
    const current = (existing || []).filter(
      (timestamp) => now - timestamp < windowMs
    );
    if (current.length >= maxRequests) {
      buckets.delete(bucketKey);
      buckets.set(bucketKey, current);
      return Math.max(1, Math.ceil((current[0] + windowMs - now) / 1000));
    }

    current.push(now);
    buckets.delete(bucketKey);
    buckets.set(bucketKey, current);
    if (usesOverflow) {
      state.overflowBucketKeys.add(bucketKey);
      state.overflowModeUntil = Math.max(
        state.overflowModeUntil ?? 0,
        now + windowMs
      );
    }
    return null;
  };
}
