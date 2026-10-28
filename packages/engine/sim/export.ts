// 가상 거래내역을 은행·카드사·간편결제 내보내기 파일과 비슷한 CSV로 쓴다.
// 실제 기관의 형식이 아니라 흔히 보이는 열 이름을 흉내 낸 것이다.
import type { Transaction, TxKind } from '../src/types.ts';
import { toCsv } from '../src/io/csv.ts';

const fmt = (n: number) => n.toLocaleString('ko-KR');

export function bankCsv(txs: Transaction[], openingBalance = 5_000_000): string {
  let balance = openingBalance;
  const rows = txs.map((t) => {
    balance += t.direction === 'in' ? t.amount : -t.amount;
    return [
      `${t.date} ${t.time ?? '00:00:00'}`,
      t.direction === 'in' ? '입금' : '출금',
      t.method,
      t.merchant,
      (t.direction === 'in' ? '' : '-') + fmt(t.amount),
      fmt(balance),
      t.memo,
    ];
  });
  return toCsv([['거래일시', '구분', '거래유형', '내용', '거래금액', '거래후잔액', '메모'], ...rows]);
}

export function cardCsv(txs: Transaction[], cardName = '신한카드(1234)'): string {
  const rows = txs.map((t, i) => [
    t.date,
    t.time,
    cardName,
    t.merchant,
    fmt(t.amount),
    t.foreignAmount?.toFixed(2),
    t.foreignCurrency,
    t.method,
    String(30000000 + i * 7919).slice(0, 8),
  ]);
  return toCsv([['이용일자', '이용시간', '이용카드', '가맹점명', '이용금액', '해외이용금액', '통화', '결제방법', '승인번호'], ...rows]);
}

/** 간편결제 내역의 '구분' 열 문구 */
export const PAY_KIND_LABEL: Record<TxKind, string> = { payment: '결제', topup: '충전', transfer: '송금', refund: '환불' };

export function payCsv(txs: Transaction[]): string {
  const rows = txs.map((t) => [
    `${t.date} ${t.time ?? '00:00:00'}`,
    t.method ?? PAY_KIND_LABEL[t.kind ?? 'payment'],
    t.merchant,
    (t.direction === 'in' ? '' : '-') + fmt(t.amount),
    t.funding,
    '완료',
  ]);
  return toCsv([['거래일시', '구분', '거래처', '금액', '결제수단', '상태'], ...rows]);
}
