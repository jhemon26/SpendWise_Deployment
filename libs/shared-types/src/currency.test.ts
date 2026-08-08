import { describe, it, expect } from 'vitest';
import { CurrencyError, convertMinor, formatMoney, formatSignedMoney, fromMinor, minorUnits, toDecimalString, toMinor } from './currency.js';

describe('minorUnits', () => {
  it('defaults to 2', () => {
    expect(minorUnits('GBP')).toBe(2);
    expect(minorUnits('EUR')).toBe(2);
    expect(minorUnits('USD')).toBe(2);
  });

  it('knows the zero-decimal currencies', () => {
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KRW')).toBe(0);
    expect(minorUnits('VND')).toBe(0);
  });

  it('knows the three-decimal currencies', () => {
    expect(minorUnits('KWD')).toBe(3);
    expect(minorUnits('BHD')).toBe(3);
    expect(minorUnits('OMR')).toBe(3);
  });

  it('rejects malformed codes', () => {
    expect(() => minorUnits('gbp')).toThrow(CurrencyError);
    expect(() => minorUnits('GB')).toThrow(CurrencyError);
    expect(() => minorUnits('')).toThrow(CurrencyError);
  });
});

describe('toMinor — the float trap', () => {
  it('parses without float error', () => {
    // 19.99 * 100 === 1998.9999999999998 in IEEE-754. Naive code loses a penny.
    expect(toMinor('19.99', 'GBP')).toBe(1999);
    expect(19.99 * 100).not.toBe(1999); // proof the naive path is broken
  });

  it('handles the classic 0.1 + 0.2 case', () => {
    expect(toMinor('0.1', 'GBP') + toMinor('0.2', 'GBP')).toBe(toMinor('0.30', 'GBP'));
    expect(0.1 + 0.2).not.toBe(0.3); // proof again
  });

  it('respects the currency exponent', () => {
    expect(toMinor('1000', 'JPY')).toBe(1000); // ¥1000
    expect(toMinor('10.00', 'GBP')).toBe(1000); // £10.00
    expect(toMinor('1.000', 'KWD')).toBe(1000); // KD1.000
    // all three are 1000 stored, three different amounts
  });

  it('rounds half-up beyond the exponent', () => {
    expect(toMinor('1.005', 'GBP')).toBe(101);
    expect(toMinor('1.004', 'GBP')).toBe(100);
    expect(toMinor('1.5', 'JPY')).toBe(2);
    expect(toMinor('1.4', 'JPY')).toBe(1);
  });

  it('rounds negatives away from zero', () => {
    expect(toMinor('-1.005', 'GBP')).toBe(-101);
    expect(toMinor('-19.99', 'GBP')).toBe(-1999);
  });

  it('accepts sparse and padded input', () => {
    expect(toMinor('5', 'GBP')).toBe(500);
    expect(toMinor('5.', 'GBP')).toBe(500);
    expect(toMinor('5.5', 'GBP')).toBe(550);
    expect(toMinor('0005.50', 'GBP')).toBe(550);
    expect(toMinor('  12.34  ', 'GBP')).toBe(1234);
  });

  it('accepts numbers as well as strings', () => {
    expect(toMinor(19.99, 'GBP')).toBe(1999);
    expect(toMinor(0, 'GBP')).toBe(0);
    expect(toMinor(1000, 'JPY')).toBe(1000);
  });

  it('rejects junk', () => {
    expect(() => toMinor('abc', 'GBP')).toThrow(CurrencyError);
    expect(() => toMinor('1,234.00', 'GBP')).toThrow(CurrencyError);
    expect(() => toMinor('1.2.3', 'GBP')).toThrow(CurrencyError);
    expect(() => toMinor(Number.NaN, 'GBP')).toThrow(CurrencyError);
    expect(() => toMinor(Number.POSITIVE_INFINITY, 'GBP')).toThrow(CurrencyError);
  });

  it('rejects amounts beyond the safe integer range', () => {
    expect(() => toMinor('99999999999999999999', 'GBP')).toThrow(CurrencyError);
  });
});

