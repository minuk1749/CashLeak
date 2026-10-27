import type { DetectionResult, EmailMessage, Transaction } from './types.ts';
import { maxDate } from './dates.ts';
import { dedupeTransactions } from './detect/dedupe.ts';
import { detectRecurring } from './detect/recurring.ts';
import { parseEmails } from './email/parse.ts';
import { buildSubscriptions } from './match/cross-verify.ts';

export interface PipelineInput {
  transactions: Transaction[];
  emails: EmailMessage[];
  /** 기준일. 없으면 거래내역의 마지막 날짜 */
  asOf?: string;
}

export function runPipeline(input: PipelineInput): DetectionResult {
  const { transactions, duplicates } = dedupeTransactions(input.transactions);
  const asOf = input.asOf ?? maxDate(transactions.map((t) => t.date));
  const detection = detectRecurring(transactions, { asOf });
  const receipts = parseEmails(input.emails);
  const subscriptions = buildSubscriptions(
    detection.series.filter((s) => s.kind !== 'transfer'),
    receipts,
    detection.unmatched,
    { asOf },
  );
  return {
    asOf,
    subscriptions,
    recurringTransfers: detection.series.filter((s) => s.kind === 'transfer'),
    excluded: detection.excluded,
    stats: {
      transactions: transactions.length,
      duplicateTransactions: duplicates,
      emails: input.emails.length,
      receipts: receipts.filter((r) => !r.duplicateOf).length,
      duplicateReceipts: receipts.filter((r) => r.duplicateOf).length,
    },
  };
}
