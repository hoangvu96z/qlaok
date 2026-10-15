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
  Flame,
  Zap,
  Gift,
  Eye,
  Save,
  Percent,
  Banknote,
  Clock,
  ShoppingBag,
  Smartphone,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import {
  CatalogItem,
  I18nText,
  Post,
  ShopFlashSaleConfig,
  ShopPopupConfig,
  ShopPromoBannerConfig,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META, formatCurrency } from '@/lib/i18n-helper';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { StorefrontWelcomePopup } from '@/components/storefront/StorefrontCustomDecor';
import { RightPreviewSidebar } from '@/components/dashboard/RightPreviewSidebar';
import { FlashSaleSchedulePicker } from '@/components/ui/TimeSchedulePicker';

const formatVnd = (amount: number) => formatCurrency(amount, 'VND');

type StudioTab = 'discount_banner' | 'flash_sale' | 'posts';

const BANNER_GRADIENT_SWATCHES: Array<{
  id: NonNullable<ShopPromoBannerConfig['bgGradient']>;
  css: string;
}> = [
  {
    id: 'amber_rose',
    css: 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-600',
  },
  {
    id: 'emerald_teal',
    css: 'bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700',
  },
  {
    id: 'violet_fuchsia',
    css: 'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600',
  },
  {
    id: 'royal_gold',
    css: 'bg-gradient-to-br from-slate-900 via-amber-900 to-amber-600',
  },
];

