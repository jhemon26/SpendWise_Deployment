import type { Transaction } from '@spendwise/shared-types';

export type IncomeEntry = {
  readonly local_id: string;
  readonly amountMinor: number;   // always positive; the sign is the caller's business
  readonly currency: string;
  readonly occurredAt: string;
  readonly label: string;
};

export type IncomeTimeline = {
  readonly entries: readonly IncomeEntry[];
  readonly monthTotalMinor: number;
  /** Entries that exist but are not shown, so the UI can say so honestly. */
  readonly hiddenCount: number;
};

/**
 * Income, newest first, for the Profile timeline.
 *
 * Deliberately NOT scoped to the current month. Scoping it there means the
 * first of the month wipes the timeline clean even though the user was paid
 * four days ago — which is the exact complaint this screen exists to answer.
 * The running list always has something in it; the month total below it is
 * where the calendar gets its say.
 */
export function incomeTimeline(
  transactions: readonly Transaction[],
  now: Date,
  limit = 8,
): IncomeTimeline {
  const live = transactions
    .filter((t) => !t.deleted_at && t.is_income)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  const monthTotalMinor = live.reduce((sum, t) => {
    const d = new Date(t.occurred_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      ? sum + Math.abs(t.base_minor ?? t.amount_minor)
      : sum;
  }, 0);

  return {
    entries: live.slice(0, limit).map((t) => ({
      local_id: t.local_id,
      amountMinor: Math.abs(t.amount_minor),
      currency: t.currency,
      occurredAt: t.occurred_at,
      label: t.merchant?.trim() || 'Income',
    })),
    monthTotalMinor,
    hiddenCount: Math.max(0, live.length - limit),
  };
}
