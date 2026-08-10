import type { Derived } from './selectors.js';

/**
 * The line under the hero: what this spending pace actually means.
 *
 * Graded on the gap between what has been spent and what the calendar says
 * should have been, as a share of the month's budget — not on the raw amount.
 * £50 over is nothing on a £2,000 budget and a crisis on a £100 one, and a
 * message that ignores that is noise.
 *
 * The tone escalates, but it never jokes about actually running out of money.
 * Someone genuinely close to the edge is the last person who needs their
 * budgeting app being funny about it, and they are exactly who sees the worst
 * tier. The humour lives in the good news, and the bad news stays plain and
 * useful — it says what to do, not how doomed you are.
 */

export type VerdictTone = 'great' | 'good' | 'steady' | 'warn' | 'bad';

export interface Verdict {
  tone: VerdictTone;
  /** Bold, coloured. The finding. */
  headline: string;
  /** Muted, after a middot. The consequence or the nudge. */
  detail: string;
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
      headline: 'Set a budget',
      detail: 'then this is where you find out how you are doing',
      icon: 'steady',
    };
  }
  if (d.flexSpentMinor === 0 && d.dayOfMonth <= 2) {
    return { tone: 'steady', headline: 'Fresh month', detail: 'nothing spent yet', icon: 'steady' };
  }

  // Positive delta = spent more than the calendar expects by now.
  const share = d.deltaMinor / dayToDayMinor;
  const outOn = runsOutOn(d);

  if (d.leftMinor < 0) {
    return {
      tone: 'bad',
      headline: 'Budget gone',
      detail: `${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'} of ${monthName} still to go`,
      icon: 'bad',
    };
  }
  if (share > 0.15) {
    return {
      tone: 'bad',
      headline: 'Spending fast',
      detail: outOn ? `at this rate you run out on the ${ordinal(outOn)}` : 'well ahead of the calendar',
      icon: 'bad',
    };
  }
  if (share > 0.04) {
    return {
      tone: 'warn',
      headline: 'A little ahead',
      detail: outOn ? `this pace runs out on the ${ordinal(outOn)}` : 'ease off and it evens out',
      icon: 'warn',
    };
  }
  if (share > -0.04) {
    return { tone: 'steady', headline: 'Right on pace', detail: 'keep it exactly here', icon: 'steady' };
  }
  if (share > -0.15) {
    return { tone: 'good', headline: 'Comfortably under', detail: 'payday is going to feel calm', icon: 'good' };
  }
  return {
    tone: 'great',
    headline: 'Seriously underspending',
    detail: 'keep this up and the Porsche fund is real',
    icon: 'great',
  };
}

function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
}

/** Flat multi-colour marks, 20px. Same rules as the avatars: no gradients. */
export const VERDICT_ICON: Record<VerdictTone, string> = {
  great: `<circle cx="12" cy="12" r="11" fill="#FACC15"/>
    <path d="M4.5 14.5h15l-1.6-4.2a2 2 0 0 0-1.9-1.3H8a2 2 0 0 0-1.9 1.3z" fill="#EF4444"/>
    <rect x="3.5" y="14" width="17" height="3.4" rx="1.7" fill="#F8FAFC"/>
    <circle cx="7.5" cy="18" r="2.1" fill="#1F2937"/><circle cx="16.5" cy="18" r="2.1" fill="#1F2937"/>`,
  good: `<circle cx="12" cy="12" r="11" fill="#10B981"/>
    <path d="M12 6.5c3.2 0 5.5 2.2 5.5 4.8 0 3.2-3.4 5.6-5.5 7-2.1-1.4-5.5-3.8-5.5-7C6.5 8.7 8.8 6.5 12 6.5z" fill="#D1FAE5"/>
    <path d="M9.5 11.8 11.4 13.7 15 10" stroke="#047857" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  steady: `<circle cx="12" cy="12" r="11" fill="#06B6D4"/>
    <circle cx="12" cy="12" r="7" fill="#ECFEFF"/>
    <path d="M12 8.2v4l2.6 1.6" stroke="#0E7490" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  warn: `<circle cx="12" cy="12" r="11" fill="#F59E0B"/>
    <path d="M12 5.6 20 19H4z" fill="#FEF3C7"/>
    <path d="M12 10v3.4" stroke="#B45309" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="12" cy="16.4" r="1.2" fill="#B45309"/>`,
  bad: `<circle cx="12" cy="12" r="11" fill="#EF4444"/>
    <path d="M12 4.5c1.6 3 .3 4.4-.6 5.6-1 1.3-2.4 2.6-2.4 4.7a3.9 3.9 0 0 0 7.8.2c0-1.5-.6-2.6-1.2-3.6-.5 1-1.2 1.5-2 1.5 1.2-2.6.5-5.6-1.6-8.4z" fill="#FDE68A"/>
    <path d="M12 13.2c.9 1.2 1.4 2 1.4 2.9a1.4 1.4 0 0 1-2.8 0c0-.9.5-1.7 1.4-2.9z" fill="#FFF7ED"/>`,
};
