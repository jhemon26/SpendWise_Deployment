import { uuidv7, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
import type { StorageAdapter } from '../../core/db/adapter.js';

/**
 * Demo month (ARCHITECTURE §3.5, stage 3).
 *
 * A budgeting app is at its worst on day one: every chart empty, every total
 * zero, and no way to tell whether it works. This is the "explore with sample
 * data" path — it must be clearly labelled in the UI and removable in one tap,
 * because demo rows that quietly become real data are a genuine harm in a
 * finance app.
 *
 * Dates are relative to today and clamped to the current month, so the demo
 * never falls out of the period being displayed.
 */

const now = (): Date => new Date();

function daysAgo(n: number, h = 12, m = 0): string {
  const t = now();
  const clamped = Math.min(n, t.getDate() - 1);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - clamped, h, m).toISOString();
}

function envelope(): Pick<
  Transaction,
  'server_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sync_status' | 'version' | 'device_id'
> {
  const t = new Date().toISOString();
  return {
    server_id: null, created_at: t, updated_at: t, deleted_at: null,
    // 'synced' on purpose: demo rows must not queue for upload and pollute a
    // real account the first time the device comes online.
    sync_status: 'synced', version: 1, device_id: 'demo',
  };
}

export async function seedDemo(db: StorageAdapter): Promise<void> {
  const cat = (name: string, icon: string, colour: string, limit: number, fixed = false): Category => ({
    local_id: uuidv7(), ...envelope(), name, icon, colour, limit_minor: limit, is_fixed: fixed,
  });

  const categories: Category[] = [
    cat('Groceries', 'groceries', '#14B8A6', 32000),
    cat('Eating out', 'dining', '#FB923C', 12000),
    cat('Shopping', 'shopping', '#EC4899', 10000),
    cat('Transport', 'transport', '#22D3EE', 9000),
    cat('Fun', 'fun', '#EAB308', 8000),
    cat('Home', 'home', '#94A3B8', 11000),
    cat('Rent', 'rent', '#8B5CF6', 90000, true),
    cat('Car finance', 'car', '#6366F1', 15200, true),
  ];
  const byName = (n: string): string => categories.find((c) => c.name === n)!.local_id;

  const banks: Bank[] = [
    { local_id: uuidv7(), ...envelope(), name: 'Monzo', colour: '#FF4D6A' },
    { local_id: uuidv7(), ...envelope(), name: 'Amex', colour: '#38BDF8' },
  ];

  const tx = (
    ago: number, h: number, m: number, merchant: string,
    category: string | null, amountMinor: number, income = false,
  ): Transaction => {
    const at = daysAgo(ago, h, m);
    return {
      local_id: uuidv7(), ...envelope(),
      category_id: category ? byName(category) : null,
      bank_id: banks[0]!.local_id,
      amount_minor: income ? Math.abs(amountMinor) : -Math.abs(amountMinor),
      currency: 'GBP',
      base_minor: income ? Math.abs(amountMinor) : -Math.abs(amountMinor),
      base_currency: 'GBP',
      fx_rate: 1, fx_rate_date: at.slice(0, 10), fx_provisional: false,
      merchant, note: null, occurred_at: at, is_income: income, pending: false,
    };
  };

  const transactions: Transaction[] = [
    tx(0, 12, 40, 'Pret A Manger', 'Eating out', 850),
    tx(0, 9, 15, "Sainsbury's Local", 'Groceries', 1550),
    tx(1, 17, 22, 'Uniqlo', 'Shopping', 2499),
    tx(1, 19, 10, 'Tesco Express', 'Groceries', 840),
    tx(1, 8, 4, 'TfL travel', 'Transport', 560),
    tx(3, 9, 0, 'Salary', null, 244500, true),
    tx(3, 19, 45, 'Deliveroo', 'Eating out', 2200),
    tx(3, 20, 15, 'Odeon', 'Fun', 1200),
    tx(4, 21, 3, 'Amazon', 'Shopping', 4000),
    tx(4, 7, 50, 'Shell', 'Transport', 1620),
    tx(4, 16, 0, 'Costa', 'Eating out', 1600),
    tx(5, 6, 0, 'Car finance', 'Car finance', 15200),
    tx(6, 6, 0, 'Rent', 'Rent', 90000),
    tx(6, 11, 30, 'Waitrose', 'Groceries', 3410),
  ];

  await db.bulkPut('categories', categories);
  await db.bulkPut('banks', banks);
  await db.bulkPut('transactions', transactions);
}
