import { describe, expect, it } from 'vitest';
import { flowFields, billFields, type Category, type Transaction } from '@spendwise/shared-types';
import { buildBudget, cycleSettingsOf, budgetStartOf, nextDuePot, potOf, isPot } from './model.js';
import { cycleFor } from './cycle.js';

const NOW = new Date('2026-08-25T12:00:00');
let n = 0;
const id = (): string => `0199${(++n).toString(16).padStart(4, '0')}-0000-7000-8000-000000000000`;

const cat = (over: Partial<Category> = {}): Category => ({
  local_id: id(), server_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
  deleted_at: null, sync_status: 'synced', version: 1, device_id: 'd',
  name: 'Groceries', icon: 'groceries', colour: '#93bfb2', limit_minor: 9000,
  is_fixed: false, due_day: null, ...flowFields(), ...over,
});
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  local_id: id(), server_id: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
  deleted_at: null, sync_status: 'synced', version: 1, device_id: 'd',
  category_id: null, bank_id: null, amount_minor: -1000, currency: 'GBP',
  base_minor: -1000, base_currency: 'GBP', fx_rate: 1, fx_rate_date: '2026-08-25',
  fx_provisional: false, merchant: 'Shop', note: null,
  occurred_at: NOW.toISOString(), is_income: false, is_transfer: false, pending: false, ...over,
});

const weekly = {
  cycleKind: 'days' as const, cycleLengthDays: 7, cycleAnchorDate: '2026-08-07',
  cycleAnchorDay: null, expectedIncomeMinor: 50000, budgetStartDate: '2026-08-07',
  openingCashMinor: 0,
};

describe('cycleSettingsOf', () => {
  it('reads a weekly cycle', () => {
    expect(cycleSettingsOf(weekly)).toEqual({ kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' });
  });

  it('falls back to monthly rather than trusting a half-written cycle', () => {
    // A days-cycle with no anchor makes every boundary meaningless, so it must
    // not reach cycleFor at all.
    const broken = { ...weekly, cycleAnchorDate: null };
    expect(cycleSettingsOf(broken)).toEqual({ kind: 'monthly', anchorDay: 1 });
  });
});

describe('isPot / potOf', () => {
  it('treats a pre-migration fixed cost as a monthly bill', () => {
    // Local data written before 008 has is_fixed but no kind. It must still
    // produce a pot with a usable due date rather than something un-accruable.
    const legacy = { ...cat({ name: 'Rent', is_fixed: true, limit_minor: 65000 }), kind: 'flow' as const };
    expect(isPot(legacy)).toBe(true);
    const p = potOf(legacy);
    expect(p.kind).toBe('bill');
    expect(p.recurrence).toBe('monthly');
    expect(p.anchorDate).toBeTruthy();
  });

  it('reads a goal with no deadline without inventing one', () => {
    const g = cat({ name: 'Coat', kind: 'pot', pot_kind: 'goal', limit_minor: 18000 });
    expect(potOf(g)).toEqual({ id: g.local_id, name: 'Coat', amountMinor: 18000, kind: 'goal' });
  });
});

describe('budgetStartOf', () => {
  const cyc = cycleFor(NOW, { kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' });

  it('uses the configured date when there is one', () => {
    expect(budgetStartOf(weekly, cyc).toDateString())
      .toBe(new Date('2026-08-07T00:00:00').toDateString());
  });

  it('starts at the current cycle rather than backdating, so no pot is credited with money nobody saved', () => {
    /*
     * Accruals REPLAY from this date. Falling back to the earliest transaction
     * would hand an account with months of history a fully funded rent pot
     * that has nothing behind it — an app inventing savings is the worst thing
     * a budgeting app can do.
     */
    const start = budgetStartOf({ ...weekly, budgetStartDate: null }, cyc);
    expect(start.getTime()).toBe(cyc.start.getTime());
  });

  it('gives a backdated account zero pot balance, not a fabricated one', () => {
    const rent = cat({ name: 'Rent', limit_minor: 65000, is_fixed: true,
      ...billFields('monthly', '2026-09-01') });
    const old = tx({ occurred_at: '2026-02-01T09:00:00' });
    const b = buildBudget({ ...weekly, budgetStartDate: null }, [rent], [old], NOW);
    /*
     * One cycle of reservation, not six months of it. Backdating the start
     * would replay every cycle since and report a pot that had been quietly
     * filling all along — savings the account never had.
     */
    expect(b.pots[0]!.balanceMinor).toBe(b.pots[0]!.perCycleMinor);
  });
});

describe('buildBudget', () => {
  const rent = cat({
    name: 'Rent', limit_minor: 65000, is_fixed: true,
    ...billFields('monthly', '2026-09-01'),
  });
  const groceries = cat({ name: 'Groceries', limit_minor: 9000 });

  it('splits categories into pots and flows', () => {
    const b = buildBudget(weekly, [rent, groceries], [], NOW);
    expect(b.pots).toHaveLength(1);
    expect(b.flows).toHaveLength(1);
    expect(b.pots[0]!.pot.name).toBe('Rent');
  });

  it('accrues the bill toward its due date', () => {
    const b = buildBudget(weekly, [rent], [], NOW);
    // Three Fridays 7-21 Aug have passed; rent lands 1 Sep. It reserves as it
    // goes, and this cycle's reservation is what comes off spending money.
    expect(b.pots[0]!.balanceMinor).toBeGreaterThan(0);
    expect(b.summary.billDemandMinor).toBe(b.pots[0]!.perCycleMinor);
  });

  it('counts income that landed inside the current cycle only', () => {
    const b = buildBudget(weekly, [], [
      tx({ is_income: true, is_transfer: false, amount_minor: 50000, base_minor: 50000, occurred_at: '2026-08-21T09:00:00' }),
      tx({ is_income: true, is_transfer: false, amount_minor: 50000, base_minor: 50000, occurred_at: '2026-08-14T09:00:00' }),
    ], NOW);
    expect(b.summary.actualIncomeMinor).toBe(50000);
  });

  it('ignores deleted rows everywhere', () => {
    const b = buildBudget(weekly, [{ ...groceries, deleted_at: NOW.toISOString() }],
      [tx({ category_id: groceries.local_id, deleted_at: NOW.toISOString() })], NOW);
    expect(b.flows).toHaveLength(0);
  });

  it('charges spend to its own flow and nothing else', () => {
    const other = cat({ name: 'Fuel', limit_minor: 4500 });
    const b = buildBudget(weekly, [groceries, other],
      [tx({ category_id: groceries.local_id, amount_minor: -2500, base_minor: -2500 })], NOW);
    expect(b.flows.find((f) => f.flow.name === 'Groceries')!.spentMinor).toBe(2500);
    expect(b.flows.find((f) => f.flow.name === 'Fuel')!.spentMinor).toBe(0);
  });
});

describe('nextDuePot', () => {
  it('picks the soonest bill and ignores savings', () => {
    const soon = cat({ name: 'Energy', limit_minor: 8500, ...billFields('monthly', '2026-08-28') });
    const later = cat({ name: 'Rent', limit_minor: 65000, ...billFields('monthly', '2026-09-01') });
    const save = cat({ name: 'Savings', kind: 'pot', pot_kind: 'saving', recurrence: 'monthly', limit_minor: 20000 });
    const b = buildBudget(weekly, [later, soon, save], [], NOW);
    expect(nextDuePot(b.pots)!.pot.name).toBe('Energy');
  });

  it('is null when nothing is dated', () => {
    expect(nextDuePot([])).toBeNull();
  });
});
