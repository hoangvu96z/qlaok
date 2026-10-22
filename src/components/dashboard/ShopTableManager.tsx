'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Edit3,
  Power,
  Archive,
  RotateCcw,
  QrCode,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Users,
  MapPin,
  Hash,
  Utensils,
  Lock,
  X,
  Save,
} from 'lucide-react';
import { Shop, ShopTable } from '@/types/qlaok';
import { getAuthHeaders } from '@/lib/auth-session';
import { buildTableMenuUrl } from '@/lib/table-helpers';
import { PrintableStandee } from '@/components/dashboard/PrintableStandee';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export interface ShopTableManagerProps {
  shop: Shop;
  canManageTables: boolean;
  baseUrl: string;
  showWifi: boolean;
  accentColor: string;
  onTablesChanged?: (tables: ShopTable[]) => void;
}

export function ShopTableManager({
  shop,
  canManageTables,
  baseUrl,
  showWifi,
  accentColor,
  onTablesChanged,
}: ShopTableManagerProps) {
  const { t, tx } = useAppI18n();

  const [tables, setTables] = useState<ShopTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filter tab: active + inactive vs archived
  const [viewFilter, setViewFilter] = useState<'current' | 'archived' | 'all'>(
    'current'
  );

  // Create form state
  const [createName, setCreateName] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [createSection, setCreateSection] = useState('');
  const [createCapacity, setCreateCapacity] = useState('4');
  const [creating, setCreating] = useState(false);

  // Inline Edit state
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editSection, setEditSection] = useState('');
  const [editCapacity, setEditCapacity] = useState('4');
  const [savingId, setSavingId] = useState<string | null>(null);

  // Selected table for QR Standee Preview & Download
  const [selectedQrTableId, setSelectedQrTableId] = useState<string | null>(
    null
  );
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null);

  // Stale response guard when switching shops
  const activeShopIdRef = useRef(shop.id);
  const requestSeqRef = useRef(0);
  const onTablesChangedRef = useRef(onTablesChanged);
  onTablesChangedRef.current = onTablesChanged;

  useEffect(() => {
    if (activeShopIdRef.current !== shop.id) {
      activeShopIdRef.current = shop.id;
      setTables([]);
      setLoadError(null);
      setActionError(null);
      setActionSuccess(null);
      setEditingTableId(null);
      setSelectedQrTableId(null);
      setLoading(true);
    }
  }, [shop.id]);

  const fetchTables = useCallback(async () => {
    const currentShopId = shop.id;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const managementUrl = `/api/tables?shopId=${encodeURIComponent(currentShopId)}&includeInactive=1&includeArchived=1`;
      let res = await fetch(managementUrl, {
        headers: getAuthHeaders(),
        cache: 'no-store',
      });

      // If non-owner staff does not have management list permission, fallback to active tables list
      if (
        (res.status === 401 || res.status === 403) &&
        !canManageTables
      ) {
        res = await fetch(
          `/api/tables?shopId=${encodeURIComponent(currentShopId)}`,
          {
            headers: getAuthHeaders(),
            cache: 'no-store',
          }
        );
      }

      if (
        activeShopIdRef.current !== currentShopId ||
        seq !== requestSeqRef.current
      ) {
        return;
      }

      const data = await res.json().catch(() => null);
      if (
        activeShopIdRef.current !== currentShopId ||
        seq !== requestSeqRef.current
      ) {
        return;
      }

      if (!res.ok) {
        setLoadError(
          data?.error ||
            tx(
              'Không thể tải danh sách bàn của quán. Vui lòng thử lại.',
              'Failed to load shop tables. Please try again.'
            )
        );
        setLoading(false);
        return;
      }

      const loaded: ShopTable[] = Array.isArray(data?.tables)
        ? data.tables.filter((tb: ShopTable) => tb && tb.shop_id === currentShopId)
        : [];

      setTables(loaded);
      onTablesChangedRef.current?.(loaded);
      setSelectedQrTableId((prev) => {
        if (prev && loaded.some((tb) => tb.id === prev)) return prev;
        const firstActive = loaded.find((tb) => tb.is_active && !tb.is_archived);
        return firstActive?.id || loaded[0]?.id || null;
      });
      setLoading(false);
    } catch {
      if (
        activeShopIdRef.current === currentShopId &&
        seq === requestSeqRef.current
      ) {
        setLoadError(
          tx(
            'Lỗi kết nối khi tải danh sách bàn. Vui lòng kiểm tra mạng và thử lại.',
            'Network error while loading tables. Please check connection and retry.'
          )
        );
        setLoading(false);
      }
    }
  }, [shop.id, canManageTables, tx]);

  useEffect(() => {
    void fetchTables();
  }, [fetchTables]);

  const sortedTables = useMemo(() => {
    return [...tables].sort(
      (a, b) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
        a.name.localeCompare(b.name, 'vi')
    );
  }, [tables]);

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let archived = 0;
    for (const tb of sortedTables) {
      if (tb.is_archived) archived += 1;
      else if (tb.is_active) active += 1;
      else inactive += 1;
    }
    return {
      active,
      inactive,
      current: active + inactive,
      archived,
      total: sortedTables.length,
    };
  }, [sortedTables]);

  const visibleTables = useMemo(() => {
    if (viewFilter === 'archived') {
      return sortedTables.filter((tb) => tb.is_archived);
    }
    if (viewFilter === 'current') {
      return sortedTables.filter((tb) => !tb.is_archived);
    }
    return sortedTables;
  }, [sortedTables, viewFilter]);

  const selectedQrTable = useMemo(() => {
    if (!selectedQrTableId) return null;
    return sortedTables.find((tb) => tb.id === selectedQrTableId) || null;
  }, [sortedTables, selectedQrTableId]);

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTables || creating) return;
    const cleanName = createName.trim();
    if (!cleanName) {
      setActionError(
        tx(
          'Vui lòng nhập tên bàn (VD: Bàn 01, VIP 1).',
          'Please enter a table name (e.g. Table 01, VIP 1).'
        )
      );
      return;
    }

    const currentShopId = shop.id;
    setCreating(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const cap = Math.max(1, Number(createCapacity) || 4);
      const res = await fetch('/api/tables', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          shop_id: currentShopId,
          name: cleanName,
          table_code: createCode.trim() || undefined,
          section: createSection.trim() || undefined,
          capacity: cap,
          sort_order: sortedTables.length + 1,
        }),
      });
      const data = await res.json().catch(() => null);
      if (activeShopIdRef.current !== currentShopId) return;

      if (!res.ok || !data?.table) {
        setActionError(
          data?.error ||
            tx('Không thể tạo bàn mới.', 'Failed to create table.')
        );
        return;
      }

      const createdTable: ShopTable = data.table;
      setTables((prev) => {
        const next = [...prev.filter((t) => t.id !== createdTable.id), createdTable];
        onTablesChangedRef.current?.(next);
        return next;
      });
      setSelectedQrTableId(createdTable.id);
      setCreateName('');
      setCreateCode('');
      setCreateSection('');
      setCreateCapacity('4');
      setActionSuccess(
        tx(
          `Đã tạo bàn "${createdTable.name}" và tạo mã QR riêng thành công.`,
          `Created table "${createdTable.name}" with its unique QR code.`
        )
      );
    } catch {
      if (activeShopIdRef.current === currentShopId) {
        setActionError(
          tx(
            'Lỗi kết nối khi tạo bàn mới.',
            'Network error while creating table.'
          )
        );
      }
    } finally {
      if (activeShopIdRef.current === currentShopId) {
        setCreating(false);
      }
    }
  };

  const startEditTable = (table: ShopTable) => {
    setEditingTableId(table.id);
    setEditName(table.name);
    setEditCode(table.table_code || '');
    setEditSection(table.section || '');
    setEditCapacity(String(table.capacity || 4));
    setActionError(null);
    setActionSuccess(null);
  };

  const handleSaveEditTable = async (table: ShopTable) => {
    if (!canManageTables || savingId) return;
    const cleanName = editName.trim();
    if (!cleanName) {
      setActionError(
        tx('Tên bàn không được để trống.', 'Table name cannot be empty.')
      );
      return;
    }

    const currentShopId = shop.id;
    setSavingId(table.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      const cap = Math.max(1, Number(editCapacity) || 4);
      const res = await fetch('/api/tables', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          shop_id: currentShopId,
          id: table.id,
          name: cleanName,
          table_code: editCode.trim() || table.table_code,
          section: editSection.trim(),
          capacity: cap,
        }),
      });
      const data = await res.json().catch(() => null);
      if (activeShopIdRef.current !== currentShopId) return;

      if (!res.ok || !data?.table) {
        setActionError(
          data?.error ||
            tx('Không thể cập nhật thông tin bàn.', 'Failed to update table.')
        );
        return;
      }

      const updated: ShopTable = data.table;
      setTables((prev) => {
        const next = prev.map((tb) => (tb.id === updated.id ? updated : tb));
        onTablesChangedRef.current?.(next);
        return next;
      });
      setEditingTableId(null);
      setActionSuccess(
        tx(
          `Đã cập nhật thông tin bàn "${updated.name}".`,
          `Updated table "${updated.name}".`
        )
      );
    } catch {
      if (activeShopIdRef.current === currentShopId) {
        setActionError(
          tx('Lỗi kết nối khi cập nhật bàn.', 'Network error while updating table.')
        );
      }
    } finally {
      if (activeShopIdRef.current === currentShopId) {
        setSavingId(null);
      }
    }
  };

  const handlePatchTableState = async (
    table: ShopTable,
    patch: { is_active?: boolean; is_archived?: boolean }
  ) => {
    if (!canManageTables || savingId) return;
    const currentShopId = shop.id;
    setSavingId(table.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch('/api/tables', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          shop_id: currentShopId,
          id: table.id,
          ...patch,
        }),
      });
      const data = await res.json().catch(() => null);
      if (activeShopIdRef.current !== currentShopId) return;

      if (!res.ok || !data?.table) {
        setActionError(
          data?.error ||
            tx(
              'Không thể thay đổi trạng thái bàn.',
              'Failed to update table status.'
            )
        );
        return;
      }

      const updated: ShopTable = data.table;
      setTables((prev) => {
        const next = prev.map((tb) => (tb.id === updated.id ? updated : tb));
        onTablesChangedRef.current?.(next);
        return next;
      });

      if (patch.is_archived === true) {
        setActionSuccess(
          tx(
            `Đã lưu trữ bàn "${updated.name}". Toàn bộ lịch sử đơn hàng của bàn vẫn được giữ nguyên.`,
            `Archived table "${updated.name}". Historical orders remain preserved.`
          )
        );
      } else if (patch.is_archived === false) {
        setActionSuccess(
          tx(
            `Đã khôi phục bàn "${updated.name}" từ kho lưu trữ.`,
            `Restored table "${updated.name}" from archive.`
          )
        );
      } else {
        setActionSuccess(
          updated.is_active
            ? tx(
                `Đã bật phục vụ cho "${updated.name}".`,
                `Activated "${updated.name}".`
              )
            : tx(
                `Đã tạm ngưng phục vụ "${updated.name}".`,
                `Deactivated "${updated.name}".`
              )
        );
      }
    } catch {
      if (activeShopIdRef.current === currentShopId) {
        setActionError(
          tx(
            'Lỗi kết nối khi cập nhật trạng thái bàn.',
            'Network error while updating table status.'
          )
        );
      }
    } finally {
      if (activeShopIdRef.current === currentShopId) {
        setSavingId(null);
      }
    }
  };

  const handleCopyTableUrl = async (table: ShopTable) => {
    const url = buildTableMenuUrl(baseUrl, shop.slug, table.id, table.qr_sig);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTableId(table.id);
      setTimeout(() => {
        setCopiedTableId((prev) => (prev === table.id ? null : prev));
      }, 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <section
      id="table-management"
      data-testid="qr-studio-table-management"
      className="rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 sm:p-6 shadow-2xs space-y-6"
    >
      {/* Header & Summary Badges */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-3 py-1 text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
            <Utensils className="h-3.5 w-3.5" />
            <span>
              {tx(
                'Quản lý sơ đồ bàn & Mã QR từng bàn',
                'Table Management & Per-Table QR Codes'
              )}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">
            {tx(
              'Danh sách bàn & Mã QR định danh từng bàn',
              'Shop Tables & Unique Table QR Standees'
            )}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {tx(
              'Mỗi bàn có một đường dẫn QR cố định (?src=table&tableId=...). Đổi tên hoặc lưu trữ bàn vẫn giữ nguyên lịch sử đơn hàng và doanh thu.',
              'Each table gets a stable QR link (?src=table&tableId=...). Renaming or archiving a table preserves its historical orders and revenue.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
            {tx('Đang hoạt động:', 'Active:')} <strong>{counts.active}</strong>
          </span>
          <span className="rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
            {tx('Tạm ngưng:', 'Inactive:')} <strong>{counts.inactive}</strong>
          </span>
          <span className="rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
            {tx('Đã lưu trữ:', 'Archived:')} <strong>{counts.archived}</strong>
          </span>
          <button
            type="button"
            onClick={() => void fetchTables()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            <span>{tx('Làm mới', 'Refresh')}</span>
          </button>
        </div>
      </div>

      {/* Non-Owner Read-Only Notice */}
      {!canManageTables && (
        <div
          role="status"
          data-testid="table-manager-readonly-banner"
          className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-600/50 dark:bg-amber-950/40 px-4 py-3 text-xs font-bold text-amber-900 dark:text-amber-200"
        >
          <Lock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {tx(
              'Chế độ chỉ xem: Chỉ chủ quán mới có quyền thêm, chỉnh sửa, bật/tắt hoặc lưu trữ bàn. Bạn vẫn có thể xem, sao chép link và tải bảng QR cho từng bàn.',
              'Read-only mode: Only the shop owner can create, edit, activate/deactivate, or archive tables. You can still view, copy links, and download table QR standees.'
            )}
          </span>
        </div>
      )}

      {/* Create Table Form (Owner Only) */}
      {canManageTables && (
        <form
          onSubmit={handleCreateTable}
          data-testid="create-table-form"
          className="rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/60 p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {tx('➕ Thêm bàn / vị trí phục vụ mới', '➕ Create New Table / Seat')}
            </h3>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {tx(
                'Lưu trữ bàn sẽ giữ nguyên lịch sử đơn (không xóa cứng)',
                'Archiving retains order history (no hard delete)'
              )}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label
                htmlFor="new-table-name"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
              >
                {tx('Tên bàn *', 'Table Name *')}
              </label>
              <input
                id="new-table-name"
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={tx('VD: Bàn 09, Phòng VIP 1', 'e.g. Table 09, VIP 1')}
                className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="new-table-code"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
              >
                {tx('Mã bàn (Code)', 'Table Code')}
              </label>
              <input
                id="new-table-code"
                type="text"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                placeholder={tx('VD: T09, VIP1 (tự tạo nếu trống)', 'e.g. T09, VIP1')}
                className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="new-table-section"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
              >
                {tx('Khu vực / Tầng', 'Section / Zone')}
              </label>
              <input
                id="new-table-section"
                type="text"
                value={createSection}
                onChange={(e) => setCreateSection(e.target.value)}
                placeholder={tx('VD: Tầng 1, Sân vườn', 'e.g. Floor 1, Patio')}
                className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="new-table-capacity"
                className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
              >
                {tx('Sức chứa (khách)', 'Capacity (seats)')}
              </label>
              <input
                id="new-table-capacity"
                type="number"
                min={1}
                max={100}
                value={createCapacity}
                onChange={(e) => setCreateCapacity(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating}
                data-testid="create-table-submit-btn"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50 transition"
              >
                <Plus className="h-4 w-4" />
                <span>
                  {creating
                    ? tx('Đang tạo...', 'Creating...')
                    : tx('Thêm bàn & tạo QR', 'Add Table & QR')}
                </span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Action Feedback Banners */}
      {actionError && (
        <div
          role="alert"
          data-testid="table-manager-action-error"
          className="flex items-center justify-between gap-2 rounded-2xl border border-rose-300 bg-rose-50 dark:border-rose-700/60 dark:bg-rose-950/50 px-4 py-2.5 text-xs font-bold text-rose-800 dark:text-rose-200"
        >
          <span>⚠️ {actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={t('common.close')}
            className="rounded-lg p-1 hover:bg-rose-200/50 dark:hover:bg-rose-900/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div
          role="status"
          data-testid="table-manager-action-success"
          className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/50 px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-200"
        >
          <span>✓ {actionSuccess}</span>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            aria-label={t('common.close')}
            className="rounded-lg p-1 hover:bg-emerald-200/50 dark:hover:bg-emerald-900/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Load Error State */}
      {loadError && (
        <div
          role="alert"
          data-testid="table-manager-load-error"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 dark:border-rose-700/60 dark:bg-rose-950/50 p-4 text-rose-900 dark:text-rose-200"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="text-xs font-black">
                {tx(
                  'Không thể tải danh sách bàn',
                  'Could not load shop tables'
                )}
              </p>
              <p className="text-xs font-medium">{loadError}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="table-manager-retry-btn"
            onClick={() => void fetchTables()}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-black text-white hover:bg-rose-500"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{tx('Thử lại', 'Retry')}</span>
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewFilter('current')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              viewFilter === 'current'
                ? 'bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {tx(
              `Bàn hiện tại (${counts.current})`,
              `Current tables (${counts.current})`
            )}
          </button>
          <button
            type="button"
            onClick={() => setViewFilter('archived')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              viewFilter === 'archived'
                ? 'bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {tx(
              `Kho lưu trữ (${counts.archived})`,
              `Archived (${counts.archived})`
            )}
          </button>
          <button
            type="button"
            onClick={() => setViewFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              viewFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {tx(`Tất cả (${counts.total})`, `All (${counts.total})`)}
          </button>
        </div>
      </div>

      {/* Main Split Grid: Left Table List | Right Selected Table A6 Standee Preview */}
      {loading ? (
        <div
          role="status"
          data-testid="table-manager-loading"
          className="py-12 text-center space-y-2.5"
        >
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {tx('Đang tải dữ liệu sơ đồ bàn...', 'Loading shop tables data...')}
          </p>
        </div>
      ) : visibleTables.length === 0 ? (
        <div
          data-testid="table-manager-empty"
          className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-2"
        >
          <QrCode className="mx-auto h-9 w-9 text-slate-400" />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {viewFilter === 'archived'
              ? tx(
                  'Chưa có bàn nào trong kho lưu trữ',
                  'No archived tables yet'
                )
              : tx(
                  'Quán chưa có bàn nào trong danh sách này',
                  'No tables configured in this view yet'
                )}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {canManageTables
              ? tx(
                  'Hãy nhập tên bàn ở biểu mẫu phía trên để tạo mã QR riêng cho từng bàn.',
                  'Use the form above to create tables and generate unique QR codes for each table.'
                )
              : tx(
                  'Liên hệ chủ quán để thiết lập danh sách bàn phục vụ.',
                  'Ask the shop owner to configure active tables.'
                )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Table Cards List */}
          <div className="xl:col-span-7 space-y-3">
            {visibleTables.map((tb) => {
              const isEditing = editingTableId === tb.id;
              const isSelectedQr = selectedQrTable?.id === tb.id;
              const tableMenuUrl = buildTableMenuUrl(
                baseUrl,
                shop.slug,
                tb.id,
                tb.qr_sig
              );
              const relativeTableMenuPath = buildTableMenuUrl(
                '',
                shop.slug,
                tb.id,
                tb.qr_sig
              );

              return (
                <div
                  key={tb.id}
                  data-testid={`shop-table-row-${tb.id}`}
                  className={`rounded-2xl border p-4 transition ${
                    isSelectedQr
                      ? 'border-emerald-500 bg-emerald-50/30 dark:border-emerald-500/70 dark:bg-emerald-950/20'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60'
                  }`}
                >
                  {isEditing && canManageTables ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        <div>
                          <label
                            htmlFor={`edit-name-${tb.id}`}
                            className="block text-[10px] font-bold text-slate-500 mb-1"
                          >
                            {tx('Tên bàn', 'Table Name')}
                          </label>
                          <input
                            id={`edit-name-${tb.id}`}
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`edit-code-${tb.id}`}
                            className="block text-[10px] font-bold text-slate-500 mb-1"
                          >
                            {tx('Mã bàn', 'Code')}
                          </label>
                          <input
                            id={`edit-code-${tb.id}`}
                            type="text"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`edit-section-${tb.id}`}
                            className="block text-[10px] font-bold text-slate-500 mb-1"
                          >
                            {tx('Khu vực', 'Section')}
                          </label>
                          <input
                            id={`edit-section-${tb.id}`}
                            type="text"
                            value={editSection}
                            onChange={(e) => setEditSection(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`edit-capacity-${tb.id}`}
                            className="block text-[10px] font-bold text-slate-500 mb-1"
                          >
                            {tx('Sức chứa', 'Capacity')}
                          </label>
                          <input
                            id={`edit-capacity-${tb.id}`}
                            type="number"
                            min={1}
                            max={100}
                            value={editCapacity}
                            onChange={(e) => setEditCapacity(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingTableId(null)}
                          className="rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={savingId === tb.id}
                          onClick={() => void handleSaveEditTable(tb)}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <Save className="h-3.5 w-3.5" />
                          <span>{tx('Lưu thay đổi', 'Save')}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                              {tb.name}
                            </h4>
                            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">
                              <Hash className="h-3 w-3" />
                              {tb.table_code}
                            </span>
                            {tb.is_archived ? (
                              <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:text-slate-200">
                                {tx('Đã lưu trữ', 'Archived')}
                              </span>
                            ) : tb.is_active ? (
                              <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-800 dark:text-emerald-300">
                                {tx('Đang hoạt động', 'Active')}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-100 dark:bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:text-amber-300">
                                {tx('Tạm ngưng', 'Inactive')}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            {tb.section && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span>{tb.section}</span>
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5 text-slate-400" />
                              <span>
                                {tb.capacity || 4} {tx('khách', 'seats')}
                              </span>
                            </span>
                            <code className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                              {relativeTableMenuPath}
                            </code>
                          </div>
                        </div>

                        {/* QR Actions (Available to all dashboard viewers) */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedQrTableId(tb.id)}
                            data-testid={`select-table-qr-${tb.id}`}
                            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
                              isSelectedQr
                                ? 'bg-emerald-600 text-white'
                                : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                            }`}
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span>
                              {tx('Xem & In QR', 'Preview QR')}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleCopyTableUrl(tb)}
                            data-testid={`copy-table-url-${tb.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                            title={tableMenuUrl}
                          >
                            {copiedTableId === tb.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
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
                            href={relativeTableMenuPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`open-table-url-${tb.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>{tx('Mở thử', 'Open')}</span>
                          </a>
                        </div>
                      </div>

                      {/* Owner Mutation Actions (Hidden for non-owners) */}
                      {canManageTables && (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-2.5">
                          <button
                            type="button"
                            disabled={savingId === tb.id}
                            onClick={() => startEditTable(tb)}
                            data-testid={`edit-table-btn-${tb.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3 w-3" />
                            <span>{tx('Sửa thông tin', 'Edit')}</span>
                          </button>

                          {!tb.is_archived && (
                            <button
                              type="button"
                              disabled={savingId === tb.id}
                              onClick={() =>
                                void handlePatchTableState(tb, {
                                  is_active: !tb.is_active,
                                })
                              }
                              data-testid={`toggle-active-table-btn-${tb.id}`}
                              className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                                tb.is_active
                                  ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700/60 dark:bg-emerald-950/50 dark:text-emerald-200'
                              }`}
                            >
                              <Power className="h-3 w-3" />
                              <span>
                                {tb.is_active
                                  ? tx('Tạm ngưng bàn', 'Deactivate')
                                  : tx('Bật phục vụ', 'Activate')}
                              </span>
                            </button>
                          )}

                          {!tb.is_archived ? (
                            <button
                              type="button"
                              disabled={savingId === tb.id}
                              onClick={() =>
                                void handlePatchTableState(tb, {
                                  is_archived: true,
                                  is_active: false,
                                })
                              }
                              data-testid={`archive-table-btn-${tb.id}`}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                              title={tx(
                                'Lưu trữ bàn (giữ nguyên toàn bộ lịch sử đơn hàng)',
                                'Archive table (preserves all historical orders)'
                              )}
                            >
                              <Archive className="h-3 w-3" />
                              <span>{tx('Lưu trữ', 'Archive')}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={savingId === tb.id}
                              onClick={() =>
                                void handlePatchTableState(tb, {
                                  is_archived: false,
                                  is_active: true,
                                })
                              }
                              data-testid={`restore-table-btn-${tb.id}`}
                              className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>
                                {tx('Khôi phục bàn', 'Restore & Activate')}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected Table PrintableStandee Preview */}
          <div className="xl:col-span-5 rounded-3xl border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60 p-5 space-y-4">
            {selectedQrTable ? (
              <>
                <div className="text-center space-y-1">
                  <span className="inline-block rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-3 py-0.5 text-[11px] font-extrabold text-emerald-800 dark:text-emerald-300">
                    {tx(
                      `BẢNG QR RIÊNG • ${selectedQrTable.name.toUpperCase()}`,
                      `TABLE QR STANDEE • ${selectedQrTable.name.toUpperCase()}`
                    )}
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {tx(
                      'Khách quét mã này sẽ tự động chọn đúng bàn trên thực đơn.',
                      'Scanning this QR automatically selects this table in the menu.'
                    )}
                  </p>
                </div>

                <PrintableStandee
                  shop={shop}
                  qrType="table"
                  baseUrl={baseUrl}
                  showWifi={showWifi}
                  accentColor={accentColor}
                  table={selectedQrTable}
                />
              </>
            ) : (
              <div className="py-12 text-center text-xs font-semibold text-slate-500">
                {tx(
                  'Chọn một bàn bên trái để xem và tải bảng QR A6.',
                  'Select a table on the left to preview and download its A6 QR standee.'
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
