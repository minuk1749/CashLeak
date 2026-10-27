'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { kstDate, type EmailMessage, type Transaction } from '@cashleak/engine';
import { useData } from '@/lib/data-context';
import { mailboxLabel, txLabel, type SubscriptionView } from '@/lib/view';
import type { SubscriptionEdit } from '@/lib/store/types';
import { CYCLE_LABEL, dday, formatDate, signedWon } from '@/lib/format';
import { Avatar, Badge, Button, buttonClass, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { PathFlow, PathLine } from '@/components/path';
import { SubscriptionForm, type FormValues } from '@/components/subscription-form';

const CONFIDENCE_TEXT = {
  높음: '반복 주기, 금액, 서비스 이름이나 메일 영수증이 서로 맞아요.',
  보통: '반복되는 건 확인했지만 근거가 아직 적어요.',
  낮음: '우연히 같은 금액이 반복됐을 수 있어요.',
} as const;

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default function SubscriptionPage() {
  const params = useParams<{ uid: string }>();
  const router = useRouter();
  const data = useData();
  const { status, views, result, snapshot, today } = data;
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);

  if (status === 'loading') return <Loading />;
  const v = views.find((x) => x.uid === params.uid || x.uid === safeDecode(params.uid));
  if (!v) {
    return (
      <>
        <PageHeader title="구독" back="/" />
        <div className="px-4">
          <Card>
            <p className="text-sub">이 구독을 찾을 수 없어요. 내역을 지웠거나 다시 올리면서 바뀌었을 수 있어요.</p>
            <Link href="/" className={buttonClass('secondary', 'mt-4 w-full')}>
              목록으로
            </Link>
          </Card>
        </div>
      </>
    );
  }

  const edit = snapshot.edits[v.uid];
  const ledger = new Map<string, Transaction>((result?.ledger ?? []).map((t) => [t.id, t]));
  const raw = new Map<string, Transaction>(snapshot.transactions.map((t) => [t.id, t]));
  const txs = (v.detected?.transactionIds ?? []).map((id) => ledger.get(id) ?? raw.get(id)).filter((t): t is Transaction => Boolean(t));
  const mails = new Map<string, EmailMessage>(snapshot.emails.map((m) => [m.id, m]));
  const emails = (v.detected?.emailIds ?? []).map((id) => mails.get(id)).filter((m): m is EmailMessage => Boolean(m));
  const linkedOf = (t: Transaction) => (t.linkedIds ?? []).map((id) => raw.get(id)).filter((r): r is Transaction => Boolean(r));

  const act = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patch = (p: Partial<SubscriptionEdit>) => act(() => data.saveEdit(v.uid, { ...edit, ...p, updatedAt: new Date().toISOString() }));

  const saveForm = async (values: FormValues) => {
    if (v.manual) {
      await data.saveManual({ ...v.manual, ...values, memo: values.memo || undefined });
    } else {
      const d = v.detected!;
      const next: SubscriptionEdit = { ...edit, updatedAt: new Date().toISOString() };
      next.name = values.name !== d.name ? values.name : undefined;
      next.amount = values.amount !== d.amount ? values.amount : undefined;
      next.cycle = values.cycle !== d.cycle ? values.cycle : undefined;
      next.nextPaymentDate = values.nextPaymentDate && values.nextPaymentDate !== d.nextPaymentDate ? values.nextPaymentDate : undefined;
      next.memo = values.memo || undefined;
      const meaningful = Object.entries(next).some(([k, val]) => k !== 'updatedAt' && val !== undefined);
      await data.saveEdit(v.uid, meaningful ? JSON.parse(JSON.stringify(next)) : null);
    }
    setEditing(false);
  };

  const last = txs[txs.length - 1];
  const explanation = explainPath(v, last, last ? linkedOf(last) : []);

  return (
    <>
      <PageHeader title={v.name} back="/" />
      <div className="space-y-3 px-4">
        <Card>
          <div className="flex items-center gap-3">
            <Avatar name={v.name} muted={v.group === 'canceled' || v.group === 'hidden'} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{v.name}</p>
              <p className="text-sm text-sub">{v.category}</p>
            </div>
            <Badge tone={v.group === 'active' ? 'accent' : v.group === 'review' ? 'warn' : 'muted'}>{v.statusLabel}</Badge>
          </div>
          <p className="num mt-4 text-2xl font-bold">{v.amountLabel}</p>
          <p className="text-sm text-sub">{CYCLE_LABEL[v.cycle]} 결제</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
            <div>
              <dt className="text-faint">다음 결제일</dt>
              <dd className="mt-0.5 font-semibold">
                {v.nextPaymentDate ? (
                  <>
                    {formatDate(v.nextPaymentDate)}
                    <span className={`ml-1 font-normal ${v.nextPaymentDate < today ? 'text-warn' : 'text-accent'}`}>{dday(v.nextPaymentDate, today)}</span>
                  </>
                ) : (
                  '-'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-faint">마지막 결제</dt>
              <dd className="mt-0.5">{v.lastPaymentDate ? formatDate(v.lastPaymentDate) : '-'}</dd>
            </div>
          </dl>
          {v.memo && <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm">메모: {v.memo}</p>}
        </Card>

        {v.group === 'review' && (
          <Card className="ring-1 ring-warn/30">
            <p className="font-semibold">정기 결제가 맞나요?</p>
            <p className="mt-1 text-sm text-sub">{CONFIDENCE_TEXT.낮음} 알려 주시면 목록을 정리할게요.</p>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" onClick={() => patch({ status: 'active', hidden: undefined })}>
                구독 맞아요
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => patch({ hidden: true })}>
                아니에요
              </Button>
            </div>
          </Card>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        {v.path.length > 0 && (
          <Card>
            <h2 className="font-semibold">돈이 나가는 경로</h2>
            <div className="mt-3">
              <PathFlow path={v.path} end={v.name} />
            </div>
            {explanation && <p className="mt-3 text-sm leading-relaxed text-sub">{explanation}</p>}
          </Card>
        )}

        {v.detected && (
          <Card>
            <h2 className="font-semibold">이렇게 찾았어요</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {v.evidence.map((e) => (
                <Badge key={e}>{e}</Badge>
              ))}
            </div>
            <p className="mt-3 text-sm">
              <span className="font-medium">신뢰도 {v.confidenceLabel}</span>
              <span className="text-sub"> · {CONFIDENCE_TEXT[v.confidenceLabel!]}</span>
            </p>
            {v.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-sub">
                {v.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {txs.length > 0 && (
          <Card padded={false}>
            <h2 className="px-4 pt-4 font-semibold">결제 기록 {txs.length}건</h2>
            <ul className="mt-2 divide-y divide-line">
              {[...txs].reverse().map((t) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm">{formatDate(t.date)}</span>
                    <span className="num text-sm font-semibold">{signedWon(t.amount, t.direction)}</span>
                  </div>
                  <PathLine path={t.path ?? [txLabel(t)]} className="mt-0.5" />
                  <p className="mt-0.5 text-xs text-faint">
                    {[t, ...linkedOf(t)].map((r) => `${txLabel(r)}: ${r.merchant}`).join(' / ')}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {emails.length > 0 && (
          <Card padded={false}>
            <h2 className="px-4 pt-4 font-semibold">메일 {emails.length}통</h2>
            <ul className="mt-2 divide-y divide-line">
              {emails.map((m) => (
                <li key={m.id} className="px-4 py-3 text-sm">
                  <p className="truncate">{m.subject}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {formatDate(kstDate(m.date))} · {mailboxLabel(m)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          {editing ? (
            <>
              <h2 className="mb-3 font-semibold">직접 고치기</h2>
              <SubscriptionForm
                initial={{ name: v.name, amount: v.amount, cycle: v.cycle, nextPaymentDate: v.nextPaymentDate, paymentPath: v.path, memo: v.memo }}
                submitLabel="저장"
                showPath={Boolean(v.manual)}
                onSubmit={saveForm}
              />
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setEditing(false)}>
                취소
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                이름·금액·결제일 고치기
              </Button>
              {v.group !== 'canceled' && v.group !== 'hidden' && (
                <Button variant="secondary" onClick={() => patch({ status: 'canceled' })}>
                  해지했어요
                </Button>
              )}
              {edit?.status === 'canceled' && (
                <Button variant="secondary" onClick={() => patch({ status: undefined })}>
                  해지 표시 취소
                </Button>
              )}
              {v.group === 'hidden' ? (
                <Button variant="secondary" onClick={() => patch({ hidden: undefined })}>
                  목록에 다시 보이기
                </Button>
              ) : (
                !v.manual && (
                  <Button variant="ghost" onClick={() => patch({ hidden: true })}>
                    구독이 아니에요 (목록에서 숨기기)
                  </Button>
                )
              )}
              {v.edited && !v.manual && (
                <Button variant="ghost" onClick={() => act(() => data.saveEdit(v.uid, null))}>
                  고친 내용 모두 되돌리기
                </Button>
              )}
              {v.manual && (
                <Button
                  variant="danger"
                  onClick={() =>
                    act(async () => {
                      if (!confirm(`${v.name}을(를) 지울까요?`)) return;
                      await data.removeManual(v.manual!.id);
                      await data.saveEdit(v.uid, null);
                      router.push('/');
                    })
                  }
                >
                  지우기
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** 경로를 어떻게 알아냈는지 한 문장으로 */
function explainPath(v: SubscriptionView, last: Transaction | undefined, linked: Transaction[]): string | undefined {
  if (!last) return undefined;
  if (linked.length) {
    const from = linked.map((r) => `${txLabel(r)}의 ‘${r.merchant}’ ${r.direction === 'out' ? '출금' : '입금'}`).join(', ');
    return `${from}과 ${txLabel(last)}의 ‘${last.merchant}’ 결제를 같은 결제로 맞춰서 찾았어요.`;
  }
  const money = v.path.find((hop) => hop.endsWith(' 머니'));
  if (money) {
    return v.path[0] !== money
      ? `${money}로 냈어요. 머니는 ${v.path[0]}에서 충전했어요 (충전 기록 기준).`
      : `${money}로 냈어요. 충전한 계좌는 통장 내역을 함께 올리면 알 수 있어요.`;
  }
  if (v.path.length > 1 && last.merchant !== v.name) {
    const how = v.detected?.emailIds.length ? '금액·날짜가 맞는 메일 영수증으로' : '가맹점 이름으로';
    return `${txLabel(last)} 내역에는 ‘${last.merchant}’(으)로 찍혀요. ${how} ${v.name}인 것을 확인했어요.`;
  }
  return undefined;
}
