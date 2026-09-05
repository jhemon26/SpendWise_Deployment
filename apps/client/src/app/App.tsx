import { useEffect, useMemo, useState } from 'react';
import {
  toMinor, fromMinor, flowFields, billFields, goalFields, anchorFromDueDay,
  type Bank, type Category, type Transaction,
} from '@spendwise/shared-types';
import { useApp, clearSettings, settingsOf } from '../core/store.js';
import type { StorageAdapter } from '../core/db/adapter.js';
import { openLocalStore } from '../core/db/index.js';
import { AddSheet, type SaveDraft } from '../features/transactions/AddSheet.js';
import { AuthScreen } from '../features/auth/AuthScreen.js';
import { Onboarding, type OnboardingResult } from '../features/onboarding/Onboarding.js';
import { Tour } from '../features/onboarding/Tour.js';
import { ValueEditor, CategoryEditor, BankEditor, AvatarEditor, DeleteAccountEditor, type ValueEdit } from '../features/settings/Editors.js';
import { AuthClient } from '../core/auth/client.js';
import { createSync, tokenStore } from '../core/sync/index.js';
import { subjectOf } from '../core/auth/subject.js';
import { fetchSettings, saveSettings } from '../core/settings.remote.js';
import { fetchIdentities, type Identity } from '../core/auth/identities.js';
import type { SyncEngine } from '../core/sync/engine.js';
import { seedDemo } from '../features/onboarding/demo.js';
import { Home, Activity, Budgets, Insights, Profile, type ScreenData, type TxFilter } from './screens.js';
import { buildBudget, budgetStartOf, cycleSettingsOf, type BudgetSettings } from '../features/budget/model.js';
import { missingPaydays } from '../features/budget/payday.js';
import { Avatar, greetingFor } from '../design-system/components.js';
import { Logo, Splash } from '../design-system/Logo.js';
import { PutAsideSheet } from '../features/budget/PutAsideSheet.js';

type Tab = 'home' | 'activity' | 'budgets' | 'insights' | 'profile';

const TABS: Array<{ id: Tab; label: string; path: string }> = [
  { id: 'home', label: 'Home', path: 'M3 10.2 12 3l9 7.2M5.5 9.4V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.4' },
  { id: 'activity', label: 'Activity', path: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'budgets', label: 'Budgets', path: 'M3 6h18v13H3zM3 10h18' },
  { id: 'insights', label: 'Analytics', path: 'M4 16l5-5 3.5 3.5L20 7M15 7h5v5' },
];

/**
 * Which grid column each tab sits in.
 *
 * The bar is five columns: two tabs, the add button, two more. Budgets is the
 * FOURTH column, not the third — indexing by tab order would park the sliding
 * indicator under the add button. Profile has no column at all; it is reached
 * from the avatar, so the indicator hides rather than pointing at something
 * unrelated.
 */
export const TAB_COLUMN: Partial<Record<Tab, number>> = {
  home: 0, activity: 1, budgets: 3, insights: 4,
};

/**
 * One adapter for the app's lifetime, resolved at boot.
 *
 * IndexedDB where it works, memory where it does not. Capacitor SQLite slots
 * in the same way for native — feature code never learns which is underneath.
 */
let db: StorageAdapter;
let engine: SyncEngine | null = null;

/**
 * API base. Empty means "local only" — the app is fully usable offline, so a
 * missing API is a degraded mode, not a fatal error.
 *
 * A production build defaults to its own origin, which is where the API is
 * served from. It used to default to '', so a build made without the untracked
 * .env silently shipped an app with no backend at all: no session restore, no
 * sign-in, no identities, no sign-out, no delete account — every one of those
 * is behind `if (API_BASE)` — and demo rows seeded over the top. It looked
 * like a working app and it was checked in as one. The origin is knowable
 * without configuration, so it should not have been configuration.
 */
const API_BASE = (import.meta.env['VITE_API_BASE'] as string | undefined)
  ?? (import.meta.env.PROD && typeof window !== 'undefined' ? window.location.origin : '');
