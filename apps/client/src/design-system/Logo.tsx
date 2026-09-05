/**
 * The SpendWise mark.
 *
 * Inline SVG rather than the PNG the screens used before: it stays crisp at any
 * size, costs no request, cannot 404, and renders while offline like the rest
 * of the app.
 *
 * An SW lettermark where the W is also a chart trace — two falls and two rises,
 * with the accent on the live end. The W is the only letter in the name that
 * can carry meaning as well as spell it, so it does both jobs.
 *
 * Ink-on-dark rather than a saturated fill: every other budgeting app is a
 * bright square, and this one sits on the same near-black the app runs on.
 *
 * Kept byte-identical to the SVG in index.html, which paints before any
 * JavaScript loads. If the two drift, the handover from the boot splash to the
 * React one becomes a visible flicker. brand/spendwise-mark.svg is the source
 * both are copied from, and the app icons are generated from it.
 */
export function Logo({ size = 88, rounded = true }: { size?: number; rounded?: boolean }): JSX.Element {
  // Unique per instance: two logos on one page would otherwise share a gradient
  // id, and the second would silently pick up the first one's definition.
  const id = `sw-logo-${size}`;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role="img"
      aria-label="SpendWise"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141726" />
          <stop offset="1" stopColor="#08080d" />
        </linearGradient>
        <radialGradient id={`${id}-bloom`} cx=".26" cy=".2" r=".75">
          <stop offset="0" stopColor="#c2d6e8" stopOpacity=".22" />
          <stop offset="1" stopColor="#c2d6e8" stopOpacity="0" />
        </radialGradient>
      </defs>
      {rounded && (
        <>
          <rect width="512" height="512" rx="116" fill={`url(#${id}-tile)`} />
          <rect width="512" height="512" rx="116" fill={`url(#${id}-bloom)`} />
        </>
      )}
      <path
        d="M206 186a48 48 0 1 0-48 48 48 48 0 1 1-48 48"
        fill="none" stroke="#c2d6e8" strokeWidth="42" strokeLinecap="round"
      />
      <path
        d="M262 140 302 330 344 226 386 330 426 140"
        fill="none" stroke="#c2d6e8" strokeWidth="42"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="426" cy="140" r="25" fill="#9fc7b2" />
    </svg>
  );
}

/**
 * The boot screen.
 *
 * Deliberately identical to the markup in index.html, which paints before any
 * JavaScript runs. When React mounts and replaces it, nothing moves — the two
 * read as one screen rather than a flash followed by a different screen.
 */
export function Splash(): JSX.Element {
  return (
    <main style={{
      minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'transparent',
    }}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 18 }}>
        <Logo size={88} />
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--text)' }}>
          SpendWise
        </div>
        <div style={{
          width: 120, height: 3, borderRadius: 2, overflow: 'hidden',
          background: 'rgba(255,255,255,.10)',
        }}>
          <div style={{
            width: '40%', height: '100%', borderRadius: 2, background: 'var(--brand)',
            animation: 'bootbar 1.1s ease-in-out infinite',
          }} />
        </div>
      </div>
    </main>
  );
}
