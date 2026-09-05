// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Activity, Home, type ScreenData } from '../../app/screens.js';
import { derive, groupByDay } from '../insights/selectors.js';
import { report, monthPeriod, prevMonthPeriod } from './report.js';
import { buildBudget } from './model.js';
import type { Category, Transaction } from '@spendwise/shared-types';

afterEach(cleanup);

/**
 * Setting money aside is not spending.
 *
 * Moving £75 into the car-finance pot makes you no poorer — only paying the
 * bill does. It leaked into six places at once: the Recent list, "Where it
 * went", Analytics' "Everything that left", the Activity list, the Activity
 * day totals, and the Bills filter count.
 */
const NOW = new Date('2026-08-31T12:00:00');
const cat = (id: string, name: string, fixed: boolean): Category => ({
  local_id: id, name, icon: 'other', colour: '#888888', limit_minor: 15000,
  is_fixed: fixed, kind: fixed ? 'pot' : 'flow', pot_kind: fixed ? 'bill' : null,
  recurrence: fixed ? 'monthly' : null, anchor_date: fixed ? '2026-09-01' : null,
  target_date: null, opening_minor: 0, due_day: null, version: 1,
  created_at: '', updated_at: '', deleted_at: null,
} as unknown as Category);
const tx = (id: string, day: string, amt: number, catId: string, transfer = false): Transaction => ({
  local_id: id, category_id: catId, bank_id: null, amount_minor: amt, currency: 'GBP',
  base_minor: amt, base_currency: 'GBP', fx_rate: 1, fx_rate_date: day, fx_provisional: false,
  merchant: null, note: null, occurred_at: `${day}T10:00:00`, is_income: false,
  is_transfer: transfer, pending: false, version: 1,
  created_at: '', updated_at: '', deleted_at: null,
} as Transaction);

const CATS = [cat('carfin', 'Car finance', true), cat('food', 'Food', false)];
const SET_ASIDE = tx('a', '2026-08-29', 7500, 'carfin', true);
const SPENT = tx('b', '2026-08-29', -2000, 'food');

describe('a transfer is not spending', () => {
  it('stays out of the spending totals', () => {
    const withBoth = derive([SET_ASIDE, SPENT], CATS, {
      now: NOW, dayToDayMinor: 15000, savingsTargetMinor: 0, fixedCostsMinor: 15000,
    });
    const spendOnly = derive([SPENT], CATS, {
      now: NOW, dayToDayMinor: 15000, savingsTargetMinor: 0, fixedCostsMinor: 15000,
    });
    expect(withBoth.monthTotalMinor).toBe(spendOnly.monthTotalMinor);
    expect(withBoth.byCategory.get('carfin')).toBeUndefined();
  });

  it('nets to nothing in the day total', () => {
    const [day] = groupByDay([SET_ASIDE, SPENT], NOW);
    // £20 spent that day. The £75 moved sideways changes nothing.
    expect(day!.netMinor).toBe(-2000);
  });

  it('stays out of Analytics', () => {
    const period = monthPeriod(NOW);
    const r = report([SET_ASIDE, SPENT], CATS, period, prevMonthPeriod(period));
    expect(r.spentMinor).toBe(2000);
    expect(r.byCategory.map((c) => c.name)).not.toContain('Car finance');
  });

  it('is not counted as spending or as a bill in Activity', () => {
    render(<Activity {...({ transactions: [SET_ASIDE, SPENT], categories: CATS, banks: [],
      currency: 'GBP', now: NOW, filter: 'all', onFilter: () => {} } as unknown as ScreenData)} />);
    // Two rows, but only one is spending and none is a bill payment.
    const chip = (name: string): string =>
      screen.getByRole('button', { name: new RegExp(`^${name}`) }).textContent ?? '';
    expect(chip('All')).toBe('All2');
    expect(chip('Spending')).toBe('Spending1');
    expect(chip('Bills')).toBe('Bills0');
  });

  it('reads as money set aside, not as a purchase', () => {
    render(<Activity {...({ transactions: [SET_ASIDE], categories: CATS, banks: [],
      currency: 'GBP', now: NOW, filter: 'all', onFilter: () => {} } as unknown as ScreenData)} />);
    expect(screen.getAllByText(/Set aside · Car finance/).length).toBeGreaterThan(0);
    // £75.00, not −£75.00.
    expect(screen.getAllByText('£75.00').length).toBeGreaterThan(0);
  });
});

describe('the move-it-aside reminder on Home', () => {
  const NOW2 = new Date('2026-09-05T12:00:00');
  const bill = cat('rent', 'Rent', true);
  const SETTINGS = {
    cycleKind: 'days' as const, cycleLengthDays: 7, cycleAnchorDate: '2026-08-28',
    cycleAnchorDay: null, expectedIncomeMinor: 60000,
    budgetStartDate: '2026-08-28', openingCashMinor: 100000,
  };
  const home = (txs: Transaction[], onConfirmMove?: (id: string, n: number) => void): ScreenData => {
    const budget = buildBudget(SETTINGS, [bill], txs, NOW2);
    return {
      categories: [bill], transactions: txs, banks: [], currency: 'GBP', displayName: 'A',
      dayToDayMinor: 0, savingsTargetMinor: 0, now: NOW2, budget,
      d: { byCategory: new Map() }, monthlyIncomeMinor: 60000, identities: [],
      onGoto: () => {}, ...(onConfirmMove ? { onConfirmMove } : {}),
    } as unknown as ScreenData;
  };

  it('asks you to move what was reserved', () => {
    render(<Home {...home([], () => {})} />);
    // One line with the total, not a row per pot.
    expect(screen.getByText(/Move/)).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Done' }).length).toBe(1);
  });

  it('passes the exact amount reserved when you confirm', () => {
    const calls: Array<[string, number]> = [];
    const data = home([], (id, n) => calls.push([id, n]));
    render(<Home {...data} />);
    screen.getByRole('button', { name: 'Done' }).click();
    const rent = data.budget.pots[0]!;
    expect(calls).toEqual([['rent', rent.outstandingMinor]]);
  });

  it('stops asking once the move is recorded', () => {
    const reserved = buildBudget(SETTINGS, [bill], [], NOW2).pots[0]!.outstandingMinor;
    const moved = tx('m', '2026-09-04', reserved, 'rent', true);
    render(<Home {...home([moved], () => {})} />);
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
});
