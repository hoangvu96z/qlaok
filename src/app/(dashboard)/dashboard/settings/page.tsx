'use client';

import React, { useState, useEffect } from 'react';
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
  Gift,
  Flame,
  Eye,
  Upload,
  LayoutGrid,
  List,
  ExternalLink,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import {
  BusinessVertical,
  OpeningHours,
  ShopPopupConfig,
  ShopPromoBannerConfig,
  ShopThemeConfig,
  SupportedLocale,
} from '@/types/qlaok';
import { ALL_LOCALES, LOCALE_META } from '@/lib/i18n-helper';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { FlagIcon } from '@/components/ui/FlagIcon';
import {
  StorefrontPromoBanner,
  StorefrontWelcomePopup,
} from '@/components/storefront/StorefrontCustomDecor';

const DAYS_LIST: Array<{ key: keyof OpeningHours; label: string }> = [
  { key: 'mon', label: 'Thứ 2' },
  { key: 'tue', label: 'Thứ 3' },
  { key: 'wed', label: 'Thứ 4' },
  { key: 'thu', label: 'Thứ 5' },
  { key: 'fri', label: 'Thứ 6' },
  { key: 'sat', label: 'Thứ 7' },
  { key: 'sun', label: 'Chủ Nhật' },
];

const COLOR_PRESETS = [
  { label: 'Xanh Ngọc', hex: '#10b981' },
  { label: 'Cam Vàng', hex: '#f59e0b' },
  { label: 'Đỏ Hồng', hex: '#f43f5e' },
  { label: 'Tím Spa', hex: '#8b5cf6' },
  { label: 'Xanh Biển', hex: '#0ea5e9' },
  { label: 'Đỏ Truyền Thống', hex: '#dc2626' },
  { label: 'Nâu Cà Phê', hex: '#92400e' },
  { label: 'Đen Sang Trọng', hex: '#1e293b' },
];

