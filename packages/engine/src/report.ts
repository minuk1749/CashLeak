import type { DetectionResult, EvidenceSource, Subscription } from './types.ts';

const SOURCE_LABEL: Record<EvidenceSource, string> = { card: '카드', bank: '통장', pay: '페이', gmail: 'Gmail', naver: '네이버메일' };
const CYCLE_LABEL = { monthly: '매월', yearly: '매년' } as const;

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export function formatSubscriptionAmount(s: Subscription): string {
  const foreign = s.foreignAmount !== undefined ? `$${s.foreignAmount.toFixed(2)}` : '';
  if (s.amount === undefined) return foreign || '-';
  const base = s.amountVaries ? `약 ${won(s.amount)} (변동)` : won(s.amount);
  return foreign ? `${base} (${foreign})` : base;
}

/** 돈이 나가는 경로를 서비스 이름까지 이어서 보여준다. 예: 농협은행 계좌 → 카카오페이 → 멜론 */
export function formatPath(s: Pick<Subscription, 'paymentPath' | 'name'>): string {
  const hops = s.paymentPath[s.paymentPath.length - 1] === s.name ? s.paymentPath : [...s.paymentPath, s.name];
  return hops.join(' → ');
}

/** 이용 중인 구독의 월 환산 합계 (연간 결제는 12로 나눈다) */
export function monthlyTotal(subs: Subscription[]): number {
  return subs
    .filter((s) => s.status === 'active' && s.amount !== undefined)
    .reduce((sum, s) => sum + (s.cycle === 'yearly' ? s.amount! / 12 : s.amount!), 0);
}

const escape = (s: string) => s.replace(/\|/g, '\\|');

export function renderMarkdown(result: DetectionResult): string {
  const active = result.subscriptions.filter((s) => s.status === 'active');
  const ended = result.subscriptions.filter((s) => s.status !== 'active');
  const out: string[] = [];
  out.push(`# 구독 탐지 결과 (기준일 ${result.asOf})`, '');
  out.push(`- 이용 중인 정기결제 **${active.length}개**, 월 환산 약 **${won(monthlyTotal(result.subscriptions))}** (연간 결제는 12로 나눠 포함)`);
  out.push(`- 해지됐거나 해지로 추정되는 결제 ${ended.length}개`);
  out.push(
    `- 분석 대상: 거래 ${result.stats.transactions}건 (다른 내역과 같은 결제로 확인돼 합친 ${result.stats.mergedTransactions}건, 페이 충전 ${result.stats.topups}건 제외), 메일 ${result.stats.emails}통에서 영수증 ${result.stats.receipts}건 (두 메일함 중복 ${result.stats.duplicateReceipts}건 제외)`,
  );
  out.push('');
  out.push('## 이용 중', '');
  out.push('| 서비스 | 분류 | 금액 | 주기 | 다음 결제일 | 결제 경로 | 신뢰도 | 근거 | 메모 |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const s of active) {
    out.push(
      `| ${escape(s.name)} | ${s.category} | ${formatSubscriptionAmount(s)} | ${CYCLE_LABEL[s.cycle]} | ${s.nextPaymentDate ?? '-'} | ${escape(formatPath(s))} | ${s.confidenceLabel} (${s.confidence.toFixed(2)}) | ${s.sources.map((x) => SOURCE_LABEL[x]).join(', ')} | ${escape(s.notes.join('; '))} |`,
    );
  }
  out.push('');
  out.push('## 해지 또는 해지 추정', '');
  if (ended.length === 0) out.push('없음');
  else {
    out.push('| 서비스 | 마지막 결제 | 금액 | 상태 | 신뢰도 | 메모 |');
    out.push('|---|---|---|---|---|---|');
    for (const s of ended) {
      const status = s.status === 'canceled' ? '해지 확인' : '해지 추정';
      out.push(
        `| ${escape(s.name)} | ${s.lastPaymentDate ?? '-'} | ${formatSubscriptionAmount(s)} | ${status} | ${s.confidenceLabel} (${s.confidence.toFixed(2)}) | ${escape(s.notes.join('; '))} |`,
      );
    }
  }
  out.push('');
  out.push('## 정기 이체 (구독은 아니라 따로 표시)', '');
  if (result.recurringTransfers.length === 0) out.push('없음');
  else {
    out.push('| 받는 분 | 금액 | 주기 | 다음 예정일 | 횟수 |');
    out.push('|---|---|---|---|---|');
    for (const t of result.recurringTransfers) {
      out.push(`| ${escape(t.merchant)} | ${won(t.amount)} | ${CYCLE_LABEL[t.cycle]} | ${t.active ? t.nextDate : '중단 추정'} | ${t.transactions.length} |`);
    }
  }
  out.push('');
  out.push('## 분석에서 뺀 출금', '');
  if (result.excluded.length === 0) out.push('없음');
  else {
    out.push('| 내용 | 이유 | 건수 | 합계 |');
    out.push('|---|---|---|---|');
    for (const e of result.excluded) out.push(`| ${escape(e.merchant)} | ${e.reason} | ${e.count} | ${won(e.total)} |`);
  }
  return out.join('\n') + '\n';
}
