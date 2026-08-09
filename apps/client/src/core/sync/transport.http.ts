import {
  syncPushResponseSchema,
  syncPullResponseSchema,
  type SyncPushResponse,
} from '@spendwise/shared-types';
import type { SyncTransport } from './engine.js';

/**
 * HTTP transport for the sync engine.
 *
 * Responsible for exactly three things the engine should not know about:
 * attaching credentials, refreshing them once when they expire, and deciding
 * whether the server is reachable at all.
 */

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  set(access: string, refresh: string): void;
  clear(): void;
}

/**
 * In-memory tokens.
 *
 * The ACCESS token deliberately never touches localStorage — anything readable
 * by injected script is exfiltratable by it (ARCHITECTURE §9.1). The refresh
 * token belongs in an HttpOnly cookie on web and Keychain/Keystore on native;
 * this class is the seam those slot into.
 */
export class MemoryTokenStore implements TokenStore {
  private access: string | null = null;
  private refresh: string | null = null;

  getAccessToken(): string | null { return this.access; }
  getRefreshToken(): string | null { return this.refresh; }
  set(access: string, refresh: string): void { this.access = access; this.refresh = refresh; }
  clear(): void { this.access = null; this.refresh = null; }
}

export interface HttpTransportOptions {
  baseUrl: string;
  deviceId: string;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  /** Called when refresh fails and the user must sign in again. */
  onAuthLost?: () => void;
  timeoutMs?: number;
}

export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly deviceId: string;
  private readonly tokens: TokenStore;
  private readonly doFetch: typeof fetch;
  private readonly onAuthLost: (() => void) | undefined;
  private readonly timeoutMs: number;

  /** Collapses concurrent 401s onto one refresh instead of a stampede. */
  private refreshing: Promise<boolean> | null = null;

  constructor(opts: HttpTransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.deviceId = opts.deviceId;
    this.tokens = opts.tokens;
    this.doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onAuthLost = opts.onAuthLost;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request(path: string, init: RequestInit, retryOn401 = true): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const access = this.tokens.getAccessToken();
      const res = await this.doFetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
          ...(init.headers ?? {}),
        },
      });

      // Access tokens are 15 minutes; a long sync will cross that boundary.
      // Refresh once and replay, rather than surfacing an error the user did
      // nothing to cause.
      if (res.status === 401 && retryOn401) {
        const ok = await this.refreshOnce();
        if (ok) return this.request(path, init, false);
        this.onAuthLost?.();
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private async refreshOnce(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      const refresh = this.tokens.getRefreshToken();
      if (!refresh) return false;
      try {
        const res = await this.doFetch(`${this.baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) {
          // Refresh-token reuse detection may have revoked the whole family
          // (§9.1). There is no recovering here — the user must sign in again.
          this.tokens.clear();
          return false;
        }
        const body = (await res.json()) as { access_token: string; refresh_token: string };
        this.tokens.set(body.access_token, body.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /**
   * Cheap liveness probe. `navigator.onLine` alone is famously unreliable — it
   * reports true on captive-portal WiFi, where every request then hangs.
   */
  async reachable(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await this.doFetch(`${this.baseUrl}/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async push(body: unknown): Promise<SyncPushResponse> {
    const res = await this.request('/v1/sync/push', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.toError(res);
    // Validate with the SAME schema the server validated against. A silently
    // changed wire format is exactly what shared-types exists to prevent.
    return syncPushResponseSchema.parse(await res.json());
  }

  async pull(
    since: string | null,
    cursor: string | null,
  ): Promise<{
    transactions: unknown[];
    categories: unknown[];
    banks: unknown[];
    next_cursor: string | null;
    has_more: boolean;
    server_time: string;
  }> {
    const q = new URLSearchParams({ device_id: this.deviceId });
    if (since) q.set('since', since);
    if (cursor) q.set('cursor', cursor);

    const res = await this.request(`/v1/sync/pull?${q.toString()}`, { method: 'GET' });
    if (!res.ok) throw await this.toError(res);
    const parsed = syncPullResponseSchema.parse(await res.json());
    return {
      transactions: parsed.transactions,
      // Dropped here previously, so the server could return every category and
      // the device would still show none.
      categories: parsed.categories,
      banks: parsed.banks,
      next_cursor: parsed.next_cursor,
      has_more: parsed.has_more,
      server_time: parsed.server_time,
    };
  }

  private async toError(res: Response): Promise<TransportError> {
    let code: string | undefined;
    try {
      const body = (await res.json()) as { code?: string; message?: { code?: string } };
      code = body.code ?? body.message?.code;
    } catch {
      /* a non-JSON error body is still an error */
    }
    return new TransportError(`${res.status} on ${res.url}`, res.status, code);
  }
}
