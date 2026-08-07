/**
 * Session persistence for refresh-token rotation (ARCHITECTURE §9.1).
 *
 * The store is an interface so the rotation logic can be unit-tested without a
 * database, and so the Postgres implementation can be swapped for a managed
 * one later without touching the security-critical code.
 */

export interface SessionRecord {
  id: string;
  user_id: string;
  /** SHA-256 of the refresh token. The token itself is never stored. */
  refresh_hash: string;
  /** Rotation lineage. Presenting a retired token revokes the whole family. */
  family_id: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

export interface NewSession {
  user_id: string;
  refresh_hash: string;
  family_id: string;
  device_id: string | null;
  expires_at: Date;
}

export interface SessionStore {
  create(s: NewSession): Promise<SessionRecord>;
  findByHash(hash: string): Promise<SessionRecord | null>;

  /**
   * Revoke a single session, but ONLY if it is currently active.
   *
   * Returns true if this call performed the revocation. That return value is
   * the concurrency control: two simultaneous refreshes with the same token
   * both find an active session, but only one wins the compare-and-set. The
   * loser must be treated as a replay, not silently allowed through.
   */
  revokeIfActive(id: string, at: Date): Promise<boolean>;

  /** Revoke every session in a lineage. Returns how many were still active. */
  revokeFamily(family_id: string, at: Date): Promise<number>;

  countActive(user_id: string): Promise<number>;
}

/** In-memory implementation, for tests and local development. */
export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, SessionRecord>();
  private seq = 0;

  async create(s: NewSession): Promise<SessionRecord> {
    const rec: SessionRecord = {
      id: `sess-${++this.seq}`,
      user_id: s.user_id,
      refresh_hash: s.refresh_hash,
      family_id: s.family_id,
      device_id: s.device_id,
      expires_at: s.expires_at,
      revoked_at: null,
      created_at: new Date(),
    };
    this.rows.set(rec.id, rec);
    return rec;
  }

  async findByHash(hash: string): Promise<SessionRecord | null> {
    for (const r of this.rows.values()) if (r.refresh_hash === hash) return r;
    return null;
  }

  async revokeIfActive(id: string, at: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.revoked_at !== null) return false;
    r.revoked_at = at;
    return true;
  }

  async revokeFamily(family_id: string, at: Date): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.family_id === family_id && r.revoked_at === null) {
        r.revoked_at = at;
        n++;
      }
    }
    return n;
  }

  async countActive(user_id: string): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.user_id === user_id && r.revoked_at === null) n++;
    }
    return n;
  }

  /** Test helper. */
  all(): SessionRecord[] {
    return [...this.rows.values()];
  }
}
