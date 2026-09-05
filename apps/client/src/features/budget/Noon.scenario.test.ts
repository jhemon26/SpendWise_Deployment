import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '@spendwise/shared-types';
import { buildBudget } from './model.js';
import type { Budget } from './model.js';

/*
 * One real account, walked forward through every action it supports.
 *
 * Noon: paid £450 weekly on a Friday, signed up Mon 31 Aug with three bills
 * and eight day-to-day categories. Every figure below was read off the engine,
 * not assumed — the point is to catch the next contradiction the way the last
 * few were caught, by making two screens' worth of numbers agree in one place.
 */

const cat = (o: Partial<Category> & { local_id: string; name: string }): Category => ({
  icon: 'x', colour: '#fff', limit_minor: 0, is_fixed: false, kind: 'flow',
  pot_kind: null, recurrence: null, anchor_date: null, target_date: null,
  opening_minor: 0, due_day: null, version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Category);

const bill = (id: string, n: string, m: number, d: number): Category =>
  cat({ local_id: id, name: n, limit_minor: m, is_fixed: true, kind: 'pot', pot_kind: 'bill',
    recurrence: 'monthly', anchor_date: `2026-08-${d}`, due_day: d });

const CATS: Category[] = [
  cat({ local_id: 'gr', name: 'Groceries', limit_minor: 25000 }),
  cat({ local_id: 'eo', name: 'Eating out', limit_minor: 5000 }),
  cat({ local_id: 'tr', name: 'Transport', limit_minor: 16000 }),
  cat({ local_id: 'ho', name: 'Home', limit_minor: 40000 }),
  bill('ph', 'Phone', 3000, 20),
  bill('cf', 'Car finance', 17000, 18),
  bill('in', 'Insurance', 16000, 15),
];

let seq = 0;
const tx = (o: Partial<Transaction> & { occurred_at: string; amount_minor: number }): Transaction => ({
  local_id: `t${seq++}`, category_id: null, bank_id: null, currency: 'GBP',
  base_minor: o.amount_minor, base_currency: 'GBP', fx_rate: 1, fx_rate_date: '2026-08-31',
  fx_provisional: false, merchant: null, note: null, is_income: false, is_transfer: false,
  pending: false, version: 1, created_at: '', updated_at: '', deleted_at: null, ...o,
} as Transaction);

const spend = (day: string, cat: string, minor: number): Transaction =>
  tx({ occurred_at: `${day}T10:00:00`, amount_minor: -minor, category_id: cat });
const income = (day: string, minor: number): Transaction =>
  tx({ occurred_at: `${day}T09:00:00`, amount_minor: minor, is_income: true });
const putAside = (day: string, cat: string, minor: number): Transaction =>
  tx({ occurred_at: `${day}T09:30:00`, amount_minor: minor, category_id: cat, is_transfer: true });

const SETTINGS = {
  cycleKind: 'days', cycleLengthDays: 7, cycleAnchorDate: '2026-08-28',
  expectedIncomeMinor: 45000, budgetStartDate: '2026-08-31',
};

const at = (day: string, txs: Transaction[], cash = 10000): Budget =>
  buildBudget({ ...SETTINGS, openingCashMinor: cash } as never, CATS, txs, new Date(`${day}T20:00:00`));

/**
 * What must hold on every account, on every day, after every action.
 *
 * These are the rules the reported bugs each broke, turned into one gate so
 * that breaking any of them again fails here rather than on someone's phone.
 */
function invariants(b: Budget, where: string): void {
  const s = b.summary;
  const m = (n: number): string => `${where}: ${n}`;

  /* Money you are told you can spend must exist. This is the one the app got
     wrong on an empty account, offering £329.99 against a wage not yet paid. */
  if (s.cashKnown) {
    expect(s.availableMinor, m(s.availableMinor)).toBeLessThanOrEqual(s.freeCashMinor);
    expect(s.availableMinor, m(s.availableMinor)).toBeLessThanOrEqual(Math.max(0, s.cashTotalMinor));
  }
  /* A daily allowance is a promise; it is never negative and never rounds up. */
  expect(s.perDayMinor, m(s.perDayMinor)).toBeGreaterThanOrEqual(
    Math.min(0, s.availableMinor),
  );
  if (s.availableMinor >= 0) expect(s.perDayMinor).toBeGreaterThanOrEqual(0);
  /* Reserved and free are the two halves of what is held — no third bucket. */
  expect(s.reservedMinor + s.freeCashMinor).toBe(Math.max(0, s.cashTotalMinor));
  /* Nothing is "set aside" that the account does not hold. */
  const backed = b.pots.reduce((t, p) => t + p.backedMinor, 0);
  expect(backed, m(backed)).toBeLessThanOrEqual(Math.max(0, s.cashTotalMinor));
  for (const p of b.pots) {
    expect(p.backedMinor).toBeGreaterThanOrEqual(0);
    expect(p.backedMinor).toBeLessThanOrEqual(p.balanceMinor);
    /* A bill's next due date is always ahead of now — never a stale one. */
    if (p.pot.kind === 'bill' && p.nextDue) {
      expect(p.nextDue.getTime(), `${where}: ${p.pot.name} due in the past`)
        .toBeGreaterThan(new Date(`${where.slice(0, 10)}T00:00:00`).getTime() - 1);
    }
  }
}

describe('Noon, day by day', () => {
  it('holds every invariant across a full cycle of real actions', () => {
    const txs: Transaction[] = [];
    const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03',
      '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
    const actions: Record<string, () => void> = {
      '2026-09-01': () => txs.push(spend('2026-09-01', 'gr', 1250)),
      '2026-09-02': () => txs.push(spend('2026-09-02', 'tr', 3000)),
      '2026-09-04': () => { txs.push(income('2026-09-04', 45000)); txs.push(putAside('2026-09-04', 'in', 5334)); },
      '2026-09-05': () => txs.push(spend('2026-09-05', 'eo', 4500)),
      '2026-09-06': () => txs.push(spend('2026-09-06', 'ho', 20000)),
    };
    for (const d of days) {
      actions[d]?.();
      invariants(at(d, txs), d);
    }
  });

  it('spends nothing it does not have, on an account holding nothing', () => {
    const b = at('2026-08-31', [], 0);
    expect(b.summary.cashKnown).toBe(true);          // £0 is an answer, not a silence
    expect(b.summary.availableMinor).toBe(0);
    expect(b.summary.perDayMinor).toBe(0);
    expect(b.pots.every((p) => p.backedMinor === 0)).toBe(true);
  });

  it('gives the money to the bill that lands first', () => {
    /* £50 against Insurance (15th), Car finance (18th) and Phone (20th). */
    const b = at('2026-08-31', [], 5000);
    const by = Object.fromEntries(b.pots.map((p) => [p.pot.name, p.backedMinor]));
    expect(by['Insurance']).toBe(5000);
    expect(by['Car finance']).toBe(0);
    expect(by['Phone']).toBe(0);
  });

  it('counts a payday as income, and a put-aside as neither in nor out', () => {
    const paid = [income('2026-09-04', 45000)];
    const moved = [...paid, putAside('2026-09-04', 'in', 5334)];
    const a = at('2026-09-04', paid);
    const c = at('2026-09-04', moved);
    /* Moving money between your own pockets changes no total. */
    expect(c.summary.cashTotalMinor).toBe(a.summary.cashTotalMinor);
    expect(c.summary.flowSpentMinor).toBe(a.summary.flowSpentMinor);
  });

  it('does not hand a funded bill back as spending money', () => {
    /* The regression this rule exists for: confirming the transfer once made
       the app think the bill no longer needed funding this cycle. */
    const before = at('2026-09-04', [income('2026-09-04', 45000)]);
    const after = at('2026-09-04', [income('2026-09-04', 45000), putAside('2026-09-04', 'in', 5334)]);
    expect(after.summary.availableMinor).toBeLessThanOrEqual(before.summary.availableMinor);
  });

  it('forgets a deleted transaction completely', () => {
    const live = spend('2026-09-01', 'gr', 1250);
    const dead = { ...live, deleted_at: '2026-09-02T10:00:00' } as Transaction;
    expect(at('2026-09-02', [dead]).summary.flowSpentMinor)
      .toBe(at('2026-09-02', []).summary.flowSpentMinor);
  });

  it('rolls the cycle over on payday without losing the ledger', () => {
    const txs = [spend('2026-09-01', 'gr', 1250), income('2026-09-04', 45000)];
    const before = at('2026-09-03', txs);
    const after = at('2026-09-04', txs);
    expect(before.cycle.start.getDate()).toBe(28);          // 28 Aug – 3 Sept
    expect(after.cycle.start.getDate()).toBe(4);            // 4 Sept – 10 Sept
    /* Last cycle's spending does not follow you into the new one. */
    expect(after.summary.flowSpentMinor).toBe(0);
    /* But the cash does: £100 opening − £12.50 + £450. */
    expect(after.summary.cashTotalMinor).toBe(10000 - 1250 + 45000);
  });

  it('never reports a bill as overdue when its next date is ahead', () => {
    /* Late in the month every bill's due day has passed, which is exactly when
       the calendar-month reading called all three "Overdue". */
    for (const p of at('2026-08-31', []).pots) {
      expect(p.nextDue!.getMonth(), p.pot.name).toBe(8);    // September
    }
  });
});
