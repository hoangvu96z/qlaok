import React, { memo, useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import qMenuLogo from '../../assets/q-menu.png';
import { API_BASE_URL } from '../lib/supabase';
import {
  completeMobileOwnerRegistrationVerification,
  MobileOwnerOidcError,
  type MobileOidcAuthMode,
  type MobileOwnerSession,
  resendMobileOwnerRegistrationCode,
  resolveMobileZitadelOidcConfig,
  sanitizeOwnerUserFacingErrorMessage,
  startMobileOwnerRegistration,
  startOwnerOidcLogin,
} from '../lib/owner-session';
import {
  loginStaff,
  type MobileStaffSession,
  StaffAuthError,
} from '../lib/staff-session';
import { styles } from '../styles/mobileStyles';
import { MobileLanguageSwitcher, useMobileI18n } from './MobileI18nProvider';

export type MobileLoginAccountMode = 'owner' | 'staff';
export type MobileOwnerFlowStep =
  | 'sign_in'
  | 'register_form'
  | 'verify_email'
  | 'forgot_password';

export async function defaultOwnerResetRequest({
  baseUrl,
  email,
  lang = 'vi',
}: {
  baseUrl: string;
  email: string;
  lang?: 'vi' | 'en';
}): Promise<{ ok: boolean }> {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${cleanBaseUrl}/api/auth/login-ui?lang=${lang}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: cleanBaseUrl,
        'x-qlaok-client': 'mobile-native',
      },
      body: JSON.stringify({
        action: 'password_reset_request',
        email,
        lang,
      }),
    });
  } catch {
    throw new Error(
      lang === 'en'
        ? 'Unable to connect. Check your internet connection and try again.'
        : 'Không thể kết nối. Vui lòng kiểm tra mạng rồi thử lại.'
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!res.ok || !payload.ok) {
    const errorMsg =
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : lang === 'en'
          ? 'Could not process password reset request. Please try again.'
          : 'Chưa thể gửi yêu cầu đặt lại mật khẩu lúc này. Vui lòng thử lại.';
    throw new Error(errorMsg);
  }

  return { ok: true };
}

export interface AuthScreenProps {
  onStaffLoginSuccess?: (session: MobileStaffSession) => void;
  onOwnerLoginSuccess?: (session: MobileOwnerSession) => void;
  initialAccountMode?: MobileLoginAccountMode;
  initialOwnerFlowStep?: MobileOwnerFlowStep;
  staffSessionExpired?: boolean;
  sessionNotice?: string;
  onDismissSessionNotice?: () => void;
  staffLoginFn?: typeof loginStaff;
  ownerSessionExpired?: boolean;
  ownerAuthError?: string;
  ownerOidcExchanging?: boolean;
  onDismissOwnerAuthError?: () => void;
  ownerOidcStartFn?: typeof startOwnerOidcLogin;
  ownerRegisterStartFn?: typeof startMobileOwnerRegistration;
  ownerRegisterVerifyFn?: typeof completeMobileOwnerRegistrationVerification;
  ownerRegisterResendFn?: typeof resendMobileOwnerRegistrationCode;
  ownerResetRequestFn?: typeof defaultOwnerResetRequest;
  apiBaseUrl?: string;
  oidcConfigEnv?: Record<string, string | undefined>;
}

export function formatStaffLoginError(
  err: unknown,
  locale: 'vi' | 'en'
): string {
  const isEn = locale === 'en';
  if (err instanceof StaffAuthError) {
    if (err.status === 429 || err.code === 'STAFF_LOGIN_RATE_LIMITED') {
      if (typeof err.retryAfterSec === 'number' && err.retryAfterSec > 0) {
        return isEn
          ? `Too many failed sign-in attempts. Please wait ${err.retryAfterSec} seconds and try again.`
          : `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau ${err.retryAfterSec} giây.`;
      }
      return isEn
        ? 'Too many failed sign-in attempts. Please wait a few minutes and try again.'
        : 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng đợi ít phút rồi thử lại.';
    }
    if (err.status === 401 || err.code === 'INVALID_STAFF_CREDENTIALS') {
      if (isEn) {
        return 'The store slug/ID, username, or password is incorrect.';
      }
      return 'Mã cửa hàng (slug/ID), tên đăng nhập hoặc mật khẩu không đúng.';
    }
    if (err.code === 'NETWORK_ERROR') {
      return isEn
        ? 'Unable to connect. Check your internet connection and try again.'
        : 'Không thể kết nối. Vui lòng kiểm tra mạng rồi thử lại.';
    }
    if (
      err.status === 503 ||
      err.code === 'STAFF_LOGIN_RATE_LIMIT_UNAVAILABLE'
    ) {
      return isEn
        ? 'Staff sign-in is temporarily unavailable. Please try again shortly.'
        : 'Dịch vụ đăng nhập nhân viên đang tạm thời gián đoạn. Vui lòng thử lại sau.';
    }
    if (err.code === 'INVALID_STAFF_SESSION_RESPONSE') {
      return isEn
        ? 'We could not complete staff sign-in. Please try again or contact Qlaok support.'
        : 'Không thể hoàn tất đăng nhập nhân viên. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.';
    }
  }

  return isEn
    ? 'Unable to sign in. Check your details and try again, or contact Qlaok support.'
    : 'Không thể đăng nhập. Vui lòng kiểm tra lại thông tin hoặc liên hệ hỗ trợ Qlaok.';
}

