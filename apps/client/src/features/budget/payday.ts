import type { Transaction } from '@spendwise/shared-types';
import { cyclesBetween, type Cycle, type CycleSettings } from './cycle.js';

/**
 * Wages the app should have recorded but nobody typed in.
 *
 * Money arrives in a bank account, not through this app, so expecting people
 * to log every payday was always going to fail — and it did: a live account
 * with 31 transactions had *no* income at all, so the cash ledger saw a month
 * of spending against nothing coming in and reported the person as over a
 * thousand pounds down.
 *
 * So the app credits the expected amount on each payday that has already
 * passed, and the person corrects it if the real figure differed. A forecast
 * that can be edited beats a blank that cannot be right.
 *
 * Deliberately never credits the CURRENT cycle's payday until it has actually
 * arrived — crediting a wage on the morning it is due, before it lands, is the
 * same optimism that made the old app unusable.
 */

export interface PaydayCredit {
  /** Start of the cycle this wage belongs to; also the day it is dated. */
  readonly at: Date;
  readonly amountMinor: number;
}

/**
 * Which paydays between `from` and `now` have no income recorded against them.
 *
 * A cycle counts as paid if ANY income was logged inside it, whatever the
 * amount — someone who typed their real wage must never then be given a second,
 * invented one on top.
 */
export function missingPaydays(
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  expectedIncomeMinor: number,
  transactions: readonly Transaction[],
): PaydayCredit[] {
  if (expectedIncomeMinor <= 0) return [];

  const paidIn = (c: Cycle): boolean => transactions.some((t) =>
    !t.deleted_at && t.is_income
    && new Date(t.occurred_at).getTime() >= c.start.getTime()
    && new Date(t.occurred_at).getTime() < c.end.getTime());

  const out: PaydayCredit[] = [];
  for (const cycle of cyclesBetween(budgetStart, now, s)) {
    /*
     * The payday is the cycle's start. Skip any cycle that began before the
     * user's opening balance was measured: that wage is already inside the
     * figure they gave us, and crediting it again would double their money.
     */
    if (cycle.start.getTime() < budgetStart.getTime()) continue;
    if (cycle.start.getTime() > now.getTime()) continue;
    if (paidIn(cycle)) continue;
    out.push({ at: cycle.start, amountMinor: expectedIncomeMinor });
  }
  return out;
}
