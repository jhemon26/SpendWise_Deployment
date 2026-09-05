/**
 * Pots — money that fills up rather than refills.
 *
 * A flow gives you a fresh allowance every cycle (groceries). A pot accumulates
 * until something empties it (rent). Bills, savings and one-off goals are the
 * same object with different rules for how fast they fill, which is why they
 * live in one engine instead of three unrelated features.
 *
 * HOW FAST A POT FILLS
 *
 * The obvious answer — smooth the annual cost across the year — is wrong, and
 * wrong in a way that hides for years. £650/month over 52.1786 weeks is £149.49
 * a week, but a real year has 52 paydays, not 52.18. That is £26.52 a year of
 * permanent under-funding, and the 53rd payday that would make it up turns up
 * roughly every six years. Simulated over 14 months the pot slides further
 * behind every single month and never recovers.
 *
 * So bills aim at the DUE DATE instead: each cycle sets aside what is still
 * needed divided by the number of cycles left before it falls due. That cannot
 * drift, because it never assumes anything about the year — it looks at the
 * next bill and counts the paydays between here and there. Behind, and next
 * cycle asks for more. Ahead, and it asks for less. It lands exactly on the
 * amount, every time.
 *
 * The weekly figure therefore varies — about £162.50 in a four-payday month and
 * £130 in a five-payday one. That variation is true rather than noise: it is
 * the difference between the months, and worth showing rather than smoothing
 * away.
 */

import {
  cycleFor, cyclesBetween, cyclesPerYear, shiftCycle, inCycle,
  type Cycle, type CycleSettings,
} from './cycle.js';

export type PotKind = 'bill' | 'saving' | 'goal';

export type Recurrence =
  | 'weekly' | 'fortnightly' | 'four_weekly'
  | 'monthly' | 'quarterly' | 'annual';

export interface Pot {
  id: string;
  name: string;
  kind: PotKind;
  /** A bill's amount each time it falls due, a saving's amount per recurrence, or a goal's total. */
  amountMinor: number;
  /** Bills and savings repeat. Goals do not. */
  recurrence?: Recurrence;
  /**
   * How many pay packets to split this bill across, 1–4.
   *
   * Capped by the paydays that actually exist in one bill period: a monthly
   * earner has one payday per monthly bill, so "4 installments" is impossible
   * and quietly becomes 1. Null means "as many as are available", up to 4.
   */
  installments?: number | null;
  /** A real date this fell (or falls) due. Later dates are stepped from here. */
  anchorDate?: string;
  /** Goals only: when the money is wanted by. Absent means "no deadline". */
  targetDate?: string;
}

export interface PotState {
  pot: Pot;
  /** Reserved right now: accrued automatically, minus payments out. */
  balanceMinor: number;
  /** What this cycle is asked to put in, given the balance at its start. */
  perCycleMinor: number;
  /** What the person has actually shifted into savings this cycle. */
  contributedMinor: number;
  /** Still to physically move this cycle. Drives the reminder, not the maths. */
  outstandingMinor: number;
  /** The next date money leaves, or null for an open-ended saving. */
  nextDue: Date | null;
  /** Still to find before nextDue. Zero once fully funded. */
  neededMinor: number;
  /** Cycles remaining to find it in, including the current one. */
  cyclesUntilDue: number;
  /**
   * How much of `balanceMinor` real money actually backs.
   *
   * The reservation accrues on schedule whether or not the cash exists, which
   * is right for the plan — it is what SHOULD have been put by, and the
   * funding maths depends on it. But screens were printing it as "£53.34 set
   * aside" on an account holding nothing, directly above their own warning
   * that £120.01 was short. Display this instead: it is the same money the
   * summary already caps at `min(potBalance, cash)`, split per pot.
   */
  backedMinor: number;
}

