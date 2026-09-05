/**
 * Reporting, which runs on a different clock from budgeting.
 *
 * You budget by pay cycle; you report by whatever period you want to look at.
 * The two are allowed to differ, and conflating them is what made the old
 * screens divide a weekly earner's money by a calendar month.
 *
 * Everything here is a plain read over the transactions already in memory —
 * nothing is stored, nothing is precomputed, and any period can be asked for.
 */

import type { Category, Transaction } from '@spendwise/shared-types';

export interface Period {
  label: string;
  /** Inclusive. */
  start: Date;
  /** EXCLUSIVE, so adjacent periods cannot double-count a transaction. */
  end: Date;
}

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  colour: string | null;
  icon: string;
  nowMinor: number;
  prevMinor: number;
}

export interface Report {
  period: Period;
  previous: Period;
  incomeMinor: number;
  spentMinor: number;
  /** Income less spend. Positive is money kept. */
  netMinor: number;
  /** One bucket per day of the period, zero-filled so gaps are visible. */
  dailyMinor: number[];
  byCategory: CategorySpend[];
}

const midnight = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const amount = (t: Transaction): number => Math.abs(t.base_minor ?? t.amount_minor);
const within = (t: Transaction, p: Period): boolean => {
  const ms = new Date(t.occurred_at).getTime();
  return ms >= p.start.getTime() && ms < p.end.getTime();
};

/** The calendar month containing `now`. */
export function monthPeriod(now: Date): Period {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    start,
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function prevMonthPeriod(p: Period): Period {
  const start = new Date(p.start.getFullYear(), p.start.getMonth() - 1, 1);
  return {
    label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    start, end: p.start,
  };
}

/** A period from an arbitrary window — used for the current pay cycle. */
export function windowPeriod(start: Date, end: Date, label: string): Period {
  return { label, start: midnight(start), end: midnight(end) };
}

export function report(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  period: Period,
  previous: Period,
): Report {
  const live = transactions.filter((t) => !t.deleted_at);
  const inNow = live.filter((t) => within(t, period));

  const incomeMinor = inNow.filter((t) => t.is_income).reduce((s, t) => s + amount(t), 0);
  /* Transfers move money between the user's own pockets; they are not spend. */
  const spentMinor = inNow.filter((t) => !t.is_income && !t.is_transfer).reduce((s, t) => s + amount(t), 0);

  const days = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / 86_400_000));
  // Zero-filled: a day with no spending is information, and a sparse array
  // would silently shift every later bar left.
  const dailyMinor = new Array<number>(days).fill(0);
  for (const t of inNow) {
    if (t.is_income || t.is_transfer) continue;
    const i = Math.floor((midnight(new Date(t.occurred_at)).getTime() - period.start.getTime()) / 86_400_000);
    if (i >= 0 && i < days) dailyMinor[i] = (dailyMinor[i] ?? 0) + amount(t);
  }

  const totalFor = (p: Period, categoryId: string | null): number =>
    live.reduce((s, t) =>
      (!t.is_income && !t.is_transfer && t.category_id === categoryId && within(t, p)) ? s + amount(t) : s, 0);

  const ids = new Set<string | null>(
    inNow.filter((t) => !t.is_income && !t.is_transfer).map((t) => t.category_id),
  );
  const byCategory: CategorySpend[] = [...ids].map((categoryId) => {
    const c = categoryId ? categories.find((x) => x.local_id === categoryId) : undefined;
    return {
      categoryId,
      // Uncategorised spend gets a name rather than being dropped. It was
      // previously folded into a residual bucket and never shown, which is how
      // money goes missing from a breakdown that claims to be complete.
      name: c?.name ?? 'Uncategorised',
      colour: c?.colour ?? null,
      icon: c?.icon ?? 'other',
      nowMinor: totalFor(period, categoryId),
      prevMinor: totalFor(previous, categoryId),
    };
  }).sort((a, b) => b.nowMinor - a.nowMinor);

  return {
    period, previous, incomeMinor, spentMinor,
    netMinor: incomeMinor - spentMinor,
    dailyMinor, byCategory,
  };
}
