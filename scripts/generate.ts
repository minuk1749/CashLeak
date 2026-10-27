// 데모용 가상 사용자 데이터를 data/sample 에 파일로 쓴다.
// 사용법: node scripts/generate.ts [출력 폴더]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateShowcase } from '../sim/generator.ts';
import { bankCsv, cardCsv } from '../sim/export.ts';

const outDir = process.argv[2] ?? 'data/sample';
const data = generateShowcase();
mkdirSync(outDir, { recursive: true });

const bank = data.transactions.filter((t) => t.source === 'bank');
const card = data.transactions.filter((t) => t.source === 'card');
writeFileSync(join(outDir, 'bank.csv'), bankCsv(bank));
writeFileSync(join(outDir, 'card.csv'), cardCsv(card));
for (const mailbox of ['gmail', 'naver'] as const) {
  const emails = data.emails.filter((m) => m.mailbox === mailbox);
  writeFileSync(join(outDir, `emails-${mailbox}.json`), JSON.stringify(emails, null, 2) + '\n');
}
writeFileSync(join(outDir, 'truth.json'), JSON.stringify({ asOf: data.asOf, truth: data.truth }, null, 2) + '\n');

console.log(
  `${outDir}: 거래 ${data.transactions.length}건 (통장 ${bank.length}, 카드 ${card.length}), 메일 ${data.emails.length}통, 정답 구독 ${data.truth.length}개`,
);
