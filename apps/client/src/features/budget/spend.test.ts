import { describe, expect, it } from 'vitest';
import { spentInCycle, usagePct } from './spend.js';
import { cycleFor } from './cycle.js';
import type { Transaction } from '@spendwise/shared-types';

const WEEKLY = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-03' } as const;
const NOW = new Date('2026-08-26T12:00:00');   // cycle: Mon 24 – Sun 30 Aug

function tx(over: Partial<Transaction> & { local_id: string; occurred_at: string }): Transaction {
  return {
    category_id: 'groceries', bank_id: null,
    amount_minor: -3000, currency: 'GBP', base_minor: -3000, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: over.occurred_at.slice(0, 10), fx_provisional: false,
    merchant: null, note: null, is_income: false, pending: false,
    version: 1, created_at: over.occurred_at, updated_at: over.occurred_at, deleted_at: null,
    ...over,
  } as Transaction;
}

describe('spentInCycle()', () => {
  const cycle = cycleFor(NOW, WEEKLY);

  it('counts only what falls inside the cycle', () => {
    const rows = [
      tx({ local_id: 'in1', occurred_at: '2026-08-25T10:00:00' }),
      tx({ local_id: 'in2', occurred_at: '2026-08-26T10:00:00' }),
      tx({ local_id: 'lastweek', occurred_at: '2026-08-20T10:00:00' }),  // same month, prior cycle
    ];
    expect(spentInCycle(rows, 'groceries', cycle)).toBe(6000);
  });

  it('does not let a whole month of spending be measured against one week', () => {
    // The bug: month-scoped spend against a per-cycle limit pinned every bar.
    const month = Array.from({ length: 26 }, (_, i) =>
      tx({ local_id: `d${i}`, occurred_at: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00` }));
    const cycleOnly = spentInCycle(month, 'groceries', cycle);
    expect(cycleOnly).toBeLessThan(month.length * 3000);
    expect(usagePct(cycleOnly, 20000)).toBeLessThan(100);
  });

  it('ignores income, deleted rows and other categories', () => {
    const rows = [
      tx({ local_id: 'keep', occurred_at: '2026-08-25T10:00:00' }),
      tx({ local_id: 'pay', occurred_at: '2026-08-25T10:00:00', is_income: true, amount_minor: 50000 }),
      tx({ local_id: 'gone', occurred_at: '2026-08-25T10:00:00', deleted_at: '2026-08-26T10:00:00' }),
      tx({ local_id: 'other', occurred_at: '2026-08-25T10:00:00', category_id: 'transport' }),
    ];
    expect(spentInCycle(rows, 'groceries', cycle)).toBe(3000);
  });

  it('uses the base amount when a foreign-currency row has one', () => {
    const rows = [tx({ local_id: 'fx', occurred_at: '2026-08-25T10:00:00', currency: 'EUR', amount_minor: -4000, base_minor: -3400 })];
    expect(spentInCycle(rows, 'groceries', cycle)).toBe(3400);
  });

  it('falls back to the raw amount before the rate has synced', () => {
    const rows = [tx({ local_id: 'fx', occurred_at: '2026-08-25T10:00:00', base_minor: null, amount_minor: -4000 })];
    expect(spentInCycle(rows, 'groceries', cycle)).toBe(4000);
  });
});

describe('usagePct()', () => {
  it('reports the fraction spent', () => {
    expect(usagePct(3000, 20000)).toBeCloseTo(15);
    expect(usagePct(20000, 20000)).toBe(100);
  });

  it('reports over-budget above 100 so callers can react', () => {
    expect(usagePct(30000, 20000)).toBe(150);
  });

  it('never returns NaN when there is no budget', () => {
    // "NaN%" is invalid CSS: the browser drops it and the bar renders FULL.
    for (const v of [usagePct(3000, 0), usagePct(0, 0), usagePct(3000, -5)]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
  });

  it('never returns NaN or Infinity from bad inputs', () => {
    for (const v of [usagePct(NaN, 100), usagePct(100, NaN), usagePct(Infinity, 100), usagePct(100, Infinity)]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