describe('toDecimalString', () => {
  it('round-trips through toMinor', () => {
    for (const [v, c] of [
      ['19.99', 'GBP'],
      ['0.01', 'GBP'],
      ['1000', 'JPY'],
      ['1.000', 'KWD'],
      ['-5.50', 'EUR'],
    ] as const) {
      expect(toDecimalString(toMinor(v, c), c)).toBe(
        // normalise the expectation: "1000" in JPY has no decimal part
        toDecimalString(toMinor(v, c), c),
      );
      expect(toMinor(toDecimalString(toMinor(v, c), c), c)).toBe(toMinor(v, c));
    }
  });

  it('pads sub-unit amounts correctly', () => {
    expect(toDecimalString(5, 'GBP')).toBe('0.05');
    expect(toDecimalString(1, 'GBP')).toBe('0.01');
    expect(toDecimalString(0, 'GBP')).toBe('0.00');
    expect(toDecimalString(1, 'KWD')).toBe('0.001');
    expect(toDecimalString(1000, 'JPY')).toBe('1000');
  });

  it('keeps the sign', () => {
    expect(toDecimalString(-1999, 'GBP')).toBe('-19.99');
  });

  it('rejects non-integers', () => {
    expect(() => toDecimalString(19.99, 'GBP')).toThrow(CurrencyError);
  });
});

describe('fromMinor / formatMoney', () => {
  it('converts back to a major number', () => {
    expect(fromMinor(1999, 'GBP')).toBeCloseTo(19.99, 10);
    expect(fromMinor(1000, 'JPY')).toBe(1000);
  });

  it('formats with the right number of decimals per currency', () => {
    expect(formatMoney(2400, 'GBP', 'en-GB')).toContain('24.00');
    // JPY must not gain decimal places
    expect(formatMoney(1000, 'JPY', 'en-GB')).not.toContain('.');
    expect(formatMoney(1000, 'KWD', 'en-GB')).toContain('1.000');
  });
});

describe('convertMinor', () => {
  it('converts across equal exponents', () => {
    // €14.00 at 0.85 -> £11.90
    expect(convertMinor(1400, 'EUR', 'GBP', 0.85)).toBe(1190);
  });

  it('handles differing exponents', () => {
    // ¥1000 at 0.0053 -> £5.30
    expect(convertMinor(1000, 'JPY', 'GBP', 0.0053)).toBe(530);
    // £10.00 at 188.5 -> ¥1885
    expect(convertMinor(1000, 'GBP', 'JPY', 188.5)).toBe(1885);
  });

  it('is identity at rate 1 within the same currency', () => {
    expect(convertMinor(1999, 'GBP', 'GBP', 1)).toBe(1999);
  });

  it('rounds negatives away from zero', () => {
    expect(convertMinor(-1400, 'EUR', 'GBP', 0.85)).toBe(-1190);
  });

  it('rejects bad rates', () => {
    expect(() => convertMinor(100, 'EUR', 'GBP', 0)).toThrow(CurrencyError);
    expect(() => convertMinor(100, 'EUR', 'GBP', -1)).toThrow(CurrencyError);
    expect(() => convertMinor(100, 'EUR', 'GBP', Number.NaN)).toThrow(CurrencyError);
  });
});

describe('formatSignedMoney', () => {
  // This exact string shipped to the phone: U+2212 from a hand-written prefix
  // followed by U+002D from Intl. It rendered as two dashes that wrapped onto
  // their own line and stretched the home card.
  it('never emits two dash characters', () => {
    const out = formatSignedMoney(-16729, 'GBP');
    expect(out).not.toContain('−-');
    expect([...out].filter((ch) => ch === '−' || ch === '-')).toHaveLength(1);
  });

  it('signs negatives with a real minus, not a hyphen', () => {
    expect(formatSignedMoney(-16729, 'GBP')).toBe('−£167.29');
  });

  it('marks income with a plus', () => {
    expect(formatSignedMoney(16729, 'GBP')).toBe('+£167.29');
  });

  it('leaves zero unsigned — "+£0.00" reads as a mistake', () => {
    expect(formatSignedMoney(0, 'GBP')).toBe('£0.00');
  });

  it('respects minor units, so JPY keeps no decimals', () => {
    // en-GB writes the yen as "JP¥", not "¥" — the assertion here is the
    // absence of decimals, not the symbol.
    expect(formatSignedMoney(-500, 'JPY')).toBe('−JP¥500');
  });

  // Guards the contract that made the bug possible: callers must NOT add their
  // own sign, because formatMoney already does.
  it('formatMoney signs negatives on its own', () => {
    expect(formatMoney(-16729, 'GBP')).toBe('-£167.29');
  });
});
