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
  const { now, dayToDayMinor, savingsTargetMinor } = ctx;

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
  const projectedSavingsMinor =
    incomeMinor - fixedSpentMinor - Math.max(dayToDayMinor, flexSpentMinor);

  void savingsTargetMinor;

  return {
    daysInMonth, dayOfMonth, daysLeft,
    flexSpentMinor, fixedSpentMinor, incomeMinor, monthTotalMinor,
    leftMinor, perDayMinor, spentPct, datePct, expectedMinor, deltaMinor, evenPaceMinor,
    todaySpentMinor, byCategory, spendFreeDays, biggest, avgDayMinor, fixedSharePct,
    projectedSavingsMinor,
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
