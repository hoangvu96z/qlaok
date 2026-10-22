'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAppI18n } from '@/components/ui/AppI18nProvider';

export interface ConfirmDialogReasonOptions {
  label: string;
  placeholder?: string;
  /** When true the confirm button stays disabled until a non-empty reason is entered. */
  required?: boolean;
  defaultValue?: string;
  maxLength?: number;
}

export interface ConfirmDialogCheckboxOptions {
  label: string;
  description?: string;
  defaultChecked?: boolean;
}

export interface ConfirmDialogResult {
  reason: string;
  checked: boolean;
}

export interface ConfirmDialogOptions {
  title: string;
  description?: React.ReactNode;
  /** Extra content rendered between the description and the inputs (e.g. amount summary). */
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  reason?: ConfirmDialogReasonOptions;
  checkbox?: ConfirmDialogCheckboxOptions;
}

export interface ConfirmDialogProps extends ConfirmDialogOptions {
  open: boolean;
  /** Shows a spinner on the confirm button and blocks closing while true. */
  pending?: boolean;
  /** Optional inline error (e.g. server error after confirming). */
  error?: string | null;
  onConfirm: (result: ConfirmDialogResult) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Accessible confirmation dialog built on the native <dialog> element:
 * focus is trapped by `showModal()`, Esc closes (unless pending), focus is
 * restored to the previously focused element on close.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  reason,
  checkbox,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { tx } = useAppI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const titleId = useId();
  const descId = useId();
  const reasonId = useId();
  const checkboxId = useId();

  const [reasonText, setReasonText] = useState(reason?.defaultValue ?? '');
  const [checked, setChecked] = useState(Boolean(checkbox?.defaultChecked));

  // Reset inputs every time the dialog opens.
  useEffect(() => {
    if (open) {
      setReasonText(reason?.defaultValue ?? '');
      setChecked(Boolean(checkbox?.defaultChecked));
    }
    // Only reset on open transitions; option objects are recreated each render.
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current =
        typeof document !== 'undefined'
          ? (document.activeElement as HTMLElement | null)
          : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      requestAnimationFrame(() => {
        const target =
          reasonRef.current ||
          (variant === 'danger' ? cancelRef.current : confirmRef.current);
        target?.focus();
      });
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restore && typeof restore.focus === 'function' && restore.isConnected) {
        restore.focus();
      }
    }
  }, [open, variant]);

  // Native Esc handling: route through onCancel so React state stays the source of truth.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (!pendingRef.current) onCancelRef.current();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, []);

  const trimmedReason = reasonText.trim();
  const reasonMissing = Boolean(reason?.required) && trimmedReason.length === 0;
  const isDanger = variant === 'danger';

  const submit = () => {
    if (pending || reasonMissing) return;
    void onConfirm({ reason: trimmedReason, checked });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
      data-testid="confirm-dialog"
      onClick={(event) => {
        // Backdrop click (the click target is the <dialog> itself, outside the panel).
        if (event.target === dialogRef.current && !pending) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/70 backdrop:backdrop-blur-xs"
    >
      {open && (
        <form
          method="dialog"
          className="space-y-4 p-5 sm:p-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-start gap-3">
            {isDanger && (
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-600"
              >
                <AlertTriangle className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 space-y-1">
              <h2 id={titleId} className="text-base font-black text-slate-900">
                {title}
              </h2>
              {description && (
                <div id={descId} className="text-xs leading-relaxed text-slate-600">
                  {description}
                </div>
              )}
            </div>
          </div>

          {details && <div className="text-xs text-slate-700">{details}</div>}

          {reason && (
            <div className="space-y-1.5">
              <label htmlFor={reasonId} className="block text-xs font-bold text-slate-700">
                {reason.label}
                {reason.required && (
                  <span className="text-rose-600" aria-hidden="true">
                    {' '}*
                  </span>
                )}
              </label>
              <textarea
                id={reasonId}
                ref={reasonRef}
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder={reason.placeholder}
                maxLength={reason.maxLength ?? 500}
                required={reason.required}
                aria-required={reason.required || undefined}
                rows={3}
                disabled={pending}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
              />
            </div>
          )}

          {checkbox && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <input
                id={checkboxId}
                type="checkbox"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                disabled={pending}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
              />
              <label htmlFor={checkboxId} className="text-xs">
                <span className="block font-bold text-slate-800">{checkbox.label}</span>
                {checkbox.description && (
                  <span className="block text-slate-500">{checkbox.description}</span>
                )}
              </label>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {cancelLabel || tx('Hủy bỏ', 'Cancel')}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              disabled={pending || reasonMissing}
              aria-busy={pending || undefined}
              className={`inline-flex items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                isDanger
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{confirmLabel || tx('Xác nhận', 'Confirm')}</span>
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/**
 * Promise-based helper: `const ok = await confirm({...})` resolves with the
 * dialog result, or `null` when the user dismissed it.
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((value: ConfirmDialogResult | null) => void) | null>(
    null
  );

  const settle = useCallback((value: ConfirmDialogResult | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback(
    (next: ConfirmDialogOptions) =>
      new Promise<ConfirmDialogResult | null>((resolve) => {
        // Dismiss any previous pending prompt.
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        setOptions(next);
      }),
    []
  );

  useEffect(
    () => () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    },
    []
  );

  const dialog = (
    <ConfirmDialog
      {...(options || { title: '' })}
      open={Boolean(options)}
      onConfirm={(result) => settle(result)}
      onCancel={() => settle(null)}
    />
  );

  return { confirm, dialog };
}
