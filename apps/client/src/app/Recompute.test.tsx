// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { buildBudget, type BudgetSettings } from '../features/budget/model.js';
import type { Category } from '@spendwise/shared-types';

afterEach(cleanup);

/**
 * Changing only the balance must recompute the budget.
 *
 * The dependency list was written out by hand and had every setting except
 * `openingCashMinor`. Setting a new balance on the same day as the last one
 * moved nothing else — `budgetStartDate` was already today — so React reused
 * the memo and every figure on every screen kept the old balance until a
 * reload. The value was saving correctly the entire time, which is precisely
 * what made it look as though the setting did nothing.
 *
 * This mirrors App's memo exactly, including how it is keyed.
 */
const CATS: Category[] = [{
  local_id: 'food', name: 'Food', icon: 'other', colour: '#888888', limit_minor: 20000,
  is_fixed: false, kind: 'flow', pot_kind: null, recurrence: null, anchor_date: null,
  target_date: null, opening_minor: 0, due_day: null, installments: null,
  version: 1, created_at: '', updated_at: '', deleted_at: null,
} as unknown as Category];
const NOW = new Date('2026-08-31T21:00:00');

function Harness(): JSX.Element {
  const [openingCashMinor, setCash] = useState(5000);
  const settings: BudgetSettings = {
    cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-31',
    cycleAnchorDay: 1, expectedIncomeMinor: 45000,
    budgetStartDate: '2026-08-31',      // unchanged, as on the day it broke
    openingCashMinor,
  };
  const key = JSON.stringify(settings);
  const budget = useMemo(
    () => buildBudget(settings, CATS, [], NOW),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return (
    <div>
      <output>{budget.summary.cashTotalMinor}</output>
      <button type="button" onClick={() => setCash(15000)}>set 150</button>
    </div>
  );
}

describe('changing only the balance', () => {
  it('recomputes the budget without anything else changing', () => {
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('5000');
    fireEvent.click(screen.getByRole('button', { name: 'set 150' }));
    expect(screen.getByRole('status').textContent).toBe('15000');
  });

  it('is not saved by the date, which does not move on the same day', () => {
    /* Proof the old key was insufficient: keyed on budgetStartDate alone, both
       balances produce the same key, so the memo would never invalidate. */
    const a: BudgetSettings = {
      cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-31',
      cycleAnchorDay: 1, expectedIncomeMinor: 45000,
      budgetStartDate: '2026-08-31', openingCashMinor: 5000,
    };
    const b = { ...a, openingCashMinor: 15000 };
    expect(a.budgetStartDate).toBe(b.budgetStartDate);          // nothing to notice
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));      // but the snapshot differs
  });
});
