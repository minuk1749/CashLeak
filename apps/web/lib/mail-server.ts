import { parseEmail } from '@cashleak/engine';
import { MailFetchError, type FetchMailOptions, type FetchMailResult } from '@cashleak/engine/mail';
import { MAIL_LIMIT, MailRequestError, readMailRequest, type MailErrorResponse, type MailResponse } from './mail.ts';

// 서버 API(app/api/mail)의 본체. 시험에서 가짜 메일 서버를 넣을 수 있게 따로 둔다.
// 비밀번호와 메일 원문은 접속과 영수증 고르기에만 쓰고, 저장하거나 기록(console)에 남기지 않는다.

export interface MailHandlerOptions {
  fetchMail(options: FetchMailOptions): Promise<FetchMailResult>;
  today(): string;
  now?(): number;
}

/** 한 곳(IP)에서 이 시간 동안 이만큼만 시도할 수 있다. 남의 메일함 비밀번호를 맞춰 보는 데 쓰이지 않도록. */
const LIMIT = { attempts: 10, windowMs: 10 * 60_000 };
const MAX_BODY_CHARS = 2_000;
/** Vercel 함수 제한 시간(maxDuration 60초)보다 조금 짧게 */
const TIMEOUT_MS = 50_000;

const headers = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string, problem?: string) =>
  Response.json({ error, ...(problem ? { problem } : {}) } satisfies MailErrorResponse, { status, headers });

/** 이 앱의 화면에서 보낸 요청인지 (다른 사이트가 사용자의 브라우저로 보내는 요청을 막는다) */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const clientIp = (request: Request) =>
  request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

export function createMailHandler({ fetchMail, today, now = Date.now }: MailHandlerOptions) {
  const attempts = new Map<string, number[]>();

  /** 시도 횟수를 세고, 너무 많으면 false */
  function allow(ip: string): boolean {
    const t = now();
    for (const [key, times] of attempts) {
      const recent = times.filter((x) => t - x < LIMIT.windowMs);
      if (recent.length) attempts.set(key, recent);
      else attempts.delete(key);
    }
    const recent = attempts.get(ip) ?? [];
    if (recent.length >= LIMIT.attempts) return false;
    attempts.set(ip, [...recent, t]);
    return true;
  }

  return async function POST(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return fail(403, '이 앱 화면에서만 쓸 수 있어요.', 'request');
    if (!request.headers.get('content-type')?.startsWith('application/json')) return fail(415, '요청 형식이 맞지 않아요.', 'request');
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return fail(413, '요청이 너무 커요.', 'request');
    if (!allow(clientIp(request))) return fail(429, '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.', 'limit');

    let input;
    try {
      input = readMailRequest(JSON.parse(raw), today());
    } catch (e) {
      return fail(400, e instanceof MailRequestError ? e.message : '요청 형식이 맞지 않아요.', 'request');
    }

    try {
      const result = await fetchMail({ ...input, limit: MAIL_LIMIT, timeoutMs: TIMEOUT_MS });
      // 구독 영수증으로 읽히는 메일만 돌려준다. 나머지 메일 내용은 이 함수 밖으로 나가지 않는다.
      const body: MailResponse = {
        messages: result.messages.filter((m) => parseEmail(m) !== null),
        scanned: result.scanned,
        matched: result.messages.length,
        truncated: result.truncated,
      };
      return Response.json(body, { headers });
    } catch (e) {
      if (e instanceof MailFetchError) return fail(e.problem === 'auth' ? 401 : 502, e.message, e.problem);
      return fail(500, '메일을 가져오지 못했어요. 잠시 뒤 다시 해 주세요.');
    }
  };
}
