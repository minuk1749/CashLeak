// 탐지 결과를 가상 데이터의 정답과 비교해 채점한다.
import type { DetectionResult, Subscription } from '../src/types.ts';
import { diffDays } from '../src/dates.ts';
import type { TruthEntry } from './generator.ts';

export interface FieldError {
  key: string;
  field: 'amount' | 'cycle' | 'status' | 'nextDate';
  expected: string;
  actual: string;
}

export interface SeedScore {
  seed: number;
  truth: number;
  truePositives: { truth: TruthEntry; found: Subscription }[];
  misses: TruthEntry[]; // 찾을 수 있었는데 못 찾음
  undetectable: TruthEntry[]; // 데이터에 흔적이 부족해 원리상 못 찾음
  falsePositives: Subscription[];
  fieldErrors: FieldError[];
  shown: number; // 이용 중 + 신뢰도 보통 이상
  shownCorrect: number;
}

const amountText = (s: { amount?: number; foreignAmount?: number }) =>
  s.foreignAmount !== undefined ? `$${s.foreignAmount}` : String(s.amount);

export function scoreResult(seed: number, result: DetectionResult, truth: TruthEntry[]): SeedScore {
  const byKey = new Map<string, Subscription[]>();
  for (const s of result.subscriptions) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const score: SeedScore = {
    seed,
    truth: truth.length,
    truePositives: [],
    misses: [],
    undetectable: [],
    falsePositives: [],
    fieldErrors: [],
    shown: 0,
    shownCorrect: 0,
  };
  const matched = new Set<Subscription>();
  for (const t of truth) {
    const found = byKey.get(t.key)?.[0];
    if (!found) {
      (t.detectable ? score.misses : score.undetectable).push(t);
      continue;
    }
    matched.add(found);
    score.truePositives.push({ truth: t, found });
    const err = (field: FieldError['field'], expected: string, actual: string) =>
      score.fieldErrors.push({ key: t.key, field, expected, actual });
    const amountOk =
      t.foreignAmount !== undefined
        ? Math.abs((found.foreignAmount ?? NaN) - t.foreignAmount) < 0.01
        : found.amount === t.amount;
    if (!amountOk) err('amount', amountText(t), amountText(found));
    if (found.cycle !== t.cycle) err('cycle', t.cycle, found.cycle);
    const activeOk = (found.status === 'active') === (t.status === 'active');
    if (!activeOk) err('status', t.status, found.status);
    if (activeOk && t.status === 'active') {
      const ok = found.nextPaymentDate && t.nextPaymentDate && Math.abs(diffDays(t.nextPaymentDate, found.nextPaymentDate)) <= 3;
      if (!ok) err('nextDate', t.nextPaymentDate ?? '-', found.nextPaymentDate ?? '-');
    }
  }
  score.falsePositives = result.subscriptions.filter((s) => !matched.has(s));
  for (const s of result.subscriptions) {
    if (s.status !== 'active' || s.confidenceLabel === '낮음') continue;
    score.shown++;
    if (matched.has(s)) score.shownCorrect++;
  }
  return score;
}
