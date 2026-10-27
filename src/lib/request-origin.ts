/**
 * Resolve the public request origin behind the Qlaok reverse proxy.
 * Nginx preserves Host and sets X-Forwarded-Proto; deliberately ignore
 * X-Forwarded-Host so clients cannot choose the redirect host.
 */
export function getRequestOrigin(req: Request): string {
  const requestUrl = new URL(req.url);
  const forwardedProto = (req.headers.get('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const forwardedHost = (req.headers.get('host') || '').trim();

  if (
    (forwardedProto === 'http' || forwardedProto === 'https') &&
    forwardedHost
  ) {
    try {
      return new URL(`${forwardedProto}://${forwardedHost}`).origin;
    } catch {
      return requestUrl.origin;
    }
  }

  return requestUrl.origin;
}
