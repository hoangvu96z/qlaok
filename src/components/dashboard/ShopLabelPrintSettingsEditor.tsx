'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Printer,
  QrCode,
  RotateCcw,
  Save,
  Tag,
} from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { getAuthHeaders, isSuperAdmin } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { isShopOwnerMembership } from '@/lib/dashboard-nav';
import {
  LABEL_PAPER_PRESET_SPECS,
  MAX_LABEL_COPIES_PER_UNIT,
  MAX_LABEL_FOOTER_LENGTH,
  MAX_MAX_LABELS_PER_PRINT,
  MIN_LABEL_COPIES_PER_UNIT,
  MIN_MAX_LABELS_PER_PRINT,
  VALID_LABEL_PAPER_PRESETS,
  VALID_LABEL_SPLIT_MODES,
  buildLabelPrintPatchPayload,
  cloneLabelPrintConfig,
  formatLabelValidationError,
  getDefaultShopLabelPrintConfig,
  resolveShopLabelPrintConfig,
  validateLabelPrintConfig,
  type LabelPaperPreset,
  type LabelPaperPresetSpec,
  type LabelPrintConfigValidationError,
  type LabelSplitMode,
} from '@/lib/label-print-config';
import type {
  Profile,
  Shop,
  ShopMembership,
  ShopLabelPrintConfig,
} from '@/types/qlaok';

export function canActorEditLabelPrintConfig(
  membership?: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null,
  profile?: Partial<Pick<Profile, 'role' | 'is_admin' | 'email'>> | null,
  isAdminOverride?: boolean
): boolean {
  if (isAdminOverride === true) return true;
  if (isShopOwnerMembership(membership)) return true;
  if (profile && isSuperAdmin(profile as Profile)) return true;
  return false;
}

export type SaveShopLabelPrintResult =
  | {
      ok: true;
      shop: Shop;
      config: ShopLabelPrintConfig;
    }
  | {
      ok: false;
      error: string;
      validationErrors?: LabelPrintConfigValidationError[];
    };

export async function saveShopLabelPrintConfig(params: {
  shopId: string;
  draft: ShopLabelPrintConfig;
  locale?: 'vi' | 'en';
  fetchImpl?: typeof fetch;
  authHeaders?: Record<string, string>;
  onUpdateActiveShop?: (shop: Shop) => void;
  onRefreshDashboard?: () => Promise<void>;
}): Promise<SaveShopLabelPrintResult> {
  const locale = params.locale || 'vi';
  const isEn = locale === 'en';

  if (!params.shopId || !params.shopId.trim()) {
    return {
      ok: false,
      error: isEn ? 'Missing store ID.' : 'Thiếu mã cửa hàng.',
    };
  }

  const validation = validateLabelPrintConfig(params.draft);
  if (!validation.valid || !validation.config) {
    const firstErr = validation.errors[0];
    return {
      ok: false,
      error: firstErr
        ? formatLabelValidationError(firstErr, locale)
        : isEn
          ? 'Invalid label print configuration.'
          : 'Cấu hình in tem nhãn chưa hợp lệ.',
      validationErrors: validation.errors,
    };
  }

  const payload = buildLabelPrintPatchPayload(
    params.shopId,
    validation.config
  );
  const fetcher = params.fetchImpl || globalThis.fetch;

  try {
    const res = await fetcher('/api/shops', {
      method: 'PATCH',
      headers:
        params.authHeaders ||
        getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as {
      shop?: Shop;
      error?: string;
      errors?: LabelPrintConfigValidationError[];
    };

    if (!res.ok || !data?.shop || !data.shop.id || data.shop.id !== params.shopId) {
      return {
        ok: false,
        error:
          data?.error ||
          (isEn
            ? `Could not save label print settings (HTTP ${res.status}).`
            : `Không thể lưu cấu hình in tem nhãn (HTTP ${res.status}).`),
        ...(Array.isArray(data?.errors)
          ? { validationErrors: data.errors }
          : {}),
      };
    }

    params.onUpdateActiveShop?.(data.shop);

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('qlaok_realtime_sync');
        bc.postMessage({
          type: 'shop_updated',
          shopId: params.shopId,
          shop: data.shop,
        });
        bc.close();
      } catch {
        // Ignore BroadcastChannel errors in restricted browsers
      }
    }

    if (params.onRefreshDashboard) {
      try {
        await params.onRefreshDashboard();
      } catch {
        // Keep saved DB result even if background refresh fails
      }
    }

    return {
      ok: true,
      shop: data.shop,
      config: resolveShopLabelPrintConfig(data.shop.theme_config),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message
          ? err.message
          : isEn
            ? 'Network error while saving label print settings.'
            : 'Lỗi kết nối khi lưu cấu hình in tem nhãn.',
    };
  }
}

