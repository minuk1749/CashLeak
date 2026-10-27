/** 돈이 나간 경로를 한 줄로: 농협은행 계좌 → 카카오페이 → 멜론 */
export function PathLine({ path, end, className = '' }: { path: string[]; end?: string; className?: string }) {
  const hops = end && path[path.length - 1] !== end ? [...path, end] : path;
  if (hops.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 text-[13px] text-sub ${className}`}>
      {hops.map((hop, i) => (
        <span key={i} className="inline-flex items-center gap-x-1">
          {i > 0 && <span className="text-faint" aria-hidden>→</span>}
          <span className={i === hops.length - 1 && end ? 'text-ink' : undefined}>{hop}</span>
        </span>
      ))}
    </span>
  );
}

/** 상세 화면용 세로 흐름 */
export function PathFlow({ path, end }: { path: string[]; end: string }) {
  const hops = path[path.length - 1] === end ? path : [...path, end];
  return (
    <ol className="space-y-1.5">
      {hops.map((hop, i) => (
        <li key={i} className="flex flex-col items-start">
          {i > 0 && (
            <svg viewBox="0 0 24 24" className="mb-1.5 ml-3 size-4 text-faint" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 5v14m0 0-5-5m5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className={`rounded-lg px-3 py-1.5 text-sm ${i === hops.length - 1 ? 'bg-accent-soft font-semibold text-accent' : 'bg-bg text-ink'}`}>{hop}</span>
        </li>
      ))}
    </ol>
  );
}
