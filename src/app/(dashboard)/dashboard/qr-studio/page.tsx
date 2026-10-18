'use client';

import React, { useState, useEffect } from 'react';
import { QrCode, Palette, Wifi } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { PrintableStandee } from '@/components/dashboard/PrintableStandee';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

const PRESET_COLORS = [
  { labelVi: 'Xanh ngọc', labelEn: 'Emerald', hex: '#10b981' },
  { labelVi: 'Tím', labelEn: 'Violet', hex: '#8b5cf6' },
  { labelVi: 'Vàng cam', labelEn: 'Amber', hex: '#f59e0b' },
  { labelVi: 'Đỏ hồng', labelEn: 'Rose', hex: '#e11d48' },
  { labelVi: 'Xanh biển', labelEn: 'Blue', hex: '#2563eb' },
  { labelVi: 'Đen xám', labelEn: 'Slate', hex: '#0f172a' },
];

export default function DashboardQrStudioPage() {
  const { activeShop } = useDashboard();
  const { tx } = useAppI18n();
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [showWifi, setShowWifi] = useState(true);
  const [accentColor, setAccentColor] = useState('#10b981');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (activeShop?.theme_config?.primaryColor) {
      setAccentColor(activeShop.theme_config.primaryColor);
    }
  }, [activeShop]);

  if (!activeShop) return null;

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800 mb-2">
          <QrCode className="h-3.5 w-3.5" />
          <span>{tx('Tạo & in mã QR • Khổ A6', 'QR Studio • A6 Standee')}</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          {tx('Mã QR', 'QR codes')}
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          {tx(
            'Tải ảnh PNG sắc nét (300 DPI) để in bảng để bàn hoặc dán cửa.',
            'Download sharp PNG (300 DPI) for table standees or door decals.'
          )}
        </p>
      </div>

      {/* Studio Customization Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 mr-1">
            <Palette className="h-4 w-4 text-emerald-600" />
            {tx('Màu khung:', 'Frame color:')}
          </span>
          {PRESET_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setAccentColor(c.hex)}
              className={`h-7 w-7 rounded-full border-2 transition-transform ${
                accentColor === c.hex
                  ? 'scale-110 border-emerald-500 ring-2 ring-emerald-400/60'
                  : 'border-white/80 shadow-xs'
              }`}
              style={{ backgroundColor: c.hex }}
              title={tx(c.labelVi, c.labelEn)}
              aria-label={tx(c.labelVi, c.labelEn)}
            />
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showWifi}
            onChange={(e) => setShowWifi(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <Wifi className="h-3.5 w-3.5 text-emerald-600" />
          <span>{tx('In kèm Wi-Fi trên bảng QR', 'Include Wi-Fi on QR card')}</span>
        </label>
      </div>

      {/* Dual Standee Preview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Door QR Standee */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
          <div className="text-center space-y-1">
            <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-extrabold text-emerald-800">
              {tx('1. QR DÁN CỬA / LỄ TÂN (?src=door)', '1. DOOR / RECEPTION QR (?src=door)')}
            </span>
            <p className="text-xs text-slate-500">
              {tx(
                'Mở trang giới thiệu quán: giờ mở cửa, Wi-Fi, bản đồ, ưu đãi và nút vào thực đơn.',
                'Opens store info page: hours, Wi-Fi, map directions, promos, and menu button.'
              )}
            </p>
          </div>

          <PrintableStandee
            shop={activeShop}
            qrType="door"
            baseUrl={baseUrl}
            showWifi={showWifi}
            accentColor={accentColor}
          />
        </div>

        {/* 2. Table QR Standee */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
          <div className="text-center space-y-1">
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-[11px] font-extrabold text-amber-900">
              {tx('2. QR ĐẶT TẠI BÀN (?src=table)', '2. TABLE / SEAT QR (?src=table)')}
            </span>
            <p className="text-xs text-slate-500">
              {tx(
                'Mở thẳng thực đơn 8 ngôn ngữ để khách chọn món và gửi đơn xuống quầy.',
                'Opens the 8-language menu directly so guests can order from their table.'
              )}
            </p>
          </div>

          <PrintableStandee
            shop={activeShop}
            qrType="table"
            baseUrl={baseUrl}
            showWifi={showWifi}
            accentColor={accentColor}
          />
        </div>
      </div>
    </div>
  );
}
