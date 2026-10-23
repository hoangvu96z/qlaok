'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Printer,
  X,
  CheckCircle2,
  QrCode,
  Wifi,
  MapPin,
  Phone,
  Sparkles,
  AlertTriangle,
  ChefHat,
  FileText,
  Receipt,
  Tag,
} from 'lucide-react';
import type {
  Shop,
  ShopLabelPrintConfig,
  ShopOrder,
  TicketPrintType,
} from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import { escapeHtml } from '@/lib/escape-html';
import { getAuthHeaders } from '@/lib/auth-session';
import { getShopPaymentQrInfo } from '@/lib/payment-qr';
import { resolveShopLabelPrintConfig } from '@/lib/label-print-config';
import { buildProductionLabelBatch } from '@/lib/production-label-print';
import {
  prepareOrderProductionLabelPrint,
  renderProductionLabelDocument,
} from '@/lib/production-label-template';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export { prepareOrderProductionLabelPrint };

interface ReceiptPrintModalProps {
  order: ShopOrder | null;
  shop: Shop;
  initialTicketType?: TicketPrintType;
  canCollectPayment?: boolean;
  onClose: () => void;
  onConfirmPaid?: (order: ShopOrder) => Promise<void>;
  onOrderUpdated?: (order: ShopOrder) => void;
}

