import React from 'react';
import type { Metadata } from 'next';
import { dbGetStorefrontBundle } from '@/lib/db';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await dbGetStorefrontBundle(slug);
  const shop = bundle?.shop;

  if (!shop) {
    return {
      title: 'Không tìm thấy cửa hàng | Qlaok',
      description: 'Thực đơn điện tử đa ngôn ngữ & trang thông tin cửa hàng Qlaok.',
    };
  }

  const title = `${shop.name} | Menu Đa Ngôn Ngữ Qlaok`;
  const description =
    shop.tagline_i18n.vi ||
    shop.description_i18n.vi ||
    'Quét mã QR xem menu 5 ngôn ngữ & thông tin cửa hàng';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: shop.cover_urls?.[0] ? [shop.cover_urls[0]] : [],
    },
  };
}

export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100/80 flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-slate-50 shadow-xl ring-1 ring-slate-200/70 flex flex-col relative">
        {children}
      </div>
    </div>
  );
}
