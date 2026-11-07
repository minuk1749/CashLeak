import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlToText } from '../src/email/html-text.ts';
import { couldBeReceipt, parseEmail, parseEmails } from '../src/email/parse.ts';
import { fetchReceiptMail, gmailQuery, MailFetchError, mightBeReceipt, readRawEmail, type ImapClient } from '../src/mail/index.ts';
import type { EmailMessage } from '../src/types.ts';
import { generateRandom, generateShowcase } from '../sim/index.ts';

// fixtures/mail/*.eml은 실제 메일에서 흔한 모양(HTML 본문, base64·QP, 인코딩된 제목, EUC-KR)으로 만든 가상 메일이다.
const raw = (name: string) => readFileSync(new URL(`./fixtures/mail/${name}`, import.meta.url));
const read = (name: string, receivedAt?: string) => readRawEmail(raw(name), { id: name, mailbox: 'gmail', receivedAt });

test('HTML 메일 본문을 줄 단위 글자로 바꾼다: 표의 한 줄은 한 줄로, 숨은 글자와 스타일은 뺀다', () => {
  const html =
    '<html><head><style>td{color:red}</style></head><body><span style="display:none">&zwnj;&#8203;미리보기</span>' +
    '<table><tr><td>결제 금액</td><td>13,500원</td></tr><tr><td>다음 결제일</td><td>2026년&nbsp;11월 5일</td></tr></table>' +
    '<p>A&amp;B<br>고객센터 &middot; 1588-0000</p></body></html>';
  assert.equal(htmlToText(html), '미리보기\n결제 금액 13,500원\n다음 결제일 2026년 11월 5일\nA&B\n고객센터 · 1588-0000');
});

test('메일 원문을 읽는다: 인코딩된 제목, base64 HTML 본문, 링크 주소 빼기', async () => {
  const m = await read('html-receipt.eml');
  assert.equal(m.from, 'Netflix <info@account.netflix.com>');
  assert.equal(m.subject, '넷플릭스 멤버십 결제가 완료되었습니다');
  assert.equal(m.date, '2026-10-05T00:12:03.000Z');
  assert.match(m.text, /^결제 금액 13,500원$/m);
  assert.match(m.text, /^다음 결제일 2026년 11월 5일$/m);
  assert.doesNotMatch(m.text, /https?:|zwnj|​/);
});

test('글자 본문과 HTML 본문 중 내용이 많은 쪽을 쓰고, EUC-KR 메일도 읽는다', async () => {
  const openai = await read('text-receipt.eml');
  assert.equal(openai.from, 'OpenAI <noreply@tm.openai.com>');
  assert.match(openai.text, /ChatGPT Plus Subscription Qty 1 \$20\.00/);
  const naverpay = await read('euckr-receipt.eml');
  assert.equal(naverpay.from, '네이버페이 <naverpay_noreply@navercorp.com>');
  assert.equal(naverpay.subject, '[네이버페이] 정기결제가 완료되었습니다');
  assert.match(naverpay.text, /결제금액: 6,600원/);
});

test('보낸 시각이 잘못된 메일은 받은 시각을 쓴다', async () => {
  const broken = raw('personal.eml').toString('latin1').replace(/^Date: .*$/m, 'Date: 어제');
  const m = await readRawEmail(Buffer.from(broken, 'latin1'), { id: 'x', mailbox: 'naver', receivedAt: '2026-10-21T11:00:00.000Z' });
  assert.equal(m.date, '2026-10-21T11:00:00.000Z');
});

test('가져온 메일을 탐지 엔진이 구독 영수증으로 읽는다', async () => {
  const messages = await Promise.all(['html-receipt.eml', 'text-receipt.eml', 'euckr-receipt.eml'].map((f) => read(f)));
  assert.deepEqual(
    parseEmails(messages).map((r) => [r.serviceId, r.type, r.amount, r.currency, r.billedVia]),
    [
      ['netflix', 'charge', 13500, 'KRW', undefined],
      ['app:헬로북스-멤버십', 'charge', 6600, 'KRW', 'naverpay'],
      ['chatgpt-plus', 'charge', 20, 'USD', undefined],
    ],
  );
});

