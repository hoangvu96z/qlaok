'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  MapPin,
  Wifi,
  ArrowRight,
  Store,
} from 'lucide-react';
import { BusinessVertical, Shop } from '@/types/qlaok';
import { checkShopOpenStatus, LOCALE_META } from '@/lib/i18n-helper';
import { VIETNAM_PROVINCES_34 } from '@/lib/vietnam-provinces';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { BrandLogo } from '@/components/ui/BrandLogo';
import {
  AppLanguageSwitcher,
  useAppI18n,
} from '@/components/ui/AppI18nProvider';

export default function ExploreDirectoryPage() {
  const { t, tx } = useAppI18n();
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

  const handleResetFilters = () => {
    setSelectedVertical('all');
    setSelectedCity('all');
    setSearchQuery('');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3.5 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <BrandLogo className="h-9 w-9 rounded-xl" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-black text-slate-900">
                Qlaok Directory
              </span>
              <span className="hidden sm:inline text-xs font-bold text-slate-500">
                {tx('· Khám phá quán', '· Explore Stores')}
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <AppLanguageSwitcher />
            <Link
              href="/pricing"
              className="hidden sm:inline-flex rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              {tx('Bảng giá', 'Pricing')}
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              {tx('Quản lý quán', 'Manage Store')}
            </Link>
            <Link
              href="/onboarding"
              className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-black text-white hover:bg-emerald-500"
            >
              {tx('+ Tạo quán mới', '+ Create Store')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
            {tx(
              'Khám phá quán',
              'Explore stores'
            )}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            {tx(
              'Danh bạ các quán ăn, cà phê, tiệm Nail/Spa và cửa hàng đặc sản hỗ trợ thực đơn đa ngôn ngữ kèm giá niêm yết minh bạch.',
              'Browse restaurants, cafes, nail & spa salons, and specialty shops offering multilingual digital menus with transparent pricing.'
            )}
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
                aria-label={tx('Tìm kiếm cửa hàng', 'Search stores')}
                placeholder={tx(
                  'Tìm tên quán, món phở, gội đầu dưỡng sinh, đặc sản...',
                  'Search store name, pho, spa services, specialty gifts...'
                )}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 py-2.5 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              aria-label={tx(
                'Lọc theo tỉnh hoặc thành phố',
                'Filter by city or province'
              )}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-bold text-slate-800"
            >
              <option value="all">
                {tx(
                  '📍 Tất cả khu vực ({count})',
                  '📍 All locations ({count})',
                  { count: shops.length }
                )}
              </option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  📍 {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
            {[
              {
                id: 'all',
                label: tx('Tất cả ngành hàng', 'All categories'),
              },
              {
                id: 'fnb',
                label: tx('🍜 Quán ăn & Cafe', '🍜 Food & Cafe'),
              },
              {
                id: 'service',
                label: tx(
                  '💆‍♀️ Nail, Spa & Dịch vụ',
                  '💆‍♀️ Nail, Spa & Services'
                ),
              },
              {
                id: 'retail',
                label: tx(
                  '🛍️ Bán lẻ & Đặc sản',
                  '🛍️ Retail & Specialties'
                ),
              },
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
            {tx('Đang tải danh sách cửa hàng...', 'Loading stores...')}
          </div>
        ) : filteredShops.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center space-y-3 shadow-2xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Store className="h-6 w-6" />
            </div>
            <h2 className="text-base font-black text-slate-900">
              {tx(
                'Không tìm thấy cửa hàng phù hợp',
                'No matching stores found'
              )}
            </h2>
            <p className="mx-auto max-w-md text-xs text-slate-500">
              {tx(
                'Thử từ khóa khác hoặc xóa bộ lọc khu vực và ngành hàng để xem tất cả cửa hàng.',
                'Try a different keyword or reset the location and category filters to view all stores.'
              )}
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={handleResetFilters}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                {t('common.clearFilters')}
              </button>
            </div>
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
                        {openStatus.isOpen
                          ? tx('● Đang mở cửa', '● Open now')
                          : tx('Đã đóng cửa', 'Closed')}
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
                            <Wifi className="h-3 w-3" />{' '}
                            {tx('Wi-Fi miễn phí', 'Free Wi-Fi')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 p-3.5 bg-slate-50/60">
                    {/* Always enter via the door page so analytics count a door visit (not a table scan) */}
                    <Link
                      href={`/s/${shop.slug}`}
                      style={{
                        backgroundColor:
                          shop.theme_config?.primaryColor || '#10b981',
                      }}
                      className="flex items-center justify-center gap-1 rounded-xl py-2 px-3 text-xs font-black text-white shadow-2xs hover:opacity-95"
                    >
                      <span>{tx('Xem quán & Menu', 'View Store & Menu')}</span>
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
