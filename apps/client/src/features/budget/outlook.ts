import type { Category, Transaction } from '@spendwise/shared-types';
import { cyclesBetween, type CycleSettings } from './cycle.js';
import { nextDueOn } from './pots.js';
import { isPot, potOf } from './model.js';

/**
 * The calendar month, for people whose pay does not run on one.
 *
 * The engine budgets per pay cycle, which is right — that is when money
 * arrives and when limits refill. But bills are monthly, and a weekly earner
 * has four paydays in some months and five in others, so the question "across
 * this month, does what I earn cover what I owe?" had no answer anywhere in
 * the app. Per-cycle figures cannot be added up in your head to get it.
 *
 * This does not feed the budget. It is a view: what is expected, what has
 * actually landed so far, and what the month's bills come to.
 */

export interface MonthOutlook {
  readonly label: string;
  /** Paydays falling inside this calendar month. Four or five, honestly counted. */
  readonly paydaysTotal: number;
  /** How many have already passed. */
  readonly paydaysSoFar: number;
  /** paydaysTotal × the expected packet. */
  readonly expectedMinor: number;
  /** Income actually recorded this month. */
  readonly receivedMinor: number;
  /** Bills falling due inside this month, at full value. */
  readonly billsDueMinor: number;
  /** Spent so far this month, excluding transfers. */
  readonly spentMinor: number;
  /** Expected income less the month's bills. Negative means it does not cover. */
  readonly afterBillsMinor: number;
}

export function monthOutlook(
  s: CycleSettings,
  expectedIncomeMinor: number,
  categories: readonly Category[],
  transactions: readonly Transaction[],
  now: Date,
): MonthOutlook {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  /*
   * Counted, not assumed. 52 ÷ 12 is 4.33, and no month has 4.33 paydays —
   * averaging is exactly the error the rest of the engine exists to avoid.
   */
  const paydays = cyclesBetween(start, new Date(end.getTime() - 1), s)
    .map((c) => c.start)
    .filter((d) => d >= start && d < end);
  const paydaysSoFar = paydays.filter((d) => d <= now).length;

  const within = (t: Transaction): boolean => {
    const at = new Date(t.occurred_at).getTime();
    return at >= start.getTime() && at < end.getTime();
  };
  const value = (t: Transaction): number => Math.abs(t.base_minor ?? t.amount_minor);

  let receivedMinor = 0;
  let spentMinor = 0;
  for (const t of transactions) {
    if (t.deleted_at || !within(t)) continue;
    if (t.is_transfer) continue;          // moving money is neither
    if (t.is_income) receivedMinor += value(t);
    else spentMinor += value(t);
  }

  /* A bill counts once, on the month it actually leaves. */
  let billsDueMinor = 0;
  for (const c of categories) {
    if (c.deleted_at || !isPot(c)) continue;
    const pot = potOf(c, now);
    if (pot.kind !== 'bill') continue;
    const due = nextDueOn(pot, start);
    if (due && due >= start && due < end) billsDueMinor += pot.amountMinor;
  }

  const expectedMinor = paydays.length * expectedIncomeMinor;
  return {
    label: start.toLocaleDateString('en-GB', { month: 'long' }),
    paydaysTotal: paydays.length,
    paydaysSoFar,
    expectedMinor,
    receivedMinor,
    billsDueMinor,
    spentMinor,
    afterBillsMinor: expectedMinor - billsDueMinor,
  };
}
