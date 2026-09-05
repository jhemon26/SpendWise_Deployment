/**
 * Identity hues, translated for the chalk ground.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A MIGRATION
 *
 * Category and bank colours are user data: they are stored per row in the
 * database and have been since launch. The palette the app shipped with was
 * saturated (teal #14B8A6, hot pink #EC4899) and those values are sitting in
 * live accounts right now.
 *
 * Those hues cannot sit on the chalk ground — at 60-70% saturation against a
 * #08080d background they become the loudest thing on screen and the whole app
 * reads as a rainbow on black. But rewriting them in the database would be a
 * destructive, one-way edit to data a person chose, for a presentational
 * reason. If the palette is ever reverted, or a user exports their data, the
 * original choice has to still be there.
 *
 * So the translation happens at RENDER time. Nothing is written, nothing is
 * lost, and reverting the theme is a one-line change rather than a second
 * migration.
 *
 * Known palette hexes get a hand-picked tint of the same family, so categories
 * stay as distinguishable from each other as they were. Anything else — a
 * colour picked before the palette changed, or one we simply do not recognise —
 * is desaturated arithmetically to land in the same range.
 */

/** Hand-picked so the twelve shipped hues stay mutually distinguishable. */
const EXACT: Readonly<Record<string, string>> = Object.freeze({
  '#8b5cf6': '#b4aecf', // violet
  '#6366f1': '#aab0d4', // indigo
  '#14b8a6': '#93bfb2', // teal
  '#fb923c': '#d9b8a2', // orange
  '#ec4899': '#d2a8b8', // pink
  '#22d3ee': '#a6c9d6', // cyan
  '#eab308': '#cfc095', // yellow
  '#94a3b8': '#aeb4c0', // slate
  '#64748b': '#9aa0ac', // slate dark
  '#10b981': '#9fc7b2', // green
  '#f472b6': '#d6aec0', // rose
  '#38bdf8': '#a8c2d8', // sky
  '#a855f7': '#c4aed4', // purple
  '#ff4d6a': '#d2a8b8', // Monzo red
  '#06b6d4': '#a6c9d6', // brand cyan

  /* Identity entries. A colour picked from the translated palette is already
     in range, so it must pass through unchanged — without these it would be
     re-derived by restyle() and drift a shade every time. */
  '#b4aecf': '#b4aecf', '#aab0d4': '#aab0d4', '#93bfb2': '#93bfb2',
  '#d9b8a2': '#d9b8a2', '#d2a8b8': '#d2a8b8', '#a6c9d6': '#a6c9d6',
  '#cfc095': '#cfc095', '#aeb4c0': '#aeb4c0', '#9aa0ac': '#9aa0ac',
  '#9fc7b2': '#9fc7b2', '#d6aec0': '#d6aec0', '#a8c2d8': '#a8c2d8',
  '#c4aed4': '#c4aed4',
});

/** Where every translated hue lands: low chroma, high lightness. */
const SAT = 0.28;
const LIGHT = 0.72;

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

const toHex = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** Hue is preserved; only saturation and lightness are pinned. */
function restyle(r: number, g: number, b: number): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let hue = 0;
  if (d !== 0) {
    if (max === rn) hue = ((gn - bn) / d) % 6;
    else if (max === gn) hue = (bn - rn) / d + 2;
    else hue = (rn - gn) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  // A grey stays grey — forcing saturation onto it would invent a colour.
  const sat = d === 0 ? 0 : SAT;

  const c = (1 - Math.abs(2 * LIGHT - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = LIGHT - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const [r2, g2, b2] =
    seg === 0 ? [c, x, 0] :
    seg === 1 ? [x, c, 0] :
    seg === 2 ? [0, c, x] :
    seg === 3 ? [0, x, c] :
    seg === 4 ? [x, 0, c] :
                [c, 0, x];

  return `#${toHex((r2 + m) * 255)}${toHex((g2 + m) * 255)}${toHex((b2 + m) * 255)}`;
}

/**
 * Translate a stored identity colour for display.
 *
 * Passes through anything that is not a plain hex — `var(--surface-2)` and
 * friends are already theme tokens and must not be touched.
 */
export function chalk(colour: string | null | undefined): string {
  if (!colour) return 'var(--surface-2)';
  if (!colour.startsWith('#')) return colour;

  const exact = EXACT[colour.toLowerCase()];
  if (exact) return exact;

  const rgb = hexToRgb(colour);
  if (!rgb) return colour;
  return restyle(rgb[0], rgb[1], rgb[2]);
}

/**
 * The palette offered when picking a colour for a NEW category or bank.
 *
 * These are the translated values, so what a person picks is what they see —
 * chalk() leaves them alone because they are already in the map's range.
 */
export const PALETTE: readonly string[] = Object.freeze([
  '#b4aecf', '#aab0d4', '#93bfb2', '#d9b8a2', '#d2a8b8', '#a6c9d6',
  '#cfc095', '#aeb4c0', '#9aa0ac', '#9fc7b2', '#d6aec0', '#a8c2d8',
]);