/*
 * There is deliberately no per-pot "shortfall" flag.
 *
 * The first draft had one, and a test proved it unreachable: with due-date
 * targeting the last remaining cycle is simply asked for the whole outstanding
 * amount, so on paper a pot always funds itself. The flag could never fire.
 *
 * The real question — can this person actually afford their commitments — is
 * not answerable one pot at a time. It is every pot's demand for this cycle
 * measured against the income for this cycle, and it belongs in the summary
 * layer. Asking it here would only ever produce a reassuring answer.
 */

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Clamped month arithmetic: 31 Jan + 1 month is 28 Feb, not 3 March. */
function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(day, last));
}

const STEP_DAYS: Partial<Record<Recurrence, number>> = {
  weekly: 7, fortnightly: 14, four_weekly: 28,
};
const STEP_MONTHS: Partial<Record<Recurrence, number>> = {
  monthly: 1, quarterly: 3, annual: 12,
};

/** Advance a due date by `n` recurrences. */
/**
 * How far ahead of the debit the money has to be there.
 *
 * A direct debit on the 18th is not something you fund on the 18th. The payer
 * takes it at their convenience during that day, banks post at their own pace,
 * and the wage that was meant to cover it may land the same morning or not at
 * all. Aiming exactly at the date meant the final contribution was asked for
 * in the cycle STARTING on the due date — after the money had already gone.
 *
 * Three days is the smallest margin that survives a weekend: a bill due Monday
 * is funded by the Friday before.
 */
export const READY_DAYS_BEFORE = 3;

/** The day a bill must be fully funded by, given the day it actually leaves. */
export function fundedBy(due: Date): Date {
  const d = new Date(due);
  d.setDate(d.getDate() - READY_DAYS_BEFORE);
  return d;
}

/** The most installments anyone can choose. Beyond this it is not a plan. */
export const MAX_INSTALLMENTS = 4;

/**
 * How many pay packets are available to fund one occurrence of a bill.
 *
 * Counted over ONE bill period ending at the ready date — not from today to
 * the due date. Those differ, and the difference matters: a monthly earner
 * first sees October's rent about six weeks out, so counting every payday
 * until then gives two and starts taking rent money a month early. One period
 * gives one payday, which is what "September's salary pays October's rent"
 * actually means.
 *
 * The same rule spreads a weekly earner's rent over the ~4 Fridays inside that
 * month, and a monthly earner's quarterly insurance over 3 monthly paydays. No
 * special-casing by pay frequency; the period does the work.
 */
export function paydaysForOne(pot: Pot, readyBy: Date, s: CycleSettings): number {
  if (!pot.recurrence) return 1;
  const windowStart = stepDue(readyBy, pot.recurrence, -1);
  /*
   * Paydays landing inside the window, counted by their start date.
   *
   * Not `cyclesUntil`, which counts the cycle containing each end — that
   * included the payday immediately BEFORE the window opened and turned a
   * monthly earner's single rent payday into two.
   */
  const inWindow = cyclesBetween(windowStart, readyBy, s)
    .filter((c) => c.start >= windowStart && c.start < readyBy);
  return Math.max(1, inWindow.length);
}

/** Paydays to actually use, honouring the choice but never inventing paydays. */
export function installmentsFor(pot: Pot, readyBy: Date, s: CycleSettings): number {
  const available = Math.min(paydaysForOne(pot, readyBy, s), MAX_INSTALLMENTS);
  const wanted = pot.installments ?? available;
  return Math.max(1, Math.min(wanted, available));
}

export function stepDue(from: Date, r: Recurrence, n = 1): Date {
  const days = STEP_DAYS[r];
  if (days) return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days * n);
  return addMonths(from, (STEP_MONTHS[r] ?? 1) * n);
}

/**
 * The first due date on or after `from`.
 *
 * Walks from the anchor in whichever direction is needed, so an anchor in the
 * past or the future both work. Capped so a corrupt anchor cannot spin.
 */
