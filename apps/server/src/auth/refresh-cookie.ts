import type { Request, Response } from 'express';

/**
 * Refresh-token cookie for browser clients (ARCHITECTURE §9.1).
 *
 * The refresh token is the long-lived credential, so on web it must be
 * unreadable by JavaScript: anything script can read, injected script can
 * exfiltrate. HttpOnly puts it out of reach of XSS entirely, at the cost of
 * needing CSRF defence — which SameSite=Strict provides, since a cross-site
 * request then simply does not carry the cookie.
 *
 * Native clients do not use this path. They hold the token in Keychain or
 * Keystore and send it in the request body, which is why both routes are
 * supported.
 */

export const REFRESH_COOKIE = 'sw_rt';

export interface CookieOptions {
  secure: boolean;
  maxAgeDays: number;
}

export function setRefreshCookie(res: Response, token: string, opts: CookieOptions): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Only omitted in local development, where there is no TLS to attach to.
    secure: opts.secure,
    sameSite: 'strict',
    // Scoped to the refresh endpoint: no other route needs it, so no other
    // route should be able to leak it in a log or an error.
    path: '/v1/auth',
    maxAge: opts.maxAgeDays * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response, opts: Pick<CookieOptions, 'secure'>): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'strict',
    path: '/v1/auth',
  });
}

/**
 * Cookie first, body second.
 *
 * A browser that has the cookie should never need to send the token in a body
 * it can read; the body path exists for native clients. Preferring the cookie
 * means a compromised page cannot downgrade to the weaker route by simply
 * omitting it.
 */
export function readRefreshToken(req: Request, bodyToken?: string | undefined): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;
  return bodyToken && bodyToken.length > 0 ? bodyToken : null;
}
