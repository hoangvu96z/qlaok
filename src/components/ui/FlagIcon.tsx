import React from 'react';
import { SupportedLocale } from '@/types/qlaok';
import { LOCALE_META } from '@/lib/i18n-helper';

interface FlagIconProps {
  locale: SupportedLocale;
  className?: string;
  title?: string;
}

export function FlagIcon({
  locale,
  className = 'h-4 w-5',
  title,
}: FlagIconProps) {
  const meta = LOCALE_META[locale] || LOCALE_META.vi;
  return (
    <img
      src={meta.flagSrc}
      alt={meta.label}
      title={title || meta.label}
      className={`inline-block shrink-0 rounded-[3px] object-cover shadow-2xs ring-1 ring-black/10 ${className}`}
    />
  );
}
