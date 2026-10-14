import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Qlaok CMS – Quản lý Menu, Bảng giá & Doanh thu Cửa hàng',
    short_name: 'Qlaok CMS',
    description:
      'Ứng dụng quản lý Menu 5 ngôn ngữ, bật/tắt hết món 1 chạm, quét thực đơn AI và thống kê lượt quét QR cho chủ quán.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#10b981',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
