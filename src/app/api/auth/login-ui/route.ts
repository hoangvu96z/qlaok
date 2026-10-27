import { NextResponse } from 'next/server';
import {
  completeZitadelLoginRequest,
  fetchZitadelLoginRequest,
  getHostedRegistrationUrl,
  isRegistrationLoginRequest,
  ZitadelLoginUiError,
} from '@/lib/zitadel-login-ui';
import { getZitadelIssuerUrl } from '@/lib/zitadel-oidc';

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function getAuthRequestId(url: URL): string {
  return (
    url.searchParams.get('authRequest') ||
    url.searchParams.get('authRequestID') ||
    ''
  ).trim();
}

function getRequestOrigin(req: Request): string {
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

function isSameOriginRequest(req: Request, requireOriginHeader: boolean): boolean {
  const secFetchSite = (req.headers.get('sec-fetch-site') || '')
    .trim()
    .toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }
  const origin = req.headers.get('origin');
  if (!origin) {
    return !requireOriginHeader;
  }
  try {
    return new URL(origin).origin === getRequestOrigin(req);
  } catch {
    return false;
  }
}

function userMessage(error: unknown, locale: 'vi' | 'en') {
  if (error instanceof ZitadelLoginUiError) {
    if (error.code === 'AUTH_REQUEST_INVALID') {
      return locale === 'en'
        ? 'This sign-in link has expired. Return to Qlaok and try again.'
        : 'Liên kết đăng nhập đã hết hạn. Vui lòng quay lại Qlaok và thử lại.';
    }
    if (error.code === 'LOGIN_RATE_LIMITED') {
      return locale === 'en'
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : 'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
    }
    if (error.code === 'LOGIN_REJECTED') {
      return locale === 'en'
        ? 'The email or password is incorrect.'
        : 'Email hoặc mật khẩu chưa đúng.';
    }
  }
  return locale === 'en'
    ? 'We could not sign you in right now. Please try again.'
    : 'Chưa thể đăng nhập lúc này. Vui lòng thử lại.';
}

export async function GET(req: Request) {
  if (!isSameOriginRequest(req, false)) {
    return jsonNoStore(
      { error: 'Yêu cầu không hợp lệ.', code: 'INVALID_ORIGIN' },
      403
    );
  }
  const url = new URL(req.url);
  const authRequestId = getAuthRequestId(url);
  const locale = url.searchParams.get('lang') === 'en' ? 'en' : 'vi';
  try {
    const loginRequest = await fetchZitadelLoginRequest(
      authRequestId,
      url.origin
    );
    const isRegistration = isRegistrationLoginRequest(loginRequest);
    return jsonNoStore({
      loginHint: loginRequest.loginHint || '',
      flow: isRegistration ? 'registration' : 'login',
      continueUrl: isRegistration
        ? getHostedRegistrationUrl(loginRequest, getZitadelIssuerUrl())
        : undefined,
    });
  } catch (error) {
    return jsonNoStore(
      {
        error: userMessage(error, locale),
        code:
          error instanceof ZitadelLoginUiError
            ? error.code
            : 'LOGIN_UNAVAILABLE',
      },
      error instanceof ZitadelLoginUiError ? error.status : 503
    );
  }
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req, true)) {
    return jsonNoStore(
      { error: 'Yêu cầu không hợp lệ.', code: 'INVALID_ORIGIN' },
      403
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return jsonNoStore(
      { error: 'Yêu cầu không hợp lệ.', code: 'INVALID_BODY' },
      400
    );
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonNoStore(
      { error: 'Yêu cầu không hợp lệ.', code: 'INVALID_BODY' },
      400
    );
  }
  const body = parsedBody as Record<string, unknown>;
  const authRequestId =
    typeof body.authRequestId === 'string' ? body.authRequestId : '';
  const loginName =
    typeof body.loginName === 'string' ? body.loginName : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const locale = body.lang === 'en' ? 'en' : 'vi';
  try {
    const callbackUrl = await completeZitadelLoginRequest({
      authRequestId,
      loginName,
      password,
      origin: getRequestOrigin(req),
    });
    return jsonNoStore({ callbackUrl });
  } catch (error) {
    return jsonNoStore(
      {
        error: userMessage(error, locale),
        code:
          error instanceof ZitadelLoginUiError
            ? error.code
            : 'LOGIN_UNAVAILABLE',
      },
      error instanceof ZitadelLoginUiError ? error.status : 503
    );
  }
}
