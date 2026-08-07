import type { Bank, Category, Transaction } from '@spendwise/shared-types';

/**
 * Local storage contract (ARCHITECTURE §4.2).
 *
 * One interface, two engines: Dexie/IndexedDB on web, Capacitor SQLite on
 * native. No feature code imports either engine directly — that discipline is
 * what makes swapping the implementation a one-file change.
 *
 * The local store is the SOURCE OF TRUTH. Writes land here first and return
 * immediately; the network is a background concern. Disk, screen, network —
 * in that order, always.
 */

export type Table = 'transactions' | 'categories' | 'banks';

export interface Row {
  transactions: Transaction;
  categories: Category;
  banks: Bank;
}

export interface StorageAdapter {
  init(): Promise<void>;
  all<T extends Table>(table: T): Promise<Row[T][]>;
  get<T extends Table>(table: T, localId: string): Promise<Row[T] | null>;
  put<T extends Table>(table: T, rec: Row[T]): Promise<Row[T]>;
  bulkPut<T extends Table>(table: T, recs: Row[T][]): Promise<void>;
  /** Tombstone, never a hard delete: a removed row must still sync (§4.1). */
  softDelete<T extends Table>(table: T, localId: string, at: string): Promise<void>;
  /** Everything awaiting upload, oldest first. */
  pending(): Promise<Array<{ table: Table; rec: Transaction | Category | Bank }>>;
  markSynced(table: Table, localId: string, version: number): Promise<void>;
  markFailed(table: Table, localId: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory adapter, used by tests and as a last-resort fallback. */
export class MemoryAdapter implements StorageAdapter {
  private readonly data: Record<Table, Map<string, unknown>> = {
    transactions: new Map(),
    categories: new Map(),
    banks: new Map(),
  };

  async init(): Promise<void> {}

  async all<T extends Table>(table: T): Promise<Row[T][]> {
    return [...this.data[table].values()] as Row[T][];
  }

  async get<T extends Table>(table: T, localId: string): Promise<Row[T] | null> {
    return (this.data[table].get(localId) as Row[T]) ?? null;
  }

  async put<T extends Table>(table: T, rec: Row[T]): Promise<Row[T]> {
    this.data[table].set(rec.local_id, rec);
    return rec;
  }

  async bulkPut<T extends Table>(table: T, recs: Row[T][]): Promise<void> {
    for (const r of recs) this.data[table].set(r.local_id, r);
  }

  async softDelete<T extends Table>(table: T, localId: string, at: string): Promise<void> {
    const cur = this.data[table].get(localId) as Row[T] | undefined;
    if (!cur) return;
    this.data[table].set(localId, {
      ...cur,
      deleted_at: at,
      updated_at: at,
      sync_status: 'pending',
    });
  }

  async pending(): Promise<Array<{ table: Table; rec: Transaction | Category | Bank }>> {
    const out: Array<{ table: Table; rec: Transaction | Category | Bank }> = [];
    for (const table of ['categories', 'banks', 'transactions'] as Table[]) {
      // Categories and banks first: a transaction referencing a brand-new
      // category must not reach the server before the category does.
      for (const rec of this.data[table].values()) {
        const r = rec as Transaction;
        if (r.sync_status === 'pending' || r.sync_status === 'failed') out.push({ table, rec: r });
      }
    }
    return out.sort((a, b) => a.rec.updated_at.localeCompare(b.rec.updated_at));
  }

  async markSynced(table: Table, localId: string, version: number): Promise<void> {
    const cur = this.data[table].get(localId) as Transaction | undefined;
    if (cur) this.data[table].set(localId, { ...cur, sync_status: 'synced', version });
  }

  async markFailed(table: Table, localId: string): Promise<void> {
    const cur = this.data[table].get(localId) as Transaction | undefined;
    if (cur) this.data[table].set(localId, { ...cur, sync_status: 'failed' });
  }

  async clear(): Promise<void> {
    for (const t of Object.keys(this.data) as Table[]) this.data[t].clear();
  }
}
