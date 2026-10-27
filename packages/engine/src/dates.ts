// 날짜는 모두 'YYYY-MM-DD' 문자열(KST 기준)로 다룬다.
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function toDayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

/** to - from (일) */
export function diffDays(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** month: 1~12 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthIndex(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** 월 인덱스와 기준일로 날짜를 만든다. 31일처럼 없는 날은 그 달 말일로 맞춘다. */
export function anchoredDate(monthIdx: number, anchorDay: number): string {
  const year = Math.floor(monthIdx / 12);
  const month = (monthIdx % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(anchorDay, daysInMonth(year, month)))}`;
}

export function addMonths(date: string, months: number, anchorDay = dayOfMonth(date)): string {
  return anchoredDate(monthIndex(date) + months, anchorDay);
}

export function yearlyDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return yearlyDate(y + years, m, d);
}

/** ISO 시각을 KST 날짜로 바꾼다. */
export function kstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 0=일요일 ... 6=토요일 */
export function weekday(date: string): number {
  return new Date(toDayNumber(date) * DAY_MS).getUTCDay();
}

export function maxDate(dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b));
}
