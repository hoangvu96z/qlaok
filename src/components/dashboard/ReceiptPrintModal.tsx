'use client';

import React, { useState, useRef } from 'react';
import {
  Printer,
  X,
  CheckCircle2,
  QrCode,
  Wifi,
  MapPin,
  Phone,
  Sparkles,
} from 'lucide-react';
import type { Shop, ShopOrder } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';

interface ReceiptPrintModalProps {
  order: ShopOrder | null;
  shop: Shop;
  onClose: () => void;
  onConfirmPaid?: (order: ShopOrder) => Promise<void>;
}

export function ReceiptPrintModal({
  order,
  shop,
  onClose,
  onConfirmPaid,
}: ReceiptPrintModalProps) {
  const [paperSize, setPaperSize] = useState<'80mm' | '58mm'>('80mm');
  const [includeQrOnBill, setIncludeQrOnBill] = useState(true);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!order) return null;

  const computedSubtotal = order.items.reduce(
    (sum, line) => sum + (line.unit_price + line.extra_price) * line.quantity,
    0
  );
  const subtotal = order.subtotal_amount || computedSubtotal;
  const discount =
    order.discount_amount || Math.max(0, subtotal - order.total_amount);

  const qrInfo = getShopPaymentQrInfo(
    shop,
    order.total_amount,
    order.order_code
  );
  const vietQrUrl = qrInfo.qrImageUrl;

  const formattedDate = new Date(order.created_at).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handlePrintThermalReceipt = () => {
    if (typeof window === 'undefined') return;
    const widthMm = paperSize === '80mm' ? '78mm' : '56mm';

    const itemsRowsHtml = order.items
      .map((line) => {
        const linePrice = line.unit_price + line.extra_price;
        const lineTotal = linePrice * line.quantity;
        const choicesText =
          line.selected_choices && line.selected_choices.length > 0
            ? `<div style="font-size:10px;color:#475569;">+ ${line.selected_choices
                .map((c) => c.label_i18n?.vi || '')
                .filter(Boolean)
                .join(', ')}</div>`
            : '';
        const noteText = line.custom_note
          ? `<div style="font-size:10px;color:#475569;font-style:italic;">Ghi chú: ${line.custom_note}</div>`
          : '';

        return `
          <tr>
            <td style="padding:4px 0;vertical-align:top;">
              <div style="font-weight:700;">${line.name_vi}</div>
              ${choicesText}
              ${noteText}
            </td>
            <td style="padding:4px 4px;text-align:center;vertical-align:top;font-weight:700;">${line.quantity}</td>
            <td style="padding:4px 0;text-align:right;vertical-align:top;font-weight:700;">${formatCurrency(lineTotal, shop.currency)}</td>
          </tr>
        `;
      })
      .join('');

    const discountRowHtml =
      discount > 0
        ? `
          <div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0;">
            <span>Tạm tính:</span>
            <span>${formatCurrency(subtotal, shop.currency)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0;font-weight:700;">
            <span>Khuyến mãi / Giảm giá:</span>
            <span>-${formatCurrency(discount, shop.currency)}</span>
          </div>
        `
        : '';

    const wifiHtml = shop.wifi_info?.ssid
      ? `<div style="margin-top:6px;font-size:11px;border-top:1px dashed #94a3b8;padding-top:6px;">
          📶 Wi-Fi: <strong>${shop.wifi_info.ssid}</strong> ${
            shop.wifi_info.password
              ? `• Mật khẩu: <strong>${shop.wifi_info.password}</strong>`
              : ''
          }
        </div>`
      : '';

    const qrSectionHtml = includeQrOnBill
      ? `
        <div style="margin-top:10px;text-align:center;border-top:1px dashed #000;padding-top:8px;">
          <div style="font-size:11px;font-weight:900;margin-bottom:4px;text-transform:uppercase;">
            QUÉT MÃ QR ĐỂ CHUYỂN KHOẢN THANH TOÁN
          </div>
          <img src="${vietQrUrl}" alt="VietQR" style="width:165px;height:165px;object-fit:contain;margin:4px auto;display:block;border:1px solid #cbd5e1;padding:4px;border-radius:6px;background:#fff;" />
          <div style="font-size:10px;line-height:1.4;margin-top:4px;">
            <div>Ngân hàng: <strong>${qrInfo.bankShortName}</strong></div>
            ${qrInfo.accountNumber ? `<div>STK: <strong>${qrInfo.accountNumber}</strong></div>` : ''}
            <div>Chủ TK: <strong>${qrInfo.accountName}</strong></div>
            <div>Nội dung CK: <strong>${qrInfo.transferContent}</strong></div>
          </div>
        </div>
      `
      : '';

    const printHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Hoa Don #${order.order_code} - ${shop.name}</title>
          <style>
            @page {
              size: ${paperSize} auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace, sans-serif;
              width: ${widthMm};
              margin: 0 auto;
              padding: 8px 6px;
              color: #000000;
              background: #ffffff;
              font-size: 12px;
              line-height: 1.35;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
          </style>
        </head>
        <body>
          <div style="text-align:center;border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px;">
            <div style="font-size:15px;font-weight:900;text-transform:uppercase;">${shop.name}</div>
            ${shop.address ? `<div style="font-size:11px;margin-top:2px;">Đ/C: ${shop.address}</div>` : ''}
            ${shop.phone_contact ? `<div style="font-size:11px;">SĐT: ${shop.phone_contact}</div>` : ''}
          </div>

          <div style="text-align:center;margin-bottom:8px;">
            <div style="font-size:14px;font-weight:900;">HÓA ĐƠN THANH TOÁN</div>
            <div style="font-size:11px;">Mã đơn: <strong>#${order.order_code}</strong> • <strong>${order.table_label}</strong></div>
            <div style="font-size:10px;color:#334155;">Giờ tạo: ${formattedDate}</div>
          </div>

          <table style="border-top:1px dashed #000;border-bottom:1px dashed #000;margin-bottom:8px;">
            <thead>
              <tr style="border-bottom:1px solid #000;font-size:11px;">
                <th style="text-align:left;padding:4px 0;">Món</th>
                <th style="text-align:center;padding:4px;">SL</th>
                <th style="text-align:right;padding:4px 0;">T.Tiền</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRowsHtml}
            </tbody>
          </table>

          ${discountRowHtml}

          <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900;margin:6px 0;padding-top:4px;border-top:1px solid #000;">
            <span>TỔNG CỘNG:</span>
            <span>${formatCurrency(order.total_amount, shop.currency)}</span>
          </div>

          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
            <span>Hình thức: ${order.payment_method === 'vietqr' ? 'Chuyển khoản QR' : 'Tiền mặt'}</span>
            <strong>${order.payment_status === 'paid' ? '✓ ĐÃ THU TIỀN' : 'QUÉT QR / CHỜ THANH TOÁN'}</strong>
          </div>

          ${qrSectionHtml}

          <div style="text-align:center;margin-top:8px;font-size:11px;">
            ${wifiHtml}
            <div style="margin-top:6px;font-weight:700;">Cảm ơn Quý khách & Hẹn gặp lại!</div>
            <div style="font-size:9px;color:#64748b;margin-top:2px;">Powered by Qlaok Smart POS</div>
          </div>
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(printHtml);
      doc.close();

      let printed = false;
      const triggerPrint = () => {
        if (printed) return;
        printed = true;
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 2000);
      };

      const imgs = Array.from(doc.images || []);
      if (imgs.length === 0 || imgs.every((img) => img.complete)) {
        setTimeout(triggerPrint, 250);
      } else {
        let loadedCount = 0;
        const checkDone = () => {
          loadedCount += 1;
          if (loadedCount >= imgs.length) {
            setTimeout(triggerPrint, 150);
          }
        };
        imgs.forEach((img) => {
          if (img.complete) {
            checkDone();
          } else {
            img.addEventListener('load', checkDone, { once: true });
            img.addEventListener('error', checkDone, { once: true });
          }
        });
        // Fallback safety timeout if network is slow
        setTimeout(triggerPrint, 1800);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-white p-4 sm:p-5 shadow-2xl border border-slate-200 space-y-4 my-6">
        {/* Top Modal Controls */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                In Hóa Đơn Thanh Toán
              </h3>
              <p className="text-[11px] text-slate-500">
                Đơn #{order.order_code} • {order.table_label}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Paper Size & QR Options */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-2.5 border border-slate-200/80">
          <div className="inline-flex rounded-xl bg-slate-200/80 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setPaperSize('80mm')}
              className={`rounded-lg px-2.5 py-1 transition ${
                paperSize === '80mm'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              Khổ K80 (80mm)
            </button>
            <button
              type="button"
              onClick={() => setPaperSize('58mm')}
              className={`rounded-lg px-2.5 py-1 transition ${
                paperSize === '58mm'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              Khổ K58 (58mm)
            </button>
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={includeQrOnBill}
              onChange={(e) => setIncludeQrOnBill(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span>Kèm mã QR trên bill</span>
          </label>
        </div>

        {/* Thermal Paper Bill Preview (Always Crisp White Surface) */}
        <div className="max-h-[55vh] overflow-y-auto flex justify-center bg-slate-100 rounded-2xl p-3 border border-slate-200">
          <div
            ref={receiptRef}
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            className={`qr-light-surface rounded-xl bg-white p-4 shadow-md border border-slate-200 font-mono text-xs space-y-3 ${
              paperSize === '80mm' ? 'w-full max-w-[310px]' : 'w-full max-w-[240px]'
            }`}
          >
            {/* Shop Header */}
            <div className="text-center border-b border-dashed border-slate-400 pb-2.5 space-y-0.5">
              <p className="text-sm font-black uppercase tracking-tight text-slate-950">
                {shop.name}
              </p>
              {shop.address && (
                <p className="text-[10px] text-slate-600 flex items-center justify-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span>{shop.address}</span>
                </p>
              )}
              {shop.phone_contact && (
                <p className="text-[10px] text-slate-600 flex items-center justify-center gap-1">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span>Hotline: {shop.phone_contact}</span>
                </p>
              )}
            </div>

            {/* Bill Title & Meta */}
            <div className="text-center space-y-0.5">
              <p className="text-xs font-black tracking-wider text-slate-950">
                HÓA ĐƠN THANH TOÁN
              </p>
              <p className="text-[11px] font-bold text-slate-800">
                #{order.order_code} • {order.table_label}
              </p>
              <p className="text-[10px] text-slate-500">{formattedDate}</p>
            </div>

            {/* Line Items Table */}
            <div className="border-t border-b border-dashed border-slate-400 py-2 space-y-1.5">
              <div className="flex justify-between text-[10px] font-black text-slate-500 border-b border-slate-200 pb-1">
                <span>TÊN MÓN</span>
                <span>SL x Đ.GIÁ = T.TIỀN</span>
              </div>

              {order.items.map((line, idx) => {
                const unitPrice = line.unit_price + line.extra_price;
                const lineTotal = unitPrice * line.quantity;
                return (
                  <div key={idx} className="text-[11px] space-y-0.5">
                    <div className="flex justify-between gap-2 font-bold text-slate-900">
                      <span className="flex-1">{line.name_vi}</span>
                      <span className="shrink-0">
                        {line.quantity} x{' '}
                        {formatCurrency(unitPrice, shop.currency)} ={' '}
                        <strong>
                          {formatCurrency(lineTotal, shop.currency)}
                        </strong>
                      </span>
                    </div>
                    {line.selected_choices &&
                      line.selected_choices.length > 0 && (
                        <p className="text-[10px] text-slate-500">
                          +{' '}
                          {line.selected_choices
                            .map((c) => c.label_i18n?.vi)
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                    {line.custom_note && (
                      <p className="text-[10px] italic text-slate-500">
                        Ghi chú: {line.custom_note}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totals Breakdown */}
            <div className="space-y-1">
              {discount > 0 && (
                <>
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>Tạm tính:</span>
                    <span>{formatCurrency(subtotal, shop.currency)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-bold text-rose-600">
                    <span>Khuyến mãi / Giảm giá:</span>
                    <span>-{formatCurrency(discount, shop.currency)}</span>
                  </div>
                </>
              )}

              <div className="flex justify-between items-baseline pt-1 border-t border-slate-900 text-sm font-black text-slate-950">
                <span>TỔNG CỘNG:</span>
                <span className="text-base text-emerald-700">
                  {formatCurrency(order.total_amount, shop.currency)}
                </span>
              </div>

              <div className="flex justify-between items-center text-[10px] pt-0.5">
                <span className="text-slate-600">
                  TT:{' '}
                  {order.payment_method === 'vietqr'
                    ? 'Chuyển khoản QR'
                    : 'Tiền mặt'}
                </span>
                <span
                  className={`font-black ${
                    order.payment_status === 'paid'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {order.payment_status === 'paid'
                    ? '✓ ĐÃ THANH TOÁN'
                    : '⏳ CHƯA THU TIỀN'}
                </span>
              </div>
            </div>

            {/* QR Code on Bill (Always shown when includeQrOnBill is checked so customer can scan from printed paper bill) */}
            {includeQrOnBill && (
              <div className="border-t border-dashed border-slate-300 pt-2.5 text-center space-y-1.5">
                <p className="text-[10px] font-black uppercase text-slate-900 flex items-center justify-center gap-1">
                  <QrCode className="h-3 w-3 text-emerald-600" />
                  <span>Quét Mã QR Để Chuyển Khoản</span>
                </p>
                <img
                  src={vietQrUrl}
                  alt="VietQR"
                  className="mx-auto h-36 w-36 object-contain rounded-lg border border-slate-200 p-1 bg-white"
                />
                <div className="text-[10px] text-slate-700 leading-snug space-y-0.5">
                  <p>
                    NH: <strong>{qrInfo.bankShortName}</strong>
                  </p>
                  {qrInfo.accountNumber && (
                    <p>
                      STK: <strong>{qrInfo.accountNumber}</strong>
                    </p>
                  )}
                  <p>
                    Chủ TK: <strong>{qrInfo.accountName}</strong>
                  </p>
                  <p>
                    ND: <strong>{qrInfo.transferContent}</strong>
                  </p>
                </div>
                {order.payment_status === 'paid' && (
                  <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-800">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Đã ghi nhận thanh toán</span>
                  </p>
                )}
              </div>
            )}

            {/* Wi-Fi & Footer */}
            <div className="border-t border-dashed border-slate-300 pt-2 text-center space-y-1 text-[10px] text-slate-600">
              {shop.wifi_info?.ssid && (
                <p className="flex items-center justify-center gap-1 font-bold text-slate-800">
                  <Wifi className="h-3 w-3 text-emerald-600" />
                  <span>
                    Wi-Fi: {shop.wifi_info.ssid}{' '}
                    {shop.wifi_info.password
                      ? `• Pass: ${shop.wifi_info.password}`
                      : ''}
                  </span>
                </p>
              )}
              <p className="font-bold text-slate-900">
                Cảm ơn Quý khách &amp; Hẹn gặp lại!
              </p>
              <p className="text-[9px] text-slate-400 flex items-center justify-center gap-1">
                <Sparkles className="h-2.5 w-2.5" />
                <span>Qlaok Smart Restaurant POS</span>
              </p>
            </div>
          </div>
        </div>

        {/* Print Action Buttons */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handlePrintThermalReceipt}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 px-5 text-xs sm:text-sm font-black text-white shadow-lg hover:bg-emerald-500 active:scale-98 transition"
            >
              <Printer className="h-4 w-4" />
              <span>
                🖨️ In Hóa Đơn {includeQrOnBill ? 'Kèm Mã QR ' : ''}({paperSize})
              </span>
            </button>
          </div>

          {onConfirmPaid && order.payment_status !== 'paid' && (
            <button
              type="button"
              disabled={confirmingPaid}
              onClick={async () => {
                setConfirmingPaid(true);
                try {
                  await onConfirmPaid(order);
                } finally {
                  setConfirmingPaid(false);
                }
              }}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-300 bg-emerald-50 py-2.5 px-4 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>
                {confirmingPaid
                  ? 'Đang xác nhận...'
                  : '✓ Xác nhận khách đã chuyển khoản / Thu tiền xong'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
