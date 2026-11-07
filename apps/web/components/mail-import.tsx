'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Mailbox } from '@cashleak/engine';
import { useData } from '@/lib/data-context';
import {
  defaultPeriod,
  MAIL_LIMIT,
  MAIL_PERIODS,
  MAILBOX_NAME,
  periodStart,
  readMailRequest,
  type MailErrorResponse,
  type MailResponse,
} from '@/lib/mail';
import { Button, buttonClass, ErrorBox } from '@/components/ui';

const field = 'mt-1 h-11 w-full rounded-xl bg-bg px-3 outline-none ring-accent focus:ring-2';
const count = (n: number) => n.toLocaleString('ko-KR');

interface Done {
  mailbox: Mailbox;
  response: MailResponse;
  /** 새로 저장한 메일 수 */
  added: number;
  /** 이미 가져온 적이 있어 뺀 메일 수 */
  duplicates: number;
}

/** 비밀번호가 틀렸을 때 확인할 것 */
const AUTH_HINT: Record<Mailbox, string> = {
  gmail: '2단계 인증을 켠 Google 계정에서 만든 앱 비밀번호인지 확인해 주세요.',
  naver: '네이버메일 환경설정에서 IMAP/SMTP 사용을 켰는지, 2단계 인증을 쓰면 애플리케이션 비밀번호를 넣었는지 확인해 주세요.',
};

/**
 * Gmail·네이버메일에서 구독 영수증 메일을 가져오는 칸.
 * 메일 주소와 앱 비밀번호를 서버 API(/api/mail)로 보내고, 돌려받은 영수증 메일을 '메일' 내역으로 저장한다.
 * 비밀번호는 보낸 뒤 바로 지운다.
 */
