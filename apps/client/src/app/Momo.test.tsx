// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Budgets, Home, type ScreenData } from './screens.js';
import { buildBudget } from '../features/budget/model.js';
import { useApp } from '../core/store.js';
import { billFields } from '@spendwise/shared-types';
import type { Category, Transaction } from '@spendwise/shared-types';

afterEach(cleanup);

/**
 * A real account, exactly as the database holds it.
 *
 * Weekly, £420 a packet, anchored Fri 28 Aug. Set up on 29 Aug saying £183 in
 * hand, then £30 of groceries. Bills: rent £450 on the 30th, car finance £150
 * on the 30th, insurance £165 on the 18th, subscriptions £30 on the 18th.
 */
const cat = (name: string, limit: number, fixed: boolean, dueDay: number | null): Category => ({
  local_id: name, name, icon: 'other', colour: '#888888', limit_minor: limit,
  is_fixed: fixed, kind: 'flow', pot_kind: null, recurrence: null, anchor_date: null,
  target_date: null, opening_minor: 0, due_day: dueDay,
  version: 1, created_at: '', updated_at: '', deleted_at: null,
} as unknown as Category);

const CATS = [
  cat('Eating out', 5000, false, null), cat('Fun', 5000, false, null),
  cat('Groceries', 25000, false, null), cat('Shopping', 5000, false, null),
  cat('Transport', 3000, false, null),
  cat('Car finance', 15000, true, 30), cat('Insurance', 16500, true, 18),
  cat('Rent', 45000, true, 30), cat('Subscriptions', 3000, true, 18),
];
const SHOP = {
  local_id: 't', category_id: 'Groceries', bank_id: null, amount_minor: -3000,
  currency: 'GBP', base_minor: -3000, base_currency: 'GBP', fx_rate: 1,
  fx_rate_date: '2026-08-29', fx_provisional: false, merchant: null, note: null,
  occurred_at: '2026-08-29T21:56:44', is_income: false, is_transfer: false, pending: false,
  version: 1, created_at: '', updated_at: '', deleted_at: null,
} as Transaction;
const SETTINGS = {
  cycleKind: 'days' as const, cycleLengthDays: 7, cycleAnchorDate: '2026-08-28',
  cycleAnchorDay: null, expectedIncomeMinor: 42000, budgetStartDate: '2026-08-29',
  openingCashMinor: 18300,
};
const NOW = new Date('2026-08-30T12:00:00');

function home(txs: Transaction[] = [SHOP]): ScreenData {
  return {
    categories: CATS, transactions: txs, banks: [], currency: 'GBP', displayName: 'Mo Mo',
    dayToDayMinor: 43000, savingsTargetMinor: 0, now: NOW,
    budget: buildBudget(SETTINGS, CATS, txs, NOW),
    d: { byCategory: new Map() } as never, monthlyIncomeMinor: 42000, identities: [],
    onGoto: () => {},
  } as ScreenData;
}

describe("momo's first week", () => {
  it('tracks the cash correctly', () => {
    const b = buildBudget(SETTINGS, CATS, [SHOP], NOW);
    expect(b.summary.cashKnown).toBe(true);
    expect(b.summary.cashTotalMinor).toBe(15300);      // £183 − £30
  });

  it('treats the four bills as pots, not as weekly spending', () => {
    const b = buildBudget(SETTINGS, CATS, [SHOP], NOW);
    expect(b.pots.map((p) => p.pot.name).sort())
      .toEqual(['Car finance', 'Insurance', 'Rent', 'Subscriptions']);
    expect(b.flows).toHaveLength(5);
  });

  it('aims each bill at its own due day, not at all of them together', () => {
    /*
     * potOf fell back to TODAY when anchor_date was null, throwing the due day
     * away — so rent on the 30th and insurance on the 18th both anchored on
     * whatever day the app was opened, and every bill in the account came due
     * at once. Every existing bill took that path, because upsertCategory had
     * dropped anchor_date on the way in.
     */
    const b = buildBudget(SETTINGS, CATS, [SHOP], NOW);
    const due = Object.fromEntries(b.pots.map((p) => [p.pot.name, p.nextDue!.getDate()]));
    expect(due['Insurance']).toBe(18);
    expect(due['Subscriptions']).toBe(18);
    expect(due['Rent']).toBe(30);
    expect(due['Car finance']).toBe(30);
  });

  it('shows the date it is actually saving toward', () => {
    // Rent is due 30 Aug, but that falls inside the first cycle and cannot be
    // saved for, so the ledger aims at 30 September. The card has to say that
    // date, or it reads "due tomorrow" beside a figure that is a fifth of it.
    const b = buildBudget(SETTINGS, CATS, [SHOP], NOW);
    const rent = b.pots.find((p) => p.pot.name === 'Rent')!;
    expect(rent.nextDue!.getMonth()).toBe(8);        // September
    // £450 over four paydays — a bill is split across at most four.
    expect(rent.perCycleMinor).toBe(11250);
  });

  it('does not tell someone who spent £30 that they are over budget', () => {
    /*
     * The reported bug. Available was −£6 because the bills wanted £159 and
     * only £153 was in hand — nothing to do with overspending. The screen said
     * "£6.00 over your week" to someone who had spent £30 of £430.
     */
    render(<Home {...home()} />);
    expect(screen.queryByText(/over budget/)).toBeNull();
    expect(screen.getByText('to spend today')).toBeDefined();
  });

  it('says what is held and when more arrives, not three loose figures', () => {
    /*
     * This used to read "Bills need £215.00 this week and you have £153.00.
     * Your next pay covers it" — every figure true, and the reader left to
     * subtract one from another to learn why the headline said zero.
     */
    render(<Home {...home()} />);
    const note = screen.getByText(/held for bills|short for bills/);
    expect(note.textContent).toMatch(/next pay/);
    expect(screen.queryByText(/Bills need/)).toBeNull();
  });

  it('never shows the old jargon', () => {
    render(<Home {...home()} />);
    expect(screen.queryByText(/more than is left once bills and savings/)).toBeNull();
  });

  it('does say plainly when the budgets really are too big', () => {
    // Once the wage lands, cash is no longer the constraint — but £430 of
    // budgets against £261 free after bills still does not fit.
    const paid = { ...SHOP, local_id: 'pay', amount_minor: 42000, base_minor: 42000,
                   is_income: true, category_id: null, occurred_at: '2026-08-29T09:00:00' } as Transaction;
    render(<Home {...home([SHOP, paid])} />);
    const note = screen.getByText(/of weekly budgets/);
    expect(note.textContent).toContain('£430.00');
    expect(note.textContent).toContain('Lower them by');
  });
});

