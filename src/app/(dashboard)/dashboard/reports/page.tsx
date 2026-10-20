'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { ShopOrder, ShopTable, TableOrderStats } from '@/types/qlaok';
import { formatCurrency } from '@/lib/i18n-helper';
import { summarizeOrdersByTable } from '@/lib/table-helpers';
import { ReceiptPrintModal } from '@/components/dashboard/ReceiptPrintModal';
import {
  AppDataTable,
  type TableColumn,
  type SortOrder,
} from '@/components/ui/AppDataTable';
import { downloadDataset } from '@/lib/table-export';
import {
  type DateRangeMode,
  type ReportViewTab,
  type ReportExportScope,
  type ReportStatusFilter,
  type ReportPaymentStatusFilter,
  type ReportPaymentMethodFilter,
  type ReportSourceFilter,
  type ReportSortState,
  type DailySummaryRow,
  type ItemSummaryRow,
  getVnDateKey,
  getVnTimeString,
  shiftDateKey,
  formatDateKeyVi,
  formatChoicesText,
  getOrderTotalQuantity,
  computeEffectiveDateBounds,
  buildManagedTableMap,
  filterReportOrders,
  computeReportKpiStats,
  summarizeOrdersByDay,
  summarizeOrdersByItem,
  formatPaymentStatusLabel,
  formatPaymentMethodLabel,
  formatOrderStatusLabel,
  formatOrderSourceLabel,
  formatTableKindLabel,
  getCanonicalOrdersColumns,
  getCanonicalTablesColumns,
  getCanonicalDailyColumns,
  getCanonicalItemsColumns,
  sortRowsByColumnSpecs,
  clampReportPage,
  paginateReportRows,
  buildCurrentViewExportPayload,
} from '@/lib/report-view';

const DEFAULT_SORT_BY_TAB: Record<ReportViewTab, ReportSortState> = {
  orders_list: { columnId: 'created_at', direction: 'desc' },
  tables_summary: { columnId: 'collectedRevenue', direction: 'desc' },
  daily_summary: { columnId: 'dateKey', direction: 'desc' },
  items_summary: { columnId: 'quantitySold', direction: 'desc' },
};

const DEFAULT_PAGE_BY_TAB: Record<ReportViewTab, number> = {
  orders_list: 1,
  tables_summary: 1,
  daily_summary: 1,
  items_summary: 1,
};

const DEFAULT_PER_PAGE_BY_TAB: Record<ReportViewTab, number> = {
  orders_list: 10,
  tables_summary: 10,
  daily_summary: 10,
  items_summary: 10,
};

