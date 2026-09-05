import { useMemo, useState } from 'react';
import { isoDay } from '../budget/cycle.js';
import { formatMoney, toMinor } from '@spendwise/shared-types';
import { Icon } from '../../design-system/components.js';
import { Logo } from '../../design-system/Logo.js';

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
  /**
   * Expected income per CYCLE, not per month.
   *
   * Someone paid £500 a week does not earn £2,000 a month — they earn £2,000
   * in eight months of the year and £2,500 in four. There is no correct value
   * for a monthly figure, which is why the question is asked per pay packet.
   */
  expectedIncomeMinor: number;
  /**
   * What is in their pocket the day they set the app up.
   *
   * Everything is worked out from this. Without it the app inferred a balance
   * from the last payday and the expected wage — money that, for anyone
   * joining mid-cycle, had already been spent.
   */
  openingCashMinor: number;
  cycleKind: 'days' | 'monthly';
  cycleLengthDays: number | null;
  cycleAnchorDate: string | null;
  cycleAnchorDay: number | null;
  /** Accruals replay from here rather than from the epoch. */
  /** Null when the balance question was skipped — see cashKnown. */
  budgetStartDate: string | null;
  budgets: Array<{ name: string; icon: string; colour: string; limitMinor: number }>;
  /**
   * Recurring commitments, kept apart from day-to-day money.
   *
   * The split is the whole point of the app: rent is not discretionary, so
   * mixing it into the spending budget makes "safe to spend" meaningless. It
   * has to be declared at setup, not left for the user to discover later.
   */
  fixedCosts: Array<{
    name: string; icon: string; colour: string; limitMinor: number; dueDay: number;
    /**
     * What is already put by for this bill.
     *
     * Without it, signing up on the 25th means being asked to fund a full
     * month's rent out of six days' income, and the first week reads as an
     * accusation rather than a plan.
     */
    openingMinor: number;
  }>;
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

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/*
 * Derived, not typed out twice.
 *
 * The label and the progress pips were both hardcoded to 6 while the flow had
 * grown to 7, so the last screen read "Step 7 of 6" above a bar that could not
 * reach the end. One constant, and the two cannot drift apart again.
 */
const TOTAL_STEPS = 7;

