import { describe, it, expect } from 'vitest';
import type { Category, Transaction } from '@spendwise/shared-types';
import { derive, statusOf, groupByDay, dayLabel, categoryBreakdown } from './selectors.js';
import { arcFor, paintedLength, GAUGE_C } from '../../design-system/gauge-math.js';

const NOW = new Date('2026-08-07T12:00:00Z');

let n = 0;
const id = (): string => `0199${(++n).toString(16).padStart(4, '0')}-0000-7000-8000-000000000000`;

function cat(over: Partial<Category> = {}): Category {
  return {
    local_id: id(), server_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    deleted_at: null, sync_status: 'synced', version: 1, device_id: 'd',
    name: 'Groceries', icon: 'groceries', colour: '#14B8A6', limit_minor: 32000,
    is_fixed: false, ...over,
  };
}

function tx(over: Partial<Transaction> = {}): Transaction {
  const t = NOW.toISOString();
  return {
    local_id: id(), server_id: null, created_at: t, updated_at: t, deleted_at: null,
    sync_status: 'synced', version: 1, device_id: 'd',
    category_id: null, bank_id: null,
    amount_minor: -1000, currency: 'GBP', base_minor: -1000, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: '2026-08-07', fx_provisional: false,
    merchant: 'Shop', note: null, occurred_at: t, is_income: false, pending: false, ...over,
  };
}

const ctx = { now: NOW, dayToDayMinor: 82000, savingsTargetMinor: 40800 };

describe('derive — calendar', () => {
  it('counts August correctly, today included', () => {
    const d = derive([], [], ctx);
    expect(d.daysInMonth).toBe(31);
    expect(d.dayOfMonth).toBe(7);
    expect(d.daysLeft).toBe(25);
  });
});

describe('derive — spending', () => {
  it('separates flexible from fixed by category', () => {
    const flex = cat({ is_fixed: false });
    const fixed = cat({ name: 'Rent', is_fixed: true });
    const d = derive(
      [tx({ category_id: flex.local_id, amount_minor: -1500, base_minor: -1500 }),
       tx({ category_id: fixed.local_id, amount_minor: -90000, base_minor: -90000 })],
      [flex, fixed],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1500);
    expect(d.fixedSpentMinor).toBe(90000);
    expect(d.monthTotalMinor).toBe(91500);
  });

  it('ignores tombstoned transactions', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -1500, base_minor: -1500 }),
       tx({ category_id: c.local_id, amount_minor: -9999, base_minor: -9999, deleted_at: NOW.toISOString() })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1500);
  });

  it('ignores transactions from other months', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, occurred_at: '2026-07-20T10:00:00Z' })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(0);
  });

  it('uses the base amount for foreign currency, not the raw amount', () => {
    // A €14 lunch must count as its GBP value against a GBP budget.
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -1400, currency: 'EUR', base_minor: -1190 })],
      [c],
      ctx,
    );
    expect(d.flexSpentMinor).toBe(1190);
  });

  it('computes pace against the calendar', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -20329, base_minor: -20329 })],
      [c],
      ctx,
    );
    expect(d.leftMinor).toBe(82000 - 20329);
    expect(Math.round(d.spentPct)).toBe(25);
    expect(d.expectedMinor).toBe(Math.round(82000 * (7 / 31)));
    expect(d.deltaMinor).toBe(20329 - d.expectedMinor);
  });

  it('goes negative when over budget rather than clamping', () => {
    const c = cat();
    const d = derive([tx({ category_id: c.local_id, amount_minor: -90000, base_minor: -90000 })], [c], ctx);
    expect(d.leftMinor).toBeLessThan(0);
    expect(d.spentPct).toBeGreaterThan(100);
  });

  it('counts only today for the today tile', () => {
    const c = cat();
    const d = derive(
      [tx({ category_id: c.local_id, amount_minor: -2400, base_minor: -2400 }),
       tx({ category_id: c.local_id, amount_minor: -5000, base_minor: -5000, occurred_at: '2026-08-05T10:00:00Z' })],
      [c],
      ctx,
    );
    expect(d.todaySpentMinor).toBe(2400);
  });

  it('projects savings as income less fixed less the budget', () => {
    const flex = cat();
    const fixed = cat({ is_fixed: true });
    const d = derive(
      [tx({ is_income: true, amount_minor: 244500, base_minor: 244500 }),
       tx({ category_id: fixed.local_id, amount_minor: -121700, base_minor: -121700 })],
      [flex, fixed],
      ctx,
    );
    // 244500 - 121700 - 82000 = 40800
    expect(d.projectedSavingsMinor).toBe(40800);
  });
});

describe('statusOf', () => {
  it('maps percentage to state', () => {
    expect(statusOf(0)).toBe('ok');
    expect(statusOf(79)).toBe('ok');
    expect(statusOf(80)).toBe('warn');
    expect(statusOf(100)).toBe('warn');
    expect(statusOf(101)).toBe('danger');
  });
});

describe('groupByDay', () => {
  it('buckets by day, newest first, with a net total', () => {
    const g = groupByDay(
      [tx({ occurred_at: '2026-08-07T09:00:00Z', amount_minor: -1000 }),
       tx({ occurred_at: '2026-08-07T18:00:00Z', amount_minor: -500 }),
       tx({ occurred_at: '2026-08-06T10:00:00Z', amount_minor: -300 })],
      NOW,
    );
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday']);
    expect(g[0]!.netMinor).toBe(-1500);
    expect(g[1]!.items).toHaveLength(1);
  });

  it('labels relative days', () => {
    expect(dayLabel('2026-08-07T09:00:00Z', NOW)).toBe('Today');
    expect(dayLabel('2026-08-06T09:00:00Z', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-08-01T09:00:00Z', NOW)).toMatch(/Aug/);
  });
});

describe('categoryBreakdown', () => {
  it('shares sum to 100 and sort largest first', () => {
    const a = cat({ name: 'Rent' });
    const b = cat({ name: 'Food' });
    const d = derive(
      [tx({ category_id: a.local_id, amount_minor: -7500, base_minor: -7500 }),
       tx({ category_id: b.local_id, amount_minor: -2500, base_minor: -2500 })],
      [a, b],
      ctx,
    );
    const rows = categoryBreakdown(d, [a, b]);
    expect(rows.map((r) => r.category.name)).toEqual(['Rent', 'Food']);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 6);
  });

  it('is empty with no spending, rather than dividing by zero', () => {
    expect(categoryBreakdown(derive([], [], ctx), [])).toEqual([]);
  });
});

describe('gauge geometry — the original bug', () => {
  it('paints exactly the percentage at every value', () => {
    for (const pct of [0, 1, 3, 5, 10, 25, 28.86, 50, 75, 99, 100]) {
      const intended = GAUGE_C * Math.min(pct, 100) / 100;
      expect(paintedLength(arcFor(pct))).toBeCloseTo(intended, 6);
    }
  });

  it('paints nothing at zero — no stray dot', () => {
    expect(paintedLength(arcFor(0))).toBe(0);
  });

  it('uses butt caps below one stroke width, where two round caps will not fit', () => {
    expect(arcFor(1).linecap).toBe('butt');
    expect(arcFor(50).linecap).toBe('round');
  });

  it('clamps above 100 rather than overdrawing', () => {
    expect(paintedLength(arcFor(150))).toBeCloseTo(GAUGE_C, 6);
  });
});
