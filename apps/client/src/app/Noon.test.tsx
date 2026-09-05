// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Home, Budgets, Insights, Profile, type ScreenData } from './screens.js';
import { buildBudget } from '../features/budget/model.js';
import { isoDay } from '../features/budget/cycle.js';
import type { Category } from '@spendwise/shared-types';

afterEach(cleanup);

/*
 * A real account, exactly as it stood the evening it was created: weekly pay
 * of £450 anchored Fri 28 Aug, signed up on the 31st, £100 in hand, three
 * bills, eight flows — and not one transaction logged yet.
 *
 * Tapping "August" reported In £0.00 / Out £0.00 / Net £0.00.
 */
const NOW = new Date(2026, 7, 31, 22, 0);
const SETTINGS = {
  cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-28',
  expectedIncomeMinor: 45000, budgetStartDate: '2026-08-31', openingCashMinor: 10000,
};

const cat = (o: Partial<Category> & { local_id: string; name: string }): Category => ({
  icon: 'x', colour: '#fff', limit_minor: 0, is_fixed: false, kind: 'flow',
  pot_kind: null, recurrence: null, anchor_date: null, target_date: null,
  opening_minor: 0, due_day: null, version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Category);

const bill = (id: string, name: string, minor: number, day: number): Category =>
  cat({ local_id: id, name, limit_minor: minor, is_fixed: true, kind: 'pot',
    pot_kind: 'bill', recurrence: 'monthly', anchor_date: `2026-08-${day}`, due_day: day });

const CATEGORIES: Category[] = [
  cat({ local_id: 'gr', name: 'Groceries', limit_minor: 25000 }),
  cat({ local_id: 'eo', name: 'Eating out', limit_minor: 5000 }),
  cat({ local_id: 'tr', name: 'Transport', limit_minor: 16000 }),
  bill('ph', 'Phone', 3000, 20),
  bill('cf', 'Car finance', 17000, 18),
  bill('in', 'Insurance', 16000, 15),
];

function noon(): ScreenData {
  return {
    categories: CATEGORIES, transactions: [], banks: [], currency: 'GBP', displayName: 'Noon',
    dayToDayMinor: 0, savingsTargetMinor: 0, now: NOW, monthlyIncomeMinor: 45000, identities: [],
    budget: buildBudget(SETTINGS as never, CATEGORIES, [], NOW),
  } as ScreenData;
}

const click = (name: string): void => {
  act(() => { fireEvent.click(screen.getByRole('button', { name })); });
};

/** The In / Out / Net trio, read off the rendered card. */
function trio(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['In', 'Out', 'Net']) {
    const label = screen.getAllByText(key, { selector: 'p' })[0]!;
    out[key] = (label.nextElementSibling?.textContent ?? '').trim();
  }
  return out;
}

describe('Noon taps August with nothing logged', () => {
  it('does not answer the same question three different ways on one screen', () => {
    render(<Insights {...noon()} />);

    /*
     * The card at the top of this very screen counts August's paydays
     * honestly — four — and says so. Pinning it makes the contradiction
     * below unambiguous rather than a number I asserted from memory.
     */
    const card = screen.getByText('Expected in').closest('div')!.parentElement!;
    expect(card.textContent).toContain('4 × £450');
    expect(card.textContent).toContain('£1,800.00');

    click('August');

    const t = trio();
    /* Out is honest: nothing was spent, and no fallback should invent any. */
    expect(t['Out']).toBe('£0.00');
    /* In was £0.00 — beneath "Expected in £1,800.00", inches away. */
    expect(t['In']).toBe('£1,800.00');
    expect(t['Net']).toBe('≈+£1,800.00');
    /* Marked as a projection, both cells, so it cannot read as cash in hand. */
    expect(screen.getByText('expected')).toBeTruthy();
    expect(screen.getByText('if it lands')).toBeTruthy();
  });

  it('agrees with the weekly tab it sits one tap away from', () => {
    render(<Insights {...noon()} />);

    click('Your week');
    expect(trio()['In']).toBe('£450.00');

    click('August');
    /* Four paydays of the same £450 packet. The tabs now tell one story. */
    expect(trio()['In']).toBe('£1,800.00');
  });

  it('counts paydays passed, not paydays promised', () => {
    /*
     * Mid-month, two of August's four paydays are behind us. In is paired
     * with a bar chart of days already gone, so crediting all four would
     * overstate the month every time it is opened before the last payday.
     */
    const midNow = new Date(2026, 7, 18, 12, 0);
    render(<Insights {...noon()} budget={buildBudget(SETTINGS as never, CATEGORIES, [], midNow)} now={midNow} />);

    click('August');
    /* Aug 7 and Aug 14 have passed; Aug 21 and Aug 28 have not. */
    expect(trio()['In']).toBe('£900.00');
  });
});

describe('the day the month card is anchored to', () => {
  it('is the local calendar day, not the UTC one', () => {
    /*
     * toISOString() converts to UTC first, so a local midnight in BST comes
     * back as the previous date. The month card was handed 2026-08-27 for a
     * cycle that starts Fri 28 Aug, and six months in every twenty-four then
     * reported the wrong number of paydays — £450 out, in both directions.
     */
    const start = buildBudget(SETTINGS as never, CATEGORIES, [], NOW).cycle.start;
    expect(start.getDate()).toBe(28);
    expect(isoDay(start)).toBe('2026-08-28');
    expect(start.toISOString().slice(0, 10)).toBe('2026-08-27');   // the trap
  });

  it('is read at the call site, not just available as a helper', () => {
    /*
     * Asserting on isoDay alone lets the call site rot back to toISOString
     * without a test going red — the shift only happens under BST, so a
     * winter fixture proves nothing, and Noon's own 28 Aug cycle start
     * survives it by luck.
     *
     * Thu 20 Aug does not. Two paydays have passed, the 7th and the 14th;
     * sliding the anchor to the 27th moves them to the 6th, 13th and 20th,
     * and today's own payday lands early — £450 of income that never came.
     */
    const aug20 = new Date(2026, 7, 20, 22, 0);
    render(<Insights {...noon()} budget={buildBudget(SETTINGS as never, CATEGORIES, [], aug20)} now={aug20} />);

    click('August');
    expect(trio()['In']).toBe('£900.00');
  });
});

/*
 * Nothing on screen should show a negative pound figure for an account that
 * has simply run out of money. Noon reported seeing "-£60" after setting the
 * balance to £10 — a number that is arithmetically real (money owed to pots
 * minus money held) but reads as debt on an account that has none.
 */
describe('no screen shows a negative figure for an account that is merely empty', () => {
  const balances = [0, 1000, 5000, 10000];

  it('renders Home, Budgets, Insights and Profile clean at every balance', () => {
    for (const cash of balances) {
      const d: ScreenData = { ...noon(), budget: buildBudget({ ...SETTINGS, openingCashMinor: cash } as never, CATEGORIES, [], NOW) };
      for (const [name, El] of [['Home', Home], ['Budgets', Budgets], ['Insights', Insights], ['Profile', Profile]] as const) {
        const { container } = render(<El {...d} />);
        const text = (container.textContent ?? '').replace(/\s+/g, ' ');
        const negatives = text.match(/-\s?£[\d,]+(\.\d\d)?/g) ?? [];
        expect(negatives, `${name} at £${cash / 100}: ${negatives.join(', ')}`).toEqual([]);
        cleanup();
      }
    }
  });
});
