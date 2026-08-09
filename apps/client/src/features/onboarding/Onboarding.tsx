import { useMemo, useState } from 'react';
import { formatMoney, toMinor } from '@spendwise/shared-types';
import { Icon } from '../../design-system/components.js';

/**
 * First run (ARCHITECTURE §3.5).
 *
 * A budgeting app is at its worst on day one: every chart empty, every total
 * zero, no way to tell whether it works. This collects just enough to make the
 * app real — a name, what comes in, and what each category is worth — then
 * hands over to a short tour.
 *
 * Every step is skippable. An onboarding you cannot escape is a reason to
 * delete the app, and each answer has a defensible default.
 */

export interface OnboardingResult {
  displayName: string;
  baseCurrency: string;
  monthlyIncomeMinor: number;
  budgets: Array<{ name: string; icon: string; colour: string; limitMinor: number }>;
  /**
   * Recurring commitments, kept apart from day-to-day money.
   *
   * The split is the whole point of the app: rent is not discretionary, so
   * mixing it into the spending budget makes "safe to spend" meaningless. It
   * has to be declared at setup, not left for the user to discover later.
   */
  fixedCosts: Array<{ name: string; icon: string; colour: string; limitMinor: number; dueDay: number }>;
}

export interface OnboardingProps {
  onDone: (result: OnboardingResult) => void;
  onSkip: () => void;
}

const CURRENCIES = ['GBP', 'EUR', 'USD'] as const;

/** Offered as suggestions, not a fixed list — everything is editable later. */
const SUGGESTED = [
  { name: 'Groceries',  icon: 'groceries',   colour: '#14B8A6', share: 0.16 },
  { name: 'Eating out', icon: 'dining',      colour: '#FB923C', share: 0.06 },
  { name: 'Transport',  icon: 'transport',   colour: '#22D3EE', share: 0.05 },
  { name: 'Shopping',   icon: 'shopping',    colour: '#EC4899', share: 0.05 },
  { name: 'Fun',        icon: 'fun',         colour: '#EAB308', share: 0.04 },
  { name: 'Home',       icon: 'home',        colour: '#94A3B8', share: 0.05 },
  { name: 'Health',     icon: 'health',      colour: '#F472B6', share: 0.03 },
  { name: 'Subscriptions', icon: 'subscription', colour: '#38BDF8', share: 0.03 },
];

/** Fixed costs offered by default, with the day they usually land. */
const FIXED_SUGGESTED = [
  { name: 'Rent',          icon: 'rent',         colour: '#8B5CF6', dueDay: 1 },
  { name: 'Council tax',   icon: 'bills',        colour: '#64748B', dueDay: 1 },
  { name: 'Energy',        icon: 'utilities',    colour: '#EAB308', dueDay: 5 },
  { name: 'Water',         icon: 'water',        colour: '#22D3EE', dueDay: 5 },
  { name: 'Broadband',     icon: 'wifi',         colour: '#38BDF8', dueDay: 12 },
  { name: 'Phone',         icon: 'phone',        colour: '#6366F1', dueDay: 20 },
  { name: 'Car finance',   icon: 'car',          colour: '#6366F1', dueDay: 2 },
  { name: 'Insurance',     icon: 'health',       colour: '#F472B6', dueDay: 15 },
  { name: 'Subscriptions', icon: 'subscription', colour: '#A855F7', dueDay: 22 },
  { name: 'Gym',           icon: 'fitness',      colour: '#94A3B8', dueDay: 10 },
];

type Step = 0 | 1 | 2 | 3 | 4 | 5;

