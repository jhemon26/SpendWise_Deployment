import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  uuidv7, flowFields, billFields,
  type Category, type SyncPushRequest, type Transaction,
} from '@spendwise/shared-types';
import { Db } from '../db/db.js';
import { PgSyncRepo } from './sync.repo.pg.js';
import { SyncService } from './sync.service.js';

/**
 * Integration tests against a real PostgreSQL.
 *
 * The unit tests prove the merge logic; these prove the logic still holds once
 * RLS, partitioning and pg's type coercion are in the loop — which is where
 * the unit tests' in-memory repo is silently more forgiving than production.
 *
 * Skipped automatically when no database is reachable, so `pnpm test` works on
 * a bare checkout.
 */

const PGHOST = process.env['PGHOST'] ?? '127.0.0.1';
const PGPORT = Number(process.env['PGPORT'] ?? 55432);
const SUPER = process.env['PGSUPER'] ?? 'postgres';
const DB = 'spendwise_pg_it';

const MIG = join(process.cwd(), 'migrations');

let db: Db;
let userA: string;
let userB: string;

async function superClient(database: string): Promise<Client> {
  const c = new Client({ host: PGHOST, port: PGPORT, user: SUPER, database });
  await c.connect();
  return c;
}

/**
 * Probed at module scope, not in beforeAll.
 *
 * `describe.skipIf` / `it.runIf` are evaluated while the file is COLLECTED,
 * which happens before any hook runs — a flag set in beforeAll is still false
 * at that point and every test silently skips while reporting success. Top-level
 * await resolves before collection finishes, so the flag is real.
 */
