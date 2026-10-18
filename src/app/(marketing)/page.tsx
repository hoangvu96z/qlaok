'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  Languages,
  ScanLine,
  ArrowRight,
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
import { formatCurrency, tField, UI_LABELS } from '@/lib/i18n-helper';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';
import { LanguageSwitcher } from '@/components/storefront/LanguageSwitcher';
import { VerticalRenderer } from '@/components/storefront/VerticalRenderer';
import { ShowToStaffModal } from '@/components/storefront/ShowToStaffModal';

export default function MarketingLandingPage() {
  const { tx } = useAppI18n();

  // Interactive Live Demo state (independent 8-language storefront preview)
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
                {tx('Quét là OK ✨', 'Scan & Order ✨')}
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-slate-600">
            <a href="#live-demo" className="hover:text-emerald-600">
              {tx('Xem bản thử', 'Live Demo')}
            </a>
            <Link href="/explore" className="hover:text-emerald-600">
              {tx('Khám phá quán', 'Explore Stores')}
            </Link>
            <Link href="/pricing" className="hover:text-emerald-600">
              {tx('Bảng giá', 'Pricing')}
            </Link>
            <Link href="/login" className="hover:text-emerald-600">
              {tx('Quản lý quán', 'Store Login')}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <AppLanguageSwitcher />
            <Link
              href="/login"
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100"
            >
              {tx('Đăng nhập', 'Sign in')}
            </Link>
            <Link
              href="/login?mode=register"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-500"
            >
              <span>{tx('Tạo quán mới', 'Create Store')}</span>
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
                {tx(
                  'Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng',
                  'Multilingual QR Menu, Price List & Storefront for Every Shop'
                )}
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.12]">
              {tx('Qlaok – Quét là OK:', 'Qlaok – Scan & Order:')}{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-amber-300">
                {tx(
                  'Menu Đa Ngôn Ngữ & Trang Web Riêng',
                  'Multilingual Menu & Storefront'
                )}
              </span>{' '}
              {tx('chỉ trong 2 phút.', 'in just 2 minutes.')}
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              {tx(
                'Chủ quán chỉ cần nhập Tiếng Việt hoặc chụp ảnh tờ menu giấy. AI tự động dịch chuẩn văn phong ẩm thực & dịch vụ sang 8 ngôn ngữ (Việt, Anh, Hàn, Nhật, Trung, Tây Ban Nha, Ý, Nga). Khách nước ngoài quét mã xem đúng ngôn ngữ điện thoại, gửi đơn tại bàn hoặc bật thẻ "Đưa Nhân Viên Xem" bằng Tiếng Việt cực to rõ!',
                'Owners simply type in Vietnamese or snap a photo of their paper menu. AI automatically translates dishes and services into 8 languages (Vietnamese, English, Korean, Japanese, Chinese, Spanish, Italian, Russian). International guests scan the QR code in their phone language, send table orders, or display a large Vietnamese "Show to Staff" card!'
              )}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/login?mode=register"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-black text-slate-950 shadow-xl hover:bg-emerald-400 active:scale-98"
              >
                <QrCode className="h-5 w-5" />
                <span>
                  {tx('Tạo Menu QR Miễn Phí', 'Create Free QR Menu')}
                </span>
              </Link>

              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/80 px-5 py-4 text-sm font-bold text-white hover:bg-slate-800"
              >
                <span>{tx('Vào trang quản lý', 'Manage Store')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Quick Live Links to the 3 Seed Stores */}
            <div className="pt-4 border-t border-slate-800/80 space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {tx(
                  '🔥 Bấm xem trực tiếp 3 cửa hàng mẫu (QR Cửa & QR Bàn):',
                  '🔥 Preview 3 live sample stores (Door QR & Table QR):'
                )}
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
            {/* Demo Switcher Controls: 3 Verticals & 8 Storefront Languages */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-extrabold text-emerald-400">
                  {tx(
                    '👇 Bấm chuyển thử 3 ngành nghề & ngôn ngữ khách:',
                    '👇 Try 3 business types & guest languages:'
                  )}
                </span>
                <span className="text-[11px] text-slate-400">
                  {tx('Bản thử tương tác', 'Interactive Preview')}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'fnb' as BusinessVertical,
                    label: tx('🍜 Quán Ăn / Cafe', '🍜 Food & Cafe'),
                  },
                  {
                    id: 'service' as BusinessVertical,
                    label: tx('💆‍♀️ Tiệm Nail & Spa', '💆‍♀️ Nail & Spa'),
                  },
                  {
                    id: 'retail' as BusinessVertical,
                    label: tx('🛍️ Shop Đặc Sản', '🛍️ Specialty Shop'),
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
                  {tx('Đổi ngôn ngữ khách:', 'Guest language:')}
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
                  {tx('Mở toàn màn hình ↗', 'Full screen ↗')}
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
                        {tx(
                          '👆 Bấm thử để xem Thẻ Chữ Tiếng Việt Cỡ Lớn!',
                          '👆 Tap to preview the Vietnamese Show-to-Staff card!'
                        )}
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

      {/* Core Features Section */}
      <section className="py-16 mx-auto max-w-6xl px-4 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600">
            {tx('Tính năng cốt lõi', 'Core Features')}
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
            {tx(
              'Thiết kế riêng cho chủ quán Việt Nam đón khách nội địa & quốc tế',
              'Built for local businesses welcoming domestic & international guests'
            )}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Languages className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              {tx(
                '1. Tự động dịch đa ngôn ngữ chuẩn ngữ cảnh',
                '1. Context-aware multilingual translation'
              )}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {tx(
                'Chủ quán chỉ nhập Tiếng Việt. AI tự động dịch sang Anh, Hàn, Nhật, Trung, Tây Ban Nha, Ý, Nga kèm giải thích nguyên liệu cho các món đặc sản như Bạc xỉu, Phở tái, Gội đầu dưỡng sinh.',
                'Type your menu once in Vietnamese. AI automatically translates into English, Korean, Japanese, Chinese, Spanish, Italian, and Russian with helpful culinary and service descriptions.'
              )}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ScanLine className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              {tx(
                '2. Chụp ảnh menu giấy tạo món trong 10 giây',
                '2. Scan paper menus into digital items in 10s'
              )}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {tx(
                'Chụp ảnh tờ thực đơn giấy hoặc bảng giá dịch vụ. Hệ thống tự động bóc tách Danh mục, Tên món, quy đổi giá tiền và dịch đa ngôn ngữ ngay lập tức.',
                'Snap a photo of a printed menu or price sheet. Automatically extract categories, item names, and prices with instant multilingual translations.'
              )}
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-700">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-base font-black text-slate-900">
              {tx(
                '3. Thẻ "Đưa Nhân Viên Xem" chữ to rõ',
                '3. Large-type "Show to Staff" confirmation card'
              )}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {tx(
                'Khách quốc tế chọn món & ghi chú bằng tiếng mẹ đẻ, bấm nút sẽ gửi đơn xuống quầy hoặc bật thẻ chữ Tiếng Việt cực to để đưa nhân viên xem, xóa bỏ hoàn toàn rào cản ngôn ngữ.',
                'International guests select items and notes in their native language, send orders straight to the counter, or display a large Vietnamese summary card to staff with zero language barrier.'
              )}
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
            <span>
              {tx(
                '— Menu, Bảng giá & Web Đa Ngôn Ngữ',
                '— Multilingual Menu, Price List & Storefront'
              )}
            </span>
          </div>
          <div className="flex items-center gap-4 font-semibold">
            <Link href="/explore" className="hover:text-slate-900">
              {tx('Khám phá quán', 'Explore Stores')}
            </Link>
            <Link href="/pricing" className="hover:text-slate-900">
              {tx('Bảng giá', 'Pricing')}
            </Link>
            <Link href="/dashboard" className="hover:text-slate-900">
              {tx('Quản lý quán', 'Manage Store')}
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
