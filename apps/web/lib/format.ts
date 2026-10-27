import { diffDays } from '@cashleak/engine';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export const signedWon = (n: number, direction: 'in' | 'out') => `${direction === 'in' ? '+' : '-'}${won(n)}`;

/** 한국 시간 기준 오늘 (YYYY-MM-DD) */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 10월 16일 (금) */
export function formatDate(date: string, options: { year?: boolean; weekday?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${options.year ? `${y}년 ` : ''}${m}월 ${d}일${options.weekday === false ? '' : ` (${wd})`}`;
}

export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}.${d}`;
}

/** 오늘, D-5, 3일 지남 */
export function dday(date: string, today: string): string {
  const n = diffDays(today, date);
  if (n === 0) return '오늘';
  return n > 0 ? `D-${n}` : `${-n}일 지남`;
}

export const CYCLE_LABEL = { monthly: '매월', yearly: '매년' } as const;
