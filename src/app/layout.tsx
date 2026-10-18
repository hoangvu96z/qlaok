import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google';
import { AppI18nProvider } from '@/components/ui/AppI18nProvider';
import './globals.css';

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Qlaok (Quét là OK) – Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng',
  description:
    'Nền tảng tạo Menu, Bảng giá dịch vụ đa ngôn ngữ tự động bằng AI và trang đặt món QR cho Quán ăn, Tiệm Nail, Spa, Cửa hàng bán lẻ.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Qlaok',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#10b981',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      className={`${beVietnamPro.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className={`${beVietnamPro.className} min-h-screen bg-slate-50 font-sans text-slate-900 antialiased`}
      >
        <AppI18nProvider>{children}</AppI18nProvider>
      </body>
    </html>
  );
}
