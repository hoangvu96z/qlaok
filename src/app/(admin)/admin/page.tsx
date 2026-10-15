'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  Store,
  Receipt,
  CreditCard,
  Cpu,
  RefreshCw,
  Search,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  KeyRound,
  LogOut,
  Sparkles,
  QrCode,
  Globe,
  TrendingUp,
  Eye,
  EyeOff,
  ArrowRight,
  Lock,
  Mail,
  Activity,
  Database,
  PackageCheck,
} from 'lucide-react';
import {
  clearStoredAuthOwner,
  getAdminBackupSession,
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
  startAdminImpersonation,
  stopAdminImpersonation,
  SUPER_ADMIN_EMAIL,
} from '@/lib/auth-session';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { formatCurrency } from '@/lib/i18n-helper';
import type {
  AnalyticsEvent,
  CatalogItem,
  OrderStatus,
  PaymentTransaction,
  PlanTier,
  Profile,
  Shop,
  ShopOrder,
  SupportedLocale,
} from '@/types/qlaok';

type AdminTab =
  | 'overview'
  | 'owners'
  | 'shops'
  | 'orders'
  | 'billing'
  | 'system';

interface EnrichedOwner extends Profile {
  shopsCount: number;
  shops: Array<{ id: string; name: string; slug: string; vertical: string }>;
  totalSpentSaas: number;
}

interface EnrichedShop extends Shop {
  ownerEmail: string;
  ownerName: string;
  ownerPlan: PlanTier;
  categoriesCount: number;
  itemsCount: number;
  ordersCount: number;
  shopGmv: number;
  qrScansCount: number;
}

interface EnrichedOrder extends ShopOrder {
  shopName: string;
  shopSlug: string;
  shopVertical: string;
}

interface EnrichedTransaction extends PaymentTransaction {
  ownerEmail: string;
  ownerName: string;
}

interface AdminDashboardData {
  adminProfile: Profile;
  kpis: {
    totalOwners: number;
    planBreakdown: { free: number; basic: number; premium: number };
    estimatedMrr: number;
    totalSaasRevenue: number;
    pendingTransactionsCount: number;
    totalShops: number;
    publishedShopsCount: number;
    hiddenShopsCount: number;
    verticalBreakdown: { fnb: number; service: number; retail: number };
    totalCategories: number;
    totalItems: number;
    totalPosts: number;
    totalOrders: number;
    newOrdersCount: number;
    preparingOrdersCount: number;
    completedOrdersCount: number;
    cancelledOrdersCount: number;
    globalMposGmv: number;
    todayMposGmv: number;
    totalQrScans: number;
    scanDoorCount: number;
    scanTableCount: number;
    showToStaffCount: number;
    wifiCopyCount: number;
    itemViewCount: number;
    langBreakdown: Array<{
      lang: SupportedLocale;
      count: number;
      percentage: number;
    }>;
  };
  owners: EnrichedOwner[];
  shops: EnrichedShop[];
  orders: EnrichedOrder[];
  transactions: EnrichedTransaction[];
  lowStockItems: Array<CatalogItem & { shopName: string }>;
  recentEvents: Array<AnalyticsEvent & { shopName: string }>;
  systemHealth: {
    supabaseConnected: boolean;
    supabaseUrl: string;
    aiGatewayUrl: string;
    aiTextModel: string;
    aiVisionModel: string;
    r2Configured: boolean;
    tableCounts: Record<string, number>;
    serverTime: string;
  };
}

const LANG_LABELS: Record<SupportedLocale, string> = {
  vi: '🇻🇳 Tiếng Việt',
  en: '🇬🇧 English',
  ko: '🇰🇷 한국어',
  ja: '🇯🇵 日本語',
  zh: '🇨🇳 中文',
  es: '🇪🇸 Español',
  it: '🇮🇹 Italiano',
  ru: '🇷🇺 Русский',
};

