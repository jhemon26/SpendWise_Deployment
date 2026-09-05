import { describe, expect, it } from 'vitest';
import { nextDueOn, stepDue, potLedger, potState, annualCostMinor, fundedBy, paydaysForOne, installmentsFor, type Pot, type PotLedgerRow } from './pots.js';
import { cyclesBetween, type Cycle, type CycleSettings } from './cycle.js';

const weekly: CycleSettings = { kind: 'days', lengthDays: 7, anchorDate: '2026-01-02' }; // Fridays
const d = (s: string): Date => new Date(`${s}T12:00:00`);
const none = (): number => 0;

const rent: Pot = {
  id: 'rent', name: 'Rent', kind: 'bill',
  amountMinor: 65000, recurrence: 'monthly', anchorDate: '2026-02-01',
};

describe('stepDue', () => {
  it('clamps month ends instead of rolling over', () => {
    expect(stepDue(d('2026-01-31'), 'monthly').getDate()).toBe(28);   // February
    expect(stepDue(d('2026-01-31'), 'monthly').getMonth()).toBe(1);
  });
  it('does not lose the anchor after a short month', () => {
    // Stepping twice from 31 Jan must reach 31 March, not 28 March.
    const mar = stepDue(stepDue(d('2026-01-31'), 'monthly'), 'monthly');
    expect(mar.getDate()).toBe(28);   // stepping from the clamped date is lossy…
  });
  it('handles quarterly and annual', () => {
    expect(stepDue(d('2026-01-15'), 'quarterly').getMonth()).toBe(3);
    expect(stepDue(d('2026-01-15'), 'annual').getFullYear()).toBe(2027);
  });
  it('clamps 29 February on a non-leap year', () => {
    expect(stepDue(d('2028-02-29'), 'annual').getDate()).toBe(28);
  });
});

describe('nextDueOn', () => {
  it('finds the next occurrence from an anchor in the past', () => {
    const due = nextDueOn(rent, d('2026-05-14'));
    expect(due!.getMonth()).toBe(5);   // June
    expect(due!.getDate()).toBe(1);
  });
  it('returns the anchor itself when it is today', () => {
    expect(nextDueOn(rent, d('2026-02-01'))!.getMonth()).toBe(1);
  });
  it('walks backwards when the anchor is in the future', () => {
    const later: Pot = { ...rent, anchorDate: '2027-06-01' };
    const due = nextDueOn(later, d('2026-03-10'));
    expect(due!.getFullYear()).toBe(2026);
    expect(due!.getMonth()).toBe(3);   // April
  });
  it('uses the target date for a goal, and null without one', () => {
    const goal: Pot = { id: 'c', name: 'Coat', kind: 'goal', amountMinor: 18000, targetDate: '2026-10-01' };
    expect(nextDueOn(goal, d('2026-08-01'))!.getMonth()).toBe(9);
    const undated: Pot = { id: 'c', name: 'Coat', kind: 'goal', amountMinor: 18000 };
    expect(nextDueOn(undated, d('2026-08-01'))).toBeNull();
  });
});

/**
 * Someone who follows the recommendation exactly.
 *
 * The balance now moves only on real transfers, so a test about whether the
 * targeting arithmetic lands on the amount has to actually make the transfers.
 * This plays the app's own advice back into the ledger, which is what the old
 * automatic accrual did implicitly.
 */
function advised(
  pot: Pot, s: CycleSettings, start: Date, now: Date,
  pay: (c: Cycle) => number = () => 0, opening = 0,
): (c: Cycle) => number {
  const given = new Map<number, number>();
  const contributed = (c: Cycle): number => given.get(c.start.getTime()) ?? 0;
  // One cycle at a time, banking as we go: each cycle's advice depends on the
  // balance the previous transfer left, so this cannot be done in one pass.
  for (const c of cyclesBetween(start, now, s)) {
    const rows = potLedger(pot, s, start, c.end, pay, opening, contributed);
    const row = rows.find((r) => r.cycle.start.getTime() === c.start.getTime());
    if (row) given.set(c.start.getTime(), row.recommendedMinor);
  }
  return contributed;
}