export default function DashboardPostsPage() {
  const { activeShop, refreshDashboard } = useDashboard();

  const [studioTab, setStudioTab] = useState<StudioTab>('discount_banner');
  const [shopItems, setShopItems] = useState<CatalogItem[]>([]);
  const [savingPromo, setSavingPromo] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);
  const [isPreviewSidebarOpen, setIsPreviewSidebarOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('qlaok_right_preview_open');
      if (saved === '0') setIsPreviewSidebarOpen(false);
      else if (saved === '1') setIsPreviewSidebarOpen(true);
    } catch {
      // ignore
    }
  }, []);

  const togglePreviewSidebar = () => {
    setIsPreviewSidebarOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('qlaok_right_preview_open', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  // 1. Discount & Banner Config
  const [promoBanner, setPromoBanner] = useState<ShopPromoBannerConfig>({
    enabled: true,
    badgeText: '🔥 ƯU ĐÃI ĐẶC BIỆT',
    title: 'Giảm 15% cho đơn từ 100.000đ khi đặt tại bàn',
    subtitle: 'Tự động áp dụng khi gọi món qua mã QR',
    bgGradient: 'amber_rose',
    ctaText: 'Xem chi tiết',
    discountType: 'percent',
    discountValue: 15,
    minOrderAmount: 100000,
    applyScope: 'all',
    selectedItemIds: [],
    voucherCode: 'QLAOK15',
  });

  // 2. Welcome Popup Config
  const [welcomePopup, setWelcomePopup] = useState<ShopPopupConfig>({
    enabled: false,
    badgeText: '🎁 VOUCHER CHÀO MỪNG',
    title: 'Giảm ngay 15% cho đơn hàng hôm nay!',
    content: 'Áp dụng trực tiếp khi bạn chọn món trên Menu QR và đưa màn hình cho nhân viên.',
    imageUrl: '',
    voucherCode: 'QLAOK15',
    ctaText: 'Nhận Ưu Đãi & Xem Menu',
  });

  // 3. Flash Sale Config
  const [flashSale, setFlashSale] = useState<ShopFlashSaleConfig>({
    enabled: false,
    badgeText: '⚡ FLASH SALE GIỜ VÀNG',
    title: 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
    discountType: 'percent',
    discountValue: 25,
    startTime: '11:00',
    endTime: '22:00',
    itemIds: [],
  });

  // 4. Multilingual Posts State
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
  const [activeLangTab, setActiveLangTab] = useState<SupportedLocale>('vi');
  const [translating, setTranslating] = useState(false);
  const [savingPost, setSavingPost] = useState(false);

  const loadPosts = useCallback(async () => {
    if (!activeShop) return;
    const res = await fetch(`/api/posts?shopId=${activeShop.id}`, {
      cache: 'no-store',
    });
    const data = await res.json();
    setPosts(data.posts || []);
  }, [activeShop]);

  useEffect(() => {
    if (!activeShop) return;
    loadPosts();

    fetch(`/api/catalog?shopId=${activeShop.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const fetchedItems: CatalogItem[] = Array.isArray(data.items)
          ? data.items
          : [];
        setShopItems(fetchedItems);

        // Pre-populate Flash Sale items with first 3 items if empty
        const existingFs = activeShop.theme_config?.flashSale;
        if (
          (!existingFs || !existingFs.itemIds?.length) &&
          fetchedItems.length > 0
        ) {
          setFlashSale((prev) => ({
            ...prev,
            itemIds: fetchedItems.slice(0, 3).map((i) => i.id),
          }));
        }
      })
      .catch(() => {});

    const tc = activeShop.theme_config;
    if (tc?.promoBanner) {
      setPromoBanner({
        enabled: Boolean(tc.promoBanner.enabled),
        badgeText: tc.promoBanner.badgeText || '🔥 ƯU ĐÃI ĐẶC BIỆT',
        title: tc.promoBanner.title || '',
        subtitle: tc.promoBanner.subtitle || '',
        bgGradient: tc.promoBanner.bgGradient || 'amber_rose',
        ctaText: tc.promoBanner.ctaText || 'Xem chi tiết',
        discountType: tc.promoBanner.discountType || 'percent',
        discountValue:
          typeof tc.promoBanner.discountValue === 'number'
            ? tc.promoBanner.discountValue
            : 15,
        minOrderAmount:
          typeof tc.promoBanner.minOrderAmount === 'number'
            ? tc.promoBanner.minOrderAmount
            : 0,
        applyScope: tc.promoBanner.applyScope || 'all',
        selectedItemIds: tc.promoBanner.selectedItemIds || [],
        voucherCode: tc.promoBanner.voucherCode || '',
      });
    }

    if (tc?.welcomePopup) {
      setWelcomePopup({
        enabled: Boolean(tc.welcomePopup.enabled),
        badgeText: tc.welcomePopup.badgeText || '🎁 VOUCHER CHÀO MỪNG',
        title: tc.welcomePopup.title || '',
        content: tc.welcomePopup.content || '',
        imageUrl: tc.welcomePopup.imageUrl || '',
        voucherCode: tc.welcomePopup.voucherCode || '',
        ctaText: tc.welcomePopup.ctaText || 'Nhận Ưu Đãi & Xem Menu',
      });
    }

    if (tc?.flashSale) {
      const todayIso = new Date().toISOString().slice(0, 10);
      setFlashSale({
        enabled: Boolean(tc.flashSale.enabled),
        badgeText: tc.flashSale.badgeText || '⚡ FLASH SALE GIỜ VÀNG',
        title:
          tc.flashSale.title || 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
        discountType: tc.flashSale.discountType || 'percent',
        discountValue:
          typeof tc.flashSale.discountValue === 'number'
            ? tc.flashSale.discountValue
            : 25,
        startDate: tc.flashSale.startDate || todayIso,
        endDate: tc.flashSale.endDate || tc.flashSale.startDate || todayIso,
        startTime: tc.flashSale.startTime || '11:00',
        endTime: tc.flashSale.endTime || '22:00',
        itemIds: tc.flashSale.itemIds || [],
      });
    }
  }, [activeShop, loadPosts]);

  if (!activeShop) return null;

  // Auto-generate friendly banner text whenever discount rules change
  const syncBannerCopyFromRule = (next: ShopPromoBannerConfig) => {
    const valStr =
      next.discountType === 'percent'
        ? `${next.discountValue || 0}%`
        : formatVnd(next.discountValue || 0);
    const minStr =
      (next.minOrderAmount || 0) > 0
        ? ` cho đơn từ ${formatVnd(next.minOrderAmount || 0)}`
        : '';
    const scopeStr =
      next.applyScope === 'selected_items'
        ? ` (${(next.selectedItemIds || []).length} món ưu đãi)`
        : ' toàn thực đơn';

    const autoTitle = `Giảm ngay ${valStr}${minStr}`;
    const autoSub = `Áp dụng${scopeStr} khi đặt món qua QR`;

    setPromoBanner({
      ...next,
      title: autoTitle,
      subtitle: autoSub,
    });

    // Also keep welcome popup synced if enabled
    setWelcomePopup((prev) => ({
      ...prev,
      title: autoTitle,
      voucherCode: next.voucherCode || prev.voucherCode,
    }));
  };

  const toggleBannerItem = (itemId: string) => {
    const current = promoBanner.selectedItemIds || [];
    const exists = current.includes(itemId);
    const nextIds = exists
      ? current.filter((id) => id !== itemId)
      : [...current, itemId];
    syncBannerCopyFromRule({
      ...promoBanner,
      selectedItemIds: nextIds,
    });
  };

  const toggleFlashSaleItem = (itemId: string) => {
    const current = flashSale.itemIds || [];
    const exists = current.includes(itemId);
    const nextIds = exists
      ? current.filter((id) => id !== itemId)
      : [...current, itemId];
    setFlashSale((prev) => ({
      ...prev,
      itemIds: nextIds,
    }));
  };

  const handleSavePromotions = async () => {
    setSavingPromo(true);
    setSavedSuccess(false);
    try {
      const nextThemeConfig: ShopThemeConfig = {
        ...activeShop.theme_config,
        promoBanner,
        welcomePopup: {
          ...welcomePopup,
          voucherCode: promoBanner.voucherCode || welcomePopup.voucherCode,
        },
        flashSale,
      };

      const res = await fetch('/api/shops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeShop.id,
          theme_config: nextThemeConfig,
        }),
      });

      if (res.ok) {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({ type: 'shop_updated', shopId: activeShop.id });
          bc.close();
        }
        await refreshDashboard();
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      }
    } finally {
      setSavingPromo(false);
    }
  };

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
      setActiveLangTab('en');
    } finally {
      setTranslating(false);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleI18n.vi.trim()) return;
    setSavingPost(true);
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
      setSavingPost(false);
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

  // Live preview shop object for the right-hand smartphone viewer
  const previewShop = {
    ...activeShop,
    theme_config: {
      ...activeShop.theme_config,
      promoBanner,
      welcomePopup: {
        ...welcomePopup,
        enabled: true,
        voucherCode: promoBanner.voucherCode || welcomePopup.voucherCode,
      },
      flashSale,
    },
  };

  return (
    <div
      className={`space-y-5 pb-12 transition-all duration-300 ${
        isPreviewSidebarOpen ? 'xl:pr-[385px]' : ''
      }`}
    >
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            Khuyến Mãi, Giảm Giá &amp; Flash Sale ({activeShop.name})
          </h1>
          <p className="text-xs text-slate-500">
            Thiết lập giảm giá theo % hoặc số tiền, chọn món ưu đãi, bật Flash Sale giờ vàng và xem trực tiếp trên Slide-bar bên phải
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePreviewSidebar}
            className={`inline-flex items-center gap-1.5 rounded-2xl border px-3.5 py-2.5 text-xs font-bold transition ${
              isPreviewSidebarOpen
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
            <span>
              {isPreviewSidebarOpen ? 'Ẩn Slide-bar Xem Trước' : 'Mở Slide-bar Xem Trước'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewPopupOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3.5 w-3.5 text-amber-500" />
            <span>Xem Thử Popup</span>
          </button>

          <button
            type="button"
            onClick={handleSavePromotions}
            disabled={savingPromo}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4" />
                <span>Đã Lưu Khuyến Mãi!</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{savingPromo ? 'Đang lưu...' : 'Lưu & Áp Dụng Ngay'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 w-fit shadow-2xs">
        <button
          type="button"
          onClick={() => setStudioTab('discount_banner')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
            studioTab === 'discount_banner'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Flame className="h-4 w-4 text-amber-400" />
          <span>1. Giảm Giá Hóa Đơn / Theo Món &amp; Banner</span>
          {promoBanner.enabled && (
            <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] text-white">
              BẬT
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setStudioTab('flash_sale')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
            studioTab === 'flash_sale'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Zap className="h-4 w-4 text-amber-300" />
          <span>2. Flash Sale Giờ Vàng</span>
          {flashSale.enabled && (
            <span className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] text-slate-950">
              BẬT
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setStudioTab('posts')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
            studioTab === 'posts'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Megaphone className="h-4 w-4" />
          <span>3. Bản Tin Đa Ngôn Ngữ ({posts.length})</span>
        </button>
      </div>

      {/* Main Controls Area (Full Width alongside Right Slide-Bar Preview) */}
      <div className="space-y-5">
        <div className="space-y-5">
          {/* TAB 1: DISCOUNT & BANNER / POPUP */}
          {studioTab === 'discount_banner' && (
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5">
              {/* Enable toggle */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-orange-500" />
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      Chương Trình Giảm Giá &amp; Banner Đầu Menu
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Tự động tính tiền giảm trên giỏ hàng của khách và hiển thị Banner nổi bật
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={promoBanner.enabled}
                    onChange={(e) =>
                      setPromoBanner((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <span className="text-xs font-extrabold text-slate-900">
                    {promoBanner.enabled ? 'Đang bật' : 'Đang tắt'}
                  </span>
                </label>
              </div>

              {/* Step A: Discount Type (% vs Fixed Amount) & Value */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    Hình thức giảm giá
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        syncBannerCopyFromRule({
                          ...promoBanner,
                          discountType: 'percent',
                          discountValue: 15,
                        })
                      }
                      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-extrabold transition ${
                        promoBanner.discountType !== 'fixed_amount'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      <Percent className="h-3.5 w-3.5" />
                      <span>Theo %</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        syncBannerCopyFromRule({
                          ...promoBanner,
                          discountType: 'fixed_amount',
                          discountValue: 20000,
                        })
                      }
                      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-extrabold transition ${
                        promoBanner.discountType === 'fixed_amount'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      <Banknote className="h-3.5 w-3.5" />
                      <span>Số tiền (đ)</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    Mức giảm ({promoBanner.discountType === 'fixed_amount' ? 'VNĐ' : '%'})
                  </label>
                  <div className="space-y-2">
                    <input
                      type="number"
                      min={0}
                      value={promoBanner.discountValue || 0}
                      onChange={(e) =>
                        syncBannerCopyFromRule({
                          ...promoBanner,
                          discountValue: Math.max(0, Number(e.target.value)),
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-black text-emerald-700"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {(promoBanner.discountType === 'fixed_amount'
                        ? [10000, 20000, 30000, 50000]
                        : [10, 15, 20, 30]
                      ).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() =>
                            syncBannerCopyFromRule({
                              ...promoBanner,
                              discountValue: preset,
                            })
                          }
                          className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                            promoBanner.discountValue === preset
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {promoBanner.discountType === 'fixed_amount'
                            ? `-${preset / 1000}k`
                            : `-${preset}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Step B: Minimum Order Value */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Đơn hàng tối thiểu để được giảm
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { label: 'Không giới hạn (0đ)', val: 0 },
                    { label: 'Từ 50.000đ', val: 50000 },
                    { label: 'Từ 100.000đ', val: 100000 },
                    { label: 'Từ 200.000đ', val: 200000 },
                    { label: 'Từ 300.000đ', val: 300000 },
                  ].map((chip) => (
                    <button
                      key={chip.val}
                      type="button"
                      onClick={() =>
                        syncBannerCopyFromRule({
                          ...promoBanner,
                          minOrderAmount: chip.val,
                        })
                      }
                      className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                        (promoBanner.minOrderAmount || 0) === chip.val
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}

                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={promoBanner.minOrderAmount || 0}
                    onChange={(e) =>
                      syncBannerCopyFromRule({
                        ...promoBanner,
                        minOrderAmount: Math.max(0, Number(e.target.value)),
                      })
                    }
                    placeholder="Tự nhập số tiền..."
                    className="w-36 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              {/* Step C: Scope — All Menu vs Selected Products */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700">
                  Phạm vi sản phẩm áp dụng
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      syncBannerCopyFromRule({
                        ...promoBanner,
                        applyScope: 'all',
                      })
                    }
                    className={`flex items-center gap-2.5 rounded-2xl border p-3 text-left transition ${
                      promoBanner.applyScope !== 'selected_items'
                        ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <ShoppingBag className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="block text-xs font-extrabold">
                        Toàn bộ thực đơn
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        Giảm trên tổng hóa đơn
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      syncBannerCopyFromRule({
                        ...promoBanner,
                        applyScope: 'selected_items',
                      })
                    }
                    className={`flex items-center gap-2.5 rounded-2xl border p-3 text-left transition ${
                      promoBanner.applyScope === 'selected_items'
                        ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="block text-xs font-extrabold">
                        Chọn một số món cụ thể ({(promoBanner.selectedItemIds || []).length})
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        Chỉ giảm giá các món được tích chọn
                      </span>
                    </div>
                  </button>
                </div>

                {/* Product Picker when selected_items is active */}
                {promoBanner.applyScope === 'selected_items' && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        Tích chọn các món được giảm giá ({(promoBanner.selectedItemIds || []).length}/{shopItems.length} món):
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            syncBannerCopyFromRule({
                              ...promoBanner,
                              selectedItemIds: shopItems.map((i) => i.id),
                            })
                          }
                          className="text-[11px] font-bold text-emerald-700 hover:underline"
                        >
                          Chọn tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            syncBannerCopyFromRule({
                              ...promoBanner,
                              selectedItemIds: [],
                            })
                          }
                          className="text-[11px] font-bold text-slate-500 hover:underline"
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                      {shopItems.map((item) => {
                        const checked = (
                          promoBanner.selectedItemIds || []
                        ).includes(item.id);
                        const newPrice =
                          promoBanner.discountType === 'fixed_amount'
                            ? Math.max(
                                0,
                                item.price -
                                  (promoBanner.discountValue || 0)
                              )
                            : Math.max(
                                0,
                                Math.round(
                                  (item.price *
                                    (100 - (promoBanner.discountValue || 0))) /
                                    100
                                )
                              );
                        return (
                          <label
                            key={item.id}
                            className={`flex items-center gap-2.5 rounded-xl border p-2 cursor-pointer transition ${
                              checked
                                ? 'border-emerald-500 bg-emerald-50/80'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBannerItem(item.id)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                            />
                            {item.image_url && (
                              <img
                                src={item.image_url}
                                alt={item.name_i18n.vi}
                                className="h-9 w-9 rounded-lg object-cover shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {item.name_i18n.vi}
                              </p>
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <span className="font-extrabold text-emerald-700">
                                  {formatVnd(newPrice)}
                                </span>
                                <span className="line-through text-slate-400 text-[10px]">
                                  {formatVnd(item.price)}
                                </span>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Step D: Banner Color Swatches (No text labels) & Text */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Màu Banner
                    </label>
                    <div className="flex items-center gap-2.5">
                      {BANNER_GRADIENT_SWATCHES.map((sw) => {
                        const active =
                          (promoBanner.bgGradient || 'amber_rose') === sw.id;
                        return (
                          <button
                            key={sw.id}
                            type="button"
                            onClick={() =>
                              setPromoBanner((prev) => ({
                                ...prev,
                                bgGradient: sw.id,
                              }))
                            }
                            aria-label={sw.id}
                            className={`h-8 w-8 rounded-full transition-transform ${sw.css} ${
                              active
                                ? 'scale-110 ring-2 ring-offset-2 ring-slate-900 shadow-sm'
                                : 'opacity-80 hover:opacity-100'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Mã Voucher (Tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={promoBanner.voucherCode || ''}
                      onChange={(e) => {
                        const code = e.target.value.toUpperCase();
                        setPromoBanner((prev) => ({
                          ...prev,
                          voucherCode: code,
                        }));
                        setWelcomePopup((prev) => ({
                          ...prev,
                          voucherCode: code,
                        }));
                      }}
                      placeholder="VD: QLAOK15"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono font-bold text-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Tiêu đề hiển thị trên Banner
                    </label>
                    <input
                      type="text"
                      value={promoBanner.title}
                      onChange={(e) =>
                        setPromoBanner((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Mô tả phụ
                    </label>
                    <input
                      type="text"
                      value={promoBanner.subtitle || ''}
                      onChange={(e) =>
                        setPromoBanner((prev) => ({
                          ...prev,
                          subtitle: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
                    />
                  </div>
                </div>

                {/* Also Show as Welcome Popup Toggle */}
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Gift className="h-5 w-5 text-rose-500 shrink-0" />
                    <div>
                      <p className="text-xs font-extrabold text-slate-900">
                        Bật thêm Popup Chào Mừng tự động khi khách vừa quét QR
                      </p>
                      <p className="text-[11px] text-slate-600">
                        Popup sẽ hiển thị mã voucher và chương trình ưu đãi này ngay khi mở trang
                      </p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={welcomePopup.enabled}
                    onChange={(e) =>
                      setWelcomePopup((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                        title: promoBanner.title || prev.title,
                        content: promoBanner.subtitle || prev.content,
                        voucherCode:
                          promoBanner.voucherCode || prev.voucherCode,
                      }))
                    }
                    className="h-5 w-5 rounded border-slate-300 text-emerald-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: FLASH SALE STUDIO */}
          {studioTab === 'flash_sale' && (
            <div className="rounded-3xl border-2 border-rose-500/30 bg-white p-5 shadow-2xs space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-amber-300">
                    <Zap className="h-5 w-5 fill-amber-300" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      Flash Sale Giờ Vàng (Đếm Ngược Trực Tiếp)
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Tạo kệ hàng Flash Sale có đồng hồ đếm ngược và tự động gạch giá gốc trên Menu
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 cursor-pointer rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={flashSale.enabled}
                    onChange={(e) =>
                      setFlashSale((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-rose-300 text-rose-600"
                  />
                  <span className="text-xs font-extrabold text-rose-900">
                    {flashSale.enabled ? 'Đang chạy Flash Sale' : 'Đang tắt'}
                  </span>
                </label>
              </div>

              {/* Flash Sale Discount Type & Value */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Kiểu giảm Flash Sale
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFlashSale((prev) => ({
                          ...prev,
                          discountType: 'percent',
                          discountValue: 25,
                        }))
                      }
                      className={`rounded-xl border py-2 text-xs font-extrabold ${
                        flashSale.discountType === 'percent'
                          ? 'border-rose-600 bg-rose-50 text-rose-900'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      Theo %
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFlashSale((prev) => ({
                          ...prev,
                          discountType: 'fixed_amount',
                          discountValue: 15000,
                        }))
                      }
                      className={`rounded-xl border py-2 text-xs font-extrabold ${
                        flashSale.discountType === 'fixed_amount'
                          ? 'border-rose-600 bg-rose-50 text-rose-900'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}
                    >
                      Số tiền (đ)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Mức giảm ({flashSale.discountType === 'percent' ? '%' : 'đ'})
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={flashSale.discountValue}
                    onChange={(e) =>
                      setFlashSale((prev) => ({
                        ...prev,
                        discountValue: Math.max(1, Number(e.target.value)),
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-rose-600"
                  />
                </div>
              </div>

              {/* Multi-Day + Time Slot Shared Schedule Picker */}
              <FlashSaleSchedulePicker
                flashSale={flashSale}
                onChange={(nextFs) => setFlashSale(nextFs)}
              />

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tiêu đề chương trình Flash Sale
                </label>
                <input
                  type="text"
                  value={flashSale.title}
                  onChange={(e) =>
                    setFlashSale((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="VD: Giờ Vàng Giá Sốc - Giảm 25% Món Best Seller"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
                />
              </div>

              {/* Flash Sale Item Selector */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">
                    Chọn sản phẩm đưa lên kệ Flash Sale ({flashSale.itemIds.length} món):
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFlashSale((prev) => ({
                          ...prev,
                          itemIds: shopItems.slice(0, 4).map((i) => i.id),
                        }))
                      }
                      className="text-[11px] font-bold text-rose-600 hover:underline"
                    >
                      Chọn 4 món đầu
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFlashSale((prev) => ({
                          ...prev,
                          itemIds: shopItems.map((i) => i.id),
                        }))
                      }
                      className="text-[11px] font-bold text-emerald-700 hover:underline"
                    >
                      Chọn tất cả
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-64 overflow-y-auto pr-1">
                  {shopItems.map((item) => {
                    const checked = flashSale.itemIds.includes(item.id);
                    const salePrice =
                      flashSale.discountType === 'fixed_amount'
                        ? Math.max(0, item.price - flashSale.discountValue)
                        : Math.max(
                            0,
                            Math.round(
                              (item.price *
                                (100 - flashSale.discountValue)) /
                                100
                            )
                          );

                    return (
                      <label
                        key={item.id}
                        className={`flex items-center gap-2.5 rounded-2xl border p-2.5 cursor-pointer transition ${
                          checked
                            ? 'border-rose-500 bg-rose-50/70 shadow-2xs'
                            : 'border-slate-200 bg-slate-50 hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFlashSaleItem(item.id)}
                          className="h-4 w-4 rounded border-slate-300 text-rose-600"
                        />
                        {item.image_url && (
                          <img
                            src={item.image_url}
                            alt={item.name_i18n.vi}
                            className="h-10 w-10 rounded-xl object-cover shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-slate-900 truncate">
                            {item.name_i18n.vi}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs font-black text-rose-600">
                              ⚡ {formatVnd(salePrice)}
                            </span>
                            <span className="text-[10px] line-through text-slate-400">
                              {formatVnd(item.price)}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MULTILINGUAL POSTS */}
          {studioTab === 'posts' && (
            <div className="space-y-4">
              <form
                onSubmit={handleCreatePost}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Megaphone className="h-4 w-4 text-emerald-600" />
                    <span>Đăng Bản Tin / Thông Báo Đa Ngôn Ngữ</span>
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
                        <span>Đang dịch 8 thứ tiếng...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>✨ Dịch tự động 8 ngôn ngữ</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
                  {ALL_LOCALES.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setActiveLangTab(loc)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${
                        activeLangTab === loc
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600'
                      }`}
                    >
                      <FlagIcon locale={loc} className="h-3.5 w-5" />
                      <span>{LOCALE_META[loc].short}</span>
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Tiêu đề ({LOCALE_META[activeLangTab].label}) *
                    </label>
                    <input
                      type="text"
                      value={titleI18n[activeLangTab] || ''}
                      onChange={(e) =>
                        setTitleI18n((prev) => ({
                          ...prev,
                          [activeLangTab]: e.target.value,
                        }))
                      }
                      placeholder="VD: Khuyến mãi mua 2 tặng 1 cuối tuần..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nội dung chi tiết ({LOCALE_META[activeLangTab].label})
                    </label>
                    <textarea
                      rows={2}
                      value={contentI18n[activeLangTab] || ''}
                      onChange={(e) =>
                        setContentI18n((prev) => ({
                          ...prev,
                          [activeLangTab]: e.target.value,
                        }))
                      }
                      placeholder="Mô tả chi tiết..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-800"
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
                    <span>📌 Ghim đầu trang cửa hàng</span>
                  </label>

                  <button
                    type="submit"
                    disabled={savingPost || !titleI18n.vi.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{savingPost ? 'Đang đăng...' : 'Đăng Thông Báo'}</span>
                  </button>
                </div>
              </form>

              <div className="space-y-2.5">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className={`rounded-2xl border p-4 shadow-2xs flex items-start justify-between gap-3 ${
                      post.is_pinned
                        ? 'border-amber-300 bg-amber-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {post.is_pinned && (
                          <span className="rounded-full bg-amber-400/30 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                            📌 Đang ghim
                          </span>
                        )}
                        <h3 className="text-sm font-bold text-slate-900">
                          {post.title_i18n.vi}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-600">
                        {post.content_i18n.vi}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePin(post)}
                        className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500"
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePost(post.id)}
                        className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Slide-Bar Interactive Smartphone Viewer */}
        <RightPreviewSidebar
          shop={previewShop}
          items={shopItems}
          isOpen={isPreviewSidebarOpen}
          onToggle={togglePreviewSidebar}
          onOpenPopupPreview={() => setPreviewPopupOpen(true)}
          subtitle="Xem trực tiếp Banner, Giảm giá & Flash Sale trên màn hình khách"
        >
          <button
            type="button"
            onClick={() => setPreviewPopupOpen(true)}
            className="w-full rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 flex items-center justify-center gap-1.5 transition"
          >
            <Eye className="h-3.5 w-3.5 text-amber-600" />
            <span>Mở thử Popup Chào Mừng toàn màn hình</span>
          </button>
        </RightPreviewSidebar>
      </div>

      {/* Welcome Popup Preview Modal */}
      <StorefrontWelcomePopup
        shop={previewShop}
        isOpen={previewPopupOpen}
        onClose={() => setPreviewPopupOpen(false)}
      />
    </div>
  );
}
