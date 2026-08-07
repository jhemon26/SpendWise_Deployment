import { create } from 'zustand';
import { uuidv7, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
import type { StorageAdapter } from './db/adapter.js';

/**
 * Zustand over the local database (ARCHITECTURE §3.3).
 *
 * The store is a CACHE of what is on disk, never a competing source of truth.
 * Every mutation writes to the adapter first and then updates the cache, which
 * is why Zustand wins here over Redux: hydrating a plain object from the DB is
 * one call, and selector subscriptions re-render the affected row rather than
 * the tree.
 *
 * Ordering in every action is deliberate: disk, screen, network.
 */

export interface AppState {
  ready: boolean;
  transactions: Transaction[];
  categories: Category[];
  banks: Bank[];
  deviceId: string;

  dayToDayMinor: number;
  savingsTargetMinor: number;
  displayName: string;
  baseCurrency: string;

  hydrate: (db: StorageAdapter) => Promise<void>;
  addTransaction: (db: StorageAdapter, draft: NewTransaction) => Promise<Transaction>;
  editTransaction: (db: StorageAdapter, localId: string, patch: Partial<Transaction>) => Promise<void>;
  removeTransaction: (db: StorageAdapter, localId: string) => Promise<void>;
  upsertCategory: (db: StorageAdapter, c: Partial<Category> & { name: string }) => Promise<Category>;
  removeCategory: (db: StorageAdapter, localId: string) => Promise<void>;
  setSettings: (p: Partial<Pick<AppState, 'dayToDayMinor' | 'savingsTargetMinor' | 'displayName' | 'baseCurrency'>>) => void;
}

export interface NewTransaction {
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  bankId: string | null;
  merchant: string | null;
  isIncome: boolean;
  occurredAt?: string;
}

const nowIso = (): string => new Date().toISOString();

function envelope(deviceId: string): Pick<
  Transaction,
  'server_id' | 'created_at' | 'updated_at' | 'deleted_at' | 'sync_status' | 'version' | 'device_id'
> {
  const t = nowIso();
  return {
    server_id: null,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    sync_status: 'pending',
    version: 0,
    device_id: deviceId,
  };
}

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  transactions: [],
  categories: [],
  banks: [],
  deviceId: 'web-device',
  dayToDayMinor: 82000,
  savingsTargetMinor: 40800,
  displayName: 'Jahid',
  baseCurrency: 'GBP',

  hydrate: async (db) => {
    const [transactions, categories, banks] = await Promise.all([
      db.all('transactions'),
      db.all('categories'),
      db.all('banks'),
    ]);
    set({ transactions, categories, banks, ready: true });
  },

  addTransaction: async (db, draft) => {
    const { deviceId, baseCurrency } = get();
    const occurred = draft.occurredAt ?? nowIso();
    const signed = draft.isIncome ? Math.abs(draft.amountMinor) : -Math.abs(draft.amountMinor);

    const rec: Transaction = {
      local_id: uuidv7(),
      ...envelope(deviceId),
      category_id: draft.categoryId,
      bank_id: draft.bankId,
      amount_minor: signed,
      currency: draft.currency,
      // Same currency: the conversion is the identity, and nothing is
      // provisional. A foreign currency entered offline would be marked
      // provisional and recomputed by the server on sync (§5.1.1).
      base_minor: draft.currency === baseCurrency ? signed : null,
      base_currency: baseCurrency,
      fx_rate: 1,
      fx_rate_date: occurred.slice(0, 10),
      fx_provisional: draft.currency !== baseCurrency,
      merchant: draft.merchant,
      note: null,
      occurred_at: occurred,
      is_income: draft.isIncome,
      pending: false,
    };

    await db.put('transactions', rec);            // disk
    set({ transactions: [rec, ...get().transactions] }); // screen
    return rec;                                    // network happens later
  },

  editTransaction: async (db, localId, patch) => {
    const cur = get().transactions.find((t) => t.local_id === localId);
    if (!cur) return;
    const next: Transaction = { ...cur, ...patch, updated_at: nowIso(), sync_status: 'pending' };
    await db.put('transactions', next);
    set({ transactions: get().transactions.map((t) => (t.local_id === localId ? next : t)) });
  },

  removeTransaction: async (db, localId) => {
    const at = nowIso();
    await db.softDelete('transactions', localId, at);
    set({
      transactions: get().transactions.map((t) =>
        t.local_id === localId ? { ...t, deleted_at: at, updated_at: at, sync_status: 'pending' } : t,
      ),
    });
  },

  upsertCategory: async (db, c) => {
    const { deviceId } = get();
    const existing = c.local_id ? get().categories.find((x) => x.local_id === c.local_id) : undefined;
    const rec: Category = existing
      ? { ...existing, ...c, updated_at: nowIso(), sync_status: 'pending' }
      : {
          local_id: uuidv7(),
          ...envelope(deviceId),
          name: c.name,
          icon: c.icon ?? 'other',
          colour: c.colour ?? '#6366F1',
          limit_minor: c.limit_minor ?? 0,
          is_fixed: c.is_fixed ?? false,
        };
    await db.put('categories', rec);
    set({
      categories: existing
        ? get().categories.map((x) => (x.local_id === rec.local_id ? rec : x))
        : [...get().categories, rec],
    });
    return rec;
  },

  removeCategory: async (db, localId) => {
    const at = nowIso();
    await db.softDelete('categories', localId, at);
    set({
      categories: get().categories.map((c) =>
        c.local_id === localId ? { ...c, deleted_at: at, updated_at: at, sync_status: 'pending' } : c,
      ),
    });
  },

  setSettings: (p) => set(p),
}));
