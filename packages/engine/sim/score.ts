// 탐지 결과를 가상 데이터의 정답과 비교해 채점한다.
import type { DetectionResult, Subscription } from '../src/types.ts';
import { diffDays } from '../src/dates.ts';
import type { SimData, TruthEntry } from './generator.ts';

export interface FieldError {
  key: string;
  field: 'amount' | 'cycle' | 'status' | 'nextDate' | 'path';
  expected: string;
  actual: string;
}

export interface SeedScore {
  seed: number;
  payHistories: boolean;
  truth: number;
  truePositives: { truth: TruthEntry; found: Subscription }[];
  misses: TruthEntry[]; // 찾을 수 있었는데 못 찾음
  undetectable: TruthEntry[]; // 데이터에 흔적이 부족해 원리상 못 찾음
  falsePositives: Subscription[];
  fieldErrors: FieldError[];
  shown: number; // 이용 중 + 신뢰도 보통 이상
  shownCorrect: number;
  /** 결제 경로를 채점한 구독 수 (거래내역으로 확인된 것만) */
  pathChecked: number;
  /** 간편결제 거래와 돈이 나온 통장·카드 거래를 짝지은 결과 */
  links: { expected: number; predicted: number; correct: number };
}

const amountText = (s: { amount?: number; foreignAmount?: number }) =>
  s.foreignAmount !== undefined ? `$${s.foreignAmount}` : String(s.amount);

function amountOk(t: TruthEntry, s: Subscription): boolean {
  return t.foreignAmount !== undefined ? Math.abs((s.foreignAmount ?? NaN) - t.foreignAmount) < 0.01 : s.amount === t.amount;
}

export function scoreResult(data: SimData, result: DetectionResult): SeedScore {
  const score: SeedScore = {
    seed: data.seed,
    payHistories: data.payHistories,
    truth: data.truth.length,
    truePositives: [],
    misses: [],
    undetectable: [],
    falsePositives: [],
    fieldErrors: [],
    shown: 0,
    shownCorrect: 0,
    pathChecked: 0,
    links: { expected: 0, predicted: 0, correct: 0 },
  };

  // 정답 하나에 결과 하나만 짝짓는다. 같은 키가 여럿이면 금액이 맞는 쪽을 고른다.
  const pool = [...result.subscriptions];
  for (const t of data.truth) {
    const candidates = pool.filter((s) => s.key === t.key);
    const found = candidates.find((s) => amountOk(t, s)) ?? candidates[0];
    if (!found) {
      (t.detectable ? score.misses : score.undetectable).push(t);
      continue;
    }
    pool.splice(pool.indexOf(found), 1);
    score.truePositives.push({ truth: t, found });
    const err = (field: FieldError['field'], expected: string, actual: string) =>
      score.fieldErrors.push({ key: t.key, field, expected, actual });
    if (!amountOk(t, found)) err('amount', amountText(t), amountText(found));
    if (found.cycle !== t.cycle) err('cycle', t.cycle, found.cycle);
    const activeOk = (found.status === 'active') === (t.status === 'active');
    if (!activeOk) err('status', t.status, found.status);
    if (activeOk && t.status === 'active') {
      const ok = found.nextPaymentDate && t.nextPaymentDate && Math.abs(diffDays(t.nextPaymentDate, found.nextPaymentDate)) <= 3;
      if (!ok) err('nextDate', t.nextPaymentDate ?? '-', found.nextPaymentDate ?? '-');
    }
    // 메일로만 확인된 구독은 돈이 어디서 나갔는지 알 수 없으니 경로를 채점하지 않는다.
    if (found.transactionIds.length > 0) {
      score.pathChecked++;
      if (found.paymentPath.join(' → ') !== t.path.join(' → ')) err('path', t.path.join(' → '), found.paymentPath.join(' → ') || '-');
    }
  }
  score.falsePositives = pool;
  const matched = new Set(score.truePositives.map((x) => x.found));
  for (const s of result.subscriptions) {
    if (s.status !== 'active' || s.confidenceLabel === '낮음') continue;
    score.shown++;
    if (matched.has(s)) score.shownCorrect++;
  }

  const expected = new Set(data.links.map(([pay, source]) => `${pay}|${source}`));
  const predicted = new Set<string>();
  for (const t of [...result.ledger, ...result.internal]) {
    if (t.source === 'pay') for (const id of t.linkedIds ?? []) predicted.add(`${t.id}|${id}`);
  }
  score.links = {
    expected: expected.size,
    predicted: predicted.size,
    correct: [...predicted].filter((p) => expected.has(p)).length,
  };
  return score;
}
