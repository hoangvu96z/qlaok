export const PASSWORD_RECOVERY_LOGIN_MODE = 'reset' as const;

export type WebLoginAuthMode =
  | 'password_login'
  | 'register'
  | 'otp'
  | 'reset'
  | 'staff';

export type PasswordRecoveryFailureReason =
  | 'invalid_email'
  | 'unsupported_account'
  | 'unsupported_provider'
  | 'rate_limited'
  | 'network_error'
  | 'provider_error';

export type PasswordRecoveryCodeFailureReason =
  | PasswordRecoveryFailureReason
  | 'invalid_code'
  | 'weak_password'
  | 'password_mismatch';

export type RequestPasswordRecoveryResult =
  | {
      ok: true;
      email: string;
      redirectTo: string;
      notice: string;
    }
  | {
      ok: false;
      reason: PasswordRecoveryFailureReason;
      errorMessage?: string;
    };

export type CompletePasswordRecoveryResult =
  | {
      ok: true;
      email: string;
    }
  | {
      ok: false;
      reason: PasswordRecoveryCodeFailureReason;
      errorMessage?: string;
    };

export interface PasswordRecoveryEligibilityResult {
  supported: boolean;
  reason?: PasswordRecoveryFailureReason;
  errorMessage?: string;
}

export interface PasswordRecoveryAuthClient {
  resetPasswordForEmail?: (
    email: string,
    options?: { redirectTo?: string }
  ) => Promise<{
    data?: unknown;
    error?: { message?: string; status?: number } | null;
  }>;
  verifyOtp?: (
    params:
      | {
          email: string;
          token: string;
          type: 'recovery' | 'email';
        }
      | {
          token_hash: string;
          type: 'recovery' | 'email';
        }
  ) => Promise<{
    data?: {
      user?: { id?: string; email?: string | null } | null;
      session?: { access_token?: string } | null;
    } | null;
    error?: { message?: string; status?: number } | null;
  }>;
  updateUser?: (attributes: { password: string }) => Promise<{
    data?: { user?: { id?: string; email?: string | null } | null } | unknown;
    error?: { message?: string; status?: number } | null;
  }>;
}

export interface SearchParamReader {
  get(name: string): string | null;
}

export interface RecoveryUrlSignals {
  isResetMode: boolean;
  hasRecoveryCallbackSignal: boolean;
  tokenHash: string | null;
  code: string | null;
  accessToken: string | null;
  hashErrorDescription: string | null;
}

const RESERVED_UNSUPPORTED_RECOVERY_EMAILS = new Set([
  'chuquan@qlaok.vn',
  'hoangvu96z@gmail.com',
]);

export function normalizeRecoveryEmail(
  raw: string | null | undefined
): string {
  return (raw ?? '').trim().toLowerCase();
}

