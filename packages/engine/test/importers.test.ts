import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCsvKind, detectKind, guessInstitution, importBankCsv, importPayCsv, importRows } from '../src/io/importers.ts';
import { exclusionReason } from '../src/merchants.ts';

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


// 아래 두 표는 실제로 받은 엑셀과 같은 모양(안내 줄, 머리글, 구분 문구)에 가상 값을 넣은 것이다.

test('토스뱅크 형식: 금액 부호로 입출금을, 예금주 이름으로 내 계좌 이동을 가린다', () => {
  const rows = [
    ['', '토스뱅크 거래내역'],
    ['', '성명', '홍길동'],
    ['', '계좌번호', '1000-0000-0000'],
    ['', '조회기간', '2026.05.01 ~ 2026.10.27'],
    ['', '※ 본 거래내역은 법적효력이 없는 참고용 문서입니다.'],
    [],
    ['', '거래 일시', '적요', '거래 유형', '거래 기관', '계좌번호', '거래 금액', '거래 후 잔액', '메모'],
    ['', '2026.10.05 09:12:03', '밀리의서재', '오픈뱅킹', '', '', '-9900', '90100', ''],
    ['', '2026.10.20 12:00:00', '홍길동', '입금', 'NH농협은행', '30200000000000', '100000', '190100', ''],
    ['', '2026.10.21 08:00:00', '홍길동', '출금', 'NH농협은행', '30200000000000', '-50000', '140100', ''],
    ['', '2026.10.22 19:40:11', '세븐일레븐 역삼점', '체크카드결제', '', '', '3500', '143600', ''],
  ];
  assert.equal(detectKind(rows), 'bank');
  const txs = importRows(rows, 'bank', { institution: '토스뱅크' });
  assert.deepEqual(
    txs.map((t) => [t.date, t.time, t.merchant, t.direction, t.amount, t.method]),
    [
      ['2026-10-05', '09:12:03', '밀리의서재', 'out', 9900, '오픈뱅킹'],
      ['2026-10-20', '12:00:00', '홍길동 (내 계좌)', 'in', 100000, '입금'],
      ['2026-10-21', '08:00:00', '홍길동 (내 계좌)', 'out', 50000, '출금'],
      // 체크카드 결제 취소는 같은 거래 유형에 양수 금액으로 찍힌다.
      ['2026-10-22', '19:40:11', '세븐일레븐 역삼점', 'in', 3500, '체크카드결제'],
    ],
  );
  assert.equal(exclusionReason(txs[2]), '내 계좌로 옮긴 돈');
  assert.equal(exclusionReason(txs[0]), undefined);
});

test('카카오페이 머니 형식: [+]/[-] 표시로 방향을, 은행 열로 충전 계좌를 읽는다', () => {
  const rows = [
    ['홍길동님', '거래내역 확인기간'],
    ['2026.10.27 10:47:45', '2026.05.01 ~ 2026.10.27'],
    ['거래일시', '거래구분', '거래금액', '거래 후 잔액', '은행', '계좌 정보 / 결제 정보'],
    ['2026-10-07 10:00:00', '[+] 부족분충전', '2900', '2900', '토스뱅크', '토스뱅크 100000******'],
    ['2026-10-07 10:00:00', '[-] 결제', '2900', '0', '', '이모티콘 플러스'],
    ['2026-10-20 09:00:00', '[+] 받기', '20000', '20000', '', '김서연'],
    ['2026-10-21 09:00:00', '[-] 내계좌로_내보내기', '15000', '5000', '농협', '농협 302000******'],
    ['2026-10-22 09:00:00', '[-] 10034 (관리자 문의)', '5000', '0', '농협', '농협 302000******'],
    ['2026-10-23 09:00:00', '[+] 결제취소', '2900', '2900', '', '이모티콘 플러스'],
  ];
  // 잔액 열이 있어도 '계좌 정보 / 결제 정보' 열이 있으면 통장이 아니라 간편결제 내역이다.
  assert.equal(detectKind(rows), 'pay');
  const txs = importRows(rows, 'pay', { institution: '카카오페이' });
  assert.deepEqual(
    txs.map((t) => [t.kind, t.direction, t.amount, t.funding, t.merchant, t.method]),
    [
      ['topup', 'in', 2900, '토스뱅크', '토스뱅크 100000******', '부족분충전'],
      ['payment', 'out', 2900, '카카오페이 머니', '이모티콘 플러스', '결제'],
      ['transfer', 'in', 20000, undefined, '김서연', '받기'],
      ['transfer', 'out', 15000, '카카오페이 머니', '농협 302000******', '내계좌로_내보내기'],
      // '내계좌로 내보내기'에 나온 계좌로 간 다른 출금도 내 계좌로 옮긴 돈이다.
      ['payment', 'out', 5000, '카카오페이 머니', '농협 302000****** (내 계좌)', '10034 (관리자 문의)'],
      ['refund', 'in', 2900, undefined, '이모티콘 플러스', '결제취소'],
    ],
  );
  assert.deepEqual(
    txs.filter((t) => t.direction === 'out').map((t) => exclusionReason(t)),
    [undefined, '내 계좌로 옮긴 돈', '내 계좌로 옮긴 돈'],
  );
});