export function Onboarding({ onDone, onSkip }: OnboardingProps): JSX.Element {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('GBP');
  const [income, setIncome] = useState('');
  const [chosen, setChosen] = useState<string[]>(SUGGESTED.slice(0, 5).map((c) => c.name));
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [fixedChosen, setFixedChosen] = useState<string[]>([]);
  const [fixedAmounts, setFixedAmounts] = useState<Record<string, string>>({});
  const [fixedDays, setFixedDays] = useState<Record<string, string>>({});

  const incomeMinor = useMemo(() => {
    try { return income ? toMinor(income, currency) : 0; } catch { return 0; }
  }, [income, currency]);

  /* Suggested limits are derived from what they actually earn, so the numbers
     look like their life rather than a generic template. */
  function suggestedFor(name: string): number {
    const c = SUGGESTED.find((s) => s.name === name);
    if (!c || incomeMinor <= 0) return 0;
    return Math.round((incomeMinor * c.share) / 100) * 100; // round to a whole unit
  }

  function limitFor(name: string): number {
    const typed = limits[name];
    if (typed !== undefined && typed !== '') {
      try { return toMinor(typed, currency); } catch { return 0; }
    }
    return suggestedFor(name);
  }

  const totalBudget = chosen.reduce((s, n) => s + limitFor(n), 0);

  function fixedAmountFor(name: string): number {
    const typed = fixedAmounts[name];
    if (!typed) return 0;
    try { return toMinor(typed, currency); } catch { return 0; }
  }
  function fixedDayFor(name: string): number {
    const typed = Number(fixedDays[name]);
    if (Number.isInteger(typed) && typed >= 1 && typed <= 31) return typed;
    return FIXED_SUGGESTED.find((f) => f.name === name)?.dueDay ?? 1;
  }
  const totalFixed = fixedChosen.reduce((s, n) => s + fixedAmountFor(n), 0);

  function finish(): void {
    onDone({
      // Empty, not 'there'. That is a greeting filler; storing it as the name
      // makes Profile say the person is called "there".
      displayName: name.trim(),
      baseCurrency: currency,
      monthlyIncomeMinor: incomeMinor,
      budgets: chosen.map((n) => {
        const c = SUGGESTED.find((s) => s.name === n)!;
        return { name: c.name, icon: c.icon, colour: c.colour, limitMinor: limitFor(n) };
      }),
      fixedCosts: fixedChosen.map((n) => {
        const c = FIXED_SUGGESTED.find((f) => f.name === n)!;
        return {
          name: c.name, icon: c.icon, colour: c.colour,
          limitMinor: fixedAmountFor(n), dueDay: fixedDayFor(n),
        };
      }),
    });
  }

  const next = (): void => setStep((s) => Math.min(5, s + 1) as Step);
  const back = (): void => setStep((s) => Math.max(0, s - 1) as Step);

  return (
    <main style={page}>
      <div style={glow} aria-hidden="true" />
      <div style={shell}>
        {step > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={stepLabel}>Step {step} of 5</span>
              <button type="button" onClick={onSkip} style={skipLink}>Skip setup</button>
            </div>
            <div style={progressRow} aria-hidden="true" role="progressbar">
              {[1, 2, 3, 4, 5].map((i) => (
                <i key={i} style={{ ...bar, background: i <= step ? 'var(--brand)' : 'var(--surface-3)' }} />
              ))}
            </div>
          </div>
        )}

        {/* ── 0. welcome ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ ...card, textAlign: 'center', justifyItems: 'center' }}>
            <img src="/icon-192.png" alt="" width={72} height={72} style={{ borderRadius: 20, marginBottom: 'var(--s3)' }} />
            <h1 style={h1}>Welcome to SpendWise</h1>
            <p style={{ ...lede, maxWidth: '28ch' }}>A few quick questions to set up your budget.</p>
            <Footer onNext={next} nextLabel="Get started" skip={onSkip} />
          </div>
        )}

        {/* ── 1. name ────────────────────────────────────────────────── */}
        {step === 1 && (
          <div style={card}>
            <h1 style={h1}>What's your name?</h1>
            <p style={lede}>First name is fine.</p>
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
              placeholder="Jahid" aria-label="Your name" autoComplete="given-name"
              maxLength={24} style={field}
            />
            <Footer onBack={back} onNext={next} nextLabel="Continue" skip={next} />
          </div>
        )}

        {/* ── 2. earnings ────────────────────────────────────────────── */}
        {step === 2 && (
          <div style={card}>
            <h1 style={h1}>Monthly income</h1>
            <p style={lede}>Your take-home pay, after tax.</p>

            <div style={segRow} role="group" aria-label="Currency">
              {CURRENCIES.map((c) => (
                <button
                  key={c} type="button" onClick={() => setCurrency(c)}
                  aria-pressed={currency === c}
                  style={seg(currency === c)}
                >{c}</button>
              ))}
            </div>

            <div style={amountRow}>
              <span style={amountCur}>{formatMoney(0, currency).replace(/[\d.,\s]/g, '')}</span>
              <input
                autoFocus inputMode="decimal" value={income}
                onChange={(e) => setIncome(e.target.value.replace(/[^0-9.]/g, '').slice(0, 9))}
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                placeholder="0" aria-label="Monthly income"
                style={amountInput} size={Math.max(1, income.length || 1)}
              />
            </div>

            <Footer onBack={back} onNext={next} nextLabel="Continue" skip={next} />
          </div>
        )}

        {/* ── 3. categories ──────────────────────────────────────────── */}
        {step === 3 && (
          <div style={card}>
            <h1 style={h1}>What do you spend on?</h1>
            <p style={lede}>Pick the ones you use.</p>
            <div style={grid}>
              {SUGGESTED.map((c) => {
                const on = chosen.includes(c.name);
                return (
                  <button
                    key={c.name} type="button" aria-pressed={on}
                    onClick={() => setChosen((p) => on ? p.filter((n) => n !== c.name) : [...p, c.name])}
                    style={cell(on)}
                  >
                    <Icon name={c.icon} size={34} colour={c.colour} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</span>
                  </button>
                );
              })}
            </div>
            <Footer onBack={back} onNext={next} disabled={chosen.length === 0}
                    nextLabel={`Continue with ${chosen.length} ${chosen.length === 1 ? 'category' : 'categories'}`} />
          </div>
        )}

        {/* ── 4. budgets ─────────────────────────────────────────────── */}
        {step === 4 && (
          <div style={card}>
            <h1 style={h1}>How much for each?</h1>
            <p style={lede}>Set a monthly limit for each.</p>

            <div style={{ display: 'grid', gap: 10, marginBottom: 'var(--s4)' }}>
              {chosen.map((n) => {
                const c = SUGGESTED.find((s) => s.name === n)!;
                return (
                  <label key={n} style={budgetRow}>
                    <Icon name={c.icon} size={30} colour={c.colour} />
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{c.name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                      {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
                    </span>
                    <input
                      inputMode="decimal"
                      value={limits[n] ?? (suggestedFor(n) ? String(suggestedFor(n) / 100) : '')}
                      onChange={(e) => setLimits((p) => ({ ...p, [n]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      aria-label={`${n} monthly limit`}
                      style={budgetInput}
                    />
                  </label>
                );
              })}
            </div>

            <div style={totalRow}>
              <span>Day-to-day budget</span>
              <b className="num">{formatMoney(totalBudget, currency)}</b>
            </div>
            {incomeMinor > 0 && (
              <p style={{ ...hint, marginBottom: 'var(--s3)' }}>
                {totalBudget > incomeMinor
                  ? `${formatMoney(totalBudget - incomeMinor, currency)} over your income.`
                  : `${formatMoney(incomeMinor - totalBudget, currency)} left for bills and saving.`}
              </p>
            )}

            <Footer onBack={back} onNext={next} nextLabel="Continue" />
          </div>
        )}

        {/* ── 5. fixed costs ─────────────────────────────────────────── */}
        {step === 5 && (
          <div style={card}>
            <h1 style={h1}>Bills and fixed costs</h1>
            <p style={lede}>Regular payments, kept separate from your spending money.</p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: 'var(--s2) 0 var(--s3)' }}>
              {FIXED_SUGGESTED.map((f) => {
                const on = fixedChosen.includes(f.name);
                return (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFixedChosen((p) => (on ? p.filter((x) => x !== f.name) : [...p, f.name]))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px',
                      borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                      background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
                      border: `1px solid ${on ? 'var(--line-brand)' : 'var(--line)'}`,
                      color: on ? 'var(--text)' : 'var(--text-dim)',
                    }}
                  >
                    <i style={{ width: 8, height: 8, borderRadius: 999, background: f.colour, flexShrink: 0 }} />
                    {f.name}
                  </button>
                );
              })}
            </div>

            {fixedChosen.length > 0 && (
              <div style={{ display: 'grid', gap: 10, marginBottom: 'var(--s3)' }}>
                {fixedChosen.map((n) => {
                  const c = FIXED_SUGGESTED.find((f) => f.name === n)!;
                  return (
                    <div key={n} style={fixedRow}>
                      <Icon name={c.icon} size={30} colour={c.colour} />
                      <span style={{ minWidth: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      <label style={miniField}>
                        <span style={miniLabel}>Amount</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                            {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
                          </span>
                          <input
                            inputMode="decimal"
                            value={fixedAmounts[n] ?? ''}
                            onChange={(e) => setFixedAmounts((p) => ({ ...p, [n]: e.target.value.replace(/[^0-9.]/g, '') }))}
                            placeholder="0"
                            aria-label={`${n} monthly amount`}
                            style={miniInput}
                          />
                        </span>
                      </label>
                      <label style={miniField}>
                        <span style={miniLabel}>Day</span>
                        <input
                          inputMode="numeric"
                          value={fixedDays[n] ?? String(c.dueDay)}
                          onChange={(e) => setFixedDays((p) => ({ ...p, [n]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
                          aria-label={`${n} due day`}
                          style={{ ...miniInput, width: 26, textAlign: 'center' }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={totalRow}>
              <span>Fixed costs</span>
              <b className="num">{formatMoney(totalFixed, currency)}</b>
            </div>
            {incomeMinor > 0 && (
              <p style={{ ...hint, marginBottom: 'var(--s3)' }}>
                {totalFixed + totalBudget > incomeMinor
                  ? `${formatMoney(totalFixed + totalBudget - incomeMinor, currency)} over your income.`
                  : `${formatMoney(incomeMinor - totalFixed - totalBudget, currency)} left to save each month.`}
              </p>
            )}

            <Footer onBack={back} onNext={finish} nextLabel="Finish setup" />
          </div>
        )}
      </div>
    </main>
  );
}

/** Back and Continue on one row, with an optional skip underneath. */
function Footer({ onBack, onNext, nextLabel, disabled = false, skip }: {
  onBack?: (() => void) | undefined;
  onNext: () => void;
  nextLabel: string;
  disabled?: boolean;
  skip?: (() => void) | undefined;
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: onBack ? 'auto 1fr' : '1fr', gap: 'var(--s2)' }}>
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back" style={backBtn}>
            <svg viewBox="0 0 24 24" width={18} height={18} stroke="currentColor" strokeWidth={2.4}
                 fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19l-7-7 7-7" /></svg>
          </button>
        )}
        <button type="button" onClick={onNext} disabled={disabled} style={primary(disabled)}>{nextLabel}</button>
      </div>
      {skip && <button type="button" onClick={skip} style={ghost}>Skip this step</button>}
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const page: React.CSSProperties = {
  position: 'relative', minHeight: '100dvh', overflow: 'hidden',
  background:
    'var(--page-bg)',
  color: 'var(--text)', fontFamily: "'Plus Jakarta Sans',-apple-system,system-ui,sans-serif",
  display: 'grid', placeItems: 'center', padding: 'var(--s5)',
};
/** Identical bloom to the sign-in screen — same size, position and stops. */
const glow: React.CSSProperties = {
  position: 'absolute', top: '-22%', left: '50%', transform: 'translateX(-50%)',
  width: 'min(560px, 130vw)', aspectRatio: '1', borderRadius: '50%', pointerEvents: 'none',
  background: 'radial-gradient(circle, rgba(99,102,241,.30) 0%, rgba(6,182,212,.12) 42%, transparent 70%)',
};
const shell: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: 'min(100%, 400px)', display: 'grid', gap: 'var(--s4)',
};
const stepLabel: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};
const skipLink: React.CSSProperties = {
  background: 'none', border: 0, padding: 0, cursor: 'pointer',
  fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--text-dim)',
};
const backBtn: React.CSSProperties = {
  width: 52, minHeight: 52, borderRadius: 'var(--r-md)', cursor: 'pointer',
  background: 'var(--surface-3)', border: 0, color: 'var(--text-muted)',
  display: 'grid', placeItems: 'center',
};
const progressRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 };
const bar: React.CSSProperties = { height: 4, borderRadius: 2, transition: 'background .25s' };
const card: React.CSSProperties = {
  padding: 'var(--s5)', borderRadius: 22,
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  boxShadow: '0 24px 60px -24px rgba(0,0,0,.75)', display: 'grid', gap: 'var(--s3)',
};
const h1: React.CSSProperties = { fontSize: 25, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.15 };
const lede: React.CSSProperties = { fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.55 };
const field: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', padding: '16px var(--s4)', fontSize: 17, fontWeight: 600, color: 'var(--text)', outline: 'none',
};
const segRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, padding: 4,
  background: 'var(--surface-2)', borderRadius: 999,
};
const seg = (on: boolean): React.CSSProperties => ({
  padding: '10px 0', borderRadius: 999, border: 0, cursor: 'pointer', fontSize: 13, fontWeight: 800,
  background: on ? 'var(--brand)' : 'transparent', color: on ? '#fff' : 'var(--text-dim)',
});
const amountRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2, padding: 'var(--s3) 0' };
const amountCur: React.CSSProperties = { fontSize: 30, fontWeight: 800, color: 'var(--text-dim)' };
const amountInput: React.CSSProperties = {
  background: 'none', border: 0, outline: 'none', fontSize: 46, fontWeight: 800,
  letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)', minWidth: '1ch', padding: 0,
};
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 };
const cell = (on: boolean): React.CSSProperties => ({
  display: 'grid', justifyItems: 'center', gap: 6, padding: '12px 4px', borderRadius: 16, cursor: 'pointer',
  background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
  border: `1.5px solid ${on ? 'rgba(99,102,241,.55)' : 'transparent'}`,
  color: on ? 'var(--text)' : 'var(--text-dim)',
});
/** Fixed columns: a flex row with fixed-width inputs overflowed the card. */
const fixedRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '30px minmax(0,1fr) auto auto',
  alignItems: 'center', gap: 10, padding: '10px 12px',
  background: 'var(--surface-2)', borderRadius: 14,
};
const miniField: React.CSSProperties = { display: 'grid', gap: 2, justifyItems: 'end' };
const miniLabel: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};
const miniInput: React.CSSProperties = {
  width: 58, textAlign: 'right', background: 'transparent', border: 0, outline: 'none',
  fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', padding: 0,
};
const budgetRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
  background: 'var(--surface-2)', borderRadius: 14,
};
const budgetInput: React.CSSProperties = {
  width: 88, textAlign: 'right', background: 'transparent', border: 0, outline: 'none',
  fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
};
const totalRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: 'var(--s3) var(--s4)', borderRadius: 14, background: 'var(--brand-soft)',
  border: '1px solid rgba(99,102,241,.24)', fontSize: 'var(--fs-sm)', fontWeight: 700,
};
const hint: React.CSSProperties = { fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' };
const baseBtn: React.CSSProperties = {
  width: '100%', minHeight: 52, borderRadius: 'var(--r-md)', border: 0,
  fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
};
const primary = (disabled: boolean): React.CSSProperties => ({
  ...baseBtn, background: 'var(--brand)', color: '#fff',
  boxShadow: disabled ? 'none' : '0 8px 22px -10px rgba(99,102,241,.9)',
  opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
});
const ghost: React.CSSProperties = {
  ...baseBtn, minHeight: 44, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600,
};
