'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
} from '@/lib/auth-session';
import { resolveLoginAuthMode } from '@/lib/auth-recovery';
import {
  resolvePostLoginRoute,
  sanitizeNextPath,
} from '@/lib/post-login-route';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { AppLanguageSwitcher } from '@/components/ui/AppI18nProvider';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandLogo } from '@/components/ui/BrandLogo';
import type { Profile, Shop } from '@/types/qlaok';

type AuthMode = 'login' | 'register' | 'reset' | 'staff';

function buildZitadelOidcStartHref(params: {
  mode: AuthMode;
  nextPath?: string | null;
  loginHint?: string | null;
  lang?: 'vi' | 'en';
}): string {
  const oidcMode =
    params.mode === 'register'
      ? 'register'
      : params.mode === 'reset'
        ? 'reset'
        : 'login';
  const query = new URLSearchParams({
    action: 'oidc_start',
    mode: oidcMode,
    next: sanitizeNextPath(params.nextPath) || '/dashboard',
  });
  if (params.loginHint && params.loginHint.trim()) {
    query.set('login_hint', params.loginHint.trim().toLowerCase());
  }
  if (params.lang === 'vi' || params.lang === 'en') {
    query.set('lang', params.lang);
  }
  return `/api/auth?${query.toString()}`;
}

