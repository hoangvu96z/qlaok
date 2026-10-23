import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { AppI18nProvider } from '@/components/ui/AppI18nProvider';
import './globals.css';

const beVietnamPro = localFont({
  src: [
    {
      path: './fonts/BeVietnamPro-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/BeVietnamPro-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/BeVietnamPro-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/BeVietnamPro-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: './fonts/BeVietnamPro-ExtraBold.woff2',
      weight: '800',
      style: 'normal',
    },
    {
      path: './fonts/BeVietnamPro-Black.woff2',
      weight: '900',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
  declarations: [{ prop: 'font-family', value: 'Be Vietnam Pro' }],
});

const jetbrainsMono = localFont({
  src: [
    {
      path: './fonts/JetBrainsMono-Variable.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  declarations: [{ prop: 'font-family', value: 'JetBrains Mono' }],
});

export const metadata: Metadata = {
  title: 'Qlaok (Quét là OK) – Menu, Bảng giá & Web Đa Ngôn Ngữ Cho Mọi Cửa Hàng',
  description:
    'Nền tảng tạo Menu, Bảng giá dịch vụ đa ngôn ngữ tự động bằng AI và trang đặt món QR cho Quán ăn, Tiệm Nail, Spa, Cửa hàng bán lẻ.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/brand/apple-touch-icon.png',
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
      data-theme="light"
      className={`light ${beVietnamPro.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className={`${beVietnamPro.className} min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased`}
      >
        <AppI18nProvider>{children}</AppI18nProvider>
      </body>
    </html>
  );
}
