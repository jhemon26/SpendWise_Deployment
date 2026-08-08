import { useEffect, useRef, useState } from 'react';
import type { AuthClient } from '../../core/auth/client.js';
import { isValidPhoneE164, normalizePhoneE164 } from './phone.js';

/**
 * Sign-in (ARCHITECTURE §9.1).
 *
 * Passwordless: no password field, no "create account" form.
 *
 * Four things here are load-bearing on a phone and easy to leave out:
 *   - autoComplete="one-time-code" so iOS and Android offer the SMS code from
 *     the keyboard. Without it every user retypes six digits by hand.
 *   - Six boxes that accept a PASTE into any of them, because people copy the
 *     whole code out of the message.
 *   - A resend countdown, so "nothing happened" has an obvious next step
 *     instead of the user hammering a rate-limited button.
 *   - Errors that name the fix, not the failure.
 */

export interface AuthScreenProps {
  auth: AuthClient;
  onSignedIn: (isNewAccount: boolean) => void;
  /** Absent until real OAuth client ids are configured. */
  oidcAvailable?: boolean;
}

type Stage = 'choose' | 'phone' | 'code';

const FRIENDLY: Record<string, string> = {
  network_error: "Can't reach SpendWise. Check your connection and try again.",
  otp_send_failed: "That number didn't work. Check it and try again.",
  rate_limited_target: 'Too many codes for that number. Try again in an hour.',
  rate_limited_ip: 'Too many sign-in attempts. Try again later.',
  spend_ceiling: 'Text messages are unavailable right now. Please try again shortly.',
  blocked_prefix: "We can't send codes to that number.",
  bad_code: "That code isn't right.",
  expired: 'That code expired. Send a new one.',
  too_many_attempts: 'Too many tries. Send a new code.',
  not_found: 'That code expired. Send a new one.',
};

const RESEND_SECONDS = 30;

/** Enough to cover the realistic cases without dragging in a country picker. */
const DIAL_CODES = ['+44', '+353', '+1', '+33', '+34', '+49', '+39', '+31', '+61', '+64', '+91', '+880'];

