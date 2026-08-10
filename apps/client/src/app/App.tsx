import { useEffect, useMemo, useState } from 'react';
import { toMinor, fromMinor, type Bank, type Category, type Transaction } from '@spendwise/shared-types';
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
import { derive, billsFor, fixedCostsTotalMinor } from '../features/insights/selectors.js';
import { seedDemo } from '../features/onboarding/demo.js';
import { Home, Activity, Budgets, Insights, Profile, type ScreenData, type TxFilter } from './screens.js';
import { Avatar, greetingFor } from '../design-system/components.js';
import { Logo } from '../design-system/Logo.js';

type Tab = 'home' | 'activity' | 'budgets' | 'insights' | 'profile';

const TABS: Array<{ id: Tab; label: string; path: string }> = [
  { id: 'home', label: 'Home', path: 'M3 10.2 12 3l9 7.2M5.5 9.4V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.4' },
  { id: 'activity', label: 'Activity', path: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'budgets', label: 'Budgets', path: 'M3 6h18v13H3zM3 10h18' },
  { id: 'insights', label: 'Insights', path: 'M4 16l5-5 3.5 3.5L20 7M15 7h5v5' },
];

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
 */
const API_BASE = (import.meta.env['VITE_API_BASE'] as string | undefined) ?? '';
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
  const [showTour, setShowTour] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [filter, setFilter] = useState<TxFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
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
      monthlyIncomeMinor: r.monthlyIncomeMinor,
      dayToDayMinor: r.budgets.reduce((s, b) => s + b.limitMinor, 0) || state.dayToDayMinor,
      savingsTargetMinor: Math.max(
        0,
        r.monthlyIncomeMinor
          - r.budgets.reduce((s, b) => s + b.limitMinor, 0)
          - r.fixedCosts.reduce((s, f) => s + f.limitMinor, 0),
      ),
    });
    for (const b of r.budgets) {
      await state.upsertCategory(db, {
        name: b.name, icon: b.icon, colour: b.colour, limit_minor: b.limitMinor,
        is_fixed: false, due_day: null,
      });
    }
    for (const f of r.fixedCosts) {
      await state.upsertCategory(db, {
        name: f.name, icon: f.icon, colour: f.colour, limit_minor: f.limitMinor,
        is_fixed: true, due_day: f.dueDay,
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
    await auth.logout().catch(() => undefined);
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
        // Refresh failed for good — reuse detection may have killed the family.
        setSignedIn(false);
        engine?.stop();
        engine = null;
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

  const now = useMemo(() => new Date(), []);
  // Scheduled fixed costs, not what has been paid — see MonthContext.
  const fixedCostsMinor = useMemo(
    () => fixedCostsTotalMinor(billsFor(state.categories, state.transactions, now)),
    [state.categories, state.transactions, now],
  );
  const d = useMemo(
    () => derive(state.transactions, state.categories, {
      now,
      dayToDayMinor: state.dayToDayMinor,
      savingsTargetMinor: state.savingsTargetMinor,
      fixedCostsMinor,
    }),
    [state.transactions, state.categories, state.dayToDayMinor, state.savingsTargetMinor, fixedCostsMinor, now],
  );

  const data: ScreenData = {
    transactions: state.transactions,
    categories: state.categories,
    banks: state.banks,
    d,
    currency: state.baseCurrency,
    now,
    displayName: state.displayName,
    dayToDayMinor: state.dayToDayMinor,
    savingsTargetMinor: state.savingsTargetMinor,
    filter,
    onFilter: setFilter,
    onGoto: (t) => setTab(t),
    onEdit: (t: Transaction) => { setEditing(t); setSheetOpen(true); },
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
          heading: 'Monthly income',
          value: String(fromMinor(state.monthlyIncomeMinor, cur)),
          currency: cur,
          onSave: (raw) => state.setSettings({ monthlyIncomeMinor: toMinor(raw, cur) }),
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
    monthlyIncomeMinor: state.monthlyIncomeMinor,
    identities,
    avatarEmoji: state.avatarEmoji,
    avatarColour: state.avatarColour,
    // Running purely locally there is no session to end, so Profile hides it.
    ...(API_BASE && signedIn ? { onSignOut: () => { void signOut(); } } : {}),
  };

  const monthLong = now.toLocaleDateString('en-GB', { month: 'long' });
  const dayWord = d.daysLeft === 1 ? 'day' : 'days';
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
      `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.daysLeft} ${dayWord} left`,
    ],
    activity: ['Activity', `${monthTxCount} ${monthTxCount === 1 ? 'transaction' : 'transactions'} this month`],
    budgets: ['Budgets', `${monthLong} · resets in ${d.daysLeft} ${dayWord}`],
    insights: ['Insights', 'Last 6 months'],
    profile: ['Profile', 'Settings and categories'],
  };

  // An API is configured but nobody is signed in: show sign-in. With no API
  // the app runs entirely locally and never asks.
  /* Nothing from a signed-in session may render before we know whether there
     IS one. Falling through to the app while auth.restore() was still in
     flight flashed the home screen — including the previous user's name and
     avatar — on every refresh. */
  if (API_BASE && !authChecked && !bootError) {
    return (
      <main style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center',
        // Same treatment as the sign-in screen, so the handover is invisible.
        background: 'var(--page-bg)',
      }}>
        <Logo size={64} />
      </main>
    );
  }

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
  if (API_BASE && signedIn && !syncPrimed && !onboarded) {
    return (
      <main style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--page-bg)',
      }}>
        <Logo size={64} />
      </main>
    );
  }

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
      minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
      display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)',
        padding: 'var(--s5) var(--s5) var(--s3)', position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--bg)',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.03em' }}>{title[tab][0]}</h1>
          <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-dim)', marginTop: 2 }}>{title[tab][1]}</p>
        </div>
        <button
          onClick={() => setTab('profile')}
          aria-label="Profile and settings"
          style={{
            borderRadius: 'var(--r-pill)', flexShrink: 0, padding: 0, border: 0,
            background: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}
        >
          <Avatar emoji={state.avatarEmoji} colour={state.avatarColour} name={state.displayName} size={40} />
        </button>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '0 var(--s5) 104px', display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
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
        onDelete={async (localId) => {
          await state.removeTransaction(db, localId);
          setSheetOpen(false);
          setEditing(null);
        }}
      />

      {valueEdit && <ValueEditor edit={valueEdit} onClose={() => setValueEdit(null)} />}

      {catEdit !== undefined && (
        <CategoryEditor
          cat={catEdit}
          currency={state.baseCurrency}
          onClose={() => setCatEdit(undefined)}
          onSave={(patch) => { void state.upsertCategory(db, patch); }}
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
                borderRadius: 'var(--r-md)', background: 'var(--brand)', color: '#fff',
                fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Start
            </button>
          </div>
        </div>
      )}

      <nav aria-label="Main" data-tour="tabs" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, height: 84, paddingBottom: 12,
        display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', alignItems: 'center',
        background: 'color-mix(in srgb, var(--bg) 94%, transparent)', backdropFilter: 'blur(20px)', borderTop: '1px solid var(--line)',
      }}>
        {TABS.slice(0, 2).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              fontSize: 10, fontWeight: 700, background: 'none', border: 0, cursor: 'pointer',
              color: tab === t.id ? 'var(--text)' : 'var(--text-dim)', padding: 'var(--s2) 0',
            }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.9}
                 fill="none" strokeLinecap="round" strokeLinejoin="round">
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
            width: 54, height: 54, borderRadius: 'var(--r-md)', justifySelf: 'center', border: 0,
            background: 'var(--brand)',
            color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer',
            boxShadow: '0 10px 24px -10px rgba(99,102,241,.95)',
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
            }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.9}
                 fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.path} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
