import { describe, it, expect, beforeEach } from 'vitest';
import { uuidv7, type SyncPushRequest, type Transaction } from '@spendwise/shared-types';
import { SyncService } from './sync.service.js';
import { InMemorySyncRepo } from './sync.repo.js';

/**
 * Built from the hostile scenarios in ARCHITECTURE §19: airplane mode mid-write,
 * clock skew, duplicate pushes, two devices editing one record.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let repo: InMemorySyncRepo;
let clock: Date;
let svc: SyncService;

beforeEach(() => {
  repo = new InMemorySyncRepo();
  clock = new Date('2026-08-07T12:00:00Z');
  svc = new SyncService(repo, { now: () => clock });
});

const iso = (d: Date | string) => new Date(d).toISOString();

function tx(over: Partial<Transaction> = {}): Transaction {
  const t = iso(clock);
  return {
    local_id: uuidv7(),
    server_id: null,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    sync_status: 'pending',
    version: 0,
    device_id: 'phone',
    category_id: null,
    bank_id: null,
    amount_minor: -1550,
    currency: 'GBP',
    base_minor: -1550,
    base_currency: 'GBP',
    fx_rate: 1,
    fx_rate_date: '2026-08-07',
    fx_provisional: false,
    merchant: "Sainsbury's",
    note: null,
    occurred_at: t,
    is_income: false,
    pending: false,
    ...over,
  };
}

function push(transactions: Transaction[], over: Partial<SyncPushRequest> = {}): SyncPushRequest {
  return {
    device_id: 'phone',
    idempotency_key: uuidv7(),
    client_time: iso(clock),
    transactions,
    categories: [],
    banks: [],
    ...over,
  };
}

describe('push — first write', () => {
  it('accepts a new record at version 1', async () => {
    const t = tx();
    const res = await svc.push(USER, push([t]));
    expect(res.accepted).toEqual([{ local_id: t.local_id, version: 1 }]);
    expect(res.conflicts).toEqual([]);
    expect(res.replayed).toBe(false);
  });

  it('marks the stored row synced and stamps server_id', async () => {
    const t = tx();
    await svc.push(USER, push([t]));
    const stored = await repo.getTransaction(USER, t.local_id);
    expect(stored?.sync_status).toBe('synced');
    expect(stored?.server_id).toBe(t.local_id);
  });

  it('keeps each user in their own space', async () => {
    const t = tx();
    await svc.push(USER, push([t]));
    expect(await repo.getTransaction(OTHER, t.local_id)).toBeNull();
  });
});

describe('idempotency — the dropped-200 case', () => {
  it('does not apply the same batch twice', async () => {
    const t = tx();
    const req = push([t]);

    const first = await svc.push(USER, req);
    const replay = await svc.push(USER, req); // radio dropped, client retries

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.accepted).toEqual(first.accepted);
    expect(repo.count()).toBe(1); // the whole point: no duplicate
  });

  it('does not bump the version on replay', async () => {
    const t = tx();
    const req = push([t]);
    await svc.push(USER, req);
    await svc.push(USER, req);
    expect((await repo.getTransaction(USER, t.local_id))?.version).toBe(1);
  });

  it('scopes keys per user', async () => {
    const key = uuidv7();
    const a = tx();
    const b = tx();
    await svc.push(USER, push([a], { idempotency_key: key }));
    const res = await svc.push(OTHER, push([b], { idempotency_key: key }));
    expect(res.replayed).toBe(false); // another user's key must not shadow ours
    expect(repo.count()).toBe(2);
  });

  it('treats a different key as a genuine second batch', async () => {
    const t = tx();
    await svc.push(USER, push([t]));
    const again = await svc.push(USER, push([{ ...t, version: 1, updated_at: iso(clock) }]));
    expect(again.replayed).toBe(false);
    expect(again.accepted[0]?.version).toBe(2);
  });
});

describe('conflicts — two devices, one record', () => {
  it('flags a stale client whose amount differs, for manual resolution', async () => {
    const t = tx({ amount_minor: -1000 });
    await svc.push(USER, push([t])); // now at version 1

    // laptop was offline and still thinks it is at version 0, with a different amount
    const stale = { ...t, version: 0, amount_minor: -2000, updated_at: iso(clock) };
    const res = await svc.push(USER, push([stale]));

    expect(res.accepted).toEqual([]);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({
      local_id: t.local_id,
      reason: 'amount_mismatch',
      server_version: 1,
    });
    // server copy untouched — we never silently overwrite money
    expect((await repo.getTransaction(USER, t.local_id))?.amount_minor).toBe(-1000);
  });

  it('flags a stale client with the same amount as version_behind', async () => {
    const t = tx({ merchant: 'Tesco' });
    await svc.push(USER, push([t]));
    const stale = { ...t, version: 0, merchant: 'Tesco Express', updated_at: iso(clock) };
    const res = await svc.push(USER, push([stale]));
    expect(res.conflicts[0]?.reason).toBe('version_behind');
  });

  it('returns the server record so the client can show both sides', async () => {
    const t = tx({ amount_minor: -1000 });
    await svc.push(USER, push([t]));
    const res = await svc.push(
      USER,
      push([{ ...t, version: 0, amount_minor: -9999, updated_at: iso(clock) }]),
    );
    expect(res.conflicts[0]?.server_record).toMatchObject({ amount_minor: -1000 });
  });

  it('lets an up-to-date client through', async () => {
    const t = tx();
    await svc.push(USER, push([t]));
    clock = new Date(clock.getTime() + 60_000);
    const res = await svc.push(
      USER,
      push([{ ...t, version: 1, merchant: 'Waitrose', updated_at: iso(clock) }]),
    );
    expect(res.conflicts).toEqual([]);
    expect((await repo.getTransaction(USER, t.local_id))?.merchant).toBe('Waitrose');
  });
});

describe('tombstones', () => {
  it('lets a deletion through even from a stale client', async () => {
    // Deletion is deliberate. A resurrected transaction alarms users far more
    // than a lost edit, so it beats the version check.
    const t = tx();
    await svc.push(USER, push([t]));
    const del = { ...t, version: 0, deleted_at: iso(clock), updated_at: iso(clock) };
    const res = await svc.push(USER, push([del]));
    expect(res.conflicts).toEqual([]);
    expect((await repo.getTransaction(USER, t.local_id))?.deleted_at).not.toBeNull();
  });

  it('does not resurrect a deleted record via a newer edit', async () => {
    const t = tx();
    await svc.push(USER, push([t]));
    const del = { ...t, version: 1, deleted_at: iso(clock), updated_at: iso(clock) };
    await svc.push(USER, push([del]));

    clock = new Date(clock.getTime() + 60_000);
    const edit = { ...t, version: 2, deleted_at: null, merchant: 'back?', updated_at: iso(clock) };
    await svc.push(USER, push([edit]));

    expect((await repo.getTransaction(USER, t.local_id))?.deleted_at).not.toBeNull();
  });
});

describe('clock skew', () => {
  it('corrects timestamps from a device whose clock is far off', async () => {
    // phone believes it is an hour earlier than it is
    const skewed = new Date(clock.getTime() - 3_600_000);
    const t = tx({ updated_at: iso(skewed), created_at: iso(skewed) });
    await svc.push(USER, push([t], { client_time: iso(skewed) }));

    const stored = await repo.getTransaction(USER, t.local_id);
    // normalised to server time, so LWW compares like with like
    expect(Math.abs(Date.parse(stored!.updated_at) - clock.getTime())).toBeLessThan(1000);
  });

  it('leaves small offsets alone', async () => {
    const near = new Date(clock.getTime() - 5_000); // inside the 30s tolerance
    const t = tx({ updated_at: iso(near) });
    await svc.push(USER, push([t], { client_time: iso(near) }));
    expect((await repo.getTransaction(USER, t.local_id))?.updated_at).toBe(iso(near));
  });
});

describe('multi-currency', () => {
  it('recomputes the base amount from the authoritative rate', async () => {
    repo.setFxRate('EUR', 'GBP', '2026-08-07', 0.85);
    // client was offline and guessed with a stale rate
    const t = tx({
      amount_minor: -1400,
      currency: 'EUR',
      base_minor: -1200,
      base_currency: 'GBP',
      fx_rate: 0.857,
      fx_provisional: true,
    });
    await svc.push(USER, push([t]));

    const stored = await repo.getTransaction(USER, t.local_id);
    expect(stored?.base_minor).toBe(-1190); // 1400 * 0.85
    expect(stored?.fx_rate).toBe(0.85);
    expect(stored?.fx_provisional).toBe(false);
    // what the user actually typed is never rewritten
    expect(stored?.amount_minor).toBe(-1400);
    expect(stored?.currency).toBe('EUR');
  });

  it('leaves the record provisional when no rate exists for that day', async () => {
    const t = tx({
      amount_minor: -1400,
      currency: 'EUR',
      base_minor: null,
      base_currency: 'GBP',
      fx_provisional: true,
    });
    await svc.push(USER, push([t]));
    const stored = await repo.getTransaction(USER, t.local_id);
    expect(stored?.base_minor).toBeNull(); // excluded from totals, not invented
    expect(stored?.fx_provisional).toBe(true);
  });
});

describe('pull', () => {
  it('returns only records changed after the cursor time', async () => {
    const old = tx();
    await svc.push(USER, push([old]));

    const cut = new Date(clock.getTime() + 1000);
    clock = new Date(clock.getTime() + 60_000);
    const fresh = tx();
    await svc.push(USER, push([fresh]));

    const page = await svc.pull(USER, cut);
    expect(page.transactions.map((t) => t.local_id)).toEqual([fresh.local_id]);
  });

  it('paginates and walks the cursor to completion', async () => {
    const small = new SyncService(repo, { now: () => clock, pageSize: 2 });
    for (let i = 0; i < 5; i++) {
      clock = new Date(clock.getTime() + 1000);
      await small.push(USER, push([tx()]));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page: Awaited<ReturnType<SyncService['pull']>> = await small.pull(
        USER,
        new Date(0),
        cursor,
      );
      seen.push(...page.transactions.map((t) => t.local_id));
      cursor = page.next_cursor;
      if (++guard > 10) throw new Error('cursor did not terminate');
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // no row served twice
  });

  it('never returns another user\'s rows', async () => {
    await svc.push(USER, push([tx()]));
    await svc.push(OTHER, push([tx()]));
    const page = await svc.pull(OTHER, new Date(0));
    expect(page.transactions).toHaveLength(1);
    expect(page.transactions[0]?.user_id).toBe(OTHER);
  });
});
