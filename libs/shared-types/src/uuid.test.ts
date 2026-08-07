import { describe, it, expect, beforeEach } from 'vitest';
import { uuidv7, uuidv7Time, isUuidv7, __resetUuidClock } from './uuid.js';

beforeEach(() => __resetUuidClock());

describe('uuidv7', () => {
  it('produces well-formed v7 UUIDs', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidv7();
      expect(isUuidv7(id)).toBe(true);
      expect(id).toHaveLength(36);
      expect(id[14]).toBe('7'); // version nibble
      expect('89ab').toContain(id[19]!.toLowerCase()); // variant
    }
  });

  it('embeds the timestamp', () => {
    const t = 1_754_000_000_000;
    expect(uuidv7Time(uuidv7(t))).toBe(t);
  });

  it('sorts lexicographically in time order — the whole point', () => {
    const ids = [
      uuidv7(1_754_000_000_000),
      uuidv7(1_754_000_001_000),
      uuidv7(1_754_000_002_000),
      uuidv7(1_754_000_003_000),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays monotonic within a single millisecond', () => {
    // Without the counter these would sort randomly inside the ms, and the
    // time-ordering guarantee would silently fail exactly during bulk inserts.
    const t = 1_754_000_000_000;
    const ids = Array.from({ length: 500 }, () => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(500);
  });

  it('does not go backwards when the clock does', () => {
    const ids = [
      uuidv7(1_754_000_005_000),
      uuidv7(1_754_000_004_000), // NTP correction / user changed the date
      uuidv7(1_754_000_003_000),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it('is collision-free across a large batch', () => {
    const n = 20_000;
    const set = new Set(Array.from({ length: n }, () => uuidv7()));
    expect(set.size).toBe(n);
  });
});

describe('isUuidv7', () => {
  it('rejects v4 and junk', () => {
    expect(isUuidv7('9f8b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d')).toBe(false); // v4
    expect(isUuidv7('not-a-uuid')).toBe(false);
    expect(isUuidv7('')).toBe(false);
  });
});
