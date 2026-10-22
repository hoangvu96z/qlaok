import React, { memo, useState } from 'react';
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
import { PRODUCTION_API_URL, supabase } from '../lib/supabase';
import {
  buildPasswordRecoveryRedirectUrl,
  completeMobilePasswordRecoveryWithCode,
  type PasswordRecoveryCodeFailureReason,
  type PasswordRecoveryFailureReason,
  requestMobilePasswordRecovery,
} from '../lib/auth-recovery';
import { styles } from '../styles/mobileStyles';
import { MobileLanguageSwitcher, useMobileI18n } from './MobileI18nProvider';

export const AuthScreen = memo(function AuthScreen() {
  const { t } = useMobileI18n();
  const [mode, setMode] = useState<'login' | 'recovery'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoverySentTo, setRecoverySentTo] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const canSubmit =
    !authLoading && email.trim().length > 0 && password.length > 0;
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
              source={require('../../assets/q-menu.png')}
              accessibilityLabel="Qlaok"
              resizeMode="cover"
              style={{ width: '100%', height: '100%' }}
            />
          </View>
          <Text style={styles.authTitle}>
            {mode === 'recovery' ? t('auth.recoveryTitle') : t('auth.title')}
          </Text>
          <Text style={styles.authSubtitle}>
            {mode === 'recovery'
              ? t('auth.recoverySubtitle')
              : t('auth.subtitle')}
          </Text>

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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});
