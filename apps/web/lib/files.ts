import {
  detectCsvKind,
  guessInstitution,
  importCsv,
  kstDate,
  type EmailMessage,
  type Mailbox,
  type Transaction,
} from '@cashleak/engine';
import type { FileKind, StoredEmail, StoredTransaction, UploadRecord } from './store/types.ts';

export const KIND_LABEL: Record<FileKind, string> = { bank: '통장', card: '카드', pay: '간편결제', email: '메일' };

export const INSTITUTIONS: Record<FileKind, string[]> = {
  bank: ['농협은행', 'KB국민은행', '신한은행', '우리은행', '하나은행', 'IBK기업은행', '카카오뱅크', '토스뱅크', '케이뱅크', '우체국'],
  card: ['NH농협카드', '신한카드', '삼성카드', '현대카드', 'KB국민카드', '롯데카드', '우리카드', '하나카드', 'BC카드', '카카오뱅크 카드', '토스뱅크 카드'],
  pay: ['카카오페이', '네이버페이', '토스페이', '페이코'],
  email: ['Gmail', '네이버메일'],
};

/** 은행·카드사 파일은 EUC-KR(CP949)로 저장된 경우가 많다. UTF-8로 안 읽히면 EUC-KR로 읽는다. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

export interface FileGuess {
  kind: FileKind | null;
  institution: string;
  /** 읽을 수 없는 파일이면 그 이유 */
  problem?: string;
}

const MAILBOX_NAME: Record<Mailbox, string> = { gmail: 'Gmail', naver: '네이버메일' };

/** 파일 이름과 내용으로 어떤 내역인지, 어느 기관 것인지 추측한다. */
export function guessFile(name: string, text: string): FileGuess {
  if (/\.(xlsx?|pdf|hwp)$/i.test(name)) {
    return { kind: null, institution: '', problem: '엑셀·PDF 파일은 아직 읽지 못해요. 엑셀에서 "CSV UTF-8"로 저장해서 올려 주세요.' };
  }
  if (/\.json$/i.test(name)) {
    try {
      const [first] = parseEmailJson(text);
      return { kind: 'email', institution: MAILBOX_NAME[first?.mailbox ?? 'gmail'] };
    } catch (e) {
      return { kind: null, institution: '', problem: (e as Error).message };
    }
  }
  const kind = detectCsvKind(text);
  if (!kind) return { kind: null, institution: '', problem: '어떤 내역인지 알아보지 못했어요. 종류를 직접 골라 주세요.' };
  return { kind, institution: guessInstitution(name, kind) };
}

/** 메일은 3단계에서 Gmail·네이버메일을 직접 연결한다. 지금은 가상 데이터 형식(JSON)만 받는다. */
export function parseEmailJson(text: string): EmailMessage[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아니에요.');
  }
  if (!Array.isArray(data)) throw new Error('메일 목록(JSON 배열)이 아니에요.');
  return data.map((m, i) => {
    const ok =
      m && typeof m === 'object' && (m.mailbox === 'gmail' || m.mailbox === 'naver') &&
      typeof m.from === 'string' && typeof m.subject === 'string' && typeof m.date === 'string' && typeof m.text === 'string';
    if (!ok) throw new Error(`${i + 1}번째 메일에 필요한 값(mailbox, from, subject, date, text)이 없어요.`);
    return { id: String(m.id ?? i + 1), mailbox: m.mailbox, from: m.from, subject: m.subject, date: m.date, text: m.text };
  });
}

/**
 * 같은 내역을 두 번 올리거나 기간이 겹치는 파일을 올려도 한 번만 저장하기 위한 값.
 * 같은 날 같은 곳에서 같은 금액을 두 번 낸 경우를 구분하려고 파일 안에서 몇 번째인지(#n)를 붙인다.
 */
export function fingerprints<T>(items: T[], base: (item: T) => string): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const b = base(item);
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    return `${b}#${n}`;
  });
}

const txBase = (t: Transaction) =>
  [t.source, t.institution ?? '', t.date, t.time ?? '', t.direction, t.amount, t.merchant.trim(), t.kind ?? '', t.method ?? ''].join('|');
const emailBase = (m: EmailMessage) => [m.mailbox, m.date, m.from, m.subject].join('|');

export interface FileInput {
  name: string;
  text: string;
  kind: FileKind;
  institution: string;
}

export interface ParsedFile {
  upload: UploadRecord;
  transactions: StoredTransaction[];
  emails: StoredEmail[];
  /** 읽은 줄 수 (겹친 줄 포함) */
  total: number;
  /** 이미 올린 내역과 겹쳐서 뺀 줄 수 */
  duplicates: number;
  /** 날짜·금액을 읽지 못해 건너뛴 줄 수 (합계 줄 등) */
  skipped: number;
}

const span = (dates: string[]) => {
  const sorted = [...dates].sort();
  return { firstDate: sorted[0], lastDate: sorted[sorted.length - 1] };
};

/** 파일을 거래·메일로 바꾼다. existing 에 있는 지문(이미 저장된 내역)은 뺀다. */
export function parseFile(input: FileInput, existing: Set<string>, uploadId: string, now = new Date().toISOString()): ParsedFile {
  let skipped = 0;
  let transactions: StoredTransaction[] = [];
  let emails: StoredEmail[] = [];
  let total: number;
  let dates: string[];
  if (input.kind === 'email') {
    const all = parseEmailJson(input.text);
    total = all.length;
    const fps = fingerprints(all, emailBase);
    emails = all
      .map((m, i) => ({ ...m, id: `${uploadId}-${i + 1}`, uploadId, fingerprint: fps[i] }))
      .filter((m) => !existing.has(m.fingerprint));
    dates = all.map((m) => kstDate(m.date));
  } else {
    const all = importCsv(input.text, input.kind, {
      idPrefix: uploadId,
      institution: input.institution,
      onSkip: () => skipped++,
    });
    total = all.length;
    const fps = fingerprints(all, txBase);
    transactions = all.map((t, i) => ({ ...t, uploadId, fingerprint: fps[i] })).filter((t) => !existing.has(t.fingerprint));
    dates = all.map((t) => t.date);
  }
  return {
    upload: {
      id: uploadId,
      name: input.name,
      kind: input.kind,
      institution: input.institution,
      count: transactions.length + emails.length,
      // 파일에 담긴 전체 기간 (겹쳐서 뺀 줄 포함)
      ...span(dates),
      createdAt: now,
    },
    transactions,
    emails,
    total,
    duplicates: total - transactions.length - emails.length,
    skipped,
  };
}
