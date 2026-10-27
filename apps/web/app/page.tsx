'use client';

import Link from 'next/link';
import { diffDays } from '@cashleak/engine';
import { useData } from '@/lib/data-context';
import { monthlyAmount, type SubscriptionView } from '@/lib/view';
import { formatDate, won } from '@/lib/format';
import { buttonClass, Card, ErrorBox, Loading, PageHeader, SectionTitle } from '@/components/ui';
import { SubscriptionRow } from '@/components/subscription-row';
import { DemoButton } from '@/components/demo-button';

export default function HomePage() {
  const { status, error, views, snapshot, today, mode } = useData();
  if (status === 'loading') return <Loading />;
  if (status === 'error') {
    return (
      <div className="p-4">
        <ErrorBox>내역을 불러오지 못했어요: {error}</ErrorBox>
      </div>
    );
  }
  if (snapshot.uploads.length === 0 && snapshot.manual.length === 0) return <Welcome mode={mode} />;

  const groups = {
    active: views.filter((v) => v.group === 'active'),
    review: views.filter((v) => v.group === 'review'),
    canceled: views.filter((v) => v.group === 'canceled'),
    hidden: views.filter((v) => v.group === 'hidden'),
  };
  const total = groups.active.reduce((sum, v) => sum + monthlyAmount(v), 0);
  const yearly = groups.active.filter((v) => v.cycle === 'yearly').length;
  const within = (days: number) =>
    groups.active.filter((v) => v.nextPaymentDate && diffDays(today, v.nextPaymentDate) >= 0 && diffDays(today, v.nextPaymentDate) < days);
  const sum = (list: SubscriptionView[]) => list.reduce((s, v) => s + (v.amount ?? 0), 0);
  const week = within(7);
  const month = within(30);

  const txUploads = snapshot.uploads.filter((u) => u.kind !== 'email' && u.firstDate && u.lastDate);
  const first = txUploads.map((u) => u.firstDate!).sort()[0];
  const last = txUploads.map((u) => u.lastDate!).sort().pop();
  const stale = last !== undefined && diffDays(last, today) > 7;

  return (
    <>
      <PageHeader
        title="CashLeak"
        right={<span className="text-xs text-faint">{mode === 'cloud' ? '내 계정에 저장' : '이 기기에만 저장'}</span>}
      />
      <div className="px-4">
        <Card>
          <p className="text-sm text-sub">매달 나가는 구독료</p>
          <p className="num mt-1 text-3xl font-bold tracking-tight">{won(total)}</p>
          <p className="mt-1 text-sm text-sub">
            이용 중 {groups.active.length}개{yearly > 0 && ` · 연간 결제 ${yearly}개는 12로 나눠 포함`}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
            <div>
              <p className="text-faint">7일 안에 결제</p>
              <p className="num mt-0.5 font-semibold">
                {week.length}건 · {won(sum(week))}
              </p>
            </div>
            <div>
              <p className="text-faint">30일 안에 결제</p>
              <p className="num mt-0.5 font-semibold">
                {month.length}건 · {won(sum(month))}
              </p>
            </div>
          </div>
        </Card>

        {groups.active.length > 0 && <List title="이용 중" items={groups.active} today={today} />}
        {groups.review.length > 0 && (
          <List title="구독인지 확인이 필요해요" items={groups.review} today={today} tone="warn" hint="반복 결제처럼 보이지만 확실하지 않아요. 눌러서 맞는지 알려 주세요." />
        )}
        {groups.canceled.length > 0 && <List title="해지했거나 해지로 보이는 결제" items={groups.canceled} today={today} tone="muted" />}
        {groups.hidden.length > 0 && <List title="구독 아님으로 숨긴 항목" items={groups.hidden} today={today} tone="muted" />}

        <div className="mt-6 flex gap-2">
          <Link href="/subscriptions/new" className={buttonClass('secondary', 'flex-1')}>
            직접 추가
          </Link>
          <Link href="/upload" className={buttonClass('secondary', 'flex-1')}>
            내역 더 올리기
          </Link>
        </div>

        {first && last && (
          <p className="mt-4 px-1 text-xs leading-relaxed text-faint">
            {formatDate(first, { year: true, weekday: false })} ~ {formatDate(last, { weekday: false })} 내역({snapshot.uploads.length}개 파일)으로 찾았어요.
            {stale && ' 마지막 내역 이후 결제는 반영되지 않았으니 최신 내역을 올려 주세요.'}
          </p>
        )}
      </div>
    </>
  );
}

function List({ title, items, today, tone, hint }: { title: string; items: SubscriptionView[]; today: string; tone?: 'warn' | 'muted'; hint?: string }) {
  return (
    <>
      <SectionTitle count={items.length} tone={tone}>
        {title}
      </SectionTitle>
      {hint && <p className="-mt-1 mb-2 px-1 text-xs text-faint">{hint}</p>}
      <Card padded={false} className="divide-y divide-line">
        {items.map((v) => (
          <SubscriptionRow key={v.uid} v={v} today={today} />
        ))}
      </Card>
    </>
  );
}

function Welcome({ mode }: { mode: 'local' | 'cloud' }) {
  return (
    <div className="flex min-h-[80dvh] flex-col justify-center px-6">
      <h1 className="text-2xl font-bold leading-snug">
        매달 새는 구독료,
        <br />
        내역만 올리면 찾아 드려요
      </h1>
      <p className="mt-3 leading-relaxed text-sub">
        통장·카드·카카오페이·네이버페이 거래내역 파일을 올리면 매달 나가는 결제를 찾아 다음 결제일과 함께 정리해요. 카카오페이로 낸 결제가 어느 계좌에서 나갔는지도 맞춰 봐요.
      </p>
      <div className="mt-8 flex flex-col gap-2">
        <Link href="/upload" className={buttonClass('primary')}>
          거래내역 올리기
        </Link>
        <DemoButton />
      </div>
      <p className="mt-6 text-xs leading-relaxed text-faint">
        {mode === 'cloud' ? '올린 내역은 내 계정에만 저장돼요.' : '올린 파일은 이 브라우저 안에서만 분석하고 저장해요. 서버로 보내지 않아요.'}
      </p>
    </div>
  );
}
