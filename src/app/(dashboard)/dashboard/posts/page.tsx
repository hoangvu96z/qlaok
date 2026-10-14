'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Megaphone,
  Plus,
  Pin,
  Trash2,
  Sparkles,
  Loader2,
  Check,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { I18nText, Post, SupportedLocale } from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';

export default function DashboardPostsPage() {
  const { activeShop } = useDashboard();
  const [posts, setPosts] = useState<Post[]>([]);
  const [titleI18n, setTitleI18n] = useState<I18nText>({
    vi: '',
    en: '',
    ko: '',
    ja: '',
    zh: '',
  });
  const [contentI18n, setContentI18n] = useState<I18nText>({
    vi: '',
    en: '',
    ko: '',
    ja: '',
    zh: '',
  });
  const [isPinned, setIsPinned] = useState(true);
  const [activeTab, setActiveTab] = useState<SupportedLocale>('vi');
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPosts = useCallback(async () => {
    if (!activeShop) return;
    const res = await fetch(`/api/posts?shopId=${activeShop.id}`, {
      cache: 'no-store',
    });
    const data = await res.json();
    setPosts(data.posts || []);
  }, [activeShop]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  if (!activeShop) return null;

  const handleTranslatePost = async () => {
    if (!titleI18n.vi.trim()) return;
    setTranslating(true);
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical: activeShop.vertical,
          categoryNameVi: 'Khuyến mãi',
          itemNameVi: titleI18n.vi,
          itemDescVi: contentI18n.vi,
        }),
      });
      const data = await res.json();
      if (data.name_i18n) setTitleI18n(data.name_i18n);
      if (data.desc_i18n) setContentI18n(data.desc_i18n);
      setActiveTab('en');
    } finally {
      setTranslating(false);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleI18n.vi.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: activeShop.id,
          title_i18n: titleI18n,
          content_i18n: contentI18n,
          is_pinned: isPinned,
          is_active: true,
        }),
      });
      setTitleI18n({ vi: '', en: '', ko: '', ja: '', zh: '' });
      setContentI18n({ vi: '', en: '', ko: '', ja: '', zh: '' });
      await loadPosts();
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (post: Post) => {
    await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...post,
        is_pinned: !post.is_pinned,
      }),
    });
    await loadPosts();
  };

  const handleDeletePost = async (postId: string) => {
    await fetch(`/api/posts?postId=${encodeURIComponent(postId)}`, {
      method: 'DELETE',
    });
    await loadPosts();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-900">
          Tin Khuyến Mãi & Thông Báo Quán ({activeShop.name})
        </h1>
        <p className="text-xs text-slate-500">
          Các thông báo ưu đãi sẽ hiển thị nổi bật trên trang <strong>QR Cửa (/s/{activeShop.slug})</strong> bằng ngôn ngữ của khách
        </p>
      </div>

      {/* Create New Promotion Form */}
      <form
        onSubmit={handleCreatePost}
        className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
            <Megaphone className="h-4 w-4 text-amber-500" />
            <span>Đăng Thông Báo / Ưu Đãi Mới</span>
          </h2>

          <button
            type="button"
            onClick={handleTranslatePost}
            disabled={translating || !titleI18n.vi.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-emerald-500 disabled:opacity-50"
          >
            {translating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Đang dịch 5 thứ tiếng...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>✨ Dịch tự động 5 ngôn ngữ bằng AI</span>
              </>
            )}
          </button>
        </div>

        {/* Language Tabs */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
          {ALL_LOCALES.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setActiveTab(loc)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold ${
                activeTab === loc
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              <span>{LOCALE_META[loc].flag}</span>
              <span>{LOCALE_META[loc].short}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Tiêu đề ưu đãi ({LOCALE_META[activeTab].label}) *
            </label>
            <input
              type="text"
              value={titleI18n[activeTab] || ''}
              onChange={(e) =>
                setTitleI18n((prev) => ({
                  ...prev,
                  [activeTab]: e.target.value,
                }))
              }
              placeholder="VD: Giảm 20% khung giờ vàng 10h - 14h hoặc Tặng 1 trà sâm dứa khi đánh giá Google Maps..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nội dung chi tiết ({LOCALE_META[activeTab].label})
            </label>
            <textarea
              rows={2}
              value={contentI18n[activeTab] || ''}
              onChange={(e) =>
                setContentI18n((prev) => ({
                  ...prev,
                  [activeTab]: e.target.value,
                }))
              }
              placeholder="Mô tả chi tiết điều kiện áp dụng..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isPinned}
              onChange={(e) => setIsPinned(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            <span>📌 Ghim nổi bật lên đầu trang cửa hàng</span>
          </label>

          <button
            type="submit"
            disabled={saving || !titleI18n.vi.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>{saving ? 'Đang đăng...' : 'Đăng Thông Báo'}</span>
          </button>
        </div>
      </form>

      {/* Existing Posts List */}
      <div className="space-y-3">
        {posts.map((post) => (
          <div
            key={post.id}
            className={`rounded-2xl border p-4 shadow-2xs flex items-start justify-between gap-3 ${
              post.is_pinned
                ? 'border-amber-300 bg-amber-50/50'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {post.is_pinned && (
                  <span className="rounded-full bg-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    📌 Đang ghim
                  </span>
                )}
                <h3 className="text-sm font-bold text-slate-900">
                  {post.title_i18n.vi}
                </h3>
              </div>
              <p className="text-xs text-slate-600">{post.content_i18n.vi}</p>
              <div className="flex flex-wrap gap-2 pt-1 text-[11px] text-slate-500">
                {post.title_i18n.en && <span>🇬🇧 {post.title_i18n.en}</span>}
                {post.title_i18n.ko && <span>🇰🇷 {post.title_i18n.ko}</span>}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleTogglePin(post)}
                className={`rounded-xl border p-2 text-xs font-bold ${
                  post.is_pinned
                    ? 'border-amber-300 bg-amber-100 text-amber-900'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
                title="Ghim / Bỏ ghim"
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDeletePost(post.id)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 hover:text-rose-600"
                title="Xóa bài đăng"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
