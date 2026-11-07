import { addDays, addMonths, addYears, type EmailMessage, type Mailbox } from '@cashleak/engine';

// 메일함 연결: 앱 화면과 서버 API(app/api/mail)가 함께 쓰는 값과 확인 규칙.
// 이 파일은 브라우저에서도 쓰므로 '@cashleak/engine/mail'(IMAP, Node 전용)을 가져오지 않는다.

export const MAILBOX_NAME: Record<Mailbox, string> = { gmail: 'Gmail', naver: '네이버메일' };

/** 앱이 서버에 보내는 값 */
export interface MailRequest {
  mailbox: Mailbox;
  /** Gmail은 메일 주소, 네이버는 아이디 */
  user: string;
  /** 앱 비밀번호 */
  password: string;
  /** 이 날짜(YYYY-MM-DD, KST)부터 받은 메일 */
  since: string;
}

/** 서버가 돌려주는 값 */
export interface MailResponse {
  /** 구독 영수증으로 읽힌 메일 */
  messages: EmailMessage[];
  /** 기간 안에서 살펴본 메일 수 */
  scanned: number;
  /** 제목·보낸 곳으로 골라 본문을 읽은 메일 수 */
  matched: number;
  /** 후보가 너무 많아 오래된 것을 읽지 않았는지 */
  truncated: boolean;
}

export interface MailErrorResponse {
  error: string;
  /** auth: 주소·비밀번호, connect·timeout·mailbox: 메일 서버, request: 보낸 값, limit: 너무 자주 시도 */
  problem?: string;
}

/** 몇 년 전 메일까지 가져올 수 있는지 */
export const MAX_MAIL_YEARS = 2;
/** 서버가 본문을 읽는 메일 수 상한. 넘으면 최근 것부터 읽는다. */
export const MAIL_LIMIT = 300;

export const MAIL_PERIODS = [
  { months: 3, label: '최근 3개월' },
  { months: 6, label: '최근 6개월' },
  { months: 12, label: '최근 1년' },
  { months: 24, label: '최근 2년' },
] as const;

/** 올린 거래내역의 시작일을 덮는 가장 짧은 기간 (내역이 없으면 1년) */
export function defaultPeriod(firstDate: string | undefined, today: string): number {
  if (!firstDate) return 12;
  return MAIL_PERIODS.find((p) => addMonths(today, -p.months) <= firstDate)?.months ?? MAIL_PERIODS[MAIL_PERIODS.length - 1].months;
}

export const periodStart = (months: number, today: string) => addMonths(today, -months);

export class MailRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailRequestError';
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAVER_ID = /^[A-Za-z0-9._-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const validDate = (date: string) => DATE.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

/**
 * 보낸 값을 확인하고 메일 서버에 접속할 모양으로 고친다. 앱 화면(보내기 전)과 서버가 같은 규칙을 쓴다.
 * - Gmail: 주소에 @가 없으면 @gmail.com을 붙이고, 앱 비밀번호 사이의 빈칸은 뺀다(16자).
 * - 네이버: 접속 아이디는 @naver.com을 뺀 아이디다.
 * 기기 날짜가 하루쯤 어긋나도 되도록 기간 끝에는 며칠 여유를 둔다.
 */
export function readMailRequest(body: unknown, today: string): MailRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { mailbox } = b;
  if (mailbox !== 'gmail' && mailbox !== 'naver') throw new MailRequestError('Gmail과 네이버메일 중에서 골라 주세요.');
  const text = (v: unknown) => (typeof v === 'string' ? v : '');

  const typed = text(b.user).trim();
  const user = mailbox === 'gmail' ? (typed.includes('@') ? typed : `${typed}@gmail.com`) : typed.replace(/@naver\.com$/i, '');
  if (!typed || !(mailbox === 'gmail' ? EMAIL.test(user) : NAVER_ID.test(user))) {
    throw new MailRequestError(mailbox === 'gmail' ? 'Gmail 주소를 확인해 주세요.' : '네이버 아이디를 확인해 주세요.');
  }

  const password = mailbox === 'gmail' ? text(b.password).replace(/\s+/g, '') : text(b.password).trim();
  if (!password) throw new MailRequestError('앱 비밀번호를 넣어 주세요.');
  if (mailbox === 'gmail' && password.length !== 16) {
    throw new MailRequestError('Gmail 앱 비밀번호는 16자예요. Google 계정 비밀번호가 아니라 새로 만든 앱 비밀번호를 넣어 주세요.');
  }
  if (password.length > 128) throw new MailRequestError('앱 비밀번호를 확인해 주세요.');

  const since = text(b.since);
  if (!validDate(since) || since > addDays(today, 1)) throw new MailRequestError('기간을 확인해 주세요.');
  if (since < addDays(addYears(today, -MAX_MAIL_YEARS), -7)) throw new MailRequestError(`메일은 최근 ${MAX_MAIL_YEARS}년 것까지 가져올 수 있어요.`);
  return { mailbox, user, password, since };
}
