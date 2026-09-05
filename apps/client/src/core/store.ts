import { create } from 'zustand';
import { uuidv7, flowFields, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
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
  /** Monthly take-home pay. */
  /**
   * Superseded by expectedIncomeMinor, which is per CYCLE. Kept until every
   * screen reads the new field; migration 009 drops the column.
   */
  monthlyIncomeMinor: number;

  /* ── the spending clock (see features/budget/cycle.ts) ── */
  cycleKind: 'days' | 'monthly';
  /** 7, 14 or 28. Null when the cycle is monthly. */
  cycleLengthDays: number | null;
  /** Any real payday; boundaries are counted from it in both directions. */
  cycleAnchorDate: string | null;
  /** Day of month the cycle turns over. Null when the cycle is days-based. */
  cycleAnchorDay: number | null;
  /** Expected income per CYCLE, not per month. */
  expectedIncomeMinor: number;
  /** Accruals replay from here, so a new account is not billed for the past. */
  budgetStartDate: string | null;
  /**
   * What the user held when budgeting started.
   *
   * The one figure that makes a mid-cycle join honest: without it the app
   * planned around a full pay packet that had already been spent. May be
   * negative — starting in the red is a real situation.
   */
  openingCashMinor: number;
  /** Emoji avatar; empty means fall back to initials. */
  avatarEmoji: string;
  avatarColour: string;

  hydrate: (db: StorageAdapter) => Promise<void>;
  addTransaction: (db: StorageAdapter, draft: NewTransaction) => Promise<Transaction>;
  editTransaction: (db: StorageAdapter, localId: string, patch: Partial<Transaction>) => Promise<void>;
  removeTransaction: (db: StorageAdapter, localId: string) => Promise<void>;
  upsertCategory: (db: StorageAdapter, c: Partial<Category> & { name: string }) => Promise<Category>;
  removeCategory: (db: StorageAdapter, localId: string) => Promise<void>;
  setSettings: (p: Partial<Settings>) => void;
  upsertBank: (db: StorageAdapter, b: Partial<Bank> & { name: string }) => Promise<Bank>;
  removeBank: (db: StorageAdapter, localId: string) => Promise<void>;
}

export interface NewTransaction {
  amountMinor: number;
  /** Setting money aside into a pot, rather than spending or earning it. */
  isTransfer?: boolean;
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

/**
 * Settings live on the device, not in the synced tables.
 *
 * They were previously held in memory only, so the name and budget collected
 * during onboarding — and every later edit — vanished on the next reload.
 */
const SETTINGS_KEY = 'sw.settings';

export type Settings = Pick<
  AppState, 'dayToDayMinor' | 'savingsTargetMinor' | 'displayName' | 'baseCurrency'
  | 'avatarEmoji' | 'avatarColour' | 'monthlyIncomeMinor'
  | 'cycleKind' | 'cycleLengthDays' | 'cycleAnchorDate' | 'cycleAnchorDay'
  | 'expectedIncomeMinor' | 'budgetStartDate' | 'openingCashMinor'
>;

const DEFAULT_SETTINGS: Settings = {
  dayToDayMinor: 82000,
  savingsTargetMinor: 40800,
  displayName: '',
  baseCurrency: 'GBP',
  // Empty falls back to initials, so a new account is never a blank circle.
  avatarEmoji: '',
  avatarColour: '#6366F1',
  monthlyIncomeMinor: 0,
  // Monthly on the 1st reproduces exactly what the app did before cycles
  // existed, so an account that has never been configured behaves identically.
  cycleKind: 'monthly',
  cycleLengthDays: null,
  cycleAnchorDate: null,
  cycleAnchorDay: 1,
  expectedIncomeMinor: 0,
  budgetStartDate: null,
  openingCashMinor: 0,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      // Each field is checked on its own: a half-written or older blob must
      // not take out the whole set.
      dayToDayMinor: Number.isFinite(parsed.dayToDayMinor) ? parsed.dayToDayMinor as number : DEFAULT_SETTINGS.dayToDayMinor,
      savingsTargetMinor: Number.isFinite(parsed.savingsTargetMinor) ? parsed.savingsTargetMinor as number : DEFAULT_SETTINGS.savingsTargetMinor,
      displayName: typeof parsed.displayName === 'string' && parsed.displayName.trim() ? parsed.displayName : DEFAULT_SETTINGS.displayName,
      baseCurrency: typeof parsed.baseCurrency === 'string' && parsed.baseCurrency.length === 3 ? parsed.baseCurrency : DEFAULT_SETTINGS.baseCurrency,
      avatarEmoji: typeof parsed.avatarEmoji === 'string' ? parsed.avatarEmoji : DEFAULT_SETTINGS.avatarEmoji,
      avatarColour: typeof parsed.avatarColour === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.avatarColour)
        ? parsed.avatarColour : DEFAULT_SETTINGS.avatarColour,
      monthlyIncomeMinor: Number.isFinite(parsed.monthlyIncomeMinor)
        ? parsed.monthlyIncomeMinor as number : DEFAULT_SETTINGS.monthlyIncomeMinor,
      // A half-written cycle would make cycleFor divide by zero, so each field
      // falls back independently rather than trusting the stored blob.
      cycleKind: parsed.cycleKind === 'days' ? 'days' : DEFAULT_SETTINGS.cycleKind,
      cycleLengthDays: [7, 14, 28].includes(Number(parsed.cycleLengthDays))
        ? Number(parsed.cycleLengthDays) : DEFAULT_SETTINGS.cycleLengthDays,
      cycleAnchorDate: typeof parsed.cycleAnchorDate === 'string'
        ? parsed.cycleAnchorDate : DEFAULT_SETTINGS.cycleAnchorDate,
      cycleAnchorDay: Number.isFinite(parsed.cycleAnchorDay)
        ? Number(parsed.cycleAnchorDay) : DEFAULT_SETTINGS.cycleAnchorDay,
      /*
       * Adopt the old monthly figure when the new one has never been set.
       *
       * Migration 008 copied monthly_income_minor across on the server, but a
       * device whose localStorage predates cycles loads expectedIncomeMinor as
       * 0 and pushes that straight back — silently undoing the migration and
       * leaving a real account reporting no income at all.
       */
      expectedIncomeMinor: Number.isFinite(parsed.expectedIncomeMinor) && Number(parsed.expectedIncomeMinor) > 0
        ? parsed.expectedIncomeMinor as number
        : (Number.isFinite(parsed.monthlyIncomeMinor) ? Number(parsed.monthlyIncomeMinor) : 0),
      budgetStartDate: typeof parsed.budgetStartDate === 'string'
        ? parsed.budgetStartDate : DEFAULT_SETTINGS.budgetStartDate,
      openingCashMinor: Number.isFinite(parsed.openingCashMinor)
        ? Number(parsed.openingCashMinor) : DEFAULT_SETTINGS.openingCashMinor,
    };
  } catch {
    // Private mode, quota, corrupt JSON — defaults are always usable.
    return DEFAULT_SETTINGS;
  }
}

