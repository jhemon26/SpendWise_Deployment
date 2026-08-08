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
describe('trunk prefix', () => {
  // The phone number IS the account key. "+44 07424 976510" and
  // "+44 7424 976510" are one phone; if both forms survive, one person ends up
  // with two accounts holding half their data each. This actually happened.
  it('drops the national 0 after the country code', () => {
    expect(normalizePhoneE164('+4407424976510')).toBe('+447424976510');
  });

  it('collapses the two forms to the same string', () => {
    expect(normalizePhoneE164('+44 07424 976510')).toBe(normalizePhoneE164('+44 7424 976510'));
  });

  it('keeps Italian leading zeros, which are part of the number', () => {
    // Rome landlines really are +39 06…; stripping it breaks the number.
    expect(normalizePhoneE164('+39 06 6982')).toBe('+3906 6982'.replace(/\s/g, ''));
  });

  it('leaves a number that has no trunk prefix alone', () => {
    expect(normalizePhoneE164('+447424976510')).toBe('+447424976510');
  });

  it('does not eat a zero that is part of the subscriber number', () => {
    // A regex guessing the code length read this as "+447" + "024976510" and
    // deleted a digit the subscriber actually has.
    expect(normalizePhoneE164('+447024976510')).toBe('+447024976510');
  });

  it('prefers the longest matching calling code', () => {
    // +353 must not be parsed as +35 or +3.
    expect(normalizePhoneE164('+353 087 1234567')).toBe('+353871234567');
  });

  it('leaves an unrecognised calling code untouched', () => {
    expect(normalizePhoneE164('+9990123456')).toBe('+9990123456');
  });

  it('handles more than one stray leading zero', () => {
    expect(normalizePhoneE164('+44007424976510')).toBe('+447424976510');
  });

  it('strips en and em dashes as well as hyphens', () => {
    expect(normalizePhoneE164('+44 7424–976—510')).toBe('+447424976510');
  });

  it('still rejects nonsense', () => {
    expect(isValidPhoneE164('+440')).toBe(false);
    expect(isValidPhoneE164('07424976510')).toBe(false);
  });
});
