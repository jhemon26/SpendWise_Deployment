import type { Derived } from './selectors.js';

/**
 * The line under the hero: what this spending pace actually means.
 *
 * Graded on the gap between what has been spent and what the calendar says
 * should have been, as a share of the month's budget — not on the raw amount.
 * £50 over is nothing on a £2,000 budget and a crisis on a £100 one, and a
 * message that ignores that is noise.
 *
 * One line with a bit of character — the way a person would say it, not a
 * report. Short enough to read at a glance, and it still carries the fact that
 * matters (the day the money runs out, how far behind the month you are).
 */

export type VerdictTone = 'great' | 'good' | 'steady' | 'warn' | 'bad';

export interface Verdict {
  tone: VerdictTone;
  /** One line. It sits inline under the stats, so it has to fit on one. */
  line: string;
  icon: VerdictTone;
}

const MOOD_COLOUR: Record<VerdictTone, string> = {
  great: 'var(--positive)',
  good: 'var(--positive)',
  steady: 'var(--brand-cyan)',
  warn: 'var(--warning)',
  bad: 'var(--danger)',
};

export const verdictColour = (t: VerdictTone): string => MOOD_COLOUR[t];

/**
 * The day the day-to-day money runs out at the current rate, or null while
 * nothing has been spent yet.
 */
function runsOutOn(d: Derived): number | null {
  if (d.flexSpentMinor <= 0 || d.dayOfMonth <= 0) return null;
  const perDay = d.flexSpentMinor / d.dayOfMonth;
  if (perDay <= 0) return null;
  const day = Math.round(d.dayOfMonth + d.leftMinor / perDay);
  if (day >= d.daysInMonth) return null;      // lasts the month; nothing to warn about
  return Math.max(d.dayOfMonth, day);
}

export function verdictFor(d: Derived, dayToDayMinor: number, monthName: string): Verdict {
  // Nothing to judge yet: a fresh month should not be congratulated for
  // spending nothing on the 1st.
  if (dayToDayMinor <= 0) {
    return {
      tone: 'steady',
      line: 'Set a budget and this tells you how you are doing',
      icon: 'steady',
    };
  }
  if (d.flexSpentMinor === 0 && d.dayOfMonth <= 2) {
    return { tone: 'steady', line: 'Clean slate. Nothing spent yet.', icon: 'steady' };
  }

  // Positive delta = spent more than the calendar expects by now.
  const share = d.deltaMinor / dayToDayMinor;
  const outOn = runsOutOn(d);

  if (d.leftMinor < 0) {
    return {
      tone: 'bad',
      line: `Budget's gone with ${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'} of ${monthName} left`,
      icon: 'bad',
    };
  }
  if (share > 0.15) {
    return {
      tone: 'bad',
      line: outOn ? `Steady on — you're out of money by the ${ordinal(outOn)}` : 'Spending well ahead of the month',
      icon: 'bad',
    };
  }
  if (share > 0.04) {
    return {
      tone: 'warn',
      line: outOn ? `A bit heavy — this lasts until the ${ordinal(outOn)}` : 'A bit ahead of the month',
      icon: 'warn',
    };
  }
  if (share > -0.04) {
    return { tone: 'steady', line: 'Bang on pace. Nothing to see here.', icon: 'steady' };
  }
  if (share > -0.15) {
    return { tone: 'good', line: 'Nicely under. Room to spare.', icon: 'good' };
  }
  return {
    tone: 'great',
    line: 'Barely spending. Saving up for something?',
    icon: 'great',
  };
}

function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
}

/**
 * Flat multi-colour marks, drawn at 20px.
 *
 * Each one says the verdict on its own, so the icon is not decoration next to
 * the words — money flying away for overspending, a car for the Porsche line.
 * Same rules as the avatars: no gradients, no hairlines, nothing that turns to
 * mush at this size.
 */
export const VERDICT_ICON: Record<VerdictTone, string> = {
  // Sports car — the payoff the copy promises.
  great: `<path d="M2 15.4c0-.9.6-1.7 1.5-1.9l1.4-.3 1.9-3.3A3.1 3.1 0 0 1 9.5 8.3h5c1.1 0 2.1.6 2.7 1.5l1.9 3.3 1.4.3c.9.2 1.5 1 1.5 1.9v1.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="#EF4444"/>
    <path d="M7.3 12.9 8.6 10.6c.3-.5.8-.8 1.3-.8h4.2c.5 0 1 .3 1.3.8l1.3 2.3z" fill="#BFDBFE"/>
    <circle cx="7" cy="17.4" r="2.6" fill="#1F2937"/><circle cx="7" cy="17.4" r="1.1" fill="#D1D5DB"/>
    <circle cx="17" cy="17.4" r="2.6" fill="#1F2937"/><circle cx="17" cy="17.4" r="1.1" fill="#D1D5DB"/>`,

  // Piggy bank with a coin going in.
  good: `<circle cx="15.6" cy="4.2" r="2.6" fill="#FACC15"/>
    <path d="M20.5 13c0 3.3-3.4 5.6-7.6 5.6-.9 0-1.8-.1-2.6-.3l-3 1.6.6-3C5.6 15.8 4.5 14.5 4.5 13c0-3.3 3.4-5.9 8-5.9s8 2.6 8 5.9z" fill="#F472B6"/>
    <ellipse cx="18.4" cy="13.2" rx="2.1" ry="1.7" fill="#EC4899"/>
    <circle cx="17.8" cy="13.2" r=".45" fill="#831843"/><circle cx="19.1" cy="13.2" r=".45" fill="#831843"/>
    <circle cx="10.6" cy="11.8" r="1.15" fill="#1F2937"/>
    <path d="M8.4 8.2 7.2 5.9l3 1.1z" fill="#EC4899"/>`,

  // Target, dead centre.
  steady: `<circle cx="12" cy="12" r="9.6" fill="#06B6D4"/>
    <circle cx="12" cy="12" r="6.4" fill="#ECFEFF"/>
    <circle cx="12" cy="12" r="3.3" fill="#06B6D4"/>
    <circle cx="12" cy="12" r="1.3" fill="#F8FAFC"/>`,

  // Speedometer with the needle well past the middle.
  warn: `<circle cx="12" cy="12" r="9.6" fill="#F59E0B"/>
    <path d="M5.4 14.6a6.9 6.9 0 0 1 13.2 0" stroke="#FEF3C7" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M12 12.8 16.6 9.4" stroke="#7C2D12" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="12" cy="12.8" r="1.7" fill="#7C2D12"/>`,

  // Banknote with wings: the money is leaving.
  bad: `<path d="M1.6 9.4 5.6 6.2c.5 2.4-.6 3.9-4 3.2z" fill="#E0F2FE"/>
    <path d="M22.4 9.4 18.4 6.2c-.5 2.4.6 3.9 4 3.2z" fill="#E0F2FE"/>
    <rect x="5" y="8.6" width="14" height="9" rx="1.6" fill="#10B981"/>
    <rect x="7" y="10.6" width="10" height="5" rx="1" fill="#A7F3D0"/>
    <circle cx="12" cy="13.1" r="2" fill="#047857"/>
    <path d="M12 11.7v2.8M11 12.4h2M11 13.8h2" stroke="#ECFDF5" stroke-width=".9" stroke-linecap="round"/>`,
};
