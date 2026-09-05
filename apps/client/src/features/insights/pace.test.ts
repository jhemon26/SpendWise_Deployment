import { describe, expect, it } from 'vitest';
import { paceNote } from './verdict.js';
import type { Derived } from './selectors.js';

const fmt = (m: number): string =>
  '£' + (Math.abs(m) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Only the fields paceNote reads; the rest of Derived is irrelevant here. */
function d(over: Partial<Derived>): Derived {
  return {
    daysInMonth: 31, dayOfMonth: 12, daysLeft: 20,
    flexSpentMinor: 0, fixedSpentMinor: 0, incomeMinor: 0, monthTotalMinor: 0,
    leftMinor: 0, perDayMinor: 0, spentPct: 0, datePct: 0, expectedMinor: 0,
    deltaMinor: 0, evenPaceMinor: 0, todaySpentMinor: 0, todayFlexSpentMinor: 0, byCategory: new Map(),
    spendFreeDays: 0, biggest: null, avgDayMinor: 0, fixedSharePct: 0,
    committedFixedMinor: 0,
    ...over,
  } as Derived;
}

describe('paceNote()', () => {
  it('puts the money in the headline when under pace', () => {
    const n = paceNote(d({ flexSpentMinor: 30000, leftMinor: 74000, deltaMinor: -11413 }), 104000, fmt, 'Aug');
    expect(n.headline).toBe('£114.13 under pace');
    expect(n.tail).toContain('ahead for the month');
    expect(n.tone).toBe('good');
  });

  it('puts the money in the headline when over pace', () => {
    const n = paceNote(d({ flexSpentMinor: 60000, leftMinor: 44000, deltaMinor: 19800 }), 104000, fmt, 'Aug');
    expect(n.headline).toBe('£198.00 over pace');
  });

  it('names the day the money runs out, when it will', () => {
    // Spending 600 over 12 days = 50/day; 100 left lasts 2 more days → day 14.
    const n = paceNote(
      d({ flexSpentMinor: 60000, leftMinor: 10000, deltaMinor: 19800, dayOfMonth: 12, daysInMonth: 31 }),
      104000, fmt, 'Aug',
    );
    expect(n.tail).toBe('· runs out 14 Aug at this rate');
  });

  it('says nothing extra when the money lasts the month', () => {
    // A filler clause is worse than no clause.
    const n = paceNote(
      d({ flexSpentMinor: 12000, leftMinor: 92000, deltaMinor: 1800, dayOfMonth: 12, daysInMonth: 31 }),
      104000, fmt, 'Aug',
    );
    expect(n.tail).toBe('');
  });

  it('leads with the shortfall once the budget is gone, not with pace', () => {
    const n = paceNote(d({ flexSpentMinor: 120000, leftMinor: -16000, deltaMinor: 80000, daysLeft: 9 }), 104000, fmt, 'Aug');
    expect(n.headline).toBe('£160.00 over budget');
    expect(n.tail).toBe('· 9 days still to go');
    expect(n.tone).toBe('bad');
  });

  it('escalates tone with how far off pace you are', () => {
    const mild = paceNote(d({ flexSpentMinor: 5000, leftMinor: 99000, deltaMinor: 5000 }), 104000, fmt, 'Aug');
    const bad = paceNote(d({ flexSpentMinor: 5000, leftMinor: 79000, deltaMinor: 25000 }), 104000, fmt, 'Aug');
    expect(mild.tone).toBe('warn');
    expect(bad.tone).toBe('bad');
  });

  it('does not congratulate a fresh month for spending nothing', () => {
    const n = paceNote(d({ flexSpentMinor: 0, dayOfMonth: 1, leftMinor: 104000 }), 104000, fmt, 'Aug');
    expect(n.headline).toBe('Clean slate');
    expect(n.tone).toBe('steady');
  });

  it('asks for a budget instead of dividing by zero', () => {
    const n = paceNote(d({ flexSpentMinor: 4000, leftMinor: -4000 }), 0, fmt, 'Aug');
    expect(n.headline).toBe('No budget set yet');
    expect(n.tone).toBe('steady');
  });

  it('always names a tone that has an icon', () => {
    const cases = [
      paceNote(d({ deltaMinor: -11413, leftMinor: 74000, flexSpentMinor: 30000 }), 104000, fmt, 'Aug'),
      paceNote(d({ deltaMinor: 19800, leftMinor: 44000, flexSpentMinor: 60000 }), 104000, fmt, 'Aug'),
      paceNote(d({ leftMinor: -16000, flexSpentMinor: 120000 }), 104000, fmt, 'Aug'),
      paceNote(d({}), 0, fmt, 'Aug'),
    ];
    for (const c of cases) {
      expect(['great', 'good', 'steady', 'warn', 'bad']).toContain(c.tone);
      expect(c.icon).toBe(c.tone);
    }
  });
});
