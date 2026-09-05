import { describe, expect, it } from 'vitest';
import { TAB_COLUMN } from './App.js';

/**
 * Where the sliding indicator parks.
 *
 * The bar is a five-column grid — Home, Activity, the add button, Budgets,
 * Analytics — so the two tabs after the button are offset by one. Indexing by
 * tab order instead of column would leave the oval sitting under the add
 * button when Budgets is selected.
 */
describe('tab columns', () => {
  it('puts the first two tabs in the first two columns', () => {
    expect(TAB_COLUMN.home).toBe(0);
    expect(TAB_COLUMN.activity).toBe(1);
  });

  it('skips the column the add button occupies', () => {
    expect(TAB_COLUMN.budgets).toBe(3);
    expect(TAB_COLUMN.insights).toBe(4);
    expect(Object.values(TAB_COLUMN)).not.toContain(2);
  });

  it('gives Profile no column, since it has no tab', () => {
    expect(TAB_COLUMN.profile).toBeUndefined();
  });

  it('never lands two tabs on the same column', () => {
    const cols = Object.values(TAB_COLUMN);
    expect(new Set(cols).size).toBe(cols.length);
  });
});
