import { describe, expect, it } from 'vitest';
import { missingPaydays } from './payday.js';
import type { CycleSettings } from './cycle.js';
import type { Transaction } from '@spendwise/shared-types';

const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' };
const d = (s: string): Date => new Date(`${s}T00:00:00`);
const income = (day: string, amount = 50000): Transaction => ({
  local_id: day, category_id: null, bank_id: null, amount_minor: amount, currency: 'GBP',
  base_minor: amount, base_currency: 'GBP', fx_rate: 1, fx_rate_date: day, fx_provisional: false,
  merchant: null, note: null, occurred_at: `${day}T09:00:00`, is_income: true, is_transfer: false,
  pending: false, version: 1, created_at: '', updated_at: '', deleted_at: null,
} as Transaction);

describe('missingPaydays()', () => {
  it('credits each payday that has passed with nothing logged', () => {
    // Fridays 7, 14, 21 Aug. Started on the 7th, now the 23rd.
    const out = missingPaydays(weekly, d('2026-08-07'), d('2026-08-23'), 50000, []);
    expect(out.map((p) => p.at.getDate())).toEqual([7, 14, 21]);
    expect(out.every((p) => p.amountMinor === 50000)).toBe(true);
  });

  it('leaves a cycle alone once any wage is logged in it', () => {
    /*
     * Whatever the amount. Someone who corrected their pay to the real figure
     * must not then be handed an invented one on top of it.
     */
    const out = missingPaydays(weekly, d('2026-08-07'), d('2026-08-23'), 50000,
      [income('2026-08-15', 43000)]);
    expect(out.map((p) => p.at.getDate())).toEqual([7, 21]);
  });

  it('never credits a payday that has not arrived', () => {
    // Now is the 20th; the 21st has not happened.
    const out = missingPaydays(weekly, d('2026-08-07'), d('2026-08-20'), 50000, []);
    expect(out.map((p) => p.at.getDate())).toEqual([7, 14]);
  });

  it('never credits a wage that predates the opening balance', () => {
    /*
     * The balance the user gave already contains it. Crediting it again would
     * double their money on the very first screen they see.
     */
    const out = missingPaydays(weekly, d('2026-08-12'), d('2026-08-23'), 50000, []);
    expect(out.map((p) => p.at.getDate())).toEqual([14, 21]);
  });

  it('does nothing when no wage has been declared', () => {
    expect(missingPaydays(weekly, d('2026-08-07'), d('2026-08-23'), 0, [])).toEqual([]);
  });

  it('ignores a deleted wage, so the cycle is credited again', () => {
    const gone = { ...income('2026-08-15'), deleted_at: '2026-08-16T00:00:00' } as Transaction;
    const out = missingPaydays(weekly, d('2026-08-07'), d('2026-08-23'), 50000, [gone]);
    expect(out.map((p) => p.at.getDate())).toEqual([7, 14, 21]);
  });

  it('works the same for a monthly wage', () => {
    const monthly: CycleSettings = { kind: 'monthly', anchorDay: 20 };
    const out = missingPaydays(monthly, d('2026-07-20'), d('2026-09-25'), 200000, []);
    expect(out.map((p) => `${p.at.getMonth() + 1}/${p.at.getDate()}`)).toEqual(['7/20', '8/20', '9/20']);
  });
});
