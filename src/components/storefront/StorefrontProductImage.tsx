'use client';

import React, { useState } from 'react';
import { BusinessVertical } from '@/types/qlaok';

export function getVerticalDefaultEmoji(vertical: BusinessVertical): string {
  switch (vertical) {
    case 'fnb':
      return '🍜';
    case 'service':
      return '💆‍♀️';
    case 'retail':
    default:
      return '🛍️';
  }
}

export interface StorefrontProductImageProps {
  src?: string | null;
  alt: string;
  vertical: BusinessVertical;
  className?: string;
  emojiClassName?: string;
}

export function StorefrontProductImage({
  src,
  alt,
  vertical,
  className = 'h-full w-full object-cover',
  emojiClassName = 'flex h-full w-full items-center justify-center text-3xl',
}: StorefrontProductImageProps) {
  const [prevSrc, setPrevSrc] = useState(src);
  const [hasError, setHasError] = useState(false);

  if (src !== prevSrc) {
    setPrevSrc(src);
    setHasError(false);
  }

  const emoji = getVerticalDefaultEmoji(vertical);

  if (!src || (hasError && src === prevSrc)) {
    return (
      <div
        className={emojiClassName}
        role="img"
        aria-label={alt || emoji}
        data-testid="storefront-product-image-fallback"
      >
        {emoji}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
      data-testid="storefront-product-image"
    />
  );
}
