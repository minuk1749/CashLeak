import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DetectionResult, Subscription } from '@cashleak/engine';
import { buildViews, monthlyAmount, rollForward, subscriptionUid } from './view.ts';
import { emptySnapshot, type Snapshot } from './store/types.ts';

function sub(extra: Partial<Subscription>): Subscription {
  return {
    id: 'sub1',
    key: 'melon',
    serviceId: 'melon',
    name: '멜론',
    category: '음악',
    paymentPath: ['농협은행 계좌', '카카오페이'],
    kind: 'subscription',
    status: 'active',
    cycle: 'monthly',
    amount: 10900,
    amountVaries: false,
    lastPaymentDate: '2026-10-16',
    nextPaymentDate: '2026-11-16',
    confidence: 0.9,
    confidenceLabel: '높음',
    sources: ['bank', 'pay'],
    transactionIds: ['t1'],
    emailIds: [],
    notes: [],
    ...extra,
  };
}

const result = (subscriptions: Subscription[]): DetectionResult => ({
  asOf: '2026-10-26',
  subscriptions,
  recurringTransfers: [],
  excluded: [],
  ledger: [],
  internal: [],
  stats: { transactions: 0, mergedTransactions: 0, topups: 0, emails: 0, receipts: 0, duplicateReceipts: 0 },
});

test('사용자가 고친 내용이 탐지 결과보다 앞선다', () => {
  const snapshot: Snapshot = {
    ...emptySnapshot(),
    edits: {
      melon: { amount: 11900, memo: '가족', updatedAt: 'x' },
      'm:블루클럽': { hidden: true, updatedAt: 'x' },
      'via:kakaopay': { status: 'active', updatedAt: 'x' },
    },
  };
  const views = buildViews(
    snapshot,
    result([
      sub({}),
      sub({ id: 'sub2', key: 'm:블루클럽', serviceId: undefined, name: '블루클럽', confidenceLabel: '낮음' }),
      sub({ id: 'sub3', key: 'via:kakaopay', serviceId: undefined, name: '카카오페이', confidenceLabel: '낮음' }),
      sub({ id: 'sub4', key: 'm:핏앤짐', serviceId: undefined, name: '핏앤짐', confidenceLabel: '낮음' }),
      sub({ id: 'sub5', key: 'disney-plus', name: '디즈니+', status: 'canceled', nextPaymentDate: undefined }),
    ]),
    '2026-10-27',
  );
  const by = (uid: string) => views.find((v) => v.uid === uid)!;
  assert.equal(by('melon').amountLabel, '11,900원');
  assert.equal(by('melon').memo, '가족');
  assert.equal(by('m:블루클럽').group, 'hidden');
  assert.equal(by('via:kakaopay').group, 'active', '확인 필요 항목을 구독이 맞다고 하면 이용 중으로 옮긴다');
  assert.equal(by('m:핏앤짐').group, 'review');
  assert.equal(by('disney-plus').group, 'canceled');
  assert.deepEqual(views.map((v) => v.group), ['active', 'active', 'review', 'canceled', 'hidden']);
});

test('키가 같은 구독이 둘이면 첫 거래로 구분한다', () => {
  const a = sub({ key: 'via:kakaopay', transactionIds: ['t1'] });
  const b = sub({ key: 'via:kakaopay', transactionIds: ['t9'], amount: 3900 });
  assert.deepEqual([subscriptionUid(a, [a, b]), subscriptionUid(b, [a, b])], ['via:kakaopay@t1', 'via:kakaopay@t9']);
  assert.equal(subscriptionUid(a, [a]), 'via:kakaopay');
});

test('직접 추가한 구독은 결제일이 지나면 주기만큼 넘기고, 연간 결제는 월 환산한다', () => {
  assert.equal(rollForward('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  assert.equal(rollForward('2026-10-27', 'monthly', '2026-10-27'), '2026-10-27');
  assert.equal(rollForward('2025-06-12', 'yearly', '2026-10-27'), '2027-06-12');
  const snapshot: Snapshot = {
    ...emptySnapshot(),
    manual: [{ id: 'm1', name: '헬스장', amount: 120000, cycle: 'yearly', nextPaymentDate: '2026-01-05', paymentPath: [], createdAt: 'x' }],
  };
  const [gym] = buildViews(snapshot, null, '2026-10-27');
  assert.equal(gym.nextPaymentDate, '2027-01-05');
  assert.equal(monthlyAmount(gym), 10000);
});
