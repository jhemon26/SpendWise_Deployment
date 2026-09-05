import type { CSSProperties, ReactNode } from 'react';
import { arcFor, tickFor, GAUGE_C } from './gauge-math.js';
import { AVATARS, isSvgAvatar, svgAvatarKey } from './avatars.js';
import { chalk } from './hues.js';
import { COLOUR_ICONS } from './icons.colour.js';

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
  const glyph = COLOUR_ICONS[name] ?? COLOUR_ICONS['other'] ?? [];
  const inner = Math.round(size * 0.82);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? 'var(--r-md)' : 'var(--r-sm)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        /*
         * The tile is a faint wash of the category hue, not the hue itself.
         * These glyphs carry their own colours, so a solid tile fought them —
         * a red bus on a red square is a red square. The wash keeps each
         * category recognisable at a glance without competing with the object.
         */
        background: tint(colour),
      }}
    >
      <svg viewBox="0 0 24 24" width={inner} height={inner} aria-hidden focusable="false">
        {glyph.map(([fill, d], i) => <path key={i} fill={fill} d={d} />)}
      </svg>
    </span>
  );
}

/** The category hue at low opacity, for a tile that sits behind a coloured glyph. */
function tint(colour: string | undefined): string {
  const c = chalk(colour);
  return c.startsWith('#') && c.length === 7 ? `${c}22` : 'var(--surface-2)';
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
        <circle cx="40" cy="40" r="33" fill="none" stroke="var(--line)" strokeWidth={9} />
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
        // 18px, not the 20px step. The prototype settled on it because at 20
        // the cards start to feel like panels rather than a list.
        padding: 18,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/**
 * A category's colour as a small square, not a filled tile.
 *
 * The icon tiles were carried over from the old design, where the tile WAS the
 * category colour and the glyph sat on it. Under the chalk palette a row of
 * 30px filled tiles is the loudest thing on the screen and fights the low
 * chroma the whole palette exists for. A 9px mark identifies the category just
 * as well at a glance and lets the numbers lead.
 */
export function Dot({ colour, size = 9 }: { colour: string; size?: number }): JSX.Element {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: 3, background: colour, flexShrink: 0,
      display: 'block',
    }} />
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

/**
 * A proportion, drawn.
 *
 * Two things went wrong here often enough to be worth spelling out:
 *
 * A non-finite `pct` produced `width: "NaN%"`. That is invalid CSS, so the
 * browser discards the declaration and the inner block falls back to its auto
 * width — the whole track. Every divide-by-zero drew a completely full bar.
 *
 * And a small-but-real proportion rounded away to nothing: £2 against a £400
 * budget is 0.5%, which on a pill-shaped track with a border radius renders as
 * no pixels at all, so a category that had been spent in looked untouched.
 * Anything above zero now keeps a visible sliver.
 */
export function Bar({ pct, colour }: { pct: number; colour: string }): JSX.Element {
  const safe = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : 0;
  const width = safe > 0 ? Math.max(safe, 2.5) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface-3)', overflow: 'hidden' }}
    >
      <div
        style={{
          height: '100%',
          width: `${width}%`,
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
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5,
      fontWeight: 700, padding: '4px 9px', borderRadius: 'var(--r-pill)',
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
  // Illustrations carry their own background and palette, so they fill the
  // circle outright — no plate colour underneath to show through or clash.
  if (isSvgAvatar(emoji)) {
    const art = AVATARS[svgAvatarKey(emoji)];
    if (art) {
      return (
        <svg
          viewBox="0 0 64 64"
          width={size}
          height={size}
          role="img"
          aria-label="Profile picture"
          style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
          dangerouslySetInnerHTML={{ __html: art }}
        />
      );
    }
    // Unknown id — fall through to initials rather than an empty circle.
  }

  return (
    <span style={{
      width: size, height: size, borderRadius: 'var(--r-pill)', flexShrink: 0,
      display: 'grid', placeItems: 'center',
      background: 'var(--surface)',
      // A ring so the initials fallback still looks deliberate.
      boxShadow: `0 0 0 2px ${chalk(colour)}`,
      fontSize: Math.round(size * 0.52), lineHeight: 1,
      color: '#fff', fontWeight: 800, letterSpacing: '-.02em',
    }}>
      {initialsOf(name)}
    </span>
  );
}

