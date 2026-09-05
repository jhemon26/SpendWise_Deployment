import { describe, expect, it } from 'vitest';
import { summarise, type SummaryInput } from './summary.js';
import { cycleFor, type CycleSettings } from './cycle.js';
import type { PotState } from './pots.js';
import type { FlowState } from './flows.js';

const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-08-07' };
const cycle = cycleFor(new Date('2026-08-25T12:00:00'), weekly);   // day 5 of 7

/** Nothing contributed yet, so the whole recommendation is still outstanding. */
const pot = (kind: 'bill' | 'saving' | 'goal', perCycleMinor: number, contributedMinor = 0): PotState => ({
  pot: { id: kind, name: kind, kind, amountMinor: 0 },
  balanceMinor: contributedMinor, backedMinor: contributedMinor, perCycleMinor, contributedMinor,
  outstandingMinor: Math.max(0, perCycleMinor - contributedMinor),
  nextDue: null, neededMinor: 0, cyclesUntilDue: 0,
});
const flow = (allowanceMinor: number, rolloverMinor = 0, spentMinor = 0): FlowState => ({
  flow: { id: 'f', name: 'f', limitMinor: allowanceMinor },
  allowanceMinor, rolloverMinor, spentMinor,
  availableMinor: allowanceMinor + rolloverMinor - spentMinor, pctUsed: 0,
});
/*
 * Cash defaults high on purpose.
 *
 * Most of these cases are about how income is divided up, and the cash ceiling
 * is a separate rule. Leaving cash ample keeps it out of the way here; the
 * cases where cash IS the binding constraint set it explicitly, and live in
 * their own block at the bottom.
 */
const base = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  cycle, pots: [], flows: [], expectedIncomeMinor: 50000, actualIncomeMinor: 50000,
  cashTotalMinor: 10_000_00, potBalanceMinor: 0, cashKnown: true, ...over,
});

describe('a normal cycle', () => {
  it('funds every pot and leaves the rest spendable', () => {
    const s = summarise(base({ pots: [pot('bill', 21950), pot('saving', 4600)] }));
    expect(s.potDemandMinor).toBe(26550);
    expect(s.spendableMinor).toBe(23450);
    expect(s.billsUnfundedMinor).toBe(0);
    expect(s.saveUnfundedMinor).toBe(0);
  });

  it('counts goals with savings, not with bills', () => {
    // Both are money chosen to put by; both yield before a direct debit does.
    const s = summarise(base({ pots: [pot('bill', 10000), pot('goal', 2250)] }));
    expect(s.billDemandMinor).toBe(10000);
    expect(s.saveDemandMinor).toBe(2250);
  });
});

describe('a short week', () => {
  it('takes it out of spending money first', () => {
    // £430 instead of £500: bills and savings still funded, spending absorbs it.
    const s = summarise(base({ actualIncomeMinor: 43000, pots: [pot('bill', 21950), pot('saving', 4600)] }));
    expect(s.billsUnfundedMinor).toBe(0);
    expect(s.saveUnfundedMinor).toBe(0);
    expect(s.spendableMinor).toBe(16450);
    expect(s.incomeVarianceMinor).toBe(-7000);
  });

  it('skips savings before it touches the bills', () => {
    // £230 covers the £219.50 of bills but not the £46 savings.
    const s = summarise(base({ actualIncomeMinor: 23000, pots: [pot('bill', 21950), pot('saving', 4600)] }));
    expect(s.billsUnfundedMinor).toBe(0);
    expect(s.saveUnfundedMinor).toBe(3550);
    expect(s.spendableMinor).toBe(0);
  });

  it('says plainly when the bills themselves cannot be met', () => {
    // A missed direct debit has consequences a missed coffee does not, so this
    // is the one number that must never be quietly absorbed.
    const s = summarise(base({ actualIncomeMinor: 15000, pots: [pot('bill', 21950), pot('saving', 4600)] }));
    expect(s.billsUnfundedMinor).toBe(6950);
    expect(s.saveUnfundedMinor).toBe(4600);
    expect(s.spendableMinor).toBe(0);
  });

  it('never reports negative spendable money', () => {
    const s = summarise(base({ actualIncomeMinor: 0, expectedIncomeMinor: 0, pots: [pot('bill', 21950)] }));
    expect(s.spendableMinor).toBe(0);
  });
});

describe('income that has not arrived yet', () => {
  it('falls back to the expectation rather than showing a cliff', () => {
    // Mid-cycle, before payday, nothing has landed. Showing £0 spendable and
    // then jumping on Friday would make the screen useless for four days.
    const s = summarise(base({ actualIncomeMinor: 0, pots: [pot('bill', 21950)] }));
    expect(s.workingIncomeMinor).toBe(50000);
    expect(s.spendableMinor).toBe(28050);
  });

  it('switches to the real figure once money lands', () => {
    const s = summarise(base({ actualIncomeMinor: 52500 }));
    expect(s.workingIncomeMinor).toBe(52500);
    expect(s.incomeVarianceMinor).toBe(2500);
  });
});

describe('overcommitment', () => {
  it('flags limits that add up to more than is left after commitments', () => {
    // £234.50 spendable but £300 of category limits — the plan cannot hold,
    // and that is a statement about the setup, not about this week.
    const s = summarise(base({ pots: [pot('bill', 26550)], flows: [flow(30000)] }));
    expect(s.spendableMinor).toBe(23450);
    expect(s.overcommittedMinor).toBe(6550);
  });

  it('is zero when the limits fit', () => {
    expect(summarise(base({ pots: [pot('bill', 26550)], flows: [flow(21300)] })).overcommittedMinor).toBe(0);
  });
});

