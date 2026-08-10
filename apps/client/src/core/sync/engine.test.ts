import { describe, it, expect, beforeEach, vi } from 'vitest';
import { uuidv7, type SyncPushResponse } from '@spendwise/shared-types';
import { MemoryAdapter } from '../db/adapter.js';
import { SyncEngine, type SyncTransport } from './engine.js';

const NOW = new Date('2026-08-07T12:00:00Z');

let db: MemoryAdapter;
let calls: string[];
let transport: SyncTransport;
let pushBodies: Array<Record<string, unknown>>;
let engine: SyncEngine;

function tx(over: Record<string, unknown> = {}) {
  const t = NOW.toISOString();
  return {
    local_id: uuidv7(), server_id: null, created_at: t, updated_at: t, deleted_at: null,
    sync_status: 'pending', version: 0, device_id: 'd1',
    category_id: null, bank_id: null, amount_minor: -1000, currency: 'GBP',
    base_minor: -1000, base_currency: 'GBP', fx_rate: 1, fx_rate_date: '2026-08-07',
    fx_provisional: false, merchant: 'Shop', note: null, occurred_at: t,
    is_income: false, pending: false, ...over,
  } as never;
}

beforeEach(() => {
  db = new MemoryAdapter();
  calls = [];
  pushBodies = [];
  transport = {
    reachable: async () => {
      calls.push('reachable');
      return true;
    },
    push: async (body): Promise<SyncPushResponse> => {
      calls.push('push');
      pushBodies.push(body as Record<string, unknown>);
      const b = body as { transactions: Array<{ local_id: string }> };
      return {
        accepted: b.transactions.map((t) => ({ local_id: t.local_id, version: 1 })),
        conflicts: [],
        server_time: NOW.toISOString(),
        replayed: false,
      };
    },
    pull: async () => {
      calls.push('pull');
      return { transactions: [], categories: [], banks: [], next_cursor: null, has_more: false, server_time: NOW.toISOString() };
    },
  };
  engine = new SyncEngine(db, transport, 'd1', { now: () => NOW, random: () => 0.5 });
});

describe('cycle order', () => {
  it('pushes BEFORE pulling', async () => {
    // The other order lets a server record overwrite a local edit that has not
    // been transmitted yet — silent data loss.
    await db.put('transactions', tx());
    await engine.runOnce();
    expect(calls).toEqual(['reachable', 'push', 'pull']);
  });

  it('still pulls when there is nothing to push', async () => {
    await engine.runOnce();
    expect(calls).toEqual(['reachable', 'pull']);
  });

  it('does nothing but report offline when unreachable', async () => {
    transport.reachable = async () => false;
    await db.put('transactions', tx());
    await engine.runOnce();
    expect(engine.getState()).toBe('offline');
    expect(calls).not.toContain('push');
  });
});

