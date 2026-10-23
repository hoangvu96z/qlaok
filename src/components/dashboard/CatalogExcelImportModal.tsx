'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  ArrowRight,
  Info,
  RefreshCw,
  Download,
} from 'lucide-react';
import type { CatalogItem, Category } from '@/types/qlaok';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { getAuthHeaders } from '@/lib/auth-session';
import {
  parseAndValidateCatalogExcel,
  downloadCatalogXlsx,
  MAX_CATALOG_EXCEL_FILE_SIZE,
  type CatalogImportValidationResult,
  type CatalogImportRowParsed,
} from '@/lib/catalog-excel';

interface CatalogExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
  shopName?: string;
  currentItems: CatalogItem[];
  categories: Category[];
  onSuccess: (updatedCount: number) => void;
}

export function CatalogExcelImportModal({
  isOpen,
  onClose,
  shopId,
  shopName,
  currentItems,
  categories,
  onSuccess,
}: CatalogExcelImportModalProps) {
  const { t, tx } = useAppI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [validationResult, setValidationResult] =
    useState<CatalogImportValidationResult | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'valid' | 'invalid' | 'unchanged'>('all');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [hasApplied, setHasApplied] = useState(false);
  const [partialResult, setPartialResult] = useState<{
    updatedCount: number;
    failedCount: number;
    failedItems: Array<{ id: string; error?: string }>;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Reset state when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setValidationResult(null);
      setFilterTab('all');
      setApplying(false);
      setApplyError(null);
      setHasApplied(false);
      setPartialResult(null);
    }
  }, [isOpen]);

  // Esc key dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !applying) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, applying, onClose]);

  if (!isOpen) return null;

  const handleProcessFile = async (file: File) => {
    setApplyError(null);
    setHasApplied(false);
    setPartialResult(null);
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setValidationResult({
        ok: false,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        unchangedRows: [],
        errors: [
          tx(
            'Chỉ chấp nhận file định dạng Excel (.xlsx).',
            'Only Excel (.xlsx) files are accepted.'
          ),
        ],
      });
      setSelectedFile(file);
      return;
    }

    if (file.size > MAX_CATALOG_EXCEL_FILE_SIZE) {
      setValidationResult({
        ok: false,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        unchangedRows: [],
        errors: [
          tx(
            'Dung lượng file vượt quá giới hạn 5MB.',
            'File size exceeds the 5MB limit.'
          ),
        ],
      });
      setSelectedFile(file);
      return;
    }

    setSelectedFile(file);
    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await parseAndValidateCatalogExcel(buffer, currentItems);
      setValidationResult(res);
      if (res.invalidRows.length > 0 && res.validRows.length === 0) {
        setFilterTab('invalid');
      } else {
        setFilterTab('all');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setValidationResult({
        ok: false,
        totalRows: 0,
        validRows: [],
        invalidRows: [],
        unchangedRows: [],
        errors: [
          tx(
            'Lỗi khi xử lý file: {msg}',
            'Error processing file: {msg}',
            { msg }
          ),
        ],
      });
    } finally {
      setParsing(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleProcessFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleProcessFile(file);
    }
  };

  const handleApplyUpdates = async () => {
    if (
      !validationResult ||
      validationResult.validRows.length === 0 ||
      applying ||
      hasApplied
    ) {
      return;
    }

    setApplying(true);
    setApplyError(null);
    setPartialResult(null);

    try {
      const itemsPayload = validationResult.validRows.map((r) => ({
        id: r.rawId,
        price: r.parsedPrice,
        stock_quantity: r.parsedStock,
      }));

      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'bulk_update_price_stock',
          shopId,
          items: itemsPayload,
        }),
      });

      const data = await res.json().catch(() => null);
      const results: Array<{ id: string; success: boolean; error?: string }> =
        Array.isArray(data?.results) ? data.results : [];
      const updatedCount: number =
        typeof data?.updatedCount === 'number' ? data.updatedCount : 0;
      const failedResults = results.filter((r) => !r.success);

      // If at least one item was updated, notify parent so page reloads catalog & broadcasts catalog_changed!
      if (updatedCount > 0) {
        onSuccess(updatedCount);
      }

      // If HTTP error and zero updates succeeded
      if (!res.ok && updatedCount === 0) {
        const errorMsg =
          data?.error || tx('Không thể áp dụng cập nhật', 'Could not apply updates');
        setApplyError(errorMsg);
        return;
      }

      // Full success: all rows succeeded and server reported success
      if (failedResults.length === 0 && (data?.success || updatedCount === itemsPayload.length)) {
        onClose();
        return;
      }

      // Partial success or per-item failures:
      // Prevent user from applying the same stale preview a second time!
      setHasApplied(true);
      setPartialResult({
        updatedCount,
        failedCount: failedResults.length,
        failedItems: failedResults.map((r) => ({ id: r.id, error: r.error })),
      });
      if (updatedCount === 0 && failedResults.length > 0) {
        setApplyError(
          data?.error ||
            tx(
              'Tất cả {count} món đều cập nhật thất bại.',
              'All {count} items failed to update.',
              { count: failedResults.length }
            )
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setApplyError(msg);
    } finally {
      setApplying(false);
    }
  };

  const rowsToDisplay: CatalogImportRowParsed[] = validationResult
    ? filterTab === 'valid'
      ? validationResult.validRows
      : filterTab === 'invalid'
        ? validationResult.invalidRows
        : filterTab === 'unchanged'
          ? validationResult.unchangedRows
          : [
              ...validationResult.invalidRows,
              ...validationResult.validRows,
              ...validationResult.unchangedRows,
            ]
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="catalog-excel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-4xl rounded-3xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="catalog-excel-modal-title"
                className="text-base font-bold text-slate-900"
              >
                {tx('Nhập giá & tồn kho từ Excel', 'Import Price & Stock from Excel')}
              </h2>
              <p className="text-xs text-slate-500">
                {tx(
                  'Cập nhật hàng loạt nhanh chóng qua file .xlsx (chỉ cập nhật giá & tồn kho)',
                  'Bulk update price and stock quickly via .xlsx file (only modifies price & stock)'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            aria-label={t('common.close')}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* File Upload Drop Zone */}
          {!validationResult ? (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-emerald-500 bg-emerald-50/50'
                    : 'border-slate-300 bg-slate-50/50 hover:border-emerald-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
                {parsing ? (
                  <div className="space-y-2">
                    <Loader2 className="mx-auto h-9 w-9 animate-spin text-emerald-600" />
                    <p className="text-xs font-bold text-slate-700">
                      {tx('Đang đọc & xác thực file Excel...', 'Reading & validating Excel file...')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-2xs text-emerald-600 border border-slate-200">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">
                        {tx(
                          'Kéo thả file Excel (.xlsx) vào đây hoặc bấm để chọn file',
                          'Drag & drop .xlsx Excel file here or click to browse'
                        )}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {tx(
                          'Hỗ trợ file .xlsx tối đa 5MB và 2,000 món. Cần có các cột: Mã món (Item ID), Giá bán, Tồn kho.',
                          'Supports .xlsx up to 5MB and 2,000 rows. Required columns: Item ID, Price, Stock.'
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Template download notice */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    {tx(
                      'Bạn chưa có file mẫu? Xuất dữ liệu thực đơn hiện tại để có sẵn mã món chính xác.',
                      "Don't have a template? Export current catalog data to get exact stable item IDs."
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void downloadCatalogXlsx(
                      currentItems,
                      categories,
                      shopName ? `Thuc-don-${shopName}` : 'Qlaok-thuc-don'
                    );
                  }}
                  className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:text-emerald-800 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{tx('Xuất file mẫu', 'Export template')}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Info Bar & Switch File Action */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="font-bold text-slate-900 truncate">
                    {selectedFile?.name || tx('File đã chọn', 'Selected file')}
                  </span>
                  <span className="text-slate-400">
                    ({validationResult.totalRows} {tx('dòng', 'rows')})
                  </span>
                </div>
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => {
                    setSelectedFile(null);
                    setValidationResult(null);
                    setApplyError(null);
                  }}
                  className="inline-flex items-center gap-1 font-bold text-slate-600 hover:text-slate-900 shrink-0"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{tx('Chọn file khác', 'Choose another file')}</span>
                </button>
              </div>

              {/* File-level error banner */}
              {validationResult.errors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-1 text-xs text-rose-800"
                >
                  <div className="flex items-center gap-2 font-bold text-rose-900">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                    <span>{tx('File không hợp lệ', 'Invalid file')}</span>
                  </div>
                  {validationResult.errors.map((err, i) => (
                    <p key={i} className="pl-6">
                      {err}
                    </p>
                  ))}
                </div>
              )}

              {/* Summary Badges & Filter Tabs */}
              {validationResult.errors.length === 0 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setFilterTab('all')}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        filterTab === 'all'
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <p className="text-[11px] font-semibold opacity-75">
                        {tx('Tổng số dòng', 'Total rows')}
                      </p>
                      <p className="text-lg font-black">{validationResult.totalRows}</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterTab('valid')}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        filterTab === 'valid'
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      <p className="text-[11px] font-semibold opacity-75">
                        {tx('Có thay đổi', 'With changes')}
                      </p>
                      <p className="text-lg font-black text-emerald-700 dark:text-inherit">
                        {validationResult.validRows.length}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterTab('invalid')}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        filterTab === 'invalid'
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900'
                      }`}
                    >
                      <p className="text-[11px] font-semibold opacity-75">
                        {tx('Dòng lỗi', 'Error rows')}
                      </p>
                      <p className="text-lg font-black text-rose-700 dark:text-inherit">
                        {validationResult.invalidRows.length}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterTab('unchanged')}
                      className={`rounded-xl border p-2.5 text-left transition-all ${
                        filterTab === 'unchanged'
                          ? 'border-slate-700 bg-slate-700 text-white'
                          : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <p className="text-[11px] font-semibold opacity-75">
                        {tx('Không đổi', 'Unchanged')}
                      </p>
                      <p className="text-lg font-black">
                        {validationResult.unchangedRows.length}
                      </p>
                    </button>
                  </div>

                  {/* Safety note */}
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-medium text-amber-900">
                    <Info className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>
                      {tx(
                        'Các dòng lỗi sẽ bị bỏ qua khi áp dụng. Tên món, danh mục, quyền và tùy chọn khác được giữ nguyên 100%.',
                        'Error rows are skipped during apply. Item names, categories, permissions, and options remain 100% untouched.'
                      )}
                    </span>
                  </div>

                  {/* Preview Table */}
                  <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-slate-100 text-slate-700 font-bold border-b border-slate-200 z-10">
                          <tr>
                            <th className="py-2.5 px-3 w-12 text-center">#</th>
                            <th className="py-2.5 px-3">{tx('Món ăn', 'Item')}</th>
                            <th className="py-2.5 px-3">{tx('Giá bán', 'Price')}</th>
                            <th className="py-2.5 px-3">{tx('Tồn kho', 'Stock')}</th>
                            <th className="py-2.5 px-3">{tx('Trạng thái', 'Status')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rowsToDisplay.length === 0 ? (
                            <tr>
                              <td
                                colSpan={5}
                                className="py-6 text-center text-slate-400 font-medium"
                              >
                                {tx('Không có dòng nào trong tab này.', 'No rows in this tab.')}
                              </td>
                            </tr>
                          ) : (
                            rowsToDisplay.map((row) => {
                              const currStock =
                                row.matchedItem?.stock_quantity === undefined ||
                                row.matchedItem?.stock_quantity === null
                                  ? '∞'
                                  : row.matchedItem.stock_quantity;
                              const nextStock =
                                row.parsedStock === null || row.parsedStock === undefined
                                  ? '∞'
                                  : row.parsedStock;

                              return (
                                <tr
                                  key={row.rowNumber}
                                  className={
                                    row.status === 'invalid'
                                      ? 'bg-rose-50/50'
                                      : row.status === 'valid'
                                        ? 'bg-emerald-50/30'
                                        : 'bg-white'
                                  }
                                >
                                  <td className="py-2 px-3 text-center text-slate-400 font-mono text-[11px]">
                                    {row.rowNumber}
                                  </td>
                                  <td className="py-2 px-3">
                                    <p className="font-bold text-slate-900 truncate max-w-[200px]">
                                      {row.itemName || row.rawId}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">
                                      ID: {row.rawId}
                                    </p>
                                  </td>
                                  <td className="py-2 px-3">
                                    {row.matchedItem && row.parsedPrice !== undefined ? (
                                      row.priceChanged ? (
                                        <div className="flex items-center gap-1 font-semibold">
                                          <span className="line-through text-slate-400">
                                            {row.matchedItem.price.toLocaleString('vi-VN')}đ
                                          </span>
                                          <ArrowRight className="h-3 w-3 text-emerald-600 shrink-0" />
                                          <span className="font-bold text-emerald-700">
                                            {row.parsedPrice.toLocaleString('vi-VN')}đ
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">
                                          {row.matchedItem.price.toLocaleString('vi-VN')}đ
                                        </span>
                                      )
                                    ) : (
                                      <span className="text-rose-600 font-mono">
                                        {String(row.rawPrice ?? '')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    {row.matchedItem && row.errors.every((e) => !e.includes('Tồn kho')) ? (
                                      row.stockChanged ? (
                                        <div className="flex items-center gap-1 font-semibold">
                                          <span className="line-through text-slate-400">
                                            {currStock}
                                          </span>
                                          <ArrowRight className="h-3 w-3 text-emerald-600 shrink-0" />
                                          <span className="font-bold text-emerald-700">
                                            {nextStock}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-slate-600">{currStock}</span>
                                      )
                                    ) : (
                                      <span className="text-rose-600 font-mono">
                                        {String(row.rawStock ?? '')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    {row.status === 'valid' && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                        <CheckCircle2 className="h-3 w-3" />
                                        {tx('Hợp lệ', 'Valid')}
                                      </span>
                                    )}
                                    {row.status === 'unchanged' && (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                        {tx('Không đổi', 'Unchanged')}
                                      </span>
                                    )}
                                    {row.status === 'invalid' && (
                                      <div className="space-y-0.5">
                                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                          <AlertCircle className="h-3 w-3" />
                                          {tx('Lỗi', 'Error')}
                                        </span>
                                        <p className="text-[10px] text-rose-700 max-w-[220px]">
                                          {row.errors.join('; ')}
                                        </p>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Partial Result / Failure Summary Alert */}
          {partialResult && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2.5 text-xs text-amber-950"
            >
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  {tx(
                    'Kết quả cập nhật: {updated} thành công, {failed} thất bại',
                    'Update result: {updated} succeeded, {failed} failed',
                    {
                      updated: partialResult.updatedCount,
                      failed: partialResult.failedCount,
                    }
                  )}
                </span>
              </div>

              {partialResult.failedItems.length > 0 && (
                <div className="space-y-1.5 pl-6">
                  <p className="font-semibold text-amber-900">
                    {tx('Danh sách món thất bại:', 'Failed items list:')}
                  </p>
                  <ul className="list-disc space-y-1 pl-4 max-h-36 overflow-y-auto text-[11px] text-amber-900">
                    {partialResult.failedItems.map((item, idx) => (
                      <li key={idx}>
                        <span className="font-mono font-bold text-amber-950">
                          {item.id || tx('Không rõ', 'Unknown')}
                        </span>
                        {item.error ? `: ${item.error}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {partialResult.updatedCount > 0 && (
                <p className="text-[11px] font-medium text-amber-800 italic pl-6">
                  {tx(
                    'Dữ liệu thực đơn đã được đồng bộ với {updated} món thành công. Vui lòng tải lại file mới để cập nhật các món còn lại.',
                    'Catalog has been refreshed for the {updated} successful items. Please upload a new file to update remaining items.',
                    { updated: partialResult.updatedCount }
                  )}
                </p>
              )}
            </div>
          )}

          {/* Apply Error Alert */}
          {applyError && !partialResult && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 font-semibold"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <span>{applyError}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {hasApplied ? tx('Đóng', 'Close') : t('common.cancel')}
          </button>

          {validationResult && validationResult.errors.length === 0 && (
            <button
              type="button"
              disabled={applying || validationResult.validRows.length === 0 || hasApplied}
              onClick={handleApplyUpdates}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{tx('Đang cập nhật...', 'Updating...')}</span>
                </>
              ) : hasApplied ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>{tx('Đã áp dụng', 'Applied')}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {tx(
                      'Áp dụng {count} món hợp lệ',
                      'Apply {count} valid items',
                      { count: validationResult.validRows.length }
                    )}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