export function Onboarding({ onDone, onSkip }: OnboardingProps): JSX.Element {
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<string>('GBP');
  const [income, setIncome] = useState('');
  const [chosen, setChosen] = useState<string[]>(SUGGESTED.slice(0, 5).map((c) => c.name));
  const [limits, setLimits] = useState<Record<string, string>>({});
  /*
   * Which bills the person actually pays.
   *
   * Derived from the amounts rather than held separately: filling a figure in
   * IS choosing it, so there is no second list to keep in step — and no way
   * for a bill to be "selected" with nothing against it, which used to save a
   * £0 commitment that then showed up on every screen.
   */
  const [fixedAmounts, setFixedAmounts] = useState<Record<string, string>>({});
  const [fixedDays, setFixedDays] = useState<Record<string, string>>({});
  /* How often money arrives. Weekly is first because it is the case the old
     monthly-only model served worst. */
  const [payEvery, setPayEvery] = useState<7 | 14 | 28 | 'monthly'>('monthly');
  const [lastPayday, setLastPayday] = useState<string>(isoDay(new Date()));
  /*
   * What is in your pocket today.
   *
   * The one question that makes joining mid-cycle honest. Without it the app
   * back-dated to your last payday and planned around a full pay packet that
   * had already been spent — someone starting on a Tuesday with £200 left was
   * budgeted as though they had £500.
   */
  const [cashNow, setCashNow] = useState<string>('');

  const incomeMinor = useMemo(() => {
    try { return income ? toMinor(income, currency) : 0; } catch { return 0; }
  }, [income, currency]);
  /*
   * What they said is in their pocket today.
   *
   * The step offers Skip, so blank means unknown — not zero. The two must
   * stay apart downstream: the whole app is bounded by cash when the figure
   * is known, and treating a skipped question as "you have nothing" would
   * clamp a perfectly solvent account to £0 a day.
   */
  const cashGiven = cashNow.trim() !== '';
  const cashMinor = useMemo(() => {
    if (!cashNow.trim()) return 0;
    try { return toMinor(cashNow, currency); } catch { return 0; }
  }, [cashNow, currency]);

  /* A blank box means blank. This used to fall back to a share of income, so
     leaving a field alone quietly created a budget nobody chose — and the
     total at the bottom moved for reasons that were not on screen. */
  function limitFor(name: string): number {
    const typed = limits[name];
    if (typed === undefined || typed === '') return 0;
    try { return toMinor(typed, currency); } catch { return 0; }
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
  const fixedChosen = FIXED_SUGGESTED
    .map((f) => f.name)
    .filter((n) => (fixedAmounts[n] ?? '').trim() !== '' && fixedAmountFor(n) > 0);
  const totalFixed = fixedChosen.reduce((s, n) => s + fixedAmountFor(n), 0);

  function finish(): void {
    onDone({
      // Empty, not 'there'. That is a greeting filler; storing it as the name
      // makes Profile say the person is called "there".
      displayName: name.trim(),
      baseCurrency: currency,
      expectedIncomeMinor: incomeMinor,
      cycleKind: payEvery === 'monthly' ? 'monthly' : 'days',
      cycleLengthDays: payEvery === 'monthly' ? null : payEvery,
      cycleAnchorDate: payEvery === 'monthly' ? null : lastPayday,
      cycleAnchorDay: payEvery === 'monthly'
        ? new Date(`${lastPayday}T00:00:00`).getDate() : null,
      /*
       * Budgeting starts TODAY, not at the last payday.
       *
       * The cash figure below is what is in hand right now, so the ledger has
       * to open now too. Opening it at the last payday would replay days that
       * already happened against a balance measured after them.
       */
      /* Null when skipped: it is the date the balance was measured, and an
         unanswered question has no measurement to date. See cashKnown. */
      budgetStartDate: cashGiven ? isoDay(new Date()) : null,
      openingCashMinor: cashMinor,
      budgets: chosen.map((n) => {
        const c = SUGGESTED.find((s) => s.name === n)!;
        return { name: c.name, icon: c.icon, colour: c.colour, limitMinor: limitFor(n) };
      }),
      fixedCosts: fixedChosen.map((n) => {
        const c = FIXED_SUGGESTED.find((f) => f.name === n)!;
        return {
          name: c.name, icon: c.icon, colour: c.colour,
          limitMinor: fixedAmountFor(n), dueDay: fixedDayFor(n),
          openingMinor: 0,
        };
      }),
    });
  }

  const next = (): void => setStep((s) => Math.min(7, s + 1) as Step);
  const back = (): void => setStep((s) => Math.max(0, s - 1) as Step);

  return (
    <main style={page}>
      <div style={glow} aria-hidden="true" />
      <div style={shell}>
        {step > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span style={stepLabel}>Step {step} of {TOTAL_STEPS}</span>
              <button type="button" onClick={onSkip} style={skipLink}>Skip setup</button>
            </div>
            <div style={progressRow} aria-hidden="true" role="progressbar">
              {Array.from({ length: TOTAL_STEPS }, (_, n) => n + 1).map((i) => (
                <i key={i} style={{ ...bar, background: i <= step ? 'var(--brand)' : 'var(--surface-3)' }} />
              ))}
            </div>
          </div>
        )}

        {/* ── 0. welcome ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ ...card, textAlign: 'center', justifyItems: 'center' }}>
            <span style={{ marginBottom: 'var(--s3)' }}><Logo size={76} /></span>
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
              aria-label="Your name" autoComplete="given-name"
              maxLength={24} style={field}
            />
            <Footer onBack={back} onNext={next} nextLabel="Continue" skip={next} />
          </div>
        )}

        {/* ── 2. the pay cycle ───────────────────────────────────────── */}
        {step === 2 && (
          <div style={card}>
            <h1 style={h1}>How are you paid?</h1>
            <p style={lede}>Everything is budgeted around this, so it is worth getting right.</p>

            <div style={{ display: 'grid', gap: 'var(--s2)', margin: 'var(--s5) 0' }}>
              {([[7, 'Every week'], [14, 'Every two weeks'],
                 [28, 'Every four weeks'], ['monthly', 'Once a month']] as const).map(([v, label]) => {
                const on = payEvery === v;
                return (
                  <button
                    key={String(v)} type="button" aria-pressed={on}
                    onClick={() => setPayEvery(v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--s3)', width: '100%',
                      padding: '14px var(--s4)', borderRadius: 'var(--r-md)', cursor: 'pointer',
                      textAlign: 'left', fontSize: 'var(--fs-md)', fontWeight: 700,
                      background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
                      border: `1.5px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                      color: on ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >
                    <span aria-hidden style={{
                      width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                      border: `2px solid ${on ? 'var(--brand)' : 'var(--line-strong)'}`,
                      background: on ? 'var(--brand)' : 'transparent',
                    }} />
                    {label}
                  </button>
                );
              })}
            </div>

            <p style={{ ...hint, marginTop: 0 }}>
              {payEvery === 'monthly' ? 'When were you last paid?' : 'When were you last paid?'}
            </p>
            <input
              type="date" value={lastPayday} max={isoDay(new Date())}
              onChange={(e) => setLastPayday(e.target.value || isoDay(new Date()))}
              aria-label="Last payday"
              style={{ ...field, colorScheme: 'dark' }}
            />
            <p style={hint}>
              {/* Boundaries are counted from this date in both directions, so it
                  only has to be a real payday — not the first one. */}
              Pay periods are counted from this date.
            </p>

            <Footer onBack={back} onNext={next} nextLabel="Continue" />
          </div>
        )}

        {/* ── 3. earnings ────────────────────────────────────────────── */}
        {step === 3 && (
          <div style={card}>
            <h1 style={h1}>{payEvery === 'monthly' ? 'Monthly income' : 'Income each time'}</h1>
            <p style={lede}>
              {payEvery === 'monthly'
                ? 'Your take-home pay, after tax.'
                : 'What lands in your account each pay packet, after tax.'}
            </p>

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
                // Tracks the same condition as the heading above, which
                // already switches to "Income each time" for non-monthly pay
                // — a screen reader was announcing "Monthly income" while the
                // visible heading said something else entirely.
                aria-label={payEvery === 'monthly' ? 'Monthly income' : 'Income each time'}
                style={amountInput} size={Math.max(1, income.length || 1)}
              />
            </div>

            <p style={hint}>You can change this later in Profile.</p>

            <Footer onBack={back} onNext={next} nextLabel="Continue" skip={next} />
          </div>
        )}

        {step === 4 && (
          <div style={card}>
            <h1 style={h1}>What have you got right now?</h1>
            <p style={lede}>
              Everything you can actually spend today — current account, cash,
              whatever you would count if someone asked. Not next month's wages.
            </p>

            <div style={amountRow}>
              <span style={amountCur}>{formatMoney(0, currency).replace(/[\d.,\s]/g, '')}</span>
              <input
                autoFocus inputMode="decimal" value={cashNow}
                onChange={(e) => setCashNow(e.target.value.replace(/[^0-9.]/g, '').slice(0, 9))}
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
                aria-label="Money you have right now"
                style={amountInput} size={Math.max(1, cashNow.length || 1)}
              />
            </div>

            <p style={hint}>
              Everything is worked out from this, so a rough figure beats a
              blank one. You can correct it in Profile.
            </p>

            <Footer onBack={back} onNext={next} nextLabel="Continue" skip={next} />
          </div>
        )}

        {/* ── 4. categories ──────────────────────────────────────────── */}
        {step === 5 && (
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

        {/* ── 5. budgets ─────────────────────────────────────────────── */}
        {step === 6 && (
          <div style={card}>
            <h1 style={h1}>How much for each?</h1>
            <p style={lede}>Set a limit for each.</p>

            <div style={{ display: 'grid', gap: 10, marginBottom: 'var(--s4)' }}>
              {chosen.map((n) => {
                const c = SUGGESTED.find((s) => s.name === n)!;
                return (
                  <label key={n} style={budgetRow}>
                    <Icon name={c.icon} size={30} colour={c.colour} />
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 'var(--fs-md)', fontWeight: 700,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{c.name}</span>
                    {/* The amount reads as one unit: symbol and figure share a
                        bordered field rather than floating loose in the row. */}
                    <span style={{
                      display: 'flex', alignItems: 'baseline', gap: 1, flexShrink: 0,
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)', padding: '7px 10px',
                    }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-sm)' }}>
                        {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
                      </span>
                      <input
                        inputMode="decimal"
                        value={limits[n] ?? ''}
                        placeholder="0"
                        onChange={(e) => setLimits((p) => ({ ...p, [n]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        aria-label={`${n} limit`}
                        style={budgetInput}
                      />
                    </span>
                  </label>
                );
              })}
            </div>

            <p style={{ ...hint, marginTop: 0, marginBottom: 'var(--s3)' }}>
              Add a limit for each. Leave one blank and it stays untracked.
            </p>

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

        {/* ── 6. fixed costs ─────────────────────────────────────────── */}
        {step === 7 && (
          <div style={card}>
            <h1 style={h1}>Bills and fixed costs</h1>
            <p style={lede}>Regular payments, kept separate from your spending money.</p>

            {/*
              One screen, like the budgets step before it.
              
              This used to be two phases: tap chips to choose, then a second
              list appeared with three number fields crammed onto each row. The
              chips said nothing about cost, the fields were unreadable on a
              phone, and nothing explained why picking one made a new row show
              up somewhere else. Filling a figure in IS choosing it — the same
              idiom as "leave one blank and it stays untracked" a step earlier.
            */}
            <div style={{ display: 'grid', gap: 10, marginBottom: 'var(--s4)' }}>
              {FIXED_SUGGESTED.map((c) => {
                const amount = fixedAmounts[c.name] ?? '';
                const on = amount.trim() !== '';
                return (
                  <label key={c.name} style={{
                    ...budgetRow,
                    border: `1px solid ${on ? 'var(--line-brand)' : 'transparent'}`,
                    background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
                  }}>
                    <Icon name={c.icon} size={30} colour={c.colour} />
                    <span style={{
                      flex: 1, minWidth: 0, fontSize: 'var(--fs-md)', fontWeight: 700,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{c.name}</span>

                    {/* The due day only matters once there is something to pay. */}
                    {on && (
                      <span style={{
                        display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0,
                        background: 'var(--surface)', border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)', padding: '7px 9px',
                      }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                          DAY
                        </span>
                        <input
                          inputMode="numeric"
                          value={fixedDays[c.name] ?? String(c.dueDay)}
                          onChange={(e) => setFixedDays((p) => ({ ...p, [c.name]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2) }))}
                          aria-label={`${c.name} due day`}
                          style={{ ...budgetInput, width: 24, textAlign: 'center' }}
                        />
                      </span>
                    )}

                    <span style={{
                      display: 'flex', alignItems: 'baseline', gap: 1, flexShrink: 0,
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)', padding: '7px 10px',
                    }}>
                      <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-sm)' }}>
                        {formatMoney(0, currency).replace(/[\d.,\s]/g, '')}
                      </span>
                      <input
                        inputMode="decimal"
                        value={amount}
                        placeholder="0"
                        onChange={(e) => setFixedAmounts((p) => ({ ...p, [c.name]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        aria-label={`${c.name} amount`}
                        style={budgetInput}
                      />
                    </span>
                  </label>
                );
              })}
            </div>

            <p style={{ ...hint, marginTop: 0, marginBottom: 'var(--s3)' }}>
              Put an amount against the ones you pay. Leave the rest blank.
            </p>

            <div style={totalRow}>
              <span>Fixed costs</span>
              <b className="num">{formatMoney(totalFixed, currency)}</b>
            </div>
            {incomeMinor > 0 && (
              <p style={{ ...hint, marginBottom: 'var(--s3)' }}>
                {totalFixed + totalBudget > incomeMinor
                  ? `${formatMoney(totalFixed + totalBudget - incomeMinor, currency)} over your income.`
                  : `${formatMoney(incomeMinor - totalFixed - totalBudget, currency)} left over.`}
              </p>
            )}

            <Footer onBack={back} onNext={finish} nextLabel="Finish setup" skip={finish} />
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
  display: 'grid', placeItems: 'center',
  padding: 'calc(var(--safe-top) + var(--s5)) var(--s5) calc(var(--safe-bottom) + var(--s5))',
};
/** Identical bloom to the sign-in screen — same size, position and stops. */
const glow: React.CSSProperties = {
  position: 'absolute', top: '-22%', left: '50%', transform: 'translateX(-50%)',
  width: 'min(560px, 130vw)', aspectRatio: '1', borderRadius: '50%', pointerEvents: 'none',
  background: 'radial-gradient(circle, rgba(194,214,232,.20) 0%, rgba(159,199,178,.07) 44%, transparent 70%)',
};
const shell: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: 'min(100%, 380px)', display: 'grid', gap: 'var(--s6)',
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
  width: 48, minHeight: 48, borderRadius: 4, cursor: 'pointer',
  background: 'var(--surface-3)', border: 0, color: 'var(--text-muted)',
  display: 'grid', placeItems: 'center',
};
const progressRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${TOTAL_STEPS},1fr)`, gap: 6 };
const bar: React.CSSProperties = { height: 4, borderRadius: 'var(--r-pill)', transition: 'background .25s' };
/** No panel, matching sign-in. The step IS the screen. */
const card: React.CSSProperties = { display: 'grid', gap: 'var(--s3)' };
const h1: React.CSSProperties = { fontSize: 'var(--fs-hero)', fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.12 };
const lede: React.CSSProperties = { fontSize: 'var(--fs-md)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 'var(--s2)' };
const field: React.CSSProperties = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line-strong)',
  borderRadius: 'var(--r-md)', padding: '15px var(--s4)',
  /* 16px, not the 15px scale step: anything smaller makes iOS Safari zoom the
     whole page when the field takes focus. */
  fontSize: 16, fontWeight: 600, color: 'var(--text)', outline: 'none',
};
const segRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, padding: 4,
  background: 'var(--surface-2)', borderRadius: 'var(--r-pill)',
};
const seg = (on: boolean): React.CSSProperties => ({
  padding: '10px 0', borderRadius: 'var(--r-pill)', border: 0, cursor: 'pointer',
  fontSize: 'var(--fs-sm)', fontWeight: 800,
  background: on ? 'var(--brand)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--text-dim)',
});
const amountRow: React.CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2, padding: 'var(--s3) 0' };
const amountCur: React.CSSProperties = { fontSize: 26, fontWeight: 700, color: 'var(--text-dim)' };
const amountInput: React.CSSProperties = {
  background: 'none', border: 0, outline: 'none', fontSize: 44, fontWeight: 700,
  letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)', minWidth: '1ch', padding: 0,
};
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 };
const cell = (on: boolean): React.CSSProperties => ({
  display: 'grid', justifyItems: 'center', gap: 7, padding: 'var(--s3) var(--s1)',
  borderRadius: 'var(--r-xl)', cursor: 'pointer',
  background: on ? 'var(--brand-soft)' : 'var(--surface-2)',
  border: `1.5px solid ${on ? 'var(--brand)' : 'transparent'}`,
  color: on ? 'var(--text)' : 'var(--text-dim)',
});
const budgetRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3)',
  background: 'var(--surface-2)', borderRadius: 'var(--r-xl)',
};
const budgetInput: React.CSSProperties = {
  width: 72, background: 'transparent', border: 0, outline: 'none',
  fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', padding: 0,
};
const totalRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-xl)', background: 'var(--brand-soft)',
  border: '1px solid var(--line-brand)', fontSize: 'var(--fs-sm)', fontWeight: 700,
};
const hint: React.CSSProperties = { fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' };
/** Same metrics as sign-in, so the flow keeps one control language. */
const baseBtn: React.CSSProperties = {
  width: '100%', minHeight: 48, borderRadius: 'var(--r-md)', border: 0,
  fontSize: 'var(--fs-md)', fontWeight: 700, cursor: 'pointer',
};
const primary = (disabled: boolean): React.CSSProperties => ({
  ...baseBtn, background: 'var(--brand)', color: 'var(--on-accent)',
  opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
});
const ghost: React.CSSProperties = {
  ...baseBtn, minHeight: 44, background: 'transparent', color: 'var(--text-dim)', fontWeight: 600,
};
