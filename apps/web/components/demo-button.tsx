'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data-context';
import { Button, ErrorBox } from './ui';

/** 가상 사용자 데이터로 바꿔서 앱을 바로 둘러보게 한다. */
export function DemoButton({ variant = 'secondary', className = '' }: { variant?: 'primary' | 'secondary'; className?: string }) {
  const { loadDemo, snapshot } = useData();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function run() {
    if (snapshot.uploads.length && !confirm('지금 저장된 내역을 지우고 가상 데이터로 바꿀까요?')) return;
    setWorking(true);
    setError(undefined);
    try {
      await loadDemo();
      router.push('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={run} disabled={working} className={className}>
        {working ? '불러오는 중…' : '가상 데이터로 체험하기'}
      </Button>
      {error && <ErrorBox>{error}</ErrorBox>}
    </>
  );
}
