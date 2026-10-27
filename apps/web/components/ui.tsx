import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function PageHeader({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
      {back && (
        <Link href={back} aria-label="뒤로" className="-ml-2 flex size-10 items-center justify-center rounded-full text-sub active:bg-line">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
      )}
      <h1 className="flex-1 truncate text-lg font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function Card({ className = '', padded = true, ...props }: ComponentProps<'section'> & { padded?: boolean }) {
  return <section className={`rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${padded ? 'p-4' : 'overflow-hidden'} ${className}`} {...props} />;
}

export function SectionTitle({ children, count, tone }: { children: ReactNode; count?: number; tone?: 'warn' | 'muted' }) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'muted' ? 'text-faint' : 'text-sub';
  return (
    <h2 className={`mb-2 mt-6 px-1 text-sm font-semibold ${color}`}>
      {children}
      {count !== undefined && <span className="ml-1 font-normal">{count}</span>}
    </h2>
  );
}

type Tone = 'accent' | 'warn' | 'muted' | 'danger';

const BADGE: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  muted: 'bg-line text-sub',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[tone]}`}>{children}</span>;
}

const BUTTON = {
  primary: 'bg-accent text-accent-ink active:opacity-80',
  secondary: 'bg-card text-ink ring-1 ring-line active:bg-line',
  ghost: 'text-sub active:bg-line',
  danger: 'bg-danger-soft text-danger active:opacity-80',
};

export function buttonClass(variant: keyof typeof BUTTON = 'primary', className = '') {
  return `inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-semibold transition disabled:opacity-40 ${BUTTON[variant]} ${className}`;
}

export function Button({ variant = 'primary', className = '', ...props }: ComponentProps<'button'> & { variant?: keyof typeof BUTTON }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>;
}

export function Loading() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="불러오는 중">
      <div className="h-32 animate-pulse rounded-2xl bg-card" />
      <div className="h-16 animate-pulse rounded-2xl bg-card" />
      <div className="h-16 animate-pulse rounded-2xl bg-card" />
    </div>
  );
}

const AVATAR_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5f3dc4'];

/** 서비스 이름 첫 글자로 만든 동그라미 */
export function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  // FNV-1a: 한글 이름도 색이 고르게 나뉘도록
  let hash = 0x811c9dc5;
  for (const ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const color = muted ? '#9aa0a6' : AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: color }} aria-hidden>
      {[...name.replace(/^\(주\)\s*/, '')][0]?.toUpperCase()}
    </span>
  );
}
