import type { Currency, Cycle, ExcludedGroup, PriceChange, RecurringSeries, SeriesKind, Transaction } from '../types.ts';
import { anchoredDate, dayOfMonth, diffDays, monthIndex, yearlyDate } from '../dates.ts';
import {
  exclusionReason,
  isBillMerchant,
  looksLikePersonalTransfer,
  matchMerchant,
  relatedMerchants,
  SERVICE_BY_ID,
  type MerchantMatch,
} from '../merchants.ts';

export interface DetectOptions {
  asOf: string;
  /** 기준일에서 허용하는 날짜 차이 (주말·공휴일 밀림, 승인 지연) */
  dayTolerance?: number;
  /** 예정일이 지나고 이 기간 동안 결제가 없으면 해지로 추정 */
  graceDays?: number;
}

export interface RecurringDetection {
  series: RecurringSeries[];
  excluded: ExcludedGroup[];
  /** 어떤 반복 결제에도 속하지 않은 출금 (메일과 단건 매칭할 때 쓴다) */
  unmatched: Transaction[];
}

interface CycleFit {
  cycle: Cycle;
  anchorDay: number;
  slots: number[];
  regular: number;
  skipped: number;
  irregular: number;
  /** 기준일보다 일찍 찍힌 결제 수. 결제는 주말·승인 지연으로 늦어질 뿐 당겨지는 일은 드물다. */
  early: number;
  exact: number;
}

const byDate = (a: Transaction, b: Transaction) =>
  a.date === b.date ? (a.time ?? '').localeCompare(b.time ?? '') : a.date.localeCompare(b.date);

export function detectRecurring(transactions: Transaction[], options: DetectOptions): RecurringDetection {
  const tol = options.dayTolerance ?? 3;
  const grace = options.graceDays ?? 5;
  const excluded = new Map<string, ExcludedGroup>();
  const groups = new Map<string, { match: MerchantMatch; txs: Transaction[] }>();

  for (const tx of transactions) {
    if (tx.direction !== 'out') continue;
    const reason = exclusionReason(tx);
    if (reason) {
      const g = excluded.get(tx.merchant) ?? { merchant: tx.merchant, reason, count: 0, total: 0 };
      g.count += 1;
      g.total += tx.amount;
      excluded.set(tx.merchant, g);
      continue;
    }
    const match = matchMerchant(tx.merchant);
    const group = groups.get(match.key) ?? { match, txs: [] };
    group.txs.push(tx);
    groups.set(match.key, group);
  }

  const series: RecurringSeries[] = [];
  const used = new Set<string>();
  for (const { match, txs } of groups.values()) {
    const unknownMerchant = !match.serviceId && !match.via;
    for (const found of findSeries(txs, tol, !match.via, Boolean(match.serviceId))) {
      // 자주 가는 가게(편의점, 카페)에서 같은 금액이 우연히 한 달 간격으로 두 번 찍힌 경우를 거른다.
      if (unknownMerchant && found.txs.length < 3 && txs.length > found.txs.length + 3) continue;
      const s = buildSeries(match, found.txs, found.fit, options.asOf, grace, txs.length - found.txs.length);
      if (!s || (s.kind === 'transfer' && s.transactions.length < 3)) continue;
      series.push(s);
      for (const tx of s.transactions) used.add(tx.id);
    }
  }
  const joined = joinRenamed(series, tol, options.asOf, grace);
  joined.sort((a, b) => a.key.localeCompare(b.key) || a.firstDate.localeCompare(b.firstDate));
  joined.forEach((s, i) => (s.id = `s${i + 1}`));

  const unmatched = transactions.filter((tx) => tx.direction === 'out' && !used.has(tx.id) && !exclusionReason(tx));
  return { series: joined, excluded: [...excluded.values()], unmatched };
}

