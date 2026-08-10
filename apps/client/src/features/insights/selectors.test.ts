import { describe, it, expect } from 'vitest';
import type { Category, Transaction } from '@spendwise/shared-types';
import {
  derive, statusOf, groupByDay, dayLabel, categoryBreakdown,
  billsFor, upcomingBills, fixedCostsTotalMinor, monthHistory, historyAverageMinor,
} from './selectors.js';
import { arcFor, paintedLength, GAUGE_C } from '../../design-system/gauge-math.js';

const NOW = new Date('2026-08-07T12:00:00Z');

let n = 0;
const id = (): string => `0199${(++n).toString(16).padStart(4, '0')}-0000-7000-8000-000000000000`;

function cat(over: Partial<Category> = {}): Category {
  return {
    local_id: id(), server_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    deleted_at: null, sync_status: 'synced', version: 1, device_id: 'd',
    name: 'Groceries', icon: 'groceries', colour: '#14B8A6', limit_minor: 32000,
    is_fixed: false, due_day: null, ...over,
  };
}

function tx(over: Partial<Transaction> = {}): Transaction {
  const t = NOW.toISOString();
  return {
    local_id: id(), server_id: null, created_at: t, updated_at: t, deleted_at: null,
    sync_status: 'synced', version: 1, device_id: 'd',
    category_id: null, bank_id: null,
    amount_minor: -1000, currency: 'GBP', base_minor: -1000, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: '2026-08-07', fx_provisional: false,
    merchant: 'Shop', note: null, occurred_at: t, is_income: false, pending: false, ...over,
  };
}

const ctx = { now: NOW, dayToDayMinor: 82000, savingsTargetMinor: 40800 };

describe('derive — calendar', () => {
  it('counts August correctly, today included', () => {
    const d = derive([], [], ctx);
    expect(d.daysInMonth).toBe(31);
    expect(d.dayOfMonth).toBe(7);
    expect(d.daysLeft).toBe(25);
  });
});

describe('derive — spending', () => {
  it('separates flexible from fixed by category', () => {
    const flex = cat({ is_fixed: false });
    const fixed = cat({ name: 'Rent', is_fixed: true });
    const d = derive(
      [tx({ category_id: flex.local_id, amount_minor: -1500, base_minor: -1500 }),
       tx({ category_id: fixed.local_id, amount_minor: -90000, base_minor: -90000 })],
      [flex, fixed],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1500);
    expect(d.fixedSpentMinor).toBe(90000);
    expect(d.monthTotalMinor).toBe(91500);
  });

  it('ignores tombstoned transactions', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -1500, base_minor: -1500 }),
       tx({ category_id: c.local_id, amount_minor: -9999, base_minor: -9999, deleted_at: NOW.toISOString() })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1500);
  });

  it('ignores transactions from other months', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, occurred_at: '2026-07-20T10:00:00Z' })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(0);
  });

  it('uses the base amount for foreign currency, not the raw amount', () => {
    // A €14 lunch must count as its GBP value against a GBP budget.
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -1400, currency: 'EUR', base_minor: -1190 })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1190);
  });

  it('computes pace against the calendar', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -20329, base_minor: -20329 })],
      [c],
      ctx,
    );
    expect(d.leftMinor).toBe(82000 - 20329);
    expect(Math.round(d.spentPct)).toBe(25);
    expect(d.expectedMinor).toBe(Math.round(82000 * (7 / 31)));
    expect(d.deltaMinor).toBe(20329 - d.expectedMinor);
  });

  it('goes negative when over budget rather than clamping', () => {
    const c = cat();
    const d = derive([tx({ category_id: c.local_id, amount_minor: -90000, base_minor: -90000 })], [c], ctx);
    expect(d.leftMinor).toBeLessThan(0);
    expect(d.spentPct).toBeGreaterThan(100);
  });

  it('counts only today for the today tile', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -2400, base_minor: -2400 }),
       tx({ category_id: c.local_id, amount_minor: -5000, base_minor: -5000, occurred_at: '2026-08-05T10:00:00Z' })],
      [c],
      ctx,
    );
    expect(d.todaySpentMinor).toBe(2400);
  });

  it('projects savings as income less fixed less the budget', () => {
    const flex = cat();
    const fixed = cat({ is_fixed: true });
    const d = derive(
      [tx({ is_income: true, amount_minor: 244500, base_minor: 244500 }),
       tx({ category_id: fixed.local_id, amount_minor: -121700, base_minor: -121700 })],
      [flex, fixed],
      ctx,
    );
    // 244500 - 121700 - 82000 = 40800
    expect(d.projectedSavingsMinor).toBe(40800);
  });
});

