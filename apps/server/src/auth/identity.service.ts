import { randomBytes } from 'node:crypto';
import type { Db } from '../db/db.js';

/**
 * Identity resolution for passwordless sign-in (ARCHITECTURE §9.1).
 *
 * One human, many providers. `(provider, subject)` is the durable key — Apple
 * private-relay addresses rotate and can be revoked by the user at any time, so
 * email is a hint and never an identifier.
 */

export type Provider = 'google' | 'apple' | 'phone' | 'email';

export interface ResolvedIdentity {
  user_id: string;
  created: boolean;
}

export interface IdentityInput {
  provider: Provider;
  /** The provider's stable id for this person. */
  subject: string;
  email?: string | null;
  phone_e164?: string | null;
  display_name?: string | null;
  /** True only when the provider asserts the address is verified. */
  email_verified?: boolean;
}

export class IdentityService {
  constructor(private readonly db: Db) {}

  /** Existing user for this provider identity, or null. */
  async find(provider: Provider, subject: string): Promise<string | null> {
    return this.db.withoutUser(async (c) => {
      const { rows } = await c.query<{ user_id: string }>(
        `SELECT user_id FROM auth_find_identity($1, $2)`,
        [provider, subject],
      );
      return rows[0]?.user_id ?? null;
    });
  }

  /**
   * Resolve a sign-in to a user, creating one on first contact.
   *
   * An UNVERIFIED email is never used to link to an existing account. Doing so
   * would let anyone register a victim's address with a provider that does not
   * verify, and inherit the account. The address is still stored — it is just
   * not trusted to prove who someone is.
   */
  async resolve(input: IdentityInput): Promise<ResolvedIdentity> {
    const linkableEmail = input.email_verified ? (input.email ?? null) : null;

    return this.db.withoutUser(async (c) => {
      const { rows } = await c.query<{ user_id: string; created: boolean }>(
        `SELECT user_id, created FROM auth_register_identity($1,$2,$3,$4,$5,$6)`,
        [
          input.provider,
          input.subject,
          linkableEmail,
          input.phone_e164 ?? null,
          input.display_name ?? null,
          // Placeholder wrapped DEK. Envelope encryption (§9.3) replaces this
          // with a real per-user key wrapped by the KEK; the column is NOT NULL
          // from day one so that migration never has to backfill.
          randomBytes(32),
        ],
      );
      const r = rows[0]!;
      return { user_id: r.user_id, created: r.created };
    });
  }

  /** Link an additional provider to the signed-in user (§9.1: keep two). */
  async link(userId: string, input: IdentityInput): Promise<void> {
    await this.db.withUser(userId, async (c) => {
      await c.query(
        `INSERT INTO identities (user_id, provider, subject, email, phone_e164, last_used_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (provider, subject) DO UPDATE SET last_used_at = now()`,
        [userId, input.provider, input.subject, input.email ?? null, input.phone_e164 ?? null],
      );
    });
  }

  async listForUser(userId: string): Promise<Array<{ provider: string; email: string | null }>> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<{ provider: string; email: string | null }>(
        `SELECT provider, email FROM identities WHERE user_id = $1 ORDER BY provider`,
        [userId],
      );
      return rows;
    });
  }

  /**
   * Refuse to remove someone's last way in.
   *
   * With no password there is no reset email to fall back on: unlinking the
   * final provider would lock the user out of their own data permanently.
   */
  async unlink(userId: string, provider: Provider): Promise<{ removed: boolean; reason?: string }> {
    return this.db.withUser(userId, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identities WHERE user_id = $1`,
        [userId],
      );
      if (Number(rows[0]?.n ?? 0) <= 1) {
        return { removed: false, reason: 'last_identity' };
      }
      const r = await c.query(`DELETE FROM identities WHERE user_id = $1 AND provider = $2`, [
        userId,
        provider,
      ]);
      return { removed: (r.rowCount ?? 0) > 0 };
    });
  }
}
