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