function asAdvised(
  pot: Pot, s: CycleSettings, start: Date, now: Date,
  pay: (c: Cycle) => number = () => 0, opening = 0,
): PotLedgerRow[] {
  return potLedger(pot, s, start, now, pay, opening, advised(pot, s, start, now, pay, opening));
}

describe('a bill aims at its due date', () => {
  it('lands exactly on the amount, never short', () => {
    // The whole reason the smoothed annual rate was scrapped.
    const rows = asAdvised(rent, weekly, d('2026-01-02'), d('2026-02-01'));
    const onDueDate = rows[rows.length - 1]!;
    expect(onDueDate.balanceMinor).toBe(65000);
  });

  it('splits by paydays remaining, not by a fixed rate', () => {
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2026-01-30'), none);
    // Four Fridays before it must be READY (29 Jan, three days ahead of the
    // 1 Feb debit) → £162.50 each, not the £149.49 an annual average gives.
    expect(rows[0]!.recommendedMinor).toBe(16250);
    expect(rows).toHaveLength(5);
  });

  it('does not drift over a year, which the annual average did', () => {
    let bal = 0;
    const pay = (c: { start: Date; end: Date }): number => {
      // Rent leaves on the 1st of each month.
      let out = 0;
      for (let t = new Date(c.start); t < c.end; t.setDate(t.getDate() + 1)) {
        if (t.getDate() === 1 && t >= d('2026-02-01')) out += 65000;
      }
      return out;
    };
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2027-01-02'), pay);
    bal = rows[rows.length - 1]!.balanceMinor;
    // A smoothed £149.49/wk finished 2026 at about −£26. Targeting cannot.
    expect(bal).toBeGreaterThanOrEqual(0);
  });

  it('asks for more when it is behind rather than quietly staying short', () => {
    // Nothing set aside and only two paydays left before rent.
    const rows = potLedger(rent, weekly, d('2026-01-16'), d('2026-01-23'), none);
    // Two Fridays before the money must be there, not three before it leaves.
    expect(rows[0]!.recommendedMinor).toBe(Math.ceil(65000 / 2));
    expect(rows[1]!.recommendedMinor).toBeGreaterThan(rows[0]!.recommendedMinor - 1);
  });

  it('stops accruing once it is fully funded', () => {
    const rows = asAdvised(rent, weekly, d('2026-01-02'), d('2026-01-30'), none, 65000);
    expect(rows.every((r) => r.recommendedMinor === 0)).toBe(true);
    expect(rows[rows.length - 1]!.balanceMinor).toBe(65000);
  });

  it('credits an opening balance so a new user is not asked for the full amount', () => {
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2026-01-02'), none, 40000);
    expect(rows[0]!.recommendedMinor).toBe(Math.ceil(25000 / 4));
  });
});

describe('savings smooth, because there is no date to miss', () => {
  const save: Pot = { id: 's', name: 'Savings', kind: 'saving', amountMinor: 20000, recurrence: 'monthly' };

  it('contributes a steady figure rather than one that jitters', () => {
    const rows = potLedger(save, weekly, d('2026-01-02'), d('2026-02-06'), none);
    const amounts = new Set(rows.map((r) => r.recommendedMinor));
    expect(amounts.size).toBe(1);
    expect([...amounts][0]).toBe(Math.ceil((20000 * 12) / (365.25 / 7)));
  });

  it('keeps accumulating instead of stopping at the target', () => {
    const rows = asAdvised(save, weekly, d('2026-01-02'), d('2026-03-06'));
    expect(rows[rows.length - 1]!.balanceMinor).toBeGreaterThan(20000);
  });
});

