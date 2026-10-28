import type { Intermediary, Transaction, TxSource } from './types.ts';
import { diffDays, toDayNumber } from './dates.ts';
import {
  canonicalize,
  fundingKind,
  INTERMEDIARY_BY_ID,
  matchMerchant,
  payAppIn,
  payPlatformOf,
  sourceLabel,
} from './merchants.ts';
import { guessInstitution } from './io/importers.ts';

// 여러 곳의 내역을 서로 맞춰 본다.
// 카카오페이로 멜론을 결제하면 통장에는 "카카오페이"로, 카카오페이 내역에는 "멜론"으로 찍힌다.
// 둘을 같은 결제로 합쳐서 중복을 없애고, 돈이 어떤 경로로 나갔는지(농협 계좌 → 카카오페이 → 멜론) 남긴다.

export interface ReconcileResult {
  /** 실제 결제·입금 하나당 한 줄. 같은 결제가 찍힌 다른 내역은 합쳐져 있다. */
  ledger: Transaction[];
  /** 페이 머니 충전처럼 내 돈이 자리만 옮긴 거래 (양쪽 내역 모두) */
  internal: Transaction[];
  /** 다른 내역에 합쳐진 거래 수 */
  merged: number;
  topups: number;
}

/** 같은 결제가 두 내역에 찍히는 시각 차이 허용치 (초) */
const MAX_SECONDS_APART = 600;

function secondsOf(tx: Transaction): number | undefined {
  if (!tx.time) return undefined;
  const [h, m, s] = tx.time.split(':').map(Number);
  return toDayNumber(tx.date) * 86_400 + h * 3600 + m * 60 + (s || 0);
}

/** 두 거래가 같은 결제일 만큼 가까운지. 가까울수록 작은 값, 너무 멀면 null */
function distance(a: Transaction, b: Transaction): number | null {
  const sa = secondsOf(a);
  const sb = secondsOf(b);
  if (sa !== undefined && sb !== undefined && Math.abs(sa - sb) <= MAX_SECONDS_APART) return Math.abs(sa - sb);
  // 시각이 없거나 정산 시각이 따로 찍히는 내역: 날짜만 맞으면 낮은 우선순위로 인정
  const days = Math.abs(diffDays(a.date, b.date));
  return days <= 1 ? 86_400 * (days + 1) : null;
}

const byTime = (a: Transaction, b: Transaction) =>
  a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');

/** 통장·카드 거래가 이 간편결제 결제의 돈줄인지 (가맹점명이 그 페이이거나, 실제 가맹점명이 같이 찍힌 경우) */
function fundsPlatform(c: Transaction, platform: Intermediary | undefined, payMerchant: string): boolean {
  const via = payPlatformOf(c.merchant) ?? payPlatformOf(c.memo);
  if (via) return via === platform;
  const a = canonicalize(c.merchant);
  const b = canonicalize(payMerchant);
  return a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a));
}

