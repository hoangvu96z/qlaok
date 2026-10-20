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
  CheckCircle2,
  Play,
  ChevronDown,
  MousePointerClick,
  Film,
} from 'lucide-react';
import {
  BusinessVertical,
  CartSelection,
  CatalogItem,
  Category,
  PlanTier,
  Shop,
  SupportedLocale,
} from '@/types/qlaok';
import { PLAN_CONFIGS } from '@/lib/plan-limits';
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

type HeroSceneId = 'overview' | 'orders' | 'catalog' | 'qrstudio';

export default function MarketingLandingPage() {
  const { locale, tx } = useAppI18n();

  // Scroll & Mouse 3D state
  const [heroScrollRatio, setHeroScrollRatio] = useState(0);
  const [mouseTilt, setMouseTilt] = useState({ x: 0, y: 0 });
  const [activeScene, setActiveScene] = useState<HeroSceneId>('orders');

  // Click-to-reveal state: null means all cards are in clean headline-only mode, or one ID is expanded
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(
    'pos-ecosystem'
  );
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [activeVideoChapter, setActiveVideoChapter] = useState(0);

  const pageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  // Smooth RAF scroll listener for 3D Hero Stage
  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const y = window.scrollY || 0;
        const ratio = Math.min(1, Math.max(0, y / 560));
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

  // IntersectionObserver for .scroll-3d-item elements
  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const items = Array.from(
      root.querySelectorAll<HTMLElement>('.scroll-3d-item')
    );

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }
    );

    items.forEach((el) => revealObserver.observe(el));
    return () => revealObserver.disconnect();
  }, []);

  const handleHeroMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const ny = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5
    setMouseTilt({
      x: Number((-ny * 14).toFixed(2)),
      y: Number((nx * 18).toFixed(2)),
    });
  };

  const handleHeroMouseLeave = () => {
    setMouseTilt({ x: 0, y: 0 });
  };

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

  // 4 Real Widescreen Desktop Web + Mobile App scenes
  const heroScenes: Record<
    HeroSceneId,
    {
      label: string;
      desktopImg: string;
      desktopCaption: string;
      mobileImg: string;
      mobileCaption: string;
      guestImg: string;
    }
  > = {
    orders: {
      label: tx('🔔 Đơn tại bàn', '🔔 Table orders'),
      desktopImg: '/screenshots/desktop-web-orders-pos.png',
      desktopCaption: tx(
        'Nhận đơn và thu ngân tại quầy',
        'Orders and checkout at the counter'
      ),
      mobileImg: '/screenshots/mobile-orders-pos.png',
      mobileCaption: tx(
        'Theo dõi đơn trên điện thoại',
        'Keep up with orders on your phone'
      ),
      guestImg: '/screenshots/web-storefront-hub.png',
    },
    overview: {
      label: tx('📊 Tình hình bán hàng', '📊 Sales at a glance'),
      desktopImg: '/screenshots/desktop-web-dashboard.png',
      desktopCaption: tx(
        'Hôm nay quán bán được bao nhiêu?',
        'How are sales today?'
      ),
      mobileImg: '/screenshots/mobile-overview-revenue.png',
      mobileCaption: tx(
        'Xem doanh thu khi bạn cần',
        'Check sales wherever you are'
      ),
      guestImg: '/screenshots/web-guest-menu-en.png',
    },
    catalog: {
      label: tx('🍜 Món và giá bán', '🍜 Menu and prices'),
      desktopImg: '/screenshots/desktop-web-catalog.png',
      desktopCaption: tx(
        'Cập nhật món, giá và bản dịch ở một nơi',
        'Your menu, prices and translations in one place'
      ),
      mobileImg: '/screenshots/mobile-catalog-stock.png',
      mobileCaption: tx(
        'Hết món? Báo khách ngay trên menu',
        'Let guests know when an item sells out'
      ),
      guestImg: '/screenshots/web-guest-retail-en.png',
    },
    qrstudio: {
      label: tx('🏁 Mã QR từng bàn', '🏁 QR codes for each table'),
      desktopImg: '/screenshots/desktop-web-qr-studio.png',
      desktopCaption: tx(
        'Tạo mã QR riêng cho từng bàn',
        'Create a QR code for each table'
      ),
      mobileImg: '/screenshots/mobile-orders-pos.png',
      mobileCaption: tx(
        'Biết đơn mới đến từ bàn nào',
        'See which table each order comes from'
      ),
      guestImg: '/screenshots/web-storefront-hub.png',
    },
  };

  const currentScene = heroScenes[activeScene];

  // Combine scroll progress + mouse tilt for dramatic 3D Hero Stage rotation
  const stageRotateX = (1 - heroScrollRatio) * 14 + mouseTilt.x;
  const stageRotateY = mouseTilt.y;
  const stageScale = 0.94 + heroScrollRatio * 0.06;

  // 6 Click-to-Reveal 3D Feature Cards (Headline only until clicked!)
  const interactiveFeatures = [
    {
      id: 'pos-ecosystem', num: '01', icon: Monitor, accent: 'emerald',
      title: tx('Đơn nào, bàn nấy. Dễ theo dõi hơn.', 'Every order, with its table.'),
      tag: tx('Tại quầy', 'At the counter'),
      desktopImg: '/screenshots/desktop-web-dashboard.png',
      mobileImg: '/screenshots/desktop-web-orders-pos.png',
      bullets: [
        tx('Xem các đơn theo bàn để nhân viên biết cần phục vụ ở đâu.', 'See orders by table so staff know where they belong.'),
        tx('Theo dõi riêng đơn đã phục vụ và đơn đã thu tiền.', 'Keep track of what has been served and what has been paid.'),
        tx('Xem doanh thu và món bán chạy để chuẩn bị cho buổi bán tiếp theo.', 'Check sales and popular items to plan for your next shift.'),
      ],
    },
    {
      id: 'mobile-owner-app', num: '02', icon: Smartphone, accent: 'amber',
      title: tx('Ra ngoài vẫn biết quán đang bán ra sao.', 'Stay close to your business, even when you’re out.'),
      tag: tx('Trên điện thoại', 'On your phone'),
      desktopImg: '/screenshots/mobile-orders-pos.png',
      mobileImg: '/screenshots/mobile-overview-revenue.png',
      bullets: [
        tx('Mở ứng dụng để xem đơn mới và tình hình bán hàng.', 'Open the app to check new orders and sales.'),
        tx('Nhận đơn, xác nhận thu tiền và xem trước phiếu ngay trên điện thoại.', 'Accept orders, confirm payments and preview receipts on your phone.'),
        tx('Chuyển giữa các quán bạn quản lý trong cùng một tài khoản.', 'Switch between the businesses you manage with one account.'),
      ],
    },
    {
      id: 'guest-web-qr', num: '03', icon: QrCode, accent: 'sky',
      title: tx('Khách quét mã, thong thả chọn món.', 'Scan, browse and choose at your own pace.'),
      tag: tx('Không cần tải app', 'No app to download'),
      desktopImg: '/screenshots/desktop-web-qr-studio.png',
      mobileImg: '/screenshots/web-guest-menu-en.png',
      bullets: [
        tx('Đặt mã QR tại bàn để khách mở menu bằng điện thoại của mình.', 'Place a QR code on each table so guests can open the menu on their phones.'),
        tx('Khách chọn ngôn ngữ quen thuộc trong các ngôn ngữ quán đã bật; hỗ trợ tối đa 8 ngôn ngữ tùy gói.', 'Guests choose from your enabled languages, with up to 8 available depending on your plan.'),
        tx('Món và lựa chọn của khách hiển thị rõ trong đơn để nhân viên dễ kiểm tra.', 'Items and guest choices stay together in the order for staff to review.'),
      ],
    },
    {
      id: 'ai-menu-scanner', num: '04', icon: ScanLine, accent: 'purple',
      title: tx('Đưa menu giấy lên mạng, bớt phải gõ lại.', 'Bring your paper menu online with less typing.'),
      tag: tx('AI hỗ trợ nhập món', 'A helping hand with setup'),
      desktopImg: '/screenshots/desktop-web-catalog.png',
      mobileImg: '/screenshots/mobile-catalog-stock.png',
      bullets: [
        tx('Ở gói Premium, tải ảnh menu để AI gợi ý tên món, nhóm món và giá.', 'On Premium, upload a menu photo to get suggested items, categories and prices.'),
        tx('Bạn kiểm tra và chỉnh lại nội dung trước khi lưu; bản dịch cũng có thể sửa cho đúng cách quán mình gọi món.', 'Review and edit before saving, and adjust translations to suit your menu.'),
        tx('Khi đổi giá hoặc hết món, cập nhật menu để khách biết trước khi chọn.', 'Update prices and sold-out items so guests see what is available.'),
      ],
    },
    {
      id: 'multi-chime-push', num: '05', icon: BellRing, accent: 'rose',
      title: tx('Có đơn mới, quầy dễ để ý hơn.', 'A little heads-up when a new order arrives.'),
      tag: tx('Thông báo đơn', 'Order alerts'),
      desktopImg: '/screenshots/desktop-web-orders-pos.png',
      mobileImg: '/screenshots/mobile-orders-pos.png',
      bullets: [
        tx('Bật chuông báo đơn trên màn hình quản lý đang mở tại quầy.', 'Turn on order chimes while your counter screen is open.'),
        tx('Chọn kiểu chuông và âm lượng phù hợp với không gian quán.', 'Choose a chime and volume that suit your space.'),
        tx('Cho phép thông báo trên thiết bị để dễ nhận biết khi có đơn mới.', 'Allow device notifications for another way to notice new orders.'),
      ],
    },
    {
      id: 'three-verticals', num: '06', icon: Languages, accent: 'teal',
      title: tx('Quán ăn, tiệm nhỏ đều có cách dùng riêng.', 'A menu that fits what you do.'),
      tag: tx('Phù hợp nhiều mô hình', 'For different businesses'),
      desktopImg: '/screenshots/web-guest-menu-en.png',
      mobileImg: '/screenshots/web-guest-retail-en.png',
      bullets: [
        tx('Quán ăn, cà phê: để khách chọn size, topping và ghi chú theo ý thích.', 'Cafés and eateries: let guests choose sizes, extras and notes.'),
        tx('Spa, nail: giới thiệu dịch vụ, giá và thời lượng để khách dễ chọn.', 'Spas and nail salons: show services, prices and durations clearly.'),
        tx('Cửa hàng: trưng bày sản phẩm và nhận ghi chú đóng gói từ khách.', 'Shops: display products and collect packing requests from customers.'),
      ],
    },
  ];

  const videoChapters = [
    {
      time: 0,
      label: tx('01. Quản lý quán', '01. Your daily overview'),
    },
    {
      time: 3,
      label: tx('02. Khách chọn món', '02. Guests choose'),
    },
    {
      time: 6,
      label: tx('03. Nhận đơn mới', '03. New orders arrive'),
    },
    {
      time: 9,
      label: tx('04. Cập nhật menu', '04. Update your menu'),
    },
    {
      time: 12,
      label: tx('05. Xem bán hàng', '05. Check your sales'),
    },
  ];

  const jumpToVideoChapter = (index: number, seconds: number) => {
    setActiveVideoChapter(index);
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }
  };

  return (
    <div
      ref={pageRef}
      className="min-h-screen overflow-x-clip bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950"
    >
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80 keep-dark-surface">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 py-3.5 flex items-center justify-between gap-2 sm:gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 font-black text-lg sm:text-xl shadow-lg shadow-emerald-500/25">
              Q
            </div>
            <div className="flex items-center">
              <span className="text-base sm:text-lg font-black tracking-tight text-white">
                Qlaok
              </span>
              <span className="hidden sm:inline-block ml-2 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-300">
                {tx('Quét là OK', 'Scan and you’re set')}
              </span>
            </div>
          </Link>

          <nav className="hidden xl:flex items-center gap-5 whitespace-nowrap text-xs font-bold text-slate-300">
            <a
              href="#video-demo"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Cách hoạt động', 'How it works')}
            </a>
            <a
              href="#features-3d"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Giúp gì cho quán?', 'How it helps')}
            </a>
            <a
              href="#live-demo"
              className="hover:text-emerald-400 transition-colors"
            >
              {tx('Thử menu mẫu', 'Try a sample menu')}
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

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <AppLanguageSwitcher />
            <Link
              href="/login"
              className="hidden sm:inline-flex shrink-0 whitespace-nowrap items-center rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
            >
              {tx('Đăng nhập', 'Sign in')}
            </Link>
            <Link
              href="/login?mode=register"
              className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-xl bg-emerald-500 px-2.5 sm:px-4 py-2 text-xs font-black text-slate-950 shadow-md shadow-emerald-500/20 hover:bg-emerald-400 transition-all"
            >
              <span className="sm:hidden">{tx('Bắt đầu', 'Start free')}</span>
              <span className="hidden sm:inline">
                {tx('Bắt đầu miễn phí', 'Start free')}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </div>
        </div>
      </header>

      {/* =====================================================================
          TẦNG 1: WOW 3D HERO COMMAND CENTER (DESKTOP WEB + MOBILE APP + GUEST QR)
         ===================================================================== */}
      <section
        onMouseMove={handleHeroMouseMove}
        onMouseLeave={handleHeroMouseLeave}
        className="relative overflow-hidden pt-10 pb-20 sm:pt-14 sm:pb-28 keep-dark-surface"
      >
        {/* Ambient Glows */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 h-[480px] w-[960px] rounded-full bg-gradient-to-r from-emerald-500/25 via-teal-400/15 to-amber-400/20 blur-3xl"
        />

        <div className="mx-auto max-w-6xl px-4 relative z-10 space-y-8">
          {/* Ultra-Clean Center Headline (Zero Wall of Text!) */}
          <div className="text-center max-w-4xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-extrabold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                {tx(
                  'Menu QR và quản lý bán hàng cho quán của bạn',
                  'QR menus and everyday tools for your business'
                )}
              </span>
            </div>

            <h1 className="text-3xl sm:text-6xl font-black tracking-tight leading-[1.12] sm:leading-[1.08] text-white">
              <span className="block">
                {tx('Khách chọn món dễ hơn.', 'Ordering feels easier.')}
              </span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-emerald-300 to-emerald-400">
                {tx('Bạn nhẹ việc hơn.', 'You have less to juggle.')}
              </span>
            </h1>

            <p className="mx-auto max-w-2xl text-sm sm:text-base text-slate-300 leading-relaxed">
              {tx(
                'Khách quét mã để xem menu, chọn món theo ý thích. Bạn nhận đơn theo bàn, cập nhật món và theo dõi bán hàng ở một nơi.',
                'Guests scan to browse your menu and choose what they like. You keep table orders, menu updates and sales together in one place.'
              )}
            </p>

            {/* CTAs + Scene Switcher Pills */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                href="/login?mode=register"
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3.5 text-sm font-black text-slate-950 shadow-xl shadow-emerald-500/30 hover:bg-emerald-400 transition-all active:scale-98"
              >
                <QrCode className="h-5 w-5" />
                <span>{tx('Bắt đầu miễn phí', 'Get started free')}</span>
              </Link>
              <a
                href="#video-demo"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/90 px-5 py-3.5 text-sm font-bold text-white hover:border-emerald-400 transition-all"
              >
                <Play className="h-4 w-4 text-emerald-400 fill-emerald-400" />
                <span>{tx('Xem cách Qlaok hoạt động', 'See how Qlaok works')}</span>
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3.5 text-sm font-bold text-slate-200 hover:text-white transition-all"
              >
                <Monitor className="h-4 w-4 text-amber-300" />
                <span>{tx('Vào quản lý quán', 'Manage your business')}</span>
              </Link>
            </div>

            {/* Interactive 3D Scene Switcher Pills */}
            <div className="pt-3 flex flex-wrap items-center justify-center gap-2">
              {(Object.keys(heroScenes) as HeroSceneId[]).map((sceneKey) => {
                const isActive = activeScene === sceneKey;
                return (
                  <button
                    key={sceneKey}
                    type="button"
                    onClick={() => setActiveScene(sceneKey)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-black transition-all ${
                      isActive
                        ? 'bg-white text-slate-950 shadow-lg scale-105'
                        : 'border border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    {heroScenes[sceneKey].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3D TRI-DEVICE HOLOGRAPHIC STAGE (Desktop Web + Owner Mobile + Guest QR) */}
          <div className="perspective-stage relative pt-4 pb-8">
            {/* 3D Glowing Perspective Floor Grid */}
            <div
              aria-hidden="true"
              className="floor-grid-3d pointer-events-none absolute inset-x-0 -bottom-10 h-64 opacity-80"
            />

            <div
              style={{
                transform: `perspective(1100px) rotateX(${stageRotateX.toFixed(
                  2
                )}deg) rotateY(${stageRotateY.toFixed(2)}deg) scale(${stageScale.toFixed(
                  3
                )})`,
              }}
              className="relative mx-auto max-w-5xl preserve-3d transition-transform duration-150 ease-out"
            >
              {/* CENTER LAYER (translateZ 0px): Real Widescreen Desktop Web Dashboard (1440x900) */}
              <div className="mx-auto w-full max-w-[820px] rounded-[24px] border-2 border-slate-700/90 bg-slate-900 shadow-[0_35px_90px_-15px_rgba(0,0,0,0.85)] overflow-hidden">
                {/* MacBook / Browser Chrome Header */}
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-rose-500" />
                    <span className="h-3 w-3 rounded-full bg-amber-400" />
                    <span className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="ml-2 rounded-lg bg-slate-950 px-3 py-1 text-[11px] font-bold text-slate-300">
                      💻 {currentScene.desktopCaption}
                    </span>
                  </div>
                  <span className="hidden sm:inline-block rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300">
                    {tx('Quản lý tại quầy', 'Counter workspace')}
                  </span>
                </div>
                <img
                  src={currentScene.desktopImg}
                  alt={currentScene.desktopCaption}
                  className="w-full h-[300px] sm:h-[460px] object-cover object-left-top"
                />
              </div>

              {/* FRONT-LEFT 3D LAYER (translateZ +60px): Guest menu Menu */}
              <div
                style={{
                  transform:
                    'translate3d(0px, 0px, 65px) rotateY(16deg) rotateZ(-2deg)',
                }}
                className="hidden md:block absolute -left-4 bottom-2 w-[215px] rounded-[30px] border-4 border-sky-400/80 bg-slate-950 shadow-[0_30px_70px_-10px_rgba(14,165,233,0.45)] overflow-hidden"
              >
                <div className="bg-slate-950 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-black text-sky-300">
                  <span>🌐 {tx('Menu cho khách', 'Guest menu')}</span>
                  <span>{tx('Đa ngôn ngữ', 'Multilingual')}</span>
                </div>
                <img
                  src={currentScene.guestImg}
                  alt={tx('Menu khách xem trên điện thoại', 'The menu guests see on their phones')}
                  className="w-full h-[350px] object-cover object-top"
                />
              </div>

              {/* FRONT-RIGHT 3D LAYER (translateZ +85px): Owner Mobile App (iPhone 17 Pro) */}
              <div
                style={{
                  transform:
                    'translate3d(0px, 0px, 85px) rotateY(-16deg) rotateZ(2deg)',
                }}
                className="hidden sm:block absolute -right-2 sm:-right-4 -bottom-2 w-[210px] sm:w-[235px] rounded-[32px] border-4 border-emerald-400 bg-slate-950 shadow-[0_35px_80px_-10px_rgba(16,185,129,0.55)] overflow-hidden"
              >
                <div className="bg-slate-950 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-black text-emerald-300">
                  <span>📱 {tx('Dành cho chủ quán', 'For owners')}</span>
                  <span>iOS & Android</span>
                </div>
                <img
                  src={currentScene.mobileImg}
                  alt={currentScene.mobileCaption}
                  className="w-full h-[375px] object-cover object-top"
                />
              </div>

              {/* Floating 3D Depth Callout */}
              <div className="float-badge-3d hidden lg:flex absolute left-1/2 -translate-x-1/2 -top-5 z-30 items-center gap-2 rounded-full border border-emerald-400/50 bg-slate-950/95 px-4 py-1.5 text-xs font-black text-emerald-300 shadow-2xl">
                <span>⚡ {currentScene.mobileCaption}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 2: VIDEO DEMO 3D CINEMA (TẠO TỪ SCREENSHOT WEB + MOBILE THỰC TẾ)
         ===================================================================== */}
      <section
        id="video-demo"
        className="py-14 sm:py-20 border-t border-slate-800/80 bg-slate-900/40 keep-dark-surface"
      >
        <div className="mx-auto max-w-5xl px-4 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                <Film className="h-4 w-4" />
                {tx(
                  'Một vòng quanh Qlaok',
                  'A quick look at Qlaok'
                )}
              </span>
              <h2 className="text-2xl sm:text-4xl font-black text-white">
                {tx(
                  'Từ lúc khách chọn món đến khi bạn nhận đơn',
                  'From choosing a dish to receiving an order'
                )}
              </h2>
            </div>

            {/* Clickable Video Chapters */}
            <div className="flex flex-wrap gap-1.5">
              {videoChapters.map((chap, idx) => (
                <button
                  key={chap.label}
                  type="button"
                  onClick={() => jumpToVideoChapter(idx, chap.time)}
                  className={`rounded-xl px-3 py-1.5 text-[11px] font-black transition-all ${
                    activeVideoChapter === idx
                      ? 'bg-emerald-500 text-slate-950 shadow-md'
                      : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {chap.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3D Tilted Video Cinema Player */}
          <div className="perspective-stage">
            <div className="scroll-3d-item scroll-3d-native card-3d-tilt rounded-[28px] border-2 border-emerald-500/40 bg-slate-950 p-2 sm:p-3 shadow-[0_30px_90px_-15px_rgba(16,185,129,0.3)]">
              <video
                ref={videoRef}
                src="/videos/qlaok-demo.mp4"
                poster="/screenshots/desktop-web-dashboard.png"
                autoPlay
                muted
                loop
                playsInline
                controls
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  const idx = Math.min(4, Math.floor(t / 3));
                  if (idx !== activeVideoChapter) {
                    setActiveVideoChapter(idx);
                  }
                }}
                className="w-full rounded-2xl bg-slate-950 aspect-video object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          TẦNG 3: 6 THẺ TIÊU ĐỀ 3D — BẤM VÀO MỚI MỞ CHI TIẾT TỪNG CÁI (ZERO TEXT WALL!)
         ===================================================================== */}
      <section
        id="features-3d"
        className="py-16 sm:py-24 border-t border-slate-800/80 keep-dark-surface"
      >
        <div className="mx-auto max-w-6xl px-4 space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3.5 py-1 text-xs font-extrabold text-amber-300">
              <MousePointerClick className="h-3.5 w-3.5" />
              {tx(
                'Chọn việc bạn muốn tìm hiểu thêm',
                'Choose what you would like to explore'
              )}
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white">
              {tx(
                'Bớt việc lặt vặt, thêm thời gian cho khách',
                'Less busywork. More time for your guests.'
              )}
            </h2>
          </div>

          {/* Grid of 6 Headline-Only 3D Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 perspective-stage">
            {interactiveFeatures.map((feat) => {
              const Icon = feat.icon;
              const isOpen = expandedFeatureId === feat.id;
              const panelId = `feature-panel-${feat.id}`;

              return (
                <button
                  key={feat.id}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() =>
                    setExpandedFeatureId((prev) =>
                      prev === feat.id ? null : feat.id
                    )
                  }
                  className={`scroll-3d-item scroll-3d-native text-left rounded-3xl border p-5 transition-all ${
                    isOpen
                      ? 'card-3d-active border-emerald-400 bg-slate-900'
                      : 'card-3d-tilt border-slate-800 bg-slate-900/75 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl font-black text-sm ${
                          isOpen
                            ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30'
                            : 'bg-slate-800 text-emerald-400'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
                          {feat.num} • {feat.tag}
                        </div>
                        <h3 className="text-base font-black text-white leading-snug">
                          {feat.title}
                        </h3>
                      </div>
                    </div>

                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-transform duration-300 ${
                        isOpen
                          ? 'rotate-180 border-emerald-400 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      }`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 3D Spotlight Drawer for the Currently Clicked Feature */}
          {expandedFeatureId &&
            (() => {
              const activeFeat = interactiveFeatures.find(
                (f) => f.id === expandedFeatureId
              );
              if (!activeFeat) return null;

              return (
                <div
                  id={`feature-panel-${activeFeat.id}`}
                  className="perspective-stage pt-2"
                >
                  <div className="card-3d-active rounded-3xl border-2 border-emerald-500/60 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-6 sm:p-8 shadow-2xl">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                      {/* Left: Concise 3 Bullet Points */}
                      <div className="lg:col-span-5 space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/20 px-3 py-1 text-xs font-black text-emerald-300">
                          <span>{tx('Tính năng', 'Feature')} {activeFeat.num}</span>
                          <span>•</span>
                          <span>{activeFeat.tag}</span>
                        </div>
                        <h3 className="text-xl sm:text-2xl font-black text-white">
                          {activeFeat.title}
                        </h3>
                        <ul className="space-y-3">
                          {activeFeat.bullets.map((b, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200 leading-relaxed"
                            >
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="pt-2 flex flex-wrap gap-2.5">
                          <Link
                            href="/login?mode=register"
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
                          >
                            <span>{tx('Bắt đầu với quán của bạn', 'Try it for your business')}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>

                      {/* Right: Dual 3D Visuals (Desktop Web + Mobile App) */}
                      <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center perspective-stage">
                        <div className="sm:col-span-8 rounded-2xl border-2 border-slate-700 bg-slate-950 overflow-hidden shadow-2xl md:[transform:perspective(900px)_rotateY(-6deg)]">
                          <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800 text-[10px] font-bold text-slate-300">
                            💻 {tx('Trên máy tính', 'On your computer')}
                          </div>
                          <img
                            src={activeFeat.desktopImg}
                            alt={activeFeat.title}
                            className="w-full h-56 sm:h-64 object-cover object-left-top"
                          />
                        </div>
                        <div className="sm:col-span-4 rounded-2xl border-2 border-emerald-400/70 bg-slate-950 overflow-hidden shadow-2xl md:[transform:perspective(900px)_rotateY(8deg)_translateZ(20px)]">
                          <div className="bg-slate-900 px-3 py-1.5 border-b border-slate-800 text-[10px] font-bold text-emerald-300">
                            📱 {tx('Trên điện thoại', 'On your phone')}
                          </div>
                          <img
                            src={activeFeat.mobileImg}
                            alt={activeFeat.title}
                            className="w-full h-56 sm:h-64 object-cover object-top"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      </section>

      {/* =====================================================================
          TẦNG 4: BẢN THỬ TƯƠNG TÁC TRỰC TIẾP (3 NGÀNH & 8 NGÔN NGỮ)
         ===================================================================== */}
      <section
        id="live-demo"
        className="py-16 sm:py-24 border-t border-slate-800/80 bg-slate-900/30 keep-dark-surface"
      >
        <div className="mx-auto max-w-6xl px-4 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-extrabold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              {tx('Trải nghiệm trực tiếp', 'Interactive Demo')}
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight">
              {tx(
                'Thử làm khách của quán bạn',
                'See it through your guests’ eyes'
              )}
            </h2>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: 'fnb' as BusinessVertical,
                    label: tx('🍜 Quán ăn', '🍜 Food & Cafe'),
                  },
                  {
                    id: 'service' as BusinessVertical,
                    label: tx('💆‍♀️ Spa & Nail', '💆‍♀️ Nail & Spa'),
                  },
                  {
                    id: 'retail' as BusinessVertical,
                    label: tx('🛍️ Cửa hàng', '🛍️ Retail Shop'),
                  },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDemoVertical(tab.id)}
                    className={`rounded-xl py-2.5 px-2 text-xs font-black transition-all ${
                      demoVertical === tab.id
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <span className="text-xs font-bold text-slate-300">
                  {tx('Đổi ngôn ngữ:', 'Language:')}
                </span>
                <LanguageSwitcher
                  currentLocale={demoLocale}
                  onChange={setDemoLocale}
                  compact={false}
                />
              </div>
            </div>

            {/* Quick Links to Full Sample Stores */}
            <div className="flex flex-wrap gap-2 pt-1">
              {SEED_SHOPS.map((s) => (
                <Link
                  key={s.id}
                  href={`/s/${s.slug}?src=door`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:border-emerald-400"
                >
                  <span>{s.name}</span>
                  <ExternalLink className="h-3 w-3 text-emerald-400" />
                </Link>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 perspective-stage">
            <div className="mx-auto max-w-md rounded-[36px] border-4 border-slate-700 bg-slate-50 text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[520px] card-3d-tilt qr-light-surface">
              <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-black text-slate-900">
                    {demoShop.name}
                  </h3>
                  <p className="truncate text-[11px] text-slate-500">
                    {tField(demoShop.tagline_i18n, demoLocale)}
                  </p>
                </div>
                <Link
                  href={`/s/${demoShop.slug}/menu?lang=${demoLocale}`}
                  className="shrink-0 rounded-xl bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                >
                  {tx('Toàn màn hình ↗', 'Full screen ↗')}
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
                    <span className="text-xs font-black">
                      {demoVertical === 'service'
                        ? demoLabels.bottomCtaService
                        : demoVertical === 'retail'
                          ? demoLabels.bottomCtaRetail
                          : demoLabels.bottomCtaFnb}
                    </span>
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
          TẦNG 5: BẢNG GIÁ TỐI GIẢN (BẤM VÀO MỚI XEM CHI TIẾT) & FINAL CTA
         ===================================================================== */}
      <section className="py-16 sm:py-24 border-t border-slate-800/80 keep-dark-surface">
        <div className="mx-auto max-w-5xl px-4 space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-4xl font-black text-white">
              {tx(
                'Bắt đầu miễn phí, chọn gói khi bạn cần thêm.',
                'Start free. Upgrade when you need more.'
              )}
            </h2>
            <p className="text-xs font-bold text-slate-400">
              {tx(
                'Chọn một gói để xem những gì phù hợp với quán bạn.',
                'Choose a plan to see what fits your business.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {(
              [
                {
                  id: PLAN_CONFIGS.free.tier,
                  name: tx('Miễn phí', 'Free'),
                  priceMonthly: PLAN_CONFIGS.free.priceMonthly,
                  maxItems: PLAN_CONFIGS.free.maxItems,
                  maxLangs: PLAN_CONFIGS.free.maxLangs,
                  sub: tx(
                    'Cho bạn bắt đầu với menu nhỏ.',
                    'For getting started with a small menu.'
                  ),
                  popular: false,
                  extraPerk: tx(
                    'Mã QR Cửa quán & QR từng bàn',
                    'Door QR & table QR codes'
                  ),
                },
                {
                  id: PLAN_CONFIGS.basic.tier,
                  name: tx('Cơ bản', 'Basic'),
                  priceMonthly: PLAN_CONFIGS.basic.priceMonthly,
                  maxItems: PLAN_CONFIGS.basic.maxItems,
                  maxLangs: PLAN_CONFIGS.basic.maxLangs,
                  sub: tx(
                    '/ tháng · Khi menu có thêm món.',
                    '/ month · Room for a growing menu.'
                  ),
                  popular: true,
                  extraPerk: tx(
                    'Tùy chỉnh màu sắc thương hiệu',
                    'Your brand colors'
                  ),
                },
                {
                  id: PLAN_CONFIGS.premium.tier,
                  name: tx('Đầy đủ hơn', 'Premium'),
                  priceMonthly: PLAN_CONFIGS.premium.priceMonthly,
                  maxItems: PLAN_CONFIGS.premium.maxItems,
                  maxLangs: PLAN_CONFIGS.premium.maxLangs,
                  sub: tx(
                    '/ tháng · Thêm công cụ để bớt việc.',
                    '/ month · More tools to lighten the workload.'
                  ),
                  popular: false,
                  extraPerk: tx(
                    'Nhập món từ ảnh menu bằng AI',
                    'AI menu photo import'
                  ),
                },
              ] as Array<{
                id: PlanTier;
                name: string;
                priceMonthly: number;
                maxItems: number;
                maxLangs: number;
                sub: string;
                popular: boolean;
                extraPerk: string;
              }>
            ).map((plan) => {
              const isExpanded = expandedPlanId === plan.id;
              const panelId = `plan-perks-${plan.id}`;
              const formattedPrice = new Intl.NumberFormat(
                locale === 'en' ? 'en-US' : 'vi-VN',
                {
                  style: 'currency',
                  currency: 'VND',
                  maximumFractionDigits: 0,
                }
              ).format(plan.priceMonthly);

              const itemsPerk =
                plan.maxItems >= 999999
                  ? tx(
                      'Không giới hạn số lượng món / dịch vụ',
                      'Unlimited menu items and services'
                    )
                  : tx(
                      'Tối đa {count} món / dịch vụ',
                      'Up to {count} menu items or services',
                      { count: plan.maxItems }
                    );

              const langsPerk =
                plan.maxLangs === 1
                  ? tx('Hỗ trợ {count} ngôn ngữ', '{count} menu language', {
                      count: plan.maxLangs,
                    })
                  : tx(
                      'Hỗ trợ tối đa {count} ngôn ngữ',
                      'Up to {count} menu languages',
                      { count: plan.maxLangs }
                    );

              const perks = [itemsPerk, langsPerk, plan.extraPerk];
              const isFree = plan.id === 'free';

              return (
                <div
                  key={plan.id}
                  className={`rounded-3xl border p-6 flex flex-col justify-between gap-4 transition-colors ${
                    plan.popular
                      ? 'border-2 border-emerald-500 bg-slate-900 shadow-[0_25px_70px_-15px_rgba(16,185,129,0.3)] hover:border-emerald-400'
                      : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() =>
                        setExpandedPlanId((prev) =>
                          prev === plan.id ? null : plan.id
                        )
                      }
                      className="w-full cursor-pointer text-left space-y-2 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                          {plan.name}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                            isExpanded ? 'rotate-180 text-emerald-400' : ''
                          }`}
                        />
                      </div>
                      <div className="text-3xl font-black text-white">
                        {formattedPrice}
                      </div>
                      <div className="text-xs text-slate-400">{plan.sub}</div>
                    </button>

                    {isExpanded && (
                      <ul
                        id={panelId}
                        className="space-y-2 pt-3 border-t border-slate-800 text-xs text-slate-200"
                      >
                        {perks.map((p, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <Link
                    href={isFree ? '/login?mode=register' : '/pricing'}
                    className={`w-full rounded-2xl py-3 text-center text-xs font-black transition-colors ${
                      plan.popular
                        ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                        : 'border border-slate-700 bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                  >
                    {isFree
                      ? tx('Bắt đầu miễn phí', 'Start free')
                      : tx('Xem chi tiết gói', 'View plan details')}
                  </Link>
                </div>
              );
            })}
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
                '— Khách dễ chọn, quán dễ bán.',
                '— Easier ordering. Simpler days.'
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

      {/* Show To Staff Modal */}
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
