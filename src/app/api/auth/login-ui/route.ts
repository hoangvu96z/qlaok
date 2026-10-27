import { NextResponse } from 'next/server';
import {
  completeZitadelLoginRequest,
  completeZitadelPasswordReset,
  completeZitadelRegistrationVerification,
  enforceZitadelLoginUiRateLimit,
  fetchZitadelLoginRequest,
  getClientIp,
  isRegistrationLoginRequest,
  type OidcAuthorizeBootstrapParams,
  requestZitadelPasswordReset,
  resendZitadelRegistrationCode,
  startZitadelRegistration,
  ZitadelLoginUiError,
} from '@/lib/zitadel-login-ui';
import {
  attachOidcTransactionCookie,
  getZitadelClientId,
  issueOidcTransactionCookieValue,
  resolveZitadelRedirectUri,
} from '@/lib/zitadel-oidc';
import { getRequestOrigin } from '@/lib/request-origin';

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

function isSameOriginRequest(req: Request, requireOriginHeader: boolean): boolean {
  const secFetchSite = (req.headers.get('sec-fetch-site') || '')
    .trim()
    .toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }
  const origin = req.headers.get('origin');
  if (!origin) {
    if (
      !secFetchSite &&
      (req.headers.get('x-qlaok-client') || '').trim() === 'mobile-native'
    ) {
      return true;
    }
    return !requireOriginHeader;
  }
  try {
    return new URL(origin).origin === getRequestOrigin(req);
  } catch {
    return false;
  }
}

function parseMobileOidcBootstrap(
  raw: unknown
): OidcAuthorizeBootstrapParams | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const clientId = typeof obj.clientId === 'string' ? obj.clientId.trim() : '';
  const redirectUri =
    typeof obj.redirectUri === 'string' ? obj.redirectUri.trim() : '';
  const state = typeof obj.state === 'string' ? obj.state.trim() : '';
  const nonce = typeof obj.nonce === 'string' ? obj.nonce.trim() : '';
  const codeChallenge =
    typeof obj.codeChallenge === 'string' ? obj.codeChallenge.trim() : '';
  const codeChallengeMethod =
    typeof obj.codeChallengeMethod === 'string'
      ? obj.codeChallengeMethod.trim()
      : 'S256';
  if (!clientId || !redirectUri || !state || !nonce || !codeChallenge) {
    return undefined;
  }
  return {
    clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge,
    codeChallengeMethod,
  };
}

type LoginUiFlowKind = 'login' | 'registration' | 'password_reset';

