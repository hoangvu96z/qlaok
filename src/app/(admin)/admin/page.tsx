'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  getAuthHeaders,
  getStoredAuthOwner,
  isSuperAdmin,
  setStoredAuthOwner,
  startAdminImpersonation,
  stopAdminImpersonation,
  SUPER_ADMIN_EMAIL,
} from '@/lib/auth-session';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';
import {
  AppDataTable,
  type TableColumn,
} from '@/components/ui/AppDataTable';
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
  const { locale, t, tx } = useAppI18n();
  const translateRef = useRef(tx);
  translateRef.current = tx;
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
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const showToastMessage = useCallback(
    (type: 'success' | 'error', text: string) => {
      setToast({ type, text });
      setTimeout(() => {
        setToast((prev) => (prev?.text === text ? null : prev));
      }, 6000);
    },
    []
  );

  const parseApiJson = useCallback(async (res: Response): Promise<Record<string, unknown>> => {
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {
        error: translateRef.current(
          'Phản hồi máy chủ không hợp lệ (HTTP {status}).',
          'Invalid server response (HTTP {status}).',
          { status: res.status }
        ),
      };
    }
  }, []);

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
    setLoadError(null);
    try {
      const res = await fetch('/api/admin', {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });
      const json = await parseApiJson(res);
      const apiError =
        typeof json.error === 'string' && json.error.trim()
          ? json.error.trim()
          : null;

      if (res.status === 401 || res.status === 403) {
        const authErrMsg =
          apiError ||
          translateRef.current(
            'Phiên đăng nhập Super Admin đã hết hạn. Vui lòng đăng nhập lại.',
            'Super Admin session expired. Please sign in again.'
          );
        clearStoredAuthOwner();
        setData(null);
        setAdminUser(null);
        setLoginError(authErrMsg);
        showToastMessage('error', authErrMsg);
        return;
      }
      if (!res.ok) {
        throw new Error(
          apiError ||
            translateRef.current(
              'Không thể tải dữ liệu Super Admin (HTTP {status}).',
              'Could not load Super Admin data (HTTP {status}).',
              { status: res.status }
            )
        );
      }
      setData(json as unknown as AdminDashboardData);
      setLoadError(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : translateRef.current('Lỗi kết nối API Super Admin', 'Super Admin API connection error');
      setLoadError(message);
      showToastMessage('error', message);
    } finally {
      setLoading(false);
    }
  }, [adminUser, showToastMessage, parseApiJson]);

  useEffect(() => {
    if (adminUser) {
      fetchAdminData();
    }
  }, [adminUser, fetchAdminData]);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoadError(null);
    setLoginLoading(true);
    try {
      const normalized = loginEmail.trim().toLowerCase();
      if (normalized !== SUPER_ADMIN_EMAIL) {
        throw new Error(
          tx(
            'Chỉ tài khoản Super Admin ({email}) mới được phép truy cập trang này.',
            'Only the Super Admin account ({email}) can access this portal.',
            { email: SUPER_ADMIN_EMAIL }
          )
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
      const json = await parseApiJson(res);
      const apiError =
        typeof json.error === 'string' && json.error.trim()
          ? json.error.trim()
          : null;
      if (!res.ok || !json.user) {
        throw new Error(
          apiError ||
            tx(
              'Mật khẩu Super Admin không chính xác.',
              'Incorrect Super Admin password.'
            )
        );
      }

      const profile: Profile = {
        ...(json.user as Profile),
        is_admin: true,
        role: 'admin',
        plan: 'premium',
      };
      setStoredAuthOwner(
        profile,
        typeof json.accessToken === 'string' ? json.accessToken : undefined
      );
      setAdminUser(profile);
      showToastMessage(
        'success',
        tx('Chào mừng Super Admin {email}!', 'Welcome back, Super Admin {email}!', {
          email: profile.email,
        })
      );
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : tx('Lỗi đăng nhập Super Admin', 'Super Admin sign-in failed')
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
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(payload),
      });
      const json = await parseApiJson(res);
      const apiError =
        typeof json.error === 'string' && json.error.trim()
          ? json.error.trim()
          : null;
      if (res.status === 401 || res.status === 403) {
        const authErrMsg =
          apiError ||
          tx(
            'Phiên đăng nhập Super Admin đã hết hạn. Vui lòng đăng nhập lại.',
            'Super Admin session expired. Please sign in again.'
          );
        clearStoredAuthOwner();
        setData(null);
        setAdminUser(null);
        setLoginError(authErrMsg);
        showToastMessage('error', authErrMsg);
        return false;
      }
      if (!res.ok) {
        throw new Error(apiError || tx('Thao tác thất bại', 'Action failed'));
      }
      showToastMessage('success', successMsg);
      await fetchAdminData();
      return true;
    } catch (err) {
      showToastMessage(
        'error',
        err instanceof Error
          ? err.message
          : tx('Có lỗi xảy ra', 'An error occurred')
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
      tx(
        'Đã tạo tài khoản Chủ quán {email} (gói {plan})!',
        'Created shop owner {email} ({plan} plan)!',
        { email: newOwnerEmail, plan: newOwnerPlan.toUpperCase() }
      )
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
      tx(
        'Nhập mật khẩu mới cho tài khoản {email} (tối thiểu 6 ký tự):',
        'Enter new password for {email} (min 6 characters):',
        { email: owner.email }
      ),
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
      tx(
        'Đã cập nhật mật khẩu mới cho {email}!',
        'Updated password for {email}!',
        { email: owner.email }
      )
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
        throw new Error(
          json.error || tx('Lỗi dịch thuật tự động', 'Auto-translation error')
        );
      }
      setAiTestOutput(json.name_i18n || json.translations || json);
      showToastMessage(
        'success',
        tx('Dịch tự động thành công!', 'Auto-translation succeeded!')
      );
    } catch (err) {
      showToastMessage(
        'error',
        err instanceof Error
          ? err.message
          : tx('Lỗi kết nối dịch thuật', 'Translation service error')
      );
    } finally {
      setAiTestLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredAuthOwner();
    setData(null);
    setLoadError(null);
    setAdminUser(null);
    router.replace('/login');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-white theme-surface-page flex items-center justify-center">
        <div
          role="status"
          aria-label={tx(
            'Đang kiểm tra phiên đăng nhập Super Admin',
            'Checking Super Admin session'
          )}
          className="flex flex-col items-center gap-3"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
          <p className="text-xs font-bold text-slate-300">
            {tx(
              'Đang kiểm tra quyền truy cập Super Admin...',
              'Checking Super Admin access...'
            )}
          </p>
        </div>
      </div>
    );
  }

  // If not logged in as Super Admin hoangvu96z@gmail.com, show dedicated Super Admin Gate
  if (!adminUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-white theme-surface-page flex flex-col justify-center items-center p-4">
        {toast && (
          <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`fixed top-4 right-4 z-50 max-w-md rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl flex items-start gap-2.5 ${
              toast.type === 'success'
                ? 'border-emerald-500/60 bg-emerald-950/95 text-emerald-200'
                : 'border-rose-500/60 bg-rose-950/95 text-rose-200'
            }`}
          >
            <div
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg ${
                toast.type === 'success'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
            </div>
            <span className="flex-1 leading-relaxed">{toast.text}</span>
          </div>
        )}

        <div className="w-full max-w-md rounded-3xl border border-amber-500/30 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-end gap-2">
            <AppLanguageSwitcher variant="dark" />
            <ThemeToggle />
          </div>

          <div className="text-center space-y-2">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-lg">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <span className="inline-block rounded-full bg-amber-400/15 border border-amber-400/30 px-3 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
              {t('admin.title')}
            </span>
            <h1 className="text-2xl font-black tracking-tight text-white">
              {tx('Quản Trị Toàn Hệ Thống', 'System Administration')}
            </h1>
            <p className="text-xs text-slate-400">
              {tx(
                'Khu vực điều hành dành riêng cho Super Admin',
                'Dedicated administration portal for Super Admin'
              )}{' '}
              <strong className="text-amber-300">{SUPER_ADMIN_EMAIL}</strong>
            </p>
          </div>

          {loginError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/50 bg-rose-950/90 p-3.5 text-xs font-bold text-rose-200 flex items-start gap-2.5"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <span className="leading-relaxed">{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                {tx('Email Super Admin', 'Super Admin Email')}
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
                {tx('Mật khẩu Quản trị', 'Admin Password')}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-400" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder={tx(
                    'Nhập mật khẩu Super Admin...',
                    'Enter Super Admin password...'
                  )}
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
                  ? tx('Đang xác thực...', 'Verifying...')
                  : tx('Mở Bảng Quản Trị', 'Open Admin Console')}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="border-t border-slate-800 pt-4 flex items-center justify-between text-xs text-slate-400">
            <Link href="/" className="hover:text-white">
              {tx('← Trang chủ Qlaok', '← Qlaok Home')}
            </Link>
            <Link
              href="/login"
              className="font-bold text-emerald-400 hover:underline"
            >
              {tx('Đăng nhập Chủ quán →', 'Shop Owner Login →')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const kpis = data?.kpis;
  const isApiHealthy = Boolean(
    data && !loadError && data.systemHealth?.supabaseConnected
  );
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

  const overviewShopColumns: TableColumn<EnrichedShop>[] = [
    {
      id: 'shop',
      name: tx('Cửa hàng', 'Shop'),
      sortable: true,
      selector: (shop) => shop.name,
      minWidth: '180px',
      wrap: true,
      cell: (shop) => (
        <div className="py-1">
          <p className="font-bold text-slate-900 dark:text-white">{shop.name}</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            /s/{shop.slug} • {shop.city}
          </p>
        </div>
      ),
    },
    {
      id: 'owner',
      name: tx('Chủ quán', 'Owner'),
      sortable: true,
      selector: (shop) => shop.ownerEmail,
      minWidth: '180px',
      wrap: true,
      cell: (shop) => (
        <div className="py-1">
          <p className="font-semibold text-slate-800 dark:text-slate-200">{shop.ownerEmail}</p>
          <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">
            {shop.ownerPlan}
          </span>
        </div>
      ),
    },
    {
      id: 'items_orders',
      name: tx('Món / Đơn', 'Items / Orders'),
      sortable: true,
      right: true,
      selector: (shop) => shop.ordersCount,
      sortFunction: (a, b) =>
        Number(a.ordersCount || 0) - Number(b.ordersCount || 0) ||
        Number(a.itemsCount || 0) - Number(b.itemsCount || 0),
      minWidth: '140px',
      cell: (shop) => (
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          {tx(
            '{items} món • {orders} đơn',
            '{items} items • {orders} orders',
            {
              items: shop.itemsCount,
              orders: shop.ordersCount,
            }
          )}
        </span>
      ),
    },
    {
      id: 'revenue',
      name: tx('Doanh thu', 'Revenue'),
      sortable: true,
      right: true,
      selector: (shop) => shop.shopGmv,
      sortFunction: (a, b) => Number(a.shopGmv || 0) - Number(b.shopGmv || 0),
      minWidth: '130px',
      cell: (shop) => (
        <span className="font-black text-emerald-700 dark:text-emerald-400">
          {formatCurrency(shop.shopGmv, shop.currency || 'VND')}
        </span>
      ),
    },
    {
      id: 'action',
      name: tx('Thao tác', 'Action'),
      right: true,
      ignoreRowClick: true,
      allowOverflow: true,
      minWidth: '150px',
      cell: (shop) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleImpersonateShop(shop);
          }}
          className="inline-flex items-center gap-1 rounded-xl bg-amber-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 hover:bg-amber-300"
        >
          <span>{tx('Quản lý Quán', 'Manage Shop')}</span>
          <ArrowRight className="h-3 w-3" />
        </button>
      ),
    },
  ];

  const ownerColumns: TableColumn<EnrichedOwner>[] = [
    {
      id: 'owner',
      name: tx('Chủ quán / Email', 'Owner / Email'),
      sortable: true,
      selector: (owner) => owner.email,
      minWidth: '220px',
      wrap: true,
      cell: (owner) => {
        const isRootAdmin = owner.email.toLowerCase() === SUPER_ADMIN_EMAIL;
        return (
          <div className="py-1">
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-900 dark:text-white">
                {owner.full_name || tx('Chủ quán', 'Shop Owner')}
              </span>
              {isRootAdmin && (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black text-slate-950">
                  👑 SUPER ADMIN
                </span>
              )}
            </div>
            <p className="text-slate-700 dark:text-slate-300 font-semibold mt-0.5">{owner.email}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              ID: {owner.id} {owner.phone ? `• 📞 ${owner.phone}` : ''}
            </p>
          </div>
        );
      },
    },
    {
      id: 'plan',
      name: tx('Gói hiện tại', 'Current Plan'),
      sortable: true,
      selector: (owner) => owner.plan,
      sortFunction: (a, b) =>
        a.plan.localeCompare(b.plan) ||
        (a.plan_expires_at ? new Date(a.plan_expires_at).getTime() : 0) -
          (b.plan_expires_at ? new Date(b.plan_expires_at).getTime() : 0),
      minWidth: '140px',
      wrap: true,
      cell: (owner) => (
        <div className="py-1">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
              owner.plan === 'premium'
                ? 'bg-amber-400 text-slate-950'
                : owner.plan === 'basic'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {owner.plan}
          </span>
          {owner.plan_expires_at && (
            <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1">
              {tx('Hết hạn:', 'Expires:')}{' '}
              {new Date(owner.plan_expires_at).toLocaleDateString(
                locale === 'en' ? 'en-US' : 'vi-VN'
              )}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'shops',
      name: tx('Cửa hàng sở hữu', 'Owned Shops'),
      sortable: true,
      selector: (owner) => owner.shopsCount,
      sortFunction: (a, b) =>
        Number(a.shopsCount || 0) - Number(b.shopsCount || 0),
      minWidth: '190px',
      wrap: true,
      cell: (owner) =>
        owner.shops.length === 0 ? (
          <span className="text-slate-500 dark:text-slate-400 italic">
            {tx('Chưa tạo quán (0)', 'No shops (0)')}
          </span>
        ) : (
          <div className="space-y-1 py-1">
            {owner.shops.map((s) => (
              <div key={s.id} className="flex items-center gap-1.5">
                <span className="font-bold text-emerald-700 dark:text-emerald-300">{s.name}</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  (/s/{s.slug})
                </span>
              </div>
            ))}
          </div>
        ),
    },
    {
      id: 'quick_plan',
      name: tx('Đổi Gói Nhanh', 'Quick Plan Switch'),
      ignoreRowClick: true,
      allowOverflow: true,
      minWidth: '250px',
      wrap: true,
      cell: (owner) => {
        const isRootAdmin = owner.email.toLowerCase() === SUPER_ADMIN_EMAIL;
        return (
          <div className="flex flex-wrap items-center gap-1.5 py-1">
            {(['free', 'basic', 'premium'] as PlanTier[]).map((tier) => (
              <button
                key={tier}
                type="button"
                disabled={actionBusy || (isRootAdmin && tier !== 'premium')}
                onClick={(e) => {
                  e.stopPropagation();
                  runAdminAction(
                    {
                      action: 'update_owner_plan',
                      ownerId: owner.id,
                      plan: tier,
                      durationDays: 30,
                    },
                    tx(
                      'Đã chuyển gói của {email} sang {plan} (+30 ngày)!',
                      'Switched {email} to {plan} (+30 days)!',
                      {
                        email: owner.email,
                        plan: tier.toUpperCase(),
                      }
                    )
                  );
                }}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase border transition-all ${
                  owner.plan === tier
                    ? 'border-amber-400 bg-amber-400/20 text-amber-800 dark:text-amber-300'
                    : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 hover:border-slate-500'
                } disabled:opacity-40`}
              >
                {tier}
              </button>
            ))}
            <button
              type="button"
              disabled={actionBusy}
              onClick={(e) => {
                e.stopPropagation();
                runAdminAction(
                  {
                    action: 'update_owner_plan',
                    ownerId: owner.id,
                    plan: 'premium',
                    durationDays: 365,
                  },
                  tx(
                    'Đã gia hạn PREMIUM 1 năm cho {email}!',
                    'Extended PREMIUM by 1 year for {email}!',
                    { email: owner.email }
                  )
                );
              }}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
            >
              {tx('+1 Năm VIP', '+1 Year VIP')}
            </button>
          </div>
        );
      },
    },
    {
      id: 'security',
      name: tx('Bảo mật / Xóa', 'Security / Delete'),
      right: true,
      ignoreRowClick: true,
      allowOverflow: true,
      minWidth: '160px',
      cell: (owner) => {
        const isRootAdmin = owner.email.toLowerCase() === SUPER_ADMIN_EMAIL;
        return (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleResetOwnerPassword(owner);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-200 hover:border-amber-400"
            >
              <KeyRound className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span>{tx('Đổi MK', 'Reset PW')}</span>
            </button>
            {!isRootAdmin && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  if (
                    window.confirm(
                      tx(
                        'Bạn có chắc muốn xóa tài khoản {email} và toàn bộ {count} cửa hàng của họ?',
                        'Are you sure you want to delete account {email} and all {count} of their shops?',
                        {
                          email: owner.email,
                          count: owner.shopsCount,
                        }
                      )
                    )
                  ) {
                    runAdminAction(
                      {
                        action: 'delete_owner',
                        ownerId: owner.id,
                        email: owner.email,
                      },
                      tx(
                        'Đã xóa tài khoản {email}',
                        'Deleted account {email}',
                        { email: owner.email }
                      )
                    );
                  }
                }}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20"
                title={tx('Xóa tài khoản', 'Delete account')}
                aria-label={tx('Xóa tài khoản', 'Delete account')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const orderColumns: TableColumn<EnrichedOrder>[] = [
    {
      id: 'order_code',
      name: tx('Mã đơn / Bàn', 'Order / Table'),
      sortable: true,
      selector: (order) => new Date(order.created_at).getTime() || 0,
      sortFunction: (a, b) =>
        (new Date(a.created_at).getTime() || 0) -
        (new Date(b.created_at).getTime() || 0),
      minWidth: '165px',
      wrap: true,
      cell: (order) => (
        <div className="py-1">
          <span className="font-black text-amber-700 dark:text-amber-300">#{order.order_code}</span>
          <p className="font-bold text-slate-900 dark:text-white">{order.table_label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {new Date(order.created_at).toLocaleString(
              locale === 'en' ? 'en-US' : 'vi-VN'
            )}
          </p>
        </div>
      ),
    },
    {
      id: 'shop',
      name: tx('Cửa hàng', 'Shop'),
      sortable: true,
      selector: (order) => order.shopName,
      minWidth: '165px',
      wrap: true,
      cell: (order) => (
        <div className="py-1">
          <span className="font-bold text-emerald-700 dark:text-emerald-300">{order.shopName}</span>
          <p className="text-[10px] uppercase text-slate-600 dark:text-slate-400">
            {tx('Khách:', 'Guest:')} {order.visitor_lang} •{' '}
            {order.payment_method}
          </p>
        </div>
      ),
    },
    {
      id: 'items',
      name: tx('Chi tiết món', 'Items'),
      sortable: true,
      selector: (order) => order.items.length,
      sortFunction: (a, b) => Number(a.items.length) - Number(b.items.length),
      minWidth: '220px',
      wrap: true,
      cell: (order) => (
        <div className="space-y-0.5 py-1">
          {order.items.map((line, idx) => (
            <p key={idx} className="text-slate-800 dark:text-slate-200">
              <strong>{line.quantity}x</strong> {line.name_vi}
            </p>
          ))}
          {order.customer_note && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 italic">
              {tx('Ghi chú:', 'Note:')} &ldquo;{order.customer_note}&rdquo;
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'total_amount',
      name: tx('Tổng tiền', 'Total'),
      sortable: true,
      right: true,
      selector: (order) => order.total_amount,
      sortFunction: (a, b) =>
        Number(a.total_amount || 0) - Number(b.total_amount || 0),
      minWidth: '140px',
      wrap: true,
      cell: (order) => (
        <div className="py-1 text-right font-black text-emerald-700 dark:text-emerald-400">
          {formatCurrency(order.total_amount, 'VND')}
          <span className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
            {order.payment_status === 'paid'
              ? tx('Đã thanh toán', 'Paid')
              : tx('Chưa thu tiền', 'Unpaid')}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      name: tx('Trạng thái', 'Status'),
      sortable: true,
      selector: (order) => order.status,
      minWidth: '125px',
      cell: (order) => (
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
            order.status === 'new'
              ? 'bg-amber-400 text-slate-950'
              : order.status === 'preparing'
                ? 'bg-sky-400 text-slate-950'
                : order.status === 'completed'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
          }`}
        >
          {order.status === 'new'
            ? tx('Mới', 'New')
            : order.status === 'preparing'
              ? tx('Đang làm', 'Preparing')
              : order.status === 'completed'
                ? tx('Hoàn tất', 'Completed')
                : tx('Đã hủy', 'Cancelled')}
        </span>
      ),
    },
    {
      id: 'actions',
      name: tx('Xử lý nhanh', 'Quick Action'),
      right: true,
      ignoreRowClick: true,
      allowOverflow: true,
      minWidth: '165px',
      cell: (order) => (
        <div className="inline-flex items-center gap-1.5">
          {order.status !== 'completed' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={(e) => {
                e.stopPropagation();
                runAdminAction(
                  {
                    action: 'update_order_status',
                    orderId: order.id,
                    status: 'completed',
                    payment_status: 'paid',
                  },
                  tx('Đã hoàn tất đơn #{code}', 'Completed order #{code}', {
                    code: order.order_code,
                  })
                );
              }}
              className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-black text-slate-950 hover:bg-emerald-400"
            >
              {tx('Hoàn tất', 'Complete')}
            </button>
          )}
          {order.status !== 'cancelled' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={(e) => {
                e.stopPropagation();
                runAdminAction(
                  {
                    action: 'update_order_status',
                    orderId: order.id,
                    status: 'cancelled',
                  },
                  tx(
                    'Đã hủy đơn #{code} và hoàn tồn kho',
                    'Cancelled order #{code} and restored stock',
                    { code: order.order_code }
                  )
                );
              }}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      ),
    },
  ];

  const transactionColumns: TableColumn<EnrichedTransaction>[] = [
    {
      id: 'order_code',
      name: tx('Mã giao dịch', 'Transaction Code'),
      sortable: true,
      selector: (trx) => new Date(trx.created_at).getTime() || 0,
      sortFunction: (a, b) =>
        (new Date(a.created_at).getTime() || 0) -
        (new Date(b.created_at).getTime() || 0),
      minWidth: '165px',
      wrap: true,
      cell: (trx) => (
        <div className="py-1">
          <span className="font-mono font-black text-amber-700 dark:text-amber-300">
            {trx.order_code}
          </span>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {new Date(trx.created_at).toLocaleString(
              locale === 'en' ? 'en-US' : 'vi-VN'
            )}
          </p>
        </div>
      ),
    },
    {
      id: 'owner',
      name: tx('Chủ quán', 'Owner'),
      sortable: true,
      selector: (trx) => trx.ownerEmail,
      minWidth: '190px',
      wrap: true,
      cell: (trx) => (
        <div className="py-1">
          <p className="font-bold text-slate-900 dark:text-white">{trx.ownerName}</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">{trx.ownerEmail}</p>
        </div>
      ),
    },
    {
      id: 'target_plan',
      name: tx('Gói nâng cấp', 'Target Plan'),
      sortable: true,
      selector: (trx) => trx.target_plan,
      minWidth: '130px',
      cell: (trx) => (
        <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:text-amber-300">
          {trx.target_plan}
        </span>
      ),
    },
    {
      id: 'amount',
      name: tx('Số tiền', 'Amount'),
      sortable: true,
      right: true,
      selector: (trx) => trx.amount,
      sortFunction: (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
      minWidth: '130px',
      cell: (trx) => (
        <span className="font-black text-emerald-700 dark:text-emerald-400">
          {formatCurrency(trx.amount, 'VND')}
        </span>
      ),
    },
    {
      id: 'status',
      name: tx('Trạng thái', 'Status'),
      sortable: true,
      selector: (trx) => trx.status,
      minWidth: '150px',
      wrap: true,
      cell: (trx) => (
        <div className="py-1">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
              trx.status === 'completed'
                ? 'bg-emerald-500 text-slate-950'
                : trx.status === 'pending'
                  ? 'bg-amber-400 text-slate-950 animate-pulse'
                  : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
            }`}
          >
            {trx.status === 'completed'
              ? tx('Hoàn tất', 'Completed')
              : trx.status === 'pending'
                ? tx('Chờ duyệt', 'Pending')
                : trx.status}
          </span>
          {trx.bank_ref_id && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Ref: {trx.bank_ref_id}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'action',
      name: tx('Thao tác', 'Action'),
      right: true,
      ignoreRowClick: true,
      allowOverflow: true,
      minWidth: '175px',
      cell: (trx) =>
        trx.status === 'pending' ? (
          <button
            type="button"
            disabled={actionBusy}
            onClick={(e) => {
              e.stopPropagation();
              runAdminAction(
                {
                  action: 'approve_transaction',
                  orderCode: trx.order_code,
                  ownerId: trx.user_id,
                },
                tx(
                  'Đã duyệt giao dịch {code} & nâng cấp gói {plan} cho {email}!',
                  'Approved transaction {code} & upgraded {email} to {plan}!',
                  {
                    code: trx.order_code,
                    plan: trx.target_plan.toUpperCase(),
                    email: trx.ownerEmail,
                  }
                )
              );
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-emerald-400"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{tx('Duyệt & Kích hoạt', 'Approve & Activate')}</span>
          </button>
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
            {tx('Đã hoàn tất', 'Completed')}
          </span>
        ),
    },
  ];

  const NAV_TABS: Array<{
    id: AdminTab;
    label: string;
    icon: React.ElementType;
    badge?: string | number;
  }> = [
    {
      id: 'overview',
      label: t('admin.tabOverview'),
      icon: LayoutDashboard,
    },
    {
      id: 'owners',
      label: t('admin.tabAccounts'),
      icon: Users,
      badge: kpis?.totalOwners,
    },
    {
      id: 'shops',
      label: t('admin.tabShops'),
      icon: Store,
      badge: kpis?.totalShops,
    },
    {
      id: 'orders',
      label: t('admin.tabOrders'),
      icon: Receipt,
      badge: kpis?.newOrdersCount
        ? tx('{count} mới', '{count} new', { count: kpis.newOrdersCount })
        : kpis?.totalOrders,
    },
    {
      id: 'billing',
      label: t('admin.tabBilling'),
      icon: CreditCard,
      badge: kpis?.pendingTransactionsCount
        ? tx('{count} chờ', '{count} pending', {
            count: kpis.pendingTransactionsCount,
          })
        : undefined,
    },
    {
      id: 'system',
      label: t('admin.tabSystem'),
      icon: Cpu,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 theme-surface-page flex flex-col md:flex-row">
      {/* High-Contrast Semantic Toast Notification */}
      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed top-4 right-4 z-50 max-w-md rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl flex items-start gap-2.5 ${
            toast.type === 'success'
              ? 'border-emerald-500/60 bg-emerald-950/95 text-emerald-200'
              : 'border-rose-500/60 bg-rose-950/95 text-rose-200'
          }`}
        >
          <div
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg ${
              toast.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
          </div>
          <span className="flex-1 leading-relaxed">{toast.text}</span>
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
                {t('admin.title')}
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
            title={t('admin.refreshData')}
            aria-label={t('admin.refreshData')}
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
                        ? 'bg-slate-950 text-amber-400 keep-dark-surface'
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
            <span>{t('admin.backToCms')}</span>
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
              title={t('admin.logout')}
              aria-label={t('admin.logout')}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Wrapper (md:pl-64 isolates sidebar offset from inner responsive padding) */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen min-w-0">
        <main className="flex-1 w-full p-4 sm:p-6 space-y-6">
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-400/30 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-300">
                  👑 {t('admin.title')}
                </span>
                {loading && !data ? (
                  <span
                    data-testid="admin-api-status"
                    className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 border border-sky-500/30 px-2.5 py-0.5 text-[10px] font-bold text-sky-300"
                  >
                    ● {tx('Đang đồng bộ...', 'Syncing...')}
                  </span>
                ) : loadError ? (
                  <span
                    data-testid="admin-api-status"
                    className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 border border-rose-500/40 px-2.5 py-0.5 text-[10px] font-bold text-rose-300"
                  >
                    ● {tx('Lỗi kết nối API', 'API connection error')}
                  </span>
                ) : isApiHealthy ? (
                  <span
                    data-testid="admin-api-status"
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300"
                  >
                    ● {tx('Trực tuyến', 'Online')}
                  </span>
                ) : (
                  <span
                    data-testid="admin-api-status"
                    className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-400/30 px-2.5 py-0.5 text-[10px] font-bold text-amber-300"
                  >
                    ● {tx('Chưa đồng bộ', 'Not synced')}
                  </span>
                )}
              </div>
              <h1 className="mt-1.5 text-xl sm:text-2xl font-black text-white">
                {NAV_TABS.find((tab) => tab.id === activeTab)?.label}
              </h1>
              <p className="text-xs text-slate-400">{t('admin.subtitle')}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AppLanguageSwitcher variant="dark" />
              <ThemeToggle />
              <Link
                href="/explore"
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:border-slate-600"
              >
                <Globe className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tx('Danh bạ Quán (/explore)', 'Directory (/explore)')}</span>
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
                <span>{t('admin.refreshData')}</span>
              </button>
            </div>
          </div>

          {/* Persistent Error State Card (when /api/admin fails) */}
          {loadError && (
            <div
              role="alert"
              data-testid="admin-error-state"
              className="rounded-3xl border border-rose-500/50 bg-rose-950/90 p-6 space-y-4 shadow-lg"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/20 text-rose-400">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-base font-black text-rose-200">
                      {tx(
                        'Không thể tải dữ liệu Quản trị',
                        'Could not load admin data'
                      )}
                    </h2>
                    <p className="text-xs font-bold text-rose-300 leading-relaxed">
                      {loadError}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {tx(
                        'Kiểm tra kết nối và thử tải lại.',
                        'Check your connection and try reloading.'
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={fetchAdminData}
                    disabled={loading || actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-300 disabled:opacity-50 shadow-sm"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                    />
                    <span>{tx('Thử tải lại', 'Retry')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-xs font-bold text-slate-200 hover:border-rose-400"
                  >
                    <LogOut className="h-3.5 w-3.5 text-rose-400" />
                    <span>{tx('Đăng nhập lại', 'Sign in again')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Persistent Loading State Card (while initial /api/admin request is in-flight) */}
          {loading && !data && !loadError && (
            <div
              role="status"
              data-testid="admin-loading-state"
              className="rounded-3xl border border-slate-800 bg-slate-900 p-6 space-y-5"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/15 text-amber-400">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white">
                    {tx(
                      'Đang tải dữ liệu quản trị...',
                      'Loading administration data...'
                    )}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {tx(
                      'Đang đồng bộ danh sách Chủ quán, Cửa hàng, Đơn hàng và trạng thái hệ thống.',
                      'Syncing shop owners, stores, orders, and system status.'
                    )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((skeletonId) => (
                  <div
                    key={skeletonId}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-2.5 animate-pulse"
                  >
                    <div className="h-3 w-28 rounded bg-slate-800" />
                    <div className="h-6 w-36 rounded bg-slate-800" />
                    <div className="h-2.5 w-24 rounded bg-slate-800" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================== TAB 1: EXECUTIVE OVERVIEW ==================== */}
          {activeTab === 'overview' && kpis && (
            <div className="space-y-6">
              {/* 4 Primary Executive KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-3xl border border-amber-500/30 bg-slate-900 p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400">
                      {tx('Doanh thu Gói cước & MRR', 'Plan Revenue & MRR')}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-400">
                      <CreditCard className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="text-2xl font-black text-amber-400">
                    {formatCurrency(kpis.totalSaasRevenue, 'VND')}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>{tx('MRR ước tính:', 'Estimated MRR:')}</span>
                    <strong className="text-white">
                      {formatCurrency(kpis.estimatedMrr, 'VND')}
                      {tx('/tháng', '/mo')}
                    </strong>
                  </div>
                </div>

                <div className="rounded-3xl border border-emerald-500/30 bg-slate-900 p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400">
                      {tx('Tổng GMV Đơn hàng Toàn sàn', 'Total Platform GMV')}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                      <TrendingUp className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="text-2xl font-black text-emerald-400">
                    {formatCurrency(kpis.globalMposGmv, 'VND')}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>
                      {tx('Hôm nay ({count} đơn):', 'Today ({count} orders):', {
                        count: kpis.totalOrders,
                      })}
                    </span>
                    <strong className="text-emerald-300">
                      +{formatCurrency(kpis.todayMposGmv, 'VND')}
                    </strong>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400">
                      {tx('Chủ Quán & Cửa Hàng', 'Shop Owners & Stores')}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15 text-sky-400">
                      <Store className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="text-2xl font-black text-white">
                    {tx('{shops} Quán', '{shops} Shops', {
                      shops: kpis.totalShops,
                    })}{' '}
                    <span className="text-sm font-bold text-slate-400">
                      / {tx('{owners} Chủ quán', '{owners} Owners', {
                        owners: kpis.totalOwners,
                      })}
                    </span>
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>
                      🍜 {kpis.verticalBreakdown.fnb} • 💆‍♀️{' '}
                      {kpis.verticalBreakdown.service} • 🛍️{' '}
                      {kpis.verticalBreakdown.retail}
                    </span>
                    <strong className="text-sky-300">
                      {tx('{count} món/dịch vụ', '{count} items', {
                        count: kpis.totalItems,
                      })}
                    </strong>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-400">
                      {tx('Lượt Quét QR Toàn Sàn', 'Total QR Scans')}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/15 text-purple-400">
                      <QrCode className="h-4 w-4" />
                    </span>
                  </div>
                  <p className="text-2xl font-black text-white">
                    {kpis.totalQrScans.toLocaleString(
                      locale === 'en' ? 'en-US' : 'vi-VN'
                    )}{' '}
                    {tx('lượt', 'scans')}
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                    <span>
                      {tx(
                        'Cửa: {door} • Bàn: {table}',
                        'Door: {door} • Table: {table}',
                        {
                          door: kpis.scanDoorCount,
                          table: kpis.scanTableCount,
                        }
                      )}
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
                        {tx('Phân Bổ Gói Cước Chủ Quán', 'Owner Plan Distribution')}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {tx(
                          'Tỷ lệ tài khoản Free vs Basic (39k) vs Premium (69k)',
                          'Free vs Basic (39k) vs Premium (69k) accounts'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('owners')}
                      className="text-xs font-bold text-amber-400 hover:underline"
                    >
                      {tx('Quản lý Chủ quán →', 'Manage Owners →')}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5 text-center">
                      <span className="text-[10px] font-black uppercase text-slate-400">
                        {tx('Gói FREE', 'FREE Plan')}
                      </span>
                      <p className="mt-1 text-2xl font-black text-white">
                        {kpis.planBreakdown.free}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {tx('0đ / tháng', '0đ / mo')}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-center">
                      <span className="text-[10px] font-black uppercase text-emerald-300">
                        {tx('Gói BASIC', 'BASIC Plan')}
                      </span>
                      <p className="mt-1 text-2xl font-black text-emerald-400">
                        {kpis.planBreakdown.basic}
                      </p>
                      <p className="text-[11px] text-emerald-300">
                        {tx('39.000đ / tháng', '39,000đ / mo')}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-center">
                      <span className="text-[10px] font-black uppercase text-amber-300">
                        {tx('Gói PREMIUM', 'PREMIUM Plan')}
                      </span>
                      <p className="mt-1 text-2xl font-black text-amber-400">
                        {kpis.planBreakdown.premium}
                      </p>
                      <p className="text-[11px] text-amber-300">
                        {tx('69.000đ / tháng', '69,000đ / mo')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Visitor Language Breakdown */}
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-white">
                        {tx(
                          'Ngôn Ngữ Khách Quét QR Toàn Sàn',
                          'Visitor Languages Across All Shops'
                        )}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {tx(
                          'Thống kê ngôn ngữ khách du lịch & nội địa sử dụng',
                          'Languages used by international & local guests'
                        )}
                      </p>
                    </div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                      <Globe className="h-4 w-4" />
                    </span>
                  </div>

                  {kpis.langBreakdown.length === 0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 flex items-center justify-between gap-3">
                      <span>
                        {tx(
                          'Chưa có dữ liệu ngôn ngữ khách quét QR.',
                          'No visitor language data yet.'
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={fetchAdminData}
                        disabled={loading || actionBusy}
                        className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-amber-400"
                      >
                        {t('common.refresh')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {kpis.langBreakdown.map((item) => (
                        <div key={item.lang} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-200">
                              {LANG_LABELS[item.lang]}
                            </span>
                            <span className="font-bold text-slate-400">
                              {tx(
                                '{count} sự kiện ({pct}%)',
                                '{count} events ({pct}%)',
                                { count: item.count, pct: item.percentage }
                              )}
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
                  )}
                </div>
              </div>

              {/* Third Row: Top Performing Shops & Live Activity Stream */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Top Shops Table */}
                <div className="lg:col-span-2 rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-white">
                        {tx(
                          'Bảng Xếp Hạng Cửa Hàng',
                          'Top Performing Shops'
                        )}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {tx(
                          'Bấm "Quản lý Quán" để hỗ trợ chủ quán ngay lập tức',
                          'Click "Manage Shop" to assist the shop owner'
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('shops')}
                      className="text-xs font-bold text-amber-400 hover:underline"
                    >
                      {tx('Xem tất cả ({count}) →', 'View all ({count}) →', {
                        count: data?.shops.length || 0,
                      })}
                    </button>
                  </div>

                  {(data?.shops || []).length === 0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 text-center space-y-3">
                      <p className="text-xs font-bold text-slate-300">
                        {tx(
                          'Chưa có cửa hàng nào trong danh sách.',
                          'No shops found.'
                        )}
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={fetchAdminData}
                          disabled={loading || actionBusy}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>{t('admin.refreshData')}</span>
                        </button>
                        <Link
                          href="/onboarding"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>{tx('Tạo Cửa Hàng Mới', 'New Shop')}</span>
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
                      <AppDataTable<EnrichedShop>
                        keyField="id"
                        ariaLabel={tx(
                          'Bảng Xếp Hạng Cửa Hàng',
                          'Top Performing Shops'
                        )}
                        columns={overviewShopColumns}
                        data={(data?.shops || []).slice(0, 6)}
                        dense
                      />
                    </div>
                  )}
                </div>

                {/* Live Event Stream */}
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-white">
                        {tx('Hoạt Động Gần Đây', 'Recent Activity')}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {tx(
                          'Khách quét QR & tương tác mới nhất',
                          'Latest QR scans & guest interactions'
                        )}
                      </p>
                    </div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                      <Activity className="h-4 w-4" />
                    </span>
                  </div>

                  {(data?.recentEvents || []).length === 0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 text-center space-y-2.5">
                      <p className="text-xs font-bold text-slate-300">
                        {tx(
                          'Chưa ghi nhận sự kiện quét QR nào.',
                          'No QR scan events recorded yet.'
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={fetchAdminData}
                        disabled={loading || actionBusy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:border-amber-400"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>{t('common.refresh')}</span>
                      </button>
                    </div>
                  ) : (
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
                              {tx('Sự kiện:', 'Event:')}{' '}
                              <strong className="text-emerald-300">
                                {ev.event_type}
                              </strong>{' '}
                              • {tx('Ngôn ngữ:', 'Lang:')}{' '}
                              <strong className="uppercase text-amber-300">
                                {ev.visitor_lang}
                              </strong>
                            </p>
                          </div>
                          <span className="text-[10px] text-slate-500 whitespace-nowrap">
                            {new Date(ev.created_at).toLocaleTimeString(
                              locale === 'en' ? 'en-US' : 'vi-VN',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 2: OWNERS & PLANS ==================== */}
          {activeTab === 'owners' && data && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-1 items-center gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={ownerSearch}
                      onChange={(e) => setOwnerSearch(e.target.value)}
                      placeholder={tx(
                        'Tìm Chủ quán theo email, tên, SĐT...',
                        'Search owners by email, name, phone...'
                      )}
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
                    <option value="all">
                      {tx('Tất cả gói ({count})', 'All plans ({count})', {
                        count: data.owners.length || 0,
                      })}
                    </option>
                    <option value="free">{tx('Gói Free', 'Free Plan')}</option>
                    <option value="basic">
                      {tx('Gói Basic (39k)', 'Basic Plan (39k)')}
                    </option>
                    <option value="premium">
                      {tx('Gói Premium (69k)', 'Premium Plan (69k)')}
                    </option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCreateOwner((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
                >
                  <Plus className="h-4 w-4" />
                  <span>{tx('Tạo Chủ Quán Mới', 'New Owner Account')}</span>
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
                      ➕ {tx('Cấp Tài Khoản Chủ Quán Mới', 'Create Owner Account')}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowCreateOwner(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      {t('common.close')}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <input
                      type="email"
                      required
                      value={newOwnerEmail}
                      onChange={(e) => setNewOwnerEmail(e.target.value)}
                      placeholder={tx('Email chủ quán *', 'Owner email *')}
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                    />
                    <input
                      type="text"
                      required
                      value={newOwnerName}
                      onChange={(e) => setNewOwnerName(e.target.value)}
                      placeholder={tx('Họ và tên *', 'Full name *')}
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                    />
                    <input
                      type="text"
                      value={newOwnerPhone}
                      onChange={(e) => setNewOwnerPhone(e.target.value)}
                      placeholder={tx('Số điện thoại / Zalo', 'Phone / Zalo')}
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                    />
                    <input
                      type="text"
                      value={newOwnerPassword}
                      onChange={(e) => setNewOwnerPassword(e.target.value)}
                      placeholder={tx(
                        'Mật khẩu (mặc định: qlaok123456)',
                        'Password (default: qlaok123456)'
                      )}
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
                        {t('common.create')}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Owners Table */}
              <div className="rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
                <AppDataTable<EnrichedOwner>
                  keyField="id"
                  ariaLabel={tx('Danh sách Chủ quán', 'Shop Owners List')}
                  columns={ownerColumns}
                  data={filteredOwners}
                  pagination
                  paginationPerPage={10}
                  paginationRowsPerPageOptions={[10, 20, 50]}
                  noDataComponent={
                    <div className="py-8 px-4 text-center">
                      <div className="max-w-md mx-auto space-y-2.5">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {ownerSearch || ownerPlanFilter !== 'all'
                            ? tx(
                                'Không tìm thấy tài khoản Chủ quán nào khớp với bộ lọc.',
                                'No shop owner accounts match the filters.'
                              )
                            : tx(
                                'Chưa có tài khoản Chủ quán nào.',
                                'No shop owner accounts yet.'
                              )}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {(ownerSearch || ownerPlanFilter !== 'all') && (
                            <button
                              type="button"
                              onClick={() => {
                                setOwnerSearch('');
                                setOwnerPlanFilter('all');
                              }}
                              className="rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:border-amber-400"
                            >
                              {t('common.clearFilters')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={fetchAdminData}
                            disabled={loading || actionBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>{t('admin.refreshData')}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          )}

          {/* ==================== TAB 3: ALL SHOPS & IMPERSONATION ==================== */}
          {activeTab === 'shops' && data && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-1 items-center gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={shopSearch}
                      onChange={(e) => setShopSearch(e.target.value)}
                      placeholder={tx(
                        'Tìm theo tên quán, slug, email chủ quán, tỉnh thành...',
                        'Search by shop name, slug, owner email, city...'
                      )}
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
                    <option value="all">
                      {tx('Tất cả ngành ({count})', 'All categories ({count})', {
                        count: data.shops.length || 0,
                      })}
                    </option>
                    <option value="fnb">
                      {tx('🍜 Ẩm thực / Cafe', '🍜 Food & Cafe')}
                    </option>
                    <option value="service">
                      {tx('💆‍♀️ Spa / Dịch vụ', '💆‍♀️ Spa & Services')}
                    </option>
                    <option value="retail">
                      {tx('🛍️ Bán lẻ / Đặc sản', '🛍️ Retail & Souvenirs')}
                    </option>
                  </select>
                </div>

                <Link
                  href="/onboarding"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
                >
                  <Plus className="h-4 w-4" />
                  <span>{tx('Tạo Cửa Hàng Mới', 'New Shop')}</span>
                </Link>
              </div>

              {filteredShops.length === 0 ? (
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center space-y-3">
                  <p className="text-xs font-bold text-slate-300">
                    {shopSearch || shopVerticalFilter !== 'all'
                      ? tx(
                          'Không tìm thấy cửa hàng nào khớp với bộ lọc.',
                          'No shops match the filters.'
                        )
                      : tx(
                          'Chưa có cửa hàng nào được khởi tạo.',
                          'No shops created yet.'
                        )}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {(shopSearch || shopVerticalFilter !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setShopSearch('');
                          setShopVerticalFilter('all');
                        }}
                        className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-amber-400"
                      >
                        {t('common.clearFilters')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={fetchAdminData}
                      disabled={loading || actionBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>{t('admin.refreshData')}</span>
                    </button>
                  </div>
                </div>
              ) : (
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
                                  {tx('Đang ẩn', 'Hidden')}
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  {tx('Đang hiển thị', 'Published')}
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1 text-base font-black text-white">
                              {shop.name}
                            </h3>
                            <p className="text-xs text-slate-400">
                              Slug:{' '}
                              <code className="text-amber-300">
                                /s/{shop.slug}
                              </code>{' '}
                              • {tx('Chủ quán:', 'Owner:')}{' '}
                              <strong className="text-slate-200">
                                {shop.ownerEmail}
                              </strong>
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 rounded-2xl bg-slate-950 p-3 border border-slate-800 text-center">
                          <div>
                            <span className="block text-[10px] text-slate-500">
                              {tx('Danh mục', 'Categories')}
                            </span>
                            <span className="text-xs font-black text-white">
                              {shop.categoriesCount}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">
                              {tx('Món/DV', 'Items')}
                            </span>
                            <span className="text-xs font-black text-white">
                              {shop.itemsCount}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">
                              {tx('Đơn hàng', 'Orders')}
                            </span>
                            <span className="text-xs font-black text-amber-300">
                              {shop.ordersCount}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">
                              {tx('Doanh thu', 'GMV')}
                            </span>
                            <span className="text-xs font-black text-emerald-400">
                              {formatCurrency(
                                shop.shopGmv,
                                shop.currency || 'VND'
                              )}
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
                            <span>
                              {tx('Quản trị thay Chủ quán', 'Manage Shop')}
                            </span>
                          </button>

                          <a
                            href={`/s/${shop.slug}/menu?src=table`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs font-bold text-slate-200 hover:border-emerald-400"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-emerald-400" />
                            <span>{tx('QR Bàn', 'Table QR')}</span>
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
                                tx(
                                  'Đã cập nhật hiển thị quán {name}',
                                  'Updated visibility for {name}',
                                  { name: shop.name }
                                )
                              )
                            }
                            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white"
                            title={
                              shop.is_published === false
                                ? tx('Bật hiển thị công khai', 'Publish shop')
                                : tx('Tạm ẩn cửa hàng', 'Hide shop')
                            }
                            aria-label={
                              shop.is_published === false
                                ? tx('Bật hiển thị công khai', 'Publish shop')
                                : tx('Tạm ẩn cửa hàng', 'Hide shop')
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
                                  tx(
                                    'Xóa vĩnh viễn cửa hàng "{name}" và toàn bộ menu của quán này?',
                                    'Permanently delete shop "{name}" and all its menu items?',
                                    { name: shop.name }
                                  )
                                )
                              ) {
                                runAdminAction(
                                  {
                                    action: 'delete_shop',
                                    shopId: shop.id,
                                  },
                                  tx(
                                    'Đã xóa cửa hàng {name}',
                                    'Deleted shop {name}',
                                    { name: shop.name }
                                  )
                                );
                              }
                            }}
                            className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20"
                            title={tx('Xóa cửa hàng', 'Delete shop')}
                            aria-label={tx('Xóa cửa hàng', 'Delete shop')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 4: GLOBAL ORDERS & INVENTORY ==================== */}
          {activeTab === 'orders' && data && (
            <div className="space-y-6">
              {/* Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      'all',
                      'new',
                      'preparing',
                      'completed',
                      'cancelled',
                    ] as const
                  ).map((st) => (
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
                        ? tx('Tất cả đơn', 'All orders')
                        : st === 'new'
                          ? tx('🔔 Đơn mới', '🔔 New')
                          : st === 'preparing'
                            ? tx('🍳 Đang chế biến', '🍳 Preparing')
                            : st === 'completed'
                              ? tx('✅ Hoàn tất', '✅ Completed')
                              : tx('❌ Đã hủy', '❌ Cancelled')}
                    </button>
                  ))}
                </div>

                <select
                  value={orderShopFilter}
                  onChange={(e) => setOrderShopFilter(e.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                >
                  <option value="all">
                    {tx('Tất cả cửa hàng', 'All shops')}
                  </option>
                  {(data.shops || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Low Stock Alert Banner across all shops */}
              {(data.lowStockItems.length || 0) > 0 && (
                <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-black text-amber-300">
                    <PackageCheck className="h-4 w-4" />
                    <span>
                      {tx(
                        'Cảnh báo tồn kho toàn sàn ({count} món sắp hết / hết hàng)',
                        'Low stock alert across shops ({count} items low or sold out)',
                        { count: data.lowStockItems.length }
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(data.lowStockItems || []).map((item) => (
                      <span
                        key={item.id}
                        className="rounded-xl border border-amber-500/30 bg-slate-950 px-3 py-1 text-[11px] font-semibold text-slate-200"
                      >
                        <strong>{item.shopName}:</strong> {item.name_i18n.vi}{' '}
                        ({tx('Còn', 'Left')}{' '}
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
                <AppDataTable<EnrichedOrder>
                  keyField="id"
                  ariaLabel={tx('Danh sách đơn hàng toàn sàn', 'Global Orders List')}
                  columns={orderColumns}
                  data={filteredOrders}
                  pagination
                  paginationPerPage={10}
                  paginationRowsPerPageOptions={[10, 20, 50]}
                  noDataComponent={
                    <div className="py-8 px-4 text-center">
                      <div className="max-w-md mx-auto space-y-2.5">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {orderStatusFilter !== 'all' ||
                          orderShopFilter !== 'all'
                            ? tx(
                                'Không có đơn hàng nào khớp với bộ lọc.',
                                'No orders match the filters.'
                              )
                            : tx(
                                'Chưa có đơn hàng nào trên hệ thống.',
                                'No orders recorded yet.'
                              )}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {(orderStatusFilter !== 'all' ||
                            orderShopFilter !== 'all') && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderStatusFilter('all');
                                setOrderShopFilter('all');
                              }}
                              className="rounded-xl border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:border-amber-400"
                            >
                              {t('common.clearFilters')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={fetchAdminData}
                            disabled={loading || actionBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>{t('admin.refreshData')}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          )}

          {/* ==================== TAB 5: PLAN BILLING & VIETQR TRANSACTIONS ==================== */}
          {activeTab === 'billing' && data && (
            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-white">
                    {tx(
                      'Giao Dịch Nâng Cấp Gói (VietQR)',
                      'Plan Upgrade Transactions (VietQR)'
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {tx(
                      'Duyệt nhanh giao dịch chuyển khoản nâng cấp gói Basic (39.000đ) và Premium (69.000đ)',
                      'Approve bank transfer transactions for Basic (39,000đ) and Premium (69,000đ) plans'
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="block text-[10px] font-bold uppercase text-slate-400">
                      {tx('Tổng thu gói cước', 'Total plan revenue')}
                    </span>
                    <span className="text-lg font-black text-amber-400">
                      {formatCurrency(kpis?.totalSaasRevenue || 0, 'VND')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
                <AppDataTable<EnrichedTransaction>
                  keyField="id"
                  ariaLabel={tx(
                    'Giao Dịch Nâng Cấp Gói (VietQR)',
                    'Plan Upgrade Transactions (VietQR)'
                  )}
                  columns={transactionColumns}
                  data={data.transactions || []}
                  pagination
                  paginationPerPage={10}
                  paginationRowsPerPageOptions={[10, 20, 50]}
                  noDataComponent={
                    <div className="py-8 px-4 text-center">
                      <div className="max-w-md mx-auto space-y-2.5">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {tx(
                            'Chưa có giao dịch nâng cấp gói cước nào.',
                            'No plan upgrade transactions recorded yet.'
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={fetchAdminData}
                          disabled={loading || actionBusy}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>{t('admin.refreshData')}</span>
                        </button>
                      </div>
                    </div>
                  }
                />
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
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                        <Database className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-black text-white">
                          {tx('Cơ Sở Dữ Liệu Đám Mây', 'Cloud Database')}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {tx(
                            'Đồng bộ dữ liệu cho toàn bộ cửa hàng',
                            'Data synchronization across all stores'
                          )}
                        </p>
                      </div>
                    </div>
                    {data.systemHealth.supabaseConnected ? (
                      <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-black text-emerald-300">
                        ONLINE
                      </span>
                    ) : (
                      <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2.5 py-0.5 text-[10px] font-black text-rose-300">
                        OFFLINE
                      </span>
                    )}
                  </div>

                  {Object.keys(data.systemHealth.tableCounts || {}).length ===
                  0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400 flex items-center justify-between gap-3">
                      <span>
                        {tx(
                          'Chưa có thống kê số bản ghi các bảng.',
                          'No table record counts available yet.'
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={fetchAdminData}
                        disabled={loading || actionBusy}
                        className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-amber-400"
                      >
                        {t('common.refresh')}
                      </button>
                    </div>
                  ) : (
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
                  )}

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      {tx(
                        'Khôi phục 3 cửa hàng Demo gốc (không xóa quán của khách)',
                        'Restore 3 default demo shops (keeps customer shops)'
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() =>
                        runAdminAction(
                          { action: 'reseed_demo_data' },
                          tx(
                            'Đã đồng bộ lại dữ liệu 3 cửa hàng Demo mẫu!',
                            'Restored 3 default demo shops!'
                          )
                        )
                      }
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      {tx('Khôi phục dữ liệu mẫu', 'Restore Demo Data')}
                    </button>
                  </div>
                </div>

                {/* AI Service Status & Live Tester */}
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-400">
                        <Cpu className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-black text-white">
                          {tx(
                            'Dịch Thuật & Quét Thực Đơn Tự Động',
                            'Auto Translation & Menu OCR'
                          )}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {tx(
                            'Nhận diện thực đơn & dịch tự động đa ngôn ngữ',
                            'Menu OCR & multilingual auto-translation'
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-400/20 border border-amber-400/30 px-2.5 py-0.5 text-[10px] font-black text-amber-300">
                      READY
                    </span>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-300">
                      {tx(
                        'Thử nghiệm dịch tự động:',
                        'Test auto-translation:'
                      )}
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
                        {aiTestLoading
                          ? tx('Đang dịch...', 'Translating...')
                          : tx('Thử dịch', 'Test')}
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
