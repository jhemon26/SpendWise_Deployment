/**
 * Arc geometry for the budget ring.
 *
 * Round stroke caps overhang the path by half the stroke width at EACH end. The
 * original prototype set `stroke-linecap: round` and drew a dash of exactly the
 * intended length, so the painted arc was one full stroke width too long at
 * every value — a constant ~4.3 percentage points. The ring said 33% while the
 * number in the middle said 29%.
 *
 * The fix: shorten the dash by one stroke width and push it forward by half, so
 * the painted arc INCLUDING its caps spans exactly the percentage. Below one
 * stroke width there is no room for two caps, so we switch to butt ends rather
 * than lie.
 */

export const GAUGE_R = 33;
export const GAUGE_SW = 9;
export const GAUGE_C = 2 * Math.PI * GAUGE_R;

export interface ArcStyle {
  strokeDasharray: string;
  strokeDashoffset: string;
  linecap: 'round' | 'butt';
}

export function arcFor(pct: number): ArcStyle {
  const frac = Math.max(0, Math.min(pct, 100)) / 100;
  const visible = GAUGE_C * frac;

  if (visible <= 0.01) {
    // Nothing used: paint nothing. A round cap here would render a stray dot.
    return { strokeDasharray: `0 ${GAUGE_C}`, strokeDashoffset: '0', linecap: 'butt' };
  }
  if (visible >= GAUGE_C - 0.01) {
    return { strokeDasharray: `${GAUGE_C} 0`, strokeDashoffset: '0', linecap: 'butt' };
  }
  if (visible < GAUGE_SW) {
    return {
      strokeDasharray: `${visible} ${GAUGE_C - visible}`,
      strokeDashoffset: '0',
      linecap: 'butt',
    };
  }
  const dash = visible - GAUGE_SW;
  return {
    strokeDasharray: `${dash} ${GAUGE_C - dash}`,
    strokeDashoffset: `${-GAUGE_SW / 2}`,
    linecap: 'round',
  };
}

/** A 2-unit marker centred on the calendar position. */
export function tickFor(pct: number): { strokeDasharray: string; strokeDashoffset: string } {
  const frac = Math.max(0, Math.min(pct, 100)) / 100;
  const at = GAUGE_C * frac;
  return {
    strokeDasharray: `2 ${GAUGE_C - 2}`,
    strokeDashoffset: `${-(at - 1)}`,
  };
}

/** What the browser actually paints, caps included. Used by the tests. */
export function paintedLength(a: ArcStyle): number {
  const [dashStr] = a.strokeDasharray.split(' ');
  const dash = Number(dashStr);
  if (dash === 0) return 0;
  return a.linecap === 'round' ? dash + GAUGE_SW : dash;
}