export function MailImport() {
  const data = useData();
  const { snapshot, today, mode } = data;
  // 올린 거래내역 중 가장 이른 날
  const firstDate = useMemo(
    () => snapshot.uploads.filter((u) => u.kind !== 'email' && u.firstDate).map((u) => u.firstDate!).sort()[0],
    [snapshot.uploads],
  );
  const [mailbox, setMailbox] = useState<Mailbox>('gmail');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [months, setMonths] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string }>();
  const [done, setDone] = useState<Done>();
  const period = months ?? defaultPeriod(firstDate, today);
  const gmail = mailbox === 'gmail';

  function choose(next: Mailbox) {
    if (next === mailbox) return;
    setMailbox(next);
    setUser('');
    setPassword('');
    setError(undefined);
    setDone(undefined);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setDone(undefined);
    const body = { mailbox, user, password, since: periodStart(period, today) };
    try {
      // 서버와 같은 규칙으로 먼저 확인한다 (Google 계정 비밀번호를 잘못 넣는 경우 등).
      readMailRequest(body, today);
    } catch (err) {
      setError({ message: (err as Error).message });
      return;
    }

    setBusy(true);
    let response: MailResponse;
    try {
      const res = await fetch('/api/mail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => null)) as MailResponse | MailErrorResponse | null;
      if (!res.ok || !json || 'error' in json) {
        const failure = json && 'error' in json ? json : undefined;
        setError({
          message: failure?.error ?? '메일을 가져오지 못했어요. 잠시 뒤 다시 해 주세요.',
          hint: failure?.problem === 'auth' ? AUTH_HINT[mailbox] : undefined,
        });
        return;
      }
      response = json;
      setPassword('');
    } catch {
      setError({ message: '인터넷 연결을 확인하고 다시 해 주세요.' });
      return;
    } finally {
      setBusy(false);
    }

    try {
      let added = 0;
      let duplicates = 0;
      if (response.messages.length) {
        const [parsed] = await data.addFiles([
          { name: `${MAILBOX_NAME[mailbox]} 영수증 메일`, text: JSON.stringify(response.messages), kind: 'email', institution: MAILBOX_NAME[mailbox] },
        ]);
        added = parsed.upload.count;
        duplicates = parsed.duplicates;
      }
      setDone({ mailbox, response, added, duplicates });
    } catch (err) {
      setError({ message: (err as Error).message });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="leading-relaxed">
        Gmail·네이버메일에서 구독 결제 영수증을 찾아 거래내역과 맞춰 봐요. 간편결제나 앱스토어를 거쳐 어느 서비스에 낸 돈인지 모르는 결제를 알아내는 데 도움이 돼요.
      </p>

      <div className="flex gap-2" role="radiogroup" aria-label="메일함">
        {(['gmail', 'naver'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mailbox === m}
            onClick={() => choose(m)}
            className={`h-9 flex-1 rounded-full text-sm font-medium ${mailbox === m ? 'bg-ink text-bg' : 'bg-bg text-sub ring-1 ring-line'}`}
          >
            {MAILBOX_NAME[m]}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-sm text-sub">{gmail ? 'Gmail 주소' : '네이버 아이디'}</span>
        <input
          key={`user-${mailbox}`}
          type={gmail ? 'email' : 'text'}
          inputMode={gmail ? 'email' : 'text'}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder={gmail ? 'example@gmail.com' : '아이디 (@naver.com 앞부분)'}
          className={field}
        />
      </label>

      <label className="block">
        <span className="text-sm text-sub">{gmail ? '앱 비밀번호 (16자)' : '애플리케이션 비밀번호'}</span>
        <input
          key={`pw-${mailbox}`}
          type="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={gmail ? 'Google 계정 비밀번호가 아니에요' : undefined}
          className={field}
        />
        {!gmail && <span className="mt-1 block text-xs text-faint">2단계 인증을 쓰지 않는 계정은 네이버 비밀번호를 넣어요.</span>}
      </label>

      <label className="block">
        <span className="text-sm text-sub">기간</span>
        <select value={period} onChange={(e) => setMonths(Number(e.target.value))} className={field}>
          {MAIL_PERIODS.map((p) => (
            <option key={p.months} value={p.months}>
              {p.label}
            </option>
          ))}
        </select>
        {months === undefined && firstDate && <span className="mt-1 block text-xs text-faint">올린 거래내역의 기간에 맞춰 골랐어요.</span>}
      </label>

      {error && (
        <ErrorBox>
          {error.message}
          {error.hint && <span className="mt-1 block">{error.hint}</span>}
        </ErrorBox>
      )}

      <Button type="submit" className="w-full" disabled={busy || !user.trim() || !password}>
        {busy ? '메일함을 살펴보는 중…' : `${MAILBOX_NAME[mailbox]}에서 영수증 가져오기`}
      </Button>
      {busy && <p className="text-center text-xs text-faint">메일이 많으면 1분쯤 걸려요.</p>}

      {done && <MailResult done={done} />}

      <AppPasswordHelp mailbox={mailbox} />

      <p className="text-xs leading-relaxed text-faint">
        비밀번호는 메일 서버에 접속하는 데만 쓰고 저장하지 않아요. 이 앱의 서버가 메일을 받아 구독 영수증으로 읽히는 메일만 돌려주고, 서버에는 남기지 않아요. 가져온 영수증은
        링크 주소를 뺀 글자로 {mode === 'local' ? '이 브라우저에' : '내 계정에'} 저장돼요. {gmail ? 'Gmail은 전체보관함을' : '네이버메일은 받은메일함을'} 봐요.
      </p>
    </form>
  );
}

function MailResult({ done }: { done: Done }) {
  const { response, added, duplicates } = done;
  const found = response.messages.length;
  return (
    <div className="rounded-xl bg-accent-soft p-3 text-sm">
      <p className="font-semibold">
        {found ? `구독 영수증 ${count(found)}통을 찾았어요` : '구독 영수증으로 읽힌 메일이 없어요'}
      </p>
      <p className="mt-1 text-sub">
        메일 {count(response.scanned)}통 중 영수증일 수 있는 {count(response.matched)}통을 읽었어요.
        {found > 0 && (added ? ` 새로 ${count(added)}통을 추가했어요.` : ' 모두 이미 가져온 메일이에요.')}
        {added > 0 && duplicates > 0 && ` 이미 가져온 ${count(duplicates)}통은 뺐어요.`}
        {response.truncated && ` 후보가 많아 최근 ${count(MAIL_LIMIT)}통만 읽었어요.`}
      </p>
      {!found && <p className="mt-1 text-sub">기간을 늘리거나 다른 메일함도 연결해 보세요.</p>}
      {added > 0 && (
        <Link href="/" className={buttonClass('primary', 'mt-3 w-full')}>
          찾은 구독 보기
        </Link>
      )}
    </div>
  );
}

function AppPasswordHelp({ mailbox }: { mailbox: Mailbox }) {
  return (
    <details className="rounded-xl bg-bg px-3 py-2 text-sm text-sub">
      <summary className="cursor-pointer py-1 font-medium text-ink">{mailbox === 'gmail' ? 'Gmail 앱 비밀번호 만드는 법' : '네이버메일 연결 준비'}</summary>
      {mailbox === 'gmail' ? (
        <ol className="mt-2 list-decimal space-y-1.5 pb-1 pl-5 leading-relaxed">
          <li>Google 계정에서 2단계 인증을 켜요. 앱 비밀번호는 2단계 인증을 켠 계정에서만 만들 수 있어요.</li>
          <li>
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-medium text-accent">
              myaccount.google.com/apppasswords
            </a>
            에서 앱 이름(예: CashLeak)을 넣고 만들어요.
          </li>
          <li>화면에 나온 16자 비밀번호를 위 칸에 붙여 넣어요. 다 쓴 뒤에는 같은 화면에서 지울 수 있어요.</li>
          <li className="text-faint">회사·학교 계정은 관리자가 막아 두면 만들 수 없어요.</li>
        </ol>
      ) : (
        <ol className="mt-2 list-decimal space-y-1.5 pb-1 pl-5 leading-relaxed">
          <li>네이버메일 PC 화면의 환경설정 → POP3/IMAP 설정에서 IMAP/SMTP 사용을 &apos;사용함&apos;으로 바꾸고 저장해요.</li>
          <li>2단계 인증을 쓰면 네이버 내정보 → 보안설정 → 2단계 인증 관리에서 애플리케이션 비밀번호를 만들어 위 칸에 넣어요.</li>
          <li>2단계 인증을 쓰지 않으면 네이버 비밀번호로 접속돼요. 2단계 인증을 켜고 애플리케이션 비밀번호를 쓰는 편이 더 안전해요.</li>
        </ol>
      )}
    </details>
  );
}
