// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Insights, type ScreenData } from './screens.js';
import { buildBudget } from '../features/budget/model.js';
import type { Category, Transaction } from '@spendwise/shared-types';

afterEach(cleanup);

const NOW = new Date('2026-08-26T12:00:00');           // cycle: Mon 24 – Sun 30
const SETTINGS = { cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-03', expectedIncomeMinor: 50000 };

const cat = (o: Partial<Category> & { local_id: string; name: string }): Category => ({
  icon: 'groceries', colour: '#F5822B', limit_minor: 20000, is_fixed: false,
  kind: 'flow', pot_kind: null, recurrence: null, anchor_date: null, target_date: null,
  opening_minor: 0, due_day: null, version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Category);

const tx = (o: Partial<Transaction> & { local_id: string; occurred_at: string }): Transaction => ({
  category_id: 'g', bank_id: null, amount_minor: -3000, currency: 'GBP',
  base_minor: -3000, base_currency: 'GBP', fx_rate: 1, fx_rate_date: '2026-08-25',
  fx_provisional: false, merchant: null, note: null, is_income: false, pending: false,
  version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Transaction);

function home(transactions: Transaction[]): ScreenData {
  const categories = [cat({ local_id: 'g', name: 'Groceries' })];
  return {
    categories, transactions, banks: [], currency: 'GBP', displayName: 'Jahid',
    dayToDayMinor: 20000, savingsTargetMinor: 0, now: NOW,
    budget: buildBudget(SETTINGS as never, categories, transactions, NOW),
    d: { byCategory: new Map() } as never, monthlyIncomeMinor: 50000, identities: [],
  } as ScreenData;
}

const marks = (c: HTMLElement): Element[] =>
  [...c.querySelectorAll('i[title]')].filter((e) => /^Last /.test(e.getAttribute('title') ?? ''));

describe('the previous-period mark', () => {
  it('is absent for a category that is new this cycle', () => {
    /*
     * The bug. The mark was drawn unconditionally, so a category with nothing
     * to compare against got a tick pinned at 0% — hard against the left edge
     * of the bar, reading as a rendering fault rather than a measurement.
     */
    const { container } = render(<Insights {...home([tx({ local_id: 'a', occurred_at: '2026-08-25T10:00:00' })])} />);
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
    expect(marks(container)).toHaveLength(0);
  });

  it('appears once there is a previous cycle to compare with', () => {
    const { container } = render(<Insights {...home([
      tx({ local_id: 'now', occurred_at: '2026-08-25T10:00:00' }),
      tx({ local_id: 'prev', occurred_at: '2026-08-18T10:00:00', amount_minor: -5000, base_minor: -5000 }),
    ])} />);
    const m = marks(container);
    expect(m).toHaveLength(1);
    expect(m[0]!.getAttribute('title')).toBe('Last week: £50.00');
  });

  it('places the mark relative to the biggest bar on the screen', () => {
    /* Analytics compares categories against each other, so the scale is the
       largest bar — not each category's own pool, which is Home's question. */
    const { container } = render(<Insights {...home([
      tx({ local_id: 'now', occurred_at: '2026-08-25T10:00:00' }),
      tx({ local_id: 'prev', occurred_at: '2026-08-18T10:00:00', amount_minor: -5000, base_minor: -5000 }),
    ])} />);
    expect((marks(container)[0] as HTMLElement).style.left).toBe('calc(100% - 1px)');
  });

  it('keeps a mark at the far end inside the track', () => {
    // £400 last week against a £200 pool clamps to 100%, not past it.
    const { container } = render(<Insights {...home([
      tx({ local_id: 'now', occurred_at: '2026-08-25T10:00:00' }),
      tx({ local_id: 'prev', occurred_at: '2026-08-18T10:00:00', amount_minor: -40000, base_minor: -40000 }),
    ])} />);
    expect((marks(container)[0] as HTMLElement).style.left).toBe('calc(100% - 1px)');
  });

  it('names the category beside its bar', () => {
    /* Analytics identifies rows by name and a colour dot rather than the full
       icon tile — it lists more categories in less space than Home did. */
    render(<Insights {...home([tx({ local_id: 'a', occurred_at: '2026-08-25T10:00:00' })])} />);
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
  });
});
