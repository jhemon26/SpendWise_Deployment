import { uuidv7, MAX_PUSH_BATCH, type Bank, type Category, type SyncPushResponse, type Transaction } from '@spendwise/shared-types';
import type { StorageAdapter, Table } from '../db/adapter.js';

/**
 * Client sync engine (ARCHITECTURE §6.3).
 *
 * Event-driven, not a polling loop: a local write, regained connectivity or an
 * app resume wakes it. The timer is only a safety net, and it is JITTERED —
 * a fixed interval synchronises every client in the country into a herd that
 * hits the origin in lockstep the moment it recovers from an outage.
 */

export type SyncState = 'idle' | 'pushing' | 'pulling' | 'offline' | 'error';

export interface SyncTransport {
  push(body: unknown): Promise<SyncPushResponse>;
  pull(since: string | null, cursor: string | null): Promise<{
    transactions: unknown[];
    categories: unknown[];
    banks: unknown[];
    next_cursor: string | null;
    has_more: boolean;
    server_time: string;
  }>;
  reachable(): Promise<boolean>;
}

export interface EngineOptions {
  baseIntervalMs?: number;
  jitterMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  random?: () => number;
}

export class SyncEngine {
  private state: SyncState = 'idle';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private attempt = 0;
  private lastPulledAt: string | null = null;

  private readonly base: number;
  private readonly jitter: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  readonly listeners = new Set<(s: SyncState) => void>();

  constructor(
    private readonly db: StorageAdapter,
    private readonly transport: SyncTransport,
    private readonly deviceId: string,
    opts: EngineOptions = {},
  ) {
    this.base = opts.baseIntervalMs ?? 60_000;
    this.jitter = opts.jitterMs ?? 30_000;
    this.maxAttempts = opts.maxAttempts ?? 10;
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
  }

  getState(): SyncState {
    return this.state;
  }

  private setState(s: SyncState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  /**
   * Exponential backoff with jitter. Without the random component every client
   * retries at the same instant after an outage and stampedes the origin
   * exactly when it is weakest.
   */
  nextDelayMs(): number {
    if (this.attempt === 0) return this.base + this.random() * this.jitter;
    const backoff = Math.min(this.base * 2 ** this.attempt, 300_000);
    return backoff + this.random() * this.jitter;
  }

  /** Wake on a local write, reconnect or resume. */
  wake(): void {
    void this.runOnce();
  }

  start(): void {
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.schedule());
    }, this.nextDelayMs());
  }

  /**
   * One full cycle: push, then pull.
   *
   * PUSH BEFORE PULL, always. Pulling first would let a server record overwrite
   * a local edit that has not been transmitted yet — silent data loss, and the
   * hardest class of bug to reproduce.
   */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.transport.reachable())) {
        this.setState('offline');
        return;
      }

      this.setState('pushing');
      await this.pushPending();

      this.setState('pulling');
      await this.pullChanges();

      this.attempt = 0;
      this.setState('idle');
    } catch {
      this.attempt = Math.min(this.attempt + 1, this.maxAttempts);
      this.setState('error');
    } finally {
      this.running = false;
    }
  }

  private async pushPending(): Promise<void> {
    const pending = await this.db.pending();
    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += MAX_PUSH_BATCH) {
      const slice = pending.slice(i, i + MAX_PUSH_BATCH);
      const body = {
        device_id: this.deviceId,
        // One key per batch. A retry after the server committed but before the
        // 200 arrived is recognised as a replay instead of duplicating (§6.5).
        idempotency_key: uuidv7(),
        client_time: this.now().toISOString(),
        transactions: slice.filter((p) => p.table === 'transactions').map((p) => p.rec),
        categories: slice.filter((p) => p.table === 'categories').map((p) => p.rec),
        banks: slice.filter((p) => p.table === 'banks').map((p) => p.rec),
      };

      const res = await this.transport.push(body);

      for (const a of res.accepted) {
        const hit = slice.find((p) => p.rec.local_id === a.local_id);
        if (hit) await this.db.markSynced(hit.table, a.local_id, a.version);
      }
      for (const c of res.conflicts) {
        const hit = slice.find((p) => p.rec.local_id === c.local_id);
        if (hit) await this.db.markFailed(hit.table, c.local_id);
      }
    }
  }

  private async pullChanges(): Promise<void> {
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page: Awaited<ReturnType<SyncTransport['pull']>> = await this.transport.pull(
        this.lastPulledAt,
        cursor,
      );
      /* Categories and banks arrive on the first page only. Applying them
         BEFORE the transactions matters: a transaction whose category has not
         landed yet renders as "Uncategorised" until the next cycle. */
      const cats = page.categories as Category[];
      if (cats.length) await this.db.bulkPut('categories', cats);
      const bnks = page.banks as Bank[];
      if (bnks.length) await this.db.bulkPut('banks', bnks);

      // bulkPut is generic over the table, so name the table to pin the element
      // type rather than casting through `unknown` and losing the check.
      const rows = page.transactions as Transaction[];
      if (rows.length) await this.db.bulkPut('transactions', rows);
      cursor = page.next_cursor;
      this.lastPulledAt = page.server_time;
      if (++guard > 100) break; // a server that never stops paginating
    } while (cursor);
  }

  /** Test seam. */
  setLastPulled(iso: string | null): void {
    this.lastPulledAt = iso;
  }
}

/** Convenience table list used when replaying a full local scan. */
export const SYNC_TABLES: Table[] = ['categories', 'banks', 'transactions'];
