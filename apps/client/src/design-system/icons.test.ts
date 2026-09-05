import { describe, expect, it } from 'vitest';
import { COLOUR_ICONS, ICON_KEYS } from './icons.colour.js';

/** Every icon name the app has ever written to a category record. */
const STORED = [
  'groceries', 'dining', 'coffee', 'shopping', 'clothes', 'transport', 'car', 'fuel',
  'travel', 'hotel', 'home', 'rent', 'bills', 'utilities', 'water', 'phone', 'wifi',
  'subscription', 'fun', 'movie', 'music', 'games', 'fitness', 'health', 'pharmacy',
  'education', 'kids', 'pets', 'gifts', 'savings', 'income', 'transfer', 'other',
] as const;

describe('coloured icons', () => {
  it('covers every name already stored against a category', () => {
    // Existing accounts hold these strings. A missing key silently falls back
    // to a grey tag, so the whole set has to be here before this ships.
    const missing = STORED.filter((k) => !(k in COLOUR_ICONS));
    expect(missing, `no glyph for: ${missing.join(', ')}`).toEqual([]);
  });

  it('has a fallback for a name it does not know', () => {
    expect(COLOUR_ICONS['other']).toBeDefined();
  });

  it('offers every glyph in the picker', () => {
    expect([...ICON_KEYS].sort()).toEqual(Object.keys(COLOUR_ICONS).sort());
  });

  it('gives every path an explicit fill, so none inherit currentColor', () => {
    // These render with no stroke and no colour context. A path without a fill
    // would come out black on a dark ground: invisible.
    for (const [name, glyph] of Object.entries(COLOUR_ICONS)) {
      expect(glyph.length, `${name} has no paths`).toBeGreaterThan(0);
      for (const [fill, d] of glyph) {
        expect(fill, `${name} fill`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(d.length, `${name} path data`).toBeGreaterThan(10);
      }
    }
  });

  it('draws inside the 24×24 box', () => {
    // A coordinate far outside the viewBox means a glyph clipped at the edge.
    for (const [name, glyph] of Object.entries(COLOUR_ICONS)) {
      for (const [, d] of glyph) {
        for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
          expect(Math.abs(Number(n)), `${name} coordinate ${n}`).toBeLessThanOrEqual(30);
        }
      }
    }
  });
});
