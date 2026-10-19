'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  QrCode,
  Sparkles,
  Languages,
  ScanLine,
  ArrowRight,
  ExternalLink,
  Smartphone,
  Monitor,
  BellRing,
  TrendingUp,
  PackageCheck,
  Zap,
  CheckCircle2,
  Volume2,
  Layers,
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

type MobileScreenTab = 'orders' | 'overview' | 'catalog';

export default function MarketingLandingPage() {
  const { tx } = useAppI18n();

  // Scroll progress for 3D Hero Stage & IntersectionObserver for 3D scroll reveals
  const [heroScrollRatio, setHeroScrollRatio] = useState(0);
  const [activeMobileScreen, setActiveMobileScreen] =
    useState<MobileScreenTab>('orders');
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const pageRef = useRef<HTMLDivElement | null>(null);

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

  // Smooth RAF scroll listener for 3D Hero perspective un-tilt + step tracking
  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const y = window.scrollY || 0;
        const ratio = Math.min(1, Math.max(0, y / 520));
        setHeroScrollRatio(ratio);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  // IntersectionObserver for .scroll-3d-item elements and step cards
  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const items = Array.from(
      root.querySelectorAll<HTMLElement>('.scroll-3d-item')
    );
    const stepCards = Array.from(
      root.querySelectorAll<HTMLElement>('[data-step-index]')
    );

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
          }
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -40px 0px' }
    );

    const stepObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.stepIndex || 0
            );
            if (!Number.isNaN(idx)) {
              setActiveStepIndex(idx);
            }
          }
        });
      },
      { threshold: 0.55 }
    );

    items.forEach((el) => revealObserver.observe(el));
    stepCards.forEach((el) => stepObserver.observe(el));

    return () => {
      revealObserver.disconnect();
      stepObserver.disconnect();
    };
  }, []);

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

  // Dynamic 3D transform values for Hero Stage based on scroll position
  const heroRotateX = (1 - heroScrollRatio) * 11;
  const heroRotateY = (1 - heroScrollRatio) * -8;
  const heroScale = 0.96 + heroScrollRatio * 0.04;

  const mobileScreens: {
    id: MobileScreenTab;
    badge: string;
    title: string;
    desc: string;
    image: string;
    highlight: string;
  }[] = [
    {
      id: 'orders',
      badge: tx('mPOS & Báo Bếp', 'Live mPOS & Kitchen'),
      title: tx(
        'Nhận đơn tại bàn & Đổ chuông tức thì',
        'Instant Table Orders & Custom Alert Chimes'
      ),
      desc: tx(
        'Khách Hàn/Anh vừa bấm gửi đơn trên Web QR, điện thoại chủ quán lập tức đổ chuông và dịch sẵn ghi chú sang Tiếng Việt cho bếp.',
        'As soon as guests submit an order on Web QR, the owner app rings and translates all notes into Vietnamese for the kitchen.'
      ),
      image: '/screenshots/mobile-orders-pos.png',
      highlight: tx(
        'Độ trễ < 200ms • In phiếu nhiệt 58/80mm',
        '< 200ms latency • 58/80mm receipt print'
      ),
    },
    {
      id: 'overview',
      badge: tx('Doanh Thu & Đa Chi Nhánh', 'Revenue & Multi-Store'),
      title: tx(
        'Nắm trọn dòng tiền & Lượt quét QR mỗi ngày',
        'Track Daily Revenue & QR Scans Anywhere'
      ),
      desc: tx(
        'Biểu đồ doanh thu 7 ngày, thống kê đơn đang phục vụ, cảnh báo món sắp hết và chuyển đổi giữa nhiều quán chỉ với 1 chạm.',
        '7-day revenue charts, active table counts, low-stock alerts, and 1-tap switching across multiple store branches.'
      ),
      image: '/screenshots/mobile-overview-revenue.png',
      highlight: tx(
        'Báo cáo trực quan • Quản lý nhiều cửa hàng',
        'Real-time KPIs • Multi-branch switcher'
      ),
    },
    {
      id: 'catalog',
      badge: tx('Kho & Thực Đơn 1 Chạm', '1-Tap Stock & Menu'),
      title: tx(
        'Hết món? Gạt nút khóa ngay trên điện thoại',
        'Sold Out? Toggle Availability in One Tap'
      ),
      desc: tx(
        'Tăng/giảm giá nhanh (-5k/+5k), chỉnh số lượng tồn kho và gạt nút "Hết hàng" đồng bộ tức thì lên Menu QR tại bàn.',
        'Adjust prices (-5k/+5k), update stock counts, or toggle "Sold out" with instant sync to all table QR menus.'
      ),
      image: '/screenshots/mobile-catalog-stock.png',
      highlight: tx(
        'Đồng bộ tức thì lên Web QR của khách',
        'Instant sync to guest Web QR menus'
      ),
    },
  ];

  return (
    <div
      ref={pageRef}
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950"
    >
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80 keep-dark-surface">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
              Q
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-white">
                Qlaok
              </span>
              <span className="hidden sm:inline-block ml-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-300">
                {tx('Web QR + App Chủ Quán ✨', 'Web QR + Owner App ✨')}
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-slate-300">
            <a
              href="#journey-3d"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Cách hoạt động', 'How It Works')}
            </a>
            <a
              href="#mobile-app-3d"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('App Chủ Quán', 'Mobile App')}
            </a>
            <a
              href="#live-demo"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Trải nghiệm Demo', 'Interactive Demo')}
            </a>
            <Link
              href="/explore"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Khám phá quán', 'Explore Stores')}
            </Link>
            <Link
              href="/pricing"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Bảng giá', 'Pricing')}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <AppLanguageSwitcher />
            <Link
              href="/login"
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
            >
              {tx('Đăng nhập', 'Sign in')}
            </Link>
            <Link
              href="/login?mode=register"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 shadow-md shadow-emerald-500/20 hover:bg-emerald-400 transition-all"
            >
              <span>{tx('Tạo quán miễn phí', 'Start Free')}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* =====================================================================
          TẦNG 1: 3D HERO STAGE — HỆ SINH THÁI KÉP (WEB QR + APP MOBILE)
         ===================================================================== */}
      <section className="relative overflow-hidden pt-10 pb-20 sm:pt-16 sm:pb-28 keep-dark-surface">
        {/* Ambient 3D Glow Backdrops */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[520px] w-[920px] rounded-full bg-gradient-to-tr from-emerald-500/20 via-teal-500/10 to-amber-400/15 blur-3xl"
        />

        <div className="mx-auto max-w-6xl px-4 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
          {/* Left Hero Copy — Concise & High Impact */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-extrabold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {tx(
                  'Hệ Sinh Thái Kép: Web QR Cho Khách × App Mobile Cho Chủ Quán',
                  'Dual Ecosystem: Guest Web QR × Owner Mobile & Web POS'
                )}
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-[1.1] text-white">
              {tx('Khách quét ', 'Guests scan ')}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300">
                {tx('Web QR 8 ngôn ngữ.', '8-Language Web QR.')}
              </span>
              <br />
              {tx('Chủ quán nhận đơn ngay trên ', 'Owners manage live on ')}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-emerald-400">
                {tx('App Mobile & Web POS.', 'Mobile App & Web POS.')}
              </span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              {tx(
                'Không bắt khách tải ứng dụng. Khách quốc tế & nội địa quét QR xem thực đơn đúng ngôn ngữ điện thoại, trong khi chủ quán & thu ngân nhận chuông báo đơn tức thì trên cả điện thoại iOS/Android lẫn máy tính tại quầy.',
                'Zero app downloads for guests. International & local visitors scan table QR codes in their native language, while owners and cashiers receive instant order chimes on iOS/Android Mobile App and Desktop Web POS.'
              )}
            </p>

            {/* 3 Highlight Pills */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-lg sm:text-xl font-black text-emerald-400">
                  8 {tx('ngôn ngữ', 'langs')}
                </div>
                <div className="text-[11px] font-semibold text-slate-400">
                  {tx('AI dịch chuẩn ẩm thực', 'AI culinary translation')}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-lg sm:text-xl font-black text-amber-300">
                  &lt; 200ms
                </div>
                <div className="text-[11px] font-semibold text-slate-400">
                  {tx('Chuông báo App & Web', 'App & Web order chime')}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-lg sm:text-xl font-black text-sky-300">
                  2 {tx('phút', 'mins')}
                </div>
                <div className="text-[11px] font-semibold text-slate-400">
                  {tx('Chụp menu giấy lên kệ', 'AI paper menu scan')}
                </div>
              </div>
            </div>

            {/* Primary CTAs */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/login?mode=register"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-sm font-black text-slate-950 shadow-xl shadow-emerald-500/25 hover:bg-emerald-400 transition-all active:scale-98"
              >
                <QrCode className="h-5 w-5" />
                <span>
                  {tx('Tạo Menu QR Miễn Phí', 'Create Free QR Menu')}
                </span>
              </Link>

              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/90 px-5 py-4 text-sm font-bold text-white hover:border-emerald-500/60 hover:bg-slate-800 transition-all"
              >
                <Monitor className="h-4 w-4 text-emerald-400" />
                <span>{tx('Mở Web POS / Quản Lý', 'Open Web POS')}</span>
              </Link>
            </div>

            {/* Live Sample Stores Bar */}
            <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mr-1">
                {tx('Xem quán mẫu thật:', 'Live sample stores:')}
              </span>
              {SEED_SHOPS.map((s) => (
                <Link
                  key={s.id}
                  href={`/s/${s.slug}?src=door`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-emerald-400 hover:text-white transition-colors"
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

          {/* Right 3D Dual-Device Stage (Guest Web QR + Owner Mobile App) */}
          <div className="lg:col-span-6 perspective-stage">
            <div
              style={{
                transform: `perspective(1300px) rotateX(${heroRotateX.toFixed(
                  2
                )}deg) rotateY(${heroRotateY.toFixed(2)}deg) scale(${heroScale.toFixed(
                  3
                )})`,
              }}
              className="relative mx-auto max-w-[520px] h-[520px] sm:h-[560px] preserve-3d transition-transform duration-150 ease-out"
            >
              {/* Back-Left Device: Guest Multilingual Web QR Storefront */}
              <div
                style={{
                  transform:
                    'translate3d(-12px, 28px, -30px) rotateY(10deg) rotateZ(-2deg)',
                }}
                className="absolute left-0 top-4 w-[245px] sm:w-[270px] rounded-[34px] border-4 border-slate-700/90 bg-slate-900 shadow-2xl overflow-hidden"
              >
                <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[10px] font-bold text-slate-300">
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <QrCode className="h-3 w-3" />
                    {tx('Web QR Khách Hàng', 'Guest Web QR')}
                  </span>
                  <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-300">
                    EN • KO • VI
                  </span>
                </div>
                <img
                  src="/screenshots/web-storefront-hub.png"
                  alt={tx(
                    'Giao diện Web QR nhận ưu đãi và chọn món đa ngôn ngữ cho khách',
                    'Guest Web QR multilingual storefront and voucher popup'
                  )}
                  className="w-full h-[420px] sm:h-[450px] object-cover object-top"
                />
              </div>

              {/* Front-Right Hero Device: Owner Mobile App (iPhone 17 Pro Live POS) */}
              <div
                style={{
                  transform:
                    'translate3d(16px, 0px, 42px) rotateY(-8deg) rotateZ(1deg)',
                }}
                className="absolute right-0 top-0 w-[265px] sm:w-[295px] rounded-[38px] border-[5px] border-emerald-500/80 bg-slate-900 shadow-[0_30px_80px_-15px_rgba(16,185,129,0.45)] overflow-hidden"
              >
                <div className="bg-slate-950 px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-[10px] font-extrabold">
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <Smartphone className="h-3.5 w-3.5" />
                    {tx('App Mobile Chủ Quán', 'Owner Mobile App')}
                  </span>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] text-emerald-300">
                    iOS & Android
                  </span>
                </div>
                <img
                  src="/screenshots/mobile-orders-pos.png"
                  alt={tx(
                    'App Mobile Qlaok Quản lý nhận đơn mới tại bàn và báo bếp thời gian thực',
                    'Qlaok Owner Mobile App receiving live table order and kitchen alert'
                  )}
                  className="w-full h-[460px] sm:h-[495px] object-cover object-top"
                />
              </div>

              {/* Floating 3D Badge 1: Instant Order Alert */}
              <div className="float-badge-3d absolute -left-2 sm:-left-6 bottom-8 z-20 rounded-2xl border border-amber-400/40 bg-slate-900/95 backdrop-blur-md px-3.5 py-2.5 shadow-2xl">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300">
                    <BellRing className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[11px] font-black text-white">
                      {tx(
                        '🔔 Bàn 02 vừa gửi đơn #HA-882',
                        '🔔 Table 02 sent order #HA-882'
                      )}
                    </div>
                    <div className="text-[10px] font-semibold text-amber-300">
                      {tx(
                        'Đổ chuông trên App Mobile & Web POS',
                        'Rings on Mobile App & Web POS'
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating 3D Badge 2: Auto-Translation */}
              <div className="float-badge-3d absolute right-2 -top-4 z-20 rounded-2xl border border-emerald-400/40 bg-slate-900/95 backdrop-blur-md px-3.5 py-2 shadow-2xl">
                <div className="flex items-center gap-2 text-xs font-black text-emerald-300">
                  <span>🇰🇷 까오라우</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span>🇻🇳 Cao lầu Hội An</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 2: STICKY 3D JOURNEY — 3 BƯỚC KHÉP KÍN TỪ BÀN ĂN ĐẾN CHỦ QUÁN
         ===================================================================== */}
      <section
        id="journey-3d"
        className="py-16 sm:py-24 border-t border-slate-800/80 bg-slate-900/40 keep-dark-surface"
      >
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Sticky Left Column */}
            <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-300">
                <Layers className="h-3.5 w-3.5" />
                {tx('Luồng vận hành 3D khép kín', 'Seamless 3-Step Flow')}
              </span>

              <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white leading-tight">
                {tx(
                  'Đơn giản tối đa cho khách. Tự động hóa toàn diện cho quán.',
                  'Effortless for guests. Fully automated for your store.'
                )}
              </h2>

              <p className="text-sm text-slate-300 leading-relaxed">
                {tx(
                  'Chỉ với 1 mã QR duy nhất tại bàn, Qlaok kết nối trực tiếp trình duyệt của khách với điện thoại của chủ quán và màn hình thu ngân tại quầy.',
                  'With a single table QR code, Qlaok bridges the guest mobile browser directly to the owner mobile app and counter POS screen.'
                )}
              </p>

              {/* Step Indicator Pills */}
              <div className="space-y-2 pt-2">
                {[
                  {
                    step: '01',
                    label: tx(
                      'Khách quét Web QR tại bàn (0s tải app)',
                      'Guest scans Table Web QR (0s download)'
                    ),
                  },
                  {
                    step: '02',
                    label: tx(
                      'Đổ chuông trên App Mobile & Web POS (<200ms)',
                      'Rings on Owner App & Web POS (<200ms)'
                    ),
                  },
                  {
                    step: '03',
                    label: tx(
                      'Thu tiền VietQR, In phiếu & Lên biểu đồ doanh thu',
                      'VietQR Payment, Receipt Print & Revenue Chart'
                    ),
                  },
                ].map((item, idx) => (
                  <div
                    key={item.step}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-xs font-bold transition-all ${
                      activeStepIndex === idx
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-white shadow-lg shadow-emerald-500/10'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-black ${
                        activeStepIndex === idx
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.step}
                    </span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: 3 Scroll-Triggered 3D Cards */}
            <div className="lg:col-span-7 space-y-8 perspective-stage">
              {/* Step 1 Card */}
              <div
                data-step-index={0}
                className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 shadow-2xl"
              >
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <div className="flex-1 space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">
                      <span>BƯỚC 01</span>
                      <span>•</span>
                      <span>WEB QR CHO KHÁCH</span>
                    </div>
                    <h3 className="text-xl font-black text-white">
                      {tx(
                        'Mở ngay bằng Safari/Chrome đúng ngôn ngữ của khách',
                        'Opens Instantly in Safari/Chrome in Guest Language'
                      )}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      {tx(
                        'Khách Hàn, Anh, Nhật, Trung hay khách Việt chỉ cần đưa camera lên quét. Trang Web tự nhận diện ngôn ngữ điện thoại, bung Popup Voucher chào mừng và cho phép chọn món kèm ghi chú khẩu vị.',
                        'Korean, English, Japanese, Chinese, or local guests simply point their camera. The web menu auto-detects their phone language, shows welcome vouchers, and lets them customize dishes.'
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] font-bold text-slate-300">
                      <span className="rounded-lg bg-slate-800 px-2.5 py-1">
                        🇻🇳 🇬🇧 🇰🇷 🇯🇵 🇨🇳 🇪🇸 🇮🇹 🇷🇺
                      </span>
                      <span className="rounded-lg bg-emerald-500/15 text-emerald-300 px-2.5 py-1">
                        {tx('Không cần cài App', 'Zero App Install')}
                      </span>
                    </div>
                  </div>
                  <div className="w-44 sm:w-48 shrink-0 rounded-2xl border-2 border-slate-700 overflow-hidden shadow-xl">
                    <img
                      src="/screenshots/web-guest-menu-en.png"
                      alt="Guest multilingual QR menu"
                      className="w-full h-64 object-cover object-top"
                    />
                  </div>
                </div>
              </div>

              {/* Step 2 Card */}
              <div
                data-step-index={1}
                className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-amber-500/30 bg-slate-900/90 p-6 sm:p-8 shadow-2xl"
              >
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <div className="flex-1 space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-xl bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-300">
                      <span>BƯỚC 02</span>
                      <span>•</span>
                      <span>APP MOBILE & WEB POS</span>
                    </div>
                    <h3 className="text-xl font-black text-white">
                      {tx(
                        'Đổ chuông tức thì trên Điện thoại Chủ Quán & Máy tính Quầy',
                        'Instant Audio Chimes on Owner Phone & Counter PC'
                      )}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      {tx(
                        'Đơn vừa gửi sẽ reo chuông trên App Mobile (iOS/Android) và bật thông báo đẩy ra màn hình Windows/macOS. Mọi món khách chọn bằng tiếng nước ngoài đều được dịch ngược sang Tiếng Việt to rõ cho bếp.',
                        'Incoming orders trigger custom chimes on the Mobile App (iOS/Android) and native Windows/macOS desktop notifications, translating foreign guest selections into clear Vietnamese for your staff.'
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] font-bold">
                      <span className="rounded-lg bg-amber-400/15 text-amber-300 px-2.5 py-1">
                        {tx('🔔 Chuông tuỳ chỉnh + Rung', '🔔 Custom Chime + Vibration')}
                      </span>
                      <span className="rounded-lg bg-slate-800 text-slate-300 px-2.5 py-1">
                        {tx('💻 Thông báo Windows / Mac', '💻 Windows / Mac Push')}
                      </span>
                    </div>
                  </div>
                  <div className="w-44 sm:w-48 shrink-0 rounded-2xl border-2 border-amber-400/50 overflow-hidden shadow-xl">
                    <img
                      src="/screenshots/mobile-orders-pos.png"
                      alt="Mobile App Live POS Order Alert"
                      className="w-full h-64 object-cover object-top"
                    />
                  </div>
                </div>
              </div>

              {/* Step 3 Card */}
              <div
                data-step-index={2}
                className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 shadow-2xl"
              >
                <div className="flex flex-col sm:flex-row gap-6 items-center">
                  <div className="flex-1 space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-xl bg-sky-500/15 px-3 py-1 text-xs font-black text-sky-300">
                      <span>BƯỚC 03</span>
                      <span>•</span>
                      <span>DOANH THU & KHO TỰ ĐỘNG</span>
                    </div>
                    <h3 className="text-xl font-black text-white">
                      {tx(
                        'Thu tiền VietQR, In hóa đơn & Tự động trừ tồn kho',
                        'VietQR Checkout, Receipt Print & Auto Stock Deduction'
                      )}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      {tx(
                        'Xác nhận thu tiền 1 chạm, in phiếu nhiệt tại quầy và tự động trừ số lượng tồn kho. Chủ quán đi vắng vẫn kiểm soát từng đơn hàng và biểu đồ doanh thu 7 ngày ngay trên điện thoại.',
                        'Confirm payments in one tap, print thermal receipts, and auto-deduct inventory. Even when away from the shop, owners track every order and 7-day revenue charts on their phone.'
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] font-bold">
                      <span className="rounded-lg bg-sky-500/15 text-sky-300 px-2.5 py-1">
                        {tx('📊 Biểu đồ 7 ngày', '📊 7-Day Analytics')}
                      </span>
                      <span className="rounded-lg bg-slate-800 text-slate-300 px-2.5 py-1">
                        {tx('🖨️ In nhiệt 58mm / 80mm', '🖨️ 58mm / 80mm Print')}
                      </span>
                    </div>
                  </div>
                  <div className="w-44 sm:w-48 shrink-0 rounded-2xl border-2 border-slate-700 overflow-hidden shadow-xl">
                    <img
                      src="/screenshots/mobile-overview-revenue.png"
                      alt="Mobile App Revenue Overview"
                      className="w-full h-64 object-cover object-top"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 3: 3D MOBILE OWNER APP SHOWCASE (BỘ 3 MÀN HÌNH APP CHỦ QUÁN)
         ===================================================================== */}
      <section
        id="mobile-app-3d"
        className="py-16 sm:py-24 border-t border-slate-800/80 relative overflow-hidden keep-dark-surface"
      >
        <div className="mx-auto max-w-6xl px-4 space-y-10">
          {/* Section Header */}
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1 text-xs font-extrabold text-amber-300">
              <Smartphone className="h-3.5 w-3.5" />
              <span>
                {tx(
                  'App Mobile "Qlaok Quản Lý" (iOS & Android) + Web Dashboard',
                  '"Qlaok Manager" Mobile App (iOS & Android) + Web Dashboard'
                )}
              </span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
              {tx(
                'Quản lý cả cửa hàng gọn trong lòng bàn tay',
                'Run Your Entire Store from the Palm of Your Hand'
              )}
            </h2>
            <p className="text-sm sm:text-base text-slate-300">
              {tx(
                'Bên cạnh trang Web quản trị trên máy tính, Qlaok trang bị ứng dụng di động riêng cho chủ quán & nhân viên — đồng bộ Realtime tức thì từng đơn hàng, món ăn và doanh thu.',
                'Alongside the full Desktop Web Dashboard, Qlaok gives owners and staff a dedicated native mobile experience with instant Realtime sync for orders, stock, and revenue.'
              )}
            </p>
          </div>

          {/* Interactive Tab Selector for the 3 Mobile App Screens */}
          <div className="flex flex-wrap justify-center gap-2.5">
            {mobileScreens.map((scr) => {
              const isActive = activeMobileScreen === scr.id;
              return (
                <button
                  key={scr.id}
                  type="button"
                  onClick={() => setActiveMobileScreen(scr.id)}
                  className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition-all ${
                    isActive
                      ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25 scale-105'
                      : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {scr.id === 'orders' && <BellRing className="h-4 w-4" />}
                  {scr.id === 'overview' && <TrendingUp className="h-4 w-4" />}
                  {scr.id === 'catalog' && <PackageCheck className="h-4 w-4" />}
                  <span>{scr.badge}</span>
                </button>
              );
            })}
          </div>

          {/* 3D Fan-Out Phone Stage */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center perspective-stage pt-2">
            {mobileScreens.map((scr, idx) => {
              const isSelected = activeMobileScreen === scr.id;
              const tiltClass =
                idx === 0
                  ? 'md:[transform:perspective(1200px)_rotateY(10deg)_translateZ(0px)]'
                  : idx === 1
                    ? 'md:[transform:perspective(1200px)_rotateY(0deg)_translateZ(32px)]'
                    : 'md:[transform:perspective(1200px)_rotateY(-10deg)_translateZ(0px)]';

              return (
                <div
                  key={scr.id}
                  onClick={() => setActiveMobileScreen(scr.id)}
                  className={`cursor-pointer rounded-3xl border p-5 transition-all duration-500 ${tiltClass} ${
                    isSelected
                      ? 'border-emerald-500/80 bg-slate-900 shadow-[0_25px_70px_-15px_rgba(16,185,129,0.35)] md:scale-[1.03]'
                      : 'border-slate-800/90 bg-slate-900/60 opacity-85 hover:opacity-100'
                  }`}
                >
                  <div className="mx-auto max-w-[260px] rounded-[32px] border-4 border-slate-800 bg-slate-950 overflow-hidden shadow-2xl mb-4">
                    <img
                      src={scr.image}
                      alt={scr.title}
                      className="w-full h-[460px] object-cover object-top"
                    />
                  </div>
                  <div className="space-y-2 text-left">
                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-black text-emerald-300">
                      <span>{scr.badge}</span>
                    </div>
                    <h3 className="text-base font-black text-white">
                      {scr.title}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {scr.desc}
                    </p>
                    <div className="pt-1 text-[11px] font-bold text-amber-300">
                      ✦ {scr.highlight}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 4: 3D BENTO GRID — 4 VŨ KHÍ TỰ ĐỘNG HÓA TRÊN WEB & APP
         ===================================================================== */}
      <section className="py-16 sm:py-24 border-t border-slate-800/80 bg-slate-900/30 keep-dark-surface">
        <div className="mx-auto max-w-6xl px-4 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              {tx('Công nghệ cốt lõi', 'Core Capabilities')}
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white">
              {tx(
                '4 vũ khí giúp quán vận hành nhẹ tênh',
                '4 Superpowers Built for Modern Local Businesses'
              )}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 perspective-stage">
            {/* Bento 1 (7 cols): AI Paper Menu Scanner + 8-Lang Translation */}
            <div className="md:col-span-7 scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs font-black text-emerald-300">
                  <ScanLine className="h-4 w-4" />
                  <span>
                    {tx(
                      'AI Menu Scanner + Dịch 8 Ngôn Ngữ',
                      'AI Menu Scanner + 8-Language Translation'
                    )}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">
                  {tx(
                    'Chụp ảnh tờ thực đơn giấy → Tự tạo món & dịch 8 thứ tiếng trong 30 giây',
                    'Snap a Photo of Your Paper Menu → Auto-Extract & Translate into 8 Languages'
                  )}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {tx(
                    'Không cần gõ tay từng món. AI tự động nhận diện danh mục, tên món, giá tiền và dịch chuẩn ngữ cảnh ẩm thực sang Anh, Hàn, Nhật, Trung, Tây Ban Nha, Ý, Nga.',
                    'Skip manual typing. AI extracts categories, dish names, and prices while generating authentic culinary translations in English, Korean, Japanese, Chinese, Spanish, Italian, and Russian.'
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                {[
                  { flag: '🇰🇷', lang: 'Korean', sample: '호이안 전통 까오라우' },
                  { flag: '🇬🇧', lang: 'English', sample: 'Hoi An Cao Lau Noodles' },
                  { flag: '🇯🇵', lang: 'Japanese', sample: 'ホイアン伝統カオラウ' },
                  { flag: '🇨🇳', lang: 'Chinese', sample: '会安传统高楼面' },
                ].map((l) => (
                  <div
                    key={l.lang}
                    className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3 space-y-1"
                  >
                    <div className="text-xs font-black text-emerald-300">
                      {l.flag} {l.lang}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-300 truncate">
                      {l.sample}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bento 2 (5 cols): Multi-Channel Order Chime + Desktop Windows Push */}
            <div className="md:col-span-5 scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 flex flex-col justify-between gap-6">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-amber-400/15 px-3 py-1.5 text-xs font-black text-amber-300">
                  <Volume2 className="h-4 w-4" />
                  <span>
                    {tx(
                      'Chuông Báo Đơn Đa Tầng',
                      'Multi-Channel Order Alerts'
                    )}
                  </span>
                </div>
                <h3 className="text-xl font-black text-white">
                  {tx(
                    'Chuông tuỳ chỉnh tại quầy + Đẩy thông báo ra Windows/Mac + Rung App Mobile',
                    'Custom POS Chimes + Windows/Mac Push Notifications + Mobile Vibration'
                  )}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {tx(
                    'Dù thu ngân đang thu nhỏ trình duyệt trên máy tính hay chủ quán đang di chuyển bên ngoài, đơn mới tại bàn luôn báo chuông chuẩn xác theo âm thanh đã cài đặt.',
                    'Whether the cashier minimizes the browser on Windows/macOS or the owner is on the move, new table orders ring immediately with your custom sound profile.'
                  )}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-400/30 bg-slate-950 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-black text-amber-300">
                  <span>🔔 ĐƠN MỚI TẠI BÀN • #HA-882</span>
                  <span>190.000đ</span>
                </div>
                <div className="text-[11px] text-slate-300">
                  Bàn 02 (Sân vườn) • x2 Cao lầu Hội An • x2 Trà Mót
                </div>
              </div>
            </div>

            {/* Bento 3 (5 cols): Flash Sale & Welcome Voucher Popup */}
            <div className="md:col-span-5 scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 flex flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-rose-500/15 px-3 py-1.5 text-xs font-black text-rose-300">
                  <Zap className="h-4 w-4" />
                  <span>
                    {tx(
                      'Flash Sale & Popup Voucher',
                      'Flash Sales & Welcome Vouchers'
                    )}
                  </span>
                </div>
                <h3 className="text-xl font-black text-white">
                  {tx(
                    'Bật ưu đãi Giờ Vàng & Mã giảm giá tự động áp dụng tại bàn',
                    'Launch Happy Hour Flash Sales & Auto-Applied Table Vouchers'
                  )}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {tx(
                    'Tạo chiến dịch giảm giá theo khung giờ hoặc tặng mã Voucher chào mừng ngay khi khách vừa quét QR để kích thích gọi thêm món.',
                    'Schedule time-boxed discounts or display a welcome voucher popup the moment guests scan the table QR to boost average order value.'
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-800 overflow-hidden max-h-44">
                <img
                  src="/screenshots/web-storefront-hub.png"
                  alt="Welcome Voucher Popup"
                  className="w-full h-44 object-cover object-center"
                />
              </div>
            </div>

            {/* Bento 4 (7 cols): Multi-Vertical Storefronts (F&B, Spa, Retail) */}
            <div className="md:col-span-7 scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 flex flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-xl bg-sky-500/15 px-3 py-1.5 text-xs font-black text-sky-300">
                  <Languages className="h-4 w-4" />
                  <span>
                    {tx(
                      '3 Ngành Hàng Chuyên Biệt + QR Studio',
                      '3 Tailored Verticals + Table QR Studio'
                    )}
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">
                  {tx(
                    'Tối ưu riêng cho Quán Ăn & Cafe, Tiệm Spa & Nail, và Shop Đặc Sản',
                    'Purpose-Built for Food & Cafe, Spa & Nail Studios, and Specialty Retail'
                  )}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {tx(
                    'Từ tuỳ chọn size/topping cho quán ăn, thời lượng phút làm dịch vụ cho Spa, đến giỏ hàng quà tặng đặc sản — kèm bộ tạo mã QR từng bàn/phòng in sẵn chỉ trong 1 click.',
                    'From size/topping modifiers for restaurants and treatment durations for spas to gift packaging for specialty shops — complete with printable table & room QR standees.'
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-purple-300 border-b border-slate-800">
                    💆‍♀️ Spa & Nail Studio (EN/KO)
                  </div>
                  <img
                    src="/screenshots/web-guest-menu-en.png"
                    alt="Spa and Nail QR Menu"
                    className="w-full h-40 object-cover object-top"
                  />
                </div>
                <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-amber-300 border-b border-slate-800">
                    🛍️ Shop Đặc Sản & Quà Tặng
                  </div>
                  <img
                    src="/screenshots/web-guest-retail-en.png"
                    alt="Specialty Retail QR Menu"
                    className="w-full h-40 object-cover object-top"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 5: INTERACTIVE LIVE DEMO (TRẢI NGHIỆM TRỰC TIẾP 3 NGÀNH & 8 NGÔN NGỮ)
         ===================================================================== */}
      <section
        id="live-demo"
        className="py-16 sm:py-24 border-t border-slate-800/80 keep-dark-surface"
      >
        <div className="mx-auto max-w-6xl px-4 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-extrabold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              {tx('Bản thử tương tác trực tiếp', 'Interactive Live Sandbox')}
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight">
              {tx(
                'Bấm thử ngay giao diện Khách Quét QR tại bàn',
                'Try the Live Guest Table QR Experience Right Now'
              )}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {tx(
                'Chọn thử 1 trong 3 ngành hàng và đổi sang tiếng Hàn, Anh, Nhật, Trung... Sau đó bấm nút thanh dưới cùng để xem Thẻ Chữ Tiếng Việt Cỡ Lớn đưa nhân viên xem!',
                'Switch between 3 business verticals and 8 guest languages below, then tap the bottom bar to test the large-type Vietnamese Show-to-Staff confirmation card!'
              )}
            </p>

            {/* Controls */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'fnb' as BusinessVertical,
                    label: tx('🍜 Quán Ăn', '🍜 Food & Cafe'),
                  },
                  {
                    id: 'service' as BusinessVertical,
                    label: tx('💆‍♀️ Spa & Nail', '💆‍♀️ Nail & Spa'),
                  },
                  {
                    id: 'retail' as BusinessVertical,
                    label: tx('🛍️ Đặc Sản', '🛍️ Retail Shop'),
                  },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDemoVertical(tab.id)}
                    className={`rounded-xl py-2.5 px-2.5 text-xs font-black transition-all ${
                      demoVertical === tab.id
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                <span className="text-xs font-bold text-slate-300">
                  {tx('Ngôn ngữ khách:', 'Guest language:')}
                </span>
                <LanguageSwitcher
                  currentLocale={demoLocale}
                  onChange={setDemoLocale}
                  compact={false}
                />
              </div>
            </div>
          </div>

          {/* Interactive Phone Sandbox */}
          <div className="lg:col-span-7 perspective-stage">
            <div className="mx-auto max-w-md rounded-[36px] border-4 border-slate-700 bg-slate-50 text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[540px] card-3d-tilt qr-light-surface">
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
                          '👆 Bấm để mở Thẻ Chữ Tiếng Việt Cỡ Lớn!',
                          '👆 Tap to preview Vietnamese Show-to-Staff card!'
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

      {/* =====================================================================
          TẦNG 6: BẢNG GIÁ TINH GỌN & 3D FINAL CTA
         ===================================================================== */}
      <section className="py-16 sm:py-24 border-t border-slate-800/80 bg-slate-900/40 keep-dark-surface">
        <div className="mx-auto max-w-6xl px-4 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              {tx('Chi phí minh bạch', 'Simple Pricing')}
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white">
              {tx(
                'Bắt đầu miễn phí trọn đời. Nâng cấp khi quán đông khách.',
                'Start Free Forever. Upgrade as Your Store Grows.'
              )}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch perspective-stage">
            {/* Free Plan */}
            <div className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900 p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  {tx('Gói Khởi Đầu', 'Starter Plan')}
                </span>
                <div className="text-3xl font-black text-white">0đ</div>
                <p className="text-xs text-slate-400">
                  {tx(
                    'Trải nghiệm miễn phí trọn đời cho quán nhỏ mới mở.',
                    'Free forever for small shops getting started.'
                  )}
                </p>
                <ul className="space-y-2 pt-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>{tx('Tối đa 5 món / dịch vụ', 'Up to 5 items / services')}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>{tx('2 ngôn ngữ (Việt + Anh)', '2 languages (VI + EN)')}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>{tx('Mã QR Cửa hàng & Đặt món', 'Store QR & Table Ordering')}</span>
                  </li>
                </ul>
              </div>
              <Link
                href="/login?mode=register"
                className="w-full rounded-2xl border border-slate-700 bg-slate-800 py-3 text-center text-xs font-black text-white hover:bg-slate-700 transition-colors"
              >
                {tx('Bắt đầu miễn phí', 'Start for Free')}
              </Link>
            </div>

            {/* Pro / Popular Plan */}
            <div className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border-2 border-emerald-500 bg-slate-900 p-6 flex flex-col justify-between space-y-6 shadow-[0_25px_70px_-15px_rgba(16,185,129,0.3)] md:-translate-y-2">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                    {tx('Gói Cơ Bản & Chuyên Nghiệp', 'Basic & Premium Plans')}
                  </span>
                  <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-black text-slate-950">
                    {tx('PHỔ BIẾN NHẤT', 'MOST POPULAR')}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white">
                    {tx('Từ 39.000đ', 'From 39,000đ')}
                  </span>
                  <span className="text-xs text-slate-400">
                    {tx('/ tháng', '/ month')}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  {tx(
                    'Đầy đủ Web QR 8 ngôn ngữ, App Mobile Chủ Quán, mPOS và AI Menu Scanner.',
                    'Full 8-language Web QR, Owner Mobile App, mPOS, and AI Menu Scanner.'
                  )}
                </p>
                <ul className="space-y-2 pt-2 text-xs text-slate-200">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>
                      {tx(
                        'Mở khóa 8 ngôn ngữ + AI Menu Scanner',
                        'All 8 languages + AI Menu Scanner'
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>
                      {tx(
                        'App Mobile Chủ Quán + Chuông báo đơn Realtime',
                        'Owner Mobile App + Realtime Order Chimes'
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>
                      {tx(
                        'Flash Sale, Popup Voucher & Phân quyền nhân viên',
                        'Flash Sales, Vouchers & Staff Permissions'
                      )}
                    </span>
                  </li>
                </ul>
              </div>
              <Link
                href="/pricing"
                className="w-full rounded-2xl bg-emerald-500 py-3 text-center text-xs font-black text-slate-950 hover:bg-emerald-400 transition-colors"
              >
                {tx('Xem chi tiết bảng giá', 'View Full Pricing')}
              </Link>
            </div>

            {/* Enterprise / Multi-branch */}
            <div className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-3xl border border-slate-800 bg-slate-900 p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                  {tx('Đa Chi Nhánh & Chuỗi', 'Multi-Branch Stores')}
                </span>
                <div className="text-3xl font-black text-white">
                  {tx('Tự động kích hoạt', 'Instant VietQR')}
                </div>
                <p className="text-xs text-slate-400">
                  {tx(
                    'Quản lý nhiều cửa hàng F&B, Spa, Bán lẻ trên cùng 1 tài khoản App & Web.',
                    'Manage multiple F&B, Spa, and Retail branches from a single account.'
                  )}
                </p>
                <ul className="space-y-2 pt-2 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-amber-300 shrink-0" />
                    <span>
                      {tx(
                        'Chuyển đổi nhanh giữa nhiều chi nhánh trên App',
                        '1-tap branch switching on Mobile App'
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-amber-300 shrink-0" />
                    <span>
                      {tx(
                        'Phân quyền Thu ngân / Phục vụ / Bếp theo quán',
                        'Role-based Cashier / Waiter / Kitchen access'
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-amber-300 shrink-0" />
                    <span>
                      {tx(
                        'Thanh toán VietQR kích hoạt tự động trong 5 giây',
                        'Auto-activated in 5 seconds via VietQR'
                      )}
                    </span>
                  </li>
                </ul>
              </div>
              <Link
                href="/login?mode=register"
                className="w-full rounded-2xl border border-slate-700 bg-slate-800 py-3 text-center text-xs font-black text-white hover:bg-slate-700 transition-colors"
              >
                {tx('Tạo tài khoản chủ quán', 'Create Owner Account')}
              </Link>
            </div>
          </div>

          {/* Final 3D Call To Action Banner */}
          <div className="scroll-3d-item scroll-3d-native rounded-3xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 p-8 sm:p-12 text-center space-y-5 shadow-2xl">
            <h3 className="text-2xl sm:text-3xl font-black text-white">
              {tx(
                'Sẵn sàng lên kệ Menu QR 8 ngôn ngữ & App Quản Lý cho quán của bạn?',
                'Ready to Launch Your 8-Language QR Menu & Owner App?'
              )}
            </h3>
            <p className="text-sm text-slate-300 max-w-xl mx-auto">
              {tx(
                'Khởi tạo hoàn toàn miễn phí chỉ trong 2 phút. Dùng ngay trên cả trình duyệt Web lẫn ứng dụng Mobile.',
                'Set up for free in under 2 minutes. Manage seamlessly across both Desktop Web and Mobile App.'
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              <Link
                href="/login?mode=register"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-7 py-4 text-sm font-black text-slate-950 shadow-xl hover:bg-emerald-400 transition-all"
              >
                <QrCode className="h-5 w-5" />
                <span>{tx('Tạo Quán Miễn Phí Ngay', 'Create Free Store Now')}</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-6 py-4 text-sm font-bold text-white hover:bg-slate-800 transition-all"
              >
                <span>{tx('Khám phá các quán đang dùng', 'Explore Live Stores')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950 py-8 keep-dark-surface">
        <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 font-black">
              Q
            </span>
            <span className="font-bold text-white">Qlaok (Quét là OK)</span>
            <span>
              {tx(
                '— Hệ sinh thái Web QR Đa Ngôn Ngữ & App Quản Lý Quán',
                '— Multilingual Web QR & Store Management App'
              )}
            </span>
          </div>
          <div className="flex items-center gap-4 font-semibold">
            <Link href="/explore" className="hover:text-white transition-colors">
              {tx('Khám phá quán', 'Explore Stores')}
            </Link>
            <Link href="/pricing" className="hover:text-white transition-colors">
              {tx('Bảng giá', 'Pricing')}
            </Link>
            <Link
              href="/dashboard"
              className="hover:text-white transition-colors"
            >
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