/**
 * 가맹점 표기만 바뀐 구독을 하나로 잇는다. 청구 방식이나 결제대행사가 바뀌면 같은 구독이
 * '주식회사 카카오' → '카카오구독료_카카오페이'처럼 다른 이름으로 찍힌다 (실제 토스뱅크 내역).
 * 앞 묶음이 끝난 바로 다음 차례에 뒤 묶음이 같은 금액으로 시작하고, 이름이 같은 회사로 보일 때만 잇는다.
 */
function joinRenamed(series: RecurringSeries[], tol: number, asOf: string, grace: number): RecurringSeries[] {
  const list = [...series];
  for (let changed = true; changed; ) {
    changed = false;
    search: for (const a of list) {
      for (const b of list) {
        if (a === b || a.key === b.key || a.kind === 'transfer' || b.kind === 'transfer' || a.cycle !== b.cycle) continue;
        if (a.lastDate >= b.firstDate || Math.abs(diffDays(a.nextDate, b.firstDate)) > tol) continue;
        const [x, y] = [amountValue(a.transactions[a.transactions.length - 1]), amountValue(b.transactions[0])];
        if (x.currency !== y.currency || Math.abs(x.value - y.value) > 0.005) continue;
        if (!relatedMerchants(a.merchant, b.merchant)) continue;
        const txs = [...a.transactions, ...b.transactions];
        const fit = fitCycle(txs.map((t) => t.date), tol);
        if (!fit || fit.irregular > 0) continue;
        const match = { key: b.key, serviceId: b.serviceId, via: b.via };
        const merged = buildSeries(match, txs, fit, asOf, grace, a.otherPaymentsAtMerchant + b.otherPaymentsAtMerchant);
        if (!merged) continue;
        list.splice(list.indexOf(b), 1, merged);
        list.splice(list.indexOf(a), 1);
        changed = true;
        break search;
      }
    }
  }
  return list;
}

/**
 * 같은 가맹점 거래에서 반복 결제 묶음을 찾는다.
 * 1) 전체가 한 주기에 딱 맞으면 하나의 묶음 (금액이 바뀌어도 같은 구독으로 본다)
 * 2) 아니면 같은 금액끼리 나눠서 각각 주기를 확인 (애플처럼 한 가맹점에 구독이 여러 개인 경우)
 * 알려진 서비스가 아니면, 금액이 한 번에 두 배 넘게 바뀐 것은 가격 변경으로 보지 않는다
 * (실제 내역에서 토스페이로 낸 소액 결제와 다음 달의 몇 배 큰 결제가 한 구독으로 잡힌 적이 있다).
 */
function findSeries(txs: Transaction[], tol: number, allowMerge: boolean, knownService: boolean) {
  const sorted = [...txs].sort(byDate);
  const plausible = (list: Transaction[]) => knownService || steadyAmounts(list);
  const whole = fitCycle(sorted.map((t) => t.date), tol);
  if (whole && whole.irregular === 0 && plausible(sorted)) return [{ txs: sorted, fit: whole }];

  const found: { txs: Transaction[]; fit: CycleFit }[] = [];
  for (const cluster of clusterByAmount(sorted)) {
    const fit = fitCycle(cluster.map((t) => t.date), tol);
    if (fit) found.push({ txs: cluster, fit });
  }
  return allowMerge ? mergeSequential(found, tol, plausible) : found;
}

/** 이어지는 결제 금액이 매번 두 배 이내로만 바뀌는지 */
function steadyAmounts(txs: Transaction[]): boolean {
  return txs.every((t, i) => {
    if (i === 0) return true;
    const [a, b] = [amountValue(txs[i - 1]).value, amountValue(t).value];
    return Math.max(a, b) <= 2 * Math.min(a, b);
  });
}

function amountValue(tx: Transaction): { value: number; currency: Currency } {
  if (tx.foreignCurrency && tx.foreignAmount !== undefined) return { value: tx.foreignAmount, currency: tx.foreignCurrency };
  return { value: tx.amount, currency: 'KRW' };
}

