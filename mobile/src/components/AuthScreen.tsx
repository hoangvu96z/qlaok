import React, { memo, useState } from 'react';
import {
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from '../lib/supabase';
import { styles } from '../styles/mobileStyles';
import { MobileLanguageSwitcher, useMobileI18n } from './MobileI18nProvider';

export const AuthScreen = memo(function AuthScreen() {
  const { t } = useMobileI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleLogin = async () => {
    setAuthLoading(true);
    setAuthError('');
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

  return (
    <SafeAreaView style={styles.authContainer}>
      <StatusBar style="light" />
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
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>Q</Text>
        </View>
        <Text style={styles.authTitle}>{t('auth.title')}</Text>
        <Text style={styles.authSubtitle}>{t('auth.subtitle')}</Text>

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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>{t('auth.passwordLabel')}</Text>
          <TextInput
            accessibilityLabel={t('auth.passwordLabel')}
            autoComplete="current-password"
            style={styles.authInput}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {authError ? <Text accessibilityRole="alert" style={{ color: '#fca5a5', marginBottom: 12 }}>{authError}</Text> : null}
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.primaryAuthBtn}
          onPress={() => handleLogin()}
          disabled={authLoading}
        >
          <Text style={styles.primaryAuthBtnText}>
            {authLoading ? t('auth.submitting') : t('auth.submit')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
});
