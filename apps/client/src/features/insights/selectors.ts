import type { Category, Transaction } from '@spendwise/shared-types';

/**
 * Every figure on every screen comes from here.
 *
 * These are the prototype's `derive()` computations, lifted out of the DOM
 * render loop into pure functions. In the prototype they were correct but
 * untestable and half the numbers on screen were static literals that never
 * moved when data changed; as pure functions they are neither.
 */

export interface MonthContext {
  /** Today, injectable so tests are not pinned to the wall clock. */
  now: Date;
  /** Monthly day-to-day budget in minor units. */
  dayToDayMinor: number;
  savingsTargetMinor: number;
  /**
   * Total of every SCHEDULED fixed cost this month — not what has been paid so
   * far. "To save" must not climb through the month as bills go out; the money
   * is committed the moment the month starts. Falls back to fixed spending when
   * no fixed costs are configured.
   */
  fixedCostsMinor?: number;
}

export interface Derived {
  daysInMonth: number;
  dayOfMonth: number;
  daysLeft: number;
  flexSpentMinor: number;
  fixedSpentMinor: number;
  incomeMinor: number;
  monthTotalMinor: number;
  leftMinor: number;
  perDayMinor: number;
  spentPct: number;
  datePct: number;
  expectedMinor: number;
  deltaMinor: number;
  evenPaceMinor: number;
  todaySpentMinor: number;
  byCategory: Map<string, number>;
  spendFreeDays: number;
  biggest: Transaction | null;
  avgDayMinor: number;
  fixedSharePct: number;
  projectedSavingsMinor: number;
  committedFixedMinor: number;
}

const inMonth = (iso: string, now: Date): boolean => {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

const sameDay = (iso: string, now: Date): boolean => {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

export function derive(
  transactions: Transaction[],
  categories: Category[],
  ctx: MonthContext,
): Derived {
  const { now, dayToDayMinor, savingsTargetMinor, fixedCostsMinor } = ctx;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysLeft = daysInMonth - dayOfMonth + 1; // today counts

  const live = transactions.filter((t) => !t.deleted_at);
  const monthTx = live.filter((t) => inMonth(t.occurred_at, now));
  const spendTx = monthTx.filter((t) => !t.is_income);

  const flexIds = new Set(categories.filter((c) => !c.is_fixed && !c.deleted_at).map((c) => c.local_id));

  const abs = (t: Transaction): number => Math.abs(t.base_minor ?? t.amount_minor);

  const flexSpentMinor = spendTx
    .filter((t) => t.category_id !== null && flexIds.has(t.category_id))
    .reduce((s, t) => s + abs(t), 0);
  const fixedSpentMinor = spendTx
    .filter((t) => t.category_id === null || !flexIds.has(t.category_id))
    .reduce((s, t) => s + abs(t), 0);
  const incomeMinor = monthTx.filter((t) => t.is_income).reduce((s, t) => s + abs(t), 0);
  const monthTotalMinor = flexSpentMinor + fixedSpentMinor;

  const leftMinor = dayToDayMinor - flexSpentMinor;
  const perDayMinor = daysLeft > 0 ? Math.round(leftMinor / daysLeft) : leftMinor;
  const spentPct = dayToDayMinor > 0 ? (flexSpentMinor / dayToDayMinor) * 100 : 0;
  const datePct = (dayOfMonth / daysInMonth) * 100;
  const expectedMinor = Math.round(dayToDayMinor * (dayOfMonth / daysInMonth));
  const deltaMinor = flexSpentMinor - expectedMinor;
  const evenPaceMinor = Math.round(dayToDayMinor / daysInMonth);

  const todaySpentMinor = spendTx
    .filter((t) => sameDay(t.occurred_at, now))
    .reduce((s, t) => s + abs(t), 0);

  const byCategory = new Map<string, number>();
  for (const t of spendTx) {
    if (!t.category_id) continue;
    byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + abs(t));
  }

  const spendDays = new Set(spendTx.map((t) => new Date(t.occurred_at).toDateString())).size;
  const spendFreeDays = Math.max(0, dayOfMonth - spendDays);

  const biggest =
    spendTx.slice().sort((a, b) => abs(b) - abs(a))[0] ?? null;
  const avgDayMinor = dayOfMonth > 0 ? Math.round(flexSpentMinor / dayOfMonth) : 0;
  const fixedSharePct = monthTotalMinor > 0 ? (fixedSpentMinor / monthTotalMinor) * 100 : 0;

  /**
   * What you keep if you hold the line: income, less every fixed cost, less
   * the day-to-day budget — or less what you have actually spent once you blow
   * past it. Stable while on budget, falls the moment you are not.
   */
  const committedFixedMinor = fixedCostsMinor ?? fixedSpentMinor;
  const projectedSavingsMinor =
    incomeMinor - committedFixedMinor - Math.max(dayToDayMinor, flexSpentMinor);

  void savingsTargetMinor;

  return {
    daysInMonth, dayOfMonth, daysLeft,
    flexSpentMinor, fixedSpentMinor, incomeMinor, monthTotalMinor,
    leftMinor, perDayMinor, spentPct, datePct, expectedMinor, deltaMinor, evenPaceMinor,
    todaySpentMinor, byCategory, spendFreeDays, biggest, avgDayMinor, fixedSharePct,
    projectedSavingsMinor, committedFixedMinor,
  };
}

/** One rule for state colour, used by every bar, ring and figure. */
export type Status = 'ok' | 'warn' | 'danger';

export function statusOf(pct: number): Status {
  if (pct > 100) return 'danger';
  if (pct >= 80) return 'warn';
  return 'ok';
}

export const STATUS_COLOUR: Record<Status, string> = {
  ok: 'var(--brand)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
};

/** Group transactions into day buckets, newest first, for the Activity list. */
export function groupByDay(
  transactions: Transaction[],
  now: Date,
): Array<{ label: string; items: Transaction[]; netMinor: number }> {
  const live = transactions.filter((t) => !t.deleted_at);
  const sorted = live.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const groups: Array<{ label: string; items: Transaction[]; netMinor: number }> = [];

  for (const t of sorted) {
    const label = dayLabel(t.occurred_at, now);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [], netMinor: 0 };
      groups.push(g);
    }
    g.items.push(t);
    g.netMinor += t.is_income ? Math.abs(t.amount_minor) : -Math.abs(t.amount_minor);
  }
  return groups;
}

