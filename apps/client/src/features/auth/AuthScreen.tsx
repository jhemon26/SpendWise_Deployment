import { useEffect, useRef, useState } from 'react';
import type { AuthClient } from '../../core/auth/client.js';
import { isValidPhoneE164, normalizePhoneE164 } from './phone.js';
import { GOOGLE_CLIENT_ID, newNonce, renderGoogleButton } from './google.js';

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
  /** The access token comes through so the app can tell WHICH account this is. */
  onSignedIn: (isNewAccount: boolean, accessToken: string) => void;
  /** Absent until real OAuth client ids are configured. */
  oidcAvailable?: boolean;
}

type Stage = 'choose' | 'phone' | 'code';

const FRIENDLY: Record<string, string> = {
  network_error: "Can't reach SpendWise. Check your connection and try again.",
  otp_send_failed: "That number didn't work. Check it and try again.",
  oidc_failed: 'Google could not verify that sign-in. Please try again.',
  nonce_mismatch: 'That sign-in expired. Please try again.',
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
  const [stage, setStage] = useState<Stage>('choose');
  // Shown, not hidden: this is the shipping layout. Tapping an unconfigured
  // provider says so plainly rather than failing silently or faking success.
  const [soon, setSoon] = useState<string | null>(null);
  const [dial, setDial] = useState('+44');
  const [local, setLocal] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const googleSlot = useRef<HTMLDivElement | null>(null);
  const [googleReady] = useState(true);
  // Whatever Google actually painted; every other button matches it exactly.
  const [row, setRow] = useState<{ width: number | null; height: number }>({ width: null, height: 44 });
  // One nonce per mounted screen; the server checks it against the token.
  const nonce = useRef<string>(newNonce());

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

  /* Google's own button, rendered in place. It only exists on the chooser, so
     this waits for that stage rather than for mount. */
  useEffect(() => {
    if (stage !== 'choose' || !GOOGLE_CLIENT_ID) return;
    const host = googleSlot.current;
    if (!host) return;
    void renderGoogleButton(
      host,
      nonce.current,
      (idToken: string) => {
        setBusy(true); setError(null);
        auth.oidcCallback('google', idToken, nonce.current)
          .then((user) => onSignedIn(user.isNewAccount, user.accessToken))
          .catch((e: unknown) => {
            const code = (e as { code?: string }).code ?? 'unknown';
            // Include the code: "something went wrong" is untriageable, and
            // this is the one flow we cannot reproduce from here.
            setError(`${FRIENDLY[code] ?? 'Google sign-in failed.'} (${code})`);
            setBusy(false);
          });
      },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Google sign-in is unavailable (${msg}). Use your mobile number.`);
      },
      ({ width, height }) => setRow({ width, height: Math.max(44, height) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

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
      onSignedIn(user.isNewAccount, user.accessToken);
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
          <img src="/icon-192.png" alt="" width={88} height={88} style={mark} />
          <h1 style={headline}>
            {stage === 'code' ? 'Enter your code'
              : stage === 'phone' ? 'Your mobile number'
                : 'SpendWise'}
          </h1>
          <p style={subhead}>
            {stage === 'code'
              ? <>We texted a 6-digit code to <b style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{phone}</b></>
              : stage === 'phone' ? 'We’ll text you a code.'
                : 'Know exactly what’s safe to spend today.'}
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
              {GOOGLE_CLIENT_ID && googleReady
                ? <div ref={googleSlot} style={{
                    display: 'grid', justifyItems: 'center', minHeight: 44,
                    // Nothing may paint outside the column, whatever GIS does.
                    overflow: 'hidden', borderRadius: 4,
                  }} />
                : <Provider kind="google" ready={false} onUnavailable={setSoon} />}
              <Provider kind="apple" ready={oidcAvailable} onUnavailable={setSoon} size={row} />
              {soon && (
                <p role="status" style={soonNote}>
                  {soon} sign-in is coming soon. Use your mobile number for now.
                </p>
              )}
              <div style={divider}><i style={rule} /><span>or</span><i style={rule} /></div>
              <button type="button" onClick={() => setStage('phone')} style={{ ...secondaryDark, ...sizeOf(row) }}>
                Continue with mobile number
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

              <button type="button" onClick={() => { setStage('choose'); setError(null); }} style={ghost}>
                More sign-in options
              </button>
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
          No passwords. Your data stays on your device.
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

/**
 * Provider buttons use the real brand marks. Google's guidelines require the
 * four-colour G on a light surface, so this one deliberately breaks the dark
 * palette — a recoloured G is a brand violation and reads as a phishing page.
 */
function Provider({ kind, ready, onUnavailable, onStart, size }: {
  kind: 'google' | 'apple';
  ready: boolean;
  onUnavailable: (name: string) => void;
  onStart?: (() => void) | undefined;
  size?: RowSize | undefined;
}): JSX.Element {
  const name = kind === 'google' ? 'Google' : 'Apple';
  const style = { ...(kind === 'google' ? googleBtn : appleBtn), ...(size ? sizeOf(size) : {}) };
  return (
    <button
      type="button"
      onClick={() => { if (ready && onStart) onStart(); else onUnavailable(name); }}
      style={style}
      aria-label={`Continue with ${name}`}
    >
      <span style={{ position: 'absolute', left: 12, display: 'grid', placeItems: 'center' }}>
        {kind === 'google' ? <GoogleMark /> : <AppleMark />}
      </span>
      <span>Continue with {name}</span>
    </button>
  );
}

function GoogleMark(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.8-2 5.1-4.4 6.7v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.4z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.3 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-2.9.7-4.3v-5.7H4.5C2.9 17.1 2 20.4 2 24s.9 6.9 2.5 10l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.7 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}

function AppleMark(): JSX.Element {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M16.4 12.8c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8s1.9.8 3.1.7c1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.6zM14 4.9c.7-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z" />
    </svg>
  );
}

interface RowSize { width: number | null; height: number }

/**
 * Match Google's painted box exactly.
 *
 * Width matters as much as height: GIS pads beyond the width it is given, so a
 * button sized to the container overhangs the ones beside it by a few pixels —
 * which is what read as a white edge sticking out around the Google row.
 */
const sizeOf = (s: RowSize): React.CSSProperties => ({ minHeight: s.height });

/* ── styles ─────────────────────────────────────────────────────────────── */

const page: React.CSSProperties = {
  position: 'relative',
  minHeight: '100dvh',
  background:
    'var(--page-bg)',
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
  background: 'radial-gradient(circle, rgba(99,102,241,.30) 0%, rgba(6,182,212,.12) 42%, transparent 70%)',
};

const shell: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: 'min(100%, 360px)',
  display: 'grid', gap: 'var(--s7)',
};

const mark: React.CSSProperties = { borderRadius: 24, marginBottom: 'var(--s5)' };

const headline: React.CSSProperties = {
  fontSize: 32, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1,
};

const subhead: React.CSSProperties = {
  fontSize: 15, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5,
  maxWidth: '26ch', marginInline: 'auto',
};

/** No panel: three buttons on a dark field do not need a frame around them. */
const card: React.CSSProperties = { display: 'grid', gap: 10 };

const stack: React.CSSProperties = { display: 'grid', gap: 10 };

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
  background: 'var(--surface-2)', border: '1px solid var(--line-strong)',
  borderRadius: 6, overflow: 'hidden',
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
  border: `1.5px solid ${filled ? 'var(--line-brand)' : 'var(--line-strong)'}`,
  borderRadius: 6, outline: 'none', padding: 0,
  transition: 'background .15s, border-color .15s',
});

/**
 * Matched to Google's rendered button, which cannot be restyled.
 *
 * Fighting it produced a stack where one button was 50px with a 4px radius and
 * the next was 72px with an 18px one. Letting it set the metrics — 44px tall,
 * 4px radius, 14px medium — makes the three read as one control group. 44px is
 * also the floor for a reliable tap.
 */
const base: React.CSSProperties = {
  width: '100%', minHeight: 44, borderRadius: 4, border: 0,
  fontSize: 14, fontWeight: 500, letterSpacing: '.01em', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  position: 'relative', padding: '0 12px',
};

const primary = (disabled: boolean): React.CSSProperties => ({
  ...base, background: 'var(--brand)', color: '#fff', fontWeight: 600,
  opacity: disabled ? .35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'opacity .15s ease',
});


const ghost: React.CSSProperties = {
  ...base, minHeight: 44, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600,
};

/** The third option, so it reads as an alternative rather than the main act. */
const secondaryDark: React.CSSProperties = {
  ...base, background: 'transparent', color: 'var(--text)',
  border: '1px solid var(--line-strong)', fontWeight: 600,
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

const googleBtn: React.CSSProperties = {
  ...base, background: '#FFFFFF', color: '#1F1F1F',
  border: '1px solid #DADCE0',
};

/** Google's exact border colour and weight, so the two sit as a pair. */
const appleBtn: React.CSSProperties = {
  ...base, background: '#FFFFFF', color: '#1F1F1F',
  border: '1px solid #DADCE0',
};

const soonNote: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--text-muted)',
  background: 'var(--surface-2)', border: '1px solid var(--line)',
  padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', textAlign: 'center',
  lineHeight: 1.45,
};


const microcopy: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center',
};
