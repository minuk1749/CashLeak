// 폴더 안의 거래내역(CSV)과 메일(JSON)로 구독을 찾는다.
// 사용법: node scripts/detect.ts [데이터 폴더] [--as-of YYYY-MM-DD]
//   bank*.csv  → 통장 거래내역, card*.csv → 카드 이용내역, emails-*.json → 메일
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailMessage, Transaction } from '../src/types.ts';
import { importBankCsv, importCardCsv } from '../src/io/importers.ts';
import { runPipeline } from '../src/pipeline.ts';
import { renderMarkdown } from '../src/report.ts';

const args = process.argv.slice(2);
const asOfIdx = args.indexOf('--as-of');
const asOf = asOfIdx >= 0 ? args[asOfIdx + 1] : undefined;
const dataDir = args.find((a, i) => !a.startsWith('--') && i !== asOfIdx + 1) ?? 'data/sample';

const transactions: Transaction[] = [];
const emails: EmailMessage[] = [];
for (const file of readdirSync(dataDir).sort()) {
  const text = readFileSync(join(dataDir, file), 'utf8');
  const prefix = file.replace(/\.[^.]+$/, '');
  if (/^bank.*\.csv$/i.test(file)) transactions.push(...importBankCsv(text, prefix));
  else if (/^card.*\.csv$/i.test(file)) transactions.push(...importCardCsv(text, prefix));
  else if (/^emails-.*\.json$/i.test(file)) emails.push(...(JSON.parse(text) as EmailMessage[]));
}

const result = runPipeline({ transactions, emails, asOf });
const markdown = renderMarkdown(result);
mkdirSync('out', { recursive: true });
writeFileSync('out/result.json', JSON.stringify(result, null, 2) + '\n');
writeFileSync('out/result.md', markdown);
console.log(markdown);
console.log('저장: out/result.md, out/result.json');
