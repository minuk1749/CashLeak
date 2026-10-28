import type { Transaction, TxKind, TxSource } from '../types.ts';
import { parseCsv } from './csv.ts';

// 은행·카드사·간편결제마다 내보내기 형식이 다르다. 머리글 이름 후보로 열을 찾기 때문에
// 열 이름만 비슷하면 그대로 읽히고, 다르면 후보를 추가하면 된다.
// 실제 파일로 확인한 형식: 토스뱅크 거래내역(.xlsx), 카카오페이 머니 거래내역(.xlsx).
// 엑셀 파일은 xlsx.ts가 표(string[][])로 바꾼 뒤 importRows로 읽는다.

const BANK_COLUMNS = {
  datetime: ['거래일시', '거래일자', '일시', '날짜'],
  time: ['거래시간', '시간'],
  direction: ['구분', '입출금구분'],
  method: ['거래유형', '거래구분'],
  merchant: ['내용', '적요', '받는분', '거래처', '기재내용', '거래내용'],
  amount: ['거래금액', '금액'],
  withdrawal: ['출금액', '출금', '출금금액', '찾으신금액'],
  deposit: ['입금액', '입금', '입금금액', '맡기신금액'],
  memo: ['메모', '비고', '거래기록사항'],
};

const CARD_COLUMNS = {
  date: ['이용일자', '이용일', '승인일자', '거래일자', '이용일시', '승인일시'],
  time: ['이용시간', '승인시간'],
  merchant: ['가맹점명', '이용가맹점', '이용하신곳', '가맹점'],
  amount: ['이용금액', '승인금액', '금액'],
  foreignAmount: ['해외이용금액', '현지금액', '해외승인금액'],
  currency: ['통화', '현지통화'],
  method: ['결제방법', '이용구분', '할부'],
};

const PAY_COLUMNS = {
  datetime: ['거래일시', '결제일시', '이용일시', '일시', '날짜'],
  kind: ['구분', '거래구분', '유형', '거래유형'],
  merchant: ['거래처', '가맹점', '가맹점명', '상호', '사용처', '상품명', '내용', '받는분', '계좌정보/결제정보'],
  amount: ['금액', '결제금액', '거래금액', '이용금액'],
  funding: ['결제수단', '출금수단', '지불수단', '결제방법'],
  status: ['상태', '결제상태', '처리상태'],
  /** 머니 거래내역: 충전·출금에 쓴 은행 (카카오페이 머니의 '은행' 열) */
  bank: ['은행'],
  balance: ['거래후잔액', '잔액'],
};

/** 간편결제 내역에만 있는 열. 카드 이용내역에도 '결제방법'(일시불·할부) 열이 있어서 따로 둔다. */
const PAY_ONLY_COLUMNS = ['결제수단', '출금수단', '지불수단', '계좌정보/결제정보'];

/** 머리글 위 안내 줄에 적힌 예금주 이름 (토스뱅크: '성명') */
const HOLDER_LABELS = ['성명', '예금주', '예금주명', '고객명'];

export interface ImportOptions {
  /** 거래 id 앞에 붙일 값. 파일마다 달라야 한다. */
  idPrefix?: string;
  /** 내역을 낸 곳 (농협은행, 신한카드, 카카오페이 등) */
  institution?: string;
  /** 거래로 읽지 못하고 건너뛴 줄 (합계 줄, 빈 줄 등) */
  onSkip?: (row: string[], reason: string) => void;
}

type Columns<T> = { [K in keyof T]: number };

const clean = (h: string) => h.replace(/\s|\(원\)/g, '');

function locate<T extends Record<string, string[]>>(header: string[], spec: T): Columns<T> {
  const names = header.map(clean);
  const out = {} as Columns<T>;
  for (const key of Object.keys(spec) as (keyof T)[]) {
    out[key] = names.findIndex((h) => spec[key].includes(h));
  }
  return out;
}

const cell = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '').trim() : '');

