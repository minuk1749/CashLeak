import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DataProvider } from '@/lib/data-context';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'CashLeak',
  description: '통장·카드·간편결제 거래내역으로 매달 나가는 구독을 찾아 결제일과 함께 정리합니다.',
  applicationName: 'CashLeak',
  appleWebApp: { capable: true, title: 'CashLeak', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1013' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <DataProvider>
          <AppShell>{children}</AppShell>
        </DataProvider>
      </body>
    </html>
  );
}
