import { describe, expect, it } from 'vitest';
import { buildBudget } from './model.js';
import { useApp } from '../../core/store.js';
import type { Category, Transaction } from '@spendwise/shared-types';

/**
 * The case the whole cash model exists for.
 *
 * Someone joins on a Tuesday with £200 in their pocket and is paid £500 on
 * Fridays. Rent is £650, due on the 1st.
 *
 * Before this, the app back-dated to the previous Friday, took the £500
 * expected wage on faith and planned around it — money that had already been
 * spent before they ever opened the app. Nothing asked what they had.
 */

const cat = (o: Partial<Category> & { local_id: string; name: string }): Category => ({
  icon: 'other', colour: '#888888', limit_minor: 0, is_fixed: false,
  kind: 'flow', pot_kind: null, recurrence: null, anchor_date: null, target_date: null,
  opening_minor: 0, due_day: null, version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Category);

const tx = (o: Partial<Transaction> & { local_id: string; occurred_at: string; amount_minor: number }): Transaction => ({
  category_id: null, bank_id: null, currency: 'GBP', base_minor: o.amount_minor,
  base_currency: 'GBP', fx_rate: 1, fx_rate_date: o.occurred_at.slice(0, 10), fx_provisional: false,
  merchant: null, note: null, is_income: false, is_transfer: false, pending: false,
  version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Transaction);

const SETTINGS = {
  cycleKind: 'days' as const, cycleLengthDays: 7, cycleAnchorDate: '2026-08-28',
  cycleAnchorDay: null, expectedIncomeMinor: 50000,
  budgetStartDate: '2026-08-25',      // the Tuesday they joined
  openingCashMinor: 20000,            // …with £200
};
const CATS = [
  cat({ local_id: 'food', name: 'Food', limit_minor: 12000 }),
  cat({ local_id: 'rent', name: 'Rent', is_fixed: true, kind: 'pot', pot_kind: 'bill',
        limit_minor: 65000, recurrence: 'monthly', anchor_date: '2026-10-01' }),
];

describe('joins Tuesday with £200, paid Friday', () => {
  it('plans from the £200 they have, not the £500 they will get', () => {
    const b = buildBudget(SETTINGS, CATS, [], new Date('2026-08-25T12:00:00'));
    expect(b.cash.totalMinor).toBe(20000);
    // Never more than what is actually held, whatever the wage forecast says.
    expect(b.summary.availableMinor).toBeLessThanOrEqual(20000);
    /* Rent of £650 falls due on 1 Sep, so £325 is reserved this cycle — more
       than the £200 held. The reservation caps at what exists, spendable
       floors at zero, and the £125 the balance cannot back is reported. */
    expect(b.summary.reservedMinor).toBe(20000);
    expect(b.summary.freeCashMinor).toBe(0);
    expect(b.summary.cashShortfallMinor).toBe(12500);
  });

  it('spends down from that £200 as the week goes on', () => {
    const spent = [tx({ local_id: 'a', occurred_at: '2026-08-26T10:00:00', amount_minor: -3000, category_id: 'food' })];
    const b = buildBudget(SETTINGS, CATS, spent, new Date('2026-08-26T18:00:00'));
    expect(b.cash.totalMinor).toBe(17000);
  });

  it('adds Friday\'s actual wage to what was left, not to what was assumed', () => {
    const txs = [
      tx({ local_id: 'a', occurred_at: '2026-08-26T10:00:00', amount_minor: -15000, category_id: 'food' }),
      // Paid £480, not the £500 expected.
      tx({ local_id: 'pay', occurred_at: '2026-08-28T09:00:00', amount_minor: 48000, is_income: true }),
    ];
    const b = buildBudget(SETTINGS, CATS, txs, new Date('2026-08-29T12:00:00'));
    // £200 − £150 = £50 carried, + £480 = £530.
    expect(b.cash.broughtForwardMinor).toBe(5000);
    expect(b.cash.totalMinor).toBe(53000);
  });

  it('carries an overspend forward as debt against the next wage', () => {
    const txs = [
      tx({ local_id: 'a', occurred_at: '2026-08-26T10:00:00', amount_minor: -26000, category_id: 'food' }),
      tx({ local_id: 'pay', occurred_at: '2026-08-28T09:00:00', amount_minor: 50000, is_income: true }),
    ];
    const b = buildBudget(SETTINGS, CATS, txs, new Date('2026-08-29T12:00:00'));
    expect(b.cash.broughtForwardMinor).toBe(-6000);   // £60 in the red
    expect(b.cash.totalMinor).toBe(44000);            // the debt comes off the wage
  });
});

describe('an account that never said what it holds', () => {
  const BLIND = { ...SETTINGS, openingCashMinor: 0, budgetStartDate: null };

  it('knows that it does not know', () => {
    const spent = [tx({ local_id: 'a', occurred_at: '2026-08-25T10:00:00', amount_minor: -143185, category_id: 'food' })];
    const b = buildBudget(BLIND, CATS, spent, new Date('2026-08-25T18:00:00'));
    expect(b.summary.cashKnown).toBe(false);
    /*
     * The headline falls back to the limits rather than being dragged down to
     * a cash figure that is really just ignorance. The real account this comes
     * from reported −£1,431.85 available and −£477.29 a day while being fine.
     */
    /* With nothing known about the balance, the headline comes from the
       limits alone — never from a cash figure that is really just ignorance. */
    const s = b.summary;
    expect(s.availableMinor).toBe(s.flowAllowanceMinor + s.flowRolloverMinor - s.flowSpentMinor);
  });

  it('learns it from an opening figure', () => {
    const b = buildBudget({ ...BLIND, openingCashMinor: 20000 }, CATS, [], new Date('2026-08-25T12:00:00'));
    expect(b.summary.cashKnown).toBe(true);
  });

  it('learns it from logged income, without being told', () => {
    const pay = tx({ local_id: 'pay', occurred_at: '2026-08-25T09:00:00', amount_minor: 50000, is_income: true });
    const b = buildBudget(BLIND, CATS, [pay], new Date('2026-08-25T12:00:00'));
    expect(b.summary.cashKnown).toBe(true);
  });

  it('ignores a deleted income row when deciding', () => {
    const gone = tx({ local_id: 'x', occurred_at: '2026-08-25T09:00:00', amount_minor: 50000,
                      is_income: true, deleted_at: '2026-08-25T10:00:00' });
    const b = buildBudget(BLIND, CATS, [gone], new Date('2026-08-25T12:00:00'));
    expect(b.summary.cashKnown).toBe(false);
  });
});

describe('the same pound cannot be offered twice', () => {
  it('holds back what the bills still need before offering the rest', () => {
    /*
     * £200 in hand, with rent still to be contributed to this cycle. Whatever
     * the spending limits say, the money owed to rent is not available to
     * spend — otherwise the app offers the same pound as groceries AND as the
     * rent contribution, and one of those promises has to break.
     */
    const b = buildBudget(SETTINGS, CATS, [], new Date('2026-08-25T12:00:00'));
    /* Reserved automatically, so it is already out of free cash — the app
       cannot then offer it as spending money as well. */
    expect(b.summary.reservedMinor).toBeGreaterThan(0);
    expect(b.summary.availableMinor).toBeLessThanOrEqual(b.summary.freeCashMinor);
  });

  it('frees that money up again once it has been set aside', () => {
    const before = buildBudget(SETTINGS, CATS, [], new Date('2026-08-25T12:00:00'));
    const owed = before.pots.find((p) => p.pot.id === 'rent')!.outstandingMinor;
    const put = tx({ local_id: 'set', occurred_at: '2026-08-25T13:00:00',
                     amount_minor: owed, category_id: 'rent', is_transfer: true });
    const after = buildBudget(SETTINGS, CATS, [put], new Date('2026-08-25T14:00:00'));
    /* Confirming the move settles the reminder and nothing else: the money was
       already reserved, so what is spendable cannot change. Were it to rise,
       the app would be handing back the very money it just told you to save. */
    expect(after.pots.find((p) => p.pot.id === 'rent')!.outstandingMinor).toBe(0);
    expect(after.summary.freeCashMinor).toBe(before.summary.freeCashMinor);
    expect(after.summary.availableMinor).toBe(before.summary.availableMinor);
  });
});

describe('setting money aside', () => {
  const pay = tx({ local_id: 'pay', occurred_at: '2026-08-28T09:00:00', amount_minor: 60000, is_income: true });

  it('reserves a share of rent each payday without being asked', () => {
    const b = buildBudget(SETTINGS, CATS, [pay], new Date('2026-08-29T12:00:00'));
    const rent = b.pots.find((p) => p.pot.id === 'rent')!;
    expect(rent.perCycleMinor).toBeGreaterThan(0);
    expect(rent.balanceMinor).toBeGreaterThan(0);        // filled by itself
    expect(rent.outstandingMinor).toBe(rent.perCycleMinor);  // still to move
  });

  it('records a confirmed move without changing the reservation', () => {
    const b0 = buildBudget(SETTINGS, CATS, [pay], new Date('2026-08-29T12:00:00'));
    const asked = b0.pots.find((p) => p.pot.id === 'rent')!.perCycleMinor;
    const put = tx({ local_id: 'set', occurred_at: '2026-08-29T10:00:00',
                     amount_minor: asked, category_id: 'rent', is_transfer: true });
    const b = buildBudget(SETTINGS, CATS, [pay, put], new Date('2026-08-29T12:00:00'));
    const rent = b.pots.find((p) => p.pot.id === 'rent')!;
    expect(rent.contributedMinor).toBe(asked);
    expect(rent.outstandingMinor).toBe(0);                       // reminder done
    expect(rent.balanceMinor).toBe(b0.pots.find((p) => p.pot.id === 'rent')!.balanceMinor);
  });

  it('does not count moving money as spending it', () => {
    const put = tx({ local_id: 'set', occurred_at: '2026-08-29T10:00:00',
                     amount_minor: 9000, category_id: 'rent', is_transfer: true });
    const without = buildBudget(SETTINGS, CATS, [pay], new Date('2026-08-29T12:00:00'));
    const with_ = buildBudget(SETTINGS, CATS, [pay, put], new Date('2026-08-29T12:00:00'));
    expect(with_.cash.totalMinor).toBe(without.cash.totalMinor);
    expect(with_.summary.freeCashMinor).toBe(without.summary.freeCashMinor);
  });

  it('empties the pot when the bill is finally paid', () => {
    const paid = tx({ local_id: 'rentpaid', occurred_at: '2026-09-01T09:00:00',
                      amount_minor: -65000, category_id: 'rent' });
    const b = buildBudget(SETTINGS, CATS, [pay, paid], new Date('2026-09-02T12:00:00'));
    const rent = b.pots.find((p) => p.pot.id === 'rent')!;
    // Drawn down by the payment rather than left showing the bill as funded.
    const unpaid = buildBudget(SETTINGS, CATS, [pay], new Date('2026-09-02T12:00:00'));
    expect(rent.balanceMinor).toBeLessThan(
      unpaid.pots.find((p) => p.pot.id === 'rent')!.balanceMinor);
  });
});



describe('the set-aside written by the app itself', () => {
  /*
   * The unit tests above build transfer rows by hand, which quietly assumed a
   * sign convention the store did not share: every non-income row was stored
   * as −abs, so a set-aside SUBTRACTED from the pot it was meant to fill and
   * the balance clamped at zero. Nothing visibly happened, and no test noticed
   * because none of them went through the code that actually writes the row.
   */
  it('goes in positive, so it fills the pot rather than draining it', async () => {
    const written: Transaction[] = [];
    const db = {
      put: async (_: string, rec: Transaction) => { written.push(rec); },
    } as never;
    useApp.setState({ baseCurrency: 'GBP', deviceId: 'test', transactions: [] });

    await useApp.getState().addTransaction(db, {
      amountMinor: 12000, currency: 'GBP', categoryId: 'rent', bankId: null,
      merchant: 'Set aside for Rent', isIncome: false, isTransfer: true,
    });

    const row = written[0]!;
    expect(row.is_transfer).toBe(true);
    expect(row.is_income).toBe(false);
    expect(row.amount_minor).toBe(12000);        // NOT −12000

    /* It is recorded as a move, not as a top-up: the pot reserves on its own,
       so adding the transfer as well would count the same money twice. */
    const b = buildBudget(SETTINGS, CATS, [row], new Date('2026-08-29T12:00:00'));
    expect(b.pots.find((p) => p.pot.id === 'rent')!.contributedMinor).toBe(12000);
  });

  it('still stores ordinary spending as negative', async () => {
    const written: Transaction[] = [];
    const db = { put: async (_: string, rec: Transaction) => { written.push(rec); } } as never;
    useApp.setState({ baseCurrency: 'GBP', deviceId: 'test', transactions: [] });

    await useApp.getState().addTransaction(db, {
      amountMinor: 3000, currency: 'GBP', categoryId: 'food', bankId: null,
      merchant: 'Tesco', isIncome: false,
    });
    expect(written[0]!.amount_minor).toBe(-3000);
    expect(written[0]!.is_transfer).toBe(false);
  });
});