/** 국내 구독은 매번 같은 금액이 찍히므로 금액이 정확히 같은 거래끼리 묶는다. 해외 결제는 현지 금액 기준. */
function clusterByAmount(sorted: Transaction[]): Transaction[][] {
  const clusters = new Map<string, Transaction[]>();
  for (const tx of sorted) {
    const { value, currency } = amountValue(tx);
    const k = `${currency}:${value.toFixed(2)}`;
    clusters.set(k, [...(clusters.get(k) ?? []), tx]);
  }
  return [...clusters.values()];
}

/** 끝난 묶음 바로 뒤에 이어지는 묶음은 가격이 바뀐 같은 구독으로 합친다. */
function mergeSequential(found: { txs: Transaction[]; fit: CycleFit }[], tol: number, plausible: (txs: Transaction[]) => boolean) {
  const list = [...found].sort((a, b) => a.txs[0].date.localeCompare(b.txs[0].date));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.fit.cycle !== b.fit.cycle) continue;
        if (a.txs[a.txs.length - 1].date >= b.txs[0].date) continue;
        const txs = [...a.txs, ...b.txs];
        const fit = fitCycle(txs.map((t) => t.date), tol);
        if (fit && fit.irregular === 0 && plausible(txs)) {
          list.splice(j, 1);
          list[i] = { txs, fit };
          merged = true;
          break outer;
        }
      }
    }
  }
  return list;
}

export function fitCycle(dates: string[], tol: number): CycleFit | null {
  return fitMonthly(dates, tol) ?? fitYearly(dates, tol);
}

/** 날짜가 기준일 몇 번째 달에 해당하는지와 기준일에서 며칠 떨어졌는지 (늦으면 양수) */
function monthlySlot(date: string, anchorDay: number, tol: number): { slot: number; diff: number } | null {
  const idx = monthIndex(date);
  let best: { slot: number; diff: number } | null = null;
  for (const slot of [idx - 1, idx, idx + 1]) {
    const diff = diffDays(anchoredDate(slot, anchorDay), date);
    if (!best || Math.abs(diff) < Math.abs(best.diff)) best = { slot, diff };
  }
  return best && Math.abs(best.diff) <= tol ? best : null;
}

function scoreFit(f: CycleFit): number {
  return f.regular - 2 * f.irregular - f.skipped;
}

function betterFit(a: CycleFit, b: CycleFit): boolean {
  if (scoreFit(a) !== scoreFit(b)) return scoreFit(a) > scoreFit(b);
  if (a.early !== b.early) return a.early < b.early;
  return a.exact > b.exact;
}

function countGaps(slots: (number | null)[]) {
  let regular = 0;
  let skipped = 0;
  let irregular = 0;
  // 주기에 안 맞는 결제가 끼어 있어도 그 앞뒤 결제 사이의 간격은 따로 센다.
  let prev: number | null = null;
  for (const cur of slots) {
    if (cur === null) {
      irregular++;
      continue;
    }
    if (prev !== null) {
      const gap = cur - prev;
      if (gap === 1) regular++;
      else if (gap === 2) skipped++;
      else irregular++;
    }
    prev = cur;
  }
  return { regular, skipped, irregular };
}

/** 같은 날짜(±tol)에 한 달 간격으로 결제됐는지. 기준일 후보를 모두 시험해 가장 잘 맞는 것을 고른다. */
function fitMonthly(dates: string[], tol: number): CycleFit | null {
  if (dates.length < 2) return null;
  let best: CycleFit | null = null;
  for (const anchorDay of new Set(dates.map(dayOfMonth))) {
    const placed = dates.map((d) => monthlySlot(d, anchorDay, tol));
    const gaps = countGaps(placed.map((p) => (p ? p.slot : null)));
    const fit: CycleFit = {
      cycle: 'monthly',
      anchorDay,
      slots: placed.map((p) => (p ? p.slot : NaN)),
      ...gaps,
      early: placed.filter((p) => p && p.diff < 0).length,
      exact: placed.filter((p) => p && p.diff === 0).length,
    };
    if (!best || betterFit(fit, best)) best = fit;
  }
  if (!best || best.regular === 0) return null;
  const allowedIrregular = dates.length >= 5 ? 1 : 0;
  if (best.irregular > allowedIrregular || best.skipped > 1) return null;
  return best;
}

