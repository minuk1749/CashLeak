'use client';

import { useState, type FormEvent } from 'react';
import type { Cycle } from '@cashleak/engine';
import { Button, ErrorBox } from './ui';

export interface FormValues {
  name: string;
  amount: number;
  cycle: Cycle;
  nextPaymentDate: string;
  paymentPath: string[];
  memo: string;
}

export const parsePath = (text: string) =>
  text
    .split(/→|->|>|,/)
    .map((s) => s.trim())
    .filter(Boolean);

const field = 'mt-1 h-11 w-full rounded-xl bg-bg px-3 outline-none ring-accent focus:ring-2';

/** 직접 추가하거나 탐지 결과를 고칠 때 쓰는 입력 칸 */
export function SubscriptionForm({
  initial,
  submitLabel,
  onSubmit,
  showPath = true,
}: {
  initial: Partial<FormValues>;
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
  showPath?: boolean;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [amount, setAmount] = useState(initial.amount !== undefined ? String(initial.amount) : '');
  const [cycle, setCycle] = useState<Cycle>(initial.cycle ?? 'monthly');
  const [next, setNext] = useState(initial.nextPaymentDate ?? '');
  const [path, setPath] = useState((initial.paymentPath ?? []).join(' → '));
  const [memo, setMemo] = useState(initial.memo ?? '');
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(/[,원\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('금액을 숫자로 적어 주세요.');
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      await onSubmit({ name: name.trim(), amount: value, cycle, nextPaymentDate: next, paymentPath: parsePath(path), memo: memo.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="text-sm text-sub">이름</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 유튜브 프리미엄" className={field} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-sub">금액 (원)</span>
          <input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="14900" className={`${field} num`} />
        </label>
        <label className="block">
          <span className="text-sm text-sub">주기</span>
          <select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)} className={field}>
            <option value="monthly">매월</option>
            <option value="yearly">매년</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-sm text-sub">다음 결제일</span>
        <input required type="date" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
      </label>
      {showPath && (
        <label className="block">
          <span className="text-sm text-sub">결제 경로 (선택)</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="예: 농협은행 계좌 → 카카오페이" className={field} />
        </label>
      )}
      <label className="block">
        <span className="text-sm text-sub">메모 (선택)</span>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 가족 요금제" className={field} />
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button type="submit" disabled={working} className="w-full">
        {working ? '저장하는 중…' : submitLabel}
      </Button>
    </form>
  );
}
