import type { Transaction } from '@spendwise/shared-types';
import { inCycle, type Cycle } from './cycle.js';

/**
 * What a category has cost inside one cycle.
 *
 * Three screens each answered this differently. Home counted the cycle, while
 * Budgets and Profile counted the calendar month — but `limit_minor` is a
 * per-cycle allowance (see flows.ts, which refills it every cycle). So someone
 * paid weekly had a month of spending measured against one week of budget:
 * every bar sat pinned at full, and the same category read differently on
 * three screens. One function now, so they cannot drift apart again.
 */
export function spentInCycle(
  transactions: readonly Transaction[],
  categoryId: string,
  cycle: Cycle,
): number {
  return transactions.reduce(
    (sum, t) => (!t.deleted_at && !t.is_income && t.category_id === categoryId && inCycle(t.occurred_at, cycle))
      ? sum + Math.abs(t.base_minor ?? t.amount_minor)
      : sum,
    0,
  );
}

/**
 * How full a bar should be, as a percentage.
 *
 * Never returns NaN or Infinity. `width: "NaN%"` is invalid CSS, so the
 * browser drops the declaration and the element falls back to its auto width —
 * which for a block child is the full track. A divide-by-zero therefore drew a
 * *completely full* bar, the most alarming reading possible, for a category
 * with no budget set at all.
 */
export function usagePct(spentMinor: number, limitMinor: number): number {
  if (!Number.isFinite(spentMinor) || !Number.isFinite(limitMinor)) return 0;
  if (limitMinor <= 0) return 0;
  return (spentMinor / limitMinor) * 100;
}
