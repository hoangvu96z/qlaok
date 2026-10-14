'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  Languages,
  ScanLine,
  Smartphone,
  Wifi,
  ArrowRight,
  Check,
  UtensilsCrossed,
  Scissors,
  ShoppingBag,
  Store,
  Globe,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';
import {
  BusinessVertical,
  CartSelection,
  CatalogItem,
  Category,
  Shop,
  SupportedLocale,
} from '@/types/qlaok';
import {
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_SHOPS,
} from '@/lib/seed-data';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
import { formatCurrency, LOCALE_META, tField, UI_LABELS } from '@/lib/i18n-helper';
import { LanguageSwitcher } from '@/components/storefront/LanguageSwitcher';
import { VerticalRenderer } from '@/components/storefront/VerticalRenderer';
import { ShowToStaffModal } from '@/components/storefront/ShowToStaffModal';

export default function MarketingLandingPage() {
  // Interactive Live Demo state
  const [demoVertical, setDemoVertical] = useState<BusinessVertical>('fnb');
  const [demoLocale, setDemoLocale] = useState<SupportedLocale>('ko');
  const [demoCart, setDemoCart] = useState<CartSelection[]>([]);
  const [demoStaffModalOpen, setDemoStaffModalOpen] = useState(false);

  const demoShop: Shop =
    SEED_SHOPS.find((s) => s.vertical === demoVertical) || SEED_SHOPS[0];
  const demoCategories: Category[] = SEED_CATEGORIES.filter(
    (c) => c.shop_id === demoShop.id
  );
  const demoItems: CatalogItem[] = SEED_ITEMS.filter(
    (i) => i.shop_id === demoShop.id
  );

  // Pre-populate 1 item in demo cart when switching vertical so user can immediately test "Show to Staff"
  useEffect(() => {
    const firstItem = SEED_ITEMS.find((i) => i.shop_id === demoShop.id);
    if (firstItem) {
      setDemoCart([
        {
          item: firstItem,
          quantity: 2,
          selectedChoices: [],
          customNote: '',
          quickTags:
            demoVertical === 'fnb'
              ? ['Không hành / rau mùi']
              : demoVertical === 'service'
                ? ['Làm nhẹ tay']
                : ['Đóng gói làm quà tặng'],
        },
      ]);
    }
  }, [demoVertical, demoShop.id]);

  const handleDemoQuickAdd = (item: CatalogItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDemoCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id);
      if (idx !== -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          item,
          quantity: 1,
          selectedChoices: [],
          customNote: '',
          quickTags: [],
        },
      ];
    });
  };

  const demoTotalCount = demoCart.reduce((s, c) => s + c.quantity, 0);
  const demoTotalAmount = demoCart.reduce(
    (s, c) => s + c.item.price * c.quantity,
    0
  );
  const demoLabels = UI_LABELS[demoLocale] || UI_LABELS.vi;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200/80">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white font-black text-xl shadow-md">
              Q
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-slate-950">
                Qlaok
              </span>
              <span className="hidden sm:inline-block ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-800">
                Quét là OK ✨
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-slate-600">
            <a href="#live-demo" className="hover:text-emerald-600">
              Trải nghiệm Demo 5 Ngôn ngữ
            </a>
            <Link href="/explore" className="hover:text-emerald-600">
              Danh bạ Cửa hàng (Directory)
            </Link>
            <Link href="/pricing" className="hover:text-emerald-600">
              Bảng giá
            </Link>
            <Link href="/dashboard" className="hover:text-emerald-600">
              Quản trị Chủ quán (CMS)
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
            >
              Mở CMS Chủ Quán
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-500"
            >
              <span>Tạo Menu QR Miễn Phí</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section + Interactive Live Demo */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white py-12 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Hero Copy */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.12]">
              Qlaok – Quét là OK:{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-amber-300">
                Menu 5 Ngôn Ngữ & Trang Web Riêng
              </span>{' '}
              chỉ trong 2 phút.
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Chủ quán chỉ cần nhập <strong>Tiếng Việt</strong> hoặc <strong>chụp ảnh tờ menu giấy</strong>. AI tự động dịch chuẩn văn phong ẩm thực & dịch vụ sang <strong>Anh, Hàn, Nhật, Trung</strong>. Khách nước ngoài quét mã xem đúng ngôn ngữ điện thoại và bật thẻ <strong>&ldquo;Đưa Nhân Viên Xem&rdquo;</strong> bằng Tiếng Việt cực to rõ!
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-black text-slate-950 shadow-xl hover:bg-emerald-400 active:scale-98"
              >
                <QrCode className="h-5 w-5" />
                <span>Tạo Menu QR Cho Quán Ngay (Miễn Phí)</span>
              </Link>

              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/80 px-5 py-4 text-sm font-bold text-white hover:bg-slate-800"
              >
                <span>Dùng Thử CMS Chủ Quán</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Quick Live Links to the 3 Seed Stores */}
            <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                🔥 Bấm xem trực tiếp 3 Cửa Hàng Mẫu (QR Cửa & QR Bàn):
              </p>
              <div className="flex flex-wrap gap-2">
                {SEED_SHOPS.map((s) => (
                  <Link
                    key={s.id}
                    href={`/s/${s.slug}?src=door`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-emerald-400 hover:text-white"
                  >
                    <span>
                      {s.vertical === 'fnb'
                        ? '🍜'
                        : s.vertical === 'service'
                          ? '💆‍♀️'
                          : '🛍️'}
                    </span>
                    <span>{s.name}</span>
                    <ExternalLink className="h-3 w-3 text-emerald-400" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Right Interactive Live Phone Demo */}
          <div id="live-demo" className="lg:col-span-6 space-y-4">
            {/* Demo Switcher Controls: 3 Verticals & 5 Languages */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-extrabold text-emerald-400">
                  👇 Bấm chuyển thử 3 ngành nghề & 5 ngôn ngữ:
                </span>
                <span className="text-[11px] text-slate-400">
                  Interactive Live Preview
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'fnb' as BusinessVertical,
                    label: '🍜 Quán Ăn / Cafe',
                  },
                  {
                    id: 'service' as BusinessVertical,
                    label: '💆‍♀️ Tiệm Nail & Spa',
                  },
                  {
                    id: 'retail' as BusinessVertical,
                    label: '🛍️ Shop Đặc Sản',
                  },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDemoVertical(tab.id)}
                    className={`rounded-xl py-2 px-2.5 text-xs font-black transition-all ${
                      demoVertical === tab.id
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] font-bold text-slate-400">
                  Đổi ngôn ngữ khách:
                </span>
                <LanguageSwitcher
                  currentLocale={demoLocale}
                  onChange={setDemoLocale}
                  compact={false}
                />
              </div>
            </div>

            {/* Simulated Mobile Phone Frame */}
            <div className="mx-auto max-w-md rounded-[32px] border-4 border-slate-800 bg-slate-50 text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[540px]">
              {/* Phone Header */}
              <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <h3 className="truncate text-sm font-black text-slate-900">
                      {demoShop.name}
                    </h3>
                  </div>
                  <p className="truncate text-[11px] text-slate-500">
                    {tField(demoShop.tagline_i18n, demoLocale)}
                  </p>
                </div>

                <Link
                  href={`/s/${demoShop.slug}/menu?lang=${demoLocale}`}
                  className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                >
                  Mở toàn màn hình ↗
                </Link>
              </div>

              {/* Scrollable Menu inside Phone */}
              <div className="flex-1 overflow-y-auto p-3.5">
                <VerticalRenderer
                  vertical={demoVertical}
                  categories={demoCategories}
                  items={demoItems}
                  locale={demoLocale}
                  currency="VND"
                  primaryColor={demoShop.theme_config.primaryColor}
                  selectedCategoryId="all"
                  searchQuery=""
                  onSelectItem={(item) => {
                    // Add item on tap in demo
                    setDemoCart((prev) => [
                      ...prev,
                      {
                        item,
                        quantity: 1,
                        selectedChoices: [],
                        customNote: '',
                        quickTags: [],
                      },
                    ]);
                  }}
                  onQuickAdd={handleDemoQuickAdd}
                />
              </div>

              {/* Phone Bottom Bar: Trigger Show to Staff Card */}
              <div className="border-t border-slate-200 bg-white p-3">
                <button
                  type="button"
                  onClick={() => setDemoStaffModalOpen(true)}
                  style={{
                    backgroundColor: demoShop.theme_config.primaryColor,
                  }}
                  className="w-full flex items-center justify-between rounded-2xl px-4 py-3 text-white shadow-lg active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-xs font-black">
                      {demoTotalCount}
                    </span>
                    <div className="text-left">
                      <span className="block text-xs font-black">
                        {demoVertical === 'service'
                          ? demoLabels.bottomCtaService
                          : demoVertical === 'retail'
                            ? demoLabels.bottomCtaRetail
                            : demoLabels.bottomCtaFnb}
                      </span>
                      <span className="block text-[10px] text-white/90">
                        👆 Bấm thử để xem Thẻ Chữ Tiếng Việt Cỡ Lớn!
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-black">
                    {formatCurrency(demoTotalAmount)}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5 Core Features Section */}
      <section className="py-16 mx-auto max-w-6xl px-4 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600">
            5 Trụ cột tính năng cốt lõi
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
            Thiết kế riêng cho chủ quán Việt Nam đón khách nội địa & quốc tế
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Languages className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              1. Tự động dịch 5 ngôn ngữ chuẩn ngữ cảnh
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Chủ quán chỉ nhập Tiếng Việt. AI tự động dịch sang Anh, Hàn, Nhật, Trung kèm giải thích nguyên liệu cho các món đặc sản như Bạc xỉu, Phở tái, Gội đầu dưỡng sinh.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ScanLine className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              2. AI Vision Quét Ảnh Menu Giấy 10 Giây
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Chụp ảnh tờ thực đơn giấy hoặc màn hình GrabFood. AI tự động bóc tách Danh mục, Tên món, quy đổi giá tiền và dịch 5 thứ tiếng ngay lập tức.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-700">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              3. Thẻ &ldquo;Đưa Nhân Viên Xem&rdquo; Chữ To Rõ
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Khách Tây, Hàn, Nhật, Trung chọn món & ghi chú bằng tiếng mẹ đẻ, bấm nút sẽ bật thẻ chữ Tiếng Việt cực to để đưa nhân viên xem, xóa bỏ hoàn toàn rào cản ngôn ngữ.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white font-black">
              Q
            </span>
            <span className="font-bold text-slate-900">
              Qlaok (Quét là OK)
            </span>
            <span>— Menu, Bảng giá & Web Đa Ngôn Ngữ</span>
          </div>
          <div className="flex items-center gap-4 font-semibold">
            <Link href="/explore" className="hover:text-slate-900">
              Khám phá cửa hàng
            </Link>
            <Link href="/pricing" className="hover:text-slate-900">
              Bảng giá
            </Link>
            <Link href="/dashboard" className="hover:text-slate-900">
              Dashboard CMS
            </Link>
          </div>
        </div>
      </footer>

      {/* Show To Staff Modal for Interactive Landing Page Demo */}
      <ShowToStaffModal
        isOpen={demoStaffModalOpen}
        onClose={() => setDemoStaffModalOpen(false)}
        shop={demoShop}
        locale={demoLocale}
        cart={demoCart}
        onUpdateQuantity={(idx, delta) => {
          setDemoCart((prev) => {
            const next = [...prev];
            const q = next[idx].quantity + delta;
            if (q <= 0) next.splice(idx, 1);
            else next[idx] = { ...next[idx], quantity: q };
            return next;
          });
        }}
        onClearCart={() => setDemoCart([])}
      />
    </div>
  );
}
