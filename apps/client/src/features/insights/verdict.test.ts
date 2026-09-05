import { describe, it, expect } from 'vitest';
import { verdictFor, VERDICT_ICON, type VerdictTone } from './verdict.js';
import type { Derived } from './selectors.js';

const BUDGET = 100000; // £1,000

/** Only the fields the verdict reads; the rest never influence it. */
function d(over: Partial<Derived> = {}): Derived {
  return {
    daysInMonth: 30, dayOfMonth: 15, daysLeft: 16,
    flexSpentMinor: 50000, fixedSpentMinor: 0, incomeMinor: 0, monthTotalMinor: 50000,
    leftMinor: 50000, perDayMinor: 3125, spentPct: 50, datePct: 50,
    expectedMinor: 50000, deltaMinor: 0, evenPaceMinor: 3333,
    todaySpentMinor: 0, todayFlexSpentMinor: 0, byCategory: new Map(), spendFreeDays: 0, biggest: null,
    avgDayMinor: 0, fixedSharePct: 0, committedFixedMinor: 0,
    ...over,
  } as Derived;
}

describe('verdictFor', () => {
  it('judges the gap as a SHARE of budget, not a raw amount', () => {
    // £50 over is nothing on £1,000 and serious on £100. Same delta, different
    // verdict — this is the whole point.
    const big = verdictFor(d({ deltaMinor: 5000 }), 1000000, 'August');
    const small = verdictFor(d({ deltaMinor: 5000 }), 10000, 'August');
    expect(big.tone).toBe('steady');
    expect(small.tone).toBe('bad');
  });

  it('escalates as the overspend grows', () => {
    const order: VerdictTone[] = ['steady', 'warn', 'bad'];
    const tones = [0, 0.08, 0.30].map((f) =>
      verdictFor(d({ deltaMinor: Math.round(BUDGET * f) }), BUDGET, 'August').tone);
    expect(tones).toEqual(order);
  });

  it('rewards underspending', () => {
    expect(verdictFor(d({ deltaMinor: -Math.round(BUDGET * 0.08) }), BUDGET, 'August').tone).toBe('good');
    expect(verdictFor(d({ deltaMinor: -Math.round(BUDGET * 0.30) }), BUDGET, 'August').tone).toBe('great');
  });

  it('overrides everything once the budget is actually gone', () => {
    // Being "under pace" is irrelevant if there is no money left.
    const v = verdictFor(d({ leftMinor: -1, deltaMinor: -BUDGET }), BUDGET, 'August');
    expect(v.tone).toBe('bad');
    expect(v.line).toMatch(/Budget's gone/);
  });

  it('does not congratulate an empty first day', () => {
    const v = verdictFor(d({ dayOfMonth: 1, flexSpentMinor: 0, deltaMinor: -BUDGET }), BUDGET, 'August');
    expect(v.line).toMatch(/Clean slate/);
  });

  it('asks for a budget rather than dividing by zero', () => {
    const v = verdictFor(d(), 0, 'August');
    expect(v.line).toMatch(/Set a budget/);
    expect(v.line.length).toBeGreaterThan(0);
  });

  it('names the day the money runs out, with a correct ordinal', () => {
    // Half the budget gone by day 3 => runs out around day 6.
    const v = verdictFor(d({ dayOfMonth: 3, flexSpentMinor: 50000, leftMinor: 50000, deltaMinor: 40000 }), BUDGET, 'August');
    expect(v.line).toMatch(/by the \d+(st|nd|rd|th)|until the \d+(st|nd|rd|th)/);
  });

  it('never claims a run-out date it cannot know', () => {
    const v = verdictFor(d({ flexSpentMinor: 0, deltaMinor: Math.round(BUDGET * 0.3), dayOfMonth: 10 }), BUDGET, 'August');
    expect(v.line).not.toMatch(/by the \d|until the \d/);
  });

  it('has an icon for every tone, and none reference anything external', () => {
    for (const t of ['great', 'good', 'steady', 'warn', 'bad'] as VerdictTone[]) {
      expect(VERDICT_ICON[t], t).toBeTruthy();
      expect(VERDICT_ICON[t], t).not.toMatch(/https?:|<script|on[a-z]+=/i);
    }
  });
});
