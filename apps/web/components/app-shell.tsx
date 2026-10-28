'use client';

import type { ReactNode } from 'react';
import { useData } from '@/lib/data-context';
import { BottomNav } from './bottom-nav';
import { LoginScreen } from './login-screen';

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useData();
  if (status === 'signed-out') return <LoginScreen />;
  return (
    <>
      <main className="mx-auto min-h-dvh max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav />
    </>
  );
}