export const AuthScreen = memo(function AuthScreen({
  onStaffLoginSuccess,
  onOwnerLoginSuccess,
  initialAccountMode,
  initialOwnerFlowStep = 'sign_in',
  staffSessionExpired = false,
  sessionNotice,
  onDismissSessionNotice,
  staffLoginFn = loginStaff,
  ownerSessionExpired = false,
  ownerAuthError = '',
  ownerOidcExchanging = false,
  onDismissOwnerAuthError,
  ownerOidcStartFn = startOwnerOidcLogin,
  ownerRegisterStartFn = startMobileOwnerRegistration,
  ownerRegisterVerifyFn = completeMobileOwnerRegistrationVerification,
  ownerRegisterResendFn = resendMobileOwnerRegistrationCode,
  ownerResetRequestFn = defaultOwnerResetRequest,
  apiBaseUrl = API_BASE_URL,
  oidcConfigEnv,
}: AuthScreenProps = {}) {
  const { locale, t, tb } = useMobileI18n();
  const [accountMode, setAccountMode] = useState<MobileLoginAccountMode>(
    initialAccountMode ?? (staffSessionExpired ? 'staff' : 'owner')
  );
  const [ownerFlowStep, setOwnerFlowStep] =
    useState<MobileOwnerFlowStep>(initialOwnerFlowStep);
  const [loginHint, setLoginHint] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [registerFullName, setRegisterFullName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] =
    useState(false);
  const [registrationTicket, setRegistrationTicket] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [resendingCode, setResendingCode] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [duplicateEmailDetected, setDuplicateEmailDetected] = useState(false);
  const [ownerSuccessNotice, setOwnerSuccessNotice] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Staff sign-in state (strictly isolated from owner OIDC)
  const [shopIdentifier, setShopIdentifier] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffError, setStaffError] = useState('');

  useEffect(() => {
    if (staffSessionExpired) {
      setAccountMode('staff');
    } else if (ownerSessionExpired) {
      setAccountMode('owner');
    }
  }, [staffSessionExpired, ownerSessionExpired]);

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const timer = setTimeout(() => {
      setResendCooldownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [resendCooldownSec]);

  const oidcConfigResolution = resolveMobileZitadelOidcConfig(oidcConfigEnv);
  const isOwnerBusy = authLoading || ownerOidcExchanging || resendingCode;
  const canStartOwnerOidc = !isOwnerBusy && oidcConfigResolution.ok;

  const canSubmitStaff =
    !authLoading &&
    !ownerOidcExchanging &&
    shopIdentifier.trim().length > 0 &&
    staffUsername.trim().length > 0 &&
    staffPassword.length > 0;

  const handleStartOwnerOidc = async (mode: MobileOidcAuthMode) => {
    if (isOwnerBusy) return;
    setAuthError('');
    setOwnerSuccessNotice('');
    setDuplicateEmailDetected(false);
    onDismissOwnerAuthError?.();
    onDismissSessionNotice?.();

    if (!oidcConfigResolution.ok) {
      setAuthError(
        locale === 'en'
          ? oidcConfigResolution.messageEn
          : oidcConfigResolution.messageVi
      );
      return;
    }

    if (mode === 'register') {
      if (loginHint.trim() && !registerEmail.trim()) {
        setRegisterEmail(loginHint.trim().toLowerCase());
      }
      setOwnerFlowStep('register_form');
      return;
    }

    setAuthLoading(true);
    try {
      await ownerOidcStartFn({
        mode,
        loginHint: loginHint.trim() || undefined,
        lang: locale === 'en' ? 'en' : 'vi',
        env: oidcConfigEnv,
      });
    } catch {
      setAuthError(t('auth.ownerSignInError'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleStartOwnerRegistration = async () => {
    if (isOwnerBusy) return;
    setAuthError('');
    setOwnerSuccessNotice('');
    setDuplicateEmailDetected(false);
    onDismissOwnerAuthError?.();
    onDismissSessionNotice?.();

    if (!oidcConfigResolution.ok) {
      setAuthError(
        locale === 'en'
          ? oidcConfigResolution.messageEn
          : oidcConfigResolution.messageVi
      );
      return;
    }

    const cleanFullName = registerFullName.trim();
    const cleanEmail = registerEmail.trim().toLowerCase();
    if (cleanFullName.length < 2) {
      setAuthError(
        tb(
          'Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự).',
          'Please enter your full name (at least 2 characters).'
        )
      );
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setAuthError(
        tb(
          'Vui lòng nhập địa chỉ email hợp lệ.',
          'Please enter a valid email address.'
        )
      );
      return;
    }
    if (
      registerPassword.length < 8 ||
      !/[a-z]/.test(registerPassword) ||
      !/[A-Z]/.test(registerPassword) ||
      !/[0-9]/.test(registerPassword) ||
      !/[^A-Za-z0-9\s]/.test(registerPassword)
    ) {
      setAuthError(
        tb(
          'Mật khẩu cần tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.',
          'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
        )
      );
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setAuthError(
        tb(
          'Mật khẩu xác nhận chưa khớp.',
          'Password confirmation does not match.'
        )
      );
      return;
    }

    setAuthLoading(true);
    try {
      const started = await ownerRegisterStartFn({
        baseUrl: apiBaseUrl,
        fullName: cleanFullName,
        email: cleanEmail,
        password: registerPassword,
        confirmPassword: registerConfirmPassword,
        lang: locale === 'en' ? 'en' : 'vi',
        env: oidcConfigEnv,
      });
      setRegistrationTicket(started.registrationTicket);
      setRegisterEmail(started.email || cleanEmail);
      setVerificationCode('');
      setResendCooldownSec(30);
      setOwnerFlowStep('verify_email');
      setOwnerSuccessNotice(
        t('auth.verifySentNotice', { email: started.email || cleanEmail })
      );
    } catch (err) {
      if (
        err instanceof MobileOwnerOidcError &&
        err.code === 'EMAIL_ALREADY_EXISTS'
      ) {
        setDuplicateEmailDetected(true);
      }
      setAuthError(
        err instanceof Error && err.message
          ? err.message
          : tb(
              'Chưa thể tạo tài khoản lúc này. Vui lòng thử lại.',
              'Could not create your account right now. Please try again.'
            )
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOwnerRegistration = async () => {
    if (isOwnerBusy) return;
    setAuthError('');
    setOwnerSuccessNotice('');
    onDismissOwnerAuthError?.();

    const cleanCode = verificationCode.trim();
    if (!cleanCode) {
      setAuthError(
        tb(
          'Vui lòng nhập mã xác thực từ email của bạn.',
          'Please enter the verification code from your email.'
        )
      );
      return;
    }

    setAuthLoading(true);
    try {
      const session = await ownerRegisterVerifyFn({
        baseUrl: apiBaseUrl,
        registrationTicket,
        verificationCode: cleanCode,
        password: registerPassword,
        lang: locale === 'en' ? 'en' : 'vi',
      });
      setRegisterPassword('');
      setRegisterConfirmPassword('');
      setShowRegisterPassword(false);
      setShowRegisterConfirmPassword(false);
      setVerificationCode('');
      setRegistrationTicket('');
      setResendCooldownSec(0);
      onOwnerLoginSuccess?.(session);
    } catch (err) {
      if (
        err instanceof MobileOwnerOidcError &&
        err.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED'
      ) {
        setLoginHint(registerEmail.trim().toLowerCase());
        setOwnerFlowStep('sign_in');
        setRegistrationTicket('');
        setVerificationCode('');
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        setShowRegisterPassword(false);
        setShowRegisterConfirmPassword(false);
        setResendCooldownSec(0);
        setAuthError('');
        setOwnerSuccessNotice(
          err.message ||
            tb(
              'Email đã được xác thực thành công. Vui lòng đăng nhập để tiếp tục.',
              'Your email has been verified. Please sign in to continue.'
            )
        );
        return;
      }
      if (
        err instanceof MobileOwnerOidcError &&
        (err.code === 'REGISTRATION_EXPIRED' ||
          err.code === 'REGISTRATION_TICKET_INVALID' ||
          err.code === 'AUTH_REQUEST_INVALID')
      ) {
        setOwnerFlowStep('register_form');
        setRegistrationTicket('');
        setResendCooldownSec(0);
      }
      setAuthError(
        err instanceof Error && err.message
          ? err.message
          : tb(
              'Mã xác thực chưa đúng hoặc đã hết hạn. Vui lòng thử lại.',
              'The verification code is incorrect or expired. Please try again.'
            )
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendOwnerVerificationCode = async () => {
    if (isOwnerBusy || resendCooldownSec > 0 || !registrationTicket) return;
    setAuthError('');
    setOwnerSuccessNotice('');
    setResendingCode(true);
    try {
      const resent = await ownerRegisterResendFn({
        baseUrl: apiBaseUrl,
        registrationTicket,
        lang: locale === 'en' ? 'en' : 'vi',
      });
      setResendCooldownSec(30);
      setOwnerSuccessNotice(
        t('auth.verifyResentNotice', {
          email: resent.email || registerEmail.trim().toLowerCase(),
        })
      );
    } catch (err) {
      if (
        err instanceof MobileOwnerOidcError &&
        err.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED'
      ) {
        setLoginHint(registerEmail.trim().toLowerCase());
        setOwnerFlowStep('sign_in');
        setRegistrationTicket('');
        setVerificationCode('');
        setRegisterPassword('');
        setRegisterConfirmPassword('');
        setShowRegisterPassword(false);
        setShowRegisterConfirmPassword(false);
        setResendCooldownSec(0);
        setAuthError('');
        setOwnerSuccessNotice(
          err.message ||
            tb(
              'Email đã được xác thực thành công. Vui lòng đăng nhập để tiếp tục.',
              'Your email has been verified. Please sign in to continue.'
            )
        );
        return;
      }
      if (
        err instanceof MobileOwnerOidcError &&
        (err.code === 'REGISTRATION_EXPIRED' ||
          err.code === 'REGISTRATION_TICKET_INVALID' ||
          err.code === 'AUTH_REQUEST_INVALID')
      ) {
        setOwnerFlowStep('register_form');
        setRegistrationTicket('');
        setResendCooldownSec(0);
      }
      setAuthError(
        err instanceof Error && err.message
          ? err.message
          : tb(
              'Chưa thể gửi lại mã xác thực lúc này. Vui lòng thử lại.',
              'Could not resend the verification code right now. Please try again.'
            )
      );
    } finally {
      setResendingCode(false);
    }
  };

  const handleRequestOwnerPasswordReset = async () => {
    if (isOwnerBusy) return;
    setAuthError('');
    setOwnerSuccessNotice('');
    onDismissOwnerAuthError?.();
    onDismissSessionNotice?.();

    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setAuthError(t('auth.recoveryErrInvalidEmail'));
      return;
    }

    setAuthLoading(true);
    try {
      await ownerResetRequestFn({
        baseUrl: apiBaseUrl,
        email: cleanEmail,
        lang: locale === 'en' ? 'en' : 'vi',
      });
      setResetSent(true);
      setAuthError('');
    } catch (err) {
      setAuthError(
        err instanceof Error && err.message
          ? err.message
          : tb(
              'Chưa thể gửi yêu cầu đặt lại mật khẩu lúc này. Vui lòng thử lại.',
              'Could not process password reset request right now. Please try again.'
            )
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleStaffLogin = async () => {
    if (
      !shopIdentifier.trim() ||
      !staffUsername.trim() ||
      !staffPassword ||
      authLoading
    ) {
      return;
    }
    setAuthLoading(true);
    setStaffError('');
    onDismissSessionNotice?.();
    try {
      const session = await staffLoginFn({
        shopIdentifier,
        username: staffUsername,
        password: staffPassword,
      });
      setStaffPassword('');
      setStaffError('');
      onStaffLoginSuccess?.(session);
    } catch (err) {
      setStaffError(formatStaffLoginError(err, locale === 'en' ? 'en' : 'vi'));
    } finally {
      setAuthLoading(false);
    }
  };

  const expiredNoticeText = staffSessionExpired
    ? sessionNotice?.trim() ||
      tb(
        'Phiên đăng nhập nhân viên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.',
        'Your staff session has expired or been revoked. Please sign in again.'
      )
    : ownerSessionExpired
      ? sessionNotice?.trim() || t('auth.ownerSessionExpiredNotice')
      : sessionNotice?.trim() || '';

  const combinedOwnerError =
    authError ||
    (ownerAuthError
      ? sanitizeOwnerUserFacingErrorMessage(
          ownerAuthError,
          t('auth.ownerSignInError')
        )
      : '');

  return (
    <SafeAreaView style={styles.authContainer}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingVertical: 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.authCard}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <MobileLanguageSwitcher variant="dark" />
          </View>
          <View style={[styles.logoBadge, { overflow: 'hidden' }]}>
            <Image
              source={qMenuLogo}
              alt="Qlaok"
              accessibilityLabel="Qlaok"
              resizeMode="cover"
              style={{ width: '100%', height: '100%' }}
            />
          </View>
          <Text style={styles.authTitle}>
            {accountMode === 'staff'
              ? tb('Qlaok Nhân viên', 'Qlaok Staff')
              : t('auth.title')}
          </Text>
          <Text style={styles.authSubtitle}>
            {accountMode === 'staff'
              ? tb(
                  'Đăng nhập bằng mã cửa hàng hoặc liên kết và tài khoản nhân viên để hỗ trợ gọi món tại bàn',
                  'Sign in with your store slug, ID, or link and staff account to help with table orders'
                )
              : ownerFlowStep === 'verify_email'
                ? t('auth.verifySubtitle', {
                    email: registerEmail.trim().toLowerCase(),
                  })
                : ownerFlowStep === 'register_form'
                  ? t('auth.registerSubtitle')
                  : ownerFlowStep === 'forgot_password'
                    ? t('auth.recoverySubtitle')
                    : t('auth.oidcSubtitle')}
          </Text>

          {/* Two-mode switch: Owner vs Staff */}
          <View
            accessibilityRole="tablist"
            accessibilityLabel={tb(
              'Chế độ đăng nhập Chủ quán hoặc Nhân viên',
              'Owner or Staff sign-in mode'
            )}
            style={{
              flexDirection: 'row',
              backgroundColor: '#020617',
              borderRadius: 12,
              padding: 4,
              borderWidth: 1,
              borderColor: '#334155',
              marginBottom: 18,
              gap: 6,
            }}
          >
            <TouchableOpacity
              testID="auth-mode-owner"
              accessibilityRole="tab"
              accessibilityState={{ selected: accountMode === 'owner' }}
              accessibilityLabel={tb('Chủ quán', 'Shop Owner')}
              disabled={isOwnerBusy}
              onPress={() => {
                setAccountMode('owner');
                setAuthError('');
                setStaffError('');
                onDismissOwnerAuthError?.();
                onDismissSessionNotice?.();
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 10,
                borderRadius: 9,
                alignItems: 'center',
                backgroundColor:
                  accountMode === 'owner' ? '#10b981' : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '800',
                  color: accountMode === 'owner' ? '#020617' : '#cbd5e1',
                }}
              >
                {tb('Chủ quán', 'Shop Owner')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="auth-mode-staff"
              accessibilityRole="tab"
              accessibilityState={{ selected: accountMode === 'staff' }}
              accessibilityLabel={tb('Nhân viên', 'Staff')}
              disabled={isOwnerBusy}
              onPress={() => {
                setAccountMode('staff');
                setAuthError('');
                setStaffError('');
                onDismissOwnerAuthError?.();
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 10,
                borderRadius: 9,
                alignItems: 'center',
                backgroundColor:
                  accountMode === 'staff' ? '#10b981' : 'transparent',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '800',
                  color: accountMode === 'staff' ? '#020617' : '#cbd5e1',
                }}
              >
                {tb('Nhân viên', 'Staff')}
              </Text>
            </TouchableOpacity>
          </View>

          {expiredNoticeText ? (
            <View
              testID={
                staffSessionExpired
                  ? 'staff-session-expired-notice'
                  : 'owner-session-expired-notice'
              }
              accessibilityRole="alert"
              style={{
                backgroundColor: '#451a03',
                borderColor: '#f59e0b',
                borderWidth: 1,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 14,
              }}
            >
              <Text
                style={{
                  color: '#fde68a',
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                {expiredNoticeText}
              </Text>
            </View>
          ) : null}

          {accountMode === 'staff' ? (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {tb('Mã cửa hàng (slug/ID) hoặc liên kết', 'Store slug, ID, or link')}
                </Text>
                <TextInput
                  testID="staff-shop-identifier-input"
                  accessibilityLabel={tb(
                    'Mã cửa hàng (slug/ID) hoặc liên kết',
                    'Store slug, ID, or link'
                  )}
                  placeholder={tb(
                    'VD: pho-hoi-an',
                    'e.g. pho-hoi-an'
                  )}
                  placeholderTextColor="#64748b"
                  style={styles.authInput}
                  value={shopIdentifier}
                  onChangeText={(next) => {
                    setShopIdentifier(next);
                    if (staffError) setStaffError('');
                    onDismissSessionNotice?.();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {tb('Tên đăng nhập nhân viên', 'Staff Username')}
                </Text>
                <TextInput
                  testID="staff-username-input"
                  accessibilityLabel={tb(
                    'Tên đăng nhập nhân viên',
                    'Staff Username'
                  )}
                  placeholder={tb('VD: phuc_vu_01', 'e.g. staff_01')}
                  placeholderTextColor="#64748b"
                  autoComplete="username"
                  style={styles.authInput}
                  value={staffUsername}
                  onChangeText={(next) => {
                    setStaffUsername(next);
                    if (staffError) setStaffError('');
                    onDismissSessionNotice?.();
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>
                  {tb('Mật khẩu', 'Password')}
                </Text>
                <TextInput
                  testID="staff-password-input"
                  accessibilityLabel={tb('Mật khẩu', 'Password')}
                  autoComplete="current-password"
                  style={styles.authInput}
                  value={staffPassword}
                  onChangeText={(next) => {
                    setStaffPassword(next);
                    if (staffError) setStaffError('');
                    onDismissSessionNotice?.();
                  }}
                  secureTextEntry
                />
              </View>

              {staffError ? (
                <Text
                  testID="staff-auth-error"
                  accessibilityRole="alert"
                  style={{ color: '#fca5a5', marginBottom: 12 }}
                >
                  {staffError}
                </Text>
              ) : null}

              <TouchableOpacity
                testID="staff-login-submit-btn"
                accessibilityRole="button"
                style={[
                  styles.primaryAuthBtn,
                  !canSubmitStaff && { opacity: 0.5 },
                ]}
                onPress={() => void handleStaffLogin()}
                disabled={!canSubmitStaff}
              >
                <Text style={styles.primaryAuthBtnText}>
                  {authLoading
                    ? tb('Đang đăng nhập...', 'Signing in...')
                    : tb('Đăng nhập nhân viên', 'Sign in as Staff')}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: '#064e3b',
                  borderColor: '#10b981',
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{
                    color: '#6ee7b7',
                    fontSize: 11,
                    fontWeight: '800',
                  }}
                >
                  {ownerFlowStep === 'verify_email'
                    ? t('auth.verifyBadge')
                    : ownerFlowStep === 'register_form'
                      ? t('auth.registerBadge')
                      : ownerFlowStep === 'forgot_password'
                        ? t('auth.recoveryTitle')
                        : t('auth.oidcBadge')}
                </Text>
              </View>

              {!oidcConfigResolution.ok &&
              ownerFlowStep !== 'forgot_password' ? (
                <View
                  testID="owner-oidc-config-error"
                  accessibilityRole="alert"
                  style={{
                    backgroundColor: '#450a0a',
                    borderColor: '#f87171',
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 14,
                  }}
                >
                  <Text
                    style={{
                      color: '#fecaca',
                      fontSize: 12,
                      fontWeight: '800',
                      marginBottom: 4,
                    }}
                  >
                    {t('auth.oidcConfigMissingTitle')}
                  </Text>
                  <Text
                    style={{
                      color: '#fca5a5',
                      fontSize: 12,
                    }}
                  >
                    {locale === 'en'
                      ? oidcConfigResolution.messageEn
                      : oidcConfigResolution.messageVi}
                  </Text>
                </View>
              ) : null}

              {ownerSuccessNotice ? (
                <View
                  testID="owner-auth-success"
                  accessibilityRole="alert"
                  style={{
                    backgroundColor: '#064e3b',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{
                      color: '#a7f3d0',
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {ownerSuccessNotice}
                  </Text>
                </View>
              ) : null}

              {ownerFlowStep === 'register_form' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      {t('auth.registerFullNameLabel')}
                    </Text>
                    <TextInput
                      testID="owner-register-full-name-input"
                      accessibilityLabel={t('auth.registerFullNameLabel')}
                      placeholder={t('auth.registerFullNamePlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="name"
                      style={styles.authInput}
                      value={registerFullName}
                      onChangeText={(next) => {
                        setRegisterFullName(next);
                        if (authError) setAuthError('');
                        onDismissOwnerAuthError?.();
                      }}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      {t('auth.registerEmailLabel')}
                    </Text>
                    <TextInput
                      testID="owner-register-email-input"
                      accessibilityLabel={t('auth.registerEmailLabel')}
                      placeholder={t('auth.oidcEmailHintPlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="email"
                      style={styles.authInput}
                      value={registerEmail}
                      onChangeText={(next) => {
                        setRegisterEmail(next);
                        if (authError) setAuthError('');
                        if (duplicateEmailDetected) {
                          setDuplicateEmailDetected(false);
                        }
                        onDismissOwnerAuthError?.();
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={styles.label}>
                        {t('auth.registerPasswordLabel')}
                      </Text>
                      <TouchableOpacity
                        testID="owner-register-password-toggle"
                        accessibilityRole="button"
                        accessibilityState={{ selected: showRegisterPassword }}
                        accessibilityLabel={
                          showRegisterPassword
                            ? tb('Ẩn mật khẩu', 'Hide password')
                            : tb('Hiện mật khẩu', 'Show password')
                        }
                        onPress={() =>
                          setShowRegisterPassword((prev) => !prev)
                        }
                        style={{ paddingVertical: 2, paddingHorizontal: 6 }}
                      >
                        <Text
                          style={{
                            color: '#34d399',
                            fontSize: 12,
                            fontWeight: '700',
                          }}
                        >
                          {showRegisterPassword
                            ? tb('Ẩn', 'Hide')
                            : tb('Hiện', 'Show')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      testID="owner-register-password-input"
                      accessibilityLabel={t('auth.registerPasswordLabel')}
                      placeholder={t('auth.registerPasswordPlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="new-password"
                      style={styles.authInput}
                      value={registerPassword}
                      onChangeText={(next) => {
                        setRegisterPassword(next);
                        if (authError) setAuthError('');
                        onDismissOwnerAuthError?.();
                      }}
                      secureTextEntry={!showRegisterPassword}
                    />
                    <Text
                      style={{
                        color: '#94a3b8',
                        fontSize: 11,
                        marginTop: 4,
                      }}
                    >
                      {t('auth.registerPasswordHint')}
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={styles.label}>
                        {t('auth.registerConfirmPasswordLabel')}
                      </Text>
                      <TouchableOpacity
                        testID="owner-register-confirm-password-toggle"
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: showRegisterConfirmPassword,
                        }}
                        accessibilityLabel={
                          showRegisterConfirmPassword
                            ? tb(
                                'Ẩn mật khẩu xác nhận',
                                'Hide confirm password'
                              )
                            : tb(
                                'Hiện mật khẩu xác nhận',
                                'Show confirm password'
                              )
                        }
                        onPress={() =>
                          setShowRegisterConfirmPassword((prev) => !prev)
                        }
                        style={{ paddingVertical: 2, paddingHorizontal: 6 }}
                      >
                        <Text
                          style={{
                            color: '#34d399',
                            fontSize: 12,
                            fontWeight: '700',
                          }}
                        >
                          {showRegisterConfirmPassword
                            ? tb('Ẩn', 'Hide')
                            : tb('Hiện', 'Show')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      testID="owner-register-confirm-password-input"
                      accessibilityLabel={t(
                        'auth.registerConfirmPasswordLabel'
                      )}
                      placeholder={t('auth.registerConfirmPasswordPlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="new-password"
                      style={styles.authInput}
                      value={registerConfirmPassword}
                      onChangeText={(next) => {
                        setRegisterConfirmPassword(next);
                        if (authError) setAuthError('');
                        onDismissOwnerAuthError?.();
                      }}
                      secureTextEntry={!showRegisterConfirmPassword}
                    />
                  </View>

                  {combinedOwnerError ? (
                    <View style={{ marginBottom: 12 }}>
                      <Text
                        testID="owner-auth-error"
                        accessibilityRole="alert"
                        style={{ color: '#fca5a5' }}
                      >
                        {combinedOwnerError}
                      </Text>
                      {duplicateEmailDetected ? (
                        <TouchableOpacity
                          testID="owner-register-duplicate-switch-btn"
                          accessibilityRole="button"
                          onPress={() => {
                            setLoginHint(registerEmail.trim().toLowerCase());
                            setOwnerFlowStep('sign_in');
                            setDuplicateEmailDetected(false);
                            setAuthError('');
                          }}
                          style={{ marginTop: 6 }}
                        >
                          <Text
                            style={{
                              color: '#fcd34d',
                              fontSize: 12,
                              fontWeight: '700',
                              textDecorationLine: 'underline',
                            }}
                          >
                            {t('auth.registerDuplicateSwitchBtn')}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}

                  <TouchableOpacity
                    testID="owner-register-submit-btn"
                    accessibilityRole="button"
                    style={[
                      styles.primaryAuthBtn,
                      !canStartOwnerOidc && { opacity: 0.5 },
                    ]}
                    onPress={() => void handleStartOwnerRegistration()}
                    disabled={!canStartOwnerOidc}
                  >
                    <Text style={styles.primaryAuthBtnText}>
                      {authLoading
                        ? t('auth.registerSubmitting')
                        : t('auth.registerSubmitBtn')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="owner-register-back-btn"
                    accessibilityRole="button"
                    disabled={isOwnerBusy}
                    onPress={() => {
                      setOwnerFlowStep('sign_in');
                      setAuthError('');
                      setOwnerSuccessNotice('');
                      setDuplicateEmailDetected(false);
                    }}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text
                      style={{
                        color: '#34d399',
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      {t('auth.registerBackToSignIn')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : ownerFlowStep === 'verify_email' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      {t('auth.verifyCodeLabel')}
                    </Text>
                    <TextInput
                      testID="owner-register-verify-code-input"
                      accessibilityLabel={t('auth.verifyCodeLabel')}
                      placeholder={t('auth.verifyCodePlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      style={styles.authInput}
                      value={verificationCode}
                      onChangeText={(next) => {
                        setVerificationCode(next);
                        if (authError) setAuthError('');
                        onDismissOwnerAuthError?.();
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                  </View>

                  {combinedOwnerError ? (
                    <Text
                      testID="owner-auth-error"
                      accessibilityRole="alert"
                      style={{ color: '#fca5a5', marginBottom: 12 }}
                    >
                      {combinedOwnerError}
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    testID="owner-register-verify-submit-btn"
                    accessibilityRole="button"
                    style={[
                      styles.primaryAuthBtn,
                      !canStartOwnerOidc && { opacity: 0.5 },
                    ]}
                    onPress={() => void handleVerifyOwnerRegistration()}
                    disabled={!canStartOwnerOidc}
                  >
                    <Text style={styles.primaryAuthBtnText}>
                      {authLoading
                        ? t('auth.verifySubmitting')
                        : t('auth.verifySubmitBtn')}
                    </Text>
                  </TouchableOpacity>

                  <View
                    style={{
                      marginTop: 12,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <TouchableOpacity
                      testID="owner-register-resend-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy || resendCooldownSec > 0}
                      onPress={() => void handleResendOwnerVerificationCode()}
                    >
                      <Text
                        style={{
                          color:
                            isOwnerBusy || resendCooldownSec > 0
                              ? '#64748b'
                              : '#34d399',
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {resendingCode
                          ? t('auth.verifyResending')
                          : resendCooldownSec > 0
                            ? `${t('auth.verifyResendBtn')} (${resendCooldownSec}s)`
                            : t('auth.verifyResendBtn')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="owner-register-edit-info-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy}
                      onPress={() => {
                        setOwnerFlowStep('register_form');
                        setVerificationCode('');
                        setRegistrationTicket('');
                        setResendCooldownSec(0);
                        setAuthError('');
                        setOwnerSuccessNotice('');
                      }}
                    >
                      <Text
                        style={{
                          color: '#94a3b8',
                          fontSize: 12,
                          fontWeight: '600',
                        }}
                      >
                        {t('auth.verifyEditInfoBtn')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : ownerFlowStep === 'forgot_password' ? (
                resetSent ? (
                  <>
                    <View
                      testID="owner-reset-sent-notice"
                      accessibilityRole="alert"
                      style={{
                        backgroundColor: '#064e3b',
                        borderColor: '#10b981',
                        borderWidth: 1,
                        borderRadius: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        marginBottom: 14,
                      }}
                    >
                      <Text
                        style={{
                          color: '#a7f3d0',
                          fontSize: 13,
                          fontWeight: '700',
                          marginBottom: 6,
                        }}
                      >
                        {tb(
                          'Kiểm tra hộp thư của bạn',
                          'Check your email inbox'
                        )}
                      </Text>
                      <Text
                        style={{
                          color: '#6ee7b7',
                          fontSize: 12,
                          lineHeight: 18,
                        }}
                      >
                        {tb(
                          `Nếu tài khoản với email ${resetEmail.trim().toLowerCase()} tồn tại trong hệ thống, liên kết đặt lại mật khẩu đã được gửi đến hộp thư của bạn. Vui lòng mở email trên trình duyệt web để tạo mật khẩu mới.`,
                          `If an account exists for ${resetEmail.trim().toLowerCase()}, password reset instructions have been sent to your inbox. Please open the email in a web browser to set a new password.`
                        )}
                      </Text>
                    </View>

                    <TouchableOpacity
                      testID="owner-reset-resend-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy}
                      onPress={() => {
                        setResetSent(false);
                        setAuthError('');
                      }}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#334155',
                        backgroundColor: '#0f172a',
                        alignItems: 'center',
                        marginBottom: 10,
                      }}
                    >
                      <Text
                        style={{
                          color: '#e2e8f0',
                          fontSize: 13,
                          fontWeight: '700',
                        }}
                      >
                        {tb(
                          'Gửi lại hoặc nhập email khác',
                          'Resend or enter another email'
                        )}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="owner-reset-back-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy}
                      onPress={() => {
                        setOwnerFlowStep('sign_in');
                        setAuthError('');
                        setOwnerSuccessNotice('');
                        setResetSent(false);
                      }}
                      style={{ marginTop: 6, alignItems: 'center' }}
                    >
                      <Text
                        style={{
                          color: '#34d399',
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {t('auth.recoveryBackToLogin')}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>
                        {t('auth.registerEmailLabel')}
                      </Text>
                      <TextInput
                        testID="owner-reset-email-input"
                        accessibilityLabel={t('auth.registerEmailLabel')}
                        placeholder={t('auth.oidcEmailHintPlaceholder')}
                        placeholderTextColor="#64748b"
                        autoComplete="email"
                        style={styles.authInput}
                        value={resetEmail}
                        onChangeText={(next) => {
                          setResetEmail(next);
                          if (authError) setAuthError('');
                          onDismissOwnerAuthError?.();
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                      />
                    </View>

                    {combinedOwnerError ? (
                      <Text
                        testID="owner-auth-error"
                        accessibilityRole="alert"
                        style={{ color: '#fca5a5', marginBottom: 12 }}
                      >
                        {combinedOwnerError}
                      </Text>
                    ) : null}

                    <TouchableOpacity
                      testID="owner-reset-submit-btn"
                      accessibilityRole="button"
                      style={[
                        styles.primaryAuthBtn,
                        (isOwnerBusy || !resetEmail.trim()) && { opacity: 0.5 },
                      ]}
                      onPress={() => void handleRequestOwnerPasswordReset()}
                      disabled={isOwnerBusy || !resetEmail.trim()}
                    >
                      <Text style={styles.primaryAuthBtnText}>
                        {authLoading
                          ? t('auth.recoverySending')
                          : t('auth.recoverySendBtn')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      testID="owner-reset-back-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy}
                      onPress={() => {
                        setOwnerFlowStep('sign_in');
                        setAuthError('');
                        setOwnerSuccessNotice('');
                        setResetSent(false);
                      }}
                      style={{ marginTop: 14, alignItems: 'center' }}
                    >
                      <Text
                        style={{
                          color: '#34d399',
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {t('auth.recoveryBackToLogin')}
                      </Text>
                    </TouchableOpacity>
                  </>
                )
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>
                      {t('auth.oidcEmailHintLabel')}
                    </Text>
                    <TextInput
                      testID="owner-oidc-login-hint-input"
                      accessibilityLabel={t('auth.oidcEmailHintLabel')}
                      placeholder={t('auth.oidcEmailHintPlaceholder')}
                      placeholderTextColor="#64748b"
                      autoComplete="email"
                      style={styles.authInput}
                      value={loginHint}
                      onChangeText={(next) => {
                        setLoginHint(next);
                        if (authError) setAuthError('');
                        onDismissOwnerAuthError?.();
                      }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                  </View>

                  {combinedOwnerError ? (
                    <Text
                      testID="owner-auth-error"
                      accessibilityRole="alert"
                      style={{ color: '#fca5a5', marginBottom: 12 }}
                    >
                      {combinedOwnerError}
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    testID="owner-oidc-login-btn"
                    accessibilityRole="button"
                    style={[
                      styles.primaryAuthBtn,
                      !canStartOwnerOidc && { opacity: 0.5 },
                    ]}
                    onPress={() => void handleStartOwnerOidc('login')}
                    disabled={!canStartOwnerOidc}
                  >
                    <Text style={styles.primaryAuthBtnText}>
                      {ownerOidcExchanging
                        ? t('auth.oidcExchanging')
                        : authLoading
                          ? t('auth.oidcRedirecting')
                          : t('auth.oidcSignInBtn')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    testID="owner-oidc-register-btn"
                    accessibilityRole="button"
                    style={[
                      {
                        marginTop: 10,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#334155',
                        backgroundColor: '#0f172a',
                        alignItems: 'center',
                      },
                      !canStartOwnerOidc && { opacity: 0.5 },
                    ]}
                    onPress={() => void handleStartOwnerOidc('register')}
                    disabled={!canStartOwnerOidc}
                  >
                    <Text
                      style={{
                        color: '#e2e8f0',
                        fontSize: 13,
                        fontWeight: '700',
                      }}
                    >
                      {t('auth.oidcRegisterBtn')}
                    </Text>
                  </TouchableOpacity>

                  <View
                    style={{
                      marginTop: 14,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <TouchableOpacity
                      testID="owner-oidc-reset-btn"
                      accessibilityRole="button"
                      disabled={isOwnerBusy}
                      onPress={() => {
                        if (loginHint.trim() && !resetEmail.trim()) {
                          setResetEmail(loginHint.trim().toLowerCase());
                        }
                        setOwnerFlowStep('forgot_password');
                        setResetSent(false);
                        setAuthError('');
                        setOwnerSuccessNotice('');
                        onDismissOwnerAuthError?.();
                        onDismissSessionNotice?.();
                      }}
                    >
                      <Text
                        style={{
                          color: '#34d399',
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {t('auth.oidcForgotPasswordBtn')}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="link"
                      onPress={() => void Linking.openURL(apiBaseUrl)}
                    >
                      <Text
                        style={{
                          color: '#94a3b8',
                          fontSize: 12,
                          fontWeight: '600',
                        }}
                      >
                        {t('auth.createStorePrompt')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});
