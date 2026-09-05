// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Home, Insights, type ScreenData } from './screens.js';
import { buildBudget } from '../features/budget/model.js';
import { derive } from '../features/insights/selectors.js';
import { CATS, TXS, SETTINGS, NOW } from '../features/budget/audit-fixture.js';

afterEach(cleanup);

/**
 * The real account, as the database held it on 31 August 2026.
 *
 * Monthly pay, 31 transactions, six bills, £160 declared in hand. Every number
 * below was wrong on that account at once — all of it downstream of the cash
 * ledger replaying a month of spending against a balance measured after it.
 */
const budget = buildBudget(SETTINGS, CATS, TXS, NOW);
const d = derive(TXS, CATS, {
  now: NOW, dayToDayMinor: budget.summary.flowAllowanceMinor,
  savingsTargetMinor: 50000, fixedCostsMinor: 86806,
});
const data = {
  categories: CATS, transactions: TXS, banks: [], currency: 'GBP', displayName: 'Emon',
  dayToDayMinor: budget.summary.flowAllowanceMinor, savingsTargetMinor: 50000,
  now: NOW, budget, d, monthlyIncomeMinor: 200000, identities: [], onGoto: () => {},
} as unknown as ScreenData;

describe('the account that reported everything broken', () => {
  it('holds the balance the user actually gave', () => {
    // Was −£1,271.85: the whole month subtracted from a balance set on the 31st.
    expect(budget.summary.cashTotalMinor).toBe(16000);
    /* Six bills reserve more than £160, so the reservation caps at the money
       held, spendable floors at zero, and the rest is reported as a gap. */
    expect(budget.summary.reservedMinor).toBe(16000);
    expect(budget.summary.freeCashMinor).toBe(0);
    expect(budget.summary.cashShortfallMinor).toBeGreaterThan(0);
  });

  it('does not state two different balances on one card', () => {
    render(<Home {...data} />);
    // The headline says £0.00; the line beneath must not then say −£708.06.
    expect(screen.queryByText(/-£708\.06 left/)).toBeNull();
    expect(screen.getByText('to spend today')).toBeDefined();
  });

  it('tells you what you actually have when bills are short', () => {
    render(<Home {...data} />);
    /* Says what is held and when more arrives, rather than naming the demand
       and the balance and leaving the reader to do the subtraction. */
    const note = screen.getByText(/held for bills|short for bills/);
    expect(note.textContent).toMatch(/next pay/);
  });

  it('keeps money set aside out of the spending total', () => {
    render(<Insights {...data} />);
    // £1,506.85 included the £75 transfer; £1,431.85 is real spending.
    expect(screen.getByText('£1,431.85')).toBeDefined();
  });

  it('marks a projected Net as projected', () => {
    render(<Insights {...data} />);
    expect(screen.getByText('if it lands')).toBeDefined();
    expect(screen.getByText(/≈/)).toBeDefined();
  });

  it('does not compare against a month that never happened', () => {
    const { container } = render(<Home {...data} />);
    // Every "Where it went" row used to read "+" its own full amount.
    expect(container.textContent).not.toContain('+£290.00');
  });
});
