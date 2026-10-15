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
          label: `Hôm nay (${formatDateKeyVi(nowKey)})`,
        };
      case 'yesterday': {
        const yKey = shiftDateKey(nowKey, -1);
        return {
          start: yKey,
          end: yKey,
          label: `Hôm qua (${formatDateKeyVi(yKey)})`,
        };
      }
      case '7days': {
        const sKey = shiftDateKey(nowKey, -6);
        return {
          start: sKey,
          end: nowKey,
          label: `7 ngày qua (${formatDateKeyVi(sKey)} - ${formatDateKeyVi(nowKey)})`,
        };
      }
      case '30days': {
        const sKey = shiftDateKey(nowKey, -29);
        return {
          start: sKey,
          end: nowKey,
          label: `30 ngày qua (${formatDateKeyVi(sKey)} - ${formatDateKeyVi(nowKey)})`,
        };
      }
      case 'this_month': {
        const sKey = `${nowKey.slice(0, 7)}-01`;
        return {
          start: sKey,
          end: nowKey,
          label: `Tháng này (${formatDateKeyVi(sKey)} - ${formatDateKeyVi(nowKey)})`,
        };
      }
      case 'single_day': {
        const dKey = singleDate || nowKey;
        return {
          start: dKey,
          end: dKey,
          label: `Ngày ${formatDateKeyVi(dKey)}`,
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
          label: `Từ ${formatDateKeyVi(start)} đến ${formatDateKeyVi(end)}`,
        };
      }
      case 'all':
      default:
        return {
          start: '0000-01-01',
          end: '9999-12-31',
          label: 'Tất cả thời gian',
        };
    }
  }, [rangeMode, singleDate, customFrom, customTo]);

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
        const key = line.name_vi || line.item_id || 'Món khác';
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
  }, [filteredOrders]);

  // Export 1: CSV Summary by Order (1 row = 1 order)
  const handleExportOrdersCsv = () => {
    if (!activeShop) return;
    const headers = [
      'STT',
      'Mã Đơn',
      'Ngày (VN)',
      'Giờ Tạo (VN)',
      'Bàn / Vị Trí',
      'Nguồn Đơn',
      'Chi Tiết Món Đã Gọi',
      'Tổng Số Món',
      'Tạm Tính',
      'Giảm Giá',
      'Tổng Thu',
      'Phương Thức Thanh Toán',
      'Trạng Thái Thu Tiền',
      'Trạng Thái Đơn',
      'Ghi Chú Bàn',
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
        ord.source === 'counter_pos' ? 'Tại quầy (POS)' : 'Khách quét QR',
        itemsText,
        totalQty,
        ord.subtotal_amount ?? ord.total_amount,
        ord.discount_amount ?? 0,
        ord.total_amount,
        ord.payment_method === 'vietqr' ? 'Chuyển khoản VietQR' : 'Tiền mặt',
        ord.payment_status === 'paid' ? 'Đã thu tiền' : 'Chưa thu tiền',
        ord.status === 'completed'
          ? 'Hoàn tất'
          : ord.status === 'preparing'
            ? 'Đang chế biến'
            : ord.status === 'new'
              ? 'Mới chờ nhận'
              : 'Đã hủy',
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
      'STT',
      'Mã Đơn',
      'Ngày (VN)',
      'Giờ Tạo (VN)',
      'Bàn / Vị Trí',
      'Tên Món',
      'Số Lượng',
      'Đơn Giá Gốc',
      'Phụ Thu Topping/Option',
      'Thành Tiền Món',
      'Option / Topping Đã Chọn',
      'Ghi Chú Món',
      'Phương Thức TT',
      'Trạng Thái TT',
      'Trạng Thái Đơn',
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
          ord.payment_method === 'vietqr' ? 'Chuyển khoản VietQR' : 'Tiền mặt',
          ord.payment_status === 'paid' ? 'Đã thu tiền' : 'Chưa thu tiền',
          ord.status === 'completed'
            ? 'Hoàn tất'
            : ord.status === 'preparing'
              ? 'Đang chế biến'
              : ord.status === 'new'
                ? 'Mới chờ nhận'
                : 'Đã hủy',
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
            <td>${ord.source === 'counter_pos' ? 'Tại quầy (POS)' : 'Khách quét QR'}</td>
            <td>${escapeHtml(itemsText)}</td>
            <td style="text-align:center;">${totalQty}</td>
            <td style="text-align:right;font-weight:bold;">${Number(ord.total_amount || 0)}</td>
            <td>${ord.payment_method === 'vietqr' ? 'Chuyển khoản VietQR' : 'Tiền mặt'}</td>
            <td>${ord.payment_status === 'paid' ? 'Đã thu tiền' : 'Chưa thu tiền'}</td>
            <td>${
              ord.status === 'completed'
                ? 'Hoàn tất'
                : ord.status === 'preparing'
                  ? 'Đang chế biến'
                  : ord.status === 'new'
                    ? 'Mới chờ nhận'
                    : 'Đã hủy'
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
        <h2>BÁO CÁO ĐƠN HÀNG &amp; DOANH THU — ${escapeHtml(activeShop.name.toUpperCase())}</h2>
        <p><strong>Kỳ báo cáo:</strong> ${escapeHtml(effectiveDateBounds.label)} | <strong>Thời điểm xuất file:</strong> ${escapeHtml(getVnDateTimeString(new Date()))}</p>

        <table class="summary-box">
          <tr>
            <th colspan="2">TỔNG HỢP KẾT QUẢ KINH DOANH TRONG KỲ</th>
          </tr>
          <tr>
            <td><strong>Tổng số đơn hợp lệ:</strong></td>
            <td><strong>${kpiStats.validCount} đơn (${kpiStats.totalItemsSold} món bán ra)</strong></td>
          </tr>
          <tr>
            <td><strong>Doanh thu Tiền mặt (Cash):</strong></td>
            <td>${kpiStats.cashRevenue} (${kpiStats.cashCount} đơn)</td>
          </tr>
          <tr>
            <td><strong>Doanh thu Chuyển khoản (VietQR):</strong></td>
            <td>${kpiStats.vietqrRevenue} (${kpiStats.vietqrCount} đơn)</td>
          </tr>
          <tr>
            <td><strong>TỔNG DOANH THU THỰC NHẬN:</strong></td>
            <td style="font-size:15px;font-weight:bold;color:#059669;">${kpiStats.totalRevenue}</td>
          </tr>
        </table>

        <h3>1. DANH SÁCH CHI TIẾT ĐƠN HÀNG (${filteredOrders.length} ĐƠN)</h3>
        <table>
          <thead>
            <tr>
              <th>STT</th>
              <th>Mã Đơn</th>
              <th>Ngày (VN)</th>
              <th>Giờ Tạo (VN)</th>
              <th>Bàn / Vị Trí</th>
              <th>Nguồn Đơn</th>
              <th>Chi Tiết Món &amp; Option</th>
              <th>SL Món</th>
              <th>Tổng Tiền (${escapeHtml(activeShop.currency)})</th>
              <th>Phương Thức TT</th>
              <th>Trạng Thái TT</th>
              <th>Trạng Thái Đơn</th>
              <th>Ghi Chú</th>
            </tr>
          </thead>
          <tbody>
            ${orderRowsHtml}
            <tr style="background-color:#ecfdf5;font-weight:bold;">
              <td colspan="7" style="text-align:right;">TỔNG CỘNG (${kpiStats.validCount} đơn hợp lệ):</td>
              <td style="text-align:center;">${kpiStats.totalItemsSold}</td>
              <td style="text-align:right;">${kpiStats.totalRevenue}</td>
              <td colspan="4"></td>
            </tr>
          </tbody>
        </table>

        <h3>2. THỐNG KÊ SỐ LƯỢNG &amp; DOANH THU THEO TỪNG MÓN BÁN RA</h3>
        <table>
          <thead>
            <tr>
              <th>STT</th>
              <th>Tên Món</th>
              <th>Số Lần Gọi</th>
              <th>Tổng Số Lượng Bán</th>
              <th>Doanh Thu Món (${escapeHtml(activeShop.currency)})</th>
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
        Đang tải dữ liệu cửa hàng...
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
              <span>Quay lại POS &amp; Bếp</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-black text-emerald-300">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>BÁO CÁO &amp; XUẤT FILE ĐƠN HÀNG</span>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Tra cứu lịch sử đơn hàng &amp; Xuất báo cáo Excel / CSV
          </h1>
          <p className="text-xs text-slate-300">
            Lọc đơn hàng theo từng ngày hoặc khoảng ngày tùy chỉnh ({effectiveDateBounds.label}) • Múi giờ Việt Nam (GMT+7)
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
            <span>Xuất Excel Đầy Đủ (.xls)</span>
          </button>

          <button
            type="button"
            onClick={handleExportOrdersCsv}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-700 disabled:opacity-45 transition"
          >
            <Download className="h-4 w-4 text-emerald-400" />
            <span>Xuất CSV Theo Đơn</span>
          </button>

          <button
            type="button"
            onClick={handleExportLineItemsCsv}
            disabled={filteredOrders.length === 0}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-700 disabled:opacity-45 transition"
          >
            <Utensils className="h-4 w-4 text-amber-400" />
            <span>Xuất CSV Chi Tiết Món</span>
          </button>

          <button
            type="button"
            onClick={() => fetchOrders(false)}
            className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700"
            title="Làm mới dữ liệu"
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
              <span>Chọn kỳ báo cáo:</span>
            </span>

            {[
              { id: 'today', label: 'Hôm nay' },
              { id: 'yesterday', label: 'Hôm qua' },
              { id: '7days', label: '7 ngày qua' },
              { id: '30days', label: '30 ngày qua' },
              { id: 'this_month', label: 'Tháng này' },
              { id: 'single_day', label: '📅 Chọn 1 ngày' },
              { id: 'custom_range', label: '📆 Tùy chỉnh (Từ ngày → Đến ngày)' },
              { id: 'all', label: 'Tất cả lịch sử' },
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
                title="Ngày hôm trước"
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
                title="Ngày tiếp theo"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {rangeMode === 'custom_range' && (
            <div className="flex flex-wrap items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl px-3.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-700">Từ ngày:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-2.5 py-1 text-xs font-black text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </div>
              <span className="text-slate-400 font-bold">→</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-700">Đến ngày:</span>
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
              placeholder="Tìm mã đơn #ORD, bàn, tên món..."
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
              <option value="valid_only">Trạng thái: Đơn hợp lệ (Trừ đơn hủy)</option>
              <option value="all">Trạng thái: Tất cả (Kể cả đã hủy)</option>
              <option value="completed">Trạng thái: Đã hoàn tất</option>
              <option value="preparing">Trạng thái: Đang chế biến</option>
              <option value="new">Trạng thái: Mới chờ nhận</option>
              <option value="cancelled">Trạng thái: Đã hủy</option>
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
              <option value="all">Thu tiền: Tất cả</option>
              <option value="paid">Thu tiền: Đã thu tiền</option>
              <option value="unpaid">Thu tiền: Chưa thu tiền</option>
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
              <option value="all">Phương thức: Tất cả</option>
              <option value="cash">Phương thức: Tiền mặt</option>
              <option value="vietqr">Phương thức: Chuyển khoản VietQR</option>
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
              <option value="all">Nguồn đơn: Tất cả</option>
              <option value="counter_pos">Nguồn: Tại quầy (POS)</option>
              <option value="qr_table">Nguồn: Khách quét QR</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4 Summary KPI Cards for Selected Period */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              Tổng số đơn ({effectiveDateBounds.label})
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <ShoppingBag className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-slate-900">
            {kpiStats.validCount} đơn
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            Tổng số lượng bán: <strong>{kpiStats.totalItemsSold} món</strong>
          </p>
        </div>

        <div className="rounded-3xl bg-white border-2 border-emerald-300 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800">
              Tổng doanh thu trong kỳ
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {formatCurrency(kpiStats.totalRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            Trung bình/đơn:{' '}
            <strong>
              {formatCurrency(kpiStats.avgOrderValue, activeShop.currency)}
            </strong>
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">
              Thu Tiền Mặt (Cash)
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Banknote className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-slate-900">
            {formatCurrency(kpiStats.cashRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {kpiStats.cashCount} đơn thanh toán tiền mặt
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-blue-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-800">
              Chuyển Khoản (VietQR)
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <QrCode className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-blue-600">
            {formatCurrency(kpiStats.vietqrRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {kpiStats.vietqrCount} đơn chuyển khoản QR
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
            📋 Danh sách tất cả đơn hàng ({filteredOrders.length})
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
            📅 Tổng hợp theo từng ngày ({dailySummaryList.length} ngày)
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
            🍜 Thống kê theo từng món ({itemSummaryList.length} món)
          </button>
        </div>

        <span className="text-xs font-bold text-slate-500">
          Đang hiển thị <strong>{filteredOrders.length}</strong> đơn hàng trong kỳ{' '}
          <strong>{effectiveDateBounds.label}</strong>
        </span>
      </div>

      {/* TAB 1: FULL ORDERS LIST TABLE */}
      {activeViewTab === 'orders_list' && (
        <div className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-xs font-semibold text-slate-500">
              Đang tải dữ liệu đơn hàng...
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <p className="text-sm font-bold text-slate-800">
                Không có đơn hàng nào khớp với khoảng thời gian / bộ lọc đã chọn
              </p>
              <p className="text-xs text-slate-500">
                Hãy thử chọn &ldquo;7 ngày qua&rdquo;, &ldquo;Tháng này&rdquo; hoặc &ldquo;Tất cả lịch sử&rdquo; để xem toàn bộ đơn.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-3 text-center">STT</th>
                    <th className="py-3.5 px-3">Mã Đơn</th>
                    <th className="py-3.5 px-3">Ngày &amp; Giờ (VN)</th>
                    <th className="py-3.5 px-3">Bàn / Vị Trí</th>
                    <th className="py-3.5 px-3">Nguồn</th>
                    <th className="py-3.5 px-3 min-w-[260px]">
                      Chi Tiết Món Đã Gọi &amp; Option
                    </th>
                    <th className="py-3.5 px-3 text-center">SL Món</th>
                    <th className="py-3.5 px-3 text-right">Tổng Tiền</th>
                    <th className="py-3.5 px-3">Thanh Toán</th>
                    <th className="py-3.5 px-3">Trạng Thái</th>
                    <th className="py-3.5 px-3 text-right">Thao Tác</th>
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
                              ? '🖥️ Tại quầy POS'
                              : '📱 Khách QR'}
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
                                ? '✓ Đã thu tiền'
                                : '⏳ Chưa thu tiền'}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500">
                              {ord.payment_method === 'vietqr'
                                ? 'CK VietQR'
                                : 'Tiền mặt'}
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
                                <span>Hoàn tất</span>
                              </>
                            ) : ord.status === 'preparing' ? (
                              <>
                                <ChefHat className="h-3 w-3" />
                                <span>Đang làm</span>
                              </>
                            ) : ord.status === 'new' ? (
                              <>
                                <Clock className="h-3 w-3" />
                                <span>Chờ nhận</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3" />
                                <span>Đã hủy</span>
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
                            <span>In Bill</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-emerald-50/80 text-xs font-black text-slate-900">
                    <td colSpan={6} className="py-3.5 px-3 text-right uppercase">
                      Tổng cộng ({kpiStats.validCount} đơn hợp lệ):
                    </td>
                    <td className="py-3.5 px-3 text-center text-sm">
                      {kpiStats.totalItemsSold} món
                    </td>
                    <td className="py-3.5 px-3 text-right text-base text-emerald-700">
                      {formatCurrency(kpiStats.totalRevenue, activeShop.currency)}
                    </td>
                    <td colSpan={3} className="py-3.5 px-3 text-[11px] text-slate-600">
                      TM: {formatCurrency(kpiStats.cashRevenue, activeShop.currency)} • QR:{' '}
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
              Không có dữ liệu doanh thu ngày trong khoảng thời gian này.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-4">Ngày (VN)</th>
                    <th className="py-3.5 px-4 text-center">Tổng Số Đơn</th>
                    <th className="py-3.5 px-4 text-center">Số Món Bán Ra</th>
                    <th className="py-3.5 px-4 text-right">Thu Tiền Mặt</th>
                    <th className="py-3.5 px-4 text-right">Thu VietQR</th>
                    <th className="py-3.5 px-4 text-right">Tổng Doanh Thu Ngày</th>
                    <th className="py-3.5 px-4 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {dailySummaryList.map((d) => (
                    <tr key={d.dateKey} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-black text-slate-900">
                        📅 {formatDateKeyVi(d.dateKey)}
                      </td>
                      <td className="py-3.5 px-4 text-center font-black text-slate-800">
                        {d.ordersCount} đơn
                      </td>
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {d.itemsSold} món
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
                          Xem chi tiết ngày này →
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
              Không có món ăn nào được bán trong khoảng thời gian này.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-900 text-[11px] font-black uppercase tracking-wider text-slate-200">
                    <th className="py-3.5 px-4 text-center">Hạng</th>
                    <th className="py-3.5 px-4">Tên Món Ăn / Đồ Uống</th>
                    <th className="py-3.5 px-4 text-center">Số Đơn Có Gọi</th>
                    <th className="py-3.5 px-4 text-center">Tổng SL Bán Ra</th>
                    <th className="py-3.5 px-4 text-right">Doanh Thu Món</th>
                    <th className="py-3.5 px-4 text-right">Tỷ Trọng Doanh Thu</th>
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
                          {item.orderAppearances} đơn
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-black text-emerald-900">
                            {item.quantitySold} phần
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
