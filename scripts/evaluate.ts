// 무작위 가상 사용자 여러 명으로 탐지 정확도를 잰다.
// 사용법: node scripts/evaluate.ts [사용자 수, 기본 200]
import { mkdirSync, writeFileSync } from 'node:fs';
import { runPipeline } from '../src/pipeline.ts';
import { generateRandom, generateShowcase, type SimData } from '../sim/generator.ts';
import { scoreResult, type SeedScore } from '../sim/score.ts';

const count = Number(process.argv[2] ?? 200);
const datasets: SimData[] = [generateShowcase()];
for (let seed = 1; seed <= count; seed++) datasets.push(generateRandom(seed));

const scores: SeedScore[] = datasets.map((d) =>
  scoreResult(d.seed, runPipeline({ transactions: d.transactions, emails: d.emails, asOf: d.asOf }), d.truth),
);

const sum = (f: (s: SeedScore) => number) => scores.reduce((a, s) => a + f(s), 0);
const truthTotal = sum((s) => s.truth);
const tp = sum((s) => s.truePositives.length);
const misses = sum((s) => s.misses.length);
const undetectable = sum((s) => s.undetectable.length);
const fp = sum((s) => s.falsePositives.length);
const fpActive = sum((s) => s.falsePositives.filter((f) => f.status === 'active').length);
const shown = sum((s) => s.shown);
const shownCorrect = sum((s) => s.shownCorrect);
const fieldErrors = scores.flatMap((s) => s.fieldErrors.map((e) => ({ seed: s.seed, ...e })));
const pct = (a: number, b: number) => (b === 0 ? '-' : `${((a / b) * 100).toFixed(1)}%`);
const errorsOf = (field: string) => fieldErrors.filter((e) => e.field === field).length;

const lines: string[] = [];
lines.push(`# 탐지 정확도 평가 (가상 사용자 ${datasets.length}명)`, '');
lines.push('가상 데이터로 잰 값이라 실제 데이터에서의 정확도를 뜻하지 않는다. 탐지 규칙이 설계한 경우들을 제대로 처리하는지 확인하는 용도다.', '');
lines.push('| 지표 | 값 | 설명 |');
lines.push('|---|---|---|');
lines.push(`| 정답 구독 수 | ${truthTotal} | 그중 데이터에 흔적이 부족한 것 ${undetectable}개 |`);
lines.push(`| 재현율 (전체) | ${pct(tp, truthTotal)} | 실제 구독 중 찾아낸 비율 |`);
lines.push(`| 재현율 (찾을 수 있는 것만) | ${pct(tp, tp + misses)} | 거래 2건 이상 또는 영수증 메일이 있는 구독 기준 |`);
lines.push(`| 정밀도 (전체) | ${pct(tp, tp + fp)} | 찾아낸 것 중 진짜 구독 비율 (해지 추정, 신뢰도 낮음 포함) |`);
lines.push(`| 정밀도 (이용 중 + 신뢰도 보통 이상) | ${pct(shownCorrect, shown)} | 앱에서 확정으로 보여줄 목록 기준 |`);
lines.push(`| 오탐 | ${fp}건 | 그중 '이용 중'으로 나온 것 ${fpActive}건 |`);
lines.push(`| 금액 정확도 | ${pct(tp - errorsOf('amount'), tp)} | 최근 결제 금액 (해외 결제는 달러 기준) |`);
lines.push(`| 주기 정확도 | ${pct(tp - errorsOf('cycle'), tp)} | 매월/매년 |`);
lines.push(`| 상태 정확도 | ${pct(tp - errorsOf('status'), tp)} | 이용 중 vs 해지 |`);
const activeBoth = scores.flatMap((s) => s.truePositives).filter((x) => x.truth.status === 'active' && x.found.status === 'active').length;
const exactNext = scores
  .flatMap((s) => s.truePositives)
  .filter((x) => x.truth.status === 'active' && x.found.status === 'active' && x.found.nextPaymentDate === x.truth.nextPaymentDate).length;
lines.push(`| 다음 결제일 정확도 | ${pct(activeBoth - errorsOf('nextDate'), activeBoth)} | 이용 중인 구독, ±3일 (날짜까지 정확히 일치 ${pct(exactNext, activeBoth)}) |`);
lines.push('');

lines.push('## 서비스별 재현율', '');
lines.push('| 키 | 정답 | 찾음 | 놓침 | 흔적 부족 |');
lines.push('|---|---|---|---|---|');
const keys = [...new Set(scores.flatMap((s) => [...s.truePositives.map((x) => x.truth), ...s.misses, ...s.undetectable].map((t) => t.key)))].sort();
for (const key of keys) {
  const found = sum((s) => s.truePositives.filter((x) => x.truth.key === key).length);
  const miss = sum((s) => s.misses.filter((t) => t.key === key).length);
  const und = sum((s) => s.undetectable.filter((t) => t.key === key).length);
  lines.push(`| ${key} | ${found + miss + und} | ${found} | ${miss} | ${und} |`);
}
lines.push('');

lines.push('## 놓친 구독 (찾을 수 있었던 것)', '');
const missList = scores.flatMap((s) => s.misses.map((t) => ({ seed: s.seed, t })));
if (missList.length === 0) lines.push('없음');
for (const { seed, t } of missList.slice(0, 30)) {
  lines.push(`- seed ${seed}: ${t.key} (${t.status}, 거래 ${t.charges}건, 영수증 ${t.receipts}통)`);
}
lines.push('');

lines.push('## 오탐', '');
const fpList = scores.flatMap((s) => s.falsePositives.map((f) => ({ seed: s.seed, f })));
if (fpList.length === 0) lines.push('없음');
for (const { seed, f } of fpList.slice(0, 30)) {
  lines.push(`- seed ${seed}: ${f.name} [${f.key}] ${f.amount ?? f.foreignAmount} ${f.status}, 신뢰도 ${f.confidenceLabel}, 거래 ${f.transactionIds.length}건, 메일 ${f.emailIds.length}통`);
}
lines.push('');

lines.push('## 값이 틀린 경우', '');
if (fieldErrors.length === 0) lines.push('없음');
for (const e of fieldErrors.slice(0, 40)) lines.push(`- seed ${e.seed}: ${e.key} ${e.field} 정답 ${e.expected}, 결과 ${e.actual}`);

const report = lines.join('\n') + '\n';
mkdirSync('out', { recursive: true });
writeFileSync('out/evaluation.md', report);
console.log(report);