/**
 * 실제 내보내기 파일은 머리글 위에 계좌번호·조회기간 같은 줄이 붙는 경우가 많다.
 * 앞쪽 줄들 중 필요한 열 이름이 모두 있는 줄을 머리글로 보고, 그 위의 줄은 안내 줄(preamble)로 돌려준다.
 */
function findTable<T extends Record<string, string[]>>(all: string[][], spec: T, required: (keyof T)[][]) {
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const col = locate(all[i], spec);
    if (required.every((anyOf) => anyOf.some((k) => col[k] >= 0))) return { col, rows: all.slice(i + 1), preamble: all.slice(0, i) };
  }
  return null;
}

/** 안내 줄에서 '성명 | 홍길동' 처럼 이름표 바로 다음 칸에 적힌 예금주 이름 */
function holderName(preamble: string[][]): string | undefined {
  for (const row of preamble) {
    const i = row.findIndex((c) => HOLDER_LABELS.includes(clean(c)));
    const name = i >= 0 ? row.slice(i + 1).find((c) => c.trim())?.trim() : undefined;
    if (name) return name;
  }
  return undefined;
}

const BANK_REQUIRED: (keyof typeof BANK_COLUMNS)[][] = [['datetime'], ['amount', 'withdrawal', 'deposit']];
const CARD_REQUIRED: (keyof typeof CARD_COLUMNS)[][] = [['date'], ['merchant'], ['amount']];
const PAY_REQUIRED: (keyof typeof PAY_COLUMNS)[][] = [['datetime'], ['merchant'], ['amount']];

function requireTable<T extends Record<string, string[]>>(all: string[][], spec: T, required: (keyof T)[][], what: string) {
  const table = findTable(all, spec, required);
  if (!table) throw new Error(`${what} 머리글(날짜, 금액 등의 열 이름)을 찾지 못했습니다.`);
  return table;
}