export function ReceiptPrintModal({
  order,
  shop,
  initialTicketType,
  canCollectPayment = true,
  onClose,
  onConfirmPaid,
  onOrderUpdated,
}: ReceiptPrintModalProps) {
  const { locale, t, tx } = useAppI18n();
  const defaultTicketType: TicketPrintType =
    initialTicketType ||
    (order?.payment_status === 'paid' ? 'receipt' : 'provisional');

  const [ticketType, setTicketType] =
    useState<TicketPrintType>(defaultTicketType);
  const [paperSize, setPaperSize] = useState<'80mm' | '58mm'>('80mm');
  const [includeQrOnBill, setIncludeQrOnBill] = useState<boolean>(
    defaultTicketType === 'provisional'
  );
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [localOrder, setLocalOrder] = useState<ShopOrder | null>(order);
  const receiptRef = useRef<HTMLDivElement>(null);
  const prevOrderIdRef = useRef<string | undefined>(order?.id);
  const prevInitialTypeRef = useRef<TicketPrintType | undefined>(
    initialTicketType
  );
  const prevPaymentStatusRef = useRef<ShopOrder['payment_status'] | undefined>(
    order?.payment_status
  );

  useEffect(() => {
    setLocalOrder(order);
    if (!order) {
      prevOrderIdRef.current = undefined;
      prevInitialTypeRef.current = initialTicketType;
      prevPaymentStatusRef.current = undefined;
      return;
    }

    const orderIdChanged = prevOrderIdRef.current !== order.id;
    const initialTypeChanged = prevInitialTypeRef.current !== initialTicketType;
    const becamePaid =
      prevPaymentStatusRef.current !== 'paid' &&
      order.payment_status === 'paid';

    prevOrderIdRef.current = order.id;
    prevInitialTypeRef.current = initialTicketType;
    prevPaymentStatusRef.current = order.payment_status;

    if (orderIdChanged || initialTypeChanged) {
      const nextType =
        initialTicketType ||
        (order.payment_status === 'paid' ? 'receipt' : 'provisional');
      setTicketType(nextType);
      setIncludeQrOnBill(
        nextType === 'provisional' && order.payment_status !== 'paid'
      );
    } else if (becamePaid && ticketType === 'provisional') {
      setTicketType('receipt');
      setIncludeQrOnBill(false);
    }
  }, [order, initialTicketType, ticketType]);

  const activeOrder = localOrder || order;
  if (!activeOrder) return null;

  const handleSelectTicketType = (nextType: TicketPrintType) => {
    if (nextType === 'receipt' && activeOrder.payment_status !== 'paid') return;
    setTicketType(nextType);
    // Paid receipts, kitchen tickets, and production labels should NEVER include ordinary bill payment QR by default
    setIncludeQrOnBill(
      nextType === 'provisional' && activeOrder.payment_status !== 'paid'
    );
  };

  const computedSubtotal = activeOrder.items.reduce(
    (sum, line) => sum + (line.unit_price + line.extra_price) * line.quantity,
    0
  );
  const subtotal = activeOrder.subtotal_amount ?? computedSubtotal;
  const discount =
    activeOrder.discount_amount ??
    Math.max(0, subtotal - activeOrder.total_amount);
  const billVersion = activeOrder.bill_version || 1;

  const currentPrintCount =
    ticketType === 'kitchen'
      ? activeOrder.kitchen_printed_count || 0
      : ticketType === 'provisional'
        ? activeOrder.provisional_printed_count || 0
        : ticketType === 'label'
          ? activeOrder.label_printed_count || 0
          : activeOrder.receipt_printed_count || 0;

  const qrInfo = getShopPaymentQrInfo(
    shop,
    activeOrder.total_amount,
    activeOrder.order_code
  );
  const canShowQr =
    ticketType !== 'kitchen' &&
    ticketType !== 'label' &&
    includeQrOnBill &&
    qrInfo.isConfigured &&
    Boolean(qrInfo.qrImageUrl) &&
    activeOrder.payment_status === 'unpaid';

  const labelConfig: ShopLabelPrintConfig = resolveShopLabelPrintConfig(
    shop.theme_config
  );
  const labelBatch = buildProductionLabelBatch({
    order: activeOrder,
    config: labelConfig,
  });
  const labelPreflight = prepareOrderProductionLabelPrint({
    order: activeOrder,
    shop,
    config: labelConfig,
    locale,
  });

  const formattedDate = new Date(activeOrder.created_at).toLocaleString(
    locale === 'en' ? 'en-US' : 'vi-VN',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );

  const ticketHeaderTitle =
    ticketType === 'kitchen'
      ? tx('PHIẾU BẾP / CHẾ BIẾN', 'KITCHEN TICKET')
      : ticketType === 'provisional'
        ? activeOrder.payment_status === 'unpaid'
          ? tx('PHIẾU TẠM TÍNH (CHƯA THU TIỀN)', 'PROVISIONAL BILL (UNPAID)')
          : tx('BẢN KÊ MÓN', 'ORDER SUMMARY')
        : ticketType === 'label'
          ? tx('TEM MÓN / NHÃN PHA CHẾ', 'PRODUCTION LABELS')
          : tx('BIÊN LAI ĐÃ THANH TOÁN', 'PAID RECEIPT');

  const handlePrintThermalReceipt = async () => {
    if (typeof window === 'undefined') return;
    if (ticketType === 'receipt' && activeOrder.payment_status !== 'paid') {
      return;
    }

    if (ticketType === 'label') {
      if (
        !labelBatch.ok ||
        !labelPreflight.ok ||
        !labelPreflight.canPrint ||
        !labelPreflight.html
      ) {
        return;
      }
    }

    let printNumber = currentPrintCount + 1;
    let isReprint = printNumber > 1;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'record_print',
          orderId: activeOrder.id,
          ticketType,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new Error(
          error?.error || tx('Không thể ghi nhận lần in', 'Could not record print')
        );
      }
      {
        const data = await res.json();
        if (!data?.order) {
          throw new Error(
            tx(
              'Máy chủ trả về phiếu không hợp lệ',
              'Server returned an invalid ticket'
            )
          );
        }
        if (
          data.order.bill_version !== activeOrder.bill_version ||
          data.order.payment_status !== activeOrder.payment_status ||
          Number(data.order.total_amount) !== Number(activeOrder.total_amount)
        ) {
          setLocalOrder(data.order);
          onOrderUpdated?.(data.order);
          throw new Error(
            tx(
              'Đơn hàng đã thay đổi. Vui lòng kiểm tra lại phiếu trước khi in.',
              'Order has changed. Please review the ticket before printing.'
            )
          );
        }
        if (data?.order) {
          setLocalOrder(data.order);
          onOrderUpdated?.(data.order);
        }
        if (typeof data?.printCount === 'number') {
          printNumber = data.printCount;
          isReprint = Boolean(data.isReprint);
        }
      }
    } catch (error) {
      window.alert(
        error instanceof Error && error.message
          ? error.message
          : tx('Không thể chuẩn bị phiếu in', 'Could not prepare receipt for printing')
      );
      return;
    }

    let printHtml = '';

    if (ticketType === 'label') {
      const renderedDoc = renderProductionLabelDocument({
        batch: labelBatch.ok ? labelBatch : undefined,
        shopName: shop.name,
        currency: shop.currency,
        locale: (locale || activeOrder.visitor_lang || 'vi').toLowerCase(),
        timeZone: 'Asia/Ho_Chi_Minh',
        isReprint,
        printCount: printNumber,
        paymentQr: labelPreflight.paymentQr,
        paperPreset: labelConfig.paper_preset,
        customFooterI18n: labelConfig.custom_footer_i18n,
      });
      if (!renderedDoc.ok || !renderedDoc.html) {
        window.alert(
          tx(
            'Không thể chuẩn bị tài liệu tem in',
            'Could not prepare label document for printing'
          )
        );
        return;
      }
      printHtml = renderedDoc.html;
    } else {
      const widthMm = paperSize === '80mm' ? '78mm' : '56mm';

      const itemsRowsHtml = activeOrder.items
        .map((line) => {
          const linePrice = line.unit_price + line.extra_price;
          const lineTotal = linePrice * line.quantity;
          const choicesText =
            line.selected_choices && line.selected_choices.length > 0
              ? `<div style="font-size:10px;color:#475569;">+ ${line.selected_choices
                  .map((c) => escapeHtml(c.label_i18n?.vi || c.label_vi || ''))
                  .filter(Boolean)
                  .join(', ')}</div>`
              : '';
          const tagsText =
            line.quick_tags && line.quick_tags.length > 0
              ? `<div style="font-size:10px;color:#334155;font-weight:700;">[${escapeHtml(line.quick_tags.join(', '))}]</div>`
              : '';
          const noteText = line.custom_note
            ? `<div style="font-size:10px;color:#475569;font-style:italic;">${escapeHtml(tx('Ghi chú', 'Note'))}: ${escapeHtml(line.custom_note)}</div>`
            : '';

          if (ticketType === 'kitchen') {
            return `
            <tr style="border-bottom:1px dashed #cbd5e1;">
              <td style="padding:6px 0;vertical-align:top;">
                <div style="font-weight:900;font-size:13px;">${escapeHtml(line.name_vi)}</div>
                ${choicesText}
                ${tagsText}
                ${noteText}
              </td>
              <td style="padding:6px 4px;text-align:right;vertical-align:top;font-weight:900;font-size:15px;">x${line.quantity}</td>
            </tr>
          `;
          }

          return `
          <tr>
            <td style="padding:4px 0;vertical-align:top;">
              <div style="font-weight:700;">${escapeHtml(line.name_vi)}</div>
              ${choicesText}
              ${tagsText}
              ${noteText}
            </td>
            <td style="padding:4px 4px;text-align:center;vertical-align:top;font-weight:700;">${line.quantity}</td>
            <td style="padding:4px 0;text-align:right;vertical-align:top;font-weight:700;">${escapeHtml(formatCurrency(lineTotal, shop.currency))}</td>
          </tr>
        `;
        })
        .join('');

      const discountRowHtml =
        ticketType !== 'kitchen' && discount > 0
          ? `
          <div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0;">
            <span>${escapeHtml(t('pos.subtotal'))}:</span>
            <span>${escapeHtml(formatCurrency(subtotal, shop.currency))}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin:3px 0;font-weight:700;">
            <span>${escapeHtml(t('pos.discount'))}:</span>
            <span>-${escapeHtml(formatCurrency(discount, shop.currency))}</span>
          </div>
        `
          : '';

      const wifiHtml =
        ticketType !== 'kitchen' && shop.wifi_info?.ssid
          ? `<div style="margin-top:6px;font-size:11px;border-top:1px dashed #94a3b8;padding-top:6px;">
          📶 Wi-Fi: <strong>${escapeHtml(shop.wifi_info.ssid)}</strong> ${
            shop.wifi_info.password
              ? `• ${escapeHtml(tx('Mật khẩu', 'Pass'))}: <strong>${escapeHtml(shop.wifi_info.password)}</strong>`
              : ''
          }
        </div>`
          : '';

      const qrSectionHtml = canShowQr
        ? `
        <div style="margin-top:10px;text-align:center;border-top:1px dashed #000;padding-top:8px;">
          <div style="font-size:11px;font-weight:900;margin-bottom:4px;text-transform:uppercase;">
            ${escapeHtml(tx('QUÉT MÃ QR ĐỂ CHUYỂN KHOẢN THANH TOÁN', 'SCAN QR TO PAY BY BANK TRANSFER'))}
          </div>
          <img src="${escapeHtml(qrInfo.qrImageUrl)}" alt="VietQR" style="width:165px;height:165px;object-fit:contain;margin:4px auto;display:block;border:1px solid #cbd5e1;padding:4px;border-radius:6px;background:#fff;" />
          <div style="font-size:10px;line-height:1.4;margin-top:4px;">
            <div>${escapeHtml(tx('Ngân hàng', 'Bank'))}: <strong>${escapeHtml(qrInfo.bankShortName)}</strong></div>
            ${qrInfo.accountNumber ? `<div>${escapeHtml(tx('STK', 'Acct'))}: <strong>${escapeHtml(qrInfo.accountNumber)}</strong></div>` : ''}
            <div>${escapeHtml(tx('Chủ TK', 'Name'))}: <strong>${escapeHtml(qrInfo.accountName)}</strong></div>
            <div>${escapeHtml(tx('Nội dung CK', 'Memo'))}: <strong>${escapeHtml(qrInfo.transferContent)}</strong></div>
          </div>
        </div>
      `
        : '';

      const reprintBadgeHtml = isReprint
        ? `<div style="display:inline-block;margin-top:4px;padding:2px 6px;border:1px solid #000;font-size:10px;font-weight:900;">${escapeHtml(tx('BẢN IN LẠI (Lần #{count})', 'REPRINT (#{count})', { count: printNumber }))}</div>`
        : '';

      const totalsSectionHtml =
        ticketType === 'kitchen'
          ? activeOrder.customer_note
            ? `<div style="margin-top:6px;padding:6px;border:1px solid #000;font-size:12px;font-weight:700;">${escapeHtml(tx('Ghi chú đơn', 'Order note'))}: ${escapeHtml(activeOrder.customer_note)}</div>`
            : ''
          : `
          ${discountRowHtml}
          <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900;margin:6px 0;padding-top:4px;border-top:1px solid #000;">
            <span>${escapeHtml(tx('TỔNG CỘNG:', 'TOTAL:'))}</span>
            <span>${escapeHtml(formatCurrency(activeOrder.total_amount, shop.currency))}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
            <span>${escapeHtml(tx('Hình thức', 'Method'))}: ${escapeHtml(activeOrder.payment_method === 'vietqr' ? t('orders.paymentMethodQr') : t('orders.paymentMethodCash'))}</span>
            <strong>${escapeHtml(activeOrder.payment_status === 'paid' ? tx('✓ ĐÃ THU TIỀN', '✓ PAID') : activeOrder.payment_status === 'refunded' ? tx('↩ ĐÃ HOÀN TIỀN', '↩ REFUNDED') : tx('TẠM TÍNH / CHỜ THU TIỀN', 'UNPAID / PROVISIONAL'))}</strong>
          </div>
        `;

      printHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(ticketHeaderTitle)} #${escapeHtml(activeOrder.order_code)} - ${escapeHtml(shop.name)}</title>
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
            <div style="font-size:15px;font-weight:900;text-transform:uppercase;">${escapeHtml(shop.name)}</div>
            ${ticketType !== 'kitchen' && shop.address ? `<div style="font-size:11px;margin-top:2px;">${escapeHtml(tx('Đ/C', 'Addr'))}: ${escapeHtml(shop.address)}</div>` : ''}
            ${ticketType !== 'kitchen' && shop.phone_contact ? `<div style="font-size:11px;">${escapeHtml(tx('SĐT', 'Tel'))}: ${escapeHtml(shop.phone_contact)}</div>` : ''}
          </div>

          <div style="text-align:center;margin-bottom:8px;">
            <div style="font-size:14px;font-weight:900;">${escapeHtml(ticketHeaderTitle)}</div>
            <div style="font-size:11px;">${escapeHtml(tx('Mã đơn', 'Order'))}: <strong>#${escapeHtml(activeOrder.order_code)}</strong> • <strong>${escapeHtml(activeOrder.table_label)}</strong></div>
            <div style="font-size:10px;color:#334155;">${escapeHtml(tx('Giờ tạo', 'Time'))}: ${escapeHtml(formattedDate)} • Bill v${billVersion}</div>
            ${reprintBadgeHtml}
          </div>

          <table style="border-top:1px dashed #000;border-bottom:1px dashed #000;margin-bottom:8px;">
            <thead>
              <tr style="border-bottom:1px solid #000;font-size:11px;">
                <th style="text-align:left;padding:4px 0;">${escapeHtml(tx('Món', 'Item'))}</th>
                <th style="text-align:${ticketType === 'kitchen' ? 'right' : 'center'};padding:4px;">${escapeHtml(tx('SL', 'Qty'))}</th>
                ${ticketType !== 'kitchen' ? `<th style="text-align:right;padding:4px 0;">${escapeHtml(tx('T.Tiền', 'Amount'))}</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${itemsRowsHtml}
            </tbody>
          </table>

          ${totalsSectionHtml}

          ${qrSectionHtml}

          ${
            ticketType !== 'kitchen'
              ? `
          <div style="text-align:center;margin-top:8px;font-size:11px;">
            ${wifiHtml}
            <div style="margin-top:6px;font-weight:700;">${escapeHtml(tx('Cảm ơn Quý khách & Hẹn gặp lại!', 'Thank you & see you again!'))}</div>
            <div style="font-size:9px;color:#64748b;margin-top:2px;">Powered by Qlaok Smart POS</div>
          </div>`
              : ''
          }
        </body>
      </html>
    `;
    }

    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-same-origin', 'allow-modals');
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
        setTimeout(triggerPrint, 1800);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-white p-4 sm:p-5 shadow-2xl border border-slate-200 space-y-3.5 my-6">
        {/* Top Modal Controls */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                {ticketType === 'label'
                  ? tx('In tem món / Nhãn pha chế', 'Production Label Print')
                  : t('receipt.modalTitle', { size: paperSize })}
              </h3>
              <p className="text-[11px] text-slate-500">
                {tx(
                  'Đơn #{code} • {table} • Bill v{version}',
                  'Order #{code} • {table} • Bill v{version}',
                  {
                    code: activeOrder.order_code,
                    table: activeOrder.table_label,
                    version: billVersion,
                  }
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 4 Ticket Type Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-2xl bg-slate-100 p-1 border border-slate-200">
          <button
            type="button"
            data-testid="print-tab-kitchen"
            onClick={() => handleSelectTicketType('kitchen')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 px-2 text-[11px] font-black transition ${
              ticketType === 'kitchen'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ChefHat className="h-3.5 w-3.5" />
            <span>{t('receipt.ticketKitchen')}</span>
          </button>
          <button
            type="button"
            data-testid="print-tab-provisional"
            onClick={() => handleSelectTicketType('provisional')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 px-2 text-[11px] font-black transition ${
              ticketType === 'provisional'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{t('receipt.ticketProvisional')}</span>
          </button>
          <button
            type="button"
            data-testid="print-tab-receipt"
            onClick={() => handleSelectTicketType('receipt')}
            disabled={activeOrder.payment_status !== 'paid'}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 px-2 text-[11px] font-black transition ${
              ticketType === 'receipt'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>{t('receipt.ticketReceipt')}</span>
          </button>
          <button
            type="button"
            data-testid="print-tab-label"
            onClick={() => handleSelectTicketType('label')}
            className={`flex items-center justify-center gap-1 rounded-xl py-2 px-2 text-[11px] font-black transition ${
              ticketType === 'label'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>{tx('Tem món', 'Labels')}</span>
          </button>
        </div>

        {/* Paper Size & QR Options (Hidden in Label Mode) */}
        {ticketType !== 'label' ? (
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
                {tx('Khổ K80 (80mm)', '80mm (K80)')}
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
                {tx('Khổ K58 (58mm)', '58mm (K58)')}
              </button>
            </div>

            {ticketType !== 'kitchen' && (
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeQrOnBill && qrInfo.isConfigured}
                  disabled={!qrInfo.isConfigured}
                  onChange={(e) => setIncludeQrOnBill(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 disabled:opacity-40"
                />
                <span>
                  {qrInfo.isConfigured
                    ? tx('Kèm mã QR trên bill', 'Include QR on bill')
                    : tx('Chưa cài STK ngân hàng', 'Bank account not set')}
                </span>
              </label>
            )}
          </div>
        ) : (
          /* Label Mode Summary: Preset, Label Count, Configured Maximum */
          <div
            data-testid="label-print-summary-bar"
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-2.5 border border-slate-200/80 text-xs"
          >
            <div className="flex items-center gap-1.5 font-black text-slate-900">
              <Tag className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span data-testid="label-print-preset-name">
                {labelPreflight.presetLabel}
              </span>
            </div>
            <div
              data-testid="label-print-count-summary"
              className="flex items-center gap-1.5 font-bold text-slate-700"
            >
              <span>
                {tx(
                  'Số tem: {count} / tối đa {max}',
                  'Labels: {count} / max {max}',
                  {
                    count: labelPreflight.ok
                      ? labelPreflight.labelCount
                      : labelPreflight.requestedCount,
                    max: labelPreflight.maxLabels,
                  }
                )}
              </span>
            </div>
          </div>
        )}

        {/* Warning when Bank Account is not configured (Bill modes only) */}
        {ticketType !== 'kitchen' &&
          ticketType !== 'label' &&
          !qrInfo.isConfigured && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <p className="font-black">
                  {tx(
                    'Chưa cấu hình tài khoản ngân hàng',
                    'Bank account not configured'
                  )}
                </p>
                <p>
                  {tx(
                    'Vui lòng cài đặt số tài khoản ngân hàng của quán trong mục Cài đặt thanh toán để in mã QR.',
                    'Please configure your store bank account in Store Settings to print a payment QR code.'
                  )}
                </p>
              </div>
            </div>
          )}

        {/* Warning when selecting Paid Receipt on an Unpaid Order */}
        {ticketType === 'receipt' && activeOrder.payment_status !== 'paid' && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-black">
                {tx('Đơn hàng chưa thu tiền', 'Order is unpaid')}
              </p>
              <p>
                {tx(
                  'Biên lai đã thanh toán chỉ được in sau khi xác nhận thu tiền thành công. Bạn có thể chuyển sang tab Tạm tính để gửi bill cho khách kiểm tra.',
                  'Paid receipts can only be printed after payment is confirmed. Switch to Provisional bill to print an unpaid summary for the guest.'
                )}
              </p>
            </div>
          </div>
        )}

        {/* Warning when Label Preflight fails (disabled, empty/invalid, or over limit) */}
        {ticketType === 'label' && !labelPreflight.ok && (
          <div
            role="alert"
            data-testid="label-print-preflight-error"
            className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-black">
                {labelPreflight.errorCode === 'CONFIG_DISABLED'
                  ? tx('In tem món đang tắt', 'Label printing is disabled')
                  : labelPreflight.errorCode === 'EXCEEDS_MAX_LABELS'
                    ? tx(
                        'Vượt quá giới hạn số tem mỗi lần in',
                        'Exceeds maximum labels per print'
                      )
                    : tx(
                        'Không thể tạo lô tem in',
                        'Cannot generate label batch'
                      )}
              </p>
              <p>{labelPreflight.errorMessage}</p>
            </div>
          </div>
        )}

        {/* Preview Area: Label Mode vs Thermal Paper Bill Preview */}
        {ticketType === 'label' ? (
          <div
            data-testid="label-print-preview"
            className="max-h-[50vh] overflow-y-auto flex flex-col items-center justify-center bg-slate-100 rounded-2xl p-3 border border-slate-200 space-y-2"
          >
            {labelPreflight.ok && labelPreflight.firstLabelPreview ? (
              <>
                <p className="text-[11px] font-bold text-slate-600">
                  {tx(
                    'Xem trước tem đầu tiên (1/{total})',
                    'First label preview (1/{total})',
                    { total: labelPreflight.labelCount }
                  )}
                </p>
                <div
                  style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                  className={`qr-light-surface rounded-xl bg-white p-3.5 shadow-md border border-slate-300 font-mono text-xs space-y-1.5 ${
                    labelPreflight.presetSpec.width_mm <= 40
                      ? 'w-full max-w-[210px]'
                      : labelPreflight.presetSpec.width_mm <= 50
                        ? 'w-full max-w-[240px]'
                        : labelPreflight.presetSpec.width_mm <= 58
                          ? 'w-full max-w-[260px]'
                          : 'w-full max-w-[310px]'
                  }`}
                >
                  {currentPrintCount >= 1 && (
                    <div>
                      <span className="inline-block rounded border border-slate-900 px-1.5 py-0.5 text-[10px] font-black text-slate-900 uppercase">
                        {tx(
                          'BẢN IN LẠI (#{count})',
                          'REPRINT (#{count})',
                          { count: currentPrintCount }
                        )}
                      </span>
                    </div>
                  )}

                  {labelPreflight.firstLabelPreview.shopName && (
                    <p className="text-xs font-black uppercase text-center truncate text-slate-950">
                      {labelPreflight.firstLabelPreview.shopName}
                    </p>
                  )}

                  {(labelPreflight.firstLabelPreview.orderCode ||
                    labelPreflight.firstLabelPreview.tableLabel ||
                    labelPreflight.firstLabelPreview.sequenceText) && (
                    <div className="flex items-center justify-between gap-2 border-b border-dashed border-slate-400 pb-1 text-[11px] font-bold text-slate-900">
                      <span>{labelPreflight.firstLabelPreview.orderCode}</span>
                      <span className="truncate">
                        {labelPreflight.firstLabelPreview.tableLabel}
                      </span>
                      <span>
                        {labelPreflight.firstLabelPreview.sequenceText}
                      </span>
                    </div>
                  )}

                  {labelPreflight.firstLabelPreview.timestampText && (
                    <p className="text-[10px] text-slate-500">
                      {labelPreflight.firstLabelPreview.timestampText}
                    </p>
                  )}

                  <div className="space-y-1.5 pt-0.5">
                    {labelPreflight.firstLabelPreview.items.map((item, idx) => (
                      <div key={idx} className="space-y-0.5 text-[11px]">
                        {(item.displayName || item.priceText) && (
                          <div className="flex items-start justify-between gap-2 font-black text-slate-950">
                            <span>{item.displayName}</span>
                            {item.priceText && (
                              <span className="shrink-0">{item.priceText}</span>
                            )}
                          </div>
                        )}
                        {item.optionsText && (
                          <p className="text-[10px] text-slate-600">
                            + {item.optionsText}
                          </p>
                        )}
                        {item.tagsText && (
                          <p className="text-[10px] font-bold text-slate-700">
                            {item.tagsText}
                          </p>
                        )}
                        {item.noteText && (
                          <p className="text-[10px] italic text-slate-600">
                            * {item.noteText}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {labelPreflight.firstLabelPreview.orderNoteText && (
                    <div className="border-t border-dotted border-slate-400 pt-1 text-[10px] italic text-slate-700">
                      {labelPreflight.firstLabelPreview.orderNoteText}
                    </div>
                  )}

                  {labelPreflight.firstLabelPreview.hasPaymentQr &&
                    labelPreflight.firstLabelPreview.paymentQr && (
                      <div className="border-t border-dashed border-slate-300 pt-2 text-center space-y-1">
                        <img
                          src={
                            labelPreflight.firstLabelPreview.paymentQr
                              .qrImageUrl || ''
                          }
                          alt="Payment QR"
                          className="mx-auto h-24 w-24 object-contain rounded border border-slate-200 p-1 bg-white"
                        />
                        {labelPreflight.firstLabelPreview.paymentQr
                          .transferContent && (
                          <p className="text-[10px] font-bold text-slate-700">
                            {
                              labelPreflight.firstLabelPreview.paymentQr
                                .transferContent
                            }
                          </p>
                        )}
                      </div>
                    )}

                  {labelPreflight.firstLabelPreview.footerText && (
                    <div className="border-t border-dashed border-slate-300 pt-1 text-center text-[10px] italic text-slate-600">
                      {labelPreflight.firstLabelPreview.footerText}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="p-4 text-center text-xs font-semibold text-slate-500">
                {labelPreflight.errorMessage}
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto flex justify-center bg-slate-100 rounded-2xl p-3 border border-slate-200">
            <div
              ref={receiptRef}
              style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
              className={`qr-light-surface rounded-xl bg-white p-4 shadow-md border border-slate-200 font-mono text-xs space-y-3 ${
                paperSize === '80mm'
                  ? 'w-full max-w-[310px]'
                  : 'w-full max-w-[240px]'
              }`}
            >
              {/* Shop Header */}
              <div className="text-center border-b border-dashed border-slate-400 pb-2.5 space-y-0.5">
                <p className="text-sm font-black uppercase tracking-tight text-slate-950">
                  {shop.name}
                </p>
                {ticketType !== 'kitchen' && shop.address && (
                  <p className="text-[10px] text-slate-600 flex items-center justify-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span>{shop.address}</span>
                  </p>
                )}
                {ticketType !== 'kitchen' && shop.phone_contact && (
                  <p className="text-[10px] text-slate-600 flex items-center justify-center gap-1">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span>
                      {tx('SĐT', 'Tel')}: {shop.phone_contact}
                    </span>
                  </p>
                )}
              </div>

              {/* Bill Title & Meta */}
              <div className="text-center space-y-0.5">
                <p className="text-xs font-black tracking-wider text-slate-950">
                  {ticketHeaderTitle}
                </p>
                <p className="text-[11px] font-bold text-slate-800">
                  #{activeOrder.order_code} • {activeOrder.table_label}
                </p>
                <p className="text-[10px] text-slate-500">
                  {formattedDate} • Bill v{billVersion}
                </p>
                {currentPrintCount >= 1 && (
                  <span className="inline-block mt-1 rounded border border-slate-900 px-1.5 py-0.5 text-[10px] font-black text-slate-900">
                    {tx(
                      'BẢN IN LẠI (Đã in {count} lần)',
                      'REPRINT (Printed {count}x)',
                      { count: currentPrintCount }
                    )}
                  </span>
                )}
              </div>

              {/* Line Items Table */}
              <div className="border-t border-b border-dashed border-slate-400 py-2 space-y-1.5">
                <div className="flex justify-between text-[10px] font-black text-slate-500 border-b border-slate-200 pb-1">
                  <span>{tx('TÊN MÓN', 'ITEM')}</span>
                  <span>
                    {ticketType === 'kitchen'
                      ? tx('SỐ LƯỢNG', 'QTY')
                      : tx('SL x Đ.GIÁ = T.TIỀN', 'QTY x PRICE = TOTAL')}
                  </span>
                </div>

                {activeOrder.items.map((line, idx) => {
                  const unitPrice = line.unit_price + line.extra_price;
                  const lineTotal = unitPrice * line.quantity;
                  return (
                    <div key={idx} className="text-[11px] space-y-0.5">
                      <div className="flex justify-between gap-2 font-bold text-slate-900">
                        <span className="flex-1">{line.name_vi}</span>
                        {ticketType === 'kitchen' ? (
                          <span className="shrink-0 text-sm font-black">
                            x{line.quantity}
                          </span>
                        ) : (
                          <span className="shrink-0">
                            {line.quantity} x{' '}
                            {formatCurrency(unitPrice, shop.currency)} ={' '}
                            <strong>
                              {formatCurrency(lineTotal, shop.currency)}
                            </strong>
                          </span>
                        )}
                      </div>
                      {line.selected_choices &&
                        line.selected_choices.length > 0 && (
                          <p className="text-[10px] text-slate-500">
                            +{' '}
                            {line.selected_choices
                              .map((c) => c.label_i18n?.vi || c.label_vi)
                              .filter(Boolean)
                              .join(', ')}
                          </p>
                        )}
                      {line.quick_tags && line.quick_tags.length > 0 && (
                        <p className="text-[10px] font-bold text-slate-700">
                          [{line.quick_tags.join(', ')}]
                        </p>
                      )}
                      {line.custom_note && (
                        <p className="text-[10px] italic text-slate-500">
                          {tx('Ghi chú', 'Note')}: {line.custom_note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Totals Breakdown (Hidden on Kitchen Ticket) */}
              {ticketType === 'kitchen' ? (
                activeOrder.customer_note ? (
                  <div className="rounded-lg border border-slate-900 p-2 text-[11px] font-bold text-slate-900">
                    {tx('Ghi chú đơn', 'Order note')}: {activeOrder.customer_note}
                  </div>
                ) : null
              ) : (
                <div className="space-y-1">
                  {discount > 0 && (
                    <>
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>{t('pos.subtotal')}:</span>
                        <span>{formatCurrency(subtotal, shop.currency)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] font-bold text-rose-600">
                        <span>{t('pos.discount')}:</span>
                        <span>-{formatCurrency(discount, shop.currency)}</span>
                      </div>
                    </>
                  )}

                  <div className="flex justify-between items-baseline pt-1 border-t border-slate-900 text-sm font-black text-slate-950">
                    <span>{tx('TỔNG CỘNG:', 'TOTAL:')}</span>
                    <span className="text-base text-emerald-700">
                      {formatCurrency(activeOrder.total_amount, shop.currency)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] pt-0.5">
                    <span className="text-slate-600">
                      {tx('TT:', 'Pay:')}{' '}
                      {activeOrder.payment_method === 'vietqr'
                        ? t('orders.paymentMethodQr')
                        : t('orders.paymentMethodCash')}
                    </span>
                    <span
                      className={`font-black ${
                        activeOrder.payment_status === 'paid'
                          ? 'text-emerald-700'
                          : activeOrder.payment_status === 'refunded'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {activeOrder.payment_status === 'paid'
                        ? tx('✓ ĐÃ THU TIỀN', '✓ PAID')
                        : activeOrder.payment_status === 'refunded'
                          ? tx('↩ ĐÃ HOÀN TIỀN', '↩ REFUNDED')
                          : tx('⏳ TẠM TÍNH / CHƯA THU', '⏳ UNPAID')}
                    </span>
                  </div>
                </div>
              )}

              {/* QR Code on Bill */}
              {canShowQr && (
                <div className="border-t border-dashed border-slate-300 pt-2.5 text-center space-y-1.5">
                  <p className="text-[10px] font-black uppercase text-slate-900 flex items-center justify-center gap-1">
                    <QrCode className="h-3 w-3 text-emerald-600" />
                    <span>
                      {tx(
                        'Quét Mã QR Để Chuyển Khoản',
                        'Scan QR To Pay By Transfer'
                      )}
                    </span>
                  </p>
                  <img
                    src={qrInfo.qrImageUrl}
                    alt="VietQR"
                    className="mx-auto h-36 w-36 object-contain rounded-lg border border-slate-200 p-1 bg-white"
                  />
                  <div className="text-[10px] text-slate-700 leading-snug space-y-0.5">
                    <p>
                      {tx('NH', 'Bank')}: <strong>{qrInfo.bankShortName}</strong>
                    </p>
                    {qrInfo.accountNumber && (
                      <p>
                        {tx('STK', 'Acct')}:{' '}
                        <strong>{qrInfo.accountNumber}</strong>
                      </p>
                    )}
                    <p>
                      {tx('Chủ TK', 'Name')}:{' '}
                      <strong>{qrInfo.accountName}</strong>
                    </p>
                    <p>
                      {tx('ND', 'Memo')}:{' '}
                      <strong>{qrInfo.transferContent}</strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Wi-Fi & Footer */}
              {ticketType !== 'kitchen' && (
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
                    {tx(
                      'Cảm ơn Quý khách & Hẹn gặp lại!',
                      'Thank you & see you again!'
                    )}
                  </p>
                  <p className="text-[9px] text-slate-400 flex items-center justify-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" />
                    <span>Qlaok Smart Restaurant POS</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Print Action Buttons */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-100"
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              data-testid="print-submit-button"
              disabled={
                (ticketType === 'receipt' &&
                  activeOrder.payment_status !== 'paid') ||
                (ticketType === 'label' && !labelPreflight.canPrint)
              }
              onClick={handlePrintThermalReceipt}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 px-5 text-xs sm:text-sm font-black text-white shadow-lg hover:bg-emerald-500 active:scale-98 transition disabled:opacity-40"
            >
              <Printer className="h-4 w-4" />
              <span>
                {ticketType === 'label'
                  ? tx(
                      'In tem ngay ({count} tem)',
                      'Print labels ({count})',
                      {
                        count: labelPreflight.ok
                          ? labelPreflight.labelCount
                          : 0,
                      }
                    )
                  : t('receipt.printNow', { size: paperSize })}
              </span>
            </button>
          </div>

          {ticketType !== 'label' &&
            onConfirmPaid &&
            canCollectPayment &&
            activeOrder.payment_status === 'unpaid' && (
              <button
                type="button"
                disabled={confirmingPaid}
                onClick={async () => {
                  setConfirmingPaid(true);
                  try {
                    await onConfirmPaid(activeOrder);
                  } catch (error) {
                    window.alert(
                      error instanceof Error && error.message
                        ? error.message
                        : tx(
                            'Không thể xác nhận thanh toán',
                            'Could not confirm payment'
                          )
                    );
                  } finally {
                    setConfirmingPaid(false);
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-300 bg-emerald-50 py-2.5 px-4 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>
                  {confirmingPaid
                    ? t('common.saving')
                    : tx(
                        '✓ Xác nhận khách đã thanh toán xong',
                        '✓ Confirm payment received'
                      )}
                </span>
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