export function reconcile(transactions: Transaction[]): ReconcileResult {
  const txs = transactions.map((t) => ({ ...t }));
  const others = txs.filter((t) => t.source !== 'pay').sort(byTime);
  const pays = txs.filter((t) => t.source === 'pay').sort(byTime);
  const consumed = new Set<string>();
  const internal = new Set<string>();

  const findPartner = (p: Transaction, sources: TxSource[], platform: Intermediary | undefined) => {
    let best: Transaction | undefined;
    let bestDistance = Infinity;
    for (const c of others) {
      if (consumed.has(c.id) || internal.has(c.id) || !sources.includes(c.source)) continue;
      if (c.direction !== p.direction || Math.abs(c.amount - p.amount) >= 1) continue;
      if (!fundsPlatform(c, platform, p.merchant)) continue;
      const d = distance(c, p);
      if (d !== null && d < bestDistance) {
        best = c;
        bestDistance = d;
      }
    }
    return best;
  };

  const platformName = (p: Transaction, platform: Intermediary | undefined) =>
    p.institution ?? (platform ? INTERMEDIARY_BY_ID.get(platform)!.name : '간편결제');

  // 1) 페이 머니 충전: 통장 출금과 짝지어 둘 다 내부 이동으로 뺀다.
  //    그 통장 내역을 안 올렸어도 머니 내역에 충전한 은행이 적혀 있으면(카카오페이 머니의 '은행' 열) 그 계좌로 본다.
  const topupSources: { platform: Intermediary | undefined; at: Transaction; label: string }[] = [];
  for (const p of pays) {
    if (p.kind !== 'topup') continue;
    const platform = payPlatformOf(p.institution) ?? payPlatformOf(p.merchant);
    internal.add(p.id);
    const bank = findPartner({ ...p, direction: 'out' }, ['bank'], platform);
    const money = `${platformName(p, platform)} 머니`;
    const fundingBank = fundingKind(p.funding) === 'account' ? guessInstitution(p.funding ?? '', 'bank') : undefined;
    const label = bank ? sourceLabel(bank) : fundingBank ? `${fundingBank} 계좌` : undefined;
    if (bank) {
      internal.add(bank.id);
      p.linkedIds = [bank.id];
    }
    p.path = label ? [label, money] : [money];
    if (label) topupSources.push({ platform, at: p, label });
  }

  // 2) 페이 결제·송금·환불: 결제수단에 맞는 통장·카드 거래를 찾아 합친다.
  for (const p of pays) {
    if (p.kind === 'topup') continue;
    const platform = payPlatformOf(p.institution) ?? payPlatformOf(p.merchant);
    const name = platformName(p, platform);
    const funding = fundingKind(p.funding);
    const sources: TxSource[] =
      funding === 'account' ? ['bank'] : funding === 'card' ? ['card'] : funding === 'money' ? [] : ['bank', 'card'];
    const partner = sources.length ? findPartner(p, sources, platform) : undefined;
    if (partner) {
      consumed.add(partner.id);
      p.linkedIds = [partner.id];
      p.path = [sourceLabel(partner), name];
    } else if (funding === 'money') {
      // 머니로 낸 결제는 가장 최근에 충전한 계좌에서 나온 돈으로 본다.
      const sameApp = topupSources.filter((t) => t.platform === platform);
      const before = sameApp.filter((t) => byTime(t.at, p) <= 0).pop() ?? sameApp[0];
      p.path = before ? [before.label, `${name} 머니`] : [`${name} 머니`];
    } else {
      p.path = [name];
    }
  }

  // 3) 체크카드: 통장과 카드 이용내역에 둘 다 찍히므로 카드 쪽에 합친다.
  const cardIndex = new Map<string, Transaction[]>();
  const keyOf = (t: Transaction) => `${t.date}|${t.amount}|${t.direction}|${matchMerchant(t.merchant).key}`;
  for (const c of others) {
    if (c.source === 'card' && !consumed.has(c.id)) cardIndex.set(keyOf(c), [...(cardIndex.get(keyOf(c)) ?? []), c]);
  }
  for (const b of others) {
    if (b.source !== 'bank' || !/체크카드/.test(b.method ?? '') || consumed.has(b.id) || internal.has(b.id)) continue;
    const card = cardIndex.get(keyOf(b))?.shift();
    if (!card) continue;
    consumed.add(b.id);
    card.linkedIds = [...(card.linkedIds ?? []), b.id];
    card.path = [sourceLabel(b), sourceLabel(card)];
  }

  // 4) 남은 통장·카드 거래의 경로: 가맹점이 앱스토어·간편결제·결제대행사면 그것까지 표시
  for (const t of others) {
    if (t.path || consumed.has(t.id) || internal.has(t.id)) continue;
    const via = matchMerchant(t.merchant).via ?? payAppIn(t.merchant);
    t.path = via ? [sourceLabel(t), INTERMEDIARY_BY_ID.get(via)!.name] : [sourceLabel(t)];
  }

  const ledger = txs.filter((t) => !consumed.has(t.id) && !internal.has(t.id)).sort(byTime);
  return {
    ledger,
    internal: txs.filter((t) => internal.has(t.id)).sort(byTime),
    merged: consumed.size,
    topups: pays.filter((p) => p.kind === 'topup').length,
  };
}
