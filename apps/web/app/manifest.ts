import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CashLeak',
    short_name: 'CashLeak',
    description: '거래내역으로 매달 나가는 구독을 찾아 정리합니다.',
    lang: 'ko',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f5f7',
    theme_color: '#f4f5f7',
    icons: [{ src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