describe('what is left to spend', () => {
  it('adds rollover and subtracts what has gone', () => {
    const s = summarise(base({ flows: [flow(21300, 1600, 12830)] }));
    expect(s.availableMinor).toBe(10070);
  });

  it('floors the daily figure so it is never a penny it cannot pay', () => {
    const s = summarise(base({ flows: [flow(10000)] }));   // 3 days left
    expect(s.perDayMinor).toBe(3333);
  });

  it('does not divide by zero on the last day', () => {
    const last = cycleFor(new Date('2026-08-27T12:00:00'), weekly);
    expect(last.daysLeft).toBe(1);
    expect(summarise(base({ cycle: last, flows: [flow(5000)] })).perDayMinor).toBe(5000);
  });
});

describe('an account that has not said what it earns', () => {
  it('stays silent rather than raising every alarm at once', () => {
    // Zero income makes the bills "unfunded" and every limit "overcommitted".
    // Both would be false alarms on an account that simply has not been set up.
    const s = summarise(base({
      expectedIncomeMinor: 0, actualIncomeMinor: 0,
      pots: [pot('bill', 21950)], flows: [flow(21300)],
    }));
    expect(s.billsUnfundedMinor).toBe(0);
    expect(s.overcommittedMinor).toBe(0);
  });

  it('still reports what is left to spend, which does not depend on income', () => {
    const s = summarise(base({
      expectedIncomeMinor: 0, actualIncomeMinor: 0, flows: [flow(21300, 0, 5000)],
    }));
    expect(s.availableMinor).toBe(16300);
  });
});

describe('the headline cannot promise money that is not there', () => {
  it('is bounded by what is spendable, not by the limits', () => {
    // £500 in, £480 of commitments, but £1,030 of category limits. Leading with
    // the limits offered £1,030 to spend directly above a warning that none of
    // it existed.
    const s = summarise(base({
      actualIncomeMinor: 50000,
      pots: [pot('bill', 48000)],
      flows: [flow(103000)],
    }));
    expect(s.spendableMinor).toBe(2000);
    expect(s.availableMinor).toBe(2000);
    expect(s.overcommittedMinor).toBe(101000);
  });

  it('uses the limits when they fit inside what is spendable', () => {
    const s = summarise(base({ pots: [pot('bill', 20000)], flows: [flow(21300)] }));
    expect(s.availableMinor).toBe(21300);
    expect(s.overcommittedMinor).toBe(0);
  });

  it('falls back to the limits when income is unknown', () => {
    const s = summarise(base({
      expectedIncomeMinor: 0, actualIncomeMinor: 0, flows: [flow(21300)],
    }));
    expect(s.availableMinor).toBe(21300);
  });

  it('still subtracts what has been spent and adds what was carried', () => {
    const s = summarise(base({
      actualIncomeMinor: 50000, pots: [pot('bill', 20000)], flows: [flow(21300, 1600, 5000)],
    }));
    expect(s.availableMinor).toBe(17900);
  });
});


describe('reserving is automatic; moving it is hygiene', () => {
  it('does not hand the money back when a transfer is confirmed', () => {
    /*
     * Reserving happens the moment income lands, so the bill's claim on this
     * cycle is the same whether or not the person has physically shifted the
     * money to a savings account. Basing demand on "what is still to move"
     * meant pressing Done gave the money straight back as spendable — the app
     * rewarding you for saving by letting you spend it again.
     */
    const notMoved = summarise(base({ pots: [pot('bill', 9000, 0)], flows: [flow(20000)] }));
    const moved = summarise(base({ pots: [pot('bill', 9000, 9000)], flows: [flow(20000)] }));
    expect(moved.billDemandMinor).toBe(notMoved.billDemandMinor);
    expect(moved.spendableMinor).toBe(notMoved.spendableMinor);
  });

  it('still holds the full reservation back from spending money', () => {
    const s = summarise(base({ pots: [pot('bill', 9000)], flows: [flow(20000)] }));
    expect(s.billDemandMinor).toBe(9000);
    expect(s.spendableMinor).toBe(50000 - 9000);
  });

  it('reports a shortfall when the plan outruns the cash', () => {
    // £250 of reservations against £100 held.
    const s = summarise(base({
      pots: [pot('bill', 25000)], flows: [flow(20000)],
      cashTotalMinor: 35000, potBalanceMinor: 25000, cashKnown: true,
    }));
    expect(s.freeCashMinor).toBe(10000);
    expect(s.cashShortfallMinor).toBe(0);

    const short = summarise(base({
      pots: [pot('bill', 25000)], flows: [flow(20000)],
      cashTotalMinor: 20000, potBalanceMinor: 25000, cashKnown: true,
    }));
    // Free cash floors at zero: you cannot spend a shortfall.
    expect(short.freeCashMinor).toBe(0);
    expect(short.reservedMinor).toBe(20000);   // capped at what is held
    expect(short.cashShortfallMinor).toBe(5000);
  });
});



describe('an account that has not said what it holds', () => {
  it('does not report spending as debt', () => {
    /*
     * A real account: monthly, £2,000 expected, £1,431.85 spent, no income
     * ever logged and no opening balance. Treating the unknown as zero made
     * the ledger read −£1,431.85 and the headline offer −£477.29 a day, on an
     * account that was perfectly fine. Not knowing is not the same as knowing
     * it is nothing.
     */
    const s = summarise(base({
      flows: [flow(200000)], cashTotalMinor: -143185, potBalanceMinor: 0, cashKnown: false,
    }));
    expect(s.availableMinor).toBeGreaterThan(0);
    expect(s.cashKnown).toBe(false);
  });

  it('does bound the headline once it knows', () => {
    const s = summarise(base({
      flows: [flow(200000)], cashTotalMinor: 5000, potBalanceMinor: 0, cashKnown: true,
    }));
    expect(s.availableMinor).toBe(5000);
  });
});
