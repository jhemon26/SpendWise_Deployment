import { describe, it, expect, beforeEach } from 'vitest';
import { AuthClient, AuthError } from './client.js';
import { MemoryTokenStore } from '../sync/transport.http.js';

const BASE = 'https://api.spendwise.test';

interface Call { url: string; init: RequestInit }
let calls: Call[];
let tokens: MemoryTokenStore;

function client(
  handler: (url: string, init: RequestInit) => Response,
  platform: 'web' | 'native' = 'web',
): AuthClient {
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return new AuthClient({ baseUrl: BASE, tokens, deviceId: 'd1', fetchImpl, platform });
}

const json = (b: unknown, status = 200): Response =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls = [];
  tokens = new MemoryTokenStore();
});

describe('cookie handling', () => {
  it('sends credentials so the HttpOnly cookie travels', async () => {
    // Without credentials:'include' the browser neither sends nor stores the
    // refresh cookie, and every reload silently signs the user out.
    const c = client(() => json({ challenge_id: 'ch1', expires_in: 300 }));
    await c.sendOtp('+447700900000');
    expect(calls[0]!.init.credentials).toBe('include');
  });

  it('does NOT claim to be native on web', async () => {
    // That header is what makes the server return the refresh token in the
    // body. A browser asking for it would undo HttpOnly.
    const c = client(() => json({ access_token: 'a1' }));
    await c.verifyOtp('ch1', '123456');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Client-Platform']).toBeUndefined();
  });

  it('declares itself on native', async () => {
    const c = client(() => json({ access_token: 'a1', refresh_token: 'r1' }), 'native');
    await c.verifyOtp('ch1', '123456');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Client-Platform']).toBe('native');
    expect(tokens.getRefreshToken()).toBe('r1');
  });

  it('web stores no refresh token because the body carries none', async () => {
    const c = client(() => json({ access_token: 'a1' }));
    await c.verifyOtp('ch1', '123456');
    expect(tokens.getAccessToken()).toBe('a1');
    expect(tokens.getRefreshToken()).toBe('');
  });
});

describe('phone sign-in', () => {
  it('sends a code and returns the challenge', async () => {
    const c = client(() => json({ challenge_id: 'ch-7', expires_in: 300 }));
    expect(await c.sendOtp('+447700900000')).toEqual({ challengeId: 'ch-7', expiresIn: 300 });
  });

  it('surfaces the server code on a rejected send', async () => {
    const c = client(() => json({ code: 'rate_limited_target' }, 400));
    await expect(c.sendOtp('+447700900000')).rejects.toMatchObject({ code: 'rate_limited_target' });
  });

  it('surfaces a nested Nest error code', async () => {
    const c = client(() => json({ message: { code: 'blocked_prefix' } }, 400));
    await expect(c.sendOtp('+8811999999')).rejects.toMatchObject({ code: 'blocked_prefix' });
  });

  it('reports a wrong code without leaking why', async () => {
    const c = client(() => json({ message: { code: 'bad_code' } }, 401));
    await expect(c.verifyOtp('ch1', '000000')).rejects.toBeInstanceOf(AuthError);
  });

  it('flags a brand-new account so onboarding can run', async () => {
    const c = client(() => json({ access_token: 'a1', new_account: true }));
    expect((await c.verifyOtp('ch1', '123456')).isNewAccount).toBe(true);
  });
});

describe('restore — what makes HttpOnly usable', () => {
  it('trades the cookie for a fresh access token on load', async () => {
    // The access token is memory-only, so it is gone after a reload. This is
    // the whole mechanism behind "still signed in".
    const c = client((url) =>
      url.endsWith('/v1/auth/refresh') ? json({ access_token: 'fresh' }) : json({}, 404),
    );
    const user = await c.restore();
    expect(user?.accessToken).toBe('fresh');
    expect(tokens.getAccessToken()).toBe('fresh');
  });

  it('returns null when there is no valid cookie — not an error', async () => {
    const c = client(() => json({ code: 'invalid_refresh' }, 401));
    expect(await c.restore()).toBeNull();
    expect(tokens.getAccessToken()).toBeNull();
  });

  it('returns null when offline rather than throwing', async () => {
    // Launching offline is normal for this app: fall through to the local
    // database and retry when the network returns.
    const c = client(() => { throw new Error('ECONNREFUSED'); });
    expect(await c.restore()).toBeNull();
  });

  it('sends an empty body — the browser cannot read the cookie to echo it', async () => {
    const c = client(() => json({ access_token: 'fresh' }));
    await c.restore();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({});
  });
});

describe('logout', () => {
  it('clears local tokens', async () => {
    tokens.set('a1', 'r1');
    const c = client(() => json({ ok: true }));
    await c.logout();
    expect(tokens.getAccessToken()).toBeNull();
  });

  it('clears them even when the server call fails', async () => {
    // The user asked to be signed out. A network error must not leave them
    // looking signed in.
    tokens.set('a1', 'r1');
    const c = client(() => { throw new Error('offline'); });
    await expect(c.logout()).rejects.toThrow();
    expect(tokens.getAccessToken()).toBeNull();
  });

  it('authenticates the logout call so the server can revoke the family', async () => {
    tokens.set('a1', 'r1');
    const c = client(() => json({ ok: true }));
    await c.logout();
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer a1');
  });
});