const available: boolean = await (async () => {
  try {
    const c = new Client({ host: PGHOST, port: PGPORT, user: SUPER, database: 'postgres' });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
})();

if (!available) {
  // eslint-disable-next-line no-console
  console.warn(`[sync.pg.integration] no PostgreSQL at ${PGHOST}:${PGPORT} — skipping`);
}

beforeAll(async () => {
  if (!available) return;
  const root = await superClient('postgres');
  await root.query(`DROP DATABASE IF EXISTS ${DB}`);
  await root.query(`CREATE DATABASE ${DB}`);
  await root.end();

  const c = await superClient(DB);
  c.on('notice', () => undefined);
  // Every migration, in order. Listing them by hand meant a new one was
  // silently skipped and the suite failed against a schema no deployment has.
  for (const f of readdirSync(MIG).filter((n) => /^\d+_.*\.sql$/.test(n)).sort()) {
    await c.query(readFileSync(join(MIG, f), 'utf8'));
  }
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO users (display_name, dek_wrapped)
     VALUES ('A', '\\x00'), ('B', '\\x00') RETURNING id`,
  );
  userA = rows[0]!.id;
  userB = rows[1]!.id;
  await c.query(
    `INSERT INTO fx_rates (rate_date, base, quote, rate) VALUES ($1,'EUR','GBP',0.85)`,
    ['2026-08-07'],
  );
  await c.end();

  db = new Db({
    host: PGHOST,
    port: PGPORT,
    user: 'spendwise_app',
    password: 'change-me-in-production',
    database: DB,
  });
}, 60_000);

afterAll(async () => {
  if (!available || !db) return;
  await db.close();
  const root = await superClient('postgres');
  await root.query(`DROP DATABASE IF EXISTS ${DB}`);
  await root.end();
});

const clock = new Date('2026-08-07T12:00:00Z');
const iso = (d: Date | string) => new Date(d).toISOString();

function tx(over: Partial<Transaction> = {}): Transaction {
  const t = iso(clock);
  return {
    local_id: uuidv7(), server_id: null, created_at: t, updated_at: t, deleted_at: null,
    sync_status: 'pending', version: 0, device_id: 'phone',
    category_id: null, bank_id: null,
    amount_minor: -1550, currency: 'GBP', base_minor: -1550, base_currency: 'GBP',
    fx_rate: 1, fx_rate_date: '2026-08-07', fx_provisional: false,
    merchant: "Sainsbury's", note: null, occurred_at: t,
    is_income: false, pending: false, ...over,
  };
}
const push = (t: Transaction[], over: Partial<SyncPushRequest> = {}): SyncPushRequest => ({
  device_id: 'phone', idempotency_key: uuidv7(), client_time: iso(clock),
  transactions: t, categories: [], banks: [], ...over,
});

/** Run a push as `userId`, inside the RLS transaction context. */
async function pushAs(userId: string, req: SyncPushRequest) {
  return db.withUser(userId, async (c) => {
    const svc = new SyncService(new PgSyncRepo(c), { now: () => clock });
    return svc.push(userId, req);
  });
}
async function pullAs(userId: string, since = new Date(0), cursor: string | null = null) {
  return db.withUser(userId, async (c) => {
    const svc = new SyncService(new PgSyncRepo(c), { now: () => clock });
    return svc.pull(userId, since, cursor);
  });
}

describe.skipIf(!available)('sync over Postgres', () => {
  beforeEach(async () => {
    if (!available) return;
    const c = await superClient(DB);
    await c.query('DELETE FROM transactions');
    await c.query('DELETE FROM sync_operations');
    await c.end();
  });

  it('persists a pushed transaction', async () => {
    const t = tx();
    const res = await pushAs(userA, push([t]));
    expect(res.accepted).toEqual([{ local_id: t.local_id, version: 1 }]);

    const page = await pullAs(userA);
    expect(page.transactions).toHaveLength(1);
    expect(page.transactions[0]?.amount_minor).toBe(-1550);
  });

  it('returns amounts as numbers, not strings', async () => {
    // BIGINT and NUMERIC come back from pg as strings. If that leaked into the
    // merge logic every comparison would be false and every push would conflict.
    const t = tx();
    await pushAs(userA, push([t]));
    const page = await pullAs(userA);
    const got = page.transactions[0]!;
    expect(typeof got.amount_minor).toBe('number');
    expect(typeof got.fx_rate).toBe('number');
    expect(typeof got.version).toBe('number');
  });

  it('is idempotent across the real table', async () => {
    const req = push([tx()]);
    const first = await pushAs(userA, req);
    const replay = await pushAs(userA, req);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect((await pullAs(userA)).transactions).toHaveLength(1);
  });

  it('RLS keeps tenants apart through the service', async () => {
    // The service passes user_id explicitly AND the policies enforce it. This
    // asserts the two agree, which is the point of having both.
    await pushAs(userA, push([tx({ merchant: 'A-only' })]));
    await pushAs(userB, push([tx({ merchant: 'B-only' })]));

    const a = await pullAs(userA);
    const b = await pullAs(userB);
    expect(a.transactions.map((t) => t.merchant)).toEqual(['A-only']);
    expect(b.transactions.map((t) => t.merchant)).toEqual(['B-only']);
  });

  it('cannot read another tenant even asking by primary key', async () => {
    const t = tx();
    await pushAs(userA, push([t]));
    const seen = await db.withUser(userB, async (c) =>
      new PgSyncRepo(c).getTransaction(userB, t.local_id),
    );
    expect(seen).toBeNull();
  });

  it('a forged user_id is rejected by the policy, not silently written', async () => {
    const t = tx();
    await expect(
      db.withUser(userB, async (c) => {
        // B tries to write a row owned by A
        await new PgSyncRepo(c).putTransaction({ ...t, user_id: userA, version: 1 });
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('recomputes FX from the rates table', async () => {
    const t = tx({
      amount_minor: -1400, currency: 'EUR', base_minor: -1200,
      base_currency: 'GBP', fx_rate: 0.857, fx_provisional: true,
    });
    await pushAs(userA, push([t]));
    const got = (await pullAs(userA)).transactions[0]!;
    expect(got.base_minor).toBe(-1190); // 1400 * 0.85 from fx_rates
    expect(got.fx_provisional).toBe(false);
    expect(got.amount_minor).toBe(-1400); // what the user typed, untouched
  });

  it('moves a row between partitions when the date changes', async () => {
    // occurred_at is the partition key AND part of the primary key, so an
    // upsert on (local_id, occurred_at) would miss here and duplicate the row.
    const t = tx();
    await pushAs(userA, push([t]));

    const moved = { ...t, version: 1, occurred_at: iso(new Date('2026-09-15T10:00:00Z')) };
    await pushAs(userA, push([moved]));

    const page = await pullAs(userA);
    expect(page.transactions).toHaveLength(1); // not two
    expect(page.transactions[0]?.occurred_at).toBe(iso('2026-09-15T10:00:00Z'));
  });

  it('paginates with a keyset cursor', async () => {
    const c = await superClient(DB);
    await c.end();
    for (let i = 0; i < 5; i++) {
      await pushAs(userA, push([tx({ updated_at: iso(new Date(clock.getTime() + i * 1000)) })]));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page = await db.withUser(userA, async (cl) =>
        new SyncService(new PgSyncRepo(cl), { now: () => clock, pageSize: 2 }).pull(
          userA, new Date(0), cursor,
        ),
      );
      seen.push(...page.transactions.map((t) => t.local_id));
      cursor = page.next_cursor;
      if (++guard > 10) throw new Error('cursor did not terminate');
    } while (cursor);
    expect(new Set(seen).size).toBe(5);
  });

  /* ── cycles and pots (migration 008) ──────────────────────────────────
     Types agreeing is not the same as data surviving a save and a reload.
     These write through the real repo and read back, so a mis-numbered
     placeholder or a DATE coming back shifted by a timezone would fail here
     rather than in someone's rent reminder. */

  const category = (over: Partial<Category> = {}): Category => ({
    local_id: uuidv7(), server_id: null,
    created_at: iso(clock), updated_at: iso(clock), deleted_at: null,
    sync_status: 'synced', version: 1, device_id: 'd',
    name: 'Groceries', icon: 'groceries', colour: '#93bfb2',
    limit_minor: 9000, is_fixed: false, due_day: null,
    ...flowFields(), ...over,
  });

  it('round-trips a flow category unchanged', async () => {
    const c = category();
    await db.withUser(userA, async (cl) => new PgSyncRepo(cl).putCategory(userA, c));
    const back = await db.withUser(userA, async (cl) =>
      (await new PgSyncRepo(cl).listCategoriesChangedSince(userA, new Date(0))).find((x) => x.local_id === c.local_id));
    expect(back?.kind).toBe('flow');
    expect(back?.pot_kind).toBeNull();
    expect(back?.opening_minor).toBe(0);
  });

  it('round-trips a pot, including the anchor date and opening balance', async () => {
    const c = category({
      name: 'Car insurance', limit_minor: 48000, is_fixed: true,
      ...billFields('annual', '2027-03-01', 12500),
    });
    await db.withUser(userA, async (cl) => new PgSyncRepo(cl).putCategory(userA, c));
    const back = await db.withUser(userA, async (cl) =>
      (await new PgSyncRepo(cl).listCategoriesChangedSince(userA, new Date(0))).find((x) => x.local_id === c.local_id));
    expect(back?.kind).toBe('pot');
    expect(back?.pot_kind).toBe('bill');
    expect(back?.recurrence).toBe('annual');
    // A DATE comes back from pg as a Date. Formatting it through toISOString()
    // shifts it a day either side of UTC, which would silently move due dates.
    expect(back?.anchor_date).toBe('2027-03-01');
    expect(back?.opening_minor).toBe(12500);
  });

  it('round-trips a weekly cycle through settings', async () => {
    const now = iso(clock);
    await db.withUser(userA, async (cl) => new PgSyncRepo(cl).putSettings(userA, {
      display_name: 'Emon', base_currency: 'GBP',
      day_to_day_minor: 21300, savings_target_minor: 20000,
      avatar_emoji: '', avatar_colour: '#c2d6e8', monthly_income_minor: 0,
      cycle_kind: 'days', cycle_length_days: 7, cycle_anchor_date: '2026-08-07',
      cycle_anchor_day: null, expected_income_minor: 50000,
      budget_start_date: '2026-08-07', updated_at: now,
    }));
    const back = await db.withUser(userA, async (cl) => new PgSyncRepo(cl).getSettings(userA));
    expect(back?.cycle_kind).toBe('days');
    expect(back?.cycle_length_days).toBe(7);
    expect(back?.cycle_anchor_date).toBe('2026-08-07');
    expect(back?.expected_income_minor).toBe(50000);
    expect(back?.budget_start_date).toBe('2026-08-07');
  });

  it('refuses a bill with no recurrence, at the database level', async () => {
    // The client should never build one, but the constraint is what guarantees
    // a pot the accrual engine cannot compute a due date for never exists.
    const bad = category({ kind: 'pot', pot_kind: 'bill', recurrence: null, anchor_date: null });
    await expect(
      db.withUser(userA, async (cl) => new PgSyncRepo(cl).putCategory(userA, bad)),
    ).rejects.toThrow();
  });
});
