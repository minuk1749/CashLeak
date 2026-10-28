import type { EmailMessage, Transaction } from '../src/types.ts';

let seq = 0;

export function cardTx(date: string, merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return { id: `t${++seq}`, source: 'card', date, merchant, amount, direction: 'out', method: '일시불', ...extra };
}

export function bankTx(date: string, merchant: string, amount: number, method: string, extra: Partial<Transaction> = {}): Transaction {
  return { id: `t${++seq}`, source: 'bank', date, merchant, amount, direction: 'out', method, ...extra };
}

export function payTx(date: string, merchant: string, amount: number, funding: string | undefined, extra: Partial<Transaction> = {}): Transaction {
  return { id: `t${++seq}`, source: 'pay', institution: '카카오페이', date, merchant, amount, direction: 'out', kind: 'payment', funding, ...extra };
}

export function monthlyDates(first: string, count: number): string[] {
  const [y, m, d] = first.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    const year = y + Math.floor(month / 12);
    const mm = (month % 12) + 1;
    const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    return `${year}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  });
}

export function mail(mailbox: 'gmail' | 'naver', date: string, from: string, subject: string, text: string): EmailMessage {
  return { id: `m${++seq}`, mailbox, date: `${date}T10:00:00+09:00`, from, subject, text };
}
