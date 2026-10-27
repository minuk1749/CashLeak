import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/reconcile.ts';
import { runPipeline } from '../src/pipeline.ts';
import { bankTx, cardTx, monthlyDates, payTx } from './helpers.ts';

const NH = { institution: '농협은행' };
const SHINHAN = { institution: '신한카드' };

test('카카오페이 계좌 결제는 통장의 "카카오페이" 출금과 합치고 경로를 남긴다', () => {
  const bank = bankTx('2026-05-16', '카카오페이', 10900, '간편결제', { ...NH, time: '12:00:07' });
  const pay = payTx('2026-05-16', '멜론', 10900, '농협 계좌', { time: '12:00:00' });
  const { ledger, merged } = reconcile([bank, pay]);
  assert.equal(merged, 1);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].merchant, '멜론');
  assert.deepEqual(ledger[0].path, ['농협은행 계좌', '카카오페이']);
  assert.deepEqual(ledger[0].linkedIds, [bank.id]);
});

test('네이버페이 카드 결제는 카드 이용내역의 "네이버페이"와 합친다', () => {
  const card = cardTx('2026-05-15', '네이버페이', 4900, { ...SHINHAN, time: '09:10:12' });
  const pay = payTx('2026-05-15', '네이버플러스 멤버십', 4900, '신한카드', { institution: '네이버페이', time: '09:10:00' });
  const { ledger } = reconcile([card, pay]);
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0].path, ['신한카드', '네이버페이']);
});

test('페이 머니 충전은 내 돈이 옮겨간 것이라 결제에서 빼고, 머니 결제는 충전한 계좌를 경로로 쓴다', () => {
  const bank = bankTx('2026-05-06', '카카오페이', 10000, '간편결제', { ...NH, time: '08:00:05' });
  const topup = payTx('2026-05-06', '카카오페이머니 충전', 10000, '농협 계좌', { time: '08:00:00', kind: 'topup', direction: 'in' });
  const pay = payTx('2026-05-06', '이모티콘 플러스', 3900, '카카오페이머니', { time: '08:00:00' });
  const { ledger, internal, topups } = reconcile([bank, topup, pay]);
  assert.equal(topups, 1);
  assert.deepEqual(internal.map((t) => t.id).sort(), [bank.id, topup.id].sort());
  assert.deepEqual(ledger.map((t) => t.id), [pay.id]);
  assert.deepEqual(ledger[0].path, ['농협은행 계좌', '카카오페이 머니']);
});

test('결제수단이 없는 내역은 시각이 없어도 같은 날 같은 금액의 그 페이 출금과 맞춘다', () => {
  const bank = bankTx('2026-06-02', '카카오페이', 15000, '간편결제', NH);
  const pay = payTx('2026-06-02', '카카오T 택시', 15000, undefined);
  const { ledger } = reconcile([bank, pay]);
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0].path, ['농협은행 계좌', '카카오페이']);
});

test('다른 페이의 출금이나 금액이 다른 출금과는 합치지 않는다', () => {
  const naver = bankTx('2026-06-02', '네이버파이낸셜', 15000, '간편결제', { ...NH, time: '10:00:03' });
  const other = bankTx('2026-06-02', '카카오페이', 15500, '간편결제', { ...NH, time: '10:00:04' });
  const pay = payTx('2026-06-02', '카카오T 택시', 15000, '농협 계좌', { time: '10:00:00' });
  const { ledger, merged } = reconcile([naver, other, pay]);
  assert.equal(merged, 0);
  assert.equal(ledger.length, 3);
  assert.deepEqual(ledger.find((t) => t.id === pay.id)?.path, ['카카오페이']);
});

test('통장과 카드 내역에 같은 체크카드 결제가 있으면 하나만 센다', () => {
  const card = cardTx('2026-05-03', '세븐일레븐 역삼점', 3500, { institution: 'NH농협카드' });
  const { ledger, merged } = reconcile([
    bankTx('2026-05-03', '세븐일레븐 역삼점', 3500, '체크카드', NH),
    card,
    bankTx('2026-05-04', '세븐일레븐 역삼점', 3500, '체크카드', NH),
  ]);
  assert.equal(merged, 1);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger.find((t) => t.id === card.id)?.path, ['농협은행 계좌', 'NH농협카드']);
});

test('간편결제 내역까지 올리면 통장의 "카카오페이" 정기 출금이 어떤 구독인지 밝혀진다', () => {
  const dates = monthlyDates('2026-05-16', 6);
  const bank = dates.map((d) => bankTx(d, '카카오페이', 10900, '간편결제', { ...NH, time: '12:00:05' }));
  const pays = dates.map((d) => payTx(d, '멜론', 10900, '농협 계좌', { time: '12:00:00' }));

  const onlyBank = runPipeline({ transactions: bank, emails: [], asOf: '2026-10-26' });
  assert.equal(onlyBank.subscriptions[0].key, 'via:kakaopay');
  assert.deepEqual(onlyBank.subscriptions[0].paymentPath, ['농협은행 계좌', '카카오페이']);

  const both = runPipeline({ transactions: [...bank, ...pays], emails: [], asOf: '2026-10-26' });
  assert.equal(both.subscriptions.length, 1);
  const [melon] = both.subscriptions;
  assert.equal(melon.serviceId, 'melon');
  assert.equal(melon.nextPaymentDate, '2026-11-16');
  assert.deepEqual(melon.paymentPath, ['농협은행 계좌', '카카오페이']);
  assert.deepEqual(melon.sources, ['bank', 'pay']);
  assert.equal(both.stats.mergedTransactions, 6);
});
