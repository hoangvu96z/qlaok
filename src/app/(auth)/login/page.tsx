'use client';

import React, { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Store,
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
  const { locale, tx } = useAppI18n();

  const initialMode = (): AuthMode => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'staff') return 'staff';
    if (modeParam === 'register') return 'register';
    if (modeParam === 'reset') return 'reset';
    return 'login';
  };

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
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
    const callbackError = searchParams.get('error');
    if (callbackError) {
      const friendlyText =
        callbackError === 'access_denied'
          ? tx(
              'Yêu cầu đăng nhập đã bị hủy hoặc từ chối. Vui lòng thử lại.',
              'Sign-in was cancelled or denied. Please try again.'
            )
          : tx(
              'Đăng nhập không thành công. Vui lòng thử lại hoặc liên hệ hỗ trợ Qlaok.',
              'Sign-in was unsuccessful. Please try again or contact Qlaok support.'
            );
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

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
              {mode === 'register'
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
                    : tx(
                        'Đăng nhập bảo mật',
                        'Secure sign-in'
                      )}
            </div>
            <h1 className="text-2xl font-black text-white">
              {mode === 'register'
                ? tx('Tạo tài khoản Chủ quán', 'Create Shop Owner Account')
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
              {mode === 'register'
                ? tx(
                    'Tạo tài khoản Chủ quán trên trang đăng ký an toàn và tự động quay lại Qlaok để bắt đầu bán hàng.',
                    'Create your owner account on the secure registration page and return to Qlaok automatically.'
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
                        'Đăng nhập tài khoản Chủ quán trên trang đăng nhập bảo mật rồi quay lại Qlaok để quản lý quán.',
                        'Sign in to your owner account on a secure sign-in page and return to Qlaok.'
                      )}
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-stone-950 border border-stone-800 mb-6">
            <button
              type="button"
              data-testid="login-mode-owner-btn"
              onClick={() => {
                setMode('login');
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

          {/* Error / Success Messages */}
          {message && (
            <div
              role={message.type === 'error' ? 'alert' : 'status'}
              data-testid={
                message.type === 'error'
                  ? 'login-error-alert'
                  : 'login-success-status'
              }
              className={`mb-4 p-3.5 rounded-xl border text-xs leading-relaxed flex items-start gap-2 ${
                message.type === 'error'
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              {message.type === 'success' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
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
            ) : (
              <>
                <div className="p-3.5 rounded-2xl bg-stone-950/90 border border-stone-800/90 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-stone-300 leading-relaxed">
                    <p className="font-semibold text-white mb-0.5">
                      {tx(
                        'Đăng nhập bảo mật',
                        'Secure sign-in'
                      )}
                    </p>
                    <p className="text-stone-400">
                      {mode === 'register'
                        ? tx(
                            'Bạn sẽ tiếp tục trên trang đăng ký an toàn để tạo tài khoản Chủ quán rồi tự động quay lại Qlaok.',
                            'You will continue on a secure page to create your owner account and return to Qlaok automatically.'
                          )
                        : mode === 'reset'
                          ? tx(
                              'Bạn sẽ tiếp tục trên trang bảo mật để xác nhận email và đặt lại mật khẩu tài khoản Chủ quán.',
                              'You will continue on a secure page to verify your email and reset your password.'
                            )
                          : tx(
                              'Bạn sẽ tiếp tục trên trang đăng nhập an toàn rồi tự động quay lại Qlaok để quản lý quán.',
                              'You will continue on a secure sign-in page and return to Qlaok automatically.'
                            )}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="owner-email-hint"
                    className="block text-xs font-medium text-stone-300 mb-1.5"
                  >
                    {tx(
                      'Email tài khoản (không bắt buộc)',
                      'Account email (optional)'
                    )}
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="owner-email-hint"
                      data-testid="login-owner-email-hint"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="chuquan@tenquan.vn"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-stone-950 border border-stone-800 text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  {mode !== 'reset' ? (
                    <button
                      type="button"
                      data-testid="login-owner-reset-mode-btn"
                      onClick={() => {
                        setMode('reset');
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
                        setMessage(null);
                      }}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      {tx('← Quay lại Đăng nhập', '← Back to Sign In')}
                    </button>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              data-testid="login-submit-btn"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <span>
                {loading
                  ? mode === 'staff'
                    ? tx('Đang xử lý...', 'Processing...')
                    : tx('Đang mở trang đăng nhập...', 'Opening sign-in page...')
                  : mode === 'staff'
                    ? tx('Đăng nhập nhân viên', 'Staff sign-in')
                    : mode === 'register'
                      ? tx(
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

          {/* Divider — Quick Demo Account (only shown for shop owner modes) */}
          {mode !== 'staff' && (
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
