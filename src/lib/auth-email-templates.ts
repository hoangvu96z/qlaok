export type AuthEmailLocale = 'vi' | 'en';

export type AuthEmailTemplateKind =
  | 'registration_verify'
  | 'registration_resend'
  | 'password_reset';

export interface RenderedAuthEmail {
  kind: AuthEmailTemplateKind;
  locale: AuthEmailLocale;
  subject: string;
  html: string;
  text: string;
  appUrl: string;
  actionUrl?: string;
}

const DEFAULT_QLAOK_ORIGIN = 'https://qlaok.vunph.click';
const EMAIL_CODE_SAFE_REGEX = /^[A-Za-z0-9_-]{4,128}$/;

export function normalizeAuthEmailLocale(lang?: unknown): AuthEmailLocale {
  if (typeof lang === 'string' && lang.trim().toLowerCase() === 'en') {
    return 'en';
  }
  return 'vi';
}

export function sanitizeAuthEmailHeaderValue(raw: string): string {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeAuthEmailHtml(raw: string): string {
  const cleaned = String(raw || '').replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    ''
  );
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]'
  );
}

export function resolveTrustedQlaokEmailOrigin(
  rawOrigin = DEFAULT_QLAOK_ORIGIN,
  options?: {
    issuerUrl?: string;
    webRedirectUri?: string;
    nodeEnv?: string;
  }
): string {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV;
  let issuerOrigin = '';
  const rawIssuer = (
    options?.issuerUrl ??
    process.env.ZITADEL_ISSUER_URL ??
    ''
  ).trim();
  if (rawIssuer) {
    try {
      issuerOrigin = new URL(rawIssuer).origin;
    } catch {
      issuerOrigin = '';
    }
  }

  let configuredWebOrigin = '';
  const trustedWebRedirectUri =
    nodeEnv === 'production'
      ? (process.env.ZITADEL_REDIRECT_URI || '').trim()
      : (options?.webRedirectUri || process.env.ZITADEL_REDIRECT_URI || '').trim();
  if (trustedWebRedirectUri) {
    try {
      const parsedWeb = new URL(trustedWebRedirectUri);
      if (
        (parsedWeb.protocol === 'https:' || parsedWeb.protocol === 'http:') &&
        !parsedWeb.username &&
        !parsedWeb.password &&
        parsedWeb.origin !== issuerOrigin
      ) {
        configuredWebOrigin = parsedWeb.origin;
      }
    } catch {
      configuredWebOrigin = '';
    }
  }

  if (nodeEnv === 'production') {
    return configuredWebOrigin || DEFAULT_QLAOK_ORIGIN;
  }

  const trimmed = String(rawOrigin || '').trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !parsed.username &&
        !parsed.password &&
        parsed.origin !== issuerOrigin
      ) {
        if (isLoopbackHostname(parsed.hostname) && configuredWebOrigin) {
          const webHost = new URL(configuredWebOrigin).hostname;
          if (!isLoopbackHostname(webHost)) {
            return configuredWebOrigin;
          }
        }
        return parsed.origin;
      }
    } catch {
      // Fall through to configuredWebOrigin / DEFAULT_QLAOK_ORIGIN
    }
  }

  return configuredWebOrigin || DEFAULT_QLAOK_ORIGIN;
}

export function assertTrustedQlaokEmailUrl(
  rawUrl: string,
  options?: {
    expectedOrigin?: string;
    issuerUrl?: string;
  }
): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || /[\u0000-\u001F\u007F<>"'\s]/.test(trimmed)) {
    throw new Error('UNTRUSTED_EMAIL_URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('UNTRUSTED_EMAIL_URL');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('UNTRUSTED_EMAIL_URL');
  }
  if (options?.issuerUrl) {
    try {
      const issuerOrigin = new URL(options.issuerUrl).origin;
      if (issuerOrigin && parsed.origin === issuerOrigin) {
        throw new Error('UNTRUSTED_EMAIL_URL');
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'UNTRUSTED_EMAIL_URL') {
        throw err;
      }
    }
  }
  if (options?.expectedOrigin && parsed.origin !== options.expectedOrigin) {
    throw new Error('UNTRUSTED_EMAIL_URL');
  }
  return parsed.toString();
}

