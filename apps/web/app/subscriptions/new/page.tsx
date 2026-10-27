'use client';

import { useRouter } from 'next/navigation';
import { useData } from '@/lib/data-context';
import { uuid } from '@/lib/ids';
import { Card, Loading, PageHeader } from '@/components/ui';
import { SubscriptionForm } from '@/components/subscription-form';

export default function NewSubscriptionPage() {
  const { status, today, saveManual } = useData();
  const router = useRouter();
  if (status === 'loading') return <Loading />;
  return (
    <>
      <PageHeader title="구독 직접 추가" back="/" />
      <div className="px-4">
        <p className="mb-3 px-1 text-sm leading-relaxed text-sub">
          올린 내역에 없는 결제(다른 카드, 현금, 가족 계정 등)를 직접 넣어요. 다음 결제일이 지나면 주기만큼 자동으로 넘어가요.
        </p>
        <Card>
          <SubscriptionForm
            initial={{ nextPaymentDate: today }}
            submitLabel="추가하기"
            onSubmit={async (values) => {
              await saveManual({ id: uuid(), ...values, memo: values.memo || undefined, createdAt: new Date().toISOString() });
              router.push('/');
            }}
          />
        </Card>
      </div>
    </>
  );
}
