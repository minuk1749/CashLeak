'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TABS: { href: string; label: string; match: (path: string) => boolean; icon: ReactNode }[] = [
  {
    href: '/',
    label: '구독',
    match: (p) => p === '/' || p.startsWith('/subscriptions'),
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4m8-4v4" />
      </>
    ),
  },
  {
    href: '/payments',
    label: '결제 내역',
    match: (p) => p.startsWith('/payments'),
    icon: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
        <path d="M9 8h6m-6 4h6" />
      </>
    ),
  },
  {
    href: '/upload',
    label: '내역 올리기',
    match: (p) => p.startsWith('/upload'),
    icon: (
      <>
        <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" />
        <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
      </>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent' : 'text-faint'}`}
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {tab.icon}
                </svg>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
