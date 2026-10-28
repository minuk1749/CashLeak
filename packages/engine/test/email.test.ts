import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmail, parseEmails } from '../src/email/parse.ts';
import { TEMPLATES, NOISE } from '../sim/mail-templates.ts';
import { mail } from './helpers.ts';

const base = { amount: 0, currency: 'KRW' as const, account: 'us***@naver.com', ref: '1234-5678' };

test('애플 영수증에서 iCloud+ 구독과 금액, 갱신일을 읽는다', () => {
  const c = TEMPLATES.apple({ ...base, kind: 'charge', date: '2026-05-03', amount: 1100, appName: 'iCloud+', itemName: 'iCloud+ 50GB', nextDate: '2026-06-03' })!;
  const r = parseEmail(mail('naver', '2026-05-03', c.from, c.subject, c.text));
  assert.ok(r);
  assert.equal(r.serviceId, 'icloud-plus');
  assert.equal(r.billedVia, 'apple');
  assert.equal(r.amount, 1100);
  assert.equal(r.cycle, 'monthly');
  assert.equal(r.nextDate, '2026-06-03');
});

test('카탈로그에 없는 앱도 애플 영수증의 상품명으로 구분한다', () => {
  const c = TEMPLATES.apple({ ...base, kind: 'charge', date: '2026-05-22', amount: 2500, appName: 'Bear', itemName: 'Bear Pro', nextDate: '2026-06-22' })!;
  const r = parseEmail(mail('naver', '2026-05-22', c.from, c.subject, c.text));
  assert.equal(r?.serviceId, 'app:bear-pro');
  assert.equal(r?.serviceName, 'Bear Pro');
});

test('앱스토어 단건 구매 영수증은 구독이 아니다', () => {
  const c = NOISE.appleOneTime(5500, '2026-07-09', 'us***@naver.com');
  assert.equal(parseEmail(mail('naver', '2026-07-09', c.from, c.subject, c.text)), null);
});

test('달러 영수증은 USD 금액으로 읽는다', () => {
  const c = TEMPLATES.openai({ ...base, kind: 'charge', date: '2026-05-09', amount: 20, currency: 'USD', itemName: 'ChatGPT Plus' })!;
  const r = parseEmail(mail('gmail', '2026-05-09', c.from, c.subject, c.text));
  assert.equal(r?.serviceId, 'chatgpt-plus');
  assert.equal(r?.currency, 'USD');
  assert.equal(r?.amount, 20);
});

test('멤버십 문구가 들어간 일반 주문 메일은 구독 결제로 보지 않는다', () => {
  const c = NOISE.coupangOrder(32500, '삼다수 2L x 12');
  assert.equal(parseEmail(mail('naver', '2026-06-01', c.from, c.subject, c.text)), null);
});

test('발신 도메인이 다른 피싱 메일은 무시한다', () => {
  const c = NOISE.phishing();
  assert.equal(parseEmail(mail('gmail', '2026-09-01', c.from, c.subject, c.text)), null);
});

test('해지 메일과 갱신 예정 메일을 구분한다', () => {
  const cancel = TEMPLATES.disney({ ...base, kind: 'cancel', date: '2026-07-25', itemName: '디즈니+ 스탠다드', nextDate: '2026-08-10' })!;
  assert.equal(parseEmail(mail('gmail', '2026-07-25', cancel.from, cancel.subject, cancel.text))?.type, 'cancel');

  const notice = TEMPLATES.microsoft({ ...base, kind: 'upcoming', date: '2026-10-13', amount: 89000, itemName: 'Microsoft 365 Personal', nextDate: '2026-11-12' })!;
  const r = parseEmail(mail('gmail', '2026-10-13', notice.from, notice.subject, notice.text));
  assert.equal(r?.type, 'upcoming');
  assert.equal(r?.cycle, 'yearly');
  assert.equal(r?.nextDate, '2026-11-12');
});

test('Gmail과 네이버메일에 같은 영수증이 있으면 하나만 남긴다', () => {
  const c = TEMPLATES.netflix({ ...base, kind: 'charge', date: '2026-05-05', amount: 13500, itemName: '스탠다드', nextDate: '2026-06-05' })!;
  const receipts = parseEmails([mail('gmail', '2026-05-05', c.from, c.subject, c.text), mail('naver', '2026-05-05', c.from, c.subject, c.text)]);
  assert.equal(receipts.length, 2);
  assert.equal(receipts.filter((r) => r.duplicateOf).length, 1);
});

test('모르는 발신자는 제목에 구독 표현이 있을 때만 영수증으로 본다', () => {
  const sub = parseEmail(mail('gmail', '2026-05-02', 'Readly <billing@readly.app>', '정기구독 결제가 완료되었습니다', '결제 금액: 6,900원'));
  assert.equal(sub?.serviceId, 'mail:readly.app');
  assert.equal(sub?.amount, 6900);
  const ad = parseEmail(mail('gmail', '2026-05-02', '무신사 <news@musinsa.com>', '[광고] 결제 완료 고객 감사 쿠폰', '쿠폰 5,000원'));
  assert.equal(ad, null);
});
