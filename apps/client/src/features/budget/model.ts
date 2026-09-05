/**
 * The bridge from stored rows to the budget engines.
 *
 * The engines are deliberately ignorant of the storage schema — they take
 * plain shapes and injected lookups, which is what makes their maths testable
 * without a database. This is the one place that knows about Category,
 * Transaction and the settings blob, so the coupling lives in a single file.
 */

import { anchorFromDueDay, type Category, type Transaction } from '@spendwise/shared-types';
import { cycleFor, shiftCycle, inCycle, type Cycle, type CycleSettings } from './cycle.js';
import { potState, type Pot, type PotState, withBacking } from './pots.js';
import { flowState, type Flow, type FlowState } from './flows.js';
import { cashState, movementsFrom, type CashState } from './cash.js';
import { summarise, type CycleSummary } from './summary.js';

export interface BudgetSettings {
  cycleKind: 'days' | 'monthly';
  cycleLengthDays: number | null;
  cycleAnchorDate: string | null;
  cycleAnchorDay: number | null;
  expectedIncomeMinor: number;
  budgetStartDate: string | null;
  /** What the user held when budgeting started. The cash ledger opens here. */
  openingCashMinor: number;
}

export interface Budget {
  cycle: Cycle;
  /**
   * The cycle before this one, for like-for-like comparison.
   *
   * Exposed here rather than letting views rebuild CycleSettings from the store
   * — that duplication is how a screen ends up comparing against the wrong
   * period after a settings change.
   */
  prevCycle: Cycle;
  pots: PotState[];
  flows: FlowState[];
  /** Money actually held, replayed cycle by cycle from the opening figure. */
  cash: CashState;
  summary: CycleSummary;
}

/** Store settings → the shape the cycle engine wants. */
export function cycleSettingsOf(s: BudgetSettings): CycleSettings {
  if (s.cycleKind === 'days' && s.cycleLengthDays && s.cycleAnchorDate) {
    return { kind: 'days', lengthDays: s.cycleLengthDays, anchorDate: s.cycleAnchorDate };
  }
  // Falling back to monthly rather than trusting a half-written cycle: a
  // days-cycle with no anchor would make every boundary meaningless.
  return { kind: 'monthly', anchorDay: s.cycleAnchorDay ?? 1 };
}

const live = (c: Category): boolean => !c.deleted_at;
export const isPot = (c: Category): boolean => c.kind === 'pot' || c.is_fixed;

/**
 * A category as a pot.
 *
 * Falls back to a monthly bill for rows written before migration 008, so a
 * device holding stale local data still produces something sane rather than a
 * pot with no due date.
 */
export function potOf(c: Category, now: Date = new Date()): Pot {
  const kind = c.pot_kind ?? 'bill';
  const base = { id: c.local_id, name: c.name, amountMinor: c.limit_minor };
  if (kind === 'goal') {
    return { ...base, kind: 'goal', ...(c.target_date ? { targetDate: c.target_date } : {}) };
  }
  if (kind === 'saving') {
    return { ...base, kind: 'saving', recurrence: c.recurrence ?? 'monthly' };
  }
  return {
    ...base, kind: 'bill',
    recurrence: c.recurrence ?? 'monthly',
    /* Null means "as many paydays as fit"; the engine caps either way. */
    installments: c.installments ?? null,
    /*
     * Fall back to the day of the month the user actually gave.
     *
     * This used to fall back to TODAY, which threw the due day away: rent on
     * the 30th and insurance on the 18th both anchored on whatever date the
     * app happened to be opened, so every bill in an account came due on the
     * same day and the amounts set aside for each were wrong. It went unseen
     * because anchor_date is normally set at creation — except it was not,
     * since upsertCategory dropped it (see store.ts), so every existing bill
     * took this path.
     */
    anchorDate: c.anchor_date ?? anchorFromDueDay(c.due_day, now),
  };
}

export const flowOf = (c: Category): Flow => ({
  id: c.local_id, name: c.name, limitMinor: c.limit_minor,
});

const amount = (t: Transaction): number => Math.abs(t.base_minor ?? t.amount_minor);

/**
 * Money SPENT on one category inside a cycle.
 *
 * Transfers are excluded: moving £90 into the rent pot is not spending £90 on
 * rent. For a pot this is the bill actually being paid, which draws the pot
 * down; the transfer that filled it is counted separately below.
 */
const spentIn = (categoryId: string, txs: readonly Transaction[]) => (c: Cycle): number =>
  txs.reduce((sum, t) =>
    (!t.deleted_at && !t.is_income && !t.is_transfer && t.category_id === categoryId && inCycle(t.occurred_at, c))
      ? sum + amount(t) : sum, 0);

