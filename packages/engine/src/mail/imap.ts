import { ImapFlow } from 'imapflow';
import type { EmailMessage, Mailbox } from '../types.ts';
import { gmailQuery, mightBeReceipt } from './filter.ts';
import { readRawEmail } from './mime.ts';

// Gmail·네이버메일에 IMAP으로 접속해 영수증일 수 있는 메일만 가져온다 (Node.js 전용).
// 비밀번호는 접속에만 쓰고, 어디에도 남기지 않는다. 기록(logger)도 끈다.

export const IMAP_SERVERS: Record<Mailbox, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  naver: { host: 'imap.naver.com', port: 993, secure: true },
};

export interface FetchMailOptions {
  mailbox: Mailbox;
  /** Gmail은 메일 주소, 네이버는 아이디 */
  user: string;
  /** 앱 비밀번호 */
  password: string;
  /** 이 날짜(YYYY-MM-DD)부터 받은 메일 */
  since: string;
  /** 가져올 메일 수 상한. 넘으면 최근 것부터 가져온다. */
  limit?: number;
  /** 시험용: 다른 IMAP 서버 */
  server?: { host: string; port: number; secure: boolean };
  /** 접속부터 끝까지 걸릴 수 있는 시간 (ms) */
  timeoutMs?: number;
}

export interface FetchMailResult {
  messages: EmailMessage[];
  /** 기간 안에서 살펴본 메일 수 */
  scanned: number;
  /** 영수증일 수 있어 고른 메일 수 */
  matched: number;
  /** 고른 메일이 limit보다 많아 오래된 것을 뺐는지 */
  truncated: boolean;
}

export type MailProblem = 'auth' | 'connect' | 'timeout' | 'mailbox';

export class MailFetchError extends Error {
  readonly problem: MailProblem;
  /** cause: 원래 오류 (화면에는 보이지 않고, 원인을 찾을 때만 본다) */
  constructor(problem: MailProblem, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MailFetchError';
    this.problem = problem;
  }
}

/** 시험에서 가짜 서버로 바꿀 수 있게, 쓰는 기능만 적은 IMAP 클라이언트 */
export interface ImapClient {
  connect(): Promise<void>;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  getMailboxLock(path: string, options?: { readOnly?: boolean }): Promise<{ release(): void }>;
  search(query: Record<string, unknown>, options: { uid: true }): Promise<number[] | false>;
  fetch(
    range: number[],
    query: { uid: true; envelope?: true; internalDate?: true; source?: { maxLength: number } },
    options: { uid: true },
  ): AsyncIterable<{ uid: number; envelope?: { subject?: string; from?: { name?: string; address?: string }[] }; internalDate?: Date | string; source?: Buffer }>;
  logout(): Promise<void>;
  close(): void;
}

type CreateClient = (options: { host: string; port: number; secure: boolean; user: string; password: string }) => ImapClient;

const createImapFlow: CreateClient = ({ host, port, secure, user, password }) =>
  new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  }) as unknown as ImapClient;

/** 메일 원문은 이만큼만 받는다. 첨부 파일이 큰 메일도 본문은 앞쪽에 있다. */
const MAX_SOURCE_BYTES = 256 * 1024;

const formatFrom = (from?: { name?: string; address?: string }[]) => {
  const first = from?.[0];
  if (!first) return '';
  return first.name ? `${first.name} <${first.address ?? ''}>` : (first.address ?? '');
};

function toError(e: unknown): MailFetchError {
  if (e instanceof MailFetchError) return e;
  const err = e as { authenticationFailed?: boolean; code?: string; message?: string };
  if (err?.authenticationFailed) return new MailFetchError('auth', '메일 주소나 앱 비밀번호가 맞지 않아요.', { cause: e });
  if (err?.code === 'ETIMEDOUT' || err?.code === 'ETIMEOUT' || /timeout/i.test(err?.message ?? '')) {
    return new MailFetchError('timeout', '메일 서버가 제때 응답하지 않았어요. 잠시 뒤 다시 해 주세요.', { cause: e });
  }
  return new MailFetchError('connect', '메일 서버에 접속하지 못했어요.', { cause: e });
}

