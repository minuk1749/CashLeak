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

/** 2026년 5월 1일 ~ 10월 26일. 해가 바뀌면 끝 날짜에도 연도를 붙인다. */
export function formatPeriod(first: string, last: string): string {
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return `${formatDate(first, { year: true, weekday: false })} ~ ${formatDate(last, { year: !sameYear, weekday: false })}`;
}

/** 26.5.1 ~ 10.26. 해가 바뀌면 25.10.30 ~ 26.10.26 */
export function formatShortPeriod(first: string, last: string): string {
  const [y, m, d] = first.split('-').map(Number);
  const [y2, m2, d2] = last.split('-').map(Number);
  return `${String(y).slice(2)}.${m}.${d} ~ ${y2 === y ? '' : `${String(y2).slice(2)}.`}${m2}.${d2}`;
}

/** 월 구분 머리글: 올해면 10월, 다른 해면 2025년 10월 */
export function formatMonth(month: string, thisYear: string): string {
  const [y, m] = month.split('-');
  return `${y === thisYear ? '' : `${y}년 `}${Number(m)}월`;
}

/** 탐지 메모 속 날짜(2026-10-19)를 화면 표기(10월 19일)로 바꾼다. 올해가 아니면 연도를 붙인다. */
export function formatNote(note: string, thisYear: string): string {
  return note.replace(/\b(\d{4})-\d{2}-\d{2}\b/g, (date, year) => formatDate(date, { year: year !== thisYear, weekday: false }));
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