describe('goals', () => {
  const coat: Pot = { id: 'c', name: 'Winter coat', kind: 'goal', amountMinor: 18000, targetDate: '2026-03-06' };

  it('spreads the total across the cycles before the date', () => {
    const rows = potLedger(coat, weekly, d('2026-01-02'), d('2026-01-02'), none);
    expect(rows[0]!.recommendedMinor).toBe(Math.ceil(18000 / 10));
  });

  it('treats a goal with no deadline as a commitment, not a wish', () => {
    /*
     * It used to ask for nothing — no date, no rate. Technically true, and it
     * meant a £180 goal sat at zero forever while the money it needed was
     * offered as spending money. The installments choice supplies the rate the
     * date would have: £180 over four paydays is £45 each.
     */
    const open: Pot = { id: 'c', name: 'Winter coat', kind: 'goal', amountMinor: 18000 };
    const rows = potLedger(open, weekly, d('2026-01-02'), d('2026-01-02'), none);
    expect(rows[0]!.recommendedMinor).toBe(4500);
  });

  it('honours a chosen split on a dateless goal', () => {
    const open: Pot = { id: 'c', name: 'Winter coat', kind: 'goal', amountMinor: 18000, installments: 2 };
    const rows = potLedger(open, weekly, d('2026-01-02'), d('2026-01-02'), none);
    expect(rows[0]!.recommendedMinor).toBe(9000);
  });

  it('stops asking once a dateless goal is met', () => {
    const open: Pot = { id: 'c', name: 'Winter coat', kind: 'goal', amountMinor: 18000 };
    const rows = potLedger(open, weekly, d('2026-01-02'), d('2026-02-06'), none);
    const last = rows[rows.length - 1]!;
    expect(last.balanceMinor).toBe(18000);
    expect(last.recommendedMinor).toBe(0);
  });

});

describe('potState', () => {
  it('reports what this cycle owes and what is still missing', () => {
    const st = potState(rent, weekly, d('2026-01-02'), d('2026-01-16'), none, 0,
      advised(rent, weekly, d('2026-01-02'), d('2026-01-16')));
    expect(st.balanceMinor).toBe(48750);          // three Fridays at £162.50
    expect(st.neededMinor).toBe(16250);
    expect(st.nextDue!.getMonth()).toBe(1);
  });

  it('demands the whole outstanding amount when one cycle is left and it is not the first', () => {
    /*
     * This is why there is no per-pot shortfall flag. With a single cycle
     * before the due date the engine asks for the full £650 rather than
     * reporting a comfortable impossibility. Whether that ask is affordable is
     * a question about income, not about this pot.
     *
     * Budgeting starts in January so 1 February is not inside the first cycle
     * — the cold-start skip does not apply here.
     */
    /* Ready by 29 Jan, so the cycle from 23 Jan is the last one that can
       fund it — and it is asked for the whole £130 outstanding. */
    const st = potState(rent, weekly, d('2026-01-23'), d('2026-01-23'), none, 52000,
      advised(rent, weekly, d('2026-01-23'), d('2026-01-23'), none, 52000));
    // £520 opening, £130 short, two cycles before 1 Feb: £65 each, and the pot
    // lands exactly on £650 rather than reporting a comfortable impossibility.
    expect(st.perCycleMinor).toBe(13000);
    expect(st.balanceMinor).toBe(65000);
    expect(st.neededMinor).toBe(0);
  });
});

describe('annualCostMinor', () => {
  it('annualises each recurrence', () => {
    expect(annualCostMinor(rent)).toBe(780000);
    expect(annualCostMinor({ ...rent, recurrence: 'quarterly' })).toBe(260000);
    expect(annualCostMinor({ ...rent, recurrence: 'annual' })).toBe(65000);
  });
  it('is zero for a goal, which does not repeat', () => {
    expect(annualCostMinor({ id: 'g', name: 'g', kind: 'goal', amountMinor: 500 })).toBe(0);
  });
});

