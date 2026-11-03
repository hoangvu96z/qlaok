import {
  createBoundedRateLimiter,
  createClientRateLimitKey,
} from '@/lib/request-rate-limit';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 120;
const RATE_MAX_BUCKETS = 5128;

export function createAnalyticsRateLimiter(): (
  req: Request,
  now?: number
) => number | null {
  const limit = createBoundedRateLimiter({
    windowMs: RATE_WINDOW_MS,
    maxRequests: RATE_MAX_PER_WINDOW,
    maxBuckets: RATE_MAX_BUCKETS,
  });

  return (req, now = Date.now()) =>
    limit(createClientRateLimitKey(req, 'analytics'), now);
}
