import crypto from 'node:crypto';
import { isIP } from 'node:net';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 120;
const RATE_MAX_BUCKETS = 5000;
const OVERFLOW_BUCKET_KEY = '__analytics_rate_overflow__';

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

function pruneExpiredBuckets(
  buckets: Map<string, number[]>,
  now: number
): void {
  for (const [bucketKey, timestamps] of buckets) {
    const active = timestamps.filter(
      (timestamp) => now - timestamp < RATE_WINDOW_MS
    );
    if (active.length === 0) buckets.delete(bucketKey);
    else buckets.set(bucketKey, active);
  }
}

export function createAnalyticsRateLimiter(): (
  req: Request,
  now?: number
) => number | null {
  const buckets = new Map<string, number[]>();

  return (req, now = Date.now()) => {
    // Nginx overwrites X-Real-IP from its trusted socket/Cloudflare address.
    // X-Forwarded-For can contain client-supplied values and is intentionally ignored.
    const address = normalizeRateLimitAddress(req.headers.get('x-real-ip'));
    let bucketKey = crypto
      .createHash('sha256')
      .update(address)
      .digest('hex');

    if (!buckets.has(bucketKey) && buckets.size >= RATE_MAX_BUCKETS - 1) {
      const overflowEvents = buckets.get(OVERFLOW_BUCKET_KEY) || [];
      const activeOverflowEvents = overflowEvents.filter(
        (timestamp) => now - timestamp < RATE_WINDOW_MS
      );
      if (activeOverflowEvents.length > 0) {
        buckets.set(OVERFLOW_BUCKET_KEY, activeOverflowEvents);
        bucketKey = OVERFLOW_BUCKET_KEY;
      } else {
        if (buckets.has(OVERFLOW_BUCKET_KEY)) {
          buckets.delete(OVERFLOW_BUCKET_KEY);
        }
        pruneExpiredBuckets(buckets, now);
        if (!buckets.has(bucketKey) && buckets.size >= RATE_MAX_BUCKETS - 1) {
          // Reserve one shared bucket instead of evicting active IP buckets.
          bucketKey = OVERFLOW_BUCKET_KEY;
        }
      }
    }

    const current = (buckets.get(bucketKey) || []).filter(
      (timestamp) => now - timestamp < RATE_WINDOW_MS
    );
    if (current.length >= RATE_MAX_PER_WINDOW) {
      buckets.set(bucketKey, current);
      return Math.max(
        1,
        Math.ceil((current[0] + RATE_WINDOW_MS - now) / 1000)
      );
    }

    current.push(now);
    buckets.set(bucketKey, current);
    return null;
  };
}
