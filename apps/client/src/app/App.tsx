import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../core/store.js';
import { MemoryAdapter, type StorageAdapter } from '../core/db/adapter.js';
import { derive } from '../features/insights/selectors.js';
import { seedDemo } from '../features/onboarding/demo.js';
import { Home, Activity, Budgets, Insights, Profile, type ScreenData } from './screens.js';

type Tab = 'home' | 'activity' | 'budgets' | 'insights' | 'profile';

const TABS: Array<{ id: Tab; label: string; path: string }> = [
  { id: 'home', label: 'Home', path: 'M3 10.2 12 3l9 7.2M5.5 9.4V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.4' },
  { id: 'activity', label: 'Activity', path: 'M4 6h16M4 12h16M4 18h10' },
  { id: 'budgets', label: 'Budgets', path: 'M3 6h18v13H3zM3 10h18' },
  { id: 'insights', label: 'Insights', path: 'M4 16l5-5 3.5 3.5L20 7M15 7h5v5' },
];

/** Single adapter for the app's lifetime. Dexie swaps in here on web. */
const db: StorageAdapter = new MemoryAdapter();

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home');
  const state = useApp();

  useEffect(() => {
    void (async () => {
      await db.init();
      // Nobody meets an empty app (ARCHITECTURE §3.5). Real onboarding replaces
      // this with the setup wizard; the shape of the data is identical.
      if ((await db.all('transactions')).length === 0) await seedDemo(db);
      await state.hydrate(db);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = useMemo(() => new Date(), []);
  const d = useMemo(
    () => derive(state.transactions, state.categories, {
      now,
      dayToDayMinor: state.dayToDayMinor,
      savingsTargetMinor: state.savingsTargetMinor,
    }),
    [state.transactions, state.categories, state.dayToDayMinor, state.savingsTargetMinor, now],
  );

  const data: ScreenData = {
    transactions: state.transactions,
    categories: state.categories,
    d,
    currency: state.baseCurrency,
    now,
    displayName: state.displayName,
    dayToDayMinor: state.dayToDayMinor,
  };

  const title: Record<Tab, [string, string]> = {
    home: [`Hi, ${state.displayName}`, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })],
    activity: ['Activity', `${state.transactions.filter((t) => !t.deleted_at).length} transactions`],
    budgets: ['Budgets', `Resets in ${d.daysLeft} days`],
    insights: ['Insights', 'This month'],
    profile: ['Profile', 'Settings and categories'],
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
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
            width: 40, height: 40, borderRadius: 'var(--r-pill)', flexShrink: 0, padding: 2, border: 0,
            background: 'linear-gradient(135deg,var(--brand-cyan),var(--brand),var(--brand-purple))',
            cursor: 'pointer',
          }}
        >
          <span style={{
            width: '100%', height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--surface)',
            color: '#fff', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-sm)', fontWeight: 800,
          }}>{state.displayName.slice(0, 1).toUpperCase()}</span>
        </button>
      </header>

      <main style={{ flex: 1, overflowY: 'auto', padding: '0 var(--s5) 104px', display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        {!state.ready ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-sm)' }}>Loading…</p>
        ) : tab === 'home' ? <Home {...data} />
          : tab === 'activity' ? <Activity {...data} />
          : tab === 'budgets' ? <Budgets {...data} />
          : tab === 'insights' ? <Insights {...data} />
          : <Profile {...data} />}
      </main>

      <nav aria-label="Main" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, height: 84, paddingBottom: 12,
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', alignItems: 'center',
        background: 'rgba(6,7,10,.94)', backdropFilter: 'blur(20px)', borderTop: '1px solid var(--line)',
      }}>
        {TABS.map((t) => (
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