export function AuthScreen({ auth, onSignedIn, oidcAvailable = false }: AuthScreenProps): JSX.Element {
  const [stage, setStage] = useState<Stage>(oidcAvailable ? 'choose' : 'phone');
  const [dial, setDial] = useState('+44');
  const [local, setLocal] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join('');

  /* The leading 0 is a national-dialling prefix and is NOT part of the E.164
     number: +44 07424… and +44 7424… are the same phone but would otherwise
     become two separate accounts. Splitting the dial code off makes that
     impossible to type in the first place. */
  const phone = `${dial}${local.replace(/\D/g, '').replace(/^0+/, '')}`;
  const validPhone = isValidPhoneE164(phone);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const say = (err: unknown): void => {
    const c = (err as { code?: string }).code ?? '';
    setError(FRIENDLY[c] ?? 'Something went wrong. Please try again.');
  };

  async function send(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const { challengeId: id } = await auth.sendOtp(normalizePhoneE164(phone));
      setChallengeId(id);
      setDigits(Array(6).fill(''));
      setCooldown(RESEND_SECONDS);
      setStage('code');
      setTimeout(() => boxes.current[0]?.focus(), 60);
    } catch (err) { say(err); } finally { setBusy(false); }
  }

  async function verify(full = code): Promise<void> {
    if (full.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const user = await auth.verifyOtp(challengeId, full);
      onSignedIn(user.isNewAccount);
    } catch (err) {
      say(err);
      setDigits(Array(6).fill(''));
      boxes.current[0]?.focus();
    } finally { setBusy(false); }
  }

  /** Accept a full paste into any box, not just the first. */
  function onDigit(i: number, raw: string): void {
    const only = raw.replace(/\D/g, '');
    if (only.length > 1) {
      const next = [...digits];
      for (let k = 0; k < only.length && i + k < 6; k++) next[i + k] = only[k]!;
      setDigits(next);
      boxes.current[Math.min(i + only.length, 5)]?.focus();
      if (next.join('').length === 6) void verify(next.join(''));
      return;
    }
    const next = [...digits];
    next[i] = only;
    setDigits(next);
    if (only && i < 5) boxes.current[i + 1]?.focus();
    const filled = next.join('');
    if (filled.length === 6 && !filled.includes('')) void verify(filled);
  }

  function onDigitKey(i: number, e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) boxes.current[i + 1]?.focus();
  }

  return (
    <main style={page}>
      <div style={glow} aria-hidden="true" />
      <section style={shell}>
        <header style={{ textAlign: 'center' }}>
          <img src="/icon-192.png" alt="" width={60} height={60} style={mark} />
          <h1 style={headline}>
            {stage === 'code' ? 'Enter your code'
              : stage === 'phone' ? 'Sign in to SpendWise'
                : 'Know what you can spend'}
          </h1>
          <p style={subhead}>
            {stage === 'code'
              ? <>We texted a 6-digit code to <b style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{phone}</b></>
              : stage === 'phone' ? 'Enter your mobile number and we’ll text you a code.'
                : 'Track every penny. Works with no signal.'}
          </p>
        </header>

        <div style={card}>
          {error && (
            <p role="alert" style={errorBox}>
              <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden stroke="currentColor" strokeWidth={2.2}
                   fill="none" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" />
              </svg>
              <span>{error}</span>
            </p>
          )}

          {stage === 'choose' && (
            <div style={stack}>
              <Provider kind="google" disabled={!oidcAvailable} />
              <Provider kind="apple" disabled={!oidcAvailable} />
              <div style={divider}><i style={rule} /><span>or</span><i style={rule} /></div>
              <button type="button" onClick={() => setStage('phone')} style={secondary}>
                Continue with phone
              </button>
            </div>
          )}

          {stage === 'phone' && (
            <div style={stack}>
              <label htmlFor="sw-phone" style={fieldLabel}>Mobile number</label>
              <div style={phoneRow}>
                <select
                  value={dial}
                  onChange={(e) => setDial(e.target.value)}
                  aria-label="Country dialling code"
                  style={dialSelect}
                >
                  {DIAL_CODES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input
                  id="sw-phone"
                  autoFocus
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && validPhone) void send(); }}
                  placeholder="7700 900000"
                  style={phoneInput}
                />
              </div>

              <button type="button" disabled={!validPhone || busy} onClick={() => void send()} style={primary(!validPhone || busy)}>
                {busy ? <><Spinner />Sending…</> : 'Send code'}
              </button>

              {oidcAvailable && (
                <button type="button" onClick={() => { setStage('choose'); setError(null); }} style={ghost}>
                  More sign-in options
                </button>
              )}
            </div>
          )}

          {stage === 'code' && (
            <div style={stack}>
              <div style={boxRow}>
                {digits.map((dgt, i) => (
                  <input
                    key={i}
                    ref={(el) => { boxes.current[i] = el; }}
                    value={dgt}
                    onChange={(e) => onDigit(i, e.target.value)}
                    onKeyDown={(e) => onDigitKey(i, e)}
                    inputMode="numeric"
                    // What makes iOS and Android offer the code from the
                    // keyboard instead of making people retype it.
                    autoComplete="one-time-code"
                    maxLength={6}
                    aria-label={`Digit ${i + 1}`}
                    style={digitBox(Boolean(dgt))}
                  />
                ))}
              </div>

              <button type="button" disabled={code.length !== 6 || busy} onClick={() => void verify()} style={primary(code.length !== 6 || busy)}>
                {busy ? <><Spinner />Checking…</> : 'Verify and continue'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void send()}
                  style={{ ...linkBtn, opacity: cooldown > 0 ? .45 : 1, cursor: cooldown > 0 ? 'default' : 'pointer' }}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
                <span aria-hidden style={{ color: 'var(--text-dim)' }}>·</span>
                <button type="button" onClick={() => { setStage('phone'); setError(null); }} style={linkBtn}>
                  Change number
                </button>
              </div>
            </div>
          )}
        </div>

        <p style={microcopy}>
          <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden stroke="currentColor" strokeWidth={2}
               fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
          No passwords. Your data stays on this device first.
        </p>
      </section>
    </main>
  );
}

function Spinner(): JSX.Element {
  return (
    <>
      <span aria-hidden style={{
        width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
        border: '2px solid rgba(255,255,255,.35)', borderTopColor: '#fff',
        animation: 'sw-spin .7s linear infinite',
      }} />
      <style>{'@keyframes sw-spin{to{transform:rotate(360deg)}}'}</style>
    </>
  );
}

