import { describe, expect, it } from 'vitest';
import {
  cycleFor, shiftCycle, cyclesBetween, cyclesPerYear, accrualPerCycle, inCycle,
  type CycleSettings,
} from './cycle.js';

const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' }; // a Friday
const fourWeekly: CycleSettings = { kind: 'days', lengthDays: 28, anchorDate: '2026-08-07' };
const monthly: CycleSettings = { kind: 'monthly', anchorDay: 25 };
const d = (s: string): Date => new Date(`${s}T12:00:00`);

describe('cycleFor — days', () => {
  it('puts the anchor day itself in cycle 0, day 1', () => {
    const c = cycleFor(d('2026-08-07'), weekly);
    expect(c.index).toBe(0);
    expect(c.daysElapsed).toBe(1);
    expect(c.daysLeft).toBe(7);
  });

  it('never reports 0 days left while the cycle is current', () => {
    // daysLeft counts today, so the last day reads 1 — the figure is divided by.
    const c = cycleFor(d('2026-08-13'), weekly);
    expect(c.daysElapsed).toBe(7);
    expect(c.daysLeft).toBe(1);
  });

  it('rolls to the next cycle the day after it ends', () => {
    const c = cycleFor(d('2026-08-14'), weekly);
    expect(c.index).toBe(1);
    expect(c.daysElapsed).toBe(1);
  });

  it('floors into negative cycles before the anchor rather than collapsing to 0', () => {
    // Truncation would put every earlier date in cycle 0 and silently merge
    // months of history into one bucket.
    expect(cycleFor(d('2026-08-06'), weekly).index).toBe(-1);
    expect(cycleFor(d('2026-07-31'), weekly).index).toBe(-1);
    expect(cycleFor(d('2026-07-30'), weekly).index).toBe(-2);
  });

  it('handles four-weekly, which drifts through the calendar', () => {
    const a = cycleFor(d('2026-08-07'), fourWeekly);
    const b = cycleFor(d('2026-09-04'), fourWeekly);
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(a.daysTotal).toBe(28);
  });
});

describe('cycleFor — monthly', () => {
  it('stays in last month before the turnover day', () => {
    const c = cycleFor(d('2026-08-24'), monthly);
    expect(c.start.getMonth()).toBe(6);   // July
    expect(c.start.getDate()).toBe(25);
  });

  it('turns over on the anchor day', () => {
    const c = cycleFor(d('2026-08-25'), monthly);
    expect(c.start.getMonth()).toBe(7);   // August
    expect(c.daysElapsed).toBe(1);
  });

  it('clamps day 31 to month end instead of rolling into the next month', () => {
    // 31 must mean "last day" in February, not 3 March.
    const c = cycleFor(d('2026-02-28'), { kind: 'monthly', anchorDay: 31 });
    expect(c.start.getMonth()).toBe(1);   // February
    expect(c.start.getDate()).toBe(28);
  });

  it('gives months their real length, not an average', () => {
    expect(cycleFor(d('2026-02-10'), { kind: 'monthly', anchorDay: 1 }).daysTotal).toBe(28);
    expect(cycleFor(d('2026-03-10'), { kind: 'monthly', anchorDay: 1 }).daysTotal).toBe(31);
  });
});

describe('shiftCycle', () => {
  it('steps back and forward', () => {
    const c = cycleFor(d('2026-08-20'), weekly);
    expect(shiftCycle(c, -1, weekly).index).toBe(c.index - 1);
    expect(shiftCycle(c, 2, weekly).index).toBe(c.index + 2);
  });

  it('clamps each month independently instead of dragging the anchor down', () => {
    /*
     * The naive bug: clamp 31 to 28 for February, then keep stepping from 28
     * and lose the anchor for every later month. Each step must re-clamp from
     * the ORIGINAL anchor day, so March comes back to the 31st.
     *
     * 15 Feb with a 31st anchor sits in the cycle that opened on 31 Jan.
     */
    const s31: CycleSettings = { kind: 'monthly', anchorDay: 31 };
    const c = cycleFor(d('2026-02-15'), s31);
    expect(c.start.getMonth()).toBe(0);            // opened 31 January
    expect(c.start.getDate()).toBe(31);

    const feb = shiftCycle(c, 1, s31);
    expect(feb.start.getMonth()).toBe(1);
    expect(feb.start.getDate()).toBe(28);          // clamped for February

    const mar = shiftCycle(feb, 1, s31);
    expect(mar.start.getMonth()).toBe(2);
    expect(mar.start.getDate()).toBe(31);          // and back to 31, not 28
  });
});

describe('cyclesBetween', () => {
  it('is inclusive of both ends', () => {
    const cs = cyclesBetween(d('2026-08-07'), d('2026-08-28'), weekly);
    expect(cs.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('returns one cycle when both dates share it', () => {
    expect(cyclesBetween(d('2026-08-08'), d('2026-08-10'), weekly)).toHaveLength(1);
  });

  it('caps rather than spinning on a nonsense anchor', () => {
    const cs = cyclesBetween(d('1990-01-01'), d('2026-08-28'), weekly, 50);
    expect(cs).toHaveLength(50);
  });
});

describe('accrual', () => {
  it('uses 52.18 weeks, not 52', () => {
    // 52 would under-fund every bill by ~0.3% a year.
    expect(cyclesPerYear(weekly)).toBeCloseTo(52.1786, 3);
    expect(cyclesPerYear(fourWeekly)).toBeCloseTo(13.0446, 3);
    expect(cyclesPerYear(monthly)).toBe(12);
  });

  it('rounds up, because a shortfall on the due date is the failure that matters', () => {
    // £11,616/yr over 52.1786 weeks is £222.6201 a week. Rounding to the
    // nearest penny (£222.62) leaves the year 64p short of the bills; ceiling
    // to £222.63 overshoots by 51p. Overshoot is the safe direction.
    expect(accrualPerCycle(1161600, weekly)).toBe(22263);
  });

  it('accrues a full year to at least the annual cost', () => {
    const per = accrualPerCycle(1161600, weekly);
    expect(per * cyclesPerYear(weekly)).toBeGreaterThanOrEqual(1161600);
  });

  it('is zero for nothing owed', () => {
    expect(accrualPerCycle(0, weekly)).toBe(0);
    expect(accrualPerCycle(-500, weekly)).toBe(0);
  });
});

describe('inCycle', () => {
  it('includes the start and excludes the end', () => {
    const c = cycleFor(d('2026-08-10'), weekly);
    expect(inCycle('2026-08-07T00:00:00', c)).toBe(true);
    expect(inCycle('2026-08-13T23:59:59', c)).toBe(true);
    expect(inCycle('2026-08-14T00:00:00', c)).toBe(false);  // belongs to the next one
  });
});
