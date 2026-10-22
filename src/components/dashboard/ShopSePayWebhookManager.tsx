'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';
import { getAuthHeaders } from '@/lib/auth-session';
import { useDashboard } from '@/lib/dashboard-context';
import { isShopOwnerMembership } from '@/lib/dashboard-nav';
import type { RedactedShopSePayConfig } from '@/lib/sepay-reconciliation';

/**
 * Owner-only SePay automatic VietQR order reconciliation configuration panel.
 * Rendered inside the Settings page <form>, so every button is type="button"
 * and Enter is intercepted to prevent submitting the outer settings form.
 */
export function ShopSePayWebhookManager() {
  const { activeShop, activeMembership } = useDashboard();
  const { tx } = useAppI18n();

  const [config, setConfig] = useState<RedactedShopSePayConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const isOwner = isShopOwnerMembership(activeMembership);
  const shopId = activeShop?.id ?? '';

  const loadConfig = useCallback(async () => {
    if (!shopId) return;
    const requestedShopId = shopId;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/shops?action=sepay_config&shopId=${encodeURIComponent(requestedShopId)}`,
        {
          headers: getAuthHeaders(),
          cache: 'no-store',
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        sepayConfig?: RedactedShopSePayConfig;
        error?: string;
      };
      if (requestedShopId !== shopId) return;
      if (!res.ok || !data.sepayConfig) {
        throw new Error(
          data.error ||
            tx(
              'Không thể tải cấu hình đối soát SePay.',
              'Could not load SePay reconciliation settings.'
            )
        );
      }
      setConfig(data.sepayConfig);
      setEnabledDraft(
        data.sepayConfig.hasSecret ? data.sepayConfig.savedEnabled : true
      );
    } catch (err) {
      if (requestedShopId !== shopId) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestedShopId === shopId) {
        setLoading(false);
      }
    }
  }, [shopId, tx]);

  useEffect(() => {
    setSecretInput('');
    setShowSecret(false);
    setErrorMsg(null);
    setNoticeMsg(null);
    if (isOwner && shopId) {
      void loadConfig();
    }
  }, [isOwner, shopId, loadConfig]);

  if (!activeShop || !isOwner) return null;

  const callbackUrl =
    config?.callbackUrl ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/sepay/${encodeURIComponent(activeShop.id)}`
      : `/api/webhooks/sepay/${encodeURIComponent(activeShop.id)}`);

  const handleCopyCallbackUrl = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSaveSePayConfig = async () => {
    if (!shopId || saving) return;
    const trimmedSecret = secretInput.trim();
    if (!config?.hasSecret && !trimmedSecret) {
      setErrorMsg(
        tx(
          'Vui lòng nhập khóa bí mật (Secret Key) HMAC từ SePay (tối thiểu 16 ký tự).',
          'Please enter your SePay HMAC Secret Key (at least 16 characters).'
        )
      );
      return;
    }
    if (trimmedSecret && trimmedSecret.length < 16) {
      setErrorMsg(
        tx(
          'Khóa bí mật SePay phải có tối thiểu 16 ký tự.',
          'SePay Secret Key must be at least 16 characters.'
        )
      );
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'upsert_sepay_config',
          shop_id: shopId,
          enabled: enabledDraft,
          ...(trimmedSecret ? { secret: trimmedSecret } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sepayConfig?: RedactedShopSePayConfig;
        error?: string;
      };
      if (!res.ok || !data.sepayConfig) {
        throw new Error(
          data.error ||
            tx(
              'Không thể lưu cấu hình SePay.',
              'Could not save SePay configuration.'
            )
        );
      }
      setConfig(data.sepayConfig);
      setEnabledDraft(data.sepayConfig.savedEnabled);
      setSecretInput('');
      setShowSecret(false);
      setNoticeMsg(
        tx(
          'Đã mã hóa và lưu cấu hình đối soát SePay cho quán.',
          'Encrypted and saved SePay reconciliation settings for this store.'
        )
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSePayConfig = async () => {
    if (!shopId || deleting || !config?.hasSecret) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        tx(
          'Xóa khóa bí mật SePay đã lưu và tắt đối soát tự động cho quán này?',
          'Remove the saved SePay secret and disable automatic reconciliation for this store?'
        )
      )
    ) {
      return;
    }

    setDeleting(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'delete_sepay_config',
          shop_id: shopId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sepayConfig?: RedactedShopSePayConfig;
        error?: string;
      };
      if (!res.ok || !data.sepayConfig) {
        throw new Error(
          data.error ||
            tx(
              'Không thể xóa cấu hình SePay.',
              'Could not remove SePay configuration.'
            )
        );
      }
      setConfig(data.sepayConfig);
      setEnabledDraft(false);
      setSecretInput('');
      setNoticeMsg(
        tx(
          'Đã xóa khóa bí mật SePay và tắt đối soát tự động.',
          'Removed SePay secret and disabled automatic reconciliation.'
        )
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      id="sepay-webhook-settings"
      data-testid="sepay-webhook-settings"
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-emerald-400">
            <Webhook className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">
              {tx(
                'Đối soát tự động VietQR qua SePay (Chỉ Chủ quán)',
                'Automatic VietQR Reconciliation via SePay (Owner only)'
              )}
            </h2>
            <p className="text-[11px] text-slate-500">
              {tx(
                'Tự động gạch nợ đơn VietQR khi ngân hàng báo có đúng số tiền và mã đơn. Độc lập hoàn toàn với trạng thái chế biến bếp.',
                'Automatically marks VietQR orders paid on exact bank transfer match. Strictly independent from kitchen fulfillment.'
              )}
            </p>
          </div>
        </div>

        <span
          data-testid="sepay-config-status-badge"
          className={`rounded-full px-3 py-1 text-[11px] font-black ${
            config?.isConfigured
              ? 'bg-emerald-100 text-emerald-800'
              : config?.hasSecret
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700'
          }`}
        >
          {loading
            ? tx('Đang kiểm tra...', 'Checking...')
            : config?.isConfigured
              ? tx('✓ Đang bật đối soát tự động', '✓ Auto-reconciliation active')
              : config?.hasSecret
                ? tx('Đã lưu khóa • Chưa kích hoạt đủ', 'Secret saved • Pending setup')
                : tx('Chưa cấu hình SePay', 'Not configured')}
        </span>
      </div>

      {config && !config.encryptionConfigured && (
        <div
          role="alert"
          data-testid="sepay-encryption-missing-warning"
          className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs font-bold text-amber-900"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
          <div>
            <p>
              {tx(
                'Máy chủ chưa cấu hình biến môi trường SEPAY_SECRET_ENCRYPTION_KEY (tối thiểu 32 ký tự).',
                'Server environment variable SEPAY_SECRET_ENCRYPTION_KEY (min 32 chars) is not configured.'
              )}
            </p>
            <p className="mt-0.5 text-[11px] font-normal text-amber-800">
              {tx(
                'Tính năng lưu khóa và nhận webhook SePay sẽ tự động khóa an toàn cho đến khi quản trị viên cấu hình khóa mã hóa trên máy chủ.',
                'Saving secrets and processing SePay webhooks remain safely disabled until the encryption key is set on the server.'
              )}
            </p>
          </div>
        </div>
      )}

      {config && !config.recipientAccountConfigured && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
          <span className="font-bold">
            {tx('Lưu ý tài khoản nhận:', 'Recipient account requirement:')}{' '}
          </span>
          {tx(
            'Hãy chọn chế độ "VietQR tự động" và nhập đúng Số tài khoản ngân hàng ở mục trên để SePay đối chiếu chính xác tài khoản nhận tiền.',
            'Select "Automatic VietQR" and configure your recipient bank account number above so SePay can verify the receiving account.'
          )}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700"
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {noticeMsg && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800"
        >
          ✓ {noticeMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-4">
          {/* Shop-scoped Webhook URL */}
          <div>
            <label
              htmlFor="sepay-callback-url-input"
              className="block text-xs font-bold text-slate-700 mb-1"
            >
              {tx(
                'Webhook Callback URL riêng của quán (dán vào SePay):',
                'Store-scoped Webhook Callback URL (paste in SePay):'
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="sepay-callback-url-input"
                type="text"
                readOnly
                value={callbackUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-bold text-slate-800"
              />
              <button
                type="button"
                onClick={handleCopyCallbackUrl}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{tx('Đã chép', 'Copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-600" />
                    <span>{tx('Sao chép URL', 'Copy URL')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Secret Input (Redacted once saved) */}
          <div>
            <label
              htmlFor="sepay-hmac-secret-input"
              className="block text-xs font-bold text-slate-700 mb-1"
            >
              {config?.hasSecret
                ? tx(
                    'Khóa bí mật HMAC (Đã mã hóa lưu trữ — chỉ nhập mới khi muốn đổi khóa):',
                    'HMAC Secret Key (Encrypted at rest — enter only to rotate key):'
                  )
                : tx(
                    'Khóa bí mật HMAC từ SePay (X-SePay-Signature Secret Key) *:',
                    'SePay HMAC Secret Key (X-SePay-Signature Secret Key) *:'
                  )}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id="sepay-hmac-secret-input"
                  data-testid="sepay-hmac-secret-input"
                  type={showSecret ? 'text' : 'password'}
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSaveSePayConfig();
                    }
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={
                    config?.hasSecret
                      ? tx(
                          '•••••••••••••••• (Để trống nếu giữ nguyên khóa hiện tại)',
                          '•••••••••••••••• (Leave blank to keep current secret)'
                        )
                      : tx(
                          'Nhập chuỗi Secret Key từ cấu hình Webhook SePay...',
                          'Enter Secret Key from SePay Webhook settings...'
                        )
                  }
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-10 py-2 text-xs font-mono text-slate-900"
                />
                <button
                  type="button"
                  aria-pressed={showSecret}
                  aria-label={
                    showSecret
                      ? tx('Ẩn khóa bí mật', 'Hide secret key')
                      : tx('Hiện khóa bí mật', 'Show secret key')
                  }
                  onClick={() => setShowSecret((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                >
                  {showSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {tx(
                'Khóa được mã hóa AES-256-GCM riêng biệt ở máy chủ, không bao giờ nằm trong theme_config hay trả ngược về trình duyệt.',
                'Encrypted at rest with AES-256-GCM on the server; never stored in theme_config or returned to the browser.'
              )}
            </p>
          </div>

          {/* Enable Toggle & Save Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label
              htmlFor="sepay-enabled-checkbox"
              className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-800"
            >
              <input
                id="sepay-enabled-checkbox"
                type="checkbox"
                checked={enabledDraft}
                onChange={(e) => setEnabledDraft(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                {tx(
                  'Cho phép tự động gạch nợ đơn VietQR qua webhook này',
                  'Enable automatic VietQR order reconciliation via this webhook'
                )}
              </span>
            </label>

            <div className="flex items-center gap-2">
              {config?.hasSecret && (
                <button
                  type="button"
                  disabled={deleting || saving}
                  onClick={handleDeleteSePayConfig}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span>{tx('Xóa khóa', 'Remove Secret')}</span>
                </button>
              )}

              <button
                type="button"
                data-testid="sepay-save-config-btn"
                disabled={saving || Boolean(config && !config.encryptionConfigured)}
                onClick={handleSaveSePayConfig}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span>
                  {saving
                    ? tx('Đang lưu...', 'Saving...')
                    : tx('Lưu cấu hình SePay', 'Save SePay Settings')}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Reconciliation Rules & Setup Summary */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs text-slate-700">
          <div className="flex items-center gap-1.5 font-black text-slate-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              {tx(
                'Quy tắc đối soát an toàn 6 lớp',
                '6-Layer Safe Reconciliation Rules'
              )}
            </span>
          </div>

          <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-600 list-disc pl-4">
            <li>
              {tx(
                'Xác thực chữ ký HMAC-SHA256 trên chuỗi "{timestamp}.{raw_body}" qua header X-SePay-Signature & X-SePay-Timestamp trước khi đọc JSON.',
                'Verifies HMAC-SHA256 over "{timestamp}.{raw_body}" via X-SePay-Signature & X-SePay-Timestamp before parsing JSON.'
              )}
            </li>
            <li>
              {tx(
                'Chỉ xử lý giao dịch tiền vào (transferType = "in") đúng Số tài khoản VietQR của quán.',
                'Only processes inbound transfers (transferType = "in") matching the store VietQR account number.'
              )}
            </li>
            <li>
              {tx(
                'Đối chiếu chính xác Tiền tố + Mã đơn (ví dụ: "{prefix} ORD-123"), đơn chọn VietQR, chưa thanh toán, chưa hủy và khớp đúng 100% số tiền VND.',
                'Matches exact Prefix + Order Code (e.g. "{prefix} ORD-123"), VietQR method, unpaid, non-cancelled, and exact VND amount.',
                { prefix: config?.transferPrefix || 'QLAOK' }
              )}
            </li>
            <li>
              {tx(
                'Chống trùng lặp (Idempotent) theo mã giao dịch SePay; chỉ cập nhật trạng thái thu tiền, không bao giờ tự chuyển hoàn tất món của bếp.',
                'Idempotent by SePay transaction ID; updates payment status only and never alters kitchen fulfillment status.'
              )}
            </li>
          </ul>

          {config?.updatedAt && (
            <p className="pt-1 border-t border-slate-200 text-[10px] text-slate-500">
              {tx('Cập nhật lần cuối:', 'Last updated:')}{' '}
              {new Date(config.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
