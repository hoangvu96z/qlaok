'use client';

import { appLanguageName } from '@/lib/app-i18n';

import React, { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Save,
  Wifi,
  Clock,
  MapPin,
  Palette,
  Languages,
  Check,
  Store,
  Image as ImageIcon,
  Sparkles,
  Upload,
  LayoutGrid,
  List,
  ExternalLink,
  Zap,
  ArrowRight,
  Smartphone,
  QrCode,
  Landmark,
  CreditCard,
  Printer,
  Users,
  Loader2,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { getAuthHeaders, isSuperAdminEmail } from '@/lib/auth-session';
import {
  BusinessVertical,
  CatalogItem,
  OpeningHours,
  ShopPaymentConfig,
  ShopThemeConfig,
  ServiceRequestNotificationRule,
  SupportedLocale,
  PlanTier,
} from '@/types/qlaok';
import { ALL_LOCALES } from '@/lib/i18n-helper';
import {
  applyOpeningHoursConfirmationToggle,
  applyOpeningHoursScheduleChange,
  buildOpeningHoursSettingsPatch,
  createInitialOpeningHoursSettingsState,
  hasConfirmedOpeningHours,
  normalizeShopSlugInput,
  requiresSlugChangeConfirmation,
} from '@/lib/shop-setup-checklist';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { StorefrontWelcomePopup } from '@/components/storefront/StorefrontCustomDecor';
import { RightPreviewSidebar } from '@/components/dashboard/RightPreviewSidebar';
import { ShopMembersManager } from '@/components/dashboard/ShopMembersManager';
import { ShopOrderWorkflowEditor } from '@/components/dashboard/ShopOrderWorkflowEditor';
import { ShopLabelPrintSettingsEditor } from '@/components/dashboard/ShopLabelPrintSettingsEditor';
import { ShopSePayWebhookManager } from '@/components/dashboard/ShopSePayWebhookManager';
import { WeeklyOpeningHoursPicker } from '@/components/ui/TimeSchedulePicker';
import { uploadCompressedImage } from '@/lib/upload-helper';
import {
  VIETQR_BANKS,
  getShopPaymentQrInfo,
  stripVietnameseAccents,
} from '@/lib/payment-qr';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { PLAN_CONFIGS, normalizePlanTier } from '@/lib/plan-limits';
import { PlanUpgradeDialog } from '@/components/ui/PlanUpgradeDialog';
import {
  FeedbackToast,
  type FeedbackToastMessage,
} from '@/components/ui/FeedbackToast';

// Pure color swatches — no text labels needed
const BRAND_COLOR_SWATCHES = [
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#0ea5e9', // Sky
  '#ec4899', // Pink
  '#92400e', // Coffee Brown
  '#1e293b', // Slate Luxury
];

const BACKGROUND_IMAGE_PRESETS = [
  {
    labelVi: 'Phố Cổ',
    labelEn: 'Old Town',
    url: 'https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?w=1000&auto=format&fit=crop&q=80',
  },
  {
    labelVi: 'Gỗ Ấm',
    labelEn: 'Warm Wood',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1000&auto=format&fit=crop&q=80',
  },
  {
    labelVi: 'Quán Cà Phê',
    labelEn: 'Cozy Cafe',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1000&auto=format&fit=crop&q=80',
  },
  {
    labelVi: 'Spa Thảo Mộc',
    labelEn: 'Herbal Spa',
    url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1000&auto=format&fit=crop&q=80',
  },
  {
    labelVi: 'Ẩm Thực Việt',
    labelEn: 'Vietnamese',
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&auto=format&fit=crop&q=80',
  },
  {
    labelVi: 'Đặc Sản',
    labelEn: 'Specialties',
    url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=1000&auto=format&fit=crop&q=80',
  },
];

type SettingsTabId =
  | 'store-info'
  | 'appearance'
  | 'payments'
  | 'orders'
  | 'staff';

interface SettingsTabItem {
  id: SettingsTabId;
  labelVi: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_TABS: SettingsTabItem[] = [
  {
    id: 'store-info',
    labelVi: 'Thông tin quán',
    labelEn: 'Store information',
    icon: Store,
  },
  {
    id: 'appearance',
    labelVi: 'Giao diện',
    labelEn: 'Appearance',
    icon: Palette,
  },
  {
    id: 'payments',
    labelVi: 'Thanh toán',
    labelEn: 'Payments',
    icon: CreditCard,
  },
  {
    id: 'orders',
    labelVi: 'Quy trình & In ấn',
    labelEn: 'Orders & printing',
    icon: Printer,
  },
  {
    id: 'staff',
    labelVi: 'Nhân viên',
    labelEn: 'Staff',
    icon: Users,
  },
];

const SETTINGS_HASH_TO_TAB: Record<string, SettingsTabId> = {
  // Deep-link target hashes
  'payment-qr-settings': 'payments',
  'opening-hours-settings': 'store-info',
  'order-workflow-settings': 'orders',
  'label-print-settings': 'orders',
  // Direct tab name hashes
  'store-info': 'store-info',
  'appearance': 'appearance',
  'payments': 'payments',
  'orders': 'orders',
  'staff': 'staff',
};

function resolveSettingsTabFromHash(hash: string): SettingsTabId | null {
  const clean = hash.replace(/^#/, '').trim();
  return SETTINGS_HASH_TO_TAB[clean] || null;
}

export default function DashboardSettingsPage() {
  const { activeShop, profile, updateActiveShop, refreshDashboard } = useDashboard();
  const { locale, t, tx } = useAppI18n();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [vertical, setVertical] = useState<BusinessVertical>('fnb');
  const [taglineVi, setTaglineVi] = useState('');
  const [descVi, setDescVi] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Đà Nẵng');
  const [phoneContact, setPhoneContact] = useState('');
  const [zaloPhone, setZaloPhone] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');

  // Storefront Theme & Background
  const [primaryColor, setPrimaryColor] = useState('#10b981');
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>('list');
  const [backgroundStyle, setBackgroundStyle] =
    useState<NonNullable<ShopThemeConfig['backgroundStyle']>>('clean');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [backgroundOverlayOpacity, setBackgroundOverlayOpacity] =
    useState(0.72);

  // Payment QR / Bank Account Config
  const [paymentConfig, setPaymentConfig] = useState<ShopPaymentConfig>({
    mode: 'vietqr_auto',
    bankId: 'MB',
    bankName: 'MB Bank',
    accountNumber: '',
    accountName: '',
    template: 'compact2',
    transferPrefix: 'QLAOK',
    customQrUrl: '',
    paymentNote: '',
  });

  const [supportedLangs, setSupportedLangs] =
    useState<SupportedLocale[]>(['vi']);
  const [ownerPlanForShop, setOwnerPlanForShop] = useState<{
    shopId: string;
    status: 'resolved';
    plan: PlanTier;
  } | {
    shopId: string;
    status: 'error';
  } | null>(null);
  const [planUpgradeRequest, setPlanUpgradeRequest] = useState<{
    currentPlan: PlanTier;
    requiredPlan: PlanTier;
    feature: 'custom_theme' | 'supported_languages';
  } | null>(null);
  const [planLookupRetryKey, setPlanLookupRetryKey] = useState(0);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(() =>
    activeShop
      ? createInitialOpeningHoursSettingsState(activeShop).openingHours
      : null
  );
  const [openingHoursConfirmed, setOpeningHoursConfirmed] = useState<boolean>(
    () =>
      activeShop
        ? createInitialOpeningHoursSettingsState(activeShop).openingHoursConfirmed
        : false
  );
  const [shopItems, setShopItems] = useState<CatalogItem[]>([]);
  const [serviceRequestNotificationRule, setServiceRequestNotificationRule] =
    useState<ServiceRequestNotificationRule>('all_order_staff');

  const [isPreviewSidebarOpen, setIsPreviewSidebarOpen] = useState(true);
  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);

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
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const uploadingFieldRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] =
    useState<FeedbackToastMessage | null>(null);
  const dismissSaveFeedback = useCallback(() => setSaveFeedback(null), []);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSlugConfirmModalOpen, setIsSlugConfirmModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('store-info');

  useEffect(() => {
    const scrollToHash = (hash: string) => {
      const cleanId = hash.replace(/^#/, '').trim();
      if (!cleanId) return;
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.getElementById(cleanId);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 50);
      });
    };

    const handleHash = () => {
      if (typeof window === 'undefined') return;
      const currentHash = window.location.hash.replace(/^#/, '').trim();
      if (!currentHash) return;
      const targetTab = resolveSettingsTabFromHash(currentHash);
      if (targetTab) {
        setActiveTab(targetTab);
        scrollToHash(currentHash);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const handleSelectTab = (tabId: SettingsTabId) => {
    setActiveTab(tabId);
    if (typeof window !== 'undefined') {
      const currentHash = window.location.hash.replace(/^#/, '').trim();
      if (SETTINGS_HASH_TO_TAB[currentHash] !== tabId) {
        window.history.replaceState(null, '', `#${tabId}`);
      }
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const tabIds = SETTINGS_TABS.map((t) => t.id);
    const currentIndex = tabIds.indexOf(activeTab);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabIds.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabIds.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextTabId = tabIds[nextIndex];
      handleSelectTab(nextTabId);
      const nextBtn = document.getElementById(`settings-tab-${nextTabId}`);
      nextBtn?.focus();
    }
  };

  useEffect(() => {
    if (!activeShop) {
      setOwnerPlanForShop(null);
      return;
    }
    let cancelled = false;
    const shopId = activeShop.id;
    setOwnerPlanForShop(null);
    setIsSlugConfirmModalOpen(false);
    setPlanUpgradeRequest(null);
    setName(activeShop.name);
    setSlug(activeShop.slug);
    setVertical(activeShop.vertical);
    setTaglineVi(activeShop.tagline_i18n?.vi || '');
    setDescVi(activeShop.description_i18n?.vi || '');
    setLogoUrl(activeShop.logo_url || '');
    setCoverUrl(activeShop.cover_urls?.[0] || '');
    setAddress(activeShop.address || '');
    setCity(activeShop.city || 'Đà Nẵng');
    setPhoneContact(activeShop.phone_contact || '');
    setZaloPhone(activeShop.zalo_phone || '');
    setGoogleMapsUrl(activeShop.google_maps_url || '');
    setGoogleReviewUrl(activeShop.google_review_url || '');
    setWifiSsid(activeShop.wifi_info?.ssid || '');
    setWifiPassword(activeShop.wifi_info?.password || '');

    const tc = activeShop.theme_config;
    setServiceRequestNotificationRule(
      tc?.serviceRequestNotificationRule === 'owner_only'
        ? 'owner_only'
        : 'all_order_staff'
    );
    setPrimaryColor(tc?.primaryColor || '#10b981');
    setLayoutMode(
      tc?.layout || (activeShop.vertical === 'retail' ? 'grid' : 'list')
    );
    setBackgroundStyle(tc?.backgroundStyle || 'clean');
    setBackgroundImageUrl(tc?.backgroundImageUrl || '');
    setBackgroundOverlayOpacity(
      typeof tc?.backgroundOverlayOpacity === 'number'
        ? tc.backgroundOverlayOpacity
        : 0.72
    );

    const pc = tc?.paymentConfig;
    setPaymentConfig({
      mode: pc?.mode || 'vietqr_auto',
      bankId: pc?.bankId || 'MB',
      bankName: pc?.bankName || 'MB Bank',
      accountNumber: pc?.accountNumber || '',
      accountName:
        pc?.accountName || stripVietnameseAccents(activeShop.name || ''),
      template: pc?.template || 'compact2',
      transferPrefix: pc?.transferPrefix || 'QLAOK',
      customQrUrl: pc?.customQrUrl || '',
      paymentNote: pc?.paymentNote || '',
    });

    setSupportedLangs(
      activeShop.supported_langs?.length
        ? activeShop.supported_langs
        : ['vi']
    );
    const initialHoursState =
      createInitialOpeningHoursSettingsState(activeShop);
    setOpeningHours(initialHoursState.openingHours);
    setOpeningHoursConfirmed(initialHoursState.openingHoursConfirmed);

    // Fetch catalog items for the live phone preview
    fetch(`/api/catalog?shopId=${encodeURIComponent(shopId)}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('PLAN_ACCESS_CHECK_FAILED');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.items)) {
          setShopItems(data.items);
        }
        setOwnerPlanForShop({
          shopId,
          status: 'resolved',
          plan: normalizePlanTier(data.ownerPlan),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerPlanForShop({ shopId, status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeShop, planLookupRetryKey]);

  if (!activeShop || !openingHours) {
    return (
      <div
        role="status"
        data-testid="settings-loading-state"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white p-10 text-center"
      >
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm font-bold text-slate-700">
          {tx(
            'Đang tải dữ liệu cài đặt cửa hàng...',
            'Loading store settings data...'
          )}
        </p>
      </div>
    );
  }

  const isSuperAdminBypass = Boolean(
    profile?.role === 'admin' && isSuperAdminEmail(profile.email)
  );
  const ownerPlanResolved =
    isSuperAdminBypass ||
    (ownerPlanForShop?.shopId === activeShop.id &&
      ownerPlanForShop.status === 'resolved');
  const ownerPlanError =
    !isSuperAdminBypass &&
    ownerPlanForShop?.shopId === activeShop.id &&
    ownerPlanForShop.status === 'error';
  const currentOwnerPlan = ownerPlanResolved && ownerPlanForShop?.status === 'resolved'
    ? ownerPlanForShop.plan
    : 'free';
  const effectiveOwnerPlan = isSuperAdminBypass ? 'premium' : currentOwnerPlan;
  const canEditCustomTheme =
    isSuperAdminBypass ||
    (ownerPlanResolved && PLAN_CONFIGS[currentOwnerPlan].allowCustomTheme);

  const retryOwnerPlanLookup = () => {
    setOwnerPlanForShop(null);
    setPlanLookupRetryKey((current) => current + 1);
  };

  const toggleLocale = (loc: SupportedLocale) => {
    if (loc === 'vi') return;
    if (!ownerPlanResolved) return;
    if (supportedLangs.includes(loc)) {
      setSupportedLangs((prev) => prev.filter((language) => language !== loc));
      return;
    }
    if (supportedLangs.length >= PLAN_CONFIGS[effectiveOwnerPlan].maxLangs) {
      setPlanUpgradeRequest({
        currentPlan: effectiveOwnerPlan,
        requiredPlan: effectiveOwnerPlan === 'free' ? 'basic' : 'premium',
        feature: 'supported_languages',
      });
      return;
    }
    setSupportedLangs((prev) => [...prev, loc]);
  };

  const handleUploadImage = async (
    file: File | undefined,
    onDone: (publicUrl: string) => void,
    fieldKey: string
  ) => {
    if (!file || uploadingFieldRef.current !== null) return;
    uploadingFieldRef.current = fieldKey;
    setUploadingField(fieldKey);
    try {
      const publicUrl = await uploadCompressedImage(file);
      if (publicUrl) {
        onDone(publicUrl);
      }
    } catch {
      setErrorMsg(
        tx(
          'Không thể tải ảnh lên. Bạn có thể dán trực tiếp link ảnh.',
          'Could not upload image. You can paste an image URL directly.'
        )
      );
    } finally {
      uploadingFieldRef.current = null;
      setUploadingField(null);
    }
  };

  const slugConfirmation = requiresSlugChangeConfirmation(
    activeShop.slug,
    slug
  );

  const performSaveSettings = async () => {
    const normalizedSlug = normalizeShopSlugInput(slug);
    if (!normalizedSlug) {
      setErrorMsg(
        tx(
          'Vui lòng nhập đường dẫn QR (Slug) hợp lệ.',
          'Please enter a valid QR URL slug.'
        )
      );
      return;
    }

    setSaving(true);
    setErrorMsg('');
    setSaveFeedback(null);

    try {
      const selectedBank = VIETQR_BANKS.find(
        (b) => b.code === paymentConfig.bankId
      );
      const cleanedPaymentConfig: ShopPaymentConfig = {
        ...paymentConfig,
        bankId: paymentConfig.bankId || 'MB',
        bankName:
          paymentConfig.mode === 'vietqr_auto'
            ? selectedBank?.shortName || paymentConfig.bankName || 'MB Bank'
            : paymentConfig.bankName || selectedBank?.shortName || 'Ví / Ngân hàng',
        accountNumber: (paymentConfig.accountNumber || '').trim(),
        accountName: stripVietnameseAccents(
          paymentConfig.accountName || name || activeShop.name
        ),
        transferPrefix: (paymentConfig.transferPrefix || 'QLAOK').trim(),
        customQrUrl: (paymentConfig.customQrUrl || '').trim(),
        paymentNote: (paymentConfig.paymentNote || '').trim(),
      };

      // Preserve promoBanner, welcomePopup, and flashSale configured in /dashboard/posts;
      // omit orderWorkflow and labelPrintConfig so PATCH /api/shops preserves its independent owner-managed values.
      const {
        orderWorkflow: _preservedOrderWorkflow,
        labelPrintConfig: _preservedLabelPrintConfig,
        ...restThemeConfig
      } = activeShop.theme_config || {};
      const nextThemeConfig: ShopThemeConfig = {
        ...restThemeConfig,
        ...(canEditCustomTheme
          ? {
              primaryColor,
              layout: layoutMode,
              backgroundStyle,
              backgroundImageUrl: backgroundImageUrl.trim() || undefined,
              backgroundOverlayOpacity,
            }
          : {}),
        paymentConfig: cleanedPaymentConfig,
        ...(activeShop.owner_id === profile?.id
          ? { serviceRequestNotificationRule }
          : {}),
      };

      const nextCoverUrls = coverUrl.trim()
        ? [coverUrl.trim(), ...(activeShop.cover_urls || []).slice(1)]
        : activeShop.cover_urls || [];

      const res = await fetch('/api/shops', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: activeShop.id,
          name,
          slug: normalizedSlug,
          vertical,
          logo_url: logoUrl.trim() || null,
          cover_urls: nextCoverUrls,
          tagline_i18n: {
            ...activeShop.tagline_i18n,
            vi: taglineVi,
          },
          description_i18n: {
            ...activeShop.description_i18n,
            vi: descVi,
          },
          address,
          city,
          phone_contact: phoneContact,
          zalo_phone: zaloPhone,
          google_maps_url: googleMapsUrl,
          google_review_url: googleReviewUrl,
          wifi_info: {
            ssid: wifiSsid,
            password: wifiPassword,
          },
          theme_config: nextThemeConfig,
          supported_langs: supportedLangs,
          ...buildOpeningHoursSettingsPatch({
            openingHours,
            openingHoursConfirmed,
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (
          (data.code === 'PLAN_FEATURE_LOCKED' ||
            data.code === 'PLAN_LIMIT_REACHED') &&
          (data.requiredPlan === 'basic' || data.requiredPlan === 'premium')
        ) {
          setPlanUpgradeRequest({
            currentPlan:
              data.currentPlan === 'free' ||
              data.currentPlan === 'basic' ||
              data.currentPlan === 'premium'
                ? data.currentPlan
                : currentOwnerPlan,
            requiredPlan: data.requiredPlan,
            feature:
              data.code === 'PLAN_FEATURE_LOCKED'
                ? 'custom_theme'
                : 'supported_languages',
          });
        }
        throw new Error(
          data.error || tx('Không thể lưu cài đặt', 'Could not save settings')
        );
      }

      if (data?.shop) {
        updateActiveShop?.(data.shop);
        setOpeningHoursConfirmed(hasConfirmedOpeningHours(data.shop));
      }

      setSlug(normalizedSlug);

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        try {
          const bc = new BroadcastChannel('qlaok_realtime_sync');
          bc.postMessage({
            type: 'shop_updated',
            shopId: activeShop.id,
            shop: data?.shop,
          });
          bc.close();
        } catch {
          // The server has already saved the settings; keep the local result.
        }
      }

      try {
        await refreshDashboard();
      } catch {
        // The server has already saved the settings; keep the local result.
      }
      setSaveFeedback({
        kind: 'success',
        message: tx('Đã lưu cài đặt cửa hàng.', 'Store settings saved.'),
      });
    } catch (err) {
      setSaveFeedback({
        kind: 'error',
        message:
          err instanceof Error && err.message
            ? err.message
            : tx('Lỗi khi lưu cài đặt', 'Failed to save settings'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedSlug = normalizeShopSlugInput(slug);
    if (!normalizedSlug) {
      setErrorMsg(
        tx(
          'Vui lòng nhập đường dẫn QR (Slug) hợp lệ.',
          'Please enter a valid QR URL slug.'
        )
      );
      return;
    }

    if (slugConfirmation.required) {
      setIsSlugConfirmModalOpen(true);
      return;
    }

    await performSaveSettings();
  };

  // Live preview shop object combining current form state + active promotions
  const previewShop = {
    ...activeShop,
    name: name || activeShop.name,
    tagline_i18n: {
      ...activeShop.tagline_i18n,
      vi: taglineVi || activeShop.tagline_i18n?.vi || '',
    },
    logo_url: logoUrl || activeShop.logo_url,
    cover_urls: coverUrl ? [coverUrl] : activeShop.cover_urls,
    address: address || activeShop.address,
    wifi_info: {
      ssid: wifiSsid || activeShop.wifi_info?.ssid || 'Free_WiFi',
      password: wifiPassword || activeShop.wifi_info?.password || '12345678',
    },
    theme_config: {
      ...activeShop.theme_config,
      primaryColor,
      layout: layoutMode,
      backgroundStyle,
      backgroundImageUrl,
      backgroundOverlayOpacity,
      paymentConfig,
    },
  };

  const liveQrPreview = getShopPaymentQrInfo(
    previewShop,
    150000,
    'DEMO88',
    paymentConfig
  );

  return (
    <form
      onSubmit={handleSaveSettings}
      className={`space-y-6 pb-12 transition-all duration-300 ${
        isPreviewSidebarOpen ? 'xl:pr-[385px]' : ''
      }`}
    >
      <FeedbackToast
        feedback={saveFeedback}
        dismissLabel={tx('Đóng thông báo', 'Dismiss notification')}
        onDismiss={dismissSaveFeedback}
      />
      <PlanUpgradeDialog
        open={planUpgradeRequest !== null}
        currentPlan={planUpgradeRequest?.currentPlan ?? currentOwnerPlan}
        requiredPlan={planUpgradeRequest?.requiredPlan ?? 'basic'}
        feature={planUpgradeRequest?.feature ?? 'supported_languages'}
        onClose={() => setPlanUpgradeRequest(null)}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            {tx(
              'Cài đặt quán',
              'Store settings'
            )}
          </h1>
          <p className="text-xs text-slate-500">
            {tx(
              'Cấu hình tài khoản nhận tiền, màu sắc thương hiệu, thông tin liên hệ và xem trước ở khung bên phải.',
              'Configure bank payment QR, brand colors, store info, and preview live in the right panel.'
            )}
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
              {isPreviewSidebarOpen
                ? tx('Ẩn khung xem trước', 'Hide preview')
                : tx('Mở khung xem trước', 'Show preview')}
            </span>
          </button>

          <a
            href={`/s/${activeShop.slug}/menu`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
            <span>{tx('Mở thực đơn khách', 'Open Live Menu')}</span>
          </a>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>
              {saving
                ? t('common.saving')
                : tx('Lưu cài đặt', 'Save Settings')}
            </span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Settings Navigation Tabs */}
      <div className="border-b border-slate-200">
        <div
          role="tablist"
          aria-label={tx('Phân nhóm cài đặt', 'Settings groups')}
          onKeyDown={handleTabKeyDown}
          className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-1 scroll-smooth"
        >
          {SETTINGS_TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                id={`settings-tab-${tab.id}`}
                data-testid={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`settings-tabpanel-${tab.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => handleSelectTab(tab.id)}
                className={`shrink-0 inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-xs sm:text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <TabIcon
                  className={`h-4 w-4 shrink-0 ${
                    isSelected ? 'text-white' : 'text-slate-500'
                  }`}
                />
                <span>{tx(tab.labelVi, tab.labelEn)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels */}
      {/* 1. Store Information Tab Panel */}
      <div
        id="settings-tabpanel-store-info"
        data-testid="settings-tabpanel-store-info"
        role="tabpanel"
        aria-labelledby="settings-tab-store-info"
        hidden={activeTab !== 'store-info'}
        className={activeTab === 'store-info' ? 'space-y-6 focus:outline-none' : 'hidden'}
      >
      {/* 2. Basic Store Identity, Logo & Cover Image */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Store className="h-4 w-4 text-emerald-600" />
          <span>
            {tx('Hồ sơ quán', 'Store profile')}
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Tên cửa hàng *', 'Store name *')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Đường dẫn QR (Slug) *', 'QR URL slug *')}
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              data-testid="settings-slug-input"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono font-bold text-emerald-700"
            />
            {slugConfirmation.required && (
              <p
                data-testid="settings-slug-changed-warning"
                className="mt-1.5 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900"
              >
                ⚠️{' '}
                {tx(
                  'Đổi từ /s/{oldSlug} sang /s/{newSlug}: đường dẫn cũ sẽ được bảo lưu và tự chuyển hướng sang đường dẫn mới cho các mã QR đã in.',
                  'Changing /s/{oldSlug} to /s/{newSlug}: the old URL will be preserved as a redirect alias so previously printed QR codes continue to work.',
                  {
                    oldSlug: slugConfirmation.currentNormalized,
                    newSlug: slugConfirmation.nextNormalized,
                  }
                )}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Loại hình kinh doanh', 'Business category')}
            </label>
            <select
              value={vertical}
              onChange={(e) => setVertical(e.target.value as BusinessVertical)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
            >
              <option value="fnb">
                {tx(
                  '🍜 Ẩm thực F&B (Quán ăn, Cafe, Trà sữa)',
                  '🍜 Food & Beverage (Restaurant, Cafe, Tea)'
                )}
              </option>
              <option value="service">
                {tx(
                  '💆‍♀️ Dịch vụ (Nail, Spa, Massage, Salon)',
                  '💆‍♀️ Services (Nail, Spa, Massage, Salon)'
                )}
              </option>
              <option value="retail">
                {tx(
                  '🛍️ Bán lẻ (Đặc sản, Tạp hóa, Quà tặng)',
                  '🛍️ Retail (Specialties, Grocery, Gifts)'
                )}
              </option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Câu giới thiệu ngắn', 'Short tagline')}
            </label>
            <input
              type="text"
              value={taglineVi}
              onChange={(e) => setTaglineVi(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Mô tả chi tiết', 'Store description')}
            </label>
            <input
              type="text"
              value={descVi}
              onChange={(e) => setDescVi(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Logo quán', 'Store logo')}
            </label>
            <div className="flex items-center gap-2.5">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-11 w-11 shrink-0 rounded-xl object-cover border border-slate-200"
                />
              )}
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder={tx(
                  'Dán link ảnh hoặc tải lên...',
                  'Paste image URL or upload...'
                )}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
              <label
                aria-busy={uploadingField !== null}
                aria-disabled={uploadingField !== null}
                className={`shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 ${
                  uploadingField !== null
                    ? 'pointer-events-none cursor-wait opacity-60'
                    : 'cursor-pointer'
                }`}
              >
                {uploadingField === 'logo' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span
                  role={uploadingField === 'logo' ? 'status' : undefined}
                  aria-live={uploadingField === 'logo' ? 'polite' : undefined}
                >
                  {uploadingField === 'logo'
                    ? tx('Đang tải...', 'Uploading...')
                    : tx('Tải ảnh', 'Upload')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingField !== null}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void handleUploadImage(file, (url) => setLogoUrl(url), 'logo');
                  }}
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tx('Ảnh bìa đầu trang', 'Cover photo')}
            </label>
            <div className="flex items-center gap-2.5">
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt="Cover"
                  className="h-11 w-16 shrink-0 rounded-xl object-cover border border-slate-200"
                />
              )}
              <input
                type="text"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder={tx(
                  'Dán link ảnh bìa hoặc tải lên...',
                  'Paste cover URL or upload...'
                )}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
              <label
                aria-busy={uploadingField !== null}
                aria-disabled={uploadingField !== null}
                className={`shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 ${
                  uploadingField !== null
                    ? 'pointer-events-none cursor-wait opacity-60'
                    : 'cursor-pointer'
                }`}
              >
                {uploadingField === 'cover' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span
                  role={uploadingField === 'cover' ? 'status' : undefined}
                  aria-live={uploadingField === 'cover' ? 'polite' : undefined}
                >
                  {uploadingField === 'cover'
                    ? tx('Đang tải...', 'Uploading...')
                    : tx('Tải ảnh', 'Upload')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingField !== null}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void handleUploadImage(file, (url) => setCoverUrl(url), 'cover');
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Wi-Fi, 8 Languages & Contact / Maps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-emerald-600" />
            <span>
              {tx('Wi-Fi & Ngôn ngữ', 'Wi-Fi & languages')}
            </span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Tên Wi-Fi', 'Wi-Fi name')}
              </label>
              <input
                type="text"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                placeholder="PhoHoiAn_Free5G"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Mật khẩu Wi-Fi', 'Wi-Fi password')}
              </label>
              <input
                type="text"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="12345678"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              <Languages className="inline h-3.5 w-3.5 mr-1 text-emerald-600" />
              {tx('Ngôn ngữ hiển thị trên thực đơn QR:', 'Languages enabled on QR menu:')}
            </label>
            <p className="text-[11px] text-slate-500" data-testid="settings-language-plan-limit">
              {ownerPlanResolved
                ? tx(
                    'Gói {plan} hỗ trợ tối đa {count} ngôn ngữ.',
                    'The {plan} plan supports up to {count} languages.',
                    {
                      plan: isSuperAdminBypass
                        ? tx('Quyền Super Admin', 'Super Admin access')
                        : currentOwnerPlan === 'free'
                          ? 'Free'
                          : currentOwnerPlan === 'basic'
                            ? 'Basic'
                            : 'Premium',
                      count: PLAN_CONFIGS[effectiveOwnerPlan].maxLangs,
                    }
                  )
                : ownerPlanError
                  ? tx(
                      'Không thể xác minh gói của chủ quán. Thử lại để mở tùy chọn ngôn ngữ.',
                      'Could not verify the store owner plan. Retry to enable language options.'
                    )
                  : tx('Đang kiểm tra giới hạn ngôn ngữ...', 'Checking language limit...')}
            </p>
            {ownerPlanError && (
              <button
                type="button"
                data-testid="settings-plan-retry"
                onClick={retryOwnerPlanLookup}
                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
              >
                {tx('Thử lại', 'Retry')}
              </button>
            )}
            <div className="flex flex-wrap gap-1.5">
              {ALL_LOCALES.map((loc) => {
                const active = supportedLangs.includes(loc);
                return (
                  <button
                    key={loc}
                    type="button"
                    disabled={!ownerPlanResolved}
                    onClick={() => toggleLocale(loc)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold ${
                      active
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-400'
                    } disabled:cursor-wait disabled:opacity-60`}
                  >
                    <FlagIcon locale={loc} title={appLanguageName(loc, locale)} className="h-3.5 w-5" />
                    <span>{appLanguageName(loc, locale)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-rose-500" />
            <span>
              {tx('Liên hệ', 'Contact')}
            </span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Địa chỉ cửa hàng', 'Street address')}
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Tỉnh / Thành phố', 'Province / City')}
              </label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900"
              >
                {VIETNAM_PROVINCES_34.map((prov) => (
                  <option key={prov.code} value={prov.name}>
                    {prov.name} ({prov.region})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Điện thoại liên hệ', 'Contact phone')}
              </label>
              <input
                type="text"
                value={phoneContact}
                onChange={(e) => setPhoneContact(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Số Zalo nhận đơn', 'Zalo phone for orders')}
              </label>
              <input
                type="text"
                value={zaloPhone}
                onChange={(e) => setZaloPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Link Google Maps chỉ đường', 'Google Maps directions URL')}
              </label>
              <input
                type="text"
                value={googleMapsUrl}
                onChange={(e) => setGoogleMapsUrl(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {tx('Link đánh giá 5⭐ Google Maps', 'Google Maps 5⭐ review URL')}
              </label>
              <input
                type="text"
                value={googleReviewUrl}
                onChange={(e) => setGoogleReviewUrl(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 5. 7-Day Opening Hours */}
      <div
        id="opening-hours-settings"
        className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-600" />
            <span>{tx('Giờ mở cửa', 'Opening hours')}</span>
          </h2>
          <span
            data-testid="opening-hours-confirmation-badge"
            className={`rounded-full px-3 py-1 text-[11px] font-black ${
              openingHoursConfirmed
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {openingHoursConfirmed
              ? tx('✓ Đã xác nhận giờ mở cửa', '✓ Opening hours confirmed')
              : tx('Chưa xác nhận giờ mở cửa', 'Opening hours unconfirmed')}
          </span>
        </div>

        <WeeklyOpeningHoursPicker
          openingHours={openingHours}
          onChange={(nextHours) => {
            const nextState = applyOpeningHoursScheduleChange(
              { openingHours, openingHoursConfirmed },
              nextHours
            );
            setOpeningHours(nextState.openingHours);
            setOpeningHoursConfirmed(nextState.openingHoursConfirmed);
          }}
        />

        <div
          className={`rounded-2xl border p-3.5 transition-colors ${
            openingHoursConfirmed
              ? 'border-emerald-200 bg-emerald-50/70'
              : 'border-amber-200 bg-amber-50/60'
          }`}
        >
          <label
            htmlFor="opening-hours-confirmed-checkbox"
            className="flex min-h-[44px] cursor-pointer items-start sm:items-center gap-3"
          >
            <input
              id="opening-hours-confirmed-checkbox"
              name="opening_hours_confirmed"
              type="checkbox"
              data-testid="opening-hours-confirmed-checkbox"
              checked={openingHoursConfirmed}
              aria-describedby="opening-hours-confirmed-help"
              onChange={(e) => {
                const nextState = applyOpeningHoursConfirmationToggle(
                  { openingHours, openingHoursConfirmed },
                  e.target.checked
                );
                setOpeningHoursConfirmed(nextState.openingHoursConfirmed);
              }}
              className="mt-0.5 sm:mt-0 h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            />
            <div className="space-y-0.5">
              <span className="block text-xs font-extrabold text-slate-900">
                {tx(
                  'Tôi đã kiểm tra và xác nhận giờ mở cửa này là chính xác.',
                  'I checked that these opening hours are correct.'
                )}
              </span>
              <span
                id="opening-hours-confirmed-help"
                className="block text-[11px] text-slate-600"
              >
                {tx(
                  'Nếu bạn chỉnh sửa bất kỳ ngày hoặc khung giờ nào ở trên, dấu xác nhận sẽ tự bỏ để bạn kiểm tra lại trước khi bấm Lưu cài đặt.',
                  'Changing any day, time, or open/closed toggle above clears this confirmation until you re-check it and click Save Settings.'
                )}
              </span>
            </div>
          </label>
        </div>
      </div>
      </div>

      {/* 2. Appearance Tab Panel */}
      <div
        id="settings-tabpanel-appearance"
        data-testid="settings-tabpanel-appearance"
        role="tabpanel"
        aria-labelledby="settings-tab-appearance"
        hidden={activeTab !== 'appearance'}
        className={activeTab === 'appearance' ? 'space-y-6 focus:outline-none' : 'hidden'}
      >
      {/* 1. Storefront Theme & Appearance */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Palette className="h-4 w-4 text-emerald-600" />
            <span>
              {tx(
                'Giao diện',
                'Appearance'
              )}
            </span>
          </h2>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
            {tx(
              'Cập nhật trực tiếp ở khung bên phải 👉',
              'Updates live in the right panel 👉'
            )}
          </span>
        </div>

        {canEditCustomTheme ? (
          <>
        {/* Pure Color Swatches */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2.5">
            {tx('Màu chủ đạo của quán', 'Primary brand color')}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {BRAND_COLOR_SWATCHES.map((hex) => {
              const selected =
                primaryColor.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setPrimaryColor(hex)}
                  aria-label={tx('Chọn màu {hex}', 'Select color {hex}', {
                    hex,
                  })}
                  className={`relative h-9 w-9 rounded-full transition-transform ${
                    selected
                      ? 'scale-110 ring-2 ring-offset-2 ring-slate-900 shadow-md'
                      : 'hover:scale-105 opacity-85 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: hex }}
                >
                  {selected && (
                    <Check className="h-4 w-4 text-white mx-auto drop-shadow" />
                  )}
                </button>
              );
            })}

            {/* Custom Color Picker Circle */}
            <label
              title={tx('Tự chọn mã màu bất kỳ', 'Pick any custom color')}
              className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-slate-50 hover:border-slate-500"
            >
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="sr-only"
              />
              <span
                className="h-5 w-5 rounded-full border border-slate-200"
                style={{ backgroundColor: primaryColor }}
              />
            </label>
          </div>
        </div>

        {/* Background Style Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            {tx('Nền màn hình điện thoại', 'Phone background style')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              {
                id: 'clean',
                label: tx('☀️ Sáng', '☀️ Clean Light'),
                previewBg: 'bg-slate-50 border-slate-200 text-slate-900',
              },
              {
                id: 'warm',
                label: tx('🏮 Kem ấm', '🏮 Warm Cream'),
                previewBg: 'bg-[#fdf8ee] border-amber-200 text-amber-950',
              },
              {
                id: 'dark',
                label: tx('🌙 Tối', '🌙 Dark'),
                previewBg: 'bg-slate-900 border-slate-700 text-white',
              },
              {
                id: 'custom_image',
                label: tx('🖼️ Ảnh nền', '🖼️ Wallpaper'),
                previewBg:
                  'bg-gradient-to-r from-emerald-900 to-slate-900 text-white',
              },
            ].map((bg) => {
              const active = backgroundStyle === bg.id;
              return (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() =>
                    setBackgroundStyle(
                      bg.id as NonNullable<ShopThemeConfig['backgroundStyle']>
                    )
                  }
                  className={`flex items-center justify-center gap-1.5 rounded-2xl border-2 py-3 px-3 text-xs font-extrabold transition ${
                    active
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'border-slate-200 opacity-80 hover:opacity-100'
                  } ${bg.previewBg}`}
                >
                  <span>{bg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Wallpaper Picker when custom_image is active */}
        {backgroundStyle === 'custom_image' && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {BACKGROUND_IMAGE_PRESETS.map((preset) => {
                const label = tx(preset.labelVi, preset.labelEn);
                return (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => setBackgroundImageUrl(preset.url)}
                    className={`group relative overflow-hidden rounded-xl border-2 aspect-video ${
                      backgroundImageUrl === preset.url
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30'
                        : 'border-transparent'
                    }`}
                  >
                    <img
                      src={preset.url}
                      alt={label}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-[9px] font-bold text-white truncate">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={backgroundImageUrl}
                onChange={(e) => setBackgroundImageUrl(e.target.value)}
                placeholder={tx(
                  'Dán link ảnh nền hoặc tải ảnh lên...',
                  'Paste wallpaper URL or upload photo...'
                )}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
              />
              <label
                aria-busy={uploadingField !== null}
                aria-disabled={uploadingField !== null}
                className={`shrink-0 inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 ${
                  uploadingField !== null
                    ? 'pointer-events-none cursor-wait opacity-60'
                    : 'cursor-pointer'
                }`}
              >
                {uploadingField === 'bg' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span
                  role={uploadingField === 'bg' ? 'status' : undefined}
                  aria-live={uploadingField === 'bg' ? 'polite' : undefined}
                >
                  {uploadingField === 'bg'
                    ? tx('Đang tải...', 'Uploading...')
                    : tx('Tải ảnh', 'Upload')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingField !== null}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void handleUploadImage(file, (url) => setBackgroundImageUrl(url), 'bg');
                  }}
                />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] font-bold text-slate-600 shrink-0">
                {tx(
                  'Độ tối lớp phủ ({pct}%)',
                  'Overlay darkness ({pct}%)',
                  { pct: Math.round(backgroundOverlayOpacity * 100) }
                )}
              </span>
              <input
                type="range"
                min="0.35"
                max="0.9"
                step="0.05"
                value={backgroundOverlayOpacity}
                onChange={(e) =>
                  setBackgroundOverlayOpacity(parseFloat(e.target.value))
                }
                className="w-full accent-emerald-600"
              />
            </div>
          </div>
        )}

        {/* Menu Item Layout Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            {tx('Bố cục hiển thị món', 'Menu item layout')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setLayoutMode('list')}
              className={`flex items-center gap-2.5 rounded-2xl border p-3 text-left transition ${
                layoutMode === 'list'
                  ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <List className="h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <span className="block text-xs font-extrabold">
                  {tx('Danh sách ngang', 'Horizontal list')}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {tx('Gọn gàng, dễ chọn nhanh', 'Compact and easy to browse')}
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setLayoutMode('grid')}
              className={`flex items-center gap-2.5 rounded-2xl border p-3 text-left transition ${
                layoutMode === 'grid'
                  ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <LayoutGrid className="h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <span className="block text-xs font-extrabold">
                  {tx('Lưới ảnh 2 cột', '2-column photo grid')}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {tx('Hình món to, bắt mắt', 'Large, visual item cards')}
                </span>
              </div>
            </button>
          </div>
        </div>
          </>
        ) : (
          <div
            role={ownerPlanError ? 'alert' : ownerPlanResolved ? 'region' : 'status'}
            aria-labelledby="settings-theme-plan-lock-title"
            data-testid="settings-theme-plan-lock"
            className="flex flex-col items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              {ownerPlanResolved || ownerPlanError ? <Lock className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
            </div>
            <div className="max-w-lg space-y-1">
              <h3
                id="settings-theme-plan-lock-title"
                className="text-sm font-black text-slate-900"
              >
                {ownerPlanError
                  ? tx(
                      'Không thể xác minh gói của chủ quán',
                      'Unable to verify the store owner plan'
                    )
                  : ownerPlanResolved
                  ? tx(
                      'Tùy chỉnh giao diện có từ gói Basic',
                      'Custom themes are available from the Basic plan'
                    )
                  : tx('Đang kiểm tra gói cửa hàng...', 'Checking store plan...')}
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                {ownerPlanError
                  ? tx(
                      'Giao diện đang lưu được giữ nguyên. Hãy thử lại để xác minh quyền nâng cấp.',
                      'Your saved appearance is preserved. Retry to verify plan access.'
                    )
                  : ownerPlanResolved
                  ? tx(
                      'Gói Free chưa hỗ trợ đổi màu thương hiệu, nền và bố cục thực đơn. Cấu hình giao diện đang lưu của quán vẫn được giữ nguyên.',
                      'The Free plan does not include brand colors, backgrounds, or menu layouts. Your saved theme settings are preserved.'
                    )
                  : tx(
                      'Các tùy chọn giao diện sẽ mở sau khi xác minh được gói của chủ quán.',
                      'Appearance options will unlock after the store owner plan is verified.'
                    )}
              </p>
            </div>
            {ownerPlanError ? (
              <button
                type="button"
                data-testid="settings-theme-plan-retry"
                onClick={retryOwnerPlanLookup}
                className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-xs font-black text-amber-900 hover:bg-amber-50"
              >
                {tx('Thử xác minh lại', 'Retry verification')}
              </button>
            ) : ownerPlanResolved ? (
              <button
                type="button"
                data-testid="settings-theme-upgrade-trigger"
                onClick={() =>
                  setPlanUpgradeRequest({
                    currentPlan: currentOwnerPlan,
                    requiredPlan: 'basic',
                    feature: 'custom_theme',
                  })
                }
                className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white hover:bg-amber-700"
              >
                {tx('Xem gói Basic', 'View the Basic plan')}
              </button>
            ) : null}
          </div>
        )}

        {/* Shortcut to Promotions & Flash Sale Studio */}
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-950">
              <Zap className="h-4 w-4 text-rose-600" />
              <span>
                {tx(
                  'Muốn cài giảm giá, Flash Sale & Banner khuyến mãi?',
                  'Want to set up discounts, Flash Sales & Promo Banners?'
                )}
              </span>
            </div>
            <p className="text-[11px] text-amber-800">
              {tx(
                'Quản lý tập trung tại mục Khuyến mãi & Giờ vàng.',
                'Manage all offers in the Promotions & Flash Sale section.'
              )}
            </p>
          </div>
          <Link
            href="/dashboard/posts"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white hover:bg-slate-800"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>
              {tx('Mở Khuyến mãi & Giờ vàng', 'Open Promotions & Flash Sale')}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      </div>

      {/* 3. Payments Tab Panel */}
      <div
        id="settings-tabpanel-payments"
        data-testid="settings-tabpanel-payments"
        role="tabpanel"
        aria-labelledby="settings-tab-payments"
        hidden={activeTab !== 'payments'}
        className={activeTab === 'payments' ? 'space-y-6 focus:outline-none' : 'hidden'}
      >
      {/* Bank Account & Payment QR */}
      <div
        id="payment-qr-settings"
        className="rounded-3xl border-2 border-emerald-500/30 bg-white p-5 shadow-2xs space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900">
                💳{' '}
                {tx(
                  'Tài khoản ngân hàng & Mã QR thanh toán',
                  'Bank Account & Payment QR Code'
                )}
              </h2>
              <p className="text-[11px] text-slate-500">
                {tx(
                  'Tự động tạo mã VietQR theo số tiền từng đơn hoặc tải ảnh QR sẵn có của quán',
                  'Auto-generate VietQR with exact order amounts or upload your own QR image'
                )}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-3 py-1 text-[11px] font-black ${
              liveQrPreview.isConfigured
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {liveQrPreview.isConfigured
              ? tx('✓ Đã cấu hình QR thanh toán', '✓ Payment QR configured')
              : tx(
                  'Chưa cài tài khoản ngân hàng',
                  'No bank account set'
                )}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Cols: Mode Selector & Bank / Custom QR Inputs */}
          <div className="lg:col-span-7 space-y-4">
            {/* Mode Switcher */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                {tx(
                  'Phương thức tạo mã QR thanh toán:',
                  'Payment QR generation method:'
                )}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setPaymentConfig((prev) => ({
                      ...prev,
                      mode: 'vietqr_auto',
                    }))
                  }
                  className={`flex items-start gap-2.5 rounded-2xl border-2 p-3.5 text-left transition ${
                    paymentConfig.mode === 'vietqr_auto'
                      ? 'border-emerald-600 bg-emerald-50/70 text-slate-900 shadow-2xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Landmark className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="block text-xs font-black">
                      {tx(
                        'VietQR tự động',
                        'Automatic VietQR'
                      )}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {tx(
                        'Khách quét tự điền đúng số tiền và mã đơn',
                        'Pre-fills exact order amount and reference code'
                      )}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPaymentConfig((prev) => ({
                      ...prev,
                      mode: 'custom_qr',
                    }))
                  }
                  className={`flex items-start gap-2.5 rounded-2xl border-2 p-3.5 text-left transition ${
                    paymentConfig.mode === 'custom_qr'
                      ? 'border-emerald-600 bg-emerald-50/70 text-slate-900 shadow-2xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Upload className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="block text-xs font-black">
                      {tx(
                        'Dùng ảnh QR',
                        'Use a QR image'
                      )}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {tx(
                        'Dùng ảnh chụp QR ngân hàng, MoMo, ZaloPay tại quầy',
                        'Use your existing bank, MoMo, or ZaloPay QR image'
                      )}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {paymentConfig.mode === 'vietqr_auto' ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Ngân hàng nhận tiền *', 'Receiving bank *')}
                    </label>
                    <select
                      value={paymentConfig.bankId || 'MB'}
                      onChange={(e) => {
                        const code = e.target.value;
                        const found = VIETQR_BANKS.find((b) => b.code === code);
                        setPaymentConfig((prev) => ({
                          ...prev,
                          bankId: code,
                          bankName: found?.shortName || code,
                        }));
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-900"
                    >
                      {VIETQR_BANKS.map((bank) => (
                        <option key={bank.code} value={bank.code}>
                          {bank.shortName} ({bank.code}) — {bank.fullName.split(' - ')[1] || bank.fullName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Số tài khoản ngân hàng *', 'Bank account number *')}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.accountNumber || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          accountNumber: e.target.value,
                        }))
                      }
                      placeholder={tx(
                        'VD: 0905123456 hoặc 19036888999',
                        'e.g. 0905123456 or 19036888999'
                      )}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-mono font-black text-emerald-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx(
                        'Tên chủ tài khoản (không dấu) *',
                        'Account holder name (no accents) *'
                      )}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.accountName || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          accountName: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder={tx('VD: NGUYEN VAN A', 'e.g. NGUYEN VAN A')}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold uppercase text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx(
                        'Tiền tố nội dung chuyển khoản',
                        'Transfer memo prefix'
                      )}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.transferPrefix || 'QLAOK'}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          transferPrefix: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder={tx(
                        'VD: QLAOK hoặc PHOHOIAN',
                        'e.g. QLAOK or PHOHOIAN'
                      )}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  💡{' '}
                  {tx(
                    'Khi khách thanh toán đơn #DEMO88 giá 150.000đ, ứng dụng ngân hàng tự điền 150.000đ và nội dung:',
                    'When paying order #DEMO88 (150,000đ), banking apps pre-fill 150,000đ and memo:'
                  )}{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-emerald-700">
                    {liveQrPreview.transferContent}
                  </code>
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    {tx(
                      'Tải lên hoặc dán link ảnh mã QR của quán (Ngân hàng / MoMo / ZaloPay) *',
                      'Upload or paste your QR image URL (Bank / MoMo / ZaloPay) *'
                    )}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={paymentConfig.customQrUrl || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          customQrUrl: e.target.value,
                        }))
                      }
                      placeholder={tx(
                        'Dán link ảnh QR hoặc bấm nút Tải ảnh QR...',
                        'Paste QR image URL or click Upload QR...'
                      )}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-900"
                    />
                    <label
                      aria-busy={uploadingField !== null}
                      aria-disabled={uploadingField !== null}
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-500 ${
                        uploadingField !== null
                          ? 'pointer-events-none cursor-wait opacity-60'
                          : 'cursor-pointer'
                      }`}
                    >
                      {uploadingField === 'custom_qr' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      <span
                        role={uploadingField === 'custom_qr' ? 'status' : undefined}
                        aria-live={uploadingField === 'custom_qr' ? 'polite' : undefined}
                      >
                        {uploadingField === 'custom_qr'
                          ? tx('Đang tải...', 'Uploading...')
                          : tx('Tải ảnh QR', 'Upload QR')}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingField !== null}
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          void handleUploadImage(
                            file,
                            (url) =>
                              setPaymentConfig((prev) => ({
                                ...prev,
                                customQrUrl: url,
                              })),
                            'custom_qr'
                          );
                        }}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Tên Ngân hàng / Ví', 'Bank / Wallet name')}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.bankName || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          bankName: e.target.value,
                        }))
                      }
                      placeholder="Vietcombank / MoMo"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Số tài khoản / SĐT Ví', 'Account / Wallet number')}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.accountNumber || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          accountNumber: e.target.value,
                        }))
                      }
                      placeholder="0905123456"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {tx('Tên chủ tài khoản', 'Account holder')}
                    </label>
                    <input
                      type="text"
                      value={paymentConfig.accountName || ''}
                      onChange={(e) =>
                        setPaymentConfig((prev) => ({
                          ...prev,
                          accountName: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="NGUYEN VAN A"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold uppercase text-slate-900"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right 5 Cols: Live Payment QR Preview Card */}
          <div className="lg:col-span-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 flex flex-col items-center text-center space-y-2.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-700">
              <CreditCard className="h-3 w-3" />
              {tx(
                'Xem trước QR thu tiền & in hóa đơn',
                'Payment & Receipt QR Preview'
              )}
            </span>

            <div className="rounded-2xl border-2 border-emerald-500/40 bg-white p-3 shadow-sm">
              <img
                src={liveQrPreview.qrImageUrl}
                alt={tx('Mã QR thanh toán', 'Payment QR')}
                className="h-48 w-48 object-contain mx-auto"
              />
            </div>

            <div className="space-y-0.5 text-xs">
              <p className="font-black text-slate-900">
                {liveQrPreview.bankShortName} •{' '}
                <span className="font-mono text-emerald-700">
                  {liveQrPreview.accountNumber ||
                    tx('Chưa nhập STK', 'No account set')}
                </span>
              </p>
              <p className="text-[11px] font-bold text-slate-600 uppercase">
                {tx('Chủ TK:', 'Holder:')} {liveQrPreview.accountName}
              </p>
              <p className="text-[10px] text-slate-400">
                {tx(
                  '(Mở ứng dụng ngân hàng để quét thử ngay)',
                  '(Scan with your banking app to test)'
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 1b. Owner-only SePay VietQR Automatic Order Reconciliation */}
      <ShopSePayWebhookManager />
      </div>

      {/* 4. Orders & Printing Tab Panel */}
      <div
        id="settings-tabpanel-orders"
        data-testid="settings-tabpanel-orders"
        role="tabpanel"
        aria-labelledby="settings-tab-orders"
        hidden={activeTab !== 'orders'}
        className={activeTab === 'orders' ? 'space-y-6 focus:outline-none' : 'hidden'}
      >
      {/* 5b. Owner-managed Order Fulfillment Workflow Flowchart Editor */}
      <ShopOrderWorkflowEditor />

      <section
        data-testid="service-request-notification-settings"
        className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-4">
          <h3 className="text-sm font-black text-slate-900">
            {tx('Thông báo khách gọi nhân viên', 'Staff call notifications')}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {tx(
              'Chọn người nhận khi khách bấm gọi nhân viên tại bàn. Quy tắc được lưu cùng cài đặt cửa hàng.',
              'Choose who receives alerts when a guest calls staff from a table. This rule is saved with store settings.'
            )}
          </p>
        </div>
        {activeShop.owner_id === profile?.id ? (
          <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">
              {tx('Người nhận thông báo gọi nhân viên', 'Staff call notification recipients')}
            </legend>
            {([
              {
                value: 'all_order_staff',
                title: tx('Tất cả nhân viên nhận đơn', 'All order staff'),
                description: tx(
                  'Gửi đến nhân viên có quyền xem đơn hàng của quán.',
                  'Send to staff who can view this shop’s orders.'
                ),
              },
              {
                value: 'owner_only',
                title: tx('Chỉ chủ quán', 'Owner only'),
                description: tx(
                  'Chỉ chủ quán nhận thông báo khách gọi nhân viên.',
                  'Only the shop owner receives staff call alerts.'
                ),
              },
            ] as const).map((option) => (
              <label
                key={option.value}
                data-testid={`service-request-notification-rule-${option.value}`}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                  serviceRequestNotificationRule === option.value
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="serviceRequestNotificationRule"
                  value={option.value}
                  checked={serviceRequestNotificationRule === option.value}
                  onChange={() => setServiceRequestNotificationRule(option.value)}
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                />
                <span>
                  <span className="block text-xs font-black text-slate-900">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
            {tx(
              'Chủ quán đang quản lý quy tắc nhận thông báo này.',
              'The shop owner manages this notification rule.'
            )}
          </p>
        )}
      </section>

      {/* 5c. Owner-managed Production Labels & Cup Stickers Config */}
      <ShopLabelPrintSettingsEditor />
      </div>

      {/* 5. Staff Tab Panel */}
      <div
        id="settings-tabpanel-staff"
        data-testid="settings-tabpanel-staff"
        role="tabpanel"
        aria-labelledby="settings-tab-staff"
        hidden={activeTab !== 'staff'}
        className={activeTab === 'staff' ? 'space-y-6 focus:outline-none' : 'hidden'}
      >
      {/* 6. Staff & roles (owner only; component renders nothing otherwise) */}
      <ShopMembersManager />
      </div>
      {/* Right Preview Sidebar Live Smartphone Viewer */}
      <RightPreviewSidebar
        shop={previewShop}
        items={shopItems}
        isOpen={isPreviewSidebarOpen}
        onToggle={togglePreviewSidebar}
        onOpenPopupPreview={() => setPreviewPopupOpen(true)}
        subtitle={tx(
          'Xem trực tiếp màu sắc, nền, bố cục & thông tin quán',
          'Live preview of colors, background, layout & store info'
        )}
      />

      {/* Interactive Popup Preview Modal */}
      <StorefrontWelcomePopup
        shop={previewShop}
        isOpen={previewPopupOpen}
        onClose={() => setPreviewPopupOpen(false)}
      />

      {/* Slug Change Confirmation Modal */}
      {isSlugConfirmModalOpen && slugConfirmation.required && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="slug-confirm-modal-title"
          data-testid="settings-slug-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-3xl border border-amber-300 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3
                  id="slug-confirm-modal-title"
                  className="text-base font-black text-slate-900"
                >
                  {tx(
                    'Xác nhận đổi đường dẫn QR của quán?',
                    'Confirm changing store QR URL slug?'
                  )}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {tx(
                    'Khi đổi đường dẫn (Slug), đường dẫn cũ sẽ được hệ thống bảo lưu làm bí danh (alias) và tự động chuyển hướng sang đường dẫn mới kèm đầy đủ tham số bàn/chữ ký cho các mã QR dán cửa và QR tại bàn đã in trước đây. Các bản in mới trong mục Thiết kế & In QR sẽ sử dụng đường dẫn mới.',
                    'When you change your store URL slug, the previous slug is preserved as a server alias that automatically redirects previously printed Door QR and signed Table QR links (with all query parameters intact) to the new canonical URL. New prints in QR Studio will use the new slug.'
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-500">
                  {tx('Đường dẫn cũ:', 'Current QR path:')}
                </span>
                <code className="rounded-lg bg-rose-100 px-2 py-0.5 font-mono font-bold text-rose-800 line-through">
                  /s/{slugConfirmation.currentNormalized}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700">
                  {tx('Đường dẫn mới:', 'New QR path:')}
                </span>
                <code className="rounded-lg bg-emerald-100 px-2 py-0.5 font-mono font-bold text-emerald-800">
                  /s/{slugConfirmation.nextNormalized}
                </code>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="button"
                data-testid="settings-slug-confirm-revert"
                onClick={() => {
                  setSlug(activeShop.slug);
                  setIsSlugConfirmModalOpen(false);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {tx('Giữ nguyên đường dẫn cũ', 'Keep original slug')}
              </button>
              <button
                type="button"
                data-testid="settings-slug-confirm-cancel"
                onClick={() => setIsSlugConfirmModalOpen(false)}
                className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="settings-slug-confirm-accept"
                disabled={saving}
                onClick={() => {
                  setIsSlugConfirmModalOpen(false);
                  void performSaveSettings();
                }}
                className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-sm hover:bg-amber-400 disabled:opacity-50"
              >
                {tx('Tôi hiểu, vẫn đổi & lưu', 'I understand, save new slug')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
