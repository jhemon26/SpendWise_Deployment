import type { PoolClient } from 'pg';
import type { SyncStatus } from '@spendwise/shared-types';
import type { IdempotencyRecord, PullPage, StoredTransaction, SyncRepo } from './sync.repo.js';

/**
 * Postgres-backed sync repository.
 *
 * Constructed with a client that is ALREADY inside `Db.withUser`, so every
 * statement here runs under the tenant's RLS context and inside one
 * transaction. That makes a push atomic: a crash mid-batch rolls back the
 * writes AND the idempotency record together, so the retry is clean.
 */

interface Row {
  local_id: string;
  user_id: string;
  category_id: string | null;
  bank_id: string | null;
  amount_minor: string;
  currency: string;
  base_minor: string | null;
  base_currency: string;
  fx_rate: string;
  fx_rate_date: Date;
  fx_provisional: boolean;
  merchant_enc: Buffer | null;
  note_enc: Buffer | null;
  occurred_at: Date;
  is_income: boolean;
  pending: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const COLS = `local_id, user_id, category_id, bank_id, amount_minor, currency,
  base_minor, base_currency, fx_rate, fx_rate_date, fx_provisional,
  merchant_enc, note_enc, occurred_at, is_income, pending, version,
  created_at, updated_at, deleted_at`;

/**
 * BIGINT and NUMERIC arrive from node-postgres as STRINGS, because they can
 * exceed IEEE-754. Money is already validated to be inside the safe range
 * (shared-types clamps it), so Number() is correct here — but the conversion
 * has to be deliberate. Letting a string amount reach the merge logic would
 * make `incoming.amount_minor !== existing.amount_minor` true for identical
 * values, and every push would look like a conflict.
 */
function toStored(r: Row): StoredTransaction {
  return {
    local_id: r.local_id,
    user_id: r.user_id,
    server_id: r.local_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null,
    sync_status: 'synced' as SyncStatus,
    version: r.version,
    device_id: 'server',
    category_id: r.category_id,
    bank_id: r.bank_id,
    amount_minor: Number(r.amount_minor),
    currency: r.currency,
    base_minor: r.base_minor === null ? null : Number(r.base_minor),
    base_currency: r.base_currency,
    fx_rate: Number(r.fx_rate),
    fx_rate_date: r.fx_rate_date.toISOString().slice(0, 10),
    fx_provisional: r.fx_provisional,
    merchant: r.merchant_enc ? r.merchant_enc.toString('utf8') : null,
    note: r.note_enc ? r.note_enc.toString('utf8') : null,
    occurred_at: r.occurred_at.toISOString(),
    is_income: r.is_income,
    pending: r.pending,
  };
}

const buf = (s: string | null): Buffer | null => (s === null ? null : Buffer.from(s, 'utf8'));

export class PgSyncRepo implements SyncRepo {
  constructor(private readonly c: PoolClient) {}

  async findIdempotent(key: string, userId: string): Promise<IdempotencyRecord | null> {
    const { rows } = await this.c.query<IdempotencyRecord>(
      `SELECT idempotency_key, user_id, result_hash, created_at
         FROM sync_operations WHERE idempotency_key = $1 AND user_id = $2`,
      [key, userId],
    );
    return rows[0] ?? null;
  }

  async saveIdempotent(key: string, userId: string, resultHash: string): Promise<void> {
    await this.c.query(
      `INSERT INTO sync_operations (idempotency_key, user_id, result_hash)
       VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, userId, resultHash],
    );
  }

  async getTransaction(userId: string, localId: string): Promise<StoredTransaction | null> {
    const { rows } = await this.c.query<Row>(
      `SELECT ${COLS} FROM transactions WHERE local_id = $1 AND user_id = $2`,
      [localId, userId],
    );
    return rows[0] ? toStored(rows[0]) : null;
  }

  /**
   * UPDATE-then-INSERT rather than a single upsert.
   *
   * `transactions` is partitioned on occurred_at and its primary key is
   * (local_id, occurred_at), so `ON CONFLICT (local_id)` is not available and
   * conflicting on the composite key would MISS when a user edits the date —
   * silently inserting a duplicate in another partition. A plain UPDATE moves
   * the row across partitions correctly (PG11+).
   */
  async putTransaction(t: StoredTransaction): Promise<void> {
    const params = [
      t.local_id, t.user_id, t.category_id, t.bank_id, t.amount_minor, t.currency,
      t.base_minor, t.base_currency, t.fx_rate, t.fx_rate_date, t.fx_provisional,
      buf(t.merchant), buf(t.note), t.occurred_at, t.is_income, t.pending, t.version,
      t.created_at, t.updated_at, t.deleted_at,
    ];

    const upd = await this.c.query(
      `UPDATE transactions SET
         category_id=$3, bank_id=$4, amount_minor=$5, currency=$6,
         base_minor=$7, base_currency=$8, fx_rate=$9, fx_rate_date=$10,
         fx_provisional=$11, merchant_enc=$12, note_enc=$13, occurred_at=$14,
         is_income=$15, pending=$16, version=$17, created_at=$18,
         updated_at=$19, deleted_at=$20
       WHERE local_id=$1 AND user_id=$2`,
      params,
    );
    if (upd.rowCount && upd.rowCount > 0) return;

    await this.c.query(
      `INSERT INTO transactions (${COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      params,
    );
  }

  /** Keyset pagination on (updated_at, local_id) — stable, and no OFFSET scan. */
  async listChangedSince(
    userId: string,
    since: Date,
    limit: number,
    cursor: string | null,
  ): Promise<PullPage> {
    let afterAt = since;
    // Nil UUID, not '': the keyset comparison is typed, and an empty string is
    // not a valid uuid. This is the lower bound for "no cursor yet".
    let afterId = '00000000-0000-0000-0000-000000000000';
    if (cursor) {
      const [at, id] = cursor.split('|');
      if (at && id) {
        afterAt = new Date(at);
        afterId = id;
      }
    }

    const { rows } = await this.c.query<Row>(
      `SELECT ${COLS} FROM transactions
        WHERE user_id = $1
          AND (updated_at, local_id) > ($2, $3)
        ORDER BY updated_at, local_id
        LIMIT $4`,
      [userId, afterAt, afterId, limit + 1],
    );

    const has_more = rows.length > limit;
    const page = rows.slice(0, limit).map(toStored);
    const last = page[page.length - 1];
    return {
      rows: page,
      next_cursor: has_more && last ? `${last.updated_at}|${last.local_id}` : null,
      has_more,
    };
  }

  async getFxRate(base: string, quote: string, on: string): Promise<number | null> {
    if (base === quote) return 1;
    const { rows } = await this.c.query<{ rate: string }>(
      `SELECT rate FROM fx_rates WHERE base = $1 AND quote = $2 AND rate_date = $3`,
      [base, quote, on],
    );
    return rows[0] ? Number(rows[0].rate) : null;
  }
}
