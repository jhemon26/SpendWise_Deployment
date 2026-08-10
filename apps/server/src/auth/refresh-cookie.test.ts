import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken, REFRESH_COOKIE } from './refresh-cookie.js';

function res(): Response & { cookies: Array<[string, string, Record<string, unknown>]>; cleared: string[] } {
  const cookies: Array<[string, string, Record<string, unknown>]> = [];
  const cleared: string[] = [];
  return {
    cookie: vi.fn((n: string, v: string, o: Record<string, unknown>) => { cookies.push([n, v, o]); }),
    clearCookie: vi.fn((n: string) => { cleared.push(n); }),
    cookies,
    cleared,
  } as unknown as Response & { cookies: typeof cookies; cleared: string[] };
}

const req = (cookies?: Record<string, string>): Request =>
  ({ cookies } as unknown as Request);

describe('setRefreshCookie', () => {
  it('is HttpOnly, SameSite=Lax and scoped to the auth path', () => {
    const r = res();
    setRefreshCookie(r, 'tok', { secure: true, maxAgeDays: 30 });
    const [name, value, opts] = r.cookies[0]!;

    expect(name).toBe(REFRESH_COOKIE);
    expect(value).toBe('tok');
    // HttpOnly is what puts the long-lived credential out of reach of XSS.
    expect(opts['httpOnly']).toBe(true);
    /*
     * Lax, not Strict. Strict withholds the cookie on every cross-site
     * NAVIGATION, which includes launching an installed PWA from the home
     * screen — the session then looks expired on open. Lax still withholds it
     * on cross-site POST, which is the CSRF vector that matters here, and the
     * refresh call is a same-origin POST.
     */
    expect(opts['sameSite']).toBe('lax');
    // No route outside /v1/auth needs it, so no route outside can leak it.
    expect(opts['path']).toBe('/v1/auth');
    expect(opts['secure']).toBe(true);
    expect(opts['maxAge']).toBe(30 * 86_400_000);
  });

  it('drops Secure only when explicitly told to — local development', () => {
    const r = res();
    setRefreshCookie(r, 'tok', { secure: false, maxAgeDays: 1 });
    expect(r.cookies[0]![2]['secure']).toBe(false);
    // …but every other protection stays on.
    expect(r.cookies[0]![2]['httpOnly']).toBe(true);
    expect(r.cookies[0]![2]['sameSite']).toBe('lax');
  });
});

describe('clearRefreshCookie', () => {
  it('clears the cookie by name', () => {
    const r = res();
    clearRefreshCookie(r, { secure: true });
    expect(r.cleared).toEqual([REFRESH_COOKIE]);
  });
});

describe('readRefreshToken', () => {
  it('prefers the cookie over the body', () => {
    // A browser holding the cookie should never need the body route. Preferring
    // the cookie stops a compromised page downgrading to the weaker path by
    // simply omitting it.
    expect(readRefreshToken(req({ [REFRESH_COOKIE]: 'from-cookie' }), 'from-body')).toBe('from-cookie');
  });

  it('falls back to the body for native clients', () => {
    expect(readRefreshToken(req(), 'from-body')).toBe('from-body');
  });

  it('returns null when neither is present', () => {
    expect(readRefreshToken(req(), undefined)).toBeNull();
    expect(readRefreshToken(req({}), '')).toBeNull();
  });

  it('survives a request with no cookie parser attached', () => {
    expect(readRefreshToken({} as Request, 'from-body')).toBe('from-body');
  });
});