test('제목과 보낸 곳으로 영수증일 수 있는 메일만 고른다 (광고는 뺀다)', () => {
  assert.equal(mightBeReceipt('Netflix <info@account.netflix.com>', '넷플릭스 멤버십 결제가 완료되었습니다'), true);
  assert.equal(mightBeReceipt('Apple <no_reply@email.apple.com>', 'Apple에서 발송한 영수증입니다'), true);
  // 알려진 서비스가 보낸 메일은 제목에 결제 표현이 없어도 고른다.
  assert.equal(mightBeReceipt('OpenAI <noreply@tm.openai.com>', 'Your ChatGPT Plus plan'), true);
  // 다른 곳은 제목에 구독 표현이 있어야 한다: 쇼핑몰 주문 영수증은 본문을 받지 않는다.
  assert.equal(mightBeReceipt('헬로북스 <billing@hellobooks.example>', '정기결제 완료 안내'), true);
  assert.equal(mightBeReceipt('11번가 <noreply@11st.example>', '주문하신 상품의 결제가 완료되었습니다'), false);
  // 중개자(앱스토어·간편결제)의 알림 메일과, 결제 실패 안내는 뺀다.
  assert.equal(mightBeReceipt('네이버 <noreply@naver.com>', '새로운 기기에서 로그인되었습니다'), false);
  assert.equal(mightBeReceipt('Netflix <info@account.netflix.com>', '결제 정보 업데이트 필요'), false);
  assert.equal(mightBeReceipt('쿠팡 <no-reply@coupang.com>', '(광고) 와우 회원 결제 할인'), false);
  assert.equal(mightBeReceipt('Kim <kim@example.org>', '주말에 만나요'), false);
  assert.match(gmailQuery('2025-11-07'), /^after:2025\/11\/07 \(label:\^smartlabel_receipt OR subject:\(영수증 OR .*\) OR from:\(netflix\.com OR .*\)\)$/);
});

test('본문을 받기 전에 거른 메일 중에는 엔진이 영수증으로 읽을 메일이 없다 (가상 데이터 메일 전체로 확인)', () => {
  let parsed = 0;
  let skipped = 0;
  for (const data of [generateShowcase(), ...Array.from({ length: 30 }, (_, i) => generateRandom(i + 1))]) {
    for (const m of data.emails) {
      const kept = mightBeReceipt(m.from, m.subject);
      if (!kept) skipped++;
      if (parseEmail(m)) {
        parsed++;
        assert.ok(couldBeReceipt(m.from, m.subject) && kept, `${m.from} / ${m.subject}`);
      }
    }
  }
  assert.ok(parsed > 500 && skipped > 50, `영수증 ${parsed}통, 거른 메일 ${skipped}통`);
});

// ---- 메일함에서 가져오기: 가짜 IMAP 서버 ----

interface FakeMessage {
  uid: number;
  file: string;
  subject: string;
  from: { name?: string; address: string };
  date: string;
}

const MESSAGES: FakeMessage[] = [
  { uid: 11, file: 'html-receipt.eml', subject: '넷플릭스 멤버십 결제가 완료되었습니다', from: { name: 'Netflix', address: 'info@account.netflix.com' }, date: '2026-10-05T00:12:03Z' },
  { uid: 12, file: 'euckr-receipt.eml', subject: '[네이버페이] 정기결제가 완료되었습니다', from: { name: '네이버페이', address: 'naverpay_noreply@navercorp.com' }, date: '2026-10-14T02:20:41Z' },
  { uid: 13, file: 'text-receipt.eml', subject: 'Your receipt from OpenAI #2001-0042', from: { name: 'OpenAI', address: 'noreply@tm.openai.com' }, date: '2026-10-19T01:00:00Z' },
  { uid: 14, file: 'advertisement.eml', subject: '(광고) 와우 회원만 받는 할인 쿠폰', from: { name: '쿠팡', address: 'no-reply@coupang.com' }, date: '2026-10-20T01:00:00Z' },
  { uid: 15, file: 'personal.eml', subject: '주말에 만나요', from: { name: 'Kim', address: 'kim@example.org' }, date: '2026-10-21T11:00:00Z' },
];

interface FakeOptions {
  folders?: { path: string; specialUse?: string }[];
  /** Gmail 검색을 지원하는지 */
  gmail?: boolean;
  /** 접속할 때 던질 오류 */
  connectError?: unknown;
  /** 메일 받기가 끝나지 않는 서버 */
  hang?: boolean;
}

function fakeServer(options: FakeOptions = {}) {
  const calls: { opened?: string; searches: Record<string, unknown>[]; fetched: number[][]; loggedOut: boolean; login?: { user: string; password: string } } = {
    searches: [],
    fetched: [],
    loggedOut: false,
  };
  const create = ({ user, password }: { user: string; password: string }): ImapClient => ({
    async connect() {
      calls.login = { user, password };
      if (options.connectError) throw options.connectError;
    },
    async list() {
      return options.folders ?? [{ path: 'INBOX', specialUse: '\\Inbox' }];
    },
    async getMailboxLock(path) {
      calls.opened = path;
      return { release() {} };
    },
    async search(query) {
      calls.searches.push(query);
      if ('gmraw' in query) {
        if (!options.gmail) throw Object.assign(new Error('no X-GM-EXT-1'), { code: 'MissingServerExtension' });
        // Gmail 검색은 개인 메일을 빼고 돌려준다고 치자 (광고는 남긴다).
        return MESSAGES.filter((m) => m.uid !== 15).map((m) => m.uid);
      }
      return MESSAGES.map((m) => m.uid);
    },
    async *fetch(range, query) {
      calls.fetched.push(range);
      if (options.hang && query.source) await new Promise(() => {});
      for (const m of MESSAGES.filter((x) => range.includes(x.uid))) {
        yield {
          uid: m.uid,
          envelope: { subject: m.subject, from: [m.from] },
          internalDate: new Date(m.date),
          source: query.source ? raw(m.file) : undefined,
        };
      }
    },
    async logout() {
      calls.loggedOut = true;
    },
    close() {},
  });
  return { calls, create };
}