/** The persisted subset, as one object, so the store and the wire cannot drift. */
export const settingsOf = (s: AppState): Settings => ({
  displayName: s.displayName,
  baseCurrency: s.baseCurrency,
  dayToDayMinor: s.dayToDayMinor,
  savingsTargetMinor: s.savingsTargetMinor,
  avatarEmoji: s.avatarEmoji,
  avatarColour: s.avatarColour,
  monthlyIncomeMinor: s.monthlyIncomeMinor,
  cycleKind: s.cycleKind,
  cycleLengthDays: s.cycleLengthDays,
  cycleAnchorDate: s.cycleAnchorDate,
  cycleAnchorDay: s.cycleAnchorDay,
  expectedIncomeMinor: s.expectedIncomeMinor,
  budgetStartDate: s.budgetStartDate,
  openingCashMinor: s.openingCashMinor,
});

export function clearSettings(): void {
  // The theme is a device preference, not account data: someone who set the app
  // to light should not be flashed a dark screen because they signed out.
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* nothing to clear */ }
}


export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  transactions: [],
  categories: [],
  banks: [],
  deviceId: 'web-device',
  ...loadSettings(),

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
    /*
     * Sign convention.
     *
     * Income is positive, spending negative — and a TRANSFER keeps whatever
     * sign it was given, because it runs both ways: positive puts money into a
     * pot, negative takes it back out. Forcing -abs here (as every non-income
     * row used to get) made every set-aside subtract from the pot it was meant
     * to fill, and the pot then clamped at zero so nothing visibly happened.
     */
    const signed = draft.isTransfer
      ? draft.amountMinor
      : draft.isIncome ? Math.abs(draft.amountMinor) : -Math.abs(draft.amountMinor);

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
      is_transfer: draft.isTransfer ?? false,
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
          /*
           * Flow shape as the DEFAULT, then whatever the caller passed.
           *
           * This used to spread flowFields() and then copy a hand-written list
           * of six fields, which silently dropped kind, pot_kind, recurrence,
           * anchor_date, target_date and opening_minor. Onboarding builds bills
           * with billFields() — every one of them was written to the database
           * as a flow, and only survived because isPot() falls back to the
           * legacy is_fixed column. Spreading the caller last means a new field
           * on Category is carried without anyone remembering to add it here.
           */
          ...flowFields(),
          local_id: uuidv7(),
          ...envelope(deviceId),
          ...c,
          name: c.name,
          icon: c.icon ?? 'other',
          colour: c.colour ?? '#6366F1',
          limit_minor: c.limit_minor ?? 0,
          is_fixed: c.is_fixed ?? false,
          due_day: c.due_day ?? null,
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

  setSettings: (p) => {
    set(p);
    const next = settingsOf(get());
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        ...next,
      }));
    } catch {
      // Persisting is best-effort; the in-memory update already happened.
    }
  },

  upsertBank: async (db, b) => {
    const { deviceId } = get();
    const existing = b.local_id ? get().banks.find((x) => x.local_id === b.local_id) : undefined;
    const rec: Bank = existing
      ? { ...existing, ...b, updated_at: nowIso(), sync_status: 'pending' }
      : {
          ...flowFields(),
          local_id: uuidv7(),
          ...envelope(deviceId),
          name: b.name,
          colour: b.colour ?? '#6366F1',
        };
    await db.put('banks', rec);
    set({
      banks: existing
        ? get().banks.map((x) => (x.local_id === rec.local_id ? rec : x))
        : [...get().banks, rec],
    });
    return rec;
  },

  removeBank: async (db, localId) => {
    const at = nowIso();
    await db.softDelete('banks', localId, at);
    // Transactions keep their bank_id; the row simply stops naming a bank
    // rather than being rewritten, so nothing is lost if this is undone.
    set({ banks: get().banks.filter((b) => b.local_id !== localId) });
  },
}));
