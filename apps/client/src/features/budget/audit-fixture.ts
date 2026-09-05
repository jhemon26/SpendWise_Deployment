import type { Category, Transaction } from '@spendwise/shared-types';
const C = (local_id: string, name: string, limit: number, fixed: boolean,
           pot: boolean, anchor: string | null, dueDay: number | null): Category => ({
  local_id, name, icon: 'other', colour: '#888888', limit_minor: limit,
  is_fixed: fixed, kind: pot ? 'pot' : 'flow', pot_kind: pot ? 'bill' : null,
  recurrence: pot ? 'monthly' : null, anchor_date: anchor, target_date: null,
  opening_minor: 0, due_day: dueDay, version: 1,
  created_at: '', updated_at: '', deleted_at: null,
} as unknown as Category);

export const CATS: Category[] = [
  C('carclean','Car Clean',5000,false,false,null,null),
  C('carservice','Car Service',5000,false,false,null,null),
  C('eatingout','Eating out',8000,false,false,null,null),
  C('fuel','Fuel',12000,false,false,null,null),
  C('groceries','Groceries',25000,false,false,null,null),
  C('health','Health',5000,false,false,null,null),
  C('parking','Parking',3000,false,false,null,null),
  C('personal','Personal care',4000,false,false,null,null),
  C('tour','Random Tour',8000,false,false,null,null),
  C('shopping','Shopping',5000,false,false,null,null),
  C('transport','Transport',3000,false,false,null,null),
  C('carfinance','Car finance',15000,true,true,'2026-08-01',18),
  C('docc','DOCC AI APPLE',3000,true,true,'2026-08-01',null),
  C('dvla','DVLA Road Tax',306,true,true,'2026-08-01',null),
  C('insurance','Insurance',16500,true,true,'2026-08-01',null),
  C('phone','Phone',2000,true,true,'2026-08-01',null),
  C('rent','Rent',50000,true,true,'2026-08-01',null),
];

const T = (i: number, day: string, amt: number, cat: string | null,
           income = false, transfer = false): Transaction => ({
  local_id: `t${i}`, category_id: cat, bank_id: null, amount_minor: amt,
  currency: 'GBP', base_minor: amt, base_currency: 'GBP', fx_rate: 1,
  fx_rate_date: day, fx_provisional: false, merchant: null, note: null,
  occurred_at: `${day}T10:00:00`, is_income: income, is_transfer: transfer,
  pending: false, version: 1, created_at: '', updated_at: '', deleted_at: null,
} as Transaction);

export const TXS: Transaction[] = [
  T(1,'2026-08-29',7500,'carfinance',false,true),
  T(2,'2026-08-28',-1710,'groceries'), T(3,'2026-08-28',-769,'eatingout'),
  T(4,'2026-08-28',-1611,'groceries'), T(5,'2026-08-28',-2501,'fuel'),
  T(6,'2026-08-21',-1800,'eatingout'), T(7,'2026-08-21',-29000,'carservice'),
  T(8,'2026-08-21',-80,'parking'), T(9,'2026-08-21',-2800,'personal'),
  T(10,'2026-08-21',-689,'eatingout'), T(11,'2026-08-21',-2980,'fuel'),
  T(12,'2026-08-21',-1480,'groceries'), T(13,'2026-08-17',-390,'parking'),
  T(14,'2026-08-17',-600,'eatingout'), T(15,'2026-08-17',-3000,'carclean'),
  T(16,'2026-08-17',-3055,'fuel'), T(17,'2026-08-17',-360,'groceries'),
  T(18,'2026-08-17',-1000,'transport'), T(19,'2026-08-13',-7800,'shopping'),
  T(20,'2026-08-12',-40,'parking'), T(21,'2026-08-12',-2600,'fuel'),
  T(22,'2026-08-12',-700,'eatingout'), T(23,'2026-08-11',-23000,'eatingout'),
  T(24,'2026-08-10',-1700,'fuel'), T(25,'2026-08-10',-500,'groceries'),
  T(26,'2026-08-10',-340,'parking'), T(27,'2026-08-10',-80,'parking'),
  T(28,'2026-08-10',-2017,'groceries'), T(29,'2026-08-10',-899,'groceries'),
  T(30,'2026-08-10',-3184,'fuel'), T(31,'2026-08-10',-46500,'rent'),
];

export const SETTINGS = {
  cycleKind: 'monthly' as const, cycleLengthDays: null, cycleAnchorDate: null,
  cycleAnchorDay: 1, expectedIncomeMinor: 200000,
  budgetStartDate: '2026-08-31', openingCashMinor: 16000,
};
export const NOW = new Date('2026-08-31T12:00:00');
