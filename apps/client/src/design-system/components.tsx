import type { CSSProperties, ReactNode } from 'react';
import { ICONS } from './icons.js';
import { arcFor, tickFor, GAUGE_C } from './gauge-math.js';

/* Primitives ported from the prototype's CSS component layer. Presentation
   only — every number they display is computed by the selectors. */

export function Icon({
  name,
  size = 40,
  colour,
}: {
  name: string;
  size?: number;
  colour?: string;
}): JSX.Element {
  const glyph = ICONS[name] ?? ICONS['other'] ?? '';
  const inner = Math.round(size * 0.5);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? 'var(--r-md)' : 9,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        color: '#fff',
        background: colour ?? 'var(--surface-2)',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={inner}
        height={inner}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: glyph }}
      />
    </span>
  );
}

/**
 * The budget ring.
 *
 * `arcFor` compensates for round-cap overhang, so the painted arc matches the
 * number in the middle exactly — see gauge-math.ts for why that is not
 * automatic.
 */
export function Gauge({
  pct,
  datePct,
  colour,
  label = 'Used',
  tourId,
  size = 96,
}: {
  pct: number;
  datePct: number;
  colour: string;
  label?: string;
  tourId?: string | undefined;
  size?: number;
}): JSX.Element {
  const arc = arcFor(pct);
  const tick = tickFor(datePct);
  return (
    <div data-tour={tourId} style={{ position: 'relative', width: size, height: size, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
      <svg viewBox="0 0 80 80" width={size} height={size} style={{ transform: 'rotate(-90deg)' }} role="img"
           aria-label={`${Math.round(pct)} percent of budget used`}>
        <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={9} />
        <circle
          cx="40" cy="40" r="33" fill="none" stroke={colour} strokeWidth={9}
          strokeLinecap={arc.linecap}
          strokeDasharray={arc.strokeDasharray}
          strokeDashoffset={arc.strokeDashoffset}
          style={{ transition: 'stroke-dasharray .7s cubic-bezier(.4,0,.2,1), stroke .3s ease' }}
        />
        <circle
          cx="40" cy="40" r="33" fill="none" stroke="#fff" strokeWidth={11} strokeLinecap="butt"
          strokeDasharray={tick.strokeDasharray} strokeDashoffset={tick.strokeDashoffset}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
        <p className="num" style={{ fontSize: 'var(--fs-md)', fontWeight: 800, letterSpacing: '-.03em' }}>
          {Math.round(pct)}%
        </p>
        <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {label}
        </p>
      </div>
      <svg width={0} height={0} aria-hidden>
        <defs>
          <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06B6D4" />
            <stop offset="55%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#A855F7" />
          </linearGradient>
        </defs>
      </svg>
      <span hidden>{GAUGE_C}</span>
    </div>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-xl)',
        padding: 'var(--s5)',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function CardHead({ title, action }: { title: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, letterSpacing: '-.02em' }}>{title}</h2>
      {action}
    </div>
  );
}

export function Bar({ pct, colour }: { pct: number; colour: string }): JSX.Element {
  return (
    <div style={{ height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface-3)', overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${Math.min(Math.max(pct, 0), 100)}%`,
          background: colour,
          borderRadius: 'var(--r-pill)',
          transition: 'width .5s cubic-bezier(.4,0,.2,1)',
        }}
      />
    </div>
  );
}

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'neutral'; children: ReactNode }): JSX.Element {
  const map = {
    ok: ['var(--positive-soft)', 'var(--positive)'],
    warn: ['var(--warning-soft)', 'var(--warning)'],
    danger: ['var(--danger-soft)', 'var(--danger)'],
    neutral: ['var(--surface-2)', 'var(--text-muted)'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)',
      fontWeight: 700, padding: '5px 10px', borderRadius: 'var(--r-pill)',
      whiteSpace: 'nowrap', background: bg, color: fg,
    }}>{children}</span>
  );
}

export function Empty({ icon, title, body }: { icon: string; title: string; body: string }): JSX.Element {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--s7) var(--s5)' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s4)' }}>
        <Icon name={icon} size={52} colour="var(--surface-2)" />
      </div>
      <p style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>{title}</p>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 6, maxWidth: '30ch', marginInline: 'auto' }}>
        {body}
      </p>
    </div>
  );
}

/**
 * Initials for the avatar.
 *
 * The header used `name[0]` and Profile used up-to-two words, so one person saw
 * "J" in one place and "JH" in the other. One rule, used by both.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '\u00B7';
  return words.slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase();
}

/** The greeting falls back; the stored name does not. */
export const greetingFor = (name: string): string =>
  name.trim() ? `Hi, ${name.trim()}` : 'Hi there';

/**
 * Profile avatar.
 *
 * An emoji if one has been chosen, otherwise initials — never an empty circle.
 * Emoji are used deliberately over bundled artwork: they render at any size,
 * cost nothing to ship, and already cover the "something chill" range people
 * actually want.
 */
export function Avatar({ emoji, colour, name, size = 40 }: {
  emoji: string; colour: string; name: string; size?: number;
}): JSX.Element {
  return (
    <span style={{
      width: size, height: size, borderRadius: 'var(--r-pill)', flexShrink: 0,
      display: 'grid', placeItems: 'center',
      background: emoji ? colour : 'var(--surface)',
      // Keep the gradient ring when there is no emoji, so the fallback still
      // looks intentional rather than unstyled.
      boxShadow: emoji ? 'none' : `0 0 0 2px ${colour}`,
      fontSize: Math.round(size * 0.52), lineHeight: 1,
      color: '#fff', fontWeight: 800, letterSpacing: '-.02em',
    }}>
      {emoji || initialsOf(name)}
    </span>
  );
}

/** Chill, non-corporate, and legible at 20px. */
export const AVATAR_EMOJI = [
  '🐱', '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸',
  '🐧', '🦉', '🐢', '🐙', '🦄', '🐝', '🦋', '🐬',
  '🦜', '🐰', '🌵', '🍀', '🌙', '⭐', '🔥', '🚀',
];
