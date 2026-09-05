import { describe, expect, it } from 'vitest';
import { chalk, PALETTE } from './hues.js';

/**
 * These guard a property that is easy to break by accident: the translation
 * must never touch stored data, must never let a saturated colour through onto
 * the chalk ground, and must never collapse two categories into the same tint.
 */
describe('chalk()', () => {
  it('translates every hue the app has ever shipped', () => {
    // The saturated palette that is sitting in live accounts right now.
    const shipped = [
      '#8B5CF6', '#6366F1', '#14B8A6', '#FB923C', '#EC4899', '#22D3EE',
      '#EAB308', '#94A3B8', '#64748B', '#10B981', '#F472B6', '#38BDF8',
    ];
    for (const hex of shipped) {
      expect(chalk(hex), `${hex} was left saturated`).not.toBe(hex);
    }
  });

  it('keeps the shipped hues distinguishable from each other', () => {
    const shipped = [
      '#8B5CF6', '#6366F1', '#14B8A6', '#FB923C', '#EC4899', '#22D3EE',
      '#EAB308', '#94A3B8', '#64748B', '#10B981', '#F472B6', '#38BDF8',
    ];
    // Two categories collapsing to one tint would make the Budgets list
    // unreadable at a glance, which is the whole job of the identity colours.
    const out = new Set(shipped.map(chalk));
    expect(out.size).toBe(shipped.length);
  });

  it('is case-insensitive, because stored casing is not guaranteed', () => {
    expect(chalk('#EC4899')).toBe(chalk('#ec4899'));
  });

  it('leaves the offered palette exactly as picked', () => {
    // Without identity entries these drift a shade on every render pass.
    for (const hex of PALETTE) expect(chalk(hex)).toBe(hex);
  });

  it('desaturates an unrecognised colour rather than passing it through', () => {
    const out = chalk('#FF0000');
    expect(out).not.toBe('#FF0000');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!);
    // Saturation is pinned low and lightness high, matching the palette.
    expect((max - min) / 255).toBeLessThan(0.35);
    expect(max).toBeGreaterThan(170);
  });

  it('keeps a grey grey instead of inventing a hue for it', () => {
    const out = chalk('#808080');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('passes theme tokens straight through', () => {
    // Icon() is called with var(--…) in several places; restyling one would
    // emit a broken colour string and paint nothing.
    expect(chalk('var(--surface-3)')).toBe('var(--surface-3)');
    expect(chalk('var(--positive)')).toBe('var(--positive)');
  });

  it('falls back to a surface when a row has no colour', () => {
    expect(chalk(null)).toBe('var(--surface-2)');
    expect(chalk(undefined)).toBe('var(--surface-2)');
    expect(chalk('')).toBe('var(--surface-2)');
  });

  it('returns malformed input unchanged rather than throwing', () => {
    // A bad value should show as itself, not crash the render.
    expect(chalk('#12')).toBe('#12');
    expect(chalk('#zzzzzz')).toBe('#zzzzzz');
  });

  it('expands three-digit hex', () => {
    expect(chalk('#f00')).toBe(chalk('#ff0000'));
  });
});
