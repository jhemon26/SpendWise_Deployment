// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Bar } from './components.js';

afterEach(cleanup);

const fill = (c: HTMLElement): string =>
  (c.querySelector('[role="progressbar"] > div') as HTMLElement).style.width;

describe('Bar', () => {
  it('fills in proportion', () => {
    expect(fill(render(<Bar pct={40} colour="red" />).container)).toBe('40%');
  });

  it('caps at full rather than overflowing its track', () => {
    expect(fill(render(<Bar pct={250} colour="red" />).container)).toBe('100%');
  });

  it('draws nothing at zero', () => {
    expect(fill(render(<Bar pct={0} colour="red" />).container)).toBe('0%');
  });

  it('never draws a full bar for a non-finite value', () => {
    /*
     * The original bug. `width: "NaN%"` is invalid CSS, so the browser drops
     * the declaration and the inner block takes its auto width — the entire
     * track. A category with no budget rendered as one spent to the limit.
     */
    for (const bad of [NaN, Infinity, -Infinity]) {
      const w = fill(render(<Bar pct={bad} colour="red" />).container);
      expect(w, `pct=${bad} produced width:${w}`).toBe('0%');
      cleanup();
    }
  });

  it('keeps a small amount visible instead of rounding it away', () => {
    // £2 of a £400 budget is 0.5% — on a rounded track that is no pixels.
    const w = fill(render(<Bar pct={0.5} colour="red" />).container);
    expect(parseFloat(w)).toBeGreaterThanOrEqual(2);
  });

  it('treats a negative proportion as empty, not as a rearward bar', () => {
    expect(fill(render(<Bar pct={-30} colour="red" />).container)).toBe('0%');
  });

  it('reports its value to assistive technology', () => {
    const { container } = render(<Bar pct={62.4} colour="red" />);
    const el = container.querySelector('[role="progressbar"]')!;
    expect(el.getAttribute('aria-valuenow')).toBe('62');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
  });
});
