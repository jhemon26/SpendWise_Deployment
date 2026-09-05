/**
 * One cycle, end to end.
 *
 * The pot layer deliberately has no "can I afford this" flag — a single pot can
 * always fund itself on paper, because the last remaining cycle is simply asked
 * for whatever is outstanding. Affordability is only meaningful once every
 * pot's demand is weighed against the income for the same cycle, which is what
 * happens here.
 *
 * FUNDING ORDER, AND WHY
 *
 * When income comes in short — a quiet week, fewer shifts — something has to
 * give, and the order is not arbitrary:
 *
 *   1. Bills.    A missed direct debit costs a fee, a mark on a credit file,
 *                sometimes a service. It cannot be the thing that flexes.
 *   2. Savings.  Skipping a month is a setback, not a consequence.
 *   3. Spending. Absorbs the rest, because it is the only part the person can
 *                actually decide about between now and the next payday.
 *
 * Stated the other way round: a shortfall eats spending money first, then
 * savings, and only reaches the bills when there is nothing else left — at
 * which point the app has to say so plainly rather than quietly under-funding.
 */

import type { Cycle } from './cycle.js';
import type { PotState } from './pots.js';
import type { FlowState } from './flows.js';

export interface CycleSummary {
  cycle: Cycle;

  /** What the person said they expect each cycle. */
  expectedIncomeMinor: number;
  /** What actually landed, from income transactions in this cycle. */
  actualIncomeMinor: number;
  /** Negative when this cycle came in light. */
  incomeVarianceMinor: number;
  /**
   * The figure everything is funded from. Actual income once any has arrived,
   * otherwise the expectation — otherwise the screen would show a cliff every
   * cycle until payday and then jump.
   */
  workingIncomeMinor: number;

  billDemandMinor: number;
  saveDemandMinor: number;
  /** Everything held right now, earmarked or not. */
  cashTotalMinor: number;
  /** Of that, sitting in pots — the plan, which may exceed what is held. */
  potBalanceMinor: number;
  /** The plan capped at money that exists. Never more than cashTotalMinor. */
  reservedMinor: number;
  /** Held minus earmarked: the ceiling on anything the app offers. */
  freeCashMinor: number;
  /** False until the user tells us what they hold, or logs some income. */
  cashKnown: boolean;
  /**
   * How far the money in hand falls short of what the bills need this cycle.
   *
   * Distinct from overspending, and the two must never be worded the same way.
   * Someone who has spent £30 of a £430 budget but holds £153 against £159 of
   * bill contributions is not overspent — they are early in the cycle and the
   * wages have not landed. Telling them they are "over your week" is simply
   * false, and it is the most alarming thing the screen can say.
   */
  cashShortfallMinor: number;
  /** Bills + savings + goals: everything set aside before spending money. */
  potDemandMinor: number;

  /** Left after every pot is funded. Never negative. */
  spendableMinor: number;
  /** Bills that income could not cover. Non-zero means a payment will fail. */
  billsUnfundedMinor: number;
  /** Savings skipped to protect the bills. */
  saveUnfundedMinor: number;

  /** What the flow limits add up to — what the person planned to spend. */
  flowAllowanceMinor: number;
  flowRolloverMinor: number;
  flowSpentMinor: number;
  /** allowance + rollover − spent. What is actually left to spend. */
  availableMinor: number;
  perDayMinor: number;

  /**
   * The plan does not add up: the day-to-day limits are larger than what is
   * left once commitments are funded. Not a warning about this week — a
   * statement that the budget as configured cannot hold.
   */
  overcommittedMinor: number;
}

export interface SummaryInput {
  cycle: Cycle;
  pots: readonly PotState[];
  flows: readonly FlowState[];
  expectedIncomeMinor: number;
  actualIncomeMinor: number;
  /** Everything held right now, earmarked or not. */
  cashTotalMinor: number;
  /** Of that, how much is already sitting in pots. */
  potBalanceMinor: number;
  /**
   * Whether the cash figure means anything yet.
   *
   * An account that never gave an opening balance and has never logged income
   * has a cash total of zero-minus-spending — which looks like deep debt and
   * is really just ignorance. Same rule as `incomeKnown` below: not knowing is
   * not the same as knowing it is nothing, and silence beats a false alarm.
   */
  cashKnown: boolean;
}

