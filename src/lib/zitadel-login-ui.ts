import 'server-only';
import {
  getZitadelClientId,
  getZitadelIssuerUrl,
  getZitadelMobileClientId,
  isPlaceholderOidcClientId,
  resolveMobileZitadelRedirectUri,
  resolveZitadelRedirectUri,
} from '@/lib/zitadel-oidc';

type FetchLike = typeof fetch;

const AUTH_REQUEST_ID_REGEX = /^V2_[A-Za-z0-9_-]{8,160}$/;

export interface ZitadelLoginRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  loginHint?: string;
  state?: string;
  prompt?: string[];
}

export class ZitadelLoginUiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number
  ) {
    super(code);
    this.name = 'ZitadelLoginUiError';
    this.code = code;
    this.status = status;
  }
}

export interface ZitadelLoginUiConfig {
  issuerUrl: string;
  serviceToken: string;
  webClientId: string;
  mobileClientId: string;
  webRedirectUri: string;
  mobileRedirectUri: string;
}

function getConfig(origin: string): ZitadelLoginUiConfig {
  const serviceToken = (
    process.env.ZITADEL_LOGIN_CLIENT_PAT ||
    process.env.ZITADEL_SERVICE_USER_TOKEN ||
    ''
  ).trim();
  const webClientId = getZitadelClientId();
  const mobileClientId = getZitadelMobileClientId();
  if (
    !serviceToken ||
    isPlaceholderOidcClientId(serviceToken) ||
    !webClientId ||
    !mobileClientId
  ) {
    throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
  }
  return {
    issuerUrl: getZitadelIssuerUrl(),
    serviceToken,
    webClientId,
    mobileClientId,
    webRedirectUri: resolveZitadelRedirectUri(origin),
    mobileRedirectUri: resolveMobileZitadelRedirectUri(),
  };
}

function normalizePromptEntry(value: string): string {
  return value.trim().replace(/^PROMPT_/i, '').toLowerCase();
}

export function isRegistrationLoginRequest(
  loginRequest: Pick<ZitadelLoginRequest, 'prompt'>
): boolean {
  return (
    loginRequest.prompt?.some(
      (entry) => normalizePromptEntry(entry) === 'create'
    ) ?? false
  );
}

