import { describe, it, expect } from 'vitest';
import { isValidPhoneE164, normalizePhoneE164 } from './phone.js';

describe('phone input normalization', () => {
  it('accepts pasted formatting and strips separators', () => {
    expect(normalizePhoneE164('+44 7700-900000')).toBe('+447700900000');
    expect(isValidPhoneE164('+44 7700-900000')).toBe(true);
  });

  it('rejects numbers without a leading plus or too few digits', () => {
    expect(isValidPhoneE164('447700900000')).toBe(false);
    expect(isValidPhoneE164('+44 77')).toBe(false);
  });
});