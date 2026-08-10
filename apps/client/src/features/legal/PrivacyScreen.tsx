import { PRIVACY_SECTIONS, POLICY_VERSION } from './privacy.js';

/**
 * The full notice, readable before anyone signs in.
 *
 * A link that opens the policy in a new tab would fail offline and on the
 * installed app, and "informed" consent that depends on a working network is
 * not informed. It ships with the bundle.
 */
export function PrivacyScreen({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <main style={{
      minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)',
      overflowY: 'auto',
    }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 'var(--s3)',
        padding: 'var(--s4) var(--s5)',
      }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            width: 40, height: 40, borderRadius: 'var(--r-md)', border: 0, cursor: 'pointer',
            background: 'var(--surface-2)', color: 'var(--text-muted)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 24 24" width={20} height={20} stroke="currentColor" strokeWidth={2.2}
               fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, letterSpacing: '-.02em' }}>Privacy notice</h1>
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, marginTop: 2 }}>
            Updated {POLICY_VERSION}
          </p>
        </div>
      </div>

      <div style={{ padding: 'var(--s5)', paddingBottom: 'var(--s7)', maxWidth: 640, marginInline: 'auto' }}>
        {PRIVACY_SECTIONS.map((sec) => (
          <section key={sec.heading} style={{ marginBottom: 'var(--s6)' }}>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, letterSpacing: '-.02em', marginBottom: 'var(--s2)' }}>
              {sec.heading}
            </h2>
            {sec.body.map((para) => (
              <p key={para} style={{
                fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--text-muted)',
                marginBottom: 'var(--s2)',
              }}>{para}</p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
