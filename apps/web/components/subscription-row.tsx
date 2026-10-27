import Link from 'next/link';
import type { SubscriptionView } from '@/lib/view';
import { CYCLE_LABEL, dday, formatDate, won } from '@/lib/format';
import { Avatar, Badge } from './ui';
import { PathLine } from './path';

export function SubscriptionRow({ v, today }: { v: SubscriptionView; today: string }) {
  const muted = v.group === 'canceled' || v.group === 'hidden';
  const varies = v.detected?.amountVaries && !v.edited;
  const soon = v.nextPaymentDate !== undefined && v.nextPaymentDate >= today && dday(v.nextPaymentDate, today).match(/^(오늘|D-[1-7])$/);
  const overdue = v.nextPaymentDate !== undefined && v.nextPaymentDate < today;
  return (
    <Link href={`/subscriptions/${encodeURIComponent(v.uid)}`} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
      <Avatar name={v.name} muted={muted} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate font-semibold ${muted ? 'text-sub' : ''}`}>{v.name}</span>
          {v.manual && <Badge>직접 추가</Badge>}
          {v.edited && <Badge>수정함</Badge>}
        </div>
        <PathLine path={v.path} className="mt-0.5" />
      </div>
      <div className="shrink-0 text-right">
        <div className={`num font-semibold ${muted ? 'text-sub' : ''}`}>
          {v.amount !== undefined ? `${varies ? '약 ' : ''}${won(v.amount)}` : v.amountLabel}
        </div>
        <div className="mt-0.5 text-[13px] text-sub">
          {v.group === 'active' || v.group === 'review' ? (
            <>
              {CYCLE_LABEL[v.cycle]}
              {v.nextPaymentDate && (
                <>
                  {' · '}
                  <span className={soon ? 'font-semibold text-accent' : overdue ? 'text-warn' : undefined}>
                    {soon ? dday(v.nextPaymentDate, today) : formatDate(v.nextPaymentDate, { weekday: false })}
                  </span>
                </>
              )}
            </>
          ) : (
            v.statusLabel
          )}
        </div>
      </div>
    </Link>
  );
}
