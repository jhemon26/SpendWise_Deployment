import { describe, expect, it } from 'vitest';
import { flowLedger, flowState, spendableToday, totalAllowanceMinor, spentFor, type Flow } from './flows.js';
import { cycleFor, type CycleSettings } from './cycle.js';

const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-01-02' };
const d = (s: string): Date => new Date(`${s}T12:00:00`);
const groceries: Flow = { id: 'g', name: 'Groceries', limitMinor: 9000 };

/** Spend keyed by cycle index, so tests read as a week-by-week story. */
const byIndex = (m: Record<number, number>) => (c: { index: number }): number => m[c.index] ?? 0;

describe('rollover', () => {
  it('carries underspend forward as real, spendable money', () => {
    // £90 allowance, £82 spent → £8 available on top of next week's £90.
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-09'), byIndex({ 0: 8200 }));
    expect(st.rolloverMinor).toBe(800);
    expect(st.availableMinor).toBe(9800);
  });

  it('carries overspend forward as a debt, so going over is not free', () => {
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-09'), byIndex({ 0: 11000 }));
    expect(st.rolloverMinor).toBe(-2000);
    expect(st.availableMinor).toBe(7000);
  });

  it('accumulates across several cycles', () => {
    // 8 + 3 + 23 = £34 carried into week four.
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-23'),
      byIndex({ 0: 8200, 1: 8700, 2: 6700 }));
    expect(st.rolloverMinor).toBe(3400);
    expect(st.availableMinor).toBe(12400);
  });

  it('does not count the current cycle twice', () => {
    // The regression this shape invites: including the current row's own
    // allowance in the carry, inflating available by a whole week.
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-02'), byIndex({ 0: 1000 }));
    expect(st.rolloverMinor).toBe(0);
    expect(st.availableMinor).toBe(8000);
  });

  it('shows the allowance and the carry separately', () => {
    // So a person can tell "this week's money" from "money I saved up".
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-16'), byIndex({ 0: 0, 1: 0 }));
    expect(st.allowanceMinor).toBe(9000);
    expect(st.rolloverMinor).toBe(18000);
  });
});

describe('flowLedger', () => {
  it('reports the running carry at the end of each cycle', () => {
    const rows = flowLedger(groceries, weekly, d('2026-01-02'), d('2026-01-16'),
      byIndex({ 0: 8200, 1: 9500 }));
    expect(rows.map((r) => r.carriedMinor)).toEqual([800, 300, 9300]);
  });
});

describe('spendableToday', () => {
  it('divides by days left including today, so it never divides by zero', () => {
    const cycle = cycleFor(d('2026-01-08'), weekly);   // day 7 of 7
    expect(cycle.daysLeft).toBe(1);
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-08'), byIndex({ 0: 2000 }));
    expect(spendableToday([st], cycle).perDayMinor).toBe(7000);
  });

  it('self-corrects downward the day after an overspend', () => {
    const before = spendableToday(
      [flowState(groceries, weekly, d('2026-01-02'), d('2026-01-04'), byIndex({ 0: 1000 }))],
      cycleFor(d('2026-01-04'), weekly));
    const after = spendableToday(
      [flowState(groceries, weekly, d('2026-01-02'), d('2026-01-05'), byIndex({ 0: 7000 }))],
      cycleFor(d('2026-01-05'), weekly));
    expect(after.perDayMinor).toBeLessThan(before.perDayMinor);
  });

  it('floors rather than rounds, so the figure is never a promise it cannot keep', () => {
    const cycle = cycleFor(d('2026-01-02'), weekly);
    const st = flowState({ id: 'x', name: 'x', limitMinor: 10000 }, weekly,
      d('2026-01-02'), d('2026-01-02'), () => 0);
    expect(spendableToday([st], cycle).perDayMinor).toBe(1428);   // not 1428.57
  });
});

describe('spentFor', () => {
  const row = (o: Partial<Record<string, unknown>>) => ({
    category_id: 'g', occurred_at: '2026-01-04T10:00:00', is_income: false,
    deleted_at: null, amount_minor: -1500, base_minor: -1500, ...o,
  }) as never;

  it('counts only this category, this cycle, spend only', () => {
    const c = cycleFor(d('2026-01-04'), weekly);
    const total = spentFor('g', [
      row({}),
      row({ category_id: 'other' }),
      row({ is_income: true }),
      row({ deleted_at: '2026-01-05' }),
      row({ occurred_at: '2026-01-20T10:00:00' }),
    ])(c);
    expect(total).toBe(1500);
  });

  it('uses the converted amount for foreign spend', () => {
    const c = cycleFor(d('2026-01-04'), weekly);
    expect(spentFor('g', [row({ amount_minor: -1400, base_minor: -1190 })])(c)).toBe(1190);
  });
});

describe('totalAllowanceMinor', () => {
  it('sums the day-to-day pot', () => {
    expect(totalAllowanceMinor([groceries, { id: 'f', name: 'Fuel', limitMinor: 4500 }])).toBe(13500);
  });
});

describe('a bar measured against its own budget', () => {
  /*
   * Home used to scale each bar to the largest visible category, which made the
   * largest one always full: £30 of groceries with nothing else logged painted
   * a 100% bar while £60 of the limit was still there.
   */
  const pctOf = (st: { spentMinor: number; allowanceMinor: number; rolloverMinor: number }): number =>
    Math.min(100, (st.spentMinor / Math.max(1, st.allowanceMinor + Math.max(0, st.rolloverMinor))) * 100);

  it('shows a third used when a third is used, whatever else is on screen', () => {
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-02'), byIndex({ 0: 3000 }));
    expect(Math.round(pctOf(st))).toBe(33);
  });

  it('counts carried money as part of the budget it is measured against', () => {
    // £90 allowance plus £90 carried: £30 is a sixth of what is available.
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-09'), byIndex({ 0: 0, 1: 3000 }));
    expect(st.rolloverMinor).toBe(9000);
    expect(Math.round(pctOf(st))).toBe(17);
  });

  it('caps at full rather than running off the end of the track', () => {
    const st = flowState(groceries, weekly, d('2026-01-02'), d('2026-01-02'), byIndex({ 0: 20000 }));
    expect(pctOf(st)).toBe(100);
    expect(st.availableMinor).toBeLessThan(0);
  });
});
