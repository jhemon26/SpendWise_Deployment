import type { Db } from '../db/db.js';
import type { NewSession, SessionRecord, SessionStore } from './session.store.js';

/**
 * Postgres session store.
 *
 * Reads and writes run under RLS via `Db.withUser`, with ONE exception:
 * `findByHash` happens before identity is established, so it goes through the
 * audited `auth_find_session_by_hash` function from migration 003. That is the
 * entire bypass surface for sessions — every other operation is tenant-scoped.
 */

interface Row {
  id: string;
  user_id: string;
  refresh_hash: string;
  family_id: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const toRecord = (r: Row): SessionRecord => ({
  id: r.id,
  user_id: r.user_id,
  refresh_hash: r.refresh_hash,
  family_id: r.family_id,
  device_id: r.device_id,
  expires_at: r.expires_at,
  revoked_at: r.revoked_at,
  created_at: r.created_at,
});

export class PgSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async create(s: NewSession): Promise<SessionRecord> {
    return this.db.withUser(s.user_id, async (c) => {
      const { rows } = await c.query<Row>(
        `INSERT INTO sessions (user_id, refresh_hash, family_id, device_id, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, user_id, refresh_hash, family_id, device_id,
                   expires_at, revoked_at, created_at`,
        [s.user_id, s.refresh_hash, s.family_id, s.device_id, s.expires_at],
      );
      return toRecord(rows[0]!);
    });
  }

  /** Pre-authentication: no tenant context exists yet. See migration 003. */
  async findByHash(hash: string): Promise<SessionRecord | null> {
    return this.db.withoutUser(async (c) => {
      const { rows } = await c.query<Row>(
        `SELECT id, user_id, refresh_hash, family_id, device_id,
                expires_at, revoked_at, created_at
           FROM auth_find_session_by_hash($1)`,
        [hash],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  /**
   * Compare-and-set in SQL. `WHERE revoked_at IS NULL` makes this atomic
   * against a concurrent refresh: the database picks a winner, and rowCount
   * tells the loser it lost. Doing this as read-then-write in JS would let
   * both requests through.
   */
  async revokeIfActive(id: string, at: Date, user_id: string): Promise<boolean> {
    return this.db.withUser(user_id, async (c) => {
      const r = await c.query(
        `UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
        [id, at],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  async revokeFamily(family_id: string, at: Date, user_id: string): Promise<number> {
    return this.db.withUser(user_id, async (c) => {
      const r = await c.query(
        `UPDATE sessions SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL`,
        [family_id, at],
      );
      return r.rowCount ?? 0;
    });
  }

  async countActive(user_id: string): Promise<number> {
    return this.db.withUser(user_id, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [user_id],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }
}
