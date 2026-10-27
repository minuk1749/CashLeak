// 데모용 가상 사용자 데이터를 data/sample 에 파일로 쓴다.
// 사용법: node scripts/generate.ts [출력 폴더]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateShowcase, PAY_NAME } from '../sim/generator.ts';
import { bankCsv, cardCsv, payCsv } from '../sim/export.ts';

const outDir = process.argv[2] ?? 'data/sample';
const data = generateShowcase();
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) if (/\.(csv|json)$/.test(file)) rmSync(join(outDir, file));

const of = (source: string, institution?: string) =>
  data.transactions.filter((t) => t.source === source && (!institution || t.institution === institution));
const files: [string, string, number][] = [
  ['nh-bank.csv', bankCsv(of('bank')), of('bank').length],
  ['shinhan-card.csv', cardCsv(of('card')), of('card').length],
  ['kakaopay.csv', payCsv(of('pay', PAY_NAME.kakaopay)), of('pay', PAY_NAME.kakaopay).length],
  ['naverpay.csv', payCsv(of('pay', PAY_NAME.naverpay)), of('pay', PAY_NAME.naverpay).length],
];
for (const [name, text] of files) writeFileSync(join(outDir, name), text);
for (const mailbox of ['gmail', 'naver'] as const) {
  const emails = data.emails.filter((m) => m.mailbox === mailbox);
  writeFileSync(join(outDir, `emails-${mailbox}.json`), JSON.stringify(emails, null, 2) + '\n');
}
writeFileSync(join(outDir, 'truth.json'), JSON.stringify({ asOf: data.asOf, truth: data.truth, links: data.links }, null, 2) + '\n');

console.log(
  `${outDir}: ${files.map(([name, , n]) => `${name} ${n}건`).join(', ')}, 메일 ${data.emails.length}통, 정답 구독 ${data.truth.length}개`,
);