function renderEmailFrame(subject: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeAuthEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeAuthEmailHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0f172a;padding:24px 32px;border-bottom:3px solid #10b981;">
        <img src="https://qlaok.vunph.click/brand/icon-192.png" width="48" height="48" alt="Qlaok" style="display:inline-block;vertical-align:middle;border:0;border-radius:12px;" />
        <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:20px;font-weight:800;color:#fff;">Qlaok <span style="color:#10b981;">— Quét Là OK</span></span>
      </td></tr>
      <tr><td style="padding:32px;font-size:15px;line-height:1.6;color:#334155;">${body}</td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b;text-align:center;">Qlaok — Quét Là OK</td></tr>
    </table></td></tr>
  </table>
</body>
</html>`;
}

export function renderRegistrationVerificationEmail(params: {
  email: string;
  fullName?: string;
  verificationCode: string;
  lang?: AuthEmailLocale | string;
  origin?: string;
  isResend?: boolean;
  issuerUrl?: string;
  webRedirectUri?: string;
}): RenderedAuthEmail {
  const locale = normalizeAuthEmailLocale(params.lang);
  const cleanEmail = sanitizeAuthEmailHeaderValue(params.email).toLowerCase();
  const cleanName = sanitizeAuthEmailHeaderValue(params.fullName || '');
  const cleanCode = sanitizeAuthEmailHeaderValue(params.verificationCode);
  if (!cleanEmail || !cleanCode || !EMAIL_CODE_SAFE_REGEX.test(cleanCode)) {
    throw new Error('INVALID_EMAIL_TEMPLATE_PARAMS');
  }

  const trustedOrigin = resolveTrustedQlaokEmailOrigin(params.origin, {
    issuerUrl: params.issuerUrl,
    webRedirectUri: params.webRedirectUri,
  });
  // Kept for callers that use appUrl; the message itself directs the recipient
  // to the already-open registration screen, which holds their session ticket.
  const appUrl = assertTrustedQlaokEmailUrl(
    `${trustedOrigin}/login?mode=register&lang=${locale}`,
    { expectedOrigin: trustedOrigin, issuerUrl: params.issuerUrl }
  );
  const isResend = Boolean(params.isResend);
  const kind: AuthEmailTemplateKind = isResend ? 'registration_resend' : 'registration_verify';
  const subject = isResend
    ? 'Qlaok — Mã xác thực mới / Your new verification code'
    : 'Qlaok — Xác thực email / Verify your email';
  const heading = isResend
    ? 'Mã xác thực mới / Your new verification code'
    : 'Xác thực email / Verify your email';
  const displayName = cleanName || cleanEmail;
  const escapedName = escapeAuthEmailHtml(displayName);
  const escapedEmail = escapeAuthEmailHtml(cleanEmail);
  const escapedCode = escapeAuthEmailHtml(cleanCode);
  const introVi = isResend
    ? `Bạn đã yêu cầu mã xác thực mới cho tài khoản Qlaok (${cleanEmail}).`
    : `Cảm ơn bạn đã đăng ký tài khoản Qlaok với địa chỉ ${cleanEmail}.`;
  const introEn = isResend
    ? `You requested a new verification code for your Qlaok account (${cleanEmail}).`
    : `Thank you for registering a Qlaok account with ${cleanEmail}.`;
  const html = renderEmailFrame(subject, 'Nhập mã xác thực trong Qlaok / Enter your verification code in Qlaok', `
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#0f172a;">${escapeAuthEmailHtml(heading)}</h1>
    <p lang="vi">Xin chào ${escapedName},<br />${isResend ? `Bạn đã yêu cầu mã xác thực mới cho tài khoản Qlaok (<strong>${escapedEmail}</strong>).` : `Cảm ơn bạn đã đăng ký tài khoản Qlaok với địa chỉ <strong>${escapedEmail}</strong>.`} Vui lòng quay lại màn hình đăng ký đang mở và nhập mã bên dưới.</p>
    <p lang="en">Hello ${escapedName},<br />${isResend ? `You requested a new verification code for your Qlaok account (<strong>${escapedEmail}</strong>).` : `Thank you for registering a Qlaok account with <strong>${escapedEmail}</strong>.`} Please return to the registration screen you already have open and enter the code below.</p>
    <div style="margin:24px 0;padding:20px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:12px;text-align:center;">
      <div style="font-size:12px;font-weight:700;color:#64748b;">MÃ XÁC THỰC / VERIFICATION CODE</div>
      <div style="font-family:monospace;font-size:32px;font-weight:800;letter-spacing:0.2em;color:#0f172a;">${escapedCode}</div>
    </div>
    <p lang="vi" style="font-size:13px;color:#64748b;">Không chia sẻ mã này với bất kỳ ai. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>
    <p lang="en" style="font-size:13px;color:#64748b;">Do not share this code with anyone. If you did not make this request, please ignore this email.</p>`);
  const text = [
    'Qlaok — Quét Là OK', heading, '',
    `Xin chào ${displayName},`, introVi,
    'Vui lòng quay lại màn hình đăng ký đang mở và nhập mã bên dưới.', '',
    `Hello ${displayName},`, introEn,
    'Please return to the registration screen you already have open and enter the code below.', '',
    `Mã xác thực / Verification code: ${cleanCode}`, '',
    'Không chia sẻ mã này với bất kỳ ai. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.',
    'Do not share this code with anyone. If you did not make this request, please ignore this email.',
  ].join('\n');
  return { kind, locale, subject, html, text, appUrl };
}

export function renderPasswordResetEmail(params: {
  email: string;
  displayName?: string;
  resetUrl: string;
  lang?: AuthEmailLocale | string;
  origin?: string;
  issuerUrl?: string;
  webRedirectUri?: string;
}): RenderedAuthEmail {
  const locale = normalizeAuthEmailLocale(params.lang);
  const cleanEmail = sanitizeAuthEmailHeaderValue(params.email).toLowerCase();
  const cleanName = sanitizeAuthEmailHeaderValue(params.displayName || '');
  if (!cleanEmail) throw new Error('INVALID_EMAIL_TEMPLATE_PARAMS');
  const trustedOrigin = resolveTrustedQlaokEmailOrigin(params.origin, {
    issuerUrl: params.issuerUrl,
    webRedirectUri: params.webRedirectUri,
  });
  const validatedResetUrl = assertTrustedQlaokEmailUrl(params.resetUrl, {
    expectedOrigin: trustedOrigin,
    issuerUrl: params.issuerUrl,
  });
  const parsedReset = new URL(validatedResetUrl);
  const resetUserId = (parsedReset.searchParams.get('userID') || parsedReset.searchParams.get('userId') || '').trim();
  const resetCode = (parsedReset.searchParams.get('code') || parsedReset.searchParams.get('verificationCode') || '').trim();
  if (parsedReset.pathname !== '/login' || parsedReset.searchParams.get('mode') !== 'reset' || !resetUserId || !resetCode || !EMAIL_CODE_SAFE_REGEX.test(resetCode)) {
    throw new Error('UNTRUSTED_EMAIL_URL');
  }
  const appUrl = assertTrustedQlaokEmailUrl(`${trustedOrigin}/login?lang=${locale}`, {
    expectedOrigin: trustedOrigin,
    issuerUrl: params.issuerUrl,
  });
  const displayName = cleanName || cleanEmail;
  const escapedName = escapeAuthEmailHtml(displayName);
  const escapedEmail = escapeAuthEmailHtml(cleanEmail);
  const escapedResetUrl = escapeAuthEmailHtml(validatedResetUrl);
  const subject = 'Qlaok — Đặt lại mật khẩu / Reset your password';
  const html = renderEmailFrame(subject, 'Đặt lại mật khẩu Qlaok / Reset your Qlaok password', `
    <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#0f172a;">Đặt lại mật khẩu / Reset your password</h1>
    <p lang="vi">Xin chào ${escapedName},<br />Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Qlaok (<strong>${escapedEmail}</strong>). Bấm nút bên dưới để đặt mật khẩu mới.</p>
    <p lang="en">Hello ${escapedName},<br />We received a request to reset the password for your Qlaok account (<strong>${escapedEmail}</strong>). Use the button below to choose a new password.</p>
    <div style="margin:24px 0;text-align:center;"><a href="${escapedResetUrl}" style="display:inline-block;padding:14px 28px;background:#10b981;color:#020617;font-weight:800;text-decoration:none;border-radius:10px;">Đặt lại mật khẩu / Reset password</a></div>
    <div style="margin:24px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;line-height:1.6;">
      <div>Nếu nút không hoạt động, hãy mở liên kết sau / If the button does not work, open this link:</div>
      <a href="${escapedResetUrl}" style="color:#059669;text-decoration:underline;word-break:break-all;">${escapedResetUrl}</a>
    </div>
    <p lang="vi" style="font-size:13px;color:#64748b;">Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Đừng chia sẻ liên kết với bất kỳ ai.</p>
    <p lang="en" style="font-size:13px;color:#64748b;">If you did not request a password reset, please ignore this email. Do not share this link with anyone.</p>`);
  const text = [
    'Qlaok — Quét Là OK', 'Đặt lại mật khẩu / Reset your password', '',
    `Xin chào ${displayName},`,
    `Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Qlaok (${cleanEmail}). Mở liên kết bên dưới để đặt mật khẩu mới.`, '',
    `Hello ${displayName},`,
    `We received a request to reset the password for your Qlaok account (${cleanEmail}). Open the link below to choose a new password.`, '',
    validatedResetUrl, '',
    'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này. Đừng chia sẻ liên kết với bất kỳ ai.',
    'If you did not request a password reset, please ignore this email. Do not share this link with anyone.',
  ].join('\n');
  return { kind: 'password_reset', locale, subject, html, text, appUrl, actionUrl: validatedResetUrl };
}
