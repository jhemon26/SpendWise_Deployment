/**
 * Flows — money that refills each cycle.
 *
 * Groceries, fuel, eating out. A fresh allowance every payday; unspent money
 * carries forward, overspend carries forward too.
 *
 * ROLLOVER IS NOT OPTIONAL
 *
 * Weekly budgeting without carry-over is four monthly budgets that punish you
 * for being lumpy. Someone who spends £70 one week and £110 the next has done
 * nothing wrong, and an app that scolds them the second week gets deleted. So
 * underspend rolls in and is shown as part of what is available.
 *
 * Overspend rolls in too, as a negative. Not carrying it would make going over
 * free, and a budget you can exceed for nothing is not a budget.
 *
 * Rollover is deliberately uncapped but always displayed separately from the
 * allowance. A cap would silently confiscate money the person genuinely saved;
 * showing the two numbers apart means they can see when they are spending this
 * week's money and when they are spending what they carried.
 */

import { cyclesBetween, inCycle, type Cycle, type CycleSettings } from './cycle.js';

export interface Flow {
  id: string;
  name: string;
  /** Allowance for one cycle. */
  limitMinor: number;
}

export interface FlowState {
  flow: Flow;
  /** This cycle's fresh allowance. */
  allowanceMinor: number;
  /** Carried in from every previous cycle. Negative when previously overspent. */
  rolloverMinor: number;
  spentMinor: number;
  /** allowance + rollover − spent. What the person can actually spend. */
  availableMinor: number;
  /** Against allowance + rollover, so carried money counts. Uncapped. */
  pctUsed: number;
}

export interface FlowLedgerRow {
  cycle: Cycle;
  allowanceMinor: number;
  spentMinor: number;
  /** Running carry at the END of this cycle. */
  carriedMinor: number;
}

/**
 * Replay a flow cycle by cycle.
 *
 * `spentInCycle` is injected rather than taking transactions, so this stays
 * independent of the storage schema and trivial to test.
 */
export function flowLedger(
  flow: Flow,
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  spentInCycle: (c: Cycle) => number,
): FlowLedgerRow[] {
  const rows: FlowLedgerRow[] = [];
  let carried = 0;
  for (const cycle of cyclesBetween(budgetStart, now, s)) {
    const spent = spentInCycle(cycle);
    carried = carried + flow.limitMinor - spent;
    rows.push({ cycle, allowanceMinor: flow.limitMinor, spentMinor: spent, carriedMinor: carried });
  }
  return rows;
}

export function flowState(
  flow: Flow,
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  spentInCycle: (c: Cycle) => number,
): FlowState {
  const rows = flowLedger(flow, s, budgetStart, now, spentInCycle);
  const current = rows[rows.length - 1];
  const spentMinor = current ? current.spentMinor : 0;
  // Carry is everything BEFORE this cycle; the current row already nets this
  // cycle's own allowance and spend, which would double-count.
  const prior = rows[rows.length - 2];
  const rolloverMinor = prior ? prior.carriedMinor : 0;

  const allowanceMinor = flow.limitMinor;
  const availableMinor = allowanceMinor + rolloverMinor - spentMinor;
  const pool = allowanceMinor + rolloverMinor;
  return {
    flow, allowanceMinor, rolloverMinor, spentMinor, availableMinor,
    pctUsed: pool > 0 ? (spentMinor / pool) * 100 : 0,
  };
}

/** Spend for one flow inside one cycle, from raw rows. */
export function spentFor(
  categoryId: string,
  rows: ReadonlyArray<{ category_id: string | null; occurred_at: string; is_income: boolean;
                        deleted_at: string | null; amount_minor: number; base_minor?: number | null }>,
): (c: Cycle) => number {
  return (c) => rows.reduce((sum, t) => {
    if (t.deleted_at || t.is_income || t.category_id !== categoryId) return sum;
    if (!inCycle(t.occurred_at, c)) return sum;
    return sum + Math.abs(t.base_minor ?? t.amount_minor);
  }, 0);
}

/** Every flow's fresh allowance for one cycle — the day-to-day pot. */
export function totalAllowanceMinor(flows: readonly Flow[]): number {
  return flows.reduce((s, f) => s + f.limitMinor, 0);
}

/**
 * What is left across all flows, and what that is per remaining day.
 *
 * This is the number the home screen leads with. It divides by days left
 * INCLUDING today, so it never divides by zero and it self-corrects: spend £60
 * tonight and tomorrow's figure drops rather than the app waiting until the end
 * of the cycle to pass judgement.
 */
export function spendableToday(states: readonly FlowState[], cycle: Cycle): {
  availableMinor: number; perDayMinor: number;
} {
  const availableMinor = states.reduce((s, f) => s + f.availableMinor, 0);
  return {
    availableMinor,
    perDayMinor: cycle.daysLeft > 0 ? Math.floor(availableMinor / cycle.daysLeft) : availableMinor,
  };
}
