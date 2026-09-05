import { cyclesBetween, type Cycle, type CycleSettings } from './cycle.js';

/**
 * Money you actually hold, cycle by cycle.
 *
 * The app used to budget from an assumed pay packet: it back-dated to your
 * last payday, took `expectedIncomeMinor` on faith, and divided that up. Join
 * on a Tuesday with £200 left and it would still plan around £500, because
 * nothing ever asked what you had. Worse, the flow rollover added a full
 * cycle's allowance every cycle whether income arrived or not, so an unfunded
 * cycle quietly manufactured a surplus.
 *
 * This is the correction, and it is deliberately dull arithmetic:
 *
 *     closing = opening + income − outflow
 *
 * `opening` for the first cycle is what you told us you had. Every later cycle
 * opens on the previous one's close, so a good week carries forward and so
 * does an overspent one — a negative balance is a real state, not an error.
 *
 * Transfers into a pot are NOT outflow. Setting £90 aside for rent moves money
 * between your own pockets; you are no poorer for it. Only the rent payment
 * itself leaves. Counting both would charge you twice for the same bill.
 */

export interface CashMovements {
  /** Wages, refunds, anything arriving. */
  readonly incomeMinor: number;
  /** Money that left you: spending and bill payments alike. Not transfers. */
  readonly outflowMinor: number;
}

export interface CashRow {
  readonly cycle: Cycle;
  readonly openingMinor: number;
  readonly incomeMinor: number;
  readonly outflowMinor: number;
  readonly closingMinor: number;
}

export function cashLedger(
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  openingCashMinor: number,
  movementsIn: (c: Cycle, from: Date) => CashMovements,
): CashRow[] {
  const rows: CashRow[] = [];
  let balance = openingCashMinor;
  const cycles = cyclesBetween(budgetStart, now, s);
  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i]!;
    /*
     * The first cycle counts only from the day the balance was measured.
     *
     * `cyclesBetween` returns whole cycles, so the one containing budgetStart
     * begins BEFORE it. Counting that whole cycle replayed spending the person
     * had already done when they told us the figure — someone who said "I have
     * £160" on the 31st had the entire month subtracted from it and was shown
     * −£1,271.85. The balance is a statement about a moment; everything before
     * that moment is already inside it.
     */
    const from = i === 0 && budgetStart > cycle.start ? budgetStart : cycle.start;
    const { incomeMinor, outflowMinor } = movementsIn(cycle, from);
    const openingMinor = balance;
    balance = openingMinor + incomeMinor - outflowMinor;
    rows.push({ cycle, openingMinor, incomeMinor, outflowMinor, closingMinor: balance });
  }
  return rows;
}

export interface CashState {
  readonly rows: readonly CashRow[];
  /** Cash carried into the current cycle — last cycle's leftover, or debt. */
  readonly broughtForwardMinor: number;
  /** Received so far this cycle. */
  readonly incomeMinor: number;
  /** Gone so far this cycle. */
  readonly outflowMinor: number;
  /** Everything you hold right now, earmarked or not. */
  readonly totalMinor: number;
}

export function cashState(
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  openingCashMinor: number,
  movementsIn: (c: Cycle, from: Date) => CashMovements,
): CashState {
  const rows = cashLedger(s, budgetStart, now, openingCashMinor, movementsIn);
  const current = rows[rows.length - 1];
  if (!current) {
    return {
      rows, broughtForwardMinor: openingCashMinor, incomeMinor: 0,
      outflowMinor: 0, totalMinor: openingCashMinor,
    };
  }
  return {
    rows,
    broughtForwardMinor: current.openingMinor,
    incomeMinor: current.incomeMinor,
    outflowMinor: current.outflowMinor,
    totalMinor: current.closingMinor,
  };
}

/**
 * Split a cycle's transactions into the two figures the ledger needs.
 *
 * Kept here rather than in the caller so the rule about transfers lives in one
 * place: a transfer is a movement between your own pockets and must never
 * count as money leaving.
 */
export function movementsFrom(
  transactions: readonly { deleted_at?: string | null; is_income: boolean; is_transfer?: boolean;
                           occurred_at: string; amount_minor: number; base_minor?: number | null }[],
): (c: Cycle) => CashMovements {
  return (c: Cycle, from: Date = c.start): CashMovements => {
    let incomeMinor = 0;
    let outflowMinor = 0;
    for (const t of transactions) {
      if (t.deleted_at) continue;
      /* `from` is the cycle's own start except in the very first cycle, where
         it is the day the opening balance was measured — see cashLedger. */
      const at = new Date(t.occurred_at).getTime();
      if (at < from.getTime() || at >= c.end.getTime()) continue;
      if (t.is_transfer) continue;
      const v = Math.abs(t.base_minor ?? t.amount_minor);
      if (t.is_income) incomeMinor += v;
      else outflowMinor += v;
    }
    return { incomeMinor, outflowMinor };
  };
}