export function nextDueOn(pot: Pot, from: Date): Date | null {
  if (pot.kind === 'goal') return pot.targetDate ? midnight(new Date(pot.targetDate)) : null;
  if (!pot.recurrence || !pot.anchorDate) return null;

  const target = midnight(from);
  let d = midnight(new Date(pot.anchorDate));
  for (let i = 0; i < 800 && d < target; i++) d = stepDue(d, pot.recurrence);
  for (let i = 0; i < 800; i++) {
    const prev = stepDue(d, pot.recurrence, -1);
    if (prev < target) break;
    d = prev;
  }
  return d;
}

/** Cycles from `now`'s cycle up to and including the one containing `due`. */
function cyclesUntil(now: Date, due: Date, s: CycleSettings): number {
  if (due < midnight(now)) return 0;
  return cyclesBetween(now, due, s).length;
}

/**
 * Savings have no deadline, so exactness does not matter and a steady figure is
 * kinder than one that jitters. Annual smoothing is the right call here — the
 * failure it causes elsewhere only exists when there is a date to miss.
 */
function savingPerCycle(pot: Pot, s: CycleSettings): number {
  const perYear = pot.recurrence
    ? pot.amountMinor * (perYearOf(pot.recurrence))
    : pot.amountMinor * 12;
  return Math.ceil(perYear / cyclesPerYear(s));
}

const perYearOf = (r: Recurrence): number =>
  r === 'weekly' ? 52.1786 : r === 'fortnightly' ? 26.0893 : r === 'four_weekly' ? 13.0446
  : r === 'monthly' ? 12 : r === 'quarterly' ? 4 : 1;

/** Total a bill costs in a year, for reporting rather than for accrual. */
export function annualCostMinor(pot: Pot): number {
  if (pot.kind === 'goal' || !pot.recurrence) return 0;
  return Math.round(pot.amountMinor * perYearOf(pot.recurrence));
}