/**
 * Money deliberately SET ASIDE into one pot inside a cycle.
 *
 * The sign is kept, not stripped: positive puts money in, negative takes it
 * back out. A pot someone raids for an emergency has to be able to go down.
 */
const putAsideIn = (categoryId: string, txs: readonly Transaction[]) => (c: Cycle): number =>
  txs.reduce((sum, t) =>
    (!t.deleted_at && t.is_transfer && t.category_id === categoryId && inCycle(t.occurred_at, c))
      ? sum + (t.base_minor ?? t.amount_minor) : sum, 0);

/**
 * Where budgeting starts.
 *
 * The obvious fallback — the earliest transaction — is actively dangerous.
 * Accruals REPLAY from this date, so backdating it credits every pot with
 * money that was never set aside: someone with six months of history would be
 * told their rent is funded when there is nothing behind it. A budgeting app
 * inventing savings is the worst failure it has.
 *
 * So an unconfigured account starts at the beginning of the CURRENT cycle.
 * Balances open at zero, which is true, and the first cycle asks for the full
 * amount — the honest cold start, and the reason onboarding asks what is
 * already put by.
 */
export function budgetStartOf(s: BudgetSettings, cycle: Cycle): Date {
  return s.budgetStartDate ? new Date(`${s.budgetStartDate}T00:00:00`) : cycle.start;
}

export function buildBudget(
  settings: BudgetSettings,
  categories: readonly Category[],
  transactions: readonly Transaction[],
  now: Date,
): Budget {
  const cs = cycleSettingsOf(settings);
  const cycle = cycleFor(now, cs);
  const start = budgetStartOf(settings, cycle);

  const cats = categories.filter(live);
  const pots = cats.filter(isPot).map((c) =>
    potState(potOf(c, now), cs, start, now, spentIn(c.local_id, transactions), c.opening_minor ?? 0,
      putAsideIn(c.local_id, transactions)));
  const flows = cats.filter((c) => !isPot(c)).map((c) =>
    flowState(flowOf(c), cs, start, now, spentIn(c.local_id, transactions)));

  const actualIncomeMinor = transactions.reduce((sum, t) =>
    (!t.deleted_at && t.is_income && inCycle(t.occurred_at, cycle)) ? sum + amount(t) : sum, 0);

  /*
   * What is actually held, replayed from the figure the user gave at setup.
   * This is the number the whole screen should be bounded by: an expected wage
   * is a forecast, cash is a fact.
   */
  const cash = cashState(cs, start, now, settings.openingCashMinor ?? 0, movementsFrom(transactions));
  /*
   * Do we actually know what this person holds?
   *
   * Only if they told us, or if income has been recorded for us to add up.
   * Otherwise the ledger is spending subtracted from an assumed zero, which
   * reads as thousands of pounds of debt on an account that is perfectly fine.
   *
   * The test is whether an answer was GIVEN, not whether it was non-zero.
   * Reading `openingCashMinor !== 0` made "I have nothing" indistinguishable
   * from "I never said", and nothing is the one answer a person most needs
   * the app to believe: telling it you were skint turned the cash bound off
   * entirely, and it went back to forecasting from a wage that had not
   * arrived — £329.99 to spend, £82.49 a day, on an empty account.
   *
   * `budgetStartDate` is that record. It is the date the balance was measured,
   * so it is set together with the figure by both writers — onboarding and the
   * Profile editor — and stays null when the question is skipped.
   *
   * The non-zero figure stays in the test as well, for rows written before
   * that date was stored. It cannot reintroduce the bug: it only ever adds
   * accounts to the known set, and the case it used to get wrong is the one
   * the date now answers.
   */
  const cashKnown = settings.budgetStartDate !== null
    || (settings.openingCashMinor ?? 0) !== 0
    || transactions.some((t) => !t.deleted_at && t.is_income);
  const potBalanceMinor = pots.reduce((sum, p) => sum + p.balanceMinor, 0);
  /* Once cash is known, say how much of each reservation it actually backs. */
  const backedPots = withBacking(pots, cash.totalMinor);

  return {
    cycle, prevCycle: shiftCycle(cycle, -1, cs), pots: backedPots, flows, cash,
    summary: summarise({
      cycle, pots: backedPots, flows,
      expectedIncomeMinor: settings.expectedIncomeMinor,
      actualIncomeMinor,
      cashTotalMinor: cash.totalMinor,
      potBalanceMinor,
      cashKnown,
    }),
  };
}

/** The pot with the nearest due date — what the home screen's one slot shows. */
export function nextDuePot(pots: readonly PotState[]): PotState | null {
  return pots
    .filter((p) => p.nextDue !== null && p.pot.kind === 'bill')
    .sort((a, b) => a.nextDue!.getTime() - b.nextDue!.getTime())[0] ?? null;
}
