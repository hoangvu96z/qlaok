'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Search,
  Filter,
  Printer,
  RefreshCw,
  Banknote,
  QrCode,
  ShoppingBag,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  XCircle,
  ChefHat,
  Utensils,
  ArrowLeft,
} from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { ShopOrder } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import { ReceiptPrintModal } from '@/components/dashboard/ReceiptPrintModal';

type DateRangeMode =
  | 'today'
  | 'yesterday'
  | '7days'
  | '30days'
  | 'this_month'
  | 'single_day'
  | 'custom_range'
  | 'all';

function getVnDateKey(dateInput: Date | string | number = new Date()): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  return new Date(ts + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function getVnDateTimeString(dateInput: Date | string | number): string {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const base = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return getVnDateKey();
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function formatDateKeyVi(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  if (!y || !m || !d) return dateKey;
  return `${d}/${m}/${y}`;
}

function formatChoicesText(choices: unknown): string {
  if (!Array.isArray(choices) || choices.length === 0) return '';
  return choices
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') {
        const obj = c as {
          label_vi?: string;
          label_i18n?: { vi?: string };
          extra_price?: number;
        };
        const label = obj.label_vi || obj.label_i18n?.vi || '';
        return label;
      }
      return '';
    })
    .filter(Boolean)
    .join(', ');
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const str = String(val ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(val: string | number | null | undefined): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function OrdersReportAndExportPage() {
  const { activeShop } = useDashboard();
  const { t, tx } = useAppI18n();
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingOrder, setPrintingOrder] = useState<ShopOrder | null>(null);

  const todayVn = useMemo(() => getVnDateKey(), []);
  const [rangeMode, setRangeMode] = useState<DateRangeMode>('today');
  const [singleDate, setSingleDate] = useState<string>(todayVn);
  const [customFrom, setCustomFrom] = useState<string>(
    shiftDateKey(todayVn, -6)
  );
  const [customTo, setCustomTo] = useState<string>(todayVn);

  const [statusFilter, setStatusFilter] = useState<
    'valid_only' | 'all' | 'completed' | 'preparing' | 'new' | 'cancelled'
  >('valid_only');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<
    'all' | 'paid' | 'unpaid'
  >('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<
    'all' | 'cash' | 'vietqr'
  >('all');
  const [sourceFilter, setSourceFilter] = useState<
    'all' | 'counter_pos' | 'qr_table'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeViewTab, setActiveViewTab] = useState<
    'orders_list' | 'daily_summary' | 'items_summary'
  >('orders_list');

  const fetchOrders = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetch(
          `/api/orders?shopId=${encodeURIComponent(activeShop.id)}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          setOrders(data.orders || []);
        }
      } catch (err) {
        console.error('Failed to load orders for export:', err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeShop]
  );

  useEffect(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Compute active [startDateKey, endDateKey] in Vietnam Time (YYYY-MM-DD)
  const effectiveDateBounds = useMemo(() => {
    const nowKey = getVnDateKey();
    switch (rangeMode) {
      case 'today':
        return {
          start: nowKey,
          end: nowKey,
          label: tx('Hôm nay ({date})', 'Today ({date})', {
            date: formatDateKeyVi(nowKey),
          }),
        };
      case 'yesterday': {
        const yKey = shiftDateKey(nowKey, -1);
        return {
          start: yKey,
          end: yKey,
          label: tx('Hôm qua ({date})', 'Yesterday ({date})', {
            date: formatDateKeyVi(yKey),
          }),
        };
      }
      case '7days': {
        const sKey = shiftDateKey(nowKey, -6);
        return {
          start: sKey,
          end: nowKey,
          label: tx('7 ngày qua ({start} - {end})', 'Last 7 days ({start} - {end})', {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }),
        };
      }
      case '30days': {
        const sKey = shiftDateKey(nowKey, -29);
        return {
          start: sKey,
          end: nowKey,
          label: tx('30 ngày qua ({start} - {end})', 'Last 30 days ({start} - {end})', {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }),
        };
      }
      case 'this_month': {
        const sKey = `${nowKey.slice(0, 7)}-01`;
        return {
          start: sKey,
          end: nowKey,
          label: tx('Tháng này ({start} - {end})', 'This month ({start} - {end})', {
            start: formatDateKeyVi(sKey),
            end: formatDateKeyVi(nowKey),
          }),
        };
      }
      case 'single_day': {
        const dKey = singleDate || nowKey;
        return {
          start: dKey,
          end: dKey,
          label: tx('Ngày {date}', 'Date {date}', {
            date: formatDateKeyVi(dKey),
          }),
        };
      }
      case 'custom_range': {
        const from = customFrom || nowKey;
        const to = customTo || nowKey;
        const start = from <= to ? from : to;
        const end = from <= to ? to : from;
        return {
          start,
          end,
          label: tx('Từ {start} đến {end}', '{start} to {end}', {
            start: formatDateKeyVi(start),
            end: formatDateKeyVi(end),
          }),
        };
      }
      case 'all':
      default:
        return {
          start: '0000-01-01',
          end: '9999-12-31',
          label: tx('Tất cả thời gian', 'All time'),
        };
    }
  }, [rangeMode, singleDate, customFrom, customTo, tx]);

  // Filter orders according to selected date bounds + status + payment + source + search
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((ord) => {
      const ordDateKey = getVnDateKey(ord.created_at);
      if (
        ordDateKey < effectiveDateBounds.start ||
        ordDateKey > effectiveDateBounds.end
      ) {
        return false;
      }

      if (statusFilter === 'valid_only' && ord.status === 'cancelled') {
        return false;
      }
      if (
        statusFilter !== 'valid_only' &&
        statusFilter !== 'all' &&
        ord.status !== statusFilter
      ) {
        return false;
      }

      if (
        paymentStatusFilter !== 'all' &&
        ord.payment_status !== paymentStatusFilter
      ) {
        return false;
      }

      if (
        paymentMethodFilter !== 'all' &&
        ord.payment_method !== paymentMethodFilter
      ) {
        return false;
      }

      if (sourceFilter !== 'all' && ord.source !== sourceFilter) {
        return false;
      }

      if (q) {
        const matchCode = ord.order_code?.toLowerCase().includes(q);
        const matchTable = ord.table_label?.toLowerCase().includes(q);
        const matchNote = ord.customer_note?.toLowerCase().includes(q);
        const matchItems = (ord.items || []).some((it) =>
          it.name_vi?.toLowerCase().includes(q)
        );
        if (!matchCode && !matchTable && !matchNote && !matchItems) {
          return false;
        }
      }

      return true;
    });
  }, [
    orders,
    effectiveDateBounds,
    statusFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    sourceFilter,
    searchQuery,
  ]);

  // Compute aggregate KPIs for filtered orders
  const kpiStats = useMemo(() => {
    const validOrders = filteredOrders.filter((o) => o.status !== 'cancelled');
    const totalRevenue = validOrders.reduce(
      (sum, o) => sum + Number(o.total_amount || 0),
      0
    );
    const totalDiscount = validOrders.reduce(
      (sum, o) => sum + Number(o.discount_amount || 0),
      0
    );
    const cashOrders = validOrders.filter((o) => o.payment_method === 'cash');
    const vietqrOrders = validOrders.filter(
      (o) => o.payment_method === 'vietqr'
    );
    const cashRevenue = cashOrders.reduce(
      (sum, o) => sum + Number(o.total_amount || 0),
      0
    );
    const vietqrRevenue = vietqrOrders.reduce(
      (sum, o) => sum + Number(o.total_amount || 0),
      0
    );
    const paidOrders = validOrders.filter((o) => o.payment_status === 'paid');
    const unpaidOrders = validOrders.filter(
      (o) => o.payment_status !== 'paid'
    );
    const totalItemsSold = validOrders.reduce(
      (sum, o) =>
        sum +
        (o.items || []).reduce(
          (s, it) => s + Math.max(1, Number(it.quantity || 1)),
          0
        ),
      0
    );

    return {
      totalCount: filteredOrders.length,
      validCount: validOrders.length,
      totalRevenue,
      totalDiscount,
      cashCount: cashOrders.length,
      cashRevenue,
      vietqrCount: vietqrOrders.length,
      vietqrRevenue,
      paidCount: paidOrders.length,
      unpaidCount: unpaidOrders.length,
      totalItemsSold,
      avgOrderValue:
        validOrders.length > 0
          ? Math.round(totalRevenue / validOrders.length)
          : 0,
    };
  }, [filteredOrders]);

  // Daily breakdown summary
  const dailySummaryList = useMemo(() => {
    const map = new Map<
      string,
      {
        dateKey: string;
        ordersCount: number;
        itemsSold: number;
        cashRevenue: number;
        vietqrRevenue: number;
        totalRevenue: number;
      }
    >();

    for (const ord of filteredOrders) {
      if (ord.status === 'cancelled') continue;
      const dKey = getVnDateKey(ord.created_at);
      const curr = map.get(dKey) || {
        dateKey: dKey,
        ordersCount: 0,
        itemsSold: 0,
        cashRevenue: 0,
        vietqrRevenue: 0,
        totalRevenue: 0,
      };
      const itemQty = (ord.items || []).reduce(
        (s, it) => s + Math.max(1, Number(it.quantity || 1)),
        0
      );
      const amt = Number(ord.total_amount || 0);
      curr.ordersCount += 1;
      curr.itemsSold += itemQty;
      curr.totalRevenue += amt;
      if (ord.payment_method === 'vietqr') {
        curr.vietqrRevenue += amt;
      } else {
        curr.cashRevenue += amt;
      }
      map.set(dKey, curr);
    }

    return Array.from(map.values()).sort((a, b) =>
      b.dateKey.localeCompare(a.dateKey)
    );
  }, [filteredOrders]);

  // Item breakdown summary
  const itemSummaryList = useMemo(() => {
    const map = new Map<
      string,
      {
        itemName: string;
        orderAppearances: number;
        quantitySold: number;
        revenue: number;
      }
    >();

    for (const ord of filteredOrders) {
      if (ord.status === 'cancelled') continue;
      for (const line of ord.items || []) {
        const key = line.name_vi || line.item_id || tx('Món khác', 'Other item');
        const curr = map.get(key) || {
          itemName: key,
          orderAppearances: 0,
          quantitySold: 0,
          revenue: 0,
        };
        const qty = Math.max(1, Number(line.quantity || 1));
        const lineRev =
          (Number(line.unit_price || 0) + Number(line.extra_price || 0)) * qty;
        curr.orderAppearances += 1;
        curr.quantitySold += qty;
        curr.revenue += lineRev;
        map.set(key, curr);
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue
    );
  }, [filteredOrders, tx]);

  // Export 1: CSV Summary by Order (1 row = 1 order)
  const handleExportOrdersCsv = () => {
    if (!activeShop) return;
    const headers = [
      tx('STT', 'No.'),
      tx('Mã Đơn', 'Order Code'),
      tx('Ngày (VN)', 'Date (VN)'),
      tx('Giờ Tạo (VN)', 'Created Time (VN)'),
      tx('Bàn / Vị Trí', 'Table / Location'),
      tx('Nguồn Đơn', 'Source'),
      tx('Chi Tiết Món Đã Gọi', 'Ordered Items'),
      tx('Tổng Số Món', 'Total Items'),
      tx('Tạm Tính', 'Subtotal'),
      tx('Giảm Giá', 'Discount'),
      tx('Tổng Thu', 'Total Amount'),
      tx('Phương Thức Thanh Toán', 'Payment Method'),
      tx('Trạng Thái Thu Tiền', 'Payment Status'),
      tx('Trạng Thái Đơn', 'Order Status'),
      tx('Ghi Chú Bàn', 'Table Note'),
    ];

    const rows = filteredOrders.map((ord, index) => {
      const dateKey = formatDateKeyVi(getVnDateKey(ord.created_at));
      const fullTime = getVnDateTimeString(ord.created_at);
      const itemsText = (ord.items || [])
        .map((it) => {
          const optText = formatChoicesText(it.selected_choices);
          const noteText = it.custom_note ? ` [${it.custom_note}]` : '';
          return `${it.quantity}x ${it.name_vi}${optText ? ` (${optText})` : ''}${noteText}`;
        })
        .join(' | ');
      const totalQty = (ord.items || []).reduce(
        (s, it) => s + Math.max(1, Number(it.quantity || 1)),
        0
      );

      return [
        index + 1,
        ord.order_code,
        dateKey,
        fullTime,
        ord.table_label,
        ord.source === 'counter_pos'
          ? tx('Tại quầy (POS)', 'Counter POS')
          : tx('Khách quét QR', 'Table QR'),
        itemsText,
        totalQty,
        ord.subtotal_amount ?? ord.total_amount,
        ord.discount_amount ?? 0,
        ord.total_amount,
        ord.payment_method === 'vietqr'
          ? tx('Chuyển khoản VietQR', 'VietQR Transfer')
          : tx('Tiền mặt', 'Cash'),
        ord.payment_status === 'paid'
          ? tx('Đã thu tiền', 'Paid')
          : tx('Chưa thu tiền', 'Unpaid'),
        ord.status === 'completed'
          ? tx('Hoàn tất', 'Completed')
          : ord.status === 'preparing'
            ? tx('Đang chế biến', 'Preparing')
            : ord.status === 'new'
              ? tx('Mới chờ nhận', 'New')
              : tx('Đã hủy', 'Cancelled'),
        ord.customer_note || '',
      ];
    });

    const csvContent =
      '\uFEFF' +
      [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((r) => r.map(escapeCsvCell).join(',')),
      ].join('\r\n');

    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Don-Hang-${activeShop.slug}-${effectiveDateBounds.start}_den_${effectiveDateBounds.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export 2: CSV Detailed Line Items (1 row = 1 dish in an order)
  const handleExportLineItemsCsv = () => {
    if (!activeShop) return;
    const headers = [
      tx('STT', 'No.'),
      tx('Mã Đơn', 'Order Code'),
      tx('Ngày (VN)', 'Date (VN)'),
      tx('Giờ Tạo (VN)', 'Created Time (VN)'),
      tx('Bàn / Vị Trí', 'Table / Location'),
      tx('Tên Món', 'Item Name'),
      tx('Số Lượng', 'Quantity'),
      tx('Đơn Giá Gốc', 'Base Price'),
      tx('Phụ Thu Topping/Option', 'Add-on Price'),
      tx('Thành Tiền Món', 'Line Total'),
      tx('Option / Topping Đã Chọn', 'Selected Options'),
      tx('Ghi Chú Món', 'Item Note'),
      tx('Phương Thức TT', 'Payment Method'),
      tx('Trạng Thái TT', 'Payment Status'),
      tx('Trạng Thái Đơn', 'Order Status'),
    ];

    const rows: Array<Array<string | number>> = [];
    let stt = 1;

    for (const ord of filteredOrders) {
      const dateKey = formatDateKeyVi(getVnDateKey(ord.created_at));
      const fullTime = getVnDateTimeString(ord.created_at);
      for (const line of ord.items || []) {
        const qty = Math.max(1, Number(line.quantity || 1));
        const unitPrice = Number(line.unit_price || 0);
        const extraPrice = Number(line.extra_price || 0);
        const lineTotal = (unitPrice + extraPrice) * qty;
        const optText = formatChoicesText(line.selected_choices);

        rows.push([
          stt++,
          ord.order_code,
          dateKey,
          fullTime,
          ord.table_label,
          line.name_vi,
          qty,
          unitPrice,
          extraPrice,
          lineTotal,
          optText,
          line.custom_note || '',
          ord.payment_method === 'vietqr'
            ? tx('Chuyển khoản VietQR', 'VietQR Transfer')
            : tx('Tiền mặt', 'Cash'),
          ord.payment_status === 'paid'
            ? tx('Đã thu tiền', 'Paid')
            : tx('Chưa thu tiền', 'Unpaid'),
          ord.status === 'completed'
            ? tx('Hoàn tất', 'Completed')
            : ord.status === 'preparing'
              ? tx('Đang chế biến', 'Preparing')
              : ord.status === 'new'
                ? tx('Mới chờ nhận', 'New')
                : tx('Đã hủy', 'Cancelled'),
        ]);
      }
    }

    const csvContent =
      '\uFEFF' +
      [
        headers.map(escapeCsvCell).join(','),
        ...rows.map((r) => r.map(escapeCsvCell).join(',')),
      ].join('\r\n');

    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Chi-Tiet-Mon-Ban-${activeShop.slug}-${effectiveDateBounds.start}_den_${effectiveDateBounds.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export 3: Formatted Excel Report (.xls) with Order Summary + Item Summary + Totals
  const handleExportExcelReport = () => {
    if (!activeShop) return;

    const orderRowsHtml = filteredOrders
      .map((ord, idx) => {
        const dateKey = formatDateKeyVi(getVnDateKey(ord.created_at));
        const fullTime = getVnDateTimeString(ord.created_at);
        const itemsText = (ord.items || [])
          .map((it) => {
            const optText = formatChoicesText(it.selected_choices);
            const noteText = it.custom_note ? ` [${it.custom_note}]` : '';
            return `${it.quantity}x ${it.name_vi}${optText ? ` (${optText})` : ''}${noteText}`;
          })
          .join('; ');
        const totalQty = (ord.items || []).reduce(
          (s, it) => s + Math.max(1, Number(it.quantity || 1)),
          0
        );

        return `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td style="font-weight:bold;">#${escapeHtml(ord.order_code)}</td>
            <td>${escapeHtml(dateKey)}</td>
            <td>${escapeHtml(fullTime)}</td>
            <td>${escapeHtml(ord.table_label)}</td>
            <td>${ord.source === 'counter_pos' ? tx('Tại quầy (POS)', 'Counter POS') : tx('Khách quét QR', 'Table QR')}</td>
            <td>${escapeHtml(itemsText)}</td>
            <td style="text-align:center;">${totalQty}</td>
            <td style="text-align:right;font-weight:bold;">${Number(ord.total_amount || 0)}</td>
            <td>${ord.payment_method === 'vietqr' ? tx('Chuyển khoản VietQR', 'VietQR Transfer') : tx('Tiền mặt', 'Cash')}</td>
            <td>${ord.payment_status === 'paid' ? tx('Đã thu tiền', 'Paid') : tx('Chưa thu tiền', 'Unpaid')}</td>
            <td>${
              ord.status === 'completed'
                ? tx('Hoàn tất', 'Completed')
                : ord.status === 'preparing'
                  ? tx('Đang chế biến', 'Preparing')
                  : ord.status === 'new'
                    ? tx('Mới chờ nhận', 'New')
                    : tx('Đã hủy', 'Cancelled')
            }</td>
            <td>${escapeHtml(ord.customer_note || '')}</td>
          </tr>
        `;
      })
      .join('');

    const itemRowsHtml = itemSummaryList
      .map(
        (item, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td style="font-weight:bold;">${escapeHtml(item.itemName)}</td>
            <td style="text-align:center;">${item.orderAppearances}</td>
            <td style="text-align:center;font-weight:bold;">${item.quantitySold}</td>
            <td style="text-align:right;font-weight:bold;">${item.revenue}</td>
          </tr>
        `
      )
      .join('');

    const excelHtml = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
          th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
          th { background-color: #0f172a; color: #ffffff; font-weight: bold; }
          .summary-box td { font-size: 13px; padding: 8px; }
        </style>
      </head>
      <body>
        <h2>${tx('BÁO CÁO ĐƠN HÀNG & DOANH THU', 'ORDERS & REVENUE REPORT')} — ${escapeHtml(activeShop.name.toUpperCase())}</h2>
        <p><strong>${tx('Kỳ báo cáo:', 'Period:')}</strong> ${escapeHtml(effectiveDateBounds.label)} | <strong>${tx('Thời điểm xuất file:', 'Exported at:')}</strong> ${escapeHtml(getVnDateTimeString(new Date()))}</p>

        <table class="summary-box">
          <tr>
            <th colspan="2">${tx('TỔNG HỢP KẾT QUẢ KINH DOANH TRONG KỲ', 'PERIOD SUMMARY')}</th>
          </tr>
          <tr>
            <td><strong>${tx('Tổng số đơn hợp lệ:', 'Valid orders:')}</strong></td>
            <td><strong>${tx('{orders} đơn ({items} món bán ra)', '{orders} orders ({items} items sold)', { orders: kpiStats.validCount, items: kpiStats.totalItemsSold })}</strong></td>
          </tr>
          <tr>
            <td><strong>${tx('Doanh thu Tiền mặt:', 'Cash revenue:')}</strong></td>
            <td>${kpiStats.cashRevenue} (${tx('{count} đơn', '{count} orders', { count: kpiStats.cashCount })})</td>
          </tr>
          <tr>
            <td><strong>${tx('Doanh thu Chuyển khoản (VietQR):', 'VietQR transfer revenue:')}</strong></td>
            <td>${kpiStats.vietqrRevenue} (${tx('{count} đơn', '{count} orders', { count: kpiStats.vietqrCount })})</td>
          </tr>
          <tr>
            <td><strong>${tx('TỔNG DOANH THU THỰC NHẬN:', 'NET REVENUE:')}</strong></td>
            <td style="font-size:15px;font-weight:bold;color:#059669;">${kpiStats.totalRevenue}</td>
          </tr>
        </table>

        <h3>1. ${tx('DANH SÁCH CHI TIẾT ĐƠN HÀNG ({count} ĐƠN)', 'ORDER DETAILS ({count} ORDERS)', { count: filteredOrders.length })}</h3>
        <table>
          <thead>
            <tr>
              <th>${tx('STT', 'No.')}</th>
              <th>${tx('Mã Đơn', 'Order Code')}</th>
              <th>${tx('Ngày (VN)', 'Date (VN)')}</th>
              <th>${tx('Giờ Tạo (VN)', 'Time (VN)')}</th>
              <th>${tx('Bàn / Vị Trí', 'Table')}</th>
              <th>${tx('Nguồn Đơn', 'Source')}</th>
              <th>${tx('Chi Tiết Món & Option', 'Items & Options')}</th>
              <th>${tx('SL Món', 'Qty')}</th>
              <th>${tx('Tổng Tiền', 'Total')} (${escapeHtml(activeShop.currency)})</th>
              <th>${tx('Phương Thức TT', 'Payment Method')}</th>
              <th>${tx('Trạng Thái TT', 'Payment Status')}</th>
              <th>${tx('Trạng Thái Đơn', 'Order Status')}</th>
              <th>${tx('Ghi Chú', 'Note')}</th>
            </tr>
          </thead>
          <tbody>
            ${orderRowsHtml}
            <tr style="background-color:#ecfdf5;font-weight:bold;">
              <td colspan="7" style="text-align:right;">${tx('TỔNG CỘNG ({count} đơn hợp lệ):', 'TOTAL ({count} valid orders):', { count: kpiStats.validCount })}</td>
              <td style="text-align:center;">${kpiStats.totalItemsSold}</td>
              <td style="text-align:right;">${kpiStats.totalRevenue}</td>
              <td colspan="4"></td>
            </tr>
          </tbody>
        </table>

        <h3>2. ${tx('THỐNG KÊ SỐ LƯỢNG & DOANH THU THEO TỪNG MÓN BÁN RA', 'REVENUE & QUANTITY BY ITEM')}</h3>
        <table>
          <thead>
            <tr>
              <th>${tx('STT', 'No.')}</th>
              <th>${tx('Tên Món', 'Item Name')}</th>
              <th>${tx('Số Lần Gọi', 'Orders')}</th>
              <th>${tx('Tổng Số Lượng Bán', 'Qty Sold')}</th>
              <th>${tx('Doanh Thu Món', 'Revenue')} (${escapeHtml(activeShop.currency)})</th>
            </tr>
          </thead>
          <tbody>
            ${itemRowsHtml}
          </tbody>
        </table>
      </body>
    </html>`;

    const blob = new Blob([excelHtml], {
      type: 'application/vnd.ms-excel;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bao-Cao-Don-Hang-${activeShop.slug}-${effectiveDateBounds.start}_den_${effectiveDateBounds.end}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!activeShop) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        {tx('Đang tải dữ liệu cửa hàng...', 'Loading shop data...')}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Top Page Header & Export Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 rounded-3xl bg-slate-900 p-5 text-white shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{tx('Quay lại POS & Bếp', 'Back to POS & Kitchen')}</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-black text-emerald-300">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>{tx('BÁO CÁO & XUẤT FILE', 'REPORTS & EXPORT')}</span>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            {tx(
              'Báo cáo',
              'Reports'
            )}
          </h1>
          <p className="text-xs text-slate-300">
            {tx(
              'Lọc đơn theo ngày ({period}) • Múi giờ Việt Nam (GMT+7)',
              'Filter orders by date ({period}) • Vietnam Time (GMT+7)',
              { period: effectiveDateBounds.label }
            )}
          </p>
        </div>

        {/* Export File Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcelReport}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 disabled:opacity-45 transition"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>{tx('Xuất Excel (.xls)', 'Export Excel (.xls)')}</span>
          </button>

          <button
            type="button"
            onClick={handleExportOrdersCsv}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-700 disabled:opacity-45 transition"
          >
            <Download className="h-4 w-4 text-emerald-400" />
            <span>{tx('CSV theo đơn', 'Orders CSV')}</span>
          </button>

          <button
            type="button"
            onClick={handleExportLineItemsCsv}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-700 disabled:opacity-45 transition"
          >
            <Utensils className="h-4 w-4 text-amber-400" />
            <span>{tx('CSV chi tiết món', 'Items CSV')}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchOrders(false)}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Date Range & Custom Filter Card */}
      <div className="rounded-3xl bg-white border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700 mr-1">
              <Calendar className="h-4 w-4 text-emerald-600" />
              <span>{tx('Kỳ báo cáo:', 'Period:')}</span>
            </span>

            {[
              { id: 'today', label: tx('Hôm nay', 'Today') },
              { id: 'yesterday', label: tx('Hôm qua', 'Yesterday') },
              { id: '7days', label: tx('7 ngày qua', 'Last 7 days') },
              { id: '30days', label: tx('30 ngày qua', 'Last 30 days') },
              { id: 'this_month', label: tx('Tháng này', 'This month') },
              { id: 'single_day', label: tx('📅 Chọn 1 ngày', '📅 Single day') },
              {
                id: 'custom_range',
                label: tx('📆 Tùy chỉnh ngày', '📆 Custom range'),
              },
              { id: 'all', label: tx('Tất cả lịch sử', 'All time') },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setRangeMode(preset.id as DateRangeMode)}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                  rangeMode === preset.id
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Single Date Picker OR Custom Date Range Inputs */}
          {rangeMode === 'single_day' && (
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-2xl px-3 py-1.5">
              <button
                type="button"
                onClick={() => setSingleDate((d) => shiftDateKey(d, -1))}
                className="rounded-lg bg-white p-1 text-slate-700 hover:bg-slate-100 border border-slate-200"
                title={tx('Ngày hôm trước', 'Previous day')}
                aria-label={tx('Ngày hôm trước', 'Previous day')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-black text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSingleDate((d) => shiftDateKey(d, 1))}
                className="rounded-lg bg-white p-1 text-slate-700 hover:bg-slate-100 border border-slate-200"
                title={tx('Ngày tiếp theo', 'Next day')}
                aria-label={tx('Ngày tiếp theo', 'Next day')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {rangeMode === 'custom_range' && (
            <div className="flex flex-wrap items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-700">
                  {tx('Từ ngày:', 'From:')}
                </span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-black text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <span className="text-slate-400 font-bold">→</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-700">
                  {tx('Đến ngày:', 'To:')}
                </span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-black text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Secondary Filters Row: Search + Status + Payment + Source */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tx(
                'Tìm mã đơn #ORD, bàn, tên món...',
                'Search #ORD, table, item...'
              )}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value as
                    | 'valid_only'
                    | 'all'
                    | 'completed'
                    | 'preparing'
                    | 'new'
                    | 'cancelled'
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="valid_only">
                {tx('Trạng thái: Đơn hợp lệ', 'Status: Valid orders')}
              </option>
              <option value="all">
                {tx('Trạng thái: Tất cả (cả đơn hủy)', 'Status: All (incl. cancelled)')}
              </option>
              <option value="completed">
                {tx('Trạng thái: Đã hoàn tất', 'Status: Completed')}
              </option>
              <option value="preparing">
                {tx('Trạng thái: Đang chế biến', 'Status: Preparing')}
              </option>
              <option value="new">
                {tx('Trạng thái: Mới chờ nhận', 'Status: New')}
              </option>
              <option value="cancelled">
                {tx('Trạng thái: Đã hủy', 'Status: Cancelled')}
              </option>
            </select>
          </div>

          <div>
            <select
              value={paymentStatusFilter}
              onChange={(e) =>
                setPaymentStatusFilter(
                  e.target.value as 'all' | 'paid' | 'unpaid'
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">
                {tx('Thu tiền: Tất cả', 'Payment: All')}
              </option>
              <option value="paid">
                {tx('Thu tiền: Đã thu tiền', 'Payment: Paid')}
              </option>
              <option value="unpaid">
                {tx('Thu tiền: Chưa thu tiền', 'Payment: Unpaid')}
              </option>
            </select>
          </div>

          <div>
            <select
              value={paymentMethodFilter}
              onChange={(e) =>
                setPaymentMethodFilter(
                  e.target.value as 'all' | 'cash' | 'vietqr'
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">
                {tx('Phương thức: Tất cả', 'Method: All')}
              </option>
              <option value="cash">
                {tx('Phương thức: Tiền mặt', 'Method: Cash')}
              </option>
              <option value="vietqr">
                {tx('Phương thức: VietQR', 'Method: VietQR')}
              </option>
            </select>
          </div>

          <div>
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(
                  e.target.value as 'all' | 'counter_pos' | 'qr_table'
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">
                {tx('Nguồn đơn: Tất cả', 'Source: All')}
              </option>
              <option value="counter_pos">
                {tx('Nguồn: Tại quầy (POS)', 'Source: Counter POS')}
              </option>
              <option value="qr_table">
                {tx('Nguồn: Khách quét QR', 'Source: Table QR')}
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* 4 Summary KPI Cards for Selected Period */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              {tx('Tổng số đơn ({period})', 'Total orders ({period})', {
                period: effectiveDateBounds.label,
              })}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <ShoppingBag className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {tx('{count} đơn', '{count} orders', { count: kpiStats.validCount })}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('Đã bán:', 'Items sold:')}{' '}
            <strong>
              {tx('{count} món', '{count} items', {
                count: kpiStats.totalItemsSold,
              })}
            </strong>
          </p>
        </div>

        <div className="rounded-3xl bg-white border-2 border-emerald-300 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800">
              {tx('Doanh thu trong kỳ', 'Period revenue')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {formatCurrency(kpiStats.totalRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('Trung bình/đơn:', 'Avg/order:')}{' '}
            <strong>
              {formatCurrency(kpiStats.avgOrderValue, activeShop.currency)}
            </strong>
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">
              {tx('Thu Tiền Mặt', 'Cash Revenue')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Banknote className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-slate-900">
            {formatCurrency(kpiStats.cashRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('{count} đơn tiền mặt', '{count} cash orders', {
              count: kpiStats.cashCount,
            })}
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-blue-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-800">
              {tx('Chuyển Khoản (VietQR)', 'VietQR Transfer')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <QrCode className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-blue-600">
            {formatCurrency(kpiStats.vietqrRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('{count} đơn chuyển khoản QR', '{count} VietQR orders', {
              count: kpiStats.vietqrCount,
            })}
          </p>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveViewTab('orders_list')}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeViewTab === 'orders_list'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tx('📋 Danh sách đơn ({count})', '📋 Orders ({count})', {
              count: filteredOrders.length,
            })}
          </button>
          <button
            type="button"
            onClick={() => setActiveViewTab('daily_summary')}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeViewTab === 'daily_summary'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tx(
              '📅 Theo ngày ({count} ngày)',
              '📅 Daily summary ({count} days)',
              { count: dailySummaryList.length }
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveViewTab('items_summary')}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeViewTab === 'items_summary'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tx('🍜 Theo món ({count} món)', '🍜 By item ({count} items)', {
              count: itemSummaryList.length,
            })}
          </button>
        </div>

        <span className="text-xs font-bold text-slate-500">
          {tx('Hiển thị', 'Showing')}{' '}
          <strong>{filteredOrders.length}</strong>{' '}
          {tx('đơn trong kỳ', 'orders in')}{' '}
          <strong>{effectiveDateBounds.label}</strong>
        </span>
      </div>

      {/* TAB 1: FULL ORDERS LIST TABLE */}
      {activeViewTab === 'orders_list' && (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              {tx('Đang tải dữ liệu đơn hàng...', 'Loading orders...')}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <p className="text-sm font-bold text-slate-800">
                {tx(
                  'Không có đơn hàng nào khớp với bộ lọc đã chọn',
                  'No orders match the selected filters'
                )}
              </p>
              <p className="text-xs text-slate-500">
                {tx(
                  'Hãy thử chọn "7 ngày qua", "Tháng này" hoặc "Tất cả lịch sử" để xem toàn bộ đơn.',
                  'Try selecting "Last 7 days", "This month", or "All time" to view all orders.'
                )}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-3 text-center">
                      {tx('STT', 'No.')}
                    </th>
                    <th className="py-3.5 px-3">{tx('Mã Đơn', 'Code')}</th>
                    <th className="py-3.5 px-3">
                      {tx('Ngày & Giờ (VN)', 'Date & Time (VN)')}
                    </th>
                    <th className="py-3.5 px-3">
                      {tx('Bàn / Vị Trí', 'Table')}
                    </th>
                    <th className="py-3.5 px-3">{tx('Nguồn', 'Source')}</th>
                    <th className="py-3.5 px-3 min-w-[260px]">
                      {tx('Chi Tiết Món & Option', 'Ordered Items & Options')}
                    </th>
                    <th className="py-3.5 px-3 text-center">
                      {tx('SL Món', 'Qty')}
                    </th>
                    <th className="py-3.5 px-3 text-right">
                      {tx('Tổng Tiền', 'Total')}
                    </th>
                    <th className="py-3.5 px-3">
                      {tx('Thanh Toán', 'Payment')}
                    </th>
                    <th className="py-3.5 px-3">{tx('Trạng Thái', 'Status')}</th>
                    <th className="py-3.5 px-3 text-right">
                      {tx('Thao Tác', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredOrders.map((ord, idx) => {
                    const totalQty = (ord.items || []).reduce(
                      (s, it) => s + Math.max(1, Number(it.quantity || 1)),
                      0
                    );
                    const isCancelled = ord.status === 'cancelled';

                    return (
                      <tr
                        key={ord.id}
                        className={`hover:bg-slate-50/90 transition ${
                          isCancelled ? 'opacity-60 bg-slate-50' : ''
                        }`}
                      >
                        <td className="py-3 px-3 text-center font-bold text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-3 px-3 font-black text-slate-900 whitespace-nowrap">
                          #{ord.order_code}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-bold text-slate-800">
                            {formatDateKeyVi(getVnDateKey(ord.created_at))}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {new Date(ord.created_at).toLocaleTimeString(
                              'vi-VN',
                              {
                                timeZone: 'Asia/Ho_Chi_Minh',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              }
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="inline-block rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-black text-amber-400">
                            {ord.table_label}
                          </span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-bold ${
                              ord.source === 'counter_pos'
                                ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {ord.source === 'counter_pos'
                              ? tx('🖥️ Tại quầy POS', '🖥️ Counter POS')
                              : tx('📱 Khách QR', '📱 Table QR')}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="space-y-1">
                            {(ord.items || []).map((it, i) => {
                              const optStr = formatChoicesText(
                                it.selected_choices
                              );
                              return (
                                <div
                                  key={i}
                                  className="text-xs text-slate-800 leading-snug"
                                >
                                  <strong className="font-black text-emerald-700">
                                    {it.quantity}x
                                  </strong>{' '}
                                  <span className="font-bold">{it.name_vi}</span>
                                  {optStr && (
                                    <span className="ml-1 text-[11px] font-semibold text-amber-700">
                                      ({optStr})
                                    </span>
                                  )}
                                  {it.custom_note && (
                                    <span className="ml-1 text-[11px] italic text-slate-500">
                                      • {it.custom_note}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {ord.customer_note && (
                              <div className="text-[11px] font-bold text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 inline-block">
                                💬 {ord.customer_note}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-black text-slate-800">
                          {totalQty}
                        </td>
                        <td className="py-3 px-3 text-right font-black text-emerald-700 whitespace-nowrap text-sm">
                          {formatCurrency(ord.total_amount, activeShop.currency)}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[10px] font-black ${
                                ord.payment_status === 'paid'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {ord.payment_status === 'paid'
                                ? tx('✓ Đã thu tiền', '✓ Paid')
                                : tx('⏳ Chưa thu tiền', '⏳ Unpaid')}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500">
                              {ord.payment_method === 'vietqr'
                                ? tx('CK VietQR', 'VietQR')
                                : tx('Tiền mặt', 'Cash')}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                              ord.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : ord.status === 'preparing'
                                  ? 'bg-blue-100 text-blue-800'
                                  : ord.status === 'new'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {ord.status === 'completed' ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                <span>{tx('Hoàn tất', 'Completed')}</span>
                              </>
                            ) : ord.status === 'preparing' ? (
                              <>
                                <ChefHat className="h-3 w-3" />
                                <span>{tx('Đang làm', 'Preparing')}</span>
                              </>
                            ) : ord.status === 'new' ? (
                              <>
                                <Clock className="h-3 w-3" />
                                <span>{tx('Chờ nhận', 'New')}</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3" />
                                <span>{tx('Đã hủy', 'Cancelled')}</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setPrintingOrder(ord)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-100"
                          >
                            <Printer className="h-3.5 w-3.5 text-emerald-600" />
                            <span>{tx('In Bill', 'Print Bill')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-emerald-50/80 text-xs font-black text-slate-900">
                    <td colSpan={6} className="py-3.5 px-3 text-right uppercase">
                      {tx(
                        'Tổng cộng ({count} đơn hợp lệ):',
                        'Total ({count} valid orders):',
                        { count: kpiStats.validCount }
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-center text-sm">
                      {tx('{count} món', '{count} items', {
                        count: kpiStats.totalItemsSold,
                      })}
                    </td>
                    <td className="py-3.5 px-3 text-right text-base text-emerald-700">
                      {formatCurrency(kpiStats.totalRevenue, activeShop.currency)}
                    </td>
                    <td colSpan={3} className="py-3.5 px-3 text-[11px] text-slate-600">
                      {tx('TM:', 'Cash:')}{' '}
                      {formatCurrency(kpiStats.cashRevenue, activeShop.currency)} • QR:{' '}
                      {formatCurrency(kpiStats.vietqrRevenue, activeShop.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DAILY BREAKDOWN TABLE */}
      {activeViewTab === 'daily_summary' && (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
          {dailySummaryList.length === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              {tx(
                'Không có dữ liệu doanh thu ngày trong khoảng thời gian này.',
                'No daily revenue data in this period.'
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-4">{tx('Ngày (VN)', 'Date (VN)')}</th>
                    <th className="py-3.5 px-4 text-center">
                      {tx('Tổng Số Đơn', 'Total Orders')}
                    </th>
                    <th className="py-3.5 px-4 text-center">
                      {tx('Số Món Bán Ra', 'Items Sold')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Thu Tiền Mặt', 'Cash Revenue')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Thu VietQR', 'VietQR Revenue')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Tổng Doanh Thu Ngày', 'Daily Revenue')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Thao Tác', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {dailySummaryList.map((d) => (
                    <tr key={d.dateKey} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-black text-slate-900">
                        📅 {formatDateKeyVi(d.dateKey)}
                      </td>
                      <td className="py-3.5 px-4 text-center font-black text-slate-800">
                        {tx('{count} đơn', '{count} orders', {
                          count: d.ordersCount,
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {tx('{count} món', '{count} items', {
                          count: d.itemsSold,
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-700">
                        {formatCurrency(d.cashRevenue, activeShop.currency)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-blue-700">
                        {formatCurrency(d.vietqrRevenue, activeShop.currency)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black text-sm text-emerald-700">
                        {formatCurrency(d.totalRevenue, activeShop.currency)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSingleDate(d.dateKey);
                            setRangeMode('single_day');
                            setActiveViewTab('orders_list');
                          }}
                          className="rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-800 hover:bg-emerald-600 hover:text-white transition"
                        >
                          {tx('Xem chi tiết ngày →', 'View day details →')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SOLD ITEMS BREAKDOWN TABLE */}
      {activeViewTab === 'items_summary' && (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
          {itemSummaryList.length === 0 ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              {tx(
                'Không có món ăn nào được bán trong khoảng thời gian này.',
                'No items sold in this period.'
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-4 text-center">
                      {tx('Hạng', 'Rank')}
                    </th>
                    <th className="py-3.5 px-4">
                      {tx('Tên Món Ăn / Đồ Uống', 'Item Name')}
                    </th>
                    <th className="py-3.5 px-4 text-center">
                      {tx('Số Đơn Có Gọi', 'Orders')}
                    </th>
                    <th className="py-3.5 px-4 text-center">
                      {tx('Tổng SL Bán Ra', 'Qty Sold')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Doanh Thu Món', 'Item Revenue')}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      {tx('Tỷ Trọng Doanh Thu', 'Revenue Share')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {itemSummaryList.map((item, idx) => {
                    const pct =
                      kpiStats.totalRevenue > 0
                        ? Math.round(
                            (item.revenue / kpiStats.totalRevenue) * 100
                          )
                        : 0;
                    return (
                      <tr key={item.itemName} className="hover:bg-slate-50">
                        <td className="py-3.5 px-4 text-center font-black text-slate-500">
                          #{idx + 1}
                        </td>
                        <td className="py-3.5 px-4 font-black text-slate-900">
                          {item.itemName}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-slate-600">
                          {tx('{count} đơn', '{count} orders', {
                            count: item.orderAppearances,
                          })}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-black text-emerald-900">
                            {tx('{count} phần', '{count} sold', {
                              count: item.quantitySold,
                            })}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-black text-sm text-emerald-700">
                          {formatCurrency(item.revenue, activeShop.currency)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-600">
                          {pct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Thermal Receipt Print Modal */}
      <ReceiptPrintModal
        onClose={() => setPrintingOrder(null)}
        order={printingOrder}
        shop={activeShop}
      />
    </div>
  );
}
