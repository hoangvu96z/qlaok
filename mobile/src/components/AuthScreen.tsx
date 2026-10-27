import React, { memo, useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import qMenuLogo from '../../assets/q-menu.png';
import { PRODUCTION_API_URL } from '../lib/supabase';
import {
  type MobileOidcAuthMode,
  MobileOwnerOidcError,
  resolveMobileZitadelOidcConfig,
  startOwnerOidcLogin,
} from '../lib/owner-session';
import {
  loginStaff,
  type MobileStaffSession,
  redactSensitiveText,
  StaffAuthError,
} from '../lib/staff-session';
import { styles } from '../styles/mobileStyles';
import { MobileLanguageSwitcher, useMobileI18n } from './MobileI18nProvider';

export type MobileLoginAccountMode = 'owner' | 'staff';

export interface AuthScreenProps {
  onStaffLoginSuccess?: (session: MobileStaffSession) => void;
  initialAccountMode?: MobileLoginAccountMode;
  staffSessionExpired?: boolean;
  sessionNotice?: string;
  onDismissSessionNotice?: () => void;
  staffLoginFn?: typeof loginStaff;
  ownerSessionExpired?: boolean;
  ownerAuthError?: string;
  ownerOidcExchanging?: boolean;
  onDismissOwnerAuthError?: () => void;
  ownerOidcStartFn?: typeof startOwnerOidcLogin;
  oidcConfigEnv?: Record<string, string | undefined>;
}

export function formatStaffLoginError(
  err: unknown,
  locale: 'vi' | 'en',
  secretsToRedact: ReadonlyArray<string | null | undefined> = []
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
        return 'Invalid shop identifier, username, or password.';
      }
      const cleanServerMsg = redactSensitiveText(
        err.message || '',
        secretsToRedact
      ).trim();
      return (
        cleanServerMsg ||
        'Thông tin cửa hàng, tên đăng nhập hoặc mật khẩu không đúng.'
      );
    }
    if (err.code === 'NETWORK_ERROR') {
      return isEn
        ? 'Unable to connect to the authentication server. Please check your network and try again.'
        : 'Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra mạng và thử lại.';
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
        ? 'Received an invalid staff session response from the server.'
        : 'Phản hồi phiên đăng nhập nhân viên từ máy chủ không hợp lệ.';
    }
  }

  const rawMsg = err instanceof Error && err.message ? err.message : '';
  const safeMsg = redactSensitiveText(rawMsg, secretsToRedact).trim();
  if (safeMsg && !isEn) {
    return safeMsg;
  }
  if (safeMsg && isEn && !/[^\x00-\x7F]/.test(safeMsg)) {
    return safeMsg;
  }
  return isEn
    ? 'Unable to sign in with staff credentials. Please check your details and try again.'
    : safeMsg || 'Đăng nhập nhân viên thất bại. Vui lòng kiểm tra lại thông tin.';
}

export const AuthScreen = memo(function AuthScreen({
  onStaffLoginSuccess,
  initialAccountMode,
  staffSessionExpired = false,
  sessionNotice,
  onDismissSessionNotice,
  staffLoginFn = loginStaff,
  ownerSessionExpired = false,
  ownerAuthError = '',
  ownerOidcExchanging = false,
  onDismissOwnerAuthError,
  ownerOidcStartFn = startOwnerOidcLogin,
  oidcConfigEnv,
}: AuthScreenProps = {}) {
  const { locale, t, tb } = useMobileI18n();
  const [accountMode, setAccountMode] = useState<MobileLoginAccountMode>(
    initialAccountMode ?? (staffSessionExpired ? 'staff' : 'owner')
  );
  const [loginHint, setLoginHint] = useState('');
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

  const oidcConfigResolution = resolveMobileZitadelOidcConfig(oidcConfigEnv);
  const isOwnerBusy = authLoading || ownerOidcExchanging;
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

    setAuthLoading(true);
    try {
      await ownerOidcStartFn({
        mode,
        loginHint: loginHint.trim() || undefined,
        lang: locale === 'en' ? 'en' : 'vi',
        env: oidcConfigEnv,
      });
    } catch (err) {
      if (err instanceof MobileOwnerOidcError) {
        setAuthError(err.message);
      } else {
        setAuthError(
          err instanceof Error && err.message
            ? err.message
            : t('auth.recoveryErrNetwork')
        );
      }
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
      setStaffError(
        formatStaffLoginError(err, locale === 'en' ? 'en' : 'vi', [
          staffPassword,
        ])
      );
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

  const combinedOwnerError = authError || ownerAuthError;

  return (
    <SafeAreaView style={styles.authContainer}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'center' }}
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
                  'Đăng nhập bằng mã quán và tài khoản nhân viên để hỗ trợ gọi món tại bàn',
                  'Sign in with shop identifier and staff username for assisted table ordering'
                )
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
                  {tb('Mã quán / Đường dẫn quán', 'Shop Identifier / Slug')}
                </Text>
                <TextInput
                  testID="staff-shop-identifier-input"
                  accessibilityLabel={tb(
                    'Mã quán / Đường dẫn quán',
                    'Shop Identifier / Slug'
                  )}
                  placeholder={tb(
                    'VD: pho-hoi-an hoặc /s/pho-hoi-an',
                    'e.g. pho-hoi-an or /s/pho-hoi-an'
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
                  {t('auth.oidcBadge')}
                </Text>
              </View>

              {!oidcConfigResolution.ok ? (
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('auth.oidcEmailHintLabel')}</Text>
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
                  disabled={!canStartOwnerOidc}
                  onPress={() => void handleStartOwnerOidc('reset')}
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
                  onPress={() => void Linking.openURL(PRODUCTION_API_URL)}
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});