export function summarise(i: SummaryInput): CycleSummary {
  /*
   * This cycle's reservation, whether or not it has physically moved.
   *
   * Reserving is automatic now, so the figure to hold back from spending is
   * the full amount — not "what is still to be moved". Using the latter meant
   * that confirming a transfer made the app think the bill no longer needed
   * funding this cycle, and handed the money straight back as spendable.
   */
  const demandOf = (kind: PotState['pot']['kind']): number =>
    i.pots.filter((p) => p.pot.kind === kind).reduce((s, p) => s + p.perCycleMinor, 0);

  const billDemandMinor = demandOf('bill');
  // Goals sit with savings: both are money the person chose to put by, and both
  // yield before a bill does.
  const saveDemandMinor = demandOf('saving') + demandOf('goal');
  const potDemandMinor = billDemandMinor + saveDemandMinor;

  // Before the first payday of a cycle nothing has landed yet. Falling back to
  // the expectation keeps the screen steady instead of showing a cliff that
  // vanishes the moment wages arrive.
  const workingIncomeMinor = i.actualIncomeMinor > 0 ? i.actualIncomeMinor : i.expectedIncomeMinor;
  /*
   * With no income figure at all we know nothing about affordability, and
   * every derived warning would be a false alarm: zero income makes the bills
   * "unfunded" and every limit "overcommitted". An account that has not told
   * us what it earns gets silence, not alarm.
   */
  const incomeKnown = workingIncomeMinor > 0;

  const afterBills = workingIncomeMinor - billDemandMinor;
  const billsUnfundedMinor = Math.max(0, -afterBills);
  const afterSaving = Math.max(0, afterBills) - saveDemandMinor;
  const saveUnfundedMinor = Math.min(saveDemandMinor, Math.max(0, -afterSaving));
  const spendableMinor = Math.max(0, afterSaving);

  const flowAllowanceMinor = i.flows.reduce((s, f) => s + f.allowanceMinor, 0);
  const flowRolloverMinor = i.flows.reduce((s, f) => s + f.rolloverMinor, 0);
  const flowSpentMinor = i.flows.reduce((s, f) => s + f.spentMinor, 0);

  /*
   * The headline must be bounded by money that actually exists.
   *
   * The limits are how you INTEND to divide your spending money; spendable is
   * how much there is. Leading with the limits produced a screen that offered
   * "£171.66 a day" directly above "your limits are £1,030 more than is left" —
   * two numbers from unrelated sums, one of them a promise the app could not
   * keep. Reality wins, and the overcommitted figure explains the gap.
   *
   * With no income on file we know nothing about what exists, so the limits are
   * the only figure available and the warnings stay silent anyway.
   */
  /*
   * Free cash: what you hold, less what is already earmarked in pots.
   *
   * This is the honest ceiling. `spendableMinor` above is derived from a wage
   * — expected until one is logged — which is a forecast, and a forecast made
   * the app plan a mid-cycle joiner around £500 they had already spent. Cash
   * is a fact, so the smaller of the two wins.
   */
  /*
   * Reserve what is there, never more.
   *
   * The pots plan their reservations from the bills alone; they do not know
   * what is in the account. Subtracting the whole plan from a smaller balance
   * produced a negative "free cash" and, through it, a negative daily
   * allowance — the single thing that made this screen unreadable. So the
   * reservation is capped at the money that actually exists, free cash floors
   * at zero, and the part of the plan the balance cannot back is reported as
   * a shortfall instead of being silently subtracted.
   */
  const heldMinor = Math.max(0, i.cashTotalMinor);
  const reservedMinor = Math.min(i.potBalanceMinor, heldMinor);
  const freeCashMinor = heldMinor - reservedMinor;
  const unbackedMinor = Math.max(0, i.potBalanceMinor - heldMinor);

  const poolMinor = incomeKnown ? Math.min(flowAllowanceMinor, spendableMinor) : flowAllowanceMinor;
  /*
   * Held back: money still to be set aside this cycle cannot also be spent.
   * Without this the same pound is offered twice — once as spending money and
   * again as the rent contribution.
   */
  const budgetedAvailableMinor = poolMinor + flowRolloverMinor - flowSpentMinor;
  /*
   * No second subtraction.
   *
   * `freeCashMinor` is cash minus what the pots already hold, and the pots now
   * accrue this cycle's reservation automatically — so it is already inside
   * that figure. Taking `potDemandMinor` off as well charged the same bill
   * twice and drove the daily allowance negative on accounts that were fine.
   */
  const availableMinor = i.cashKnown
    ? Math.min(budgetedAvailableMinor, freeCashMinor)
    : budgetedAvailableMinor;

  return {
    cycle: i.cycle,
    expectedIncomeMinor: i.expectedIncomeMinor,
    actualIncomeMinor: i.actualIncomeMinor,
    incomeVarianceMinor: i.actualIncomeMinor - i.expectedIncomeMinor,
    workingIncomeMinor,
    billDemandMinor, saveDemandMinor, potDemandMinor,
    spendableMinor,
    billsUnfundedMinor: incomeKnown ? billsUnfundedMinor : 0,
    saveUnfundedMinor: incomeKnown ? saveUnfundedMinor : 0,
    flowAllowanceMinor, flowRolloverMinor, flowSpentMinor, availableMinor,
    cashTotalMinor: i.cashTotalMinor,
    potBalanceMinor: i.potBalanceMinor,
    reservedMinor,
    freeCashMinor,
    cashKnown: i.cashKnown,
    /* How much of the reservation plan the balance cannot back. */
    cashShortfallMinor: i.cashKnown ? unbackedMinor : 0,
    // Floor, never round: the daily figure is a promise, and rounding up
    // promises a penny that is not there on the last day of the cycle.
    perDayMinor: i.cycle.daysLeft > 0
      ? Math.floor(availableMinor / i.cycle.daysLeft)
      : availableMinor,
    overcommittedMinor: incomeKnown ? Math.max(0, flowAllowanceMinor - spendableMinor) : 0,
  };
}