function Provider({ kind, disabled }: { kind: 'google' | 'apple'; disabled: boolean }): JSX.Element {
  const label = kind === 'google' ? 'Continue with Google' : 'Continue with Apple';
  return (
    <button type="button" disabled={disabled} style={{ ...secondary, opacity: disabled ? .4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span style={badge}>{kind === 'google' ? 'G' : ''}</span>
      {label}
    </button>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const page: React.CSSProperties = {
  position: 'relative',
  minHeight: '100dvh',
  background: 'var(--bg)',
  color: 'var(--text)',
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--s5)',
  overflow: 'hidden',
};

/** One soft brand bloom behind the card, rather than competing gradients. */
const glow: React.CSSProperties = {
  position: 'absolute', top: '-22%', left: '50%', transform: 'translateX(-50%)',
  width: 'min(560px, 130vw)', aspectRatio: '1', borderRadius: '50%', pointerEvents: 'none',
  background: 'radial-gradient(circle, rgba(99,102,241,.20) 0%, rgba(6,182,212,.08) 42%, transparent 68%)',
};

const shell: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: 'min(100%, 400px)',
  display: 'grid', gap: 'var(--s5)',
};

const mark: React.CSSProperties = { borderRadius: 17, marginBottom: 'var(--s4)' };

const headline: React.CSSProperties = {
  fontSize: 25, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15,
};

const subhead: React.CSSProperties = {
  fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5,
};

const card: React.CSSProperties = {
  padding: 'var(--s5)', borderRadius: 22,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  boxShadow: 'var(--shadow)',
};

const stack: React.CSSProperties = { display: 'grid', gap: 'var(--s3)' };

const errorBox: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'flex-start',
  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--danger)',
  background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)',
  padding: 'var(--s3)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s4)',
  lineHeight: 1.4,
};

const fieldLabel: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};

const phoneRow: React.CSSProperties = {
  display: 'flex', alignItems: 'stretch',
  background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', overflow: 'hidden',
};

const dialSelect: React.CSSProperties = {
  appearance: 'none', background: 'transparent', border: 0, outline: 'none',
  padding: '0 var(--s3) 0 var(--s4)', color: 'var(--text)',
  fontSize: 17, fontWeight: 700, cursor: 'pointer',
  borderRight: '1px solid var(--line)',
};

const phoneInput: React.CSSProperties = {
  flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none',
  padding: '16px var(--s4)', fontSize: 17, fontWeight: 600,
  color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
};

const boxRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8, marginBottom: 'var(--s2)',
};

const digitBox = (filled: boolean): React.CSSProperties => ({
  width: '100%', aspectRatio: '1 / 1.2', textAlign: 'center',
  fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
  color: 'var(--text)', background: filled ? 'var(--brand-soft)' : 'var(--surface-2)',
  border: `1.5px solid ${filled ? 'var(--line-brand)' : 'var(--line)'}`,
  borderRadius: 14, outline: 'none', padding: 0,
  transition: 'background .15s, border-color .15s',
});

// 52px minimum: below ~44px taps start missing on a phone.
const base: React.CSSProperties = {
  width: '100%', minHeight: 52, borderRadius: 'var(--r-md)', border: 0,
  fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
};

const primary = (disabled: boolean): React.CSSProperties => ({
  ...base, background: 'var(--brand)', color: '#fff',
  boxShadow: disabled ? 'none' : '0 8px 22px -10px rgba(99,102,241,.9)',
  opacity: disabled ? .35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'opacity .15s ease, box-shadow .15s ease',
});

const secondary: React.CSSProperties = {
  ...base, background: 'var(--surface-2)', color: 'var(--text)',
  border: '1px solid var(--line)',
};

const ghost: React.CSSProperties = {
  ...base, minHeight: 44, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600,
};

const linkBtn: React.CSSProperties = {
  background: 'none', border: 0, padding: '6px 2px',
  fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--brand)', cursor: 'pointer',
};

const divider: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12,
  color: 'var(--text-dim)', fontSize: 'var(--fs-2xs)', fontWeight: 700,
  letterSpacing: '.1em', textTransform: 'uppercase', padding: 'var(--s1) 0',
};
const rule: React.CSSProperties = { height: 1, background: 'var(--line)' };

const badge: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center',
  background: 'var(--surface-3)', fontSize: 13, fontWeight: 800,
};

const microcopy: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center',
};