function userMessage(
  error: unknown,
  locale: 'vi' | 'en',
  flowKind: LoginUiFlowKind = 'login'
) {
  if (error instanceof ZitadelLoginUiError) {
    switch (error.code) {
      case 'AUTH_REQUEST_INVALID':
        return locale === 'en'
          ? 'This authentication session has expired. Please start again in Qlaok.'
          : 'Phiên xác thực đã hết hạn. Vui lòng thực hiện lại trên Qlaok.';
      case 'LOGIN_RATE_LIMITED':
        return locale === 'en'
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : 'Bạn thao tác quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
      case 'LOGIN_REJECTED':
        return locale === 'en'
          ? 'The email or password is incorrect.'
          : 'Email hoặc mật khẩu chưa đúng.';
      case 'INVALID_FULL_NAME':
        return locale === 'en'
          ? 'Please enter your full name (at least 2 characters).'
          : 'Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự).';
      case 'INVALID_EMAIL':
        return locale === 'en'
          ? 'Please enter a valid email address.'
          : 'Vui lòng nhập địa chỉ email hợp lệ.';
      case 'EMAIL_ALREADY_EXISTS':
        return locale === 'en'
          ? 'An account with this email already exists. Please sign in or reset your password.'
          : 'Email này đã được đăng ký tài khoản. Vui lòng chuyển sang Đăng nhập hoặc Đặt lại mật khẩu.';
      case 'PASSWORD_WEAK':
        return locale === 'en'
          ? 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
          : 'Mật khẩu cần tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.';
      case 'PASSWORD_MISMATCH':
        return locale === 'en'
          ? 'Password confirmation does not match.'
          : 'Mật khẩu xác nhận chưa khớp.';
      case 'VERIFICATION_CODE_INVALID':
        return locale === 'en'
          ? 'The verification code is incorrect. Please check your email and try again.'
          : 'Mã xác thực chưa đúng. Vui lòng kiểm tra lại email và thử lại.';
      case 'VERIFICATION_CODE_EXPIRED':
        if (flowKind === 'password_reset') {
          return locale === 'en'
            ? 'The verification code has expired. Please request a new password reset email.'
            : 'Mã xác thực đã hết hạn. Vui lòng gửi lại yêu cầu đặt lại mật khẩu mới.';
        }
        return locale === 'en'
          ? 'The verification code has expired. Please tap Resend code to receive a new one.'
          : 'Mã xác thực đã hết hạn. Vui lòng bấm Gửi lại mã để nhận mã mới.';
      case 'REGISTRATION_EXPIRED':
      case 'REGISTRATION_TICKET_INVALID':
        return locale === 'en'
          ? 'Your registration session has expired. Please submit the registration form again.'
          : 'Phiên đăng ký đã hết hạn. Vui lòng điền lại thông tin đăng ký.';
      case 'REGISTRATION_VERIFIED_LOGIN_REQUIRED':
        return locale === 'en'
          ? 'Your email has been verified. Please sign in with your email and password to continue.'
          : 'Email đã được xác thực thành công. Vui lòng đăng nhập bằng email và mật khẩu để tiếp tục.';
      case 'REGISTRATION_RESEND_FAILED':
        return locale === 'en'
          ? 'Could not resend the verification code right now. Please try again in a moment.'
          : 'Chưa thể gửi lại mã xác thực lúc này. Vui lòng thử lại sau ít phút.';
      case 'REGISTRATION_SERVICE_NOT_CONFIGURED':
        return locale === 'en'
          ? 'Account creation is temporarily unavailable. Please try again in a few minutes.'
          : 'Tính năng tạo tài khoản đang bảo trì cấu hình. Vui lòng thử lại sau ít phút.';
      case 'EMAIL_SERVICE_NOT_CONFIGURED':
        if (flowKind === 'password_reset') {
          return locale === 'en'
            ? 'Password reset email service is not configured. Please try again in a few minutes.'
            : 'Dịch vụ gửi email đặt lại mật khẩu chưa được cấu hình. Vui lòng thử lại sau ít phút.';
        }
        return locale === 'en'
          ? 'Verification email service is not configured. Please try again in a few minutes.'
          : 'Dịch vụ gửi email xác thực chưa được cấu hình. Vui lòng thử lại sau ít phút.';
      case 'EMAIL_DELIVERY_FAILED':
        if (flowKind === 'password_reset') {
          return locale === 'en'
            ? 'We could not send the password reset email right now. Please try again in a moment.'
            : 'Chưa thể gửi email đặt lại mật khẩu lúc này. Vui lòng thử lại sau ít phút.';
        }
        return locale === 'en'
          ? 'We could not send the verification email right now. Please try again in a moment.'
          : 'Chưa thể gửi email mã xác thực lúc này. Vui lòng thử lại sau ít phút.';
      case 'LOGIN_SERVICE_NOT_CONFIGURED':
        if (flowKind === 'password_reset') {
          return locale === 'en'
            ? 'Password reset is temporarily unavailable. Please try again in a few minutes.'
            : 'Tính năng đặt lại mật khẩu đang bảo trì cấu hình. Vui lòng thử lại sau ít phút.';
        }
        break;
      case 'REGISTRATION_REJECTED':
        return locale === 'en'
          ? 'Could not create your account with the provided details. Please check your information and try again.'
          : 'Chưa thể tạo tài khoản với thông tin đã nhập. Vui lòng kiểm tra lại và thử lại.';
      default:
        break;
    }
  }
  if (flowKind === 'password_reset') {
    return locale === 'en'
      ? 'We could not process your password reset right now. Please try again.'
      : 'Chưa thể xử lý yêu cầu đặt lại mật khẩu lúc này. Vui lòng thử lại.';
  }
  if (flowKind === 'registration') {
    return locale === 'en'
      ? 'We could not complete account registration right now. Please try again.'
      : 'Chưa thể hoàn tất đăng ký tài khoản lúc này. Vui lòng thử lại.';
  }
  return locale === 'en'
    ? 'We could not sign you in right now. Please try again.'
    : 'Chưa thể đăng nhập lúc này. Vui lòng thử lại.';
}

