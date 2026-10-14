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
} from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
} from '@/lib/auth-session';

type AuthMode = 'password_login' | 'register' | 'otp';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode =
    searchParams.get('mode') === 'register' ? 'register' : 'password_login';
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const supabaseEnabled = isSupabaseConfigured();

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'register') {
      setMode('register');
    } else if (modeParam === 'login') {
      setMode('password_login');
    }
  }, [searchParams]);

  // If already logged in, allow quick redirect or switching accounts
  useEffect(() => {
    const existing = getStoredAuthOwner();
    if (existing && !searchParams.get('switch')) {
      // Do not auto-redirect if user explicitly opened /login?mode=register
      if (!searchParams.get('mode')) {
        router.replace(isSuperAdmin(existing) ? '/admin' : '/dashboard');
      }
    }
  }, [router, searchParams]);

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
        throw new Error(data.error || 'Không thể mở tài khoản Demo.');
      }
      setStoredAuthOwner(data.user);
      if (data.shops?.[0]?.id && typeof window !== 'undefined') {
        localStorage.setItem('qlaok_active_shop_id', data.shops[0].id);
      }
      router.push('/dashboard');
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi mở tài khoản Demo.',
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
            data.error || 'Email hoặc mật khẩu không chính xác.'
          );
        }

        setStoredAuthOwner(data.user);
        if (data.isAdmin || isSuperAdmin(data.user)) {
          router.push('/admin');
          return;
        }

        const ownerShops = data.shops || [];
        if (ownerShops.length === 0) {
          router.push('/onboarding');
        } else {
          if (typeof window !== 'undefined') {
            localStorage.setItem('qlaok_active_shop_id', ownerShops[0].id);
          }
          router.push('/dashboard');
        }
        return;
      }

      if (mode === 'register') {
        if (!fullName.trim()) {
          throw new Error('Vui lòng nhập họ và tên Chủ quán.');
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
          throw new Error(data.error || 'Không thể đăng ký tài khoản.');
        }

        setStoredAuthOwner(data.user);
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
          throw new Error('Supabase Auth chưa được cấu hình.');
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
            text: `Đã gửi mã đăng nhập / Magic Link tới ${email}. Vui lòng kiểm tra hộp thư!`,
          });
        } else {
          const { data, error } = await supabase.auth.verifyOtp({
            email: email.trim(),
            token: otpToken.trim(),
            type: 'email',
          });
          if (error) throw error;
          if (data.user) {
            const syncRes = await fetch('/api/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'sync_user',
                userId: data.user.id,
                email: data.user.email || email.trim(),
                fullName: data.user.user_metadata?.full_name as string,
                phone: data.user.user_metadata?.phone as string,
              }),
            });
            const syncData = await syncRes.json();
            if (syncData.user) {
              setStoredAuthOwner(syncData.user);
            }
            if ((syncData.shops || []).length === 0) {
              router.push('/onboarding');
              return;
            }
          }
          router.push('/dashboard');
        }
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-5">
        <div className="text-center space-y-2">
          <Link
            href="/"
            className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black text-2xl shadow-lg"
          >
            Q
          </Link>
          <h1 className="text-2xl font-black tracking-tight">
            {mode === 'register'
              ? 'Đăng Ký Tài Khoản Chủ Quán'
              : 'Đăng Nhập Qlaok CMS'}
          </h1>
          <p className="text-xs text-slate-400">
            Quản lý Menu 5 ngôn ngữ, Bảng giá, Tồn kho &amp; Đơn hàng mPOS cho cửa hàng của bạn
          </p>
          {supabaseEnabled && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Supabase Auth &amp; PostgreSQL Connected
            </span>
          )}
        </div>

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-950 p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('password_login');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-xs font-bold transition-all ${
              mode === 'password_login'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-xs font-bold transition-all ${
              mode === 'register'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng ký mới
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('otp');
              setMessage(null);
            }}
            className={`rounded-lg py-2 text-xs font-bold transition-all ${
              mode === 'otp'
                ? 'bg-emerald-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Email OTP
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
          {mode === 'register' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Họ và tên Chủ quán *
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-3 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Số điện thoại / Zalo
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
              Email Chủ quán *
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

          {mode !== 'otp' && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Mật khẩu *
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Nhập mật khẩu (tối thiểu 6 ký tự)"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {mode === 'otp' && otpSent && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Mã OTP (6 số trong email)
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={otpToken}
                  onChange={(e) => setOtpToken(e.target.value)}
                  placeholder="Nhập mã OTP..."
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-mono font-bold text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50 shadow-lg"
          >
            <span>
              {loading
                ? 'Đang xử lý với Supabase...'
                : mode === 'password_login'
                  ? 'Đăng nhập vào Quản trị Quán'
                  : mode === 'register'
                    ? 'Đăng ký & Bắt đầu Tạo Quán →'
                    : otpSent
                      ? 'Xác nhận mã OTP'
                      : 'Gửi mã OTP qua Email'}
            </span>
            {!loading && <ArrowRight className="h-4 w-4" />}
          </button>
        </form>

        {/* Optional Demo Preview Button at the bottom */}
        <div className="border-t border-slate-800 pt-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              {mode === 'register'
                ? 'Đã có tài khoản Chủ quán?'
                : 'Chưa có tài khoản Chủ quán?'}
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
                ? 'Đăng nhập ngay →'
                : 'Đăng ký miễn phí →'}
            </button>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleDemoLogin}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 hover:bg-slate-800/80 py-2 px-3 text-[11px] font-semibold text-slate-400 hover:text-emerald-300 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>Xem thử CMS với Tài khoản Demo (3 cửa hàng mẫu)</span>
          </button>
        </div>
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
