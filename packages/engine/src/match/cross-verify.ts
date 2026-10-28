import type {
  ConfidenceLabel,
  Cycle,
  EmailReceipt,
  EvidenceSource,
  Intermediary,
  RecurringSeries,
  Subscription,
  SubscriptionStatus,
  Transaction,
  TxSource,
} from '../types.ts';
import { addMonths, addYears, diffDays } from '../dates.ts';
import { fitCycle } from '../detect/recurring.ts';
import { INTERMEDIARY_BY_ID, matchMerchant, SERVICE_BY_ID } from '../merchants.ts';

export interface CrossVerifyOptions {
  asOf: string;
  /** 합쳐진 원본 거래가 어느 내역(통장·카드)에서 왔는지 찾는 함수. 근거 표시에 쓴다. */
  sourceOf?: (transactionId: string) => TxSource | undefined;
  /** 카드 승인일과 영수증 메일 날짜의 허용 차이 */
  dateWindow?: number;
  graceDays?: number;
}

interface Target {
  serviceId?: string;
  via?: Intermediary;
}

/** exact: 서비스나 중개자가 같아야 함, loose: 결제대행사·모르는 가맹점이라 금액과 날짜로만 맞춤 */
function compatibility(target: Target, r: EmailReceipt): 'exact' | 'loose' | null {
  if (target.serviceId) return r.serviceId === target.serviceId ? 'exact' : null;
  if (target.via && target.via !== 'pg') return r.billedVia === target.via ? 'exact' : null;
  return 'loose';
}

function amountMatches(tx: Transaction, r: EmailReceipt): boolean {
  if (r.amount === undefined) return false;
  if (r.currency === 'USD') return tx.foreignCurrency === 'USD' && Math.abs((tx.foreignAmount ?? NaN) - r.amount) < 0.01;
  return Math.abs(tx.amount - r.amount) < 1;
}

function confidenceLabel(c: number): ConfidenceLabel {
  return c >= 0.75 ? '높음' : c >= 0.5 ? '보통' : '낮음';
}

const clamp = (n: number) => Math.round(Math.min(0.99, Math.max(0.05, n)) * 100) / 100;

function majority<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function sourcesOf(
  txs: Transaction[],
  receipts: EmailReceipt[],
  sourceOf: CrossVerifyOptions['sourceOf'],
): EvidenceSource[] {
  const order: EvidenceSource[] = ['card', 'bank', 'pay', 'gmail', 'naver'];
  const linked = txs.flatMap((t) => (t.linkedIds ?? []).map((id) => sourceOf?.(id)));
  const set = new Set<EvidenceSource | undefined>([
    ...txs.map((t) => t.source),
    ...linked,
    ...receipts.map((r) => r.mailbox),
  ]);
  return order.filter((s) => set.has(s));
}

function categoryOf(serviceId: string | undefined, via: Intermediary | undefined, kind: string): string {
  const service = serviceId ? SERVICE_BY_ID.get(serviceId) : undefined;
  if (service) return service.category;
  if (via === 'apple' || via === 'google') return '앱 구독';
  if (kind === 'bill') return '공과금·보험';
  return '기타';
}

function formatAmount(n: number, currency: string): string {
  return currency === 'USD' ? `$${n.toFixed(2)}` : `${n.toLocaleString('ko-KR')}원`;
}