export interface PotLedgerRow {
  cycle: Cycle;
  /** What the app asked for this cycle, given the balance at the time. */
  recommendedMinor: number;
  /**
   * The date this cycle's contribution is aiming at.
   *
   * Not always the next occurrence: a bill falling inside the first cycle is
   * skipped, because it cannot be saved for. The card has to show THIS date,
   * or it reads "due tomorrow" beside a figure that is a fifth of the amount.
   */
  targetDue: Date | null;
  /** What was actually moved in. The user's decision, not ours. */
  contributedMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

/**
 * Replay a pot from the day budgeting started.
 *
 * Balance has to be simulated rather than summed, because with due-date
 * targeting each cycle's contribution depends on the balance at the time. It is
 * O(cycles) per pot — about 52 for a year of weekly — and derived entirely from
 * transactions, so nothing new is stored or synced.
 *
 * `paymentsInCycle` is injected so this stays free of the transaction schema
 * and is trivial to test.
 */
export function potLedger(
  pot: Pot,
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  paymentsInCycle: (c: Cycle) => number,
  openingMinor = 0,
  contributionsInCycle: (c: Cycle) => number = () => 0,
): PotLedgerRow[] {
  const rows: PotLedgerRow[] = [];
  let balance = openingMinor;

  const cycles = cyclesBetween(budgetStart, now, s);
  const firstEnd = cycles[0]?.end ?? budgetStart;

  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
    const cycle = cycles[cycleIndex]!;
    let due = nextDueOn(pot, cycle.start);

    /*
     * A bill falling due inside the very first cycle cannot be saved for.
     *
     * Signing up on the 29th with rent due on the 29th, the engine would ask
     * for the whole £450 out of one pay packet — arithmetically correct and
     * practically useless, and it cascaded into "your limits are £1,030 more
     * than is left" on a brand-new account. That money is already found or it
     * is not; the app cannot help retroactively.
     *
     * So it targets the NEXT occurrence and starts being useful from there.
     * Skipped only when nothing was put by: someone who told onboarding they
     * already have some of it clearly is saving for this one, and their answer
     * is not second-guessed.
     */
    if (due && openingMinor === 0 && pot.kind === 'bill' && pot.recurrence && due < firstEnd) {
      due = stepDue(due, pot.recurrence);
    }

    /*
     * `nextDueOn` guarantees `due >= cycle.start`, so `due <= cycle.start` here
     * only ever means they are EQUAL: the occurrence lands exactly when this
     * cycle starts. That is not a bill newly falling due — it needed to be
     * ready BEFORE this cycle began, so treating it as still-pending collapses
     * `cyclesUntil` to zero below and asks for the whole balance in one lump,
     * every cycle — the default for a monthly bill on a monthly pay cycle,
     * both anchored the same day, which is why monthly accounts never seemed
     * to smooth across paydays the way weekly ones do.
     *
     * Runs after the cold-start skip above: `stepDue` only moves forward, so
     * once that skip has already advanced a date past the first cycle, this
     * cannot fire a second time on top of it.
     *
     * Bills only — a goal's target date is one the person chose and must not
     * be silently advanced.
     */
    if (due && pot.kind !== 'goal' && pot.recurrence && due <= cycle.start) {
      due = stepDue(due, pot.recurrence);
    }
    let accrued: number;

    if (pot.kind === 'saving') {
      accrued = savingPerCycle(pot, s);
    } else {
      const need = Math.max(0, pot.amountMinor - balance);
      if (need === 0) {
        accrued = 0;
      } else if (!due) {
        /*
         * A goal with no deadline is a fixed cost without a date.
         *
         * It used to ask for nothing, on the grounds that no date implies no
         * rate — technically true, and it meant a £500 saving goal sat at zero
         * forever, absent from the set-aside list and from the fixed-cost
         * total, while the money it needed was quietly offered as spending
         * money. Nobody saves by being asked for nothing.
         *
         * So the installments choice supplies the rate the date would have:
         * £500 over four paydays is £125 each until it is met, then nothing.
         * The default matches a bill's, so it behaves like the commitment it
         * is without anyone having to configure it.
         */
        const over = Math.max(1, Math.min(pot.installments ?? MAX_INSTALLMENTS, MAX_INSTALLMENTS));
        /*
         * Counting DOWN, not dividing the remainder by a constant.
         *
         * Splitting what is left by four every cycle is Zeno's paradox: 4,500
         * then 3,375 then 2,532, forever approaching £180 and never arriving.
         * A dated bill converges because the cycles remaining shrink; with no
         * date, the installment count has to shrink instead.
         */
        const left = Math.max(1, over - cycleIndex);
        accrued = Math.ceil(need / left);
      } else {
        /*
         * Count the cycles up to the READY date, not the due date. The last
         * contribution then lands with days to spare instead of on the morning
         * the money leaves — see READY_DAYS_BEFORE.
         */
        /*
         * Bills only. A goal's target date is a date the person chose — "the
         * coat by 6 March" — and pulling it earlier would quietly change what
         * they asked for. A direct debit is not a choice, so it gets the
         * margin.
         */
        const readyBy = pot.kind === 'bill' ? fundedBy(due) : due;
        /*
         * Paydays left before the money is needed, but never more than this
         * bill is meant to be split across. `installmentsFor` caps the user's
         * choice at the paydays that exist in one bill period, so a monthly
         * earner asking for four gets one and a weekly earner gets four.
         */
        const remaining = cyclesUntil(cycle.start, readyBy, s);
        const planned = pot.kind === 'bill' ? installmentsFor(pot, readyBy, s) : remaining;
        const left = Math.min(remaining, Math.max(1, planned));
        // Past the due date with money still owed: catch up in one go rather
        // than dividing by zero and reporting a comfortable nothing.
        accrued = remaining > 0 ? Math.ceil(need / left) : need;
      }
    }

    /*
     * Reserved automatically; moving it is a separate, optional act.
     *
     * Requiring a transfer before the balance moved meant every pot sat at
     * zero, every bill read as unfunded, and the demand was deducted from
     * spending money again and again — the app was strictest with people who
     * had done nothing wrong. Nor is this "inventing savings": the money is
     * held back from the daily allowance the moment it is reserved, and the
     * summary compares the total reserved against cash actually held, so a
     * plan that reality cannot support is reported rather than believed.
     *
     * `contributed` is now only a record of what the person really shifted
     * into a savings account. It is tracked so the app can stop nagging, and
     * it deliberately does NOT move the balance — that would count the same
     * money twice.
     */
    const contributed = contributionsInCycle(cycle);
    balance += accrued;
    const paid = paymentsInCycle(cycle);
    /*
     * Paying a bill the pot had not finished funding empties it — it does not
     * put it into deficit. A real account showed "Rent: set aside -£215", which
     * means nothing to anyone, and the pot then believed it needed £715 next
     * month instead of £500.
     *
     * The shortfall came out of spending money at the time, which the flows
     * already record. Carrying it here as well would count it twice.
     */
    balance = Math.max(0, balance - paid);
    rows.push({ cycle, recommendedMinor: accrued, contributedMinor: contributed,
                paidMinor: paid, balanceMinor: balance, targetDue: due });
  }
  return rows;
}

