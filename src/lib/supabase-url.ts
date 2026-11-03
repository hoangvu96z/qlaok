function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true;
  }

  const octets = host.split('.').map((part) => Number(part));
  return (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    octets[0] === 127
  );
}

/**
 * Validates the Supabase/PostgREST base URL before an SDK client can send a
 * request. Production and public builds require HTTPS; local HTTP is limited
 * to loopback hosts in development and tests.
 */
export function resolveSupabaseApiUrl(
  rawUrl: string,
  allowLocalHttp = process.env.NODE_ENV !== 'production'
): string {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTPS URL; local HTTP loopback is allowed only outside production.'
    );
  }

  const validHost = Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  const validPath = !parsed.search && !parsed.hash;
  const secureTransport = parsed.protocol === 'https:';
  const allowedLocalTransport =
    allowLocalHttp &&
    parsed.protocol === 'http:' &&
    isLoopbackHostname(parsed.hostname);

  if (!validHost || !validPath || (!secureTransport && !allowedLocalTransport)) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTPS URL; local HTTP loopback is allowed only outside production.'
    );
  }

  return value.replace(/\/+$/, '');
}
