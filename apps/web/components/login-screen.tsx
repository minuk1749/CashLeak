'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorBox } from './ui';

/** Supabase가 설정된 경우에만 보인다. 아이폰 홈 화면 앱에서도 되도록 메일 링크 대신 비밀번호를 쓴다. */
export function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [working, setWorking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError(undefined);
    setNotice(undefined);
    const auth = supabase().auth;
    const { data, error } =
      mode === 'signin' ? await auth.signInWithPassword({ email, password }) : await auth.signUp({ email, password });
    setWorking(false);
    if (error) setError(`${mode === 'signin' ? '로그인' : '가입'}하지 못했어요: ${error.message}`);
    else if (mode === 'signup' && !data.session) setNotice('확인 메일을 보냈어요. 메일의 링크를 누른 뒤 여기서 로그인해 주세요.');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-bold">CashLeak</h1>
      <p className="mt-1 text-sub">매달 새는 구독료를 찾아 정리해요.</p>
      <Card className="mt-6">
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-sm text-sub">이메일</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-bg px-3 outline-none ring-accent focus:ring-2" />
          </label>
          <label className="block">
            <span className="text-sm text-sub">비밀번호</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl bg-bg px-3 outline-none ring-accent focus:ring-2"
            />
          </label>
          {error && <ErrorBox>{error}</ErrorBox>}
          {notice && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">{notice}</p>}
          <Button type="submit" disabled={working} className="w-full">
            {working ? '잠시만요…' : mode === 'signin' ? '로그인' : '가입하기'}
          </Button>
        </form>
      </Card>
      <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="mt-4 text-sm text-sub underline underline-offset-4">
        {mode === 'signin' ? '처음이라면 가입하기' : '이미 계정이 있다면 로그인'}
      </button>
    </main>
  );
}
