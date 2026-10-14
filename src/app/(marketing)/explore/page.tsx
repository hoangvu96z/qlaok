'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  MapPin,
  Wifi,
  QrCode,
  UtensilsCrossed,
  Scissors,
  ShoppingBag,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { BusinessVertical, Shop } from '@/types/qlaok';
import { checkShopOpenStatus, LOCALE_META } from '@/lib/i18n-helper';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { FlagIcon } from '@/components/ui/FlagIcon';

export default function ExploreDirectoryPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedVertical, setSelectedVertical] = useState<
    BusinessVertical | 'all'
  >('all');
  const [selectedCity, setSelectedCity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/shops', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setShops(data.shops || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const cities = VIETNAM_PROVINCES_34.map((p) => p.name);

  const filteredShops = shops.filter((shop) => {
    const matchVert =
      selectedVertical === 'all' || shop.vertical === selectedVertical;
    const matchCity = selectedCity === 'all' || shop.city === selectedCity;
    const q = searchQuery.trim().toLowerCase();
    const matchSearch =
      !q ||
      shop.name.toLowerCase().includes(q) ||
      (shop.tagline_i18n.vi || '').toLowerCase().includes(q) ||
      (shop.tagline_i18n.en || '').toLowerCase().includes(q) ||
      (shop.address || '').toLowerCase().includes(q);
    return matchVert && matchCity && matchSearch;
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white font-black text-lg">
              Q
            </div>
            <span className="text-base font-black text-slate-900">
              Qlaok Directory
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Quản trị CMS
            </Link>
            <Link
              href="/onboarding"
              className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-500"
            >
              + Đăng ký quán miễn phí
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
            Khám Phá Cửa Hàng Sử Dụng Menu Đa Ngôn Ngữ Qlaok
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Danh bạ các quán ăn, cà phê, tiệm Nail/Spa và cửa hàng đặc sản hỗ trợ thực đơn 5 ngôn ngữ (Việt, Anh, Hàn, Nhật, Trung) kèm giá niêm yết minh bạch.
          </p>
        </div>

        {/* Search & Filters */}
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên quán, món phở, gội đầu dưỡng sinh, đặc sản..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-2.5 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-800"
            >
              <option value="all">📍 Tất cả khu vực ({shops.length})</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  📍 {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
            {[
              { id: 'all', label: 'Tất cả ngành nghề' },
              { id: 'fnb', label: '🍜 Ẩm thực F&B (Quán ăn, Cafe)' },
              { id: 'service', label: '💆‍♀️ Dịch vụ (Tiệm Nail, Spa, Massage)' },
              { id: 'retail', label: '🛍️ Bán lẻ & Đặc sản quà biếu' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setSelectedVertical(tab.id as BusinessVertical | 'all')
                }
                className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                  selectedVertical === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Store Cards Grid */}
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-slate-500">
            Đang tải danh sách cửa hàng...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {filteredShops.map((shop) => {
              const openStatus = checkShopOpenStatus(shop.opening_hours);
              return (
                <div
                  key={shop.id}
                  className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="relative h-44 bg-slate-900">
                      {shop.cover_urls?.[0] && (
                        <img
                          src={shop.cover_urls[0]}
                          alt={shop.name}
                          className="h-full w-full object-cover opacity-90"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-transparent to-transparent" />

                      <span
                        className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          openStatus.isOpen
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-rose-600 text-white'
                        }`}
                      >
                        {openStatus.isOpen ? '● Đang mở cửa' : 'Đã đóng cửa'}
                      </span>

                      <div className="absolute bottom-3 left-3 right-3 text-white">
                        <h2 className="text-base font-black truncate">
                          {shop.name}
                        </h2>
                        <p className="text-[11px] text-slate-200 line-clamp-1">
                          {shop.tagline_i18n.vi}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 space-y-2.5">
                      {shop.address && (
                        <div className="flex items-start gap-1.5 text-xs text-slate-600">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600 mt-0.5" />
                          <span>{shop.address}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs pt-1">
                        <div className="flex items-center gap-1.5">
                          {shop.supported_langs.map((l) => (
                            <FlagIcon
                              key={l}
                              locale={l}
                              className="h-3.5 w-5"
                              title={LOCALE_META[l]?.label}
                            />
                          ))}
                        </div>
                        {shop.wifi_info?.ssid && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <Wifi className="h-3 w-3" /> Free Wi-Fi
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3.5 bg-slate-50/60">
                    <Link
                      href={`/s/${shop.slug}?src=door`}
                      className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white py-2 px-3 text-xs font-bold text-slate-800 hover:bg-slate-100"
                    >
                      <span>Trang Cửa Hàng</span>
                    </Link>
                    <Link
                      href={`/s/${shop.slug}/menu?src=table`}
                      style={{
                        backgroundColor:
                          shop.theme_config?.primaryColor || '#10b981',
                      }}
                      className="flex items-center justify-center gap-1 rounded-xl py-2 px-3 text-xs font-black text-white shadow-2xs hover:opacity-95"
                    >
                      <span>Xem Menu QR</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