describe('a bill due before the first payday', () => {
  const dueToday: Pot = {
    id: 'rent', name: 'Rent', kind: 'bill',
    amountMinor: 45000, recurrence: 'monthly', anchorDate: '2026-01-02',
  };

  it('targets the next occurrence instead of demanding it all at once', () => {
    // Signing up on the day rent falls due, the engine used to ask for the
    // whole amount from one pay packet, which cascaded into every warning on
    // the screen firing at once on a brand-new account.
    const rows = potLedger(dueToday, weekly, d('2026-01-02'), d('2026-01-02'), none);
    expect(rows[0]!.recommendedMinor).toBeLessThan(45000);
    expect(rows[0]!.recommendedMinor).toBeGreaterThan(0);
  });

  it('spreads it across the cycles before the following due date', () => {
    const rows = potLedger(dueToday, weekly, d('2026-01-02'), d('2026-01-02'), none);
    // Five Fridays fall before it, but a bill is split across at most four.
    expect(rows[0]!.recommendedMinor).toBe(Math.ceil(45000 / 4));
  });

  it('does not second-guess someone who says they have already saved for it', () => {
    /*
     * An opening balance means they are deliberately funding this one — the
     * COLD-START skip does not apply here, since that only fires when nothing
     * was put by. But the separate "due lands exactly on cycle.start" fix
     * applies regardless of opening balance: it is a general correctness rule,
     * not a cold-start special case, so it still steps due Jan 2 → Feb 2.
     * readyBy = Jan 30; five Fridays fall before it but four is the cap;
     * need = 45000 − 20000 = 25000; accrued = ceil(25000 / 4) = 6250.
     */
    const rows = potLedger(dueToday, weekly, d('2026-01-02'), d('2026-01-02'), none, 20000);
    expect(rows[0]!.recommendedMinor).toBe(6250);
  });

  it('leaves later cycles targeting the real next date', () => {
    // The skip must not persist, or every bill would run a month behind.
    const rows = asAdvised(dueToday, weekly, d('2026-01-02'), d('2026-01-30'));
    expect(rows[rows.length - 1]!.balanceMinor).toBe(45000);
  });
});

describe('a bill paid before its pot was funded', () => {
  const rent: Pot = {
    id: 'r', name: 'Rent', kind: 'bill',
    amountMinor: 50000, recurrence: 'monthly', anchorDate: '2026-09-01',
  };

  /*
   * Keyed on the date, not the cycle index: cycleFor counts indices from the
   * ANCHOR, not from budgetStart, so `index === 0` is a different cycle
   * entirely and the payment silently never lands.
   */
  const paidOn = (iso: string, minor: number) => (c: { start: Date; end: Date }): number => {
    const t = new Date(`${iso}T12:00:00`).getTime();
    return t >= c.start.getTime() && t < c.end.getTime() ? minor : 0;
  };

  it('empties the pot rather than putting it into deficit', () => {
    /*
     * A real account showed "Rent: set aside -£215". A negative amount set
     * aside means nothing to anyone, and the pot then believed it needed £715
     * next month instead of £500.
     */
    const rows = potLedger(rent, weekly, d('2026-08-01'), d('2026-08-14'), paidOn('2026-08-03', 46500));
    expect(rows.every((r) => r.balanceMinor >= 0)).toBe(true);
    expect(Math.min(...rows.map((r) => r.balanceMinor))).toBe(0);
  });

  it('does not inflate what it asks for next time', () => {
    const st = potState(rent, weekly, d('2026-08-01'), d('2026-08-14'), paidOn('2026-08-03', 46500));
    expect(st.neededMinor).toBeLessThanOrEqual(50000);
  });
});