const subjects = (messages: EmailMessage[]) => messages.map((m) => m.subject);

test('Gmail: 전체보관함에서 Gmail 검색으로 찾고, 광고를 빼고, 오래된 순으로 돌려준다', async () => {
  const { calls, create } = fakeServer({ gmail: true, folders: [{ path: 'INBOX' }, { path: '[Gmail]/전체보관함', specialUse: '\\All' }] });
  const result = await fetchReceiptMail({ mailbox: 'gmail', user: 'hong@gmail.com', password: 'abcd efgh ijkl mnop', since: '2026-10-01' }, create);
  assert.equal(calls.opened, '[Gmail]/전체보관함');
  assert.deepEqual(calls.searches, [{ gmraw: gmailQuery('2026-10-01') }]);
  assert.deepEqual(subjects(result.messages), ['넷플릭스 멤버십 결제가 완료되었습니다', '[네이버페이] 정기결제가 완료되었습니다', 'Your receipt from OpenAI #2001-0042']);
  assert.deepEqual(result.messages.map((m) => [m.id, m.mailbox]), [['gmail-11', 'gmail'], ['gmail-12', 'gmail'], ['gmail-13', 'gmail']]);
  assert.deepEqual([result.scanned, result.matched, result.truncated], [4, 3, false]);
  assert.equal(calls.loggedOut, true);
});

test('고른 메일이 너무 많으면 최근 것만 가져온다', async () => {
  const { calls, create } = fakeServer({ gmail: true, folders: [{ path: '[Gmail]/All Mail', specialUse: '\\All' }] });
  const result = await fetchReceiptMail({ mailbox: 'gmail', user: 'hong@gmail.com', password: 'x', since: '2026-10-01', limit: 2 }, create);
  assert.deepEqual(calls.fetched.at(-1), [13, 12]);
  assert.deepEqual(subjects(result.messages), ['[네이버페이] 정기결제가 완료되었습니다', 'Your receipt from OpenAI #2001-0042']);
  assert.deepEqual([result.matched, result.truncated], [3, true]);
});

test('네이버메일: 받은메일함을 기간으로 찾고 제목·보낸 곳으로 고른다', async () => {
  const { calls, create } = fakeServer();
  const result = await fetchReceiptMail({ mailbox: 'naver', user: 'hong', password: 'x', since: '2026-10-01' }, create);
  assert.equal(calls.opened, 'INBOX');
  assert.deepEqual(calls.searches, [{ since: new Date('2026-10-01T00:00:00Z') }]);
  assert.deepEqual(result.messages.map((m) => m.mailbox), ['naver', 'naver', 'naver']);
  assert.deepEqual([result.scanned, result.matched], [5, 3]);
  assert.deepEqual(calls.login, { user: 'hong', password: 'x' });
});

test('Gmail 검색이 안 되는 서버면 기간으로 찾아 제목·보낸 곳으로 고른다', async () => {
  const { calls, create } = fakeServer({ gmail: false, folders: [{ path: 'All', specialUse: '\\All' }] });
  const result = await fetchReceiptMail({ mailbox: 'gmail', user: 'hong@gmail.com', password: 'x', since: '2026-10-01' }, create);
  assert.equal(calls.searches.length, 2);
  assert.deepEqual([result.scanned, result.matched, result.messages.length], [5, 3, 3]);
});

test('비밀번호가 틀리거나 서버가 응답하지 않으면 이유를 알려 준다', async () => {
  const wrong = fakeServer({ connectError: Object.assign(new Error('Authentication failed'), { authenticationFailed: true }) });
  await assert.rejects(
    fetchReceiptMail({ mailbox: 'gmail', user: 'hong@gmail.com', password: 'wrong', since: '2026-10-01' }, wrong.create),
    (e) => e instanceof MailFetchError && e.problem === 'auth',
  );
  const down = fakeServer({ connectError: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  await assert.rejects(
    fetchReceiptMail({ mailbox: 'naver', user: 'hong', password: 'x', since: '2026-10-01' }, down.create),
    (e) => e instanceof MailFetchError && e.problem === 'connect',
  );
  const slow = fakeServer({ hang: true });
  await assert.rejects(
    fetchReceiptMail({ mailbox: 'naver', user: 'hong', password: 'x', since: '2026-10-01', timeoutMs: 50 }, slow.create),
    (e) => e instanceof MailFetchError && e.problem === 'timeout',
  );
});
