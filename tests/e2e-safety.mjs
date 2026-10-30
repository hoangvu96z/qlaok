const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function resolveE2eBaseUrl(rawUrl = 'http://localhost:3000') {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('TEST_BASE_URL must be a valid loopback HTTP origin');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'E2E tests may only target a loopback HTTP origin without credentials or a URL path'
    );
  }

  return url.origin;
}

export function canRunMutatingE2e(env = process.env) {
  return (
    env.E2E_ALLOW_MUTATIONS === '1' &&
    env.E2E_DISPOSABLE_DATABASE === '1'
  );
}