const BACKGROUND_IMAGE_PRESETS = [
  {
    label: 'Phố Cổ Hội An',
    url: 'https://images.unsplash.com/photo-1559592413-7cec4d0cae2b?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Gỗ Ấm Nhà Hàng',
    url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Quán Cà Phê Chill',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Spa Thảo Mộc',
    url: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Bàn Ăn Việt Nam',
    url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Quà Đặc Sản',
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

  // Promo Banner config
  const [promoBanner, setPromoBanner] = useState<ShopPromoBannerConfig>({
    enabled: false,
    badgeText: '🔥 KHUYẾN MÃI HOT',
    title: 'Giảm 15% tổng hóa đơn cho khách đặt món qua QR tại bàn',
    subtitle: 'Áp dụng từ 14:00 - 17:00 hàng ngày • Tự động trừ khi thanh toán',
    imageUrl: '',
    bgGradient: 'amber_rose',
    ctaText: 'Xem Voucher',
  });

  // Welcome Popup config
  const [welcomePopup, setWelcomePopup] = useState<ShopPopupConfig>({
    enabled: false,
    badgeText: '🎁 QUÀ TẶNG CHÀO MỪNG',
    title: 'Tặng miễn phí 1 ly Trà Sâm Dứa Hội An!',
    content:
      'Chỉ cần gọi từ 2 món chính hoặc đánh giá 5 sao trên Google Maps để nhận ngay ưu đãi tại quầy.',
    imageUrl:
      'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&auto=format&fit=crop&q=80',
    voucherCode: 'WELCOME2026',
    ctaText: 'Nhận ưu đãi & Xem Menu ngay',
  });

  const [supportedLangs, setSupportedLangs] =
    useState<SupportedLocale[]>(ALL_LOCALES);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);

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

    if (tc?.promoBanner) {
      setPromoBanner({
        enabled: Boolean(tc.promoBanner.enabled),
        badgeText: tc.promoBanner.badgeText || '🔥 KHUYẾN MÃI HOT',
        title: tc.promoBanner.title || '',
        subtitle: tc.promoBanner.subtitle || '',
        imageUrl: tc.promoBanner.imageUrl || '',
        bgGradient: tc.promoBanner.bgGradient || 'amber_rose',
        ctaText: tc.promoBanner.ctaText || 'Xem ưu đãi',
      });
    }

    if (tc?.welcomePopup) {
      setWelcomePopup({
        enabled: Boolean(tc.welcomePopup.enabled),
        badgeText: tc.welcomePopup.badgeText || '🎁 QUÀ TẶNG ĐẶC BIỆT',
        title: tc.welcomePopup.title || '',
        content: tc.welcomePopup.content || '',
        imageUrl: tc.welcomePopup.imageUrl || '',
        voucherCode: tc.welcomePopup.voucherCode || '',
        ctaText: tc.welcomePopup.ctaText || 'Nhận ưu đãi & Xem Menu ngay',
      });
    }

    setSupportedLangs(
      activeShop.supported_langs?.length
        ? activeShop.supported_langs
        : ALL_LOCALES
    );
    setOpeningHours(activeShop.opening_hours);
  }, [activeShop]);

  if (!activeShop || !openingHours) return null;

  const toggleLocale = (loc: SupportedLocale) => {
    if (loc === 'vi') return; // Vietnamese is always enabled
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
      const nextThemeConfig: ShopThemeConfig = {
        primaryColor,
        layout: layoutMode,
        backgroundStyle,
        backgroundImageUrl: backgroundImageUrl.trim() || undefined,
        backgroundOverlayOpacity,
        promoBanner,
        welcomePopup,
      };

      const nextCoverUrls = coverUrl.trim()
        ? [
            coverUrl.trim(),
            ...(activeShop.cover_urls || []).slice(1),
          ]
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

  // Construct preview shop object for live banner & popup preview
  const previewShop = {
    ...activeShop,
    name: name || activeShop.name,
    logo_url: logoUrl || activeShop.logo_url,
    cover_urls: coverUrl ? [coverUrl] : activeShop.cover_urls,
    theme_config: {
      primaryColor,
      layout: layoutMode,
      backgroundStyle,
      backgroundImageUrl,
      backgroundOverlayOpacity,
      promoBanner,
      welcomePopup: {
        ...welcomePopup,
        enabled: true,
      },
    },
  };

  return (
    <form onSubmit={handleSaveSettings} className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">
            Cài Đặt Quán, Giao Diện, Hình Nền &amp; Khuyến Mãi
          </h1>
          <p className="text-xs text-slate-500">
            Tùy biến giao diện màn hình quán, hình nền, màu sắc thương hiệu, Banner ưu đãi, Popup Voucher và 8 ngôn ngữ phục vụ khách
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/s/${activeShop.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5 text-emerald-600" />
            <span>Mở Trang Quán</span>
          </a>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-500 disabled:opacity-50"
          >
            {savedSuccess ? (
              <>
                <Check className="h-4 w-4" />
                <span>Đã Lưu Thành Công!</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>{saving ? 'Đang lưu...' : 'Lưu Tất Cả Cài Đặt'}</span>
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

      {/* 1. Basic Store Identity, Logo & Cover Image */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Store className="h-4 w-4 text-emerald-600" />
          <span>1. Thông Tin Cơ Bản, Logo &amp; Ảnh Bìa Quán</span>
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
                🛍️ Bán lẻ (Đặc sản, Quà lưu niệm, Shop)
              </option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Câu khẩu hiệu ngắn (Tagline Tiếng Việt)
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
              Mô tả giới thiệu quán
            </label>
            <input
              type="text"
              value={descVi}
              onChange={(e) => setDescVi(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900"
            />
          </div>
        </div>

        {/* Logo & Hero Cover Upload */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Ảnh đại diện / Logo quán
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
              Ảnh bìa lớn đầu trang (Hero Banner)
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

      {/* 2. Storefront Theme, Color, Layout & Background Image Customizer */}
      <div className="rounded-3xl border-2 border-emerald-500/30 bg-white p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Palette className="h-4 w-4 text-emerald-600" />
              <span>
                2. Thiết Kế Giao Diện Màn Hình Quán (Màu Sắc, Bố Cục &amp; Hình Nền)
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tùy chỉnh màu nút bấm, kiểu hiển thị thực đơn và hình nền riêng cho màn hình điện thoại của khách
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Brand Color & Menu Layout */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Màu thương hiệu chủ đạo (Nút gọi món, tab danh mục, điểm nhấn):
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {COLOR_PRESETS.map((preset) => {
                  const selected =
                    primaryColor.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => setPrimaryColor(preset.hex)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                        selected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-white/50"
                        style={{ backgroundColor: preset.hex }}
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}

                <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent"
                  />
                  <span className="font-mono">{primaryColor}</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Bố cục hiển thị món ăn / dịch vụ trên Menu:
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
                  <List className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <span className="block text-xs font-extrabold">
                      Danh sách ngang (List)
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      Đọc nhanh, chuẩn F&amp;B / Spa
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
                  <LayoutGrid className="h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <span className="block text-xs font-extrabold">
                      Lưới ảnh lớn 2 cột (Grid)
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      Khoe ảnh món &amp; sản phẩm đẹp
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Background Style & Custom Wallpaper */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Phong cách nền màn hình quán (Background):
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'clean', label: '☀️ Trắng Sáng', sub: 'Tinh tế, sạch sẽ' },
                  { id: 'warm', label: '🏮 Kem Ấm', sub: 'Phong cách Phố Cổ' },
                  { id: 'dark', label: '🌙 Tối Sang Trọng', sub: 'Lounge / Bar / Spa' },
                  {
                    id: 'custom_image',
                    label: '🖼️ Hình Nền Riêng',
                    sub: 'Ảnh nền toàn màn hình',
                  },
                ].map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    onClick={() =>
                      setBackgroundStyle(
                        bg.id as NonNullable<ShopThemeConfig['backgroundStyle']>
                      )
                    }
                    className={`rounded-2xl border p-2.5 text-left transition ${
                      backgroundStyle === bg.id
                        ? 'border-emerald-600 bg-emerald-50/80 text-emerald-950'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block text-xs font-extrabold">
                      {bg.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {bg.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {backgroundStyle === 'custom_image' && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5 text-emerald-600" />
                    Chọn nhanh hình nền mẫu hoặc tải ảnh riêng:
                  </span>
                </div>

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
                  <input
                    type="text"
                    value={backgroundImageUrl}
                    onChange={(e) => setBackgroundImageUrl(e.target.value)}
                    placeholder="Dán URL hình nền hoặc bấm Tải ảnh..."
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                  />
                  <label className="cursor-pointer shrink-0 inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {uploadingField === 'bg' ? 'Đang tải...' : 'Tải hình nền'}
                    </span>
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
                  <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                    Độ phủ tối làm nổi bật chữ:{' '}
                    {Math.round(backgroundOverlayOpacity * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0.3"
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
          </div>
        </div>
      </div>

      {/* 3. Banner Khuyến Mãi & Popup Voucher Studio + Live Preview */}
      <div className="rounded-3xl border-2 border-amber-500/30 bg-white p-5 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span>
                3. Thiết Lập Banner Khuyến Mãi &amp; Popup Voucher Chào Mừng Khách
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tạo Banner thu hút ánh nhìn trên đầu Menu và Popup tự động bật lên tặng quà / mã giảm giá ngay khi khách quét QR
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPreviewPopupOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 shadow-xs hover:bg-amber-400"
          >
            <Eye className="h-4 w-4" />
            <span>Xem Thử Popup Ngay</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sub-card A: Promo Banner Config */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                  A. Banner Khuyến Mãi Đầu Trang
                </span>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
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
                <span className="text-xs font-bold text-slate-800">
                  {promoBanner.enabled ? 'Đang bật hiển thị' : 'Đang tắt'}
                </span>
              </label>
            </div>

            {/* Quick Presets for Banner */}
            <div className="flex flex-wrap gap-1.5">
              {[
                {
                  label: '⚡ Giảm 15% Giờ Vàng',
                  badge: '⚡ HAPPY HOUR',
                  title: 'Giảm ngay 15% tổng hóa đơn khung giờ 14:00 - 17:00',
                  sub: 'Áp dụng cho mọi khách đặt món trực tiếp qua mã QR tại bàn',
                },
                {
                  label: '🍹 Tặng Trà Tráng Miệng',
                  badge: '🎁 QUÀ TẶNG',
                  title: 'Tặng miễn phí 1 ly Trà Sâm Dứa hoặc Bánh Dừa Nướng',
                  sub: 'Khi gọi từ 2 món chính hoặc đánh giá 5 sao Google Maps',
                },
                {
                  label: '🔥 Combo Đi Nhóm',
                  badge: '🔥 COMBO NHÓM',
                  title: 'Đi 4 Tính Tiền 3 • Miễn phí nâng size đồ uống',
                  sub: 'Ưu đãi đặc biệt dành cho nhóm khách gia đình & bạn bè',
                },
              ].map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      enabled: true,
                      badgeText: tpl.badge,
                      title: tpl.title,
                      subtitle: tpl.sub,
                    }))
                  }
                  className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                >
                  {tpl.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Nhãn nổi bật (Badge)
                </label>
                <input
                  type="text"
                  value={promoBanner.badgeText || ''}
                  onChange={(e) =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      badgeText: e.target.value,
                    }))
                  }
                  placeholder="VD: 🔥 FLASH SALE"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Tông màu nền Banner
                </label>
                <select
                  value={promoBanner.bgGradient || 'amber_rose'}
                  onChange={(e) =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      bgGradient: e.target
                        .value as ShopPromoBannerConfig['bgGradient'],
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
                >
                  <option value="amber_rose">🔥 Cam - Đỏ Rực Rỡ</option>
                  <option value="emerald_teal">🌿 Xanh Ngọc Tươi Mát</option>
                  <option value="violet_fuchsia">✨ Tím Hồng Sang Trọng</option>
                  <option value="royal_gold">👑 Đen Vàng Hoàng Gia</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Tiêu đề khuyến mãi trên Banner *
              </label>
              <input
                type="text"
                value={promoBanner.title}
                onChange={(e) =>
                  setPromoBanner((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="VD: Giảm 15% tổng hóa đơn từ 14h - 17h"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Dòng mô tả phụ bên dưới
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
                placeholder="VD: Áp dụng cho khách đặt qua QR tại bàn"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Chữ trên nút bấm (Mở Popup)
                </label>
                <input
                  type="text"
                  value={promoBanner.ctaText || ''}
                  onChange={(e) =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      ctaText: e.target.value,
                    }))
                  }
                  placeholder="VD: Xem Voucher"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Ảnh góc phải Banner (Tùy chọn)
                </label>
                <input
                  type="text"
                  value={promoBanner.imageUrl || ''}
                  onChange={(e) =>
                    setPromoBanner((prev) => ({
                      ...prev,
                      imageUrl: e.target.value,
                    }))
                  }
                  placeholder="Dán URL ảnh minh họa..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Live Preview of Banner */}
            <div className="pt-2">
              <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                Xem trước Banner khuyến mãi:
              </span>
              <StorefrontPromoBanner
                shop={{
                  ...previewShop,
                  theme_config: {
                    ...previewShop.theme_config,
                    promoBanner: { ...promoBanner, enabled: true },
                  },
                }}
                onOpenPopup={() => setPreviewPopupOpen(true)}
              />
            </div>
          </div>

          {/* Sub-card B: Welcome Popup & Voucher Config */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-rose-500" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                  B. Popup Chào Mừng / Tặng Mã Voucher
                </span>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={welcomePopup.enabled}
                  onChange={(e) =>
                    setWelcomePopup((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                <span className="text-xs font-bold text-slate-800">
                  {welcomePopup.enabled ? 'Tự động bật khi quét QR' : 'Đang tắt'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Nhãn trên Popup
                </label>
                <input
                  type="text"
                  value={welcomePopup.badgeText || ''}
                  onChange={(e) =>
                    setWelcomePopup((prev) => ({
                      ...prev,
                      badgeText: e.target.value,
                    }))
                  }
                  placeholder="VD: 🎁 QUÀ TẶNG ĐẶC BIỆT"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Mã Voucher (Khách chạm Copy)
                </label>
                <input
                  type="text"
                  value={welcomePopup.voucherCode || ''}
                  onChange={(e) =>
                    setWelcomePopup((prev) => ({
                      ...prev,
                      voucherCode: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="VD: WELCOME2026 (Để trống nếu không dùng)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-bold text-emerald-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Tiêu đề Popup khuyến mãi *
              </label>
              <input
                type="text"
                value={welcomePopup.title}
                onChange={(e) =>
                  setWelcomePopup((prev) => ({
                    ...prev,
                    title: e.target.value,
                  }))
                }
                placeholder="VD: Tặng miễn phí 1 ly Trà Sâm Dứa Hội An!"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Nội dung chi tiết chương trình
              </label>
              <textarea
                rows={2}
                value={welcomePopup.content}
                onChange={(e) =>
                  setWelcomePopup((prev) => ({
                    ...prev,
                    content: e.target.value,
                  }))
                }
                placeholder="VD: Áp dụng cho khách hàng gọi từ 2 món chính hoặc đánh giá 5 sao trên Google Maps."
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Ảnh minh họa Popup
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={welcomePopup.imageUrl || ''}
                    onChange={(e) =>
                      setWelcomePopup((prev) => ({
                        ...prev,
                        imageUrl: e.target.value,
                      }))
                    }
                    placeholder="Dán link ảnh hoặc tải lên..."
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                  />
                  <label className="cursor-pointer shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">
                    <Upload className="h-3.5 w-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) =>
                        handleUploadImage(
                          e.target.files?.[0],
                          (url) =>
                            setWelcomePopup((prev) => ({
                              ...prev,
                              imageUrl: url,
                            })),
                          'popup'
                        )
                      }
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Chữ trên nút hành động Popup
                </label>
                <input
                  type="text"
                  value={welcomePopup.ctaText || ''}
                  onChange={(e) =>
                    setWelcomePopup((prev) => ({
                      ...prev,
                      ctaText: e.target.value,
                    }))
                  }
                  placeholder="VD: Nhận ưu đãi & Xem Menu ngay"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Wi-Fi, 8 Languages & Contact / Maps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
          <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-emerald-600" />
            <span>4. Cấu Hình Wi-Fi 1 Chạm &amp; 8 Ngôn Ngữ Quốc Tế</span>
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tên mạng Wi-Fi (SSID)
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
              Ngôn ngữ kích hoạt trên Menu QR (8 ngôn ngữ):
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_LOCALES.map((loc) => {
                const active = supportedLangs.includes(loc);
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocale(loc)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold ${
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
            <span>5. Địa Chỉ, Zalo &amp; Google Maps Review</span>
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
                Tỉnh / Thành phố (34 tỉnh thành)
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
                Số điện thoại liên hệ
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

      {/* 6. 7-Day Opening Hours */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-600" />
          <span>
            6. Giờ Mở Cửa 7 Ngày Trong Tuần (Tự động bật/tắt trạng thái Đang mở cửa)
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DAYS_LIST.map(({ key, label }) => {
            const sched = openingHours[key];
            return (
              <div
                key={key}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    {label}
                  </span>
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!sched.closed}
                      onChange={(e) =>
                        setOpeningHours((prev) =>
                          prev
                            ? {
                                ...prev,
                                [key]: {
                                  ...prev[key],
                                  closed: !e.target.checked,
                                },
                              }
                            : prev
                        )
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>{sched.closed ? 'Nghỉ' : 'Mở cửa'}</span>
                  </label>
                </div>

                {!sched.closed && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <input
                      type="time"
                      value={sched.open}
                      onChange={(e) =>
                        setOpeningHours((prev) =>
                          prev
                            ? {
                                ...prev,
                                [key]: { ...prev[key], open: e.target.value },
                              }
                            : prev
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                    />
                    <span>-</span>
                    <input
                      type="time"
                      value={sched.close}
                      onChange={(e) =>
                        setOpeningHours((prev) =>
                          prev
                            ? {
                                ...prev,
                                [key]: { ...prev[key], close: e.target.value },
                              }
                            : prev
                        )
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Popup Preview Modal inside Settings */}
      <StorefrontWelcomePopup
        shop={previewShop}
        isOpen={previewPopupOpen}
        onClose={() => setPreviewPopupOpen(false)}
      />
    </form>
  );
}
