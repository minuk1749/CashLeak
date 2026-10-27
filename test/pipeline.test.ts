import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.ts';
import { dedupeTransactions } from '../src/detect/dedupe.ts';
import { importBankCsv, importCardCsv } from '../src/io/importers.ts';
import { generateShowcase } from '../sim/generator.ts';
import { bankCsv, cardCsv } from '../sim/export.ts';
import { scoreResult } from '../sim/score.ts';
import { TEMPLATES } from '../sim/mail-templates.ts';
import { bankTx, cardTx, mail, monthlyDates } from './helpers.ts';

test('CSV로 내보냈다가 다시 읽어도 거래내역이 같다', () => {
  const data = generateShowcase();
  const bank = data.transactions.filter((t) => t.source === 'bank');
  const card = data.transactions.filter((t) => t.source === 'card');
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(importBankCsv(bankCsv(bank))), plain(bank));
  assert.deepEqual(plain(importCardCsv(cardCsv(card))), plain(card));
});

test('데모 사용자: 찾을 수 있는 구독은 모두 찾고, 확정 목록에 오탐이 없다', () => {
  const data = generateShowcase();
  const result = runPipeline({ transactions: data.transactions, emails: data.emails, asOf: data.asOf });
  const score = scoreResult(0, result, data.truth);
  assert.deepEqual(score.misses.map((t) => t.key), []);
  assert.deepEqual(score.fieldErrors, []);
  assert.equal(score.shown, score.shownCorrect);
  assert.deepEqual(score.undetectable.map((t) => t.key), ['tving']);
});

test('통장과 카드 내역에 같은 체크카드 결제가 있으면 하나만 센다', () => {
  const { transactions, duplicates } = dedupeTransactions([
    bankTx('2026-05-03', '세븐일레븐 역삼점', 3500, '체크카드'),
    cardTx('2026-05-03', '세븐일레븐 역삼점', 3500),
    bankTx('2026-05-04', '세븐일레븐 역삼점', 3500, '체크카드'),
  ]);
  assert.equal(duplicates, 1);
  assert.equal(transactions.length, 2);
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
