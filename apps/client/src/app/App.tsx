import { formatMoney, uuidv7, toMinor } from '@spendwise/shared-types';

/**
 * Phase 2 placeholder shell.
 *
 * Its job right now is to prove the wiring end to end: the client resolves
 * `@spendwise/shared-types` across the workspace, the currency helpers behave
 * the same here as they do on the server, and the design tokens load. The five
 * real screens arrive in Phase 4, ported from the prototype at the repo root.
 */
export function App(): JSX.Element {
  const samples: ReadonlyArray<readonly [string, string]> = [
    ['24.00', 'GBP'],
    ['1000', 'JPY'],
    ['1.000', 'KWD'],
    ['19.99', 'EUR'],
  ];

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'Plus Jakarta Sans', -apple-system, system-ui, sans-serif",
        padding: 'var(--s6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s4)',
      }}
    >
      <header>
        <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-0.03em' }}>
          SpendWise
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)', marginTop: 4 }}>
          Phase 2 scaffold — shared-types wired, screens land in Phase 4
        </p>
      </header>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)',
          padding: 'var(--s5)',
        }}
      >
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--s3)' }}>
          Currency minor units
        </h2>
        <ul style={{ listStyle: 'none', display: 'grid', gap: 'var(--s2)' }}>
          {samples.map(([amount, code]) => (
            <li
              key={code}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--fs-sm)',
              }}
            >
              <span style={{ color: 'var(--text-dim)' }}>
                {amount} {code} → {toMinor(amount, code)} minor
              </span>
              <span className="num" style={{ fontWeight: 700 }}>
                {formatMoney(toMinor(amount, code), code)}
              </span>
            </li>
          ))}
        </ul>
        <p
          style={{
            fontSize: 'var(--fs-2xs)',
            color: 'var(--text-dim)',
            marginTop: 'var(--s3)',
          }}
        >
          All four store as integers; JPY has no decimal places, KWD has three.
        </p>
      </section>

      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)',
          padding: 'var(--s5)',
        }}
      >
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--s3)' }}>
          Client-generated record id
        </h2>
        <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand-cyan)', wordBreak: 'break-all' }}>
          {uuidv7()}
        </code>
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 'var(--s2)' }}>
          UUIDv7 — time-ordered, minted offline, permanent primary key.
        </p>
      </section>
    </main>
  );
}