const DEVICE_ID = 'web-device';
const auth = new AuthClient({ baseUrl: API_BASE, tokens: tokenStore, deviceId: DEVICE_ID });

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home');
  const [bootError, setBootError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // Onboarding state is local to the device: a returning user on a new phone
  // should be greeted, not dropped into an empty-looking app.
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('sw.onboarded') === '1');
  /*
   * Has the first sync pull finished?
   *
   * Onboarding must not be decided before the account's own data has arrived,
   * or a second device shows setup for an account that is already set up — and
   * then writes a duplicate set of categories when the user completes it.
   */
  const [syncPrimed, setSyncPrimed] = useState(false);
  /*
   * Hold the splash briefly.
   *
   * On a warm start the checks finish in tens of milliseconds, and a screen
   * that appears and vanishes inside one frame reads as a glitch. A short floor
   * makes it deliberate — which is the whole point of a launch screen.
   */
  const [minSplash, setMinSplash] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setMinSplash(false), 650);
    return () => clearTimeout(t);
  }, []);
  const [showTour, setShowTour] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [filter, setFilter] = useState<TxFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [putAsideId, setPutAsideId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [valueEdit, setValueEdit] = useState<ValueEdit | null>(null);
  // `undefined` means the editor is shut; `null` means it is open for a NEW one.
  const [catEdit, setCatEdit] = useState<Category | null | undefined>(undefined);
  const [bankEdit, setBankEdit] = useState<Bank | null | undefined>(undefined);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const state = useApp();

  useEffect(() => {
    // NOT `void (async ...)()`. That swallows the rejection, so any failure in
    // here leaves the app on "Loading…" forever with nothing in the console —
    // which is exactly what happened the first time IndexedDB was wired in.
    (async () => {
      const opened = await openLocalStore();
      db = opened.adapter;
      if (opened.degraded) setDegraded(opened.reason ?? 'unknown');

      // Trade the HttpOnly cookie for a fresh access token. The access token is
      // memory-only, so this is what makes "still signed in" survive a reload.
      if (API_BASE) {
        const { user, reachable } = await auth.restoreSession();
        if (user) {
          await guardAccount(user.accessToken);
          setSignedIn(true);
          startSync();
        } else if (!reachable && localStorage.getItem('sw.account')) {
          /*
           * Unreachable, but this device has signed in before.
           *
           * The app is local-first, so stay in it and work from the local
           * database. Demanding a sign-in because the network dropped is both
           * useless — signing in also needs the network — and the thing that
           * made people feel logged out again and again.
           */
          setSignedIn(true);
          startSync();
        }
      }
      setAuthChecked(true);
      /* Demo rows are for local exploration only. Seeding them into a signed-in
         account would put fabricated transactions into someone's real finances,
         and once synced they would spread to every device they own. */
      const empty = (await db.all('transactions')).length === 0;
      if (empty && !API_BASE) await seedDemo(db);
      // Devices set up before demo seeding was restricted still hold those rows.
      if (API_BASE) await purgeDemoRows();
      await state.hydrate(db);
      // Local-only mode has no server to ask, so an empty database IS a new
      // account. After hydrate: upsertBank writes through the store, which
      // needs the hydrated list to append to rather than overwrite.
      if (!API_BASE) await ensureDefaultBanks(true);
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[boot] local database failed:', err);
      setBootError(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Remove sample rows from a real account.
   *
   * Seeding is now local-only, but anyone who used the app before that change
   * still has the sample month sitting in IndexedDB. The rows are tagged
   * device_id 'demo' and were written as already-synced, so the server never
   * received them — marking them deleted is enough, and because they stay
   * 'synced' the deletion is not pushed either. Nothing leaves the device.
   */
  async function purgeDemoRows(): Promise<void> {
    const at = new Date().toISOString();
    for (const table of ['transactions', 'categories', 'banks'] as const) {
      const rows = await db.all(table);
      for (const r of rows) {
        if (r.device_id !== 'demo' || r.deleted_at) continue;
        await db.put(table, { ...r, deleted_at: at, sync_status: 'synced' });
      }
    }
  }

  /**
   * Every account needs something to pay with.
   *
   * Onboarding created categories but never a single payment method, so the
   * card picker had nothing to show and hid itself — which looked like a
   * missing feature rather than empty data. These are the four everyone has;
   * they are renamed, recoloured or deleted in Profile like any other.
   *
   * Only ever created when there are none, so it cannot duplicate or come back
   * after someone deliberately deletes them all.
   */
  async function ensureDefaultBanks(isNewAccount: boolean): Promise<void> {
    /*
     * Only for an account that has never existed before.
     *
     * Checking "does this device have none?" duplicated them: a second device
     * starts with an empty local database, creates four, and then the first
     * sync pulls down the four the other device already made — eight cards for
     * one person. The server is the authority on whether this account is new,
     * and it tells us at sign-in.
     */
    if (!isNewAccount && API_BASE) return;
    if ((await db.all('banks')).some((b) => !b.deleted_at)) return;
    for (const [name, colour] of [
      ['Debit card', '#6366F1'],
      ['Credit card', '#A855F7'],
      ['Cash', '#10B981'],
      ['Bank transfer', '#22D3EE'],
    ] as const) {
      await state.upsertBank(db, { name, colour });
    }
  }

  async function applyOnboarding(r: OnboardingResult): Promise<void> {
    state.setSettings({
      displayName: r.displayName,
      baseCurrency: r.baseCurrency,
      expectedIncomeMinor: r.expectedIncomeMinor,
      cycleKind: r.cycleKind,
      cycleLengthDays: r.cycleLengthDays,
      cycleAnchorDate: r.cycleAnchorDate,
      cycleAnchorDay: r.cycleAnchorDay,
      budgetStartDate: r.budgetStartDate,
      openingCashMinor: r.openingCashMinor,
      dayToDayMinor: r.budgets.reduce((s, b) => s + b.limitMinor, 0) || state.dayToDayMinor,
      /*
       * Savings is what is left once the day-to-day limits and the commitments
       * are taken out of a cycle's income. Never negative: a plan that does not
       * add up is surfaced by summary.overcommittedMinor on Home, not by
       * storing a nonsense target here.
       */
      savingsTargetMinor: Math.max(
        0,
        r.expectedIncomeMinor
          - r.budgets.reduce((s, b) => s + b.limitMinor, 0)
          - r.fixedCosts.reduce((s, f) => s + f.limitMinor, 0),
      ),
    });
    for (const b of r.budgets) {
      await state.upsertCategory(db, {
        name: b.name, icon: b.icon, colour: b.colour, limit_minor: b.limitMinor,
        is_fixed: false, due_day: null, ...flowFields(),
      });
    }
    for (const f of r.fixedCosts) {
      await state.upsertCategory(db, {
        name: f.name, icon: f.icon, colour: f.colour, limit_minor: f.limitMinor,
        is_fixed: true, due_day: f.dueDay,
        // A due day on its own cannot express quarterly or annual, so it is
        // turned into a real anchor date in the current month, clamped.
        ...billFields('monthly', anchorFromDueDay(f.dueDay, now), f.openingMinor),
      });
    }
    localStorage.setItem('sw.onboarded', '1');
    setOnboarded(true);
    setShowTour(true);       // the tour runs over the real, now-populated app
    engine?.wake();
  }

  /**
   * Sign out without destroying anything.
   *
   * This previously wiped the local database. That was wrong twice over: it
   * deleted categories, banks and settings that the server did not yet hold, so
   * signing out lost them permanently — and it treated logout, which people do
   * routinely, as if it were "erase my data".
   *
   * What actually protects the next person is that a DIFFERENT account's data
   * is cleared on sign-IN (see onSignedIn), when we know whose device it is.
   * Signing back in as yourself keeps everything and re-syncs the rest.
   */
  async function signOut(): Promise<void> {
    engine?.stop();
    engine = null;
    // logout() clears the local tokens even if the server call fails — the user
    // asked to be signed out, so a dropped connection must not leave them
    // looking signed in.
    /*
     * Bounded, and reloaded either way.
     *
     * The auth client uses bare fetch with no timeout, so a request that never
     * settles would leave signOut() awaiting forever and location.reload()
     * unreached — the button would simply do nothing. Whatever happens on the
     * network, the local tokens are cleared and the app restarts.
     */
    await Promise.race([
      auth.logout().catch(() => undefined),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    location.reload();
  }

  /**
   * Clear the device only when it holds SOMEONE ELSE'S data.
   *
   * This is the counterpart to sign-out no longer wiping anything. The moment
   * we know who is signing in, we can tell the two cases apart: the same person
   * returning (keep everything — much of it may not be on the server yet), or a
   * different account on a shared phone (wipe, or they would see the previous
   * person's spending).
   *
   * Runs BEFORE sync starts, so nothing from the old account can be pushed up
   * under the new account's identity.
   */
  async function guardAccount(accessToken: string): Promise<void> {
    const sub = subjectOf(accessToken);
    if (!sub) return;                       // cannot tell; leave the data alone
    const previous = localStorage.getItem('sw.account');
    if (previous && previous !== sub) {
      await db.clear();
      clearSettings();
      localStorage.removeItem('sw.onboarded');
      await state.hydrate(db);
    }
    localStorage.setItem('sw.account', sub);
    void fetchIdentities(auth, API_BASE).then(setIdentities);

    /* Adopt the server's settings so a new device arrives set up. Only when
       this device has none of its own — otherwise signing in on the phone you
       just configured would overwrite what you set with an older copy. */
    const remote = await fetchSettings(auth, API_BASE);
    if (remote && !localStorage.getItem('sw.settings')) {
      state.setSettings(remote);
    }
  }

  function startSync(): void {
    const setup = createSync(
      db,
      DEVICE_ID,
      API_BASE || undefined,
      () => {
        /*
         * The sync transport could not refresh — but it never can.
         *
         * It refreshes from tokenStore.getRefreshToken(), and the server does
         * not put a refresh token in the response body: it sets an HttpOnly
         * cookie, so AuthClient stores '' (see client.ts). Every fifteen
         * minutes the access token expired, the next sync 401'd, the transport
         * found nothing to refresh with, and this handler signed the user out
         * — with a perfectly valid session sitting in the cookie. Leaving the
         * app and coming back showed the sign-in screen; force-quitting and
         * reopening ran restoreSession() against that same cookie and landed
         * on Home, which is why it looked arbitrary.
         *
         * The cookie is the durable session, so ask it before concluding
         * anything.
         */
        void (async () => {
          const { user, reachable } = await auth.restoreSession();
          if (user) {
            engine?.stop();
            engine = null;
            startSync();          // fresh access token; carry on where we were
            return;
          }
          // Unreachable is a network problem, not a revoked session. Signing
          // someone out because their train went into a tunnel is the bug we
          // already fixed once on the boot path.
          if (!reachable) return;

          setSignedIn(false);
          engine?.stop();
          engine = null;
        })();
      },
      /*
       * Reload the store whenever the server sends rows.
       *
       * The engine writes to the database; the store is a separate in-memory
       * copy loaded at boot. Without this they diverge: pulled data sits in
       * IndexedDB unseen until a reload — which is why a set-up account looked
       * empty, was offered setup again, and then "came back" on refresh.
       */
      () => { void state.hydrate(db); },
    );
    if (setup) {
      engine = setup.engine;
      engine.start();
      // Hydrate before priming, so the onboarding decision below is made
      // against the data that was just pulled rather than an empty store.
      void engine.runOnce()
        .then(() => state.hydrate(db))
        .catch(() => undefined)
        .finally(() => setSyncPrimed(true));
    } else {
      setSyncPrimed(true);
    }
  }

  /* Mirror settings to the server whenever they change, so a second device
     picks them up. Skipped until signed in and until the first restore has
     run, or we would immediately overwrite the server with local defaults. */
  const settingsSnapshot = JSON.stringify(settingsOf(state));
  useEffect(() => {
    if (!API_BASE || !signedIn || !state.ready) return;
    void saveSettings(auth, API_BASE, settingsOf(useApp.getState()));
  }, [settingsSnapshot, signedIn, state.ready]);

  /*
   * Being set up is a property of the ACCOUNT, not of this device.
   *
   * 'sw.onboarded' lives in localStorage, so signing in on a second device ran
   * setup again for an account that already had categories — which is what made
   * a returning user look like a new one, and left duplicate categories behind.
   * If the account already has categories, it has been set up.
   */
  useEffect(() => {
    if (onboarded || !state.ready) return;
    if (!state.categories.some((c) => !c.deleted_at)) return;
    localStorage.setItem('sw.onboarded', '1');
    setOnboarded(true);
  }, [onboarded, state.ready, state.categories]);

  /*
   * Record the wages that have already arrived.
   *
   * Money lands in a bank account, not in this app, so expecting someone to
   * log every payday was never going to hold — and it did not: a live account
   * with 31 transactions had no income at all, so the ledger saw a month of
   * spending against nothing coming in and reported the person over a thousand
   * pounds down. The expected figure is credited for each payday that has
   * passed, and they correct it if the real amount differed.
   *
   * Safe to re-run: a cycle with any income logged in it is skipped, so this
   * cannot double-pay, and correcting an amount does not invite a second wage
   * on top of it.
   */
  useEffect(() => {
    if (!state.ready || !db || state.expectedIncomeMinor <= 0) return;
    const settings = {
      cycleKind: state.cycleKind, cycleLengthDays: state.cycleLengthDays,
      cycleAnchorDate: state.cycleAnchorDate, cycleAnchorDay: state.cycleAnchorDay,
      expectedIncomeMinor: state.expectedIncomeMinor,
      budgetStartDate: state.budgetStartDate, openingCashMinor: state.openingCashMinor,
    };
    const cs = cycleSettingsOf(settings);
    const start = budgetStartOf(settings, budget.cycle);
    const due = missingPaydays(cs, start, now, state.expectedIncomeMinor, state.transactions);
    if (due.length === 0) return;
    void (async () => {
      for (const p of due) {
        await state.addTransaction(db, {
          amountMinor: p.amountMinor,
          currency: state.baseCurrency,
          categoryId: null,
          bankId: null,
          merchant: 'Pay',
          isIncome: true,
          occurredAt: p.at.toISOString(),
        });
      }
      engine?.wake();
    })();
  }, [state.ready, state.transactions.length, state.expectedIncomeMinor,
      state.budgetStartDate, state.cycleKind, state.cycleAnchorDay, state.cycleAnchorDate]);

  /*
   * Coming back to the app.
   *
   * An installed PWA is suspended, not closed. iOS can hold it for hours, and
   * the access token is fifteen minutes and memory-only, so it is almost
   * always stale on resume. Refreshing it here means the first thing the user
   * touches works, rather than failing a request and recovering afterwards.
   *
   * Cheap: one call against the cookie, only when the app actually becomes
   * visible, and only when we already believe we are signed in.
   */
  useEffect(() => {
    if (!API_BASE || !signedIn) return;
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      void auth.restoreSession().then(({ user }) => { if (user) engine?.wake(); });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn]);

  const now = useMemo(() => new Date(), []);
  /*
   * The cycle model. Memoised on the same inputs as derive() because it walks
   * every cycle since budgeting started for every pot — cheap per cycle, but
   * not something to redo on each keystroke in the add sheet.
   */
  const budgetSettings: BudgetSettings = {
    cycleKind: state.cycleKind,
    cycleLengthDays: state.cycleLengthDays,
    cycleAnchorDate: state.cycleAnchorDate,
    cycleAnchorDay: state.cycleAnchorDay,
    expectedIncomeMinor: state.expectedIncomeMinor,
    budgetStartDate: state.budgetStartDate,
    openingCashMinor: state.openingCashMinor,
  };
  /*
   * Keyed on the settings themselves, not on a hand-written list of them.
   *
   * The list was missing `openingCashMinor`. Setting a new balance on the same
   * day as the last one changed nothing else — `budgetStartDate` was already
   * today — so no dependency moved, the memo never recomputed, and every
   * figure on every screen kept using the old balance until a reload. The
   * value saved correctly the whole time, which is what made it look like the
   * setting did nothing at all.
   *
   * A snapshot of the object cannot fall behind it: a field added later is
   * covered without anyone remembering this line exists.
   */
  const budgetKey = JSON.stringify(budgetSettings);
  const budget = useMemo(
    () => buildBudget(budgetSettings, state.categories, state.transactions, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- budgetKey covers budgetSettings
    [budgetKey, state.categories, state.transactions, now],
  );


  const data: ScreenData = {
    budget,
    transactions: state.transactions,
    categories: state.categories,
    banks: state.banks,
    currency: state.baseCurrency,
    now,
    displayName: state.displayName,
    /*
     * Derived from the category limits, not the stored scalar.
     *
     * A real account had day_to_day_minor = £570 while its limits added up to
     * £830: Profile showed one figure and every calculation used the other.
     * The limits are the thing a person edits, so they are the truth.
     */
    dayToDayMinor: budget.summary.flowAllowanceMinor || state.dayToDayMinor,
    savingsTargetMinor: state.savingsTargetMinor,
    filter,
    onFilter: setFilter,
    onGoto: (t) => setTab(t),
    onEdit: (t: Transaction) => { setEditing(t); setSheetOpen(true); },
    onPutAside: (potId: string) => setPutAsideId(potId),
    onConfirmMove: async (potId: string, amountMinor: number) => {
      /* Recording that it moved, not moving it: the reservation already came
         off spending money, so this only settles the reminder. */
      if (amountMinor <= 0) return;
      const pot = budget.pots.find((p) => p.pot.id === potId);
      await state.addTransaction(db, {
        amountMinor, currency: state.baseCurrency, categoryId: potId, bankId: null,
        merchant: `Moved to ${pot?.pot.name ?? 'pot'}`, isIncome: false, isTransfer: true,
      });
      engine?.wake();
    },
    onDeleteTx: async (localId: string) => {
      await state.removeTransaction(db, localId);
      engine?.wake(); // a delete has to reach the server as promptly as a save
    },
    onEditSetting: (which) => {
      const cur = state.baseCurrency;
      if (which === 'name') {
        setValueEdit({
          kind: 'text', heading: 'Your name', value: state.displayName, currency: cur,
          onSave: (raw) => state.setSettings({ displayName: raw }),
        });
        return;
      }
      if (which === 'income') {
        setValueEdit({
          kind: 'money',
          // Per pay packet, not per month: someone on £500 a week has no
          // correct monthly figure to type.
          heading: state.cycleKind === 'monthly' ? 'Monthly income' : 'Income each payday',
          value: String(fromMinor(state.expectedIncomeMinor, cur)),
          currency: cur,
          onSave: (raw) => state.setSettings({ expectedIncomeMinor: toMinor(raw, cur) }),
        });
        return;
      }
      if (which === 'cash') {
        setValueEdit({
          kind: 'money',
          heading: 'Money you have now',
          value: String(fromMinor(state.openingCashMinor, cur)),
          currency: cur,
          onSave: (raw) => {
            /*
             * Setting this re-bases the ledger on today. Keeping an older
             * start date would replay days that already happened against a
             * balance measured after them, and the figure would be wrong the
             * moment it was entered.
             */
            const d = new Date();
            const iso = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
            state.setSettings({ openingCashMinor: toMinor(raw, cur), budgetStartDate: iso });
          },
        });
        return;
      }
      const isBudget = which === 'budget';
      setValueEdit({
        kind: 'money',
        heading: isBudget ? 'Day-to-day budget' : 'Savings target',
        value: String(fromMinor(isBudget ? state.dayToDayMinor : state.savingsTargetMinor, cur)),
        currency: cur,
        onSave: (raw) => {
          const minor = toMinor(raw, cur);
          state.setSettings(isBudget ? { dayToDayMinor: minor } : { savingsTargetMinor: minor });
        },
      });
    },
    onEditCategory: (c) => setCatEdit(c),
    onEditBank: (b) => setBankEdit(b),
    onEditAvatar: () => setAvatarOpen(true),
    ...(API_BASE && signedIn ? { onDeleteAccount: () => setDeleteOpen(true) } : {}),
    monthlyIncomeMinor: state.expectedIncomeMinor,
    identities,
    avatarEmoji: state.avatarEmoji,
    avatarColour: state.avatarColour,
    // Running purely locally there is no session to end, so Profile hides it.
    ...(API_BASE && signedIn ? { onSignOut: () => { void signOut(); } } : {}),
  };

  const tabColumn = TAB_COLUMN[tab] ?? null;

  const monthLong = now.toLocaleDateString('en-GB', { month: 'long' });
  /*
   * The pay cycle's own days-left, not the legacy derive()'s calendar-month
   * count.
   *
   * `d.daysLeft` is `daysInMonth - dayOfMonth + 1` — always calendar-month
   * scoped, regardless of how the user is actually paid. The card bodies on
   * Home and Budgets already read `budget.cycle.daysLeft`, the real pay-cycle
   * count, so for anyone not on monthly pay anchored the 1st, this header
   * disagreed with the card two lines below it on the same screen: "12 days
   * left" up top, "3 days to go" underneath. `budget` is already in scope
   * here for the same reason.
   */
  const dayWord = budget.cycle.daysLeft === 1 ? 'day' : 'days';
  const monthTxCount = state.transactions.filter((t) => {
    if (t.deleted_at) return false;
    const at = new Date(t.occurred_at);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  }).length;

  const title: Record<Tab, [string, string]> = {
    home: [
      greetingFor(state.displayName),
      // Days left lives here now; the hero card carries the saving goal instead,
      // so the two are not saying the same thing twice.
      `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${budget.cycle.daysLeft} ${dayWord} left`,
    ],
    activity: ['Activity', `${monthTxCount} ${monthTxCount === 1 ? 'transaction' : 'transactions'} this month`],
    // Not "resets in" — that implies a calendar-month reset specifically,
    // which is wrong for anyone paid weekly or fortnightly. Same "days left"
    // phrasing Home already uses, so the two headers agree with each other.
    budgets: ['Budgets', `${monthLong} · ${budget.cycle.daysLeft} ${dayWord} left`],
    // Period is chosen on the screen itself, so the subtitle must not
    // claim one.
    insights: ['Analytics', 'Where the money goes'],
    profile: ['Profile', 'Settings and categories'],
  };

  // An API is configured but nobody is signed in: show sign-in. With no API
  // the app runs entirely locally and never asks.
  /* Nothing from a signed-in session may render before we know whether there
     IS one. Falling through to the app while auth.restore() was still in
     flight flashed the home screen — including the previous user's name and
     avatar — on every refresh. */
  // Nothing from a signed-in session may render before we know whether there is
  // one, and the splash also holds for its minimum so a warm start does not
  // flash through it.
  if (!bootError && (minSplash || (API_BASE && !authChecked))) return <Splash />;

  if (API_BASE && authChecked && !signedIn) {
    return (
      <AuthScreen
        auth={auth}
        onSignedIn={(isNew, accessToken) => {
          void (async () => {
            await guardAccount(accessToken);
            setSignedIn(true);
            startSync();
            // A brand-new account has nothing to show, so always onboard it.
            if (isNew) { localStorage.removeItem('sw.onboarded'); setOnboarded(false); }
            await ensureDefaultBanks(isNew);
          })();
        }}
      />
    );
  }

  // Wait for the account's data before deciding, or the check above never gets
  // the chance to run.
  if (API_BASE && signedIn && !syncPrimed && !onboarded) return <Splash />;

  if (state.ready && !onboarded) {
    return (
      <Onboarding
        onDone={(r) => { void applyOnboarding(r); }}
        onSkip={() => { localStorage.setItem('sw.onboarded', '1'); setOnboarded(true); setShowTour(true); }}
      />
    );
  }

  return (
    <div style={{
      minHeight: '100dvh', background: 'transparent', color: 'var(--text)',
      fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
      display: 'flex', flexDirection: 'column',
    }}>
      {/*
        No background, so the ambient ground runs unbroken from the status bar
        down into the cards.
        
        It was sticky with a dark tint, which painted a hard-edged bar across
        the top of every screen. The stickiness did nothing anyway: <main> is
        the scroll container, so this header never moves — the tint was covering
        the gradient for no reason at all.
      */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)',
        padding: 'calc(var(--safe-top) + 14px) 20px 10px',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.03em' }}>{title[tab][0]}</h1>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginTop: 3 }}>{title[tab][1]}</p>
        </div>
        <button
          onClick={() => setTab('profile')}
          aria-label="Profile and settings"
          style={{
            borderRadius: 'var(--r-pill)', flexShrink: 0, padding: 0, border: 0,
            background: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}
        >
          <Avatar emoji={state.avatarEmoji} colour={state.avatarColour} name={state.displayName} size={38} />
        </button>
      </header>

      <main style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
        padding: '4px 20px calc(104px + var(--safe-bottom))',
      }}>
        {degraded && (
          <p style={{
            fontSize: 'var(--fs-2xs)', color: 'var(--warning)', background: 'var(--warning-soft)',
            padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', fontWeight: 600,
          }}>
            Offline storage unavailable ({degraded}) — this session will not be saved.
          </p>
        )}
        {bootError ? (
          <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
            Could not open local storage: {bootError}
          </p>
        ) : !state.ready ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-sm)' }}>Loading…</p>
        ) : tab === 'home' ? <Home {...data} />
          : tab === 'activity' ? <Activity {...data} />
          : tab === 'budgets' ? <Budgets {...data} />
          : tab === 'insights' ? <Insights {...data} />
          : <Profile {...data} />}
      </main>

      <AddSheet
        open={sheetOpen}
        editing={editing}
        categories={state.categories}
        banks={state.banks}
        baseCurrency={state.baseCurrency}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        onSave={async (draft: SaveDraft) => {
          if (editing) {
            await state.editTransaction(db, editing.local_id, {
              amount_minor: draft.isIncome ? draft.amountMinor : -draft.amountMinor,
              base_minor: draft.isIncome ? draft.amountMinor : -draft.amountMinor,
              category_id: draft.categoryId,
              bank_id: draft.bankId,
              merchant: draft.merchant,
              is_income: draft.isIncome,
            });
          } else {
            await state.addTransaction(db, draft);
          }
          engine?.wake(); // disk, screen, network — in that order
          setSheetOpen(false);
          setEditing(null);
        }}
      />

      {/*
        Setting money aside is a real movement, not a setting.

        It is written as a transaction flagged is_transfer, so it syncs like
        everything else and the pot balance is rebuilt from history rather than
        stored as a number that could drift out of step with it.
      */}
      {putAsideId && (() => {
        const pot = budget.pots.find((p) => p.pot.id === putAsideId);
        const cat = state.categories.find((c) => c.local_id === putAsideId);
        if (!pot || !cat) return null;
        return (
          <PutAsideSheet
            potName={pot.pot.name}
            suggestedMinor={pot.outstandingMinor}
            balanceMinor={pot.balanceMinor}
            targetMinor={pot.pot.amountMinor}
            currency={state.baseCurrency}
            freeCashMinor={budget.summary.freeCashMinor}
            onClose={() => setPutAsideId(null)}
            onSave={async (minor) => {
              await state.addTransaction(db, {
                amountMinor: minor,
                currency: state.baseCurrency,
                categoryId: putAsideId,
                bankId: null,
                merchant: `Set aside for ${pot.pot.name}`,
                isIncome: false,
                isTransfer: true,
              });
              engine?.wake();
            }}
          />
        );
      })()}

      {valueEdit && <ValueEditor edit={valueEdit} onClose={() => setValueEdit(null)} />}

      {catEdit !== undefined && (
        <CategoryEditor
          cat={catEdit}
          currency={state.baseCurrency}
          onClose={() => setCatEdit(undefined)}
          onSave={(patch) => {
            /*
             * A due day is only advice until the anchor moves with it.
             *
             * The engine dates a bill from `anchor_date`; the editor only ever
             * wrote `due_day`. So changing a bill's due date did nothing —
             * Profile showed "Due on the 18th" from the field the user typed
             * while Budgets showed the 1st from the field the engine reads.
             * Rewriting the anchor whenever a due day is given keeps one of
             * them authoritative: the day the person actually chose.
             */
            /*
             * A fixed cost is stored as a real pot, not a flow with a flag.
             *
             * The editor only ever sent `is_fixed`, so a bill created here
             * kept `kind: 'flow'` and worked solely because isPot() falls back
             * to the legacy column. Writing the pot shape means the row says
             * what it is, and migration 011 can eventually drop that fallback.
             */
            const shaped = patch.kind === 'bill'
              ? {
                  ...patch,
                  ...billFields(
                    patch.recurrence ?? 'monthly',
                    anchorFromDueDay(patch.due_day, now),
                    0,
                    patch.installments ?? null,
                  ),
                }
              : patch.kind === 'goal'
                /* A goal is a fixed cost without a date: is_fixed keeps it on
                   the commitment side of every screen that still reads that
                   column, while pot_kind carries what it actually is. */
                ? { ...patch, is_fixed: true, ...goalFields(patch.installments ?? null) }
                : { ...patch, is_fixed: false, ...flowFields() };
            void state.upsertCategory(db, shaped);
          }}
          onDelete={(localId) => { void state.removeCategory(db, localId); }}
        />
      )}

      {bankEdit !== undefined && (
        <BankEditor
          bank={bankEdit}
          onClose={() => setBankEdit(undefined)}
          onSave={(patch) => { void state.upsertBank(db, patch); }}
          onDelete={(localId) => { void state.removeBank(db, localId); }}
        />
      )}

      {avatarOpen && (
        <AvatarEditor
          emoji={state.avatarEmoji}
          colour={state.avatarColour}
          name={state.displayName}
          onClose={() => setAvatarOpen(false)}
          onSave={({ emoji, colour }) => state.setSettings({ avatarEmoji: emoji, avatarColour: colour })}
        />
      )}

      {deleteOpen && (
        <DeleteAccountEditor
          onClose={() => setDeleteOpen(false)}
          onConfirm={async () => {
            // Server first. If it fails the account still exists, and wiping
            // the device would leave the user locked out of data that is
            // still there.
            await auth.deleteAccount();
            engine?.stop();
            engine = null;
            await db.clear();
            clearSettings();
            localStorage.removeItem('sw.onboarded');
            localStorage.removeItem('sw.account');
            location.reload();
          }}
        />
      )}

      {showTour && (
        <Tour onDone={() => {
          setShowTour(false);
          localStorage.setItem('sw.tour', '1');
          setWelcome(true);
        }} />
      )}

      {/* Shown once, after the tour ends. Setup and a walkthrough back to back
          is a lot to absorb, and finishing on "you are set up" is worth more
          than dropping straight into an app you have only just been shown. */}
      {welcome && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Setup complete"
          onClick={() => setWelcome(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center',
            padding: 'var(--s5)', background: 'rgba(5,7,14,.76)', backdropFilter: 'blur(8px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(100%, 340px)', textAlign: 'center',
              background: 'var(--surface)', border: '1px solid var(--line-strong)',
              borderRadius: 'var(--r-xl)', padding: 'var(--s6) var(--s5)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <div style={{ display: 'grid', placeItems: 'center', marginBottom: 'var(--s4)' }}>
              <Logo size={56} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.03em' }}>
              {state.displayName.trim() ? `You're set, ${state.displayName.trim()}` : "You're all set"}
            </h2>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 'var(--s2)' }}>
              Add a spend with the + button whenever you pay for something.
            </p>
            <button
              type="button"
              onClick={() => setWelcome(false)}
              style={{
                width: '100%', minHeight: 48, marginTop: 'var(--s5)', border: 0,
                borderRadius: 'var(--r-md)', background: 'var(--brand)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Start
            </button>
          </div>
        </div>
      )}

      {/* Column 3 is the add button, so the tabs after it shift by one. */}
      <nav aria-label="Main" data-tour="tabs" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
        height: 'auto', paddingTop: 8, paddingBottom: 'calc(var(--safe-bottom) + 14px)',
        display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', alignItems: 'center',
        background: 'rgba(8,8,13,.90)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: '1px solid var(--line)',
      }}>
        {/*
          The oval that follows you.
          
          The bar is a five-column grid — two tabs, the add button, two more —
          so the indicator is one column wide and slides by whole columns.
          Sliding rather than reappearing is the point: it shows the move you
          just made, which a colour swap on two separate icons never does.
          Hidden on Profile, which is reached from the avatar and has no column
          of its own; parking it under an unrelated tab would just be wrong.
        */}
        {tabColumn !== null && (
          <span
            aria-hidden
            style={{
              /*
                Pinned to the nav's own content box, not to measured pixels.
                
                Twice now this has been positioned with numbers derived from
                the padding and font metrics — and twice it has sat slightly
                off, because the row's height is whatever the tallest child
                renders as, which those numbers only approximate. Spanning the
                exact area between the nav's paddings means it cannot drift:
                whatever the buttons come out as, this is the same box.
              */
              position: 'absolute',
              top: 8, bottom: 'calc(var(--safe-bottom) + 14px)',
              left: 0, width: '20%',
              pointerEvents: 'none',
              transform: `translateX(${tabColumn * 100}%)`,
              transition: 'transform .34s cubic-bezier(.34,1.28,.42,1)',
              display: 'grid', placeItems: 'center',
            }}
          >
            <span style={{
              width: 60, height: 'calc(100% - 4px)', borderRadius: 999,
              background: 'linear-gradient(180deg, rgba(241,241,247,.14), rgba(241,241,247,.04))',
              boxShadow: '0 0 22px -6px rgba(241,241,247,.34), inset 0 1px 0 rgba(255,255,255,.16)',
              border: '1px solid rgba(241,241,247,.10)',
            }} />
          </span>
        )}

        {TABS.slice(0, 2).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 700, background: 'none', border: 0, cursor: 'pointer',
              color: tab === t.id ? 'var(--text)' : 'var(--text-dim)', padding: 'var(--s2) 0',
              /* Dims and settles under the thumb, so a tap is felt as well as
                 seen — the oval slides away from where the finger is, and on
                 its own the press had no acknowledgement at all. */
              transition: 'opacity .12s ease, transform .12s ease',
            }}
            onPointerDown={(e) => {
              e.currentTarget.style.opacity = '.55';
              e.currentTarget.style.transform = 'scale(.94)';
            }}
            onPointerUp={(e) => { e.currentTarget.style.opacity = ''; e.currentTarget.style.transform = ''; }}
            onPointerLeave={(e) => { e.currentTarget.style.opacity = ''; e.currentTarget.style.transform = ''; }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.9}
                 fill="none" strokeLinecap="round" strokeLinejoin="round"
                 style={{
                   /* The icon lights inside the oval rather than merely turning
                      white, so the glow reads as one thing with the shape. */
                   filter: tab === t.id ? 'drop-shadow(0 0 7px rgba(241,241,247,.55))' : 'none',
                   transition: 'filter .28s ease',
                 }}>
              <path d={t.path} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}

        <button
          onClick={() => { setEditing(null); setSheetOpen(true); }}
          aria-label="Add transaction"
          data-tour="add"
          style={{
            /* A squircle, not a circle: the tri-colour gradient and halo read
               as a toy next to the rest of the app. One brand colour, one soft
               shadow, and the shape the tab icons already use. */
            width: 50, height: 50, borderRadius: 'var(--r-md)', justifySelf: 'center', border: 0,
            background: 'var(--brand)',
            color: 'var(--on-accent)', display: 'grid', placeItems: 'center', cursor: 'pointer',
            boxShadow: '0 10px 26px -12px rgba(194,214,232,.75)',
            transition: 'transform .14s cubic-bezier(.2,.9,.25,1), background .14s ease',
          }}
          onPointerDown={(e) => { e.currentTarget.style.transform = 'scale(.93)'; }}
          onPointerUp={(e) => { e.currentTarget.style.transform = ''; }}
          onPointerLeave={(e) => { e.currentTarget.style.transform = ''; }}
        >
          <svg viewBox="0 0 24 24" width={26} height={26} stroke="currentColor" strokeWidth={2.6}
               fill="none" strokeLinecap="round"><path d="M12 5.5v13M5.5 12h13" /></svg>
        </button>

        {TABS.slice(2).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 700, background: 'none', border: 0, cursor: 'pointer',
              color: tab === t.id ? 'var(--text)' : 'var(--text-dim)', padding: 'var(--s2) 0',
              /* Dims and settles under the thumb, so a tap is felt as well as
                 seen — the oval slides away from where the finger is, and on
                 its own the press had no acknowledgement at all. */
              transition: 'opacity .12s ease, transform .12s ease',
            }}
            onPointerDown={(e) => {
              e.currentTarget.style.opacity = '.55';
              e.currentTarget.style.transform = 'scale(.94)';
            }}
            onPointerUp={(e) => { e.currentTarget.style.opacity = ''; e.currentTarget.style.transform = ''; }}
            onPointerLeave={(e) => { e.currentTarget.style.opacity = ''; e.currentTarget.style.transform = ''; }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.9}
                 fill="none" strokeLinecap="round" strokeLinejoin="round"
                 style={{
                   /* The icon lights inside the oval rather than merely turning
                      white, so the glow reads as one thing with the shape. */
                   filter: tab === t.id ? 'drop-shadow(0 0 7px rgba(241,241,247,.55))' : 'none',
                   transition: 'filter .28s ease',
                 }}>
              <path d={t.path} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