/**
 * 영수증일 수 있는 메일을 가져온다. Gmail은 '전체보관함'을 Gmail 검색으로 줄이고, 네이버는 받은메일함을 기간으로 찾은 뒤,
 * 둘 다 제목·보낸 곳으로 본문을 받을 메일을 고른다. 구독 영수증인지는 부르는 쪽에서 parseEmail로 판단한다.
 */
export async function fetchReceiptMail(options: FetchMailOptions, createClient: CreateClient = createImapFlow): Promise<FetchMailResult> {
  const { mailbox, user, password, since, limit = 300, timeoutMs = 50_000 } = options;
  const server = options.server ?? IMAP_SERVERS[mailbox];
  const client = createClient({ ...server, user, password });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      client.close();
      reject(new MailFetchError('timeout', '메일이 너무 많아 시간 안에 다 보지 못했어요. 기간을 줄여서 다시 해 주세요.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(client, mailbox, since, limit), timeout]);
  } catch (e) {
    throw toError(e);
  } finally {
    clearTimeout(timer);
    await client.logout().catch(() => client.close());
  }
}

async function run(client: ImapClient, mailbox: Mailbox, since: string, limit: number): Promise<FetchMailResult> {
  await client.connect();
  // Gmail의 '받은편지함'에는 보관 처리한 메일이 없어서 '전체보관함'(\All)을 본다.
  const folders = mailbox === 'gmail' ? await client.list() : [];
  const allMail = folders.find((f) => f.specialUse === '\\All')?.path;
  const path = allMail ?? 'INBOX';
  let lock: { release(): void };
  try {
    lock = await client.getMailboxLock(path, { readOnly: true });
  } catch {
    throw new MailFetchError('mailbox', '메일함을 열지 못했어요.');
  }
  try {
    // Gmail은 Gmail 검색(X-GM-RAW)으로 먼저 줄인다. 안 되는 서버면 기간으로만 찾는다.
    let found: number[] | false = false;
    if (mailbox === 'gmail' && allMail !== undefined) {
      found = await client.search({ gmraw: gmailQuery(since) }, { uid: true }).catch(() => false as const);
    }
    if (found === false) found = await client.search({ since: new Date(`${since}T00:00:00Z`) }, { uid: true });
    const uids = found || [];
    if (uids.length === 0) return { messages: [], scanned: 0, matched: 0, truncated: false };

    // 제목·보낸 곳만 먼저 받아서, 본문을 받을 메일을 고른다.
    const candidates: { uid: number; time: number }[] = [];
    for await (const msg of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
      const subject = (msg.envelope?.subject ?? '').replace(/\s+/g, ' ').trim();
      if (mightBeReceipt(formatFrom(msg.envelope?.from), subject)) candidates.push({ uid: msg.uid, time: new Date(msg.internalDate ?? 0).getTime() });
    }
    candidates.sort((a, b) => b.time - a.time);
    const chosen = candidates.slice(0, limit);
    const messages: EmailMessage[] = [];
    if (chosen.length) {
      for await (const msg of client.fetch(chosen.map((c) => c.uid), { uid: true, internalDate: true, source: { maxLength: MAX_SOURCE_BYTES } }, { uid: true })) {
        if (!msg.source) continue;
        try {
          messages.push(await readRawEmail(msg.source, { id: `${mailbox}-${msg.uid}`, mailbox, receivedAt: msg.internalDate }));
        } catch {
          // 형식이 깨진 메일 한 통 때문에 나머지를 버리지 않는다.
        }
      }
    }
    messages.sort((a, b) => a.date.localeCompare(b.date));
    return { messages, scanned: uids.length, matched: candidates.length, truncated: candidates.length > limit };
  } finally {
    lock.release();
  }
}
