import { Pool, type PoolClient, type PoolConfig } from 'pg';

/**
 * Postgres access with per-request tenant context.
 *
 * Every user-scoped query runs inside `withUser`, which opens a transaction and
 * sets `app.user_id` for its duration. The RLS policies in migration 002 read
 * that setting, so a query that forgets its `WHERE user_id` returns nothing
 * rather than another tenant's rows.
 */
export class Db {
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...config,
    });
  }

  /**
   * Run `fn` in a transaction with the tenant context bound.
   *
   * `set_config(..., true)` is SET LOCAL: it is scoped to this transaction and
   * reverts on COMMIT or ROLLBACK. That is the whole reason this is safe on a
   * pooled connection — a plain SET would persist on the socket and leak one
   * user's context into whichever request picked the connection up next.
   */
  async withUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  /** For pre-authentication work (token lookup, provider sign-in). No tenant context. */
  async withoutUser<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