describe('statusOf', () => {
  it('maps percentage to state', () => {
    expect(statusOf(0)).toBe('ok');
    expect(statusOf(79)).toBe('ok');
    expect(statusOf(80)).toBe('warn');
    expect(statusOf(100)).toBe('warn');
    expect(statusOf(101)).toBe('danger');
  });
});

describe('groupByDay', () => {
  it('buckets by day, newest first, with a net total', () => {
    const g = groupByDay(
      [tx({ occurred_at: '2026-08-07T09:00:00Z', amount_minor: -1000 }),
       tx({ occurred_at: '2026-08-07T18:00:00Z', amount_minor: -500 }),
       tx({ occurred_at: '2026-08-06T10:00:00Z', amount_minor: -300 })],
      NOW,
    );
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday']);
    expect(g[0]!.netMinor).toBe(-1500);
    expect(g[1]!.items).toHaveLength(1);
  });

  it('labels relative days', () => {
    expect(dayLabel('2026-08-07T09:00:00Z', NOW)).toBe('Today');
    expect(dayLabel('2026-08-06T09:00:00Z', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-08-01T09:00:00Z', NOW)).toMatch(/Aug/);
  });
});

describe('categoryBreakdown', () => {
  it('shares sum to 100 and sort largest first', () => {
    const a = cat({ name: 'Rent' });
    const b = cat({ name: 'Food' });
    const d = derive(
      [tx({ category_id: a.local_id, amount_minor: -7500, base_minor: -7500 }),
       tx({ category_id: b.local_id, amount_minor: -2500, base_minor: -2500 })],
      [a, b],
      ctx,
    );
    const rows = categoryBreakdown(d, [a, b]);
    expect(rows.map((r) => r.category.name)).toEqual(['Rent', 'Food']);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 6);
  });

  it('is empty with no spending, rather than dividing by zero', () => {
    expect(categoryBreakdown(derive([], [], ctx), [])).toEqual([]);
  });
});

describe('gauge geometry — the original bug', () => {
  it('paints exactly the percentage at every value', () => {
    for (const pct of [0, 1, 3, 5, 10, 25, 28.86, 50, 75, 99, 100]) {
      const intended = GAUGE_C * Math.min(pct, 100) / 100;
      expect(paintedLength(arcFor(pct))).toBeCloseTo(intended, 6);
    }
  });

  it('paints nothing at zero — no stray dot', () => {
    expect(paintedLength(arcFor(0))).toBe(0);
  });

  it('uses butt caps below one stroke width, where two round caps will not fit', () => {
    expect(arcFor(1).linecap).toBe('butt');
    expect(arcFor(50).linecap).toBe('round');
  });

  it('clamps above 100 rather than overdrawing', () => {
    expect(paintedLength(arcFor(150))).toBeCloseTo(GAUGE_C, 6);
  });
});

describe('billsFor', () => {
  const rent = cat({ name: 'Rent', is_fixed: true, due_day: 1, limit_minor: 90000 });
  const gym = cat({ name: 'Gym', is_fixed: true, due_day: 10, limit_minor: 3000 });
  const food = cat({ name: 'Groceries', is_fixed: false, limit_minor: 32000 });

  it('lists every fixed category, with or without a due day', () => {
    // This test previously asserted the opposite and so locked in a bug: an
    // undated fixed cost was dropped from billsFor, which meant it never
    // reached the budget totals either.
    const withoutDay = cat({ name: 'Misc fixed', is_fixed: true, due_day: null });
    const out = billsFor([rent, gym, food, withoutDay], [], NOW);
    expect(out.map((b) => b.name)).toEqual(['Rent', 'Gym', 'Misc fixed']);
  });

  it('excludes day-to-day categories', () => {
    expect(billsFor([rent, food], [], NOW).map((b) => b.name)).toEqual(['Rent']);
  });

  it('orders by due day, soonest first', () => {
    expect(billsFor([gym, rent], [], NOW).map((b) => b.dueDay)).toEqual([1, 10]);
  });

  it('marks a bill paid from the transaction, not a stored flag', () => {
    // The transaction IS the fact. A separate boolean could disagree with it.
    const paidRent = tx({ category_id: rent.local_id, amount_minor: -90000 });
    const out = billsFor([rent, gym], [paidRent], NOW);
    expect(out.find((b) => b.name === 'Rent')!.paid).toBe(true);
    expect(out.find((b) => b.name === 'Gym')!.paid).toBe(false);
  });

  it('does not count income as paying a bill', () => {
    const refund = tx({ category_id: rent.local_id, amount_minor: 90000, is_income: true });
    expect(billsFor([rent], [refund], NOW)[0]!.paid).toBe(false);
  });

  it('ignores a payment from a different month', () => {
    const lastMonth = tx({ category_id: rent.local_id, occurred_at: '2026-07-02T09:00:00.000Z' });
    expect(billsFor([rent], [lastMonth], NOW)[0]!.paid).toBe(false);
  });

  it('clamps a 31st to the last day of a short month', () => {
    // February has no 31st; the bill must not silently move into March.
    const feb = new Date('2026-02-10T12:00:00Z');
    const late = cat({ is_fixed: true, due_day: 31 });
    expect(billsFor([late], [], feb)[0]!.dueDay).toBe(28);
  });

  it('reports days remaining, negative once overdue', () => {
    // NOW is the 7th.
    const out = billsFor([rent, gym], [], NOW);
    expect(out.find((b) => b.name === 'Gym')!.inDays).toBe(3);
    expect(out.find((b) => b.name === 'Rent')!.inDays).toBe(-6);
  });

  it('upcomingBills drops what is already paid', () => {
    const paidRent = tx({ category_id: rent.local_id });
    expect(upcomingBills([rent, gym], [paidRent], NOW).map((b) => b.name)).toEqual(['Gym']);
  });

  it('totals the scheduled amount, not what has been paid', () => {
    expect(fixedCostsTotalMinor(billsFor([rent, gym], [], NOW))).toBe(93000);
  });
});

describe('monthHistory', () => {
  it('returns the window oldest-first with this month last', () => {
    const out = monthHistory([], NOW, 6);
    expect(out).toHaveLength(6);
    expect(out.at(-1)!.current).toBe(true);
    expect(out.filter((m) => m.current)).toHaveLength(1);
  });

  it('sums spending into the month it happened in', () => {
    // base_minor is the reporting-currency value and is what totals must use,
    // so it has to be set alongside amount_minor here.
    const out = monthHistory([
      tx({ amount_minor: -1000, base_minor: -1000, occurred_at: '2026-08-03T10:00:00.000Z' }),
      tx({ amount_minor: -2500, base_minor: -2500, occurred_at: '2026-07-14T10:00:00.000Z' }),
    ], NOW, 6);
    expect(out.at(-1)!.totalMinor).toBe(1000);
    expect(out.at(-2)!.totalMinor).toBe(2500);
  });

  it('excludes income — this is a spending chart', () => {
    const out = monthHistory([
      tx({ amount_minor: 500000, base_minor: 500000, is_income: true, occurred_at: '2026-08-03T10:00:00.000Z' }),
    ], NOW, 6);
    expect(out.at(-1)!.totalMinor).toBe(0);
  });

  it('averages only completed months — this one is still accruing', () => {
    // Without excluding the current month a half-finished August would drag
    // the "average" down and the comparison would be meaningless.
    const points = [
      { label: 'Jun', totalMinor: 2000, current: false },
      { label: 'Jul', totalMinor: 4000, current: false },
      { label: 'Aug', totalMinor: 10, current: true },
    ];
    expect(historyAverageMinor(points)).toBe(3000);
  });

  it('has no average before any month has completed', () => {
    expect(historyAverageMinor([{ label: 'Aug', totalMinor: 10, current: true }])).toBe(0);
  });
});

describe('fixed vs day-to-day classification', () => {
  // This split is the product. If a bill leaks into day-to-day, "safe to
  // spend" is wrong on the one screen the whole app exists to show.
  const food = cat({ name: 'Groceries', is_fixed: false, limit_minor: 32000 });
  const rent = cat({ name: 'Rent', is_fixed: true, due_day: 1, limit_minor: 90000 });
  const ctx = { now: NOW, dayToDayMinor: 82000, savingsTargetMinor: 0 };

  it('a bill does not reduce what is safe to spend', () => {
    const withRent = derive([tx({ category_id: rent.local_id, amount_minor: -90000, base_minor: -90000 })], [food, rent], ctx);
    const withNothing = derive([], [food, rent], ctx);
    expect(withRent.leftMinor).toBe(withNothing.leftMinor);
  });

  it('a day-to-day spend does reduce it', () => {
    const spend = derive([tx({ category_id: food.local_id, amount_minor: -2000, base_minor: -2000 })], [food, rent], ctx);
    expect(spend.leftMinor).toBe(82000 - 2000);
  });

  it('routes each spend to the right total', () => {
    const d = derive([
      tx({ category_id: food.local_id, amount_minor: -2000, base_minor: -2000 }),
      tx({ category_id: rent.local_id, amount_minor: -90000, base_minor: -90000 }),
    ], [food, rent], ctx);
    expect(d.flexSpentMinor).toBe(2000);
    expect(d.fixedSpentMinor).toBe(90000);
    expect(d.monthTotalMinor).toBe(92000);
  });

  it('re-flagging a category moves its spending between the pots', () => {
    // Editing the type in Profile has to reclassify history too, otherwise the
    // totals disagree with what the category now says it is.
    const spend = tx({ category_id: food.local_id, amount_minor: -2000, base_minor: -2000 });
    const asFlex = derive([spend], [{ ...food, is_fixed: false }], ctx);
    const asFixed = derive([spend], [{ ...food, is_fixed: true }], ctx);
    expect(asFlex.flexSpentMinor).toBe(2000);
    expect(asFixed.flexSpentMinor).toBe(0);
    expect(asFixed.fixedSpentMinor).toBe(2000);
  });

  it('an uncategorised spend is treated as fixed, not as free money', () => {
    // Erring the other way would inflate what is safe to spend.
    const d = derive([tx({ category_id: null, amount_minor: -5000, base_minor: -5000 })], [food, rent], ctx);
    expect(d.flexSpentMinor).toBe(0);
    expect(d.fixedSpentMinor).toBe(5000);
  });

  it('the fixed share reflects the split', () => {
    const d = derive([
      tx({ category_id: food.local_id, amount_minor: -2500, base_minor: -2500 }),
      tx({ category_id: rent.local_id, amount_minor: -7500, base_minor: -7500 }),
    ], [food, rent], ctx);
    expect(Math.round(d.fixedSharePct)).toBe(75);
  });
});

describe('month length and days left', () => {
  const ctx = { dayToDayMinor: 100000, savingsTargetMinor: 0 };

  it('counts today as remaining', () => {
    // 10 August, a 31-day month: the 10th through the 31st is 22 days.
    const d = derive([], [], { ...ctx, now: new Date('2026-08-10T12:00:00') });
    expect(d.daysInMonth).toBe(31);
    expect(d.daysLeft).toBe(22);
  });

  it('gets February right in a leap year', () => {
    // Derived from the calendar, not a lookup table, so this cannot drift.
    const leap = derive([], [], { ...ctx, now: new Date('2028-02-10T12:00:00') });
    expect(leap.daysInMonth).toBe(29);
    expect(leap.daysLeft).toBe(20);
  });

  it('gets February right in a common year', () => {
    const common = derive([], [], { ...ctx, now: new Date('2027-02-10T12:00:00') });
    expect(common.daysInMonth).toBe(28);
    expect(common.daysLeft).toBe(19);
  });

  it('handles the century rule', () => {
    // 2100 is divisible by 4 but not a leap year; a naive %4 check fails here.
    const y2100 = derive([], [], { ...ctx, now: new Date('2100-02-10T12:00:00') });
    expect(y2100.daysInMonth).toBe(28);
    const y2000 = derive([], [], { ...ctx, now: new Date('2000-02-10T12:00:00') });
    expect(y2000.daysInMonth).toBe(29);
  });

  it('never reports zero days left on the last day', () => {
    // perDayMinor divides by daysLeft, so a zero here would be a division by
    // zero on the 31st of every month.
    for (const iso of ['2026-01-31T12:00:00', '2026-04-30T12:00:00', '2026-02-28T12:00:00']) {
      const d = derive([], [], { ...ctx, now: new Date(iso) });
      expect(d.daysLeft, iso).toBe(1);
      expect(Number.isFinite(d.perDayMinor), iso).toBe(true);
    }
  });

  it('short months mean a bigger daily allowance for the same budget', () => {
    const feb = derive([], [], { ...ctx, now: new Date('2027-02-01T12:00:00') });
    const jan = derive([], [], { ...ctx, now: new Date('2027-01-01T12:00:00') });
    expect(feb.perDayMinor).toBeGreaterThan(jan.perDayMinor);
  });
});

describe('fixed costs without a due day', () => {
  // Reported from production: a £200 fixed cost added in Profile did not move
  // the Budget stat or the "This month" total. It had no due day, and billsFor
  // required one, so the money was committed but invisible to every figure.
  const dated = cat({ name: 'Rent', is_fixed: true, due_day: 1, limit_minor: 90000 });
  const undated = cat({ name: 'Gym', is_fixed: true, due_day: null, limit_minor: 20000 });

  it('counts toward the fixed-costs total', () => {
    expect(fixedCostsTotalMinor(billsFor([dated, undated], [], NOW))).toBe(110000);
  });

  it('appears in the fixed costs list', () => {
    expect(billsFor([dated, undated], [], NOW).map((b) => b.name)).toContain('Gym');
  });

  it('carries a null due day rather than a fabricated one', () => {
    const b = billsFor([undated], [], NOW)[0]!;
    expect(b.dueDay).toBeNull();
    expect(b.inDays).toBeNull();
  });

  it('is left out of "Coming up", which needs a date', () => {
    expect(upcomingBills([dated, undated], [], NOW).map((b) => b.name)).toEqual(['Rent']);
  });

  it('sorts after the dated ones', () => {
    const late = cat({ name: 'Phone', is_fixed: true, due_day: 28, limit_minor: 2000 });
    expect(billsFor([undated, late, dated], [], NOW).map((b) => b.name))
      .toEqual(['Rent', 'Phone', 'Gym']);
  });

  it('still reaches the budget figures through derive', () => {
    const d = derive([], [dated, undated], {
      now: NOW, dayToDayMinor: 84000, savingsTargetMinor: 0,
      fixedCostsMinor: fixedCostsTotalMinor(billsFor([dated, undated], [], NOW)),
    });
    // 84000 day-to-day + 110000 fixed is what the Budget stat shows.
    expect(84000 + d.committedFixedMinor).toBe(194000);
  });
});