export async function GET(req: Request) {
  if (!isSameOriginRequest(req, false)) {
    return jsonNoStore(
      { ok: false, error: 'Yêu cầu không hợp lệ.', code: 'INVALID_ORIGIN' },
      403
    );
  }
  const url = new URL(req.url);
  const authRequestId = getAuthRequestId(url);
  const locale = url.searchParams.get('lang') === 'en' ? 'en' : 'vi';
  try {
    const loginRequest = await fetchZitadelLoginRequest(
      authRequestId,
      getRequestOrigin(req)
    );
    const isRegistration = isRegistrationLoginRequest(loginRequest);
    return jsonNoStore({
      loginHint: loginRequest.loginHint || '',
      flow: isRegistration ? 'registration' : 'login',
    });
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
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
      { ok: false, error: 'Yêu cầu không hợp lệ.', code: 'INVALID_ORIGIN' },
      403
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return jsonNoStore(
      { ok: false, error: 'Yêu cầu không hợp lệ.', code: 'INVALID_BODY' },
      400
    );
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonNoStore(
      { ok: false, error: 'Yêu cầu không hợp lệ.', code: 'INVALID_BODY' },
      400
    );
  }
  const body = parsedBody as Record<string, unknown>;
  const action =
    typeof body.action === 'string' && body.action.trim()
      ? body.action.trim()
      : 'login';
  const url = new URL(req.url);
  const locale: 'vi' | 'en' =
    body.lang === 'en' ||
    (body.lang !== 'vi' && url.searchParams.get('lang') === 'en')
      ? 'en'
      : 'vi';
  const requestOrigin = getRequestOrigin(req);
  const clientIp = getClientIp(req);
  const flowKind: LoginUiFlowKind = action.startsWith('register_')
    ? 'registration'
    : action.startsWith('password_reset_')
      ? 'password_reset'
      : 'login';

  try {
    if (action === 'login') {
      const authRequestId =
        typeof body.authRequestId === 'string' ? body.authRequestId : '';
      const loginName =
        typeof body.loginName === 'string' ? body.loginName : '';
      const password = typeof body.password === 'string' ? body.password : '';
      await enforceZitadelLoginUiRateLimit(
        `login:${clientIp}:${loginName.trim().toLowerCase().slice(0, 128)}`,
        15
      );
      const callbackUrl = await completeZitadelLoginRequest({
        authRequestId,
        loginName,
        password,
        origin: requestOrigin,
      });
      return jsonNoStore({ callbackUrl });
    }

    if (action === 'register_start') {
      await enforceZitadelLoginUiRateLimit(`register_start:${clientIp}`, 10);
      const authRequestId =
        typeof body.authRequestId === 'string' ? body.authRequestId.trim() : '';
      const fullName = typeof body.fullName === 'string' ? body.fullName : '';
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword =
        typeof body.confirmPassword === 'string'
          ? body.confirmPassword
          : undefined;
      const mobileOidc = parseMobileOidcBootstrap(body.oidc);

      let oidcBootstrap = mobileOidc;
      let issuedWebTxCookie: string | null = null;

      if (!authRequestId && !oidcBootstrap) {
        const nextPath =
          typeof body.next === 'string' && body.next.trim()
            ? body.next.trim()
            : '/onboarding';
        const webClientId = getZitadelClientId();
        const webRedirectUri = resolveZitadelRedirectUri(requestOrigin);
        if (!webClientId) {
          throw new ZitadelLoginUiError('LOGIN_SERVICE_NOT_CONFIGURED', 503);
        }
        const txIssued = issueOidcTransactionCookieValue({
          redirectUri: webRedirectUri,
          nextPath,
          mode: 'register',
        });
        issuedWebTxCookie = txIssued.cookieValue;
        oidcBootstrap = {
          clientId: webClientId,
          redirectUri: webRedirectUri,
          state: txIssued.transaction.state,
          nonce: txIssued.transaction.nonce,
          codeChallenge: txIssued.codeChallenge,
          codeChallengeMethod: 'S256',
          loginHint: email.trim().toLowerCase(),
          lang: locale,
        };
      }

      const started = await startZitadelRegistration({
        authRequestId: authRequestId || undefined,
        oidc: oidcBootstrap,
        fullName,
        email,
        password,
        confirmPassword,
        lang: locale,
        origin: requestOrigin,
      });

      const res = jsonNoStore({
        step: 'verify_email',
        registrationTicket: started.registrationTicket,
        authRequestId: started.authRequestId,
        email: started.email,
      });
      if (issuedWebTxCookie) {
        attachOidcTransactionCookie(res, issuedWebTxCookie);
      }
      return res;
    }

    if (action === 'register_verify') {
      await enforceZitadelLoginUiRateLimit(`register_verify:${clientIp}`, 12);
      const registrationTicket =
        typeof body.registrationTicket === 'string'
          ? body.registrationTicket
          : '';
      const verificationCode =
        typeof body.verificationCode === 'string' ? body.verificationCode : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const verified = await completeZitadelRegistrationVerification({
        registrationTicket,
        verificationCode,
        password,
        origin: requestOrigin,
      });
      return jsonNoStore({
        callbackUrl: verified.callbackUrl,
        email: verified.email,
      });
    }

    if (action === 'register_resend') {
      const registrationTicket =
        typeof body.registrationTicket === 'string'
          ? body.registrationTicket
          : '';
      await enforceZitadelLoginUiRateLimit(`register_resend:${clientIp}`, 6);
      if (registrationTicket.trim()) {
        await enforceZitadelLoginUiRateLimit(
          `register_resend:ticket:${registrationTicket.trim().slice(0, 128)}`,
          3,
          5 * 60 * 1000
        );
      }
      const resent = await resendZitadelRegistrationCode({
        registrationTicket,
        lang: locale,
        origin: requestOrigin,
      });
      return jsonNoStore({
        ok: true,
        email: resent.email,
      });
    }

    if (action === 'password_reset_request') {
      const email = typeof body.email === 'string' ? body.email : '';
      await requestZitadelPasswordReset({
        email,
        lang: locale,
        origin: requestOrigin,
        clientIp,
      });
      return jsonNoStore({ ok: true });
    }

    if (action === 'password_reset_complete') {
      const userID =
        typeof body.userID === 'string'
          ? body.userID
          : typeof body.userId === 'string'
            ? body.userId
            : '';
      const code =
        typeof body.code === 'string'
          ? body.code
          : typeof body.verificationCode === 'string'
            ? body.verificationCode
            : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword =
        body.confirmPassword !== undefined
          ? typeof body.confirmPassword === 'string'
            ? body.confirmPassword
            : ''
          : undefined;
      await completeZitadelPasswordReset({
        userID,
        code,
        password,
        confirmPassword,
        lang: locale,
        origin: requestOrigin,
        clientIp,
      });
      return jsonNoStore({ ok: true });
    }

    return jsonNoStore(
      {
        ok: false,
        error: locale === 'en' ? 'Invalid request.' : 'Yêu cầu không hợp lệ.',
        code: 'INVALID_ACTION',
      },
      400
    );
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        error: userMessage(error, locale, flowKind),
        code:
          error instanceof ZitadelLoginUiError
            ? error.code
            : 'LOGIN_UNAVAILABLE',
      },
      error instanceof ZitadelLoginUiError ? error.status : 503
    );
  }
}