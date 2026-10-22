'use client';

import React, { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { Download, Wifi, ExternalLink, Copy, Check } from 'lucide-react';
import { Shop, ShopTable } from '@/types/qlaok';
import { buildTableMenuUrl } from '@/lib/table-helpers';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export interface PrintableStandeeProps {
  shop: Shop;
  qrType: 'door' | 'table';
  baseUrl: string;
  showWifi?: boolean;
  accentColor?: string;
  table?: ShopTable | null;
  tableId?: string | null;
  tableName?: string | null;
  tableCode?: string | null;
  sectionName?: string | null;
  qrSig?: string | null;
}

export function PrintableStandee({
  shop,
  qrType,
  baseUrl,
  showWifi = true,
  accentColor,
  table = null,
  tableId = null,
  tableName = null,
  tableCode = null,
  sectionName = null,
  qrSig = null,
}: PrintableStandeeProps) {
  const { t, tx } = useAppI18n();
  const standeeRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const primaryColor =
    accentColor || shop.theme_config?.primaryColor || '#10b981';

  const effectiveTableId = (table?.id || tableId || '').trim();
  const effectiveTableName = (table?.name || tableName || '').trim();
  const effectiveTableCode = (table?.table_code || tableCode || '').trim();
  const effectiveSection = (table?.section || sectionName || '').trim();
  const effectiveQrSig = (table?.qr_sig || qrSig || '').trim();

  const normalizedBase = (baseUrl || '').trim().replace(/\/+$/, '');

  const targetUrl =
    qrType === 'door'
      ? `${normalizedBase}/s/${shop.slug}?src=door`
      : buildTableMenuUrl(
          normalizedBase,
          shop.slug,
          effectiveTableId,
          effectiveQrSig
        );

  const relativePath =
    qrType === 'door'
      ? `/s/${shop.slug}?src=door`
      : buildTableMenuUrl('', shop.slug, effectiveTableId, effectiveQrSig);

  const handleDownloadPng = async () => {
    if (!standeeRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(standeeRef.current, {
        cacheBust: true,
        pixelRatio: 3, // High-resolution 300DPI-grade A6 export
      });
      const tableSuffix = effectiveTableCode || effectiveTableName;
      const safeSuffix = tableSuffix
        ? `-${tableSuffix.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
        : '';
      const link = document.createElement('a');
      link.download = `Qlaok-QR-${qrType.toUpperCase()}-${shop.slug}${safeSuffix}.png`;
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
      {/* Printable A6 Standee Card - ALWAYS pure white (#ffffff) even in Dark Mode so cameras can scan QR reliably */}
      <div
        ref={standeeRef}
        data-testid={
          effectiveTableId
            ? `printable-standee-table-${effectiveTableId}`
            : `printable-standee-${qrType}`
        }
        style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
        className="qr-light-surface w-full max-w-[340px] rounded-3xl bg-white p-6 shadow-xl border-2 border-slate-200 flex flex-col items-center text-center relative overflow-hidden"
      >
        {/* Top Accent Header */}
        <div
          className="w-full rounded-2xl px-4 py-3 text-white shadow-sm mb-3"
          style={{ backgroundColor: primaryColor, color: '#ffffff' }}
        >
          <p className="text-[10px] font-extrabold uppercase tracking-widest opacity-90">
            {qrType === 'door'
              ? tx(
                  '🏪 MÃ QR DÁN CỬA / QUẦY LỄ TÂN',
                  '🏪 DOOR / FRONT DESK QR CODE'
                )
              : tx(
                  '🍽️ MÃ QR ĐẶT TẠI BÀN / GHẾ DỊCH VỤ',
                  '🍽️ TABLE / SEAT MENU QR CODE'
                )}
          </p>
          <h3 className="text-lg font-black tracking-tight mt-0.5 truncate">
            {shop.name}
          </h3>
        </div>

        {/* Specific Table Identity Badge on Standee */}
        {qrType === 'table' && effectiveTableName && (
          <div
            data-testid="standee-table-name-badge"
            style={{
              backgroundColor: '#f8fafc',
              borderColor: primaryColor,
              color: '#0f172a',
            }}
            className="w-full rounded-2xl border-2 px-3.5 py-2 mb-3 flex flex-col items-center justify-center"
          >
            <span className="text-base font-black tracking-tight text-slate-900">
              🪑 {effectiveTableName}
            </span>
            {(effectiveSection || effectiveTableCode) && (
              <span
                style={{ color: '#475569' }}
                className="text-[11px] font-bold text-slate-600"
              >
                {[
                  effectiveSection,
                  effectiveTableCode ? `#${effectiveTableCode}` : '',
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </span>
            )}
          </div>
        )}

        {/* 8-Language Scan Invitation */}
        <div className="space-y-1.5 mb-4">
          <p
            style={{ color: '#0f172a' }}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-extrabold text-slate-900"
          >
            <FlagIcon locale="vi" className="h-3.5 w-5" />
            <span>
              {qrType === 'door'
                ? 'QUÉT MÃ XEM THÔNG TIN, WI-FI & MENU'
                : 'QUÉT MÃ XEM MENU / BẢNG GIÁ ĐA NGÔN NGỮ'}
            </span>
          </p>
          <div
            style={{ color: '#475569' }}
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600"
          >
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="en" className="h-3 w-4" />
              <span>English Menu</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="ko" className="h-3 w-4" />
              <span>한국어 메뉴</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="ja" className="h-3 w-4" />
              <span>日本語</span>
            </span>
          </div>
          <div
            style={{ color: '#475569' }}
            className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-slate-600"
          >
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="zh" className="h-3 w-4" />
              <span>中文</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="es" className="h-3 w-4" />
              <span>Español</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="it" className="h-3 w-4" />
              <span>Italiano</span>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <FlagIcon locale="ru" className="h-3 w-4" />
              <span>Русский</span>
            </span>
          </div>
        </div>

        {/* QR Code Frame - Strictly White Quiet Zone (#ffffff) + Dark Modules (#0f172a) */}
        <div
          className="qr-light-surface rounded-3xl p-4 bg-white shadow-md border-4 mb-4"
          style={{ borderColor: primaryColor, backgroundColor: '#ffffff' }}
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
          <div
            style={{ backgroundColor: '#f1f5f9', borderColor: '#e2e8f0' }}
            className="w-full rounded-2xl bg-slate-100 px-3.5 py-2.5 mb-3 flex items-center justify-between text-left border border-slate-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Wifi className="h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p
                  style={{ color: '#0f172a' }}
                  className="truncate text-[11px] font-bold text-slate-900"
                >
                  Wi-Fi: {shop.wifi_info.ssid}
                </p>
                {shop.wifi_info.password && (
                  <p
                    style={{ color: '#475569' }}
                    className="truncate text-[10px] font-mono text-slate-600"
                  >
                    Pass: <strong>{shop.wifi_info.password}</strong>
                  </p>
                )}
              </div>
            </div>
            <span
              style={{
                backgroundColor: '#ffffff',
                color: '#475569',
                borderColor: '#e2e8f0',
              }}
              className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[9px] font-bold text-slate-600 border border-slate-200"
            >
              FREE
            </span>
          </div>
        )}

        {/* Footer Branding */}
        <div
          style={{ borderColor: '#f1f5f9', color: '#94a3b8' }}
          className="w-full flex items-center justify-between border-t border-slate-100 pt-2.5 text-[10px] font-bold text-slate-400"
        >
          <span>Powered by Qlaok.vn</span>
          <span>
            {effectiveTableName
              ? `${effectiveTableName} • ✨`
              : tx('Quét là OK ✨', 'Scan & Order ✨')}
          </span>
        </div>
      </div>

      {/* URL Path Indicator */}
      <div className="w-full max-w-[340px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/80 px-3 py-1.5 text-center">
        <code
          data-testid="standee-target-url"
          className="block truncate text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300"
          title={targetUrl}
        >
          {relativePath}
        </code>
      </div>

      {/* Action Controls Below Standee */}
      <div className="flex flex-wrap items-center justify-center gap-2 w-full max-w-[340px]">
        <button
          type="button"
          onClick={handleDownloadPng}
          disabled={downloading}
          style={{
            backgroundColor:
              primaryColor === '#0f172a' ? '#10b981' : primaryColor,
            color: '#ffffff',
          }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-md hover:opacity-95 active:scale-95 border border-white/20"
        >
          <Download className="h-4 w-4" />
          <span>
            {downloading
              ? tx('Đang xuất ảnh...', 'Exporting PNG...')
              : tx('Tải ảnh in A6', 'Download A6 PNG')}
          </span>
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          title={tx('Sao chép đường dẫn QR', 'Copy QR link')}
        >
          {copiedUrl ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>

        <a
          href={relativePath}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          title={tx('Mở thử trang khi khách quét', 'Open guest view')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span>{tx('Mở thử', 'Test')}</span>
        </a>
      </div>
    </div>
  );
}
