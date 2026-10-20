import React from 'react';

export interface BrandLogoProps {
  className?: string;
  alt?: string;
  title?: string;
}

export function BrandLogo({
  className = 'h-9 w-9 rounded-xl',
  alt = '',
  title,
}: BrandLogoProps) {
  return (
    <img
      src="/brand/q-menu.svg"
      width={64}
      height={64}
      alt={alt}
      title={title}
      aria-hidden={alt ? undefined : true}
      className={`inline-block shrink-0 select-none object-contain ${className}`}
    />
  );
}