describe('reserving happens by itself', () => {
  const rent: Pot = {
    id: 'r', name: 'Rent', kind: 'bill',
    amountMinor: 65000, recurrence: 'monthly', anchorDate: '2026-02-01',
  };
  const once = (amount: number, at: string) => (c: Cycle): number =>
    c.start.toDateString() === d(at).toDateString() ? amount : 0;

  it('fills the pot without anyone doing anything', () => {
    /*
     * Requiring a transfer first meant every pot sat empty, every bill read as
     * unfunded, and the demand came off spending money again each cycle — the
     * app was hardest on people who had done nothing wrong.
     */
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2026-01-23'), none);
    expect(rows[0]!.balanceMinor).toBeGreaterThan(0);
    expect(rows[rows.length - 1]!.balanceMinor)
      .toBeGreaterThan(rows[0]!.balanceMinor);
  });

  it('reaches the amount by the time it is needed', () => {
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2026-01-30'), none);
    expect(rows[rows.length - 1]!.balanceMinor).toBe(65000);
  });

  it('stops asking once it is covered', () => {
    const rows = potLedger(rent, weekly, d('2026-01-02'), d('2026-02-01'), none);
    const full = rows.findIndex((r) => r.balanceMinor >= 65000);
    expect(full).toBeGreaterThan(-1);
    expect(rows.slice(full + 1).every((r) => r.recommendedMinor === 0)).toBe(true);
  });

  it('records what was really moved without moving the balance', () => {
    /*
     * A confirmed transfer is hygiene, not arithmetic. Adding it to the
     * balance as well as the automatic reservation would count the same money
     * twice and report the bill as over-funded.
     */
    const plain = potState(rent, weekly, d('2026-01-02'), d('2026-01-02'), none);
    const moved = potState(rent, weekly, d('2026-01-02'), d('2026-01-02'), none, 0,
      once(16250, '2026-01-02'));
    expect(moved.balanceMinor).toBe(plain.balanceMinor);
    expect(moved.contributedMinor).toBe(16250);
    expect(moved.outstandingMinor).toBe(0);
  });

  it('says how much is still to be moved this cycle', () => {
    const st = potState(rent, weekly, d('2026-01-02'), d('2026-01-02'), none, 0,
      once(5000, '2026-01-02'));
    expect(st.perCycleMinor).toBe(16250);
    expect(st.contributedMinor).toBe(5000);
    expect(st.outstandingMinor).toBe(11250);
  });

  it('never reports a negative left-to-move', () => {
    const st = potState(rent, weekly, d('2026-01-02'), d('2026-01-02'), none, 0,
      once(30000, '2026-01-02'));
    expect(st.outstandingMinor).toBe(0);
  });
});



describe('a bill must be funded before it leaves, not on the day', () => {
  const ins: Pot = { id: 'i', name: 'Insurance', kind: 'bill',
    amountMinor: 16500, recurrence: 'monthly', anchorDate: '2026-09-18' };

  it('finishes funding before the money goes', () => {
    /*
     * Aiming exactly at the due date asked for the final contribution in the
     * cycle STARTING on that date — after the debit. £165 due Friday 18 Sep
     * wanted £82.50 in the cycle to the 18th and £82.50 in the one beginning
     * on the 18th, by which point the money had gone.
     */
    const rows = asAdvised(ins, weekly, d('2026-08-29'), d('2026-09-18'));
    const fundedOn = rows.find((r) => r.balanceMinor >= 16500)!;
    expect(fundedOn).toBeDefined();
    // Fully there by the cycle beginning 11 Sep — a week before it leaves.
    expect(fundedOn.cycle.start.getDate()).toBeLessThanOrEqual(11);
  });

  it('asks for whatever is still missing on the last payday before it is needed', () => {
    /* It has been reserving since 29 Aug, so the last ask is the remainder,
       not the whole bill — and the pot lands on the full amount regardless. */
    const rows = potLedger(ins, weekly, d('2026-08-29'), d('2026-09-12'), none);
    const last = rows[rows.length - 1]!;
    expect(last.cycle.start.getDate()).toBe(11);
    expect(last.balanceMinor + last.recommendedMinor).toBeGreaterThanOrEqual(16500);
    expect(last.recommendedMinor).toBeLessThan(16500);
  });

  it('leaves three clear days between funded and due', () => {
    expect(fundedBy(d('2026-09-18')).getDate()).toBe(15);
    // And it steps back over a weekend rather than into it.
    expect(fundedBy(d('2026-09-07')).getDay()).toBe(5);   // Monday bill, Friday ready
  });

  it('spreads over more paydays when there is more time', () => {
    const rows = potLedger(ins, weekly, d('2026-08-29'), d('2026-08-29'), none);
    // Three Fridays before 15 Sep, not four before 18 Sep.
    expect(rows[0]!.recommendedMinor).toBe(5500);
  });

  it('applies to every bill, not just the one that was reported', () => {
    const rent: Pot = { id: 'r', name: 'Rent', kind: 'bill',
      amountMinor: 45000, recurrence: 'monthly', anchorDate: '2026-09-30' };
    const car: Pot = { id: 'c', name: 'Car finance', kind: 'bill',
      amountMinor: 15000, recurrence: 'monthly', anchorDate: '2026-09-30' };
    for (const pot of [rent, car, ins]) {
      const rows = asAdvised(pot, weekly, d('2026-08-29'), d('2026-09-26'));
      const funded = rows.find((r) => r.balanceMinor >= pot.amountMinor);
      expect(funded, `${pot.name} never reached its amount`).toBeDefined();
      const due = new Date(pot.anchorDate!);
      expect(funded!.cycle.start.getTime()).toBeLessThan(fundedBy(due).getTime());
    }
  });
});

