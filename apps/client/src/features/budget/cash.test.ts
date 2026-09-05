import { describe, expect, it } from 'vitest';
import { cashLedger, cashState, movementsFrom } from './cash.js';
import { cycleFor, type CycleSettings } from './cycle.js';

const WEEKLY: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-21' };
const start = (iso: string): Date => new Date(`${iso}T00:00:00`);

/**
 * Movements keyed by the cycle's start date, for readable fixtures.
 *
 * Formatted from local parts, not toISOString(): a cycle starts at local
 * midnight, and in BST that is 23:00 the previous day in UTC, so ISO keys
 * would silently address the wrong cycle.
 */
const key = (d: Date): string =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
const on = (m: Record<string, [income: number, outflow: number]>) =>
  (c: { start: Date }) => {
    const k = key(c.start);
    const [incomeMinor = 0, outflowMinor = 0] = m[k] ?? [];
    return { incomeMinor, outflowMinor };
  };

describe('cashLedger()', () => {
  it('opens on what you said you had', () => {
    const rows = cashLedger(WEEKLY, start('2026-08-25'), new Date('2026-08-26T12:00:00'), 20000, on({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.openingMinor).toBe(20000);
    expect(rows[0]!.closingMinor).toBe(20000);
  });

  it('carries what is left into the next cycle', () => {
    // £200 to start, spend £150 → £50 carried, then £500 lands.
    const rows = cashLedger(
      WEEKLY, start('2026-08-25'), new Date('2026-09-01T12:00:00'), 20000,
      on({ '2026-08-21': [0, 15000], '2026-08-28': [50000, 0] }),
    );
    expect(rows.map((r) => [r.openingMinor, r.closingMinor])).toEqual([
      [20000, 5000],
      [5000, 55000],
    ]);
  });

  it('carries a shortfall forward as debt, not as zero', () => {
    /*
     * Overspending is a real state. Clamping it at zero would hand back a
     * clean slate every payday and quietly forgive the overspend — the app
     * would be lying in the user's favour, which is the worst direction.
     */
    const rows = cashLedger(
      WEEKLY, start('2026-08-25'), new Date('2026-09-01T12:00:00'), 20000,
      on({ '2026-08-21': [0, 26000], '2026-08-28': [50000, 0] }),
    );
    expect(rows[0]!.closingMinor).toBe(-6000);
    expect(rows[1]!.openingMinor).toBe(-6000);
    expect(rows[1]!.closingMinor).toBe(44000);   // the debt comes off the wages
  });

  it('does not invent money when no income arrives', () => {
    // The old flow rollover added a full allowance every cycle regardless.
    const rows = cashLedger(
      WEEKLY, start('2026-08-25'), new Date('2026-09-08T12:00:00'), 20000, on({}),
    );
    expect(rows.every((r) => r.closingMinor === 20000)).toBe(true);
  });
});

describe('cashState()', () => {
  it('reports what was brought forward and what is held now', () => {
    const s = cashState(
      WEEKLY, start('2026-08-25'), new Date('2026-09-01T12:00:00'), 20000,
      on({ '2026-08-21': [0, 15000], '2026-08-28': [50000, 8000] }),
    );
    expect(s.broughtForwardMinor).toBe(5000);
    expect(s.incomeMinor).toBe(50000);
    expect(s.outflowMinor).toBe(8000);
    expect(s.totalMinor).toBe(47000);
  });

  it('falls back to the opening figure before any cycle has run', () => {
    const s = cashState(WEEKLY, start('2030-01-01'), new Date('2026-08-26T12:00:00'), 20000, on({}));
    expect(s.totalMinor).toBe(20000);
  });
});

describe('movementsFrom()', () => {
  const cycle = cycleFor(new Date('2026-08-26T12:00:00'), WEEKLY);   // 21–28 Aug
  const tx = (o: Partial<Parameters<typeof movementsFrom>[0][number]> & { occurred_at: string; amount_minor: number }) =>
    ({ is_income: false, deleted_at: null, base_minor: null, ...o });

  it('counts wages in and spending out', () => {
    const m = movementsFrom([
      tx({ occurred_at: '2026-08-24T09:00:00', amount_minor: 50000, is_income: true }),
      tx({ occurred_at: '2026-08-25T09:00:00', amount_minor: -3000 }),
    ])(cycle);
    expect(m).toEqual({ incomeMinor: 50000, outflowMinor: 3000 });
  });

  it('never treats setting money aside as money leaving', () => {
    /*
     * The whole reason transfers exist. Moving £90 into the rent pot makes you
     * no poorer — only the rent payment itself does. Counting the transfer as
     * outflow would charge you for the bill twice: once saving for it, once
     * paying it.
     */
    const m = movementsFrom([
      tx({ occurred_at: '2026-08-25T09:00:00', amount_minor: -9000, is_transfer: true }),
    ])(cycle);
    expect(m.outflowMinor).toBe(0);
  });

  it('does count the bill itself when it is paid', () => {
    const m = movementsFrom([
      tx({ occurred_at: '2026-08-25T09:00:00', amount_minor: -9000, is_transfer: true }),
      tx({ occurred_at: '2026-08-26T09:00:00', amount_minor: -65000 }),
    ])(cycle);
    expect(m.outflowMinor).toBe(65000);
  });

  it('ignores deleted rows and other cycles', () => {
    const m = movementsFrom([
      tx({ occurred_at: '2026-08-25T09:00:00', amount_minor: -3000, deleted_at: '2026-08-26T00:00:00' }),
      tx({ occurred_at: '2026-08-14T09:00:00', amount_minor: -4000 }),
    ])(cycle);
    expect(m).toEqual({ incomeMinor: 0, outflowMinor: 0 });
  });

  it('prefers the base amount on a foreign-currency row', () => {
    const m = movementsFrom([
      tx({ occurred_at: '2026-08-25T09:00:00', amount_minor: -4000, base_minor: -3400 }),
    ])(cycle);
    expect(m.outflowMinor).toBe(3400);
  });
});

describe('the balance is a statement about a moment', () => {
  it('does not replay spending that happened before you gave the figure', () => {
    /*
     * The reported bug, with the real numbers from a live account. Someone
     * said "I have £160" on 31 August, having already spent £1,431.85 that
     * month. `cyclesBetween` returns the whole cycle containing the 31st —
     * which starts on the 1st — so the entire month was subtracted from a
     * balance measured after it, and the app reported −£1,271.85.
     */
    const monthly: CycleSettings = { kind: 'monthly', anchorDay: 1 };
    // £1,431.85 of spending, all of it on the 10th — before the 31st. The
    // clip must exclude it, so this reports what a real movementsFrom would:
    // nothing inside the window that starts on the 31st.
    const spentEarlier = (_c: { start: Date; end: Date }, from: Date) =>
      from.getDate() >= 31 ? { incomeMinor: 0, outflowMinor: 0 } : { incomeMinor: 0, outflowMinor: 143185 };

    const s = cashState(monthly, start('2026-08-31'), new Date('2026-08-31T12:00:00'), 16000, spentEarlier);
    expect(s.totalMinor).toBe(16000);
  });

  it('still counts everything from that moment onward', () => {
    const monthly: CycleSettings = { kind: 'monthly', anchorDay: 1 };
    // £40 spent after the balance was given.
    const after = () => ({ incomeMinor: 0, outflowMinor: 4000 });
    const s = cashState(monthly, start('2026-08-31'), new Date('2026-08-31T12:00:00'), 16000, after);
    expect(s.totalMinor).toBe(12000);
  });

  it('counts a whole cycle once it is no longer the first', () => {
    // The clip applies only to the cycle the balance was measured in.
    const monthly: CycleSettings = { kind: 'monthly', anchorDay: 1 };
    const each = () => ({ incomeMinor: 0, outflowMinor: 1000 });
    const s = cashState(monthly, start('2026-08-31'), new Date('2026-10-05T12:00:00'), 16000, each);
    // Aug (clipped, still one call), Sep, Oct → three rows of £10.
    expect(s.rows).toHaveLength(3);
    expect(s.totalMinor).toBe(16000 - 3000);
  });
});


describe('the clip, end to end through movementsFrom', () => {
  /* No hand-rolled callback: real transactions, real filter, real ledger. */
  const monthly: CycleSettings = { kind: 'monthly', anchorDay: 1 };
  const tx = (day: string, amount: number, income = false) => ({
    deleted_at: null, is_income: income, is_transfer: false,
    occurred_at: `${day}T10:00:00`, amount_minor: amount, base_minor: amount,
  });

  it('ignores the month you already spent before giving the figure', () => {
    const rows = [tx('2026-08-10', -46500), tx('2026-08-21', -29000), tx('2026-08-28', -1710)];
    const s = cashState(monthly, start('2026-08-31'), new Date('2026-08-31T12:00:00'),
      16000, movementsFrom(rows));
    expect(s.totalMinor).toBe(16000);
  });

  it('counts what happens on the day itself and after', () => {
    const rows = [
      tx('2026-08-10', -46500),   // before — ignored
      tx('2026-08-31', -2000),    // same day — counted
      tx('2026-09-02', -1000),    // after — counted
    ];
    const s = cashState(monthly, start('2026-08-31'), new Date('2026-09-03T12:00:00'),
      16000, movementsFrom(rows));
    expect(s.totalMinor).toBe(16000 - 2000 - 1000);
  });

  it('lets income after the figure top the balance back up', () => {
    const rows = [tx('2026-08-10', -46500), tx('2026-09-01', 200000, true)];
    const s = cashState(monthly, start('2026-08-31'), new Date('2026-09-02T12:00:00'),
      16000, movementsFrom(rows));
    expect(s.totalMinor).toBe(16000 + 200000);
  });
});