describe('push', () => {
  it('marks accepted records synced with the server version', async () => {
    const t = tx();
    await db.put('transactions', t);
    await engine.runOnce();
    const stored = await db.get('transactions', (t as { local_id: string }).local_id);
    expect(stored?.sync_status).toBe('synced');
    expect(stored?.version).toBe(1);
  });

  it('marks conflicted records failed rather than silently dropping them', async () => {
    const t = tx();
    await db.put('transactions', t);
    transport.push = async (): Promise<SyncPushResponse> => ({
      accepted: [],
      conflicts: [{
        local_id: (t as { local_id: string }).local_id,
        entity: 'transaction', reason: 'amount_mismatch',
        server_version: 3, server_record: {},
      }],
      server_time: NOW.toISOString(),
      replayed: false,
    });
    await engine.runOnce();
    const stored = await db.get('transactions', (t as { local_id: string }).local_id);
    expect(stored?.sync_status).toBe('failed');
  });

  it('carries a fresh idempotency key per batch', async () => {
    await db.put('transactions', tx());
    await engine.runOnce();
    await db.put('transactions', tx());
    await engine.runOnce();
    expect(pushBodies).toHaveLength(2);
    expect(pushBodies[0]!['idempotency_key']).not.toBe(pushBodies[1]!['idempotency_key']);
  });

  it('splits more than 100 records into batches', async () => {
    for (let i = 0; i < 250; i++) await db.put('transactions', tx());
    await engine.runOnce();
    expect(pushBodies).toHaveLength(3); // 100 + 100 + 50
  });

  it('sends categories before transactions that may reference them', async () => {
    // A transaction pointing at a brand-new category must not arrive first.
    await db.put('transactions', tx());
    await db.put('categories', {
      local_id: uuidv7(), server_id: null,
      created_at: NOW.toISOString(), updated_at: NOW.toISOString(), deleted_at: null,
      sync_status: 'pending', version: 0, device_id: 'd1',
      name: 'Food', icon: 'dining', colour: '#FB923C', limit_minor: 1000, is_fixed: false,
    } as never);
    await engine.runOnce();
    const body = pushBodies[0]!;
    expect((body['categories'] as unknown[]).length).toBe(1);
    expect((body['transactions'] as unknown[]).length).toBe(1);
  });

  it('re-sends a previously failed record', async () => {
    const t = tx();
    await db.put('transactions', t);
    await db.markFailed('transactions', (t as { local_id: string }).local_id);
    await engine.runOnce();
    expect(pushBodies).toHaveLength(1);
  });
});

describe('pull', () => {
  it('walks the cursor to completion', async () => {
    let n = 0;
    transport.pull = async (_since, cursor) => {
      n++;
      if (!cursor) return { transactions: [tx()], categories: [], banks: [], next_cursor: 'c1', has_more: true, server_time: NOW.toISOString() };
      if (cursor === 'c1') return { transactions: [tx()], categories: [], banks: [], next_cursor: 'c2', has_more: true, server_time: NOW.toISOString() };
      return { transactions: [tx()], categories: [], banks: [], next_cursor: null, has_more: false, server_time: NOW.toISOString() };
    };
    await engine.runOnce();
    expect(n).toBe(3);
    expect((await db.all('transactions')).length).toBe(3);
  });

  it('does not loop forever if the server never stops paginating', async () => {
    transport.pull = async () => ({
      transactions: [], categories: [], banks: [], next_cursor: 'always', has_more: true, server_time: NOW.toISOString(),
    });
    await engine.runOnce(); // must terminate
    expect(engine.getState()).toBe('idle');
  });
});

describe('backoff', () => {
  it('jitters the idle interval', () => {
    // A fixed interval synchronises every client into a herd that hits the
    // origin in lockstep after an outage.
    const lo = new SyncEngine(db, transport, 'd1', { random: () => 0 });
    const hi = new SyncEngine(db, transport, 'd1', { random: () => 1 });
    expect(lo.nextDelayMs()).toBe(60_000);
    expect(hi.nextDelayMs()).toBe(90_000);
  });

  it('backs off exponentially after failures and recovers on success', async () => {
    transport.reachable = async () => {
      throw new Error('network down');
    };
    const e = new SyncEngine(db, transport, 'd1', { random: () => 0 });
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      await e.runOnce();
      delays.push(e.nextDelayMs());
    }
    expect(delays[0]).toBeLessThan(delays[1]!);
    expect(delays[1]).toBeLessThan(delays[2]!);
    expect(e.getState()).toBe('error');

    transport.reachable = async () => true;
    await e.runOnce();
    expect(e.getState()).toBe('idle');
    expect(e.nextDelayMs()).toBe(60_000); // reset
  });

  it('caps the backoff so it cannot grow without bound', async () => {
    transport.reachable = async () => {
      throw new Error('down');
    };
    const e = new SyncEngine(db, transport, 'd1', { random: () => 0 });
    for (let i = 0; i < 20; i++) await e.runOnce();
    expect(e.nextDelayMs()).toBeLessThanOrEqual(300_000);
  });
});

describe('concurrency', () => {
  it('will not run two cycles at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    transport.pull = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { transactions: [], categories: [], banks: [], next_cursor: null, has_more: false, server_time: NOW.toISOString() };
    };
    await Promise.all([engine.runOnce(), engine.runOnce(), engine.runOnce()]);
    expect(maxInFlight).toBe(1);
  });
});

