/**
 * The spending clock.
 *
 * The app used to assume one period — the calendar month — and welded it into
 * the arithmetic: pace was `budget × dayOfMonth / daysInMonth`, which asserts
 * that money arrives evenly across the month. That is roughly true if you are
 * paid monthly and false every single day if you are paid weekly.
 *
 * A cycle is whatever period your money actually arrives on. Everything about
 * spending is scoped to it. Commitments stay on the calendar, because rent does
 * not care what day you are paid — the two clocks are bridged by accrual, not
 * by pretending they are the same clock.
 *
 * Deliberately pure and date-only: no clock reads, no timezone maths beyond the
 * local calendar day. Callers pass `now` so every screen and every test can
 * choose its own present.
 */

/** Days-based cycles cover weekly, fortnightly and four-weekly pay. */
export type CycleKind = 'days' | 'monthly';

export interface CycleSettings {
  kind: CycleKind;
  /** 7, 14 or 28. Ignored when kind is 'monthly'. */
  lengthDays?: number;
  /**
   * Any date the user was paid. Cycle boundaries are counted from here in both
   * directions, so it does not need to be the first one — just a real one.
   * Ignored when kind is 'monthly'.
   */
  anchorDate?: string;
  /**
   * Day of month the cycle turns over, 1-31. Clamped in short months, so 31
   * means "the last day" in February rather than rolling into March.
   */
  anchorDay?: number;
}

export interface Cycle {
  /** Stable integer, increasing with time. Negative before the anchor. */
  index: number;
  /** Inclusive local-midnight start. */
  start: Date;
  /** EXCLUSIVE end — the first instant of the next cycle. */
  end: Date;
  daysTotal: number;
  /** Days already gone, including today. 1 on the first day. */
  daysElapsed: number;
  /** Days left including today, so it is never 0 while the cycle is current. */
  daysLeft: number;
}

/** Local midnight, so cycle edges land on day boundaries the user recognises. */
const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const DAY_MS = 86_400_000;

/** Whole days between two local midnights, DST-safe via rounding. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((midnight(b).getTime() - midnight(a).getTime()) / DAY_MS);
}

/**
 * A monthly cycle anchored on day 31 must mean "month end", not "roll into the
 * next month". Clamping keeps February valid without inventing a date.
 */
function monthlyStart(year: number, month: number, anchorDay: number): Date {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(anchorDay, last));
}

/**
 * How many cycles fall in a year.
 *
 * 365.25 / 7 = 52.1786, not 52. A year is not 52 weeks, and accruing on 52
 * under-funds every bill by roughly a third of a percent a year — small until
 * it is the difference between covering the rent and not.
 */
/**
 * The local calendar day, as the person living in it would write it.
 *
 * toISOString() converts to UTC first, so anywhere east of Greenwich a local
 * midnight lands on the previous date: a cycle starting Fri 28 Aug in BST
 * comes back "2026-08-27". Feed that to a payday count and six months in
 * every twenty-four report the wrong number of paydays.
 */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export function cyclesPerYear(s: CycleSettings): number {
  if (s.kind === 'monthly') return 12;
  return 365.25 / (s.lengthDays ?? 7);
}

/**
 * What one cycle must set aside to cover an annual commitment.
 *
 * Rounded up to the penny: under-accruing leaves a shortfall on the due date,
 * which is the failure mode that matters. A penny a cycle of slack does not.
 */
export function accrualPerCycle(annualMinor: number, s: CycleSettings): number {
  if (annualMinor <= 0) return 0;
  return Math.ceil(annualMinor / cyclesPerYear(s));
}

/** The cycle containing `now`. */
export function cycleFor(now: Date, s: CycleSettings): Cycle {
  const today = midnight(now);

  if (s.kind === 'monthly') {
    const day = Math.min(Math.max(s.anchorDay ?? 1, 1), 31);
    // Before this month's turnover date, we are still in last month's cycle.
    const thisMonth = monthlyStart(today.getFullYear(), today.getMonth(), day);
    const start = today < thisMonth
      ? monthlyStart(today.getFullYear(), today.getMonth() - 1, day)
      : thisMonth;
    const end = monthlyStart(start.getFullYear(), start.getMonth() + 1, day);
    const daysTotal = daysBetween(start, end);
    const daysElapsed = daysBetween(start, today) + 1;
    return {
      index: start.getFullYear() * 12 + start.getMonth(),
      start, end, daysTotal, daysElapsed,
      daysLeft: daysTotal - daysElapsed + 1,
    };
  }

  const len = Math.max(1, s.lengthDays ?? 7);
  const anchor = midnight(s.anchorDate ? new Date(s.anchorDate) : today);
  // Floor, not truncate: dates before the anchor must land in negative cycles
  // rather than all collapsing into index 0.
  const index = Math.floor(daysBetween(anchor, today) / len);
  const start = addDays(anchor, index * len);
  const end = addDays(start, len);
  const daysElapsed = daysBetween(start, today) + 1;
  return { index, start, end, daysTotal: len, daysElapsed, daysLeft: len - daysElapsed + 1 };
}

/** Shift a cycle by whole cycles. `at(c, -1)` is the one before it. */
export function shiftCycle(c: Cycle, by: number, s: CycleSettings): Cycle {
  if (by === 0) return c;
  const probe = s.kind === 'monthly'
    ? monthlyStart(c.start.getFullYear(), c.start.getMonth() + by, s.anchorDay ?? 1)
    : addDays(c.start, by * c.daysTotal);
  return cycleFor(probe, s);
}

/**
 * Every cycle from the one containing `from` up to the one containing `to`.
 *
 * Used to walk history for rollover and pot balances. Capped so a corrupt
 * anchor date cannot spin forever.
 */
export function cyclesBetween(from: Date, to: Date, s: CycleSettings, cap = 600): Cycle[] {
  const out: Cycle[] = [];
  let c = cycleFor(from, s);
  const last = cycleFor(to, s);
  while (c.start <= last.start && out.length < cap) {
    out.push(c);
    c = shiftCycle(c, 1, s);
  }
  return out;
}

/** Does an ISO timestamp fall inside this cycle? End is exclusive. */
export function inCycle(iso: string, c: Cycle): boolean {
  const t = new Date(iso).getTime();
  return t >= c.start.getTime() && t < c.end.getTime();
}
