import { describe, expect, it } from 'vitest';
import { flowFields, type Category, type Transaction } from '@spendwise/shared-types';
import { report, monthPeriod, prevMonthPeriod, windowPeriod } from './report.js';

const NOW = new Date('2026-08-25T12:00:00');
let n = 0;
const id = (): string => `0199${(++n).toString(16).padStart(4, '0')}-0000-7000-8000-000000000000`;
const cat = (over: Partial<Category> = {}): Category => ({
  local_id: id(), server_id: null, created_at: '', updated_at: '', deleted_at: null,
  sync_status: 'synced', version: 1, device_id: 'd', name: 'Groceries', icon: 'groceries',
  colour: '#93bfb2', limit_minor: 9000, is_fixed: false, due_day: null, ...flowFields(), ...over,
});
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  local_id: id(), server_id: null, created_at: '', updated_at: '', deleted_at: null,
  sync_status: 'synced', version: 1, device_id: 'd', category_id: null, bank_id: null,
  amount_minor: -1000, currency: 'GBP', base_minor: -1000, base_currency: 'GBP',
  fx_rate: 1, fx_rate_date: '2026-08-25', fx_provisional: false, merchant: 'Shop',
  note: null, occurred_at: '2026-08-10T10:00:00', is_income: false, is_transfer: false, pending: false, ...over,
});

const aug = monthPeriod(NOW);
const jul = prevMonthPeriod(aug);

describe('periods', () => {
  it('ends exclusively so adjacent periods cannot double-count', () => {
    expect(aug.start.getDate()).toBe(1);
    expect(aug.end.getMonth()).toBe(8);          // 1 September
    expect(jul.end.getTime()).toBe(aug.start.getTime());
  });
});

describe('report', () => {
  const g = cat();
  const f = cat({ name: 'Fuel', colour: '#d9b8a2', icon: 'fuel' });

  it('separates income from spend and nets them', () => {
    const r = report([
      tx({ is_income: true, is_transfer: false, amount_minor: 50000, base_minor: 50000 }),
      tx({ category_id: g.local_id, amount_minor: -2500, base_minor: -2500 }),
    ], [g], aug, jul);
    expect(r.incomeMinor).toBe(50000);
    expect(r.spentMinor).toBe(2500);
    expect(r.netMinor).toBe(47500);
  });

  it('zero-fills every day so gaps stay visible', () => {
    const r = report([tx({ category_id: g.local_id, occurred_at: '2026-08-03T10:00:00' })], [g], aug, jul);
    expect(r.dailyMinor).toHaveLength(31);
    expect(r.dailyMinor[2]).toBe(1000);          // the 3rd
    expect(r.dailyMinor[3]).toBe(0);
  });

  it('compares each category against the same category last period', () => {
    const r = report([
      tx({ category_id: g.local_id, amount_minor: -5210, base_minor: -5210 }),
      tx({ category_id: g.local_id, amount_minor: -6140, base_minor: -6140, occurred_at: '2026-07-12T10:00:00' }),
    ], [g], aug, jul);
    const row = r.byCategory.find((x) => x.categoryId === g.local_id)!;
    expect(row.nowMinor).toBe(5210);
    expect(row.prevMinor).toBe(6140);
  });

  it('names uncategorised spend instead of dropping it', () => {
    // It used to be folded into a residual and never shown, which is how money
    // goes missing from a breakdown claiming to be complete.
    const r = report([tx({ category_id: null, amount_minor: -5000, base_minor: -5000 })], [], aug, jul);
    expect(r.byCategory[0]!.name).toBe('Uncategorised');
    expect(r.byCategory[0]!.nowMinor).toBe(5000);
  });

  it('sorts largest first', () => {
    const r = report([
      tx({ category_id: g.local_id, amount_minor: -1000, base_minor: -1000 }),
      tx({ category_id: f.local_id, amount_minor: -9000, base_minor: -9000 }),
    ], [g, f], aug, jul);
    expect(r.byCategory[0]!.name).toBe('Fuel');
  });

  it('uses the converted amount for foreign spend', () => {
    const r = report([tx({ category_id: g.local_id, amount_minor: -1400, base_minor: -1190 })], [g], aug, jul);
    expect(r.spentMinor).toBe(1190);
  });

  it('ignores deleted rows and other periods', () => {
    const r = report([
      tx({ category_id: g.local_id, deleted_at: '2026-08-11T00:00:00' }),
      tx({ category_id: g.local_id, occurred_at: '2026-09-02T10:00:00' }),
    ], [g], aug, jul);
    expect(r.spentMinor).toBe(0);
  });

  it('reports an arbitrary window, so a pay cycle works as well as a month', () => {
    const wk = windowPeriod(new Date('2026-08-21T00:00:00'), new Date('2026-08-28T00:00:00'), 'This week');
    const r = report([
      tx({ category_id: g.local_id, occurred_at: '2026-08-22T10:00:00' }),
      tx({ category_id: g.local_id, occurred_at: '2026-08-19T10:00:00' }),
    ], [g], wk, wk);
    expect(r.dailyMinor).toHaveLength(7);
    expect(r.spentMinor).toBe(1000);
  });
});

describe('income the app knows about but has never been logged', () => {
  /*
   * Wages arrive in a bank account, not through this app, so most people never
   * log a salary transaction. Reporting In as £0 to someone who told onboarding
   * they earn £500 a week reads as broken, because the app plainly knows better.
   */
  const g = cat();

  it('reports nothing from transactions when no income was logged', () => {
    const r = report([tx({ category_id: g.local_id })], [g], aug, jul);
    expect(r.incomeMinor).toBe(0);
    // The screen substitutes the expectation; the report itself stays factual.
  });

  it('uses the real figure once income is actually logged', () => {
    const r = report([
      tx({ is_income: true, is_transfer: false, amount_minor: 52500, base_minor: 52500 }),
      tx({ category_id: g.local_id }),
    ], [g], aug, jul);
    expect(r.incomeMinor).toBe(52500);
  });
});
