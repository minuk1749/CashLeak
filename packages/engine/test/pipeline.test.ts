import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.ts';
import { importBankCsv, importCardCsv, importPayCsv } from '../src/io/importers.ts';
import { BANK, CARD, generateShowcase, PAY_NAME } from '../sim/generator.ts';
import { bankCsv, cardCsv, payCsv } from '../sim/export.ts';
import { scoreResult } from '../sim/score.ts';
import { TEMPLATES } from '../sim/mail-templates.ts';
import { bankTx, cardTx, mail, monthlyDates } from './helpers.ts';

test('CSV로 내보냈다가 다시 읽어도 거래내역이 같다', () => {
  const data = generateShowcase();
  const bank = data.transactions.filter((t) => t.source === 'bank');
  const card = data.transactions.filter((t) => t.source === 'card');
  const kakao = data.transactions.filter((t) => t.institution === PAY_NAME.kakaopay);
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(importBankCsv(bankCsv(bank), { idPrefix: 'bank', institution: BANK })), plain(bank));
  assert.deepEqual(plain(importCardCsv(cardCsv(card), { idPrefix: 'card', institution: CARD })), plain(card));
  assert.deepEqual(plain(importPayCsv(payCsv(kakao), { idPrefix: 'kakaopay', institution: PAY_NAME.kakaopay })), plain(kakao));
});

test('데모 사용자: 찾을 수 있는 구독은 모두 찾고, 확정 목록에 오탐이 없다', () => {
  const data = generateShowcase();
  const result = runPipeline({ transactions: data.transactions, emails: data.emails, asOf: data.asOf });
  const score = scoreResult(data, result);
  assert.deepEqual(score.misses.map((t) => t.key), []);
  assert.deepEqual(score.fieldErrors, []);
  assert.equal(score.shown, score.shownCorrect);
  assert.deepEqual(score.undetectable.map((t) => t.key), ['tving']);
  assert.equal(score.links.correct, score.links.expected);
  assert.equal(score.links.predicted, score.links.expected);
});

test('결제대행사로 찍힌 구독은 영수증 한 통이라도 다음 결제일이 맞으면 서비스를 확정한다', () => {
  const txs = monthlyDates('2026-05-20', 6).map((d) => cardTx(d, '(주)케이지이니시스', 9900));
  const c = TEMPLATES.millie({ kind: 'charge', date: '2026-08-20', amount: 9900, currency: 'KRW', itemName: '밀리의 서재', nextDate: '2026-09-20', account: '', ref: '' })!;
  const result = runPipeline({ transactions: txs, emails: [mail('gmail', '2026-08-20', c.from, c.subject, c.text)], asOf: '2026-10-26' });
  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.subscriptions[0].serviceId, 'millie');
  assert.deepEqual(result.subscriptions[0].sources, ['card', 'gmail']);
});

test('거래내역에 한 번뿐인 연간 결제는 영수증 메일과 연결한다', () => {
  const c = TEMPLATES.microsoft({ kind: 'charge', date: '2026-06-12', amount: 89000, currency: 'KRW', itemName: 'Microsoft 365 Personal', nextDate: '2027-06-12', account: '', ref: '' })!;
  const result = runPipeline({
    transactions: [cardTx('2026-06-12', 'MICROSOFT*STORE', 89000), cardTx('2026-10-20', 'GS25 역삼점', 3000)],
    emails: [mail('gmail', '2026-06-12', c.from, c.subject, c.text)],
    asOf: '2026-10-26',
  });
  const [m365] = result.subscriptions;
  assert.equal(m365.serviceId, 'microsoft-365');
  assert.equal(m365.cycle, 'yearly');
  assert.equal(m365.nextPaymentDate, '2027-06-12');
  assert.equal(m365.transactionIds.length, 1);
});

test('모르는 가맹점에서 매달 금액이 다른 결제는 확정하지 않고, 자동이체면 정기 결제로 본다', () => {
  const amounts = [20400, 10800, 12800];
  const dates = monthlyDates('2026-08-10', 3);
  const taxi = runPipeline({ transactions: dates.map((d, i) => cardTx(d, '카카오T 택시', amounts[i])), emails: [], asOf: '2026-10-26' });
  assert.equal(taxi.subscriptions[0].confidenceLabel, '낮음');
  const heating = runPipeline({ transactions: dates.map((d, i) => bankTx(d, '서울에너지공사', amounts[i], '자동이체')), emails: [], asOf: '2026-10-26' });
  assert.equal(heating.subscriptions[0].confidenceLabel, '보통');
});

