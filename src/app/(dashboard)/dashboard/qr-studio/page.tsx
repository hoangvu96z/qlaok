'use client';

import React, { useState, useEffect } from 'react';
import { QrCode, Palette, Wifi } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { PrintableStandee } from '@/components/dashboard/PrintableStandee';

const PRESET_COLORS = [
  { label: 'Xanh Ngọc (Emerald)', hex: '#10b981' },
  { label: 'Tím Spa (Violet)', hex: '#8b5cf6' },
  { label: 'Cam Ẩm Thực (Amber)', hex: '#f59e0b' },
  { label: 'Đỏ Truyền Thống (Rose)', hex: '#e11d48' },
  { label: 'Xanh Biển (Blue)', hex: '#2563eb' },
  { label: 'Đen Sang Trọng (Slate)', hex: '#0f172a' },
];

export default function DashboardQrStudioPage() {
  const { activeShop } = useDashboard();
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
          <span>QR Code & Print Studio • Chuẩn Standee A6</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          Hệ Thống 2 Mã QR Chuyên Biệt ({activeShop.name})
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Tải file ảnh PNG độ phân giải cao (300 DPI) để in Standee mica để bàn hoặc decal dán trước cửa quán.
        </p>
      </div>

      {/* Studio Customization Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 mr-1">
            <Palette className="h-4 w-4 text-emerald-600" />
            Màu khung Standee:
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
              title={c.label}
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
          <span>In kèm mật khẩu Wi-Fi trên bảng QR</span>
        </label>
      </div>

      {/* Dual Standee Preview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Door QR Standee */}
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
          <div className="text-center space-y-1">
            <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-[11px] font-extrabold text-emerald-800">
              1. MÃ QR DÁN CỬA / QUẦY LỄ TÂN (?src=door)
            </span>
            <p className="text-xs text-slate-500">
              Khách quét mở <strong>Trang Thông Tin Cửa Hàng</strong> (Giờ mở cửa, Copy Wi-Fi 1 chạm, Chỉ đường Maps, Khuyến mãi & Nút mở Menu)
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
              2. MÃ QR ĐẶT TẠI BÀN / GHẾ DỊCH VỤ (?src=table)
            </span>
            <p className="text-xs text-slate-500">
              Khách ngồi vào bàn quét mở <strong>thẳng vào trang Menu / Bảng Giá 8 Ngôn Ngữ</strong> và gửi đơn trực tiếp xuống quầy/bếp
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