export default function OrdersReportAndExportPage() {
  const { activeShop } = useDashboard();
  const { t, tx } = useAppI18n();
  const txRef = useRef(tx);
  txRef.current = tx;

  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [shopTables, setShopTables] = useState<ShopTable[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tablesLoadError, setTablesLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [printingOrder, setPrintingOrder] = useState<ShopOrder | null>(null);

  const todayVn = useMemo(() => getVnDateKey(), []);
  const [rangeMode, setRangeMode] = useState<DateRangeMode>('today');
  const [singleDate, setSingleDate] = useState<string>(todayVn);
  const [customFrom, setCustomFrom] = useState<string>(
    shiftDateKey(todayVn, -6)
  );
  const [customTo, setCustomTo] = useState<string>(todayVn);

  const [statusFilter, setStatusFilter] =
    useState<ReportStatusFilter>('valid_only');
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<ReportPaymentStatusFilter>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] =
    useState<ReportPaymentMethodFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<ReportSourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeViewTab, setActiveViewTab] =
    useState<ReportViewTab>('orders_list');

  const [exportScope, setExportScope] =
    useState<ReportExportScope>('all_filtered');
  const [exportingFormat, setExportingFormat] = useState<
    'csv' | 'xlsx' | null
  >(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [sortByTab, setSortByTab] =
    useState<Record<ReportViewTab, ReportSortState>>(DEFAULT_SORT_BY_TAB);
  const [pageByTab, setPageByTab] =
    useState<Record<ReportViewTab, number>>(DEFAULT_PAGE_BY_TAB);
  const [rowsPerPageByTab, setRowsPerPageByTab] = useState<
    Record<ReportViewTab, number>
  >(DEFAULT_PER_PAGE_BY_TAB);
  const [paginationResetToggle, setPaginationResetToggle] = useState(false);

  const activeShopIdRef = useRef(activeShop?.id);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (activeShopIdRef.current !== activeShop?.id) {
      activeShopIdRef.current = activeShop?.id;
      setOrders([]);
      setShopTables([]);
      setLoadError(null);
      setTablesLoadError(null);
      setExportError(null);
      setExportingFormat(null);
      setLoading(true);
      setPageByTab(DEFAULT_PAGE_BY_TAB);
      setPaginationResetToggle((prev) => !prev);
    }
  }, [activeShop?.id]);

  // Reset pagination to page 1 when filters change (never on locale change)
  useEffect(() => {
    setPageByTab(DEFAULT_PAGE_BY_TAB);
    setPaginationResetToggle((prev) => !prev);
    setExportError(null);
  }, [
    rangeMode,
    singleDate,
    customFrom,
    customTo,
    statusFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    sourceFilter,
    searchQuery,
  ]);

  const fetchOrders = useCallback(
    async (silent = false) => {
      if (!activeShop) return;
      const currentShopId = activeShop.id;
      const seq = ++requestSeqRef.current;
      if (!silent) {
        setLoading(true);
        setLoadError(null);
        setTablesLoadError(null);
      }
      try {
        const authHeaders = getAuthHeaders();
        const [ordersRes, tablesRes] = await Promise.all([
          fetch(`/api/orders?shopId=${encodeURIComponent(currentShopId)}`, {
            headers: authHeaders,
            cache: 'no-store',
          }),
          fetch(
            `/api/tables?shopId=${encodeURIComponent(currentShopId)}&includeInactive=1&includeArchived=1`,
            {
              headers: authHeaders,
              cache: 'no-store',
            }
          ).catch(() => null),
        ]);

        if (
          activeShopIdRef.current !== currentShopId ||
          seq !== requestSeqRef.current
        ) {
          return;
        }

        if (ordersRes.ok) {
          const data = await ordersRes.json();
          if (
            activeShopIdRef.current === currentShopId &&
            seq === requestSeqRef.current
          ) {
            setOrders(
              Array.isArray(data.orders)
                ? data.orders.filter(
                    (o: ShopOrder) => o && o.shop_id === currentShopId
                  )
                : []
            );
            setLoadError(null);
          }
        } else {
          const errData = await ordersRes.json().catch(() => null);
          setLoadError(
            errData?.error ||
              txRef.current(
                'Không thể tải danh sách đơn hàng cho báo cáo.',
                'Failed to load orders for report.'
              )
          );
        }

        let effectiveTablesRes = tablesRes;
        if (
          effectiveTablesRes &&
          (effectiveTablesRes.status === 401 ||
            effectiveTablesRes.status === 403)
        ) {
          effectiveTablesRes = await fetch(
            `/api/tables?shopId=${encodeURIComponent(currentShopId)}`,
            {
              headers: authHeaders,
              cache: 'no-store',
            }
          ).catch(() => null);
        }

        if (
          activeShopIdRef.current !== currentShopId ||
          seq !== requestSeqRef.current
        ) {
          return;
        }

        if (effectiveTablesRes && effectiveTablesRes.ok) {
          const tblData = await effectiveTablesRes.json().catch(() => null);
          setShopTables(
            Array.isArray(tblData?.tables)
              ? tblData.tables.filter(
                  (tb: ShopTable) => tb && tb.shop_id === currentShopId
                )
              : []
          );
          setTablesLoadError(null);
        } else if (effectiveTablesRes) {
          const tblErr = await effectiveTablesRes.json().catch(() => null);
          setTablesLoadError(
            tblErr?.error ||
              txRef.current(
                'Không thể tải danh mục bàn quản lý.',
                'Could not load managed tables list.'
              )
          );
        }
      } catch (err) {
        console.error('Failed to load orders for export:', err);
        if (
          activeShopIdRef.current === currentShopId &&
          seq === requestSeqRef.current
        ) {
          setLoadError(
            txRef.current(
              'Lỗi kết nối khi tải dữ liệu báo cáo.',
              'Network error while loading report data.'
            )
          );
        }
      } finally {
        if (
          !silent &&
          activeShopIdRef.current === currentShopId &&
          seq === requestSeqRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [activeShop]
  );

  useEffect(() => {
    void fetchOrders(false);
  }, [fetchOrders]);

  const effectiveDateBounds = useMemo(
    () =>
      computeEffectiveDateBounds(
        {
          rangeMode,
          singleDate,
          customFrom,
          customTo,
        },
        tx
      ),
    [rangeMode, singleDate, customFrom, customTo, tx]
  );

  const tableById = useMemo(
    () => buildManagedTableMap(shopTables, activeShop?.id),
    [shopTables, activeShop?.id]
  );

  const filteredOrders = useMemo(
    () =>
      filterReportOrders(
        orders,
        {
          dateBounds: effectiveDateBounds,
          statusFilter,
          paymentStatusFilter,
          paymentMethodFilter,
          sourceFilter,
          searchQuery,
        },
        {
          shopId: activeShop?.id,
          tableById,
        }
      ),
    [
      orders,
      effectiveDateBounds,
      statusFilter,
      paymentStatusFilter,
      paymentMethodFilter,
      sourceFilter,
      searchQuery,
      activeShop?.id,
      tableById,
    ]
  );

  const tableSummaryList: TableOrderStats[] = useMemo(() => {
    if (!activeShop) return [];
    return summarizeOrdersByTable(filteredOrders, activeShop.id, shopTables);
  }, [filteredOrders, activeShop, shopTables]);

  const kpiStats = useMemo(
    () => computeReportKpiStats(filteredOrders),
    [filteredOrders]
  );

  const dailySummaryList: DailySummaryRow[] = useMemo(
    () => summarizeOrdersByDay(filteredOrders),
    [filteredOrders]
  );

  const itemSummaryList: ItemSummaryRow[] = useMemo(
    () => summarizeOrdersByItem(filteredOrders, tx('Món khác', 'Other item')),
    [filteredOrders, tx]
  );

  // Canonical column specs per tab (shared between UI and export)
  const ordersSpecs = useMemo(
    () => getCanonicalOrdersColumns(tx, tableById),
    [tx, tableById]
  );
  const tablesSpecs = useMemo(
    () => getCanonicalTablesColumns(tx, tableById),
    [tx, tableById]
  );
  const dailySpecs = useMemo(() => getCanonicalDailyColumns(tx), [tx]);
  const itemsSpecs = useMemo(() => getCanonicalItemsColumns(tx), [tx]);

  // Sorted rows per tab matching current UI sort state
  const sortedOrders = useMemo(
    () =>
      sortRowsByColumnSpecs(
        filteredOrders,
        ordersSpecs,
        sortByTab.orders_list,
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          a.id.localeCompare(b.id)
      ),
    [filteredOrders, ordersSpecs, sortByTab.orders_list]
  );

  const sortedTables = useMemo(
    () =>
      sortRowsByColumnSpecs(
        tableSummaryList,
        tablesSpecs,
        sortByTab.tables_summary,
        (a, b) => a.key.localeCompare(b.key)
      ),
    [tableSummaryList, tablesSpecs, sortByTab.tables_summary]
  );

  const sortedDaily = useMemo(
    () =>
      sortRowsByColumnSpecs(
        dailySummaryList,
        dailySpecs,
        sortByTab.daily_summary,
        (a, b) => b.dateKey.localeCompare(a.dateKey)
      ),
    [dailySummaryList, dailySpecs, sortByTab.daily_summary]
  );

  const sortedItems = useMemo(
    () =>
      sortRowsByColumnSpecs(
        itemSummaryList,
        itemsSpecs,
        sortByTab.items_summary,
        (a, b) => a.itemKey.localeCompare(b.itemKey)
      ),
    [itemSummaryList, itemsSpecs, sortByTab.items_summary]
  );

  // Paginated slices per tab
  const pagedOrders = useMemo(
    () =>
      paginateReportRows(
        sortedOrders,
        pageByTab.orders_list,
        rowsPerPageByTab.orders_list
      ),
    [sortedOrders, pageByTab.orders_list, rowsPerPageByTab.orders_list]
  );

  const pagedTables = useMemo(
    () =>
      paginateReportRows(
        sortedTables,
        pageByTab.tables_summary,
        rowsPerPageByTab.tables_summary
      ),
    [sortedTables, pageByTab.tables_summary, rowsPerPageByTab.tables_summary]
  );

  const pagedDaily = useMemo(
    () =>
      paginateReportRows(
        sortedDaily,
        pageByTab.daily_summary,
        rowsPerPageByTab.daily_summary
      ),
    [sortedDaily, pageByTab.daily_summary, rowsPerPageByTab.daily_summary]
  );

  const pagedItems = useMemo(
    () =>
      paginateReportRows(
        sortedItems,
        pageByTab.items_summary,
        rowsPerPageByTab.items_summary
      ),
    [sortedItems, pageByTab.items_summary, rowsPerPageByTab.items_summary]
  );

  // Clamp out-of-range pages automatically when dataset shrinks
  useEffect(() => {
    const clampedOrders = clampReportPage(
      pageByTab.orders_list,
      sortedOrders.length,
      rowsPerPageByTab.orders_list
    );
    const clampedTables = clampReportPage(
      pageByTab.tables_summary,
      sortedTables.length,
      rowsPerPageByTab.tables_summary
    );
    const clampedDaily = clampReportPage(
      pageByTab.daily_summary,
      sortedDaily.length,
      rowsPerPageByTab.daily_summary
    );
    const clampedItems = clampReportPage(
      pageByTab.items_summary,
      sortedItems.length,
      rowsPerPageByTab.items_summary
    );

    if (
      clampedOrders !== pageByTab.orders_list ||
      clampedTables !== pageByTab.tables_summary ||
      clampedDaily !== pageByTab.daily_summary ||
      clampedItems !== pageByTab.items_summary
    ) {
      setPageByTab({
        orders_list: clampedOrders,
        tables_summary: clampedTables,
        daily_summary: clampedDaily,
        items_summary: clampedItems,
      });
      setPaginationResetToggle((prev) => !prev);
    }
  }, [
    pageByTab,
    rowsPerPageByTab,
    sortedOrders.length,
    sortedTables.length,
    sortedDaily.length,
    sortedItems.length,
  ]);

  const activePagedInfo =
    activeViewTab === 'orders_list'
      ? pagedOrders
      : activeViewTab === 'tables_summary'
        ? pagedTables
        : activeViewTab === 'daily_summary'
          ? pagedDaily
          : pagedItems;

  const activeExportPayload = useMemo(() => {
    if (!activeShop) {
      return null;
    }
    return buildCurrentViewExportPayload({
      shop: {
        id: activeShop.id,
        name: activeShop.name,
        slug: activeShop.slug,
        currency: activeShop.currency,
      },
      activeTab: activeViewTab,
      exportScope,
      dateBounds: effectiveDateBounds,
      filters: {
        statusFilter,
        paymentStatusFilter,
        paymentMethodFilter,
        sourceFilter,
        searchQuery,
      },
      filteredOrders,
      shopTables,
      sortState: sortByTab[activeViewTab],
      page: activePagedInfo.page,
      rowsPerPage: activePagedInfo.rowsPerPage,
      tx,
    });
  }, [
    activeShop,
    activeViewTab,
    exportScope,
    effectiveDateBounds,
    statusFilter,
    paymentStatusFilter,
    paymentMethodFilter,
    sourceFilter,
    searchQuery,
    filteredOrders,
    shopTables,
    sortByTab,
    activePagedInfo.page,
    activePagedInfo.rowsPerPage,
    tx,
  ]);

  const canExport =
    Boolean(activeShop) &&
    !loading &&
    !loadError &&
    !exportingFormat &&
    Boolean(activeExportPayload && activeExportPayload.exportedRowCount > 0);

  const handleExportCurrentView = async (format: 'csv' | 'xlsx') => {
    if (!activeShop || !activeExportPayload || !canExport) return;
    const expectedShopId = activeShop.id;
    setExportError(null);
    setExportingFormat(format);
    try {
      if (activeShopIdRef.current !== expectedShopId) {
        return;
      }
      await downloadDataset(
        activeExportPayload.dataset,
        format,
        activeExportPayload.filenameBase
      );
    } catch (err) {
      console.error(`Failed to export ${format}:`, err);
      if (activeShopIdRef.current === expectedShopId) {
        setExportError(
          err instanceof Error && err.message
            ? err.message
            : tx(
                'Không thể xuất file báo cáo. Vui lòng thử lại.',
                'Could not export report file. Please try again.'
              )
        );
      }
    } finally {
      if (activeShopIdRef.current === expectedShopId) {
        setExportingFormat(null);
      }
    }
  };

  const handleTabSort = useCallback(
    <T,>(
      tab: ReportViewTab,
      selectedColumn: TableColumn<T>,
      sortDirection: SortOrder
    ) => {
      const colId = String(selectedColumn.id || '');
      if (!colId) return;
      setSortByTab((prev) => ({
        ...prev,
        [tab]: {
          columnId: colId,
          direction: sortDirection === 'asc' ? 'asc' : 'desc',
        },
      }));
      setPageByTab((prev) => ({
        ...prev,
        [tab]: 1,
      }));
      setPaginationResetToggle((prev) => !prev);
    },
    []
  );

  const handleTabPageChange = useCallback((tab: ReportViewTab, page: number) => {
    setPageByTab((prev) => ({
      ...prev,
      [tab]: page,
    }));
  }, []);

  const handleTabRowsPerPageChange = useCallback(
    (tab: ReportViewTab, newPerPage: number, page: number) => {
      setRowsPerPageByTab((prev) => ({
        ...prev,
        [tab]: newPerPage,
      }));
      setPageByTab((prev) => ({
        ...prev,
        [tab]: page || 1,
      }));
    },
    []
  );

  const currency = activeShop?.currency || 'VND';

  // Table 1: Orders List Columns
  const ordersColumns = useMemo<TableColumn<ShopOrder>[]>(() => {
    const byKey = new Map(ordersSpecs.map((s) => [s.key, s]));
    return [
      {
        id: 'order_code',
        name: byKey.get('order_code')!.label,
        sortable: true,
        width: '120px',
        selector: (ord) => ord.order_code || '',
        cell: (ord) => (
          <span className="font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
            #{ord.order_code}
          </span>
        ),
      },
      {
        id: 'created_at',
        name: byKey.get('created_at')!.label,
        sortable: true,
        width: '150px',
        selector: (ord) => new Date(ord.created_at).getTime() || 0,
        cell: (ord) => (
          <div className="py-1 whitespace-nowrap">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              {formatDateKeyVi(getVnDateKey(ord.created_at))}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {getVnTimeString(ord.created_at)}
            </div>
          </div>
        ),
      },
      {
        id: 'table_label',
        name: byKey.get('table_label')!.label,
        sortable: true,
        width: '150px',
        selector: (ord) =>
          String(byKey.get('table_label')!.getExportValue(ord, 0) ?? ''),
        cell: (ord) => {
          const managedTable = ord.table_id
            ? tableById.get(ord.table_id)
            : undefined;
          return (
            <div className="flex flex-col gap-0.5 py-1 whitespace-nowrap">
              <span className="inline-block w-fit rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-black text-amber-400">
                {ord.table_label}
              </span>
              {managedTable && managedTable.name !== ord.table_label && (
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  {tx('Hiện tại:', 'Current:')} {managedTable.name}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: 'source',
        name: byKey.get('source')!.label,
        sortable: true,
        width: '145px',
        selector: (ord) => formatOrderSourceLabel(ord.source, tx),
        cell: (ord) => (
          <span
            className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${
              ord.source === 'counter_pos'
                ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            }`}
          >
            {formatOrderSourceLabel(ord.source, tx)}
          </span>
        ),
      },
      {
        id: 'items_summary',
        name: byKey.get('items_summary')!.label,
        sortable: true,
        grow: 2,
        minWidth: '250px',
        selector: (ord) =>
          String(byKey.get('items_summary')!.getExportValue(ord, 0) ?? ''),
        cell: (ord) => (
          <div className="space-y-1 py-1.5">
            {(ord.items || []).map((it, i) => {
              const optStr = formatChoicesText(it.selected_choices);
              return (
                <div
                  key={i}
                  className="text-xs text-slate-800 dark:text-slate-200 leading-snug"
                >
                  <strong className="font-black text-emerald-700 dark:text-emerald-400">
                    {it.quantity}x
                  </strong>{' '}
                  <span className="font-bold">{it.name_vi}</span>
                  {optStr && (
                    <span className="ml-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
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
        ),
      },
      {
        id: 'items_qty',
        name: byKey.get('items_qty')!.label,
        sortable: true,
        right: true,
        width: '95px',
        selector: (ord) => getOrderTotalQuantity(ord),
        cell: (ord) => (
          <span className="font-black text-slate-800 dark:text-slate-200">
            {getOrderTotalQuantity(ord)}
          </span>
        ),
      },
      {
        id: 'total_amount',
        name: byKey.get('total_amount')!.label,
        sortable: true,
        right: true,
        width: '140px',
        selector: (ord) => Math.max(0, Number(ord.total_amount || 0)),
        cell: (ord) => (
          <span className="font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap text-sm">
            {formatCurrency(ord.total_amount, currency)}
          </span>
        ),
      },
      {
        id: 'payment_status',
        name: byKey.get('payment_status')!.label,
        sortable: true,
        width: '150px',
        selector: (ord) => formatPaymentStatusLabel(ord.payment_status, tx),
        cell: (ord) => (
          <span
            className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-black whitespace-nowrap ${
              ord.payment_status === 'paid'
                ? 'bg-emerald-100 text-emerald-800'
                : ord.payment_status === 'refunded'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
            }`}
          >
            {ord.payment_status === 'refunded' ? (
              <RotateCcw className="h-3 w-3" />
            ) : null}
            <span>{formatPaymentStatusLabel(ord.payment_status, tx)}</span>
          </span>
        ),
      },
      {
        id: 'payment_method',
        name: byKey.get('payment_method')!.label,
        sortable: true,
        width: '155px',
        selector: (ord) => formatPaymentMethodLabel(ord.payment_method, tx),
        cell: (ord) => (
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {formatPaymentMethodLabel(ord.payment_method, tx)}
          </span>
        ),
      },
      {
        id: 'status',
        name: byKey.get('status')!.label,
        sortable: true,
        width: '145px',
        selector: (ord) => formatOrderStatusLabel(ord.status, tx),
        cell: (ord) => (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase whitespace-nowrap ${
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
              <CheckCircle2 className="h-3 w-3" />
            ) : ord.status === 'preparing' ? (
              <ChefHat className="h-3 w-3" />
            ) : ord.status === 'new' ? (
              <Clock className="h-3 w-3" />
            ) : (
              <XCircle className="h-3 w-3" />
            )}
            <span>{formatOrderStatusLabel(ord.status, tx)}</span>
          </span>
        ),
      },
      {
        id: 'actions',
        name: tx('Thao tác', 'Actions'),
        sortable: false,
        right: true,
        width: '120px',
        cell: (ord) => (
          <button
            type="button"
            onClick={() => setPrintingOrder(ord)}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-800 hover:bg-slate-100 whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5 text-emerald-600" />
            <span>{tx('In Bill', 'Print Bill')}</span>
          </button>
        ),
      },
    ];
  }, [ordersSpecs, tableById, tx, currency]);

  // Table 2: By Table Summary Columns
  const tablesColumns = useMemo<TableColumn<TableOrderStats>[]>(() => {
    const byKey = new Map(tablesSpecs.map((s) => [s.key, s]));
    return [
      {
        id: 'table_label',
        name: byKey.get('table_label')!.label,
        sortable: true,
        minWidth: '190px',
        selector: (row) => row.table_label || '',
        cell: (row) => {
          const managed = row.table_id
            ? tableById.get(row.table_id)
            : undefined;
          return (
            <div
              data-testid={`report-table-summary-row-${row.key}`}
              className="py-1.5 font-black text-slate-900 dark:text-slate-100"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span>{row.table_label}</span>
                {managed?.table_code && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-600">
                    #{managed.table_code}
                  </span>
                )}
                {managed?.is_archived && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                    {tx('Đã lưu trữ', 'Archived')}
                  </span>
                )}
                {managed && !managed.is_archived && !managed.is_active && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    {tx('Tạm ngưng', 'Inactive')}
                  </span>
                )}
              </div>
              {managed?.section && (
                <div className="text-[11px] font-medium text-slate-500">
                  {managed.section}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'kind',
        name: byKey.get('kind')!.label,
        sortable: true,
        width: '140px',
        selector: (row) => formatTableKindLabel(row.kind, tx),
        cell: (row) => (
          <span
            className={`inline-flex rounded-lg px-2 py-0.5 text-[10px] font-black whitespace-nowrap ${
              row.kind === 'managed'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : row.kind === 'takeaway'
                  ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
            }`}
          >
            {formatTableKindLabel(row.kind, tx)}
          </span>
        ),
      },
      {
        id: 'orderCount',
        name: byKey.get('orderCount')!.label,
        sortable: true,
        right: true,
        width: '115px',
        selector: (row) => row.orderCount,
        cell: (row) => (
          <span className="font-black text-slate-800 dark:text-slate-200">
            {row.orderCount}
          </span>
        ),
      },
      {
        id: 'paidOrderCount',
        name: byKey.get('paidOrderCount')!.label,
        sortable: true,
        right: true,
        width: '120px',
        selector: (row) => row.paidOrderCount,
        cell: (row) => (
          <span className="font-bold text-emerald-700 dark:text-emerald-400">
            {row.paidOrderCount}
          </span>
        ),
      },
      {
        id: 'collectedRevenue',
        name: byKey.get('collectedRevenue')!.label,
        sortable: true,
        right: true,
        width: '165px',
        selector: (row) => row.collectedRevenue,
        cell: (row) => (
          <span className="font-black text-sm text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
            {formatCurrency(row.collectedRevenue, currency)}
          </span>
        ),
      },
      {
        id: 'unpaidOrderCount',
        name: byKey.get('unpaidOrderCount')!.label,
        sortable: true,
        right: true,
        width: '125px',
        selector: (row) => row.unpaidOrderCount,
        cell: (row) => (
          <span className="font-bold text-amber-700 dark:text-amber-400">
            {row.unpaidOrderCount}
          </span>
        ),
      },
      {
        id: 'unpaidAmount',
        name: byKey.get('unpaidAmount')!.label,
        sortable: true,
        right: true,
        width: '150px',
        selector: (row) => row.unpaidAmount,
        cell: (row) => (
          <span className="font-bold text-amber-700 dark:text-amber-400 whitespace-nowrap">
            {formatCurrency(row.unpaidAmount, currency)}
          </span>
        ),
      },
      {
        id: 'refundedAmount',
        name: byKey.get('refundedAmount')!.label,
        sortable: true,
        right: true,
        width: '150px',
        selector: (row) => row.refundedAmount,
        cell: (row) => (
          <div className="text-right whitespace-nowrap">
            <div className="font-bold text-rose-700 dark:text-rose-400">
              {formatCurrency(row.refundedAmount, currency)}
            </div>
            {row.refundedOrderCount > 0 && (
              <div className="text-[10px] font-semibold text-slate-500">
                ({row.refundedOrderCount})
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'cancelledOrderCount',
        name: byKey.get('cancelledOrderCount')!.label,
        sortable: true,
        right: true,
        width: '110px',
        selector: (row) => row.cancelledOrderCount,
        cell: (row) =>
          row.cancelledOrderCount > 0 ? (
            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-700">
              {row.cancelledOrderCount}
            </span>
          ) : (
            <span className="font-bold text-slate-500">0</span>
          ),
      },
    ];
  }, [tablesSpecs, tableById, tx, currency]);

  // Table 3: Daily Summary Columns
  const dailyColumns = useMemo<TableColumn<DailySummaryRow>[]>(() => {
    const byKey = new Map(dailySpecs.map((s) => [s.key, s]));
    return [
      {
        id: 'dateKey',
        name: byKey.get('dateKey')!.label,
        sortable: true,
        width: '140px',
        selector: (d) => d.dateKey,
        cell: (d) => (
          <span className="font-black text-slate-900 dark:text-slate-100 whitespace-nowrap">
            📅 {formatDateKeyVi(d.dateKey)}
          </span>
        ),
      },
      {
        id: 'ordersCount',
        name: byKey.get('ordersCount')!.label,
        sortable: true,
        right: true,
        width: '125px',
        selector: (d) => d.ordersCount,
        cell: (d) => (
          <span className="font-black text-slate-800 dark:text-slate-200">
            {d.ordersCount}
          </span>
        ),
      },
      {
        id: 'paidOrdersCount',
        name: byKey.get('paidOrdersCount')!.label,
        sortable: true,
        right: true,
        width: '135px',
        selector: (d) => d.paidOrdersCount,
        cell: (d) => (
          <span className="font-bold text-emerald-700 dark:text-emerald-400">
            {d.paidOrdersCount}
          </span>
        ),
      },
      {
        id: 'itemsSold',
        name: byKey.get('itemsSold')!.label,
        sortable: true,
        right: true,
        width: '155px',
        selector: (d) => d.itemsSold,
        cell: (d) => (
          <span className="font-bold text-slate-700 dark:text-slate-300">
            {d.itemsSold}
          </span>
        ),
      },
      {
        id: 'cashRevenue',
        name: byKey.get('cashRevenue')!.label,
        sortable: true,
        right: true,
        width: '165px',
        selector: (d) => d.cashRevenue,
        cell: (d) => (
          <span className="font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
            {formatCurrency(d.cashRevenue, currency)}
          </span>
        ),
      },
      {
        id: 'vietqrRevenue',
        name: byKey.get('vietqrRevenue')!.label,
        sortable: true,
        right: true,
        width: '165px',
        selector: (d) => d.vietqrRevenue,
        cell: (d) => (
          <span className="font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap">
            {formatCurrency(d.vietqrRevenue, currency)}
          </span>
        ),
      },
      {
        id: 'collectedRevenue',
        name: byKey.get('collectedRevenue')!.label,
        sortable: true,
        right: true,
        width: '180px',
        selector: (d) => d.collectedRevenue,
        cell: (d) => (
          <span className="font-black text-sm text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
            {formatCurrency(d.collectedRevenue, currency)}
          </span>
        ),
      },
      {
        id: 'unpaidAmount',
        name: byKey.get('unpaidAmount')!.label,
        sortable: true,
        right: true,
        width: '155px',
        selector: (d) => d.unpaidAmount,
        cell: (d) => (
          <span className="font-bold text-amber-700 dark:text-amber-400 whitespace-nowrap">
            {formatCurrency(d.unpaidAmount, currency)}
          </span>
        ),
      },
      {
        id: 'refundedAmount',
        name: byKey.get('refundedAmount')!.label,
        sortable: true,
        right: true,
        width: '155px',
        selector: (d) => d.refundedAmount,
        cell: (d) => (
          <span className="font-bold text-rose-700 dark:text-rose-400 whitespace-nowrap">
            {formatCurrency(d.refundedAmount, currency)}
          </span>
        ),
      },
      {
        id: 'actions',
        name: tx('Thao tác', 'Actions'),
        sortable: false,
        right: true,
        width: '155px',
        cell: (d) => (
          <button
            type="button"
            onClick={() => {
              setSingleDate(d.dateKey);
              setRangeMode('single_day');
              setActiveViewTab('orders_list');
            }}
            className="rounded-xl bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-800 hover:bg-emerald-600 hover:text-white transition whitespace-nowrap"
          >
            {tx('Xem chi tiết ngày →', 'View day details →')}
          </button>
        ),
      },
    ];
  }, [dailySpecs, tx, currency]);

  // Table 4: By Item Summary Columns
  const itemsColumns = useMemo<TableColumn<ItemSummaryRow>[]>(() => {
    const byKey = new Map(itemsSpecs.map((s) => [s.key, s]));
    return [
      {
        id: 'itemName',
        name: byKey.get('itemName')!.label,
        sortable: true,
        grow: 2,
        minWidth: '220px',
        selector: (item) => item.itemName,
        cell: (item) => (
          <span className="font-black text-slate-900 dark:text-slate-100">
            {item.itemName}
          </span>
        ),
      },
      {
        id: 'orderAppearances',
        name: byKey.get('orderAppearances')!.label,
        sortable: true,
        right: true,
        width: '140px',
        selector: (item) => item.orderAppearances,
        cell: (item) => (
          <span className="font-bold text-slate-700 dark:text-slate-300">
            {item.orderAppearances}
          </span>
        ),
      },
      {
        id: 'quantitySold',
        name: byKey.get('quantitySold')!.label,
        sortable: true,
        right: true,
        width: '165px',
        selector: (item) => item.quantitySold,
        cell: (item) => (
          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-black text-emerald-900">
            {item.quantitySold}
          </span>
        ),
      },
      {
        id: 'paidQuantitySold',
        name: byKey.get('paidQuantitySold')!.label,
        sortable: true,
        right: true,
        width: '150px',
        selector: (item) => item.paidQuantitySold,
        cell: (item) => (
          <span className="font-bold text-emerald-700 dark:text-emerald-400">
            {item.paidQuantitySold}
          </span>
        ),
      },
      {
        id: 'grossSales',
        name: byKey.get('grossSales')!.label,
        sortable: true,
        right: true,
        width: '210px',
        selector: (item) => item.grossSales,
        cell: (item) => (
          <span className="font-black text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap">
            {formatCurrency(item.grossSales, currency)}
          </span>
        ),
      },
      {
        id: 'paidGrossSales',
        name: byKey.get('paidGrossSales')!.label,
        sortable: true,
        right: true,
        width: '220px',
        selector: (item) => item.paidGrossSales,
        cell: (item) => (
          <span className="font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
            {formatCurrency(item.paidGrossSales, currency)}
          </span>
        ),
      },
      {
        id: 'grossSharePercent',
        name: byKey.get('grossSharePercent')!.label,
        sortable: true,
        right: true,
        width: '160px',
        selector: (item) => item.grossSharePercent,
        cell: (item) => (
          <span className="font-bold text-slate-600 dark:text-slate-300">
            {item.grossSharePercent}%
          </span>
        ),
      },
    ];
  }, [itemsSpecs, currency]);

  if (!activeShop) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center space-y-3 shadow-2xs">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <p className="text-sm font-bold text-slate-800">
          {tx('Đang tải dữ liệu cửa hàng...', 'Loading shop data...')}
        </p>
      </div>
    );
  }

  const activeTabHumanLabel =
    activeViewTab === 'orders_list'
      ? tx('Danh sách đơn', 'Orders')
      : activeViewTab === 'tables_summary'
        ? tx('Theo bàn', 'By table')
        : activeViewTab === 'daily_summary'
          ? tx('Theo ngày', 'Daily summary')
          : tx('Theo món', 'By item');

  const exportRowCount = activeExportPayload?.exportedRowCount ?? 0;
  const totalTabRowCount = activeExportPayload?.totalFilteredRowCount ?? 0;

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
            {tx('Báo cáo', 'Reports')}
          </h1>
          <p className="text-xs text-slate-300">
            {tx(
              'Lọc đơn theo ngày ({period}) • Múi giờ Việt Nam (GMT+7)',
              'Filter orders by date ({period}) • Vietnam Time (GMT+7)',
              { period: effectiveDateBounds.label }
            )}
          </p>
        </div>

        {/* Export Controls for Current View */}
        <div className="flex flex-col sm:items-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="reports-export-scope-select">
              {tx('Phạm vi xuất dữ liệu', 'Export scope')}
            </label>
            <select
              id="reports-export-scope-select"
              data-testid="reports-export-scope"
              value={exportScope}
              onChange={(e) =>
                setExportScope(e.target.value as ReportExportScope)
              }
              disabled={loading || Boolean(exportingFormat)}
              className="rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-bold text-slate-100 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
            >
              <option value="all_filtered">
                {tx(
                  'Tất cả kết quả lọc ({count} dòng)',
                  'All filtered results ({count} rows)',
                  { count: totalTabRowCount }
                )}
              </option>
              <option value="current_page">
                {tx(
                  'Trang hiện tại ({count} dòng)',
                  'Current page ({count} rows)',
                  { count: activePagedInfo.rows.length }
                )}
              </option>
            </select>

            <button
              type="button"
              data-testid="reports-export-csv"
              onClick={() => void handleExportCurrentView('csv')}
              disabled={!canExport}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs font-extrabold text-white hover:bg-slate-700 disabled:opacity-45 transition"
            >
              <Download className="h-4 w-4 text-emerald-400" />
              <span>
                {exportingFormat === 'csv'
                  ? tx('Đang xuất CSV...', 'Exporting CSV...')
                  : tx('Xuất CSV', 'Export CSV')}
              </span>
            </button>

            <button
              type="button"
              data-testid="reports-export-xlsx"
              onClick={() => void handleExportCurrentView('xlsx')}
              disabled={!canExport}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-md hover:bg-emerald-400 disabled:opacity-45 transition"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>
                {exportingFormat === 'xlsx'
                  ? tx('Đang xuất Excel...', 'Exporting Excel...')
                  : tx('Xuất Excel (.xlsx)', 'Export Excel (.xlsx)')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void fetchOrders(false)}
              disabled={loading || Boolean(exportingFormat)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-2.5 text-slate-200 hover:bg-slate-700 disabled:opacity-45"
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>

          <p
            data-testid="reports-export-summary"
            className="text-[11px] font-semibold text-slate-300"
          >
            {tx(
              'Xuất đúng bảng đang xem ({tab}) • {count}/{total} dòng theo thứ tự sắp xếp hiện tại',
              'Exports current tab ({tab}) • {count}/{total} rows in current sort order',
              {
                tab: activeTabHumanLabel,
                count: exportRowCount,
                total: totalTabRowCount,
              }
            )}
          </p>
        </div>
      </div>

      {/* Export Error Banner */}
      {exportError && (
        <div
          role="alert"
          data-testid="reports-export-error"
          className="flex items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{exportError}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="rounded-lg bg-rose-100 px-2.5 py-1 text-[11px] font-black text-rose-800 hover:bg-rose-200"
          >
            {tx('Đóng', 'Dismiss')}
          </button>
        </div>
      )}

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
                setStatusFilter(e.target.value as ReportStatusFilter)
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="valid_only">
                {tx('Trạng thái: Đơn hợp lệ', 'Status: Valid orders')}
              </option>
              <option value="all">
                {tx(
                  'Trạng thái: Tất cả (cả đơn hủy)',
                  'Status: All (incl. cancelled)'
                )}
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
                  e.target.value as ReportPaymentStatusFilter
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
              <option value="refunded">
                {tx('Thu tiền: Đã hoàn tiền', 'Payment: Refunded')}
              </option>
            </select>
          </div>

          <div>
            <select
              value={paymentMethodFilter}
              onChange={(e) =>
                setPaymentMethodFilter(
                  e.target.value as ReportPaymentMethodFilter
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
                setSourceFilter(e.target.value as ReportSourceFilter)
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

      {/* Load Errors with Retry */}
      {(loadError || tablesLoadError) && (
        <div
          role="alert"
          data-testid="reports-load-error"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{loadError || tablesLoadError}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchOrders(false)}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-black text-white hover:bg-rose-500"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      )}

      {/* 4 Summary KPI Cards for Selected Period */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-3xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">
              {tx('Đơn hợp lệ ({period})', 'Valid orders ({period})', {
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
            {kpiStats.cancelledCount > 0 && (
              <span className="ml-1.5 text-rose-600">
                • {kpiStats.cancelledCount} {tx('đơn hủy', 'cancelled')}
              </span>
            )}
          </p>
        </div>

        <div className="rounded-3xl bg-white border-2 border-emerald-300 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800">
              {tx('Doanh thu thực thu (Đã TT)', 'Collected revenue (Paid)')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-600">
            {formatCurrency(kpiStats.collectedRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('{paid} đơn đã thu', '{paid} paid', {
              paid: kpiStats.paidCount,
            })}{' '}
            • {tx('Chưa thu:', 'Unpaid:')}{' '}
            <strong>
              {formatCurrency(kpiStats.unpaidAmount, activeShop.currency)} (
              {kpiStats.unpaidCount})
            </strong>
            {kpiStats.refundedCount > 0 && (
              <span className="block text-rose-600">
                {tx('Hoàn tiền:', 'Refunded:')}{' '}
                {formatCurrency(kpiStats.refundedAmount, activeShop.currency)} (
                {kpiStats.refundedCount})
              </span>
            )}
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800">
              {tx('Thu Tiền Mặt (Đã TT)', 'Paid Cash Revenue')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Banknote className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-slate-900">
            {formatCurrency(kpiStats.cashRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('{count} đơn tiền mặt đã thu', '{count} paid cash orders', {
              count: kpiStats.cashCount,
            })}
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-blue-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-800">
              {tx('Chuyển Khoản VietQR (Đã TT)', 'Paid VietQR Transfer')}
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
              <QrCode className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-blue-600">
            {formatCurrency(kpiStats.vietqrRevenue, activeShop.currency)}
          </p>
          <p className="text-[11px] font-semibold text-slate-500">
            {tx('{count} đơn VietQR đã thu', '{count} paid VietQR orders', {
              count: kpiStats.vietqrCount,
            })}
          </p>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          role="tablist"
          aria-label={tx('Chọn chế độ xem báo cáo', 'Report view tabs')}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeViewTab === 'orders_list'}
            data-testid="reports-tab-orders"
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
            role="tab"
            aria-selected={activeViewTab === 'tables_summary'}
            data-testid="reports-tab-tables"
            onClick={() => setActiveViewTab('tables_summary')}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeViewTab === 'tables_summary'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {tx('🪑 Theo bàn ({count} bàn)', '🪑 By table ({count} tables)', {
              count: tableSummaryList.length,
            })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeViewTab === 'daily_summary'}
            data-testid="reports-tab-daily"
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
            role="tab"
            aria-selected={activeViewTab === 'items_summary'}
            data-testid="reports-tab-items"
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
          {tx('Hiển thị', 'Showing')} <strong>{filteredOrders.length}</strong>{' '}
          {tx('đơn trong kỳ', 'orders in')}{' '}
          <strong>{effectiveDateBounds.label}</strong>
        </span>
      </div>

      {/* TAB 1: FULL ORDERS LIST TABLE */}
      {activeViewTab === 'orders_list' && (
        <section
          data-testid="reports-orders-table-section"
          className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden"
        >
          <AppDataTable<ShopOrder>
            keyField="id"
            ariaLabel={tx('Bảng danh sách đơn hàng', 'Orders report table')}
            columns={ordersColumns}
            data={pagedOrders.rows}
            progressPending={loading}
            sortServer
            defaultSortFieldId={sortByTab.orders_list.columnId}
            defaultSortAsc={sortByTab.orders_list.direction === 'asc'}
            onSort={(col, dir) => handleTabSort('orders_list', col, dir)}
            pagination
            paginationServer
            paginationTotalRows={sortedOrders.length}
            paginationDefaultPage={pagedOrders.page}
            paginationPerPage={pagedOrders.rowsPerPage}
            paginationRowsPerPageOptions={[10, 20, 50, 100]}
            paginationResetDefaultPage={paginationResetToggle}
            onChangePage={(page) => handleTabPageChange('orders_list', page)}
            onChangeRowsPerPage={(perPage, page) =>
              handleTabRowsPerPageChange('orders_list', perPage, page)
            }
            noDataComponent={
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
            }
          />
          {!loading && sortedOrders.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-emerald-50/70 px-4 py-3 text-xs font-black text-slate-900">
              <span>
                {tx(
                  'Tổng cộng ({count} đơn hợp lệ • {items} món):',
                  'Total ({count} valid orders • {items} items):',
                  {
                    count: kpiStats.validCount,
                    items: kpiStats.totalItemsSold,
                  }
                )}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-emerald-700 text-sm">
                  {tx('Thực thu (Đã TT):', 'Collected (Paid):')}{' '}
                  {formatCurrency(kpiStats.collectedRevenue, currency)}
                </span>
                <span className="text-slate-600 font-bold">
                  {tx('TM:', 'Cash:')}{' '}
                  {formatCurrency(kpiStats.cashRevenue, currency)} • QR:{' '}
                  {formatCurrency(kpiStats.vietqrRevenue, currency)}
                </span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: BY TABLE SUMMARY TABLE */}
      {activeViewTab === 'tables_summary' && (
        <section
          data-testid="reports-per-table-summary"
          className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                <Utensils className="h-4 w-4 text-emerald-600" />
                <span>
                  {tx(
                    'Thống kê doanh thu & đơn hàng theo bàn / vị trí',
                    'Per-Table Revenue & Order Summary'
                  )}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                {tx(
                  'Nhóm theo định danh bàn cố định (table_id) kể cả sau khi đổi tên hoặc lưu trữ bàn. Tách biệt doanh thu đã thu tiền với đơn chưa thu, hoàn tiền và đơn hủy.',
                  'Grouped by stable table_id across renames and archives. Separates paid collected revenue from unpaid, refunded, and cancelled orders.'
                )}
              </p>
            </div>
            <span className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800 self-start sm:self-auto">
              {tx('{count} nhóm bàn / vị trí', '{count} table groups', {
                count: tableSummaryList.length,
              })}
            </span>
          </div>

          <AppDataTable<TableOrderStats>
            keyField="key"
            ariaLabel={tx('Bảng thống kê theo bàn', 'By-table report table')}
            columns={tablesColumns}
            data={pagedTables.rows}
            progressPending={loading}
            sortServer
            defaultSortFieldId={sortByTab.tables_summary.columnId}
            defaultSortAsc={sortByTab.tables_summary.direction === 'asc'}
            onSort={(col, dir) => handleTabSort('tables_summary', col, dir)}
            pagination
            paginationServer
            paginationTotalRows={sortedTables.length}
            paginationDefaultPage={pagedTables.page}
            paginationPerPage={pagedTables.rowsPerPage}
            paginationRowsPerPageOptions={[10, 20, 50, 100]}
            paginationResetDefaultPage={paginationResetToggle}
            onChangePage={(page) => handleTabPageChange('tables_summary', page)}
            onChangeRowsPerPage={(perPage, page) =>
              handleTabRowsPerPageChange('tables_summary', perPage, page)
            }
            noDataComponent={
              <div className="p-12 text-center text-xs font-semibold text-slate-500">
                {tx(
                  'Chưa có đơn hàng theo bàn nào khớp với bộ lọc hiện tại.',
                  'No table orders match the current filters.'
                )}
              </div>
            }
          />
        </section>
      )}

      {/* TAB 3: DAILY BREAKDOWN TABLE */}
      {activeViewTab === 'daily_summary' && (
        <section
          data-testid="reports-daily-table-section"
          className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden"
        >
          <div className="border-b border-slate-100 px-5 py-3.5">
            <p className="text-xs font-semibold text-slate-600">
              {tx(
                'Doanh thu thực thu ngày (Tiền mặt, VietQR, Thực thu) chỉ cộng các đơn hợp lệ ĐÃ THU TIỀN, đồng bộ với thẻ KPI tổng quan.',
                'Daily collected revenue (Cash, VietQR, Collected) sums only non-cancelled PAID orders, matching the top KPI cards.'
              )}
            </p>
          </div>
          <AppDataTable<DailySummaryRow>
            keyField="dateKey"
            ariaLabel={tx(
              'Bảng thống kê doanh thu theo ngày',
              'Daily summary report table'
            )}
            columns={dailyColumns}
            data={pagedDaily.rows}
            progressPending={loading}
            sortServer
            defaultSortFieldId={sortByTab.daily_summary.columnId}
            defaultSortAsc={sortByTab.daily_summary.direction === 'asc'}
            onSort={(col, dir) => handleTabSort('daily_summary', col, dir)}
            pagination
            paginationServer
            paginationTotalRows={sortedDaily.length}
            paginationDefaultPage={pagedDaily.page}
            paginationPerPage={pagedDaily.rowsPerPage}
            paginationRowsPerPageOptions={[10, 20, 50, 100]}
            paginationResetDefaultPage={paginationResetToggle}
            onChangePage={(page) => handleTabPageChange('daily_summary', page)}
            onChangeRowsPerPage={(perPage, page) =>
              handleTabRowsPerPageChange('daily_summary', perPage, page)
            }
            noDataComponent={
              <div className="p-12 text-center text-xs font-semibold text-slate-500">
                {tx(
                  'Không có dữ liệu doanh thu ngày trong khoảng thời gian này.',
                  'No daily revenue data in this period.'
                )}
              </div>
            }
          />
        </section>
      )}

      {/* TAB 4: SOLD ITEMS BREAKDOWN TABLE */}
      {activeViewTab === 'items_summary' && (
        <section
          data-testid="reports-items-table-section"
          className="rounded-3xl bg-white border border-slate-200 shadow-2xs overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
            <p className="text-xs font-semibold text-slate-600">
              {tx(
                'Doanh số món gộp tính theo giá món + topping/option trước chiết khấu toàn đơn. Doanh thu thực thu toàn quán (đã trừ giảm giá đơn & chỉ tính đơn đã thu):',
                'Gross item sales sum canonical item + option prices before order-level discounts. Net collected order revenue (paid orders after order discounts):'
              )}{' '}
              <strong className="text-emerald-700">
                {formatCurrency(kpiStats.collectedRevenue, currency)}
              </strong>
              {kpiStats.totalDiscount > 0 && (
                <span className="ml-1.5 text-rose-600">
                  • {tx('Giảm giá đơn:', 'Order discounts:')}{' '}
                  {formatCurrency(kpiStats.totalDiscount, currency)}
                </span>
              )}
            </p>
            <span className="text-xs font-bold text-slate-700 shrink-0">
              {tx('Tổng doanh số món gộp:', 'Total gross item sales:')}{' '}
              <strong>
                {formatCurrency(kpiStats.grossItemSales, currency)}
              </strong>
            </span>
          </div>

          <AppDataTable<ItemSummaryRow>
            keyField="itemKey"
            ariaLabel={tx('Bảng thống kê theo món', 'By-item report table')}
            columns={itemsColumns}
            data={pagedItems.rows}
            progressPending={loading}
            sortServer
            defaultSortFieldId={sortByTab.items_summary.columnId}
            defaultSortAsc={sortByTab.items_summary.direction === 'asc'}
            onSort={(col, dir) => handleTabSort('items_summary', col, dir)}
            pagination
            paginationServer
            paginationTotalRows={sortedItems.length}
            paginationDefaultPage={pagedItems.page}
            paginationPerPage={pagedItems.rowsPerPage}
            paginationRowsPerPageOptions={[10, 20, 50, 100]}
            paginationResetDefaultPage={paginationResetToggle}
            onChangePage={(page) => handleTabPageChange('items_summary', page)}
            onChangeRowsPerPage={(perPage, page) =>
              handleTabRowsPerPageChange('items_summary', perPage, page)
            }
            noDataComponent={
              <div className="p-12 text-center text-xs font-semibold text-slate-500">
                {tx(
                  'Không có món ăn nào được bán trong khoảng thời gian này.',
                  'No items sold in this period.'
                )}
              </div>
            }
          />
        </section>
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
