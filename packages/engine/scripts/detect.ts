// 폴더 안의 거래내역(CSV)과 메일(JSON)로 구독을 찾는다.
// 사용법: node scripts/detect.ts [데이터 폴더] [--as-of YYYY-MM-DD]
//   *.csv → 머리글을 보고 통장·카드·간편결제 내역을 구분하고, 파일 이름으로 기관을 추측한다.
//   emails-*.json → 메일
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EmailMessage, Transaction } from '../src/types.ts';
import { detectCsvKind, guessInstitution, importCsv } from '../src/io/importers.ts';
import { runPipeline } from '../src/pipeline.ts';
import { renderMarkdown } from '../src/report.ts';

const args = process.argv.slice(2);
const asOfIdx = args.indexOf('--as-of');
const asOf = asOfIdx >= 0 ? args[asOfIdx + 1] : undefined;
const dataArg = args.find((a, i) => !a.startsWith('--') && (asOfIdx < 0 || i !== asOfIdx + 1));
// npm run 으로 실행하면 작업 폴더가 이 패키지로 바뀌므로, 받은 경로는 명령을 실행한 위치(INIT_CWD) 기준으로 푼다.
const dataDir = dataArg ? resolve(process.env.INIT_CWD ?? '.', dataArg) : 'data/sample';

const transactions: Transaction[] = [];
const emails: EmailMessage[] = [];
for (const file of readdirSync(dataDir).sort()) {
  const text = readFileSync(join(dataDir, file), 'utf8');
  if (/\.csv$/i.test(file)) {
    const kind = detectCsvKind(text);
    if (!kind) {
      console.warn(`${file}: 어떤 내역인지 알 수 없어 건너뜀`);
      continue;
    }
    const institution = guessInstitution(file, kind);
    transactions.push(...importCsv(text, kind, { idPrefix: file.replace(/\.[^.]+$/, ''), institution }));
  } else if (/^emails-.*\.json$/i.test(file)) {
    emails.push(...(JSON.parse(text) as EmailMessage[]));
  }
}

const result = runPipeline({ transactions, emails, asOf });
const markdown = renderMarkdown(result);
mkdirSync('out', { recursive: true });
writeFileSync('out/result.json', JSON.stringify(result, null, 2) + '\n');
writeFileSync('out/result.md', markdown);
console.log(markdown);
console.log('저장: out/result.md, out/result.json');
