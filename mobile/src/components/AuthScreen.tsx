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

export const AuthScreen = memo(function AuthScreen() {
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
        err instanceof Error
          ? err.message
          : 'Vui lòng kiểm tra lại email/mật khẩu'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.authContainer}>
      <StatusBar style="light" />
      <View style={styles.authCard}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>Q</Text>
        </View>
        <Text style={styles.authTitle}>Qlaok mPOS Mobile</Text>
        <Text style={styles.authSubtitle}>
          Ứng dụng Chủ quán &amp; Thu ngân nhận đơn QR tại bàn, quản lý khuyến
          mãi, Flash Sale &amp; doanh thu trực tiếp
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Chủ quán</Text>
          <TextInput
            accessibilityLabel="Email Chủ quán"
            autoComplete="email"
            style={styles.authInput}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            accessibilityLabel="Mật khẩu"
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
            {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập Quản lý Quán'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
});
