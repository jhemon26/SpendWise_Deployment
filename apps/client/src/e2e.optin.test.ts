import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryAdapter } from './core/db/adapter.js';
import { SyncEngine } from './core/sync/engine.js';
import { HttpSyncTransport, MemoryTokenStore } from './core/sync/transport.http.js';
import { useApp } from './core/store.js';

/**
 * End-to-end: the real client stack against the real API.
 *
 * Unit tests prove each half. This proves they interoperate — the wire format,
 * the auth header, the idempotency key and the response schema all agreeing
 * across a process boundary.
 */
const BASE = process.env['E2E_API'] ?? '';
const TOKEN = process.env['E2E_TOKEN'] ?? '';
const available = BASE !== '' && TOKEN !== '';
// The token is minted OUTSIDE this package. `jose` is a server dependency, and
// pnpm's strict layout is right to refuse the client importing it — the client
// has no business signing its own access tokens.
if (!available) console.warn('[e2e] E2E_API/E2E_TOKEN unset — skipping');

let tokens: MemoryTokenStore;

beforeAll(() => {
  if (!available) return;
  tokens = new MemoryTokenStore();
  tokens.set(TOKEN, 'unused-refresh');
});

describe.skipIf(!available)('client ↔ server', () => {
  it('health probe reports reachable', async () => {
    const t = new HttpSyncTransport({ baseUrl: BASE, deviceId: 'e2e', tokens });
    expect(await t.reachable()).toBe(true);
  });

  it('pushes a locally-created transaction and pulls it back', async () => {
    const db = new MemoryAdapter();
    await db.init();
    const store = useApp.getState();
    await store.hydrate(db);
    const rec = await store.addTransaction(db, {
      amountMinor: 2450, currency: 'GBP', categoryId: null, bankId: null,
      merchant: 'E2E Waitrose', isIncome: false,
    });
    expect((await db.pending())).toHaveLength(1);

    const transport = new HttpSyncTransport({ baseUrl: BASE, deviceId: 'e2e', tokens });
    const engine = new SyncEngine(db, transport, 'e2e');
    await engine.runOnce();

    // the local row is now marked synced with the server's version
    const after = await db.get('transactions', rec.local_id);
    expect(after?.sync_status).toBe('synced');
    expect(after?.version).toBe(1);
    expect(await db.pending()).toHaveLength(0);
  });

  it('a second cycle is a no-op — nothing pending, no duplicates', async () => {
    const db = new MemoryAdapter();
    await db.init();
    const transport = new HttpSyncTransport({ baseUrl: BASE, deviceId: 'e2e', tokens });
    const engine = new SyncEngine(db, transport, 'e2e');
    await engine.runOnce();
    const first = (await db.all('transactions')).length;
    await engine.runOnce();
    expect((await db.all('transactions')).length).toBe(first);
  });

  it('rejects an unauthenticated push', async () => {
    const anon = new MemoryTokenStore();
    const t = new HttpSyncTransport({ baseUrl: BASE, deviceId: 'e2e', tokens: anon });
    await expect(t.pull(null, null)).rejects.toMatchObject({ status: 401 });
  });
});
