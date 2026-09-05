// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Profile, type ScreenData } from './screens.js';
import { buildBudget } from '../features/budget/model.js';
import type { Category, Transaction } from '@spendwise/shared-types';

afterEach(cleanup);

const NOW = new Date('2026-08-26T12:00:00');

const cat = (o: Partial<Category> & { local_id: string; name: string }): Category => ({
  icon: 'groceries', colour: '#F5822B', limit_minor: 20000, is_fixed: false,
  kind: 'flow', pot_kind: null, recurrence: null, anchor_date: null, target_date: null,
  opening_minor: 0, due_day: null, version: 1, created_at: '', updated_at: '', deleted_at: null,
  ...o,
} as Category);

const tx = (o: Partial<Transaction> & { local_id: string; occurred_at: string }): Transaction => ({
  category_id: 'g', bank_id: null, amount_minor: -3000, currency: 'GBP',
  base_minor: -3000, base_currency: 'GBP', fx_rate: 1, fx_rate_date: '2026-08-25',
  fx_provisional: false, merchant: null, note: null, is_income: false, pending: false,
  version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Transaction);

function data(over: Partial<ScreenData> = {}): ScreenData {
  const categories = [cat({ local_id: 'g', name: 'Groceries' })];
  const transactions = [
    tx({ local_id: 't1', occurred_at: '2026-08-25T10:00:00' }),
    tx({ local_id: 'p1', occurred_at: '2026-08-24T09:00:00', is_income: true, amount_minor: 50000, base_minor: 50000, merchant: 'Acme Ltd', category_id: null }),
  ];
  const settings = { cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-03', expectedIncomeMinor: 50000 };
  return {
    categories, transactions, banks: [], currency: 'GBP', displayName: 'Jahid',
    dayToDayMinor: 20000, savingsTargetMinor: 10000, now: NOW,
    budget: buildBudget(settings as never, categories, transactions, NOW),
    d: { byCategory: new Map() } as never,
    monthlyIncomeMinor: 50000,
    identities: [{ provider: 'google', email: 'extrause32@gmail.com' } as never],
    ...over,
  } as ScreenData;
}

describe('Profile', () => {
  it('shows the account you are signed in as, once, under Account', () => {
    // Once. It used to appear under the name as well, which is the same fact
    // stated twice on one screen.
    render(<Profile {...data()} />);
    expect(screen.getAllByText(/extrause32@gmail\.com/)).toHaveLength(1);
  });

  it('always offers sign out and delete account when they are available', () => {
    const onSignOut = vi.fn(); const onDeleteAccount = vi.fn();
    render(<Profile {...data({ onSignOut, onDeleteAccount })} />);
    expect(screen.getByText('Sign out')).toBeDefined();
    expect(screen.getByText('Delete account')).toBeDefined();
  });

  it('still shows the Account section when identities never loaded', () => {
    // It used to disappear entirely, taking sign-out and delete with it.
    render(<Profile {...data({ identities: [], onSignOut: vi.fn(), onDeleteAccount: vi.fn() })} />);
    expect(screen.getByText('Account details unavailable')).toBeDefined();
    expect(screen.getByText('Sign out')).toBeDefined();
  });

  it('lists income on a timeline instead of swallowing it', () => {
    render(<Profile {...data()} />);
    expect(screen.getByText('Acme Ltd')).toBeDefined();
    // Twice: once on the timeline, once in the month total beneath it.
    expect(screen.getAllByText('£500.00')).toHaveLength(2);
  });

  it('measures a category bar over the cycle, not the calendar month', () => {
    const { container } = render(<Profile {...data()} />);
    // £30 spent of a £200 weekly limit = 15%.
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('15');
  });

  it('keeps every settings route reachable', () => {
    render(<Profile {...data({ onEditSetting: vi.fn(), onEditCategory: vi.fn(), onEditBank: vi.fn(), onEditAvatar: vi.fn() })} />);
    /* Day-to-day is no longer here: it is the sum of the category limits, and
       a row that claimed to own it could not actually change it. */
    for (const t of ['Income', 'Money you have now', 'Savings target']) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Day-to-day budget')).toBeNull();
    expect(screen.getByLabelText('Change your avatar')).toBeDefined();
  });
});


describe('the opening balance', () => {
  const withIncome = (): Transaction[] => [tx({
    local_id: 'pay', occurred_at: '2026-08-24T09:00:00',
    amount_minor: 50000, base_minor: 50000, is_income: true, category_id: null,
  })];

  it('can be set before any wage has arrived', () => {
    const onEditSetting = vi.fn();
    render(<Profile {...data({ transactions: [], onEditSetting })} />);
    screen.getByText('Money you have now').closest('button')!.click();
    expect(onEditSetting).toHaveBeenCalledWith('cash');
  });

  it('locks once a wage has landed', () => {
    /*
     * By then the ledger has been running on it — income in, spending out,
     * cycle after cycle. Editing the figure it started from does not correct
     * anything; it rewrites history and every number downstream.
     */
    const onEditSetting = vi.fn();
    render(<Profile {...data({ transactions: withIncome(), onEditSetting })} />);
    expect(screen.getByText('Money you have now').closest('button')).toBeNull();
    expect(screen.getByText(/Tracked from your pay and spending now/)).toBeDefined();
  });

  it('still shows the figure when locked, rather than hiding it', () => {
    render(<Profile {...data({ transactions: withIncome() })} />);
    expect(screen.getByText('Money you have now')).toBeDefined();
  });
});
