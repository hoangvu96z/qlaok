'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Mail,
  Lock,
  User,
  Phone,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Store,
} from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
} from '@/lib/auth-session';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import {
  resolvePostLoginRoute,
  sanitizeNextPath,
} from '@/lib/post-login-route';
import { BrandLogo } from '@/components/ui/BrandLogo';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';
import {
  buildPasswordRecoveryRedirectUrl,
  completeMobilePasswordRecoveryWithCode,
  completePasswordRecoverySession,
  formatGenericPasswordRecoveryNotice,
  parseRecoveryUrlSignals,
  type PasswordRecoveryCodeFailureReason,
  type PasswordRecoveryFailureReason,
  requestMobilePasswordRecovery,
  resolveLoginAuthMode,
  type WebLoginAuthMode,
} from '@/lib/auth-recovery';

type AuthMode = WebLoginAuthMode;

/**
 * Keeps the previously selected shop when it is still accessible (owned or
 * member), otherwise selects the first accessible shop.
 */
function rememberActiveShop(
  fallbackShopId: string | null,
  data: { shops?: Array<{ id: string }>; memberShops?: Array<{ id: string }> }
) {
  if (typeof window === 'undefined' || !fallbackShopId) return;
  const accessible = new Set(
    [...(data.shops || []), ...(data.memberShops || [])].map((s) => s.id)
  );
  const saved = localStorage.getItem('qlaok_active_shop_id');
  if (!saved || !accessible.has(saved)) {
    localStorage.setItem('qlaok_active_shop_id', fallbackShopId);
  }
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, tx } = useAppI18n();
  const initialMode: AuthMode = resolveLoginAuthMode({
    searchParams,
    hash: typeof window !== 'undefined' ? window.location.hash : null,
  });
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [shopIdentifier, setShopIdentifier] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const supabaseEnabled = isSupabaseConfigured();

  const formatWebRecoveryFailure = (
    reason: PasswordRecoveryFailureReason | PasswordRecoveryCodeFailureReason,
    fallbackMessage?: string
  ): string => {
    switch (reason) {
      case 'invalid_email':
        return tx(
          'Vui lòng nhập địa chỉ email hợp lệ để đặt lại mật khẩu.',
          'Please enter a valid email address to reset your password.'
        );
      case 'unsupported_account':
        return (
          fallbackMessage?.trim() ||
          tx(
            'Tài khoản dùng thử, quản trị hệ thống hoặc tài khoản mật khẩu cục bộ không hỗ trợ tự đặt lại mật khẩu qua email.',
            'Demo, system, or custom-credential accounts do not support self-service password reset via email.'
          )
        );
      case 'unsupported_provider':
        return tx(
          'Khôi phục mật khẩu qua email chưa được bật trên môi trường này. Vui lòng liên hệ quản trị viên.',
          'Email password reset is not enabled in this environment. Please contact your administrator.'
        );
      case 'rate_limited':
        return tx(
          'Bạn đã gửi quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng đợi vài phút rồi thử lại.',
          'Too many password reset requests. Please wait a few minutes and try again.'
        );
      case 'network_error':
        return tx(
          'Không thể kết nối máy chủ xác thực. Vui lòng kiểm tra kết nối mạng và thử lại.',
          'Unable to reach the authentication server. Please check your connection and try again.'
        );
      case 'invalid_code':
        return tx(
          'Mã khôi phục không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại email.',
          'The recovery code is invalid or expired. Please check your email and try again.'
        );
      case 'weak_password':
        return tx(
          'Mật khẩu mới phải có ít nhất 6 ký tự.',
          'New password must be at least 6 characters.'
        );
      case 'password_mismatch':
        return tx(
          'Mật khẩu xác nhận không khớp với mật khẩu mới.',
          'Confirmation password does not match the new password.'
        );
      case 'provider_error':
      default:
        return (
          fallbackMessage?.trim() ||
          tx(
            'Không thể xử lý yêu cầu đặt lại mật khẩu. Vui lòng thử lại.',
            'Could not complete password reset request. Please try again.'
          )
        );
    }
  };

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : null;
    const resolved = resolveLoginAuthMode({ searchParams, hash });
    const modeParam = searchParams.get('mode');
    if (
      resolved === 'reset' ||
      resolved === 'staff' ||
      modeParam === 'staff' ||
      modeParam === 'register' ||
      modeParam === 'otp' ||
      modeParam === 'login'
    ) {
      setMode(resolved);
    }
  }, [searchParams]);

  // Listen for Supabase PASSWORD_RECOVERY session and handle email link recovery tokens
  useEffect(() => {
    if (!supabaseEnabled) return;
    const supabase = createClient();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const currentSignals = parseRecoveryUrlSignals({
        searchParams,
        hash: typeof window !== 'undefined' ? window.location.hash : null,
      });
      if (
        event === 'PASSWORD_RECOVERY' ||
        (event === 'SIGNED_IN' && currentSignals.hasRecoveryCallbackSignal)
      ) {
        setMode('reset');
        setRecoverySessionReady(true);
        if (session?.user?.email) {
          setEmail(session.user.email);
        }
        setMessage({
          type: 'success',
          text: tx(
            'Phiên đặt lại mật khẩu đã sẵn sàng. Vui lòng nhập mật khẩu mới bên dưới.',
            'Password recovery session is ready. Please enter your new password below.'
          ),
        });
      }
    });

    const signals = parseRecoveryUrlSignals({
      searchParams,
      hash: typeof window !== 'undefined' ? window.location.hash : null,
    });

    if (signals.hashErrorDescription) {
      setMode('reset');
      setRecoverySessionReady(false);
      setMessage({
        type: 'error',
        text: tx(
          'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng gửi lại yêu cầu mới.',
          'The password reset link is invalid or has expired. Please request a new reset link.'
        ),
      });
    } else if (signals.tokenHash && signals.isResetMode) {
      setMode('reset');
      void supabase.auth
        .verifyOtp({
          token_hash: signals.tokenHash,
          type: 'recovery',
        })
        .then(({ data, error }) => {
          if (error) {
            setRecoverySessionReady(false);
            setMessage({
              type: 'error',
              text: tx(
                'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng gửi lại yêu cầu mới.',
                'The password reset link is invalid or has expired. Please request a new reset link.'
              ),
            });
            return;
          }
          setRecoverySessionReady(true);
          if (data?.user?.email) {
            setEmail(data.user.email);
          }
          setMessage({
            type: 'success',
            text: tx(
              'Phiên đặt lại mật khẩu đã sẵn sàng. Vui lòng nhập mật khẩu mới bên dưới.',
              'Password recovery session is ready. Please enter your new password below.'
            ),
          });
        });
    } else if (signals.isResetMode) {
      void (async () => {
        if (
          signals.code &&
          typeof supabase.auth.exchangeCodeForSession === 'function'
        ) {
          const existingSession = await supabase.auth.getSession();
          if (!existingSession.data?.session) {
            const exchanged = await supabase.auth.exchangeCodeForSession(
              signals.code
            );
            if (exchanged.error) {
              setRecoverySessionReady(false);
              setMessage({
                type: 'error',
                text: tx(
                  'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng gửi lại yêu cầu mới.',
                  'The password reset link is invalid or has expired. Please request a new reset link.'
                ),
              });
              return;
            }
          }
        }
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          setMode('reset');
          setRecoverySessionReady(true);
          if (data.session.user.email) {
            setEmail(data.session.user.email);
          }
        }
      })();
    }

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseEnabled, searchParams, tx]);

  // If already logged in, allow quick redirect or switching accounts
  useEffect(() => {
    const existing = getStoredAuthOwner();
    const signals = parseRecoveryUrlSignals({
      searchParams,
      hash: typeof window !== 'undefined' ? window.location.hash : null,
    });
    if (existing && !searchParams.get('switch') && !signals.isResetMode) {
      // Do not auto-redirect if user explicitly opened /login?mode=... or recovery flow
      if (!searchParams.get('mode') && mode !== 'reset' && mode !== 'staff') {
        router.replace(
          isSuperAdmin(existing)
            ? '/admin'
            : sanitizeNextPath(searchParams.get('next')) || '/dashboard'
        );
      }
    }
  }, [router, searchParams, mode]);

  const handleDemoLogin = async () => {
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'demo_login' }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) {
        throw new Error(
          data.error ||
            tx('Không thể mở tài khoản dùng thử.', 'Could not open demo account.')
        );
      }
      setStoredAuthOwner(data.user, data.accessToken);
      if (data.shops?.[0]?.id && typeof window !== 'undefined') {
        localStorage.setItem('qlaok_active_shop_id', data.shops[0].id);
      }
      router.push('/dashboard');
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : tx('Lỗi mở tài khoản dùng thử.', 'Failed to open demo account.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      if (mode === 'staff') {
        const cleanShopIdentifier = shopIdentifier.trim();
        const cleanUsername = staffUsername.trim();
        if (!cleanShopIdentifier) {
          throw new Error(
            tx(
              'Vui lòng nhập định danh cửa hàng (slug, ID hoặc liên kết).',
              'Please enter store identifier (slug, ID, or storefront URL).'
            )
          );
        }
        if (!cleanUsername) {
          throw new Error(
            tx(
              'Vui lòng nhập tên đăng nhập nhân viên.',
              'Please enter staff username.'
            )
          );
        }
        if (!staffPassword) {
          throw new Error(
            tx('Vui lòng nhập mật khẩu.', 'Please enter password.')
          );
        }

        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'staff_login',
            shopIdentifier: cleanShopIdentifier,
            username: cleanUsername,
            password: staffPassword,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.user) {
          throw new Error(
            data?.error ||
              tx(
                'Tên đăng nhập, cửa hàng hoặc mật khẩu không chính xác.',
                'Incorrect store identifier, username, or password.'
              )
          );
        }

        const activeShopId =
          data.activeShopId ||
          data.memberShops?.[0]?.id ||
          data.shops?.[0]?.id ||
          null;

        setStoredAuthOwner(data.user, data.accessToken);
        if (activeShopId && typeof window !== 'undefined') {
          localStorage.setItem('qlaok_active_shop_id', activeShopId);
        }

        router.push('/dashboard/orders');
        return;
      }

      if (mode === 'password_login') {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'login',
            email: email.trim(),
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ||
              tx(
                'Email hoặc mật khẩu không đúng.',
                'Incorrect email or password.'
              )
          );
        }

        setStoredAuthOwner(data.user, data.accessToken);
        const target = resolvePostLoginRoute(
          {
            isAdmin: Boolean(data.isAdmin || isSuperAdmin(data.user)),
            shops: data.shops,
            memberShops: data.memberShops,
          },
          searchParams.get('next')
        );
        rememberActiveShop(target.activeShopId, data);
        router.push(target.path);
        return;
      }

      if (mode === 'register') {
        if (!fullName.trim()) {
          throw new Error(
            tx('Vui lòng nhập họ và tên chủ quán.', 'Please enter owner full name.')
          );
        }

        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'register',
            email: email.trim(),
            password,
            fullName: fullName.trim(),
            phone: phone.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            data.error ||
              tx('Không thể tạo tài khoản.', 'Could not create account.')
          );
        }

        setStoredAuthOwner(data.user, data.accessToken);
        if (data.isAdmin || isSuperAdmin(data.user)) {
          router.push('/admin');
          return;
        }
        if (typeof window !== 'undefined') {
          localStorage.removeItem('qlaok_active_shop_id');
        }
        // New owner has 0 shops -> take them directly to 3-step Onboarding Wizard
        router.push('/onboarding');
        return;
      }

      if (mode === 'otp') {
        const supabase = createClient();
        if (!supabase) {
          throw new Error(
            tx(
              'Đăng nhập mã OTP chưa được kích hoạt.',
              'OTP sign-in is not enabled.'
            )
          );
        }

        if (!otpSent) {
          const { error } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: {
              emailRedirectTo: `${window.location.origin}/dashboard`,
            },
          });
          if (error) throw error;
          setOtpSent(true);
          setMessage({
            type: 'success',
            text: tx(
              'Đã gửi mã xác nhận tới {email}. Vui lòng kiểm tra hộp thư.',
              'Verification code sent to {email}. Please check your inbox.',
              { email }
            ),
          });
        } else {
          const { data, error } = await supabase.auth.verifyOtp({
            email: email.trim(),
            token: otpToken.trim(),
            type: 'email',
          });
          if (error) throw error;
          if (data.user) {
            const sbAccessToken = data.session?.access_token || '';
            const syncRes = await fetch('/api/auth', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(sbAccessToken
                  ? { Authorization: `Bearer ${sbAccessToken}` }
                  : {}),
              },
              body: JSON.stringify({
                action: 'sync_user',
                userId: data.user.id,
                email: data.user.email || email.trim(),
                fullName: data.user.user_metadata?.full_name as string,
                phone: data.user.user_metadata?.phone as string,
                supabaseAccessToken: sbAccessToken,
              }),
            });
            const syncData = await syncRes.json();
            if (syncData.user) {
              setStoredAuthOwner(syncData.user, syncData.accessToken);
            }
            const target = resolvePostLoginRoute(
              {
                isAdmin: Boolean(
                  syncData.isAdmin ||
                    (syncData.user && isSuperAdmin(syncData.user))
                ),
                shops: syncData.shops,
                memberShops: syncData.memberShops,
              },
              searchParams.get('next')
            );
            rememberActiveShop(target.activeShopId, syncData);
            router.push(target.path);
            return;
          }
          router.push(sanitizeNextPath(searchParams.get('next')) || '/dashboard');
        }
        return;
      }

      if (mode === 'reset') {
        const supabase = createClient();
        if (recoverySessionReady) {
          const result = await completePasswordRecoverySession({
            email,
            newPassword,
            confirmPassword: confirmNewPassword,
            authClient: supabase?.auth ?? null,
          });
          if (!result.ok) {
            throw new Error(
              formatWebRecoveryFailure(result.reason, result.errorMessage)
            );
          }
          setPassword(newPassword);
          setNewPassword('');
          setConfirmNewPassword('');
          setRecoveryCode('');
          setRecoverySessionReady(false);
          setRecoverySent(false);
          setMode('password_login');
          setMessage({
            type: 'success',
            text: tx(
              'Đã cập nhật mật khẩu mới thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
              'Password updated successfully. Please sign in with your new password.'
            ),
          });
          return;
        }

        if (recoverySent && recoveryCode.trim().length > 0) {
          const result = await completeMobilePasswordRecoveryWithCode({
            email,
            code: recoveryCode,
            newPassword,
            confirmPassword: confirmNewPassword,
            authClient: supabase?.auth ?? null,
          });
          if (!result.ok) {
            throw new Error(
              formatWebRecoveryFailure(result.reason, result.errorMessage)
            );
          }
          setPassword(newPassword);
          setNewPassword('');
          setConfirmNewPassword('');
          setRecoveryCode('');
          setRecoverySent(false);
          setMode('password_login');
          setMessage({
            type: 'success',
            text: tx(
              'Đã cập nhật mật khẩu mới thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
              'Password updated successfully. Please sign in with your new password.'
            ),
          });
          return;
        }

        const redirectTo = buildPasswordRecoveryRedirectUrl(
          typeof window !== 'undefined' ? window.location.origin : ''
        );
        const result = await requestMobilePasswordRecovery({
          email,
          redirectTo,
          authClient: supabase?.auth ?? null,
        });

        if (!result.ok) {
          throw new Error(
            formatWebRecoveryFailure(result.reason, result.errorMessage)
          );
        }

        setRecoverySent(true);
        setMessage({
          type: 'success',
          text: tx(
            formatGenericPasswordRecoveryNotice(result.email, 'vi'),
            formatGenericPasswordRecoveryNotice(result.email, 'en')
          ),
        });
        return;
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : tx(
                'Đăng nhập thất bại. Vui lòng kiểm tra lại.',
                'Sign-in failed. Please check your details.'
              ),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white theme-surface-page flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md flex items-center justify-end gap-2 mb-2">
        <AppLanguageSwitcher variant="dark" />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-5">
        <div className="text-center space-y-2">
          <Link
            href="/"
            aria-label={t('auth.backToHome')}
            title={t('auth.backToHome')}
            className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg"
          >
            <BrandLogo className="h-12 w-12 rounded-2xl" />
          </Link>
          <h1 className="text-2xl font-black tracking-tight">
            {mode === 'register'
              ? t('auth.registerTitle')
              : mode === 'reset'
                ? tx('Đặt lại mật khẩu', 'Reset password')
                : mode === 'staff'
                  ? tx('Đăng nhập nhân viên', 'Staff sign-in')
                  : t('auth.loginTitle')}
          </h1>
          <p className="text-xs text-slate-400">
            {mode === 'staff'
              ? tx(
                  'Đăng nhập vào một cửa hàng bằng tài khoản nhân viên',
                  'Sign in to a store with your staff account'
                )
              : t('auth.subtitle')}
          </p>
          {supabaseEnabled && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {tx('Bảo mật & đồng bộ tự động', 'Secure cloud sync')}
            </span>
          )}
        </div>

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('password_login');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-[11px] sm:text-xs font-bold transition-all truncate text-center ${
              mode === 'password_login'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t('auth.tabLogin')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-[11px] sm:text-xs font-bold transition-all truncate text-center ${
              mode === 'register'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {t('auth.tabRegister')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('otp');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-[11px] sm:text-xs font-bold transition-all truncate text-center ${
              mode === 'otp'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tx('Mã OTP', 'Email OTP')}
          </button>
          <button
            type="button"
            data-testid="login-mode-staff-btn"
            onClick={() => {
              setMode('staff');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-[11px] sm:text-xs font-bold transition-all truncate text-center ${
              mode === 'staff'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tx('Nhân viên', 'Staff')}
          </button>
        </div>

        {message && (
          <div
            className={`rounded-xl border p-3 text-xs font-semibold flex items-start gap-2 ${
              message.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            }`}
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'staff' ? (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {tx(
                    'Cửa hàng (slug, ID hoặc liên kết) *',
                    'Store (slug, ID, or storefront URL) *'
                  )}
                </label>
                <div className="relative">
                  <Store className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    data-testid="login-staff-shop-identifier"
                    value={shopIdentifier}
                    onChange={(e) => setShopIdentifier(e.target.value)}
                    placeholder={tx(
                      'ten-quan hoặc link cửa hàng',
                      'store-slug or storefront link'
                    )}
                    required
                    disabled={loading}
                    autoComplete="organization"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {tx('Tên đăng nhập *', 'Username *')}
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    data-testid="login-staff-username"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    placeholder={tx('tennhanvien', 'username')}
                    required
                    disabled={loading}
                    autoComplete="username"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {tx('Mật khẩu *', 'Password *')}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="password"
                    data-testid="login-staff-password"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="current-password"
                    placeholder={tx(
                      'Tối thiểu 6 ký tự',
                      'At least 6 characters'
                    )}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              {mode === 'register' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      {t('auth.fullNameLabel')} *
                    </label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={tx('Nguyễn Văn A', 'Alex Nguyen')}
                        required
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      {t('onboarding.phoneLabel')}
                    </label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="0905123456"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {t('auth.emailLabel')} *
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tenquan@gmail.com"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {mode !== 'otp' && mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-bold text-slate-300">
                      {t('auth.passwordLabel')} *
                    </label>
                    {mode === 'password_login' && (
                      <button
                        type="button"
                        data-testid="login-forgot-password-btn"
                        onClick={() => {
                          setMode('reset');
                          setRecoverySent(false);
                          setMessage(null);
                        }}
                        className="text-[11px] font-bold text-emerald-400 hover:underline"
                      >
                        {tx('Quên mật khẩu?', 'Forgot password?')}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder={tx(
                        'Tối thiểu 6 ký tự',
                        'At least 6 characters'
                      )}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {mode === 'reset' && recoverySessionReady && (
                <div
                  data-testid="login-recovery-update-form"
                  className="space-y-3"
                >
                  <div
                    data-testid="login-recovery-session-banner"
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-300"
                  >
                    {tx(
                      'Phiên khôi phục hợp lệ. Nhập mật khẩu mới để hoàn tất đặt lại mật khẩu.',
                      'Recovery session verified. Enter your new password below to finish resetting.'
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      {tx('Mật khẩu mới *', 'New password *')}
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="password"
                        data-testid="login-recovery-new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                        placeholder={tx(
                          'Tối thiểu 6 ký tự',
                          'At least 6 characters'
                        )}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      {tx('Xác nhận mật khẩu mới *', 'Confirm new password *')}
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="password"
                        data-testid="login-recovery-confirm-password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        required
                        minLength={6}
                        placeholder={tx(
                          'Nhập lại mật khẩu mới',
                          'Re-enter new password'
                        )}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {mode === 'reset' && !recoverySessionReady && recoverySent && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      {tx(
                        'Mã khôi phục trong email (tùy chọn nếu không bấm liên kết)',
                        'Recovery code from email (optional if not using the link)'
                      )}
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        value={recoveryCode}
                        onChange={(e) => setRecoveryCode(e.target.value)}
                        placeholder={tx(
                          'Nhập mã khôi phục...',
                          'Enter recovery code...'
                        )}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-mono font-bold text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  {recoveryCode.trim().length > 0 && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          {tx('Mật khẩu mới *', 'New password *')}
                        </label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder={tx(
                              'Tối thiểu 6 ký tự',
                              'At least 6 characters'
                            )}
                            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1">
                          {tx('Xác nhận mật khẩu mới *', 'Confirm new password *')}
                        </label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                          <input
                            type="password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder={tx(
                              'Nhập lại mật khẩu mới',
                              'Re-enter new password'
                            )}
                            className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {mode === 'otp' && otpSent && (
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    {tx('Mã OTP (6 số trong email)', 'OTP code (6 digits in email)')}
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={otpToken}
                      onChange={(e) => setOtpToken(e.target.value)}
                      placeholder={tx('Nhập mã OTP...', 'Enter OTP code...')}
                      required
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-mono font-bold text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            data-testid="login-submit-btn"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50 shadow-lg"
          >
            <span>
              {loading
                ? t('auth.submitting')
                : mode === 'password_login'
                  ? t('auth.loginSubmit')
                  : mode === 'register'
                    ? t('auth.registerSubmit')
                    : mode === 'staff'
                      ? tx('Đăng nhập nhân viên', 'Staff sign-in')
                      : mode === 'reset'
                        ? recoverySessionReady
                          ? tx('Cập nhật mật khẩu mới', 'Update new password')
                          : recoverySent && recoveryCode.trim().length > 0
                            ? tx(
                                'Xác nhận mã & cập nhật mật khẩu',
                                'Verify code & update password'
                              )
                            : tx(
                                'Gửi liên kết đặt lại mật khẩu',
                                'Send password reset link'
                              )
                        : otpSent
                          ? tx('Xác nhận mã OTP', 'Verify OTP code')
                          : tx('Gửi mã OTP qua Email', 'Send OTP via Email')}
            </span>
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>

          {mode === 'reset' && (
            <button
              type="button"
              data-testid="login-recovery-back-btn"
              onClick={() => {
                setMode('password_login');
                setRecoverySessionReady(false);
                setRecoverySent(false);
                setRecoveryCode('');
                setNewPassword('');
                setConfirmNewPassword('');
                setMessage(null);
              }}
              className="w-full text-center text-xs font-bold text-emerald-400 hover:underline pt-1"
            >
              {tx('← Quay lại đăng nhập', '← Back to sign in')}
            </button>
          )}

          {mode === 'staff' && (
            <button
              type="button"
              data-testid="login-staff-back-to-owner-btn"
              onClick={() => {
                setMode('password_login');
                setMessage(null);
              }}
              className="w-full text-center text-xs font-bold text-emerald-400 hover:underline pt-1"
            >
              {tx('← Quay lại đăng nhập chủ quán', '← Back to owner sign-in')}
            </button>
          )}
        </form>

        {/* Optional Demo Preview Button at the bottom */}
        {mode !== 'staff' && (
          <div className="border-t border-slate-800 pt-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                {mode === 'register'
                  ? tx('Đã có tài khoản?', 'Already have an account?')
                  : tx('Chưa có tài khoản?', 'Need an account?')}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'register' ? 'password_login' : 'register');
                  setMessage(null);
                }}
                className="font-bold text-emerald-400 hover:underline"
              >
                {mode === 'register'
                  ? tx('Đăng nhập →', 'Sign in →')
                  : tx('Đăng ký miễn phí →', 'Sign up free →')}
              </button>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleDemoLogin}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 hover:bg-slate-800/80 py-2 px-3 text-[11px] font-semibold text-slate-400 hover:text-emerald-300 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                {tx(
                  'Dùng thử',
                  'Try demo'
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