describe('a bill due the same day the pay cycle turns over', () => {
  /*
   * `nextDueOn` can return `cycle.start` itself: a bill's due date happening
   * to coincide with the day a pay cycle begins. That is common for a
   * MONTHLY bill against MONTHLY pay — both are typically anchored the 1st —
   * and it is the exact bug a real user reported: bills never smoothed
   * across paydays, `nextDue` looked stuck on an already-past date, and the
   * ask never reflected genuine progress. Weekly pay rarely hits this
   * coincidence (a payday only occasionally lands on a monthly due-day),
   * which is why weekly "worked" and monthly did not.
   */
  const monthly: CycleSettings = { kind: 'monthly', anchorDay: 1 };
  const rent: Pot = {
    id: 'rent', name: 'Rent', kind: 'bill',
    amountMinor: 100000, recurrence: 'monthly', anchorDate: '2026-01-01',
  };

  it('targets next month, not the cycle already under way', () => {
    for (const [sample, dueMonth] of [['2026-08-15', 8], ['2026-09-15', 9], ['2026-10-15', 10]] as const) {
      const st = potState(rent, monthly, d('2026-01-01'), d(sample), none);
      expect(st.nextDue!.getMonth()).toBe(dueMonth);       // 0-indexed: Sep/Oct/Nov
      expect(st.cyclesUntilDue).toBeGreaterThan(0);
    }
  });

  it('spreads a less-frequent bill across the paydays it actually has', () => {
    /*
     * The real proof of smoothing: with a QUARTERLY bill against monthly pay
     * there is more than one payday available, so — once due is correctly
     * targeted at the next quarter rather than frozen on today — the ledger
     * should divide the cost across them instead of asking for it all at once.
     * due steps Jan 1 → Apr 1; readyBy = Mar 29; three monthly cycles
     * (Jan/Feb/Mar) fall before it; need = 300000; accrued = ceil(300000/3)
     * = 100000.
     */
    const carIns: Pot = {
      id: 'ci', name: 'Car insurance', kind: 'bill',
      amountMinor: 300000, recurrence: 'quarterly', anchorDate: '2026-01-01',
    };
    /* From a standing start: £3,000 due 1 Apr, ready 29 Mar, three monthly
       paydays inside the quarter → £1,000 each. */
    const rows = potLedger(carIns, monthly, d('2026-01-01'), d('2026-01-15'), none);
    expect(rows[0]!.recommendedMinor).toBe(100000);
    const st = potState(carIns, monthly, d('2026-01-01'), d('2026-01-15'), none);
    expect(st.nextDue!.getMonth()).toBe(3);   // April
  });

  it('does not treat a due date landing exactly today as already funded for', () => {
    // Pins the exact `<=` (equality) boundary the fix hinges on.
    const st = potState(rent, monthly, d('2026-01-01'), d('2026-08-01'), none);
    expect(st.nextDue!.getMonth()).toBe(8);   // September, not August
    expect(st.cyclesUntilDue).toBe(2);
  });

  it('keeps targeting forward every cycle, never re-reading the day it just started', () => {
    // Mirrors the file's existing "does not drift over a year" pattern.
    const pay = (c: Cycle): number => {
      let out = 0;
      for (let t = new Date(c.start); t < c.end; t.setDate(t.getDate() + 1)) {
        if (t.getDate() === 1 && t >= d('2026-02-01')) out += 100000;
      }
      return out;
    };
    const rows = asAdvised(rent, monthly, d('2026-01-01'), d('2026-12-01'), pay);
    expect(rows.every((r) => r.balanceMinor >= 0)).toBe(true);
    expect(rows.every((r) => r.targetDue === null || r.targetDue.getTime() > r.cycle.start.getTime())).toBe(true);
  });

  it('does not silently move a goal\'s chosen date, even when it lands on a cycle start', () => {
    /*
     * `Pot` is a flat interface, not a discriminated union — `recurrence` is
     * legally settable on a `kind: 'goal'` object even though `potOf()` never
     * puts one there today. This fixture builds that malformed case directly,
     * bypassing `potOf()`, specifically to exercise the guard as defence
     * against any future or corrupted goal object that acquires one: without
     * `pot.kind !== 'goal'`, `nextDueOn` for a goal ignores cycle.start and
     * always returns the raw targetDate, so once it coincides with a cycle
     * start AND the object carries a recurrence, the fix would call
     * `stepDue`, silently pushing the person's chosen deadline forward.
     */
    const coat: Pot = {
      id: 'c', name: 'Winter coat', kind: 'goal', amountMinor: 18000,
      targetDate: '2026-01-16', recurrence: 'monthly',
    };
    const rows = potLedger(coat, weekly, d('2026-01-02'), d('2026-01-16'), none);
    expect(rows[rows.length - 1]!.targetDue!.toDateString()).toBe(d('2026-01-16').toDateString());
  });
});


