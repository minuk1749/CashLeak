// 폴더 안의 거래내역(CSV·엑셀)과 메일(JSON)로 구독을 찾는다.
// 사용법: node scripts/detect.ts [데이터 폴더] [--as-of YYYY-MM-DD]
//   *.csv, *.xlsx → 머리글을 보고 통장·카드·간편결제 내역을 구분하고, 파일 이름으로 기관을 추측한다.
//   비밀번호가 걸린 엑셀은 환경 변수 CASHLEAK_PASSWORDS(쉼표로 여러 개)의 비밀번호를 차례로 넣어 본다.
//   emails-*.json → 메일
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EmailMessage, Transaction } from '../src/types.ts';
import { parseCsv } from '../src/io/csv.ts';
import { detectKind, guessInstitution, importRows, transactionSheet } from '../src/io/importers.ts';
import { isEncryptedSpreadsheet, readXlsx, SpreadsheetError } from '../src/io/xlsx.ts';
import { runPipeline } from '../src/pipeline.ts';
import { renderMarkdown } from '../src/report.ts';

const args = process.argv.slice(2);
const asOfIdx = args.indexOf('--as-of');
const asOf = asOfIdx >= 0 ? args[asOfIdx + 1] : undefined;
const dataArg = args.find((a, i) => !a.startsWith('--') && (asOfIdx < 0 || i !== asOfIdx + 1));
// npm run 으로 실행하면 작업 폴더가 이 패키지로 바뀌므로, 받은 경로는 명령을 실행한 위치(INIT_CWD) 기준으로 푼다.
const dataDir = dataArg ? resolve(process.env.INIT_CWD ?? '.', dataArg) : 'data/sample';
const passwords = (process.env.CASHLEAK_PASSWORDS ?? '').split(',').filter(Boolean);

/** 엑셀에서 거래내역 표를 꺼낸다. 비밀번호가 걸려 있으면 받은 비밀번호를 차례로 넣어 본다. */
function readSpreadsheet(file: string, bytes: Uint8Array): string[][] | undefined {
  for (const password of isEncryptedSpreadsheet(bytes) ? passwords : [undefined]) {
    try {
      return transactionSheet(readXlsx(bytes, { password }))?.rows;
    } catch (e) {
      if (!(e instanceof SpreadsheetError)) throw e;
      if (e.problem === 'wrong-password') continue;
      console.warn(`${file}: ${e.message} 건너뜀`);
      return undefined;
    }
  }
  console.warn(`${file}: 비밀번호가 걸려 있어 건너뜀 (CASHLEAK_PASSWORDS 환경 변수로 비밀번호를 주세요)`);
  return undefined;
}

const transactions: Transaction[] = [];
const emails: EmailMessage[] = [];
for (const file of readdirSync(dataDir).sort()) {
  const path = join(dataDir, file);
  let rows: string[][] | undefined;
  if (/\.csv$/i.test(file)) rows = parseCsv(readFileSync(path, 'utf8'));
  else if (/\.xlsx$/i.test(file)) rows = readSpreadsheet(file, new Uint8Array(readFileSync(path)));
  else if (/^emails-.*\.json$/i.test(file)) emails.push(...(JSON.parse(readFileSync(path, 'utf8')) as EmailMessage[]));
  if (!rows) continue;
  const kind = detectKind(rows);
  if (!kind) {
    console.warn(`${file}: 어떤 내역인지 알 수 없어 건너뜀`);
    continue;
  }
  const institution = guessInstitution(file, kind);
  transactions.push(...importRows(rows, kind, { idPrefix: file.replace(/\.[^.]+$/, ''), institution }));
}

const result = runPipeline({ transactions, emails, asOf });
const markdown = renderMarkdown(result);
mkdirSync('out', { recursive: true });
writeFileSync('out/result.json', JSON.stringify(result, null, 2) + '\n');
writeFileSync('out/result.md', markdown);
console.log(markdown);
console.log('저장: out/result.md, out/result.json');