function fitYearly(dates: string[], tol: number): CycleFit | null {
  if (dates.length < 2) return null;
  const month = Number(dates[0].slice(5, 7));
  const day = dayOfMonth(dates[0]);
  const slots = dates.map((d) => {
    const y = Number(d.slice(0, 4));
    for (const year of [y - 1, y, y + 1]) {
      if (Math.abs(diffDays(yearlyDate(year, month, day), d)) <= tol) return year;
    }
    return null;
  });
  const gaps = countGaps(slots);
  if (gaps.regular === 0 || gaps.irregular > 0) return null;
  return {
    cycle: 'yearly',
    anchorDay: month * 100 + day,
    slots: slots.map((s) => s ?? NaN),
    ...gaps,
    early: 0,
    exact: 0,
  };
}

function nextDateOf(fit: CycleFit): string {
  const lastSlot = fit.slots.findLast((s) => Number.isFinite(s)) as number;
  if (fit.cycle === 'monthly') return anchoredDate(lastSlot + 1, fit.anchorDay);
  return yearlyDate(lastSlot + 1, Math.floor(fit.anchorDay / 100), fit.anchorDay % 100);
}

function classify(match: MerchantMatch, txs: Transaction[]): SeriesKind {
  if (match.serviceId) return SERVICE_BY_ID.get(match.serviceId)?.kind ?? 'subscription';
  if (txs.every(looksLikePersonalTransfer)) return 'transfer';
  if (isBillMerchant(txs[0].merchant)) return 'bill';
  return 'subscription';
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function buildSeries(
  match: MerchantMatch,
  txs: Transaction[],
  fit: CycleFit,
  asOf: string,
  grace: number,
  otherPaymentsAtMerchant: number,
): RecurringSeries | null {
  const kind = classify(match, txs);
  const amounts = txs.map(amountValue);
  const currency = amounts[amounts.length - 1].currency;
  const sameCurrency = amounts.every((a) => a.currency === currency);
  const changes: PriceChange[] = [];
  for (let i = 1; i < amounts.length; i++) {
    if (sameCurrency && Math.abs(amounts[i].value - amounts[i - 1].value) > 0.005) {
      changes.push({ date: txs[i].date, from: amounts[i - 1].value, to: amounts[i].value, currency });
    }
  }
  // 한 번 바뀐 건 가격 변경, 여러 번 바뀌면 매번 금액이 다른 결제(통신비 등)로 본다.
  const amountVaries = !sameCurrency || changes.length > 1;
  const knownRecurring = Boolean(match.serviceId) || kind !== 'subscription';
  if (amountVaries && !knownRecurring && coefficientOfVariation(txs.map((t) => t.amount)) > 0.35) return null;

  const last = txs[txs.length - 1];
  const nextDate = nextDateOf(fit);
  return {
    id: '',
    key: match.key,
    merchant: last.merchant,
    serviceId: match.serviceId,
    via: match.via,
    kind,
    cycle: fit.cycle,
    anchorDay: fit.anchorDay,
    transactions: txs,
    amount: last.amount,
    foreignAmount: last.foreignAmount,
    foreignCurrency: last.foreignCurrency,
    amountVaries,
    priceChanges: amountVaries ? [] : changes,
    otherPaymentsAtMerchant,
    gaps: { regular: fit.regular, skipped: fit.skipped, irregular: fit.irregular },
    firstDate: txs[0].date,
    lastDate: last.date,
    nextDate,
    active: diffDays(nextDate, asOf) <= grace,
  };
}
