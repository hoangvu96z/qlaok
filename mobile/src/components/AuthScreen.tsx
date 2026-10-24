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
import { PRODUCTION_API_URL, supabase } from '../lib/supabase';
import {
  buildPasswordRecoveryRedirectUrl,
  completeMobilePasswordRecoveryWithCode,
  type PasswordRecoveryCodeFailureReason,
  type PasswordRecoveryFailureReason,
  requestMobilePasswordRecovery,
} from '../lib/auth-recovery';
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
}: AuthScreenProps = {}) {
  const { locale, t, tb } = useMobileI18n();
  const [accountMode, setAccountMode] = useState<MobileLoginAccountMode>(
    initialAccountMode ?? (staffSessionExpired ? 'staff' : 'owner')
  );
  const [mode, setMode] = useState<'login' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoverySentTo, setRecoverySentTo] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Staff sign-in state (strictly isolated from owner credentials)
  const [shopIdentifier, setShopIdentifier] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffError, setStaffError] = useState('');

  useEffect(() => {
    if (staffSessionExpired) {
      setAccountMode('staff');
    }
  }, [staffSessionExpired]);

  const canSubmit =
    !authLoading && email.trim().length > 0 && password.length > 0;
  const canSubmitStaff =
    !authLoading &&
    shopIdentifier.trim().length > 0 &&
    staffUsername.trim().length > 0 &&
    staffPassword.length > 0;
  const canSendRecovery = !authLoading && email.trim().length > 0;
  const canCompleteRecovery =
    !authLoading &&
    email.trim().length > 0 &&
    recoveryCode.trim().length >= 6 &&
    newPassword.length >= 6;

  const formatRecoveryFailure = (
    reason: PasswordRecoveryFailureReason | PasswordRecoveryCodeFailureReason,
    fallbackMessage?: string
  ): string => {
    switch (reason) {
      case 'invalid_email':
        return t('auth.recoveryErrInvalidEmail');
      case 'unsupported_account':
        return t('auth.recoveryErrUnsupportedAccount');
      case 'unsupported_provider':
        return t('auth.recoveryErrUnsupportedProvider');
      case 'rate_limited':
        return t('auth.recoveryErrRateLimited');
      case 'network_error':
        return t('auth.recoveryErrNetwork');
      case 'invalid_code':
        return t('auth.recoveryErrInvalidCode');
      case 'weak_password':
        return t('auth.recoveryErrWeakPassword');
      case 'provider_error':
      default:
        return fallbackMessage?.trim() || t('auth.recoveryErrUnsupportedProvider');
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password || authLoading) return;
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        throw error;
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : t('auth.errorFallback')
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const recoveryRedirectUrl =
    buildPasswordRecoveryRedirectUrl(PRODUCTION_API_URL);

  const handleSendRecovery = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const result = await requestMobilePasswordRecovery({
        email,
        redirectTo: recoveryRedirectUrl,
        authClient: supabase.auth,
      });
      if (!result.ok) {
        setAuthError(
          formatRecoveryFailure(result.reason, result.errorMessage)
        );
        return;
      }
      setRecoverySentTo(result.email);
      setAuthNotice(
        t('auth.recoverySentNotice', { email: result.email })
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCompleteRecovery = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      const result = await completeMobilePasswordRecoveryWithCode({
        email,
        code: recoveryCode,
        newPassword,
        authClient: supabase.auth,
      });
      if (!result.ok) {
        setAuthError(
          formatRecoveryFailure(result.reason, result.errorMessage)
        );
        return;
      }
      setPassword(newPassword);
      setRecoveryCode('');
      setNewPassword('');
      setRecoverySentTo(null);
      setMode('login');
      setAuthNotice(
        t('auth.recoverySuccessNotice', { email: result.email })
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
    : sessionNotice?.trim() || '';

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
              : mode === 'recovery'
                ? t('auth.recoveryTitle')
                : t('auth.title')}
          </Text>
          <Text style={styles.authSubtitle}>
            {accountMode === 'staff'
              ? tb(
                  'Đăng nhập bằng mã quán và tài khoản nhân viên để hỗ trợ gọi món tại bàn',
                  'Sign in with shop identifier and staff username for assisted table ordering'
                )
              : mode === 'recovery'
                ? t('auth.recoverySubtitle')
                : t('auth.subtitle')}
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
              disabled={authLoading}
              onPress={() => {
                setAccountMode('owner');
                setAuthError('');
                setAuthNotice('');
                setStaffError('');
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
              disabled={authLoading}
              onPress={() => {
                setAccountMode('staff');
                setMode('login');
                setAuthError('');
                setAuthNotice('');
                setStaffError('');
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
              testID="staff-session-expired-notice"
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
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('auth.emailLabel')}</Text>
                <TextInput
                  accessibilityLabel={t('auth.emailLabel')}
                  autoComplete="email"
                  style={styles.authInput}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              {mode === 'login' ? (
                <>
                  <View style={styles.inputGroup}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={styles.label}>{t('auth.passwordLabel')}</Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => {
                          setMode('recovery');
                          setAuthError('');
                          setAuthNotice('');
                        }}
                      >
                        <Text
                          style={{
                            color: '#34d399',
                            fontSize: 12,
                            fontWeight: '700',
                            marginBottom: 6,
                          }}
                        >
                          {t('auth.forgotPasswordPrompt')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      accessibilityLabel={t('auth.passwordLabel')}
                      autoComplete="current-password"
                      style={styles.authInput}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                    />
                  </View>

                  {authNotice ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: '#6ee7b7', marginBottom: 12, fontSize: 12 }}
                    >
                      {authNotice}
                    </Text>
                  ) : null}

                  {authError ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: '#fca5a5', marginBottom: 12 }}
                    >
                      {authError}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.primaryAuthBtn, !canSubmit && { opacity: 0.5 }]}
                    onPress={() => handleLogin()}
                    disabled={!canSubmit}
                  >
                    <Text style={styles.primaryAuthBtnText}>
                      {authLoading ? t('auth.submitting') : t('auth.submit')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(PRODUCTION_API_URL)}
                    style={{ marginTop: 16, alignItems: 'center' }}
                  >
                    <Text
                      style={{
                        color: '#34d399',
                        fontSize: 12,
                        fontWeight: '700',
                        textAlign: 'center',
                      }}
                    >
                      {t('auth.createStorePrompt')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {authNotice ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: '#6ee7b7', marginBottom: 12, fontSize: 12 }}
                    >
                      {authNotice}
                    </Text>
                  ) : null}

                  {authError ? (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: '#fca5a5', marginBottom: 12 }}
                    >
                      {authError}
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[
                      styles.primaryAuthBtn,
                      !canSendRecovery && { opacity: 0.5 },
                    ]}
                    onPress={() => handleSendRecovery()}
                    disabled={!canSendRecovery}
                  >
                    <Text style={styles.primaryAuthBtnText}>
                      {authLoading
                        ? t('auth.recoverySending')
                        : t('auth.recoverySendBtn')}
                    </Text>
                  </TouchableOpacity>

                  {recoverySentTo ? (
                    <View style={{ marginTop: 14 }}>
                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>
                          {t('auth.recoveryCodeLabel')}
                        </Text>
                        <TextInput
                          accessibilityLabel={t('auth.recoveryCodeLabel')}
                          style={styles.authInput}
                          value={recoveryCode}
                          onChangeText={setRecoveryCode}
                          autoCapitalize="none"
                          keyboardType="number-pad"
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.label}>
                          {t('auth.recoveryNewPasswordLabel')}
                        </Text>
                        <TextInput
                          accessibilityLabel={t('auth.recoveryNewPasswordLabel')}
                          style={styles.authInput}
                          value={newPassword}
                          onChangeText={setNewPassword}
                          secureTextEntry
                        />
                      </View>

                      <TouchableOpacity
                        accessibilityRole="button"
                        style={[
                          styles.primaryAuthBtn,
                          !canCompleteRecovery && { opacity: 0.5 },
                        ]}
                        onPress={() => handleCompleteRecovery()}
                        disabled={!canCompleteRecovery}
                      >
                        <Text style={styles.primaryAuthBtnText}>
                          {authLoading
                            ? t('auth.recoveryCompleting')
                            : t('auth.recoveryCompleteBtn')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(recoveryRedirectUrl)}
                    style={{ marginTop: 14, alignItems: 'center' }}
                  >
                    <Text
                      style={{
                        color: '#94a3b8',
                        fontSize: 12,
                        fontWeight: '600',
                        textAlign: 'center',
                      }}
                    >
                      {t('auth.recoveryOpenWebFallback')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => {
                      setMode('login');
                      setAuthError('');
                    }}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text
                      style={{
                        color: '#34d399',
                        fontSize: 12,
                        fontWeight: '700',
                        textAlign: 'center',
                      }}
                    >
                      {t('auth.recoveryBackToLogin')}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});
