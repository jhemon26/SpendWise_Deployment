import { describe, expect, it } from 'vitest';
import { monthOutlook } from './outlook.js';
import type { CycleSettings } from './cycle.js';
import type { Category, Transaction } from '@spendwise/shared-types';

/* Fridays in Aug 2026: 7, 14, 21, 28 → four. In Oct 2026: 2, 9, 16, 23, 30 → five. */
const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' };
const monthly: CycleSettings = { kind: 'monthly', anchorDay: 20 };

const bill = (name: string, amount: number, anchor: string): Category => ({
  local_id: name, name, icon: 'other', colour: '#888888', limit_minor: amount,
  is_fixed: true, kind: 'pot', pot_kind: 'bill', recurrence: 'monthly',
  anchor_date: anchor, target_date: null, opening_minor: 0, due_day: null,
  installments: null, version: 1, created_at: '', updated_at: '', deleted_at: null,
} as unknown as Category);

const tx = (day: string, amount: number, o: Partial<Transaction> = {}): Transaction => ({
  local_id: day + amount, category_id: null, bank_id: null, amount_minor: amount,
  currency: 'GBP', base_minor: amount, base_currency: 'GBP', fx_rate: 1,
  fx_rate_date: day, fx_provisional: false, merchant: null, note: null,
  occurred_at: `${day}T10:00:00`, is_income: false, is_transfer: false, pending: false,
  version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Transaction);

describe('monthOutlook()', () => {
  it('counts a payday that lands today as arrived', () => {
    /*
     * The boundary: `now` is the exact local midnight the cycle turns over.
     * Payday is today — the money is there, and the Insights "In" figure is
     * paydaysSoFar × the packet, so treating it as still-to-come reports a
     * whole packet short for the rest of the day.
     */
    const midnight = new Date(2026, 7, 21, 0, 0, 0);
    expect(monthOutlook(weekly, 50000, [], [], midnight).paydaysSoFar).toBe(3);

    /* One millisecond earlier it genuinely has not arrived. */
    const before = new Date(2026, 7, 20, 23, 59, 59, 999);
    expect(monthOutlook(weekly, 50000, [], [], before).paydaysSoFar).toBe(2);
  });

  it('counts the paydays a month actually has, not an average', () => {
    /*
     * 52 ÷ 12 is 4.33 and no month has 4.33 paydays. August 2026 has four
     * Fridays; October has five, and a weekly earner is genuinely better off
     * that month. Averaging hides exactly the thing this view exists to show.
     */
    const aug = monthOutlook(weekly, 45000, [], [], new Date('2026-08-15T12:00:00'));
    const oct = monthOutlook(weekly, 45000, [], [], new Date('2026-10-15T12:00:00'));
    expect(aug.paydaysTotal).toBe(4);
    expect(oct.paydaysTotal).toBe(5);
    expect(aug.expectedMinor).toBe(4 * 45000);
    expect(oct.expectedMinor).toBe(5 * 45000);
  });

  it('says how many paydays have already landed', () => {
    const o = monthOutlook(weekly, 45000, [], [], new Date('2026-08-16T12:00:00'));
    expect(o.paydaysSoFar).toBe(2);      // the 7th and the 14th
  });

  it('adds up what actually arrived, separately from what was expected', () => {
    const o = monthOutlook(weekly, 45000, [], [
      tx('2026-08-07', 45000, { is_income: true }),
      tx('2026-08-14', 41000, { is_income: true }),   // a short week
    ], new Date('2026-08-16T12:00:00'));
    expect(o.expectedMinor).toBe(180000);
    expect(o.receivedMinor).toBe(86000);
  });

  it('counts each bill once, in the month it leaves', () => {
    const cats = [bill('Rent', 65000, '2026-08-01'), bill('Phone', 2000, '2026-08-23')];
    const o = monthOutlook(weekly, 45000, cats, [], new Date('2026-08-15T12:00:00'));
    expect(o.billsDueMinor).toBe(67000);
  });

  it('leaves out a bill that falls in a different month', () => {
    /*
     * A quarterly or annual bill is not this month's problem. Counting every
     * bill the account has would make a quiet month look ruinous.
     */
    const cats = [
      bill('Rent', 65000, '2026-08-01'),
      { ...bill('Car insurance', 30000, '2026-11-01'), recurrence: 'annual' } as Category,
    ];
    const o = monthOutlook(weekly, 45000, cats, [], new Date('2026-08-15T12:00:00'));
    expect(o.billsDueMinor).toBe(65000);
  });

  it('answers whether the month covers itself', () => {
    const cats = [bill('Rent', 65000, '2026-08-01')];
    // Four Fridays at £450 = £1,800 against £650 of rent.
    const o = monthOutlook(weekly, 45000, cats, [], new Date('2026-08-15T12:00:00'));
    expect(o.afterBillsMinor).toBe(180000 - 65000);

    // The same bills on a smaller wage do not.
    const tight = monthOutlook(weekly, 15000, cats, [], new Date('2026-08-15T12:00:00'));
    expect(tight.afterBillsMinor).toBeLessThan(0);
  });

  it('leaves money moved between pockets out of both totals', () => {
    const o = monthOutlook(weekly, 45000, [], [
      tx('2026-08-10', 9000, { is_transfer: true, category_id: 'rent' }),
      tx('2026-08-11', -3000),
    ], new Date('2026-08-15T12:00:00'));
    expect(o.spentMinor).toBe(3000);
    expect(o.receivedMinor).toBe(0);
  });

  it('works the same for a monthly earner', () => {
    const o = monthOutlook(monthly, 200000, [], [], new Date('2026-08-25T12:00:00'));
    expect(o.paydaysTotal).toBe(1);
    expect(o.expectedMinor).toBe(200000);
  });

  it('ignores transactions from other months', () => {
    const o = monthOutlook(weekly, 45000, [], [
      tx('2026-07-31', -5000), tx('2026-09-01', -5000),
    ], new Date('2026-08-15T12:00:00'));
    expect(o.spentMinor).toBe(0);
  });
});
