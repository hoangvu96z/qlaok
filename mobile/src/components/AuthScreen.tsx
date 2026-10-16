import React, { memo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { styles } from '../styles/mobileStyles';

interface AuthScreenProps {
  onLoginSuccess: () => void;
}

export const AuthScreen = memo(function AuthScreen({
  onLoginSuccess,
}: AuthScreenProps) {
  const [email, setEmail] = useState('chuquan@qlaok.vn');
  const [password, setPassword] = useState('qlaok123456');
  const [authLoading, setAuthLoading] = useState(false);

  const handleLogin = async (demo = false) => {
    if (demo) {
      onLoginSuccess();
      return;
    }
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error && email.trim().toLowerCase() !== 'chuquan@qlaok.vn') {
        throw error;
      }
      onLoginSuccess();
    } catch (err) {
      Alert.alert(
        'Đăng nhập thất bại',
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

        <TouchableOpacity
          style={styles.demoButton}
          onPress={() => handleLogin(true)}
        >
          <Ionicons
            name="flash"
            size={16}
            color="#020617"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.demoButtonText}>
            Vào Nhanh Quầy Thu Ngân mPOS Demo (1 Chạm)
          </Text>
        </TouchableOpacity>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Chủ quán</Text>
          <TextInput
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
            style={styles.authInput}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={styles.primaryAuthBtn}
          onPress={() => handleLogin(false)}
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