function getLoginRequest(
  value: unknown,
  config: ZitadelLoginUiConfig,
  expectedAuthRequestId?: string
): ZitadelLoginRequest {
  if (!value || typeof value !== 'object') {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const clientId =
    typeof raw.clientId === 'string' ? raw.clientId.trim() : '';
  const redirectUri =
    typeof raw.redirectUri === 'string' ? raw.redirectUri.trim() : '';
  const isWeb =
    Boolean(config.webClientId) &&
    Boolean(config.webRedirectUri) &&
    clientId === config.webClientId &&
    redirectUri === config.webRedirectUri;
  const isMobile =
    Boolean(config.mobileClientId) &&
    Boolean(config.mobileRedirectUri) &&
    clientId === config.mobileClientId &&
    redirectUri === config.mobileRedirectUri;
  if (
    !AUTH_REQUEST_ID_REGEX.test(id) ||
    (expectedAuthRequestId !== undefined && id !== expectedAuthRequestId) ||
    (!isWeb && !isMobile)
  ) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const prompt = Array.isArray(raw.prompt)
    ? raw.prompt
        .filter((entry): entry is string => typeof entry === 'string')
        .map(normalizePromptEntry)
        .filter(Boolean)
    : undefined;
  return {
    id,
    clientId,
    redirectUri,
    loginHint:
      typeof raw.loginHint === 'string' ? raw.loginHint.slice(0, 256) : '',
    state: typeof raw.state === 'string' ? raw.state : undefined,
    prompt,
  };
}

async function callZitadel<T>(
  config: ZitadelLoginUiConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(
      new URL(path, `${config.issuerUrl.replace(/\/+$/, '')}/`),
      {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.serviceToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    throw new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      throw new ZitadelLoginUiError('LOGIN_RATE_LIMITED', 429);
    }
    if (status === 400 || status === 404) {
      throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
    }
    if (status === 401 || status === 403) {
      throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
    }
    throw new ZitadelLoginUiError('ZITADEL_UNAVAILABLE', 503);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }
}

export async function fetchZitadelLoginRequest(
  authRequestId: string,
  origin: string,
  options: {
    fetchImpl?: FetchLike;
    config?: ZitadelLoginUiConfig;
  } = {}
): Promise<ZitadelLoginRequest> {
  const authRequest = authRequestId.trim();
  if (!AUTH_REQUEST_ID_REGEX.test(authRequest)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const config = options.config ?? getConfig(origin);
  const response = await callZitadel<{ authRequest?: unknown }>(
    config,
    `/v2/oidc/auth_requests/${encodeURIComponent(authRequest)}`,
    { method: 'GET' },
    options.fetchImpl
  ).catch((error: unknown) => {
    if (
      error instanceof ZitadelLoginUiError &&
      error.code === 'LOGIN_REJECTED'
    ) {
      throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
    }
    throw error;
  });
  return getLoginRequest(response.authRequest, config, authRequest);
}

export function getHostedRegistrationUrl(
  authRequest: ZitadelLoginRequest,
  issuerUrl: string = getZitadelIssuerUrl()
): string {
  const id = typeof authRequest?.id === 'string' ? authRequest.id.trim() : '';
  if (!AUTH_REQUEST_ID_REGEX.test(id)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const url = new URL('/ui/v2/login/loginname', `${issuerUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('authRequest', id);
  return url.toString();
}

export async function completeZitadelLoginRequest(params: {
  authRequestId: string;
  loginName: string;
  password: string;
  origin: string;
  fetchImpl?: FetchLike;
  config?: ZitadelLoginUiConfig;
}): Promise<string> {
  const rawAuthRequestId =
    typeof params.authRequestId === 'string' ? params.authRequestId.trim() : '';
  if (!AUTH_REQUEST_ID_REGEX.test(rawAuthRequestId)) {
    throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
  }
  const loginName = params.loginName.trim();
  if (!loginName || loginName.length > 256) {
    throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
  }
  if (!params.password || params.password.length > 1024) {
    throw new ZitadelLoginUiError('LOGIN_REJECTED', 401);
  }
  const config = params.config ?? getConfig(params.origin);
  const fetchImpl = params.fetchImpl ?? fetch;
  const authRequest = await fetchZitadelLoginRequest(
    rawAuthRequestId,
    params.origin,
    { config, fetchImpl }
  );

  const created = await callZitadel<{
    sessionId?: unknown;
    session?: { id?: unknown };
    sessionToken?: unknown;
  }>(
    config,
    '/v2/sessions',
    {
      method: 'POST',
      body: JSON.stringify({ checks: { user: { loginName } } }),
    },
    fetchImpl
  );
  const sessionId =
    typeof created.sessionId === 'string' && created.sessionId.trim()
      ? created.sessionId.trim()
      : typeof created.session?.id === 'string' && created.session.id.trim()
        ? created.session.id.trim()
        : '';
  const initialSessionToken =
    typeof created.sessionToken === 'string' ? created.sessionToken.trim() : '';
  if (!sessionId || !initialSessionToken) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  const updated = await callZitadel<{ sessionToken?: unknown }>(
    config,
    `/v2/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        checks: { password: { password: params.password } },
      }),
    },
    fetchImpl
  );
  const latestSessionToken =
    typeof updated.sessionToken === 'string' ? updated.sessionToken.trim() : '';
  if (!latestSessionToken) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  const finalized = await callZitadel<{ callbackUrl?: unknown }>(
    config,
    `/v2/oidc/auth_requests/${encodeURIComponent(authRequest.id)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        session: {
          sessionId,
          sessionToken: latestSessionToken,
        },
      }),
    },
    fetchImpl
  ).catch((error: unknown) => {
    if (
      error instanceof ZitadelLoginUiError &&
      error.code === 'LOGIN_REJECTED'
    ) {
      throw new ZitadelLoginUiError('AUTH_REQUEST_INVALID', 400);
    }
    throw error;
  });
  const callbackUrl =
    typeof finalized.callbackUrl === 'string'
      ? finalized.callbackUrl.trim()
      : '';
  if (!callbackUrl) {
    throw new ZitadelLoginUiError('ZITADEL_BAD_RESPONSE', 503);
  }

  let parsedCallback: URL;
  let parsedRedirect: URL;
  try {
    parsedCallback = new URL(callbackUrl);
    parsedRedirect = new URL(authRequest.redirectUri);
  } catch {
    throw new ZitadelLoginUiError('CALLBACK_URL_INVALID', 502);
  }
  const callbackState = parsedCallback.searchParams.get('state')?.trim() || '';
  const callbackCode = parsedCallback.searchParams.get('code')?.trim() || '';
  if (
    parsedCallback.protocol !== parsedRedirect.protocol ||
    parsedCallback.host !== parsedRedirect.host ||
    parsedCallback.pathname !== parsedRedirect.pathname ||
    parsedCallback.username ||
    parsedCallback.password ||
    parsedCallback.hash ||
    parsedCallback.searchParams.get('error') ||
    !callbackState ||
    (authRequest.state && callbackState !== authRequest.state) ||
    !callbackCode ||
    !callbackUrl.startsWith(`${authRequest.redirectUri}?`)
  ) {
    throw new ZitadelLoginUiError('CALLBACK_URL_INVALID', 502);
  }
  return callbackUrl;
}
