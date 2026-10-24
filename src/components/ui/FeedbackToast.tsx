'use client';

import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface FeedbackToastMessage {
  kind: 'success' | 'error';
  message: string;
}

interface FeedbackToastProps {
  feedback: FeedbackToastMessage | null;
  dismissLabel: string;
  onDismiss: () => void;
}

export function FeedbackToast({
  feedback,
  dismissLabel,
  onDismiss,
}: FeedbackToastProps) {
  useEffect(() => {
    if (!feedback) return;
    const timeout = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timeout);
  }, [feedback, onDismiss]);

  if (!feedback) return null;

  const isError = feedback.kind === 'error';

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[120] sm:inset-x-auto sm:right-6 sm:max-w-sm">
      <div
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl ${
          isError
            ? 'border-rose-200 bg-rose-50 text-rose-900'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}
      >
        {isError ? (
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        )}
        <span className="min-w-0 flex-1">{feedback.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="-mr-1 -mt-1 rounded-lg p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
