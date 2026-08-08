import { useEffect, useRef, useState } from 'react';
import type { AuthClient } from '../../core/auth/client.js';
import { isValidPhoneE164, normalizePhoneE164 } from './phone.js';

/**
 * Sign-in (ARCHITECTURE §9.1).
 *
 * Passwordless: no password field, no "create account" form. Google and Apple
 * lead because they cost nothing per sign-in and are the safest of the four;
 * phone sits last, being the weakest (SIM swap) and the only one that bills
 * per attempt.
 *
 * Four things here are load-bearing on a phone, and easy to leave out:
 *   - autoComplete="one-time-code" so iOS and Android offer the SMS code from
 *     the keyboard. Without it every user retypes six digits by hand.
 *   - Six separate boxes that accept a PASTE into any of them, because people
 *     copy the whole code from the message.
 *   - A resend countdown, so "nothing happened" has an obvious next step
 *     instead of the user hammering a button that is rate-limited anyway.
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
  rate_limited_ip: 'Too many attempts from this device. Try again tomorrow.',
  spend_ceiling: 'Text messages are unavailable right now. Try Google or Apple.',
  blocked_prefix: "We can't send codes to that number.",
  bad_code: "That code isn't right.",
  expired: 'That code expired. Send a new one.',
  too_many_attempts: 'Too many tries. Send a new code.',
  not_found: 'That code expired. Send a new one.',
};

const RESEND_SECONDS = 30;

export function AuthScreen({ auth, onSignedIn, oidcAvailable = false }: AuthScreenProps): JSX.Element {
  const [stage, setStage] = useState<Stage>(oidcAvailable ? 'choose' : 'phone');
  const [phone, setPhone] = useState('+44');
  const [digits, setDigits] = useState<string[]>(Array(6).fill(''));
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join('');
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
      const filled = next.join('');
      const last = Math.min(i + only.length, 5);
      boxes.current[last]?.focus();
      if (filled.length === 6) void verify(filled);
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
      <section style={shell}>
        <div style={aurora} aria-hidden="true" />

        <div style={card}>
          <header style={{ textAlign: 'center', marginBottom: 'var(--s5)' }}>
            <img src="/icon-192.png" alt="" width={64} height={64} style={markImg} />
            <h1 style={headline}>
              {stage === 'code' ? 'Check your messages' :
               stage === 'phone' ? "What's your number?" :
               'Know what you can spend'}
            </h1>
            <p style={subhead}>
              {stage === 'code' ? <>We sent a six-digit code to <b style={{ color: 'var(--text)' }}>{phone}</b>.</> :
               stage === 'phone' ? 'We’ll text you a code. No password to remember.' :
               'Track every penny. Works with no signal.'}
            </p>
          </header>

          {error && <p role="alert" style={errorBox}>{error}</p>}

          {stage === 'choose' && (
            <div style={stack}>
              <Provider kind="google" disabled={!oidcAvailable} />
              <Provider kind="apple" disabled={!oidcAvailable} />
              <div style={divider}><i style={rule} />or<i style={rule} /></div>
              <button type="button" onClick={() => setStage('phone')} style={secondary}>
                Continue with phone number
              </button>
            </div>
          )}

          {stage === 'phone' && (
            <div style={stack}>
              <input
                autoFocus
                inputMode="tel"
                autoComplete="tel"
                aria-label="Mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && validPhone) void send(); }}
                placeholder="+44 7700 900000"
                style={field}
              />
              <p style={hint}>Include your country code.</p>
              <button type="button" disabled={!validPhone || busy} onClick={() => void send()} style={primary(!validPhone || busy)}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
              {oidcAvailable && (
                <button type="button" onClick={() => { setStage('choose'); setError(null); }} style={ghost}>
                  Back
                </button>
              )}
            </div>
          )}

          {stage === 'code' && (
            <div style={stack}>
              <div style={boxRow}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { boxes.current[i] = el; }}
                    value={d}
                    onChange={(e) => onDigit(i, e.target.value)}
                    onKeyDown={(e) => onDigitKey(i, e)}
                    inputMode="numeric"
                    // This is what makes iOS and Android offer the code from
                    // the keyboard instead of making people retype it.
                    autoComplete="one-time-code"
                    maxLength={6}
                    aria-label={`Digit ${i + 1}`}
                    style={digitBox(Boolean(d))}
                  />
                ))}
              </div>

              <button type="button" disabled={code.length !== 6 || busy} onClick={() => void verify()} style={primary(code.length !== 6 || busy)}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>

              <button
                type="button"
                disabled={cooldown > 0 || busy}
                onClick={() => void send()}
                style={{ ...ghost, opacity: cooldown > 0 ? 0.45 : 1 }}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
              <button type="button" onClick={() => { setStage('phone'); setError(null); }} style={ghost}>
                Use a different number
              </button>
            </div>
          )}
        </div>

        <p style={microcopy}>No passwords. Your data is stored on this device first.</p>
      </section>
    </main>
  );
}

function Provider({ kind, disabled }: { kind: 'google' | 'apple'; disabled: boolean }): JSX.Element {
  const label = kind === 'google' ? 'Continue with Google' : 'Continue with Apple';
  return (
    <button type="button" disabled={disabled} style={{ ...secondary, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span style={badge}>{kind === 'google' ? 'G' : ''}</span>
      {label}
    </button>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const page: React.CSSProperties = {
  minHeight: '100dvh',
  background:
    'radial-gradient(circle at 15% 0%, rgba(99,102,241,.16), transparent 42%),' +
    'radial-gradient(circle at 85% 8%, rgba(6,182,212,.12), transparent 38%),' +
    'var(--bg)',
  color: 'var(--text)',
  fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
  display: 'grid',
  placeItems: 'center',
  padding: 'var(--s5)',
};

const shell: React.CSSProperties = { position: 'relative', width: 'min(100%, 420px)', display: 'grid', gap: 'var(--s4)' };

const aurora: React.CSSProperties = {
  position: 'absolute', inset: '-30px -20px auto', height: 200, borderRadius: 40,
  background: 'radial-gradient(circle at 30% 20%, rgba(99,102,241,.30), transparent 45%), radial-gradient(circle at 75% 30%, rgba(168,85,247,.22), transparent 40%)',
  filter: 'blur(18px)', pointerEvents: 'none',
};

const card: React.CSSProperties = {
  position: 'relative', zIndex: 1, padding: 'var(--s6) var(--s5)', borderRadius: 28,
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  boxShadow: 'var(--shadow)',
};

const markImg: React.CSSProperties = { borderRadius: 18, marginBottom: 'var(--s3)' };

const headline: React.CSSProperties = {
  fontSize: 26, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15,
};

const subhead: React.CSSProperties = {
  fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5,
};

const stack: React.CSSProperties = { display: 'grid', gap: 'var(--s3)' };

const errorBox: React.CSSProperties = {
  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--danger)',
  background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)',
  padding: 'var(--s3)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s3)',
};

const hint: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center',
};

const divider: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12,
  color: 'var(--text-dim)', fontSize: 'var(--fs-2xs)', fontWeight: 700,
  letterSpacing: '.1em', textTransform: 'uppercase',
};
const rule: React.CSSProperties = { height: 1, background: 'var(--line)' };

const field: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: '16px var(--s4)', fontSize: 17, fontWeight: 600,
  color: 'var(--text)', outline: 'none',
};

const boxRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 };

const digitBox = (filled: boolean): React.CSSProperties => ({
  width: '100%', aspectRatio: '1 / 1.15', textAlign: 'center',
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
  opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
});

const secondary: React.CSSProperties = {
  ...base, background: 'var(--surface-2)', color: 'var(--text)',
  border: '1px solid var(--line)',
};

const ghost: React.CSSProperties = {
  ...base, minHeight: 44, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600,
};

const badge: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center',
  background: 'var(--surface-3)', fontSize: 13, fontWeight: 800,
};

const microcopy: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center',
};
