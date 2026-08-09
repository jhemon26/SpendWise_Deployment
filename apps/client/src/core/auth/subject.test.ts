import { describe, it, expect } from 'vitest';
import { subjectOf } from './subject.js';

/** Encodes the way a real issuer does: UTF-8 bytes, then base64url. */
const token = (payload: Record<string, unknown>): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const bin = String.fromCharCode(...bytes);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${b64}.signature`;
};

describe('subjectOf', () => {
  it('reads the subject claim', () => {
    expect(subjectOf(token({ sub: 'user-123' }))).toBe('user-123');
  });

  it('handles a base64url payload with - and _', () => {
    // The url-safe alphabet is what a real JWT uses; atob rejects it untouched.
    const sub = 'a>>b??c~~d';
    expect(subjectOf(token({ sub }))).toBe(sub);
  });

  it('handles non-ASCII in the payload', () => {
    expect(subjectOf(token({ sub: 'ünïcodé-🎉' }))).toBe('ünïcodé-🎉');
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(subjectOf('')).toBeNull();
    expect(subjectOf('not-a-jwt')).toBeNull();
    expect(subjectOf('a.b.c')).toBeNull();
    expect(subjectOf(token({}))).toBeNull();
    expect(subjectOf(token({ sub: '' }))).toBeNull();
    expect(subjectOf(token({ sub: 42 }))).toBeNull();
  });
});
