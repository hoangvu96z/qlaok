export interface ResolveMobileApiBaseUrlOptions {
  envUrl?: string | null;
  isDev: boolean;
  platform: string;
  metroHostIp?: string | null;
  productionApiUrl: string;
}

function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd')) return true;

  const octets = host.split('.').map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

function validateApiBaseUrl(rawUrl: string, allowPrivateHttp: boolean): string | null {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname || url.username || url.password) return null;
    if (url.protocol === 'https:') return rawUrl.replace(/\/+$/, '');
    if (
      allowPrivateHttp &&
      url.protocol === 'http:' &&
      isLoopbackOrPrivateHost(url.hostname)
    ) {
      return rawUrl.replace(/\/+$/, '');
    }
  } catch {
    // Fall back to the environment-appropriate default for malformed values.
  }
  return null;
}

export function resolveMobileApiBaseUrl({
  envUrl,
  isDev,
  platform,
  metroHostIp,
  productionApiUrl,
}: ResolveMobileApiBaseUrlOptions): string {
  const developmentFallback = () => {
    if (metroHostIp && isLoopbackOrPrivateHost(metroHostIp)) {
      return `http://${metroHostIp}:3000`;
    }
    if (platform === 'android') return 'http://10.0.2.2:3000';
    return 'http://localhost:3000';
  };

  if (envUrl?.trim()) {
    let candidate = envUrl.trim();
    if (isDev) {
      const isLocalhostEnv = /localhost|127\.0\.0\.1|\[::1\]/i.test(candidate);
      if (isLocalhostEnv && metroHostIp) {
        candidate = candidate.replace(/localhost|127\.0\.0\.1|\[::1\]/gi, metroHostIp);
      } else if (isLocalhostEnv && platform === 'android') {
        candidate = candidate.replace(/localhost|127\.0\.0\.1|\[::1\]/gi, '10.0.2.2');
      }
    }
    const validated = validateApiBaseUrl(candidate, isDev);
    if (validated) return validated;
  }

  if (isDev) return developmentFallback();
  return productionApiUrl;
}
