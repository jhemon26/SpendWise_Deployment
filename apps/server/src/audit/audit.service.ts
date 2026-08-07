import { Logger } from '@nestjs/common';
import type { Db } from '../db/db.js';

/**
 * Append-only audit log (ARCHITECTURE §9.4 A09, §5.3).
 *
 * The table is partitioned monthly and the app role has INSERT and SELECT but
 * not UPDATE or DELETE, so the record of what happened cannot be edited by the
 * process that produces it.
 */

export interface AuditEntry {
  user_id: string | null;
  action: string;
  actor_ip?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  meta?: Record<string, unknown>;
}

export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(private readonly db: Db) {}

  /**
   * Never throws.
   *
   * A failed audit write must not fail the user's request — losing an expense
   * because the log was full is a worse outcome than a gap in the log. But the
   * failure is shouted loudly, because §14 makes "backup/audit job failed" an
   * alerting condition rather than something to discover later.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      // audit_logs is NOT under RLS: it is operator-facing and never exposed
      // through a user endpoint, and a user must not be able to suppress or
      // read the record of their own actions.
      await this.db.withoutUser(async (c) => {
        await c.query(
          `INSERT INTO audit_logs (user_id, actor_ip, action, entity, entity_id, meta)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            entry.user_id,
            entry.actor_ip ?? null,
            entry.action,
            entry.entity ?? null,
            entry.entity_id ?? null,
            JSON.stringify(scrub(entry.meta ?? {})),
          ],
        );
      });
    } catch (err) {
      this.log.error(`audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}

const SENSITIVE = /token|secret|password|code|otp|refresh|authorization|dek|kek/i;

/**
 * The audit log is read during incident response and shipped to Loki, so it is
 * exactly the wrong place for a credential. Redact by key name rather than
 * trusting every call site to remember.
 */
function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = scrub(v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out;
}

export { scrub as __scrubForTest };
