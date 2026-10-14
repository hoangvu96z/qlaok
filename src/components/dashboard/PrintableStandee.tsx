'use client';

import React, { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { Download, Wifi, ExternalLink, Copy, Check } from 'lucide-react';
import { Shop } from '@/types/qlaok';
import { FlagIcon } from '@/components/ui/FlagIcon';

interface PrintableStandeeProps {
  shop: Shop;
  qrType: 'door' | 'table';
  baseUrl: string;
  showWifi?: boolean;
  accentColor?: string;
}

export function PrintableStandee({
  shop,
  qrType,
  baseUrl,
  showWifi = true,
  accentColor,
}: PrintableStandeeProps) {
  const standeeRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const primaryColor = accentColor || shop.theme_config?.primaryColor || '#10b981';

  const targetUrl =
    qrType === 'door'
      ? `${baseUrl}/s/${shop.slug}?src=door`
      : `${baseUrl}/s/${shop.slug}/menu?src=table`;

  const relativePath =
    qrType === 'door'
      ? `/s/${shop.slug}?src=door`
      : `/s/${shop.slug}/menu?src=table`;

  const handleDownloadPng = async () => {
    if (!standeeRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(standeeRef.current, {
        cacheBust: true,
        pixelRatio: 3, // High-resolution 300DPI-grade A6 export
      });
      const link = document.createElement('a');
      link.download = `Qlaok-QR-${qrType.toUpperCase()}-${shop.slug}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export standee PNG:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Printable A6 Standee Card */}
      <div
        ref={standeeRef}
        className="w-full max-w-[340px] rounded-3xl bg-white p-6 shadow-xl border-2 border-slate-200 flex flex-col items-center text-center relative overflow-hidden"
      >
        {/* Top Accent Header */}
        <div
          className="w-full rounded-2xl px-4 py-3 text-white shadow-sm mb-4"
          style={{ backgroundColor: primaryColor }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-widest opacity-90">
            {qrType === 'door'
              ? '🏪 MÃ QR DÁN CỬA / QUẦY LỄ TÂN'
              : '🍽️ MÃ QR ĐẶT TẠI BÀN / GHẾ DỊCH VỤ'}
          </p>
          <h3 className="text-lg font-black tracking-tight mt-0.5 truncate">
            {shop.name}
          </h3>
        </div>

        {/* 5-Language Scan Invitation */}
        <div className="space-y-1.5 mb-4">
          <p className="inline-flex items-center justify-center gap-1.5 text-xs font-extrabold text-slate-900">
            <FlagIcon locale="vi" className="h-3.5 w-5" />
            <span>
              {qrType === 'door'
                ? 'QUÉT MÃ XEM THÔNG TIN, WI-FI & MENU'
                : 'QUÉT MÃ XEM MENU / BẢNG GIÁ ĐA NGÔN NGỮ'}
            </span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="en" className="h-3 w-4" />
              <span>Scan for English Menu</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="ko" className="h-3 w-4" />
              <span>한국어 메뉴 스캔</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="ja" className="h-3 w-4" />
              <span>日本語メニュー</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="zh" className="h-3 w-4" />
              <span>扫码查看中文菜单</span>
            </span>
          </div>
        </div>

        {/* QR Code Frame */}
        <div
          className="rounded-3xl p-4 bg-white shadow-md border-4 mb-4"
          style={{ borderColor: primaryColor }}
        >
          <QRCodeCanvas
            value={targetUrl}
            size={190}
            bgColor="#ffffff"
            fgColor="#0f172a"
            level="H"
            includeMargin={false}
          />
        </div>

        {/* Optional Wi-Fi Box inside Standee */}
        {showWifi && shop.wifi_info?.ssid && (
          <div className="w-full rounded-2xl bg-slate-100 px-3.5 py-2.5 mb-3 flex items-center justify-between text-left border border-slate-200">
            <div className="flex items-center gap-2 min-w-0">
              <Wifi className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-slate-900">
                  Wi-Fi: {shop.wifi_info.ssid}
                </p>
                {shop.wifi_info.password && (
                  <p className="truncate text-[10px] font-mono text-slate-600">
                    Pass: <strong>{shop.wifi_info.password}</strong>
                  </p>
                )}
              </div>
            </div>
            <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600 border border-slate-200">
              FREE
            </span>
          </div>
        )}

        {/* Footer Branding */}
        <div className="w-full flex items-center justify-between border-t border-slate-100 pt-2.5 text-[10px] font-bold text-slate-400">
          <span>Powered by Qlaok.vn</span>
          <span>Quét là OK ✨</span>
        </div>
      </div>

      {/* Action Controls Below Standee */}
      <div className="flex flex-wrap items-center justify-center gap-2 w-full max-w-[340px]">
        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={downloading}
          style={{ backgroundColor: primaryColor }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-md hover:opacity-95 active:scale-95"
        >
          <Download className="h-4 w-4" />
          <span>
            {downloading ? 'Đang xuất ảnh...' : 'Tải ảnh PNG in A6'}
          </span>
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          title="Copy đường dẫn QR"
        >
          {copiedUrl ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              <span>Đã copy</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy Link</span>
            </>
          )}
        </button>

        <a
          href={relativePath}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          title="Mở thử giao diện khi khách quét"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Mở thử</span>
        </a>
      </div>
    </div>
  );
}