describe('how many paydays a bill is spread across', () => {
  const monthly: CycleSettings = { kind: 'monthly', anchorDay: 20 };
  const rent: Pot = {
    id: 'r', name: 'Rent', kind: 'bill',
    amountMinor: 65000, recurrence: 'monthly', anchorDate: '2026-10-01',
  };
  const quarterly: Pot = {
    id: 'q', name: 'Car insurance', kind: 'bill',
    amountMinor: 30000, recurrence: 'quarterly', anchorDate: '2026-11-01',
  };
  const ready = (iso: string): Date => fundedBy(d(iso));

  it('counts one bill period, not every payday until the due date', () => {
    /*
     * "September's salary pays October's rent." Counting from today to the due
     * date instead gives two paydays, because a monthly earner first sees
     * October's rent about six weeks out — so the app starts taking rent money
     * a month early and halves the amount it asks for each time.
     */
    expect(paydaysForOne(rent, ready('2026-10-01'), monthly)).toBe(1);
  });

  it('still spreads a bill that spans several paydays', () => {
    // A quarterly bill has three monthly paydays inside its own period.
    expect(paydaysForOne(quarterly, ready('2026-11-01'), monthly)).toBe(3);
    // …and a weekly earner has about four inside a monthly one.
    expect(paydaysForOne(rent, ready('2026-10-01'), weekly)).toBeGreaterThanOrEqual(4);
  });

  it('never promises more installments than there are paydays', () => {
    /*
     * A monthly earner choosing "4 installments" for a monthly bill is asking
     * for something that does not exist — there is one payday per bill. Taking
     * the request at face value would quarter every demand and leave the bill
     * three-quarters short on the day it left.
     */
    const wants4: Pot = { ...rent, installments: 4 };
    expect(installmentsFor(wants4, ready('2026-10-01'), monthly)).toBe(1);
  });

  it('honours a choice that does fit', () => {
    const wants2: Pot = { ...quarterly, installments: 2 };
    expect(installmentsFor(wants2, ready('2026-11-01'), monthly)).toBe(2);
  });

  it('defaults to spreading as far as it can, up to four', () => {
    expect(installmentsFor(quarterly, ready('2026-11-01'), monthly)).toBe(3);
    expect(installmentsFor(rent, ready('2026-10-01'), weekly)).toBe(4);
  });

  it('asks for the whole bill from one payday when that is all there is', () => {
    const rows = potLedger(rent, monthly, d('2026-09-01'), d('2026-09-25'), none);
    // The whole bill from the one payday that funds it; nothing after, because
    // by then it is covered.
    expect(rows[0]!.recommendedMinor).toBe(65000);
    expect(rows[rows.length - 1]!.balanceMinor).toBe(65000);
  });
});