function rememberActiveShop(
  preferredShopId: string | undefined,
  data: { shops?: Shop[]; memberShops?: Shop[] }
) {
  if (typeof window === 'undefined') return;
  const candidate =
    preferredShopId ||
    data.shops?.[0]?.id ||
    data.memberShops?.[0]?.id ||
    '';
  if (candidate) {
    localStorage.setItem('qlaok_active_shop_id', candidate);
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, setLocale, tx } = useAppI18n();
  const authRequestId =
    searchParams.get('authRequest') ||
    searchParams.get('authRequestID') ||
    '';

  const initialMode = (): AuthMode => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'staff') return 'staff';
    if (modeParam === 'register') return 'register';
    if (modeParam === 'reset') return 'reset';
    return 'login';
  };

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [registrationStep, setRegistrationStep] = useState<
    'form' | 'verify_email'
  >('form');
  const [registrationTicket, setRegistrationTicket] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [resendingCode, setResendingCode] = useState(false);
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const [duplicateEmailDetected, setDuplicateEmailDetected] = useState(false);
  const [activeAuthRequestId, setActiveAuthRequestId] = useState(authRequestId);
  const [customLoginReady, setCustomLoginReady] = useState(!authRequestId);
  const [customLoginFlow, setCustomLoginFlow] = useState<'login' | 'registration'>('login');
  const [shopIdentifier, setShopIdentifier] = useState(
    () => searchParams.get('shop') || ''
  );
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (resendCooldownSec <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCooldownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldownSec]);

  useEffect(() => {
    const callbackError = searchParams.get('error');
    const callbackErrorCode = searchParams.get('error_code');
    if (callbackError || callbackErrorCode) {
      let friendlyText: string;
      if (
        callbackError === 'access_denied' ||
        callbackErrorCode === 'OIDC_PROVIDER_ERROR'
      ) {
        friendlyText = tx(
          'Yêu cầu đăng nhập đã bị hủy hoặc từ chối. Vui lòng thử lại.',
          'Sign-in was cancelled or denied. Please try again.'
        );
      } else if (callbackErrorCode === 'OIDC_EMAIL_NOT_VERIFIED') {
        friendlyText = tx(
          'Email tài khoản chưa được xác thực. Vui lòng hoàn tất xác thực email trước khi tiếp tục.',
          'Your account email is not verified yet. Please complete email verification before continuing.'
        );
      } else if (
        callbackErrorCode === 'OIDC_INVALID_TRANSACTION' ||
        callbackErrorCode === 'OIDC_STATE_MISMATCH'
      ) {
        friendlyText = tx(
          'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng thử đăng nhập lại.',
          'Your sign-in session expired or is invalid. Please try signing in again.'
        );
      } else if (
        callbackErrorCode === 'OIDC_PROFILE_ID_CONFLICT' ||
        callbackErrorCode === 'OIDC_SUBJECT_ALREADY_LINKED'
      ) {
        friendlyText = tx(
          'Email này đã gắn với một hồ sơ khác trong hệ thống. Vui lòng kiểm tra lại tài khoản.',
          'This email is already linked to another profile. Please check your account.'
        );
      } else {
        friendlyText = tx(
          'Đăng nhập không thành công. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.',
          'Sign-in was unsuccessful. Please try again or contact Qlaok support.'
        );
      }
      setMessage({ type: 'error', text: friendlyText });
    }

    const stored = getStoredAuthOwner();
    if (stored && !callbackError) {
      if (isSuperAdmin(stored)) {
        router.replace('/admin');
        return;
      }
      if (!searchParams.get('mode') && mode !== 'reset' && mode !== 'staff') {
        router.replace('/dashboard');
      }
    }
  }, [router, searchParams, mode, tx]);

  useEffect(() => {
    const langParam = searchParams.get('lang') || searchParams.get('locale');
    if (langParam === 'en' || langParam === 'vi') {
      if (langParam !== locale) {
        setLocale(langParam);
      }
    }
  }, [searchParams, locale, setLocale]);

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    const shopParam = searchParams.get('shop');
    if (shopParam && !shopIdentifier) {
      setShopIdentifier(shopParam);
    }

    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const resolved = resolveLoginAuthMode({
      searchParams,
      hash,
    });

    if (resolved === 'staff' || modeParam === 'staff') {
      setMode('staff');
    } else if (resolved === 'reset') {
      setMode('reset');
    } else if (resolved === 'register' || modeParam === 'register') {
      setMode('register');
    }
  }, [searchParams, shopIdentifier]);

  useEffect(() => {
    setActiveAuthRequestId(authRequestId);
    if (!authRequestId) {
      setCustomLoginReady(true);
      setCustomLoginFlow('login');
      return;
    }

    let active = true;
    setCustomLoginReady(false);
    fetch(
      `/api/auth/login-ui?authRequest=${encodeURIComponent(authRequestId)}&lang=${locale === 'en' ? 'en' : 'vi'}`,
      { cache: 'no-store' }
    )
      .then(async (response) => {
        const data = (await response.json()) as {
          loginHint?: string;
          flow?: 'login' | 'registration';
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            data.error ||
              tx(
                'Liên kết đăng nhập đã hết hạn. Vui lòng quay lại Qlaok và thử lại.',
                'This sign-in link has expired. Return to Qlaok and try again.'
              )
          );
        }
        if (!active) return;
        if (data.loginHint) {
          setEmail((prev) => prev || data.loginHint || '');
        }
        const resolvedFlow =
          data.flow === 'registration' ? 'registration' : 'login';
        setCustomLoginFlow(resolvedFlow);
        if (resolvedFlow === 'registration') {
          setMode('register');
        }
        setCustomLoginReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCustomLoginReady(false);
        setMessage({
          type: 'error',
          text:
            error instanceof Error && error.message
              ? error.message
              : tx(
                  'Chưa thể đăng nhập lúc này. Vui lòng thử lại.',
                  'We could not sign you in right now. Please try again.'
                ),
        });
      });

    return () => {
      active = false;
    };
    // Only re-fetch when authRequestId changes so language toggles preserve form state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRequestId]);

  const handleOwnerOidcRedirect = (targetMode: AuthMode = mode) => {
    setMessage(null);
    setLoading(true);

    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('qlaok_auth_owner_v1');
        localStorage.removeItem('qlaok_auth_token_v1');
      } catch {
        // ignore storage errors
      }
    }

    const href = buildZitadelOidcStartHref({
      mode: targetMode,
      nextPath: searchParams.get('next'),
      loginHint: email,
      lang: locale === 'en' ? 'en' : 'vi',
    });

    if (typeof window !== 'undefined') {
      window.location.assign(href);
    } else {
      router.push(href);
    }
  };

  const isOwnerRegistration =
    mode === 'register' ||
    (Boolean(authRequestId) &&
      customLoginFlow === 'registration' &&
      mode !== 'login' &&
      mode !== 'reset' &&
      mode !== 'staff');

  const handleResendVerificationCode = async () => {
    if (
      !registrationTicket ||
      resendingCode ||
      loading ||
      resendCooldownSec > 0
    ) {
      return;
    }
    setMessage(null);
    setResendingCode(true);
    try {
      const response = await fetch(
        `/api/auth/login-ui?lang=${locale === 'en' ? 'en' : 'vi'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            action: 'register_resend',
            registrationTicket,
            lang: locale === 'en' ? 'en' : 'vi',
          }),
        }
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
      };
      if (!response.ok || !data.ok) {
        if (data.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED') {
          setRegistrationStep('form');
          setRegistrationTicket('');
          setVerificationCode('');
          setResendCooldownSec(0);
          setMode('login');
          setCustomLoginFlow('login');
          setMessage({
            type: 'success',
            text: tx(
              'Email đã được xác thực thành công. Vui lòng đăng nhập bằng email và mật khẩu để tiếp tục.',
              'Your email has been verified. Please sign in with your email and password to continue.'
            ),
          });
          return;
        }
        if (
          data.code === 'REGISTRATION_EXPIRED' ||
          data.code === 'REGISTRATION_TICKET_INVALID' ||
          data.code === 'AUTH_REQUEST_INVALID'
        ) {
          setRegistrationStep('form');
          setRegistrationTicket('');
          setResendCooldownSec(0);
        }
        throw new Error(
          data.error ||
            tx(
              'Chưa thể gửi lại mã xác thực lúc này. Vui lòng thử lại.',
              'Could not resend verification code right now. Please try again.'
            )
        );
      }
      setResendCooldownSec(30);
      setMessage({
        type: 'success',
        text: tx(
          'Đã gửi lại mã xác thực mới tới email của bạn.',
          'A new verification code has been sent to your email.'
        ),
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error && error.message
            ? error.message
            : tx(
                'Chưa thể gửi lại mã xác thực lúc này. Vui lòng thử lại.',
                'Could not resend verification code right now. Please try again.'
              ),
      });
    } finally {
      setResendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setDuplicateEmailDetected(false);

    if (mode === 'staff') {
      setLoading(true);
      try {
        const cleanShopIdentifier = shopIdentifier.trim();
        const cleanUsername = staffUsername.trim().toLowerCase();
        if (!cleanShopIdentifier || !cleanUsername || !staffPassword) {
          throw new Error(
            tx(
              'Vui lòng nhập đầy đủ Cửa hàng, Tên đăng nhập và Mật khẩu nhân viên.',
              'Please enter Store, Username, and Staff Password.'
            )
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
        const data = await res.json();
        if (!res.ok || !data.user) {
          throw new Error(
            tx(
              'Không thể đăng nhập nhân viên. Vui lòng kiểm tra thông tin rồi thử lại.',
              'Unable to sign in. Check your details and try again.'
            )
          );
        }

        setStoredAuthOwner(data.user, data.accessToken);
        const activeShopId =
          data.activeShopId ||
          data.memberShops?.[0]?.id ||
          data.user.shop_id ||
          '';
        if (typeof window !== 'undefined' && activeShopId) {
          localStorage.setItem('qlaok_active_shop_id', activeShopId);
        }
        router.push('/dashboard/orders');
        return;
      } catch {
        setMessage({
          type: 'error',
          text: tx(
            'Không thể đăng nhập nhân viên. Vui lòng kiểm tra thông tin rồi thử lại.',
            'Unable to sign in. Check your details and try again.'
          ),
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (isOwnerRegistration) {
      if (registrationStep === 'verify_email') {
        const cleanCode = verificationCode.trim();
        if (!cleanCode) {
          setMessage({
            type: 'error',
            text: tx(
              'Vui lòng nhập mã xác thực từ email của bạn.',
              'Please enter the verification code from your email.'
            ),
          });
          return;
        }
        setLoading(true);
        try {
          const response = await fetch(
            `/api/auth/login-ui?lang=${locale === 'en' ? 'en' : 'vi'}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                action: 'register_verify',
                registrationTicket,
                verificationCode: cleanCode,
                password: ownerPassword,
                lang: locale === 'en' ? 'en' : 'vi',
              }),
            }
          );
          const data = (await response.json()) as {
            callbackUrl?: string;
            error?: string;
            code?: string;
          };
          if (!response.ok || !data.callbackUrl) {
            if (data.code === 'REGISTRATION_VERIFIED_LOGIN_REQUIRED') {
              setRegistrationStep('form');
              setRegistrationTicket('');
              setVerificationCode('');
              setResendCooldownSec(0);
              setMode('login');
              setCustomLoginFlow('login');
              setMessage({
                type: 'success',
                text:
                  data.error ||
                  tx(
                    'Email đã được xác thực thành công. Vui lòng đăng nhập bằng email và mật khẩu để tiếp tục.',
                    'Your email has been verified. Please sign in with your email and password to continue.'
                  ),
              });
              return;
            }
            if (
              data.code === 'REGISTRATION_EXPIRED' ||
              data.code === 'REGISTRATION_TICKET_INVALID' ||
              data.code === 'AUTH_REQUEST_INVALID'
            ) {
              setRegistrationStep('form');
              setRegistrationTicket('');
              setResendCooldownSec(0);
            }
            throw new Error(
              data.error ||
                tx(
                  'Mã xác thực chưa đúng hoặc đã hết hạn. Vui lòng thử lại.',
                  'The verification code is incorrect or expired. Please try again.'
                )
            );
          }
          setOwnerPassword('');
          setConfirmPassword('');
          setVerificationCode('');
          window.location.assign(data.callbackUrl);
        } catch (error) {
          setMessage({
            type: 'error',
            text:
              error instanceof Error && error.message
                ? error.message
                : tx(
                    'Chưa thể xác thực email lúc này. Vui lòng thử lại.',
                    'Could not verify email right now. Please try again.'
                  ),
          });
        } finally {
          setLoading(false);
        }
        return;
      }

      const cleanFullName = fullName.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (cleanFullName.length < 2) {
        setMessage({
          type: 'error',
          text: tx(
            'Vui lòng nhập họ và tên hợp lệ (tối thiểu 2 ký tự).',
            'Please enter your full name (at least 2 characters).'
          ),
        });
        return;
      }
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
        setMessage({
          type: 'error',
          text: tx(
            'Vui lòng nhập địa chỉ email hợp lệ.',
            'Please enter a valid email address.'
          ),
        });
        return;
      }
      if (
        ownerPassword.length < 8 ||
        !/[a-z]/.test(ownerPassword) ||
        !/[A-Z]/.test(ownerPassword) ||
        !/[0-9]/.test(ownerPassword) ||
        !/[^A-Za-z0-9\s]/.test(ownerPassword)
      ) {
        setMessage({
          type: 'error',
          text: tx(
            'Mật khẩu cần tối thiểu 8 ký tự, bao gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.',
            'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
          ),
        });
        return;
      }
      if (ownerPassword !== confirmPassword) {
        setMessage({
          type: 'error',
          text: tx(
            'Mật khẩu xác nhận chưa khớp.',
            'Password confirmation does not match.'
          ),
        });
        return;
      }

      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('qlaok_auth_owner_v1');
          localStorage.removeItem('qlaok_auth_token_v1');
        } catch {
          // ignore storage errors
        }
      }

      setLoading(true);
      try {
        const response = await fetch(
          `/api/auth/login-ui?lang=${locale === 'en' ? 'en' : 'vi'}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
              action: 'register_start',
              authRequestId:
                activeAuthRequestId || authRequestId || undefined,
              next: searchParams.get('next') || '/onboarding',
              fullName: cleanFullName,
              email: cleanEmail,
              password: ownerPassword,
              confirmPassword,
              lang: locale === 'en' ? 'en' : 'vi',
            }),
          }
        );
        const data = (await response.json()) as {
          step?: string;
          registrationTicket?: string;
          authRequestId?: string;
          email?: string;
          error?: string;
          code?: string;
        };
        if (!response.ok || !data.registrationTicket) {
          if (data.code === 'EMAIL_ALREADY_EXISTS') {
            setDuplicateEmailDetected(true);
          }
          throw new Error(
            data.error ||
              tx(
                'Chưa thể tạo tài khoản lúc này. Vui lòng thử lại.',
                'Could not create your account right now. Please try again.'
              )
          );
        }
        setRegistrationTicket(data.registrationTicket);
        if (data.authRequestId) {
          setActiveAuthRequestId(data.authRequestId);
        }
        if (data.email) {
          setEmail(data.email);
        }
        setVerificationCode('');
        setRegistrationStep('verify_email');
        setResendCooldownSec(30);
        setMessage({
          type: 'success',
          text: tx(
            'Mã xác thực đã được gửi tới email của bạn. Vui lòng nhập mã bên dưới để kích hoạt tài khoản.',
            'A verification code has been sent to your email. Enter the code below to activate your account.'
          ),
        });
      } catch (error) {
        setMessage({
          type: 'error',
          text:
            error instanceof Error && error.message
              ? error.message
              : tx(
                  'Chưa thể tạo tài khoản lúc này. Vui lòng thử lại.',
                  'Could not create your account right now. Please try again.'
                ),
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (authRequestId) {
      if (!customLoginReady || !email.trim() || !ownerPassword) {
        setMessage({
          type: 'error',
          text: tx(
            'Vui lòng nhập email và mật khẩu.',
            'Please enter your email and password.'
          ),
        });
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(
          `/api/auth/login-ui?lang=${locale === 'en' ? 'en' : 'vi'}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
              action: 'login',
              authRequestId,
              loginName: email.trim(),
              password: ownerPassword,
              lang: locale === 'en' ? 'en' : 'vi',
            }),
          }
        );
        const data = (await response.json()) as {
          callbackUrl?: string;
          error?: string;
        };
        if (!response.ok || !data.callbackUrl) {
          throw new Error(
            data.error ||
              tx(
                'Email hoặc mật khẩu chưa đúng.',
                'The email or password is incorrect.'
              )
          );
        }
        setOwnerPassword('');
        window.location.assign(data.callbackUrl);
      } catch (error) {
        setMessage({
          type: 'error',
          text:
            error instanceof Error && error.message
              ? error.message
              : tx(
                  'Chưa thể đăng nhập lúc này. Vui lòng thử lại.',
                  'We could not sign you in right now. Please try again.'
                ),
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    handleOwnerOidcRedirect(mode);
  };

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
            tx(
              'Không thể khởi tạo phiên Demo.',
              'Could not start Demo session.'
            )
        );
      }

      setStoredAuthOwner(data.user as Profile, data.accessToken);
      const target = resolvePostLoginRoute(
        {
          isAdmin: isSuperAdmin(data.user as Profile),
          shops: (data.shops || []) as Shop[],
          memberShops: (data.memberShops || []) as Shop[],
        },
        searchParams.get('next')
      );
      rememberActiveShop(target.activeShopId ?? undefined, data);
      router.push(target.path);
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : tx(
                'Lỗi kết nối máy chủ khi vào chế độ Demo.',
                'Server connection error while launching Demo mode.'
              ),
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col justify-between relative overflow-hidden">
      {/* Decorative Background */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[650px] h-[650px] rounded-full bg-amber-500/10 blur-[140px]" />

      {/* Top Navigation */}
      <header className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-6 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          {tx('Về trang chủ Qlaok', 'Back to Qlaok Home')}
        </Link>

        <div className="flex items-center gap-3">
          <AppLanguageSwitcher variant="dark" />
          <ThemeToggle />
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo />
          </Link>
        </div>
      </header>

      {/* Main Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-stone-900/90 border border-stone-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {/* Header */}
          <div className="mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              {authRequestId
                ? tx('Qlaok', 'Qlaok')
                : mode === 'register'
                ? tx(
                    'Khởi tạo cửa hàng miễn phí',
                    'Create your free shop'
                  )
                : mode === 'reset'
                  ? tx(
                      'Khôi phục mật khẩu Chủ quán',
                      'Reset Shop Owner Password'
                    )
                  : mode === 'staff'
                    ? tx(
                        'Đăng nhập Nhân viên / Thu ngân tại quán',
                        'Shop Staff & Cashier Sign-in'
                      )
                      : tx('Chào mừng bạn trở lại', 'Welcome back')}
            </div>
            <h1 className="text-2xl font-black text-white">
              {isOwnerRegistration
                ? registrationStep === 'verify_email'
                  ? tx('Xác thực email tài khoản', 'Verify your email address')
                  : tx('Tạo tài khoản Chủ quán', 'Create Shop Owner Account')
                : authRequestId
                  ? tx('Đăng nhập để tiếp tục', 'Sign in to continue')
                  : mode === 'reset'
                    ? tx(
                        'Đặt lại mật khẩu Chủ quán',
                        'Reset Shop Owner Password'
                      )
                    : mode === 'staff'
                      ? tx('Đăng nhập Nhân viên', 'Staff Sign In')
                      : tx('Đăng nhập Chủ quán', 'Sign in as Owner')}
            </h1>
            <p className="text-xs text-stone-400 mt-1">
              {isOwnerRegistration
                ? registrationStep === 'verify_email'
                  ? tx(
                      'Nhập mã xác thực vừa được gửi tới hộp thư của bạn để hoàn tất tạo tài khoản Qlaok.',
                      'Enter the verification code sent to your inbox to finish creating your Qlaok account.'
                    )
                  : tx(
                      'Điền thông tin bên dưới để tạo tài khoản Chủ quán và bắt đầu thiết lập cửa hàng trên Qlaok.',
                      'Fill in your details below to create an owner account and start setting up your store on Qlaok.'
                    )
                : authRequestId
                  ? tx(
                      'Nhập email và mật khẩu để tiếp tục quản lý cửa hàng.',
                      'Enter your email and password to manage your store.'
                    )
                  : mode === 'reset'
                    ? tx(
                        'Tiếp tục trên trang đăng nhập bảo mật để đặt lại mật khẩu cho tài khoản Chủ quán của bạn.',
                        'Continue on the secure sign-in page to reset your owner account password.'
                      )
                    : mode === 'staff'
                      ? tx(
                          'Nhập tên cửa hàng hoặc liên kết, tài khoản và mật khẩu do chủ quán cấp để vào quầy đơn hàng.',
                          'Enter the store name or link, username, and password issued by your shop owner.'
                        )
                      : tx(
                          'Đăng nhập để quản lý cửa hàng của bạn trên Qlaok.',
                          'Sign in to manage your store on Qlaok.'
                        )}
            </p>
          </div>

          {!authRequestId && (
          <>
          {/* Mode Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-stone-950 border border-stone-800 mb-6">
            <button
              type="button"
              data-testid="login-mode-owner-btn"
              onClick={() => {
                setMode('login');
                setRegistrationStep('form');
                setDuplicateEmailDetected(false);
                setMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                mode === 'login'
                  ? 'bg-amber-500 text-stone-950 shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {tx('Đăng nhập', 'Sign In')}
            </button>
            <button
              type="button"
              data-testid="login-mode-register-btn"
              onClick={() => {
                setMode('register');
                setDuplicateEmailDetected(false);
                setMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                mode === 'register'
                  ? 'bg-amber-500 text-stone-950 shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {tx('Đăng ký', 'Register')}
            </button>
            <button
              type="button"
              data-testid="login-mode-reset-btn"
              onClick={() => {
                setMode('reset');
                setRegistrationStep('form');
                setDuplicateEmailDetected(false);
                setMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition ${
                mode === 'reset'
                  ? 'bg-amber-500 text-stone-950 shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {tx('Khôi phục', 'Reset')}
            </button>
            <button
              type="button"
              data-testid="login-mode-staff-btn"
              onClick={() => {
                setMode('staff');
                setRegistrationStep('form');
                setDuplicateEmailDetected(false);
                setMessage(null);
              }}
              className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                mode === 'staff'
                  ? 'bg-amber-500 text-stone-950 shadow'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              {tx('Nhân viên', 'Staff')}
            </button>
          </div>
          </>
          )}

          {/* Error / Success Messages */}
          {message && (
            <div
              role={message.type === 'error' ? 'alert' : 'status'}
              data-testid={
                message.type === 'error'
                  ? 'login-error-alert'
                  : 'login-success-status'
              }
              className={`mb-4 p-3.5 rounded-xl border text-xs leading-relaxed flex flex-col gap-2 ${
                message.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              <div className="flex items-start gap-2">
                {message.type === 'success' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                )}
                <span>{message.text}</span>
              </div>
              {duplicateEmailDetected && isOwnerRegistration && (
                <button
                  type="button"
                  data-testid="register-switch-to-login-btn"
                  onClick={() => {
                    setMode('login');
                    setCustomLoginFlow('login');
                    setRegistrationStep('form');
                    setDuplicateEmailDetected(false);
                    setMessage(null);
                  }}
                  className="self-start text-xs font-bold text-amber-300 hover:text-amber-200 underline"
                >
                  {tx(
                    'Chuyển sang Đăng nhập với email này →',
                    'Switch to Sign In with this email →'
                  )}
                </button>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'staff' ? (
              <>
                <div>
                  <label
                    htmlFor="staff-shop-identifier"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {tx(
                      'Tên cửa hàng hoặc liên kết *',
                      'Store name or link *'
                    )}
                  </label>
                  <div className="relative">
                    <Store className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="staff-shop-identifier"
                      data-testid="login-staff-shop-identifier"
                      type="text"
                      required
                      autoComplete="organization"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={shopIdentifier}
                      onChange={(e) => setShopIdentifier(e.target.value)}
                      placeholder={tx(
                        'VD: Phở Hội An',
                        'e.g. Pho Hoi An'
                      )}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="staff-username"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {tx('Tên đăng nhập *', 'Username *')}
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="staff-username"
                      data-testid="login-staff-username"
                      type="text"
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={staffUsername}
                      onChange={(e) =>
                        setStaffUsername(e.target.value.toLowerCase())
                      }
                      placeholder={tx(
                        'VD: thungan_casang',
                        'e.g. cashier_morning'
                      )}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="staff-password"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {tx('Mật khẩu *', 'Password *')}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="staff-password"
                      data-testid="login-staff-password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete="current-password"
                      value={staffPassword}
                      onChange={(e) => setStaffPassword(e.target.value)}
                      placeholder={tx(
                        'Nhập mật khẩu do chủ quán cấp',
                        'Enter password provided by shop owner'
                      )}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </>
            ) : isOwnerRegistration && registrationStep === 'verify_email' ? (
              <>
                <div className="p-3.5 rounded-2xl bg-stone-950/90 border border-stone-800/90 flex items-start gap-3">
                  <Mail className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-stone-300 leading-relaxed">
                    <p className="font-semibold text-white mb-0.5">
                      {tx(
                        'Kiểm tra hộp thư của bạn',
                        'Check your email inbox'
                      )}
                    </p>
                    <p className="text-stone-400">
                      {tx(
                        `Chúng tôi đã gửi mã xác thực đến ${email.trim().toLowerCase()}.`,
                        `We sent a verification code to ${email.trim().toLowerCase()}.`
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="owner-verification-code"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {tx('Mã xác thực email *', 'Email verification code *')}
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="owner-verification-code"
                      data-testid="register-verification-code"
                      type="text"
                      inputMode="text"
                      required
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      placeholder={tx(
                        'Nhập mã xác thực từ email',
                        'Enter code from your email'
                      )}
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white tracking-widest font-mono placeholder:tracking-normal placeholder:font-sans placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    data-testid="register-resend-code-btn"
                    disabled={
                      resendingCode || loading || resendCooldownSec > 0
                    }
                    onClick={handleResendVerificationCode}
                    className="text-amber-400 hover:underline disabled:opacity-50 font-medium inline-flex items-center gap-1"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${resendingCode ? 'animate-spin' : ''}`}
                    />
                    {resendingCode
                      ? tx('Đang gửi lại mã...', 'Resending code...')
                      : resendCooldownSec > 0
                        ? tx(
                            `Gửi lại mã xác thực (${resendCooldownSec}s)`,
                            `Resend verification code (${resendCooldownSec}s)`
                          )
                        : tx('Gửi lại mã xác thực', 'Resend verification code')}
                  </button>

                  <button
                    type="button"
                    data-testid="register-back-to-form-btn"
                    disabled={loading}
                    onClick={() => {
                      setRegistrationStep('form');
                      setVerificationCode('');
                      setRegistrationTicket('');
                      setResendCooldownSec(0);
                      setMessage(null);
                    }}
                    className="text-stone-400 hover:text-white font-medium"
                  >
                    {tx('← Đổi thông tin đăng ký', '← Edit registration info')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3.5 rounded-2xl bg-stone-950/90 border border-stone-800/90 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-stone-300 leading-relaxed">
                    <p className="font-semibold text-white mb-0.5">
                      {isOwnerRegistration
                        ? tx('Tạo tài khoản mới', 'Create a new account')
                        : tx('Chào mừng bạn', 'Welcome back')}
                    </p>
                    <p className="text-stone-400">
                      {isOwnerRegistration
                        ? tx(
                            'Điền họ tên, email và mật khẩu để nhận mã xác thực kích hoạt tài khoản Chủ quán.',
                            'Enter your full name, email, and password to receive a verification code and activate your owner account.'
                          )
                        : mode === 'reset'
                          ? tx(
                              'Nhập email để nhận hướng dẫn đặt lại mật khẩu.',
                              'Enter your email to receive password reset instructions.'
                            )
                          : tx(
                              'Đăng nhập để quản lý cửa hàng của bạn trên Qlaok.',
                              'Sign in to manage your store on Qlaok.'
                            )}
                    </p>
                  </div>
                </div>

                {isOwnerRegistration && (
                  <div>
                    <label
                      htmlFor="owner-register-full-name"
                      className="block text-xs font-medium text-stone-300 mb-1.5"
                    >
                      {tx('Họ và tên Chủ quán *', 'Shop Owner full name *')}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="owner-register-full-name"
                        data-testid="register-owner-full-name"
                        type="text"
                        required
                        autoComplete="name"
                        enterKeyHint="next"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={tx(
                          'VD: Nguyễn Văn An',
                          'e.g. Nguyen Van An'
                        )}
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="owner-email-hint"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {isOwnerRegistration
                      ? tx('Email tài khoản *', 'Account email *')
                      : authRequestId
                        ? tx('Email hoặc tên đăng nhập', 'Email or username')
                        : tx('Email tài khoản', 'Account email')}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="owner-email-hint"
                      data-testid="login-owner-email-hint"
                      type={isOwnerRegistration ? 'email' : 'text'}
                      required={Boolean(authRequestId) || isOwnerRegistration}
                      autoComplete={isOwnerRegistration ? 'email' : 'username'}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (duplicateEmailDetected) {
                          setDuplicateEmailDetected(false);
                        }
                      }}
                      placeholder="chuquan@tenquan.vn"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {(Boolean(authRequestId) || isOwnerRegistration) && (
                  <div>
                    <label
                      htmlFor="owner-password"
                      className="block text-xs font-medium text-stone-300 mb-1.5"
                    >
                      {isOwnerRegistration
                        ? tx('Mật khẩu *', 'Password *')
                        : tx('Mật khẩu', 'Password')}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="owner-password"
                        data-testid="login-owner-password"
                        type={showOwnerPassword ? 'text' : 'password'}
                        required
                        minLength={isOwnerRegistration ? 8 : undefined}
                        autoComplete={
                          isOwnerRegistration
                            ? 'new-password'
                            : 'current-password'
                        }
                        aria-describedby={
                          isOwnerRegistration
                            ? 'owner-password-rules'
                            : undefined
                        }
                        enterKeyHint={isOwnerRegistration ? 'next' : 'done'}
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        className="w-full pl-10 pr-12 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        aria-label={
                          showOwnerPassword
                            ? tx('Ẩn mật khẩu', 'Hide password')
                            : tx('Hiện mật khẩu', 'Show password')
                        }
                        aria-pressed={showOwnerPassword}
                        onClick={() => setShowOwnerPassword((visible) => !visible)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        {showOwnerPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {isOwnerRegistration && (
                      <p
                        id="owner-password-rules"
                        className="mt-1.5 text-[11px] text-stone-400 leading-relaxed"
                      >
                        {tx(
                          'Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.',
                          'At least 8 characters, including uppercase, lowercase, number, and special character.'
                        )}
                      </p>
                    )}
                  </div>
                )}

                {isOwnerRegistration && (
                  <div>
                    <label
                      htmlFor="owner-confirm-password"
                      className="block text-xs font-medium text-stone-300 mb-1.5"
                    >
                      {tx('Xác nhận mật khẩu *', 'Confirm password *')}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="owner-confirm-password"
                        data-testid="register-owner-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        enterKeyHint="done"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full pl-10 pr-12 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        aria-label={
                          showConfirmPassword
                            ? tx(
                                'Ẩn mật khẩu xác nhận',
                                'Hide confirm password'
                              )
                            : tx(
                                'Hiện mật khẩu xác nhận',
                                'Show confirm password'
                              )
                        }
                        aria-pressed={showConfirmPassword}
                        onClick={() =>
                          setShowConfirmPassword((visible) => !visible)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs pt-1">
                  {!authRequestId ? (
                    mode !== 'reset' ? (
                      <button
                        type="button"
                        data-testid="login-owner-reset-mode-btn"
                        onClick={() => {
                          setMode('reset');
                          setRegistrationStep('form');
                          setMessage(null);
                        }}
                        className="text-amber-400 hover:underline font-medium inline-flex items-center gap-1"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {tx('Quên mật khẩu?', 'Forgot password?')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="login-owner-back-from-reset-btn"
                        onClick={() => {
                          setMode('login');
                          setRegistrationStep('form');
                          setMessage(null);
                        }}
                        className="text-amber-400 hover:underline font-medium"
                      >
                        {tx('← Quay lại Đăng nhập', '← Back to Sign In')}
                      </button>
                    )
                  ) : isOwnerRegistration ? (
                    <button
                      type="button"
                      data-testid="register-switch-to-login-link"
                      onClick={() => {
                        setMode('login');
                        setCustomLoginFlow('login');
                        setRegistrationStep('form');
                        setDuplicateEmailDetected(false);
                        setMessage(null);
                      }}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      {tx(
                        'Đã có tài khoản? Đăng nhập',
                        'Already have an account? Sign in'
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="login-switch-to-register-btn"
                      onClick={() => {
                        setMode('register');
                        setCustomLoginFlow('registration');
                        setRegistrationStep('form');
                        setDuplicateEmailDetected(false);
                        setMessage(null);
                      }}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      {tx(
                        'Chưa có tài khoản? Đăng ký ngay',
                        'Need an account? Register now'
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              data-testid="login-submit-btn"
              disabled={loading || !customLoginReady}
              className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <span>
                {loading
                  ? isOwnerRegistration
                    ? registrationStep === 'verify_email'
                      ? tx('Đang xác thực...', 'Verifying...')
                      : tx('Đang tạo tài khoản...', 'Creating account...')
                    : authRequestId
                      ? tx('Đang đăng nhập...', 'Signing in...')
                      : mode === 'staff'
                        ? tx('Đang xử lý...', 'Processing...')
                        : tx('Đang mở trang đăng nhập...', 'Opening sign-in page...')
                  : mode === 'staff'
                    ? tx('Đăng nhập nhân viên', 'Staff sign-in')
                    : isOwnerRegistration
                      ? registrationStep === 'verify_email'
                        ? tx(
                            'Xác thực & Hoàn tất đăng ký',
                            'Verify & Complete registration'
                          )
                        : tx(
                            'Tạo tài khoản Chủ quán',
                            'Create Owner account'
                          )
                      : mode === 'reset'
                        ? tx(
                            'Đặt lại mật khẩu',
                            'Reset password'
                          )
                        : tx(
                            'Đăng nhập Chủ quán',
                            'Sign in as Owner'
                          )}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Divider — Quick Demo Account (only shown for shop owner modes outside email verification) */}
          {mode !== 'staff' && (
            !authRequestId &&
            !(isOwnerRegistration && registrationStep === 'verify_email') && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-stone-800" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-stone-900 text-stone-500">
                      {tx(
                        'Hoặc trải nghiệm nhanh không cần tạo tài khoản',
                        'Or preview instantly without registration'
                      )}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="login-demo-btn"
                  onClick={handleDemoLogin}
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-stone-950 hover:bg-stone-800/80 border border-stone-800 text-xs font-semibold text-amber-300 transition flex items-center justify-center gap-2"
                >
                  <Store className="w-4 h-4 text-amber-400" />
                  {tx(
                    'Vào xem thử Tài khoản Chủ quán Mẫu (Demo)',
                    'Preview Demo Shop Owner Account'
                  )}
                </button>
              </>
            )
          )}

          {mode === 'staff' && (
            <div className="mt-5 pt-4 border-t border-stone-800/80 text-center">
              <p className="text-[11px] text-stone-400">
                {tx(
                  'Chưa có tài khoản nhân viên? Liên hệ Chủ quán để được cấp trong mục Cài đặt > Phân quyền nhân sự.',
                  'Need a staff account? Ask your shop owner to create one in Settings > Staff Permissions.'
                )}
              </p>
              <button
                type="button"
                data-testid="login-staff-back-to-owner-btn"
                onClick={() => {
                  setMode('login');
                  setMessage(null);
                }}
                className="mt-2 text-xs text-amber-400 hover:underline font-medium"
              >
                {tx('← Quay lại đăng nhập chủ quán', '← Back to owner sign-in')}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 text-xs text-stone-600">
        {tx(
          '© 2026 Qlaok — Nền tảng Cửa hàng QR đa ngành cho SME Việt Nam',
          '© 2026 Qlaok — Multi-vertical QR Commerce Platform for Vietnam SMEs'
        )}
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-950 text-stone-400 flex items-center justify-center text-sm">
          Loading...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}