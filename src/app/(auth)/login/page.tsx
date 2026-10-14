'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mail, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('chuquan@qlaok.vn');
  const [otpToken, setOtpToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const supabaseEnabled = isSupabaseConfigured();

  const handleEmailOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const supabase = createClient();
    if (!supabase) {
      setTimeout(() => {
        router.push('/dashboard');
      }, 300);
      return;
    }

    try {
      if (!otpSent) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
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
        const { error } = await supabase.auth.verifyOtp({
          email,
          token: otpToken.trim(),
          type: 'email',
        });
        if (error) throw error;
        router.push('/dashboard');
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể gửi OTP qua Supabase. Bạn có thể bấm "Vào Ngay Trang Quản Trị (1 Chạm)" bên trên.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <Link
            href="/"
            className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black text-2xl shadow-lg"
          >
            Q
          </Link>
          <h1 className="text-2xl font-black tracking-tight">
            Đăng nhập Qlaok CMS
          </h1>
          <p className="text-xs text-slate-400">
            Quản lý Menu 5 ngôn ngữ, Bảng giá & Mã QR cho cửa hàng của bạn
          </p>
          {supabaseEnabled && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Đã kết nối Supabase Cloud
            </span>
          )}
        </div>

        {/* 1-Tap Demo Owner Login */}
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-extrabold text-emerald-400">
            <Sparkles className="h-4 w-4" />
            <span>Chế độ Trải nghiệm Nhanh (1 Chạm)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Đăng nhập ngay vào tài khoản Chủ Quán với 3 cửa hàng mẫu đủ 5 ngôn ngữ (Quán Phở, Tiệm Nail & Spa, Shop Đặc Sản).
          </p>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 px-4 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 active:scale-98"
          >
            <span>Vào Ngay Trang Quản Trị (1 Chạm)</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800" />
          <span className="shrink mx-3 text-[11px] font-bold uppercase text-slate-500">
            Hoặc đăng nhập Supabase Email OTP
          </span>
          <div className="flex-grow border-t border-slate-800" />
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

        <form onSubmit={handleEmailOtpSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
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

          {otpSent && (
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Mã OTP (6 số trong email)
              </label>
              <input
                type="text"
                value={otpToken}
                onChange={(e) => setOtpToken(e.target.value)}
                placeholder="Nhập mã OTP..."
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs font-mono font-bold text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white py-3 text-xs font-black text-slate-950 hover:bg-slate-100"
          >
            {loading
              ? 'Đang kết nối Supabase...'
              : otpSent
                ? 'Xác nhận mã OTP'
                : 'Gửi mã OTP / Magic Link qua Email'}
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

