'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import imageCompression from 'browser-image-compression';
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
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import {
  BusinessVertical,
  CatalogItem,
  OpeningHours,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { FlagIcon } from '@/components/ui/FlagIcon';
import {
  StorefrontPhonePreview,
  StorefrontWelcomePopup,
} from '@/components/storefront/StorefrontCustomDecor';
import { WeeklyOpeningHoursPicker } from '@/components/ui/TimeSchedulePicker';

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
    label: 'Phố Cổ',
    url: 'https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Gỗ Ấm',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Cafe Chill',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Spa Thảo Mộc',
    url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Ẩm Thực Việt',
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Đặc Sản',
    url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=1000&auto=format&fit=crop&q=80',
  },
];

export default function DashboardSettingsPage() {
  const { activeShop, refreshDashboard } = useDashboard();

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

  const [supportedLangs, setSupportedLangs] =
    useState<SupportedLocale[]>(ALL_LOCALES);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [shopItems, setShopItems] = useState<CatalogItem[]>([]);

  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!activeShop) return;
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

    setSupportedLangs(
      activeShop.supported_langs?.length
        ? activeShop.supported_langs
        : ALL_LOCALES
    );
    setOpeningHours(activeShop.opening_hours);

    // Fetch catalog items for the live phone preview
    fetch(`/api/catalog?shopId=${activeShop.id}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.items)) {
          setShopItems(data.items);
        }
      })
      .catch(() => {});
  }, [activeShop]);

  if (!activeShop || !openingHours) return null;

  const toggleLocale = (loc: SupportedLocale) => {
    if (loc === 'vi') return;
    setSupportedLangs((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };

  const handleUploadImage = async (
    file: File | undefined,
    onDone: (publicUrl: string) => void,
    fieldKey: string
  ) => {
    if (!file) return;
    setUploadingField(fieldKey);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        fileType: 'image/webp',
      });

      const reader = new FileReader();
      const base64Data: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name.replace(/\.[^.]+$/, '.webp'),
          contentType: 'image/webp',
          base64Data,
        }),
      });
      const data = await res.json();
      if (data.publicUrl) {
        onDone(data.publicUrl);
      }
    } catch {
      setErrorMsg('Không thể tải ảnh lên. Bạn có thể dán trực tiếp link ảnh.');
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setSavedSuccess(false);

    try {
      // Preserve promoBanner, welcomePopup, and flashSale configured in /dashboard/posts
      const nextThemeConfig: ShopThemeConfig = {
        ...activeShop.theme_config,
        primaryColor,
        layout: layoutMode,
        backgroundStyle,
        backgroundImageUrl: backgroundImageUrl.trim() || undefined,
        backgroundOverlayOpacity,
      };

      const nextCoverUrls = coverUrl.trim()
        ? [coverUrl.trim(), ...(activeShop.cover_urls || []).slice(1)]
        : activeShop.cover_urls || [];

      const res = await fetch('/api/shops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeShop.id,
          name,
          slug,
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
          opening_hours: openingHours,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Không thể lưu cài đặt');
      }

      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({ type: 'shop_updated', shopId: activeShop.id });
        bc.close();
      }

      await refreshDashboard();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi lưu cài đặt');
    } finally {
      setSaving(false);
    }
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
    },
  };

  return (
    <form onSubmit={handleSaveSettings} className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            Cài Đặt Quán &amp; Thiết Kế Màn Hình QR
          </h1>
          <p className="text-xs text-slate-500">
            Tùy chỉnh thương hiệu, màu sắc, hình nền và xem trước trực tiếp trên màn hình điện thoại mẫu
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/s/${activeShop.slug}/menu`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
            <span>Mở Menu Thực Tế</span>
          </a>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4" />
                <span>Đã Lưu!</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{saving ? 'Đang lưu...' : 'Lưu Cài Đặt'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold text-rose-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* 1. Studio Thiết Kế Giao Diện + Live Phone Viewer */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 Columns: Clean, uncluttered controls */}
          <div className="lg:col-span-7 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Palette className="h-4 w-4 text-emerald-600" />
                <span>1. Giao Diện &amp; Màu Sắc Màn Hình Khách</span>
              </h2>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                Cập nhật trực tiếp bên phải 👉
              </span>
            </div>

            {/* Pure Color Swatches (No Cluttered Titles) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2.5">
                Màu chủ đạo của quán
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
                      aria-label={`Chọn màu ${hex}`}
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
                  title="Tự chọn mã màu bất kỳ"
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
                Nền màn hình điện thoại
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { id: 'clean', label: '☀️ Sáng', previewBg: 'bg-slate-50 border-slate-200 text-slate-900' },
                  { id: 'warm', label: '🏮 Kem Ấm', previewBg: 'bg-[#fdf8ee] border-amber-200 text-amber-950' },
                  { id: 'dark', label: '🌙 Tối', previewBg: 'bg-slate-900 border-slate-700 text-white' },
                  { id: 'custom_image', label: '🖼️ Ảnh Nền', previewBg: 'bg-gradient-to-r from-emerald-900 to-slate-900 text-white' },
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
                  {BACKGROUND_IMAGE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
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
                        alt={preset.label}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-[9px] font-bold text-white truncate">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={backgroundImageUrl}
                    onChange={(e) => setBackgroundImageUrl(e.target.value)}
                    placeholder="Dán link ảnh nền hoặc tải ảnh lên..."
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                  />
                  <label className="cursor-pointer shrink-0 inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{uploadingField === 'bg' ? '...' : 'Tải ảnh'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadImage(
                          e.target.files?.[0],
                          (url) => setBackgroundImageUrl(url),
                          'bg'
                        )
                      }
                    />
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">
                    Độ tối lớp phủ ({Math.round(backgroundOverlayOpacity * 100)}%)
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
                Bố cục hiển thị món trên Menu
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
                      Danh sách ngang
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Gọn gàng, dễ chọn nhanh
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
                      Lưới ảnh 2 cột
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      Hình món to, bắt mắt
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Shortcut to Promotions & Flash Sale Studio */}
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-black text-amber-950">
                  <Zap className="h-4 w-4 text-rose-600" />
                  <span>
                    Muốn cài Giảm Giá Theo Món / Hóa Đơn, Flash Sale &amp; Banner?
                  </span>
                </div>
                <p className="text-[11px] text-amber-800">
                  Đã được chuyển sang mục <strong>Khuyến Mãi &amp; Flash Sale</strong> chuyên biệt để dễ quản lý hơn.
                </p>
              </div>
              <Link
                href="/dashboard/posts"
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white hover:bg-slate-800"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Mở Khuyến Mãi &amp; Flash Sale</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Right 5 Columns: Live Interactive Phone Viewer */}
          <div id="live-phone-preview" className="lg:col-span-5 flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
            <StorefrontPhonePreview
              shop={previewShop}
              items={shopItems}
              onOpenPopupPreview={() => setPreviewPopupOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* 2. Basic Store Identity, Logo & Cover Image */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Store className="h-4 w-4 text-emerald-600" />
          <span>2. Thông Tin Quán, Logo &amp; Ảnh Bìa</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Tên cửa hàng *
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
              Đường dẫn QR (Slug) *
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono font-bold text-emerald-700"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Loại hình kinh doanh
            </label>
            <select
              value={vertical}
              onChange={(e) => setVertical(e.target.value as BusinessVertical)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
            >
              <option value="fnb">🍜 Ẩm thực F&amp;B (Quán ăn, Cafe, Trà sữa)</option>
              <option value="service">
                💆‍♀️ Dịch vụ (Tiệm Nail, Spa, Massage, Salon)
              </option>
              <option value="retail">
                🛍️ Bán lẻ (Đặc sản, Tạp hóa, Quà lưu niệm)
              </option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Câu giới thiệu ngắn (Tagline)
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
              Mô tả chi tiết
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
              Logo quán
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
                placeholder="Dán link ảnh hoặc tải lên..."
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
              <label className="cursor-pointer shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">
                <Upload className="h-3.5 w-3.5" />
                <span>{uploadingField === 'logo' ? '...' : 'Tải ảnh'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    handleUploadImage(
                      e.target.files?.[0],
                      (url) => setLogoUrl(url),
                      'logo'
                    )
                  }
                />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Ảnh bìa đầu trang (Cover)
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
                placeholder="Dán link ảnh bìa hoặc tải lên..."
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
              />
              <label className="cursor-pointer shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200">
                <Upload className="h-3.5 w-3.5" />
                <span>{uploadingField === 'cover' ? '...' : 'Tải ảnh'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    handleUploadImage(
                      e.target.files?.[0],
                      (url) => setCoverUrl(url),
                      'cover'
                    )
                  }
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
            <span>3. Wi-Fi &amp; 8 Ngôn Ngữ Phục Vụ Khách</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tên Wi-Fi (SSID)
              </label>
              <input
                type="text"
                value={wifiSsid}
                onChange={(e) => setWifiSsid(e.target.value)}
                placeholder="VD: PhoHoiAn_Free5G"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Mật khẩu Wi-Fi
              </label>
              <input
                type="text"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="VD: 12345678"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              <Languages className="inline h-3.5 w-3.5 mr-1 text-emerald-600" />
              Ngôn ngữ hiển thị trên Menu QR:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_LOCALES.map((loc) => {
                const active = supportedLangs.includes(loc);
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocale(loc)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold ${
                      active
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    <FlagIcon locale={loc} className="h-3.5 w-5" />
                    <span>{LOCALE_META[loc].label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-rose-500" />
            <span>4. Địa Chỉ, Zalo &amp; Google Maps</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Địa chỉ cửa hàng
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
                Tỉnh / Thành phố
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
                Điện thoại liên hệ
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
                Số Zalo nhận đơn
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
                Link Google Maps chỉ đường
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
                Link Đánh giá 5⭐ Google Maps
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
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-600" />
          <span>5. Giờ Mở Cửa 7 Ngày Trong Tuần</span>
        </h2>

        <WeeklyOpeningHoursPicker
          openingHours={openingHours}
          onChange={(nextHours) => setOpeningHours(nextHours)}
        />
      </div>

      {/* Interactive Popup Preview Modal */}
      <StorefrontWelcomePopup
        shop={previewShop}
        isOpen={previewPopupOpen}
        onClose={() => setPreviewPopupOpen(false)}
      />
    </form>
  );
}
