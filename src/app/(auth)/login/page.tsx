'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

type AuthMode = 'password_login' | 'register' | 'otp';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('password_login');

  const [email, setEmail] = useState('chuquan@qlaok.vn');
  const [password, setPassword] = useState('qlaok123456');
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

  const syncUserProfile = async (user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  }) => {
    const supabase = createClient();
    if (!supabase) return;
    await supabase.from('profiles').upsert(
      {
        id: user.id,
        email: user.email || email,
        full_name:
          (user.user_metadata?.full_name as string) ||
          fullName ||
          (user.email ? user.email.split('@')[0] : 'Chủ Quán Qlaok'),
        phone: (user.user_metadata?.phone as string) || phone || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const supabase = createClient();
    if (!supabase) {
      router.push('/dashboard');
      return;
    }

    try {
      if (mode === 'password_login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          // If logging in with the default demo credentials and account isn't registered in auth.users yet, auto-register or allow demo entry
          if (
            email.trim().toLowerCase() === 'chuquan@qlaok.vn' &&
            error.message.toLowerCase().includes('invalid login credentials')
          ) {
            const signUpRes = await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: {
                data: {
                  full_name: 'Nguyễn Văn Minh (Chủ Quán Demo)',
                  phone: '0905123456',
                },
              },
            });
            if (signUpRes.data?.user) {
              await syncUserProfile(signUpRes.data.user);
            }
            router.push('/dashboard');
            return;
          }
          throw error;
        }

        if (data.user) {
          await syncUserProfile(data.user);
        }
        router.push('/dashboard');
        return;
      }

      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || 'Chủ Quán Qlaok',
              phone: phone.trim(),
            },
          },
        });

        if (error) throw error;

        if (data.user) {
          await syncUserProfile(data.user);
        }

        if (data.session) {
          router.push('/dashboard');
        } else {
          setMessage({
            type: 'success',
            text: 'Đăng ký thành công! Nếu Supabase yêu cầu xác thực email, vui lòng kiểm tra hộp thư hoặc bấm đăng nhập ngay.',
          });
          setMode('password_login');
        }
        return;
      }

      if (mode === 'otp') {
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
            await syncUserProfile(data.user);
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
            Qlaok CMS – Chủ Quán
          </h1>
          <p className="text-xs text-slate-400">
            Quản lý Menu 5 ngôn ngữ, Bảng giá & Mã QR cho cửa hàng của bạn
          </p>
          {supabaseEnabled && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Supabase Auth & PostgreSQL Ready
            </span>
          )}
        </div>

        {/* 1-Tap Demo Owner Login */}
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-400">
              <Sparkles className="h-4 w-4" />
              <span>Tài khoản Demo (3 Cửa hàng mẫu)</span>
            </div>
            <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              PREMIUM
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Vào thẳng CMS quản lý 3 cửa hàng mẫu trên Supabase (Phở Hội An, Linh Spa & Nail, Làng Quà Việt).
          </p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 px-4 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 active:scale-98"
          >
            <span>Vào Ngay Trang Quản Trị (1 Chạm)</span>
            <ArrowRight className="h-4 w-4" />
          </button>
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
                ? 'bg-slate-800 text-white shadow-xs'
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
                ? 'bg-slate-800 text-white shadow-xs'
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
                ? 'bg-slate-800 text-white shadow-xs'
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
                  Họ và tên Chủ quán
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
              Email Chủ quán
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {mode !== 'otp' && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Tối thiểu 6 ký tự"
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
            className="w-full rounded-xl bg-white py-3 text-xs font-black text-slate-950 hover:bg-slate-100 disabled:opacity-50"
          >
            {loading
              ? 'Đang xử lý với Supabase...'
              : mode === 'password_login'
                ? 'Đăng nhập bằng Mật khẩu'
                : mode === 'register'
                  ? 'Tạo tài khoản Chủ quán'
                  : otpSent
                    ? 'Xác nhận mã OTP'
                    : 'Gửi mã OTP qua Email'}
          </button>
        </form>

        <div className="flex items-center justify-between border-t border-slate-800 pt-4 text-xs text-slate-400">
          <span>Chưa có cửa hàng?</span>
          <Link
            href="/onboarding"
            className="font-bold text-emerald-400 hover:underline"
          >
            Tạo quán mới trong 2 phút →
          </Link>
        </div>
      </div>
    </div>
  );
}
