import type { Bank, Category, Transaction } from '@spendwise/shared-types';

/**
 * Persistence seam for the sync engine.
 *
 * An interface so the merge logic — the part that can silently corrupt user
 * data — is unit-testable against deliberately hostile input without a
 * database in the loop.
 */

/** A transaction as the server holds it. */
export interface StoredTransaction extends Transaction {
  user_id: string;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  user_id: string;
  result_hash: string;
  created_at: Date;
}

export interface PullPage {
  rows: StoredTransaction[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface UserSettings {
  display_name: string;
  base_currency: string;
  day_to_day_minor: number;
  savings_target_minor: number;
  avatar_emoji: string;
  avatar_colour: string;
  updated_at: string;
}

export interface SyncRepo {
  /** Non-null means this batch was already applied; return the stored result. */
  findIdempotent(key: string, userId: string): Promise<IdempotencyRecord | null>;
  saveIdempotent(key: string, userId: string, resultHash: string): Promise<void>;

  getTransaction(userId: string, localId: string): Promise<StoredTransaction | null>;
  putTransaction(row: StoredTransaction): Promise<void>;

  /** Records changed strictly after `since`, ordered by (updated_at, local_id). */
  listChangedSince(
    userId: string,
    since: Date,
    limit: number,
    cursor: string | null,
  ): Promise<PullPage>;

  /** Authoritative ECB rate. Null when we have no rate for that day. */
  getFxRate(base: string, quote: string, on: string): Promise<number | null>;

  /*
   * Categories and banks are last-write-wins on updated_at. They are small,
   * user-authored and rarely edited on two devices at once, so the version
   * negotiation transactions need would cost more than it buys.
   */
  putCategory(userId: string, row: Category): Promise<void>;
  putBank(userId: string, row: Bank): Promise<void>;
  listCategoriesChangedSince(userId: string, since: Date): Promise<Category[]>;
  listBanksChangedSince(userId: string, since: Date): Promise<Bank[]>;

  getSettings(userId: string): Promise<UserSettings | null>;
  putSettings(userId: string, s: UserSettings): Promise<void>;
}

export class InMemorySyncRepo implements SyncRepo {
  private readonly txs = new Map<string, StoredTransaction>();
  private readonly idem = new Map<string, IdempotencyRecord>();
  private readonly fx = new Map<string, number>();
  private readonly cats = new Map<string, Category>();
  private readonly banks = new Map<string, Bank>();
  private readonly settings = new Map<string, UserSettings>();

  async putCategory(userId: string, row: Category): Promise<void> {
    const existing = this.cats.get(this.key(userId, row.local_id));
    // Last write wins, but an older payload must never clobber a newer row —
    // a retry of a stale batch would otherwise undo an edit.
    if (existing && existing.updated_at > row.updated_at) return;
    this.cats.set(this.key(userId, row.local_id), row);
  }

  async putBank(userId: string, row: Bank): Promise<void> {
    const existing = this.banks.get(this.key(userId, row.local_id));
    if (existing && existing.updated_at > row.updated_at) return;
    this.banks.set(this.key(userId, row.local_id), row);
  }

  async listCategoriesChangedSince(userId: string, since: Date): Promise<Category[]> {
    return [...this.cats.entries()]
      .filter(([k]) => k.startsWith(`${userId}:`))
      .map(([, v]) => v)
      .filter((c) => new Date(c.updated_at) > since);
  }

  async listBanksChangedSince(userId: string, since: Date): Promise<Bank[]> {
    return [...this.banks.entries()]
      .filter(([k]) => k.startsWith(`${userId}:`))
      .map(([, v]) => v)
      .filter((b) => new Date(b.updated_at) > since);
  }

  async getSettings(userId: string): Promise<UserSettings | null> {
    return this.settings.get(userId) ?? null;
  }

  async putSettings(userId: string, s: UserSettings): Promise<void> {
    const existing = this.settings.get(userId);
    if (existing && existing.updated_at > s.updated_at) return;
    this.settings.set(userId, s);
  }

  private key(userId: string, localId: string): string {
    return `${userId}:${localId}`;
  }

  async findIdempotent(key: string, userId: string): Promise<IdempotencyRecord | null> {
    const r = this.idem.get(`${userId}:${key}`);
    return r ?? null;
  }

  async saveIdempotent(key: string, userId: string, resultHash: string): Promise<void> {
    const k = `${userId}:${key}`;
    if (this.idem.has(k)) return; // primary key would reject a second write
    this.idem.set(k, {
      idempotency_key: key,
      user_id: userId,
      result_hash: resultHash,
      created_at: new Date(),
    });
  }

  async getTransaction(userId: string, localId: string): Promise<StoredTransaction | null> {
    return this.txs.get(this.key(userId, localId)) ?? null;
  }

  async putTransaction(row: StoredTransaction): Promise<void> {
    this.txs.set(this.key(row.user_id, row.local_id), row);
  }

  async listChangedSince(
    userId: string,
    since: Date,
    limit: number,
    cursor: string | null,
  ): Promise<PullPage> {
    const all = [...this.txs.values()]
      .filter((r) => r.user_id === userId && Date.parse(r.updated_at) > since.getTime())
      .sort((a, b) => {
        const d = Date.parse(a.updated_at) - Date.parse(b.updated_at);
        return d !== 0 ? d : a.local_id.localeCompare(b.local_id);
      });

    const start = cursor ? all.findIndex((r) => `${r.updated_at}|${r.local_id}` === cursor) + 1 : 0;
    const rows = all.slice(start, start + limit);
    const has_more = start + limit < all.length;
    const last = rows[rows.length - 1];
    return {
      rows,
      next_cursor: has_more && last ? `${last.updated_at}|${last.local_id}` : null,
      has_more,
    };
  }

  async getFxRate(base: string, quote: string, on: string): Promise<number | null> {
    if (base === quote) return 1;
    return this.fx.get(`${on}:${base}:${quote}`) ?? null;
  }

  /** Test helpers. */
  setFxRate(base: string, quote: string, on: string, rate: number): void {
    this.fx.set(`${on}:${base}:${quote}`, rate);
  }
  count(): number {
    return this.txs.size;
  }
  all(): StoredTransaction[] {
    return [...this.txs.values()];
  }
}