export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const same = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function categoryBreakdown(
  d: Derived,
  categories: Category[],
): Array<{ category: Category; totalMinor: number; pct: number }> {
  const total = [...d.byCategory.values()].reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  return [...d.byCategory.entries()]
    .map(([id, totalMinor]) => ({
      category: categories.find((c) => c.local_id === id),
      totalMinor,
      pct: (totalMinor / total) * 100,
    }))
    .filter((x): x is { category: Category; totalMinor: number; pct: number } => Boolean(x.category))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

/* ── Fixed costs ───────────────────────────────────────────────────────── */

export interface Bill {
  category: Category;
  name: string;
  amountMinor: number;
  /** Null when no due day is set. The cost still counts; it just has no date. */
  dueDay: number | null;
  paid: boolean;
  /** Negative once the due day has passed. Null when there is no due day. */
  inDays: number | null;
}

/**
 * Fixed costs for the current month.
 *
 * "Paid" is not a stored flag — it is whether a transaction landed in that
 * category this month. Storing it would let the two disagree, and the
 * transaction is the fact.
 */
export function billsFor(
  categories: Category[],
  transactions: Transaction[],
  now: Date,
): Bill[] {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const paidIds = new Set(
    transactions
      .filter((t) => !t.deleted_at && !t.is_income && inMonth(t.occurred_at, now))
      .map((t) => t.category_id)
      .filter((id): id is string => id !== null),
  );

  return categories
    /*
     * Every fixed category, dated or not.
     *
     * This used to require a due day, which meant a fixed cost created without
     * one vanished from the totals entirely — the money was committed but the
     * budget figures never saw it. A missing date is missing detail, not a
     * reason for the cost to not exist.
     */
    .filter((c) => c.is_fixed && !c.deleted_at)
    .map((c) => {
      // A 31st falls back to the last day rather than spilling into next month.
      const dueDay = c.due_day === null ? null : Math.min(c.due_day, daysInMonth);
      return {
        category: c,
        name: c.name,
        amountMinor: c.limit_minor,
        dueDay,
        paid: paidIds.has(c.local_id),
        inDays: dueDay === null ? null : dueDay - dayOfMonth,
      };
    })
    // Dated first, in date order; undated after them, since they cannot be
    // placed on the calendar.
    .sort((a, b) => {
      if (a.dueDay === null) return b.dueDay === null ? 0 : 1;
      if (b.dueDay === null) return -1;
      return a.dueDay - b.dueDay;
    });
}

/** Still genuinely owed, soonest first — what the home screen warns about. */
export function upcomingBills(
  categories: Category[],
  transactions: Transaction[],
  now: Date,
  limit = 2,
): Bill[] {
  // "Coming up" is a calendar, so an undated cost has nothing to show there —
  // it still counts in the totals, it just cannot be scheduled.
  return billsFor(categories, transactions, now)
    .filter((b) => !b.paid && b.dueDay !== null)
    .slice(0, limit);
}

export const fixedCostsTotalMinor = (bills: Bill[]): number =>
  bills.reduce((s, b) => s + b.amountMinor, 0);

/* ── Month history ─────────────────────────────────────────────────────── */

export interface MonthPoint {
  label: string;
  totalMinor: number;
  current: boolean;
}

/**
 * Spending per month for the trailing window, oldest first.
 *
 * The prototype hardcoded five literals here, so the chart never moved when
 * the data did. These are summed from the transactions themselves, which means
 * an empty history renders honestly as empty bars rather than as a fiction.
 */
export function monthHistory(
  transactions: Transaction[],
  now: Date,
  months = 6,
): MonthPoint[] {
  const live = transactions.filter((t) => !t.deleted_at && !t.is_income);
  const out: MonthPoint[] = [];

  for (let back = months - 1; back >= 0; back--) {
    const m = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const totalMinor = live
      .filter((t) => {
        const d = new Date(t.occurred_at);
        return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
      })
      .reduce((s, t) => s + Math.abs(t.base_minor ?? t.amount_minor), 0);
    out.push({
      label: m.toLocaleDateString('en-GB', { month: 'short' }),
      totalMinor,
      current: back === 0,
    });
  }
  return out;
}

/** Average of the COMPLETED months only — this month is still accruing. */
export const historyAverageMinor = (points: MonthPoint[]): number => {
  const past = points.filter((p) => !p.current);
  if (past.length === 0) return 0;
  return Math.round(past.reduce((s, p) => s + p.totalMinor, 0) / past.length);
};
