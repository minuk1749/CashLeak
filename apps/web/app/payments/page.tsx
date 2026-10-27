'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Transaction } from '@cashleak/engine';
import { useData } from '@/lib/data-context';
import { txLabel, type SubscriptionView } from '@/lib/view';
import { formatDate, signedWon } from '@/lib/format';
import { Badge, buttonClass, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { PathLine } from '@/components/path';

type Filter = 'all' | 'pay' | 'subscription' | 'in';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pay', label: '간편결제' },
  { id: 'subscription', label: '구독' },
  { id: 'in', label: '입금' },
];

const PAY_NAMES = /카카오페이|네이버페이|토스페이|페이코/;
const PAGE = 60;

export default function PaymentsPage() {
  const { status, error, result, snapshot, views } = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [showInternal, setShowInternal] = useState(false);

  const raw = useMemo(() => new Map<string, Transaction>(snapshot.transactions.map((t) => [t.id, t])), [snapshot]);
  const subOf = useMemo(() => {
    const map = new Map<string, SubscriptionView>();
    for (const v of views) for (const id of v.detected?.transactionIds ?? []) map.set(id, v);
    return map;
  }, [views]);
  const excluded = useMemo(() => new Map((result?.excluded ?? []).map((e) => [e.merchant, e.reason])), [result]);

  if (status === 'loading') return <Loading />;
  if (status === 'error') return <div className="p-4"><ErrorBox>{error}</ErrorBox></div>;
  if (!result || result.ledger.length === 0) {
    return (
      <>
        <PageHeader title="결제 내역" />
        <div className="px-4">
          <Card>
            <p className="text-sub">아직 올린 거래내역이 없어요.</p>
            <Link href="/upload" className={buttonClass('primary', 'mt-4 w-full')}>
              거래내역 올리기
            </Link>
          </Card>
        </div>
      </>
    );
  }

  const ledger = [...result.ledger].reverse();
  const matches = (t: Transaction) => {
    if (filter === 'in') return t.direction === 'in';
    if (filter === 'subscription') return subOf.has(t.id);
    if (filter === 'pay') return t.source === 'pay' || (t.path ?? []).some((hop) => PAY_NAMES.test(hop));
    return true;
  };
  const list = ledger.filter(matches);
  const shown = list.slice(0, limit);
  const { stats } = result;

  return (
    <>
      <PageHeader title="결제 내역" />
      <div className="px-4">
        <Card>
          <p className="leading-relaxed">
            올린 거래 <b className="num">{stats.transactions.toLocaleString()}건</b>을 서로 맞춰 보니 실제 결제·입금은{' '}
            <b className="num">{result.ledger.length.toLocaleString()}건</b>이에요.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-sub">
            {stats.mergedTransactions > 0 && <li>· 두 내역에 같이 찍힌 결제 {stats.mergedTransactions}건을 하나로 합쳤어요. (예: 카카오페이 결제와 통장의 카카오페이 출금)</li>}
            {stats.topups > 0 && <li>· 페이 머니 충전 {stats.topups}건은 결제가 아니라 내 돈을 옮긴 것이라 뺐어요.</li>}
          </ul>
        </Card>

        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
              className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium ${filter === f.id ? 'bg-ink text-bg' : 'bg-card text-sub ring-1 ring-line'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Card padded={false} className="mt-3 divide-y divide-line">
          {shown.length === 0 && <p className="p-4 text-sm text-sub">해당하는 거래가 없어요.</p>}
          {shown.map((t, i) => {
            const month = t.date.slice(0, 7);
            const newMonth = i === 0 || shown[i - 1].date.slice(0, 7) !== month;
            const sub = subOf.get(t.id);
            const linked = (t.linkedIds ?? []).map((id) => raw.get(id)).filter((x): x is Transaction => Boolean(x));
            const expanded = open === t.id;
            return (
              <div key={t.id}>
                {newMonth && <p className="bg-bg px-4 py-1.5 text-xs font-semibold text-faint">{Number(month.slice(5))}월</p>}
                <button type="button" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-bg">
                  <span className="num w-9 shrink-0 pt-0.5 text-xs text-faint">{formatDate(t.date, { weekday: false }).replace(/^\d+월 /, '')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{t.merchant || '(내용 없음)'}</span>
                      {sub && <Badge tone="accent">구독</Badge>}
                      {excluded.has(t.merchant) && <Badge>{excluded.get(t.merchant)!.split(' ')[0]}</Badge>}
                    </span>
                    <PathLine path={t.path ?? [txLabel(t)]} className="mt-0.5" />
                  </span>
                  <span className={`num shrink-0 font-semibold ${t.direction === 'in' ? 'text-income' : ''}`}>{signedWon(t.amount, t.direction)}</span>
                </button>
                {expanded && <Details t={t} linked={linked} sub={sub} />}
              </div>
            );
          })}
        </Card>
        {list.length > limit && (
          <button type="button" onClick={() => setLimit(limit + PAGE)} className={buttonClass('secondary', 'mt-3 w-full')}>
            더 보기 ({list.length - limit}건 남음)
          </button>
        )}

        {result.internal.length > 0 && (
          <Card className="mt-6">
            <button type="button" onClick={() => setShowInternal(!showInternal)} aria-expanded={showInternal} className="flex w-full items-center justify-between text-left">
              <span className="font-semibold">페이 충전 (결제에서 뺀 거래)</span>
              <span className="text-sm text-faint">{showInternal ? '접기' : `${result.internal.length}건 보기`}</span>
            </button>
            {showInternal && (
              <ul className="mt-3 space-y-2 text-sm">
                {result.internal.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-sub">
                      {formatDate(t.date, { weekday: false })} · {txLabel(t)} · {t.merchant}
                    </span>
                    <span className="num shrink-0">{signedWon(t.amount, t.direction)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

function Details({ t, linked, sub }: { t: Transaction; linked: Transaction[]; sub?: SubscriptionView }) {
  const records = [t, ...linked];
  return (
    <div className="space-y-2 bg-bg/60 px-4 pb-4 pt-1 text-sm">
      <p className="text-xs font-semibold text-faint">{records.length > 1 ? `${records.length}개 내역에서 같은 결제로 확인` : '확인한 내역'}</p>
      <ul className="space-y-1.5">
        {records.map((r) => (
          <li key={r.id} className="rounded-lg bg-card px-3 py-2">
            <p className="font-medium">{txLabel(r)}</p>
            <p className="text-sub">
              {r.merchant} · {signedWon(r.amount, r.direction)}
              {r.time && ` · ${r.time.slice(0, 5)}`}
              {r.funding && ` · 결제수단 ${r.funding}`}
              {r.method && r.source !== 'pay' && ` · ${r.method}`}
            </p>
          </li>
        ))}
      </ul>
      {sub && (
        <Link href={`/subscriptions/${encodeURIComponent(sub.uid)}`} className="inline-block pt-1 font-medium text-accent">
          {sub.name} 구독 보기 →
        </Link>
      )}
    </div>
  );
}
