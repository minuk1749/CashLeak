// 메일함에서 구독 영수증으로 읽히는 메일을 가져와 emails-<메일함>.json으로 저장한다.
// 저장한 파일은 detect.ts(같은 폴더의 emails-*.json)와 웹앱 '내역 올리기'(메일 종류)에서 읽는다.
// 사용법: CASHLEAK_MAIL_PASSWORD=<앱 비밀번호> node scripts/fetch-mail.ts <gmail|naver> <메일 주소 또는 네이버 아이디> [--since YYYY-MM-DD] [--out 폴더] [--all]
//   비밀번호는 셸 기록에 남지 않도록 환경 변수로만 받는다.
//   --since를 빼면 1년 전부터 가져온다. --all은 영수증으로 읽히지 않은 후보 메일도 저장한다(파서 확인용).
//   --server 127.0.0.1:1143 은 시험용(암호화 없이 접속).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fetchReceiptMail, MailFetchError } from '../src/mail/index.ts';
import { parseEmail, parseEmails } from '../src/email/parse.ts';
import type { Mailbox } from '../src/types.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const since = option('--since') ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const outDir = resolve(option('--out') ?? 'data/private');
const serverArg = option('--server');
const all = args.includes('--all');
if (all) args.splice(args.indexOf('--all'), 1);
const [mailbox, user] = args;
const password = process.env.CASHLEAK_MAIL_PASSWORD;

if ((mailbox !== 'gmail' && mailbox !== 'naver') || !user || !password || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('사용법: CASHLEAK_MAIL_PASSWORD=<앱 비밀번호> node scripts/fetch-mail.ts <gmail|naver> <메일 주소 또는 아이디> [--since YYYY-MM-DD] [--out 폴더] [--all]');
  process.exit(1);
}

const server = serverArg ? { host: serverArg.split(':')[0], port: Number(serverArg.split(':')[1] ?? 143), secure: false } : undefined;
try {
  const result = await fetchReceiptMail({ mailbox: mailbox as Mailbox, user, password, since, server, timeoutMs: 300_000, limit: 2000 });
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `emails-${mailbox}.json`);
  const receipts = result.messages.filter((m) => parseEmail(m) !== null);
  writeFileSync(file, JSON.stringify(all ? result.messages : receipts, null, 2));
  const unique = parseEmails(receipts).filter((r) => !r.duplicateOf).length;
  console.log(`${since}부터 메일 ${result.scanned}통을 살펴 후보 ${result.messages.length}통의 본문을 읽었고, 구독 영수증으로 읽힌 것은 ${receipts.length}통입니다 (중복 빼면 ${unique}통).`);
  if (result.truncated) console.log(`후보가 ${result.matched}통이라 최근 ${result.messages.length}통만 읽었습니다.`);
  if (all) console.log('--all: 영수증으로 읽히지 않은 후보 메일도 저장했습니다.');
  console.log(`저장: ${file}`);
} catch (e) {
  console.error(e instanceof MailFetchError ? e.message : e);
  process.exit(1);
}
