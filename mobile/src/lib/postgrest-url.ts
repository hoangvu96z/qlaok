import { isLoopbackOrPrivateHost } from './api-base-url.ts';

/**
 * Normalizes a configured self-hosted PostgREST URL and rejects insecure or
 * malformed endpoints before the Supabase SDK is constructed.
 */
export function normalizeSelfHostedPostgrestUrl(
  rawUrl: string,
  allowDevelopmentHttp: boolean
): string | null {
  const candidate = rawUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  if (parsed.protocol === 'https:') return candidate;
  if (
    allowDevelopmentHttp &&
    parsed.protocol === 'http:' &&
    isLoopbackOrPrivateHost(parsed.hostname)
  ) {
    return candidate;
  }

  return null;
}