describe('creating a bill category', () => {
  it('keeps the pot fields instead of writing it as a flow', async () => {
    /*
     * upsertCategory spread flowFields() and then copied a hand-written list
     * of six fields, dropping kind, pot_kind, recurrence, anchor_date and
     * opening_minor. Every bill onboarding created was stored as a flow; it
     * only behaved because isPot() falls back to the legacy is_fixed column.
     */
    const written: Category[] = [];
    const db = { put: async (_: string, rec: Category) => { written.push(rec); } } as never;
    useApp.setState({ categories: [], deviceId: 'test' });

    await useApp.getState().upsertCategory(db, {
      name: 'Rent', icon: 'rent', colour: '#B5533D', limit_minor: 45000,
      is_fixed: true, due_day: 30,
      ...billFields('monthly', '2026-09-30', 0),
    });

    const rec = written[0]!;
    expect(rec.kind).toBe('pot');
    expect(rec.pot_kind).toBe('bill');
    expect(rec.recurrence).toBe('monthly');
    expect(rec.anchor_date).toBe('2026-09-30');
  });

  it('still defaults a plain category to a flow', async () => {
    const written: Category[] = [];
    const db = { put: async (_: string, rec: Category) => { written.push(rec); } } as never;
    useApp.setState({ categories: [], deviceId: 'test' });
    await useApp.getState().upsertCategory(db, { name: 'Groceries', limit_minor: 25000 });
    expect(written[0]!.kind).toBe('flow');
    expect(written[0]!.pot_kind).toBeNull();
  });
});


describe('where the actions live', () => {
  it('leaves Home with nothing to press', () => {
    /*
     * Home answers "how am I doing". Reading it should not change anything —
     * a dashboard that edits your budget from the same tap that scrolls it is
     * how money moves by accident.
     */
    const { container } = render(<Home {...home()} />);
    const pressable = [...container.querySelectorAll('button')]
      .map((b) => b.textContent?.trim())
      // Navigation and confirmation only. "See all" and "Details" move you to
      // another tab; "Done" confirms a reservation the app already made.
      // None of them edits money the way tapping a transaction did.
      .filter((t) => t && !['See all', 'Details', 'Done'].includes(t));
    expect(pressable).toEqual([]);
  });

  it('puts Set aside on Budgets, beside the commitments it funds', () => {
    const asked: string[] = [];
    render(<Budgets {...home()} onPutAside={(id) => asked.push(id)} />);
    const buttons = screen.getAllByRole('button', { name: 'Set aside' });
    expect(buttons.length).toBe(4);               // one per bill
    buttons[0]!.click();
    expect(asked).toHaveLength(1);
  });

  it('shows what each pot holds and what it still wants', () => {
    render(<Budgets {...home()} onPutAside={() => {}} />);
    // One line per pot: rent £90, car £30, insurance £41.25, subs £7.50.
    expect(screen.getAllByText(/to put by this week/)).toHaveLength(4);
  });
});
