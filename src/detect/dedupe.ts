import type { Transaction } from '../types.ts';
import { matchMerchant } from '../merchants.ts';

/**
 * 체크카드 결제는 통장 내역과 카드 이용내역에 둘 다 찍힌다.
 * 둘 다 올리면 같은 결제가 두 번 세어지므로 카드 쪽만 남긴다.
 */
export function dedupeTransactions(transactions: Transaction[]): { transactions: Transaction[]; duplicates: number } {
  const cardKeys = new Map<string, number>();
  const keyOf = (tx: Transaction) => `${tx.date}|${tx.amount}|${matchMerchant(tx.merchant).key}`;
  for (const tx of transactions) {
    if (tx.source === 'card' && tx.direction === 'out') cardKeys.set(keyOf(tx), (cardKeys.get(keyOf(tx)) ?? 0) + 1);
  }
  let duplicates = 0;
  const kept = transactions.filter((tx) => {
    if (tx.source !== 'bank' || tx.method !== '체크카드' || tx.direction !== 'out') return true;
    const left = cardKeys.get(keyOf(tx)) ?? 0;
    if (left === 0) return true;
    cardKeys.set(keyOf(tx), left - 1);
    duplicates++;
    return false;
  });
  return { transactions: kept, duplicates };
}
