import { describe, expect, it } from 'vitest';
import { incomeTimeline } from './income.js';
import type { Transaction } from '@spendwise/shared-types';

const NOW = new Date('2026-08-24T12:00:00');

function tx(over: Partial<Transaction> & { local_id: string; occurred_at: string }): Transaction {
  return {
    category_id: null, bank_id: null,
    amount_minor: 50000, currency: 'GBP',
    base_minor: 50000, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: over.occurred_at.slice(0, 10), fx_provisional: false,
    merchant: null, note: null,
    is_income: true, pending: false,
    version: 1, created_at: over.occurred_at, updated_at: over.occurred_at, deleted_at: null,
    ...over,
  } as Transaction;
}

describe('incomeTimeline()', () => {
  it('lists income newest first', () => {
    const t = incomeTimeline([
      tx({ local_id: 'a', occurred_at: '2026-08-03T09:00:00Z' }),
      tx({ local_id: 'c', occurred_at: '2026-08-17T09:00:00Z' }),
      tx({ local_id: 'b', occurred_at: '2026-08-10T09:00:00Z' }),
    ], NOW);
    expect(t.entries.map((e) => e.local_id)).toEqual(['c', 'b', 'a']);
  });

  it('leaves spending out', () => {
    const t = incomeTimeline([
      tx({ local_id: 'pay', occurred_at: '2026-08-17T09:00:00Z' }),
      tx({ local_id: 'shop', occurred_at: '2026-08-18T09:00:00Z', is_income: false, amount_minor: -3000 }),
    ], NOW);
    expect(t.entries.map((e) => e.local_id)).toEqual(['pay']);
  });

  it('leaves deleted income out', () => {
    const t = incomeTimeline([
      tx({ local_id: 'gone', occurred_at: '2026-08-17T09:00:00Z', deleted_at: '2026-08-18T09:00:00Z' }),
    ], NOW);
    expect(t.entries).toEqual([]);
    expect(t.monthTotalMinor).toBe(0);
  });

  it('still shows last month\'s payday on the 1st', () => {
    // The whole point. A month filter would render this screen empty.
    const t = incomeTimeline(
      [tx({ local_id: 'july', occurred_at: '2026-07-28T09:00:00Z' })],
      new Date('2026-08-01T09:00:00'),
    );
    expect(t.entries).toHaveLength(1);
    expect(t.monthTotalMinor).toBe(0); // …but August has earned nothing yet
  });

  it('totals only the current month, in base currency', () => {
    const t = incomeTimeline([
      tx({ local_id: 'aug1', occurred_at: '2026-08-03T09:00:00Z', amount_minor: 50000, base_minor: 50000 }),
      tx({ local_id: 'aug2', occurred_at: '2026-08-17T09:00:00Z', amount_minor: 30000, base_minor: 30000 }),
      tx({ local_id: 'jul', occurred_at: '2026-07-20T09:00:00Z', amount_minor: 99900, base_minor: 99900 }),
    ], NOW);
    expect(t.monthTotalMinor).toBe(80000);
  });

  it('falls back to amount_minor when base_minor has not synced', () => {
    const t = incomeTimeline(
      [tx({ local_id: 'fx', occurred_at: '2026-08-05T09:00:00Z', currency: 'EUR', amount_minor: 40000, base_minor: null })],
      NOW,
    );
    expect(t.monthTotalMinor).toBe(40000);
  });

  it('reports amounts positive whichever sign they were stored with', () => {
    const t = incomeTimeline(
      [tx({ local_id: 'neg', occurred_at: '2026-08-05T09:00:00Z', amount_minor: -50000, base_minor: -50000 })],
      NOW,
    );
    expect(t.entries[0]?.amountMinor).toBe(50000);
    expect(t.monthTotalMinor).toBe(50000);
  });

  it('caps the list and says how many it held back', () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      tx({ local_id: `p${i}`, occurred_at: `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00Z` }));
    const t = incomeTimeline(many, NOW, 8);
    expect(t.entries).toHaveLength(8);
    expect(t.hiddenCount).toBe(3);
    expect(t.monthTotalMinor).toBe(11 * 50000); // the total still counts them all
  });

  it('names the source, and falls back when it is blank', () => {
    const t = incomeTimeline([
      tx({ local_id: 'a', occurred_at: '2026-08-17T09:00:00Z', merchant: 'Acme Ltd' }),
      tx({ local_id: 'b', occurred_at: '2026-08-10T09:00:00Z', merchant: '   ' }),
      tx({ local_id: 'c', occurred_at: '2026-08-03T09:00:00Z', merchant: null }),
    ], NOW);
    expect(t.entries.map((e) => e.label)).toEqual(['Acme Ltd', 'Income', 'Income']);
  });

  it('has nothing to show on a new account', () => {
    const t = incomeTimeline([], NOW);
    expect(t.entries).toEqual([]);
    expect(t.hiddenCount).toBe(0);
  });
});
