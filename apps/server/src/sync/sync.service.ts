import { createHash } from 'node:crypto';
import {
  convertMinor,
  PULL_PAGE_SIZE,
  type SyncConflict,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type Transaction,
} from '@spendwise/shared-types';
import type { StoredTransaction, SyncRepo } from './sync.repo.js';

/**
 * The sync engine (ARCHITECTURE §6).
 *
 * Client-authoritative, server-reconciled: the client owns what the user typed,
 * the server owns bookkeeping (version, FX). This is the component where a bug
 * loses somebody's money rather than merely annoying them, so the merge rules
 * are explicit and each has a test built from a hostile scenario.
 */

const MAX_CLOCK_SKEW_MS = 30_000;

export interface SyncServiceOptions {
  now?: () => Date;
  pageSize?: number;
}

export class SyncService {
  private readonly now: () => Date;
  private readonly pageSize: number;

  constructor(
    private readonly repo: SyncRepo,
    opts: SyncServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.pageSize = opts.pageSize ?? PULL_PAGE_SIZE;
  }

  /**
   * Apply a batch of client changes.
   *
   * Idempotent by `idempotency_key`: the classic failure is the server
   * committing and the mobile radio dropping before the 200 arrives, so the
   * client retries a batch that already landed. Without this, that retry
   * duplicates every record in it.
   */
  async push(userId: string, req: SyncPushRequest): Promise<SyncPushResponse> {
    const prior = await this.repo.findIdempotent(req.idempotency_key, userId);
    if (prior) {
      return {
        ...(JSON.parse(prior.result_hash) as Omit<SyncPushResponse, 'replayed'>),
        replayed: true,
      };
    }

    const accepted: SyncPushResponse['accepted'] = [];
    const conflicts: SyncConflict[] = [];
    const serverNow = this.now();

    // Device clocks lie. Measure the offset once per batch and correct every
    // timestamp in it, so LWW compares like with like (§6.4).
    const skewMs = serverNow.getTime() - Date.parse(req.client_time);
    const correct = (iso: string): string =>
      Math.abs(skewMs) > MAX_CLOCK_SKEW_MS
        ? new Date(Date.parse(iso) + skewMs).toISOString()
        : iso;

    for (const incoming of req.transactions) {
      const existing = await this.repo.getTransaction(userId, incoming.local_id);
      const stamped: Transaction = {
        ...incoming,
        updated_at: correct(incoming.updated_at),
        created_at: correct(incoming.created_at),
        deleted_at: incoming.deleted_at ? correct(incoming.deleted_at) : null,
      };

      if (!existing) {
        const row = await this.materialise(userId, stamped, 1);
        await this.repo.putTransaction(row);
        accepted.push({ local_id: row.local_id, version: row.version });
        continue;
      }

      const conflict = this.detectConflict(stamped, existing);
      if (conflict) {
        conflicts.push(conflict);
        continue;
      }

      const merged = this.merge(stamped, existing);
      const row = await this.materialise(userId, merged, existing.version + 1);
      await this.repo.putTransaction(row);
      accepted.push({ local_id: row.local_id, version: row.version });
    }

    const body: Omit<SyncPushResponse, 'replayed'> = {
      accepted,
      conflicts,
      server_time: serverNow.toISOString(),
    };
    await this.repo.saveIdempotent(req.idempotency_key, userId, JSON.stringify(body));
    return { ...body, replayed: false };
  }

  /**
   * A client whose version is behind has edited a record someone else already
   * changed. If the amounts also differ we refuse to guess: money is the one
   * field where a wrong automatic choice is worse than asking (§6.4).
   */
  private detectConflict(incoming: Transaction, existing: StoredTransaction): SyncConflict | null {
    if (incoming.version >= existing.version) return null;

    // A deletion is deliberate and always wins, even from a stale client.
    if (incoming.deleted_at && !existing.deleted_at) return null;

    if (incoming.amount_minor !== existing.amount_minor) {
      return {
        local_id: incoming.local_id,
        entity: 'transaction',
        reason: 'amount_mismatch',
        server_version: existing.version,
        server_record: existing,
      };
    }
    return {
      local_id: incoming.local_id,
      entity: 'transaction',
      reason: 'version_behind',
      server_version: existing.version,
      server_record: existing,
    };
  }

  /** Tombstone wins; otherwise last write wins on the corrected timestamp. */
  private merge(incoming: Transaction, existing: StoredTransaction): Transaction {
    if (incoming.deleted_at && !existing.deleted_at) return incoming;
    if (existing.deleted_at && !incoming.deleted_at) return { ...existing };
    return Date.parse(incoming.updated_at) >= Date.parse(existing.updated_at)
      ? incoming
      : { ...existing };
  }

  /**
   * Fill in the server-owned fields. The client may have converted with a
   * stale cached rate while offline; the authoritative ECB rate for the day
   * the money was spent replaces it. `amount_minor` and `currency` — what the
   * user actually typed — are never touched.
   */
  private async materialise(
    userId: string,
    tx: Transaction,
    version: number,
  ): Promise<StoredTransaction> {
    let base_minor = tx.base_minor;
    let fx_rate = tx.fx_rate;
    let provisional = tx.fx_provisional;

    const rate = await this.repo.getFxRate(tx.currency, tx.base_currency, tx.fx_rate_date);
    if (rate !== null) {
      fx_rate = rate;
      base_minor = convertMinor(tx.amount_minor, tx.currency, tx.base_currency, rate);
      provisional = false;
    } else if (tx.base_minor === null) {
      // No rate and no client estimate: leave it out of totals rather than
      // invent a number (§5.1.1).
      provisional = true;
    }

    return {
      ...tx,
      user_id: userId,
      version,
      base_minor,
      fx_rate,
      fx_provisional: provisional,
      sync_status: 'synced',
      server_id: tx.local_id,
    };
  }

  /** Cursor-paginated: a long-offline device must not ask for 50k rows at once. */
  async pull(
    userId: string,
    since: Date,
    cursor: string | null = null,
  ): Promise<SyncPullResponse> {
    const page = await this.repo.listChangedSince(userId, since, this.pageSize, cursor);
    return {
      transactions: page.rows,
      categories: [],
      banks: [],
      next_cursor: page.next_cursor,
      has_more: page.has_more,
      server_time: this.now().toISOString(),
    };
  }
}

/** Stable digest of a push result, for comparing replays in tests and logs. */
export function resultDigest(r: Omit<SyncPushResponse, 'replayed' | 'server_time'>): string {
  return createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 16);
}