export function isValidRecoveryEmail(
  raw: string | null | undefined
): boolean {
  const normalized = normalizeRecoveryEmail(raw);
  if (!normalized || normalized.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function isReservedUnsupportedRecoveryEmail(
  raw: string | null | undefined
): boolean {
  const normalized = normalizeRecoveryEmail(raw);
  return RESERVED_UNSUPPORTED_RECOVERY_EMAILS.has(normalized);
}

export function buildPasswordRecoveryRedirectUrl(baseOrigin: string): string {
  const trimmed = (baseOrigin ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return `/login?mode=${PASSWORD_RECOVERY_LOGIN_MODE}`;
  }
  return `${trimmed}/login?mode=${PASSWORD_RECOVERY_LOGIN_MODE}`;
}

export function parseRecoveryUrlSignals(input: {
  searchParams?: SearchParamReader | null;
  hash?: string | null;
}): RecoveryUrlSignals {
  const modeParam = (input.searchParams?.get('mode') ?? '').trim().toLowerCase();
  const typeParam = (input.searchParams?.get('type') ?? '').trim().toLowerCase();
  const queryTokenHash = (
    input.searchParams?.get('token_hash') ??
    input.searchParams?.get('token') ??
    ''
  ).trim();
  const queryCode = (input.searchParams?.get('code') ?? '').trim();
  const queryError = (
    input.searchParams?.get('error_description') ??
    input.searchParams?.get('error') ??
    ''
  ).trim();

  const rawHash = (input.hash ?? '').trim().replace(/^#/, '');
  const hashParams = new URLSearchParams(rawHash);
  const hashType = (hashParams.get('type') ?? '').trim().toLowerCase();
  const hashAccessToken = (hashParams.get('access_token') ?? '').trim();
  const hashTokenHash = (hashParams.get('token_hash') ?? '').trim();
  const hashError = (
    hashParams.get('error_description') ??
    hashParams.get('error') ??
    ''
  ).trim();

  const tokenHash = queryTokenHash || hashTokenHash || null;
  const code = queryCode || null;
  const accessToken = hashAccessToken || null;
  const hashErrorDescription = hashError || queryError || null;

  const isRecoveryType = typeParam === 'recovery' || hashType === 'recovery';
  const hasRecoveryCallbackSignal =
    isRecoveryType ||
    (modeParam === PASSWORD_RECOVERY_LOGIN_MODE &&
      Boolean(tokenHash || code || accessToken));

  const isResetMode =
    modeParam === PASSWORD_RECOVERY_LOGIN_MODE ||
    hasRecoveryCallbackSignal ||
    (modeParam !== 'register' &&
      modeParam !== 'otp' &&
      Boolean(hashErrorDescription) &&
      (rawHash.toLowerCase().includes('recovery') ||
        rawHash.toLowerCase().includes('otp_expired')));

  return {
    isResetMode,
    hasRecoveryCallbackSignal,
    tokenHash,
    code,
    accessToken,
    hashErrorDescription,
  };
}

export function resolveLoginAuthMode(input: {
  searchParams?: SearchParamReader | null;
  hash?: string | null;
}): WebLoginAuthMode {
  const signals = parseRecoveryUrlSignals(input);
  if (signals.isResetMode) {
    return 'reset';
  }
  const modeParam = (input.searchParams?.get('mode') ?? '').trim().toLowerCase();
  if (modeParam === 'staff') {
    return 'staff';
  }
  if (modeParam === 'register') {
    return 'register';
  }
  if (modeParam === 'otp') {
    return 'otp';
  }
  return 'password_login';
}

function classifyAuthRecoveryError(
  error: unknown
): { reason: PasswordRecoveryFailureReason; errorMessage?: string } {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === 'string'
        ? String((error as { message: string }).message)
        : '';
  const status =
    typeof (error as { status?: unknown })?.status === 'number'
      ? Number((error as { status: number }).status)
      : undefined;

  if (
    status === 429 ||
    /rate\s*limit|too\s*many\s*requests|over_email_send_rate_limit|for\s+security\s+purposes/i.test(
      message
    )
  ) {
    return { reason: 'rate_limited', errorMessage: message || undefined };
  }

  if (
    /network|failed\s+to\s+fetch|fetch\s+failed|network\s+request\s+failed|offline|timed?\s*out/i.test(
      message
    )
  ) {
    return { reason: 'network_error', errorMessage: message || undefined };
  }

  if (
    status === 501 ||
    /not\s+supported|recovery.*disabled|email.*disabled|smtp.*not\s+configured|provider.*disabled/i.test(
      message
    )
  ) {
    return {
      reason: 'unsupported_provider',
      errorMessage: message || undefined,
    };
  }

  return {
    reason: 'provider_error',
    errorMessage: message || undefined,
  };
}

export function formatGenericPasswordRecoveryNotice(
  email?: string | null,
  locale: 'vi' | 'en' = 'vi'
): string {
  const normalized = normalizeRecoveryEmail(email);
  if (locale === 'en') {
    return normalized
      ? `If ${normalized} belongs to an account that supports email recovery, reset instructions will be sent to your inbox. Local-password, demo, or admin accounts require administrator support.`
      : 'If the email belongs to an account that supports email recovery, reset instructions will be sent to your inbox. Local-password, demo, or admin accounts require administrator support.';
  }
  return normalized
    ? `Nếu ${normalized} là tài khoản được hỗ trợ khôi phục qua email, hướng dẫn đặt lại mật khẩu sẽ được gửi tới hộp thư. Tài khoản mật khẩu nội bộ, dùng thử hoặc quản trị cần liên hệ quản trị viên.`
    : 'Nếu email thuộc tài khoản được hỗ trợ khôi phục qua email, hướng dẫn đặt lại mật khẩu sẽ được gửi tới hộp thư. Tài khoản mật khẩu nội bộ, dùng thử hoặc quản trị cần liên hệ quản trị viên.';
}

export async function requestMobilePasswordRecovery(input: {
  email: string;
  redirectTo?: string;
  locale?: 'vi' | 'en';
  authClient?: PasswordRecoveryAuthClient | null;
}): Promise<RequestPasswordRecoveryResult> {
  const normalizedEmail = normalizeRecoveryEmail(input.email);
  if (!isValidRecoveryEmail(normalizedEmail)) {
    return { ok: false, reason: 'invalid_email' };
  }
  if (isReservedUnsupportedRecoveryEmail(normalizedEmail)) {
    return { ok: false, reason: 'unsupported_account' };
  }

  const resetFn = input.authClient?.resetPasswordForEmail;
  if (typeof resetFn !== 'function') {
    return { ok: false, reason: 'unsupported_provider' };
  }

  try {
    const cleanRedirect = (input.redirectTo ?? '').trim();
    const res = await resetFn(
      normalizedEmail,
      cleanRedirect ? { redirectTo: cleanRedirect } : undefined
    );
    if (res?.error) {
      const classified = classifyAuthRecoveryError(res.error);
      return {
        ok: false,
        reason: classified.reason,
        errorMessage: classified.errorMessage,
      };
    }
    return {
      ok: true,
      email: normalizedEmail,
      redirectTo: cleanRedirect,
      notice: formatGenericPasswordRecoveryNotice(
        normalizedEmail,
        input.locale ?? 'vi'
      ),
    };
  } catch (err) {
    const classified = classifyAuthRecoveryError(err);
    return {
      ok: false,
      reason: classified.reason,
      errorMessage: classified.errorMessage,
    };
  }
}

export async function completePasswordRecoverySession(input: {
  email?: string | null;
  newPassword: string;
  confirmPassword?: string;
  authClient?: PasswordRecoveryAuthClient | null;
}): Promise<CompletePasswordRecoveryResult> {
  const normalizedEmail = normalizeRecoveryEmail(input.email);
  if (normalizedEmail && isReservedUnsupportedRecoveryEmail(normalizedEmail)) {
    return { ok: false, reason: 'unsupported_account' };
  }

  const newPassword = input.newPassword ?? '';
  if (newPassword.length < 6) {
    return { ok: false, reason: 'weak_password' };
  }

  if (
    input.confirmPassword !== undefined &&
    newPassword !== input.confirmPassword
  ) {
    return { ok: false, reason: 'password_mismatch' };
  }

  const updateUserFn = input.authClient?.updateUser;
  if (typeof updateUserFn !== 'function') {
    return { ok: false, reason: 'unsupported_provider' };
  }

  try {
    const updateRes = await updateUserFn({ password: newPassword });
    if (updateRes?.error) {
      const classified = classifyAuthRecoveryError(updateRes.error);
      return {
        ok: false,
        reason: classified.reason,
        errorMessage: classified.errorMessage,
      };
    }

    const updatedUserEmail = normalizeRecoveryEmail(
      (
        updateRes?.data as
          | { user?: { email?: string | null } | null }
          | undefined
      )?.user?.email
    );

    return {
      ok: true,
      email: normalizedEmail || updatedUserEmail,
    };
  } catch (err) {
    const classified = classifyAuthRecoveryError(err);
    return {
      ok: false,
      reason: classified.reason,
      errorMessage: classified.errorMessage,
    };
  }
}

export async function completeMobilePasswordRecoveryWithCode(input: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword?: string;
  authClient?: PasswordRecoveryAuthClient | null;
}): Promise<CompletePasswordRecoveryResult> {
  const normalizedEmail = normalizeRecoveryEmail(input.email);
  if (!isValidRecoveryEmail(normalizedEmail)) {
    return { ok: false, reason: 'invalid_email' };
  }
  if (isReservedUnsupportedRecoveryEmail(normalizedEmail)) {
    return { ok: false, reason: 'unsupported_account' };
  }

  const cleanCode = (input.code ?? '').trim();
  if (cleanCode.length < 6) {
    return { ok: false, reason: 'invalid_code' };
  }

  const newPassword = input.newPassword ?? '';
  if (newPassword.length < 6) {
    return { ok: false, reason: 'weak_password' };
  }

  if (
    input.confirmPassword !== undefined &&
    newPassword !== input.confirmPassword
  ) {
    return { ok: false, reason: 'password_mismatch' };
  }

  const verifyOtpFn = input.authClient?.verifyOtp;
  const updateUserFn = input.authClient?.updateUser;
  if (typeof verifyOtpFn !== 'function' || typeof updateUserFn !== 'function') {
    return { ok: false, reason: 'unsupported_provider' };
  }

  try {
    const otpRes = await verifyOtpFn({
      email: normalizedEmail,
      token: cleanCode,
      type: 'recovery',
    });
    if (otpRes?.error) {
      const msg = otpRes.error.message || '';
      if (/invalid|expired|token|otp/i.test(msg)) {
        return {
          ok: false,
          reason: 'invalid_code',
          errorMessage: msg || undefined,
        };
      }
      const classified = classifyAuthRecoveryError(otpRes.error);
      return {
        ok: false,
        reason: classified.reason,
        errorMessage: classified.errorMessage,
      };
    }

    return await completePasswordRecoverySession({
      email: normalizedEmail,
      newPassword,
      confirmPassword: input.confirmPassword,
      authClient: input.authClient,
    });
  } catch (err) {
    const classified = classifyAuthRecoveryError(err);
    return {
      ok: false,
      reason: classified.reason,
      errorMessage: classified.errorMessage,
    };
  }
}
