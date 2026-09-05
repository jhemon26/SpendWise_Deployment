import { useEffect, useState } from 'react';
import { formatMoney, fromMinor, toMinor } from '@spendwise/shared-types';

/**
 * Setting money aside, by hand.
 *
 * The app recommends a figure each cycle, but the decision is the user's: a
 * bigger pay packet than expected is exactly when someone wants to put more
 * toward the rent. Overwriting the amount is the point of this sheet, so it
 * opens with the recommendation already filled in and selected — one tap to
 * accept, or type over it.
 *
 * Whatever goes in is recorded as a real movement. Next cycle's recommendation
 * is recomputed from the new balance, so putting in more lowers the next ask
 * and skipping a cycle raises it. Nothing needs to be reconciled by hand.
 */
export function PutAsideSheet({
  potName, suggestedMinor, balanceMinor, targetMinor, currency, freeCashMinor,
  onClose, onSave,
}: {
  potName: string;
  suggestedMinor: number;
  balanceMinor: number;
  targetMinor: number;
  currency: string;
  freeCashMinor: number;
  onClose: () => void;
  onSave: (minor: number) => void | Promise<void>;
}): JSX.Element {
  const [raw, setRaw] = useState(() => String(fromMinor(Math.max(0, suggestedMinor), currency)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let minor = 0;
  try { minor = raw.trim() ? toMinor(raw, currency) : 0; } catch { minor = 0; }

  const after = balanceMinor + minor;
  const stillNeeded = Math.max(0, targetMinor - after);
  // A warning, not a block. Someone may be moving money the app has not seen.
  const overCash = minor > freeCashMinor;

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Set aside for ${potName}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(8,8,13,.66)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: 'var(--surface-solid, #0f0f14)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          border: '1px solid var(--line)', borderBottom: 0,
          padding: `20px 20px calc(20px + var(--safe-bottom, 0px))`,
          display: 'grid', gap: 'var(--s4)', position: 'relative',
        }}
      >
        {/* Same corner control as every other sheet. */}
        <button
          type="button" onClick={onClose} aria-label="Close"
          style={{
            position: 'absolute', top: 'var(--s4)', right: 'var(--s4)', width: 32, height: 32,
            display: 'grid', placeItems: 'center', borderRadius: 999, border: 0,
            background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer',
          }}
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor"
               strokeWidth={2.4} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div>
          <p style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            Set aside
          </p>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, letterSpacing: '-.03em', marginTop: 4 }}>
            {potName}
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
          <span className="num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-dim)' }}>
            {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
          </span>
          <input
            autoFocus
            inputMode="decimal"
            value={raw}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9.]/g, '').slice(0, 9))}
            onKeyDown={(e) => { if (e.key === 'Enter' && minor > 0) void submit(); }}
            aria-label={`Amount to set aside for ${potName}`}
            className="num"
            size={Math.max(1, raw.length || 1)}
            style={{
              background: 'none', border: 0, outline: 'none', color: 'var(--text)',
              fontSize: 40, fontWeight: 700, letterSpacing: '-.04em', width: 'auto', minWidth: 40,
            }}
          />
        </div>

        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, textAlign: 'center' }}>
          {suggestedMinor > 0
            ? <>We suggested <span className="num">{formatMoney(suggestedMinor, currency)}</span> this time. </>
            : <>Nothing is needed this time. </>}
          {stillNeeded > 0
            ? <>After this, <span className="num">{formatMoney(stillNeeded, currency)}</span> still to find.</>
            : <>That covers it.</>}
        </p>

        {overCash && (
          <p style={{
            fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--warning)',
            background: 'var(--warning-soft, rgba(224,178,76,.10))', borderRadius: 'var(--r-md)',
            padding: '10px 12px', textAlign: 'center',
          }}>
            That is more than the <span className="num">{formatMoney(Math.max(0, freeCashMinor), currency)}</span>{' '}
            you have spare. Saved anyway if you mean it.
          </p>
        )}

        <div style={{ display: 'grid', gap: 'var(--s3)' }}>
          <button
            type="button" disabled={minor <= 0 || busy} onClick={() => void submit()}
            style={{
              ...btn('var(--brand)', 'var(--on-accent)'),
              opacity: minor <= 0 || busy ? .5 : 1,
              cursor: minor <= 0 || busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Saving…' : `Set aside ${formatMoney(minor, currency)}`}
          </button>
        </div>
      </div>
    </div>
  );

  async function submit(): Promise<void> {
    if (minor <= 0 || busy) return;
    setBusy(true);
    try { await onSave(minor); onClose(); } finally { setBusy(false); }
  }
}

const btn = (bg: string, fg: string): React.CSSProperties => ({
  padding: '14px 16px', borderRadius: 'var(--r-pill)', border: 0,
  background: bg, color: fg, fontSize: 'var(--fs-sm)', fontWeight: 700, cursor: 'pointer',
});
