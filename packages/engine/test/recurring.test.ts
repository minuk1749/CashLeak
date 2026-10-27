import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring } from '../src/detect/recurring.ts';
import { bankTx, cardTx, monthlyDates } from './helpers.ts';

const asOf = '2026-10-26';

test('매달 같은 날 같은 금액이면 구독으로 찾고 다음 결제일을 계산한다', () => {
  const txs = monthlyDates('2026-05-07', 6).map((d) => cardTx(d, 'GOOGLE*YOUTUBEPREMIUM', 14900));
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].serviceId, 'youtube-premium');
  assert.equal(series[0].nextDate, '2026-11-07');
  assert.equal(series[0].active, true);
});

test('31일 결제는 짧은 달에 말일로 당겨져도 같은 구독이다', () => {
  const dates = ['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'];
  const { series } = detectRecurring(dates.map((d) => cardTx(d, '핏앤짐 역삼점', 77000)), { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].nextDate, '2026-10-31');
});

test('통장 자동이체가 주말·공휴일로 며칠 밀려도 같은 구독이다', () => {
  const dates = ['2026-05-26', '2026-06-25', '2026-07-27', '2026-08-25', '2026-09-25', '2026-10-26'];
  const { series } = detectRecurring(dates.map((d) => bankTx(d, '코웨이(주)', 29900, 'CMS')), { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].serviceId, 'coway');
  assert.equal(series[0].nextDate, '2026-11-25');
});

test('가격이 한 번 오르면 같은 구독의 가격 변경으로 기록한다', () => {
  const txs = monthlyDates('2026-05-05', 6).map((d, i) => cardTx(d, 'NETFLIX.COM', i < 3 ? 13500 : 17000));
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].amount, 17000);
  assert.deepEqual(series[0].priceChanges.map((c) => [c.from, c.to, c.date]), [[13500, 17000, '2026-08-05']]);
});

test('애플처럼 한 가맹점에 구독이 여러 개면 금액별로 나눈다', () => {
  const txs = [
    ...monthlyDates('2026-05-03', 6).map((d) => cardTx(d, 'APPLE.COM/BILL', 1100)),
    ...monthlyDates('2026-05-18', 6).map((d) => cardTx(d, 'APPLE.COM/BILL', 13000)),
    cardTx('2026-07-09', 'APPLE.COM/BILL', 5500),
  ];
  const { series, unmatched } = detectRecurring(txs, { asOf });
  assert.deepEqual(series.map((s) => s.amount).sort((a, b) => a - b), [1100, 13000]);
  assert.ok(series.every((s) => s.via === 'apple'));
  assert.deepEqual(unmatched.map((t) => t.amount), [5500]);
});

test('해외 결제는 원화가 매달 달라도 달러 금액이 같으면 고정 금액 구독이다', () => {
  const txs = monthlyDates('2026-05-09', 6).map((d, i) =>
    cardTx(d, 'OPENAI *CHATGPT SUBSCR', 27000 + i * 137, { foreignAmount: 20, foreignCurrency: 'USD' }),
  );
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].amountVaries, false);
  assert.equal(series[0].foreignAmount, 20);
});

test('통신비처럼 매달 금액이 다른 자동이체도 찾는다', () => {
  const amounts = [55120, 57810, 52990, 60100, 54260, 56030];
  const txs = monthlyDates('2026-05-21', 6).map((d, i) => bankTx(d, 'SKT통신요금', amounts[i], '자동이체'));
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series.length, 1);
  assert.equal(series[0].kind, 'bill');
  assert.equal(series[0].amountVaries, true);
});

test('결제가 끊기면 해지로 추정한다', () => {
  const txs = ['2026-05-10', '2026-06-10', '2026-07-10'].map((d) => cardTx(d, '디즈니플러스', 9900));
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series[0].active, false);
});

test('1년 간격 결제는 연간 구독으로 본다', () => {
  const txs = ['2025-06-12', '2026-06-12'].map((d) => cardTx(d, 'MICROSOFT*STORE', 89000));
  const { series } = detectRecurring(txs, { asOf });
  assert.equal(series[0].cycle, 'yearly');
  assert.equal(series[0].nextDate, '2027-06-12');
});

test('한 달 남짓마다 가지만 날짜가 계속 밀리는 결제는 구독이 아니다', () => {
  const dates = ['2026-05-03', '2026-06-08', '2026-07-14', '2026-08-18', '2026-09-24', '2026-10-25'];
  const { series } = detectRecurring(dates.map((d) => cardTx(d, '블루클럽 역삼점', 15000)), { asOf });
  assert.equal(series.length, 0);
});

test('같은 가게의 잦은 결제는 구독이 아니다', () => {
  const txs = [];
  for (let i = 0; i < 50; i++) {
    const date = new Date(Date.UTC(2026, 4, 1 + i * 3)).toISOString().slice(0, 10);
    txs.push(cardTx(date, '스타벅스 역삼점', [4500, 5000, 6100][i % 3]));
  }
  assert.equal(detectRecurring(txs, { asOf }).series.length, 0);
});

test('자주 가는 가게에서 우연히 한 달 간격으로 같은 금액이 두 번 나온 것은 거른다', () => {
  const txs = [
    cardTx('2026-06-12', 'GS25 역삼점', 4400),
    cardTx('2026-07-12', 'GS25 역삼점', 4400),
    ...['2026-06-01', '2026-06-05', '2026-06-20', '2026-07-02', '2026-07-19', '2026-08-03'].map((d, i) =>
      cardTx(d, 'GS25 역삼점', 2000 + i * 300),
    ),
  ];
  assert.equal(detectRecurring(txs, { asOf }).series.length, 0);
});

test('카드대금, 적금, 현금 인출은 빼고 개인 송금은 정기 이체로 분류한다', () => {
  const txs = [
    ...monthlyDates('2026-05-14', 6).map((d) => bankTx(d, '신한카드', 800000, '자동이체')),
    ...monthlyDates('2026-05-01', 6).map((d) => bankTx(d, '토스뱅크 적금', 300000, '자동이체')),
    ...monthlyDates('2026-05-10', 6).map((d) => bankTx(d, 'ATM 출금', 50000, 'ATM')),
    ...monthlyDates('2026-05-25', 6).map((d) => bankTx(d, '박지훈', 550000, '이체', { memo: '월세' })),
  ];
  const { series, excluded } = detectRecurring(txs, { asOf });
  assert.deepEqual(excluded.map((e) => e.merchant).sort(), ['ATM 출금', '신한카드', '토스뱅크 적금']);
  assert.equal(series.length, 1);
  assert.equal(series[0].kind, 'transfer');
});

test('가맹점명 뒤에 붙는 번호가 달라도 같은 가맹점으로 묶는다', () => {
  const txs = monthlyDates('2026-05-01', 6).map((d, i) => cardTx(d, i % 2 ? `핏앤짐 역삼점 ${48210 + i}` : '핏앤짐 역삼점', 77000));
  assert.equal(detectRecurring(txs, { asOf }).series.length, 1);
});