describe('timer', () => {
  it('schedules and can be stopped', () => {
    vi.useFakeTimers();
    const e = new SyncEngine(db, transport, 'd1', { random: () => 0, baseIntervalMs: 1000, jitterMs: 0 });
    e.start();
    vi.advanceTimersByTime(1100);
    e.stop();
    vi.useRealTimers();
    expect(calls).toContain('reachable');
  });
});

describe('pull applies categories and banks', () => {
  // Without this the server could hold everything and the device would still
  // show "Uncategorised" for every row: the client used to discard both.
  it('writes categories and banks from the pull payload', async () => {
    transport.pull = async () => ({
      transactions: [],
      categories: [{
        local_id: 'c-1', server_id: 'c-1', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
        deleted_at: null, sync_status: 'synced', version: 1, device_id: 'server',
        name: 'Groceries', icon: 'groceries', colour: '#14B8A6', limit_minor: 32000,
        is_fixed: false, due_day: null,
      }],
      banks: [{
        local_id: 'b-1', server_id: 'b-1', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
        deleted_at: null, sync_status: 'synced', version: 1, device_id: 'server',
        name: 'Monzo', colour: '#FF4D6A',
      }],
      next_cursor: null, has_more: false, server_time: NOW.toISOString(),
    });
    await engine.runOnce();
    expect((await db.all('categories')).map((c) => c.name)).toEqual(['Groceries']);
    expect((await db.all('banks')).map((b) => b.name)).toEqual(['Monzo']);
  });
});

describe('runOnce settles even when the server fails', () => {
  // App gates the onboarding decision on the first pull completing. If a failed
  // pull could leave that promise unsettled, a second device would sit on the
  // splash forever instead of showing the app.
  it('resolves rather than rejecting when pull throws', async () => {
    transport.pull = async () => { throw new Error('offline'); };
    await expect(engine.runOnce()).resolves.toBeUndefined();
  });

  it('resolves when push throws', async () => {
    transport.push = async () => { throw new Error('offline'); };
    await expect(engine.runOnce()).resolves.toBeUndefined();
  });
});

describe('onPulled', () => {
  const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    local_id: 'c-1', server_id: 'c-1', created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    deleted_at: null, sync_status: 'synced', version: 1, device_id: 'server',
    name: 'Groceries', icon: 'groceries', colour: '#14B8A6', limit_minor: 32000,
    is_fixed: false, due_day: null, ...over,
  });

  it('fires when rows are written, so the caller can reload its own copy', async () => {
    // The engine writes to the database; the store is a separate in-memory
    // copy. Without this signal they diverge and pulled data stays invisible
    // until a reload — which made a set-up account look empty and get offered
    // setup a second time.
    let pulled = 0;
    const e = new SyncEngine(db, transport, 'd1', { onPulled: () => { pulled++; } });
    transport.pull = async () => ({
      transactions: [], categories: [row()], banks: [],
      next_cursor: null, has_more: false, server_time: NOW.toISOString(),
    });
    await e.runOnce();
    expect(pulled).toBe(1);
  });

  it('does not fire when the server sends nothing', async () => {
    // A no-op cycle must not churn the store; this runs every 60 seconds.
    let pulled = 0;
    const e = new SyncEngine(db, transport, 'd1', { onPulled: () => { pulled++; } });
    transport.pull = async () => ({
      transactions: [], categories: [], banks: [],
      next_cursor: null, has_more: false, server_time: NOW.toISOString(),
    });
    await e.runOnce();
    expect(pulled).toBe(0);
  });

  it('fires for transactions too, not only categories', async () => {
    let pulled = 0;
    const e = new SyncEngine(db, transport, 'd1', { onPulled: () => { pulled++; } });
    transport.pull = async () => ({
      transactions: [tx()], categories: [], banks: [],
      next_cursor: null, has_more: false, server_time: NOW.toISOString(),
    });
    await e.runOnce();
    expect(pulled).toBe(1);
  });
});
