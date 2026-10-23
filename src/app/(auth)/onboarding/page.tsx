'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Store,
  Wifi,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  UtensilsCrossed,
  Scissors,
  ShoppingBag,
} from 'lucide-react';
import { BusinessVertical, Profile } from '@/types/qlaok';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { getAuthHeaders, getStoredAuthOwner } from '@/lib/auth-session';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { BrandLogo } from '@/components/ui/BrandLogo';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';
import {
  executeOnboardingCompletion,
  formatOnboardingBulkImportError,
  type OnboardingDraftShop,
} from '@/lib/onboarding-flow';

export default function OnboardingWizardPage() {
  const router = useRouter();
  const { locale, t, tx } = useAppI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [ownerProfile, setOwnerProfile] = useState<Profile | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Step 1: Vertical & Name
  const [vertical, setVertical] = useState<BusinessVertical>('fnb');
  const [shopName, setShopName] = useState('');
  const [taglineVi, setTaglineVi] = useState('');

  // Step 2: Location & Wi-Fi
  const [city, setCity] = useState('Đà Nẵng');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');

  // Step 3: First Signature Item
  const [categoryVi, setCategoryVi] = useState('Món Đặc Trưng');
  const [firstItemNameVi, setFirstItemNameVi] = useState('Bạc xỉu đá');
  const [firstItemPrice, setFirstItemPrice] = useState('35000');

  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdDraftShop, setCreatedDraftShop] =
    useState<OnboardingDraftShop | null>(null);
  const [catalogImportServerError, setCatalogImportServerError] = useState<
    string | null
  >(null);
  const [catalogImportFailed, setCatalogImportFailed] = useState(false);
  // Guard against silently creating duplicate stores for users who already
  // own or belong to a shop.
  const [existingShops, setExistingShops] = useState<{
    owned: number;
    member: number;
  } | null>(null);

  useEffect(() => {
    const owner = getStoredAuthOwner();
    if (!owner) {
      router.replace('/login?mode=register');
      return;
    }
    setOwnerProfile(owner);
    if (owner.phone) {
      setPhone(owner.phone);
    }
    let cancelled = false;
    const wantsNewBranch =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('intent') === 'new_branch';
    (async () => {
      try {
        const res = await fetch(
          `/api/shops?ownerId=${encodeURIComponent(owner.id)}`,
          { headers: getAuthHeaders(), cache: 'no-store' }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            shops?: Array<{ id: string; owner_id?: string }>;
          };
          const shops = data.shops || [];
          const owned = shops.filter((s) => s.owner_id === owner.id).length;
          const member = shops.length - owned;
          if (!cancelled && shops.length > 0 && !(wantsNewBranch && owned > 0)) {
            setExistingShops({ owned, member });
          }
        }
      } catch {
        // Network failure: fall through to the wizard; the user must still
        // submit explicitly, so no store is created silently.
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSelectVertical = (v: BusinessVertical) => {
    setVertical(v);
    if (v === 'fnb') {
      setCategoryVi('Món Đặc Trưng');
      setFirstItemNameVi('Bạc xỉu đá');
      setFirstItemPrice('35000');
    } else if (v === 'service') {
      setCategoryVi('Dịch Vụ Nổi Bật');
      setFirstItemNameVi('Gội đầu dưỡng sinh thảo dược');
      setFirstItemPrice('150000');
    } else {
      setCategoryVi('Sản Phẩm Bán Chạy');
      setFirstItemNameVi('Trà sâm dứa Hội An');
      setFirstItemPrice('95000');
    }
  };

  const submitOnboardingFlow = async () => {
    if (!shopName.trim()) {
      setCatalogImportFailed(false);
      setCatalogImportServerError(null);
      setErrorMsg(
        tx('Vui lòng nhập tên cửa hàng.', 'Please enter store name.')
      );
      setStep(1);
      return;
    }

    setCreating(true);
    setErrorMsg('');
    setCatalogImportFailed(false);
    setCatalogImportServerError(null);

    try {
      const result = await executeOnboardingCompletion({
        locale,
        ownerId: ownerProfile?.id,
        ownerPhone: ownerProfile?.phone,
        vertical,
        shopName,
        taglineVi,
        city,
        address,
        phone,
        wifiSsid,
        wifiPassword,
        categoryVi,
        firstItemNameVi,
        firstItemPrice,
        existingDraftShop: createdDraftShop,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        onDraftShopSaved: (draftShop) => {
          setCreatedDraftShop(draftShop);
          if (typeof window !== 'undefined' && draftShop.id) {
            localStorage.setItem('qlaok_active_shop_id', draftShop.id);
          }
        },
      });

      if (!result.ok) {
        if (result.draftShop) {
          setCreatedDraftShop(result.draftShop);
        }
        if (result.stage === 'catalog_import') {
          setCatalogImportFailed(true);
          setCatalogImportServerError(result.serverError);
        } else if (
          result.stage === 'validation' &&
          !shopName.trim() &&
          !result.draftShop
        ) {
          setStep(1);
        }
        setErrorMsg(result.errorMessage);
        return;
      }

      if (typeof window !== 'undefined' && result.draftShop?.id) {
        localStorage.setItem('qlaok_active_shop_id', result.draftShop.id);
      }

      if (result.redirectHref) {
        router.push(result.redirectHref);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitOnboardingFlow();
  };

  const activeErrorMessage =
    catalogImportFailed && createdDraftShop
      ? formatOnboardingBulkImportError({
          locale,
          shopName: createdDraftShop.name || shopName,
          serverError: catalogImportServerError,
        })
      : errorMsg;

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-xs font-bold text-slate-400">
          {tx('Đang kiểm tra tài khoản...', 'Checking account...')}
        </p>
      </div>
    );
  }

  if (existingShops) {
    return (
      <div
        data-testid="onboarding-existing-shops"
        className="min-h-screen bg-slate-950 text-white theme-surface-page flex flex-col justify-center items-center p-4"
      >
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-5 text-center">
          <Store className="mx-auto h-10 w-10 text-emerald-400" />
          <h1 className="text-xl font-black">
            {tx('Bạn đã có cửa hàng', 'You already have a store')}
          </h1>
          <p className="text-xs text-slate-400">
            {existingShops.owned > 0
              ? tx(
                  'Tài khoản của bạn đang quản lý {count} cửa hàng. Bạn muốn vào trang quản lý hay tạo thêm chi nhánh mới?',
                  'Your account already manages {count} store(s). Go to your dashboard or create another branch?',
                  { count: existingShops.owned + existingShops.member }
                )
              : tx(
                  'Tài khoản của bạn đã được thêm làm nhân viên của {count} cửa hàng.',
                  'Your account is already a staff member of {count} store(s).',
                  { count: existingShops.member }
                )}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              data-testid="onboarding-go-dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400"
            >
              <span>{tx('Vào trang quản lý', 'Go to dashboard')}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            {existingShops.owned > 0 && (
              <button
                type="button"
                onClick={() => setExistingShops(null)}
                data-testid="onboarding-create-branch"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                {tx('Tạo thêm chi nhánh', 'Create another branch')}
              </button>
            )}
            {existingShops.owned === 0 && existingShops.member > 0 && (
              <button
                type="button"
                onClick={() => setExistingShops(null)}
                data-testid="onboarding-create-own-shop"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-5 py-3 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                {tx('Tạo cửa hàng riêng', 'Create your own store')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white theme-surface-page flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-xl flex items-center justify-end gap-2 mb-2">
        <AppLanguageSwitcher variant="dark" />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Top Progress Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-300 hover:text-white"
          >
            <BrandLogo className="h-7 w-7 rounded-lg" />
            <span>{t('onboarding.title')}</span>
          </Link>

          <div className="flex items-center gap-1.5">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={`h-2 w-8 rounded-full transition-colors ${
                  step >= s ? 'bg-emerald-500' : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        {activeErrorMessage && (
          <div
            role="alert"
            data-testid="onboarding-error-banner"
            className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs font-bold text-rose-300 space-y-2.5"
          >
            <p>⚠️ {activeErrorMessage}</p>
            {catalogImportFailed && createdDraftShop && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => void submitOnboardingFlow()}
                  disabled={creating}
                  data-testid="onboarding-retry-catalog-import"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {creating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {tx(
                      'Thử nhập lại món đầu tiên',
                      'Retry importing first item'
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 1: Vertical & Store Name */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {tx('Bước 1 / 3', 'Step 1 / 3')}
              </span>
              <h1 className="text-xl sm:text-2xl font-black mt-1">
                {tx(
                  'Chọn ngành hàng & tên quán',
                  'Choose category & store name'
                )}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {t('onboarding.subtitle')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'fnb' as BusinessVertical,
                  icon: UtensilsCrossed,
                  title: tx('Ẩm thực (F&B)', 'Food & Beverage'),
                  desc: tx(
                    'Quán ăn, nhà hàng, cafe, trà sữa',
                    'Restaurants, cafes, bubble tea, bars'
                  ),
                },
                {
                  id: 'service' as BusinessVertical,
                  icon: Scissors,
                  title: tx('Dịch vụ & Spa', 'Spa & Services'),
                  desc: tx(
                    'Nail, spa, gội đầu dưỡng sinh, salon',
                    'Nail salons, spas, massage, hair salons'
                  ),
                },
                {
                  id: 'retail' as BusinessVertical,
                  icon: ShoppingBag,
                  title: tx('Bán lẻ & Đặc sản', 'Retail & Specialty'),
                  desc: tx(
                    'Quà lưu niệm, đặc sản, tạp hóa',
                    'Souvenirs, local specialties, minimarts'
                  ),
                },
              ].map((v) => {
                const Icon = v.icon;
                const active = vertical === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleSelectVertical(v.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      active
                        ? 'border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <Icon
                      className={`h-6 w-6 mb-2 ${
                        active ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    />
                    <h3 className="text-xs font-extrabold text-white">
                      {v.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                      {v.desc}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {t('onboarding.shopNameLabel')} *
                </label>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder={tx(
                    'VD: Bún Chả Cô Ba, Mộc Spa, Đặc Sản Hội An...',
                    'e.g., Co Ba Noodle, Moc Spa, Hoi An Gifts...'
                  )}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm font-bold text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {tx('Lời giới thiệu ngắn (tùy chọn)', 'Short tagline (optional)')}
                </label>
                <input
                  type="text"
                  value={taglineVi}
                  onChange={(e) => setTaglineVi(e.target.value)}
                  placeholder={tx(
                    'VD: Hương vị truyền thống từ 1995...',
                    'e.g., Traditional flavors since 1995...'
                  )}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!shopName.trim()) {
                    setErrorMsg(
                      tx(
                        'Vui lòng nhập tên cửa hàng trước khi tiếp tục.',
                        'Please enter your store name to continue.'
                      )
                    );
                    return;
                  }
                  setErrorMsg('');
                  setStep(2);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400"
              >
                <span>{tx('Tiếp tục bước 2', 'Next: Step 2')}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Wi-Fi & Address */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {tx('Bước 2 / 3', 'Step 2 / 3')}
              </span>
              <h2 className="text-xl sm:text-2xl font-black mt-1">
                {tx('Địa chỉ & Wi-Fi cho khách', 'Address & Guest Wi-Fi')}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {tx(
                  'Khách quét mã QR có thể chép mật khẩu Wi-Fi ngay với 1 chạm.',
                  'Guests scanning your QR can copy the Wi-Fi password in one tap.'
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {t('onboarding.cityLabel')}
                </label>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-white"
                >
                  {VIETNAM_PROVINCES_34.map((prov) => (
                    <option key={prov.code} value={prov.name}>
                      {prov.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {t('onboarding.phoneLabel')}
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0905123456"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                {tx('Địa chỉ chi tiết', 'Street address')}
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={tx(
                  'VD: 128 Trần Phú, Hải Châu...',
                  'e.g., 128 Tran Phu St...'
                )}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <div>
                <label className="block text-xs font-bold text-emerald-400 mb-1">
                  📶 {t('onboarding.wifiNameLabel')}
                </label>
                <input
                  type="text"
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  placeholder="QuanNgon_Free5G"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-emerald-400 mb-1">
                  🔑 {t('onboarding.wifiPassLabel')}
                </label>
                <input
                  type="text"
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  placeholder="88888888"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono font-bold text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{t('common.back')}</span>
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-xs font-black text-slate-950 hover:bg-emerald-400"
              >
                <span>{tx('Tiếp tục bước 3', 'Next: Step 3')}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: First Item with AI Auto Translation */}
        {step === 3 && (
          <form onSubmit={handleCompleteOnboarding} className="space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {tx('Bước 3 / 3 • Hoàn tất', 'Step 3 / 3 • Finish')}
              </span>
              <h2 className="text-xl sm:text-2xl font-black mt-1">
                {tx('Thêm món / dịch vụ đầu tiên', 'Add your first item')}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {tx(
                  'Nhập tên Tiếng Việt, hệ thống sẽ tự dịch đa ngôn ngữ và tạo bộ mã QR cho quán.',
                  'Enter the Vietnamese item name to auto-translate and generate your store QR codes.'
                )}
              </p>
            </div>

            {createdDraftShop && (
              <div
                data-testid="onboarding-draft-preserved"
                className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200 space-y-1"
              >
                <p className="font-extrabold flex items-center gap-1.5 text-emerald-300">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>
                    {tx(
                      'Đã lưu quán nháp "{name}" (chưa công khai)',
                      'Draft store "{name}" saved (unpublished)',
                      { name: createdDraftShop.name || shopName.trim() }
                    )}
                  </span>
                </p>
                <p className="text-[11px] text-slate-300">
                  {tx(
                    'Khi thử lại, hệ thống sẽ giữ nguyên quán nháp này và chỉ nhập lại món đầu tiên, không tạo trùng cửa hàng.',
                    'Retrying will keep this draft store and only re-import the first item without creating a duplicate store.'
                  )}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  {tx('Danh mục đầu tiên', 'First category')}
                </label>
                <input
                  type="text"
                  value={categoryVi}
                  onChange={(e) => setCategoryVi(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    {tx(
                      'Tên món / dịch vụ (Tiếng Việt) *',
                      'Item / service name (Vietnamese) *'
                    )}
                  </label>
                  <input
                    type="text"
                    value={firstItemNameVi}
                    onChange={(e) => setFirstItemNameVi(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    {tx('Giá bán (VNĐ) *', 'Price (VND) *')}
                  </label>
                  <input
                    type="number"
                    value={firstItemPrice}
                    onChange={(e) => setFirstItemPrice(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-emerald-400"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={Boolean(createdDraftShop) || creating}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{t('common.back')}</span>
              </button>

              <button
                type="submit"
                disabled={creating}
                data-testid="onboarding-submit-step3"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-xs font-black text-slate-950 shadow-lg hover:bg-emerald-400 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {createdDraftShop
                        ? tx(
                            'Đang nhập lại món đầu tiên...',
                            'Retrying first item import...'
                          )
                        : tx(
                            'Đang tạo quán & mã QR...',
                            'Creating store & QR codes...'
                          )}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>
                      {createdDraftShop
                        ? tx(
                            'Thử nhập lại món đầu tiên',
                            'Retry importing first item'
                          )
                        : t('onboarding.submitButton')}
                    </span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
