import { useState } from 'react';
import type { AuthClient } from '../../core/auth/client.js';

/**
 * Sign-in (ARCHITECTURE §9.1).
 *
 * Passwordless: there is no password field and no "create account" form.
 * Google and Apple lead because they cost nothing per sign-in and are the
 * safest of the four; phone is offered but placed last, because SMS is the
 * weakest option here (SIM swap) and the only one that bills per attempt.
 */

export interface AuthScreenProps {
  auth: AuthClient;
  onSignedIn: (isNewAccount: boolean) => void;
  /** Absent until real OAuth client ids are configured. */
  oidcAvailable?: boolean;
}

type Stage = 'choose' | 'phone' | 'code';

const FRIENDLY: Record<string, string> = {
  rate_limited_target: 'Too many codes requested for that number. Try again later.',
  rate_limited_ip: 'Too many attempts from this device. Try again tomorrow.',
  spend_ceiling: 'Text messages are temporarily unavailable. Try another sign-in method.',
  blocked_prefix: "We can't send codes to that number.",
  bad_code: 'That code is not right.',
  expired: 'That code has expired. Request a new one.',
  too_many_attempts: 'Too many attempts. Request a new code.',
  not_found: 'That code has expired. Request a new one.',
};

export function AuthScreen({ auth, onSignedIn, oidcAvailable = false }: AuthScreenProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('choose');
  const [phone, setPhone] = useState('+44');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const say = (err: unknown): void => {
    const code = (err as { code?: string }).code ?? '';
    setError(FRIENDLY[code] ?? 'Something went wrong. Please try again.');
  };

  async function send(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const { challengeId: id } = await auth.sendOtp(phone.trim());
      setChallengeId(id);
      setStage('code');
    } catch (err) { say(err); } finally { setBusy(false); }
  }

  async function verify(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const user = await auth.verifyOtp(challengeId, code);
      onSignedIn(user.isNewAccount);
    } catch (err) { say(err); } finally { setBusy(false); }
  }

  const validPhone = /^\+[1-9]\d{6,14}$/.test(phone.trim());

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: 'var(--s6)', gap: 'var(--s4)',
    }}>
      <header style={{ marginBottom: 'var(--s5)' }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.03em' }}>SpendWise</h1>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', marginTop: 'var(--s2)', maxWidth: '28ch' }}>
          Know what you can spend today. Works with no signal.
        </p>
      </header>

      {error && (
        <p role="alert" style={{
          fontSize: 'var(--fs-sm)', color: 'var(--danger)', background: 'var(--danger-soft)',
          padding: 'var(--s3)', borderRadius: 'var(--r-md)', fontWeight: 600,
        }}>{error}</p>
      )}

      {stage === 'choose' && (
        <>
          <Provider label="Continue with Google" disabled={!oidcAvailable} onClick={() => undefined} />
          <Provider label="Continue with Apple" disabled={!oidcAvailable} onClick={() => undefined} />
          {!oidcAvailable && (
            <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center' }}>
              Google and Apple need OAuth client IDs configured.
            </p>
          )}
          <button type="button" onClick={() => setStage('phone')} style={ghost}>
            Continue with a phone number
          </button>
        </>
      )}

      {stage === 'phone' && (
        <>
          <label htmlFor="phone" style={label}>Mobile number</label>
          <input
            id="phone" autoFocus inputMode="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && validPhone) void send(); }}
            placeholder="+447700900000" style={field}
          />
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>
            Include the country code. We&rsquo;ll text you a six-digit code.
          </p>
          <button type="button" disabled={!validPhone || busy} onClick={() => void send()} style={primary(!validPhone || busy)}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <button type="button" onClick={() => { setStage('choose'); setError(null); }} style={ghost}>Back</button>
        </>
      )}

      {stage === 'code' && (
        <>
          <label htmlFor="code" style={label}>Six-digit code</label>
          <input
            id="code" autoFocus inputMode="numeric" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void verify(); }}
            placeholder="000000"
            style={{ ...field, fontSize: 28, letterSpacing: '.3em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
          />
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>
            Sent to {phone}. The code expires in five minutes.
          </p>
          <button type="button" disabled={code.length !== 6 || busy} onClick={() => void verify()} style={primary(code.length !== 6 || busy)}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" onClick={() => { setStage('phone'); setCode(''); setError(null); }} style={ghost}>
            Use a different number
          </button>
        </>
      )}

      <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center', marginTop: 'var(--s5)' }}>
        No passwords. Your data is encrypted and stored on your device first.
      </p>
    </main>
  );
}

function Provider({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={primary(disabled)}>
      {label}
    </button>
  );
}

const field: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: '14px var(--s4)', fontSize: 'var(--fs-md)',
  fontWeight: 600, outline: 'none', color: 'var(--text)',
};

const label: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};

const ghost: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', color: 'var(--text-muted)',
  padding: 14, borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)',
  fontWeight: 700, border: 0, cursor: 'pointer',
};

const primary = (disabled: boolean): React.CSSProperties => ({
  width: '100%', background: 'var(--brand)', color: '#fff', padding: 15,
  borderRadius: 'var(--r-md)', fontSize: 'var(--fs-md)', fontWeight: 800, border: 0,
  opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
});
