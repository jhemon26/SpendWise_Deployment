import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpSyncTransport, MemoryTokenStore, TransportError } from './transport.http.js';

const BASE = 'https://api.spendwise.test';

interface Call { url: string; init: RequestInit }

let calls: Call[];
let tokens: MemoryTokenStore;

function transport(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return new HttpSyncTransport({ baseUrl: BASE, deviceId: 'd1', tokens, fetchImpl });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pushBody = {
  accepted: [{ local_id: '0199aaaa-0000-7000-8000-000000000000', version: 1 }],
  conflicts: [],
  server_time: '2026-08-07T12:00:00.000Z',
  replayed: false,
};
const pullBody = {
  transactions: [], categories: [], banks: [],
  next_cursor: null, has_more: false, server_time: '2026-08-07T12:00:00.000Z',
};

beforeEach(() => {
  calls = [];
  tokens = new MemoryTokenStore();
  tokens.set('access-1', 'refresh-1');
});

describe('auth', () => {
  it('attaches the bearer token', async () => {
    const t = transport(() => json(pushBody));
    await t.push({});
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer access-1');
  });

  it('sends no Authorization header when signed out', async () => {
    tokens.clear();
    const t = transport(() => json(pullBody));
    await t.pull(null, null);
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('refreshes once on 401 and replays the request', async () => {
    // Access tokens last 15 minutes; a long sync crosses that boundary through
    // no fault of the user.
    let n = 0;
    const t = transport((url) => {
      if (url.includes('/auth/refresh')) return json({ access_token: 'access-2', refresh_token: 'refresh-2' });
      n++;
      return n === 1 ? json({ message: 'expired' }, 401) : json(pushBody);
    });

    const res = await t.push({});
    expect(res.accepted).toHaveLength(1);
    expect(tokens.getAccessToken()).toBe('access-2');
    const replay = calls[calls.length - 1]!;
    expect((replay.init.headers as Record<string, string>)['Authorization']).toBe('Bearer access-2');
  });

  it('does not retry a second time — no infinite loop', async () => {
    // A server that 401s even after a successful refresh must NOT drive endless
    // retries. The hard call cap makes that failure fast and legible: without
    // the retry guard this recurses until the stack blows, and a hang is a much
    // worse CI signal than an assertion.
    let n = 0;
    const t = transport((url) => {
      if (++n > 10) throw new Error('runaway retry: transport did not stop retrying');
      return url.includes('/auth/refresh')
        ? json({ access_token: 'a2', refresh_token: 'r2' })
        : json({ message: 'nope' }, 401);
    });
    await expect(t.push({})).rejects.toThrow();
    expect(n).toBeLessThanOrEqual(4); // push, refresh, replay, and no more
    expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('clears tokens and reports auth loss when refresh is rejected', async () => {
    // Refresh-token reuse detection may have revoked the whole family.
    const onAuthLost = vi.fn();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('/auth/refresh') ? json({}, 401) : json({}, 401);
    }) as unknown as typeof fetch;
    const t = new HttpSyncTransport({ baseUrl: BASE, deviceId: 'd1', tokens, fetchImpl, onAuthLost });

    await expect(t.push({})).rejects.toBeInstanceOf(TransportError);
    expect(tokens.getAccessToken()).toBeNull();
    expect(onAuthLost).toHaveBeenCalledOnce();
  });

  it('collapses concurrent 401s onto a single refresh', async () => {
    // Otherwise every in-flight request refreshes, and rotation means all but
    // one of those tokens is immediately invalid — which reuse detection reads
    // as an attack.
    let refreshes = 0;
    let failFirst = new Set<string>();
    const t = transport((url) => {
      if (url.includes('/auth/refresh')) {
        refreshes++;
        return json({ access_token: 'a2', refresh_token: 'r2' });
      }
      if (!failFirst.has(url)) { failFirst.add(url); return json({}, 401); }
      return json(pullBody);
    });
    await Promise.all([t.pull(null, null), t.pull('2026-08-01T00:00:00.000Z', null)]);
    expect(refreshes).toBe(1);
  });

  it('does not attempt a refresh with no refresh token', async () => {
    tokens.clear();
    const t = transport(() => json({}, 401));
    await expect(t.pull(null, null)).rejects.toBeInstanceOf(TransportError);
    expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(false);
  });
});

describe('reachable', () => {
  it('is true when health responds', async () => {
    const t = transport(() => new Response('{"status":"ok"}', { status: 200 }));
    expect(await t.reachable()).toBe(true);
  });

  it('is false when health errors', async () => {
    const t = transport(() => new Response('', { status: 503 }));
    expect(await t.reachable()).toBe(false);
  });

  it('is false when the network throws', async () => {
    const t = transport(() => { throw new Error('ECONNREFUSED'); });
    expect(await t.reachable()).toBe(false);
  });

  it('probes rather than trusting navigator.onLine', async () => {
    // navigator.onLine reports TRUE on captive-portal WiFi, where every
    // request then hangs. The probe is what catches that.
    const t = transport(() => new Response('', { status: 200 }));
    await t.reachable();
    expect(calls[0]!.url).toContain('/v1/health');
  });
});

describe('push / pull', () => {
  it('posts to the versioned sync endpoint', async () => {
    const t = transport(() => json(pushBody));
    await t.push({ device_id: 'd1' });
    expect(calls[0]!.url).toBe(`${BASE}/v1/sync/push`);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('carries device_id, since and cursor on pull', async () => {
    const t = transport(() => json(pullBody));
    await t.pull('2026-08-01T00:00:00.000Z', 'cur-1');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/sync/pull');
    expect(url.searchParams.get('device_id')).toBe('d1');
    expect(url.searchParams.get('since')).toBe('2026-08-01T00:00:00.000Z');
    expect(url.searchParams.get('cursor')).toBe('cur-1');
  });

  it('omits since and cursor on a first sync', async () => {
    const t = transport(() => json(pullBody));
    await t.pull(null, null);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has('since')).toBe(false);
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('validates the response against the shared schema', async () => {
    // A server that changes the wire format must fail loudly here, not write
    // malformed rows into the local database.
    const t = transport(() => json({ accepted: 'not-an-array', conflicts: [] }));
    await expect(t.push({})).rejects.toThrow();
  });

  it('surfaces the server error code', async () => {
    const t = transport(() => json({ code: 'rate_limited_user' }, 429));
    await expect(t.push({})).rejects.toMatchObject({ status: 429, code: 'rate_limited_user' });
  });

  it('tolerates a non-JSON error body', async () => {
    const t = transport(() => new Response('<html>502</html>', { status: 502 }));
    await expect(t.push({})).rejects.toMatchObject({ status: 502 });
  });
});