export interface ShopLabelPrintSettingsEditorProps {
  shop?: Shop | null;
  membership?: Pick<ShopMembership, 'role' | 'permissions' | 'is_active'> | null;
  profile?: Pick<Profile, 'role' | 'is_admin' | 'email'> | null;
  isAdmin?: boolean;
  locale?: 'vi' | 'en';
  initialDraftOverride?: ShopLabelPrintConfig;
  errorOverride?: string | null;
  noticeOverride?: string | null;
  savingOverride?: boolean;
  onUpdateActiveShop?: (shop: Shop) => void;
  onRefreshDashboard?: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

export function ShopLabelPrintSettingsEditor(
  props: ShopLabelPrintSettingsEditorProps
) {
  const dashboard = useDashboard();
  const appI18n = useAppI18n();

  const activeShop = props.shop !== undefined ? props.shop : dashboard.activeShop;
  const activeMembership =
    props.membership !== undefined
      ? props.membership
      : dashboard.activeMembership;
  const activeProfile =
    props.profile !== undefined ? props.profile : dashboard.profile;
  const updateActiveShop =
    props.onUpdateActiveShop || dashboard.updateActiveShop;
  const refreshDashboard =
    props.onRefreshDashboard || dashboard.refreshDashboard;

  const effectiveLocale: 'vi' | 'en' =
    props.locale || (appI18n?.locale === 'en' ? 'en' : 'vi');
  const isEn = effectiveLocale === 'en';
  const tx = useMemo(
    () => (viText: string, enText: string) => (isEn ? enText : viText),
    [isEn]
  );

  const baseId = useId();

  const persistedConfig = useMemo(
    () => resolveShopLabelPrintConfig(activeShop?.theme_config),
    [activeShop?.theme_config]
  );

  const [draft, setDraft] = useState<ShopLabelPrintConfig>(() =>
    props.initialDraftOverride
      ? cloneLabelPrintConfig(props.initialDraftOverride)
      : cloneLabelPrintConfig(persistedConfig)
  );

  const [saving, setSaving] = useState(Boolean(props.savingOverride));
  const [errorMsg, setErrorMsg] = useState<string | null>(
    props.errorOverride ?? null
  );
  const [noticeMsg, setNoticeMsg] = useState<string | null>(
    props.noticeOverride ?? null
  );

  const shopId = activeShop?.id ?? '';
  const serializedPersistedConfig = useMemo(
    () => JSON.stringify(persistedConfig),
    [persistedConfig]
  );

  useEffect(() => {
    if (props.initialDraftOverride) return;
    const nextConfig = resolveShopLabelPrintConfig(activeShop?.theme_config);
    setDraft(cloneLabelPrintConfig(nextConfig));
    setErrorMsg(null);
    setNoticeMsg(null);
  }, [shopId, serializedPersistedConfig, props.initialDraftOverride, activeShop?.theme_config]);

  if (!activeShop) return null;

  const canEdit = canActorEditLabelPrintConfig(
    activeMembership,
    activeProfile,
    props.isAdmin
  );

  const validation = validateLabelPrintConfig(draft);
  const localizedValidationErrors = validation.valid
    ? []
    : validation.errors.map((err) =>
        formatLabelValidationError(err, effectiveLocale)
      );

  const hasUnsavedChanges =
    JSON.stringify(draft) !== serializedPersistedConfig;

  const preventEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    setDraft((prev) => ({ ...prev, enabled: checked }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleSelectPreset = (preset: LabelPaperPreset) => {
    const spec = LABEL_PAPER_PRESET_SPECS[preset];
    setDraft((prev) => ({
      ...prev,
      paper_preset: preset,
      // Suggest default split mode if appropriate, while keeping draft valid
      split_mode: prev.split_mode || spec.default_split_mode,
    }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleSelectSplitMode = (mode: LabelSplitMode) => {
    setDraft((prev) => ({ ...prev, split_mode: mode }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleCopiesPerUnitChange = (val: number) => {
    setDraft((prev) => ({ ...prev, copies_per_unit: val }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleMaxLabelsChange = (val: number) => {
    setDraft((prev) => ({ ...prev, max_labels_per_print: val }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleToggleDisplayField = (
    field: keyof Omit<
      ShopLabelPrintConfig,
      | 'enabled'
      | 'paper_preset'
      | 'split_mode'
      | 'copies_per_unit'
      | 'max_labels_per_print'
      | 'custom_footer_i18n'
    >,
    val: boolean
  ) => {
    setDraft((prev) => ({ ...prev, [field]: val }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleFooterChange = (lang: 'vi' | 'en', text: string) => {
    setDraft((prev) => ({
      ...prev,
      custom_footer_i18n: {
        vi: lang === 'vi' ? text : prev.custom_footer_i18n?.vi ?? '',
        en: lang === 'en' ? text : prev.custom_footer_i18n?.en ?? '',
      },
    }));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleResetToDefault = () => {
    setDraft(getDefaultShopLabelPrintConfig());
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleRevertChanges = () => {
    setDraft(cloneLabelPrintConfig(persistedConfig));
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;

    if (!validation.valid) {
      const firstErr = validation.errors[0];
      setErrorMsg(
        firstErr
          ? formatLabelValidationError(firstErr, effectiveLocale)
          : tx(
              'Cấu hình in tem chưa hợp lệ. Vui lòng kiểm tra lại.',
              'Invalid label print configuration. Please check the fields.'
            )
      );
      setNoticeMsg(null);
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setNoticeMsg(null);

    const result = await saveShopLabelPrintConfig({
      shopId: activeShop.id,
      draft,
      locale: effectiveLocale,
      fetchImpl: props.fetchImpl,
      onUpdateActiveShop: updateActiveShop,
      onRefreshDashboard: refreshDashboard,
    });

    setSaving(false);

    if (result.ok) {
      setDraft(cloneLabelPrintConfig(result.config));
      setNoticeMsg(
        tx(
          'Đã lưu cấu hình in tem nhãn thành công!',
          'Label print settings saved successfully!'
        )
      );
      setErrorMsg(null);
    } else {
      setErrorMsg(result.error);
      setNoticeMsg(null);
    }
  };

  const currentPresetSpec: LabelPaperPresetSpec =
    (draft.paper_preset &&
      LABEL_PAPER_PRESET_SPECS[draft.paper_preset as LabelPaperPreset]) ||
    LABEL_PAPER_PRESET_SPECS.cup_sticker_50x30;

  const currentFooterText =
    effectiveLocale === 'en'
      ? draft.custom_footer_i18n?.en || draft.custom_footer_i18n?.vi || ''
      : draft.custom_footer_i18n?.vi || draft.custom_footer_i18n?.en || '';

  return (
    <section
      id="label-print-settings"
      data-testid="label-print-settings"
      aria-labelledby={`${baseId}-title`}
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5"
    >
      {/* Header & Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-xs">
            <Printer className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2
                id={`${baseId}-title`}
                className="text-sm font-black text-slate-900"
              >
                🏷️ {tx('Tem in món / Production labels', 'Production Labels / Cup Stickers')}
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  draft.enabled
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {draft.enabled
                  ? tx('✓ Đang bật in tem', '✓ Labels enabled')
                  : tx('Tắt in tem', 'Labels disabled')}
              </span>
              {!canEdit && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  {tx('Chỉ xem (Cần quyền Owner)', 'Read-only (Owner only)')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {tx(
                'Tùy chỉnh kích thước tem dán ly, phiếu pha chế bếp, chế độ tách tem và các trường hiển thị.',
                'Customize paper sizes, cup sticker dimensions, kitchen slip formats, split mode, and visible fields.'
              )}
            </p>
          </div>
        </div>

        {/* Global Enabled Switch */}
        <div className="flex items-center gap-2">
          <label
            htmlFor={`${baseId}-enabled`}
            className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800 select-none"
          >
            <input
              id={`${baseId}-enabled`}
              type="checkbox"
              data-testid="label-print-enabled-checkbox"
              disabled={!canEdit || saving}
              checked={draft.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            />
            <span>
              {tx('Kích hoạt in tem nhãn cho quán', 'Enable production labels for store')}
            </span>
          </label>
        </div>
      </div>

      {/* Notice / Error Banners */}
      {noticeMsg && (
        <div
          data-testid="label-save-notice"
          role="status"
          className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800"
        >
          <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          data-testid="label-save-error"
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <span>{errorMsg}</span>
            {localizedValidationErrors.length > 1 && (
              <ul className="list-disc pl-4 text-[11px] font-normal space-y-0.5">
                {localizedValidationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Main Grid: Settings Controls (Left) & Live Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: 7 Columns Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Paper Preset Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black text-slate-800">
                {tx(
                  '1. Khổ giấy & Loại tem in (Paper preset):',
                  '1. Label paper preset & dimensions:'
                )}
              </label>
              <span className="text-[11px] text-slate-500 font-semibold">
                {currentPresetSpec.is_sticker
                  ? tx('Tem dán ly (Decal cắt sẵn)', 'Die-cut sticker')
                  : tx('Phiếu nhiệt liên tục', 'Continuous roll slip')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {VALID_LABEL_PAPER_PRESETS.map((preset) => {
                const spec = LABEL_PAPER_PRESET_SPECS[preset];
                const isSelected = draft.paper_preset === preset;
                const dimensionLabel =
                  spec.height_mm !== null
                    ? `${spec.width_mm} × ${spec.height_mm} mm`
                    : `${spec.width_mm} mm (Khổ cuộn)`;

                return (
                  <button
                    key={preset}
                    type="button"
                    data-testid={`label-preset-${preset}`}
                    disabled={!canEdit || saving}
                    onClick={() => handleSelectPreset(preset)}
                    className={`flex flex-col text-left rounded-2xl border-2 p-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/60 shadow-2xs'
                        : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-black text-slate-900">
                        {isEn ? spec.label_i18n.en : spec.label_i18n.vi}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          spec.is_sticker
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {spec.is_sticker
                          ? tx('Tem decal', 'Sticker')
                          : tx('Giấy cuộn', 'Slip')}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-emerald-700 mt-1">
                      {dimensionLabel}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-1 leading-snug">
                      {preset === 'cup_sticker_50x30' &&
                        tx(
                          'Khổ chuẩn dán ly trà sữa, cà phê take-away.',
                          'Standard for takeaway cup stickers & bubble tea.'
                        )}
                      {preset === 'cup_sticker_40x30' &&
                        tx(
                          'Khổ decal nhỏ gọn, tiết kiệm diện tích tem.',
                          'Compact sticker for small cups & food boxes.'
                        )}
                      {preset === 'production_slip_58mm' &&
                        tx(
                          'Khổ in bill nhiệt K58 thông dụng quầy pha chế.',
                          'Standard 58mm thermal receipt roll for bar prep.'
                        )}
                      {preset === 'production_slip_80mm' &&
                        tx(
                          'Khổ in bill nhiệt K80 cho bếp & quầy trung tâm.',
                          '80mm wide thermal roll for kitchen station slips.'
                        )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Split Mode Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black text-slate-800">
                {tx(
                  '2. Chế độ phân tách tem nhãn (Split mode):',
                  '2. Label splitting mode:'
                )}
              </label>
              <span className="text-[11px] text-slate-500">
                {tx('Quy định cách chia tem khi in đơn', 'How order items split into labels')}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {VALID_LABEL_SPLIT_MODES.map((mode) => {
                const isSelected = draft.split_mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`label-split-mode-${mode}`}
                    disabled={!canEdit || saving}
                    onClick={() => handleSelectSplitMode(mode)}
                    className={`flex items-start gap-3 rounded-2xl border-2 p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/60 shadow-2xs'
                        : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      <div
                        className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-slate-400 bg-white'
                        }`}
                      >
                        {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-slate-900">
                          {mode === 'per_item_unit' &&
                            tx(
                              'Từng ly / đơn vị (Mỗi ly 1 tem riêng)',
                              'Per item unit (1 label per cup/unit)'
                            )}
                          {mode === 'per_line_item' &&
                            tx(
                              'Từng dòng món (1 tem cho mỗi món kèm số lượng)',
                              'Per line item (1 label per item line with quantity)'
                            )}
                          {mode === 'single_ticket' &&
                            tx(
                              'Gộp chung một phiếu (Toàn bộ đơn hàng)',
                              'Single ticket (All items grouped on 1 slip)'
                            )}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 shrink-0">
                          {mode === 'per_item_unit' && tx('Khuyên dùng tem dán ly', 'Recommended for stickers')}
                          {mode === 'per_line_item' && tx('Đơn nhiều món giống nhau', 'Repeated quantity items')}
                          {mode === 'single_ticket' && tx('Khuyên dùng giấy cuộn', 'Recommended for slips')}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {mode === 'per_item_unit' &&
                          tx(
                            'VD: Đơn có 3 ly Trà sữa → In 3 tem rời (1/3, 2/3, 3/3) để dán riêng từng ly.',
                            'e.g. 3 Milk Teas → Prints 3 separate labels (1/3, 2/3, 3/3) to stick on each cup.'
                          )}
                        {mode === 'per_line_item' &&
                          tx(
                            'VD: Đơn có 3 ly Trà sữa → In 1 tem duy nhất ghi "SL: 3" cùng danh sách topping.',
                            'e.g. 3 Milk Teas → Prints 1 label with "Qty: 3" and topping details.'
                          )}
                        {mode === 'single_ticket' &&
                          tx(
                            'In toàn bộ các món trong đơn hàng lên cùng 1 phiếu dài cho bếp/bar theo dõi.',
                            'Prints all ordered items onto a single continuous slip for the kitchen.'
                          )}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Copies & Safety Limits */}
          <div className="space-y-3">
            <label className="block text-xs font-black text-slate-800">
              {tx(
                '3. Số bản in & Giới hạn an toàn (Copies & Limits):',
                '3. Copies per unit & print safety limits:'
              )}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-1.5">
                <label
                  htmlFor={`${baseId}-copies`}
                  className="block text-xs font-bold text-slate-800"
                >
                  {tx('Số bản in mỗi đơn vị', 'Copies per unit')}{' '}
                  <span className="text-slate-500 font-normal">
                    ({MIN_LABEL_COPIES_PER_UNIT}–{MAX_LABEL_COPIES_PER_UNIT})
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`${baseId}-copies`}
                    type="number"
                    data-testid="label-copies-per-unit-input"
                    disabled={!canEdit || saving}
                    min={MIN_LABEL_COPIES_PER_UNIT}
                    max={MAX_LABEL_COPIES_PER_UNIT}
                    step={1}
                    value={draft.copies_per_unit}
                    onKeyDown={preventEnter}
                    onChange={(e) => {
                      const num = parseInt(e.target.value, 10);
                      handleCopiesPerUnitChange(isNaN(num) ? 1 : num);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                  />
                  <span className="text-xs font-semibold text-slate-500 shrink-0">
                    {tx('bản', 'copy')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {tx(
                    'Mỗi ly/món in ra bao nhiêu tem (thường là 1 bản dán ly).',
                    'Number of labels printed per item unit (default: 1).'
                  )}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-1.5">
                <label
                  htmlFor={`${baseId}-max-labels`}
                  className="block text-xs font-bold text-slate-800"
                >
                  {tx('Giới hạn tem tối đa / lần in', 'Max labels per print')}{' '}
                  <span className="text-slate-500 font-normal">
                    ({MIN_MAX_LABELS_PER_PRINT}–{MAX_MAX_LABELS_PER_PRINT})
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`${baseId}-max-labels`}
                    type="number"
                    data-testid="label-max-labels-input"
                    disabled={!canEdit || saving}
                    min={MIN_MAX_LABELS_PER_PRINT}
                    max={MAX_MAX_LABELS_PER_PRINT}
                    step={1}
                    value={draft.max_labels_per_print}
                    onKeyDown={preventEnter}
                    onChange={(e) => {
                      const num = parseInt(e.target.value, 10);
                      handleMaxLabelsChange(isNaN(num) ? 50 : num);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                  />
                  <span className="text-xs font-semibold text-slate-500 shrink-0">
                    {tx('tem', 'labels')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500">
                  {tx(
                    'Ngăn in tràn hoặc kẹt decal khi đơn hàng có số lượng cực lớn.',
                    'Safety cap to avoid runaway rolls on massive group orders.'
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* 4. Display Toggles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black text-slate-800">
                {tx(
                  '4. Trường thông tin hiển thị trên tem (Display fields):',
                  '4. Visible fields on label:'
                )}
              </label>
              <span className="text-[11px] text-slate-500">
                {tx('11 trường tùy chọn', '11 customizable toggles')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                {
                  key: 'show_shop_name' as const,
                  labelVi: 'Tên quán',
                  labelEn: 'Shop name',
                  descVi: activeShop.name || 'VD: Phở Hội An',
                  descEn: activeShop.name || 'e.g. Pho Hoi An',
                },
                {
                  key: 'show_order_code' as const,
                  labelVi: 'Mã đơn hàng',
                  labelEn: 'Order code',
                  descVi: 'VD: #OD-204',
                  descEn: 'e.g. #OD-204',
                },
                {
                  key: 'show_table_label' as const,
                  labelVi: 'Tên bàn / Khu vực',
                  labelEn: 'Table / Area label',
                  descVi: 'VD: Bàn 04 (Tầng 1)',
                  descEn: 'e.g. Table 04 (Floor 1)',
                },
                {
                  key: 'show_item_name' as const,
                  labelVi: 'Tên món',
                  labelEn: 'Item name',
                  descVi: 'VD: Trà sữa Ô long nướng',
                  descEn: 'e.g. Roasted Oolong Milk Tea',
                },
                {
                  key: 'show_item_options' as const,
                  labelVi: 'Tùy chọn & Topping',
                  labelEn: 'Item options & toppings',
                  descVi: 'Size L, 50% Đường, 70% Đá...',
                  descEn: 'Size L, 50% Sugar, Less Ice...',
                },
                {
                  key: 'show_item_note' as const,
                  labelVi: 'Ghi chú từng món',
                  labelEn: 'Item note',
                  descVi: 'Ghi chú riêng cho món này',
                  descEn: 'Special prep instructions for item',
                },
                {
                  key: 'show_order_note' as const,
                  labelVi: 'Ghi chú toàn đơn',
                  labelEn: 'Order note',
                  descVi: 'Ghi chú tổng thể từ khách',
                  descEn: 'Customer order-level note',
                },
                {
                  key: 'show_sequence_counter' as const,
                  labelVi: 'Số thứ tự tem (Sequence)',
                  labelEn: 'Sequence counter',
                  descVi: 'VD: [1/3], [2/3], [3/3]',
                  descEn: 'e.g. [1/3], [2/3], [3/3]',
                },
                {
                  key: 'show_timestamp' as const,
                  labelVi: 'Thời gian đặt hàng',
                  labelEn: 'Order timestamp',
                  descVi: 'VD: 10:45 24/10',
                  descEn: 'e.g. 10:45 24/10',
                },
                {
                  key: 'show_price' as const,
                  labelVi: 'Đơn giá món',
                  labelEn: 'Item price',
                  descVi: 'VD: 45.000đ',
                  descEn: 'e.g. 45,000đ',
                },
                {
                  key: 'show_payment_qr' as const,
                  labelVi: 'Mã QR thanh toán',
                  labelEn: 'Payment QR',
                  descVi: 'In mã QR thu tiền nhanh',
                  descEn: 'Print payment QR on slip/label',
                },
              ].map((item) => {
                const isChecked = Boolean(draft[item.key]);
                const fieldId = `${baseId}-toggle-${item.key}`;

                return (
                  <label
                    key={item.key}
                    htmlFor={fieldId}
                    className={`flex items-start gap-2.5 rounded-2xl border p-2.5 cursor-pointer transition select-none ${
                      isChecked
                        ? 'border-emerald-300 bg-emerald-50/40 text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      id={fieldId}
                      type="checkbox"
                      data-testid={`label-toggle-${item.key}`}
                      disabled={!canEdit || saving}
                      checked={isChecked}
                      onChange={(e) =>
                        handleToggleDisplayField(item.key, e.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="block text-xs font-bold leading-tight">
                        {isEn ? item.labelEn : item.labelVi}
                      </span>
                      <span className="block text-[10px] text-slate-500 truncate mt-0.5">
                        {isEn ? item.descEn : item.descVi}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 5. Custom Footer (VI & EN) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black text-slate-800">
                {tx(
                  '5. Lời nhắn chân tem tùy chỉnh (Custom footer):',
                  '5. Custom footer message:'
                )}
              </label>
              <span className="text-[11px] text-slate-500">
                {tx('Tối đa 120 ký tự', 'Max 120 chars')}
              </span>
            </div>

            <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor={`${baseId}-footer-vi`}
                    className="text-[11px] font-bold text-slate-700"
                  >
                    🇻🇳 {tx('Tiếng Việt:', 'Vietnamese text:')}
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {(draft.custom_footer_i18n?.vi || '').length}/{MAX_LABEL_FOOTER_LENGTH}
                  </span>
                </div>
                <input
                  id={`${baseId}-footer-vi`}
                  type="text"
                  data-testid="label-footer-vi-input"
                  disabled={!canEdit || saving}
                  maxLength={MAX_LABEL_FOOTER_LENGTH}
                  value={draft.custom_footer_i18n?.vi || ''}
                  onKeyDown={preventEnter}
                  onChange={(e) => handleFooterChange('vi', e.target.value)}
                  placeholder={tx(
                    'VD: Chúc bạn thưởng thức ngon miệng! Wifi: PhoHoiAn_5G',
                    'e.g. Chúc bạn thưởng thức ngon miệng! Wifi: PhoHoiAn_5G'
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor={`${baseId}-footer-en`}
                    className="text-[11px] font-bold text-slate-700"
                  >
                    🇬🇧 {tx('Tiếng Anh (English):', 'English text:')}
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">
                    {(draft.custom_footer_i18n?.en || '').length}/{MAX_LABEL_FOOTER_LENGTH}
                  </span>
                </div>
                <input
                  id={`${baseId}-footer-en`}
                  type="text"
                  data-testid="label-footer-en-input"
                  disabled={!canEdit || saving}
                  maxLength={MAX_LABEL_FOOTER_LENGTH}
                  value={draft.custom_footer_i18n?.en || ''}
                  onKeyDown={preventEnter}
                  onChange={(e) => handleFooterChange('en', e.target.value)}
                  placeholder={tx(
                    'e.g. Enjoy your meal! Wi-Fi: PhoHoiAn_5G',
                    'e.g. Enjoy your meal! Wi-Fi: PhoHoiAn_5G'
                  )}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: 5 Columns Live Compact Preview */}
        <div className="lg:col-span-5 sticky top-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <h3 className="text-xs font-black text-slate-800">
                {tx('Xem trước tem in trực tiếp', 'Live compact preview')}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-700">
                {currentPresetSpec.height_mm !== null
                  ? `${currentPresetSpec.width_mm}×${currentPresetSpec.height_mm}mm`
                  : `${currentPresetSpec.width_mm}mm (K${currentPresetSpec.width_mm})`}
              </span>
            </div>
          </div>

          {/* Paper Dimensions Banner */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-[11px] text-slate-600 flex items-center justify-between">
            <span className="font-bold text-slate-800">
              {currentPresetSpec.is_sticker
                ? tx('Kích thước decal:', 'Sticker size:')
                : tx('Khổ giấy cuộn:', 'Roll slip width:')}
            </span>
            <span className="font-mono font-black text-emerald-700">
              {currentPresetSpec.height_mm !== null
                ? `${currentPresetSpec.width_mm}mm × ${currentPresetSpec.height_mm}mm`
                : `${currentPresetSpec.width_mm}mm (Continuous)`}
            </span>
          </div>

          {/* Simulated Printed Label / Ticket */}
          <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-100/90 border border-slate-200/80">
            <div
              data-testid="label-print-live-preview"
              className={`w-full max-w-[340px] bg-white text-slate-900 shadow-md transition-all duration-200 ${
                currentPresetSpec.is_sticker
                  ? currentPresetSpec.id === 'cup_sticker_50x30'
                    ? 'rounded-xl p-3.5 border border-dashed border-slate-300'
                    : 'rounded-lg p-3 border border-dashed border-slate-300'
                  : 'rounded-none border-x border-slate-300 border-t-2 border-b-2 border-t-slate-400 border-b-slate-400 p-4 font-mono'
              } ${!draft.enabled ? 'opacity-70' : ''}`}
            >
              {!draft.enabled && (
                <div className="mb-2 text-center">
                  <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                    {tx('Tem đang tắt — Đây là bản xem mẫu', 'Labels disabled — Sample preview')}
                  </span>
                </div>
              )}

              {/* Header Info */}
              <div className="space-y-1 pb-2 border-b border-dashed border-slate-300">
                {draft.show_shop_name && (
                  <div className="text-center font-black text-xs uppercase tracking-tight text-slate-900 truncate">
                    {activeShop.name || 'QUÁN QLAOK'}
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
                  {draft.show_order_code && (
                    <span className="font-mono">#OD-204</span>
                  )}
                  {draft.show_table_label && (
                    <span className="truncate">
                      {tx('Bàn 04', 'Table 04')}
                    </span>
                  )}
                  {draft.show_sequence_counter && (
                    <span className="font-mono text-emerald-700 bg-emerald-50 px-1 rounded">
                      [1/{draft.split_mode === 'per_line_item' ? '1' : '3'}]
                    </span>
                  )}
                </div>

                {draft.show_timestamp && (
                  <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between">
                    <span>{tx('Giờ đặt:', 'Time:')} 10:45</span>
                    <span>24/10/2026</span>
                  </div>
                )}
              </div>

              {/* Items Section */}
              <div className="py-2.5 space-y-2">
                {/* Item 1 */}
                <div className="space-y-0.5">
                  <div className="flex items-start justify-between gap-1 text-xs font-black text-slate-900 leading-snug">
                    {draft.show_item_name && (
                      <span className="flex-1">
                        {draft.split_mode === 'per_line_item' ? '3x ' : ''}
                        {tx('Trà sữa Ô long nướng', 'Roasted Oolong Milk Tea')}
                      </span>
                    )}
                    {draft.show_price && (
                      <span className="font-mono text-emerald-800 text-[11px] shrink-0">
                        {draft.split_mode === 'per_line_item'
                          ? '135.000đ'
                          : '45.000đ'}
                      </span>
                    )}
                  </div>

                  {draft.show_item_options && (
                    <div className="text-[10px] text-slate-600 pl-1 leading-tight space-y-0.5">
                      <div>+ Size L, 50% Đường, 70% Đá</div>
                      <div>+ Trân châu hoàng kim (+10k)</div>
                    </div>
                  )}

                  {draft.show_item_note && (
                    <div className="text-[10px] italic text-amber-900 font-medium pl-1 bg-amber-50/60 rounded px-1 py-0.5 mt-0.5">
                      * {tx('Ghi chú: Ít đá, giao tại bàn', 'Note: Less ice, table serve')}
                    </div>
                  )}
                </div>

                {/* If single ticket mode, show item 2 grouped */}
                {draft.split_mode === 'single_ticket' && (
                  <div className="pt-1.5 border-t border-dotted border-slate-200 space-y-0.5">
                    <div className="flex items-start justify-between gap-1 text-xs font-black text-slate-900 leading-snug">
                      {draft.show_item_name && (
                        <span className="flex-1">
                          1x {tx('Trà đào cam sả', 'Peach Lemongrass Tea')}
                        </span>
                      )}
                      {draft.show_price && (
                        <span className="font-mono text-emerald-800 text-[11px] shrink-0">
                          39.000đ
                        </span>
                      )}
                    </div>
                    {draft.show_item_options && (
                      <div className="text-[10px] text-slate-600 pl-1">
                        + Size M, 100% Đá
                      </div>
                    )}
                  </div>
                )}

                {draft.show_order_note && (
                  <div className="pt-1 border-t border-dotted border-slate-200 text-[10px] text-slate-600 italic">
                    {tx('Ghi chú đơn: Khách mang bình giữ nhiệt', 'Order note: Bring own thermos')}
                  </div>
                )}
              </div>

              {/* Payment QR on slip/label if enabled */}
              {draft.show_payment_qr && (
                <div className="pt-2 border-t border-dashed border-slate-300 flex items-center justify-center gap-2">
                  <div className="h-10 w-10 border border-slate-400 bg-slate-50 flex items-center justify-center rounded">
                    <QrCode className="h-7 w-7 text-slate-800" aria-hidden="true" />
                  </div>
                  <div className="text-[9px] text-slate-600 leading-tight">
                    <div className="font-bold text-slate-900">
                      {tx('Quét VietQR', 'VietQR Scan')}
                    </div>
                    <div>{tx('Thanh toán đơn', 'Pay for order')}</div>
                  </div>
                </div>
              )}

              {/* Footer */}
              {currentFooterText && (
                <div className="pt-2 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-600 italic leading-tight">
                  {currentFooterText}
                </div>
              )}
            </div>
          </div>

          <div className="text-center text-[11px] text-slate-500">
            {tx(
              'Bản xem trước cập nhật tức thì theo kích thước giấy và các trường đã chọn.',
              'Preview updates in real-time as you tweak size and options.'
            )}
          </div>
        </div>
      </div>

      {/* Action Footer: Reset / Revert / Save Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="label-reset-default-button"
            disabled={!canEdit || saving}
            onClick={handleResetToDefault}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>{tx('Khôi phục mặc định', 'Reset to defaults')}</span>
          </button>

          {hasUnsavedChanges && (
            <button
              type="button"
              data-testid="label-revert-button"
              disabled={!canEdit || saving}
              onClick={handleRevertChanges}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <span>{tx('Hoàn tác thay đổi', 'Revert changes')}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {hasUnsavedChanges && (
            <span className="text-[11px] font-bold text-amber-700">
              {tx('● Có thay đổi chưa lưu', '● Unsaved changes')}
            </span>
          )}

          <button
            type="button"
            data-testid="label-save-button"
            disabled={!canEdit || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{tx('Đang lưu cấu hình...', 'Saving settings...')}</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>{tx('Lưu cấu hình in tem', 'Save label settings')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
