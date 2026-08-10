/**
 * The SpendWise mark.
 *
 * Inline SVG rather than the PNG the screens used before: it stays crisp at any
 * size, costs no request, cannot 404, and renders while offline like the rest
 * of the app.
 *
 * The mark is the product — it is the budget ring from the home screen, with a
 * marker for where you are today. Anyone who has used the app recognises it;
 * anyone who has not still reads "progress" rather than a generic finance
 * glyph. The source of truth is brand/spendwise-mark.svg, which the app icons
 * are generated from.
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
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      {rounded && <rect width="512" height="512" rx="116" fill={`url(#${id})`} />}
      <circle cx="256" cy="256" r="140" fill="none" stroke="#FFFFFF" strokeOpacity=".28" strokeWidth="46" />
      <circle
        cx="256" cy="256" r="140" fill="none" stroke="#FFFFFF" strokeWidth="46"
        strokeLinecap="round" strokeDasharray="616 264"
        transform="rotate(-90 256 256)"
      />
      <circle cx="123" cy="299" r="20" fill="#22D3EE" />
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
      minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)',
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
