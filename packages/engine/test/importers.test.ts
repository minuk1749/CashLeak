import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCsvKind, guessInstitution, importBankCsv, importPayCsv } from '../src/io/importers.ts';

test('머리글로 통장·카드·간편결제 내역을 구분한다', () => {
  assert.equal(detectCsvKind('거래일시,구분,거래유형,내용,거래금액,거래후잔액\n'), 'bank');
  assert.equal(detectCsvKind('거래일시,출금금액,입금금액,거래내용\n'), 'bank');
  assert.equal(detectCsvKind('이용일자,이용시간,가맹점명,이용금액\n'), 'card');
  assert.equal(detectCsvKind('이용일자,이용시간,이용카드,가맹점명,이용금액,결제방법\n'), 'card');
  assert.equal(detectCsvKind('거래일시,구분,거래처,금액,결제수단,상태\n'), 'pay');
  assert.equal(detectCsvKind('a,b,c\n'), null);
});

test('파일 이름으로 기관을 추측한다', () => {
  assert.equal(guessInstitution('nh-bank.csv', 'bank'), '농협은행');
  assert.equal(guessInstitution('농협_거래내역.csv', 'bank'), '농협은행');
  // shinhan 안의 "nh"를 농협으로 잘못 읽지 않는다.
  assert.equal(guessInstitution('shinhan-card.csv', 'card'), '신한카드');
  assert.equal(guessInstitution('kakaopay.csv', 'pay'), '카카오페이');
  assert.equal(guessInstitution('카카오뱅크.csv', 'bank'), '카카오뱅크');
  assert.equal(guessInstitution('naverpay_2026.csv', 'pay'), '네이버페이');
  assert.equal(guessInstitution('export.csv', 'card'), '카드');
});

test('출금·입금 열이 따로 있는 통장 내역을 읽는다', () => {
  const csv = [
    '거래일시,출금금액(원),입금금액(원),거래후잔액(원),거래내용,거래기록사항',
    '2026/10/02 09:15:03,"10,900",0,"1,000,000",카카오페이,',
    '2026/10/25 10:00:00,0,"3,200,000","4,200,000",급여,(주)테크컴퍼니',
  ].join('\n');
  const [out, income] = importBankCsv(csv, { idPrefix: 'nh', institution: '농협은행' });
  assert.deepEqual(
    { date: out.date, time: out.time, amount: out.amount, direction: out.direction, merchant: out.merchant, institution: out.institution },
    { date: '2026-10-02', time: '09:15:03', amount: 10900, direction: 'out', merchant: '카카오페이', institution: '농협은행' },
  );
  assert.equal(income.direction, 'in');
  assert.equal(income.amount, 3200000);
  assert.equal(income.memo, '(주)테크컴퍼니');
});

test('간편결제 내역: 충전·송금을 구분하고 취소된 결제는 뺀다', () => {
  const csv = [
    '거래일시,구분,거래처,금액,결제수단,상태',
    '2026-10-06 08:00:00,충전,카카오페이머니 충전,"10,000",농협 계좌,완료',
    '2026-10-06 08:00:00,결제,이모티콘 플러스,"-3,900",카카오페이머니,완료',
    '2026-10-07 21:00:00,결제,카카오 선물하기,"-25,000",농협 계좌,취소',
    '2026-10-08 12:30:00,송금,김서연,"-30,000",농협 계좌,완료',
  ].join('\n');
  const txs = importPayCsv(csv, { idPrefix: 'kakao', institution: '카카오페이' });
  assert.deepEqual(
    txs.map((t) => [t.kind, t.direction, t.amount, t.funding]),
    [
      ['topup', 'in', 10000, '농협 계좌'],
      ['payment', 'out', 3900, '카카오페이머니'],
      ['transfer', 'out', 30000, '농협 계좌'],
    ],
  );
});

test('머리글 위의 안내 줄과 끝의 합계 줄은 건너뛴다', () => {
  const csv = [
    '계좌번호,302-1234-5678-91',
    '조회기간,2026.05.01 ~ 2026.10.26',
    '',
    '거래일시,구분,거래유형,내용,거래금액,거래후잔액',
    '2026.10.02 09:15:03,출금,간편결제,카카오페이,"-10,900","989,100"',
    '합계,,,,"-10,900",',
  ].join('\n');
  assert.equal(detectCsvKind(csv), 'bank');
  const skipped: string[][] = [];
  const txs = importBankCsv(csv, { onSkip: (row) => skipped.push(row) });
  assert.equal(txs.length, 1);
  assert.equal(txs[0].id, 'bank-1');
  assert.equal(skipped.length, 1);
});

test('머리글을 못 찾으면 무엇이 없는지 알려 준다', () => {
  assert.throws(() => importPayCsv('이름,나이\n홍길동,30\n'), /머리글/);
});