/** 날짜를 읽을 수 없는 줄(합계, 안내 문구)은 건너뛴다. */
function readRows<T>(rows: string[][], options: ImportOptions, read: (row: string[]) => T | null): T[] {
  const out: T[] = [];
  for (const row of rows) {
    try {
      const tx = read(row);
      if (tx) out.push(tx);
    } catch (e) {
      options.onSkip?.(row, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

function parseAmount(raw: string): number {
  const n = Number(raw.replace(/[,원\s₩+]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDateTime(raw: string, timeRaw = ''): { date: string; time?: string } {
  const m = raw.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})(?:일)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error(`날짜를 읽을 수 없습니다: ${raw}`);
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const t = m[4] ? m.slice(4, 7) : timeRaw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)?.slice(1, 4);
  const time = t ? `${t[0].padStart(2, '0')}:${t[1]}:${t[2] ?? '00'}` : undefined;
  return { date, time };
}

/** 통장 거래내역. 본인 이름으로 오간 돈은 가맹점명 뒤에 '(내 계좌)'를 붙여 소비에서 뺀다. */
export function importBankRows(all: string[][], options: ImportOptions = {}): Transaction[] {
  const { idPrefix = 'bank', institution } = options;
  const { col, rows, preamble } = requireTable(all, BANK_COLUMNS, BANK_REQUIRED, '통장 내역');
  const holder = holderName(preamble);
  let n = 0;
  return readRows(rows, options, (row): Transaction => {
    const { date, time } = parseDateTime(cell(row, col.datetime), cell(row, col.time));
    let amount = parseAmount(cell(row, col.amount));
    let direction: 'out' | 'in' = amount < 0 ? 'out' : 'in';
    if (col.withdrawal >= 0 || col.deposit >= 0) {
      const out = parseAmount(cell(row, col.withdrawal));
      direction = out > 0 ? 'out' : 'in';
      amount = out > 0 ? out : parseAmount(cell(row, col.deposit));
    }
    const label = cell(row, col.direction);
    if (label) direction = /출금|지급/.test(label) ? 'out' : 'in';
    if (!amount) throw new Error('금액이 없습니다.');
    const merchant = cell(row, col.merchant);
    return {
      id: `${idPrefix}-${++n}`,
      source: 'bank',
      institution,
      date,
      time,
      merchant: holder && merchant === holder ? `${merchant} (내 계좌)` : merchant,
      amount: Math.abs(amount),
      direction,
      method: cell(row, col.method) || undefined,
      memo: cell(row, col.memo) || undefined,
    };
  });
}

export function importCardRows(all: string[][], options: ImportOptions = {}): Transaction[] {
  const { idPrefix = 'card', institution } = options;
  const { col, rows } = requireTable(all, CARD_COLUMNS, CARD_REQUIRED, '카드 이용내역');
  let n = 0;
  return readRows(rows, options, (row): Transaction => {
    const { date, time } = parseDateTime(cell(row, col.date), cell(row, col.time));
    const amount = parseAmount(cell(row, col.amount));
    if (!amount) throw new Error('금액이 없습니다.');
    const method = cell(row, col.method);
    const foreign = parseAmount(cell(row, col.foreignAmount));
    const currency = cell(row, col.currency).toUpperCase();
    const tx: Transaction = {
      id: `${idPrefix}-${++n}`,
      source: 'card',
      institution,
      date,
      time,
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

/** 거래 구분 문구 → 종류. 카카오페이 머니는 '[+] 받기', '[-] 내계좌로_내보내기', '[+] 부족분충전'처럼 적는다. */
function payKind(label: string): TxKind {
  if (/송금|받기|보내기|이체/.test(label)) return 'transfer';
  if (/충전/.test(label)) return 'topup';
  if (/환불|취소|적립|캐시백/.test(label)) return 'refund';
  return 'payment';
}

/**
 * 카카오페이·네이버페이 같은 간편결제 이용내역과 페이 머니 거래내역.
 * 머니 거래내역(잔액 열이 있고 결제수단 열이 없음)의 결제는 머니로 낸 것이고, 충전은 '은행' 열의 계좌에서 온 것이다.
 */
export function importPayRows(all: string[][], options: ImportOptions = {}): Transaction[] {
  const { idPrefix = 'pay', institution } = options;
  const { col, rows } = requireTable(all, PAY_COLUMNS, PAY_REQUIRED, '간편결제 내역');
  const moneyLedger = col.funding < 0 && col.balance >= 0;
  // '내계좌로 내보내기'에 나온 계좌는 내 계좌다. 같은 계좌로 간 다른 줄(관리자 처리 출금 등)도 내 돈의 이동으로 본다.
  const ownAccounts = new Set(rows.filter((r) => /내 ?계좌/.test(cell(r, col.kind))).map((r) => cell(r, col.merchant)).filter(Boolean));
  let n = 0;
  return readRows(rows, options, (row): Transaction | null => {
    const label = cell(row, col.kind);
    const kind = payKind(label);
    const { date, time } = parseDateTime(cell(row, col.datetime));
    // 결제가 취소·실패한 줄은 실제로 돈이 나가지 않았다.
    if (kind !== 'refund' && /취소|실패/.test(cell(row, col.status))) return null;
    const amount = Math.abs(parseAmount(cell(row, col.amount)));
    if (!amount) throw new Error('금액이 없습니다.');
    // '[+]'·'[-]' 표시가 있으면 그대로 따르고, 없으면 종류로 정한다.
    const sign = label.match(/^\[([+-])\]/)?.[1];
    const direction = sign ? (sign === '+' ? 'in' : 'out') : kind === 'topup' || kind === 'refund' || /받기|입금/.test(label) ? 'in' : 'out';
    const bank = cell(row, col.bank);
    // 머니 내역에서 나간 돈(결제·송금)은 머니 잔액에서 나간 것이다.
    const funding = cell(row, col.funding) || (kind === 'topup' && bank ? bank : moneyLedger && direction === 'out' ? `${institution ?? '페이'} 머니` : '');
    const merchant = cell(row, col.merchant);
    const own = kind !== 'topup' && ownAccounts.has(merchant) && !/내 ?계좌/.test(label);
    return {
      id: `${idPrefix}-${++n}`,
      source: 'pay',
      institution,
      date,
      time,
      merchant: own ? `${merchant} (내 계좌)` : merchant,
      amount,
      direction,
      kind,
      method: label.replace(/^\[[+-]\]\s*/, '') || undefined,
      funding: funding || undefined,
    };
  });
}

/** 머리글을 보고 통장·카드·간편결제 중 어떤 내역인지 추측한다. 머리글 위에 붙은 안내 줄은 건너뛴다. */
export function detectKind(all: string[][]): TxSource | null {
  for (const row of all.slice(0, 30)) {
    const header = row.map(clean);
    const has = (names: string[]) => names.some((n) => header.includes(n));
    // 페이 머니 거래내역에도 잔액 열이 있어서, 간편결제에만 나오는 열부터 확인한다.
    if (has(PAY_ONLY_COLUMNS) && has(PAY_COLUMNS.amount)) return 'pay';
    if (has(CARD_COLUMNS.merchant) && has(CARD_COLUMNS.date) && has(CARD_COLUMNS.amount)) return 'card';
    if (has(BANK_COLUMNS.datetime) && (has(['거래후잔액', '잔액']) || (has(BANK_COLUMNS.withdrawal) && has(BANK_COLUMNS.deposit)))) return 'bank';
  }
  return null;
}

/** 엑셀의 여러 시트 중 거래내역 표가 있는 시트. 못 찾으면 첫 시트 */
export function transactionSheet<T extends { rows: string[][] }>(sheets: T[]): T | undefined {
  return sheets.find((s) => detectKind(s.rows)) ?? sheets[0];
}

const INSTITUTION_HINTS: { pattern: RegExp; bank?: string; card?: string; pay?: string }[] = [
  { pattern: /카카오뱅크|kakaobank/i, bank: '카카오뱅크', card: '카카오뱅크 카드' },
  { pattern: /카카오|kakao/i, pay: '카카오페이' },
  { pattern: /네이버|naver/i, pay: '네이버페이' },
  { pattern: /토스|toss/i, bank: '토스뱅크', card: '토스뱅크 카드', pay: '토스페이' },
  { pattern: /농협|(?<![a-z])nh(?![a-z])/i, bank: '농협은행', card: 'NH농협카드' },
  { pattern: /신한|shinhan/i, bank: '신한은행', card: '신한카드' },
  { pattern: /국민|(?<![a-z])kb(?![a-z])/i, bank: 'KB국민은행', card: 'KB국민카드' },
  { pattern: /우리|woori/i, bank: '우리은행', card: '우리카드' },
  { pattern: /하나|hana/i, bank: '하나은행', card: '하나카드' },
  { pattern: /삼성|samsung/i, card: '삼성카드' },
  { pattern: /현대|hyundai/i, card: '현대카드' },
  { pattern: /롯데|lotte/i, card: '롯데카드' },
];

const DEFAULT_INSTITUTION: Record<TxSource, string> = { bank: '은행', card: '카드', pay: '간편결제' };

/** 파일 이름으로 기관을 추측한다. 모르면 '은행', '카드', '간편결제' */
export function guessInstitution(fileName: string, kind: TxSource): string {
  for (const hint of INSTITUTION_HINTS) {
    const name = hint[kind];
    if (name && hint.pattern.test(fileName)) return name;
  }
  return DEFAULT_INSTITUTION[kind];
}

export function importRows(all: string[][], kind: TxSource, options: ImportOptions = {}): Transaction[] {
  if (kind === 'bank') return importBankRows(all, options);
  if (kind === 'card') return importCardRows(all, options);
  return importPayRows(all, options);
}

export const detectCsvKind = (text: string) => detectKind(parseCsv(text));
export const importCsv = (text: string, kind: TxSource, options: ImportOptions = {}) => importRows(parseCsv(text), kind, options);
export const importBankCsv = (text: string, options: ImportOptions = {}) => importBankRows(parseCsv(text), options);
export const importCardCsv = (text: string, options: ImportOptions = {}) => importCardRows(parseCsv(text), options);
export const importPayCsv = (text: string, options: ImportOptions = {}) => importPayRows(parseCsv(text), options);
