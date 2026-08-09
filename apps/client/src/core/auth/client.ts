import type { TokenStore } from '../sync/transport.http.js';

/**
 * Auth API client.
 *
 * Owns the sign-in flows and, importantly, SESSION RESTORE. The access token
 * lives in memory only (§9.1), so it is gone on every page load — the HttpOnly
 * refresh cookie is the only thing that survives. `restore()` trades that
 * cookie for a fresh pair, which is what makes "still signed in after a
 * refresh" work without ever exposing the long-lived credential to script.
 */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthedUser {
  accessToken: string;
  isNewAccount: boolean;
}

export interface AuthClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  deviceId: string;
  fetchImpl?: typeof fetch;
  /** Native clients hold the refresh token themselves; browsers use the cookie. */
  platform?: 'web' | 'native';
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly tokens: TokenStore;
  private readonly deviceId: string;
  private readonly doFetch: typeof fetch;
  private readonly platform: 'web' | 'native';

  constructor(opts: AuthClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.tokens = opts.tokens;
    this.deviceId = opts.deviceId;
    this.doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.platform = opts.platform ?? 'web';
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return this.doFetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Only native asks for the token in the body. Omitting this on web is
        // what keeps the refresh token out of reach of injected script.
        ...(this.platform === 'native' ? { 'X-Client-Platform': 'native' } : {}),
      },
      // Required for the HttpOnly cookie to be sent and stored cross-origin.
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }

  /**
   * An authenticated request using the in-memory access token.
   *
   * For the small endpoints that sit outside the sync engine. On a 401 it tries
   * refresh ONCE and replays — the access token is short-lived, so an expired
   * one during normal use is routine, not an error worth surfacing.
   */
  async authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const send = (): Promise<Response> => this.doFetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(this.tokens.getAccessToken() ? { Authorization: `Bearer ${this.tokens.getAccessToken()}` } : {}),
      },
      credentials: 'include',
    });

    const first = await send();
    if (first.status !== 401) return first;

    const refreshed = await this.restore();
    if (!refreshed) return first;
    return send();
  }

  private async fail(res: Response, fallback: string): Promise<AuthError> {
    let code = fallback;
    try {
      const b = (await res.json()) as { code?: string; message?: { code?: string } | string };
      code = b.code ?? (typeof b.message === 'object' ? b.message?.code : undefined) ?? fallback;
    } catch {
      /* non-JSON error body */
    }
    return new AuthError(`auth failed (${res.status})`, code, res.status);
  }

  private offlineError(fallback: string, cause: unknown): AuthError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new AuthError(message || fallback, fallback, 0);
  }

  private adopt(body: { access_token: string; refresh_token?: string; new_account?: boolean }): AuthedUser {
    // On web there is no refresh token in the body by design — the cookie holds
    // it. Storing the empty string keeps the store's shape simple; the
    // transport only ever uses it on native.
    this.tokens.set(body.access_token, body.refresh_token ?? '');
    return { accessToken: body.access_token, isNewAccount: body.new_account === true };
  }

  /** Step one of phone sign-in. The code is never returned — it goes by SMS. */
  async sendOtp(phoneE164: string): Promise<{ challengeId: string; expiresIn: number }> {
    try {
      const res = await this.post('/v1/auth/otp/send', { phone_e164: phoneE164 });
      if (!res.ok) throw await this.fail(res, 'otp_send_failed');
      const b = (await res.json()) as { challenge_id: string; expires_in: number };
      return { challengeId: b.challenge_id, expiresIn: b.expires_in };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw this.offlineError('network_error', err);
    }
  }

  async verifyOtp(challengeId: string, code: string): Promise<AuthedUser> {
    try {
      const res = await this.post('/v1/auth/otp/verify', {
        challenge_id: challengeId,
        code,
        device_id: this.deviceId,
      });
      if (!res.ok) throw await this.fail(res, 'otp_verify_failed');
      return this.adopt(await res.json() as { access_token: string });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw this.offlineError('network_error', err);
    }
  }

  async oidcCallback(provider: 'google' | 'apple', idToken: string, nonce: string): Promise<AuthedUser> {
    const res = await this.post('/v1/auth/oidc/callback', {
      provider,
      id_token: idToken,
      nonce,
      device_id: this.deviceId,
    });
    if (!res.ok) throw await this.fail(res, 'oidc_failed');
    return this.adopt(await res.json() as { access_token: string });
  }

  /**
   * Resume a session on page load.
   *
   * Returns null rather than throwing when there is no valid cookie — that is
   * the ordinary "not signed in" case, not an error worth surfacing.
   */
  async restore(): Promise<AuthedUser | null> {
    try {
      const res = await this.post('/v1/auth/refresh', {});
      if (!res.ok) return null;
      return this.adopt(await res.json() as { access_token: string });
    } catch {
      // Offline at launch is normal for this app: fall through to the local
      // database and try again when the network returns.
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.doFetch(`${this.baseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.tokens.getAccessToken() ? { Authorization: `Bearer ${this.tokens.getAccessToken()}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });
    } finally {
      // Clear locally even if the server call failed — the user asked to be
      // signed out, and a network error must not leave them looking signed in.
      this.tokens.clear();
    }
  }
}
