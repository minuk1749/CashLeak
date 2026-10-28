import type { DetectionResult, EmailMessage, Transaction } from './types.ts';
import { maxDate } from './dates.ts';
import { reconcile } from './reconcile.ts';
import { detectRecurring } from './detect/recurring.ts';
import { parseEmails } from './email/parse.ts';
import { buildSubscriptions } from './match/cross-verify.ts';

export interface PipelineInput {
  /** 통장·카드·간편결제 내역 (여러 파일을 합친 것) */
  transactions: Transaction[];
  emails: EmailMessage[];
  /** 기준일. 없으면 거래내역의 마지막 날짜 */
  asOf?: string;
}

export function runPipeline(input: PipelineInput): DetectionResult {
  const { ledger, internal, merged, topups } = reconcile(input.transactions);
  const asOf = input.asOf ?? (input.transactions.length ? maxDate(input.transactions.map((t) => t.date)) : today());
  const detection = detectRecurring(ledger, { asOf });
  const receipts = parseEmails(input.emails);
  const sourceById = new Map(input.transactions.map((t) => [t.id, t.source]));
  const subscriptions = buildSubscriptions(
    detection.series.filter((s) => s.kind !== 'transfer'),
    receipts,
    detection.unmatched,
    { asOf, sourceOf: (id) => sourceById.get(id) },
  );
  return {
    asOf,
    subscriptions,
    recurringTransfers: detection.series.filter((s) => s.kind === 'transfer'),
    excluded: detection.excluded,
    ledger,
    internal,
    stats: {
      transactions: input.transactions.length,
      mergedTransactions: merged,
      topups,
      emails: input.emails.length,
      receipts: receipts.filter((r) => !r.duplicateOf).length,
      duplicateReceipts: receipts.filter((r) => r.duplicateOf).length,
    },
  };
}

function today(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}
