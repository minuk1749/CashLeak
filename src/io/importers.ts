import type { Transaction } from '../types.ts';
import { parseCsv } from './csv.ts';

// 은행·카드사마다 내보내기 형식이 다르다. 머리글 이름 후보로 열을 찾기 때문에
// 열 이름만 비슷하면 그대로 읽히고, 다르면 후보를 추가하면 된다.
// 실제 토스·은행·카드사 파일을 받으면 형식별 후보와 테스트를 추가할 것.

const BANK_COLUMNS = {
  datetime: ['거래일시', '거래일자', '일시', '날짜'],
  direction: ['구분', '입출금구분'],
  method: ['거래유형', '거래구분'],
  merchant: ['내용', '적요', '받는분', '거래처', '기재내용'],
  amount: ['거래금액', '금액'],
  withdrawal: ['출금액', '출금'],
  deposit: ['입금액', '입금'],
  memo: ['메모', '비고'],
};

const CARD_COLUMNS = {
  date: ['이용일자', '이용일', '승인일자', '거래일자'],
  time: ['이용시간', '승인시간'],
  merchant: ['가맹점명', '이용가맹점', '이용하신곳', '가맹점'],
  amount: ['이용금액', '승인금액', '금액'],
  foreignAmount: ['해외이용금액', '현지금액', '해외승인금액'],
  currency: ['통화', '현지통화'],
  method: ['결제방법', '이용구분', '할부'],
};

type Columns<T> = { [K in keyof T]: number };

function locate<T extends Record<string, string[]>>(header: string[], spec: T): Columns<T> {
  const clean = header.map((h) => h.replace(/\s/g, ''));
  const out = {} as Columns<T>;
  for (const key of Object.keys(spec) as (keyof T)[]) {
    out[key] = clean.findIndex((h) => spec[key].includes(h));
  }
  return out;
}

const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '');

function parseAmount(raw: string): number {
  const n = Number(raw.replace(/[,원\s₩]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDateTime(raw: string): { date: string; time?: string } {
  const m = raw.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})(?:일)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error(`날짜를 읽을 수 없습니다: ${raw}`);
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const time = m[4] ? `${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}` : undefined;
  return { date, time };
}

export function importBankCsv(text: string, idPrefix = 'bank'): Transaction[] {
  const [header, ...rows] = parseCsv(text);
  const col = locate(header, BANK_COLUMNS);
  return rows.map((row, i) => {
    const { date, time } = parseDateTime(cell(row, col.datetime));
    let amount = parseAmount(cell(row, col.amount));
    let direction: 'out' | 'in' = amount < 0 ? 'out' : 'in';
    if (col.withdrawal >= 0 || col.deposit >= 0) {
      const out = parseAmount(cell(row, col.withdrawal));
      direction = out > 0 ? 'out' : 'in';
      amount = out > 0 ? out : parseAmount(cell(row, col.deposit));
    }
    const label = cell(row, col.direction);
    if (label) direction = /출금|지급/.test(label) ? 'out' : 'in';
    return {
      id: `${idPrefix}-${i + 1}`,
      source: 'bank',
      date,
      time,
      merchant: cell(row, col.merchant),
      amount: Math.abs(amount),
      direction,
      method: cell(row, col.method) || undefined,
      memo: cell(row, col.memo) || undefined,
    };
  });
}

export function importCardCsv(text: string, idPrefix = 'card'): Transaction[] {
  const [header, ...rows] = parseCsv(text);
  const col = locate(header, CARD_COLUMNS);
  return rows.map((row, i) => {
    const { date, time } = parseDateTime(cell(row, col.date));
    const amount = parseAmount(cell(row, col.amount));
    const method = cell(row, col.method);
    const foreign = parseAmount(cell(row, col.foreignAmount));
    const currency = cell(row, col.currency).toUpperCase();
    const tx: Transaction = {
      id: `${idPrefix}-${i + 1}`,
      source: 'card',
      date,
      time: time ?? (cell(row, col.time) || undefined),
      merchant: cell(row, col.merchant),
      amount: Math.abs(amount),
      // 승인 취소·환불은 음수 금액이나 '취소'로 표시된다.
      direction: amount < 0 || /취소/.test(method) ? 'in' : 'out',
      method: method || undefined,
    };
    if (foreign && currency === 'USD') {
      tx.foreignAmount = Math.abs(foreign);
      tx.foreignCurrency = currency;
    }
    return tx;
  });
}