export default function SuperAdminPortalPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [adminUser, setAdminUser] = useState<Profile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Admin Login Form state (when visiting /admin while not logged in as hoangvu96z@gmail.com)
  const [loginEmail, setLoginEmail] = useState(SUPER_ADMIN_EMAIL);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Dashboard Data state
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Filters & Modals
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerPlanFilter, setOwnerPlanFilter] = useState<'all' | PlanTier>(
    'all'
  );
  const [showCreateOwner, setShowCreateOwner] = useState(false);
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerPhone, setNewOwnerPhone] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('');
  const [newOwnerPlan, setNewOwnerPlan] = useState<PlanTier>('basic');

  const [shopSearch, setShopSearch] = useState('');
  const [shopVerticalFilter, setShopVerticalFilter] = useState<
    'all' | 'fnb' | 'service' | 'retail'
  >('all');

  const [orderStatusFilter, setOrderStatusFilter] = useState<
    'all' | OrderStatus
  >('all');
  const [orderShopFilter, setOrderShopFilter] = useState<string>('all');

  // AI Test state in System tab
  const [aiTestInput, setAiTestInput] = useState(
    'Phở bò tái nạm nước dùng ninh xương 12 giờ'
  );
  const [aiTestLoading, setAiTestLoading] = useState(false);
  const [aiTestOutput, setAiTestOutput] = useState<Record<
    string,
    string
  > | null>(null);

  const showToastMessage = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    // If Super Admin was impersonating a shop owner and returned to /admin, restore Super Admin session
    const backup = getAdminBackupSession();
    if (backup && isSuperAdmin(backup)) {
      stopAdminImpersonation();
      setAdminUser(backup);
      setAuthChecked(true);
      return;
    }

    const stored = getStoredAuthOwner();
    if (stored && isSuperAdmin(stored)) {
      setAdminUser(stored);
    }
    setAuthChecked(true);
  }, []);

  const fetchAdminData = useCallback(async () => {
    if (!adminUser) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin?adminEmail=${encodeURIComponent(adminUser.email)}`,
        {
          headers: {
            'x-admin-email': adminUser.email,
          },
          cache: 'no-store',
        }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Không thể tải dữ liệu Super Admin');
      }
      setData(json as AdminDashboardData);
    } catch (err) {
      showToastMessage(
        'error',
        err instanceof Error ? err.message : 'Lỗi kết nối API Super Admin'
      );
    } finally {
      setLoading(false);
    }
  }, [adminUser]);

  useEffect(() => {
    if (adminUser) {
      fetchAdminData();
    }
  }, [adminUser, fetchAdminData]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const normalized = loginEmail.trim().toLowerCase();
      if (normalized !== SUPER_ADMIN_EMAIL) {
        throw new Error(
          `Chỉ tài khoản Super Admin (${SUPER_ADMIN_EMAIL}) mới được phép truy cập trang này.`
        );
      }

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          email: normalized,
          password: loginPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.user) {
        throw new Error(json.error || 'Mật khẩu Super Admin không chính xác.');
      }

      const profile: Profile = {
        ...json.user,
        is_admin: true,
        role: 'admin',
        plan: 'premium',
      };
      setStoredAuthOwner(profile);
      setAdminUser(profile);
      showToastMessage(
        'success',
        `Chào mừng Super Admin ${profile.email} quay trở lại!`
      );
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : 'Lỗi đăng nhập Super Admin'
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const runAdminAction = async (
    payload: Record<string, unknown>,
    successMsg: string
  ) => {
    if (!adminUser) return false;
    setActionBusy(true);
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminUser.email,
        },
        body: JSON.stringify({
          ...payload,
          adminEmail: adminUser.email,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Thao tác thất bại');
      }
      showToastMessage('success', successMsg);
      await fetchAdminData();
      return true;
    } catch (err) {
      showToastMessage(
        'error',
        err instanceof Error ? err.message : 'Có lỗi xảy ra'
      );
      return false;
    } finally {
      setActionBusy(false);
    }
  };

  const handleImpersonateShop = (shop: EnrichedShop) => {
    if (!adminUser || !data) return;
    const ownerProfile = data.owners.find((o) => o.id === shop.owner_id) || {
      id: shop.owner_id,
      email: shop.ownerEmail,
      full_name: shop.ownerName,
      plan: shop.ownerPlan || 'premium',
    };
    startAdminImpersonation(adminUser, ownerProfile, shop.id);
    router.push('/dashboard');
  };

  const handleCreateOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await runAdminAction(
      {
        action: 'create_owner',
        email: newOwnerEmail,
        fullName: newOwnerName,
        phone: newOwnerPhone,
        password: newOwnerPassword || 'qlaok123456',
        plan: newOwnerPlan,
      },
      `Đã tạo tài khoản Chủ quán ${newOwnerEmail} (gói ${newOwnerPlan.toUpperCase()})!`
    );
    if (ok) {
      setNewOwnerEmail('');
      setNewOwnerName('');
      setNewOwnerPhone('');
      setNewOwnerPassword('');
      setShowCreateOwner(false);
    }
  };

  const handleResetOwnerPassword = async (owner: EnrichedOwner) => {
    const newPass = window.prompt(
      `Nhập mật khẩu mới cho tài khoản ${owner.email} (tối thiểu 6 ký tự):`,
      'qlaok123456'
    );
    if (!newPass) return;
    await runAdminAction(
      {
        action: 'reset_owner_password',
        ownerId: owner.id,
        email: owner.email,
        newPassword: newPass,
      },
      `Đã cập nhật mật khẩu mới cho ${owner.email}!`
    );
  };

  const handleTestAiTranslate = async () => {
    if (!aiTestInput.trim()) return;
    setAiTestLoading(true);
    setAiTestOutput(null);
    try {
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemNameVi: aiTestInput.trim(),
          vertical: 'fnb',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Lỗi dịch thuật tự động');
      }
      setAiTestOutput(json.name_i18n || json.translations || json);
      showToastMessage('success', 'Dịch tự động 5 ngôn ngữ thành công!');
    } catch (err) {
      showToastMessage(
        'error',
        err instanceof Error ? err.message : 'Lỗi kết nối dịch thuật tự động'
      );
    } finally {
      setAiTestLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredAuthOwner();
    setAdminUser(null);
    router.replace('/login');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
      </div>
    );
  }

  // If not logged in as Super Admin hoangvu96z@gmail.com, show dedicated Super Admin Gate
  if (!adminUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <span className="inline-block rounded-full bg-amber-400/15 border border-amber-400/30 px-3 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
              Qlaok Super Admin Portal
            </span>
            <h1 className="text-2xl font-black tracking-tight">
              Quản Trị Toàn Hệ Thống
            </h1>
            <p className="text-xs text-slate-400">
              Khu vực điều hành tối cao dành riêng cho Super Admin{' '}
              <strong className="text-amber-300">{SUPER_ADMIN_EMAIL}</strong>
            </p>
          </div>

          {loginError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Email Super Admin
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-400" />
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Mật khẩu Quản trị
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-400" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Nhập mật khẩu Super Admin..."
                  required
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-xs font-semibold text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50 shadow-lg"
            >
              <span>
                {loginLoading
                  ? 'Đang xác thực quyền Super Admin...'
                  : 'Mở Bảng Điều Khiển Super Admin'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="border-t border-slate-800 pt-4 flex items-center justify-between text-xs text-slate-400">
            <Link href="/" className="hover:text-white">
              ← Trang chủ Qlaok
            </Link>
            <Link
              href="/login"
              className="font-bold text-emerald-400 hover:underline"
            >
              Đăng nhập Chủ quán →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const kpis = data?.kpis;
  const filteredOwners = (data?.owners || []).filter((o) => {
    const matchPlan =
      ownerPlanFilter === 'all' ? true : o.plan === ownerPlanFilter;
    const q = ownerSearch.trim().toLowerCase();
    const matchSearch =
      !q ||
      o.email.toLowerCase().includes(q) ||
      (o.full_name || '').toLowerCase().includes(q) ||
      (o.phone || '').toLowerCase().includes(q);
    return matchPlan && matchSearch;
  });

  const filteredShops = (data?.shops || []).filter((s) => {
    const matchVert =
      shopVerticalFilter === 'all' ? true : s.vertical === shopVerticalFilter;
    const q = shopSearch.trim().toLowerCase();
    const matchSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      s.ownerEmail.toLowerCase().includes(q) ||
      (s.city || '').toLowerCase().includes(q);
    return matchVert && matchSearch;
  });

  const filteredOrders = (data?.orders || []).filter((o) => {
    const matchStatus =
      orderStatusFilter === 'all' ? true : o.status === orderStatusFilter;
    const matchShop =
      orderShopFilter === 'all' ? true : o.shop_id === orderShopFilter;
    return matchStatus && matchShop;
  });

  const NAV_TABS: Array<{
    id: AdminTab;
    label: string;
    icon: React.ElementType;
    badge?: string | number;
  }> = [
    {
      id: 'overview',
      label: 'Toàn cảnh Hệ thống',
      icon: LayoutDashboard,
    },
    {
      id: 'owners',
      label: 'Chủ quán & Gói cước',
      icon: Users,
      badge: kpis?.totalOwners,
    },
    {
      id: 'shops',
      label: 'Tất cả Cửa hàng',
      icon: Store,
      badge: kpis?.totalShops,
    },
    {
      id: 'orders',
      label: 'Đơn mPOS Toàn sàn',
      icon: Receipt,
      badge: kpis?.newOrdersCount ? `${kpis.newOrdersCount} mới` : kpis?.totalOrders,
    },
    {
      id: 'billing',
      label: 'Doanh thu SaaS & VietQR',
      icon: CreditCard,
      badge: kpis?.pendingTransactionsCount
        ? `${kpis.pendingTransactionsCount} chờ`
        : undefined,
    },
    {
      id: 'system',
      label: 'Trạng thái Hệ thống',
      icon: Cpu,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 theme-surface-page flex flex-col md:flex-row">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 max-w-md rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl flex items-center gap-2.5 ${
            toast.type === 'success'
              ? 'border-emerald-400 bg-slate-900 text-emerald-300'
              : 'border-rose-400 bg-slate-900 text-rose-300'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Left Sidebar */}
      <aside className="w-full md:w-64 md:shrink-0 md:fixed md:inset-y-0 md:left-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col z-30">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 font-black shadow-md">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <span className="block text-xs font-black text-white tracking-tight truncate">
                QLAOK SUPER ADMIN
              </span>
              <span className="block text-[10px] font-bold text-amber-400 truncate">
                {SUPER_ADMIN_EMAIL}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchAdminData}
            disabled={loading || actionBusy}
            title="Làm mới dữ liệu"
            className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white hover:border-amber-400"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin text-amber-400' : ''}`}
            />
          </button>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex md:flex-col gap-1 p-2.5 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto no-scrollbar flex-1">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-bold whitespace-nowrap transition-all ${
                  active
                    ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </div>
                {tab.badge !== undefined && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                      active
                        ? 'bg-slate-950 text-amber-400'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quick Links & Logout */}
        <div className="hidden md:block p-3 border-t border-slate-800 space-y-2">
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
          >
            <Store className="h-4 w-4" />
            <span>Mở CMS Quán Của Tôi</span>
          </Link>
          <div className="flex items-center justify-between rounded-xl bg-slate-950 px-3 py-2 border border-slate-800">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black text-amber-300">
                👑 Super Admin
              </p>
              <p className="truncate text-[10px] text-slate-400">
                {adminUser.email}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper (md:pl-64 isolates sidebar offset from inner responsive padding) */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen min-w-0">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-400/30 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                  👑 Super Admin Control Center
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  ● Hệ thống Trực tuyến
                </span>
              </div>
              <h1 className="mt-1.5 text-xl sm:text-2xl font-black text-white">
                {NAV_TABS.find((t) => t.id === activeTab)?.label}
              </h1>
              <p className="text-xs text-slate-400">
                Quản trị toàn diện Chủ quán, Cửa hàng, Đơn mPOS, Doanh thu gói cước
                &amp; Hạ tầng Qlaok
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Link
                href="/explore"
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-600"
              >
                <Globe className="h-3.5 w-3.5 text-emerald-400" />
                <span>Danh bạ Quán (/explore)</span>
              </Link>
              <button
                type="button"
                onClick={fetchAdminData}
                disabled={loading || actionBusy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                />
                <span>Đồng bộ Dữ liệu</span>
              </button>
            </div>
          </div>

          {/* ==================== TAB 1: EXECUTIVE OVERVIEW ==================== */}
          {activeTab === 'overview' && kpis && (
            <div className="space-y-6">
              {/* 4 Primary Executive KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-3xl border border-amber-500/30 bg-slate-900 p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">
                      Doanh thu Gói SaaS &amp; MRR
                    </span>
                    <CreditCard className="h-5 w-5 text-amber-400" />
                  </div>
                  <p className="text-2xl font-black text-amber-400">
                    {formatCurrency(kpis.totalSaasRevenue, 'VND')}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>MRR ước tính:</span>
                    <strong className="text-white">
                      {formatCurrency(kpis.estimatedMrr, 'VND')}/tháng
                    </strong>
                  </div>
                </div>

              <div className="rounded-3xl border border-emerald-500/30 bg-slate-900 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">
                    Tổng GMV Đơn mPOS Toàn Sàn
                  </span>
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
                <p className="text-2xl font-black text-emerald-400">
                  {formatCurrency(kpis.globalMposGmv, 'VND')}
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                  <span>Hôm nay ({kpis.totalOrders} tổng đơn):</span>
                  <strong className="text-emerald-300">
                    +{formatCurrency(kpis.todayMposGmv, 'VND')}
                  </strong>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">
                    Chủ Quán &amp; Cửa Hàng Hoạt Động
                  </span>
                  <Store className="h-5 w-5 text-sky-400" />
                </div>
                <p className="text-2xl font-black text-white">
                  {kpis.totalShops} Quán{' '}
                  <span className="text-sm font-bold text-slate-400">
                    / {kpis.totalOwners} Chủ quán
                  </span>
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                  <span>
                    🍜 {kpis.verticalBreakdown.fnb} • 💆‍♀️{' '}
                    {kpis.verticalBreakdown.service} • 🛍️{' '}
                    {kpis.verticalBreakdown.retail}
                  </span>
                  <strong className="text-sky-300">
                    {kpis.totalItems} món/dịch vụ
                  </strong>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">
                    Tổng Lượt Quét QR Toàn Hệ Thống
                  </span>
                  <QrCode className="h-5 w-5 text-purple-400" />
                </div>
                <p className="text-2xl font-black text-white">
                  {kpis.totalQrScans.toLocaleString('vi-VN')} lượt
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                  <span>
                    Cửa: {kpis.scanDoorCount} • Bàn: {kpis.scanTableCount}
                  </span>
                  <strong className="text-purple-300">
                    Wi-Fi: {kpis.wifiCopyCount}
                  </strong>
                </div>
              </div>
            </div>

            {/* Second Row: Plan Breakdown & Language Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Plan Distribution */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white">
                      Phân Bổ Gói Cước Chủ Quán (SaaS Tiers)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Tỷ lệ tài khoản Free vs Basic (39k) vs Premium (69k)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('owners')}
                    className="text-xs font-bold text-amber-400 hover:underline"
                  >
                    Quản lý Chủ quán →
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5 text-center">
                    <span className="text-[10px] font-black uppercase text-slate-400">
                      Gói FREE
                    </span>
                    <p className="mt-1 text-2xl font-black text-white">
                      {kpis.planBreakdown.free}
                    </p>
                    <p className="text-[11px] text-slate-500">0đ / tháng</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-center">
                    <span className="text-[10px] font-black uppercase text-emerald-300">
                      Gói BASIC
                    </span>
                    <p className="mt-1 text-2xl font-black text-emerald-400">
                      {kpis.planBreakdown.basic}
                    </p>
                    <p className="text-[11px] text-emerald-300/80">
                      39.000đ / tháng
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-center">
                    <span className="text-[10px] font-black uppercase text-amber-300">
                      Gói PREMIUM
                    </span>
                    <p className="mt-1 text-2xl font-black text-amber-400">
                      {kpis.planBreakdown.premium}
                    </p>
                    <p className="text-[11px] text-amber-300/80">
                      69.000đ / tháng
                    </p>
                  </div>
                </div>
              </div>

              {/* 5-Language Visitor Breakdown */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white">
                      Phân Bổ 5 Ngôn Ngữ Khách Quét QR Toàn Sàn
                    </h3>
                    <p className="text-xs text-slate-400">
                      Thống kê ngôn ngữ khách du lịch &amp; nội địa sử dụng
                    </p>
                  </div>
                  <Globe className="h-4 w-4 text-emerald-400" />
                </div>

                <div className="space-y-2.5">
                  {kpis.langBreakdown.map((item) => (
                    <div key={item.lang} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-200">
                          {LANG_LABELS[item.lang]}
                        </span>
                        <span className="font-bold text-slate-400">
                          {item.count} sự kiện ({item.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${Math.max(4, item.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Third Row: Top Performing Shops & Live Activity Stream */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Top Shops Table */}
              <div className="lg:col-span-2 rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white">
                      Bảng Xếp Hạng Cửa Hàng Toàn Hệ Thống
                    </h3>
                    <p className="text-xs text-slate-400">
                      Bấm &ldquo;Mở CMS Quán&rdquo; để quản trị thay chủ quán ngay lập tức
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('shops')}
                    className="text-xs font-bold text-amber-400 hover:underline"
                  >
                    Xem tất cả ({data?.shops.length || 0}) →
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 pr-3 font-bold">Cửa hàng</th>
                        <th className="py-2.5 px-3 font-bold">Chủ quán</th>
                        <th className="py-2.5 px-3 font-bold text-right">
                          Món / Đơn
                        </th>
                        <th className="py-2.5 px-3 font-bold text-right">
                          Doanh thu mPOS
                        </th>
                        <th className="py-2.5 pl-3 font-bold text-right">
                          Điều khiển
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {(data?.shops || []).slice(0, 6).map((shop) => (
                        <tr key={shop.id} className="hover:bg-slate-800/40">
                          <td className="py-3 pr-3">
                            <p className="font-bold text-white">{shop.name}</p>
                            <p className="text-[11px] text-slate-400">
                              /s/{shop.slug} • {shop.city}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-slate-200">
                              {shop.ownerEmail}
                            </p>
                            <span className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase text-amber-300">
                              {shop.ownerPlan}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-slate-300">
                            {shop.itemsCount} món • {shop.ordersCount} đơn
                          </td>
                          <td className="py-3 px-3 text-right font-black text-emerald-400">
                            {formatCurrency(shop.shopGmv, shop.currency || 'VND')}
                          </td>
                          <td className="py-3 pl-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleImpersonateShop(shop)}
                              className="inline-flex items-center gap-1 rounded-xl bg-amber-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-300"
                            >
                              <span>Mở CMS Quán</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Live Event Stream */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black text-white">
                      Luồng Sự Kiện Trực Tiếp
                    </h3>
                    <p className="text-xs text-slate-400">
                      Khách quét QR &amp; tương tác gần nhất
                    </p>
                  </div>
                  <Activity className="h-4 w-4 text-emerald-400" />
                </div>

                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {(data?.recentEvents || []).slice(0, 10).map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-xs flex items-start justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-white">
                          {ev.shopName}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Sự kiện:{' '}
                          <strong className="text-emerald-300">
                            {ev.event_type}
                          </strong>{' '}
                          • Ngôn ngữ:{' '}
                          <strong className="uppercase text-amber-300">
                            {ev.visitor_lang}
                          </strong>
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap">
                        {new Date(ev.created_at).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: OWNERS & PLANS ==================== */}
        {activeTab === 'owners' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-1 items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={ownerSearch}
                    onChange={(e) => setOwnerSearch(e.target.value)}
                    placeholder="Tìm kiếm Chủ quán theo email, tên, SĐT..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2 text-xs font-semibold text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <select
                  value={ownerPlanFilter}
                  onChange={(e) =>
                    setOwnerPlanFilter(e.target.value as 'all' | PlanTier)
                  }
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="all">Tất cả gói ({data?.owners.length || 0})</option>
                  <option value="free">Gói Free</option>
                  <option value="basic">Gói Basic (39k)</option>
                  <option value="premium">Gói Premium (69k)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowCreateOwner((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                <span>Tạo Tài Khoản Chủ Quán Mới</span>
              </button>
            </div>

            {/* Create Owner Drawer/Form */}
            {showCreateOwner && (
              <form
                onSubmit={handleCreateOwner}
                className="rounded-3xl border border-emerald-500/40 bg-slate-900 p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-emerald-300">
                    ➕ Cấp Tài Khoản Chủ Quán Mới
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowCreateOwner(false)}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Đóng
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <input
                    type="email"
                    required
                    value={newOwnerEmail}
                    onChange={(e) => setNewOwnerEmail(e.target.value)}
                    placeholder="Email chủ quán *"
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                  />
                  <input
                    type="text"
                    required
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    placeholder="Họ và tên *"
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                  />
                  <input
                    type="text"
                    value={newOwnerPhone}
                    onChange={(e) => setNewOwnerPhone(e.target.value)}
                    placeholder="Số điện thoại / Zalo"
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                  />
                  <input
                    type="text"
                    value={newOwnerPassword}
                    onChange={(e) => setNewOwnerPassword(e.target.value)}
                    placeholder="Mật khẩu (mặc định: qlaok123456)"
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                  />
                  <div className="flex gap-2">
                    <select
                      value={newOwnerPlan}
                      onChange={(e) =>
                        setNewOwnerPlan(e.target.value as PlanTier)
                      }
                      className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-amber-300"
                    >
                      <option value="free">FREE</option>
                      <option value="basic">BASIC (39k)</option>
                      <option value="premium">PREMIUM (69k)</option>
                    </select>
                    <button
                      type="submit"
                      disabled={actionBusy}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
                    >
                      Tạo
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Owners Table */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                      <th className="py-3.5 px-4 font-bold">Chủ quán / Email</th>
                      <th className="py-3.5 px-4 font-bold">Gói hiện tại</th>
                      <th className="py-3.5 px-4 font-bold">
                        Cửa hàng sở hữu
                      </th>
                      <th className="py-3.5 px-4 font-bold">
                        Đổi Gói Nhanh (1-Click)
                      </th>
                      <th className="py-3.5 px-4 font-bold text-right">
                        Bảo mật / Xóa
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredOwners.map((owner) => {
                      const isRootAdmin =
                        owner.email.toLowerCase() === SUPER_ADMIN_EMAIL;
                      return (
                        <tr key={owner.id} className="hover:bg-slate-800/40">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-white">
                                {owner.full_name || 'Chủ quán'}
                              </span>
                              {isRootAdmin && (
                                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-slate-950">
                                  👑 SUPER ADMIN
                                </span>
                              )}
                            </div>
                            <p className="text-slate-300 font-semibold mt-0.5">
                              {owner.email}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              ID: {owner.id} {owner.phone ? `• 📞 ${owner.phone}` : ''}
                            </p>
                          </td>

                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                                owner.plan === 'premium'
                                  ? 'bg-amber-400 text-slate-950'
                                  : owner.plan === 'basic'
                                    ? 'bg-emerald-500 text-slate-950'
                                    : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {owner.plan}
                            </span>
                            {owner.plan_expires_at && (
                              <p className="text-[10px] text-slate-400 mt-1">
                                Hết hạn:{' '}
                                {new Date(
                                  owner.plan_expires_at
                                ).toLocaleDateString('vi-VN')}
                              </p>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            {owner.shops.length === 0 ? (
                              <span className="text-slate-500 italic">
                                Chưa tạo quán (0)
                              </span>
                            ) : (
                              <div className="space-y-1">
                                {owner.shops.map((s) => (
                                  <div
                                    key={s.id}
                                    className="flex items-center gap-1.5"
                                  >
                                    <span className="font-bold text-emerald-300">
                                      {s.name}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      (/s/{s.slug})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(['free', 'basic', 'premium'] as PlanTier[]).map(
                                (tier) => (
                                  <button
                                    key={tier}
                                    type="button"
                                    disabled={
                                      actionBusy ||
                                      (isRootAdmin && tier !== 'premium')
                                    }
                                    onClick={() =>
                                      runAdminAction(
                                        {
                                          action: 'update_owner_plan',
                                          ownerId: owner.id,
                                          plan: tier,
                                          durationDays: 30,
                                        },
                                        `Đã chuyển gói của ${owner.email} sang ${tier.toUpperCase()} (+30 ngày)!`
                                      )
                                    }
                                    className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase border transition-all ${
                                      owner.plan === tier
                                        ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                                        : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'
                                    } disabled:opacity-40`}
                                  >
                                    {tier}
                                  </button>
                                )
                              )}
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() =>
                                  runAdminAction(
                                    {
                                      action: 'update_owner_plan',
                                      ownerId: owner.id,
                                      plan: 'premium',
                                      durationDays: 365,
                                    },
                                    `Đã gia hạn PREMIUM 1 năm cho ${owner.email}!`
                                  )
                                }
                                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20"
                              >
                                +1 Năm VIP
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleResetOwnerPassword(owner)}
                                className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:border-amber-400"
                              >
                                <KeyRound className="h-3 w-3 text-amber-400" />
                                <span>Đổi MK</span>
                              </button>
                              {!isRootAdmin && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Bạn có chắc muốn xóa tài khoản ${owner.email} và toàn bộ ${owner.shopsCount} cửa hàng của họ?`
                                      )
                                    ) {
                                      runAdminAction(
                                        {
                                          action: 'delete_owner',
                                          ownerId: owner.id,
                                          email: owner.email,
                                        },
                                        `Đã xóa tài khoản ${owner.email}`
                                      );
                                    }
                                  }}
                                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-400 hover:bg-rose-500/20"
                                  title="Xóa tài khoản"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: ALL SHOPS & IMPERSONATION ==================== */}
        {activeTab === 'shops' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-1 items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={shopSearch}
                    onChange={(e) => setShopSearch(e.target.value)}
                    placeholder="Tìm theo tên quán, slug, email chủ quán, tỉnh thành..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2 text-xs font-semibold text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <select
                  value={shopVerticalFilter}
                  onChange={(e) =>
                    setShopVerticalFilter(
                      e.target.value as 'all' | 'fnb' | 'service' | 'retail'
                    )
                  }
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                >
                  <option value="all">Tất cả ngành ({data?.shops.length || 0})</option>
                  <option value="fnb">🍜 F&amp;B / Nhà hàng / Cafe</option>
                  <option value="service">💆‍♀️ Spa / Nail / Dịch vụ</option>
                  <option value="retail">🛍️ Đặc sản / Bán lẻ</option>
                </select>
              </div>

              <Link
                href="/onboarding"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
              >
                <Plus className="h-4 w-4" />
                <span>Tạo Cửa Hàng Mới</span>
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredShops.map((shop) => (
                <div
                  key={shop.id}
                  className="rounded-3xl border border-slate-800 bg-slate-900 p-5 flex flex-col justify-between gap-4 hover:border-slate-700 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-400">
                            {shop.vertical}
                          </span>
                          <span className="text-xs font-semibold text-slate-400">
                            📍 {shop.city}
                          </span>
                          {shop.is_published === false ? (
                            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                              Đang ẩn
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              Đang hiển thị
                            </span>
                          )}
                        </div>
                        <h3 className="mt-1 text-base font-black text-white">
                          {shop.name}
                        </h3>
                        <p className="text-xs text-slate-400">
                          Slug: <code className="text-amber-300">/s/{shop.slug}</code>{' '}
                          • Chủ quán:{' '}
                          <strong className="text-slate-200">
                            {shop.ownerEmail}
                          </strong>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 rounded-2xl bg-slate-950 p-3 border border-slate-800 text-center">
                      <div>
                        <span className="block text-[10px] text-slate-500">
                          Danh mục
                        </span>
                        <span className="text-xs font-black text-white">
                          {shop.categoriesCount}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">
                          Món/DV
                        </span>
                        <span className="text-xs font-black text-white">
                          {shop.itemsCount}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">
                          Đơn mPOS
                        </span>
                        <span className="text-xs font-black text-amber-300">
                          {shop.ordersCount}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-500">
                          GMV Quán
                        </span>
                        <span className="text-xs font-black text-emerald-400">
                          {formatCurrency(shop.shopGmv, shop.currency || 'VND')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleImpersonateShop(shop)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Quản trị thay (Mở CMS)</span>
                      </button>

                      <a
                        href={`/s/${shop.slug}/menu?src=table`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-200 hover:border-emerald-400"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
                        <span>QR Bàn</span>
                      </a>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() =>
                          runAdminAction(
                            {
                              action: 'update_shop',
                              shopId: shop.id,
                              patch: {
                                is_published: shop.is_published === false,
                              },
                            },
                            `Đã cập nhật trạng thái hiển thị của quán ${shop.name}`
                          )
                        }
                        className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
                        title={
                          shop.is_published === false
                            ? 'Bật hiển thị công khai'
                            : 'Tạm ẩn cửa hàng'
                        }
                      >
                        {shop.is_published === false ? (
                          <Eye className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <EyeOff className="h-4 w-4 text-amber-400" />
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Xóa vĩnh viễn cửa hàng "${shop.name}" và toàn bộ menu của quán này?`
                            )
                          ) {
                            runAdminAction(
                              {
                                action: 'delete_shop',
                                shopId: shop.id,
                              },
                              `Đã xóa cửa hàng ${shop.name}`
                            );
                          }
                        }}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20"
                        title="Xóa cửa hàng"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: GLOBAL MPOS ORDERS & INVENTORY ==================== */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'new', 'preparing', 'completed', 'cancelled'] as const).map(
                  (st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setOrderStatusFilter(st)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                        orderStatusFilter === st
                          ? 'bg-amber-400 text-slate-950 font-black'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {st === 'all'
                        ? 'Tất cả đơn'
                        : st === 'new'
                          ? '🔔 Đơn mới'
                          : st === 'preparing'
                            ? '🍳 Đang chế biến'
                            : st === 'completed'
                              ? '✅ Hoàn tất'
                              : '❌ Đã hủy'}
                    </button>
                  )
                )}
              </div>

              <select
                value={orderShopFilter}
                onChange={(e) => setOrderShopFilter(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
              >
                <option value="all">Tất cả cửa hàng</option>
                {(data?.shops || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Low Stock Alert Banner across all shops */}
            {(data?.lowStockItems.length || 0) > 0 && (
              <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-black text-amber-300">
                  <PackageCheck className="h-4 w-4" />
                  <span>
                    Cảnh báo tồn kho toàn sàn ({data?.lowStockItems.length} món
                    sắp hết / hết hàng)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(data?.lowStockItems || []).map((item) => (
                    <span
                      key={item.id}
                      className="rounded-xl border border-amber-500/30 bg-slate-950 px-3 py-1 text-[11px] font-semibold text-slate-200"
                    >
                      <strong>{item.shopName}:</strong> {item.name_i18n.vi} (Còn{' '}
                      <strong className="text-amber-400">
                        {item.stock_quantity}
                      </strong>
                      )
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Global Orders List */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                      <th className="py-3.5 px-4 font-bold">Mã đơn / Bàn</th>
                      <th className="py-3.5 px-4 font-bold">Cửa hàng</th>
                      <th className="py-3.5 px-4 font-bold">Chi tiết món</th>
                      <th className="py-3.5 px-4 font-bold">Tổng tiền</th>
                      <th className="py-3.5 px-4 font-bold">Trạng thái</th>
                      <th className="py-3.5 px-4 font-bold text-right">
                        Xử lý nhanh
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-800/40">
                        <td className="py-3.5 px-4">
                          <span className="font-black text-amber-300">
                            #{order.order_code}
                          </span>
                          <p className="font-bold text-white">
                            {order.table_label}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {new Date(order.created_at).toLocaleString('vi-VN')}
                          </p>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="font-bold text-emerald-300">
                            {order.shopName}
                          </span>
                          <p className="text-[10px] uppercase text-slate-400">
                            Khách: {order.visitor_lang} • {order.payment_method}
                          </p>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            {order.items.map((line, idx) => (
                              <p key={idx} className="text-slate-200">
                                <strong>{line.quantity}x</strong> {line.name_vi}
                              </p>
                            ))}
                            {order.customer_note && (
                              <p className="text-[11px] text-amber-300 italic">
                                Ghi chú: &ldquo;{order.customer_note}&rdquo;
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-black text-emerald-400">
                          {formatCurrency(order.total_amount, 'VND')}
                          <span className="block text-[10px] font-bold text-slate-400 uppercase">
                            {order.payment_status === 'paid'
                              ? 'Đã thanh toán'
                              : 'Chưa thu tiền'}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                              order.status === 'new'
                                ? 'bg-amber-400 text-slate-950'
                                : order.status === 'preparing'
                                  ? 'bg-sky-400 text-slate-950'
                                  : order.status === 'completed'
                                    ? 'bg-emerald-500 text-slate-950'
                                    : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {order.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {order.status !== 'completed' && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() =>
                                  runAdminAction(
                                    {
                                      action: 'update_order_status',
                                      orderId: order.id,
                                      status: 'completed',
                                      payment_status: 'paid',
                                    },
                                    `Đã hoàn tất đơn #${order.order_code}`
                                  )
                                }
                                className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-black text-slate-950 hover:bg-emerald-400"
                              >
                                Hoàn tất
                              </button>
                            )}
                            {order.status !== 'cancelled' && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() =>
                                  runAdminAction(
                                    {
                                      action: 'update_order_status',
                                      orderId: order.id,
                                      status: 'cancelled',
                                    },
                                    `Đã hủy đơn #${order.order_code} và hoàn tồn kho`
                                  )
                                }
                                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20"
                              >
                                Hủy
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 5: SAAS BILLING & VIETQR TRANSACTIONS ==================== */}
        {activeTab === 'billing' && (
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-white">
                  Quản Lý Giao Dịch Nâng Cấp Gói (VietQR Billing)
                </h3>
                <p className="text-xs text-slate-400">
                  Duyệt nhanh các giao dịch chuyển khoản nâng cấp gói Basic
                  (39.000đ) và Premium (69.000đ) của Chủ quán
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">
                    Tổng đã thu SaaS
                  </span>
                  <span className="text-lg font-black text-amber-400">
                    {formatCurrency(kpis?.totalSaasRevenue || 0, 'VND')}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                      <th className="py-3.5 px-4 font-bold">Mã giao dịch</th>
                      <th className="py-3.5 px-4 font-bold">Chủ quán</th>
                      <th className="py-3.5 px-4 font-bold">Gói nâng cấp</th>
                      <th className="py-3.5 px-4 font-bold">Số tiền</th>
                      <th className="py-3.5 px-4 font-bold">Trạng thái</th>
                      <th className="py-3.5 px-4 font-bold text-right">
                        Thao tác Admin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {(data?.transactions || []).map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/40">
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-black text-amber-300">
                            {tx.order_code}
                          </span>
                          <p className="text-[10px] text-slate-500">
                            {new Date(tx.created_at).toLocaleString('vi-VN')}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-bold text-white">{tx.ownerName}</p>
                          <p className="text-[11px] text-slate-400">
                            {tx.ownerEmail}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                            {tx.target_plan}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-black text-emerald-400">
                          {formatCurrency(tx.amount, 'VND')}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                              tx.status === 'completed'
                                ? 'bg-emerald-500 text-slate-950'
                                : tx.status === 'pending'
                                  ? 'bg-amber-400 text-slate-950 animate-pulse'
                                  : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {tx.status}
                          </span>
                          {tx.bank_ref_id && (
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              Ref: {tx.bank_ref_id}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {tx.status === 'pending' ? (
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() =>
                                runAdminAction(
                                  {
                                    action: 'approve_transaction',
                                    orderCode: tx.order_code,
                                    ownerId: tx.user_id,
                                  },
                                  `Đã duyệt giao dịch ${tx.order_code} & nâng cấp gói ${tx.target_plan.toUpperCase()} cho ${tx.ownerEmail}!`
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-emerald-400"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Duyệt &amp; Kích Hoạt Gói</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-500 font-semibold">
                              Đã hoàn tất
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 6: SYSTEM HEALTH ==================== */}
        {activeTab === 'system' && data?.systemHealth && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cloud DB Status */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Database className="h-5 w-5 text-emerald-400" />
                    <div>
                      <h3 className="text-sm font-black text-white">
                        Cơ Sở Dữ Liệu Đám Mây
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Đồng bộ thời gian thực cho toàn bộ cửa hàng
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300">
                    ONLINE
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {Object.entries(data.systemHealth.tableCounts).map(
                    ([table, count]) => (
                      <div
                        key={table}
                        className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
                      >
                        <span className="block text-[10px] font-mono text-slate-400 truncate">
                          {table}
                        </span>
                        <span className="text-base font-black text-white">
                          {count}
                        </span>
                      </div>
                    )
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Khôi phục 3 cửa hàng Demo gốc (không xóa quán của khách)
                  </span>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() =>
                      runAdminAction(
                        { action: 'reseed_demo_data' },
                        'Đã đồng bộ lại dữ liệu 3 cửa hàng Demo mẫu!'
                      )
                    }
                    className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                  >
                    Khôi phục dữ liệu mẫu
                  </button>
                </div>
              </div>

              {/* AI Service Status & Live Tester */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Cpu className="h-5 w-5 text-amber-400" />
                    <div>
                      <h3 className="text-sm font-black text-white">
                        Hệ Thống Dịch Thuật &amp; Quét Thực Đơn Tự Động
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Nhận diện thực đơn đa cột &amp; dịch tự động 5 ngôn ngữ (Việt, Anh, Hàn, Nhật, Trung)
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-black text-amber-300">
                    READY
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-300">
                    Test Dịch AI 5 Ngôn Ngữ Trực Tiếp:
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiTestInput}
                      onChange={(e) => setAiTestInput(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                    />
                    <button
                      type="button"
                      disabled={aiTestLoading}
                      onClick={handleTestAiTranslate}
                      className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50"
                    >
                      {aiTestLoading ? 'Đang dịch...' : 'Test AI'}
                    </button>
                  </div>
                </div>

                {aiTestOutput && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-1">
                    {Object.entries(aiTestOutput).map(([lang, val]) => (
                      <div key={lang} className="flex items-start gap-2">
                        <span className="font-mono font-black uppercase text-amber-400 w-8">
                          {lang}:
                        </span>
                        <span className="text-slate-200">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