export function buildSubscriptions(
  series: RecurringSeries[],
  receipts: EmailReceipt[],
  unmatchedTxs: Transaction[],
  options: CrossVerifyOptions,
): Subscription[] {
  const window = options.dateWindow ?? 3;
  const grace = options.graceDays ?? 5;
  const live = receipts.filter((r) => !r.duplicateOf);
  const used = new Set<string>();
  const subs: Subscription[] = [];

  const latestCancel = (serviceId: string, after: string) =>
    live
      .filter((r) => r.type === 'cancel' && r.serviceId === serviceId && diffDays(after, r.date) >= -window)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

  // 1) 거래내역에서 찾은 반복 결제를 메일 영수증과 맞춰 본다.
  // 가맹점명으로 서비스·중개자를 아는 묶음이 먼저 영수증을 가져간다. 금액·날짜로만 맞추는 묶음이
  // 다른 구독의 영수증을 가로채지 않도록, 이미 가맹점명으로 찾은 서비스의 영수증은 느슨하게 붙이지 않는다.
  const identified = new Set(series.map((s) => s.serviceId).filter(Boolean));
  const rank = (s: RecurringSeries) => (s.serviceId ? 0 : s.via && s.via !== 'pg' ? 1 : 2);
  for (const s of [...series].sort((a, b) => rank(a) - rank(b))) {
    let matches: { tx: Transaction; r: EmailReceipt; mode: 'exact' | 'loose' }[] = [];
    for (const tx of s.transactions) {
      let best: { r: EmailReceipt; mode: 'exact' | 'loose'; diff: number } | undefined;
      for (const r of live) {
        if (r.type !== 'charge' || used.has(r.emailId)) continue;
        const mode = compatibility(s, r);
        if (!mode || !amountMatches(tx, r)) continue;
        if (mode === 'loose' && identified.has(r.serviceId)) continue;
        const diff = Math.abs(diffDays(tx.date, r.date));
        if (diff <= window && (!best || diff < best.diff)) best = { r, mode, diff };
      }
      if (best) matches.push({ tx, r: best.r, mode: best.mode });
    }
    const serviceId = s.serviceId ?? majority(matches.map((m) => m.r.serviceId));
    matches = matches.filter((m) => m.r.serviceId === serviceId);
    // 금액·날짜만으로 맞춘 경우는 우연일 수 있으니 2건 이상 맞거나,
    // 1건이면 영수증의 다음 결제일이 실제 다음 거래(또는 예정일)와 맞아야 인정한다.
    if (matches.some((m) => m.mode === 'loose') && matches.length < Math.min(2, s.transactions.length)) {
      const next = matches[0]?.r.nextDate;
      const dates = [...s.transactions.map((t) => t.date), s.nextDate];
      const consistent = next !== undefined && dates.some((d) => Math.abs(diffDays(next, d)) <= window);
      if (!consistent) matches = [];
    }
    for (const m of matches) used.add(m.r.emailId);

    const verified = matches.length > 0;
    const finalServiceId = s.serviceId ?? (verified ? serviceId : undefined);
    const service = finalServiceId ? SERVICE_BY_ID.get(finalServiceId) : undefined;
    const notes: string[] = [];
    let status: SubscriptionStatus = s.active ? 'active' : 'suspected_canceled';
    let nextPaymentDate: string | undefined = s.nextDate;
    const evidence = matches.map((m) => m.r);

    if (finalServiceId) {
      const cancel = latestCancel(finalServiceId, s.lastDate);
      if (cancel) {
        status = 'canceled';
        used.add(cancel.emailId);
        evidence.push(cancel);
        notes.push(`해지 메일 확인 (${cancel.date})`);
      }
      const stated = [...evidence, ...live.filter((r) => r.type === 'upcoming' && r.serviceId === finalServiceId)]
        .filter((r) => r.nextDate && r.nextDate > s.lastDate)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (stated?.nextDate && status === 'active') nextPaymentDate = stated.nextDate;
    }
    if (status !== 'active') nextPaymentDate = undefined;
    if (status === 'suspected_canceled') notes.push(`예정일(${s.nextDate})이 지나도 결제가 없어 해지로 추정`);
    for (const c of s.priceChanges) {
      notes.push(`가격 변경 ${formatAmount(c.from, c.currency)} → ${formatAmount(c.to, c.currency)} (${c.date})`);
    }
    if (s.amountVaries) notes.push('매달 금액이 달라짐');
    if (!finalServiceId && s.via) notes.push(`${INTERMEDIARY_BY_ID.get(s.via)?.name} 결제라 어떤 서비스인지 메일 확인 필요`);
    if (verified) notes.push(`메일 영수증 ${matches.length}건과 일치`);

    // 결제 건수가 아니라 주기대로 이어진 결제 수로 센다. 띄엄띄엄 우연히 맞은 금액을 걸러내기 위해서다.
    const n = s.gaps.regular + 1;
    let confidence = n >= 5 ? 0.7 : n === 4 ? 0.65 : n === 3 ? 0.55 : 0.4;
    if (s.gaps.irregular) {
      confidence -= 0.15 * s.gaps.irregular;
      notes.push('주기에 맞지 않는 결제가 섞여 있음');
    }
    if (!s.amountVaries) confidence += 0.1;
    if (s.serviceId) confidence += 0.1;
    if (verified) confidence += 0.2;
    if (!s.serviceId && !verified && s.kind === 'subscription') confidence -= 0.05;
    const busy = !s.serviceId && !s.via && !verified && s.otherPaymentsAtMerchant >= s.transactions.length;
    if (busy) {
      confidence -= 0.3;
      notes.push('같은 곳에서 다른 결제가 많아 우연히 금액이 겹쳤을 수 있음');
    }
    // 구독료는 보통 정액이다. 모르는 가맹점에서 매번 금액이 다르고 자동이체도 아니면 그냥 자주 쓰는 곳일 수 있다.
    const autoDebit = s.transactions.every((t) => t.source === 'bank' && /자동이체|CMS/.test(t.method ?? ''));
    if (s.amountVaries && !s.serviceId && !s.via && !verified && s.kind === 'subscription' && !autoDebit) {
      confidence -= 0.15;
    }

    const receiptName = evidence.find((r) => r.serviceId === finalServiceId)?.serviceName;
    subs.push({
      id: '',
      key: finalServiceId ?? s.key,
      serviceId: finalServiceId,
      name: service?.name ?? receiptName ?? s.merchant,
      category: categoryOf(finalServiceId, s.via, s.kind),
      paymentPath: s.transactions[s.transactions.length - 1].path ?? [],
      kind: s.kind === 'bill' ? 'bill' : 'subscription',
      status,
      cycle: s.cycle,
      amount: s.amount,
      amountVaries: s.amountVaries,
      foreignAmount: s.foreignAmount,
      foreignCurrency: s.foreignCurrency,
      lastPaymentDate: s.lastDate,
      nextPaymentDate,
      confidence: clamp(confidence),
      confidenceLabel: confidenceLabel(clamp(confidence)),
      sources: sourcesOf(s.transactions, evidence, options.sourceOf),
      transactionIds: s.transactions.map((t) => t.id),
      emailIds: evidence.map((r) => r.emailId),
      notes,
    });
  }

  // 2) 거래내역에서 못 찾았지만 메일에만 있는 구독 (연간 결제, 올리지 않은 카드로 낸 결제 등)
  const covered = new Set(subs.map((s) => s.serviceId).filter(Boolean));
  const leftovers = new Map<string, EmailReceipt[]>();
  for (const r of live) {
    if (used.has(r.emailId) || r.type === 'cancel' || covered.has(r.serviceId)) continue;
    leftovers.set(r.serviceId, [...(leftovers.get(r.serviceId) ?? []), r]);
  }
  const linked = new Set<string>();
  for (const [serviceId, group] of leftovers) {
    const charges = group.filter((r) => r.type === 'charge').sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = group.filter((r) => r.type === 'upcoming').sort((a, b) => a.date.localeCompare(b.date));
    if (charges.length === 0 && upcoming.length === 0) continue;

    const statedCycle = majority(group.map((r) => r.cycle).filter((c): c is Cycle => Boolean(c)));
    const fitted = charges.length >= 2 ? fitCycle(charges.map((r) => r.date), window)?.cycle : undefined;
    const cycle: Cycle = statedCycle ?? fitted ?? 'monthly';

    // 단건 거래(연간 결제 등)를 영수증과 연결한다.
    const txs: Transaction[] = [];
    for (const r of charges) {
      const tx = unmatchedTxs.find((t) => {
        if (linked.has(t.id) || !amountMatches(t, r) || Math.abs(diffDays(t.date, r.date)) > window) return false;
        const m = matchMerchant(t.merchant);
        return m.serviceId === serviceId || (m.via !== undefined && (m.via === r.billedVia || m.via === 'pg'));
      });
      if (tx) {
        linked.add(tx.id);
        txs.push(tx);
      }
    }

    const last = charges[charges.length - 1];
    const lastTx = txs[txs.length - 1];
    const stated = [...upcoming, ...charges].filter((r) => r.nextDate && (!last || r.nextDate > last.date)).pop();
    const nextPaymentDate =
      stated?.nextDate ?? (last ? (cycle === 'yearly' ? addYears(last.date, 1) : addMonths(last.date, 1)) : undefined);
    const cancel = latestCancel(serviceId, last?.date ?? upcoming[0].date);
    let status: SubscriptionStatus = 'active';
    if (cancel) status = 'canceled';
    else if (nextPaymentDate && diffDays(nextPaymentDate, options.asOf) > grace) status = 'suspected_canceled';

    const notes: string[] = [];
    if (txs.length === 0) notes.push('거래내역에서는 찾지 못하고 메일로만 확인 (다른 카드로 결제했을 수 있음)');
    if (!statedCycle && !fitted) notes.push('결제 주기는 추정값');
    if (cancel) notes.push(`해지 메일 확인 (${cancel.date})`);

    let confidence = charges.length >= 2 ? 0.6 : 0.45;
    if (statedCycle) confidence += 0.1;
    if (stated) confidence += 0.1;
    if (txs.length) confidence += 0.15;
    if (SERVICE_BY_ID.has(serviceId)) confidence += 0.05;

    const ref = last ?? upcoming[upcoming.length - 1];
    const usd = ref.currency === 'USD';
    const evidence = cancel ? [...group, cancel] : group;
    for (const r of evidence) used.add(r.emailId);
    subs.push({
      id: '',
      key: serviceId,
      serviceId,
      name: SERVICE_BY_ID.get(serviceId)?.name ?? ref.serviceName,
      category: categoryOf(serviceId, ref.billedVia, 'subscription'),
      paymentPath: lastTx?.path ?? (ref.billedVia ? [INTERMEDIARY_BY_ID.get(ref.billedVia)!.name] : []),
      kind: SERVICE_BY_ID.get(serviceId)?.kind ?? 'subscription',
      status,
      cycle,
      amount: lastTx?.amount ?? (usd ? undefined : ref.amount),
      amountVaries: false,
      foreignAmount: usd ? ref.amount : undefined,
      foreignCurrency: usd ? 'USD' : undefined,
      lastPaymentDate: last?.date,
      nextPaymentDate: status === 'active' ? nextPaymentDate : undefined,
      confidence: clamp(confidence),
      confidenceLabel: confidenceLabel(clamp(confidence)),
      sources: sourcesOf(txs, evidence, options.sourceOf),
      transactionIds: txs.map((t) => t.id),
      emailIds: evidence.map((r) => r.emailId),
      notes,
    });
  }

  const statusOrder: Record<SubscriptionStatus, number> = { active: 0, suspected_canceled: 1, canceled: 2 };
  subs.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      (a.nextPaymentDate ?? '9999').localeCompare(b.nextPaymentDate ?? '9999') ||
      a.name.localeCompare(b.name),
  );
  subs.forEach((s, i) => (s.id = `sub${i + 1}`));
  return subs;
}
