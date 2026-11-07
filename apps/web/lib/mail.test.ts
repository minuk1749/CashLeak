import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EmailMessage } from '@cashleak/engine';
import { MailFetchError, type FetchMailOptions, type FetchMailResult } from '@cashleak/engine/mail';
import { defaultPeriod, MAIL_LIMIT, readMailRequest, type MailResponse } from './mail.ts';
import { createMailHandler } from './mail-server.ts';

const TODAY = '2026-11-07';

test('보낸 값을 메일 서버에 접속할 모양으로 고친다', () => {
  assert.deepEqual(readMailRequest({ mailbox: 'gmail', user: ' hong ', password: 'abcd efgh ijkl mnop', since: '2026-05-07' }, TODAY), {
    mailbox: 'gmail',
    user: 'hong@gmail.com',
    password: 'abcdefghijklmnop',
    since: '2026-05-07',
  });
  assert.deepEqual(readMailRequest({ mailbox: 'naver', user: 'hong@naver.com', password: ' ABCD1234EFGH ', since: '2025-11-07' }, TODAY), {
    mailbox: 'naver',
    user: 'hong',
    password: 'ABCD1234EFGH',
    since: '2025-11-07',
  });
});

test('잘못된 값은 고칠 방법을 알려 준다', () => {
  const ok = { mailbox: 'gmail', user: 'hong@gmail.com', password: 'abcdefghijklmnop', since: '2026-05-07' };
  const message = (patch: Record<string, unknown>) => {
    try {
      readMailRequest({ ...ok, ...patch }, TODAY);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  assert.equal(message({}), '');
  assert.match(message({ mailbox: 'daum' }), /Gmail과 네이버메일/);
  assert.match(message({ user: 'hong@' }), /Gmail 주소/);
  assert.match(message({ mailbox: 'naver', user: '홍 길동' }), /네이버 아이디/);
  assert.match(message({ password: 'my-google-password' }), /16자/);
  assert.match(message({ password: '' }), /앱 비밀번호를 넣어/);
  assert.match(message({ since: '2026-02-30' }), /기간/);
  assert.match(message({ since: '2026-12-01' }), /기간/);
  assert.match(message({ since: '2024-01-01' }), /최근 2년/);
  // 기기 날짜가 조금 어긋난 2년 전은 받아 준다.
  assert.equal(message({ since: '2024-11-06' }), '');
  assert.match(message({ user: 42 }), /Gmail 주소/);
});

test('기간은 올린 거래내역의 시작일을 덮도록 고른다', () => {
  assert.equal(defaultPeriod(undefined, TODAY), 12);
  assert.equal(defaultPeriod('2026-09-01', TODAY), 3);
  assert.equal(defaultPeriod('2026-02-10', TODAY), 12);
  assert.equal(defaultPeriod('2022-01-01', TODAY), 24);
});

// ---- 서버 API: 가짜 메일 서버로 ----

const mail = (subject: string, text: string, from = 'Netflix <info@account.netflix.com>'): EmailMessage => ({
  id: subject,
  mailbox: 'gmail',
  from,
  subject,
  date: '2026-10-05T00:12:03.000Z',
  text,
});

const FOUND: FetchMailResult = {
  messages: [
    mail('넷플릭스 멤버십 결제가 완료되었습니다', '결제 금액 13,500원\n다음 결제일 2026년 11월 5일'),
    mail('이번 주 새로 올라온 콘텐츠', '새로운 시리즈를 만나 보세요'),
    mail('[네이버페이] 정기결제가 완료되었습니다', '상품명: 헬로북스 멤버십 (월간)\n결제금액: 6,600원', '네이버페이 <naverpay_noreply@navercorp.com>'),
  ],
  scanned: 40,
  matched: 3,
  truncated: false,
};

function setup(fetchMail: (o: FetchMailOptions) => Promise<FetchMailResult> = async () => FOUND) {
  const calls: FetchMailOptions[] = [];
  let clock = 0;
  const handler = createMailHandler({
    fetchMail: (o) => {
      calls.push(o);
      return fetchMail(o);
    },
    today: () => TODAY,
    now: () => clock,
  });
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request('https://cashleak.example/api/mail', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-real-ip': '203.0.113.7', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  return { calls, send, wait: (ms: number) => (clock += ms) };
}

const request = { mailbox: 'gmail', user: 'hong', password: 'abcd efgh ijkl mnop', since: '2026-05-07' };

test('서버 API: 구독 영수증으로 읽히는 메일만 돌려주고, 응답을 저장하지 못하게 한다', async () => {
  const { calls, send } = setup();
  const res = await send(request);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as MailResponse;
  assert.deepEqual(body.messages.map((m) => m.subject), ['넷플릭스 멤버십 결제가 완료되었습니다', '[네이버페이] 정기결제가 완료되었습니다']);
  assert.deepEqual([body.scanned, body.matched, body.truncated], [40, 3, false]);
  assert.deepEqual(calls, [{ mailbox: 'gmail', user: 'hong@gmail.com', password: 'abcdefghijklmnop', since: '2026-05-07', limit: MAIL_LIMIT, timeoutMs: 50_000 }]);
});

test('서버 API: 다른 사이트에서 보낸 요청과 잘못된 요청은 메일 서버에 접속하지 않는다', async () => {
  const { calls, send } = setup();
  assert.equal((await send(request, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await send(request, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await send('{')).status, 400);
  const bad = await send({ ...request, password: 'google-password' });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /16자/);
  assert.equal((await send({ ...request, user: 'x'.repeat(3000) })).status, 413);
  assert.equal(calls.length, 0);
});

test('서버 API: Sec-Fetch-Site가 없는 브라우저는 Origin과 Host를 비교한다', async () => {
  const { send } = setup();
  const noSite = { 'sec-fetch-site': '', host: 'cashleak.example' };
  assert.equal((await send(request, { ...noSite, origin: 'https://cashleak.example' })).status, 200);
  assert.equal((await send(request, { ...noSite, origin: 'https://evil.example' })).status, 403);
  assert.equal((await send(request, noSite)).status, 403);
});

test('서버 API: 비밀번호가 틀리면 401, 메일 서버 문제는 502로 알린다', async () => {
  const auth = setup(async () => {
    throw new MailFetchError('auth', '메일 주소나 앱 비밀번호가 맞지 않아요.');
  });
  const res = await auth.send(request);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: '메일 주소나 앱 비밀번호가 맞지 않아요.', problem: 'auth' });
  const down = setup(async () => {
    throw new MailFetchError('connect', '메일 서버에 접속하지 못했어요.');
  });
  assert.equal((await down.send(request)).status, 502);
  const bug = setup(async () => {
    throw new TypeError('x is undefined');
  });
  const unknown = await bug.send(request);
  assert.equal(unknown.status, 500);
  assert.doesNotMatch(JSON.stringify(await unknown.json()), /undefined/);
});

test('서버 API: 한 곳에서 10분에 10번까지만 시도할 수 있다', async () => {
  const { calls, send, wait } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await send(request)).status, 200);
  const limited = await send(request);
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { problem: string }).problem, 'limit');
  // 다른 곳에서 온 요청은 따로 센다.
  assert.equal((await send(request, { 'x-real-ip': '198.51.100.2' })).status, 200);
  wait(10 * 60_000);
  assert.equal((await send(request)).status, 200);
  assert.equal(calls.length, 12);
});
