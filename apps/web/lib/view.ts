import {
  addMonths,
  addYears,
  formatSubscriptionAmount,
  type ConfidenceLabel,
  type Cycle,
  type DetectionResult,
  type EmailMessage,
  type Subscription,
  type Transaction,
} from '@cashleak/engine';
import type { ManualSubscription, Snapshot, SubscriptionEdit } from './store/types.ts';
import { won } from './format.ts';

/** active: 이용 중, review: 구독인지 확인 필요(신뢰도 낮음), canceled: 해지·해지 추정, hidden: 구독 아님으로 숨김 */
export type Group = 'active' | 'review' | 'canceled' | 'hidden';

export interface SubscriptionView {
  /** 화면 주소와 사용자 수정 내용의 키 */
  uid: string;
  name: string;
  category: string;
  amount?: number;
  amountLabel: string;
  cycle: Cycle;
  nextPaymentDate?: string;
  lastPaymentDate?: string;
  group: Group;
  statusLabel: string;
  confidenceLabel?: ConfidenceLabel;
  /** 돈이 나가는 경로 (서비스 이름 제외). 예: ['농협은행 계좌', '카카오페이'] */
  path: string[];
  /** 근거가 된 내역. 예: ['농협은행 통장', '카카오페이', 'Gmail'] */
  evidence: string[];
  notes: string[];
  memo?: string;
  edited: boolean;
  detected?: Subscription;
  manual?: ManualSubscription;
}

export function txLabel(t: Transaction): string {
  if (t.source === 'bank') return `${t.institution ?? '은행'} 통장`;
  if (t.source === 'card') return t.institution ?? '카드';
  return t.institution ?? '간편결제';
}

export const mailboxLabel = (m: Pick<EmailMessage, 'mailbox'>) => (m.mailbox === 'gmail' ? 'Gmail' : '네이버메일');

/** 같은 키의 구독이 여럿이면(예: 금액이 다른 카카오페이 정기결제 두 개) 첫 거래로 구분한다. */
export function subscriptionUid(sub: Subscription, all: Subscription[]): string {
  if (all.filter((s) => s.key === sub.key).length === 1) return sub.key;
  return `${sub.key}@${sub.transactionIds[0] ?? sub.emailIds[0] ?? sub.id}`;
}

/** 직접 넣은 다음 결제일이 지났으면 주기만큼 앞으로 민다. */
export function rollForward(start: string, cycle: Cycle, today: string): string {
  let date = start;
  for (let k = 1; date < today; k++) date = cycle === 'yearly' ? addYears(start, k) : addMonths(start, k);
  return date;
}

export const monthlyAmount = (v: Pick<SubscriptionView, 'amount' | 'cycle'>) =>
  v.amount === undefined ? 0 : v.cycle === 'yearly' ? v.amount / 12 : v.amount;

interface Lookup {
  ledger: Map<string, Transaction>;
  raw: Map<string, Transaction>;
  emails: Map<string, EmailMessage>;
}

function evidenceOf(sub: Subscription, lookup: Lookup): string[] {
  const labels = new Set<string>();
  for (const id of sub.transactionIds) {
    const t = lookup.ledger.get(id) ?? lookup.raw.get(id);
    if (!t) continue;
    labels.add(txLabel(t));
    for (const linked of t.linkedIds ?? []) {
      const r = lookup.raw.get(linked);
      if (r) labels.add(txLabel(r));
    }
  }
  for (const id of sub.emailIds) {
    const m = lookup.emails.get(id);
    if (m) labels.add(mailboxLabel(m));
  }
  return [...labels];
}

function detectedView(sub: Subscription, uid: string, edit: SubscriptionEdit | undefined, lookup: Lookup): SubscriptionView {
  let group: Group;
  if (edit?.hidden) group = 'hidden';
  else if ((edit?.status ?? (sub.status === 'active' ? 'active' : 'canceled')) === 'canceled') group = 'canceled';
  else if (!edit?.status && sub.confidenceLabel === '낮음') group = 'review';
  else group = 'active';

  const statusLabel = {
    active: '이용 중',
    review: '구독인지 확인 필요',
    canceled: edit?.status === 'canceled' ? '해지함' : sub.status === 'canceled' ? '해지 확인' : '해지 추정',
    hidden: '구독 아님',
  }[group];
  const amount = edit?.amount ?? sub.amount;
  const live = group === 'active' || group === 'review';
  return {
    uid,
    name: edit?.name ?? sub.name,
    category: sub.category,
    amount,
    amountLabel: edit?.amount !== undefined ? won(edit.amount) : formatSubscriptionAmount(sub),
    cycle: edit?.cycle ?? sub.cycle,
    nextPaymentDate: live ? (edit?.nextPaymentDate ?? sub.nextPaymentDate) : undefined,
    lastPaymentDate: sub.lastPaymentDate,
    group,
    statusLabel,
    confidenceLabel: sub.confidenceLabel,
    path: sub.paymentPath,
    evidence: evidenceOf(sub, lookup),
    notes: sub.notes,
    memo: edit?.memo,
    edited: Boolean(edit),
    detected: sub,
  };
}

function manualView(m: ManualSubscription, edit: SubscriptionEdit | undefined, today: string): SubscriptionView {
  const hidden = edit?.hidden;
  const canceled = edit?.status === 'canceled';
  return {
    uid: `manual:${m.id}`,
    name: m.name,
    category: '직접 추가',
    amount: m.amount,
    amountLabel: won(m.amount),
    cycle: m.cycle,
    nextPaymentDate: hidden || canceled ? undefined : rollForward(m.nextPaymentDate, m.cycle, today),
    group: hidden ? 'hidden' : canceled ? 'canceled' : 'active',
    statusLabel: hidden ? '숨김' : canceled ? '해지함' : '이용 중',
    path: m.paymentPath,
    evidence: ['직접 추가'],
    notes: [],
    memo: m.memo,
    edited: false,
    manual: m,
  };
}

const GROUP_ORDER: Record<Group, number> = { active: 0, review: 1, canceled: 2, hidden: 3 };

export function buildViews(snapshot: Snapshot, result: DetectionResult | null, today: string): SubscriptionView[] {
  const lookup: Lookup = {
    ledger: new Map((result?.ledger ?? []).map((t) => [t.id, t])),
    raw: new Map(snapshot.transactions.map((t) => [t.id, t])),
    emails: new Map(snapshot.emails.map((m) => [m.id, m])),
  };
  const subs = result?.subscriptions ?? [];
  const views = [
    ...subs.map((s) => {
      const uid = subscriptionUid(s, subs);
      return detectedView(s, uid, snapshot.edits[uid], lookup);
    }),
    ...snapshot.manual.map((m) => manualView(m, snapshot.edits[`manual:${m.id}`], today)),
  ];
  return views.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      (a.nextPaymentDate ?? '9999').localeCompare(b.nextPaymentDate ?? '9999') ||
      a.name.localeCompare(b.name, 'ko'),
  );
}