/** Where a pot stands right now, and what this cycle is being asked for. */
export function potState(
  pot: Pot,
  s: CycleSettings,
  budgetStart: Date,
  now: Date,
  paymentsInCycle: (c: Cycle) => number,
  openingMinor = 0,
  contributionsInCycle: (c: Cycle) => number = () => 0,
): PotState {
  const rows = potLedger(pot, s, budgetStart, now, paymentsInCycle, openingMinor, contributionsInCycle);
  const last = rows[rows.length - 1];
  const balanceMinor = last ? last.balanceMinor : openingMinor;
  const perCycleMinor = last ? last.recommendedMinor : 0;
  const contributedMinor = last ? last.contributedMinor : 0;

  /* The date the ledger is actually aiming at, not merely the next
     occurrence — see targetDue. */
  const nextDue = last?.targetDue ?? nextDueOn(pot, now);
  const neededMinor = pot.kind === 'saving' ? 0 : Math.max(0, pot.amountMinor - balanceMinor);
  const cyclesUntilDue = nextDue ? cyclesUntil(now, nextDue, s) : 0;

  return {
    pot, balanceMinor, perCycleMinor, nextDue, neededMinor, cyclesUntilDue,
    /* Filled in by withBacking() once the cash total is known. */
    backedMinor: balanceMinor,
    contributedMinor,
    /* Still to set aside this cycle — what the UI asks for, and what the
       summary holds back from spending money. Never negative: putting in more
       than asked is allowed and simply lowers the next ask. */
    outstandingMinor: Math.max(0, perCycleMinor - contributedMinor),
  };
}

/** What every pot together asks of this cycle — the slice income loses first. */
export function totalPerCycleMinor(states: PotState[]): number {
  return states.reduce((sum, p) => sum + p.perCycleMinor, 0);
}

export { inCycle, cycleFor, shiftCycle };

/**
 * Split the cash actually held across the pots that claim it.
 *
 * Soonest due first: with less money than plans, the bill landing on the 15th
 * has the better claim on it than the one landing on the 20th. Undated goals
 * sort last — they are the ones that can wait, which is what makes them goals.
 *
 * The order is for allocation only; pots come back in the order they went in,
 * because that is the order the screens lay them out.
 */
export function withBacking(pots: readonly PotState[], cashMinor: number): PotState[] {
  let left = Math.max(0, cashMinor);
  const backed = new Map<string, number>();
  for (const p of [...pots].sort((a, b) =>
    (a.nextDue?.getTime() ?? Infinity) - (b.nextDue?.getTime() ?? Infinity))) {
    const take = Math.max(0, Math.min(p.balanceMinor, left));
    backed.set(p.pot.id, take);
    left -= take;
  }
  return pots.map((p) => ({ ...p, backedMinor: backed.get(p.pot.id) ?? 0 }));
}
